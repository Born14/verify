#!/usr/bin/env bun
/**
 * Capacity × HTTP scenario generator
 * Grid cell: I×2
 * Shapes: IH-01 (rate limit 429), IH-02 (connection pool exhausted), IH-03 (payload too large 413)
 *
 * These scenarios test whether verify detects HTTP-level capacity exhaustion:
 * rate limits set too low for expected throughput, connection pool sizes
 * mismatched with concurrency requirements, and request body limits
 * conflicting with expected payload sizes.
 *
 * Run: bun scripts/harvest/stage-capacity-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `ih-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape IH-01: Rate limit (429) — config shows low rate limit
// Server has rate limiting middleware with a threshold that conflicts with
// what predicates expect the server to handle. Cross-source: rate limit in
// config vs expected throughput in predicate or env var.
// =============================================================================

// IH-01a: server.js has rate limiter, config.json has low rateLimit, predicate expects high throughput
scenarios.push({
  id: nextId('rate'),
  description: 'IH-01: server.js rate limiter set to 10 req/min, predicate expects unlimited API access',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst RATE_LIMIT = 10; // max 10 requests per minute\nconst requestCounts = new Map();",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'RATE_LIMIT' },
    { type: 'content', file: 'config.json', pattern: '"rateLimit"' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'rate_limit', 'IH-01'],
  rationale: 'Rate limiter added to server but config.json has no rateLimit key — config/code mismatch',
});

// IH-01b: config.json has rate limit, .env overrides with different value
scenarios.push({
  id: nextId('rate'),
  description: 'IH-01: config.json sets rateLimit=100, .env sets RATE_LIMIT=5 — predicate checks config',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "rateLimit": 100' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nRATE_LIMIT=5' },
  ],
  predicates: [{ type: 'config', key: 'features.rateLimit', expected: '100' }],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'rate_limit', 'IH-01'],
  rationale: 'Config says 100 but .env says 5 — env override means effective rate limit is 5, not 100',
});

// IH-01c: server.js has per-IP rate limit, config.staging.json has no limit
scenarios.push({
  id: nextId('rate'),
  description: 'IH-01: server.js adds IP-based throttle, config.staging.json has no throttle config',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst MAX_REQUESTS_PER_IP = 20;\nconst IP_WINDOW_MS = 60000;",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'MAX_REQUESTS_PER_IP' },
    { type: 'content', file: 'config.staging.json', pattern: 'throttle' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'rate_limit', 'IH-01'],
  rationale: 'IP throttle in code but staging config has no throttle section — staging tests will hit limits',
});

// IH-01d: .env has API_RATE_LIMIT, server.js reads it but config.json doesn't document it
scenarios.push({
  id: nextId('rate'),
  description: 'IH-01: .env sets API_RATE_LIMIT=50, server.js reads env, config.json unaware',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nAPI_RATE_LIMIT=50' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst API_RATE_LIMIT = parseInt(process.env.API_RATE_LIMIT || '1000');" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'API_RATE_LIMIT' },
    { type: 'content', file: 'config.json', pattern: 'rateLimit' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'rate_limit', 'IH-01'],
  rationale: 'Rate limit set in .env (50) and read in code (default 1000) but config.json has no record',
});

// IH-01e: Control — rate limit consistent across sources
scenarios.push({
  id: nextId('rate'),
  description: 'IH-01 control: Rate limit added to both server.js and config.json consistently',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst RATE_LIMIT = 100;" },
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "rateLimit": 100' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'RATE_LIMIT = 100' },
    { type: 'config', key: 'features.rateLimit', expected: '100' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'rate_limit', 'IH-01', 'control'],
  rationale: 'Rate limit consistent in both server.js and config.json — no capacity conflict',
});

// =============================================================================
// Shape IH-02: Connection pool exhausted — config shows small pool
// App configured with limited connection pool, but concurrent access patterns
// or deployment config implies higher concurrency than the pool supports.
// =============================================================================

// IH-02a: config.json has maxConnections: 5, docker-compose runs 3 replicas
scenarios.push({
  id: nextId('pool'),
  description: 'IH-02: config.json maxConnections=5, docker-compose adds 3 replicas needing pool each',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 5' },
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    deploy:\n      replicas: 3\n    healthcheck:' },
  ],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '5' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'replicas: 3' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'pool_exhaustion', 'IH-02'],
  rationale: '5 connections shared across 3 replicas = ~1.6 per replica — pool exhaustion under load',
});

// IH-02b: .env has pool size, config.json has different pool size
scenarios.push({
  id: nextId('pool'),
  description: 'IH-02: .env DB_POOL_SIZE=3, config.json maxConnections=20 — mismatch',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_POOL_SIZE=3' },
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 20' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=3' },
    { type: 'config', key: 'database.maxConnections', expected: '20' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'pool_exhaustion', 'IH-02'],
  rationale: '.env limits pool to 3 but config.json claims 20 — effective pool is 3, capacity illusion',
});

// IH-02c: server.js creates connection pool, config.prod.json has no pool config
scenarios.push({
  id: nextId('pool'),
  description: 'IH-02: server.js uses pool with max=10, config.prod.json has no connection settings',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst POOL_MAX = 10;\nconst POOL_IDLE_TIMEOUT = 30000;",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'POOL_MAX = 10' },
    { type: 'content', file: 'config.prod.json', pattern: 'maxConnections' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'pool_exhaustion', 'IH-02'],
  rationale: 'Pool config in code but not in prod config — prod deployment may use different (wrong) pool size',
});

// IH-02d: docker-compose.test has pool env, production compose doesn't
scenarios.push({
  id: nextId('pool'),
  description: 'IH-02: docker-compose.test.yml has DB pool env, docker-compose.yml does not',
  edits: [{
    file: 'docker-compose.yml',
    search: '- PORT=3000',
    replace: '- PORT=3000\n      - DB_POOL_MAX=2',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'DB_POOL_MAX=2' },
    { type: 'content', file: 'docker-compose.test.yml', pattern: 'DB_POOL_MAX' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'pool_exhaustion', 'IH-02'],
  rationale: 'Production compose limits pool to 2 but test compose has no such limit — test/prod disparity',
});

// IH-02e: Control — pool size consistent
scenarios.push({
  id: nextId('pool'),
  description: 'IH-02 control: Pool size set in both config.json and .env to same value',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo",\n    "maxConnections": 10' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_POOL_SIZE=10' },
  ],
  predicates: [
    { type: 'config', key: 'database.maxConnections', expected: '10' },
    { type: 'content', file: '.env', pattern: 'DB_POOL_SIZE=10' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'pool_exhaustion', 'IH-02', 'control'],
  rationale: 'Pool size matches across config.json and .env — no capacity conflict',
});

// =============================================================================
// Shape IH-03: Payload too large (413) — request body exceeds configured limit
// Server has body size limit that conflicts with what the app actually needs
// to handle, or limits set inconsistently across config sources.
// =============================================================================

// IH-03a: server.js has 1KB body limit, route expects large form submissions
scenarios.push({
  id: nextId('payload'),
  description: 'IH-03: server.js sets body limit 1KB, form action expects large message bodies',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst MAX_BODY_SIZE = 1024; // 1KB limit",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'MAX_BODY_SIZE = 1024' },
    { type: 'content', file: 'server.js', pattern: 'textarea' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'payload_limit', 'IH-03'],
  rationale: '1KB limit but form has textarea for messages — realistic message will exceed 1KB',
});

// IH-03b: .env sets MAX_REQUEST_SIZE, server.js has different hardcoded limit
scenarios.push({
  id: nextId('payload'),
  description: 'IH-03: .env MAX_REQUEST_SIZE=10mb, server.js hardcodes 100kb limit',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nMAX_REQUEST_SIZE=10mb' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst BODY_LIMIT = '100kb'; // hardcoded, ignores env" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'MAX_REQUEST_SIZE=10mb' },
    { type: 'content', file: 'server.js', pattern: "BODY_LIMIT = '100kb'" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'payload_limit', 'IH-03'],
  rationale: '.env says 10mb but code hardcodes 100kb — env config is capacity fiction',
});

// IH-03c: config.json has upload limit, config.prod.json has different limit
scenarios.push({
  id: nextId('payload'),
  description: 'IH-03: config.json uploadLimit=5mb, config.prod.json has no upload config',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": false,\n    "uploadLimit": "5mb"',
  }],
  predicates: [
    { type: 'config', key: 'features.uploadLimit', expected: '5mb' },
    { type: 'content', file: 'config.prod.json', pattern: 'uploadLimit' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'payload_limit', 'IH-03'],
  rationale: 'Dev config has upload limit but prod config does not — prod may have no limit or wrong default',
});

// IH-03d: docker-compose sets CLIENT_MAX_BODY_SIZE, nginx-style reverse proxy not configured
scenarios.push({
  id: nextId('payload'),
  description: 'IH-03: docker-compose env CLIENT_MAX_BODY_SIZE=1m, no nginx config present',
  edits: [{
    file: 'docker-compose.yml',
    search: '- PORT=3000',
    replace: '- PORT=3000\n      - CLIENT_MAX_BODY_SIZE=1m',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'CLIENT_MAX_BODY_SIZE=1m' },
    { type: 'content', file: 'server.js', pattern: 'CLIENT_MAX_BODY_SIZE' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'http', 'payload_limit', 'IH-03'],
  rationale: 'Body size set in compose env but server.js never reads it — limit is cosmetic',
});

// IH-03e: Control — body limit set and read consistently
scenarios.push({
  id: nextId('payload'),
  description: 'IH-03 control: .env and server.js both reference same body limit',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nBODY_LIMIT=5mb' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst BODY_LIMIT = process.env.BODY_LIMIT || '5mb';" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'BODY_LIMIT=5mb' },
    { type: 'content', file: 'server.js', pattern: "process.env.BODY_LIMIT" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'http', 'payload_limit', 'IH-03', 'control'],
  rationale: 'Body limit set in env and read by code — consistent capacity configuration',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-http scenarios → ${outPath}`);
