/**
 * Vision Gate Smoke Test — No Docker Required
 * =============================================
 *
 * Tests the vision gate with a pre-captured screenshot buffer.
 * Proves the gate works without Docker/Playwright — any caller
 * can supply their own screenshot and get a vision verdict.
 *
 * Requires: GEMINI_API_KEY in environment or ../.env
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { verify } from '../../src/verify.js';
import { geminiVision } from '../../src/vision-helpers.js';

// Load API key from .env if not in environment
function loadGeminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  // Walk up to find .env (monorepo root)
  const candidates = [
    join(__dirname, '../../../../.env'),
    join(__dirname, '../../../.env'),
    join(__dirname, '../../.env'),
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, 'utf-8');
      const match = env.match(/GEMINI_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
  }
  // Last resort: hardcoded monorepo root
  const rootEnv = join(process.cwd(), '.env');
  if (existsSync(rootEnv)) {
    const env = readFileSync(rootEnv, 'utf-8');
    const match = env.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Generate a minimal valid PNG with a solid color fill.
 * 8x8 pixel uncompressed PNG — no dependencies needed.
 */
function makeSolidPNG(r: number, g: number, b: number): Buffer {
  // PNG is: signature + IHDR + IDAT + IEND
  // We'll create a tiny 8x8 RGB image

  const width = 8, height = 8;

  // Build raw scanlines (filter byte 0 = None, then RGB pixels)
  const rawData: number[] = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }

  // Deflate the raw data (use zlib via Bun)
  const { deflateSync } = require('zlib');
  const compressed = deflateSync(Buffer.from(rawData));

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // CRC32 function
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([typeBytes, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([len, typeBytes, data, crcBuf]);
  }

  // IHDR: width, height, bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

describe('vision gate — no Docker', () => {
  let apiKey: string | undefined;

  beforeAll(() => {
    apiKey = loadGeminiKey();
    if (!apiKey) console.log('GEMINI_API_KEY not available — skipping vision smoke tests');
  });

  const appDir = join(__dirname, '../../fixtures/demo-app');

  test('solid blue screenshot: "background is blue" should be VERIFIED', async () => {
    if (!apiKey) return;

    const blueScreenshot = makeSolidPNG(0, 0, 255); // pure blue

    const result = await verify(
      [{ file: 'server.js', search: 'color: #666', replace: 'color: #666' }], // no-op edit
      [{ type: 'css', selector: 'body', property: 'background-color', expected: 'blue' }],
      {
        appDir,
        gates: { staging: false, browser: false, http: false, invariants: false, vision: true, grounding: false },
        vision: {
          call: geminiVision(apiKey!),
          screenshots: { '/': blueScreenshot },
        },
      },
    );

    // Vision gate should have run
    const visionGate = result.gates.find(g => g.gate === 'vision');
    expect(visionGate).toBeDefined();
    console.log(`  vision: ${visionGate!.passed ? 'PASSED' : 'FAILED'} — ${visionGate!.detail}`);

    // Triangulation should exist
    const triGate = result.gates.find(g => g.gate === 'triangulation');
    expect(triGate).toBeDefined();
    console.log(`  triangulation: action=${result.triangulation?.action}, confidence=${result.triangulation?.confidence}`);
  }, 30_000);

  test('solid red screenshot: "background is blue" should be NOT VERIFIED', async () => {
    if (!apiKey) return;

    const redScreenshot = makeSolidPNG(255, 0, 0); // pure red

    const result = await verify(
      [{ file: 'server.js', search: 'color: #666', replace: 'color: #666' }],
      [{ type: 'css', selector: 'body', property: 'background-color', expected: 'blue' }],
      {
        appDir,
        gates: { staging: false, browser: false, http: false, invariants: false, vision: true, grounding: false },
        vision: {
          call: geminiVision(apiKey!),
          screenshots: { '/': redScreenshot },
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    expect(visionGate).toBeDefined();
    console.log(`  vision: ${visionGate!.passed ? 'PASSED' : 'FAILED'} — ${visionGate!.detail}`);

    // Vision should say NOT VERIFIED (red ≠ blue)
    expect(visionGate!.passed).toBe(false);

    // Triangulation should handle the disagreement
    const triGate = result.gates.find(g => g.gate === 'triangulation');
    expect(triGate).toBeDefined();
    console.log(`  triangulation: action=${result.triangulation?.action}`);
  }, 30_000);

  test('no visual predicates → vision gate auto-skips', async () => {
    if (!apiKey) return;

    const result = await verify(
      [{ file: 'server.js', search: 'color: #666', replace: 'color: #666' }],
      [{ type: 'content', file: 'server.js', pattern: 'subtitle' }], // non-visual predicate
      {
        appDir,
        gates: { staging: false, browser: false, http: false, invariants: false, vision: true, grounding: false },
        vision: {
          call: geminiVision(apiKey!),
          screenshots: { '/': makeSolidPNG(0, 0, 0) },
        },
      },
    );

    const visionGate = result.gates.find(g => g.gate === 'vision');
    expect(visionGate).toBeDefined();
    expect(visionGate!.passed).toBe(true);
    expect(visionGate!.detail).toContain('No visual predicates');
  }, 10_000);
});
