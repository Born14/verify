#!/usr/bin/env bun
/**
 * Live Governed Smoke Test — Gemini + Sovereign Daemon (Football App)
 * ===================================================================
 *
 * Fires real goals through the full governed pipeline on the Lenovo:
 *   Gemini plans → sovereign_submit → F9 → K5 → G5 → Staging → Deploy → O.5b → Checkpoint
 *
 * This is the real thing. Docker builds, Playwright browser gate, post-deploy evidence.
 * Not mocked. Not local. The agent plans, Sovereign judges.
 *
 * Usage:
 *   GEMINI_API_KEY=... bun run scripts/harness/live-governed.ts
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY required');
  process.exit(1);
}

const DAEMON_URL = process.env.DAEMON_URL || 'https://sovereign.vibestarter.net';
const GEMINI_MODEL = 'gemini-2.0-flash';
const APP = 'football';

// ---------------------------------------------------------------------------
// Daemon API helpers
// ---------------------------------------------------------------------------

async function daemonFetch(path: string, opts?: RequestInit): Promise<any> {
  const url = `${DAEMON_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    signal: AbortSignal.timeout(300_000), // 5 min for staging + deploy
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

async function getGrounding(): Promise<any> {
  return daemonFetch(`/agent/ground/${APP}`);
}

async function readFile(path: string): Promise<string> {
  // Use the MCP endpoint to read files via the daemon
  const res = await fetch(`${DAEMON_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'sovereign_read_file',
        arguments: { app: APP, path },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as any;
  return json?.result?.content?.[0]?.text || '';
}

async function submit(goal: string, edits: any[], predicates: any[]): Promise<any> {
  return daemonFetch('/agent/submit', {
    method: 'POST',
    body: JSON.stringify({ app: APP, goal, edits, predicates }),
  });
}

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

function buildSystemPrompt(grounding: string): string {
  return `You are a coding agent. You receive a goal and context about a deployed Node.js web app.
You must return a JSON object with:
- "edits": array of { "file": string, "search": string, "replace": string }
- "predicates": array of predicate objects

The app is a Node.js HTTP server (server.js) with ALL HTML and CSS inline as template literals.
Routes: / (homepage), /roster (player list), /playbook, /stats, /health, /api/players, /api/stats

CRITICAL RULES:
1. The search string MUST be copied EXACTLY from the source file. Character-for-character. If you can't find it in the SOURCE section below, don't use it.
2. CSS lives in <style> blocks inside template literals, NOT as inline styles on elements. To change a CSS property, edit the <style> block.
3. For CSS predicates: the expected value should be what it will be AFTER your edit (e.g., if changing "black" to "orange", expected should be "orange"). Use rgb() format for colors when possible.
4. To change text content, find the EXACT HTML snippet in the source and replace it.
5. Keep edits minimal — change only what's needed.
6. Each search string must appear EXACTLY ONCE in the file. If it appears multiple times, include more surrounding context to disambiguate.
7. Return ONLY valid JSON. No markdown fences. No explanation.

PREDICATE TYPES:
- CSS: { "type": "css", "selector": ".class", "property": "color", "expected": "orange", "path": "/" }
- Content: { "type": "content", "file": "server.js", "pattern": "exact text to find" }
- HTTP: { "type": "http", "path": "/health", "method": "GET", "expect": { "status": 200 } }
- HTML: { "type": "html", "selector": "h1", "expected": "exists", "path": "/" }

GROUNDING (what actually exists in the app):
${grounding}`;
}

function buildUserPrompt(goal: string, source: string, priorResult?: any): string {
  const parts: string[] = [];
  parts.push(`GOAL: ${goal}`);

  if (priorResult && !priorResult.success) {
    parts.push('\nPREVIOUS ATTEMPT FAILED:');
    for (const g of priorResult.gates || []) {
      if (!g.passed) {
        parts.push(`  ${g.gate}: ${g.detail}`);
      }
    }
    if (priorResult.narrowing?.resolutionHint) {
      parts.push(`\nHINT: ${priorResult.narrowing.resolutionHint}`);
    }
    if (priorResult.narrowing?.fileEvidence) {
      parts.push(`\nEVIDENCE: ${priorResult.narrowing.fileEvidence}`);
    }
    if (priorResult.narrowing?.matchedBannedFingerprints?.length) {
      parts.push(`\nBANNED (don't repeat): ${priorResult.narrowing.matchedBannedFingerprints.join(', ')}`);
    }
  }

  parts.push(`\nFULL SOURCE (server.js):\n${source}`);
  return parts.join('\n');
}

function parseResponse(raw: string): { edits: any[]; predicates: any[] } {
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
    console.log('    ⚠ Failed to parse LLM response');
    return { edits: [], predicates: [] };
  }
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

interface GovernedGoal {
  name: string;
  goal: string;
  difficulty: string;
  maxAttempts: number;
}

const GOALS: GovernedGoal[] = [
  {
    name: '1. CSS Color Change',
    goal: 'Change the roster link color on the homepage from black to #e74c3c (red)',
    difficulty: 'Easy — single CSS property, known selector',
    maxAttempts: 3,
  },
  {
    name: '2. Content Edit',
    goal: 'Change the footer text from "Powered by Sovereign" to "Powered by Sovereign ⚽"',
    difficulty: 'Medium — text replacement, appears on multiple routes',
    maxAttempts: 3,
  },
  {
    name: '3. Stats Page Styling',
    goal: 'Change the stat numbers on the /stats page from black to #2ecc71 (green)',
    difficulty: 'Medium — must target correct route and selector',
    maxAttempts: 3,
  },
  {
    name: '4. Multi-Property Change',
    goal: 'Make the homepage h1 red and uppercase',
    difficulty: 'Hard — two CSS properties on one selector, "color" exists but "text-transform" is new',
    maxAttempts: 4,
  },
  {
    name: '5. API Response Change',
    goal: 'Add a "version" field with value "2.0" to the /health endpoint JSON response',
    difficulty: 'Hard — edit JSON response, verify with HTTP predicate',
    maxAttempts: 3,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface GoalResult {
  name: string;
  goal: GovernedGoal;
  success: boolean;
  attempts: number;
  totalMs: number;
  gates: any[];
  checkpointId?: string;
}

async function runGoal(goalDef: GovernedGoal): Promise<GoalResult> {
  console.log(`\n━━━ ${goalDef.name} ━━━`);
  console.log(`  Goal: "${goalDef.goal}"`);
  console.log(`  ${goalDef.difficulty}`);

  const startMs = Date.now();

  // Get grounding + source
  const grounding = await getGrounding();
  const source = await readFile('server.js');

  if (!source || source.length < 100) {
    console.log('  ❌ Could not read server.js from daemon');
    return { name: goalDef.name, goal: goalDef, success: false, attempts: 0, totalMs: 0, gates: [] };
  }

  const systemPrompt = buildSystemPrompt(grounding.grounding || '');
  let priorResult: any = null;

  for (let attempt = 1; attempt <= goalDef.maxAttempts; attempt++) {
    console.log(`\n  [Attempt ${attempt}/${goalDef.maxAttempts}]`);

    // Re-read source on retry (edits may have been applied and rolled back)
    const currentSource = attempt > 1 ? await readFile('server.js') : source;
    const userPrompt = buildUserPrompt(goalDef.goal, currentSource, priorResult);

    // Plan with Gemini
    console.log(`    [Gemini] Planning...`);
    const raw = await callGemini(systemPrompt, userPrompt);
    const plan = parseResponse(raw);
    console.log(`    [Gemini] ${plan.edits.length} edits, ${plan.predicates.length} predicates`);

    for (const e of plan.edits) {
      const sp = e.search.slice(0, 60).replace(/\n/g, '\\n');
      const rp = e.replace.slice(0, 60).replace(/\n/g, '\\n');
      console.log(`      edit: ${e.file} "${sp}" → "${rp}"`);
    }
    for (const p of plan.predicates) {
      const desc = p.type === 'css' ? `${p.selector} ${p.property} == ${p.expected}`
        : p.type === 'content' ? `"${(p.pattern || '').slice(0, 40)}"`
        : p.type === 'http' ? `${p.method || 'GET'} ${p.path} → ${p.expect?.status || '?'}`
        : JSON.stringify(p).slice(0, 60);
      console.log(`      pred: [${p.type}] ${desc}`);
    }

    if (plan.edits.length === 0) {
      console.log('    ⚠ Empty plan — skipping submission');
      continue;
    }

    // Submit through governed pipeline
    console.log(`    [Submit] Sending to daemon...`);
    const submitStart = Date.now();
    const result = await submit(goalDef.goal, plan.edits, plan.predicates);
    const submitMs = Date.now() - submitStart;

    if (result.success) {
      console.log(`    ✅ CONVERGED in ${(submitMs / 1000).toFixed(1)}s`);
      printGates(result.gates);
      return {
        name: goalDef.name,
        goal: goalDef,
        success: true,
        attempts: attempt,
        totalMs: Date.now() - startMs,
        gates: result.gates || [],
        checkpointId: result.checkpointId,
      };
    } else {
      console.log(`    ❌ FAILED in ${(submitMs / 1000).toFixed(1)}s`);
      printGates(result.gates);
      if (result.narrowing?.resolutionHint) {
        console.log(`    Hint: ${result.narrowing.resolutionHint.slice(0, 100)}`);
      }
      priorResult = result;
    }
  }

  return {
    name: goalDef.name,
    goal: goalDef,
    success: false,
    attempts: goalDef.maxAttempts,
    totalMs: Date.now() - startMs,
    gates: priorResult?.gates || [],
  };
}

function printGates(gates: any[]) {
  for (const g of gates || []) {
    const icon = g.passed ? '✓' : '✗';
    const time = `${g.durationMs}ms`;
    console.log(`      ${icon} ${g.gate.padEnd(16)} ${time.padStart(8)}  ${(g.detail || '').slice(0, 70)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(' @sovereign-labs/verify — Live Governed Smoke Test');
  console.log(` Model: Gemini 2.0 Flash → ${DAEMON_URL}`);
  console.log(` App: ${APP} (real Docker staging + Playwright + O.5b)`);
  console.log('═══════════════════════════════════════════════════════');

  // Verify daemon is reachable
  const health = await daemonFetch('/health');
  if (health.status !== 'ok') {
    console.error('Daemon not healthy:', health);
    process.exit(1);
  }
  console.log(`  Daemon: ${health.status} (uptime: ${(health.uptime / 60).toFixed(0)}m)`);

  const results: GoalResult[] = [];

  for (const goalDef of GOALS) {
    try {
      const result = await runGoal(goalDef);
      results.push(result);
    } catch (e: any) {
      console.log(`  ❌ CRASHED: ${e.message}`);
      results.push({
        name: goalDef.name,
        goal: goalDef,
        success: false,
        attempts: 0,
        totalMs: 0,
        gates: [],
      });
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

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const time = (r.totalMs / 1000).toFixed(1);
    const cp = r.checkpointId ? ` (${r.checkpointId})` : '';
    console.log(`  ${status} ${r.name.padEnd(28)} ${r.attempts} attempt(s)  ${time.padStart(6)}s${cp}`);
    if (r.success) passed++;
    totalAttempts += r.attempts;
    totalTime += r.totalMs;
  }

  console.log(`\n  ${passed}/${results.length} converged | ${totalAttempts} total attempts | ${(totalTime / 1000).toFixed(1)}s total`);
  console.log('\n═══════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
