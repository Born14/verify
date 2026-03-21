/**
 * Campaign Runner — Orchestrate Ground → Generate → Verify → Record
 * ==================================================================
 *
 * Stateless between runs. All state lives in:
 *   - Fault ledger (.verify/faults.jsonl)
 *   - Constraint store (.verify/memory.jsonl)
 *   - Campaign ledger (data/campaign-ledger.jsonl)
 */

import { join } from 'path';
import { appendFileSync, mkdirSync } from 'fs';
import { verify } from '../../src/verify.js';
import { groundInReality } from '../../src/gates/grounding.js';
import { FaultLedger } from '../../src/store/fault-ledger.js';
import { generateGoals } from './goal-generator.js';
import { generateEdits } from './edit-generator.js';
import { runCrossChecks } from './cross-check.js';
import { CLAUDE_GOAL_SYSTEM, CLAUDE_EDIT_SYSTEM } from './claude-brain.js';
import type { VerifyConfig, GroundingContext } from '../../src/types.js';
import type {
  CampaignConfig, CampaignResult, AppResult, GoalResult,
  AppEntry, GeneratedGoal, GeneratedSubmission, CrossCheckConfig,
} from './types.js';

// Gemini Flash pricing (approximate)
const COST_PER_1K_INPUT = 0.000075;  // $0.075 per 1M input tokens
const COST_PER_1K_OUTPUT = 0.0003;   // $0.30 per 1M output tokens

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT;
}

// =============================================================================
// RUNNER
// =============================================================================

/**
 * Run a full campaign: for each app, generate goals, generate edits,
 * run verify(), run cross-checks, record to fault ledger.
 */
export async function runCampaign(config: CampaignConfig): Promise<CampaignResult> {
  const runId = `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  let totalCostUsd = 0;

  const ledger = new FaultLedger(join(config.stateDir, 'faults.jsonl'));
  const campaignLedgerPath = join(config.stateDir, 'campaign-ledger.jsonl');
  mkdirSync(config.stateDir, { recursive: true });

  const appResults: AppResult[] = [];

  log(config, `\n═══ Campaign ${runId} ═══`);
  log(config, `Apps: ${config.apps.map(a => a.name).join(', ')}`);
  log(config, `Goals per app: ${config.goalsPerApp}`);
  log(config, `Dry run: ${config.dryRun}`);
  log(config, `Cross-check: ${config.crossCheckEnabled}\n`);

  for (const app of config.apps) {
    // Budget check
    if (totalCostUsd >= config.maxTotalCost) {
      log(config, `\n⚠ Budget cap reached ($${totalCostUsd.toFixed(4)} / $${config.maxTotalCost}). Stopping.`);
      break;
    }

    const appResult = await runAppCampaign(app, config, ledger, runId);
    appResults.push(appResult);
    totalCostUsd += appResult.costUsd;

    // Append to campaign ledger
    appendFileSync(campaignLedgerPath, JSON.stringify({
      runId,
      app: app.name,
      timestamp: new Date().toISOString(),
      ...summarizeAppResult(appResult),
    }) + '\n');
  }

  const result: CampaignResult = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    apps: appResults,
    totalFaults: appResults.reduce((sum, a) => sum + a.faults, 0),
    totalCostUsd,
    dryRun: config.dryRun,
  };

  log(config, `\n═══ Campaign Complete ═══`);
  log(config, `Total faults: ${result.totalFaults}`);
  log(config, `Total cost: $${result.totalCostUsd.toFixed(4)}`);

  return result;
}

// =============================================================================
// PER-APP CAMPAIGN
// =============================================================================

async function runAppCampaign(
  app: AppEntry,
  config: CampaignConfig,
  ledger: FaultLedger,
  runId: string,
): Promise<AppResult> {
  const appStart = Date.now();
  log(config, `\n── ${app.name} (${app.stackType}, ${app.complexity}) ──`);

  // Step 1: Ground
  log(config, `  [1/4] Grounding ${app.name}...`);
  let grounding: GroundingContext;
  try {
    grounding = groundInReality(app.appDir);
    log(config, `    Routes: ${grounding.routes.length}, CSS selectors: ${countSelectors(grounding)}`);
  } catch (err: any) {
    log(config, `    ✗ Grounding failed: ${err.message}`);
    return emptyAppResult(app, appStart);
  }

  // Step 2: Generate goals
  log(config, `  [2/4] Generating ${config.goalsPerApp} goals...`);
  let goals: GeneratedGoal[];
  let goalCost = 0;
  try {
    const goalSystemPrompt = config.llmName === 'claude' || config.llmName === 'claude-code' ? CLAUDE_GOAL_SYSTEM : undefined;
    const result = await generateGoals(
      grounding, app, config.goalsPerApp, config.llm, config.categories, goalSystemPrompt,
    );
    goals = result.goals;
    goalCost = estimateCost(result.cost.inputTokens, result.cost.outputTokens);
    log(config, `    Generated ${goals.length} goals ($${goalCost.toFixed(4)})`);
  } catch (err: any) {
    log(config, `    ✗ Goal generation failed: ${err.message}`);
    return emptyAppResult(app, appStart);
  }

  if (goals.length === 0) {
    log(config, `    ✗ No valid goals generated`);
    return emptyAppResult(app, appStart);
  }

  // Step 3-4: For each goal, generate edits and run verify
  const goalResults: GoalResult[] = [];
  let appCostUsd = goalCost;

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];

    // Budget check
    if (appCostUsd + goalCost >= config.maxTotalCost) {
      log(config, `  ⚠ Budget approaching cap. Stopping after ${i} goals.`);
      break;
    }

    const goalResult = await runGoal(
      goal, grounding, app, config, ledger, i + 1, goals.length,
    );
    goalResults.push(goalResult);
    appCostUsd += goalResult.costUsd;
  }

  const result: AppResult = {
    app: app.name,
    stackType: app.stackType,
    goals: goalResults,
    passed: goalResults.filter(g => g.verifyResult?.success).length,
    failed: goalResults.filter(g => g.verifyResult && !g.verifyResult.success).length,
    faults: goalResults.filter(g => g.faultId !== null).length,
    agentFaults: goalResults.filter(g => g.error || (g.submission && g.submission.edits.length === 0)).length,
    ambiguous: 0, // Will be counted from ledger
    correct: goalResults.filter(g => g.verifyResult?.success && !g.error).length,
    costUsd: appCostUsd,
    durationMs: Date.now() - appStart,
  };

  log(config, `\n  Results: ${result.passed} passed, ${result.failed} failed, ${result.faults} faults`);
  log(config, `  Cost: $${result.costUsd.toFixed(4)}, Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

  return result;
}

// =============================================================================
// PER-GOAL EXECUTION
// =============================================================================

async function runGoal(
  goal: GeneratedGoal,
  grounding: GroundingContext,
  app: AppEntry,
  config: CampaignConfig,
  ledger: FaultLedger,
  index: number,
  total: number,
): Promise<GoalResult> {
  const goalStart = Date.now();
  let costUsd = 0;

  log(config, `\n  [${index}/${total}] ${goal.goal.slice(0, 70)}${goal.goal.length > 70 ? '...' : ''}`);
  log(config, `    Category: ${goal.category}, Difficulty: ${goal.difficulty}, Gate: ${goal.targetGate ?? 'general'}`);

  // Step 3a: Generate edits
  let submission: GeneratedSubmission;
  try {
    const editSystemPrompt = config.llmName === 'claude' || config.llmName === 'claude-code' ? CLAUDE_EDIT_SYSTEM : undefined;
    const editResult = await generateEdits(goal, grounding, app.appDir, config.llm, editSystemPrompt);
    submission = editResult.submission;
    costUsd += estimateCost(editResult.cost.inputTokens, editResult.cost.outputTokens);
    log(config, `    Edits: ${submission.edits.length} edits, ${submission.predicates.length} predicates ($${costUsd.toFixed(4)})`);
  } catch (err: any) {
    log(config, `    ✗ Edit generation failed: ${err.message}`);
    return {
      goal,
      submission: null,
      verifyResult: null,
      crossCheck: null,
      faultId: null,
      costUsd,
      durationMs: Date.now() - goalStart,
      error: `Edit generation failed: ${err.message}`,
    };
  }

  if (submission.edits.length === 0) {
    log(config, `    ✗ No valid edits generated (agent fault)`);
    return {
      goal,
      submission,
      verifyResult: null,
      crossCheck: null,
      faultId: null,
      costUsd,
      durationMs: Date.now() - goalStart,
      error: 'No valid edits generated',
    };
  }

  // Dry run: stop here
  if (config.dryRun) {
    log(config, `    [DRY RUN] Would run verify() with ${submission.edits.length} edits`);
    for (const edit of submission.edits) {
      log(config, `      ${edit.file}: "${edit.search.slice(0, 40)}..." → "${edit.replace.slice(0, 40)}..."`);
    }
    return {
      goal,
      submission,
      verifyResult: null,
      crossCheck: null,
      faultId: null,
      costUsd,
      durationMs: Date.now() - goalStart,
    };
  }

  // Step 3b: Run verify()
  let verifyResult;
  try {
    const verifyConfig: VerifyConfig = {
      appDir: app.appDir,
      goal: goal.goal,
      stateDir: config.stateDir,
      docker: app.hasDocker ? {
        composefile: join(app.appDir, 'docker-compose.yml'),
        startupTimeoutMs: 30_000,
        buildTimeoutMs: 120_000,
      } : undefined,
      gates: {
        syntax: true,
        constraints: true,
        containment: true,
        staging: app.hasDocker,
        browser: app.hasDocker && app.hasPlaywright,
        http: app.hasDocker,
        invariants: app.hasDocker,
        vision: false, // Vision costs extra, skip in campaigns
      },
    };

    verifyResult = await verify(submission.edits, submission.predicates, verifyConfig);
    const verdict = verifyResult.success ? '✓ PASS' : `✗ FAIL (${verifyResult.gates.find(g => !g.passed)?.gate ?? 'unknown'})`;
    log(config, `    Verify: ${verdict} (${verifyResult.timing.totalMs}ms)`);
  } catch (err: any) {
    log(config, `    ✗ verify() threw: ${err.message}`);
    return {
      goal,
      submission,
      verifyResult: null,
      crossCheck: null,
      faultId: null,
      costUsd,
      durationMs: Date.now() - goalStart,
      error: `verify() threw: ${err.message}`,
    };
  }

  // Step 3c: Run cross-checks
  let crossCheck = null;
  if (config.crossCheckEnabled && app.hasDocker) {
    try {
      // Determine the staging container URL
      // verify() runs staging internally — cross-checks probe the same container
      // For now, use a convention-based port
      const port = 13000 + Math.abs(hashCode(goal.goal)) % 1000;
      const appUrl = `http://localhost:${port}`;

      const crossCheckConfig: CrossCheckConfig = {
        timeout: 10_000,
        health: true,
        browser: false, // Skip Playwright in cross-check for now
        http: submission.predicates.some(p => p.type === 'http' || p.type === 'http_sequence'),
      };

      crossCheck = await runCrossChecks(appUrl, submission.predicates, crossCheckConfig);
      log(config, `    Cross-check: health=${crossCheck.healthProbe?.ok ?? 'skipped'}`);
    } catch (err: any) {
      log(config, `    Cross-check failed: ${err.message}`);
    }
  }

  // Step 3d: Record to fault ledger
  let faultId: string | null = null;
  const faultEntry = ledger.recordFromResult(verifyResult, {
    app: app.name,
    goal: goal.goal,
    predicates: submission.predicates,
    crossCheck: crossCheck ?? undefined,
  });

  if (faultEntry) {
    faultId = faultEntry.id;
    if (faultEntry.classification !== 'correct' && faultEntry.classification !== 'agent_fault') {
      log(config, `    📋 Fault recorded: ${faultEntry.id} (${faultEntry.classification}, ${faultEntry.confidence})`);
    }
  }

  return {
    goal,
    submission,
    verifyResult,
    crossCheck,
    faultId,
    costUsd,
    durationMs: Date.now() - goalStart,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function log(config: CampaignConfig, msg: string): void {
  if (config.verbose || !msg.startsWith('    ')) {
    console.log(msg);
  }
}

function countSelectors(grounding: GroundingContext): number {
  let count = 0;
  for (const [, selectorMap] of grounding.routeCSSMap) {
    count += selectorMap.size;
  }
  return count;
}

function emptyAppResult(app: AppEntry, startTime: number): AppResult {
  return {
    app: app.name,
    stackType: app.stackType,
    goals: [],
    passed: 0,
    failed: 0,
    faults: 0,
    agentFaults: 0,
    ambiguous: 0,
    correct: 0,
    costUsd: 0,
    durationMs: Date.now() - startTime,
  };
}

function summarizeAppResult(r: AppResult): Record<string, unknown> {
  return {
    goals: r.goals.length,
    passed: r.passed,
    failed: r.failed,
    faults: r.faults,
    agentFaults: r.agentFaults,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
  };
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
