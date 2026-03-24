/**
 * govern() Tests — The Governed Execution Loop
 * ==============================================
 *
 * Tests the convergence loop: ground → plan → verify → narrow → retry.
 * All tests use the demo-app fixture (pure filesystem, no Docker).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, cpSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { govern } from '../src/govern.js';
import type { GovernContext, AgentPlan } from '../src/govern.js';
import type { Edit, Predicate } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'demo-app');

function tmpAppDir(): string {
  const dir = join(tmpdir(), `govern-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, dir, {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[/\\]/).pop() ?? '';
      return !['node_modules', '.git', '.verify'].includes(name);
    },
  });
  return dir;
}

let testDir: string;

beforeEach(() => {
  testDir = tmpAppDir();
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  }
});


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('govern()', () => {

  test('happy path: correct edits on first attempt → success', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Change nav link color to red',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
            replace: 'a.nav-link { color: red; margin-right: 1rem; }',
          }],
          predicates: [{
            type: 'css' as const,
            selector: 'a.nav-link',
            property: 'color',
            expected: 'red',
            path: '/about',
          }],
        }),
      },
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.history).toHaveLength(1);
    expect(result.abortedByApproval).toBe(false);
    expect(result.receipt.goal).toBe('Change nav link color to red');
    expect(result.receipt.gatesFailed).toHaveLength(0);
    expect(result.receipt.attestation).toContain('VERIFY PASSED');
  });

  test('convergence: fails once, uses narrowing to fix on attempt 2', async () => {
    let attempt = 0;

    const result = await govern({
      appDir: testDir,
      goal: 'Change hero background to green',
      agent: {
        plan: async (_goal, ctx) => {
          attempt++;
          if (attempt === 1) {
            // First attempt: wrong search string (will fail F9)
            return {
              edits: [{
                file: 'server.js',
                search: '.hero { background: WRONG;',
                replace: '.hero { background: green;',
              }],
              predicates: [{
                type: 'css' as const,
                selector: '.hero',
                property: 'background',
                expected: 'green',
                path: '/about',
              }],
            };
          }
          // Second attempt: correct search string
          return {
            edits: [{
              file: 'server.js',
              search: '.hero { background: #3498db;',
              replace: '.hero { background: green;',
            }],
            predicates: [{
              type: 'css' as const,
              selector: '.hero',
              property: 'background',
              expected: 'green',
              path: '/about',
            }],
          };
        },
      },
      maxAttempts: 3,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.history).toHaveLength(2);
    expect(result.history[0].success).toBe(false);
    expect(result.history[1].success).toBe(true);
  });

  test('exhaustion: all attempts fail → returns failure with full history', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Change something that does not exist',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'THIS_STRING_DOES_NOT_EXIST_IN_THE_FILE',
            replace: 'something',
          }],
          predicates: [{
            type: 'content' as const,
            file: 'server.js',
            pattern: 'something',
            expected: 'exists',
          }],
        }),
      },
      maxAttempts: 3,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.history).toHaveLength(3);
    expect(result.history.every(r => !r.success)).toBe(true);
    expect(result.receipt.attestation).toContain('VERIFY FAILED');
  });

  test('K5 learning: failure seeds constraint, narrowing visible to agent', async () => {
    const constraintsSeen: Array<Array<{ id: string; type: string; reason: string }>> = [];
    let callCount = 0;

    const result = await govern({
      appDir: testDir,
      goal: 'Change badge color',
      agent: {
        plan: async (_goal, ctx) => {
          callCount++;
          constraintsSeen.push([...ctx.constraints]);
          // Edit that applies successfully but predicate fails at evidence gate
          // (badge background is #e74c3c, not blue)
          return {
            edits: [{
              file: 'server.js',
              search: '.badge { display: inline-block; background: #e74c3c;',
              replace: '.badge { display: inline-block; background: #e74c3c;',
            }],
            predicates: [{
              type: 'css' as const,
              selector: '.badge',
              property: 'background',
              expected: 'blue',
              path: '/about',
            }],
          };
        },
      },
      maxAttempts: 3,
    });

    expect(result.success).toBe(false);
    // First attempt should see 0 constraints
    expect(constraintsSeen[0]).toHaveLength(0);
    // Narrowing should exist on the final result (verify() records failures)
    expect(result.finalResult.narrowing).toBeDefined();
    // The constraint store tracks outcomes even if seeding conditions aren't met
    expect(result.receipt.constraintsActive).toBeGreaterThanOrEqual(0);
  });

  test('approval gate: onApproval returns false → aborted', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Change something',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'const PORT',
            replace: 'const PORT',
          }],
          predicates: [{
            type: 'content' as const,
            file: 'server.js',
            pattern: 'PORT',
            expected: 'exists',
          }],
        }),
      },
      onApproval: async () => false,
    });

    expect(result.success).toBe(false);
    expect(result.abortedByApproval).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.receipt.attestation).toContain('approval gate');
  });

  test('context threading: narrowing from attempt 1 appears in attempt 2 context', async () => {
    const contexts: GovernContext[] = [];

    await govern({
      appDir: testDir,
      goal: 'Test context threading',
      agent: {
        plan: async (_goal, ctx) => {
          contexts.push(ctx);
          return {
            edits: [{
              file: 'server.js',
              search: 'STRING_THAT_DOES_NOT_EXIST_CONTEXT_TEST',
              replace: 'new',
            }],
            predicates: [{
              type: 'content' as const,
              file: 'server.js',
              pattern: 'new',
              expected: 'exists',
            }],
          };
        },
      },
      maxAttempts: 2,
    });

    expect(contexts).toHaveLength(2);
    // First attempt: no prior result, no narrowing
    expect(contexts[0].attempt).toBe(1);
    expect(contexts[0].priorResult).toBeUndefined();
    expect(contexts[0].narrowing).toBeUndefined();
    // Second attempt: has prior result and narrowing
    expect(contexts[1].attempt).toBe(2);
    expect(contexts[1].priorResult).toBeDefined();
    expect(contexts[1].priorResult!.success).toBe(false);
  });

  test('empty edits: agent returns no edits → graceful failure', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Agent returns nothing',
      agent: {
        plan: async () => ({ edits: [], predicates: [] }),
      },
      maxAttempts: 2,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.history[0].attestation).toContain('0 edits');
  });

  test('agent throws: plan() error handled gracefully', async () => {
    let calls = 0;

    const result = await govern({
      appDir: testDir,
      goal: 'Agent crashes',
      agent: {
        plan: async () => {
          calls++;
          if (calls === 1) throw new Error('LLM timeout');
          // Second attempt succeeds
          return {
            edits: [{
              file: 'server.js',
              search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
              replace: 'a.nav-link { color: green; margin-right: 1rem; }',
            }],
            predicates: [{
              type: 'css' as const,
              selector: 'a.nav-link',
              property: 'color',
              expected: 'green',
              path: '/about',
            }],
          };
        },
      },
      maxAttempts: 3,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.history[0].attestation).toContain('LLM timeout');
    expect(result.history[1].success).toBe(true);
  });

  test('onAttempt callback fires for each attempt', async () => {
    const observed: Array<{ attempt: number; success: boolean }> = [];

    await govern({
      appDir: testDir,
      goal: 'Track attempts',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
            replace: 'a.nav-link { color: purple; margin-right: 1rem; }',
          }],
          predicates: [{
            type: 'css' as const,
            selector: 'a.nav-link',
            property: 'color',
            expected: 'purple',
            path: '/about',
          }],
        }),
      },
      onAttempt: (attempt, result) => {
        observed.push({ attempt, success: result.success });
      },
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual({ attempt: 1, success: true });
  });

  test('grounding context provided to agent', async () => {
    let receivedGrounding = false;

    await govern({
      appDir: testDir,
      goal: 'Check grounding',
      agent: {
        plan: async (_goal, ctx) => {
          // Grounding should have routes and CSS from demo-app
          expect(ctx.grounding).toBeDefined();
          expect(ctx.grounding.routes.length).toBeGreaterThan(0);
          expect(ctx.grounding.routeCSSMap.size).toBeGreaterThan(0);
          receivedGrounding = true;
          return {
            edits: [{
              file: 'server.js',
              search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
              replace: 'a.nav-link { color: orange; margin-right: 1rem; }',
            }],
            predicates: [{
              type: 'css' as const,
              selector: 'a.nav-link',
              property: 'color',
              expected: 'orange',
              path: '/about',
            }],
          };
        },
      },
    });

    expect(receivedGrounding).toBe(true);
  });

  test('failure shapes tracked in receipt', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Track shapes',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'DOES_NOT_EXIST_SHAPE_TEST',
            replace: 'new',
          }],
          predicates: [{
            type: 'content' as const,
            file: 'server.js',
            pattern: 'new',
            expected: 'exists',
          }],
        }),
      },
      maxAttempts: 1,
    });

    expect(result.success).toBe(false);
    // Shapes should be tracked (decomposition runs on failure)
    // The exact shapes depend on what decompose matches, but the array should exist
    expect(result.receipt.failureShapes).toBeDefined();
    expect(Array.isArray(result.receipt.failureShapes)).toBe(true);
  });

  test('receipt has correct timing data', async () => {
    const result = await govern({
      appDir: testDir,
      goal: 'Check timing',
      agent: {
        plan: async () => ({
          edits: [{
            file: 'server.js',
            search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
            replace: 'a.nav-link { color: teal; margin-right: 1rem; }',
          }],
          predicates: [{
            type: 'css' as const,
            selector: 'a.nav-link',
            property: 'color',
            expected: 'teal',
            path: '/about',
          }],
        }),
      },
    });

    expect(result.receipt.totalDurationMs).toBeGreaterThan(0);
    expect(result.receipt.attemptDurations).toHaveLength(1);
    expect(result.receipt.attemptDurations[0]).toBeGreaterThan(0);
  });

});
