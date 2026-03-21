/**
 * Campaign Module — Public API
 * ============================
 */

export { runCampaign } from './campaign-runner.js';
export { runCampaignCLI } from './campaign.js';
export { discoverApps, loadRegistry, saveRegistry, resolveApps } from './app-registry.js';
export { generateGoals } from './goal-generator.js';
export { generateEdits } from './edit-generator.js';
export { runCrossChecks } from './cross-check.js';
export { generateReport, saveReport, formatReport, loadLatestReport } from './report.js';
export {
  createClaudeProvider,
  CLAUDE_GOAL_SYSTEM,
  CLAUDE_EDIT_SYSTEM,
  CLAUDE_DIAGNOSIS_SYSTEM,
  CLAUDE_FIX_SYSTEM,
} from './claude-brain.js';
export {
  createClaudeCodeProvider,
  createClaudeCodeFileProvider,
} from './claude-code-brain.js';
export type { ClaudeCodeCallback } from './claude-code-brain.js';

export type {
  AppEntry,
  GoalCategory,
  GoalDifficulty,
  GeneratedGoal,
  GeneratedSubmission,
  CrossCheckConfig,
  CrossCheckResult,
  LLMProviderType,
  LLMCallFn,
  LLMCallResult,
  CampaignConfig,
  CampaignResult,
  AppResult,
  GoalResult,
  MorningReport,
} from './types.js';
