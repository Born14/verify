#!/usr/bin/env bun
/**
 * Contention x HTTP scenario generator
 * Grid cell: J x 2
 * Shapes: JH-01 (two routes register same path), JH-02 (session ID collision between concurrent users), JH-03 (concurrent API writes to same resource)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent actors
 * at the HTTP layer. Two deploys registering the same route, two sessions using the
 * same token, two API writes targeting the same resource — all produce inconsistent
 * HTTP behavior that a single-actor test would miss.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jh-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape JH-01: Two routes register same path — concurrent deploys create duplicates
// Both edits add a route handler for the same URL path, producing ambiguous dispatch.
// =============================================================================

// JH-01a: Two edits both add a /status route with different responses
scenarios.push({
  id: nextId('route'),
  description: 'JH-01: Two edits both add /status route with different response bodies',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "if (req.url === '/status') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ service: 'alpha' }));\n    return;\n  }\n\n  if (req.url === '/health') {" },
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "if (req.url === '/status') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ service: 'beta' }));\n    return;\n  }\n\n  if (req.url === '/health') {" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: "service: 'beta'" }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'route_collision', 'JH-01'],
  rationale: 'Second edit search string gone after first edit — both try to add /status before /health',
});

// JH-01b: Two edits both rewrite /api/items with different data shapes
scenarios.push({
  id: nextId('route'),
  description: 'JH-01: Two edits both rewrite /api/items endpoint with different schemas',
  edits: [
    { file: 'server.js', search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha', priority: 'high' },\n    ]));" },
    { file: 'server.js', search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "res.end(JSON.stringify({ items: ['Alpha', 'Beta'], count: 2 }));" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'count: 2' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'route_collision', 'JH-01'],
  rationale: 'Both edits target same /api/items response — first edit changes shape, second search gone',
});

// JH-01c: Two edits both add /api/users at same insertion point
scenarios.push({
  id: nextId('route'),
  description: 'JH-01: Two edits both insert /api/users handler before /about route',
  edits: [
    { file: 'server.js', search: "if (req.url === '/about') {", replace: "if (req.url === '/api/users') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([{ id: 1, name: 'Admin' }]));\n    return;\n  }\n\n  if (req.url === '/about') {" },
    { file: 'server.js', search: "if (req.url === '/about') {", replace: "if (req.url === '/api/users') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ users: [] }));\n    return;\n  }\n\n  if (req.url === '/about') {" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'users: []' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'route_collision', 'JH-01'],
  rationale: 'Both edits insert before /about — second edit search gone after first edit transforms the line',
});

// JH-01d: Two edits both change /health response format
scenarios.push({
  id: nextId('route'),
  description: 'JH-01: Two edits change /health to return different response formats',
  edits: [
    { file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ healthy: true, uptime: process.uptime() }));" },
    { file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end('OK');" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: "res.end('OK')" }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'route_collision', 'JH-01'],
  rationale: 'Both edits target same health response line — second search gone after first rewrites it',
});

// JH-01e: Two edits both change the healthcheck URL in docker-compose
scenarios.push({
  id: nextId('route'),
  description: 'JH-01: Two edits both change healthcheck URL in docker-compose.yml',
  edits: [
    { file: 'docker-compose.yml', search: 'test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]', replace: 'test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/ready"]' },
    { file: 'docker-compose.yml', search: 'test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]', replace: 'test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]' },
  ],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '/healthz' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'route_collision', 'JH-01'],
  rationale: 'Both edits target same healthcheck test line — second search string gone after first edit',
});

// JH-01f: Control — two edits add different routes at different insertion points
scenarios.push({
  id: nextId('route'),
  description: 'JH-01 control: Two edits add different routes at different insertion points (no collision)',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "if (req.url === '/ping') {\n    res.writeHead(200);\n    res.end('pong');\n    return;\n  }\n\n  if (req.url === '/health') {" },
    { file: 'server.js', search: "if (req.url === '/about') {", replace: "if (req.url === '/version') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ version: '1.0.0' }));\n    return;\n  }\n\n  if (req.url === '/about') {" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "res.end('pong')" },
    { type: 'content', file: 'server.js', pattern: "version: '1.0.0'" },
  ],
  expectedSuccess: true,
  tags: ['contention', 'http', 'route_collision', 'JH-01', 'control'],
  rationale: 'Routes inserted at different points — no collision, both apply cleanly',
});

// =============================================================================
// Shape JH-02: Session ID collision between concurrent users
// Two edits create session handling with the same session key/token name, or
// hardcoded session IDs that would collide in a concurrent environment.
// =============================================================================

// JH-02a: Two edits both add session middleware with same cookie name but different secrets
scenarios.push({
  id: nextId('sess'),
  description: 'JH-02: Two edits both add session cookie parsing with same cookie name, different secrets',
  edits: [
    { file: 'server.js', search: 'const server = http.createServer((req, res) => {', replace: "const SESSION_SECRET = 'alpha-secret-2026';\nconst COOKIE_NAME = 'sid';\n\nconst server = http.createServer((req, res) => {" },
    { file: 'server.js', search: 'const server = http.createServer((req, res) => {', replace: "const SESSION_SECRET = 'beta-secret-2026';\nconst COOKIE_NAME = 'sid';\n\nconst server = http.createServer((req, res) => {" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'beta-secret-2026' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'session_collision', 'JH-02'],
  rationale: 'Both edits target same insertion point with same cookie name but different secrets — collision',
});

// JH-02b: Two edits add hardcoded auth token in .env with same key, different values
scenarios.push({
  id: nextId('sess'),
  description: 'JH-02: Two edits both add API_TOKEN to .env with different values',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nAPI_TOKEN="token-alpha-abc123"' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nAPI_TOKEN="token-beta-xyz789"' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'token-beta-xyz789' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'session_collision', 'JH-02'],
  rationale: 'Both edits append after DEBUG=false — second search gone after first edit adds token-alpha',
});

// JH-02c: Two edits both set session token column in init.sql with different types
scenarios.push({
  id: nextId('sess'),
  description: 'JH-02: Two edits both change sessions.token column type',
  edits: [
    { file: 'init.sql', search: '    token TEXT NOT NULL UNIQUE,', replace: '    token VARCHAR(512) NOT NULL UNIQUE,' },
    { file: 'init.sql', search: '    token TEXT NOT NULL UNIQUE,', replace: '    token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'token UUID NOT NULL UNIQUE' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'session_collision', 'JH-02'],
  rationale: 'Both edits target session token column — first changes type, second search string gone',
});

// JH-02d: Two edits add session expiry header to /health with different max-age values
scenarios.push({
  id: nextId('sess'),
  description: 'JH-02: Two edits add Set-Cookie header to /health with different expiry',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=abc; Max-Age=3600' });\n    res.end(JSON.stringify({ status: 'ok' }));" },
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=xyz; Max-Age=86400' });\n    res.end(JSON.stringify({ status: 'ok' }));" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Max-Age=86400' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'session_collision', 'JH-02'],
  rationale: 'Both edits target same health response header lines — second search gone after first edit',
});

// JH-02e: Control — add session config to different files (no collision)
scenarios.push({
  id: nextId('sess'),
  description: 'JH-02 control: Session config in different files — .env token and config.json flag (no collision)',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nSESSION_TTL=3600' },
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "sessionEnabled": true' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'SESSION_TTL=3600' },
    { type: 'content', file: 'config.json', pattern: '"sessionEnabled": true' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'http', 'session_collision', 'JH-02', 'control'],
  rationale: 'Session settings in different files with different search strings — no collision',
});

// =============================================================================
// Shape JH-03: Concurrent API writes to same resource
// Two edits modify the same API endpoint's data or schema in conflicting ways,
// creating inconsistent state that would corrupt concurrent writes.
// =============================================================================

// JH-03a: Two edits both change /api/items response to different schemas
scenarios.push({
  id: nextId('api'),
  description: 'JH-03: Two edits rewrite /api/items with incompatible schemas (array vs object)',
  edits: [
    { file: 'server.js', search: "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ data: [{ id: 1, label: 'Alpha' }], total: 1 }));" },
    { file: 'server.js', search: "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify([{ uuid: 'a1', title: 'Alpha' }]));" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: "uuid: 'a1'" }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'api_write', 'JH-03'],
  rationale: 'Both edits target same /api/items handler block — second search gone after first rewrites schema',
});

// JH-03b: Two edits both add POST /api/items handler at same insertion point
scenarios.push({
  id: nextId('api'),
  description: 'JH-03: Two edits both add POST /api/items with different validation logic',
  edits: [
    { file: 'server.js', search: "if (req.url === '/about') {", replace: "if (req.url === '/api/items' && req.method === 'POST') {\n    let body = '';\n    req.on('data', c => body += c);\n    req.on('end', () => {\n      const item = JSON.parse(body);\n      if (!item.name) { res.writeHead(400); res.end('name required'); return; }\n      res.writeHead(201, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ id: 3, name: item.name }));\n    });\n    return;\n  }\n\n  if (req.url === '/about') {" },
    { file: 'server.js', search: "if (req.url === '/about') {", replace: "if (req.url === '/api/items' && req.method === 'POST') {\n    let body = '';\n    req.on('data', c => body += c);\n    req.on('end', () => {\n      const item = JSON.parse(body);\n      if (!item.title) { res.writeHead(422); res.end('title required'); return; }\n      res.writeHead(201, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ id: Date.now(), title: item.title }));\n    });\n    return;\n  }\n\n  if (req.url === '/about') {" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'title required' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'api_write', 'JH-03'],
  rationale: 'Both edits insert POST handler before /about — second search gone after first transforms line',
});

// JH-03c: Two edits both modify the posts table to add different columns
scenarios.push({
  id: nextId('api'),
  description: 'JH-03: Two edits add different columns to posts table (concurrent schema writes)',
  edits: [
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    likes INTEGER DEFAULT 0,' },
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    rating DECIMAL(3,2) DEFAULT 0.00,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'rating DECIMAL' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'api_write', 'JH-03'],
  rationale: 'Both edits insert after view_count — second search gone after first adds likes column',
});

// JH-03d: Two edits both change /api/echo response format
scenarios.push({
  id: nextId('api'),
  description: 'JH-03: Two edits change /api/echo to return different response shapes',
  edits: [
    { file: 'server.js', search: "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));", replace: "res.end(JSON.stringify({ received: body, processedAt: new Date().toISOString() }));" },
    { file: 'server.js', search: "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));", replace: "res.end(JSON.stringify({ status: 'received', payload: body }));" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: "status: 'received'" }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'api_write', 'JH-03'],
  rationale: 'Both edits target /api/echo response — second search gone after first changes shape',
});

// JH-03e: Two edits both change database name for the API
scenarios.push({
  id: nextId('api'),
  description: 'JH-03: Two edits change database name in config.json for API backing store',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo_v2"' },
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "demo_api"' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "demo_api"' }],
  expectedSuccess: false,
  tags: ['contention', 'http', 'api_write', 'JH-03'],
  rationale: 'Both edits target same database name — second search gone after first renames to demo_v2',
});

// JH-03f: Control — add column to one table, change API route in another file (no collision)
scenarios.push({
  id: nextId('api'),
  description: 'JH-03 control: Add column to init.sql AND change API route in server.js (no collision)',
  edits: [
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    slug VARCHAR(200),' },
    { file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ status: 'ok', db: 'connected' }));" },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'slug VARCHAR(200)' },
    { type: 'content', file: 'server.js', pattern: "db: 'connected'" },
  ],
  expectedSuccess: true,
  tags: ['contention', 'http', 'api_write', 'JH-03', 'control'],
  rationale: 'Edits target different files — no concurrent write collision',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-http scenarios -> ${outPath}`);
