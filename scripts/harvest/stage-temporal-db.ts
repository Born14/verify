#!/usr/bin/env bun
/**
 * Temporal × Database scenario generator
 * Grid cell: D×4
 * Shapes: TD-01 (stale schema after migration), TD-02 (read-after-write lag), TD-03 (auto-increment not visible)
 *
 * These scenarios test whether verify's DB gate correctly handles temporal
 * issues: schema introspection cache serving stale data after DDL, immediate
 * reads returning old data, sequence values not visible after CREATE.
 *
 * DB scenarios require a live Postgres instance → requiresDocker: true, requiresLiveHttp: true.
 * Pure-tier scenarios test structural correctness without Docker.
 *
 * Run: bun scripts/harvest/stage-temporal-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `td-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read init.sql for reference
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape TD-01: Connection pool serves stale schema after migration
// A migration adds/removes a column, but the DB predicate checks for the
// old schema — simulates stale pool that hasn't refreshed metadata.
// =============================================================================

// TD-01a: Migration adds column, predicate checks old column still exists (it does)
scenarios.push({
  id: nextId('stale'),
  description: 'TD-01: ALTER TABLE adds bio column, predicate checks existing username column',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'username', assertion: 'column_exists' }],
  config: {
    migrations: [{ name: 'add_bio', sql: 'ALTER TABLE users ADD COLUMN bio TEXT;' }],
  },
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01'],
  rationale: 'Migration adds new column but predicate checks existing column — should still exist',
});

// TD-01b: Migration adds column, predicate checks for the NEW column
scenarios.push({
  id: nextId('stale'),
  description: 'TD-01: ALTER TABLE adds bio column, predicate checks for bio column',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'bio', assertion: 'column_exists' }],
  config: {
    migrations: [{ name: 'add_bio', sql: 'ALTER TABLE users ADD COLUMN bio TEXT;' }],
  },
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01'],
  rationale: 'After migration, new column should be visible — tests if gate refreshes schema',
});

// TD-01c: Migration renames table, predicate checks old table name
scenarios.push({
  id: nextId('stale'),
  description: 'TD-01: ALTER TABLE renames posts to articles, predicate checks posts still exists',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', assertion: 'table_exists' }],
  config: {
    migrations: [{ name: 'rename_posts', sql: 'ALTER TABLE posts RENAME TO articles;' }],
  },
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01'],
  rationale: 'Table renamed — stale pool might still see old name, but fresh introspection should not',
});

// TD-01d: Migration drops column, predicate expects it
scenarios.push({
  id: nextId('stale'),
  description: 'TD-01: ALTER TABLE drops view_count from posts, predicate expects it',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'view_count', assertion: 'column_exists' }],
  config: {
    migrations: [{ name: 'drop_viewcount', sql: 'ALTER TABLE posts DROP COLUMN view_count;' }],
  },
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01'],
  rationale: 'Column dropped — predicate should detect absence even if pool cached old schema',
});

// TD-01e: Control — no migration, predicate checks existing table
scenarios.push({
  id: nextId('stale'),
  description: 'TD-01 control: No migration, users table exists',
  edits: [],
  predicates: [{ type: 'db', table: 'users', assertion: 'table_exists' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01', 'control'],
  rationale: 'No schema change — existing table should be found',
});

// =============================================================================
// Shape TD-02: Read-after-write returns old data (replication lag)
// These simulate scenarios where a schema change or data write happens
// but an immediate read (via API) might return stale results.
// We use http predicates to test the API layer's response to schema changes.
// =============================================================================

// TD-02a: Migration adds column, API response doesn't include it
scenarios.push({
  id: nextId('lag'),
  description: 'TD-02: Migration adds avatar_url column, API /api/items has no avatar data',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'avatar_url' },
  }],
  config: {
    migrations: [{ name: 'add_avatar', sql: 'ALTER TABLE users ADD COLUMN avatar_url TEXT;' }],
  },
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'replication_lag', 'TD-02'],
  rationale: 'Schema change added column but API layer not updated — stale response shape',
});

// TD-02b: Migration changes table, API still serves old shape
scenarios.push({
  id: nextId('lag'),
  description: 'TD-02: Migration adds published_at to posts, API has no reference to it',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'published_at' },
  }],
  config: {
    migrations: [{ name: 'add_published_at', sql: 'ALTER TABLE posts ADD COLUMN published_at TIMESTAMP;' }],
  },
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'replication_lag', 'TD-02'],
  rationale: 'Schema changed but API response format unchanged — DB/API shape mismatch',
});

// =============================================================================
// Shape TD-03: Auto-increment not visible after migration
// New table created but predicate checks for specific structure.
// =============================================================================

// TD-03a: Migration creates new table, predicate checks it exists
scenarios.push({
  id: nextId('seq'),
  description: 'TD-03: Migration creates tags table, predicate checks it exists',
  edits: [],
  predicates: [{ type: 'db', table: 'tags', assertion: 'table_exists' }],
  config: {
    migrations: [{ name: 'create_tags', sql: 'CREATE TABLE tags (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL);' }],
  },
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'sequence_visibility', 'TD-03'],
  rationale: 'New table created — should be immediately visible after migration',
});

// TD-03b: Migration creates table with columns, check specific column
scenarios.push({
  id: nextId('seq'),
  description: 'TD-03: Migration creates audit_log table, check for action column',
  edits: [],
  predicates: [{ type: 'db', table: 'audit_log', column: 'action', assertion: 'column_exists' }],
  config: {
    migrations: [{
      name: 'create_audit',
      sql: 'CREATE TABLE audit_log (id SERIAL PRIMARY KEY, action VARCHAR(100) NOT NULL, actor_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);',
    }],
  },
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'sequence_visibility', 'TD-03'],
  rationale: 'New table + column should be visible immediately after CREATE TABLE',
});

// TD-03c: Check for table that migration does NOT create (negative)
scenarios.push({
  id: nextId('seq'),
  description: 'TD-03: No migration creates comments table, predicate expects it',
  edits: [],
  predicates: [{ type: 'db', table: 'comments', assertion: 'table_exists' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'database', 'sequence_visibility', 'TD-03'],
  rationale: 'Table never created — should not exist',
});

// =============================================================================
// Pure-tier structural scenarios (no Docker needed)
// Test init.sql / config interaction without live database
// =============================================================================

// TD-pure-01: Edit init.sql to add column, content check for column in init.sql
scenarios.push({
  id: nextId('pure'),
  description: 'TD-pure: Edit init.sql adds bio column, content predicate finds it',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'bio TEXT' }],
  expectedSuccess: true,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01', 'pure'],
  rationale: 'Edit adds column to init.sql — content gate should find it',
});

// TD-pure-02: Edit init.sql to rename table, content check for old name
scenarios.push({
  id: nextId('pure'),
  description: 'TD-pure: Edit renames posts table, content check for old "CREATE TABLE posts"',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE posts', replace: 'CREATE TABLE articles' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE TABLE posts' }],
  expectedSuccess: false,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01', 'pure'],
  rationale: 'Table renamed in init.sql — old name should not be found',
});

// TD-pure-03: Edit init.sql column, check server.js for DB-API consistency
scenarios.push({
  id: nextId('pure'),
  description: 'TD-pure: Edit init.sql column name, server.js API has no reference',
  edits: [{ file: 'init.sql', search: 'password_hash TEXT NOT NULL,', replace: 'password_digest TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'password_digest' }],
  expectedSuccess: false,
  tags: ['temporal', 'database', 'replication_lag', 'TD-02', 'pure'],
  rationale: 'Column renamed in schema but server.js code references old name — DB/API desync',
});

// TD-pure-04: Edit init.sql to add constraint, config.json has no reference
scenarios.push({
  id: nextId('pure'),
  description: 'TD-pure: Edit init.sql adds CHECK constraint, config.json has no validation',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0 CHECK (view_count >= 0),' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'view_count' }],
  expectedSuccess: false,
  tags: ['temporal', 'database', 'stale_pool', 'TD-01', 'pure'],
  rationale: 'Schema constraint added but config has no awareness — temporal gap between layers',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-db scenarios → ${outPath}`);
