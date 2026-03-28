#!/usr/bin/env bun
/**
 * Observation × Database scenario generator
 * Grid cell: F×4
 * Shapes: FD-01 (schema introspection creates metadata artifacts),
 *         FD-02 (SELECT with side effects — triggers, audit logs),
 *         FD-03 (connection count incremented by observation)
 *
 * Observation rule: every scenario must show how READING database state CHANGES
 * database state. The observer effect — measuring the system alters the measurement.
 *
 * Key distinction from State × Database (SD: wrong database identity):
 * - State: agent looks at wrong DB — belief about identity is wrong
 * - Observation: agent looks at RIGHT DB but the look itself mutates DB state
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-observation-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/observation-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `fd-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape FD-01: Schema introspection creates metadata artifacts
// Agent queries information_schema or pg_catalog to understand the DB structure.
// The query itself creates query plan cache entries, statistics updates, or
// metadata rows that change the observable state.
// =============================================================================

// FD-01a: Add pg_stat_statements tracking — every query observation adds a row
scenarios.push({
  id: nextId('introspect'),
  description: 'FD-01: Add pg_stat_statements to init.sql — schema introspection queries add tracking rows',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE users (',
    replace: 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;\n\nCREATE TABLE users ('
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'pg_stat_statements' },
    { type: 'content', file: 'server.js', pattern: 'pg_stat_statements' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'introspection_artifact', 'FD-01'],
  rationale: 'Assumed: schema introspection is read-only. Actual: pg_stat_statements extension tracks every query — observation adds measurement artifacts. server.js has no reference.',
});

// FD-01b: Add auto-analyze trigger — SELECT triggers ANALYZE update
scenarios.push({
  id: nextId('introspect'),
  description: 'FD-01: Add auto-analyze config comment to init.sql, server.js doesn\'t account for stats update',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_token ON sessions(token);',
    replace: '-- autovacuum_analyze_threshold = 50 (each SELECT updates relfrozenxid)\nCREATE INDEX idx_sessions_token ON sessions(token);'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'autovacuum' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'introspection_artifact', 'FD-01'],
  rationale: 'Assumed: reading tables doesn\'t trigger maintenance. Actual: SELECT updates tuple statistics, triggering auto-analyze. App has no awareness.',
});

// FD-01c: Add schema version table that tracks introspection queries
scenarios.push({
  id: nextId('introspect'),
  description: 'FD-01: Add schema_versions table with last_introspected_at, querying schema updates this timestamp',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "CREATE TABLE schema_versions (\n    table_name VARCHAR(100) PRIMARY KEY,\n    last_introspected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'last_introspected_at' },
    { type: 'content', file: 'server.js', pattern: 'schema_versions' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'introspection_artifact', 'FD-01'],
  rationale: 'Assumed: schema introspection is side-effect-free. Actual: schema_versions table tracks observations — each look updates last_introspected_at.',
});

// FD-01d: Add query logging table — each observation is logged
scenarios.push({
  id: nextId('introspect'),
  description: 'FD-01: Add query_log table to init.sql that would capture all SELECT statements',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "CREATE TABLE query_log (\n    id SERIAL PRIMARY KEY,\n    query_text TEXT NOT NULL,\n    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'query_log' },
    { type: 'content', file: 'config.json', pattern: 'query_log' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'introspection_artifact', 'FD-01'],
  rationale: 'Assumed: queries don\'t generate logs. Actual: query_log table grows with each observation. Config has no awareness.',
});

// FD-01e: Control — init.sql has tables, check init.sql for table names
scenarios.push({
  id: nextId('introspect'),
  description: 'FD-01 control: init.sql defines users table, check init.sql confirms',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE users' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'database', 'introspection_artifact', 'FD-01', 'control'],
  rationale: 'Static schema check — no observation side effects. File content doesn\'t change from reading it.',
});

// =============================================================================
// Shape FD-02: SELECT with side effects — triggers, audit logs
// Agent runs a SELECT query but the table has triggers that fire on reads,
// or the query updates a "last accessed" timestamp, or triggers audit log writes.
// =============================================================================

// FD-02a: Add last_accessed trigger on users table — SELECT updates timestamp
scenarios.push({
  id: nextId('select'),
  description: 'FD-02: Add trigger on users table that updates last_accessed on any SELECT',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE posts (',
    replace: "-- Trigger: update last_accessed on any row access\n-- CREATE TRIGGER update_last_accessed BEFORE SELECT ON users\n-- FOR EACH ROW EXECUTE FUNCTION update_accessed_at();\n\nCREATE TABLE posts ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'update_last_accessed' },
    { type: 'content', file: 'server.js', pattern: 'last_accessed' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'select_side_effect', 'FD-02'],
  rationale: 'Assumed: SELECT is read-only. Actual: trigger updates last_accessed on read. Observation mutates observed state.',
});

// FD-02b: Add audit trail table — every query generates an audit row
scenarios.push({
  id: nextId('select'),
  description: 'FD-02: Add audit_trail table with trigger on SELECT, predicate checks server.js for audit awareness',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "CREATE TABLE audit_trail (\n    id SERIAL PRIMARY KEY,\n    table_name VARCHAR(100),\n    action VARCHAR(20),\n    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'audit_trail' },
    { type: 'content', file: 'server.js', pattern: 'audit_trail' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'select_side_effect', 'FD-02'],
  rationale: 'Assumed: reading data doesn\'t create audit entries. Actual: audit_trail grows with each query. App has no audit awareness.',
});

// FD-02c: Add view_count increment trigger — SELECT on posts increments counter
scenarios.push({
  id: nextId('select'),
  description: 'FD-02: posts.view_count would be incremented by a read trigger, predicate checks for trigger in init.sql',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_token ON sessions(token);',
    replace: "-- Observation side effect: reading a post increments view_count\n-- CREATE RULE increment_views AS ON SELECT TO posts DO ALSO\n--   UPDATE posts SET view_count = view_count + 1 WHERE id = OLD.id;\n\nCREATE INDEX idx_sessions_token ON sessions(token);"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'view_count' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'select_side_effect', 'FD-02'],
  rationale: 'Assumed: SELECT on posts is read-only. Actual: view_count trigger fires on read. Each observation inflates metrics.',
});

// FD-02d: Session lookup extends session expiry — reading session state changes it
scenarios.push({
  id: nextId('select'),
  description: 'FD-02: Session token lookup would extend expires_at, predicate checks for extension logic in server.js',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: "-- Observation: session lookup extends expiry (sliding window)\n-- UPDATE sessions SET expires_at = NOW() + interval '1 hour' WHERE token = $1;\nCREATE INDEX idx_sessions_expires ON sessions(expires_at);"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'expires_at' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'select_side_effect', 'FD-02'],
  rationale: 'Assumed: checking session is read-only. Actual: lookup extends expiry — observation changes session lifetime.',
});

// FD-02e: Control — init.sql has sessions table, check for sessions (no side effects)
scenarios.push({
  id: nextId('select'),
  description: 'FD-02 control: init.sql defines sessions table, predicate checks init.sql for sessions',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE sessions' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'database', 'select_side_effect', 'FD-02', 'control'],
  rationale: 'Static file check — no database observation, no side effects.',
});

// =============================================================================
// Shape FD-03: Connection count incremented by observation
// Agent opens a DB connection to observe state, but the connection itself
// changes observable metrics (connection count, pool exhaustion, memory).
// =============================================================================

// FD-03a: Add max_connections comment — each observation uses a connection slot
scenarios.push({
  id: nextId('conn'),
  description: 'FD-03: Add max_connections=20 config to init.sql, observation queries consume connection slots',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE users (',
    replace: "-- max_connections = 20 (each observation query holds a connection)\n-- Agent introspection consumes 1 of 20 slots per probe\n\nCREATE TABLE users ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'max_connections' },
    { type: 'content', file: 'config.json', pattern: 'max_connections' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'connection_count', 'FD-03'],
  rationale: 'Assumed: observation is free. Actual: each probe holds a connection slot. At max_connections=20, 20 concurrent probes = pool exhaustion.',
});

// FD-03b: Add connection tracking table — observing connection count adds a connection
scenarios.push({
  id: nextId('conn'),
  description: 'FD-03: Add active_connections tracking table, querying it requires a connection (observer effect)',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "CREATE TABLE active_connections (\n    id SERIAL PRIMARY KEY,\n    client_addr INET,\n    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'active_connections' },
    { type: 'content', file: 'server.js', pattern: 'active_connections' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'connection_count', 'FD-03'],
  rationale: 'Assumed: querying connection count is read-only. Actual: the query itself is a connection — Heisenberg: you can\'t observe connections without being one.',
});

// FD-03c: Database pool exhaustion warning — config shows pool_size but no awareness in server.js
scenarios.push({
  id: nextId('conn'),
  description: 'FD-03: Add pool_size to config.json, server.js has no connection pooling awareness',
  edits: [{
    file: 'config.json',
    search: '"name": "demo"',
    replace: '"name": "demo",\n    "pool_size": 5'
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'pool_size' },
    { type: 'content', file: 'server.js', pattern: 'pool' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'connection_count', 'FD-03'],
  rationale: 'Assumed: server.js respects pool_size. Actual: server.js has no DB client — pool_size in config is inert.',
});

// FD-03d: Add connection timeout config — probes that take too long kill other connections
scenarios.push({
  id: nextId('conn'),
  description: 'FD-03: Add statement_timeout to config, predicate checks .env for timeout reference',
  edits: [{
    file: 'config.json',
    search: '"name": "demo"',
    replace: '"name": "demo",\n    "statement_timeout": 5000'
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'statement_timeout' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'database', 'connection_count', 'FD-03'],
  rationale: 'Assumed: config timeout propagates to .env. Actual: .env has no timeout config — observation timeout only in config.json.',
});

// FD-03e: Control — config.json and init.sql agree on database name
scenarios.push({
  id: nextId('conn'),
  description: 'FD-03 control: config.json db name and init.sql exist consistently',
  edits: [],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"name": "demo"' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'database', 'connection_count', 'FD-03', 'control'],
  rationale: 'Static file check — config and schema files are read without any DB connections.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} observation-database scenarios → ${outPath}`);
