#!/usr/bin/env bun
/**
 * Observation × CLI scenario generator
 * Grid cell: F×5
 * Shapes: FC-01 (docker ps creates overhead that changes metrics),
 *         FC-02 (health check endpoint logs and inflates log volume),
 *         FC-03 (disk check itself consumes disk)
 *
 * Observation rule: every scenario must show how RUNNING a diagnostic command
 * CHANGES the system state being diagnosed. The probe alters the measurement.
 *
 * Key distinction from State × CLI:
 * - State: agent runs command against wrong target (wrong container, wrong host)
 * - Observation: agent runs correct command against correct target but the command itself mutates state
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-observation-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/observation-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `fc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape FC-01: docker ps / docker stats creates overhead that changes metrics
// Running `docker ps` or `docker stats` to check container state consumes CPU
// and memory. The measurement adds load that changes what's being measured.
// =============================================================================

// FC-01a: docker-compose.yml healthcheck runs wget — each check adds to CPU/network metrics
scenarios.push({
  id: nextId('overhead'),
  description: 'FC-01: docker-compose.yml healthcheck runs every 5s, each probe adds network/CPU overhead',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'interval: 5s' },
    { type: 'content', file: 'server.js', pattern: 'interval' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'probe_overhead', 'FC-01'],
  rationale: 'Assumed: healthcheck is free. Actual: 5s interval means 12 HTTP requests/minute of overhead. server.js has no interval awareness.',
});

// FC-01b: Add resource limits to compose — probing overhead may push past limits
scenarios.push({
  id: nextId('overhead'),
  description: 'FC-01: Add memory limit to docker-compose.yml, diagnostic probes consume memory within the limit',
  edits: [{
    file: 'docker-compose.yml',
    search: '    healthcheck:',
    replace: '    deploy:\n      resources:\n        limits:\n          memory: 128M\n    healthcheck:'
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '128M' },
    { type: 'content', file: 'config.json', pattern: 'memory' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'probe_overhead', 'FC-01'],
  rationale: 'Assumed: probes are lightweight. Actual: 128M limit means each `docker stats` query consumes part of the budget. config.json has no memory awareness.',
});

// FC-01c: Healthcheck retries 3 times — failed probe amplifies overhead 3x
scenarios.push({
  id: nextId('overhead'),
  description: 'FC-01: docker-compose.yml healthcheck retries 3x on failure, tripling probe overhead',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'retries: 3' },
    { type: 'content', file: '.env', pattern: 'retries' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'probe_overhead', 'FC-01'],
  rationale: 'Assumed: retry count is neutral. Actual: 3 retries × 5s interval = potential 15 probes/minute under failure. .env has no retry config.',
});

// FC-01d: Healthcheck timeout 3s holds connection open — concurrent probes stack
scenarios.push({
  id: nextId('overhead'),
  description: 'FC-01: docker-compose.yml healthcheck timeout=3s, probe holds connection during timeout window',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'timeout: 3s' },
    { type: 'content', file: 'Dockerfile', pattern: 'timeout' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'probe_overhead', 'FC-01'],
  rationale: 'Assumed: timeout just limits wait time. Actual: 3s timeout holds a TCP connection — under load, probes overlap with app traffic. Dockerfile timeout is different.',
});

// FC-01e: Control — docker-compose.yml healthcheck exists, check compose for it
scenarios.push({
  id: nextId('overhead'),
  description: 'FC-01 control: docker-compose.yml has healthcheck, predicate checks docker-compose.yml',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck:' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'cli', 'probe_overhead', 'FC-01', 'control'],
  rationale: 'Static file check — reading docker-compose.yml doesn\'t run any probes.',
});

// =============================================================================
// Shape FC-02: Health check endpoint logs and inflates log volume
// Running /health to check app status generates access logs. Each observation
// adds to the log file, inflating disk usage and making log analysis noisier.
// =============================================================================

// FC-02a: server.js /health endpoint responds — each call generates console.log
scenarios.push({
  id: nextId('logs'),
  description: 'FC-02: Add request logging to server.js, each /health probe adds a log line',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "const server = http.createServer((req, res) => {\n  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'console.log' },
    { type: 'content', file: '.env', pattern: 'LOG_LEVEL' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'log_inflation', 'FC-02'],
  rationale: 'Assumed: health probes are silent. Actual: request logging means 12 log lines/minute from healthchecks alone. .env has no LOG_LEVEL.',
});

// FC-02b: Dockerfile healthcheck wget generates access log entries
scenarios.push({
  id: nextId('logs'),
  description: 'FC-02: Dockerfile HEALTHCHECK wget /health, each check creates an access log entry on the server',
  edits: [],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'wget' },
    { type: 'content', file: 'config.json', pattern: 'log' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'log_inflation', 'FC-02'],
  rationale: 'Assumed: HEALTHCHECK is transparent. Actual: wget creates HTTP request → server access log. config.json has no log config.',
});

// FC-02c: Add verbose health response — larger response = more log data
scenarios.push({
  id: nextId('logs'),
  description: 'FC-02: Expand /health to return detailed status, each probe generates larger log payload',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage(), pid: process.pid }));"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'process.uptime()' },
    { type: 'content', file: '.env', pattern: 'HEALTH_VERBOSE' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'log_inflation', 'FC-02'],
  rationale: 'Assumed: verbose health is just more data. Actual: each 5s probe now returns ~200 bytes instead of ~15. Log volume grows 13x. No env toggle.',
});

// FC-02d: Add error count to health — checking health resets error window
scenarios.push({
  id: nextId('logs'),
  description: 'FC-02: Add error count to /health that resets on read, observation clears the measurement',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: "let errorCount = 0;\nconst server = http.createServer((req, res) => {"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'errorCount' },
    { type: 'content', file: 'config.json', pattern: 'errorCount' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'log_inflation', 'FC-02'],
  rationale: 'Assumed: error counting is stateless. Actual: reading error count resets it (read-and-clear pattern). Observation destroys the data. config.json unaware.',
});

// FC-02e: Control — Dockerfile has HEALTHCHECK command, check Dockerfile for it
scenarios.push({
  id: nextId('logs'),
  description: 'FC-02 control: Dockerfile HEALTHCHECK exists, predicate checks Dockerfile',
  edits: [],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'HEALTHCHECK' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'cli', 'log_inflation', 'FC-02', 'control'],
  rationale: 'Static file check — reading Dockerfile doesn\'t execute the healthcheck.',
});

// =============================================================================
// Shape FC-03: Disk check itself consumes disk
// Agent runs `df -h` or checks disk usage, but the diagnostic output/logs/tmp
// files consume disk space. Measuring disk usage changes disk usage.
// =============================================================================

// FC-03a: Add disk check route that writes temp file for measurement
scenarios.push({
  id: nextId('disk'),
  description: 'FC-03: Add /health/disk route that writes temp file to measure I/O, observation consumes disk',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items')",
    replace: "if (req.url === '/health/disk') {\n    // Write temp file to test disk I/O speed\n    require('fs').writeFileSync('/tmp/disk-check', 'probe-' + Date.now());\n    res.writeHead(200);\n    res.end('disk ok');\n    return;\n  }\n\n  if (req.url === '/api/items')"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/health/disk' },
    { type: 'content', file: 'Dockerfile', pattern: '/health/disk' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'disk_consumption', 'FC-03'],
  rationale: 'Assumed: disk probe is read-only. Actual: writes /tmp/disk-check on every call. Observation creates artifacts. Dockerfile unaware.',
});

// FC-03b: Core dump / crash dump from diagnostic probe consumes massive disk
scenarios.push({
  id: nextId('disk'),
  description: 'FC-03: Add debug dump route that writes process state, each call grows /tmp',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items')",
    replace: "if (req.url === '/debug/dump') {\n    const dump = JSON.stringify(process.memoryUsage());\n    require('fs').appendFileSync('/tmp/debug-dumps.log', dump + '\\n');\n    res.writeHead(200);\n    res.end(dump);\n    return;\n  }\n\n  if (req.url === '/api/items')"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/debug/dump' },
    { type: 'content', file: 'config.json', pattern: 'debug' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'disk_consumption', 'FC-03'],
  rationale: 'Assumed: debug endpoint is lightweight. Actual: appends to debug-dumps.log on every call — unbounded growth. config.json has no debug config.',
});

// FC-03c: Docker log driver generates logs from probe output — measuring logs grows logs
scenarios.push({
  id: nextId('disk'),
  description: 'FC-03: docker-compose.yml has no log rotation config, healthcheck output grows container logs',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'logging' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'disk_consumption', 'FC-03'],
  rationale: 'Assumed: healthcheck output is discarded. Actual: no logging config means default json-file driver — all output goes to disk. No rotation.',
});

// FC-03d: Add tmp cleanup check — the check itself creates a temp file
scenarios.push({
  id: nextId('disk'),
  description: 'FC-03: HEALTHCHECK writes to /tmp — each probe creates a file even if disk is full',
  edits: [{
    file: 'Dockerfile',
    search: 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O- http://localhost:3000/health || exit 1',
    replace: 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O /tmp/healthcheck-result http://localhost:3000/health || exit 1'
  }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/tmp/healthcheck-result' },
    { type: 'content', file: 'server.js', pattern: 'healthcheck-result' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'cli', 'disk_consumption', 'FC-03'],
  rationale: 'Assumed: wget -O /tmp is harmless. Actual: creates file on every 5s interval. On full disk, the probe itself fails. server.js unaware.',
});

// FC-03e: Control — Dockerfile writes no temp files in HEALTHCHECK
scenarios.push({
  id: nextId('disk'),
  description: 'FC-03 control: Original Dockerfile HEALTHCHECK uses wget -O- (stdout only, no disk write)',
  edits: [],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'wget -q -O-' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'cli', 'disk_consumption', 'FC-03', 'control'],
  rationale: 'wget -O- sends output to stdout, not disk. Observation doesn\'t consume disk (modulo docker log driver).',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} observation-cli scenarios → ${outPath}`);
