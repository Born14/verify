/**
 * Quick runner for DB staged scenarios against verify().
 * Run: bun scripts/harness/run-db-test.ts
 *
 * These test the GROUNDING gate for DB predicates — no live database needed.
 * Gates disabled: staging, browser, http, invariants, vision
 * Gates enabled: grounding only (what we're testing)
 */
import { verify } from '../../src/index.js';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const fixtureDir = resolve('fixtures/demo-app');
const scenarioPath = resolve('fixtures/scenarios/db-staged.json');
const scenarios = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

console.log(`Loaded ${scenarios.length} DB scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  const stateDir = join(tmpdir(), `verify-db-${s.id}`);
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
        // grounding: enabled by default — this is what we're testing
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
  for (const f of failures.slice(0, 50)) {
    console.log(`  ${f.id}: expected=${f.expected} actual=${f.actual} gate=${f.gate || ''} expectedGate=${f.expectedGate || ''}`);
    console.log(`    ${f.description}`);
    if (f.detail) console.log(`    detail: ${f.detail}`);
    if (f.error) console.log(`    error: ${f.error}`);
  }
  if (failures.length > 50) console.log(`  ... and ${failures.length - 50} more`);
}

// Summary by scenario type
const typeResults: Record<string, { pass: number; fail: number }> = {};
const failSet = new Set(failures.map(f => f.id));
for (const s of scenarios) {
  const tag = s.tags?.[1] || 'unknown';
  if (!typeResults[tag]) typeResults[tag] = { pass: 0, fail: 0 };
  if (failSet.has(s.id)) typeResults[tag].fail++;
  else typeResults[tag].pass++;
}

console.log('\nBy scenario type:');
for (const [type, r] of Object.entries(typeResults).sort((a, b) => b[1].fail - a[1].fail)) {
  const total = r.pass + r.fail;
  const pct = total > 0 ? Math.round(r.pass / total * 100) : 0;
  console.log(`  ${type.padEnd(22)} ${r.pass}/${total} pass (${pct}%) — ${r.fail} failures`);
}
