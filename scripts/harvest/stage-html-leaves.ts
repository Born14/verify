#!/usr/bin/env bun
/**
 * stage-html-leaves.ts — HTML Scenario Stager
 *
 * Generates HTML grounding-gate scenarios from the demo-app's server.js.
 * Same pattern as WPT CSS stager: we know the ground truth of every element,
 * so we can generate true_positive, false_positive, and false_negative scenarios.
 *
 * Scenario types:
 *   1. text_change (true_positive): Edit changes element text, predicate expects new text
 *   2. text_exists (true_positive): Predicate asserts existing text matches (no edit needed)
 *   3. wrong_text (false_positive): Predicate claims text that doesn't match
 *   4. wrong_route (false_positive): Predicate claims element on wrong route
 *   5. nonexistent_tag (false_positive): Predicate claims tag that doesn't exist
 *   6. element_injection (true_positive): Edit injects new element, predicate expects it
 *   7. text_substring (edge case): Tests includes() vs exact match behavior
 *   8. self_closing (edge case): Tests self-closing tags like <img>, <input>, <meta>
 *   9. attribute_selector (edge case): Tests selectors like meta[name="description"]
 *  10. duplicate_tag (edge case): Same tag on multiple routes, path-scoping test
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Load server.js ──────────────────────────────────────────────────────────

const SERVER_JS_PATH = resolve(__dirname, '../../fixtures/demo-app/server.js');
const SERVER_JS = readFileSync(SERVER_JS_PATH, 'utf8');

// ── Extract elements using EXACT same regex as grounding gate ───────────────

interface ExtractedElement {
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  route: string;       // which route this element belongs to
  rawMatch: string;    // the full matched string for edit search
}

const SKIP_TAGS = ['div', 'span', 'section', 'main', 'head', 'body', 'html', 'script', 'style'];

function extractElements(): ExtractedElement[] {
  const elements: ExtractedElement[] = [];

  // First, identify route boundaries in server.js
  const routePattern = /(?:url\.pathname\s*===\s*['"]([^'"]+)['"]|req\.url\s*===\s*['"]([^'"]+)['"]|app\.get\s*\(\s*['"]([^'"]+)['"])/g;
  const routes: Array<{ route: string; startIdx: number }> = [];
  let routeMatch;
  while ((routeMatch = routePattern.exec(SERVER_JS)) !== null) {
    routes.push({ route: routeMatch[1] || routeMatch[2] || routeMatch[3], startIdx: routeMatch.index });
  }

  // Extract HTML elements
  const tagPattern = /<([\w-]+)([^>]*)>([^<]*)<\/\1>/g;
  let match;
  while ((match = tagPattern.exec(SERVER_JS)) !== null) {
    const tag = match[1];
    if (SKIP_TAGS.includes(tag)) continue;

    const attrString = match[2];
    const text = match[3].trim();
    const idx = match.index;

    // Determine which route this element belongs to
    let route = '/';
    for (let i = routes.length - 1; i >= 0; i--) {
      if (idx > routes[i].startIdx) {
        route = routes[i].route;
        break;
      }
    }

    const attributes: Record<string, string> = {};
    const attrPattern = /([\w-]+)=["']([^"']+)["']/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(attrString)) !== null) {
      attributes[attrMatch[1]] = attrMatch[2];
    }

    elements.push({
      tag,
      text: text || undefined,
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      route,
      rawMatch: match[0],
    });
  }

  return elements;
}

// ── Scenario Generation ─────────────────────────────────────────────────────

interface Scenario {
  id: string;
  description: string;
  faultId: string | null;
  intent: 'false_negative' | 'false_positive';
  expectedSuccess: boolean;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<{
    type: 'html';
    selector: string;
    expected: string;
    path?: string;
  }>;
  gates: {
    staging: boolean;
    browser: boolean;
    http: boolean;
    invariants: boolean;
    vision: boolean;
  };
  requiresDocker: boolean;
  rationale: string;
  tags: string[];
  transferability: string;
  category: string;
  taxClass: string;
  taxFamily: string;
  taxType: string;
}

const GATES_OFF = { staging: false, browser: false, http: false, invariants: false, vision: false };

function makeId(prefix: string, idx: number): string {
  return `html-${prefix}-${idx}`;
}

// Check edit uniqueness
function isUnique(search: string): boolean {
  return SERVER_JS.split(search).length - 1 === 1;
}

// Generate replacement text that won't collide
const REPLACEMENT_TEXTS = [
  'Verified Content', 'Updated Label', 'Changed Text', 'New Value',
  'Test Output', 'Modified Entry', 'Replaced Data', 'Fresh Content',
  'Altered Text', 'Swapped Value',
];

function generateScenarios(elements: ExtractedElement[]): Scenario[] {
  const scenarios: Scenario[] = [];
  let idx = 0;

  // ── Type 1: text_change — edit changes text, predicate expects new text ──
  for (const el of elements) {
    if (!el.text || el.text.length < 2) continue;

    // Build a unique search string
    const search = el.rawMatch;
    if (!isUnique(search)) continue;

    const newText = REPLACEMENT_TEXTS[idx % REPLACEMENT_TEXTS.length];
    const replace = search.replace(el.text, newText);

    scenarios.push({
      id: makeId('text-change', idx),
      description: `HTML text change: <${el.tag}> "${el.text.substring(0, 30)}..." → "${newText}" on ${el.route}`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,
      edits: [{ file: 'server.js', search, replace }],
      predicates: [{ type: 'html', selector: el.tag, expected: newText, path: el.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `Edit changes <${el.tag}> text content from "${el.text.substring(0, 40)}" to "${newText}". Grounding should find the element and verify text match.`,
      tags: ['html', 'text_change', el.tag, el.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'text_content',
      taxType: el.tag,
    });
    idx++;
  }

  // ── Type 2: text_exists — assert existing text matches (no edit) ──
  let existsIdx = 0;
  for (const el of elements) {
    if (!el.text || el.text.length < 2) continue;

    scenarios.push({
      id: makeId('text-exists', existsIdx),
      description: `HTML text exists: <${el.tag}> contains "${el.text.substring(0, 40)}" on ${el.route}`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,
      edits: [],  // No edit — predicate should match existing state
      predicates: [{ type: 'html', selector: el.tag, expected: el.text, path: el.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `No edit. Predicate asserts existing <${el.tag}> text on ${el.route}. Grounding should pass because text is already present.`,
      tags: ['html', 'text_exists', el.tag, el.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'text_content',
      taxType: el.tag,
    });
    existsIdx++;
  }

  // ── Type 3: wrong_text — predicate claims wrong text ──
  let wrongIdx = 0;
  for (const el of elements) {
    if (!el.text || el.text.length < 2) continue;

    // Predicate expects text that doesn't exist
    const wrongText = 'NONEXISTENT_TEXT_' + wrongIdx;
    if (SERVER_JS.includes(wrongText)) continue;  // safety check

    scenarios.push({
      id: makeId('wrong-text', wrongIdx),
      description: `HTML wrong text: <${el.tag}> on ${el.route} claims "${wrongText}" but actual is "${el.text.substring(0, 30)}"`,
      faultId: null,
      intent: 'false_positive',
      expectedSuccess: false,
      edits: [],  // No edit — predicate is wrong
      predicates: [{ type: 'html', selector: el.tag, expected: wrongText, path: el.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `Predicate claims <${el.tag}> on ${el.route} contains "${wrongText}" but actual text is "${el.text.substring(0, 40)}". Grounding should reject.`,
      tags: ['html', 'wrong_text', 'false_positive', el.tag, el.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'text_content',
      taxType: el.tag,
    });
    wrongIdx++;
  }

  // ── Type 4: wrong_route — element exists but on different route ──
  let routeIdx = 0;
  // Group elements by tag to find cross-route opportunities
  const byTag = new Map<string, ExtractedElement[]>();
  for (const el of elements) {
    if (!el.text) continue;
    const list = byTag.get(el.tag) ?? [];
    list.push(el);
    byTag.set(el.tag, list);
  }

  for (const [tag, tagElements] of byTag) {
    const routes = [...new Set(tagElements.map(e => e.route))];
    if (routes.length < 2) continue;  // Need at least 2 routes

    for (const el of tagElements) {
      // Claim the element is on a different route
      const wrongRoute = routes.find(r => r !== el.route);
      if (!wrongRoute) continue;

      // Only create if the tag actually doesn't exist on wrongRoute
      const existsOnWrongRoute = tagElements.some(e => e.route === wrongRoute);
      if (existsOnWrongRoute) continue;  // Tag exists on both routes, not a good test

      scenarios.push({
        id: makeId('wrong-route', routeIdx),
        description: `HTML wrong route: <${tag}> "${(el.text ?? '').substring(0, 30)}" is on ${el.route} but predicate claims ${wrongRoute}`,
        faultId: null,
        intent: 'false_positive',
        expectedSuccess: false,
        edits: [],
        predicates: [{ type: 'html', selector: tag, expected: el.text ?? '', path: wrongRoute }],
        gates: GATES_OFF,
        requiresDocker: false,
        rationale: `<${tag}> with text "${(el.text ?? '').substring(0, 40)}" exists on ${el.route} but predicate claims it's on ${wrongRoute}. Grounding should detect wrong-route.`,
        tags: ['html', 'wrong_route', 'false_positive', tag],
        transferability: 'universal',
        category: 'grounding',
        taxClass: 'html_structure',
        taxFamily: 'route_scoping',
        taxType: tag,
      });
      routeIdx++;
    }
  }

  // ── Type 5: nonexistent_tag — tag doesn't exist at all ──
  const FAKE_TAGS = ['aside', 'article', 'summary', 'details', 'dialog', 'nav', 'mark', 'abbr', 'cite', 'code'];
  const existingTags = new Set(elements.map(e => e.tag));
  let fakeIdx = 0;

  for (const fakeTag of FAKE_TAGS) {
    if (existingTags.has(fakeTag)) continue;

    scenarios.push({
      id: makeId('nonexistent-tag', fakeIdx),
      description: `HTML nonexistent tag: <${fakeTag}> does not exist in app`,
      faultId: null,
      intent: 'false_positive',
      expectedSuccess: false,
      edits: [],
      predicates: [{ type: 'html', selector: fakeTag, expected: 'Some Content', path: '/' }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `<${fakeTag}> tag doesn't exist anywhere in server.js. Grounding should reject.`,
      tags: ['html', 'nonexistent_tag', 'false_positive', fakeTag],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'element_existence',
      taxType: fakeTag,
    });
    fakeIdx++;
  }

  // ── Type 6: element_injection — edit creates new element ──
  // Use .meta-test injection point on /edge-cases, same as CSS stager
  const INJECTION_POINT = '.meta-test { content: \'meta\'; }';
  if (isUnique(INJECTION_POINT)) {
    const injectTags = ['article', 'aside', 'summary', 'mark', 'cite', 'blockquote'];
    let injectIdx = 0;
    for (const tag of injectTags) {
      if (existingTags.has(tag)) continue;

      const text = `Injected ${tag} content`;
      const replace = INJECTION_POINT + `\n</style><${tag} class="injected-test">${text}</${tag}><style>`;

      scenarios.push({
        id: makeId('inject', injectIdx),
        description: `HTML injection: edit creates <${tag}> on /edge-cases`,
        faultId: null,
        intent: 'false_negative',
        expectedSuccess: true,
        edits: [{ file: 'server.js', search: INJECTION_POINT, replace }],
        predicates: [{ type: 'html', selector: tag, expected: text, path: '/edge-cases' }],
        gates: GATES_OFF,
        requiresDocker: false,
        rationale: `Edit injects new <${tag}> element via .meta-test point. Grounding should detect the edit creates the element and allow it through.`,
        tags: ['html', 'injection', tag, '/edge-cases'],
        transferability: 'universal',
        category: 'grounding',
        taxClass: 'html_structure',
        taxFamily: 'element_creation',
        taxType: tag,
      });
      injectIdx++;
    }
  }

  // ── Type 7: text_substring — tests includes() behavior ──
  let subIdx = 0;
  for (const el of elements) {
    if (!el.text || el.text.length < 10) continue;  // Need long enough text for substring

    // Test: predicate expects a SUBSTRING of actual text — should grounding pass?
    // The gate uses includes(), so substring SHOULD pass. This tests that behavior.
    const substring = el.text.substring(0, Math.floor(el.text.length / 2));
    if (substring.length < 3) continue;

    scenarios.push({
      id: makeId('substring', subIdx),
      description: `HTML substring: <${el.tag}> on ${el.route} — predicate expects "${substring.substring(0, 25)}" (substring of "${el.text.substring(0, 25)}")`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,  // includes() should match substring
      edits: [],
      predicates: [{ type: 'html', selector: el.tag, expected: substring, path: el.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `Predicate expects substring "${substring}" of actual text "${el.text.substring(0, 50)}". Grounding uses includes() so this should pass.`,
      tags: ['html', 'substring', el.tag, el.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'text_matching',
      taxType: 'substring',
    });
    subIdx++;
    if (subIdx >= 15) break;  // Cap at 15 substring tests
  }

  // ── Type 8: self_closing — tests tags the regex can't match ──
  // The grounding regex requires </tag> — self-closing tags are invisible
  // This tests whether grounding correctly handles predicates for these
  const selfClosing = [
    { selector: 'img', attr: 'alt', value: 'Demo Logo', route: '/about' },
    { selector: 'input', attr: 'placeholder', value: 'Search...', route: '/about' },
    { selector: 'input', attr: 'placeholder', value: 'Your', route: '/form' },
    { selector: 'meta', attr: 'name', value: 'description', route: '/' },
  ];
  let selfIdx = 0;
  for (const sc of selfClosing) {
    // These elements exist but grounding can't see them (self-closing regex gap)
    // So predicate for "exists" should... fail? or pass?
    // The grounding gate checks edits when element not found, so without edits
    // it should reject with "not found in app source"
    scenarios.push({
      id: makeId('self-closing', selfIdx),
      description: `HTML self-closing: <${sc.selector}> (${sc.attr}="${sc.value}") on ${sc.route} — invisible to grounding regex`,
      faultId: null,
      intent: 'false_positive',  // Grounding can't see it → rejects → correct behavior
      expectedSuccess: false,
      edits: [],
      predicates: [{ type: 'html', selector: sc.selector, expected: 'exists', path: sc.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `<${sc.selector} ${sc.attr}="${sc.value}"> is self-closing. Grounding regex requires </tag> so this element is invisible. Predicate should be rejected as "not found".`,
      tags: ['html', 'self_closing', sc.selector, sc.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'extraction_gap',
      taxType: 'self_closing',
    });
    selfIdx++;
  }

  // ── Type 9: attribute_selector — tests CSS selector stripping in grounding ──
  // The grounding gate strips CSS qualifiers (.class, [attr], :pseudo, #id) to bare tag.
  // If the bare tag exists, grounding passes. Full CSS validation deferred to browser gate.
  // #id selectors strip to empty string → grounding rejects (no bare tag).
  const attrSelectors = [
    { selector: 'a[href="/"]', tag: 'a', route: '/', bareExists: true },
    { selector: 'a.nav-link', tag: 'a', route: '/', bareExists: true },
    { selector: 'label[for="name"]', tag: 'label', route: '/form', bareExists: true },
    { selector: 'button.primary', tag: 'button', route: '/about', bareExists: true },
    { selector: 'p.subtitle', tag: 'p', route: '/', bareExists: true },
    { selector: 'option[value="general"]', tag: 'option', route: '/form', bareExists: true },
    { selector: '#contact-form', tag: 'form', route: '/form', bareExists: false },  // # strips to empty
    { selector: 'td:first-child', tag: 'td', route: '/about', bareExists: true },
  ];
  let attrIdx = 0;
  for (const as of attrSelectors) {
    // Bare tag extracted from CSS selector. If bare tag exists on route → pass.
    // #id selectors strip to empty → grounding rejects.
    scenarios.push({
      id: makeId('attr-selector', attrIdx),
      description: `HTML attr selector: "${as.selector}" on ${as.route} — bare tag "${as.tag}" ${as.bareExists ? 'exists → pass' : 'empty → reject'}`,
      faultId: null,
      intent: as.bareExists ? 'false_negative' : 'false_positive',
      expectedSuccess: as.bareExists,
      edits: [],
      predicates: [{ type: 'html', selector: as.selector, expected: 'exists', path: as.route }],
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: as.bareExists
        ? `CSS selector "${as.selector}" strips to bare tag "${as.tag}" which exists on ${as.route}. Grounding passes. Full selector validation deferred to browser gate.`
        : `CSS selector "${as.selector}" strips to empty bare tag. No tag to match → grounding rejects.`,
      tags: ['html', 'attr_selector', as.tag, as.route],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'selector_matching',
      taxType: 'attribute_selector',
    });
    attrIdx++;
  }

  // ── Type 10: duplicate_tag — same tag on multiple routes ──
  let dupIdx = 0;
  for (const [tag, tagElements] of byTag) {
    const routeGroups = new Map<string, ExtractedElement[]>();
    for (const el of tagElements) {
      const list = routeGroups.get(el.route) ?? [];
      list.push(el);
      routeGroups.set(el.route, list);
    }
    if (routeGroups.size < 2) continue;

    // Test: predicate for this tag WITHOUT path — should search all routes
    const firstEl = tagElements[0];
    if (!firstEl.text) continue;

    scenarios.push({
      id: makeId('no-path', dupIdx),
      description: `HTML no path: <${tag}> exists on ${routeGroups.size} routes — predicate omits path, should search all`,
      faultId: null,
      intent: 'false_negative',
      expectedSuccess: true,
      edits: [],
      predicates: [{ type: 'html', selector: tag, expected: firstEl.text }],  // No path!
      gates: GATES_OFF,
      requiresDocker: false,
      rationale: `<${tag}> exists on routes: ${[...routeGroups.keys()].join(', ')}. Predicate omits path, so grounding should search all routes and find it.`,
      tags: ['html', 'no_path', 'multi_route', tag],
      transferability: 'universal',
      category: 'grounding',
      taxClass: 'html_structure',
      taxFamily: 'route_scoping',
      taxType: 'unscoped',
    });
    dupIdx++;
  }

  return scenarios;
}

// ── Main ────────────────────────────────────────────────────────────────────

const elements = extractElements();
console.log(`Extracted ${elements.length} elements from server.js`);
console.log(`Tags: ${[...new Set(elements.map(e => e.tag))].join(', ')}`);
console.log(`Routes: ${[...new Set(elements.map(e => e.route))].join(', ')}`);

const scenarios = generateScenarios(elements);

// Dedup by predicate fingerprint
const seen = new Set<string>();
const deduped = scenarios.filter(s => {
  const fp = JSON.stringify(s.predicates) + '|' + JSON.stringify(s.edits);
  if (seen.has(fp)) return false;
  seen.add(fp);
  return true;
});

console.log(`\nGenerated ${scenarios.length} scenarios (${scenarios.length - deduped.length} dupes removed)`);
console.log(`Final: ${deduped.length} scenarios`);

// Breakdown
const byType: Record<string, number> = {};
deduped.forEach(s => {
  const type = s.tags[1] || 'unknown';
  byType[type] = (byType[type] || 0) + 1;
});
console.log('\nBreakdown:');
Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`  ${type}: ${count}`);
});

// Intent breakdown
const intents: Record<string, number> = {};
deduped.forEach(s => { intents[s.intent] = (intents[s.intent] || 0) + 1; });
console.log('\nIntents:', intents);

// Write
const outPath = resolve(__dirname, '../../fixtures/scenarios/html-staged.json');
writeFileSync(outPath, JSON.stringify(deduped, null, 2));
console.log(`\nWritten to ${outPath}`);
