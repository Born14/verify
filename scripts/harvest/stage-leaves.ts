#!/usr/bin/env bun
/**
 * WPT Leaf → Verify Scenario Stager
 * ===================================
 *
 * Converts harvested WPT leaves into SerializedScenario objects that
 * verify's self-test harness can execute against the demo app.
 *
 * Architecture:
 * - Each WPT leaf describes a CSS/HTML/URL/HTTP spec assertion
 * - The stager generates a minimal edit + predicate pair for the demo app
 * - CSS leaves: inject the CSS into server.js, edit breaks it, predicate catches it
 * - URL leaves: create content predicates against URL parsing results
 * - HTTP leaves: create HTTP predicates against demo app endpoints
 * - DOM leaves: create HTML predicates against demo app elements
 *
 * Usage:
 *   bun run scripts/harvest/stage-leaves.ts --harvest=fixtures/wpt-harvest.json --out=fixtures/scenarios/wpt-staged.json
 *   bun run scripts/harvest/stage-leaves.ts --harvest=fixtures/wpt-harvest.json --stats
 *   bun run scripts/harvest/stage-leaves.ts --harvest=fixtures/wpt-harvest.json --domain=css --limit=100
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// =============================================================================
// Types (compatible with wpt-converter HarvestedLeaf)
// =============================================================================

interface HarvestedLeaf {
  id: string;
  source: string;
  taxClass: string;
  taxFamily: string;
  taxType: string;
  wptFile: string;
  assertion: {
    fn: string;
    property: string;
    inputValue: string;
    expectedValue?: string;
  };
  predicate: {
    type: 'css' | 'http' | 'html' | 'content';
    selector?: string;
    property?: string;
    expected?: string;
    path?: string;
    method?: string;
    expect?: { status?: number; bodyContains?: string; contentType?: string };
    pattern?: string;
    file?: string;
    description?: string;
  };
  edit: {
    file: string;
    search: string;
    replace: string;
  };
  expectedVerdict: string;
}

interface StagedScenario {
  id: string;
  description: string;
  faultId: string | null;
  intent: 'false_positive' | 'false_negative';
  expectedSuccess: boolean;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, unknown>>;
  gates?: Record<string, boolean>;
  requiresDocker: boolean;
  expectedFailedGate?: string;
  rationale: string;
  tags: string[];
  transferability: 'universal' | 'framework' | 'app_specific';
  category: string;
  // WPT provenance
  wptLeafId: string;
  wptFile: string;
  taxClass: string;
  taxFamily: string;
  taxType: string;
}

// =============================================================================
// Demo App CSS Surface — what selectors/properties exist in server.js
// =============================================================================

// Pre-load server.js for edit uniqueness checking
const SERVER_JS_PATH = resolve(__dirname, '../../fixtures/demo-app/server.js');
const SERVER_JS = existsSync(SERVER_JS_PATH) ? readFileSync(SERVER_JS_PATH, 'utf8') : '';

// Extracted from fixtures/demo-app/server.js — all CSS selectors and their properties
const DEMO_CSS_SURFACE: Record<string, Record<string, string>> = {
  // Homepage (/)
  'body': { 'font-family': 'sans-serif', 'margin': '2rem', 'background': '#ffffff', 'color': '#333' },
  'h1': { 'color': '#1a1a2e', 'font-size': '2rem' },
  '.subtitle': { 'color': '#666', 'font-size': '1rem' },
  'a.nav-link': { 'color': '#0066cc', 'text-decoration': 'none', 'margin-right': '1rem' },
  '.items': { 'list-style': 'none', 'padding': '0' },
  '.items li': { 'padding': '0.5rem 0', 'border-bottom': '1px solid #eee' },
  'footer': { 'margin-top': '2rem', 'color': '#999', 'font-size': '0.8rem' },

  // About page (/about)
  '.hero': { 'background': '#3498db', 'color': 'white', 'padding': '2rem', 'border-radius': '8px' },
  '.hero .hero-title': { 'color': 'white', 'font-size': '2.5rem' },
  '.card': { 'background': 'white', 'padding': '1.5rem', 'margin': '1rem 0', 'border-radius': '4px' },
  '.card .card-title': { 'font-weight': 'bold', 'font-size': '1.2rem' },
  '.badge': { 'display': 'inline-block', 'background': '#e74c3c', 'color': 'white', 'padding': '0.25rem 0.75rem', 'border-radius': '12px', 'font-size': '0.8rem' },
  '.team-list': { 'list-style': 'decimal', 'padding-left': '2rem' },
  '.team-list li': { 'padding': '0.3rem 0' },
  '.team-list li span.role': { 'color': '#7f8c8d', 'font-style': 'italic' },

  // Edge cases (/edge-cases)
  '.edge-hero': { 'color': '#2c3e50', 'font-size': '1.5rem', 'font-weight': 'bold' },
  '.edge-hero .edge-title': { 'color': '#e74c3c', 'text-transform': 'uppercase' },
  '.edge-card': { 'background': '#ecf0f1', 'padding': '1rem', 'margin': '0.5rem 0', 'border-radius': '4px' },
  '.edge-card .edge-label': { 'font-weight': '600', 'color': '#34495e' },
  '.duplicate-prop': { 'color': 'blue' }, // last value wins
  '.shorthand-test': { 'margin': '10px', 'border': '1px solid #ccc', 'padding': '5px 10px 15px 20px' },
  '.flex-container': { 'display': 'flex', 'flex': '1 0 auto', 'gap': '10px' },
  '.flex-item': { 'flex': '2 1 100px' },
  '.grid-container': { 'display': 'grid', 'grid-template': '1fr 2fr / auto auto', 'gap': '8px 16px' },
  '.overflow-box': { 'overflow': 'hidden', 'width': '200px', 'height': '100px' },
  '.text-deco': { 'text-decoration': 'underline wavy red' },
  '.minified': { 'color': '#ff6600', 'font-size': '14px' },
  '.min-link': { 'text-decoration': 'none', 'color': '#3498db', 'font-weight': 'bold' },
  '.animated': { 'animation': 'pulse 2s infinite', 'color': '#9b59b6' },
  '.clamp-width': { 'width': 'clamp(200px, 50%, 800px)' },
};

// Selectors grouped by route
const ROUTE_SELECTORS: Record<string, string[]> = {
  '/': ['body', 'h1', '.subtitle', 'a.nav-link', '.items', '.items li', 'footer'],
  '/about': ['body', 'h2', '.hero', '.hero .hero-title', '.card', '.card .card-title', '.badge',
             'a.nav-link', '.team-list', '.team-list li', '.team-list li span.role', 'footer',
             '.hidden', '#details', 'img.logo', 'input.search', 'button.primary',
             'table.data-table', 'table.data-table th', 'table.data-table td'],
  '/edge-cases': ['body', '.edge-hero', '.edge-hero .edge-title', '.edge-card', '.edge-card .edge-label',
                   '.duplicate-prop', '.shorthand-test', '.flex-container', '.flex-item',
                   '.grid-container', '.overflow-box', '.text-deco', '.minified', '.min-link',
                   '.animated', '.clamp-width', '.color-mix-test'],
};

// =============================================================================
// CSS Staging — map WPT CSS leaves to demo app scenarios
// =============================================================================

/**
 * CSS staging strategy:
 *
 * For each WPT leaf asserting test_computed_value(selector, property, input, expected):
 *   1. Find a matching selector+property in the demo app CSS surface
 *   2. Create an edit that sets the CSS property to the WPT input value
 *   3. Create a predicate expecting the WPT expected (computed) value
 *   4. The scenario tests: "if an agent sets property to X, does verify correctly
 *      detect that computed value should be Y?"
 *
 * For test_valid_value(property, value):
 *   1. Find a selector in the demo app that has this property
 *   2. Edit sets it to the WPT value
 *   3. Predicate expects the value to be valid (syntax gate should pass)
 *
 * If no matching selector/property exists in the demo app, we INJECT it into
 * the edge-cases route — that page is designed for test coverage.
 */

// CSS properties that exist across multiple demo app selectors
const PROPERTY_TO_SELECTORS: Record<string, Array<{ selector: string; value: string; route: string }>> = {};

// Build reverse index
for (const [route, selectors] of Object.entries(ROUTE_SELECTORS)) {
  for (const sel of selectors) {
    const props = DEMO_CSS_SURFACE[sel];
    if (!props) continue;
    for (const [prop, val] of Object.entries(props)) {
      if (!PROPERTY_TO_SELECTORS[prop]) PROPERTY_TO_SELECTORS[prop] = [];
      PROPERTY_TO_SELECTORS[prop].push({ selector: sel, value: val, route });
    }
  }
}

function stageCSS(leaf: HarvestedLeaf, index: number): StagedScenario | null {
  const { assertion, predicate } = leaf;
  const cssProp = assertion.property;
  const inputValue = assertion.inputValue;
  const computedValue = assertion.expectedValue || predicate.expected || inputValue;

  if (!cssProp || !inputValue) return null;

  // Grounding checks source code, not computed values.
  // When input ≠ computed (e.g. calc(10px + 0.5em) → 30px), the predicate must
  // use the INPUT value because that's what appears in the source after edit.
  // Computed value verification requires the browser gate (not available in pure tier).
  const expectedValue = inputValue;

  // Strategy 1: find an existing selector with this property
  const matches = PROPERTY_TO_SELECTORS[cssProp];
  if (matches && matches.length > 0) {
    const match = matches[0];
    const propNeedle = `${cssProp}: ${match.value}`;

    // Try plain property: value first
    let search = propNeedle;
    let replace = `${cssProp}: ${inputValue}`;
    let count = SERVER_JS.split(search).length - 1;

    if (count !== 1) {
      // Use selector-prefix strategy: "selector { ...preceding props... property: value"
      const selectorIdx = SERVER_JS.indexOf(match.selector + ' {');
      if (selectorIdx !== -1) {
        const propIdx = SERVER_JS.indexOf(propNeedle, selectorIdx);
        if (propIdx !== -1 && propIdx - selectorIdx < 300) {
          const fullSearch = SERVER_JS.slice(selectorIdx, propIdx + propNeedle.length);
          const fullReplace = SERVER_JS.slice(selectorIdx, propIdx) + `${cssProp}: ${inputValue}`;
          const fullCount = SERVER_JS.split(fullSearch).length - 1;
          if (fullCount === 1) {
            search = fullSearch;
            replace = fullReplace;
            count = 1;
          }
        }
      }
    }

    // Only use Strategy 1 if search is unique — otherwise fall through to injection
    if (count === 1) {
      return {
        id: `wpt-s-${leaf.id}`,
        description: `WPT ${leaf.taxFamily}: ${cssProp} = ${inputValue} → ${expectedValue}`,
        faultId: null,
        intent: 'false_negative',
        expectedSuccess: true,
        edits: [{ file: 'server.js', search, replace }],
        predicates: [{
          type: 'css',
          selector: match.selector,
          property: cssProp,
          expected: expectedValue,
          path: match.route,
        }],
        gates: { staging: false, browser: false, http: false, invariants: false, vision: false },
        requiresDocker: false,
        expectedFailedGate: undefined,
        rationale: `WPT spec: ${assertion.fn}("${cssProp}", "${inputValue}", "${expectedValue}") from ${leaf.wptFile}`,
        tags: ['wpt', 'css', leaf.taxFamily, cssProp],
        transferability: 'universal',
        category: 'grounding',
        wptLeafId: leaf.id,
        wptFile: leaf.wptFile,
        taxClass: leaf.taxClass,
        taxFamily: leaf.taxFamily,
        taxType: leaf.taxType,
      };
    }
  }

  // Strategy 2: inject into edge-cases page via .meta-test selector
  // The edge-cases page has `.meta-test { content: 'meta'; }` as an injection point
  const search = `.meta-test { content: 'meta'; }`;
  const replace = `.meta-test { content: 'meta'; ${cssProp}: ${inputValue}; }`;

  return {
    id: `wpt-s-${leaf.id}`,
    description: `WPT ${leaf.taxFamily}: injected ${cssProp} = ${inputValue} → ${expectedValue}`,
    faultId: null,
    intent: 'false_negative',
    expectedSuccess: true,
    edits: [{ file: 'server.js', search, replace }],
    predicates: [{
      type: 'css',
      selector: '.meta-test',
      property: cssProp,
      expected: expectedValue,
      path: '/edge-cases',
    }],
    gates: { staging: false, browser: false, http: false, invariants: false, vision: false },
    requiresDocker: false,
    expectedFailedGate: undefined,
    rationale: `WPT spec: ${assertion.fn}("${cssProp}", "${inputValue}", "${expectedValue}") from ${leaf.wptFile}. Injected via .meta-test.`,
    tags: ['wpt', 'css', 'injected', leaf.taxFamily, cssProp],
    transferability: 'universal',
    category: 'grounding',
    wptLeafId: leaf.id,
    wptFile: leaf.wptFile,
    taxClass: leaf.taxClass,
    taxFamily: leaf.taxFamily,
    taxType: leaf.taxType,
  };
}

// =============================================================================
// HTTP Staging — map WPT HTTP leaves to demo app scenarios
// =============================================================================

function stageHTTP(leaf: HarvestedLeaf): StagedScenario | null {
  const { assertion, predicate } = leaf;

  // HTTP status assertions → test against demo app /health endpoint
  if (assertion.fn === 'http_status') {
    const status = parseInt(assertion.expectedValue || '200');
    if (isNaN(status)) return null;

    // Only stage status codes that the demo app actually returns
    // The demo app returns: 200 (/, /about, /health, /api/items), 404 (everything else)
    const validStatuses: Record<number, string> = { 200: '/health', 404: '/nonexistent' };
    const path = validStatuses[status];
    if (!path) return null;

    return {
      id: `wpt-s-${leaf.id}`,
      description: `WPT HTTP: ${path} returns status ${status}`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,
      edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ok' }" }], // no-op edit
      predicates: [{
        type: 'http',
        path,
        method: 'GET',
        expect: { status },
      }],
      gates: { grounding: false, staging: false, browser: false, invariants: false, vision: false },
      requiresDocker: true,
      rationale: `WPT spec: assert_equals(response.status, ${status}) from ${leaf.wptFile}`,
      tags: ['wpt', 'http', 'status-code', `${status}`],
      transferability: 'universal',
      category: 'evidence',
      wptLeafId: leaf.id,
      wptFile: leaf.wptFile,
      taxClass: leaf.taxClass,
      taxFamily: leaf.taxFamily,
      taxType: leaf.taxType,
    };
  }

  // HTTP header assertions → test content-type headers
  if (assertion.fn === 'http_header') {
    const headerName = assertion.property?.toLowerCase();
    const headerValue = assertion.expectedValue;
    if (!headerName || !headerValue) return null;

    // Map to demo app routes that return known headers
    if (headerName === 'content-type') {
      // Demo app: /health returns application/json, / returns text/html
      const routes: Record<string, string> = {
        'application/json': '/health',
        'text/html': '/',
      };
      // Find a route matching this content-type
      for (const [ct, route] of Object.entries(routes)) {
        if (headerValue.includes(ct) || ct.includes(headerValue)) {
          return {
            id: `wpt-s-${leaf.id}`,
            description: `WPT HTTP: ${route} Content-Type contains "${headerValue}"`,
            faultId: null,
            intent: 'false_negative',
            expectedSuccess: true,
            edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ok' }" }],
            predicates: [{
              type: 'http',
              path: route,
              method: 'GET',
              expect: { contentType: ct },
            }],
            gates: { grounding: false, staging: false, browser: false, invariants: false, vision: false },
            requiresDocker: true,
            rationale: `WPT spec: assert_equals(response.headers.get("${headerName}"), "${headerValue}") from ${leaf.wptFile}`,
            tags: ['wpt', 'http', 'header', headerName],
            transferability: 'universal',
            category: 'evidence',
            wptLeafId: leaf.id,
            wptFile: leaf.wptFile,
            taxClass: leaf.taxClass,
            taxFamily: leaf.taxFamily,
            taxType: leaf.taxType,
          };
        }
      }
    }
  }

  return null;
}

// =============================================================================
// URL Staging — URL parsing leaves become content predicates
// =============================================================================

function stageURL(leaf: HarvestedLeaf): StagedScenario | null {
  const { assertion } = leaf;
  const urlProperty = assertion.property;
  const inputUrl = assertion.inputValue;
  const expectedValue = assertion.expectedValue;

  if (!urlProperty || !inputUrl || !expectedValue) return null;

  // URL parsing tests don't need the demo app — they test spec behavior.
  // Stage them as content predicates checking that server.js contains the URL component.
  // Strategy: inject a comment with the URL and expect the component to be findable.
  //
  // But content predicates check file content, not runtime URL parsing.
  // These are better as reference data for a URL parsing gate.
  // For now, stage a subset as false_negative tests that check grounding rejects
  // content predicates with patterns that don't exist in the file.

  // Only stage URL tests where the expected value is a simple non-empty string
  if (expectedValue.length < 2 || expectedValue.length > 100) return null;
  // Skip relative URLs and data URLs (too complex)
  if (inputUrl.startsWith('data:') || inputUrl.length > 200) return null;
  // Skip if the expected value actually exists in server.js — false_positive requires
  // the pattern to NOT exist so grounding correctly rejects it
  if (SERVER_JS.includes(expectedValue)) return null;

  return {
    id: `wpt-s-${leaf.id}`,
    description: `WPT URL: new URL("${inputUrl.slice(0, 50)}").${urlProperty} == "${expectedValue.slice(0, 40)}"`,
    faultId: null,
    intent: 'false_positive',
    expectedSuccess: false,
    edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ok' }" }],
    predicates: [{
      type: 'content',
      file: 'server.js',
      pattern: expectedValue,
      description: `URL("${inputUrl.slice(0, 40)}").${urlProperty} should be "${expectedValue}"`,
    }],
    gates: { staging: false, browser: false, http: false, invariants: false, vision: false },
    requiresDocker: false,
    expectedFailedGate: 'grounding',
    rationale: `WPT spec: URL("${inputUrl}").${urlProperty} == "${expectedValue}". Grounding should reject: this URL component doesn't exist in server.js. From ${leaf.wptFile}.`,
    tags: ['wpt', 'url', urlProperty, 'false-positive'],
    transferability: 'universal',
    category: 'grounding',
    wptLeafId: leaf.id,
    wptFile: leaf.wptFile,
    taxClass: leaf.taxClass,
    taxFamily: leaf.taxFamily,
    taxType: leaf.taxType,
  };
}

// =============================================================================
// DOM Staging — HTML/DOM leaves become html predicates
// =============================================================================

function stageDOM(leaf: HarvestedLeaf): StagedScenario | null {
  const { assertion, predicate } = leaf;
  const subject = assertion.fn;  // 'dom_tagName', 'dom_attribute', 'dom_content'
  const expectedValue = assertion.expectedValue;

  if (!expectedValue) return null;

  // Map DOM assertions to demo app elements
  if (subject === 'dom_tagName' || subject === 'assert_equals') {
    const tag = expectedValue.toLowerCase();
    // Check if this tag exists in the demo app
    const demoTags = ['html', 'head', 'body', 'h1', 'h2', 'p', 'nav', 'a', 'ul', 'li',
                      'footer', 'div', 'span', 'form', 'input', 'button', 'select', 'option',
                      'textarea', 'fieldset', 'legend', 'label', 'table', 'thead', 'tbody',
                      'tr', 'th', 'td', 'ol', 'img', 'strong', 'style', 'title', 'meta', 'script'];
    if (!demoTags.includes(tag)) return null;

    return {
      id: `wpt-s-${leaf.id}`,
      description: `WPT DOM: element.tagName == "${expectedValue}"`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,
      edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ok' }" }],
      predicates: [{
        type: 'html',
        selector: tag,
        expected: 'exists',
        path: '/',
      }],
      gates: { staging: false, browser: false, http: false, invariants: false, vision: false },
      requiresDocker: false,
      rationale: `WPT spec: assert_equals(element.tagName, "${expectedValue}") from ${leaf.wptFile}`,
      tags: ['wpt', 'dom', 'tagname', tag],
      transferability: 'universal',
      category: 'grounding',
      wptLeafId: leaf.id,
      wptFile: leaf.wptFile,
      taxClass: leaf.taxClass,
      taxFamily: leaf.taxFamily,
      taxType: leaf.taxType,
    };
  }

  if (subject === 'dom_attribute') {
    const attrName = assertion.property;
    if (!attrName) return null;

    // Test that grounding can find elements with known attributes
    // Demo app has: class, href, id, type, name, placeholder, for, action, method, src, alt, etc.
    const knownAttrs = ['class', 'href', 'id', 'type', 'name', 'placeholder', 'for',
                         'action', 'method', 'src', 'alt', 'rows', 'value', 'required',
                         'content', 'property', 'charset'];
    if (!knownAttrs.includes(attrName)) return null;

    return {
      id: `wpt-s-${leaf.id}`,
      description: `WPT DOM: getAttribute("${attrName}") == "${expectedValue.slice(0, 30)}"`,
      faultId: null,
      intent: 'false_positive',
      expectedSuccess: false,
      edits: [{ file: 'server.js', search: "{ status: 'ok' }", replace: "{ status: 'ok' }" }],
      predicates: [{
        type: 'html',
        selector: `[${attrName}="${expectedValue}"]`,
        expected: 'exists',
        path: '/',
      }],
      gates: { staging: false, browser: false, http: false, invariants: false, vision: false },
      requiresDocker: false,
      expectedFailedGate: 'grounding',
      rationale: `WPT spec: assert_equals(el.getAttribute("${attrName}"), "${expectedValue}"). Grounding checks whether this attribute value exists in the demo app. From ${leaf.wptFile}.`,
      tags: ['wpt', 'dom', 'attribute', attrName],
      transferability: 'universal',
      category: 'grounding',
      wptLeafId: leaf.id,
      wptFile: leaf.wptFile,
      taxClass: leaf.taxClass,
      taxFamily: leaf.taxFamily,
      taxType: leaf.taxType,
    };
  }

  return null;
}

// =============================================================================
// Main staging pipeline
// =============================================================================

function stageLeaf(leaf: HarvestedLeaf, index: number): StagedScenario | null {
  const domain = leaf.taxClass;

  switch (domain) {
    case 'css_value_resolution':
      return stageCSS(leaf, index);
    case 'http_semantics':
      return stageHTTP(leaf);
    case 'url_parsing':
      return stageURL(leaf);
    case 'html_structure':
      return stageDOM(leaf);
    default:
      return null;
  }
}

// Dedup staged scenarios by edit+predicate fingerprint
function dedup(scenarios: StagedScenario[]): StagedScenario[] {
  const seen = new Set<string>();
  const result: StagedScenario[] = [];

  for (const s of scenarios) {
    // Fingerprint: edit search+replace + predicate type+selector+property+expected
    const pred = s.predicates[0] || {};
    const edit = s.edits[0] || {};
    const fp = [
      edit.search, edit.replace,
      pred.type, pred.selector, pred.property, pred.expected, pred.pattern,
    ].join('|');

    if (seen.has(fp)) continue;
    seen.add(fp);
    result.push(s);
  }

  return result;
}

// =============================================================================
// CLI
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  const getFlag = (name: string): string | undefined => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg?.split('=')[1];
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  const harvestPath = getFlag('harvest') || 'fixtures/wpt-harvest.json';
  const outPath = getFlag('out');
  const statsOnly = hasFlag('stats');
  const domainFilter = getFlag('domain');
  const limitStr = getFlag('limit');
  const limit = limitStr ? parseInt(limitStr) : undefined;

  // Load harvest
  const absHarvest = resolve(harvestPath);
  if (!existsSync(absHarvest)) {
    console.error(`Harvest file not found: ${absHarvest}`);
    process.exit(1);
  }

  const raw = readFileSync(absHarvest, 'utf-8');
  let leaves: HarvestedLeaf[] = JSON.parse(raw);

  // Filter by domain
  if (domainFilter) {
    const domainMap: Record<string, string> = {
      css: 'css_value_resolution',
      http: 'http_semantics',
      url: 'url_parsing',
      html: 'html_structure',
    };
    const taxClass = domainMap[domainFilter];
    if (taxClass) {
      leaves = leaves.filter(l => l.taxClass === taxClass);
    }
  }

  // Apply limit
  if (limit && limit > 0) {
    leaves = leaves.slice(0, limit);
  }

  console.log('═══════════════════════════════════════════');
  console.log(' @sovereign-labs/verify — WPT Leaf Stager');
  console.log(`  Harvest: ${harvestPath} (${leaves.length} leaves)`);
  if (outPath) console.log(`  Output: ${outPath}`);
  console.log('═══════════════════════════════════════════');

  // Stage leaves
  const staged: StagedScenario[] = [];
  const skipped: Record<string, number> = {};
  let processed = 0;

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const scenario = stageLeaf(leaf, i);
    processed++;

    if (scenario) {
      staged.push(scenario);
    } else {
      const reason = leaf.taxClass;
      skipped[reason] = (skipped[reason] || 0) + 1;
    }

    // Progress
    if (processed % 1000 === 0) {
      process.stderr.write(`  [stage] ${processed}/${leaves.length} processed, ${staged.length} staged\n`);
    }
  }

  // Dedup
  const beforeDedup = staged.length;
  const final = dedup(staged);
  const dedupSavings = beforeDedup - final.length;

  // Stats
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(' Staging Statistics');
  console.log('════════════════════════════════════════════');
  console.log(`  Input leaves:       ${leaves.length}`);
  console.log(`  Staged:             ${beforeDedup}`);
  console.log(`  After dedup:        ${final.length}`);
  console.log(`  Dedup savings:      ${dedupSavings}`);
  console.log(`  Skipped:            ${leaves.length - beforeDedup}`);

  // By domain
  const byDomain: Record<string, number> = {};
  for (const s of final) {
    byDomain[s.taxClass] = (byDomain[s.taxClass] || 0) + 1;
  }
  console.log('\n  By domain:');
  for (const [domain, count] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${domain.padEnd(30)} ${count}`);
  }

  // By intent
  const byIntent: Record<string, number> = {};
  for (const s of final) {
    byIntent[s.intent] = (byIntent[s.intent] || 0) + 1;
  }
  console.log('\n  By intent:');
  for (const [intent, count] of Object.entries(byIntent)) {
    console.log(`    ${intent.padEnd(30)} ${count}`);
  }

  // By staging strategy
  const byStrategy: Record<string, number> = {};
  for (const s of final) {
    const isInjected = s.tags.includes('injected');
    const strategy = isInjected ? 'injected (meta-test)' : 'existing selector';
    byStrategy[strategy] = (byStrategy[strategy] || 0) + 1;
  }
  console.log('\n  CSS strategy:');
  for (const [strategy, count] of Object.entries(byStrategy).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${strategy.padEnd(30)} ${count}`);
  }

  // By taxonomy family (top 15)
  const byFamily: Record<string, number> = {};
  for (const s of final) {
    byFamily[s.taxFamily] = (byFamily[s.taxFamily] || 0) + 1;
  }
  console.log('\n  By taxonomy family (top 15):');
  const families = Object.entries(byFamily).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [family, count] of families) {
    console.log(`    ${family.padEnd(30)} ${count}`);
  }

  // Skipped reasons
  if (Object.keys(skipped).length > 0) {
    console.log('\n  Skipped by domain:');
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${reason.padEnd(30)} ${count}`);
    }
  }

  console.log('════════════════════════════════════════════\n');

  // Write output
  if (outPath && !statsOnly) {
    writeFileSync(outPath, JSON.stringify(final, null, 2) + '\n');
    const sizeMB = (Buffer.byteLength(JSON.stringify(final, null, 2)) / 1024 / 1024).toFixed(1);
    console.log(`Wrote ${final.length} scenarios to ${outPath} (${sizeMB}MB)`);
  } else if (statsOnly) {
    console.log('Stats-only mode. No output file written.');
  } else if (!outPath) {
    console.log('No --out specified. Use --out=path.json to write scenarios.');
  }
}

main();
