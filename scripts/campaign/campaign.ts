#!/usr/bin/env node
/**
 * Campaign CLI — Autonomous Verify Fault Discovery
 * =================================================
 *
 * npx @sovereign-labs/verify campaign [options]
 *
 * Options:
 *   --apps=football,sovtris     Apps to test (comma-separated, or "all")
 *   --apps-dir=/path/to/apps    Parent directory to scan for apps
 *   --goals-per-app=10          Goals to generate per app (default: 10)
 *   --categories=css_change,... Focus categories (default: diverse)
 *   --llm=gemini                LLM provider (gemini, claude, anthropic, ollama)
 *   --api-key=KEY               API key for LLM provider
 *   --claude-model=MODEL        Claude model (default: claude-sonnet-4-20250514)
 *   --ollama-host=URL           Ollama host (default: http://localhost:11434)
 *   --ollama-model=MODEL        Ollama model (default: qwen3:4b)
 *   --max-cost=1.00             Budget cap in USD (default: 1.00)
 *   --dry-run                   Generate goals + edits, don't run verify
 *   --no-cross-check            Disable cross-check probes
 *   --state-dir=PATH            State directory (default: .verify)
 *   --verbose                   Show all log lines
 *
 * Subcommands:
 *   campaign report             Show latest morning report
 *   campaign estimate           Cost estimate (no execution)
 */

import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { runCampaign } from './campaign-runner.js';
import { discoverApps, loadRegistry, resolveApps } from './app-registry.js';
import { generateReport, saveReport, formatReport, loadLatestReport } from './report.js';
import { createClaudeProvider } from './claude-brain.js';
import { createClaudeCodeFileProvider } from './claude-code-brain.js';
import type { CampaignConfig, GoalCategory, LLMProviderType, LLMCallFn } from './types.js';

// =============================================================================
// LLM PROVIDER FACTORY
// =============================================================================

function createLLMProvider(
  provider: LLMProviderType,
  apiKey?: string,
  ollamaHost?: string,
  ollamaModel?: string,
): LLMCallFn {
  switch (provider) {
    case 'gemini': {
      if (!apiKey) throw new Error('Gemini requires --api-key');
      return async (systemPrompt, userPrompt) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Gemini API error ${resp.status}: ${body.substring(0, 200)}`);
        }
        const data = await resp.json() as any;
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('')
          || (parts?.[0]?.text ?? '');
        const usage = data.usageMetadata ?? {};
        return { text, inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 };
      };
    }
    case 'claude': {
      if (!apiKey) throw new Error('Claude requires --api-key (ANTHROPIC_API_KEY)');
      return createClaudeProvider(apiKey, {
        model: ollamaModel, // Reuse --ollama-model flag as model override for simplicity
      });
    }
    case 'anthropic': {
      if (!apiKey) throw new Error('Anthropic requires --api-key');
      return async (systemPrompt, userPrompt) => {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8192,
            temperature: 0.3,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Anthropic API error ${resp.status}: ${body.substring(0, 200)}`);
        }
        const data = await resp.json() as any;
        const text = data.content?.map((c: any) => c.text).join('') ?? '';
        return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
      };
    }
    case 'claude-code': {
      // Claude Code IS the LLM — exchange prompts via filesystem
      return createClaudeCodeFileProvider(join(process.cwd(), '.verify'));
    }
    case 'ollama': {
      const host = ollamaHost ?? 'http://localhost:11434';
      const model = ollamaModel ?? 'qwen3:4b';
      return async (systemPrompt, userPrompt) => {
        const resp = await fetch(`${host}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            stream: false,
            options: { temperature: 0.3 },
          }),
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Ollama API error ${resp.status}: ${body.substring(0, 200)}`);
        }
        const data = await resp.json() as any;
        return { text: data.response ?? '', inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
      };
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

// =============================================================================
// ARG PARSING
// =============================================================================

function getArg(args: string[], name: string): string | undefined {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found?.split('=').slice(1).join('=');
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

// =============================================================================
// MAIN
// =============================================================================

export async function runCampaignCLI(args: string[]): Promise<void> {
  const subcommand = args[0];

  // Subcommands
  if (subcommand === 'report') {
    return showReport(args.slice(1));
  }
  if (subcommand === 'estimate') {
    return showEstimate(args.slice(1));
  }

  // Main campaign command
  const cwd = process.cwd();
  const stateDir = resolve(getArg(args, 'state-dir') ?? join(cwd, '.verify'));
  const appsDir = getArg(args, 'apps-dir') ?? join(cwd, 'apps');
  const appNames = getArg(args, 'apps')?.split(',').map(s => s.trim()) ?? [];
  const goalsPerApp = parseInt(getArg(args, 'goals-per-app') ?? '10', 10);
  const maxCost = parseFloat(getArg(args, 'max-cost') ?? '1.00');
  const dryRun = hasFlag(args, 'dry-run');
  const noCrossCheck = hasFlag(args, 'no-cross-check');
  const verbose = hasFlag(args, 'verbose');
  const llmName = (getArg(args, 'llm') ?? 'gemini') as LLMProviderType;
  const apiKey = getArg(args, 'api-key')
    ?? (llmName === 'claude' || llmName === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY
      : llmName === 'gemini' ? process.env.GEMINI_API_KEY : undefined);
  const ollamaHost = getArg(args, 'ollama-host');
  const ollamaModel = getArg(args, 'ollama-model') ?? getArg(args, 'claude-model');
  const categoriesRaw = getArg(args, 'categories');
  const categories = categoriesRaw
    ? categoriesRaw.split(',').map(s => s.trim()) as GoalCategory[]
    : undefined;

  // Discover apps
  const discovered = discoverApps(appsDir);
  const manifest = loadRegistry(join(stateDir, 'apps-registry.json'));
  const apps = resolveApps(appNames, discovered, manifest);

  if (apps.length === 0) {
    console.error('No apps found. Use --apps=name or --apps-dir=/path/to/apps');
    console.error(`Searched: ${appsDir}`);
    if (discovered.length > 0) {
      console.error(`Discovered: ${discovered.map(a => a.name).join(', ')}`);
    }
    process.exit(1);
  }

  // Create LLM provider
  let llm: LLMCallFn;
  try {
    llm = createLLMProvider(llmName, apiKey, ollamaHost, ollamaModel);
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  // Build config
  const config: CampaignConfig = {
    apps,
    goalsPerApp,
    categories,
    llm,
    llmName,
    maxConcurrent: 1,
    maxTotalCost: maxCost,
    dryRun,
    crossCheckEnabled: !noCrossCheck,
    stateDir,
    verbose,
  };

  // Run campaign
  const result = await runCampaign(config);

  // Generate and save report
  if (!dryRun) {
    const report = generateReport(result, stateDir);
    const reportPath = saveReport(report, stateDir);
    console.log(formatReport(report));
    console.log(`  Report saved: ${reportPath}`);
  }
}

// =============================================================================
// SUBCOMMANDS
// =============================================================================

function showReport(args: string[]): void {
  const stateDir = resolve(getArg(args, 'state-dir') ?? join(process.cwd(), '.verify'));
  const report = loadLatestReport(stateDir);

  if (!report) {
    console.log('No campaign reports found.');
    console.log(`Looked in: ${join(stateDir, 'campaign-reports')}`);
    return;
  }

  console.log(formatReport(report));
}

function showEstimate(args: string[]): void {
  const cwd = process.cwd();
  const appsDir = getArg(args, 'apps-dir') ?? join(cwd, 'apps');
  const appNames = getArg(args, 'apps')?.split(',').map(s => s.trim()) ?? [];
  const goalsPerApp = parseInt(getArg(args, 'goals-per-app') ?? '10', 10);
  const stateDir = resolve(getArg(args, 'state-dir') ?? join(cwd, '.verify'));

  const discovered = discoverApps(appsDir);
  const manifest = loadRegistry(join(stateDir, 'apps-registry.json'));
  const apps = resolveApps(appNames, discovered, manifest);

  if (apps.length === 0) {
    console.error('No apps found.');
    process.exit(1);
  }

  const totalGoals = apps.length * goalsPerApp;
  // ~$0.005 per goal on Gemini Flash (goal gen + edit gen)
  const estimatedCost = totalGoals * 0.005;
  // ~2 min per goal with Docker (build + start + teardown)
  const estimatedDuration = totalGoals * 2;

  console.log('\n  Campaign Cost Estimate\n');
  console.log(`  Apps: ${apps.map(a => `${a.name} (${a.stackType})`).join(', ')}`);
  console.log(`  Goals per app: ${goalsPerApp}`);
  console.log(`  Total goals: ${totalGoals}`);
  console.log(`  Estimated cost: $${estimatedCost.toFixed(2)} (Gemini Flash)`);
  console.log(`  Estimated duration: ~${estimatedDuration} min (with Docker)`);
  console.log(`  Estimated duration: ~${Math.ceil(totalGoals * 0.1)} min (dry run, no Docker)`);
  console.log('');
}
