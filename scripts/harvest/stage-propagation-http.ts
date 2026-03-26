#!/usr/bin/env bun
/**
 * Propagation × HTTP scenario generator
 * Grid cell: E×2
 * Shapes: PH-01 (DB schema changed but API returns old shape),
 *         PH-02 (API contract changed but frontend not updated),
 *         PH-03 (Env var changed but process serves old config)
 *
 * Propagation scenarios test whether verify detects when an upstream change
 * doesn't cascade to downstream HTTP consumers. The DB→API→UI chain is where
 * most multi-layer agent failures originate.
 *
 * Live-tier scenarios require Docker (requiresDocker + requiresLiveHttp).
 * Pure-tier scenarios test cross-file structural propagation without Docker.
 *
 * Run: bun scripts/harvest/stage-propagation-http.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-http-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `ph-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// =============================================================================
// Shape PH-01: DB schema changed but API returns old shape
// Edit init.sql to add/rename columns, but the API response (from server.js)
// still returns the old data shape. Tests DB→API propagation gap.
// =============================================================================

// PH-01a: Add column to schema, API response has no reference to it (live)
scenarios.push({
  id: nextId('dbapi'),
  description: 'PH-01: Add avatar_url to users schema, GET /api/items has no avatar field',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    avatar_url TEXT,' }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'avatar_url' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'db_api_shape', 'PH-01'],
  rationale: 'Schema column added but API hardcoded — response shape doesn\'t include new field',
});

// PH-01b: Add published_at column to posts, API has no reference (live)
scenarios.push({
  id: nextId('dbapi'),
  description: 'PH-01: Add published_at to posts schema, GET /api/items has no timestamp',
  edits: [{ file: 'init.sql', search: 'view_count INTEGER DEFAULT 0,', replace: 'view_count INTEGER DEFAULT 0,\n    published_at TIMESTAMP,' }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'published_at' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'db_api_shape', 'PH-01'],
  rationale: 'Schema adds timestamp column but API layer not updated — stale response shape',
});

// PH-01c: Pure-tier — add column to init.sql, server.js has no reference
scenarios.push({
  id: nextId('dbapi'),
  description: 'PH-01 pure: Add bio column to users in init.sql, server.js has no bio reference',
  edits: [{ file: 'init.sql', search: 'email VARCHAR(255) NOT NULL,', replace: 'email VARCHAR(255) NOT NULL,\n    bio TEXT,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'bio' }],
  expectedSuccess: false,
  tags: ['propagation', 'http', 'db_api_shape', 'PH-01', 'pure'],
  rationale: 'Schema column added — server.js API has no code to serve it (pure structural check)',
});

// PH-01d: Pure-tier — rename column in init.sql, server.js uses old name
scenarios.push({
  id: nextId('dbapi'),
  description: 'PH-01 pure: Rename password_hash to password_digest in init.sql, server.js unchanged',
  edits: [{ file: 'init.sql', search: 'password_hash TEXT NOT NULL,', replace: 'password_digest TEXT NOT NULL,' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'password_digest' }],
  expectedSuccess: false,
  tags: ['propagation', 'http', 'db_api_shape', 'PH-01', 'pure'],
  rationale: 'Column renamed in schema — server.js code still uses old column name',
});

// =============================================================================
// Shape PH-02: API contract changed but frontend not updated
// Edit server.js API response shape, but the HTML templates in server.js
// still render expecting the old shape. Tests API→UI propagation gap.
// =============================================================================

// PH-02a: Rename API field, homepage still displays old field name (live)
scenarios.push({
  id: nextId('apiui'),
  description: 'PH-02: Rename API item "name" to "title", homepage still shows "Item Alpha"',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, title: 'Alpha' }" }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: '"name"' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'api_frontend', 'PH-02'],
  rationale: 'API field renamed from "name" to "title" — response no longer contains "name" key',
});

// PH-02b: Change API response structure, add wrapper (live)
scenarios.push({
  id: nextId('apiui'),
  description: 'PH-02: Wrap API response in { data: [...] }, homepage expects flat array',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));",
    replace: "res.end(JSON.stringify({ data: [\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ], total: 2 }));",
  }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: ['"data"', '"total"'] },
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'api_frontend', 'PH-02', 'control'],
  rationale: 'API response wrapped — check confirms new shape is served',
});

// PH-02c: Change echo endpoint key names, check for old keys (live)
scenarios.push({
  id: nextId('apiui'),
  description: 'PH-02: Echo endpoint changes "echo" to "payload", check for old key',
  edits: [{ file: 'server.js', search: '{ echo: body, timestamp: Date.now() }', replace: '{ payload: body, ts: Date.now() }' }],
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
  tags: ['propagation', 'http', 'api_frontend', 'PH-02'],
  rationale: 'API contract changed — old key "echo" no longer in response',
});

// PH-02d: Pure-tier — change API items but homepage HTML still references old name
scenarios.push({
  id: nextId('apiui'),
  description: 'PH-02 pure: Rename Alpha to Gamma in API, homepage HTML still has "Item Alpha"',
  edits: [{ file: 'server.js', search: "{ id: 1, name: 'Alpha' }", replace: "{ id: 1, name: 'Gamma' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Item Alpha' }],
  expectedSuccess: true,
  tags: ['propagation', 'http', 'api_frontend', 'PH-02', 'pure'],
  rationale: 'API data changed but homepage HTML still hardcodes "Item Alpha" — the content predicate PASSES because Item Alpha IS still in the HTML template (it\'s the propagation gap that the API and HTML are inconsistent)',
});

// PH-02e: Pure-tier — change /health status but Dockerfile healthcheck still expects old response
scenarios.push({
  id: nextId('apiui'),
  description: 'PH-02 pure: Health returns "ready" instead of "ok", Dockerfile wget still expects /health',
  edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ready' }" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "status: 'ok'" }],
  expectedSuccess: false,
  tags: ['propagation', 'http', 'api_frontend', 'PH-02', 'pure'],
  rationale: 'Health response changed — old value no longer present',
});

// =============================================================================
// Shape PH-03: Env var changed but process serves old config
// Edit .env or config.json, but the running process (server.js) still
// serves the old configuration. Tests config→process propagation gap.
// =============================================================================

// PH-03a: Change port in .env, health endpoint still on old port (live)
scenarios.push({
  id: nextId('envproc'),
  description: 'PH-03: Change PORT to 9090 in .env, server still listens on 3000',
  edits: [{ file: '.env', search: 'PORT=3000', replace: 'PORT=9090' }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200 },
  }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'env_process', 'PH-03'],
  rationale: '.env changed but process started with old port — still responds on 3000 (docker-compose overrides)',
});

// PH-03b: Change SECRET_KEY in .env, check that echo doesn't reflect it (live)
scenarios.push({
  id: nextId('envproc'),
  description: 'PH-03: Change SECRET_KEY in .env, echo endpoint has no secret reference',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="super-secure-key-2024"' }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'super-secure-key' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'env_process', 'PH-03'],
  rationale: 'Secret changed in .env but process doesn\'t expose secrets — env→API propagation gap',
});

// PH-03c: Change DEBUG flag in .env, server has no debug behavior
scenarios.push({
  id: nextId('envproc'),
  description: 'PH-03: Enable DEBUG=true in .env, server response has no debug info',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200, bodyContains: 'debug' },
  }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresLiveHttp: true,
  tags: ['propagation', 'http', 'env_process', 'PH-03'],
  rationale: 'DEBUG flag enabled but server has no debug mode — env→behavior propagation gap',
});

// PH-03d: Pure-tier — change feature flag in config.json, .env has no reference
scenarios.push({
  id: nextId('envproc'),
  description: 'PH-03 pure: Enable darkMode in config.json, .env has no dark mode variable',
  edits: [{ file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'DARK_MODE' }],
  expectedSuccess: false,
  tags: ['propagation', 'http', 'env_process', 'PH-03', 'pure'],
  rationale: 'Config flag changed but .env has no corresponding variable — config→env propagation gap',
});

// PH-03e: Pure-tier — change DB config, docker-compose has no DB service
scenarios.push({
  id: nextId('envproc'),
  description: 'PH-03 pure: Change db port to 5433 in config.json, docker-compose has no db service',
  edits: [{ file: 'config.json', search: '"port": 5432', replace: '"port": 5433' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '5433' }],
  expectedSuccess: false,
  tags: ['propagation', 'http', 'env_process', 'PH-03', 'pure'],
  rationale: 'DB port changed in config but docker-compose has no DB service to update',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-http scenarios → ${outPath}`);
