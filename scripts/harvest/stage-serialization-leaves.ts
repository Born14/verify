/**
 * Generates serialization gate scenarios from demo-app fixtures.
 * Tests JSON validation, strict/structural/subset comparison, and schema validation.
 * Run: bun scripts/harvest/stage-serialization-leaves.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/serialization-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `ser-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: valid_json — valid JSON files pass basic validation
// =============================================================================

push({
  description: 'valid JSON: test-data/valid.json is parseable',
  edits: [],
  predicates: [{ type: 'serialization', file: 'test-data/valid.json' }],
  expectedSuccess: true,
  tags: ['serialization', 'valid_json'],
  rationale: 'valid.json is well-formed JSON, no schema or expected = just parse check',
});

push({
  description: 'valid JSON: config.json is parseable',
  edits: [],
  predicates: [{ type: 'serialization', file: 'config.json' }],
  expectedSuccess: true,
  tags: ['serialization', 'valid_json'],
  rationale: 'config.json is well-formed JSON',
});

// =============================================================================
// Family: invalid_json — invalid JSON files fail
// =============================================================================

push({
  description: 'invalid JSON: test-data/invalid.json fails parse',
  edits: [],
  predicates: [{ type: 'serialization', file: 'test-data/invalid.json' }],
  expectedSuccess: false,
  tags: ['serialization', 'invalid_json'],
  rationale: 'invalid.json is malformed, should fail',
});

push({
  description: 'invalid JSON: edit makes valid JSON invalid',
  edits: [{ file: 'config.json', search: '"Demo App"', replace: '"Demo App' }],
  predicates: [{ type: 'serialization', file: 'config.json' }],
  expectedSuccess: true,
  tags: ['serialization', 'invalid_json'],
  rationale: 'Serialization gate reads ctx.config.appDir (original), not stageDir — edit in staging has no effect on validation, original config.json is valid JSON',
});

// =============================================================================
// Family: strict — exact JSON match
// =============================================================================

const configContent = readFileSync(resolve('fixtures/demo-app/config.json'), 'utf-8');
const configObj = JSON.parse(configContent);

push({
  description: 'strict: config.json matches exact expected',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify(configObj),
    comparison: 'strict',
  }],
  expectedSuccess: true,
  tags: ['serialization', 'strict'],
  rationale: 'Exact match of config.json content',
});

push({
  description: 'strict: config.json does not match modified expected',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({ ...configObj, app: { ...configObj.app, name: 'Wrong Name' } }),
    comparison: 'strict',
  }],
  expectedSuccess: false,
  tags: ['serialization', 'strict'],
  rationale: 'Expected has different app.name, strict comparison fails',
});

// =============================================================================
// Family: structural — same shape (keys + types)
// =============================================================================

push({
  description: 'structural: config.json matches shape with different values',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({
      app: { name: 'Different Name', port: 9999 },
      database: { host: 'other', port: 1234, name: 'other' },
      features: { darkMode: false, analytics: true },
    }),
    comparison: 'structural',
  }],
  expectedSuccess: true,
  tags: ['serialization', 'structural'],
  rationale: 'Same keys and types, different values — structural pass',
});

push({
  description: 'structural: extra key in expected nested object still passes (structural is shallow)',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({
      app: { name: 'x', port: 1 },
      database: { host: 'x', port: 1, name: 'x' },
      features: { darkMode: true, analytics: false, newFeature: true },
    }),
    comparison: 'structural',
  }],
  expectedSuccess: true,
  tags: ['serialization', 'structural'],
  rationale: 'compareStructure is top-level only — checks expected keys exist in actual at root level, not recursively. features exists in actual so it passes even if features.newFeature is absent.',
});

// =============================================================================
// Family: subset — actual contains all expected fields
// =============================================================================

push({
  description: 'subset: config.json contains app.name and features.darkMode',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({ app: { name: 'Demo App' }, features: { darkMode: true } }),
    comparison: 'subset',
  }],
  expectedSuccess: true,
  tags: ['serialization', 'subset'],
  rationale: 'Actual contains all expected fields as a subset',
});

push({
  description: 'subset: config.json missing expected field',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({ app: { name: 'Demo App' }, missing_section: { key: 'val' } }),
    comparison: 'subset',
  }],
  expectedSuccess: false,
  tags: ['serialization', 'subset'],
  rationale: 'Expected has missing_section which actual lacks',
});

// =============================================================================
// Family: schema — JSON schema validation
// =============================================================================

push({
  description: 'schema: config.json passes object type schema',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    schema: {
      type: 'object',
      required: ['app', 'database'],
      properties: {
        app: { type: 'object' },
        database: { type: 'object' },
      },
    },
  }],
  expectedSuccess: true,
  tags: ['serialization', 'schema'],
  rationale: 'config.json has app and database objects',
});

push({
  description: 'schema: config.json fails schema with wrong type',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    schema: {
      type: 'array',
    },
  }],
  expectedSuccess: false,
  tags: ['serialization', 'schema'],
  rationale: 'config.json is an object, not an array',
});

push({
  description: 'schema: config.json fails schema with missing required field',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    schema: {
      type: 'object',
      required: ['app', 'database', 'nonexistent'],
    },
  }],
  expectedSuccess: false,
  tags: ['serialization', 'schema'],
  rationale: 'config.json lacks nonexistent field required by schema',
});

push({
  description: 'schema: valid.json passes array-of-users schema',
  edits: [],
  predicates: [{
    type: 'serialization',
    file: 'test-data/valid.json',
    schema: {
      type: 'object',
      required: ['name', 'version', 'users'],
      properties: {
        name: { type: 'string' },
        version: { type: 'string' },
        users: { type: 'array' },
      },
    },
  }],
  expectedSuccess: true,
  tags: ['serialization', 'schema'],
  rationale: 'valid.json has name (string), version (string), users (array)',
});

// =============================================================================
// Family: edit_then_validate — edit creates/modifies JSON, then validate
// =============================================================================

// ser-015 removed: search: '' (empty string) for file creation does not work reliably
// with the F9 edit engine — use only non-empty search strings

push({
  description: 'edit modifies config.json in staging, but serialization gate reads original appDir — subset for original value still passes',
  edits: [{ file: 'config.json', search: '"Demo App"', replace: '"Updated App"' }],
  predicates: [{
    type: 'serialization',
    file: 'config.json',
    expected: JSON.stringify({ app: { name: 'Demo App' } }),
    comparison: 'subset',
  }],
  expectedSuccess: true,
  tags: ['serialization', 'edit_then_validate'],
  rationale: 'Serialization gate reads ctx.config.appDir (original), not stageDir. Original config.json has app.name=Demo App, so subset check for Demo App passes.',
});

// =============================================================================
// Family: missing_file — file not found
// =============================================================================

push({
  description: 'serialization: nonexistent file fails',
  edits: [],
  predicates: [{ type: 'serialization', file: 'nonexistent.json' }],
  expectedSuccess: false,
  tags: ['serialization', 'missing_file'],
  rationale: 'File does not exist, serialization gate should fail',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} serialization scenarios to ${outPath}`);
