#!/usr/bin/env bun
/**
 * State Assumption × HTTP scenario generator
 * Grid cell: C×2
 * Shapes: SH-01 (API versioned — agent calls v1 but v2 deployed),
 *         SH-02 (endpoint moved but agent uses old URL),
 *         SH-03 (response format changed but agent parses old format)
 *
 * State Assumption rule: every scenario must name both the ASSUMED STATE and the
 * ACTUAL STATE, and the failure must survive even with no timing delay and no
 * missing cascade. The agent has the wrong belief about which HTTP surface it's talking to.
 *
 * Key distinction from Temporal × HTTP (TH-01: stale cache after deploy):
 * - Temporal: same endpoint, wrong timing — "wait for cache/CDN to flush"
 * - State: wrong endpoint identity — "no amount of waiting helps, you're calling the wrong API"
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-state-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/state-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sh-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');

// =============================================================================
// Shape SH-01: API versioned — agent calls v1 but v2 deployed
// Agent grounded against one API version but the deployed server has moved to
// a new version. The old route still exists (or doesn't) but returns different data.
// Not "stale cache" (temporal) — the agent's mental model of the API is wrong.
// =============================================================================

// SH-01a: Agent moves /api/items to /api/v2/items, predicate checks /api/items
scenarios.push({
  id: nextId('version'),
  description: 'SH-01: Rename /api/items to /api/v2/items in server.js, predicate checks for /api/items',
  edits: [{ file: 'server.js', search: "req.url === '/api/items'", replace: "req.url === '/api/v2/items'" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "req.url === '/api/items'" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'api_version', 'SH-01'],
  rationale: 'Assumed: /api/items still exists. Actual: renamed to /api/v2/items. Agent calls the old version.',
});

// SH-01b: Agent adds v2 health endpoint, predicate checks for v1 health format
scenarios.push({
  id: nextId('version'),
  description: 'SH-01: Change health response from {status:"ok"} to {healthy:true,version:2}, predicate checks for "ok"',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ healthy: true, version: 2 }));" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "status: 'ok'" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'api_version', 'SH-01'],
  rationale: 'Assumed: health returns {status:"ok"}. Actual: format changed to {healthy,version}. Parsing old format fails.',
});

// SH-01c: Agent changes items response structure (array → object with data key)
scenarios.push({
  id: nextId('version'),
  description: 'SH-01: Wrap /api/items response in {data:[...],total:2}, predicate checks for bare array format',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));",
    replace: "res.end(JSON.stringify({ data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }], total: 2 }));"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "JSON.stringify([\n" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'api_version', 'SH-01'],
  rationale: 'Assumed: /api/items returns bare array. Actual: wrapped in {data,total} envelope. Client parsing breaks.',
});

// SH-01d: Agent changes port in config but server.js still uses .env PORT
scenarios.push({
  id: nextId('version'),
  description: 'SH-01: Change config.json port to 8080, server.js still reads from process.env.PORT',
  edits: [{ file: 'config.json', search: '"port": 3000', replace: '"port": 8080' }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '8080' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'api_version', 'SH-01'],
  rationale: 'Assumed: config.json port controls server. Actual: server.js reads PORT from env, ignores config.json.',
});

// SH-01e: Control — edit /api/items response and check for new content in server.js
scenarios.push({
  id: nextId('version'),
  description: 'SH-01 control: Add Gamma item to /api/items, predicate checks server.js for Gamma',
  edits: [{ file: 'server.js', search: "{ id: 2, name: 'Beta' },", replace: "{ id: 2, name: 'Beta' },\n      { id: 3, name: 'Gamma' }," }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Gamma' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'http', 'api_version', 'SH-01', 'control'],
  rationale: 'Edit and check same file — new item appears in server.js. No version mismatch.',
});

// =============================================================================
// Shape SH-02: Endpoint moved but agent uses old URL
// Agent calls an endpoint that has been relocated — the old URL returns 404 or
// redirects. Not a cache issue — the route structure changed permanently.
// =============================================================================

// SH-02a: Rename /health to /healthz, Dockerfile still checks /health
scenarios.push({
  id: nextId('moved'),
  description: 'SH-02: Rename /health to /healthz in server.js, Dockerfile HEALTHCHECK still uses /health',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/healthz'" }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: '/healthz' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'endpoint_moved', 'SH-02'],
  rationale: 'Assumed: Dockerfile healthcheck tracks route rename. Actual: Dockerfile still references /health — endpoint moved but consumer didn\'t follow.',
});

// SH-02b: Rename /about to /info, predicate checks for /about in server.js
scenarios.push({
  id: nextId('moved'),
  description: 'SH-02: Rename /about to /info in server.js, predicate checks for /about route',
  edits: [{ file: 'server.js', search: "req.url === '/about'", replace: "req.url === '/info'" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "req.url === '/about'" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'endpoint_moved', 'SH-02'],
  rationale: 'Assumed: /about still exists. Actual: renamed to /info. Agent\'s route map is stale.',
});

// SH-02c: Move /api/items to /items (drop /api prefix), navigation link still says /api/items
scenarios.push({
  id: nextId('moved'),
  description: 'SH-02: Move /api/items to /items in server.js, homepage nav link still says /api/items',
  edits: [{ file: 'server.js', search: "req.url === '/api/items'", replace: "req.url === '/items'" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'href="/items"' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'endpoint_moved', 'SH-02'],
  rationale: 'Assumed: nav link updated with route. Actual: homepage HTML still has href="/api/items" — broken internal link.',
});

// SH-02d: Rename /form to /contact, predicate checks for /contact in form action
scenarios.push({
  id: nextId('moved'),
  description: 'SH-02: Rename /form to /contact in server.js route, predicate checks form action for /contact',
  edits: [{ file: 'server.js', search: "req.url === '/form'", replace: "req.url === '/contact'" }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'action="/contact"' },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'endpoint_moved', 'SH-02'],
  rationale: 'Assumed: form action follows route rename. Actual: form action still says /api/echo — route and form are independent.',
});

// SH-02e: docker-compose.yml healthcheck references /health, server.js /health exists (consistent)
scenarios.push({
  id: nextId('moved'),
  description: 'SH-02 control: docker-compose.yml healthcheck matches server.js /health route',
  edits: [],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: '/health' },
    { type: 'content', file: 'server.js', pattern: "/health'" },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'http', 'endpoint_moved', 'SH-02', 'control'],
  rationale: 'Both infra and app agree on /health path — no endpoint relocation.',
});

// =============================================================================
// Shape SH-03: Response format changed but agent parses old format
// The endpoint exists but its response schema has changed. Agent's parser/predicate
// assumes the old shape. Not "stale" — the contract changed permanently.
// =============================================================================

// SH-03a: Change items from name field to title field, predicate checks for name
scenarios.push({
  id: nextId('format'),
  description: 'SH-03: Change /api/items response from {name} to {title} field, predicate checks for "name"',
  edits: [{
    file: 'server.js',
    search: "{ id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },",
    replace: "{ id: 1, title: 'Alpha' },\n      { id: 2, title: 'Beta' },"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "name: 'Alpha'" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03'],
  rationale: 'Assumed: items have name field. Actual: renamed to title. Client parsing by field name breaks.',
});

// SH-03b: Change health from JSON to plain text, predicate checks for JSON
scenarios.push({
  id: nextId('format'),
  description: 'SH-03: Change /health from JSON to plain text "OK", predicate checks for Content-Type json',
  edits: [{
    file: 'server.js',
    search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.writeHead(200, { 'Content-Type': 'text/plain' });\n    res.end('OK');"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "application/json" },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03'],
  rationale: 'Tricky: application/json still appears in /api/items route. Predicate passes on wrong match — false confidence.',
});

// SH-03c: Change echo endpoint to return XML instead of JSON
scenarios.push({
  id: nextId('format'),
  description: 'SH-03: Change /api/echo from JSON to XML response, predicate checks for JSON.stringify in echo',
  edits: [{
    file: 'server.js',
    search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));",
    replace: "res.writeHead(200, { 'Content-Type': 'application/xml' });\n    res.end(`<echo><body>${body}</body></echo>`);"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "JSON.stringify({ echo:" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03'],
  rationale: 'Assumed: /api/echo returns JSON. Actual: changed to XML. Agent parsing JSON.parse(response) breaks.',
});

// SH-03d: Add pagination to items response, predicate checks for bare array
scenarios.push({
  id: nextId('format'),
  description: 'SH-03: Add pagination to /api/items, predicate checks for bare array JSON.stringify([',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));",
    replace: "res.end(JSON.stringify({ items: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }], page: 1, hasMore: false }));"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "JSON.stringify([" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03'],
  rationale: 'Assumed: items response is bare array. Actual: wrapped in pagination object. response[0] is now undefined.',
});

// SH-03e: Change error response format from text to JSON
scenarios.push({
  id: nextId('format'),
  description: 'SH-03: Change 404 from text/plain to JSON error, predicate checks for text/plain 404',
  edits: [{
    file: 'server.js',
    search: "res.writeHead(404, { 'Content-Type': 'text/plain' });\n  res.end('Not Found');",
    replace: "res.writeHead(404, { 'Content-Type': 'application/json' });\n  res.end(JSON.stringify({ error: 'Not Found', code: 404 }));"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: "'Content-Type': 'text/plain'" },
  ],
  expectedSuccess: false,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03'],
  rationale: 'Assumed: 404 returns text/plain. Actual: changed to JSON. Error handling that checks for plain text breaks.',
});

// SH-03f: Control — edit items, check for new content in same response
scenarios.push({
  id: nextId('format'),
  description: 'SH-03 control: Add item Gamma to /api/items, predicate checks for Gamma in server.js',
  edits: [{ file: 'server.js', search: "{ id: 2, name: 'Beta' },", replace: "{ id: 2, name: 'Beta' },\n      { id: 3, name: 'Gamma' }," }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Gamma' },
  ],
  expectedSuccess: true,
  tags: ['state_assumption', 'http', 'format_changed', 'SH-03', 'control'],
  rationale: 'Same format, new data — response structure unchanged, just more items. No format mismatch.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} state-assumption-http scenarios → ${outPath}`);
