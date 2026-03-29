#!/usr/bin/env bun
/**
 * stage-a11y-advanced.ts — A11y Advanced Scenario Stager
 *
 * Covers zero-coverage a11y shapes from FAILURE-TAXONOMY.md:
 *   A11Y-01: Missing form label association
 *   A11Y-04: Color contrast below WCAG threshold
 *   A11Y-06: Semantic element replaced with div
 *   A11Y-07: Image alt text missing or generic
 *   A11Y-08: Live region announcement missing
 *
 * Pure tier — tests a11y gate with source-level checks.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/a11y-advanced-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `a11y-adv-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// A11Y-01: Missing form label association
// =============================================================================

push({
  description: 'A11Y-01: Input with associated label — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <form><label for="email">Email</label><input id="email" type="email"></form>',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'aria_label',
    selector: 'input',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'missing_label', 'A11Y-01'],
});

push({
  description: 'A11Y-01: Input without label — fails a11y gate',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <form><input type="email" placeholder="Email"></form>',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'aria_label',
    selector: 'input',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'a11y',
  tags: ['a11y', 'missing_label', 'A11Y-01'],
});

push({
  description: 'A11Y-01: Form label on non-existent element — grounding fails',
  edits: [],
  predicates: [{
    type: 'html',
    selector: 'label[for="nonexistent-field"]',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['a11y', 'missing_label', 'A11Y-01'],
});

// =============================================================================
// A11Y-04: Color contrast below WCAG threshold
// =============================================================================

push({
  description: 'A11Y-04: High contrast text — passes a11y gate',
  edits: [{
    file: 'server.js',
    search: 'color: #e0e0e0;',
    replace: 'color: #ffffff;',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'color_contrast',
    selector: 'body',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'color_contrast', 'A11Y-04'],
});

push({
  description: 'A11Y-04: Low contrast text — fails a11y gate',
  edits: [{
    file: 'server.js',
    search: 'color: #e0e0e0;',
    replace: 'color: #2a2a3e;',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'color_contrast',
    selector: 'body',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'a11y',
  tags: ['a11y', 'color_contrast', 'A11Y-04'],
});

push({
  description: 'A11Y-04: Contrast on non-existent element — grounding fails',
  edits: [],
  predicates: [{
    type: 'css',
    selector: '.low-contrast-badge',
    property: 'color',
    expected: '#333',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['a11y', 'color_contrast', 'A11Y-04'],
});

// =============================================================================
// A11Y-06: Semantic element replaced with div
// =============================================================================

push({
  description: 'A11Y-06: Semantic button element — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <button type="submit">Save</button>',
  }],
  predicates: [{
    type: 'html',
    selector: 'button',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'semantic_replaced_div', 'A11Y-06'],
});

push({
  description: 'A11Y-06: Div with onclick replacing button — passes grounding (div exists)',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <div onclick="save()" role="button">Save</div>',
  }],
  predicates: [{
    type: 'html',
    selector: 'div[role="button"]',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'semantic_replaced_div', 'A11Y-06'],
});

push({
  description: 'A11Y-06: Semantic nav element claim — not in source',
  edits: [],
  predicates: [{
    type: 'html',
    selector: 'nav[aria-label="main"]',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['a11y', 'semantic_replaced_div', 'A11Y-06'],
});

// =============================================================================
// A11Y-07: Image alt text missing or generic
// =============================================================================

push({
  description: 'A11Y-07: Image with descriptive alt — passes a11y',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <img src="logo.png" alt="Company logo with blue shield">',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'alt_text',
    selector: 'img',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'alt_text_missing', 'A11Y-07'],
});

push({
  description: 'A11Y-07: Image without alt — fails a11y gate',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <img src="logo.png">',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'alt_text',
    selector: 'img',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'a11y',
  tags: ['a11y', 'alt_text_missing', 'A11Y-07'],
});

push({
  description: 'A11Y-07: Image with generic alt "image" — fails a11y gate',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <img src="logo.png" alt="image">',
  }],
  predicates: [{
    type: 'a11y',
    a11yCheck: 'alt_text',
    selector: 'img',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'a11y',
  tags: ['a11y', 'alt_text_missing', 'A11Y-07'],
});

// =============================================================================
// A11Y-08: Live region announcement missing
// =============================================================================

push({
  description: 'A11Y-08: Element with aria-live — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <div aria-live="polite" id="status">Ready</div>',
  }],
  predicates: [{
    type: 'html',
    selector: '[aria-live]',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: true,
  tags: ['a11y', 'live_region_missing', 'A11Y-08'],
});

push({
  description: 'A11Y-08: Missing aria-live region — not in source',
  edits: [],
  predicates: [{
    type: 'html',
    selector: '[aria-live="assertive"]',
    expected: 'exists',
    path: '/',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['a11y', 'live_region_missing', 'A11Y-08'],
});

push({
  description: 'A11Y-08: Dynamic live region update claim — fabricated',
  edits: [],
  predicates: [{
    type: 'content',
    file: 'server.js',
    pattern: 'aria-live="polite"',
  }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['a11y', 'live_region_missing', 'A11Y-08'],
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const tagCounts: Record<string, number> = {};
for (const s of scenarios) {
  const tag = s.tags[2] || s.tags[1] || 'unknown';
  tagCounts[tag] = (tagCounts[tag] || 0) + 1;
}

console.log(`Generated ${scenarios.length} a11y advanced scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
