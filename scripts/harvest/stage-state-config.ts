#!/usr/bin/env bun
/**
 * State Assumption × Config scenario generator
 * Grid cells: C×5 (State × Config), C×8 (State × Infra-Config overlap)
 * Shapes: SA-01 (feature flag differs by environment), SA-02 (default masks missing),
 *         SA-03 (config precedence unpredictable)
 *
 * State Assumption rule: every scenario must name both the ASSUMED STATE and the
 * ACTUAL STATE, and the failure must survive even with no timing delay and no
 * missing cascade. The agent has the wrong belief about which world it is in.
 *
 * Environment divergence is simulated via multi-environment config files:
 * - config.staging.json / config.prod.json (environment-split feature flags)
 * - .env.staging / .env.prod (environment-split env vars)
 * - config.json / .env / docker-compose.yml (default/base config surfaces)
 *
 * All pure-tier (no Docker needed).
 *
 * Run: bun scripts/harvest/stage-state-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/state-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');

// =============================================================================
// Shape SA-01: Feature flag differs by environment
// Agent inspects staging config surface, but predicate targets prod config surface.
// The feature exists in staging but not in prod — the agent is wrong about WHICH
// environment governs behavior.
// =============================================================================

// SA-01a: darkMode ON in staging config, OFF in prod config
// Assumed: staging config (darkMode: true). Actual: prod config (darkMode: false).
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: darkMode enabled in config.staging.json, disabled in config.prod.json',
  edits: [],  // No edit — divergence is pre-existing
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'features.darkMode', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging has darkMode=true. Actual: prod has darkMode=false. Agent inspected wrong environment.',
});

// SA-01b: analytics ON in staging, OFF in prod
// Assumed: staging config. Actual: prod config.
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: analytics enabled in config.staging.json, disabled in config.prod.json',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'features.analytics', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging has analytics=true. Actual: prod has analytics=false. Feature verified against wrong env.',
});

// SA-01c: betaSignup ON in staging, OFF in prod
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: betaSignup enabled in config.staging.json, disabled in config.prod.json',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'features.betaSignup', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging has betaSignup. Actual: prod has betaSignup=false. Environment identity mismatch.',
});

// SA-01d: DEBUG=true in .env.staging, DEBUG=false in .env.prod
// Agent edits staging env, checks prod env for the change
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: DEBUG=true in .env.staging, agent checks .env.prod which has DEBUG=false',
  edits: [],
  predicates: [
    { type: 'config', file: '.env.prod', key: 'DEBUG', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging env (DEBUG=true). Actual: prod env (DEBUG=false). Env file identity mismatch.',
});

// SA-01e: Database name differs between staging and prod
// Agent inspects staging DB config, but deploy target is prod
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: database is demo_staging in config.staging.json, demo_prod in config.prod.json',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'database.name', expected: 'demo_staging' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging DB (demo_staging). Actual: prod DB (demo_prod). Agent queried wrong database identity.',
});

// SA-01f: Database host differs — staging uses localhost, prod uses db-primary.internal
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: db host is localhost in staging, db-primary.internal in prod',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'database.host', expected: 'localhost' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging DB host (localhost). Actual: prod host (db-primary.internal). Wrong host belief.',
});

// SA-01g: Agent enables feature in staging config, checks base config (which hasn't changed)
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01: Enable analytics in config.staging.json, base config.json still has analytics=false',
  edits: [],  // config.staging.json already has analytics=true, config.json has false
  predicates: [
    { type: 'config', file: 'config.json', key: 'features.analytics', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01'],
  rationale: 'Assumed: staging override propagated to base. Actual: base config.json still has analytics=false.',
});

// SA-01h: Control — staging config checked against staging config
scenarios.push({
  id: nextId('envflag'),
  description: 'SA-01 control: config.staging.json has darkMode=true, check staging confirms it',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.staging.json', key: 'features.darkMode', expected: 'true' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'config', 'feature_flag_divergence', 'SA-01', 'control'],
  rationale: 'Same-environment check — staging config confirms its own value. No environment identity error.',
});

// =============================================================================
// Shape SA-02: Default value masks missing config
// A value is removed from config, but the fallback/default silently takes over.
// Assumed: config value exists and governs behavior. Actual: value is missing,
// fallback masks the absence, system runs on degraded state.
// =============================================================================

// SA-02a: Remove PORT from .env, server.js falls back to 3000 silently
scenarios.push({
  id: nextId('default'),
  description: 'SA-02: Remove PORT from .env, server.js fallback || 3000 masks the absence',
  edits: [{ file: '.env', search: 'PORT=3000\n', replace: '' }],
  predicates: [
    { type: 'config', file: '.env', key: 'PORT', expected: '3000' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02'],
  rationale: 'Assumed: PORT=3000 is explicitly configured. Actual: PORT missing, || 3000 fallback creates silent degradation.',
});

// SA-02b: Remove DATABASE_URL from .env, config.json db settings create false confidence
scenarios.push({
  id: nextId('default'),
  description: 'SA-02: Remove DATABASE_URL from .env, config.json still has database settings',
  edits: [{ file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"\n', replace: '' }],
  predicates: [
    { type: 'config', file: '.env', key: 'DATABASE_URL', expected: 'postgres://localhost:5432/demo' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02'],
  rationale: 'Assumed: DATABASE_URL is set. Actual: removed. config.json db settings create false sense of connectivity.',
});

// SA-02c: Remove SECRET_KEY from .env, no fallback exists anywhere
scenarios.push({
  id: nextId('default'),
  description: 'SA-02: Remove SECRET_KEY from .env, no fallback in any config surface',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"\n', replace: '' }],
  predicates: [
    { type: 'config', file: '.env', key: 'SECRET_KEY' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02'],
  rationale: 'Assumed: SECRET_KEY exists. Actual: removed, no fallback. Auth/sessions silently broken.',
});

// SA-02d: Remove NODE_ENV from .env, Node defaults to undefined not "production"
scenarios.push({
  id: nextId('default'),
  description: 'SA-02: Remove NODE_ENV from .env, implicit default is undefined not production',
  edits: [{ file: '.env', search: 'NODE_ENV=production\n', replace: '' }],
  predicates: [
    { type: 'config', file: '.env', key: 'NODE_ENV', expected: 'production' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02'],
  rationale: 'Assumed: NODE_ENV=production. Actual: removed, Node defaults to undefined. Libraries change behavior silently.',
});

// SA-02e: Remove DEBUG from .env, default behavior differs from explicit false
scenarios.push({
  id: nextId('default'),
  description: 'SA-02: Remove DEBUG from .env, absence differs from DEBUG=false semantically',
  edits: [{ file: '.env', search: 'DEBUG=false\n', replace: '' }],
  predicates: [
    { type: 'config', file: '.env', key: 'DEBUG', expected: 'false' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02'],
  rationale: 'Assumed: DEBUG=false explicitly. Actual: DEBUG absent. Libraries treat undefined !== "false".',
});

// SA-02f: Control — PORT exists in .env, config gate finds it
scenarios.push({
  id: nextId('default'),
  description: 'SA-02 control: PORT=3000 exists in .env, config gate confirms',
  edits: [],
  predicates: [
    { type: 'config', file: '.env', key: 'PORT', expected: '3000' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'config', 'default_masks_missing', 'SA-02', 'control'],
  rationale: 'PORT exists and matches — no missing config, no masking default.',
});

// =============================================================================
// Shape SA-03: Config precedence unpredictable — multiple sources disagree
// The same value is defined in multiple config surfaces with conflicting values.
// Assumed: the source the agent edited governs behavior. Actual: a different
// source with higher precedence overrides it.
// =============================================================================

// SA-03a: PORT in .env (changed to 4000) vs docker-compose environment (hardcoded 3000)
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change PORT in .env to 4000, docker-compose hardcodes PORT=3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=4000' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: .env governs PORT. Actual: docker-compose hardcodes PORT=3000, overrides .env inside container.',
});

// SA-03b: Database name in config.json vs DATABASE_URL in .env — different sources of truth
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change database name to "appdb" in config.json, .env DATABASE_URL still says /demo',
  edits: [{ file: 'config.json', search: '"name": "demo"', replace: '"name": "appdb"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'appdb' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: config.json is the DB name authority. Actual: .env DATABASE_URL has /demo — app reads .env at runtime.',
});

// SA-03c: Port in config.json vs Dockerfile EXPOSE — build layer vs runtime config
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change port to 8080 in config.json, Dockerfile still EXPOSE 3000',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 8080' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: config.json port governs Docker networking. Actual: Dockerfile EXPOSE is a build-time declaration.',
});

// SA-03d: Database host in config.json vs .env DATABASE_URL — two truth sources
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change db host to "db" in config.json, .env DATABASE_URL still has localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'postgres://db:' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: config.json host is authoritative. Actual: .env DATABASE_URL has localhost — connection string wins.',
});

// SA-03e: docker-compose PORT changed vs Dockerfile healthcheck URL port
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change docker-compose PORT to 8080, Dockerfile healthcheck still hits :3000',
  edits: [{ file: 'docker-compose.yml', search: 'PORT=3000', replace: 'PORT=8080' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'localhost:8080' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: docker-compose PORT governs healthcheck. Actual: Dockerfile healthcheck has hardcoded :3000.',
});

// SA-03f: App name in config.json vs hardcoded title in server.js
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change app name in config.json to "My App", server.js titles still say "Demo App"',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "My App"' }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '<title>My App</title>' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: config.json name is read by server.js. Actual: server.js hardcodes "Demo App" — config.json is unused.',
});

// SA-03g: Database port in config.json vs .env DATABASE_URL port
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: Change db port to 5433 in config.json, .env DATABASE_URL still has :5432',
  edits: [{ file: 'config.json', search: '"port": 5432', replace: '"port": 5433' }],
  predicates: [
    { type: 'content', file: '.env', pattern: ':5433/' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: config.json port is authoritative. Actual: .env DATABASE_URL has :5432 — connection string wins.',
});

// SA-03h: .env.staging vs .env.prod — agent edits staging, checks prod
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03: .env.staging has DEBUG=true, .env.prod has DEBUG=false — agent checks wrong env file',
  edits: [],
  predicates: [
    { type: 'config', file: '.env.prod', key: 'DEBUG', expected: 'true' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03'],
  rationale: 'Assumed: staging env governs prod. Actual: .env.prod overrides — DEBUG=false in production.',
});

// SA-03i: Control — edit and check the same file
scenarios.push({
  id: nextId('precedence'),
  description: 'SA-03 control: Change PORT in .env to 5000, config gate checks .env',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=5000' }],
  predicates: [
    { type: 'config', file: '.env', key: 'PORT', expected: '5000' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'config', 'precedence_conflict', 'SA-03', 'control'],
  rationale: 'Same-file edit + check — no cross-source assumption, no precedence ambiguity.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} state-assumption-config scenarios → ${outPath}`);
