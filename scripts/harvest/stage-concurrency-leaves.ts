#!/usr/bin/env bun
/**
 * stage-concurrency-leaves.ts — Concurrency Failure Scenario Stager
 *
 * Covers concurrency failure shapes CO-02 through CO-08, CO-10, CO-11.
 * Tests whether the verification system detects when concurrent access
 * to shared state produces incorrect behavior — write conflicts, races,
 * deadlocks, lost updates, double-submits, concurrent migrations,
 * session corruption, and event ordering violations.
 *
 * For each shape: 1-2 failure scenarios (expectedSuccess: false),
 * 1 clean control (expectedSuccess: true).
 *
 * Run: bun scripts/harvest/stage-concurrency-leaves.ts
 * Output: fixtures/scenarios/concurrency-leaves-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/concurrency-leaves-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `co-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// Anchor lines from demo-app files
const HEALTH_ANCHOR = "res.end(JSON.stringify({ status: 'ok' }));";
const ITEMS_ANCHOR = "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));";
const ECHO_ANCHOR = "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));";
const PORT_ANCHOR = 'const PORT = process.env.PORT || 3000;';
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
const SETTINGS_TABLE = `CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

function editHealth(replace: string) {
  return [{ file: 'server.js', search: HEALTH_ANCHOR, replace }];
}
function editItems(replace: string) {
  return [{ file: 'server.js', search: ITEMS_ANCHOR, replace }];
}
function editEcho(replace: string) {
  return [{ file: 'server.js', search: ECHO_ANCHOR, replace }];
}
function editPort(replace: string) {
  return [{ file: 'server.js', search: PORT_ANCHOR, replace }];
}
function editPosts(replace: string) {
  return [{ file: 'init.sql', search: POSTS_TABLE, replace }];
}
function editSessions(replace: string) {
  return [{ file: 'init.sql', search: SESSION_TABLE, replace }];
}
function editSettings(replace: string) {
  return [{ file: 'init.sql', search: SETTINGS_TABLE, replace }];
}

// =============================================================================
// CO-02: Write-write conflict on same file
// =============================================================================

push({
  description: 'CO-02: Two concurrent writes to same config file — last write wins, first lost',
  edits: editHealth(
    `const fs = require('fs');\n    const config = JSON.parse(fs.readFileSync('config.json'));\n    config.lastWriter = 'writer-' + Math.random();\n    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));\n    res.end(JSON.stringify({ status: 'ok', writer: config.lastWriter }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'readFileSync.*config\\.json', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'writeFileSync.*config\\.json', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'write_write_conflict', 'CO-02'],
  rationale: 'Read-modify-write on config.json without file lock — concurrent health checks overwrite each other changes (TOCTOU race).',
});

push({
  description: 'CO-02: Concurrent append to log file loses entries',
  edits: editEcho(
    `const fs = require('fs');\n    const log = fs.readFileSync('/tmp/echo.log', 'utf-8').split('\\n').length;\n    fs.writeFileSync('/tmp/echo.log', fs.readFileSync('/tmp/echo.log', 'utf-8') + body + '\\n');\n    res.end(JSON.stringify({ echo: body, logLine: log }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'readFileSync.*/tmp/echo\\.log', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'write_write_conflict', 'CO-02'],
  rationale: 'Read-then-write to log file — two concurrent POSTs read same content, both append, one overwrites the other.',
});

push({
  description: 'CO-02 control: Atomic write via rename pattern',
  edits: editHealth(
    `const fs = require('fs');\n    const tmpPath = 'config.json.tmp.' + process.pid;\n    fs.writeFileSync(tmpPath, JSON.stringify({ ts: Date.now() }));\n    fs.renameSync(tmpPath, 'config.json');\n    res.end(JSON.stringify({ status: 'ok' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'renameSync', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'write_write_conflict', 'CO-02', 'control'],
  rationale: 'Atomic write via tmp+rename — concurrent writers produce complete files, no partial writes.',
});

// =============================================================================
// CO-03: Read-write race (read stale during write)
// =============================================================================

push({
  description: 'CO-03: Global counter read without synchronization — stale reads',
  edits: editPort(
    `const PORT = process.env.PORT || 3000;\nlet requestCount = 0;`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'let requestCount = 0', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'read_write_race', 'CO-03'],
  rationale: 'Shared mutable counter without atomic increment — concurrent requests read stale value, counter under-counts.',
});

push({
  description: 'CO-03: Settings read during concurrent update returns partial state',
  edits: editHealth(
    `const cache = global._settings = global._settings || { theme: 'light', lang: 'en' };\n    // Read all fields (may catch mid-update state)\n    res.end(JSON.stringify({ status: 'ok', settings: { ...cache } }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global\\._settings', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'mid-update state', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'read_write_race', 'CO-03'],
  rationale: 'Spread operator copies object properties non-atomically — if another request mutates _settings during copy, result contains mix of old and new values.',
});

push({
  description: 'CO-03 control: Immutable snapshot for reads',
  edits: editHealth(
    `const snapshot = Object.freeze({ theme: 'light', lang: 'en', ts: Date.now() });\n    res.end(JSON.stringify({ status: 'ok', settings: snapshot }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Object\\.freeze', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'theme' } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'read_write_race', 'CO-03', 'control'],
  rationale: 'Frozen snapshot is immutable — concurrent writes create new snapshots, readers always get consistent state.',
});

// =============================================================================
// CO-04: Lock contention causing timeout
// =============================================================================

push({
  description: 'CO-04: Advisory lock held during entire request — blocks concurrent requests',
  edits: editItems(
    `// Acquires advisory lock for entire request duration\n    const lockQuery = "SELECT pg_advisory_lock(1)";\n    const unlockQuery = "SELECT pg_advisory_unlock(1)";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _lock: lockQuery },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'pg_advisory_lock\\(1\\)', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'lock_contention', 'CO-04'],
  rationale: 'Advisory lock(1) held for entire request — all concurrent /api/items requests queue behind one lock, timeout under load.',
});

push({
  description: 'CO-04: Mutex with no timeout — deadlock on slow operations',
  edits: editHealth(
    `let locked = false;\n    const acquire = () => { while(locked) { /* spin */ } locked = true; };\n    const release = () => { locked = false; };\n    acquire();\n    res.end(JSON.stringify({ status: 'ok' }));\n    release();`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'while\\(locked\\)', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'lock_contention', 'CO-04'],
  rationale: 'Spin lock in single-threaded Node.js blocks the event loop entirely — no other request can proceed, infinite hang.',
});

push({
  description: 'CO-04 control: Non-blocking advisory lock with timeout',
  edits: editItems(
    `const tryLock = "SELECT pg_try_advisory_lock(1)";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _tryLock: tryLock },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'pg_try_advisory_lock', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'lock_contention', 'CO-04', 'control'],
  rationale: 'pg_try_advisory_lock is non-blocking — returns false instead of waiting, no contention timeout.',
});

// =============================================================================
// CO-05: Deadlock between two resources
// =============================================================================

push({
  description: 'CO-05: Two endpoints lock resources in opposite order — classic deadlock',
  edits: editItems(
    `// Lock order: users then posts\n    const q1 = "BEGIN; LOCK TABLE users; LOCK TABLE posts; COMMIT;";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _lockOrder: 'users->posts' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'LOCK TABLE users.*LOCK TABLE posts', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'deadlock', 'CO-05'],
  rationale: 'If echo endpoint locks posts-then-users while items locks users-then-posts, concurrent requests deadlock — classic resource ordering violation.',
});

push({
  description: 'CO-05: Self-referencing foreign key creates insertion deadlock',
  edits: editPosts(
    `CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    parent_id INTEGER REFERENCES posts(id),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'db', table: 'posts', column: 'parent_id', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'REFERENCES posts\\(id\\)', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'deadlock', 'CO-05'],
  rationale: 'Self-referencing FK without deferred constraint — concurrent inserts of parent/child pairs can deadlock on FK validation.',
});

push({
  description: 'CO-05 control: Consistent lock ordering prevents deadlock',
  edits: editItems(
    `// Always lock in alphabetical order: posts -> users\n    const q1 = "BEGIN; LOCK TABLE posts IN SHARE MODE; LOCK TABLE users IN SHARE MODE; COMMIT;";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _lockOrder: 'alphabetical' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'LOCK TABLE posts.*LOCK TABLE users', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'SHARE MODE', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'deadlock', 'CO-05', 'control'],
  rationale: 'Consistent alphabetical lock ordering with SHARE MODE — no circular wait possible.',
});

// =============================================================================
// CO-06: Lost update (concurrent edits, last wins)
// =============================================================================

push({
  description: 'CO-06: View count increment via read-modify-write — lost under concurrency',
  edits: editItems(
    `// Lost update: read count, increment in app, write back\n    const query = "SELECT view_count FROM posts WHERE id=1";\n    const update = "UPDATE posts SET view_count = 5 WHERE id=1";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', views: 5, _queries: [query, update] },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'SELECT view_count.*UPDATE posts SET view_count', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'lost_update', 'CO-06'],
  rationale: 'App-side increment (SELECT then UPDATE with literal value) — two concurrent reads get same count, both write count+1, one increment lost.',
});

push({
  description: 'CO-06: Settings update without optimistic locking — silent overwrite',
  edits: editEcho(
    `const update = "UPDATE settings SET value = $1 WHERE key = 'theme'";\n    res.end(JSON.stringify({ echo: body, _update: update, _note: 'no-version-check' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'no-version-check', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: "UPDATE settings SET value.*WHERE key", expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'lost_update', 'CO-06'],
  rationale: 'UPDATE without WHERE updated_at = $old_timestamp — concurrent updates silently overwrite each other, last writer wins with no conflict detection.',
});

push({
  description: 'CO-06 control: Atomic increment via SQL',
  edits: editItems(
    `const update = "UPDATE posts SET view_count = view_count + 1 WHERE id=1 RETURNING view_count";\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', _update: update },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'view_count \\+ 1', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'RETURNING view_count', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'lost_update', 'CO-06', 'control'],
  rationale: 'SQL-level atomic increment — database handles concurrency, no lost updates regardless of concurrent request count.',
});

// =============================================================================
// CO-07: Double-submit creates duplicate records
// =============================================================================

push({
  description: 'CO-07: POST endpoint has no idempotency key — double-submit creates duplicates',
  edits: editEcho(
    `// No idempotency check — every POST creates a new record\n    const insert = "INSERT INTO posts (user_id, title, body) VALUES (1, 'New Post', '" + body + "')";\n    res.end(JSON.stringify({ echo: body, created: true, _insert: insert }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'No idempotency check', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'INSERT INTO posts', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'double_submit', 'CO-07'],
  rationale: 'No idempotency key on POST — network retry or user double-click creates duplicate posts with identical content.',
});

push({
  description: 'CO-07: Form submission without CSRF token — replay creates duplicates',
  edits: editEcho(
    `// No CSRF or idempotency protection\n    const order = { item: body, total: 99.99, _note: 'duplicate-vulnerable' };\n    res.end(JSON.stringify({ echo: body, order }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'duplicate-vulnerable', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'double_submit', 'CO-07'],
  rationale: 'No CSRF token and no idempotency key — replayed form submission charges customer twice.',
});

push({
  description: 'CO-07 control: Idempotency key prevents duplicate creation',
  edits: editEcho(
    `const idempotencyKey = req.headers['x-idempotency-key'];\n    if (!idempotencyKey) {\n      res.writeHead(400, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ error: 'x-idempotency-key required' }));\n      return;\n    }\n    res.end(JSON.stringify({ echo: body, idempotencyKey }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'x-idempotency-key', expected: 'exists' },
    { type: 'http', method: 'POST', path: '/api/echo', body: { test: true }, expect: { status: 400, bodyContains: 'idempotency-key required' } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'double_submit', 'CO-07', 'control'],
  rationale: 'Requires idempotency key header — duplicate submissions with same key return cached result instead of creating duplicate.',
});

// =============================================================================
// CO-08: Concurrent migration execution
// =============================================================================

push({
  description: 'CO-08: Migration without advisory lock — two instances run same migration',
  edits: editHealth(
    `const migration = "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT";\n    // No migration lock — concurrent daemons both execute\n    res.end(JSON.stringify({ status: 'ok', _migration: migration, _note: 'no-lock' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ALTER TABLE users ADD COLUMN', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'No migration lock', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'concurrent_migration', 'CO-08'],
  rationale: 'No advisory lock on migration — two daemon instances apply same DDL concurrently, risking partial schema state or constraint errors.',
});

push({
  description: 'CO-08: Migration creates index without CONCURRENTLY — locks table for writes',
  edits: editHealth(
    `const migration = "CREATE INDEX idx_posts_title ON posts(title)";\n    res.end(JSON.stringify({ status: 'ok', _migration: migration, _note: 'blocks-writes' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'CREATE INDEX idx_posts_title', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'blocks-writes', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'concurrent_migration', 'CO-08'],
  rationale: 'CREATE INDEX without CONCURRENTLY acquires SHARE lock — all INSERTs/UPDATEs to posts table block during index build.',
});

push({
  description: 'CO-08 control: Migration with advisory lock and CONCURRENTLY',
  edits: editHealth(
    `const lock = "SELECT pg_advisory_lock(42)";\n    const migrate = "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_title ON posts(title)";\n    const unlock = "SELECT pg_advisory_unlock(42)";\n    res.end(JSON.stringify({ status: 'ok', _migrate: [lock, migrate, unlock] }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'pg_advisory_lock\\(42\\)', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'CONCURRENTLY', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'concurrent_migration', 'CO-08', 'control'],
  rationale: 'Advisory lock prevents concurrent execution, CONCURRENTLY prevents write blocking — safe concurrent migration.',
});

// =============================================================================
// CO-10: Session state corrupted by concurrent requests
// =============================================================================

push({
  description: 'CO-10: In-memory session modified by concurrent requests — cart corruption',
  edits: editPort(
    `const PORT = process.env.PORT || 3000;\nconst sessions = {};`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'const sessions = \\{\\}', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'session_corruption', 'CO-10'],
  rationale: 'Shared mutable session map — concurrent requests for same user read/modify session cart object, producing inconsistent item lists.',
});

push({
  description: 'CO-10: Session token rotated during concurrent request — second request uses stale token',
  edits: editSessions(
    `CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL,
    prev_token TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  ),
  predicates: [
    { type: 'db', table: 'sessions', column: 'prev_token', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'prev_token', expected: 'exists' },
    { type: 'content', file: 'init.sql', pattern: 'UNIQUE', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'session_corruption', 'CO-10'],
  rationale: 'Removed UNIQUE on token — token rotation during concurrent request means two requests authenticate with different tokens for same session, one gets rejected.',
});

push({
  description: 'CO-10 control: Session accessed via atomic DB operations',
  edits: editHealth(
    `const query = "UPDATE sessions SET expires_at = NOW() + INTERVAL '1 hour' WHERE token = $1 AND expires_at > NOW() RETURNING *";\n    res.end(JSON.stringify({ status: 'ok', _query: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'UPDATE sessions SET expires_at.*RETURNING', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'session_corruption', 'CO-10', 'control'],
  rationale: 'Single atomic UPDATE with WHERE clause — concurrent requests extend same session without corruption.',
});

// =============================================================================
// CO-11: Event ordering not guaranteed
// =============================================================================

push({
  description: 'CO-11: Events stored without sequence number — ordering lost on concurrent inserts',
  edits: editSettings(
    `CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);\n\nCREATE TABLE events (\n    id SERIAL PRIMARY KEY,\n    type VARCHAR(50) NOT NULL,\n    payload JSONB,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`
  ),
  predicates: [
    { type: 'db', table: 'events', column: 'type', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE events', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'event_ordering', 'CO-11'],
  rationale: 'Events use SERIAL id and TIMESTAMP — concurrent inserts can produce id=5 at t=100ms and id=4 at t=101ms. Consumers sorting by id or timestamp get wrong order.',
});

push({
  description: 'CO-11: Webhook delivery order differs from event creation order',
  edits: editEcho(
    `// Fire-and-forget webhook — no ordering guarantee\n    const events = [\n      { seq: 1, type: 'created', ts: Date.now() },\n      { seq: 2, type: 'updated', ts: Date.now() },\n    ];\n    // Webhooks fired concurrently — may arrive out of order\n    res.end(JSON.stringify({ echo: body, events, _note: 'unordered-delivery' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'unordered-delivery', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'no ordering guarantee', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['concurrency', 'event_ordering', 'CO-11'],
  rationale: 'Concurrent webhook delivery reorders events — consumer processes "updated" before "created", applying update to non-existent entity.',
});

push({
  description: 'CO-11 control: Events with monotonic sequence and consumer-side ordering',
  edits: editEcho(
    `const events = [\n      { seq: 1, type: 'created', ts: Date.now() },\n      { seq: 2, type: 'updated', ts: Date.now() + 1 },\n    ];\n    events.sort((a, b) => a.seq - b.seq);\n    res.end(JSON.stringify({ echo: body, events, ordered: true }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'events\\.sort', expected: 'exists' },
    { type: 'http', method: 'POST', path: '/api/echo', body: {}, expect: { status: 200, bodyContains: 'ordered' } },
  ],
  expectedSuccess: true,
  tags: ['concurrency', 'event_ordering', 'CO-11', 'control'],
  rationale: 'Events carry monotonic sequence number, consumer sorts by seq before processing — correct ordering guaranteed.',
});

// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} concurrency failure scenarios to ${outPath}`);

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
