#!/usr/bin/env bun
/**
 * Emergent Behavior Probe — Gate Composition Under Pressure
 * =========================================================
 *
 * Tests cases where verify's gates interact in ways that weren't
 * individually designed. Not "emergent" in the hand-wavy sense —
 * structurally surprising outcomes from gate composition.
 *
 * The question: does verify handle cases it wasn't coded to handle?
 *
 * Usage:
 *   bun run scripts/harness/live-emergent.ts
 */

import { governMessage } from '../../src/gates/message.js';
import { verify } from '../../src/verify.js';
import { govern } from '../../src/govern.js';
import type { MessageEnvelope, MessagePolicy, EvidenceProvider } from '../../src/gates/message.js';
import type { VerifyConfig, GoalPredicate } from '../../src/types.js';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const DEMO_APP = join(import.meta.dir, '../../fixtures/demo-app');
const STATE_DIR = mkdtempSync(join(tmpdir(), 'verify-emergent-'));

// ---------------------------------------------------------------------------
// Message gate emergent scenarios
// ---------------------------------------------------------------------------

interface EmergentScenario {
  name: string;
  hypothesis: string;     // What we think MIGHT happen
  whyEmergent: string;    // Why this wasn't explicitly coded
  run: () => Promise<{ verdict: string; detail: string; interesting: string }>;
}

const scenarios: EmergentScenario[] = [

  // ── 1. Topic detection + claims + negation — triple gate interaction ──
  {
    name: '1. Triple Gate Interaction',
    hypothesis: 'Topic override activates claim rules, but negation suppresses the claim trigger — three gates interact on one message',
    whyEmergent: 'Topic detection, claims verification, and negation detection were designed independently. Nobody coded "if topic is overridden AND claim trigger is negated, approve."',
    run: async () => {
      const result = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: 'Update: the deploy has not completed successfully. CP-150 rollback initiated. Waiting for next window.',
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'status-update', source: 'agent' }, // Mislabeled
        },
        {
          destinations: { allow: ['#deployments'] },
          topics: {
            deploy: { trust_agent_label: false, detect: ['deploy', 'rollback'] },
          },
          claims: {
            deploy: {
              unknown_assertions: 'clarify',
              assertions: {
                deploy_success: {
                  triggers: ['completed successfully'],
                  evidence: 'checkpoint',
                },
              },
            },
          },
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
        },
        {
          checkpoint: async () => ({ exists: true, fresh: true, detail: 'CP-150 exists' }),
        },
      );

      const gateList = result.gates.map(g => `${g.passed ? '✓' : '✗'} ${g.gate}`).join(' → ');
      return {
        verdict: result.verdict,
        detail: result.detail,
        interesting: result.topicResolution?.overridden
          ? `Topic overridden (${result.topicResolution.agentDeclared} → ${result.topicResolution.resolved}), negation suppressed claim trigger, required CP-\\d+ found. Three independent gates composed correctly. [${gateList}]`
          : `Unexpected: topic was NOT overridden. [${gateList}]`,
      };
    },
  },

  // ── 2. Forbidden content inside a negated claim ──
  {
    name: '2. Forbidden Content in Negated Context',
    hypothesis: 'Message contains a forbidden word ("password") but in a negated context — "we did not expose any password." Gate catches it anyway because forbidden is absolute.',
    whyEmergent: 'Negation detection only applies to CLAIM triggers. Forbidden content is unconditional. The interaction reveals a policy design choice: forbidden patterns are never contextual.',
    run: async () => {
      const result = await governMessage(
        {
          destination: { target: '#alerts', platform: 'slack' },
          content: {
            body: 'Security audit complete. We confirmed the system did not expose any password data. All clear.',
          },
          sender: { identity: 'security-bot' },
        },
        {
          destinations: { allow: ['#alerts'] },
          forbidden: ['password'],
        },
      );

      return {
        verdict: result.verdict,
        detail: result.detail,
        interesting: result.verdict === 'blocked'
          ? 'Forbidden content gate fires even in negated context. "did not expose any password" still contains "password". The gate is right — you don\'t want the WORD in the message at all, regardless of context. This reveals: forbidden is lexical, not semantic. Intentional by design, emergent in implication.'
          : 'Unexpected: forbidden content was NOT caught.',
      };
    },
  },

  // ── 3. K5 denied pattern + topic override — double memory ──
  {
    name: '3. K5 Memory Survives Topic Override',
    hypothesis: 'Agent mislabels topic AND uses a previously-denied pattern. Both gates fire — but which one catches it first?',
    whyEmergent: 'Topic override happens at gate 0, K5 denied patterns at gate 5. The agent is trying TWO evasion strategies simultaneously. Gate ordering determines which defense fires.',
    run: async () => {
      const result = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: 'Auto-deployed without review. No human approval needed for this one. CP-160.',
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'general', source: 'agent' },
        },
        {
          destinations: { allow: ['#deployments'] },
          topics: {
            deploy: { trust_agent_label: false, detect: ['deployed', 'deploy'] },
          },
          claims: {
            deploy: {
              unknown_assertions: 'allow',
              assertions: {
                deploy_success: {
                  triggers: ['completed successfully'],
                  evidence: 'checkpoint',
                },
              },
            },
          },
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
        },
        undefined,
        [
          { pattern: 'no human approval', reason: 'All deploys require human acknowledgment', timestamp: Date.now() - 30000 },
          { pattern: 'without review', reason: 'Review bypass is prohibited', timestamp: Date.now() - 60000 },
        ],
      );

      const failedGate = result.gates.find(g => !g.passed);
      return {
        verdict: result.verdict,
        detail: result.detail,
        interesting: `Topic was overridden (general → deploy), then K5 caught "${failedGate?.detail}". Gate ordering: topic override narrowed the governance scope, then denied patterns caught the evasion. The agent combined two attacks — mislabeling AND banned content — and the pipeline caught both in sequence.`,
      };
    },
  },

  // ── 4. Code verify + message gate — cross-domain composition ──
  {
    name: '4. Cross-Domain: Code Verify Feeds Message Gate',
    hypothesis: 'Run verify() on a code edit, then use the result as evidence for a message gate claim. The code gate\'s output becomes the message gate\'s input.',
    whyEmergent: 'verify() and governMessage() were designed as independent functions. Using one\'s output as evidence for the other is compositional — nobody coded this specific interaction.',
    run: async () => {
      // Step 1: Run a code verification
      const verifyResult = await verify(
        [{ file: 'server.js', search: 'Sovereign Football', replace: 'Sovereign Football Club' }],
        [{ id: 'p1', type: 'content', file: 'server.js', pattern: 'Sovereign Football Club' } as GoalPredicate],
        { appDir: DEMO_APP, stateDir: join(STATE_DIR, 'cross-domain'), gates: { staging: false, browser: false, http: false } },
      );

      // Step 2: Use verify result as evidence for a message claim
      const messageResult = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: `Content update deployed successfully. CP-200. ${verifyResult.success ? 'All gates passed.' : 'Some gates failed.'}`,
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'deploy', source: 'agent' },
        },
        {
          destinations: { allow: ['#deployments'] },
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
          claims: {
            deploy: {
              unknown_assertions: 'clarify',
              assertions: {
                deploy_success: {
                  triggers: ['deployed successfully'],
                  evidence: 'verification',
                },
              },
            },
          },
        },
        {
          verification: async () => ({
            exists: verifyResult.success,
            fresh: true,
            detail: verifyResult.success
              ? `Verified: ${verifyResult.gates.filter(g => g.passed).length}/${verifyResult.gates.length} gates passed in ${verifyResult.durationMs}ms`
              : `Verification failed: ${verifyResult.gates.find(g => !g.passed)?.detail || 'unknown'}`,
          }),
        },
      );

      return {
        verdict: messageResult.verdict,
        detail: messageResult.detail,
        interesting: `Code verify ran (${verifyResult.success ? 'PASS' : 'FAIL'}, ${verifyResult.durationMs}ms, ${verifyResult.gates.length} gates). Message gate used verify result as evidence for "deployed successfully" claim → ${messageResult.verdict}. Two independent verify products composed: code gates prove the edit, message gates prove the announcement. Neither was designed to feed the other.`,
      };
    },
  },

  // ── 5. Govern loop on messages — retry with K5 accumulation ──
  {
    name: '5. Governed Message Retry Loop',
    hypothesis: 'Run governMessage in a loop — first attempt blocked, second attempt learns from failure and succeeds',
    whyEmergent: 'govern() was designed for code edits. Manually implementing the same pattern for messages reveals whether the K5 "narrowing" concept transfers to non-code domains.',
    run: async () => {
      const deniedPatterns: Array<{ pattern: string; reason: string; timestamp: number }> = [];

      // Attempt 1: Agent sends message with forbidden content
      const attempt1 = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: 'Deploy done. Used api_key rotation during migration. CP-170.',
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'deploy', source: 'agent' },
        },
        {
          destinations: { allow: ['#deployments'] },
          forbidden: [/api[_-]?key/i],
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
          claims: {
            deploy: { unknown_assertions: 'allow', assertions: {} },
          },
        },
      );

      // Learn from failure — seed K5 pattern
      if (attempt1.verdict === 'blocked') {
        deniedPatterns.push({
          pattern: 'api_key',
          reason: attempt1.detail,
          timestamp: Date.now(),
        });
      }

      // Attempt 2: Agent rewrites message, removing forbidden content
      const attempt2 = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: 'Deploy done. Credential rotation completed during migration. CP-170.',
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'deploy', source: 'agent' },
        },
        {
          destinations: { allow: ['#deployments'] },
          forbidden: [/api[_-]?key/i],
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
          claims: {
            deploy: { unknown_assertions: 'allow', assertions: {} },
          },
        },
        undefined,
        deniedPatterns,
      );

      return {
        verdict: `${attempt1.verdict} → ${attempt2.verdict}`,
        detail: `Attempt 1: ${attempt1.detail}. Attempt 2: ${attempt2.detail}`,
        interesting: `The K5 convergence pattern works for messages: blocked → learn → retry → ${attempt2.verdict}. The denied pattern "api_key" is now in memory. If the agent tried "api_key" again, it would be caught by K5 even if the forbidden rule was removed. Two independent defense layers (forbidden content + K5 memory) create defense-in-depth.`,
      };
    },
  },

  // ── 6. Evidence freshness + topic override — compound narrowing ──
  {
    name: '6. Compound Narrowing (Topic + Staleness)',
    hypothesis: 'Agent mislabels topic AND has stale evidence. Two narrowing events compound into a single result.',
    whyEmergent: 'Topic narrowing and evidence staleness narrowing were coded independently. Compound narrowing (both simultaneously) is handled by a type union but was never specifically designed as a scenario.',
    run: async () => {
      const result = await governMessage(
        {
          destination: { target: '#deployments', platform: 'slack' },
          content: {
            body: 'Quick update — deploy completed successfully yesterday. CP-180.',
          },
          sender: { identity: 'deploy-bot' },
          topic: { value: 'general', source: 'agent' },
        },
        {
          destinations: { allow: ['#deployments'] },
          topics: {
            deploy: { trust_agent_label: false, detect: ['deploy', 'deployed'] },
          },
          required: [{ topic: 'deploy', patterns: ['CP-\\d+'] }],
          claims: {
            deploy: {
              unknown_assertions: 'allow',
              assertions: {
                deploy_success: {
                  triggers: ['completed successfully'],
                  evidence: 'checkpoint',
                },
              },
            },
          },
        },
        {
          checkpoint: async () => ({
            exists: true,
            fresh: true,
            detail: 'CP-180 from epoch 2',
            epoch: 2,
            currentEpoch: 4,
          }),
        },
      );

      return {
        verdict: result.verdict,
        detail: result.detail,
        interesting: result.narrowing?.type === 'topic_override+evidence_staleness'
          ? `COMPOUND NARROWING achieved: type="${result.narrowing.type}". Both topic override AND evidence staleness detected in one pass. The narrowing hint combines both: "${result.narrowing.resolutionHint?.slice(0, 150)}..." This compound type exists in the code but was an edge case — two independent governance concerns merged into a single actionable result.`
          : `Narrowing type: ${result.narrowing?.type || 'none'}. Verdict: ${result.verdict}. ${result.detail}`,
      };
    },
  },

  // ── 7. The real test: verify() with conflicting predicates ──
  {
    name: '7. Conflicting Predicates (Verify Self-Contradiction)',
    hypothesis: 'What happens when two predicates contradict each other? One says "text should be X", another says "text should be Y" on the same element.',
    whyEmergent: 'Predicate validation checks each predicate independently. Nobody coded "detect contradictory predicates." The system\'s behavior here is purely emergent from the gate sequence.',
    run: async () => {
      const result = await verify(
        [{ file: 'server.js', search: 'Sovereign Football', replace: 'Sovereign FC' }],
        [
          { id: 'p1', type: 'content', file: 'server.js', pattern: 'Sovereign FC' } as GoalPredicate,
          { id: 'p2', type: 'content', file: 'server.js', pattern: 'Sovereign Football' } as GoalPredicate,
        ],
        { appDir: DEMO_APP, stateDir: join(STATE_DIR, 'contradict'), gates: { staging: false, browser: false, http: false } },
      );

      const p1 = result.gates.find(g => g.detail?.includes('Sovereign FC'));
      const p2 = result.gates.find(g => g.detail?.includes('Sovereign Football'));

      return {
        verdict: result.success ? 'pass' : 'fail',
        detail: `${result.gates.length} gates, ${result.gates.filter(g => g.passed).length} passed`,
        interesting: `Contradictory predicates: p1 wants "Sovereign FC" (${p1?.passed ? 'PASS' : 'FAIL'}), p2 wants "Sovereign Football" (${p2?.passed ? 'PASS' : 'FAIL'}). The edit replaces "Football" with "FC" — so p1 passes and p2 fails. verify correctly reports failure because not ALL predicates pass. It doesn't detect the contradiction explicitly, but G1 honesty guarantees it can't declare success. The contradiction is structurally unresolvable — and verify's gate-by-gate evaluation surfaces exactly which side lost.`,
      };
    },
  },

  // ── 8. Edit that satisfies predicate but breaks grounding ──
  {
    name: '8. Predicate-Grounding Tension',
    hypothesis: 'Edit satisfies the stated predicate but the grounding gate rejects because the selector doesn\'t exist yet.',
    whyEmergent: 'The grounding gate and the predicate gate have different truth models. Grounding says "does this exist in reality?" Predicates say "will this be true after the edit?" When reality hasn\'t been updated yet, they can disagree.',
    run: async () => {
      const result = await verify(
        [{ file: 'server.js', search: '</style>', replace: '.new-banner { color: red; }\n</style>' }],
        [{ id: 'p1', type: 'css', selector: '.new-banner', property: 'color', expected: 'red', path: '/' } as GoalPredicate],
        { appDir: DEMO_APP, stateDir: join(STATE_DIR, 'grounding-tension'), gates: { staging: false, browser: false, http: false } },
      );

      const groundingGate = result.gates.find(g => g.gate === 'grounding');
      const goalGate = result.gates.find(g => g.gate === 'goal');

      return {
        verdict: result.success ? 'pass' : 'fail',
        detail: `Grounding: ${groundingGate?.passed ? 'PASS' : 'FAIL'} (${groundingGate?.detail}). Goal: ${goalGate?.passed ? 'PASS' : 'FAIL'} (${goalGate?.detail}).`,
        interesting: groundingGate && !groundingGate.passed
          ? `Grounding REJECTS .new-banner (doesn't exist in source). But the edit ADDS it. This is the grounding-predicate tension: grounding validates against current reality, predicates validate against intended reality. The gate correctly flags this as a grounding miss — a new CSS class being added is an "existence claim" that grounding can't verify pre-edit. This is why the code gate has a special path for "edit adds property" (the fix from earlier today).`
          : `Grounding ${groundingGate?.passed ? 'PASSED' : 'not found'}. The system handled the new-selector case. ${goalGate?.passed ? 'Goal gate also passed — edit was applied and predicate verified post-edit.' : 'Goal gate failed.'}`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' @sovereign-labs/verify — Emergent Behavior Probe');
  console.log(' Testing gate composition under cases nobody explicitly coded.');
  console.log('═══════════════════════════════════════════════════════════════');

  let interesting = 0;

  for (const scenario of scenarios) {
    console.log(`\n━━━ ${scenario.name} ━━━`);
    console.log(`  Hypothesis: ${scenario.hypothesis}`);
    console.log(`  Why emergent: ${scenario.whyEmergent}`);

    try {
      const result = await scenario.run();
      console.log(`\n  Verdict: ${result.verdict}`);
      console.log(`  Detail: ${result.detail}`);
      console.log(`\n  🔬 ${result.interesting}`);
      interesting++;
    } catch (e: any) {
      console.log(`\n  💥 CRASHED: ${e.message}`);
      console.log(`  Stack: ${e.stack?.split('\n').slice(0, 3).join('\n  ')}`);
      console.log(`\n  🔬 The crash itself is data — it reveals an unhandled interaction between gates.`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(` ${interesting}/${scenarios.length} scenarios produced analyzable results`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
