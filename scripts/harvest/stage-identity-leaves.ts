#!/usr/bin/env bun
/**
 * stage-identity-leaves.ts — Identity Failure Scenario Stager
 *
 * Covers identity confusion failure shapes ID-01, ID-03 through ID-05,
 * ID-07, ID-09 through ID-12.
 * Tests whether the verification system detects when the system confuses
 * one entity for another — session collisions, foreign key errors,
 * data leakage, cache collisions, ID type mismatches, and stale mappings.
 *
 * For each shape: 1-2 failure scenarios (expectedSuccess: false),
 * 1 clean control (expectedSuccess: true).
 *
 * Run: bun scripts/harvest/stage-identity-leaves.ts
 * Output: fixtures/scenarios/identity-leaves-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/identity-leaves-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `id-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// Anchor lines from demo-app files
const HEALTH_ANCHOR = "res.end(JSON.stringify({ status: 'ok' }));";
const ITEMS_ANCHOR = "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));";
const ECHO_ANCHOR = "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));";
const SESSION_TABLE = `CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const POSTS_TABLE = `CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const USERS_TABLE = `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const SETTINGS_TABLE = `CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const PORT_ANCHOR = 'const PORT = process.env.PORT || 3000;';
const ENV_SECRET = 'SECRET_KEY="not-very-secret"';
const CONFIG_DB = `"database": {
    "host": "localhost",
    "port": 5432,
    "name": "demo"
  }`;

function editItems(replace: string) {
  return [{ file: 'server.js', search: ITEMS_ANCHOR, replace }];
}
function editHealth(replace: string) {
  return [{ file: 'server.js', search: HEALTH_ANCHOR, replace }];
}
function editEcho(replace: string) {
  return [{ file: 'server.js', search: ECHO_ANCHOR, replace }];
}
function editSessions(replace: string) {
  return [{ file: 'init.sql', search: SESSION_TABLE, replace }];
}
function editPosts(replace: string) {
  return [{ file: 'init.sql', search: POSTS_TABLE, replace }];
}
function editUsers(replace: string) {
  return [{ file: 'init.sql', search: USERS_TABLE, replace }];
}
function editSettings(replace: string) {
  return [{ file: 'init.sql', search: SETTINGS_TABLE, replace }];
}

// =============================================================================
// ID-01: Session ID collision (two users share session)
// =============================================================================

push({
  description: 'ID-01: Session token generated from predictable counter — collision risk',
  edits: editHealth(
    `const sessionId = 'sess-' + Math.floor(Date.now() / 1000);\n    res.end(JSON.stringify({ status: 'ok', session: sessionId }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Math\\.floor\\(Date\\.now', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'sess-' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'session_collision', 'ID-01'],
  rationale: 'Second-precision timestamps allow two concurrent requests to generate the same session ID, causing session collision between users.',
});

push({
  description: 'ID-01: Session uses shared static token for all users',
  edits: editHealth(
    `const SESSION = 'global-session-token-123';\n    res.end(JSON.stringify({ status: 'ok', session: SESSION }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global-session-token', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'session_collision', 'ID-01'],
  rationale: 'Hardcoded static session token means all users share a single session — identity confusion guaranteed.',
});

push({
  description: 'ID-01 control: Session uses UUID — no collision risk',
  edits: editHealth(
    `const crypto = require('crypto');\n    const sessionId = crypto.randomUUID();\n    res.end(JSON.stringify({ status: 'ok', session: sessionId }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'randomUUID', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'session' } },
  ],
  expectedSuccess: true,
  tags: ['identity', 'session_collision', 'ID-01', 'control'],
  rationale: 'crypto.randomUUID() generates 128-bit random session IDs — collision probability negligible.',
});

// =============================================================================
// ID-03: Foreign key references wrong table's ID
// =============================================================================

push({
  description: 'ID-03: Posts foreign key references sessions instead of users',
  edits: editPosts(
    `CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES sessions(id),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'db', table: 'posts', column: 'user_id', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'REFERENCES sessions', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'foreign_key_wrong_table', 'ID-03'],
  rationale: 'Posts.user_id references sessions(id) instead of users(id) — joins produce session UUIDs instead of user integer IDs, causing data association with wrong entities.',
});

push({
  description: 'ID-03: Posts foreign key references settings instead of users',
  edits: editPosts(
    `CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES settings(key),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'REFERENCES settings', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'foreign_key_wrong_table', 'ID-03'],
  rationale: 'Posts.user_id references settings(key) — type mismatch and wrong table entirely, posts associated with config keys instead of users.',
});

push({
  description: 'ID-03 control: Posts foreign key correctly references users',
  edits: [],
  predicates: [
    { type: 'db', table: 'posts', column: 'user_id', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'REFERENCES users\\(id\\)', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['identity', 'foreign_key_wrong_table', 'ID-03', 'control'],
  rationale: 'Unmodified schema — posts.user_id correctly references users(id).',
});

// =============================================================================
// ID-04: API response contains wrong user's data
// =============================================================================

push({
  description: 'ID-04: Items endpoint returns hardcoded user_id regardless of request',
  edits: editItems(
    `res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', user_id: 42 },\n      { id: 2, name: 'Beta', user_id: 42 },\n    ]));`
  ),
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'user_id' } },
    { type: 'content', file: 'server.js', pattern: 'user_id: 42', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'wrong_user_data', 'ID-04'],
  rationale: 'Hardcoded user_id: 42 on all items means every user sees the same owner ID — data associated with wrong identity.',
});

push({
  description: 'ID-04: Echo endpoint reflects another session token in response',
  edits: editEcho(
    `res.end(JSON.stringify({ echo: body, timestamp: Date.now(), session: 'other-user-token-abc' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'other-user-token', expected: 'exists' },
    { type: 'http', method: 'POST', path: '/api/echo', body: { test: true }, expect: { status: 200, bodyContains: 'other-user-token' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'wrong_user_data', 'ID-04'],
  rationale: 'Echo endpoint leaks another user session token in every response — identity data cross-contamination.',
});

push({
  description: 'ID-04 control: Items endpoint returns data without user identity leak',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: true,
  tags: ['identity', 'wrong_user_data', 'ID-04', 'control'],
  rationale: 'Unmodified items endpoint returns only item data without any user identity fields.',
});

// =============================================================================
// ID-05: Cache key collision (different entities, same key)
// =============================================================================

push({
  description: 'ID-05: Cache key uses only entity type without ID — all users share cache',
  edits: editHealth(
    `const cache = {};\n    const cacheKey = 'user-profile';\n    cache[cacheKey] = { name: 'Alice', role: 'admin' };\n    res.end(JSON.stringify({ status: 'ok', cached: cache[cacheKey] }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "cacheKey = 'user-profile'", expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'cache_key_collision', 'ID-05'],
  rationale: 'Cache key "user-profile" without user ID means all users read/write the same cache entry — first writer defines everyone else identity.',
});

push({
  description: 'ID-05: Cache key truncated — different entities map to same key',
  edits: editItems(
    `const cacheKey = 'items-' + JSON.stringify([1,2]).substring(0, 5);\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _cache: cacheKey },\n      { id: 2, name: 'Beta', _cache: cacheKey },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'substring\\(0, 5\\)', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'cache_key_collision', 'ID-05'],
  rationale: 'Truncating cache keys to 5 chars causes collisions — "[1,2]".substring(0,5) === "[1,2,".substring(0,5), different item sets share cache slot.',
});

push({
  description: 'ID-05 control: Cache key includes full entity ID',
  edits: editHealth(
    `const userId = 7;\n    const cacheKey = 'user-profile-' + userId;\n    res.end(JSON.stringify({ status: 'ok', cacheKey }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "user-profile-.*userId", expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'user-profile-7' } },
  ],
  expectedSuccess: true,
  tags: ['identity', 'cache_key_collision', 'ID-05', 'control'],
  rationale: 'Cache key includes user ID — each entity gets its own cache slot, no collision.',
});

// =============================================================================
// ID-07: UUID vs integer ID mismatch in joins
// =============================================================================

push({
  description: 'ID-07: Joining sessions.id (UUID) with posts.user_id (INTEGER)',
  edits: editItems(
    `// BUG: joining UUID session.id against integer posts.user_id\n    const query = "SELECT p.* FROM posts p JOIN sessions s ON p.user_id = s.id";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'p\\.user_id = s\\.id', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'id_type_mismatch', 'ID-07'],
  rationale: 'Sessions.id is UUID, posts.user_id is INTEGER — join always produces empty set or type error, silently returning wrong data.',
});

push({
  description: 'ID-07: Integer cast of UUID truncates to wrong ID',
  edits: editEcho(
    `const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';\n    const numericId = parseInt(sessionId, 10);\n    res.end(JSON.stringify({ echo: body, resolvedUser: numericId }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'parseInt\\(sessionId', expected: 'exists' },
    { type: 'http', method: 'POST', path: '/api/echo', body: {}, expect: { status: 200, bodyContains: 'resolvedUser' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'id_type_mismatch', 'ID-07'],
  rationale: 'parseInt on a UUID returns NaN or truncated prefix — user resolved to wrong identity or null.',
});

push({
  description: 'ID-07 control: Join uses matching integer types',
  edits: editItems(
    `const query = "SELECT p.* FROM posts p JOIN users u ON p.user_id = u.id";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'p\\.user_id = u\\.id', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['identity', 'id_type_mismatch', 'ID-07', 'control'],
  rationale: 'Both posts.user_id and users.id are INTEGER SERIAL — type-compatible join.',
});

// =============================================================================
// ID-09: Soft-deleted record ID reused
// =============================================================================

push({
  description: 'ID-09: Users table adds soft delete but ID reuse via INSERT overwrite',
  edits: editUsers(
    `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'db', table: 'users', column: 'deleted_at', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'UNIQUE', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'soft_delete_reuse', 'ID-09'],
  rationale: 'Removing UNIQUE constraint on username allows re-inserting a deleted username — old posts and sessions now appear to belong to the new user with the same name.',
});

push({
  description: 'ID-09: Soft-delete without filtering in queries leaks deleted user data',
  edits: editItems(
    `// Returns all users including soft-deleted ones\n    const query = "SELECT id, username FROM users";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query },\n      { id: 2, name: 'Beta (deleted)', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'SELECT id, username FROM users', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'deleted' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'soft_delete_reuse', 'ID-09'],
  rationale: 'Query omits WHERE deleted_at IS NULL — soft-deleted user data leaks into active query results.',
});

push({
  description: 'ID-09 control: Soft delete with UNIQUE constraint and filtered queries',
  edits: editUsers(
    `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'db', table: 'users', column: 'deleted_at', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'UNIQUE', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['identity', 'soft_delete_reuse', 'ID-09', 'control'],
  rationale: 'UNIQUE constraint preserved — soft-deleted usernames cannot be reused, preventing identity confusion.',
});

// =============================================================================
// ID-10: Multi-tenant data leakage via shared ID space
// =============================================================================

push({
  description: 'ID-10: Posts table lacks tenant_id — all tenants share ID space',
  edits: editItems(
    `// Multi-tenant but no tenant isolation\n    const query = "SELECT * FROM posts WHERE id = 1";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', tenant: 'any', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'SELECT \\* FROM posts WHERE id', expected: 'exists' },
    { type: 'content', file: 'init.sql', pattern: 'tenant_id', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'multi_tenant_leak', 'ID-10'],
  rationale: 'No tenant_id column — query by post ID returns data regardless of which tenant owns it, causing cross-tenant data leakage.',
});

push({
  description: 'ID-10: Settings table shared across tenants without namespace',
  edits: editHealth(
    `const query = "SELECT value FROM settings WHERE key = 'theme'";\n    res.end(JSON.stringify({ status: 'ok', _query: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "key = 'theme'", expected: 'exists' },
    { type: 'content', file: 'init.sql', pattern: 'tenant', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'multi_tenant_leak', 'ID-10'],
  rationale: 'Settings keyed only by name — all tenants read/write same "theme" setting, tenant A config leaks to tenant B.',
});

push({
  description: 'ID-10 control: Posts query scoped by tenant_id',
  edits: editItems(
    `const tenantId = 1;\n    const query = "SELECT * FROM posts WHERE tenant_id = " + tenantId;\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'tenant_id', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['identity', 'multi_tenant_leak', 'ID-10', 'control'],
  rationale: 'Query includes tenant_id filter — data correctly scoped to requesting tenant.',
});

// =============================================================================
// ID-11: Auto-increment gap assumed sequential
// =============================================================================

push({
  description: 'ID-11: Logic assumes next user ID is max(id)+1 — breaks on gaps',
  edits: editItems(
    `// Assumes sequential IDs — breaks after DELETE\n    const lastId = 2;\n    const nextId = lastId + 1;\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n      { id: nextId, name: 'Next (assumed)', _note: 'gap-unsafe' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'lastId \\+ 1', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'gap-unsafe' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'autoincrement_gap', 'ID-11'],
  rationale: 'Assuming max(id)+1 is the next ID skips gaps from deletes — could reference non-existent or wrong entity.',
});

push({
  description: 'ID-11: Pagination uses ID ranges instead of cursor — skips records in gaps',
  edits: editItems(
    `// Pagination by ID range — misses records if gaps exist\n    const page = 1;\n    const query = "SELECT * FROM users WHERE id BETWEEN " + ((page-1)*10+1) + " AND " + (page*10);\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query, _note: 'gap-vulnerable' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'id BETWEEN', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'autoincrement_gap', 'ID-11'],
  rationale: 'ID-range pagination assumes no gaps — after bulk deletes, pages contain fewer records than expected and some IDs are silently skipped.',
});

push({
  description: 'ID-11 control: Uses SERIAL sequence for next ID (gap-safe)',
  edits: editItems(
    `const query = "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _query: query },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'RETURNING id', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['identity', 'autoincrement_gap', 'ID-11', 'control'],
  rationale: 'Using RETURNING id from INSERT lets the database assign the next sequence value — gap-safe.',
});

// =============================================================================
// ID-12: External ID mapping becomes stale
// =============================================================================

push({
  description: 'ID-12: Hardcoded external ID mapping in config — goes stale',
  edits: [{
    file: 'config.json',
    search: `"analytics": false`,
    replace: `"analytics": false,\n    "externalIdMap": { "stripe_cust_1": 1, "stripe_cust_2": 2 }`
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'stripe_cust_1', expected: 'exists' },
    { type: 'content', file: 'config.json', pattern: 'externalIdMap', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['identity', 'stale_external_mapping', 'ID-12'],
  rationale: 'Hardcoded Stripe customer → internal ID mapping goes stale when users are deleted or re-created — payments route to wrong user.',
});

push({
  description: 'ID-12: Cached OAuth provider ID never refreshed',
  edits: editHealth(
    `const oauthCache = { 'google-uid-abc': 1 };\n    const userId = oauthCache['google-uid-abc'];\n    res.end(JSON.stringify({ status: 'ok', resolvedUser: userId, _note: 'stale-cache-never-refreshed' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'google-uid-abc', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'stale-cache' } },
  ],
  expectedSuccess: false,
  tags: ['identity', 'stale_external_mapping', 'ID-12'],
  rationale: 'OAuth provider UID cached in-memory without TTL or refresh — if user re-registers with same Google account, they inherit old user data.',
});

push({
  description: 'ID-12: External mapping stored with TTL and refresh check',
  edits: editHealth(
    `const mappings = { 'ext-123': { userId: 1, cachedAt: Date.now(), ttl: 3600000 } };\n    const m = mappings['ext-123'];\n    const fresh = m && (Date.now() - m.cachedAt < m.ttl);\n    res.end(JSON.stringify({ status: 'ok', fresh }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ttl: 3600000', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'Date\\.now\\(\\) - m\\.cachedAt', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['identity', 'stale_external_mapping', 'ID-12', 'control'],
  rationale: 'External ID mapping includes TTL and freshness check — stale mappings detected and refreshable.',
});

// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} identity failure scenarios to ${outPath}`);

// Print distribution
const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  for (const t of s.tags) {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
}
console.log('\nTag distribution:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag}: ${count}`);
}

const successCount = scenarios.filter((s: any) => s.expectedSuccess).length;
const failCount = scenarios.filter((s: any) => !s.expectedSuccess).length;
console.log(`\nExpected success: ${successCount}, Expected failure: ${failCount}`);
