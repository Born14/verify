/**
 * Quick runner for F9 staged scenarios against verify().
 * Run: bun scripts/harness/run-f9-test.ts
 */
import { verify } from '../../src/index.js';
import { resolve } from 'path';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const fixtureDir = resolve('fixtures/demo-app');
const scenarioPath = resolve('fixtures/scenarios/f9-staged.json');
const scenarios = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

console.log(`Loaded ${scenarios.length} F9 scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  const stateDir = join(tmpdir(), `verify-f9-${s.id}`);
  try {
    mkdirSync(stateDir, { recursive: true });

    const config = {
      appDir: fixtureDir,
      stateDir,
      gates: {
        staging: false,
        browser: false,
        http: false,
        invariants: false,
        vision: false,
      },
    };

    const result = await verify(s.edits, s.predicates, config);
    const expected = s.expectedSuccess ?? true;
    const actual = result.success;

    if (actual === expected) {
      pass++;
    } else {
      fail++;
      const failedGate = result.gates.find(g => !g.passed);
      failures.push({
        id: s.id,
        description: s.description,
        expected,
        actual,
        gate: failedGate?.gate || 'all passed',
        detail: failedGate?.detail?.slice(0, 200) || '',
        expectedGate: s.expectedFailedGate,
        tags: s.tags,
      });
    }
  } catch (e: any) {
    errCount++;
    failures.push({ id: s.id, description: s.description, error: e.message?.slice(0, 200), tags: s.tags });
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  }
}

console.log(`Results: ${pass} pass, ${fail} fail, ${errCount} error (of ${scenarios.length})\n`);

if (failures.length > 0) {
  console.log('FAILURES (expected != actual):');
  for (const f of failures) {
    console.log(`  ${f.id}: expected=${f.expected} actual=${f.actual} gate=${f.gate || ''}`);
    console.log(`    ${f.description}`);
    if (f.detail) console.log(`    detail: ${f.detail}`);
    if (f.error) console.log(`    error: ${f.error}`);
    if (f.expectedGate) console.log(`    expectedGate: ${f.expectedGate}`);
    console.log();
  }
}

// By-family breakdown
const typeResults: Record<string, { pass: number; fail: number }> = {};
const failSet = new Set(failures.map(f => f.id));
for (const s of scenarios) {
  const tag = s.tags?.[1] || 'unknown';
  if (!typeResults[tag]) typeResults[tag] = { pass: 0, fail: 0 };
  if (failSet.has(s.id)) {
    typeResults[tag].fail++;
  } else {
    typeResults[tag].pass++;
  }
}

console.log('\nBy family:');
for (const [tag, r] of Object.entries(typeResults).sort((a, b) => b[1].fail - a[1].fail)) {
  const status = r.fail > 0 ? '❌' : '✅';
  console.log(`  ${status} ${tag}: ${r.pass}/${r.pass + r.fail} pass`);
}
