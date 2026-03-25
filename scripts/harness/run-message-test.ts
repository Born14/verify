/**
 * Runner for message gate staged scenarios.
 * Calls runMessageGate() directly (not verify() — message gate is standalone).
 * Run: bun scripts/harness/run-message-test.ts
 */
import { runMessageGate } from '../../src/gates/message.js';
import type { MessageGateContext, MessageEnvelope, MessagePolicy, EvidenceProvider } from '../../src/gates/message.js';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const scenarioPath = resolve('fixtures/scenarios/message-staged.json');
const scenarios = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

console.log(`Loaded ${scenarios.length} message scenarios\n`);

let pass = 0, fail = 0, errCount = 0;
const failures: any[] = [];

for (const s of scenarios) {
  try {
    // Build evidence providers from scenario data
    const evidenceProviders: Record<string, EvidenceProvider> | undefined = s.evidenceProviders
      ? Object.fromEntries(
          Object.entries(s.evidenceProviders as Record<string, any>).map(([key, val]) => [
            key,
            async () => val,
          ])
        )
      : undefined;

    const ctx: MessageGateContext = {
      envelope: s.envelope as MessageEnvelope,
      policy: s.policy as MessagePolicy,
      evidenceProviders,
      deniedPatterns: s.deniedPatterns,
    };

    const result = await runMessageGate(ctx);

    const expectedVerdict = s.expectedVerdict;
    const actualVerdict = result.verdict;

    let matched = actualVerdict === expectedVerdict;

    // Also check reason if expected
    if (matched && s.expectedReason && result.reason !== s.expectedReason) {
      matched = false;
    }

    if (matched) {
      pass++;
    } else {
      fail++;
      failures.push({
        id: s.id,
        description: s.description,
        expectedVerdict,
        actualVerdict,
        expectedReason: s.expectedReason,
        actualReason: result.reason,
        detail: result.detail?.slice(0, 300),
        tags: s.tags,
      });
    }
  } catch (e: any) {
    errCount++;
    failures.push({ id: s.id, description: s.description, error: e.message?.slice(0, 300), tags: s.tags });
  }
}

console.log(`Results: ${pass} pass, ${fail} fail, ${errCount} error (of ${scenarios.length})\n`);

if (failures.length > 0) {
  console.log('FAILURES:');
  for (const f of failures) {
    console.log(`  ${f.id}:`);
    console.log(`    ${f.description}`);
    if (f.expectedVerdict !== undefined) {
      console.log(`    verdict: expected=${f.expectedVerdict} actual=${f.actualVerdict}`);
    }
    if (f.expectedReason) {
      console.log(`    reason: expected=${f.expectedReason} actual=${f.actualReason}`);
    }
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
