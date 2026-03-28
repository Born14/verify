/**
 * State Gate — State Assumption Detection
 * ========================================
 *
 * Detects STATE ASSUMPTION failure patterns — when an agent's edits assume a
 * state of reality that doesn't match what's actually in the staged workspace.
 * The agent believes something exists or is configured a certain way, but the
 * filesystem tells a different story.
 *
 * Five divergence categories:
 *   file_existence          — edit targets a file that doesn't exist in stageDir
 *   selector_presence       — CSS predicate references a selector absent from the file
 *   schema_assumption       — SQL references tables not defined in schema files
 *   env_assumption          — code references env vars not defined in any .env file
 *   dependency_assumption   — code imports a module not listed in package.json
 *
 * Runs after F9 (edits applied) and before staging.
 * No Docker required. Pure filesystem reads.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import type { GateResult, GateContext, Edit } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type StateAssumptionType =
  | 'file_existence'
  | 'selector_presence'
  | 'schema_assumption'
  | 'env_assumption'
  | 'dependency_assumption';

export interface StateDivergence {
  type: StateAssumptionType;
  severity: 'error' | 'warning';
  file: string;
  detail: string;
  assumed: string;
  actual: string;
}

export interface StateGateResult extends GateResult {
  divergences: StateDivergence[];
}

// =============================================================================
// WELL-KNOWN FILES AND PATTERNS
// =============================================================================

/** Files that define database schema. */
const SCHEMA_FILES = ['init.sql', 'schema.sql', 'setup.sql'];

/** Directories that contain migration files. */
const MIGRATION_DIRS = ['migrations', 'db/migrations', 'sql/migrations'];

/** Environment file names. */
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development', '.env.example', '.env.test'];

/** Directories to skip when scanning. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  '.sovereign', '.verify', '.cache', '__pycache__',
  'coverage', '.nyc_output',
]);

/** File extensions we scan for env/import references. */
const CODE_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go',
]);

/** Node.js built-in modules — never flag these as missing dependencies. */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  // node: prefix handled separately
]);

// =============================================================================
// SQL TABLE EXTRACTION PATTERNS
// =============================================================================

/** Extract table names from CREATE TABLE statements. */
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;

/** Extract table names from various SQL operations in edit content. */
const SQL_TABLE_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi, label: 'CREATE TABLE' },
  { regex: /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi, label: 'ALTER TABLE' },
  { regex: /INSERT\s+INTO\s+["'`]?(\w+)["'`]?/gi, label: 'INSERT INTO' },
  { regex: /SELECT\s+.+?\s+FROM\s+["'`]?(\w+)["'`]?/gi, label: 'SELECT FROM' },
  { regex: /UPDATE\s+["'`]?(\w+)["'`]?\s+SET/gi, label: 'UPDATE' },
  { regex: /DELETE\s+FROM\s+["'`]?(\w+)["'`]?/gi, label: 'DELETE FROM' },
  { regex: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi, label: 'DROP TABLE' },
  { regex: /TRUNCATE\s+(?:TABLE\s+)?["'`]?(\w+)["'`]?/gi, label: 'TRUNCATE' },
];

// =============================================================================
// ENV REFERENCE PATTERNS
// =============================================================================

/** Patterns that reference environment variables in code. */
const ENV_REF_PATTERNS: RegExp[] = [
  // JavaScript/TypeScript: process.env.VAR_NAME
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  // Python: os.environ['VAR_NAME'] or os.environ.get('VAR_NAME')
  /os\.environ(?:\.get)?\s*\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /os\.environ\.get\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  // Ruby: ENV['VAR_NAME'] or ENV.fetch('VAR_NAME')
  /ENV\s*\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /ENV\.fetch\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  // Go: os.Getenv("VAR_NAME")
  /os\.Getenv\s*\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
];

/** Common env vars that are always available at runtime (never flag these). */
const IMPLICIT_ENV_VARS = new Set([
  'NODE_ENV', 'HOME', 'USER', 'PATH', 'PWD', 'SHELL', 'LANG',
  'TERM', 'HOSTNAME', 'PORT', 'HOST',
  // Docker-injected
  'DOCKER_HOST',
]);

// =============================================================================
// IMPORT/REQUIRE PATTERNS
// =============================================================================

/** Patterns that import external modules. */
const IMPORT_PATTERNS: RegExp[] = [
  // CommonJS: require('module') or require("module")
  /\brequire\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
  // ESM: import ... from 'module' or import ... from "module"
  /\bimport\s+(?:[\w{},*\s]+\s+from\s+)?['"]([^'"./][^'"]*)['"]/g,
  // Dynamic import: import('module')
  /\bimport\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Safely read a file. Returns null if file doesn't exist or can't be read.
 */
function safeRead(filePath: string): string | null {
  try {
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  } catch {
    return null;
  }
}

/**
 * Collect all source files from a directory (max depth 3).
 * Returns relative paths and content.
 */
function collectSourceFiles(
  baseDir: string,
  extensions: Set<string>,
  maxDepth: number = 3,
): Array<{ relative: string; content: string }> {
  const results: Array<{ relative: string; content: string }> = [];

  function scan(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    let names: string[];
    try {
      names = readdirSync(dir) as string[];
    } catch {
      return;
    }

    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const fullPath = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath, relative, depth + 1);
        } else {
          const ext = extname(name).toLowerCase();
          if (extensions.has(ext)) {
            const content = safeRead(fullPath);
            if (content && content.length < 500_000) {
              results.push({ relative, content });
            }
          }
        }
      } catch {
        continue;
      }
    }
  }

  scan(baseDir, '', 0);
  return results;
}

/**
 * Extract all table names defined in schema/migration files within the app dir.
 * Returns a lowercase Set of known table names.
 */
function collectKnownTables(baseDir: string): Set<string> {
  const tables = new Set<string>();

  // Check init/schema files in the root
  for (const name of SCHEMA_FILES) {
    const content = safeRead(join(baseDir, name));
    if (content) {
      extractTableNames(content, tables);
    }
  }

  // Check migration directories
  for (const migDir of MIGRATION_DIRS) {
    const fullDir = join(baseDir, migDir);
    try {
      const files = readdirSync(fullDir).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        const content = safeRead(join(fullDir, file));
        if (content) {
          extractTableNames(content, tables);
        }
      }
    } catch {
      // Migration directory doesn't exist — fine
    }
  }

  return tables;
}

/**
 * Extract CREATE TABLE names from SQL content and add to the set (lowercased).
 */
function extractTableNames(sql: string, tables: Set<string>): void {
  const re = new RegExp(CREATE_TABLE_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    tables.add(match[1].toLowerCase());
  }
}

/**
 * Collect all environment variable definitions from .env files.
 * Returns a Set of variable names.
 */
function collectDefinedEnvVars(baseDir: string): Set<string> {
  const vars = new Set<string>();

  for (const envFile of ENV_FILES) {
    const content = safeRead(join(baseDir, envFile));
    if (!content) continue;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(trimmed);
      if (match) {
        vars.add(match[1]);
      }
    }
  }

  // Also check docker-compose.yml environment sections
  const composeNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const name of composeNames) {
    const content = safeRead(join(baseDir, name));
    if (!content) continue;

    // Simple extraction of environment variables from compose files
    const envRe = /^\s+-\s+([A-Z_][A-Z0-9_]*)=/gm;
    let match: RegExpExecArray | null;
    while ((match = envRe.exec(content)) !== null) {
      vars.add(match[1]);
    }

    // Also handle "KEY: value" format under environment:
    const envMapRe = /^\s+([A-Z_][A-Z0-9_]*):\s/gm;
    while ((match = envMapRe.exec(content)) !== null) {
      vars.add(match[1]);
    }
  }

  return vars;
}

/**
 * Parse package.json and return a Set of all dependency names
 * (dependencies + devDependencies + peerDependencies + optionalDependencies).
 */
function collectPackageDeps(baseDir: string): Set<string> | null {
  const content = safeRead(join(baseDir, 'package.json'));
  if (!content) return null;

  try {
    const pkg = JSON.parse(content);
    const deps = new Set<string>();

    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const section = pkg[field];
      if (section && typeof section === 'object') {
        for (const name of Object.keys(section)) {
          deps.add(name);
        }
      }
    }

    return deps;
  } catch {
    return null;
  }
}

/**
 * Check if a module specifier is a Node.js built-in.
 */
function isBuiltinModule(specifier: string): boolean {
  // node: prefix
  if (specifier.startsWith('node:')) return true;
  // Direct built-in name
  if (NODE_BUILTINS.has(specifier)) return true;
  // Subpath of a built-in (e.g., 'fs/promises', 'path/posix')
  const base = specifier.split('/')[0];
  if (NODE_BUILTINS.has(base)) return true;
  return false;
}

/**
 * Extract the package name from a module specifier.
 * Handles scoped packages: '@scope/pkg/path' → '@scope/pkg'
 * Handles regular packages: 'lodash/fp' → 'lodash'
 */
function extractPackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    // Scoped: @scope/pkg or @scope/pkg/subpath
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  // Regular: pkg or pkg/subpath
  return specifier.split('/')[0];
}

// =============================================================================
// DETECTOR 1: File Existence
// =============================================================================

/**
 * Detect edits that target files which don't exist in the staged workspace.
 * This is an error — the edit literally cannot be applied.
 */
function detectFileExistence(baseDir: string, edits: Edit[]): StateDivergence[] {
  const divergences: StateDivergence[] = [];

  for (const edit of edits) {
    const targetPath = join(baseDir, edit.file);

    // Skip create-only edits (empty search = file creation)
    if (!edit.search || edit.search.trim() === '') continue;

    if (!existsSync(targetPath)) {
      divergences.push({
        type: 'file_existence',
        severity: 'error',
        file: edit.file,
        detail: `Edit targets "${edit.file}" but file does not exist in workspace`,
        assumed: `File "${edit.file}" exists`,
        actual: 'File not found',
      });
    }
  }

  return divergences;
}

// =============================================================================
// DETECTOR 2: Selector Presence
// =============================================================================

/**
 * Detect CSS predicates that reference selectors absent from the target file.
 * This is a warning — the predicate may be fabricated or targeting new content.
 */
function detectSelectorPresence(
  baseDir: string,
  predicates: Array<{ type: string; selector?: string; file?: string; path?: string }>,
): StateDivergence[] {
  const divergences: StateDivergence[] = [];

  for (const pred of predicates) {
    if (pred.type !== 'css' || !pred.selector) continue;

    // Determine which files to scan for the selector
    const filesToCheck = resolvePredicateFiles(baseDir, pred);

    for (const { relative, content } of filesToCheck) {
      // Check if the CSS selector string appears anywhere in the file.
      // This is a broad check — the selector might be in a class attribute,
      // a <style> block, or a CSS file reference.
      const selectorBase = extractSelectorBase(pred.selector);
      if (selectorBase && !content.includes(selectorBase)) {
        divergences.push({
          type: 'selector_presence',
          severity: 'warning',
          file: relative,
          detail: `CSS predicate references selector "${pred.selector}" not found in "${relative}"`,
          assumed: `Selector "${pred.selector}" exists in source`,
          actual: `Selector base "${selectorBase}" not found in file`,
        });
      }
    }
  }

  return divergences;
}

/**
 * Extract the base identifier from a CSS selector for simple presence checking.
 * '.roster-link' → '.roster-link'
 * '#main-nav > .item' → '.item' (last meaningful segment)
 * 'h1' → null (too generic to check)
 * 'body' → null (always exists)
 */
function extractSelectorBase(selector: string): string | null {
  const trimmed = selector.trim();

  // Skip universal/element-only selectors (too generic)
  if (/^[a-z]+$/i.test(trimmed)) return null;
  if (trimmed === '*') return null;

  // For compound selectors, take the last class or ID segment
  const segments = trimmed.split(/[\s>+~]+/);
  const last = segments[segments.length - 1].trim();

  // Extract class or ID from the last segment
  const classMatch = /(\.[a-zA-Z_-][a-zA-Z0-9_-]*)/.exec(last);
  if (classMatch) return classMatch[1];

  const idMatch = /(#[a-zA-Z_-][a-zA-Z0-9_-]*)/.exec(last);
  if (idMatch) return idMatch[1];

  // If we have a more complex selector with pseudo-classes, try the base
  const pseudoStripped = last.replace(/:[a-z-]+(\([^)]*\))?/g, '');
  const classFromStripped = /(\.[a-zA-Z_-][a-zA-Z0-9_-]*)/.exec(pseudoStripped);
  if (classFromStripped) return classFromStripped[1];

  return null;
}

/**
 * Resolve which files to scan for a CSS predicate's selector.
 * Returns file content for matching source files.
 */
function resolvePredicateFiles(
  baseDir: string,
  pred: { file?: string; path?: string },
): Array<{ relative: string; content: string }> {
  const results: Array<{ relative: string; content: string }> = [];

  // If a specific file is declared, only check that file
  if (pred.file) {
    const content = safeRead(join(baseDir, pred.file));
    if (content) {
      results.push({ relative: pred.file, content });
    }
    return results;
  }

  // Otherwise scan all HTML/CSS/JS files that might contain style definitions
  const styleExts = new Set(['.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx', '.ejs', '.hbs', '.vue', '.svelte']);
  return collectSourceFiles(baseDir, styleExts, 2);
}

// =============================================================================
// DETECTOR 3: Schema Assumption
// =============================================================================

/**
 * Detect edits containing SQL references to tables that don't exist in the
 * app's schema files (init.sql, migrations).
 * This is a warning — the table might be created by a migration in the same edit set.
 */
function detectSchemaAssumption(baseDir: string, edits: Edit[]): StateDivergence[] {
  const divergences: StateDivergence[] = [];

  // Collect all table names known from schema/migration files
  const knownTables = collectKnownTables(baseDir);

  // If no schema files exist at all, skip this detector
  if (knownTables.size === 0) return divergences;

  // Also collect tables that the edits themselves create
  const editCreatedTables = new Set<string>();
  for (const edit of edits) {
    const content = edit.replace || '';
    const re = new RegExp(CREATE_TABLE_RE.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      editCreatedTables.add(match[1].toLowerCase());
    }
  }

  // Merge: known from existing files + created by these edits
  const allKnownTables = new Set([...knownTables, ...editCreatedTables]);

  // SQL-specific reserved words to exclude from table name matches
  const SQL_RESERVED = new Set([
    'select', 'from', 'where', 'insert', 'into', 'update', 'delete',
    'create', 'table', 'alter', 'drop', 'index', 'view', 'trigger',
    'function', 'procedure', 'begin', 'end', 'commit', 'rollback',
    'set', 'values', 'null', 'not', 'and', 'or', 'in', 'exists',
    'join', 'left', 'right', 'inner', 'outer', 'on', 'as', 'if',
    'then', 'else', 'case', 'when', 'order', 'by', 'group', 'having',
    'limit', 'offset', 'union', 'all', 'distinct', 'true', 'false',
    'primary', 'key', 'foreign', 'references', 'constraint', 'unique',
    'default', 'check', 'cascade', 'restrict', 'serial', 'text',
    'integer', 'bigint', 'varchar', 'boolean', 'timestamp', 'date',
    'json', 'jsonb', 'uuid', 'float', 'double', 'decimal', 'numeric',
  ]);

  for (const edit of edits) {
    const content = edit.replace || '';

    // Check each SQL pattern for table references
    for (const { regex, label } of SQL_TABLE_PATTERNS) {
      const re = new RegExp(regex.source, 'gi');
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const tableName = match[1];
        const tableNameLower = tableName.toLowerCase();

        // Skip SQL reserved words that might be matched
        if (SQL_RESERVED.has(tableNameLower)) continue;

        // Skip if table is known
        if (allKnownTables.has(tableNameLower)) continue;

        // Skip CREATE TABLE — the edit is creating it, not assuming it exists
        if (label === 'CREATE TABLE') continue;

        divergences.push({
          type: 'schema_assumption',
          severity: 'warning',
          file: edit.file,
          detail: `${label} references table "${tableName}" not found in schema files`,
          assumed: `Table "${tableName}" exists in database`,
          actual: `Table not defined in init.sql or migrations (known: ${[...knownTables].join(', ') || 'none'})`,
        });
      }
    }
  }

  // Deduplicate by table name per file
  const seen = new Set<string>();
  return divergences.filter(d => {
    const key = `${d.file}:${d.assumed}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// =============================================================================
// DETECTOR 4: Env Assumption
// =============================================================================

/**
 * Detect edits that reference environment variables not defined in any .env file.
 * This is a warning — the var might be injected at runtime or via Docker.
 */
function detectEnvAssumption(baseDir: string, edits: Edit[]): StateDivergence[] {
  const divergences: StateDivergence[] = [];

  // Collect all defined env vars
  const definedVars = collectDefinedEnvVars(baseDir);

  // Track which vars we've already flagged to deduplicate
  const flaggedVars = new Set<string>();

  for (const edit of edits) {
    const content = edit.replace || '';

    for (const pattern of ENV_REF_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const varName = match[1];

        // Skip implicit/common vars
        if (IMPLICIT_ENV_VARS.has(varName)) continue;

        // Skip if already defined
        if (definedVars.has(varName)) continue;

        // Skip if already flagged
        const key = `${edit.file}:${varName}`;
        if (flaggedVars.has(key)) continue;
        flaggedVars.add(key);

        divergences.push({
          type: 'env_assumption',
          severity: 'warning',
          file: edit.file,
          detail: `References process.env.${varName} but "${varName}" not found in any .env file`,
          assumed: `Environment variable "${varName}" is defined`,
          actual: `Not found in ${ENV_FILES.join(', ')} or docker-compose environment`,
        });
      }
    }
  }

  return divergences;
}

// =============================================================================
// DETECTOR 5: Dependency Assumption
// =============================================================================

/**
 * Detect edits that import/require modules not listed in package.json.
 * This is a warning — the module might be globally installed or a peer dep.
 */
function detectDependencyAssumption(baseDir: string, edits: Edit[]): StateDivergence[] {
  const divergences: StateDivergence[] = [];

  // Collect known dependencies
  const deps = collectPackageDeps(baseDir);

  // If no package.json exists, skip this detector entirely
  if (deps === null) return divergences;

  // Track what we've already flagged
  const flaggedModules = new Set<string>();

  for (const edit of edits) {
    const content = edit.replace || '';

    // Only check code files for import patterns
    const ext = extname(edit.file).toLowerCase();
    if (!CODE_EXTS.has(ext) && ext !== '') continue;

    for (const pattern of IMPORT_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const specifier = match[1];

        // Skip built-in modules
        if (isBuiltinModule(specifier)) continue;

        // Extract the package name (handle scoped + subpaths)
        const packageName = extractPackageName(specifier);

        // Skip if already listed in dependencies
        if (deps.has(packageName)) continue;

        // Skip if already flagged
        const key = `${edit.file}:${packageName}`;
        if (flaggedModules.has(key)) continue;
        flaggedModules.add(key);

        divergences.push({
          type: 'dependency_assumption',
          severity: 'warning',
          file: edit.file,
          detail: `Imports "${specifier}" but "${packageName}" not found in package.json dependencies`,
          assumed: `Module "${packageName}" is installed`,
          actual: `Not listed in package.json (dependencies, devDependencies, peerDependencies, or optionalDependencies)`,
        });
      }
    }
  }

  return divergences;
}

// =============================================================================
// STATE GATE
// =============================================================================

/**
 * Run the state gate — detects when edits assume a state of reality that
 * doesn't match the staged workspace.
 *
 * Fails if any error-severity divergences are found (file_existence).
 * Passes with warnings for other assumption types.
 */
export function runStateGate(ctx: GateContext): StateGateResult {
  const start = Date.now();
  const divergences: StateDivergence[] = [];
  const baseDir = ctx.stageDir ?? ctx.config.appDir;

  // 1. File existence — do edit targets actually exist?
  divergences.push(...detectFileExistence(baseDir, ctx.edits));

  // 2. Selector presence — do CSS predicates reference real selectors?
  divergences.push(...detectSelectorPresence(baseDir, ctx.predicates));

  // 3. Schema assumption — do SQL references match known tables?
  divergences.push(...detectSchemaAssumption(baseDir, ctx.edits));

  // 4. Env assumption — do env var references match .env files?
  divergences.push(...detectEnvAssumption(baseDir, ctx.edits));

  // 5. Dependency assumption — do imports match package.json?
  divergences.push(...detectDependencyAssumption(baseDir, ctx.edits));

  // Classify outcome
  const errors = divergences.filter(d => d.severity === 'error');
  const warnings = divergences.filter(d => d.severity === 'warning');
  const passed = errors.length === 0;

  let detail: string;
  if (divergences.length === 0) {
    detail = 'No state assumption divergences detected';
  } else if (passed) {
    detail = `${warnings.length} state warning(s): ${summarizeDivergences(warnings)}`;
  } else {
    detail = `${errors.length} state error(s), ${warnings.length} warning(s): ${summarizeDivergences(errors)}`;
  }

  ctx.log(`[state] ${detail}`);

  return {
    gate: 'state' as any,
    passed,
    detail,
    durationMs: Date.now() - start,
    divergences,
  };
}

/**
 * Summarize divergences into a compact string for the detail field.
 */
function summarizeDivergences(divergences: StateDivergence[]): string {
  const byType = new Map<string, number>();
  for (const d of divergences) {
    byType.set(d.type, (byType.get(d.type) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [type, count] of byType) {
    parts.push(`${count}x ${type.replace(/_/g, ' ')}`);
  }
  return parts.join(', ');
}

/**
 * Check if edits are present (state gate is relevant for any non-empty edit set).
 */
export function isStateRelevant(edits: Edit[]): boolean {
  return edits.length > 0;
}
