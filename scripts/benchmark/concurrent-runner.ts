/**
 * Concurrent Runner — Parallel Multi-Model Evaluation
 * =====================================================
 *
 * Proves verify helps frontier LLMs on SWE problems by running:
 *   N tasks × M models × 2 paths (raw vs governed)
 * ...all with configurable concurrency.
 *
 * Key design decisions:
 *   - Each task gets an isolated app copy (no cross-contamination)
 *   - Raw and governed paths for the same task run in parallel
 *   - Multiple tasks run concurrently per model (bounded by semaphore)
 *   - Multiple models run concurrently (fully parallel)
 *   - Ground truth is independent of verify (no circular reasoning)
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { govern } from '../../src/govern.js';
import type { GovernAgent, GovernContext, AgentPlan } from '../../src/govern.js';
import { validateGroundTruth } from './ground-truth.js';
import type {
  BenchmarkTask, TaskComparison, BenchmarkSummary,
  RawRunResult, GovernedRunResult, LLMCallFn,
} from './types.js';
import type {
  ConcurrentConfig, ModelSpec, ModelEvalResult,
  CrossModelResult, ConcurrentEvalRun, EvalProgress,
} from './concurrent-types.js';

// =============================================================================
// SEMAPHORE — bounded concurrency
// =============================================================================

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.active++; resolve(); });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

// =============================================================================
// AGENT PROMPTS (shared with existing runner)
// =============================================================================

const AGENT_SYSTEM = `You are a coding agent. Given a goal and the app's source code, produce search/replace edits.

Rules:
1. "search" must be an EXACT substring in the file — copy verbatim
2. "search" must appear EXACTLY ONCE in the file
3. "replace" is what replaces it
4. Keep edits minimal
5. Include predicates that verify the goal was achieved

Respond with JSON only (no markdown):
{
  "edits": [{ "file": "path", "search": "exact", "replace": "new" }],
  "predicates": [{ "type": "content", "file": "path", "pattern": "expected text" }]
}`;

function buildAgentPrompt(
  task: BenchmarkTask,
  appDir: string,
  priorFailure?: string,
): string {
  const lines: string[] = [];
  lines.push(`Goal: ${task.goal}`);
  lines.push('');

  if (priorFailure) {
    lines.push('PREVIOUS ATTEMPT FAILED:');
    lines.push(priorFailure);
    lines.push('Fix the issue and try again.');
    lines.push('');
  }

  const sourceExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.sql']);
  const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', '.verify', 'coverage']);
  const { readdirSync, statSync } = require('fs');
  const path = require('path');

  function readDir(dir: string, prefix: string = ''): void {
    try {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const full = join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        const stat = statSync(full);
        if (stat.isDirectory()) readDir(full, rel);
        else if (sourceExts.has(path.extname(entry)) && stat.size < 20_000) {
          lines.push(`--- ${rel} ---`);
          lines.push(readFileSync(full, 'utf-8'));
          lines.push('');
        }
      }
    } catch { /* skip */ }
  }

  lines.push('Source files:');
  readDir(appDir);
  return lines.join('\n');
}

function parseLLMResponse(text: string): { edits: any[]; predicates: any[] } {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  try {
    const parsed = JSON.parse(cleaned);
    return {
      edits: Array.isArray(parsed.edits) ? parsed.edits : [],
      predicates: Array.isArray(parsed.predicates) ? parsed.predicates : [],
    };
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          edits: Array.isArray(parsed.edits) ? parsed.edits : [],
          predicates: Array.isArray(parsed.predicates) ? parsed.predicates : [],
        };
      } catch { /* fall through */ }
    }
    return { edits: [], predicates: [] };
  }
}

// =============================================================================
// ISOLATED COPY
// =============================================================================

function makeIsolatedCopy(appDir: string, label: string): string {
  const copyDir = join(tmpdir(), `verify-concurrent-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(copyDir, { recursive: true });
  cpSync(appDir, copyDir, { recursive: true });
  return copyDir;
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function emptyGroundTruth(): import('./types.js').GroundTruthResult {
  return {
    filesApplied: false,
    fileErrors: ['No edits to apply'],
    testsPass: null,
    testOutput: '',
    appStarts: true,
    startupError: '',
    contentPredicatesPass: false,
    predicateResults: [],
    goalAchieved: false,
  };
}

// =============================================================================
// RAW RUN (no verify)
// =============================================================================

async function runRaw(
  task: BenchmarkTask,
  llm: LLMCallFn,
): Promise<RawRunResult> {
  const start = Date.now();
  let totalInput = 0;
  let totalOutput = 0;
  let edits: any[] = [];
  let predicates: any[] = [];
  let agentError: string | null = null;

  try {
    const prompt = buildAgentPrompt(task, task.appDir);
    const response = await llm(AGENT_SYSTEM, prompt);
    totalInput += response.inputTokens;
    totalOutput += response.outputTokens;
    const parsed = parseLLMResponse(response.text);
    edits = parsed.edits;
    predicates = parsed.predicates;
  } catch (err: any) {
    agentError = err.message;
  }

  if (edits.length === 0 && !agentError) {
    return {
      edits: [],
      predicates: [],
      agentProducedEdits: false,
      agentError,
      groundTruth: emptyGroundTruth(),
      durationMs: Date.now() - start,
      tokens: { input: totalInput, output: totalOutput },
    };
  }

  const copyDir = makeIsolatedCopy(task.appDir, `raw-${task.id}`);
  try {
    for (const edit of edits) {
      const filePath = join(copyDir, edit.file);
      if (!existsSync(filePath)) continue;
      let content = readFileSync(filePath, 'utf-8');
      if (content.includes(edit.search)) {
        content = content.replace(edit.search, edit.replace);
        writeFileSync(filePath, content);
      }
    }
    const groundTruth = validateGroundTruth(copyDir, edits, predicates);
    return {
      edits,
      predicates,
      agentProducedEdits: true,
      agentError,
      groundTruth,
      durationMs: Date.now() - start,
      tokens: { input: totalInput, output: totalOutput },
    };
  } finally {
    cleanup(copyDir);
  }
}

// =============================================================================
// GOVERNED RUN (with verify)
// =============================================================================

async function runGoverned(
  task: BenchmarkTask,
  llm: LLMCallFn,
  maxAttempts: number,
): Promise<GovernedRunResult> {
  const start = Date.now();
  let totalInput = 0;
  let totalOutput = 0;
  let lastEdits: any[] = [];
  let lastPredicates: any[] = [];

  const copyDir = makeIsolatedCopy(task.appDir, `gov-${task.id}`);
  const govStateDir = join(copyDir, '.verify');
  mkdirSync(govStateDir, { recursive: true });

  try {
    const agent: GovernAgent = {
      plan: async (goal: string, ctx: GovernContext): Promise<AgentPlan> => {
        let priorFailure: string | undefined;
        if (ctx.priorResult && !ctx.priorResult.success) {
          const failedGate = ctx.priorResult.gates.find(g => !g.passed);
          priorFailure = failedGate
            ? `Gate "${failedGate.gate}" failed: ${failedGate.detail ?? 'unknown'}`
            : 'Unknown failure';
          if (ctx.narrowing?.resolutionHint) priorFailure += `\nHint: ${ctx.narrowing.resolutionHint}`;
          if (ctx.constraints.length > 0) {
            priorFailure += '\nConstraints: ' + ctx.constraints.map(c => c.reason).join('; ');
          }
        }

        const prompt = buildAgentPrompt(task, copyDir, priorFailure);
        const response = await llm(AGENT_SYSTEM, prompt);
        totalInput += response.inputTokens;
        totalOutput += response.outputTokens;

        const parsed = parseLLMResponse(response.text);
        lastEdits = parsed.edits;
        lastPredicates = parsed.predicates;
        return { edits: parsed.edits, predicates: parsed.predicates };
      },
    };

    const result = await govern({
      appDir: copyDir,
      goal: task.goal,
      agent,
      maxAttempts,
      stateDir: govStateDir,
      gates: {
        staging: false,
        browser: false,
        http: false,
        vision: false,
      },
    });

    const groundTruth = validateGroundTruth(copyDir, lastEdits, lastPredicates);

    return {
      edits: lastEdits,
      predicates: lastPredicates,
      attempts: result.attempts,
      stopReason: result.convergence.stopReason ?? 'exhausted',
      verifyPassed: result.success,
      agentError: null,
      groundTruth,
      durationMs: Date.now() - start,
      tokens: { input: totalInput, output: totalOutput },
    };
  } catch (err: any) {
    return {
      edits: lastEdits,
      predicates: lastPredicates,
      attempts: 0,
      stopReason: 'agent_error',
      verifyPassed: false,
      agentError: err.message,
      groundTruth: emptyGroundTruth(),
      durationMs: Date.now() - start,
      tokens: { input: totalInput, output: totalOutput },
    };
  } finally {
    cleanup(copyDir);
  }
}

// =============================================================================
// COMPARE
// =============================================================================

function compareResults(
  task: BenchmarkTask,
  raw: RawRunResult,
  governed: GovernedRunResult,
): TaskComparison {
  const rawOk = raw.groundTruth.goalAchieved;
  const govOk = governed.groundTruth.goalAchieved;

  let outcome: TaskComparison['verdict']['outcome'];
  if (!raw.agentProducedEdits && governed.edits.length === 0) outcome = 'both_no_edits';
  else if (!raw.agentProducedEdits) outcome = 'raw_no_edits';
  else if (governed.edits.length === 0) outcome = 'governed_no_edits';
  else if (!rawOk && govOk) outcome = 'verify_saved';
  else if (rawOk && govOk) outcome = 'both_succeeded';
  else if (!rawOk && !govOk) outcome = 'both_failed';
  else if (rawOk && !govOk) outcome = 'verify_regression';
  else outcome = 'verify_overhead';

  return {
    task,
    raw,
    governed,
    verdict: { rawAchieved: rawOk, governedAchieved: govOk, outcome },
  };
}

// =============================================================================
// SUMMARY (reused from existing benchmark)
// =============================================================================

function computeSummary(comparisons: TaskComparison[]): BenchmarkSummary {
  const total = comparisons.length;
  const rawAchieved = comparisons.filter(c => c.verdict.rawAchieved).length;
  const govAchieved = comparisons.filter(c => c.verdict.governedAchieved).length;
  const rawNoEdits = comparisons.filter(c => !c.raw.agentProducedEdits).length;
  const govNoEdits = comparisons.filter(c => c.governed.edits.length === 0).length;

  const rawTokens = comparisons.reduce((acc, c) => ({
    input: acc.input + c.raw.tokens.input,
    output: acc.output + c.raw.tokens.output,
  }), { input: 0, output: 0 });

  const govTokens = comparisons.reduce((acc, c) => ({
    input: acc.input + c.governed.tokens.input,
    output: acc.output + c.governed.tokens.output,
  }), { input: 0, output: 0 });

  const verifySaved = comparisons.filter(c => c.verdict.outcome === 'verify_saved').length;
  const bothSucceeded = comparisons.filter(c => c.verdict.outcome === 'both_succeeded').length;
  const bothFailed = comparisons.filter(c => c.verdict.outcome === 'both_failed').length;
  const verifyOverhead = comparisons.filter(c => c.verdict.outcome === 'verify_overhead').length;
  const verifyRegression = comparisons.filter(c => c.verdict.outcome === 'verify_regression').length;

  const rawRate = total > 0 ? rawAchieved / total : 0;
  const govRate = total > 0 ? govAchieved / total : 0;
  const improvement = rawRate > 0
    ? ((govRate - rawRate) / rawRate) * 100
    : govRate > 0 ? 100 : 0;

  return {
    totalTasks: total,
    raw: {
      goalsAchieved: rawAchieved,
      goalsFailed: total - rawAchieved - rawNoEdits,
      noEdits: rawNoEdits,
      successRate: rawRate,
      avgDurationMs: total > 0 ? comparisons.reduce((s, c) => s + c.raw.durationMs, 0) / total : 0,
      totalTokens: rawTokens,
    },
    governed: {
      goalsAchieved: govAchieved,
      goalsFailed: total - govAchieved - govNoEdits,
      noEdits: govNoEdits,
      successRate: govRate,
      avgAttempts: total > 0 ? comparisons.reduce((s, c) => s + c.governed.attempts, 0) / total : 0,
      avgDurationMs: total > 0 ? comparisons.reduce((s, c) => s + c.governed.durationMs, 0) / total : 0,
      totalTokens: govTokens,
    },
    headToHead: { verifySaved, bothSucceeded, bothFailed, verifyOverhead, verifyRegression },
    improvementPercent: improvement,
    netTasksSaved: verifySaved - verifyRegression,
  };
}

// =============================================================================
// GATE FAILURE DISTRIBUTION
// =============================================================================

function computeGateDistribution(comparisons: TaskComparison[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of comparisons) {
    if (c.governed.verifyPassed) continue;
    // Look at the governed run's verify result via the stop reason
    // The gate info is embedded in the governed result's attestation
    // We check which gate stopped the raw path by examining ground truth failures
    const govResult = c.governed as any;
    if (govResult.stopReason && govResult.stopReason !== 'converged') {
      dist[govResult.stopReason] = (dist[govResult.stopReason] || 0) + 1;
    }
  }
  return dist;
}

// =============================================================================
// EVALUATE ONE MODEL — all tasks, bounded concurrency
// =============================================================================

async function evaluateModel(
  model: ModelSpec,
  tasks: BenchmarkTask[],
  config: ConcurrentConfig,
  startTime: number,
): Promise<ModelEvalResult> {
  const modelStart = Date.now();
  const sem = new Semaphore(config.concurrency);
  const llm = model.llm!;
  let completed = 0;

  const comparisons = await Promise.all(
    tasks.map(task =>
      sem.run(async () => {
        // Run raw and governed in PARALLEL for this task
        const [raw, governed] = await Promise.all([
          runRaw(task, llm),
          runGoverned(task, llm, config.maxGovAttempts),
        ]);

        const comparison = compareResults(task, raw, governed);
        completed++;

        config.onProgress?.({
          modelName: model.name,
          taskId: task.id,
          outcome: comparison.verdict.outcome,
          completed,
          total: tasks.length,
          elapsedMs: Date.now() - startTime,
        });

        return comparison;
      })
    )
  );

  return {
    model,
    comparisons,
    summary: computeSummary(comparisons),
    wallClockMs: Date.now() - modelStart,
    gateFailureDistribution: computeGateDistribution(comparisons),
  };
}

// =============================================================================
// CROSS-MODEL ANALYSIS
// =============================================================================

function analyzeCrossModel(modelResults: ModelEvalResult[]): CrossModelResult {
  const improved: string[] = [];
  const regressed: string[] = [];
  const neutral: string[] = [];
  const improvements: number[] = [];

  for (const mr of modelResults) {
    const pct = mr.summary.improvementPercent;
    improvements.push(pct);
    if (pct > 0) improved.push(mr.model.name);
    else if (pct < 0) regressed.push(mr.model.name);
    else neutral.push(mr.model.name);
  }

  const avg = improvements.length > 0
    ? improvements.reduce((a, b) => a + b, 0) / improvements.length
    : 0;

  const sorted = [...improvements].sort((a, b) => a - b);
  const median = sorted.length > 0
    ? sorted.length % 2 === 1
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : 0;

  // Per-task consensus across models
  const taskIds = modelResults[0]?.comparisons.map(c => c.task.id) ?? [];
  const unanimousSaves: string[] = [];
  const unanimousRegressions: string[] = [];

  for (const tid of taskIds) {
    const outcomes = modelResults.map(mr =>
      mr.comparisons.find(c => c.task.id === tid)?.verdict.outcome
    );
    if (outcomes.every(o => o === 'verify_saved')) unanimousSaves.push(tid);
    if (outcomes.every(o => o === 'verify_regression')) unanimousRegressions.push(tid);
  }

  // Consistency: what fraction of models agree on the direction?
  const agreeing = improved.length >= regressed.length ? improved.length : regressed.length;
  const consistencyScore = modelResults.length > 0 ? agreeing / modelResults.length : 0;

  // Overall verdict
  let verdict: CrossModelResult['verdict'];
  if (avg > 5 && improved.length > regressed.length) verdict = 'verify_helps';
  else if (avg < -5 && regressed.length > improved.length) verdict = 'verify_hurts';
  else verdict = 'inconclusive';

  let headline: string;
  if (verdict === 'verify_helps') {
    headline = `Verify improved success rate by ${avg.toFixed(1)}% on average across ${modelResults.length} model(s). ${improved.length}/${modelResults.length} models improved.`;
  } else if (verdict === 'verify_hurts') {
    headline = `Verify decreased success rate by ${Math.abs(avg).toFixed(1)}% on average. ${regressed.length}/${modelResults.length} models regressed.`;
  } else {
    headline = `Results inconclusive: ${avg.toFixed(1)}% average change across ${modelResults.length} model(s).`;
  }

  return {
    models: modelResults,
    crossModel: {
      modelsImproved: improved,
      modelsRegressed: regressed,
      modelsNeutral: neutral,
      avgImprovementPercent: avg,
      medianImprovementPercent: median,
      unanimousSaves,
      unanimousRegressions,
      consistencyScore,
    },
    verdict,
    headline,
  };
}

// =============================================================================
// REPORT
// =============================================================================

function printConcurrentReport(run: ConcurrentEvalRun): void {
  const r = run.results;
  const div = '═'.repeat(70);

  console.log(`\n${div}`);
  console.log(`  CONCURRENT VERIFY EVALUATION`);
  console.log(`  ${run.taskCount} tasks × ${run.modelCount} models × 2 paths`);
  console.log(`  Concurrency: ${run.concurrency} | Wall clock: ${(run.totalWallClockMs / 1000).toFixed(1)}s`);
  console.log(div);

  // Per-model summaries
  for (const mr of r.models) {
    const s = mr.summary;
    console.log(`\n  ┌─ ${mr.model.name} (${mr.model.provider})`);
    console.log(`  │  Raw:      ${s.raw.goalsAchieved}/${s.totalTasks} (${(s.raw.successRate * 100).toFixed(1)}%)`);
    console.log(`  │  Governed: ${s.governed.goalsAchieved}/${s.totalTasks} (${(s.governed.successRate * 100).toFixed(1)}%)`);
    console.log(`  │  Δ: ${s.improvementPercent >= 0 ? '+' : ''}${s.improvementPercent.toFixed(1)}%  |  Saved: ${s.headToHead.verifySaved}  |  Regressed: ${s.headToHead.verifyRegression}`);
    console.log(`  │  Avg attempts: ${s.governed.avgAttempts.toFixed(1)}  |  Wall clock: ${(mr.wallClockMs / 1000).toFixed(1)}s`);
    console.log(`  │  Tokens: raw ${(s.raw.totalTokens.input + s.raw.totalTokens.output).toLocaleString()} → gov ${(s.governed.totalTokens.input + s.governed.totalTokens.output).toLocaleString()}`);

    if (Object.keys(mr.gateFailureDistribution).length > 0) {
      console.log(`  │  Gate failures: ${Object.entries(mr.gateFailureDistribution).map(([g, n]) => `${g}:${n}`).join(', ')}`);
    }
    console.log(`  └${'─'.repeat(68)}`);
  }

  // Cross-model summary
  if (r.models.length > 1) {
    const cm = r.crossModel;
    console.log(`\n  CROSS-MODEL ANALYSIS`);
    console.log(`  ${'─'.repeat(50)}`);
    console.log(`  Improved:  ${cm.modelsImproved.join(', ') || 'none'}`);
    console.log(`  Regressed: ${cm.modelsRegressed.join(', ') || 'none'}`);
    console.log(`  Neutral:   ${cm.modelsNeutral.join(', ') || 'none'}`);
    console.log(`  Avg improvement: ${cm.avgImprovementPercent >= 0 ? '+' : ''}${cm.avgImprovementPercent.toFixed(1)}%`);
    console.log(`  Median:          ${cm.medianImprovementPercent >= 0 ? '+' : ''}${cm.medianImprovementPercent.toFixed(1)}%`);
    console.log(`  Consistency:     ${(cm.consistencyScore * 100).toFixed(0)}%`);

    if (cm.unanimousSaves.length > 0) {
      console.log(`  Unanimous saves: ${cm.unanimousSaves.join(', ')}`);
    }
    if (cm.unanimousRegressions.length > 0) {
      console.log(`  Unanimous regressions: ${cm.unanimousRegressions.join(', ')}`);
    }
  }

  // Per-task breakdown
  console.log(`\n  PER-TASK RESULTS`);
  console.log(`  ${'─'.repeat(50)}`);

  const tasks = r.models[0]?.comparisons ?? [];
  for (const c of tasks) {
    const perModel = r.models.map(mr => {
      const mc = mr.comparisons.find(x => x.task.id === c.task.id);
      if (!mc) return '?';
      switch (mc.verdict.outcome) {
        case 'verify_saved': return '+';
        case 'both_succeeded': return '=';
        case 'both_failed': return 'x';
        case 'verify_regression': return '!';
        default: return '-';
      }
    });
    const models = r.models.length > 1 ? ` [${perModel.join('')}]` : '';
    const icon = perModel.includes('+') ? '+' : perModel.every(p => p === '=') ? '=' : perModel.every(p => p === 'x') ? 'x' : '-';
    console.log(`  [${icon}]${models} ${c.task.goal.slice(0, 55)}`);
  }

  // Verdict
  console.log(`\n${div}`);
  console.log(`  VERDICT: ${r.verdict.toUpperCase()}`);
  console.log(`  ${r.headline}`);
  console.log(`${div}\n`);
}

// =============================================================================
// PUBLIC API — runConcurrentEval
// =============================================================================

export async function runConcurrentEval(config: ConcurrentConfig): Promise<ConcurrentEvalRun> {
  const runId = `concurrent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  console.log(`\nConcurrent Verify Evaluation`);
  console.log(`Tasks: ${config.tasks.length} | Models: ${config.models.length} | Concurrency: ${config.concurrency}`);
  console.log(`${'─'.repeat(50)}`);

  // Evaluate all models concurrently
  const modelResults = await Promise.all(
    config.models.map(model =>
      evaluateModel(model, config.tasks, config, startTime)
    )
  );

  const crossModel = analyzeCrossModel(modelResults);
  const totalWallClockMs = Date.now() - startTime;

  const run: ConcurrentEvalRun = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    concurrency: config.concurrency,
    totalWallClockMs,
    results: crossModel,
    taskCount: config.tasks.length,
    modelCount: config.models.length,
  };

  // Print report
  printConcurrentReport(run);

  // Save results
  mkdirSync(config.stateDir, { recursive: true });
  const reportPath = join(config.stateDir, `concurrent-${runId}.json`);
  writeFileSync(reportPath, JSON.stringify(run, null, 2));
  console.log(`Full results saved to: ${reportPath}`);

  return run;
}
