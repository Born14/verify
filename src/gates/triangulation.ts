/**
 * Triangulation Gate — Cross-Authority Verdict Synthesis
 * =======================================================
 *
 * Three independent truth authorities, one verdict.
 *
 * 1. Deterministic — grounding, syntax, filesystem, HTTP, invariants (all non-perceptual gates)
 * 2. Browser — Playwright getComputedStyle(), DOM inspection (browser gate)
 * 3. Vision — LLM sees the rendered screenshot (vision gate)
 *
 * Triangulation runs AFTER all three authorities. It does not block the pipeline —
 * it synthesizes their verdicts into a confidence-weighted action recommendation.
 *
 * The key invariant: vision never blocks alone. One authority present means
 * "insufficient", not "rollback". Vision is always the tiebreaker, never the judge.
 *
 * Pure function. Zero dependencies. Zero I/O.
 * Ported from packages/improve/triangulation.ts (28 tests, 177 assertions).
 */

import type { GateResult } from '../types.js';

// =============================================================================
// TYPES
// =============================================================================

/** Per-authority verdict */
export type AuthorityVerdict = 'pass' | 'fail' | 'absent';

/** Which authority disagrees when two agree and one doesn't */
export type OutlierAuthority = 'deterministic' | 'browser' | 'vision' | 'none';

/** Confidence from triangulation: how many authorities agree */
export type TriangulationConfidence = 'unanimous' | 'majority' | 'split' | 'insufficient';

/** Recommended action based on cross-authority agreement */
export type TriangulationAction =
  | 'accept'       // All agree PASS — proceed
  | 'rollback'     // All agree FAIL — revert
  | 'escalate'     // Disagreement — surface to caller
  | 'proceed';     // Insufficient data, no red flags

export interface AuthorityVerdicts {
  deterministic: AuthorityVerdict;
  browser: AuthorityVerdict;
  vision: AuthorityVerdict;
}

export interface TriangulationResult {
  /** Per-authority verdicts */
  authorities: AuthorityVerdicts;
  /** How many authorities ran (0-3) */
  authorityCount: number;
  /** Overall confidence from cross-authority agreement */
  confidence: TriangulationConfidence;
  /** Which authority disagrees when two agree */
  outlier: OutlierAuthority;
  /** Recommended action */
  action: TriangulationAction;
  /** Human-readable explanation */
  reasoning: string;
}

export interface TriangulationGateResult extends GateResult {
  triangulation: TriangulationResult;
}

// =============================================================================
// TRIANGULATION
// =============================================================================

/**
 * Triangulate three independent truth authorities into a single verdict.
 *
 * Truth table (D=deterministic, B=browser, V=vision):
 *
 *   D    B    V    → Confidence   Action     Outlier
 *   PASS PASS PASS → unanimous    accept     none
 *   FAIL FAIL FAIL → unanimous    rollback   none
 *   PASS PASS FAIL → majority     escalate   vision
 *   PASS FAIL PASS → majority     escalate   browser
 *   FAIL PASS PASS → majority     escalate   deterministic
 *   PASS FAIL FAIL → majority     rollback   deterministic
 *   FAIL PASS FAIL → majority     rollback   browser
 *   FAIL FAIL PASS → majority     escalate   vision
 *
 * When an authority is absent, remaining authorities decide:
 *   2 present + agree → majority with absent noted
 *   2 present + disagree → split → escalate
 *   1 present → insufficient → proceed (pass) or rollback (fail)
 *   0 present → insufficient → proceed
 */
export function triangulate(
  deterministic: boolean | null,
  browser: boolean | null,
  vision: boolean | null,
): TriangulationResult {
  const d: AuthorityVerdict = deterministic === null ? 'absent' : deterministic ? 'pass' : 'fail';
  const b: AuthorityVerdict = browser === null ? 'absent' : browser ? 'pass' : 'fail';
  const v: AuthorityVerdict = vision === null ? 'absent' : vision ? 'pass' : 'fail';

  const authorities: AuthorityVerdicts = { deterministic: d, browser: b, vision: v };
  const present = [d, b, v].filter(x => x !== 'absent');
  const authorityCount = present.length;

  // 0 or 1 authority — insufficient
  if (authorityCount <= 1) {
    const single = present[0];
    if (!single || single === 'pass') {
      return {
        authorities, authorityCount,
        confidence: 'insufficient',
        outlier: 'none',
        action: 'proceed',
        reasoning: authorityCount === 0
          ? 'No verification authorities ran'
          : `Only ${namePresent(authorities)} ran (PASS) — insufficient for triangulation`,
      };
    }
    return {
      authorities, authorityCount,
      confidence: 'insufficient',
      outlier: 'none',
      action: 'rollback',
      reasoning: `Only ${namePresent(authorities)} ran and it FAILED`,
    };
  }

  const passes = present.filter(x => x === 'pass').length;
  const fails = present.filter(x => x === 'fail').length;

  // All present agree PASS
  if (passes === authorityCount) {
    return {
      authorities, authorityCount,
      confidence: authorityCount === 3 ? 'unanimous' : 'majority',
      outlier: 'none',
      action: 'accept',
      reasoning: authorityCount === 3
        ? 'All three authorities agree: PASS'
        : `${authorityCount} authorities agree: PASS (${nameAbsent(authorities)} absent)`,
    };
  }

  // All present agree FAIL
  if (fails === authorityCount) {
    return {
      authorities, authorityCount,
      confidence: authorityCount === 3 ? 'unanimous' : 'majority',
      outlier: 'none',
      action: 'rollback',
      reasoning: authorityCount === 3
        ? 'All three authorities agree: FAIL'
        : `${authorityCount} authorities agree: FAIL (${nameAbsent(authorities)} absent)`,
    };
  }

  // 2 present, they disagree → split
  if (authorityCount === 2) {
    return {
      authorities, authorityCount,
      confidence: 'split',
      outlier: 'none',
      action: 'escalate',
      reasoning: `${nameByVerdict(authorities, 'pass')} says PASS but ${nameByVerdict(authorities, 'fail')} says FAIL — escalating`,
    };
  }

  // 3 present, 2-1 split — find the outlier
  const outlier = findOutlier(d, b, v);
  const majorityVerdict = passes > fails ? 'pass' : 'fail';

  // Majority PASS (2 pass, 1 fail) → escalate
  if (majorityVerdict === 'pass') {
    return {
      authorities, authorityCount,
      confidence: 'majority',
      outlier,
      action: 'escalate',
      reasoning: `${outlier} disagrees (FAIL) while others say PASS — escalating`,
    };
  }

  // Majority FAIL (2 fail, 1 pass) → escalate for vision, rollback otherwise
  if (outlier === 'vision') {
    return {
      authorities, authorityCount,
      confidence: 'majority',
      outlier,
      action: 'escalate',
      reasoning: `Vision says PASS but deterministic + browser say FAIL — vision may be optimistic`,
    };
  }

  return {
    authorities, authorityCount,
    confidence: 'majority',
    outlier,
    action: 'rollback',
    reasoning: `${outlier} says PASS but the other two say FAIL — rolling back`,
  };
}

/**
 * Build a triangulation gate result from the three authority gate results.
 * Extracts pass/fail/absent from the gates array.
 */
export function runTriangulationGate(
  gates: GateResult[],
  log: (msg: string) => void,
): TriangulationGateResult {
  const start = Date.now();

  // Extract verdicts from prior gate results
  // Deterministic = all non-perceptual gates (grounding, F9, filesystem, HTTP, invariants)
  // These are causal truth — file state, HTTP responses, health checks — not rendered perception
  const deterministicGates = gates.filter(g =>
    g.gate === 'grounding' || g.gate === 'F9' ||
    (g.gate as string) === 'filesystem' ||
    g.gate === 'http' || g.gate === 'invariants'
  );
  const deterministicPassed = deriveDeterministicVerdict(deterministicGates);

  // Browser gate
  const browserGate = gates.find(g => g.gate === 'browser');
  const browserPassed = browserGate ? browserGate.passed : null;

  // Vision gate
  const visionGate = gates.find(g => g.gate === 'vision');
  const visionPassed = deriveVisionVerdict(visionGate);

  const result = triangulate(deterministicPassed, browserPassed, visionPassed);

  log(`[triangulation] ${result.confidence} (${result.authorityCount}/3 authorities) → ${result.action}`);
  log(`[triangulation]   deterministic=${result.authorities.deterministic}, browser=${result.authorities.browser}, vision=${result.authorities.vision}`);
  if (result.outlier !== 'none') {
    log(`[triangulation]   outlier: ${result.outlier}`);
  }
  log(`[triangulation]   ${result.reasoning}`);

  return {
    gate: 'triangulation',
    passed: result.action === 'accept' || result.action === 'proceed',
    detail: `${result.confidence}: ${result.reasoning}`,
    durationMs: Date.now() - start,
    triangulation: result,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function deriveDeterministicVerdict(
  deterministicGates: GateResult[],
): boolean | null {
  // If no deterministic gates ran, authority is absent
  if (deterministicGates.length === 0) return null;
  // If any deterministic gate failed, the authority failed
  // (these are causal checks — a single failure is definitive)
  if (deterministicGates.some(g => !g.passed)) return false;
  // All ran and passed
  return true;
}

function deriveVisionVerdict(visionGate: GateResult | undefined): boolean | null {
  if (!visionGate) return null;
  // Vision gate marks "skipped" cases as passed — treat those as absent
  if (visionGate.detail.includes('skipped')) return null;
  return visionGate.passed;
}

function findOutlier(d: AuthorityVerdict, b: AuthorityVerdict, v: AuthorityVerdict): OutlierAuthority {
  if (d !== b && d !== v) return 'deterministic';
  if (b !== d && b !== v) return 'browser';
  if (v !== d && v !== b) return 'vision';
  return 'none';
}

function namePresent(a: AuthorityVerdicts): string {
  const names: string[] = [];
  if (a.deterministic !== 'absent') names.push('deterministic');
  if (a.browser !== 'absent') names.push('browser');
  if (a.vision !== 'absent') names.push('vision');
  return names.join(' + ') || 'none';
}

function nameAbsent(a: AuthorityVerdicts): string {
  const names: string[] = [];
  if (a.deterministic === 'absent') names.push('deterministic');
  if (a.browser === 'absent') names.push('browser');
  if (a.vision === 'absent') names.push('vision');
  return names.join(' + ') || 'none';
}

function nameByVerdict(a: AuthorityVerdicts, verdict: AuthorityVerdict): string {
  const names: string[] = [];
  if (a.deterministic === verdict) names.push('deterministic');
  if (a.browser === verdict) names.push('browser');
  if (a.vision === verdict) names.push('vision');
  return names.join(' + ') || 'none';
}
