#!/usr/bin/env bun
/**
 * Capacity x Config scenario generator
 * Grid cell: I×8
 * Shapes: IG-01 (.env has too many variables), IG-02 (config.json exceeds size limit), IG-03 (env var value exceeds shell limit)
 *
 * These scenarios test whether verify detects capacity failures in the
 * configuration layer — .env files with too many variables for shell parsing,
 * config files that exceed JSON parser limits, and individual env var values
 * that exceed OS limits.
 *
 * Run: bun scripts/harvest/stage-capacity-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/capacity-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `ig-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape IG-01: .env has too many variables
// The .env file is expanded with hundreds of variables. Shell environments
// have practical limits on total env size. Docker compose env_file parsing
// also has limits.
// =============================================================================

// IG-01a: .env expanded with 500 variables
scenarios.push({
  id: nextId('envcount'),
  description: 'IG-01: .env expanded to 500 variables, predicate checks last one',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\n' + Array.from({ length: 500 }, (_, i) => `CONFIG_VAR_${i}=value_${i}`).join('\n'),
  }],
  predicates: [{ type: 'content', file: '.env', pattern: 'CONFIG_VAR_499' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'env_count', 'IG-01'],
  rationale: '500 env vars — nears shell environment size limit, docker compose parsing slows down',
});

// IG-01b: .env variables with long names
scenarios.push({
  id: nextId('envcount'),
  description: 'IG-01: .env has 200 variables with 100-char names, total env size limit',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\n' + Array.from({ length: 200 }, (_, i) => `${'VERY_LONG_VARIABLE_NAME_'.repeat(4)}${i}=value`).join('\n'),
  }],
  predicates: [{ type: 'content', file: '.env', pattern: 'VERY_LONG_VARIABLE_NAME_' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'env_count', 'IG-01'],
  rationale: '200 vars with ~100-char names — total environment block exceeds typical limits',
});

// IG-01c: docker-compose environment section with 100 entries
scenarios.push({
  id: nextId('envcount'),
  description: 'IG-01: docker-compose adds 100 environment entries, predicate checks last one',
  edits: [{
    file: 'docker-compose.yml',
    search: '    environment:\n      - PORT=3000',
    replace: '    environment:\n      - PORT=3000\n' + Array.from({ length: 100 }, (_, i) => `      - COMPOSE_VAR_${i}=val_${i}`).join('\n'),
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'COMPOSE_VAR_99' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=3000' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'env_count', 'IG-01'],
  rationale: '100 compose environment entries — YAML parsing and container start overhead',
});

// IG-01d: Multiple .env files loaded, cumulative count exceeds limit
scenarios.push({
  id: nextId('envcount'),
  description: 'IG-01: Both .env and .env.prod expanded, cumulative 300 variables',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\n' + Array.from({ length: 150 }, (_, i) => `DEV_VAR_${i}=dev_${i}`).join('\n') },
    { file: '.env.prod', search: 'DEBUG=false', replace: 'DEBUG=false\n' + Array.from({ length: 150 }, (_, i) => `PROD_VAR_${i}=prod_${i}`).join('\n') },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DEV_VAR_149' },
    { type: 'content', file: '.env.prod', pattern: 'PROD_VAR_149' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'env_count', 'IG-01'],
  rationale: '300 combined env vars — if both loaded, cumulative environment exceeds practical limits',
});

// IG-01e: Control — standard .env size
scenarios.push({
  id: nextId('envcount'),
  description: 'IG-01 control: .env with 6 variables (standard size)',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'PORT=3000' },
    { type: 'content', file: '.env', pattern: 'DATABASE_URL' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'env_count', 'IG-01', 'control'],
  rationale: 'Standard .env with 6 variables — well within all limits',
});

// =============================================================================
// Shape IG-02: config.json exceeds size limit
// The JSON config file grows beyond what parsers can handle efficiently,
// or beyond what Docker/deployment tools accept.
// =============================================================================

// IG-02a: config.json expanded to 1MB with nested objects
scenarios.push({
  id: nextId('cfgsize'),
  description: 'IG-02: config.json expanded with 1000 nested feature flags, each with description',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: `"analytics": false,\n    "flags": {\n${Array.from({length: 1000}, (_, i) => `      "flag_${i}": { "enabled": true, "description": "${('A'.repeat(200))}", "rollout": ${i / 10} }`).join(',\n')}\n    }`,
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'flag_999' },
    { type: 'content', file: 'config.json', pattern: '"port": 3000' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'config_size', 'IG-02'],
  rationale: '1000 flags x ~250 bytes each = ~250KB config — JSON parse time and memory increases',
});

// IG-02b: config.json with deeply nested objects (100 levels)
scenarios.push({
  id: nextId('cfgsize'),
  description: 'IG-02: config.json with 100-level nested structure, parser stack overflow',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": false,\n    "deep": ' + '{'.repeat(100) + '"value": "bottom"' + '}'.repeat(100),
  }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"value": "bottom"' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'config_size', 'IG-02'],
  rationale: '100-level nesting — some JSON parsers hit recursion limits',
});

// IG-02c: config.prod.json with massive connection pool config
scenarios.push({
  id: nextId('cfgsize'),
  description: 'IG-02: config.prod.json gains 500 connection pool entries',
  edits: [{
    file: 'config.prod.json',
    search: '"analytics": false',
    replace: `"analytics": false,\n    "pools": [\n${Array.from({length: 500}, (_, i) => `      { "host": "db-shard-${i}.internal", "port": ${5432 + i}, "max": 20, "ssl": true }`).join(',\n')}\n    ]`,
  }],
  predicates: [
    { type: 'content', file: 'config.prod.json', pattern: 'db-shard-499' },
    { type: 'content', file: 'config.prod.json', pattern: '"name": "Demo App"' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'config_size', 'IG-02'],
  rationale: '500 connection pool entries — config file enormous, deployment tool may reject',
});

// IG-02d: Compose with massive labels section
scenarios.push({
  id: nextId('cfgsize'),
  description: 'IG-02: docker-compose gains 200 labels, YAML parser slowed',
  edits: [{
    file: 'docker-compose.yml',
    search: '    healthcheck:',
    replace: '    labels:\n' + Array.from({ length: 200 }, (_, i) => `      com.app.label-${i}: "${'value'.repeat(20)}"`).join('\n') + '\n    healthcheck:',
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'com.app.label-199' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'build: .' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'config_size', 'IG-02'],
  rationale: '200 labels with long values — YAML parsing and Docker API label limits',
});

// IG-02e: Control — standard config size
scenarios.push({
  id: nextId('cfgsize'),
  description: 'IG-02 control: config.json at standard size',
  edits: [],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"darkMode": true' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'config_size', 'IG-02', 'control'],
  rationale: 'Standard config — small JSON, no parser issues',
});

// =============================================================================
// Shape IG-03: Env var value exceeds shell limit
// Individual environment variable values are too large for the OS to handle.
// Linux ARG_MAX is typically 2MB, individual env vars have practical limits.
// =============================================================================

// IG-03a: Single env var with 1MB value
scenarios.push({
  id: nextId('valsize'),
  description: 'IG-03: .env has single variable with 1MB base64 value',
  edits: [{
    file: '.env',
    search: 'SECRET_KEY="not-very-secret"',
    replace: `SECRET_KEY="${'A'.repeat(1024 * 1024)}"`,
  }],
  predicates: [{ type: 'content', file: '.env', pattern: 'SECRET_KEY="AAAA' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'value_size', 'IG-03'],
  rationale: '1MB env var value — exceeds practical limits for shell environment, exec may fail',
});

// IG-03b: DATABASE_URL with 500 connection params
scenarios.push({
  id: nextId('valsize'),
  description: 'IG-03: DATABASE_URL has 500 query parameters, exceeds URL parser limits',
  edits: [{
    file: '.env',
    search: 'DATABASE_URL="postgres://localhost:5432/demo"',
    replace: `DATABASE_URL="postgres://localhost:5432/demo?${Array.from({length: 500}, (_, i) => `param${i}=${'v'.repeat(50)}`).join('&')}"`,
  }],
  predicates: [{ type: 'content', file: '.env', pattern: 'param499=' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'value_size', 'IG-03'],
  rationale: '500 URL params x 50 chars each = ~30KB URL — exceeds URL parser and driver limits',
});

// IG-03c: JWT/cert embedded in env var, exceeds line length
scenarios.push({
  id: nextId('valsize'),
  description: 'IG-03: .env embeds full PEM certificate (4KB) as single-line value',
  edits: [{
    file: '.env',
    search: 'SECRET_KEY="not-very-secret"',
    replace: `SECRET_KEY="not-very-secret"\nTLS_CERT="${'MIIBkTCB+wIJANsummary'.repeat(200)}"`,
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'TLS_CERT="MII' },
    { type: 'content', file: '.env', pattern: 'SECRET_KEY' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'value_size', 'IG-03'],
  rationale: '~4KB PEM as single-line env var — some .env parsers cannot handle multi-KB lines',
});

// IG-03d: Compose environment value with embedded JSON (large)
scenarios.push({
  id: nextId('valsize'),
  description: 'IG-03: docker-compose env var contains 50KB JSON string',
  edits: [{
    file: 'docker-compose.yml',
    search: '      - PORT=3000',
    replace: `      - PORT=3000\n      - APP_CONFIG='${JSON.stringify(Array.from({length: 200}, (_, i) => ({ id: i, data: 'x'.repeat(200) })))}'`,
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: "APP_CONFIG='" },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=3000' },
  ],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'value_size', 'IG-03'],
  rationale: '50KB JSON embedded in compose env var — YAML parser and Docker exec env limit',
});

// IG-03e: Control — normal-sized env var values
scenarios.push({
  id: nextId('valsize'),
  description: 'IG-03 control: Standard .env with short values',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotated-2026-key"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'SECRET_KEY="rotated-2026-key"' }],
  expectedSuccess: true,
  tags: ['capacity', 'config', 'value_size', 'IG-03', 'control'],
  rationale: 'Short secret value — well within all env var size limits',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} capacity-config scenarios -> ${outPath}`);
