/**
 * Vision Gate Integration Tests
 * ==============================
 *
 * Proves the vision gate works end-to-end:
 * 1. Demo app runs in Docker
 * 2. Playwright takes a screenshot
 * 3. Gemini vision model evaluates claims
 * 4. Verdicts are correct
 *
 * Requires: Docker + GEMINI_API_KEY environment variable.
 * Run: bun test tests/integration/vision-gate.test.ts --timeout 120000
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { verify } from '../../src/verify.js';
import { isDockerAvailable } from '../../src/runners/docker-runner.js';
import { cpSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeTempApp(): string {
  const dir = join(tmpdir(), `verify-vision-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fixtureDir = join(__dirname, '../../fixtures/demo-app');
  cpSync(fixtureDir, dir, { recursive: true });
  return dir;
}

describe('vision gate', () => {
  let hasDocker = false;
  let hasGemini = false;

  beforeAll(async () => {
    hasDocker = await isDockerAvailable();
    hasGemini = !!process.env.GEMINI_API_KEY;

    if (!hasDocker) console.log('Docker not available — skipping vision tests');
    if (!hasGemini) console.log('GEMINI_API_KEY not set — skipping vision tests');
  });

  function canRun(): boolean {
    return hasDocker && hasGemini;
  }

  // =========================================================================
  // 1. Vision confirms a correct change
  // =========================================================================

  test('vision verifies correct CSS change (color)', async () => {
    if (!canRun()) return;

    const appDir = makeTempApp();

    // Change h1 color from #1a1a2e to red
    const result = await verify(
      [{ file: 'server.js', search: 'color: #1a1a2e', replace: 'color: red' }],
      [{ type: 'css', selector: 'h1', property: 'color', expected: 'red' }],
      {
        appDir,
        goal: 'Change heading color to red',
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false },
        vision: {
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
          apiKey: process.env.GEMINI_API_KEY!,
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    console.log('[vision test 1] gate:', JSON.stringify(visionGate, null, 2));

    // Vision should have run
    expect(visionGate).toBeTruthy();

    // If vision ran (not skipped), it should verify the red heading
    if (visionGate && !visionGate.detail.includes('skipped')) {
      expect(visionGate.passed).toBe(true);
      expect(visionGate.detail).toContain('verified');
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);

  // =========================================================================
  // 2. Vision catches a wrong claim
  // =========================================================================

  test('vision rejects incorrect claim (color mismatch)', async () => {
    if (!canRun()) return;

    const appDir = makeTempApp();

    // Don't change anything — but claim h1 is green (it's actually #1a1a2e)
    const result = await verify(
      [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Demo App</title>' }], // no-op edit
      [{ type: 'css', selector: 'h1', property: 'color', expected: 'green' }],
      {
        appDir,
        goal: 'Verify heading is green',
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false, grounding: false },
        vision: {
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
          apiKey: process.env.GEMINI_API_KEY!,
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    console.log('[vision test 2] gate:', JSON.stringify(visionGate, null, 2));

    // Vision should reject — the heading is NOT green
    expect(visionGate).toBeTruthy();
    if (visionGate && !visionGate.detail.includes('skipped')) {
      expect(visionGate.passed).toBe(false);
      expect(visionGate.detail).toContain('NOT VERIFIED');
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);

  // =========================================================================
  // 3. Vision confirms element existence
  // =========================================================================

  test('vision verifies heading exists (h1)', async () => {
    if (!canRun()) return;

    const appDir = makeTempApp();

    // Vision can verify visible elements — h1 "Demo App" is visible in screenshot
    const result = await verify(
      [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>Demo App</title>' }],
      [{ type: 'html', selector: 'h1', expected: 'exists' }],
      {
        appDir,
        goal: 'Check heading exists',
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false },
        vision: {
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
          apiKey: process.env.GEMINI_API_KEY!,
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    console.log('[vision test 3] gate:', JSON.stringify(visionGate, null, 2));

    if (visionGate && !visionGate.detail.includes('skipped')) {
      expect(visionGate.passed).toBe(true);
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);

  // =========================================================================
  // 4. Vision with multiple claims
  // =========================================================================

  test('vision evaluates multiple claims in one screenshot', async () => {
    if (!canRun()) return;

    const appDir = makeTempApp();

    const result = await verify(
      [{ file: 'server.js', search: 'color: #0066cc', replace: 'color: orange' }],
      [
        { type: 'css', selector: '.nav-link', property: 'color', expected: 'orange' },
        { type: 'html', selector: 'h1', expected: 'exists' },
        { type: 'css', selector: 'body', property: 'background', expected: '#ffffff' },
      ],
      {
        appDir,
        goal: 'Change nav links to orange',
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false, grounding: false },
        vision: {
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
          apiKey: process.env.GEMINI_API_KEY!,
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    console.log('[vision test 4] gate:', JSON.stringify(visionGate, null, 2));

    expect(visionGate).toBeTruthy();
    if (visionGate && !visionGate.detail.includes('skipped')) {
      // Should have 3 claims evaluated
      expect(visionGate.detail).toContain('3');
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);

  // =========================================================================
  // 5. Vision skips gracefully without API key
  // =========================================================================

  test('vision skips without API key (no crash)', async () => {
    if (!hasDocker) return;

    const appDir = makeTempApp();

    const result = await verify(
      [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>No Vision</title>' }],
      [{ type: 'css', selector: 'h1', property: 'color', expected: 'red' }],
      {
        appDir,
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false },
        // No vision config — should skip, not crash
      },
    );

    // Vision gate should not appear (no API key → gate skipped entirely)
    // Or if it appears, it should pass with 'skipped' detail
    const visionGate = result.gates.find(g => g.gate === 'vision');
    if (visionGate) {
      expect(visionGate.passed).toBe(true);
      expect(visionGate.detail).toContain('skipped');
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);

  // =========================================================================
  // 6. Vision skips for non-visual predicates
  // =========================================================================

  test('vision skips when only HTTP predicates (no visual claims)', async () => {
    if (!canRun()) return;

    const appDir = makeTempApp();

    const result = await verify(
      [{ file: 'server.js', search: '<title>Demo App</title>', replace: '<title>HTTP Only</title>' }],
      [{ type: 'http', path: '/health', method: 'GET', expect: { status: 200 } }],
      {
        appDir,
        docker: { compose: true },
        gates: { vision: true, browser: false, invariants: false },
        vision: {
          provider: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
          apiKey: process.env.GEMINI_API_KEY!,
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    if (visionGate) {
      expect(visionGate.passed).toBe(true);
      expect(visionGate.detail).toContain('No visual predicates');
    }

    rmSync(appDir, { recursive: true, force: true });
  }, 120_000);
});
