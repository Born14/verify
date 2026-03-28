#!/usr/bin/env bun
/**
 * State Assumption × Multi-Step scenario generator
 * Grid cell: C×6
 * Shapes: SM-01 (step 1 creates file, step 2 assumes filename format),
 *         SM-02 (build output assumed by deploy step),
 *         SM-03 (migration output assumed by seed step)
 *
 * State Assumption rule: every scenario must name both the ASSUMED STATE and the
 * ACTUAL STATE, and the failure must survive even with no timing delay and no
 * missing cascade. The agent's step N assumes state from step M but M's output changed.
 *
 * Key distinction from Temporal × Multi-Step:
 * - Temporal: same steps, wrong timing — "step 2 ran before step 1 finished"
 * - State: wrong assumption about step output — "step 1 produced X, step 2 assumes Y"
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-state-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/state-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sm-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape SM-01: Step 1 creates/modifies file, step 2 assumes filename/format
// Multi-edit scenario where the second edit assumes the first edit's output
// has a specific format, but the first edit produces something different.
// =============================================================================

// SM-01a: Step 1 changes port in .env, step 2 assumes port in config.json matches
scenarios.push({
  id: nextId('file'),
  description: 'SM-01: Step 1 changes .env PORT=8080, step 2 checks config.json for port 8080',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=8080' },
  ],
  predicates: [
    { type: 'config', file: 'config.json', key: 'app.port', expected: '8080' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'filename_format', 'SM-01'],
  rationale: 'Assumed: .env PORT change propagates to config.json. Actual: config.json still has port: 3000. Two independent sources.',
});

// SM-01b: Step 1 adds route to server.js, step 2 assumes Dockerfile exposes new port
scenarios.push({
  id: nextId('file'),
  description: 'SM-01: Step 1 adds /api/v2 route to server.js, step 2 checks Dockerfile for v2 reference',
  edits: [
    { file: 'server.js', search: "if (req.url === '/api/items')", replace: "if (req.url === '/api/v2/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ version: 2 }));\n    return;\n  }\n\n  if (req.url === '/api/items')" },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'v2' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'filename_format', 'SM-01'],
  rationale: 'Assumed: new API route reflected in Dockerfile. Actual: Dockerfile has no awareness of route structure.',
});

// SM-01c: Step 1 changes DB name in config.json, step 2 assumes .env matches
scenarios.push({
  id: nextId('file'),
  description: 'SM-01: Step 1 changes config.json db name to "app_v2", step 2 checks .env for /app_v2',
  edits: [
    { file: 'config.json', search: '"name": "demo"', replace: '"name": "app_v2"' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: '/app_v2' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'filename_format', 'SM-01'],
  rationale: 'Assumed: config.json DB name change propagates to .env DATABASE_URL. Actual: .env still has /demo.',
});

// SM-01d: Step 1 renames health endpoint, step 2 assumes compose healthcheck follows
scenarios.push({
  id: nextId('file'),
  description: 'SM-01: Step 1 renames /health to /readyz, step 2 checks docker-compose.yml for /readyz',
  edits: [
    { file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/readyz'" },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '/readyz' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'filename_format', 'SM-01'],
  rationale: 'Assumed: docker-compose healthcheck follows route rename. Actual: compose YAML is independent file.',
});

// SM-01e: Control — both files updated consistently
scenarios.push({
  id: nextId('file'),
  description: 'SM-01 control: Change port in both .env and config.json to 8080',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=8080' },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=8080' },
    { type: 'config', file: 'config.json', key: 'app.port', expected: '8080' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'multistep', 'filename_format', 'SM-01', 'control'],
  rationale: 'Both sources updated consistently — step outputs match step assumptions.',
});

// =============================================================================
// Shape SM-02: Build output assumed by deploy step
// Step 1 modifies source code, step 2 (deploy) assumes the build artifact
// reflects the source change. But the build step wasn't re-run.
// =============================================================================

// SM-02a: Edit server.js title, predicate checks Dockerfile (build container) for title
scenarios.push({
  id: nextId('build'),
  description: 'SM-02: Edit server.js <title>, predicate checks Dockerfile for title reference',
  edits: [
    { file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Production App</title>' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'Production' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'build_output', 'SM-02'],
  rationale: 'Assumed: source title visible in Dockerfile. Actual: Dockerfile only copies server.js, doesn\'t contain app content.',
});

// SM-02b: Edit .env to change NODE_ENV, predicate checks config.json for environment
scenarios.push({
  id: nextId('build'),
  description: 'SM-02: Change .env NODE_ENV to development, predicate checks config.json for development mode',
  edits: [
    { file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'development' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'build_output', 'SM-02'],
  rationale: 'Assumed: .env NODE_ENV affects config.json. Actual: config.json is static — no environment awareness.',
});

// SM-02c: Add new dependency assumption — edit server.js to require module, check Dockerfile for install
scenarios.push({
  id: nextId('build'),
  description: 'SM-02: Add require("express") to server.js, predicate checks Dockerfile for npm install',
  edits: [
    { file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst express = require('express');" },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'npm install' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'build_output', 'SM-02'],
  rationale: 'Assumed: Dockerfile installs dependencies. Actual: Dockerfile only copies server.js — no package.json, no npm install.',
});

// SM-02d: Change config features, assume docker-compose picks up feature flags
scenarios.push({
  id: nextId('build'),
  description: 'SM-02: Enable analytics in config.json, predicate checks docker-compose.yml for analytics env',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'analytics' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'build_output', 'SM-02'],
  rationale: 'Assumed: config.json features propagate to compose env. Actual: docker-compose.yml has no feature flag awareness.',
});

// SM-02e: Control — edit and verify in same file
scenarios.push({
  id: nextId('build'),
  description: 'SM-02 control: Edit Dockerfile to add ENV NODE_ENV=production, predicate checks Dockerfile',
  edits: [
    { file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'ENV NODE_ENV=production\nEXPOSE 3000' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'NODE_ENV=production' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'multistep', 'build_output', 'SM-02', 'control'],
  rationale: 'Edit and check in same file — no cross-file assumption.',
});

// =============================================================================
// Shape SM-03: Migration output assumed by seed/query step
// Step 1 modifies schema (init.sql), step 2 assumes the migration output
// (table structure) is available for queries. But the schema and data are separate.
// =============================================================================

// SM-03a: Add column to init.sql, predicate checks server.js for column reference
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03: Add avatar_url column to users in init.sql, predicate checks server.js for avatar_url',
  edits: [
    { file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'avatar_url' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03'],
  rationale: 'Assumed: schema column appears in application code. Actual: server.js has no DB queries — schema and code are independent.',
});

// SM-03b: Add new table to init.sql, predicate checks config.json for table reference
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03: Add audit_logs table to init.sql, predicate checks config.json for audit reference',
  edits: [
    { file: 'init.sql', search: "CREATE TABLE settings (", replace: "CREATE TABLE audit_logs (\n    id SERIAL PRIMARY KEY,\n    action TEXT NOT NULL,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE settings (" },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'audit' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03'],
  rationale: 'Assumed: new table reflected in config. Actual: config.json has no schema awareness.',
});

// SM-03c: Add index to init.sql, predicate checks for index in .env
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03: Add index on posts.user_id in init.sql, predicate checks .env for index config',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_posts_user ON posts(user_id);' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'idx_posts' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03'],
  rationale: 'Assumed: index creation visible in .env config. Actual: .env has no schema metadata.',
});

// SM-03d: Change column type in init.sql, assume server.js handles new type
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03: Change posts.view_count from INTEGER to BIGINT, predicate checks server.js for BIGINT handling',
  edits: [
    { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count BIGINT DEFAULT 0,' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'BIGINT' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03'],
  rationale: 'Assumed: column type change propagates to app layer. Actual: server.js has no type awareness.',
});

// SM-03e: Add foreign key constraint, predicate checks for cascade behavior in config
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03: Add ON DELETE CASCADE to posts FK, predicate checks config.json for cascade',
  edits: [
    { file: 'init.sql', search: 'user_id INTEGER NOT NULL REFERENCES users(id),', replace: 'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'cascade' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03'],
  rationale: 'Assumed: FK cascade behavior in config. Actual: config.json has no schema constraint awareness.',
});

// SM-03f: Control — edit init.sql and check init.sql
scenarios.push({
  id: nextId('migration'),
  description: 'SM-03 control: Add bio column to users in init.sql, predicate checks init.sql for bio',
  edits: [
    { file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'bio TEXT' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'multistep', 'migration_output', 'SM-03', 'control'],
  rationale: 'Same-file check — migration edit verified against migration file. No cross-step assumption.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} state-assumption-multistep scenarios → ${outPath}`);
