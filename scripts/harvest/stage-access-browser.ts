#!/usr/bin/env bun
/**
 * Access x Browser scenario generator
 * Grid cell: H×3
 * Shapes: HB-01 (CSP header blocks inline script), HB-02 (CORS config rejects cross-origin), HB-03 (iframe sandbox restricts capability)
 *
 * These scenarios test whether verify detects ACCESS failures in the browser
 * layer — the agent's edits are structurally valid but security policies
 * (CSP, CORS, iframe sandbox) prevent the intended behaviour from executing.
 *
 * Run: bun scripts/harvest/stage-access-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hb-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape HB-01: CSP header blocks inline script
// Agent adds inline JavaScript but the server sets Content-Security-Policy
// that blocks inline script execution. The predicate checks for behaviour
// that depends on the script running.
// =============================================================================

// HB-01a: CSP blocks inline onclick handler
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01: Server adds CSP header blocking inline scripts, edit adds onclick handler',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'text/html' });", replace: "res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': \"script-src 'none'\" });" },
    { file: 'server.js', search: '<button class="primary">Go</button>', replace: '<button class="primary" onclick="alert(\'clicked\')">Go</button>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'onclick="alert' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01'],
  rationale: 'Edit adds onclick but CSP script-src none blocks all inline scripts — content exists but behaviour is dead',
});

// HB-01b: CSP blocks inline <script> tag added by edit
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01: CSP nonce policy set, edit adds <script> without nonce',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'text/html' });", replace: "res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': \"script-src 'nonce-abc123'\" });" },
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<script>document.title = "Dynamic";</script>\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'document.title = "Dynamic"' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01'],
  rationale: 'Script tag exists in source but CSP requires nonce — browser will refuse to execute it',
});

// HB-01c: CSP blocks eval used by dynamic style injection
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01: CSP blocks unsafe-eval, edit uses eval for dynamic styling',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>eval("document.body.style.background = \'red\'")</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'eval(' },
    { type: 'css', selector: 'body', property: 'background', expected: 'red' },
  ],
  expectedSuccess: false,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01'],
  rationale: 'Edit uses eval() for styling but default CSP blocks unsafe-eval — background never changes',
});

// HB-01d: CSP style-src blocks inline <style> added by edit
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01: CSP style-src self blocks inline style, edit adds new <style> block',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'text/html' });", replace: "res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': \"style-src 'self'\" });" },
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<style>.injected { color: red; }</style>\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [{ type: 'css', selector: '.injected', property: 'color', expected: 'red' }],
  expectedSuccess: false,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01'],
  rationale: 'Inline <style> added but CSP style-src self blocks inline styles — rule never applies',
});

// HB-01e: CSP img-src blocks external image source
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01: CSP img-src self set, edit adds external image URL',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'text/html' });", replace: "res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': \"img-src 'self'\" });" },
    { file: 'server.js', search: '<img class="logo" src="/logo.png" alt="Demo Logo" />', replace: '<img class="logo" src="https://cdn.external.com/logo.png" alt="Demo Logo" />' },
  ],
  predicates: [{ type: 'html', selector: 'img.logo', attribute: 'src', expected: 'https://cdn.external.com/logo.png' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01'],
  rationale: 'HTML attribute present but CSP img-src self blocks external URL — image will not load',
});

// HB-01f: Control — no CSP header, inline script works
scenarios.push({
  id: nextId('csp'),
  description: 'HB-01 control: No CSP header, inline script added normally',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>console.log("hello")</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'console.log("hello")' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'csp_blocked', 'HB-01', 'control'],
  rationale: 'No CSP restriction — inline script is present and would execute normally',
});

// =============================================================================
// Shape HB-02: CORS config rejects cross-origin fetch
// Agent adds fetch() calls to external APIs but the server's CORS configuration
// blocks cross-origin requests. The predicate checks for data that would only
// arrive if the fetch succeeded.
// =============================================================================

// HB-02a: Server sets restrictive CORS, edit adds cross-origin fetch
scenarios.push({
  id: nextId('cors'),
  description: 'HB-02: Server sets Access-Control-Allow-Origin: same-origin, edit fetches external API',
  edits: [{
    file: 'server.js',
    search: "res.writeHead(200, { 'Content-Type': 'application/json' });",
    replace: "res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://myapp.example.com' });",
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Access-Control-Allow-Origin' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'cors_rejected', 'HB-02'],
  rationale: 'CORS header set to specific origin — other origins cannot access the API response',
});

// HB-02b: Edit adds fetch to third-party, CORS blocks it
scenarios.push({
  id: nextId('cors'),
  description: 'HB-02: Edit adds client-side fetch to external service, no CORS proxy configured',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>fetch("https://api.thirdparty.com/data").then(r => r.json()).then(d => document.getElementById("details").textContent = d.value)</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'html', selector: '#details', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'cors_rejected', 'HB-02'],
  rationale: 'Fetch to third-party API will be CORS-blocked — #details content unchanged from default',
});

// HB-02c: CORS preflight fails — no Access-Control-Allow-Methods
scenarios.push({
  id: nextId('cors'),
  description: 'HB-02: API endpoint has no CORS headers, edit sends cross-origin POST from client',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>fetch("/api/items", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"New"})}).catch(e => console.error(e))</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'fetch("/api/items"' },
    { type: 'http', method: 'POST', path: '/api/items', expect: { status: 200 } },
  ],
  expectedSuccess: false,
  tags: ['access', 'browser', 'cors_rejected', 'HB-02'],
  rationale: 'Client-side POST without proper CORS preflight handling — browser blocks the request',
});

// HB-02d: Edit sets wildcard CORS but credentials mode rejects it
scenarios.push({
  id: nextId('cors'),
  description: 'HB-02: CORS set to * but fetch uses credentials:include (browser rejects wildcard+credentials)',
  edits: [
    { file: 'server.js', search: "res.writeHead(200, { 'Content-Type': 'application/json' });", replace: "res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });" },
    { file: 'server.js', search: '<footer>Powered by Node.js</footer>', replace: '<script>fetch("/api/items",{credentials:"include"}).then(r=>r.json())</script>\n  <footer>Powered by Node.js</footer>' },
  ],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'credentials:"include"' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'cors_rejected', 'HB-02'],
  rationale: 'CORS wildcard * with credentials:include is explicitly forbidden by the spec — browser rejects',
});

// HB-02e: Control — same-origin API fetch works
scenarios.push({
  id: nextId('cors'),
  description: 'HB-02 control: Same-origin fetch to /api/items (no CORS issue)',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<script>fetch("/api/items").then(r=>r.json()).then(d=>console.log(d))</script>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'fetch("/api/items")' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'cors_rejected', 'HB-02', 'control'],
  rationale: 'Same-origin fetch — no CORS restriction, request succeeds',
});

// =============================================================================
// Shape HB-03: iframe sandbox restricts capability
// Edit embeds content in a sandboxed iframe, and the predicate checks for
// behaviour that the sandbox attribute prevents (form submission, scripts,
// navigation).
// =============================================================================

// HB-03a: Sandboxed iframe blocks form submission
scenarios.push({
  id: nextId('sandbox'),
  description: 'HB-03: iframe sandbox without allow-forms, edit embeds form page',
  edits: [{
    file: 'server.js',
    search: '<footer>About page footer</footer>',
    replace: '<iframe sandbox="" src="/form" width="100%" height="400"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [{ type: 'html', selector: 'iframe', attribute: 'src', expected: '/form' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'iframe_sandbox', 'HB-03'],
  rationale: 'iframe sandbox="" blocks all capabilities — form inside cannot be submitted',
});

// HB-03b: Sandboxed iframe blocks script execution
scenarios.push({
  id: nextId('sandbox'),
  description: 'HB-03: iframe sandbox without allow-scripts, predicate expects script behaviour',
  edits: [{
    file: 'server.js',
    search: '<footer>About page footer</footer>',
    replace: '<iframe sandbox="" src="/edge-cases" width="100%" height="300"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'sandbox=""' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'iframe_sandbox', 'HB-03'],
  rationale: 'iframe sandbox="" prevents script execution inside the embedded page',
});

// HB-03c: Sandboxed iframe blocks top-level navigation
scenarios.push({
  id: nextId('sandbox'),
  description: 'HB-03: iframe sandbox blocks navigation, embedded page has links',
  edits: [{
    file: 'server.js',
    search: '<footer>About page footer</footer>',
    replace: '<iframe sandbox="allow-scripts" src="/" width="100%" height="300"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'sandbox="allow-scripts"' },
    { type: 'html', selector: 'iframe', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['access', 'browser', 'iframe_sandbox', 'HB-03'],
  rationale: 'sandbox allows scripts but not navigation — nav-links inside iframe cannot escape to parent',
});

// HB-03d: sandbox allow-same-origin missing blocks cookie access
scenarios.push({
  id: nextId('sandbox'),
  description: 'HB-03: iframe sandbox without allow-same-origin, embedded content cannot access cookies',
  edits: [{
    file: 'server.js',
    search: '<footer>Powered by Node.js</footer>',
    replace: '<iframe sandbox="allow-scripts" src="/api/items" width="100%" height="200"></iframe>\n  <footer>Powered by Node.js</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'sandbox="allow-scripts" src="/api/items"' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'iframe_sandbox', 'HB-03'],
  rationale: 'Without allow-same-origin the iframe is treated as cross-origin — no cookie or localStorage access',
});

// HB-03e: Control — iframe with full permissions
scenarios.push({
  id: nextId('sandbox'),
  description: 'HB-03 control: iframe with allow-scripts allow-forms allow-same-origin (full permissions)',
  edits: [{
    file: 'server.js',
    search: '<footer>About page footer</footer>',
    replace: '<iframe sandbox="allow-scripts allow-forms allow-same-origin" src="/form" width="100%" height="400"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'allow-scripts allow-forms allow-same-origin' }],
  expectedSuccess: true,
  tags: ['access', 'browser', 'iframe_sandbox', 'HB-03', 'control'],
  rationale: 'Full sandbox permissions — form submission, scripts, and cookies all work',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-browser scenarios -> ${outPath}`);
