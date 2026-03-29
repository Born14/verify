#!/usr/bin/env bun
/**
 * stage-temporal-advanced.ts — Temporal Advanced Scenario Stager
 *
 * Covers zero-coverage temporal shapes from FAILURE-TAXONOMY.md:
 *   TO-02: Predicate passes transiently, regresses after async
 *   TO-03: Retry changes outcome without code change
 *   TO-04: Two predicates observe different app states
 *   TO-06: Debounce/throttle timing causes false negative
 *   TO-07: Animation/transition midpoint sampled
 *   TO-08: Eventual consistency in DB/API
 *   TO-09: Background job not finished before check
 *   TO-11: Timezone-dependent rendering
 *   TO-12: Daylight saving time transition
 *   TO-13: System clock drift / NTP correction
 *   TO-14: Locale-dependent date formatting
 *   TO-15: TTL-based expiry between check and use
 *
 * Pure tier — tests grounding gate with temporal-related predicates.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/temporal-advanced-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `temp-adv-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// TO-02: Predicate passes transiently, regresses after async
// =============================================================================

push({
  description: 'TO-02: Content that exists in source — passes grounding',
  edits: [],
  predicates: [{
    type: 'html',
    selector: 'h1',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'transient_pass', 'TO-02'],
});

push({
  description: 'TO-02: Async-loaded content claim — not in static source',
  edits: [],
  predicates: [{
    type: 'html',
    selector: '#async-loaded-widget',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'transient_pass', 'TO-02'],
});

push({
  description: 'TO-02: Content replaced by background worker — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'async_worker_replaced_content',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'transient_pass', 'TO-02'],
});

// =============================================================================
// TO-03: Retry changes outcome without code change
// =============================================================================

push({
  description: 'TO-03: Deterministic content — same on every request',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Alpha' },
  }],
  expectedSuccess: true,
  tags: ['temporal', 'retry_nondeterminism', 'TO-03'],
});

push({
  description: 'TO-03: Non-deterministic output claim — not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'random_uuid_per_request' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'retry_nondeterminism', 'TO-03'],
});

// =============================================================================
// TO-04: Two predicates observe different app states
// =============================================================================

push({
  description: 'TO-04: Both predicates grounded — both pass',
  edits: [],
  predicates: [
    { type: 'html', selector: 'h1', expected: 'exists', path: '/' },
    { type: 'css', selector: 'body', property: 'background-color', expected: '#1a1a2e' },
  ],
  expectedSuccess: true,
  tags: ['temporal', 'split_state_observation', 'TO-04'],
});

push({
  description: 'TO-04: HTML grounded but CSS references hydration-only class',
  edits: [],
  predicates: [
    { type: 'html', selector: 'h1', expected: 'exists', path: '/' },
    { type: 'css', selector: '.hydrated-only-class', property: 'display', expected: 'block' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'split_state_observation', 'TO-04'],
});

push({
  description: 'TO-04: Pre-hydration vs post-hydration HTML — fabricated selector',
  edits: [],
  predicates: [{
    type: 'html',
    selector: '#ssr-placeholder-replaced-by-hydration',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'split_state_observation', 'TO-04'],
});

// =============================================================================
// TO-06: Debounce/throttle timing causes false negative
// =============================================================================

push({
  description: 'TO-06: Static content unaffected by debounce — passes',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'items',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'debounce_timing', 'TO-06'],
});

push({
  description: 'TO-06: Debounced UI state claim — not in static source',
  edits: [],
  predicates: [{
    type: 'html',
    selector: '#search-results-debounced',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'debounce_timing', 'TO-06'],
});

// =============================================================================
// TO-07: Animation/transition midpoint sampled
// =============================================================================

push({
  description: 'TO-07: Final animation state in source — passes',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'background-color',
    expected: '#1a1a2e',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'animation_midpoint', 'TO-07'],
});

push({
  description: 'TO-07: Mid-animation computed value — not in source styles',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'background-color',
    expected: 'rgba(26, 26, 46, 0.5)',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'animation_midpoint', 'TO-07'],
});

push({
  description: 'TO-07: Transition progress indicator — fabricated',
  edits: [],
  predicates: [{
    type: 'css',
    selector: '.fade-in-progress',
    property: 'opacity',
    expected: '0.7',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'animation_midpoint', 'TO-07'],
});

// =============================================================================
// TO-08: Eventual consistency in DB/API
// =============================================================================

push({
  description: 'TO-08: Schema table exists — passes grounding',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    assertion: 'table_exists',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'eventual_consistency', 'TO-08'],
});

push({
  description: 'TO-08: Eventually-consistent read claim — column not in schema',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'eventual_replica_status',
    assertion: 'column_exists',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'eventual_consistency', 'TO-08'],
});

push({
  description: 'TO-08: Stale read response body — not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'stale_replica_version' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'eventual_consistency', 'TO-08'],
});

// =============================================================================
// TO-09: Background job not finished before check
// =============================================================================

push({
  description: 'TO-09: Synchronous content — passes grounding',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/',
    expect: { status: 200, bodyContains: 'Demo App' },
  }],
  expectedSuccess: true,
  tags: ['temporal', 'background_job_incomplete', 'TO-09'],
});

push({
  description: 'TO-09: Background job result claim — not in synchronous response',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'background_import_complete' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'background_job_incomplete', 'TO-09'],
});

// =============================================================================
// TO-11: Timezone-dependent rendering
// =============================================================================

push({
  description: 'TO-11: Timezone-independent content — passes',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'createServer',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'timezone_rendering', 'TO-11'],
});

push({
  description: 'TO-11: Timezone-specific rendered time — not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/',
    expect: { status: 200, bodyContains: '2024-03-15T08:00:00-05:00' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'timezone_rendering', 'TO-11'],
});

push({
  description: 'TO-11: UTC vs local display claim — fabricated HTML',
  edits: [],
  predicates: [{
    type: 'html',
    selector: '#local-time-display',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'timezone_rendering', 'TO-11'],
});

// =============================================================================
// TO-12: Daylight saving time transition
// =============================================================================

push({
  description: 'TO-12: Non-time-dependent content — passes',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'ok' },
  }],
  expectedSuccess: true,
  tags: ['temporal', 'dst_transition', 'TO-12'],
});

push({
  description: 'TO-12: DST-affected schedule claim — not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'DST_OFFSET_APPLIED',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'dst_transition', 'TO-12'],
});

// =============================================================================
// TO-13: System clock drift / NTP correction
// =============================================================================

push({
  description: 'TO-13: Static content unaffected by clock — passes',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'listen',
  }],
  expectedSuccess: true,
  tags: ['temporal', 'clock_drift', 'TO-13'],
});

push({
  description: 'TO-13: Timestamp-ordered assertion — clock-dependent value not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'sequence_id_1711500000' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'clock_drift', 'TO-13'],
});

// =============================================================================
// TO-14: Locale-dependent date formatting
// =============================================================================

push({
  description: 'TO-14: Non-localized content — passes',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/',
    expect: { status: 200, bodyContains: 'Demo App' },
  }],
  expectedSuccess: true,
  tags: ['temporal', 'locale_date_format', 'TO-14'],
});

push({
  description: 'TO-14: Locale-specific date format — not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/',
    expect: { status: 200, bodyContains: '15/03/2024' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'locale_date_format', 'TO-14'],
});

push({
  description: 'TO-14: toLocaleDateString output claim — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'Intl.DateTimeFormat_locale_override',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'locale_date_format', 'TO-14'],
});

// =============================================================================
// TO-15: TTL-based expiry between check and use
// =============================================================================

push({
  description: 'TO-15: Non-TTL content — passes grounding',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'ok' },
  }],
  expectedSuccess: true,
  tags: ['temporal', 'ttl_expiry', 'TO-15'],
});

push({
  description: 'TO-15: Expired session claim — not in source response',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'session_expired_between_check_and_deploy' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'ttl_expiry', 'TO-15'],
});

push({
  description: 'TO-15: TTL column not in schema',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'sessions',
    column: 'ttl_remaining_seconds',
    assertion: 'column_exists',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['temporal', 'ttl_expiry', 'TO-15'],
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  const tag = s.tags[2] || s.tags[1] || 'unknown';
  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
}

console.log(`Generated ${scenarios.length} temporal advanced scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
