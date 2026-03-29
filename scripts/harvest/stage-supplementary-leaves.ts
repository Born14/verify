#!/usr/bin/env bun
/**
 * stage-supplementary-leaves.ts — Supplementary Scenario Stager
 * Covers shapes that were in the original crosscutting-advanced fixture:
 *   Performance: PERF-02, PERF-03, PERF-05, PERF-06
 *   Serialization: SER-07
 *   Interaction: I-04, I-05, I-13 through I-16
 *
 * Run: bun scripts/harvest/stage-supplementary-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/supplementary-leaves-staged.json');
const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `sup-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// =============================================================================
// PERF-02: Largest Contentful Paint (LCP) regression
// =============================================================================

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-02: Large unoptimized image added to hero section',
  edits: [{ file: 'server.js', search: '<div class="hero">', replace: '<div class="hero"><img src="/hero-bg.jpg" width="1920" height="1080" style="width:100%" />' }],
  predicates: [{ type: 'performance', metric: 'lcp_element_size', threshold: 500000, assertion: 'below' }],
  expectedSuccess: false,
  tags: ['performance', 'lcp', 'PERF-02'],
  rationale: 'Unoptimized 1920x1080 image in hero — LCP element exceeds size budget',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-02: Render-blocking inline style in head',
  edits: [{ file: 'server.js', search: '<title>About - Demo App</title>', replace: '<title>About - Demo App</title>\n  <style>body{background:url(/large-texture.png) repeat}</style>' }],
  predicates: [{ type: 'performance', metric: 'render_blocking_resources', threshold: 0, assertion: 'equals' }],
  expectedSuccess: false,
  tags: ['performance', 'lcp', 'PERF-02'],
  rationale: 'Background image reference in render-blocking CSS delays LCP',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-02 control: Small optimized image with lazy loading',
  edits: [{ file: 'server.js', search: '<img class="logo" src="/logo.png" alt="Demo Logo" />', replace: '<img class="logo" src="/logo.png" alt="Demo Logo" loading="lazy" width="100" height="100" />' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'loading="lazy"' }],
  expectedSuccess: true,
  tags: ['performance', 'lcp', 'PERF-02', 'control'],
  rationale: 'Lazy-loaded small image does not affect LCP',
});

// =============================================================================
// PERF-03: Cumulative Layout Shift (CLS) above threshold
// =============================================================================

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-03: Image without dimensions causes layout shift',
  edits: [{ file: 'server.js', search: '<img class="logo" src="/logo.png" alt="Demo Logo" />', replace: '<img class="logo" src="/logo.png" alt="Demo Logo" />\n  <img src="/banner.jpg" alt="Banner" />' }],
  predicates: [{ type: 'performance', metric: 'images_without_dimensions', threshold: 0, assertion: 'equals' }],
  expectedSuccess: false,
  tags: ['performance', 'cls', 'PERF-03'],
  rationale: 'Image without width/height causes CLS when it loads',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-03: Dynamic content injection without reserved space',
  edits: [{ file: 'server.js', search: '<footer>About page footer</footer>', replace: '<div id="ad-slot"></div>\n  <footer>About page footer</footer>' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'ad-slot' }],
  expectedSuccess: true,
  tags: ['performance', 'cls', 'PERF-03'],
  rationale: 'Empty div for dynamic content — structural check passes, CLS is runtime',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-03 control: Image with explicit dimensions',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'width="100" height="100"' }],
  expectedSuccess: true,
  tags: ['performance', 'cls', 'PERF-03', 'control'],
  rationale: 'Logo image has explicit dimensions — no layout shift',
});

// =============================================================================
// PERF-05: Memory leak across requests
// =============================================================================

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-05: Global array accumulates data on each request',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst requestLog = []; // grows unbounded" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'requestLog = \\[\\]' }],
  expectedSuccess: true,
  tags: ['performance', 'memory_leak', 'PERF-05'],
  rationale: 'Unbounded global array — structural check passes, runtime will OOM',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-05: Event listener added per request without cleanup',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst EventEmitter = require('events');\nconst bus = new EventEmitter();" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'new EventEmitter' }],
  expectedSuccess: true,
  tags: ['performance', 'memory_leak', 'PERF-05'],
  rationale: 'EventEmitter without listener cleanup — memory grows per connection',
});

// =============================================================================
// PERF-06: N+1 query introduced by mutation
// =============================================================================

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-06: Loop queries DB per item instead of batch',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "// N+1: query per item\n    const items = [1,2].map(id => ({ id, name: 'Item'+id })); // simulate N+1\n    res.end(JSON.stringify(items));" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'N\\+1' }],
  expectedSuccess: true,
  tags: ['performance', 'n_plus_1', 'PERF-06'],
  rationale: 'Comment documents N+1 pattern — structural check passes, performance is runtime',
});

scenarios.push({
  id: nextId('perf'),
  description: 'PERF-06: Nested loop constructs multiple queries',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// WARNING: this creates O(n*m) queries\nfunction getItemsWithDetails(items) { return items.map(i => ({ ...i, details: 'fetched' })); }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'O\\(n\\*m\\)' }],
  expectedSuccess: true,
  tags: ['performance', 'n_plus_1', 'PERF-06'],
  rationale: 'Quadratic query pattern documented in code — structural check only',
});

// =============================================================================
// SER-07: Circular reference in serializable object
// =============================================================================

scenarios.push({
  id: nextId('ser'),
  description: 'SER-07: Object with circular reference in API response',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "const obj = { status: 'ok' }; obj.self = obj; try { res.end(JSON.stringify(obj)); } catch(e) { res.end('{\"error\":\"circular\"}'); }" }],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'status' } }],
  expectedSuccess: true,
  tags: ['serialization', 'circular_reference', 'SER-07'],
  rationale: 'Circular ref caught by try/catch — response still contains status',
});

scenarios.push({
  id: nextId('ser'),
  description: 'SER-07: Circular reference crashes JSON.stringify without catch',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "const obj = { status: 'ok' }; obj.self = obj; res.end(JSON.stringify(obj));" }],
  predicates: [{ type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  expectedSuccess: false,
  tags: ['serialization', 'circular_reference', 'SER-07'],
  rationale: 'Uncaught circular ref throws TypeError — endpoint crashes, no response',
});

scenarios.push({
  id: nextId('ser'),
  description: 'SER-07: Serialization with replacer function handles circular refs',
  edits: [{ file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nfunction safeStringify(obj) { const seen = new Set(); return JSON.stringify(obj, (k,v) => { if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[Circular]'; seen.add(v); } return v; }); }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'safeStringify' }],
  expectedSuccess: true,
  tags: ['serialization', 'circular_reference', 'SER-07', 'control'],
  rationale: 'Safe serializer handles circular references gracefully',
});

// =============================================================================
// I-04: HTTP passes, DB fails (response cached/mocked)
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-04: API returns hardcoded data, DB schema changed',
  edits: [{ file: 'init.sql', search: 'title VARCHAR(200) NOT NULL', replace: 'headline VARCHAR(200) NOT NULL' }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
    { type: 'db', table: 'posts', column: 'title', assertion: 'column_exists' },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'http_db', 'I-04'],
  rationale: 'HTTP returns hardcoded items (passes), but DB column renamed (fails) — stale response masks schema change',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-04: API response has old field, DB has new field',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0', replace: 'impression_count INTEGER DEFAULT 0' }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'name' } },
    { type: 'db', table: 'posts', column: 'view_count', assertion: 'column_exists' },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'http_db', 'I-04'],
  rationale: 'HTTP still serves data (cached/hardcoded), DB column renamed — cross-surface divergence',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-04 control: Both API and DB consistent',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
    { type: 'db', table: 'posts', column: 'title', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['interaction', 'http_db', 'I-04', 'control'],
  rationale: 'API and DB both consistent — no cross-surface divergence',
});

// =============================================================================
// I-05: DB passes, HTTP fails (serialization changed)
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-05: DB schema correct but API serializes differently',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ item_id: 1, item_name: 'Alpha' }" }],
  predicates: [
    { type: 'db', table: 'users', column: 'id', assertion: 'column_exists' },
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: '"id"' } },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'db_http', 'I-05'],
  rationale: 'DB schema has id column (passes), but API now serializes as item_id (fails)',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-05: Schema has boolean, API returns string',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ status: 'ok', active: 'true' }));" }],
  predicates: [
    { type: 'db', table: 'users', column: 'is_active', assertion: 'column_type', expected: 'boolean' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: '"active":true' } },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'db_http', 'I-05'],
  rationale: 'DB column is boolean, API serializes as string "true" — type mismatch across surfaces',
});

// =============================================================================
// I-13: Grounding passes (source truth), browser fails (runtime truth)
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-13: CSS selector exists in source but JS removes element at runtime',
  edits: [{ file: 'server.js', search: '<footer>About page footer</footer>', replace: '<footer>About page footer</footer>\n  <script>document.querySelector("footer").remove();</script>' }],
  predicates: [
    { type: 'css', selector: 'footer', property: 'margin-top', expected: '2rem' },
    { type: 'html', selector: 'footer', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['interaction', 'grounding_browser', 'I-13'],
  rationale: 'Source has footer (grounding passes), but JS removes it at runtime (browser would fail)',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-13: Element in source behind async load',
  edits: [{ file: 'server.js', search: '<div id="details">', replace: '<div id="details" data-async="true">' }],
  predicates: [{ type: 'html', selector: '#details', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['interaction', 'grounding_browser', 'I-13'],
  rationale: 'Element in source (grounding passes) but marked async — browser may not see it at check time',
});

// =============================================================================
// I-14: HTTP passes at check time, DB has already changed
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-14: API serves cached items, DB table dropped',
  edits: [{ file: 'init.sql', search: 'CREATE TABLE settings', replace: '-- settings table removed\nCREATE TABLE settings' }],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
    { type: 'db', table: 'settings', column: 'key', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['interaction', 'http_db_timing', 'I-14'],
  rationale: 'API serves hardcoded response (passes), DB still has settings table — but in production, cache staleness is invisible',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-14: Migration changes schema, API response unchanged',
  edits: [{ file: 'init.sql', search: 'value JSONB NOT NULL', replace: 'payload TEXT NOT NULL' }],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
    { type: 'db', table: 'settings', column: 'value', assertion: 'column_exists' },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'http_db_timing', 'I-14'],
  rationale: 'HTTP passes (health unaffected), DB fails (column renamed from value to payload)',
});

// =============================================================================
// I-15: CSS edit passes browser gate, invariant fails (side effect)
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-15: CSS change triggers JS error via CSS-dependent logic',
  edits: [{ file: 'server.js', search: '.hidden { display: none; }', replace: '.hidden { display: block; }' }],
  predicates: [
    { type: 'css', selector: '.hidden', property: 'display', expected: 'block' },
    { type: 'content', file: 'server.js', pattern: 'display: none' },
  ],
  expectedSuccess: false,
  tags: ['interaction', 'css_invariant', 'I-15'],
  rationale: 'CSS predicate passes (display: block), but content predicate expects display: none — side effect of CSS change',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-15: Style change makes hidden content visible, breaking layout assumption',
  edits: [{ file: 'server.js', search: '.hidden { display: none; }', replace: '.hidden { display: flex; visibility: visible; }' }],
  predicates: [{ type: 'css', selector: '.hidden', property: 'display', expected: 'flex' }],
  expectedSuccess: true,
  tags: ['interaction', 'css_invariant', 'I-15'],
  rationale: 'CSS predicate passes — but hidden content now visible may break invariants',
});

// =============================================================================
// I-16: All individual predicates pass, system invariant fails
// =============================================================================

scenarios.push({
  id: nextId('int'),
  description: 'I-16: Each predicate correct, combined state invalid',
  edits: [
    { file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Alpha', status: 'active' }" },
    { file: 'init.sql', search: 'published BOOLEAN DEFAULT false', replace: 'status VARCHAR(20) DEFAULT \'draft\'' },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'active' } },
    { type: 'db', table: 'posts', column: 'status', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['interaction', 'system_invariant', 'I-16'],
  rationale: 'HTTP has "active", DB has status column — both pass, but API status enum differs from DB status enum',
});

scenarios.push({
  id: nextId('int'),
  description: 'I-16: Port in config, env, and code all different',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=4000' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 8080' },
    { type: 'content', file: '.env', pattern: 'PORT=4000' },
  ],
  expectedSuccess: true,
  tags: ['interaction', 'system_invariant', 'I-16'],
  rationale: 'Both predicates pass individually, but config says 8080, env says 4000, code defaults 3000 — three-way disagreement',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);
