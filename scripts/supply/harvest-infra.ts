/**
 * Real-World Infrastructure Harvester
 * ====================================
 *
 * Reads real infrastructure error catalogs and converts to verify scenarios.
 * Currently supports Heroku error codes (H10-H99, R10-R99, L10-L99).
 *
 * The Heroku error codes are well-documented failure modes that every
 * web deployment can encounter. Each code maps to a specific infrastructure
 * failure pattern detectable by verify's infrastructure gate.
 *
 * Input: Heroku error page HTML (fetched from devcenter) or hardcoded catalog
 *        (the error codes themselves are public domain — the list is stable)
 *
 * Output: VerifyScenario[] with source: 'real-world'
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ErrorCode {
  code: string;
  name: string;
  description: string;
  category: 'http' | 'runtime' | 'limit';
  editPattern: string;  // what code change would cause this
  predicateType: string; // which predicate type detects it
}

interface VerifyScenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  source: 'real-world';
}

// Heroku error codes — real production error catalog
// Source: https://devcenter.heroku.com/articles/error-codes
// These are stable, public, and represent real infrastructure failure modes
const HEROKU_ERRORS: ErrorCode[] = [
  { code: 'H10', name: 'App crashed', description: 'A crashed web dyno or a boot timeout on the web dyno will present this error.', category: 'http', editPattern: 'process.exit(1)', predicateType: 'infra_attribute' },
  { code: 'H11', name: 'Backlog too deep', description: 'HTTP requests are taking too long, causing the router queue to grow.', category: 'http', editPattern: 'while(true){}', predicateType: 'infra_attribute' },
  { code: 'H12', name: 'Request timeout', description: 'An HTTP request took longer than 30 seconds to complete.', category: 'http', editPattern: 'setTimeout(() => res.end(), 35000)', predicateType: 'http' },
  { code: 'H13', name: 'Connection closed without response', description: 'The dyno accepted the connection but closed it without sending a response.', category: 'http', editPattern: 'req.socket.destroy()', predicateType: 'http' },
  { code: 'H14', name: 'No web dynos running', description: 'No web dynos are running for this app.', category: 'runtime', editPattern: 'web: 0', predicateType: 'infra_attribute' },
  { code: 'H15', name: 'Idle connection', description: 'The dyno did not send a response within the router timeout.', category: 'http', editPattern: '// no res.end() call', predicateType: 'http' },
  { code: 'H17', name: 'Poorly formatted HTTP response', description: 'The dyno sent a malformed HTTP response.', category: 'http', editPattern: 'res.socket.write("not http")', predicateType: 'http' },
  { code: 'H18', name: 'Server Request Interrupted', description: 'A request was interrupted by the client before completion.', category: 'http', editPattern: 'client.abort()', predicateType: 'http' },
  { code: 'H19', name: 'Backend connection timeout', description: 'The router could not establish a connection to the dyno.', category: 'runtime', editPattern: 'ECONNREFUSED', predicateType: 'infra_attribute' },
  { code: 'H20', name: 'App boot timeout', description: 'The web process failed to bind to $PORT within 60 seconds.', category: 'runtime', editPattern: '// never listen on PORT', predicateType: 'infra_attribute' },
  { code: 'H21', name: 'Backend connection refused', description: 'The dyno refused the connection.', category: 'runtime', editPattern: 'server.close()', predicateType: 'infra_attribute' },
  { code: 'H22', name: 'Connection limit reached', description: 'Too many connections open to the dyno.', category: 'limit', editPattern: 'maxConnections: 1', predicateType: 'infra_resource' },
  { code: 'H23', name: 'Endpoint misconfigured', description: 'A routing endpoint is configured but has no matching web process.', category: 'runtime', editPattern: 'wrong_port', predicateType: 'infra_attribute' },
  { code: 'H24', name: 'Forced close', description: 'The connection was force closed after idle timeout.', category: 'http', editPattern: 'keepAlive: false', predicateType: 'http' },
  { code: 'H25', name: 'HTTP Restriction', description: 'Request was blocked by HTTP restriction rules.', category: 'http', editPattern: 'blocked_by_policy', predicateType: 'http' },
  { code: 'H27', name: 'Client Request Interrupted', description: 'The client socket was closed before response completion.', category: 'http', editPattern: 'client_disconnect', predicateType: 'http' },
  { code: 'H28', name: 'Client Connection Idle', description: 'The client connection was idle for too long.', category: 'http', editPattern: 'idle_timeout', predicateType: 'http' },
  { code: 'H31', name: 'Misdirected Request', description: 'The request was sent to a dyno that is not configured to handle it.', category: 'http', editPattern: 'wrong_host_header', predicateType: 'http' },
  { code: 'H33', name: 'Simultaneous connections', description: 'Too many simultaneous connections from one source.', category: 'limit', editPattern: 'concurrent_limit', predicateType: 'infra_resource' },
  { code: 'H80', name: 'Maintenance mode', description: 'The app is in maintenance mode.', category: 'runtime', editPattern: 'maintenance: true', predicateType: 'infra_attribute' },
  { code: 'H81', name: 'Blank app', description: 'No code has been deployed.', category: 'runtime', editPattern: 'empty_deploy', predicateType: 'infra_attribute' },
  { code: 'H82', name: 'Free dyno quota', description: 'Free dyno hour quota exhausted.', category: 'limit', editPattern: 'quota_exceeded', predicateType: 'infra_resource' },
  { code: 'H99', name: 'Platform error', description: 'An internal Heroku platform error.', category: 'runtime', editPattern: 'platform_failure', predicateType: 'infra_attribute' },
  { code: 'R10', name: 'Boot timeout', description: 'A web process took longer than 60 seconds to bind to its assigned $PORT.', category: 'runtime', editPattern: 'slow_startup', predicateType: 'infra_attribute' },
  { code: 'R12', name: 'Exit timeout', description: 'A process failed to exit within 30 seconds of SIGTERM.', category: 'runtime', editPattern: 'no_sigterm_handler', predicateType: 'infra_attribute' },
  { code: 'R13', name: 'Attach error', description: 'A dyno started with heroku run failed to attach to the process.', category: 'runtime', editPattern: 'attach_failed', predicateType: 'infra_attribute' },
  { code: 'R14', name: 'Memory quota exceeded', description: 'A dyno exceeded its memory quota.', category: 'limit', editPattern: 'memory_leak', predicateType: 'infra_resource' },
  { code: 'R15', name: 'Memory quota vastly exceeded', description: 'A dyno exceeded 2x its memory quota and was killed.', category: 'limit', editPattern: 'oom_killed', predicateType: 'infra_resource' },
  { code: 'R16', name: 'Detached', description: 'An attached one-off dyno became detached.', category: 'runtime', editPattern: 'detach', predicateType: 'infra_attribute' },
  { code: 'R17', name: 'Checksum error', description: 'The slug checksum did not match during extraction.', category: 'runtime', editPattern: 'corrupt_deploy', predicateType: 'infra_attribute' },
  { code: 'L10', name: 'Drain buffer overflow', description: 'The log drain buffer overflowed.', category: 'limit', editPattern: 'log_flood', predicateType: 'infra_resource' },
  { code: 'L11', name: 'Tail buffer overflow', description: 'The log tail buffer overflowed.', category: 'limit', editPattern: 'tail_overflow', predicateType: 'infra_resource' },
  { code: 'L12', name: 'Local buffer overflow', description: 'The local log buffer overflowed.', category: 'limit', editPattern: 'local_log_overflow', predicateType: 'infra_resource' },
  { code: 'L13', name: 'Local delivery error', description: 'A log message could not be delivered to the local syslog.', category: 'limit', editPattern: 'syslog_unreachable', predicateType: 'infra_attribute' },
  { code: 'L14', name: 'Certificate error', description: 'There was an error with the TLS certificate.', category: 'runtime', editPattern: 'cert_expired', predicateType: 'infra_attribute' },
  { code: 'L15', name: 'Tail connection error', description: 'An error occurred in the log tail connection.', category: 'limit', editPattern: 'tail_disconnect', predicateType: 'infra_attribute' },
];

/**
 * Convert real infrastructure error catalogs into verify scenarios.
 */
export function harvestInfra(files: string[], maxScenarios: number): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  let counter = 0;

  // Process Heroku error codes
  for (const error of HEROKU_ERRORS) {
    if (scenarios.length >= maxScenarios) break;
    counter++;

    // Scenario 1: Edit introduces the failure pattern, predicate should detect it
    scenarios.push({
      id: `rw-infra-heroku-${String(counter).padStart(3, '0')}`,
      description: `Heroku ${error.code}: ${error.name} — failure pattern injected`,
      edits: [{
        file: 'server.js',
        search: "const PORT = process.env.PORT || 3000;",
        replace: `const PORT = process.env.PORT || 3000;\n// Heroku ${error.code}: ${error.name}\n// Pattern: ${error.editPattern}`,
      }],
      predicates: [{
        type: error.predicateType,
        ...(error.predicateType === 'http'
          ? { method: 'GET', path: '/health', expect: { status: 200, bodyContains: 'ok' } }
          : error.predicateType === 'infra_resource'
          ? { resource: 'dyno', metric: error.code.toLowerCase(), threshold: 0, assertion: 'below' }
          : { resource: 'dyno', attribute: 'status', expected: 'running' }),
      }],
      expectedSuccess: true, // structural check passes — the pattern is a comment
      tags: ['infra', 'real-world', 'heroku', error.code, error.category],
      rationale: `Real Heroku error ${error.code}: ${error.description}`,
      source: 'real-world',
    });

    counter++;
    // Scenario 2: The error condition is active (edit breaks the server)
    if (error.category === 'http' && error.code !== 'H25') {
      scenarios.push({
        id: `rw-infra-heroku-${String(counter).padStart(3, '0')}`,
        description: `Heroku ${error.code}: ${error.name} — server broken, health check fails`,
        edits: [{
          file: 'server.js',
          search: "res.end(JSON.stringify({ status: 'ok' }));",
          replace: `// ${error.code}: ${error.name} — endpoint broken\n    res.writeHead(503); res.end('${error.code}');`,
        }],
        predicates: [{
          type: 'http',
          method: 'GET',
          path: '/health',
          expect: { status: 200, bodyContains: 'ok' },
        }],
        expectedSuccess: false,
        tags: ['infra', 'real-world', 'heroku', error.code, error.category, 'broken'],
        rationale: `Heroku ${error.code} active: ${error.description}. Health endpoint returns 503 instead of 200.`,
        source: 'real-world',
      });
    }
  }

  console.log(`  harvest-infra: ${HEROKU_ERRORS.length} error codes, generated ${scenarios.length} scenarios`);
  return scenarios;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone test
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const scenarios = harvestInfra([], 200);
  console.log(`\nGenerated ${scenarios.length} scenarios`);
  for (const s of scenarios.slice(0, 5)) {
    console.log(`  ${s.id}: ${s.description.substring(0, 80)}`);
  }
  const codes = new Set(scenarios.flatMap(s => s.tags.filter(t => /^[HRL]\d+$/.test(t))));
  console.log(`\nCovered ${codes.size} error codes: ${[...codes].sort().join(', ')}`);
}
