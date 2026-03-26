#!/usr/bin/env bun
/**
 * Temporal × HTTP scenario generator
 * Grid cell: D×2
 * Shapes: TH-01 (server started but not accepting connections), TH-02 (stale cached response)
 *
 * These scenarios test whether verify's HTTP gate handles temporal failures:
 * - Server startup race (request before server is ready)
 * - Cached/stale responses after code deploy
 * - Sequence timing (delayBeforeMs between steps)
 *
 * HTTP scenarios require a running container → requiresLiveHttp: true for live-tier tests.
 * Pure-tier scenarios test structural correctness of HTTP predicates without Docker.
 *
 * Run: bun scripts/harvest/stage-temporal-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `th-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// =============================================================================
// Shape TH-01: Server started but not accepting connections (ECONNREFUSED)
// Pure-tier: Edit server.js to break the health endpoint, HTTP predicate
// expects 200 → should fail. No Docker needed — tests predicate/edit interaction.
// =============================================================================

// TH-01a: Edit server.js to rename health route, HTTP predicate still expects /health
scenarios.push({
  id: nextId('race'),
  description: 'TH-01: Health endpoint renamed, HTTP predicate checks old /health path',
  edits: [{ file: 'server.js', search: "req.url === '/health'", replace: "req.url === '/healthz'" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200 },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'startup_race', 'TH-01'],
  rationale: 'Health endpoint renamed but predicate checks old path — simulates startup race where old route is gone',
});

// TH-01b: Edit server.js to change health response, predicate checks for old body
scenarios.push({
  id: nextId('race'),
  description: 'TH-01: Health endpoint returns new body, predicate expects old format',
  edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'starting', ready: false }" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: '"status":"ok"' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'startup_race', 'TH-01'],
  rationale: 'Server responds with starting status — health check finds wrong body content',
});

// TH-01c: Edit server.js to change status code on health
scenarios.push({
  id: nextId('race'),
  description: 'TH-01: Health returns 503 during startup, predicate expects 200',
  edits: [{ file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));", replace: "res.writeHead(503, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'starting' }));" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200 },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'startup_race', 'TH-01'],
  rationale: 'Server returns 503 during startup phase — predicate expects 200',
});

// TH-01d: Control — no edit, health should work
scenarios.push({
  id: nextId('race'),
  description: 'TH-01 control: No edit, /health returns 200 OK',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'ok' },
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'startup_race', 'TH-01', 'control'],
  rationale: 'No edit — health endpoint works as expected',
});

// =============================================================================
// Shape TH-02: Response cached by proxy after deploy (stale response)
// Edit server.js to change API response, but HTTP predicate checks for OLD
// content that would only appear if a cache layer served stale data.
// =============================================================================

// TH-02a: Edit /api/items to return different data, predicate expects old data
scenarios.push({
  id: nextId('cache'),
  description: 'TH-02: API items renamed, predicate expects old "Alpha" in response',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Gamma' }" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Alpha' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'stale_cache', 'TH-02'],
  rationale: 'API response changed but predicate checks for old stale content',
});

// TH-02b: Edit /api/items to remove item, predicate expects both items
scenarios.push({
  id: nextId('cache'),
  description: 'TH-02: API items reduced to 1, predicate expects "Beta" still present',
  edits: [{ file: 'server.js', search: "      { id: 2, name: 'Beta' },\n    ]", replace: "    ]" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Beta' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'stale_cache', 'TH-02'],
  rationale: 'Item removed from API but predicate still expects it — stale cache pattern',
});

// TH-02c: Edit echo endpoint to change response format, predicate expects old format
scenarios.push({
  id: nextId('cache'),
  description: 'TH-02: Echo endpoint changes key from "echo" to "data", predicate expects "echo"',
  edits: [{ file: 'server.js', search: '{ echo: body, timestamp: Date.now() }', replace: '{ data: body, ts: Date.now() }' }],
  predicates: [{
    type: 'http',
    method: 'POST',
    path: '/api/echo',
    body: { test: 'hello' },
    expect: { status: 200, bodyContains: '"echo"' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'stale_cache', 'TH-02'],
  rationale: 'Response format changed but predicate checks old key name — stale contract',
});

// TH-02d: Control — edit items and check for NEW data
scenarios.push({
  id: nextId('cache'),
  description: 'TH-02 control: Edit API items and check for new name',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Omega' }" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Omega' },
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'stale_cache', 'TH-02', 'control'],
  rationale: 'Edit and check match — no staleness',
});

// =============================================================================
// HTTP Sequence with delayBeforeMs — Timing race scenarios
// These test the new delayBeforeMs extension to the HTTP gate.
// =============================================================================

// TH-seq-01: Sequence with immediate check then delayed check
scenarios.push({
  id: nextId('seq'),
  description: 'TH-seq: Two-step health check — immediate then delayed (both should pass)',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/health', delayBeforeMs: 0, expect: { status: 200 } },
      { method: 'GET', path: '/health', delayBeforeMs: 100, expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'sequence_timing', 'TH-01'],
  rationale: 'Health endpoint is stable — both immediate and delayed checks pass',
});

// TH-seq-02: POST then immediate GET (create-then-read)
scenarios.push({
  id: nextId('seq'),
  description: 'TH-seq: POST to echo then GET health — multi-method sequence',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { msg: 'test' }, expect: { status: 200 } },
      { method: 'GET', path: '/health', delayBeforeMs: 50, expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'sequence_timing'],
  rationale: 'POST then GET — server handles both methods in sequence',
});

// TH-seq-03: Sequence where first step fails (wrong path after edit)
scenarios.push({
  id: nextId('seq'),
  description: 'TH-seq: First step hits renamed route — sequence fails at step 1',
  edits: [{ file: 'server.js', search: "req.url === '/api/items'", replace: "req.url === '/api/data'" }],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/api/items', expect: { status: 200 } },
      { method: 'GET', path: '/health', delayBeforeMs: 100, expect: { status: 200 } },
    ],
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['temporal', 'http', 'sequence_timing', 'TH-02'],
  rationale: 'Route renamed — first step gets 404, sequence fails',
});

// =============================================================================
// Pure-tier structural scenarios (no Docker needed)
// These test the interaction between edits and HTTP predicates at file level.
// The HTTP gate is skipped in pure tier, but content/filesystem gates run.
// =============================================================================

// TH-pure-01: Edit server.js route handler, content predicate checks for old pattern
scenarios.push({
  id: nextId('pure'),
  description: 'TH-pure: Edit renames /api/items handler, content check for old route',
  edits: [{ file: 'server.js', search: "/api/items", replace: "/api/products" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '/api/items' }],
  expectedSuccess: false,
  tags: ['temporal', 'http', 'stale_route', 'TH-02', 'pure'],
  rationale: 'Route renamed in server.js — old pattern no longer present (pure tier)',
});

// TH-pure-02: Edit health check in Dockerfile but server.js route unchanged
scenarios.push({
  id: nextId('pure'),
  description: 'TH-pure: Edit Dockerfile healthcheck path, server.js still has /health',
  edits: [{ file: 'Dockerfile', search: 'http://localhost:3000/health', replace: 'http://localhost:3000/ready' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '/ready' }],
  expectedSuccess: false,
  tags: ['temporal', 'http', 'stale_route', 'TH-01', 'pure'],
  rationale: 'Dockerfile checks /ready but server.js has no /ready route — cross-file desync',
});

// TH-pure-03: Edit server.js response content type, content predicate checks Dockerfile
scenarios.push({
  id: nextId('pure'),
  description: 'TH-pure: Edit server.js content-type, Dockerfile healthcheck unchanged',
  edits: [{ file: 'server.js', search: "'Content-Type': 'application/json'", replace: "'Content-Type': 'text/plain'" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'text/plain' }],
  expectedSuccess: false,
  tags: ['temporal', 'http', 'stale_cache', 'TH-02', 'pure'],
  rationale: 'Content-Type changed in server.js but Dockerfile has no reference to it',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-http scenarios → ${outPath}`);
