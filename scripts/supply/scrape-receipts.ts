#!/usr/bin/env node
/**
 * Receipt Scraper — Production Failures → Verify Scenarios
 * ==========================================================
 *
 * Reads MCP proxy receipt ledgers (.governance/receipts.jsonl) and extracts
 * failed tool calls into verify scenarios. Each failed sovereign_submit
 * receipt becomes a scenario that tests whether verify catches the same
 * failure class.
 *
 * Sources:
 *   - .governance-sovereign/receipts.jsonl (governed relay receipts)
 *   - Any path passed via --receipts-path or RECEIPTS_PATH env var
 *
 * Usage:
 *   bun run scripts/supply/scrape-receipts.ts [options]
 *
 * Options:
 *   --receipts-path=PATH   Path to receipts.jsonl (or RECEIPTS_PATH env)
 *   --max-scenarios=50     Maximum scenarios to extract (default: 50)
 *   --since=2026-03-01     Only process receipts after this date
 *   --dry-run              Print extracted scenarios, don't write
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real MCP proxy receipt format (from @sovereign-labs/mcp-proxy).
 * Key differences from initial assumptions:
 *   - timestamp is epoch ms (number), not ISO string
 *   - submission data lives in `arguments`, not `args`
 *   - outcome is top-level `outcome: "success"|"error"`, not nested `result.success`
 *   - gate data is NOT in the receipt — proxy records what was sent, not daemon response
 *   - `error` at top level contains the failure reason string
 */
interface Receipt {
  id: string;
  seq: number;
  timestamp: number;
  controllerId: string;
  authorityEpoch: number;
  enforcement: string;
  toolName: string;
  arguments: Record<string, any>;
  target?: string;
  constraintCheck?: { passed: boolean };
  authorityCheck?: { passed: boolean };
  outcome: 'success' | 'error';
  error?: string;
  durationMs: number;
  mutationType?: 'mutating' | 'readonly';
  mutation?: Record<string, any>;
  hash?: string;
  previousHash?: string;
}

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  sourceReceipt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseReceipts(path: string, since?: string): Receipt[] {
  if (!existsSync(path)) {
    console.log(`  Receipt file not found: ${path}`);
    return [];
  }

  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
  const receipts: Receipt[] = [];

  const sinceMs = since ? new Date(since).getTime() : 0;

  for (const line of lines) {
    try {
      const receipt = JSON.parse(line) as Receipt;
      if (sinceMs && receipt.timestamp < sinceMs) continue;
      receipts.push(receipt);
    } catch { /* skip malformed lines */ }
  }

  return receipts;
}

/**
 * Extract failed sovereign_submit receipts into verify scenarios.
 *
 * Real receipt structure:
 *   - outcome: "error" at top level (not nested result.success)
 *   - error: string describing what went wrong
 *   - arguments: { app, goal, edits, predicates } — the submission payload
 *   - Gate data is NOT in the receipt (proxy records request, not daemon response)
 *
 * We extract the edits + predicates as-is, and classify the failure from
 * the error string and constraint check.
 */
function extractSubmissionFailures(receipts: Receipt[]): Scenario[] {
  const scenarios: Scenario[] = [];

  const submissions = receipts.filter(r =>
    r.toolName === 'sovereign_submit' &&
    r.outcome === 'error'
  );

  for (const receipt of submissions) {
    const args = receipt.arguments || {};
    const error = receipt.error || 'unknown error';

    // Map receipt data to scenario format
    const edits = (args.edits || []).map((e: any) => ({
      file: e.file || 'server.js',
      search: e.search || '',
      replace: e.replace || '',
    }));

    const predicates = (args.predicates || []).map((p: any) => ({ ...p }));

    if (predicates.length === 0) continue;

    // Classify the failure from error string
    const failureClass = classifyReceiptError(error);
    const constraintFailed = receipt.constraintCheck && !receipt.constraintCheck.passed;

    const tags = ['receipt', `failure_${failureClass}`];
    if (constraintFailed) tags.push('constraint_blocked');

    scenarios.push({
      id: `receipt-${failureClass}-${receipt.id.replace(/^r_/, '')}`,
      description: `[RECEIPT] ${args.goal || 'Unknown goal'} — ${failureClass}: ${error.substring(0, 100)}`,
      edits,
      predicates,
      expectedSuccess: false,
      tags,
      rationale: `Extracted from production receipt ${receipt.id}. Error: ${error.substring(0, 200)}`,
      sourceReceipt: receipt.id,
    });
  }

  return scenarios;
}

/**
 * Classify receipt error strings into failure categories.
 * Mirrors the K5 failure signature taxonomy in verify.
 */
function classifyReceiptError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('524') || lower.includes('non-json')) return 'gateway_error';
  if (lower.includes('constraint') || lower.includes('k5')) return 'constraint_violation';
  if (lower.includes('syntax')) return 'syntax_error';
  if (lower.includes('staging')) return 'staging_failure';
  if (lower.includes('predicate') || lower.includes('evidence')) return 'predicate_mismatch';
  if (lower.includes('build')) return 'build_failure';
  if (lower.includes('health')) return 'health_check_failure';
  if (lower.includes('parse') || lower.includes('json')) return 'parse_error';
  return 'unknown';
}

/**
 * Extract failed tool calls (non-submit) that reveal runtime failures.
 * These become scenarios that test whether verify's error handling is correct.
 */
function extractToolFailures(receipts: Receipt[]): Scenario[] {
  const scenarios: Scenario[] = [];

  const failures = receipts.filter(r =>
    r.toolName?.startsWith('sovereign_') &&
    r.toolName !== 'sovereign_submit' &&
    r.mutationType === 'mutating' &&
    r.outcome === 'error' &&
    r.error
  );

  for (const receipt of failures) {
    const error = receipt.error || '';

    // Create a regression guard — verify should handle this error gracefully
    scenarios.push({
      id: `receipt-tool-${receipt.toolName}-${receipt.id.replace(/^r_/, '')}`,
      description: `[RECEIPT:tool] ${receipt.toolName} failed: ${error.substring(0, 100)}`,
      edits: [],
      predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
      expectedSuccess: true,
      tags: ['receipt', 'tool_failure', `tool_${receipt.toolName}`, 'regression_guard'],
      rationale: `Tool ${receipt.toolName} failed in production. Error: ${error.substring(0, 200)}. This scenario guards against verify crashing on similar inputs.`,
      sourceReceipt: receipt.id,
    });
  }

  return scenarios;
}

/**
 * Extract successful sovereign_submit receipts as "golden" scenarios.
 * These are known-good submissions that verify should pass cleanly.
 * Limited to a sample (max 10) to avoid bloating the scenario file.
 */
function extractSuccessfulSubmissions(receipts: Receipt[]): Scenario[] {
  const scenarios: Scenario[] = [];

  const successes = receipts.filter(r =>
    r.toolName === 'sovereign_submit' &&
    r.outcome === 'success'
  );

  // Sample up to 10 golden scenarios — we want regression coverage, not bulk
  const sampled = successes.slice(-10);

  for (const receipt of sampled) {
    const args = receipt.arguments || {};

    const edits = (args.edits || []).map((e: any) => ({
      file: e.file || 'server.js',
      search: e.search || '',
      replace: e.replace || '',
    }));

    const predicates = (args.predicates || []).map((p: any) => ({ ...p }));

    if (predicates.length === 0 || edits.length === 0) continue;

    scenarios.push({
      id: `receipt-golden-${receipt.id.replace(/^r_/, '')}`,
      description: `[RECEIPT:golden] ${args.goal || 'Unknown goal'} — successful production submission`,
      edits,
      predicates,
      expectedSuccess: true,
      tags: ['receipt', 'golden', 'regression_guard'],
      rationale: `Successful production submission. Duration: ${receipt.durationMs}ms. This scenario ensures verify continues to pass known-good submissions.`,
      sourceReceipt: receipt.id,
    });
  }

  return scenarios;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const maxScenarios = parseInt(args.find(a => a.startsWith('--max-scenarios='))?.split('=')[1] ?? '50');
const since = args.find(a => a.startsWith('--since='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const pkgRoot = resolve(import.meta.dir, '..', '..');

// Find receipt files
const receiptsPath = args.find(a => a.startsWith('--receipts-path='))?.split('=')[1]
  || process.env.RECEIPTS_PATH
  || null;

const defaultPaths = [
  join(pkgRoot, '.governance-sovereign', 'receipts.jsonl'),
  join(pkgRoot, '..', '..', '.governance-sovereign', 'receipts.jsonl'),
];

const receiptPaths = receiptsPath ? [receiptsPath] : defaultPaths.filter(p => existsSync(p));

console.log(`\n═══ Receipt Scraper ═══`);
console.log(`Max scenarios: ${maxScenarios}`);
console.log(`Since: ${since || 'all time'}`);
console.log(`Receipt sources: ${receiptPaths.length > 0 ? receiptPaths.join(', ') : 'none found'}`);
console.log(`Dry run: ${dryRun}\n`);

if (receiptPaths.length === 0) {
  console.log('No receipt files found. Skipping receipt scraping.');
  console.log('Hint: Set RECEIPTS_PATH or --receipts-path to point to a receipts.jsonl file.\n');
  process.exit(0);
}

// Parse all receipts
let allReceipts: Receipt[] = [];
for (const path of receiptPaths) {
  const receipts = parseReceipts(path, since);
  console.log(`  ${path}: ${receipts.length} receipts`);
  allReceipts.push(...receipts);
}

console.log(`Total receipts: ${allReceipts.length}`);

// Extract scenarios
const submissionScenarios = extractSubmissionFailures(allReceipts);
const goldenScenarios = extractSuccessfulSubmissions(allReceipts);
const toolScenarios = extractToolFailures(allReceipts);
const allScenarios = [...submissionScenarios, ...goldenScenarios, ...toolScenarios].slice(0, maxScenarios);

console.log(`\nExtracted ${allScenarios.length} scenarios:`);
console.log(`  Submission failures: ${submissionScenarios.length}`);
console.log(`  Golden (successful): ${goldenScenarios.length}`);
console.log(`  Tool failures: ${toolScenarios.length}`);

if (dryRun) {
  console.log('\n[DRY RUN] No files written.');
  for (const s of allScenarios.slice(0, 5)) {
    console.log(`  ${s.id}: ${s.description.substring(0, 80)}`);
  }
  if (allScenarios.length > 5) console.log(`  ... and ${allScenarios.length - 5} more`);
} else if (allScenarios.length > 0) {
  const scenariosDir = join(pkgRoot, 'fixtures', 'scenarios');
  mkdirSync(scenariosDir, { recursive: true });
  const outputPath = join(scenariosDir, 'receipt-staged.json');

  // Deduplicate against existing
  let existing: Scenario[] = [];
  if (existsSync(outputPath)) {
    try { existing = JSON.parse(readFileSync(outputPath, 'utf-8')); } catch { /* overwrite */ }
  }
  const existingIds = new Set(existing.map(s => s.id));
  const newScenarios = allScenarios.filter(s => !existingIds.has(s.id));
  const merged = [...existing, ...newScenarios];

  writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${newScenarios.length} new scenarios (${merged.length} total) to ${outputPath}`);

  // Supply log
  const logPath = join(pkgRoot, 'data', 'supply-log.jsonl');
  mkdirSync(join(pkgRoot, 'data'), { recursive: true });
  appendFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'receipt_scraper',
    generated: allScenarios.length,
    new: newScenarios.length,
    submissions: submissionScenarios.length,
    golden: goldenScenarios.length,
    toolFailures: toolScenarios.length,
  }) + '\n');
} else {
  console.log('\nNo scenarios extracted from receipts.');
}

console.log('\nDone.\n');
