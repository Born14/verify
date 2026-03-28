#!/usr/bin/env bun
/**
 * Capacity × Database scenario generator
 * Grid cell: I×4
 * Shapes: ID-01 (connection pool exhausted), ID-02 (max connections mismatch), ID-03 (table bloat / missing indexes)
 *
 * These scenarios test whether verify detects database capacity exhaustion:
 * connection pool sizes that conflict across config sources, max_connections
 * limits lower than pool demands, and missing indexes on tables expected
 * to handle large datasets.
 *
 * Run: bun scripts/harvest/stage-capacity-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `id-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');

// =============================================================================
// Shape ID-01: Connection pool exhausted — pool size in config vs env vs code
// Config sources disagree on pool size. The effective pool is smaller than
// what the application expects, leading to connection exhaustion under load.
// =============================================================================

// ID-01a: config.json pool=5, .env pool=20 — predicate checks config.json value
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01: config.json maxConnections=5, .env DB_POOL_SIZE=20 — sources disagree',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 5' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_POOL_SIZE=20' },
  ],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '5' },
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=20' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01'],
  rationale: 'config.json says 5 connections, .env says 20 — which source wins determines capacity',
});

// ID-01b: config.json pool=3, server.js hardcodes pool=50
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01: config.json maxConnections=3, server.js hardcodes pool max to 50',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 3' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst DB_POOL = { max: 50, idleTimeoutMs: 30000 };" },
  ],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '3' },
    { type: 'content', file: 'server.js', pattern: 'max: 50' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01'],
  rationale: 'Config limits to 3 but code tries 50 — pool will exhaust at config-enforced limit',
});

// ID-01c: docker-compose.test has pool env, production compose doesn't
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01: docker-compose.test.yml has DB pool setting, production compose is missing it',
  edits: [{
    file: 'docker-compose.yml',
    search: '- PORT=3000',
    replace: '- PORT=3000\n      - DB_POOL_MIN=1\n      - DB_POOL_MAX=3',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'DB_POOL_MAX=3' },
    { type: 'content', file: 'docker-compose.test.yml', pattern: 'DB_POOL_MAX' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01'],
  rationale: 'Prod compose limits pool to 3 but test compose has no limit — test/prod capacity mismatch',
});

// ID-01d: .env has idle timeout that conflicts with pool size
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01: .env pool=2 with 60s idle timeout, server.js has rapid query pattern',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_POOL_SIZE=2\nDB_IDLE_TIMEOUT=60000' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// Queries fire on every request — pool of 2 will saturate\nconst QUERY_PER_REQUEST = true;" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=2' },
    { type: 'content', file: 'server.js', pattern: 'QUERY_PER_REQUEST' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01'],
  rationale: 'Pool of 2 with 60s idle timeout means connections held long — rapid queries will queue',
});

// ID-01e: config.prod.json has no pool config at all
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01: config.json has maxConnections=10, config.prod.json has no pool config',
  edits: [{
    file: 'config.json',
    search: '"name": "demo"',
    replace: '"name": "demo",\n    "maxConnections": 10,\n    "poolIdleTimeout": 30000',
  }],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '10' },
    { type: 'content', file: 'config.prod.json', pattern: 'maxConnections' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01'],
  rationale: 'Dev config has pool settings but prod config does not — prod will use framework defaults',
});

// ID-01f: Control — pool size consistent across config and env
scenarios.push({
  id: nextId('pool'),
  description: 'ID-01 control: Pool size=10 in both config.json and .env',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 10' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_POOL_SIZE=10' },
  ],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '10' },
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=10' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'pool_exhaustion', 'ID-01', 'control'],
  rationale: 'Pool size matches across config.json and .env — no capacity conflict',
});

// =============================================================================
// Shape ID-02: Max connections hit — pg max_connections vs app pool size
// PostgreSQL server-level max_connections is lower than what the app's
// connection pool demands. Cross-source: compose env vs config pool size.
// =============================================================================

// ID-02a: compose sets pg max_connections=20, config.json pool=25
scenarios.push({
  id: nextId('maxconn'),
  description: 'ID-02: Postgres max_connections=20 in compose, config.json pool=25 — exceeds server limit',
  edits: [
    { file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=3000\n  db:\n    image: postgres:16\n    command: postgres -c max_connections=20\n    environment:\n      POSTGRES_DB: demo' },
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 25' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'max_connections=20' },
    { type: 'config', key: 'database.maxConnections', expected: '25' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'max_connections', 'ID-02'],
  rationale: 'App pool (25) exceeds Postgres max_connections (20) — connections will be refused',
});

// ID-02b: .env has DB pool that exceeds test compose Postgres config
scenarios.push({
  id: nextId('maxconn'),
  description: 'ID-02: .env DB_POOL_SIZE=50, docker-compose.test has small Postgres — pool exceeds capacity',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\nDB_POOL_SIZE=50',
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=50' },
    { type: 'content', file: 'docker-compose.test.yml', pattern: 'postgres:16-alpine' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'max_connections', 'ID-02'],
  rationale: 'Pool size 50 on alpine Postgres (default 100 connections) — risky but not immediately failing',
});

// ID-02c: Multiple app replicas, each with pool, total exceeds max_connections
scenarios.push({
  id: nextId('maxconn'),
  description: 'ID-02: 4 replicas × pool=10 = 40 connections, Postgres max_connections=30',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    deploy:\n      replicas: 4\n    healthcheck:' },
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 10' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'replicas: 4' },
    { type: 'config', key: 'database.maxConnections', expected: '10' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'max_connections', 'ID-02'],
  rationale: '4 replicas × 10 connections = 40 total, typical Postgres default is 100 but with reserved connections it may fail',
});

// ID-02d: Control — pool size well within Postgres limits
scenarios.push({
  id: nextId('maxconn'),
  description: 'ID-02 control: config.json pool=5, single replica — well within any Postgres default',
  edits: [{
    file: 'config.json',
    search: '"name": "demo"',
    replace: '"name": "demo",\n    "maxConnections": 5',
  }],
  predicates: [{ type: 'config', key: 'database.maxConnections', expected: '5' }],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'max_connections', 'ID-02', 'control'],
  rationale: 'Pool of 5 on single replica — well within any Postgres default max_connections',
});

// =============================================================================
// Shape ID-03: Table bloat — no vacuum/analyze, large table operations
// Tables created without indexes for query patterns that need them,
// no maintenance config for tables expected to grow large.
// =============================================================================

// ID-03a: New table has no indexes, predicate expects fast query
scenarios.push({
  id: nextId('bloat'),
  description: 'ID-03: init.sql adds events table with no indexes, predicate checks for index on timestamp',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE events (\n    id SERIAL PRIMARY KEY,\n    event_type VARCHAR(50),\n    payload JSONB,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE events' },
    { type: 'content', file: 'init.sql', pattern: 'idx_events_created' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'table_bloat', 'ID-03'],
  rationale: 'Events table created without timestamp index — queries on created_at will table-scan',
});

// ID-03b: Posts table has no index on user_id despite FK
scenarios.push({
  id: nextId('bloat'),
  description: 'ID-03: posts table has user_id FK but no index, predicate checks for index',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'user_id INTEGER NOT NULL REFERENCES users(id)' },
    { type: 'content', file: 'init.sql', pattern: 'idx_posts_user_id' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'table_bloat', 'ID-03'],
  rationale: 'posts.user_id has FK but no index — JOIN queries will be slow at scale',
});

// ID-03c: Large TEXT columns without size guidance
scenarios.push({
  id: nextId('bloat'),
  description: 'ID-03: init.sql adds audit_log with unbounded TEXT columns, no cleanup policy',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\n\nCREATE TABLE audit_log (\n    id SERIAL PRIMARY KEY,\n    action TEXT NOT NULL,\n    details TEXT,\n    request_body TEXT,\n    response_body TEXT,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE audit_log' },
    { type: 'content', file: 'config.json', pattern: 'auditRetention' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'table_bloat', 'ID-03'],
  rationale: 'Audit log with 3 unbounded TEXT columns and no retention config — will bloat indefinitely',
});

// ID-03d: JSONB settings table grows without vacuum config
scenarios.push({
  id: nextId('bloat'),
  description: 'ID-03: settings table uses JSONB, docker-compose has no autovacuum config',
  edits: [{
    file: 'docker-compose.yml',
    search: '- PORT=3000',
    replace: '- PORT=3000\n      - SETTINGS_CACHE_DISABLED=true',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'JSONB NOT NULL' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'autovacuum' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'database', 'table_bloat', 'ID-03'],
  rationale: 'JSONB settings with caching disabled means frequent updates — no autovacuum config for bloat control',
});

// ID-03e: Control — table with proper indexes
scenarios.push({
  id: nextId('bloat'),
  description: 'ID-03 control: sessions table has indexes on token and expires_at',
  edits: [],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_sessions_token' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE INDEX idx_sessions_expires' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'database', 'table_bloat', 'ID-03', 'control'],
  rationale: 'Sessions table has proper indexes — no table bloat concern for lookups',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-db scenarios → ${outPath}`);
