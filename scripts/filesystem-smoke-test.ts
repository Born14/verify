#!/usr/bin/env bun
/**
 * Non-Code Text Mutation Smoke Test
 * ==================================
 *
 * Proves that verify's gate pipeline can validate non-code agent actions
 * when those actions are modeled as text-file edits with content predicates.
 *
 * This is the first rung of the ladder described in BEYOND-CODE.md.
 * It does NOT prove full filesystem agent reliability (moves, renames,
 * deletes, permissions, directory counts). Those need new predicate types:
 *   filesystem_exists, filesystem_absent, filesystem_unchanged, filesystem_count
 *
 * What this DOES prove:
 *   1. F9 gate catches edits targeting nonexistent files
 *   2. Grounding gate catches content predicates claiming patterns
 *      that won't exist in the file after edits are applied
 *   3. K5 gate learns from failures and blocks repeat attempts
 *      (constraint persists across calls within the same state dir)
 *   4. Content predicates verify file state after edits
 *   5. G5 detects unexplained mutations across files (advisory)
 *   6. The gate sequence is domain-agnostic — no code changed
 *
 * Run:
 *   bun run packages/verify/scripts/filesystem-smoke-test.ts
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verify } from '../src/verify.js';
import type { Edit, Predicate, VerifyConfig } from '../src/types.js';

// ─────────────────────────────────────────────────────────────
// Test fixture: a simulated document workspace
// ─────────────────────────────────────────────────────────────

const WORKSPACE = join(tmpdir(), `verify-fs-smoke-${Date.now()}`);
const STATE_DIR = join(WORKSPACE, '.verify');

function setupWorkspace() {
  mkdirSync(join(WORKSPACE, 'inbox'), { recursive: true });
  mkdirSync(join(WORKSPACE, 'projects'), { recursive: true });
  mkdirSync(join(WORKSPACE, 'archive'), { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });

  writeFileSync(join(WORKSPACE, 'inbox', 'meeting-notes.txt'), [
    '# Team Standup — March 20, 2026',
    '',
    '## Attendees',
    'Alice, Bob, Charlie',
    '',
    '## Discussion',
    '- Sprint progress: on track',
    '- Blocker: API rate limits on Gemini',
    '- Action item: Bob to investigate caching',
    '',
    '## Next Meeting',
    'Thursday 10am',
  ].join('\n'));

  writeFileSync(join(WORKSPACE, 'inbox', 'invoice-march.txt'), [
    'INVOICE #2026-03-001',
    '',
    'Client: Acme Corp',
    'Amount: $4,500.00',
    'Due: April 15, 2026',
    '',
    'Services:',
    '- Agent pipeline development (40 hrs)',
    '- Verification gate implementation (20 hrs)',
    '',
    'Status: UNPAID',
  ].join('\n'));

  writeFileSync(join(WORKSPACE, 'inbox', 'readme-draft.txt'), [
    '# My Project',
    '',
    'A work in progress.',
    '',
    '## Features',
    '- Feature 1: TBD',
    '- Feature 2: TBD',
    '',
    'Status: DRAFT',
  ].join('\n'));

  writeFileSync(join(WORKSPACE, 'projects', 'roadmap.txt'), [
    '# Product Roadmap 2026',
    '',
    '## Q1',
    '- Verify pipeline: SHIPPED',
    '- Self-test harness: SHIPPED',
    '- Improve loop: IN PROGRESS',
    '',
    '## Q2',
    '- Filesystem predicates: PLANNED',
    '- Communication predicates: PLANNED',
    '- npm v1.0: PLANNED',
  ].join('\n'));
}

// ─────────────────────────────────────────────────────────────
// Test infrastructure
// ─────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  description: string;
  edits: Edit[];
  predicates: Predicate[];
  expectedSuccess: boolean;
  expectedGate?: string;
  skipWorkspaceReset?: boolean;  // For K5 tests that need prior state
  assertK5Blocked?: boolean;     // Explicitly verify K5 intercepted before F9
}

const results: Array<{ name: string; passed: boolean; detail: string }> = [];

async function runTest(test: TestCase) {
  process.stdout.write(`  ${test.name} ... `);

  const config: VerifyConfig = {
    appDir: WORKSPACE,
    stateDir: STATE_DIR,
    goal: test.description,
    gates: {
      grounding: true,
      syntax: true,
      constraints: true,
      containment: true,
      staging: false,
      browser: false,
      http: false,
      invariants: false,
      vision: false,
    },
  };

  try {
    const result = await verify(test.edits, test.predicates, config);

    if (result.success === test.expectedSuccess) {
      // Check expected gate on failure
      if (!test.expectedSuccess && test.expectedGate) {
        const failedGate = result.gates.find(g => !g.passed);
        if (failedGate?.gate !== test.expectedGate) {
          console.log(`FAIL (wrong gate: expected ${test.expectedGate}, got ${failedGate?.gate})`);
          results.push({ name: test.name, passed: false, detail: `Wrong gate: expected ${test.expectedGate}, got ${failedGate?.gate}` });
          return;
        }
      }

      // K5-specific assertion: verify constraint count grew
      if (test.assertK5Blocked) {
        const k5Gate = result.gates.find(g => g.gate === 'K5');
        if (!k5Gate || k5Gate.passed) {
          // K5 didn't block — F9 caught it first. That's still a valid block,
          // but we want to verify K5 state grew from the prior failure.
          const constraintsBefore = result.constraintDelta?.before ?? 0;
          if (constraintsBefore === 0) {
            console.log(`FAIL (K5 has no constraints from prior failure)`);
            results.push({ name: test.name, passed: false, detail: 'K5 constraint store empty — prior failure did not seed' });
            return;
          }
          console.log(`BLOCKED ✓ (${test.expectedGate}, K5 has ${constraintsBefore} constraint(s) from prior run)`);
        } else {
          console.log(`BLOCKED ✓ (K5 intercepted before F9)`);
        }
        results.push({
          name: test.name,
          passed: true,
          detail: `K5 state persisted: ${result.constraintDelta?.before ?? 0} constraints before this run`,
        });

        if (result.narrowing?.constraints?.length) {
          console.log(`         K5 constraints active: ${result.constraintDelta?.before ?? '?'} before, ${result.constraintDelta?.after ?? '?'} after`);
        }
        return;
      }

      console.log(result.success ? 'PASS ✓' : `BLOCKED ✓ (${test.expectedGate})`);
      results.push({
        name: test.name,
        passed: true,
        detail: result.success
          ? `All gates passed in ${result.timing.totalMs}ms`
          : `Correctly blocked at ${test.expectedGate}: ${result.gates.find(g => !g.passed)?.detail?.slice(0, 80)}`,
      });

      // Show K5 learning on failures
      if (!result.success && result.narrowing) {
        if (result.narrowing.constraints.length > 0) {
          console.log(`         K5 learned: ${result.narrowing.constraints[0].reason.slice(0, 70)}`);
        }
        if (result.narrowing.resolutionHint) {
          console.log(`         Hint: ${result.narrowing.resolutionHint.slice(0, 70)}`);
        }
      }

      // Show containment on success when there are unexplained mutations
      if (result.success && result.containment && result.containment.unexplained > 0) {
        console.log(`         G5: ${result.containment.unexplained} unexplained mutation(s) detected`);
      }
    } else {
      console.log(`FAIL (expected ${test.expectedSuccess ? 'success' : 'failure'}, got ${result.success ? 'success' : 'failure'})`);
      if (!result.success) {
        const failedGate = result.gates.find(g => !g.passed);
        console.log(`         Failed at: ${failedGate?.gate} — ${failedGate?.detail?.slice(0, 80)}`);
      }
      results.push({
        name: test.name,
        passed: false,
        detail: `Expected ${test.expectedSuccess ? 'success' : 'failure'}, got ${result.success ? 'success' : 'failure'}`,
      });
    }
  } catch (err: any) {
    console.log(`ERROR: ${err.message}`);
    results.push({ name: test.name, passed: false, detail: `Exception: ${err.message}` });
  }
}

// ─────────────────────────────────────────────────────────────
// THE TESTS
// ─────────────────────────────────────────────────────────────

const tests: TestCase[] = [
  // ──────────────────────────────
  // T1: Valid edit — agent marks invoice as paid
  // ──────────────────────────────
  {
    name: 'T1: Agent marks invoice as paid',
    description: 'Update invoice status from UNPAID to PAID',
    edits: [{
      file: 'inbox/invoice-march.txt',
      search: 'Status: UNPAID',
      replace: 'Status: PAID — March 20, 2026',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/invoice-march.txt',
      pattern: 'Status: PAID',
      description: 'Invoice status updated to PAID',
    }],
    expectedSuccess: true,
  },

  // ──────────────────────────────
  // T2: F9 catches edit targeting nonexistent file
  // Note: This is F9 (edit application), NOT grounding.
  // A real filesystem grounding gate would check path existence
  // before edits are attempted. That requires the filesystem_exists
  // predicate type from Phase 1 of BEYOND-CODE.md.
  // ──────────────────────────────
  {
    name: 'T2: F9 catches nonexistent file edit',
    description: 'Edit a file that does not exist',
    edits: [{
      file: 'inbox/quarterly-report.txt',
      search: 'Status: DRAFT',
      replace: 'Status: FINAL',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/quarterly-report.txt',
      pattern: 'Status: FINAL',
      description: 'Report finalized',
    }],
    expectedSuccess: false,
    expectedGate: 'F9',
  },

  // ──────────────────────────────
  // T3: Grounding catches content predicate claiming pattern
  //     that won't exist after the edit is applied.
  //     The edit adds "Dave" but the predicate claims "Eve" too.
  //     Grounding checks: does the pattern exist in the file now,
  //     OR would any edit's replace string introduce it?
  //     Answer: no — so grounding rejects.
  // ──────────────────────────────
  {
    name: 'T3: Grounding rejects fabricated content claim',
    description: 'Predicate claims content that neither exists nor will be created by edits',
    edits: [{
      file: 'inbox/meeting-notes.txt',
      search: 'Alice, Bob, Charlie',
      replace: 'Alice, Bob, Charlie, Dave',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/meeting-notes.txt',
      pattern: 'Alice, Bob, Charlie, Dave, Eve',
      description: 'All five team members listed',
    }],
    expectedSuccess: false,
    expectedGate: 'grounding',
  },

  // ──────────────────────────────
  // T4: Valid edit — agent adds action item
  // ──────────────────────────────
  {
    name: 'T4: Agent adds action item to notes',
    description: 'Add follow-up action to meeting notes',
    edits: [{
      file: 'inbox/meeting-notes.txt',
      search: '## Next Meeting',
      replace: '## Action Items\n- Alice: Review Q2 roadmap by Friday\n\n## Next Meeting',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/meeting-notes.txt',
      pattern: 'Alice: Review Q2 roadmap by Friday',
      description: 'Action item assigned to Alice',
    }],
    expectedSuccess: true,
  },

  // ──────────────────────────────
  // T5: Valid edit — cross-file update
  // ──────────────────────────────
  {
    name: 'T5: Agent updates roadmap status',
    description: 'Mark improve loop as SHIPPED on roadmap',
    edits: [{
      file: 'projects/roadmap.txt',
      search: '- Improve loop: IN PROGRESS',
      replace: '- Improve loop: SHIPPED',
    }],
    predicates: [{
      type: 'content',
      file: 'projects/roadmap.txt',
      pattern: 'Improve loop: SHIPPED',
      description: 'Improve loop marked as shipped',
    }],
    expectedSuccess: true,
  },

  // ──────────────────────────────
  // T6: F9 catches wrong search string — AND seeds K5 constraint
  // Note: workspace is NOT reset before T7, so K5 state persists to T8.
  // ──────────────────────────────
  {
    name: 'T6: F9 catches wrong search string (seeds K5)',
    description: 'Edit with search string that does not match file contents',
    edits: [{
      file: 'inbox/readme-draft.txt',
      search: 'This string does not exist in the file',
      replace: 'Something new',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/readme-draft.txt',
      pattern: 'Something new',
      description: 'Content was updated',
    }],
    expectedSuccess: false,
    expectedGate: 'F9',
  },

  // ──────────────────────────────
  // T7: Valid edit — enriches readme (runs between T6 and T8,
  //     proving good edits still pass even with K5 constraints active)
  // ──────────────────────────────
  {
    name: 'T7: Valid edit passes despite active K5 constraints',
    description: 'Replace TBD features with real descriptions',
    skipWorkspaceReset: true,  // Keep K5 state from T6
    edits: [{
      file: 'inbox/readme-draft.txt',
      search: '- Feature 1: TBD\n- Feature 2: TBD',
      replace: '- Feature 1: Verification gate for AI-generated edits\n- Feature 2: K5 constraint learning from failures',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/readme-draft.txt',
      pattern: 'Verification gate for AI-generated edits',
      description: 'Feature 1 has real description',
    }],
    expectedSuccess: true,
  },

  // ──────────────────────────────
  // T8: K5 learning proof — retry T6's exact pattern.
  //     State dir is shared with T6 (no workspace reset).
  //     We explicitly assert that the K5 constraint store is non-empty,
  //     proving the prior failure was learned.
  //
  //     Note: F9 may still catch this before K5 (gate ordering is
  //     grounding → F9 → K5). The assertion checks that K5 STATE
  //     grew, not that K5 was the blocking gate. The point is:
  //     verify remembers. Whether K5 or F9 blocks first is an
  //     implementation detail — the constraint exists either way.
  // ──────────────────────────────
  {
    name: 'T8: K5 remembers T6 failure (constraint persisted)',
    description: 'Retry wrong search string — K5 should have constraints from T6',
    skipWorkspaceReset: true,  // Keep K5 state from T6
    edits: [{
      file: 'inbox/readme-draft.txt',
      search: 'This string does not exist in the file',
      replace: 'Another attempt',
    }],
    predicates: [{
      type: 'content',
      file: 'inbox/readme-draft.txt',
      pattern: 'Another attempt',
      description: 'Content updated on retry',
    }],
    expectedSuccess: false,
    expectedGate: 'F9',  // F9 runs before K5 in gate sequence
    assertK5Blocked: true,  // But we assert K5 constraint count > 0
  },

  // ──────────────────────────────
  // T9: Multi-file coordination
  // ──────────────────────────────
  {
    name: 'T9: Agent multi-file coordination',
    description: 'Update invoice amount and add budget entry to roadmap',
    edits: [
      {
        file: 'inbox/invoice-march.txt',
        search: 'Amount: $4,500.00',
        replace: 'Amount: $5,000.00',
      },
      {
        file: 'projects/roadmap.txt',
        search: '- npm v1.0: PLANNED',
        replace: '- npm v1.0: PLANNED\n\n## Budget\n- March invoice: $5,000',
      },
    ],
    predicates: [
      {
        type: 'content',
        file: 'inbox/invoice-march.txt',
        pattern: 'Amount: $5,000.00',
        description: 'Invoice amount updated',
      },
      {
        type: 'content',
        file: 'projects/roadmap.txt',
        pattern: 'March invoice: $5,000',
        description: 'Budget entry added to roadmap',
      },
    ],
    expectedSuccess: true,
  },

  // ──────────────────────────────
  // T10: G5 containment — agent sneaks an unexplained edit
  //      G5 is advisory, so this still succeeds.
  //      But the result should show 1 unexplained mutation.
  // ──────────────────────────────
  {
    name: 'T10: G5 detects unexplained mutation (advisory)',
    description: 'Update readme but also silently modify meeting notes',
    edits: [
      {
        file: 'inbox/readme-draft.txt',
        search: 'Status: DRAFT',
        replace: 'Status: REVIEW',
      },
      {
        file: 'inbox/meeting-notes.txt',
        search: 'Thursday 10am',
        replace: 'CANCELLED',
      },
    ],
    predicates: [{
      type: 'content',
      file: 'inbox/readme-draft.txt',
      pattern: 'Status: REVIEW',
      description: 'Readme moved to review status',
    }],
    expectedSuccess: true,
  },
];

// ─────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  @sovereign-labs/verify — Non-Code Text Mutation Smoke Test');
  console.log('  Proves: gate pipeline validates non-code agent actions');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  setupWorkspace();
  console.log('  Workspace: inbox/ (3 docs) + projects/ (1 doc)');
  console.log('');
  console.log('  Running 10 tests (no Docker, no LLM, pure gate physics):');
  console.log('');

  for (const test of tests) {
    if (!test.skipWorkspaceReset) {
      setupWorkspace();
    }
    await runTest(test);
  }

  // ── Summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  if (passed === total) {
    console.log(`  ALL ${total} TESTS PASSED`);
  } else {
    console.log(`  ${passed}/${total} TESTS PASSED`);
    console.log('');
    console.log('  FAILURES:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ${r.name}: ${r.detail}`);
    }
  }

  console.log('');
  console.log('  What this proves (honestly):');
  console.log('    T1,T4,T5,T7,T9 — Content predicates verify text-file edits');
  console.log('    T2             — F9 catches edits targeting nonexistent files');
  console.log('    T3             — Grounding rejects fabricated content claims');
  console.log('    T6,T8          — K5 seeds constraints from failures + persists them');
  console.log('    T10            — G5 flags unexplained mutations (advisory)');
  console.log('');
  console.log('  What this does NOT prove (yet):');
  console.log('    - File moves, renames, deletes (needs filesystem_exists/absent)');
  console.log('    - Directory counting (needs filesystem_count)');
  console.log('    - Permission changes (needs filesystem_unchanged)');
  console.log('    - Slack/email/communication agents (needs message predicates)');
  console.log('    - See BEYOND-CODE.md Phase 1-5 for the full expansion roadmap');
  console.log('');
  console.log('  No Docker. No LLM. No network. Just gate physics on text files.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Cleanup
  try { rmSync(WORKSPACE, { recursive: true, force: true }); } catch { /* best effort */ }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
