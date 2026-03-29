#!/usr/bin/env bun
/**
 * stage-security-advanced.ts — Security Advanced Scenario Stager
 *
 * Covers zero-coverage security shapes from FAILURE-TAXONOMY.md:
 *   SEC-02: SQL injection via string concatenation
 *   SEC-03: Open redirect via user-supplied URL
 *   SEC-06: Secret leaked in response body
 *   SEC-07: Missing rate limit on sensitive endpoint
 *
 * Pure tier — tests security gate with pattern-based detection.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/security-advanced-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `sec-adv-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// SEC-02: SQL injection via string concatenation
// =============================================================================

push({
  description: 'SEC-02: SQL injection check — source has string concat query',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `const q = "SELECT * FROM users WHERE id = " + req.url.split('=')[1];
    res.end(JSON.stringify({ status: 'ok' }));`,
  }],
  predicates: [{
    type: 'security',
    securityCheck: 'sql_injection',
    file: 'server.js',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'sql_injection', 'SEC-02'],
});

push({
  description: 'SEC-02: No SQL injection — parameterized query',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `const q = "SELECT * FROM users WHERE id = $1";
    res.end(JSON.stringify({ status: 'ok' }));`,
  }],
  predicates: [{
    type: 'security',
    securityCheck: 'sql_injection',
    file: 'server.js',
  }],
  expectedSuccess: true,
  tags: ['security', 'sql_injection', 'SEC-02'],
});

push({
  description: 'SEC-02: SQL injection with template literal',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: 'const q = `SELECT * FROM users WHERE name = \'${userInput}\'`;\n    res.end(JSON.stringify({ status: \'ok\' }));',
  }],
  predicates: [{
    type: 'security',
    securityCheck: 'sql_injection',
    file: 'server.js',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'sql_injection', 'SEC-02'],
});

// =============================================================================
// SEC-03: Open redirect via user-supplied URL
// =============================================================================

push({
  description: 'SEC-03: Open redirect pattern — user input in redirect',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `const redirectUrl = req.url.split('redirect=')[1];
    res.writeHead(302, { Location: redirectUrl });
    res.end(JSON.stringify({ status: 'ok' }));`,
  }],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'redirect',
  }],
  expectedSuccess: true,
  tags: ['security', 'open_redirect', 'SEC-03'],
});

push({
  description: 'SEC-03: Safe redirect — hardcoded URL',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `res.writeHead(302, { Location: '/dashboard' });
    res.end(JSON.stringify({ status: 'ok' }));`,
  }],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: '/dashboard',
  }],
  expectedSuccess: true,
  tags: ['security', 'open_redirect', 'SEC-03'],
});

push({
  description: 'SEC-03: Redirect URL claim — pattern not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'res.redirect(req.query.returnUrl)',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'open_redirect', 'SEC-03'],
});

// =============================================================================
// SEC-06: Secret leaked in response body
// =============================================================================

push({
  description: 'SEC-06: Secrets check — API key in response template',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `res.end(JSON.stringify({ status: 'ok', apiKey: 'sk-live-abc123def456' }));`,
  }],
  predicates: [{
    type: 'security',
    securityCheck: 'secrets_in_code',
    file: 'server.js',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'secret_leaked', 'SEC-06'],
});

push({
  description: 'SEC-06: No secrets in response — clean code',
  edits: [],
  predicates: [{
    type: 'security',
    securityCheck: 'secrets_in_code',
    file: 'server.js',
  }],
  expectedSuccess: true,
  tags: ['security', 'secret_leaked', 'SEC-06'],
});

push({
  description: 'SEC-06: AWS key leaked in HTTP response — fabricated claim',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'AKIAIOSFODNN7EXAMPLE' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'secret_leaked', 'SEC-06'],
});

// =============================================================================
// SEC-07: Missing rate limit on sensitive endpoint
// =============================================================================

push({
  description: 'SEC-07: Auth endpoint exists — content check passes',
  edits: [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: `// Auth endpoint without rate limiting
    if (url.pathname === '/auth/login') {
      res.end(JSON.stringify({ token: 'abc' }));
      return;
    }
    res.end(JSON.stringify({ status: 'ok' }));`,
  }],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: '/auth/login',
  }],
  expectedSuccess: true,
  tags: ['security', 'missing_rate_limit', 'SEC-07'],
});

push({
  description: 'SEC-07: Rate limit middleware claim — not in source',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'missing_rate_limit', 'SEC-07'],
});

push({
  description: 'SEC-07: Rate limit response claim — fabricated',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'POST',
    path: '/api/echo',
    expect: { status: 429, bodyContains: 'Too many requests' },
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'missing_rate_limit', 'SEC-07'],
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  const tag = s.tags[2] || s.tags[1] || 'unknown';
  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
}

console.log(`Generated ${scenarios.length} security advanced scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
