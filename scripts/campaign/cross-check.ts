/**
 * Cross-Check Probes — Independent Verification After verify()
 * =============================================================
 *
 * These probes are the "second opinion." They run AFTER verify produces
 * its verdict and check whether the app actually works as expected.
 *
 * If verify says PASS but the health probe returns 500, that's a
 * false_positive — a real verify bug.
 *
 * CRITICAL: These probes must be independent of verify's implementation.
 * They use raw fetch() and Playwright directly, not verify's gate code.
 */

import type { Predicate } from '../../src/types.js';
import type { CrossCheckResult, CrossCheckConfig } from './types.js';

// =============================================================================
// PROBES
// =============================================================================

/**
 * Health endpoint probe — is the app alive?
 */
async function probeHealth(
  appUrl: string,
  timeout: number,
): Promise<CrossCheckResult['healthProbe']> {
  // Try common health paths
  const paths = ['/health', '/', '/api/health'];

  for (const path of paths) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const resp = await fetch(`${appUrl}${path}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      return {
        path,
        status: resp.status,
        ok: resp.status >= 200 && resp.status < 500,
      };
    } catch {
      continue;
    }
  }

  return { path: '/health', status: null, ok: false };
}

/**
 * HTTP predicate probe — do API endpoints return expected responses?
 * Uses raw fetch(), not verify's HTTP gate.
 */
async function probeHttp(
  appUrl: string,
  predicates: Predicate[],
  timeout: number,
): Promise<CrossCheckResult['httpProbes']> {
  const httpPredicates = predicates.filter(p => p.type === 'http' || p.type === 'http_sequence');
  if (httpPredicates.length === 0) return undefined;

  const results: NonNullable<CrossCheckResult['httpProbes']> = [];

  for (const pred of httpPredicates) {
    if (pred.type === 'http' && pred.path) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const method = pred.method ?? 'GET';
        const resp = await fetch(`${appUrl}${pred.path}`, {
          method,
          signal: controller.signal,
          headers: pred.body ? { 'Content-Type': 'application/json' } : undefined,
          body: pred.body ? JSON.stringify(pred.body) : undefined,
        });
        clearTimeout(timer);

        const body = await resp.text();
        let passed = true;
        let detail = `${method} ${pred.path} → ${resp.status}`;

        if (pred.expect?.status && resp.status !== pred.expect.status) {
          passed = false;
          detail += ` (expected ${pred.expect.status})`;
        }

        if (pred.expect?.bodyContains) {
          const terms = Array.isArray(pred.expect.bodyContains)
            ? pred.expect.bodyContains
            : [pred.expect.bodyContains];
          for (const term of terms) {
            if (!body.includes(term)) {
              passed = false;
              detail += ` (missing "${term.slice(0, 50)}")`;
            }
          }
        }

        results.push({ path: pred.path, method, status: resp.status, passed, detail });
      } catch (err: any) {
        results.push({
          path: pred.path!,
          method: pred.method ?? 'GET',
          status: null,
          passed: false,
          detail: `Probe failed: ${err.message}`,
        });
      }
    }
  }

  return results.length > 0 ? results : undefined;
}

/**
 * CSS/HTML probe via browser — do visual predicates match in real browser?
 * Uses Playwright directly (if available), not verify's browser gate.
 */
async function probeBrowser(
  appUrl: string,
  predicates: Predicate[],
  timeout: number,
): Promise<CrossCheckResult['browserProbe']> {
  const cssPredicates = predicates.filter(p => p.type === 'css' || p.type === 'html');
  if (cssPredicates.length === 0) return undefined;

  // Check if Playwright is available
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const failures: string[] = [];

    // Group predicates by path
    const byPath = new Map<string, Predicate[]>();
    for (const p of cssPredicates) {
      const path = p.path ?? '/';
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path)!.push(p);
    }

    for (const [path, preds] of byPath) {
      try {
        await page.goto(`${appUrl}${path}`, { timeout, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500); // Brief settle

        for (const pred of preds) {
          if (pred.type === 'css' && pred.selector && pred.property) {
            const value = await page.evaluate(
              ({ sel, prop }) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                return window.getComputedStyle(el).getPropertyValue(prop);
              },
              { sel: pred.selector, prop: pred.property },
            );

            if (value === null) {
              failures.push(`${pred.selector} not found on ${path}`);
            } else if (pred.expected && pred.expected !== 'exists' && value !== pred.expected) {
              failures.push(`${pred.selector} ${pred.property}: "${value}" (expected "${pred.expected}")`);
            }
          } else if (pred.type === 'html' && pred.selector) {
            const exists = await page.evaluate(
              (sel) => document.querySelector(sel) !== null,
              pred.selector,
            );
            if (!exists) {
              failures.push(`${pred.selector} not found on ${path}`);
            }
          }
        }
      } catch (err: any) {
        failures.push(`Failed to load ${path}: ${err.message}`);
      }
    }

    await browser.close();

    return {
      passed: failures.length === 0,
      detail: failures.length === 0
        ? `${cssPredicates.length} predicates verified in browser`
        : failures.join('; '),
    };
  } catch {
    // Playwright not available — skip browser probe
    return undefined;
  }
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/**
 * Run independent cross-check probes against a running app container.
 *
 * @param appUrl - URL of the running app (e.g., http://localhost:13042)
 * @param predicates - Predicates to verify independently
 * @param config - Which probes to run and timeouts
 * @returns Cross-check results for fault classification
 */
export async function runCrossChecks(
  appUrl: string,
  predicates: Predicate[],
  config: CrossCheckConfig,
): Promise<CrossCheckResult> {
  const result: CrossCheckResult = {};

  // Run probes in parallel
  const promises: Promise<void>[] = [];

  if (config.health) {
    promises.push(
      probeHealth(appUrl, config.timeout).then(r => { result.healthProbe = r; }),
    );
  }

  if (config.http) {
    promises.push(
      probeHttp(appUrl, predicates, config.timeout).then(r => {
        if (r) result.httpProbes = r;
      }),
    );
  }

  if (config.browser) {
    promises.push(
      probeBrowser(appUrl, predicates, config.timeout).then(r => {
        if (r) result.browserProbe = r;
      }),
    );
  }

  await Promise.allSettled(promises);

  return result;
}
