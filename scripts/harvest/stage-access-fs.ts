#!/usr/bin/env bun
/**
 * Access × Filesystem scenario generator
 * Grid cell: H×1
 * Shapes: HF-01 (permission denied), HF-02 (path traversal blocked), HF-03 (ownership mismatch)
 *
 * These scenarios test whether verify detects ACCESS failures — the agent knows
 * the right file but can't touch it due to permissions, path restrictions, or
 * ownership. Key distinction from State Assumption: access is about PERMISSION,
 * not BELIEF about what a file contains.
 *
 * Run: bun scripts/harvest/stage-access-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hf-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape HF-01: File permission denied
// Agent edits a file within the app directory but the predicate checks a
// read-only or permission-restricted surface (system file, root-owned config).
// The cross-source inconsistency is that the edit target and predicate target
// live in different permission domains.
// =============================================================================

// HF-01a: Edit server.js but predicate checks /etc/hosts (outside app boundary)
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01: Edit server.js to add host, predicate checks /etc/hosts for entry',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst DB_HOST = 'db.internal';" }],
  predicates: [{ type: 'content', file: '/etc/hosts', pattern: 'db.internal' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01'],
  rationale: 'Agent adds DB_HOST to server.js but /etc/hosts is a system file — app cannot write it',
});

// HF-01b: Edit .env but predicate checks /etc/ssl/certs for new cert
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01: Edit .env SSL_CERT_PATH but predicate checks system cert directory',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nSSL_CERT_PATH=/etc/ssl/certs/app.pem' }],
  predicates: [{ type: 'content', file: '/etc/ssl/certs/app.pem', pattern: 'BEGIN CERTIFICATE' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01'],
  rationale: 'Agent sets cert path in .env but predicate expects cert file in root-owned /etc/ssl/',
});

// HF-01c: Edit config.json to set log path, predicate checks /var/log for output
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01: Config sets logPath=/var/log/app.log, predicate checks that path',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "logPath": "/var/log/app.log"' }],
  predicates: [{ type: 'content', file: '/var/log/app.log', pattern: 'started' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01'],
  rationale: 'Config references /var/log/app.log but app user lacks write permission to /var/log/',
});

// HF-01d: Edit server.js to reference pid file, predicate checks /var/run
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01: Server writes PID to /var/run/app.pid, predicate checks existence',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nrequire('fs').writeFileSync('/var/run/app.pid', String(process.pid));" }],
  predicates: [{ type: 'content', file: '/var/run/app.pid', pattern: '\\d+' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01'],
  rationale: 'App tries to write PID to /var/run/ which requires root — permission denied at runtime',
});

// HF-01e: Edit Dockerfile to copy into protected path, predicate checks that path
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01: Dockerfile copies to /usr/local/bin, predicate checks binary exists',
  edits: [{ file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY server.js .\nCOPY server.js /usr/local/bin/app-server' }],
  predicates: [{ type: 'content', file: '/usr/local/bin/app-server', pattern: 'http.createServer' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01'],
  rationale: 'Dockerfile COPY to /usr/local/bin/ but predicate checks host path — not the container',
});

// HF-01f: Control — edit and predicate both target writable app files
scenarios.push({
  id: nextId('perm'),
  description: 'HF-01 control: Edit config.json and check config.json (same writable file)',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": true' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"analytics": true' }],
  expectedSuccess: true,
  tags: ['access', 'filesystem', 'permission_denied', 'HF-01', 'control'],
  rationale: 'Both edit and predicate target the same writable app file — no permission issue',
});

// =============================================================================
// Shape HF-02: Path traversal blocked
// Agent edits reference paths that escape the application sandbox using
// relative path traversal (../) or absolute system paths. The predicate checks
// content that would only exist if the traversal succeeded.
// =============================================================================

// HF-02a: Edit references ../../etc/passwd
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02: Edit targets ../../etc/passwd via path traversal',
  edits: [{ file: '../../etc/passwd', search: 'root:', replace: 'root:x:0:0:hacked:' }],
  predicates: [{ type: 'content', file: '../../etc/passwd', pattern: 'hacked' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02'],
  rationale: 'Path traversal ../../etc/passwd escapes app sandbox — should be blocked',
});

// HF-02b: Edit targets ../../../tmp/exploit via deep traversal
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02: Edit targets ../../../tmp/exploit via deep path traversal',
  edits: [{ file: '../../../tmp/exploit.sh', search: '', replace: '#!/bin/bash\nrm -rf /' }],
  predicates: [{ type: 'content', file: '../../../tmp/exploit.sh', pattern: 'rm -rf' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02'],
  rationale: 'Deep traversal ../../../tmp/ escapes sandbox — content should never land',
});

// HF-02c: Edit references absolute path outside app
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02: Edit targets /root/.ssh/authorized_keys (absolute path)',
  edits: [{ file: '/root/.ssh/authorized_keys', search: '', replace: 'ssh-rsa AAAA... attacker@evil' }],
  predicates: [{ type: 'content', file: '/root/.ssh/authorized_keys', pattern: 'attacker@evil' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02'],
  rationale: 'Absolute path /root/.ssh/ is outside app boundary — sandbox violation',
});

// HF-02d: Edit server.js but predicate checks a traversal path
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02: Edit server.js normally, predicate checks ../../config.json (traversal)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 4000;" }],
  predicates: [{ type: 'content', file: '../../config.json', pattern: 'port' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02'],
  rationale: 'Edit is valid but predicate uses ../ traversal to check file outside app dir',
});

// HF-02e: Edit uses symlink-like path to escape
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02: Edit targets ./node_modules/.cache/../../.env.production (traversal via node_modules)',
  edits: [{ file: 'node_modules/.cache/../../.env.production', search: '', replace: 'API_KEY=stolen' }],
  predicates: [{ type: 'content', file: 'node_modules/.cache/../../.env.production', pattern: 'API_KEY=stolen' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02'],
  rationale: 'Path uses node_modules + ../ traversal to escape sandbox boundary',
});

// HF-02f: Control — relative path within app dir (./config.json)
scenarios.push({
  id: nextId('trav'),
  description: 'HF-02 control: Edit ./config.json (relative but within app dir)',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 4000' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"port": 4000' }],
  expectedSuccess: true,
  tags: ['access', 'filesystem', 'path_traversal', 'HF-02', 'control'],
  rationale: 'Relative path stays within app directory — no traversal violation',
});

// =============================================================================
// Shape HF-03: Ownership mismatch
// File exists and is in the right place but is owned by a different user/group.
// Agent edits assume app-user write access but the predicate checks a file
// that would be owned by root or another service user.
// =============================================================================

// HF-03a: Edit docker-compose.yml volumes, predicate checks root-owned host path
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03: docker-compose mounts /opt/data, predicate checks content there',
  edits: [{ file: 'docker-compose.yml', search: 'retries: 3', replace: "retries: 3\n    volumes:\n      - /opt/data:/app/data" }],
  predicates: [{ type: 'content', file: '/opt/data/config.yml', pattern: 'database' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03'],
  rationale: '/opt/data is owned by root — container mounts it but app user cannot write',
});

// HF-03b: Dockerfile changes USER but predicate checks root-owned file
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03: Dockerfile sets USER node, predicate checks /etc/crontab',
  edits: [{ file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' }],
  predicates: [{ type: 'content', file: '/etc/crontab', pattern: 'node server.js' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03'],
  rationale: 'Container runs as user node but /etc/crontab is owned by root — cannot write cron entry',
});

// HF-03c: Edit adds shared volume, predicate checks other service's file
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03: Compose adds shared volume, predicate checks nginx config owned by www-data',
  edits: [{ file: 'docker-compose.yml', search: 'retries: 3', replace: "retries: 3\n    volumes:\n      - shared:/shared" }],
  predicates: [{ type: 'content', file: '/shared/nginx.conf', pattern: 'upstream' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03'],
  rationale: 'Shared volume mounted but nginx.conf is owned by www-data — app user cannot read/write',
});

// HF-03d: Edit server.js to write to /tmp owned file, predicate checks it
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03: Server.js writes lock file to /tmp/app.lock, predicate checks it exists',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nrequire('fs').writeFileSync('/tmp/app.lock', 'locked');" }],
  predicates: [{ type: 'content', file: '/tmp/app.lock', pattern: 'locked' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03'],
  rationale: '/tmp/app.lock may be owned by previous process run as different user — ownership conflict',
});

// HF-03e: Edit init.sql references data directory, predicate checks it
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03: init.sql references tablespace in /var/lib/postgresql, predicate checks there',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE users (', replace: "CREATE TABLESPACE fast LOCATION '/var/lib/postgresql/fast';\nCREATE TABLE users (" }],
  predicates: [{ type: 'content', file: '/var/lib/postgresql/fast/PG_VERSION', pattern: '15' }],
  expectedSuccess: false,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03'],
  rationale: 'PostgreSQL data directory owned by postgres user — app user has no access',
});

// HF-03f: Control — edit within app-writable directory
scenarios.push({
  id: nextId('owner'),
  description: 'HF-03 control: Edit server.js and check server.js (app-owned file)',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// ownership test" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '// ownership test' }],
  expectedSuccess: true,
  tags: ['access', 'filesystem', 'ownership_mismatch', 'HF-03', 'control'],
  rationale: 'Both edit and predicate operate on app-owned server.js — no ownership issue',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-fs scenarios -> ${outPath}`);
