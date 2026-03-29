#!/usr/bin/env bun
/**
 * stage-crosscutting-advanced.ts — Cross-Cutting Advanced Scenario Stager
 * Shapes: X-05,X-06,X-22,X-28,X-29,X-35,X-36,X-49,X-57-X-65,X-69-X-89
 * Run: bun scripts/harvest/stage-crosscutting-advanced.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/crosscutting-advanced-staged.json');
const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `xadv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// ============================================================================
// X-05: Serialization round-trip stability
// JSON.parse(JSON.stringify(p)) must yield the same fingerprint
// ============================================================================

scenarios.push({
  id: nextId('x05'),
  description: 'X-05: Predicate with nested expect object survives JSON round-trip',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'serialization', 'X-05'],
  rationale: 'Nested expect object must produce identical fingerprint after JSON.parse(JSON.stringify())',
});

scenarios.push({
  id: nextId('x05'),
  description: 'X-05: Predicate with undefined fields omitted vs explicit null — dedup hazard',
  edits: [],
  predicates: [
    { type: 'css', selector: '.hero', property: 'color', expected: '#e74c3c' },
    { type: 'css', selector: '.hero', property: 'color', expected: '#e74c3c', content: undefined },
  ],
  expectedSuccess: false,
  tags: ['fingerprint', 'serialization', 'dedup', 'X-05'],
  rationale: 'Two predicates differing only by undefined vs absent field should deduplicate; different fingerprints means dedup fails',
});

scenarios.push({
  id: nextId('x05'),
  description: 'X-05: Predicate field ordering should not affect fingerprint',
  edits: [],
  predicates: [
    { type: 'http', path: '/health', method: 'GET', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'serialization', 'field-order', 'X-05'],
  rationale: 'Field ordering in predicate object (path before method) must not change the fingerprint vs canonical order',
});

// ============================================================================
// X-06: Unicode in fingerprint input
// ============================================================================

scenarios.push({
  id: nextId('x06'),
  description: 'X-06: CSS selector with CJK characters in class name',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; }\n    .\u6D4B\u8BD5 { color: red; }' },
  ],
  predicates: [
    { type: 'css', selector: '.\u6D4B\u8BD5', property: 'color', expected: 'red' },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'unicode', 'X-06'],
  rationale: 'CJK class name must produce stable fingerprint without encoding corruption',
});

scenarios.push({
  id: nextId('x06'),
  description: 'X-06: Content predicate with emoji pattern',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>\uD83D\uDE80 Powered by Node.js</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '\uD83D\uDE80 Powered' },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'unicode', 'emoji', 'X-06'],
  rationale: 'Emoji in content pattern must not break fingerprint hashing or pattern matching',
});

scenarios.push({
  id: nextId('x06'),
  description: 'X-06: CSS selector with combining diacriticals',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; }\n    .caf\u00E9-menu { color: brown; }' },
  ],
  predicates: [
    { type: 'css', selector: '.caf\u00E9-menu', property: 'color', expected: 'brown' },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'unicode', 'diacritical', 'X-06'],
  rationale: 'Accented characters in selectors must produce consistent fingerprints under NFC vs NFD normalization',
});

// ============================================================================
// X-22: Skipped vs absent vs disabled (three states confused)
// ============================================================================

scenarios.push({
  id: nextId('x22'),
  description: 'X-22: No CSS predicates — CSS gate should be SKIPPED not passed',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'skip-vs-absent', 'X-22'],
  rationale: 'When no CSS predicates exist, the CSS gate should be SKIPPED (not absent or pass). Gate result must reflect skip.',
});

scenarios.push({
  id: nextId('x22'),
  description: 'X-22: DB gate deferred (no live DB) — should not count as passed',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'disabled-vs-pass', 'X-22'],
  rationale: 'If DB validation is deferred (no live DB), it should be marked deferred, not silently passed',
});

scenarios.push({
  id: nextId('x22'),
  description: 'X-22: All CSS predicates filtered by grounding — CSS gate status ambiguous',
  edits: [],
  predicates: [
    { type: 'css', selector: '.nonexistent-alpha', property: 'color', expected: 'red' },
    { type: 'css', selector: '.nonexistent-beta', property: 'color', expected: 'blue' },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'filtered-skip', 'X-22'],
  rationale: 'When all CSS predicates are rejected by grounding, the CSS gate result should be skip (not pass)',
});

// ============================================================================
// X-57: Gate side effects leak into later gates
// ============================================================================

scenarios.push({
  id: nextId('x57'),
  description: 'X-57: F9 gate mutates file state that affects later containment check',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Not Found');\n// F9-side-effect-marker" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'F9-side-effect-marker' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'side-effects', 'X-57'],
  rationale: 'F9 validation must not mutate the edit content or file state that later gates (G5 containment) rely on',
});

scenarios.push({
  id: nextId('x57'),
  description: 'X-57: Grounding gate caches CSS parse — verification must see post-edit state',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #ff0000; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'shared-cache', 'X-57'],
  rationale: 'If grounding gate caches CSS parse results, verification must see post-edit state, not pre-edit cached state',
});

scenarios.push({
  id: nextId('x57'),
  description: 'X-57: K5 constraint seeded mid-pipeline must not affect later gates in same run',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Powered by Sovereign</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Powered by Sovereign' },
    { type: 'html', selector: 'footer', content: 'Powered by Sovereign', path: '/' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'constraint-leak', 'X-57'],
  rationale: 'If a gate seeds a K5 constraint mid-pipeline, later gates in the same run must not be affected by it',
});

// ============================================================================
// X-58: Same gate run twice with inconsistent results
// ============================================================================

scenarios.push({
  id: nextId('x58'),
  description: 'X-58: CSS gate idempotency — running twice on same content must agree',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: navy; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: 'navy' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'idempotent', 'X-58'],
  rationale: 'Running the CSS validation gate twice on the same content must produce the same result',
});

scenarios.push({
  id: nextId('x58'),
  description: 'X-58: Content gate on config file — re-read must be idempotent',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'idempotent', 'X-58'],
  rationale: 'Two consecutive reads of config.json during gate evaluation must return identical content',
});

scenarios.push({
  id: nextId('x58'),
  description: 'X-58: HTTP gate with timestamp in response — non-deterministic body breaks idempotency',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'idempotent', 'non-deterministic', 'X-58'],
  rationale: 'HTTP response may include timestamps; gate must match on stable content (Alpha), not volatile fields',
});

// ============================================================================
// X-59: Partial failure overwritten by later gate
// ============================================================================

scenarios.push({
  id: nextId('x59'),
  description: 'X-59: CSS fails but content passes — CSS failure must survive',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'partial-failure', 'X-59'],
  rationale: 'A passing content predicate must not overwrite or mask the failing CSS predicate result',
});

scenarios.push({
  id: nextId('x59'),
  description: 'X-59: Grounding rejects one predicate, others pass all later gates',
  edits: [],
  predicates: [
    { type: 'css', selector: '.ghost-class', property: 'color', expected: 'red' },
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'partial-failure', 'grounding', 'X-59'],
  rationale: 'Grounding rejection of .ghost-class must persist even if the other predicates pass all later gates',
});

scenarios.push({
  id: nextId('x59'),
  description: 'X-59: DB predicate fails, HTTP passes — DB failure must not be overwritten',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', column: 'nonexistent_col', assertion: 'column_exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'partial-failure', 'db-http', 'X-59'],
  rationale: 'DB column does not exist (fail) but HTTP passes — DB failure must survive in final result',
});

// ============================================================================
// X-60: Optional gate absence treated as pass
// ============================================================================

scenarios.push({
  id: nextId('x60'),
  description: 'X-60: No DB predicates — DB gate absent, should not count as pass for coverage',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'absent-gate', 'X-60'],
  rationale: 'Absent DB gate must not be reported as passed in gate results — it should be absent or N/A',
});

scenarios.push({
  id: nextId('x60'),
  description: 'X-60: No edits — F9 syntax gate has nothing to check, must be skip not pass',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'absent-gate', 'no-edits', 'X-60'],
  rationale: 'When no edits are submitted, the F9 syntax gate is vacuously satisfied — should be marked skip, not pass',
});

scenarios.push({
  id: nextId('x60'),
  description: 'X-60: Browser gate not available — absence must not inflate pass count',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #999; font-size: 1rem; }' },
  ],
  predicates: [
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#999' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'absent-gate', 'browser', 'X-60'],
  rationale: 'If browser gate is not available (no Playwright), its absence must not count as a pass in attestation',
});

// ============================================================================
// X-28: Attribution with multi-file edits (G5 containment)
// ============================================================================

scenarios.push({
  id: nextId('x28'),
  description: 'X-28: Two files edited, predicate covers only one — second edit unexplained',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #e74c3c; font-size: 2rem; }' },
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#e74c3c' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'multi-file', 'unexplained', 'X-28'],
  rationale: 'config.json edit has no predicate justification — G5 should flag as unexplained',
});

scenarios.push({
  id: nextId('x28'),
  description: 'X-28: Three files edited, each covered by separate predicate — full attribution',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: green; font-size: 2rem; }' },
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
    { file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true', replace: 'is_active BOOLEAN DEFAULT false' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: 'green' },
    { type: 'content', file: 'config.json', pattern: '"darkMode": false' },
    { type: 'db', table: 'users', column: 'is_active', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'multi-file', 'full-attribution', 'X-28'],
  rationale: 'All three edits have corresponding predicates — G5 should attribute all as direct',
});

scenarios.push({
  id: nextId('x28'),
  description: 'X-28: Edit touches server.js + .env but predicate only covers server.js',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Powered by Sovereign</footer>' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Powered by Sovereign' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'multi-file', 'env-unexplained', 'X-28'],
  rationale: '.env edit is unexplained by any predicate — config change without justification',
});

// ============================================================================
// X-29: SQL mutation attribution
// ============================================================================

scenarios.push({
  id: nextId('x29'),
  description: 'X-29: SQL edit adds column — DB predicate covers the new column',
  edits: [
    { file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true,', replace: 'is_active BOOLEAN DEFAULT true,\n    display_name VARCHAR(100),' },
  ],
  predicates: [
    { type: 'db', table: 'users', column: 'display_name', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'sql-attribution', 'X-29'],
  rationale: 'SQL mutation adding display_name should be attributed directly to the DB predicate',
});

scenarios.push({
  id: nextId('x29'),
  description: 'X-29: SQL edit modifies constraint on email but predicate checks username',
  edits: [
    { file: 'init.sql', search: 'email VARCHAR(255) NOT NULL', replace: 'email VARCHAR(255) UNIQUE NOT NULL' },
  ],
  predicates: [
    { type: 'db', table: 'users', column: 'username', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'sql-attribution', 'unrelated-predicate', 'X-29'],
  rationale: 'Edit to email constraint is unexplained by a predicate targeting username column',
});

scenarios.push({
  id: nextId('x29'),
  description: 'X-29: SQL mutation comments out table — destructive with no justification',
  edits: [
    { file: 'init.sql', search: 'CREATE TABLE settings (', replace: '-- DROPPED: CREATE TABLE settings (' },
  ],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
  ],
  expectedSuccess: false,
  tags: ['containment', 'sql-attribution', 'destructive', 'X-29'],
  rationale: 'Commenting out a table creation is destructive SQL mutation with no predicate justification',
});

// ============================================================================
// X-35: Route discovery accuracy
// ============================================================================

scenarios.push({
  id: nextId('x35'),
  description: 'X-35: Static route /health discoverable by string analysis',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'route-discovery', 'X-35'],
  rationale: 'The /health route is statically visible in server.js — grounding must discover it',
});

scenarios.push({
  id: nextId('x35'),
  description: 'X-35: Route computed from concatenation — invisible to static analysis',
  edits: [
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "const healthPath = '/hea' + 'lth';\n  if (req.url === healthPath) {" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'route-discovery', 'dynamic-path', 'X-35'],
  rationale: 'Route path built via string concatenation is invisible to static route discovery',
});

scenarios.push({
  id: nextId('x35'),
  description: 'X-35: Route in commented-out code should not be discovered',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Not Found');\n  // if (req.url === '/admin') { res.end('admin'); }" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/admin', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'route-discovery', 'commented-out', 'X-35'],
  rationale: 'Commented-out route should not be discovered as valid by grounding',
});

// ============================================================================
// X-36: Dynamic route patterns (/api/:id)
// ============================================================================

scenarios.push({
  id: nextId('x36'),
  description: 'X-36: Parameterized Express route /api/users/:id',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Not Found');\n  // Express: app.get('/api/users/:id', handler)" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/users/1', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'dynamic-routes', 'parameterized', 'X-36'],
  rationale: 'Parameterized route /api/users/:id must be recognized when predicate uses concrete /api/users/1',
});

scenarios.push({
  id: nextId('x36'),
  description: 'X-36: Wildcard route via startsWith matches any sub-path',
  edits: [
    { file: 'server.js', search: "if (req.url === '/api/items') {", replace: "if (req.url.startsWith('/api/')) {" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/anything', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'dynamic-routes', 'wildcard', 'X-36'],
  rationale: 'startsWith-based route matching creates an implicit wildcard that grounding may miss',
});

scenarios.push({
  id: nextId('x36'),
  description: 'X-36: Regex-based route not discoverable by string analysis',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Not Found');\n  // Route: req.url.match(/^\\/items\\/\\d+$/)" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/items/42', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'dynamic-routes', 'regex', 'X-36'],
  rationale: 'Regex-based route is beyond static analysis — grounding under-approximates',
});

// ============================================================================
// X-61: Grounding snapshot stale vs verification target
// ============================================================================

scenarios.push({
  id: nextId('x61'),
  description: 'X-61: New selector added by edit — grounding ran pre-edit, rejects as fabricated',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; }\n    .new-section { color: teal; }' },
  ],
  predicates: [
    { type: 'css', selector: '.new-section', property: 'color', expected: 'teal' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['grounding', 'stale-snapshot', 'X-61'],
  rationale: 'Grounding runs against pre-edit files, so .new-section does not exist yet — rejected as fabricated',
});

scenarios.push({
  id: nextId('x61'),
  description: 'X-61: Selector exists pre-edit but edit removes it — stale grounding pass',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '/* subtitle removed */' },
  ],
  predicates: [
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#666' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'stale-snapshot', 'removed-selector', 'X-61'],
  rationale: 'Grounding passes (selector exists pre-edit) but verification fails (selector removed by edit)',
});

scenarios.push({
  id: nextId('x61'),
  description: 'X-61: Property value correct at grounding but edit changes it to wrong value',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #333333; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'stale-snapshot', 'value-drift', 'X-61'],
  rationale: 'Predicate expects pre-edit value; grounding passes but post-edit verification fails',
});

// ============================================================================
// X-62: Grounding over-approximates existence
// ============================================================================

scenarios.push({
  id: nextId('x62'),
  description: 'X-62: Selector in CSS-in-JS string literal, not real stylesheet',
  edits: [],
  predicates: [
    { type: 'css', selector: '.fake-selector', property: 'color', expected: 'green' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'over-approximation', 'css-in-js', 'X-62'],
  rationale: '.fake-selector exists in a JS string literal on edge-cases page, not in a <style> block',
});

scenarios.push({
  id: nextId('x62'),
  description: 'X-62: CSS rule inside @media block treated as always-reachable',
  edits: [],
  predicates: [
    { type: 'css', selector: '.responsive-only', property: 'display', expected: 'block' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'over-approximation', 'media-query', 'X-62'],
  rationale: '.responsive-only only exists inside @media (max-width:768px) — unreachable on desktop viewport',
});

scenarios.push({
  id: nextId('x62'),
  description: 'X-62: HTML element in a comment — not part of live DOM',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<!-- <div class="phantom">phantom</div> -->\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [
    { type: 'html', selector: '.phantom', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'over-approximation', 'commented-html', 'X-62'],
  rationale: 'HTML element inside a comment is not part of the DOM — grounding should not consider it reachable',
});

// ============================================================================
// X-63: Grounding under-approximates (indirect assembly, imported CSS)
// ============================================================================

scenarios.push({
  id: nextId('x63'),
  description: 'X-63: CSS class applied via JS classList.add — invisible to static analysis',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: "<script>document.body.classList.add('dark-theme');</script>\n  <footer>Powered by Node.js</footer>" },
  ],
  predicates: [
    { type: 'html', selector: '.dark-theme', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'under-approximation', 'js-classlist', 'X-63'],
  rationale: 'JS-applied class is invisible to static HTML analysis — grounding cannot see runtime DOM modifications',
});

scenarios.push({
  id: nextId('x63'),
  description: 'X-63: External CSS <link> not followed by grounding',
  edits: [
    { file: 'server.js', search: '<style>\n    body { font-family: sans-serif', replace: '<link rel="stylesheet" href="/external.css">\n  <style>\n    body { font-family: sans-serif' },
  ],
  predicates: [
    { type: 'css', selector: '.external-class', property: 'color', expected: 'purple' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'under-approximation', 'external-css', 'X-63'],
  rationale: 'Grounding only parses inline <style> blocks — external CSS files are not followed',
});

scenarios.push({
  id: nextId('x63'),
  description: 'X-63: Dynamic class from template literal — runtime-only DOM',
  edits: [],
  predicates: [
    { type: 'html', selector: '.status-active', expected: 'exists', path: '/edge-cases' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'under-approximation', 'template-conditional', 'X-63'],
  rationale: 'Dynamic class status-active is computed from Date.now() — grounding cannot predict runtime value',
});

// ============================================================================
// X-64: Cross-file composition not reflected
// ============================================================================

scenarios.push({
  id: nextId('x64'),
  description: 'X-64: Config port change does not affect server.js behavior in grounding',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 8080' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 8080' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'cross-file', 'config-server', 'X-64'],
  rationale: 'Config port change does not affect server.js behavior in static analysis — cross-file composition invisible',
});

scenarios.push({
  id: nextId('x64'),
  description: 'X-64: init.sql schema + server.js query — grounded independently',
  edits: [
    { file: 'init.sql', search: 'title VARCHAR(200) NOT NULL', replace: 'title VARCHAR(200) NOT NULL,\n    slug VARCHAR(200) UNIQUE' },
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Not Found');\n  // Uses posts.slug from init.sql" },
  ],
  predicates: [
    { type: 'db', table: 'posts', column: 'slug', assertion: 'column_exists' },
    { type: 'content', file: 'server.js', pattern: 'posts.slug' },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'cross-file', 'sql-server', 'X-64'],
  rationale: 'Schema change in init.sql and code referencing it in server.js are grounded independently',
});

scenarios.push({
  id: nextId('x64'),
  description: 'X-64: .env variable referenced in server.js — cross-file dependency invisible',
  edits: [
    { file: '.env', search: 'PORT=3000', replace: 'PORT=9090' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=9090' },
    { type: 'content', file: 'server.js', pattern: 'process.env.PORT' },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'cross-file', 'env-server', 'X-64'],
  rationale: '.env PORT and server.js process.env.PORT are semantically linked but grounded as separate files',
});

// ============================================================================
// X-65: Environment-dependent routes behind flags
// ============================================================================

scenarios.push({
  id: nextId('x65'),
  description: 'X-65: Route only active when DEBUG=true in .env',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "if (process.env.DEBUG === 'true') { res.writeHead(200); res.end('debug'); return; }\n  res.end('Not Found');" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/debug', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'env-dependent', 'feature-flag', 'X-65'],
  rationale: 'Route gated behind DEBUG env var — grounding cannot evaluate runtime environment conditions',
});

scenarios.push({
  id: nextId('x65'),
  description: 'X-65: Feature flag in config.json controls route availability',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "// if (features.analytics) serve /analytics\n  res.end('Not Found');" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/analytics', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'env-dependent', 'config-flag', 'X-65'],
  rationale: 'Analytics route depends on features.analytics flag (false in config.json)',
});

scenarios.push({
  id: nextId('x65'),
  description: 'X-65: NODE_ENV=production hides dev-only route',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "// if (process.env.NODE_ENV !== 'production') serve /dev-tools\n  res.end('Not Found');" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'NODE_ENV=production' },
    { type: 'http', method: 'GET', path: '/dev-tools', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'env-dependent', 'node-env', 'X-65'],
  rationale: 'NODE_ENV=production means /dev-tools is unreachable — env-dependent routing',
});

// ============================================================================
// X-69: Unicode grapheme boundaries break search
// ============================================================================

scenarios.push({
  id: nextId('x69'),
  description: 'X-69: Edit inserts multi-byte UTF-8 em dash character',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Powered by Node.js \u2014 v2</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '\u2014 v2' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'unicode-grapheme', 'X-69'],
  rationale: 'Em dash (U+2014) is 3 bytes in UTF-8 — search/replace must handle multi-byte boundaries correctly',
});

scenarios.push({
  id: nextId('x69'),
  description: 'X-69: Search string with zero-width joiner (ZWJ) sequence',
  edits: [
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<p class="subtitle">A minimal app for testing \u200D@sovereign-labs/verify</p>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '\u200D@sovereign' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'unicode-grapheme', 'zwj', 'X-69'],
  rationale: 'ZWJ character is invisible but changes byte count — search must not break on it',
});

scenarios.push({
  id: nextId('x69'),
  description: 'X-69: Replace string contains precomposed accented character',
  edits: [
    { file: 'server.js', search: 'Item Alpha', replace: 'Item \u00C1lpha' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '\u00C1lpha' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'unicode-grapheme', 'combining', 'X-69'],
  rationale: 'Precomposed \u00C1 vs decomposed A + combining acute — search must handle both NFC/NFD forms',
});

// ============================================================================
// X-70: File mutated between read and apply
// ============================================================================

scenarios.push({
  id: nextId('x70'),
  description: 'X-70: TOCTOU — edit search assumes stable file content',
  edits: [
    { file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Updated App"' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"name": "Updated App"' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'toctou', 'X-70'],
  rationale: 'If another process modifies config.json between read and apply, the edit may fail to match',
});

scenarios.push({
  id: nextId('x70'),
  description: 'X-70: Two sequential edits to same file — second depends on first',
  edits: [
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 4000;' },
    { file: 'server.js', search: 'const PORT = process.env.PORT || 4000;', replace: 'const PORT = process.env.PORT || 5000;' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'PORT || 5000' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'toctou', 'sequential-edits', 'X-70'],
  rationale: 'Second edit depends on first having been applied — tests edit ordering guarantees',
});

scenarios.push({
  id: nextId('x70'),
  description: 'X-70: Secret rotation in .env may change search target between reads',
  edits: [
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotated-key-abc123"' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'rotated-key-abc123' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'toctou', 'env-mutation', 'X-70'],
  rationale: 'Secret rotation between read and apply could change the search target',
});

// ============================================================================
// X-71: Search matches scaffold/boilerplate, not target
// ============================================================================

scenarios.push({
  id: nextId('x71'),
  description: 'X-71: "color: red" matches .required::after boilerplate, not target class',
  edits: [
    { file: 'server.js', search: 'color: red;', replace: 'color: darkred;' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'color: darkred' },
  ],
  expectedSuccess: false,
  tags: ['syntax', 'ambiguous-search', 'boilerplate', 'X-71'],
  rationale: '"color: red;" appears in multiple CSS rules — search hits first occurrence which may be boilerplate, not the intended target',
});

scenarios.push({
  id: nextId('x71'),
  description: 'X-71: "padding: 0.5rem;" matches multiple unrelated rules',
  edits: [
    { file: 'server.js', search: 'padding: 0.5rem;', replace: 'padding: 1rem;' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'padding: 1rem;' },
  ],
  expectedSuccess: false,
  tags: ['syntax', 'ambiguous-search', 'multi-match', 'X-71'],
  rationale: '"padding: 0.5rem;" appears in multiple CSS rules across routes — ambiguous target',
});

scenarios.push({
  id: nextId('x71'),
  description: 'X-71: Unique search string that looks like a common pattern',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: "res.end('Page Not Found');" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Page Not Found' },
  ],
  expectedSuccess: true,
  tags: ['syntax', 'ambiguous-search', 'unique-match', 'X-71'],
  rationale: 'This search string is actually unique despite looking like a common pattern — uniqueness validation should pass',
});

// ============================================================================
// X-72: Hint correct locally but globally harmful
// ============================================================================

scenarios.push({
  id: nextId('x72'),
  description: 'X-72: Narrowing suggests !important — fixes locally, harmful globally',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: red !important; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: 'red' },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'locally-correct', 'globally-harmful', 'X-72'],
  rationale: '!important fixes the immediate issue but makes future CSS changes unpredictable globally',
});

scenarios.push({
  id: nextId('x72'),
  description: 'X-72: Inline style hint avoids specificity but breaks maintainability',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1 style="color: red;">Demo App</h1>' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: 'red' },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'locally-correct', 'inline-style', 'X-72'],
  rationale: 'Inline style technically satisfies color=red but CSS gate checks <style> blocks, not inline attrs',
});

scenarios.push({
  id: nextId('x72'),
  description: 'X-72: Removing form validation fixes submission issue but removes protection',
  edits: [
    { file: 'server.js', search: 'required placeholder="Your name"', replace: 'placeholder="Your name"' },
  ],
  predicates: [
    { type: 'html', selector: '#name', expected: 'exists', path: '/form' },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'locally-correct', 'validation-removal', 'X-72'],
  rationale: 'Removing required attribute fixes a hypothetical submission issue but removes input validation',
});

// ============================================================================
// X-73: Hint overfits to specific value not failure class
// ============================================================================

scenarios.push({
  id: nextId('x73'),
  description: 'X-73: Hint suggests exact hex color instead of addressing color scheme',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #ff6347; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff6347' },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'overfit-value', 'X-73'],
  rationale: 'Hint suggests #ff6347 specifically when any warm color would address the failure class — overfitting',
});

scenarios.push({
  id: nextId('x73'),
  description: 'X-73: Hint suggests exact font-size px instead of relative unit fix',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 18px; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'font-size', expected: '18px' },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'overfit-value', 'font-size', 'X-73'],
  rationale: 'Hint overfits to 18px when the real issue is rem-to-px mismatch — different px value has same class of problem',
});

scenarios.push({
  id: nextId('x73'),
  description: 'X-73: Hint suggests exact bodyContains string for HTTP but response format may vary',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: '"id":1' } },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'overfit-value', 'json-format', 'X-73'],
  rationale: 'Hint matches exact JSON format "id":1 without space; response may have "id": 1 with space — overfitting to format',
});

// ============================================================================
// X-74: Hint leaks wrong causal explanation
// ============================================================================

scenarios.push({
  id: nextId('x74'),
  description: 'X-74: Hint blames CSS specificity when selector simply does not exist yet',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; }\n    .tagline { color: #444; }' },
  ],
  predicates: [
    { type: 'css', selector: '.tagline', property: 'color', expected: '#444' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['narrowing', 'wrong-causal', 'X-74'],
  rationale: 'A narrowing hint about CSS specificity is misleading when the selector does not exist pre-edit',
});

scenarios.push({
  id: nextId('x74'),
  description: 'X-74: Hint claims DB type mismatch but column was just created',
  edits: [
    { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0', replace: 'view_count INTEGER DEFAULT 0,\n    rating DECIMAL(3,2)' },
  ],
  predicates: [
    { type: 'db', table: 'posts', column: 'rating', assertion: 'column_type', expected: 'numeric' },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'wrong-causal', 'db-type', 'X-74'],
  rationale: 'If hint says "wrong column type" but column was just created, the causal explanation is inaccurate',
});

scenarios.push({
  id: nextId('x74'),
  description: 'X-74: Hint blames route handler when real issue is missing HTML element',
  edits: [
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<p class="subtitle">Welcome to the verification suite</p>' },
  ],
  predicates: [
    { type: 'html', selector: '.welcome-banner', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'wrong-causal', 'missing-element', 'X-74'],
  rationale: 'Hint about route handler is wrong — the real issue is .welcome-banner class was never added to HTML',
});

// ============================================================================
// X-75: Multiple failures, narrowing picks wrong one
// ============================================================================

scenarios.push({
  id: nextId('x75'),
  description: 'X-75: CSS + content both fail — narrowing focuses on CSS but content is root cause',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer></footer>' },
  ],
  predicates: [
    { type: 'css', selector: 'footer', property: 'color', expected: '#999' },
    { type: 'content', file: 'server.js', pattern: 'Powered by Node.js' },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'wrong-target', 'multi-failure', 'X-75'],
  rationale: 'Content was removed (root cause) but narrowing might focus on CSS color (symptom)',
});

scenarios.push({
  id: nextId('x75'),
  description: 'X-75: Three predicates fail — narrowing should pick most actionable',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1></h1>' },
  ],
  predicates: [
    { type: 'html', selector: 'h1', content: 'Demo App', path: '/' },
    { type: 'content', file: 'server.js', pattern: '<h1>Demo App</h1>' },
    { type: 'css', selector: 'h1', property: 'font-size', expected: '2rem' },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'wrong-target', 'priority', 'X-75'],
  rationale: 'All three predicates affected by removing h1 content — narrowing should target content, not CSS',
});

scenarios.push({
  id: nextId('x75'),
  description: 'X-75: DB and HTTP both fail — DB schema is root cause, HTTP is downstream',
  edits: [
    { file: 'init.sql', search: 'CREATE TABLE settings (', replace: '-- CREATE TABLE settings (' },
  ],
  predicates: [
    { type: 'db', table: 'settings', assertion: 'table_exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'wrong-target', 'db-root-cause', 'X-75'],
  rationale: 'Settings table removal is root cause — HTTP failure is downstream but narrowing might pick HTTP',
});

// ============================================================================
// X-49: All three authorities disagree (vision triangulation)
// ============================================================================

scenarios.push({
  id: nextId('x49'),
  description: 'X-49: Deterministic pass, browser fail, vision unclear — three-way disagreement',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 3rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'font-size', expected: '3rem' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'three-way-disagree', 'X-49'],
  rationale: 'File shows 3rem (deterministic pass), browser may compute differently, vision unclear — no majority',
});

scenarios.push({
  id: nextId('x49'),
  description: 'X-49: Content + HTML pass but vision says footer invisible — vision outlier',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Powered by Sovereign</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Powered by Sovereign' },
    { type: 'html', selector: 'footer', content: 'Powered by Sovereign', path: '/' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'vision-outlier', 'X-49'],
  rationale: 'Deterministic and browser agree, vision disagrees — vision is the outlier authority',
});

scenarios.push({
  id: nextId('x49'),
  description: 'X-49: All three fail but for different reasons — transparent+zero color',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: transparent; font-size: 0; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'unanimous-fail', 'different-reasons', 'X-49'],
  rationale: 'Deterministic: transparent not #ff0000. Browser: computed differs. Vision: invisible. All fail with different evidence.',
});

// ============================================================================
// X-76: Screenshot taken before render settles
// ============================================================================

scenarios.push({
  id: nextId('x76'),
  description: 'X-76: CSS animation in progress when screenshot captured — opacity unstable',
  edits: [
    { file: 'server.js', search: '.animated { animation: pulse 2s infinite; color: #9b59b6; }', replace: '.animated { animation: pulse 2s infinite; color: #9b59b6; opacity: 0.5; }' },
  ],
  predicates: [
    { type: 'css', selector: '.animated', property: 'opacity', expected: '0.5', path: '/edge-cases' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'render-settle', 'animation', 'X-76'],
  rationale: 'Pulse animation changes opacity between 0.5 and 1.0 — screenshot timing determines captured value',
});

scenarios.push({
  id: nextId('x76'),
  description: 'X-76: Async-loaded content not rendered at screenshot time',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: "<script>setTimeout(() => document.body.innerHTML += '<div class=\"async-content\">Loaded</div>', 2000);</script>\n  <footer>Powered by Node.js</footer>" },
  ],
  predicates: [
    { type: 'html', selector: '.async-content', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'render-settle', 'async-content', 'X-76'],
  rationale: 'Content loads after 2s delay — screenshot taken before settle window may miss it',
});

scenarios.push({
  id: nextId('x76'),
  description: 'X-76: CSS transition not settled — mid-transition value captured',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; transition: color 1s; }\n    .subtitle:hover { color: red; }' },
  ],
  predicates: [
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#666' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'render-settle', 'transition', 'X-76'],
  rationale: 'Transition on color means captured value depends on timing — mid-transition value is unpredictable',
});

// ============================================================================
// X-77: Viewport/device differences change verdict
// ============================================================================

scenarios.push({
  id: nextId('x77'),
  description: 'X-77: Responsive CSS only applies at mobile viewport width',
  edits: [],
  predicates: [
    { type: 'css', selector: '.responsive-only', property: 'color', expected: '#27ae60', path: '/edge-cases' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'viewport', 'responsive', 'X-77'],
  rationale: '.responsive-only rule inside @media (max-width:768px) — desktop viewport will not apply it',
});

scenarios.push({
  id: nextId('x77'),
  description: 'X-77: Font-family depends on installed fonts in headless browser',
  edits: [
    { file: 'server.js', search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }", replace: "body { font-family: 'Helvetica Neue', sans-serif; margin: 2rem; background: #ffffff; color: #333; }" },
  ],
  predicates: [
    { type: 'css', selector: 'body', property: 'font-family', expected: "'Helvetica Neue', sans-serif" },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'viewport', 'font-rendering', 'X-77'],
  rationale: 'Headless browser may not have Helvetica Neue — computed font-family differs from declared',
});

scenarios.push({
  id: nextId('x77'),
  description: 'X-77: Container query changes layout based on parent width',
  edits: [
    { file: 'server.js', search: '.items { list-style: none; padding: 0; }', replace: '.items { list-style: none; padding: 0; container-type: inline-size; }\n    @container (min-width: 600px) { .items li { display: inline; } }' },
  ],
  predicates: [
    { type: 'css', selector: '.items li', property: 'display', expected: 'inline' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'viewport', 'container-query', 'X-77'],
  rationale: 'Container query depends on parent width at runtime — deterministic check of source cannot predict',
});

// ============================================================================
// X-78: Off-screen/cropped element -> false failure
// ============================================================================

scenarios.push({
  id: nextId('x78'),
  description: 'X-78: Element with display:none — vision cannot see it, DOM knows it exists',
  edits: [],
  predicates: [
    { type: 'html', selector: '.hidden', expected: 'exists', path: '/about' },
    { type: 'css', selector: '.hidden', property: 'display', expected: 'none', path: '/about' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'off-screen', 'display-none', 'X-78'],
  rationale: 'Element exists in DOM (HTML pass) and display:none (CSS pass) but vision sees nothing — false failure risk',
});

scenarios.push({
  id: nextId('x78'),
  description: 'X-78: Footer below fold requires scrolling — may be cropped in screenshot',
  edits: [],
  predicates: [
    { type: 'html', selector: 'footer', content: 'About page footer', path: '/about' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'off-screen', 'below-fold', 'X-78'],
  rationale: 'Footer at bottom of long page may be cropped in screenshot — vision reports missing when it exists',
});

scenarios.push({
  id: nextId('x78'),
  description: 'X-78: Element with overflow:hidden clips child content',
  edits: [],
  predicates: [
    { type: 'html', selector: '.overflow-box', content: 'Overflow hidden content that may be clipped', path: '/edge-cases' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'off-screen', 'overflow-clip', 'X-78'],
  rationale: 'overflow:hidden clips content that extends beyond 200x100px box — vision may not see clipped text',
});

// ============================================================================
// X-79: Visual pass masks semantic failure
// ============================================================================

scenarios.push({
  id: nextId('x79'),
  description: 'X-79: Page renders correctly but returns wrong HTTP status 503',
  edits: [
    { file: 'server.js', search: "if (req.url === '/about') {\n  res.writeHead(200", replace: "if (req.url === '/about') {\n  res.writeHead(503" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/about', expect: { status: 200 } },
    { type: 'html', selector: '.hero', expected: 'exists', path: '/about' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'visual-mask', 'status-code', 'X-79'],
  rationale: 'Page renders correctly (visual pass) but returns 503 — semantic failure masked by appearance',
});

scenarios.push({
  id: nextId('x79'),
  description: 'X-79: Hidden input with empty value — visually invisible, semantically broken',
  edits: [
    { file: 'server.js', search: '<p>Additional details appear here.</p>', replace: '<p>Additional details appear here.</p>\n    <input type="hidden" name="csrf" value="" />' },
  ],
  predicates: [
    { type: 'html', selector: 'input[name="csrf"]', expected: 'exists', path: '/about' },
    { type: 'content', file: 'server.js', pattern: 'value=""' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'visual-mask', 'hidden-field', 'X-79'],
  rationale: 'Hidden input exists and has empty value — visually invisible but semantically broken (missing CSRF)',
});

scenarios.push({
  id: nextId('x79'),
  description: 'X-79: Same visual result but wrong HTML structure (div vs p)',
  edits: [
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<div class="subtitle">A minimal app for testing @sovereign-labs/verify</div>' },
  ],
  predicates: [
    { type: 'html', selector: 'p.subtitle', expected: 'exists', path: '/' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'visual-mask', 'wrong-element', 'X-79'],
  rationale: 'Visually identical (div renders same as p) but structural HTML predicate correctly fails — p.subtitle no longer exists',
});

// ============================================================================
// X-80: Semantic pass masks visual failure
// ============================================================================

scenarios.push({
  id: nextId('x80'),
  description: 'X-80: CSS property in source but !important override makes it invisible',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 2rem; }\n    h1 { color: white !important; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'semantic-mask', 'important-override', 'X-80'],
  rationale: 'Source-level predicate finds #1a1a2e in first h1 rule, but browser renders white due to !important',
});

scenarios.push({
  id: nextId('x80'),
  description: 'X-80: Correct markup in source but JS removes it at runtime',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: "<footer id=\"main-footer\">Powered by Node.js</footer>\n  <script>document.getElementById('main-footer').remove();</script>" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'main-footer' },
    { type: 'html', selector: '#main-footer', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['triangulation', 'semantic-mask', 'js-removal', 'X-80'],
  rationale: 'Content exists in source (semantic pass) but JS removes it at runtime (visual failure)',
});

scenarios.push({
  id: nextId('x80'),
  description: 'X-80: Content file pattern matches but element has zero height',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; height: 0; overflow: hidden; }' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'sovereign-labs/verify' },
    { type: 'html', selector: '.subtitle', expected: 'exists', path: '/' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'semantic-mask', 'zero-height', 'X-80'],
  rationale: 'Content exists in file and element exists in DOM (semantic pass) but zero height makes it invisible (visual fail)',
});

// ============================================================================
// X-81: Authority weighting bug in final verdict
// ============================================================================

scenarios.push({
  id: nextId('x81'),
  description: 'X-81: Deterministic over-weighted vs browser for duplicate CSS rules',
  edits: [
    { file: 'server.js', search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }", replace: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }\n    body { color: #555; }" },
  ],
  predicates: [
    { type: 'css', selector: 'body', property: 'color', expected: '#555' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'weighting-bug', 'deterministic-bias', 'X-81'],
  rationale: 'Duplicate body rules — deterministic must pick the cascade winner (#555), not first occurrence (#333)',
});

scenarios.push({
  id: nextId('x81'),
  description: 'X-81: Vision incorrectly overrides deterministic for whitespace in text',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>Demo  App</h1>' },
  ],
  predicates: [
    { type: 'html', selector: 'h1', content: 'Demo App', path: '/' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'weighting-bug', 'whitespace', 'X-81'],
  rationale: 'Double space renders as single — deterministic fails (content mismatch), browser/vision pass (identical render)',
});

scenarios.push({
  id: nextId('x81'),
  description: 'X-81: Absent authority (no vision) should not bias verdict as half-pass',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #777; font-size: 1rem; }' },
  ],
  predicates: [
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#777' },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'weighting-bug', 'absent-authority', 'X-81'],
  rationale: 'If vision authority is absent (no screenshot) and weighted as 0.5, it incorrectly biases final verdict',
});

// ============================================================================
// X-82: Attestation string omits failed gate detail
// ============================================================================

scenarios.push({
  id: nextId('x82'),
  description: 'X-82: Attestation must identify which specific predicate failed, not just gate',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#666' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'attestation-detail', 'X-82'],
  rationale: 'Attestation must identify that h1 color predicate failed, not just "CSS gate failed"',
});

scenarios.push({
  id: nextId('x82'),
  description: 'X-82: Multiple gates fail but attestation only reports the first',
  edits: [
    { file: 'server.js', search: "res.end('Not Found');", replace: 'res.end(SYNTAX_ERROR;' },
  ],
  predicates: [
    { type: 'css', selector: '.nonexistent', property: 'color', expected: 'red' },
    { type: 'content', file: 'server.js', pattern: 'SYNTAX_ERROR' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'attestation-detail', 'multi-gate-fail', 'X-82'],
  rationale: 'Both grounding (fabricated selector) and content (syntax error in code) fail — attestation must report both',
});

scenarios.push({
  id: nextId('x82'),
  description: 'X-82: Attestation omits actual vs expected values on CSS mismatch',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'font-size', expected: '3rem' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'attestation-detail', 'actual-vs-expected', 'X-82'],
  rationale: 'Attestation should include "actual: 2rem, expected: 3rem" not just "font-size failed"',
});

// ============================================================================
// X-83: Telemetry timing includes queue wait
// ============================================================================

scenarios.push({
  id: nextId('x83'),
  description: 'X-83: Gate timing should measure validation only, not file I/O latency',
  edits: [
    { file: 'server.js', search: 'const PORT = process.env.PORT || 3000;', replace: 'const PORT = process.env.PORT || 3000;\n// timing-marker-x83' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'timing-marker-x83' },
  ],
  expectedSuccess: true,
  tags: ['receipt', 'telemetry-timing', 'io-wait', 'X-83'],
  rationale: 'Gate durationMs should measure validation logic only, not include file read latency or queue wait',
});

scenarios.push({
  id: nextId('x83'),
  description: 'X-83: Total pipeline timing double-counts overlapping gate phases',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
  ],
  expectedSuccess: true,
  tags: ['receipt', 'telemetry-timing', 'double-count', 'X-83'],
  rationale: 'If gates overlap, totalDurationMs should be wall-clock time, not sum of individual gate durations',
});

scenarios.push({
  id: nextId('x83'),
  description: 'X-83: Edit application time counted as gate time — inflates F9 duration',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>X-83 timing test footer</footer>' },
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
    { file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true', replace: 'is_active BOOLEAN DEFAULT true -- timing note' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'X-83 timing test' },
  ],
  expectedSuccess: true,
  tags: ['receipt', 'telemetry-timing', 'edit-application', 'X-83'],
  rationale: 'Multi-file edit application time should not be counted as part of F9 gate duration',
});

// ============================================================================
// X-84: Receipt hash chain broken by out-of-order append
// ============================================================================

scenarios.push({
  id: nextId('x84'),
  description: 'X-84: Concurrent submissions may append receipts out of order',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Receipt chain test A</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Receipt chain test A' },
  ],
  expectedSuccess: true,
  tags: ['receipt', 'hash-chain', 'ordering', 'X-84'],
  rationale: 'If two submissions complete simultaneously, receipt append order must match hash chain order',
});

scenarios.push({
  id: nextId('x84'),
  description: 'X-84: Failed submission receipt inserted between success receipts',
  edits: [],
  predicates: [
    { type: 'css', selector: '.ghost-receipt', property: 'color', expected: 'red' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'hash-chain', 'failure-interleave', 'X-84'],
  rationale: 'Failed submission receipt must not break hash chain — previousHash must reference last appended receipt',
});

scenarios.push({
  id: nextId('x84'),
  description: 'X-84: Receipt from rollback appended after success receipt — chain integrity',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #999; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'hash-chain', 'rollback-append', 'X-84'],
  rationale: 'Rollback generates a receipt after verification failure — must chain correctly after the failure receipt',
});

// ============================================================================
// X-85: Checkpoint created despite gate failure
// ============================================================================

scenarios.push({
  id: nextId('x85'),
  description: 'X-85: Grounding fails — no checkpoint should be created',
  edits: [],
  predicates: [
    { type: 'css', selector: '.fabricated-class-x85', property: 'color', expected: 'red' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'checkpoint-leak', 'grounding-fail', 'X-85'],
  rationale: 'No checkpoint should exist when grounding rejects all predicates — gate failure prevents checkpoint',
});

scenarios.push({
  id: nextId('x85'),
  description: 'X-85: Edit application fails — no checkpoint for unapplied changes',
  edits: [
    { file: 'server.js', search: 'THIS_STRING_DOES_NOT_EXIST_IN_FILE_X85', replace: 'replacement' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'replacement' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'checkpoint-leak', 'edit-fail', 'X-85'],
  rationale: 'Edit application fails (search not found) — no checkpoint should be created for unapplied changes',
});

scenarios.push({
  id: nextId('x85'),
  description: 'X-85: Verification fails — checkpoint must not be created before rollback',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #999; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'checkpoint-leak', 'verification-fail', 'X-85'],
  rationale: 'Verification fails (color is #999 not #ff0000) — checkpoint must not be created before rollback completes',
});

// ============================================================================
// X-86: Predicate valid at extraction, stale at verification
// ============================================================================

scenarios.push({
  id: nextId('x86'),
  description: 'X-86: Selector exists at extraction but edit removes the CSS rule',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '/* subtitle rule removed */' },
  ],
  predicates: [
    { type: 'css', selector: '.subtitle', property: 'color', expected: '#666' },
  ],
  expectedSuccess: false,
  tags: ['predicate-lifecycle', 'stale-at-verification', 'X-86'],
  rationale: 'Predicate was valid when extracted (selector existed) but edit removed it — stale by verification time',
});

scenarios.push({
  id: nextId('x86'),
  description: 'X-86: HTTP route exists at extraction but edit renames URL',
  edits: [
    { file: 'server.js', search: "if (req.url === '/api/items') {", replace: "if (req.url === '/api/v2/items') {" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['predicate-lifecycle', 'stale-at-verification', 'route-moved', 'X-86'],
  rationale: 'Predicate targets /api/items but edit moved route to /api/v2/items — predicate is stale',
});

scenarios.push({
  id: nextId('x86'),
  description: 'X-86: HTML element exists at extraction but edit removes it',
  edits: [
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<!-- subtitle removed -->' },
  ],
  predicates: [
    { type: 'html', selector: '.subtitle', expected: 'exists', path: '/' },
  ],
  expectedSuccess: false,
  tags: ['predicate-lifecycle', 'stale-at-verification', 'html-removed', 'X-86'],
  rationale: 'Element .subtitle existed at extraction time but edit replaced it with comment — stale predicate',
});

// ============================================================================
// X-87: Predicate passes all gates but describes wrong thing
// ============================================================================

scenarios.push({
  id: nextId('x87'),
  description: 'X-87: Predicate checks h1 color but goal was about font-size change',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 3rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'wrong-property', 'X-87'],
  rationale: 'Color predicate passes (unchanged) but real change was font-size — vacuously correct but misaligned',
});

scenarios.push({
  id: nextId('x87'),
  description: 'X-87: Content predicate matches boilerplate, not the intended change',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<footer>Powered by Sovereign</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'const http' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'wrong-target', 'X-87'],
  rationale: 'Predicate matches boilerplate "const http" which was never the change target — passes but describes nothing',
});

scenarios.push({
  id: nextId('x87'),
  description: 'X-87: DB predicate checks untouched table while edit targets a different table',
  edits: [
    { file: 'init.sql', search: 'view_count INTEGER DEFAULT 0', replace: 'view_count INTEGER DEFAULT 0,\n    likes INTEGER DEFAULT 0' },
  ],
  predicates: [
    { type: 'db', table: 'users', column: 'email', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'wrong-table', 'X-87'],
  rationale: 'Predicate checks users.email (untouched) while edit adds posts.likes — correct but irrelevant',
});

// ============================================================================
// X-88: Deferred predicate never actually validated
// ============================================================================

scenarios.push({
  id: nextId('x88'),
  description: 'X-88: DB predicate deferred at goal gate — never validated without live DB',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', column: 'username', assertion: 'column_exists' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'deferred-never-validated', 'X-88'],
  rationale: 'DB predicate is deferred (no live DB) — if post-deploy validation is skipped, predicate is never checked',
});

scenarios.push({
  id: nextId('x88'),
  description: 'X-88: HTTP predicate advisory in staging, deferred to O.5b which may be skipped',
  edits: [
    { file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ status: 'ok', version: 2 }));" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'version' } },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'deferred-never-validated', 'http-advisory', 'X-88'],
  rationale: 'HTTP predicate is advisory in staging and deferred to O.5b — if O.5b skipped, predicate never enforced',
});

scenarios.push({
  id: nextId('x88'),
  description: 'X-88: Unsupported predicate type has no validator — perpetually deferred',
  edits: [],
  predicates: [
    { type: 'security' as any, check: 'csrf', target: '/form', assertion: 'token_present' },
  ],
  expectedSuccess: false,
  tags: ['predicate-lifecycle', 'deferred-never-validated', 'no-validator', 'X-88'],
  rationale: 'Security predicate type has no gate validator — deferred indefinitely and never actually validated',
});

// ============================================================================
// X-89: Predicate fingerprint changes across pipeline stages
// ============================================================================

scenarios.push({
  id: nextId('x89'),
  description: 'X-89: Pipeline enrichment adds path field — fingerprint drifts from extraction to K5',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'fingerprint-drift', 'enrichment', 'X-89'],
  rationale: 'If pipeline adds a path field, fingerprint changes from extraction to K5 check — constraint matching breaks',
});

scenarios.push({
  id: nextId('x89'),
  description: 'X-89: Grounding populates currentValue — fingerprint drift if included',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #ff0000; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'fingerprint-drift', 'current-value', 'X-89'],
  rationale: 'Grounding adds currentValue="#1a1a2e" — if fingerprint includes currentValue, it drifts from original',
});

scenarios.push({
  id: nextId('x89'),
  description: 'X-89: Bounding re-indexes predicate IDs — fingerprint drift if ID included',
  edits: [],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
    { type: 'css', selector: '.nonexistent-x89', property: 'color', expected: 'red' },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['predicate-lifecycle', 'fingerprint-drift', 'id-reindex', 'X-89'],
  rationale: 'After bounding removes .nonexistent-x89, remaining predicates get new IDs — K5 ban matching breaks if fingerprint uses ID',
});

// ============================================================================
// Additional scenarios to broaden coverage (4th+ per shape)
// ============================================================================

// X-05 extra: numeric vs string representation
scenarios.push({
  id: nextId('x05'),
  description: 'X-05: Numeric expected value serialized as number vs string — fingerprint divergence',
  edits: [],
  predicates: [
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200 } },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'serialization', 'numeric-coercion', 'X-05'],
  rationale: 'Status 200 as number vs "200" as string may produce different fingerprints after round-trip',
});

// X-06 extra: RTL script
scenarios.push({
  id: nextId('x06'),
  description: 'X-06: CSS selector with Arabic characters in class name',
  edits: [
    { file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.subtitle { color: #666; font-size: 1rem; }\n    .\u0645\u0646\u0648 { color: green; }' },
  ],
  predicates: [
    { type: 'css', selector: '.\u0645\u0646\u0648', property: 'color', expected: 'green' },
  ],
  expectedSuccess: true,
  tags: ['fingerprint', 'unicode', 'rtl', 'X-06'],
  rationale: 'RTL Arabic script in class names must not break fingerprint hashing or directional assumptions',
});

// X-22 extra: gate returns undefined vs null
scenarios.push({
  id: nextId('x22'),
  description: 'X-22: Performance predicate type — no validator exists, status ambiguous',
  edits: [],
  predicates: [
    { type: 'performance' as any, metric: 'lcp', threshold: 2500 },
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'no-validator', 'X-22'],
  rationale: 'Performance predicate has no validator — is the gate absent, disabled, or skipped? Three states confused',
});

// X-57 extra: edit application order
scenarios.push({
  id: nextId('x57'),
  description: 'X-57: Edit application order affects which CSS rule is "last" for cascade',
  edits: [
    { file: 'server.js', search: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }', replace: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }\n    footer { color: blue; }' },
  ],
  predicates: [
    { type: 'css', selector: 'footer', property: 'color', expected: 'blue' },
  ],
  expectedSuccess: true,
  tags: ['gate-sequencing', 'edit-order', 'cascade', 'X-57'],
  rationale: 'If edits are applied in non-deterministic order, the CSS cascade winner may differ from expectation',
});

// X-59 extra: mixed success/fail across types
scenarios.push({
  id: nextId('x59'),
  description: 'X-59: HTML passes, CSS passes, but HTTP fails — partial failure in mixed set',
  edits: [],
  predicates: [
    { type: 'html', selector: 'h1', expected: 'exists', path: '/' },
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
    { type: 'http', method: 'GET', path: '/nonexistent', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['gate-sequencing', 'partial-failure', 'mixed-types', 'X-59'],
  rationale: 'HTTP predicate on non-existent route fails while CSS+HTML pass — HTTP failure must survive in result',
});

// X-28 extra: server.js + init.sql multi-file
scenarios.push({
  id: nextId('x28'),
  description: 'X-28: Four files edited — predicate covers two, two unexplained',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>Updated App</h1>' },
    { file: 'config.json', search: '"name": "Demo App"', replace: '"name": "Updated App"' },
    { file: 'init.sql', search: 'is_active BOOLEAN DEFAULT true', replace: 'is_active BOOLEAN DEFAULT true -- touched' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'html', selector: 'h1', content: 'Updated App', path: '/' },
    { type: 'content', file: 'config.json', pattern: '"name": "Updated App"' },
  ],
  expectedSuccess: true,
  tags: ['containment', 'multi-file', 'partial-attribution', 'X-28'],
  rationale: 'server.js and config.json edits explained; init.sql and .env edits unexplained — G5 flags two',
});

// X-61 extra: property added by edit
scenarios.push({
  id: nextId('x61'),
  description: 'X-61: New CSS property added by edit — grounding pre-edit has no baseline',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 2rem; text-shadow: 1px 1px black; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'text-shadow', expected: '1px 1px black' },
  ],
  expectedSuccess: true,
  tags: ['grounding', 'stale-snapshot', 'new-property', 'X-61'],
  rationale: 'text-shadow property did not exist pre-edit — grounding has no baseline, but verification should find it post-edit',
});

// X-62 extra: CSS in noscript
scenarios.push({
  id: nextId('x62'),
  description: 'X-62: CSS class inside <noscript> tag — not reachable with JS enabled',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<noscript><div class="no-js-fallback">Enable JS</div></noscript>\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [
    { type: 'html', selector: '.no-js-fallback', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['grounding', 'over-approximation', 'noscript', 'X-62'],
  rationale: 'Element inside <noscript> only renders with JS disabled — grounding may over-approximate its reachability',
});

// X-72 extra: global state mutation
scenarios.push({
  id: nextId('x72'),
  description: 'X-72: Hint to hardcode response data fixes test but breaks dynamic behavior',
  edits: [
    { file: 'server.js', search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));", replace: "res.end('[{\"id\":1,\"name\":\"Alpha\"},{\"id\":2,\"name\":\"Beta\"}]');" },
  ],
  predicates: [
    { type: 'http', method: 'GET', path: '/api/items', expect: { status: 200, bodyContains: 'Alpha' } },
  ],
  expectedSuccess: true,
  tags: ['narrowing', 'locally-correct', 'hardcoded-data', 'X-72'],
  rationale: 'Hardcoded JSON string fixes the test but prevents future dynamic data from ever being served',
});

// X-75 extra: ordering sensitivity
scenarios.push({
  id: nextId('x75'),
  description: 'X-75: Four predicates fail — narrowing should not just pick the first',
  edits: [
    { file: 'server.js', search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }", replace: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; display: none; }" },
  ],
  predicates: [
    { type: 'css', selector: 'body', property: 'display', expected: 'block' },
    { type: 'html', selector: 'h1', expected: 'exists', path: '/' },
    { type: 'content', file: 'server.js', pattern: 'display: none' },
    { type: 'http', method: 'GET', path: '/', expect: { status: 200, bodyContains: 'Demo App' } },
  ],
  expectedSuccess: false,
  tags: ['narrowing', 'wrong-target', 'ordering', 'X-75'],
  rationale: 'display:none is the root cause affecting everything — narrowing should identify it, not the downstream HTML/HTTP failures',
});

// X-76 extra: font loading delay
scenarios.push({
  id: nextId('x76'),
  description: 'X-76: Web font not loaded at screenshot time — FOUT affects text metrics',
  edits: [
    { file: 'server.js', search: "body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }", replace: "body { font-family: 'Custom Font', sans-serif; margin: 2rem; background: #ffffff; color: #333; }" },
  ],
  predicates: [
    { type: 'css', selector: 'body', property: 'font-family', expected: "'Custom Font', sans-serif" },
  ],
  expectedSuccess: true,
  tags: ['triangulation', 'render-settle', 'font-loading', 'X-76'],
  rationale: 'Custom font may not be loaded at screenshot time — FOUT means fallback font appears instead',
});

// X-82 extra: empty attestation on edge case
scenarios.push({
  id: nextId('x82'),
  description: 'X-82: All predicates pass but one has warning-level issue — attestation omits warning',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#1a1a2e' },
    { type: 'db', table: 'users', assertion: 'table_exists' },
  ],
  expectedSuccess: true,
  tags: ['receipt', 'attestation-detail', 'deferred-warning', 'X-82'],
  rationale: 'CSS passes, DB is deferred — attestation should note the deferred DB predicate, not silently omit it',
});

// X-85 extra: partial edit success
scenarios.push({
  id: nextId('x85'),
  description: 'X-85: First edit succeeds, second edit fails — checkpoint must not capture partial state',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>Partial App</h1>' },
    { file: 'server.js', search: 'THIS_DOES_NOT_EXIST_X85_PARTIAL', replace: 'should fail' },
  ],
  predicates: [
    { type: 'html', selector: 'h1', content: 'Partial App', path: '/' },
  ],
  expectedSuccess: false,
  tags: ['receipt', 'checkpoint-leak', 'partial-edit', 'X-85'],
  rationale: 'First edit applied but second fails — no checkpoint should capture the partial/inconsistent state',
});

// X-88 extra: chained deferred predicates
scenarios.push({
  id: nextId('x88'),
  description: 'X-88: Multiple deferred predicates — all deferred, none validated, overall passes',
  edits: [],
  predicates: [
    { type: 'db', table: 'users', assertion: 'table_exists' },
    { type: 'db', table: 'posts', column: 'title', assertion: 'column_exists' },
    { type: 'db', table: 'sessions', assertion: 'table_exists' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'deferred-never-validated', 'all-deferred', 'X-88'],
  rationale: 'When all predicates are deferred (no live DB), the entire verification is vacuous — passes with zero actual checks',
});

// X-89 extra: predicate mutation during pipeline
scenarios.push({
  id: nextId('x89'),
  description: 'X-89: Predicate expected value normalized during pipeline (hex case)',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #FF0000; font-size: 2rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#ff0000' },
  ],
  expectedSuccess: true,
  tags: ['predicate-lifecycle', 'fingerprint-drift', 'hex-normalization', 'X-89'],
  rationale: 'Source has #FF0000 (uppercase), predicate has #ff0000 (lowercase) — normalization during pipeline changes fingerprint',
});

// ============================================================================
// Write output
// ============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);

// Summary by shape
const shapeCounts = new Map<string, number>();
for (const s of scenarios) {
  for (const tag of s.tags) {
    if (/^X-\d+$/.test(tag)) {
      shapeCounts.set(tag, (shapeCounts.get(tag) || 0) + 1);
    }
  }
}
const sorted = [...shapeCounts.entries()].sort((a, b) => {
  const na = parseInt(a[0].replace('X-', ''));
  const nb = parseInt(b[0].replace('X-', ''));
  return na - nb;
});
console.log('\nPer-shape breakdown:');
for (const [shape, count] of sorted) {
  console.log(`  ${shape}: ${count} scenarios`);
}
console.log(`\nTotal shapes covered: ${shapeCounts.size}`);
