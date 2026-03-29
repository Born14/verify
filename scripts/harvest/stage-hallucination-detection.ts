#!/usr/bin/env bun
/**
 * stage-hallucination-detection.ts — Hallucination Detection Scenario Stager
 *
 * Generates scenarios that test whether agent claims are grounded in reality.
 * Every "hallucination" is a grounding check: does the claimed thing actually exist?
 *
 * Covers 15 hallucination shapes (HAL-01 through HAL-15):
 *
 * Factual Fabrication (HAL-01 to HAL-05):
 *   HAL-01: Invented statistic not in source material
 *   HAL-02: Invented entity (person/org/product)
 *   HAL-03: Invented API parameter not in schema
 *   HAL-04: Invented file/function not in codebase
 *   HAL-05: Conflated sources (attributes from A applied to B)
 *
 * Schema/Structure Fabrication (HAL-06 to HAL-10):
 *   HAL-06: Wrong column type
 *   HAL-07: Wrong table relationship (fabricated FK)
 *   HAL-08: Wrong API endpoint (fabricated route)
 *   HAL-09: Wrong config key
 *   HAL-10: Wrong CSS selector (fabricated class/id)
 *
 * Reasoning Fabrication (HAL-11 to HAL-15):
 *   HAL-11: False causal claim
 *   HAL-12: False temporal claim
 *   HAL-13: False absence claim ("X doesn't exist" when it does)
 *   HAL-14: Confabulated error message
 *   HAL-15: Plausible but wrong code
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SERVER_JS_PATH = resolve(__dirname, '../../fixtures/demo-app/server.js');
const INIT_SQL_PATH  = resolve(__dirname, '../../fixtures/demo-app/init.sql');
const CONFIG_PATH    = resolve(__dirname, '../../fixtures/demo-app/config.json');
const ENV_PATH       = resolve(__dirname, '../../fixtures/demo-app/.env');
const OUTPUT_PATH    = resolve(__dirname, '../../fixtures/scenarios/hallucination-detection-staged.json');

const SERVER_JS  = readFileSync(SERVER_JS_PATH, 'utf8');
const INIT_SQL   = readFileSync(INIT_SQL_PATH, 'utf8');
const CONFIG_JSON = readFileSync(CONFIG_PATH, 'utf8');
const ENV_FILE   = readFileSync(ENV_PATH, 'utf8');

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `hal-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// =============================================================================
// HAL-01: Invented statistic not in source material
// =============================================================================

// Grounded: statistics/values that actually appear in the demo app
scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 grounded: port 3000 is in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '3000' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 grounded: config port is 3000',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 3000' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 grounded: database port 5432 in config',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 5432' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

// Fabricated: statistics that don't exist
scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 fabricated: invented port 8080 not in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '8080' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 fabricated: invented max_connections=100 not in config',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'max_connections' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 fabricated: invented timeout value not in .env',
  edits: [],
  predicates: [{ type: 'content', file: '.env', pattern: 'TIMEOUT=30000' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

// =============================================================================
// HAL-02: Invented entity (person/org/product)
// =============================================================================

// Grounded: entities that actually exist in the demo app
scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 grounded: Alice exists on about page',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Alice' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 grounded: Bob exists on about page',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Bob' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 grounded: Carol exists on about page',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Carol' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

// Fabricated: entities that don't exist
scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 fabricated: Dave is not a team member',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Dave' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 fabricated: Acme Corp not mentioned anywhere',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Acme Corp' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

scenarios.push({
  id: nextId('02'),
  description: 'HAL-02 fabricated: Redis product not referenced in server',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Redis' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-02'],
});

// =============================================================================
// HAL-03: Invented API parameter not in schema
// =============================================================================

// Grounded: real API response fields
scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 grounded: /api/items returns id field',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "id: 1, name: 'Alpha'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 grounded: /health returns status field',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "status: 'ok'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 grounded: /api/echo returns echo and timestamp',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'echo: body, timestamp:' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

// Fabricated: API parameters that don't exist
scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 fabricated: /api/items does not return a "price" field',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "price:" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 fabricated: /health does not return uptime field',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "uptime:" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

scenarios.push({
  id: nextId('03'),
  description: 'HAL-03 fabricated: no pagination parameter in items API',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'page=' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-03'],
});

// =============================================================================
// HAL-04: Invented file/function not in codebase
// =============================================================================

// Grounded: files/functions that actually exist
scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 grounded: http.createServer function exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'http.createServer' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 grounded: server.listen function exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'server.listen' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

// Fabricated: files/functions that don't exist
scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 fabricated: no routes.js file exists',
  edits: [],
  predicates: [{ type: 'content', file: 'routes.js', pattern: 'module.exports' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 fabricated: no middleware.js file exists',
  edits: [],
  predicates: [{ type: 'content', file: 'middleware.js', pattern: 'authenticate' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 fabricated: no express import in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "require('express')" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

scenarios.push({
  id: nextId('04'),
  description: 'HAL-04 fabricated: no database.js helper file',
  edits: [],
  predicates: [{ type: 'content', file: 'database.js', pattern: 'pool' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-04'],
});

// =============================================================================
// HAL-05: Conflated sources (attributes from A applied to B)
// =============================================================================

// Grounded: correct attribute-source pairings
scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 grounded: Alice role is Lead (correct pairing)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Alice <span class="role">— Lead</span>' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 grounded: Bob role is Backend (correct pairing)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Bob <span class="role">— Backend</span>' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 grounded: about page hero bg is #3498db',
  edits: [],
  predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: '#3498db', path: '/about' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

// Fabricated: wrong source-attribute pairings (conflation)
scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 fabricated: Alice conflated as Backend (Bob\'s role)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Alice <span class="role">— Backend</span>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 fabricated: Bob conflated as Frontend (Carol\'s role)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Bob <span class="role">— Frontend</span>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 fabricated: homepage h1 color conflated with about page hero (#3498db vs #1a1a2e)',
  edits: [],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: '#3498db', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

// =============================================================================
// HAL-06: Wrong column type
// =============================================================================

// Grounded: correct column types
scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: users.username is VARCHAR(50)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'username', assertion: 'column_type', expected: 'VARCHAR(50)' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: users.email is VARCHAR(255)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'email', assertion: 'column_type', expected: 'VARCHAR(255)' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: posts.title is VARCHAR(200)',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'title', assertion: 'column_type', expected: 'VARCHAR(200)' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

// Fabricated: wrong column types
scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: users.username is NOT TEXT (it\'s VARCHAR(50))',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'username', assertion: 'column_type', expected: 'TEXT' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: users.email is NOT VARCHAR(100) (it\'s VARCHAR(255))',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'email', assertion: 'column_type', expected: 'VARCHAR(100)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: posts.view_count is NOT BIGINT (it\'s INTEGER)',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'view_count', assertion: 'column_type', expected: 'BIGINT' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

// =============================================================================
// HAL-07: Wrong table relationship (fabricated FK)
// =============================================================================

// Grounded: real foreign keys
scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 grounded: posts.user_id references users(id)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'user_id INTEGER NOT NULL REFERENCES users(id)' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 grounded: sessions.user_id references users(id)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'user_id INTEGER NOT NULL REFERENCES users(id)' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

// Fabricated: relationships that don't exist
scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 fabricated: settings does not reference users',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'REFERENCES settings(id)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 fabricated: no posts.category_id FK exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'category_id INTEGER' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 fabricated: no users.role_id FK to roles table',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'REFERENCES roles(id)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

// =============================================================================
// HAL-08: Wrong API endpoint (fabricated route)
// =============================================================================

// Grounded: real routes
scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 grounded: /health route exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/health'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 grounded: /api/items route exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/api/items'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 grounded: /about route exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/about'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

// Fabricated: routes that don't exist
scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 fabricated: /api/users route does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/api/users'" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 fabricated: /api/posts route does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/api/posts'" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 fabricated: /api/auth/login route does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '/api/auth/login' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

// =============================================================================
// HAL-09: Wrong config key
// =============================================================================

// Grounded: real config keys
scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 grounded: config has app.name key',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "Demo App"' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 grounded: config has features.darkMode key',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"darkMode": true' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 grounded: .env has SECRET_KEY',
  edits: [],
  predicates: [{ type: 'content', file: '.env', pattern: 'SECRET_KEY=' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

// Fabricated: config keys that don't exist
scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 fabricated: no "redis" section in config.json',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"redis"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 fabricated: no "logging" section in config.json',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"logging"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 fabricated: no REDIS_URL in .env',
  edits: [],
  predicates: [{ type: 'content', file: '.env', pattern: 'REDIS_URL=' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

scenarios.push({
  id: nextId('09'),
  description: 'HAL-09 fabricated: no AWS_REGION in .env',
  edits: [],
  predicates: [{ type: 'content', file: '.env', pattern: 'AWS_REGION=' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-09'],
});

// =============================================================================
// HAL-10: Wrong CSS selector (fabricated class/id)
// =============================================================================

// Grounded: real CSS selectors
scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 grounded: .hero selector exists on /about',
  edits: [],
  predicates: [{ type: 'css', selector: '.hero', property: 'padding', expected: '2rem', path: '/about' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 grounded: .nav-link selector exists on /',
  edits: [],
  predicates: [{ type: 'css', selector: 'a.nav-link', property: 'color', expected: '#0066cc', path: '/' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 grounded: .badge selector exists on /about',
  edits: [],
  predicates: [{ type: 'css', selector: '.badge', property: 'background', expected: '#e74c3c', path: '/about' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

// Fabricated: CSS selectors that don't exist
scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 fabricated: .sidebar selector does not exist',
  edits: [],
  predicates: [{ type: 'css', selector: '.sidebar', property: 'width', expected: '250px', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 fabricated: #main-content id does not exist',
  edits: [],
  predicates: [{ type: 'css', selector: '#main-content', property: 'padding', expected: '1rem', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 fabricated: .modal-overlay selector does not exist',
  edits: [],
  predicates: [{ type: 'css', selector: '.modal-overlay', property: 'background', expected: 'rgba(0,0,0,0.5)', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 fabricated: .breadcrumb selector does not exist on /about',
  edits: [],
  predicates: [{ type: 'css', selector: '.breadcrumb', property: 'font-size', expected: '0.9rem', path: '/about' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

// =============================================================================
// HAL-11: False causal claim
// =============================================================================

// Grounded: causal relationships that actually exist in code
scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 grounded: POST to /api/echo returns echo of body (cause-effect)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "echo: body" }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 grounded: 404 handler exists for unknown routes',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "res.writeHead(404" }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

// Fabricated: causal claims not supported by code
scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 fabricated: no rate limiting causes 429 responses',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'writeHead(429' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 fabricated: no auth middleware causes 401 responses',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'writeHead(401' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 fabricated: no redirect logic exists in server',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'writeHead(301' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

// =============================================================================
// HAL-12: False temporal claim
// =============================================================================

// Grounded: temporal things that exist
scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 grounded: users table has created_at timestamp',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'created_at', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 grounded: sessions has expires_at timestamp',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', column: 'expires_at', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 grounded: settings has updated_at timestamp',
  edits: [],
  predicates: [{ type: 'db', table: 'settings', column: 'updated_at', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

// Fabricated: temporal fields/events that don't exist
scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 fabricated: users has no updated_at column',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'updated_at', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 fabricated: posts has no published_at column',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'published_at', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 fabricated: posts has no deleted_at column (no soft deletes)',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'deleted_at', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

// =============================================================================
// HAL-13: False absence claim ("X doesn't exist" when it does)
// =============================================================================

// These test the inverse: claiming something is absent when it IS present.
// Grounded checks verify the thing exists; fabricated checks claim absence of real things.

// Grounded: things that DO exist (proving the absence claim would be wrong)
scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: footer DOES exist on homepage',
  edits: [],
  predicates: [{ type: 'html', selector: 'footer', path: '/', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: nav element DOES exist on homepage',
  edits: [],
  predicates: [{ type: 'html', selector: 'nav', path: '/', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: sessions table DOES exist in schema',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', assertion: 'table_exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: settings table DOES exist in schema',
  edits: [],
  predicates: [{ type: 'db', table: 'settings', assertion: 'table_exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

// Fabricated: claiming real things don't exist (absence claims about present things)
// These verify the real thing exists — if the grounding gate REJECTS these, it's a bug
// The point is: a false absence claim "there's no footer" would be wrong because footer exists
scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: form page DOES have fieldset element',
  edits: [],
  predicates: [{ type: 'html', selector: 'fieldset', path: '/form', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: about page DOES have .team-list element',
  edits: [],
  predicates: [{ type: 'html', selector: '.team-list', path: '/about', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: edge-cases page DOES have .flex-container',
  edits: [],
  predicates: [{ type: 'html', selector: '.flex-container', path: '/edge-cases', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

// =============================================================================
// HAL-14: Confabulated error message
// =============================================================================

// Grounded: real strings/messages in the app
scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 grounded: "Not Found" is real 404 message',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "res.end('Not Found')" }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 grounded: "Name is required" is real error text',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Name is required' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 grounded: "Demo app listening on port" is real startup message',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Demo app listening on port' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

// Fabricated: error messages that don't exist in the code
scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 fabricated: "Internal Server Error" message does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Internal Server Error' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 fabricated: "Unauthorized access" message does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Unauthorized access' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 fabricated: "Connection refused" handling does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Connection refused' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 fabricated: "Too many requests" message does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Too many requests' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

// =============================================================================
// HAL-15: Plausible but wrong code
// =============================================================================

// Grounded: code patterns that actually exist
scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 grounded: correct require statement for http',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "const http = require('http')" }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 grounded: correct PORT assignment',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'const PORT = process.env.PORT || 3000' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 grounded: correct Content-Type for JSON',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "'Content-Type': 'application/json'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

// Fabricated: plausible but wrong code patterns
scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: Express-style app.get (plausible but wrong framework)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "app.get('/'," }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: wrong module system (import vs require)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "import http from 'http'" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: wrong port env var name',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'process.env.SERVER_PORT' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: plausible but wrong JSON.parse usage',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'JSON.parse(req.body)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

// =============================================================================
// Additional cross-cutting scenarios for better coverage
// =============================================================================

// HAL-06 additional: type aliases
scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: users.id type is SERIAL (alias for INTEGER)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'id', assertion: 'column_type', expected: 'SERIAL' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: users.is_active is BOOLEAN',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'is_active', assertion: 'column_type', expected: 'BOOLEAN' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: sessions.id is NOT INTEGER (it\'s UUID)',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', column: 'id', assertion: 'column_type', expected: 'INTEGER' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

// HAL-07 additional: fabricated tables as FK targets
scenarios.push({
  id: nextId('07'),
  description: 'HAL-07 fabricated: no comments table referenced anywhere',
  edits: [],
  predicates: [{ type: 'db', table: 'comments', assertion: 'table_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-07'],
});

// HAL-08 additional
scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 grounded: /form route exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/form'" }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

scenarios.push({
  id: nextId('08'),
  description: 'HAL-08 fabricated: /api/search does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/api/search'" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-08'],
});

// HAL-10 additional: CSS from different pages
scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 grounded: .edge-hero selector exists on /edge-cases',
  edits: [],
  predicates: [{ type: 'css', selector: '.edge-hero', property: 'color', expected: '#2c3e50', path: '/edge-cases' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

scenarios.push({
  id: nextId('10'),
  description: 'HAL-10 fabricated: .tooltip does not exist',
  edits: [],
  predicates: [{ type: 'css', selector: '.tooltip', property: 'background', expected: '#333', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-10'],
});

// HAL-01 additional
scenarios.push({
  id: nextId('01'),
  description: 'HAL-01 grounded: database name is "demo" in config',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "demo"' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-01'],
});

// HAL-05 additional: cross-page conflation
scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 grounded: homepage body font is sans-serif',
  edits: [],
  predicates: [{ type: 'css', selector: 'body', property: 'font-family', expected: 'sans-serif', path: '/' }],
  expectedSuccess: true,
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

scenarios.push({
  id: nextId('05'),
  description: 'HAL-05 fabricated: homepage body font is NOT Georgia (that\'s the about page)',
  edits: [],
  predicates: [{ type: 'css', selector: 'body', property: 'font-family', expected: 'Georgia, serif', path: '/' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'factual_fabrication', 'HAL-05'],
});

// HAL-11 additional
scenarios.push({
  id: nextId('11'),
  description: 'HAL-11 fabricated: no try/catch error handling exists',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'try {' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-11'],
});

// HAL-12 additional
scenarios.push({
  id: nextId('12'),
  description: 'HAL-12 fabricated: no last_login_at column in users',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'last_login_at', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-12'],
});

// HAL-13 additional: HTML elements that DO exist
scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: h1 element DOES exist on homepage',
  edits: [],
  predicates: [{ type: 'html', selector: 'h1', path: '/', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

scenarios.push({
  id: nextId('13'),
  description: 'HAL-13 grounded: #contact-form DOES exist on /form',
  edits: [],
  predicates: [{ type: 'html', selector: '#contact-form', path: '/form', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-13'],
});

// HAL-14 additional
scenarios.push({
  id: nextId('14'),
  description: 'HAL-14 fabricated: "Request timeout" error message does not exist',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Request timeout' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-14'],
});

// HAL-15 additional: plausible but wrong patterns
scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: wrong listener syntax (app.listen vs server.listen)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'app.listen(PORT' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated: wrong response method (res.json vs res.end)',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'res.json(' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

// HAL-15 with edits: plausible but wrong code injected
scenarios.push({
  id: nextId('15'),
  description: 'HAL-15 fabricated edit: adding plausible but wrong middleware',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  // middleware\n  if (req.headers['x-api-key'] !== process.env.API_KEY) {\n    res.writeHead(403); res.end('Forbidden'); return;\n  }",
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'process.env.API_KEY' }],
  expectedSuccess: true,
  tags: ['hallucination', 'reasoning_fabrication', 'HAL-15'],
});

// Additional DB fabrication scenarios
scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 grounded: settings.value is JSONB',
  edits: [],
  predicates: [{ type: 'db', table: 'settings', column: 'value', assertion: 'column_type', expected: 'JSONB' }],
  expectedSuccess: true,
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: settings.value is NOT JSON (it\'s JSONB)',
  edits: [],
  predicates: [{ type: 'db', table: 'settings', column: 'value', assertion: 'column_type', expected: 'JSON' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

scenarios.push({
  id: nextId('06'),
  description: 'HAL-06 fabricated: sessions.token is NOT VARCHAR (it\'s TEXT)',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', column: 'token', assertion: 'column_type', expected: 'VARCHAR(255)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['hallucination', 'schema_fabrication', 'HAL-06'],
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const shapeCounts: Record<string, number> = {};
const categoryCounts: Record<string, number> = {};
const intentCounts: Record<string, number> = {};

for (const s of scenarios) {
  const shape = s.tags[2] || 'unknown';
  shapeCounts[shape] = (shapeCounts[shape] || 0) + 1;

  const category = s.tags[1] || 'unknown';
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;

  const intent = s.expectedSuccess ? 'grounded' : 'fabricated';
  intentCounts[intent] = (intentCounts[intent] || 0) + 1;
}

console.log(`Generated ${scenarios.length} hallucination detection scenarios → ${OUTPUT_PATH}\n`);

console.log('By shape (HAL-XX):');
for (const [shape, count] of Object.entries(shapeCounts).sort()) {
  console.log(`  ${shape.padEnd(12)} ${count}`);
}

console.log('\nBy category:');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(26)} ${count}`);
}

console.log('\nBy intent:');
for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${intent.padEnd(14)} ${count}`);
}
