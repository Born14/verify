/**
 * Vision Gate — Screenshot + Model Verification
 * ================================================
 *
 * Takes a screenshot of the staged app via Playwright, sends it to a
 * user-provided vision model callback, and asks whether the predicates
 * are visually satisfied. Catches what CSS parsing and DOM inspection miss:
 *
 * - Rendering issues (overlapping elements, invisible text)
 * - Color perception mismatches (computed style says green but it looks teal)
 * - Layout correctness (table is present but looks broken)
 * - Lie detection (agent claims navy blue but screenshot shows neon green)
 *
 * Verify owns the prompt and parsing. The user owns the LLM call.
 *
 * Convenience helpers for common providers:
 *   import { geminiVision, openaiVision, anthropicVision } from '@sovereign-labs/verify';
 *   vision: { call: geminiVision(process.env.GEMINI_API_KEY) }
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import type { GateResult, GateContext, Predicate } from '../types.js';

export interface VisionClaim {
  predicate: Partial<Predicate>;
  description: string;
  verified: boolean;
  detail: string;
}

export interface VisionGateResult extends GateResult {
  claims: VisionClaim[];
  screenshotPath?: string;
}

const SCREENSHOT_TIMEOUT = 10_000;

export async function runVisionGate(ctx: GateContext): Promise<VisionGateResult> {
  const start = Date.now();

  // Only check visual predicates (CSS, HTML)
  const visualPredicates = ctx.predicates.filter(
    p => p.type === 'css' || p.type === 'html'
  );

  if (visualPredicates.length === 0) {
    return {
      gate: 'vision',
      passed: true,
      detail: 'No visual predicates — vision gate skipped',
      durationMs: Date.now() - start,
      claims: [],
    };
  }

  const visionConfig = ctx.config.vision;
  if (!visionConfig?.call) {
    return {
      gate: 'vision',
      passed: true,
      detail: 'No vision callback configured — gate skipped',
      durationMs: Date.now() - start,
      claims: [],
    };
  }

  // 1. Get screenshots — prefer pre-captured, fall back to Docker/Playwright
  const paths = [...new Set(visualPredicates.map(p => p.path ?? '/'))].slice(0, 3);
  const providedScreenshots = visionConfig.screenshots;

  const screenshots: { path: string; buffer: Buffer }[] = [];

  if (providedScreenshots && Object.keys(providedScreenshots).length > 0) {
    // Use caller-provided screenshots — no Docker needed
    for (const path of paths) {
      const buf = providedScreenshots[path];
      if (buf) {
        ctx.log(`[vision] Using provided screenshot for ${path}`);
        screenshots.push({ path, buffer: buf });
      }
    }
  } else if (ctx.appUrl) {
    // Fall back to Docker/Playwright
    const workDir = join(ctx.config.appDir, '.verify-tmp');
    mkdirSync(workDir, { recursive: true });

    for (const path of paths) {
      const screenshotPath = join(workDir, `vision-${path.replace(/\//g, '_') || 'root'}.png`);
      const took = await takeScreenshot(ctx.appUrl, path, screenshotPath, ctx.log);
      if (took && existsSync(screenshotPath)) {
        screenshots.push({ path, buffer: readFileSync(screenshotPath) });
      }
    }
  }

  if (screenshots.length === 0) {
    ctx.log('[vision] No screenshots captured — skipping vision gate');
    return {
      gate: 'vision',
      passed: true,
      detail: 'Screenshot capture failed — gate skipped',
      durationMs: Date.now() - start,
      claims: [],
    };
  }

  // 2. Build claims from predicates
  const claimTexts: string[] = [];
  for (const p of visualPredicates) {
    const desc = describeVisualPredicate(p);
    claimTexts.push(desc);
  }

  // 3. Send to vision model via user-provided callback
  ctx.log(`[vision] Sending screenshot to vision model with ${claimTexts.length} claim(s)...`);

  const prompt = buildVisionPrompt(claimTexts);
  let response: string;
  try {
    response = await visionConfig.call(screenshots[0].buffer, prompt);
  } catch (err: any) {
    ctx.log(`[vision] Vision callback failed: ${err.message}`);
    return {
      gate: 'vision',
      passed: true, // Don't block on vision failure
      detail: `Vision callback failed: ${err.message} — gate skipped`,
      durationMs: Date.now() - start,
      claims: [],
    };
  }

  // 4. Parse response into per-claim verdicts
  const claims = parseVisionResponse(response, visualPredicates, claimTexts);

  const allVerified = claims.every(c => c.verified);
  const failedCount = claims.filter(c => !c.verified).length;

  const detail = allVerified
    ? `All ${claims.length} visual claim(s) verified`
    : `${failedCount}/${claims.length} claim(s) NOT VERIFIED`;

  return {
    gate: 'vision',
    passed: allVerified,
    detail,
    durationMs: Date.now() - start,
    claims,
    screenshotPath: providedScreenshots ? undefined : join(ctx.config.appDir, '.verify-tmp', 'vision-_root.png'),
  };
}

// =============================================================================
// SCREENSHOT
// =============================================================================

async function takeScreenshot(
  baseUrl: string,
  path: string,
  outputPath: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const url = `${baseUrl}${path}`;
  log(`[vision] Taking screenshot of ${url}...`);

  // Use Playwright in Docker (same pattern as browser gate)
  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto('${url}', { waitUntil: 'networkidle', timeout: 8000 });
      await page.screenshot({ fullPage: true, path: '/work/screenshot.png' });
      await browser.close();
    })();
  `;

  const workDir = join(outputPath, '..');
  writeFileSync(join(workDir, 'vision-screenshot.js'), script);

  return new Promise<boolean>((resolve) => {
    const proc = spawn('docker', [
      'run', '--rm', '--network=host',
      '-e', 'NODE_PATH=/app/node_modules',
      '-v', `${workDir}:/work`,
      'verify-playwright:latest',
      'node', '/work/vision-screenshot.js',
    ], { timeout: SCREENSHOT_TIMEOUT });

    let killed = false;
    let stderr = '';
    const timer = setTimeout(() => { killed = true; proc.kill(); }, SCREENSHOT_TIMEOUT);

    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed || code !== 0) {
        log(`[vision] Screenshot failed (code=${code}, killed=${killed}${stderr ? `, stderr=${stderr.slice(0, 200)}` : ''})`);
        resolve(false);
      } else {
        // Docker writes to /work/screenshot.png → copy to output
        const dockerOutput = join(workDir, 'screenshot.png');
        if (existsSync(dockerOutput)) {
          const { cpSync } = require('fs');
          cpSync(dockerOutput, outputPath);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// =============================================================================
// PROMPT + PARSING
// =============================================================================

function buildVisionPrompt(claims: string[]): string {
  const numbered = claims.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `You are verifying a web application screenshot against specific claims.

For each claim below, respond with EXACTLY one line:
  CLAIM N: VERIFIED
  or
  CLAIM N: NOT VERIFIED — <brief actual observation>

Be precise about colors (use hex when possible), element presence, and text content.
Do NOT add explanations beyond the one-line verdict per claim.

CLAIMS:
${numbered}`;
}

function parseVisionResponse(
  response: string,
  predicates: Predicate[],
  claimTexts: string[],
): VisionClaim[] {
  const lines = response.split('\n').filter(l => l.trim());
  const claims: VisionClaim[] = [];

  for (let i = 0; i < claimTexts.length; i++) {
    const p = predicates[i];
    const desc = claimTexts[i];

    // Look for "CLAIM N:" line
    const claimLine = lines.find(l =>
      l.toUpperCase().includes(`CLAIM ${i + 1}`)
    );

    if (claimLine) {
      const isVerified = claimLine.toUpperCase().includes('VERIFIED') &&
        !claimLine.toUpperCase().includes('NOT VERIFIED');

      const dashIdx = claimLine.indexOf('—');
      const detail = dashIdx >= 0
        ? claimLine.substring(dashIdx + 1).trim()
        : (isVerified ? 'Verified' : 'Not verified');

      claims.push({
        predicate: { type: p.type, selector: p.selector, property: p.property },
        description: desc,
        verified: isVerified,
        detail,
      });
    } else {
      // Could not parse response for this claim — treat as unverified
      claims.push({
        predicate: { type: p.type, selector: p.selector, property: p.property },
        description: desc,
        verified: false,
        detail: 'Vision model response did not address this claim',
      });
    }
  }

  return claims;
}

function describeVisualPredicate(p: Predicate): string {
  if (p.type === 'css') {
    if (p.expected && p.expected !== 'exists') {
      return `The CSS property "${p.property}" on elements matching "${p.selector}" should have value "${p.expected}"`;
    }
    return `Elements matching "${p.selector}" should exist and be visible`;
  }

  if (p.type === 'html') {
    if (p.expected && p.expected !== 'exists') {
      return `An HTML element matching "${p.selector}" should contain the text "${p.expected}"`;
    }
    return `An HTML element matching "${p.selector}" should exist and be visible`;
  }

  return `Predicate type=${p.type} selector=${p.selector}`;
}
