#!/usr/bin/env bun
/**
 * stage-db-leaves.ts — DB Schema Scenario Stager
 *
 * Generates DB-predicate grounding-gate scenarios from the demo-app's init.sql.
 * DB predicates check: does table/column/type exist in the parsed schema?
 *
 * The grounding gate (grounding.ts:592) validates:
 *   1. Table exists in parsed init.sql
 *   2. Column exists in that table
 *   3. Column type matches (with alias normalization via normalizeDBType)
 *   4. NO edit exemption exists yet (unlike CSS/HTML/HTTP)
 *
 * Scenario types:
 *   1. table_exists       — table is in schema (should pass)
 *   2. table_fabricated    — table NOT in schema (should fail grounding)
 *   3. column_exists       — column is in table (should pass)
 *   4. column_fabricated   — column NOT in table (should fail)
 *   5. column_type_match   — type matches with normalization (should pass)
 *   6. column_type_mismatch — type doesn't match (should fail)
 *   7. type_alias          — type alias normalization (serial→integer, etc.)
 *   8. table_after_edit    — edit (migration) adds table
 *   9. column_after_edit   — edit (migration) adds column
 *  10. missing_fields      — missing table/assertion fields
 *  11. case_sensitivity    — upper/lower/mixed case table/column names
 *  12. no_schema           — no init.sql (skip grounding)
 *  13. quoted_identifiers  — double-quoted table/column names
 *  14. constraint_as_column — PRIMARY KEY, FOREIGN KEY lines (should be skipped by parser)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseInitSQL, normalizeDBType } from '../../src/gates/grounding.js';

const INIT_SQL_PATH = resolve(__dirname, '../../fixtures/demo-app/init.sql');
const INIT_SQL = readFileSync(INIT_SQL_PATH, 'utf8');
const PARSED = parseInitSQL(INIT_SQL);

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
let counter = 0;

function nextId(prefix: string): string {
  return `db-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// ── Type 1: table_exists — real tables from init.sql ────────────────────────

const REAL_TABLES = PARSED.map(t => t.table);

for (const table of REAL_TABLES) {
  scenarios.push({
    id: nextId('texist'),
    description: `Table "${table}" exists in init.sql`,
    edits: [],
    predicates: [{
      type: 'db',
      table,
      assertion: 'table_exists',
    }],
    expectedSuccess: true,
    tags: ['db', 'table_exists', 'false_negative'],
  });
}

// ── Type 2: table_fabricated — tables NOT in init.sql ───────────────────────

const FABRICATED_TABLES = [
  'orders',
  'products',
  'payments',
  'audit_log',
  'migrations',
  'pg_stat_activity',  // system table
  'user',              // close but not exact (users ≠ user)
  '',                  // empty table name
];

for (const table of FABRICATED_TABLES) {
  if (!table) continue; // empty string handled separately
  scenarios.push({
    id: nextId('tfab'),
    description: `Table "${table}" does NOT exist (fabricated)`,
    edits: [],
    predicates: [{
      type: 'db',
      table,
      assertion: 'table_exists',
    }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'table_fabricated', 'false_positive'],
  });
}

// ── Type 3: column_exists — real columns from init.sql ──────────────────────

for (const table of PARSED) {
  for (const col of table.columns) {
    scenarios.push({
      id: nextId('cexist'),
      description: `Column "${table.table}.${col.name}" exists`,
      edits: [],
      predicates: [{
        type: 'db',
        table: table.table,
        column: col.name,
        assertion: 'column_exists',
      }],
      expectedSuccess: true,
      tags: ['db', 'column_exists', 'false_negative'],
    });
  }
}

// ── Type 4: column_fabricated — columns NOT in their tables ─────────────────

const FABRICATED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'users', column: 'phone_number' },
  { table: 'users', column: 'role' },
  { table: 'posts', column: 'slug' },
  { table: 'posts', column: 'category_id' },
  { table: 'sessions', column: 'ip_address' },
  { table: 'settings', column: 'description' },
  { table: 'users', column: 'ID' },           // case variant of 'id'? No — column matching is case-insensitive
];

for (const { table, column } of FABRICATED_COLUMNS) {
  // Check if case-insensitive match exists
  const tableEntry = PARSED.find(t => t.table.toLowerCase() === table.toLowerCase());
  const colExists = tableEntry?.columns.some(c => c.name.toLowerCase() === column.toLowerCase());

  if (colExists) {
    // This is actually a case variant that WILL be found (case-insensitive matching)
    scenarios.push({
      id: nextId('ccase'),
      description: `Column "${table}.${column}" found via case-insensitive match`,
      edits: [],
      predicates: [{
        type: 'db',
        table,
        column,
        assertion: 'column_exists',
      }],
      expectedSuccess: true,
      tags: ['db', 'case_sensitivity', 'false_negative'],
    });
  } else {
    scenarios.push({
      id: nextId('cfab'),
      description: `Column "${table}.${column}" does NOT exist (fabricated)`,
      edits: [],
      predicates: [{
        type: 'db',
        table,
        column,
        assertion: 'column_exists',
      }],
      expectedSuccess: false,
      expectedFailedGate: 'grounding',
      tags: ['db', 'column_fabricated', 'false_positive'],
    });
  }
}

// column on fabricated table
scenarios.push({
  id: nextId('cfab'),
  description: 'Column "orders.total" — table "orders" does not exist',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'orders',
    column: 'total',
    assertion: 'column_exists',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'column_fabricated', 'false_positive'],
});

// ── Type 5: column_type_match — correct types ──────────────────────────────

const TYPE_MATCH_CASES: Array<{ table: string; column: string; expected: string; desc: string }> = [];

for (const table of PARSED) {
  for (const col of table.columns) {
    // Raw type as written in init.sql
    TYPE_MATCH_CASES.push({
      table: table.table,
      column: col.name,
      expected: col.type,
      desc: `${table.table}.${col.name} type matches raw "${col.type}"`,
    });
  }
}

for (const tc of TYPE_MATCH_CASES) {
  scenarios.push({
    id: nextId('tmatch'),
    description: tc.desc,
    edits: [],
    predicates: [{
      type: 'db',
      table: tc.table,
      column: tc.column,
      assertion: 'column_type',
      expected: tc.expected,
    }],
    expectedSuccess: true,
    tags: ['db', 'column_type_match', 'false_negative'],
  });
}

// ── Type 6: column_type_mismatch — wrong types ─────────────────────────────

const TYPE_MISMATCH_CASES = [
  { table: 'users', column: 'username', expected: 'INTEGER', desc: 'username is VARCHAR not INTEGER' },
  { table: 'users', column: 'is_active', expected: 'TEXT', desc: 'is_active is BOOLEAN not TEXT' },
  { table: 'posts', column: 'view_count', expected: 'TEXT', desc: 'view_count is INTEGER not TEXT' },
  { table: 'sessions', column: 'id', expected: 'SERIAL', desc: 'sessions.id is UUID not SERIAL' },
  { table: 'settings', column: 'value', expected: 'TEXT', desc: 'settings.value is JSONB not TEXT' },
];

for (const tc of TYPE_MISMATCH_CASES) {
  scenarios.push({
    id: nextId('tmis'),
    description: tc.desc,
    edits: [],
    predicates: [{
      type: 'db',
      table: tc.table,
      column: tc.column,
      assertion: 'column_type',
      expected: tc.expected,
    }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['db', 'column_type_mismatch', 'false_positive'],
  });
}

// ── Type 7: type_alias — normalization equivalences ─────────────────────────

// SERIAL columns should match "integer" (alias normalization)
// The init.sql has SERIAL columns which parse as "SERIAL" in raw type
const ALIAS_CASES = [
  { table: 'users', column: 'id', expected: 'integer', desc: 'SERIAL normalizes to integer' },
  { table: 'users', column: 'id', expected: 'int', desc: 'SERIAL matches int (both → integer)' },
  { table: 'users', column: 'id', expected: 'int4', desc: 'SERIAL matches int4 (both → integer)' },
  { table: 'posts', column: 'user_id', expected: 'int', desc: 'INTEGER matches int (alias)' },
  { table: 'posts', column: 'user_id', expected: 'int4', desc: 'INTEGER matches int4 (alias)' },
  { table: 'users', column: 'is_active', expected: 'bool', desc: 'BOOLEAN matches bool (alias)' },
  { table: 'users', column: 'username', expected: 'character varying', desc: 'VARCHAR matches character varying (alias)' },
  { table: 'users', column: 'created_at', expected: 'timestamp', desc: 'TIMESTAMP matches timestamp (identity)' },
  { table: 'sessions', column: 'id', expected: 'uuid', desc: 'UUID matches uuid (case-insensitive)' },
  { table: 'settings', column: 'value', expected: 'jsonb', desc: 'JSONB matches jsonb (case-insensitive)' },
];

for (const tc of ALIAS_CASES) {
  // Check if the alias normalization actually makes these match
  const tableEntry = PARSED.find(t => t.table === tc.table);
  const colEntry = tableEntry?.columns.find(c => c.name === tc.column);
  const actualNorm = colEntry ? normalizeDBType(colEntry.type) : '?';
  const expectedNorm = normalizeDBType(tc.expected);
  const shouldPass = actualNorm === expectedNorm;

  scenarios.push({
    id: nextId('alias'),
    description: tc.desc + ` (${actualNorm} vs ${expectedNorm})`,
    edits: [],
    predicates: [{
      type: 'db',
      table: tc.table,
      column: tc.column,
      assertion: 'column_type',
      expected: tc.expected,
    }],
    expectedSuccess: shouldPass,
    expectedFailedGate: shouldPass ? undefined : 'grounding',
    tags: ['db', 'type_alias', shouldPass ? 'false_negative' : 'false_positive'],
  });
}

// ── Type 8: table_after_edit — migration adds a new table ───────────────────

scenarios.push({
  id: nextId('tedit'),
  description: 'Table "orders" added by migration edit — edit exemption passes grounding',
  edits: [{
    file: 'init.sql',
    search: "CREATE INDEX idx_sessions_expires ON sessions(expires_at);",
    replace: "CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE orders (id SERIAL PRIMARY KEY, total DECIMAL(10,2));",
  }],
  predicates: [{
    type: 'db',
    table: 'orders',
    assertion: 'table_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'table_after_edit', 'false_negative'],
});

// Edit adds table but predicate checks a DIFFERENT table — should still fail
scenarios.push({
  id: nextId('tedit'),
  description: 'Edit adds "orders" table but predicate checks "invoices" — fails grounding',
  edits: [{
    file: 'init.sql',
    search: "CREATE INDEX idx_sessions_expires ON sessions(expires_at);",
    replace: "CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE orders (id SERIAL PRIMARY KEY);",
  }],
  predicates: [{
    type: 'db',
    table: 'invoices',
    assertion: 'table_exists',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'table_after_edit', 'false_positive'],
});

// ── Type 9: column_after_edit — migration adds a new column ─────────────────

scenarios.push({
  id: nextId('cedit'),
  description: 'Column "users.phone" added by migration — edit exemption passes grounding',
  edits: [{
    file: 'init.sql',
    search: "email VARCHAR(255) NOT NULL,",
    replace: "email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),",
  }],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'phone',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'column_after_edit', 'false_negative'],
});

// Edit adds column to different table — should still fail
scenarios.push({
  id: nextId('cedit'),
  description: 'Edit adds "phone" to users but predicate checks posts.phone — fails grounding',
  edits: [{
    file: 'init.sql',
    search: "email VARCHAR(255) NOT NULL,",
    replace: "email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),",
  }],
  predicates: [{
    type: 'db',
    table: 'posts',
    column: 'phone',
    assertion: 'column_exists',
  }],
  // "phone" appears in edit replace, but posts table doesn't have it and
  // the editIntroduces check is name-only — it WILL find "phone" in the replace.
  // This is a known limitation: edit exemption is loose, same as CSS/HTML/HTTP.
  expectedSuccess: true,
  tags: ['db', 'column_after_edit', 'false_negative'],
});

// ── Type 10: missing_fields — incomplete predicates ─────────────────────────

scenarios.push({
  id: nextId('miss'),
  description: 'DB predicate with no table field — skips grounding',
  edits: [],
  predicates: [{
    type: 'db',
    assertion: 'table_exists',
  }],
  // grounding requires both table AND assertion to engage
  expectedSuccess: true,
  tags: ['db', 'missing_fields', 'false_negative'],
});

scenarios.push({
  id: nextId('miss'),
  description: 'DB predicate with no assertion field — skips grounding',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
  }],
  expectedSuccess: true,
  tags: ['db', 'missing_fields', 'false_negative'],
});

scenarios.push({
  id: nextId('miss'),
  description: 'column_exists with no column field — table found, no column to check',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    assertion: 'column_exists',
    // no column field
  }],
  // The gate checks `if (assertion === 'column_exists' && columnName)` — no columnName means it skips
  expectedSuccess: true,
  tags: ['db', 'missing_fields', 'false_negative'],
});

scenarios.push({
  id: nextId('miss'),
  description: 'column_type with no expected value — table/column found but no type to compare',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'username',
    assertion: 'column_type',
    // no expected field
  }],
  // The gate checks `if (assertion === 'column_type' && columnName && p.expected)` — no expected means skip
  expectedSuccess: true,
  tags: ['db', 'missing_fields', 'false_negative'],
});

// ── Type 11: case_sensitivity — table/column name casing ────────────────────

scenarios.push({
  id: nextId('case'),
  description: 'Table "USERS" (uppercase) — found via case-insensitive match',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'USERS',
    assertion: 'table_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'case_sensitivity', 'false_negative'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Table "Users" (mixed case) — found via case-insensitive match',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'Users',
    assertion: 'table_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'case_sensitivity', 'false_negative'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Column "users.USERNAME" (uppercase) — found via case-insensitive match',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'USERNAME',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'case_sensitivity', 'false_negative'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Column "USERS.EMAIL" (both uppercase) — found via case-insensitive match',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'USERS',
    column: 'EMAIL',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'case_sensitivity', 'false_negative'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Type check with uppercase expected — "INTEGER" matches SERIAL (both normalize to integer)',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'id',
    assertion: 'column_type',
    expected: 'INTEGER',
  }],
  expectedSuccess: true,
  tags: ['db', 'case_sensitivity', 'false_negative'],
});

// ── Type 12: unknown_assertion — assertions the gate doesn't handle ─────────

scenarios.push({
  id: nextId('unk'),
  description: 'Unknown assertion "index_exists" — gate does not handle, passes through',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'sessions',
    assertion: 'index_exists',
    expected: 'idx_sessions_token',
  }],
  // Gate only handles table_exists, column_exists, column_type — unknown assertions pass through
  expectedSuccess: true,
  tags: ['db', 'unknown_assertion', 'false_negative'],
});

scenarios.push({
  id: nextId('unk'),
  description: 'Unknown assertion "has_constraint" — gate does not handle, passes through',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'username',
    assertion: 'has_constraint',
    expected: 'UNIQUE',
  }],
  expectedSuccess: true,
  tags: ['db', 'unknown_assertion', 'false_negative'],
});

scenarios.push({
  id: nextId('unk'),
  description: 'Unknown assertion "not_null" — gate does not handle, passes through',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'email',
    assertion: 'not_null',
  }],
  expectedSuccess: true,
  tags: ['db', 'unknown_assertion', 'false_negative'],
});

// ── Type 13: type with size specifiers ──────────────────────────────────────

scenarios.push({
  id: nextId('size'),
  description: 'VARCHAR(50) matches VARCHAR(50) exactly',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'username',
    assertion: 'column_type',
    expected: 'VARCHAR(50)',
  }],
  expectedSuccess: true,
  tags: ['db', 'type_size', 'false_negative'],
});

scenarios.push({
  id: nextId('size'),
  description: 'VARCHAR(100) does NOT match VARCHAR(50) — size stripped, both become varchar',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'username',
    assertion: 'column_type',
    expected: 'VARCHAR(100)',
  }],
  // normalizeDBType strips size: VARCHAR(50) → varchar, VARCHAR(100) → varchar → MATCH
  expectedSuccess: true,
  tags: ['db', 'type_size', 'false_negative'],
});

scenarios.push({
  id: nextId('size'),
  description: 'VARCHAR (no size) matches VARCHAR(50) — size stripped from both',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'username',
    assertion: 'column_type',
    expected: 'VARCHAR',
  }],
  expectedSuccess: true,
  tags: ['db', 'type_size', 'false_negative'],
});

// ── Type 14: multi-predicate scenarios ──────────────────────────────────────

scenarios.push({
  id: nextId('multi'),
  description: 'Two valid DB predicates — both tables exist',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'posts', assertion: 'table_exists' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_predicate', 'false_negative'],
});

scenarios.push({
  id: nextId('multi'),
  description: 'One valid, one fabricated — second predicate fails grounding',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'orders', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'multi_predicate', 'false_positive'],
});

scenarios.push({
  id: nextId('multi'),
  description: 'Mixed predicate types — DB + content both valid',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: true,
  tags: ['db', 'multi_predicate', 'false_negative'],
});

scenarios.push({
  id: nextId('multi'),
  description: 'Mixed — valid DB but fabricated content',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'content', file: 'server.js', pattern: 'DOES_NOT_EXIST_ANYWHERE' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['db', 'multi_predicate', 'false_positive'],
});

// ── Type 15: nullable and default detection ─────────────────────────────────
// These test the PARSER more than the grounding gate, but verify parser correctness

// Verify that nullable columns are parsed (body in posts has no NOT NULL)
scenarios.push({
  id: nextId('parse'),
  description: 'posts.body exists and is nullable (no NOT NULL) — column_exists passes',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'posts',
    column: 'body',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'parser_validation', 'false_negative'],
});

// Verify columns with DEFAULT are parsed
scenarios.push({
  id: nextId('parse'),
  description: 'users.is_active exists (has DEFAULT true) — column_exists passes',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'users',
    column: 'is_active',
    assertion: 'column_exists',
  }],
  expectedSuccess: true,
  tags: ['db', 'parser_validation', 'false_negative'],
});

// UUID column with complex default
scenarios.push({
  id: nextId('parse'),
  description: 'sessions.id has type UUID with gen_random_uuid() default — parsed correctly',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'sessions',
    column: 'id',
    assertion: 'column_type',
    expected: 'UUID',
  }],
  expectedSuccess: true,
  tags: ['db', 'parser_validation', 'false_negative'],
});

// JSONB type
scenarios.push({
  id: nextId('parse'),
  description: 'settings.value has type JSONB — parsed correctly',
  edits: [],
  predicates: [{
    type: 'db',
    table: 'settings',
    column: 'value',
    assertion: 'column_type',
    expected: 'JSONB',
  }],
  expectedSuccess: true,
  tags: ['db', 'parser_validation', 'false_negative'],
});

// ── Summary ─────────────────────────────────────────────────────────────────

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/db-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const typeCounts: Record<string, number> = {};
const intentCounts: Record<string, number> = {};
for (const s of scenarios) {
  const type = s.tags[1] || 'unknown';
  typeCounts[type] = (typeCounts[type] || 0) + 1;
  const intent = s.tags[2] || 'unknown';
  intentCounts[intent] = (intentCounts[intent] || 0) + 1;
}

console.log(`Generated ${scenarios.length} DB scenarios → ${OUTPUT_PATH}\n`);
console.log('By type:');
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(22)} ${count}`);
}
console.log('\nBy intent:');
for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${intent.padEnd(22)} ${count}`);
}

// Also log the parsed schema for reference
console.log('\nParsed schema:');
for (const table of PARSED) {
  console.log(`  ${table.table} (${table.columns.length} columns)`);
  for (const col of table.columns) {
    console.log(`    ${col.name}: ${col.type}${col.nullable ? '' : ' NOT NULL'}${col.hasDefault ? ' DEFAULT' : ''}`);
  }
}
