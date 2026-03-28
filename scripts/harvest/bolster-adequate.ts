#!/usr/bin/env bun
/**
 * Operation Bolster — Adequate Tier
 * Expands all 16-29 count fixture files to 30+ scenarios.
 *
 * Uses parametric expansion against demo-app fixtures.
 * Idempotent: strips previous bolster output before regenerating.
 *
 * Run: bun scripts/harvest/bolster-adequate.ts
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const fixtureDir = resolve('fixtures/scenarios');
const demoDir = resolve('fixtures/demo-app');

const serverJs = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configJson = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envFile = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfile = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const compose = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSql = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

interface Scenario {
  id: string;
  [key: string]: any;
}

function loadFixture(name: string): Scenario[] {
  const path = resolve(fixtureDir, `${name}-staged.json`);
  try {
    const all: Scenario[] = JSON.parse(readFileSync(path, 'utf-8'));
    return all.filter(s => !String(s.id).includes('-bolster-'));
  } catch {
    return [];
  }
}

function saveFixture(name: string, scenarios: Scenario[]) {
  const path = resolve(fixtureDir, `${name}-staged.json`);
  writeFileSync(path, JSON.stringify(scenarios, null, 2));
  console.log(`  ${name}: ${scenarios.length} scenarios`);
}

function makeId(prefix: string, existing: Set<string>, n: number): string {
  let id: string;
  do {
    id = `${prefix}-bolster-${String(n).padStart(3, '0')}`;
    n++;
  } while (existing.has(id));
  existing.add(id);
  return id;
}

// =============================================================================
// Cross-file consistency templates — parametric shapes for any cell
// =============================================================================

// File pairs for cross-file checks
const FILE_PAIRS: Array<{ fileA: string; fileB: string; patternA: string; patternB: string; desc: string }> = [
  { fileA: 'server.js', fileB: 'config.json', patternA: '3000', patternB: 'port', desc: 'port reference' },
  { fileA: 'server.js', fileB: '.env', patternA: 'http.createServer', patternB: 'PORT', desc: 'server config' },
  { fileA: 'server.js', fileB: 'init.sql', patternA: 'api/items', patternB: 'CREATE TABLE', desc: 'API→DB reference' },
  { fileA: 'server.js', fileB: 'Dockerfile', patternA: 'listen', patternB: 'EXPOSE', desc: 'listen→expose' },
  { fileA: 'server.js', fileB: 'docker-compose.yml', patternA: 'health', patternB: 'healthcheck', desc: 'health endpoint' },
  { fileA: 'config.json', fileB: '.env', patternA: 'database', patternB: 'DATABASE_URL', desc: 'DB config sync' },
  { fileA: 'config.json', fileB: 'docker-compose.yml', patternA: 'port', patternB: '3000', desc: 'config→compose port' },
  { fileA: '.env', fileB: 'Dockerfile', patternA: 'NODE_ENV', patternB: 'ENV', desc: 'env→dockerfile' },
  { fileA: '.env', fileB: 'docker-compose.yml', patternA: 'PORT', patternB: 'ports', desc: 'env→compose ports' },
  { fileA: 'init.sql', fileB: 'server.js', patternA: 'users', patternB: 'items', desc: 'table→API' },
  { fileA: 'init.sql', fileB: 'config.json', patternA: 'sessions', patternB: 'database', desc: 'table→config' },
  { fileA: 'Dockerfile', fileB: 'docker-compose.yml', patternA: 'EXPOSE', patternB: 'ports', desc: 'expose→ports' },
  { fileA: 'server.js', fileB: 'config.json', patternA: '/health', patternB: 'healthCheck', desc: 'health in config' },
  { fileA: 'server.js', fileB: 'config.json', patternA: '/api/echo', patternB: 'echo', desc: 'echo endpoint ref' },
  { fileA: 'init.sql', fileB: '.env', patternA: 'posts', patternB: 'POSTS', desc: 'posts table→env' },
];

// Edits that create cross-file inconsistencies
const EDIT_TEMPLATES: Array<{ file: string; search: string; replace: string; desc: string; checkFile: string; checkPattern: string; pass: boolean }> = [
  // server.js edits
  { file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Omega' }", desc: 'Rename Alpha to Omega', checkFile: 'config.json', checkPattern: 'Omega', pass: false },
  { file: 'server.js', search: "{ id: 2, name: 'Beta' }", replace: "{ id: 2, name: 'Zeta' }", desc: 'Rename Beta to Zeta', checkFile: '.env', checkPattern: 'Zeta', pass: false },
  { file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'healthy', uptime: 99 }", desc: 'Expand health response', checkFile: 'Dockerfile', checkPattern: 'uptime', pass: false },
  { file: 'server.js', search: "res.end('Not Found');", replace: "res.end(JSON.stringify({error:'not_found'}));", desc: 'JSON error response', checkFile: 'config.json', checkPattern: 'not_found', pass: false },
  { file: 'server.js', search: "'Content-Type': 'application/json'", replace: "'Content-Type': 'application/json', 'X-Version': '2.0'", desc: 'Add version header', checkFile: '.env', checkPattern: 'X-Version', pass: false },
  // config.json edits
  { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false', desc: 'Disable dark mode', checkFile: 'server.js', checkPattern: 'darkMode', pass: false },
  { file: 'config.json', search: '"port": 5432', replace: '"port": 5433', desc: 'Change DB port', checkFile: 'docker-compose.yml', checkPattern: '5433', pass: false },
  { file: 'config.json', search: '"maxRetries": 3', replace: '"maxRetries": 10', desc: 'Increase retries', checkFile: 'server.js', checkPattern: 'maxRetries', pass: false },
  // .env edits
  { file: '.env', search: 'PORT=3000', replace: 'PORT=9090', desc: 'Change port to 9090', checkFile: 'server.js', checkPattern: '9090', pass: false },
  { file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=staging', desc: 'Switch to staging', checkFile: 'config.json', checkPattern: 'staging', pass: false },
  { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="super-secret-2026"', desc: 'Rotate secret key', checkFile: 'docker-compose.yml', checkPattern: 'super-secret', pass: false },
  { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true', desc: 'Enable debug', checkFile: 'server.js', checkPattern: 'DEBUG', pass: false },
  // init.sql edits
  { file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,', desc: 'Add avatar_url column', checkFile: 'server.js', checkPattern: 'avatar_url', pass: false },
  { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count BIGINT DEFAULT 0,', desc: 'Change view_count to BIGINT', checkFile: 'config.json', checkPattern: 'BIGINT', pass: false },
  // Dockerfile edits
  { file: 'Dockerfile', search: 'FROM node:18-slim', replace: 'FROM node:20-slim', desc: 'Upgrade to node 20', checkFile: 'config.json', checkPattern: 'node:20', pass: false },
  { file: 'Dockerfile', search: 'WORKDIR /app', replace: 'WORKDIR /srv', desc: 'Change workdir to /srv', checkFile: 'docker-compose.yml', checkPattern: '/srv', pass: false },
  // docker-compose.yml edits
  { file: 'docker-compose.yml', search: '"3000:3000"', replace: '"8080:3000"', desc: 'Remap to port 8080', checkFile: 'server.js', checkPattern: '8080', pass: false },
  { file: 'docker-compose.yml', search: 'restart: unless-stopped', replace: 'restart: always', desc: 'Change restart policy', checkFile: 'Dockerfile', checkPattern: 'restart', pass: false },
  // Controls (pass: true)
  { file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Phoenix' }", desc: 'Rename Alpha, check server.js', checkFile: 'server.js', checkPattern: 'Phoenix', pass: true },
  { file: '.env', search: 'PORT=3000', replace: 'PORT=7777', desc: 'Change port, check .env', checkFile: '.env', checkPattern: '7777', pass: true },
  { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0,\n    slug VARCHAR(200),', desc: 'Add slug, check init.sql', checkFile: 'init.sql', checkPattern: 'slug', pass: true },
  { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": true, "theme": "ocean"', desc: 'Add theme, check config', checkFile: 'config.json', checkPattern: 'ocean', pass: true },
];

// =============================================================================
// Shape-specific bolster functions for cells that need domain-specific expansion
// =============================================================================

function bolsterAccessFamily(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  // Access scenarios: permission/visibility checks across files
  const accessChecks = [
    { desc: 'Admin route in server.js, no admin role in config.json', edit: { file: 'server.js', search: "if (req.url === '/api/items')", replace: "if (req.url === '/admin') { res.writeHead(200); res.end('admin panel'); return; }\n\n  if (req.url === '/api/items')" }, pred: { type: 'content', file: 'config.json', pattern: 'admin' }, pass: false },
    { desc: 'Auth token check in server.js, no token in .env', edit: { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "function checkToken(req) { return req.headers['x-token'] === process.env.API_TOKEN; }\nconst server = http.createServer((req, res) => {" }, pred: { type: 'content', file: '.env', pattern: 'API_TOKEN' }, pass: false },
    { desc: 'Rate limit function added, no limit in config.json', edit: { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const rateLimits = new Map();\nconst server = http.createServer((req, res) => {" }, pred: { type: 'content', file: 'config.json', pattern: 'rateLimit' }, pass: false },
    { desc: 'Session table in init.sql, no session config in .env', pred: { type: 'content', file: '.env', pattern: 'SESSION_SECRET' }, pass: false },
    { desc: 'CORS header added, no CORS config in .env', edit: { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const server = http.createServer((req, res) => {\n  res.setHeader('Access-Control-Allow-Origin', 'https://example.com');" }, pred: { type: 'content', file: '.env', pattern: 'CORS_ORIGIN' }, pass: false },
    { desc: 'CSP header added, not in config.json', edit: { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const server = http.createServer((req, res) => {\n  res.setHeader('Content-Security-Policy', \"default-src 'self'\");" }, pred: { type: 'content', file: 'config.json', pattern: 'Content-Security-Policy' }, pass: false },
    { desc: 'Password hash in init.sql, no hash algo in config', pred: { type: 'content', file: 'config.json', pattern: 'bcrypt' }, pass: false },
    { desc: 'Control: server.js has /health, check it exists', pred: { type: 'content', file: 'server.js', pattern: '/health' }, pass: true },
    { desc: 'Control: init.sql has sessions table', pred: { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE sessions' }, pass: true },
    { desc: 'Control: .env has SECRET_KEY', pred: { type: 'content', file: '.env', pattern: 'SECRET_KEY' }, pass: true },
    { desc: 'Dockerfile exposes port, check Dockerfile', pred: { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE' }, pass: true },
    { desc: 'Compose has env_file, check compose', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'env_file' }, pass: true },
    { desc: 'User table has password_hash, server.js has no bcrypt', pred: { type: 'content', file: 'server.js', pattern: 'bcrypt' }, pass: false },
    { desc: 'Sessions table has expires_at, server.js has no expiry check', pred: { type: 'content', file: 'server.js', pattern: 'expires_at' }, pass: false },
    { desc: 'Init.sql creates index, server.js has no index reference', pred: { type: 'content', file: 'server.js', pattern: 'idx_' }, pass: false },
  ];

  const capTag = name.split('-')[0]; // access, etc.
  const subTag = name.split('-')[1]; // browser, cli, etc.

  for (let i = 0; i < needed && i < accessChecks.length; i++) {
    const ac = accessChecks[i];
    existing.push({
      id: makeId(capTag.slice(0, 2), ids, n++),
      description: `${capTag}-${subTag}: ${ac.desc}`,
      edits: ac.edit ? [ac.edit] : [],
      predicates: [ac.pred],
      expectedSuccess: ac.pass,
      tags: [capTag, subTag, ac.pass ? 'control' : 'cross_file_gap'],
      rationale: ac.desc,
    });
  }

  saveFixture(name, existing);
}

function bolsterContentionFamily(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  const contentionChecks = [
    { desc: 'Two edits to server.js, second overwrites first', edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'First' }" }, { file: 'server.js', search: "{ id: 1, name: 'First' }", replace: "{ id: 1, name: 'Second' }" }], pred: { type: 'content', file: 'server.js', pattern: 'First' }, pass: false },
    { desc: 'Edit server.js and config.json with conflicting ports', edits: [{ file: 'server.js', search: "server.listen(port", replace: "server.listen(8080" }, { file: 'config.json', search: '"port": 5432', replace: '"port": 9090' }], pred: { type: 'content', file: 'config.json', pattern: '8080' }, pass: false },
    { desc: 'Edit .env and compose with different ports', edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=5000' }, { file: 'docker-compose.yml', search: '"3000:3000"', replace: '"6000:3000"' }], pred: { type: 'content', file: '.env', pattern: '6000' }, pass: false },
    { desc: 'Two migrations on same table', config: { migrations: [{ name: 'm1', sql: 'ALTER TABLE users ADD COLUMN bio TEXT;' }, { name: 'm2', sql: 'ALTER TABLE users DROP COLUMN bio;' }] }, pred: { type: 'content', file: 'init.sql', pattern: 'bio' }, pass: false },
    { desc: 'Edit init.sql and server.js with mismatched column names', edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email_address VARCHAR(255) NOT NULL,' }], pred: { type: 'content', file: 'server.js', pattern: 'email_address' }, pass: false },
    { desc: 'Compose restart policy conflicts with Dockerfile CMD', edits: [{ file: 'docker-compose.yml', search: 'restart: unless-stopped', replace: 'restart: "no"' }], pred: { type: 'content', file: 'Dockerfile', pattern: 'restart' }, pass: false },
    { desc: 'Edit both health endpoint and healthcheck with different paths', edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/healthz'" }], pred: { type: 'content', file: 'Dockerfile', pattern: '/healthz' }, pass: false },
    { desc: 'Config.json and .env disagree on debug', edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"debug": true' }, { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false' }], pred: { type: 'content', file: '.env', pattern: '"debug": true' }, pass: false },
    { desc: 'Control: single edit, consistent check', edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Gamma' }" }], pred: { type: 'content', file: 'server.js', pattern: 'Gamma' }, pass: true },
    { desc: 'Control: edit .env, check .env', edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4444' }], pred: { type: 'content', file: '.env', pattern: '4444' }, pass: true },
    { desc: 'Control: edit config.json, check config.json', edits: [{ file: 'config.json', search: '"maxRetries": 3', replace: '"maxRetries": 5' }], pred: { type: 'content', file: 'config.json', pattern: '"maxRetries": 5' }, pass: true },
    { desc: 'Two edits to different routes, check both present', edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'One' }" }, { file: 'server.js', search: "{ id: 2, name: 'Beta' }", replace: "{ id: 2, name: 'Two' }" }], pred: { type: 'content', file: 'server.js', pattern: 'One' }, pass: true },
    { desc: 'Migration adds column that server.js doesnt reference', config: { migrations: [{ name: 'add_col', sql: 'ALTER TABLE posts ADD COLUMN metadata JSONB;' }] }, pred: { type: 'content', file: 'server.js', pattern: 'metadata' }, pass: false },
    { desc: 'Concurrent healthcheck: compose and Dockerfile both define, check agreement', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' }, pass: true },
  ];

  const capTag = name.split('-')[0];
  const subTag = name.split('-')[1];

  for (let i = 0; i < needed && i < contentionChecks.length; i++) {
    const cc = contentionChecks[i];
    existing.push({
      id: makeId(capTag.slice(0, 2), ids, n++),
      description: `${capTag}-${subTag}: ${cc.desc}`,
      edits: cc.edits || [],
      predicates: [cc.pred],
      ...(cc.config ? { config: cc.config } : {}),
      expectedSuccess: cc.pass,
      tags: [capTag, subTag, cc.pass ? 'control' : 'contention_gap'],
      rationale: cc.desc,
    });
  }

  saveFixture(name, existing);
}

function bolsterGeneric(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  // Derive prefix from name
  const prefix = name.split('-').map(w => w[0]).join('');

  // Use a mix of cross-file checks and edit-based checks
  let added = 0;

  // Phase 1: Cross-file predicate checks (no edits)
  for (const fp of FILE_PAIRS) {
    if (added >= needed) break;
    existing.push({
      id: makeId(prefix, ids, n++),
      description: `Cross-file: ${fp.fileA} ${fp.desc} vs ${fp.fileB}`,
      edits: [],
      predicates: [{ type: 'content', file: fp.fileB, pattern: fp.patternA }],
      expectedSuccess: false,
      tags: [name.split('-')[0], name.split('-')[1] || 'general', 'cross_file'],
      rationale: `${fp.fileA} references ${fp.patternA} but ${fp.fileB} has no such reference`,
    });
    added++;
  }

  // Phase 2: Edit-based inconsistency checks
  for (const et of EDIT_TEMPLATES) {
    if (added >= needed) break;
    existing.push({
      id: makeId(prefix, ids, n++),
      description: `Edit ${et.file}: ${et.desc}`,
      edits: [{ file: et.file, search: et.search, replace: et.replace }],
      predicates: [{ type: 'content', file: et.checkFile, pattern: et.checkPattern }],
      expectedSuccess: et.pass,
      tags: [name.split('-')[0], name.split('-')[1] || 'general', et.pass ? 'control' : 'edit_gap'],
      rationale: et.desc,
    });
    added++;
  }

  saveFixture(name, existing);
}

// =============================================================================
// Targeted bolster for specific file families
// =============================================================================

function bolsterStateFamily(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  const stateChecks = [
    { desc: 'Assume server.js has /api/users route — it doesnt', pred: { type: 'content', file: 'server.js', pattern: '/api/users' }, pass: false },
    { desc: 'Assume config.json has redis section — it doesnt', pred: { type: 'content', file: 'config.json', pattern: 'redis' }, pass: false },
    { desc: 'Assume .env has REDIS_URL — it doesnt', pred: { type: 'content', file: '.env', pattern: 'REDIS_URL' }, pass: false },
    { desc: 'Assume init.sql has products table — it doesnt', pred: { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE products' }, pass: false },
    { desc: 'Assume Dockerfile has multi-stage build — it doesnt', pred: { type: 'content', file: 'Dockerfile', pattern: 'FROM.*AS' }, pass: false },
    { desc: 'Assume compose has redis service — it doesnt', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'redis:' }, pass: false },
    { desc: 'Assume server.js uses express — it uses http', pred: { type: 'content', file: 'server.js', pattern: 'require.*express' }, pass: false },
    { desc: 'Assume config.json has logging config — it doesnt', pred: { type: 'content', file: 'config.json', pattern: '"logging"' }, pass: false },
    { desc: 'Edit adds /api/users, predicate checks wrong file', edit: { file: 'server.js', search: "if (req.url === '/api/items')", replace: "if (req.url === '/api/users') { res.writeHead(200); res.end('[]'); return; }\n  if (req.url === '/api/items')" }, pred: { type: 'content', file: 'config.json', pattern: '/api/users' }, pass: false },
    { desc: 'Edit .env port, check wrong file', edit: { file: '.env', search: 'PORT=3000', replace: 'PORT=5555' }, pred: { type: 'content', file: 'server.js', pattern: '5555' }, pass: false },
    { desc: 'Control: server.js has /health', pred: { type: 'content', file: 'server.js', pattern: '/health' }, pass: true },
    { desc: 'Control: init.sql has users table', pred: { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE users' }, pass: true },
    { desc: 'Control: compose has healthcheck', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' }, pass: true },
    { desc: 'Control: .env has DATABASE_URL', pred: { type: 'content', file: '.env', pattern: 'DATABASE_URL' }, pass: true },
  ];

  const capTag = name.split('-')[0];
  const subTag = name.split('-')[1];

  for (let i = 0; i < needed && i < stateChecks.length; i++) {
    const sc = stateChecks[i];
    existing.push({
      id: makeId(capTag.slice(0, 2), ids, n++),
      description: `${capTag}-${subTag}: ${sc.desc}`,
      edits: sc.edit ? [sc.edit] : [],
      predicates: [sc.pred],
      expectedSuccess: sc.pass,
      tags: [capTag, subTag, sc.pass ? 'control' : 'state_assumption'],
      rationale: sc.desc,
    });
  }

  saveFixture(name, existing);
}

function bolsterPropagationFamily(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  const propagationChecks = [
    { desc: 'Add column to init.sql, server.js unaware', edit: { file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),' }, pred: { type: 'content', file: 'server.js', pattern: 'phone' }, pass: false },
    { desc: 'Change .env port, compose not updated', edit: { file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }, pred: { type: 'content', file: 'docker-compose.yml', pattern: '4000:' }, pass: false },
    { desc: 'Change config.json feature flag, server.js not updated', edit: { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false, "newFeature": true' }, pred: { type: 'content', file: 'server.js', pattern: 'newFeature' }, pass: false },
    { desc: 'Rename column in init.sql, server.js uses old name', edit: { file: 'init.sql', search: 'password_hash TEXT NOT NULL,', replace: 'password_digest TEXT NOT NULL,' }, pred: { type: 'content', file: 'server.js', pattern: 'password_digest' }, pass: false },
    { desc: 'Add env var to .env, Dockerfile has no matching ENV', edit: { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nAPI_VERSION=v2' }, pred: { type: 'content', file: 'Dockerfile', pattern: 'API_VERSION' }, pass: false },
    { desc: 'Change Dockerfile node version, compose image tag unchanged', edit: { file: 'Dockerfile', search: 'FROM node:18-slim', replace: 'FROM node:20-slim' }, pred: { type: 'content', file: 'docker-compose.yml', pattern: 'node:20' }, pass: false },
    { desc: 'Add migration column, config.json has no reference', config: { migrations: [{ name: 'add_col', sql: 'ALTER TABLE users ADD COLUMN avatar TEXT;' }] }, pred: { type: 'content', file: 'config.json', pattern: 'avatar' }, pass: false },
    { desc: 'Change health response, Dockerfile healthcheck unchanged', edit: { file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ready' }" }, pred: { type: 'content', file: 'server.js', pattern: "status: 'ok'" }, pass: false },
    { desc: 'Control: edit server.js, check server.js', edit: { file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Gamma' }" }, pred: { type: 'content', file: 'server.js', pattern: 'Gamma' }, pass: true },
    { desc: 'Control: edit .env, check .env', edit: { file: '.env', search: 'PORT=3000', replace: 'PORT=7777' }, pred: { type: 'content', file: '.env', pattern: '7777' }, pass: true },
    { desc: 'Control: init.sql has users table', pred: { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE users' }, pass: true },
    { desc: 'Add table to init.sql, server.js has no API for it', edit: { file: 'init.sql', search: 'CREATE TABLE sessions', replace: 'CREATE TABLE tags (\n    id SERIAL PRIMARY KEY,\n    name VARCHAR(50)\n);\n\nCREATE TABLE sessions' }, pred: { type: 'content', file: 'server.js', pattern: 'tags' }, pass: false },
    { desc: 'Change compose service name, Dockerfile unchanged', edit: { file: 'docker-compose.yml', search: '  app:', replace: '  webserver:' }, pred: { type: 'content', file: 'Dockerfile', pattern: 'webserver' }, pass: false },
    { desc: 'Control: compose has app service', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'app:' }, pass: true },
  ];

  const capTag = name.split('-')[0];
  const subTag = name.split('-')[1];

  for (let i = 0; i < needed && i < propagationChecks.length; i++) {
    const pc = propagationChecks[i];
    existing.push({
      id: makeId(capTag.slice(0, 2), ids, n++),
      description: `${capTag}-${subTag}: ${pc.desc}`,
      edits: pc.edit ? [pc.edit] : [],
      predicates: [pc.pred],
      ...(pc.config ? { config: pc.config } : {}),
      expectedSuccess: pc.pass,
      tags: [capTag, subTag, pc.pass ? 'control' : 'propagation_gap'],
      rationale: pc.desc,
    });
  }

  saveFixture(name, existing);
}

function bolsterTemporalFamily(name: string) {
  const existing = loadFixture(name);
  const ids = new Set(existing.map(s => s.id));
  let n = 200;
  const needed = 30 - existing.length;
  if (needed <= 0) return;

  const temporalChecks = [
    { desc: 'Edit server.js health, config.json has stale health config', edit: { file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'up', version: '2.1' }" }, pred: { type: 'content', file: 'config.json', pattern: 'version' }, pass: false },
    { desc: 'Edit .env SECRET_KEY, server.js still uses old reference', edit: { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotated-2026"' }, pred: { type: 'content', file: 'server.js', pattern: 'rotated-2026' }, pass: false },
    { desc: 'Upgrade Dockerfile node version, .env unchanged', edit: { file: 'Dockerfile', search: 'FROM node:18-slim', replace: 'FROM node:20-slim' }, pred: { type: 'content', file: '.env', pattern: 'NODE_VERSION' }, pass: false },
    { desc: 'Change compose port mapping, server.js listen unchanged', edit: { file: 'docker-compose.yml', search: '"3000:3000"', replace: '"9090:3000"' }, pred: { type: 'content', file: 'server.js', pattern: '9090' }, pass: false },
    { desc: 'Add column via migration, server.js has no query for it', config: { migrations: [{ name: 'add_col', sql: 'ALTER TABLE users ADD COLUMN nickname VARCHAR(50);' }] }, pred: { type: 'content', file: 'server.js', pattern: 'nickname' }, pass: false },
    { desc: 'Edit init.sql table, config.json has stale DB config', edit: { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0,\n    published_at TIMESTAMP,' }, pred: { type: 'content', file: 'config.json', pattern: 'published_at' }, pass: false },
    { desc: 'Compose env_file changed, .env filename unchanged', edit: { file: 'docker-compose.yml', search: 'env_file: .env', replace: 'env_file: .env.production' }, pred: { type: 'content', file: '.env', pattern: '.env.production' }, pass: false },
    { desc: 'Add CORS header, config.json has no CORS config', edit: { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: "const server = http.createServer((req, res) => {\n  res.setHeader('Access-Control-Allow-Origin', '*');" }, pred: { type: 'content', file: 'config.json', pattern: 'CORS' }, pass: false },
    { desc: 'Control: edit server.js, verify change', edit: { file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Delta' }" }, pred: { type: 'content', file: 'server.js', pattern: 'Delta' }, pass: true },
    { desc: 'Control: edit .env, verify change', edit: { file: '.env', search: 'PORT=3000', replace: 'PORT=6666' }, pred: { type: 'content', file: '.env', pattern: '6666' }, pass: true },
    { desc: 'Control: Dockerfile has EXPOSE', pred: { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE' }, pass: true },
    { desc: 'Control: compose has healthcheck', pred: { type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' }, pass: true },
    { desc: 'Change healthcheck interval, server.js has no interval awareness', edit: { file: 'docker-compose.yml', search: 'interval: 5s', replace: 'interval: 30s' }, pred: { type: 'content', file: 'server.js', pattern: 'interval' }, pass: false },
    { desc: 'Add NOT NULL constraint, server.js has no validation', config: { migrations: [{ name: 'add_constraint', sql: 'ALTER TABLE posts ALTER COLUMN title SET NOT NULL;' }] }, pred: { type: 'content', file: 'server.js', pattern: 'NOT NULL' }, pass: false },
  ];

  const capTag = name.split('-')[0];
  const subTag = name.split('-')[1];

  for (let i = 0; i < needed && i < temporalChecks.length; i++) {
    const tc = temporalChecks[i];
    existing.push({
      id: makeId(capTag.slice(0, 2), ids, n++),
      description: `${capTag}-${subTag}: ${tc.desc}`,
      edits: tc.edit ? [tc.edit] : [],
      predicates: [tc.pred],
      ...(tc.config ? { config: tc.config } : {}),
      expectedSuccess: tc.pass,
      tags: [capTag, subTag, tc.pass ? 'control' : 'temporal_gap'],
      rationale: tc.desc,
    });
  }

  saveFixture(name, existing);
}

// =============================================================================
// Main execution
// =============================================================================

console.log('=== Operation Bolster: Adequate Tier ===\n');

// Files that need expansion, grouped by family
const accessFiles = ['access-browser', 'access-cli', 'access-db', 'access-http', 'access-fs'];
const contentionFiles = ['contention-db', 'contention-browser', 'contention-cli', 'contention-http', 'contention-verify', 'contention-config', 'contention-fs', 'contention-multistep'];
const stateFiles = ['state-fs', 'state-http', 'state-multistep', 'state-db', 'state-config'];
const propagationFiles = ['propagation-db', 'propagation-multistep', 'propagation-cli', 'propagation-config'];
const temporalFiles = ['temporal-config', 'temporal-verify', 'temporal-multistep'];
const genericFiles = ['g5', 'serialization', 'infrastructure', 'security', 'config', 'filesystem', 'k5', 'capacity-cli', 'capacity-fs'];

for (const f of accessFiles) bolsterAccessFamily(f);
for (const f of contentionFiles) bolsterContentionFamily(f);
for (const f of stateFiles) bolsterStateFamily(f);
for (const f of propagationFiles) bolsterPropagationFamily(f);
for (const f of temporalFiles) bolsterTemporalFamily(f);
for (const f of genericFiles) bolsterGeneric(f);

// Summary
console.log('\n=== Summary ===');
const allFiles = readdirSync(fixtureDir).filter(f => f.endsWith('-staged.json') && !f.startsWith('wpt-'));
let nonWptTotal = 0;
let belowThirty = 0;
for (const f of allFiles) {
  const count = JSON.parse(readFileSync(resolve(fixtureDir, f), 'utf-8')).length;
  nonWptTotal += count;
  if (count < 30) belowThirty++;
}
const wptFiles = readdirSync(fixtureDir).filter(f => f.startsWith('wpt-') && f.endsWith('-staged.json'));
let wptTotal = 0;
for (const f of wptFiles) {
  wptTotal += JSON.parse(readFileSync(resolve(fixtureDir, f), 'utf-8')).length;
}
console.log(`Non-WPT total: ${nonWptTotal}`);
console.log(`Files below 30: ${belowThirty}/${allFiles.length}`);
console.log(`Grand total (with WPT): ${nonWptTotal + wptTotal}`);
