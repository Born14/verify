#!/usr/bin/env bun
/**
 * stage-f9-leaves.ts — F9 (Syntax/Edit-Application) Scenario Stager
 *
 * Generates scenarios that exercise the F9 gate: edit search/replace validation.
 *
 * The F9 gate (syntax.ts) validates:
 *   1. Target file exists
 *   2. Search string is non-empty
 *   3. Search string appears exactly once in file (CRLF normalized to LF)
 *   Failures: file_missing, ambiguous_match (0 or >1 matches), not_found
 *
 * applyEdits() separately:
 *   1. Reads file, normalizes CRLF → LF
 *   2. Finds search, checks uniqueness
 *   3. Replaces once, writes back
 *
 * Scenario families:
 *   1.  exact_match       — search string is unique, edit applies cleanly
 *   2.  not_found          — search string doesn't exist in file
 *   3.  ambiguous_match    — search string appears >1 time
 *   4.  empty_search       — search is "" (always ambiguous)
 *   5.  file_missing       — target file doesn't exist
 *   6.  wrong_file         — search exists but in a different file
 *   7.  whitespace_mismatch — tabs vs spaces, trailing whitespace
 *   8.  case_mismatch      — wrong casing
 *   9.  partial_match      — search is substring of actual (unique occurrence)
 *   10. overlapping_edits  — multiple edits to same file
 *   11. multi_file_edits   — edits across different files
 *   12. large_search       — very long search strings (boundary)
 *   13. special_chars      — regex metacharacters, quotes, backticks, template literals
 *   14. line_ending_edits  — edits that change/introduce line endings
 *   15. create_file        — empty search + new file (currently ambiguous per F9)
 *   16. identity_edit      — search === replace (no-op)
 *   17. boundary_context   — search at start/end of file
 *   18. unicode            — non-ASCII characters in search/replace
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DEMO_DIR = resolve(__dirname, '../../fixtures/demo-app');
const SERVER_JS = readFileSync(resolve(DEMO_DIR, 'server.js'), 'utf8');
const DOCKERFILE = readFileSync(resolve(DEMO_DIR, 'Dockerfile'), 'utf8');
const DOCKER_COMPOSE = readFileSync(resolve(DEMO_DIR, 'docker-compose.yml'), 'utf8');
const CONFIG_JSON = readFileSync(resolve(DEMO_DIR, 'config.json'), 'utf8');
const INIT_SQL = readFileSync(resolve(DEMO_DIR, 'init.sql'), 'utf8');
const ENV_FILE = readFileSync(resolve(DEMO_DIR, '.env'), 'utf8');

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
  return `f9-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Dummy predicate — F9 tests don't care about predicates, they test edit validity.
// Use a trivially-true content predicate so downstream gates don't interfere.
function dummyPredicate() {
  return { type: 'content', file: 'server.js', pattern: 'http' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract unique substrings from server.js for exact-match scenarios */
function findUniqueLine(content: string, substring: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes(substring)) {
      // Verify uniqueness
      const idx1 = content.indexOf(line);
      const idx2 = content.indexOf(line, idx1 + line.length);
      if (idx2 === -1) return line;
    }
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. EXACT MATCH — unique search string, edit should pass F9
// ═════════════════════════════════════════════════════════════════════════════

const UNIQUE_SEARCHES: Array<{ file: string; search: string; replace: string; desc: string }> = [
  {
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 8080;",
    desc: 'change port number',
  },
  {
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: "if (req.url === '/healthz') {",
    desc: 'rename health endpoint',
  },
  {
    file: 'server.js',
    search: "{ id: 1, name: 'Alpha' },",
    replace: "{ id: 1, name: 'Omega' },",
    desc: 'rename API item',
  },
  {
    file: 'server.js',
    search: "<title>About - Demo App</title>",
    replace: "<title>About Us - Demo App</title>",
    desc: 'change about page title',
  },
  {
    file: 'server.js',
    search: ".hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }",
    replace: ".hero { background: #e74c3c; color: white; padding: 2rem; border-radius: 8px; }",
    desc: 'change hero background color',
  },
  {
    file: 'Dockerfile',
    search: "FROM node:20-alpine",
    replace: "FROM node:22-alpine",
    desc: 'upgrade Node version in Dockerfile',
  },
  {
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 5',
    desc: 'increase healthcheck retries',
  },
  {
    file: 'config.json',
    search: '"darkMode": true',
    replace: '"darkMode": false',
    desc: 'toggle dark mode in config',
  },
  {
    file: 'init.sql',
    search: 'username VARCHAR(50) NOT NULL UNIQUE,',
    replace: 'username VARCHAR(100) NOT NULL UNIQUE,',
    desc: 'widen username column',
  },
  {
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=true',
    desc: 'enable debug mode',
  },
];

for (const s of UNIQUE_SEARCHES) {
  scenarios.push({
    id: nextId('exact'),
    description: `F9 exact match: ${s.desc} in ${s.file}`,
    edits: [{ file: s.file, search: s.search, replace: s.replace }],
    predicates: [dummyPredicate()],
    expectedSuccess: true,
    tags: ['f9', 'exact-match', 'should-pass', s.file.replace(/[^a-z0-9]/gi, '-')],
    rationale: `Search string "${s.search.substring(0, 40)}..." is unique in ${s.file}, F9 should pass`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. NOT FOUND — search string doesn't exist anywhere in file
// ═════════════════════════════════════════════════════════════════════════════

const FABRICATED_SEARCHES: Array<{ file: string; search: string; desc: string }> = [
  { file: 'server.js', search: 'const express = require("express");', desc: 'express import (not used)' },
  { file: 'server.js', search: 'app.listen(3000)', desc: 'express-style listen (wrong API)' },
  { file: 'server.js', search: 'class UserController {', desc: 'fabricated class' },
  { file: 'server.js', search: 'module.exports = server;', desc: 'fabricated export' },
  { file: 'server.js', search: "res.json({ ok: true })", desc: 'express-style res.json (wrong API)' },
  { file: 'Dockerfile', search: 'RUN npm install', desc: 'npm install not in Dockerfile' },
  { file: 'Dockerfile', search: 'COPY package.json .', desc: 'package.json not copied' },
  { file: 'config.json', search: '"redis": { "host": "localhost" }', desc: 'fabricated redis config' },
  { file: 'init.sql', search: 'CREATE TABLE orders (', desc: 'fabricated orders table' },
  { file: '.env', search: 'REDIS_URL=redis://localhost:6379', desc: 'fabricated redis env var' },
];

for (const s of FABRICATED_SEARCHES) {
  scenarios.push({
    id: nextId('notfound'),
    description: `F9 not found: ${s.desc} in ${s.file}`,
    edits: [{ file: s.file, search: s.search, replace: 'REPLACED' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'not-found', 'should-fail', s.file.replace(/[^a-z0-9]/gi, '-')],
    rationale: `Search string "${s.search.substring(0, 40)}" doesn't exist in ${s.file}`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. AMBIGUOUS MATCH — search string appears >1 time
// ═════════════════════════════════════════════════════════════════════════════

// Find strings that genuinely appear multiple times in server.js
const AMBIGUOUS_SEARCHES: Array<{ file: string; search: string; desc: string; minCount: number }> = [
  // "res.writeHead(200" appears many times (one per route)
  { file: 'server.js', search: "res.writeHead(200", desc: 'res.writeHead appears in every route', minCount: 2 },
  // "Content-Type" appears many times
  { file: 'server.js', search: "Content-Type", desc: 'Content-Type header in every response', minCount: 2 },
  // "return;" appears at end of each route handler
  { file: 'server.js', search: "  return;", desc: 'return statement in every route', minCount: 2 },
  // "text/html" appears in multiple routes
  { file: 'server.js', search: "text/html", desc: 'text/html in multiple routes', minCount: 2 },
  // ".nav-link" appears in multiple style blocks
  { file: 'server.js', search: '.nav-link', desc: '.nav-link selector appears in multiple pages', minCount: 2 },
  // "font-family:" appears in multiple style blocks
  { file: 'server.js', search: 'font-family:', desc: 'font-family in multiple style blocks', minCount: 2 },
  // "<footer>" appears on multiple pages
  { file: 'server.js', search: '<footer>', desc: 'footer element on multiple pages', minCount: 2 },
  // "border-radius: 4px" is used many times
  { file: 'server.js', search: 'border-radius: 4px;', desc: 'common border-radius value', minCount: 2 },
  // "padding:" appears many times
  { file: 'server.js', search: 'padding: 0.5rem;', desc: 'common padding value', minCount: 2 },
  // "color: white" appears multiple times
  { file: 'server.js', search: 'color: white;', desc: 'color: white in multiple selectors', minCount: 2 },
];

for (const s of AMBIGUOUS_SEARCHES) {
  // Verify it actually IS ambiguous
  let count = 0;
  let idx = 0;
  const normalized = (s.file === 'server.js' ? SERVER_JS : '').replace(/\r\n/g, '\n');
  while (true) {
    idx = normalized.indexOf(s.search, idx);
    if (idx === -1) break;
    count++;
    idx += s.search.length;
  }

  if (count < s.minCount) {
    console.warn(`WARNING: "${s.search}" only found ${count} times (expected ${s.minCount}+). Skipping.`);
    continue;
  }

  scenarios.push({
    id: nextId('ambig'),
    description: `F9 ambiguous: ${s.desc} (${count} occurrences)`,
    edits: [{ file: s.file, search: s.search, replace: 'AMBIGUOUS_REPLACE' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'ambiguous-match', 'should-fail', `count-${count}`],
    rationale: `"${s.search.substring(0, 40)}" appears ${count} times in ${s.file} — F9 rejects ambiguous edits`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. EMPTY SEARCH — always treated as ambiguous
// ═════════════════════════════════════════════════════════════════════════════

for (const file of ['server.js', 'Dockerfile', 'config.json']) {
  scenarios.push({
    id: nextId('empty'),
    description: `F9 empty search string in ${file}`,
    edits: [{ file, search: '', replace: 'INJECTED_CONTENT' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'empty-search', 'should-fail', file.replace(/[^a-z0-9]/gi, '-')],
    rationale: 'Empty search string matches every position — F9 rejects as ambiguous',
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. FILE MISSING — target file doesn't exist
// ═════════════════════════════════════════════════════════════════════════════

const MISSING_FILES = [
  'nonexistent.js',
  'src/app.ts',
  'package.json',
  'README.md',
  '../escape.js',
  'server.JS',  // case-sensitive filesystem
  'Server.js',  // wrong casing
];

for (const file of MISSING_FILES) {
  scenarios.push({
    id: nextId('missing'),
    description: `F9 file missing: ${file}`,
    edits: [{ file, search: 'anything', replace: 'replaced' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'file-missing', 'should-fail'],
    rationale: `File "${file}" does not exist in demo-app`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. WRONG FILE — search exists but in a different file than targeted
// ═════════════════════════════════════════════════════════════════════════════

const WRONG_FILE_EDITS: Array<{ file: string; search: string; desc: string }> = [
  // server.js content searched in Dockerfile
  { file: 'Dockerfile', search: "const http = require('http');", desc: 'JS code searched in Dockerfile' },
  // Dockerfile content searched in server.js
  { file: 'server.js', search: 'FROM node:20-alpine', desc: 'Dockerfile directive searched in server.js' },
  // SQL searched in config.json
  { file: 'config.json', search: 'CREATE TABLE users (', desc: 'SQL searched in config.json' },
  // config.json content searched in init.sql
  { file: 'init.sql', search: '"darkMode": true', desc: 'JSON searched in SQL file' },
];

for (const s of WRONG_FILE_EDITS) {
  scenarios.push({
    id: nextId('wrongfile'),
    description: `F9 wrong file: ${s.desc}`,
    edits: [{ file: s.file, search: s.search, replace: 'REPLACED' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'wrong-file', 'not-found', 'should-fail'],
    rationale: `Search string exists but in a different file than "${s.file}"`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. WHITESPACE MISMATCH — tabs/spaces/trailing whitespace differences
// ═════════════════════════════════════════════════════════════════════════════

const WHITESPACE_EDITS: Array<{ search: string; desc: string }> = [
  // Tab instead of spaces
  { search: "\tbody { font-family: sans-serif;", desc: 'tab instead of spaces in CSS indent' },
  // Extra space in property
  { search: "color:  #1a1a2e;", desc: 'double space after colon' },
  // Trailing whitespace
  { search: "const PORT = process.env.PORT || 3000; ", desc: 'trailing space after semicolon' },
  // No space around operator
  { search: "const PORT=process.env.PORT||3000;", desc: 'no spaces around operators' },
  // Different indentation level
  { search: "        if (req.url === '/health') {", desc: 'wrong indentation depth (8 spaces vs 2)' },
];

for (const s of WHITESPACE_EDITS) {
  scenarios.push({
    id: nextId('whitespace'),
    description: `F9 whitespace mismatch: ${s.desc}`,
    edits: [{ file: 'server.js', search: s.search, replace: 'REPLACED' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'whitespace-mismatch', 'not-found', 'should-fail'],
    rationale: `Whitespace difference causes indexOf to miss: ${s.desc}`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. CASE MISMATCH — wrong casing in search string
// ═════════════════════════════════════════════════════════════════════════════

const CASE_MISMATCHES: Array<{ search: string; desc: string }> = [
  { search: "Const http = require('http');", desc: 'Const instead of const' },
  { search: "CONST HTTP = REQUIRE('HTTP');", desc: 'all caps' },
  { search: "Content-type", desc: 'Content-type instead of Content-Type' },
  { search: "APPLICATION/JSON", desc: 'uppercase MIME type' },
  { search: ".Hero { background:", desc: '.Hero instead of .hero' },
  { search: "CREATE TABLE Users (", desc: 'Users instead of users (SQL)' },
];

for (const s of CASE_MISMATCHES) {
  scenarios.push({
    id: nextId('case'),
    description: `F9 case mismatch: ${s.desc}`,
    edits: [{ file: 'server.js', search: s.search, replace: 'REPLACED' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'case-mismatch', 'not-found', 'should-fail'],
    rationale: `F9 uses indexOf (case-sensitive): ${s.desc}`,
  });
}

// case mismatch in SQL file
scenarios.push({
  id: nextId('case'),
  description: 'F9 case mismatch: CREATE TABLE Users (SQL, wrong case)',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE Users (', replace: 'CREATE TABLE Users (' }],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'case-mismatch', 'not-found', 'should-fail', 'init-sql'],
  rationale: 'F9 case-sensitive: "Users" vs "users" in init.sql',
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. PARTIAL MATCH — search is a substring that's unique (should PASS F9)
//    vs substring that's ambiguous (should FAIL F9)
// ═════════════════════════════════════════════════════════════════════════════

// Unique substrings — should pass
const UNIQUE_SUBSTRINGS: Array<{ search: string; desc: string }> = [
  { search: "process.env.PORT || 3000", desc: 'partial line — port default' },
  { search: "{ status: 'ok' }", desc: 'health response body' },
  { search: ".hero .hero-title { color: white; font-size: 2.5rem; }", desc: 'nested CSS rule' },
  { search: "server.listen(PORT", desc: 'listen call (partial)' },
];

for (const s of UNIQUE_SUBSTRINGS) {
  // Verify uniqueness
  const normalized = SERVER_JS.replace(/\r\n/g, '\n');
  let count = 0;
  let idx = 0;
  while (true) {
    idx = normalized.indexOf(s.search, idx);
    if (idx === -1) break;
    count++;
    idx += s.search.length;
  }

  if (count !== 1) {
    console.warn(`WARNING: "${s.search}" found ${count} times (expected 1). Skipping.`);
    continue;
  }

  scenarios.push({
    id: nextId('partial'),
    description: `F9 partial match (unique): ${s.desc}`,
    edits: [{ file: 'server.js', search: s.search, replace: s.search }],
    predicates: [dummyPredicate()],
    expectedSuccess: true,
    tags: ['f9', 'partial-match', 'should-pass'],
    rationale: `Substring "${s.search.substring(0, 40)}" appears exactly once — valid F9 edit`,
  });
}

// Ambiguous substrings — should fail
const AMBIGUOUS_SUBSTRINGS: Array<{ search: string; desc: string }> = [
  { search: 'res.end(', desc: 'res.end( appears in every route' },
  { search: 'req.url', desc: 'req.url appears in every route check' },
  { search: '200', desc: '200 appears many times (status codes, CSS values)' },
  { search: 'color:', desc: 'color: is in many CSS rules' },
];

for (const s of AMBIGUOUS_SUBSTRINGS) {
  const normalized = SERVER_JS.replace(/\r\n/g, '\n');
  let count = 0;
  let idx = 0;
  while (true) {
    idx = normalized.indexOf(s.search, idx);
    if (idx === -1) break;
    count++;
    idx += s.search.length;
  }

  if (count <= 1) {
    console.warn(`WARNING: "${s.search}" found ${count} times (expected >1). Skipping.`);
    continue;
  }

  scenarios.push({
    id: nextId('partial'),
    description: `F9 partial match (ambiguous): ${s.desc} (${count}x)`,
    edits: [{ file: 'server.js', search: s.search, replace: 'REPLACED' }],
    predicates: [dummyPredicate()],
    expectedSuccess: false,
    expectedFailedGate: 'F9',
    tags: ['f9', 'partial-match', 'ambiguous-match', 'should-fail', `count-${count}`],
    rationale: `Short substring "${s.search}" matches ${count} locations — ambiguous`,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. OVERLAPPING EDITS — multiple edits targeting the same file
// ═════════════════════════════════════════════════════════════════════════════

// Two valid edits to the same file — should pass
scenarios.push({
  id: nextId('overlap'),
  description: 'F9 overlapping: two valid edits to server.js (different regions)',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = process.env.PORT || 8080;",
    },
    {
      file: 'server.js',
      search: "<title>About - Demo App</title>",
      replace: "<title>About Us</title>",
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'overlapping-edits', 'same-file', 'should-pass'],
  rationale: 'Two edits to server.js with non-overlapping unique search strings — both pass F9',
});

// One valid + one invalid edit to same file — should fail
scenarios.push({
  id: nextId('overlap'),
  description: 'F9 overlapping: one valid + one fabricated edit to server.js',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = 8080;",
    },
    {
      file: 'server.js',
      search: 'const express = require("express");',
      replace: 'FABRICATED',
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'overlapping-edits', 'same-file', 'should-fail', 'mixed-valid'],
  rationale: 'Second edit search string is fabricated — F9 rejects entire batch',
});

// Two edits that would make each other's search ambiguous after apply
// (F9 validates BEFORE applying, so this should pass — each search is unique in original)
scenarios.push({
  id: nextId('overlap'),
  description: 'F9 overlapping: edits that would create ambiguity post-apply (but F9 checks pre-apply)',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = process.env.PORT || 3000;\nconst HOST = '0.0.0.0';",
    },
    {
      file: 'server.js',
      search: "const http = require('http');",
      replace: "const http = require('http');\nconst HOST = '0.0.0.0';",
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'overlapping-edits', 'post-apply-ambiguity', 'should-pass'],
  rationale: 'F9 validates each search against the original file content, not after prior edits applied',
});

// Edit where first edit changes text that second edit searches for
// F9 passes (both searches unique in original file), but applyEdits() fails:
// after first edit replaces the line, second search string no longer exists.
// This is correct behavior — cascading edit conflicts should fail.
scenarios.push({
  id: nextId('overlap'),
  description: 'F9 overlapping: second edit searches for text the first edit removes (cascade conflict)',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = 8080;",
    },
    {
      file: 'server.js',
      // This search is unique in the original file but destroyed by first edit
      search: "process.env.PORT || 3000",
      replace: "8080",
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  tags: ['f9', 'overlapping-edits', 'cascade-conflict', 'should-fail'],
  rationale: 'F9 passes (both unique in original), but applyEdits fails — first edit destroys second search target',
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. MULTI-FILE EDITS — edits across different files (all valid)
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('multi'),
  description: 'F9 multi-file: valid edits to server.js + Dockerfile + config.json',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = process.env.PORT || 8080;",
    },
    {
      file: 'Dockerfile',
      search: "EXPOSE 3000",
      replace: "EXPOSE 8080",
    },
    {
      file: 'config.json',
      search: '"port": 3000',
      replace: '"port": 8080',
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'multi-file', 'should-pass'],
  rationale: 'All three searches are unique in their respective files',
});

// Multi-file where one file is missing
scenarios.push({
  id: nextId('multi'),
  description: 'F9 multi-file: valid server.js + missing package.json',
  edits: [
    {
      file: 'server.js',
      search: "const PORT = process.env.PORT || 3000;",
      replace: "const PORT = 8080;",
    },
    {
      file: 'package.json',
      search: '"start": "node server.js"',
      replace: '"start": "node server.js"',
    },
  ],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'multi-file', 'file-missing', 'should-fail'],
  rationale: 'package.json does not exist in demo-app — F9 fails on file_missing',
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. LARGE SEARCH — very long search strings (should still work)
// ═════════════════════════════════════════════════════════════════════════════

// Entire route handler as search string (unique, should pass)
const healthRoute = `if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }`;

scenarios.push({
  id: nextId('large'),
  description: 'F9 large search: entire /health route handler (~150 chars)',
  edits: [{ file: 'server.js', search: healthRoute, replace: healthRoute }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'large-search', 'should-pass'],
  rationale: 'Multi-line route handler is unique — large search strings are valid',
});

// Very long CSS block as search
const aboutStyleBlock = `body { font-family: Georgia, serif; margin: 3rem; background: #f9f9f9; color: #222; }
    h2 { color: #34495e; font-size: 1.5rem; }
    .hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }
    .hero .hero-title { color: white; font-size: 2.5rem; }`;

scenarios.push({
  id: nextId('large'),
  description: 'F9 large search: multi-line CSS block from /about',
  edits: [{ file: 'server.js', search: aboutStyleBlock, replace: aboutStyleBlock }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'large-search', 'multi-line', 'should-pass'],
  rationale: 'Multi-line CSS block is unique in the about route — valid edit',
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. SPECIAL CHARACTERS — regex metacharacters, quotes, backticks
// ═════════════════════════════════════════════════════════════════════════════

// Backtick template literal (search contains backtick)
scenarios.push({
  id: nextId('special'),
  description: 'F9 special chars: search containing template literal boundary',
  edits: [{
    file: 'server.js',
    search: "res.end(`<!DOCTYPE html>",
    replace: "res.end(`<!DOCTYPE html>",
  }],
  predicates: [dummyPredicate()],
  // This appears multiple times (one per HTML route)
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'special-chars', 'backtick', 'should-fail', 'ambiguous-match'],
  rationale: 'Template literal opening appears in every HTML route — ambiguous',
});

// Regex metacharacters in actual source code
scenarios.push({
  id: nextId('special'),
  description: 'F9 special chars: parentheses and pipes in search',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 9000;",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'special-chars', 'regex-metachar', 'should-pass'],
  rationale: 'F9 uses indexOf (literal match), not regex — || is matched literally',
});

// Dollar sign in template literal
scenarios.push({
  id: nextId('special'),
  description: 'F9 special chars: ${} template expression in search',
  edits: [{
    file: 'server.js',
    search: "const dynamicClass = 'status-' + (Date.now() % 2 === 0 ? 'active' : 'idle');",
    replace: "const dynamicClass = 'status-active';",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'special-chars', 'template-expression', 'should-pass'],
  rationale: 'F9 uses indexOf — template expressions are literal strings, not interpreted',
});

// Curly braces in CSS
scenarios.push({
  id: nextId('special'),
  description: 'F9 special chars: curly braces in CSS rule',
  edits: [{
    file: 'server.js',
    search: ".badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }",
    replace: ".badge { display: inline-block; background: #27ae60; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'special-chars', 'curly-braces', 'should-pass'],
  rationale: 'CSS rule with curly braces matched literally by indexOf',
});

// SQL with special chars: parentheses, single quotes, commas
scenarios.push({
  id: nextId('special'),
  description: 'F9 special chars: SQL with parens, types, constraints',
  edits: [{
    file: 'init.sql',
    search: "id SERIAL PRIMARY KEY,\n    username VARCHAR(50) NOT NULL UNIQUE,",
    replace: "id SERIAL PRIMARY KEY,\n    username VARCHAR(100) NOT NULL UNIQUE,",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'special-chars', 'sql-syntax', 'should-pass'],
  rationale: 'SQL parentheses and keywords matched literally',
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. LINE ENDING EDITS — edits involving line ending changes
// ═════════════════════════════════════════════════════════════════════════════

// Search with CRLF when file has LF (F9 normalizes both — should match)
scenarios.push({
  id: nextId('crlf'),
  description: 'F9 CRLF normalization: search with \\r\\n matches file with \\n',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;\r\n",
    replace: "const PORT = 8080;\n",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'crlf', 'normalization', 'should-pass'],
  rationale: 'F9 normalizes CRLF→LF in both file and search — should find match',
});

// Multi-line search with mixed line endings
scenarios.push({
  id: nextId('crlf'),
  description: 'F9 CRLF normalization: multi-line search with mixed line endings',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');\r\nconst PORT = process.env.PORT || 3000;",
    replace: "const http = require('http');\nconst PORT = 8080;",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'crlf', 'multi-line', 'should-pass'],
  rationale: 'CRLF normalized to LF before matching — multi-line search succeeds',
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. IDENTITY EDIT — search === replace (no-op edit)
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('identity'),
  description: 'F9 identity edit: search === replace (no-op)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'identity-edit', 'noop', 'should-pass'],
  rationale: 'F9 only validates search uniqueness — identical replace is valid',
});

scenarios.push({
  id: nextId('identity'),
  description: 'F9 identity edit: no-op on Dockerfile',
  edits: [{
    file: 'Dockerfile',
    search: 'FROM node:20-alpine',
    replace: 'FROM node:20-alpine',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'identity-edit', 'noop', 'should-pass', 'Dockerfile'],
  rationale: 'No-op edit — search is unique, replace is identical',
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. BOUNDARY CONTEXT — search at very start or end of file
// ═════════════════════════════════════════════════════════════════════════════

scenarios.push({
  id: nextId('boundary'),
  description: 'F9 boundary: search at start of file (first line)',
  edits: [{
    file: 'server.js',
    search: "const http = require('http');",
    replace: "const http = require('node:http');",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'boundary', 'start-of-file', 'should-pass'],
  rationale: 'First line of server.js is unique — valid edit',
});

scenarios.push({
  id: nextId('boundary'),
  description: 'F9 boundary: search at end of file',
  edits: [{
    file: 'server.js',
    search: "server.listen(PORT, () => {\n  console.log(`Demo app listening on port ${PORT}`);\n});",
    replace: "server.listen(PORT, () => {\n  console.log(`Server started on port ${PORT}`);\n});",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'boundary', 'end-of-file', 'should-pass'],
  rationale: 'Last lines of server.js are unique — valid edit',
});

// Search for the very first character
scenarios.push({
  id: nextId('boundary'),
  description: 'F9 boundary: single-char search "c" (first char of file)',
  edits: [{
    file: 'server.js',
    search: 'c',
    replace: 'C',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'boundary', 'single-char', 'ambiguous-match', 'should-fail'],
  rationale: 'Single character "c" appears thousands of times — ambiguous',
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. UNICODE — non-ASCII characters
// ═════════════════════════════════════════════════════════════════════════════

// Search for ASCII content but replace with Unicode
scenarios.push({
  id: nextId('unicode'),
  description: 'F9 unicode: replace with emoji (search is ASCII, valid)',
  edits: [{
    file: 'server.js',
    search: "{ status: 'ok' }",
    replace: "{ status: '✅ healthy' }",
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'unicode', 'emoji-replace', 'should-pass'],
  rationale: 'Search is valid ASCII unique match; replace containing emoji is fine for F9',
});

// Fabricated search with Unicode characters
scenarios.push({
  id: nextId('unicode'),
  description: 'F9 unicode: fabricated search with non-ASCII chars',
  edits: [{
    file: 'server.js',
    search: 'const приветствие = "hello";',
    replace: 'const greeting = "hello";',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'unicode', 'fabricated', 'not-found', 'should-fail'],
  rationale: 'Cyrillic variable name does not exist in server.js',
});

// Search containing HTML entities
scenarios.push({
  id: nextId('unicode'),
  description: 'F9 unicode: HTML entity in search (not decoded)',
  edits: [{
    file: 'server.js',
    search: 'color: #1a1a2e; font-size: 2rem; }',
    replace: 'color: #000; font-size: 2rem; }',
  }],
  predicates: [dummyPredicate()],
  // "h1 { color: #1a1a2e; font-size: 2rem; }" — but we're searching partial. Check uniqueness.
  expectedSuccess: true,
  tags: ['f9', 'unicode', 'html-context', 'should-pass'],
  rationale: 'Partial CSS rule with hex color — unique match in home page style block',
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. EDGE CASES — newlines in search, empty replace, single-char edits
// ═════════════════════════════════════════════════════════════════════════════

// Replace with empty string (deletion)
scenarios.push({
  id: nextId('edge'),
  description: 'F9 edge: replace with empty string (delete content)',
  edits: [{
    file: 'server.js',
    search: "  <div class=\"hidden\">This content is hidden via CSS.</div>\n",
    replace: '',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'edge-case', 'empty-replace', 'deletion', 'should-pass'],
  rationale: 'Deleting content (empty replace) is valid if search is unique',
});

// Single character replacement
scenarios.push({
  id: nextId('edge'),
  description: 'F9 edge: replace single unique string with single char',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": true',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: true,
  tags: ['f9', 'edge-case', 'config-toggle', 'should-pass'],
  rationale: 'Unique config key toggle — valid edit',
});

// Edit with only whitespace as search
scenarios.push({
  id: nextId('edge'),
  description: 'F9 edge: search is only whitespace (spaces)',
  edits: [{
    file: 'server.js',
    search: '    ',
    replace: '  ',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'edge-case', 'whitespace-only', 'ambiguous-match', 'should-fail'],
  rationale: 'Four spaces appears hundreds of times in indented code — ambiguous',
});

// Newline-only search
scenarios.push({
  id: nextId('edge'),
  description: 'F9 edge: search is just a newline',
  edits: [{
    file: 'server.js',
    search: '\n',
    replace: '\n\n',
  }],
  predicates: [dummyPredicate()],
  expectedSuccess: false,
  expectedFailedGate: 'F9',
  tags: ['f9', 'edge-case', 'newline-only', 'ambiguous-match', 'should-fail'],
  rationale: 'Single newline matches at every line boundary — ambiguous',
});

// ═════════════════════════════════════════════════════════════════════════════
// WRITE OUTPUT
// ═════════════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/f9-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

// ── Summary ─────────────────────────────────────────────────────────────────

const byTag: Record<string, number> = {};
for (const s of scenarios) {
  for (const tag of s.tags) {
    byTag[tag] = (byTag[tag] || 0) + 1;
  }
}

const shouldPass = scenarios.filter(s => s.expectedSuccess).length;
const shouldFail = scenarios.filter(s => !s.expectedSuccess).length;

console.log(`\n✅ Generated ${scenarios.length} F9 scenarios → ${OUTPUT_PATH}`);
console.log(`   Should pass: ${shouldPass}`);
console.log(`   Should fail: ${shouldFail}`);
console.log(`\nBy family:`);

const families = [
  'exact-match', 'not-found', 'ambiguous-match', 'empty-search',
  'file-missing', 'wrong-file', 'whitespace-mismatch', 'case-mismatch',
  'partial-match', 'overlapping-edits', 'multi-file', 'large-search',
  'special-chars', 'crlf', 'identity-edit', 'boundary',
  'unicode', 'edge-case',
];

for (const fam of families) {
  const count = byTag[fam] || 0;
  if (count > 0) console.log(`   ${fam}: ${count}`);
}
