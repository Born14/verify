#!/usr/bin/env bun
/**
 * Capacity x Verify/Observe scenario generator
 * Grid cell: I×7
 * Shapes: IV-01 (log file too large to parse), IV-02 (metrics endpoint returns too many series), IV-03 (snapshot too large to store)
 *
 * These scenarios test whether verify detects capacity failures in the
 * verification/observation layer — log files overwhelm parsers, metrics
 * responses are too large, and snapshots exceed storage limits.
 *
 * Run: bun scripts/harvest/stage-capacity-verify.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-verify-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `iv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape IV-01: Log file too large to parse
// Server generates excessive log output. The verification pipeline tries to
// read/parse logs but they exceed buffer limits or cause parser OOM.
// =============================================================================

// IV-01a: Server logs every request with full headers — massive output
scenarios.push({
  id: nextId('log'),
  description: 'IV-01: Server logs full request headers per request, log volume overwhelms parser',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  console.log(JSON.stringify({ url: req.url, headers: req.headers, ts: Date.now(), trace: new Error().stack }));",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'console.log(JSON.stringify' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'verify', 'log_overflow', 'IV-01'],
  rationale: 'Full headers + stack trace per request — health check probe generates megabytes of logs',
});

// IV-01b: Startup banner writes 10000 lines before server ready
scenarios.push({
  id: nextId('log'),
  description: 'IV-01: Server prints 10000 startup log lines before listen(), parser overwhelmed',
  edits: [{
    file: 'server.js',
    search: "server.listen(PORT, () => {",
    replace: `for (let i = 0; i < 10000; i++) { console.log(\`[BOOT] Initializing module \${i}: ${'x'.repeat(100)}\`); }\nserver.listen(PORT, () => {`,
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Initializing module' },
    { type: 'content', file: 'server.js', pattern: "Demo app listening" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'log_overflow', 'IV-01'],
  rationale: '10000 startup lines — log parser buffer fills before the "listening" message arrives',
});

// IV-01c: Error handler logs full error objects with circular refs
scenarios.push({
  id: nextId('log'),
  description: 'IV-01: Uncaught exception handler logs full Error with circular reference',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nprocess.on('uncaughtException', (err) => {\n  const circular = { err, self: null }; circular.self = circular;\n  try { console.error(JSON.stringify(circular)); } catch(e) { console.error(err.stack); }\n});",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'uncaughtException' },
    { type: 'content', file: 'server.js', pattern: 'circular' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'log_overflow', 'IV-01'],
  rationale: 'Circular reference in error logging — JSON.stringify throws, falls back to massive stack trace',
});

// IV-01d: Docker compose has no log driver limits
scenarios.push({
  id: nextId('log'),
  description: 'IV-01: No log rotation config in compose, verbose app fills docker log buffer',
  edits: [
    { file: 'docker-compose.yml', search: 'healthcheck:', replace: "logging:\n      driver: json-file\n      options:\n        max-size: \"unlimited\"\n    healthcheck:" },
    { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const server = http.createServer((req, res) => {\n  for (let i = 0; i < 100; i++) console.log(`[REQ] ${req.url} line ${i}`);" },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'unlimited' },
    { type: 'content', file: 'server.js', pattern: '[REQ]' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'log_overflow', 'IV-01'],
  rationale: 'Unlimited log driver + 100 lines per request — docker logs command hangs or OOMs',
});

// IV-01e: Control — minimal logging
scenarios.push({
  id: nextId('log'),
  description: 'IV-01 control: Server has single startup log line',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "Demo app listening on port" }],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'log_overflow', 'IV-01', 'control'],
  rationale: 'Single startup log line — well within parser capacity',
});

// =============================================================================
// Shape IV-02: Metrics endpoint returns too many series
// The app exposes a metrics endpoint that returns an enormous number of
// time series or data points, overwhelming the verification pipeline.
// =============================================================================

// IV-02a: Metrics endpoint returns 10000 Prometheus lines
scenarios.push({
  id: nextId('metrics'),
  description: 'IV-02: /metrics returns 10000 Prometheus-format lines, parser overwhelmed',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: `if (req.url === '/metrics') {\n    res.writeHead(200, { 'Content-Type': 'text/plain' });\n    const lines = [];\n    for (let i = 0; i < 10000; i++) lines.push(\`app_metric_\${i}{label="val"} \${Math.random()}\`);\n    res.end(lines.join('\\n'));\n    return;\n  }\n  if (req.url === '/health') {`,
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/metrics', expect: { status: 200 } },
    { type: 'content', file: 'server.js', pattern: 'app_metric_' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'verify', 'metrics_cardinality', 'IV-02'],
  rationale: '10000 metric lines — cardinality explosion overwhelms metrics scraper or verifier',
});

// IV-02b: Health endpoint returns massive JSON status
scenarios.push({
  id: nextId('metrics'),
  description: 'IV-02: /health returns detailed status with 500 subsystem checks',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `const checks = {}; for (let i = 0; i < 500; i++) checks[\`subsystem_\${i}\`] = { status: 'ok', latency: Math.random() * 100, details: '${'x'.repeat(200)}' };\n    res.end(JSON.stringify({ status: 'ok', checks }));`,
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
    { type: 'content', file: 'server.js', pattern: 'subsystem_' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'verify', 'metrics_cardinality', 'IV-02'],
  rationale: '500 subsystem checks with 200-char details each — health response is ~150KB, parser slow',
});

// IV-02c: /api/items returns 5000 items
scenarios.push({
  id: nextId('metrics'),
  description: 'IV-02: /api/items returns 5000 items, predicate expects specific item',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));",
    replace: `const items = Array.from({length: 5000}, (_, i) => ({ id: i, name: 'Item' + i, data: '${'x'.repeat(100)}' }));\n    res.end(JSON.stringify(items));`,
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Item4999' } },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'metrics_cardinality', 'IV-02'],
  rationale: '5000 items with 100-char payload each — ~600KB response, verification parse slow',
});

// IV-02d: Schema introspection returns massive result set
scenarios.push({
  id: nextId('metrics'),
  description: 'IV-02: init.sql creates 50 tables, schema introspection returns huge result',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: Array.from({ length: 50 }, (_, i) => `CREATE TABLE metric_${i} (\n    id SERIAL PRIMARY KEY,\n    value JSONB NOT NULL,\n    ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`).join('\n\n') + '\n\nCREATE TABLE settings (',
  }],
  predicates: [
    { type: 'db', table: 'metric_49', assertion: 'table_exists' },
    { type: 'db', table: 'settings', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'verify', 'metrics_cardinality', 'IV-02'],
  rationale: '50 additional tables — schema introspection returns massive catalog, slow to parse',
});

// IV-02e: Control — small metrics response
scenarios.push({
  id: nextId('metrics'),
  description: 'IV-02 control: /health returns compact JSON status',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'metrics_cardinality', 'IV-02', 'control'],
  rationale: 'Compact health response — well within parsing limits',
});

// =============================================================================
// Shape IV-03: Snapshot too large to store
// The application directory or state grows too large for the checkpoint/snapshot
// system to capture within time or space budgets.
// =============================================================================

// IV-03a: server.js bloated with inline data beyond snapshot limit
scenarios.push({
  id: nextId('snap'),
  description: 'IV-03: server.js grows to 500KB with inline data, snapshot capture too slow',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;\nconst DATASET = [\n${Array.from({length: 2000}, (_, i) => `  { id: ${i}, payload: "${'x'.repeat(200)}" }`).join(',\n')}\n];`,
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'DATASET' },
    { type: 'content', file: 'server.js', pattern: "require('http')" },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'snapshot_size', 'IV-03'],
  rationale: '2000 entries x 200 chars = ~400KB inline data — file hashing and snapshot capture slow',
});

// IV-03b: Multiple large config files push total snapshot past limit
scenarios.push({
  id: nextId('snap'),
  description: 'IV-03: config.json expanded to 200KB, plus server.js — total snapshot too large',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: `"analytics": false,\n  "featureFlags": {\n${Array.from({length: 500}, (_, i) => `    "flag_${i}": { "enabled": ${i % 2 === 0}, "rollout": ${i}, "description": "${'Feature flag description '.repeat(5)}" }`).join(',\n')}\n  }`,
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'flag_499' },
    { type: 'content', file: 'config.json', pattern: 'featureFlags' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'snapshot_size', 'IV-03'],
  rationale: '500 feature flags with descriptions — config.json balloons, snapshot hashing slow',
});

// IV-03c: init.sql with large seed data
scenarios.push({
  id: nextId('snap'),
  description: 'IV-03: init.sql expanded with 1000 INSERT rows, snapshot includes full SQL',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: Array.from({ length: 1000 }, (_, i) => `INSERT INTO users (username, email, password_hash) VALUES ('user${i}', 'user${i}@test.com', '${'h'.repeat(60)}');`).join('\n') + '\n\nCREATE TABLE settings (',
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'user999@test.com' },
    { type: 'db', table: 'users', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'verify', 'snapshot_size', 'IV-03'],
  rationale: '1000 INSERT statements with 60-char hashes — init.sql grows large, snapshot capture slow',
});

// IV-03d: docker-compose with many services, each with config
scenarios.push({
  id: nextId('snap'),
  description: 'IV-03: docker-compose expanded with 20 services, snapshot must capture all',
  edits: [{
    file: 'docker-compose.yml',
    search: 'services:\n  app:',
    replace: 'services:\n' + Array.from({ length: 20 }, (_, i) => `  svc-${i}:\n    image: nginx:alpine\n    environment:\n${Array.from({length: 10}, (_, j) => `      - SVC${i}_VAR${j}=${'val'.repeat(20)}`).join('\n')}`).join('\n') + '\n  app:',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'svc-19' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'build: .' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'snapshot_size', 'IV-03'],
  rationale: '20 services x 10 env vars with long values — compose file bloated for snapshot',
});

// IV-03e: Control — small app directory
scenarios.push({
  id: nextId('snap'),
  description: 'IV-03 control: Standard app files, well within snapshot limits',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "require('http')" },
    { type: 'content', file: 'config.json', pattern: '"port": 3000' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'verify', 'snapshot_size', 'IV-03', 'control'],
  rationale: 'Standard fixture — small files, snapshot captures quickly',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-verify scenarios -> ${outPath}`);
