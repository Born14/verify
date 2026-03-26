#!/usr/bin/env bun
/**
 * Temporal × CLI/Process scenario generator
 * Grid cell: D×5
 * Shapes: TC-01 (process restart not complete), TC-02 (config change not picked up)
 *
 * These scenarios test whether verify detects the gap between config file changes
 * and the running process actually reflecting those changes. The config gate checks
 * file state; these scenarios expose when file state ≠ process state.
 *
 * Run: bun scripts/harvest/stage-temporal-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content for reference
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');

// =============================================================================
// Shape TC-01: Process restart not complete when checked
// Config file updated but the predicate checks content that the process would
// serve — and the process hasn't restarted. We simulate by editing config
// but checking that server.js (the process source) still has old values.
// =============================================================================

// TC-01a: Edit config.json port, but server.js still hardcodes 3000
scenarios.push({
  id: nextId('restart'),
  description: 'TC-01: Config port changed to 8080 but server.js still references 3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 8080' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '8080' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'restart_incomplete', 'TC-01'],
  rationale: 'Config updated but server source still references old port — process not restarted',
});

// TC-01b: Edit .env PORT, check server.js for new value
scenarios.push({
  id: nextId('restart'),
  description: 'TC-01: .env PORT=5000 but server.js default still 3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=5000' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'PORT || 5000' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'restart_incomplete', 'TC-01'],
  rationale: 'Env var changed but server.js has hardcoded default — restart would read env',
});

// TC-01c: Edit .env NODE_ENV, check server.js for production reference
scenarios.push({
  id: nextId('restart'),
  description: 'TC-01: .env NODE_ENV changed to development, check Dockerfile still says production',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'development' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'restart_incomplete', 'TC-01'],
  rationale: 'Env changed to development but Dockerfile has no such reference — infra not updated',
});

// TC-01d: Control — edit config.json and check config.json (same file)
scenarios.push({
  id: nextId('restart'),
  description: 'TC-01 control: Edit config.json port and check config.json',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 8080' }],
  predicates: [{ type: 'config', key: 'app.port', expected: '8080' }],
  expectedSuccess: true,
  tags: ['temporal', 'cli', 'restart_incomplete', 'TC-01', 'control'],
  rationale: 'Config file itself reflects the change (file-level truth, not process-level)',
});

// =============================================================================
// Shape TC-02: Config change not picked up by running process
// Edit config/env file, but the predicate checks for behavioral change in
// a file that represents the process's actual behavior — it won't reflect
// the config change because no restart/reload has happened.
// =============================================================================

// TC-02a: Change feature flag in config.json, check server.js for feature code
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Enable analytics in config.json but server.js has no analytics code',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'analytics' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: 'Feature flag enabled in config but process code has no analytics implementation',
});

// TC-02b: Change database host in config.json, check .env
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Change db host in config.json to remote, check .env still says localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db.prod.internal"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'db.prod.internal' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: 'Config changed db host but .env DATABASE_URL still points to localhost',
});

// TC-02c: Change DEBUG in .env, check that config.json doesn't reflect it
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Set DEBUG=true in .env but config.json features unchanged',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"debug": true' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: '.env DEBUG changed but config.json has no debug key — config sources desynchronized',
});

// TC-02d: Change app name in config, check server.js HTML title
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Rename app in config.json but server.js HTML still says "Demo App"',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Production App"' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Production App' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: 'App name changed in config but server.js HTML templates reference "Demo App" directly',
});

// TC-02e: Change database name in config, check .env DATABASE_URL
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Rename database in config.json but .env DATABASE_URL still says "demo"',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "production_db"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'production_db' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: 'Config db name changed but .env DATABASE_URL still references old db name',
});

// TC-02f: Control — edit .env and verify config gate reads new value
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02 control: Edit .env SECRET_KEY and verify config gate reads it',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="super-secret-v2"' }],
  predicates: [{ type: 'config', key: 'SECRET_KEY', expected: 'super-secret-v2' }],
  expectedSuccess: true,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02', 'control'],
  rationale: 'Config gate reads file directly — file change is visible at gate level',
});

// TC-02g: Edit both config.json and .env — mixed config source scenario
scenarios.push({
  id: nextId('reload'),
  description: 'TC-02: Edit config.json port AND .env PORT — but Dockerfile still says 3000',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 6000' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=6000' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: '6000' }],
  expectedSuccess: false,
  tags: ['temporal', 'cli', 'config_reload', 'TC-02'],
  rationale: 'Both config sources changed but infrastructure (Dockerfile) still references old port',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-cli scenarios → ${outPath}`);
