#!/usr/bin/env bun
/**
 * stage-http-advanced.ts — HTTP Advanced Scenario Stager
 *
 * Covers 31 uncovered HTTP failure shapes from FAILURE-TAXONOMY.md:
 *   Request Handling:  P-13,P-14,P-31,P-32,P-33,P-34,P-36,P-37,P-38
 *   Network/Protocol:  P-17,P-18,P-19,P-20,P-39,P-40,P-41,P-42,P-43,P-44,P-45
 *   Advanced Protocol: P-46,P-47,P-48,P-49,P-50,P-51,P-52,P-53,P-54
 *   Cross-cutting:     P-27,P-28
 *
 * Pure tier — HTTP predicates validated structurally against source code.
 * Cross-cutting gates scan ONLY edit.replace content, not the full file.
 *
 * Run: bun scripts/harvest/stage-http-advanced.ts
 * Output: fixtures/scenarios/http-advanced-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/http-advanced-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `http-adv-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// Anchor lines from demo-app/server.js
const HEALTH_RES   = "res.end(JSON.stringify({ status: 'ok' }));";
const HEALTH_HEAD  = "res.writeHead(200, { 'Content-Type': 'application/json' });";
const HEALTH_IF    = "if (req.url === '/health') {";
const ITEMS_IF     = "if (req.url === '/api/items') {";
const ITEMS_HEAD   = "if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json' });";
const ITEMS_RES    = "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));";
const ECHO_IF      = "if (req.url === '/api/echo' && req.method === 'POST') {";
const ECHO_RES     = "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));";
const PORT_LINE    = 'const PORT = process.env.PORT || 3000;';
const NOT_FOUND    = "res.writeHead(404, { 'Content-Type': 'text/plain' });";
const SERVER_LISTEN = "server.listen(PORT, () => {";

// Helper: single-edit on a search/replace anchor
function edit(file: string, search: string, replace: string) {
  return [{ file, search, replace }];
}

// =============================================================================
// P-13: Request headers (Authorization, custom headers)
// =============================================================================

push({
  description: 'P-13: GET with status-only check — no header body claims',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['http', 'request_headers', 'P-13'],
  rationale: 'Status-only predicate, no body claim to ground — passes',
});

push({
  description: 'P-13: Edit echoes Authorization header into response body',
  edits: edit('server.js', HEALTH_RES,
    `const auth = req.headers['authorization'] || 'none';\n    res.end(JSON.stringify({ status: 'ok', auth: auth }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'auth' } }],
  expectedSuccess: true,
  tags: ['http', 'request_headers', 'P-13'],
  rationale: 'Edit adds "auth" key to response body — grounding finds it in replace content',
});

push({
  description: 'P-13: Expects Bearer token in body — source never echoes header value',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'Bearer secret-token' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'request_headers', 'P-13'],
  rationale: 'Source has no header-echo logic; "Bearer secret-token" is fabricated',
});

// =============================================================================
// P-14: Cookie handling (Set-Cookie, cookie jar)
// =============================================================================

push({
  description: 'P-14: Edit sets Set-Cookie header — body check passes independently',
  edits: edit('server.js', HEALTH_HEAD,
    `res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=abc123; HttpOnly; Path=/' });`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'cookie_handling', 'P-14'],
  rationale: 'Set-Cookie in header; body still contains "ok" — passes',
});

push({
  description: 'P-14: Sequence assumes cookie persists from step 1 into step 2',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { login: 'admin' }, expect: { status: 200 } },
      { method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'session_cookie_value' } },
    ],
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'cookie_handling', 'P-14'],
  rationale: 'Step 2 expects cookie-dependent body; "session_cookie_value" not in source',
});

push({
  description: 'P-14: Edit adds cookie value to response body explicitly',
  edits: edit('server.js', HEALTH_RES,
    `res.end(JSON.stringify({ status: 'ok', cookie: 'session=abc123' }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'session=abc123' } }],
  expectedSuccess: true,
  tags: ['http', 'cookie_handling', 'P-14'],
  rationale: 'Edit embeds cookie string in body — grounding finds it',
});

// =============================================================================
// P-31: Sequence step dependency leakage
// =============================================================================

push({
  description: 'P-31: Step 2 body depends on step 1 side effect — leaked',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { seed: 'planted_data' }, expect: { status: 200 } },
      { method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'planted_data' } },
    ],
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'step_dependency_leakage', 'P-31'],
  rationale: '"planted_data" only exists in step 1 POST body; items endpoint never returns it',
});

push({
  description: 'P-31: Independent steps — no cross-step dependency',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
      { method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
    ],
  }],
  expectedSuccess: true,
  tags: ['http', 'step_dependency_leakage', 'P-31'],
  rationale: 'Both steps check content independently available in source — no leakage',
});

push({
  description: 'P-31: Three-step sequence — step 3 claims step 1 mutated state',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { action: 'create_item' }, expect: { status: 200 } },
      { method: 'GET', path: '/health', expect: { status: 200 } },
      { method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'create_item' } },
    ],
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'step_dependency_leakage', 'P-31'],
  rationale: 'Items endpoint is static; "create_item" never appears — leaked assumption from step 1',
});

// =============================================================================
// P-32: Cross-request variable collision
// =============================================================================

push({
  description: 'P-32: Two predicates share variable namespace — no collision in pure tier',
  edits: [],
  predicates: [
    { type: 'http_sequence', steps: [
      { method: 'POST', path: '/api/echo', body: { id: '{{jobId}}' }, expect: { status: 200 } },
    ]},
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: true,
  tags: ['http', 'variable_collision', 'P-32'],
  rationale: 'Template variable in POST body; GET checks static content — no collision',
});

push({
  description: 'P-32: Edit adds request counter — predicate expects specific runtime value',
  edits: [
    { file: 'server.js', search: PORT_LINE, replace: `const PORT = process.env.PORT || 3000;\nlet hitCount = 0;` },
    { file: 'server.js', search: HEALTH_RES, replace: `hitCount++;\n    res.end(JSON.stringify({ status: 'ok', hits: hitCount }));` },
  ],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyRegex: '"hits":\\s*5' } }],
  expectedSuccess: false,
  tags: ['http', 'variable_collision', 'P-32'],
  rationale: 'Counter value 5 is runtime-dependent; literal "5" not deterministically in source',
});

push({
  description: 'P-32: Edit adds counter — predicate checks key name only',
  edits: [
    { file: 'server.js', search: PORT_LINE, replace: `const PORT = process.env.PORT || 3000;\nlet hitCount = 0;` },
    { file: 'server.js', search: HEALTH_RES, replace: `hitCount++;\n    res.end(JSON.stringify({ status: 'ok', hits: hitCount }));` },
  ],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'hits' } }],
  expectedSuccess: true,
  tags: ['http', 'variable_collision', 'P-32'],
  rationale: '"hits" key appears in edit replace content — structural match',
});

// =============================================================================
// P-33: Auth state leakage between tests
// =============================================================================

push({
  description: 'P-33: Claims authenticated response without auth step',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'admin_dashboard_content' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'auth_state_leakage', 'P-33'],
  rationale: '"admin_dashboard_content" not in source — assumes prior auth leaked in',
});

push({
  description: 'P-33: Edit adds auth check — unauthenticated response has "authenticated" key',
  edits: edit('server.js', HEALTH_RES,
    `const auth = req.headers['authorization'];\n    res.end(JSON.stringify({ status: 'ok', authenticated: !!auth }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'authenticated' } }],
  expectedSuccess: true,
  tags: ['http', 'auth_state_leakage', 'P-33'],
  rationale: 'Edit adds "authenticated" key to response — grounding finds it',
});

push({
  description: 'P-33: Sequence assumes login state persists to step 2',
  edits: edit('server.js', HEALTH_RES,
    `const auth = req.headers['authorization'];\n    res.end(JSON.stringify({ status: 'ok', authed: auth === 'Bearer valid' }));`),
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { login: 'admin' }, expect: { status: 200 } },
      { method: 'GET', path: '/health', expect: { status: 200, bodyContains: '"authed":true' } },
    ],
  }],
  expectedSuccess: false,
  tags: ['http', 'auth_state_leakage', 'P-33'],
  rationale: 'Source computes auth dynamically; literal "authed":true not in source string',
});

// =============================================================================
// P-34: Method override behavior (X-HTTP-Method-Override)
// =============================================================================

push({
  description: 'P-34: POST to echo — method override header ignored, works normally',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['http', 'method_override', 'P-34'],
  rationale: 'Standard POST works — method override not relevant for status-only check',
});

push({
  description: 'P-34: DELETE method — fabricated "deleted" response',
  edits: [],
  predicates: [{ type: 'http', method: 'DELETE', path: '/api/items', expect: { status: 200, bodyContains: 'deleted_successfully' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'method_override', 'P-34'],
  rationale: 'No DELETE handler exists; "deleted_successfully" is fabricated',
});

push({
  description: 'P-34: Edit adds method override support — response includes effective method',
  edits: edit('server.js', PORT_LINE,
    `const PORT = process.env.PORT || 3000;\nfunction effectiveMethod(req) { return req.headers['x-http-method-override'] || req.method; }`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'method_override', 'P-34'],
  rationale: 'Override function defined but health endpoint unaffected — passes',
});

// =============================================================================
// P-36: Repeated query keys / array encoding
// =============================================================================

push({
  description: 'P-36: Path with repeated params — grounding passes on path + body content',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items?id=1&id=2', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'repeated_query_keys', 'P-36'],
  rationale: 'Items endpoint returns Alpha regardless of query params — passes',
});

push({
  description: 'P-36: Array-encoded query — expects filtered result not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items?ids[]=1&ids[]=2', expect: { status: 200, bodyContains: 'filtered_result' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'repeated_query_keys', 'P-36'],
  rationale: 'No query param filtering logic; "filtered_result" is fabricated',
});

push({
  description: 'P-36: Edit adds query param parsing with getAll',
  edits: edit('server.js', ITEMS_IF,
    `if (req.url.startsWith('/api/items')) {\n    const url = new URL(req.url, 'http://localhost');\n    const ids = url.searchParams.getAll('id');`),
  predicates: [{ type: 'http', method: 'GET', path: '/api/items?id=1&id=2', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'repeated_query_keys', 'P-36'],
  rationale: 'Edit parses repeated params; response still contains Alpha',
});

// =============================================================================
// P-37: Multipart/form-data parsing
// =============================================================================

push({
  description: 'P-37: POST with form body — echo endpoint returns "echo" key',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', body: { file: 'upload.txt' }, expect: { status: 200, bodyContains: 'echo' } }],
  expectedSuccess: true,
  tags: ['http', 'multipart_formdata', 'P-37'],
  rationale: 'Echo endpoint always includes "echo" key — passes',
});

push({
  description: 'P-37: Expects parsed filename in response — source echoes raw body',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', expect: { status: 200, bodyContains: 'uploaded_file_12345.pdf' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'multipart_formdata', 'P-37'],
  rationale: 'Source echoes raw body; "uploaded_file_12345.pdf" is fabricated',
});

push({
  description: 'P-37: Edit adds multipart field parsing',
  edits: edit('server.js', ECHO_RES,
    `const parsed = { fields: JSON.parse(body), contentType: req.headers['content-type'] };\n    res.end(JSON.stringify({ echo: parsed, filename: 'uploaded', timestamp: Date.now() }));`),
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', body: { name: 'test' }, expect: { status: 200, bodyContains: 'filename' } }],
  expectedSuccess: true,
  tags: ['http', 'multipart_formdata', 'P-37'],
  rationale: 'Edit adds "filename" key to response body — grounding finds it',
});

// =============================================================================
// P-38: HEAD/OPTIONS differing from GET/POST
// =============================================================================

push({
  description: 'P-38: HEAD request status-only — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'HEAD', path: '/health', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['http', 'head_options', 'P-38'],
  rationale: 'Status-only check; HEAD has no body but grounding only checks source for bodyContains',
});

push({
  description: 'P-38: OPTIONS request status-only — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'OPTIONS', path: '/api/items', expect: { status: 200 } }],
  expectedSuccess: true,
  tags: ['http', 'head_options', 'P-38'],
  rationale: 'Status-only check on OPTIONS — passes grounding',
});

push({
  description: 'P-38: HEAD with bodyContains — grounding checks source not HTTP semantics',
  edits: [],
  predicates: [{ type: 'http', method: 'HEAD', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'head_options', 'P-38'],
  rationale: 'Grounding finds "ok" in source; HEAD body semantics not enforced at pure tier',
});

push({
  description: 'P-38: Edit adds OPTIONS handler returning CORS headers',
  edits: edit('server.js', NOT_FOUND,
    `if (req.method === 'OPTIONS') {\n    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });\n    res.end();\n    return;\n  }\n  res.writeHead(404, { 'Content-Type': 'text/plain' });`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'head_options', 'P-38'],
  rationale: 'OPTIONS handler added; GET health still works — passes',
});

// =============================================================================
// P-17: CORS headers
// =============================================================================

push({
  description: 'P-17: Expects Access-Control header string in body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'OPTIONS', path: '/api/items', expect: { status: 200, bodyContains: 'Access-Control-Allow-Origin' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'cors_headers', 'P-17'],
  rationale: 'CORS is a response header not body content; string not in source body output',
});

push({
  description: 'P-17: Edit adds CORS header to items endpoint — body still has Alpha',
  edits: edit('server.js', ITEMS_HEAD,
    `if (req.url === '/api/items') {\n    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });`),
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'cors_headers', 'P-17'],
  rationale: 'CORS header added but body unchanged — "Alpha" still grounded',
});

push({
  description: 'P-17: CORS preflight expects 204 but items returns 200',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 204 } }],
  expectedSuccess: true, // status not grounded in pure tier
  tags: ['http', 'cors_headers', 'P-17'],
  rationale: 'Status code assertions pass grounding — validated at runtime tier only',
});

// =============================================================================
// P-18: HTTPS/TLS certificate issues
// =============================================================================

push({
  description: 'P-18: HTTPS-related env vars added — health still works over HTTP',
  edits: edit('.env', 'DEBUG=false', 'DEBUG=false\nFORCE_HTTPS=true\nTLS_CERT_PATH=/etc/ssl/cert.pem'),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'tls_cert', 'P-18'],
  rationale: 'Env vars added but server.js logic unchanged — HTTP health passes',
});

push({
  description: 'P-18: Expects CERT_UNTRUSTED in body — fabricated TLS error',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'CERT_UNTRUSTED' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'tls_cert', 'P-18'],
  rationale: 'No TLS error handling in source; "CERT_UNTRUSTED" is fabricated',
});

push({
  description: 'P-18: Edit adds HTTPS redirect constant — no behavioral change',
  edits: edit('server.js', PORT_LINE, `const PORT = process.env.PORT || 3000;\nconst HTTPS_REDIRECT = process.env.FORCE_HTTPS === 'true';`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'tls_cert', 'P-18'],
  rationale: 'HTTPS_REDIRECT constant defined but no redirect logic — health passes',
});

// =============================================================================
// P-19: Chunked/streaming responses
// =============================================================================

push({
  description: 'P-19: Normal response — bodyContains checks source content',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'chunked_streaming', 'P-19'],
  rationale: 'Standard response with "Alpha" in source — passes',
});

push({
  description: 'P-19: Expects Transfer-Encoding header in body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Transfer-Encoding: chunked' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'chunked_streaming', 'P-19'],
  rationale: 'Transfer-Encoding is a wire header; not in source response body',
});

push({
  description: 'P-19: Edit adds chunked write with explicit Transfer-Encoding',
  edits: edit('server.js', HEALTH_RES,
    `res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });\n    res.write(JSON.stringify({ status: 'ok', chunk: 1 }));\n    res.end();`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'chunk' } }],
  expectedSuccess: true,
  tags: ['http', 'chunked_streaming', 'P-19'],
  rationale: 'Edit writes "chunk" in response body — grounding finds it',
});

// =============================================================================
// P-20: Rate limiting (429)
// =============================================================================

push({
  description: 'P-20: Expects 429 status — status not grounded in pure tier',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 429 } }],
  expectedSuccess: true,
  tags: ['http', 'rate_limiting', 'P-20'],
  rationale: 'Status-only assertion passes grounding — runtime would detect mismatch',
});

push({
  description: 'P-20: Rate limit body claim — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 429, bodyContains: 'rate limit exceeded' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'rate_limiting', 'P-20'],
  rationale: '"rate limit exceeded" not in source — fabricated response',
});

push({
  description: 'P-20: Edit adds rate limit route returning 429',
  edits: edit('server.js', HEALTH_IF,
    `if (req.url === '/rate-limited') {\n    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });\n    res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: 60 }));\n    return;\n  }\n\n  if (req.url === '/health') {`),
  predicates: [{ type: 'http', method: 'GET', path: '/rate-limited', expect: { status: 429, bodyContains: 'Too Many Requests' } }],
  expectedSuccess: true,
  tags: ['http', 'rate_limiting', 'P-20'],
  rationale: 'Edit adds 429 route with expected body content — grounding matches',
});

// =============================================================================
// P-39: DNS resolution differences
// =============================================================================

push({
  description: 'P-39: DB host changed in config — health endpoint unaffected',
  edits: edit('config.json', '"host": "localhost"', '"host": "db.internal.local"'),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'dns_resolution', 'P-39'],
  rationale: 'Config change does not affect health response — passes',
});

push({
  description: 'P-39: Expects resolved IP in body — runtime-dependent',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'resolved_to_10.0.0.1' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'dns_resolution', 'P-39'],
  rationale: 'DNS resolution result is runtime; "resolved_to_10.0.0.1" not in source',
});

push({
  description: 'P-39: Edit adds hostname to response',
  edits: edit('server.js', HEALTH_RES,
    `const os = require('os');\n    res.end(JSON.stringify({ status: 'ok', hostname: os.hostname(), dns: 'local' }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'dns' } }],
  expectedSuccess: true,
  tags: ['http', 'dns_resolution', 'P-39'],
  rationale: 'Edit adds "dns" key to response body — grounding finds it',
});

// =============================================================================
// P-40: Port-binding race during staging
// =============================================================================

push({
  description: 'P-40: Normal port binding — health check passes',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'port_binding_race', 'P-40'],
  rationale: 'Standard port binding — no race in pure grounding',
});

push({
  description: 'P-40: ECONNREFUSED claim in body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ECONNREFUSED' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'port_binding_race', 'P-40'],
  rationale: 'Connection errors are runtime; "ECONNREFUSED" not in source response',
});

push({
  description: 'P-40: Edit adds dual port config',
  edits: edit('server.js', PORT_LINE,
    `const PORT = process.env.PORT || 3000;\nconst ADMIN_PORT = process.env.ADMIN_PORT || 3001;`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'port_binding_race', 'P-40'],
  rationale: 'Admin port constant defined; primary health endpoint unaffected',
});

// =============================================================================
// P-41: Retry turns infra failure into false success
// =============================================================================

push({
  description: 'P-41: Grounded body claim — passes regardless of retry behavior',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'retry_false_success', 'P-41'],
  rationale: '"Alpha" in source — passes; retry behavior is runtime concern',
});

push({
  description: 'P-41: Expects stale cache recovery data — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'recovered_stale_cache' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'retry_false_success', 'P-41'],
  rationale: '"recovered_stale_cache" not in source — fabricated retry artifact',
});

push({
  description: 'P-41: Edit adds flaky endpoint with retry source path',
  edits: edit('server.js', HEALTH_IF,
    `if (req.url === '/flaky') {\n    const ok = Math.random() > 0.5;\n    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify(ok ? { status: 'ok', source: 'retry' } : { error: 'Service Unavailable' }));\n    return;\n  }\n\n  if (req.url === '/health') {`),
  predicates: [{ type: 'http', method: 'GET', path: '/flaky', expect: { status: 200, bodyContains: 'retry' } }],
  expectedSuccess: true,
  tags: ['http', 'retry_false_success', 'P-41'],
  rationale: 'Edit contains "retry" in the 200-path response body — grounding matches source',
});

// =============================================================================
// P-42: Proxy/load balancer alters response
// =============================================================================

push({
  description: 'P-42: Proxy-injected header in body — not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'X-Proxy-Injected' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'proxy_alters_response', 'P-42'],
  rationale: 'No proxy configured; "X-Proxy-Injected" not in source body',
});

push({
  description: 'P-42: Original content unaltered — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'proxy_alters_response', 'P-42'],
  rationale: 'Source content present; proxy irrelevant at pure tier',
});

push({
  description: 'P-42: Edit adds X-Forwarded-For echo to response body',
  edits: edit('server.js', HEALTH_RES,
    `const clientIp = req.headers['x-forwarded-for'] || 'direct';\n    res.end(JSON.stringify({ status: 'ok', clientIp: clientIp }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'clientIp' } }],
  expectedSuccess: true,
  tags: ['http', 'proxy_alters_response', 'P-42'],
  rationale: 'Edit adds "clientIp" key to response — grounding matches',
});

// =============================================================================
// P-43: HTTP/1.1 vs HTTP/2 behavioral mismatch
// =============================================================================

push({
  description: 'P-43: HTTP/2 push promise in body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'push_promise' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'http_version_mismatch', 'P-43'],
  rationale: 'HTTP/1.1 server has no push promise; string not in source',
});

push({
  description: 'P-43: Standard HTTP/1.1 response — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, contentType: 'application/json' } }],
  expectedSuccess: true,
  tags: ['http', 'http_version_mismatch', 'P-43'],
  rationale: 'Standard HTTP/1.1 JSON response — passes grounding',
});

push({
  description: 'P-43: Edit adds http2 comment — no behavioral change',
  edits: edit('server.js', PORT_LINE, `const PORT = process.env.PORT || 3000;\n// TODO: Migrate to HTTP/2 — const http2 = require('http2');`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'http_version_mismatch', 'P-43'],
  rationale: 'Comment about http2 has no effect on behavior',
});

// =============================================================================
// P-44: Localized content via Accept-Language
// =============================================================================

push({
  description: 'P-44: Default English content — in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/', expect: { status: 200, bodyContains: 'Demo App' } }],
  expectedSuccess: true,
  tags: ['http', 'localized_content', 'P-44'],
  rationale: '"Demo App" in homepage source — passes',
});

push({
  description: 'P-44: Spanish localized content — not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/', expect: { status: 200, bodyContains: 'Aplicación Demo' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'localized_content', 'P-44'],
  rationale: 'No i18n in source; "Aplicación Demo" is fabricated',
});

push({
  description: 'P-44: Edit adds i18n greeting map to health response',
  edits: edit('server.js', HEALTH_RES,
    `const lang = (req.headers['accept-language'] || 'en').split(',')[0];\n    const greetings = { en: 'Hello', es: 'Hola', fr: 'Bonjour' };\n    res.end(JSON.stringify({ status: 'ok', greeting: greetings[lang] || greetings.en }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'greeting' } }],
  expectedSuccess: true,
  tags: ['http', 'localized_content', 'P-44'],
  rationale: 'Edit adds "greeting" key to response — grounding matches',
});

// =============================================================================
// P-45: CSRF protection blocks mutation route
// =============================================================================

push({
  description: 'P-45: POST without CSRF — source has no CSRF check, passes',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', body: { data: 'test' }, expect: { status: 200, bodyContains: 'echo' } }],
  expectedSuccess: true,
  tags: ['http', 'csrf_protection', 'P-45'],
  rationale: 'No CSRF protection in source; echo works normally',
});

push({
  description: 'P-45: CSRF rejection response — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', expect: { status: 403, bodyContains: 'CSRF token mismatch' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'csrf_protection', 'P-45'],
  rationale: 'No CSRF logic in source; "CSRF token mismatch" is fabricated',
});

push({
  description: 'P-45: Edit adds CSRF validation — predicate expects 403 rejection body',
  edits: edit('server.js', ECHO_IF,
    `if (req.url === '/api/echo' && req.method === 'POST') {\n    const csrfToken = req.headers['x-csrf-token'];\n    if (!csrfToken || csrfToken !== 'valid-csrf-token') {\n      res.writeHead(403, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ error: 'CSRF token invalid' }));\n      return;\n    }`),
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', body: { data: 'test' }, expect: { status: 403, bodyContains: 'CSRF token invalid' } }],
  expectedSuccess: true,
  tags: ['http', 'csrf_protection', 'P-45'],
  rationale: 'Edit adds CSRF check; "CSRF token invalid" in replace content — grounding matches',
});

// =============================================================================
// P-46: ETag / conditional GET returns 304
// =============================================================================

push({
  description: 'P-46: 304 status-only — grounding passes (status not grounded)',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 304 } }],
  expectedSuccess: true,
  tags: ['http', 'etag_304', 'P-46'],
  rationale: 'Status-only assertion passes grounding — runtime would detect mismatch',
});

push({
  description: 'P-46: 304 with body — 304 has no body, claim fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 304, bodyContains: 'not_modified_body' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'etag_304', 'P-46'],
  rationale: '"not_modified_body" not in source — fabricated',
});

push({
  description: 'P-46: Edit adds ETag header — body check still passes',
  edits: edit('server.js', HEALTH_HEAD,
    `const etag = '"health-v1"';\n    res.writeHead(200, { 'Content-Type': 'application/json', 'ETag': etag });`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'etag_304', 'P-46'],
  rationale: 'ETag header added; response body unchanged — passes',
});

// =============================================================================
// P-47: Streaming/chunked response truncated
// =============================================================================

push({
  description: 'P-47: Complete content — both items present',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: ['Alpha', 'Beta'] } }],
  expectedSuccess: true,
  tags: ['http', 'truncated_stream', 'P-47'],
  rationale: 'Both Alpha and Beta in source — passes',
});

push({
  description: 'P-47: Truncated stream artifact — fabricated binary marker',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: '\\x00TRUNCATED' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'truncated_stream', 'P-47'],
  rationale: 'Truncation marker not in source — fabricated artifact',
});

push({
  description: 'P-47: Edit streams partial response — missing Beta',
  edits: edit('server.js', ITEMS_RES,
    `res.write('[{"id":1,"name":"Alpha"}');\n    // Simulated truncation\n    res.end();`),
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: ['Alpha', 'Beta'] } }],
  expectedSuccess: false,
  tags: ['http', 'truncated_stream', 'P-47'],
  rationale: 'Edit removes Beta from response; "Beta" no longer in replace content',
});

// =============================================================================
// P-48: SSE stream assertion
// =============================================================================

push({
  description: 'P-48: SSE format body claim — not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'event: update\ndata: ' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'sse_stream', 'P-48'],
  rationale: 'Items endpoint is JSON not SSE; event format not in source',
});

push({
  description: 'P-48: SSE contentType claim — status-only passes grounding',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, contentType: 'text/event-stream' } }],
  expectedSuccess: true,
  tags: ['http', 'sse_stream', 'P-48'],
  rationale: 'ContentType assertions pass grounding — runtime would detect mismatch',
});

push({
  description: 'P-48: Edit adds SSE endpoint with event data',
  edits: edit('server.js', HEALTH_IF,
    `if (req.url === '/events') {\n    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });\n    res.write('data: {"event":"ping","count":1}\\n\\n');\n    res.end();\n    return;\n  }\n\n  if (req.url === '/health') {`),
  predicates: [{ type: 'http', method: 'GET', path: '/events', expect: { status: 200, bodyContains: 'ping' } }],
  expectedSuccess: true,
  tags: ['http', 'sse_stream', 'P-48'],
  rationale: 'Edit adds SSE endpoint with "ping" event data — grounding matches',
});

// =============================================================================
// P-49: WebSocket upgrade handshake
// =============================================================================

push({
  description: 'P-49: 101 upgrade status — passes grounding (status not grounded)',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/ws', expect: { status: 101 } }],
  expectedSuccess: true,
  tags: ['http', 'websocket_upgrade', 'P-49'],
  rationale: 'Status-only assertion passes grounding — /ws 404 at runtime',
});

push({
  description: 'P-49: WebSocket protocol body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/ws', expect: { status: 101, bodyContains: 'Upgrade: websocket' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'websocket_upgrade', 'P-49'],
  rationale: 'No /ws route; "Upgrade: websocket" not in source body output',
});

push({
  description: 'P-49: Edit adds WS upgrade check route returning 426',
  edits: edit('server.js', HEALTH_IF,
    `if (req.url === '/ws') {\n    res.writeHead(426, { 'Content-Type': 'application/json', 'Upgrade': 'websocket' });\n    res.end(JSON.stringify({ error: 'Upgrade Required', protocol: 'websocket' }));\n    return;\n  }\n\n  if (req.url === '/health') {`),
  predicates: [{ type: 'http', method: 'GET', path: '/ws', expect: { status: 426, bodyContains: 'Upgrade Required' } }],
  expectedSuccess: true,
  tags: ['http', 'websocket_upgrade', 'P-49'],
  rationale: 'Edit adds WS route with "Upgrade Required" body — grounding matches',
});

// =============================================================================
// P-50: Content-Encoding auto-decode mismatch
// =============================================================================

push({
  description: 'P-50: Decoded content matches source — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } }],
  expectedSuccess: true,
  tags: ['http', 'content_encoding_mismatch', 'P-50'],
  rationale: 'Plain JSON; "Alpha" in source — passes',
});

push({
  description: 'P-50: Base64-encoded gzip bytes in body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'H4sIAAAAAAAA' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'content_encoding_mismatch', 'P-50'],
  rationale: 'No gzip encoding; base64 artifact not in source',
});

push({
  description: 'P-50: Edit adds gzip encoding — source string still contains "compressed"',
  edits: edit('server.js', HEALTH_RES,
    `const zlib = require('zlib');\n    const payload = JSON.stringify({ status: 'ok', compressed: true });\n    res.end(zlib.gzipSync(payload));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'compressed' } }],
  expectedSuccess: true,
  tags: ['http', 'content_encoding_mismatch', 'P-50'],
  rationale: '"compressed" appears in payload string literal in replace content',
});

// =============================================================================
// P-51: IPv6 address format in URL
// =============================================================================

push({
  description: 'P-51: Standard health check — IPv6 irrelevant at pure tier',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'ipv6_format', 'P-51'],
  rationale: 'Standard path; IPv6 address format is runtime concern',
});

push({
  description: 'P-51: Edit binds to IPv6 loopback — body claim about 127.0.0.1 fails',
  edits: edit('server.js', SERVER_LISTEN, `server.listen(PORT, '::1', () => {`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: '127.0.0.1' } }],
  expectedSuccess: false,
  tags: ['http', 'ipv6_format', 'P-51'],
  rationale: 'Source binds to ::1; "127.0.0.1" not in response body source',
});

push({
  description: 'P-51: Edit adds IPv6 address in response body',
  edits: edit('server.js', HEALTH_RES,
    `res.end(JSON.stringify({ status: 'ok', bind: '::1', protocol: 'ipv6' }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: '::1' } }],
  expectedSuccess: true,
  tags: ['http', 'ipv6_format', 'P-51'],
  rationale: 'Edit adds "::1" in response body — grounding matches',
});

// =============================================================================
// P-52: 1xx informational response before final
// =============================================================================

push({
  description: 'P-52: 100 Continue status — passes grounding (status not grounded)',
  edits: [],
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', expect: { status: 100 } }],
  expectedSuccess: true,
  tags: ['http', 'informational_response', 'P-52'],
  rationale: 'Status-only; grounding does not validate status codes',
});

push({
  description: 'P-52: 103 Early Hints body — fabricated',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 103, bodyContains: 'Link: </style.css>' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'informational_response', 'P-52'],
  rationale: 'No Early Hints support; "Link: </style.css>" not in source',
});

push({
  description: 'P-52: Edit adds 100-continue handling to echo endpoint',
  edits: edit('server.js', ECHO_IF,
    `if (req.url === '/api/echo' && req.method === 'POST') {\n    if (req.headers['expect'] === '100-continue') {\n      res.writeContinue();\n    }`),
  predicates: [{ type: 'http', method: 'POST', path: '/api/echo', body: { data: 'test' }, expect: { status: 200, bodyContains: 'echo' } }],
  expectedSuccess: true,
  tags: ['http', 'informational_response', 'P-52'],
  rationale: '100-continue is informational; final 200 with "echo" body still sent',
});

// =============================================================================
// P-53: Range request returns 206 partial body
// =============================================================================

push({
  description: 'P-53: 206 status — passes grounding',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 206 } }],
  expectedSuccess: true,
  tags: ['http', 'range_request', 'P-53'],
  rationale: 'Status-only; grounding passes — runtime would detect 200 vs 206',
});

push({
  description: 'P-53: Partial body claim — fabricated range marker',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 206, bodyContains: 'bytes 0-99/1000' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'range_request', 'P-53'],
  rationale: 'No range request support; "bytes 0-99/1000" not in source',
});

push({
  description: 'P-53: Edit adds range request route with partial content',
  edits: edit('server.js', HEALTH_IF,
    `if (req.url === '/download') {\n    const range = req.headers['range'];\n    if (range) {\n      res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 0-99/1000' });\n      res.end('partial-content');\n    } else {\n      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });\n      res.end('full-content');\n    }\n    return;\n  }\n\n  if (req.url === '/health') {`),
  predicates: [{ type: 'http', method: 'GET', path: '/download', expect: { status: 200, bodyContains: 'full-content' } }],
  expectedSuccess: true,
  tags: ['http', 'range_request', 'P-53'],
  rationale: 'Edit adds download route; "full-content" in replace body — grounding matches',
});

// =============================================================================
// P-54: Proxy/CDN injects response headers or body
// =============================================================================

push({
  description: 'P-54: CDN-injected cache header in body — not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'X-Cache: HIT from cdn.example.com' } }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'cdn_injection', 'P-54'],
  rationale: 'No CDN configuration; cache header string not in source body',
});

push({
  description: 'P-54: Original content unaffected by CDN — passes',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Beta' } }],
  expectedSuccess: true,
  tags: ['http', 'cdn_injection', 'P-54'],
  rationale: 'Source content present; CDN not relevant at pure tier',
});

push({
  description: 'P-54: Edit adds CDN cache status header — body unchanged',
  edits: edit('server.js', HEALTH_HEAD,
    `res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'CDN-Cache-Status': 'MISS' });`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: true,
  tags: ['http', 'cdn_injection', 'P-54'],
  rationale: 'CDN header in response headers; body still has "ok" — passes',
});

push({
  description: 'P-54: Edit adds proxy info in response body',
  edits: edit('server.js', HEALTH_RES,
    `res.end(JSON.stringify({ status: 'ok', via: 'sovereign-proxy/1.0', cached: false }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: ['sovereign-proxy', 'cached'] } }],
  expectedSuccess: true,
  tags: ['http', 'cdn_injection', 'P-54'],
  rationale: 'Edit puts proxy info in body — both terms found in replace content',
});

// =============================================================================
// P-27: Cross-cutting — HTTP sequence with status + body validation
// =============================================================================

push({
  description: 'P-27: Full sequence — health then items',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
      { method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: ['Alpha', 'Beta'] } },
    ],
  }],
  expectedSuccess: true,
  tags: ['http', 'sequence', 'cross_cutting', 'P-27'],
  rationale: 'Both steps use grounded content — all body terms present in source',
});

push({
  description: 'P-27: Sequence with POST echo round-trip',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { msg: 'test' }, expect: { status: 200, bodyContains: 'echo' } },
      { method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
    ],
  }],
  expectedSuccess: true,
  tags: ['http', 'sequence', 'cross_cutting', 'P-27'],
  rationale: 'Echo has "echo" key; health has "ok" — both grounded',
});

push({
  description: 'P-27: Middle step fails — /nonexistent body claim fabricated',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/health', expect: { status: 200 } },
      { method: 'GET', path: '/nonexistent', expect: { status: 200, bodyContains: 'secret_data' } },
      { method: 'GET', path: '/api/items', expect: { status: 200 } },
    ],
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'sequence', 'cross_cutting', 'P-27'],
  rationale: '"secret_data" not in source — step 2 body claim fabricated',
});

// =============================================================================
// P-28: Cross-cutting — HTTP predicate with regex validation
// =============================================================================

push({
  description: 'P-28: Regex matches health JSON structure',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyRegex: '"status":\\s*"ok"' } }],
  expectedSuccess: true,
  tags: ['http', 'regex_validation', 'P-28'],
  rationale: 'Source contains status: ok matching the regex pattern',
});

push({
  description: 'P-28: Regex matches items array name field',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyRegex: '"name":\\s*"Alpha"' } }],
  expectedSuccess: true,
  tags: ['http', 'regex_validation', 'P-28'],
  rationale: 'Items source has name: Alpha matching regex',
});

push({
  description: 'P-28: Regex expects timestamp — runtime value not in source',
  edits: [],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyRegex: '"timestamp":\\s*\\d{13}' } }],
  expectedSuccess: false,
  tags: ['http', 'regex_validation', 'P-28'],
  rationale: 'Health has no timestamp field; regex cannot match source',
});

push({
  description: 'P-28: Edit adds version field — regex matches pattern',
  edits: edit('server.js', HEALTH_RES,
    `res.end(JSON.stringify({ status: 'ok', version: '1.2.3' }));`),
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyRegex: '"version":\\s*"\\d+\\.\\d+\\.\\d+"' } }],
  expectedSuccess: true,
  tags: ['http', 'regex_validation', 'P-28'],
  rationale: 'Edit adds version "1.2.3"; regex pattern matches the literal',
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  // Find the P-XX tag
  const pTag = s.tags.find((t: string) => t.startsWith('P-'));
  const key = pTag || s.tags[1] || 'unknown';
  tagCounts[key] = (tagCounts[key] || 0) + 1;
}

console.log(`Generated ${scenarios.length} HTTP advanced scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort()) {
  console.log(`  ${tag.padEnd(10)} ${count}`);
}
