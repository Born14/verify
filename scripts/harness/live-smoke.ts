#!/usr/bin/env bun
/**
 * Live Smoke Test — Gemini + govern() against the demo app
 * =========================================================
 *
 * Fires real goals through the full governed loop:
 *   Grounding → LLM Plan → F9 → K5 → G5 → Filesystem → Verify → Narrow → Retry
 *
 * This is the product demo. Not mocked. Not deterministic.
 * A real LLM plans edits, verify judges them, failures teach the next attempt.
 *
 * Usage:
 *   GEMINI_API_KEY=... bun run scripts/harness/live-smoke.ts
 */

import { govern } from '../../src/govern.js';
import type { GovernContext, AgentPlan, GovernResult } from '../../src/govern.js';
import { join } from 'path';
import { copyFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY required');
  process.exit(1);
}

const GEMINI_MODEL = 'gemini-2.0-flash';
const DEMO_APP = join(import.meta.dir, '..', '..', 'fixtures', 'demo-app');

// We work on a copy so each goal starts clean
const WORK_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'demo-app-smoke');
// Shared state dir so K5 constraints accumulate across goals
const SHARED_STATE_DIR = join(import.meta.dir, '..', '..', 'fixtures', 'demo-app-smoke-state');

// ---------------------------------------------------------------------------
// Gemini planning agent
// ---------------------------------------------------------------------------

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] },
      ],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function buildSystemPrompt(): string {
  return `You are a coding agent. You receive a goal and context about a Node.js web app.
You must return a JSON object with:
- "edits": array of { "file": string, "search": string, "replace": string }
- "predicates": array of predicate objects

The app is a single-file Node.js HTTP server (server.js) with ALL HTML and CSS inline as template literals.
Routes: / (homepage), /about, /form, /edge-cases, /api/items, /api/echo, /health

CRITICAL RULES:
1. The search string MUST be copied EXACTLY from the source file. Character-for-character. If you can't find it in the SOURCE section below, don't use it.
2. CSS lives in <style> blocks inside template literals, NOT as inline styles on elements. To change a CSS property, edit the <style> block.
3. For CSS predicates: use the SOURCE VALUE as a baseline. The expected value should be what it will be AFTER your edit (e.g., if changing "#1a1a2e" to "orange", expected should be "orange").
4. To change text content, find the EXACT HTML snippet in the source and replace it.
5. Keep edits minimal — change only what's needed. Don't add inline styles when a <style> rule exists.
6. Each search string must appear EXACTLY ONCE in the file. If it appears multiple times, include more surrounding context to disambiguate.
7. Return ONLY valid JSON. No markdown fences. No explanation.

PREDICATE TYPES:
- CSS: { "type": "css", "selector": ".class", "property": "color", "expected": "orange", "path": "/" }
- Content: { "type": "content", "file": "server.js", "pattern": "exact text to find" }
- HTTP: { "type": "http", "path": "/health", "method": "GET", "expect": { "status": 200 } }`;
}

function buildUserPrompt(goal: string, ctx: GovernContext): string {
  const parts: string[] = [];
  parts.push(`GOAL: ${goal}`);
  parts.push(`ATTEMPT: ${ctx.attempt}`);

  // Show grounding (what the app actually looks like)
  if (ctx.grounding) {
    if (ctx.grounding.routeCSSMap && ctx.grounding.routeCSSMap.size > 0) {
      parts.push('\nCSS RULES (from source):');
      for (const [route, selectorMap] of ctx.grounding.routeCSSMap) {
        parts.push(`  Route ${route}:`);
        let count = 0;
        for (const [selector, properties] of selectorMap) {
          if (count++ >= 15) break;
          parts.push(`    ${selector} { ${Object.entries(properties).map(([k,v]) => `${k}: ${v}`).join('; ')} }`);
        }
      }
    }
    if (ctx.grounding.routes && ctx.grounding.routes.length > 0) {
      parts.push(`\nROUTES: ${ctx.grounding.routes.join(', ')}`);
    }
  }

  // Show what failed last time
  if (ctx.priorResult && !ctx.priorResult.success) {
    parts.push('\nPREVIOUS ATTEMPT FAILED:');
    for (const g of ctx.priorResult.gates) {
      if (!g.passed) {
        parts.push(`  ${g.gate}: ${g.detail}`);
      }
    }
  }

  // Show narrowing guidance
  if (ctx.narrowing) {
    if (ctx.narrowing.resolutionHint) {
      parts.push(`\nHINT: ${ctx.narrowing.resolutionHint}`);
    }
    if (ctx.narrowing.fileEvidence) {
      parts.push(`\nEVIDENCE: ${ctx.narrowing.fileEvidence}`);
    }
    if (ctx.narrowing.bannedFingerprints?.length) {
      parts.push(`\nBANNED (don't repeat): ${ctx.narrowing.bannedFingerprints.join(', ')}`);
    }
  }

  // Show constraints
  if (ctx.constraints.length > 0) {
    parts.push('\nACTIVE CONSTRAINTS:');
    for (const c of ctx.constraints) {
      parts.push(`  [${c.type}] ${c.reason}`);
    }
  }

  // Show convergence state
  if (ctx.convergence) {
    parts.push(`\nCONVERGENCE: ${ctx.convergence.progressSummary}`);
  }

  // Append source file — the model needs the real content to copy search strings
  try {
    const src = readFileSync(join(WORK_DIR, 'server.js'), 'utf-8');
    parts.push(`\nFULL SOURCE (server.js):\n${src}`);
  } catch {}

  return parts.join('\n');
}

function parseAgentResponse(raw: string): AgentPlan {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    return {
      edits: (parsed.edits || []).map((e: any) => ({
        file: e.file || 'server.js',
        search: String(e.search || ''),
        replace: String(e.replace || ''),
      })),
      predicates: (parsed.predicates || []).map((p: any) => ({
        ...p,
        type: p.type || 'content',
      })),
    };
  } catch (e) {
    console.log('    ⚠ Failed to parse LLM response, returning empty plan');
    return { edits: [], predicates: [] };
  }
}

// The agent: calls Gemini, parses response into edits + predicates
const geminiAgent = {
  plan: async (goal: string, ctx: GovernContext): Promise<AgentPlan> => {
    const system = buildSystemPrompt();
    const user = buildUserPrompt(goal, ctx);
    console.log(`    [Gemini] Planning attempt ${ctx.attempt}...`);
    const raw = await callGemini(system, user);
    const plan = parseAgentResponse(raw);
    console.log(`    [Gemini] ${plan.edits.length} edits, ${plan.predicates.length} predicates`);
    if (plan.edits.length > 0) {
      for (const e of plan.edits) {
        const searchPreview = e.search.slice(0, 50).replace(/\n/g, '\\n');
        const replacePreview = e.replace.slice(0, 50).replace(/\n/g, '\\n');
        console.log(`      edit: ${e.file} "${searchPreview}" → "${replacePreview}"`);
      }
    }
    return plan;
  },
};

// ---------------------------------------------------------------------------
// Test goals — increasing difficulty
// ---------------------------------------------------------------------------

interface SmokeGoal {
  name: string;
  goal: string;
  difficulty: string;
}

const GOALS: SmokeGoal[] = [
  // --- Round 1: Clean passes (prove the pipeline works) ---
  {
    name: '1. CSS Value Change',
    goal: 'Change the homepage h1 color from #1a1a2e to orange',
    difficulty: 'Easy — single CSS property, clear target',
  },
  {
    name: '2. Content Edit',
    goal: 'Change the /api/items response to include a third item with id 3 and name "Gamma"',
    difficulty: 'Medium — edit JSON response, content predicate',
  },

  // --- Round 2: Goals designed to exercise failure + learning ---
  {
    name: '3. Ambiguous Selector',
    goal: 'Make the card titles on the about page red',
    difficulty: 'Tricky — "card titles" is vague. .card-title exists but model may fabricate selectors',
  },
  {
    name: '4. Multi-Route Edit',
    goal: 'Change all nav-link colors from #0066cc to #e74c3c on every page',
    difficulty: 'Hard — a.nav-link appears in homepage AND about with different surrounding CSS',
  },
  {
    name: '5. Cross-Route CSS (ambiguous)',
    goal: 'Make the page headings bold and uppercase across the app',
    difficulty: 'Hard — h1/h2 on multiple routes, different contexts, vague target',
  },
  {
    name: '6. Add New Element + Style',
    goal: 'Add a "Verified by @sovereign-labs/verify" badge after the homepage h1, with green background, white text, rounded corners',
    difficulty: 'Hard — new HTML + new CSS rule + multiple style properties',
  },
  {
    name: '7. Edge Case CSS',
    goal: 'Change the minified link color from #3498db to purple on the edge-cases page',
    difficulty: 'Hard — minified CSS block, must find exact rule in compact format',
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function resetWorkDir() {
  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true });
  }
  mkdirSync(WORK_DIR, { recursive: true });
  // Copy demo app files
  for (const f of ['server.js', 'Dockerfile', 'docker-compose.yml', 'init.sql', 'config.json', '.env']) {
    const src = join(DEMO_APP, f);
    if (existsSync(src)) {
      copyFileSync(src, join(WORK_DIR, f));
    }
  }
  // Copy test-data dir
  const testDataSrc = join(DEMO_APP, 'test-data');
  const testDataDst = join(WORK_DIR, 'test-data');
  if (existsSync(testDataSrc)) {
    mkdirSync(testDataDst, { recursive: true });
    for (const f of require('fs').readdirSync(testDataSrc)) {
      copyFileSync(join(testDataSrc, f), join(testDataDst, f));
    }
  }
}

function printGates(result: any) {
  for (const g of result.gates || []) {
    const icon = g.passed ? '✓' : '✗';
    const time = `${g.durationMs}ms`;
    console.log(`      ${icon} ${g.gate.padEnd(16)} ${time.padStart(6)}  ${g.detail.slice(0, 80)}`);
  }
}

function printResult(name: string, goalDef: SmokeGoal, result: GovernResult) {
  const status = result.success ? '✅ CONVERGED' : `❌ ${result.stopReason.toUpperCase()}`;
  console.log(`\n  ┌─────────────────────────────────────────────────────`);
  console.log(`  │ ${name}`);
  console.log(`  │ ${goalDef.difficulty}`);
  console.log(`  │ Status: ${status} in ${result.attempts} attempt(s)`);
  console.log(`  │ Duration: ${(result.receipt.totalDurationMs / 1000).toFixed(1)}s`);
  if (result.receipt.constraintsSeeded.length > 0) {
    console.log(`  │ K5 constraints seeded: ${result.receipt.constraintsSeeded.length}`);
  }
  if (result.convergence.uniqueShapes.length > 0) {
    console.log(`  │ Failure shapes: ${result.convergence.uniqueShapes.join(', ')}`);
  }
  console.log(`  │`);
  console.log(`  │ Final gates:`);
  for (const g of result.finalResult.gates) {
    const icon = g.passed ? '✓' : '✗';
    console.log(`  │   ${icon} ${g.gate.padEnd(14)} ${String(g.durationMs + 'ms').padStart(6)}  ${g.detail.slice(0, 60)}`);
  }
  if (result.finalResult.narrowing?.resolutionHint) {
    console.log(`  │`);
    console.log(`  │ Narrowing: ${result.finalResult.narrowing.resolutionHint.slice(0, 80)}`);
  }
  console.log(`  └─────────────────────────────────────────────────────`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' @sovereign-labs/verify — Live Smoke Test');
  console.log(' Model: Gemini 2.0 Flash');
  console.log(' Demo app: fixtures/demo-app (Node.js HTTP server)');
  console.log('═══════════════════════════════════════════════════════');

  // Clean shared state from prior runs
  if (existsSync(SHARED_STATE_DIR)) {
    rmSync(SHARED_STATE_DIR, { recursive: true });
  }
  mkdirSync(SHARED_STATE_DIR, { recursive: true });

  const results: { name: string; goal: SmokeGoal; result: GovernResult }[] = [];

  for (const goalDef of GOALS) {
    console.log(`\n━━━ ${goalDef.name} ━━━`);
    console.log(`  Goal: "${goalDef.goal}"`);

    // Reset to clean state for each goal
    resetWorkDir();

    try {
      const result = await govern({
        appDir: WORK_DIR,
        goal: goalDef.goal,
        agent: geminiAgent,
        maxAttempts: 4,
        stateDir: SHARED_STATE_DIR,
        gates: {
          staging: false,   // No Docker for this demo
          browser: false,
          http: false,
          vision: false,
        },
        onAttempt: (attempt, verifyResult) => {
          const passed = verifyResult.gates.filter(g => g.passed).length;
          const total = verifyResult.gates.length;
          console.log(`    [Attempt ${attempt}] ${verifyResult.success ? 'PASS' : 'FAIL'} — ${passed}/${total} gates`);
          if (!verifyResult.success) {
            for (const g of verifyResult.gates.filter(g => !g.passed)) {
              console.log(`      ✗ ${g.gate}: ${g.detail.slice(0, 100)}`);
            }
          }
        },
      });

      printResult(goalDef.name, goalDef, result);
      results.push({ name: goalDef.name, goal: goalDef, result });

    } catch (e: any) {
      console.log(`  ❌ CRASHED: ${e.message}`);
      console.log(`     ${e.stack?.split('\n')[1] || ''}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════');

  let passed = 0;
  let totalAttempts = 0;
  let totalTime = 0;
  let totalConstraints = 0;

  for (const { name, result } of results) {
    const status = result.success ? '✅' : '❌';
    const time = (result.receipt.totalDurationMs / 1000).toFixed(1);
    console.log(`  ${status} ${name.padEnd(25)} ${result.attempts} attempt(s)  ${time}s  ${result.stopReason}`);
    if (result.success) passed++;
    totalAttempts += result.attempts;
    totalTime += result.receipt.totalDurationMs;
    totalConstraints += result.receipt.constraintsSeeded.length;
  }

  console.log(`\n  ${passed}/${results.length} converged | ${totalAttempts} total attempts | ${(totalTime / 1000).toFixed(1)}s | ${totalConstraints} constraints seeded`);

  // Cleanup
  if (existsSync(WORK_DIR)) {
    rmSync(WORK_DIR, { recursive: true });
  }
  if (existsSync(SHARED_STATE_DIR)) {
    rmSync(SHARED_STATE_DIR, { recursive: true });
  }

  console.log('\n═══════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
