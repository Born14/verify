/**
 * @sovereign-labs/verify
 * ======================
 *
 * Verification gate for AI-generated code.
 * Every edit gets a fair trial before it touches your users.
 *
 * Usage:
 *   import { verify } from '@sovereign-labs/verify';
 *
 *   const result = await verify(edits, predicates, {
 *     appDir: './my-app',
 *     docker: { compose: true },
 *   });
 *
 *   if (!result.success) {
 *     console.log(result.narrowing); // what to try next
 *   }
 */

// The one function
export { verify } from './verify.js';

// The governed loop — verify() in a convergence loop
export { govern } from './govern.js';
export type {
  GovernConfig,
  GovernResult,
  GovernReceipt,
  GovernContext,
  GovernAgent,
  AgentPlan,
  ConvergenceState,
  StopReason,
} from './govern.js';

// Types — everything a consumer needs
export type {
  // Core
  Edit,
  Predicate,
  VerifyConfig,
  VerifyResult,
  Invariant,

  // Gate results
  GateResult,
  GateContext,
  Narrowing,
  NextMove,
  PredicateResult,

  // Runners
  ContainerRunner,
  CommandResult,

  // Grounding
  GroundingContext,
} from './types.js';

// Constraint store — for advanced users who want persistent learning
export { ConstraintStore, extractSignature, predicateFingerprint, classifyChangeType } from './store/constraint-store.js';

// Decomposition engine — maps observations to taxonomy shape IDs
export {
  decomposeFailure, decomposeObservation,
  getShapeCatalog, getShapesByDomain, getShapesByClaimType, isKnownShape, isComposition,
  // Phase 2: Decomposition hardening
  minimizeShapes, sortShapes, scoreDecomposition,
  detectClaimType, decomposeByClaimType,
  detectTemporalMode, annotateTemporalMode,
  // Phase 2: Diagnostics
  computeDecompositionDiagnostics, computeMinimizerReduction,
} from './store/decompose.js';
export type { DecomposedShape, DecompositionResult, DecompositionDiagnostics, TemporalMode, ClaimType, TruthType, OutcomeType } from './store/decompose.js';

// Docker runner — for users who need custom container setup
export { LocalDockerRunner, isDockerAvailable, hasDockerCompose } from './runners/docker-runner.js';

// Grounding — for users who want to scan before submitting
export { groundInReality, validateAgainstGrounding } from './gates/grounding.js';

// Individual gates — for users who want to run gates separately
export { runSyntaxGate, applyEdits } from './gates/syntax.js';
export { runFilesystemGate, hashFile, isFilesystemPredicate } from './gates/filesystem.js';
export type { FilesystemGateResult, FilesystemPredicateResult } from './gates/filesystem.js';
export { runBrowserGate } from './gates/browser.js';
export { runVisionGate } from './gates/vision.js';
export { geminiVision, openaiVision, anthropicVision } from './vision-helpers.js';
export { runHttpGate } from './gates/http.js';
export { runInvariantsGate } from './gates/invariants.js';
export { runAccessGate } from './gates/access.js';
export type { AccessGateResult, AccessViolation } from './gates/access.js';
export { runTemporalGate } from './gates/temporal.js';
export type { TemporalGateResult, TemporalDrift } from './gates/temporal.js';
export { runPropagationGate } from './gates/propagation.js';
export type { PropagationGateResult, PropagationBreak } from './gates/propagation.js';
export { runStateGate } from './gates/state.js';
export type { StateGateResult, StateDivergence } from './gates/state.js';
export { runCapacityGate } from './gates/capacity.js';
export type { CapacityGateResult, CapacityViolation } from './gates/capacity.js';
export { runContentionGate } from './gates/contention.js';
export type { ContentionGateResult, ContentionIssue } from './gates/contention.js';
export { runObservationGate, isObservationRelevant } from './gates/observation.js';
export type { ObservationGateResult, ObserverEffect, ObservationDomain } from './gates/observation.js';

// Fault ledger — track real-world gate faults for improvement
export { FaultLedger } from './store/fault-ledger.js';
export type {
  FaultEntry,
  FaultClassification,
  FaultSummary,
  CrossCheckEvidence,
  RecordContext,
} from './store/fault-ledger.js';

// External scenario store — encode faults as permanent self-test scenarios
export { ExternalScenarioStore, classifyTransferability, classifyCategory } from './store/external-scenarios.js';
export type {
  SerializedScenario,
  ScenarioIntent,
  ScenarioTransferability,
  ScenarioCategory,
} from './store/external-scenarios.js';

// Message gate — governed outbound communication assertions
export { governMessage, runMessageGate } from './gates/message.js';
export type {
  MessageEnvelope,
  MessagePolicy,
  MessageGateResult,
  MessageGateContext,
  MessageVerdict,
  MessageBlockReason,
  MessageClarifyReason,
  ClaimResult,
  EvidenceProvider,
  EvidenceResult,
  ReviewVerdict,
  TopicResolution,
} from './gates/message.js';

// Parsers — convert external formats into Edit[]
export { parseDiff } from './parsers/git-diff.js';
