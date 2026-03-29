#!/usr/bin/env bun
/**
 * stage-invariant-advanced.ts — Invariant Advanced Scenario Stager
 *
 * Shapes: INV-02, INV-03, INV-05, INV-06, INV-10 through INV-14
 *   INV-02: Health endpoint returns wrong status
 *   INV-03: Health endpoint returns wrong body
 *   INV-05: Database connectivity check fails
 *   INV-06: Container not running after deploy
 *   INV-10: Disk space below threshold
 *   INV-11: Memory usage above threshold
 *   INV-12: CPU load above threshold
 *   INV-13: Open file descriptor limit
 *   INV-14: Network connectivity lost
 *
 * Run: bun scripts/harvest/stage-invariant-advanced.ts
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
  rationale: string;
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `inv-${prefix}-${String(++counter).padStart(3, '0')}`;
}

function push(
  prefix: string,
  desc: string,
  edits: Scenario['edits'],
  predicates: Scenario['predicates'],
  success: boolean,
  tags: string[],
  rationale: string,
  failedGate?: string,
) {
  const entry: Scenario = {
    id: nextId(prefix),
    description: desc,
    edits,
    predicates,
    expectedSuccess: success,
    tags: ['invariant-advanced', ...tags],
    rationale,
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// =============================================================================
// INV-02: Health endpoint returns wrong status
// The /health endpoint exists but returns a non-200 status code.
// =============================================================================

push('inv02', 'INV-02: Health endpoint returns 200 — control passes',
  [],
  [{ type: 'http', path: '/health', expect: { status: 200 } }],
  true,
  ['health-status', 'INV-02'],
  'Control: /health returns 200 in the demo-app. HTTP predicate matches.',
);

push('inv02', 'INV-02: Health returns 503 after edit — wrong status',
  [{
    file: 'server.js',
    search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.writeHead(503, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'degraded' }));",
  }],
  [{ type: 'http', path: '/health', expect: { status: 200 } }],
  false,
  ['health-status', 'INV-02'],
  'Edit changes health endpoint to return 503. HTTP predicate expects 200, gets 503.',
  'verify',
);

push('inv02', 'INV-02: Health returns 500 — server error status',
  [{
    file: 'server.js',
    search: "res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.writeHead(500, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({ error: 'internal' }));",
  }],
  [{ type: 'http', path: '/health', expect: { status: 200 } }],
  false,
  ['health-status', 'INV-02'],
  'Health endpoint returns 500 instead of 200. Invariant check detects server error.',
  'verify',
);

// =============================================================================
// INV-03: Health endpoint returns wrong body
// Status is 200 but the response body is unexpected.
// =============================================================================

push('inv03', 'INV-03: Health body contains "ok" — control passes',
  [],
  [{ type: 'http', path: '/health', expect: { status: 200, bodyContains: 'ok' } }],
  true,
  ['health-body', 'INV-03'],
  'Control: /health returns {"status":"ok"}. Body contains "ok".',
);

push('inv03', 'INV-03: Health body changed to "maintenance" — mismatch',
  [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.end(JSON.stringify({ status: 'maintenance', message: 'scheduled downtime' }));",
  }],
  [{ type: 'http', path: '/health', expect: { status: 200, bodyContains: '"status":"ok"' } }],
  false,
  ['health-body', 'INV-03'],
  'Health body now says "maintenance" instead of "ok". Body content predicate fails.',
  'verify',
);

push('inv03', 'INV-03: Health body empty object — missing expected fields',
  [{
    file: 'server.js',
    search: "res.end(JSON.stringify({ status: 'ok' }));",
    replace: "res.end(JSON.stringify({}));",
  }],
  [{ type: 'http', path: '/health', expect: { status: 200, bodyContains: 'status' } }],
  false,
  ['health-body', 'INV-03'],
  'Health returns empty object {}. The "status" field is missing from the body.',
  'verify',
);

// =============================================================================
// INV-05: Database connectivity check fails
// The application cannot connect to its database. DB predicates fail.
// =============================================================================

push('inv05', 'INV-05: DB schema has users table — control passes',
  [],
  [{ type: 'db', table: 'users', assertion: 'table_exists' }],
  true,
  ['db-connectivity', 'INV-05'],
  'Control: init.sql defines the users table. DB predicate verifies table existence.',
);

push('inv05', 'INV-05: DB predicate for non-existent table — fails',
  [],
  [{ type: 'db', table: 'payments', assertion: 'table_exists' }],
  false,
  ['db-connectivity', 'INV-05'],
  'No payments table in init.sql. DB predicate for table_exists fails.',
  'grounding',
);

push('inv05', 'INV-05: DB table removed via edit — table_exists fails',
  [{
    file: 'init.sql',
    search: "CREATE TABLE settings (\n    key VARCHAR(100) PRIMARY KEY,\n    value JSONB NOT NULL,\n    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);",
    replace: '-- settings table removed',
  }],
  [{ type: 'db', table: 'settings', assertion: 'table_exists' }],
  false,
  ['db-connectivity', 'INV-05'],
  'Settings table removed from init.sql. DB predicate for table_exists fails.',
  'grounding',
);

// =============================================================================
// INV-06: Container not running after deploy
// The container should be running and responding. Content predicates on
// docker-compose or Dockerfile verify container configuration.
// =============================================================================

push('inv06', 'INV-06: docker-compose has healthcheck — control passes',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'healthcheck' }],
  true,
  ['container-running', 'INV-06'],
  'Control: docker-compose.yml includes healthcheck config. Container monitoring is configured.',
);

push('inv06', 'INV-06: Dockerfile healthcheck removed — missing safety net',
  [{
    file: 'Dockerfile',
    search: 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O- http://localhost:3000/health || exit 1',
    replace: '# HEALTHCHECK removed',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'HEALTHCHECK' }],
  false,
  ['container-running', 'INV-06'],
  'Dockerfile HEALTHCHECK directive removed. Container has no built-in health monitoring.',
  'grounding',
);

push('inv06', 'INV-06: CMD changed to wrong entrypoint — container will crash',
  [{
    file: 'Dockerfile',
    search: 'CMD ["node", "server.js"]',
    replace: 'CMD ["node", "nonexistent.js"]',
  }],
  [{ type: 'content', file: 'Dockerfile', pattern: 'CMD ["node", "server.js"]' }],
  false,
  ['container-running', 'INV-06'],
  'Dockerfile CMD points to nonexistent.js. Container will fail to start.',
  'grounding',
);

// =============================================================================
// INV-10: Disk space below threshold
// Infrastructure checks for disk usage. Content predicates verify that
// docker-compose or config includes resource limits.
// =============================================================================

push('inv10', 'INV-10: Docker log rotation config in docker-compose — control',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "3"',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'max-size: "10m"' }],
  true,
  ['disk-space', 'INV-10'],
  'Docker log rotation configured to prevent disk fill. Content predicate verifies limit.',
);

push('inv10', 'INV-10: No log rotation configured — disk risk',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'max-size' }],
  false,
  ['disk-space', 'INV-10'],
  'No log rotation in docker-compose.yml. No max-size limit, risk of disk fill.',
  'grounding',
);

// =============================================================================
// INV-11: Memory usage above threshold
// Container memory limits should be configured to prevent OOM.
// =============================================================================

push('inv11', 'INV-11: Memory limit configured — control passes',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    deploy:\n      resources:\n        limits:\n          memory: 512M',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'memory: 512M' }],
  true,
  ['memory-threshold', 'INV-11'],
  'Memory limit added to docker-compose. Content predicate verifies the limit is present.',
);

push('inv11', 'INV-11: No memory limit — OOM risk',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'memory:' }],
  false,
  ['memory-threshold', 'INV-11'],
  'No memory limit in docker-compose.yml. Container can consume unlimited memory.',
  'grounding',
);

push('inv11', 'INV-11: Memory limit too high — effectively unconstrained',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    deploy:\n      resources:\n        limits:\n          memory: 64G',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'memory: 64G' }],
  true,
  ['memory-threshold', 'INV-11'],
  'Memory limit of 64G is technically present but impractically high. Content predicate still matches.',
);

// =============================================================================
// INV-12: CPU load above threshold
// CPU limits prevent container from starving the host.
// =============================================================================

push('inv12', 'INV-12: CPU limit configured — control passes',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    deploy:\n      resources:\n        limits:\n          cpus: "1.0"',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'cpus: "1.0"' }],
  true,
  ['cpu-threshold', 'INV-12'],
  'CPU limit added. Content predicate verifies the CPU limit string.',
);

push('inv12', 'INV-12: No CPU limit — host starvation risk',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'cpus:' }],
  false,
  ['cpu-threshold', 'INV-12'],
  'No CPU limit in docker-compose.yml. Container can consume all host CPU.',
  'grounding',
);

// =============================================================================
// INV-13: Open file descriptor limit
// ulimits configuration prevents file descriptor exhaustion.
// =============================================================================

push('inv13', 'INV-13: ulimits configured — control passes',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    ulimits:\n      nofile:\n        soft: 65536\n        hard: 65536',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'nofile:' }],
  true,
  ['fd-limit', 'INV-13'],
  'ulimits for file descriptors configured. Content predicate verifies nofile setting.',
);

push('inv13', 'INV-13: No ulimits — default FD limit',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'ulimits' }],
  false,
  ['fd-limit', 'INV-13'],
  'No ulimits in docker-compose.yml. Container uses OS default which may be too low.',
  'grounding',
);

push('inv13', 'INV-13: ulimits with memlock — different limit type',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    ulimits:\n      memlock:\n        soft: -1\n        hard: -1',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'memlock:' }],
  true,
  ['fd-limit', 'INV-13'],
  'memlock ulimit configured (different from nofile). Content predicate matches.',
);

// =============================================================================
// INV-14: Network connectivity lost
// Container network configuration and DNS settings.
// =============================================================================

push('inv14', 'INV-14: docker-compose has port mapping — network accessible',
  [],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'ports:' }],
  true,
  ['network', 'INV-14'],
  'Control: docker-compose.yml has port mapping. Container is network accessible.',
);

push('inv14', 'INV-14: Port mapping removed — container isolated',
  [{
    file: 'docker-compose.yml',
    search: '    ports:\n      - "${VERIFY_HOST_PORT:-3000}:3000"',
    replace: '    # ports removed — internal only',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'ports:' }],
  false,
  ['network', 'INV-14'],
  'Port mapping removed from docker-compose. Container has no external network access.',
  'grounding',
);

push('inv14', 'INV-14: Custom network added — explicit network config',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    networks:\n      - app-net\nnetworks:\n  app-net:\n    driver: bridge',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'app-net' }],
  true,
  ['network', 'INV-14'],
  'Custom Docker network configured. Content predicate verifies network name exists.',
);

push('inv14', 'INV-14: DNS config in docker-compose — DNS override',
  [{
    file: 'docker-compose.yml',
    search: '      retries: 3',
    replace: '      retries: 3\n    dns:\n      - 8.8.8.8\n      - 8.8.4.4',
  }],
  [{ type: 'content', file: 'docker-compose.yml', pattern: 'dns:' }],
  true,
  ['network', 'INV-14'],
  'Explicit DNS servers configured. Content predicate verifies DNS configuration exists.',
);

// =============================================================================
// Write output
// =============================================================================

const outPath = resolve(__dirname, '../../fixtures/scenarios/invariant-advanced-staged.json');
writeFileSync(outPath, JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);
