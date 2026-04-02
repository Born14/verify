/**
 * Concurrent Evaluation Types — Multi-Model Parallel Proof
 * =========================================================
 *
 * Prove verify helps frontier LLMs on SWE problems.
 * Run N tasks × M models × 2 paths (raw vs governed), all concurrently.
 *
 * The concurrent harness answers:
 *   1. Does verify improve success rate? (per model, aggregate)
 *   2. Is the improvement consistent across models? (cross-model signal)
 *   3. What's the cost? (token overhead, wall-clock time)
 *   4. Which failure modes does verify catch? (gate distribution)
 */

import type { BenchmarkTask, TaskComparison, BenchmarkSummary, LLMCallFn } from './types.js';

// =============================================================================
// CONCURRENCY CONFIG
// =============================================================================

export interface ConcurrentConfig {
  /** Task bank to evaluate */
  tasks: BenchmarkTask[];

  /** Models to evaluate concurrently */
  models: ModelSpec[];

  /** Max tasks running in parallel per model (default: 5) */
  concurrency: number;

  /** Max govern() attempts per task (default: 3) */
  maxGovAttempts: number;

  /** State directory for results */
  stateDir: string;

  /** Show per-task output */
  verbose: boolean;

  /** Skip Docker-dependent gates */
  skipDocker: boolean;

  /** Progress callback — fires after each task completes */
  onProgress?: (progress: EvalProgress) => void;
}

/** A model to evaluate */
export interface ModelSpec {
  /** Display name (e.g., "claude-sonnet-4-20250514") */
  name: string;
  /** Provider: gemini, claude, anthropic, ollama */
  provider: string;
  /** Model ID override */
  model?: string;
  /** API key (or from env) */
  apiKey?: string;
  /** LLM call function (built by createLLM) */
  llm?: LLMCallFn;
}

// =============================================================================
// PROGRESS TRACKING
// =============================================================================

export interface EvalProgress {
  /** Model being evaluated */
  modelName: string;
  /** Task just completed */
  taskId: string;
  /** Outcome */
  outcome: TaskComparison['verdict']['outcome'];
  /** Tasks completed for this model so far */
  completed: number;
  /** Total tasks for this model */
  total: number;
  /** Wall-clock elapsed (ms) */
  elapsedMs: number;
}

// =============================================================================
// PER-MODEL RESULTS
// =============================================================================

export interface ModelEvalResult {
  /** Model spec */
  model: ModelSpec;
  /** Per-task comparisons */
  comparisons: TaskComparison[];
  /** Aggregate stats */
  summary: BenchmarkSummary;
  /** Wall-clock time for this model's full eval */
  wallClockMs: number;
  /** Gate failure distribution (gate name → count of times it was the first failure) */
  gateFailureDistribution: Record<string, number>;
}

// =============================================================================
// CROSS-MODEL COMPARISON
// =============================================================================

export interface CrossModelResult {
  /** Per-model results */
  models: ModelEvalResult[];

  /** Cross-model aggregate: is verify consistently helpful? */
  crossModel: {
    /** Models where verify improved success rate */
    modelsImproved: string[];
    /** Models where verify regressed */
    modelsRegressed: string[];
    /** Models where verify was neutral */
    modelsNeutral: string[];

    /** Average improvement across all models */
    avgImprovementPercent: number;
    /** Median improvement */
    medianImprovementPercent: number;

    /** Per-task consensus: tasks where ALL models benefited from verify */
    unanimousSaves: string[];
    /** Per-task consensus: tasks where ALL models regressed with verify */
    unanimousRegressions: string[];

    /** Statistical signal: is improvement consistent? */
    consistencyScore: number;  // 0-1, higher = more consistent across models
  };

  /** Overall verdict */
  verdict: 'verify_helps' | 'inconclusive' | 'verify_hurts';
  /** One-line summary */
  headline: string;
}

// =============================================================================
// FULL EVAL RUN
// =============================================================================

export interface ConcurrentEvalRun {
  /** Run ID */
  runId: string;
  /** Start time */
  startedAt: string;
  /** End time */
  completedAt: string;
  /** Concurrency level used */
  concurrency: number;
  /** Total wall-clock time (ms) */
  totalWallClockMs: number;

  /** Results */
  results: CrossModelResult;

  /** Task bank used */
  taskCount: number;
  /** Models evaluated */
  modelCount: number;
}
