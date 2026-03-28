#!/usr/bin/env bun
/**
 * Contention x CLI/Process scenario generator
 * Grid cell: J x 5
 * Shapes: JC-01 (port already in use), JC-02 (stale PID file), JC-03 (container name conflict)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent
 * processes. Two services binding the same port, stale PID files blocking startup,
 * or Docker container name conflicts between deploys.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency
 * at the configuration level across docker-compose.yml, Dockerfile, .env, config.json.
 *
 * Run: bun scripts/harvest/stage-contention-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');

// =============================================================================
// Shape JC-01: Port already in use — two services bind to same port
// Edits create state where multiple services or config files declare the same
// port, creating a bind conflict at runtime.
// =============================================================================

// JC-01a: Edit adds second service to docker-compose on same port as app
scenarios.push({
  id: nextId('port'),
  description: 'JC-01: Add worker service on port 3000 — same as app service',
  edits: [
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n\n  worker:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      - PORT=3000' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'worker:' },
    { type: 'content', file: 'docker-compose.yml', pattern: '"3000:3000"' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01'],
  rationale: 'Edit applies and content matches — but creates runtime port conflict (two services on 3000)',
});

// JC-01b: Edit changes .env PORT to 5432 — same as database port in config.json
scenarios.push({
  id: nextId('port'),
  description: 'JC-01: Edit .env PORT to 5432 — collides with database port in config.json',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=5432' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=5432' },
    { type: 'content', file: 'config.json', pattern: '"port": 5432' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01'],
  rationale: 'App port set to 5432 which is also the database port — port contention across services',
});

// JC-01c: Edit server.js to hardcode port 5432, predicate expects both app and db on 5432
scenarios.push({
  id: nextId('port'),
  description: 'JC-01: Edit server.js default port to 5432, config.json already declares DB on 5432',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 5432;' }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '|| 5432' },
    { type: 'content', file: 'config.json', pattern: '"port": 5432' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01'],
  rationale: 'Server defaults to 5432 which is the DB port — structural port collision detectable',
});

// JC-01d: Edit Dockerfile EXPOSE to different port than docker-compose maps
scenarios.push({
  id: nextId('port'),
  description: 'JC-01: Dockerfile EXPOSE 8080 but docker-compose still maps 3000',
  edits: [{ file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 8080' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=8080' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01'],
  rationale: 'Dockerfile exposes 8080 but docker-compose env still PORT=3000 — port mismatch contention',
});

// JC-01e: Two port mappings in docker-compose for same host port
scenarios.push({
  id: nextId('port'),
  description: 'JC-01: Edit adds explicit port mapping that conflicts with variable mapping',
  edits: [
    { file: 'docker-compose.yml', search: '      - "${VERIFY_HOST_PORT:-3000}:3000"', replace: '      - "${VERIFY_HOST_PORT:-3000}:3000"\n      - "3000:8080"' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '"3000:8080"' },
    { type: 'content', file: 'docker-compose.yml', pattern: ':-3000}:3000' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01'],
  rationale: 'Two mappings using host port 3000 — Docker will fail at runtime with port conflict',
});

// JC-01f: Control — services use different ports (no conflict)
scenarios.push({
  id: nextId('port'),
  description: 'JC-01 control: Add worker service on different port — no conflict',
  edits: [
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n\n  worker:\n    build: .\n    ports:\n      - "4000:4000"\n    environment:\n      - PORT=4000' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '"4000:4000"' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=4000' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'port_conflict', 'JC-01', 'control'],
  rationale: 'Worker on 4000, app on 3000 — different ports, no contention',
});

// =============================================================================
// Shape JC-02: PID file stale — process died but PID file remains
// Edits create state where config references a PID file or lock mechanism
// that would prevent a new process from starting.
// =============================================================================

// JC-02a: Edit adds pidFile to config, predicate expects process can start (but stale PID blocks)
scenarios.push({
  id: nextId('pid'),
  description: 'JC-02: Edit adds pidFile config, predicate expects both pidFile AND clean startup',
  edits: [
    { file: 'config.json', search: '"features": {', replace: '"pidFile": "/tmp/demo-app.pid",\n  "features": {' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"pidFile": "/tmp/demo-app.pid"' },
    { type: 'content', file: 'server.js', pattern: 'pidFile' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'cli', 'stale_pid', 'JC-02'],
  rationale: 'Config declares pidFile but server.js has no PID management code — stale PID would block startup',
});

// JC-02b: Edit adds lock file check to config, .env has no LOCK_DIR
scenarios.push({
  id: nextId('pid'),
  description: 'JC-02: Config declares lockDir, predicate expects LOCK_DIR in .env',
  edits: [
    { file: 'config.json', search: '"features": {', replace: '"lockDir": "/var/lock/demo",\n  "features": {' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"lockDir": "/var/lock/demo"' },
    { type: 'content', file: '.env', pattern: 'LOCK_DIR' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'cli', 'stale_pid', 'JC-02'],
  rationale: 'Config references lockDir but .env has no LOCK_DIR — process lock contention at startup',
});

// JC-02c: Edit adds restart: always to compose, predicate expects graceful shutdown in server.js
scenarios.push({
  id: nextId('pid'),
  description: 'JC-02: Edit adds restart policy to compose, predicate expects SIGTERM handling in server.js',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    restart: always\n    healthcheck:' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'restart: always' },
    { type: 'content', file: 'server.js', pattern: 'SIGTERM' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'cli', 'stale_pid', 'JC-02'],
  rationale: 'Restart policy added but server.js has no signal handler — zombie process on restart',
});

// JC-02d: Edit adds stop_grace_period, predicate expects stop_signal matches
scenarios.push({
  id: nextId('pid'),
  description: 'JC-02: Edit adds stop_grace_period but no stop_signal — default SIGTERM assumed',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:', replace: '    stop_grace_period: 5s\n    healthcheck:' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'stop_grace_period: 5s' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'stop_signal:' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'cli', 'stale_pid', 'JC-02'],
  rationale: 'Grace period set but no explicit stop_signal — process may not respond to default signal',
});

// JC-02e: Control — edit adds shutdown handling to both config and server reference
scenarios.push({
  id: nextId('pid'),
  description: 'JC-02 control: Edit adds graceful shutdown config, check only config',
  edits: [
    { file: 'config.json', search: '"features": {', replace: '"gracefulShutdownMs": 5000,\n  "features": {' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"gracefulShutdownMs": 5000' }],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'stale_pid', 'JC-02', 'control'],
  rationale: 'Single file edit, same file check — no PID/lock contention',
});

// =============================================================================
// Shape JC-03: Docker container name conflict — two services use same name
// Edits create docker-compose state where container names collide or services
// share identifiers that Docker requires to be unique.
// =============================================================================

// JC-03a: Edit adds container_name that matches another service
scenarios.push({
  id: nextId('name'),
  description: 'JC-03: Edit adds container_name "demo-app" to app service, then adds worker with same name',
  edits: [
    { file: 'docker-compose.yml', search: '  app:\n    build: .', replace: '  app:\n    container_name: demo-app\n    build: .' },
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n\n  worker:\n    container_name: demo-app\n    image: node:20-alpine\n    command: node worker.js' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'container_name: demo-app' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'worker:' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03'],
  rationale: 'Two services with same container_name — Docker will fail with name conflict at runtime',
});

// JC-03b: Edit changes app hostname to collide with potential db hostname
scenarios.push({
  id: nextId('name'),
  description: 'JC-03: Edit adds hostname "db" to app service — collides with standard DB service name',
  edits: [
    { file: 'docker-compose.yml', search: '  app:\n    build: .', replace: '  app:\n    hostname: db\n    build: .' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'hostname: db' },
    { type: 'content', file: 'docker-compose.test.yml', pattern: 'db:' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03'],
  rationale: 'App hostname "db" collides with db service in test compose — DNS resolution contention',
});

// JC-03c: Edit adds network alias that conflicts with service name
scenarios.push({
  id: nextId('name'),
  description: 'JC-03: Edit adds network alias "app" on a new worker service — same as existing service name',
  edits: [
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n\n  worker:\n    image: node:20-alpine\n    networks:\n      default:\n        aliases:\n          - app' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'aliases:' },
    { type: 'content', file: 'docker-compose.yml', pattern: '- app' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03'],
  rationale: 'Worker network alias "app" conflicts with app service name — Docker DNS contention',
});

// JC-03d: Two Dockerfile stages with same name
scenarios.push({
  id: nextId('name'),
  description: 'JC-03: Edit adds multi-stage build with duplicate stage name "builder"',
  edits: [
    { file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:20-alpine AS builder\nRUN echo "stage 1"\n\nFROM node:20-alpine AS builder' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'AS builder' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03'],
  rationale: 'Two Dockerfile stages named "builder" — later stage overwrites first, creating ambiguity',
});

// JC-03e: Edit adds volume name that collides with service name
scenarios.push({
  id: nextId('name'),
  description: 'JC-03: Edit adds named volume "app" — same as service name',
  edits: [
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n    volumes:\n      - app:/data\n\nvolumes:\n  app:' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'volumes:' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'app:/data' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03'],
  rationale: 'Volume named "app" same as service name — namespace contention in Docker',
});

// JC-03f: Control — services with unique names (no conflict)
scenarios.push({
  id: nextId('name'),
  description: 'JC-03 control: Two services with unique container names',
  edits: [
    { file: 'docker-compose.yml', search: '  app:\n    build: .', replace: '  app:\n    container_name: demo-web\n    build: .' },
    { file: 'docker-compose.yml', search: '      retries: 3', replace: '      retries: 3\n\n  worker:\n    container_name: demo-worker\n    image: node:20-alpine\n    command: node worker.js' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'container_name: demo-web' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'container_name: demo-worker' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'cli', 'container_name', 'JC-03', 'control'],
  rationale: 'Unique container names — no naming contention',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-cli scenarios -> ${outPath}`);
