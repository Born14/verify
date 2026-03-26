#!/usr/bin/env bun
/**
 * Propagation × Browser scenario generator
 * Grid cell: E×3
 * Shapes: PB-01 (CSS class renamed but JS uses old name),
 *         PB-02 (HTML structure changed but event listeners bound to old selectors),
 *         PB-03 (API response changed but frontend renders stale state)
 *
 * Propagation scenarios test whether verify detects when an upstream change
 * doesn't cascade to downstream browser consumers. CSS↔JS coupling is a
 * common agent blind spot.
 *
 * Browser scenarios require Playwright → requiresPlaywright: true (--full tier).
 * Pure-tier scenarios test cross-surface structural propagation without browser.
 *
 * Run: bun scripts/harvest/stage-propagation-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pb-${prefix}-${String(++counter).padStart(3, '0')}`;
}

const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');

// =============================================================================
// Shape PB-01: CSS class renamed but JS/HTML still uses old name
// Edit a CSS class name in the <style> block but the HTML elements still
// reference the old class. The browser won't apply the renamed styles.
// =============================================================================

// PB-01a: Rename .nav-link to .menu-link in homepage CSS, HTML still has class="nav-link"
scenarios.push({
  id: nextId('cssjs'),
  description: 'PB-01: Rename .nav-link to .menu-link in CSS, HTML still uses class="nav-link"',
  edits: [{ file: 'server.js', search: 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }', replace: 'a.menu-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }' }],
  predicates: [{ type: 'css', selector: 'a.nav-link', property: 'color', expected: 'rgb(0, 102, 204)', path: '/' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'css_js_coupling', 'PB-01'],
  rationale: 'CSS class renamed but HTML elements still use old class — style won\'t apply via renamed selector',
});

// PB-01b: Rename .subtitle to .tagline in CSS, HTML still has class="subtitle"
scenarios.push({
  id: nextId('cssjs'),
  description: 'PB-01: Rename .subtitle to .tagline in CSS, HTML still uses class="subtitle"',
  edits: [{ file: 'server.js', search: '.subtitle { color: #666; font-size: 1rem; }', replace: '.tagline { color: #666; font-size: 1rem; }' }],
  predicates: [{ type: 'css', selector: '.subtitle', property: 'color', expected: 'rgb(102, 102, 102)', path: '/' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'css_js_coupling', 'PB-01'],
  rationale: 'CSS class renamed from .subtitle to .tagline — HTML element still has old class, style lost',
});

// PB-01c: Rename .hero to .banner on /about page CSS, HTML still has class="hero"
scenarios.push({
  id: nextId('cssjs'),
  description: 'PB-01: Rename .hero to .banner in /about CSS, HTML still has class="hero"',
  edits: [{ file: 'server.js', search: '.hero { background: #3498db;', replace: '.banner { background: #3498db;' }],
  predicates: [{ type: 'css', selector: '.hero', property: 'background-color', expected: 'rgb(52, 152, 219)', path: '/about' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'css_js_coupling', 'PB-01'],
  rationale: 'CSS class .hero renamed to .banner — HTML div still has class="hero", background lost',
});

// PB-01d: Pure-tier — rename CSS class, check HTML still has old class
scenarios.push({
  id: nextId('cssjs'),
  description: 'PB-01 pure: Rename .items to .listing in CSS, HTML still has class="items"',
  edits: [{ file: 'server.js', search: '.items { list-style: none; padding: 0; }', replace: '.listing { list-style: none; padding: 0; }' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'class="listing"' }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'css_js_coupling', 'PB-01', 'pure'],
  rationale: 'CSS class renamed but HTML class attribute not updated — structural propagation gap',
});

// PB-01e: Pure-tier — rename CSS class, check old class reference is gone
scenarios.push({
  id: nextId('cssjs'),
  description: 'PB-01 pure: Rename .edge-hero to .page-hero in CSS, check old CSS rule gone',
  edits: [{ file: 'server.js', search: '.edge-hero { color: #2c3e50;', replace: '.page-hero { color: #2c3e50;' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.edge-hero {' }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'css_js_coupling', 'PB-01', 'pure'],
  rationale: 'CSS rule renamed — old class rule no longer present in source',
});

// =============================================================================
// Shape PB-02: HTML structure changed but selectors/event listeners use old selectors
// Edit HTML element structure (tag, id, nesting) but CSS/JS selectors
// still target the old structure.
// =============================================================================

// PB-02a: Change <h1> to <h2> on homepage, CSS still targets h1
scenarios.push({
  id: nextId('htmlsel'),
  description: 'PB-02: Change homepage h1 to h2, CSS still targets h1',
  edits: [{ file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h2>Demo App</h2>' }],
  predicates: [{ type: 'html', selector: 'h1', assertion: 'exists', path: '/' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'html_selector', 'PB-02'],
  rationale: 'HTML tag changed from h1 to h2 — CSS/selector targeting h1 finds nothing',
});

// PB-02b: Remove nav from homepage, CSS nav-link styles still defined
scenarios.push({
  id: nextId('htmlsel'),
  description: 'PB-02: Remove nav element from homepage, a.nav-link CSS still exists',
  edits: [{
    file: 'server.js',
    search: `  <nav>\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/api/items">API</a>\n  </nav>`,
    replace: '  <!-- nav removed -->',
  }],
  predicates: [{ type: 'html', selector: 'a.nav-link', assertion: 'exists', path: '/' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'html_selector', 'PB-02'],
  rationale: 'Nav element removed but CSS rules for .nav-link still defined — orphaned styles',
});

// PB-02c: Change footer tag to div, CSS footer selector no longer matches
scenarios.push({
  id: nextId('htmlsel'),
  description: 'PB-02: Change homepage <footer> to <div>, CSS footer style orphaned',
  edits: [{ file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<div class="bottom">Powered by Node.js</div>' }],
  predicates: [{ type: 'html', selector: 'footer', assertion: 'exists', path: '/' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['propagation', 'browser', 'html_selector', 'PB-02'],
  rationale: 'Footer tag replaced with div — CSS footer selector no longer matches any element',
});

// PB-02d: Change form action to different endpoint, form page still exists
scenarios.push({
  id: nextId('htmlsel'),
  description: 'PB-02: Change form action to /api/submit, server still has /api/echo handler',
  edits: [{ file: 'server.js', search: 'action="/api/echo"', replace: 'action="/api/submit"' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "req.url === '/api/submit'" }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'html_selector', 'PB-02', 'pure'],
  rationale: 'Form action changed but no matching route handler — HTML→API propagation gap',
});

// PB-02e: Pure-tier — remove a table from /about page, check CSS still references it
scenarios.push({
  id: nextId('htmlsel'),
  description: 'PB-02 pure: Remove data-table from /about, CSS .data-table still exists',
  edits: [{
    file: 'server.js',
    search: `  <table class="data-table">\n    <thead><tr><th>Name</th><th>Role</th></tr></thead>\n    <tbody>\n      <tr><td>Alice</td><td>Lead</td></tr>\n      <tr><td>Bob</td><td>Backend</td></tr>\n    </tbody>\n  </table>`,
    replace: '  <!-- data table removed -->',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'class="data-table"' }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'html_selector', 'PB-02', 'pure'],
  rationale: 'HTML table removed — class reference gone but CSS rules remain orphaned',
});

// =============================================================================
// Shape PB-03: API response changed but frontend renders stale state
// Edit server.js API response, but the HTML template that renders data
// from that API still shows old content.
// =============================================================================

// PB-03a: Change API items, homepage HTML still shows old item names
scenarios.push({
  id: nextId('apifrontend'),
  description: 'PB-03: Rename Alpha to Omega in API, homepage HTML still says "Item Alpha"',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Omega' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Omega' }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'api_state', 'PB-03', 'pure'],
  rationale: 'API data changed to Omega but homepage hardcodes "Item Alpha" — API→UI propagation gap',
});

// PB-03b: Remove item from API, homepage HTML still lists both items
scenarios.push({
  id: nextId('apifrontend'),
  description: 'PB-03: Remove Beta from API response, homepage still has "Item Beta"',
  edits: [{ file: 'server.js', search: "      { id: 2, name: 'Beta' },\n    ]", replace: "    ]" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Beta' }],
  expectedSuccess: true,
  tags: ['propagation', 'browser', 'api_state', 'PB-03', 'pure'],
  rationale: 'API item removed but homepage HTML still hardcodes "Item Beta" — the propagation gap IS the finding (content still present)',
});

// PB-03c: Change health status text, about page still mentions different status
scenarios.push({
  id: nextId('apifrontend'),
  description: 'PB-03: Health endpoint returns "ready", about page still says "ok" nowhere to verify',
  edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ready' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "{ status: 'ok' }" }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'api_state', 'PB-03', 'pure'],
  rationale: 'API status changed — old value no longer in source',
});

// PB-03d: Change title in one page, check another page still has old title
scenarios.push({
  id: nextId('apifrontend'),
  description: 'PB-03: Change homepage title to "Main App", about page title unchanged',
  edits: [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Main App</title>' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'About - Main App' }],
  expectedSuccess: false,
  tags: ['propagation', 'browser', 'api_state', 'PB-03', 'pure'],
  rationale: 'Homepage title changed but about page title still uses old "Demo App" prefix — cross-route propagation gap',
});

// PB-03e: Control — edit CSS and check same route for change
scenarios.push({
  id: nextId('apifrontend'),
  description: 'PB-03 control: Change h1 color on homepage, check homepage for new color',
  edits: [{ file: 'server.js', search: 'h1 { color: #1a1a2e;', replace: 'h1 { color: #ff0000;' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'h1 { color: #ff0000;' }],
  expectedSuccess: true,
  tags: ['propagation', 'browser', 'api_state', 'PB-03', 'control'],
  rationale: 'Same-surface edit and check — no propagation needed, should pass',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-browser scenarios → ${outPath}`);
