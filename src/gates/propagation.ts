/**
 * Propagation Gate — Cross-Surface Cascade Failure Detection
 * ===========================================================
 *
 * Detects PROPAGATION failure patterns — when an agent's edits change one surface
 * but the change doesn't cascade to dependent downstream surfaces.
 *
 * Five propagation break categories:
 *   css_class_orphan        — CSS class renamed in <style> but HTML still uses old class name
 *   route_reference_stale   — route path changed but href/fetch/url still references old path
 *   schema_query_mismatch   — column added/renamed in SQL schema but queries use old name
 *   env_key_divergence      — env var key renamed but consumers still reference old key
 *   import_path_broken      — file renamed/moved but require/import still uses old path
 *
 * Runs after F9 (edits applied) and before staging.
 * No Docker required. Pure filesystem reads.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import type { GateResult, GateContext, Edit } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type PropagationBreakType =
  | 'css_class_orphan'
  | 'route_reference_stale'
  | 'schema_query_mismatch'
  | 'env_key_divergence'
  | 'import_path_broken';

export interface PropagationBreak {
  type: PropagationBreakType;
  severity: 'error' | 'warning';
  sourceFile: string;
  downstreamFile: string;
  detail: string;
  oldValue: string;
  newValue: string;
}

export interface PropagationGateResult extends GateResult {
  breaks: PropagationBreak[];
}

// =============================================================================
// WELL-KNOWN FILES AND PATTERNS
// =============================================================================

const SOURCE_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.ejs',
  '.hbs', '.pug', '.vue', '.svelte', '.astro',
]);

const SQL_FILES = ['init.sql', 'schema.sql', 'seed.sql'];
const ENV_NAMES = ['.env', '.env.local', '.env.production', '.env.development', '.env.example'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__', '.verify']);

const TEXT_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.yml', '.yaml',
  '.sql', '.html', '.htm', '.css', '.env', '.ejs', '.hbs', '.pug',
  '.vue', '.svelte', '.astro', '.py', '.rb', '.go', '.rs', '.sh',
]);

// =============================================================================
// MAIN GATE
// =============================================================================

/**
 * Run propagation analysis against the staging workspace (post-edit state).
 * Detects cross-surface cascade failures where edits don't propagate to consumers.
 */
export function runPropagationGate(ctx: GateContext): PropagationGateResult {
  const start = Date.now();
  const baseDir = ctx.stageDir ?? ctx.config.appDir;
  const breaks: PropagationBreak[] = [];
  const editedFiles = new Set(ctx.edits.map(e => e.file));

  breaks.push(...detectCSSClassOrphans(baseDir, ctx.edits));
  breaks.push(...detectRouteReferenceStale(baseDir, ctx.edits, editedFiles));
  breaks.push(...detectSchemaQueryMismatch(baseDir, ctx.edits, editedFiles));
  breaks.push(...detectEnvKeyDivergence(baseDir, ctx.edits, editedFiles));
  breaks.push(...detectImportPathBroken(baseDir, ctx.edits, editedFiles));

  const errors = breaks.filter(b => b.severity === 'error');
  const warnings = breaks.filter(b => b.severity === 'warning');
  const passed = errors.length === 0;

  let detail: string;
  if (breaks.length === 0) {
    detail = 'No propagation breaks detected';
  } else if (passed) {
    detail = `${warnings.length} propagation warning(s): ${warnings.map(w => w.detail).join('; ')}`;
  } else {
    detail = `${errors.length} propagation error(s), ${warnings.length} warning(s): `
      + errors.map(e => e.detail).join('; ');
  }

  return {
    gate: 'propagation' as any,
    passed,
    detail,
    durationMs: Date.now() - start,
    breaks,
  };
}

// =============================================================================
// DETECTOR 1: CSS Class Orphans
// =============================================================================

/**
 * Detect CSS class renames in <style> blocks where the HTML still uses the old class name.
 * A class is "orphaned" when its definition was renamed but its consumers were not updated.
 */
function detectCSSClassOrphans(baseDir: string, edits: Edit[]): PropagationBreak[] {
  const breaks: PropagationBreak[] = [];

  for (const edit of edits) {
    // Only analyze edits that touch style blocks
    if (!looksLikeCSS(edit.search) && !looksLikeCSS(edit.replace)) continue;

    const oldClasses = extractCSSClassNames(edit.search);
    const newClasses = extractCSSClassNames(edit.replace);

    // Find classes that were in the old code but not in the new (renamed or removed)
    for (const oldClass of oldClasses) {
      if (newClasses.has(oldClass)) continue; // Still present, not renamed
      if (oldClass.length < 2) continue; // Skip single-char classes

      // Read the post-edit file to check if the old class is still used in HTML
      const fullPath = join(baseDir, edit.file);
      const content = safeRead(fullPath);
      if (!content) continue;

      // Search for the old class name in HTML class attributes within the same file
      const htmlClassPattern = new RegExp(
        `class\\s*=\\s*["'][^"']*\\b${escapeRegex(oldClass)}\\b[^"']*["']`,
      );
      if (htmlClassPattern.test(content)) {
        // Find the most likely replacement class
        const replacement = findLikelyReplacement(oldClass, newClasses);
        breaks.push({
          type: 'css_class_orphan',
          severity: 'error',
          sourceFile: edit.file,
          downstreamFile: edit.file,
          detail: `CSS class ".${oldClass}" renamed${replacement ? ` to ".${replacement}"` : ''} in <style> but HTML still uses class="${oldClass}"`,
          oldValue: oldClass,
          newValue: replacement ?? '(removed)',
        });
      }

      // Also scan other files that might reference this class
      const scannableFiles = collectScannableFiles(baseDir, new Set([edit.file]));
      for (const { relative, content: fileContent } of scannableFiles) {
        if (relative === edit.file) continue;
        const refPattern = new RegExp(
          `class\\s*=\\s*["'][^"']*\\b${escapeRegex(oldClass)}\\b[^"']*["']`,
        );
        if (refPattern.test(fileContent)) {
          const replacement = findLikelyReplacement(oldClass, newClasses);
          breaks.push({
            type: 'css_class_orphan',
            severity: 'error',
            sourceFile: edit.file,
            downstreamFile: relative,
            detail: `CSS class ".${oldClass}" renamed in ${edit.file} but ${relative} still uses class="${oldClass}"`,
            oldValue: oldClass,
            newValue: replacement ?? '(removed)',
          });
        }
      }
    }
  }

  return breaks;
}

// =============================================================================
// DETECTOR 2: Route Reference Staleness
// =============================================================================

/**
 * Detect route path changes where href, fetch, or URL references still use the old path.
 * More precise than temporal gate — focuses on route handler definitions vs consumer references.
 */
function detectRouteReferenceStale(baseDir: string, edits: Edit[], editedFiles: Set<string>): PropagationBreak[] {
  const breaks: PropagationBreak[] = [];

  for (const edit of edits) {
    const oldRoutes = extractRouteDefinitions(edit.search);
    const newRoutes = extractRouteDefinitions(edit.replace);

    // Find routes that were renamed (present in old handler, absent in new)
    for (const oldRoute of oldRoutes) {
      if (newRoutes.includes(oldRoute)) continue;
      if (oldRoute === '/' || oldRoute === '*') continue; // Skip root and wildcard

      const replacement = newRoutes.length > 0 ? newRoutes[0] : null;

      // Scan all files for stale references to the old route
      const scannableFiles = collectScannableFiles(baseDir, new Set());
      for (const { relative, content } of scannableFiles) {
        // Skip the file where the rename happened IF the edit also updated references there
        if (relative === edit.file && !content.includes(oldRoute)) continue;

        const staleRefs = findRouteReferences(content, oldRoute);
        if (staleRefs.length > 0) {
          breaks.push({
            type: 'route_reference_stale',
            severity: 'warning',
            sourceFile: edit.file,
            downstreamFile: relative,
            detail: `Route "${oldRoute}" changed${replacement ? ` to "${replacement}"` : ''} in ${edit.file} but ${relative} still references "${oldRoute}" (${staleRefs.join(', ')})`,
            oldValue: oldRoute,
            newValue: replacement ?? '(removed)',
          });
        }
      }
    }
  }

  return breaks;
}

// =============================================================================
// DETECTOR 3: Schema-Query Mismatch
// =============================================================================

/**
 * Detect column renames or additions in init.sql/migrations where queries in source files
 * still reference the old column name.
 */
function detectSchemaQueryMismatch(baseDir: string, edits: Edit[], editedFiles: Set<string>): PropagationBreak[] {
  const breaks: PropagationBreak[] = [];

  for (const edit of edits) {
    const fileName = basename(edit.file);
    const isSQLFile = SQL_FILES.includes(fileName)
      || edit.file.startsWith('migrations/')
      || edit.file.startsWith('migrations\\')
      || fileName.endsWith('.sql');

    if (!isSQLFile) continue;

    // Detect column renames: old search had column X, replace has column Y in same position
    const oldColumns = extractColumnNames(edit.search);
    const newColumns = extractColumnNames(edit.replace);

    // Find columns present in old SQL but not in new (renamed or removed)
    for (const oldCol of oldColumns) {
      if (newColumns.has(oldCol)) continue;
      if (oldCol.length < 2) continue;
      if (isReservedSQLWord(oldCol)) continue;

      // Scan source files for queries referencing the old column
      const scannableFiles = collectScannableFiles(baseDir, new Set());
      for (const { relative, content } of scannableFiles) {
        if (relative === edit.file) continue;
        if (!isSourceFile(relative)) continue;

        // Look for the old column name in SQL query contexts
        const queryRefs = findColumnInQueries(content, oldCol);
        if (queryRefs.length > 0) {
          const replacement = findLikelyColumnReplacement(oldCol, newColumns);
          breaks.push({
            type: 'schema_query_mismatch',
            severity: 'error',
            sourceFile: edit.file,
            downstreamFile: relative,
            detail: `Column "${oldCol}" changed in ${edit.file} but ${relative} still references it in ${queryRefs[0]}`,
            oldValue: oldCol,
            newValue: replacement ?? '(removed)',
          });
        }
      }
    }
  }

  return breaks;
}

// =============================================================================
// DETECTOR 4: Environment Variable Key Divergence
// =============================================================================

/**
 * Detect env var KEY renames where consumers (process.env.OLD_KEY, import.meta.env.OLD_KEY,
 * os.environ) still reference the old key name.
 */
function detectEnvKeyDivergence(baseDir: string, edits: Edit[], editedFiles: Set<string>): PropagationBreak[] {
  const breaks: PropagationBreak[] = [];

  for (const edit of edits) {
    // Extract env key renames from the edit diff
    const oldKeys = extractEnvKeys(edit.search);
    const newKeys = extractEnvKeys(edit.replace);

    if (oldKeys.length === 0) continue;

    for (const oldKey of oldKeys) {
      if (newKeys.includes(oldKey)) continue; // Key still exists
      if (oldKey.length < 2) continue;

      const replacement = newKeys.find(k => !oldKeys.includes(k)) ?? null;

      // Scan all files for consumers of the old env var
      const scannableFiles = collectScannableFiles(baseDir, new Set());
      for (const { relative, content } of scannableFiles) {
        if (relative === edit.file) continue;

        const consumers = findEnvConsumers(content, oldKey);
        if (consumers.length > 0) {
          breaks.push({
            type: 'env_key_divergence',
            severity: 'warning',
            sourceFile: edit.file,
            downstreamFile: relative,
            detail: `Env var "${oldKey}" renamed${replacement ? ` to "${replacement}"` : ''} in ${edit.file} but ${relative} still references "${oldKey}" (${consumers[0]})`,
            oldValue: oldKey,
            newValue: replacement ?? '(removed)',
          });
        }
      }
    }
  }

  return breaks;
}

// =============================================================================
// DETECTOR 5: Import/Require Path Broken
// =============================================================================

/**
 * Detect file renames where require() or import statements in other files still reference
 * the old path.
 */
function detectImportPathBroken(baseDir: string, edits: Edit[], editedFiles: Set<string>): PropagationBreak[] {
  const breaks: PropagationBreak[] = [];

  for (const edit of edits) {
    // Detect import/require path changes within the edit
    const oldImports = extractImportPaths(edit.search);
    const newImports = extractImportPaths(edit.replace);

    for (const oldPath of oldImports) {
      if (newImports.includes(oldPath)) continue;
      if (oldPath.startsWith('node:') || !oldPath.startsWith('.')) continue; // Skip builtins and packages

      const replacement = newImports.find(p => p.startsWith('.') && !oldImports.includes(p)) ?? null;

      // Check if the old import target actually doesn't exist (confirming the file was moved/renamed)
      const resolvedOld = resolveImportPath(baseDir, edit.file, oldPath);
      if (resolvedOld && existsSync(resolvedOld)) continue; // Old path still exists, not a rename

      // Scan other files for stale references to the old import path
      const scannableFiles = collectScannableFiles(baseDir, new Set());
      for (const { relative, content } of scannableFiles) {
        if (relative === edit.file) continue;

        if (content.includes(oldPath)) {
          // Verify it's actually in an import/require context
          const importRefs = findImportReferences(content, oldPath);
          if (importRefs.length > 0) {
            breaks.push({
              type: 'import_path_broken',
              severity: 'error',
              sourceFile: edit.file,
              downstreamFile: relative,
              detail: `Import path "${oldPath}" changed${replacement ? ` to "${replacement}"` : ''} in ${edit.file} but ${relative} still imports "${oldPath}"`,
              oldValue: oldPath,
              newValue: replacement ?? '(removed)',
            });
          }
        }
      }
    }
  }

  return breaks;
}

// =============================================================================
// EXTRACTION HELPERS
// =============================================================================

/** Extract CSS class names from text that looks like style rules. */
function extractCSSClassNames(text: string): Set<string> {
  const classes = new Set<string>();
  // Match class selectors: .class-name { ... } or .class-name, or .class-name:hover
  const re = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)\s*[{,:]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    classes.add(m[1]);
  }
  return classes;
}

/** Check if text looks like it contains CSS rules. */
function looksLikeCSS(text: string): boolean {
  return /[.#][a-zA-Z_-][a-zA-Z0-9_-]*\s*\{/.test(text)
    || /<style[\s>]/.test(text);
}

/** Find the most likely replacement class from a set of new classes. */
function findLikelyReplacement(oldClass: string, newClasses: Set<string>): string | null {
  // Simple heuristic: find a new class not present in old that shares a common substring
  for (const nc of newClasses) {
    if (nc === oldClass) continue;
    // Check if they share a significant substring (at least 3 chars)
    const shorter = oldClass.length <= nc.length ? oldClass : nc;
    for (let len = shorter.length; len >= 3; len--) {
      for (let start = 0; start <= shorter.length - len; start++) {
        const sub = shorter.substring(start, start + len);
        if (oldClass.includes(sub) && nc.includes(sub)) return nc;
      }
    }
  }
  return newClasses.size === 1 ? [...newClasses][0] : null;
}

/** Extract route handler definitions: app.get('/path'), router.post('/path'), url.pathname === '/path'. */
function extractRouteDefinitions(text: string): string[] {
  const routes: string[] = [];
  const patterns = [
    // Express/Hono/Koa style: app.get('/path', ...) or router.post('/path', ...)
    /(?:app|router|server)\s*\.\s*(?:get|post|put|delete|patch|use|all|route)\s*\(\s*['"`](\/[a-zA-Z0-9/_:-]*)['"`]/g,
    // Vanilla HTTP: url.pathname === '/path' or req.url === '/path'
    /(?:url\.pathname|req\.url|request\.url)\s*===?\s*['"`](\/[a-zA-Z0-9/_:-]*)['"`]/g,
    // Next.js/file-based: export const route = '/path'
    /(?:route|path|endpoint)\s*[:=]\s*['"`](\/[a-zA-Z0-9/_:-]*)['"`]/g,
  ];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) routes.push(m[1]);
  }
  return [...new Set(routes)];
}

/** Find references to a route in consumer contexts (href, fetch, url strings). */
function findRouteReferences(content: string, route: string): string[] {
  const refs: string[] = [];
  const escaped = escapeRegex(route);
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: new RegExp(`href\\s*=\\s*["']${escaped}["']`, 'g'), label: 'href' },
    { re: new RegExp(`fetch\\s*\\(\\s*["'\`]${escaped}["'\`]`, 'g'), label: 'fetch()' },
    { re: new RegExp(`url:\\s*["'\`]${escaped}["'\`]`, 'g'), label: 'url property' },
    { re: new RegExp(`action\\s*=\\s*["']${escaped}["']`, 'g'), label: 'form action' },
    { re: new RegExp(`redirect\\s*\\(\\s*["'\`]${escaped}["'\`]`, 'g'), label: 'redirect()' },
    { re: new RegExp(`window\\.location(?:\\.href)?\\s*=\\s*["'\`]${escaped}["'\`]`, 'g'), label: 'window.location' },
  ];
  for (const { re, label } of patterns) {
    if (re.test(content)) refs.push(label);
  }
  return refs;
}

/** Extract column names from SQL (CREATE TABLE, ALTER TABLE, INSERT INTO). */
function extractColumnNames(sql: string): Set<string> {
  const columns = new Set<string>();

  // CREATE TABLE ... (col1 TYPE, col2 TYPE, ...)
  const createMatch = /CREATE\s+TABLE[^(]*\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = createMatch.exec(sql)) !== null) {
    const body = m[1];
    for (const line of body.split(',')) {
      const colMatch = line.trim().match(/^["']?(\w+)["']?\s+\w/);
      if (colMatch && !isReservedSQLWord(colMatch[1])) {
        columns.add(colMatch[1]);
      }
    }
  }

  // ALTER TABLE ... ADD COLUMN col_name / RENAME COLUMN old TO new
  const alterAddRe = /ADD\s+(?:COLUMN\s+)?["']?(\w+)["']?\s+\w/gi;
  while ((m = alterAddRe.exec(sql)) !== null) {
    if (!isReservedSQLWord(m[1])) columns.add(m[1]);
  }

  const renameColRe = /RENAME\s+COLUMN\s+["']?(\w+)["']?\s+TO\s+["']?(\w+)["']?/gi;
  while ((m = renameColRe.exec(sql)) !== null) {
    if (!isReservedSQLWord(m[1])) columns.add(m[1]);
    if (!isReservedSQLWord(m[2])) columns.add(m[2]);
  }

  return columns;
}

/** Find column references in SQL queries within source code. */
function findColumnInQueries(content: string, column: string): string[] {
  const refs: string[] = [];
  const escaped = escapeRegex(column);

  // Look for column in SQL string contexts
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: new RegExp(`SELECT\\b[^;]*\\b${escaped}\\b`, 'gi'), label: 'SELECT' },
    { re: new RegExp(`INSERT\\s+INTO\\s+\\w+\\s*\\([^)]*\\b${escaped}\\b`, 'gi'), label: 'INSERT' },
    { re: new RegExp(`UPDATE\\b[^;]*\\bSET\\b[^;]*\\b${escaped}\\b`, 'gi'), label: 'UPDATE' },
    { re: new RegExp(`WHERE\\b[^;]*\\b${escaped}\\b`, 'gi'), label: 'WHERE' },
    { re: new RegExp(`ORDER\\s+BY\\b[^;]*\\b${escaped}\\b`, 'gi'), label: 'ORDER BY' },
    { re: new RegExp(`GROUP\\s+BY\\b[^;]*\\b${escaped}\\b`, 'gi'), label: 'GROUP BY' },
  ];

  for (const { re, label } of patterns) {
    if (re.test(content)) {
      refs.push(label);
      break; // One reference type is enough evidence
    }
  }
  return refs;
}

/** Find the most likely replacement column from a set of new columns. */
function findLikelyColumnReplacement(oldCol: string, newColumns: Set<string>): string | null {
  // Check for columns in new set that weren't in old
  for (const nc of newColumns) {
    if (nc === oldCol) continue;
    // Simple: if only one new column exists, it's likely the replacement
    return nc;
  }
  return null;
}

/** Extract environment variable keys from text. */
function extractEnvKeys(text: string): string[] {
  const keys: string[] = [];
  // Match KEY=value lines (env file format)
  const envLineRe = /^([A-Z_][A-Z0-9_]*)\s*=(?!=)/gm;
  let m: RegExpExecArray | null;
  while ((m = envLineRe.exec(text)) !== null) keys.push(m[1]);

  // Match process.env.KEY references
  const processEnvRe = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((m = processEnvRe.exec(text)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }

  // Match import.meta.env.KEY (Vite)
  const metaEnvRe = /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g;
  while ((m = metaEnvRe.exec(text)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }

  return keys;
}

/** Find env var consumer patterns in source code. */
function findEnvConsumers(content: string, key: string): string[] {
  const consumers: string[] = [];
  const escaped = escapeRegex(key);
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: new RegExp(`process\\.env\\.${escaped}\\b`), label: 'process.env' },
    { re: new RegExp(`import\\.meta\\.env\\.${escaped}\\b`), label: 'import.meta.env' },
    { re: new RegExp(`os\\.environ(?:\\.get)?\\s*\\(?\\s*['"]${escaped}['"]`), label: 'os.environ' },
    { re: new RegExp(`\\$\\{${escaped}\\}`), label: 'template interpolation' },
    { re: new RegExp(`^${escaped}\\s*=`, 'm'), label: 'env definition' },
  ];
  for (const { re, label } of patterns) {
    if (re.test(content)) {
      consumers.push(label);
      break;
    }
  }
  return consumers;
}

/** Extract import/require paths from source code. */
function extractImportPaths(text: string): string[] {
  const paths: string[] = [];
  // require('./path') or require("./path")
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(text)) !== null) paths.push(m[1]);

  // import ... from './path' or import './path'
  const importRe = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(text)) !== null) paths.push(m[1]);

  // Dynamic import: import('./path')
  const dynImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynImportRe.exec(text)) !== null) paths.push(m[1]);

  return [...new Set(paths)];
}

/** Find import/require references to a specific path in content. */
function findImportReferences(content: string, importPath: string): string[] {
  const refs: string[] = [];
  const escaped = escapeRegex(importPath);
  if (new RegExp(`require\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`).test(content)) {
    refs.push('require()');
  }
  if (new RegExp(`import\\s+(?:.*?\\s+from\\s+)?['"]${escaped}['"]`).test(content)) {
    refs.push('import');
  }
  if (new RegExp(`import\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`).test(content)) {
    refs.push('dynamic import()');
  }
  return refs;
}

/** Resolve an import path relative to the importing file. */
function resolveImportPath(baseDir: string, fromFile: string, importPath: string): string | null {
  const fromDir = dirname(join(baseDir, fromFile));
  const resolved = join(fromDir, importPath);

  // Try exact path, then with common extensions
  const candidates = [
    resolved,
    resolved + '.js', resolved + '.ts', resolved + '.jsx', resolved + '.tsx',
    resolved + '.mjs', resolved + '.cjs',
    join(resolved, 'index.js'), join(resolved, 'index.ts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/** Check if a string is a reserved SQL keyword (avoid false positives on column detection). */
function isReservedSQLWord(word: string): boolean {
  const reserved = new Set([
    'primary', 'key', 'not', 'null', 'default', 'unique', 'check', 'foreign',
    'references', 'constraint', 'index', 'create', 'table', 'alter', 'drop',
    'insert', 'into', 'values', 'select', 'from', 'where', 'update', 'set',
    'delete', 'and', 'or', 'in', 'on', 'if', 'exists', 'true', 'false',
    'integer', 'text', 'varchar', 'boolean', 'timestamp', 'serial', 'bigint',
    'smallint', 'real', 'float', 'double', 'decimal', 'numeric', 'date',
    'time', 'json', 'jsonb', 'uuid', 'bytea', 'char', 'int',
    'cascade', 'restrict', 'action', 'now', 'current_timestamp',
    'add', 'column', 'rename', 'to', 'with', 'as', 'like', 'between',
  ]);
  return reserved.has(word.toLowerCase());
}

/** Check if a file path is a source file (JS/TS/HTML). */
function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SOURCE_EXTS.has(ext);
}

/** Safely read a file, returning null on any error. */
function safeRead(path: string): string | null {
  try { return existsSync(path) ? readFileSync(path, 'utf-8') : null; }
  catch { return null; }
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collect text files from baseDir for cross-reference scanning (max depth 3). */
function collectScannableFiles(baseDir: string, excludeFiles: Set<string>): Array<{ relative: string; content: string }> {
  const results: Array<{ relative: string; content: string }> = [];

  function scan(dir: string, prefix: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || (entry.startsWith('.') && !ENV_NAMES.includes(entry))) continue;
      const full = join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;

      // Try as directory first
      try { readdirSync(full); scan(full, relative, depth + 1); continue; } catch { /* file */ }

      if (excludeFiles.has(relative)) continue;

      const ext = extname(entry).toLowerCase();
      if (TEXT_EXTS.has(ext) || ENV_NAMES.includes(entry)) {
        const content = safeRead(full);
        if (content && content.length < 500_000) results.push({ relative, content });
      }
    }
  }

  scan(baseDir, '', 0);
  return results;
}

/** Check if a propagation gate is relevant for the given edits. */
export function isPropagationRelevant(edits: Edit[]): boolean {
  return edits.length > 0;
}
