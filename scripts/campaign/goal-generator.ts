/**
 * Goal Generator — LLM-Produced Diverse Goals From Grounding Context
 * ===================================================================
 *
 * Uses a cheap LLM (Gemini Flash) to produce diverse goals with predicates
 * from an app's grounding context. Each goal targets a specific verify gate
 * or category to maximize fault discovery surface.
 */

import type { GroundingContext, Predicate } from '../../src/types.js';
import type { AppEntry, GoalCategory, GoalDifficulty, GeneratedGoal, LLMCallFn, LLMCallResult } from './types.js';
import { CLAUDE_GOAL_SYSTEM } from './claude-brain.js';

// =============================================================================
// PROMPTS
// =============================================================================

const SYSTEM_PROMPT = `You are a test goal generator for a code verification system called "verify".
Your job is to produce diverse goals that stress-test verify's gates.

Each goal must include:
1. A natural-language goal description (what the user wants to change)
2. Predicates — testable claims about what should be true AFTER the change
3. A difficulty rating
4. Which verify gate this goal is designed to stress (if any)

Predicate types you can use:
- css: { type: "css", selector: ".class", property: "color", expected: "red", path: "/" }
- html: { type: "html", selector: "h1", expected: "exists", path: "/" }
- content: { type: "content", file: "server.js", pattern: "some string" }
- http: { type: "http", method: "GET", path: "/api/test", expect: { status: 200 } }

Rules:
- Use REAL selectors from the grounding context, not fabricated ones
- CSS expected values should use computed-style format (rgb(255, 0, 0) not "red")
- Each goal should be independently achievable with search/replace edits
- Predicates must be verifiable by automated tools (no subjective assessments)
- Vary the difficulty: some should be trivial, some should be tricky

Respond with a JSON array of goals. No markdown fencing, just raw JSON.`;

function buildCategoryInstructions(categories: GoalCategory[]): string {
  const instructions: Record<GoalCategory, string> = {
    css_change: 'Generate goals that change CSS properties (colors, fonts, spacing, layout). Use real selectors from the grounding.',
    html_mutation: 'Generate goals that add/modify HTML elements or text content. Focus on structural changes.',
    route_addition: 'Generate goals that add new pages or API endpoints. Include predicates for the new route.',
    http_behavior: 'Generate goals about API behavior — status codes, response bodies, headers.',
    mixed_surface: 'Generate goals that span CSS + HTML + logic changes. Test containment attribution.',
    adversarial_predicate: 'Generate goals with predicates designed to fool verify — data-dependent selectors, timing-sensitive checks, predicates that look valid but reference non-existent elements.',
    grounding_probe: 'Generate goals that probe grounding completeness — CSS in @import files, custom properties, Tailwind classes, dynamic styles.',
    edge_case: 'Generate goals with edge cases — unicode in selectors, very long values, !important chains, empty strings.',
  };

  return categories.map(c => `- ${c}: ${instructions[c]}`).join('\n');
}

function formatGroundingForPrompt(grounding: GroundingContext, app: AppEntry): string {
  const lines: string[] = [];

  lines.push(`App: ${app.name} (${app.stackType}, ${app.complexity})`);
  if (app.notes) lines.push(`Notes: ${app.notes}`);
  lines.push('');

  // Routes
  lines.push('Available routes:');
  for (const route of grounding.routes) {
    lines.push(`  ${route}`);
  }
  lines.push('');

  // CSS selectors by route
  lines.push('CSS selectors by route:');
  for (const [route, selectorMap] of grounding.routeCSSMap) {
    lines.push(`  ${route}:`);
    for (const [selector, props] of selectorMap) {
      const propList = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('; ');
      lines.push(`    ${selector} { ${propList} }`);
    }
  }
  lines.push('');

  // HTML elements by route
  lines.push('HTML elements by route:');
  for (const [route, elements] of grounding.htmlElements) {
    lines.push(`  ${route}:`);
    for (const el of elements.slice(0, 20)) { // Cap to avoid prompt bloat
      const text = el.text ? ` "${el.text.slice(0, 50)}"` : '';
      lines.push(`    <${el.tag}>${text}`);
    }
    if (elements.length > 20) {
      lines.push(`    ... and ${elements.length - 20} more elements`);
    }
  }

  // DB schema
  if (grounding.dbSchema && grounding.dbSchema.length > 0) {
    lines.push('');
    lines.push('Database tables:');
    for (const table of grounding.dbSchema) {
      const cols = table.columns.map((c: any) => `${c.name} ${c.type}`).join(', ');
      lines.push(`  ${table.table}: ${cols}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// GENERATOR
// =============================================================================

/**
 * Generate diverse goals from grounding context using an LLM.
 *
 * @param grounding - The app's grounded reality (CSS, HTML, routes, schema)
 * @param app - App metadata for context
 * @param count - Number of goals to generate
 * @param llm - LLM call function
 * @param categories - Optional category focus (null = diverse)
 * @param systemPromptOverride - Optional system prompt (used by Claude brain for domain-aware generation)
 * @returns Generated goals + LLM cost
 */
export async function generateGoals(
  grounding: GroundingContext,
  app: AppEntry,
  count: number,
  llm: LLMCallFn,
  categories?: GoalCategory[],
  systemPromptOverride?: string,
): Promise<{ goals: GeneratedGoal[]; cost: LLMCallResult }> {
  const groundingText = formatGroundingForPrompt(grounding, app);

  let userPrompt = `Generate ${count} diverse verification goals for this app.\n\n`;
  userPrompt += groundingText + '\n\n';

  if (categories && categories.length > 0) {
    userPrompt += 'Focus on these categories:\n';
    userPrompt += buildCategoryInstructions(categories) + '\n\n';
  } else {
    userPrompt += 'Generate a diverse mix across categories: css_change, html_mutation, route_addition, http_behavior, mixed_surface.\n\n';
  }

  userPrompt += `Respond with a JSON array of ${count} objects, each with:
{
  "goal": "description",
  "predicates": [ { "type": "css", "selector": "...", "property": "...", "expected": "...", "path": "/" } ],
  "difficulty": "trivial|moderate|hard|adversarial",
  "targetGate": "browser|http|staging|containment|constraints|null",
  "category": "css_change|html_mutation|route_addition|http_behavior|mixed_surface|adversarial_predicate|grounding_probe|edge_case"
}`;

  const result = await llm(systemPromptOverride ?? SYSTEM_PROMPT, userPrompt);

  // Parse response
  const goals = parseGoalResponse(result.text, count);

  return { goals, cost: result };
}

/**
 * Parse LLM response into GeneratedGoal[].
 * Handles markdown fencing, trailing commas, and partial responses.
 */
function parseGoalResponse(text: string, expectedCount: number): GeneratedGoal[] {
  // Strip markdown code fences if present
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try direct parse
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return validateGoals(parsed);
    if (parsed.goals && Array.isArray(parsed.goals)) return validateGoals(parsed.goals);
  } catch { /* fall through */ }

  // Try extracting JSON array from surrounding text
  const arrayMatch = clean.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return validateGoals(parsed);
    } catch { /* fall through */ }
  }

  console.error(`  [goal-gen] Failed to parse LLM response as JSON array. Response length: ${text.length}`);
  return [];
}

/**
 * Validate and normalize parsed goals.
 */
function validateGoals(raw: any[]): GeneratedGoal[] {
  const goals: GeneratedGoal[] = [];

  for (const item of raw) {
    if (!item.goal || typeof item.goal !== 'string') continue;

    const predicates: Predicate[] = [];
    if (Array.isArray(item.predicates)) {
      for (const p of item.predicates) {
        if (!p.type) continue;
        predicates.push(p as Predicate);
      }
    }

    // Must have at least one predicate
    if (predicates.length === 0) continue;

    goals.push({
      goal: item.goal,
      predicates,
      difficulty: validateDifficulty(item.difficulty),
      targetGate: typeof item.targetGate === 'string' ? item.targetGate : null,
      category: validateCategory(item.category),
    });
  }

  return goals;
}

function validateDifficulty(d: unknown): GoalDifficulty {
  if (d === 'trivial' || d === 'moderate' || d === 'hard' || d === 'adversarial') return d;
  return 'moderate';
}

function validateCategory(c: unknown): GoalCategory {
  const valid: GoalCategory[] = [
    'css_change', 'html_mutation', 'route_addition', 'http_behavior',
    'mixed_surface', 'adversarial_predicate', 'grounding_probe', 'edge_case',
  ];
  if (typeof c === 'string' && valid.includes(c as GoalCategory)) return c as GoalCategory;
  return 'css_change';
}
