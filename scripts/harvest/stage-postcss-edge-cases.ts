#!/usr/bin/env bun
/**
 * stage-postcss-edge-cases.ts — PostCSS Parser Edge Case Scenario Stager
 *
 * Covers extreme CSS parsing edge cases from PostCSS parser test fixtures.
 * These are the cases that break naive CSS parsers — comments in values,
 * escaped characters, empty rules, nested at-rules, unicode escapes, etc.
 *
 * Source: postcss/postcss-parser-tests (24 extreme edge cases)
 * Pure tier — tests grounding gate CSS parsing correctness.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/postcss-edge-cases-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `postcss-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// 1. Comments in various positions
// =============================================================================

push({
  description: 'PostCSS: Comment inside property value — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.test { color: /* red */ blue; }</style>',
  }],
  predicates: [{ type: 'css', selector: '.test', property: 'color', expected: 'blue' }],
  expectedSuccess: true,
  tags: ['postcss', 'comments', 'PCSS-01'],
});

push({
  description: 'PostCSS: Comment between selector and brace — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.test /* comment */ { color: red; }</style>',
  }],
  predicates: [{ type: 'css', selector: '.test', property: 'color', expected: 'red' }],
  expectedSuccess: true,
  tags: ['postcss', 'comments', 'PCSS-01'],
});

push({
  description: 'PostCSS: Comment as only content inside rule — grounding fails',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.empty { /* nothing here */ }</style>',
  }],
  predicates: [{ type: 'css', selector: '.empty', property: 'color', expected: 'red' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'comments', 'PCSS-01'],
});

push({
  description: 'PostCSS: Nested comments — fabricated',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '/* outer /* inner */ outer */' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'comments', 'PCSS-01'],
});

// =============================================================================
// 2. Escaped characters in selectors
// =============================================================================

push({
  description: 'PostCSS: Escaped colon in selector — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.sm\\:flex { display: flex; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'sm\\\\:flex' }],
  expectedSuccess: true,
  tags: ['postcss', 'escaping', 'PCSS-02'],
});

push({
  description: 'PostCSS: Escaped dot in class selector — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.w-1\\.5 { width: 0.375rem; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'w-1\\\\.5' }],
  expectedSuccess: true,
  tags: ['postcss', 'escaping', 'PCSS-02'],
});

push({
  description: 'PostCSS: Unicode escape in selector — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.\\31 a { color: red; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '\\\\31' }],
  expectedSuccess: true,
  tags: ['postcss', 'escaping', 'PCSS-02'],
});

push({
  description: 'PostCSS: Escaped hash in selector — fabricated',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.\\#special-id' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'escaping', 'PCSS-02'],
});

// =============================================================================
// 3. Empty rules and declarations
// =============================================================================

push({
  description: 'PostCSS: Empty rule body — passes content check',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.empty-rule { }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.empty-rule' }],
  expectedSuccess: true,
  tags: ['postcss', 'empty_rules', 'PCSS-03'],
});

push({
  description: 'PostCSS: Declaration with no value — passes content check',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.no-val { color:; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'color:;' }],
  expectedSuccess: true,
  tags: ['postcss', 'empty_rules', 'PCSS-03'],
});

push({
  description: 'PostCSS: Multiple semicolons — passes content check',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.multi { color: red;; ; ; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'color: red;;' }],
  expectedSuccess: true,
  tags: ['postcss', 'empty_rules', 'PCSS-03'],
});

// =============================================================================
// 4. At-rules edge cases
// =============================================================================

push({
  description: 'PostCSS: @media with complex query — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>@media (min-width: 768px) and (max-width: 1024px) { .mid { display: block; } }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'min-width: 768px' }],
  expectedSuccess: true,
  tags: ['postcss', 'at_rules', 'PCSS-04'],
});

push({
  description: 'PostCSS: @supports with not — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>@supports not (display: grid) { .fallback { display: flex; } }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@supports not' }],
  expectedSuccess: true,
  tags: ['postcss', 'at_rules', 'PCSS-04'],
});

push({
  description: 'PostCSS: Nested @media inside @supports — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>@supports (display: grid) { @media (min-width: 768px) { .grid { display: grid; } } }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@supports (display: grid)' }],
  expectedSuccess: true,
  tags: ['postcss', 'at_rules', 'PCSS-04'],
});

push({
  description: 'PostCSS: @layer declaration — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>@layer base, components, utilities;</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@layer base' }],
  expectedSuccess: true,
  tags: ['postcss', 'at_rules', 'PCSS-04'],
});

push({
  description: 'PostCSS: @container query — fabricated',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@container sidebar (min-width: 300px)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'at_rules', 'PCSS-04'],
});

// =============================================================================
// 5. String edge cases in values
// =============================================================================

push({
  description: 'PostCSS: Quoted string with parentheses — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.quote { content: "Hello (world)"; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Hello (world)' }],
  expectedSuccess: true,
  tags: ['postcss', 'strings', 'PCSS-05'],
});

push({
  description: 'PostCSS: URL with special characters — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.bg { background: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'data:image/svg+xml' }],
  expectedSuccess: true,
  tags: ['postcss', 'strings', 'PCSS-05'],
});

push({
  description: 'PostCSS: Escaped quotes in content — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.escaped { content: "She said \\"hello\\""; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'She said' }],
  expectedSuccess: true,
  tags: ['postcss', 'strings', 'PCSS-05'],
});

push({
  description: 'PostCSS: Single quotes in double quoted value — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.mixed { font-family: "Helvetica Neue", \'Arial\', sans-serif; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Helvetica Neue' }],
  expectedSuccess: true,
  tags: ['postcss', 'strings', 'PCSS-05'],
});

// =============================================================================
// 6. Custom properties (CSS variables)
// =============================================================================

push({
  description: 'PostCSS: CSS custom property declaration — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>:root { --primary-color: #3b82f6; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '--primary-color' }],
  expectedSuccess: true,
  tags: ['postcss', 'custom_properties', 'PCSS-06'],
});

push({
  description: 'PostCSS: var() with fallback — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.btn { color: var(--text, #000); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'var(--text' }],
  expectedSuccess: true,
  tags: ['postcss', 'custom_properties', 'PCSS-06'],
});

push({
  description: 'PostCSS: Nested var() fallback — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.nest { color: var(--a, var(--b, red)); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'var(--a, var(--b' }],
  expectedSuccess: true,
  tags: ['postcss', 'custom_properties', 'PCSS-06'],
});

push({
  description: 'PostCSS: Custom property with complex value — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>:root { --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '--shadow: 0 4px' }],
  expectedSuccess: true,
  tags: ['postcss', 'custom_properties', 'PCSS-06'],
});

push({
  description: 'PostCSS: Custom property fabricated — not in source',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '--postcss-internal-variable' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'custom_properties', 'PCSS-06'],
});

// =============================================================================
// 7. Calc and math functions
// =============================================================================

push({
  description: 'PostCSS: calc() with mixed units — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.calc { width: calc(100% - 2rem); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'calc(100% - 2rem)' }],
  expectedSuccess: true,
  tags: ['postcss', 'math_functions', 'PCSS-07'],
});

push({
  description: 'PostCSS: Nested calc — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.nested { width: calc(100% - calc(2rem + 10px)); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'calc(100% - calc(' }],
  expectedSuccess: true,
  tags: ['postcss', 'math_functions', 'PCSS-07'],
});

push({
  description: 'PostCSS: min/max/clamp — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.clamp { font-size: clamp(1rem, 2.5vw, 2rem); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'clamp(1rem' }],
  expectedSuccess: true,
  tags: ['postcss', 'math_functions', 'PCSS-07'],
});

// =============================================================================
// 8. Selector combinators edge cases
// =============================================================================

push({
  description: 'PostCSS: Column combinator || — passes content check',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>col.selected || td { background: #eef; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'col.selected || td' }],
  expectedSuccess: true,
  tags: ['postcss', 'selectors', 'PCSS-08'],
});

push({
  description: 'PostCSS: :is() with forgiving list — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>:is(h1, h2, h3) { margin-top: 1.5em; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: ':is(h1, h2, h3)' }],
  expectedSuccess: true,
  tags: ['postcss', 'selectors', 'PCSS-08'],
});

push({
  description: 'PostCSS: :has() relational pseudo — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>figure:has(figcaption) { border: 1px solid #ccc; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: ':has(figcaption)' }],
  expectedSuccess: true,
  tags: ['postcss', 'selectors', 'PCSS-08'],
});

push({
  description: 'PostCSS: Attribute selector with i flag — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>[type="text" i] { border: 1px solid #999; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '[type="text" i]' }],
  expectedSuccess: true,
  tags: ['postcss', 'selectors', 'PCSS-08'],
});

// =============================================================================
// 9. Important and !important edge cases
// =============================================================================

push({
  description: 'PostCSS: !important declaration — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.urgent { color: red !important; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '!important' }],
  expectedSuccess: true,
  tags: ['postcss', 'important', 'PCSS-09'],
});

push({
  description: 'PostCSS: Space before !important — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.spaced { color: red ! important; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '! important' }],
  expectedSuccess: true,
  tags: ['postcss', 'important', 'PCSS-09'],
});

// =============================================================================
// 10. Semicolons and declaration terminators
// =============================================================================

push({
  description: 'PostCSS: Missing final semicolon — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.no-semi { color: red }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'color: red }' }],
  expectedSuccess: true,
  tags: ['postcss', 'semicolons', 'PCSS-10'],
});

push({
  description: 'PostCSS: Semicolon in string — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.semi-str { content: "a;b"; }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '"a;b"' }],
  expectedSuccess: true,
  tags: ['postcss', 'semicolons', 'PCSS-10'],
});

// =============================================================================
// 11. Modern CSS nesting
// =============================================================================

push({
  description: 'PostCSS: CSS nesting with & — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.card { padding: 1rem; & .title { font-weight: bold; } }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '& .title' }],
  expectedSuccess: true,
  tags: ['postcss', 'nesting', 'PCSS-11'],
});

push({
  description: 'PostCSS: Nesting with @media — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.resp { font-size: 1rem; @media (min-width: 768px) { font-size: 1.5rem; } }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '@media (min-width: 768px) { font-size: 1.5rem' }],
  expectedSuccess: true,
  tags: ['postcss', 'nesting', 'PCSS-11'],
});

push({
  description: 'PostCSS: Deep nesting — fabricated',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '& & & & .deep-nested' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'nesting', 'PCSS-11'],
});

// =============================================================================
// 12. Color functions edge cases
// =============================================================================

push({
  description: 'PostCSS: rgb() modern space syntax — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.modern-rgb { color: rgb(255 0 0 / 0.5); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'rgb(255 0 0 / 0.5)' }],
  expectedSuccess: true,
  tags: ['postcss', 'colors', 'PCSS-12'],
});

push({
  description: 'PostCSS: oklch color — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.oklch { color: oklch(0.7 0.15 180); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'oklch(0.7 0.15 180)' }],
  expectedSuccess: true,
  tags: ['postcss', 'colors', 'PCSS-12'],
});

push({
  description: 'PostCSS: color-mix() — passes',
  edits: [{
    file: 'server.js',
    search: '<h1>Demo App</h1>',
    replace: '<h1>Demo App</h1>\n      <style>.mix { color: color-mix(in srgb, red 50%, blue); }</style>',
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'color-mix(in srgb' }],
  expectedSuccess: true,
  tags: ['postcss', 'colors', 'PCSS-12'],
});

push({
  description: 'PostCSS: light-dark() color — fabricated',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'light-dark(#fff, #000)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['postcss', 'colors', 'PCSS-12'],
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

console.log(`Generated ${scenarios.length} PostCSS edge case scenarios → ${outPath}\n`);
console.log('By taxonomy shape:');
for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(35)} ${count}`);
}
