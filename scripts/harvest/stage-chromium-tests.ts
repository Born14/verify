#!/usr/bin/env bun
/**
 * stage-chromium-tests.ts — Chromium Web Platform Test Scenario Stager
 *
 * Generates scenarios from web platform test patterns covering
 * CSS rendering, layout, and browser behavior edge cases.
 *
 * Categories:
 *   1. box_model     — width/height, box-sizing, margin collapse, padding/border (WPT-01)
 *   2. flexbox       — flex-direction, wrap, grow/shrink/basis, align, gap, order (WPT-02)
 *   3. grid          — grid-template, fr, auto-fill/fit, minmax, grid-area, subgrid (WPT-03)
 *   4. positioning   — static, relative, absolute, fixed, sticky, z-index (WPT-04)
 *   5. typography    — text-overflow, white-space, word-break, text-decoration, etc. (WPT-05)
 *   6. visual_effects — opacity, filter, mix-blend-mode, backdrop-filter, clip-path (WPT-06)
 *   7. transforms    — translate, rotate, scale, skew, matrix, perspective (WPT-07)
 *   8. animations    — animation, transition, keyframes, timing, fill-mode (WPT-08)
 *   9. overflow      — overflow-x/y, scroll-behavior, overscroll, scroll-snap (WPT-09)
 *  10. selectors     — :has(), :is(), :where(), :not(), :nth-child(), combinators (WPT-10)
 *
 * Scenario types per category:
 *   - correct    — CSS correctly applied (expectedSuccess: true)
 *   - mismatch   — expected value doesn't match actual (expectedSuccess: false, gate: css/content)
 *   - grounding  — fabricated selector/property (expectedSuccess: false, gate: grounding)
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
  predicates: Array<Record<string, any>>,
  success: boolean,
  tags: string[],
  failedGate?: string,
  edits: Array<{ file: string; search: string; replace: string }> = [],
) {
  const entry: Scenario = {
    id: `wpt-${String(++id).padStart(3, '0')}`,
    description: desc,
    edits,
    predicates,
    expectedSuccess: success,
    tags: ['css_rendering', ...tags],
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// ════════════════════════════════════════════════════════════════════════════════
// WPT-01: BOX MODEL (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'box-model: body margin 2rem applied correctly',
  [{ type: 'css', selector: 'body', property: 'margin', expected: '2rem' }],
  true,
  ['box_model', 'WPT-01'],
);

push(
  'box-model: card padding 1.5rem on about page',
  [{ type: 'css', selector: '.card', property: 'padding', expected: '1.5rem', path: '/about' }],
  true,
  ['box_model', 'WPT-01'],
);

push(
  'box-model: box-sizing border-box on form inputs',
  [{ type: 'css', selector: 'input[type="text"]', property: 'box-sizing', expected: 'border-box', path: '/form' }],
  true,
  ['box_model', 'WPT-01'],
);

push(
  'box-model: add explicit width to card after edit',
  [{ type: 'css', selector: '.card', property: 'width', expected: '80%', path: '/about' }],
  true,
  ['box_model', 'WPT-01'],
  undefined,
  [{ file: 'server.js', search: '.card { background: white; padding: 1.5rem;', replace: '.card { background: white; padding: 1.5rem; width: 80%;' }],
);

// -- mismatch --
push(
  'box-model: body margin expected 3rem but is 2rem',
  [{ type: 'css', selector: 'body', property: 'margin', expected: '3rem' }],
  false,
  ['box_model', 'WPT-01'],
  'css',
);

push(
  'box-model: card padding expected 2rem but is 1.5rem',
  [{ type: 'css', selector: '.card', property: 'padding', expected: '2rem', path: '/about' }],
  false,
  ['box_model', 'WPT-01'],
  'css',
);

push(
  'box-model: overflow-box height expected 200px but is 100px',
  [{ type: 'css', selector: '.overflow-box', property: 'height', expected: '200px', path: '/edge-cases' }],
  false,
  ['box_model', 'WPT-01'],
  'css',
);

// -- grounding --
push(
  'box-model: fabricated .content-wrapper selector',
  [{ type: 'css', selector: '.content-wrapper', property: 'margin', expected: '0 auto' }],
  false,
  ['box_model', 'WPT-01'],
  'grounding',
);

push(
  'box-model: fabricated min-block-size property on body',
  [{ type: 'css', selector: 'body', property: 'min-block-size', expected: '100vh' }],
  false,
  ['box_model', 'WPT-01'],
  'grounding',
);

push(
  'box-model: border-width on card element',
  [{ type: 'css', selector: '.card', property: 'border-width', expected: '1px', path: '/about' }],
  false,
  ['box_model', 'WPT-01'],
  'grounding',
);

push(
  'box-model: shorthand margin components on body',
  [{ type: 'css', selector: 'body', property: 'margin-top', expected: '2rem' }],
  false,
  ['box_model', 'WPT-01'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-02: FLEXBOX LAYOUT (12 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'flexbox: flex-container display flex',
  [{ type: 'css', selector: '.flex-container', property: 'display', expected: 'flex', path: '/edge-cases' }],
  true,
  ['flexbox', 'WPT-02'],
);

push(
  'flexbox: gap 10px on flex-container',
  [{ type: 'css', selector: '.flex-container', property: 'gap', expected: '10px', path: '/edge-cases' }],
  true,
  ['flexbox', 'WPT-02'],
);

push(
  'flexbox: flex-item shorthand flex 2 1 100px',
  [{ type: 'css', selector: '.flex-item', property: 'flex', expected: '2 1 100px', path: '/edge-cases' }],
  true,
  ['flexbox', 'WPT-02'],
);

push(
  'flexbox: add flex-direction column to container',
  [{ type: 'css', selector: '.flex-container', property: 'flex-direction', expected: 'column', path: '/edge-cases' }],
  true,
  ['flexbox', 'WPT-02'],
  undefined,
  [{ file: 'server.js', search: '.flex-container { display: flex; flex: 1 0 auto; gap: 10px; }', replace: '.flex-container { display: flex; flex: 1 0 auto; gap: 10px; flex-direction: column; }' }],
);

push(
  'flexbox: add align-items center after edit',
  [{ type: 'css', selector: '.flex-container', property: 'align-items', expected: 'center', path: '/edge-cases' }],
  true,
  ['flexbox', 'WPT-02'],
  undefined,
  [{ file: 'server.js', search: '.flex-container { display: flex; flex: 1 0 auto; gap: 10px; }', replace: '.flex-container { display: flex; flex: 1 0 auto; gap: 10px; align-items: center; }' }],
);

// -- mismatch --
push(
  'flexbox: gap expected 20px but is 10px',
  [{ type: 'css', selector: '.flex-container', property: 'gap', expected: '20px', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'css',
);

push(
  'flexbox: flex-item flex expected 1 1 auto but is 2 1 100px',
  [{ type: 'css', selector: '.flex-item', property: 'flex', expected: '1 1 auto', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'css',
);

push(
  'flexbox: display expected inline-flex but is flex',
  [{ type: 'css', selector: '.flex-container', property: 'display', expected: 'inline-flex', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'css',
);

// -- grounding --
push(
  'flexbox: fabricated .flex-wrapper selector',
  [{ type: 'css', selector: '.flex-wrapper', property: 'display', expected: 'flex', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'grounding',
);

push(
  'flexbox: fabricated flex-flow property on flex-container',
  [{ type: 'css', selector: '.flex-container', property: 'flex-flow', expected: 'row wrap', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'grounding',
);

push(
  'flexbox: fabricated justify-content on flex-container',
  [{ type: 'css', selector: '.flex-container', property: 'justify-content', expected: 'space-between', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'grounding',
);

push(
  'flexbox: fabricated order property on flex-item',
  [{ type: 'css', selector: '.flex-item', property: 'order', expected: '1', path: '/edge-cases' }],
  false,
  ['flexbox', 'WPT-02'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-03: GRID LAYOUT (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'grid: display grid on grid-container',
  [{ type: 'css', selector: '.grid-container', property: 'display', expected: 'grid', path: '/edge-cases' }],
  true,
  ['grid', 'WPT-03'],
);

push(
  'grid: grid-template 1fr 2fr / auto auto',
  [{ type: 'css', selector: '.grid-container', property: 'grid-template', expected: '1fr 2fr / auto auto', path: '/edge-cases' }],
  true,
  ['grid', 'WPT-03'],
);

push(
  'grid: gap 8px 16px on grid-container',
  [{ type: 'css', selector: '.grid-container', property: 'gap', expected: '8px 16px', path: '/edge-cases' }],
  true,
  ['grid', 'WPT-03'],
);

push(
  'grid: add grid-auto-flow dense after edit',
  [{ type: 'css', selector: '.grid-container', property: 'grid-auto-flow', expected: 'dense', path: '/edge-cases' }],
  true,
  ['grid', 'WPT-03'],
  undefined,
  [{ file: 'server.js', search: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; }', replace: '.grid-container { display: grid; grid-template: 1fr 2fr / auto auto; gap: 8px 16px; grid-auto-flow: dense; }' }],
);

// -- mismatch --
push(
  'grid: display expected inline-grid but is grid',
  [{ type: 'css', selector: '.grid-container', property: 'display', expected: 'inline-grid', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'css',
);

push(
  'grid: gap expected 10px but is 8px 16px',
  [{ type: 'css', selector: '.grid-container', property: 'gap', expected: '10px', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'css',
);

push(
  'grid: grid-template expected repeat(3, 1fr) / auto but actual is 1fr 2fr / auto auto',
  [{ type: 'css', selector: '.grid-container', property: 'grid-template', expected: 'repeat(3, 1fr) / auto', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'css',
);

// -- grounding --
push(
  'grid: fabricated .grid-wrapper selector',
  [{ type: 'css', selector: '.grid-wrapper', property: 'display', expected: 'grid', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'grounding',
);

push(
  'grid: fabricated grid-template-areas on grid-container',
  [{ type: 'css', selector: '.grid-container', property: 'grid-template-areas', expected: '"header header" "sidebar main"', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'grounding',
);

push(
  'grid: fabricated place-items on grid-container',
  [{ type: 'css', selector: '.grid-container', property: 'place-items', expected: 'center', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'grounding',
);

push(
  'grid: fabricated subgrid property',
  [{ type: 'css', selector: '.grid-container', property: 'grid-template-rows', expected: 'subgrid', path: '/edge-cases' }],
  false,
  ['grid', 'WPT-03'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-04: POSITIONING (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'positioning: hidden element display none',
  [{ type: 'css', selector: '.hidden', property: 'display', expected: 'none', path: '/about' }],
  true,
  ['positioning', 'WPT-04'],
);

push(
  'positioning: badge inline-block display',
  [{ type: 'css', selector: '.badge', property: 'display', expected: 'inline-block', path: '/about' }],
  true,
  ['positioning', 'WPT-04'],
);

push(
  'positioning: add position relative to card',
  [{ type: 'css', selector: '.card', property: 'position', expected: 'relative', path: '/about' }],
  true,
  ['positioning', 'WPT-04'],
  undefined,
  [{ file: 'server.js', search: '.card { background: white; padding: 1.5rem;', replace: '.card { background: white; padding: 1.5rem; position: relative;' }],
);

push(
  'positioning: add z-index 10 to hero',
  [{ type: 'css', selector: '.hero', property: 'z-index', expected: '10', path: '/about' }],
  true,
  ['positioning', 'WPT-04'],
  undefined,
  [{ file: 'server.js', search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }', replace: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; z-index: 10; }' }],
);

// -- mismatch --
push(
  'positioning: badge display expected block but is inline-block',
  [{ type: 'css', selector: '.badge', property: 'display', expected: 'block', path: '/about' }],
  false,
  ['positioning', 'WPT-04'],
  'css',
);

push(
  'positioning: hidden display expected visibility hidden but is display none',
  [{ type: 'css', selector: '.hidden', property: 'visibility', expected: 'hidden', path: '/about' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

push(
  'positioning: hero expected position sticky but no position set',
  [{ type: 'css', selector: '.hero', property: 'position', expected: 'sticky', path: '/about' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

// -- grounding --
push(
  'positioning: fabricated .sidebar selector',
  [{ type: 'css', selector: '.sidebar', property: 'position', expected: 'fixed' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

push(
  'positioning: fabricated .overlay selector',
  [{ type: 'css', selector: '.overlay', property: 'z-index', expected: '999' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

push(
  'positioning: fabricated inset property on hero',
  [{ type: 'css', selector: '.hero', property: 'inset', expected: '0', path: '/about' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

push(
  'positioning: fabricated .sticky-header selector',
  [{ type: 'css', selector: '.sticky-header', property: 'position', expected: 'sticky' }],
  false,
  ['positioning', 'WPT-04'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-05: TEXT/TYPOGRAPHY (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'typography: h1 font-size 2rem on homepage',
  [{ type: 'css', selector: 'h1', property: 'font-size', expected: '2rem' }],
  true,
  ['typography', 'WPT-05'],
);

push(
  'typography: body font-family sans-serif on homepage',
  [{ type: 'css', selector: 'body', property: 'font-family', expected: 'sans-serif' }],
  true,
  ['typography', 'WPT-05'],
);

push(
  'typography: subtitle font-size 1rem',
  [{ type: 'css', selector: '.subtitle', property: 'font-size', expected: '1rem' }],
  true,
  ['typography', 'WPT-05'],
);

push(
  'typography: edge-title text-transform uppercase',
  [{ type: 'css', selector: '.edge-hero .edge-title', property: 'text-transform', expected: 'uppercase', path: '/edge-cases' }],
  true,
  ['typography', 'WPT-05'],
);

push(
  'typography: add letter-spacing to h1 after edit',
  [{ type: 'css', selector: 'h1', property: 'letter-spacing', expected: '0.05em' }],
  true,
  ['typography', 'WPT-05'],
  undefined,
  [{ file: 'server.js', search: 'h1 { color: #1a1a2e; font-size: 2rem; }', replace: 'h1 { color: #1a1a2e; font-size: 2rem; letter-spacing: 0.05em; }' }],
);

// -- mismatch --
push(
  'typography: h1 font-size expected 3rem but is 2rem',
  [{ type: 'css', selector: 'h1', property: 'font-size', expected: '3rem' }],
  false,
  ['typography', 'WPT-05'],
  'css',
);

push(
  'typography: body font-family expected monospace but is sans-serif on homepage',
  [{ type: 'css', selector: 'body', property: 'font-family', expected: 'monospace' }],
  false,
  ['typography', 'WPT-05'],
  'css',
);

push(
  'typography: edge-title text-transform expected capitalize but is uppercase',
  [{ type: 'css', selector: '.edge-hero .edge-title', property: 'text-transform', expected: 'capitalize', path: '/edge-cases' }],
  false,
  ['typography', 'WPT-05'],
  'css',
);

// -- grounding --
push(
  'typography: fabricated .headline selector',
  [{ type: 'css', selector: '.headline', property: 'font-size', expected: '3rem' }],
  false,
  ['typography', 'WPT-05'],
  'grounding',
);

push(
  'typography: fabricated word-break property on body',
  [{ type: 'css', selector: 'body', property: 'word-break', expected: 'break-all' }],
  false,
  ['typography', 'WPT-05'],
  'grounding',
);

push(
  'typography: fabricated font-variant property on h1',
  [{ type: 'css', selector: 'h1', property: 'font-variant', expected: 'small-caps' }],
  false,
  ['typography', 'WPT-05'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-06: VISUAL EFFECTS (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'visual-effects: card box-shadow present on about page',
  [{ type: 'css', selector: '.card', property: 'box-shadow', expected: '0 2px 4px rgba(0,0,0,0.1)', path: '/about' }],
  true,
  ['visual_effects', 'WPT-06'],
);

push(
  'visual-effects: hero border-radius 8px',
  [{ type: 'css', selector: '.hero', property: 'border-radius', expected: '8px', path: '/about' }],
  true,
  ['visual_effects', 'WPT-06'],
);

push(
  'visual-effects: badge border-radius 12px',
  [{ type: 'css', selector: '.badge', property: 'border-radius', expected: '12px', path: '/about' }],
  true,
  ['visual_effects', 'WPT-06'],
);

push(
  'visual-effects: add opacity 0.9 to hero after edit',
  [{ type: 'css', selector: '.hero', property: 'opacity', expected: '0.9', path: '/about' }],
  true,
  ['visual_effects', 'WPT-06'],
  undefined,
  [{ file: 'server.js', search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }', replace: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; opacity: 0.9; }' }],
);

// -- mismatch --
push(
  'visual-effects: hero border-radius expected 16px but is 8px',
  [{ type: 'css', selector: '.hero', property: 'border-radius', expected: '16px', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'css',
);

push(
  'visual-effects: card box-shadow expected none but has shadow',
  [{ type: 'css', selector: '.card', property: 'box-shadow', expected: 'none', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'css',
);

push(
  'visual-effects: badge border-radius expected 4px but is 12px',
  [{ type: 'css', selector: '.badge', property: 'border-radius', expected: '4px', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'css',
);

// -- grounding --
push(
  'visual-effects: fabricated filter property on hero',
  [{ type: 'css', selector: '.hero', property: 'filter', expected: 'blur(4px)', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'grounding',
);

push(
  'visual-effects: fabricated .glass-pane selector',
  [{ type: 'css', selector: '.glass-pane', property: 'backdrop-filter', expected: 'blur(10px)' }],
  false,
  ['visual_effects', 'WPT-06'],
  'grounding',
);

push(
  'visual-effects: fabricated clip-path on card',
  [{ type: 'css', selector: '.card', property: 'clip-path', expected: 'circle(50%)', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'grounding',
);

push(
  'visual-effects: fabricated mix-blend-mode on hero',
  [{ type: 'css', selector: '.hero', property: 'mix-blend-mode', expected: 'multiply', path: '/about' }],
  false,
  ['visual_effects', 'WPT-06'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-07: TRANSFORMS (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'transforms: add transform rotate(5deg) to badge after edit',
  [{ type: 'css', selector: '.badge', property: 'transform', expected: 'rotate(5deg)', path: '/about' }],
  true,
  ['transforms', 'WPT-07'],
  undefined,
  [{ file: 'server.js', search: '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; }', replace: '.badge { display: inline-block; background: #e74c3c; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem; transform: rotate(5deg); }' }],
);

push(
  'transforms: add scale(1.1) to primary button on hover after edit',
  [{ type: 'css', selector: 'button.primary', property: 'transform', expected: 'scale(1.1)', path: '/about' }],
  true,
  ['transforms', 'WPT-07'],
  undefined,
  [{ file: 'server.js', search: 'button.primary { background: #3498db; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }', replace: 'button.primary { background: #3498db; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; transform: scale(1.1); }' }],
);

push(
  'transforms: add translateY(-2px) to card after edit',
  [{ type: 'css', selector: '.card', property: 'transform', expected: 'translateY(-2px)', path: '/about' }],
  true,
  ['transforms', 'WPT-07'],
  undefined,
  [{ file: 'server.js', search: '.card { background: white; padding: 1.5rem;', replace: '.card { background: white; padding: 1.5rem; transform: translateY(-2px);' }],
);

push(
  'transforms: add transform-origin top left to hero after edit',
  [{ type: 'css', selector: '.hero', property: 'transform-origin', expected: 'top left', path: '/about' }],
  true,
  ['transforms', 'WPT-07'],
  undefined,
  [{ file: 'server.js', search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }', replace: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; transform-origin: top left; }' }],
);

// -- mismatch --
push(
  'transforms: badge transform expected rotate(10deg) but is rotate(5deg)',
  [{ type: 'css', selector: '.badge', property: 'transform', expected: 'rotate(10deg)', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'css',
);

push(
  'transforms: card transform expected scale(2) but is translateY(-2px)',
  [{ type: 'css', selector: '.card', property: 'transform', expected: 'scale(2)', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'css',
);

push(
  'transforms: hero transform-origin expected center but is top left',
  [{ type: 'css', selector: '.hero', property: 'transform-origin', expected: 'center', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'css',
);

// -- grounding --
push(
  'transforms: fabricated perspective on hero',
  [{ type: 'css', selector: '.hero', property: 'perspective', expected: '1000px', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'grounding',
);

push(
  'transforms: fabricated .rotating-element selector',
  [{ type: 'css', selector: '.rotating-element', property: 'transform', expected: 'rotate(45deg)' }],
  false,
  ['transforms', 'WPT-07'],
  'grounding',
);

push(
  'transforms: fabricated skew property on badge',
  [{ type: 'css', selector: '.badge', property: 'transform', expected: 'skewX(15deg)', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'grounding',
);

push(
  'transforms: fabricated backface-visibility on card',
  [{ type: 'css', selector: '.card', property: 'backface-visibility', expected: 'hidden', path: '/about' }],
  false,
  ['transforms', 'WPT-07'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-08: ANIMATIONS/TRANSITIONS (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'animations: animated element has animation pulse 2s infinite',
  [{ type: 'css', selector: '.animated', property: 'animation', expected: 'pulse 2s infinite', path: '/edge-cases' }],
  true,
  ['animations', 'WPT-08'],
);

push(
  'animations: animated color is #9b59b6',
  [{ type: 'css', selector: '.animated', property: 'color', expected: '#9b59b6', path: '/edge-cases' }],
  true,
  ['animations', 'WPT-08'],
);

push(
  'animations: keyframes pulse defined in source',
  [{ type: 'content', file: 'server.js', pattern: '@keyframes pulse' }],
  true,
  ['animations', 'WPT-08'],
);

push(
  'animations: add transition 0.3s to nav-link after edit',
  [{ type: 'css', selector: 'a.nav-link', property: 'transition', expected: 'color 0.3s ease' }],
  true,
  ['animations', 'WPT-08'],
  undefined,
  [{ file: 'server.js', search: 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }', replace: 'a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; transition: color 0.3s ease; }' }],
);

// -- mismatch --
push(
  'animations: animated animation expected bounce but is pulse',
  [{ type: 'css', selector: '.animated', property: 'animation', expected: 'bounce 2s infinite', path: '/edge-cases' }],
  false,
  ['animations', 'WPT-08'],
  'css',
);

push(
  'animations: animated color expected #e74c3c but is #9b59b6',
  [{ type: 'css', selector: '.animated', property: 'color', expected: '#e74c3c', path: '/edge-cases' }],
  false,
  ['animations', 'WPT-08'],
  'css',
);

push(
  'animations: keyframes fadeIn not in source',
  [{ type: 'content', file: 'server.js', pattern: '@keyframes fadeIn' }],
  false,
  ['animations', 'WPT-08'],
  'content',
);

// -- grounding --
push(
  'animations: fabricated transition-duration on hero',
  [{ type: 'css', selector: '.hero', property: 'transition-duration', expected: '0.5s', path: '/about' }],
  false,
  ['animations', 'WPT-08'],
  'grounding',
);

push(
  'animations: fabricated .fade-in selector',
  [{ type: 'css', selector: '.fade-in', property: 'animation', expected: 'fadeIn 1s' }],
  false,
  ['animations', 'WPT-08'],
  'grounding',
);

push(
  'animations: fabricated animation-fill-mode on animated',
  [{ type: 'css', selector: '.animated', property: 'animation-fill-mode', expected: 'forwards', path: '/edge-cases' }],
  false,
  ['animations', 'WPT-08'],
  'grounding',
);

push(
  'animations: fabricated animation-timing-function on animated',
  [{ type: 'css', selector: '.animated', property: 'animation-timing-function', expected: 'ease-in-out', path: '/edge-cases' }],
  false,
  ['animations', 'WPT-08'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-09: OVERFLOW/SCROLL (11 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct --
push(
  'overflow: overflow-box overflow hidden',
  [{ type: 'css', selector: '.overflow-box', property: 'overflow', expected: 'hidden', path: '/edge-cases' }],
  true,
  ['overflow', 'WPT-09'],
);

push(
  'overflow: overflow-box width 200px',
  [{ type: 'css', selector: '.overflow-box', property: 'width', expected: '200px', path: '/edge-cases' }],
  true,
  ['overflow', 'WPT-09'],
);

push(
  'overflow: overflow-scroll overflow auto auto',
  [{ type: 'css', selector: '.overflow-scroll', property: 'overflow', expected: 'auto auto', path: '/edge-cases' }],
  true,
  ['overflow', 'WPT-09'],
);

push(
  'overflow: add scroll-behavior smooth to body after edit',
  [{ type: 'css', selector: 'body', property: 'scroll-behavior', expected: 'smooth' }],
  true,
  ['overflow', 'WPT-09'],
  undefined,
  [{ file: 'server.js', search: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; }', replace: 'body { font-family: sans-serif; margin: 2rem; background: #ffffff; color: #333; scroll-behavior: smooth; }' }],
);

// -- mismatch --
push(
  'overflow: overflow-box overflow expected visible but is hidden',
  [{ type: 'css', selector: '.overflow-box', property: 'overflow', expected: 'visible', path: '/edge-cases' }],
  false,
  ['overflow', 'WPT-09'],
  'css',
);

push(
  'overflow: overflow-box width expected 300px but is 200px',
  [{ type: 'css', selector: '.overflow-box', property: 'width', expected: '300px', path: '/edge-cases' }],
  false,
  ['overflow', 'WPT-09'],
  'css',
);

push(
  'overflow: overflow-scroll expected overflow-x scroll but is auto',
  [{ type: 'css', selector: '.overflow-scroll', property: 'overflow', expected: 'scroll', path: '/edge-cases' }],
  false,
  ['overflow', 'WPT-09'],
  'css',
);

// -- grounding --
push(
  'overflow: fabricated .scroll-container selector',
  [{ type: 'css', selector: '.scroll-container', property: 'overflow-y', expected: 'auto' }],
  false,
  ['overflow', 'WPT-09'],
  'grounding',
);

push(
  'overflow: fabricated overscroll-behavior on overflow-box',
  [{ type: 'css', selector: '.overflow-box', property: 'overscroll-behavior', expected: 'contain', path: '/edge-cases' }],
  false,
  ['overflow', 'WPT-09'],
  'grounding',
);

push(
  'overflow: fabricated scroll-snap-type on overflow-scroll',
  [{ type: 'css', selector: '.overflow-scroll', property: 'scroll-snap-type', expected: 'x mandatory', path: '/edge-cases' }],
  false,
  ['overflow', 'WPT-09'],
  'grounding',
);

push(
  'overflow: fabricated scrollbar-width on body',
  [{ type: 'css', selector: 'body', property: 'scrollbar-width', expected: 'thin' }],
  false,
  ['overflow', 'WPT-09'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// WPT-10: SELECTORS (12 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// -- correct (using real selectors from the demo app) --
push(
  'selectors: descendant selector .edge-hero .edge-title',
  [{ type: 'css', selector: '.edge-hero .edge-title', property: 'color', expected: '#e74c3c', path: '/edge-cases' }],
  true,
  ['selectors', 'WPT-10'],
);

push(
  'selectors: descendant selector .edge-card .edge-label',
  [{ type: 'css', selector: '.edge-card .edge-label', property: 'font-weight', expected: '600', path: '/edge-cases' }],
  true,
  ['selectors', 'WPT-10'],
);

push(
  'selectors: class selector .minified color',
  [{ type: 'css', selector: '.minified', property: 'color', expected: '#ff6600', path: '/edge-cases' }],
  true,
  ['selectors', 'WPT-10'],
);

push(
  'selectors: descendant .minified .inner background',
  [{ type: 'css', selector: '.minified .inner', property: 'background', expected: '#000', path: '/edge-cases' }],
  true,
  ['selectors', 'WPT-10'],
);

push(
  'selectors: class selector min-link text-decoration none',
  [{ type: 'css', selector: '.min-link', property: 'text-decoration', expected: 'none', path: '/edge-cases' }],
  true,
  ['selectors', 'WPT-10'],
);

// -- mismatch --
push(
  'selectors: edge-title color expected #2c3e50 but is #e74c3c (specificity)',
  [{ type: 'css', selector: '.edge-hero .edge-title', property: 'color', expected: '#2c3e50', path: '/edge-cases' }],
  false,
  ['selectors', 'WPT-10'],
  'css',
);

push(
  'selectors: minified color expected #333 but is #ff6600',
  [{ type: 'css', selector: '.minified', property: 'color', expected: '#333', path: '/edge-cases' }],
  false,
  ['selectors', 'WPT-10'],
  'css',
);

push(
  'selectors: min-link font-weight expected normal but is bold',
  [{ type: 'css', selector: '.min-link', property: 'font-weight', expected: 'normal', path: '/edge-cases' }],
  false,
  ['selectors', 'WPT-10'],
  'css',
);

// -- grounding (fabricated selectors using advanced CSS selector syntax) --
push(
  'selectors: fabricated :has() selector',
  [{ type: 'css', selector: '.card:has(.badge)', property: 'border', expected: '2px solid green', path: '/about' }],
  false,
  ['selectors', 'WPT-10'],
  'grounding',
);

push(
  'selectors: fabricated :is() selector',
  [{ type: 'css', selector: ':is(.card, .hero)', property: 'margin', expected: '1rem', path: '/about' }],
  false,
  ['selectors', 'WPT-10'],
  'grounding',
);

push(
  'selectors: fabricated :where() selector',
  [{ type: 'css', selector: ':where(.card) .card-title', property: 'color', expected: 'red', path: '/about' }],
  false,
  ['selectors', 'WPT-10'],
  'grounding',
);

push(
  'selectors: fabricated :nth-child selector',
  [{ type: 'css', selector: '.team-list li:nth-child(odd)', property: 'background', expected: '#f0f0f0', path: '/about' }],
  false,
  ['selectors', 'WPT-10'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING: HTML existence and content predicates mixed in (10 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

push(
  'html: hero element exists on about page',
  [{ type: 'html', selector: '.hero', expected: 'exists', path: '/about' }],
  true,
  ['html_existence', 'WPT-01'],
);

push(
  'html: data-table exists on about page',
  [{ type: 'html', selector: 'table.data-table', expected: 'exists', path: '/about' }],
  true,
  ['html_existence', 'WPT-01'],
);

push(
  'html: animated element exists on edge-cases page',
  [{ type: 'html', selector: '.animated', expected: 'exists', path: '/edge-cases' }],
  true,
  ['html_existence', 'WPT-08'],
);

push(
  'html: grid-container exists on edge-cases page',
  [{ type: 'html', selector: '.grid-container', expected: 'exists', path: '/edge-cases' }],
  true,
  ['html_existence', 'WPT-03'],
);

push(
  'html: fabricated .modal element',
  [{ type: 'html', selector: '.modal', expected: 'exists' }],
  false,
  ['html_existence', 'WPT-04'],
  'grounding',
);

push(
  'html: fabricated .tooltip element',
  [{ type: 'html', selector: '.tooltip', expected: 'exists' }],
  false,
  ['html_existence', 'WPT-06'],
  'grounding',
);

push(
  'content: server.js contains flex-container CSS',
  [{ type: 'content', file: 'server.js', pattern: 'flex-container' }],
  true,
  ['content_check', 'WPT-02'],
);

push(
  'content: server.js contains grid-template declaration',
  [{ type: 'content', file: 'server.js', pattern: 'grid-template' }],
  true,
  ['content_check', 'WPT-03'],
);

push(
  'content: server.js does not contain css-grid-subgrid',
  [{ type: 'content', file: 'server.js', pattern: 'css-grid-subgrid' }],
  false,
  ['content_check', 'WPT-03'],
  'content',
);

push(
  'content: server.js does not contain scroll-timeline',
  [{ type: 'content', file: 'server.js', pattern: 'scroll-timeline' }],
  false,
  ['content_check', 'WPT-09'],
  'content',
);

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/chromium-tests-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const categoryCounts: Record<string, number> = {};
const wptCounts: Record<string, number> = {};
const typeCounts: Record<string, number> = { css: 0, content: 0, html: 0 };
let passCount = 0;
let failCount = 0;

for (const s of scenarios) {
  // First non-css_rendering tag is the category
  const category = s.tags.find((t: string) => t !== 'css_rendering') || 'unknown';
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  // WPT tag
  const wpt = s.tags.find((t: string) => t.startsWith('WPT-')) || 'unknown';
  wptCounts[wpt] = (wptCounts[wpt] || 0) + 1;
  for (const p of s.predicates) {
    const t = p.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  if (s.expectedSuccess) passCount++; else failCount++;
}

console.log(`Generated ${scenarios.length} Chromium WPT scenarios -> ${OUTPUT_PATH}\n`);

console.log('By category:');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(22)} ${count}`);
}

console.log('\nBy WPT group:');
for (const [wpt, count] of Object.entries(wptCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${wpt.padEnd(22)} ${count}`);
}

console.log('\nBy predicate type:');
for (const [t, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(22)} ${count}`);
}

console.log(`\nExpected pass: ${passCount}  |  Expected fail: ${failCount}`);
