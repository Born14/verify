#!/usr/bin/env bun
/**
 * State Assumption × Filesystem scenario generator
 * Grid cell: C×1
 * Shapes: SF-01 (file exists in staging dir but agent checks prod dir),
 *         SF-02 (file moved but agent checks old path),
 *         SF-03 (symlink points elsewhere than expected)
 *
 * State Assumption rule: every scenario must name both the ASSUMED STATE and the
 * ACTUAL STATE, and the failure must survive even with no timing delay and no
 * missing cascade. The agent has the wrong belief about which filesystem world it's in.
 *
 * Key distinction from Temporal × Filesystem (TF-01: stale flush):
 * - Temporal: same file, wrong timing — "wait and it resolves"
 * - State: wrong path/location — "no amount of waiting helps, you're looking at the wrong file"
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-state-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/state-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sf-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape SF-01: File exists in staging dir but agent checks prod dir
// Agent grounded against one environment's file but predicate checks a different
// environment's file. The files exist in both places but have different content.
// Not "stale" (temporal) — the agent is looking at the WRONG COPY entirely.
// =============================================================================

// SF-01a: Agent edits config.json (dev), predicate checks config.prod.json for the change
// Assumed: dev config change propagates to prod config. Actual: separate files.
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01: Edit config.json app name, predicate checks config.prod.json for new name',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Staging App"' }],
  predicates: [
    { type: 'content', file: 'config.prod.json', pattern: 'Staging App' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01'],
  rationale: 'Assumed: config.json edit affects prod config. Actual: config.prod.json is a separate file — agent edited the wrong environment.',
});

// SF-01b: Agent edits .env (dev), predicate checks .env.prod for the change
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01: Edit .env SECRET_KEY, predicate checks .env.prod for new value',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="new-rotated-key"' }],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: 'new-rotated-key' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01'],
  rationale: 'Assumed: .env secret rotation propagates to .env.prod. Actual: .env.prod has its own SECRET_KEY — wrong environment file.',
});

// SF-01c: Agent edits .env.staging, predicate checks .env for the change
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01: Edit .env.staging DEBUG=false, predicate checks .env for the change',
  edits: [{ file: '.env.staging', search: 'DEBUG=true', replace: 'DEBUG=false' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DEBUG=false' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01'],
  rationale: 'Coincidental pass — .env already has DEBUG=false. Shows how wrong-file checks can produce false confidence.',
});

// SF-01d: Agent edits config.staging.json feature flag, checks config.json
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01: Enable betaSignup in config.staging.json, predicate checks config.json',
  edits: [{ file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'betaSignup' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01'],
  rationale: 'Assumed: staging feature flag exists in base config. Actual: config.json has no betaSignup field at all.',
});

// SF-01e: Agent edits config.prod.json analytics, checks config.staging.json
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01: Disable analytics in config.prod.json, predicate checks config.staging.json for false',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.staging.json', key: 'features.analytics', expected: 'false' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01'],
  rationale: 'Assumed: prod analytics=false reflected in staging. Actual: config.staging.json has analytics=true.',
});

// SF-01f: Control — edit and check same environment file
scenarios.push({
  id: nextId('dir'),
  description: 'SF-01 control: Edit config.json app name, predicate checks config.json confirms',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "My App"' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'My App' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'filesystem', 'wrong_directory', 'SF-01', 'control'],
  rationale: 'Same-environment check — edit and predicate target the same file. No path mismatch.',
});

// =============================================================================
// Shape SF-02: File moved/renamed but agent checks old path
// Agent believes a file is at one path but it has been renamed or restructured.
// The old path no longer has the expected content. Not stale — wrong identity.
// =============================================================================

// SF-02a: Agent renames server.js to app.js, predicate still checks server.js
scenarios.push({
  id: nextId('moved'),
  description: 'SF-02: Agent moves health route to /status in server.js, predicate checks Dockerfile HEALTHCHECK for /status',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/status'" }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/status' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'file_moved', 'SF-02'],
  rationale: 'Assumed: Dockerfile healthcheck follows route rename. Actual: Dockerfile still has /health — cross-file path mismatch.',
});

// SF-02b: Agent moves port config to config.json, predicate checks .env
scenarios.push({
  id: nextId('moved'),
  description: 'SF-02: Change port to 8080 in config.json, predicate checks .env for PORT=8080',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 8080' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=8080' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'file_moved', 'SF-02'],
  rationale: 'Assumed: config.json port change propagates to .env. Actual: .env still has PORT=3000 — config authority split across files.',
});

// SF-02c: Agent changes Dockerfile CMD, predicate checks docker-compose.yml for the change
scenarios.push({
  id: nextId('moved'),
  description: 'SF-02: Change Dockerfile CMD to app.js, predicate checks docker-compose.yml for app.js',
  edits: [{ file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["node", "app.js"]' }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'app.js' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'file_moved', 'SF-02'],
  rationale: 'Assumed: Dockerfile entrypoint visible in docker-compose.yml. Actual: compose delegates to Dockerfile build — no explicit reference.',
});

// SF-02d: Agent changes COPY path in Dockerfile, predicate checks server.js
scenarios.push({
  id: nextId('moved'),
  description: 'SF-02: Change Dockerfile COPY to src/server.js, predicate checks server.js for /app/src',
  edits: [{ file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY src/server.js ./src/' }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/app/src' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'file_moved', 'SF-02'],
  rationale: 'Assumed: Dockerfile COPY path reflected in server.js. Actual: server.js has no awareness of its own container path.',
});

// SF-02e: Control — edit Dockerfile COPY and check Dockerfile
scenarios.push({
  id: nextId('moved'),
  description: 'SF-02 control: Edit Dockerfile COPY path, predicate checks Dockerfile confirms',
  edits: [{ file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY server.js /opt/app/' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/opt/app/' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'filesystem', 'file_moved', 'SF-02', 'control'],
  rationale: 'Same-file check — edit and predicate on same file. No path confusion.',
});

// =============================================================================
// Shape SF-03: Symlink / reference points elsewhere than expected
// Agent assumes a reference (import, COPY source, env file pointer) resolves to
// one file but it actually resolves to a different one. The reference itself is
// the wrong pointer — not a timing issue but an identity/path issue.
// =============================================================================

// SF-03a: Dockerfile references server.js, but if server.js had been renamed agent wouldn't know
// Here: docker-compose.yml environment references PORT=3000, but .env has PORT=3000 and
// config.json has port: 3000 — three sources, agent checks wrong one.
scenarios.push({
  id: nextId('ref'),
  description: 'SF-03: docker-compose.yml sets PORT=3000, agent checks config.prod.json for port 3000',
  edits: [],
  predicates: [
    { type: 'config', file: 'config.prod.json', key: 'app.port', expected: '3001' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_reference', 'SF-03'],
  rationale: 'Assumed: prod config port matches compose env. Actual: config.prod.json has port 3000, not 3001 — but the reference chain is fragile.',
});

// SF-03b: .env DATABASE_URL says localhost, config.json says localhost, but .env.prod says db-primary.internal
// Agent reads .env, assumes DATABASE_URL applies everywhere
scenarios.push({
  id: nextId('ref'),
  description: 'SF-03: .env has DATABASE_URL with localhost, predicate checks .env.prod expects localhost',
  edits: [],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: 'localhost' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_reference', 'SF-03'],
  rationale: 'Assumed: .env DB host applies to prod. Actual: .env.prod uses db-primary.internal — environment reference mismatch.',
});

// SF-03c: Dockerfile HEALTHCHECK references /health, agent checks server.js for /health (passes)
// then agent edits server.js route but forgets Dockerfile still points to old path
scenarios.push({
  id: nextId('ref'),
  description: 'SF-03: Rename /health to /ready in server.js, Dockerfile HEALTHCHECK still says /health',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/ready'" }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/ready' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_reference', 'SF-03'],
  rationale: 'Assumed: Dockerfile healthcheck tracks route rename. Actual: Dockerfile is a separate file with stale /health reference.',
});

// SF-03d: docker-compose.yml healthcheck references /health, same breakage
scenarios.push({
  id: nextId('ref'),
  description: 'SF-03: Rename /health to /ready in server.js, docker-compose.yml healthcheck still says /health',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/ready'" }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '/ready' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'filesystem', 'wrong_reference', 'SF-03'],
  rationale: 'Assumed: docker-compose healthcheck follows route rename. Actual: compose YAML has separate /health reference.',
});

// SF-03e: Control — Dockerfile and docker-compose.yml both reference /health (consistent)
scenarios.push({
  id: nextId('ref'),
  description: 'SF-03 control: Dockerfile and docker-compose.yml both reference /health consistently',
  edits: [],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/health' },
    { type: 'content', file: 'docker-compose.yml', pattern: '/health' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'filesystem', 'wrong_reference', 'SF-03', 'control'],
  rationale: 'Both infrastructure files reference the same health path — no reference mismatch.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} state-assumption-filesystem scenarios → ${outPath}`);
