#!/usr/bin/env bun
/**
 * Propagation × Config scenario generator
 * Grid cell: E×8
 * Shapes: PE-01 (env var changed but process reads cached), PE-02 (config.json updated but app reads from .env), PE-03 (feature flag changed but behavior unchanged)
 *
 * These scenarios test whether verify detects propagation gaps in the
 * config→process→behavior chain — config changes that don't cascade
 * to runtime behavior because the consuming layer reads from a different source.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-propagation-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pe-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape PE-01: Env var changed but process reads cached value
// Agent changes an env var in .env but the corresponding value in config.json
// or docker-compose (which the process reads at startup) is unchanged.
// The config source is updated but the consuming surface is stale.
// =============================================================================

// PE-01a: Change .env PORT, config.json still has port 3000
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01: .env PORT changed to 8080, config.json still has port 3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=8080' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 8080' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'cached_process', 'PE-01'],
  rationale: 'Env var changed but config.json (which app may read at startup) still has old port — cached process',
});

// PE-01b: Change .env DATABASE_URL, config.json host unchanged
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01: .env DATABASE_URL points to new-db, config.json host still localhost',
  edits: [{ file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://new-db:5432/demo"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"host": "new-db"' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'cached_process', 'PE-01'],
  rationale: 'Database URL changed in .env but config.json host is stale — env→config propagation gap',
});

// PE-01c: Change .env NODE_ENV, server.js has no environment conditional
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01: .env NODE_ENV changed to development, server.js has no development-specific code',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'development' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'cached_process', 'PE-01'],
  rationale: 'NODE_ENV changed but server.js has no env-dependent behavior — config→process gap',
});

// PE-01d: Change .env SECRET_KEY, docker-compose env has no SECRET_KEY
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01: .env SECRET_KEY rotated, docker-compose env section has no SECRET_KEY',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="fresh-secret-2026"' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'SECRET_KEY' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'cached_process', 'PE-01'],
  rationale: 'Secret rotated in .env but compose doesnt forward it to container — env→deploy cache gap',
});

// PE-01e: Change .env DEBUG, server.js reads no DEBUG env var
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01: .env DEBUG changed to true, server.js never reads process.env.DEBUG',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'process.env.DEBUG' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'cached_process', 'PE-01'],
  rationale: 'Debug flag toggled but process code never reads it — env var→runtime propagation gap',
});

// PE-01f: Control — change .env PORT, check .env for new value
scenarios.push({
  id: nextId('cached'),
  description: 'PE-01 control: .env PORT changed, check .env for new value',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=7777' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'PORT=7777' }],
  expectedSuccess: true,
  tags: ['propagation', 'config', 'cached_process', 'PE-01', 'control'],
  rationale: 'Same-file check — env var is present',
});

// =============================================================================
// Shape PE-02: config.json updated but app reads from .env
// Agent changes a value in config.json but the app actually reads from .env
// (or vice versa). The updated config surface is not the one the app consumes.
// =============================================================================

// PE-02a: Change config.json port, .env PORT unchanged
scenarios.push({
  id: nextId('source'),
  description: 'PE-02: config.json port changed to 5000, .env still has PORT=3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 5000' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'PORT=5000' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02'],
  rationale: 'Config port changed but app reads PORT from .env — wrong config source updated',
});

// PE-02b: Change config.json db name, .env DATABASE_URL still has old name
scenarios.push({
  id: nextId('source'),
  description: 'PE-02: config.json db name changed to app_v2, .env DATABASE_URL still has /demo',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "app_v2"' }],
  predicates: [{ type: 'content', file: '.env', pattern: '/app_v2' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02'],
  rationale: 'DB name changed in config.json but .env DATABASE_URL still has old name — source mismatch',
});

// PE-02c: Change config.json db host, .env.prod still has old host
scenarios.push({
  id: nextId('source'),
  description: 'PE-02: config.json db host changed to db-cluster, .env.prod still has db-primary.internal',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-cluster"' }],
  predicates: [{ type: 'content', file: '.env.prod', pattern: 'db-cluster' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02'],
  rationale: 'Config host changed but prod .env DATABASE_URL still points to old host — cross-source gap',
});

// PE-02d: Change config.json app name, server.js HTML title unchanged
scenarios.push({
  id: nextId('source'),
  description: 'PE-02: config.json app name changed to "My Service", server.js title still "Demo App"',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "My Service"' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'My Service' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02'],
  rationale: 'Config name changed but server.js reads title from hardcoded HTML — config→code source mismatch',
});

// PE-02e: Change config.staging.json host, .env.staging DATABASE_URL unchanged
scenarios.push({
  id: nextId('source'),
  description: 'PE-02: config.staging.json host changed, .env.staging DATABASE_URL still has localhost',
  edits: [{ file: 'config.staging.json', search: '"host": "localhost"', replace: '"host": "staging-db"' }],
  predicates: [{ type: 'content', file: '.env.staging', pattern: 'staging-db' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02'],
  rationale: 'Staging config host changed but staging .env still has localhost — parallel config source gap',
});

// PE-02f: Control — change config.json, check config.json
scenarios.push({
  id: nextId('source'),
  description: 'PE-02 control: config.json port changed, check config.json for new value',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 6000' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 6000' }],
  expectedSuccess: true,
  tags: ['propagation', 'config', 'wrong_source', 'PE-02', 'control'],
  rationale: 'Same-file check — value is present',
});

// =============================================================================
// Shape PE-03: Feature flag changed but behavior unchanged
// Agent toggles a feature flag in config but the runtime behavior (server.js
// or compose) has no conditional for that flag. The flag changes but nothing
// observes it.
// =============================================================================

// PE-03a: Enable analytics in config.json, server.js has no analytics code
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03: analytics enabled in config.json, server.js has no analytics tracking',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'analytics' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03'],
  rationale: 'Analytics flag toggled but server has no analytics implementation — flag→behavior propagation gap',
});

// PE-03b: Disable darkMode in config.json, server.js has no dark mode CSS toggle
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03: darkMode disabled in config.json, server.js has no dark-mode conditional CSS',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'darkMode' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03'],
  rationale: 'Dark mode flag toggled but server.js has no CSS conditional for it — flag without behavior',
});

// PE-03c: Enable betaSignup in config.staging.json, server.js has no signup route
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03: betaSignup enabled in staging config, server.js has no /signup route',
  edits: [{ file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'signup' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03'],
  rationale: 'Beta signup flag exists but server has no signup functionality — flag→route gap',
});

// PE-03d: Change config.json db port, server.js reads port from process.env only
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03: config.json db port changed to 5433, server.js reads PORT from env not config',
  edits: [{ file: 'config.json', search: '"port": 5432', replace: '"port": 5433' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '5433' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03'],
  rationale: 'Config db port changed but server reads port from env only — config→process propagation gap',
});

// PE-03e: Toggle DEBUG in .env.staging, docker-compose.test has no DEBUG env
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03: DEBUG enabled in .env.staging, docker-compose.test.yml has no DEBUG variable',
  edits: [{ file: '.env.staging', search: 'DEBUG=true', replace: 'DEBUG=false' }],
  predicates: [{ type: 'content', file: 'docker-compose.test.yml', pattern: 'DEBUG' }],
  expectedSuccess: false,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03'],
  rationale: 'Debug flag toggled but test compose has no DEBUG env — flag doesnt propagate to test runtime',
});

// PE-03f: Control — toggle flag, check same config file
scenarios.push({
  id: nextId('behavior'),
  description: 'PE-03 control: analytics enabled in config.json, check config.json for new value',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"analytics": true' }],
  expectedSuccess: true,
  tags: ['propagation', 'config', 'flag_behavior', 'PE-03', 'control'],
  rationale: 'Same-file check — flag value is present',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-config scenarios → ${outPath}`);
