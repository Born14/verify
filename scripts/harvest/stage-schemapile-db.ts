#!/usr/bin/env bun
/**
 * stage-schemapile-db.ts — SchemaPile Database Schema Scenario Stager
 *
 * Generates ~130 database schema verification scenarios inspired by SchemaPile
 * (221K real-world PostgreSQL schemas). Tests the full spectrum of schema
 * verification patterns against the demo-app's init.sql.
 *
 * The demo-app schema has 4 tables:
 *   - users:    id SERIAL PK, username VARCHAR(50) NOT NULL UNIQUE, email VARCHAR(255) NOT NULL,
 *               password_hash TEXT NOT NULL, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP
 *   - posts:    id SERIAL PK, user_id INTEGER NOT NULL FK→users, title VARCHAR(200) NOT NULL,
 *               body TEXT, published BOOLEAN DEFAULT false, view_count INTEGER DEFAULT 0, created_at TIMESTAMP
 *   - sessions: id UUID PK DEFAULT gen_random_uuid(), user_id INTEGER NOT NULL FK→users,
 *               token TEXT NOT NULL UNIQUE, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP
 *   - settings: key VARCHAR(100) PK, value JSONB NOT NULL, updated_at TIMESTAMP
 *
 * 12 scenario categories (DB-01 through DB-12):
 *   DB-01  Table existence         — real + fabricated tables
 *   DB-02  Column existence        — real + fabricated columns
 *   DB-03  Column types            — correct + wrong type assertions
 *   DB-04  Constraints             — NOT NULL, UNIQUE, DEFAULT, CHECK
 *   DB-05  Foreign keys            — existing + fabricated FK relationships
 *   DB-06  Indexes                 — PK indexes, unique indexes, custom indexes
 *   DB-07  Migration patterns      — add column, add table, add FK, add index
 *   DB-08  Schema anti-patterns    — VARCHAR without length, TEXT as PK, missing timestamps
 *   DB-09  Data types              — PostgreSQL-specific: UUID, JSONB, ARRAY, INET, TIMESTAMPTZ
 *   DB-10  Multi-table patterns    — junction tables, soft deletes, audit trails, tenant isolation
 *   DB-11  Naming conventions      — snake_case, singular/plural, _id suffix, _at suffix
 *   DB-12  Schema evolution        — adding NOT NULL, dropping columns, renaming, splitting
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const INIT_SQL_PATH = resolve(__dirname, '../../fixtures/demo-app/init.sql');
const INIT_SQL = readFileSync(INIT_SQL_PATH, 'utf8');

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
let id = 1;

function push(s: Omit<Scenario, 'id'> & { id?: string }) {
  scenarios.push({ id: `spdb-${String(id++).padStart(3, '0')}`, ...s });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB-01: Table Existence — Verify tables exist or don't exist
// ═══════════════════════════════════════════════════════════════════════════════

// Real tables that exist
for (const table of ['users', 'posts', 'sessions', 'settings']) {
  push({
    description: `DB-01: Table "${table}" exists in schema`,
    edits: [],
    predicates: [{ type: 'db', table, assertion: 'table_exists' }],
    expectedSuccess: true,
    tags: ['db', 'table_existence', 'DB-01'],
  });
}

// Fabricated tables that do NOT exist
for (const table of [
  'orders', 'products', 'payments', 'invoices', 'categories',
  'comments', 'tags', 'roles', 'permissions', 'audit_log',
  'migrations', 'schema_versions',
]) {
  push({
    description: `DB-01: Table "${table}" does NOT exist (fabricated)`,
    edits: [],
    predicates: [{ type: 'db', table, assertion: 'table_exists' }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'table_existence', 'DB-01'],
  });
}

// Near-miss table names (singular vs plural, typos)
for (const table of ['user', 'post', 'session', 'setting']) {
  push({
    description: `DB-01: Table "${table}" (singular form) does NOT exist — schema uses plural`,
    edits: [],
    predicates: [{ type: 'db', table, assertion: 'table_exists' }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'table_existence', 'DB-01'],
  });
}

// Case variants — grounding is case-insensitive
push({
  description: 'DB-01: Table "USERS" (uppercase) found via case-insensitive match',
  edits: [],
  predicates: [{ type: 'db', table: 'USERS', assertion: 'table_exists' }],
  expectedSuccess: true,
  tags: ['db', 'table_existence', 'DB-01'],
});

push({
  description: 'DB-01: Table "Posts" (mixed case) found via case-insensitive match',
  edits: [],
  predicates: [{ type: 'db', table: 'Posts', assertion: 'table_exists' }],
  expectedSuccess: true,
  tags: ['db', 'table_existence', 'DB-01'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-02: Column Existence — Verify columns exist on tables
// ═══════════════════════════════════════════════════════════════════════════════

// Real columns on users
for (const column of ['id', 'username', 'email', 'password_hash', 'is_active', 'created_at']) {
  push({
    description: `DB-02: Column "users.${column}" exists`,
    edits: [],
    predicates: [{ type: 'db', table: 'users', column, assertion: 'column_exists' }],
    expectedSuccess: true,
    tags: ['db', 'column_existence', 'DB-02'],
  });
}

// Real columns on posts
for (const column of ['id', 'user_id', 'title', 'body', 'published', 'view_count', 'created_at']) {
  push({
    description: `DB-02: Column "posts.${column}" exists`,
    edits: [],
    predicates: [{ type: 'db', table: 'posts', column, assertion: 'column_exists' }],
    expectedSuccess: true,
    tags: ['db', 'column_existence', 'DB-02'],
  });
}

// Fabricated columns that do NOT exist
const FABRICATED_COLS = [
  { table: 'users', column: 'avatar_url' },
  { table: 'users', column: 'phone_number' },
  { table: 'users', column: 'role' },
  { table: 'users', column: 'last_login' },
  { table: 'posts', column: 'slug' },
  { table: 'posts', column: 'category_id' },
  { table: 'posts', column: 'excerpt' },
  { table: 'posts', column: 'featured_image' },
  { table: 'sessions', column: 'ip_address' },
  { table: 'sessions', column: 'user_agent' },
  { table: 'settings', column: 'description' },
  { table: 'settings', column: 'type' },
];

for (const { table, column } of FABRICATED_COLS) {
  push({
    description: `DB-02: Column "${table}.${column}" does NOT exist (fabricated)`,
    edits: [],
    predicates: [{ type: 'db', table, column, assertion: 'column_exists' }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'column_existence', 'DB-02'],
  });
}

// Column on fabricated table
push({
  description: 'DB-02: Column "orders.total" — table "orders" does not exist',
  edits: [],
  predicates: [{ type: 'db', table: 'orders', column: 'total', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'column_existence', 'DB-02'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-03: Column Types — Verify column data types (correct + wrong)
// ═══════════════════════════════════════════════════════════════════════════════

// Correct type assertions
const CORRECT_TYPES = [
  { table: 'users', column: 'id', expected: 'SERIAL', desc: 'users.id is SERIAL' },
  { table: 'users', column: 'username', expected: 'VARCHAR(50)', desc: 'users.username is VARCHAR(50)' },
  { table: 'users', column: 'email', expected: 'VARCHAR(255)', desc: 'users.email is VARCHAR(255)' },
  { table: 'users', column: 'password_hash', expected: 'TEXT', desc: 'users.password_hash is TEXT' },
  { table: 'users', column: 'is_active', expected: 'BOOLEAN', desc: 'users.is_active is BOOLEAN' },
  { table: 'posts', column: 'title', expected: 'VARCHAR(200)', desc: 'posts.title is VARCHAR(200)' },
  { table: 'posts', column: 'body', expected: 'TEXT', desc: 'posts.body is TEXT' },
  { table: 'posts', column: 'view_count', expected: 'INTEGER', desc: 'posts.view_count is INTEGER' },
  { table: 'sessions', column: 'id', expected: 'UUID', desc: 'sessions.id is UUID' },
  { table: 'sessions', column: 'token', expected: 'TEXT', desc: 'sessions.token is TEXT' },
  { table: 'settings', column: 'value', expected: 'JSONB', desc: 'settings.value is JSONB' },
  { table: 'settings', column: 'key', expected: 'VARCHAR(100)', desc: 'settings.key is VARCHAR(100)' },
];

for (const tc of CORRECT_TYPES) {
  push({
    description: `DB-03: ${tc.desc} (correct)`,
    edits: [],
    predicates: [{ type: 'db', table: tc.table, column: tc.column, assertion: 'column_type', expected: tc.expected }],
    expectedSuccess: true,
    tags: ['db', 'column_type', 'DB-03'],
  });
}

// Wrong type assertions
const WRONG_TYPES = [
  { table: 'users', column: 'username', expected: 'INTEGER', desc: 'users.username is VARCHAR not INTEGER' },
  { table: 'users', column: 'is_active', expected: 'TEXT', desc: 'users.is_active is BOOLEAN not TEXT' },
  { table: 'users', column: 'email', expected: 'TEXT', desc: 'users.email is VARCHAR(255) not TEXT' },
  { table: 'posts', column: 'view_count', expected: 'BIGINT', desc: 'posts.view_count is INTEGER not BIGINT' },
  { table: 'posts', column: 'body', expected: 'VARCHAR(500)', desc: 'posts.body is TEXT not VARCHAR(500)' },
  { table: 'sessions', column: 'id', expected: 'SERIAL', desc: 'sessions.id is UUID not SERIAL' },
  { table: 'settings', column: 'value', expected: 'TEXT', desc: 'settings.value is JSONB not TEXT' },
  { table: 'settings', column: 'value', expected: 'JSON', desc: 'settings.value is JSONB not JSON' },
];

for (const tc of WRONG_TYPES) {
  push({
    description: `DB-03: ${tc.desc} (wrong type)`,
    edits: [],
    predicates: [{ type: 'db', table: tc.table, column: tc.column, assertion: 'column_type', expected: tc.expected }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'column_type', 'DB-03'],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DB-04: Constraints — NOT NULL, UNIQUE, DEFAULT, CHECK via content predicates
// ═══════════════════════════════════════════════════════════════════════════════

// NOT NULL constraints that exist
push({
  description: 'DB-04: users.username has NOT NULL constraint',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'username VARCHAR(50) NOT NULL' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: posts.title has NOT NULL constraint',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'title VARCHAR(200) NOT NULL' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: sessions.token has NOT NULL UNIQUE constraint',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'token TEXT NOT NULL UNIQUE' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: sessions.expires_at has NOT NULL constraint',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'expires_at TIMESTAMP NOT NULL' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

// DEFAULT constraints that exist
push({
  description: 'DB-04: users.is_active has DEFAULT true',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'is_active BOOLEAN DEFAULT true' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: posts.published has DEFAULT false',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'published BOOLEAN DEFAULT false' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: posts.view_count has DEFAULT 0',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'view_count INTEGER DEFAULT 0' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

// UNIQUE constraint
push({
  description: 'DB-04: users.username has UNIQUE constraint',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'username VARCHAR(50) NOT NULL UNIQUE' }],
  expectedSuccess: true,
  tags: ['db', 'constraints', 'DB-04'],
});

// Fabricated constraints that do NOT exist
push({
  description: 'DB-04: users.email does NOT have UNIQUE constraint (fabricated)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'email VARCHAR(255) NOT NULL UNIQUE' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: posts.body does NOT have NOT NULL (it is nullable)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'body TEXT NOT NULL' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'constraints', 'DB-04'],
});

push({
  description: 'DB-04: Fabricated CHECK constraint on users.email',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: "CHECK (email LIKE '%@%')" }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'constraints', 'DB-04'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-05: Foreign Keys — FK relationships
// ═══════════════════════════════════════════════════════════════════════════════

// Existing FK relationships
push({
  description: 'DB-05: posts.user_id REFERENCES users(id) — FK exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'user_id INTEGER NOT NULL REFERENCES users(id)' }],
  expectedSuccess: true,
  tags: ['db', 'foreign_keys', 'DB-05'],
});

push({
  description: 'DB-05: sessions.user_id REFERENCES users(id) — FK exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'REFERENCES users(id)' }],
  expectedSuccess: true,
  tags: ['db', 'foreign_keys', 'DB-05'],
});

// Fabricated FK relationships
push({
  description: 'DB-05: posts.category_id REFERENCES categories(id) — fabricated FK',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'REFERENCES categories(id)' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'foreign_keys', 'DB-05'],
});

push({
  description: 'DB-05: users.role_id REFERENCES roles(id) — fabricated FK',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'role_id INTEGER REFERENCES roles(id)' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'foreign_keys', 'DB-05'],
});

push({
  description: 'DB-05: settings.user_id REFERENCES users(id) — fabricated FK on settings',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: "settings" }, { type: 'content', file: 'init.sql', pattern: 'settings.*REFERENCES users' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'foreign_keys', 'DB-05'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-06: Indexes — PK indexes, unique indexes, custom indexes
// ═══════════════════════════════════════════════════════════════════════════════

// Existing indexes
push({
  description: 'DB-06: idx_sessions_token index exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_sessions_token ON sessions(token)' }],
  expectedSuccess: true,
  tags: ['db', 'indexes', 'DB-06'],
});

push({
  description: 'DB-06: idx_sessions_expires index exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at)' }],
  expectedSuccess: true,
  tags: ['db', 'indexes', 'DB-06'],
});

// Primary keys (via content check)
push({
  description: 'DB-06: users.id PRIMARY KEY exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'id SERIAL PRIMARY KEY' }],
  expectedSuccess: true,
  tags: ['db', 'indexes', 'DB-06'],
});

push({
  description: 'DB-06: settings.key PRIMARY KEY exists',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'key VARCHAR(100) PRIMARY KEY' }],
  expectedSuccess: true,
  tags: ['db', 'indexes', 'DB-06'],
});

// Fabricated indexes
push({
  description: 'DB-06: idx_users_email index does NOT exist (fabricated)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_users_email' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'indexes', 'DB-06'],
});

push({
  description: 'DB-06: idx_posts_user_id index does NOT exist (fabricated)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_posts_user_id' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'indexes', 'DB-06'],
});

push({
  description: 'DB-06: UNIQUE INDEX on posts.title does NOT exist (fabricated)',
  edits: [],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE UNIQUE INDEX' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['db', 'indexes', 'DB-06'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-07: Migration Patterns — Add column, add table, add FK, add index
// ═══════════════════════════════════════════════════════════════════════════════

// Add a new table via migration
push({
  description: 'DB-07: Migration adds "comments" table',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE comments (\n    id SERIAL PRIMARY KEY,\n    post_id INTEGER NOT NULL REFERENCES posts(id),\n    user_id INTEGER NOT NULL REFERENCES users(id),\n    body TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [{ type: 'db', table: 'comments', assertion: 'table_exists' }],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Add a column to existing table
push({
  description: 'DB-07: Migration adds "avatar_url" column to users',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: 'is_active BOOLEAN DEFAULT true,\n    avatar_url TEXT,',
  }],
  predicates: [{ type: 'db', table: 'users', column: 'avatar_url', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Add a column with specific type
push({
  description: 'DB-07: Migration adds "slug" VARCHAR(300) to posts',
  edits: [{
    file: 'init.sql',
    search: 'body TEXT,',
    replace: 'body TEXT,\n    slug VARCHAR(300) UNIQUE,',
  }],
  predicates: [
    { type: 'db', table: 'posts', column: 'slug', assertion: 'column_exists' },
    { type: 'db', table: 'posts', column: 'slug', assertion: 'column_type', expected: 'VARCHAR(300)' },
  ],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Add a foreign key column
push({
  description: 'DB-07: Migration adds "category_id" FK to posts',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE posts (',
    replace: 'CREATE TABLE categories (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(100) NOT NULL\n);\n\nCREATE TABLE posts (',
  }, {
    file: 'init.sql',
    search: 'published BOOLEAN DEFAULT false,',
    replace: 'published BOOLEAN DEFAULT false,\n    category_id INTEGER REFERENCES categories(id),',
  }],
  predicates: [
    { type: 'db', table: 'categories', assertion: 'table_exists' },
    { type: 'db', table: 'posts', column: 'category_id', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Add an index
push({
  description: 'DB-07: Migration adds index on posts.user_id',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE INDEX idx_posts_user_id ON posts(user_id);',
  }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_posts_user_id ON posts(user_id)' }],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Add NOT NULL column with DEFAULT
push({
  description: 'DB-07: Migration adds "role" column with DEFAULT to users',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: "is_active BOOLEAN DEFAULT true,\n    role VARCHAR(20) NOT NULL DEFAULT 'user',",
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'role', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: "role VARCHAR(20) NOT NULL DEFAULT 'user'" },
  ],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Migration adds table but predicate checks wrong table
push({
  description: 'DB-07: Migration adds "comments" but predicate checks "reviews" — fails grounding',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE comments (id SERIAL PRIMARY KEY, body TEXT);',
  }],
  predicates: [{ type: 'db', table: 'reviews', assertion: 'table_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// Change column type via migration
push({
  description: 'DB-07: Migration changes posts.view_count from INTEGER to BIGINT',
  edits: [{
    file: 'init.sql',
    search: 'view_count INTEGER DEFAULT 0,',
    replace: 'view_count BIGINT DEFAULT 0,',
  }],
  predicates: [{ type: 'db', table: 'posts', column: 'view_count', assertion: 'column_type', expected: 'BIGINT' }],
  expectedSuccess: true,
  tags: ['db', 'migration_patterns', 'DB-07'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-08: Schema Anti-Patterns — Common mistakes from real-world schemas
// ═══════════════════════════════════════════════════════════════════════════════

// VARCHAR without length — anti-pattern but valid PostgreSQL
push({
  description: 'DB-08: Anti-pattern — VARCHAR without length limit (wide open)',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: 'is_active BOOLEAN DEFAULT true,\n    nickname VARCHAR,',
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'nickname', assertion: 'column_exists' },
    { type: 'db', table: 'users', column: 'nickname', assertion: 'column_type', expected: 'VARCHAR' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// TEXT as primary key — anti-pattern
push({
  description: 'DB-08: Anti-pattern — TEXT column used as PRIMARY KEY',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE tags (\n    name TEXT PRIMARY KEY,\n    created_at TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'db', table: 'tags', assertion: 'table_exists' },
    { type: 'content', file: 'init.sql', pattern: 'name TEXT PRIMARY KEY' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// Missing timestamps — table with no created_at
push({
  description: 'DB-08: Anti-pattern — table without timestamp columns',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE lookups (\n    id SERIAL PRIMARY KEY,\n    code VARCHAR(10) NOT NULL,\n    label VARCHAR(100) NOT NULL\n);',
  }],
  predicates: [
    { type: 'db', table: 'lookups', assertion: 'table_exists' },
    { type: 'db', table: 'lookups', column: 'code', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// Wide table — too many columns (SchemaPile found tables with 50+ columns)
push({
  description: 'DB-08: Anti-pattern — wide table with many columns',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE user_profiles (\n    id SERIAL PRIMARY KEY,\n    user_id INTEGER REFERENCES users(id),\n    first_name VARCHAR(50),\n    last_name VARCHAR(50),\n    middle_name VARCHAR(50),\n    phone VARCHAR(20),\n    address_line1 TEXT,\n    address_line2 TEXT,\n    city VARCHAR(100),\n    state VARCHAR(50),\n    zip VARCHAR(10),\n    country VARCHAR(50),\n    bio TEXT,\n    website VARCHAR(500),\n    twitter VARCHAR(100),\n    linkedin VARCHAR(200)\n);',
  }],
  predicates: [
    { type: 'db', table: 'user_profiles', assertion: 'table_exists' },
    { type: 'db', table: 'user_profiles', column: 'first_name', assertion: 'column_exists' },
    { type: 'db', table: 'user_profiles', column: 'linkedin', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// Missing FK constraint — referencing by name convention but no actual REFERENCES
push({
  description: 'DB-08: Anti-pattern — column named author_id but no FK constraint',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE articles (\n    id SERIAL PRIMARY KEY,\n    author_id INTEGER NOT NULL,\n    title TEXT NOT NULL\n);',
  }],
  predicates: [
    { type: 'db', table: 'articles', column: 'author_id', assertion: 'column_exists' },
    { type: 'db', table: 'articles', column: 'author_id', assertion: 'column_type', expected: 'INTEGER' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// No primary key — anti-pattern
push({
  description: 'DB-08: Anti-pattern — table without primary key',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE event_log (\n    event_type VARCHAR(50) NOT NULL,\n    payload JSONB,\n    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'db', table: 'event_log', assertion: 'table_exists' },
    { type: 'db', table: 'event_log', column: 'event_type', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'anti_patterns', 'DB-08'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-09: Data Types — PostgreSQL-specific types
// ═══════════════════════════════════════════════════════════════════════════════

// UUID type already exists on sessions.id
push({
  description: 'DB-09: UUID type on sessions.id',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', column: 'id', assertion: 'column_type', expected: 'UUID' }],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// JSONB type already exists on settings.value
push({
  description: 'DB-09: JSONB type on settings.value',
  edits: [],
  predicates: [{ type: 'db', table: 'settings', column: 'value', assertion: 'column_type', expected: 'JSONB' }],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// TIMESTAMPTZ vs TIMESTAMP
push({
  description: 'DB-09: TIMESTAMPTZ migration — add timezone-aware timestamp',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: 'is_active BOOLEAN DEFAULT true,\n    last_login_at TIMESTAMPTZ,',
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'last_login_at', assertion: 'column_exists' },
    { type: 'db', table: 'users', column: 'last_login_at', assertion: 'column_type', expected: 'TIMESTAMPTZ' },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// NUMERIC/DECIMAL type
push({
  description: 'DB-09: NUMERIC(10,2) type for monetary values',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE products (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(200) NOT NULL,\n    price NUMERIC(10,2) NOT NULL\n);',
  }],
  predicates: [
    { type: 'db', table: 'products', column: 'price', assertion: 'column_exists' },
    { type: 'db', table: 'products', column: 'price', assertion: 'column_type', expected: 'NUMERIC(10,2)' },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// BIGSERIAL vs SERIAL
push({
  description: 'DB-09: BIGSERIAL for large sequence IDs',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE events (\n    id BIGSERIAL PRIMARY KEY,\n    name VARCHAR(100) NOT NULL\n);',
  }],
  predicates: [
    { type: 'db', table: 'events', column: 'id', assertion: 'column_type', expected: 'BIGSERIAL' },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// ARRAY type
push({
  description: 'DB-09: TEXT[] array type for tags',
  edits: [{
    file: 'init.sql',
    search: 'published BOOLEAN DEFAULT false,',
    replace: "published BOOLEAN DEFAULT false,\n    tags TEXT[] DEFAULT '{}',",
  }],
  predicates: [
    { type: 'db', table: 'posts', column: 'tags', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: "tags TEXT[]" },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// INET type for IP addresses
push({
  description: 'DB-09: INET type for IP address storage',
  edits: [{
    file: 'init.sql',
    search: 'expires_at TIMESTAMP NOT NULL,',
    replace: 'expires_at TIMESTAMP NOT NULL,\n    ip_address INET,',
  }],
  predicates: [
    { type: 'db', table: 'sessions', column: 'ip_address', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'ip_address INET' },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// CIDR type for network ranges
push({
  description: 'DB-09: CIDR type for network range storage',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE ip_allowlist (\n    id SERIAL PRIMARY KEY,\n    network CIDR NOT NULL,\n    label VARCHAR(100)\n);',
  }],
  predicates: [
    { type: 'db', table: 'ip_allowlist', column: 'network', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'network CIDR NOT NULL' },
  ],
  expectedSuccess: true,
  tags: ['db', 'data_types', 'DB-09'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-10: Multi-Table Patterns — Junction tables, soft deletes, audit trails
// ═══════════════════════════════════════════════════════════════════════════════

// Junction / many-to-many table
push({
  description: 'DB-10: Junction table "post_tags" for many-to-many',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE tags (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(50) NOT NULL UNIQUE\n);\n\nCREATE TABLE post_tags (\n    post_id INTEGER NOT NULL REFERENCES posts(id),\n    tag_id INTEGER NOT NULL REFERENCES tags(id),\n    PRIMARY KEY (post_id, tag_id)\n);',
  }],
  predicates: [
    { type: 'db', table: 'tags', assertion: 'table_exists' },
    { type: 'db', table: 'post_tags', assertion: 'table_exists' },
    { type: 'db', table: 'post_tags', column: 'post_id', assertion: 'column_exists' },
    { type: 'db', table: 'post_tags', column: 'tag_id', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// Soft deletes pattern (deleted_at column)
push({
  description: 'DB-10: Soft delete — "deleted_at" column on users',
  edits: [{
    file: 'init.sql',
    search: 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
    replace: 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n    deleted_at TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'deleted_at', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'deleted_at TIMESTAMP' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// Audit trail pattern (created_by, updated_at)
push({
  description: 'DB-10: Audit trail — "updated_at" and "created_by" columns',
  edits: [{
    file: 'init.sql',
    search: 'published BOOLEAN DEFAULT false,',
    replace: 'published BOOLEAN DEFAULT false,\n    created_by INTEGER REFERENCES users(id),\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,',
  }],
  predicates: [
    { type: 'db', table: 'posts', column: 'created_by', assertion: 'column_exists' },
    { type: 'db', table: 'posts', column: 'updated_at', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// Tenant isolation pattern (tenant_id)
push({
  description: 'DB-10: Tenant isolation — "tenant_id" column on all tables',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE tenants (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(100) NOT NULL,\n    slug VARCHAR(50) NOT NULL UNIQUE\n);',
  }, {
    file: 'init.sql',
    search: 'username VARCHAR(50) NOT NULL UNIQUE,',
    replace: 'username VARCHAR(50) NOT NULL UNIQUE,\n    tenant_id INTEGER REFERENCES tenants(id),',
  }],
  predicates: [
    { type: 'db', table: 'tenants', assertion: 'table_exists' },
    { type: 'db', table: 'users', column: 'tenant_id', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// Polymorphic association pattern
push({
  description: 'DB-10: Polymorphic comments — commentable_type + commentable_id',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE comments (\n    id SERIAL PRIMARY KEY,\n    commentable_type VARCHAR(50) NOT NULL,\n    commentable_id INTEGER NOT NULL,\n    user_id INTEGER NOT NULL REFERENCES users(id),\n    body TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'db', table: 'comments', assertion: 'table_exists' },
    { type: 'db', table: 'comments', column: 'commentable_type', assertion: 'column_exists' },
    { type: 'db', table: 'comments', column: 'commentable_id', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// Self-referencing FK (hierarchical data)
push({
  description: 'DB-10: Self-referencing FK — categories with parent_id',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE categories (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(100) NOT NULL,\n    parent_id INTEGER REFERENCES categories(id),\n    depth INTEGER DEFAULT 0\n);',
  }],
  predicates: [
    { type: 'db', table: 'categories', column: 'parent_id', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'parent_id INTEGER REFERENCES categories(id)' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_table', 'DB-10'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-11: Naming Conventions — snake_case, singular/plural, suffixes
// ═══════════════════════════════════════════════════════════════════════════════

// Verify snake_case naming in existing schema
push({
  description: 'DB-11: Column "password_hash" follows snake_case convention',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'password_hash', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: Column "is_active" follows boolean naming convention (is_ prefix)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'is_active', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: Column "user_id" follows _id FK suffix convention',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'user_id', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: Column "created_at" follows _at timestamp suffix convention',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'created_at', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: Column "expires_at" follows _at timestamp suffix convention',
  edits: [],
  predicates: [{ type: 'db', table: 'sessions', column: 'expires_at', assertion: 'column_exists' }],
  expectedSuccess: true,
  tags: ['db', 'naming', 'DB-11'],
});

// camelCase columns do NOT exist (convention violation)
push({
  description: 'DB-11: camelCase "passwordHash" does NOT exist (schema uses snake_case)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'passwordHash', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: camelCase "isActive" does NOT exist (schema uses snake_case)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'isActive', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: camelCase "userId" does NOT exist (schema uses snake_case)',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'userId', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: camelCase "createdAt" does NOT exist (schema uses snake_case)',
  edits: [],
  predicates: [{ type: 'db', table: 'users', column: 'createdAt', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

push({
  description: 'DB-11: camelCase "viewCount" does NOT exist (schema uses snake_case)',
  edits: [],
  predicates: [{ type: 'db', table: 'posts', column: 'viewCount', assertion: 'column_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

// Plural table names are the convention — singular should fail
push({
  description: 'DB-11: Singular "post" does NOT exist (schema uses plural "posts")',
  edits: [],
  predicates: [{ type: 'db', table: 'post', assertion: 'table_exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'naming', 'DB-11'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB-12: Schema Evolution — Safe migrations, backwards compatibility
// ═══════════════════════════════════════════════════════════════════════════════

// Adding NOT NULL column requires DEFAULT for existing rows
push({
  description: 'DB-12: Evolution — add NOT NULL column with DEFAULT (safe)',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: "is_active BOOLEAN DEFAULT true,\n    status VARCHAR(20) NOT NULL DEFAULT 'active',",
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'status', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: "status VARCHAR(20) NOT NULL DEFAULT 'active'" },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Adding nullable column (safe — no DEFAULT needed)
push({
  description: 'DB-12: Evolution — add nullable column (safe, no DEFAULT needed)',
  edits: [{
    file: 'init.sql',
    search: 'is_active BOOLEAN DEFAULT true,',
    replace: 'is_active BOOLEAN DEFAULT true,\n    bio TEXT,',
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'bio', assertion: 'column_exists' },
    { type: 'db', table: 'users', column: 'bio', assertion: 'column_type', expected: 'TEXT' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Splitting a table — extract profiles from users
push({
  description: 'DB-12: Evolution — split users table into users + profiles',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE profiles (\n    id SERIAL PRIMARY KEY,\n    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),\n    display_name VARCHAR(100),\n    bio TEXT,\n    avatar_url TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'db', table: 'profiles', assertion: 'table_exists' },
    { type: 'db', table: 'profiles', column: 'user_id', assertion: 'column_exists' },
    { type: 'db', table: 'profiles', column: 'display_name', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Adding enum-like status column
push({
  description: 'DB-12: Evolution — add status column replacing boolean published',
  edits: [{
    file: 'init.sql',
    search: 'published BOOLEAN DEFAULT false,',
    replace: "status VARCHAR(20) NOT NULL DEFAULT 'draft',",
  }],
  predicates: [
    { type: 'db', table: 'posts', column: 'status', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: "status VARCHAR(20) NOT NULL DEFAULT 'draft'" },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Adding composite unique constraint via init.sql
push({
  description: 'DB-12: Evolution — add unique constraint on (user_id, title) in posts',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE UNIQUE INDEX idx_posts_user_title ON posts(user_id, title);',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE UNIQUE INDEX idx_posts_user_title ON posts(user_id, title)' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Adding a view (schema evolution)
push({
  description: 'DB-12: Evolution — add a view for published posts',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: "CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE VIEW published_posts AS\n    SELECT id, title, body, created_at FROM posts WHERE published = true;",
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE VIEW published_posts' },
    { type: 'content', file: 'init.sql', pattern: 'WHERE published = true' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Widen column type (VARCHAR(50) → VARCHAR(100))
push({
  description: 'DB-12: Evolution — widen username column from VARCHAR(50) to VARCHAR(100)',
  edits: [{
    file: 'init.sql',
    search: 'username VARCHAR(50) NOT NULL UNIQUE,',
    replace: 'username VARCHAR(100) NOT NULL UNIQUE,',
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'username', assertion: 'column_type', expected: 'VARCHAR(100)' },
    { type: 'content', file: 'init.sql', pattern: 'username VARCHAR(100)' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// Adding partial index
push({
  description: 'DB-12: Evolution — add partial index on active users',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE INDEX idx_active_users ON users(username) WHERE is_active = true;',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_active_users ON users(username) WHERE is_active = true' },
  ],
  expectedSuccess: true,
  tags: ['db', 'evolution', 'DB-12'],
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/schemapile-db-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
const categoryCounts: Record<string, number> = {};
let passCount = 0;
let failCount = 0;

for (const s of scenarios) {
  if (s.expectedSuccess) passCount++;
  else failCount++;
  for (const tag of s.tags) {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  // Extract DB-XX category
  const cat = s.tags.find(t => t.startsWith('DB-'));
  if (cat) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
}

console.log(`Generated ${scenarios.length} SchemaPile DB scenarios → ${OUTPUT_PATH}\n`);
console.log(`  Expected pass: ${passCount}`);
console.log(`  Expected fail: ${failCount}\n`);
console.log('By category:');
for (const [cat, count] of Object.entries(categoryCounts).sort()) {
  const labels: Record<string, string> = {
    'DB-01': 'Table Existence',
    'DB-02': 'Column Existence',
    'DB-03': 'Column Types',
    'DB-04': 'Constraints',
    'DB-05': 'Foreign Keys',
    'DB-06': 'Indexes',
    'DB-07': 'Migration Patterns',
    'DB-08': 'Schema Anti-Patterns',
    'DB-09': 'Data Types',
    'DB-10': 'Multi-Table Patterns',
    'DB-11': 'Naming Conventions',
    'DB-12': 'Schema Evolution',
  };
  console.log(`  ${cat} ${(labels[cat] || '').padEnd(22)} ${count}`);
}
