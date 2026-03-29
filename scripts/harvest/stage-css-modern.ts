#!/usr/bin/env bun
/**
 * stage-css-modern.ts — Modern CSS Feature Scenario Stager
 *
 * Shapes: C-31, C-63, C-64, C-65, C-66, C-67, C-68
 *   C-31: content property assertion
 *   C-63: color-mix()
 *   C-64: CSS nesting
 *   C-65: @property
 *   C-66: subgrid
 *   C-67: clamp/min/max
 *   C-68: @scope
 *
 * The demo-app /edge-cases route already has:
 *   .nested-rule { color: red; & .child { color: blue; } }   (C-64)
 *   .clamp-width { width: clamp(200px, 50%, 800px); }        (C-67)
 *   .color-mix-test { color: color-mix(in srgb, red 50%, blue); }  (C-63)
 *   .meta-test { content: 'meta'; }                           (C-31)
 *   .grid-container { display: grid; ... }                    (base for C-66)
 *
 * Run: bun scripts/harvest/stage-css-modern.ts
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
  rationale: string;
}

const scenarios: Scenario[] = [];
let counter = 0;

function nextId(prefix: string): string {
  return `cmod-${prefix}-${String(++counter).padStart(3, '0')}`;
}

function push(
  prefix: string,
  desc: string,
  edits: Scenario['edits'],
  predicates: Scenario['predicates'],
  success: boolean,
  tags: string[],
  rationale: string,
  failedGate?: string,
) {
  const entry: Scenario = {
    id: nextId(prefix),
    description: desc,
    edits,
    predicates,
    expectedSuccess: success,
    tags: ['css-modern', ...tags],
    rationale,
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// =============================================================================
// C-31: content property assertion
// The `content` CSS property is used for ::before/::after pseudo-elements and
// occasionally on regular elements. Verifying it requires understanding that
// content values are quoted strings in CSS.
// =============================================================================

push('c31', 'C-31: content property on existing element — passes',
  [],
  [{ type: 'css', selector: '.meta-test', property: 'content', expected: "'meta'" }],
  true,
  ['content-property', 'C-31'],
  'The .meta-test rule in /edge-cases has content: \'meta\'. Predicate matches existing value.',
);

push('c31', 'C-31: content property with wrong value — grounding mismatch',
  [],
  [{ type: 'css', selector: '.meta-test', property: 'content', expected: "'other'" }],
  false,
  ['content-property', 'C-31'],
  'The .meta-test has content: \'meta\' but predicate expects \'other\'. Value mismatch at grounding.',
  'grounding',
);

push('c31', 'C-31: content property injected via edit — passes',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: '.meta-test { content: \'meta\'; }\n    .content-after { content: "Added via edit"; }',
  }],
  [{ type: 'css', selector: '.content-after', property: 'content', expected: '"Added via edit"' }],
  true,
  ['content-property', 'C-31'],
  'Injecting a new rule with content property. Predicate verifies the edit was applied.',
);

push('c31', 'C-31: content property on fabricated selector — grounding fails',
  [],
  [{ type: 'css', selector: '.nonexistent-content', property: 'content', expected: "'hello'" }],
  false,
  ['content-property', 'C-31'],
  'Selector .nonexistent-content does not exist anywhere. Grounding gate rejects fabricated selector.',
  'grounding',
);

// =============================================================================
// C-63: color-mix()
// CSS Color Level 5 function. The demo-app has:
//   .color-mix-test { color: color-mix(in srgb, red 50%, blue); }
// =============================================================================

push('c63', 'C-63: color-mix value exists in source — passes grounding',
  [],
  [{ type: 'css', selector: '.color-mix-test', property: 'color', expected: 'color-mix(in srgb, red 50%, blue)' }],
  true,
  ['color-mix', 'C-63'],
  'The .color-mix-test rule has this exact color-mix value. Grounding finds it.',
);

push('c63', 'C-63: color-mix with different color space — grounding mismatch',
  [],
  [{ type: 'css', selector: '.color-mix-test', property: 'color', expected: 'color-mix(in oklch, red 50%, blue)' }],
  false,
  ['color-mix', 'C-63'],
  'Source uses "in srgb" but predicate expects "in oklch". Value mismatch.',
  'grounding',
);

push('c63', 'C-63: color-mix injected with percentages — passes',
  [{
    file: 'server.js',
    search: '.color-mix-test { color: color-mix(in srgb, red 50%, blue); }',
    replace: '.color-mix-test { color: color-mix(in srgb, red 50%, blue); }\n    .mix-bg { background: color-mix(in oklch, #ff6600 30%, #0066ff 70%); }',
  }],
  [{ type: 'css', selector: '.mix-bg', property: 'background', expected: 'color-mix(in oklch, #ff6600 30%, #0066ff 70%)' }],
  true,
  ['color-mix', 'C-63'],
  'New color-mix rule injected via edit. Predicate verifies the new selector and value.',
);

push('c63', 'C-63: color-mix fabricated selector — grounding fails',
  [],
  [{ type: 'css', selector: '.fancy-mix', property: 'background-color', expected: 'color-mix(in hsl, green 25%, yellow)' }],
  false,
  ['color-mix', 'C-63'],
  'Selector .fancy-mix does not exist. Color-mix value is valid CSS but the selector is fabricated.',
  'grounding',
);

// =============================================================================
// C-64: CSS nesting
// Native CSS nesting using & syntax. The demo-app has:
//   .nested-rule { color: red; & .child { color: blue; } }
// =============================================================================

push('c64', 'C-64: nested rule parent selector — passes',
  [],
  [{ type: 'css', selector: '.nested-rule', property: 'color', expected: 'red' }],
  true,
  ['css-nesting', 'C-64'],
  'The .nested-rule parent has color: red. Nesting does not affect parent extraction.',
);

push('c64', 'C-64: nested child selector via & — depends on parser depth',
  [],
  [{ type: 'css', selector: '.nested-rule .child', property: 'color', expected: 'blue' }],
  false,
  ['css-nesting', 'C-64'],
  'The nested & .child rule may not be extractable as .nested-rule .child by a flat CSS parser. Grounding depends on nesting support.',
  'grounding',
);

push('c64', 'C-64: inject deeper nesting — passes parent level',
  [{
    file: 'server.js',
    search: '.nested-rule { color: red; & .child { color: blue; } }',
    replace: '.nested-rule { color: red; & .child { color: blue; } }\n    .nest-deep { font-size: 16px; & .level1 { margin: 4px; & .level2 { padding: 2px; } } }',
  }],
  [{ type: 'css', selector: '.nest-deep', property: 'font-size', expected: '16px' }],
  true,
  ['css-nesting', 'C-64'],
  'New nested rule injected. Parent-level property is extractable by any parser.',
);

push('c64', 'C-64: nesting with wrong parent value — grounding mismatch',
  [],
  [{ type: 'css', selector: '.nested-rule', property: 'color', expected: 'green' }],
  false,
  ['css-nesting', 'C-64'],
  'The .nested-rule has color: red but predicate expects green.',
  'grounding',
);

// =============================================================================
// C-65: @property (CSS Houdini)
// Registered custom properties with syntax, initial value, and inheritance.
// Not in demo-app yet — must be injected via edits.
// =============================================================================

push('c65', 'C-65: @property rule injected — content predicate verifies presence',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: "@property --brand-color { syntax: '<color>'; initial-value: #3498db; inherits: false; }\n    .meta-test { content: 'meta'; }",
  }],
  [{ type: 'content', file: 'server.js', pattern: "@property --brand-color" }],
  true,
  ['css-houdini', 'C-65'],
  'Injecting an @property declaration. Content predicate verifies it exists in the source.',
);

push('c65', 'C-65: @property custom property used in rule — passes',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: "@property --accent { syntax: '<color>'; initial-value: #e74c3c; inherits: true; }\n    .meta-test { content: 'meta'; }\n    .accent-box { color: var(--accent); }",
  }],
  [{ type: 'css', selector: '.accent-box', property: 'color', expected: 'var(--accent)' }],
  true,
  ['css-houdini', 'C-65'],
  'Custom property declared via @property and consumed with var(). Grounding sees the rule.',
);

push('c65', 'C-65: @property not present — fabricated content predicate',
  [],
  [{ type: 'content', file: 'server.js', pattern: '@property --magic-var' }],
  false,
  ['css-houdini', 'C-65'],
  'No @property --magic-var exists in source. Content predicate correctly fails.',
  'grounding',
);

// =============================================================================
// C-66: subgrid
// CSS Subgrid allows child grids to inherit parent grid tracks.
// Not in demo-app yet — inject via edits on the grid-container area.
// =============================================================================

push('c66', 'C-66: subgrid injected on child — passes',
  [{
    file: 'server.js',
    search: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; }',
    replace: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; }\n    .grid-child { display: grid; grid-template-rows: subgrid; }',
  }],
  [{ type: 'css', selector: '.grid-child', property: 'grid-template-rows', expected: 'subgrid' }],
  true,
  ['subgrid', 'C-66'],
  'Injecting a child grid with subgrid value. Predicate verifies the new rule.',
);

push('c66', 'C-66: subgrid on columns — passes',
  [{
    file: 'server.js',
    search: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; }',
    replace: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; }\n    .grid-sub-cols { display: grid; grid-template-columns: subgrid; }',
  }],
  [{ type: 'css', selector: '.grid-sub-cols', property: 'grid-template-columns', expected: 'subgrid' }],
  true,
  ['subgrid', 'C-66'],
  'Subgrid applied to columns axis. Predicate matches injected rule.',
);

push('c66', 'C-66: subgrid on fabricated selector — grounding fails',
  [],
  [{ type: 'css', selector: '.subgrid-phantom', property: 'grid-template-rows', expected: 'subgrid' }],
  false,
  ['subgrid', 'C-66'],
  'Selector .subgrid-phantom does not exist. Grounding rejects fabricated selector.',
  'grounding',
);

// =============================================================================
// C-67: clamp/min/max
// CSS math functions. Demo-app has:
//   .clamp-width { width: clamp(200px, 50%, 800px); }
// =============================================================================

push('c67', 'C-67: clamp() value exists — passes',
  [],
  [{ type: 'css', selector: '.clamp-width', property: 'width', expected: 'clamp(200px, 50%, 800px)' }],
  true,
  ['css-math', 'C-67'],
  'Exact clamp() value matches the existing rule in /edge-cases.',
);

push('c67', 'C-67: clamp() with wrong bounds — grounding mismatch',
  [],
  [{ type: 'css', selector: '.clamp-width', property: 'width', expected: 'clamp(100px, 50%, 600px)' }],
  false,
  ['css-math', 'C-67'],
  'Source has clamp(200px, 50%, 800px) but predicate expects different bounds.',
  'grounding',
);

push('c67', 'C-67: min() function injected — passes',
  [{
    file: 'server.js',
    search: '.clamp-width { width: clamp(200px, 50%, 800px); }',
    replace: '.clamp-width { width: clamp(200px, 50%, 800px); }\n    .min-height { height: min(400px, 50vh); }',
  }],
  [{ type: 'css', selector: '.min-height', property: 'height', expected: 'min(400px, 50vh)' }],
  true,
  ['css-math', 'C-67'],
  'Injecting a min() function rule. Predicate verifies the new selector.',
);

push('c67', 'C-67: max() function injected — passes',
  [{
    file: 'server.js',
    search: '.clamp-width { width: clamp(200px, 50%, 800px); }',
    replace: '.clamp-width { width: clamp(200px, 50%, 800px); }\n    .max-pad { padding: max(1rem, 2vw); }',
  }],
  [{ type: 'css', selector: '.max-pad', property: 'padding', expected: 'max(1rem, 2vw)' }],
  true,
  ['css-math', 'C-67'],
  'Injecting a max() function rule. Predicate verifies the new selector.',
);

push('c67', 'C-67: nested calc inside clamp — passes',
  [{
    file: 'server.js',
    search: '.clamp-width { width: clamp(200px, 50%, 800px); }',
    replace: '.clamp-width { width: clamp(200px, 50%, 800px); }\n    .calc-clamp { font-size: clamp(14px, calc(1rem + 0.5vw), 22px); }',
  }],
  [{ type: 'css', selector: '.calc-clamp', property: 'font-size', expected: 'clamp(14px, calc(1rem + 0.5vw), 22px)' }],
  true,
  ['css-math', 'C-67'],
  'Nested calc inside clamp — complex math function composition.',
);

// =============================================================================
// C-68: @scope
// CSS scoping via @scope rule. Not in demo-app — must be injected.
// =============================================================================

push('c68', 'C-68: @scope rule injected — content predicate verifies',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: ".meta-test { content: 'meta'; }\n    @scope (.edge-card) { .edge-label { color: #c0392b; } }",
  }],
  [{ type: 'content', file: 'server.js', pattern: '@scope (.edge-card)' }],
  true,
  ['css-scope', 'C-68'],
  'Injecting @scope rule. Content predicate verifies the at-rule exists in source.',
);

push('c68', 'C-68: @scope with to limit — content predicate',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: ".meta-test { content: 'meta'; }\n    @scope (.edge-hero) to (.edge-card) { span { font-weight: 900; } }",
  }],
  [{ type: 'content', file: 'server.js', pattern: '@scope (.edge-hero) to (.edge-card)' }],
  true,
  ['css-scope', 'C-68'],
  'Scoped rule with proximity boundary (to). Content predicate verifies the full at-rule syntax.',
);

push('c68', 'C-68: @scope not present — fabricated content check',
  [],
  [{ type: 'content', file: 'server.js', pattern: '@scope (.sidebar)' }],
  false,
  ['css-scope', 'C-68'],
  'No @scope (.sidebar) exists in source. Fabricated content predicate fails grounding.',
  'grounding',
);

push('c68', 'C-68: @scope injected — CSS rule inside scope verifiable',
  [{
    file: 'server.js',
    search: '.meta-test { content: \'meta\'; }',
    replace: ".meta-test { content: 'meta'; }\n    @scope (.flex-container) { .flex-item { border: 2px solid #2ecc71; } }",
  }],
  [{ type: 'content', file: 'server.js', pattern: '.flex-item { border: 2px solid #2ecc71; }' }],
  true,
  ['css-scope', 'C-68'],
  'CSS rule inside @scope block. Content predicate verifies the inner rule text exists.',
);

// =============================================================================
// Write output
// =============================================================================

const outPath = resolve(__dirname, '../../fixtures/scenarios/css-modern-staged.json');
writeFileSync(outPath, JSON.stringify(scenarios, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);
