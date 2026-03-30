/**
 * Hallucination Gate — Deterministic Claim Verification
 * =====================================================
 *
 * Checks whether agent claims about the codebase are grounded in reality.
 * NO LLM in the pipeline. Claims are verified against files, schema, routes,
 * config, and CSS using existing parsers.
 *
 * Predicate type: 'hallucination'
 * Fields:
 *   claim:     What the agent asserts ("users table has phone column")
 *   source:    Where to verify ('schema', 'routes', 'css', 'config', or a file path)
 *   halAssert: 'grounded' (claim should be true) | 'fabricated' (claim should be false)
 *
 * 15 shapes (HAL-01 through HAL-15):
 *   Factual fabrication (HAL-01 to HAL-05)
 *   Schema/structure fabrication (HAL-06 to HAL-10)
 *   Reasoning fabrication (HAL-11 to HAL-15)
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import type { GateContext, GateResult, Predicate } from '../types.js';
import { parseInitSQL } from './grounding.js';

// =============================================================================
// PUBLIC API
// =============================================================================

export function runHallucinationGate(ctx: GateContext): GateResult {
  const start = Date.now();
  const { predicates, config, log } = ctx;
  const appDir = ctx.stageDir ?? config.appDir;

  const halPreds = predicates.filter(p => p.type === 'hallucination');
  if (halPreds.length === 0) {
    return { gate: 'hallucination', passed: true, detail: 'No hallucination predicates', durationMs: Date.now() - start };
  }

  const failures: string[] = [];

  for (const pred of halPreds) {
    if (!pred.claim) {
      failures.push('Missing claim field on hallucination predicate');
      continue;
    }
    if (!pred.source) {
      failures.push(`Missing source field for claim: "${pred.claim}"`);
      continue;
    }
    if (!pred.halAssert || (pred.halAssert !== 'grounded' && pred.halAssert !== 'fabricated')) {
      failures.push(`Invalid halAssert for claim: "${pred.claim}" (must be 'grounded' or 'fabricated')`);
      continue;
    }

    const claimExists = checkClaim(pred.claim, pred.source, appDir);

    if (pred.halAssert === 'grounded' && !claimExists) {
      failures.push(`Claim NOT grounded: "${pred.claim}" (source: ${pred.source}) — claim not found in source`);
    } else if (pred.halAssert === 'fabricated' && claimExists) {
      failures.push(`Claim NOT fabricated: "${pred.claim}" (source: ${pred.source}) — claim exists but was expected to be fabricated`);
    }
  }

  if (failures.length > 0) {
    const detail = `${failures.length} hallucination check(s) failed:\n${failures.map(f => `  - ${f}`).join('\n')}`;
    log(`[hallucination] FAILED: ${detail}`);
    return { gate: 'hallucination', passed: false, detail, durationMs: Date.now() - start };
  }

  return {
    gate: 'hallucination',
    passed: true,
    detail: `${halPreds.length} hallucination claim(s) verified`,
    durationMs: Date.now() - start,
  };
}

// =============================================================================
// CLAIM VERIFICATION — dispatch by source type
// =============================================================================

function checkClaim(claim: string, source: string, appDir: string): boolean {
  switch (source) {
    case 'schema':
      return checkSchemaClaim(claim, appDir);
    case 'routes':
      return checkRouteClaim(claim, appDir);
    case 'css':
      return checkCSSClaim(claim, appDir);
    case 'config':
      return checkConfigClaim(claim, appDir);
    case 'files':
      return checkFileExistenceClaim(claim, appDir);
    case 'content':
      return checkContentClaim(claim, appDir);
    default:
      // Source is a file path — check if claim text exists in that file
      return checkFileContentClaim(claim, source, appDir);
  }
}

// =============================================================================
// SCHEMA CLAIMS — checked against init.sql via parseInitSQL
// =============================================================================

function checkSchemaClaim(claim: string, appDir: string): boolean {
  const schema = loadSchema(appDir);
  if (!schema || schema.length === 0) return false;

  const lower = claim.toLowerCase();

  // "X table exists" / "table X"
  const tableExistsMatch = lower.match(/(\w+)\s+table\s+(?:exists|has|is)/i)
    ?? lower.match(/table\s+(\w+)/i);
  if (tableExistsMatch) {
    const tableName = tableExistsMatch[1];
    // If the claim is ONLY about table existence, check that
    if (/exists/i.test(lower) && !/column|has\s+\w+\s+column/i.test(lower)) {
      return schema.some(t => t.table.toLowerCase() === tableName);
    }
  }

  // "X table has Y column" / "Y column in X table" / "X.Y"
  const colMatch = lower.match(/(\w+)\s+table\s+has\s+(\w+)\s+column/i)
    ?? lower.match(/(\w+)\.(\w+)/i)
    ?? lower.match(/(\w+)\s+has\s+(\w+)/i);
  if (colMatch) {
    const tableName = colMatch[1];
    const colName = colMatch[2];
    const table = schema.find(t => t.table.toLowerCase() === tableName);
    if (!table) return false;
    return table.columns.some(c => c.name.toLowerCase() === colName);
  }

  // "Y column type is Z" / "Y is Z type" / "Y column is Z"
  const typeMatch = lower.match(/(\w+)\s+column\s+type\s+is\s+(\w+)/i)
    ?? lower.match(/(\w+)\s+(?:is\s+(?:type\s+)?|has\s+type\s+|type\s+is\s+)(\w+)/i);
  if (typeMatch) {
    const colName = typeMatch[1];
    const expectedType = typeMatch[2];
    for (const table of schema) {
      const col = table.columns.find(c => c.name.toLowerCase() === colName);
      if (col && col.type.toLowerCase().startsWith(expectedType.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  // "foreign key from X.Y to Z" / "X references Z"
  // Check if the claim mentions a relationship — look for REFERENCES in raw SQL
  if (/foreign\s*key|references/i.test(lower)) {
    const rawSQL = loadRawSQL(appDir);
    if (!rawSQL) return false;
    return rawSQL.toLowerCase().includes(claim.toLowerCase().replace(/\s+/g, ' '));
  }

  // Fallback: check if any table/column name from the claim exists
  const words = lower.split(/\s+/);
  for (const table of schema) {
    if (words.includes(table.table.toLowerCase())) return true;
    for (const col of table.columns) {
      if (words.includes(col.name.toLowerCase())) return true;
    }
  }

  return false;
}

// =============================================================================
// ROUTE CLAIMS — checked against server.js route handlers
// =============================================================================

function checkRouteClaim(claim: string, appDir: string): boolean {
  const content = loadServerContent(appDir);
  if (!content) return false;

  const routes = extractRoutes(content);

  // Extract route path from claim: "/api/users", "POST /api/v2/users", etc.
  const routeMatch = claim.match(/(GET|POST|PUT|DELETE|PATCH)?\s*(\/[\w/.-]*)/i);
  if (routeMatch) {
    const method = routeMatch[1]?.toUpperCase();
    const path = routeMatch[2];

    // Check if route exists
    const routeExists = routes.some(r => r.path === path);
    if (!routeExists) return false;

    // If method specified, check method too
    if (method) {
      return routes.some(r => r.path === path && r.method.toUpperCase() === method);
    }
    return true;
  }

  // Fallback: check if claim text appears in content
  return content.toLowerCase().includes(claim.toLowerCase());
}

// =============================================================================
// CSS CLAIMS — checked against style blocks in source files
// =============================================================================

function checkCSSClaim(claim: string, appDir: string): boolean {
  const content = loadServerContent(appDir);
  if (!content) return false;

  const cssRules = extractCSS(content);

  // ".selector" or "selector has property" or "selector property is value"
  const selectorMatch = claim.match(/\.?([\w.-]+(?:\s+[\w.-]+)?)\s+(?:has\s+|)(\w[\w-]*)\s*(?:is\s+|=\s*|:\s*)([\w#%().,\s-]+)/i)
    ?? claim.match(/selector\s+\.?([\w.-]+)/i);

  if (selectorMatch && selectorMatch[2]) {
    const selector = selectorMatch[1].startsWith('.') ? selectorMatch[1] : `.${selectorMatch[1]}`;
    const property = selectorMatch[2];
    const value = selectorMatch[3]?.trim();

    // Find rules by exact or substring match (handles descendant selectors)
    let rules: Record<string, string> | undefined;
    rules = cssRules.get(selector);
    if (!rules) {
      for (const [key, val] of cssRules.entries()) {
        if (key.includes(selector)) { rules = val; break; }
      }
    }
    if (!rules) return false;
    if (!property) return true; // just checking selector exists
    if (!value) return property in rules;
    return rules[property]?.toLowerCase() === value.toLowerCase();
  }

  // Check if a selector exists (may be part of a compound/descendant selector)
  const justSelector = claim.match(/\.?([\w-]+)\s+(?:exists|selector|class)/i);
  if (justSelector) {
    const sel = justSelector[1].startsWith('.') ? justSelector[1] : `.${justSelector[1]}`;
    // Exact match or substring match (for descendant selectors like ".card .card-title")
    for (const key of cssRules.keys()) {
      if (key === sel || key.includes(sel)) return true;
    }
    return false;
  }

  return false;
}

// =============================================================================
// CONFIG CLAIMS — checked against config.json
// =============================================================================

function checkConfigClaim(claim: string, appDir: string): boolean {
  const config = loadConfig(appDir);
  if (!config) return false;

  // "key X exists" / "X.Y exists" / "X.Y is Z"
  const keyMatch = claim.match(/([\w.]+)\s+(?:exists|is\s+|=\s*|has\s+value\s+)(.*)?/i)
    ?? claim.match(/([\w.]+)/);
  if (!keyMatch) return false;

  const keyPath = keyMatch[1];
  const expectedValue = keyMatch[2]?.trim();

  const actual = resolveKeyPath(config, keyPath);
  if (actual === undefined) return false;
  if (!expectedValue || /exists/i.test(claim)) return true;

  // Compare values
  return String(actual).toLowerCase() === expectedValue.toLowerCase();
}

// =============================================================================
// FILE EXISTENCE CLAIMS — does a file or function exist?
// =============================================================================

function checkFileExistenceClaim(claim: string, appDir: string): boolean {
  // Extract file path from claim
  const pathMatch = claim.match(/([\w/.-]+\.\w+)/);
  if (pathMatch) {
    const filePath = join(appDir, pathMatch[1]);
    return existsSync(filePath);
  }

  // Check for directory
  const dirMatch = claim.match(/([\w/.-]+\/)/);
  if (dirMatch) {
    const dirPath = join(appDir, dirMatch[1]);
    return existsSync(dirPath);
  }

  return false;
}

// =============================================================================
// CONTENT CLAIMS — does a pattern/text exist in source files?
// =============================================================================

function checkContentClaim(claim: string, appDir: string): boolean {
  // Search all source files for the claim text
  const sourceFiles = findSourceFiles(appDir);
  const lower = claim.toLowerCase();

  for (const file of sourceFiles) {
    try {
      const content = readFileSync(file, 'utf-8').toLowerCase();
      if (content.includes(lower)) return true;
    } catch { /* read error */ }
  }

  return false;
}

// =============================================================================
// FILE CONTENT CLAIMS — does claim text exist in a specific file?
// =============================================================================

function checkFileContentClaim(claim: string, filePath: string, appDir: string): boolean {
  const fullPath = join(appDir, filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    return content.toLowerCase().includes(claim.toLowerCase());
  } catch {
    return false;
  }
}

// =============================================================================
// HELPERS — file loading, parsing, caching
// =============================================================================

function loadSchema(appDir: string): Array<{ table: string; columns: Array<{ name: string; type: string }> }> | null {
  const candidates = [
    join(appDir, 'init.sql'),
    join(appDir, 'db', 'init.sql'),
    join(appDir, 'sql', 'init.sql'),
    join(appDir, 'schema.sql'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const sql = readFileSync(candidate, 'utf-8');
        const parsed = parseInitSQL(sql);
        if (parsed.length > 0) return parsed;
      } catch { /* read error */ }
    }
  }
  return null;
}

function loadRawSQL(appDir: string): string | null {
  const candidates = [
    join(appDir, 'init.sql'),
    join(appDir, 'db', 'init.sql'),
    join(appDir, 'sql', 'init.sql'),
    join(appDir, 'schema.sql'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf-8');
      } catch { /* read error */ }
    }
  }
  return null;
}

function loadServerContent(appDir: string): string | null {
  const candidates = [
    join(appDir, 'server.js'),
    join(appDir, 'server.ts'),
    join(appDir, 'app.js'),
    join(appDir, 'app.ts'),
    join(appDir, 'index.js'),
    join(appDir, 'index.ts'),
    join(appDir, 'src', 'server.js'),
    join(appDir, 'src', 'server.ts'),
    join(appDir, 'src', 'index.js'),
    join(appDir, 'src', 'index.ts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, 'utf-8');
      } catch { /* read error */ }
    }
  }
  return null;
}

function loadConfig(appDir: string): Record<string, unknown> | null {
  const candidates = [
    join(appDir, 'config.json'),
    join(appDir, 'config.js'),
    join(appDir, 'settings.json'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && extname(candidate) === '.json') {
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8'));
      } catch { /* parse error */ }
    }
  }
  return null;
}

function resolveKeyPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function findSourceFiles(appDir: string): string[] {
  const files: string[] = [];
  const sourceExts = new Set(['.js', '.ts', '.jsx', '.tsx', '.sql', '.json', '.html', '.css']);

  try {
    const entries = readdirSync(appDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(appDir, entry.name);
      if (entry.isFile() && sourceExts.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  } catch { /* dir read error */ }

  return files;
}

// =============================================================================
// ROUTE EXTRACTION — lightweight, local to this gate
// =============================================================================

interface RouteInfo {
  method: string;
  path: string;
}

function extractRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];

  // Express-style: app.get('/path', ...
  const expressPattern = /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  while ((match = expressPattern.exec(content)) !== null) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }

  // Vanilla HTTP: if (req.url === '/path') with optional method check
  const vanillaPattern = /(?:req\.url|url\.pathname)\s*===?\s*['"`]([^'"`]+)['"`]/gi;
  while ((match = vanillaPattern.exec(content)) !== null) {
    // Try to find method from nearby context
    const method = inferMethod(content, match.index);
    routes.push({ method, path: match[1] });
  }

  return routes;
}

function inferMethod(content: string, matchIndex: number): string {
  // Look backwards up to 200 chars for method check
  const before = content.slice(Math.max(0, matchIndex - 200), matchIndex);
  const methodMatch = before.match(/req\.method\s*===?\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
  return methodMatch ? methodMatch[1].toUpperCase() : 'GET';
}

// =============================================================================
// CSS EXTRACTION — lightweight, local to this gate
// =============================================================================

function extractCSS(content: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();

  const styleBlockPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const cssBlocks: string[] = [];

  let match;
  while ((match = styleBlockPattern.exec(content)) !== null) {
    cssBlocks.push(match[1]);
  }

  for (const block of cssBlocks) {
    const rulePattern = /([^{}]+)\{([^{}]+)\}/g;
    while ((match = rulePattern.exec(block)) !== null) {
      const selector = match[1].trim();
      if (selector.startsWith('@')) continue;

      const props: Record<string, string> = {};
      const propPattern = /([a-z-]+)\s*:\s*([^;]+)/gi;
      let propMatch;
      while ((propMatch = propPattern.exec(match[2])) !== null) {
        props[propMatch[1].trim()] = propMatch[2].trim();
      }

      const existing = rules.get(selector) ?? {};
      rules.set(selector, { ...existing, ...props });
    }
  }

  return rules;
}
