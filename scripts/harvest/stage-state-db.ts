#!/usr/bin/env bun
/**
 * State Assumption × Database scenario generator
 * Grid cell: C×4
 * Shapes: SD-01 (wrong database identity), SD-02 (data assumed present), SD-03 (migration targets wrong DB)
 *
 * State Assumption rule: every scenario must name both the ASSUMED STATE and the
 * ACTUAL STATE, and the failure must survive even with no timing delay and no
 * missing cascade. The agent has the wrong belief about which database world it's in.
 *
 * Key distinction from Temporal × Database (TD-01: stale cache after DDL):
 * - Temporal: same database, wrong timing — "wait and it resolves"
 * - State: wrong database identity — "no amount of waiting helps, you're looking at the wrong DB"
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-state-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/state-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sd-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape SD-01: Wrong database identity — grounding source and execution target disagree
// Agent inspects one schema/config surface but the actual database is a different one.
// Not "stale cache" (temporal) — the agent is pointing at the WRONG DATABASE entirely.
// No amount of waiting resolves this; the belief about which DB is wrong.
// =============================================================================

// SD-01a: Schema file says users table exists, but target DB is prod (different name)
// Assumed: init.sql schema matches the connected database. Actual: .env.prod points to demo_prod, not demo.
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01: init.sql defines users table, .env.prod connects to demo_prod — different DB than schema file targets',
  edits: [],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: '/demo"' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01'],
  rationale: 'Assumed: init.sql runs against prod DB. Actual: .env.prod has /demo_prod, init.sql has no database qualifier — schema file and connection target disagree on DB identity.',
});

// SD-01b: config.json says database name "demo", .env.staging says "demo_staging"
// Agent introspects config.json, deploys against staging — names don't match.
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01: config.json says db name "demo", .env.staging connects to "demo_staging"',
  edits: [],
  predicates: [
    { type: 'content', file: '.env.staging', pattern: '/demo"' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01'],
  rationale: 'Assumed: config.json db name "demo" matches staging. Actual: .env.staging has demo_staging. Two different databases.',
});

// SD-01c: config.staging says db host localhost, config.prod says db-primary.internal
// Agent grounded on staging host, predicate checks prod host.
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01: config.staging.json has db host localhost, config.prod.json has db-primary.internal',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'database.host', expected: 'localhost' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01'],
  rationale: 'Assumed: staging DB host (localhost). Actual: prod DB host (db-primary.internal). Agent grounded against wrong environment.',
});

// SD-01d: Agent adds column to init.sql, but server.js connects to a DB that init.sql doesn't target
// The schema change goes to the dev DB; the app connects to the DB in .env.
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01: Add avatar_url to users in init.sql, .env DATABASE_URL points to a different DB host than config.json',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'avatar_url' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01'],
  rationale: 'Assumed: init.sql schema change affects the DB in .env. Actual: .env has no awareness of schema files — DDL and connection are independent surfaces.',
});

// SD-01e: config.json db port 5432 vs config.prod db port (also 5432 but different host = different DB)
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01: config.json and config.prod.json both use port 5432 but different hosts — different databases',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'database.name', expected: 'demo' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01'],
  rationale: 'Assumed: same port means same DB. Actual: config.json targets "demo" on localhost, config.prod targets "demo_prod" on db-primary.internal.',
});

// SD-01f: Control — config.json DB name matches its own value
scenarios.push({
  id: nextId('identity'),
  description: 'SD-01 control: config.json says db name "demo", check config.json confirms',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.json', key: 'database.name', expected: 'demo' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'database', 'wrong_db_identity', 'SD-01', 'control'],
  rationale: 'Same-source check — config.json confirms its own DB name. No identity mismatch.',
});

// =============================================================================
// Shape SD-02: Test data assumed present but table empty / data doesn't exist
// Assumed: database has data (from schema existence, from API response patterns).
// Actual: tables are empty — schema ≠ data. The agent confuses "table exists" with
// "table has rows."
// =============================================================================

// SD-02a: server.js /api/items returns Alpha/Beta, agent assumes they're in the DB
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: /api/items returns Alpha/Beta from server.js, init.sql has no items table or INSERT',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'Alpha' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: Alpha/Beta come from DB. Actual: hardcoded in server.js. Agent confuses API response with DB state.',
});

// SD-02b: users table exists in init.sql but has zero rows
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: users table defined in init.sql, but no INSERT statements — table is empty',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'INSERT INTO users' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: users table has data (schema exists). Actual: zero rows. SELECT returns empty, not "table missing" error.',
});

// SD-02c: sessions table exists but no seed data — session validation always fails
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: sessions table created in init.sql with no seed tokens',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'INSERT INTO sessions' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: sessions work (table exists). Actual: zero rows — token lookup returns null, not "expired".',
});

// SD-02d: settings table exists but no default settings
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: settings table in init.sql but no default settings (app_name, theme)',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'INSERT INTO settings' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: settings table has config rows. Actual: empty. App gets null for theme/app_name lookups.',
});

// SD-02e: posts table exists but no post data
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: posts table defined with view_count column but no rows exist',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'INSERT INTO posts' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: posts table has publishable content. Actual: zero rows. Blog/feed pages render empty.',
});

// SD-02f: Agent adds /api/posts route assuming posts exist in DB
scenarios.push({
  id: nextId('data'),
  description: 'SD-02: Add /api/posts route to server.js, init.sql posts table has no data',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items')",
    replace: "if (req.url === '/api/posts') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ query: 'SELECT * FROM posts' }));\n    return;\n  }\n\n  if (req.url === '/api/items')"
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'INSERT INTO posts' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02'],
  rationale: 'Assumed: posts table has data to query. Actual: zero rows. New endpoint returns [] — correct but useless.',
});

// SD-02g: Control — server.js has hardcoded items, check server.js
scenarios.push({
  id: nextId('data'),
  description: 'SD-02 control: server.js hardcodes Alpha, check server.js confirms',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Alpha' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'database', 'data_assumed_present', 'SD-02', 'control'],
  rationale: 'Checking the source of truth directly — Alpha is in server.js, not assumed from DB.',
});

// =============================================================================
// Shape SD-03: Migration ran on wrong database / DB connection target mismatch
// Agent edits init.sql schema or changes DB config, but the connection target
// (in .env, config.json, or environment-specific config) points elsewhere.
// The migration executes against a database that isn't the one the app connects to.
// =============================================================================

// SD-03a: Rename DB in config.json, .env DATABASE_URL still points to /demo
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: Change database name to "app_v2" in config.json, .env DATABASE_URL still has /demo',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "app_v2"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: '/app_v2' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: config.json change propagates to .env. Actual: .env still has /demo — migration targets wrong DB.',
});

// SD-03b: Database host changed in config.json, .env still has localhost
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: Change database host to "db-primary" in config.json, .env still has localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-primary"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'db-primary' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: config.json host is the connection target. Actual: .env DATABASE_URL still uses localhost.',
});

// SD-03c: Database port changed in config.json, .env still has 5432
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: Change database port to 5433 in config.json, .env still has :5432',
  edits: [{ file: 'config.json', search: '"port": 5432', replace: '"port": 5433' }],
  predicates: [
    { type: 'content', file: '.env', pattern: ':5433/' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: config.json port governs connection. Actual: .env has :5432 — migration runs against wrong port.',
});

// SD-03d: init.sql uses explicit schema namespace, but config has no schema field
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: init.sql creates tables in "app" schema, config.json has no schema setting',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE users', replace: 'CREATE SCHEMA IF NOT EXISTS app;\nCREATE TABLE app.users' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'schema' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: tables in "app" schema are queryable. Actual: config has no schema setting — queries default to public schema.',
});

// SD-03e: .env.staging DATABASE_URL vs .env.prod DATABASE_URL — different database names
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: .env.staging has /demo_staging, .env.prod has /demo_prod — migration targets staging, app reads prod',
  edits: [],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: 'demo_staging' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: staging migration applies to prod. Actual: .env.prod connects to demo_prod, staging DDL ran on demo_staging.',
});

// SD-03f: config.json says "demo", config.prod.json says "demo_prod" — which is real?
scenarios.push({
  id: nextId('target'),
  description: 'SD-03: config.json says db "demo", config.prod.json says "demo_prod" — migration target ambiguous',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'database.name', expected: 'demo' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03'],
  rationale: 'Assumed: base config.json DB name applies to prod. Actual: config.prod.json overrides to demo_prod.',
});

// SD-03g: Control — config.json and .env agree on database name
scenarios.push({
  id: nextId('target'),
  description: 'SD-03 control: config.json says "demo", .env has /demo — sources agree',
  edits: [],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"name": "demo"' },
    { type: 'content', file: '.env', pattern: '/demo' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'database', 'migration_wrong_target', 'SD-03', 'control'],
  rationale: 'Both config surfaces agree on "demo" — no DB identity mismatch.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} state-assumption-database scenarios → ${outPath}`);
