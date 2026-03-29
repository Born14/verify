#!/usr/bin/env bun
/**
 * stage-caniuse-css.ts — Can I Use CSS Feature Scenario Stager
 *
 * Generates verify scenarios from CSS feature support data (Can I Use patterns).
 * Embeds the most important modern CSS features and their edge cases.
 *
 * Categories:
 *   1. layout      — flexbox, grid, subgrid, container queries, aspect-ratio, gap, etc.
 *   2. colors      — oklch, lch, color-mix, relative color syntax, accent-color, etc.
 *   3. typography  — variable fonts, font-display, text-wrap, initial-letter, etc.
 *   4. selectors   — :has(), :is(), :where(), :not(), :focus-visible, ::marker, etc.
 *   5. animations  — scroll-timeline, view-transitions, scroll-driven animations, etc.
 *   6. visual      — backdrop-filter, clip-path, mask-image, object-fit, etc.
 *   7. modern      — @layer, @property, @scope, CSS nesting, anchor positioning, etc.
 *
 * Scenario types per feature:
 *   - supported    — correct modern CSS syntax (expectedSuccess: true)
 *   - invalid      — wrong/unsupported value (expectedSuccess: false, grounding fail)
 *   - fallback     — content predicate checking fallback pattern
 *   - prefixed     — vendor-prefixed version (where applicable)
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
) {
  const entry: Scenario = {
    id: `caniuse-${String(++id).padStart(3, '0')}`,
    description: desc,
    edits: [],
    predicates,
    expectedSuccess: success,
    tags: ['caniuse', ...tags],
  };
  if (failedGate) entry.expectedFailedGate = failedGate;
  scenarios.push(entry);
}

// ════════════════════════════════════════════════════════════════════════════════
// LAYOUT (30 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── Flexbox ──────────────────────────────────────────────────────────────────

push(
  'flexbox: display flex is valid',
  [{ type: 'css', selector: '.container', property: 'display', expected: 'flex' }],
  true,
  ['layout', 'flexbox'],
);

push(
  'flexbox: invalid flex-direction value',
  [{ type: 'css', selector: '.container', property: 'flex-direction', expected: 'diagonal' }],
  false,
  ['layout', 'flexbox'],
  'grounding',
);

push(
  'flexbox: flex-wrap fallback pattern',
  [{ type: 'content', file: 'styles.css', pattern: 'flex-wrap: wrap' }],
  true,
  ['layout', 'flexbox_fallback'],
);

// ── Grid ─────────────────────────────────────────────────────────────────────

push(
  'grid: display grid is valid',
  [{ type: 'css', selector: '.grid-layout', property: 'display', expected: 'grid' }],
  true,
  ['layout', 'grid'],
);

push(
  'grid: grid-template-columns repeat auto-fill',
  [{ type: 'css', selector: '.grid-layout', property: 'grid-template-columns', expected: 'repeat(auto-fill, minmax(200px, 1fr))' }],
  true,
  ['layout', 'grid_auto_fill'],
);

push(
  'grid: grid-template-columns repeat auto-fit',
  [{ type: 'css', selector: '.grid-layout', property: 'grid-template-columns', expected: 'repeat(auto-fit, minmax(150px, 1fr))' }],
  true,
  ['layout', 'grid_auto_fit'],
);

push(
  'grid: invalid grid-template-rows value',
  [{ type: 'css', selector: '.grid-layout', property: 'grid-template-rows', expected: 'repeat(auto-magic, 100px)' }],
  false,
  ['layout', 'grid'],
  'grounding',
);

// ── Subgrid ──────────────────────────────────────────────────────────────────

push(
  'subgrid: grid-template-columns subgrid',
  [{ type: 'css', selector: '.nested-grid', property: 'grid-template-columns', expected: 'subgrid' }],
  true,
  ['layout', 'subgrid'],
);

push(
  'subgrid: fallback pattern with @supports',
  [{ type: 'content', file: 'styles.css', pattern: '@supports (grid-template-columns: subgrid)' }],
  true,
  ['layout', 'subgrid_fallback'],
);

// ── Container Queries ────────────────────────────────────────────────────────

push(
  'container queries: container-type inline-size',
  [{ type: 'css', selector: '.card-wrapper', property: 'container-type', expected: 'inline-size' }],
  true,
  ['layout', 'container_queries'],
);

push(
  'container queries: container-name valid',
  [{ type: 'css', selector: '.sidebar', property: 'container-name', expected: 'sidebar' }],
  true,
  ['layout', 'container_queries'],
);

push(
  'container queries: invalid container-type value',
  [{ type: 'css', selector: '.card-wrapper', property: 'container-type', expected: 'block-size' }],
  false,
  ['layout', 'container_queries'],
  'grounding',
);

// ── Aspect Ratio ─────────────────────────────────────────────────────────────

push(
  'aspect-ratio: 16/9 is valid',
  [{ type: 'css', selector: '.video-embed', property: 'aspect-ratio', expected: '16 / 9' }],
  true,
  ['layout', 'aspect_ratio'],
);

push(
  'aspect-ratio: invalid ratio value',
  [{ type: 'css', selector: '.video-embed', property: 'aspect-ratio', expected: '16:9' }],
  false,
  ['layout', 'aspect_ratio'],
  'grounding',
);

push(
  'aspect-ratio: padding-top fallback',
  [{ type: 'content', file: 'styles.css', pattern: 'padding-top: 56.25%' }],
  true,
  ['layout', 'aspect_ratio_fallback'],
);

// ── Gap ──────────────────────────────────────────────────────────────────────

push(
  'gap: gap property in flex container',
  [{ type: 'css', selector: '.flex-list', property: 'gap', expected: '1rem' }],
  true,
  ['layout', 'gap'],
);

push(
  'gap: row-gap and column-gap',
  [{ type: 'css', selector: '.grid-layout', property: 'row-gap', expected: '20px' }],
  true,
  ['layout', 'gap'],
);

push(
  'gap: invalid gap value',
  [{ type: 'css', selector: '.flex-list', property: 'gap', expected: '1rem 2rem 3rem' }],
  false,
  ['layout', 'gap'],
  'grounding',
);

// ── Place Items ──────────────────────────────────────────────────────────────

push(
  'place-items: center shorthand',
  [{ type: 'css', selector: '.centered', property: 'place-items', expected: 'center' }],
  true,
  ['layout', 'place_items'],
);

push(
  'place-items: start end shorthand',
  [{ type: 'css', selector: '.grid-cell', property: 'place-items', expected: 'start end' }],
  true,
  ['layout', 'place_items'],
);

// ── Min/Max/Clamp ────────────────────────────────────────────────────────────

push(
  'clamp: font-size with clamp()',
  [{ type: 'css', selector: 'h1', property: 'font-size', expected: 'clamp(1.5rem, 4vw, 3rem)' }],
  true,
  ['layout', 'clamp'],
);

push(
  'min: width with min()',
  [{ type: 'css', selector: '.container', property: 'width', expected: 'min(90%, 1200px)' }],
  true,
  ['layout', 'min_max'],
);

push(
  'max: height with max()',
  [{ type: 'css', selector: '.panel', property: 'height', expected: 'max(300px, 50vh)' }],
  true,
  ['layout', 'min_max'],
);

// ── Fit Content ──────────────────────────────────────────────────────────────

push(
  'fit-content: width fit-content',
  [{ type: 'css', selector: '.tag', property: 'width', expected: 'fit-content' }],
  true,
  ['layout', 'fit_content'],
);

push(
  'fit-content: grid column with fit-content()',
  [{ type: 'css', selector: '.sidebar-grid', property: 'grid-template-columns', expected: 'fit-content(300px) 1fr' }],
  true,
  ['layout', 'fit_content'],
);

push(
  'fit-content: fallback max-width pattern',
  [{ type: 'content', file: 'styles.css', pattern: 'max-width: max-content' }],
  true,
  ['layout', 'fit_content_fallback'],
);

// ── Additional layout ────────────────────────────────────────────────────────

push(
  'inline-size: logical property for width',
  [{ type: 'css', selector: '.card', property: 'inline-size', expected: '100%' }],
  true,
  ['layout', 'logical_properties'],
);

push(
  'block-size: logical property for height',
  [{ type: 'css', selector: '.hero', property: 'block-size', expected: '100vh' }],
  true,
  ['layout', 'logical_properties'],
);

push(
  'margin-inline: logical margin shorthand',
  [{ type: 'css', selector: '.centered-block', property: 'margin-inline', expected: 'auto' }],
  true,
  ['layout', 'logical_properties'],
);

// ════════════════════════════════════════════════════════════════════════════════
// COLORS (20 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── oklch ────────────────────────────────────────────────────────────────────

push(
  'oklch: valid oklch color',
  [{ type: 'css', selector: '.brand', property: 'color', expected: 'oklch(0.7 0.15 210)' }],
  true,
  ['colors', 'oklch'],
);

push(
  'oklch: invalid oklch missing chroma',
  [{ type: 'css', selector: '.brand', property: 'color', expected: 'oklch(0.7 210)' }],
  false,
  ['colors', 'oklch'],
  'grounding',
);

push(
  'oklch: hex fallback for oklch',
  [{ type: 'content', file: 'styles.css', pattern: 'color: #3b82f6' }],
  true,
  ['colors', 'oklch_fallback'],
);

// ── lch ──────────────────────────────────────────────────────────────────────

push(
  'lch: valid lch color',
  [{ type: 'css', selector: '.accent', property: 'background-color', expected: 'lch(50% 80 240)' }],
  true,
  ['colors', 'lch'],
);

push(
  'lch: invalid lch with negative lightness',
  [{ type: 'css', selector: '.accent', property: 'background-color', expected: 'lch(-10% 80 240)' }],
  false,
  ['colors', 'lch'],
  'grounding',
);

// ── color-mix ────────────────────────────────────────────────────────────────

push(
  'color-mix: valid color-mix in srgb',
  [{ type: 'css', selector: '.tinted', property: 'background-color', expected: 'color-mix(in srgb, blue 30%, white)' }],
  true,
  ['colors', 'color_mix'],
);

push(
  'color-mix: valid color-mix in oklch',
  [{ type: 'css', selector: '.gradient-stop', property: 'color', expected: 'color-mix(in oklch, red, blue)' }],
  true,
  ['colors', 'color_mix'],
);

push(
  'color-mix: invalid color space',
  [{ type: 'css', selector: '.tinted', property: 'background-color', expected: 'color-mix(in cmyk, blue, white)' }],
  false,
  ['colors', 'color_mix'],
  'grounding',
);

// ── Relative color syntax ────────────────────────────────────────────────────

push(
  'relative color: from keyword in rgb',
  [{ type: 'css', selector: '.lighten', property: 'color', expected: 'rgb(from blue r g calc(b + 50))' }],
  true,
  ['colors', 'relative_color'],
);

push(
  'relative color: from keyword in hsl',
  [{ type: 'css', selector: '.desaturate', property: 'color', expected: 'hsl(from var(--brand) h calc(s - 20%) l)' }],
  true,
  ['colors', 'relative_color'],
);

// ── color() ──────────────────────────────────────────────────────────────────

push(
  'color(): display-p3 wide gamut color',
  [{ type: 'css', selector: '.vivid', property: 'color', expected: 'color(display-p3 1 0.2 0.1)' }],
  true,
  ['colors', 'color_function'],
);

push(
  'color(): invalid color space',
  [{ type: 'css', selector: '.vivid', property: 'color', expected: 'color(adobe-rgb 1 0 0)' }],
  false,
  ['colors', 'color_function'],
  'grounding',
);

// ── forced-colors / light-dark / accent-color / color-scheme ─────────────────

push(
  'forced-colors: media query pattern',
  [{ type: 'content', file: 'styles.css', pattern: '@media (forced-colors: active)' }],
  true,
  ['colors', 'forced_colors'],
);

push(
  'light-dark(): valid light-dark function',
  [{ type: 'css', selector: '.surface', property: 'background-color', expected: 'light-dark(#fff, #1a1a2e)' }],
  true,
  ['colors', 'light_dark'],
);

push(
  'accent-color: auto value',
  [{ type: 'css', selector: 'input[type=checkbox]', property: 'accent-color', expected: 'auto' }],
  true,
  ['colors', 'accent_color'],
);

push(
  'accent-color: custom color value',
  [{ type: 'css', selector: 'input[type=checkbox]', property: 'accent-color', expected: '#3b82f6' }],
  true,
  ['colors', 'accent_color'],
);

push(
  'color-scheme: light dark',
  [{ type: 'css', selector: ':root', property: 'color-scheme', expected: 'light dark' }],
  true,
  ['colors', 'color_scheme'],
);

push(
  'color-scheme: invalid value',
  [{ type: 'css', selector: ':root', property: 'color-scheme', expected: 'sepia' }],
  false,
  ['colors', 'color_scheme'],
  'grounding',
);

push(
  'color-scheme: prefers-color-scheme fallback',
  [{ type: 'content', file: 'styles.css', pattern: '@media (prefers-color-scheme: dark)' }],
  true,
  ['colors', 'color_scheme_fallback'],
);

// ════════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY (15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── Variable Fonts ───────────────────────────────────────────────────────────

push(
  'variable fonts: font-variation-settings wght',
  [{ type: 'css', selector: '.heading', property: 'font-variation-settings', expected: '"wght" 700' }],
  true,
  ['typography', 'variable_fonts'],
);

push(
  'variable fonts: font-weight range in @font-face',
  [{ type: 'content', file: 'styles.css', pattern: 'font-weight: 100 900' }],
  true,
  ['typography', 'variable_fonts'],
);

push(
  'variable fonts: invalid axis tag',
  [{ type: 'css', selector: '.heading', property: 'font-variation-settings', expected: '"FAKE" 500' }],
  false,
  ['typography', 'variable_fonts'],
  'grounding',
);

// ── Font Display ─────────────────────────────────────────────────────────────

push(
  'font-display: swap value',
  [{ type: 'content', file: 'styles.css', pattern: 'font-display: swap' }],
  true,
  ['typography', 'font_display'],
);

push(
  'font-display: optional value',
  [{ type: 'content', file: 'styles.css', pattern: 'font-display: optional' }],
  true,
  ['typography', 'font_display'],
);

// ── Text Wrap ────────────────────────────────────────────────────────────────

push(
  'text-wrap: balance value',
  [{ type: 'css', selector: '.headline', property: 'text-wrap', expected: 'balance' }],
  true,
  ['typography', 'text_wrap'],
);

push(
  'text-wrap: pretty value',
  [{ type: 'css', selector: 'p', property: 'text-wrap', expected: 'pretty' }],
  true,
  ['typography', 'text_wrap'],
);

push(
  'text-wrap: invalid value',
  [{ type: 'css', selector: '.headline', property: 'text-wrap', expected: 'optimal' }],
  false,
  ['typography', 'text_wrap'],
  'grounding',
);

// ── Hanging Punctuation ──────────────────────────────────────────────────────

push(
  'hanging-punctuation: first value',
  [{ type: 'css', selector: 'blockquote', property: 'hanging-punctuation', expected: 'first' }],
  true,
  ['typography', 'hanging_punctuation'],
);

push(
  'hanging-punctuation: first last force-end',
  [{ type: 'css', selector: '.body-text', property: 'hanging-punctuation', expected: 'first last force-end' }],
  true,
  ['typography', 'hanging_punctuation'],
);

// ── Initial Letter ───────────────────────────────────────────────────────────

push(
  'initial-letter: drop cap size 3',
  [{ type: 'css', selector: 'p::first-letter', property: 'initial-letter', expected: '3' }],
  true,
  ['typography', 'initial_letter'],
);

push(
  'initial-letter: size and sink',
  [{ type: 'css', selector: '.dropcap::first-letter', property: 'initial-letter', expected: '3 2' }],
  true,
  ['typography', 'initial_letter'],
);

// ── Text Decoration Thickness ────────────────────────────────────────────────

push(
  'text-decoration-thickness: from-font',
  [{ type: 'css', selector: 'a', property: 'text-decoration-thickness', expected: 'from-font' }],
  true,
  ['typography', 'text_decoration_thickness'],
);

push(
  'text-decoration-thickness: explicit value',
  [{ type: 'css', selector: '.underlined', property: 'text-decoration-thickness', expected: '3px' }],
  true,
  ['typography', 'text_decoration_thickness'],
);

push(
  'text-underline-offset: valid offset',
  [{ type: 'css', selector: 'a', property: 'text-underline-offset', expected: '4px' }],
  true,
  ['typography', 'text_decoration_thickness'],
);

// ════════════════════════════════════════════════════════════════════════════════
// SELECTORS (20 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── :has() ───────────────────────────────────────────────────────────────────

push(
  ':has(): parent selector pattern',
  [{ type: 'content', file: 'styles.css', pattern: ':has(' }],
  true,
  ['selectors', 'has'],
);

push(
  ':has(): card with image styling',
  [{ type: 'css', selector: '.card:has(img)', property: 'padding', expected: '0' }],
  true,
  ['selectors', 'has'],
);

push(
  ':has(): invalid empty :has()',
  [{ type: 'css', selector: '.card:has()', property: 'display', expected: 'none' }],
  false,
  ['selectors', 'has'],
  'grounding',
);

// ── :is() and :where() ──────────────────────────────────────────────────────

push(
  ':is(): grouping selector pattern',
  [{ type: 'content', file: 'styles.css', pattern: ':is(' }],
  true,
  ['selectors', 'is'],
);

push(
  ':where(): zero-specificity selector',
  [{ type: 'content', file: 'styles.css', pattern: ':where(' }],
  true,
  ['selectors', 'where'],
);

push(
  ':is(): heading group styling',
  [{ type: 'css', selector: ':is(h1, h2, h3)', property: 'line-height', expected: '1.2' }],
  true,
  ['selectors', 'is'],
);

// ── :not() multi-arg ─────────────────────────────────────────────────────────

push(
  ':not(): multi-argument selector',
  [{ type: 'css', selector: ':not(.hidden, .collapsed)', property: 'display', expected: 'block' }],
  true,
  ['selectors', 'not_multi'],
);

// ── :nth-child(of) ───────────────────────────────────────────────────────────

push(
  ':nth-child(of): filtered nth-child',
  [{ type: 'content', file: 'styles.css', pattern: ':nth-child(' }],
  true,
  ['selectors', 'nth_child_of'],
);

// ── :focus-visible ───────────────────────────────────────────────────────────

push(
  ':focus-visible: keyboard focus ring',
  [{ type: 'css', selector: 'button:focus-visible', property: 'outline', expected: '2px solid #3b82f6' }],
  true,
  ['selectors', 'focus_visible'],
);

push(
  ':focus-visible: fallback :focus pattern',
  [{ type: 'content', file: 'styles.css', pattern: ':focus-visible' }],
  true,
  ['selectors', 'focus_visible_fallback'],
);

// ── :dir() and :lang() ───────────────────────────────────────────────────────

push(
  ':dir(): rtl direction selector',
  [{ type: 'content', file: 'styles.css', pattern: ':dir(rtl)' }],
  true,
  ['selectors', 'dir'],
);

push(
  ':lang(): language-specific styling',
  [{ type: 'content', file: 'styles.css', pattern: ':lang(' }],
  true,
  ['selectors', 'lang'],
);

// ── ::backdrop ───────────────────────────────────────────────────────────────

push(
  '::backdrop: dialog backdrop styling',
  [{ type: 'css', selector: 'dialog::backdrop', property: 'background-color', expected: 'rgba(0, 0, 0, 0.5)' }],
  true,
  ['selectors', 'backdrop'],
);

// ── ::marker ─────────────────────────────────────────────────────────────────

push(
  '::marker: list marker styling',
  [{ type: 'css', selector: 'li::marker', property: 'color', expected: '#3b82f6' }],
  true,
  ['selectors', 'marker'],
);

push(
  '::marker: custom content',
  [{ type: 'css', selector: 'li::marker', property: 'content', expected: '"\\2713 "' }],
  true,
  ['selectors', 'marker'],
);

// ── ::selection ──────────────────────────────────────────────────────────────

push(
  '::selection: custom selection color',
  [{ type: 'css', selector: '::selection', property: 'background-color', expected: '#3b82f6' }],
  true,
  ['selectors', 'selection'],
);

// ── ::placeholder ────────────────────────────────────────────────────────────

push(
  '::placeholder: placeholder text styling',
  [{ type: 'css', selector: 'input::placeholder', property: 'color', expected: '#9ca3af' }],
  true,
  ['selectors', 'placeholder'],
);

push(
  '::placeholder: prefixed fallback pattern',
  [{ type: 'content', file: 'styles.css', pattern: '::-webkit-input-placeholder' }],
  true,
  ['selectors', 'placeholder_prefixed'],
);

push(
  '::placeholder: moz prefix fallback',
  [{ type: 'content', file: 'styles.css', pattern: '::-moz-placeholder' }],
  true,
  ['selectors', 'placeholder_prefixed'],
);

// ════════════════════════════════════════════════════════════════════════════════
// ANIMATIONS (10 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── Scroll-Driven Animations ─────────────────────────────────────────────────

push(
  'scroll-driven: animation-timeline scroll()',
  [{ type: 'css', selector: '.progress-bar', property: 'animation-timeline', expected: 'scroll()' }],
  true,
  ['animations', 'scroll_driven'],
);

push(
  'scroll-driven: animation-range',
  [{ type: 'css', selector: '.reveal', property: 'animation-range', expected: 'entry 0% entry 100%' }],
  true,
  ['animations', 'scroll_driven'],
);

push(
  'scroll-driven: @supports fallback',
  [{ type: 'content', file: 'styles.css', pattern: '@supports (animation-timeline: scroll())' }],
  true,
  ['animations', 'scroll_driven_fallback'],
);

push(
  'scroll-driven: view() timeline',
  [{ type: 'css', selector: '.fade-in', property: 'animation-timeline', expected: 'view()' }],
  true,
  ['animations', 'scroll_driven'],
);

// ── View Transitions ─────────────────────────────────────────────────────────

push(
  'view-transitions: view-transition-name property',
  [{ type: 'css', selector: '.card', property: 'view-transition-name', expected: 'card-hero' }],
  true,
  ['animations', 'view_transitions'],
);

push(
  'view-transitions: ::view-transition-old pseudo',
  [{ type: 'content', file: 'styles.css', pattern: '::view-transition-old(' }],
  true,
  ['animations', 'view_transitions'],
);

push(
  'view-transitions: ::view-transition-new pseudo',
  [{ type: 'content', file: 'styles.css', pattern: '::view-transition-new(' }],
  true,
  ['animations', 'view_transitions'],
);

// ── Discrete Animations ──────────────────────────────────────────────────────

push(
  'discrete: transition-behavior allow-discrete',
  [{ type: 'css', selector: '.tooltip', property: 'transition-behavior', expected: 'allow-discrete' }],
  true,
  ['animations', 'discrete'],
);

push(
  'discrete: @starting-style for entry animation',
  [{ type: 'content', file: 'styles.css', pattern: '@starting-style' }],
  true,
  ['animations', 'discrete_starting_style'],
);

push(
  'discrete: invalid transition-behavior value',
  [{ type: 'css', selector: '.tooltip', property: 'transition-behavior', expected: 'force-discrete' }],
  false,
  ['animations', 'discrete'],
  'grounding',
);

// ════════════════════════════════════════════════════════════════════════════════
// VISUAL (15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── Backdrop Filter ──────────────────────────────────────────────────────────

push(
  'backdrop-filter: blur effect',
  [{ type: 'css', selector: '.glassmorphism', property: 'backdrop-filter', expected: 'blur(10px)' }],
  true,
  ['visual', 'backdrop_filter'],
);

push(
  'backdrop-filter: webkit prefix fallback',
  [{ type: 'content', file: 'styles.css', pattern: '-webkit-backdrop-filter' }],
  true,
  ['visual', 'backdrop_filter_prefixed'],
);

push(
  'backdrop-filter: invalid function',
  [{ type: 'css', selector: '.glassmorphism', property: 'backdrop-filter', expected: 'sharpen(5px)' }],
  false,
  ['visual', 'backdrop_filter'],
  'grounding',
);

// ── Mix Blend Mode ───────────────────────────────────────────────────────────

push(
  'mix-blend-mode: overlay value',
  [{ type: 'css', selector: '.overlay-text', property: 'mix-blend-mode', expected: 'overlay' }],
  true,
  ['visual', 'mix_blend_mode'],
);

push(
  'mix-blend-mode: invalid value',
  [{ type: 'css', selector: '.overlay-text', property: 'mix-blend-mode', expected: 'dissolve' }],
  false,
  ['visual', 'mix_blend_mode'],
  'grounding',
);

// ── Clip Path ────────────────────────────────────────────────────────────────

push(
  'clip-path: polygon shape',
  [{ type: 'css', selector: '.diamond', property: 'clip-path', expected: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }],
  true,
  ['visual', 'clip_path'],
);

push(
  'clip-path: circle shape',
  [{ type: 'css', selector: '.avatar', property: 'clip-path', expected: 'circle(50%)' }],
  true,
  ['visual', 'clip_path'],
);

// ── Mask Image ───────────────────────────────────────────────────────────────

push(
  'mask-image: linear-gradient mask',
  [{ type: 'css', selector: '.fade-edge', property: 'mask-image', expected: 'linear-gradient(to right, transparent, black)' }],
  true,
  ['visual', 'mask_image'],
);

push(
  'mask-image: webkit prefix fallback',
  [{ type: 'content', file: 'styles.css', pattern: '-webkit-mask-image' }],
  true,
  ['visual', 'mask_image_prefixed'],
);

// ── Filter ───────────────────────────────────────────────────────────────────

push(
  'filter: multiple filter functions',
  [{ type: 'css', selector: '.desaturated', property: 'filter', expected: 'grayscale(50%) blur(2px)' }],
  true,
  ['visual', 'filter'],
);

// ── Object Fit / Position ────────────────────────────────────────────────────

push(
  'object-fit: cover value',
  [{ type: 'css', selector: '.hero-img', property: 'object-fit', expected: 'cover' }],
  true,
  ['visual', 'object_fit'],
);

push(
  'object-position: custom position',
  [{ type: 'css', selector: '.hero-img', property: 'object-position', expected: 'center top' }],
  true,
  ['visual', 'object_position'],
);

// ── Image Set ────────────────────────────────────────────────────────────────

push(
  'image-set: resolution-based selection pattern',
  [{ type: 'content', file: 'styles.css', pattern: 'image-set(' }],
  true,
  ['visual', 'image_set'],
);

// ── Content Visibility ───────────────────────────────────────────────────────

push(
  'content-visibility: auto value',
  [{ type: 'css', selector: '.lazy-section', property: 'content-visibility', expected: 'auto' }],
  true,
  ['visual', 'content_visibility'],
);

push(
  'content-visibility: contain-intrinsic-size companion',
  [{ type: 'css', selector: '.lazy-section', property: 'contain-intrinsic-size', expected: '0 500px' }],
  true,
  ['visual', 'content_visibility'],
);

// ════════════════════════════════════════════════════════════════════════════════
// MODERN (15 scenarios)
// ════════════════════════════════════════════════════════════════════════════════

// ── @layer ───────────────────────────────────────────────────────────────────

push(
  '@layer: cascade layer declaration',
  [{ type: 'content', file: 'styles.css', pattern: '@layer' }],
  true,
  ['modern', 'layer'],
);

push(
  '@layer: ordered layer pattern',
  [{ type: 'content', file: 'styles.css', pattern: '@layer reset, base, components, utilities' }],
  true,
  ['modern', 'layer'],
);

// ── @property ────────────────────────────────────────────────────────────────

push(
  '@property: custom property registration',
  [{ type: 'content', file: 'styles.css', pattern: '@property --' }],
  true,
  ['modern', 'property'],
);

push(
  '@property: syntax descriptor',
  [{ type: 'content', file: 'styles.css', pattern: 'syntax: "<color>"' }],
  true,
  ['modern', 'property'],
);

// ── @scope ───────────────────────────────────────────────────────────────────

push(
  '@scope: scoped styling pattern',
  [{ type: 'content', file: 'styles.css', pattern: '@scope' }],
  true,
  ['modern', 'scope'],
);

push(
  '@scope: scope with limit',
  [{ type: 'content', file: 'styles.css', pattern: '@scope (.card) to (.card-footer)' }],
  true,
  ['modern', 'scope'],
);

// ── @starting-style ──────────────────────────────────────────────────────────

push(
  '@starting-style: entry animation initial state',
  [{ type: 'content', file: 'styles.css', pattern: '@starting-style' }],
  true,
  ['modern', 'starting_style'],
);

// ── @supports ────────────────────────────────────────────────────────────────

push(
  '@supports: feature query pattern',
  [{ type: 'content', file: 'styles.css', pattern: '@supports' }],
  true,
  ['modern', 'supports'],
);

push(
  '@supports: not operator for fallback',
  [{ type: 'content', file: 'styles.css', pattern: '@supports not' }],
  true,
  ['modern', 'supports'],
);

// ── @container ───────────────────────────────────────────────────────────────

push(
  '@container: container query rule',
  [{ type: 'content', file: 'styles.css', pattern: '@container' }],
  true,
  ['modern', 'container'],
);

// ── Popover ──────────────────────────────────────────────────────────────────

push(
  ':popover-open: popover pseudo-class',
  [{ type: 'css', selector: '[popover]:popover-open', property: 'opacity', expected: '1' }],
  true,
  ['modern', 'popover'],
);

push(
  'popover: html attribute presence',
  [{ type: 'html', selector: '[popover]', expected: 'exists' }],
  true,
  ['modern', 'popover'],
);

// ── Anchor Positioning ───────────────────────────────────────────────────────

push(
  'anchor positioning: anchor-name property',
  [{ type: 'css', selector: '.trigger', property: 'anchor-name', expected: '--tooltip-anchor' }],
  true,
  ['modern', 'anchor_positioning'],
);

push(
  'anchor positioning: position-anchor property',
  [{ type: 'css', selector: '.tooltip', property: 'position-anchor', expected: '--tooltip-anchor' }],
  true,
  ['modern', 'anchor_positioning'],
);

// ── CSS Nesting ──────────────────────────────────────────────────────────────

push(
  'CSS nesting: ampersand pattern in source',
  [{ type: 'content', file: 'styles.css', pattern: '& ' }],
  true,
  ['modern', 'nesting'],
);

// ════════════════════════════════════════════════════════════════════════════════
// ADDITIONAL FEATURES (filling gaps to ~150)
// ════════════════════════════════════════════════════════════════════════════════

// ── Scroll Snap ──────────────────────────────────────────────────────────────

push(
  'scroll-snap: scroll-snap-type mandatory',
  [{ type: 'css', selector: '.carousel', property: 'scroll-snap-type', expected: 'x mandatory' }],
  true,
  ['layout', 'scroll_snap'],
);

push(
  'scroll-snap: snap-align center',
  [{ type: 'css', selector: '.carousel-item', property: 'scroll-snap-align', expected: 'center' }],
  true,
  ['layout', 'scroll_snap'],
);

push(
  'scroll-snap: invalid snap type',
  [{ type: 'css', selector: '.carousel', property: 'scroll-snap-type', expected: 'z mandatory' }],
  false,
  ['layout', 'scroll_snap'],
  'grounding',
);

// ── overscroll-behavior ──────────────────────────────────────────────────────

push(
  'overscroll-behavior: contain value',
  [{ type: 'css', selector: '.modal', property: 'overscroll-behavior', expected: 'contain' }],
  true,
  ['layout', 'overscroll_behavior'],
);

// ── Writing Mode ─────────────────────────────────────────────────────────────

push(
  'writing-mode: vertical-rl',
  [{ type: 'css', selector: '.vertical-text', property: 'writing-mode', expected: 'vertical-rl' }],
  true,
  ['typography', 'writing_mode'],
);

// ── Hyphens ──────────────────────────────────────────────────────────────────

push(
  'hyphens: auto for text justification',
  [{ type: 'css', selector: '.justified', property: 'hyphens', expected: 'auto' }],
  true,
  ['typography', 'hyphens'],
);

// ── Font Palette ─────────────────────────────────────────────────────────────

push(
  'font-palette: dark palette',
  [{ type: 'css', selector: '.emoji', property: 'font-palette', expected: 'dark' }],
  true,
  ['typography', 'font_palette'],
);

// ── touch-action ─────────────────────────────────────────────────────────────

push(
  'touch-action: manipulation value',
  [{ type: 'css', selector: '.interactive', property: 'touch-action', expected: 'manipulation' }],
  true,
  ['visual', 'touch_action'],
);

// ── will-change ──────────────────────────────────────────────────────────────

push(
  'will-change: transform optimization hint',
  [{ type: 'css', selector: '.animated', property: 'will-change', expected: 'transform' }],
  true,
  ['visual', 'will_change'],
);

// ── contain ──────────────────────────────────────────────────────────────────

push(
  'contain: layout paint for perf',
  [{ type: 'css', selector: '.widget', property: 'contain', expected: 'layout paint' }],
  true,
  ['visual', 'contain'],
);

// ── prefers-reduced-motion ───────────────────────────────────────────────────

push(
  'prefers-reduced-motion: media query',
  [{ type: 'content', file: 'styles.css', pattern: '@media (prefers-reduced-motion: reduce)' }],
  true,
  ['animations', 'prefers_reduced_motion'],
);

// ── prefers-contrast ─────────────────────────────────────────────────────────

push(
  'prefers-contrast: high contrast media query',
  [{ type: 'content', file: 'styles.css', pattern: '@media (prefers-contrast: more)' }],
  true,
  ['colors', 'prefers_contrast'],
);

// ── color-gamut ──────────────────────────────────────────────────────────────

push(
  'color-gamut: p3 gamut media query',
  [{ type: 'content', file: 'styles.css', pattern: '@media (color-gamut: p3)' }],
  true,
  ['colors', 'color_gamut'],
);

// ── inert attribute ──────────────────────────────────────────────────────────

push(
  'inert: html inert attribute',
  [{ type: 'html', selector: '[inert]', expected: 'exists' }],
  true,
  ['modern', 'inert'],
);

// ── dialog element ───────────────────────────────────────────────────────────

push(
  'dialog: html dialog element',
  [{ type: 'html', selector: 'dialog', expected: 'exists' }],
  true,
  ['modern', 'dialog'],
);

// ── details/summary ──────────────────────────────────────────────────────────

push(
  'details: name attribute for exclusive accordion',
  [{ type: 'html', selector: 'details[name]', expected: 'exists' }],
  true,
  ['modern', 'details_name'],
);

// ── Individual transform properties ──────────────────────────────────────────

push(
  'individual transforms: translate property',
  [{ type: 'css', selector: '.slide-in', property: 'translate', expected: '0 -100%' }],
  true,
  ['animations', 'individual_transforms'],
);

push(
  'individual transforms: rotate property',
  [{ type: 'css', selector: '.spin', property: 'rotate', expected: '45deg' }],
  true,
  ['animations', 'individual_transforms'],
);

push(
  'individual transforms: scale property',
  [{ type: 'css', selector: '.zoom', property: 'scale', expected: '1.5' }],
  true,
  ['animations', 'individual_transforms'],
);

// ════════════════════════════════════════════════════════════════════════════════
// CROSS-CUTTING EDGE CASES (extra scenarios for coverage)
// ════════════════════════════════════════════════════════════════════════════════

// ── Vendor prefix patterns ───────────────────────────────────────────────────

push(
  'webkit prefix: -webkit-appearance none',
  [{ type: 'css', selector: 'select', property: '-webkit-appearance', expected: 'none' }],
  true,
  ['cross_cutting', 'webkit_prefix'],
);

push(
  'webkit prefix: -webkit-line-clamp',
  [{ type: 'css', selector: '.truncate', property: '-webkit-line-clamp', expected: '3' }],
  true,
  ['cross_cutting', 'webkit_prefix'],
);

push(
  'moz prefix: -moz-appearance none',
  [{ type: 'css', selector: 'select', property: '-moz-appearance', expected: 'none' }],
  true,
  ['cross_cutting', 'moz_prefix'],
);

// ── Custom properties (CSS variables) ────────────────────────────────────────

push(
  'CSS variables: var() function usage',
  [{ type: 'css', selector: '.themed', property: 'color', expected: 'var(--text-primary)' }],
  true,
  ['cross_cutting', 'css_variables'],
);

push(
  'CSS variables: fallback in var()',
  [{ type: 'css', selector: '.themed', property: 'background', expected: 'var(--bg, #ffffff)' }],
  true,
  ['cross_cutting', 'css_variables'],
);

push(
  'CSS variables: invalid var reference without --',
  [{ type: 'css', selector: '.themed', property: 'color', expected: 'var(text-primary)' }],
  false,
  ['cross_cutting', 'css_variables'],
  'grounding',
);

// ── calc() edge cases ────────────────────────────────────────────────────────

push(
  'calc: nested calc expression',
  [{ type: 'css', selector: '.sidebar', property: 'width', expected: 'calc(100% - 2 * var(--gap))' }],
  true,
  ['cross_cutting', 'calc'],
);

push(
  'calc: mixed units',
  [{ type: 'css', selector: '.header', property: 'height', expected: 'calc(3rem + 20px)' }],
  true,
  ['cross_cutting', 'calc'],
);

// ── Modern value functions ───────────────────────────────────────────────────

push(
  'env(): safe-area-inset usage',
  [{ type: 'css', selector: '.mobile-nav', property: 'padding-bottom', expected: 'env(safe-area-inset-bottom)' }],
  true,
  ['cross_cutting', 'env_function'],
);

push(
  'round(): CSS math rounding',
  [{ type: 'css', selector: '.grid-item', property: 'width', expected: 'round(33.33%, 1px)' }],
  true,
  ['cross_cutting', 'round_function'],
);

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

const OUTPUT_PATH = resolve(__dirname, '../../fixtures/scenarios/caniuse-css-staged.json');
writeFileSync(OUTPUT_PATH, JSON.stringify(scenarios, null, 2));

const categoryCounts: Record<string, number> = {};
const featureCounts: Record<string, number> = {};
const typeCounts: Record<string, number> = { css: 0, content: 0, html: 0 };
let passCount = 0;
let failCount = 0;

for (const s of scenarios) {
  const category = s.tags[1] || 'unknown';
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  const feature = s.tags[2] || 'unknown';
  featureCounts[feature] = (featureCounts[feature] || 0) + 1;
  for (const p of s.predicates) {
    const t = p.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  if (s.expectedSuccess) passCount++; else failCount++;
}

console.log(`Generated ${scenarios.length} Can I Use CSS scenarios → ${OUTPUT_PATH}\n`);

console.log('By category:');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(22)} ${count}`);
}

console.log('\nBy feature (top 20):');
for (const [feat, count] of Object.entries(featureCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${feat.padEnd(30)} ${count}`);
}

console.log('\nBy predicate type:');
for (const [t, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(22)} ${count}`);
}

console.log(`\nExpected pass: ${passCount}  |  Expected fail: ${failCount}`);
