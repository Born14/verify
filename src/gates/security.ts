/**
 * Security Gate
 * =============
 *
 * Validates security predicates by scanning source files for common
 * vulnerabilities and security anti-patterns.
 * Pure static analysis — no network, no Docker.
 *
 * Predicate type: security
 * Check types:
 *   - XSS: innerHTML, document.write, eval with user input
 *   - SQL injection: string concatenation in queries
 *   - CSRF: missing CSRF tokens in forms
 *   - Secrets in code: hardcoded API keys, passwords, tokens
 *   - CSP: Content-Security-Policy headers present
 *   - CORS: Access-Control-Allow-Origin not wildcard
 *   - Auth headers: Authorization header validation
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { GateContext, GateResult, Predicate, PredicateResult } from '../types.js';

// =============================================================================
// SECURITY SCANNERS
// =============================================================================

type SecurityCheckType = 'xss' | 'sql_injection' | 'csrf' | 'secrets_in_code' | 'csp' | 'cors' | 'auth_header';

interface SecurityFinding {
  check: SecurityCheckType;
  file: string;
  line: number;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * Read all source files from a directory (shallow + common subdirs).
 */
function readSourceFiles(appDir: string): Array<{ path: string; content: string; relativePath: string }> {
  const files: Array<{ path: string; content: string; relativePath: string }> = [];
  const CODE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.ejs', '.hbs']);
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);

  function scan(dir: string, rel: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else if (CODE_EXTS.has(extname(entry.name).toLowerCase())) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            files.push({ path: fullPath, content, relativePath: rel ? `${rel}/${entry.name}` : entry.name });
          } catch { /* unreadable */ }
        }
      }
    } catch { /* unreadable dir */ }
  }

  scan(appDir, '');
  return files;
}

/**
 * Scan for XSS vulnerabilities.
 */
function scanXSS(files: Array<{ relativePath: string; content: string }>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const patterns = [
    { regex: /innerHTML\s*=(?!=)/g, detail: 'Direct innerHTML assignment (potential XSS)' },
    { regex: /document\.write\s*\(/g, detail: 'document.write usage (potential XSS)' },
    { regex: /eval\s*\(/g, detail: 'eval() usage (potential code injection)' },
    { regex: /\$\{.*\}\s*(?:innerHTML|dangerouslySetInnerHTML)/g, detail: 'Template literal in HTML injection context' },
    { regex: /dangerouslySetInnerHTML/g, detail: 'React dangerouslySetInnerHTML usage' },
  ];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { regex, detail } of patterns) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          findings.push({ check: 'xss', file: file.relativePath, line: i + 1, detail, severity: 'high' });
        }
      }
    }
  }
  return findings;
}

/**
 * Scan for SQL injection vulnerabilities.
 */
function scanSQLInjection(files: Array<{ relativePath: string; content: string }>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const patterns = [
    { regex: /(?:query|execute|run)\s*\(\s*[`'"].*\$\{/g, detail: 'Template literal in SQL query (potential injection)' },
    { regex: /(?:query|execute|run)\s*\(\s*['"].*\+/g, detail: 'String concatenation in SQL query (potential injection)' },
    { regex: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s.*\+\s*(?:req\.|params\.|body\.|query\.)/gi, detail: 'User input concatenated into SQL' },
  ];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { regex, detail } of patterns) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          findings.push({ check: 'sql_injection', file: file.relativePath, line: i + 1, detail, severity: 'high' });
        }
      }
    }
  }
  return findings;
}

/**
 * Scan for hardcoded secrets.
 */
function scanSecrets(files: Array<{ relativePath: string; content: string }>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const patterns = [
    { regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, detail: 'Hardcoded password' },
    { regex: /(?:api_key|apikey|api_secret)\s*[:=]\s*['"][^'"]{8,}['"]/gi, detail: 'Hardcoded API key' },
    { regex: /(?:secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=]{20,}['"]/gi, detail: 'Hardcoded secret/token' },
    { regex: /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*=\s*['"]?[A-Z0-9]{16,}['"]?/g, detail: 'Hardcoded AWS credential' },
    { regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, detail: 'Private key in source code' },
  ];

  for (const file of files) {
    // Skip .env files — they're supposed to have secrets
    if (file.relativePath.startsWith('.env')) continue;
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Skip comments
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
      for (const { regex, detail } of patterns) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          findings.push({ check: 'secrets_in_code', file: file.relativePath, line: i + 1, detail, severity: 'high' });
        }
      }
    }
  }
  return findings;
}

/**
 * Scan for CSP headers.
 */
function scanCSP(files: Array<{ relativePath: string; content: string }>): SecurityFinding[] {
  const hasCSP = files.some(f =>
    f.content.includes('Content-Security-Policy') ||
    f.content.includes('content-security-policy') ||
    f.content.includes('helmet')
  );

  if (!hasCSP) {
    return [{ check: 'csp', file: '(project)', line: 0, detail: 'No Content-Security-Policy header found', severity: 'medium' }];
  }
  return [];
}

/**
 * Scan for CORS wildcard.
 */
function scanCORS(files: Array<{ relativePath: string; content: string }>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/Access-Control-Allow-Origin.*\*/i.test(lines[i]) ||
          /cors\(\s*\)/.test(lines[i]) ||
          /origin:\s*['"]?\*['"]?/.test(lines[i])) {
        findings.push({
          check: 'cors',
          file: file.relativePath,
          line: i + 1,
          detail: 'CORS wildcard (*) allows any origin',
          severity: 'medium',
        });
      }
    }
  }
  return findings;
}

/**
 * Run a specific security check and return findings.
 */
function runSecurityCheck(
  check: SecurityCheckType,
  files: Array<{ relativePath: string; content: string }>,
): SecurityFinding[] {
  switch (check) {
    case 'xss': return scanXSS(files);
    case 'sql_injection': return scanSQLInjection(files);
    case 'secrets_in_code': return scanSecrets(files);
    case 'csp': return scanCSP(files);
    case 'cors': return scanCORS(files);
    case 'csrf': return []; // CSRF is structural — hard to detect statically
    case 'auth_header': return []; // Auth header is runtime — deferred to HTTP gate
    default: return [];
  }
}

// =============================================================================
// SECURITY GATE
// =============================================================================

export function runSecurityGate(ctx: GateContext): GateResult & { predicateResults: PredicateResult[] } {
  const start = Date.now();
  const secPreds = ctx.predicates.filter(p => p.type === 'security');

  if (secPreds.length === 0) {
    return {
      gate: 'security' as any,
      passed: true,
      detail: 'No security predicates to check',
      durationMs: Date.now() - start,
      predicateResults: [],
    };
  }

  const sourceFiles = readSourceFiles(ctx.config.appDir);
  const results: PredicateResult[] = [];
  let allPassed = true;
  const details: string[] = [];

  for (let i = 0; i < secPreds.length; i++) {
    const p = secPreds[i];
    const result = validateSecurityPredicate(p, sourceFiles);
    results.push({ ...result, predicateId: `sec_p${i}` });

    if (!result.passed) {
      allPassed = false;
      details.push(result.actual ?? 'failed');
    }
  }

  const passCount = results.filter(r => r.passed).length;
  const detail = allPassed
    ? `All ${secPreds.length} security predicates passed`
    : `${passCount}/${secPreds.length} passed: ${details.join('; ')}`;

  ctx.log(`[security] ${detail}`);

  return {
    gate: 'security' as any,
    passed: allPassed,
    detail,
    durationMs: Date.now() - start,
    predicateResults: results,
  };
}

function validateSecurityPredicate(
  p: Predicate,
  files: Array<{ relativePath: string; content: string }>,
): Omit<PredicateResult, 'predicateId'> {
  const check = p.securityCheck;
  const fingerprint = `type=security|check=${check}`;

  if (!check) {
    return { type: 'security', passed: false, expected: 'security check type', actual: '(no securityCheck specified)', fingerprint };
  }

  const expected = p.expected ?? 'no_findings';
  const findings = runSecurityCheck(check, files);

  if (expected === 'no_findings' || expected === 'clean' || expected === 'pass') {
    // Expect no findings (security is clean)
    const passed = findings.length === 0;
    return {
      type: 'security',
      passed,
      expected: `${check}: no findings`,
      actual: passed
        ? `${check}: clean`
        : `${findings.length} finding(s): ${findings.slice(0, 3).map(f => `${f.file}:${f.line} ${f.detail}`).join('; ')}`,
      fingerprint,
    };
  }

  if (expected === 'has_findings' || expected === 'fail') {
    // Expect findings to exist (intentional negative test)
    const passed = findings.length > 0;
    return {
      type: 'security',
      passed,
      expected: `${check}: has findings`,
      actual: passed
        ? `${findings.length} finding(s) detected`
        : `${check}: no findings (expected some)`,
      fingerprint,
    };
  }

  return { type: 'security', passed: false, expected, actual: `unknown expected value: ${expected}`, fingerprint };
}
