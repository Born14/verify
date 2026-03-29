#!/usr/bin/env bun
/**
 * stage-drift-leaves.ts — Drift/Regression Scenario Stager
 *
 * Covers zero-coverage drift shapes from FAILURE-TAXONOMY.md:
 *   DR-01: Dependency update changes behavior
 *   DR-03: DB migration changes default behavior
 *   DR-04: API contract changes upstream
 *   DR-05: Runtime version drift
 *   DR-06: Container base image update
 *   DR-08: Certificate / credential expiry
 *   DR-09: External service availability
 *   DR-10: Indirect regression from transitive dependency
 *   DR-11: Docker base image layer changes silently
 *   DR-12: Browser version changes computed CSS defaults
 *   DR-13: Verification tool version changes behavior
 *
 * Pure tier — tests grounding gate with drift-related predicates.
 * Drift scenarios model situations where external changes break
 * previously-passing predicates without any code edits.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/drift-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `drift-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// DR-01: Dependency update changes behavior
// =============================================================================

push({
  description: 'DR-01: CSS framework class exists in source — passes grounding',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'font-family',
    expected: 'Arial, sans-serif',
  }],
  expectedSuccess: true,
  tags: ['drift', 'dependency_update', 'DR-01'],
});

push({
  description: 'DR-01: CSS class from updated framework — not in source',
  edits: [],
  predicates: [{
    type: 'css',
    selector: '.btn-primary-v2',
    property: 'background-color',
    expected: '#0d6efd',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'dependency_update', 'DR-01'],
});

push({
  description: 'DR-01: Content changed by dependency update — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'bootstrap-5.4-migration-notice',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'dependency_update', 'DR-01'],
});

// =============================================================================
// DR-03: DB migration changes default behavior
// =============================================================================

push({
  description: 'DR-03: Column with known default — table exists in schema',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'is_active',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['drift', 'migration_default_change', 'DR-03'],
});

push({
  description: 'DR-03: Column default changed by migration — column not in schema',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'activation_status',
    assertion: 'column_exists',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'migration_default_change', 'DR-03'],
});

push({
  description: 'DR-03: Old default value assertion — table exists but column renamed',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'active_flag',
    assertion: 'column_type',
    expected: 'BOOLEAN',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'migration_default_change', 'DR-03'],
});

// =============================================================================
// DR-04: API contract changes upstream
// =============================================================================

push({
  description: 'DR-04: Known API response content — passes grounding',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Alpha' },
  }],
  expectedSuccess: true,
  tags: ['drift', 'api_contract_change', 'DR-04'],
});

push({
  description: 'DR-04: Upstream API response shape changed — new field not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: '"items_v2"' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'api_contract_change', 'DR-04'],
});

push({
  description: 'DR-04: Content predicate referencing upstream contract — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'BREAKING_CHANGE_V2_RESPONSE',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'api_contract_change', 'DR-04'],
});

// =============================================================================
// DR-05: Runtime version drift
// =============================================================================

push({
  description: 'DR-05: Source code pattern unaffected by runtime — passes',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'createServer',
  }],
  expectedSuccess: true,
  tags: ['drift', 'runtime_version_drift', 'DR-05'],
});

push({
  description: 'DR-05: Runtime-specific API not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'node:test/reporters',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'runtime_version_drift', 'DR-05'],
});

push({
  description: 'DR-05: Node version-specific behavior in HTTP response',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'runtime_v20_feature' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'runtime_version_drift', 'DR-05'],
});

// =============================================================================
// DR-06: Container base image update
// =============================================================================

push({
  description: 'DR-06: Application code unchanged — passes grounding',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'listen',
  }],
  expectedSuccess: true,
  tags: ['drift', 'base_image_update', 'DR-06'],
});

push({
  description: 'DR-06: Package from updated base image — not in app source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'libssl3-replaced-by-alpine-upgrade',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'base_image_update', 'DR-06'],
});

// =============================================================================
// DR-08: Certificate / credential expiry
// =============================================================================

push({
  description: 'DR-08: Health endpoint unaffected by cert expiry — passes',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'ok' },
  }],
  expectedSuccess: true,
  tags: ['drift', 'cert_expiry', 'DR-08'],
});

push({
  description: 'DR-08: TLS certificate error body — not in source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'CERT_HAS_EXPIRED' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'cert_expiry', 'DR-08'],
});

push({
  description: 'DR-08: Expired credential message — fabricated content',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'credential_expired_at_2024',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'cert_expiry', 'DR-08'],
});

// =============================================================================
// DR-09: External service availability
// =============================================================================

push({
  description: 'DR-09: Local endpoint — unaffected by external service',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Alpha' },
  }],
  expectedSuccess: true,
  tags: ['drift', 'external_service_availability', 'DR-09'],
});

push({
  description: 'DR-09: External service error in response — fabricated',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'ECONNREFUSED stripe.com' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'external_service_availability', 'DR-09'],
});

// =============================================================================
// DR-10: Indirect regression from transitive dependency
// =============================================================================

push({
  description: 'DR-10: Direct code pattern — passes grounding',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'http',
  }],
  expectedSuccess: true,
  tags: ['drift', 'transitive_dependency', 'DR-10'],
});

push({
  description: 'DR-10: Transitive dependency artifact — not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'lodash@4.17.21_CVE_2024_fix',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'transitive_dependency', 'DR-10'],
});

// =============================================================================
// DR-11: Docker base image layer changes silently
// =============================================================================

push({
  description: 'DR-11: App content unaffected by image rebuild — passes',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/',
    expect: { status: 200, bodyContains: 'Demo App' },
  }],
  expectedSuccess: true,
  tags: ['drift', 'docker_silent_change', 'DR-11'],
});

push({
  description: 'DR-11: Image layer digest claim — not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'sha256:abc123def456_patched_openssl',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'docker_silent_change', 'DR-11'],
});

push({
  description: 'DR-11: Security patch side-effect in response — fabricated',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'openssl-3.1.5-patched' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'docker_silent_change', 'DR-11'],
});

// =============================================================================
// DR-12: Browser version changes computed CSS defaults
// =============================================================================

push({
  description: 'DR-12: Explicitly set CSS property — passes grounding',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'margin',
    expected: '0',
  }],
  expectedSuccess: true,
  tags: ['drift', 'browser_css_defaults', 'DR-12'],
});

push({
  description: 'DR-12: Browser-default CSS property — not in source stylesheets',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: '-webkit-font-smoothing',
    expected: 'antialiased',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'browser_css_defaults', 'DR-12'],
});

push({
  description: 'DR-12: Chrome-specific rendering property — not in source',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'text-size-adjust',
    expected: '100%',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'browser_css_defaults', 'DR-12'],
});

// =============================================================================
// DR-13: Verification tool version changes behavior
// =============================================================================

push({
  description: 'DR-13: Standard CSS property — unaffected by tool version',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'background-color',
    expected: '#1a1a2e',
  }],
  expectedSuccess: true,
  tags: ['drift', 'tool_version_change', 'DR-13'],
});

push({
  description: 'DR-13: Tool-normalized value claim — source has different format',
  edits: [],
  predicates: [{
    type: 'css',
    selector: 'body',
    property: 'background-color',
    expected: 'color(srgb 0.102 0.102 0.180)',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'tool_version_change', 'DR-13'],
});

push({
  description: 'DR-13: Playwright-specific normalization artifact — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'playwright_computed_style_v1.42',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['drift', 'tool_version_change', 'DR-13'],
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

console.log(`Generated ${scenarios.length} drift scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
