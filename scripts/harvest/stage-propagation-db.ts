#!/usr/bin/env bun
/**
 * Propagation × DB scenario generator
 * Grid cell: E×4
 * Shapes: PD-01 (column added but query doesn't select it), PD-02 (constraint added but app doesn't validate), PD-03 (index created but query plan unchanged)
 *
 * These scenarios test whether verify detects propagation gaps in the
 * schema→query→response chain — DDL changes that don't cascade to app behavior.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-propagation-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pd-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');

// =============================================================================
// Shape PD-01: Column added to schema but query/app doesn't select it
// DDL adds a new column but the application code has no reference to it.
// The schema→query propagation chain is broken.
// =============================================================================

// PD-01a: Add bio column to users, server.js doesn't reference bio
scenarios.push({
  id: nextId('column'),
  description: 'PD-01: Add bio TEXT to users table, server.js has no bio reference',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'bio' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'column_gap', 'PD-01'],
  rationale: 'Column added to schema but app code never selects or displays it — schema→query gap',
});

// PD-01b: Add avatar_url column to users, server.js has no avatar reference
scenarios.push({
  id: nextId('column'),
  description: 'PD-01: Add avatar_url TEXT to users table, server.js has no avatar reference',
  edits: [{ file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true,', replace: 'is_active BOOLEAN DEFAULT true,\n    avatar_url TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'avatar' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'column_gap', 'PD-01'],
  rationale: 'Avatar column added but API response has no avatar field — DDL→API propagation gap',
});

// PD-01c: Add category column to posts, server.js has no category reference
scenarios.push({
  id: nextId('column'),
  description: 'PD-01: Add category VARCHAR to posts, server.js has no category reference',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0,\n    category VARCHAR(50) DEFAULT \'general\',' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'category' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'column_gap', 'PD-01'],
  rationale: 'Category column in schema but no API or HTML displays it — schema→response gap',
});

// PD-01d: Add phone column to users, config.json has no phone field reference
scenarios.push({
  id: nextId('column'),
  description: 'PD-01: Add phone VARCHAR to users, config.json has no phone field reference',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'phone' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'column_gap', 'PD-01'],
  rationale: 'Phone column in DB but config has no phone-related setting — schema→config gap',
});

// PD-01e: Add new table tags, server.js has no /api/tags route
scenarios.push({
  id: nextId('column'),
  description: 'PD-01: Add tags table to init.sql, server.js has no /api/tags endpoint',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE settings', replace: 'CREATE TABLE tags (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(50) NOT NULL UNIQUE\n);\n\nCREATE TABLE settings' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '/api/tags' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'column_gap', 'PD-01'],
  rationale: 'New table created in schema but no API endpoint serves it — schema→route gap',
});

// PD-01f: Control — add column and check init.sql for it
scenarios.push({
  id: nextId('column'),
  description: 'PD-01 control: Add bio column, check init.sql for bio',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'bio TEXT' }],
  expectedSuccess: true,
  tags: ['propagation', 'db', 'column_gap', 'PD-01', 'control'],
  rationale: 'Same-file check — column is present in schema',
});

// =============================================================================
// Shape PD-02: Constraint added to schema but app doesn't validate
// DDL adds a constraint (NOT NULL, UNIQUE, CHECK) but the application code
// has no validation logic that enforces the same rule.
// =============================================================================

// PD-02a: Add NOT NULL to posts.body, server.js has no body validation
scenarios.push({
  id: nextId('constraint'),
  description: 'PD-02: posts.body made NOT NULL, server.js has no body validation logic',
  edits: [{ file: 'init.sql', search: 'body TEXT,', replace: 'body TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'body' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'constraint_gap', 'PD-02'],
  rationale: 'DB constraint added but app has no validation — constraint→validation propagation gap',
});

// PD-02b: Add UNIQUE on posts.title, server.js has no uniqueness check
scenarios.push({
  id: nextId('constraint'),
  description: 'PD-02: posts.title made UNIQUE, server.js has no duplicate title check',
  edits: [{ file: 'init.sql', search: 'title VARCHAR(200) NOT NULL,', replace: 'title VARCHAR(200) NOT NULL UNIQUE,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'UNIQUE' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'constraint_gap', 'PD-02'],
  rationale: 'Unique constraint on title but app has no duplicate detection — DB→app validation gap',
});

// PD-02c: Add CHECK constraint on view_count, server.js has no range validation
scenarios.push({
  id: nextId('constraint'),
  description: 'PD-02: CHECK(view_count >= 0) added, server.js has no negative check',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0 CHECK(view_count >= 0),' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'view_count' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'constraint_gap', 'PD-02'],
  rationale: 'CHECK constraint in DB but app never validates range — constraint→code propagation gap',
});

// PD-02d: Add email format constraint, server.js has no email validation
scenarios.push({
  id: nextId('constraint'),
  description: 'PD-02: Email CHECK constraint added, server.js has no email format validation',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: "email VARCHAR(255) NOT NULL CHECK(email LIKE '%@%.%')," }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'email' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'constraint_gap', 'PD-02'],
  rationale: 'Email format constraint in DB but app has no email validation — dual-layer gap',
});

// PD-02e: Control — add constraint and check init.sql
scenarios.push({
  id: nextId('constraint'),
  description: 'PD-02 control: Add NOT NULL to body, check init.sql for NOT NULL',
  edits: [{ file: 'init.sql', search: 'body TEXT,', replace: 'body TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'body TEXT NOT NULL' }],
  expectedSuccess: true,
  tags: ['propagation', 'db', 'constraint_gap', 'PD-02', 'control'],
  rationale: 'Same-file check — constraint is present in schema',
});

// =============================================================================
// Shape PD-03: Index created but query plan / app behavior unchanged
// DDL adds an index but neither the app code nor config reflects the
// optimization opportunity. The index exists but nothing leverages it.
// =============================================================================

// PD-03a: Add index on posts.user_id, server.js has no user-filtered query
scenarios.push({
  id: nextId('index'),
  description: 'PD-03: Index on posts.user_id added, server.js has no user_id query',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_posts_user ON posts(user_id);' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'user_id' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'index_gap', 'PD-03'],
  rationale: 'Index created for user_id lookups but app has no user-filtered query — index→query gap',
});

// PD-03b: Add index on users.email, server.js has no email lookup
scenarios.push({
  id: nextId('index'),
  description: 'PD-03: Index on users.email added, server.js has no email lookup route',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE INDEX idx_sessions_token ON sessions(token);\nCREATE INDEX idx_users_email ON users(email);' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'email' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'index_gap', 'PD-03'],
  rationale: 'Email index created but no app route queries by email — index optimization unexploited',
});

// PD-03c: Add composite index, config.json has no query optimization setting
scenarios.push({
  id: nextId('index'),
  description: 'PD-03: Composite index on posts(user_id, published), config.json has no optimization flag',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_posts_user_published ON posts(user_id, published);' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'optimization' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'index_gap', 'PD-03'],
  rationale: 'Composite index added but config has no optimization awareness — schema→config gap',
});

// PD-03d: Add index on settings.key, server.js has no settings lookup
scenarios.push({
  id: nextId('index'),
  description: 'PD-03: Index on settings.key added, server.js has no /api/settings route',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_settings_key ON settings(key);' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'settings' }],
  expectedSuccess: false,
  tags: ['propagation', 'db', 'index_gap', 'PD-03'],
  rationale: 'Settings index created but no API endpoint uses settings table — index→route gap',
});

// PD-03e: Control — add index and check init.sql for it
scenarios.push({
  id: nextId('index'),
  description: 'PD-03 control: Add index on users.email, check init.sql for it',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE INDEX idx_sessions_token ON sessions(token);\nCREATE INDEX idx_users_email ON users(email);' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'idx_users_email' }],
  expectedSuccess: true,
  tags: ['propagation', 'db', 'index_gap', 'PD-03', 'control'],
  rationale: 'Same-file check — index definition is present in schema',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-db scenarios → ${outPath}`);
