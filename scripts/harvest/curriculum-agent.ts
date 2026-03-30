#!/usr/bin/env bun
/**
 * Curriculum Agent — Automated Scenario Generation
 * ==================================================
 *
 * Reads FAILURE-TAXONOMY.md, finds uncovered/thin shapes, generates scenarios
 * via LLM, validates them deterministically, writes to *-curriculum-staged.json.
 *
 * Three phases:
 *   Phase 1: SURVEY  — parse taxonomy, find gaps (deterministic, 0 tokens)
 *   Phase 2: PLAN    — LLM generates scenarios per shape (batched by domain)
 *   Phase 2b: ADVERSARIAL — target thin shapes, read gate source, probe weaknesses
 *   Phase 3: VALIDATE — reject bad scenarios strictly (deterministic, 0 tokens)
 *
 * Usage:
 *   bun scripts/harvest/curriculum-agent.ts                     # all uncovered
 *   bun scripts/harvest/curriculum-agent.ts --domain css        # specific domain
 *   bun scripts/harvest/curriculum-agent.ts --adversarial       # target thin shapes
 *   bun scripts/harvest/curriculum-agent.ts --dry-run           # validate only
 *   bun scripts/harvest/curriculum-agent.ts --provider gemini   # LLM provider
 *   bun scripts/harvest/curriculum-agent.ts --survey-only       # just print gaps
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import { createHash } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface UncoveredShape {
  id: string;          // e.g. "C-22"
  domain: string;      // e.g. "css"
  description: string; // e.g. "`flex` → grow/shrink/basis"
  claimType: string;   // e.g. "transformation"
  notes: string;       // e.g. "`flex: 1 0 auto`"
}

interface GeneratedScenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  intent: 'false_positive' | 'false_negative';
  source?: string;
}

type LLMCallFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PKG_ROOT = resolve(import.meta.dir, '..', '..');
const DEMO_DIR = join(PKG_ROOT, 'fixtures', 'demo-app');
const SCENARIOS_DIR = join(PKG_ROOT, 'fixtures', 'scenarios');
const TAXONOMY_PATH = join(PKG_ROOT, 'FAILURE-TAXONOMY.md');
const OUTPUT_PATH = join(SCENARIOS_DIR, 'curriculum-staged.json');

const VALID_PRED_TYPES = new Set([
  'css', 'html', 'content', 'db', 'http', 'http_sequence',
  'filesystem_exists', 'filesystem_absent', 'filesystem_unchanged', 'filesystem_count',
  'infra_resource', 'infra_attribute', 'infra_manifest', 'serialization',
  'config', 'security', 'a11y', 'performance', 'message', 'hallucination',
]);

/** Map shape ID prefix → domain name for batching */
const PREFIX_TO_DOMAIN: Record<string, string> = {
  C: 'css', H: 'html', FS: 'filesystem', N: 'content', P: 'http',
  D: 'db', SEC: 'security', CFG: 'config', PERF: 'performance',
  A11Y: 'a11y', I: 'infrastructure', BR: 'browser', TO: 'temporal',
  INV: 'invariant', CO: 'composition', OE: 'observer', DR: 'drift',
  SC: 'scope', X: 'crosscutting', ID: 'identity', BUD: 'budget',
  SER: 'serialization', INJ: 'injection', TTL: 'ttl',
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: SURVEY — Parse taxonomy, find uncovered shapes
// ─────────────────────────────────────────────────────────────────────────────

function parseTaxonomy(): UncoveredShape[] {
  const content = readFileSync(TAXONOMY_PATH, 'utf-8');
  const shapes: UncoveredShape[] = [];

  // Match table rows like: | C-22 | `flex` → grow/shrink/basis | no coverage | ... |
  const rowRegex = /\|\s*([A-Z]+-\d+)\s*\|\s*(.+?)\s*\|\s*no coverage\s*\|\s*(.*?)\s*\|/g;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(content)) !== null) {
    const id = match[1].trim();
    const description = match[2].trim().replace(/`/g, '');
    const notes = match[3].trim().replace(/`/g, '');

    // Determine domain from prefix
    const prefixMatch = id.match(/^([A-Z]+)-/);
    const prefix = prefixMatch?.[1] ?? '';
    const domain = PREFIX_TO_DOMAIN[prefix] ?? 'unknown';

    // Infer claim type from context
    const claimType = inferClaimType(description, notes);

    shapes.push({ id, domain, description, claimType, notes });
  }

  return shapes;
}

function inferClaimType(desc: string, notes: string): string {
  const text = `${desc} ${notes}`.toLowerCase();
  if (text.includes('→') || text.includes('resolv') || text.includes('computed')) return 'transformation';
  if (text.includes('mismatch') || text.includes('differs') || text.includes('!=')) return 'equality';
  if (text.includes('missing') || text.includes('absent') || text.includes('not found')) return 'absence';
  if (text.includes('exists') || text.includes('present')) return 'existence';
  if (text.includes('contain') || text.includes('pattern') || text.includes('includes')) return 'containment';
  if (text.includes('order') || text.includes('sequence')) return 'ordering';
  if (text.includes('threshold') || text.includes('budget') || text.includes('ratio')) return 'threshold';
  if (text.includes('unchanged') || text.includes('invariant') || text.includes('preserv')) return 'invariance';
  return 'equality'; // safe default
}

/** Count existing scenarios per shape ID across all staged files */
function countExistingScenarios(): Map<string, number> {
  const counts = new Map<string, number>();
  const dirs = [SCENARIOS_DIR, join(SCENARIOS_DIR, 'real-world')];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('-staged.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        if (!Array.isArray(data)) continue;
        for (const s of data) {
          if (!s.tags || !Array.isArray(s.tags)) continue;
          for (const tag of s.tags) {
            if (/^[A-Z]+-\d+$/.test(tag)) {
              counts.set(tag, (counts.get(tag) || 0) + 1);
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  return counts;
}

/** Collect existing scenario hashes for dedup */
function collectExistingHashes(): Set<string> {
  const hashes = new Set<string>();
  const dirs = [SCENARIOS_DIR, join(SCENARIOS_DIR, 'real-world')];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('-staged.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        if (!Array.isArray(data)) continue;
        for (const s of data) {
          if (s.edits && s.predicates) {
            const hash = sha256(JSON.stringify({ edits: s.edits, predicates: s.predicates }));
            hashes.add(hash);
          }
        }
      } catch { /* skip */ }
    }
  }

  return hashes;
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: PLAN — Generate scenarios via LLM
// ─────────────────────────────────────────────────────────────────────────────

function loadDemoAppFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const names = ['server.js', 'init.sql', 'config.json', '.env', 'Dockerfile', 'docker-compose.yml'];
  for (const name of names) {
    const path = join(DEMO_DIR, name);
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      // Limit server.js to first 250 lines to stay under token budget
      files[name] = name === 'server.js' ? content.split('\n').slice(0, 250).join('\n') : content;
    }
  }
  return files;
}

function buildSystemPrompt(): string {
  return `You are generating test scenarios for a code verification system called "verify".

The verification system checks whether code edits + predicates (claims about the code) are consistent.
Each scenario has:
- edits: array of {file, search, replace} — search must be EXACT substring from the demo-app file
- predicates: array of predicate objects testing whether the edit achieves a goal
- expectedSuccess: boolean — should the verification pass (true) or fail (false)?
- intent: "false_positive" (gate should catch but might miss) or "false_negative" (gate should pass but might reject)

You must return ONLY a JSON array of scenario objects. No markdown, no explanation, no code fences.`;
}

function buildUserPrompt(
  shapes: UncoveredShape[],
  demoFiles: Record<string, string>,
  existingDescs: string[],
): string {
  const shapeList = shapes.map(s =>
    `  ${s.id}: ${s.description} (${s.claimType}) — ${s.notes}`
  ).join('\n');

  const fileSection = Object.entries(demoFiles).map(([name, content]) =>
    `--- ${name} ---\n${content}`
  ).join('\n\n');

  const dedupSection = existingDescs.length > 0
    ? `\nEXISTING SCENARIOS (avoid duplicating these):\n${existingDescs.slice(0, 30).map(d => `  - ${d}`).join('\n')}`
    : '';

  return `SHAPES TO COVER:
${shapeList}

DEMO APP FILES:
${fileSection}
${dedupSection}

CONSTRAINTS:
- edits.search MUST be an EXACT substring from the demo-app files shown above. Copy-paste, do not paraphrase.
- For edits with empty search (""), the replace creates a new file with that content.
- predicates must use types: css, html, content, db, http, http_sequence, filesystem_exists, filesystem_absent, filesystem_unchanged, filesystem_count, infra_resource, infra_attribute, infra_manifest, serialization, config, security, a11y, performance, message, hallucination
- Each scenario needs: id (string), description (string), edits (array), predicates (array), expectedSuccess (boolean), tags (array with shape ID like "${shapes[0]?.id}"), rationale (string), intent ("false_positive" or "false_negative")
- Generate 3-4 scenarios per shape. Mix expectedSuccess: true and false.
- For CSS predicates: use {type: "css", selector: "...", property: "...", expected: "value"}
- For HTML predicates: use {type: "html", selector: "...", expected: "exists"} or content check
- For content predicates: use {type: "content", file: "filename", pattern: "regex pattern"}
- For DB predicates: use {type: "db", table: "...", column: "...", assertion: "table_exists"|"column_exists"|"column_type"}
- For security predicates: use {type: "security", securityCheck: "xss"|"sql_injection"|"secrets_in_code", expected: "no_findings"|"has_findings"}
- For a11y predicates: use {type: "a11y", a11yCheck: "aria_label"|"alt_text"|"heading_hierarchy"|"color_contrast", expected: "no_findings"|"has_findings"}
- For config predicates: use {type: "config", key: "...", source: "env"|"json", expected: "value"}
- For filesystem predicates: use {type: "filesystem_exists", file: "filename"}
- For hallucination predicates: use {type: "hallucination", claim: "...", halAssert: "grounded"|"fabricated"}

Return ONLY a JSON array. No markdown fences, no explanation.`;
}

function buildAdversarialPrompt(
  shapes: UncoveredShape[],
  demoFiles: Record<string, string>,
  gateSource: string,
): string {
  const shapeList = shapes.map(s =>
    `  ${s.id}: ${s.description} (${s.claimType})`
  ).join('\n');

  const fileSection = Object.entries(demoFiles).map(([name, content]) =>
    `--- ${name} ---\n${content}`
  ).join('\n\n');

  return `You are an adversarial test generator. Your goal: find inputs that make the verification gate give the WRONG answer.

SHAPES TO PROBE:
${shapeList}

GATE SOURCE CODE (the code you're trying to fool):
${gateSource}

DEMO APP FILES:
${fileSection}

Your job: generate scenarios where the gate's answer disagrees with ground truth.
- If the edit introduces a real problem but the gate misses it → expectedSuccess: false, intent: "false_negative"
- If the edit is clean but the gate falsely flags it → expectedSuccess: true, intent: "false_positive"

Find edge cases: boundary values, encoding tricks, ambiguous syntax, parser quirks.
Generate 3 scenarios per shape. Each scenario that the gate gets wrong = valuable improvement signal.

Each scenario MUST have these fields:
- id: unique string (e.g. "adv-sec-001")
- description: what the scenario tests
- edits: array of {file, search, replace} — search MUST be exact substring from demo-app files
- predicates: array of predicate objects
- expectedSuccess: boolean
- tags: array including the shape ID (e.g. "SEC-02")
- rationale: why this should fool the gate
- intent: "false_positive" or "false_negative"

Return ONLY a JSON array. No markdown fences, no explanation.`;
}

async function generateForBatch(
  llm: LLMCallFn,
  shapes: UncoveredShape[],
  demoFiles: Record<string, string>,
  existingDescs: string[],
  adversarial: boolean,
): Promise<GeneratedScenario[]> {
  const systemPrompt = buildSystemPrompt();

  let userPrompt: string;
  if (adversarial) {
    // Load relevant gate source
    const gateSource = loadGateSource(shapes[0]?.domain ?? 'css');
    userPrompt = buildAdversarialPrompt(shapes, demoFiles, gateSource);
  } else {
    userPrompt = buildUserPrompt(shapes, demoFiles, existingDescs);
  }

  const result = await llm(systemPrompt, userPrompt);
  console.log(`    LLM: ${result.inputTokens} in / ${result.outputTokens} out`);

  // Parse JSON from response
  let text = result.text.trim();
  // Strip markdown fences if present
  text = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  try {
    const scenarios = JSON.parse(text);
    if (!Array.isArray(scenarios)) return [];
    return scenarios;
  } catch (e) {
    console.log(`    WARN: Failed to parse LLM response as JSON`);
    // Try to extract JSON array from response
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch { /* fall through */ }
    }
    return [];
  }
}

function loadGateSource(domain: string): string {
  const gateMap: Record<string, string> = {
    css: 'src/gates/grounding.ts',
    html: 'src/gates/grounding.ts',
    content: 'src/gates/grounding.ts',
    security: 'src/gates/security.ts',
    a11y: 'src/gates/a11y.ts',
    config: 'src/gates/config.ts',
    performance: 'src/gates/performance.ts',
    db: 'src/gates/db.ts',
    filesystem: 'src/gates/filesystem.ts',
    http: 'src/gates/http.ts',
    hallucination: 'src/gates/hallucination.ts',
  };

  const gatePath = gateMap[domain];
  if (!gatePath) return '// No gate source available for this domain';

  const fullPath = join(PKG_ROOT, gatePath);
  if (!existsSync(fullPath)) return '// Gate file not found';

  const content = readFileSync(fullPath, 'utf-8');
  // Limit to ~200 lines to stay under token budget
  return content.split('\n').slice(0, 200).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: VALIDATE — Reject bad scenarios strictly
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationResult {
  accepted: GeneratedScenario[];
  rejected: Array<{ scenario: GeneratedScenario; reason: string }>;
}

function validateScenarios(
  scenarios: GeneratedScenario[],
  existingHashes: Set<string>,
): ValidationResult {
  const accepted: GeneratedScenario[] = [];
  const rejected: Array<{ scenario: GeneratedScenario; reason: string }> = [];

  for (const s of scenarios) {
    const reason = validateOne(s, existingHashes);
    if (reason) {
      rejected.push({ scenario: s, reason });
    } else {
      // Add hash to prevent self-duplication within this batch
      const hash = sha256(JSON.stringify({ edits: s.edits, predicates: s.predicates }));
      existingHashes.add(hash);
      accepted.push(s);
    }
  }

  return { accepted, rejected };
}

function validateOne(s: GeneratedScenario, existingHashes: Set<string>): string | null {
  // 1. Required fields
  if (!s.id || typeof s.id !== 'string') return 'missing id';
  if (!s.description || typeof s.description !== 'string') return 'missing description';
  if (!s.rationale || typeof s.rationale !== 'string') return 'missing rationale';
  if (!Array.isArray(s.edits)) return 'edits not an array';
  if (!Array.isArray(s.predicates) || s.predicates.length === 0) return 'predicates empty or not array';
  if (typeof s.expectedSuccess !== 'boolean') return 'expectedSuccess not boolean';
  if (!Array.isArray(s.tags) || !s.tags.some(t => /^[A-Z]+-\d+$/.test(t))) {
    return 'tags missing shape ID (e.g. C-22)';
  }
  if (!s.intent || !['false_positive', 'false_negative'].includes(s.intent)) {
    return 'intent must be false_positive or false_negative';
  }

  // 2. Search string exists in demo-app file
  for (const edit of s.edits) {
    if (!edit.file || typeof edit.file !== 'string') return `edit missing file field`;
    if (typeof edit.search !== 'string') return `edit missing search field`;
    if (typeof edit.replace !== 'string') return `edit missing replace field`;

    // Empty search = create new file (allowed)
    if (edit.search === '') continue;

    const filePath = join(DEMO_DIR, edit.file);
    if (!existsSync(filePath)) return `file not found: ${edit.file}`;

    const content = readFileSync(filePath, 'utf-8');
    if (content.indexOf(edit.search) === -1) {
      return `search string not found in ${edit.file}: "${edit.search.substring(0, 60)}..."`;
    }
  }

  // 3. Predicate type valid
  for (const pred of s.predicates) {
    if (!pred.type || !VALID_PRED_TYPES.has(pred.type)) {
      return `invalid predicate type: ${pred.type}`;
    }
  }

  // 4. Dedup
  const hash = sha256(JSON.stringify({ edits: s.edits, predicates: s.predicates }));
  if (existingHashes.has(hash)) {
    return 'duplicate (same edits+predicates hash)';
  }

  return null; // valid
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Provider (lightweight, reuses Gemini pattern from llm-providers.ts)
// ─────────────────────────────────────────────────────────────────────────────

function createLLM(provider: string): LLMCallFn {
  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    return async (systemPrompt, userPrompt) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 65536, responseMimeType: 'application/json' },
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${body.substring(0, 200)}`);
      }

      const data = await resp.json() as any;
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('')
        || (parts[0]?.text ?? '');
      const usage = data.usageMetadata ?? {};
      return { text, inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 };
    };
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    return async (systemPrompt, userPrompt) => {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          temperature: 0.3,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Anthropic API error ${resp.status}: ${body.substring(0, 200)}`);
      }

      const data = await resp.json() as any;
      const text = data.content?.map((c: any) => c.text).join('') ?? '';
      return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
    };
  }

  throw new Error(`Unknown provider: ${provider}. Use: gemini, anthropic`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing scenario descriptions (for dedup hints)
// ─────────────────────────────────────────────────────────────────────────────

function collectExistingDescriptions(domain: string): string[] {
  const descriptions: string[] = [];
  const dirs = [SCENARIOS_DIR, join(SCENARIOS_DIR, 'real-world')];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('-staged.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        if (!Array.isArray(data)) continue;
        for (const s of data) {
          if (s.tags?.some((t: string) => t === domain) || s.description?.toLowerCase().includes(domain)) {
            descriptions.push(s.description);
          }
        }
      } catch { /* skip */ }
    }
  }

  return descriptions;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI + Main Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const domainFilter = args.find(a => a.startsWith('--domain='))?.split('=')[1];
const adversarial = args.includes('--adversarial');
const dryRun = args.includes('--dry-run');
const surveyOnly = args.includes('--survey-only');
const provider = args.find(a => a.startsWith('--provider='))?.split('=')[1] ?? 'gemini';
const maxPerDomain = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] ?? '20');

async function main() {
  console.log('\n=== Curriculum Agent ===');
  console.log(`Provider: ${provider}`);
  console.log(`Mode: ${adversarial ? 'adversarial' : 'coverage'}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Domain filter: ${domainFilter ?? 'all'}`);
  console.log('');

  // ── Phase 1: SURVEY ──────────────────────────────────────────────────────
  console.log('Phase 1: SURVEY — parsing taxonomy...');
  const allShapes = parseTaxonomy();
  const existingCounts = countExistingScenarios();

  // Filter by domain if specified
  let shapes = domainFilter
    ? allShapes.filter(s => s.domain === domainFilter)
    : allShapes;

  // For adversarial mode, target thin shapes (< 5 existing scenarios)
  if (adversarial) {
    shapes = allShapes.filter(s => (existingCounts.get(s.id) ?? 0) < 5);
    if (domainFilter) {
      shapes = shapes.filter(s => s.domain === domainFilter);
    }
  }

  // Group by domain
  const byDomain = new Map<string, UncoveredShape[]>();
  for (const s of shapes) {
    const list = byDomain.get(s.domain) ?? [];
    list.push(s);
    byDomain.set(s.domain, list);
  }

  console.log(`  Total uncovered shapes: ${allShapes.length}`);
  console.log(`  Selected shapes: ${shapes.length}`);
  for (const [domain, domainShapes] of byDomain) {
    console.log(`    ${domain}: ${domainShapes.length} shapes`);
  }
  console.log('');

  if (surveyOnly) {
    console.log('Shape details:');
    for (const s of shapes) {
      const existing = existingCounts.get(s.id) ?? 0;
      console.log(`  ${s.id} [${s.domain}] ${s.description} (${s.claimType}) — ${existing} existing`);
    }
    return;
  }

  if (shapes.length === 0) {
    console.log('No uncovered shapes found. Nothing to generate.');
    return;
  }

  // ── Phase 2: PLAN ────────────────────────────────────────────────────────
  console.log('Phase 2: PLAN — generating scenarios via LLM...');
  const llm = createLLM(provider);
  const demoFiles = loadDemoAppFiles();
  const allGenerated: GeneratedScenario[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const [domain, domainShapes] of byDomain) {
    // Batch shapes: max 5 per LLM call
    const batches: UncoveredShape[][] = [];
    for (let i = 0; i < domainShapes.length; i += 5) {
      batches.push(domainShapes.slice(i, i + 5));
    }

    const existingDescs = collectExistingDescriptions(domain);
    console.log(`  ${domain}: ${domainShapes.length} shapes in ${batches.length} batch(es)`);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      console.log(`    Batch ${bi + 1}/${batches.length}: ${batch.map(s => s.id).join(', ')}`);

      try {
        const generated = await generateForBatch(llm, batch, demoFiles, existingDescs, adversarial);
        console.log(`    Generated: ${generated.length} scenarios`);
        allGenerated.push(...generated);
      } catch (err: any) {
        console.log(`    ERROR: ${err.message}`);
      }

      // Rate limit between batches
      if (bi < batches.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log(`\n  Total generated: ${allGenerated.length} scenarios`);

  // ── Phase 3: VALIDATE ────────────────────────────────────────────────────
  console.log('\nPhase 3: VALIDATE — checking scenarios...');
  const existingHashes = collectExistingHashes();
  const { accepted, rejected } = validateScenarios(allGenerated, existingHashes);

  console.log(`  Accepted: ${accepted.length}`);
  console.log(`  Rejected: ${rejected.length}`);

  if (rejected.length > 0) {
    console.log('\n  Rejection reasons:');
    const reasonCounts = new Map<string, number>();
    for (const r of rejected) {
      const key = r.reason.substring(0, 50);
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${count}× ${reason}`);
    }
  }

  // ── Write output ─────────────────────────────────────────────────────────
  if (!dryRun && accepted.length > 0) {
    // Merge with existing curriculum scenarios if file exists
    let existing: GeneratedScenario[] = [];
    if (existsSync(OUTPUT_PATH)) {
      try {
        existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
        if (!Array.isArray(existing)) existing = [];
      } catch { existing = []; }
    }

    const merged = [...existing, ...accepted];
    writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
    console.log(`\n  Written: ${accepted.length} new scenarios to ${OUTPUT_PATH}`);
    console.log(`  Total in file: ${merged.length}`);
  } else if (dryRun) {
    console.log(`\n  Dry run — ${accepted.length} scenarios would be written`);
  } else {
    console.log('\n  No accepted scenarios to write.');
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Shapes surveyed: ${shapes.length}`);
  console.log(`  Scenarios generated: ${allGenerated.length}`);
  console.log(`  Scenarios accepted: ${accepted.length}`);
  console.log(`  Scenarios rejected: ${rejected.length}`);
  console.log(`  Acceptance rate: ${allGenerated.length > 0 ? ((accepted.length / allGenerated.length) * 100).toFixed(0) : 0}%`);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
