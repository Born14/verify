#!/usr/bin/env bun
/**
 * Contention x Verify/Observe scenario generator
 * Grid cell: J x 7
 * Shapes: JV-01 (two health checks get different results), JV-02 (schema introspection during migration), JV-03 (file hash computed while file being written)
 *
 * Contention scenarios test whether verify detects COLLISION at the observation layer.
 * Two verifiers reading the same resource get different snapshots because a mutation
 * is in flight. The verification result depends on WHEN it observed, not WHAT exists.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-verify.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-verify-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape JV-01: Two health checks get different results
// One edit changes the health endpoint response while a predicate checks the
// old format. Simulates observing the health endpoint mid-deploy where the
// response format is changing.
// =============================================================================

// JV-01a: Health response changes from JSON to text, predicate expects JSON
scenarios.push({
  id: nextId('health'),
  description: 'JV-01: Health endpoint changed from JSON to plain text, predicate expects JSON status field',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(200, { 'Content-Type': 'text/plain' });\n    res.end('healthy');" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "res.end('healthy')" },
    { type: 'content', file: 'server.js', pattern: "{ status: 'ok' }" },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'health_check', 'JV-01'],
  rationale: 'Edit replaces JSON health response — predicate expecting old JSON format fails observation',
});

// JV-01b: Health endpoint URL changes, predicate checks old URL in docker-compose
scenarios.push({
  id: nextId('health'),
  description: 'JV-01: Server health moved to /ready but docker-compose healthcheck still probes /health',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "if (req.url === '/ready') {" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "req.url === '/ready'" },
    { type: 'content', file: 'docker-compose.yml', pattern: 'http://localhost:3000/health' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'health_check', 'JV-01'],
  rationale: 'Edit succeeds but creates inconsistency — compose still checks /health while server serves /ready. Both predicates pass because edit only touches server.js and compose is unchanged.',
});

// JV-01c: Health endpoint returns different status code, predicate expects 200 pattern
scenarios.push({
  id: nextId('health'),
  description: 'JV-01: Health endpoint changed to 503 during maintenance, predicate expects 200 pattern',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(503, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'maintenance' }));" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "status: 'maintenance'" },
    { type: 'content', file: 'docker-compose.yml', pattern: 'retries: 3' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'health_check', 'JV-01'],
  rationale: 'Health returns 503 but compose will retry 3 times — both predicates independently pass',
});

// JV-01d: Dockerfile health uses wget, edit changes server to require curl-compatible response
scenarios.push({
  id: nextId('health'),
  description: 'JV-01: Edit changes health response headers, Dockerfile HEALTHCHECK still uses wget',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(200, { 'Content-Type': 'application/json', 'X-Health': 'v2' });\n    res.end(JSON.stringify({ status: 'ok', version: 2 }));" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "'X-Health': 'v2'" },
    { type: 'content', file: 'Dockerfile', pattern: 'wget -q -O-' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'health_check', 'JV-01'],
  rationale: 'Server adds header but Dockerfile health still uses wget — both predicates independently pass',
});

// JV-01e: Control — edit health response and update compose healthcheck consistently
scenarios.push({
  id: nextId('health'),
  description: 'JV-01 control: Edit health response and update compose healthcheck in sync (no conflict)',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "if (req.url === '/healthz') {" },
    { file: 'docker-compose.yml', search: 'http://localhost:3000/health', replace: 'http://localhost:3000/healthz' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "req.url === '/healthz'" },
    { type: 'content', file: 'docker-compose.yml', pattern: 'http://localhost:3000/healthz' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'health_check', 'JV-01', 'control'],
  rationale: 'Both files updated consistently — no observer conflict',
});

// =============================================================================
// Shape JV-02: Schema introspection during migration
// One edit modifies the schema (init.sql) while predicates check both the old
// and new schema state. Simulates reading schema mid-migration where the
// introspection sees a partially-applied state.
// =============================================================================

// JV-02a: Migration adds column, predicate expects both old and new column
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02: Migration adds phone column to users, predicate expects both email VARCHAR and phone',
  edits: [
    { file: 'init.sql', search: '    email VARCHAR(255) NOT NULL,', replace: '    email TEXT NOT NULL,\n    phone VARCHAR(20),' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'email VARCHAR(255) NOT NULL' },
    { type: 'content', file: 'init.sql', pattern: 'phone VARCHAR(20)' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02'],
  rationale: 'Migration changes email from VARCHAR(255) to TEXT — predicate expecting old type fails',
});

// JV-02b: Migration renames table columns, predicate checks original names
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02: Migration renames password_hash to pwd_hash, predicate checks old column name',
  edits: [
    { file: 'init.sql', search: '    password_hash TEXT NOT NULL,', replace: '    pwd_hash TEXT NOT NULL,' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'pwd_hash TEXT NOT NULL' },
    { type: 'content', file: 'init.sql', pattern: 'password_hash TEXT NOT NULL' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02'],
  rationale: 'Column renamed — predicate checking old name "password_hash" fails introspection',
});

// JV-02c: Migration changes sessions primary key type, predicate expects original
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02: Migration changes sessions.id from UUID to SERIAL, predicate expects UUID',
  edits: [
    { file: 'init.sql', search: '    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),', replace: '    id SERIAL PRIMARY KEY,' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'id SERIAL PRIMARY KEY' },
    { type: 'content', file: 'init.sql', pattern: 'gen_random_uuid()' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02'],
  rationale: 'Migration replaces UUID with SERIAL — predicate checking gen_random_uuid fails',
});

// JV-02d: Migration drops and recreates index, predicate expects both old index and new
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02: Migration replaces sessions token index, predicate expects old index name',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE UNIQUE INDEX idx_sessions_token_v2 ON sessions(token);' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'idx_sessions_token_v2' },
    { type: 'content', file: 'init.sql', pattern: 'idx_sessions_token ON sessions(token)' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02'],
  rationale: 'Old index replaced — predicate checking original index name fails during migration window',
});

// JV-02e: Migration changes default value, predicate expects old default
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02: Migration changes posts.view_count default, predicate expects DEFAULT 0',
  edits: [
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 100,' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'view_count INTEGER DEFAULT 100' },
    { type: 'content', file: 'init.sql', pattern: 'view_count INTEGER DEFAULT 0' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02'],
  rationale: 'Default changed from 0 to 100 — predicate expecting old default fails mid-migration',
});

// JV-02f: Control — migration adds column, predicate only checks new state
scenarios.push({
  id: nextId('schema'),
  description: 'JV-02 control: Migration adds column, predicate only checks new column exists (no old state check)',
  edits: [
    { file: 'init.sql', search: '    is_active BOOLEAN DEFAULT true,', replace: '    is_active BOOLEAN DEFAULT true,\n    role VARCHAR(20) DEFAULT \'user\',' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: "role VARCHAR(20) DEFAULT 'user'" }],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'schema_introspection', 'JV-02', 'control'],
  rationale: 'Only checking new state — no conflict with pre-migration schema',
});

// =============================================================================
// Shape JV-03: File hash computed while file being written
// One edit modifies a file's content while predicates expect both the pre-write
// and post-write state. Simulates hash verification catching a partial write.
// =============================================================================

// JV-03a: Config.json being updated, predicate expects both old and new app name
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03: Config.json name changes, predicate expects both old "Demo App" and new name',
  edits: [
    { file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Production App"' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'Production App' },
    { type: 'content', file: 'config.json', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03'],
  rationale: 'File hash changes mid-write — predicate checking old "Demo App" name fails',
});

// JV-03b: .env being rotated, predicate expects both old and new DATABASE_URL
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03: .env DATABASE_URL rotated, predicate expects both old and new URLs',
  edits: [
    { file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://db.internal:5432/demo_prod"' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'db.internal:5432/demo_prod' },
    { type: 'content', file: '.env', pattern: 'localhost:5432/demo' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03'],
  rationale: 'DATABASE_URL rotated — predicate checking old localhost URL fails mid-write',
});

// JV-03c: server.js title changing, predicate expects both old and new title
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03: Homepage title changes, predicate expects both old and new title in server.js',
  edits: [
    { file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Live Dashboard</title>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '<title>Live Dashboard</title>' },
    { type: 'content', file: 'server.js', pattern: '<title>Demo App</title>' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03'],
  rationale: 'Title changed — hash computed before write sees Demo App, after write sees Live Dashboard',
});

// JV-03d: Dockerfile being rebuilt, predicate expects both old and new FROM
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03: Dockerfile base image changes, predicate expects both old node:20 and new image',
  edits: [
    { file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:22-alpine' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'FROM node:22-alpine' },
    { type: 'content', file: 'Dockerfile', pattern: 'FROM node:20-alpine' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03'],
  rationale: 'Base image changed — file hash mid-write catches inconsistent state',
});

// JV-03e: docker-compose environment being updated, predicate expects old value
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03: docker-compose PORT env changes, predicate expects both old and new PORT',
  edits: [
    { file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=8080' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=8080' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=3000' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03'],
  rationale: 'PORT changed — predicate verifying old PORT=3000 fails when hash computed after write',
});

// JV-03f: Control — edit file and only check new content (no stale hash)
scenarios.push({
  id: nextId('hash'),
  description: 'JV-03 control: Edit config.json port, predicate only checks new value (no stale observation)',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 4000' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 4000' }],
  expectedSuccess: true,
  tags: ['contention', 'verify', 'hash_conflict', 'JV-03', 'control'],
  rationale: 'Only checking post-write state — no stale hash conflict',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-verify scenarios -> ${outPath}`);
