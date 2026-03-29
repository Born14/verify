#!/usr/bin/env bun
/**
 * stage-filesystem-advanced.ts — Filesystem Advanced Scenario Stager
 *
 * Shapes: FS-06, FS-13, FS-25 through FS-31, FS-33, FS-35 through FS-38
 *   FS-06: Empty file treated as missing
 *   FS-13: Binary file vs text file confusion
 *   FS-25: Read-only file in app directory
 *   FS-26: Hidden files (dotfiles) excluded from checks
 *   FS-27: Symlink resolution in file checks
 *   FS-28: File timestamp vs content (modified time misleading)
 *   FS-29: Partial write (truncated file)
 *   FS-30: File lock prevents read
 *   FS-31: Race between check and use
 *   FS-33: File identity (inode change, same path)
 *   FS-35: Build output vs source mismatch
 *   FS-36: Generated file not regenerated after edit
 *   FS-37: Minification changes content shape
 *   FS-38: Source map references wrong file
 *
 * Run: bun scripts/harvest/stage-filesystem-advanced.ts
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
  rationale: string;
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `fsadv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

function push(
  prefix: string,
  desc: string,
  edits: Scenario['edits'],
  predicates: Scenario['predicates'],
  success: boolean,
  tags: string[],
  rationale: string,
  failedGate?: string,
) {
  const entry: Scenario = {
    id: nextId(prefix),
    description: desc,
    edits,
    predicates,
    expectedSuccess: success,
    tags: ['filesystem-advanced', ...tags],
    rationale,
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// =============================================================================
// FS-06: Empty file treated as missing
// An empty file exists on disk but has zero content — predicates that check
// for content patterns will fail, and existence checks may behave unexpectedly.
// =============================================================================

push('fs06', 'FS-06: Empty server.js after edit — content predicate fails',
  [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: '',
  }],
  [{ type: 'content', file: 'server.js', pattern: 'createServer' }],
  false,
  ['empty-file', 'FS-06'],
  'Removing the first line leaves server.js missing the require. The content pattern no longer matches.',
  'grounding',
);

push('fs06', 'FS-06: Config file emptied — content check fails',
  [{
    file: 'config.json',
    search: '{\n  "app": {\n    "name": "Demo App",\n    "port": 3000\n  },',
    replace: '{',
  }],
  [{ type: 'content', file: 'config.json', pattern: '"Demo App"' }],
  false,
  ['empty-file', 'FS-06'],
  'Config truncated to just "{". The pattern "Demo App" no longer exists in the file.',
  'grounding',
);

push('fs06', 'FS-06: Control — server.js has expected content',
  [],
  [{ type: 'content', file: 'server.js', pattern: "require('http')" }],
  true,
  ['empty-file', 'FS-06'],
  'Control case: server.js unmodified, content predicate matches the require statement.',
);

// =============================================================================
// FS-13: Binary file vs text file confusion
// Predicates designed for text content applied to binary-like data or vice versa.
// =============================================================================

push('fs13', 'FS-13: Binary-like content injected — content predicate with non-UTF8 pattern fails',
  [{
    file: 'server.js',
    search: "res.end('Not Found');",
    replace: "res.end('Not Found'); // \x00\x01\x02 binary marker",
  }],
  [{ type: 'content', file: 'server.js', pattern: 'binary marker' }],
  true,
  ['binary-confusion', 'FS-13'],
  'The text "binary marker" is present even though preceded by null bytes in a comment. Content predicate matches the text portion.',
);

push('fs13', 'FS-13: Checking for binary PNG header in text file — fails',
  [],
  [{ type: 'content', file: 'server.js', pattern: '\x89PNG' }],
  false,
  ['binary-confusion', 'FS-13'],
  'server.js is a text file. The PNG magic bytes do not exist. Content predicate fails.',
  'grounding',
);

push('fs13', 'FS-13: Content check on Dockerfile (text, not binary) — passes',
  [],
  [{ type: 'content', file: 'Dockerfile', pattern: 'FROM node:20-alpine' }],
  true,
  ['binary-confusion', 'FS-13'],
  'Control: Dockerfile is a text file with the expected content.',
);

// =============================================================================
// FS-25: Read-only file in app directory
// File permissions prevent modification. The verification system should handle
// this gracefully. Edits that target read-only files should fail.
// =============================================================================

push('fs25', 'FS-25: Edit targeting a file that exists — normal case passes',
  [{
    file: 'Dockerfile',
    search: 'FROM node:20-alpine',
    replace: 'FROM node:22-alpine',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'FROM node:22-alpine' }],
  true,
  ['read-only', 'FS-25'],
  'Normal edit of Dockerfile. File is writable, edit applies, content predicate matches.',
);

push('fs25', 'FS-25: Content predicate on unmodified Dockerfile — control',
  [],
  [{ type: 'content', file: 'Dockerfile', pattern: 'WORKDIR /app' }],
  true,
  ['read-only', 'FS-25'],
  'Control: Dockerfile exists with expected content. No edit needed.',
);

push('fs25', 'FS-25: Edit with wrong search string — edit application fails',
  [{
    file: 'Dockerfile',
    search: 'FROM python:3.12-slim',
    replace: 'FROM python:3.13-slim',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'FROM python:3.13-slim' }],
  false,
  ['read-only', 'FS-25'],
  'Search string does not exist in Dockerfile. Edit cannot be applied. Content predicate fails.',
  'syntax',
);

// =============================================================================
// FS-26: Hidden files (dotfiles) excluded from checks
// Dotfiles like .env, .gitignore may or may not be included in verification.
// =============================================================================

push('fs26', 'FS-26: Content check on non-dotfile — passes',
  [],
  [{ type: 'content', file: 'config.json', pattern: '"darkMode": true' }],
  true,
  ['dotfiles', 'FS-26'],
  'Control: config.json is a regular file, content predicate works normally.',
);

push('fs26', 'FS-26: Checking for dotfile content that does not exist — fails',
  [],
  [{ type: 'content', file: '.env', pattern: 'SECRET_KEY=abc123' }],
  false,
  ['dotfiles', 'FS-26'],
  'No .env file exists in the demo-app fixture. Content predicate fails grounding.',
  'grounding',
);

push('fs26', 'FS-26: Checking for .gitignore content — fabricated',
  [],
  [{ type: 'content', file: '.gitignore', pattern: 'node_modules' }],
  false,
  ['dotfiles', 'FS-26'],
  'No .gitignore exists in demo-app. Content predicate on missing dotfile fails.',
  'grounding',
);

// =============================================================================
// FS-27: Symlink resolution in file checks
// Verification should follow symlinks or explicitly handle them.
// =============================================================================

push('fs27', 'FS-27: Content predicate on real file — control passes',
  [],
  [{ type: 'content', file: 'server.js', pattern: 'Demo App' }],
  true,
  ['symlink', 'FS-27'],
  'Control: server.js is a real file. Content predicate resolves normally.',
);

push('fs27', 'FS-27: Content predicate referencing path outside app dir — fails',
  [],
  [{ type: 'content', file: '../outside-app/secret.txt', pattern: 'sensitive data' }],
  false,
  ['symlink', 'FS-27'],
  'Path traversal outside app directory. The pipeline should reject or fail to find this file.',
  'grounding',
);

// =============================================================================
// FS-28: File timestamp vs content (modified time misleading)
// File mtime can change without content change (touch) or content can change
// without mtime change (some copy operations). Verification should check content, not time.
// =============================================================================

push('fs28', 'FS-28: Same content after no-op edit — control passes',
  [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;",
  }],
  [{ type: 'content', file: 'server.js', pattern: 'const PORT = process.env.PORT || 3000;' }],
  true,
  ['timestamp', 'FS-28'],
  'No-op edit (search equals replace). File content unchanged. Content predicate still passes.',
);

push('fs28', 'FS-28: Content actually changes — predicate on old content fails',
  [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 8080;",
  }],
  [{ type: 'content', file: 'server.js', pattern: 'PORT || 3000' }],
  false,
  ['timestamp', 'FS-28'],
  'Port changed from 3000 to 8080 via edit. Old content pattern no longer matches.',
  'grounding',
);

push('fs28', 'FS-28: Content change verified with new value — passes',
  [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 8080;",
  }],
  [{ type: 'content', file: 'server.js', pattern: 'PORT || 8080' }],
  true,
  ['timestamp', 'FS-28'],
  'Edit changes port to 8080. Predicate checks for new value and matches.',
);

// =============================================================================
// FS-29: Partial write (truncated file)
// A file is only partially written — content is incomplete/corrupted.
// =============================================================================

push('fs29', 'FS-29: Truncated HTML — missing closing tags',
  [{
    file: 'server.js',
    search: "  <footer>Powered by Node.js</footer>\n</body>\n</html>`);",
    replace: "  <footer>Powered by Node.js</footer>`);",
  }],
  [{ type: 'content', file: 'server.js', pattern: '</html>' }],
  false,
  ['truncated', 'FS-29'],
  'HTML output truncated — </body></html> removed. Content predicate for </html> fails.',
  'grounding',
);

push('fs29', 'FS-29: Truncated init.sql — incomplete table definition',
  [{
    file: 'init.sql',
    search: "CREATE TABLE settings (\n    key VARCHAR(100) PRIMARY KEY,\n    value JSONB NOT NULL,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);",
    replace: 'CREATE TABLE settings (',
  }],
  [{ type: 'content', file: 'init.sql', pattern: 'JSONB NOT NULL' }],
  false,
  ['truncated', 'FS-29'],
  'Settings table definition truncated mid-way. The JSONB column no longer exists in source.',
  'grounding',
);

push('fs29', 'FS-29: Control — complete init.sql has expected content',
  [],
  [{ type: 'content', file: 'init.sql', pattern: 'CREATE TABLE settings' }],
  true,
  ['truncated', 'FS-29'],
  'Control: init.sql is complete and contains the settings table definition.',
);

// =============================================================================
// FS-30: File lock prevents read
// In real systems, a locked file cannot be read. In fixture testing, this
// manifests as content being inaccessible. We simulate via missing file reference.
// =============================================================================

push('fs30', 'FS-30: Content predicate on accessible file — control passes',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' }],
  true,
  ['file-lock', 'FS-30'],
  'Control: docker-compose.yml is accessible and contains healthcheck configuration.',
);

push('fs30', 'FS-30: Content predicate on non-existent file (simulates locked) — fails',
  [],
  [{ type: 'content', file: 'locked-file.dat', pattern: 'any content' }],
  false,
  ['file-lock', 'FS-30'],
  'File locked-file.dat does not exist. Simulates inaccessible file — content predicate fails.',
  'grounding',
);

// =============================================================================
// FS-31: Race between check and use
// File state changes between when it is checked and when it is used.
// We simulate by having an edit that changes the file after predicate setup.
// =============================================================================

push('fs31', 'FS-31: Edit changes value that predicate assumed — mismatch',
  [{
    file: 'config.json',
    search: '"port": 3000',
    replace: '"port": 4000',
  }],
  [{ type: 'content', file: 'config.json', pattern: '"port": 3000' }],
  false,
  ['race-condition', 'FS-31'],
  'Edit changes port from 3000 to 4000. Predicate expects the old value — race between intent and state.',
  'grounding',
);

push('fs31', 'FS-31: Edit and predicate agree on new value — passes',
  [{
    file: 'config.json',
    search: '"port": 3000',
    replace: '"port": 4000',
  }],
  [{ type: 'content', file: 'config.json', pattern: '"port": 4000' }],
  true,
  ['race-condition', 'FS-31'],
  'Edit and predicate both reference port 4000. No race — consistent state.',
);

// =============================================================================
// FS-33: File identity (inode change, same path)
// File replaced (delete + create) rather than modified in-place.
// Content changes but path stays the same.
// =============================================================================

push('fs33', 'FS-33: File content fully replaced — new content matches',
  [{
    file: 'config.json',
    search: '{\n  "app": {\n    "name": "Demo App",\n    "port": 3000\n  },\n  "database": {\n    "host": "localhost",\n    "port": 5432,\n    "name": "demo"\n  },\n  "features": {\n    "darkMode": true,\n    "analytics": false\n  }\n}',
    replace: '{\n  "app": {\n    "name": "Replaced App",\n    "port": 5000\n  }\n}',
  }],
  [{ type: 'content', file: 'config.json', pattern: '"Replaced App"' }],
  true,
  ['file-identity', 'FS-33'],
  'Entire config.json replaced. New content matches predicate. Path unchanged, content new.',
);

push('fs33', 'FS-33: File replaced — old content predicate fails',
  [{
    file: 'config.json',
    search: '{\n  "app": {\n    "name": "Demo App",\n    "port": 3000\n  },\n  "database": {\n    "host": "localhost",\n    "port": 5432,\n    "name": "demo"\n  },\n  "features": {\n    "darkMode": true,\n    "analytics": false\n  }\n}',
    replace: '{\n  "app": {\n    "name": "Replaced App",\n    "port": 5000\n  }\n}',
  }],
  [{ type: 'content', file: 'config.json', pattern: '"darkMode"' }],
  false,
  ['file-identity', 'FS-33'],
  'File fully replaced. Old "darkMode" key no longer exists in the new content.',
  'grounding',
);

// =============================================================================
// FS-35: Build output vs source mismatch
// Source file says one thing but the build output (Dockerfile, docker-compose)
// references something different.
// =============================================================================

push('fs35', 'FS-35: Dockerfile references correct source file — control',
  [],
  [{ type: 'content', file: 'Dockerfile', pattern: 'COPY server.js .' }],
  true,
  ['build-mismatch', 'FS-35'],
  'Control: Dockerfile copies server.js which exists. Source and build config are consistent.',
);

push('fs35', 'FS-35: Dockerfile edited to reference wrong file — content diverges',
  [{
    file: 'Dockerfile',
    search: 'COPY server.js .',
    replace: 'COPY app.js .',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'COPY server.js .' }],
  false,
  ['build-mismatch', 'FS-35'],
  'Dockerfile now references app.js instead of server.js. Predicate expects old COPY target.',
  'grounding',
);

push('fs35', 'FS-35: Source and Dockerfile agree after coordinated edit — passes',
  [{
    file: 'Dockerfile',
    search: 'COPY server.js .',
    replace: 'COPY server.js .\nCOPY config.json .',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'COPY config.json .' }],
  true,
  ['build-mismatch', 'FS-35'],
  'Adding COPY config.json to Dockerfile. Both files exist, build and source consistent.',
);

// =============================================================================
// FS-36: Generated file not regenerated after edit
// A source file is edited but the generated/derived file is stale.
// =============================================================================

push('fs36', 'FS-36: Source changed but checking generated artifact — stale check',
  [{
    file: 'server.js',
    search: '<title>Demo App</title>',
    replace: '<title>Updated App</title>',
  }],
  [{ type: 'content', file: 'server.js', pattern: '<title>Demo App</title>' }],
  false,
  ['stale-generated', 'FS-36'],
  'Source title changed to "Updated App". Predicate expects old "Demo App" title — stale expectation.',
  'grounding',
);

push('fs36', 'FS-36: Source changed and predicate matches new value — passes',
  [{
    file: 'server.js',
    search: '<title>Demo App</title>',
    replace: '<title>Updated App</title>',
  }],
  [{ type: 'content', file: 'server.js', pattern: '<title>Updated App</title>' }],
  true,
  ['stale-generated', 'FS-36'],
  'Source changed and predicate references the new value. No staleness.',
);

push('fs36', 'FS-36: Docker CMD unchanged after source rename — content check',
  [{
    file: 'Dockerfile',
    search: 'CMD ["node", "server.js"]',
    replace: 'CMD ["node", "app.js"]',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'CMD ["node", "server.js"]' }],
  false,
  ['stale-generated', 'FS-36'],
  'Dockerfile CMD changed from server.js to app.js. Predicate expects old CMD.',
  'grounding',
);

// =============================================================================
// FS-37: Minification changes content shape
// Minified files lose whitespace, comments, and readable structure.
// Content predicates must match the minified form.
// =============================================================================

push('fs37', 'FS-37: Minified CSS already in demo-app — matches minified form',
  [],
  [{ type: 'content', file: 'server.js', pattern: '.minified{color:#ff6600;font-size:14px;}' }],
  true,
  ['minification', 'FS-37'],
  'The /edge-cases route has minified CSS. Content predicate matches the exact minified string.',
);

push('fs37', 'FS-37: Predicate expects formatted version of minified CSS — fails',
  [],
  [{ type: 'content', file: 'server.js', pattern: '.minified {\n  color: #ff6600;\n}' }],
  false,
  ['minification', 'FS-37'],
  'Source has minified CSS without whitespace. Predicate expects formatted version with newlines.',
  'grounding',
);

push('fs37', 'FS-37: CSS selector from minified block — grounding passes',
  [],
  [{ type: 'css', selector: '.minified', property: 'color', expected: '#ff6600' }],
  true,
  ['minification', 'FS-37'],
  'CSS parser extracts .minified { color: #ff6600 } from minified block correctly.',
);

// =============================================================================
// FS-38: Source map references wrong file
// Source maps (.map files) can reference incorrect source files.
// Verification should check actual source, not follow source map references.
// =============================================================================

push('fs38', 'FS-38: Content predicate checks actual source, not map — passes',
  [],
  [{ type: 'content', file: 'server.js', pattern: 'const http' }],
  true,
  ['source-map', 'FS-38'],
  'Control: Content predicate reads actual server.js source, not any source map.',
);

push('fs38', 'FS-38: Fabricated .map file reference — content check fails',
  [],
  [{ type: 'content', file: 'server.js.map', pattern: '"sources":["server.ts"]' }],
  false,
  ['source-map', 'FS-38'],
  'No server.js.map exists. Source maps are not part of the demo-app fixture.',
  'grounding',
);

push('fs38', 'FS-38: Inject sourceMappingURL comment — content verifies',
  [{
    file: 'server.js',
    search: "res.end('Not Found');",
    replace: "res.end('Not Found');\n// //# sourceMappingURL=server.js.map",
  }],
  [{ type: 'content', file: 'server.js', pattern: 'sourceMappingURL=server.js.map' }],
  true,
  ['source-map', 'FS-38'],
  'Injected a sourceMappingURL comment. Content predicate verifies the text exists in source.',
);

// =============================================================================
// Write output
// =============================================================================

const outPath = resolve(__dirname, '../../fixtures/scenarios/filesystem-advanced-staged.json');
writeFileSync(outPath, JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);
