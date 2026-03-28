#!/usr/bin/env bun
/**
 * Propagation × Multi-Step scenario generator
 * Grid cell: E×6
 * Shapes: PM-01 (API schema change doesn't reach consumer), PM-02 (DB migration doesn't reach app config), PM-03 (env change in one service doesn't reach dependent)
 *
 * These scenarios test whether verify detects propagation gaps in multi-service
 * cascades — a change in one layer of the stack doesn't propagate to a
 * dependent layer downstream.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-propagation-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pm-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape PM-01: API schema change doesn't reach consumer
// API response structure changes in server.js but the consumer (HTML page,
// config, or downstream file) still references the old field names.
// =============================================================================

// PM-01a: Rename API field from "name" to "title", homepage HTML still shows "name"
scenarios.push({
  id: nextId('api'),
  description: 'PM-01: API /api/items renames field "name" to "title", homepage still references old field',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, title: 'Alpha' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Alpha' }],
  expectedSuccess: true,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01'],
  rationale: 'HTML still renders "Item Alpha" from hardcoded list — API field rename doesnt break static HTML (consumer unaffected)',
});

// PM-01b: Change API endpoint from /api/items to /api/products, nav link still references old
scenarios.push({
  id: nextId('api'),
  description: 'PM-01: API renamed from /api/items to /api/products, homepage nav still links to /api/items',
  edits: [{ file: 'server.js', search: "req.url === '/api/items'", replace: "req.url === '/api/products'" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'href="/api/products"' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01'],
  rationale: 'API route renamed but homepage nav link still references /api/items — intra-file cascade gap',
});

// PM-01c: Add new API field, config has no schema update
scenarios.push({
  id: nextId('api'),
  description: 'PM-01: API response adds "category" field to items, config.json has no category setting',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Alpha', category: 'tools' }" }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'category' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01'],
  rationale: 'API schema expanded but config has no awareness of new field — API→config cascade gap',
});

// PM-01d: Change health endpoint response, Dockerfile healthcheck expects old format
scenarios.push({
  id: nextId('api'),
  description: 'PM-01: Health endpoint changes status field to "healthy", Dockerfile still checks for "ok"',
  edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'healthy', uptime: 100 }" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'healthy' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01'],
  rationale: 'Health response schema changed but Dockerfile CMD still expects old format — API→infra gap',
});

// PM-01e: Change items to return 3 items, homepage list still shows 2
scenarios.push({
  id: nextId('api'),
  description: 'PM-01: API adds third item "Gamma", homepage hardcoded list still has only Alpha and Beta',
  edits: [{ file: 'server.js', search: "{ id: 2, name: 'Beta' },", replace: "{ id: 2, name: 'Beta' },\n      { id: 3, name: 'Gamma' }," }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Gamma' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01'],
  rationale: 'API returns Gamma but homepage HTML list is hardcoded — API→UI cascade gap',
});

// PM-01f: Control — change API and check for new content in same route
scenarios.push({
  id: nextId('api'),
  description: 'PM-01 control: Add Gamma to API, check server.js for Gamma in API response',
  edits: [{ file: 'server.js', search: "{ id: 2, name: 'Beta' },", replace: "{ id: 2, name: 'Beta' },\n      { id: 3, name: 'Gamma' }," }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "'Gamma'" }],
  expectedSuccess: true,
  tags: ['propagation', 'multistep', 'api_consumer', 'PM-01', 'control'],
  rationale: 'Same-file check — Gamma is in the API response code',
});

// =============================================================================
// Shape PM-02: DB migration doesn't reach app config
// Schema changes in init.sql that should cascade to config or env files
// but don't. The migration ran but the app layer doesn't know about it.
// =============================================================================

// PM-02a: Add foreign key to posts, config.json has no relationship setting
scenarios.push({
  id: nextId('dbconfig'),
  description: 'PM-02: Add category_id FK to posts, config.json has no categories feature flag',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0,\n    category_id INTEGER REFERENCES settings(key),' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'categories' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'db_config', 'PM-02'],
  rationale: 'Schema adds FK relationship but config has no awareness of categories feature — DB→config gap',
});

// PM-02b: Rename users table, .env DATABASE_URL still references old schema
scenarios.push({
  id: nextId('dbconfig'),
  description: 'PM-02: Rename users to accounts in init.sql, .env DATABASE_URL unchanged',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE users', replace: 'CREATE TABLE accounts' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'accounts' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'db_config', 'PM-02'],
  rationale: 'Table renamed but app code still uses "users" — DB migration→app propagation gap',
});

// PM-02c: Add sessions table index, docker-compose.test.yml DB name unchanged
scenarios.push({
  id: nextId('dbconfig'),
  description: 'PM-02: init.sql adds performance index, docker-compose.test.yml DB setup unchanged',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;' }],
  predicates: [{ type: 'content', file: 'docker-compose.test.yml', pattern: 'idx_users_active' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'db_config', 'PM-02'],
  rationale: 'Schema adds partial index but test compose has no awareness — DB→test config gap',
});

// PM-02d: Change settings table to use TEXT instead of JSONB, config has no type change
scenarios.push({
  id: nextId('dbconfig'),
  description: 'PM-02: settings.value changed from JSONB to TEXT, config.json still implies JSON structure',
  edits: [{ file: 'init.sql', search: 'value JSONB NOT NULL,', replace: 'value TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'TEXT' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'db_config', 'PM-02'],
  rationale: 'Column type changed from JSONB to TEXT but config implies JSON values — type migration gap',
});

// PM-02e: Control — change init.sql, check init.sql
scenarios.push({
  id: nextId('dbconfig'),
  description: 'PM-02 control: Rename users to accounts, check init.sql for accounts',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE users', replace: 'CREATE TABLE accounts' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE TABLE accounts' }],
  expectedSuccess: true,
  tags: ['propagation', 'multistep', 'db_config', 'PM-02', 'control'],
  rationale: 'Same-file check — table rename is present',
});

// =============================================================================
// Shape PM-03: Env change in one service doesn't reach dependent
// An env var or config value changes in one environment-specific file but
// the corresponding setting in a dependent environment file is stale.
// =============================================================================

// PM-03a: Change .env PORT, .env.prod still has old port
scenarios.push({
  id: nextId('envdep'),
  description: 'PM-03: .env PORT changed to 4000, .env.prod still has PORT=3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [{ type: 'content', file: '.env.prod', pattern: 'PORT=4000' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'env_dependent', 'PM-03'],
  rationale: 'Dev port changed but prod env not updated — cross-environment propagation gap',
});

// PM-03b: Change config.json db host, config.staging.json has old host
scenarios.push({
  id: nextId('envdep'),
  description: 'PM-03: config.json db host changed to "db-cluster", config.staging.json still has localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-cluster"' }],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"host": "db-cluster"' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'env_dependent', 'PM-03'],
  rationale: 'Dev DB host migrated but staging config still points to localhost — env cascade gap',
});

// PM-03c: Change .env.staging DATABASE_URL, docker-compose.test.yml not updated
scenarios.push({
  id: nextId('envdep'),
  description: 'PM-03: .env.staging DATABASE_URL changed, docker-compose.test.yml still has old URL',
  edits: [{ file: '.env.staging', search: 'DATABASE_URL="postgres://localhost:5432/demo_staging"', replace: 'DATABASE_URL="postgres://staging-db:5432/demo_staging"' }],
  predicates: [{ type: 'content', file: 'docker-compose.test.yml', pattern: 'staging-db' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'env_dependent', 'PM-03'],
  rationale: 'Staging DB URL changed but test compose still has old connection — env→test cascade gap',
});

// PM-03d: Change config.prod.json features, config.json base not updated
scenarios.push({
  id: nextId('envdep'),
  description: 'PM-03: config.prod.json adds new feature, config.json base has no matching field',
  edits: [{ file: 'config.prod.json', search: '"betaSignup": false', replace: '"betaSignup": false,\n    "rateLimit": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'rateLimit' }],
  expectedSuccess: false,
  tags: ['propagation', 'multistep', 'env_dependent', 'PM-03'],
  rationale: 'Prod config adds feature but base config has no awareness — prod→base propagation gap',
});

// PM-03e: Change .env NODE_ENV, .env.staging already has different NODE_ENV (non-issue control)
scenarios.push({
  id: nextId('envdep'),
  description: 'PM-03: .env NODE_ENV changed to test, .env.staging has NODE_ENV=staging (expected different)',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=test' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'NODE_ENV=test' }],
  expectedSuccess: true,
  tags: ['propagation', 'multistep', 'env_dependent', 'PM-03', 'control'],
  rationale: 'Same-file check — env var is present (staging has different NODE_ENV by design)',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-multistep scenarios → ${outPath}`);
