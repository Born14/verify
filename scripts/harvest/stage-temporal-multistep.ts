#!/usr/bin/env bun
/**
 * Temporal × Multi-Step scenario generator
 * Grid cell: D×6
 * Shapes: TM-01 (build before deploy but build stale), TM-02 (migration before seed but seed runs first), TM-03 (config reload after change but process reads cached)
 *
 * These scenarios test whether verify detects temporal ordering failures in
 * multi-step workflows — steps execute out of order or reference stale state
 * from a previous step.
 *
 * Run: bun scripts/harvest/stage-temporal-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tm-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape TM-01: Build before deploy but build stale
// Agent edits source in step 1, but the build artifact (Dockerfile/compose)
// still references the old state. The predicate checks the build artifact
// for the new value — it won't be there because step 2 (rebuild) didn't happen.
// =============================================================================

// TM-01a: Edit server.js port, Dockerfile EXPOSE still has old port
scenarios.push({
  id: nextId('build'),
  description: 'TM-01: Step 1 changes server.js port to 8080, step 2 (rebuild) skipped — Dockerfile still EXPOSE 3000',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 8080;' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01'],
  rationale: 'Server port changed but Dockerfile EXPOSE not updated — build step stale',
});

// TM-01b: Edit server.js to add new route, Dockerfile healthcheck still checks old endpoint
scenarios.push({
  id: nextId('build'),
  description: 'TM-01: Step 1 renames /health to /healthz, step 2 (Dockerfile update) skipped',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/healthz'" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: '/healthz' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01'],
  rationale: 'Health route renamed but Dockerfile HEALTHCHECK CMD still references /health',
});

// TM-01c: Edit config.json port, docker-compose environment still has old port
scenarios.push({
  id: nextId('build'),
  description: 'TM-01: Step 1 changes config.json port to 5000, step 2 (compose update) skipped',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 5000' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'PORT=5000' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01'],
  rationale: 'Config port changed but docker-compose environment not updated — stale build config',
});

// TM-01d: Edit .env PORT, docker-compose healthcheck still checks old port
scenarios.push({
  id: nextId('build'),
  description: 'TM-01: Step 1 changes .env PORT to 4000, docker-compose healthcheck still on 3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'localhost:4000' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01'],
  rationale: '.env port changed but compose healthcheck URL still references port 3000',
});

// TM-01e: Edit server.js entry filename, Dockerfile CMD still has old name
scenarios.push({
  id: nextId('build'),
  description: 'TM-01: Step 1 would rename entry to app.js but Dockerfile CMD still references server.js',
  edits: [{ file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY app.js .' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'CMD ["node", "app.js"]' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01'],
  rationale: 'COPY changed to app.js but CMD still runs server.js — multi-step Dockerfile inconsistency',
});

// TM-01f: Control — edit both Dockerfile lines consistently
scenarios.push({
  id: nextId('build'),
  description: 'TM-01 control: Both Dockerfile EXPOSE and server.js port updated consistently',
  edits: [
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 7777;' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: '7777' }],
  expectedSuccess: true,
  tags: ['temporal', 'multistep', 'stale_build', 'TM-01', 'control'],
  rationale: 'Same-file edit and check — no cross-step dependency, should pass',
});

// =============================================================================
// Shape TM-02: Migration before seed but seed runs first
// Agent adds a new column in init.sql (migration step) but the server.js
// query (seed/read step) still references the old schema. The predicate checks
// that the new column name appears in the query — it won't because the
// app code wasn't updated as part of the workflow.
// =============================================================================

// TM-02a: Add column to init.sql but server.js doesn't reference it
scenarios.push({
  id: nextId('migrate'),
  description: 'TM-02: Step 1 adds bio column to users, step 2 (app update) skipped — server.js has no bio reference',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'bio' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_seed', 'TM-02'],
  rationale: 'Schema column added but app code not updated — migration→app ordering gap',
});

// TM-02b: Add index in init.sql but server.js query doesn't leverage it
scenarios.push({
  id: nextId('migrate'),
  description: 'TM-02: Step 1 adds email index, step 2 (query optimization) skipped — no email lookup in server.js',
  edits: [{ file: 'init.sql', search: 'CREATE INDEX idx_sessions_token ON sessions(token);', replace: 'CREATE INDEX idx_sessions_token ON sessions(token);\nCREATE INDEX idx_users_email ON users(email);' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'email' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_seed', 'TM-02'],
  rationale: 'Index added but app code has no email query path — migration step without app step',
});

// TM-02c: Rename table in init.sql, server.js still references old name
scenarios.push({
  id: nextId('migrate'),
  description: 'TM-02: Step 1 renames posts to articles, step 2 (code update) skipped — server.js has no articles ref',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE posts', replace: 'CREATE TABLE articles' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'articles' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_seed', 'TM-02'],
  rationale: 'Table renamed in schema but app code never updated — seed step reads stale schema name',
});

// TM-02d: Add NOT NULL constraint, config doesn't reflect required field
scenarios.push({
  id: nextId('migrate'),
  description: 'TM-02: Step 1 adds NOT NULL to posts.body, config has no validation change',
  edits: [{ file: 'init.sql', search: 'body TEXT,', replace: 'body TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'bodyRequired' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'stale_seed', 'TM-02'],
  rationale: 'Schema constraint added but app config not updated — migration→config ordering gap',
});

// TM-02e: Control — add column to init.sql, check init.sql for it
scenarios.push({
  id: nextId('migrate'),
  description: 'TM-02 control: Add avatar_url to init.sql, check init.sql for it',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,' }],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'avatar_url TEXT' }],
  expectedSuccess: true,
  tags: ['temporal', 'multistep', 'stale_seed', 'TM-02', 'control'],
  rationale: 'Same-file edit and check — should pass',
});

// =============================================================================
// Shape TM-03: Config reload after change but process reads cached
// Agent changes a config value but a different config surface still has the old
// cached value. Simulates process that read config at startup and doesn't reload.
// =============================================================================

// TM-03a: Change .env NODE_ENV but config.json features still production defaults
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03: .env changed to development, config.json still has analytics:false (prod default)',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"analytics": true' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03'],
  rationale: 'Env changed to dev but config.json still has prod defaults — cached config pattern',
});

// TM-03b: Change config.json darkMode, .env has no DARK_MODE var
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03: config.json darkMode disabled, .env has no DARK_MODE override',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'DARK_MODE' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03'],
  rationale: 'Config feature toggled but env var for override not added — process reads cached .env',
});

// TM-03c: Change .env DATABASE_URL but config.json host still localhost
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03: .env DATABASE_URL points to new-db but config.json still has localhost',
  edits: [{ file: '.env', search: 'DATABASE_URL="postgres://localhost:5432/demo"', replace: 'DATABASE_URL="postgres://new-db:5432/demo"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"host": "new-db"' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03'],
  rationale: 'Database URL updated in .env but config.json still has localhost — cached config surface',
});

// TM-03d: Change .env SECRET_KEY, config.json has no secret reference
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03: .env SECRET_KEY rotated, config.json has no secret_key field',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="new-rotated-key-2026"' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'new-rotated-key' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03'],
  rationale: 'Secret rotated in .env but config.json has no awareness — cached process reads stale',
});

// TM-03e: Change .env DEBUG, server.js has no debug conditional
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03: .env DEBUG=true but server.js has no debug logging code',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'DEBUG' }],
  expectedSuccess: false,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03'],
  rationale: 'Debug flag enabled but server.js never reads it — config→runtime cache gap',
});

// TM-03f: Control — change .env and check .env
scenarios.push({
  id: nextId('cache'),
  description: 'TM-03 control: Change .env DEBUG, check .env for new value',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'DEBUG=true' }],
  expectedSuccess: true,
  tags: ['temporal', 'multistep', 'cached_config', 'TM-03', 'control'],
  rationale: 'Same-file edit and check — should pass',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-multistep scenarios → ${outPath}`);
