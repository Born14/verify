#!/usr/bin/env node
/**
 * @sovereign-labs/verify MCP Server
 * ==================================
 *
 * Exposes verify as MCP tools that any coding agent can call.
 * Three tools:
 *
 *   verify_ground  — Read grounding context (CSS, HTML, routes) before crafting edits
 *   verify_read    — Read a source file from the app directory
 *   verify_submit  — Submit edits + predicates through the verification pipeline
 *
 * Usage:
 *   Add to your MCP client config:
 *   {
 *     "mcpServers": {
 *       "verify": {
 *         "command": "npx",
 *         "args": ["@sovereign-labs/verify", "mcp"]
 *       }
 *     }
 *   }
 */

import { createInterface } from 'readline';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { verify } from './verify.js';
import { groundInReality, clearGroundingCache } from './gates/grounding.js';
import { FaultLedger } from './store/fault-ledger.js';
import { ExternalScenarioStore, classifyTransferability, classifyCategory } from './store/external-scenarios.js';
import type { ScenarioIntent, ScenarioCategory } from './store/external-scenarios.js';
import type { Edit, Predicate, VerifyConfig, GroundingContext } from './types.js';

// Improve loop imports (lazy-loaded to avoid pulling in heavy deps when not needed)
let _improveModules: {
  runSelfTest: any;
  bundleViolations: any;
  isEditAllowed: any;
  BOUNDED_SURFACE: any;
  splitScenarios: any;
  validateCandidate: any;
  runHoldout: any;
  createLLMProvider: any;
  diagnoseBundleWithLLM: any;
  generateFixCandidates: any;
  diagnoseWithClaude: any;
  generateFixesWithClaude: any;
  RELATED_FILES: Record<string, string[]>;
} | null = null;

async function getImproveModules() {
  if (_improveModules) return _improveModules;
  const [runner, triage, subprocess, llmProviders, prompts, claudePrompts] = await Promise.all([
    import('../scripts/harness/runner.js'),
    import('../scripts/harness/improve-triage.js'),
    import('../scripts/harness/improve-subprocess.js'),
    import('../scripts/harness/llm-providers.js'),
    import('../scripts/harness/improve-prompts.js'),
    import('../scripts/harness/claude-improve.js'),
  ]);
  _improveModules = {
    runSelfTest: runner.runSelfTest,
    bundleViolations: triage.bundleViolations,
    isEditAllowed: triage.isEditAllowed,
    BOUNDED_SURFACE: triage.BOUNDED_SURFACE,
    splitScenarios: subprocess.splitScenarios,
    validateCandidate: subprocess.validateCandidate,
    runHoldout: subprocess.runHoldout,
    createLLMProvider: llmProviders.createLLMProvider,
    diagnoseBundleWithLLM: prompts.diagnoseBundleWithLLM,
    generateFixCandidates: prompts.generateFixCandidates,
    diagnoseWithClaude: claudePrompts.diagnoseWithClaude,
    generateFixesWithClaude: claudePrompts.generateFixesWithClaude,
    RELATED_FILES: claudePrompts.RELATED_FILES,
  };
  return _improveModules;
}

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

// MCP protocol types
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

const SERVER_INFO = {
  name: '@sovereign-labs/verify',
  version: '0.1.0',
};

const CAPABILITIES = {
  tools: {},
};

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const TOOLS: Tool[] = [
  {
    name: 'verify_ground',
    description: '[READ-ONLY] Scan the app source code and return grounding context: CSS selectors with properties and values, HTML elements, available routes. Use this BEFORE crafting edits to understand what actually exists in the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory to scan. Defaults to current directory.',
        },
      },
    },
  },
  {
    name: 'verify_read',
    description: '[READ-ONLY] Read a source file from the app directory. Use this to get exact file contents before crafting search/replace edits.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        file: {
          type: 'string',
          description: 'Relative path to the file within the app directory.',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'verify_submit',
    description: '[MUTATION] Submit code edits and predicates through the verification pipeline. Edits are applied to a staging container, validated against predicates, and checked for system health. Returns success/failure with narrowing hints on what to try next if it fails.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        goal: {
          type: 'string',
          description: 'Human-readable description of what the edits accomplish.',
        },
        edits: {
          type: 'array',
          description: 'Array of file edits. Each edit has file (relative path), search (exact string to find), and replace (replacement string).',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Relative file path' },
              search: { type: 'string', description: 'Exact string to find (must appear exactly once)' },
              replace: { type: 'string', description: 'Replacement string' },
            },
            required: ['file', 'search', 'replace'],
          },
        },
        predicates: {
          type: 'array',
          description: 'Testable claims about the end state. Types: css (selector + property + expected value), html (selector exists or has text), content (file contains pattern), http (endpoint returns expected response), http_sequence (ordered multi-step flow).',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['css', 'html', 'content', 'db', 'http', 'http_sequence'] },
              selector: { type: 'string' },
              property: { type: 'string' },
              expected: { type: 'string' },
              path: { type: 'string' },
              file: { type: 'string' },
              description: { type: 'string' },
              pattern: { type: 'string' },
              method: { type: 'string' },
              body: { type: 'object' },
              expect: { type: 'object' },
              steps: { type: 'array' },
            },
            required: ['type'],
          },
        },
        overrideConstraints: {
          type: 'array',
          description: 'Optional: constraint signatures to override (bypass learned restrictions).',
          items: { type: 'string' },
        },
      },
      required: ['edits', 'predicates'],
    },
  },
  // =========================================================================
  // CAMPAIGN TOOLS — Claude Code drives the loop
  // =========================================================================
  {
    name: 'verify_campaign_ground',
    description: '[READ-ONLY] Ground an app for campaign goal generation. Returns detailed context including CSS rules, HTML elements, routes, file structure, and known constraints. Use this to understand the app before generating test goals.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        stateDir: {
          type: 'string',
          description: 'State directory for constraints/faults. Defaults to {appDir}/.verify',
        },
      },
    },
  },
  {
    name: 'verify_campaign_run_goal',
    description: '[MUTATION] Run a single campaign goal: apply edits, run verify(), record results to fault ledger. Claude Code generates the goal + edits + predicates, this tool executes the mechanical verification. Returns verify result with fault classification.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        goal: {
          type: 'string',
          description: 'Human-readable goal description.',
        },
        edits: {
          type: 'array',
          description: 'Search/replace edits.',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              search: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['file', 'search', 'replace'],
          },
        },
        predicates: {
          type: 'array',
          description: 'Testable claims about end state.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['css', 'html', 'content', 'db', 'http', 'http_sequence'] },
              selector: { type: 'string' },
              property: { type: 'string' },
              expected: { type: 'string' },
              path: { type: 'string' },
              file: { type: 'string' },
              description: { type: 'string' },
              pattern: { type: 'string' },
              method: { type: 'string' },
              body: { type: 'object' },
              expect: { type: 'object' },
              steps: { type: 'array' },
            },
            required: ['type'],
          },
        },
        expectedOutcome: {
          type: 'string',
          enum: ['pass', 'fail', 'unknown'],
          description: 'Whether this goal is expected to pass or fail verify. Used for fault classification.',
        },
        category: {
          type: 'string',
          enum: ['css_change', 'html_mutation', 'route_addition', 'http_behavior', 'mixed_surface', 'adversarial_predicate', 'grounding_probe', 'edge_case'],
          description: 'Goal category for the fault ledger.',
        },
        difficulty: {
          type: 'string',
          enum: ['trivial', 'moderate', 'hard', 'adversarial'],
          description: 'Goal difficulty rating.',
        },
        stateDir: {
          type: 'string',
          description: 'State directory for constraints/faults. Defaults to {appDir}/.verify',
        },
        docker: {
          type: 'boolean',
          description: 'Enable Docker staging. Defaults to true if docker-compose.yml exists.',
        },
        overrideConstraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraint signatures to override.',
        },
      },
      required: ['goal', 'edits', 'predicates'],
    },
  },
  {
    name: 'verify_campaign_faults',
    description: '[READ-ONLY] Read the fault ledger — all discovered verify bugs from campaign runs. Returns fault entries with classification (false_positive, false_negative, bad_hint, agent_fault, correct).',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        stateDir: {
          type: 'string',
          description: 'State directory. Defaults to {appDir}/.verify',
        },
        classification: {
          type: 'string',
          enum: ['false_positive', 'false_negative', 'bad_hint', 'agent_fault', 'ambiguous', 'correct'],
          description: 'Filter by classification.',
        },
      },
    },
  },
  {
    name: 'verify_campaign_encode',
    description: '[MUTATION] Encode a fault ledger entry as a permanent self-test scenario. This closes the loop: campaign discovers a fault → encode it → the improve loop guards against it forever. The scenario is stored in .verify/custom-scenarios.json and automatically loaded by the self-test runner.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory.',
        },
        stateDir: {
          type: 'string',
          description: 'State directory. Defaults to {appDir}/.verify',
        },
        faultId: {
          type: 'string',
          description: 'Fault ledger entry ID to encode (from verify_campaign_faults). If provided, edits/predicates/intent are derived from the fault.',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this scenario tests.',
        },
        intent: {
          type: 'string',
          enum: ['false_positive', 'false_negative', 'bad_hint', 'regression_guard'],
          description: 'What verify behavior this scenario tests. false_positive = verify should FAIL (was wrongly passing). false_negative = verify should PASS (was wrongly failing). bad_hint = narrowing was misleading. regression_guard = general regression test.',
        },
        expectedSuccess: {
          type: 'boolean',
          description: 'Whether verify should succeed. Derived from intent if not provided (false_positive → false, false_negative → true).',
        },
        edits: {
          type: 'array',
          description: 'Edits for the scenario (optional if faultId provided — uses the original submission edits).',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              search: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['file', 'search', 'replace'],
          },
        },
        predicates: {
          type: 'array',
          description: 'Predicates for the scenario (optional if faultId provided).',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              selector: { type: 'string' },
              property: { type: 'string' },
              expected: { type: 'string' },
              path: { type: 'string' },
              file: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['type'],
          },
        },
        expectedFailedGate: {
          type: 'string',
          description: 'For false_positive scenarios: which gate should catch the problem.',
        },
        requiresDocker: {
          type: 'boolean',
          description: 'Whether this scenario needs Docker. Defaults to false.',
        },
        rationale: {
          type: 'string',
          description: 'Why this scenario exists — the story of the fault it guards against.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering (e.g., css, grounding, browser-gate).',
        },
        transferability: {
          type: 'string',
          enum: ['universal', 'framework', 'app_specific'],
          description: 'How transferable is this scenario? universal = verify gate bug (any app). framework = pattern-specific (e.g., Express inline HTML). app_specific = unique to this app. Auto-classified if not provided.',
        },
        category: {
          type: 'string',
          enum: ['grounding', 'containment', 'constraints', 'staging', 'syntax', 'sequencing', 'evidence', 'narrowing'],
          description: 'Which verify subsystem this tests. Auto-classified from expectedFailedGate if not provided.',
        },
      },
      required: ['description', 'intent'],
    },
  },
  // =========================================================================
  // IMPROVE TOOLS — Claude Code IS the doctor
  // =========================================================================
  {
    name: 'verify_improve_discover',
    description: '[READ-ONLY] Run the self-test baseline and return all violations with triage evidence. This is Step 1 of the improve loop — you get the failure evidence, then YOU reason about root cause and craft fixes. Returns: violation bundles grouped by root cause, each with triage (target file, confidence), source code excerpts for the target functions, and the bounded edit surface (which files you can modify). Use verify_improve_read to inspect target files, then verify_improve_submit to submit your fix.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app under test. Defaults to fixtures/demo-app. Use the same app you ran the campaign against.',
        },
        families: {
          type: 'string',
          description: 'Comma-separated scenario families to test (e.g., "A,B,G"). Defaults to all.',
        },
      },
    },
  },
  {
    name: 'verify_improve_read',
    description: '[READ-ONLY] Read a verify pipeline source file for inspection during improvement diagnosis. Path is relative to the verify package root (e.g., "src/gates/grounding.ts", "src/store/constraint-store.ts"). Only files in the bounded edit surface can be modified, but any file can be read for understanding.',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Relative path within the verify package (e.g., "src/gates/grounding.ts").',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'verify_improve_submit',
    description: '[MUTATION] Submit your diagnosis and fix edits for validation. The harness will: (1) apply your edits to an isolated copy, (2) run the full self-test suite, (3) compare dirty→clean improvements and clean→dirty regressions, (4) run holdout check for overfitting. Returns: per-scenario results, score, and verdict (accepted/rejected_regression/rejected_overfitting/rejected_no_fix). You can submit multiple fix strategies — the best one wins.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app under test. Must match the appDir used in verify_improve_discover.',
        },
        bundleId: {
          type: 'string',
          description: 'The evidence bundle ID from verify_improve_discover (e.g., "bundle_1").',
        },
        diagnosis: {
          type: 'string',
          description: 'Your diagnosis of the root cause. Will be recorded in the improvement ledger.',
        },
        fixes: {
          type: 'array',
          description: 'One or more fix strategies to test. The harness validates each in isolation and picks the best.',
          items: {
            type: 'object',
            properties: {
              strategy: { type: 'string', description: 'Short name for this approach' },
              rationale: { type: 'string', description: 'Why this fix works' },
              edits: {
                type: 'array',
                description: 'Search/replace edits to apply.',
                items: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', description: 'Relative path (e.g., "src/gates/grounding.ts")' },
                    search: { type: 'string', description: 'Exact string to find (must appear exactly once)' },
                    replace: { type: 'string', description: 'Replacement string' },
                  },
                  required: ['file', 'search', 'replace'],
                },
              },
            },
            required: ['strategy', 'edits'],
          },
        },
        families: {
          type: 'string',
          description: 'Families to test against (defaults to same as discover).',
        },
      },
      required: ['bundleId', 'diagnosis', 'fixes'],
    },
  },
  {
    name: 'verify_improve_diagnose',
    description: '[READ-ONLY] Get structured diagnosis context for an evidence bundle. Returns: target file source, architecturally coupled files, invariant contracts, violation evidence. YOU reason about root cause from this context — no LLM call needed. Use after verify_improve_discover, before crafting fixes for verify_improve_submit.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: {
          type: 'string',
          description: 'Bundle ID from verify_improve_discover (e.g., "bundle_1").',
        },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'verify_improve_apply',
    description: '[MUTATION] Apply winning fix edits to the real verify source files and revalidate. Only files in the bounded edit surface can be modified. Re-runs the self-test baseline to confirm the fix. Use after verify_improve_submit returns ACCEPTED.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'The winning edits from verify_improve_submit.',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Relative path (e.g., "src/gates/grounding.ts")' },
              search: { type: 'string', description: 'Exact string to find' },
              replace: { type: 'string', description: 'Replacement string' },
            },
            required: ['file', 'search', 'replace'],
          },
        },
        revalidate: {
          type: 'boolean',
          description: 'Re-run baseline after applying to confirm fix. Default: true.',
        },
        families: {
          type: 'string',
          description: 'Families to revalidate against (defaults to same as discover).',
        },
      },
      required: ['edits'],
    },
  },
  {
    name: 'verify_improve_cycle',
    description: '[MUTATION] Run the full improve loop with an API-based LLM (Gemini, Anthropic) for diagnosis and fix generation. This is the FALLBACK when Claude Code cannot drive the loop directly — it spawns the entire pipeline as a batch operation. Prefer verify_improve_discover + verify_improve_submit for interactive improvement where YOU are the doctor.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app under test. Defaults to fixtures/demo-app.',
        },
        llm: {
          type: 'string',
          enum: ['gemini', 'anthropic', 'ollama', 'none'],
          description: 'LLM provider for diagnosis/fix generation. Required for non-mechanical bundles.',
        },
        apiKey: {
          type: 'string',
          description: 'API key for the chosen LLM provider.',
        },
        families: {
          type: 'string',
          description: 'Comma-separated scenario families (defaults to all).',
        },
        maxCandidates: {
          type: 'number',
          description: 'Max fix candidates per bundle (default: 3).',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, run baseline + triage only (no subprocess validation).',
        },
      },
      required: ['llm'],
    },
  },
  // =========================================================================
  // CHAOS ENGINE — Autonomous stress-testing loop
  // =========================================================================
  {
    name: 'verify_chaos_plan',
    description: '[READ-ONLY] Plan a chaos campaign against any Sovereign-hosted app. Reads grounding context (CSS, HTML, routes, DB schema) and returns structured reconnaissance: available selectors with properties, HTML elements, route map, DB tables, known constraints, and fault history. Also returns a goal generation template for each category. YOU generate the actual goals from this context — the tool provides the raw material.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory (REQUIRED — no default). Any Sovereign-hosted app.',
        },
        count: {
          type: 'number',
          description: 'Number of goals to generate (default: 10). The tool returns enough context for this many diverse goals.',
        },
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['css_change', 'html_mutation', 'content_change', 'http_behavior', 'db_schema', 'adversarial_predicate', 'mixed_surface', 'grounding_probe'],
          },
          description: 'Filter to specific goal categories. Default: all applicable (db_schema only if DB detected).',
        },
        stateDir: {
          type: 'string',
          description: 'State directory for constraints/faults. Defaults to {appDir}/.verify',
        },
      },
      required: ['appDir'],
    },
  },
  {
    name: 'verify_chaos_run',
    description: '[MUTATION] Execute a batch of chaos goals against verify. Each goal is run through the full pipeline (edits applied, gates checked, faults classified). Returns per-goal results with fault classification and a campaign summary. Goals that expose verify bugs are flagged for encoding.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory (REQUIRED).',
        },
        goals: {
          type: 'array',
          description: 'Array of goals to execute. Each goal has: goal (description), edits, predicates, expectedOutcome (pass/fail), category, difficulty.',
          items: {
            type: 'object',
            properties: {
              goal: { type: 'string', description: 'Goal description' },
              edits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    file: { type: 'string' },
                    search: { type: 'string' },
                    replace: { type: 'string' },
                  },
                  required: ['file', 'search', 'replace'],
                },
              },
              predicates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['css', 'html', 'content', 'db', 'http', 'http_sequence'] },
                    selector: { type: 'string' },
                    property: { type: 'string' },
                    expected: { type: 'string' },
                    path: { type: 'string' },
                    file: { type: 'string' },
                    pattern: { type: 'string' },
                    method: { type: 'string' },
                    body: { type: 'object' },
                    expect: { type: 'object' },
                    steps: { type: 'array' },
                  },
                  required: ['type'],
                },
              },
              expectedOutcome: {
                type: 'string',
                enum: ['pass', 'fail'],
                description: 'Whether this goal should pass or fail verify.',
              },
              category: {
                type: 'string',
                enum: ['css_change', 'html_mutation', 'content_change', 'http_behavior', 'db_schema', 'adversarial_predicate', 'mixed_surface', 'grounding_probe'],
              },
              difficulty: {
                type: 'string',
                enum: ['trivial', 'moderate', 'hard', 'adversarial'],
              },
            },
            required: ['goal', 'edits', 'predicates', 'expectedOutcome'],
          },
        },
        stateDir: {
          type: 'string',
          description: 'State directory. Defaults to {appDir}/.verify',
        },
        docker: {
          type: 'boolean',
          description: 'Enable Docker staging. Defaults to true if docker-compose.yml exists.',
        },
      },
      required: ['appDir', 'goals'],
    },
  },
  {
    name: 'verify_chaos_encode',
    description: '[MUTATION] Batch-encode chaos run faults as permanent self-test scenarios. Takes fault IDs from a chaos run and encodes each as a scenario in custom-scenarios.json. The improve loop will guard against these faults forever. Only encodes verify bugs (false_positive, false_negative, bad_hint) — skips correct/agent_fault entries. Uses session cache from verify_chaos_run when available. For cross-session encoding, provide goals array as fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: {
          type: 'string',
          description: 'Path to the app directory (REQUIRED).',
        },
        faultIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fault IDs to encode (from verify_chaos_run results). If empty, encodes ALL unencoded verify bugs.',
        },
        goals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              faultId: { type: 'string', description: 'Fault ID to associate this goal data with' },
              edits: { type: 'array', items: { type: 'object' }, description: 'Original edits from the chaos goal' },
              predicates: { type: 'array', items: { type: 'object' }, description: 'Original predicates from the chaos goal' },
              category: { type: 'string' },
              difficulty: { type: 'string' },
            },
            required: ['faultId', 'edits', 'predicates'],
          },
          description: 'Fallback: provide original goal data for faults when session cache is cold (cross-session encoding). Each entry maps a faultId to its original edits/predicates.',
        },
        stateDir: {
          type: 'string',
          description: 'State directory. Defaults to {appDir}/.verify',
        },
      },
      required: ['appDir'],
    },
  },
];

// =============================================================================
// TOOL HANDLERS
// =============================================================================

async function handleToolCall(name: string, args: any): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'verify_ground':
      return handleGround(args);
    case 'verify_read':
      return handleRead(args);
    case 'verify_submit':
      return handleSubmit(args);
    case 'verify_campaign_ground':
      return handleCampaignGround(args);
    case 'verify_campaign_run_goal':
      return await handleCampaignRunGoal(args);
    case 'verify_campaign_faults':
      return handleCampaignFaults(args);
    case 'verify_campaign_encode':
      return handleCampaignEncode(args);
    case 'verify_improve_discover':
      return await handleImproveDiscover(args);
    case 'verify_improve_read':
      return handleImproveRead(args);
    case 'verify_improve_submit':
      return await handleImproveSubmit(args);
    case 'verify_improve_diagnose':
      return await handleImproveDiagnose(args);
    case 'verify_improve_apply':
      return await handleImproveApply(args);
    case 'verify_improve_cycle':
      return await handleImproveCycle(args);
    case 'verify_chaos_plan':
      return handleChaosPlan(args);
    case 'verify_chaos_run':
      return await handleChaosRun(args);
    case 'verify_chaos_encode':
      return handleChaosEncode(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleGround(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  const grounding = groundInReality(appDir);

  const sections: string[] = [];

  // Routes
  if (grounding.routes.length > 0) {
    sections.push(`Routes:\n${grounding.routes.map(r => `  ${r}`).join('\n')}`);
  }

  // CSS
  for (const [route, rules] of grounding.routeCSSMap) {
    if (rules.size === 0) continue;
    const lines = [...rules.entries()].map(([sel, props]) => {
      const propStr = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('; ');
      return `  ${sel} { ${propStr} }`;
    });
    sections.push(`CSS (${route}):\n${lines.join('\n')}`);
  }

  // HTML
  for (const [route, elements] of grounding.htmlElements) {
    if (elements.length === 0) continue;
    const lines = elements.slice(0, 30).map(el => {
      const attrs = el.attributes ? ` ${Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`).join(' ')}` : '';
      return `  <${el.tag}${attrs}>${el.text ?? ''}</${el.tag}>`;
    });
    sections.push(`HTML (${route}):\n${lines.join('\n')}`);
  }

  return text(sections.join('\n\n') || 'No grounding context found. Check that the app directory contains source files.');
}

function handleRead(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());
  const filePath = join(appDir, args.file);

  if (!existsSync(filePath)) {
    return text(`File not found: ${args.file}`);
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return text(content);
  } catch (err: any) {
    return text(`Error reading file: ${err.message}`);
  }
}

async function handleSubmit(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  const edits: Edit[] = args.edits ?? [];
  const predicates: Predicate[] = args.predicates ?? [];

  if (edits.length === 0) {
    return text('No edits provided.');
  }
  if (predicates.length === 0) {
    return text('No predicates provided. At least one predicate is required.');
  }

  const logs: string[] = [];
  const config: VerifyConfig = {
    appDir,
    goal: args.goal,
    docker: { compose: true },
    stateDir: join(appDir, '.verify'),
    overrideConstraints: args.overrideConstraints,
    log: (msg: string) => logs.push(msg),
  };

  const result = await verify(edits, predicates, config);

  // Format response
  const sections: string[] = [];

  sections.push(result.attestation);

  if (result.success) {
    sections.push(`\nAll gates passed. Edits are verified.`);
  } else {
    if (result.narrowing?.resolutionHint) {
      sections.push(`\nResolution: ${result.narrowing.resolutionHint}`);
    }
    if (result.narrowing?.patternRecall && result.narrowing.patternRecall.length > 0) {
      sections.push(`\nKnown fixes:\n${result.narrowing.patternRecall.map(f => `  - ${f}`).join('\n')}`);
    }
    if (result.narrowing?.bannedFingerprints && result.narrowing.bannedFingerprints.length > 0) {
      sections.push(`\nBanned predicates (failed before):\n${result.narrowing.bannedFingerprints.map(f => `  - ${f}`).join('\n')}`);
    }
    if (result.effectivePredicates && result.effectivePredicates.length > 0) {
      sections.push(`\nEffective predicates:\n${result.effectivePredicates.map(p =>
        `  ${p.id}: [${p.type}] ${p.description ?? p.fingerprint}${p.groundingMiss ? ' (ungrounded)' : ''}`
      ).join('\n')}`);
    }
  }

  sections.push(`\nTiming: ${result.timing.totalMs}ms total`);

  return text(sections.join('\n'));
}

// =============================================================================
// CAMPAIGN TOOL HANDLERS
// =============================================================================

async function handleCampaignGround(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  const grounding = groundInReality(appDir);
  const sections: string[] = [];

  // App structure
  sections.push(`App Directory: ${appDir}`);
  sections.push(`State Directory: ${stateDir}`);

  // Routes
  if (grounding.routes.length > 0) {
    sections.push(`\nRoutes (${grounding.routes.length}):\n${grounding.routes.map(r => `  ${r}`).join('\n')}`);
  }

  // CSS — grouped by route
  for (const [route, rules] of grounding.routeCSSMap) {
    if (rules.size === 0) continue;
    const lines = [...rules.entries()].map(([sel, props]) => {
      const propStr = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('; ');
      return `  ${sel} { ${propStr} }`;
    });
    sections.push(`\nCSS (${route}):\n${lines.join('\n')}`);
  }

  // HTML
  for (const [route, elements] of grounding.htmlElements) {
    if (elements.length === 0) continue;
    const lines = elements.slice(0, 50).map(el => {
      const attrs = el.attributes ? ` ${Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`).join(' ')}` : '';
      return `  <${el.tag}${attrs}>${el.text ?? ''}</${el.tag}>`;
    });
    sections.push(`\nHTML (${route}):\n${lines.join('\n')}`);
  }

  // Existing constraints (via ConstraintStore for JSONL support)
  try {
    const { ConstraintStore } = await import('./store/constraint-store.js');
    const store = new ConstraintStore(stateDir);
    const constraints = store.getConstraints();
    if (constraints.length > 0) {
      sections.push(`\nActive K5 Constraints (${constraints.length}):`);
      for (const c of constraints) {
        sections.push(`  [${c.type}] ${c.signature}: ${c.reason}`);
      }
    }
  } catch { /* ignore load errors */ }

  // Existing faults
  const faultPath = join(stateDir, 'faults.jsonl');
  if (existsSync(faultPath)) {
    try {
      const lines = readFileSync(faultPath, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        sections.push(`\nFault Ledger: ${lines.length} entries`);
        // Show last 5
        const recent = lines.slice(-5).map(l => {
          try {
            const e = JSON.parse(l);
            return `  ${e.id}: ${e.classification} — ${e.goal?.slice(0, 60) ?? ''}`;
          } catch { return null; }
        }).filter(Boolean);
        if (recent.length > 0) {
          sections.push(`Recent:\n${recent.join('\n')}`);
        }
      }
    } catch { /* ignore */ }
  }

  sections.push(`\n--- Campaign Context ---`);
  sections.push(`You are Claude Code acting as the brain for verify's autonomous testing campaign.`);
  sections.push(`Your job: generate goals (edits + predicates) that stress-test the verification pipeline.`);
  sections.push(`Use verify_campaign_run_goal to submit each goal for execution.`);
  sections.push(`Use verify_campaign_faults to review what bugs you've found.`);
  sections.push(`\nKnown gate fragilities to exploit:`);
  sections.push(`  - CSS shorthand vs longhand (border: 1px solid black → border-width, border-style, border-color)`);
  sections.push(`  - Data-dependent selectors (elements only rendered with DB data)`);
  sections.push(`  - Multi-definition CSS (same selector in multiple <style> blocks)`);
  sections.push(`  - Cross-route style bleeding (predicates without path field)`);
  sections.push(`  - Browser computed style vs source value (rgb() vs named colors)`);

  return text(sections.join('\n'));
}

async function handleCampaignRunGoal(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  mkdirSync(stateDir, { recursive: true });

  const edits: Edit[] = args.edits ?? [];
  const predicates: Predicate[] = args.predicates ?? [];

  if (edits.length === 0) return text('No edits provided.');
  if (predicates.length === 0) return text('No predicates provided.');

  // Detect Docker
  const hasDocker = args.docker ?? existsSync(join(appDir, 'docker-compose.yml'));

  const config: VerifyConfig = {
    appDir,
    goal: args.goal,
    docker: hasDocker ? {
      composefile: join(appDir, 'docker-compose.yml'),
      startupTimeoutMs: 30_000,
      buildTimeoutMs: 120_000,
    } : undefined,
    stateDir,
    overrideConstraints: args.overrideConstraints,
    gates: {
      syntax: true,
      constraints: true,
      containment: true,
      staging: hasDocker,
      browser: hasDocker,
      http: hasDocker,
      invariants: hasDocker,
      vision: false,
    },
  };

  let verifyResult;
  try {
    verifyResult = await verify(edits, predicates, config);
  } catch (err: any) {
    return text(`verify() threw: ${err.message}`);
  }

  // Record to fault ledger
  const ledger = new FaultLedger(join(stateDir, 'faults.jsonl'));
  const faultEntry = ledger.recordFromResult(verifyResult, {
    app: appDir.split('/').pop() ?? 'unknown',
    goal: args.goal,
    predicates,
    crossCheck: undefined,
  });

  // Format response
  const sections: string[] = [];
  sections.push(verifyResult.attestation);

  if (verifyResult.success) {
    sections.push(`\nAll gates passed.`);
  } else {
    if (verifyResult.narrowing?.resolutionHint) {
      sections.push(`\nResolution: ${verifyResult.narrowing.resolutionHint}`);
    }
    if (verifyResult.narrowing?.patternRecall && verifyResult.narrowing.patternRecall.length > 0) {
      sections.push(`\nKnown fixes:\n${verifyResult.narrowing.patternRecall.map(f => `  - ${f}`).join('\n')}`);
    }
    if (verifyResult.narrowing?.bannedFingerprints && verifyResult.narrowing.bannedFingerprints.length > 0) {
      sections.push(`\nBanned predicates:\n${verifyResult.narrowing.bannedFingerprints.map(f => `  - ${f}`).join('\n')}`);
    }
    if (verifyResult.effectivePredicates && verifyResult.effectivePredicates.length > 0) {
      sections.push(`\nEffective predicates:\n${verifyResult.effectivePredicates.map(p =>
        `  ${p.id}: [${p.type}] ${p.description ?? p.fingerprint}${p.groundingMiss ? ' (ungrounded)' : ''}`
      ).join('\n')}`);
    }
  }

  // Fault classification
  if (faultEntry) {
    sections.push(`\nFault: ${faultEntry.id} (${faultEntry.classification}, confidence: ${faultEntry.confidence})`);
    if (faultEntry.classification !== 'correct' && faultEntry.classification !== 'agent_fault') {
      sections.push(`This is a VERIFY BUG. The pipeline got it wrong.`);
    }
  }

  // Metadata
  sections.push(`\nCategory: ${args.category ?? 'unknown'}`);
  sections.push(`Difficulty: ${args.difficulty ?? 'unknown'}`);
  sections.push(`Expected: ${args.expectedOutcome ?? 'unknown'}`);
  sections.push(`Actual: ${verifyResult.success ? 'pass' : 'fail'}`);
  sections.push(`Duration: ${verifyResult.timing.totalMs}ms`);

  return text(sections.join('\n'));
}

function handleCampaignFaults(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));
  const faultPath = join(stateDir, 'faults.jsonl');

  if (!existsSync(faultPath)) {
    return text('No fault ledger found. Run some campaign goals first.');
  }

  const lines = readFileSync(faultPath, 'utf-8').split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    return text('Fault ledger is empty.');
  }

  let entries = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  // Filter by classification if requested
  if (args.classification) {
    entries = entries.filter((e: any) => e.classification === args.classification);
  }

  const sections: string[] = [];
  sections.push(`Fault Ledger: ${entries.length} entries${args.classification ? ` (filtered: ${args.classification})` : ''}`);
  sections.push('');

  // Summary
  const byClass: Record<string, number> = {};
  for (const e of entries) {
    byClass[e.classification] = (byClass[e.classification] ?? 0) + 1;
  }
  sections.push('Classification summary:');
  for (const [cls, count] of Object.entries(byClass)) {
    const icon = cls === 'correct' ? '  ✓' : cls === 'agent_fault' ? '  ⚠' : '  🐛';
    sections.push(`${icon} ${cls}: ${count}`);
  }
  sections.push('');

  // Individual entries (last 20)
  const recent = entries.slice(-20);
  for (const e of recent) {
    sections.push(`[${e.id}] ${e.classification} (${e.confidence})`);
    if (e.goal) sections.push(`  Goal: ${e.goal.slice(0, 80)}`);
    if (e.failedGate) sections.push(`  Failed gate: ${e.failedGate}`);
    if (e.evidence) sections.push(`  Evidence: ${e.evidence.slice(0, 100)}`);
    sections.push('');
  }

  return text(sections.join('\n'));
}

function handleCampaignEncode(args: any) {
  const appDir = resolve(args.appDir ?? process.cwd());
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));
  const registryPath = join(stateDir, 'custom-scenarios.json');
  const intent = args.intent as ScenarioIntent;

  // Derive expectedSuccess from intent if not provided
  const expectedSuccess = args.expectedSuccess ?? (intent === 'false_negative' || intent === 'regression_guard');

  let edits: Edit[] = args.edits ?? [];
  let predicates: Predicate[] = args.predicates ?? [];
  let description = args.description;
  let rationale = args.rationale ?? '';
  let faultId = args.faultId ?? null;

  // If faultId provided, try to enrich from the fault ledger
  if (faultId) {
    const faultPath = join(stateDir, 'faults.jsonl');
    if (existsSync(faultPath)) {
      const ledger = new FaultLedger(faultPath);
      const allFaults = ledger.all();
      const fault = allFaults.find(f => f.id === faultId);

      if (!fault) {
        return text(`Fault not found: ${faultId}`);
      }

      // Auto-generate rationale from fault if not provided
      if (!rationale) {
        rationale = `Derived from fault ${faultId} (${fault.classification}): ${fault.reason}`;
      }

      // Append fault context to description
      if (fault.goal) {
        description = description || `Guard: ${fault.goal}`;
      }
    }
  }

  if (edits.length === 0 && predicates.length === 0) {
    return text('Either provide edits+predicates directly or provide a faultId with the original submission data. At minimum, predicates are needed to create a meaningful scenario.');
  }

  // Create the scenario
  const store = new ExternalScenarioStore(registryPath);
  const partialScenario = {
    description,
    faultId,
    intent,
    expectedSuccess,
    edits,
    predicates,
    requiresDocker: args.requiresDocker ?? false,
    expectedFailedGate: args.expectedFailedGate,
    rationale,
    tags: args.tags,
  };

  // Use caller-provided classification or auto-classify
  const transferability = args.transferability ?? classifyTransferability(partialScenario);
  const category = args.category ?? classifyCategory(partialScenario);

  const scenario = store.add({
    ...partialScenario,
    transferability,
    category,
  });

  // Link scenario back to fault ledger
  if (faultId) {
    const faultPath = join(stateDir, 'faults.jsonl');
    if (existsSync(faultPath)) {
      const ledger = new FaultLedger(faultPath);
      ledger.linkScenario(faultId, scenario.id);
    }
  }

  const sections: string[] = [];
  sections.push(`Scenario encoded: ${scenario.id}`);
  sections.push(`  Description: ${scenario.description}`);
  sections.push(`  Intent: ${scenario.intent}`);
  sections.push(`  Expected: ${scenario.expectedSuccess ? 'PASS' : 'FAIL'}`);
  sections.push(`  Edits: ${scenario.edits.length}`);
  sections.push(`  Predicates: ${scenario.predicates.length}`);
  sections.push(`  Docker: ${scenario.requiresDocker}`);
  if (scenario.expectedFailedGate) {
    sections.push(`  Expected failed gate: ${scenario.expectedFailedGate}`);
  }
  if (faultId) {
    sections.push(`  Linked to fault: ${faultId}`);
  }
  sections.push(`  Registry: ${registryPath}`);
  sections.push(`\nTotal scenarios in registry: ${store.count()}`);
  sections.push(`\nThis scenario will be automatically loaded by the self-test runner (bun run test).`);
  sections.push(`The improve loop will now guard against this fault.`);

  return text(sections.join('\n'));
}

// =============================================================================
// IMPROVE TOOL HANDLERS — Claude Code drives the improve loop
// =============================================================================

// Session state for the improve loop (persists between tool calls within a session)
let _improveSession: {
  baseline: any[] | null;
  bundles: any[] | null;
  split: any | null;
  packageRoot: string;
  appDir: string | null;
  families?: string[];
} = {
  baseline: null,
  bundles: null,
  split: null,
  packageRoot: resolve(join(import.meta.dir, '..')),
  appDir: null,
};

async function handleImproveDiscover(args: any) {
  const mods = await getImproveModules();
  const packageRoot = _improveSession.packageRoot;
  const dataDir = join(packageRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  // Resolve appDir — use provided arg, or fall back to session, or default to demo-app
  const appDir = resolve(args.appDir ?? _improveSession.appDir ?? join(packageRoot, 'fixtures', 'demo-app'));
  _improveSession.appDir = appDir;

  const families = args.families ? args.families.split(',').map((f: string) => f.trim()) : undefined;
  _improveSession.families = families;

  // Step 1: Baseline run
  const ledgerPath = join(dataDir, `improve-baseline-${Date.now()}.jsonl`);
  const runConfig: any = {
    appDir,
    ledgerPath,
    families,
  };

  await mods.runSelfTest(runConfig);

  let baseline: any[] = [];
  try {
    const content = readFileSync(ledgerPath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { baseline.push(JSON.parse(line)); } catch { /* skip */ }
    }
    try { require('fs').rmSync(ledgerPath); } catch { /* */ }
  } catch { /* */ }

  _improveSession.baseline = baseline;

  const dirty = baseline.filter((e: any) => !e.clean);
  const clean = baseline.filter((e: any) => e.clean);

  if (dirty.length === 0) {
    return text(`ALL CLEAN — ${baseline.length} scenarios, 0 violations. Nothing to improve.`);
  }

  // Step 2: Bundle violations
  const bundles = mods.bundleViolations(baseline);
  _improveSession.bundles = bundles;

  // Step 3: Split scenarios
  const split = mods.splitScenarios(baseline);
  _improveSession.split = split;

  // Build response with everything Claude Code needs to reason
  const sections: string[] = [];
  sections.push(`APP UNDER TEST: ${appDir}`);
  sections.push(`SELF-TEST BASELINE: ${baseline.length} scenarios — ${clean.length} clean, ${dirty.length} dirty`);
  sections.push(`SCENARIO SPLIT: dirty=${split.dirty.length}  validation=${split.validation.length}  holdout=${split.holdout.length}`);
  sections.push('');

  // Evidence bundles with full context
  sections.push(`═══ ${bundles.length} EVIDENCE BUNDLE(S) ═══`);
  sections.push('');

  for (const bundle of bundles) {
    sections.push(`── Bundle: ${bundle.id} ──`);
    sections.push(`  Confidence: ${bundle.triage.confidence}`);
    sections.push(`  Target file: ${bundle.triage.targetFile ?? '(unknown — needs your diagnosis)'}`);
    sections.push(`  Target function: ${bundle.triage.targetFunction ?? '(unknown)'}`);
    sections.push(`  Pattern: ${bundle.triage.failurePattern ?? '(none)'}`);
    sections.push(`  Violations (${bundle.violations.length}):`);
    for (const v of bundle.violations) {
      sections.push(`    [${v.family}] ${v.invariant}`);
      sections.push(`      → ${v.violation}`);
      sections.push(`      severity: ${v.severity}, scenario: ${v.scenarioId}`);
    }
    sections.push('');

    // Include target file source excerpt if we have a target
    if (bundle.triage.targetFile) {
      const filePath = join(packageRoot, bundle.triage.targetFile);
      if (existsSync(filePath)) {
        const source = readFileSync(filePath, 'utf-8');
        const lines = source.split('\n');

        if (lines.length > 300 && bundle.triage.targetFunction) {
          // Focus on target function
          const funcName = bundle.triage.targetFunction.replace(/\(\)$/, '');
          const funcIdx = lines.findIndex(l => l.includes(`function ${funcName}`) || l.includes(`${funcName}(`));
          if (funcIdx >= 0) {
            const start = Math.max(0, funcIdx - 10);
            const end = Math.min(lines.length, funcIdx + 80);
            sections.push(`  Source excerpt (${bundle.triage.targetFile}, lines ${start + 1}-${end}):`);
            for (let i = start; i < end; i++) {
              sections.push(`    ${i + 1} │ ${lines[i]}`);
            }
          }
        } else if (lines.length <= 150) {
          sections.push(`  Full source (${bundle.triage.targetFile}):`);
          for (let i = 0; i < lines.length; i++) {
            sections.push(`    ${i + 1} │ ${lines[i]}`);
          }
        } else {
          sections.push(`  Source (${bundle.triage.targetFile}, first 150 lines — use verify_improve_read for full file):`);
          for (let i = 0; i < 150; i++) {
            sections.push(`    ${i + 1} │ ${lines[i]}`);
          }
        }
        sections.push('');
      }
    }
  }

  // Bounded edit surface
  sections.push('═══ BOUNDED EDIT SURFACE ═══');
  sections.push('You may ONLY modify these files:');
  for (const s of mods.BOUNDED_SURFACE) {
    sections.push(`  ${s.file} — ${s.description}`);
  }
  sections.push('');
  sections.push('Frozen (read-only): src/verify.ts, src/types.ts, scripts/harness/');
  sections.push('');

  // Instructions
  sections.push('═══ IMPROVE LOOP — YOUR MOVE ═══');
  sections.push('');
  sections.push('For each bundle with violations:');
  sections.push('  1. verify_improve_diagnose(bundleId) — get full context (target + related files + contracts)');
  sections.push('  2. YOU reason about root cause from the diagnosis context');
  sections.push('  3. verify_improve_read(file) — read additional files if needed');
  sections.push('  4. Craft fix edits (search/replace — search must match exactly)');
  sections.push('  5. verify_improve_submit(bundleId, diagnosis, fixes) — harness validates in subprocess isolation');
  sections.push('  6. If ACCEPTED → verify_improve_apply(winningEdits) — apply to real source + revalidate');
  sections.push('');
  sections.push('Final: verify_improve_discover() again to confirm 0 dirty scenarios.');

  return text(sections.join('\n'));
}

function handleImproveRead(args: any) {
  const packageRoot = _improveSession.packageRoot;
  const filePath = join(packageRoot, args.file);

  if (!existsSync(filePath)) {
    return text(`File not found: ${args.file}\n\nAvailable in bounded surface:\n${
      ['src/store/constraint-store.ts', 'src/gates/constraints.ts', 'src/gates/containment.ts',
       'src/gates/grounding.ts', 'src/gates/browser.ts', 'src/gates/http.ts', 'src/gates/syntax.ts',
       'src/verify.ts', 'src/types.ts'].join('\n')
    }`);
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const numbered = lines.map((l, i) => `${i + 1} │ ${l}`).join('\n');
    return text(`${args.file} (${lines.length} lines):\n\n${numbered}`);
  } catch (err: any) {
    return text(`Error reading file: ${err.message}`);
  }
}

async function handleImproveSubmit(args: any) {
  const mods = await getImproveModules();
  const packageRoot = _improveSession.packageRoot;

  // Validate session state
  if (!_improveSession.baseline || !_improveSession.split) {
    return text('ERROR: No baseline data. Run verify_improve_discover first.');
  }

  const bundleId = args.bundleId;
  const diagnosis = args.diagnosis;
  const fixes = args.fixes ?? [];
  const families = args.families ? args.families.split(',').map((f: string) => f.trim()) : _improveSession.families;

  if (fixes.length === 0) {
    return text('ERROR: No fix strategies provided. Include at least one fix with edits.');
  }

  const split = _improveSession.split;
  const appDir = resolve(args.appDir ?? _improveSession.appDir ?? join(packageRoot, 'fixtures', 'demo-app'));
  const runConfig: any = {
    appDir,
    families,
  };

  const sections: string[] = [];
  sections.push(`═══ VALIDATING ${fixes.length} FIX STRATEG${fixes.length === 1 ? 'Y' : 'IES'} ═══`);
  sections.push(`App: ${appDir}`);
  sections.push(`Bundle: ${bundleId}`);
  sections.push(`Diagnosis: ${diagnosis}`);
  sections.push('');

  // Validate each fix in subprocess isolation
  const results: any[] = [];

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    const candidateId = `${bundleId}_mcp_${i + 1}`;

    // Check edit surface
    const surfaceViolations = (fix.edits ?? []).filter((e: any) => !mods.isEditAllowed(e.file));
    if (surfaceViolations.length > 0) {
      sections.push(`[${i + 1}] "${fix.strategy}" — REJECTED (frozen files: ${surfaceViolations.map((e: any) => e.file).join(', ')})`);
      results.push({ candidateId, strategy: fix.strategy, edits: fix.edits, improvements: [], regressions: [], score: -100 });
      continue;
    }

    sections.push(`[${i + 1}] Testing "${fix.strategy}"...`);

    try {
      const result = await mods.validateCandidate(
        candidateId, fix.strategy, fix.edits ?? [],
        split, packageRoot, runConfig,
      );
      results.push(result);

      const sign = result.score > 0 ? '+' : '';
      sections.push(`    Score: ${sign}${result.score}`);
      sections.push(`    Improvements: ${result.improvements.length} scenarios fixed (${result.improvements.join(', ') || 'none'})`);
      sections.push(`    Regressions: ${result.regressions.length} scenarios broken (${result.regressions.join(', ') || 'none'})`);
    } catch (err: any) {
      sections.push(`    ERROR: ${err.message}`);
      results.push({ candidateId, strategy: fix.strategy, edits: fix.edits, improvements: [], regressions: [], score: -100 });
    }
    sections.push('');
  }

  // Rank and find best
  const ranked = [...results].sort((a, b) => b.score - a.score);
  const best = ranked[0];

  if (best.score <= 0) {
    sections.push('═══ VERDICT: rejected_no_fix ═══');
    sections.push('No fix candidate improved any scenarios.');
    sections.push('Try a different approach — re-read the source and violations.');
    return text(sections.join('\n'));
  }

  if (best.regressions.length > 0) {
    sections.push(`═══ VERDICT: rejected_regression ═══`);
    sections.push(`Best candidate "${best.strategy}" has ${best.regressions.length} regression(s).`);
    sections.push(`Broken scenarios: ${best.regressions.join(', ')}`);
    sections.push('The fix must not break any passing scenarios.');
    return text(sections.join('\n'));
  }

  // Holdout check
  sections.push(`═══ HOLDOUT CHECK: "${best.strategy}" ═══`);

  try {
    const holdoutResult = await mods.runHoldout(best.edits, split.holdout, packageRoot, runConfig);

    if (holdoutResult === 'regression') {
      sections.push('VERDICT: rejected_overfitting');
      sections.push('Fix passed validation set but FAILED on holdout set — overfitting detected.');
      sections.push('The fix is too specific to the validation scenarios.');
      return text(sections.join('\n'));
    }

    sections.push('Holdout: CLEAN');
    sections.push('');
    sections.push('═══ VERDICT: ACCEPTED ═══');
    sections.push(`Winner: "${best.strategy}"`);
    sections.push(`Score: +${best.score}`);
    sections.push(`Improvements: ${best.improvements.length} scenarios fixed`);
    sections.push('');
    sections.push('WINNING EDITS (apply these to the real codebase):');
    for (const edit of best.edits) {
      sections.push(`\n  File: ${edit.file}`);
      sections.push(`  Search:\n${edit.search.split('\n').map((l: string) => `    - ${l}`).join('\n')}`);
      sections.push(`  Replace:\n${edit.replace.split('\n').map((l: string) => `    + ${l}`).join('\n')}`);
    }
    sections.push('');
    sections.push('To apply: call verify_improve_apply with these edits.');
    sections.push('The apply tool will write the changes and revalidate automatically.');
  } catch (err: any) {
    sections.push(`Holdout error: ${err.message}`);
    sections.push('VERDICT: error');
  }

  return text(sections.join('\n'));
}

async function handleImproveDiagnose(args: any) {
  const mods = await getImproveModules();
  const packageRoot = _improveSession.packageRoot;

  if (!_improveSession.bundles || _improveSession.bundles.length === 0) {
    return text('ERROR: No bundles available. Run verify_improve_discover first.');
  }

  const bundleId = args.bundleId;
  const bundle = _improveSession.bundles.find((b: any) => b.id === bundleId);
  if (!bundle) {
    const available = _improveSession.bundles.map((b: any) => b.id).join(', ');
    return text(`ERROR: Bundle "${bundleId}" not found. Available: ${available}`);
  }

  const sections: string[] = [];
  sections.push(`═══ DIAGNOSIS CONTEXT: ${bundleId} ═══`);
  sections.push('');

  // Violation evidence
  sections.push('── VIOLATION EVIDENCE ──');
  for (const v of bundle.violations) {
    sections.push(`  [${v.family}] ${v.invariant}`);
    sections.push(`    → ${v.violation}`);
    sections.push(`    severity: ${v.severity}, scenario: ${v.scenarioId}`);
  }
  sections.push('');
  sections.push(`  Triage confidence: ${bundle.triage.confidence}`);
  sections.push(`  Target: ${bundle.triage.targetFunction ?? 'unknown'} in ${bundle.triage.targetFile ?? 'unknown'}`);
  sections.push(`  Pattern: ${bundle.triage.failurePattern ?? '(none)'}`);
  sections.push('');

  // Target file source (full, line-numbered)
  if (bundle.triage.targetFile) {
    const filePath = join(packageRoot, bundle.triage.targetFile);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      sections.push(`── TARGET SOURCE: ${bundle.triage.targetFile} (${lines.length} lines) ──`);
      for (let i = 0; i < lines.length; i++) {
        sections.push(`  ${i + 1} │ ${lines[i]}`);
      }
      sections.push('');
    }

    // Related files (architecturally coupled)
    const related = mods.RELATED_FILES[bundle.triage.targetFile];
    if (related && related.length > 0) {
      sections.push('── RELATED FILES (architecturally coupled) ──');
      for (const relPath of related) {
        const fullPath = join(packageRoot, relPath);
        if (!existsSync(fullPath)) continue;
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          sections.push(`\n  ── ${relPath} (${lines.length} lines) ──`);
          for (let i = 0; i < lines.length; i++) {
            sections.push(`  ${i + 1} │ ${lines[i]}`);
          }
        } catch { /* skip */ }
      }
      sections.push('');
    }
  }

  // Invariant contracts
  sections.push('── INVARIANT CONTRACTS ──');
  sections.push('  fingerprint: predicateFingerprint() must produce deterministic, distinct signatures');
  sections.push('  k5: checkConstraints() must block banned patterns, seedFromFailure() must learn');
  sections.push('  gate_sequence: gates run in order, failed gates have details, success is consistent');
  sections.push('  containment: mutations must trace to predicates (G5 attribution)');
  sections.push('  grounding: CSS/HTML extraction must match reality');
  sections.push('  robustness: verify() must not crash on malformed input');
  sections.push('');

  // Bounded edit surface reminder
  sections.push('── BOUNDED EDIT SURFACE ──');
  for (const s of mods.BOUNDED_SURFACE) {
    sections.push(`  ${s.file} — ${s.description}`);
  }
  sections.push('  FROZEN (read-only): src/verify.ts, src/types.ts, scripts/harness/*');
  sections.push('');

  // Instructions
  sections.push('── YOUR TASK ──');
  sections.push('1. Read the violations and source code above');
  sections.push('2. Identify the root cause: name the exact function, file, and explain WHY the invariant fails');
  sections.push('3. Consider whether this is a product bug (verify pipeline) or a harness bug (test scenario)');
  sections.push('4. Craft fix edits and submit via verify_improve_submit');

  return text(sections.join('\n'));
}

async function handleImproveApply(args: any) {
  const mods = await getImproveModules();
  const packageRoot = _improveSession.packageRoot;
  const edits = args.edits ?? [];
  const revalidate = args.revalidate !== false; // default true
  const families = args.families ? args.families.split(',').map((f: string) => f.trim()) : _improveSession.families;

  if (edits.length === 0) {
    return text('ERROR: No edits provided.');
  }

  const sections: string[] = [];
  sections.push('═══ APPLYING WINNING EDITS ═══');
  sections.push('');

  // Validate edit surface
  for (const edit of edits) {
    if (!mods.isEditAllowed(edit.file)) {
      sections.push(`REJECTED: ${edit.file} is frozen — cannot modify.`);
      return text(sections.join('\n'));
    }
  }

  // Apply edits to real source files
  let applied = 0;
  let failed = 0;

  for (const edit of edits) {
    const filePath = join(packageRoot, edit.file);
    if (!existsSync(filePath)) {
      sections.push(`  ✗ ${edit.file} — file not found`);
      failed++;
      continue;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const occurrences = content.split(edit.search).length - 1;

      if (occurrences === 0) {
        sections.push(`  ✗ ${edit.file} — search string not found`);
        failed++;
        continue;
      }

      if (occurrences > 1) {
        sections.push(`  ✗ ${edit.file} — search string found ${occurrences} times (must be unique)`);
        failed++;
        continue;
      }

      const updated = content.replace(edit.search, edit.replace);
      require('fs').writeFileSync(filePath, updated);
      sections.push(`  ✓ ${edit.file} — applied`);
      applied++;
    } catch (err: any) {
      sections.push(`  ✗ ${edit.file} — ${err.message}`);
      failed++;
    }
  }

  sections.push('');
  sections.push(`Applied: ${applied}/${edits.length}${failed > 0 ? ` (${failed} failed)` : ''}`);

  if (failed > 0) {
    sections.push('');
    sections.push('Some edits failed. Check the search strings match the current file contents exactly.');
    return text(sections.join('\n'));
  }

  // Clear grounding cache since source files were just edited
  clearGroundingCache();

  // Revalidate
  if (revalidate) {
    sections.push('');
    sections.push('═══ REVALIDATING ═══');

    const appDir = _improveSession.appDir ?? join(packageRoot, 'fixtures', 'demo-app');
    const runConfig: any = {
      appDir,
      families,
    };

    try {
      const ledgerPath = join(packageRoot, 'data', `improve-revalidate-${Date.now()}.jsonl`);
      const revalConfig = { ...runConfig, ledgerPath };
      await mods.runSelfTest(revalConfig);

      let baseline: any[] = [];
      try {
        const content = readFileSync(ledgerPath, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try { baseline.push(JSON.parse(line)); } catch { /* skip */ }
        }
        try { require('fs').rmSync(ledgerPath); } catch { /* */ }
      } catch { /* */ }

      const dirty = baseline.filter((e: any) => !e.clean);
      const clean = baseline.filter((e: any) => e.clean);

      sections.push(`  ${baseline.length} scenarios: ${clean.length} clean, ${dirty.length} dirty`);
      sections.push('');

      if (dirty.length === 0) {
        sections.push('✓ ALL CLEAN — improvement confirmed. 0 remaining violations.');
      } else {
        sections.push(`⚠ ${dirty.length} dirty scenarios remain:`);
        for (const d of dirty) {
          const bugs = d.bugs?.map((b: any) => b.violation).join('; ') ?? 'unknown';
          sections.push(`  ${d.scenarioId}: ${bugs}`);
        }
        sections.push('');
        sections.push('Run verify_improve_discover to investigate remaining violations.');
      }

      // Update session with new baseline — invalidate stale bundles/split so next
      // discover or submit sees fresh state instead of stale pre-apply data
      _improveSession.baseline = baseline;
      _improveSession.bundles = null;
      _improveSession.split = null;
    } catch (err: any) {
      sections.push(`  Revalidation error: ${err.message}`);
    }
  }

  return text(sections.join('\n'));
}

async function handleImproveCycle(args: any) {
  const mods = await getImproveModules();
  const packageRoot = _improveSession.packageRoot;

  // Import the full pipeline
  const { runImproveLoop } = await import('../scripts/harness/improve.js');

  const families = args.families ? args.families.split(',').map((f: string) => f.trim()) : undefined;
  const appDir = resolve(args.appDir ?? _improveSession.appDir ?? join(packageRoot, 'fixtures', 'demo-app'));

  const runConfig: any = {
    appDir,
    families,
  };

  const improveConfig: any = {
    llm: args.llm ?? 'none',
    apiKey: args.apiKey,
    maxCandidates: args.maxCandidates ?? 3,
    maxLines: 50,
    dryRun: args.dryRun ?? false,
  };

  if (improveConfig.llm !== 'none' && !improveConfig.apiKey) {
    return text(`ERROR: API key required for ${improveConfig.llm}. Provide apiKey parameter.\n\nPrefer the interactive flow instead:\n1. verify_improve_discover — see violations\n2. YOU diagnose and craft fixes\n3. verify_improve_submit — validate your fixes`);
  }

  try {
    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
      const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      logs.push(line);
    };

    await runImproveLoop(runConfig, improveConfig);

    console.log = origLog;

    return text(logs.join('\n'));
  } catch (err: any) {
    return text(`Improve cycle error: ${err.message}\n\nTip: For interactive improvement where YOU are the doctor, use verify_improve_discover + verify_improve_submit instead.`);
  }
}

// =============================================================================
// CHAOS ENGINE HANDLERS — Autonomous stress-testing loop
// =============================================================================

// Session cache: maps fault IDs to original goal data (for encoding)
let _chaosGoalCache: Map<string, { goal: string; edits: Edit[]; predicates: Predicate[]; category?: string; difficulty?: string; expectedOutcome?: string }> = new Map();

const CHAOS_CATEGORIES = [
  'css_change', 'html_mutation', 'content_change', 'http_behavior',
  'db_schema', 'adversarial_predicate', 'mixed_surface', 'grounding_probe',
] as const;

const CATEGORY_TEMPLATES: Record<string, string> = {
  css_change: `Change a CSS property and verify the new value.
  Attack surface: shorthand vs longhand (border → border-width), computed vs source (rgb vs named), cross-route bleeding (missing path field), multi-definition selectors.`,

  html_mutation: `Add/change an HTML element and verify it exists with correct content.
  Attack surface: wrong route scoping, text content mismatch, data-dependent elements that only render with DB data.`,

  content_change: `Modify file content and verify the pattern exists.
  Attack surface: non-existent files, patterns that don't match after edit, fabricated content predicates.`,

  http_behavior: `Test HTTP endpoint behavior (status codes, response body).
  Attack surface: endpoints that need DB, advisory vs hard-fail at different staging depths, sequence ordering.`,

  db_schema: `Test database schema predicates (table_exists, column_exists, column_type).
  Attack surface: tables that don't exist, wrong column types, predicates without running DB.`,

  adversarial_predicate: `Submit predicates that reference non-existent elements to test grounding rejection.
  Attack surface: fabricated selectors, wrong routes, wrong expected values, non-existent properties.`,

  mixed_surface: `Combine multiple predicate types in a single submission.
  Attack surface: partial failures (some pass, some fail), containment attribution across types.`,

  grounding_probe: `Test the grounding gate's ability to validate predicates against reality.
  Attack surface: selectors on wrong routes, CSS values that don't match source, HTML text mismatches.`,
};

function handleChaosPlan(args: any) {
  const appDir = resolve(args.appDir);
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));
  const count = args.count ?? 10;
  const categories: string[] = args.categories ?? [];

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  // Ground the app
  const grounding = groundInReality(appDir);

  const sections: string[] = [];
  sections.push(`═══ CHAOS ENGINE — RECONNAISSANCE ═══`);
  sections.push(`App: ${appDir}`);
  sections.push(`Target goal count: ${count}`);
  sections.push('');

  // Detect capabilities
  const hasDocker = existsSync(join(appDir, 'docker-compose.yml'));
  const hasDB = grounding.dbSchema && grounding.dbSchema.length > 0;
  const hasRoutes = grounding.routes.length > 0;

  sections.push('── APP CAPABILITIES ──');
  sections.push(`  Docker: ${hasDocker ? 'YES' : 'NO'}`);
  sections.push(`  Database: ${hasDB ? `YES (${grounding.dbSchema!.length} tables)` : 'NO'}`);
  sections.push(`  Routes: ${hasRoutes ? grounding.routes.join(', ') : 'none detected'}`);
  sections.push('');

  // CSS inventory
  const cssSelectors: Array<{ route: string; selector: string; props: Record<string, string> }> = [];
  for (const [route, rules] of grounding.routeCSSMap) {
    for (const [selector, props] of rules) {
      cssSelectors.push({ route, selector, props });
    }
  }

  if (cssSelectors.length > 0) {
    sections.push(`── CSS SELECTORS (${cssSelectors.length} total) ──`);
    for (const { route, selector, props } of cssSelectors.slice(0, 50)) {
      const propStr = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('; ');
      sections.push(`  [${route}] ${selector} { ${propStr} }`);
    }
    if (cssSelectors.length > 50) {
      sections.push(`  ... and ${cssSelectors.length - 50} more`);
    }
    sections.push('');
  }

  // HTML inventory
  const htmlElements: Array<{ route: string; tag: string; text?: string; attrs?: Record<string, string> }> = [];
  for (const [route, elements] of grounding.htmlElements) {
    for (const el of elements) {
      htmlElements.push({ route, tag: el.tag, text: el.text, attrs: el.attributes });
    }
  }

  if (htmlElements.length > 0) {
    sections.push(`── HTML ELEMENTS (${htmlElements.length} total) ──`);
    for (const { route, tag, text: elText, attrs } of htmlElements.slice(0, 40)) {
      const attrStr = attrs ? Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ') : '';
      sections.push(`  [${route}] <${tag}${attrStr ? ' ' + attrStr : ''}>${(elText ?? '').slice(0, 60)}</${tag}>`);
    }
    if (htmlElements.length > 40) {
      sections.push(`  ... and ${htmlElements.length - 40} more`);
    }
    sections.push('');
  }

  // DB schema
  if (hasDB) {
    sections.push(`── DATABASE SCHEMA ──`);
    for (const table of grounding.dbSchema!) {
      const cols = table.columns.map(c => `${c.name}:${c.type}`).join(', ');
      sections.push(`  ${table.table} (${cols})`);
    }
    sections.push('');
  }

  // Read source files for exact string matching context
  const sourceFiles: string[] = [];
  try {
    const entries = require('fs').readdirSync(appDir);
    for (const entry of entries) {
      if (entry.endsWith('.js') || entry.endsWith('.ts') || entry.endsWith('.html') || entry.endsWith('.css')) {
        sourceFiles.push(entry);
      }
    }
  } catch { /* */ }

  if (sourceFiles.length > 0) {
    sections.push(`── SOURCE FILES ──`);
    for (const f of sourceFiles) {
      const content = readFileSync(join(appDir, f), 'utf-8');
      sections.push(`  ${f} (${content.split('\n').length} lines, ${content.length} bytes)`);
    }
    sections.push(`  Use verify_read to inspect file contents for crafting exact search/replace edits.`);
    sections.push('');
  }

  // Active constraints
  const constraintPath = join(stateDir, 'constraints.json');
  if (existsSync(constraintPath)) {
    try {
      const constraints = JSON.parse(readFileSync(constraintPath, 'utf-8'));
      if (constraints.length > 0) {
        sections.push(`── ACTIVE CONSTRAINTS (${constraints.length}) ──`);
        for (const c of constraints.slice(0, 10)) {
          sections.push(`  [${c.type}] ${c.signature}: ${c.reason}`);
        }
        sections.push('');
      }
    } catch { /* */ }
  }

  // Existing faults (avoid duplicate work)
  const faultPath = join(stateDir, 'faults.jsonl');
  if (existsSync(faultPath)) {
    try {
      const lines = readFileSync(faultPath, 'utf-8').split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        const faults = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const byClass: Record<string, number> = {};
        for (const f of faults) byClass[f.classification] = (byClass[f.classification] ?? 0) + 1;
        sections.push(`── FAULT HISTORY (${faults.length} total) ──`);
        for (const [cls, cnt] of Object.entries(byClass)) {
          sections.push(`  ${cls}: ${cnt}`);
        }
        sections.push(`  Avoid repeating goals that produced 'correct' or 'agent_fault' results.`);
        sections.push('');
      }
    } catch { /* */ }
  }

  // Determine applicable categories
  const applicable = (categories.length > 0 ? categories : CHAOS_CATEGORIES.filter(c => {
    if (c === 'db_schema' && !hasDB) return false;
    if (c === 'http_behavior' && !hasDocker) return false;
    return true;
  })) as string[];

  sections.push(`── GOAL GENERATION TEMPLATES (${applicable.length} categories) ──`);
  sections.push('');
  for (const cat of applicable) {
    const template = CATEGORY_TEMPLATES[cat];
    if (template) {
      sections.push(`[${cat}]`);
      sections.push(template);
      sections.push('');
    }
  }

  // Coverage steering — report under-tested gates
  const registryPath = join(stateDir, 'custom-scenarios.json');
  const allGates: ScenarioCategory[] = ['grounding', 'containment', 'constraints', 'staging', 'syntax', 'sequencing', 'evidence', 'narrowing'];
  const gateCoverage: Record<string, number> = {};
  for (const g of allGates) gateCoverage[g] = 0;
  if (existsSync(registryPath)) {
    try {
      const store = new ExternalScenarioStore(registryPath);
      const stats = store.stats();
      for (const [cat, cnt] of Object.entries(stats.byCategory)) gateCoverage[cat] = cnt;
    } catch { /* */ }
  }
  const uncovered = allGates.filter(g => (gateCoverage[g] ?? 0) === 0);
  const sparse = allGates.filter(g => (gateCoverage[g] ?? 0) > 0 && (gateCoverage[g] ?? 0) < 3);

  sections.push(`── SCENARIO COVERAGE ──`);
  for (const g of allGates) {
    const cnt = gateCoverage[g] ?? 0;
    const marker = cnt === 0 ? ' ← NO SCENARIOS' : cnt < 3 ? ' ← sparse' : '';
    sections.push(`  ${g}: ${cnt} custom scenarios${marker}`);
  }
  if (uncovered.length > 0) {
    sections.push('');
    sections.push(`  PRIORITY: Generate goals that exercise ${uncovered.join(', ')} — zero coverage.`);
    if (uncovered.includes('containment')) sections.push(`    containment: submit edits that touch files NOT referenced by any predicate`);
    if (uncovered.includes('constraints')) sections.push(`    constraints: repeat a known-bad predicate (banned fingerprint) or same edit twice`);
    if (uncovered.includes('syntax')) sections.push(`    syntax: submit edits with search strings that don't match file contents`);
    if (uncovered.includes('staging')) sections.push(`    staging: submit edits that break the Docker build (syntax errors in code)`);
    if (uncovered.includes('evidence')) sections.push(`    evidence: submit edits where HTTP endpoint behavior contradicts predicates`);
    if (uncovered.includes('narrowing')) sections.push(`    narrowing: submit wrong predicates and check if narrowing hints are useful`);
  }
  sections.push('');

  // Instructions
  sections.push(`═══ YOUR TASK ═══`);
  sections.push('');
  sections.push(`Generate ${count} diverse goals across the applicable categories.`);
  sections.push(`For each goal, provide:`);
  sections.push(`  - goal: description of the change`);
  sections.push(`  - edits: search/replace against REAL file contents (use verify_read to get exact strings)`);
  sections.push(`  - predicates: testable claims about the end state`);
  sections.push(`  - expectedOutcome: "pass" if verify SHOULD accept, "fail" if verify SHOULD reject`);
  sections.push(`  - category: which category this tests`);
  sections.push(`  - difficulty: trivial/moderate/hard/adversarial`);
  sections.push('');
  sections.push('Then call verify_chaos_run with your goals array.');
  sections.push('The tool will execute all goals, classify faults, and flag verify bugs for encoding.');

  return text(sections.join('\n'));
}

async function handleChaosRun(args: any) {
  const appDir = resolve(args.appDir);
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));
  const goals = args.goals ?? [];

  if (!existsSync(appDir)) {
    return text(`App directory not found: ${appDir}`);
  }

  if (goals.length === 0) {
    return text('No goals provided. Call verify_chaos_plan first to get context, then generate goals.');
  }

  mkdirSync(stateDir, { recursive: true });

  const hasDocker = args.docker ?? existsSync(join(appDir, 'docker-compose.yml'));

  const sections: string[] = [];
  sections.push(`═══ CHAOS ENGINE — EXECUTING ${goals.length} GOALS ═══`);
  sections.push(`App: ${appDir}`);
  sections.push('');

  // Stats
  const stats = {
    total: goals.length,
    passed: 0,
    failed: 0,
    errors: 0,
    verifyBugs: 0,
    correct: 0,
    agentFault: 0,
    faultIds: [] as string[],
    bugFaultIds: [] as string[],
  };

  const ledger = new FaultLedger(join(stateDir, 'faults.jsonl'));

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    const goalNum = i + 1;

    sections.push(`── [${goalNum}/${goals.length}] ${goal.category ?? 'unknown'} / ${goal.difficulty ?? 'unknown'} ──`);
    sections.push(`  Goal: ${goal.goal}`);
    sections.push(`  Expected: ${goal.expectedOutcome}`);
    sections.push(`  Edits: ${(goal.edits ?? []).length}, Predicates: ${(goal.predicates ?? []).length}`);

    const config: VerifyConfig = {
      appDir,
      goal: goal.goal,
      docker: hasDocker ? {
        composefile: join(appDir, 'docker-compose.yml'),
        startupTimeoutMs: 30_000,
        buildTimeoutMs: 120_000,
      } : undefined,
      stateDir,
      gates: {
        syntax: true,
        constraints: true,
        containment: true,
        staging: hasDocker,
        browser: hasDocker,
        http: hasDocker,
        invariants: hasDocker,
        grounding: true,
        vision: false,
      },
    };

    let verifyResult;
    try {
      verifyResult = await verify(goal.edits ?? [], goal.predicates ?? [], config);
    } catch (err: any) {
      sections.push(`  ERROR: verify() threw: ${err.message}`);
      stats.errors++;
      sections.push('');
      continue;
    }

    const actual = verifyResult.success ? 'pass' : 'fail';
    const expected = goal.expectedOutcome;
    const match = actual === expected;

    if (verifyResult.success) stats.passed++;
    else stats.failed++;

    // Record to fault ledger
    const faultEntry = ledger.recordFromResult(verifyResult, {
      app: appDir.split('/').pop() ?? 'unknown',
      goal: goal.goal,
      predicates: goal.predicates,
      crossCheck: undefined,
    });

    if (faultEntry) {
      stats.faultIds.push(faultEntry.id);

      // Cache goal data for encoding (including expectedOutcome for intent derivation)
      const goalData = {
        goal: goal.goal,
        edits: goal.edits ?? [],
        predicates: goal.predicates ?? [],
        category: goal.category,
        difficulty: goal.difficulty,
        expectedOutcome: goal.expectedOutcome,
      };
      _chaosGoalCache.set(faultEntry.id, goalData);

      // Persist to fault ledger for cross-session encoding (survives VS Code restart)
      ledger.patchGoalData(faultEntry.id, {
        edits: goalData.edits,
        predicates: goalData.predicates as Array<Record<string, unknown>>,
        category: goalData.category,
        difficulty: goalData.difficulty,
        expectedOutcome: goalData.expectedOutcome,
      });

      // Classify against expected outcome
      const isBug = !match;
      if (isBug) {
        stats.verifyBugs++;
        stats.bugFaultIds.push(faultEntry.id);
        sections.push(`  Result: ${actual.toUpperCase()} ← MISMATCH (expected ${expected}) — VERIFY BUG`);
        sections.push(`  Fault: ${faultEntry.id} (${faultEntry.classification})`);
      } else {
        if (faultEntry.classification === 'correct' || faultEntry.classification === 'agent_fault') {
          stats.correct++;
        }
        sections.push(`  Result: ${actual.toUpperCase()} ← match (expected ${expected})`);
        sections.push(`  Fault: ${faultEntry.id} (${faultEntry.classification})`);
      }
    } else {
      sections.push(`  Result: ${actual.toUpperCase()} (no fault entry)`);
    }

    // Gate details on failure
    if (!verifyResult.success) {
      const failedGates = verifyResult.gates.filter(g => !g.passed);
      if (failedGates.length > 0) {
        sections.push(`  Failed gates: ${failedGates.map(g => `${g.gate} (${g.detail.slice(0, 60)})`).join(', ')}`);
      }
    }

    sections.push(`  Duration: ${verifyResult.timing.totalMs}ms`);
    sections.push('');
  }

  // Summary
  sections.push('═══ CHAOS CAMPAIGN SUMMARY ═══');
  sections.push(`  Total goals: ${stats.total}`);
  sections.push(`  Verify passed: ${stats.passed}`);
  sections.push(`  Verify failed: ${stats.failed}`);
  sections.push(`  Errors (verify threw): ${stats.errors}`);
  sections.push('');
  sections.push(`  Outcome matches: ${stats.correct} (verify judged correctly)`);
  sections.push(`  VERIFY BUGS: ${stats.verifyBugs} (verify judged wrong)`);
  sections.push('');

  if (stats.bugFaultIds.length > 0) {
    sections.push(`  Bug fault IDs (encode these as permanent scenarios):`);
    for (const id of stats.bugFaultIds) {
      sections.push(`    ${id}`);
    }
    sections.push('');
    sections.push(`  To encode: verify_chaos_encode(appDir="${appDir}", faultIds=[${stats.bugFaultIds.map(id => `"${id}"`).join(', ')}])`);
  } else {
    sections.push('  No verify bugs found this run. Try harder categories or adversarial predicates.');
  }

  return text(sections.join('\n'));
}

function handleChaosEncode(args: any) {
  const appDir = resolve(args.appDir);
  const stateDir = resolve(args.stateDir ?? join(appDir, '.verify'));
  const faultPath = join(stateDir, 'faults.jsonl');
  const registryPath = join(stateDir, 'custom-scenarios.json');

  if (!existsSync(faultPath)) {
    return text('No fault ledger found. Run verify_chaos_run first.');
  }

  // Merge caller-provided goals into session cache (cross-session fallback)
  const goalsArg: Array<{ faultId: string; edits: Edit[]; predicates: Predicate[]; category?: string; difficulty?: string }> = args.goals ?? [];
  for (const g of goalsArg) {
    if (g.faultId && !_chaosGoalCache.has(g.faultId)) {
      _chaosGoalCache.set(g.faultId, {
        goal: '',
        edits: g.edits ?? [],
        predicates: g.predicates ?? [],
        category: g.category,
        difficulty: g.difficulty,
      });
    }
  }

  const ledger = new FaultLedger(faultPath);
  const allFaults = ledger.all();

  // Determine which faults to encode
  let targetFaults: any[];
  const requestedIds: string[] = args.faultIds ?? [];

  if (requestedIds.length > 0) {
    targetFaults = allFaults.filter(f => requestedIds.includes(f.id));
  } else {
    // All unencoded verify bugs
    targetFaults = allFaults.filter(f =>
      !f.scenarioId &&
      f.classification !== 'correct' &&
      f.classification !== 'agent_fault'
    );
  }

  if (targetFaults.length === 0) {
    return text('No faults to encode. Either all faults are already encoded, or no verify bugs were found.');
  }

  const sections: string[] = [];
  sections.push(`═══ CHAOS ENCODE — ${targetFaults.length} FAULTS ═══`);
  sections.push('');

  const store = new ExternalScenarioStore(registryPath);
  let encoded = 0;
  let skipped = 0;

  for (const fault of targetFaults) {
    // Skip non-bugs
    if (fault.classification === 'correct' || fault.classification === 'agent_fault') {
      sections.push(`  SKIP ${fault.id}: ${fault.classification} (not a verify bug)`);
      skipped++;
      continue;
    }

    // Skip already-encoded
    if (fault.scenarioId) {
      sections.push(`  SKIP ${fault.id}: already encoded as ${fault.scenarioId}`);
      skipped++;
      continue;
    }

    // Get original goal data from session cache, then fault ledger (cross-session fallback)
    let cached = _chaosGoalCache.get(fault.id);
    if (!cached && fault.goalData) {
      // Cross-session fallback: reconstruct from persisted fault entry
      cached = {
        goal: fault.goal ?? '',
        edits: fault.goalData.edits as Edit[],
        predicates: fault.goalData.predicates as Predicate[],
        category: fault.goalData.category,
        difficulty: fault.goalData.difficulty,
        expectedOutcome: fault.goalData.expectedOutcome,
      };
    }
    if (!cached || (cached.edits.length === 0 && cached.predicates.length === 0)) {
      sections.push(`  SKIP ${fault.id}: no goal data (session cache missed and fault entry has no goalData)`);
      skipped++;
      continue;
    }

    // Derive intent from classification — use cached expectedOutcome for ambiguous cases
    let intent: ScenarioIntent;
    if (fault.classification === 'false_positive') intent = 'false_positive';
    else if (fault.classification === 'false_negative') intent = 'false_negative';
    else if (fault.classification === 'bad_hint') intent = 'bad_hint';
    else if (fault.classification === 'ambiguous') {
      // Ambiguous auto-classification — infer from expectedOutcome vs actual result
      if (cached.expectedOutcome === 'fail' && fault.verifyPassed) intent = 'false_positive';
      else if (cached.expectedOutcome === 'pass' && !fault.verifyPassed) intent = 'false_negative';
      else intent = 'regression_guard';
    }
    else intent = 'regression_guard';

    const expectedSuccess = intent === 'false_negative' || intent === 'regression_guard';

    // Build scenario from fault + cached goal data
    const description = fault.goal
      ? `Chaos: ${fault.goal.slice(0, 100)}`
      : `Chaos: ${fault.classification} fault ${fault.id}`;

    const partialScenario = {
      description,
      faultId: fault.id,
      intent,
      expectedSuccess,
      edits: cached.edits,
      predicates: cached.predicates,
      requiresDocker: false,
      expectedFailedGate: fault.failedGate,
      rationale: `Auto-encoded from chaos campaign. Classification: ${fault.classification}. ${fault.reason ?? ''}`,
      tags: ['chaos-engine', fault.classification, ...(cached.category ? [cached.category] : [])],
    };

    // Auto-classify transferability and category
    const transferability = classifyTransferability(partialScenario);
    const category = classifyCategory(partialScenario);

    const scenario = store.add({
      ...partialScenario,
      transferability,
      category,
    });

    // Link back
    ledger.linkScenario(fault.id, scenario.id);

    sections.push(`  ✓ ${fault.id} → ${scenario.id}`);
    sections.push(`    Intent: ${intent}, Expected: ${expectedSuccess ? 'PASS' : 'FAIL'}`);
    sections.push(`    Transferability: ${transferability}, Category: ${category}`);
    sections.push(`    ${description}`);
    encoded++;
  }

  sections.push('');
  sections.push(`Encoded: ${encoded}, Skipped: ${skipped}`);
  sections.push(`Total scenarios in registry: ${store.count()}`);

  // Show classification breakdown
  const st = store.stats();
  sections.push('');
  sections.push('Classification breakdown:');
  sections.push(`  Transferability: ${Object.entries(st.byTransferability).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  sections.push(`  Category: ${Object.entries(st.byCategory).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  sections.push('');
  sections.push('These scenarios are now permanent. The self-test runner and improve loop will guard against these faults.');

  return text(sections.join('\n'));
}

function text(content: string) {
  return { content: [{ type: 'text', text: content }] };
}

// =============================================================================
// MCP PROTOCOL HANDLER
// =============================================================================

function handleMessage(request: JsonRpcRequest): JsonRpcResponse | null {
  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        },
      };

    case 'notifications/initialized':
      return null; // No response needed

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: TOOLS },
      };

    default:
      return null; // Handled async
  }
}

async function handleMessageAsync(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request.method === 'tools/call') {
    const { name, arguments: args } = request.params ?? {};
    try {
      const result = await handleToolCall(name, args ?? {});
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: err.message },
      };
    }
  }
  return null;
}

// =============================================================================
// STDIO TRANSPORT
// =============================================================================

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line);
  } catch {
    return; // Ignore malformed input
  }

  // Try sync handler first
  const syncResponse = handleMessage(request);
  if (syncResponse) {
    process.stdout.write(JSON.stringify(syncResponse) + '\n');
    return;
  }

  // Try async handler
  const asyncResponse = await handleMessageAsync(request);
  if (asyncResponse) {
    process.stdout.write(JSON.stringify(asyncResponse) + '\n');
  }
});

rl.on('close', () => process.exit(0));
