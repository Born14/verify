#!/usr/bin/env bun
/**
 * Temporal × Filesystem scenario generator
 * Grid cell: D×1
 * Shapes: TF-01 (file written but not flushed), TF-02 (source edited but build stale), TF-03 (volume mount not synced)
 *
 * These scenarios test whether verify's filesystem gate correctly detects temporal
 * staleness — edits applied to source files but build artifacts / cached copies
 * not yet reflecting the change.
 *
 * Run: bun scripts/harvest/stage-temporal-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const outPath = resolve('fixtures/scenarios/temporal-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tf-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real server.js content for hash-based scenarios
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const serverHash = sha256(serverContent);

// =============================================================================
// Shape TF-01: File written but not flushed when checked
// The edit changes server.js but the predicate checks a content hash that
// would only match the PRE-edit state. Since the edit IS applied by verify,
// the old hash should NOT match → expectedSuccess: false.
// =============================================================================

// TF-01a: Edit server.js, check filesystem_unchanged against pre-edit hash
scenarios.push({
  id: nextId('flush'),
  description: 'TF-01: Edit changes server.js but predicate checks pre-edit hash (stale)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 4000;" }],
  predicates: [{ type: 'filesystem_unchanged', file: 'server.js', hash: serverHash }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_flush', 'TF-01'],
  rationale: 'Edit modifies server.js so pre-edit hash should NOT match post-edit content',
});

// TF-01b: Edit .env, check filesystem_unchanged against pre-edit hash
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envHash = sha256(envContent);
scenarios.push({
  id: nextId('flush'),
  description: 'TF-01: Edit changes .env PORT but predicate checks pre-edit hash',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [{ type: 'filesystem_unchanged', file: '.env', hash: envHash }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_flush', 'TF-01'],
  rationale: 'Edit modifies .env so pre-edit hash should NOT match',
});

// TF-01c: Edit config.json, check unchanged against pre-edit hash
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configHash = sha256(configContent);
scenarios.push({
  id: nextId('flush'),
  description: 'TF-01: Edit config.json port but predicate checks pre-edit hash',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'config.json', hash: configHash }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_flush', 'TF-01'],
  rationale: 'Edit modifies config.json so pre-edit hash should NOT match',
});

// TF-01d: No edit, hash IS current → should pass (control case)
scenarios.push({
  id: nextId('flush'),
  description: 'TF-01 control: No edit, server.js hash matches current state',
  edits: [],
  predicates: [{ type: 'filesystem_unchanged', file: 'server.js', hash: serverHash }],
  expectedSuccess: true,
  tags: ['temporal', 'filesystem', 'stale_flush', 'TF-01', 'control'],
  rationale: 'No edit applied — hash should still match (proves the gate works both ways)',
});

// TF-01e: No edit, .env hash matches → should pass (control)
scenarios.push({
  id: nextId('flush'),
  description: 'TF-01 control: No edit, .env hash matches current state',
  edits: [],
  predicates: [{ type: 'filesystem_unchanged', file: '.env', hash: envHash }],
  expectedSuccess: true,
  tags: ['temporal', 'filesystem', 'stale_flush', 'TF-01', 'control'],
  rationale: 'No edit — hash should match',
});

// =============================================================================
// Shape TF-02: Source edited but build artifact stale
// The edit modifies server.js but the predicate checks a DIFFERENT file
// (e.g., config.json) that wouldn't be updated by the edit. This simulates
// the pattern: "I edited server.js but the build output hasn't changed."
// Verify should see the content predicate fail because the checked file is stale.
// =============================================================================

// TF-02a: Edit server.js, predicate checks config.json for new content (won't be there)
scenarios.push({
  id: nextId('stale'),
  description: 'TF-02: Edit server.js but content predicate checks config.json for new value',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 9999;" }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '9999' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_artifact', 'TF-02'],
  rationale: 'Edit changes server.js but config.json still has 3000 — cross-file staleness',
});

// TF-02b: Edit .env but check server.js for the new value
scenarios.push({
  id: nextId('stale'),
  description: 'TF-02: Edit .env PORT=5000 but content predicate checks server.js for 5000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=5000' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '5000' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_artifact', 'TF-02'],
  rationale: 'Edit changes .env but server.js hardcodes 3000 — build artifact stale pattern',
});

// TF-02c: Edit config.json name, predicate checks server.js for it
scenarios.push({
  id: nextId('stale'),
  description: 'TF-02: Edit config.json app name but content predicate checks server.js',
  edits: [{ file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Updated App"' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Updated App' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_artifact', 'TF-02'],
  rationale: 'Config name changed but server.js still has "Demo App" in HTML — stale build',
});

// TF-02d: Edit server.js title, predicate checks Dockerfile (unrelated file)
scenarios.push({
  id: nextId('stale'),
  description: 'TF-02: Edit server.js <title> but content predicate checks Dockerfile',
  edits: [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>New App</title>' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'New App' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'stale_artifact', 'TF-02'],
  rationale: 'Title edit in server.js never propagates to Dockerfile',
});

// TF-02e: Control — edit server.js AND check server.js (same file, should pass)
scenarios.push({
  id: nextId('stale'),
  description: 'TF-02 control: Edit server.js and check server.js for new content',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 7777;" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '7777' }],
  expectedSuccess: true,
  tags: ['temporal', 'filesystem', 'stale_artifact', 'TF-02', 'control'],
  rationale: 'Same file edited and checked — content should be found (non-stale)',
});

// =============================================================================
// Shape TF-03: Container volume mount not synced
// Simulates host-edit → container-read staleness. The edit changes a file
// but a filesystem_exists check on a path that doesn't exist simulates the
// container not having synced. Also: content checks on pre-edit patterns.
// =============================================================================

// TF-03a: Edit server.js to remove a route, predicate checks content for old route
scenarios.push({
  id: nextId('mount'),
  description: 'TF-03: Edit removes /api/items route, predicate expects it in server.js',
  edits: [{ file: 'server.js', search: "if (req.url === '/api/items') {", replace: "if (req.url === '/api/data') {" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "/api/items" }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'mount_sync', 'TF-03'],
  rationale: 'Route renamed from /api/items to /api/data — old pattern should not be found',
});

// TF-03b: Edit changes health endpoint path, predicate checks for old path
scenarios.push({
  id: nextId('mount'),
  description: 'TF-03: Edit renames /health to /status, predicate checks for /health in Dockerfile',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/status'" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: '/health' }],
  expectedSuccess: true,
  tags: ['temporal', 'filesystem', 'mount_sync', 'TF-03'],
  rationale: 'Dockerfile healthcheck still references /health — mount desync between source and infra',
});

// TF-03c: Edit adds new content to server.js, check for it in a file that won't have it
scenarios.push({
  id: nextId('mount'),
  description: 'TF-03: Edit adds analytics flag to server.js, predicate checks .env',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst ANALYTICS = true;" }],
  predicates: [{ type: 'content', file: '.env', pattern: 'ANALYTICS' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'mount_sync', 'TF-03'],
  rationale: 'ANALYTICS added to server.js but .env has no such key — cross-file desync',
});

// TF-03d: Edit Dockerfile but predicate checks docker-compose.yml for sync
scenarios.push({
  id: nextId('mount'),
  description: 'TF-03: Edit Dockerfile EXPOSE port, predicate checks docker-compose.yml',
  edits: [{ file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 8080' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '8080' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'mount_sync', 'TF-03'],
  rationale: 'Dockerfile port changed but docker-compose.yml still maps 3000',
});

// TF-03e: Edit docker-compose.yml port mapping, predicate checks Dockerfile
scenarios.push({
  id: nextId('mount'),
  description: 'TF-03: Edit docker-compose.yml port env, predicate checks Dockerfile for new port',
  edits: [{ file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=9090' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: '9090' }],
  expectedSuccess: false,
  tags: ['temporal', 'filesystem', 'mount_sync', 'TF-03'],
  rationale: 'docker-compose port env changed but Dockerfile EXPOSE still says 3000',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-fs scenarios → ${outPath}`);
