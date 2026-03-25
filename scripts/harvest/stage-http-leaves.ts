#!/usr/bin/env bun
/**
 * stage-http-leaves.ts — HTTP Scenario Stager
 *
 * Generates HTTP grounding-gate scenarios from the demo-app's server.js.
 * Same pattern as HTML stager: we know the ground truth of every API endpoint,
 * so we can generate true_positive, false_positive, and false_negative scenarios.
 *
 * The HTTP grounding gate (grounding.ts:506) validates claimed bodyContains content
 * against source files — but ONLY when no appUrl is provided (no live server).
 * This means we test the grounding gate's ability to detect fabricated claims.
 *
 * Scenario types:
 *   1. status_only (true_positive): Predicate only checks status code — no body claim to ground
 *   2. body_exists (true_positive): bodyContains references real content from source
 *   3. body_fabricated (false_positive): bodyContains references content NOT in source
 *   4. body_after_edit (true_positive): Edit adds content, predicate expects it
 *   5. body_regex (true_positive/false_positive): bodyRegex patterns — not grounded (only bodyContains is)
 *   6. post_echo (true_positive): POST to /api/echo — body content is request-dependent
 *   7. wrong_path (edge case): Correct body claim but on non-existent route
 *   8. sequence_basic (true_positive): http_sequence with valid steps
 *   9. body_array (edge case): bodyContains as array — all terms must exist in source
 *  10. expected_field (edge case): p.expected field used instead of expect.bodyContains
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Load server.js ──────────────────────────────────────────────────────────

const SERVER_JS_PATH = resolve(__dirname, '../../fixtures/demo-app/server.js');
const SERVER_JS = readFileSync(SERVER_JS_PATH, 'utf8');

// ── Known API routes and their response content ─────────────────────────────

interface APIRoute {
  path: string;
  method: string;
  contentType: string;
  responseContent: string[];   // strings that appear in the response
  statusCode: number;
}

const KNOWN_ROUTES: APIRoute[] = [
  {
    path: '/health',
    method: 'GET',
    contentType: 'application/json',
    responseContent: ['status', 'ok'],
    statusCode: 200,
  },
  {
    path: '/api/items',
    method: 'GET',
    contentType: 'application/json',
    responseContent: ['Alpha', 'Beta', 'id', 'name'],
    statusCode: 200,
  },
  {
    path: '/api/echo',
    method: 'POST',
    contentType: 'application/json',
    responseContent: ['echo', 'timestamp'],
    statusCode: 200,
  },
  {
    path: '/',
    method: 'GET',
    contentType: 'text/html',
    responseContent: ['Demo App', 'Item Alpha', 'Item Beta', 'Powered by Node.js'],
    statusCode: 200,
  },
  {
    path: '/about',
    method: 'GET',
    contentType: 'text/html',
    responseContent: ['About This App', 'Node.js', 'Alice', 'Bob', 'Carol'],
    statusCode: 200,
  },
];

// ── Scenario types ──────────────────────────────────────────────────────────

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
  return `http-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// ── Type 1: status_only — no body claim, grounding should pass ──────────────

for (const route of KNOWN_ROUTES) {
  // Correct status
  scenarios.push({
    id: nextId('status'),
    description: `${route.method} ${route.path} returns ${route.statusCode} (status only, no body claim)`,
    edits: [],
    predicates: [{
      type: 'http',
      method: route.method,
      path: route.path,
      expect: { status: route.statusCode },
    }],
    expectedSuccess: true,
    tags: ['http', 'status_only', 'false_negative'],
  });

  // Wrong status (should still pass grounding — grounding doesn't check status codes)
  scenarios.push({
    id: nextId('status'),
    description: `${route.method} ${route.path} claims status 999 (grounding doesn't validate status)`,
    edits: [],
    predicates: [{
      type: 'http',
      method: route.method,
      path: route.path,
      expect: { status: 999 },
    }],
    expectedSuccess: true,  // grounding passes — status is validated by HTTP gate, not grounding
    tags: ['http', 'status_only', 'false_negative'],
  });
}

// ── Type 2: body_exists — bodyContains references real content ───────────────

for (const route of KNOWN_ROUTES) {
  for (const content of route.responseContent) {
    scenarios.push({
      id: nextId('body'),
      description: `${route.method} ${route.path} bodyContains "${content}" (exists in source)`,
      edits: [],
      predicates: [{
        type: 'http',
        method: route.method,
        path: route.path,
        expect: {
          status: route.statusCode,
          bodyContains: content,
        },
      }],
      expectedSuccess: true,
      tags: ['http', 'body_exists', 'false_negative'],
    });
  }
}

// ── Type 3: body_fabricated — bodyContains references content NOT in source ──

const FABRICATED_CONTENT = [
  'nonexistent_value_xyz',
  'SuperSecretToken',
  'QuantumFluxCapacitor',
  '{"error": "not_found"}',
  'This text does not appear anywhere in the source',
  'user_id_99999',
];

for (const route of KNOWN_ROUTES.slice(0, 3)) {  // Test against API routes
  for (const fabricated of FABRICATED_CONTENT) {
    scenarios.push({
      id: nextId('fab'),
      description: `${route.method} ${route.path} bodyContains "${fabricated}" (fabricated — not in source)`,
      edits: [],
      predicates: [{
        type: 'http',
        method: route.method,
        path: route.path,
        expect: {
          status: route.statusCode,
          bodyContains: fabricated,
        },
      }],
      expectedSuccess: false,
      expectedFailedGate: 'grounding',
      tags: ['http', 'body_fabricated', 'false_positive'],
    });
  }
}

// ── Type 4: body_after_edit — edit adds new content, predicate expects it ────

const EDIT_ADDITIONS = [
  {
    search: '{ id: 1, name: \'Alpha\' }',
    replace: '{ id: 1, name: \'Alpha\' },\n      { id: 3, name: \'Gamma\' }',
    content: 'Gamma',
    route: '/api/items',
  },
  {
    search: '{ status: \'ok\' }',
    replace: '{ status: \'ok\', version: \'2.0\' }',
    content: 'version',
    route: '/health',
  },
  {
    search: '{ status: \'ok\' }',
    replace: '{ status: \'ok\', uptime: 12345 }',
    content: '12345',
    route: '/health',
  },
];

for (const addition of EDIT_ADDITIONS) {
  scenarios.push({
    id: nextId('edit'),
    description: `Edit adds "${addition.content}" to ${addition.route}, predicate expects it`,
    edits: [{
      file: 'server.js',
      search: addition.search,
      replace: addition.replace,
    }],
    predicates: [{
      type: 'http',
      method: 'GET',
      path: addition.route,
      expect: {
        status: 200,
        bodyContains: addition.content,
      },
    }],
    expectedSuccess: true,  // content exists in edit's replace string → found in source scan
    tags: ['http', 'body_after_edit', 'false_negative'],
  });
}

// ── Type 5: body_regex — bodyRegex is NOT grounded (only bodyContains is) ────

scenarios.push({
  id: nextId('regex'),
  description: 'bodyRegex with valid pattern (not grounded — should pass grounding)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: {
      status: 200,
      bodyRegex: '"name":\\s*"Alpha"',
    },
  }],
  expectedSuccess: true,
  tags: ['http', 'body_regex', 'false_negative'],
});

scenarios.push({
  id: nextId('regex'),
  description: 'bodyRegex with fabricated pattern (not grounded — should still pass grounding)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: {
      status: 200,
      bodyRegex: 'FABRICATED_PATTERN_XYZ',
    },
  }],
  expectedSuccess: true,  // grounding doesn't check bodyRegex
  tags: ['http', 'body_regex', 'false_negative'],
});

// ── Type 6: post_echo — POST body is request-dependent ──────────────────────

scenarios.push({
  id: nextId('post'),
  description: 'POST /api/echo with bodyContains "echo" (in source as JSON key)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'POST',
    path: '/api/echo',
    body: { message: 'hello' },
    expect: {
      status: 200,
      bodyContains: 'echo',
    },
  }],
  expectedSuccess: true,
  tags: ['http', 'post_echo', 'false_negative'],
});

scenarios.push({
  id: nextId('post'),
  description: 'POST /api/echo with bodyContains "hello" (request body — NOT in source)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'POST',
    path: '/api/echo',
    body: { message: 'hello' },
    expect: {
      status: 200,
      bodyContains: 'hello',
    },
  }],
  expectedSuccess: false,  // "hello" is not in any source file
  expectedFailedGate: 'grounding',
  tags: ['http', 'post_echo', 'false_positive'],
});

// ── Type 7: wrong_path — correct claim but nonexistent route ─────────────────

scenarios.push({
  id: nextId('path'),
  description: 'bodyContains "Alpha" on /api/nonexistent (content exists in source but wrong path)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/nonexistent',
    expect: {
      status: 200,
      bodyContains: 'Alpha',
    },
  }],
  expectedSuccess: true,  // grounding checks source files globally, not per-route
  tags: ['http', 'wrong_path', 'false_negative'],
});

// ── Type 8: sequence_basic — http_sequence type ──────────────────────────────

scenarios.push({
  id: nextId('seq'),
  description: 'http_sequence: GET /health then GET /api/items (no body claims)',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/health', expect: { status: 200 } },
      { method: 'GET', path: '/api/items', expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,  // sequences are not grounded for body content
  tags: ['http', 'sequence_basic', 'false_negative'],
});

scenarios.push({
  id: nextId('seq'),
  description: 'http_sequence: POST echo then GET items (no body claims)',
  edits: [],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'POST', path: '/api/echo', body: { test: 'data' }, expect: { status: 200 } },
      { method: 'GET', path: '/api/items', expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,
  tags: ['http', 'sequence_basic', 'false_negative'],
});

// ── Type 9: body_array — bodyContains as array ──────────────────────────────

scenarios.push({
  id: nextId('arr'),
  description: 'bodyContains array: ["Alpha", "Beta"] (both in source)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: {
      status: 200,
      bodyContains: ['Alpha', 'Beta'],
    },
  }],
  expectedSuccess: true,
  tags: ['http', 'body_array', 'false_negative'],
});

scenarios.push({
  id: nextId('arr'),
  description: 'bodyContains array: ["Alpha", "Zeta"] (Zeta not in source)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: {
      status: 200,
      bodyContains: ['Alpha', 'Zeta'],
    },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'body_array', 'false_positive'],
});

scenarios.push({
  id: nextId('arr'),
  description: 'bodyContains array: ["nonexistent1", "nonexistent2"] (neither in source)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: {
      status: 200,
      bodyContains: ['nonexistent1', 'nonexistent2'],
    },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'body_array', 'false_positive'],
});

// ── Type 10: expected_field — p.expected used instead of expect.bodyContains ─

scenarios.push({
  id: nextId('exp'),
  description: 'p.expected="Alpha" (not exists) — should be grounded against source',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expected: 'Alpha',
  }],
  expectedSuccess: true,  // "Alpha" appears in source file
  tags: ['http', 'expected_field', 'false_negative'],
});

scenarios.push({
  id: nextId('exp'),
  description: 'p.expected="fabricated_xyz" — should fail grounding',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expected: 'fabricated_xyz',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'expected_field', 'false_positive'],
});

scenarios.push({
  id: nextId('exp'),
  description: 'p.expected="exists" — special value, should not be grounded',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expected: 'exists',
  }],
  expectedSuccess: true,  // "exists" is special — skipped in grounding
  tags: ['http', 'expected_field', 'false_negative'],
});

// ── Mixed: HTTP + other predicate types ─────────────────────────────────────

scenarios.push({
  id: nextId('mix'),
  description: 'HTTP predicate + CSS predicate together (both grounded independently)',
  edits: [],
  predicates: [
    {
      type: 'http',
      method: 'GET',
      path: '/api/items',
      expect: { status: 200, bodyContains: 'Alpha' },
    },
    {
      type: 'css',
      selector: 'h1',
      property: 'color',
      expected: '#1a1a2e',
      path: '/',
    },
  ],
  expectedSuccess: true,
  tags: ['http', 'mixed', 'false_negative'],
});

scenarios.push({
  id: nextId('mix'),
  description: 'Fabricated HTTP body + valid CSS (grounding rejects on HTTP)',
  edits: [],
  predicates: [
    {
      type: 'http',
      method: 'GET',
      path: '/api/items',
      expect: { status: 200, bodyContains: 'FabricatedContent' },
    },
    {
      type: 'css',
      selector: 'h1',
      property: 'color',
      expected: '#1a1a2e',
      path: '/',
    },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['http', 'mixed', 'false_positive'],
});

// ── Edge: empty/null body claims ────────────────────────────────────────────

scenarios.push({
  id: nextId('edge'),
  description: 'Empty bodyContains string (should pass grounding — nothing to check)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: '' },
  }],
  expectedSuccess: true,  // empty string is substring of everything
  tags: ['http', 'edge_case', 'false_negative'],
});

scenarios.push({
  id: nextId('edge'),
  description: 'No expect field at all (just type + path)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
  }],
  expectedSuccess: true,
  tags: ['http', 'edge_case', 'false_negative'],
});

scenarios.push({
  id: nextId('edge'),
  description: 'expect.status only, no bodyContains or bodyRegex',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200 },
  }],
  expectedSuccess: true,
  tags: ['http', 'edge_case', 'false_negative'],
});

// ── Summary ─────────────────────────────────────────────────────────────────

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/http-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

// Count by type
const typeCounts: Record<string, number> = {};
const intentCounts: Record<string, number> = {};
for (const s of scenarios) {
  const type = s.tags[1] || 'unknown';
  typeCounts[type] = (typeCounts[type] || 0) + 1;
  const intent = s.tags[2] || 'unknown';
  intentCounts[intent] = (intentCounts[intent] || 0) + 1;
}

console.log(`Generated ${scenarios.length} HTTP scenarios → ${OUTPUT_PATH}\n`);
console.log('By type:');
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${type.padEnd(20)} ${count}`);
}
console.log('\nBy intent:');
for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${intent.padEnd(20)} ${count}`);
}
