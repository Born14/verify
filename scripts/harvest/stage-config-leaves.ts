/**
 * Generates config gate scenarios from demo-app fixtures.
 * Tests .env (dotenv), JSON, and YAML config key/value checks.
 * Run: bun scripts/harvest/stage-config-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/config-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `cfg-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: env_exists — .env key existence checks
// =============================================================================

const envKeys = ['NODE_ENV', 'PORT', 'DATABASE_URL', 'SECRET_KEY', 'DEBUG'];

for (const key of envKeys) {
  push({
    description: `env exists: ${key} exists in .env`,
    edits: [],
    predicates: [{ type: 'config', key, expected: 'exists' }],
    expectedSuccess: true,
    tags: ['config', 'env_exists'],
    rationale: `${key} is defined in demo-app .env`,
  });
}

push({
  description: 'env exists: nonexistent key fails',
  edits: [],
  predicates: [{ type: 'config', key: 'NONEXISTENT_KEY', expected: 'exists' }],
  expectedSuccess: false,
  tags: ['config', 'env_exists_fail'],
  rationale: 'NONEXISTENT_KEY is not in any config file',
});

// =============================================================================
// Family: env_value — .env key value checks
// =============================================================================

push({
  description: 'env value: NODE_ENV == production',
  edits: [],
  predicates: [{ type: 'config', key: 'NODE_ENV', expected: 'production' }],
  expectedSuccess: true,
  tags: ['config', 'env_value'],
  rationale: '.env has NODE_ENV=production',
});

push({
  description: 'env value: PORT == 3000',
  edits: [],
  predicates: [{ type: 'config', key: 'PORT', expected: '3000' }],
  expectedSuccess: true,
  tags: ['config', 'env_value'],
  rationale: '.env has PORT=3000',
});

push({
  description: 'env value: DEBUG == false',
  edits: [],
  predicates: [{ type: 'config', key: 'DEBUG', expected: 'false' }],
  expectedSuccess: true,
  tags: ['config', 'env_value'],
  rationale: '.env has DEBUG=false',
});

push({
  description: 'env value: PORT wrong value',
  edits: [],
  predicates: [{ type: 'config', key: 'PORT', expected: '8080' }],
  expectedSuccess: false,
  tags: ['config', 'env_value_fail'],
  rationale: 'PORT is 3000, not 8080',
});

// =============================================================================
// Family: env_source — scoped to dotenv source
// =============================================================================

push({
  description: 'env source: NODE_ENV exists with dotenv source',
  edits: [],
  predicates: [{ type: 'config', key: 'NODE_ENV', source: 'dotenv', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['config', 'env_source'],
  rationale: 'Scoping to dotenv still finds NODE_ENV in .env',
});

// =============================================================================
// Family: json_exists — JSON config key checks
// =============================================================================

push({
  description: 'json exists: app.name exists in config.json',
  edits: [],
  predicates: [{ type: 'config', key: 'app.name', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['config', 'json_exists'],
  rationale: 'config.json has app.name = "Demo App"',
});

push({
  description: 'json exists: database.port exists in config.json',
  edits: [],
  predicates: [{ type: 'config', key: 'database.port', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['config', 'json_exists'],
  rationale: 'config.json has database.port = 5432',
});

push({
  description: 'json exists: features.darkMode exists in config.json',
  edits: [],
  predicates: [{ type: 'config', key: 'features.darkMode', expected: 'exists' }],
  expectedSuccess: true,
  tags: ['config', 'json_exists'],
  rationale: 'config.json has features.darkMode = true',
});

push({
  description: 'json exists: nonexistent nested key fails',
  edits: [],
  predicates: [{ type: 'config', key: 'app.nonexistent', expected: 'exists' }],
  expectedSuccess: false,
  tags: ['config', 'json_exists_fail'],
  rationale: 'app.nonexistent is not in config.json',
});

// =============================================================================
// Family: json_value — JSON config value checks
// =============================================================================

push({
  description: 'json value: app.name == Demo App',
  edits: [],
  predicates: [{ type: 'config', key: 'app.name', expected: 'Demo App' }],
  expectedSuccess: true,
  tags: ['config', 'json_value'],
  rationale: 'config.json has app.name = "Demo App"',
});

push({
  description: 'json value: database.host == localhost',
  edits: [],
  predicates: [{ type: 'config', key: 'database.host', expected: 'localhost' }],
  expectedSuccess: true,
  tags: ['config', 'json_value'],
  rationale: 'config.json has database.host = "localhost"',
});

push({
  description: 'json value: features.darkMode == true',
  edits: [],
  predicates: [{ type: 'config', key: 'features.darkMode', expected: 'true' }],
  expectedSuccess: true,
  tags: ['config', 'json_value'],
  rationale: 'config.json has features.darkMode = true (boolean, compared as string)',
});

push({
  description: 'json value: app.name wrong value',
  edits: [],
  predicates: [{ type: 'config', key: 'app.name', expected: 'Wrong App' }],
  expectedSuccess: false,
  tags: ['config', 'json_value_fail'],
  rationale: 'app.name is "Demo App" not "Wrong App"',
});

// =============================================================================
// Family: json_source — scoped to json source
// =============================================================================

push({
  description: 'json source: app.name with json source',
  edits: [],
  predicates: [{ type: 'config', key: 'app.name', source: 'json', expected: 'Demo App' }],
  expectedSuccess: true,
  tags: ['config', 'json_source'],
  rationale: 'Scoping to json source finds app.name in config.json',
});

// =============================================================================
// Family: multi — multiple config predicates
// =============================================================================

push({
  description: 'multi: env + json predicates together pass',
  edits: [],
  predicates: [
    { type: 'config', key: 'NODE_ENV', expected: 'production' },
    { type: 'config', key: 'app.name', expected: 'Demo App' },
  ],
  expectedSuccess: true,
  tags: ['config', 'multi'],
  rationale: 'Both env and json predicates pass',
});

push({
  description: 'multi: one failing predicate fails gate',
  edits: [],
  predicates: [
    { type: 'config', key: 'NODE_ENV', expected: 'production' },
    { type: 'config', key: 'app.name', expected: 'Wrong' },
  ],
  expectedSuccess: false,
  tags: ['config', 'multi'],
  rationale: 'Second predicate fails, entire gate fails',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} config scenarios to ${outPath}`);
