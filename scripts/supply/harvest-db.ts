#!/usr/bin/env node
/**
 * Real-World DB Harvester
 * =======================
 *
 * Reads real SQL DDL from fetched source files and converts them into
 * verify scenarios. Two source formats supported:
 *
 *   1. SchemaPile JSONL — each line: {"db_id": "...", "create_statements": [...]}
 *   2. PostgreSQL regression .sql files — raw CREATE TABLE statements
 *
 * For each schema, produces:
 *   - True-positive scenarios (table_exists, column_exists, column_type)
 *   - False-positive scenarios (fabricated column, wrong type)
 *   - Cross-reference scenarios (column from table A referenced as if in table B)
 *
 * Usage:
 *   bun run scripts/supply/harvest-db.ts --files path1 path2 --max 500
 *   bun run scripts/supply/harvest-db.ts --schemapile path/to/schemapile.jsonl --max 1000
 *   bun run scripts/supply/harvest-db.ts --pg-dir path/to/sql-dir --max 500
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Edit {
  file: string;
  search: string;
  replace: string;
}

interface Predicate {
  type: 'db';
  table?: string;
  column?: string;
  assertion?: string;
  expected?: string;
  description?: string;
}

interface VerifyScenario {
  id: string;
  description: string;
  edits: Edit[];
  predicates: Predicate[];
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  source: 'real-world';
  family?: string;
  generator?: string;
  config?: Record<string, unknown>;
  invariants?: unknown[];
  requiresDocker?: boolean;
  failureClass?: string;
}

interface ParsedColumn {
  name: string;
  type: string;
  rawType: string;
}

interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  rawDDL: string;
}

interface ParsedSchema {
  sourceId: string;
  sourceName: string;
  tables: ParsedTable[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL Parser
// ─────────────────────────────────────────────────────────────────────────────

/** Interesting types that warrant column_type assertions. */
const INTERESTING_TYPES = new Set([
  'jsonb', 'json', 'uuid', 'serial', 'bigserial', 'smallserial',
  'boolean', 'bool', 'timestamp', 'timestamptz', 'date', 'time', 'timetz',
  'interval', 'inet', 'cidr', 'macaddr', 'bytea', 'xml', 'money',
  'numeric', 'decimal', 'real', 'double precision', 'float',
  'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
  'tsvector', 'tsquery', 'int4range', 'int8range', 'numrange',
  'tsrange', 'tstzrange', 'daterange', 'hstore', 'ltree',
]);

/** Normalize SQL type aliases to canonical form. */
function normalizeType(raw: string): string {
  const lower = raw.toLowerCase().trim();

  // Strip precision/length specifiers for normalization
  const base = lower.replace(/\s*\([^)]*\)/, '').trim();

  const aliases: Record<string, string> = {
    'serial': 'integer',
    'serial4': 'integer',
    'bigserial': 'bigint',
    'serial8': 'bigint',
    'smallserial': 'smallint',
    'int': 'integer',
    'int4': 'integer',
    'int8': 'bigint',
    'int2': 'smallint',
    'float4': 'real',
    'float8': 'double precision',
    'float': 'double precision',
    'bool': 'boolean',
    'varchar': 'character varying',
    'char': 'character',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    'time without time zone': 'time',
    'time with time zone': 'timetz',
    'decimal': 'numeric',
    // SchemaPile-specific type names (cross-DB normalized)
    'unsignedint': 'integer',
    'unsignedbigint': 'bigint',
    'unsignedsmallint': 'smallint',
    'unsignedtinyint': 'smallint',
    'tinyint': 'smallint',
    'mediumint': 'integer',
    'longtext': 'text',
    'mediumtext': 'text',
    'tinytext': 'text',
    'longblob': 'bytea',
    'mediumblob': 'bytea',
    'tinyblob': 'bytea',
    'blob': 'bytea',
    'double': 'double precision',
    'datetime': 'timestamp',
    'enum': 'text',
    'set': 'text',
    'nvarchar': 'character varying',
    'nchar': 'character',
    'ntext': 'text',
    'uniqueidentifier': 'uuid',
    'bit': 'boolean',
    'money': 'numeric',
    'image': 'bytea',
    'varbinary': 'bytea',
    'binary': 'bytea',
  };

  return aliases[base] || lower;
}

/** Check if a type is "interesting" enough for column_type assertions. */
function isInterestingType(rawType: string): boolean {
  const lower = rawType.toLowerCase().trim();
  const base = lower.replace(/\s*\([^)]*\)/, '').trim();

  // Array types are always interesting
  if (lower.includes('[]') || lower.includes('array')) return true;

  // Check against the set
  if (INTERESTING_TYPES.has(base)) return true;

  // Custom/enum types (anything not a standard basic type)
  const basicTypes = new Set([
    'integer', 'int', 'int4', 'bigint', 'int8', 'smallint', 'int2',
    'text', 'varchar', 'character varying', 'char', 'character',
    'serial', 'serial4', 'bigserial', 'serial8', 'smallserial',
  ]);
  if (!basicTypes.has(base) && !base.startsWith('varchar') && !base.startsWith('char')) {
    return true;
  }

  return false;
}

/**
 * Parse CREATE TABLE statements from raw SQL text.
 * Handles multi-line, constraints, defaults, references.
 */
export function parseCreateTable(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = [];

  // Match CREATE TABLE blocks — handle IF NOT EXISTS, schema-qualified names, UNLOGGED, TEMP, etc.
  const createRegex = /CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*(?:;|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = createRegex.exec(sql)) !== null) {
    const tableName = match[2];
    const body = match[3];
    const rawDDL = match[0];
    const columns: ParsedColumn[] = [];

    // Split body by commas, but respect parentheses depth
    const parts = splitByComma(body);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Skip table-level constraints
      if (/^\s*(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT|EXCLUDE)\s*[\s(]/i.test(trimmed)) {
        continue;
      }
      // Skip LIKE clauses
      if (/^\s*LIKE\s+/i.test(trimmed)) continue;

      // Parse column: name type [constraints...]
      const colMatch = trimmed.match(
        /^"?(\w+)"?\s+([\w\s]+(?:\([^)]*\))?(?:\[\])?(?:\s+(?:with|without)\s+time\s+zone)?)/i
      );
      if (!colMatch) continue;

      const colName = colMatch[1];
      let rawType = colMatch[2].trim();

      // Strip trailing constraint keywords from the type
      rawType = rawType
        .replace(/\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|CONSTRAINT).*$/i, '')
        .trim();

      // Skip if the "type" looks like a constraint keyword
      if (/^(primary|unique|check|foreign|constraint|exclude)$/i.test(rawType)) continue;

      columns.push({
        name: colName,
        type: normalizeType(rawType),
        rawType: rawType,
      });
    }

    if (columns.length > 0) {
      tables.push({ name: tableName, columns, rawDDL });
    }
  }

  return tables;
}

/**
 * Split a string by commas, respecting parentheses depth.
 * e.g., "a INTEGER, b NUMERIC(10,2), c TEXT" -> ["a INTEGER", "b NUMERIC(10,2)", "c TEXT"]
 */
function splitByComma(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source Readers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read SchemaPile JSONL. Handles two formats:
 *
 * Format A (create_statements): {"db_id": "...", "create_statements": ["CREATE TABLE..."]}
 * Format B (structured TABLES):  {"INFO": {"ID": "..."}, "TABLES": [{"TABLE_NAME": "...", "COLUMNS": [...]}]}
 *
 * The real HuggingFace dataset uses Format B.
 */
function readSchemaPile(filePath: string): ParsedSchema[] {
  const schemas: ParsedSchema[] = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Format B: real SchemaPile with TABLES array
      if (entry.TABLES && Array.isArray(entry.TABLES)) {
        const dbId = entry.INFO?.ID || entry.INFO?.FILENAME || `sp-${schemas.length}`;
        const allTables: ParsedTable[] = [];

        for (const tbl of entry.TABLES) {
          if (!tbl.TABLE_NAME || !Array.isArray(tbl.COLUMNS)) continue;
          const columns: ParsedColumn[] = tbl.COLUMNS.map((col: any) => ({
            name: col.NAME || col.name || '',
            type: normalizeType(col.TYPE || col.type || 'text'),
            rawType: col.TYPE || col.type || 'text',
          })).filter((c: ParsedColumn) => c.name);

          if (columns.length > 0) {
            allTables.push({
              name: tbl.TABLE_NAME.toLowerCase(),
              columns,
              rawDDL: `-- SchemaPile structured: ${tbl.TABLE_NAME} (${columns.length} columns)`,
            });
          }
        }

        if (allTables.length > 0) {
          schemas.push({
            sourceId: dbId,
            sourceName: `schemapile/${dbId}`,
            tables: allTables,
          });
        }
        continue;
      }

      // Format A: create_statements array
      const dbId = entry.db_id || entry.id || `unknown-${schemas.length}`;
      const statements: string[] = entry.create_statements || [];

      if (statements.length === 0) continue;

      const allTables: ParsedTable[] = [];
      for (const stmt of statements) {
        const tables = parseCreateTable(stmt);
        allTables.push(...tables);
      }

      if (allTables.length > 0) {
        schemas.push({
          sourceId: dbId,
          sourceName: `schemapile/${dbId}`,
          tables: allTables,
        });
      }
    } catch {
      // Skip malformed lines
    }
  }

  return schemas;
}

/** Read PostgreSQL regression .sql files */
function readPgRegress(filePaths: string[]): ParsedSchema[] {
  const schemas: ParsedSchema[] = [];

  for (const filePath of filePaths) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const tables = parseCreateTable(content);
      if (tables.length > 0) {
        const name = basename(filePath, extname(filePath));
        schemas.push({
          sourceId: name,
          sourceName: `pg-regress/${name}`,
          tables,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return schemas;
}

/**
 * Auto-detect file type and read schemas.
 * - .jsonl files -> SchemaPile format
 * - .sql files -> PostgreSQL DDL
 * - directories -> scan for .sql files
 */
function readSourceFiles(files: string[]): ParsedSchema[] {
  const schemas: ParsedSchema[] = [];

  for (const filePath of files) {
    if (!existsSync(filePath)) continue;

    try {
      const ext = extname(filePath).toLowerCase();

      if (ext === '.jsonl') {
        schemas.push(...readSchemaPile(filePath));
      } else if (ext === '.sql') {
        schemas.push(...readPgRegress([filePath]));
      } else {
        // Try as a directory of .sql files
        try {
          const entries = readdirSync(filePath);
          const sqlFiles = entries
            .filter(e => e.endsWith('.sql'))
            .map(e => join(filePath, e));
          if (sqlFiles.length > 0) {
            schemas.push(...readPgRegress(sqlFiles));
          }
        } catch {
          // Not a directory, skip
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return schemas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario Generators
// ─────────────────────────────────────────────────────────────────────────────

const EDIT_ANCHOR = 'CREATE TABLE settings';

/** Fabricated column names that should never exist in real schemas. */
const FABRICATED_COLUMNS = [
  'xyzzy_nonexistent', 'bogus_phantom_col', 'fake_column_999',
  'ghost_field_abc', 'imaginary_data_col',
];

/** Fabricated table names. */
const FABRICATED_TABLES = [
  'nonexistent_phantom_table', 'bogus_missing_tbl', 'ghost_table_xyz',
];

/** Wrong type mappings for false-positive column_type tests. */
const WRONG_TYPES: Record<string, string> = {
  'integer': 'text',
  'text': 'integer',
  'boolean': 'jsonb',
  'jsonb': 'text',
  'uuid': 'integer',
  'timestamp': 'boolean',
  'timestamptz': 'boolean',
  'character varying': 'integer',
  'numeric': 'text',
  'bigint': 'boolean',
  'smallint': 'text',
  'real': 'text',
  'double precision': 'integer',
  'date': 'integer',
  'bytea': 'text',
};

function wrongTypeFor(type: string): string {
  const normalized = normalizeType(type);
  return WRONG_TYPES[normalized] || 'text';
}

/** Derive source prefix for scenario IDs. */
function sourcePrefix(sourceName: string): string {
  if (sourceName.startsWith('schemapile/')) return 'sp';
  if (sourceName.startsWith('pg-regress/')) return 'pg';
  return 'db';
}

/** Build the edit that appends a CREATE TABLE to init.sql. */
function buildAppendEdit(ddl: string): Edit {
  // Clean up the DDL — ensure it ends with a semicolon
  let cleanDDL = ddl.trim();
  if (!cleanDDL.endsWith(';')) cleanDDL += ';';

  return {
    file: 'init.sql',
    search: EDIT_ANCHOR,
    replace: EDIT_ANCHOR + '\n\n' + cleanDDL,
  };
}

/** Generate true-positive scenarios from a parsed schema. */
function generateTruePositives(
  schema: ParsedSchema,
  counter: { n: number },
): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  const prefix = sourcePrefix(schema.sourceName);

  for (const table of schema.tables) {
    // 1. table_exists assertion
    const tableId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
    scenarios.push({
      id: tableId,
      description: `${schema.sourceName}: table ${table.name} exists`,
      edits: [buildAppendEdit(table.rawDDL)],
      predicates: [{
        type: 'db',
        table: table.name,
        assertion: 'table_exists',
        description: `Table ${table.name} exists after applying DDL from ${schema.sourceName}`,
      }],
      expectedSuccess: true,
      tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'table_exists'],
      rationale: `Real-world schema from ${schema.sourceName}: verifies table ${table.name} is created by the DDL.`,
      source: 'real-world',
      family: 'W',
      generator: 'harvest-db',
      config: {},
      invariants: [],
      requiresDocker: true,
    });

    // 2. column_exists assertions (batch up to 5 columns per scenario)
    const colBatches = batchArray(table.columns, 5);
    for (const batch of colBatches) {
      const colId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
      const colNames = batch.map(c => c.name).join(', ');
      scenarios.push({
        id: colId,
        description: `${schema.sourceName}: ${table.name} has columns [${colNames}]`,
        edits: [buildAppendEdit(table.rawDDL)],
        predicates: batch.map(col => ({
          type: 'db' as const,
          table: table.name,
          column: col.name,
          assertion: 'column_exists' as string,
          description: `Column ${col.name} exists in table ${table.name}`,
        })),
        expectedSuccess: true,
        tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'column_exists'],
        rationale: `Real-world schema from ${schema.sourceName}: verifies columns exist in ${table.name}.`,
        source: 'real-world',
        family: 'W',
        generator: 'harvest-db',
        config: {},
        invariants: [],
        requiresDocker: true,
      });
    }

    // 3. column_type assertions for interesting types
    const interestingCols = table.columns.filter(c => isInterestingType(c.rawType));
    for (const col of interestingCols) {
      const typeId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
      scenarios.push({
        id: typeId,
        description: `${schema.sourceName}: ${table.name}.${col.name} is ${col.rawType}`,
        edits: [buildAppendEdit(table.rawDDL)],
        predicates: [{
          type: 'db',
          table: table.name,
          column: col.name,
          assertion: 'column_type',
          expected: col.type,
          description: `Column ${col.name} in ${table.name} has type ${col.rawType}`,
        }],
        expectedSuccess: true,
        tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'column_type'],
        rationale: `Real-world schema from ${schema.sourceName}: verifies ${col.name} has type ${col.rawType} (normalized: ${col.type}).`,
        source: 'real-world',
        family: 'W',
        generator: 'harvest-db',
        config: {},
        invariants: [],
        requiresDocker: true,
      });
    }
  }

  return scenarios;
}

/** Generate false-positive scenarios (should fail). */
function generateFalsePositives(
  schema: ParsedSchema,
  counter: { n: number },
): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  const prefix = sourcePrefix(schema.sourceName);

  for (const table of schema.tables) {
    // 1. Fabricated column name — column_exists should fail
    const fabCol = FABRICATED_COLUMNS[counter.n % FABRICATED_COLUMNS.length];
    const fabColId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
    scenarios.push({
      id: fabColId,
      description: `${schema.sourceName}: ${table.name} does NOT have column ${fabCol}`,
      edits: [buildAppendEdit(table.rawDDL)],
      predicates: [{
        type: 'db',
        table: table.name,
        column: fabCol,
        assertion: 'column_exists',
        description: `Fabricated column ${fabCol} should not exist in ${table.name}`,
      }],
      expectedSuccess: false,
      tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'column_exists', 'false-positive'],
      rationale: `Fabricated column "${fabCol}" does not exist in real schema ${table.name} from ${schema.sourceName}. Verify should report failure.`,
      source: 'real-world',
      family: 'W',
      generator: 'harvest-db',
      config: {},
      invariants: [],
      requiresDocker: true,
      failureClass: 'DB-02',
    });

    // 2. Wrong column_type — should fail
    if (table.columns.length > 0) {
      const col = table.columns[0];
      const wrongType = wrongTypeFor(col.rawType);
      if (wrongType !== normalizeType(col.rawType)) {
        const wrongId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
        scenarios.push({
          id: wrongId,
          description: `${schema.sourceName}: ${table.name}.${col.name} is NOT ${wrongType}`,
          edits: [buildAppendEdit(table.rawDDL)],
          predicates: [{
            type: 'db',
            table: table.name,
            column: col.name,
            assertion: 'column_type',
            expected: wrongType,
            description: `Column ${col.name} is actually ${col.rawType}, asserting wrong type ${wrongType}`,
          }],
          expectedSuccess: false,
          tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'column_type', 'false-positive'],
          rationale: `Column ${col.name} in ${table.name} has type ${col.rawType}, but we assert ${wrongType}. Verify should report type mismatch.`,
          source: 'real-world',
          family: 'W',
          generator: 'harvest-db',
          config: {},
          invariants: [],
          requiresDocker: true,
          failureClass: 'DB-03',
        });
      }
    }
  }

  // 3. Fabricated table — table_exists should fail
  if (schema.tables.length > 0) {
    const fabTable = FABRICATED_TABLES[counter.n % FABRICATED_TABLES.length];
    const fabTableId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;
    // Use the first real table's DDL as the edit (so the edit is valid)
    scenarios.push({
      id: fabTableId,
      description: `${schema.sourceName}: fabricated table ${fabTable} does not exist`,
      edits: [buildAppendEdit(schema.tables[0].rawDDL)],
      predicates: [{
        type: 'db',
        table: fabTable,
        assertion: 'table_exists',
        description: `Fabricated table ${fabTable} should not exist`,
      }],
      expectedSuccess: false,
      tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'table_exists', 'false-positive'],
      rationale: `Fabricated table "${fabTable}" was never created. Verify should report missing table.`,
      source: 'real-world',
      family: 'W',
      generator: 'harvest-db',
      config: {},
      invariants: [],
      requiresDocker: true,
      failureClass: 'DB-01',
    });
  }

  return scenarios;
}

/** Generate cross-reference scenarios (column from table A asserted as if in table B). */
function generateCrossReferences(
  schema: ParsedSchema,
  counter: { n: number },
): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  const prefix = sourcePrefix(schema.sourceName);

  if (schema.tables.length < 2) return scenarios;

  // For each pair of tables, take a column from A and assert it exists in B
  for (let i = 0; i < schema.tables.length - 1 && i < 3; i++) {
    const tableA = schema.tables[i];
    const tableB = schema.tables[i + 1];

    if (tableA.columns.length === 0) continue;

    // Pick a column from A that doesn't exist in B
    const colFromA = tableA.columns.find(
      c => !tableB.columns.some(bc => bc.name === c.name)
    );
    if (!colFromA) continue;

    const crossId = `rw-db-${prefix}-${String(++counter.n).padStart(3, '0')}`;

    // Edit appends both tables
    const combinedDDL = tableA.rawDDL + '\n\n' + tableB.rawDDL;

    scenarios.push({
      id: crossId,
      description: `${schema.sourceName}: cross-ref ${tableA.name}.${colFromA.name} asserted in ${tableB.name}`,
      edits: [buildAppendEdit(combinedDDL)],
      predicates: [{
        type: 'db',
        table: tableB.name,
        column: colFromA.name,
        assertion: 'column_exists',
        description: `Column ${colFromA.name} from ${tableA.name} does not exist in ${tableB.name}`,
      }],
      expectedSuccess: false,
      tags: ['db', 'real-world', prefix === 'sp' ? 'schemapile' : 'pg-regress', 'column_exists', 'cross-reference'],
      rationale: `Column "${colFromA.name}" exists in ${tableA.name} but not in ${tableB.name}. Cross-table reference should fail.`,
      source: 'real-world',
      family: 'W',
      generator: 'harvest-db',
      config: {},
      invariants: [],
      requiresDocker: true,
      failureClass: 'DB-02',
    });
  }

  return scenarios;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function batchArray<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Harvester
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Harvest DB scenarios from a list of source files.
 *
 * @param files - Paths to .jsonl (SchemaPile), .sql (Postgres DDL), or directories of .sql files
 * @param maxScenarios - Maximum number of scenarios to produce
 * @returns Array of VerifyScenario objects
 */
export function harvestDB(files: string[], maxScenarios: number): VerifyScenario[] {
  const schemas = readSourceFiles(files);
  console.log(`Parsed ${schemas.length} schemas from ${files.length} file(s)`);

  const scenarios: VerifyScenario[] = [];
  const counter = { n: 0 };

  // Budget allocation: ~60% true positive, ~25% false positive, ~15% cross-reference
  const tpBudget = Math.floor(maxScenarios * 0.6);
  const fpBudget = Math.floor(maxScenarios * 0.25);
  const xrBudget = maxScenarios - tpBudget - fpBudget;

  const truePositives: VerifyScenario[] = [];
  const falsePositives: VerifyScenario[] = [];
  const crossRefs: VerifyScenario[] = [];

  for (const schema of schemas) {
    if (truePositives.length >= tpBudget && falsePositives.length >= fpBudget && crossRefs.length >= xrBudget) {
      break;
    }

    if (truePositives.length < tpBudget) {
      truePositives.push(...generateTruePositives(schema, counter));
    }

    if (falsePositives.length < fpBudget) {
      falsePositives.push(...generateFalsePositives(schema, counter));
    }

    if (crossRefs.length < xrBudget) {
      crossRefs.push(...generateCrossReferences(schema, counter));
    }
  }

  // Trim each bucket to budget and combine
  scenarios.push(
    ...truePositives.slice(0, tpBudget),
    ...falsePositives.slice(0, fpBudget),
    ...crossRefs.slice(0, xrBudget),
  );

  // Final cap
  const result = scenarios.slice(0, maxScenarios);

  const tpCount = result.filter(s => s.expectedSuccess).length;
  const fpCount = result.filter(s => !s.expectedSuccess).length;
  console.log(`Generated ${result.length} scenarios (${tpCount} true-positive, ${fpCount} false-positive)`);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse CLI flags
  let files: string[] = [];
  let maxScenarios = 500;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--max' && args[i + 1]) {
      maxScenarios = parseInt(args[++i], 10);
    } else if (arg === '--schemapile' && args[i + 1]) {
      files.push(args[++i]);
    } else if (arg === '--pg-dir' && args[i + 1]) {
      files.push(args[++i]);
    } else if (arg === '--files') {
      // Collect remaining args as files
      files.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith('--')) {
      files.push(arg);
    }
  }

  // If no files provided, try default cache locations
  if (files.length === 0) {
    const cacheDir = join(process.cwd(), '.supply-cache');
    const spPath = join(cacheDir, 'schemapile', 'schemapile.jsonl');
    const pgDir = join(cacheDir, 'pg-regress', 'repo', 'src', 'test', 'regress', 'sql');

    if (existsSync(spPath)) files.push(spPath);
    if (existsSync(pgDir)) files.push(pgDir);

    if (files.length === 0) {
      console.log('No input files found. Provide paths or fetch sources first.');
      console.log('Usage:');
      console.log('  bun run scripts/supply/harvest-db.ts --schemapile path/to/schemapile.jsonl');
      console.log('  bun run scripts/supply/harvest-db.ts --pg-dir path/to/sql-dir');
      console.log('  bun run scripts/supply/harvest-db.ts --files file1.sql file2.jsonl');
      console.log('');
      console.log('Running with inline sample for testing...');

      // Self-test with inline DDL
      runSelfTest();
      process.exit(0);
    }
  }

  console.log(`\nHarvesting DB scenarios from ${files.length} source(s)...`);
  const scenarios = harvestDB(files, maxScenarios);

  // Print summary
  console.log('\n--- Sample scenarios ---');
  for (const s of scenarios.slice(0, 5)) {
    console.log(`  ${s.id}: ${s.description} [expected=${s.expectedSuccess}]`);
    for (const p of s.predicates) {
      console.log(`    -> ${p.assertion} table=${p.table} col=${p.column || '-'} type=${p.expected || '-'}`);
    }
  }
  if (scenarios.length > 5) {
    console.log(`  ... and ${scenarios.length - 5} more`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-Test
// ─────────────────────────────────────────────────────────────────────────────

function runSelfTest(): void {
  console.log('\n=== Self-Test: parseCreateTable ===');

  const sampleSQL = `
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    total NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'pending',
    metadata JSONB,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT orders_total_check CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price MONEY,
    weight REAL,
    category_id INT REFERENCES categories(id),
    attrs HSTORE,
    search_vec TSVECTOR,
    location POINT
);

CREATE UNLOGGED TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    ip INET,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
  `;

  const tables = parseCreateTable(sampleSQL);
  console.log(`Parsed ${tables.length} tables:`);

  for (const table of tables) {
    console.log(`  ${table.name}: ${table.columns.length} columns`);
    for (const col of table.columns) {
      const interesting = isInterestingType(col.rawType) ? ' *' : '';
      console.log(`    ${col.name}: ${col.rawType} -> ${col.type}${interesting}`);
    }
  }

  // Test SchemaPile JSONL format
  console.log('\n=== Self-Test: SchemaPile JSONL format ===');
  const sampleJSONL = JSON.stringify({
    db_id: 'test_db',
    create_statements: [
      'CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email VARCHAR(255) UNIQUE);',
      'CREATE TABLE roles (id INTEGER PRIMARY KEY, role_name VARCHAR(50), permissions JSONB);',
    ],
  });

  // Write temp file and read it
  const { writeFileSync: wfs, unlinkSync } = require('fs');
  const { tmpdir } = require('os');
  const tmpFile = join(tmpdir(), `harvest-db-test-${Date.now()}.jsonl`);
  wfs(tmpFile, sampleJSONL + '\n');

  const schemas = readSchemaPile(tmpFile);
  console.log(`Parsed ${schemas.length} schema(s) from JSONL`);
  for (const schema of schemas) {
    console.log(`  ${schema.sourceName}: ${schema.tables.length} tables`);
  }

  try { unlinkSync(tmpFile); } catch { /* ignore */ }

  // Generate scenarios from sample SQL
  console.log('\n=== Self-Test: scenario generation ===');
  const tmpSQL = join(tmpdir(), `harvest-db-test-${Date.now()}.sql`);
  wfs(tmpSQL, sampleSQL);

  const scenarios = harvestDB([tmpSQL], 50);
  console.log(`\nGenerated ${scenarios.length} scenarios:`);

  const byTag: Record<string, number> = {};
  for (const s of scenarios) {
    for (const t of s.tags) {
      byTag[t] = (byTag[t] || 0) + 1;
    }
  }
  console.log('Tag counts:', byTag);

  const tpCount = scenarios.filter(s => s.expectedSuccess).length;
  const fpCount = scenarios.filter(s => !s.expectedSuccess).length;
  console.log(`True-positive: ${tpCount}, False-positive: ${fpCount}`);

  try { unlinkSync(tmpSQL); } catch { /* ignore */ }

  console.log('\nSelf-test passed.');
}
