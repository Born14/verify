/**
 * Quick runner for G5 staged scenarios against verify().
 * G5 is advisory (always passes), so we verify attribution quality
 * by checking the G5 gate's attributions and summary fields.
 * Run: bun scripts/harness/run-g5-test.ts
 */
import { verify } from '../../src/index.js';
import { resolve } from 'path';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const fixtureDir = resolve('fixtures/demo-app');
const scenarioPath = resolve('fixtures/scenarios/g5-staged.json');
const scenarios = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

console.log(`Loaded ${scenarios.length} G5 scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  const stateDir = join(tmpdir(), `verify-g5-${s.id}`);
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

    // G5 always passes, so verify success first
    const expected = s.expectedSuccess ?? true;
    const actual = result.success;

    if (actual !== expected) {
      fail++;
      const failedGate = result.gates.find(g => !g.passed);
      failures.push({
        id: s.id,
        description: s.description,
        expected,
        actual,
        gate: failedGate?.gate || 'all passed',
        detail: failedGate?.detail?.slice(0, 200) || '',
        tags: s.tags,
        kind: 'pass_fail_mismatch',
      });
      continue;
    }

    // Now check attribution quality
    const g5Gate = result.gates.find(g => g.gate === 'G5') as any;
    if (!g5Gate) {
      fail++;
      failures.push({
        id: s.id,
        description: s.description,
        kind: 'no_g5_gate',
        tags: s.tags,
      });
      continue;
    }

    // Check per-edit attributions
    let attrMismatch = false;
    if (s.expectedAttributions && g5Gate.attributions) {
      const actualAttrs = g5Gate.attributions.map((a: any) => a.attribution);
      if (actualAttrs.length !== s.expectedAttributions.length) {
        attrMismatch = true;
        failures.push({
          id: s.id,
          description: s.description,
          kind: 'attribution_count_mismatch',
          expected: s.expectedAttributions,
          actual: actualAttrs,
          tags: s.tags,
        });
      } else {
        for (let i = 0; i < actualAttrs.length; i++) {
          if (actualAttrs[i] !== s.expectedAttributions[i]) {
            attrMismatch = true;
            failures.push({
              id: s.id,
              description: s.description,
              kind: 'attribution_mismatch',
              editIndex: i,
              expectedAttr: s.expectedAttributions[i],
              actualAttr: actualAttrs[i],
              editFile: g5Gate.attributions[i]?.file,
              matchedPredicate: g5Gate.attributions[i]?.matchedPredicate || 'none',
              tags: s.tags,
            });
            break; // Report first mismatch per scenario
          }
        }
      }
    }

    // Check summary counts
    if (s.expectedSummary && g5Gate.summary) {
      const es = s.expectedSummary;
      const as = g5Gate.summary;
      if (es.direct !== as.direct || es.scaffolding !== as.scaffolding || es.unexplained !== as.unexplained) {
        attrMismatch = true;
        failures.push({
          id: s.id,
          description: s.description,
          kind: 'summary_mismatch',
          expectedSummary: es,
          actualSummary: as,
          tags: s.tags,
        });
      }
    }

    if (attrMismatch) {
      fail++;
    } else {
      pass++;
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
  console.log('FAILURES:');
  for (const f of failures) {
    console.log(`  ${f.id}: kind=${f.kind || 'error'}`);
    console.log(`    ${f.description}`);
    if (f.kind === 'attribution_mismatch') {
      console.log(`    edit[${f.editIndex}] file=${f.editFile}: expected=${f.expectedAttr} actual=${f.actualAttr}`);
      console.log(`    matchedPredicate: ${f.matchedPredicate}`);
    }
    if (f.kind === 'summary_mismatch') {
      console.log(`    expected: d=${f.expectedSummary.direct} s=${f.expectedSummary.scaffolding} u=${f.expectedSummary.unexplained}`);
      console.log(`    actual:   d=${f.actualSummary.direct} s=${f.actualSummary.scaffolding} u=${f.actualSummary.unexplained}`);
    }
    if (f.kind === 'pass_fail_mismatch') {
      console.log(`    expected=${f.expected} actual=${f.actual} gate=${f.gate}`);
      if (f.detail) console.log(`    detail: ${f.detail}`);
    }
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
