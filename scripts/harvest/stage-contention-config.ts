#!/usr/bin/env bun
/**
 * Contention x Config scenario generator
 * Grid cell: J x 8
 * Shapes: JG-01 (two edits to same .env key), JG-02 (config.json merge conflict between environments), JG-03 (concurrent feature flag toggles)
 *
 * Contention scenarios test whether verify detects COLLISION at the config layer.
 * Two processes writing the same .env key, two environment configs diverging on
 * the same field, two feature flags toggled by different workflows — all produce
 * config state that is internally inconsistent.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jg-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const envProd = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const envStaging = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const configProd = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStaging = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');

// =============================================================================
// Shape JG-01: Two edits to same .env key
// Two processes simultaneously write different values for the same environment
// variable. The second edit's search string is gone after the first applies.
// =============================================================================

// JG-01a: Two edits both change DATABASE_URL in .env
scenarios.push({
  id: nextId('env'),
  description: 'JG-01: Two edits both change DATABASE_URL in .env to different hosts',
  edits: [
    { file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://primary.internal:5432/demo"' },
    { file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://replica.internal:5432/demo"' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'replica.internal' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'env_collision', 'JG-01'],
  rationale: 'Both edits target DATABASE_URL — second search gone after first changes to primary.internal',
});

// JG-01b: Two edits both change NODE_ENV in .env
scenarios.push({
  id: nextId('env'),
  description: 'JG-01: Two edits both change NODE_ENV in .env to different modes',
  edits: [
    { file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=staging' },
    { file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'NODE_ENV=development' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'env_collision', 'JG-01'],
  rationale: 'Both edits change NODE_ENV — second search gone after first changes to staging',
});

// JG-01c: Two edits both change SECRET_KEY in .env.prod
scenarios.push({
  id: nextId('env'),
  description: 'JG-01: Two edits both rotate SECRET_KEY in .env.prod',
  edits: [
    { file: '.env.prod', search: 'SECRET_KEY="prod-secret-rotated-2026"', replace: 'SECRET_KEY="rotation-alpha-march-2026"' },
    { file: '.env.prod', search: 'SECRET_KEY="prod-secret-rotated-2026"', replace: 'SECRET_KEY="rotation-beta-march-2026"' },
  ],
  predicates: [{ type: 'content', file: '.env.prod', pattern: 'rotation-beta-march-2026' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'env_collision', 'JG-01'],
  rationale: 'Both secret rotations target same key — second search gone after first rotation applies',
});

// JG-01d: Two edits both change DATABASE_URL in .env.staging
scenarios.push({
  id: nextId('env'),
  description: 'JG-01: Two edits both change DATABASE_URL in .env.staging',
  edits: [
    { file: '.env.staging', search: 'DATABASE_URL="postgres://localhost:5432/demo_staging"', replace: 'DATABASE_URL="postgres://staging-db:5432/demo_staging"' },
    { file: '.env.staging', search: 'DATABASE_URL="postgres://localhost:5432/demo_staging"', replace: 'DATABASE_URL="postgres://staging-replica:5432/demo_staging"' },
  ],
  predicates: [{ type: 'content', file: '.env.staging', pattern: 'staging-replica' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'env_collision', 'JG-01'],
  rationale: 'Both edits target same staging DATABASE_URL — second search gone after first edit',
});

// JG-01e: Two edits both add same new env var after DEBUG line
scenarios.push({
  id: nextId('env'),
  description: 'JG-01: Two edits both add LOG_LEVEL after DEBUG in .env with different values',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nLOG_LEVEL=info' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nLOG_LEVEL=debug' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'LOG_LEVEL=debug' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'env_collision', 'JG-01'],
  rationale: 'Both edits append after DEBUG — second search gone after first adds LOG_LEVEL=info',
});

// JG-01f: Control — two edits change different .env keys (no collision)
scenarios.push({
  id: nextId('env'),
  description: 'JG-01 control: Edit PORT and DEBUG in .env (different keys, no collision)',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=4000' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=4000' },
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'config', 'env_collision', 'JG-01', 'control'],
  rationale: 'Different keys in same file — no collision, both apply cleanly',
});

// =============================================================================
// Shape JG-02: Config.json merge conflict between environments
// Two edits modify the same field in config files for different environments,
// creating cross-environment inconsistency or same-file collision.
// =============================================================================

// JG-02a: Two edits both change database host in config.json
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02: Two edits both change database host in config.json',
  edits: [
    { file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-primary.internal"' },
    { file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-replica.internal"' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'db-replica.internal' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02'],
  rationale: 'Both edits change database host — second search gone after first changes to primary',
});

// JG-02b: Two edits both change database name in config.prod.json
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02: Two edits both change database name in config.prod.json',
  edits: [
    { file: 'config.prod.json', search: '"name": "demo_prod"', replace: '"name": "demo_prod_v2"' },
    { file: 'config.prod.json', search: '"name": "demo_prod"', replace: '"name": "demo_production"' },
  ],
  predicates: [{ type: 'content', file: 'config.prod.json', pattern: 'demo_production' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02'],
  rationale: 'Both edits change prod database name — second search gone after first renames to v2',
});

// JG-02c: Two edits both change app name in config.staging.json
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02: Two edits both change app name in config.staging.json',
  edits: [
    { file: 'config.staging.json', search: '"name": "Demo App"', replace: '"name": "Staging Alpha"' },
    { file: 'config.staging.json', search: '"name": "Demo App"', replace: '"name": "Staging Beta"' },
  ],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: 'Staging Beta' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02'],
  rationale: 'Both edits change staging app name — second search gone after first renames to Alpha',
});

// JG-02d: Edit config.json port, predicate expects both config.json AND .env to have same port
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02: Edit config.json port to 4000, predicate expects .env also has 4000 (cross-file merge)',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 4000' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 4000' },
    { type: 'content', file: '.env', pattern: 'PORT=4000' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02'],
  rationale: 'Config port updated but .env still has PORT=3000 — cross-file merge conflict',
});

// JG-02e: Edit config.prod.json database host, predicate expects .env.prod DATABASE_URL matches
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02: Edit config.prod.json db host, predicate expects .env.prod DATABASE_URL matches',
  edits: [
    { file: 'config.prod.json', search: '"host": "db-primary.internal"', replace: '"host": "db-failover.internal"' },
  ],
  predicates: [
    { type: 'content', file: 'config.prod.json', pattern: 'db-failover.internal' },
    { type: 'content', file: '.env.prod', pattern: 'db-failover.internal' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02'],
  rationale: 'Config host updated to failover but .env.prod still has db-primary — cross-env merge conflict',
});

// JG-02f: Control — edit config.json features and config.prod.json features (different files, no collision)
scenarios.push({
  id: nextId('merge'),
  description: 'JG-02 control: Edit different features in config.json vs config.staging.json (no collision)',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
    { file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
    { type: 'content', file: 'config.staging.json', pattern: '"betaSignup": false' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'config', 'merge_conflict', 'JG-02', 'control'],
  rationale: 'Different files, different keys — no merge conflict',
});

// =============================================================================
// Shape JG-03: Concurrent feature flag toggles
// Two workflows toggle the same feature flag in opposite directions, or two
// flags that depend on each other are toggled independently.
// =============================================================================

// JG-03a: Two edits both toggle darkMode in config.json
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03: Two edits both toggle darkMode in config.json (off→on vs off→deleted)',
  edits: [
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": true, "darkModeV2": true' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"darkModeV2": true' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'feature_flag', 'JG-03'],
  rationale: 'Both edits target darkMode line — second search gone after first toggles it off',
});

// JG-03b: Two edits both toggle analytics in config.staging.json
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03: Two edits both change analytics flag in config.staging.json',
  edits: [
    { file: 'config.staging.json', search: '"analytics": true', replace: '"analytics": false' },
    { file: 'config.staging.json', search: '"analytics": true', replace: '"analytics": true, "analyticsV2": true' },
  ],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"analyticsV2": true' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'feature_flag', 'JG-03'],
  rationale: 'Both edits target analytics flag — second search gone after first disables analytics',
});

// JG-03c: Two edits both toggle betaSignup in config.staging.json
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03: Two edits both change betaSignup in config.staging.json',
  edits: [
    { file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' },
    { file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": true, "betaWhitelist": ["admin"]' },
  ],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"betaWhitelist"' }],
  expectedSuccess: false,
  tags: ['contention', 'config', 'feature_flag', 'JG-03'],
  rationale: 'Both edits target betaSignup — second search gone after first disables it',
});

// JG-03d: Feature flag in config.json toggled, predicate expects matching DEBUG in .env
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03: Toggle darkMode off in config.json, predicate expects DEBUG=true in .env (dependent flags)',
  edits: [
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"darkMode": false' },
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'config', 'feature_flag', 'JG-03'],
  rationale: 'darkMode toggled but dependent DEBUG flag in .env still false — cross-file flag inconsistency',
});

// JG-03e: Two edits toggle betaSignup in different environment configs
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03: Toggle betaSignup in config.prod.json (off→on), predicate expects staging also toggled',
  edits: [
    { file: 'config.prod.json', search: '"betaSignup": false', replace: '"betaSignup": true' },
  ],
  predicates: [
    { type: 'content', file: 'config.prod.json', pattern: '"betaSignup": true' },
    { type: 'content', file: 'config.staging.json', pattern: '"betaSignup": false' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'config', 'feature_flag', 'JG-03'],
  rationale: 'Prod betaSignup enabled but staging is still true, not false — predicate expects false in staging',
});

// JG-03f: Control — toggle different flags in different files (no collision)
scenarios.push({
  id: nextId('flag'),
  description: 'JG-03 control: Toggle analytics in config.json and DEBUG in .env (no collision)',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'config', 'feature_flag', 'JG-03', 'control'],
  rationale: 'Independent flags in different files — no collision, both toggle cleanly',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-config scenarios -> ${outPath}`);
