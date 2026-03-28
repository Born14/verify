/**
 * Claude Improve Brain — Native Intelligence for the Inner Loop
 * ==============================================================
 *
 * When Claude diagnoses a verify bug, it isn't pattern-matching
 * against a prompt. It's reasoning from the architecture it built.
 *
 * This module provides Claude-specific overrides for the improve
 * loop's diagnosis and fix generation phases. The key difference
 * from the generic LLM path:
 *
 * 1. System prompts carry verify's full architectural knowledge
 * 2. Source context is enriched with related functions, not just
 *    the target function in isolation
 * 3. Fix candidates consider downstream invariant effects
 *
 * The improve loop orchestrator (improve.ts) calls the same
 * LLMCallFn interface — this module just provides the richer
 * prompts and optional source enrichment.
 */

import type { EvidenceBundle, FixCandidate, LLMCallFn, LLMUsage } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { extractJSON, callLLMWithRetry } from './improve-utils.js';
import {
  CLAUDE_DIAGNOSIS_SYSTEM,
  CLAUDE_FIX_SYSTEM,
} from '../campaign/claude-brain.js';

// =============================================================================
// RELATED FILE GRAPH — files that are coupled to each target
// =============================================================================

/**
 * When Claude reads a target file to generate fixes, it also gets
 * the files that are architecturally coupled. A generic LLM gets
 * the target function in isolation. Claude gets the context.
 */
export const RELATED_FILES: Record<string, string[]> = {
  // ── Core orchestrator ──
  'src/verify.ts': [
    'src/types.ts',                     // All gate interfaces and types
    'src/store/constraint-store.ts',    // K5 constraint state
  ],
  'src/govern.ts': [
    'src/verify.ts',                    // Govern wraps verify pipeline
    'src/store/constraint-store.ts',    // Constraint seeding
    'src/store/decompose.ts',           // Feature decomposition
    'src/store/fault-ledger.ts',        // Fault tracking
  ],

  // ── Store layer ──
  'src/store/constraint-store.ts': [
    'src/gates/constraints.ts',         // K5 enforcement uses constraint store
    'src/types.ts',                     // Predicate/Constraint types
  ],
  'src/store/decompose.ts': [
    'src/store/constraint-store.ts',    // Decompose references constraints
    'src/types.ts',                     // Scenario/Predicate types
  ],
  'src/store/fault-ledger.ts': [
    'src/store/constraint-store.ts',    // Fault → constraint seeding
    'src/types.ts',                     // FaultEntry types
  ],
  'src/store/external-scenarios.ts': [
    'src/types.ts',                     // Scenario type
  ],

  // ── Governance gates ──
  'src/gates/constraints.ts': [
    'src/store/constraint-store.ts',    // K5 store that constraints.ts queries
    'src/types.ts',                     // Constraint types
  ],
  'src/gates/containment.ts': [
    'src/types.ts',                     // Mutation/Attribution types
  ],
  'src/gates/grounding.ts': [
    'src/gates/browser.ts',             // Browser gate uses grounding output
    'src/types.ts',                     // GroundingContext type
  ],
  'src/gates/browser.ts': [
    'src/gates/grounding.ts',           // Browser gate validates grounded selectors
    'src/types.ts',                     // BrowserGateResult types
  ],
  'src/gates/http.ts': [
    'src/types.ts',                     // Predicate types for HTTP
  ],
  'src/gates/syntax.ts': [
    'src/types.ts',                     // Edit type
  ],
  'src/gates/vision.ts': [
    'src/gates/triangulation.ts',       // Triangulation consumes vision verdict
    'src/types.ts',                     // GateResult, VisionConfig types
  ],
  'src/gates/triangulation.ts': [
    'src/gates/vision.ts',              // Vision gate feeds triangulation
    'src/gates/browser.ts',             // Browser gate feeds triangulation
    'src/types.ts',                     // GateResult type
  ],
  'src/gates/staging.ts': [
    'src/types.ts',                     // StagingResult types
    'src/runners/docker-runner.ts',     // Staging uses Docker runner
  ],
  'src/gates/invariants.ts': [
    'src/types.ts',                     // InvariantResult types
  ],

  // ── Domain gates (all share same pattern: types.ts only) ──
  'src/gates/a11y.ts':            ['src/types.ts'],
  'src/gates/access.ts':          ['src/types.ts'],
  'src/gates/capacity.ts':        ['src/types.ts'],
  'src/gates/config.ts':          ['src/types.ts'],
  'src/gates/contention.ts':      ['src/types.ts'],
  'src/gates/filesystem.ts':      ['src/types.ts'],
  'src/gates/infrastructure.ts':  ['src/types.ts'],
  'src/gates/message.ts':         ['src/types.ts'],
  'src/gates/observation.ts':     ['src/types.ts'],
  'src/gates/performance.ts':     ['src/types.ts'],
  'src/gates/propagation.ts':     ['src/types.ts'],
  'src/gates/security.ts':        ['src/types.ts'],
  'src/gates/serialization.ts':   ['src/types.ts'],
  'src/gates/state.ts':           ['src/types.ts'],
  'src/gates/temporal.ts':        ['src/types.ts'],

  // ── Runners / Parsers ──
  'src/runners/docker-runner.ts': ['src/types.ts'],
  'src/parsers/git-diff.ts':     ['src/types.ts'],

  // ── Types (the root — when fixing types, show the main consumer) ──
  'src/types.ts': [
    'src/verify.ts',                    // Main consumer of all types
  ],
};

/**
 * Read related files for context enrichment.
 * Returns a formatted string with file contents, truncated to keep prompt reasonable.
 */
function getRelatedContext(targetFile: string, packageRoot: string, maxBytesPerFile: number = 8000): string {
  const related = RELATED_FILES[targetFile];
  if (!related || related.length === 0) return '';

  const sections: string[] = [];
  for (const relPath of related) {
    const fullPath = join(packageRoot, relPath);
    if (!existsSync(fullPath)) continue;

    try {
      let content = readFileSync(fullPath, 'utf-8');
      if (content.length > maxBytesPerFile) {
        // Truncate but include the type definitions (usually at top)
        content = content.substring(0, maxBytesPerFile) + '\n// ... truncated ...';
      }
      sections.push(`\n--- Related: ${relPath} ---\n${content}`);
    } catch { /* skip */ }
  }

  return sections.join('\n');
}

// =============================================================================
// CLAUDE-ENHANCED DIAGNOSIS
// =============================================================================

/**
 * Diagnose a violation bundle using Claude with architectural context.
 *
 * The key difference from generic diagnosis:
 * - System prompt names specific invariant families and their contracts
 * - Claude knows the codebase structure, so it can pinpoint exact functions
 * - Response format is the same (2-3 sentence diagnosis)
 */
export async function diagnoseWithClaude(
  bundle: EvidenceBundle,
  packageRoot: string,
  callLLM: LLMCallFn,
  usage: LLMUsage,
): Promise<string | null> {
  const violations = bundle.violations
    .map(v => `  - [${v.family}] ${v.invariant}: ${v.violation}`)
    .join('\n');

  // Include the target file content if known
  let sourceContext = '';
  if (bundle.triage.targetFile) {
    const fullPath = join(packageRoot, bundle.triage.targetFile);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const truncated = content.length > 15000
          ? content.substring(0, 15000) + '\n// ... truncated ...'
          : content;
        sourceContext = `\nTARGET SOURCE (${bundle.triage.targetFile}):\n\`\`\`typescript\n${truncated}\n\`\`\``;
      } catch { /* skip */ }
    }
    // Add related files for architectural context
    sourceContext += getRelatedContext(bundle.triage.targetFile, packageRoot);
  }

  const userPrompt = `FAILURE EVIDENCE:
${violations}

Scenario IDs: ${bundle.violations.map(v => v.scenarioId).join(', ')}
Triage confidence: ${bundle.triage.confidence}
Target: ${bundle.triage.targetFunction ?? 'unknown'} in ${bundle.triage.targetFile ?? 'unknown'}
${sourceContext}

What is the root cause? Name the exact function, file, and explain WHY the invariant fails.`;

  const result = await callLLMWithRetry(callLLM, CLAUDE_DIAGNOSIS_SYSTEM, userPrompt, usage);
  if (!result) return null;
  return result.text;
}

// =============================================================================
// CLAUDE-ENHANCED FIX GENERATION
// =============================================================================

/**
 * Generate fix candidates using Claude with full architectural context.
 *
 * Key differences from generic fix generation:
 * - System prompt knows the bounded edit surface and frozen files
 * - Includes related files so Claude can reason about downstream effects
 * - Fix rationales reference specific invariants, not generic explanations
 */
export async function generateFixesWithClaude(
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

  // Focus on target function if file is large
  const sourceLines = sourceContent.split('\n');
  let truncated: string;
  if (sourceLines.length > 300 && bundle.triage.targetFunction) {
    const funcName = bundle.triage.targetFunction.replace(/\(\)$/, '');
    const funcIdx = sourceLines.findIndex(l =>
      l.includes(`function ${funcName}`) || l.includes(`${funcName}(`)
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

  // Get related files for architectural reasoning
  const relatedContext = getRelatedContext(targetFile, packageRoot);

  const violations = bundle.violations
    .map(v => `  - [${v.family}] ${v.invariant}: ${v.violation}`)
    .join('\n');

  const diagnosisBlock = diagnosis
    ? `\nDIAGNOSIS:\n${diagnosis}\n`
    : '';

  const systemPrompt = CLAUDE_FIX_SYSTEM
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
${relatedContext ? `\nRELATED CONTEXT (architecturally coupled files):${relatedContext}` : ''}

Generate ${maxCandidates} distinct fix strategies as JSON.
Remember: the holdout check will catch any regressions. Your fix must not break passing scenarios.`;

  const result = await callLLMWithRetry(callLLM, systemPrompt, userPrompt, usage);
  if (!result) return [];

  // Debug output
  console.log(`        [Claude] ${result.text.length} chars, ${result.outputTokens} tokens`);
  if (result.text.length < 500) {
    console.log(`        [Claude] ${result.text}`);
  } else {
    console.log(`        [Claude] ${result.text.substring(0, 300)}...`);
  }

  return parseFixCandidates(result.text, bundle.id);
}

// =============================================================================
// RESPONSE PARSING (shared with generic path)
// =============================================================================

function parseFixCandidates(text: string, bundleId: string): FixCandidate[] {
  const parsed = extractJSON<Array<{
    strategy?: string;
    rationale?: string;
    edits?: Array<{ file?: string; search?: string; replace?: string }>;
  }>>(text);

  if (!parsed || !Array.isArray(parsed)) {
    console.log(`        [PARSE] Failed to extract JSON from Claude response (${text.length} chars)`);
    return [];
  }

  return parsed
    .filter(p => p.edits && Array.isArray(p.edits) && p.edits.length > 0)
    .map((p, i) => ({
      id: `${bundleId}_claude_${i + 1}`,
      strategy: p.strategy ?? `claude_strategy_${i + 1}`,
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
