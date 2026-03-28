#!/usr/bin/env bun
/**
 * Capacity x Multi-Step scenario generator
 * Grid cell: I×6
 * Shapes: IM-01 (cumulative timeout budget), IM-02 (connection not released between steps), IM-03 (temp files accumulate across steps)
 *
 * These scenarios test whether verify detects capacity failures across
 * multi-step sequences — individual steps are fine but cumulative resource
 * consumption (timeouts, connections, temp files) exceeds limits.
 *
 * Run: bun scripts/harvest/stage-capacity-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `im-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape IM-01: Cumulative timeout budget exceeded
// Each step has a reasonable individual timeout but the total sequence
// exceeds the pipeline's timeout budget.
// =============================================================================

// IM-01a: 5 HTTP steps each with 10s sleep, 50s total exceeds 30s budget
scenarios.push({
  id: nextId('timeout'),
  description: 'IM-01: Server adds 10s delay to /api/items, sequence of 5 calls exceeds timeout budget',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([",
    replace: "if (req.url === '/api/items') {\n    await new Promise(r => setTimeout(r, 10000));\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'multistep', 'timeout_budget', 'IM-01'],
  rationale: 'API endpoint has 10s artificial delay — cumulative calls exceed verification timeout',
});

// IM-01b: Migration steps each take time, total exceeds budget
scenarios.push({
  id: nextId('timeout'),
  description: 'IM-01: init.sql adds pg_sleep(5) per table creation, 4 tables = 20s total',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE users (',
    replace: "SELECT pg_sleep(5);\nCREATE TABLE users (",
  }],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'settings', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'multistep', 'timeout_budget', 'IM-01'],
  rationale: 'Each table creation delayed by 5s sleep — 4 tables = 20s migration, exceeds timeout',
});

// IM-01c: Health check retries with slow response eat budget
scenarios.push({
  id: nextId('timeout'),
  description: 'IM-01: Health endpoint sleeps 4s, Docker healthcheck retries 3 times at 5s interval',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "setTimeout(() => res.end(JSON.stringify({ status: 'ok' })), 4000);",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'content', file: 'docker-compose.yml', pattern: 'retries: 3' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'multistep', 'timeout_budget', 'IM-01'],
  rationale: 'Health endpoint responds in 4s but healthcheck timeout is 3s — all retries fail',
});

// IM-01d: Sequential API calls each within limit but total exceeds
scenarios.push({
  id: nextId('timeout'),
  description: 'IM-01: Sequence of /health + /api/items + /about, each adds 8s, total > 20s budget',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer(async (req, res) => {\n  await new Promise(r => setTimeout(r, 8000));",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
    { type: 'http', method: 'GET', path: '/about', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'multistep', 'timeout_budget', 'IM-01'],
  rationale: 'Each request adds 8s delay — 3 sequential probes = 24s, exceeds typical 10s per-request timeout',
});

// IM-01e: Control — fast responses, well within budget
scenarios.push({
  id: nextId('timeout'),
  description: 'IM-01 control: All endpoints respond immediately, well within timeout',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'content', file: 'server.js', pattern: "status: 'ok'" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'timeout_budget', 'IM-01', 'control'],
  rationale: 'No artificial delays — all responses immediate',
});

// =============================================================================
// Shape IM-02: Connection not released between steps
// Step N opens a connection (DB, HTTP, file handle) that is not properly
// closed. Step N+1 fails because the connection pool is exhausted.
// =============================================================================

// IM-02a: DB connection created per request, no pool limit, exhaustion
scenarios.push({
  id: nextId('conn'),
  description: 'IM-02: Server creates new DB connection per request without closing, pool exhausted',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst connections = [];\nfunction leakConnection() { connections.push({ fd: connections.length, opened: Date.now() }); }",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'leakConnection' },
    { type: 'content', file: 'server.js', pattern: 'connections.push' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'connection_leak', 'IM-02'],
  rationale: 'Connection array grows unbounded — each request leaks, eventual pool exhaustion',
});

// IM-02b: File handles opened without close
scenarios.push({
  id: nextId('conn'),
  description: 'IM-02: Server opens log file handle per request, never closes them',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst fs = require('fs');\nconst handles = [];",
  }, {
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  handles.push(fs.openSync('/tmp/req-' + Date.now() + '.log', 'w'));",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'fs.openSync' },
    { type: 'content', file: 'server.js', pattern: 'handles.push' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'connection_leak', 'IM-02'],
  rationale: 'File descriptors leaked per request — EMFILE after enough requests',
});

// IM-02c: HTTP keep-alive connections not drained
scenarios.push({
  id: nextId('conn'),
  description: 'IM-02: Server sets Connection: keep-alive but never destroys sockets',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  res.setHeader('Connection', 'keep-alive');\n  res.setHeader('Keep-Alive', 'timeout=300');",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'keep-alive' },
    { type: 'content', file: 'server.js', pattern: 'timeout=300' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'connection_leak', 'IM-02'],
  rationale: 'Keep-alive with 300s timeout — connections accumulate during verification sequence',
});

// IM-02d: Event listeners added per request, never removed
scenarios.push({
  id: nextId('conn'),
  description: 'IM-02: Server adds process.on listener per request (memory leak pattern)',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  process.on('uncaughtException', () => {});",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "process.on('uncaughtException'" },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'multistep', 'connection_leak', 'IM-02'],
  rationale: 'Listener added per request — MaxListenersExceededWarning then eventual OOM',
});

// IM-02e: Control — proper cleanup
scenarios.push({
  id: nextId('conn'),
  description: 'IM-02 control: No connection leaks, standard request handling',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "require('http')" },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'connection_leak', 'IM-02', 'control'],
  rationale: 'Standard http.createServer — connections handled and released properly by Node.js',
});

// =============================================================================
// Shape IM-03: Temp files accumulate across steps
// Each step in the sequence writes temporary files that are never cleaned up.
// The cumulative disk usage exceeds available space or inode limits.
// =============================================================================

// IM-03a: Each API call creates a temp file, no cleanup between steps
scenarios.push({
  id: nextId('temp'),
  description: 'IM-03: Server writes temp file per request to /tmp, no rotation config',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst fs = require('fs');\nlet reqCount = 0;",
  }, {
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  fs.writeFileSync(`/tmp/req-${++reqCount}.json`, JSON.stringify({url: req.url, ts: Date.now()}));",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'writeFileSync' },
    { type: 'content', file: 'server.js', pattern: 'reqCount' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'temp_accumulation', 'IM-03'],
  rationale: 'Temp files written per request with no cleanup — /tmp fills during long verification',
});

// IM-03b: Docker compose has tmpfs limit, temp files exceed it
scenarios.push({
  id: nextId('temp'),
  description: 'IM-03: Compose has tmpfs 1MB limit, server writes 100KB per request temp file',
  edits: [
    { file: 'docker-compose.yml', search: 'healthcheck:', replace: "tmpfs:\n      - /tmp:size=1m\n    healthcheck:" },
    { file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst fs = require('fs');\nlet n = 0;" },
    { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const server = http.createServer((req, res) => {\n  fs.writeFileSync(`/tmp/data-${++n}.bin`, Buffer.alloc(102400));" },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'size=1m' },
    { type: 'content', file: 'server.js', pattern: 'Buffer.alloc(102400)' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'temp_accumulation', 'IM-03'],
  rationale: '100KB per request into 1MB tmpfs — 10 requests fills it, subsequent writes fail',
});

// IM-03c: Upload endpoint saves files without size limit
scenarios.push({
  id: nextId('temp'),
  description: 'IM-03: Upload endpoint stores to /tmp with no max-size or max-files',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/echo' && req.method === 'POST') {",
    replace: "if (req.url === '/api/upload' && req.method === 'POST') {\n  let body = [];\n  req.on('data', c => body.push(c));\n  req.on('end', () => { require('fs').writeFileSync('/tmp/upload-' + Date.now(), Buffer.concat(body)); res.writeHead(200); res.end('saved'); });\n  return;\n  }\n  if (req.url === '/api/echo' && req.method === 'POST') {",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/api/upload' },
    { type: 'content', file: 'server.js', pattern: "writeFileSync('/tmp/upload-'" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'temp_accumulation', 'IM-03'],
  rationale: 'Uploads saved to /tmp with no size limit or rotation — disk fills across step sequence',
});

// IM-03d: Build artifacts accumulate across compose rebuilds
scenarios.push({
  id: nextId('temp'),
  description: 'IM-03: Dockerfile caches build layers, no prune, predicate checks image count',
  edits: [{
    file: 'Dockerfile',
    search: 'FROM node:20-alpine',
    replace: 'FROM node:20-alpine\nRUN echo "build-$(date +%s)" > /tmp/build-marker',
  }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'build-marker' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'build: .' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'temp_accumulation', 'IM-03'],
  rationale: 'Each rebuild creates new layer — without docker system prune, disk fills with stale layers',
});

// IM-03e: Control — no temp file creation
scenarios.push({
  id: nextId('temp'),
  description: 'IM-03 control: No temp files created during request handling',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'http.createServer' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'multistep', 'temp_accumulation', 'IM-03', 'control'],
  rationale: 'Standard request handler — no temp files written, no accumulation',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-multistep scenarios -> ${outPath}`);
