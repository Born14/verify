#!/usr/bin/env node
/**
 * Concurrent Evaluation CLI — Prove Verify Helps Frontier LLMs on SWE
 * =====================================================================
 *
 * npx tsx scripts/benchmark/concurrent.ts [options]
 *
 * Options:
 *   --app=<path>              App directory (default: fixtures/demo-app)
 *   --tasks=<n>               Tasks to generate (default: 20)
 *   --tasks-file=<path>       Load tasks from JSON (skip generation)
 *   --concurrency=<n>         Parallel tasks per model (default: 5)
 *   --max-attempts=<n>        Max govern() attempts (default: 3)
 *   --state-dir=<path>        Results directory (default: .verify/concurrent)
 *   --verbose                 Per-task output
 *
 * Model selection (repeat for multi-model):
 *   --gemini[=model]          Add Gemini (default: gemini-2.5-flash)
 *   --claude[=model]          Add Claude (default: claude-sonnet-4-20250514)
 *   --ollama[=model]          Add Ollama (default: qwen3:4b)
 *
 * Environment variables:
 *   GEMINI_API_KEY            Gemini API key
 *   ANTHROPIC_API_KEY         Anthropic API key
 *   OLLAMA_HOST               Ollama host (default: http://localhost:11434)
 *
 * Examples:
 *   # Single model, 10 tasks, concurrency 3
 *   npx tsx scripts/benchmark/concurrent.ts --gemini --tasks=10 --concurrency=3
 *
 *   # Multi-model head-to-head
 *   npx tsx scripts/benchmark/concurrent.ts --gemini --claude --tasks=15 --concurrency=5
 *
 *   # Reproducible run from saved tasks
 *   npx tsx scripts/benchmark/concurrent.ts --gemini --claude --tasks-file=.verify/concurrent/tasks.json
 *
 *   # Use curated SWE task bank
 *   npx tsx scripts/benchmark/concurrent.ts --gemini --tasks-file=scripts/benchmark/swe-tasks.json
 */

import { resolve, join } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { groundInReality } from '../../src/gates/grounding.js';
import { runConcurrentEval } from './concurrent-runner.js';
import type { ConcurrentConfig, ModelSpec } from './concurrent-types.js';
import type { BenchmarkTask, LLMCallFn } from './types.js';

// =============================================================================
// ARG PARSING
// =============================================================================

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.join('=') || 'true';
    }
  }
  return args;
}

// =============================================================================
// LLM FACTORY
// =============================================================================

function createLLM(provider: string, apiKey: string, model: string): LLMCallFn {
  switch (provider) {
    case 'gemini':
      return async (system, user) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
          }),
        });
        if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        const data = await resp.json() as any;
        const text = data.candidates?.[0]?.content?.parts
          ?.filter((p: any) => p.text && !p.thought)
          ?.map((p: any) => p.text).join('') || '';
        const usage = data.usageMetadata ?? {};
        return { text, inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 };
      };

    case 'claude':
    case 'anthropic':
      return async (system, user) => {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            temperature: 0.3,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        });
        if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        const data = await resp.json() as any;
        const text = data.content?.map((b: any) => b.text).join('') ?? '';
        return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
      };

    case 'ollama':
      return async (system, user) => {
        const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
        const resp = await fetch(`${host}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, system, prompt: user, stream: false, options: { temperature: 0.3 } }),
        });
        if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
        const data = await resp.json() as any;
        return { text: data.response ?? '', inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
      };

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// =============================================================================
// MODEL RESOLUTION
// =============================================================================

function resolveModels(args: Record<string, string>): ModelSpec[] {
  const models: ModelSpec[] = [];

  if (args['gemini']) {
    const apiKey = process.env.GEMINI_API_KEY ?? '';
    if (!apiKey) { console.error('Error: GEMINI_API_KEY not set'); process.exit(1); }
    const model = args['gemini'] === 'true' ? 'gemini-2.5-flash' : args['gemini'];
    models.push({
      name: model,
      provider: 'gemini',
      model,
      apiKey,
      llm: createLLM('gemini', apiKey, model),
    });
  }

  if (args['claude']) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) { console.error('Error: ANTHROPIC_API_KEY not set'); process.exit(1); }
    const model = args['claude'] === 'true' ? 'claude-sonnet-4-20250514' : args['claude'];
    models.push({
      name: model,
      provider: 'claude',
      model,
      apiKey,
      llm: createLLM('claude', apiKey, model),
    });
  }

  if (args['anthropic']) {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey) { console.error('Error: ANTHROPIC_API_KEY not set'); process.exit(1); }
    const model = args['anthropic'] === 'true' ? 'claude-sonnet-4-20250514' : args['anthropic'];
    models.push({
      name: model,
      provider: 'anthropic',
      model,
      apiKey,
      llm: createLLM('anthropic', apiKey, model),
    });
  }

  if (args['ollama']) {
    const model = args['ollama'] === 'true' ? 'qwen3:4b' : args['ollama'];
    models.push({
      name: model,
      provider: 'ollama',
      model,
      llm: createLLM('ollama', '', model),
    });
  }

  if (models.length === 0) {
    console.error('Error: No models specified. Use --gemini, --claude, or --ollama.');
    console.error('Example: npx tsx scripts/benchmark/concurrent.ts --gemini --tasks=10');
    process.exit(1);
  }

  return models;
}

// =============================================================================
// TASK GENERATION
// =============================================================================

const TASK_GEN_SYSTEM = `You are generating benchmark tasks for a code verification system.
Each task is a realistic coding goal that an AI agent would be asked to do.

Generate tasks that:
1. Are achievable with search/replace edits on the given source files
2. Span different difficulty levels (trivial, moderate, hard)
3. Cover different categories (CSS changes, HTML changes, logic changes, config changes)
4. Have clear success criteria
5. Are independent of each other

Respond with a JSON array of tasks. No markdown fencing.
Each task: { "goal": "...", "category": "...", "difficulty": "trivial|moderate|hard" }`;

async function generateTasks(
  appDir: string,
  count: number,
  llm: LLMCallFn,
): Promise<BenchmarkTask[]> {
  console.log(`Generating ${count} benchmark tasks...`);

  const grounding = groundInReality(appDir);
  const lines: string[] = [];
  lines.push(`App directory: ${appDir}`);
  lines.push(`Routes: ${grounding.routes.join(', ')}`);
  lines.push('');

  const sourceExts = new Set(['.js', '.ts', '.html', '.css', '.json']);
  const skipDirs = new Set(['node_modules', '.git', '.verify']);
  const { readdirSync, statSync } = require('fs');

  function walk(dir: string, prefix: string = ''): void {
    try {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, rel);
        else if (sourceExts.has(require('path').extname(entry)) && stat.size < 15_000) {
          lines.push(`--- ${rel} ---`);
          lines.push(readFileSync(full, 'utf-8'));
          lines.push('');
        }
      }
    } catch { /* skip */ }
  }
  walk(appDir);

  const prompt = `Generate exactly ${count} benchmark tasks for this app.\n\n${lines.join('\n')}`;
  const response = await llm(TASK_GEN_SYSTEM, prompt);

  let parsed: any[];
  try {
    let text = response.text.trim();
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(text);
  } catch {
    const match = response.text.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Failed to parse task generation response');
  }

  return parsed.map((t: any, i: number) => ({
    id: `task_${i + 1}`,
    goal: t.goal,
    appDir,
    predicates: t.predicates ?? [],
    category: t.category ?? 'general',
    difficulty: t.difficulty ?? 'moderate',
  }));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = parseArgs();

  const appDir = resolve(args['app'] ?? join(__dirname, '../../fixtures/demo-app'));
  const taskCount = parseInt(args['tasks'] ?? '20', 10);
  const concurrency = parseInt(args['concurrency'] ?? '5', 10);
  const maxAttempts = parseInt(args['max-attempts'] ?? '3', 10);
  const stateDir = resolve(args['state-dir'] ?? '.verify/concurrent');
  const verbose = args['verbose'] === 'true';
  const tasksFile = args['tasks-file'];

  if (!existsSync(appDir)) {
    console.error(`Error: App directory not found: ${appDir}`);
    process.exit(1);
  }

  const models = resolveModels(args);

  // Get or generate tasks
  let tasks: BenchmarkTask[];
  if (tasksFile && existsSync(tasksFile)) {
    console.log(`Loading tasks from ${tasksFile}...`);
    tasks = JSON.parse(readFileSync(tasksFile, 'utf-8'));
    tasks = tasks.map(t => ({ ...t, appDir }));
  } else {
    // Use first model's LLM for task generation
    tasks = await generateTasks(appDir, taskCount, models[0].llm!);
    mkdirSync(stateDir, { recursive: true });
    const tasksPath = join(stateDir, `tasks-${Date.now()}.json`);
    writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
    console.log(`Tasks saved to: ${tasksPath}`);
  }

  console.log(`\nLoaded ${tasks.length} tasks for ${appDir}`);
  console.log(`Models: ${models.map(m => m.name).join(', ')}`);
  console.log(`Concurrency: ${concurrency} tasks per model in parallel`);

  // Run concurrent evaluation
  const config: ConcurrentConfig = {
    tasks,
    models,
    concurrency,
    maxGovAttempts: maxAttempts,
    stateDir,
    verbose,
    skipDocker: true,
    onProgress: (p) => {
      const pct = ((p.completed / p.total) * 100).toFixed(0);
      const icon = p.outcome === 'verify_saved' ? '+' :
                   p.outcome === 'both_succeeded' ? '=' :
                   p.outcome === 'verify_regression' ? '!' :
                   p.outcome === 'both_failed' ? 'x' : '-';
      console.log(`  [${p.modelName}] ${pct}% (${p.completed}/${p.total}) [${icon}] ${p.taskId} → ${p.outcome} (${(p.elapsedMs / 1000).toFixed(1)}s)`);
    },
  };

  const run = await runConcurrentEval(config);

  // Exit code: 0 if verify helped or neutral, 1 if regression
  if (run.results.verdict === 'verify_hurts') {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\nConcurrent evaluation failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
