/**
 * Generic runner for pure-gate staged scenarios against verify().
 * Works for: filesystem, infrastructure, serialization, config, security, a11y, performance, triangulation.
 * Usage: bun scripts/harness/run-gate-test.ts <gate-name>
 * Example: bun scripts/harness/run-gate-test.ts filesystem
 */
import { verify } from '../../src/index.js';
import { resolve } from 'path';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const gateName = process.argv[2];
if (!gateName) {
  console.error('Usage: bun scripts/harness/run-gate-test.ts <gate-name>');
  console.error('  gate-name: filesystem, infrastructure, serialization, config, security, a11y, performance, triangulation');
  process.exit(1);
}

const fixtureDir = resolve('fixtures/demo-app');
const scenarioPath = resolve(`fixtures/scenarios/${gateName}-staged.json`);

let scenarios: any[];
try {
  scenarios = JSON.parse(readFileSync(scenarioPath, 'utf-8'));
} catch (e: any) {
  console.error(`Cannot read ${scenarioPath}: ${e.message}`);
  console.error(`Run: bun scripts/harvest/stage-${gateName}-leaves.ts first`);
  process.exit(1);
}

console.log(`Loaded ${scenarios.length} ${gateName} scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  const stateDir = join(tmpdir(), `verify-${gateName}-${s.id}`);
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
        detail: failedGate?.detail?.slice(0, 300) || '',
        tags: s.tags,
      });
    }
  } catch (e: any) {
    errCount++;
    failures.push({ id: s.id, description: s.description, error: e.message?.slice(0, 300), tags: s.tags });
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
