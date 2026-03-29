#!/usr/bin/env bun
/**
 * stage-mdn-compat.ts — MDN Browser Compat Data Scenario Stager
 *
 * Generates verify scenarios based on MDN Web Docs browser compatibility data.
 * Tests CSS property verification against documented browser behaviors:
 * value normalization, shorthand expansion, inheritance, specificity,
 * initial values, computed vs specified, vendor prefixes, and logical properties.
 *
 * Categories:
 *   1. MDN-01  — CSS Property Values (color formats, units, math functions)
 *   2. MDN-02  — CSS Shorthand Expansion (margin, background, flex, etc.)
 *   3. MDN-03  — CSS Value Normalization (name->computed, unit stripping)
 *   4. MDN-04  — CSS Inheritance (inherited vs non-inherited properties)
 *   5. MDN-05  — CSS Specificity (cascade order, !important, :where/:is)
 *   6. MDN-06  — CSS Initial Values (default values per MDN)
 *   7. MDN-07  — CSS Computed vs Specified (relative->absolute, percentages)
 *   8. MDN-08  — CSS Vendor Prefixes (-webkit-, -moz-, -ms-)
 *   9. MDN-09  — CSS Logical Properties (physical->logical mapping)
 *
 * Scenario types:
 *   - pass       — valid CSS, correct expected value (expectedSuccess: true)
 *   - fail       — wrong computed value or wrong expansion (expectedSuccess: false)
 *   - grounding  — fabricated selector/property (expectedSuccess: false, grounding gate)
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
}

const scenarios: Scenario[] = [];
let id = 0;

function push(
  desc: string,
  edits: Array<{ file: string; search: string; replace: string }>,
  predicates: Array<Record<string, any>>,
  success: boolean,
  tags: string[],
  failedGate?: string,
) {
  const entry: Scenario = {
    id: `mdn-${String(++id).padStart(3, '0')}`,
    description: desc,
    edits,
    predicates,
    expectedSuccess: success,
    tags: ['css_compat', ...tags],
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// Helper: inject CSS into homepage <style> block via server.js
const HOME_STYLE_ANCHOR = 'footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }';
function homeEdit(css: string): Array<{ file: string; search: string; replace: string }> {
  return [{
    file: 'server.js',
    search: HOME_STYLE_ANCHOR,
    replace: `${HOME_STYLE_ANCHOR}\n    ${css}`,
  }];
}

// Helper: inject CSS into /edge-cases first style block
const EDGE_STYLE_ANCHOR = '.meta-test { content: \'meta\'; }';
function edgeEdit(css: string): Array<{ file: string; search: string; replace: string }> {
  return [{
    file: 'server.js',
    search: EDGE_STYLE_ANCHOR,
    replace: `${EDGE_STYLE_ANCHOR}\n    ${css}`,
  }];
}

// ════════════════════════════════════════════════════════════════════════════════
// MDN-01: CSS Property Values (~20 scenarios)
// Color formats, length units, math functions
// ════════════════════════════════════════════════════════════════════════════════

// ── Color Formats ─────────────────────────────────────────────────────────────

push(
  'MDN-01: hex 6-digit color value',
  homeEdit('.mdn-hex6 { color: #ff5733; }'),
  [{ type: 'css', selector: '.mdn-hex6', property: 'color', expected: '#ff5733' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: hex 3-digit shorthand color',
  homeEdit('.mdn-hex3 { color: #f00; }'),
  [{ type: 'css', selector: '.mdn-hex3', property: 'color', expected: '#f00' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: hex 8-digit with alpha',
  homeEdit('.mdn-hex8 { color: #ff573380; }'),
  [{ type: 'css', selector: '.mdn-hex8', property: 'color', expected: '#ff573380' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: rgb() functional notation',
  homeEdit('.mdn-rgb { color: rgb(255, 87, 51); }'),
  [{ type: 'css', selector: '.mdn-rgb', property: 'color', expected: 'rgb(255, 87, 51)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: hsl() functional notation',
  homeEdit('.mdn-hsl { color: hsl(210, 50%, 60%); }'),
  [{ type: 'css', selector: '.mdn-hsl', property: 'color', expected: 'hsl(210, 50%, 60%)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: oklch() color function',
  homeEdit('.mdn-oklch { color: oklch(0.7 0.15 210); }'),
  [{ type: 'css', selector: '.mdn-oklch', property: 'color', expected: 'oklch(0.7 0.15 210)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: lab() color function',
  homeEdit('.mdn-lab { color: lab(50% 30 -20); }'),
  [{ type: 'css', selector: '.mdn-lab', property: 'color', expected: 'lab(50% 30 -20)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: lch() color function',
  homeEdit('.mdn-lch { color: lch(60% 40 270); }'),
  [{ type: 'css', selector: '.mdn-lch', property: 'color', expected: 'lch(60% 40 270)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: hwb() color function',
  homeEdit('.mdn-hwb { color: hwb(180 20% 30%); }'),
  [{ type: 'css', selector: '.mdn-hwb', property: 'color', expected: 'hwb(180 20% 30%)' }],
  true,
  ['property_values', 'MDN-01'],
);

// ── Length Units ──────────────────────────────────────────────────────────────

push(
  'MDN-01: rem unit',
  homeEdit('.mdn-rem { font-size: 1.5rem; }'),
  [{ type: 'css', selector: '.mdn-rem', property: 'font-size', expected: '1.5rem' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: vw viewport unit',
  homeEdit('.mdn-vw { width: 50vw; }'),
  [{ type: 'css', selector: '.mdn-vw', property: 'width', expected: '50vw' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: dvh dynamic viewport unit',
  homeEdit('.mdn-dvh { height: 100dvh; }'),
  [{ type: 'css', selector: '.mdn-dvh', property: 'height', expected: '100dvh' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: svh small viewport unit',
  homeEdit('.mdn-svh { min-height: 100svh; }'),
  [{ type: 'css', selector: '.mdn-svh', property: 'min-height', expected: '100svh' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: cqi container query inline unit',
  homeEdit('.mdn-cqi { width: 50cqi; }'),
  [{ type: 'css', selector: '.mdn-cqi', property: 'width', expected: '50cqi' }],
  true,
  ['property_values', 'MDN-01'],
);

// ── Math Functions ───────────────────────────────────────────────────────────

push(
  'MDN-01: calc() expression',
  homeEdit('.mdn-calc { width: calc(100% - 2rem); }'),
  [{ type: 'css', selector: '.mdn-calc', property: 'width', expected: 'calc(100% - 2rem)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: clamp() function',
  homeEdit('.mdn-clamp { font-size: clamp(1rem, 2.5vw, 3rem); }'),
  [{ type: 'css', selector: '.mdn-clamp', property: 'font-size', expected: 'clamp(1rem, 2.5vw, 3rem)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: min() function',
  homeEdit('.mdn-min { width: min(50vw, 600px); }'),
  [{ type: 'css', selector: '.mdn-min', property: 'width', expected: 'min(50vw, 600px)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: max() function',
  homeEdit('.mdn-max { width: max(300px, 50%); }'),
  [{ type: 'css', selector: '.mdn-max', property: 'width', expected: 'max(300px, 50%)' }],
  true,
  ['property_values', 'MDN-01'],
);

push(
  'MDN-01: fabricated color function — grounding fails',
  homeEdit('.mdn-fake-color { color: cmyk(0, 100, 100, 0); }'),
  [{ type: 'css', selector: '.mdn-fake-color', property: 'color', expected: 'cmyk(0, 100, 100, 0)' }],
  false,
  ['property_values', 'MDN-01'],
  'grounding',
);

push(
  'MDN-01: fabricated unit — grounding fails',
  [],
  [{ type: 'css', selector: '.mdn-fake-unit', property: 'width', expected: '50vmax2' }],
  false,
  ['property_values', 'MDN-01'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-02: CSS Shorthand Expansion (~20 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── margin shorthand ─────────────────────────────────────────────────────────

push(
  'MDN-02: margin single value expands to all sides',
  homeEdit('.mdn-margin1 { margin: 10px; }'),
  [{ type: 'css', selector: '.mdn-margin1', property: 'margin', expected: '10px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: margin two values — vertical horizontal',
  homeEdit('.mdn-margin2 { margin: 10px 20px; }'),
  [{ type: 'css', selector: '.mdn-margin2', property: 'margin', expected: '10px 20px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: margin four values — top right bottom left',
  homeEdit('.mdn-margin4 { margin: 10px 20px 30px 40px; }'),
  [{ type: 'css', selector: '.mdn-margin4', property: 'margin', expected: '10px 20px 30px 40px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: margin longhand margin-top matches shorthand first value',
  homeEdit('.mdn-margin-top { margin: 10px 20px 30px 40px; }'),
  [{ type: 'css', selector: '.mdn-margin-top', property: 'margin-top', expected: '10px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: wrong margin expansion — expects right value in top',
  homeEdit('.mdn-margin-wrong { margin: 10px 20px; }'),
  [{ type: 'css', selector: '.mdn-margin-wrong', property: 'margin-top', expected: '20px' }],
  false,
  ['shorthand', 'MDN-02'],
  'verify',
);

// ── padding shorthand ────────────────────────────────────────────────────────

push(
  'MDN-02: padding three values — top horizontal bottom',
  homeEdit('.mdn-pad3 { padding: 5px 10px 15px; }'),
  [{ type: 'css', selector: '.mdn-pad3', property: 'padding', expected: '5px 10px 15px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: padding-left from shorthand 4-value',
  [],
  [{ type: 'css', selector: '.shorthand-test', property: 'padding-left', expected: '20px' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── background shorthand ────────────────────────────────────────────────────

push(
  'MDN-02: background shorthand color only',
  homeEdit('.mdn-bg-color { background: #3498db; }'),
  [{ type: 'css', selector: '.mdn-bg-color', property: 'background', expected: '#3498db' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: background shorthand color + no-repeat',
  homeEdit('.mdn-bg-full { background: #eee url(bg.png) no-repeat center; }'),
  [{ type: 'css', selector: '.mdn-bg-full', property: 'background', expected: '#eee url(bg.png) no-repeat center' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── flex shorthand ──────────────────────────────────────────────────────────

push(
  'MDN-02: flex shorthand — grow shrink basis',
  [],
  [{ type: 'css', selector: '.flex-item', property: 'flex', expected: '2 1 100px' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: flex shorthand single value — flex-grow only',
  homeEdit('.mdn-flex1 { flex: 1; }'),
  [{ type: 'css', selector: '.mdn-flex1', property: 'flex', expected: '1' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── border shorthand ────────────────────────────────────────────────────────

push(
  'MDN-02: border shorthand — width style color',
  homeEdit('.mdn-border { border: 2px solid #333; }'),
  [{ type: 'css', selector: '.mdn-border', property: 'border', expected: '2px solid #333' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: border shorthand — extracting border-color',
  homeEdit('.mdn-border-c { border: 1px dashed red; }'),
  [{ type: 'css', selector: '.mdn-border-c', property: 'border-color', expected: 'red' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── font shorthand ──────────────────────────────────────────────────────────

push(
  'MDN-02: font shorthand — style weight size family',
  homeEdit('.mdn-font { font: italic bold 1.2rem Georgia, serif; }'),
  [{ type: 'css', selector: '.mdn-font', property: 'font', expected: 'italic bold 1.2rem Georgia, serif' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── animation shorthand ─────────────────────────────────────────────────────

push(
  'MDN-02: animation shorthand — name duration timing',
  [],
  [{ type: 'css', selector: '.animated', property: 'animation', expected: 'pulse 2s infinite' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── transition shorthand ────────────────────────────────────────────────────

push(
  'MDN-02: transition shorthand — property duration timing',
  homeEdit('.mdn-trans { transition: opacity 0.3s ease-in-out; }'),
  [{ type: 'css', selector: '.mdn-trans', property: 'transition', expected: 'opacity 0.3s ease-in-out' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── place-items shorthand ───────────────────────────────────────────────────

push(
  'MDN-02: place-items shorthand — align justify',
  homeEdit('.mdn-place { display: grid; place-items: center stretch; }'),
  [{ type: 'css', selector: '.mdn-place', property: 'place-items', expected: 'center stretch' }],
  true,
  ['shorthand', 'MDN-02'],
);

// ── grid shorthand ──────────────────────────────────────────────────────────

push(
  'MDN-02: grid-template shorthand',
  [],
  [{ type: 'css', selector: '.grid-container', property: 'grid-template', expected: '1fr 2fr / auto auto' }],
  true,
  ['shorthand', 'MDN-02'],
);

push(
  'MDN-02: fabricated shorthand property — grounding fails',
  [],
  [{ type: 'css', selector: '.mdn-fake-short', property: 'box-decoration', expected: '1px solid' }],
  false,
  ['shorthand', 'MDN-02'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-03: CSS Value Normalization (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-03: named color orange normalizes to rgb(255, 165, 0)',
  homeEdit('.mdn-named { color: orange; }'),
  [{ type: 'css', selector: '.mdn-named', property: 'color', expected: 'rgb(255, 165, 0)' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: named color orange in source form',
  homeEdit('.mdn-named-src { color: orange; }'),
  [{ type: 'css', selector: '.mdn-named-src', property: 'color', expected: 'orange' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: 0px normalizes to 0',
  homeEdit('.mdn-zero { margin-left: 0px; }'),
  [{ type: 'css', selector: '.mdn-zero', property: 'margin-left', expected: '0px' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: uppercase hex normalizes to lowercase',
  homeEdit('.mdn-upper-hex { color: #FF5733; }'),
  [{ type: 'css', selector: '.mdn-upper-hex', property: 'color', expected: '#FF5733' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: font-weight bold normalizes to 700',
  homeEdit('.mdn-bold { font-weight: bold; }'),
  [{ type: 'css', selector: '.mdn-bold', property: 'font-weight', expected: 'bold' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: font-weight normal normalizes to 400',
  homeEdit('.mdn-normal { font-weight: normal; }'),
  [{ type: 'css', selector: '.mdn-normal', property: 'font-weight', expected: 'normal' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: transparent color keyword',
  homeEdit('.mdn-transparent { background-color: transparent; }'),
  [{ type: 'css', selector: '.mdn-transparent', property: 'background-color', expected: 'transparent' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: currentColor keyword',
  homeEdit('.mdn-current { border-color: currentColor; }'),
  [{ type: 'css', selector: '.mdn-current', property: 'border-color', expected: 'currentColor' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: auto keyword preserved',
  homeEdit('.mdn-auto { margin: 0 auto; }'),
  [{ type: 'css', selector: '.mdn-auto', property: 'margin', expected: '0 auto' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: none keyword for display',
  homeEdit('.mdn-none { display: none; }'),
  [{ type: 'css', selector: '.mdn-none', property: 'display', expected: 'none' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: wrong normalization — expects hex but property is named',
  homeEdit('.mdn-norm-wrong { color: red; }'),
  [{ type: 'css', selector: '.mdn-norm-wrong', property: 'color', expected: '#0000ff' }],
  false,
  ['normalization', 'MDN-03'],
  'verify',
);

push(
  'MDN-03: inherit keyword preserved',
  homeEdit('.mdn-inherit { color: inherit; }'),
  [{ type: 'css', selector: '.mdn-inherit', property: 'color', expected: 'inherit' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: unset keyword preserved',
  homeEdit('.mdn-unset { margin: unset; }'),
  [{ type: 'css', selector: '.mdn-unset', property: 'margin', expected: 'unset' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: revert keyword preserved',
  homeEdit('.mdn-revert { display: revert; }'),
  [{ type: 'css', selector: '.mdn-revert', property: 'display', expected: 'revert' }],
  true,
  ['normalization', 'MDN-03'],
);

push(
  'MDN-03: initial keyword preserved',
  homeEdit('.mdn-initial { color: initial; }'),
  [{ type: 'css', selector: '.mdn-initial', property: 'color', expected: 'initial' }],
  true,
  ['normalization', 'MDN-03'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-04: CSS Inheritance (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-04: color inherits from parent',
  homeEdit('.mdn-parent { color: #e74c3c; } .mdn-parent .mdn-child { /* inherits */ }'),
  [{ type: 'css', selector: '.mdn-parent', property: 'color', expected: '#e74c3c' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: font-family inherits',
  homeEdit('.mdn-font-inherit { font-family: "Courier New", monospace; }'),
  [{ type: 'css', selector: '.mdn-font-inherit', property: 'font-family', expected: '"Courier New", monospace' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: font-size inherits',
  homeEdit('.mdn-fsize-parent { font-size: 1.25rem; }'),
  [{ type: 'css', selector: '.mdn-fsize-parent', property: 'font-size', expected: '1.25rem' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: line-height inherits',
  homeEdit('.mdn-lh { line-height: 1.6; }'),
  [{ type: 'css', selector: '.mdn-lh', property: 'line-height', expected: '1.6' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: text-align inherits',
  homeEdit('.mdn-align { text-align: center; }'),
  [{ type: 'css', selector: '.mdn-align', property: 'text-align', expected: 'center' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: visibility inherits',
  homeEdit('.mdn-vis { visibility: hidden; }'),
  [{ type: 'css', selector: '.mdn-vis', property: 'visibility', expected: 'hidden' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: cursor inherits',
  homeEdit('.mdn-cursor { cursor: pointer; }'),
  [{ type: 'css', selector: '.mdn-cursor', property: 'cursor', expected: 'pointer' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: margin does NOT inherit — non-inherited property',
  homeEdit('.mdn-no-inh { margin: 2rem; }'),
  [{ type: 'css', selector: '.mdn-no-inh', property: 'margin', expected: '2rem' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: padding does NOT inherit',
  homeEdit('.mdn-no-pad-inh { padding: 1rem; }'),
  [{ type: 'css', selector: '.mdn-no-pad-inh', property: 'padding', expected: '1rem' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: border does NOT inherit',
  homeEdit('.mdn-no-border-inh { border: 1px solid #000; }'),
  [{ type: 'css', selector: '.mdn-no-border-inh', property: 'border', expected: '1px solid #000' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: display does NOT inherit',
  homeEdit('.mdn-no-disp-inh { display: flex; }'),
  [{ type: 'css', selector: '.mdn-no-disp-inh', property: 'display', expected: 'flex' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: custom property --var inherits',
  homeEdit('.mdn-custom-var { --brand-color: #e74c3c; color: var(--brand-color); }'),
  [{ type: 'css', selector: '.mdn-custom-var', property: '--brand-color', expected: '#e74c3c' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: all: inherit forces inheritance of non-inherited props',
  homeEdit('.mdn-all-inherit { all: inherit; }'),
  [{ type: 'css', selector: '.mdn-all-inherit', property: 'all', expected: 'inherit' }],
  true,
  ['inheritance', 'MDN-04'],
);

push(
  'MDN-04: fabricated inherited property — grounding fails',
  [],
  [{ type: 'css', selector: '.nonexistent-inherit', property: 'color', expected: 'red' }],
  false,
  ['inheritance', 'MDN-04'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-05: CSS Specificity (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-05: class selector overrides element selector',
  homeEdit('.mdn-spec-class { color: green; } div { color: red; }'),
  [{ type: 'css', selector: '.mdn-spec-class', property: 'color', expected: 'green' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: id selector has higher specificity than class',
  homeEdit('#mdn-spec-id { color: blue; } .mdn-spec-id-class { color: red; }'),
  [{ type: 'css', selector: '#mdn-spec-id', property: 'color', expected: 'blue' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: !important overrides normal declaration',
  homeEdit('.mdn-important { color: red !important; } .mdn-important { color: blue; }'),
  [{ type: 'css', selector: '.mdn-important', property: 'color', expected: 'red !important' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: later rule wins at same specificity',
  homeEdit('.mdn-cascade-a { color: red; } .mdn-cascade-a { color: green; }'),
  [{ type: 'css', selector: '.mdn-cascade-a', property: 'color', expected: 'green' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: :where() has 0 specificity',
  homeEdit(':where(.mdn-where) { color: red; } .mdn-where { color: blue; }'),
  [{ type: 'css', selector: '.mdn-where', property: 'color', expected: 'blue' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: :is() takes highest arg specificity',
  homeEdit(':is(.mdn-is-a, .mdn-is-b) { color: green; }'),
  [{ type: 'css', selector: ':is(.mdn-is-a, .mdn-is-b)', property: 'color', expected: 'green' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: :not() takes highest arg specificity',
  homeEdit(':not(.mdn-not-excl) { color: purple; }'),
  [{ type: 'css', selector: ':not(.mdn-not-excl)', property: 'color', expected: 'purple' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: combined selectors — class.class higher than single class',
  homeEdit('.mdn-combo.mdn-combo2 { color: orange; } .mdn-combo { color: green; }'),
  [{ type: 'css', selector: '.mdn-combo.mdn-combo2', property: 'color', expected: 'orange' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: @layer lower-priority layer loses',
  homeEdit('@layer base { .mdn-layer { color: red; } } @layer theme { .mdn-layer { color: blue; } }'),
  [{ type: 'css', selector: '.mdn-layer', property: 'color', expected: 'blue' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: wrong specificity winner — expects element over class',
  homeEdit('p.mdn-spec-lose { color: green; }'),
  [{ type: 'css', selector: 'p.mdn-spec-lose', property: 'color', expected: 'red' }],
  false,
  ['specificity', 'MDN-05'],
  'verify',
);

push(
  'MDN-05: inline style attribute in source',
  [],
  [{ type: 'css', selector: '.inline-styled', property: 'color', expected: '#e67e22' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: inline style overrides class rule',
  edgeEdit('.inline-styled { color: blue; }'),
  [{ type: 'css', selector: '.inline-styled', property: 'color', expected: '#e67e22' }],
  true,
  ['specificity', 'MDN-05'],
);

push(
  'MDN-05: attribute selector specificity',
  homeEdit('[type="text"] { border-color: #666; }'),
  [{ type: 'css', selector: '[type="text"]', property: 'border-color', expected: '#666' }],
  true,
  ['specificity', 'MDN-05'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-06: CSS Initial Values (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-06: display initial is inline (per MDN)',
  homeEdit('.mdn-init-display { display: inline; }'),
  [{ type: 'css', selector: '.mdn-init-display', property: 'display', expected: 'inline' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: position initial is static',
  homeEdit('.mdn-init-pos { position: static; }'),
  [{ type: 'css', selector: '.mdn-init-pos', property: 'position', expected: 'static' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: opacity initial is 1',
  homeEdit('.mdn-init-opacity { opacity: 1; }'),
  [{ type: 'css', selector: '.mdn-init-opacity', property: 'opacity', expected: '1' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: visibility initial is visible',
  homeEdit('.mdn-init-vis { visibility: visible; }'),
  [{ type: 'css', selector: '.mdn-init-vis', property: 'visibility', expected: 'visible' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: overflow initial is visible',
  homeEdit('.mdn-init-overflow { overflow: visible; }'),
  [{ type: 'css', selector: '.mdn-init-overflow', property: 'overflow', expected: 'visible' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: z-index initial is auto',
  homeEdit('.mdn-init-z { z-index: auto; }'),
  [{ type: 'css', selector: '.mdn-init-z', property: 'z-index', expected: 'auto' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: flex-direction initial is row',
  homeEdit('.mdn-init-flexdir { display: flex; flex-direction: row; }'),
  [{ type: 'css', selector: '.mdn-init-flexdir', property: 'flex-direction', expected: 'row' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: float initial is none',
  homeEdit('.mdn-init-float { float: none; }'),
  [{ type: 'css', selector: '.mdn-init-float', property: 'float', expected: 'none' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: text-decoration initial is none',
  homeEdit('.mdn-init-textdeco { text-decoration: none; }'),
  [{ type: 'css', selector: '.mdn-init-textdeco', property: 'text-decoration', expected: 'none' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: background-color initial is transparent',
  homeEdit('.mdn-init-bgc { background-color: transparent; }'),
  [{ type: 'css', selector: '.mdn-init-bgc', property: 'background-color', expected: 'transparent' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: border-style initial is none',
  homeEdit('.mdn-init-bstyle { border-style: none; }'),
  [{ type: 'css', selector: '.mdn-init-bstyle', property: 'border-style', expected: 'none' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: wrong initial — expects block for display initial',
  homeEdit('.mdn-init-wrong { display: inline; }'),
  [{ type: 'css', selector: '.mdn-init-wrong', property: 'display', expected: 'block' }],
  false,
  ['initial_values', 'MDN-06'],
  'verify',
);

push(
  'MDN-06: transform initial is none',
  homeEdit('.mdn-init-transform { transform: none; }'),
  [{ type: 'css', selector: '.mdn-init-transform', property: 'transform', expected: 'none' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: box-sizing initial is content-box',
  homeEdit('.mdn-init-boxsize { box-sizing: content-box; }'),
  [{ type: 'css', selector: '.mdn-init-boxsize', property: 'box-sizing', expected: 'content-box' }],
  true,
  ['initial_values', 'MDN-06'],
);

push(
  'MDN-06: word-break initial is normal',
  homeEdit('.mdn-init-wordbreak { word-break: normal; }'),
  [{ type: 'css', selector: '.mdn-init-wordbreak', property: 'word-break', expected: 'normal' }],
  true,
  ['initial_values', 'MDN-06'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-07: CSS Computed vs Specified (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-07: em units — specified value preserved in source',
  homeEdit('.mdn-em { font-size: 1.5em; }'),
  [{ type: 'css', selector: '.mdn-em', property: 'font-size', expected: '1.5em' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: percentage width — specified value preserved',
  homeEdit('.mdn-pct { width: 50%; }'),
  [{ type: 'css', selector: '.mdn-pct', property: 'width', expected: '50%' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: calc() with mixed units — specified form',
  homeEdit('.mdn-calc-mix { margin: calc(1rem + 5px); }'),
  [{ type: 'css', selector: '.mdn-calc-mix', property: 'margin', expected: 'calc(1rem + 5px)' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: var() reference — specified form',
  homeEdit(':root { --spacing: 1rem; } .mdn-var { padding: var(--spacing); }'),
  [{ type: 'css', selector: '.mdn-var', property: 'padding', expected: 'var(--spacing)' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: var() with fallback — specified form',
  homeEdit('.mdn-var-fb { color: var(--undefined, #333); }'),
  [{ type: 'css', selector: '.mdn-var-fb', property: 'color', expected: 'var(--undefined, #333)' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: relative length ch unit — preserved in source',
  homeEdit('.mdn-ch { width: 40ch; }'),
  [{ type: 'css', selector: '.mdn-ch', property: 'width', expected: '40ch' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: ex unit — preserved in source',
  homeEdit('.mdn-ex { height: 10ex; }'),
  [{ type: 'css', selector: '.mdn-ex', property: 'height', expected: '10ex' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: currentColor resolved differently by source vs computed',
  homeEdit('.mdn-cc-src { border-color: currentColor; }'),
  [{ type: 'css', selector: '.mdn-cc-src', property: 'border-color', expected: 'currentColor' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: larger font-size keyword — specified form',
  homeEdit('.mdn-larger { font-size: larger; }'),
  [{ type: 'css', selector: '.mdn-larger', property: 'font-size', expected: 'larger' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: thin keyword for border-width — specified form',
  homeEdit('.mdn-thin { border-width: thin; }'),
  [{ type: 'css', selector: '.mdn-thin', property: 'border-width', expected: 'thin' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: wrong computed expectation — expects px but source has em',
  homeEdit('.mdn-comp-wrong { font-size: 2em; }'),
  [{ type: 'css', selector: '.mdn-comp-wrong', property: 'font-size', expected: '32px' }],
  false,
  ['computed_specified', 'MDN-07'],
  'verify',
);

push(
  'MDN-07: percentage margin — specified form',
  homeEdit('.mdn-pct-margin { margin-left: 10%; }'),
  [{ type: 'css', selector: '.mdn-pct-margin', property: 'margin-left', expected: '10%' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: vmin unit — preserved in source',
  homeEdit('.mdn-vmin { width: 50vmin; }'),
  [{ type: 'css', selector: '.mdn-vmin', property: 'width', expected: '50vmin' }],
  true,
  ['computed_specified', 'MDN-07'],
);

push(
  'MDN-07: content source check for var() fallback pattern',
  homeEdit('.mdn-var-pattern { color: var(--theme-color, #1a1a2e); }'),
  [{ type: 'content', file: 'server.js', pattern: 'var(--theme-color, #1a1a2e)' }],
  true,
  ['computed_specified', 'MDN-07'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-08: CSS Vendor Prefixes (~10 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-08: -webkit-backdrop-filter prefixed property',
  homeEdit('.mdn-webkit-bf { -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }'),
  [{ type: 'css', selector: '.mdn-webkit-bf', property: '-webkit-backdrop-filter', expected: 'blur(10px)' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: unprefixed backdrop-filter alongside -webkit-',
  homeEdit('.mdn-bf { -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }'),
  [{ type: 'css', selector: '.mdn-bf', property: 'backdrop-filter', expected: 'blur(10px)' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: -webkit-text-fill-color proprietary property',
  homeEdit('.mdn-fill { -webkit-text-fill-color: transparent; }'),
  [{ type: 'css', selector: '.mdn-fill', property: '-webkit-text-fill-color', expected: 'transparent' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: -webkit-line-clamp proprietary property',
  homeEdit('.mdn-clamp-line { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }'),
  [{ type: 'css', selector: '.mdn-clamp-line', property: '-webkit-line-clamp', expected: '3' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: -webkit-appearance none for custom controls',
  homeEdit('.mdn-appear { -webkit-appearance: none; appearance: none; }'),
  [{ type: 'css', selector: '.mdn-appear', property: '-webkit-appearance', expected: 'none' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: unprefixed appearance property',
  homeEdit('.mdn-appear-std { appearance: none; }'),
  [{ type: 'css', selector: '.mdn-appear-std', property: 'appearance', expected: 'none' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: content check for vendor prefix fallback pattern',
  homeEdit('.mdn-prefix-pattern { -webkit-user-select: none; user-select: none; }'),
  [{ type: 'content', file: 'server.js', pattern: '-webkit-user-select: none' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: -moz-appearance prefixed property',
  homeEdit('.mdn-moz-app { -moz-appearance: none; }'),
  [{ type: 'css', selector: '.mdn-moz-app', property: '-moz-appearance', expected: 'none' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

push(
  'MDN-08: fabricated vendor prefix — grounding fails',
  [],
  [{ type: 'css', selector: '.nonexistent-vendor', property: '-webkit-magic-effect', expected: 'glow' }],
  false,
  ['vendor_prefix', 'MDN-08'],
  'grounding',
);

push(
  'MDN-08: -webkit-mask-image property',
  homeEdit('.mdn-mask { -webkit-mask-image: linear-gradient(black, transparent); mask-image: linear-gradient(black, transparent); }'),
  [{ type: 'css', selector: '.mdn-mask', property: '-webkit-mask-image', expected: 'linear-gradient(black, transparent)' }],
  true,
  ['vendor_prefix', 'MDN-08'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MDN-09: CSS Logical Properties (~15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'MDN-09: margin-inline-start (logical for margin-left in LTR)',
  homeEdit('.mdn-mis { margin-inline-start: 2rem; }'),
  [{ type: 'css', selector: '.mdn-mis', property: 'margin-inline-start', expected: '2rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: margin-inline-end (logical for margin-right in LTR)',
  homeEdit('.mdn-mie { margin-inline-end: 1.5rem; }'),
  [{ type: 'css', selector: '.mdn-mie', property: 'margin-inline-end', expected: '1.5rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: padding-block-start (logical for padding-top)',
  homeEdit('.mdn-pbs { padding-block-start: 1rem; }'),
  [{ type: 'css', selector: '.mdn-pbs', property: 'padding-block-start', expected: '1rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: padding-block-end (logical for padding-bottom)',
  homeEdit('.mdn-pbe { padding-block-end: 1rem; }'),
  [{ type: 'css', selector: '.mdn-pbe', property: 'padding-block-end', expected: '1rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: inline-size (logical for width)',
  homeEdit('.mdn-inlsize { inline-size: 300px; }'),
  [{ type: 'css', selector: '.mdn-inlsize', property: 'inline-size', expected: '300px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: block-size (logical for height)',
  homeEdit('.mdn-blksize { block-size: 200px; }'),
  [{ type: 'css', selector: '.mdn-blksize', property: 'block-size', expected: '200px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: inset-block-start (logical for top)',
  homeEdit('.mdn-ibs { position: relative; inset-block-start: 10px; }'),
  [{ type: 'css', selector: '.mdn-ibs', property: 'inset-block-start', expected: '10px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: inset-inline-end (logical for right in LTR)',
  homeEdit('.mdn-iie { position: absolute; inset-inline-end: 20px; }'),
  [{ type: 'css', selector: '.mdn-iie', property: 'inset-inline-end', expected: '20px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: border-inline-start shorthand',
  homeEdit('.mdn-bis { border-inline-start: 2px solid #3498db; }'),
  [{ type: 'css', selector: '.mdn-bis', property: 'border-inline-start', expected: '2px solid #3498db' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: border-block-end shorthand',
  homeEdit('.mdn-bbe { border-block-end: 1px dashed #999; }'),
  [{ type: 'css', selector: '.mdn-bbe', property: 'border-block-end', expected: '1px dashed #999' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: max-inline-size (logical for max-width)',
  homeEdit('.mdn-maxinl { max-inline-size: 600px; }'),
  [{ type: 'css', selector: '.mdn-maxinl', property: 'max-inline-size', expected: '600px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: min-block-size (logical for min-height)',
  homeEdit('.mdn-minblk { min-block-size: 100px; }'),
  [{ type: 'css', selector: '.mdn-minblk', property: 'min-block-size', expected: '100px' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: margin-inline shorthand (start + end)',
  homeEdit('.mdn-mi { margin-inline: 1rem 2rem; }'),
  [{ type: 'css', selector: '.mdn-mi', property: 'margin-inline', expected: '1rem 2rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: padding-block shorthand (start + end)',
  homeEdit('.mdn-pb { padding-block: 0.5rem 1rem; }'),
  [{ type: 'css', selector: '.mdn-pb', property: 'padding-block', expected: '0.5rem 1rem' }],
  true,
  ['logical_properties', 'MDN-09'],
);

push(
  'MDN-09: wrong logical mapping — expects margin-left but property is margin-inline-start',
  homeEdit('.mdn-log-wrong { margin-inline-start: 2rem; }'),
  [{ type: 'css', selector: '.mdn-log-wrong', property: 'margin-left', expected: '2rem' }],
  false,
  ['logical_properties', 'MDN-09'],
  'verify',
);

push(
  'MDN-09: fabricated logical property — grounding fails',
  [],
  [{ type: 'css', selector: '.nonexistent-logical', property: 'margin-flow-start', expected: '1rem' }],
  false,
  ['logical_properties', 'MDN-09'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/mdn-compat-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const categoryCounts: Record<string, number> = {};
const subcategoryCounts: Record<string, number> = {};
const typeCounts: Record<string, number> = { css: 0, content: 0, html: 0 };
let passCount = 0;
let failCount = 0;

for (const s of scenarios) {
  const category = s.tags[1] || 'unknown';
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  const subcategory = s.tags[2] || 'unknown';
  subcategoryCounts[subcategory] = (subcategoryCounts[subcategory] || 0) + 1;
  for (const p of s.predicates) {
    const t = p.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  if (s.expectedSuccess) passCount++; else failCount++;
}

console.log(`Generated ${scenarios.length} MDN Browser Compat scenarios → ${OUTPUT_PATH}\n`);

console.log('By category:');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(26)} ${count}`);
}

console.log('\nBy MDN section:');
for (const [sub, count] of Object.entries(subcategoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sub.padEnd(26)} ${count}`);
}

console.log('\nBy predicate type:');
for (const [t, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(26)} ${count}`);
}

console.log(`\nExpected pass: ${passCount}  |  Expected fail: ${failCount}`);
