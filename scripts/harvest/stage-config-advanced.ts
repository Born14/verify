#!/usr/bin/env bun
/**
 * stage-config-advanced.ts — Config Advanced Scenario Stager
 *
 * Covers zero-coverage config shapes from FAILURE-TAXONOMY.md:
 *   CFG-03: Feature flag state differs between environments
 *   CFG-05: Secret in plaintext config file
 *   CFG-06: Config hot-reload partial
 *   CFG-07: Default value hides missing config
 *   CFG-08: Config precedence chain unpredictable
 *
 * Pure tier — tests grounding/config gates.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/config-advanced-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `cfg-adv-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// CFG-03: Feature flag state differs between environments
// =============================================================================

push({
  description: 'CFG-03: Feature flag key exists in config.json — passes',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'features.darkMode',
    source: 'json',
  }],
  expectedSuccess: true,
  tags: ['config', 'feature_flag_env_diff', 'CFG-03'],
});

push({
  description: 'CFG-03: Feature flag with specific value — passes config gate',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'features.darkMode',
    expected: 'false',
    source: 'json',
  }],
  expectedSuccess: true,
  tags: ['config', 'feature_flag_env_diff', 'CFG-03'],
});

push({
  description: 'CFG-03: Feature flag expected true but is false — fails config gate',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'features.darkMode',
    expected: 'true',
    source: 'json',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'feature_flag_env_diff', 'CFG-03'],
});

push({
  description: 'CFG-03: Staging-only feature flag — not in any config',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'features.stagingOnlyBetaWidget',
    source: 'json',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'feature_flag_env_diff', 'CFG-03'],
});

// =============================================================================
// CFG-05: Secret in plaintext config file
// =============================================================================

push({
  description: 'CFG-05: SECRET_KEY exists in .env — passes config gate',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'SECRET_KEY',
    source: 'dotenv',
  }],
  expectedSuccess: true,
  tags: ['config', 'secret_in_plaintext', 'CFG-05'],
});

push({
  description: 'CFG-05: Secret value matches — passes config gate',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'SECRET_KEY',
    expected: 'super-secret-key-123',
    source: 'dotenv',
  }],
  expectedSuccess: true,
  tags: ['config', 'secret_in_plaintext', 'CFG-05'],
});

push({
  description: 'CFG-05: Secret in config.json — key not present',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'security.apiKeyPlaintext',
    source: 'json',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'secret_in_plaintext', 'CFG-05'],
});

// =============================================================================
// CFG-06: Config hot-reload partial
// =============================================================================

push({
  description: 'CFG-06: Config key present in file — passes',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'database.host',
    source: 'json',
  }],
  expectedSuccess: true,
  tags: ['config', 'hot_reload_partial', 'CFG-06'],
});

push({
  description: 'CFG-06: Hot-reloaded value claim — file has different value',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'database.host',
    expected: 'hot-reloaded-host.internal',
    source: 'json',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'hot_reload_partial', 'CFG-06'],
});

push({
  description: 'CFG-06: Partially-reloaded key — not in any config',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'cache.hotReloadTimestamp',
    source: 'json',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'hot_reload_partial', 'CFG-06'],
});

// =============================================================================
// CFG-07: Default value hides missing config
// =============================================================================

push({
  description: 'CFG-07: Existing config key — passes',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'PORT',
    source: 'dotenv',
  }],
  expectedSuccess: true,
  tags: ['config', 'default_hides_missing', 'CFG-07'],
});

push({
  description: 'CFG-07: Missing key with runtime default — config gate fails',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'LOG_LEVEL',
    expected: 'info',
    source: 'dotenv',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'default_hides_missing', 'CFG-07'],
});

push({
  description: 'CFG-07: Missing required config — not in any file',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'REQUIRED_API_ENDPOINT',
    source: 'dotenv',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'default_hides_missing', 'CFG-07'],
});

// =============================================================================
// CFG-08: Config precedence chain unpredictable
// =============================================================================

push({
  description: 'CFG-08: Key in .env — found as dotenv source',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'NODE_ENV',
    expected: 'production',
    source: 'dotenv',
  }],
  expectedSuccess: true,
  tags: ['config', 'precedence_unpredictable', 'CFG-08'],
});

push({
  description: 'CFG-08: Same key different value from wrong source — fails',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'NODE_ENV',
    expected: 'development',
    source: 'dotenv',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'precedence_unpredictable', 'CFG-08'],
});

push({
  description: 'CFG-08: Config key from CLI override — not in files',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'CLI_OVERRIDE_PORT',
    source: 'env',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'config',
  tags: ['config', 'precedence_unpredictable', 'CFG-08'],
});

push({
  description: 'CFG-08: Precedence conflict — app.name exists in JSON',
  edits: [],
  predicates: [{
    type: 'config',
    key: 'app.name',
    expected: 'Demo App',
    source: 'json',
  }],
  expectedSuccess: true,
  tags: ['config', 'precedence_unpredictable', 'CFG-08'],
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  const tag = s.tags[2] || s.tags[1] || 'unknown';
  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
}

console.log(`Generated ${scenarios.length} config advanced scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
