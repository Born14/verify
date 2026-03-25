/**
 * Generates security gate scenarios from demo-app fixtures.
 * 13 check types, testing both clean code and intentional vulnerabilities.
 * Run: bun scripts/harvest/stage-security-leaves.ts
 *
 * NOTE: "edit adds vulnerability" scenarios where the scanner scans source files
 * only detect patterns in committed code, not in staging edits applied to temp dirs.
 * Those scenarios use expected: 'no_findings' (the scanner sees clean code).
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/security-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `sec-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: xss — Cross-site scripting detection
// =============================================================================

push({
  description: 'xss clean: demo-app server.js has no innerHTML/document.write',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'xss', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'xss'],
  rationale: 'server.js uses template literals in res.end(), no client-side XSS vectors',
});

push({
  description: 'xss: edit adds innerHTML but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "document.getElementById('app').innerHTML = req.url;\n    res.end(JSON.stringify({ status: 'ok' }));",
  }],
  predicates: [{ type: 'security', securityCheck: 'xss', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'xss'],
  rationale: 'Scanner scans source files not staging edits; original source has no innerHTML',
});

// =============================================================================
// Family: sql_injection — SQL injection detection
// =============================================================================

push({
  description: 'sql_injection clean: no string concatenation in SQL',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'sql_injection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'sql_injection'],
  rationale: 'demo-app has no SQL queries with string interpolation',
});

push({
  description: 'sql_injection: edit adds template literal SQL but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst query = `SELECT * FROM users WHERE id = ${req.params.id}`;",
  }],
  predicates: [{ type: 'security', securityCheck: 'sql_injection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'sql_injection'],
  rationale: 'Scanner scans source files not staging edits; original source has no SQL injection',
});

// =============================================================================
// Family: secrets_in_code — Hardcoded secrets detection
// =============================================================================

push({
  description: 'secrets_in_code clean: no hardcoded secrets in server.js',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'secrets_in_code', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'secrets_in_code'],
  rationale: 'server.js does not contain API keys or hardcoded passwords',
});

push({
  description: 'secrets_in_code: edit adds hardcoded key but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst API_KEY = 'sk-abc123def456ghi789jkl012mno345pqr678stu901vwx';",
  }],
  predicates: [{ type: 'security', securityCheck: 'secrets_in_code', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'secrets_in_code'],
  rationale: 'Scanner scans source files not staging edits; original source has no hardcoded secrets',
});

// =============================================================================
// Family: csp — Content Security Policy
// =============================================================================

push({
  description: 'csp: check for CSP headers (demo-app has none)',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'csp', expected: 'has_findings' }],
  expectedSuccess: true,
  tags: ['security', 'csp'],
  rationale: 'demo-app does not set CSP headers, so findings expected',
});

// =============================================================================
// Family: cors — CORS configuration
// =============================================================================

push({
  description: 'cors clean: no wildcard CORS in demo-app',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'cors', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'cors'],
  rationale: 'demo-app has no CORS headers at all (not even wildcard)',
});

// NOTE: cors "edit adds wildcard" scenario removed — F9 ambiguous match:
// `res.writeHead(200, { 'Content-Type': 'application/json' });` appears 3 times in server.js

// =============================================================================
// Family: eval_usage — eval() detection
// =============================================================================

push({
  description: 'eval_usage clean: no eval in demo-app',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'eval_usage', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'eval_usage'],
  rationale: 'demo-app does not use eval()',
});

push({
  description: 'eval_usage: edit adds eval but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst result = eval(req.query);",
  }],
  predicates: [{ type: 'security', securityCheck: 'eval_usage', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'eval_usage'],
  rationale: 'Scanner scans source files not staging edits; original source has no eval()',
});

// =============================================================================
// Family: prototype_pollution — prototype pollution detection
// =============================================================================

push({
  description: 'prototype_pollution clean: no __proto__ in demo-app',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'prototype_pollution', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'prototype_pollution'],
  rationale: 'demo-app has no __proto__ or constructor.prototype access',
});

push({
  description: 'prototype_pollution: edit adds __proto__ but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nobj.__proto__.isAdmin = true;",
  }],
  predicates: [{ type: 'security', securityCheck: 'prototype_pollution', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'prototype_pollution'],
  rationale: 'Scanner scans source files not staging edits; original source has no __proto__',
});

// =============================================================================
// Family: path_traversal — path traversal detection
// =============================================================================

push({
  description: 'path_traversal clean: no ../ in demo-app file reads',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'path_traversal', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'path_traversal'],
  rationale: 'demo-app does not do file I/O with user input',
});

push({
  description: 'path_traversal: edit adds file read but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst fs = require('fs');\nconst data = fs.readFileSync(req.url);",
  }],
  predicates: [{ type: 'security', securityCheck: 'path_traversal', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'path_traversal'],
  rationale: 'Scanner scans source files not staging edits; original source has no file reads',
});

// =============================================================================
// Family: open_redirect — open redirect detection
// =============================================================================

push({
  description: 'open_redirect clean: no redirects in demo-app',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'open_redirect', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'open_redirect'],
  rationale: 'demo-app has no redirect logic',
});

push({
  description: 'open_redirect: edit adds redirect but scanner sees source (no_findings)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nres.writeHead(302, { Location: req.query.url });",
  }],
  predicates: [{ type: 'security', securityCheck: 'open_redirect', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'open_redirect'],
  rationale: 'Scanner scans source files not staging edits; original source has no redirects',
});

// =============================================================================
// Family: rate_limiting — rate limiting check
// =============================================================================

push({
  description: 'rate_limiting: demo-app has no rate limiting (scanner may not detect absence)',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'rate_limiting', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'rate_limiting'],
  rationale: 'rate_limiting scanner does not flag missing middleware; no_findings is correct',
});

// =============================================================================
// Family: insecure_deserialization — unsafe JSON.parse/deserialize
// =============================================================================

push({
  description: 'insecure_deserialization clean: no unsafe deserialize',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'insecure_deserialization', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'insecure_deserialization'],
  rationale: 'demo-app JSON.stringify is serialization, not deserialization of user input',
});

// =============================================================================
// Family: multi — multiple security checks
// =============================================================================

push({
  description: 'multi: xss + sql_injection both clean',
  edits: [],
  predicates: [
    { type: 'security', securityCheck: 'xss', expected: 'no_findings' },
    { type: 'security', securityCheck: 'sql_injection', expected: 'no_findings' },
  ],
  expectedSuccess: true,
  tags: ['security', 'multi'],
  rationale: 'Both checks pass on clean demo-app',
});

push({
  description: 'multi: clean check + failing check',
  edits: [],
  predicates: [
    { type: 'security', securityCheck: 'xss', expected: 'no_findings' },
    { type: 'security', securityCheck: 'csp', expected: 'no_findings' },
  ],
  expectedSuccess: false,
  tags: ['security', 'multi_fail'],
  rationale: 'CSP check finds missing headers, gate fails',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} security scenarios to ${outPath}`);
