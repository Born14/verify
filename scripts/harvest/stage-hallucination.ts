#!/usr/bin/env bun
/**
 * stage-hallucination.ts — Hallucination Gate Scenario Generator
 *
 * 30 scenarios covering HAL-01 through HAL-15 (15 shapes, 2 per shape:
 * one grounded claim that should pass, one fabricated claim the gate must catch).
 *
 * All scenarios use the demo-app fixture which has:
 *   - init.sql: users, posts, sessions, settings tables
 *   - server.js: routes /, /about, /form, /edge-cases, /api/items, /api/echo, /health
 *   - config.json: { app: { name, port }, database: { host, port, name }, features: { darkMode, analytics } }
 *   - CSS: .nav-link, .hero, .card, .badge, .team-list, .items, etc.
 *
 * Run: bun scripts/harvest/stage-hallucination.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/hallucination-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({
    id: `hal-${String(id++).padStart(3, '0')}`,
    ...s,
  });
}

// =============================================================================
// HAL-01: Invented statistic — number not in source material
// =============================================================================

push({
  description: 'HAL-01: Agent claims 73% stat exists in content (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: '73% of users prefer dark mode',
    source: 'content',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-01', 'factual-fabrication'],
  rationale: 'No such statistic exists anywhere in the demo app source files.',
});

push({
  description: 'HAL-01: Agent claims "Demo App" title exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'Demo App',
    source: 'content',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-01', 'factual-grounded'],
  rationale: '"Demo App" appears in server.js title and heading.',
});

// =============================================================================
// HAL-02: Invented entity — person/org/product not in source
// =============================================================================

push({
  description: 'HAL-02: Agent claims AcmeCorp exists in source (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'AcmeCorp',
    source: 'content',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-02', 'factual-fabrication'],
  rationale: 'No entity "AcmeCorp" exists in any source file.',
});

push({
  description: 'HAL-02: Agent claims Alice exists in source (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'Alice',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-02', 'factual-grounded'],
  rationale: 'Alice appears in the team list and data table in server.js.',
});

// =============================================================================
// HAL-03: Invented API parameter — field not in schema
// =============================================================================

push({
  description: 'HAL-03: Agent claims sortBy parameter exists in API (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'sortBy',
    source: 'server.js',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-03', 'factual-fabrication'],
  rationale: 'No sortBy parameter exists in any route handler.',
});

push({
  description: 'HAL-03: Agent claims /api/items route handler has "Alpha" (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'Alpha',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-03', 'factual-grounded'],
  rationale: '"Alpha" is returned by /api/items in server.js.',
});

// =============================================================================
// HAL-04: Invented file/function — reference to non-existent code
// =============================================================================

push({
  description: 'HAL-04: Agent claims utils/helpers.ts exists (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'utils/helpers.ts',
    source: 'files',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-04', 'factual-fabrication'],
  rationale: 'No utils/helpers.ts file exists in the demo app.',
});

push({
  description: 'HAL-04: Agent claims server.js exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'server.js',
    source: 'files',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-04', 'factual-grounded'],
  rationale: 'server.js is the main entry point of the demo app.',
});

// =============================================================================
// HAL-05: Conflated sources — attributes from source A applied to source B
// =============================================================================

push({
  description: 'HAL-05: Agent claims init.sql contains route handlers (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'createServer',
    source: 'init.sql',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-05', 'factual-fabrication'],
  rationale: 'createServer is in server.js, not init.sql. Conflating sources.',
});

push({
  description: 'HAL-05: Agent claims init.sql contains CREATE TABLE (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'CREATE TABLE',
    source: 'init.sql',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-05', 'factual-grounded'],
  rationale: 'init.sql indeed contains CREATE TABLE statements.',
});

// =============================================================================
// HAL-06: Wrong column type — agent claims VARCHAR is INTEGER
// =============================================================================

push({
  description: 'HAL-06: Agent claims email column is INTEGER (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'email column type is INTEGER',
    source: 'schema',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-06', 'schema-fabrication'],
  rationale: 'email is VARCHAR(255), not INTEGER.',
});

push({
  description: 'HAL-06: Agent claims email column is VARCHAR (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'email column type is VARCHAR',
    source: 'schema',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-06', 'schema-grounded'],
  rationale: 'email is indeed VARCHAR(255) in users table.',
});

// =============================================================================
// HAL-07: Wrong table relationship — fabricated foreign key
// =============================================================================

push({
  description: 'HAL-07: Agent claims posts.author_id references users.id (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'posts table has author_id column',
    source: 'schema',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-07', 'schema-fabrication'],
  rationale: 'posts has user_id (not author_id). The agent fabricated the column name.',
});

push({
  description: 'HAL-07: Agent claims posts.user_id exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'posts table has user_id column',
    source: 'schema',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-07', 'schema-grounded'],
  rationale: 'posts.user_id indeed exists and references users(id).',
});

// =============================================================================
// HAL-08: Wrong API endpoint — fabricated route
// =============================================================================

push({
  description: 'HAL-08: Agent claims POST /api/v2/users exists (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'POST /api/v2/users',
    source: 'routes',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-08', 'schema-fabrication'],
  rationale: 'No /api/v2/users route exists. Only /api/items and /api/echo.',
});

push({
  description: 'HAL-08: Agent claims /api/items route exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: '/api/items',
    source: 'routes',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-08', 'schema-grounded'],
  rationale: '/api/items is a defined route in server.js.',
});

// =============================================================================
// HAL-09: Wrong config key — fabricated setting
// =============================================================================

push({
  description: 'HAL-09: Agent claims settings.maxRetries config key exists (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'settings.maxRetries exists',
    source: 'config',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-09', 'schema-fabrication'],
  rationale: 'No settings.maxRetries key in config.json. Config has app, database, features.',
});

push({
  description: 'HAL-09: Agent claims features.darkMode config key exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'features.darkMode exists',
    source: 'config',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-09', 'schema-grounded'],
  rationale: 'features.darkMode = true in config.json.',
});

// =============================================================================
// HAL-10: Wrong CSS selector — fabricated class/id
// =============================================================================

push({
  description: 'HAL-10: Agent targets .card-header selector (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: '.card-header selector exists',
    source: 'css',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-10', 'schema-fabrication'],
  rationale: 'The class is .card-title, not .card-header. Agent fabricated the selector name.',
});

push({
  description: 'HAL-10: Agent claims .card-title CSS selector exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: '.card-title selector exists',
    source: 'css',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-10', 'schema-grounded'],
  rationale: '.card-title is defined in the /about page CSS with font-weight: bold.',
});

// =============================================================================
// HAL-11: False causal claim — "X causes Y" without evidence
// =============================================================================

push({
  description: 'HAL-11: Agent claims "CORS middleware" causes 502 error (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'CORS middleware',
    source: 'server.js',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-11', 'reasoning-fabrication'],
  rationale: 'No CORS middleware exists in server.js. Cannot cause anything.',
});

push({
  description: 'HAL-11: Agent claims server uses http.createServer (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'http.createServer',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-11', 'reasoning-grounded'],
  rationale: 'server.js uses http.createServer to create the server.',
});

// =============================================================================
// HAL-12: False temporal claim — wrong ordering of events
// =============================================================================

push({
  description: 'HAL-12: Agent claims migration runs before server start (fabricated — no migration runner)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'runMigrations',
    source: 'server.js',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-12', 'reasoning-fabrication'],
  rationale: 'No migration runner function exists in server.js.',
});

push({
  description: 'HAL-12: Agent claims server.listen is called (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'server.listen',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-12', 'reasoning-grounded'],
  rationale: 'server.listen(PORT, ...) is called at the end of server.js.',
});

// =============================================================================
// HAL-13: False absence claim — "X doesn't exist" when it does
// =============================================================================

push({
  description: 'HAL-13: Agent claims no error handling exists but try/catch may (fabricated — no error handling in demo)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'try {',
    source: 'server.js',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-13', 'reasoning-fabrication'],
  rationale: 'Demo app server.js has no try/catch blocks — claim that it does not exist is correct.',
});

push({
  description: 'HAL-13: Agent claims 404 handler exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'Not Found',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-13', 'reasoning-grounded'],
  rationale: 'server.js has a 404 handler that returns "Not Found".',
});

// =============================================================================
// HAL-14: Confabulated error message — fabricated log output
// =============================================================================

push({
  description: 'HAL-14: Agent quotes error "TypeError: Cannot read property of null" (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'TypeError: Cannot read property of null',
    source: 'content',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-14', 'reasoning-fabrication'],
  rationale: 'No such error message exists in any source file.',
});

push({
  description: 'HAL-14: Agent quotes console.log message that exists (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'Demo app listening on port',
    source: 'server.js',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-14', 'reasoning-grounded'],
  rationale: 'server.js has console.log(`Demo app listening on port ${PORT}`)',
});

// =============================================================================
// HAL-15: Plausible but wrong code — syntactically valid, semantically incorrect
// =============================================================================

push({
  description: 'HAL-15: Agent claims sessions table has user_email column (fabricated)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'sessions table has user_email column',
    source: 'schema',
    halAssert: 'fabricated',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-15', 'reasoning-fabrication'],
  rationale: 'sessions table has user_id, token, expires_at, created_at — no user_email. Plausible but wrong.',
});

push({
  description: 'HAL-15: Agent claims sessions table has token column (grounded)',
  edits: [],
  predicates: [{
    type: 'hallucination',
    claim: 'sessions table has token column',
    source: 'schema',
    halAssert: 'grounded',
  }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['hallucination', 'HAL-15', 'reasoning-grounded'],
  rationale: 'sessions.token is TEXT NOT NULL UNIQUE in init.sql.',
});

// =============================================================================
// WRITE OUTPUT
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} hallucination scenarios to ${outPath}`);
