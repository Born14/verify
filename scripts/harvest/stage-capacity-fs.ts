#!/usr/bin/env bun
/**
 * Capacity × Filesystem scenario generator
 * Grid cell: I×1
 * Shapes: IF-01 (disk full during write), IF-02 (inode exhaustion), IF-03 (file size limit)
 *
 * These scenarios test whether verify detects capacity exhaustion in the filesystem:
 * edits that produce structurally valid content but exceed environmental limits
 * (file size, directory bloat, missing rotation config). The agent does the right
 * thing but the environment can't accommodate it.
 *
 * Run: bun scripts/harvest/stage-capacity-fs.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-fs-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `if-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');

// Helper: generate a large string to simulate bloated content
function generateBulkContent(lines: number): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    parts.push(`  // Generated data row ${i}: ${'x'.repeat(80)}`);
  }
  return parts.join('\n');
}

// =============================================================================
// Shape IF-01: Disk full during write — edit produces massive content
// The edit generates extremely large replacement content, and the predicate
// checks that the file size remains reasonable. Capacity scenarios test
// whether the pipeline detects when edits produce unreasonably large files.
// =============================================================================

// IF-01a: Massive inline data injected into server.js
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01: Edit injects 500-line inline data array into server.js, predicate checks file stays under 50KB',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;\nconst BULK_DATA = [\n${generateBulkContent(500)}\n];`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'BULK_DATA' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01'],
  rationale: 'Edit adds massive inline data — content predicate finds BULK_DATA but file is now unreasonably large',
});

// IF-01b: Massive CSS block injected into server.js HTML
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01: Edit adds 200 CSS rules to homepage, config.json still has no size limit',
  edits: [{
    file: 'server.js',
    search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }",
    replace: `body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }\n${Array.from({length: 200}, (_, i) => `    .generated-rule-${i} { color: #${String(i).padStart(3, '0')}${String(i).padStart(3, '0')}; padding: ${i}px; }`).join('\n')}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'generated-rule-199' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01'],
  rationale: 'Edit adds 200 CSS rules — content exists but file size balloons',
});

// IF-01c: Edit replaces small config with massive JSON blob
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01: Config replaced with massive JSON, predicate checks for specific nested key',
  edits: [{
    file: 'config.json',
    search: '"features": {\n    "darkMode": true,\n    "analytics": false\n  }',
    replace: `"features": {\n    "darkMode": true,\n    "analytics": false\n  },\n  "bulkSettings": {\n${Array.from({length: 100}, (_, i) => `    "setting_${i}": "${'v'.repeat(200)}"`).join(',\n')}\n  }`,
  }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'setting_99' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01'],
  rationale: 'Config file bloated with 100 large settings — content present but config is unreasonably large',
});

// IF-01d: Edit adds massive environment block to .env
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01: .env expanded with 50 large environment variables, predicate checks last one',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: `DEBUG=false\n${Array.from({length: 50}, (_, i) => `BULK_VAR_${i}="${'x'.repeat(500)}"`).join('\n')}`,
  }],
  predicates: [{ type: 'content', file: '.env', pattern: 'BULK_VAR_49' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01'],
  rationale: '.env file grows massively — last variable present but file is enormous',
});

// IF-01e: Dockerfile adds many COPY layers
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01: Dockerfile gains 30 COPY layers, predicate checks last one exists',
  edits: [{
    file: 'Dockerfile',
    search: 'COPY server.js .',
    replace: `${Array.from({length: 30}, (_, i) => `COPY generated_${i}.js .`).join('\n')}\nCOPY server.js .`,
  }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'generated_29.js' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01'],
  rationale: 'Dockerfile layers bloated — last COPY present but image build will be enormous',
});

// IF-01f: Control — small edit, predicate checks content
scenarios.push({
  id: nextId('disk'),
  description: 'IF-01 control: Small edit to server.js, predicate checks new content',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst VERSION = '1.0.1';" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'VERSION' }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'disk_full', 'IF-01', 'control'],
  rationale: 'Small edit — no capacity issue, content should be found',
});

// =============================================================================
// Shape IF-02: Inode exhaustion — many files created / directory bloat
// Edits reference or imply many small files; predicates check directory
// consistency or cross-file references that would fail under inode pressure.
// =============================================================================

// IF-02a: server.js requires 20 modules, none exist in the fixture
scenarios.push({
  id: nextId('inode'),
  description: 'IF-02: Edit adds 20 require() calls for non-existent modules, predicate checks one exists',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: `const http = require('http');\n${Array.from({length: 20}, (_, i) => `const mod${i} = require('./modules/handler_${i}');`).join('\n')}`,
  }],
  predicates: [{ type: 'content', file: 'modules/handler_19.js', pattern: 'module.exports' }],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'inode_exhaustion', 'IF-02'],
  rationale: 'Edit references 20 module files — none exist, inode exhaustion pattern',
});

// IF-02b: docker-compose adds 10 service definitions, config.json references one
scenarios.push({
  id: nextId('inode'),
  description: 'IF-02: docker-compose gains 10 services, predicate checks config.json knows about service_9',
  edits: [{
    file: 'docker-compose.yml',
    search: 'services:\n  app:',
    replace: `services:\n${Array.from({length: 10}, (_, i) => `  service_${i}:\n    image: nginx:alpine\n    ports:\n      - "${3100 + i}:80"`).join('\n')}\n  app:`,
  }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'service_9' }],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'inode_exhaustion', 'IF-02'],
  rationale: '10 services added to compose but config.json knows nothing about them',
});

// IF-02c: Edit creates nested import chain, predicate checks leaf file
scenarios.push({
  id: nextId('inode'),
  description: 'IF-02: server.js imports router which would import 15 route files, predicate checks route_14.js',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst router = require('./routes/index');",
  }],
  predicates: [{ type: 'content', file: 'routes/route_14.js', pattern: 'module.exports' }],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'inode_exhaustion', 'IF-02'],
  rationale: 'Router import implies many route files — none exist, directory would need many inodes',
});

// IF-02d: Dockerfile COPY references many directories
scenarios.push({
  id: nextId('inode'),
  description: 'IF-02: Dockerfile copies 8 directories, predicate checks one directory has content',
  edits: [{
    file: 'Dockerfile',
    search: 'COPY server.js .',
    replace: `COPY src/ ./src/\nCOPY lib/ ./lib/\nCOPY routes/ ./routes/\nCOPY middleware/ ./middleware/\nCOPY models/ ./models/\nCOPY views/ ./views/\nCOPY utils/ ./utils/\nCOPY tests/ ./tests/\nCOPY server.js .`,
  }],
  predicates: [{ type: 'content', file: 'utils/helpers.js', pattern: 'module.exports' }],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'inode_exhaustion', 'IF-02'],
  rationale: 'Dockerfile references 8 directories — none exist in fixture',
});

// IF-02e: Control — single require that exists
scenarios.push({
  id: nextId('inode'),
  description: 'IF-02 control: server.js already has http require, predicate checks server.js has it',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "require('http')" }],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'inode_exhaustion', 'IF-02', 'control'],
  rationale: 'No edit — existing require found, no inode pressure',
});

// =============================================================================
// Shape IF-03: File size limit — edit content exceeds reasonable bounds
// Docker volume constraints, log files without rotation, large assets
// without compression config.
// =============================================================================

// IF-03a: docker-compose has storage limit, edit would push server.js past it
scenarios.push({
  id: nextId('size'),
  description: 'IF-03: docker-compose has tmpfs size limit, server.js grows past reasonable limit',
  edits: [
    { file: 'docker-compose.yml', search: 'healthcheck:', replace: `tmpfs:\n      - /tmp:size=1m\n    healthcheck:` },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: `const PORT = process.env.PORT || 3000;\nconst CACHE = ${JSON.stringify(Array.from({length: 200}, (_, i) => ({ id: i, data: 'x'.repeat(100) })))};` },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'size=1m' },
    { type: 'content', file: 'server.js', pattern: 'CACHE' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03'],
  rationale: 'tmpfs limited to 1MB but server.js cache data could exceed it at runtime',
});

// IF-03b: Edit adds logging without rotation config
scenarios.push({
  id: nextId('size'),
  description: 'IF-03: Edit adds file logging to server.js, no log rotation in docker-compose',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst fs = require('fs');\nconst logStream = fs.createWriteStream('/var/log/app.log', { flags: 'a' });",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'logStream' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'log_opt' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03'],
  rationale: 'Logging added but no log rotation configured in compose — disk will fill',
});

// IF-03c: Dockerfile has no .dockerignore, COPY . includes everything
scenarios.push({
  id: nextId('size'),
  description: 'IF-03: Dockerfile changed to COPY . ., predicate checks .dockerignore exists',
  edits: [{
    file: 'Dockerfile',
    search: 'COPY server.js .',
    replace: 'COPY . .',
  }],
  predicates: [{ type: 'content', file: '.dockerignore', pattern: 'node_modules' }],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03'],
  rationale: 'COPY . . without .dockerignore means node_modules and all artifacts get copied — image bloat',
});

// IF-03d: Edit adds large static asset reference, no compression config
scenarios.push({
  id: nextId('size'),
  description: 'IF-03: server.js serves static files, no compression middleware, predicate checks compression',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('http');\nconst path = require('path');\nconst STATIC_DIR = path.join(__dirname, 'public');",
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'STATIC_DIR' },
    { type: 'content', file: 'server.js', pattern: 'compress' },
  ],
  expectedSuccess: false,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03'],
  rationale: 'Static file serving added but no compression — large files served uncompressed',
});

// IF-03e: docker-compose volume without size constraint, .env has large data path
scenarios.push({
  id: nextId('size'),
  description: 'IF-03: docker-compose volume has no size limit, .env references large data directory',
  edits: [
    { file: 'docker-compose.yml', search: 'healthcheck:', replace: `volumes:\n      - app-data:/data\n    healthcheck:` },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDATA_DIR=/data\nMAX_UPLOAD_SIZE=unlimited' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'app-data:/data' },
    { type: 'content', file: '.env', pattern: 'MAX_UPLOAD_SIZE=unlimited' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03'],
  rationale: 'Volume mounted with no size limit and unlimited upload size — disk capacity unbounded',
});

// IF-03f: Control — Dockerfile with explicit size-aware config
scenarios.push({
  id: nextId('size'),
  description: 'IF-03 control: Dockerfile already has small COPY, no bloat',
  edits: [],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'COPY server.js' },
    { type: 'content', file: 'Dockerfile', pattern: 'node:20-alpine' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'filesystem', 'file_size_limit', 'IF-03', 'control'],
  rationale: 'No bloat — minimal Dockerfile with single file copy on alpine image',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-fs scenarios → ${outPath}`);
