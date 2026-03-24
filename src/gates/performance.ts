/**
 * Performance Gate
 * ================
 *
 * Validates performance predicates by analyzing source files for
 * common performance patterns and anti-patterns.
 * Pure static analysis — no runtime measurement, no Docker.
 *
 * Predicate type: performance
 * Check types:
 *   - bundle_size: Total JS/CSS file sizes within threshold
 *   - image_optimization: Images use modern formats, have reasonable sizes
 *   - lazy_loading: Large assets/images use lazy loading
 *   - connection_count: Number of external resource references
 *   - response_time: (Advisory — requires runtime, deferred to HTTP gate)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { GateContext, GateResult, Predicate, PredicateResult } from '../types.js';

// =============================================================================
// PERFORMANCE ANALYZERS
// =============================================================================

type PerfCheckType = 'response_time' | 'bundle_size' | 'image_optimization' | 'lazy_loading' | 'connection_count';

/**
 * Measure total size of JS and CSS files in an app directory.
 */
function measureBundleSize(appDir: string): { totalBytes: number; files: Array<{ path: string; bytes: number }> } {
  const BUNDLE_EXTS = new Set(['.js', '.css', '.mjs', '.cjs']);
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);
  const files: Array<{ path: string; bytes: number }> = [];

  function scan(dir: string, rel: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else if (BUNDLE_EXTS.has(extname(entry.name).toLowerCase())) {
          try {
            const stats = statSync(fullPath);
            files.push({ path: rel ? `${rel}/${entry.name}` : entry.name, bytes: stats.size });
          } catch { /* unreadable */ }
        }
      }
    } catch { /* unreadable dir */ }
  }

  scan(appDir, '');
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  return { totalBytes, files };
}

/**
 * Check images for optimization issues.
 */
function checkImageOptimization(appDir: string): Array<{ file: string; issue: string }> {
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff']);
  const MODERN_EXTS = new Set(['.webp', '.avif', '.svg']);
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);
  const issues: Array<{ file: string; issue: string }> = [];
  let hasOldFormat = false;
  let hasModernFormat = false;

  function scan(dir: string, rel: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (IMAGE_EXTS.has(ext)) {
            hasOldFormat = true;
            try {
              const stats = statSync(fullPath);
              if (stats.size > 500 * 1024) { // > 500KB
                issues.push({
                  file: rel ? `${rel}/${entry.name}` : entry.name,
                  issue: `Large image (${(stats.size / 1024).toFixed(0)}KB) — consider compression or modern format`,
                });
              }
            } catch { /* skip */ }
          }
          if (MODERN_EXTS.has(ext)) {
            hasModernFormat = true;
          }
        }
      }
    } catch { /* skip */ }
  }

  scan(appDir, '');

  if (hasOldFormat && !hasModernFormat) {
    issues.push({ file: '(project)', issue: 'No modern image formats (webp/avif/svg) found — consider converting' });
  }

  return issues;
}

/**
 * Check for lazy loading patterns.
 */
function checkLazyLoading(appDir: string): Array<{ file: string; issue: string }> {
  const issues: Array<{ file: string; issue: string }> = [];
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);

  function scan(dir: string, rel: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (['.html', '.htm', '.jsx', '.tsx', '.js'].includes(ext)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              // Check for images without loading="lazy"
              const imgRegex = /<img\b[^>]*>/gi;
              let match;
              while ((match = imgRegex.exec(content)) !== null) {
                const tag = match[0];
                if (!tag.includes('loading=') && !tag.includes('loading =')) {
                  issues.push({
                    file: rel ? `${rel}/${entry.name}` : entry.name,
                    issue: 'Image without loading="lazy" attribute',
                  });
                }
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip */ }
  }

  scan(appDir, '');
  return issues;
}

/**
 * Count external resource references (scripts, stylesheets, fonts).
 */
function countConnections(appDir: string): { count: number; details: string[] } {
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);
  const externalRefs = new Set<string>();

  function scan(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else {
          const ext = extname(entry.name).toLowerCase();
          if (['.html', '.htm', '.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              // External script/link/fetch references
              const urlRegex = /(?:src|href|url)\s*=\s*['"]?(https?:\/\/[^'">\s]+)/gi;
              let match;
              while ((match = urlRegex.exec(content)) !== null) {
                try {
                  const host = new URL(match[1]).hostname;
                  externalRefs.add(host);
                } catch { /* invalid URL */ }
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip */ }
  }

  scan(appDir);
  return { count: externalRefs.size, details: [...externalRefs] };
}

// =============================================================================
// PERFORMANCE GATE
// =============================================================================

export function runPerformanceGate(ctx: GateContext): GateResult & { predicateResults: PredicateResult[] } {
  const start = Date.now();
  const perfPreds = ctx.predicates.filter(p => p.type === 'performance');

  if (perfPreds.length === 0) {
    return {
      gate: 'performance' as any,
      passed: true,
      detail: 'No performance predicates to check',
      durationMs: Date.now() - start,
      predicateResults: [],
    };
  }

  const results: PredicateResult[] = [];
  let allPassed = true;
  const details: string[] = [];

  for (let i = 0; i < perfPreds.length; i++) {
    const p = perfPreds[i];
    const result = validatePerformancePredicate(p, ctx.config.appDir);
    results.push({ ...result, predicateId: `perf_p${i}` });

    if (!result.passed) {
      allPassed = false;
      details.push(result.actual ?? 'failed');
    }
  }

  const passCount = results.filter(r => r.passed).length;
  const detail = allPassed
    ? `All ${perfPreds.length} performance predicates passed`
    : `${passCount}/${perfPreds.length} passed: ${details.join('; ')}`;

  ctx.log(`[performance] ${detail}`);

  return {
    gate: 'performance' as any,
    passed: allPassed,
    detail,
    durationMs: Date.now() - start,
    predicateResults: results,
  };
}

function validatePerformancePredicate(
  p: Predicate,
  appDir: string,
): Omit<PredicateResult, 'predicateId'> {
  const check = p.perfCheck;
  const fingerprint = `type=performance|check=${check}|threshold=${p.threshold ?? 'default'}`;

  if (!check) {
    return { type: 'performance', passed: false, expected: 'perf check type', actual: '(no perfCheck specified)', fingerprint };
  }

  switch (check) {
    case 'bundle_size': {
      const threshold = p.threshold ?? 512 * 1024; // default 512KB
      const { totalBytes, files } = measureBundleSize(appDir);
      const passed = totalBytes <= threshold;
      return {
        type: 'performance',
        passed,
        expected: `bundle size ≤ ${formatBytes(threshold)}`,
        actual: `${formatBytes(totalBytes)} across ${files.length} files`,
        fingerprint,
      };
    }

    case 'image_optimization': {
      const issues = checkImageOptimization(appDir);
      const passed = issues.length === 0;
      return {
        type: 'performance',
        passed,
        expected: 'images optimized',
        actual: passed
          ? 'all images optimized'
          : `${issues.length} issue(s): ${issues.slice(0, 3).map(i => i.issue).join('; ')}`,
        fingerprint,
      };
    }

    case 'lazy_loading': {
      const issues = checkLazyLoading(appDir);
      const passed = issues.length === 0;
      return {
        type: 'performance',
        passed,
        expected: 'lazy loading on images',
        actual: passed
          ? 'all images have lazy loading'
          : `${issues.length} image(s) without lazy loading`,
        fingerprint,
      };
    }

    case 'connection_count': {
      const threshold = p.threshold ?? 10;
      const { count, details } = countConnections(appDir);
      const passed = count <= threshold;
      return {
        type: 'performance',
        passed,
        expected: `≤ ${threshold} external connections`,
        actual: `${count} external domain(s)${count > 0 ? `: ${details.slice(0, 5).join(', ')}` : ''}`,
        fingerprint,
      };
    }

    case 'response_time': {
      // Response time requires runtime measurement — advisory only
      return {
        type: 'performance',
        passed: true,
        expected: 'response time check (runtime — deferred)',
        actual: 'deferred to HTTP gate (requires running server)',
        fingerprint,
      };
    }

    default:
      return { type: 'performance', passed: false, expected: 'valid perf check', actual: `unknown check: ${check}`, fingerprint };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
