#!/usr/bin/env bun
/**
 * Capacity x Browser scenario generator
 * Grid cell: I×3
 * Shapes: IB-01 (DOM node count exceeds limit), IB-02 (localStorage quota exceeded), IB-03 (CSS rule limit exceeded)
 *
 * These scenarios test whether verify detects capacity exhaustion in the browser
 * layer — edits that produce structurally valid HTML/CSS/JS but exceed browser
 * resource limits (DOM node budgets, storage quotas, CSS rule counts).
 *
 * Run: bun scripts/harvest/stage-capacity-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `ib-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape IB-01: DOM node count exceeds limit
// Edit generates enormous numbers of DOM elements. Content predicates find
// the target text but the browser would struggle or refuse to render the page.
// =============================================================================

// IB-01a: 500 list items injected into homepage
scenarios.push({
  id: nextId('dom'),
  description: 'IB-01: Edit adds 500 <li> elements to items list, predicate checks last item',
  edits: [{
    file: 'server.js',
    search: '    <li>Item Alpha</li>\n    <li>Item Beta</li>',
    replace: Array.from({ length: 500 }, (_, i) => `    <li>Item ${i}</li>`).join('\n'),
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item 499' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'dom_limit', 'IB-01'],
  rationale: 'Content present but 500 DOM nodes in a single list degrades render performance',
});

// IB-01b: 200 nested div elements (DOM depth)
scenarios.push({
  id: nextId('dom'),
  description: 'IB-01: Edit creates 200-level nested div structure, predicate checks innermost',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: Array.from({ length: 200 }, (_, i) => `<div class="nest-${i}">`).join('') + '<span>Deepest</span>' + '</div>'.repeat(200) + '\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Deepest' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'dom_limit', 'IB-01'],
  rationale: '200-level nesting exceeds browser DOM depth recommendations — layout and style recalc blows up',
});

// IB-01c: 1000 table rows in data table
scenarios.push({
  id: nextId('dom'),
  description: 'IB-01: Edit injects 1000 rows into data-table, predicate checks row 999',
  edits: [{
    file: 'server.js',
    search: '      <tr><td>Alice</td><td>Lead</td></tr>\n      <tr><td>Bob</td><td>Backend</td></tr>',
    replace: Array.from({ length: 1000 }, (_, i) => `      <tr><td>User${i}</td><td>Role${i}</td></tr>`).join('\n'),
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'User999' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'dom_limit', 'IB-01'],
  rationale: '1000 table rows — content exists but table rendering becomes a performance bottleneck',
});

// IB-01d: Massive SVG with 300 elements
scenarios.push({
  id: nextId('dom'),
  description: 'IB-01: Edit adds inline SVG with 300 circles, predicate checks SVG exists',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<svg width="600" height="600">' + Array.from({ length: 300 }, (_, i) => `<circle cx="${i % 30 * 20}" cy="${Math.floor(i / 30) * 60}" r="8" fill="#${String(i * 55555).slice(0, 6)}" />`).join('') + '</svg>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'html', selector: 'svg', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'dom_limit', 'IB-01'],
  rationale: 'SVG with 300 elements — valid markup but headless browser render budget exceeded',
});

// IB-01e: Control — small DOM update
scenarios.push({
  id: nextId('dom'),
  description: 'IB-01 control: Add single list item (no capacity issue)',
  edits: [{
    file: 'server.js',
    search: '    <li>Item Beta</li>',
    replace: '    <li>Item Beta</li>\n    <li>Item Gamma</li>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Gamma' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'dom_limit', 'IB-01', 'control'],
  rationale: 'Single new item — well within DOM limits',
});

// =============================================================================
// Shape IB-02: localStorage quota exceeded
// Edit adds JavaScript that writes large amounts of data to localStorage.
// The predicate checks the script exists but at runtime the quota is hit.
// =============================================================================

// IB-02a: Script writes 10MB to localStorage
scenarios.push({
  id: nextId('storage'),
  description: 'IB-02: Script writes 10MB string to localStorage, predicate checks script exists',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>try { localStorage.setItem("bigData", "x".repeat(10 * 1024 * 1024)); } catch(e) { console.error("Quota exceeded"); }</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'localStorage.setItem("bigData"' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'storage_quota', 'IB-02'],
  rationale: 'Script exists but 10MB exceeds typical 5MB localStorage quota — QuotaExceededError at runtime',
});

// IB-02b: Script fills localStorage with many small keys
scenarios.push({
  id: nextId('storage'),
  description: 'IB-02: Script creates 10000 localStorage keys, predicate checks script',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>for(let i=0;i<10000;i++){localStorage.setItem("key"+i,"val".repeat(100))}</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'localStorage.setItem("key"+i' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'storage_quota', 'IB-02'],
  rationale: '10000 keys x 300 bytes each = ~3MB before overhead — nears quota limit',
});

// IB-02c: Script writes to sessionStorage and localStorage both
scenarios.push({
  id: nextId('storage'),
  description: 'IB-02: Script fills both sessionStorage and localStorage, predicate checks both calls',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>sessionStorage.setItem("s","y".repeat(5*1024*1024));localStorage.setItem("l","z".repeat(5*1024*1024));</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'sessionStorage.setItem' },
    { type: 'content', file: 'server.js', pattern: 'localStorage.setItem("l"' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'storage_quota', 'IB-02'],
  rationale: 'Both storage APIs hit at 5MB each — combined quota likely exceeded',
});

// IB-02d: IndexedDB large write without quota check
scenarios.push({
  id: nextId('storage'),
  description: 'IB-02: Script writes large blob to IndexedDB, no quota check',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>const r=indexedDB.open("big",1);r.onupgradeneeded=e=>{const db=e.target.result;const s=db.createObjectStore("data");s.put(new Blob(["x".repeat(50*1024*1024)]),"huge");};</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'indexedDB.open("big"' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'storage_quota', 'IB-02'],
  rationale: '50MB Blob to IndexedDB — exceeds typical ephemeral storage quota in headless browsers',
});

// IB-02e: Control — small localStorage write
scenarios.push({
  id: nextId('storage'),
  description: 'IB-02 control: Script writes small value to localStorage',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>localStorage.setItem("theme","dark")</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'localStorage.setItem("theme"' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'storage_quota', 'IB-02', 'control'],
  rationale: 'Tiny localStorage write — well within any quota',
});

// =============================================================================
// Shape IB-03: CSS rule limit exceeded
// Edit adds enormous numbers of CSS rules. Browser engines have practical limits
// on rule count and selector complexity. Predicates check specific rules but
// the browser may drop or ignore later rules.
// =============================================================================

// IB-03a: 5000 CSS rules injected
scenarios.push({
  id: nextId('css'),
  description: 'IB-03: Edit adds 5000 CSS rules to homepage, predicate checks rule 4999',
  edits: [{
    file: 'server.js',
    search: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }',
    replace: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }\n' + Array.from({ length: 5000 }, (_, i) => `    .auto-rule-${i} { color: #${String(i * 33).padStart(6, '0').slice(0, 6)}; }`).join('\n'),
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.auto-rule-4999' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'css_limit', 'IB-03'],
  rationale: '5000 CSS rules — content exists but browsers may hit stylesheet parsing limits',
});

// IB-03b: Deeply nested CSS selectors
scenarios.push({
  id: nextId('css'),
  description: 'IB-03: Edit adds 30-level nested CSS selectors, predicate checks deepest',
  edits: [{
    file: 'server.js',
    search: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }',
    replace: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }\n    ' + Array.from({ length: 30 }, (_, i) => `.level-${i}`).join(' > ') + ' { color: red; }',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.level-29' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'css_limit', 'IB-03'],
  rationale: '30-level nested selector — browsers may refuse to match due to selector complexity limits',
});

// IB-03c: Multiple @import chains (style sheet limit)
scenarios.push({
  id: nextId('css'),
  description: 'IB-03: Edit adds 40 @import rules, predicate checks last import',
  edits: [{
    file: 'server.js',
    search: '  <style>',
    replace: '  <style>\n' + Array.from({ length: 40 }, (_, i) => `    @import url("style-${i}.css");`).join('\n'),
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@import url("style-39.css")' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'css_limit', 'IB-03'],
  rationale: '40 @import rules — browsers limit stylesheet depth and @import chains',
});

// IB-03d: CSS custom properties explosion
scenarios.push({
  id: nextId('css'),
  description: 'IB-03: Edit adds 2000 CSS custom properties, predicate checks last one',
  edits: [{
    file: 'server.js',
    search: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }',
    replace: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }\n    :root {\n' + Array.from({ length: 2000 }, (_, i) => `      --var-${i}: #${String(i * 77).padStart(6, '0').slice(0, 6)};`).join('\n') + '\n    }',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '--var-1999' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'css_limit', 'IB-03'],
  rationale: '2000 custom properties on :root — parsing overhead, possible CSSOM limit',
});

// IB-03e: Control — few CSS rules added
scenarios.push({
  id: nextId('css'),
  description: 'IB-03 control: Edit adds 3 CSS rules (well within limits)',
  edits: [{
    file: 'server.js',
    search: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }',
    replace: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }\n    .accent { color: coral; }\n    .muted { color: #888; }\n    .bold { font-weight: 700; }',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.accent { color: coral; }' }],
  expectedSuccess: true,
  tags: ['capacity', 'browser', 'css_limit', 'IB-03', 'control'],
  rationale: '3 new CSS rules — far below any browser limit',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-browser scenarios -> ${outPath}`);
