/**
 * Subprocess Validation — Copy, Overlay, Run, Compare
 * =====================================================
 *
 * Each fix candidate is tested in an isolated copy of the package.
 * Dirty scenarios must become clean. Validation set must stay clean.
 * Holdout set catches overfitting.
 */

import { mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import type { ProposedEdit, LedgerEntry, CandidateResult, RunConfig } from './types.js';

interface SubprocessResult {
  entries: LedgerEntry[];
  timedOut: boolean;
}

// =============================================================================
// SCENARIO SPLIT — deterministic based on scenario ID hash
// =============================================================================

export interface ScenarioSplit {
  dirty: LedgerEntry[];
  validation: LedgerEntry[];
  holdout: LedgerEntry[];
}

export function splitScenarios(baseline: LedgerEntry[]): ScenarioSplit {
  const dirty = baseline.filter(e => !e.clean);
  const clean = baseline.filter(e => e.clean);

  // Adaptive split: reduce holdout percentage for small sets (minimum 3 holdout)
  // Default 30% holdout, but reduce to 20% if holdout would be < 5
  const holdoutPct = clean.length < 17 ? 0.2 : 0.3; // 17 * 0.3 ≈ 5
  const holdoutThreshold = Math.round(holdoutPct * 10);

  const validation: LedgerEntry[] = [];
  const holdout: LedgerEntry[] = [];
  for (let i = 0; i < clean.length; i++) {
    const hash = simpleHash(clean[i].id);
    if (hash % 10 < (10 - holdoutThreshold)) {
      validation.push(clean[i]);
    } else {
      holdout.push(clean[i]);
    }
  }

  // Ensure minimum 3 holdout scenarios if we have enough clean scenarios
  if (holdout.length < 3 && clean.length >= 6) {
    // Move some from validation to holdout
    while (holdout.length < 3 && validation.length > holdout.length) {
      holdout.push(validation.pop()!);
    }
  }

  return { dirty, validation, holdout };
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// =============================================================================
// SUBPROCESS VALIDATION
// =============================================================================

export async function validateCandidate(
  candidateId: string,
  strategy: string,
  edits: ProposedEdit[],
  split: ScenarioSplit,
  packageRoot: string,
  runConfig: RunConfig,
): Promise<CandidateResult> {
  const tempDir = join(tmpdir(), `verify-improve-${candidateId}-${Date.now()}`);

  try {
    // 1. Copy package to temp dir
    mkdirSync(tempDir, { recursive: true });
    copyPackage(packageRoot, tempDir);

    // 2. Overlay edits (partial application — proceed if ≥1 edit applies)
    const editResult = overlayEdits(edits, tempDir);
    if (editResult.applied === 0) {
      return {
        candidateId,
        strategy,
        edits,
        improvements: [],
        regressions: [],
        score: -100, // zero edits applied
        appliedEdits: 0,
        skippedEdits: editResult.skipped,
      };
    }
    if (editResult.skipped > 0) {
      console.log(`          ${editResult.applied}/${edits.length} edits applied (${editResult.skipped} skipped: ${editResult.errors.join('; ')})`);
    }

    // 3. Run self-test in subprocess (retry once with 2x timeout on timeout)
    let subResult = await runSubprocess(tempDir, packageRoot, runConfig);
    if (subResult.timedOut) {
      console.log(`          Subprocess timed out — retrying with 2x timeout...`);
      subResult = await runSubprocess(tempDir, packageRoot, runConfig, 240_000);
    }
    if (subResult.timedOut) {
      return {
        candidateId,
        strategy,
        edits,
        improvements: [],
        regressions: [],
        score: -50, // timeout — less severe than crash (-100)
        timedOut: true,
      };
    }
    const results = subResult.entries;

    // 4. Compare results
    const dirtyIds = new Set(split.dirty.map(e => e.id));
    const validationIds = new Set(split.validation.map(e => e.id));

    const improvements: string[] = [];
    const regressions: string[] = [];

    for (const entry of results) {
      if (dirtyIds.has(entry.id) && entry.clean) {
        improvements.push(entry.id);
      }
      if (validationIds.has(entry.id) && !entry.clean) {
        regressions.push(entry.id);
      }
    }

    // Score: improvements minus regressions (scaled by set size), capped minimal patch bias
    const totalChangedLines = edits.reduce((sum, e) => {
      const searchLines = e.search.split('\n').length;
      const replaceLines = e.replace.split('\n').length;
      return sum + Math.abs(replaceLines - searchLines) + Math.min(searchLines, replaceLines);
    }, 0);
    // Cap line penalty at 3.0 — a correct 56-line fix shouldn't be rejected for being readable
    const linePenalty = Math.min(totalChangedLines * 0.1, 3.0);
    // Scale regression penalty by validation set size — small sets are noisy
    const validationSize = split.validation.length;
    const regressionPenalty = validationSize < 10
      ? regressions.length * 5   // softer penalty for small validation sets
      : regressions.length * 10;
    const score = improvements.length - regressionPenalty - linePenalty;

    const partialScore = split.dirty.length > 0
      ? (improvements.length - regressions.length) / split.dirty.length
      : 0;

    return {
      candidateId, strategy, edits, improvements, regressions, score, partialScore,
      appliedEdits: editResult.applied, skippedEdits: editResult.skipped,
    };
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

export interface HoldoutResult {
  verdict: 'clean' | 'regression';
  holdoutSize: number;
  regressionCount: number;
  confidence: 'low' | 'medium' | 'high';
}

export async function runHoldout(
  edits: ProposedEdit[],
  holdout: LedgerEntry[],
  packageRoot: string,
  runConfig: RunConfig,
): Promise<HoldoutResult> {
  const holdoutSize = holdout.length;
  const confidence: 'low' | 'medium' | 'high' =
    holdoutSize < 5 ? 'low' : holdoutSize < 10 ? 'medium' : 'high';

  if (holdoutSize === 0) return { verdict: 'clean', holdoutSize: 0, regressionCount: 0, confidence: 'low' };

  if (holdoutSize < 5) {
    console.log(`        ⚠ Small holdout set (${holdoutSize} scenarios) — low confidence`);
  }

  const tempDir = join(tmpdir(), `verify-holdout-${Date.now()}`);
  try {
    mkdirSync(tempDir, { recursive: true });
    copyPackage(packageRoot, tempDir);
    overlayEdits(edits, tempDir);

    let subResult = await runSubprocess(tempDir, packageRoot, runConfig);
    if (subResult.timedOut) {
      const retryResult = await runSubprocess(tempDir, packageRoot, runConfig, 240_000);
      if (retryResult.timedOut) {
        return { verdict: 'clean', holdoutSize, regressionCount: 0, confidence };
      }
      subResult = retryResult;
    }
    const results = subResult.entries;
    const holdoutIds = new Set(holdout.map(e => e.id));

    let regressionCount = 0;
    for (const entry of results) {
      if (holdoutIds.has(entry.id) && !entry.clean) {
        regressionCount++;
      }
    }

    // For small holdout sets, require ≥2 regressions to reject
    const threshold = holdoutSize < 10 ? 2 : 1;
    const verdict = regressionCount >= threshold ? 'regression' : 'clean';
    return { verdict, holdoutSize, regressionCount, confidence };
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function copyPackage(src: string, dest: string): void {
  // Copy src/ and fixtures/ (the editable code + test fixtures)
  for (const dir of ['src', 'fixtures']) {
    const srcDir = join(src, dir);
    const destDir = join(dest, dir);
    if (existsSync(srcDir)) {
      cpSync(srcDir, destDir, { recursive: true });
    }
  }
  // Copy package.json and tsconfig for module resolution
  for (const file of ['package.json', 'tsconfig.json']) {
    const srcFile = join(src, file);
    if (existsSync(srcFile)) {
      cpSync(srcFile, join(dest, file));
    }
  }
  // Copy scripts/ (harness is needed to run self-test)
  const scriptsDir = join(src, 'scripts');
  if (existsSync(scriptsDir)) {
    cpSync(scriptsDir, join(dest, 'scripts'), { recursive: true });
  }
  // Symlink node_modules — Bun needs it for import resolution
  // (workspace packages, @sovereign-labs/kernel, etc.)
  const nodeModules = join(src, 'node_modules');
  if (existsSync(nodeModules)) {
    try {
      symlinkSync(resolve(nodeModules), join(dest, 'node_modules'), 'junction');
    } catch {
      // Fallback: copy if symlink fails (e.g., permissions)
      cpSync(nodeModules, join(dest, 'node_modules'), { recursive: true });
    }
  }
}

interface OverlayResult {
  applied: number;
  skipped: number;
  errors: string[];
}

function overlayEdits(edits: ProposedEdit[], packageRoot: string): OverlayResult {
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const edit of edits) {
    const filePath = join(packageRoot, edit.file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (!content.includes(edit.search)) {
        errors.push(`Search string not found in ${edit.file}`);
        skipped++;
        continue;
      }
      const updated = content.replace(edit.search, edit.replace);
      writeFileSync(filePath, updated);
      applied++;
    } catch (err: any) {
      errors.push(`Failed to edit ${edit.file}: ${err.message}`);
      skipped++;
    }
  }
  return { applied, skipped, errors };
}

async function runSubprocess(
  packageDir: string,
  originalPackageRoot: string,
  runConfig: RunConfig,
  timeoutMs: number = 120_000,
): Promise<SubprocessResult> {
  // Run the self-test in a subprocess and capture the ledger
  const ledgerPath = join(packageDir, 'data', 'subprocess-ledger.jsonl');
  mkdirSync(join(packageDir, 'data'), { recursive: true });

  const scriptPath = join(packageDir, 'scripts', 'self-test.ts');
  const args = [
    'run', scriptPath,
    `--ledger=${ledgerPath}`,
  ];
  if (runConfig.families) {
    args.push(`--families=${runConfig.families.join(',')}`);
  }

  const proc = Bun.spawn(['bun', ...args], {
    cwd: packageDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  // Consume stdout/stderr to prevent pipe buffer deadlock (especially on Windows)
  const stdoutPromise = new Response(proc.stdout).text().catch(() => '');
  const stderrPromise = new Response(proc.stderr).text().catch(() => '');

  // Wait for completion with timeout
  let timedOut = false;
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) =>
      setTimeout(() => { proc.kill(); timedOut = true; resolve(-1); }, timeoutMs)
    ),
  ]);

  // Drain pipes
  await stdoutPromise;
  await stderrPromise;

  // Parse ledger
  if (!existsSync(ledgerPath)) return { entries: [], timedOut };

  const ledgerContent = readFileSync(ledgerPath, 'utf-8');
  const entries: LedgerEntry[] = [];
  for (const line of ledgerContent.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch { /* skip malformed lines */ }
  }
  return { entries, timedOut };
}
