/**
 * Campaign Types — Autonomous Verify Fault Discovery
 * ===================================================
 *
 * Types for the outer-circle loop that discovers verify bugs
 * by running diverse, LLM-generated edits against real apps.
 */

import type { Edit, Predicate, VerifyResult, GroundingContext } from '../../src/types.js';
import type { CrossCheckEvidence } from '../../src/store/fault-ledger.js';

// =============================================================================
// APP REGISTRY
// =============================================================================

export interface AppEntry {
  /** App name (used as identifier) */
  name: string;
  /** Absolute path on the machine running campaigns */
  appDir: string;
  /** docker-compose.yml exists */
  hasDocker: boolean;
  /** Browser gate can run (Playwright available) */
  hasPlaywright: boolean;
  /** Stack type for goal generation context */
  stackType: 'node' | 'python' | 'static' | 'react' | 'nextjs' | 'flask' | 'express' | 'unknown';
  /** App complexity level */
  complexity: 'minimal' | 'simple' | 'moderate' | 'complex';
  /** Known quirks for goal generation */
  notes?: string;
}

// =============================================================================
// GOAL GENERATION
// =============================================================================

export type GoalCategory =
  | 'css_change'
  | 'html_mutation'
  | 'route_addition'
  | 'http_behavior'
  | 'mixed_surface'
  | 'adversarial_predicate'
  | 'grounding_probe'
  | 'edge_case';

export type GoalDifficulty = 'trivial' | 'moderate' | 'hard' | 'adversarial';

export interface GeneratedGoal {
  /** Human-readable goal description */
  goal: string;
  /** Testable claims about end state */
  predicates: Predicate[];
  /** How hard this goal is expected to be */
  difficulty: GoalDifficulty;
  /** Which gate this is designed to stress (null = general) */
  targetGate: string | null;
  /** Goal category */
  category: GoalCategory;
}

// =============================================================================
// EDIT GENERATION
// =============================================================================

export interface GeneratedSubmission {
  /** The goal these edits serve */
  goal: GeneratedGoal;
  /** Search/replace edits */
  edits: Edit[];
  /** Predicates (may refine goal's predicates) */
  predicates: Predicate[];
  /** Whether these edits should pass or fail verify */
  expectedOutcome: 'pass' | 'fail' | 'unknown';
  /** LLM's reasoning for why this should pass/fail */
  reasoning: string;
}

// =============================================================================
// CROSS-CHECK
// =============================================================================

export interface CrossCheckConfig {
  /** Timeout per probe in ms */
  timeout: number;
  /** Enable health endpoint probe */
  health: boolean;
  /** Enable browser probe (Playwright) */
  browser: boolean;
  /** Enable HTTP endpoint probes */
  http: boolean;
}

export interface CrossCheckResult extends CrossCheckEvidence {
  /** Custom probes that ran */
  httpProbes?: Array<{
    path: string;
    method: string;
    status: number | null;
    passed: boolean;
    detail: string;
  }>;
}

// =============================================================================
// LLM PROVIDER
// =============================================================================

export type LLMProviderType = 'gemini' | 'anthropic' | 'ollama' | 'claude' | 'claude-code';

export interface LLMCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type LLMCallFn = (systemPrompt: string, userPrompt: string) => Promise<LLMCallResult>;

// =============================================================================
// CAMPAIGN CONFIG & RESULT
// =============================================================================

export interface CampaignConfig {
  /** Apps to test */
  apps: AppEntry[];
  /** Goals to generate per app */
  goalsPerApp: number;
  /** Focus categories (null = diverse) */
  categories?: GoalCategory[];
  /** LLM provider for goal/edit generation */
  llm: LLMCallFn;
  /** LLM provider name (for reporting) */
  llmName: LLMProviderType;
  /** Max concurrent verify() calls per app */
  maxConcurrent: number;
  /** USD budget cap for LLM calls */
  maxTotalCost: number;
  /** Generate goals + edits, don't run verify */
  dryRun: boolean;
  /** Run independent cross-check probes */
  crossCheckEnabled: boolean;
  /** State directory for constraint store + fault ledger */
  stateDir: string;
  /** Verbose logging */
  verbose: boolean;
}

export interface GoalResult {
  /** The generated goal */
  goal: GeneratedGoal;
  /** The generated submission (edits + predicates) */
  submission: GeneratedSubmission | null;
  /** Verify result (null if dry run or edit generation failed) */
  verifyResult: VerifyResult | null;
  /** Cross-check result (null if disabled or not applicable) */
  crossCheck: CrossCheckResult | null;
  /** Fault classification from ledger */
  faultId: string | null;
  /** LLM cost for this goal (goal gen + edit gen) */
  costUsd: number;
  /** Duration in ms */
  durationMs: number;
  /** Error if something went wrong outside verify */
  error?: string;
}

export interface AppResult {
  /** App name */
  app: string;
  /** Stack type */
  stackType: string;
  /** Goal results */
  goals: GoalResult[];
  /** Summary counts */
  passed: number;
  failed: number;
  faults: number;
  agentFaults: number;
  ambiguous: number;
  correct: number;
  /** Total LLM cost for this app */
  costUsd: number;
  /** Total duration */
  durationMs: number;
}

export interface CampaignResult {
  /** Unique run identifier */
  runId: string;
  /** ISO timestamp */
  startedAt: string;
  /** ISO timestamp */
  completedAt: string;
  /** Per-app results */
  apps: AppResult[];
  /** Total faults discovered (verify bugs) */
  totalFaults: number;
  /** Total LLM cost */
  totalCostUsd: number;
  /** Was this a dry run? */
  dryRun: boolean;
}

// =============================================================================
// MORNING REPORT
// =============================================================================

export interface MorningReport {
  runId: string;
  timestamp: string;
  /** One-liner for grep */
  summary: string;
  faults: {
    total: number;
    falsePositives: number;
    falseNegatives: number;
    badHints: number;
    ambiguous: number;
    agentFaults: number;
    correct: number;
  };
  perApp: Array<{
    app: string;
    stackType: string;
    goalsRun: number;
    faultsFound: number;
    worstFault: string;
  }>;
  costUsd: number;
  durationMin: number;
}
