#!/usr/bin/env bun
/**
 * stage-scope-leaves.ts — Scope/Blast Radius Scenario Stager
 *
 * Covers scope/blast radius failure shapes SC-02 through SC-05,
 * SC-07 through SC-09, SC-11, SC-12.
 * Tests whether the verification system detects when a change affects
 * more than intended — overly broad CSS selectors, migration collateral,
 * env/port cascading, global state leakage, package upgrade breaks,
 * DNS propagation, shared utility changes, and config key renames.
 *
 * For each shape: 1-2 failure scenarios (expectedSuccess: false),
 * 1 clean control (expectedSuccess: true).
 *
 * Run: bun scripts/harvest/stage-scope-leaves.ts
 * Output: fixtures/scenarios/scope-leaves-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/scope-leaves-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `sc-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// Anchor lines from demo-app files
const HEALTH_ANCHOR = "res.end(JSON.stringify({ status: 'ok' }));";
const ITEMS_ANCHOR = "res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));";
const ECHO_ANCHOR = "res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));";
const PORT_ANCHOR = 'const PORT = process.env.PORT || 3000;';
const ENV_PORT = 'PORT=3000';
const ENV_DB_URL = 'DATABASE_URL="postgres://localhost:5432/demo"';
const ENV_SECRET = 'SECRET_KEY="not-very-secret"';

// Homepage CSS anchors
const HOMEPAGE_BODY_CSS = 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }';
const HOMEPAGE_H1_CSS = 'h1 { color: #1a1a2e; font-size: 2rem; }';
const HOMEPAGE_NAV_CSS = 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }';
const HOMEPAGE_FOOTER_CSS = 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }';

// About page CSS anchors
const ABOUT_BODY_CSS = 'body { font-family: Georgia, serif; margin: 3rem; background: #f9f9f9; color: #222; }';
const ABOUT_BADGE_CSS = '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }';

// Config anchors
const CONFIG_DB = `"database": {
    "host": "localhost",
    "port": 5432,
    "name": "demo"
  }`;
const CONFIG_FEATURES = `"features": {
    "darkMode": true,
    "analytics": false
  }`;

// Docker anchors
const DOCKERFILE_FROM = 'FROM node:20-alpine';
const DOCKERFILE_EXPOSE = 'EXPOSE 3000';
const COMPOSE_PORTS = '"${VERIFY_HOST_PORT:-3000}:3000"';

// SQL anchors
const POSTS_TABLE = `CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const USERS_TABLE = `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;
const SETTINGS_TABLE = `CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

function editHealth(replace: string) {
  return [{ file: 'server.js', search: HEALTH_ANCHOR, replace }];
}
function editItems(replace: string) {
  return [{ file: 'server.js', search: ITEMS_ANCHOR, replace }];
}
function editEcho(replace: string) {
  return [{ file: 'server.js', search: ECHO_ANCHOR, replace }];
}
function editPort(replace: string) {
  return [{ file: 'server.js', search: PORT_ANCHOR, replace }];
}

// =============================================================================
// SC-02: CSS rule affects unintended elements (selector too broad)
// =============================================================================

push({
  description: 'SC-02: Universal * selector resets all elements — destroys page layout',
  edits: [{ file: 'server.js', search: HOMEPAGE_H1_CSS, replace: '* { color: red; margin: 0; padding: 0; font-size: 14px; }\n    h1 { color: #1a1a2e; font-size: 2rem; }' }],
  predicates: [
    { type: 'css', selector: '*', property: 'color', expected: 'red', path: '/' },
    { type: 'content', file: 'server.js', pattern: '\\* \\{ color: red', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'css_blast_radius', 'SC-02'],
  rationale: 'Universal * selector applies color:red and resets margin/padding/font-size on ALL elements — intended to style one thing, destroys entire page.',
});

push({
  description: 'SC-02: Tag selector "a" affects nav links AND all other links',
  edits: [{ file: 'server.js', search: HOMEPAGE_NAV_CSS, replace: 'a { color: #ff0000; text-decoration: underline; font-weight: bold; }\n    a.nav-link { margin-right: 1rem; }' }],
  predicates: [
    { type: 'css', selector: 'a', property: 'color', expected: '#ff0000', path: '/' },
    { type: 'content', file: 'server.js', pattern: 'a \\{ color: #ff0000', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'css_blast_radius', 'SC-02'],
  rationale: 'Bare "a" selector intended for nav links — but affects every anchor on every page including about, form, and edge-cases.',
});

push({
  description: 'SC-02: Footer selector scoped properly — affects only footer element',
  edits: [{ file: 'server.js', search: HOMEPAGE_FOOTER_CSS, replace: 'footer { margin-top: 2rem; color: #666; font-size: 0.85rem; }' }],
  predicates: [
    { type: 'css', selector: 'footer', property: 'color', expected: '#666', path: '/' },
    { type: 'http', method: 'GET', path: '/', expect: { status: 200, bodyContains: 'Powered by Node.js' } },
  ],
  expectedSuccess: true,
  tags: ['scope', 'css_blast_radius', 'SC-02', 'control'],
  rationale: 'Footer selector targets only the footer element — single element on page, no unintended scope expansion.',
});

// =============================================================================
// SC-03: Database migration affects unrelated tables
// =============================================================================

push({
  description: 'SC-03: Migration adds column to users but cascades to sessions via FK',
  edits: [{
    file: 'init.sql',
    search: USERS_TABLE,
    replace: `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'moderator')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'role', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'CHECK.*role IN', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'migration_collateral', 'SC-03'],
  rationale: 'Adding role column with CHECK constraint to users table — sessions and posts FKs reference users(id), any ALTER that locks users blocks all dependent table writes.',
});

push({
  description: 'SC-03: Rename column in users breaks all queries referencing old name',
  edits: [{
    file: 'init.sql',
    search: USERS_TABLE,
    replace: `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(50) NOT NULL UNIQUE,
    email_address VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  }],
  predicates: [
    { type: 'db', table: 'users', column: 'user_name', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'user_name VARCHAR', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'migration_collateral', 'SC-03'],
  rationale: 'Renaming username->user_name and email->email_address breaks all app queries, views, and indexes referencing the old column names — blast radius extends to entire codebase.',
});

push({
  description: 'SC-03 control: Adding nullable column — no downstream impact',
  edits: [{
    file: 'init.sql',
    search: SETTINGS_TABLE,
    replace: `CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`
  }],
  predicates: [
    { type: 'db', table: 'settings', column: 'description', assertion: 'column_exists' },
    { type: 'content', file: 'init.sql', pattern: 'description TEXT', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['scope', 'migration_collateral', 'SC-03', 'control'],
  rationale: 'Adding nullable column to settings — no FK dependencies, no existing queries reference it, zero blast radius.',
});

// =============================================================================
// SC-04: Environment variable change breaks other services
// =============================================================================

push({
  description: 'SC-04: Changing DATABASE_URL format breaks both app and migration runner',
  edits: [{ file: '.env', search: ENV_DB_URL, replace: 'DATABASE_URL="postgresql://admin:pass@db-host:5433/demo_v2"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'db-host:5433', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'env_cascading', 'SC-04'],
  rationale: 'Changing DATABASE_URL host/port/dbname — affects app server, migration runner, backup scheduler, and any service reading this variable.',
});

push({
  description: 'SC-04: Changing SECRET_KEY invalidates all existing sessions',
  edits: [{ file: '.env', search: ENV_SECRET, replace: 'SECRET_KEY="new-rotated-secret-2026"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'new-rotated-secret', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'env_cascading', 'SC-04'],
  rationale: 'Rotating SECRET_KEY without session migration — all existing signed sessions/tokens become invalid, every logged-in user force-logged-out.',
});

push({
  description: 'SC-04 control: Changing NODE_ENV — no cross-service impact',
  edits: [{ file: '.env', search: 'NODE_ENV=production', replace: 'NODE_ENV=staging' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'NODE_ENV=staging', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['scope', 'env_cascading', 'SC-04', 'control'],
  rationale: 'NODE_ENV change only affects logging verbosity and error display — no cross-service session or data impact.',
});

// =============================================================================
// SC-05: Port change affects dependent services
// =============================================================================

push({
  description: 'SC-05: Changing app port without updating Dockerfile EXPOSE and healthcheck',
  edits: [
    { file: '.env', search: ENV_PORT, replace: 'PORT=4000' },
    { file: 'server.js', search: PORT_ANCHOR, replace: 'const PORT = process.env.PORT || 4000;' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=4000', expected: 'exists' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 3000', expected: 'exists' },
    { type: 'content', file: 'Dockerfile', pattern: 'localhost:3000', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'port_cascading', 'SC-05'],
  rationale: 'Port changed to 4000 in .env and server.js but Dockerfile still EXPOSE 3000 and healthcheck still hits :3000 — container fails health check, Docker restarts it indefinitely.',
});

push({
  description: 'SC-05: Port change breaks docker-compose port mapping',
  edits: [
    { file: '.env', search: ENV_PORT, replace: 'PORT=8080' },
    { file: 'server.js', search: PORT_ANCHOR, replace: 'const PORT = process.env.PORT || 8080;' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=8080', expected: 'exists' },
    { type: 'content', file: 'docker-compose.yml', pattern: ':3000', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'port_cascading', 'SC-05'],
  rationale: 'App listens on 8080 but compose maps host:3000->container:3000 — incoming traffic hits empty port, app unreachable.',
});

push({
  description: 'SC-05 control: Port consistent across all config files',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=3000', expected: 'exists' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 3000', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'PORT.*3000', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['scope', 'port_cascading', 'SC-05', 'control'],
  rationale: 'Port 3000 consistent across .env, Dockerfile, and server.js — no cascading mismatch.',
});

// =============================================================================
// SC-07: Global state modification (singleton pattern leakage)
// =============================================================================

push({
  description: 'SC-07: Request handler mutates global config — affects all subsequent requests',
  edits: editHealth(
    `const config = require('./config.json');\n    config.app.name = 'Modified By Health Check';\n    res.end(JSON.stringify({ status: 'ok', appName: config.app.name }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: "config\\.app\\.name = 'Modified", expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'global_state_leak', 'SC-07'],
  rationale: 'require() returns cached singleton — mutating config.app.name in health check changes app name for ALL routes, single endpoint mutates global state.',
});

push({
  description: 'SC-07: Middleware modifies req.headers globally — persists across requests',
  edits: editItems(
    `// Bug: modifying shared prototype\n    Object.prototype._debug = true;\n    res.end(JSON.stringify([\n      { id: 1, name: 'Alpha' },\n      { id: 2, name: 'Beta' },\n    ]));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Object\\.prototype\\._debug', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'global_state_leak', 'SC-07'],
  rationale: 'Prototype pollution via Object.prototype._debug — every object in the entire process now has _debug:true, affecting JSON serialization, iterations, and type checks globally.',
});

push({
  description: 'SC-07 control: Request uses local copy — no global mutation',
  edits: editHealth(
    `const config = require('./config.json');\n    const localCopy = { ...config.app };\n    localCopy.checkedAt = Date.now();\n    res.end(JSON.stringify({ status: 'ok', appName: localCopy.name }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'localCopy.*config\\.app', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['scope', 'global_state_leak', 'SC-07', 'control'],
  rationale: 'Spread into local copy — mutations affect only the local variable, global singleton untouched.',
});

// =============================================================================
// SC-08: Package upgrade cascading breaks
// =============================================================================

push({
  description: 'SC-08: Node major version upgrade breaks native module — cascading failure',
  edits: [{ file: 'Dockerfile', search: DOCKERFILE_FROM, replace: 'FROM node:22-alpine' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'node:22-alpine', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'package_cascade', 'SC-08'],
  rationale: 'Upgrading from Node 20 to 22 in Dockerfile — native modules (bcrypt, canvas, etc.) require rebuild, may not support new V8 ABI, cascading build failures.',
});

push({
  description: 'SC-08: Alpine upgrade changes musl version — binary incompatibility',
  edits: [{ file: 'Dockerfile', search: DOCKERFILE_FROM, replace: 'FROM node:20-bookworm' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'node:20-bookworm', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'package_cascade', 'SC-08'],
  rationale: 'Switching from Alpine (musl) to Bookworm (glibc) — all pre-compiled binaries in node_modules are musl-linked, fail to load on glibc runtime.',
});

push({
  description: 'SC-08 control: Patch version upgrade — backward compatible',
  edits: [{ file: 'Dockerfile', search: DOCKERFILE_FROM, replace: 'FROM node:20.11-alpine' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'node:20\\.11-alpine', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['scope', 'package_cascade', 'SC-08', 'control'],
  rationale: 'Patch version pin within same major — backward compatible, no native module rebuild needed.',
});

// =============================================================================
// SC-09: DNS change affects multiple services
// =============================================================================

push({
  description: 'SC-09: Changing db hostname in config affects app + backup + migration',
  edits: [{
    file: 'config.json',
    search: CONFIG_DB,
    replace: `"database": {
    "host": "db-replica.internal",
    "port": 5432,
    "name": "demo"
  }`
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'db-replica\\.internal', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'dns_cascade', 'SC-09'],
  rationale: 'Changing database host to replica — reads work but writes fail (replica is read-only), affects all services sharing this config: app, backup scheduler, migration runner.',
});

push({
  description: 'SC-09: Database URL host change without updating docker-compose networking',
  edits: [{ file: '.env', search: ENV_DB_URL, replace: 'DATABASE_URL="postgres://external-db.example.com:5432/demo"' }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'external-db\\.example\\.com', expected: 'exists' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'db:', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'dns_cascade', 'SC-09'],
  rationale: 'DATABASE_URL points to external host but docker-compose still runs local db service — app connects to wrong database, local db runs uselessly consuming resources.',
});

push({
  description: 'SC-09 control: Database host is Docker service name — internal DNS',
  edits: [],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"host": "localhost"', expected: 'exists' },
    { type: 'content', file: '.env', pattern: 'localhost:5432', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['scope', 'dns_cascade', 'SC-09', 'control'],
  rationale: 'Database host is localhost — no external DNS dependency, docker-compose service networking handles resolution.',
});

// =============================================================================
// SC-11: Shared utility function change breaks callers
// =============================================================================

push({
  description: 'SC-11: JSON.stringify replacer changes affect all routes',
  edits: editPort(
    `const PORT = process.env.PORT || 3000;\nconst _origStringify = JSON.stringify;\nJSON.stringify = function(v, r, s) { return _origStringify(v, r || ((k,v) => v === null ? undefined : v), s); };`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'JSON\\.stringify = function', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'shared_utility_break', 'SC-11'],
  rationale: 'Monkey-patching JSON.stringify to strip nulls — every route, every library, every serialization in the process silently loses null values.',
});

push({
  description: 'SC-11: Date.now override for testing leaks to production',
  edits: editPort(
    `const PORT = process.env.PORT || 3000;\nconst FIXED_TIME = 1700000000000;\nDate.now = () => FIXED_TIME;`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Date\\.now = \\(\\) =>', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'FIXED_TIME', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'shared_utility_break', 'SC-11'],
  rationale: 'Date.now returns fixed timestamp — session expiry, cache TTL, rate limiting, and all time-dependent logic frozen. One test override breaks entire runtime.',
});

push({
  description: 'SC-11 control: Helper function without global mutation',
  edits: editHealth(
    `function formatResponse(data) { return JSON.stringify({ ...data, ts: Date.now() }); }\n    res.end(formatResponse({ status: 'ok' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'function formatResponse', expected: 'exists' },
    { type: 'http', method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } },
  ],
  expectedSuccess: true,
  tags: ['scope', 'shared_utility_break', 'SC-11', 'control'],
  rationale: 'Local helper function wraps JSON.stringify — no global mutation, callers use it explicitly.',
});

// =============================================================================
// SC-12: Configuration key rename breaks consumers
// =============================================================================

push({
  description: 'SC-12: Renaming config "port" to "listenPort" breaks all readers',
  edits: [{
    file: 'config.json',
    search: '"port": 3000',
    replace: '"listenPort": 3000'
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"listenPort"', expected: 'exists' },
    { type: 'content', file: 'config.json', pattern: '"port": 3000', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'config_rename_break', 'SC-12'],
  rationale: 'Renaming "port" to "listenPort" — any code reading config.app.port gets undefined, falls back to wrong default or crashes.',
});

push({
  description: 'SC-12: Renaming "darkMode" to "dark_mode" breaks feature flag consumers',
  edits: [{
    file: 'config.json',
    search: '"darkMode": true',
    replace: '"dark_mode": true'
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"dark_mode"', expected: 'exists' },
    { type: 'content', file: 'config.json', pattern: '"darkMode"', expected: 'not_found' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'config_rename_break', 'SC-12'],
  rationale: 'camelCase to snake_case rename — all JavaScript code reading features.darkMode gets undefined, feature silently disabled for all users.',
});

push({
  description: 'SC-12: Renaming settings table key format without data migration',
  edits: editHealth(
    `// Old keys: "theme", "lang" — new keys: "app.theme", "app.lang"\n    const query = "SELECT value FROM settings WHERE key = 'app.theme'";\n    res.end(JSON.stringify({ status: 'ok', _query: query, _note: 'old-keys-orphaned' }));`
  ),
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'app\\.theme', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'old-keys-orphaned', expected: 'exists' },
  ],
  expectedSuccess: false,
  tags: ['scope', 'config_rename_break', 'SC-12'],
  rationale: 'Settings key renamed from "theme" to "app.theme" without data migration — old rows with key="theme" orphaned, new queries return NULL.',
});

push({
  description: 'SC-12 control: Config key preserved, new alias added',
  edits: [{
    file: 'config.json',
    search: CONFIG_FEATURES,
    replace: `"features": {
    "darkMode": true,
    "dark_mode": true,
    "analytics": false
  }`
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"darkMode": true', expected: 'exists' },
    { type: 'content', file: 'config.json', pattern: '"dark_mode": true', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['scope', 'config_rename_break', 'SC-12', 'control'],
  rationale: 'Both old (darkMode) and new (dark_mode) keys present — backward compatible, consumers of either key work.',
});

// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} scope/blast radius scenarios to ${outPath}`);

// Print distribution
const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  for (const t of s.tags) {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
}
console.log('\nTag distribution:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag}: ${count}`);
}

const successCount = scenarios.filter((s: any) => s.expectedSuccess).length;
const failCount = scenarios.filter((s: any) => !s.expectedSuccess).length;
console.log(`\nExpected success: ${successCount}, Expected failure: ${failCount}`);
