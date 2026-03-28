#!/usr/bin/env bun
/**
 * Contention x Browser scenario generator
 * Grid cell: J x 3
 * Shapes: JB-01 (two CSS rules target same selector with conflicting values), JB-02 (shared localStorage key between features), JB-03 (concurrent DOM mutations on same element)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent actors
 * at the browser layer. Two CSS rules fighting over the same property, two features
 * sharing a localStorage key, two scripts mutating the same DOM node — all produce
 * visual or functional inconsistency.
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jb-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');

// =============================================================================
// Shape JB-01: Two CSS rules target same selector with conflicting values
// Both edits declare different values for the same CSS property on the same
// selector. The second edit's search string is gone after the first applies.
// =============================================================================

// JB-01a: Two edits both change h1 color on homepage
scenarios.push({
  id: nextId('css'),
  description: 'JB-01: Two edits both change h1 color in homepage CSS to different values',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #ff0000; font-size: 2rem; }' },
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #00ff00; font-size: 2rem; }' },
  ],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: '#00ff00' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01'],
  rationale: 'Both edits target same h1 color — second search string gone after first changes to red',
});

// JB-01b: Two edits both change body background on homepage
scenarios.push({
  id: nextId('css'),
  description: 'JB-01: Two edits both change body background in homepage CSS',
  edits: [
    { file: 'server.js', search: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }', replace: 'body { font-family: sans-serif; margin: 2rem; background: #1a1a2e; color: #333; }' },
    { file: 'server.js', search: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }', replace: 'body { font-family: sans-serif; margin: 2rem; background: #f0f0f0; color: #333; }' },
  ],
  predicates: [{ type: 'css', selector: 'body', property: 'background', expected: '#f0f0f0' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01'],
  rationale: 'Both edits target same body background — second search gone after first changes to navy',
});

// JB-01c: Two edits both change .hero background on about page
scenarios.push({
  id: nextId('css'),
  description: 'JB-01: Two edits both change .hero background color on about page',
  edits: [
    { file: 'server.js', search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }', replace: '.hero { background: #e74c3c; color: white; padding: 2rem; border-radius: 8px; }' },
    { file: 'server.js', search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }', replace: '.hero { background: #2ecc71; color: white; padding: 2rem; border-radius: 8px; }' },
  ],
  predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: '#2ecc71' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01'],
  rationale: 'Both edits change .hero background — second search gone after first applies red background',
});

// JB-01d: Two edits both change nav-link color on homepage
scenarios.push({
  id: nextId('css'),
  description: 'JB-01: Two edits both change a.nav-link color in homepage CSS',
  edits: [
    { file: 'server.js', search: 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }', replace: 'a.nav-link { color: #e74c3c; text-decoration: none; margin-right: 1rem; }' },
    { file: 'server.js', search: 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }', replace: 'a.nav-link { color: #9b59b6; text-decoration: none; margin-right: 1rem; }' },
  ],
  predicates: [{ type: 'css', selector: 'a.nav-link', property: 'color', expected: '#9b59b6' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01'],
  rationale: 'Both edits target same nav-link color — second search gone after first changes to red',
});

// JB-01e: Two edits both change .badge background on about page
scenarios.push({
  id: nextId('css'),
  description: 'JB-01: Two edits both change .badge background on about page',
  edits: [
    { file: 'server.js', search: '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }', replace: '.badge { display: inline-block; background: #3498db; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }' },
    { file: 'server.js', search: '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }', replace: '.badge { display: inline-block; background: #f39c12; color: black; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }' },
  ],
  predicates: [{ type: 'css', selector: '.badge', property: 'background', expected: '#f39c12' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01'],
  rationale: 'Both edits change .badge background — second search gone after first changes to blue',
});

// JB-01f: Control — two edits change CSS on DIFFERENT selectors (no conflict)
scenarios.push({
  id: nextId('css'),
  description: 'JB-01 control: Two edits change different CSS selectors (h1 and footer)',
  edits: [
    { file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #e74c3c; font-size: 2rem; }' },
    { file: 'server.js', search: 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }', replace: 'footer { margin-top: 2rem; color: #333; font-size: 0.8rem; }' },
  ],
  predicates: [
    { type: 'css', selector: 'h1', property: 'color', expected: '#e74c3c' },
    { type: 'css', selector: 'footer', property: 'color', expected: '#333' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'browser', 'css_conflict', 'JB-01', 'control'],
  rationale: 'Different selectors — no CSS conflict, both edits apply cleanly',
});

// =============================================================================
// Shape JB-02: Shared localStorage key between features
// Two edits add script blocks that use the same localStorage key or cookie name,
// creating state collision between features.
// =============================================================================

// JB-02a: Two edits both add script setting localStorage 'theme' with different values
scenarios.push({
  id: nextId('store'),
  description: 'JB-02: Two edits both add script setting localStorage theme to different values',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<script>localStorage.setItem("theme", "dark");</script>\n  <footer>Powered by Node.js</footer>' },
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<script>localStorage.setItem("theme", "light");</script>\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'localStorage.setItem("theme", "light")' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'localstorage_collision', 'JB-02'],
  rationale: 'Both edits insert before same footer — second search gone after first adds dark theme script',
});

// JB-02b: Two edits both add inline script modifying document.title
scenarios.push({
  id: nextId('store'),
  description: 'JB-02: Two edits both add script that sets document.title to different values',
  edits: [
    { file: 'server.js', search: '<title>Demo App</title>\n  <meta name="description"', replace: '<title>Demo App</title>\n  <script>document.title = "Feature A";</script>\n  <meta name="description"' },
    { file: 'server.js', search: '<title>Demo App</title>\n  <meta name="description"', replace: '<title>Demo App</title>\n  <script>document.title = "Feature B";</script>\n  <meta name="description"' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'document.title = "Feature B"' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'localstorage_collision', 'JB-02'],
  rationale: 'Both edits insert after title tag — second search gone after first adds Feature A script',
});

// JB-02c: Two edits both add cookie setting with same cookie name
scenarios.push({
  id: nextId('store'),
  description: 'JB-02: Two edits add script setting same cookie name with different values',
  edits: [
    { file: 'server.js', search: '</body>\n</html>`);', replace: '<script>document.cookie = "prefs=compact; path=/";</script>\n</body>\n</html>`);' },
    { file: 'server.js', search: '</body>\n</html>`);', replace: '<script>document.cookie = "prefs=expanded; path=/";</script>\n</body>\n</html>`);' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'prefs=expanded' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'localstorage_collision', 'JB-02'],
  rationale: 'Both edits insert before </body> in homepage — second search gone after first adds compact cookie',
});

// JB-02d: Two edits both add sessionStorage setting with same key
scenarios.push({
  id: nextId('store'),
  description: 'JB-02: Two edits both set sessionStorage "user_role" at about page footer',
  edits: [
    { file: 'server.js', search: '<footer>About page footer</footer>', replace: '<script>sessionStorage.setItem("user_role", "admin");</script>\n  <footer>About page footer</footer>' },
    { file: 'server.js', search: '<footer>About page footer</footer>', replace: '<script>sessionStorage.setItem("user_role", "viewer");</script>\n  <footer>About page footer</footer>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'sessionStorage.setItem("user_role", "viewer")' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'localstorage_collision', 'JB-02'],
  rationale: 'Both edits insert before about footer — second search gone after first sets admin role',
});

// JB-02e: Control — two edits add different localStorage keys (no collision)
scenarios.push({
  id: nextId('store'),
  description: 'JB-02 control: Two edits add different localStorage keys (no collision)',
  edits: [
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<script>localStorage.setItem("sidebar", "collapsed");</script>\n  <footer>Powered by Node.js</footer>' },
    { file: 'server.js', search: '<footer>About page footer</footer>', replace: '<script>localStorage.setItem("language", "en");</script>\n  <footer>About page footer</footer>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'localStorage.setItem("sidebar", "collapsed")' },
    { type: 'content', file: 'server.js', pattern: 'localStorage.setItem("language", "en")' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'browser', 'localstorage_collision', 'JB-02', 'control'],
  rationale: 'Different keys in different page footers — no storage collision',
});

// =============================================================================
// Shape JB-03: Concurrent DOM mutations on same element
// Two edits modify the same HTML element's attributes or content, producing
// an inconsistent DOM tree.
// =============================================================================

// JB-03a: Two edits both change homepage h1 text content
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03: Two edits both change homepage h1 text to different values',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>Alpha Dashboard</h1>' },
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>Beta Portal</h1>' },
  ],
  predicates: [{ type: 'html', selector: 'h1', expected: 'Beta Portal' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03'],
  rationale: 'Both edits target same h1 — second search gone after first renames to Alpha Dashboard',
});

// JB-03b: Two edits both modify the nav block on homepage
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03: Two edits both restructure homepage nav with different links',
  edits: [
    { file: 'server.js', search: '<a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/api/items">API</a>', replace: '<a class="nav-link" href="/">Dashboard</a>\n    <a class="nav-link" href="/settings">Settings</a>' },
    { file: 'server.js', search: '<a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/api/items">API</a>', replace: '<a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/api/items">API</a>\n    <a class="nav-link" href="/admin">Admin</a>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'href="/admin"' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03'],
  rationale: 'Both edits target same nav links — second search gone after first restructures nav',
});

// JB-03c: Two edits both change the subtitle paragraph on homepage
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03: Two edits both change the .subtitle paragraph text',
  edits: [
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<p class="subtitle">Real-time monitoring dashboard</p>' },
    { file: 'server.js', search: '<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>', replace: '<p class="subtitle">Production deployment manager</p>' },
  ],
  predicates: [{ type: 'html', selector: '.subtitle', expected: 'Production deployment manager' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03'],
  rationale: 'Both edits target same subtitle — second search gone after first changes text',
});

// JB-03d: Two edits both change the hero title on about page
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03: Two edits both change .hero-title text on about page',
  edits: [
    { file: 'server.js', search: '<span class="hero-title">About This App</span>', replace: '<span class="hero-title">Our Mission</span>' },
    { file: 'server.js', search: '<span class="hero-title">About This App</span>', replace: '<span class="hero-title">Company Overview</span>' },
  ],
  predicates: [{ type: 'html', selector: '.hero-title', expected: 'Company Overview' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03'],
  rationale: 'Both edits target same .hero-title — second search gone after first changes to Our Mission',
});

// JB-03e: Two edits both modify the Contact Form h1 on form page
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03: Two edits both change Contact Form h1 on form page',
  edits: [
    { file: 'server.js', search: '<h1>Contact Form</h1>', replace: '<h1>Get In Touch</h1>' },
    { file: 'server.js', search: '<h1>Contact Form</h1>', replace: '<h1>Support Request</h1>' },
  ],
  predicates: [{ type: 'html', selector: 'h1', expected: 'Support Request' }],
  expectedSuccess: false,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03'],
  rationale: 'Both edits target same form h1 — second search gone after first renames it',
});

// JB-03f: Control — two edits change different elements on different pages (no collision)
scenarios.push({
  id: nextId('dom'),
  description: 'JB-03 control: Edit homepage h1 AND about page hero-title (no collision)',
  edits: [
    { file: 'server.js', search: '<h1>Demo App</h1>', replace: '<h1>My App</h1>' },
    { file: 'server.js', search: '<span class="hero-title">About This App</span>', replace: '<span class="hero-title">About Us</span>' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '<h1>My App</h1>' },
    { type: 'content', file: 'server.js', pattern: 'About Us</span>' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'browser', 'dom_mutation', 'JB-03', 'control'],
  rationale: 'Different elements on different pages — no DOM mutation collision',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-browser scenarios -> ${outPath}`);
