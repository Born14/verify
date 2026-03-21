/**
 * Campaign Report — Morning Summary
 * ===================================
 *
 * Generates both JSON (machine-readable) and formatted console (human-readable)
 * reports from campaign results. Designed for 2-5 minute morning triage.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { CampaignResult, MorningReport } from './types.js';
import type { FaultEntry } from '../../src/store/fault-ledger.js';
import { FaultLedger } from '../../src/store/fault-ledger.js';

// =============================================================================
// REPORT GENERATION
// =============================================================================

/**
 * Generate a morning report from campaign results.
 */
export function generateReport(result: CampaignResult, stateDir: string): MorningReport {
  const ledger = new FaultLedger(join(stateDir, 'faults.jsonl'));
  const summary = ledger.summarize();

  const durationMs = new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime();

  const report: MorningReport = {
    runId: result.runId,
    timestamp: result.completedAt,
    summary: buildSummaryLine(result, summary),
    faults: {
      total: result.totalFaults,
      falsePositives: summary.byClassification.false_positive,
      falseNegatives: summary.byClassification.false_negative,
      badHints: summary.byClassification.bad_hint,
      ambiguous: summary.byClassification.ambiguous,
      agentFaults: summary.byClassification.agent_fault,
      correct: summary.byClassification.correct,
    },
    perApp: result.apps.map(app => ({
      app: app.app,
      stackType: app.stackType,
      goalsRun: app.goals.length,
      faultsFound: app.faults,
      worstFault: findWorstFault(app.app, ledger),
    })),
    costUsd: result.totalCostUsd,
    durationMin: Math.round(durationMs / 60_000),
  };

  return report;
}

/**
 * Save report to disk as JSON.
 */
export function saveReport(report: MorningReport, stateDir: string): string {
  const reportsDir = join(stateDir, 'campaign-reports');
  mkdirSync(reportsDir, { recursive: true });
  const filename = `${report.runId}.json`;
  const filepath = join(reportsDir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2) + '\n');
  return filepath;
}

/**
 * Load the most recent campaign report.
 */
export function loadLatestReport(stateDir: string): MorningReport | null {
  const reportsDir = join(stateDir, 'campaign-reports');
  if (!existsSync(reportsDir)) return null;

  const files = readdirSync(reportsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(readFileSync(join(reportsDir, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

// =============================================================================
// FORMATTED OUTPUT
// =============================================================================

/**
 * Format a morning report for console output.
 */
export function formatReport(report: MorningReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                  CAMPAIGN MORNING REPORT                    ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Run: ${report.runId}`);
  lines.push(`  Time: ${report.timestamp}`);
  lines.push(`  Duration: ${report.durationMin} min`);
  lines.push(`  Cost: $${report.costUsd.toFixed(4)}`);
  lines.push('');

  // Summary line
  lines.push(`  ${report.summary}`);
  lines.push('');

  // Fault breakdown
  lines.push('  Faults:');
  if (report.faults.total === 0) {
    lines.push('    No faults detected. All verify verdicts confirmed by cross-checks.');
  } else {
    if (report.faults.falsePositives > 0)
      lines.push(`    ✗ False positives:  ${report.faults.falsePositives}  (verify PASS but app broken)`);
    if (report.faults.falseNegatives > 0)
      lines.push(`    ✗ False negatives:  ${report.faults.falseNegatives}  (verify FAIL but edit correct)`);
    if (report.faults.badHints > 0)
      lines.push(`    ~ Bad hints:        ${report.faults.badHints}  (narrowing sent wrong direction)`);
    if (report.faults.ambiguous > 0)
      lines.push(`    ? Ambiguous:        ${report.faults.ambiguous}  (needs human review)`);
    if (report.faults.agentFaults > 0)
      lines.push(`    · Agent faults:     ${report.faults.agentFaults}  (LLM error, not verify bug)`);
    if (report.faults.correct > 0)
      lines.push(`    ✓ Correct:          ${report.faults.correct}  (verify was right)`);
  }
  lines.push('');

  // Per-app breakdown
  lines.push('  Per-App:');
  for (const app of report.perApp) {
    const faultStr = app.faultsFound > 0 ? ` — ${app.faultsFound} faults` : '';
    lines.push(`    ${app.app} (${app.stackType}): ${app.goalsRun} goals${faultStr}`);
    if (app.worstFault) {
      lines.push(`      Worst: ${app.worstFault}`);
    }
  }
  lines.push('');

  // Action items
  const verifyBugs = report.faults.falsePositives + report.faults.falseNegatives + report.faults.badHints;
  if (verifyBugs > 0 || report.faults.ambiguous > 0) {
    lines.push('  Action Items:');
    if (verifyBugs > 0) {
      lines.push(`    1. Review ${verifyBugs} verify bug(s): npx @sovereign-labs/verify faults inbox`);
      lines.push(`    2. Encode as scenarios and run improve loop`);
    }
    if (report.faults.ambiguous > 0) {
      lines.push(`    ${verifyBugs > 0 ? '3' : '1'}. Classify ${report.faults.ambiguous} ambiguous fault(s): npx @sovereign-labs/verify faults review`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// HELPERS
// =============================================================================

function buildSummaryLine(result: CampaignResult, summary: ReturnType<FaultLedger['summarize']>): string {
  const totalGoals = result.apps.reduce((sum, a) => sum + a.goals.length, 0);
  const verifyBugs = summary.byClassification.false_positive +
    summary.byClassification.false_negative +
    summary.byClassification.bad_hint;

  if (verifyBugs === 0) {
    return `${totalGoals} goals across ${result.apps.length} app(s). No verify bugs found. Cost: $${result.totalCostUsd.toFixed(4)}`;
  }

  return `${totalGoals} goals across ${result.apps.length} app(s). ${verifyBugs} verify bug(s) found. Cost: $${result.totalCostUsd.toFixed(4)}`;
}

function findWorstFault(appName: string, ledger: FaultLedger): string {
  const appFaults = ledger.getByApp(appName);
  const verifyBugs = appFaults.filter(f =>
    f.classification === 'false_positive' ||
    f.classification === 'false_negative' ||
    f.classification === 'bad_hint'
  );

  if (verifyBugs.length === 0) return '';

  // Prioritize: false_positive > false_negative > bad_hint
  const worst = verifyBugs.sort((a, b) => {
    const priority: Record<string, number> = { false_positive: 0, false_negative: 1, bad_hint: 2 };
    return (priority[a.classification] ?? 3) - (priority[b.classification] ?? 3);
  })[0];

  return `${worst.classification}: ${worst.reason.slice(0, 80)}`;
}
