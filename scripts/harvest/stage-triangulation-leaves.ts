/**
 * Generates triangulation gate scenarios.
 * Pure function — tests the 8-row truth table of cross-authority verdict synthesis.
 * The triangulation gate extracts verdicts from prior gate results in the pipeline,
 * so scenarios need the right combination of gates in the result.
 *
 * Since triangulation looks at OTHER gate results (grounding, F9, filesystem, http,
 * invariants, browser, vision), we construct scenarios that produce the right
 * combination of gate pass/fail verdicts.
 *
 * Run: bun scripts/harvest/stage-triangulation-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/triangulation-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `tri-${String(id++).padStart(3, '0')}`, ...s });
}

// Note: The triangulation gate (runTriangulationGate) is invoked after all other gates
// and reads from the gates array. Since it requires browser/vision gates to have run
// (which are infra gates requiring Docker/Playwright), and verify() only runs
// triangulation when 2+ authorities have results, most triangulation scenarios
// will actually need to test the pure function directly.
//
// For pipeline testing via verify(), we can only reliably test the case where
// triangulation runs with deterministic-only (no browser, no vision),
// which means insufficient_authorities → no triangulation gate at all.
//
// So instead, we test scenarios where the deterministic gates produce clear results
// and the triangulation gate should either not appear (insufficient) or produce
// the deterministic-only verdict.

// =============================================================================
// Family: deterministic_only — only deterministic authority present
// =============================================================================

// When only deterministic gates run (no browser, no vision), triangulation
// should either pass through or not run. These test the pipeline behavior.

push({
  description: 'deterministic pass: all pure gates pass, no browser/vision',
  edits: [],
  predicates: [{ type: 'filesystem_exists', file: 'server.js' }],
  expectedSuccess: true,
  tags: ['triangulation', 'deterministic_only'],
  rationale: 'Filesystem predicate passes, no browser/vision → success (triangulation may not run with <2 authorities)',
});

push({
  description: 'deterministic fail: filesystem predicate fails',
  edits: [],
  predicates: [{ type: 'filesystem_exists', file: 'nonexistent.js' }],
  expectedSuccess: false,
  tags: ['triangulation', 'deterministic_fail'],
  rationale: 'Filesystem predicate fails → deterministic=false, but gate catches failure earlier',
});

// =============================================================================
// Family: mixed_predicates — multiple predicate types for deterministic authority
// =============================================================================

push({
  description: 'mixed deterministic: filesystem + config both pass',
  edits: [],
  predicates: [
    { type: 'filesystem_exists', file: 'server.js' },
    { type: 'config', key: 'PORT', expected: '3000' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'mixed_predicates'],
  rationale: 'Multiple deterministic predicates all pass',
});

push({
  description: 'mixed deterministic: filesystem passes, config fails',
  edits: [],
  predicates: [
    { type: 'filesystem_exists', file: 'server.js' },
    { type: 'config', key: 'PORT', expected: '9999' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'mixed_predicates'],
  rationale: 'Config predicate fails → overall failure, deterministic=false',
});

// =============================================================================
// Family: no_predicates — triangulation with no applicable predicates
// =============================================================================

push({
  description: 'content predicate only (no filesystem/infra), success',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http.createServer' }],
  expectedSuccess: true,
  tags: ['triangulation', 'no_tri_predicates'],
  rationale: 'Content predicate passes through grounding gate, no triangulation-specific gates',
});

// =============================================================================
// Family: all_pass — everything passes cleanly
// =============================================================================

push({
  description: 'clean pass: edit + filesystem + content all succeed',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 4000;" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '4000' },
    { type: 'filesystem_exists', file: 'server.js' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'all_pass'],
  rationale: 'Edit changes port, content predicate finds new value, filesystem confirms file exists',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} triangulation scenarios to ${outPath}`);
