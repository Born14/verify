#!/usr/bin/env bun
/**
 * Contention x Filesystem scenario generator
 * Grid cell: J x 1
 * Shapes: JF-01 (concurrent edits to same file), JF-02 (lock file conflict), JF-03 (merge conflict on same lines)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent actors.
 * Two edits targeting the same resource create inconsistency — the second edit's search
 * string won't match after the first edit has been applied, or both edits produce
 * contradictory state in the same file.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jf-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape JF-01: Two agents edit same file — concurrent edits produce conflict
// Both edits target the same search string in the same file. After the first
// edit is applied, the second edit's search string no longer exists.
// =============================================================================

// JF-01a: Two edits change PORT in server.js to different values
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits both target PORT line in server.js with different values',
  edits: [
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 4000;' },
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 5000;' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: '5000' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Second edit search string no longer exists after first edit applied — concurrent collision',
});

// JF-01b: Two edits change app name in config.json to different values
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits both change app name in config.json',
  edits: [
    { file: 'config.json', search: '"name": "Demo App"', replace: '"name": "App Alpha"' },
    { file: 'config.json', search: '"name": "Demo App"', replace: '"name": "App Beta"' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'App Beta' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Second edit targets original name which was already replaced by first edit',
});

// JF-01c: Two edits change PORT in .env to different values
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits both change PORT in .env',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=8080' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=9090' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'PORT=9090' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Second edit search string "PORT=3000" gone after first edit changed it to 8080',
});

// JF-01d: Two edits change the same CSS property in server.js
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits both change h1 color in homepage CSS',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #ff0000; font-size: 2rem; }' },
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #00ff00; font-size: 2rem; }' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: '#00ff00' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Both edits target same h1 rule — second edit search string gone after first applies',
});

// JF-01e: Two edits change the Dockerfile CMD to different entry points
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits change Dockerfile CMD to different entry points',
  edits: [
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["node", "app.js"]' },
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["node", "index.js"]' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'index.js' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Second edit targets original CMD which first edit already changed',
});

// JF-01f: Two edits change SECRET_KEY in .env to different values
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01: Two edits both rotate SECRET_KEY in .env',
  edits: [
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="alpha-secret-key"' },
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="beta-secret-key"' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'beta-secret-key' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01'],
  rationale: 'Second secret rotation fails — original secret was already replaced',
});

// JF-01g: Control — two edits target DIFFERENT lines in same file (no conflict)
scenarios.push({
  id: nextId('conc'),
  description: 'JF-01 control: Two edits target different lines in server.js (no collision)',
  edits: [
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 4000;' },
    { file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Updated App</title>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '4000' },
    { type: 'content', file: 'server.js', pattern: 'Updated App' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'filesystem', 'concurrent_edit', 'JF-01', 'control'],
  rationale: 'Non-overlapping edits in same file — both should apply cleanly',
});

// =============================================================================
// Shape JF-02: Lock file conflict — agent writes but lock state from another
// process creates inconsistency. Simulated as: edit creates a state that
// conflicts with an existing file's declared constraints.
// =============================================================================

// JF-02a: Edit config.json to enable darkMode but .env DEBUG contradicts (lock-like state)
scenarios.push({
  id: nextId('lock'),
  description: 'JF-02: Edit enables darkMode in config.json, predicate expects both darkMode:true AND DEBUG=true in .env',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"darkMode": false' },
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'lock_conflict', 'JF-02'],
  rationale: 'Config edit succeeds but .env still has DEBUG=false — locked state prevents full update',
});

// JF-02b: Edit .env to change NODE_ENV, predicate expects both new env AND matching config feature
scenarios.push({
  id: nextId('lock'),
  description: 'JF-02: Edit .env to development mode, predicate expects analytics enabled in config.json',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=development' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'NODE_ENV=development' },
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'lock_conflict', 'JF-02'],
  rationale: 'Env switched to development but config.json feature flags not updated — locked by config state',
});

// JF-02c: Edit docker-compose port env, predicate expects Dockerfile also updated
scenarios.push({
  id: nextId('lock'),
  description: 'JF-02: Edit docker-compose PORT env, predicate expects Dockerfile EXPOSE matches',
  edits: [{ file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=8080' }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=8080' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'lock_conflict', 'JF-02'],
  rationale: 'Port changed in compose but Dockerfile EXPOSE locked at 3000 — cross-file lock contention',
});

// JF-02d: Edit server.js port, predicate expects both server.js AND .env consistent
scenarios.push({
  id: nextId('lock'),
  description: 'JF-02: Edit server.js default port, predicate expects .env to match',
  edits: [{ file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 7777;' }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '7777' },
    { type: 'content', file: '.env', pattern: 'PORT=7777' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'lock_conflict', 'JF-02'],
  rationale: 'Server.js port updated but .env still locked at PORT=3000',
});

// JF-02e: Control — edit .env DEBUG and check .env only (single resource, no lock contention)
scenarios.push({
  id: nextId('lock'),
  description: 'JF-02 control: Edit .env DEBUG flag, check only .env (no cross-file lock)',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'DEBUG=true' }],
  expectedSuccess: true,
  tags: ['contention', 'filesystem', 'lock_conflict', 'JF-02', 'control'],
  rationale: 'Single file edit with same-file predicate — no lock contention possible',
});

// =============================================================================
// Shape JF-03: Git merge conflict pattern — two edits modify overlapping regions
// One edit changes a block, the second edit changes a line within that same block.
// After the first edit restructures the region, the second edit's context is gone.
// =============================================================================

// JF-03a: Edit replaces health route block, second edit tries to change within it
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03: First edit replaces /health handler entirely, second targets a line inside it',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));\n    return;\n  }", replace: "if (req.url === '/health') {\n    res.writeHead(200);\n    res.end('healthy');\n    return;\n  }" },
    { file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ status: 'ok', version: '2' }));" },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: "version: '2'" }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03'],
  rationale: 'First edit replaced entire health block — second edit search string gone, merge conflict',
});

// JF-03b: Edit replaces full CSS body rule, second edit targets font-family within it
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03: First edit replaces body CSS rule, second targets font-family inside it',
  edits: [
    { file: 'server.js', search: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }', replace: 'body { font-family: monospace; margin: 0; background: #000; color: #fff; }' },
    { file: 'server.js', search: 'body { font-family: sans-serif;', replace: 'body { font-family: Georgia, serif;' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Georgia, serif' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03'],
  rationale: 'First edit replaced whole body rule — second edit partial match gone, merge conflict',
});

// JF-03c: Edit replaces nav HTML block, second edit targets specific link inside
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03: First edit replaces nav block, second edit targets specific link within it',
  edits: [
    { file: 'server.js', search: '<nav>\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/api/items">API</a>\n  </nav>', replace: '<nav>\n    <a class="nav-link" href="/">Dashboard</a>\n  </nav>' },
    { file: 'server.js', search: '<a class="nav-link" href="/api/items">API</a>', replace: '<a class="nav-link" href="/api/items">Data API</a>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Data API' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03'],
  rationale: 'Nav block replaced and simplified — the specific link second edit targets was removed',
});

// JF-03d: Edit replaces entire docker-compose healthcheck, second edit modifies interval
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03: First edit replaces compose healthcheck block, second targets interval',
  edits: [
    { file: 'docker-compose.yml', search: '    healthcheck:\n      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]\n      interval: 5s\n      timeout: 3s\n      retries: 3', replace: '    healthcheck:\n      test: ["CMD", "curl", "-f", "http://localhost:3000/ready"]\n      interval: 10s\n      timeout: 5s\n      retries: 5' },
    { file: 'docker-compose.yml', search: '      interval: 5s', replace: '      interval: 15s' },
  ],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'interval: 15s' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03'],
  rationale: 'First edit replaced entire healthcheck — second edit targets old interval value',
});

// JF-03e: Edit replaces init.sql users table, second edit targets column inside it
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03: First edit rewrites users table, second edit adds column to original structure',
  edits: [
    { file: 'init.sql', search: 'CREATE TABLE users (\n    id SERIAL PRIMARY KEY,\n    username VARCHAR(50) NOT NULL UNIQUE,\n    email VARCHAR(255) NOT NULL,\n    password_hash TEXT NOT NULL,\n    is_active BOOLEAN DEFAULT true,\n    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);', replace: 'CREATE TABLE users (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    name TEXT NOT NULL,\n    email TEXT NOT NULL UNIQUE\n);' },
    { file: 'init.sql', search: '    email VARCHAR(255) NOT NULL,', replace: '    email VARCHAR(255) NOT NULL,\n    phone VARCHAR(20),' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'phone VARCHAR(20)' }],
  expectedSuccess: false,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03'],
  rationale: 'First edit replaced users table entirely — second edit line no longer exists',
});

// JF-03f: Control — two edits on different files (no merge conflict possible)
scenarios.push({
  id: nextId('merge'),
  description: 'JF-03 control: Edits on different files — no merge conflict',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 4000' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=4000' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 4000' },
    { type: 'content', file: '.env', pattern: 'PORT=4000' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'filesystem', 'merge_conflict', 'JF-03', 'control'],
  rationale: 'Edits target different files — no merge conflict, both apply cleanly',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-fs scenarios -> ${outPath}`);
