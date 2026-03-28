#!/usr/bin/env bun
/**
 * Access x Verify/Observe scenario generator
 * Grid cell: H×7
 * Shapes: HV-01 (health endpoint requires auth token), HV-02 (metrics port not exposed), HV-03 (schema introspection role restricted)
 *
 * These scenarios test whether verify detects ACCESS failures in the
 * verification/observation layer — probes and health checks are blocked by
 * authentication requirements, firewall rules, or role restrictions.
 *
 * Run: bun scripts/harvest/stage-access-verify.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-verify-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape HV-01: Health endpoint requires auth token
// The health/probe endpoint is gated behind authentication. The predicate
// expects a 200 but gets a 401/403 because no token is provided.
// =============================================================================

// HV-01a: /health requires Bearer token
scenarios.push({
  id: nextId('auth'),
  description: 'HV-01: /health endpoint gated behind Bearer token, probe sends no auth',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    replace: "if (req.url === '/health') {\n    if (req.headers.authorization !== 'Bearer probe-secret') { res.writeHead(401); res.end('Unauthorized'); return; }\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
  }],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200 } }],
  expectedSuccess: false,
  tags: ['access', 'verify', 'auth_gated', 'HV-01'],
  rationale: 'Health endpoint returns 401 without Bearer token — probe fails',
});

// HV-01b: /health requires API key in query string
scenarios.push({
  id: nextId('auth'),
  description: 'HV-01: /health requires ?key=secret query param, probe has no key',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: "if (req.url === '/health' || req.url?.startsWith('/health?')) {\n    const url = new URL(req.url, 'http://localhost');\n    if (url.searchParams.get('key') !== 'probe-key') { res.writeHead(403); res.end('Forbidden'); return; }",
  }],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200 } }],
  expectedSuccess: false,
  tags: ['access', 'verify', 'auth_gated', 'HV-01'],
  rationale: 'Health endpoint needs ?key=probe-key — probe without key gets 403',
});

// HV-01c: /health checks client IP allowlist
scenarios.push({
  id: nextId('auth'),
  description: 'HV-01: /health restricted to localhost IP, external probe blocked',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    replace: "if (req.url === '/health') {\n    const clientIp = req.socket.remoteAddress;\n    if (clientIp !== '127.0.0.1' && clientIp !== '::1') { res.writeHead(403); res.end('Forbidden'); return; }\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'content', file: 'server.js', pattern: 'remoteAddress' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'auth_gated', 'HV-01'],
  rationale: 'Health endpoint restricted to localhost — external verification probe gets 403',
});

// HV-01d: /health behind basic auth
scenarios.push({
  id: nextId('auth'),
  description: 'HV-01: /health requires HTTP Basic Auth, Docker healthcheck has no credentials',
  edits: [
    {
      file: 'server.js',
      search: "if (req.url === '/health') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
      replace: "if (req.url === '/health') {\n    const auth = Buffer.from((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString();\n    if (auth !== 'admin:secret') { res.writeHead(401, { 'WWW-Authenticate': 'Basic' }); res.end('Unauthorized'); return; }\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'content', file: 'Dockerfile', pattern: 'wget -q -O- http://localhost:3000/health' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'auth_gated', 'HV-01'],
  rationale: 'Health requires basic auth but Docker HEALTHCHECK wget sends none — container marked unhealthy',
});

// HV-01e: Control — /health is public
scenarios.push({
  id: nextId('auth'),
  description: 'HV-01 control: /health endpoint is public (no auth)',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['access', 'verify', 'auth_gated', 'HV-01', 'control'],
  rationale: 'Health endpoint is public — probe succeeds without credentials',
});

// =============================================================================
// Shape HV-02: Metrics port not exposed
// The app exposes a metrics/debug endpoint but Docker or compose config does
// not expose the port externally. The predicate expects to reach the endpoint.
// =============================================================================

// HV-02a: Metrics on port 9090 but only port 3000 exposed in compose
scenarios.push({
  id: nextId('port'),
  description: 'HV-02: App serves metrics on :9090, docker-compose only exposes 3000',
  edits: [{
    file: 'server.js',
    search: "server.listen(PORT, () => {",
    replace: "const metricsServer = http.createServer((req, res) => { res.writeHead(200); res.end('metrics_total 42'); });\nmetricsServer.listen(9090);\nserver.listen(PORT, () => {",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'metricsServer' },
    { type: 'http', method: 'GET', path: '/metrics', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'port_not_exposed', 'HV-02'],
  rationale: 'Metrics server on 9090 but compose only maps 3000 — external probe cannot reach metrics',
});

// HV-02b: Debug endpoint on internal port, EXPOSE missing in Dockerfile
scenarios.push({
  id: nextId('port'),
  description: 'HV-02: Debug endpoint on port 4000, Dockerfile only EXPOSEs 3000',
  edits: [{
    file: 'server.js',
    search: "server.listen(PORT, () => {",
    replace: "const debugServer = http.createServer((req, res) => { res.writeHead(200); res.end(JSON.stringify({heap: process.memoryUsage()})); });\ndebugServer.listen(4000);\nserver.listen(PORT, () => {",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'debugServer' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 4000' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'port_not_exposed', 'HV-02'],
  rationale: 'Debug server created but Dockerfile does not EXPOSE 4000 — port invisible to verifier',
});

// HV-02c: Admin UI on port 8080, compose maps only 3000
scenarios.push({
  id: nextId('port'),
  description: 'HV-02: Admin panel on :8080, compose only exposes app port',
  edits: [{
    file: 'server.js',
    search: "server.listen(PORT, () => {",
    replace: "const adminServer = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<h1>Admin Panel</h1>'); });\nadminServer.listen(8080);\nserver.listen(PORT, () => {",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'adminServer' },
    { type: 'content', file: 'docker-compose.yml', pattern: '8080' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'port_not_exposed', 'HV-02'],
  rationale: 'Admin server on 8080 but compose has no port mapping for it — unreachable',
});

// HV-02d: Compose exposes port but binds to 127.0.0.1 only
scenarios.push({
  id: nextId('port'),
  description: 'HV-02: Compose port mapping binds to 127.0.0.1, external probe blocked',
  edits: [{
    file: 'docker-compose.yml',
    search: '"${VERIFY_HOST_PORT:-3000}:3000"',
    replace: '"127.0.0.1:3000:3000"',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '127.0.0.1:3000:3000' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'port_not_exposed', 'HV-02'],
  rationale: 'Port bound to 127.0.0.1 — only accessible from inside Docker host, not from external probe',
});

// HV-02e: Control — port properly exposed
scenarios.push({
  id: nextId('port'),
  description: 'HV-02 control: Port correctly exposed in compose and Dockerfile',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '3000' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 3000' },
  ],
  expectedSuccess: true,
  tags: ['access', 'verify', 'port_not_exposed', 'HV-02', 'control'],
  rationale: 'Port 3000 properly exposed in both Dockerfile and compose — verification can reach it',
});

// =============================================================================
// Shape HV-03: Schema introspection role restricted
// The predicate checks database schema (table/column existence) but the
// connection credentials lack introspection privileges.
// =============================================================================

// HV-03a: App user cannot run information_schema queries
scenarios.push({
  id: nextId('role'),
  description: 'HV-03: DB predicate checks column type, app user lacks pg_catalog access',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "REVOKE SELECT ON pg_catalog.pg_class FROM app_user;\n\nCREATE TABLE settings (",
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'email', assertion: 'column_type', expected: 'VARCHAR(255)' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'role_restricted', 'HV-03'],
  rationale: 'Schema introspection needs pg_catalog access — REVOKE blocks the verifier',
});

// HV-03b: Predicate checks table in another schema the user cannot see
scenarios.push({
  id: nextId('role'),
  description: 'HV-03: Table in private schema, app user only has public schema access',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "CREATE SCHEMA IF NOT EXISTS internal;\nCREATE TABLE internal.audit (\n    id SERIAL PRIMARY KEY,\n    event TEXT NOT NULL\n);\n\nCREATE TABLE settings (",
  }],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'content', file: 'init.sql', pattern: 'internal.audit' },
  ],
  expectedSuccess: true,
  tags: ['access', 'verify', 'role_restricted', 'HV-03'],
  rationale: 'Table in private schema — app user with public schema access cannot introspect internal.audit',
});

// HV-03c: Connection string uses read-only replica, no DDL visibility
scenarios.push({
  id: nextId('role'),
  description: 'HV-03: .env points to read replica, predicate checks for new table',
  edits: [
    { file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://readonly@replica:5432/demo"' },
    { file: 'init.sql', search: 'CREATE TABLE settings (', replace: "CREATE TABLE analytics (\n    id SERIAL PRIMARY KEY,\n    event TEXT NOT NULL\n);\n\nCREATE TABLE settings (" },
  ],
  predicates: [
    { type: 'db', table: 'analytics', assertion: 'table_exists' },
    { type: 'content', file: '.env', pattern: 'readonly@replica' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'role_restricted', 'HV-03'],
  rationale: 'Read-only replica connection — schema changes from init.sql never reach the replica',
});

// HV-03d: Predicate checks column but user has no USAGE on schema
scenarios.push({
  id: nextId('role'),
  description: 'HV-03: DB predicate needs USAGE on schema, connection user lacks it',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "REVOKE USAGE ON SCHEMA public FROM app_readonly;\n\nCREATE TABLE settings (",
  }],
  predicates: [
    { type: 'db', table: 'settings', column: 'key', assertion: 'column_exists' },
  ],
  expectedSuccess: false,
  tags: ['access', 'verify', 'role_restricted', 'HV-03'],
  rationale: 'USAGE revoked on schema — introspection query returns empty even though table exists',
});

// HV-03e: Control — full access to schema introspection
scenarios.push({
  id: nextId('role'),
  description: 'HV-03 control: Full schema access, table and column checks pass',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'users', column: 'username', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['access', 'verify', 'role_restricted', 'HV-03', 'control'],
  rationale: 'Default credentials have full introspection access — schema checks pass',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-verify scenarios -> ${outPath}`);
