/**
 * Edit Generator — LLM-Produced Plausible Edits for Goals
 * ========================================================
 *
 * Given a goal and grounding context, the LLM produces concrete
 * search/replace edits. Separate from goal generation because:
 *   - Goals can be reused across apps
 *   - Edit generation needs actual file contents
 *   - Separation lets us test goal quality independent of edit quality
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import type { Edit, Predicate, GroundingContext } from '../../src/types.js';
import type { GeneratedGoal, GeneratedSubmission, LLMCallFn, LLMCallResult } from './types.js';
import { CLAUDE_EDIT_SYSTEM } from './claude-brain.js';

// =============================================================================
// PROMPTS
// =============================================================================

const SYSTEM_PROMPT = `You are an edit generator for a code verification system.
Given a goal and the app's source code, produce concrete search/replace edits.

Rules for producing valid edits:
1. The "search" string must be an EXACT substring that appears in the file — copy it verbatim from the source
2. The "search" string must appear EXACTLY ONCE in the file (unique match)
3. The "replace" string is what replaces the search string
4. Keep edits minimal — change only what's needed to satisfy the goal
5. Preserve line endings and indentation exactly as they appear in the source

You must also provide predicates that verify the edit worked. These may refine
the goal's original predicates based on what you learned from reading the source.

Respond with a JSON object (no markdown fencing):
{
  "edits": [
    { "file": "server.js", "search": "exact source text", "replace": "new text" }
  ],
  "predicates": [
    { "type": "css", "selector": ".class", "property": "color", "expected": "rgb(255, 0, 0)", "path": "/" }
  ],
  "expectedOutcome": "pass",
  "reasoning": "Why these edits should produce the expected outcome"
}`;

// =============================================================================
// SOURCE FILE READING
// =============================================================================

/**
 * Read source files from the app directory for inclusion in the LLM prompt.
 * Filters to relevant source files and caps total size.
 */
function readSourceFiles(appDir: string, maxTotalBytes: number = 50_000): Map<string, string> {
  const files = new Map<string, string>();
  let totalSize = 0;

  const sourceExtensions = new Set([
    '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.py',
    '.mjs', '.cjs', '.vue', '.svelte',
  ]);

  const skipDirs = new Set([
    'node_modules', '.git', '.next', 'dist', 'build', '__pycache__',
    '.sovereign', '.verify', 'coverage',
  ]);

  function walk(dir: string): void {
    if (totalSize >= maxTotalBytes) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch { return; }

    for (const entry of entries) {
      if (totalSize >= maxTotalBytes) break;
      const fullPath = join(dir, entry);

      try {
        const stat = require('fs').statSync(fullPath);
        if (stat.isDirectory()) {
          if (!skipDirs.has(entry)) walk(fullPath);
        } else if (stat.isFile()) {
          const ext = entry.substring(entry.lastIndexOf('.'));
          if (sourceExtensions.has(ext) && stat.size < 20_000) {
            const content = readFileSync(fullPath, 'utf-8');
            const relPath = relative(appDir, fullPath).replace(/\\/g, '/');
            files.set(relPath, content);
            totalSize += content.length;
          }
        }
      } catch { /* skip unreadable files */ }
    }
  }

  walk(appDir);
  return files;
}

function formatSourceForPrompt(files: Map<string, string>): string {
  const lines: string[] = ['App source files:\n'];

  for (const [path, content] of files) {
    lines.push(`--- ${path} ---`);
    lines.push(content);
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// GENERATOR
// =============================================================================

/**
 * Generate concrete edits for a goal using an LLM.
 *
 * @param goal - The goal to implement
 * @param grounding - App's grounded reality
 * @param appDir - Absolute path to the app directory
 * @param llm - LLM call function
 * @param systemPromptOverride - Optional system prompt (used by Claude brain for domain-aware generation)
 * @returns Generated submission with edits + predicates + cost
 */
export async function generateEdits(
  goal: GeneratedGoal,
  grounding: GroundingContext,
  appDir: string,
  llm: LLMCallFn,
  systemPromptOverride?: string,
): Promise<{ submission: GeneratedSubmission; cost: LLMCallResult }> {
  const sourceFiles = readSourceFiles(appDir);
  const sourceText = formatSourceForPrompt(sourceFiles);

  const userPrompt = `Goal: ${goal.goal}

Category: ${goal.category}
Difficulty: ${goal.difficulty}

Goal predicates (you may refine these based on the source):
${JSON.stringify(goal.predicates, null, 2)}

${sourceText}

Produce search/replace edits that implement this goal. The search strings must be
exact copies from the source files above. Use the actual file paths shown.`;

  const result = await llm(systemPromptOverride ?? SYSTEM_PROMPT, userPrompt);
  const submission = parseEditResponse(result.text, goal);

  return { submission, cost: result };
}

/**
 * Parse LLM response into a GeneratedSubmission.
 */
function parseEditResponse(text: string, goal: GeneratedGoal): GeneratedSubmission {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try direct parse
  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // Try extracting JSON object from surrounding text
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        parsed = JSON.parse(objMatch[0]);
      } catch { /* fall through */ }
    }
  }

  if (!parsed) {
    console.error(`  [edit-gen] Failed to parse LLM response as JSON. Response length: ${text.length}`);
    return {
      goal,
      edits: [],
      predicates: goal.predicates,
      expectedOutcome: 'unknown',
      reasoning: 'Failed to parse LLM response',
    };
  }

  // Validate edits
  const edits: Edit[] = [];
  if (Array.isArray(parsed.edits)) {
    for (const e of parsed.edits) {
      if (typeof e.file === 'string' && typeof e.search === 'string' && typeof e.replace === 'string') {
        // Skip empty or identity edits
        if (e.search === e.replace) continue;
        if (e.search.trim() === '') continue;
        edits.push({ file: e.file, search: e.search, replace: e.replace });
      }
    }
  }

  // Validate predicates
  const predicates: Predicate[] = [];
  if (Array.isArray(parsed.predicates)) {
    for (const p of parsed.predicates) {
      if (p.type) predicates.push(p as Predicate);
    }
  }

  return {
    goal,
    edits,
    predicates: predicates.length > 0 ? predicates : goal.predicates,
    expectedOutcome: parsed.expectedOutcome === 'pass' || parsed.expectedOutcome === 'fail'
      ? parsed.expectedOutcome : 'unknown',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}
