/**
 * Generates performance gate scenarios from demo-app fixtures.
 * 10 check types testing static performance analysis.
 * Run: bun scripts/harvest/stage-performance-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/performance-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `perf-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: bundle_size — JS/CSS file size checks
// =============================================================================

push({
  description: 'bundle_size: server.js under default 512KB threshold',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'bundle_size' }],
  expectedSuccess: true,
  tags: ['performance', 'bundle_size'],
  rationale: 'server.js is small (~10KB), well under 512KB default',
});

push({
  description: 'bundle_size: custom low threshold should fail',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'bundle_size', threshold: 100 }],
  expectedSuccess: false,
  tags: ['performance', 'bundle_size_fail'],
  rationale: 'server.js is >100 bytes, should fail with very low threshold',
});

// =============================================================================
// Family: image_optimization — check for modern image formats
// =============================================================================

push({
  description: 'image_optimization: demo-app has no image files',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'image_optimization' }],
  expectedSuccess: true,
  tags: ['performance', 'image_optimization'],
  rationale: 'No image files in demo-app, nothing to optimize',
});

// =============================================================================
// Family: lazy_loading — images should use loading="lazy"
// =============================================================================

push({
  description: 'lazy_loading: demo-app img lacks loading="lazy"',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'lazy_loading', expected: 'has_findings' }],
  expectedSuccess: false,
  tags: ['performance', 'lazy_loading'],
  rationale: 'demo-app has <img class="logo"> without loading="lazy" — gate finds issues and returns failure',
});

// =============================================================================
// Family: connection_count — external connection limits
// =============================================================================

push({
  description: 'connection_count: demo-app has no external connections',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'connection_count' }],
  expectedSuccess: true,
  tags: ['performance', 'connection_count'],
  rationale: 'No external script/link tags in demo-app HTML',
});

push({
  description: 'connection_count: low threshold should still pass (no externals)',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'connection_count', threshold: 1 }],
  expectedSuccess: true,
  tags: ['performance', 'connection_count'],
  rationale: 'Zero external connections < threshold of 1',
});

// =============================================================================
// Family: unminified_assets — check for unminified JS/CSS
// =============================================================================

push({
  description: 'unminified_assets: server.js is not minified (dev code)',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'unminified_assets', expected: 'has_findings' }],
  expectedSuccess: false,
  tags: ['performance', 'unminified_assets'],
  rationale: 'server.js has comments, whitespace, long variable names',
});

// =============================================================================
// Family: render_blocking — render-blocking resources
// =============================================================================

push({
  description: 'render_blocking: demo-app uses inline styles (no external CSS)',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'render_blocking', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['performance', 'render_blocking'],
  rationale: 'demo-app uses <style> blocks, no external CSS links to block render',
});

// =============================================================================
// Family: dom_depth — maximum DOM nesting depth (>15 is bad)
// =============================================================================

push({
  description: 'dom_depth: demo-app has reasonable nesting',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'dom_depth', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['performance', 'dom_depth'],
  rationale: 'demo-app HTML is not deeply nested (max ~6-7 levels)',
});

// =============================================================================
// Family: cache_headers — check for cache control
// =============================================================================

push({
  description: 'cache_headers: demo-app has no cache headers',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'cache_headers', expected: 'has_findings' }],
  expectedSuccess: true,
  tags: ['performance', 'cache_headers'],
  rationale: 'demo-app sets Content-Type but no Cache-Control headers',
});

// =============================================================================
// Family: duplicate_deps — duplicate dependencies
// =============================================================================

push({
  description: 'duplicate_deps: demo-app has no package.json deps',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'duplicate_deps', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['performance', 'duplicate_deps'],
  rationale: 'demo-app has no package.json with dependencies',
});

// =============================================================================
// Family: response_time — deferred/advisory check
// =============================================================================

push({
  description: 'response_time: advisory check passes (no live server)',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'response_time' }],
  expectedSuccess: true,
  tags: ['performance', 'response_time'],
  rationale: 'response_time is deferred/advisory without a running server',
});

// =============================================================================
// Family: multi — multiple performance checks
// =============================================================================

push({
  description: 'multi: bundle_size + dom_depth both pass',
  edits: [],
  predicates: [
    { type: 'performance', perfCheck: 'bundle_size' },
    { type: 'performance', perfCheck: 'dom_depth', expected: 'no_findings' },
  ],
  expectedSuccess: true,
  tags: ['performance', 'multi'],
  rationale: 'Both checks pass on demo-app',
});

push({
  description: 'multi: clean check + failing check',
  edits: [],
  predicates: [
    { type: 'performance', perfCheck: 'bundle_size' },
    { type: 'performance', perfCheck: 'bundle_size', threshold: 50 },
  ],
  expectedSuccess: false,
  tags: ['performance', 'multi_fail'],
  rationale: 'Second predicate has impossible threshold, gate fails',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} performance scenarios to ${outPath}`);
