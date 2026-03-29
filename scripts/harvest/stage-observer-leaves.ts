#!/usr/bin/env bun
/**
 * stage-observer-leaves.ts — Observer Effect Scenario Stager
 *
 * Covers observer effect failure shapes OE-02 through OE-05,
 * OE-07 through OE-11.
 * Tests whether the verification system detects when the act of
 * observing/monitoring/checking a system changes its behavior —
 * logging overhead, debug mode side effects, probe timing,
 * cache warming, env initialization, schema locks, pool depletion,
 * atime changes, and API versioning effects.
 *
 * For each shape: 1-2 failure scenarios (expectedSuccess: false),
 * 1 clean control (expectedSuccess: true).
 *
 * Run: bun scripts/harvest/stage-observer-leaves.ts
 * Output: fixtures/scenarios/observer-leaves-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/observer-leaves-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `oe-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// Anchor lines from demo-app files
const HEALTH_ANCHOR = "res.end(JSON.stringify({ status: 'ok' }));";
const ITEMS_ANCHOR = "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));";
const ECHO_ANCHOR = "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));";
const PORT_ANCHOR = 'const PORT = process.env.PORT || 3000;';
const ENV_DEBUG = 'DEBUG=false';
const ENV_SECRET = 'SECRET_KEY="not-very-secret"';
const DOCKER_HEALTHCHECK = 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O- http://localhost:3000/health || exit 1';
const COMPOSE_HEALTHCHECK = `healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]
      interval: 5s
      timeout: 3s
      retries: 3`;
const CONFIG_ANALYTICS = '"analytics": false';

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
function editDockerHealth(replace: string) {
  return [{ file: 'Dockerfile', search: DOCKER_HEALTHCHECK, replace }];
}
function editComposeHealth(replace: string) {
  return [{ file: 'docker-compose.yml', search: COMPOSE_HEALTHCHECK, replace }];
}

// =============================================================================
// OE-02: Log verbosity changes app performance (logging adds overhead)
// =============================================================================

push({
  description: 'OE-02: Synchronous file logging on every request — blocks event loop',
  edits: editHealth(
    `const fs = require('fs');\n    fs.writeFileSync('/tmp/health.log', new Date().toISOString() + ' health check\\n', { flag: 'a' });\n    res.end(JSON.stringify({ status: 'ok' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'writeFileSync.*health\\.log', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'log_overhead', 'OE-02'],
  rationale: 'Synchronous file write on every health check blocks the event loop — observation probe degrades app performance under load.',
});

push({
  description: 'OE-02: JSON.stringify of full request object for logging — CPU expensive',
  edits: editItems(
    `console.log(JSON.stringify({ url: req.url, headers: req.headers, time: Date.now(), stack: new Error().stack }));\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'new Error\\(\\)\\.stack', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'log_overhead', 'OE-02'],
  rationale: 'Generating stack trace and serializing full headers on every request — logging overhead changes performance characteristics of observed system.',
});

push({
  description: 'OE-02 control: Lightweight async logging — minimal observer effect',
  edits: editHealth(
    `process.stdout.write('H');\n    res.end(JSON.stringify({ status: 'ok' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "stdout\\.write\\('H'\\)", expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'log_overhead', 'OE-02', 'control'],
  rationale: 'Single character to stdout is non-blocking and negligible overhead — observation does not perturb the system.',
});

// =============================================================================
// OE-03: Debug mode alters behavior (debug flag changes execution path)
// =============================================================================

push({
  description: 'OE-03: DEBUG=true changes API response format — tests pass only in debug',
  edits: [
    { file: '.env', search: ENV_DEBUG, replace: 'DEBUG=true' },
    {
      file: 'server.js',
      search: ITEMS_ANCHOR,
      replace: `if (process.env.DEBUG === 'true') {\n      res.end(JSON.stringify({ items: [{ id: 1, name: 'Alpha' }], debug: true, _trace: 'debug-mode-only' }));\n    } else {\n      res.end(JSON.stringify([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]));\n    }`
    }
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DEBUG=true', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'debug-mode-only', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'debug_mode_side_effect', 'OE-03'],
  rationale: 'DEBUG=true changes response shape (array vs object wrapper) — tests written in debug mode silently fail in production.',
});

push({
  description: 'OE-03: Debug flag disables authentication middleware',
  edits: editHealth(
    `const skipAuth = process.env.DEBUG === 'true';\n    if (!skipAuth) { /* auth check would go here */ }\n    res.end(JSON.stringify({ status: 'ok', authSkipped: skipAuth }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'skipAuth.*DEBUG', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'debug_mode_side_effect', 'OE-03'],
  rationale: 'Debug mode disables auth — observation/testing with DEBUG=true exercises a fundamentally different code path than production.',
});

push({
  description: 'OE-03 control: Debug flag only affects logging level, not behavior',
  edits: editHealth(
    `if (process.env.DEBUG === 'true') console.log('health check');\n    res.end(JSON.stringify({ status: 'ok' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "DEBUG.*console\\.log", expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'debug_mode_side_effect', 'OE-03', 'control'],
  rationale: 'Debug flag only controls logging verbosity — functional behavior identical in debug and production.',
});

// =============================================================================
// OE-04: Monitoring probe affects timing (health check causes side effects)
// =============================================================================

push({
  description: 'OE-04: Health check writes to database — monitoring mutates state',
  edits: editHealth(
    `// Side-effecting health check\n    const query = "INSERT INTO settings (key, value) VALUES ('last_health', to_jsonb(now())) ON CONFLICT (key) DO UPDATE SET value = to_jsonb(now())";\n    res.end(JSON.stringify({ status: 'ok', _sideEffect: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'INSERT INTO settings.*last_health', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'probe_side_effect', 'OE-04'],
  rationale: 'Health check probe writes to settings table on every invocation — 5s interval means 17,280 writes/day, monitoring probe mutates the observed system.',
});

push({
  description: 'OE-04: Health check triggers garbage collection — timing probe changes latency',
  edits: editHealth(
    `if (global.gc) global.gc();\n    const used = process.memoryUsage().heapUsed;\n    res.end(JSON.stringify({ status: 'ok', heapMB: Math.round(used / 1e6) }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global\\.gc\\(\\)', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'probe_side_effect', 'OE-04'],
  rationale: 'Forcing GC in health check changes memory profile and introduces latency spikes — the probe itself distorts what it measures.',
});

push({
  description: 'OE-04 control: Health check is pure read — no side effects',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
    { type: 'content', file: 'server.js', pattern: "status: 'ok'", expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'probe_side_effect', 'OE-04', 'control'],
  rationale: 'Default health check returns static JSON — no database writes, no GC, pure observation.',
});

// =============================================================================
// OE-05: Cache warming during check changes cold-start behavior
// =============================================================================

push({
  description: 'OE-05: Health check pre-populates cache — hides cold-start latency',
  edits: editHealth(
    `const cache = global._appCache = global._appCache || {};\n    cache['items'] = [{ id: 1, name: 'Alpha' }];\n    cache['settings'] = { theme: 'light' };\n    res.end(JSON.stringify({ status: 'ok', cacheSize: Object.keys(cache).length }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global\\._appCache', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'cacheSize' } },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'cache_warming', 'OE-05'],
  rationale: 'Health check populates global cache — subsequent requests find warm cache, masking cold-start performance issues that real users hit.',
});

push({
  description: 'OE-05: Monitoring endpoint initializes lazy singleton',
  edits: editHealth(
    `if (!global._dbPool) {\n      global._dbPool = { connections: 5, initialized: Date.now() };\n    }\n    res.end(JSON.stringify({ status: 'ok', pool: global._dbPool }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global\\._dbPool', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'cache_warming', 'OE-05'],
  rationale: 'Health probe triggers lazy DB pool initialization — first real request never hits cold path, observation changes initialization order.',
});

push({
  description: 'OE-05 control: Health check does not touch shared state',
  edits: editHealth(
    `const uptime = process.uptime();\n    res.end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.floor(uptime) }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'process\\.uptime', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'uptimeSeconds' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'cache_warming', 'OE-05', 'control'],
  rationale: 'Health check reads process uptime only — no global state mutation, no cache warming.',
});

// =============================================================================
// OE-07: Environment variable check causes initialization
// =============================================================================

push({
  description: 'OE-07: Reading env var triggers module initialization as side effect',
  edits: editPort(
    `const PORT = process.env.PORT || 3000;\nconst _init = (() => { process.env._INIT_TS = String(Date.now()); return true; })();`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: '_INIT_TS.*Date\\.now', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'env_initialization', 'OE-07'],
  rationale: 'Module-level IIFE writes timestamp to process.env as side effect — importing/requiring this module for inspection mutates global state.',
});

push({
  description: 'OE-07: Checking DATABASE_URL creates connection pool',
  edits: editHealth(
    `if (process.env.DATABASE_URL) {\n      global._pool = global._pool || { url: process.env.DATABASE_URL, connections: [] };\n    }\n    res.end(JSON.stringify({ status: 'ok', hasPool: !!global._pool }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'DATABASE_URL.*global\\._pool', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'env_initialization', 'OE-07'],
  rationale: 'Checking whether DATABASE_URL exists also initializes a connection pool — observation triggers initialization.',
});

push({
  description: 'OE-07 control: Env var read without side effects',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'process\\.env\\.PORT', expected: 'exists' },
    { type: 'content', file: '.env', pattern: 'PORT=3000', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'env_initialization', 'OE-07', 'control'],
  rationale: 'Reading PORT env var with fallback — pure read, no initialization side effect.',
});

// =============================================================================
// OE-08: Schema introspection locks prevent writes
// =============================================================================

push({
  description: 'OE-08: Schema query uses ACCESS EXCLUSIVE lock — blocks all writes',
  edits: editHealth(
    `const query = "LOCK TABLE users IN ACCESS EXCLUSIVE MODE; SELECT count(*) FROM information_schema.columns WHERE table_name = 'users'";\n    res.end(JSON.stringify({ status: 'ok', _query: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ACCESS EXCLUSIVE', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'introspection_lock', 'OE-08'],
  rationale: 'Schema introspection acquires ACCESS EXCLUSIVE lock — all concurrent INSERTs/UPDATEs block until observation completes.',
});

push({
  description: 'OE-08: ANALYZE inside health check updates table statistics',
  edits: editHealth(
    `const query = "ANALYZE users; SELECT reltuples FROM pg_class WHERE relname = 'users'";\n    res.end(JSON.stringify({ status: 'ok', _query: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ANALYZE users', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'introspection_lock', 'OE-08'],
  rationale: 'ANALYZE in health probe updates table statistics — observation changes query planner decisions for subsequent queries.',
});

push({
  description: 'OE-08 control: Schema introspection uses information_schema (no locks)',
  edits: editHealth(
    `const query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'";\n    res.end(JSON.stringify({ status: 'ok', _query: query }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'information_schema\\.columns', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'introspection_lock', 'OE-08', 'control'],
  rationale: 'information_schema queries use only ACCESS SHARE lock (compatible with all writes) — safe observation.',
});

// =============================================================================
// OE-09: Connection pool depleted by monitoring
// =============================================================================

push({
  description: 'OE-09: Health check acquires pool connection and holds it — pool exhaustion',
  edits: editHealth(
    `const pool = global._monitorPool = global._monitorPool || { size: 5, acquired: 0 };\n    pool.acquired++;\n    // BUG: never released\n    res.end(JSON.stringify({ status: 'ok', poolAcquired: pool.acquired, poolSize: pool.size }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'pool\\.acquired\\+\\+', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'never released', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'pool_exhaustion', 'OE-09'],
  rationale: 'Health check leaks a connection on every invocation — at 5s intervals, 5-connection pool exhausted in 25s. Monitoring kills the app.',
});

push({
  description: 'OE-09: Each monitoring query opens new connection (no pooling)',
  edits: editHealth(
    `// Opens a new connection each time — O(N) for N health checks\n    const conn = { id: Math.random(), opened: Date.now(), _note: 'not-pooled' };\n    res.end(JSON.stringify({ status: 'ok', connection: conn }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'not-pooled', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'pool_exhaustion', 'OE-09'],
  rationale: 'New connection per health check with no close — monitoring probe accumulates connections until OS limit hit.',
});

push({
  description: 'OE-09 control: Health check uses shared read-only connection',
  edits: editHealth(
    `const readConn = global._readConn = global._readConn || { id: 1, type: 'read-only' };\n    res.end(JSON.stringify({ status: 'ok', conn: readConn.type }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'read-only', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'read-only' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'pool_exhaustion', 'OE-09', 'control'],
  rationale: 'Single shared read-only connection reused for all health checks — no pool depletion.',
});

// =============================================================================
// OE-10: Filesystem stat changes atime (access time changed by check)
// =============================================================================

push({
  description: 'OE-10: File existence check updates atime — backup tools see "modified"',
  edits: editHealth(
    `const fs = require('fs');\n    const stat = fs.statSync('server.js');\n    const atime = stat.atime.toISOString();\n    res.end(JSON.stringify({ status: 'ok', lastAccessed: atime, _note: 'atime-mutated-by-stat' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'statSync.*server\\.js', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'atime-mutated-by-stat', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'atime_mutation', 'OE-10'],
  rationale: 'statSync on noatime-disabled FS updates atime — incremental backup tools detect "changes" caused purely by monitoring, triggering unnecessary backup cycles.',
});

push({
  description: 'OE-10: Reading config file for health check changes its mtime-based cache invalidation',
  edits: editHealth(
    `const fs = require('fs');\n    const config = fs.readFileSync('config.json', 'utf-8');\n    const parsed = JSON.parse(config);\n    res.end(JSON.stringify({ status: 'ok', appName: parsed.app.name, _note: 'read-changes-atime' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'readFileSync.*config\\.json', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'read-changes-atime', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'atime_mutation', 'OE-10'],
  rationale: 'Reading config.json updates atime — if cache invalidation uses atime, health checks continuously invalidate config cache.',
});

push({
  description: 'OE-10 control: Health check uses in-memory state only',
  edits: editHealth(
    `const started = global._startTime = global._startTime || Date.now();\n    res.end(JSON.stringify({ status: 'ok', startedAt: started }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'global\\._startTime', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'startedAt' } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'atime_mutation', 'OE-10', 'control'],
  rationale: 'Health check reads only in-memory timestamp — no filesystem access, no atime mutation.',
});

// =============================================================================
// OE-11: API versioning header changes response
// =============================================================================

push({
  description: 'OE-11: Accept header changes response format — monitoring tool gets different data',
  edits: editItems(
    `const accept = req.headers['accept'] || 'application/json';\n    if (accept.includes('text/html')) {\n      res.writeHead(200, { 'Content-Type': 'text/html' });\n      res.end('<html><body>Items: Alpha, Beta</body></html>');\n    } else {\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]));\n    }`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "accept\\.includes\\('text/html'\\)", expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'versioning_header', 'OE-11'],
  rationale: 'Content negotiation means browser monitoring tool (Accept: text/html) sees different response than API consumer (Accept: application/json) — observer tool changes what it observes.',
});

push({
  description: 'OE-11: X-API-Version header selects different business logic',
  edits: editItems(
    `const version = req.headers['x-api-version'] || 'v1';\n    if (version === 'v2') {\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ data: [{ id: 1, name: 'Alpha' }], version: 'v2', pagination: { total: 1 } }));\n    } else {\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]));\n    }`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'x-api-version', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: false,
  tags: ['observer_effect', 'versioning_header', 'OE-11'],
  rationale: 'Monitoring tool without X-API-Version header hits v1, while frontend sends v2 — probe validates different business logic than users experience.',
});

push({
  description: 'OE-11 control: API returns same structure regardless of headers',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: ['Alpha', 'Beta'] } },
  ],
  expectedSuccess: true,
  tags: ['observer_effect', 'versioning_header', 'OE-11', 'control'],
  rationale: 'Unmodified items endpoint returns consistent JSON regardless of request headers — no observer effect.',
});

// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} observer effect scenarios to ${outPath}`);

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
