#!/usr/bin/env bun
/**
 * Access × HTTP scenario generator
 * Grid cell: H×2
 * Shapes: HH-01 (401/403 auth rejection), HH-02 (CORS rejection), HH-03 (rate limit pre-denial)
 *
 * These scenarios test whether verify detects ACCESS failures at the HTTP layer —
 * the endpoint exists and the code is correct, but the request is denied due to
 * authentication, CORS policy, or rate limiting configuration.
 *
 * Key distinction from State Assumption: the route handler works, but the
 * middleware/config layer blocks the request before it arrives.
 *
 * Run: bun scripts/harvest/stage-access-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hh-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape HH-01: API returns 401/403 — auth middleware blocks access
// Agent adds or modifies a route but doesn't add the route to an auth whitelist,
// or removes auth token config. Predicate expects unauthenticated access to a
// protected route.
// =============================================================================

// HH-01a: Add auth middleware, predicate expects open access to /api/items
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01: Auth middleware added, predicate expects unauthenticated /api/items access',
  edits: [{
    file: 'server.js',
    search: "const server = http.createServer((req, res) => {",
    replace: `const AUTH_TOKEN = process.env.AUTH_TOKEN || 'secret123';
const PUBLIC_PATHS = ['/health', '/'];
const server = http.createServer((req, res) => {
  if (!PUBLIC_PATHS.includes(req.url) && req.headers['authorization'] !== 'Bearer ' + AUTH_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }`
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'AUTH_TOKEN' },
    { type: 'content', file: 'server.js', pattern: "'/api/items'" },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'auth_rejection', 'HH-01'],
  rationale: 'Auth middleware IS in the code and /api/items route IS in the code — both content predicates pass. The 401 is a runtime behavior, file content is consistent.',
});

// HH-01b: Auth middleware added but PUBLIC_PATHS doesn't include new route
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01: Add /api/admin route but missing from PUBLIC_PATHS whitelist',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items') {",
    replace: `if (req.url === '/api/admin') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: [] }));
    return;
  }

  if (req.url === '/api/items') {`
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/api/admin' },
    { type: 'content', file: 'config.json', pattern: '/api/admin' },
  ],
  expectedSuccess: false,
  tags: ['access', 'http', 'auth_rejection', 'HH-01'],
  rationale: 'Route added to server.js but config.json has no mention of /api/admin — whitelist not updated',
});

// HH-01c: Remove AUTH_TOKEN from .env but server.js still requires it
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01: Remove SECRET_KEY from .env but server.js references it for auth',
  edits: [
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: '# SECRET_KEY removed' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst AUTH = process.env.SECRET_KEY;" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'process.env.SECRET_KEY' },
    { type: 'config', key: 'SECRET_KEY', expected: 'not-very-secret' },
  ],
  expectedSuccess: false,
  tags: ['access', 'http', 'auth_rejection', 'HH-01'],
  rationale: 'server.js references SECRET_KEY but .env had it removed — auth will fail at runtime',
});

// HH-01d: Config has API key, .env has different key — credential mismatch
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01: config.json API key differs from .env SECRET_KEY — credential mismatch',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "apiKey": "config-key-abc"' },
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="env-key-xyz"' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'config-key-abc' },
    { type: 'content', file: '.env', pattern: 'env-key-xyz' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'auth_rejection', 'HH-01'],
  rationale: 'Both files contain their respective values — content predicates pass. The mismatch is a runtime auth failure not visible at file level.',
});

// HH-01e: Add protected endpoint, .env has no token at all
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01: Protected /api/settings added, .env lacks AUTH_TOKEN entirely',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/api/items') {",
    replace: `if (req.url === '/api/settings') {
    if (!process.env.AUTH_TOKEN) { res.writeHead(500); res.end('No auth token configured'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ theme: 'dark' }));
    return;
  }

  if (req.url === '/api/items') {`
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'AUTH_TOKEN' },
    { type: 'content', file: '.env', pattern: 'AUTH_TOKEN' },
  ],
  expectedSuccess: false,
  tags: ['access', 'http', 'auth_rejection', 'HH-01'],
  rationale: 'Server references AUTH_TOKEN but .env has no such variable — cross-source access gap',
});

// HH-01f: Control — public route, no auth needed
scenarios.push({
  id: nextId('auth'),
  description: 'HH-01 control: Public /health route, no auth required',
  edits: [{ file: 'server.js', search: "res.end(JSON.stringify({ status: 'ok' }));", replace: "res.end(JSON.stringify({ status: 'ok', version: '2.0' }));" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "version: '2.0'" }],
  expectedSuccess: true,
  tags: ['access', 'http', 'auth_rejection', 'HH-01', 'control'],
  rationale: '/health is public — edit and predicate both succeed without auth concerns',
});

// =============================================================================
// Shape HH-02: CORS rejection
// Agent adds API endpoint or client-facing config, but CORS/origin allowlist
// in config or server code doesn't include the new origin. Predicate expects
// cross-origin access that would be blocked.
// =============================================================================

// HH-02a: Add CORS middleware with restrictive origin, config has different frontend URL
scenarios.push({
  id: nextId('cors'),
  description: 'HH-02: CORS allows localhost:3001 but config.json frontend URL is localhost:5173',
  edits: [
    { file: 'server.js', search: "const server = http.createServer((req, res) => {", replace: `const ALLOWED_ORIGINS = ['http://localhost:3001'];
const server = http.createServer((req, res) => {
  const origin = req.headers['origin'];
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('CORS rejected');
    return;
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);` },
    { file: 'config.json', search: '"port": 3000', replace: '"port": 3000,\n    "frontendUrl": "http://localhost:5173"' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'localhost:3001' },
    { type: 'content', file: 'config.json', pattern: 'localhost:5173' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'cors_rejection', 'HH-02'],
  rationale: 'Both values exist in their files — content passes. But CORS allowlist and frontend URL mismatch means runtime cross-origin failure.',
});

// HH-02b: Compose exposes port 3000, server CORS only allows port 8080
scenarios.push({
  id: nextId('cors'),
  description: 'HH-02: docker-compose exposes 3000, server CORS allows only port 8080 origin',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst CORS_ORIGIN = 'http://localhost:8080';"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'localhost:8080' },
    { type: 'content', file: 'docker-compose.yml', pattern: '3000' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'cors_rejection', 'HH-02'],
  rationale: 'Both patterns found in files but ports dont align — CORS will reject requests from port 3000',
});

// HH-02c: Add Access-Control-Allow-Origin header with wildcard, but config restricts
scenarios.push({
  id: nextId('cors'),
  description: 'HH-02: Server sends CORS wildcard but config.json has restrictive allowedOrigins',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// CORS: Allow all origins" },
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "allowedOrigins": ["https://app.example.com"]' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'CORS: Allow all origins' },
    { type: 'content', file: 'config.json', pattern: 'app.example.com' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'cors_rejection', 'HH-02'],
  rationale: 'Server comment says "allow all" but config restricts — inconsistent CORS intent across files',
});

// HH-02d: .env has CORS_ENABLED=false, server adds CORS headers anyway
scenarios.push({
  id: nextId('cors'),
  description: 'HH-02: .env disables CORS but server.js adds Access-Control headers',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nCORS_ENABLED=false' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// Always send CORS headers regardless of env" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'CORS_ENABLED=false' },
    { type: 'content', file: 'server.js', pattern: 'CORS headers regardless' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'cors_rejection', 'HH-02'],
  rationale: 'Both content patterns present but semantically contradictory — .env disables what server enables',
});

// HH-02e: Control — CORS configured consistently across files
scenarios.push({
  id: nextId('cors'),
  description: 'HH-02 control: CORS origin in both .env and server.js match',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nCORS_ORIGIN=http://localhost:3000' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst CORS = process.env.CORS_ORIGIN;" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'CORS_ORIGIN=http://localhost:3000' },
    { type: 'content', file: 'server.js', pattern: 'process.env.CORS_ORIGIN' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'cors_rejection', 'HH-02', 'control'],
  rationale: 'CORS origin configured consistently — .env sets it, server reads it',
});

// =============================================================================
// Shape HH-03: Rate limit pre-denial
// Config or env file shows rate limiting is enabled with a low threshold.
// Agent adds high-frequency endpoints or doesn't account for rate limits.
// Cross-source: rate limit config vs endpoint expectations.
// =============================================================================

// HH-03a: Config sets rate limit to 5/min, server adds batch endpoint
scenarios.push({
  id: nextId('rate'),
  description: 'HH-03: Config rate_limit=5/min but server adds /api/batch (high-frequency endpoint)',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "rateLimit": { "maxRequests": 5, "windowMs": 60000 }' },
    { file: 'server.js', search: "if (req.url === '/api/items') {", replace: `if (req.url === '/api/batch') {
    // Processes up to 100 items per call
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ processed: 100 }));
    return;
  }

  if (req.url === '/api/items') {` },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"maxRequests": 5' },
    { type: 'content', file: 'server.js', pattern: '/api/batch' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'rate_limit', 'HH-03'],
  rationale: 'Both content patterns present but 5 req/min rate limit will choke the batch endpoint at runtime',
});

// HH-03b: .env sets LOW_RATE_LIMIT=true, server has no rate limit bypass
scenarios.push({
  id: nextId('rate'),
  description: 'HH-03: .env enables low rate limit, server has no internal bypass for health checks',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nRATE_LIMIT=strict\nRATE_MAX=3' },
    { file: 'server.js', search: "if (req.url === '/health') {", replace: "// No rate limit bypass for health\n  if (req.url === '/health') {" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'RATE_MAX=3' },
    { type: 'content', file: 'server.js', pattern: 'No rate limit bypass' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'rate_limit', 'HH-03'],
  rationale: 'Health endpoint subject to 3 req/min limit — Docker HEALTHCHECK every 5s will be denied',
});

// HH-03c: Config and .env disagree on rate limit threshold
scenarios.push({
  id: nextId('rate'),
  description: 'HH-03: config.json allows 100 req/min but .env overrides to 2 req/min',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "rateLimit": { "maxRequests": 100 }' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nRATE_LIMIT_MAX=2' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"maxRequests": 100' },
    { type: 'content', file: '.env', pattern: 'RATE_LIMIT_MAX=2' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'rate_limit', 'HH-03'],
  rationale: 'Config says 100 but .env overrides to 2 — env takes precedence, silently restrictive',
});

// HH-03d: Compose healthcheck interval faster than rate limit window
scenarios.push({
  id: nextId('rate'),
  description: 'HH-03: Compose healthcheck every 5s but .env rate limit is 1 req/10s',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nRATE_WINDOW_MS=10000\nRATE_MAX=1' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'RATE_MAX=1' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'interval: 5s' },
  ],
  expectedSuccess: true,
  tags: ['access', 'http', 'rate_limit', 'HH-03'],
  rationale: 'Healthcheck fires every 5s but rate limit allows 1 req per 10s — healthcheck will fail',
});

// HH-03e: Control — rate limit configured high enough for normal usage
scenarios.push({
  id: nextId('rate'),
  description: 'HH-03 control: Rate limit set to 1000/min — generous for all endpoints',
  edits: [{ file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "rateLimit": { "maxRequests": 1000, "windowMs": 60000 }' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"maxRequests": 1000' }],
  expectedSuccess: true,
  tags: ['access', 'http', 'rate_limit', 'HH-03', 'control'],
  rationale: '1000 req/min is generous — no access denial expected',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-http scenarios -> ${outPath}`);
