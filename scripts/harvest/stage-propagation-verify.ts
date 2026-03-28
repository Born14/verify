#!/usr/bin/env bun
/**
 * Propagation × Verify/Observe scenario generator
 * Grid cell: E×7
 * Shapes: PV-01 (schema verification passes but query verification unaware), PV-02 (file exists but content check uses stale snapshot), PV-03 (health check passes but functional check unaware)
 *
 * These scenarios test whether verify detects propagation gaps in the
 * verification chain — evidence from one check doesn't cascade to a
 * dependent check. One gate passes but a downstream gate is unaware
 * of the state that made the first gate pass.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-propagation-verify.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const outPath = resolve('fixtures/scenarios/propagation-verify-staged.json');
const demoDir = resolve('fixtures/demo-app');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

const serverHash = sha256(serverContent);
const configHash = sha256(configContent);
const sqlHash = sha256(initSQL);

// =============================================================================
// Shape PV-01: Schema verification passes but query verification unaware
// Edit changes init.sql — the schema check passes because the column exists.
// But a content check on server.js for the column name fails because the
// query layer wasn't updated. The schema gate passes; the query gate fails.
// =============================================================================

// PV-01a: Add column to schema (passes), server.js has no reference (fails)
scenarios.push({
  id: nextId('schema'),
  description: 'PV-01: bio column added to init.sql (schema valid), server.js has no bio reference (query unaware)',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'bio' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'schema_query', 'PV-01'],
  rationale: 'Schema gate would pass (column exists) but query gate fails (app unaware) — verification chain gap',
});

// PV-01b: Add index (schema ok), server.js has no optimized query
scenarios.push({
  id: nextId('schema'),
  description: 'PV-01: Email index added to init.sql, server.js has no email query to benefit',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE INDEX idx_sessions_token ON sessions(token);\nCREATE INDEX idx_users_email ON users(email);' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'email' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'schema_query', 'PV-01'],
  rationale: 'Index exists in schema but app has no email query — schema verification doesnt propagate to query layer',
});

// PV-01c: Rename table (schema changes), server.js still references old name
scenarios.push({
  id: nextId('schema'),
  description: 'PV-01: posts renamed to articles in schema, server.js has no articles reference',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE posts', replace: 'CREATE TABLE articles' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'articles' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'schema_query', 'PV-01'],
  rationale: 'Schema verification passes (articles table exists) but query verification fails (code uses old name)',
});

// PV-01d: Add FK constraint (schema valid), config has no relationship config
scenarios.push({
  id: nextId('schema'),
  description: 'PV-01: FK from posts.user_id verified in schema, config has no user-post relationship setting',
  edits: [{ file: 'init.sql', search: 'user_id INTEGER NOT NULL REFERENCES users(id),', replace: 'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'CASCADE' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'schema_query', 'PV-01'],
  rationale: 'Schema constraint verification passes but config verification unaware of cascade policy',
});

// PV-01e: Control — add column, check schema for it
scenarios.push({
  id: nextId('schema'),
  description: 'PV-01 control: Add bio column, check init.sql for bio',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'bio TEXT' }],
  expectedSuccess: true,
  tags: ['propagation', 'verify', 'schema_query', 'PV-01', 'control'],
  rationale: 'Same-file check — column is present in schema',
});

// =============================================================================
// Shape PV-02: File exists but content check uses stale snapshot
// Edit modifies a file. A filesystem_unchanged predicate using the pre-edit
// hash would fail because the file has been modified. But a content check
// for OLD content also fails because the edit changed it.
// Simulates: "we verified the file exists (check 1 passes) but the content
// check (check 2) uses a snapshot from before the edit."
// =============================================================================

// PV-02a: Edit server.js, content check for old pattern fails
scenarios.push({
  id: nextId('snapshot'),
  description: 'PV-02: server.js port changed, content check for old PORT=3000 pattern fails',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 8080;' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'PORT || 3000' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'stale_snapshot', 'PV-02'],
  rationale: 'File exists (gate 1 passes) but content check uses stale pattern from before edit',
});

// PV-02b: Edit config.json, hash check uses pre-edit hash
scenarios.push({
  id: nextId('snapshot'),
  description: 'PV-02: config.json name changed, hash check uses pre-edit snapshot',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "New App"' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'config.json', hash: configHash }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'stale_snapshot', 'PV-02'],
  rationale: 'File exists and is valid, but hash check uses stale snapshot — verification chain broken',
});

// PV-02c: Edit .env, content check for old DATABASE_URL
scenarios.push({
  id: nextId('snapshot'),
  description: 'PV-02: .env DATABASE_URL changed, content check for old localhost URL',
  edits: [{ file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://db-primary:5432/demo"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'postgres://localhost:5432' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'stale_snapshot', 'PV-02'],
  rationale: 'File exists check passes but content verification uses pre-edit snapshot of DATABASE_URL',
});

// PV-02d: Edit init.sql, content check for old table name
scenarios.push({
  id: nextId('snapshot'),
  description: 'PV-02: init.sql posts renamed to articles, content check for "posts" fails',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE posts', replace: 'CREATE TABLE articles' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE TABLE posts' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'stale_snapshot', 'PV-02'],
  rationale: 'Schema file exists but content verification for "posts" uses stale snapshot after rename',
});

// PV-02e: Control — edit file, check for NEW content
scenarios.push({
  id: nextId('snapshot'),
  description: 'PV-02 control: config.json name changed, check for new name',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Fresh App"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "Fresh App"' }],
  expectedSuccess: true,
  tags: ['propagation', 'verify', 'stale_snapshot', 'PV-02', 'control'],
  rationale: 'Content check uses fresh evidence — should pass',
});

// =============================================================================
// Shape PV-03: Health check passes but functional check unaware
// Health endpoint exists and responds (structural check passes), but
// the actual business logic has been broken by the edit.
// The health gate passes; the functional gate fails because it checks
// different content that was affected by the edit.
// =============================================================================

// PV-03a: Edit /api/items response, health check still passes but items check fails
scenarios.push({
  id: nextId('functional'),
  description: 'PV-03: API items renamed to "products" in response, health check OK but items list pattern fails',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, label: 'Alpha' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "name: 'Alpha'" }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'health_functional', 'PV-03'],
  rationale: 'Health endpoint passes (unchanged) but functional check for items.name fails — health gate doesnt cascade',
});

// PV-03b: Break homepage HTML but health check unaffected
scenarios.push({
  id: nextId('functional'),
  description: 'PV-03: Homepage title removed, health check OK but content predicate for "Demo App" fails',
  edits: [{ file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1></h1>' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '<h1>Demo App</h1>' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'health_functional', 'PV-03'],
  rationale: 'Health endpoint responds OK but homepage content is broken — health gate passes, functional fails',
});

// PV-03c: Change port in server.js, Dockerfile health check path OK but port wrong
scenarios.push({
  id: nextId('functional'),
  description: 'PV-03: server.js port changed to 8080, Dockerfile healthcheck still targets 3000',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 8080;' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'localhost:8080' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'health_functional', 'PV-03'],
  rationale: 'Health route exists but Dockerfile healthcheck targets wrong port — health→deploy verification gap',
});

// PV-03d: Remove /about route, health check OK but about page verification fails
scenarios.push({
  id: nextId('functional'),
  description: 'PV-03: /about route handler removed, health OK but nav link to /about still exists',
  edits: [{ file: 'server.js', search: "a class=\"nav-link\" href=\"/about\">About</a>", replace: "a class=\"nav-link\" href=\"/about\">About (broken)</a>" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'href="/about">About</a>' }],
  expectedSuccess: false,
  tags: ['propagation', 'verify', 'health_functional', 'PV-03'],
  rationale: 'Health check passes but nav link text changed — health gate doesnt propagate to content gate',
});

// PV-03e: Control — health endpoint content present and checked
scenarios.push({
  id: nextId('functional'),
  description: 'PV-03 control: Health endpoint unchanged, check for health response pattern',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "status: 'ok'" }],
  expectedSuccess: true,
  tags: ['propagation', 'verify', 'health_functional', 'PV-03', 'control'],
  rationale: 'No edit — health response pattern should be found',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-verify scenarios → ${outPath}`);
