/**
 * Filesystem Gate — Post-Edit Filesystem State Verification
 * ==========================================================
 *
 * Validates filesystem predicates AFTER edits are applied to the staging workspace.
 * This is the first beyond-code gate — proves verify works for file system agents.
 *
 * Four predicate types:
 *   filesystem_exists    — file/directory exists at expected path
 *   filesystem_absent    — file/directory does NOT exist at path
 *   filesystem_unchanged — file hash matches hash captured at grounding time
 *   filesystem_count     — directory contains expected number of entries
 *
 * Runs after F9 (edits applied) and before K5 (constraints).
 * No Docker required. Pure filesystem reads.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { GateResult, GateContext, Predicate } from '../types.js';

export interface FilesystemPredicateResult {
  predicateIndex: number;
  type: string;
  path: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface FilesystemGateResult extends GateResult {
  predicateResults: FilesystemPredicateResult[];
}

const FILESYSTEM_TYPES = new Set([
  'filesystem_exists',
  'filesystem_absent',
  'filesystem_unchanged',
  'filesystem_count',
]);

/**
 * Run filesystem predicates against the staging workspace (post-edit state).
 */
export function runFilesystemGate(ctx: GateContext): FilesystemGateResult {
  const start = Date.now();
  const predicateResults: FilesystemPredicateResult[] = [];
  const baseDir = ctx.stageDir ?? ctx.config.appDir;

  const fsPreds = ctx.predicates
    .map((p, i) => ({ pred: p, index: i }))
    .filter(({ pred }) => FILESYSTEM_TYPES.has(pred.type));

  if (fsPreds.length === 0) {
    return {
      gate: 'filesystem' as any,
      passed: true,
      detail: 'No filesystem predicates to check',
      durationMs: Date.now() - start,
      predicateResults: [],
    };
  }

  const failures: string[] = [];

  for (const { pred, index } of fsPreds) {
    const filePath = pred.file ?? pred.path;
    if (!filePath) {
      failures.push(`Predicate p${index}: missing file/path field`);
      predicateResults.push({
        predicateIndex: index,
        type: pred.type,
        path: '(missing)',
        passed: false,
        expected: 'file/path field required',
        actual: 'missing',
      });
      continue;
    }

    const fullPath = join(baseDir, filePath);
    const result = validateFilesystemPredicate(pred, fullPath, filePath, index);
    predicateResults.push(result);

    if (!result.passed) {
      failures.push(`p${index} [${pred.type}] ${filePath}: expected ${result.expected}, got ${result.actual}`);
    }
  }

  const passed = failures.length === 0;
  const detail = passed
    ? `All ${fsPreds.length} filesystem predicate(s) passed`
    : `${failures.length}/${fsPreds.length} filesystem predicate(s) failed: ${failures.join('; ')}`;

  return {
    gate: 'filesystem' as any,
    passed,
    detail,
    durationMs: Date.now() - start,
    predicateResults,
  };
}

function validateFilesystemPredicate(
  pred: Predicate,
  fullPath: string,
  relativePath: string,
  index: number,
): FilesystemPredicateResult {
  switch (pred.type) {
    case 'filesystem_exists': {
      const exists = existsSync(fullPath);
      return {
        predicateIndex: index,
        type: pred.type,
        path: relativePath,
        passed: exists,
        expected: 'exists',
        actual: exists ? 'exists' : 'not found',
      };
    }

    case 'filesystem_absent': {
      const exists = existsSync(fullPath);
      return {
        predicateIndex: index,
        type: pred.type,
        path: relativePath,
        passed: !exists,
        expected: 'absent',
        actual: exists ? 'exists (should be absent)' : 'absent',
      };
    }

    case 'filesystem_unchanged': {
      if (!pred.hash) {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: 'hash comparison',
          actual: 'no hash captured at grounding time',
        };
      }
      if (!existsSync(fullPath)) {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: `unchanged (hash: ${pred.hash.slice(0, 12)}...)`,
          actual: 'file not found',
        };
      }
      try {
        const currentHash = hashFile(fullPath);
        const matched = currentHash === pred.hash;
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: matched,
          expected: `unchanged (hash: ${pred.hash.slice(0, 12)}...)`,
          actual: matched ? 'unchanged' : `modified (hash: ${currentHash.slice(0, 12)}...)`,
        };
      } catch {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: `unchanged (hash: ${pred.hash.slice(0, 12)}...)`,
          actual: 'not a regular file or read error',
        };
      }
    }

    case 'filesystem_count': {
      if (pred.count == null) {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: 'count field required',
          actual: 'missing',
        };
      }
      if (!existsSync(fullPath)) {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: `${pred.count} entries`,
          actual: 'directory not found',
        };
      }
      try {
        const entries = readdirSync(fullPath);
        const matched = entries.length === pred.count;
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: matched,
          expected: `${pred.count} entries`,
          actual: `${entries.length} entries`,
        };
      } catch {
        return {
          predicateIndex: index,
          type: pred.type,
          path: relativePath,
          passed: false,
          expected: `${pred.count} entries`,
          actual: 'not a directory or read error',
        };
      }
    }

    default:
      return {
        predicateIndex: index,
        type: pred.type,
        path: relativePath,
        passed: false,
        expected: 'valid filesystem predicate type',
        actual: `unknown type: ${pred.type}`,
      };
  }
}

/**
 * Compute SHA-256 hash of a file's contents.
 * Used for filesystem_unchanged predicates.
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a predicate is a filesystem type.
 */
export function isFilesystemPredicate(p: Predicate): boolean {
  return FILESYSTEM_TYPES.has(p.type);
}
