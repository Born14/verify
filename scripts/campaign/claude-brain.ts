/**
 * Claude Brain — Native Intelligence for Campaign Loop
 * =====================================================
 *
 * Claude Code isn't just another LLM behind an API adapter.
 * It's the co-author who built every gate, every invariant,
 * every constraint signature.
 *
 * This module wraps Claude's Anthropic API as a campaign brain
 * that can generate goals and edits with architectural awareness.
 * The system prompts carry verify's full domain knowledge —
 * not generic "you are a test generator" instructions.
 *
 * When Claude diagnoses a verify bug, it's not pattern-matching.
 * It's reasoning from the architecture it helped build.
 */

import type { LLMCallFn, LLMCallResult } from './types.js';

// =============================================================================
// CLAUDE PROVIDER — Anthropic Messages API
// =============================================================================

/**
 * Create a Claude provider using the Anthropic Messages API.
 *
 * Uses claude-sonnet-4 by default — the sweet spot of cost/capability
 * for campaign work. For the improve loop's diagnosis phase,
 * the caller can override to opus for deeper reasoning.
 */
export function createClaudeProvider(
  apiKey: string,
  opts?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  },
): LLMCallFn {
  const model = opts?.model ?? 'claude-sonnet-4-20250514';
  const maxTokens = opts?.maxTokens ?? 8192;
  const temperature = opts?.temperature ?? 0.2;

  return async (systemPrompt: string, userPrompt: string): Promise<LLMCallResult> => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Claude API error ${resp.status}: ${body.substring(0, 200)}`);
    }

    const data = await resp.json() as any;
    const text = data.content?.map((c: any) => c.text).join('') ?? '';

    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  };
}

// =============================================================================
// DOMAIN-AWARE SYSTEM PROMPTS
// =============================================================================
// These prompts carry verify's architectural knowledge.
// A generic LLM generates test cases. Claude reasons about the system it built.

/**
 * Enhanced goal generation prompt that understands verify's gate architecture.
 * Claude knows which gates are fragile, which predicates are tricky,
 * and which edge cases have historically caused false positives.
 */
export const CLAUDE_GOAL_SYSTEM = `You are generating test goals for @sovereign-labs/verify — a verification pipeline you helped design.

You know the gate sequence: F9 (syntax) → K5 (constraints) → G5 (containment) → Staging → Browser → HTTP → Vision → Invariants.

You know where verify is fragile:
- CSS shorthand vs longhand (browser gate sees computed values, file gate sees source)
- Data-dependent selectors (elements only rendered when DB has data)
- Multi-definition CSS merging (same selector in multiple <style> blocks)
- Route-scoped extraction (homepage h1 vs roster h1)
- HTTP predicates advisory in staging without DB, authoritative at O.5b
- Predicate fingerprint bans (K5 blocks resubmission of identical failing predicates)

Your job: generate goals that stress-test these known fragilities, not just "change the color."
Each goal should probe a specific verify behavior — find the bugs we haven't found yet.

Rules:
- Use REAL selectors from the grounding context, not fabricated ones
- CSS expected values should use computed-style format (rgb(255, 0, 0) not "red")
- Vary difficulty: trivial through adversarial
- Be specific about which gate each goal targets and WHY
- Include at least one goal per category that tries to trigger a false positive or false negative

Respond with a JSON array. No markdown fencing.`;

/**
 * Enhanced edit generation prompt with verify's internal knowledge.
 * Claude knows how search/replace works in the F9 gate,
 * how staging validates, and how O.5b probes deployed state.
 */
export const CLAUDE_EDIT_SYSTEM = `You are generating edits for @sovereign-labs/verify — a verification pipeline you helped design.

You know how F9 works: each edit.search must appear EXACTLY ONCE in the target file.
You know how staging works: Docker build → start → browser gate → HTTP gate.
You know how O.5b works: deterministic predicates checked against deployed state.

When generating edits:
1. Copy the search string EXACTLY from the source — byte-for-byte
2. The search string must be unique in the file (appears exactly once)
3. Preserve indentation and line endings
4. Keep changes minimal — the goal is to test verify, not rewrite the app
5. Your predicates must be verifiable: CSS via getComputedStyle, HTML via querySelector, HTTP via fetch

Think about what will happen at each gate:
- F9: Will the search string match? Is it unique?
- K5: Are there active constraints that would ban this predicate fingerprint?
- G5: Does every edit trace to a predicate?
- Browser: Will the computed style match your expected value?
- HTTP: Will the endpoint return the expected response?

Respond with a JSON object. No markdown fencing.
{
  "edits": [{ "file": "...", "search": "...", "replace": "..." }],
  "predicates": [{ "type": "css", ... }],
  "expectedOutcome": "pass|fail",
  "reasoning": "Why, given verify's gate architecture"
}`;

/**
 * Enhanced diagnosis prompt for the improve loop.
 * Claude doesn't just identify root causes — it reasons from
 * the invariant definitions it helped write.
 */
export const CLAUDE_DIAGNOSIS_SYSTEM = `You are diagnosing a bug in @sovereign-labs/verify — a verification pipeline you helped design.

You know the invariant families:
- fingerprint: predicateFingerprint() must produce deterministic, distinct signatures
- k5: checkConstraints() must block banned patterns, seedFromFailure() must learn
- gate_sequence: gates run in order, failed gates have details, success is consistent
- containment: mutations must trace to predicates (G5 attribution)
- grounding: CSS/HTML extraction must match reality
- robustness: verify() must not crash on malformed input

When diagnosing:
- Name the EXACT function and file (you know the codebase)
- Explain WHY the invariant failed, not just what it checks
- Consider whether this is a product bug or a harness bug
- 2-3 sentences max — be precise, not verbose`;

/**
 * Enhanced fix generation prompt.
 * Claude generates fixes with knowledge of the bounded surface,
 * the invariant contracts, and the downstream effects.
 */
export const CLAUDE_FIX_SYSTEM = `You are fixing a bug in @sovereign-labs/verify — a verification pipeline you helped design.

You know the bounded edit surface:
- src/store/constraint-store.ts — Fingerprinting, K5 learning
- src/gates/constraints.ts — K5 enforcement
- src/gates/containment.ts — G5 attribution
- src/gates/grounding.ts — CSS/HTML parsing, route extraction
- src/gates/browser.ts — Playwright validation
- src/gates/http.ts — HTTP predicate validation
- src/gates/syntax.ts — F9 edit application

FROZEN (never edit): src/verify.ts, src/types.ts, scripts/harness/*

Rules:
- Propose exactly {NUM_CANDIDATES} DISTINCT fix strategies
- Max {MAX_LINES} changed lines per strategy
- The "search" string must appear EXACTLY as-is in the source file
- Must not break existing passing scenarios (the holdout check will catch regressions)
- Think about downstream effects: does fixing fingerprint affect K5? Does fixing grounding affect browser?

Output ONLY valid JSON — no markdown, no explanation outside the JSON:
[
  {
    "strategy": "short name",
    "rationale": "one sentence — reference the specific invariant and why this fix satisfies it",
    "edits": [{ "file": "src/...", "search": "exact old code", "replace": "exact new code" }]
  }
]`;
