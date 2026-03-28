/**
 * Temporal Gate — Cross-File Staleness Detection
 * ================================================
 *
 * Detects TEMPORAL failure patterns — when an agent's edits change one surface
 * but leave dependent surfaces stale (ordering, timing, readiness violations).
 *
 * Five drift categories:
 *   port_mismatch          — PORT in source disagrees with EXPOSE or compose mapping
 *   config_divergence      — env value changed but stale default remains in source
 *   missing_rebuild        — dependency file changed without Docker build trigger
 *   cross_file_reference   — renamed identifier still referenced by old name elsewhere
 *   migration_ordering     — migration references table from nonexistent prior migration
 *
 * Runs after F9 (edits applied) and before staging.
 * No Docker required. Pure filesystem reads.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename, extname } from 'path';
import type { GateResult, GateContext, Edit } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

export type TemporalDriftType =
  | 'port_mismatch'
  | 'config_divergence'
  | 'missing_rebuild'
  | 'cross_file_reference'
  | 'migration_ordering';

export interface TemporalDrift {
  type: TemporalDriftType;
  severity: 'error' | 'warning';
  sourceFile: string;
  staleFile: string;
  detail: string;
  sourceValue: string;
  staleValue: string;
}

export interface TemporalGateResult extends GateResult {
  drifts: TemporalDrift[];
}

// =============================================================================
// WELL-KNOWN FILES
// =============================================================================

const SERVER_FILES = ['server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts', 'main.js', 'main.ts'];
const DOCKERFILE_NAMES = ['Dockerfile', 'dockerfile'];
const COMPOSE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const ENV_NAMES = ['.env', '.env.local', '.env.production', '.env.development'];

const DEPENDENCY_FILES = new Set([
  'package.json', 'package-lock.json', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock',
  'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock',
  'Cargo.toml', 'Cargo.lock', 'composer.json', 'composer.lock',
]);

const BUILD_TRIGGER_FILES = new Set([
  'Dockerfile', 'dockerfile', '.dockerignore',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
]);

// =============================================================================
// EXTRACTION PATTERNS
// =============================================================================

const PORT_PATTERNS_SOURCE: RegExp[] = [
  /(?:const|let|var)\s+(?:PORT|port)\s*=\s*(\d+)/,
  /\.listen\(\s*(\d+)/,
  /process\.env\.PORT\s*\|\|\s*(\d+)/,
  /port:\s*(\d+)/,
];

const EXPOSE_PATTERN = /^EXPOSE\s+(\d+)/m;
const COMPOSE_PORT_PATTERN = /['"]?(\d+):(\d+)['"]?/;
const ENV_LINE_RE = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/gm;

// =============================================================================
// MAIN GATE
// =============================================================================

/**
 * Run temporal drift analysis against the staging workspace (post-edit state).
 */
export function runTemporalGate(ctx: GateContext): TemporalGateResult {
  const start = Date.now();
  const baseDir = ctx.stageDir ?? ctx.config.appDir;
  const drifts: TemporalDrift[] = [];
  const editedFiles = new Set(ctx.edits.map(e => e.file));

  drifts.push(...detectPortMismatch(baseDir, editedFiles));
  drifts.push(...detectConfigDivergence(baseDir, ctx.edits));
  drifts.push(...detectMissingRebuild(baseDir, editedFiles));
  drifts.push(...detectCrossFileReferences(baseDir, ctx.edits, editedFiles));
  drifts.push(...detectMigrationOrdering(baseDir, editedFiles));

  const errors = drifts.filter(d => d.severity === 'error');
  const warnings = drifts.filter(d => d.severity === 'warning');
  const passed = errors.length === 0;

  let detail: string;
  if (drifts.length === 0) {
    detail = 'No temporal drifts detected';
  } else if (passed) {
    detail = `${warnings.length} temporal warning(s): ${warnings.map(w => w.detail).join('; ')}`;
  } else {
    detail = `${errors.length} temporal error(s), ${warnings.length} warning(s): `
      + errors.map(e => e.detail).join('; ');
  }

  return {
    gate: 'temporal' as any,
    passed,
    detail,
    durationMs: Date.now() - start,
    drifts,
  };
}

// =============================================================================
// DETECTOR 1: Port Mismatch
// =============================================================================

function detectPortMismatch(baseDir: string, editedFiles: Set<string>): TemporalDrift[] {
  const drifts: TemporalDrift[] = [];

  // Only check if a source file was edited
  if (!SERVER_FILES.some(f => editedFiles.has(f))) return drifts;

  // Find PORT in post-edit source
  let sourcePort: string | null = null;
  let sourceFile: string | null = null;
  for (const name of SERVER_FILES) {
    const content = safeRead(join(baseDir, name));
    if (!content) continue;
    for (const pattern of PORT_PATTERNS_SOURCE) {
      const match = pattern.exec(content);
      if (match) { sourcePort = match[1]; sourceFile = name; break; }
    }
    if (sourcePort) break;
  }
  if (!sourcePort || !sourceFile) return drifts;

  // Only flag port mismatch when the EDIT INTRODUCES the divergence.
  // If the agent edits server.js port but doesn't touch Dockerfile/compose,
  // the mismatch is either pre-existing or an intentional scoping decision —
  // not a temporal drift caused by this edit set.
  // True temporal drift: agent edits BOTH server.js and Dockerfile but
  // leaves them inconsistent, or edits Dockerfile without updating source.
  const dockerfileEdited = DOCKERFILE_NAMES.some(f => editedFiles.has(f));
  const composeEdited = COMPOSE_NAMES.some(f => editedFiles.has(f));

  // Check Dockerfile EXPOSE — only flag if the Dockerfile was also edited
  if (dockerfileEdited) {
    for (const name of DOCKERFILE_NAMES) {
      if (!editedFiles.has(name)) continue;
      const content = safeRead(join(baseDir, name));
      if (!content) continue;
      const match = EXPOSE_PATTERN.exec(content);
      if (match && match[1] !== sourcePort) {
        drifts.push({
          type: 'port_mismatch', severity: 'error', sourceFile, staleFile: name,
          detail: `Port ${sourcePort} in ${sourceFile} but EXPOSE ${match[1]} in ${name}`,
          sourceValue: sourcePort, staleValue: match[1],
        });
      }
    }
  }

  // Check docker-compose port mappings — only flag if compose was also edited
  if (composeEdited) {
    for (const name of COMPOSE_NAMES) {
      if (!editedFiles.has(name)) continue;
      const content = safeRead(join(baseDir, name));
      if (!content) continue;
      for (const line of extractComposePortLines(content)) {
        const match = COMPOSE_PORT_PATTERN.exec(line);
        if (match && match[2] !== sourcePort) {
          drifts.push({
            type: 'port_mismatch', severity: 'error', sourceFile, staleFile: name,
            detail: `Port ${sourcePort} in ${sourceFile} but container port ${match[2]} in ${name}`,
            sourceValue: sourcePort, staleValue: match[2],
          });
        }
      }
    }
  }

  return drifts;
}

// =============================================================================
// DETECTOR 2: Config/Env Divergence
// =============================================================================

function detectConfigDivergence(baseDir: string, edits: Edit[]): TemporalDrift[] {
  const drifts: TemporalDrift[] = [];

  for (const edit of edits) {
    if (!ENV_NAMES.includes(edit.file)) continue;

    // Extract changed env vars from the edit
    const searchLines = edit.search.split('\n');
    const replaceLines = edit.replace.split('\n');

    for (let i = 0; i < searchLines.length; i++) {
      const sMatch = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(searchLines[i]?.trim() ?? '');
      const rMatch = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(replaceLines[i]?.trim() ?? '');
      if (!sMatch || !rMatch || sMatch[1] !== rMatch[1]) continue;

      const varName = sMatch[1];
      const oldVal = sMatch[2].trim();
      const newVal = rMatch[2].trim();
      if (oldVal === newVal) continue;

      // Search source files for stale default using the OLD value
      for (const srcName of SERVER_FILES) {
        const srcContent = safeRead(join(baseDir, srcName));
        if (!srcContent) continue;
        const re = new RegExp(
          `process\\.env\\.${varName}\\s*\\|\\|\\s*['"]?${escapeRegex(oldVal)}['"]?`
        );
        if (re.test(srcContent)) {
          drifts.push({
            type: 'config_divergence', severity: 'warning',
            sourceFile: edit.file, staleFile: srcName,
            detail: `${varName}=${newVal} in ${edit.file} but default still ${oldVal} in ${srcName}`,
            sourceValue: newVal, staleValue: oldVal,
          });
        }
      }
    }
  }

  return drifts;
}

// =============================================================================
// DETECTOR 3: Missing Rebuild Trigger
// =============================================================================

function detectMissingRebuild(baseDir: string, editedFiles: Set<string>): TemporalDrift[] {
  const drifts: TemporalDrift[] = [];

  const editedDeps = [...editedFiles].filter(f => DEPENDENCY_FILES.has(basename(f)));
  if (editedDeps.length === 0) return drifts;

  // If a build trigger was also edited, no issue
  if ([...editedFiles].some(f => BUILD_TRIGGER_FILES.has(basename(f)))) return drifts;

  // Find the Dockerfile
  let dockerfileName = '';
  let dockerfileContent = '';
  for (const name of DOCKERFILE_NAMES) {
    const content = safeRead(join(baseDir, name));
    if (content) { dockerfileName = name; dockerfileContent = content; break; }
  }
  if (!dockerfileName) return drifts; // Not a Docker project

  for (const depFile of editedDeps) {
    const depBase = basename(depFile);
    // Check if Dockerfile copies this dependency file (making it a cached layer)
    const copyPattern = new RegExp(`COPY\\s+.*${escapeRegex(depBase)}`, 'i');
    if (copyPattern.test(dockerfileContent) || /COPY\s+\.\s/i.test(dockerfileContent)) {
      drifts.push({
        type: 'missing_rebuild', severity: 'error',
        sourceFile: depFile, staleFile: dockerfileName,
        detail: `${depFile} changed but no build trigger file edited — Docker cache may serve stale deps`,
        sourceValue: 'modified', staleValue: 'unchanged (needs --no-cache or Dockerfile touch)',
      });
    }
  }

  return drifts;
}

// =============================================================================
// DETECTOR 4: Cross-File Reference Staleness
// =============================================================================

function detectCrossFileReferences(baseDir: string, edits: Edit[], editedFiles: Set<string>): TemporalDrift[] {
  const drifts: TemporalDrift[] = [];

  // Extract tokens that were renamed (present in search, absent in replace)
  const renames: Array<{ old: string; replacement: string; file: string }> = [];

  for (const edit of edits) {
    // Route renames: '/api/users' → '/api/people'
    const oldRoutes = extractRoutes(edit.search);
    const newRoutes = extractRoutes(edit.replace);
    for (const oldR of oldRoutes) {
      if (!newRoutes.includes(oldR) && newRoutes.length > 0) {
        renames.push({ old: oldR, replacement: newRoutes[0], file: edit.file });
      }
    }

    // Identifier renames (function/class/const names, min length 4 to avoid noise)
    const oldIds = extractIdentifiers(edit.search);
    const newIds = extractIdentifiers(edit.replace);
    for (const oldId of oldIds) {
      if (oldId.length < 4 || edit.replace.includes(oldId)) continue;
      const candidate = newIds.find(n => !edit.search.includes(n));
      if (candidate) {
        renames.push({ old: oldId, replacement: candidate, file: edit.file });
      }
    }
  }

  if (renames.length === 0) return drifts;

  // Scan non-edited files for stale references
  const scannableFiles = collectScannable(baseDir, editedFiles);
  for (const { old: oldToken, replacement, file: srcFile } of renames) {
    for (const { relative, content } of scannableFiles) {
      if (editedFiles.has(relative)) continue;
      if (content.includes(oldToken)) {
        drifts.push({
          type: 'cross_file_reference', severity: 'warning',
          sourceFile: srcFile, staleFile: relative,
          detail: `"${oldToken}" renamed to "${replacement}" in ${srcFile} but still referenced in ${relative}`,
          sourceValue: replacement, staleValue: oldToken,
        });
      }
    }
  }

  return drifts;
}

// =============================================================================
// DETECTOR 5: Migration Ordering
// =============================================================================

function detectMigrationOrdering(baseDir: string, editedFiles: Set<string>): TemporalDrift[] {
  const drifts: TemporalDrift[] = [];

  const editedMigrations = [...editedFiles].filter(f =>
    f.startsWith('migrations/') || f.startsWith('migrations\\')
  );
  if (editedMigrations.length === 0) return drifts;

  // Collect migration files in order
  const migrationsDir = join(baseDir, 'migrations');
  let migrationFiles: string[] = [];
  try {
    migrationFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  } catch { return drifts; }

  // Build cumulative table set: init.sql first, then migrations in order
  const knownTables = new Set<string>();
  const initContent = safeRead(join(baseDir, 'init.sql'));
  if (initContent) {
    for (const t of extractCreatedTables(initContent)) knownTables.add(t.toLowerCase());
  }

  for (const migFile of migrationFiles) {
    const content = safeRead(join(migrationsDir, migFile));
    if (!content) continue;

    const relative = `migrations/${migFile}`;
    const isEdited = editedMigrations.some(f =>
      f === relative || f.endsWith(`/${migFile}`) || f.endsWith(`\\${migFile}`)
    );

    if (isEdited) {
      // Check REFERENCES / FOREIGN KEY for unknown tables
      for (const ref of extractReferencedTables(content)) {
        if (!knownTables.has(ref.toLowerCase())) {
          drifts.push({
            type: 'migration_ordering', severity: 'error',
            sourceFile: relative, staleFile: relative,
            detail: `${migFile} references table "${ref}" not created by any prior migration or init.sql`,
            sourceValue: `REFERENCES ${ref}`, staleValue: `table "${ref}" not found`,
          });
        }
      }

      // Check ALTER TABLE targets
      for (const table of extractAlteredTables(content)) {
        if (!knownTables.has(table.toLowerCase())) {
          drifts.push({
            type: 'migration_ordering', severity: 'error',
            sourceFile: relative, staleFile: relative,
            detail: `${migFile} alters table "${table}" not created by any prior migration or init.sql`,
            sourceValue: `ALTER TABLE ${table}`, staleValue: `table "${table}" not found`,
          });
        }
      }
    }

    // Add this migration's created tables to the known set
    for (const t of extractCreatedTables(content)) knownTables.add(t.toLowerCase());
  }

  return drifts;
}

// =============================================================================
// HELPERS
// =============================================================================

function safeRead(path: string): string | null {
  try { return existsSync(path) ? readFileSync(path, 'utf-8') : null; }
  catch { return null; }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRoutes(code: string): string[] {
  const routes: string[] = [];
  const re = /['"`](\/[a-zA-Z0-9/_:-]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) routes.push(m[1]);
  return routes;
}

function extractIdentifiers(code: string): string[] {
  const ids: string[] = [];
  const re = /(?:function|const|let|var|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) ids.push(m[1]);
  return ids;
}

function extractCreatedTables(sql: string): string[] {
  const tables: string[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) tables.push(m[1]);
  return tables;
}

function extractReferencedTables(sql: string): string[] {
  const seen = new Set<string>();
  const tables: string[] = [];
  const patterns = [
    /REFERENCES\s+["']?(\w+)["']?/gi,
    /FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+["']?(\w+)["']?/gi,
  ];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      if (!seen.has(name)) { seen.add(name); tables.push(m[1]); }
    }
  }
  return tables;
}

function extractAlteredTables(sql: string): string[] {
  const tables: string[] = [];
  const re = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) tables.push(m[1]);
  return tables;
}

/** Extract port lines from docker-compose YAML (simple line parser, no YAML lib). */
function extractComposePortLines(content: string): string[] {
  const lines = content.split('\n');
  const portLines: string[] = [];
  let inPorts = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^ports:\s*$/i.test(trimmed)) { inPorts = true; continue; }
    if (/^ports:\s*\[/i.test(trimmed)) { portLines.push(trimmed); continue; }
    if (inPorts) {
      if (trimmed.startsWith('-')) portLines.push(trimmed);
      else if (trimmed.length > 0 && !trimmed.startsWith('#')) inPorts = false;
    }
  }
  return portLines;
}

/** Collect text files from baseDir for cross-reference scanning (max depth 3). */
function collectScannable(baseDir: string, editedFiles: Set<string>): Array<{ relative: string; content: string }> {
  const results: Array<{ relative: string; content: string }> = [];
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '__pycache__']);
  const TEXT_EXTS = new Set([
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.yml', '.yaml',
    '.toml', '.sql', '.md', '.txt', '.html', '.css', '.env', '.py', '.rb',
    '.go', '.rs', '.sh',
  ]);

  function scan(dir: string, prefix: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (SKIP.has(entry) || (entry.startsWith('.') && !ENV_NAMES.includes(entry))) continue;
      const full = join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;

      // Try as directory first
      try { readdirSync(full); scan(full, relative, depth + 1); continue; } catch { /* file */ }

      const ext = extname(entry).toLowerCase();
      if (TEXT_EXTS.has(ext) || DOCKERFILE_NAMES.includes(entry) || ENV_NAMES.includes(entry)) {
        const content = safeRead(full);
        if (content && content.length < 500_000) results.push({ relative, content });
      }
    }
  }

  scan(baseDir, '', 0);
  return results;
}

/** Check if edits are present (temporal gate is relevant for any non-empty edit set). */
export function isTemporalRelevant(edits: Edit[]): boolean {
  return edits.length > 0;
}
