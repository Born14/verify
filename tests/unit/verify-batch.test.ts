import { describe, test, expect } from 'bun:test';
import { verifyBatch } from '../../src/verify.js';
import { resolve } from 'path';

const APP_DIR = resolve(import.meta.dir, '../../fixtures/demo-app');

describe('verifyBatch', () => {
  test('two agents, no conflict — both pass', async () => {
    const result = await verifyBatch([
      {
        agent: 'designer',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: #001f3f; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: '#001f3f' }],
      },
      {
        agent: 'stylist',
        edits: [{
          file: 'server.js',
          search: '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }',
          replace: '.badge { display: inline-block; background: orange; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }',
        }],
        predicates: [{ type: 'css', selector: '.badge', property: 'background', expected: 'orange' }],
      },
    ], { appDir: APP_DIR });

    expect(result.success).toBe(true);
    expect(result.agentResults).toHaveLength(2);
    expect(result.agentResults[0].agent).toBe('designer');
    expect(result.agentResults[0].result.success).toBe(true);
    expect(result.agentResults[1].agent).toBe('stylist');
    expect(result.agentResults[1].result.success).toBe(true);
  });

  test('two agents editing same file — both verified independently', async () => {
    // Each agent is verified against the original codebase (isolated staging).
    // Both edits target the same line but each gets a fresh copy.
    const result = await verifyBatch([
      {
        agent: 'agent-a',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: navy; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: 'navy' }],
      },
      {
        agent: 'agent-b',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: red; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: 'red' }],
      },
    ], { appDir: APP_DIR, stopOnFailure: false });

    // Both pass — each verified against original state
    expect(result.success).toBe(true);
    expect(result.agentResults).toHaveLength(2);
    expect(result.agentResults[0].result.success).toBe(true);
    expect(result.agentResults[1].result.success).toBe(true);
    // The caller detects the conflict (same file, same line) — verify reports both as valid individually
  });

  test('stopOnFailure: true — stops after first failure', async () => {
    const result = await verifyBatch([
      {
        agent: 'bad-agent',
        edits: [{
          file: 'server.js',
          search: 'THIS_STRING_DOES_NOT_EXIST_ANYWHERE',
          replace: 'replaced',
        }],
        predicates: [{ type: 'content', file: 'server.js', pattern: 'replaced' }],
      },
      {
        agent: 'good-agent',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: green; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: 'green' }],
      },
    ], { appDir: APP_DIR, stopOnFailure: true });

    expect(result.success).toBe(false);
    expect(result.agentResults).toHaveLength(1); // stopped after first
    expect(result.agentResults[0].agent).toBe('bad-agent');
  });

  test('stopOnFailure: false — runs all agents, reports all', async () => {
    const result = await verifyBatch([
      {
        agent: 'bad-agent',
        edits: [{
          file: 'server.js',
          search: 'THIS_STRING_DOES_NOT_EXIST_ANYWHERE',
          replace: 'replaced',
        }],
        predicates: [{ type: 'content', file: 'server.js', pattern: 'replaced' }],
      },
      {
        agent: 'good-agent',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: green; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: 'green' }],
      },
    ], { appDir: APP_DIR, stopOnFailure: false });

    expect(result.success).toBe(false);
    expect(result.agentResults).toHaveLength(2); // both ran
    expect(result.agentResults[0].result.success).toBe(false);
    expect(result.agentResults[1].result.success).toBe(true);
  });

  test('agent name appears in attestation', async () => {
    const result = await verifyBatch([
      {
        agent: 'my-planner',
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: #001f3f; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{ type: 'css', selector: '.hero', property: 'background', expected: '#001f3f' }],
      },
    ], { appDir: APP_DIR });

    expect(result.agentResults[0].result.attestation).toContain('my-planner');
  });
});
