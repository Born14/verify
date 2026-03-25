#!/usr/bin/env bun
/**
 * stage-g5-leaves.ts — G5 (Containment Attribution) Scenario Stager
 *
 * Generates scenarios that exercise the G5 gate: edit-to-predicate attribution.
 * G5 is advisory (always passes), so we test attribution classification quality.
 *
 * G5 classifies each edit as:
 *   - direct:      Edit content relates to a predicate (CSS property, selector, value)
 *   - scaffolding:  Edit is in a support file (Dockerfile, package.json, etc.)
 *   - unexplained:  No predicate explains this edit
 *
 * Scenario families:
 *   1. direct_css      — CSS edit with matching CSS predicate
 *   2. direct_content  — Content edit with matching content predicate
 *   3. direct_http     — Route edit with matching HTTP predicate
 *   4. direct_db       — SQL edit with matching DB predicate
 *   5. scaffolding     — Edit to Dockerfile/docker-compose/init.sql etc.
 *   6. unexplained     — Edit with no matching predicate
 *   7. mixed           — Multiple edits with different attributions
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/g5-staged.json');

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  /** Expected attribution for each edit (same order as edits array) */
  expectedAttributions?: Array<'direct' | 'scaffolding' | 'unexplained'>;
  expectedSummary?: { direct: number; scaffolding: number; unexplained: number };
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `g5-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. DIRECT CSS — edit content relates to CSS predicate
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('direct-css'),
  description: 'G5 direct: CSS color change matches CSS predicate (property in replace)',
  edits: [{
    file: 'server.js',
    search: "h1 { color: #1a1a2e; font-size: 2rem; }",
    replace: "h1 { color: red; font-size: 2rem; }",
  }],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: 'red', path: '/' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'css', 'property-match'],
  rationale: 'Replace text contains "color" (property) — attributed as direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

scenarios.push({
  id: nextId('direct-css'),
  description: 'G5 direct: CSS selector name in replace matches predicate',
  edits: [{
    file: 'server.js',
    search: ".hero { background: #3498db;",
    replace: ".hero { background: orange;",
  }],
  predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: 'orange', path: '/about' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'css', 'selector-match'],
  rationale: 'Replace contains "hero" (selector without dot) — attributed as direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

scenarios.push({
  id: nextId('direct-css'),
  description: 'G5 direct: CSS expected value in replace matches predicate',
  edits: [{
    file: 'server.js',
    search: ".badge { display: inline-block; background: #e74c3c;",
    replace: ".badge { display: inline-block; background: #27ae60;",
  }],
  predicates: [{ type: 'css', selector: '.badge', property: 'background', expected: '#27ae60', path: '/about' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'css', 'value-match'],
  rationale: 'Replace contains "#27ae60" (expected value) — attributed as direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. DIRECT CONTENT — edit file matches content predicate file
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('direct-content'),
  description: 'G5 direct: content predicate file matches edit file',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 8080;",
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'PORT' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'content', 'file-match'],
  rationale: 'Content predicate file "server.js" matches edit file — direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

scenarios.push({
  id: nextId('direct-content'),
  description: 'G5 direct: content predicate with config.json file',
  edits: [{
    file: 'config.json',
    search: '"darkMode": true',
    replace: '"darkMode": false',
  }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'darkMode' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'content', 'config-file'],
  rationale: 'Content predicate file matches edit file — direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DIRECT HTTP — route file edit with HTTP predicate
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('direct-http'),
  description: 'G5 direct: HTTP predicate path appears in edit replace text',
  edits: [{
    file: 'server.js',
    search: "{ status: 'ok' }",
    replace: "{ status: 'healthy', endpoint: '/health' }",
  }],
  predicates: [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'http', 'path-in-replace'],
  rationale: 'Replace text contains "/health" (predicate path) — attributed as direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

// HTTP predicate where path NOT in replace — falls to scaffolding (route file + predicate has path)
scenarios.push({
  id: nextId('scaffold-http'),
  description: 'G5 scaffolding: HTTP predicate path NOT in edit replace (route file fallback)',
  edits: [{
    file: 'server.js',
    search: "{ status: 'ok' }",
    replace: "{ status: 'healthy', version: '2.0' }",
  }],
  predicates: [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['g5', 'scaffolding', 'http', 'route-file-fallback'],
  rationale: 'Replace text does NOT contain "/health" but edit is in route file with path predicate — scaffolding',
  expectedAttributions: ['scaffolding'],
  expectedSummary: { direct: 0, scaffolding: 1, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DIRECT DB — SQL file edit with DB predicate
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('direct-db'),
  description: 'G5 direct: SQL file edit with DB predicate',
  edits: [{
    file: 'init.sql',
    search: 'username VARCHAR(50) NOT NULL UNIQUE,',
    replace: 'username VARCHAR(100) NOT NULL UNIQUE,',
  }],
  predicates: [{ type: 'db', table: 'users', assertion: 'column_type', column: 'username', expected: 'varchar(100)' }],
  expectedSuccess: true,
  tags: ['g5', 'direct', 'db', 'sql-match'],
  rationale: 'init.sql matches /\\.sql$/i pattern for DB predicates — direct',
  expectedAttributions: ['direct'],
  expectedSummary: { direct: 1, scaffolding: 0, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. SCAFFOLDING — support files always classified as scaffolding
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('scaffold'),
  description: 'G5 scaffolding: Dockerfile edit with HTTP predicate',
  edits: [{
    file: 'Dockerfile',
    search: 'FROM node:20-alpine',
    replace: 'FROM node:22-alpine',
  }],
  predicates: [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['g5', 'scaffolding', 'dockerfile'],
  rationale: 'Dockerfile is a scaffolding file — classified as scaffolding regardless of predicate',
  expectedAttributions: ['scaffolding'],
  expectedSummary: { direct: 0, scaffolding: 1, unexplained: 0 },
});

scenarios.push({
  id: nextId('scaffold'),
  description: 'G5 scaffolding: docker-compose.yml edit',
  edits: [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 5',
  }],
  predicates: [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['g5', 'scaffolding', 'docker-compose'],
  rationale: 'docker-compose.yml is a scaffolding file',
  expectedAttributions: ['scaffolding'],
  expectedSummary: { direct: 0, scaffolding: 1, unexplained: 0 },
});

// init.sql is scaffolding when predicate is NOT db
scenarios.push({
  id: nextId('scaffold'),
  description: 'G5 scaffolding: init.sql edit with non-DB predicate',
  edits: [{
    file: 'init.sql',
    search: 'username VARCHAR(50) NOT NULL UNIQUE,',
    replace: 'username VARCHAR(100) NOT NULL UNIQUE,',
  }],
  predicates: [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['g5', 'scaffolding', 'init-sql', 'no-db-predicate'],
  rationale: 'init.sql is scaffolding file — attributed as scaffolding when no DB predicate exists',
  expectedAttributions: ['scaffolding'],
  expectedSummary: { direct: 0, scaffolding: 1, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. UNEXPLAINED — edit with no matching predicate
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('unexplained'),
  description: 'G5 unexplained: .env edit with content predicate for different file',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=true',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'PORT' }],
  expectedSuccess: true,
  tags: ['g5', 'unexplained', 'env-file'],
  rationale: '.env does not match content predicate file "server.js" — not scaffolding either — unexplained',
  expectedAttributions: ['unexplained'],
  expectedSummary: { direct: 0, scaffolding: 0, unexplained: 1 },
});

// server.js edit but predicate is content for a different file
scenarios.push({
  id: nextId('unexplained'),
  description: 'G5 unexplained: server.js edit with content predicate for config.json',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = 8080;",
  }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'darkMode' }],
  expectedSuccess: true,
  tags: ['g5', 'unexplained', 'wrong-file-match'],
  rationale: 'Content predicate file is config.json but edit is server.js — no match. Server.js is a route file but content predicate has no path — unexplained',
  expectedAttributions: ['unexplained'],
  expectedSummary: { direct: 0, scaffolding: 0, unexplained: 1 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. MIXED — multiple edits with different attributions
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('mixed'),
  description: 'G5 mixed: direct content + scaffolding Dockerfile + unexplained .env',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 8080;" },
    { file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:22-alpine' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'PORT' }],
  expectedSuccess: true,
  tags: ['g5', 'mixed', 'all-three-types'],
  rationale: 'server.js edit=direct (content file match), Dockerfile=scaffolding, .env=unexplained',
  expectedAttributions: ['direct', 'scaffolding', 'unexplained'],
  expectedSummary: { direct: 1, scaffolding: 1, unexplained: 1 },
});

scenarios.push({
  id: nextId('mixed'),
  description: 'G5 mixed: two direct edits (CSS + content) in same file',
  edits: [
    { file: 'server.js', search: "h1 { color: #1a1a2e; font-size: 2rem; }", replace: "h1 { color: red; font-size: 2rem; }" },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = 8080;" },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: 'red', path: '/' },
    { type: 'content', file: 'server.js', pattern: 'PORT' },
  ],
  expectedSuccess: true,
  tags: ['g5', 'mixed', 'two-direct'],
  rationale: 'Both edits match different predicates — both direct',
  expectedAttributions: ['direct', 'direct'],
  expectedSummary: { direct: 2, scaffolding: 0, unexplained: 0 },
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. NO PREDICATES — all edits should be unexplained (or scaffolding)
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('nopred'),
  description: 'G5 no predicates: server.js edit with empty predicate list',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = 8080;",
  }],
  predicates: [],
  expectedSuccess: true,
  tags: ['g5', 'no-predicates', 'should-pass'],
  rationale: 'No predicates to match — all edits are unexplained. G5 is advisory, still passes.',
  expectedAttributions: ['unexplained'],
  expectedSummary: { direct: 0, scaffolding: 0, unexplained: 1 },
});

// ═════════════════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ═════════════════════════════════════════════════════════════════════════════

writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const shouldPass = scenarios.filter(s => s.expectedSuccess).length;
const shouldFail = scenarios.filter(s => !s.expectedSuccess).length;

console.log(`\n✅ Generated ${scenarios.length} G5 scenarios → ${OUTPUT_PATH}`);
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
