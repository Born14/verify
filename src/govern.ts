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

    // Build context for the agent
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
      continue;
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
    // VERIFY — Run the 17-gate pipeline
    // -----------------------------------------------------------------------
    const verifyConfig: VerifyConfig = {
      appDir,
      goal,
      stateDir,
      gates,
      docker,
      vision,
      invariants,
      migrations: plan.migrations,
    };

    const result = await verify(plan.edits, plan.predicates, verifyConfig);
    history.push(result);
    attemptDurations.push(Date.now() - attemptStart);

    // Track constraints seeded
    if (result.constraintDelta?.seeded) {
      allConstraintsSeeded.push(...result.constraintDelta.seeded);
    }

    // -----------------------------------------------------------------------
    // DECOMPOSE — Map failure to taxonomy shapes
    // -----------------------------------------------------------------------
    let decomposition: DecompositionResult | undefined;
    if (!result.success) {
      try {
        decomposition = decomposeFailure(result, plan.predicates);
        const shapeIds = decomposition.shapes.map(s => s.id);
        allShapes.push(...shapeIds);

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
    // CONVERGE — Success or narrow
    // -----------------------------------------------------------------------
    if (result.success) {
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
      });
    }

    // If this isn't the last attempt, the loop continues.
    // The narrowing is threaded through via priorResult on the next iteration.
  }

  // =========================================================================
  // EXHAUSTED — All attempts failed
  // =========================================================================
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
}

function buildGovernResult(opts: BuildGovernResultOpts): GovernResult {
  const {
    success, history, allShapes, allConstraintsSeeded, unclassifiedFailures,
    attemptDurations, totalStart, store, goal, abortedByApproval,
  } = opts;

  const finalResult = history[history.length - 1];
  const constraintsBefore = store.getConstraintCount() - allConstraintsSeeded.length;
  const constraintsAfter = store.getConstraintCount();

  // Convergence narrowed if constraints were seeded (search space shrank)
  const convergenceNarrowed = allConstraintsSeeded.length > 0;

  const gatesPassed = finalResult.gates.filter(g => g.passed).map(g => g.gate);
  const gatesFailed = finalResult.gates.filter(g => !g.passed).map(g => g.gate);

  return {
    success,
    attempts: history.length,
    finalResult,
    history,
    convergenceNarrowed,
    abortedByApproval,
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
