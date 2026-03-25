/**
 * Generates message gate scenarios.
 * The message gate is standalone (runMessageGate) and NOT part of the verify() pipeline.
 * It validates agent outbound messages against policies.
 * Since it's separate from verify(), these scenarios need a custom runner that calls
 * runMessageGate() directly, NOT verify().
 *
 * Run: bun scripts/harvest/stage-message-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/message-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `msg-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// Family: destination — destination allow/deny
// =============================================================================

push({
  description: 'destination allowed: target in allow list',
  envelope: {
    destination: { target: '#general', platform: 'slack' },
    content: { body: 'Deploy complete for v2.0' },
    sender: { identity: 'sovereign-agent' },
  },
  policy: {
    destinations: { allow: ['#general', '#deploys'] },
  },
  expectedVerdict: 'approved',
  tags: ['message', 'destination'],
  rationale: '#general is in the allow list',
});

push({
  description: 'destination denied: target in deny list',
  envelope: {
    destination: { target: '#executive', platform: 'slack' },
    content: { body: 'Deploy status update' },
    sender: { identity: 'sovereign-agent' },
  },
  policy: {
    destinations: { deny: ['#executive', '#board'] },
  },
  expectedVerdict: 'blocked',
  expectedReason: 'destination_denied',
  tags: ['message', 'destination_denied'],
  rationale: '#executive is in the deny list',
});

push({
  description: 'destination: no rules, all allowed',
  envelope: {
    destination: { target: 'anyone@example.com', platform: 'email' },
    content: { body: 'Hello world' },
    sender: { identity: 'agent' },
  },
  policy: {},
  expectedVerdict: 'approved',
  tags: ['message', 'destination'],
  rationale: 'No destination rules means all destinations allowed',
});

// =============================================================================
// Family: forbidden — forbidden content patterns
// =============================================================================

push({
  description: 'forbidden: clean message passes',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'Deployment completed successfully.' },
    sender: { identity: 'agent' },
  },
  policy: {
    forbidden: ['password', 'secret', 'api_key'],
  },
  expectedVerdict: 'approved',
  tags: ['message', 'forbidden'],
  rationale: 'Message body does not contain any forbidden patterns',
});

push({
  description: 'forbidden: message contains forbidden pattern',
  envelope: {
    destination: { target: '#general' },
    content: { body: 'The password for the database is hunter2' },
    sender: { identity: 'agent' },
  },
  policy: {
    forbidden: ['password', 'secret', 'api_key'],
  },
  expectedVerdict: 'blocked',
  expectedReason: 'forbidden_content',
  tags: ['message', 'forbidden_blocked'],
  rationale: 'Message contains "password" which is forbidden',
});

// =============================================================================
// Family: required — required content checks
// =============================================================================

push({
  description: 'required: message has required content for topic',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'Deployed version 2.0 to production. Checkpoint: CP-123' },
    sender: { identity: 'agent' },
    topic: { value: 'deploy', source: 'agent' },
  },
  policy: {
    required: [{
      topic: 'deploy',
      contains: ['version', 'production'],
    }],
  },
  expectedVerdict: 'approved',
  tags: ['message', 'required'],
  rationale: 'Message contains all required strings for deploy topic',
});

push({
  description: 'required: message missing required content',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'Something happened.' },
    sender: { identity: 'agent' },
    topic: { value: 'deploy', source: 'agent' },
  },
  policy: {
    required: [{
      topic: 'deploy',
      contains: ['version', 'checkpoint'],
    }],
  },
  expectedVerdict: 'blocked',
  expectedReason: 'missing_required',
  tags: ['message', 'required_blocked'],
  rationale: 'Message lacks required "version" and "checkpoint" strings',
});

// =============================================================================
// Family: topic — topic resolution and override
// =============================================================================

push({
  description: 'topic: agent label trusted when no policy topics',
  envelope: {
    destination: { target: '#general' },
    content: { body: 'Just a general update' },
    sender: { identity: 'agent' },
    topic: { value: 'general', source: 'agent' },
  },
  policy: {},
  expectedVerdict: 'approved',
  tags: ['message', 'topic'],
  rationale: 'No topic policy, agent label trusted',
});

push({
  description: 'topic: content detection overrides agent label (narrowed)',
  envelope: {
    destination: { target: '#general' },
    content: { body: 'Deployed v3.0 to production servers' },
    sender: { identity: 'agent' },
    topic: { value: 'general', source: 'agent' },
  },
  policy: {
    topics: {
      deploy: { detect: ['deployed', 'production', 'rollback'] },
    },
  },
  expectedVerdict: 'narrowed',
  tags: ['message', 'topic_override'],
  rationale: 'Content contains deploy keywords, topic overridden by content detection → narrowed',
});

// =============================================================================
// Family: claims — claim verification
// =============================================================================

push({
  description: 'claims: message with verifiable claim, evidence exists',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'All tests passed for this deploy.' },
    sender: { identity: 'agent' },
    topic: { value: 'deploy', source: 'agent' },
  },
  policy: {
    claims: {
      deploy: {
        assertions: {
          tests_passed: {
            triggers: ['tests passed', 'all tests'],
            evidence: 'test_results',
          },
        },
      },
    },
  },
  evidenceProviders: {
    test_results: { exists: true, fresh: true, detail: 'All 42 tests passed' },
  },
  expectedVerdict: 'approved',
  tags: ['message', 'claims'],
  rationale: 'Claim trigger found, evidence provider confirms tests passed',
});

push({
  description: 'claims: message with claim, evidence missing',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'All tests passed and deploy is live.' },
    sender: { identity: 'agent' },
    topic: { value: 'deploy', source: 'agent' },
  },
  policy: {
    claims: {
      deploy: {
        assertions: {
          tests_passed: {
            triggers: ['tests passed'],
            evidence: 'test_results',
          },
        },
      },
    },
  },
  evidenceProviders: {
    test_results: { exists: false, fresh: false, detail: 'No test results found' },
  },
  expectedVerdict: 'blocked',
  expectedReason: 'claim_unsupported',
  tags: ['message', 'claims_blocked'],
  rationale: 'Claim trigger found but evidence does not exist → blocked',
});

// =============================================================================
// Family: denied_patterns — K5-style memory
// =============================================================================

push({
  description: 'denied_patterns: message matches previously denied pattern',
  envelope: {
    destination: { target: '#general' },
    content: { body: 'Restarting the database server now' },
    sender: { identity: 'agent' },
  },
  policy: {},
  deniedPatterns: [
    { pattern: 'restarting the database', reason: 'Previously caused outage', timestamp: Date.now() - 60000 },
  ],
  expectedVerdict: 'blocked',
  expectedReason: 'previously_denied',
  tags: ['message', 'denied_patterns'],
  rationale: 'Message matches a previously denied pattern from K5 memory',
});

push({
  description: 'denied_patterns: no match, passes',
  envelope: {
    destination: { target: '#general' },
    content: { body: 'Deploy completed successfully' },
    sender: { identity: 'agent' },
  },
  policy: {},
  deniedPatterns: [
    { pattern: 'restarting the database', reason: 'Previously caused outage', timestamp: Date.now() - 60000 },
  ],
  expectedVerdict: 'approved',
  tags: ['message', 'denied_patterns'],
  rationale: 'Message does not match any denied patterns',
});

// =============================================================================
// Family: negation — negation detection in claims
// =============================================================================

push({
  description: 'negation: obvious negation suppresses trigger',
  envelope: {
    destination: { target: '#deploys' },
    content: { body: 'Tests have not passed yet. Still running.' },
    sender: { identity: 'agent' },
    topic: { value: 'deploy', source: 'agent' },
  },
  policy: {
    claims: {
      deploy: {
        assertions: {
          tests_passed: {
            triggers: ['tests passed', 'passed'],
            evidence: 'test_results',
          },
        },
      },
    },
  },
  evidenceProviders: {
    test_results: { exists: false, fresh: false, detail: 'No results' },
  },
  expectedVerdict: 'clarify',
  expectedReason: 'ambiguous_negation',
  tags: ['message', 'negation'],
  rationale: '"not passed yet" matches ambiguous negation pattern (trigger: "passed"), not obvious prefix suppression',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} message scenarios to ${outPath}`);
