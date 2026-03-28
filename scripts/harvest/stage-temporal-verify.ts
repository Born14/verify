#!/usr/bin/env bun
/**
 * Temporal × Verify/Observe scenario generator
 * Grid cell: D×7
 * Shapes: TV-01 (schema snapshot stale after migration), TV-02 (config read stale after env change), TV-03 (file hash stale after edit)
 *
 * These scenarios test whether verify detects stale evidence — observations
 * gathered at one point in time but consumed after reality has changed.
 *
 * Run: bun scripts/harvest/stage-temporal-verify.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const outPath = resolve('fixtures/scenarios/temporal-verify-staged.json');
const demoDir = resolve('fixtures/demo-app');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');

const serverHash = sha256(serverContent);
const configHash = sha256(configContent);
const envHash = sha256(envContent);
const sqlHash = sha256(initSQL);

// =============================================================================
// Shape TV-01: Schema snapshot stale after migration
// Edit changes init.sql (the schema) but the predicate checks the hash of the
// PRE-migration state. Since the edit IS applied, the old hash is stale evidence.
// =============================================================================

// TV-01a: Add column to users, predicate checks pre-migration hash
scenarios.push({
  id: nextId('schema'),
  description: 'TV-01: Migration adds bio column, predicate checks pre-migration init.sql hash (stale snapshot)',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'init.sql', hash: sqlHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_schema', 'TV-01'],
  rationale: 'Schema changed by migration — pre-migration hash is stale evidence',
});

// TV-01b: Add new table, predicate checks pre-migration hash
scenarios.push({
  id: nextId('schema'),
  description: 'TV-01: Migration adds tags table, predicate checks pre-migration init.sql hash',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE settings', replace: 'CREATE TABLE tags (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(50) NOT NULL\n);\n\nCREATE TABLE settings' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'init.sql', hash: sqlHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_schema', 'TV-01'],
  rationale: 'New table added — schema snapshot taken before migration is stale',
});

// TV-01c: Add index, check for old table structure via content
scenarios.push({
  id: nextId('schema'),
  description: 'TV-01: Migration adds index on posts.user_id, predicate checks init.sql content for old index set',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_posts_user ON posts(user_id);' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'init.sql', hash: sqlHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_schema', 'TV-01'],
  rationale: 'Index added — hash of schema before migration is stale',
});

// TV-01d: Rename column, old content pattern should not match
scenarios.push({
  id: nextId('schema'),
  description: 'TV-01: Migration renames is_active to active, predicate checks for is_active content',
  edits: [{ file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true,', replace: 'active BOOLEAN DEFAULT true,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'is_active' }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_schema', 'TV-01'],
  rationale: 'Column renamed — predicate checking old name finds stale evidence',
});

// TV-01e: Control — no edit, hash matches current
scenarios.push({
  id: nextId('schema'),
  description: 'TV-01 control: No migration, init.sql hash matches current state',
  edits: [],
  predicates: [{ type: 'filesystem_unchanged', file: 'init.sql', hash: sqlHash }],
  expectedSuccess: true,
  tags: ['temporal', 'verify', 'stale_schema', 'TV-01', 'control'],
  rationale: 'No migration applied — hash should match current state',
});

// =============================================================================
// Shape TV-02: Config read stale after env change
// Edit changes .env but the predicate was "taken" against the old config state
// (checking the pre-edit hash or pattern). The observation is stale.
// =============================================================================

// TV-02a: Change .env PORT, predicate checks pre-change hash
scenarios.push({
  id: nextId('config'),
  description: 'TV-02: .env PORT changed to 4000, predicate checks pre-change .env hash (stale read)',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [{ type: 'filesystem_unchanged', file: '.env', hash: envHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02'],
  rationale: 'Env changed — config read taken before change is stale',
});

// TV-02b: Change .env NODE_ENV, predicate checks for old value
scenarios.push({
  id: nextId('config'),
  description: 'TV-02: .env NODE_ENV changed to development, predicate checks for "production"',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'NODE_ENV=production' }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02'],
  rationale: 'NODE_ENV changed but predicate still checks old value — stale config observation',
});

// TV-02c: Change config.json db name, predicate checks for old name
scenarios.push({
  id: nextId('config'),
  description: 'TV-02: config.json db name changed to app_db, predicate checks for "demo"',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "app_db"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "demo"' }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02'],
  rationale: 'DB name changed — observation of old name is stale evidence',
});

// TV-02d: Change config.json features, predicate checks for old value
scenarios.push({
  id: nextId('config'),
  description: 'TV-02: config.json analytics enabled, predicate checks for analytics:false',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"analytics": false' }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02'],
  rationale: 'Feature flag toggled — predicate checking old state is stale',
});

// TV-02e: Change .env SECRET_KEY, hash check on old .env
scenarios.push({
  id: nextId('config'),
  description: 'TV-02: .env SECRET_KEY rotated, predicate checks old SECRET_KEY pattern',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotated-2026-q2"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'not-very-secret' }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02'],
  rationale: 'Secret rotated — old secret pattern should not be found',
});

// TV-02f: Control — change .env and check for NEW value
scenarios.push({
  id: nextId('config'),
  description: 'TV-02 control: .env PORT changed, predicate checks for new value',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=9999' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'PORT=9999' }],
  expectedSuccess: true,
  tags: ['temporal', 'verify', 'stale_config', 'TV-02', 'control'],
  rationale: 'Predicate checks for new value — observation is fresh',
});

// =============================================================================
// Shape TV-03: File hash stale after edit
// Edit changes a file, but the predicate uses a hash computed BEFORE the edit.
// The hash is stale evidence — the file has moved on.
// =============================================================================

// TV-03a: Edit server.js, predicate checks pre-edit hash
scenarios.push({
  id: nextId('hash'),
  description: 'TV-03: Edit adds console.log to server.js, predicate checks pre-edit hash (stale)',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 3000;\nconsole.log("Server starting...");' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'server.js', hash: serverHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_hash', 'TV-03'],
  rationale: 'Edit modifies server.js — pre-edit hash is stale evidence',
});

// TV-03b: Edit config.json, predicate checks pre-edit hash
scenarios.push({
  id: nextId('hash'),
  description: 'TV-03: Edit changes config.json app name, predicate checks pre-edit hash',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Updated App"' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'config.json', hash: configHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_hash', 'TV-03'],
  rationale: 'Config name changed — file hash observation is stale',
});

// TV-03c: Edit Dockerfile, predicate checks pre-edit hash
const dockerHash = sha256(dockerfileContent);
scenarios.push({
  id: nextId('hash'),
  description: 'TV-03: Edit changes Dockerfile base image, predicate checks pre-edit hash',
  edits: [{ file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:22-alpine' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'Dockerfile', hash: dockerHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_hash', 'TV-03'],
  rationale: 'Dockerfile changed — hash taken before edit is stale',
});

// TV-03d: Edit two files, check hash of one
scenarios.push({
  id: nextId('hash'),
  description: 'TV-03: Edit both .env and config.json, predicate checks only config.json old hash',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=5000' },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 5000' },
  ],
  predicates: [{ type: 'filesystem_unchanged', file: 'config.json', hash: configHash }],
  expectedSuccess: false,
  tags: ['temporal', 'verify', 'stale_hash', 'TV-03'],
  rationale: 'Multi-file edit — config.json hash from before both edits is stale',
});

// TV-03e: Control — no edit, hash should match
scenarios.push({
  id: nextId('hash'),
  description: 'TV-03 control: No edit, server.js hash matches current',
  edits: [],
  predicates: [{ type: 'filesystem_unchanged', file: 'server.js', hash: serverHash }],
  expectedSuccess: true,
  tags: ['temporal', 'verify', 'stale_hash', 'TV-03', 'control'],
  rationale: 'No edit — hash is fresh evidence',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-verify scenarios → ${outPath}`);
