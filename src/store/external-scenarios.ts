/**
 * External Scenario Registry — Fault-Derived Test Scenarios
 * ==========================================================
 *
 * Bridge between the fault ledger and the self-test harness.
 * Faults discovered by campaigns are encoded as VerifyScenarios here,
 * then loaded by the runner alongside the programmatic scenario families.
 *
 * Format: JSON array of SerializedScenario objects (no functions — pure data).
 * The runner deserializes them into VerifyScenario objects with invariant checks.
 *
 * Usage:
 *   import { ExternalScenarioStore } from '@sovereign-labs/verify';
 *
 *   const store = new ExternalScenarioStore('.verify/custom-scenarios.json');
 *   store.add({ ... });
 *   const scenarios = store.loadAsVerifyScenarios();
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Edit, Predicate } from '../types.js';

// =============================================================================
// SERIALIZED FORMAT (JSON-safe, no functions)
// =============================================================================

/**
 * What the scenario tests for:
 * - false_positive: verify should FAIL but was passing (edit breaks something)
 * - false_negative: verify should PASS but was failing (edit is correct)
 * - bad_hint: verify's narrowing was misleading
 * - regression_guard: general regression test from a real campaign run
 */
export type ScenarioIntent =
  | 'false_positive'
  | 'false_negative'
  | 'bad_hint'
  | 'regression_guard';

/**
 * How transferable is this scenario across codebases?
 * - universal: Tests a verify gate bug that applies to ANY app (CSS spec, HTML spec, gate logic)
 * - framework: Tests a pattern specific to a framework/structure (Express inline HTML, Next.js, etc.)
 * - app_specific: Tests something unique to this app's code (specific selectors, routes, schema)
 */
export type ScenarioTransferability = 'universal' | 'framework' | 'app_specific';

/**
 * Which verify subsystem does this scenario exercise?
 */
export type ScenarioCategory =
  | 'grounding'     // Predicate grounding against real source
  | 'containment'   // G5 mutation attribution
  | 'constraints'   // K5 constraint enforcement
  | 'staging'       // Docker build/start/browser gate
  | 'syntax'        // F9 edit validation
  | 'sequencing'    // Gate ordering
  | 'evidence'      // O.5b post-deploy verification
  | 'narrowing';    // Hint/feedback quality

/**
 * JSON-serializable scenario — stored in the registry file.
 * No functions, no closures. Pure data.
 */
export interface SerializedScenario {
  /** Unique ID (cs-{timestamp}-{random}) */
  id: string;

  /** Human-readable description of what this tests */
  description: string;

  /** The fault this was derived from (null if manually authored) */
  faultId: string | null;

  /** What verify behavior this scenario tests */
  intent: ScenarioIntent;

  /** Whether verify should succeed on these edits+predicates */
  expectedSuccess: boolean;

  /** The edits to apply */
  edits: Edit[];

  /** The predicates to check */
  predicates: Predicate[];

  /** Gate configuration overrides */
  gates?: {
    syntax?: boolean;
    constraints?: boolean;
    containment?: boolean;
    staging?: boolean;
    browser?: boolean;
    http?: boolean;
    invariants?: boolean;
    vision?: boolean;
  };

  /** Whether this scenario needs Docker */
  requiresDocker: boolean;

  /** Which gate should fail (for false_negative intent) */
  expectedFailedGate?: string;

  /** Why this scenario exists — human-readable rationale */
  rationale: string;

  /** When this was encoded */
  encodedAt: string;

  /** Tags for filtering */
  tags?: string[];

  /** How transferable is this scenario to other codebases? */
  transferability?: ScenarioTransferability;

  /** Which verify subsystem this scenario exercises */
  category?: ScenarioCategory;
}

// =============================================================================
// STORE
// =============================================================================

export class ExternalScenarioStore {
  private path: string;
  private scenarios: SerializedScenario[];

  constructor(path: string) {
    this.path = path;
    this.scenarios = this.load();
  }

  private load(): SerializedScenario[] {
    if (!existsSync(this.path)) return [];
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.scenarios, null, 2) + '\n');
  }

  /**
   * Add a new scenario to the registry. Returns the scenario with generated ID.
   */
  add(scenario: Omit<SerializedScenario, 'id' | 'encodedAt'>): SerializedScenario {
    const full: SerializedScenario = {
      ...scenario,
      id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      encodedAt: new Date().toISOString(),
    };

    // Dedup: skip if same faultId already encoded
    if (full.faultId) {
      const existing = this.scenarios.find(s => s.faultId === full.faultId);
      if (existing) return existing;
    }

    this.scenarios.push(full);
    this.save();
    return full;
  }

  /**
   * Remove a scenario by ID.
   */
  remove(id: string): boolean {
    const before = this.scenarios.length;
    this.scenarios = this.scenarios.filter(s => s.id !== id);
    if (this.scenarios.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /**
   * Get all scenarios.
   */
  all(): SerializedScenario[] {
    return [...this.scenarios];
  }

  /**
   * Get scenarios by intent.
   */
  byIntent(intent: ScenarioIntent): SerializedScenario[] {
    return this.scenarios.filter(s => s.intent === intent);
  }

  /**
   * Get count.
   */
  count(): number {
    return this.scenarios.length;
  }

  /**
   * Get scenarios by transferability tier.
   */
  byTransferability(tier: ScenarioTransferability): SerializedScenario[] {
    return this.scenarios.filter(s => s.transferability === tier);
  }

  /**
   * Get scenarios by category.
   */
  byCategory(cat: ScenarioCategory): SerializedScenario[] {
    return this.scenarios.filter(s => s.category === cat);
  }

  /**
   * Backfill classification on scenarios that predate the transferability/category fields.
   * Returns count of scenarios updated.
   */
  backfillClassifications(): number {
    let updated = 0;
    for (const s of this.scenarios) {
      let changed = false;
      if (!s.transferability) {
        s.transferability = classifyTransferability(s);
        changed = true;
      }
      if (!s.category) {
        s.category = classifyCategory(s);
        changed = true;
      }
      if (changed) updated++;
    }
    if (updated > 0) this.save();
    return updated;
  }

  /**
   * Summary stats for the registry.
   */
  stats(): {
    total: number;
    byTransferability: Record<string, number>;
    byCategory: Record<string, number>;
    byIntent: Record<string, number>;
  } {
    const bt: Record<string, number> = {};
    const bc: Record<string, number> = {};
    const bi: Record<string, number> = {};
    for (const s of this.scenarios) {
      const t = s.transferability ?? 'unclassified';
      bt[t] = (bt[t] ?? 0) + 1;
      const c = s.category ?? 'unclassified';
      bc[c] = (bc[c] ?? 0) + 1;
      bi[s.intent] = (bi[s.intent] ?? 0) + 1;
    }
    return { total: this.scenarios.length, byTransferability: bt, byCategory: bc, byIntent: bi };
  }
}

// =============================================================================
// DETERMINISTIC CLASSIFIERS
// =============================================================================

/**
 * Classify transferability from scenario data.
 *
 * Universal: the bug is in verify's gate logic (CSS spec, HTML spec, comparison logic).
 *   Signal: expectedFailedGate is a gate name + predicates use generic patterns.
 * Framework: the bug depends on code structure patterns (inline HTML, route handlers).
 *   Signal: edits reference structural patterns but the predicate type is generic.
 * App-specific: the scenario only makes sense for this exact app.
 *   Signal: predicates reference specific selectors/routes unique to the app.
 */
export function classifyTransferability(
  scenario: Pick<SerializedScenario, 'predicates' | 'edits' | 'tags' | 'expectedFailedGate' | 'rationale'>
): ScenarioTransferability {
  const gate = scenario.expectedFailedGate ?? '';
  const tags = scenario.tags ?? [];
  const rationale = (scenario.rationale ?? '').toLowerCase();
  const preds = scenario.predicates ?? [];

  // Gate-logic bugs are universal — the gate itself is broken regardless of app
  // Signals: rationale mentions spec-level concepts, or tags indicate spec-level issues
  const specSignals = [
    'color normalization', 'named color', 'shorthand', 'longhand',
    'css spec', 'html spec', 'unit equivalence', 'hex', 'rgb',
    'font-weight bold', 'border shorthand',
  ];
  if (specSignals.some(s => rationale.includes(s))) return 'universal';

  // Fabricated selector tests are universal — any app with grounding should reject them
  if (tags.includes('fabricated-selector')) return 'universal';

  // Generic grounding/containment logic bugs (no app-specific selectors)
  if (gate === 'grounding' || gate === 'containment' || gate === 'constraints') {
    const hasAppSpecificSelector = preds.some(p =>
      p.selector && /^[.#][\w-]+-[\w-]+/.test(p.selector) // e.g. .player-count-badge, #roster-header
    );
    if (!hasAppSpecificSelector) return 'universal';
  }

  // Cross-route / path-scoping patterns are framework-level (any multi-route app)
  if (tags.includes('cross-route') || tags.includes('path-scoping')) return 'framework';

  // Content validation logic (text mismatch checking) — framework-level
  if (tags.includes('content-validation') || tags.includes('text-mismatch')) return 'framework';

  // Route-specific predicates with named routes → app_specific
  const hasNamedRoutes = preds.some(p =>
    p.path && p.path !== '/' && p.path.length > 1
  );
  if (hasNamedRoutes) return 'app_specific';

  // Default: app_specific (safe — only promotes when evidence is clear)
  return 'app_specific';
}

/**
 * Classify which verify subsystem a scenario exercises.
 * Deterministic from expectedFailedGate, predicate types, and tags.
 */
export function classifyCategory(
  scenario: Pick<SerializedScenario, 'expectedFailedGate' | 'predicates' | 'tags' | 'intent'>
): ScenarioCategory {
  const gate = scenario.expectedFailedGate ?? '';
  const tags = scenario.tags ?? [];

  // Direct gate mapping
  if (gate === 'grounding') return 'grounding';
  if (gate === 'containment') return 'containment';
  if (gate === 'constraints' || gate === 'k5') return 'constraints';
  if (gate === 'staging' || gate === 'browser') return 'staging';
  if (gate === 'syntax' || gate === 'f9') return 'syntax';
  if (gate === 'evidence' || gate === 'o5b') return 'evidence';

  // Tag-based fallback
  if (tags.includes('grounding')) return 'grounding';
  if (tags.includes('containment')) return 'containment';
  if (tags.includes('constraints') || tags.includes('k5')) return 'constraints';
  if (tags.includes('staging') || tags.includes('browser-gate')) return 'staging';
  if (tags.includes('narrowing') || tags.includes('bad-hint')) return 'narrowing';
  if (tags.includes('evidence')) return 'evidence';

  // Intent-based fallback
  if (scenario.intent === 'bad_hint') return 'narrowing';

  // Default from predicate types
  const preds = scenario.predicates ?? [];
  if (preds.some(p => p.type === 'css' || p.type === 'html')) return 'grounding';
  if (preds.some(p => p.type === 'http' || p.type === 'http_sequence')) return 'evidence';
  if (preds.some(p => p.type === 'db')) return 'evidence';

  return 'grounding'; // safe default — most scenarios test predicate validation
}
