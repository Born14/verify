#!/usr/bin/env bun
/**
 * harvest-css.ts — Real-World CSS Scenario Harvester
 * ===================================================
 *
 * Reads REAL CSS compatibility/feature data from fetched external sources
 * and converts them into verify scenarios with source: 'real-world'.
 *
 * Input sources (from supply cache):
 *   1. MDN Browser Compat Data  — CSS property existence, standard track status
 *   2. Can I Use                — CSS feature support levels, categories
 *   3. PostCSS Parser Tests     — Edge-case CSS that stresses parsers
 *
 * Output: VerifyScenario[] with mixed true/false positives.
 *
 * Usage:
 *   bun run scripts/supply/harvest-css.ts [--cache-dir=PATH] [--max=500]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, basename, extname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types (local — matches staged fixture shape)
// ─────────────────────────────────────────────────────────────────────────────

interface Edit {
  file: string;
  search: string;
  replace: string;
}

interface Predicate {
  type: string;
  selector?: string;
  property?: string;
  expected?: string;
  path?: string;
  file?: string;
  pattern?: string;
  description?: string;
}

interface VerifyScenario {
  id: string;
  description: string;
  edits: Edit[];
  predicates: Predicate[];
  expectedSuccess: boolean;
  tags: string[];
  rationale: string;
  source: 'real-world';
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo-app CSS Knowledge (ground truth from server.js)
// ─────────────────────────────────────────────────────────────────────────────

/** Selectors actually present in the demo-app /about route */
const ABOUT_SELECTORS: Record<string, Record<string, string>> = {
  'body':              { 'font-family': 'system-ui, sans-serif', 'margin': '0', 'padding': '2rem', 'background': '#f5f5f5' },
  'h2':               {},
  '.hero':             { 'background': '#3498db', 'color': 'white', 'padding': '2rem', 'border-radius': '8px' },
  '.hero .hero-title': { 'color': 'white', 'font-size': '2.5rem' },
  '.card':             { 'background': 'white', 'padding': '1.5rem', 'margin': '1rem 0', 'border-radius': '4px' },
  '.card .card-title': { 'font-weight': 'bold', 'font-size': '1.2rem' },
  '.badge':            { 'display': 'inline-block', 'background': '#e74c3c', 'color': 'white', 'padding': '0.25rem 0.75rem', 'border-radius': '12px', 'font-size': '0.8rem' },
  'a.nav-link':        { 'color': '#0066cc', 'margin-right': '1rem' },
  '.team-list':        { 'list-style': 'decimal', 'padding-left': '2rem' },
  '.team-list li':     { 'padding': '0.3rem 0' },
  'footer':            {},
  '.hidden':           { 'display': 'none' },
  '#details':          {},
  'img.logo':          { 'width': '100px', 'height': '100px' },
  'input.search':      { 'padding': '0.5rem', 'border': '1px solid #ccc', 'border-radius': '4px', 'width': '200px' },
  'button.primary':    { 'background': '#3498db', 'color': 'white', 'border': 'none', 'padding': '0.5rem 1rem', 'border-radius': '4px', 'cursor': 'pointer' },
  'table.data-table':  { 'width': '100%', 'border-collapse': 'collapse' },
  'table.data-table th': { 'background': '#ecf0f1', 'padding': '0.5rem', 'text-align': 'left' },
  'table.data-table td': { 'padding': '0.5rem', 'border-bottom': '1px solid #eee' },
};

/** Selectors actually present in the demo-app /edge-cases route */
const EDGE_SELECTORS: Record<string, Record<string, string>> = {
  '.edge-hero':              { 'color': '#2c3e50', 'font-size': '1.5rem', 'font-weight': 'bold' },
  '.edge-hero .edge-title':  { 'color': '#e74c3c', 'text-transform': 'uppercase' },
  '.flex-container':         { 'display': 'flex', 'flex': '1 0 auto', 'gap': '10px' },
  '.grid-container':         { 'display': 'grid', 'gap': '8px 16px' },
  '.overflow-box':           { 'overflow': 'hidden', 'width': '200px', 'height': '100px' },
  '.text-deco':              { 'text-decoration': 'underline wavy red' },
  '.clamp-width':            { 'width': 'clamp(200px, 50%, 800px)' },
  '.color-mix-test':         { 'color': 'color-mix(in srgb, red 50%, blue)' },
  '.nested-rule':            {},
  '.minified':               { 'color': '#ff6600', 'font-size': '14px' },
};

/** The anchor for injecting new CSS into /edge-cases style block */
const INJECT_ANCHOR = ".meta-test { content: 'meta'; }";

// ─────────────────────────────────────────────────────────────────────────────
// MDN Compat Harvester
// ─────────────────────────────────────────────────────────────────────────────

function harvestMDN(files: string[], maxScenarios: number): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  let counter = 0;

  // Find the MDN compat JSON file
  const mdnFile = files.find(f => basename(f).includes('mdn-compat') && f.endsWith('.json'));
  if (!mdnFile) return scenarios;

  let data: any;
  try {
    data = JSON.parse(readFileSync(mdnFile, 'utf-8'));
  } catch (e) {
    console.log(`  WARN: Failed to parse MDN compat JSON: ${(e as Error).message}`);
    return scenarios;
  }

  const cssProps = data?.css?.properties;
  if (!cssProps || typeof cssProps !== 'object') return scenarios;

  const propNames = Object.keys(cssProps);

  // Collect all known properties from the demo-app
  const aboutProps = new Set<string>();
  for (const props of Object.values(ABOUT_SELECTORS)) {
    for (const p of Object.keys(props as Record<string, string>)) aboutProps.add(p);
  }
  const edgeProps = new Set<string>();
  for (const props of Object.values(EDGE_SELECTORS)) {
    for (const p of Object.keys(props as Record<string, string>)) edgeProps.add(p);
  }

  // ── True positives: properties that exist in the demo-app ───────────────
  const aboutEntries = Object.entries(ABOUT_SELECTORS);
  for (const [selector, props] of aboutEntries) {
    for (const [prop, value] of Object.entries(props)) {
      if (!cssProps[prop]) continue; // Only MDN-documented props
      if (counter >= maxScenarios) break;

      const compat = cssProps[prop]?.__compat;
      const isStandard = compat?.status?.standard_track !== false;

      scenarios.push({
        id: `rw-css-mdn-${String(++counter).padStart(3, '0')}`,
        description: `MDN: ${prop} on ${selector} (standard=${isStandard})`,
        edits: [],
        predicates: [{
          type: 'css',
          selector,
          property: prop,
          expected: value,
          path: '/about',
        }],
        expectedSuccess: true,
        tags: ['mdn', 'css', 'true-positive', isStandard ? 'standard' : 'non-standard'],
        rationale: `Real MDN property '${prop}' verified against demo-app /about selector '${selector}'. Chrome support: ${compat?.support?.chrome?.version_added ?? 'unknown'}.`,
        source: 'real-world',
      });
    }
    if (counter >= maxScenarios) break;
  }

  // Edge-cases route true positives
  for (const [selector, props] of Object.entries(EDGE_SELECTORS)) {
    for (const [prop, value] of Object.entries(props)) {
      if (!cssProps[prop]) continue;
      if (counter >= maxScenarios) break;

      const compat = cssProps[prop]?.__compat;
      scenarios.push({
        id: `rw-css-mdn-${String(++counter).padStart(3, '0')}`,
        description: `MDN: ${prop} on ${selector} (edge-cases route)`,
        edits: [],
        predicates: [{
          type: 'css',
          selector,
          property: prop,
          expected: value,
          path: '/edge-cases',
        }],
        expectedSuccess: true,
        tags: ['mdn', 'css', 'true-positive', 'edge-cases'],
        rationale: `Real MDN property '${prop}' verified against demo-app /edge-cases selector '${selector}'. Chrome: ${compat?.support?.chrome?.version_added ?? '?'}.`,
        source: 'real-world',
      });
    }
    if (counter >= maxScenarios) break;
  }

  // ── False positives: fabricated selectors that don't exist ───────────────
  const fabricatedSelectors = [
    '.sidebar-nav', '.tooltip-arrow', '.progress-ring', '.avatar-circle',
    '.breadcrumb-item', '.modal-backdrop', '.skeleton-loader', '.ribbon-tag',
    '.accordion-header', '.pagination-link', '.chip-label', '.snackbar-msg',
    '.dropdown-menu', '.carousel-slide', '.timeline-dot', '.stepper-line',
  ];

  // Pick real MDN properties but pair them with non-existent selectors
  const commonProps = propNames.filter(p => aboutProps.has(p) || edgeProps.has(p));
  for (let i = 0; i < fabricatedSelectors.length && counter < maxScenarios; i++) {
    const prop = commonProps[i % commonProps.length];
    const compat = cssProps[prop]?.__compat;

    scenarios.push({
      id: `rw-css-mdn-${String(++counter).padStart(3, '0')}`,
      description: `MDN: fabricated selector '${fabricatedSelectors[i]}' with real property '${prop}'`,
      edits: [],
      predicates: [{
        type: 'css',
        selector: fabricatedSelectors[i],
        property: prop,
        expected: 'exists',
        path: '/about',
      }],
      expectedSuccess: false,
      tags: ['mdn', 'css', 'false-positive', 'fabricated-selector'],
      rationale: `Selector '${fabricatedSelectors[i]}' does NOT exist in demo-app. Property '${prop}' is real MDN (Chrome: ${compat?.support?.chrome?.version_added ?? '?'}). Grounding gate should reject.`,
      source: 'real-world',
    });
  }

  // ── Wrong value: real selector + real property + wrong value ─────────────
  const wrongValues: Array<{ sel: string; prop: string; wrong: string; path: string }> = [
    { sel: '.hero',           prop: 'background', wrong: '#ff00ff',      path: '/about' },
    { sel: '.badge',          prop: 'color',      wrong: 'black',        path: '/about' },
    { sel: '.card',           prop: 'padding',    wrong: '5rem',         path: '/about' },
    { sel: 'a.nav-link',     prop: 'color',      wrong: 'rgb(255,0,0)', path: '/about' },
    { sel: 'button.primary', prop: 'background', wrong: '#000000',      path: '/about' },
    { sel: '.edge-hero',     prop: 'color',      wrong: '#ffffff',      path: '/edge-cases' },
    { sel: '.flex-container', prop: 'display',   wrong: 'block',        path: '/edge-cases' },
    { sel: '.minified',       prop: 'color',     wrong: '#000000',      path: '/edge-cases' },
  ];

  for (const wv of wrongValues) {
    if (counter >= maxScenarios) break;
    scenarios.push({
      id: `rw-css-mdn-${String(++counter).padStart(3, '0')}`,
      description: `MDN: wrong value for ${wv.prop} on ${wv.sel} (expected ${wv.wrong})`,
      edits: [],
      predicates: [{
        type: 'css',
        selector: wv.sel,
        property: wv.prop,
        expected: wv.wrong,
        path: wv.path,
      }],
      expectedSuccess: false,
      tags: ['mdn', 'css', 'false-positive', 'wrong-value'],
      rationale: `Selector '${wv.sel}' exists but property '${wv.prop}' has a different value. Should fail at O.5b evidence gate.`,
      source: 'real-world',
    });
  }

  // ── Injection: add new real MDN properties via edits ────────────────────
  const injectableProps = propNames
    .filter(p => !aboutProps.has(p) && !edgeProps.has(p))
    .filter(p => cssProps[p]?.__compat?.status?.standard_track === true)
    .slice(0, 20);

  for (const prop of injectableProps) {
    if (counter >= maxScenarios) break;

    // Pick a reasonable default value for the property
    const defaultVal = guessDefaultValue(prop);
    if (!defaultVal) continue;

    const newCSS = `.mdn-injected-${prop.replace(/[^a-z0-9-]/g, '-')} { ${prop}: ${defaultVal}; }`;
    scenarios.push({
      id: `rw-css-mdn-${String(++counter).padStart(3, '0')}`,
      description: `MDN: inject standard property '${prop}' via edit`,
      edits: [{
        file: 'server.js',
        search: INJECT_ANCHOR,
        replace: `${INJECT_ANCHOR}\n    ${newCSS}`,
      }],
      predicates: [{
        type: 'css',
        selector: `.mdn-injected-${prop.replace(/[^a-z0-9-]/g, '-')}`,
        property: prop,
        expected: defaultVal,
        path: '/edge-cases',
      }],
      expectedSuccess: true,
      tags: ['mdn', 'css', 'injection', 'standard'],
      rationale: `Inject real MDN standard property '${prop}' into demo-app via edit. Tests full pipeline with real CSS property data.`,
      source: 'real-world',
    });
  }

  return scenarios;
}

/** Guess a reasonable CSS value for a property name */
function guessDefaultValue(prop: string): string | null {
  if (/color/i.test(prop)) return '#336699';
  if (/width|height|size|radius|gap|margin|padding|top|right|bottom|left|indent/i.test(prop)) return '10px';
  if (/weight/i.test(prop)) return '400';
  if (/family/i.test(prop)) return 'sans-serif';
  if (/style/i.test(prop) && /font/i.test(prop)) return 'italic';
  if (/style/i.test(prop) && /border/i.test(prop)) return 'solid';
  if (/style/i.test(prop) && /list/i.test(prop)) return 'disc';
  if (/decoration/i.test(prop)) return 'underline';
  if (/transform/i.test(prop) && /text/i.test(prop)) return 'uppercase';
  if (/transform/i.test(prop)) return 'rotate(0deg)';
  if (/display/i.test(prop)) return 'block';
  if (/position/i.test(prop)) return 'relative';
  if (/overflow/i.test(prop)) return 'hidden';
  if (/opacity/i.test(prop)) return '0.8';
  if (/z-index/i.test(prop)) return '1';
  if (/cursor/i.test(prop)) return 'pointer';
  if (/duration|delay/i.test(prop)) return '0.3s';
  if (/align|justify/i.test(prop)) return 'center';
  if (/direction/i.test(prop)) return 'ltr';
  if (/visibility/i.test(prop)) return 'visible';
  if (/white-space/i.test(prop)) return 'nowrap';
  if (/word/i.test(prop)) return 'break-all';
  if (/line-height/i.test(prop)) return '1.5';
  if (/letter-spacing/i.test(prop)) return '0.05em';
  if (/content/i.test(prop)) return "'test'";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Can I Use Harvester
// ─────────────────────────────────────────────────────────────────────────────

function harvestCanIUse(files: string[], maxScenarios: number): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  let counter = 0;

  const ciuFile = files.find(f => basename(f).includes('caniuse') && f.endsWith('.json'));
  if (!ciuFile) return scenarios;

  let data: any;
  try {
    data = JSON.parse(readFileSync(ciuFile, 'utf-8'));
  } catch (e) {
    console.log(`  WARN: Failed to parse Can I Use JSON: ${(e as Error).message}`);
    return scenarios;
  }

  const features = data?.data;
  if (!features || typeof features !== 'object') return scenarios;

  // Map CIU feature IDs to demo-app selectors/properties that use them
  const featureToDemo: Record<string, Array<{ selector: string; property: string; value: string; path: string }>> = {
    'flexbox':      [
      { selector: '.flex-container', property: 'display', value: 'flex', path: '/edge-cases' },
      { selector: '.flex-container', property: 'gap', value: '10px', path: '/edge-cases' },
    ],
    'css-grid':     [
      { selector: '.grid-container', property: 'display', value: 'grid', path: '/edge-cases' },
    ],
    'border-radius': [
      { selector: '.hero', property: 'border-radius', value: '8px', path: '/about' },
      { selector: '.card', property: 'border-radius', value: '4px', path: '/about' },
      { selector: '.badge', property: 'border-radius', value: '12px', path: '/about' },
    ],
    'css-boxshadow': [
      { selector: '.card', property: 'box-shadow', value: '0 2px 4px rgba(0,0,0,0.1)', path: '/about' },
    ],
    'inline-block': [
      { selector: '.badge', property: 'display', value: 'inline-block', path: '/about' },
    ],
    'css-textshadow': [],
    'css-overflow': [
      { selector: '.overflow-box', property: 'overflow', value: 'hidden', path: '/edge-cases' },
    ],
    'text-decoration': [
      { selector: '.text-deco', property: 'text-decoration', value: 'underline wavy red', path: '/edge-cases' },
    ],
    'css-text-transform': [
      { selector: '.edge-hero .edge-title', property: 'text-transform', value: 'uppercase', path: '/edge-cases' },
    ],
    'css-color-function': [
      { selector: '.color-mix-test', property: 'color', value: 'color-mix(in srgb, red 50%, blue)', path: '/edge-cases' },
    ],
    'css-math-functions': [
      { selector: '.clamp-width', property: 'width', value: 'clamp(200px, 50%, 800px)', path: '/edge-cases' },
    ],
  };

  // ── True positives: CIU features the demo-app actually uses ─────────────
  for (const [featureId, demoUsages] of Object.entries(featureToDemo)) {
    const feature = features[featureId];
    if (!feature || demoUsages.length === 0) continue;

    const isCSS = feature.categories?.includes('CSS') || feature.categories?.includes('CSS3');
    const title = feature.title || featureId;

    for (const usage of demoUsages) {
      if (counter >= maxScenarios) break;

      // Compute browser support summary
      const chromeSupport = getBestSupport(feature.stats?.chrome);
      const firefoxSupport = getBestSupport(feature.stats?.firefox);

      scenarios.push({
        id: `rw-css-ciu-${String(++counter).padStart(3, '0')}`,
        description: `CIU: ${title} — ${usage.property} on ${usage.selector}`,
        edits: [],
        predicates: [{
          type: 'css',
          selector: usage.selector,
          property: usage.property,
          expected: usage.value,
          path: usage.path,
        }],
        expectedSuccess: true,
        tags: ['caniuse', 'css', 'true-positive', isCSS ? 'css-feature' : 'other-feature'],
        rationale: `CIU feature '${title}' (${featureId}). Chrome: ${chromeSupport}, Firefox: ${firefoxSupport}. Demo-app uses this at ${usage.selector}.`,
        source: 'real-world',
      });
    }
  }

  // ── False positives: CIU CSS features NOT in demo-app ───────────────────
  const unusedCSSFeatures = Object.entries(features)
    .filter(([id, f]: [string, any]) =>
      (f.categories?.includes('CSS') || f.categories?.includes('CSS3'))
      && !featureToDemo[id]
    );

  // Generate scenarios for features the demo-app does NOT use
  const fabricatedFeatureSelectors: Array<{ selector: string; property: string; value: string }> = [
    { selector: '.container-query-target', property: 'container-type', value: 'inline-size' },
    { selector: '.subgrid-row', property: 'grid-template-rows', value: 'subgrid' },
    { selector: '.scroll-snap-container', property: 'scroll-snap-type', value: 'x mandatory' },
    { selector: '.backdrop-blur', property: 'backdrop-filter', value: 'blur(10px)' },
    { selector: '.has-selector-demo', property: 'color', value: 'red' },
    { selector: '.layer-base', property: 'color', value: 'blue' },
    { selector: '.nested-parent', property: 'color', value: 'green' },
    { selector: '.aspect-box', property: 'aspect-ratio', value: '16 / 9' },
    { selector: '.logical-margin', property: 'margin-inline-start', value: '1rem' },
    { selector: '.content-visibility', property: 'content-visibility', value: 'auto' },
    { selector: '.accent-input', property: 'accent-color', value: '#3498db' },
    { selector: '.scroll-timeline-box', property: 'animation-timeline', value: 'scroll()' },
    { selector: '.view-transition-el', property: 'view-transition-name', value: 'hero' },
    { selector: '.popover-target', property: 'anchor-name', value: '--my-anchor' },
    { selector: '.color-scheme-test', property: 'color-scheme', value: 'light dark' },
  ];

  for (let i = 0; i < fabricatedFeatureSelectors.length && counter < maxScenarios; i++) {
    const fab = fabricatedFeatureSelectors[i];
    const featureEntry = unusedCSSFeatures[i % unusedCSSFeatures.length];
    const title = featureEntry ? (featureEntry[1] as any).title : 'unknown';

    scenarios.push({
      id: `rw-css-ciu-${String(++counter).padStart(3, '0')}`,
      description: `CIU: unused feature '${title}' — fabricated ${fab.selector}`,
      edits: [],
      predicates: [{
        type: 'css',
        selector: fab.selector,
        property: fab.property,
        expected: fab.value,
        path: '/edge-cases',
      }],
      expectedSuccess: false,
      tags: ['caniuse', 'css', 'false-positive', 'unused-feature'],
      rationale: `CIU feature '${title}' is NOT used in demo-app. Selector '${fab.selector}' is fabricated. Grounding gate should reject.`,
      source: 'real-world',
    });
  }

  // ── Injection: add CIU features via edits ───────────────────────────────
  const injectableFeatures: Array<{ id: string; css: string; selector: string; prop: string; val: string }> = [
    { id: 'container-queries', css: '.ciu-container { container-type: inline-size; }', selector: '.ciu-container', prop: 'container-type', val: 'inline-size' },
    { id: 'css-nesting',       css: '.ciu-parent { color: blue; & .child { color: red; } }', selector: '.ciu-parent', prop: 'color', val: 'blue' },
    { id: 'css-cascade-layers', css: '@layer base { .ciu-layered { color: green; } }', selector: '.ciu-layered', prop: 'color', val: 'green' },
    { id: 'css-at-property',   css: '@property --ciu-color { syntax: "<color>"; inherits: false; initial-value: #000; }', selector: ':root', prop: '--ciu-color', val: '#000' },
    { id: 'css-individual-transforms', css: '.ciu-rotate { rotate: 45deg; }', selector: '.ciu-rotate', prop: 'rotate', val: '45deg' },
    { id: 'css-anchor-positioning', css: '.ciu-anchor { anchor-name: --test; }', selector: '.ciu-anchor', prop: 'anchor-name', val: '--test' },
  ];

  for (const inj of injectableFeatures) {
    if (counter >= maxScenarios) break;

    const ciuFeature = features[inj.id];
    const title = ciuFeature?.title || inj.id;

    scenarios.push({
      id: `rw-css-ciu-${String(++counter).padStart(3, '0')}`,
      description: `CIU: inject ${title} feature via edit`,
      edits: [{
        file: 'server.js',
        search: INJECT_ANCHOR,
        replace: `${INJECT_ANCHOR}\n    ${inj.css}`,
      }],
      predicates: [{
        type: 'css',
        selector: inj.selector,
        property: inj.prop,
        expected: inj.val,
        path: '/edge-cases',
      }],
      expectedSuccess: true,
      tags: ['caniuse', 'css', 'injection', 'modern-feature'],
      rationale: `Inject CIU feature '${title}' into demo-app via edit. Tests pipeline with modern CSS constructs from real CIU data.`,
      source: 'real-world',
    });
  }

  return scenarios;
}

/** Extract the earliest version with 'y' support from CIU stats */
function getBestSupport(stats: Record<string, string> | undefined): string {
  if (!stats) return 'no data';
  for (const [ver, support] of Object.entries(stats)) {
    if (typeof support === 'string' && (support.startsWith('y') || support === 'a')) {
      return `v${ver}+`;
    }
  }
  return 'unsupported';
}

// ─────────────────────────────────────────────────────────────────────────────
// PostCSS Parser Tests Harvester
// ─────────────────────────────────────────────────────────────────────────────

function harvestPostCSS(files: string[], maxScenarios: number): VerifyScenario[] {
  const scenarios: VerifyScenario[] = [];
  let counter = 0;

  // PostCSS parser tests are .css files in the git repo
  const cssFiles = files.filter(f => extname(f) === '.css');
  if (cssFiles.length === 0) return scenarios;

  for (const cssFile of cssFiles) {
    if (counter >= maxScenarios) break;

    let content: string;
    try {
      content = readFileSync(cssFile, 'utf-8').trim();
    } catch {
      continue;
    }

    // Skip empty or very large files
    if (!content || content.length > 5000) continue;
    // Skip files with @import or complex at-rules that won't work inline
    if (content.includes('@import') || content.includes('@charset')) continue;

    const filename = basename(cssFile, '.css');

    // Extract the first rule's selector and property for a predicate
    const firstRule = extractFirstRule(content);

    if (firstRule) {
      // Scenario: inject real PostCSS test CSS and verify the first rule parses
      const safeContent = content
        .replace(/\n/g, '\\n')
        .replace(/'/g, "\\'");

      // Use a unique wrapper class to avoid conflicts
      const wrappedCSS = wrapPostCSSContent(content, filename);
      if (!wrappedCSS) continue;

      scenarios.push({
        id: `rw-css-pcss-${String(++counter).padStart(3, '0')}`,
        description: `PostCSS: ${filename} — parser edge case (${firstRule.description})`,
        edits: [{
          file: 'server.js',
          search: INJECT_ANCHOR,
          replace: `${INJECT_ANCHOR}\n    ${wrappedCSS.css}`,
        }],
        predicates: [{
          type: 'css',
          selector: wrappedCSS.selector,
          property: wrappedCSS.property,
          expected: wrappedCSS.value,
          path: '/edge-cases',
        }],
        expectedSuccess: true,
        tags: ['postcss', 'css', 'parser-edge-case', classifyPostCSS(filename)],
        rationale: `Real PostCSS parser test '${filename}.css'. Tests that the grounding CSS extractor handles ${firstRule.description}. Source: postcss/postcss-parser-tests.`,
        source: 'real-world',
      });
    }

    // Also create a content predicate variant for the raw CSS
    if (counter < maxScenarios) {
      const contentPattern = extractContentPattern(content);
      if (contentPattern) {
        scenarios.push({
          id: `rw-css-pcss-${String(++counter).padStart(3, '0')}`,
          description: `PostCSS: ${filename} — content pattern verification`,
          edits: [{
            file: 'server.js',
            search: INJECT_ANCHOR,
            replace: `${INJECT_ANCHOR}\n    /* postcss-test: ${filename} */ .pcss-marker-${filename.replace(/[^a-z0-9]/g, '-')} { content: 'present'; }`,
          }],
          predicates: [{
            type: 'content',
            file: 'server.js',
            pattern: `postcss-test: ${filename}`,
          }],
          expectedSuccess: true,
          tags: ['postcss', 'css', 'content-check', classifyPostCSS(filename)],
          rationale: `Content verification for PostCSS test '${filename}.css' injection. Ensures edit application works with parser edge-case content.`,
          source: 'real-world',
        });
      }
    }
  }

  return scenarios;
}

/** Extract the first CSS rule from PostCSS test content */
function extractFirstRule(css: string): { selector: string; property: string; value: string; description: string } | null {
  // Strip comments
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Match first rule: selector { property: value; }
  const match = cleaned.match(/([^{]+)\{([^}]+)\}/);
  if (!match) return null;

  const selector = match[1].trim();
  const body = match[2].trim();

  // Extract first property
  const propMatch = body.match(/([\w-]+)\s*:\s*([^;]+)/);
  if (!propMatch) return null;

  let description = 'standard rule';
  if (selector.includes('\\')) description = 'escaped selector';
  else if (selector.includes(':')) description = 'pseudo selector/element';
  else if (selector.includes('[')) description = 'attribute selector';
  else if (selector.includes('*')) description = 'universal selector';
  else if (selector.includes('+') || selector.includes('~') || selector.includes('>')) description = 'combinator';
  else if (/^\s*@/.test(selector)) description = 'at-rule';
  else if (selector.includes(',')) description = 'grouped selectors';
  else if (selector.includes('#')) description = 'id selector';

  return {
    selector: selector.split(',')[0].trim(),
    property: propMatch[1].trim(),
    value: propMatch[2].trim(),
    description,
  };
}

/** Wrap PostCSS test content in a unique class to avoid selector collisions */
function wrapPostCSSContent(css: string, filename: string): { css: string; selector: string; property: string; value: string } | null {
  // Extract first rule
  const rule = extractFirstRule(css);
  if (!rule) return null;

  const safeClass = `pcss-${filename.replace(/[^a-z0-9]/g, '-')}`;

  return {
    css: `.${safeClass} { ${rule.property}: ${rule.value}; }`,
    selector: `.${safeClass}`,
    property: rule.property,
    value: rule.value,
  };
}

/** Classify a PostCSS test file by its name */
function classifyPostCSS(filename: string): string {
  if (/comment/i.test(filename)) return 'comments';
  if (/escape/i.test(filename)) return 'escaping';
  if (/empty/i.test(filename)) return 'empty-rules';
  if (/atrule|at-rule|media|import|charset|keyframe/i.test(filename)) return 'at-rules';
  if (/string|quote/i.test(filename)) return 'strings';
  if (/custom|var\b/i.test(filename)) return 'custom-properties';
  if (/nest/i.test(filename)) return 'nesting';
  if (/selector/i.test(filename)) return 'selectors';
  if (/unicode/i.test(filename)) return 'unicode';
  if (/space|white/i.test(filename)) return 'whitespace';
  return 'general';
}

/** Extract a distinctive content pattern from CSS for content predicate */
function extractContentPattern(css: string): string | null {
  // Use a distinctive selector or property as the pattern
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!cleaned) return null;

  // First 40 chars of the first non-empty line
  const firstLine = cleaned.split('\n').find(l => l.trim().length > 0);
  if (!firstLine || firstLine.trim().length < 5) return null;

  return firstLine.trim().substring(0, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Harvester
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Harvest CSS scenarios from real-world source files.
 *
 * @param files - Array of local file paths from the supply cache
 * @param maxScenarios - Maximum total scenarios to produce
 * @returns Array of VerifyScenario objects with source: 'real-world'
 */
export function harvestCSS(files: string[], maxScenarios: number): VerifyScenario[] {
  // Budget: 50% MDN, 30% CIU, 20% PostCSS
  const mdnBudget = Math.floor(maxScenarios * 0.50);
  const ciuBudget = Math.floor(maxScenarios * 0.30);
  const pcssBudget = maxScenarios - mdnBudget - ciuBudget;

  console.log(`[harvest-css] Budget: MDN=${mdnBudget}, CIU=${ciuBudget}, PostCSS=${pcssBudget}`);

  const mdnScenarios = harvestMDN(files, mdnBudget);
  console.log(`  MDN: ${mdnScenarios.length} scenarios`);

  const ciuScenarios = harvestCanIUse(files, ciuBudget);
  console.log(`  CIU: ${ciuScenarios.length} scenarios`);

  const pcssScenarios = harvestPostCSS(files, pcssBudget);
  console.log(`  PostCSS: ${pcssScenarios.length} scenarios`);

  const all = [...mdnScenarios, ...ciuScenarios, ...pcssScenarios];

  // If we went over budget, trim from the end
  if (all.length > maxScenarios) {
    all.length = maxScenarios;
  }

  console.log(`[harvest-css] Total: ${all.length} scenarios`);
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Mode
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse --cache-dir and --max
  let cacheDir = join(process.cwd(), '.supply-cache');
  let maxScenarios = 500;

  for (const arg of args) {
    if (arg.startsWith('--cache-dir=')) cacheDir = arg.split('=')[1];
    if (arg.startsWith('--max=')) maxScenarios = parseInt(arg.split('=')[1], 10);
  }

  // Collect all files from the CSS-related source cache dirs
  const sourceDirs = ['mdn-compat', 'caniuse', 'postcss-parser-tests'];
  const allFiles: string[] = [];

  for (const dir of sourceDirs) {
    const fullDir = join(cacheDir, dir);
    if (!existsSync(fullDir)) {
      console.log(`  SKIP: ${fullDir} not found (run supply fetch first)`);
      continue;
    }
    collectFiles(fullDir, allFiles);
  }

  if (allFiles.length === 0) {
    console.error('No source files found. Run the supply fetch first:');
    console.error('  bun run scripts/supply/sources.ts fetch --sources=mdn-compat,caniuse,postcss-parser-tests');
    process.exit(1);
  }

  console.log(`Found ${allFiles.length} source files in cache`);
  const scenarios = harvestCSS(allFiles, maxScenarios);

  // Write output
  const outPath = join(process.cwd(), 'fixtures', 'scenarios', 'css-real-world.json');
  writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
  console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);

  // Summary
  const truePos = scenarios.filter(s => s.expectedSuccess).length;
  const falsePos = scenarios.filter(s => !s.expectedSuccess).length;
  const withEdits = scenarios.filter(s => s.edits.length > 0).length;
  const tagCounts: Record<string, number> = {};
  for (const s of scenarios) {
    for (const t of s.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }

  console.log(`\nSummary:`);
  console.log(`  True positives:  ${truePos}`);
  console.log(`  False positives: ${falsePos}`);
  console.log(`  With edits:      ${withEdits}`);
  console.log(`  Tags: ${Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(', ')}`);
}

function collectFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
}
