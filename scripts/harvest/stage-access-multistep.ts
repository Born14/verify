#!/usr/bin/env bun
/**
 * Access x Multi-Step scenario generator
 * Grid cell: H×6
 * Shapes: HM-01 (read succeeds but write requires auth), HM-02 (query succeeds but migration needs admin), HM-03 (deploy succeeds but restart needs sudo)
 *
 * These scenarios test whether verify detects ACCESS failures across multi-step
 * sequences — step N succeeds but step N+1 needs elevated privilege that the
 * agent does not have. The inconsistency is between what step N implies and
 * what step N+1 requires.
 *
 * Run: bun scripts/harvest/stage-access-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hm-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape HM-01: Read succeeds but write requires auth
// Step 1 reads data from a public endpoint or readable file.
// Step 2 writes back but the write target requires authentication or elevated
// permissions that the agent does not possess.
// =============================================================================

// HM-01a: Read /api/items succeeds, write /api/items needs auth token
scenarios.push({
  id: nextId('rw'),
  description: 'HM-01: Step 1 reads /api/items (public), step 2 POSTs new item requiring auth header',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items') {",
    replace: "if (req.url === '/api/items' && req.method === 'POST') {\n    if (!req.headers.authorization) { res.writeHead(401); res.end('Unauthorized'); return; }\n    res.writeHead(201, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ id: 3, name: 'Gamma' }));\n    return;\n  }\n  if (req.url === '/api/items') {",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
    { type: 'http', method: 'POST', path: '/api/items', expect: { status: 201 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'multistep', 'auth_escalation', 'HM-01'],
  rationale: 'GET is public but POST requires Authorization header — step 2 fails with 401',
});

// HM-01b: Read config.json succeeds, write to config.prod.json needs elevated access
scenarios.push({
  id: nextId('rw'),
  description: 'HM-01: Step 1 reads config.json, step 2 writes config.prod.json (prod file, restricted)',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
    { file: 'config.prod.json', search: '"analytics": false', replace: '"analytics": true' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
    { type: 'content', file: 'config.prod.json', pattern: '"analytics": true' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'auth_escalation', 'HM-01'],
  rationale: 'Both edits succeed at file level but config.prod.json should be deployment-gated — implicit privilege escalation',
});

// HM-01c: Read .env succeeds, write .env.prod requires prod access
scenarios.push({
  id: nextId('rw'),
  description: 'HM-01: Step 1 reads .env (dev), step 2 overwrites .env.prod (production secrets)',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
    { file: '.env.prod', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
    { type: 'content', file: '.env.prod', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'auth_escalation', 'HM-01'],
  rationale: 'Dev .env is writable but .env.prod contains production secrets — should require elevated access',
});

// HM-01d: Read health endpoint, then attempt to write to /health (method not allowed)
scenarios.push({
  id: nextId('rw'),
  description: 'HM-01: Step 1 GETs /health (public), step 2 attempts POST /health (no handler)',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.end(JSON.stringify({ status: 'ok', version: '2.0' }));",
  }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
    { type: 'http', method: 'POST', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'multistep', 'auth_escalation', 'HM-01'],
  rationale: 'GET /health succeeds but POST /health has no handler — 404 or method not allowed',
});

// HM-01e: Control — both read and write at same privilege level
scenarios.push({
  id: nextId('rw'),
  description: 'HM-01 control: Read and write both target server.js (same privilege)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst APP_NAME = 'demo';" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "require('http')" },
    { type: 'content', file: 'server.js', pattern: "APP_NAME = 'demo'" },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'auth_escalation', 'HM-01', 'control'],
  rationale: 'Both predicates check the same writable file — no privilege escalation',
});

// =============================================================================
// Shape HM-02: Query succeeds but migration needs admin
// Step 1 runs a read-only SQL query (SELECT). Step 2 attempts a schema change
// (CREATE/ALTER/DROP) that requires database admin role.
// =============================================================================

// HM-02a: SELECT from users succeeds, ALTER TABLE needs admin
scenarios.push({
  id: nextId('sql'),
  description: 'HM-02: Step 1 queries users table, step 2 adds column requiring ALTER privilege',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: 'ALTER TABLE users ADD COLUMN phone VARCHAR(20);\n\nCREATE TABLE settings (',
  }],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'users', column: 'phone', assertion: 'column_exists' },
  ],
  expectedSuccess: false,
  tags: ['access', 'multistep', 'admin_required', 'HM-02'],
  rationale: 'SELECT on users works with read role but ALTER TABLE requires admin — column never created',
});

// HM-02b: SELECT from sessions, then DROP INDEX needs admin
scenarios.push({
  id: nextId('sql'),
  description: 'HM-02: Step 1 queries sessions, step 2 drops index requiring admin privilege',
  edits: [{
    file: 'init.sql',
    search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);',
    replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nDROP INDEX idx_sessions_token;',
  }],
  predicates: [
    { type: 'db', table: 'sessions', assertion: 'table_exists' },
    { type: 'content', file: 'init.sql', pattern: 'DROP INDEX idx_sessions_token' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'admin_required', 'HM-02'],
  rationale: 'Table query works but DROP INDEX requires schema-change privilege — index survives',
});

// HM-02c: SELECT from posts, CREATE TABLE needs DDL permission
scenarios.push({
  id: nextId('sql'),
  description: 'HM-02: Step 1 reads posts table, step 2 creates new table requiring DDL',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: 'CREATE TABLE audit_log (\n    id SERIAL PRIMARY KEY,\n    action TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings (',
  }],
  predicates: [
    { type: 'db', table: 'posts', assertion: 'table_exists' },
    { type: 'db', table: 'audit_log', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  tags: ['access', 'multistep', 'admin_required', 'HM-02'],
  rationale: 'Reading posts is fine but CREATE TABLE requires DDL privilege — audit_log never created',
});

// HM-02d: Read settings works, GRANT/REVOKE needs superuser
scenarios.push({
  id: nextId('sql'),
  description: 'HM-02: Step 1 reads settings, step 2 adds GRANT requiring superuser',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;\n\nCREATE TABLE settings (",
  }],
  predicates: [
    { type: 'db', table: 'settings', assertion: 'table_exists' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT ALL ON ALL TABLES' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'admin_required', 'HM-02'],
  rationale: 'GRANT requires superuser — settings table readable but privilege escalation blocked',
});

// HM-02e: Control — both steps are read-only
scenarios.push({
  id: nextId('sql'),
  description: 'HM-02 control: Both steps query existing tables (no DDL needed)',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'posts', assertion: 'table_exists' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'admin_required', 'HM-02', 'control'],
  rationale: 'Both steps are read-only queries — no privilege escalation needed',
});

// =============================================================================
// Shape HM-03: Deploy succeeds but restart needs sudo
// Step 1 deploys code changes (file edits). Step 2 requires infrastructure-level
// operations (service restart, port binding, Docker control) that need elevated
// system privileges.
// =============================================================================

// HM-03a: Edit Dockerfile succeeds, restarting on privileged port needs root
scenarios.push({
  id: nextId('sudo'),
  description: 'HM-03: Edit changes port to 80 (privileged), predicate expects service on port 80',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 80;" },
    { file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 80' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'PORT || 80' },
    { type: 'http', path: '/', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'multistep', 'sudo_required', 'HM-03'],
  rationale: 'Code deploys fine but binding to port 80 requires root — container fails to start',
});

// HM-03b: Edit docker-compose succeeds, adding host volume needs root
scenarios.push({
  id: nextId('sudo'),
  description: 'HM-03: docker-compose binds host /var/log, requires root for host path access',
  edits: [{
    file: 'docker-compose.yml',
    search: 'retries: 3',
    replace: "retries: 3\n    volumes:\n      - /var/log/app:/app/logs",
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '/var/log/app:/app/logs' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'build: .' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'sudo_required', 'HM-03'],
  rationale: 'Compose file edited but /var/log/app mount requires root on host — runtime access denied',
});

// HM-03c: Edit succeeds, systemctl restart needs sudo
scenarios.push({
  id: nextId('sudo'),
  description: 'HM-03: Config change succeeds, predicate expects systemd service restart',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 4000' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'sudo_required', 'HM-03'],
  rationale: 'Config edit succeeds but applying it requires service restart with elevated privileges',
});

// HM-03d: Deploy code changes, Docker network operation needs root
scenarios.push({
  id: nextId('sudo'),
  description: 'HM-03: docker-compose adds custom network, requires Docker daemon access',
  edits: [{
    file: 'docker-compose.yml',
    search: 'services:\n  app:',
    replace: "networks:\n  custom:\n    driver: bridge\n    ipam:\n      config:\n        - subnet: 172.28.0.0/16\nservices:\n  app:\n    networks:\n      - custom",
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'subnet: 172.28.0.0/16' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'driver: bridge' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'sudo_required', 'HM-03'],
  rationale: 'Compose file valid but creating custom Docker network with IPAM requires daemon root',
});

// HM-03e: Control — edit and verify at same privilege level
scenarios.push({
  id: nextId('sudo'),
  description: 'HM-03 control: Edit and verify both within app-user permissions',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// deploy marker" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '// deploy marker' },
    { type: 'content', file: 'config.json', pattern: '"port": 3000' },
  ],
  expectedSuccess: true,
  tags: ['access', 'multistep', 'sudo_required', 'HM-03', 'control'],
  rationale: 'Both steps operate within app-user permissions — no sudo needed',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-multistep scenarios -> ${outPath}`);
