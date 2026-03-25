/**
 * Generates filesystem gate scenarios from demo-app fixtures.
 * 4 predicate types: filesystem_exists, filesystem_absent, filesystem_unchanged, filesystem_count
 * Run: bun scripts/harvest/stage-filesystem-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';

const outPath = resolve('fixtures/scenarios/filesystem-staged.json');
const demoDir = resolve('fixtures/demo-app');

// Compute SHA-256 of a file for filesystem_unchanged predicates
function sha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `fs-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: exists — files that exist should pass
// =============================================================================

const existingFiles = ['server.js', 'Dockerfile', 'config.json', 'init.sql', '.env', 'docker-compose.yml'];

for (const file of existingFiles) {
  push({
    description: `filesystem_exists: ${file} exists in demo-app`,
    edits: [],
    predicates: [{ type: 'filesystem_exists', file }],
    expectedSuccess: true,
    tags: ['filesystem', 'exists'],
    rationale: `${file} is a real file in demo-app, should pass exists check`,
  });
}

// Exists after edit modifies an existing file (search: '' not supported for new files)
push({
  description: 'filesystem_exists: server.js still exists after editing it',
  edits: [{ file: 'server.js', search: 'const PORT', replace: 'const PORT' }],
  predicates: [{ type: 'filesystem_exists', file: 'server.js' }],
  expectedSuccess: true,
  tags: ['filesystem', 'exists'],
  rationale: 'server.js is edited (no-op replacement) and still exists',
});

// Exists in subdirectory
push({
  description: 'filesystem_exists: test-data/valid.json exists',
  edits: [],
  predicates: [{ type: 'filesystem_exists', file: 'test-data/valid.json' }],
  expectedSuccess: true,
  tags: ['filesystem', 'exists'],
  rationale: 'File in subdirectory should be found',
});

// =============================================================================
// Family: exists_fail — files that don't exist should fail
// =============================================================================

push({
  description: 'filesystem_exists: nonexistent file should fail',
  edits: [],
  predicates: [{ type: 'filesystem_exists', file: 'nonexistent.js' }],
  expectedSuccess: false,
  tags: ['filesystem', 'exists_fail'],
  rationale: 'File does not exist, exists check should fail',
});

push({
  description: 'filesystem_exists: nonexistent nested path should fail',
  edits: [],
  predicates: [{ type: 'filesystem_exists', file: 'deep/nested/file.txt' }],
  expectedSuccess: false,
  tags: ['filesystem', 'exists_fail'],
  rationale: 'Neither directory nor file exists',
});

// =============================================================================
// Family: absent_pre — grounding gate rejects absent predicates for nonexistent files
// NOTE: filesystem_absent requires the file to exist at grounding time (before edit).
// Predicates for files that never existed are "trivially true" and fail the grounding gate.
// These scenarios test absent_fail (file exists → absent check fails), not absent pass.
// =============================================================================

push({
  description: 'filesystem_absent: init.sql exists, absent check fails',
  edits: [],
  predicates: [{ type: 'filesystem_absent', file: 'init.sql' }],
  expectedSuccess: false,
  tags: ['filesystem', 'absent_fail'],
  rationale: 'init.sql exists in demo-app, so absent check should fail',
});

push({
  description: 'filesystem_absent: Dockerfile exists, absent check fails',
  edits: [],
  predicates: [{ type: 'filesystem_absent', file: 'Dockerfile' }],
  expectedSuccess: false,
  tags: ['filesystem', 'absent_fail'],
  rationale: 'Dockerfile exists in demo-app, so absent check should fail',
});

// =============================================================================
// Family: absent_fail — files that exist should fail absent check
// =============================================================================

push({
  description: 'filesystem_absent: server.js exists, absent check fails',
  edits: [],
  predicates: [{ type: 'filesystem_absent', file: 'server.js' }],
  expectedSuccess: false,
  tags: ['filesystem', 'absent_fail'],
  rationale: 'server.js exists, so absent check should fail',
});

push({
  description: 'filesystem_absent: config.json exists, absent check fails',
  edits: [],
  predicates: [{ type: 'filesystem_absent', file: 'config.json' }],
  expectedSuccess: false,
  tags: ['filesystem', 'absent_fail'],
  rationale: 'config.json exists, so absent check should fail',
});

// =============================================================================
// Family: unchanged — hash comparison (should pass when file unchanged)
// =============================================================================

const unchangedFiles = ['config.json', 'init.sql', '.env'];

for (const file of unchangedFiles) {
  const hash = sha256(join(demoDir, file));
  push({
    description: `filesystem_unchanged: ${file} hash matches (no edits)`,
    edits: [],
    predicates: [{ type: 'filesystem_unchanged', file, hash }],
    expectedSuccess: true,
    tags: ['filesystem', 'unchanged'],
    rationale: `No edits means ${file} hash should match the pre-computed hash`,
  });
}

// =============================================================================
// Family: unchanged_fail — hash mismatch after edit
// =============================================================================

const configHash = sha256(join(demoDir, 'config.json'));
push({
  description: 'filesystem_unchanged: config.json modified, hash mismatch',
  edits: [{ file: 'config.json', search: '"Demo App"', replace: '"Modified App"' }],
  predicates: [{ type: 'filesystem_unchanged', file: 'config.json', hash: configHash }],
  expectedSuccess: false,
  tags: ['filesystem', 'unchanged_fail'],
  rationale: 'Edit changes config.json, so hash no longer matches',
});

push({
  description: 'filesystem_unchanged: wrong hash for existing file',
  edits: [],
  predicates: [{ type: 'filesystem_unchanged', file: 'server.js', hash: 'deadbeef' + '0'.repeat(56) }],
  expectedSuccess: false,
  tags: ['filesystem', 'unchanged_fail'],
  rationale: 'Hash is fabricated, should not match',
});

// =============================================================================
// Family: count — directory entry counting
// =============================================================================

const testDataCount = readdirSync(join(demoDir, 'test-data')).length;
push({
  description: `filesystem_count: test-data has ${testDataCount} entries`,
  edits: [],
  predicates: [{ type: 'filesystem_count', path: 'test-data', count: testDataCount }],
  expectedSuccess: true,
  tags: ['filesystem', 'count'],
  rationale: `test-data directory has exactly ${testDataCount} files`,
});

// Count unchanged after editing an existing file within test-data
push({
  description: `filesystem_count: test-data still has ${testDataCount} entries after editing existing file`,
  edits: [{ file: 'test-data/valid.json', search: '"Demo App"', replace: '"Demo App"' }],
  predicates: [{ type: 'filesystem_count', path: 'test-data', count: testDataCount }],
  expectedSuccess: true,
  tags: ['filesystem', 'count'],
  rationale: 'Editing an existing file in test-data does not change the count',
});

// =============================================================================
// Family: count_fail — wrong count
// =============================================================================

push({
  description: 'filesystem_count: test-data wrong count',
  edits: [],
  predicates: [{ type: 'filesystem_count', path: 'test-data', count: 999 }],
  expectedSuccess: false,
  tags: ['filesystem', 'count_fail'],
  rationale: 'Count 999 does not match actual test-data entry count',
});

push({
  description: 'filesystem_count: nonexistent directory',
  edits: [],
  predicates: [{ type: 'filesystem_count', path: 'nonexistent-dir', count: 0 }],
  expectedSuccess: false,
  tags: ['filesystem', 'count_fail'],
  rationale: 'Directory does not exist, count check should fail',
});

// =============================================================================
// Family: multi — multiple filesystem predicates together
// =============================================================================

push({
  description: 'multi: exists + exists (subdir) + unchanged together',
  edits: [],
  predicates: [
    { type: 'filesystem_exists', file: 'server.js' },
    { type: 'filesystem_exists', file: 'test-data/valid.json' },
    { type: 'filesystem_unchanged', file: 'config.json', hash: sha256(join(demoDir, 'config.json')) },
  ],
  expectedSuccess: true,
  tags: ['filesystem', 'multi'],
  rationale: 'All three filesystem predicates reference real files — should pass together',
});

push({
  description: 'multi: one failing predicate fails the gate',
  edits: [],
  predicates: [
    { type: 'filesystem_exists', file: 'server.js' },
    { type: 'filesystem_exists', file: 'nonexistent.js' },
  ],
  expectedSuccess: false,
  tags: ['filesystem', 'multi'],
  rationale: 'Second predicate fails, entire gate should fail',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} filesystem scenarios to ${outPath}`);
