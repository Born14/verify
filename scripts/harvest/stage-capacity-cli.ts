#!/usr/bin/env bun
/**
 * Capacity × CLI/Process scenario generator
 * Grid cell: I×5
 * Shapes: IC-01 (OOM killed — memory limit too low), IC-02 (PID limit — too many workers),
 *         IC-03 (ulimit exceeded — file descriptor limits)
 *
 * These scenarios test whether verify detects process-level capacity exhaustion:
 * memory limits that conflict with heap requirements, worker/child process counts
 * that exceed PID limits, and file descriptor usage that exceeds ulimits.
 * The agent's code is structurally correct but the runtime environment can't
 * accommodate the resource demands.
 *
 * Run: bun scripts/harvest/stage-capacity-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `ic-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');

// =============================================================================
// Shape IC-01: OOM killed — process memory limit too low for operation
// Container or process memory limit conflicts with what the application
// needs (heap size, cache sizes, data processing requirements).
// =============================================================================

// IC-01a: Dockerfile has --memory limit, .env has large NODE_OPTIONS heap
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01: docker-compose mem_limit=128m, .env NODE_OPTIONS=--max-old-space-size=512',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    mem_limit: 128m\n    healthcheck:' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nNODE_OPTIONS=--max-old-space-size=512' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'mem_limit: 128m' },
    { type: 'content', file: '.env', pattern: 'max-old-space-size=512' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01'],
  rationale: 'Container limited to 128MB but Node heap set to 512MB — OOM kill inevitable',
});

// IC-01b: Dockerfile has no memory setting, server.js loads large dataset into memory
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01: server.js loads entire dataset into memory, no memory limit in Dockerfile',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst CACHE = new Map(); // unbounded in-memory cache\nconst MAX_CACHE_ENTRIES = Infinity;",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'MAX_CACHE_ENTRIES = Infinity' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'mem_limit' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01'],
  rationale: 'Unbounded in-memory cache with no container memory limit — will grow until OOM',
});

// IC-01c: docker-compose mem_limit lower than Dockerfile recommended memory
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01: docker-compose mem_limit=64m, server.js has memory-intensive operations',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    mem_limit: 64m\n    memswap_limit: 64m\n    healthcheck:' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// Image processing requires >256MB heap\nconst PROCESS_IMAGES = true;\nconst IMAGE_BUFFER_SIZE = 256 * 1024 * 1024;" },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'mem_limit: 64m' },
    { type: 'content', file: 'server.js', pattern: 'IMAGE_BUFFER_SIZE' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01'],
  rationale: '64MB memory limit but code allocates 256MB buffer — OOM kill on first image process',
});

// IC-01d: config.json has cache config, .env has conflicting memory limit
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01: config.json cacheSize=1000, .env NODE_OPTIONS heap=64m — cache exceeds heap',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "cacheSize": 1000,\n    "cacheEntryMaxKB": 512' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nNODE_OPTIONS=--max-old-space-size=64' },
  ],
  predicates: [
    { type: 'config', key: 'features.cacheSize', expected: '1000' },
    { type: 'content', file: '.env', pattern: 'max-old-space-size=64' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01'],
  rationale: '1000 entries × 512KB = ~500MB cache but heap limited to 64MB — config is a lie',
});

// IC-01e: docker-compose.test has generous memory, production compose is tight
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01: Production compose mem_limit=128m, test compose has no limit (default: unlimited)',
  edits: [{
    file: 'docker-compose.yml',
    search: '    healthcheck:',
    replace: '    mem_limit: 128m\n    healthcheck:',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'mem_limit: 128m' },
    { type: 'content', file: 'docker-compose.test.yml', pattern: 'mem_limit' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01'],
  rationale: 'Prod has 128MB limit but test has no limit — tests pass but prod OOMs',
});

// IC-01f: Control — memory limit matches expected usage
scenarios.push({
  id: nextId('oom'),
  description: 'IC-01 control: docker-compose mem_limit=512m, .env heap=256m — headroom exists',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    mem_limit: 512m\n    healthcheck:' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nNODE_OPTIONS=--max-old-space-size=256' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'mem_limit: 512m' },
    { type: 'content', file: '.env', pattern: 'max-old-space-size=256' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'oom_killed', 'IC-01', 'control'],
  rationale: 'Container 512MB, heap 256MB — sufficient headroom for Node overhead + GC',
});

// =============================================================================
// Shape IC-02: PID limit — too many child processes spawned
// Server spawns workers or child processes without limit, but container or
// system PID limits will be exceeded.
// =============================================================================

// IC-02a: server.js spawns workers, no max limit in config
scenarios.push({
  id: nextId('pid'),
  description: 'IC-02: server.js spawns cluster workers per CPU, no worker limit in config',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst cluster = require('cluster');\nconst os = require('os');\nconst NUM_WORKERS = os.cpus().length; // unbounded by container CPU limit",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'NUM_WORKERS' },
    { type: 'content', file: 'config.json', pattern: 'maxWorkers' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'pid_limit', 'IC-02'],
  rationale: 'Workers spawned per CPU but config.json has no maxWorkers — container may have limited CPUs',
});

// IC-02b: docker-compose has pids_limit, server.js spawns child processes
scenarios.push({
  id: nextId('pid'),
  description: 'IC-02: docker-compose pids_limit=10, server.js spawns child process per request',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    pids_limit: 10\n    healthcheck:' },
    { file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst { exec } = require('child_process');\n// Each request spawns a child process for PDF generation\nconst SPAWN_PER_REQUEST = true;" },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'pids_limit: 10' },
    { type: 'content', file: 'server.js', pattern: 'SPAWN_PER_REQUEST' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'pid_limit', 'IC-02'],
  rationale: 'PID limit of 10 but each request spawns a child — 10 concurrent requests will fork-bomb',
});

// IC-02c: .env has WORKER_COUNT, Dockerfile has no process manager
scenarios.push({
  id: nextId('pid'),
  description: 'IC-02: .env WORKER_COUNT=16, Dockerfile runs node directly (no PM2/supervisor)',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\nWORKER_COUNT=16',
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'WORKER_COUNT=16' },
    { type: 'content', file: 'Dockerfile', pattern: 'pm2' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'pid_limit', 'IC-02'],
  rationale: '16 workers requested but no process manager — node directly cannot manage worker lifecycle',
});

// IC-02d: config.json has background job config, no process limit
scenarios.push({
  id: nextId('pid'),
  description: 'IC-02: config.json enables background jobs, no concurrency limit configured',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": false,\n    "backgroundJobs": true,\n    "jobConcurrency": "unlimited"',
  }],
  predicates: [
    { type: 'config', key: 'features.backgroundJobs', expected: 'true' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'pids_limit' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'pid_limit', 'IC-02'],
  rationale: 'Background jobs enabled with unlimited concurrency but no PID limit in compose',
});

// IC-02e: Control — worker count bounded and within PID limit
scenarios.push({
  id: nextId('pid'),
  description: 'IC-02 control: .env WORKER_COUNT=2, docker-compose pids_limit=50',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nWORKER_COUNT=2' },
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    pids_limit: 50\n    healthcheck:' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'WORKER_COUNT=2' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'pids_limit: 50' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'pid_limit', 'IC-02', 'control'],
  rationale: '2 workers well within PID limit of 50 — no capacity concern',
});

// =============================================================================
// Shape IC-03: Ulimit exceeded — open file descriptors exceed limit
// Server opens many connections/files, but ulimit or container config
// restricts file descriptor count below what the app needs.
// =============================================================================

// IC-03a: Dockerfile sets ulimit, server.js opens many file handles
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03: Dockerfile sets nofile ulimit=256, server.js watches many files',
  edits: [
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'RUN ulimit -n 256\nCMD ["node", "server.js"]' },
    { file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst fs = require('fs');\n// Watch all files in /app for hot reload — each watcher uses an fd\nconst WATCH_ALL_FILES = true;" },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'ulimit -n 256' },
    { type: 'content', file: 'server.js', pattern: 'WATCH_ALL_FILES' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03'],
  rationale: 'File descriptor limit 256 but file watcher opens fd per file — large apps exceed limit',
});

// IC-03b: docker-compose ulimits, .env has high connection count
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03: docker-compose ulimits nofile=1024, .env MAX_CONNECTIONS=2000',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    ulimits:\n      nofile:\n        soft: 1024\n        hard: 1024\n    healthcheck:' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nMAX_CONNECTIONS=2000' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'nofile:' },
    { type: 'content', file: '.env', pattern: 'MAX_CONNECTIONS=2000' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03'],
  rationale: 'FD limit 1024 but max connections 2000 — each connection uses an fd, will exceed ulimit',
});

// IC-03c: server.js opens log + db + redis + watch — no fd budget
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03: server.js opens 4 persistent connections, config.json has no fd budget',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst LOG_FD = 1; // log file\nconst DB_POOL_FD = 10; // DB connections\nconst REDIS_FD = 5; // Redis connections\nconst WATCHER_FD = 100; // file watchers\nconst TOTAL_FD_NEEDED = LOG_FD + DB_POOL_FD + REDIS_FD + WATCHER_FD + 200; // 200 for HTTP clients",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'TOTAL_FD_NEEDED' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'ulimits' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03'],
  rationale: 'Code calculates 316+ FDs needed but compose has no ulimits config — default may be too low',
});

// IC-03d: config.prod.json has no file limits, Dockerfile doesn't set them
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03: server.js uses fs.watch, neither Dockerfile nor config.prod.json sets fd limits',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst fs = require('fs');\nconst path = require('path');\n// Hot-reload watcher on entire public directory\nconst WATCH_DIR = path.join(__dirname, 'public');",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'WATCH_DIR' },
    { type: 'content', file: 'config.prod.json', pattern: 'maxFileDescriptors' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03'],
  rationale: 'File watcher on directory tree but no fd limit config anywhere — prod may hit default ulimit',
});

// IC-03e: docker-compose.test sets generous ulimits, production compose doesn't
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03: Production compose has no ulimits, test compose has tmpfs (implying awareness)',
  edits: [{
    file: 'docker-compose.yml',
    search: '- PORT=3000',
    replace: '- PORT=3000\n      - OPEN_FILE_LIMIT=128',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'OPEN_FILE_LIMIT=128' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'ulimits' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03'],
  rationale: 'OPEN_FILE_LIMIT env var set but no actual ulimits config — env var is cosmetic, not enforced',
});

// IC-03f: Control — ulimits set with sufficient headroom
scenarios.push({
  id: nextId('ulimit'),
  description: 'IC-03 control: docker-compose ulimits nofile=65536, server.js has modest fd usage',
  edits: [{
    file: 'docker-compose.yml',
    search: '    healthcheck:',
    replace: '    ulimits:\n      nofile:\n        soft: 65536\n        hard: 65536\n    healthcheck:',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'nofile:' },
    { type: 'content', file: 'docker-compose.yml', pattern: '65536' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'cli', 'ulimit_exceeded', 'IC-03', 'control'],
  rationale: 'Generous fd limit of 65536 — more than sufficient for any reasonable Node.js app',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-cli scenarios → ${outPath}`);
