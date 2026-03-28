#!/usr/bin/env bun
/**
 * Contention x Database scenario generator
 * Grid cell: J x 4
 * Shapes: JD-01 (deadlock / conflicting constraints), JD-02 (concurrent migrations), JD-03 (row-level lock / timeout)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent
 * database actors. Two migrations or schema changes targeting the same table/column
 * create conflicting state — constraint violations, ambiguous schema, or deadlock.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency
 * at the schema definition level in init.sql and related files.
 *
 * Run: bun scripts/harvest/stage-contention-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jd-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');

// =============================================================================
// Shape JD-01: Deadlock — two edits create conflicting constraints on same table
// Both edits modify init.sql schema with constraints that contradict each other.
// The second edit's search string won't match, or the resulting schema is invalid.
// =============================================================================

// JD-01a: Two edits add conflicting unique constraints on users table
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01: Two edits add conflicting constraints — UNIQUE on email (already NOT NULL) and DROP email column',
  edits: [
    { file: 'init.sql', search: '    email VARCHAR(255) NOT NULL,', replace: '    email VARCHAR(255) NOT NULL UNIQUE,' },
    { file: 'init.sql', search: '    email VARCHAR(255) NOT NULL,', replace: '    email TEXT,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'email TEXT' }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'deadlock', 'JD-01'],
  rationale: 'Second edit targets original email line which first edit already modified — concurrent constraint collision',
});

// JD-01b: One edit adds FK from posts to sessions, another drops sessions table
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01: One edit adds FK to sessions, another rewrites sessions table',
  edits: [
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    session_id UUID REFERENCES sessions(id),' },
    { file: 'init.sql', search: 'CREATE TABLE sessions (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id INTEGER NOT NULL REFERENCES users(id),\n    token TEXT NOT NULL UNIQUE,\n    expires_at TIMESTAMP NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', replace: 'CREATE TABLE sessions (\n    id SERIAL PRIMARY KEY,\n    data JSONB NOT NULL\n);' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'session_id UUID REFERENCES sessions(id)' },
    { type: 'content', file: 'init.sql', pattern: 'id SERIAL PRIMARY KEY' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'database', 'deadlock', 'JD-01'],
  rationale: 'FK references sessions(id) as UUID but sessions table rewritten with SERIAL id — type mismatch deadlock',
});

// JD-01c: Two edits change password_hash column to different types
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01: Two edits both change password_hash type in users table',
  edits: [
    { file: 'init.sql', search: '    password_hash TEXT NOT NULL,', replace: '    password_hash BYTEA NOT NULL,' },
    { file: 'init.sql', search: '    password_hash TEXT NOT NULL,', replace: '    password_hash VARCHAR(128) NOT NULL,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'VARCHAR(128)' }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'deadlock', 'JD-01'],
  rationale: 'Both edits target same column definition — second search string gone after first edit',
});

// JD-01d: Edit adds NOT NULL to body column, another edit adds DEFAULT for same column
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01: One edit makes body NOT NULL, another sets DEFAULT on same column',
  edits: [
    { file: 'init.sql', search: '    body TEXT,', replace: '    body TEXT NOT NULL,' },
    { file: 'init.sql', search: '    body TEXT,', replace: '    body TEXT DEFAULT \'\',' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: "body TEXT DEFAULT ''" }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'deadlock', 'JD-01'],
  rationale: 'Both edits target same "body TEXT," line — second edit search fails after first modifies it',
});

// JD-01e: Two edits both change settings table primary key type
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01: Two edits change settings key column type',
  edits: [
    { file: 'init.sql', search: '    key VARCHAR(100) PRIMARY KEY,', replace: '    key TEXT PRIMARY KEY,' },
    { file: 'init.sql', search: '    key VARCHAR(100) PRIMARY KEY,', replace: '    key UUID PRIMARY KEY DEFAULT gen_random_uuid(),' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'key UUID PRIMARY KEY' }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'deadlock', 'JD-01'],
  rationale: 'Both edits target same key column definition — concurrent type change collision',
});

// JD-01f: Control — two edits modify different tables (no conflict)
scenarios.push({
  id: nextId('dead'),
  description: 'JD-01 control: Two edits on different tables — no constraint conflict',
  edits: [
    { file: 'init.sql', search: '    password_hash TEXT NOT NULL,', replace: '    password_hash BYTEA NOT NULL,' },
    { file: 'init.sql', search: '    value JSONB NOT NULL,', replace: '    value TEXT NOT NULL,' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'password_hash BYTEA NOT NULL' },
    { type: 'content', file: 'init.sql', pattern: 'value TEXT NOT NULL' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'deadlock', 'JD-01', 'control'],
  rationale: 'Edits target different tables (users vs settings) — no deadlock possible',
});

// =============================================================================
// Shape JD-02: Concurrent migrations — two agents modify schema simultaneously
// Both edits change init.sql in ways that produce ambiguous final state.
// One creates a table that the other also creates with different structure.
// =============================================================================

// JD-02a: Both edits add a new table with same name but different columns
scenarios.push({
  id: nextId('migr'),
  description: 'JD-02: Two edits both add "audit_log" table with different schemas after settings',
  edits: [
    { file: 'init.sql', search: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', replace: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE audit_log (\n    id SERIAL PRIMARY KEY,\n    action TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);' },
    { file: 'init.sql', search: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', replace: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE audit_log (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    user_id INTEGER REFERENCES users(id),\n    event_type VARCHAR(50)\n);' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'event_type VARCHAR(50)' }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'concurrent_migration', 'JD-02'],
  rationale: 'Second edit search string gone after first edit appended its version of audit_log',
});

// JD-02b: One edit adds index on sessions.token, another drops and recreates sessions
scenarios.push({
  id: nextId('migr'),
  description: 'JD-02: One edit adds new index, another rewrites the index target',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE UNIQUE INDEX idx_sessions_token ON sessions(token);' },
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE INDEX idx_sessions_token_hash ON sessions USING hash(token);' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'USING hash(token)' }],
  expectedSuccess: false,
  tags: ['contention', 'database', 'concurrent_migration', 'JD-02'],
  rationale: 'Both edits target same CREATE INDEX statement — second search string gone after first',
});

// JD-02c: Two edits both modify posts table — one renames, one adds column
scenarios.push({
  id: nextId('migr'),
  description: 'JD-02: One edit renames posts to articles, another adds category to posts',
  edits: [
    { file: 'init.sql', search: 'CREATE TABLE posts (', replace: 'CREATE TABLE articles (' },
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    category VARCHAR(50),' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE articles' },
    { type: 'content', file: 'init.sql', pattern: 'category VARCHAR(50)' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'concurrent_migration', 'JD-02'],
  rationale: 'Non-overlapping search strings — rename and column add both succeed but create semantic inconsistency (articles table with posts-era columns)',
});

// JD-02d: Edit adds FK from posts to settings, another changes settings PK type
scenarios.push({
  id: nextId('migr'),
  description: 'JD-02: One edit adds FK to settings(key), another changes settings key to UUID',
  edits: [
    { file: 'init.sql', search: '    published BOOLEAN DEFAULT false,', replace: '    published BOOLEAN DEFAULT false,\n    setting_ref VARCHAR(100) REFERENCES settings(key),' },
    { file: 'init.sql', search: '    key VARCHAR(100) PRIMARY KEY,', replace: '    key UUID PRIMARY KEY DEFAULT gen_random_uuid(),' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'setting_ref VARCHAR(100) REFERENCES settings(key)' },
    { type: 'content', file: 'init.sql', pattern: 'key UUID PRIMARY KEY' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'concurrent_migration', 'JD-02'],
  rationale: 'Both edits apply (different search strings) but create FK type mismatch — VARCHAR(100) references UUID column',
});

// JD-02e: Control — two edits add tables with different names (no conflict)
scenarios.push({
  id: nextId('migr'),
  description: 'JD-02 control: Two edits add different tables at end of init.sql',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE tags (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(50) NOT NULL\n);' },
    { file: 'init.sql', search: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', replace: '    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE categories (\n    id SERIAL PRIMARY KEY,\n    label VARCHAR(100) NOT NULL\n);' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE tags' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE categories' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'concurrent_migration', 'JD-02', 'control'],
  rationale: 'Different tables added at different insertion points — no migration conflict',
});

// =============================================================================
// Shape JD-03: Row-level lock wait / timeout — edits create state where
// configuration declares timeout limits that conflict with schema complexity
// =============================================================================

// JD-03a: Edit config.json with short timeout, init.sql has long transaction (many tables)
scenarios.push({
  id: nextId('lock'),
  description: 'JD-03: Config has low lock_timeout, predicate expects all tables created in init.sql',
  edits: [
    { file: 'config.json', search: '"features": {', replace: '"lock_timeout_ms": 100,\n  "features": {' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"lock_timeout_ms": 100' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE settings' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE sessions' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'lock_timeout', 'JD-03'],
  rationale: 'Config sets timeout but init.sql still has all tables — structural check passes even if runtime would timeout',
});

// JD-03b: Edit adds row-level lock hint in init.sql, config contradicts with short timeout
scenarios.push({
  id: nextId('lock'),
  description: 'JD-03: Edit adds advisory lock in init.sql, predicate expects lock AND low timeout in config',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\n-- Advisory lock for migration safety\nSELECT pg_advisory_lock(12345);' },
    { file: 'config.json', search: '"features": {', replace: '"statement_timeout_ms": 50,\n  "features": {' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'pg_advisory_lock' },
    { type: 'content', file: 'config.json', pattern: '"statement_timeout_ms": 50' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'database', 'lock_timeout', 'JD-03'],
  rationale: 'Both edits apply (different files) but create runtime contention — advisory lock with 50ms timeout',
});

// JD-03c: Edit adds exclusive lock on users, predicate expects concurrent read on users
scenarios.push({
  id: nextId('lock'),
  description: 'JD-03: Edit adds LOCK TABLE users in init.sql, predicate checks for concurrent SELECT',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'LOCK TABLE users IN ACCESS EXCLUSIVE MODE;\nCREATE INDEX idx_sessions_token ON sessions(token);' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'LOCK TABLE users IN ACCESS EXCLUSIVE MODE' },
    { type: 'content', file: 'server.js', pattern: 'SELECT * FROM users' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'database', 'lock_timeout', 'JD-03'],
  rationale: 'Edit adds exclusive lock on users but server.js has no SQL — predicate for concurrent SELECT fails',
});

// JD-03d: Edit changes DATABASE_URL to point to different DB, init.sql schema doesn't match
scenarios.push({
  id: nextId('lock'),
  description: 'JD-03: Edit changes DATABASE_URL to new DB, predicate expects users table in that DB',
  edits: [
    { file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://localhost:5432/production"' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'production' },
    { type: 'content', file: 'init.sql', pattern: 'production' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'database', 'lock_timeout', 'JD-03'],
  rationale: 'DATABASE_URL points to "production" but init.sql has no reference — schema/connection contention',
});

// JD-03e: Control — edit adds timeout config, predicate checks only config
scenarios.push({
  id: nextId('lock'),
  description: 'JD-03 control: Add timeout config, check only config.json',
  edits: [{ file: 'config.json', search: '"features": {', replace: '"idle_timeout_ms": 30000,\n  "features": {' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"idle_timeout_ms": 30000' }],
  expectedSuccess: true,
  tags: ['contention', 'database', 'lock_timeout', 'JD-03', 'control'],
  rationale: 'Single file edit, same file predicate — no lock contention',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-db scenarios -> ${outPath}`);
