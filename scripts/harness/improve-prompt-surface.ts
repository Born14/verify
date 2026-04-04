/**
 * Prompt Surface — Tunable LLM Prompts Within Gates
 * ==================================================
 *
 * Inspired by AutoAgent's concept of "editable surfaces" that include
 * system prompts and configuration, not just logic.
 *
 * Some verify gates contain LLM prompts (vision.ts) or tunable thresholds
 * (triangulation.ts). These are valid optimization targets for the improve
 * loop — the prompt wording directly affects gate accuracy.
 *
 * This module:
 * 1. Defines which prompt regions in which files are tunable
 * 2. Extends the bounded surface to include these regions
 * 3. Provides context to the LLM fix generator about what's a prompt
 *    vs. what's logic (so it prefers prompt edits for prompt-related failures)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// =============================================================================
// PROMPT SURFACE DEFINITIONS
// =============================================================================

export interface PromptRegion {
  /** File path relative to package root */
  file: string;
  /** Function that contains the prompt */
  functionName: string;
  /** Description of what this prompt does */
  description: string;
  /** Marker strings that delimit the prompt region */
  startMarker: string;
  endMarker: string;
  /** What kind of tuning is appropriate */
  tuningAdvice: string;
}

/**
 * Known prompt regions within gate files.
 * These are LLM prompts or tunable configuration that the improve
 * loop can optimize when --prompt-surface is enabled.
 */
export const PROMPT_REGIONS: ReadonlyArray<PromptRegion> = [
  {
    file: 'src/gates/vision.ts',
    functionName: 'buildVisionPrompt()',
    description: 'System prompt for vision model screenshot verification',
    startMarker: 'You are verifying a web application screenshot',
    endMarker: '${numbered}`;',
    tuningAdvice: 'Tune claim verification instructions. Be precise about what VERIFIED/NOT VERIFIED means. Do not change the response format (CLAIM N: VERIFIED/NOT VERIFIED).',
  },
  {
    file: 'src/gates/triangulation.ts',
    functionName: 'triangulate()',
    description: 'Triangulation thresholds and weighting logic',
    startMarker: '// Weights for each authority',
    endMarker: '// End weights',
    tuningAdvice: 'Tune authority weights and agreement thresholds. The deterministic authority (grounding) should generally have highest weight. Do not change the 3-authority architecture.',
  },
  {
    file: 'src/gates/hallucination.ts',
    functionName: 'runHallucinationGate()',
    description: 'Hallucination detection heuristics and thresholds',
    startMarker: '// Hallucination detection thresholds',
    endMarker: '// End thresholds',
    tuningAdvice: 'Tune similarity thresholds and confidence levels. Lower thresholds catch more hallucinations but increase false positives.',
  },
];

// =============================================================================
// PROMPT SURFACE INTEGRATION
// =============================================================================

/**
 * Check if a file + function is a known prompt region.
 */
export function isPromptRegion(file: string, functionName?: string): PromptRegion | null {
  for (const region of PROMPT_REGIONS) {
    if (region.file === file) {
      if (!functionName || region.functionName.includes(functionName.replace(/\(\)$/, ''))) {
        return region;
      }
    }
  }
  return null;
}

/**
 * Extract the actual prompt text from a file for a given region.
 * Returns the lines between startMarker and endMarker, or null if not found.
 */
export function extractPromptRegion(
  packageRoot: string,
  region: PromptRegion,
): { text: string; startLine: number; endLine: number } | null {
  const filePath = join(packageRoot, region.file);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const startIdx = lines.findIndex(l => l.includes(region.startMarker));
  if (startIdx < 0) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].includes(region.endMarker)) {
      endIdx = i + 1;
      break;
    }
  }

  return {
    text: lines.slice(startIdx, endIdx).join('\n'),
    startLine: startIdx + 1, // 1-based
    endLine: endIdx,
  };
}

/**
 * Format prompt surface context for injection into fix generation prompts.
 * Tells the LLM which regions are prompts and how to tune them.
 */
export function formatPromptSurfaceContext(
  packageRoot: string,
  targetFile: string,
): string {
  const regions = PROMPT_REGIONS.filter(r => r.file === targetFile);
  if (regions.length === 0) return '';

  const sections: string[] = [
    '\nPROMPT SURFACE — The following regions contain LLM prompts or tunable thresholds.',
    'When the failure is related to prompt interpretation (vision claims, triangulation weighting),',
    'prefer tuning the prompt/threshold over changing surrounding logic.\n',
  ];

  for (const region of regions) {
    const extracted = extractPromptRegion(packageRoot, region);
    sections.push(`  PROMPT REGION: ${region.functionName} in ${region.file}`);
    sections.push(`  Description: ${region.description}`);
    sections.push(`  Tuning advice: ${region.tuningAdvice}`);
    if (extracted) {
      sections.push(`  Lines ${extracted.startLine}-${extracted.endLine}:`);
      sections.push(`  \`\`\`\n${extracted.text}\n  \`\`\``);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Get the list of files that have prompt surfaces.
 * Used to extend the bounded surface when --prompt-surface is enabled.
 */
export function getPromptSurfaceFiles(): string[] {
  return [...new Set(PROMPT_REGIONS.map(r => r.file))];
}
