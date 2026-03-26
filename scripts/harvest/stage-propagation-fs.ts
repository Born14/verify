#!/usr/bin/env bun
/**
 * Propagation × Filesystem scenario generator
 * Grid cell: E×1
 * Shapes: PF-01 (source correct but build artifact differs), PF-02 (file edit doesn't trigger rebuild)
 *
 * Propagation scenarios test whether verify detects when an upstream change
 * doesn't cascade to downstream consumers. For filesystem:
 * - CSS/config edited in source but a different downstream file still has old values
 * - Dockerfile/docker-compose not updated after source changes
 * - Cross-file references broken by rename
 *
 * All pure-tier (no Docker needed) — tests structural propagation at file level.
 *
 * Run: bun scripts/harvest/stage-propagation-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pf-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape PF-01: Source correct but build artifact / downstream file differs
// Edit a value in one file, check that a DIFFERENT file that should reference
// or be consistent with it has NOT been updated.
// =============================================================================

// PF-01a: Change port in config.json but .env still has old port
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Change port in config.json to 4000, .env still has PORT=3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'PORT=4000' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'Port changed in config.json but .env not updated — cross-file propagation gap',
});

// PF-01b: Change port in config.json but Dockerfile EXPOSE still has old port
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Change port in config.json to 4000, Dockerfile still EXPOSE 3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 4000' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'Port changed in config but Dockerfile not updated — build artifact stale',
});

// PF-01c: Change port in .env but docker-compose still maps old port
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Change PORT in .env to 8080, docker-compose still has PORT=3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=8080' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'PORT=8080' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: '.env port changed but docker-compose environment not updated',
});

// PF-01d: Change database name in config.json, .env DATABASE_URL still has old name
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Rename database to "app_db" in config.json, .env still has "demo"',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "app_db"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'app_db' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'DB name changed in config but DATABASE_URL in .env still points to old name',
});

// PF-01e: Change database name in config.json, init.sql still creates old tables
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Change db host to "db" in config.json, .env still has localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'postgres://db:' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'DB host changed in config.json but .env DATABASE_URL still points to localhost',
});

// PF-01f: Change healthcheck path in Dockerfile, docker-compose still uses old path
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Dockerfile healthcheck changed to /ready, docker-compose still checks /health',
  edits: [{ file: 'Dockerfile', search: 'http://localhost:3000/health', replace: 'http://localhost:3000/ready' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '/ready' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'Dockerfile healthcheck path changed but docker-compose not updated',
});

// PF-01g: Change app name in config.json, server.js title still has old name
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01: Change app name to "My App" in config.json, server.js still has "Demo App"',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "My App"' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'My App' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01'],
  rationale: 'App name changed in config but server.js HTML titles not updated — config→source propagation gap',
});

// PF-01h: Control — change in config.json, check config.json for new value
scenarios.push({
  id: nextId('artifact'),
  description: 'PF-01 control: Change port in config.json, check config.json for new value',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 5000' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 5000' }],
  expectedSuccess: true,
  tags: ['propagation', 'filesystem', 'source_artifact', 'PF-01', 'control'],
  rationale: 'Same-file check — no propagation needed, should pass',
});

// =============================================================================
// Shape PF-02: File edit doesn't propagate to related files
// Edit a file that has cross-references in other files. The other files
// should be updated but aren't — simulates watcher scope / rebuild gap.
// =============================================================================

// PF-02a: Rename /api/items route in server.js, homepage HTML still links to old route
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Rename /api/items to /api/products in server.js, homepage nav still links to /api/items',
  edits: [{ file: 'server.js', search: "req.url === '/api/items'", replace: "req.url === '/api/products'" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'href="/api/products"' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'Route handler renamed but nav link in same file still references old route — intra-file propagation gap',
});

// PF-02b: Change server entry point in Dockerfile, docker-compose not updated
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Change CMD to app.js in Dockerfile, server.js is still the only source file',
  edits: [{ file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["node", "app.js"]' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'COPY app.js' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'CMD changed to app.js but COPY still copies server.js — Dockerfile internal propagation gap',
});

// PF-02c: Change NODE_ENV in .env, server.js has no reference to new value
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Change NODE_ENV to development in .env, server.js has no development-specific logic',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'development' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'Env changed to development but server.js has no conditional logic for it — config→code propagation gap',
});

// PF-02d: Add column to init.sql, server.js API doesn't return it
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Add avatar_url column to users in init.sql, server.js API has no reference',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'avatar_url' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'Schema column added but API layer not updated — DB→API propagation gap',
});

// PF-02e: Rename table in init.sql, server.js still references old table name
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Rename "posts" to "articles" in init.sql, no "articles" reference in server.js',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE posts', replace: 'CREATE TABLE articles' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'articles' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'Table renamed in schema but server.js code not updated — schema→code propagation gap',
});

// PF-02f: Change feature flag in config.json, server.js doesn't check it
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02: Enable analytics in config.json, server.js has no analytics tracking code',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'analytics' }],
  expectedSuccess: false,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02'],
  rationale: 'Feature flag enabled but server has no analytics implementation — config→behavior propagation gap',
});

// PF-02g: Control — edit init.sql and check init.sql for new content
scenarios.push({
  id: nextId('rebuild'),
  description: 'PF-02 control: Add column to init.sql, check init.sql for new column',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'phone VARCHAR(20)' }],
  expectedSuccess: true,
  tags: ['propagation', 'filesystem', 'rebuild_gap', 'PF-02', 'control'],
  rationale: 'Same-file check — no propagation needed, should pass',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-filesystem scenarios → ${outPath}`);
