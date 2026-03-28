#!/usr/bin/env bun
/**
 * Observation × Config scenario generator
 * Grid cell: F×8
 * Shapes: FG-01 (config file access updates mtime, triggering hot reload),
 *         FG-02 (env var read triggers lazy initialization),
 *         FG-03 (secret access logs audit trail, changing audit state)
 *
 * Observation rule: every scenario must show how READING configuration
 * CHANGES the system's configuration state. Measuring config alters config.
 *
 * Key distinction from State × Config:
 * - State: agent reads wrong config file (staging vs prod) — belief about identity is wrong
 * - Observation: agent reads correct config but the read itself mutates state (hot reload, init, audit)
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-observation-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/observation-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `fg-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');

// =============================================================================
// Shape FG-01: Config file access updates mtime, triggering hot reload
// Agent reads config.json to inspect settings. The file access updates the
// file's mtime/atime. A file watcher sees the timestamp change and triggers
// a hot reload — the observation itself causes a restart.
// =============================================================================

// FG-01a: config.json has features.darkMode — reading it would trigger watcher
scenarios.push({
  id: nextId('mtime'),
  description: 'FG-01: Add file watcher comment to config.json, reading config triggers hot reload via mtime change',
  edits: [{
    file: 'config.json',
    search: '"features": {',
    replace: '"_watcherNote": "fs.watch on this file triggers reload on any access",\n  "features": {'
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '_watcherNote' },
    { type: 'content', file: 'server.js', pattern: 'fs.watch' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'mtime_hotreload', 'FG-01'],
  rationale: 'Assumed: reading config is side-effect-free. Actual: file watcher on config.json triggers reload when mtime changes. server.js has no watcher.',
});

// FG-01b: Touch config.json to check freshness — touch updates mtime
scenarios.push({
  id: nextId('mtime'),
  description: 'FG-01: Edit config.json to add lastChecked field, predicate checks server.js for lastChecked handling',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": false,\n    "lastChecked": null'
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'lastChecked' },
    { type: 'content', file: 'server.js', pattern: 'lastChecked' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'mtime_hotreload', 'FG-01'],
  rationale: 'Assumed: lastChecked in config is inert. Actual: any write to config.json (even adding null field) updates mtime. server.js has no handler.',
});

// FG-01c: config.staging.json has betaSignup=true — checking staging config reloads staging
scenarios.push({
  id: nextId('mtime'),
  description: 'FG-01: config.staging.json has betaSignup=true, reading to verify triggers staging hot reload',
  edits: [{
    file: 'config.staging.json',
    search: '"betaSignup": true',
    replace: '"betaSignup": true,\n    "_note": "reading this file triggers staging env reload"'
  }],
  predicates: [
    { type: 'content', file: 'config.staging.json', pattern: '_note' },
    { type: 'content', file: '.env.staging', pattern: '_note' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'mtime_hotreload', 'FG-01'],
  rationale: 'Assumed: reading staging config is harmless. Actual: hot reload watcher fires on access. .env.staging has no such note.',
});

// FG-01d: Add config version field — checking version triggers version bump
scenarios.push({
  id: nextId('mtime'),
  description: 'FG-01: Add configVersion to config.json, observation of version could trigger version increment logic',
  edits: [{
    file: 'config.json',
    search: '"app": {',
    replace: '"configVersion": 1,\n  "app": {'
  }],
  predicates: [
    { type: 'config', file: 'config.json', key: 'configVersion', expected: '1' },
    { type: 'content', file: 'server.js', pattern: 'configVersion' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'mtime_hotreload', 'FG-01'],
  rationale: 'Assumed: config version is readable without side effects. Actual: version-aware systems may increment on read. server.js has no awareness.',
});

// FG-01e: Control — read config.json, check config.json (static, no side effects)
scenarios.push({
  id: nextId('mtime'),
  description: 'FG-01 control: config.json has app name "Demo App", predicate checks config.json',
  edits: [],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"name": "Demo App"' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'config', 'mtime_hotreload', 'FG-01', 'control'],
  rationale: 'Static file check — reading config.json in test doesn\'t trigger any watcher.',
});

// =============================================================================
// Shape FG-02: Env var read triggers lazy initialization
// Agent reads an env var to check configuration. The first read triggers lazy
// initialization of a subsystem — the observation causes a state transition.
// =============================================================================

// FG-02a: DATABASE_URL read triggers connection pool initialization
scenarios.push({
  id: nextId('lazy'),
  description: 'FG-02: .env has DATABASE_URL, first read would trigger lazy connection pool init',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\n// Lazy init: first access to DATABASE_URL creates connection pool\nconst DB_URL = process.env.DATABASE_URL;"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'DATABASE_URL' },
    { type: 'content', file: 'server.js', pattern: 'pool.connect' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'lazy_init', 'FG-02'],
  rationale: 'Assumed: reading DATABASE_URL is pure. Actual: lazy init pattern means first access creates pool. No pool.connect in server.js.',
});

// FG-02b: DEBUG env var read enables debug logging — observation enables verbose mode
scenarios.push({
  id: nextId('lazy'),
  description: 'FG-02: .env has DEBUG=false, reading DEBUG could trigger debug logger initialization',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\n// Reading DEBUG initializes debug subsystem\nconst DEBUG = process.env.DEBUG === 'true';"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'process.env.DEBUG' },
    { type: 'content', file: 'config.json', pattern: 'DEBUG' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'lazy_init', 'FG-02'],
  rationale: 'Assumed: checking DEBUG flag is read-only. Actual: reading triggers debug subsystem init. config.json has no DEBUG field.',
});

// FG-02c: SECRET_KEY read triggers crypto initialization
scenarios.push({
  id: nextId('lazy'),
  description: 'FG-02: .env SECRET_KEY read triggers crypto module lazy load and key derivation',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\n// First SECRET_KEY access derives HMAC key (expensive)\nconst SECRET = process.env.SECRET_KEY;"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'SECRET_KEY' },
    { type: 'content', file: '.env.prod', pattern: 'not-very-secret' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'lazy_init', 'FG-02'],
  rationale: 'Assumed: reading SECRET_KEY is pure. Actual: first access triggers HMAC derivation. .env.prod has different secret, not "not-very-secret".',
});

// FG-02d: NODE_ENV read triggers environment-specific module loading
scenarios.push({
  id: nextId('lazy'),
  description: 'FG-02: .env NODE_ENV=production, reading it triggers production-mode initialization',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'NODE_ENV=production' },
    { type: 'content', file: '.env.staging', pattern: 'NODE_ENV=production' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'lazy_init', 'FG-02'],
  rationale: 'Assumed: .env and .env.staging have same NODE_ENV. Actual: .env has production, .env.staging has staging. Read triggers different init paths.',
});

// FG-02e: Control — .env has PORT=3000, check .env for PORT
scenarios.push({
  id: nextId('lazy'),
  description: 'FG-02 control: .env has PORT=3000, predicate checks .env for PORT',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=3000' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'config', 'lazy_init', 'FG-02', 'control'],
  rationale: 'Static file check — reading .env as text file doesn\'t trigger any lazy initialization.',
});

// =============================================================================
// Shape FG-03: Secret access logs audit trail, changing audit state
// Agent reads a secret/credential to verify it exists or has the right format.
// The access is logged in an audit trail — the observation changes audit state.
// =============================================================================

// FG-03a: SECRET_KEY access logged to audit — reading secret creates audit entry
scenarios.push({
  id: nextId('audit'),
  description: 'FG-03: .env SECRET_KEY access would be logged, observation creates audit trail entry',
  edits: [{
    file: '.env',
    search: 'SECRET_KEY="not-very-secret"',
    replace: 'SECRET_KEY="not-very-secret"\n# AUDIT: every SECRET_KEY access is logged to /var/log/secret-access.log'
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'AUDIT' },
    { type: 'content', file: 'server.js', pattern: 'secret-access.log' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'secret_audit', 'FG-03'],
  rationale: 'Assumed: reading secrets is transparent. Actual: secret access creates audit log entry. server.js has no audit log reference.',
});

// FG-03b: .env.prod secret access creates compliance record
scenarios.push({
  id: nextId('audit'),
  description: 'FG-03: .env.prod SECRET_KEY access creates compliance audit record, changing compliance state',
  edits: [{
    file: '.env.prod',
    search: 'SECRET_KEY="prod-secret-rotated-2026"',
    replace: 'SECRET_KEY="prod-secret-rotated-2026"\n# Each access to this secret is compliance-logged with timestamp and accessor'
  }],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: 'compliance-logged' },
    { type: 'content', file: 'config.prod.json', pattern: 'compliance' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'secret_audit', 'FG-03'],
  rationale: 'Assumed: checking prod secret is read-only. Actual: compliance logging fires on every access. config.prod.json has no compliance config.',
});

// FG-03c: DATABASE_URL access triggers connection attempt logging
scenarios.push({
  id: nextId('audit'),
  description: 'FG-03: .env DATABASE_URL access triggers DB connection audit, altering connection log',
  edits: [{
    file: '.env',
    search: 'DATABASE_URL="postgres://localhost:5432/demo"',
    replace: 'DATABASE_URL="postgres://localhost:5432/demo"\n# Connection attempts logged to pg_stat_activity'
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'pg_stat_activity' },
    { type: 'content', file: 'init.sql', pattern: 'pg_stat_activity' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'secret_audit', 'FG-03'],
  rationale: 'Assumed: checking DATABASE_URL format is read-only. Actual: any connection attempt is logged in pg_stat_activity. init.sql has no reference.',
});

// FG-03d: Environment variable enumeration exposes all vars to audit
scenarios.push({
  id: nextId('audit'),
  description: 'FG-03: Reading all env vars (for validation) creates broad audit footprint',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\n# WARNING: bulk env read creates N audit entries (one per var)'
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'bulk env read' },
    { type: 'content', file: 'config.json', pattern: 'audit' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'config', 'secret_audit', 'FG-03'],
  rationale: 'Assumed: env validation is harmless. Actual: each var access = one audit entry. Bulk check = N entries. config.json has no audit field.',
});

// FG-03e: Control — .env has SECRET_KEY, check .env for it (static read, no audit)
scenarios.push({
  id: nextId('audit'),
  description: 'FG-03 control: .env has SECRET_KEY value, predicate checks .env text',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'SECRET_KEY=' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'config', 'secret_audit', 'FG-03', 'control'],
  rationale: 'Static file check — reading .env as text doesn\'t trigger any audit system.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} observation-config scenarios → ${outPath}`);
