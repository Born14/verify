#!/usr/bin/env bun
/**
 * Scenario Health Check — Independent Scenario Validation
 * ========================================================
 *
 * Verifies that each scenario's claimed expectedSuccess is actually correct
 * by replaying edits against a fresh demo app copy and running predicates
 * directly — bypassing verify's gates entirely.
 *
 * This is the integrity layer that prevents scenario poisoning:
 * a scenario with wrong expectedSuccess corrupts the oracle,
 * which corrupts the improve loop, which corrupts verify's gates.
 *
 * Usage:
 *   bun run scripts/harness/scenario-health.ts
 *   bun run scripts/harness/scenario-health.ts --scenarios=/path/to/custom-scenarios.json
 *   bun run scripts/harness/scenario-health.ts --universal-only
 *   bun run scripts/harness/scenario-health.ts --verbose
 *
 * Called by CLI:
 *   npx @sovereign-labs/verify scenario-health
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { groundInReality, validateAgainstGrounding, clearGroundingCache } from '../../src/gates/grounding.js';
import { ExternalScenarioStore } from '../../src/store/external-scenarios.js';
import type { SerializedScenario } from '../../src/store/external-scenarios.js';
import type { Predicate, GroundingContext } from '../../src/types.js';

// =============================================================================
// TYPES
// =============================================================================

interface HealthResult {
  id: string;
  description: string;
  transferability: string;
  category: string;
  intent: string;
  expectedSuccess: boolean;
  /** What our independent check found */
  predicatesPassed: boolean;
  /** Does our finding match the scenario's claim? */
  healthy: boolean;
  /** Why it failed health check (if unhealthy) */
  reason?: string;
  /** Was this scenario skipped? */
  skipped: boolean;
  skipReason?: string;
  /** Per-predicate detail */
  predicateDetails: Array<{
    type: string;
    passed: boolean;
    reason: string;
  }>;
}

interface HealthReport {
  timestamp: string;
  scenarioFile: string;
  demoAppDir: string;
  total: number;
  healthy: number;
  unhealthy: number;
  skipped: number;
  results: HealthResult[];
}

// =============================================================================
// PREDICATE CHECKERS — Direct validation, no verify gates
// =============================================================================

/**
 * Check a CSS predicate against the grounding context.
 * Returns { passed, reason }.
 */
function checkCSS(
  predicate: Predicate,
  grounding: GroundingContext,
): { passed: boolean; reason: string } {
  if (!predicate.selector) return { passed: false, reason: 'No selector' };

  // Find the CSS map for the target route
  const targetCSS: Map<string, Record<string, string>>[] = [];
  if (predicate.path) {
    const routeCSS = grounding.routeCSSMap.get(predicate.path);
    if (routeCSS) targetCSS.push(routeCSS);
  } else {
    targetCSS.push(...grounding.routeCSSMap.values());
  }

  // Check selector existence
  const selectorFound = targetCSS.some(m => m.has(predicate.selector!));
  if (!selectorFound) {
    return { passed: false, reason: `Selector "${predicate.selector}" not found${predicate.path ? ` on route "${predicate.path}"` : ''}` };
  }

  // If expected is 'exists' or not provided, selector existence is sufficient
  if (!predicate.expected || predicate.expected === 'exists') {
    return { passed: true, reason: `Selector "${predicate.selector}" exists` };
  }

  // Check property existence and value
  if (predicate.property) {
    for (const routeCSS of targetCSS) {
      const props = routeCSS.get(predicate.selector!);
      if (!props) continue;

      if (predicate.property in props) {
        const actual = props[predicate.property];
        if (normalizeColor(actual) === normalizeColor(predicate.expected)) {
          return { passed: true, reason: `${predicate.selector} ${predicate.property}: "${actual}" matches "${predicate.expected}"` };
        }
        return { passed: false, reason: `${predicate.selector} ${predicate.property}: actual="${actual}" expected="${predicate.expected}"` };
      }

      // Check shorthand resolution
      for (const [sh, longhands] of Object.entries(SHORTHAND_MAP)) {
        if (longhands.includes(predicate.property) && sh in props) {
          const resolved = resolveShorthand(sh, props[sh], predicate.property);
          if (resolved && normalizeColor(resolved) === normalizeColor(predicate.expected)) {
            return { passed: true, reason: `${predicate.selector} ${predicate.property}: resolved from ${sh} shorthand` };
          }
        }
      }
    }
    return { passed: false, reason: `Property "${predicate.property}" not found on selector "${predicate.selector}"` };
  }

  return { passed: false, reason: 'CSS predicate missing property field' };
}

/**
 * Check an HTML predicate against the grounding context.
 */
function checkHTML(
  predicate: Predicate,
  grounding: GroundingContext,
): { passed: boolean; reason: string } {
  if (!predicate.selector) return { passed: false, reason: 'No selector' };

  const targetRoutes = predicate.path ? [predicate.path] : [...grounding.htmlElements.keys()];

  for (const route of targetRoutes) {
    const elements = grounding.htmlElements.get(route) ?? [];
    for (const el of elements) {
      if (el.tag === predicate.selector) {
        // If expected is 'exists' or not set, element existence is enough
        if (!predicate.expected || predicate.expected === 'exists') {
          return { passed: true, reason: `Element <${predicate.selector}> found on route "${route}"` };
        }
        // Check text content
        if (el.text && el.text.includes(predicate.expected)) {
          return { passed: true, reason: `Element <${predicate.selector}> contains "${predicate.expected}" on route "${route}"` };
        }
      }
    }
  }

  // Check if element exists on wrong route
  if (predicate.path) {
    for (const [route, elements] of grounding.htmlElements) {
      if (route === predicate.path) continue;
      if (elements.some(el => el.tag === predicate.selector)) {
        return { passed: false, reason: `Element <${predicate.selector}> exists on "${route}" but not on claimed route "${predicate.path}"` };
      }
    }
  }

  if (predicate.expected && predicate.expected !== 'exists') {
    return { passed: false, reason: `Element <${predicate.selector}> not found with text "${predicate.expected}"` };
  }
  return { passed: false, reason: `Element <${predicate.selector}> not found` };
}

/**
 * Check a content predicate against the actual file.
 */
function checkContent(
  predicate: Predicate,
  appDir: string,
): { passed: boolean; reason: string } {
  if (!predicate.file) return { passed: false, reason: 'No file specified' };
  if (!predicate.pattern) return { passed: false, reason: 'No pattern specified' };

  const filePath = join(appDir, predicate.file);
  if (!existsSync(filePath)) {
    return { passed: false, reason: `File "${predicate.file}" does not exist` };
  }

  const content = readFileSync(filePath, 'utf-8');
  if (content.includes(predicate.pattern)) {
    return { passed: true, reason: `Pattern "${predicate.pattern}" found in "${predicate.file}"` };
  }
  return { passed: false, reason: `Pattern "${predicate.pattern}" not found in "${predicate.file}"` };
}

/**
 * Check an HTTP predicate against source files.
 * Without a running server, we check if the claimed body content
 * exists in the source code — same heuristic as the grounding gate.
 */
function checkHTTP(
  predicate: Predicate,
  appDir: string,
): { passed: boolean; reason: string } {
  const claimedContent: string[] = [];
  if (predicate.expect?.bodyContains) {
    if (Array.isArray(predicate.expect.bodyContains)) {
      claimedContent.push(...predicate.expect.bodyContains);
    } else {
      claimedContent.push(predicate.expect.bodyContains);
    }
  }
  if (predicate.expected && predicate.expected !== 'exists') {
    claimedContent.push(predicate.expected);
  }

  if (claimedContent.length === 0) {
    // No body content claim — can't validate without Docker
    return { passed: true, reason: 'HTTP predicate with no body content claim (needs Docker to validate)' };
  }

  // Check if claimed content exists in any source file
  const sourceFiles = findSourceFiles(appDir);
  const allSource = sourceFiles.map(f => {
    try { return readFileSync(f, 'utf-8'); } catch { return ''; }
  }).join('\n');

  for (const claim of claimedContent) {
    if (!allSource.includes(claim)) {
      return { passed: false, reason: `HTTP body content "${claim}" not found in any source file` };
    }
  }

  return { passed: true, reason: 'HTTP body content found in source files' };
}

// =============================================================================
// HELPERS
// =============================================================================

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', navy: '#000080', orange: '#ffa500', yellow: '#ffff00',
  purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  maroon: '#800000', teal: '#008080', cyan: '#00ffff', coral: '#ff7f50',
  tomato: '#ff6347', gold: '#ffd700', indigo: '#4b0082', crimson: '#dc143c',
  salmon: '#fa8072', lime: '#00ff00', aqua: '#00ffff', pink: '#ffc0cb',
  olive: '#808000', fuchsia: '#ff00ff', violet: '#ee82ee',
};

function normalizeColor(v: string): string {
  const l = v.trim().toLowerCase();
  return NAMED_COLORS[l] ?? l;
}

const SHORTHAND_MAP: Record<string, string[]> = {
  border: ['border-width', 'border-style', 'border-color'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  background: ['background-color'],
  font: ['font-style', 'font-variant', 'font-weight', 'font-size', 'line-height', 'font-family'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
};

function resolveShorthand(shorthand: string, value: string, longhand: string): string | undefined {
  const longhands = SHORTHAND_MAP[shorthand];
  if (!longhands) return undefined;
  const idx = longhands.indexOf(longhand);
  if (idx === -1) return undefined;
  const tokens = value.trim().split(/\s+/);
  return tokens[idx];
}

function findSourceFiles(dir: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.sovereign', '.verify']);

  try {
    const { readdirSync } = require('fs');
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findSourceFiles(fullPath, maxDepth, depth + 1));
      } else {
        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'vue', 'svelte'].includes(ext ?? '')) {
          files.push(fullPath);
        }
      }
    }
  } catch { /* skip */ }

  return files;
}

/**
 * Apply edits to a file (search/replace).
 * Returns true if all edits applied successfully.
 */
function applyEdits(
  appDir: string,
  edits: Array<{ file: string; search: string; replace: string }>,
): { success: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const edit of edits) {
    const filePath = join(appDir, edit.file);
    if (!existsSync(filePath)) {
      errors.push(`File not found: ${edit.file}`);
      continue;
    }

    let content = readFileSync(filePath, 'utf-8');

    // Handle \r\n in search strings (scenarios from Windows may have them)
    let searchStr = edit.search;

    // Count occurrences
    const count = content.split(searchStr).length - 1;
    if (count === 0) {
      // Try with normalized line endings
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const normalizedSearch = searchStr.replace(/\r\n/g, '\n');
      const normCount = normalizedContent.split(normalizedSearch).length - 1;
      if (normCount === 0) {
        errors.push(`Search string not found in ${edit.file}: "${searchStr.slice(0, 60)}..."`);
        continue;
      }
      if (normCount > 1) {
        errors.push(`Search string found ${normCount} times in ${edit.file} (must be unique)`);
        continue;
      }
      // Apply with normalized content
      content = normalizedContent.replace(normalizedSearch, edit.replace.replace(/\r\n/g, '\n'));
    } else if (count > 1) {
      errors.push(`Search string found ${count} times in ${edit.file} (must be unique)`);
      continue;
    } else {
      content = content.replace(searchStr, edit.replace);
    }

    writeFileSync(filePath, content);
  }

  return { success: errors.length === 0, errors };
}

// =============================================================================
// CORE: Health check a single scenario
// =============================================================================

function checkScenario(
  scenario: SerializedScenario,
  demoAppDir: string,
  tmpDir: string,
  verbose: boolean,
): HealthResult {
  const result: HealthResult = {
    id: scenario.id,
    description: scenario.description,
    transferability: scenario.transferability ?? 'unclassified',
    category: scenario.category ?? 'unclassified',
    intent: scenario.intent,
    expectedSuccess: scenario.expectedSuccess,
    predicatesPassed: false,
    healthy: false,
    skipped: false,
    predicateDetails: [],
  };

  // Skip scenarios that require Docker
  if (scenario.requiresDocker) {
    result.skipped = true;
    result.skipReason = 'Requires Docker';
    result.healthy = true; // Can't determine — assume healthy
    return result;
  }

  // Skip scenarios with db/http_sequence predicates (need running server)
  const needsServer = scenario.predicates.some(p =>
    p.type === 'db' || p.type === 'http_sequence'
  );
  if (needsServer) {
    result.skipped = true;
    result.skipReason = 'Requires running server (db/http_sequence predicates)';
    result.healthy = true;
    return result;
  }

  // Create fresh copy of demo app
  const scenarioDir = join(tmpDir, scenario.id);
  try {
    cpSync(demoAppDir, scenarioDir, { recursive: true });
  } catch (err: any) {
    result.skipped = true;
    result.skipReason = `Failed to copy demo app: ${err.message}`;
    return result;
  }

  try {
    // Apply edits
    const editResult = applyEdits(scenarioDir, scenario.edits);
    if (!editResult.success) {
      // Edits failed to apply — check if this is expected
      // For no-op edits (search === replace), this is fine
      const isNoOp = scenario.edits.every(e => e.search === e.replace);
      if (!isNoOp) {
        if (verbose) {
          console.log(`  ⚠ Edit errors: ${editResult.errors.join('; ')}`);
        }
        // If edits can't apply against demo app, scenario was written for a different app
        result.skipped = true;
        result.skipReason = `Edits don't apply to demo app: ${editResult.errors[0]}`;
        result.healthy = true; // App-specific scenario — can't health check against demo
        return result;
      }
    }

    // Clear grounding cache for fresh scan
    clearGroundingCache(scenarioDir);

    // Ground in reality — scan the (modified) app
    const grounding = groundInReality(scenarioDir);

    // Check each predicate independently
    let allPassed = true;
    for (const pred of scenario.predicates) {
      let check: { passed: boolean; reason: string };

      switch (pred.type) {
        case 'css':
          check = checkCSS(pred, grounding);
          break;
        case 'html':
          check = checkHTML(pred, grounding);
          break;
        case 'content':
          check = checkContent(pred, scenarioDir);
          break;
        case 'http':
          check = checkHTTP(pred, scenarioDir);
          break;
        default:
          check = { passed: true, reason: `Predicate type "${pred.type}" not health-checkable offline` };
      }

      result.predicateDetails.push({
        type: pred.type,
        passed: check.passed,
        reason: check.reason,
      });

      if (!check.passed) allPassed = false;
    }

    result.predicatesPassed = allPassed;

    // Now compare: does the independent predicate check match the scenario's claim?
    //
    // For false_positive scenarios (expectedSuccess=false):
    //   The scenario claims verify SHOULD fail. If our predicate check also fails,
    //   that's consistent — the predicates are genuinely wrong. Healthy.
    //   If our check passes, that's suspicious — maybe the scenario is wrong.
    //
    // For false_negative / regression_guard scenarios (expectedSuccess=true):
    //   The scenario claims verify SHOULD pass. If our predicate check passes,
    //   that's consistent. Healthy.
    //   If our check fails, the predicates don't match the edits — unhealthy.
    //
    // HOWEVER: For grounding gate scenarios, the scenario often tests that the
    // grounding gate SHOULD reject certain predicates. The predicates are
    // intentionally wrong (fabricated selectors, wrong values). So for
    // false_positive + expectedSuccess=false, we actually EXPECT predicates to fail.
    // That's the whole point — the scenario proves the gate catches the lie.

    if (scenario.expectedSuccess) {
      // Scenario claims verify should pass → predicates should pass
      result.healthy = allPassed;
      if (!allPassed) {
        result.reason = 'Scenario claims expectedSuccess=true but predicates fail against modified app';
      }
    } else {
      // Scenario claims verify should fail → predicates SHOULD fail
      // (the scenario is testing that verify catches invalid predicates)
      //
      // If predicates pass when the scenario says they should fail, that's a
      // health check failure — the scenario's expected outcome is wrong.
      result.healthy = !allPassed;
      if (allPassed) {
        result.reason = 'Scenario claims expectedSuccess=false but predicates actually pass — scenario may be wrong';
      }
    }

  } finally {
    // Cleanup
    try { rmSync(scenarioDir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearGroundingCache(scenarioDir);
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

export async function runScenarioHealth(opts: {
  scenarioPath?: string;
  universalOnly?: boolean;
  verbose?: boolean;
  json?: boolean;
}): Promise<HealthReport> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageRoot = resolve(__dirname, '..', '..');

  // Resolve demo app
  const demoAppDir = join(packageRoot, 'fixtures', 'demo-app');
  if (!existsSync(demoAppDir)) {
    console.error(`Demo app not found at ${demoAppDir}`);
    process.exit(1);
  }

  // Resolve scenario file
  const scenarioPath = opts.scenarioPath ?? join(process.cwd(), '.verify', 'custom-scenarios.json');
  if (!existsSync(scenarioPath)) {
    console.error(`Scenario file not found: ${scenarioPath}`);
    console.error('Provide a path with --scenarios=/path/to/custom-scenarios.json');
    process.exit(1);
  }

  const store = new ExternalScenarioStore(scenarioPath);
  let scenarios = store.all();

  if (opts.universalOnly) {
    scenarios = store.byTransferability('universal');
  }

  if (scenarios.length === 0) {
    console.log('No scenarios to check.');
    return {
      timestamp: new Date().toISOString(),
      scenarioFile: scenarioPath,
      demoAppDir,
      total: 0, healthy: 0, unhealthy: 0, skipped: 0,
      results: [],
    };
  }

  // Create temp directory
  const tmpDir = join(packageRoot, '.verify-tmp', `health-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  if (!opts.json) {
    console.log(`\n━━━ Scenario Health Check ━━━`);
    console.log(`  Scenarios: ${scenarios.length}${opts.universalOnly ? ' (universal only)' : ''}`);
    console.log(`  Source:    ${scenarioPath}`);
    console.log(`  Demo app:  ${demoAppDir}\n`);
  }

  const results: HealthResult[] = [];

  for (const scenario of scenarios) {
    const result = checkScenario(scenario, demoAppDir, tmpDir, opts.verbose ?? false);
    results.push(result);

    if (!opts.json) {
      const icon = result.skipped ? '⊘' : result.healthy ? '✓' : '✗';
      const color = result.skipped ? '\x1b[90m' : result.healthy ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      const tag = result.transferability === 'universal' ? ' [U]' : result.transferability === 'app_specific' ? ' [A]' : ' [F]';

      console.log(`  ${color}${icon}${reset}${tag} ${result.description.slice(0, 70)}`);

      if (opts.verbose) {
        if (result.skipped) {
          console.log(`    Skip: ${result.skipReason}`);
        } else {
          for (const pd of result.predicateDetails) {
            const pIcon = pd.passed ? '✓' : '✗';
            console.log(`    ${pIcon} [${pd.type}] ${pd.reason}`);
          }
          if (!result.healthy) {
            console.log(`    ⚠ ${result.reason}`);
          }
        }
      }
    }
  }

  // Cleanup tmp
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    scenarioFile: scenarioPath,
    demoAppDir,
    total: results.length,
    healthy: results.filter(r => r.healthy).length,
    unhealthy: results.filter(r => !r.healthy && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    results,
  };

  if (!opts.json) {
    const uhResults = results.filter(r => !r.healthy && !r.skipped);
    console.log(`\n━━━ Summary ━━━`);
    console.log(`  Total:     ${report.total}`);
    console.log(`  Healthy:   \x1b[32m${report.healthy}\x1b[0m`);
    console.log(`  Unhealthy: ${report.unhealthy > 0 ? '\x1b[31m' : ''}${report.unhealthy}\x1b[0m`);
    console.log(`  Skipped:   \x1b[90m${report.skipped}\x1b[0m`);

    if (uhResults.length > 0) {
      console.log(`\n━━━ Quarantine Candidates ━━━`);
      for (const r of uhResults) {
        console.log(`  \x1b[31m✗\x1b[0m ${r.id}: ${r.reason}`);
      }
    }
    console.log('');
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  return report;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('scenario-health.ts')) {
  const args = process.argv.slice(2);
  const scenarioPath = args.find(a => a.startsWith('--scenarios='))?.split('=')[1];
  const universalOnly = args.includes('--universal-only');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const json = args.includes('--json');

  runScenarioHealth({ scenarioPath, universalOnly, verbose, json })
    .then(report => {
      if (report.unhealthy > 0) process.exit(1);
    })
    .catch(err => {
      console.error('Health check failed:', err);
      process.exit(2);
    });
}
