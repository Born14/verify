/**
 * Improvement Prompts — Diagnosis + Multi-Candidate Fix Generation
 * ================================================================
 *
 * LLM prompts for the evidence-centric autoresearch loop.
 * Two phases: diagnosis (optional, skipped for mechanical triage)
 * and multi-candidate fix generation.
 */

import type { EvidenceBundle, FixCandidate, LLMCallFn, LLMUsage } from './types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractJSON, callLLMWithRetry } from './improve-utils.js';

// =============================================================================
// DIAGNOSIS (only for needs_llm bundles)
// =============================================================================

const DIAGNOSIS_SYSTEM = `You are a debugging expert analyzing @sovereign-labs/verify, a TypeScript verification library (runs on Bun).

PACKAGE STRUCTURE:
  src/verify.ts          — Main pipeline orchestrator (runs gates in sequence)
  src/govern.ts          — Higher-level governance wrapper around verify
  src/types.ts           — All TypeScript interfaces (GateResult, Predicate, Edit, etc.)
  src/store/             — State management (constraint-store.ts, fault-ledger.ts, decompose.ts)
  src/gates/             — Individual gate implementations:
    grounding.ts         — CSS/HTML parsing, route extraction, selector validation
    browser.ts           — Playwright CSS/HTML validation against running containers
    http.ts              — HTTP predicate validation (status, body, sequences)
    syntax.ts            — F9 edit application (search/replace validation)
    constraints.ts       — K5 constraint enforcement
    containment.ts       — G5 mutation-to-predicate attribution
    vision.ts            — Vision model screenshot verification
    triangulation.ts     — Cross-authority verdict synthesis
    filesystem.ts        — File existence/content verification
    security.ts          — Secret/eval/XSS scanning
    a11y.ts              — Accessibility checks
    performance.ts       — Bundle size, connection checks
    staging.ts           — Docker build/start orchestration
    invariants.ts        — System health definitions
    + 11 more domain gates (config, serialization, propagation, etc.)
  src/runners/           — Docker runner, local runner

Rules:
- Name the EXACT function and file from the structure above
- Be concise: 2-3 sentences max
- Focus on WHY the invariant failed, not what the invariant checks
- Gate functions follow the pattern: run{GateName}Gate() (e.g., runGroundingGate(), runBrowserGate())
- Store functions: predicateFingerprint(), checkConstraints(), seedFromFailure(), etc.`;

export async function diagnoseBundleWithLLM(
  bundle: EvidenceBundle,
  packageRoot: string,
  callLLM: LLMCallFn,
  usage: LLMUsage,
): Promise<string | null> {
  const violations = bundle.violations
    .map(v => `  - [${v.family}] ${v.invariant}: ${v.violation}`)
    .join('\n');

  const userPrompt = `FAILURE EVIDENCE:
${violations}

Scenario IDs: ${bundle.violations.map(v => v.scenarioId).join(', ')}

What function and file is the most likely root cause? Why?`;

  const result = await callLLMWithRetry(callLLM, DIAGNOSIS_SYSTEM, userPrompt, usage);
  if (!result) return null;
  return result.text;
}

// =============================================================================
// MULTI-CANDIDATE FIX GENERATION
// =============================================================================

const FIX_SYSTEM = `You are fixing a bug in @sovereign-labs/verify, a TypeScript verification library.
You will receive failure evidence and the target source code.

RULES:
- Propose exactly {NUM_CANDIDATES} DISTINCT fix strategies
- Each strategy: JSON array of {file, search, replace} edits
- Max {MAX_LINES} changed lines per strategy
- The "search" string must appear EXACTLY as-is in the source file (copy verbatim)
- The "file" field must match the TARGET file path shown in the evidence
- Must not break existing passing scenarios
- Output ONLY valid JSON — no markdown, no explanation outside the JSON

OUTPUT FORMAT (JSON):
[
  {
    "strategy": "short name for the approach",
    "rationale": "one sentence why this works",
    "edits": [
      { "file": "TARGET_FILE_PATH_HERE", "search": "exact old code from source", "replace": "exact new code" }
    ]
  }
]`;

export async function generateFixCandidates(
  bundle: EvidenceBundle,
  diagnosis: string | null,
  packageRoot: string,
  callLLM: LLMCallFn,
  usage: LLMUsage,
  maxCandidates: number,
  maxLines: number,
): Promise<FixCandidate[]> {
  const targetFile = bundle.triage.targetFile;
  if (!targetFile) return [];

  // Read the target file
  let sourceContent: string;
  try {
    sourceContent = readFileSync(join(packageRoot, targetFile), 'utf-8');
  } catch {
    return [];
  }

  // Focus on the target function if file is large
  const sourceLines = sourceContent.split('\n');
  let truncated: string;
  if (sourceLines.length > 300 && bundle.triage.targetFunction) {
    // Find the target function and include surrounding context
    // Handles: function foo(), export function foo(), const foo =, export const foo =, foo(, class method foo()
    const funcName = bundle.triage.targetFunction.replace(/\(\)$/, '');
    const funcIdx = sourceLines.findIndex(l =>
      l.includes(`function ${funcName}`) ||
      l.includes(`const ${funcName}`) ||
      l.includes(`${funcName}(`) ||
      l.includes(`${funcName} =`) ||
      new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?${funcName}\\s*[(<]`).test(l)
    );
    if (funcIdx >= 0) {
      const start = Math.max(0, funcIdx - 20);
      const end = Math.min(sourceLines.length, funcIdx + 150);
      truncated = `// ... lines 1-${start} omitted ...\n`
        + sourceLines.slice(start, end).map((l, i) => `/* ${start + i + 1} */ ${l}`).join('\n')
        + `\n// ... lines ${end + 1}-${sourceLines.length} omitted ...`;
    } else {
      truncated = sourceLines.slice(0, 300).join('\n') + '\n// ... truncated ...';
    }
  } else {
    truncated = sourceLines.length > 300
      ? sourceLines.slice(0, 300).join('\n') + '\n// ... truncated ...'
      : sourceContent;
  }

  const violations = bundle.violations
    .map(v => `  - [${v.family}] ${v.invariant}: ${v.violation}`)
    .join('\n');

  const diagnosisBlock = diagnosis
    ? `\nDIAGNOSIS:\n${diagnosis}\n`
    : '';

  const systemPrompt = FIX_SYSTEM
    .replace('{NUM_CANDIDATES}', String(maxCandidates))
    .replace('{MAX_LINES}', String(maxLines));

  const userPrompt = `FAILURE EVIDENCE:
${violations}

TARGET: ${bundle.triage.targetFunction ?? 'unknown'} in ${targetFile}
${diagnosisBlock}
SOURCE CODE (${targetFile}):
\`\`\`typescript
${truncated}
\`\`\`

Generate ${maxCandidates} distinct fix strategies as JSON.`;

  const result = await callLLMWithRetry(callLLM, systemPrompt, userPrompt, usage);
  if (!result) return [];

  // Debug: show raw LLM response
  console.log(`        [LLM RAW] ${result.text.length} chars, ${result.outputTokens} tokens`);
  if (result.text.length < 500) {
    console.log(`        [LLM RAW] ${result.text}`);
  } else {
    console.log(`        [LLM RAW] ${result.text.substring(0, 300)}...`);
  }

  // Parse JSON from response
  return parseFixCandidates(result.text, bundle.id);
}

function parseFixCandidates(text: string, bundleId: string): FixCandidate[] {
  const parsed = extractJSON<Array<{
    strategy?: string;
    rationale?: string;
    edits?: Array<{ file?: string; search?: string; replace?: string }>;
  }>>(text);

  if (!parsed || !Array.isArray(parsed)) {
    console.log(`        [PARSE] Failed to extract JSON from LLM response (${text.length} chars)`);
    return [];
  }

  return parsed
    .filter(p => p.edits && Array.isArray(p.edits) && p.edits.length > 0)
    .map((p, i) => ({
      id: `${bundleId}_fix_${i + 1}`,
      strategy: p.strategy ?? `strategy_${i + 1}`,
      rationale: p.rationale ?? '',
      edits: (p.edits ?? [])
        .filter(e => e.file && e.search && e.replace)
        .map(e => ({
          file: e.file!,
          search: e.search!,
          replace: e.replace!,
        })),
    }))
    .filter(c => c.edits.length > 0);
}
