/**
 * Observation Gate — Observer Effect Detection
 * =============================================
 *
 * Detects when the act of VERIFYING or OBSERVING a system would CHANGE the
 * system being observed. The measurement disturbs the measured.
 *
 * This is Parity Grid failure class F (Observation) — the only failure class
 * where the verification pipeline itself is the threat, not the agent's edits.
 *
 * Four domains, each with distinct observer-effect patterns:
 *
 *   browser_observation    — rendering/layout checks that trigger reflows,
 *                            lazy-loads, or repaint side effects
 *   database_observation   — schema introspection that creates metadata,
 *                            SELECTs that fire triggers/audit logs,
 *                            connection probes that consume pool slots
 *   cli_observation        — health probes that restart processes,
 *                            log reads that trigger rotation,
 *                            status commands that inflate metrics
 *   config_observation     — config reads that trigger hot-reload via mtime,
 *                            env var access that triggers lazy initialization,
 *                            secret reads that generate audit trail entries
 *
 * Position in gate sequence: after Contention, before Filesystem.
 * Runs after F9 (edits applied). Pure filesystem reads — no Docker required.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import type { GateResult, GateContext, Edit } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type ObservationDomain =
  | 'browser_observation'
  | 'database_observation'
  | 'cli_observation'
  | 'config_observation';

export interface ObserverEffect {
  domain: ObservationDomain;
  severity: 'error' | 'warning';
  file: string;
  line: number;
  detail: string;
  /** What the code assumes about the observation */
  assumption: string;
  /** What actually happens (the side effect) */
  reality: string;
}

export interface ObservationGateResult extends GateResult {
  effects: ObserverEffect[];
}

// =============================================================================
// HELPERS
// =============================================================================

function safeRead(filePath: string): string | null {
  try { return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null; }
  catch { return null; }
}

const CODE_EXTS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);

interface SourceFile { relativePath: string; content: string; lines: string[] }

function collectSourceFiles(baseDir: string): SourceFile[] {
  const files: SourceFile[] = [];
  function scan(dir: string, rel: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else if (CODE_EXTS.has(extname(entry.name).toLowerCase())) {
          const relative = rel ? `${rel}/${entry.name}` : entry.name;
          const content = safeRead(fullPath);
          if (content && content.length < 500_000) {
            files.push({ relativePath: relative, content, lines: content.split('\n') });
          }
        }
      }
    } catch { /* unreadable dir */ }
  }
  scan(baseDir, '');
  return files;
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('#');
}

// =============================================================================
// DETECTOR 1: BROWSER OBSERVATION
// Rendering checks that trigger layout reflows, lazy-loads, or repaints.
// getComputedStyle forces layout recalc; getBoundingClientRect triggers reflow;
// scroll-into-view triggers lazy-load; screenshot capture forces repaint.
// =============================================================================

/** Patterns indicating browser observation that triggers side effects. */
const BROWSER_OBSERVE_PATTERNS: Array<{ regex: RegExp; effect: string }> = [
  // getComputedStyle forces layout recalculation
  { regex: /getComputedStyle\s*\(/,
    effect: 'getComputedStyle forces synchronous layout recalculation — changes rendering state' },
  // getBoundingClientRect triggers reflow
  { regex: /getBoundingClientRect\s*\(/,
    effect: 'getBoundingClientRect triggers reflow — changes layout engine state' },
  // scrollIntoView triggers lazy-load and intersection observers
  { regex: /scrollIntoView\s*\(/,
    effect: 'scrollIntoView triggers IntersectionObserver callbacks — may lazy-load content' },
  // offsetHeight/Width forces synchronous layout
  { regex: /\b(?:offsetHeight|offsetWidth|offsetTop|offsetLeft|clientHeight|clientWidth)\b/,
    effect: 'Reading offset/client dimensions forces synchronous layout — changes rendering state' },
  // Screenshot capture forces full repaint
  { regex: /screenshot\s*\(|captureScreenshot|toDataURL\s*\(/,
    effect: 'Screenshot capture forces full repaint cycle — changes GPU compositing state' },
  // window.getSelection forces layout for text measurement
  { regex: /getSelection\s*\(/,
    effect: 'getSelection forces layout for text measurement — changes rendering pipeline state' },
  // IntersectionObserver observe triggers entry computation
  { regex: /IntersectionObserver[^}]*\.observe\s*\(/,
    effect: 'Observing elements triggers initial entry computation — side effect on observe' },
  // MutationObserver with childList creates event overhead
  { regex: /MutationObserver[^}]*childList\s*:\s*true/,
    effect: 'MutationObserver with childList creates event processing overhead per DOM change' },
  // ResizeObserver triggers on observation start
  { regex: /ResizeObserver[^}]*\.observe\s*\(/,
    effect: 'ResizeObserver fires initial callback on observe — observation triggers measurement' },
];

/** Patterns indicating browser observation is side-effect-aware. */
const BROWSER_AWARE_PATTERNS = [
  /requestAnimationFrame\s*\(/, /requestIdleCallback\s*\(/,
  /will-change/, /contain:\s*layout/, /contain:\s*strict/,
  /transform:\s*translateZ/, /backface-visibility/,
  /\bdocument\.hidden\b/, /visibilitychange/,
];

function detectBrowserObservation(files: SourceFile[]): ObserverEffect[] {
  const effects: ObserverEffect[] = [];
  for (const file of files) {
    // Skip non-browser files (server-side code)
    if (file.relativePath.includes('server') && !file.relativePath.includes('client')) continue;

    const isAware = BROWSER_AWARE_PATTERNS.some(p => p.test(file.content));
    if (isAware) continue;

    for (let i = 0; i < file.lines.length; i++) {
      if (isComment(file.lines[i])) continue;
      for (const { regex, effect } of BROWSER_OBSERVE_PATTERNS) {
        if (regex.test(file.lines[i])) {
          effects.push({
            domain: 'browser_observation',
            severity: 'warning',
            file: file.relativePath,
            line: i + 1,
            detail: `Browser observation side effect at line ${i + 1}: ${effect}`,
            assumption: 'DOM measurement is side-effect-free',
            reality: effect,
          });
          break; // One effect per line
        }
      }
    }
  }
  return effects;
}

// =============================================================================
// DETECTOR 2: DATABASE OBSERVATION
// Schema introspection creating metadata, SELECTs firing triggers,
// connection probes consuming pool slots.
// =============================================================================

/** Patterns where reading DB state changes DB state. */
const DB_OBSERVE_PATTERNS: Array<{ regex: RegExp; effect: string }> = [
  // pg_stat_statements tracks every query including observation queries
  { regex: /pg_stat_statements/i,
    effect: 'pg_stat_statements tracks all queries — observation queries add tracking rows' },
  // EXPLAIN ANALYZE updates table statistics
  { regex: /EXPLAIN\s+ANALYZE/i,
    effect: 'EXPLAIN ANALYZE actually executes the query and updates table statistics' },
  // information_schema queries update pg_stat_user_tables
  { regex: /information_schema\.\w+/i,
    effect: 'information_schema queries update internal catalog statistics (pg_stat_user_tables)' },
  // SELECT with FOR UPDATE acquires row locks
  { regex: /SELECT\s+[^;]*FOR\s+UPDATE/i,
    effect: 'SELECT FOR UPDATE acquires row-level locks — observation blocks concurrent writes' },
  // SELECT with FOR SHARE acquires shared locks
  { regex: /SELECT\s+[^;]*FOR\s+SHARE/i,
    effect: 'SELECT FOR SHARE acquires shared locks — observation contends with exclusive locks' },
  // Trigger-based audit: any SELECT on audited table fires trigger
  { regex: /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+\w+\s+(?:BEFORE|AFTER)\s+(?:SELECT|INSERT|UPDATE|DELETE)/i,
    effect: 'Trigger fires on data access — observation itself generates audit/mutation events' },
  // pg_stat_activity — querying it is itself visible in pg_stat_activity
  { regex: /pg_stat_activity/i,
    effect: 'Querying pg_stat_activity creates a new entry — observing connections adds a connection' },
  // Connection pool metrics — each probe consumes a connection
  { regex: /(?:pool_size|max_connections|idle_connections)/i,
    effect: 'Checking connection count requires a connection — observer occupies a slot' },
  // Advisory locks — checking lock state may acquire transient locks
  { regex: /pg_advisory_lock|pg_try_advisory_lock/i,
    effect: 'Advisory lock queries may interact with lock state — observation may serialize' },
];

/** Patterns showing awareness of DB observation side effects. */
const DB_AWARE_PATTERNS = [
  /-- observation side effect/i, /-- observer effect/i,
  /SET\s+statement_timeout/i, /idle_in_transaction_session_timeout/i,
  /-- read-only transaction/i, /SET\s+TRANSACTION\s+READ\s+ONLY/i,
  /pg_stat_reset/i,
];

function detectDatabaseObservation(files: SourceFile[]): ObserverEffect[] {
  const effects: ObserverEffect[] = [];
  for (const file of files) {
    const isAware = DB_AWARE_PATTERNS.some(p => p.test(file.content));
    if (isAware) continue;

    for (let i = 0; i < file.lines.length; i++) {
      if (isComment(file.lines[i])) continue;
      for (const { regex, effect } of DB_OBSERVE_PATTERNS) {
        if (regex.test(file.lines[i])) {
          effects.push({
            domain: 'database_observation',
            severity: 'warning',
            file: file.relativePath,
            line: i + 1,
            detail: `Database observation side effect at line ${i + 1}: ${effect}`,
            assumption: 'Database read is side-effect-free',
            reality: effect,
          });
          break;
        }
      }
    }
  }
  return effects;
}

// =============================================================================
// DETECTOR 3: CLI/PROCESS OBSERVATION
// Health probes that restart processes, log reads that trigger rotation,
// status commands that inflate metrics/audit logs.
// =============================================================================

/** Patterns where running a diagnostic command changes system state. */
const CLI_OBSERVE_PATTERNS: Array<{ regex: RegExp; effect: string }> = [
  // Healthcheck with restart policy — failed probe triggers restart
  { regex: /healthcheck.*restart|restart.*healthcheck/i,
    effect: 'Healthcheck failure triggers container restart — observation can cause mutation' },
  // docker stats / docker ps overhead
  { regex: /docker\s+(?:stats|top|inspect)\b/i,
    effect: 'docker stats/top/inspect adds cgroup query overhead — changes container CPU metrics' },
  // wget/curl to health endpoint — creates HTTP request that generates logs
  { regex: /(?:wget|curl)\s+.*(?:\/health|\/status|\/ready|\/live)/i,
    effect: 'Health probe creates HTTP request → access log entry — observation inflates logs' },
  // Writing probe results to temp files
  { regex: /(?:wget|curl)\s+.*-[oO]\s+(?:\/tmp|\.\/tmp)/i,
    effect: 'Probe writes result to temp file — observation consumes disk space' },
  // systemctl status creates audit log entries
  { regex: /systemctl\s+(?:status|is-active|show)\b/i,
    effect: 'systemctl status creates D-Bus message + journal entry — observation inflates journal' },
  // journalctl reads may trigger log rotation
  { regex: /journalctl\b.*--rotate|--vacuum/i,
    effect: 'journalctl with rotation flags changes log state — observation triggers cleanup' },
  // df/du commands — disk check itself uses some I/O
  { regex: /\bdf\s+-[hHk]|\bdu\s+-[shHk]/,
    effect: 'Disk usage check traverses filesystem — changes atime and generates I/O load' },
  // Process listing adds to audit trail
  { regex: /\bps\s+aux|\btop\s+-b/,
    effect: 'Process listing adds to audit trail on systems with auditing enabled' },
  // Log read-and-clear pattern (consume on read)
  { regex: /readFileSync[^;]*log.*(?:truncate|unlink|writeFileSync.*'')|appendFileSync[^;]*healthcheck/i,
    effect: 'Log read-and-clear pattern — observation destroys the measurement data' },
  // Healthcheck with --interval creates periodic overhead
  { regex: /HEALTHCHECK\s+--interval/i,
    effect: 'Periodic healthcheck interval creates continuous observation overhead — CPU + network' },
];

/** Patterns showing awareness of CLI observation side effects. */
const CLI_AWARE_PATTERNS = [
  /logging:\s*{[^}]*max/i, /log.*rotation/i,
  /--quiet\b/, /--silent\b/, /-q\b/,
  /\/dev\/null/, /> \/dev\/null/,
  /no.?op\b|noop\b/i,
];

function detectCliObservation(files: SourceFile[]): ObserverEffect[] {
  const effects: ObserverEffect[] = [];
  for (const file of files) {
    const isAware = CLI_AWARE_PATTERNS.some(p => p.test(file.content));
    if (isAware) continue;

    for (let i = 0; i < file.lines.length; i++) {
      if (isComment(file.lines[i])) continue;
      for (const { regex, effect } of CLI_OBSERVE_PATTERNS) {
        if (regex.test(file.lines[i])) {
          effects.push({
            domain: 'cli_observation',
            severity: 'warning',
            file: file.relativePath,
            line: i + 1,
            detail: `CLI observation side effect at line ${i + 1}: ${effect}`,
            assumption: 'Diagnostic command is side-effect-free',
            reality: effect,
          });
          break;
        }
      }
    }
  }
  return effects;
}

// =============================================================================
// DETECTOR 4: CONFIG/STATE OBSERVATION
// Config reads that trigger hot-reload, env var access that triggers init,
// secret reads that generate audit entries.
// =============================================================================

/** Patterns where reading config changes system state. */
const CONFIG_OBSERVE_PATTERNS: Array<{ regex: RegExp; effect: string }> = [
  // fs.watch / chokidar on config files — read triggers watcher
  { regex: /(?:fs\.watch|chokidar\.watch|watchFile)\s*\([^)]*(?:config|\.env|settings)/i,
    effect: 'File watcher on config — reading/touching config file triggers hot reload' },
  // Lazy initialization on first env var read
  { regex: /process\.env\.\w+[^;]*\|\||process\.env\.\w+[^;]*\?\?/,
    effect: 'Env var read with fallback suggests lazy initialization — first read may trigger setup' },
  // dotenv.config() — loading env triggers initialization
  { regex: /dotenv\.config\s*\(|require\s*\(\s*['"]dotenv['"]\s*\)\.config/,
    effect: 'dotenv.config() parses and mutates process.env — observation changes env state' },
  // Secret access audit logging
  { regex: /(?:SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY)\b[^;]*(?:log|audit|track|record)/i,
    effect: 'Secret access with logging — observation creates audit trail entry' },
  // Config version check — may trigger version bump or sync
  { regex: /configVersion|config_version|schema_version/i,
    effect: 'Config version check may trigger version synchronization or migration' },
  // Feature flag read with analytics
  { regex: /(?:feature|flag|toggle)\b[^;]*(?:analytics|telemetry|track|emit|send)/i,
    effect: 'Feature flag read triggers analytics event — observation changes telemetry state' },
  // Hot module replacement — import triggers code evaluation
  { regex: /module\.hot\.accept|import\.meta\.hot/,
    effect: 'HMR observation triggers module re-evaluation — changes runtime code state' },
  // JSON.parse of config file — parse errors may trigger error handlers
  { regex: /JSON\.parse\s*\([^)]*(?:readFileSync|readFile)[^)]*(?:config|settings|\.env)/i,
    effect: 'Config file parse — malformed config triggers error handler side effects' },
  // Auto-reload / auto-refresh on config change
  { regex: /(?:auto[_-]?reload|hot[_-]?reload|live[_-]?reload)\b/i,
    effect: 'Auto-reload pattern — config observation triggers application restart' },
];

/** Patterns showing awareness of config observation side effects. */
const CONFIG_AWARE_PATTERNS = [
  /-- no reload/i, /skipReload/i, /noWatch/i,
  /readOnly\s*:\s*true/i, /immutable/i,
  /\.freeze\s*\(/, /Object\.freeze/,
  /cache.*config|config.*cache/i,
];

function detectConfigObservation(files: SourceFile[]): ObserverEffect[] {
  const effects: ObserverEffect[] = [];
  for (const file of files) {
    const isAware = CONFIG_AWARE_PATTERNS.some(p => p.test(file.content));
    if (isAware) continue;

    for (let i = 0; i < file.lines.length; i++) {
      if (isComment(file.lines[i])) continue;
      for (const { regex, effect } of CONFIG_OBSERVE_PATTERNS) {
        if (regex.test(file.lines[i])) {
          effects.push({
            domain: 'config_observation',
            severity: 'warning',
            file: file.relativePath,
            line: i + 1,
            detail: `Config observation side effect at line ${i + 1}: ${effect}`,
            assumption: 'Config read is side-effect-free',
            reality: effect,
          });
          break;
        }
      }
    }
  }
  return effects;
}

// =============================================================================
// CROSS-SOURCE CONSISTENCY: Observer Effect in Comments/Config
// Detects when one source declares an observation side effect that
// another source is unaware of (the structural pattern from staged scenarios).
// =============================================================================

interface CrossSourceMismatch {
  domain: ObservationDomain;
  declaredIn: string;
  missingIn: string;
  pattern: string;
  detail: string;
}

/** Cross-source observation indicators — declared in one file, expected in another. */
const CROSS_SOURCE_PATTERNS: Array<{
  domain: ObservationDomain;
  indicator: RegExp;
  expectedIn: string[];
  description: string;
}> = [
  // DB: pg_stat_statements in init.sql but not referenced in server.js
  {
    domain: 'database_observation',
    indicator: /pg_stat_statements/i,
    expectedIn: ['server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts'],
    description: 'pg_stat_statements extension enabled but application code has no awareness',
  },
  // DB: audit_trail table in init.sql but not referenced in server
  {
    domain: 'database_observation',
    indicator: /audit_trail|audit_log/i,
    expectedIn: ['server.js', 'server.ts', 'app.js', 'app.ts'],
    description: 'Audit trail table exists but application code has no audit awareness',
  },
  // CLI: healthcheck interval in docker-compose but no log awareness
  {
    domain: 'cli_observation',
    indicator: /interval:\s*\d+s/i,
    expectedIn: ['server.js', 'server.ts', 'app.js', 'app.ts'],
    description: 'Healthcheck interval configured but application has no interval/rate awareness',
  },
  // Config: file watcher in config but no hot-reload handling
  {
    domain: 'config_observation',
    indicator: /fs\.watch|chokidar|watchFile/i,
    expectedIn: ['config.json', 'config.js', 'config.ts', '.env'],
    description: 'File watcher active but config files have no reload handling awareness',
  },
];

function detectCrossSourceMismatch(baseDir: string, edits: Edit[]): ObserverEffect[] {
  const effects: ObserverEffect[] = [];

  // Build a map of file contents (prefer edit replace, else read from disk)
  const fileContents = new Map<string, string>();
  for (const edit of edits) {
    if (edit.replace) {
      const existing = fileContents.get(edit.file) ?? '';
      fileContents.set(edit.file, existing + '\n' + edit.replace);
    }
  }

  // Also read key files from disk
  const keyFiles = [
    'server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts',
    'init.sql', 'schema.sql', 'config.json', '.env',
    'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  ];
  for (const f of keyFiles) {
    if (!fileContents.has(f)) {
      const content = safeRead(join(baseDir, f));
      if (content) fileContents.set(f, content);
    }
  }

  for (const { domain, indicator, expectedIn, description } of CROSS_SOURCE_PATTERNS) {
    // Find which files declare the observation pattern
    for (const [file, content] of fileContents) {
      if (!indicator.test(content)) continue;

      // Check if expected files reference the same pattern
      for (const expected of expectedIn) {
        if (expected === file) continue;
        const expectedContent = fileContents.get(expected);
        if (expectedContent && indicator.test(expectedContent)) continue;

        // Pattern found in one file, missing in expected file
        if (expectedContent !== undefined) {
          effects.push({
            domain,
            severity: 'warning',
            file,
            line: 0,
            detail: `Cross-source observer effect: ${description} (declared in ${file}, missing in ${expected})`,
            assumption: `${expected} is aware of observation side effects from ${file}`,
            reality: `${expected} has no reference to the observation pattern`,
          });
          break; // One mismatch per pattern per declaring file
        }
      }
    }
  }

  return effects;
}

// =============================================================================
// OBSERVATION GATE
// =============================================================================

/**
 * Run the observation gate — detects when verification/observation actions
 * would cause side effects on the system being observed.
 *
 * Advisory gate — always passes, but reports observer effects for transparency.
 * This ensures the verification pipeline itself doesn't introduce hidden mutations.
 */
export function runObservationGate(ctx: GateContext): ObservationGateResult {
  const start = Date.now();
  const effects: ObserverEffect[] = [];
  const baseDir = ctx.stageDir ?? ctx.config.appDir;

  // Collect source files from edits (same pattern as contention gate)
  const sourceFiles: SourceFile[] = [];
  for (const edit of ctx.edits) {
    if (!edit.replace) continue;
    sourceFiles.push({
      relativePath: edit.file,
      content: edit.replace,
      lines: edit.replace.split('\n'),
    });
  }

  // Also scan full app directory for cross-source patterns
  const allFiles = collectSourceFiles(baseDir);

  // Run all four domain detectors on edit content
  effects.push(...detectBrowserObservation(sourceFiles));
  effects.push(...detectDatabaseObservation(sourceFiles));
  effects.push(...detectCliObservation(sourceFiles));
  effects.push(...detectConfigObservation(sourceFiles));

  // Run cross-source detector on full app directory
  effects.push(...detectCrossSourceMismatch(baseDir, ctx.edits));

  // Also scan full app directory files for observation patterns
  // (catches pre-existing observer effects that edits interact with)
  effects.push(...detectBrowserObservation(allFiles));
  effects.push(...detectDatabaseObservation(allFiles));
  effects.push(...detectCliObservation(allFiles));
  effects.push(...detectConfigObservation(allFiles));

  // Deduplicate by file+line+domain
  const seen = new Set<string>();
  const deduped = effects.filter(e => {
    const key = `${e.file}:${e.line}:${e.domain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const byDomain = new Map<string, number>();
  for (const e of deduped) byDomain.set(e.domain, (byDomain.get(e.domain) ?? 0) + 1);

  let detail: string;
  if (deduped.length === 0) {
    detail = 'No observer effects detected — verification is side-effect-free';
  } else {
    const parts: string[] = [];
    for (const [domain, count] of byDomain) {
      parts.push(`${count}× ${domain.replace(/_/g, ' ')}`);
    }
    detail = `${deduped.length} observer effect(s): ${parts.join(', ')}`;
  }

  ctx.log(`[observation] ${detail}`);

  // Advisory — always passes. Observer effects are transparency, not blockers.
  return {
    gate: 'observation' as any,
    passed: true,
    detail,
    durationMs: Date.now() - start,
    effects: deduped,
  };
}

/**
 * Check if the observation gate is relevant for the given edits.
 */
export function isObservationRelevant(edits: Edit[]): boolean {
  return edits.length > 0;
}
