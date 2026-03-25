#!/usr/bin/env bun
/**
 * stage-content-leaves.ts — Content/File Pattern Scenario Stager
 *
 * Generates content-predicate grounding-gate scenarios from the demo-app.
 * Content predicates check: does file X contain pattern Y?
 *
 * The grounding gate (grounding.ts:442) validates:
 *   1. File exists in appDir
 *   2. Pattern appears in file content
 *   3. Edit exemption: if pattern not found, check if edit's replace adds it
 *   4. Missing file exemption: if file doesn't exist, check if edit targets it
 *
 * Scenario types:
 *   1. pattern_exists — pattern is in file, no edit needed (should pass)
 *   2. pattern_fabricated — pattern NOT in file (should fail grounding)
 *   3. pattern_after_edit — edit adds content, predicate expects new content
 *   4. file_missing — file doesn't exist (should fail unless edit creates it)
 *   5. file_missing_edit — file doesn't exist but edit targets it
 *   6. no_file_field — missing `file` field on content predicate
 *   7. no_pattern_field — missing `pattern` field
 *   8. crlf_mismatch — line ending edge cases
 *   9. case_sensitivity — exact match vs case-insensitive
 *  10. partial_match — substring patterns
 *  11. multiline — patterns spanning multiple lines
 *  12. special_chars — regex-like characters in pattern (should be literal match)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SERVER_JS_PATH = resolve(__dirname, '../../fixtures/demo-app/server.js');
const SERVER_JS = readFileSync(SERVER_JS_PATH, 'utf8');

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `content-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// ── Real patterns from server.js ────────────────────────────────────────────

const REAL_PATTERNS = [
  "const http = require('http');",
  "const PORT = process.env.PORT || 3000;",
  "{ status: 'ok' }",
  "{ id: 1, name: 'Alpha' }",
  "{ id: 2, name: 'Beta' }",
  "res.writeHead(200",
  "Content-Type",
  "application/json",
  "text/html",
  "Demo App",
  "About This App",
  "Contact Form",
  "Edge Cases",
  "Powered by Node.js",
  "nav-link",
  ".hero",
  ".card-title",
  "font-family: sans-serif",
  "font-family: Georgia, serif",
  "color: #1a1a2e",
  "Alice",
  "Bob",
  "Carol",
];

// ── Type 1: pattern_exists — real content in file ───────────────────────────

for (const pattern of REAL_PATTERNS) {
  scenarios.push({
    id: nextId('exists'),
    description: `server.js contains "${pattern.slice(0, 50)}"`,
    edits: [],
    predicates: [{
      type: 'content',
      file: 'server.js',
      pattern,
    }],
    expectedSuccess: true,
    tags: ['content', 'pattern_exists', 'false_negative'],
  });
}

// ── Type 2: pattern_fabricated — content NOT in file ────────────────────────

const FABRICATED_PATTERNS = [
  'SuperSecretAPIKey',
  'class DatabaseConnection {',
  'app.use(express.json())',
  'mongoose.connect(',
  'import React from',
  'process.env.SECRET_TOKEN',
  'WebSocket',
  'GraphQL',
  'DROP TABLE',
  'eval(req.body)',
];

for (const pattern of FABRICATED_PATTERNS) {
  scenarios.push({
    id: nextId('fab'),
    description: `server.js does NOT contain "${pattern}" (fabricated)`,
    edits: [],
    predicates: [{
      type: 'content',
      file: 'server.js',
      pattern,
    }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['content', 'pattern_fabricated', 'false_positive'],
  });
}

// ── Type 3: pattern_after_edit — edit adds new content ──────────────────────

const EDIT_ADDITIONS = [
  {
    search: "res.end('Not Found');",
    replace: "res.end('Not Found — Custom 404');",
    pattern: 'Custom 404',
    desc: 'Edit changes 404 message, predicate expects new text',
  },
  {
    search: "{ id: 2, name: 'Beta' }",
    replace: "{ id: 2, name: 'Beta' },\n      { id: 3, name: 'Gamma' }",
    pattern: 'Gamma',
    desc: 'Edit adds item, predicate expects new item name',
  },
  {
    search: "{ status: 'ok' }",
    replace: "{ status: 'ok', version: '2.0.0' }",
    pattern: "version: '2.0.0'",
    desc: 'Edit adds version to health, predicate expects version string',
  },
  {
    search: '<footer>Powered by Node.js</footer>',
    replace: '<footer>Powered by Node.js | Built with Sovereign</footer>',
    pattern: 'Built with Sovereign',
    desc: 'Edit adds footer text, predicate expects new text',
  },
];

for (const addition of EDIT_ADDITIONS) {
  scenarios.push({
    id: nextId('edit'),
    description: addition.desc,
    edits: [{
      file: 'server.js',
      search: addition.search,
      replace: addition.replace,
    }],
    predicates: [{
      type: 'content',
      file: 'server.js',
      pattern: addition.pattern,
    }],
    expectedSuccess: true,
    tags: ['content', 'pattern_after_edit', 'false_negative'],
  });
}

// Edit doesn't match the file field — pattern not in source, edit targets different file
scenarios.push({
  id: nextId('edit'),
  description: 'Edit targets server.js but predicate checks nonexistent.js (wrong file)',
  edits: [{
    file: 'server.js',
    search: "{ status: 'ok' }",
    replace: "{ status: 'ok', newField: true }",
  }],
  predicates: [{
    type: 'content',
    file: 'nonexistent.js',
    pattern: 'newField',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['content', 'pattern_after_edit', 'false_positive'],
});

// ── Type 4: file_missing — file doesn't exist ──────────────────────────────

const MISSING_FILES = [
  'routes.js',
  'config.json',
  'utils/helpers.js',
  'middleware/auth.js',
  '../../../etc/passwd',  // path traversal attempt
];

for (const file of MISSING_FILES) {
  scenarios.push({
    id: nextId('miss'),
    description: `File "${file}" does not exist`,
    edits: [],
    predicates: [{
      type: 'content',
      file,
      pattern: 'anything',
    }],
    expectedSuccess: false,
    expectedFailedGate: 'grounding',
    tags: ['content', 'file_missing', 'false_positive'],
  });
}

// ── Type 5: file_missing_edit — file doesn't exist but edit creates it ──────

// Note: F9 gate rejects missing-file edits before grounding runs.
// The grounding gate WOULD pass this (edit targets the file), but F9 blocks first.
scenarios.push({
  id: nextId('create'),
  description: 'File routes.js missing — F9 rejects before grounding (edit targets nonexistent file)',
  edits: [{
    file: 'routes.js',
    search: '',
    replace: 'module.exports = {};',
  }],
  predicates: [{
    type: 'content',
    file: 'routes.js',
    pattern: 'module.exports',
  }],
  expectedSuccess: false,  // F9 rejects — file doesn't exist to apply edit
  expectedFailedGate: 'F9',
  tags: ['content', 'file_missing_edit', 'false_positive'],
});

// ── Type 6: no_file_field — missing required fields ─────────────────────────

scenarios.push({
  id: nextId('nofile'),
  description: 'Content predicate with no file field (skips grounding)',
  edits: [],
  predicates: [{
    type: 'content',
    pattern: 'something',
  }],
  expectedSuccess: true,  // grounding gate requires both file AND pattern to engage
  tags: ['content', 'no_file_field', 'false_negative'],
});

// ── Type 7: no_pattern_field — missing pattern ──────────────────────────────

scenarios.push({
  id: nextId('nopat'),
  description: 'Content predicate with no pattern field (skips grounding)',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
  }],
  expectedSuccess: true,  // grounding gate requires both file AND pattern
  tags: ['content', 'no_pattern_field', 'false_negative'],
});

// ── Type 8: case_sensitivity — exact match required ─────────────────────────

// Note: "demo app" appears as substring in "demo application" (meta description line 247)
scenarios.push({
  id: nextId('case'),
  description: 'Pattern "demo app" (lowercase) — found in "demo application" (substring match)',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'demo app',
  }],
  expectedSuccess: true,  // includes() finds "demo app" inside "demo application"
  tags: ['content', 'case_sensitivity', 'false_negative'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Pattern "DEMO APP" (uppercase) — not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'DEMO APP',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['content', 'case_sensitivity', 'false_positive'],
});

scenarios.push({
  id: nextId('case'),
  description: 'Pattern "Demo App" (exact case) — in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'Demo App',
  }],
  expectedSuccess: true,
  tags: ['content', 'case_sensitivity', 'false_negative'],
});

// ── Type 9: partial_match — substring matching ──────────────────────────────

scenarios.push({
  id: nextId('partial'),
  description: 'Single character "e" — exists everywhere (trivially true)',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'e',
  }],
  expectedSuccess: true,
  tags: ['content', 'partial_match', 'false_negative'],
});

scenarios.push({
  id: nextId('partial'),
  description: 'Partial class name "nav-" — substring of "nav-link"',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'nav-',
  }],
  expectedSuccess: true,
  tags: ['content', 'partial_match', 'false_negative'],
});

scenarios.push({
  id: nextId('partial'),
  description: 'Partial HTML tag "<h1" — matches opening tag',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: '<h1',
  }],
  expectedSuccess: true,
  tags: ['content', 'partial_match', 'false_negative'],
});

// ── Type 10: multiline — patterns spanning lines ────────────────────────────

scenarios.push({
  id: nextId('multi'),
  description: 'Multiline pattern: two consecutive items',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: "{ id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' }",
  }],
  expectedSuccess: true,
  tags: ['content', 'multiline', 'false_negative'],
});

scenarios.push({
  id: nextId('multi'),
  description: 'Multiline pattern with wrong whitespace (tabs vs spaces)',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: "{ id: 1, name: 'Alpha' },\n\t{ id: 2, name: 'Beta' }",
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['content', 'multiline', 'false_positive'],
});

// ── Type 11: special_chars — regex metacharacters as literal content ─────────

const SPECIAL_CHAR_PATTERNS = [
  { pattern: '{ id: 1, name:', desc: 'Curly braces (JSON-like)' },
  { pattern: "('http');", desc: 'Parentheses and quotes' },
  { pattern: 'process.env.PORT || 3000', desc: 'Logical OR operator' },
  { pattern: '0.5rem 0', desc: 'Decimal point' },
  { pattern: 'color: #1a1a2e', desc: 'Hash character' },
  { pattern: '<style>', desc: 'Angle brackets' },
  { pattern: 'font-size: 2rem', desc: 'Colon and space' },
];

for (const { pattern, desc } of SPECIAL_CHAR_PATTERNS) {
  scenarios.push({
    id: nextId('special'),
    description: `Special chars: ${desc} — "${pattern.slice(0, 40)}"`,
    edits: [],
    predicates: [{
      type: 'content',
      file: 'server.js',
      pattern,
    }],
    expectedSuccess: true,
    tags: ['content', 'special_chars', 'false_negative'],
  });
}

// ── Type 12: empty/whitespace patterns ──────────────────────────────────────

scenarios.push({
  id: nextId('edge'),
  description: 'Empty pattern "" — substring of everything',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: '',
  }],
  expectedSuccess: true,  // grounding requires both file AND pattern — empty pattern skips
  tags: ['content', 'edge_case', 'false_negative'],
});

scenarios.push({
  id: nextId('edge'),
  description: 'Whitespace-only pattern "  " — two spaces exist in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: '  ',
  }],
  expectedSuccess: true,  // indented source has double spaces
  tags: ['content', 'edge_case', 'false_negative'],
});

// ── Type 13: docker-compose.yml and Dockerfile (other fixture files) ────────

scenarios.push({
  id: nextId('other'),
  description: 'Dockerfile contains "HEALTHCHECK"',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'Dockerfile',
    pattern: 'HEALTHCHECK',
  }],
  expectedSuccess: true,
  tags: ['content', 'other_files', 'false_negative'],
});

scenarios.push({
  id: nextId('other'),
  description: 'docker-compose.yml contains "services"',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'docker-compose.yml',
    pattern: 'services',
  }],
  expectedSuccess: true,
  tags: ['content', 'other_files', 'false_negative'],
});

scenarios.push({
  id: nextId('other'),
  description: 'Dockerfile does NOT contain "RUN apt-get" (fabricated)',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'Dockerfile',
    pattern: 'RUN apt-get install',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['content', 'other_files', 'false_positive'],
});

// ── Summary ─────────────────────────────────────────────────────────────────

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/content-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const typeCounts: Record<string, number> = {};
const intentCounts: Record<string, number> = {};
for (const s of scenarios) {
  const type = s.tags[1] || 'unknown';
  typeCounts[type] = (typeCounts[type] || 0) + 1;
  const intent = s.tags[2] || 'unknown';
  intentCounts[intent] = (intentCounts[intent] || 0) + 1;
}

console.log(`Generated ${scenarios.length} content scenarios → ${OUTPUT_PATH}\n`);
console.log('By type:');
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(22)} ${count}`);
}
console.log('\nBy intent:');
for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${intent.padEnd(22)} ${count}`);
}
