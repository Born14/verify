#!/usr/bin/env bun
/**
 * Temporal × Config scenario generator
 * Grid cell: D×8
 * Shapes: TC-01 (secret expired between read and use), TC-02 (config TTL expired), TC-03 (feature flag toggled between check and action)
 *
 * These scenarios test whether verify detects temporal validity failures in
 * configuration — values that were correct at observation time but are stale
 * or expired by the time they're consumed.
 *
 * Run: bun scripts/harvest/stage-temporal-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');

// =============================================================================
// Shape TC-01: Secret expired between read and use
// Agent rotates a secret in one env file but the other env file (different
// environment) still has the old secret. Simulates credential rotation that
// doesn't propagate across environments within the TTL window.
// =============================================================================

// TC-01a: Rotate SECRET_KEY in .env, .env.prod still has old key
scenarios.push({
  id: nextId('secret'),
  description: 'TC-01: SECRET_KEY rotated in .env, .env.prod still has old production key',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="fresh-key-2026-q2"' }],
  predicates: [{ type: 'content', file: '.env.prod', pattern: 'fresh-key-2026-q2' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'secret_expired', 'TC-01'],
  rationale: 'Secret rotated in dev .env but production env still has old key — expired between read and deploy',
});

// TC-01b: Rotate SECRET_KEY in .env.prod, .env still has old key
scenarios.push({
  id: nextId('secret'),
  description: 'TC-01: SECRET_KEY rotated in .env.prod, base .env still has old "not-very-secret"',
  edits: [{ file: '.env.prod', search: 'SECRET_KEY="prod-secret-rotated-2026"', replace: 'SECRET_KEY="prod-new-rotation-q2"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'prod-new-rotation' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'secret_expired', 'TC-01'],
  rationale: 'Production secret rotated but base .env not updated — credential drift across environments',
});

// TC-01c: Rotate SECRET_KEY in .env.staging, .env.prod unaware
scenarios.push({
  id: nextId('secret'),
  description: 'TC-01: SECRET_KEY rotated in staging, production env still has different key',
  edits: [{ file: '.env.staging', search: 'SECRET_KEY="staging-secret-key"', replace: 'SECRET_KEY="staging-rotated-q2"' }],
  predicates: [{ type: 'content', file: '.env.prod', pattern: 'staging-rotated' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'secret_expired', 'TC-01'],
  rationale: 'Staging secret rotated but production has no awareness — cross-env temporal gap',
});

// TC-01d: Change DATABASE_URL in .env, .env.staging still has old connection string
scenarios.push({
  id: nextId('secret'),
  description: 'TC-01: DATABASE_URL changed in .env, .env.staging still has old localhost URL',
  edits: [{ file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://new-primary:5432/demo"' }],
  predicates: [{ type: 'content', file: '.env.staging', pattern: 'new-primary' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'secret_expired', 'TC-01'],
  rationale: 'DB URL migrated in dev but staging env still points to old host — credential expiry pattern',
});

// TC-01e: Control — rotate in .env, check .env for new value
scenarios.push({
  id: nextId('secret'),
  description: 'TC-01 control: SECRET_KEY rotated in .env, check .env for new value',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="freshly-rotated"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'freshly-rotated' }],
  expectedSuccess: true,
  tags: ['temporal', 'config', 'secret_expired', 'TC-01', 'control'],
  rationale: 'Same-file rotation and check — secret is fresh',
});

// =============================================================================
// Shape TC-02: Config TTL expired
// Edit changes a config value in one environment-specific config file but the
// corresponding value in another env config is stale. Simulates config that
// was correct at one point but expired by the time the other environment reads it.
// =============================================================================

// TC-02a: Change db host in config.json, config.prod.json still has old host
scenarios.push({
  id: nextId('ttl'),
  description: 'TC-02: config.json db host changed to "db-new", config.prod.json still has "db-primary.internal"',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-new"' }],
  predicates: [{ type: 'content', file: 'config.prod.json', pattern: '"host": "db-new"' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'config_ttl', 'TC-02'],
  rationale: 'Dev config updated but prod config still points to old host — TTL expired on config sync',
});

// TC-02b: Change db name in config.prod.json, config.staging.json not updated
scenarios.push({
  id: nextId('ttl'),
  description: 'TC-02: config.prod.json db name changed, config.staging.json still has old staging name',
  edits: [{ file: 'config.prod.json', search: '"name": "demo_prod"', replace: '"name": "demo_v2"' }],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"name": "demo_v2"' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'config_ttl', 'TC-02'],
  rationale: 'Prod db name changed but staging config not updated — cross-env config TTL expired',
});

// TC-02c: Change port in config.json, config.staging.json still has old port
scenarios.push({
  id: nextId('ttl'),
  description: 'TC-02: config.json port changed to 4000, config.staging.json still has 3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"port": 4000' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'config_ttl', 'TC-02'],
  rationale: 'Base config port changed but staging config still has old value',
});

// TC-02d: Change .env.prod DATABASE_URL, .env.staging not updated
scenarios.push({
  id: nextId('ttl'),
  description: 'TC-02: .env.prod DATABASE_URL changed, .env.staging still has old URL',
  edits: [{ file: '.env.prod', search: 'DATABASE_URL="postgres://db-primary.internal:5432/demo_prod"', replace: 'DATABASE_URL="postgres://db-v2.internal:5432/demo_prod"' }],
  predicates: [{ type: 'content', file: '.env.staging', pattern: 'db-v2.internal' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'config_ttl', 'TC-02'],
  rationale: 'Prod DB URL migrated but staging env not updated — config TTL expired across envs',
});

// TC-02e: Control — change config.json and check config.json
scenarios.push({
  id: nextId('ttl'),
  description: 'TC-02 control: Change config.json db name, check config.json for new value',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "demo_updated"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"name": "demo_updated"' }],
  expectedSuccess: true,
  tags: ['temporal', 'config', 'config_ttl', 'TC-02', 'control'],
  rationale: 'Same-file change and check — config is fresh',
});

// =============================================================================
// Shape TC-03: Feature flag toggled between check and action
// Agent toggles a feature flag in one config but the other config surfaces
// still have the old flag state. Simulates feature flag drift across config files.
// =============================================================================

// TC-03a: Enable analytics in config.json, config.prod.json still has it disabled
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03: analytics enabled in config.json, config.prod.json still has analytics:false',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'config.prod.json', pattern: '"analytics": true' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03'],
  rationale: 'Analytics flag toggled in dev but prod config not updated — flag drift between environments',
});

// TC-03b: Disable darkMode in config.json, config.staging.json still has it enabled
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03: darkMode disabled in config.json, config.staging.json still has darkMode:true',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"darkMode": false' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03'],
  rationale: 'Dark mode disabled in dev but staging still has it enabled — flag toggle not propagated',
});

// TC-03c: Enable betaSignup in config.prod.json, config.json has no betaSignup field
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03: betaSignup enabled in config.prod.json, config.json has no betaSignup field',
  edits: [{ file: 'config.prod.json', search: '"betaSignup": false', replace: '"betaSignup": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'betaSignup' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03'],
  rationale: 'Beta signup enabled in prod but base config has no awareness of the flag',
});

// TC-03d: Toggle DEBUG in .env, config.json has no debug field
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03: DEBUG toggled to true in .env, config.json has no debug setting',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"debug"' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03'],
  rationale: 'Debug flag toggled in .env but config.json has no corresponding field — flag toggle gap',
});

// TC-03e: Toggle betaSignup in staging, check .env for corresponding var
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03: betaSignup disabled in config.staging.json, .env.staging has no BETA_SIGNUP var',
  edits: [{ file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' }],
  predicates: [{ type: 'content', file: '.env.staging', pattern: 'BETA_SIGNUP' }],
  expectedSuccess: false,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03'],
  rationale: 'Config flag toggled but env var for runtime override not present — flag→env gap',
});

// TC-03f: Control — toggle flag and check same file
scenarios.push({
  id: nextId('flag'),
  description: 'TC-03 control: Toggle analytics in config.json, check config.json for new value',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"analytics": true' }],
  expectedSuccess: true,
  tags: ['temporal', 'config', 'flag_toggle', 'TC-03', 'control'],
  rationale: 'Same-file toggle and check — should pass',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-config scenarios → ${outPath}`);
