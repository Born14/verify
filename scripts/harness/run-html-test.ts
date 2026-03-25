/**
 * Quick runner for HTML staged scenarios against verify().
 * Run: bun scripts/harness/run-html-test.ts
 */
import { loadExternalScenarios } from './external-scenario-loader.js';
import { verify } from '../../src/index.js';
import { join, resolve } from 'path';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const fixtureDir = resolve('fixtures/demo-app');
const scenarios = loadExternalScenarios(join(fixtureDir, '.verify/custom-scenarios.json'), fixtureDir);

console.log(`Loaded ${scenarios.length} HTML scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  const stateDir = join(tmpdir(), `verify-html-${s.id}`);
  try {
    mkdirSync(stateDir, { recursive: true });

    const config = {
      appDir: fixtureDir,
      stateDir,
      gates: s.config?.gates ?? { staging: false, browser: false, http: false, invariants: false, vision: false },
    };

    const result = await verify(s.edits, s.predicates, config);
    const expected = s.expectedSuccess ?? true;
    const actual = result.success;

    if (actual === expected) {
      pass++;
    } else {
      fail++;
      failures.push({
        id: s.id,
        expected,
        actual,
        gate: result.gates.find(g => !g.passed)?.gate || 'all passed',
        detail: result.gates.find(g => !g.passed)?.detail?.slice(0, 120) || '',
        tags: (s as any).tags,
      });
    }
  } catch (e: any) {
    errCount++;
    failures.push({ id: s.id, error: e.message?.slice(0, 150), tags: (s as any).tags });
  } finally {
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  }
}

console.log(`Results: ${pass} pass, ${fail} fail, ${errCount} error (of ${scenarios.length})\n`);

if (failures.length > 0) {
  console.log('FAILURES (expected != actual):');
  for (const f of failures.slice(0, 50)) {
    console.log(`  ${f.id}: expected=${f.expected} actual=${f.actual} gate=${f.gate || ''} ${f.detail || f.error || ''}`);
    if (f.tags) console.log(`    tags: ${f.tags.join(', ')}`);
  }
  if (failures.length > 50) console.log(`  ... and ${failures.length - 50} more`);
}

// Summary by scenario type (tag[1])
const typeResults: Record<string, { pass: number; fail: number; err: number }> = {};
const failSet = new Set(failures.map(f => f.id));
for (const s of scenarios) {
  const tag = ((s as any).tags?.[1]) || 'unknown';
  if (!typeResults[tag]) typeResults[tag] = { pass: 0, fail: 0, err: 0 };
  if (failSet.has(s.id)) {
    typeResults[tag].fail++;
  } else {
    typeResults[tag].pass++;
  }
}

console.log('\nBy scenario type:');
for (const [type, r] of Object.entries(typeResults).sort((a, b) => b[1].fail - a[1].fail)) {
  const total = r.pass + r.fail;
  const pct = total > 0 ? Math.round(r.pass / total * 100) : 0;
  console.log(`  ${type.padEnd(18)} ${r.pass}/${total} pass (${pct}%) — ${r.fail} failures`);
}
