#!/usr/bin/env bun
/**
 * stage-k5-leaves.ts — K5 (Constraint Enforcement) Scenario Stager
 *
 * Generates scenarios that exercise the K5 gate: constraint checking against
 * learned failures. K5 is the gate between F9 (syntax) and G5 (containment).
 *
 * K5 checks:
 *   1. Predicate fingerprint ban — exact predicate was tried and failed before
 *   2. Goal drift ban — all predicates are UI but plan touches schema/config
 *   3. Radius limit — plan touches more files than allowed
 *   4. File pattern — plan touches constrained files without required patterns
 *   5. Action class (strategy ban) — same strategy failed 2+ times
 *
 * K5 seeding:
 *   - Harness faults never seed (infrastructure broke, not agent)
 *   - Syntax failures alone can't seed (need corroboration)
 *   - Evidence failures always seed (strongest signal)
 *   - Strategy ban after 2+ failures of same action class
 *   - Radius shrinks: attempt 2→5 files, 3→3, 4→2, 5+→1
 *
 * Each scenario needs a pre-seeded stateDir with memory.jsonl containing
 * the right constraints for that test case.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const DEMO_DIR = resolve(__dirname, '../../fixtures/demo-app');
const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/k5-staged.json');

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
  rationale: string;
  /** K5 scenarios need pre-seeded state. This is the fixture subdir name. */
  stateFixture?: string;
  /** Or inline constraints to seed before running */
  seedConstraints?: any[];
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `k5-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Helper to compute fingerprint (same algo as constraint-store.ts)
function fingerprint(p: Record<string, any>): string {
  const parts = [`type=${p.type}`];
  if (p.selector != null) parts.push(`selector=${p.selector}`);
  if (p.property != null) parts.push(`property=${p.property}`);
  if (p.expected != null) parts.push(`exp=${p.expected}`);
  if (p.path != null) parts.push(`path=${p.path}`);
  if (p.method != null) parts.push(`method=${p.method}`);
  if (p.table != null) parts.push(`table=${p.table}`);
  if (p.pattern != null) parts.push(`pattern=${p.pattern}`);
  if (p.expect) {
    if (p.expect.status != null) parts.push(`status=${p.expect.status}`);
    if (p.expect.bodyContains != null) {
      const bc = Array.isArray(p.expect.bodyContains)
        ? p.expect.bodyContains.join(',')
        : p.expect.bodyContains;
      parts.push(`body=${bc}`);
    }
    if (p.expect.bodyRegex != null) parts.push(`regex=${p.expect.bodyRegex}`);
  }
  return parts.join('|');
}

const futureExpiry = Date.now() + 60 * 60 * 1000; // 1hr from now
const pastExpiry = Date.now() - 60 * 60 * 1000; // 1hr ago

// ═════════════════════════════════════════════════════════════════════════════
// 1. NO CONSTRAINTS — clean state, everything passes
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('clean'),
  description: 'K5 clean state: no constraints, edit should pass',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e', path: '/' }],
  expectedSuccess: true,
  tags: ['k5', 'clean-state', 'should-pass'],
  rationale: 'No constraints seeded — K5 passes with 0 active constraints',
  seedConstraints: [],
});

scenarios.push({
  id: nextId('clean'),
  description: 'K5 clean state: multi-file edit, no constraints',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'clean-state', 'multi-file', 'should-pass'],
  rationale: 'No constraints — multi-file edit passes K5',
  seedConstraints: [],
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PREDICATE FINGERPRINT BAN — exact predicate blocked
// ═════════════════════════════════════════════════════════════════════════════

// Banned CSS predicate
const bannedCSSPred = { type: 'css', selector: '.hero', property: 'background', expected: 'red', path: '/about' };
const bannedCSSFingerprint = fingerprint(bannedCSSPred);

scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: exact CSS predicate is banned',
  edits: [{ file: 'server.js', search: ".hero { background: #3498db;", replace: ".hero { background: red;" }],
  predicates: [bannedCSSPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'fingerprint-ban', 'css', 'should-fail'],
  rationale: 'Predicate fingerprint matches a banned fingerprint from prior O.5b failure',
  seedConstraints: [{
    id: 'k5-fp-css-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedCSSFingerprint] },
    reason: 'Predicate failed at O.5b evidence gate',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Different predicate for same selector — should NOT be banned
scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: different property on same selector NOT banned',
  edits: [{ file: 'server.js', search: ".hero { background: #3498db;", replace: ".hero { background: blue;" }],
  predicates: [{ type: 'css', selector: '.hero', property: 'color', expected: 'white', path: '/about' }],
  expectedSuccess: true,
  tags: ['k5', 'fingerprint-ban', 'css', 'different-property', 'should-pass'],
  rationale: 'Same selector but different property — fingerprint differs, not banned',
  seedConstraints: [{
    id: 'k5-fp-css-02',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedCSSFingerprint] },
    reason: 'Predicate failed at O.5b evidence gate',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Banned HTTP predicate
const bannedHTTPPred = { type: 'http', path: '/health', method: 'GET', expect: { status: 200, bodyContains: 'ok' } };
const bannedHTTPFingerprint = fingerprint(bannedHTTPPred);

scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: exact HTTP predicate is banned',
  edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'healthy' }" }],
  predicates: [bannedHTTPPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'fingerprint-ban', 'http', 'should-fail'],
  rationale: 'HTTP predicate fingerprint banned from prior failure',
  seedConstraints: [{
    id: 'k5-fp-http-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedHTTPFingerprint] },
    reason: 'HTTP predicate failed at O.5b',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Banned DB predicate
const bannedDBPred = { type: 'db', table: 'users', assertion: 'column_exists', column: 'avatar_url' };
const bannedDBFingerprint = fingerprint(bannedDBPred);

scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: exact DB predicate is banned',
  edits: [{ file: 'init.sql', search: 'username VARCHAR(50) NOT NULL UNIQUE,', replace: 'username VARCHAR(50) NOT NULL UNIQUE,\n    avatar_url TEXT,' }],
  predicates: [bannedDBPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'fingerprint-ban', 'db', 'should-fail'],
  rationale: 'DB predicate fingerprint banned from prior failure',
  seedConstraints: [{
    id: 'k5-fp-db-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['init.sql'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedDBFingerprint] },
    reason: 'DB predicate failed at evidence',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Multiple predicates: one banned, one not — should still fail
const unbannedPred = { type: 'css', selector: 'body', property: 'background', expected: '#ffffff', path: '/' };
scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: one of two predicates is banned (still fails)',
  edits: [{ file: 'server.js', search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }", replace: "body { font-family: sans-serif; margin: 2rem; background: #f0f0f0; color: #333; }" }],
  predicates: [unbannedPred, bannedCSSPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'fingerprint-ban', 'mixed-predicates', 'should-fail'],
  rationale: 'One banned predicate in the set is enough to trigger K5 violation',
  seedConstraints: [{
    id: 'k5-fp-mixed-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedCSSFingerprint] },
    reason: 'One predicate failed at O.5b',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. EXPIRED CONSTRAINTS — should be ignored
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('expired'),
  description: 'K5 expired: fingerprint ban with past expiresAt (ignored)',
  edits: [{ file: 'server.js', search: ".hero { background: #3498db;", replace: ".hero { background: red;" }],
  predicates: [bannedCSSPred],
  expectedSuccess: true,
  tags: ['k5', 'expired', 'fingerprint-ban', 'should-pass'],
  rationale: 'Constraint expired 1hr ago — K5 skips it',
  seedConstraints: [{
    id: 'k5-expired-fp-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedCSSFingerprint] },
    reason: 'This was banned but expired',
    introducedAt: Date.now() - 2 * 60 * 60 * 1000,
    expiresAt: pastExpiry,
  }],
});

scenarios.push({
  id: nextId('expired'),
  description: 'K5 expired: radius limit with past expiresAt (ignored)',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'expired', 'radius-limit', 'should-pass'],
  rationale: 'Radius limit expired — 3-file edit passes',
  seedConstraints: [{
    id: 'k5-expired-radius-01',
    type: 'radius_limit',
    signature: 'radius_1',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: { maxFiles: 1 },
    reason: 'Was limited to 1 file but expired',
    introducedAt: Date.now() - 2 * 60 * 60 * 1000,
    expiresAt: pastExpiry,
  }],
});

scenarios.push({
  id: nextId('expired'),
  description: 'K5 expired: strategy ban with past expiresAt (ignored)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'expired', 'strategy-ban', 'should-pass'],
  rationale: 'Strategy ban expired — edit passes',
  seedConstraints: [{
    id: 'k5-expired-strat-01',
    type: 'forbidden_action',
    signature: 'rewrite_page',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'Strategy ban expired',
    introducedAt: Date.now() - 2 * 60 * 60 * 1000,
    expiresAt: pastExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. RADIUS LIMIT — file count constraint
// ═════════════════════════════════════════════════════════════════════════════

// Radius limit = 1 file, editing 1 file → pass
scenarios.push({
  id: nextId('radius'),
  description: 'K5 radius limit: 1 file allowed, 1 file edited (passes)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'radius-limit', 'within-limit', 'should-pass'],
  rationale: 'Editing 1 file when limit is 1 — exactly at boundary',
  seedConstraints: [{
    id: 'k5-radius-01',
    type: 'radius_limit',
    signature: 'radius_1',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: { maxFiles: 1 },
    reason: 'Attempt 5+: limited to 1 file',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Radius limit = 1 file, editing 2 files → fail
scenarios.push({
  id: nextId('radius'),
  description: 'K5 radius limit: 1 file allowed, 2 files edited (fails)',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'radius-limit', 'over-limit', 'should-fail'],
  rationale: 'Editing 2 files when limit is 1 — radius violation',
  seedConstraints: [{
    id: 'k5-radius-02',
    type: 'radius_limit',
    signature: 'radius_1',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: { maxFiles: 1 },
    reason: 'Attempt 5+: limited to 1 file',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Radius limit = 3, editing 3 → pass
scenarios.push({
  id: nextId('radius'),
  description: 'K5 radius limit: 3 files allowed, 3 files edited (passes)',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'radius-limit', 'at-boundary', 'should-pass'],
  rationale: 'Editing 3 files when limit is 3 — exactly at boundary',
  seedConstraints: [{
    id: 'k5-radius-03',
    type: 'radius_limit',
    signature: 'radius_3',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: { maxFiles: 3 },
    reason: 'Attempt 3: limited to 3 files',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Radius limit = 3, editing 4 → fail
scenarios.push({
  id: nextId('radius'),
  description: 'K5 radius limit: 3 files allowed, 4 files edited (fails)',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
    { file: 'init.sql', search: 'username VARCHAR(50)', replace: 'username VARCHAR(100)' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'radius-limit', 'over-boundary', 'should-fail'],
  rationale: 'Editing 4 files when limit is 3',
  seedConstraints: [{
    id: 'k5-radius-04',
    type: 'radius_limit',
    signature: 'radius_3',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: { maxFiles: 3 },
    reason: 'Attempt 3: limited to 3 files',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. STRATEGY BAN — action class blocked (empty surface = pure strategy ban)
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('stratban'),
  description: 'K5 strategy ban: rewrite_page strategy blocked',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'strategy-ban', 'action-class', 'should-fail'],
  rationale: 'Strategy ban with empty surface blocks any edit matching the change type',
  seedConstraints: [{
    id: 'k5-strat-01',
    type: 'forbidden_action',
    signature: 'rewrite_page',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'rewrite_page strategy failed 3 times',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Strategy ban with changeType filter — only blocks matching changeType
scenarios.push({
  id: nextId('stratban'),
  description: 'K5 strategy ban: scoped to schema changeType, UI edit passes',
  edits: [{ file: 'server.js', search: "color: #1a1a2e;", replace: "color: red;" }],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: 'red', path: '/' }],
  expectedSuccess: true,
  tags: ['k5', 'strategy-ban', 'changetype-filter', 'should-pass'],
  rationale: 'Strategy ban scoped to schema changeType — server.js edit is "ui" or "logic"',
  seedConstraints: [{
    id: 'k5-strat-02',
    type: 'forbidden_action',
    signature: 'schema_migration',
    scope: 'planning',
    appliesTo: ['schema'],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'Schema migrations banned',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. GOAL DRIFT BAN — change type restricted
// ═════════════════════════════════════════════════════════════════════════════

// Goal drift ban scoped to schema/config/infra — logic edit passes
scenarios.push({
  id: nextId('drift'),
  description: 'K5 goal drift: ban scoped to schema/config/infra, logic edit passes',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'goal-drift', 'changetype-mismatch', 'should-pass'],
  rationale: 'Goal drift ban appliesTo schema/config/infra but edit is logic — skipped by appliesTo filter',
  seedConstraints: [{
    id: 'k5-drift-01',
    type: 'goal_drift_ban',
    signature: 'goal_drift',
    scope: 'planning',
    appliesTo: ['schema', 'config', 'infra'],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'Goal was pure UI but plan changed schema',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Goal drift ban with empty appliesTo — triggers for ANY changeType
scenarios.push({
  id: nextId('drift'),
  description: 'K5 goal drift: ban with empty appliesTo blocks everything',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'goal-drift', 'blanket-ban', 'should-fail'],
  rationale: 'Goal drift ban with empty appliesTo — no changeType filter, blocks all edits',
  seedConstraints: [{
    id: 'k5-drift-02',
    type: 'goal_drift_ban',
    signature: 'goal_drift',
    scope: 'planning',
    appliesTo: [],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'Goal drift ban — blocks all change types',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Goal drift ban matching: Dockerfile edit is "config" changeType
scenarios.push({
  id: nextId('drift'),
  description: 'K5 goal drift: ban scoped to config, Dockerfile edit is config (fails)',
  edits: [{ file: 'Dockerfile', search: "FROM node:20-alpine", replace: "FROM node:22-alpine" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'node' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'goal-drift', 'changetype-match', 'should-fail'],
  rationale: 'Dockerfile edit classified as config — matches goal drift ban scoped to config',
  seedConstraints: [{
    id: 'k5-drift-03',
    type: 'goal_drift_ban',
    signature: 'goal_drift',
    scope: 'planning',
    appliesTo: ['config'],
    surface: { files: [], intents: [] },
    requires: {},
    reason: 'Config changes banned (Dockerfile = config changeType)',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. FILE PATTERN — constrained files need required patterns
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('filepat'),
  description: 'K5 file pattern: edit touches constrained file (fails)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'file-pattern', 'constrained-file', 'should-fail'],
  rationale: 'Edit touches server.js which is constrained — requires /health pattern',
  seedConstraints: [{
    id: 'k5-filepat-01',
    type: 'forbidden_action',
    signature: 'health_check_failure',
    scope: 'planning',
    appliesTo: ['ui', 'logic'],
    surface: { files: ['server.js'], intents: [] },
    requires: { patterns: ['/health'] },
    reason: 'Repeated 502 failures without health check',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// Edit touches unconstrained file — passes
scenarios.push({
  id: nextId('filepat'),
  description: 'K5 file pattern: edit touches unconstrained file (passes)',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'darkMode' }],
  expectedSuccess: true,
  tags: ['k5', 'file-pattern', 'unconstrained-file', 'should-pass'],
  rationale: 'config.json not in constraint surface — passes K5',
  seedConstraints: [{
    id: 'k5-filepat-02',
    type: 'forbidden_action',
    signature: 'health_check_failure',
    scope: 'planning',
    appliesTo: ['ui', 'logic'],
    surface: { files: ['server.js'], intents: [] },
    requires: { patterns: ['/health'] },
    reason: 'Only server.js is constrained',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. MULTIPLE CONSTRAINTS — compounding effects
// ═════════════════════════════════════════════════════════════════════════════

// Radius limit + fingerprint ban — fails on first matching constraint
scenarios.push({
  id: nextId('multi'),
  description: 'K5 multiple constraints: radius limit + fingerprint ban (both active)',
  edits: [
    { file: 'server.js', search: ".hero { background: #3498db;", replace: ".hero { background: red;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
  ],
  predicates: [bannedCSSPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'multiple-constraints', 'compounding', 'should-fail'],
  rationale: 'Both fingerprint ban AND radius violation apply',
  seedConstraints: [
    {
      id: 'k5-multi-fp-01',
      type: 'forbidden_action',
      signature: 'predicate_mismatch',
      scope: 'planning',
      appliesTo: [],
      surface: { files: ['server.js'], intents: [] },
      requires: { bannedPredicateFingerprints: [bannedCSSFingerprint] },
      reason: 'Predicate fingerprint banned',
      introducedAt: Date.now(),
      expiresAt: futureExpiry,
    },
    {
      id: 'k5-multi-radius-01',
      type: 'radius_limit',
      signature: 'radius_1',
      scope: 'planning',
      appliesTo: [],
      surface: { files: [], intents: [] },
      requires: { maxFiles: 1 },
      reason: 'Max 1 file',
      introducedAt: Date.now(),
      expiresAt: futureExpiry,
    },
  ],
});

// One expired + one active — only active matters
scenarios.push({
  id: nextId('multi'),
  description: 'K5 multiple constraints: one expired, one active radius limit',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
    { file: 'Dockerfile', search: "EXPOSE 3000", replace: "EXPOSE 8080" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'multiple-constraints', 'mixed-expiry', 'should-fail'],
  rationale: 'Expired strategy ban ignored, but active radius limit of 1 blocks 2-file edit',
  seedConstraints: [
    {
      id: 'k5-multi-expired-01',
      type: 'forbidden_action',
      signature: 'rewrite_page',
      scope: 'planning',
      appliesTo: [],
      surface: { files: [], intents: [] },
      requires: {},
      reason: 'This one is expired',
      introducedAt: Date.now() - 2 * 60 * 60 * 1000,
      expiresAt: pastExpiry,
    },
    {
      id: 'k5-multi-active-01',
      type: 'radius_limit',
      signature: 'radius_1',
      scope: 'planning',
      appliesTo: [],
      surface: { files: [], intents: [] },
      requires: { maxFiles: 1 },
      reason: 'This one is active',
      introducedAt: Date.now(),
      expiresAt: futureExpiry,
    },
  ],
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. CONSTRAINT OVERRIDE — explicitly bypassed constraints
// ═════════════════════════════════════════════════════════════════════════════

// Note: override is passed via config.overrideConstraints, not via scenario.
// The runner needs to support this. For now, test that the constraint EXISTS
// and WOULD block — the override mechanism is a runner feature.

// ═════════════════════════════════════════════════════════════════════════════
// 10. CONTENT PREDICATE FINGERPRINT BAN
// ═════════════════════════════════════════════════════════════════════════════

const bannedContentPred = { type: 'content', file: 'server.js', pattern: 'express' };
const bannedContentFingerprint = fingerprint(bannedContentPred);

scenarios.push({
  id: nextId('fpban'),
  description: 'K5 fingerprint ban: content predicate banned',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "const express = require('express');" }],
  predicates: [bannedContentPred],
  expectedSuccess: false,
  expectedFailedGate: 'K5',
  tags: ['k5', 'fingerprint-ban', 'content', 'should-fail'],
  rationale: 'Content predicate fingerprint matches banned list',
  seedConstraints: [{
    id: 'k5-fp-content-01',
    type: 'forbidden_action',
    signature: 'predicate_mismatch',
    scope: 'planning',
    appliesTo: [],
    surface: { files: ['server.js'], intents: [] },
    requires: { bannedPredicateFingerprints: [bannedContentFingerprint] },
    reason: 'Content predicate failed at evidence',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. CHANGETYPE SCOPING — constraint only applies to certain change types
// ═════════════════════════════════════════════════════════════════════════════

// server.js-only edit = "logic" changeType, constraint scoped to "infra"
scenarios.push({
  id: nextId('scope'),
  description: 'K5 changetype scope: constraint applies to infra, edit is logic (passes)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http' }],
  expectedSuccess: true,
  tags: ['k5', 'changetype-scope', 'mismatch', 'should-pass'],
  rationale: 'Constraint scoped to infra changeType, server.js edit is logic — K5 skips',
  seedConstraints: [{
    id: 'k5-scope-01',
    type: 'forbidden_action',
    signature: 'some_ban',
    scope: 'planning',
    appliesTo: ['infra'],
    surface: { files: ['server.js'], intents: [] },
    requires: { patterns: ['/nonexistent'] },
    reason: 'Scoped to infra only',
    introducedAt: Date.now(),
    expiresAt: futureExpiry,
  }],
});

// ═════════════════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ═════════════════════════════════════════════════════════════════════════════

writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const shouldPass = scenarios.filter(s => s.expectedSuccess).length;
const shouldFail = scenarios.filter(s => !s.expectedSuccess).length;

console.log(`\n✅ Generated ${scenarios.length} K5 scenarios → ${OUTPUT_PATH}`);
console.log(`   Should pass: ${shouldPass}`);
console.log(`   Should fail: ${shouldFail}`);

const families: Record<string, number> = {};
for (const s of scenarios) {
  const fam = s.tags[1] || 'unknown';
  families[fam] = (families[fam] || 0) + 1;
}
console.log('\nBy family:');
for (const [fam, count] of Object.entries(families).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${fam}: ${count}`);
}
