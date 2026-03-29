/**
 * Real-World HTTP Harvester
 * =========================
 *
 * Reads real JSON Schema test suites and converts to verify scenarios.
 * Tests HTTP/serialization predicates against real validation cases.
 *
 * Input: JSON Schema Test Suite (git clone)
 *   {cacheDir}/json-schema-test-suite/repo/tests/draft2020-12/*.json
 *   Each file: { description, schema, tests: [{ description, data, valid }] }
 *
 * Output: VerifyScenario[] with source: 'real-world'
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

interface JSONSchemaTestGroup {
  description: string;
  schema: Record<string, any>;
  tests: Array<{
    description: string;
    data: any;
    valid: boolean;
  }>;
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

/**
 * Convert JSON Schema test suite files into HTTP/serialization verify scenarios.
 */
export function harvestHTTP(files: string[], maxScenarios: number): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  let counter = 0;

  // Find JSON Schema test suite files
  const jsonSchemaFiles = files.filter(f => f.endsWith('.json') && !f.includes('_meta'));

  for (const filePath of jsonSchemaFiles) {
    if (scenarios.length >= maxScenarios) break;

    let groups: JSONSchemaTestGroup[];
    try {
      const content = readFileSync(filePath, 'utf-8');
      groups = JSON.parse(content);
      if (!Array.isArray(groups)) continue;
    } catch {
      continue;
    }

    const category = basename(filePath, '.json');

    for (const group of groups) {
      if (scenarios.length >= maxScenarios) break;
      if (!group.tests || !Array.isArray(group.tests)) continue;

      for (const test of group.tests) {
        if (scenarios.length >= maxScenarios) break;
        counter++;

        const schemaStr = JSON.stringify(group.schema);
        const dataStr = JSON.stringify(test.data);

        // Create a scenario that injects a JSON schema validation endpoint
        // and tests whether the data conforms
        const schemaSnippet = schemaStr.length > 100 ? schemaStr.substring(0, 100) + '...' : schemaStr;

        scenarios.push({
          id: `rw-http-jss-${String(counter).padStart(4, '0')}`,
          description: `JSON Schema ${category}: ${group.description} — ${test.description}`,
          edits: [{
            file: 'server.js',
            search: "res.end(JSON.stringify({ status: 'ok' }));",
            replace: `res.end(JSON.stringify({ status: 'ok', schema: ${schemaStr}, data: ${dataStr}, valid: ${test.valid} }));`,
          }],
          predicates: [{
            type: 'serialization',
            file: 'server.js',
            schema: group.schema,
            data: test.data,
            assertion: test.valid ? 'valid' : 'invalid',
          }],
          expectedSuccess: true, // the gate should correctly classify valid/invalid
          tags: ['http', 'real-world', 'json-schema', category, test.valid ? 'valid' : 'invalid'],
          rationale: `Real JSON Schema test: ${group.description}. Data ${test.valid ? 'conforms to' : 'violates'} schema. Schema: ${schemaSnippet}`,
          source: 'real-world',
        });
      }
    }
  }

  console.log(`  harvest-http: parsed ${jsonSchemaFiles.length} test files, generated ${scenarios.length} scenarios`);
  return scenarios;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone test
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const testDir = process.argv[2];
  if (!testDir) {
    console.log('Usage: bun scripts/supply/harvest-http.ts <cache-dir>');
    console.log('  cache-dir should contain json-schema-test-suite/repo/tests/draft2020-12/*.json');
    process.exit(1);
  }

  const repoDir = join(testDir, 'json-schema-test-suite', 'repo', 'tests', 'draft2020-12');
  if (!existsSync(repoDir)) {
    console.log(`Not found: ${repoDir}`);
    console.log('Run the fetch step first to populate the cache.');
    process.exit(1);
  }

  const files = readdirSync(repoDir)
    .filter(f => f.endsWith('.json'))
    .map(f => join(repoDir, f));

  const scenarios = harvestHTTP(files, 100);
  console.log(`\nGenerated ${scenarios.length} scenarios`);
  for (const s of scenarios.slice(0, 5)) {
    console.log(`  ${s.id}: ${s.description.substring(0, 80)}`);
  }
}
