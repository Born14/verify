import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runHallucinationGate } from '../../src/gates/hallucination.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GateContext, Predicate, VerifyConfig } from '../../src/types.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

let appDir: string;

function makeCtx(predicates: Predicate[]): GateContext {
  return {
    config: { appDir } as VerifyConfig,
    edits: [],
    predicates,
    log: () => {},
  };
}

beforeAll(() => {
  appDir = join(tmpdir(), `verify-hal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(appDir, { recursive: true });

  // server.js with routes, CSS, HTML
  writeFileSync(join(appDir, 'server.js'), `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.url === '/api/items') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ id: 1, name: 'Alpha' }]));
    return;
  }
  if (req.url === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(\`<html>
<head><style>
  .hero { background: #3498db; color: white; }
  .card-title { font-weight: bold; font-size: 1.2rem; }
  .nav-link { color: #0066cc; }
</style></head>
<body>
  <h1>About Page</h1>
  <p>Built with Node.js</p>
  <footer>Powered by Node.js</footer>
</body></html>\`);
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});
server.listen(3000, () => {
  console.log('Server listening on port 3000');
});
`);

  // init.sql with schema
  writeFileSync(join(appDir, 'init.sql'), `
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    body TEXT,
    published BOOLEAN DEFAULT false
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL
);
`);

  // config.json
  writeFileSync(join(appDir, 'config.json'), JSON.stringify({
    app: { name: 'Test App', port: 3000 },
    database: { host: 'localhost', port: 5432 },
    features: { darkMode: true, analytics: false },
  }, null, 2));
});

afterAll(() => {
  rmSync(appDir, { recursive: true, force: true });
});

// =============================================================================
// BASIC GATE BEHAVIOR
// =============================================================================

describe('hallucination gate — basics', () => {
  test('passes when no hallucination predicates', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'css', selector: '.hero', property: 'color', expected: 'white' },
    ]));
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('hallucination');
  });

  test('fails on missing claim field', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', source: 'schema', halAssert: 'grounded' } as any,
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Missing claim');
  });

  test('fails on missing source field', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users table exists', halAssert: 'grounded' } as any,
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Missing source');
  });

  test('fails on invalid halAssert value', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'test', source: 'schema', halAssert: 'maybe' } as any,
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Invalid halAssert');
  });
});

// =============================================================================
// HAL-01 to HAL-05: FACTUAL FABRICATION
// =============================================================================

describe('hallucination gate — factual fabrication (HAL-01 to HAL-05)', () => {

  // HAL-01: Invented statistic
  test('HAL-01: detects fabricated statistic not in source', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: '73% of users prefer dark mode', source: 'content', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-01: accepts grounded content that exists', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'About Page', source: 'content', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-01: fails when grounded claim is actually fabricated', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'NonexistentString12345', source: 'content', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT grounded');
  });

  // HAL-02: Invented entity
  test('HAL-02: detects fabricated entity', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'AcmeCorp', source: 'content', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-03: Invented API parameter
  test('HAL-03: detects fabricated API parameter', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'sortBy', source: 'server.js', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-03: accepts parameter that exists in source', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'Alpha', source: 'server.js', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-04: Invented file/function
  test('HAL-04: detects fabricated file path', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'utils/helpers.ts', source: 'files', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-04: accepts file that exists', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'server.js', source: 'files', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-04: fails when fabricated file actually exists', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'server.js', source: 'files', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('NOT fabricated');
  });

  // HAL-05: Conflated sources
  test('HAL-05: detects conflated source (JS in SQL file)', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'createServer', source: 'init.sql', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-05: accepts content in correct source file', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'CREATE TABLE', source: 'init.sql', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });
});

// =============================================================================
// HAL-06 to HAL-10: SCHEMA/STRUCTURE FABRICATION
// =============================================================================

describe('hallucination gate — schema fabrication (HAL-06 to HAL-10)', () => {

  // HAL-06: Wrong column type
  test('HAL-06: detects wrong column type claim', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'email column type is INTEGER', source: 'schema', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-06: accepts correct column type', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'email column type is VARCHAR', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-07: Wrong table relationship
  test('HAL-07: detects fabricated column name', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'posts table has author_id column', source: 'schema', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-07: accepts correct column name', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'posts table has user_id column', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-08: Wrong API endpoint
  test('HAL-08: detects fabricated API route', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'POST /api/v2/users', source: 'routes', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-08: accepts existing route', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: '/api/items', source: 'routes', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-09: Wrong config key
  test('HAL-09: detects fabricated config key', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'settings.maxRetries exists', source: 'config', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-09: accepts existing config key', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'features.darkMode exists', source: 'config', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-10: Wrong CSS selector
  test('HAL-10: detects fabricated CSS selector', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: '.card-header selector exists', source: 'css', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-10: accepts existing CSS selector', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: '.card-title selector exists', source: 'css', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });
});

// =============================================================================
// HAL-11 to HAL-15: REASONING FABRICATION
// =============================================================================

describe('hallucination gate — reasoning fabrication (HAL-11 to HAL-15)', () => {

  // HAL-11: False causal claim
  test('HAL-11: detects fabricated causal element', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'CORS middleware', source: 'server.js', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-12: False temporal claim
  test('HAL-12: detects fabricated temporal reference', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'runMigrations', source: 'server.js', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-13: False absence claim
  test('HAL-13: correctly identifies absence (no try/catch)', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'try {', source: 'server.js', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-13: correctly identifies presence (404 handler exists)', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'Not Found', source: 'server.js', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-14: Confabulated error message
  test('HAL-14: detects fabricated error message', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'TypeError: Cannot read property of null', source: 'content', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-14: accepts real log message', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'Server listening on port', source: 'server.js', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  // HAL-15: Plausible but wrong code
  test('HAL-15: detects fabricated schema column', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'sessions table has user_email column', source: 'schema', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('HAL-15: accepts correct schema column', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'sessions table has token column', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('hallucination gate — edge cases', () => {
  test('handles multiple predicates — all pass', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users table has email column', source: 'schema', halAssert: 'grounded' },
      { type: 'hallucination', claim: 'nonexistent_col', source: 'schema', halAssert: 'fabricated' },
      { type: 'hallucination', claim: '/health', source: 'routes', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('3 hallucination claim(s) verified');
  });

  test('fails on first bad predicate among multiple', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users table has email column', source: 'schema', halAssert: 'grounded' },
      { type: 'hallucination', claim: 'users table has phone column', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('phone');
  });

  test('ignores non-hallucination predicates', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'css', selector: '.hero', property: 'color', expected: 'white' },
      { type: 'hallucination', claim: 'About Page', source: 'content', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('case insensitive content matching', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'about page', source: 'content', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('schema source with no init.sql returns false for grounded', () => {
    const emptyDir = join(tmpdir(), `verify-hal-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const ctx: GateContext = {
      config: { appDir: emptyDir } as VerifyConfig,
      edits: [],
      predicates: [{ type: 'hallucination', claim: 'users table exists', source: 'schema', halAssert: 'grounded' }],
      log: () => {},
    };
    const result = runHallucinationGate(ctx);
    expect(result.passed).toBe(false);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  test('schema source with no init.sql returns true for fabricated', () => {
    const emptyDir = join(tmpdir(), `verify-hal-empty2-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const ctx: GateContext = {
      config: { appDir: emptyDir } as VerifyConfig,
      edits: [],
      predicates: [{ type: 'hallucination', claim: 'users table exists', source: 'schema', halAssert: 'fabricated' }],
      log: () => {},
    };
    const result = runHallucinationGate(ctx);
    expect(result.passed).toBe(true);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  test('config.json key path resolution', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'app.name exists', source: 'config', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('deeply nested config key', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'app.name.nested.deep exists', source: 'config', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('stageDir takes precedence over appDir', () => {
    const stageDir = join(tmpdir(), `verify-hal-stage-${Date.now()}`);
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, 'server.js'), 'const staged = true;');
    const ctx: GateContext = {
      config: { appDir } as VerifyConfig,
      edits: [],
      predicates: [{ type: 'hallucination', claim: 'staged', source: 'server.js', halAssert: 'grounded' }],
      stageDir,
      log: () => {},
    };
    const result = runHallucinationGate(ctx);
    expect(result.passed).toBe(true);
    rmSync(stageDir, { recursive: true, force: true });
  });

  test('route claim with method check', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: '/health', source: 'routes', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('table existence check', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users table exists', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('nonexistent table is correctly fabricated', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'orders table exists', source: 'schema', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('dot notation column check (users.email)', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users.email', source: 'schema', halAssert: 'grounded' },
    ]));
    expect(result.passed).toBe(true);
  });

  test('dot notation fabricated column (users.phone)', () => {
    const result = runHallucinationGate(makeCtx([
      { type: 'hallucination', claim: 'users.phone', source: 'schema', halAssert: 'fabricated' },
    ]));
    expect(result.passed).toBe(true);
  });
});
