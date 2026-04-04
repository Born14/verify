/**
 * Directive-Driven Improvement — `improve-directive.md`
 * =====================================================
 *
 * Inspired by AutoAgent's `program.md` pattern: instead of hardcoding
 * improvement strategy in TypeScript, operators write a Markdown directive
 * that the LLM diagnosis + fix prompts consume.
 *
 * This lets users say "prioritize security gate accuracy" or "focus on
 * reducing false positives" without changing source code.
 *
 * The directive is optional. When absent, the improve loop runs with its
 * default strategy (fix all dirty scenarios, prefer minimal edits).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// DIRECTIVE LOADING
// =============================================================================

export interface ImproveDirective {
  /** Raw markdown content */
  raw: string;
  /** Extracted priority gates (if any) */
  priorityGates: string[];
  /** Extracted focus mode: 'false_positives' | 'false_negatives' | 'all' */
  focus: 'false_positives' | 'false_negatives' | 'all';
  /** Max edit complexity preference: 'minimal' | 'moderate' | 'aggressive' */
  editStyle: 'minimal' | 'moderate' | 'aggressive';
  /** Custom instructions injected verbatim into LLM prompts */
  customInstructions: string;
}

const DEFAULT_DIRECTIVE: ImproveDirective = {
  raw: '',
  priorityGates: [],
  focus: 'all',
  editStyle: 'minimal',
  customInstructions: '',
};

/**
 * Load and parse the improve directive from `improve-directive.md`.
 *
 * The directive supports structured YAML-like headers and free-form
 * instructions:
 *
 * ```markdown
 * # Improve Directive
 *
 * priority-gates: security, grounding, http
 * focus: false_positives
 * edit-style: minimal
 *
 * ## Custom Instructions
 *
 * When fixing security gate false positives, prefer tightening the
 * detection regex over adding new special cases. The security gate
 * should never whitelist known-dangerous patterns.
 * ```
 */
export function loadDirective(packageRoot: string, directivePath?: string): ImproveDirective {
  const path = directivePath
    ? join(packageRoot, directivePath)
    : join(packageRoot, 'improve-directive.md');

  if (!existsSync(path)) return DEFAULT_DIRECTIVE;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return DEFAULT_DIRECTIVE;
  }

  if (!raw.trim()) return DEFAULT_DIRECTIVE;

  return parseDirective(raw);
}

function parseDirective(raw: string): ImproveDirective {
  const directive: ImproveDirective = { ...DEFAULT_DIRECTIVE, raw };

  const lines = raw.split('\n');

  // Extract structured key-value pairs (YAML-like)
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();

    const gatesMatch = trimmed.match(/^priority[- ]gates?:\s*(.+)/);
    if (gatesMatch) {
      directive.priorityGates = gatesMatch[1]
        .split(/[,;]/)
        .map(g => g.trim())
        .filter(Boolean);
    }

    const focusMatch = trimmed.match(/^focus:\s*(.+)/);
    if (focusMatch) {
      const val = focusMatch[1].trim();
      if (val.includes('false_positive') || val.includes('false positive')) {
        directive.focus = 'false_positives';
      } else if (val.includes('false_negative') || val.includes('false negative')) {
        directive.focus = 'false_negatives';
      }
    }

    const styleMatch = trimmed.match(/^edit[- ]style:\s*(.+)/);
    if (styleMatch) {
      const val = styleMatch[1].trim();
      if (val.includes('aggressive')) directive.editStyle = 'aggressive';
      else if (val.includes('moderate')) directive.editStyle = 'moderate';
      // 'minimal' is default
    }
  }

  // Extract ## Custom Instructions section
  const customIdx = raw.search(/^##\s*Custom\s*Instructions/mi);
  if (customIdx >= 0) {
    const afterHeader = raw.substring(customIdx);
    const lines = afterHeader.split('\n').slice(1); // skip the header line

    // Collect until next ## header or end of file
    const instructionLines: string[] = [];
    for (const line of lines) {
      if (/^##\s/.test(line)) break;
      instructionLines.push(line);
    }
    directive.customInstructions = instructionLines.join('\n').trim();
  }

  return directive;
}

// =============================================================================
// PROMPT INJECTION — format directive for LLM consumption
// =============================================================================

/**
 * Format the directive as a prompt block for injection into
 * diagnosis and fix generation prompts.
 *
 * Returns empty string when no directive is loaded.
 */
export function formatDirectiveForPrompt(directive: ImproveDirective): string {
  if (!directive.raw) return '';

  const sections: string[] = [];

  sections.push('OPERATOR DIRECTIVE (follow these priorities):');

  if (directive.priorityGates.length > 0) {
    sections.push(`  Priority gates: ${directive.priorityGates.join(', ')}`);
  }

  if (directive.focus !== 'all') {
    const focusLabel = directive.focus === 'false_positives'
      ? 'Reduce false positives (verify passes when it should fail)'
      : 'Reduce false negatives (verify fails when it should pass)';
    sections.push(`  Focus: ${focusLabel}`);
  }

  if (directive.editStyle !== 'minimal') {
    sections.push(`  Edit style: ${directive.editStyle} (${
      directive.editStyle === 'aggressive'
        ? 'larger refactors acceptable'
        : 'moderate changes OK when needed'
    })`);
  }

  if (directive.customInstructions) {
    sections.push(`\n  Custom instructions:\n  ${directive.customInstructions.replace(/\n/g, '\n  ')}`);
  }

  return '\n' + sections.join('\n') + '\n';
}

// =============================================================================
// BUNDLE FILTERING — apply directive to bundle prioritization
// =============================================================================

/**
 * Sort and filter bundles based on directive priorities.
 * Priority gates are processed first. Non-priority bundles are kept
 * but sorted after priority bundles.
 */
export function applyDirectiveToBundles<T extends { triage: { targetFile: string | null } }>(
  bundles: T[],
  directive: ImproveDirective,
): T[] {
  if (directive.priorityGates.length === 0) return bundles;

  const gateFiles = new Set(
    directive.priorityGates.map(g => `src/gates/${g.toLowerCase()}.ts`)
  );

  const priority: T[] = [];
  const rest: T[] = [];

  for (const b of bundles) {
    if (b.triage.targetFile && gateFiles.has(b.triage.targetFile)) {
      priority.push(b);
    } else {
      rest.push(b);
    }
  }

  return [...priority, ...rest];
}
