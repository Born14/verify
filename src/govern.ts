/**
 * govern() — The Governed Execution Loop
 * =======================================
 *
 * Wraps verify() in a convergence loop. The agent plans, verify judges,
 * failures narrow the search space, and the agent retries with more information.
 *
 * This is the bridge between "a verification pipeline" and "a governed runtime."
 * The taxonomy classifies. The gates enforce. govern() makes them converge.
 *
 * Convergence intelligence ported from Sovereign's agent-loop patterns:
 *   - Shape repetition detection (same shapes across attempts → stuck)
 *   - Empty plan stall (consecutive empty edits → escalate)
 *   - Gate cycle detection (same gate failing same way → stuck)
 *   - Constraint saturation (constraints growing but not helping → clarify)
 *   - Three exit paths: converged, exhausted, stuck
 *
 * Usage:
 *   import { govern } from '@sovereign-labs/verify';
 *
 *   const result = await govern({
 *     appDir: './my-app',
 *     goal: 'Change the button color to orange',
 *     agent: {
 *       plan: async (goal, ctx) => ({
 *         edits: [{ file: 'style.css', search: 'blue', replace: 'orange' }],
 *         predicates: [{ type: 'css', selector: '.btn', property: 'color', expected: 'orange' }],
 *       }),
 *     },
 *   });
 */

import type { Edit, Predicate, Invariant, VerifyConfig, VerifyResult, Narrowing, GroundingContext } from './types.js';
import { verify } from './verify.js';
import { groundInReality } from './gates/grounding.js';
import { ConstraintStore } from './store/constraint-store.js';
import { decomposeFailure } from './store/decompose.js';
import type { DecompositionResult } from './store/decompose.js';
import { FaultLedger } from './store/fault-ledger.js';
import { mkdirSync } from 'fs';
import { join } from 'path';


// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Why the governed loop stopped. Three exit paths:
 *   - converged: goal succeeded
 *   - exhausted: all attempts used, but was making progress
 *   - stuck: loop detected no progress (shape repetition, gate cycles, constraint saturation)
 *   - empty_plan_stall: agent returned empty edits repeatedly
 *   - approval_aborted: human rejected the plan
 *   - agent_error: agent plan() threw on every attempt
 */
export type StopReason =
  | 'converged'
  | 'exhausted'
  | 'stuck'
  | 'empty_plan_stall'
  | 'approval_aborted'
  | 'agent_error';

/**
 * Convergence state — tracks whether the loop is making progress.
 * Available on GovernResult and GovernContext (so the agent can see it too).
 */
export interface ConvergenceState {
  /** Why the loop stopped (or 'running' if still active — only on context) */
  stopReason?: StopReason;

  /** Are new shapes appearing? (false = stuck, same failures repeating) */
  shapesProgressing: boolean;

  /** Are new gates being reached? (false = stuck at same gate) */
  gatesProgressing: boolean;

  /** Unique shapes seen so far */
  uniqueShapes: string[];

  /** Per-attempt shape sets — which shapes were new on each attempt */
  shapeHistory: string[][];

  /** Per-attempt gate failure sets — which gates failed on each attempt */
  gateFailureHistory: string[][];

  /** Consecutive empty plans (agent returning 0 edits) */
  emptyPlanCount: number;

  /** Consecutive identical gate failure sets (exact same gates failing) */
  gateRepeatCount: number;

  /** Constraints seeded but shapes unchanged — narrowing isn't helping */
  constraintSaturation: boolean;

  /** Human-readable progress summary */
  progressSummary: string;
}

/**
 * What the governed loop gives the agent on each attempt.
 * Everything the agent needs to make a better plan.
 */
export interface GovernContext {
  /** CSS, HTML, routes, DB schema — the app's ground truth */
  grounding: GroundingContext;

  /** Which attempt this is (1-indexed) */
  attempt: number;

  /** The previous verify result (undefined on first attempt) */
  priorResult?: VerifyResult;

  /** What to change — constraints seeded, fingerprints banned, hints */
  narrowing?: Narrowing;

  /** Human-readable summary of what's currently banned */
  constraints: Array<{
    id: string;
    type: string;
    reason: string;
  }>;

  /** Failure shapes from the taxonomy (what category of failure occurred) */
  failureShapes?: string[];

  /** Convergence state — is the loop making progress? */
  convergence?: ConvergenceState;
}

/**
 * What the agent returns — edits and predicates.
 * The agent brings the brain. govern() brings the gates.
 */
export interface AgentPlan {
  edits: Edit[];
  predicates: Predicate[];
  /** Optional migrations for DB-backed apps */
  migrations?: Array<{ name: string; sql: string }>;
}

/**
 * The agent interface. One method: plan.
 * Everything else is govern()'s responsibility.
 */
export interface GovernAgent {
  /**
   * Produce edits and predicates for the goal.
   * Called once per attempt. On retry, context includes what failed and why.
   */
  plan: (goal: string, context: GovernContext) => Promise<AgentPlan>;
}

/**
 * Configuration for the governed loop.
 */
export interface GovernConfig {
  /** Path to the app directory */
  appDir: string;

  /** What the edits should achieve */
  goal: string;

  /** The agent that produces edits + predicates */
  agent: GovernAgent;

  /** Maximum attempts before giving up (default: 3) */
  maxAttempts?: number;

  /** Where to store constraints and outcomes (default: {appDir}/.verify) */
  stateDir?: string;

  /** Gate toggles — passed through to verify() */
  gates?: VerifyConfig['gates'];

  /** Docker options — passed through to verify() */
  docker?: VerifyConfig['docker'];

  /** Vision options — passed through to verify() */
  vision?: VerifyConfig['vision'];

  /** System invariants — passed through to verify() */
  invariants?: Invariant[];

  /** Called after each attempt — observe progress without blocking */
  onAttempt?: (attempt: number, result: VerifyResult) => void;

  /**
   * Human approval gate. Called before verify() runs.
   * Return false to abort. Omit to auto-approve (CI mode).
   */
  onApproval?: (plan: AgentPlan, context: GovernContext) => Promise<boolean>;

  /**
   * Called when the loop detects it's stuck (shape repetition, gate cycles, etc.).
   * Return 'continue' to force another attempt, 'stop' to break immediately.
   * Default: stop immediately when stuck.
   */
  onStuck?: (state: ConvergenceState, context: GovernContext) => 'continue' | 'stop';
}

/**
 * The full result of a governed execution.
 */
export interface GovernResult {
  /** Did the goal succeed? */
  success: boolean;

  /** How many attempts were made */
  attempts: number;

  /** The final verify() result */
  finalResult: VerifyResult;

  /** Every attempt's verify() result, in order */
  history: VerifyResult[];

  /** Did the solution space narrow across attempts? (K5 working) */
  convergenceNarrowed: boolean;

  /** Was the loop stopped by the approval gate? */
  abortedByApproval: boolean;

  /** Why the loop stopped — the three exit paths */
  stopReason: StopReason;

  /** Full convergence tracking state */
  convergence: ConvergenceState;

  /** Execution receipt — the audit trail */
  receipt: GovernReceipt;
}

/**
 * The audit trail for a governed execution.
 */
export interface GovernReceipt {
  /** The goal that was attempted */
  goal: string;

  /** Human-readable attestation from the final attempt */
  attestation: string;

  /** Gates that passed on the final attempt */
  gatesPassed: string[];

  /** Gates that failed on the final attempt (empty on success) */
  gatesFailed: string[];

  /** Number of active constraints at completion */
  constraintsActive: number;

  /** Constraints seeded during this governed run */
  constraintsSeeded: string[];

  /** Failure shapes encountered (taxonomy IDs) */
  failureShapes: string[];

  /** Number of failures that didn't match any taxonomy shape (gaps in the algebra) */
  unclassifiedFailures: number;

  /** Total wall-clock time across all attempts */
  totalDurationMs: number;

  /** Per-attempt durations */
  attemptDurations: number[];
}


// =============================================================================
// CONVERGENCE DETECTION — Pure functions, ported from Sovereign
// =============================================================================

/** Threshold: consecutive empty plans before escalating */
const EMPTY_PLAN_STALL_THRESHOLD = 3;

/** Threshold: consecutive identical gate failure sets before declaring stuck */
const GATE_REPEAT_THRESHOLD = 3;

/**
 * Create initial convergence state.
 */
function createConvergenceState(): ConvergenceState {
  return {
    shapesProgressing: true,
    gatesProgressing: true,
    uniqueShapes: [],
    shapeHistory: [],
    gateFailureHistory: [],
    emptyPlanCount: 0,
    gateRepeatCount: 0,
    constraintSaturation: false,
    progressSummary: 'Starting',
  };
}

/**
 * Record an empty plan attempt. Returns updated state.
 */
function recordEmptyPlan(state: ConvergenceState): ConvergenceState {
  const emptyPlanCount = state.emptyPlanCount + 1;
  return {
    ...state,
    emptyPlanCount,
    progressSummary: `Empty plan ${emptyPlanCount}/${EMPTY_PLAN_STALL_THRESHOLD}`,
  };
}

/**
 * Record a verify() result. Returns updated state with convergence signals.
 */
function recordAttempt(
  state: ConvergenceState,
  shapes: string[],
  gateFailures: string[],
  constraintsBeforeAttempt: number,
  constraintsAfterAttempt: number,
): ConvergenceState {
  // Reset empty plan counter (we got a real plan)
  const emptyPlanCount = 0;

  // --- Shape progression ---
  const prevUnique = new Set(state.uniqueShapes);
  const newShapes = shapes.filter(s => !prevUnique.has(s));
  const uniqueShapes = [...new Set([...state.uniqueShapes, ...shapes])];
  const shapeHistory = [...state.shapeHistory, shapes];
  const shapesProgressing = shapes.length === 0 || newShapes.length > 0;

  // --- Gate progression ---
  const gateFailureHistory = [...state.gateFailureHistory, gateFailures];
  const prevGateFailures = state.gateFailureHistory[state.gateFailureHistory.length - 1];
  const gatesSame = prevGateFailures !== undefined && setsEqual(prevGateFailures, gateFailures);
  const gateRepeatCount = gatesSame ? state.gateRepeatCount + 1 : 0;
  const gatesProgressing = !gatesSame;

  // --- Constraint saturation ---
  // Constraints grew but shapes didn't change = narrowing isn't helping
  const constraintsGrew = constraintsAfterAttempt > constraintsBeforeAttempt;
  const constraintSaturation = constraintsGrew && !shapesProgressing;

  // --- Progress summary ---
  const parts: string[] = [];
  if (newShapes.length > 0) parts.push(`${newShapes.length} new shape(s)`);
  if (!shapesProgressing && shapes.length > 0) parts.push('shapes repeating');
  if (gatesSame) parts.push(`same gates failing (×${gateRepeatCount + 1})`);
  if (constraintSaturation) parts.push('constraint saturation');
  const progressSummary = parts.length > 0 ? parts.join(', ') : 'progressing';

  return {
    shapesProgressing,
    gatesProgressing,
    uniqueShapes,
    shapeHistory,
    gateFailureHistory,
    emptyPlanCount,
    gateRepeatCount,
    constraintSaturation,
    progressSummary,
  };
}

/**
 * Determine if the loop should stop early.
 * Returns a StopReason if stuck, or undefined to continue.
 */
function detectStuck(state: ConvergenceState): StopReason | undefined {
  // Empty plan stall: agent can't produce edits
  if (state.emptyPlanCount >= EMPTY_PLAN_STALL_THRESHOLD) {
    return 'empty_plan_stall';
  }

  // Gate cycle: same gates failing the same way repeatedly
  if (state.gateRepeatCount >= GATE_REPEAT_THRESHOLD) {
    return 'stuck';
  }

  // Shape repetition + constraint saturation: narrowing didn't help, shapes unchanged
  if (state.constraintSaturation && !state.shapesProgressing && state.gateFailureHistory.length >= 2) {
    return 'stuck';
  }

  // Both axes stalled: no new shapes AND same gates for 2+ attempts
  if (!state.shapesProgressing && !state.gatesProgressing && state.gateFailureHistory.length >= 2) {
    return 'stuck';
  }

  return undefined;
}

/**
 * Determine the final stop reason when loop ends normally.
 */
function determineFinalStopReason(
  success: boolean,
  abortedByApproval: boolean,
  state: ConvergenceState,
  history: VerifyResult[],
): StopReason {
  if (success) return 'converged';
  if (abortedByApproval) return 'approval_aborted';

  // Check if we ever made progress
  const stuckReason = detectStuck(state);
  if (stuckReason) return stuckReason;

  // All attempts were agent errors (plan() threw or empty)
  const allAgentErrors = history.every(r =>
    r.attestation.includes('Agent plan() threw') || r.attestation.includes('0 edits')
  );
  if (allAgentErrors) return 'agent_error';

  // Had progress (new shapes appeared, gates changed) but ran out of attempts
  if (state.shapesProgressing || state.gatesProgressing) return 'exhausted';

  // Default: stuck (no evidence of progress)
  return 'stuck';
}

/**
 * Set equality for string arrays (order-independent).
 */
function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every(x => setA.has(x));
}


// =============================================================================
// THE ONE FUNCTION
// =============================================================================

/**
 * Run a goal through the governed execution loop.
 *
 * Ground → Plan → Verify → Narrow → Retry.
 *
 * The agent brings the brain. Verify brings the gates.
 * govern() makes them converge.
 */
export async function govern(config: GovernConfig): Promise<GovernResult> {
  const {
    appDir,
    goal,
    agent,
    maxAttempts = 3,
    stateDir = join(appDir, '.verify'),
    gates,
    docker,
    vision,
    invariants,
    onAttempt,
    onApproval,
    onStuck,
  } = config;

  mkdirSync(stateDir, { recursive: true });

  const store = new ConstraintStore(stateDir);
  const ledger = new FaultLedger(join(stateDir, 'faults.jsonl'));
  const history: VerifyResult[] = [];
  const allShapes: string[] = [];
  const allConstraintsSeeded: string[] = [];
  const attemptDurations: number[] = [];
  const totalStart = Date.now();
  let abortedByApproval = false;
  let unclassifiedFailures = 0;
  let convergence = createConvergenceState();

  // =========================================================================
  // GROUND — Read reality once, before any attempts
  // =========================================================================
  const grounding = groundInReality(appDir);

  // =========================================================================
  // THE LOOP — Plan → Verify → Narrow → Retry
  // =========================================================================
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();
    const priorResult = history[history.length - 1];

    // Build context for the agent (includes convergence state)
    const context: GovernContext = {
      grounding,
      attempt,
      priorResult,
      narrowing: priorResult?.narrowing,
      constraints: store.getConstraints().map(c => ({
        id: c.id,
        type: c.type,
        reason: c.reason,
      })),
      failureShapes: allShapes.length > 0 ? [...allShapes] : undefined,
      convergence: attempt > 1 ? { ...convergence } : undefined,
    };

    // -----------------------------------------------------------------------
    // PLAN — Ask the agent for edits + predicates
    // -----------------------------------------------------------------------
    let plan: AgentPlan;
    try {
      plan = await agent.plan(goal, context);
    } catch (err: any) {
      // Agent failed to plan — record as a failed attempt
      const failResult: VerifyResult = {
        success: false,
        gates: [],
        attestation: `GOVERN: Agent plan() threw: ${err?.message ?? 'unknown error'}`,
        timing: { totalMs: Date.now() - attemptStart, perGate: {} },
      };
      history.push(failResult);
      attemptDurations.push(Date.now() - attemptStart);
      onAttempt?.(attempt, failResult);
      continue;
    }

    // Validate plan is non-empty
    if (!plan.edits || plan.edits.length === 0) {
      convergence = recordEmptyPlan(convergence);

      const emptyResult: VerifyResult = {
        success: false,
        gates: [],
        narrowing: { constraints: [], resolutionHint: 'Agent returned empty edits. The goal may need clarification.' },
        attestation: `GOVERN: Agent returned 0 edits for "${goal}"`,
        timing: { totalMs: Date.now() - attemptStart, perGate: {} },
      };
      history.push(emptyResult);
      attemptDurations.push(Date.now() - attemptStart);
      onAttempt?.(attempt, emptyResult);

      // Check empty plan stall
      const stuckReason = detectStuck(convergence);
      if (stuckReason) {
        convergence.stopReason = stuckReason;
        if (!onStuck || onStuck(convergence, context) === 'stop') {
          break;
        }
      }
      continue;
    }

    // Reset empty plan counter on non-empty plan
    if (convergence.emptyPlanCount > 0) {
      convergence = { ...convergence, emptyPlanCount: 0 };
    }

    // -----------------------------------------------------------------------
    // APPROVAL — Human gate (optional)
    // -----------------------------------------------------------------------
    if (onApproval) {
      const approved = await onApproval(plan, context);
      if (!approved) {
        abortedByApproval = true;
        const abortResult: VerifyResult = {
          success: false,
          gates: [],
          attestation: `GOVERN: Aborted by approval gate on attempt ${attempt}`,
          timing: { totalMs: Date.now() - attemptStart, perGate: {} },
        };
        history.push(abortResult);
        attemptDurations.push(Date.now() - attemptStart);
        onAttempt?.(attempt, abortResult);
        break;
      }
    }

    // -----------------------------------------------------------------------
    // VERIFY — Run the gate pipeline
    // -----------------------------------------------------------------------
    const constraintsBefore = store.getConstraintCount();

    const verifyConfig: VerifyConfig = {
      appDir,
      goal,
      stateDir,
      gates,
      docker,
      vision,
      invariants,
      migrations: plan.migrations,
      learning: 'persistent',
    };

    const result = await verify(plan.edits, plan.predicates, verifyConfig);
    history.push(result);
    attemptDurations.push(Date.now() - attemptStart);

    // Track constraints seeded
    if (result.constraintDelta?.seeded) {
      allConstraintsSeeded.push(...result.constraintDelta.seeded);
    }

    const constraintsAfter = store.getConstraintCount();

    // -----------------------------------------------------------------------
    // DECOMPOSE — Map failure to taxonomy shapes
    // -----------------------------------------------------------------------
    let attemptShapes: string[] = [];
    let decomposition: DecompositionResult | undefined;
    if (!result.success) {
      try {
        decomposition = decomposeFailure(result, plan.predicates);
        attemptShapes = decomposition.shapes.map(s => s.id);
        allShapes.push(...attemptShapes);

        // Track unclassified failures — gaps in the taxonomy
        if (!decomposition.fullyClassified || decomposition.shapes.length === 0) {
          unclassifiedFailures++;
        }
      } catch {
        // Decomposition is diagnostic — never blocks the loop
        unclassifiedFailures++;
      }
    }

    // -----------------------------------------------------------------------
    // CONVERGENCE — Update tracking state
    // -----------------------------------------------------------------------
    const gateFailures = result.gates.filter(g => !g.passed).map(g => g.gate);
    convergence = recordAttempt(convergence, attemptShapes, gateFailures, constraintsBefore, constraintsAfter);

    // -----------------------------------------------------------------------
    // RECORD — Persist to fault ledger for taxonomy growth
    // -----------------------------------------------------------------------
    try {
      ledger.recordFromResult(result, {
        app: goal,
        goal,
        predicates: plan.predicates,
      });
    } catch {
      // Fault ledger is observational — never blocks the loop
    }

    // Notify observer
    onAttempt?.(attempt, result);

    // -----------------------------------------------------------------------
    // CONVERGE — Success, stuck, or narrow
    // -----------------------------------------------------------------------
    if (result.success) {
      convergence.stopReason = 'converged';
      convergence.progressSummary = formatFinalSummary('converged', convergence);
      return buildGovernResult({
        success: true,
        history,
        allShapes,
        allConstraintsSeeded,
        unclassifiedFailures,
        attemptDurations,
        totalStart,
        store,
        goal,
        abortedByApproval: false,
        convergence,
      });
    }

    // Check if stuck — early exit saves attempts
    if (attempt < maxAttempts) {
      const stuckReason = detectStuck(convergence);
      if (stuckReason) {
        convergence.stopReason = stuckReason;
        if (!onStuck || onStuck(convergence, context) === 'stop') {
          break;
        }
      }
    }

    // If this isn't the last attempt, the loop continues.
    // The narrowing is threaded through via priorResult on the next iteration.
  }

  // =========================================================================
  // DONE — Determine final stop reason
  // =========================================================================
  const stopReason = convergence.stopReason ?? determineFinalStopReason(
    false, abortedByApproval, convergence, history,
  );
  convergence.stopReason = stopReason;
  convergence.progressSummary = formatFinalSummary(stopReason, convergence);

  return buildGovernResult({
    success: false,
    history,
    allShapes,
    allConstraintsSeeded,
    unclassifiedFailures,
    attemptDurations,
    totalStart,
    store,
    goal,
    abortedByApproval,
    convergence,
  });
}


// =============================================================================
// INTERNAL HELPERS
// =============================================================================

interface BuildGovernResultOpts {
  success: boolean;
  history: VerifyResult[];
  allShapes: string[];
  allConstraintsSeeded: string[];
  unclassifiedFailures: number;
  attemptDurations: number[];
  totalStart: number;
  store: ConstraintStore;
  goal: string;
  abortedByApproval: boolean;
  convergence: ConvergenceState;
}

function buildGovernResult(opts: BuildGovernResultOpts): GovernResult {
  const {
    success, history, allShapes, allConstraintsSeeded, unclassifiedFailures,
    attemptDurations, totalStart, store, goal, abortedByApproval, convergence,
  } = opts;

  const finalResult = history[history.length - 1];
  const constraintsAfter = store.getConstraintCount();

  // Convergence narrowed if constraints were seeded (search space shrank)
  const convergenceNarrowed = allConstraintsSeeded.length > 0;

  const gatesPassed = finalResult.gates.filter(g => g.passed).map(g => g.gate);
  const gatesFailed = finalResult.gates.filter(g => !g.passed).map(g => g.gate);

  const stopReason = convergence.stopReason ?? 'exhausted';

  return {
    success,
    attempts: history.length,
    finalResult,
    history,
    convergenceNarrowed,
    abortedByApproval,
    stopReason,
    convergence,
    receipt: {
      goal,
      attestation: finalResult.attestation,
      gatesPassed,
      gatesFailed,
      constraintsActive: constraintsAfter,
      constraintsSeeded: [...new Set(allConstraintsSeeded)],
      failureShapes: [...new Set(allShapes)],
      unclassifiedFailures,
      totalDurationMs: Date.now() - totalStart,
      attemptDurations,
    },
  };
}

/**
 * Format a human-readable summary of why the loop stopped.
 */
function formatFinalSummary(reason: StopReason, state: ConvergenceState): string {
  switch (reason) {
    case 'converged':
      return `Converged after ${state.shapeHistory.length} attempt(s)`;
    case 'exhausted':
      return `Exhausted ${state.shapeHistory.length + state.emptyPlanCount} attempt(s) — was making progress (${state.uniqueShapes.length} unique shapes)`;
    case 'stuck':
      const stuckParts: string[] = [];
      if (!state.shapesProgressing) stuckParts.push('shapes repeating');
      if (state.gateRepeatCount >= GATE_REPEAT_THRESHOLD) stuckParts.push(`same gates failing ×${state.gateRepeatCount + 1}`);
      if (state.constraintSaturation) stuckParts.push('constraint saturation');
      return `Stuck: ${stuckParts.join(', ')}. Goal may need clarification.`;
    case 'empty_plan_stall':
      return `Agent returned ${state.emptyPlanCount} consecutive empty plans. Goal may need clarification.`;
    case 'approval_aborted':
      return 'Aborted by approval gate';
    case 'agent_error':
      return 'Agent plan() threw on every attempt';
  }
}
