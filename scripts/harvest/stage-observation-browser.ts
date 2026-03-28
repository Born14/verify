#!/usr/bin/env bun
/**
 * Observation × Browser scenario generator
 * Grid cell: F×3
 * Shapes: FB-01 (getComputedStyle / layout read forces reflow),
 *         FB-02 (screenshot capture triggers repaint / lazy-load),
 *         FB-03 (DOM measurement via offset/scroll triggers layout thrash)
 *
 * Observation rule: every scenario must show how RENDERING or LAYOUT CHECKS
 * CHANGE the visual state being checked. Measuring the DOM alters the DOM.
 *
 * Key distinction from State × Browser:
 * - State: browser renders stale cached HTML — belief about identity is wrong
 * - Observation: browser renders correct HTML but the render-check itself
 *   causes reflow, lazy-load, or repaint side effects
 *
 * All pure-tier (no Docker/Playwright needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-observation-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/observation-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `fb-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');

// =============================================================================
// Shape FB-01: getComputedStyle / layout reads force reflow
// Agent's verification code calls getComputedStyle or reads layout properties.
// These browser APIs force a synchronous reflow — the measurement causes
// layout recalculation that may change element positions/sizes.
// =============================================================================

// FB-01a: getComputedStyle triggers reflow — inline style + getComputedStyle in server code
scenarios.push({
  id: nextId('reflow'),
  description: 'FB-01: Server.js has getComputedStyle call that forces synchronous reflow during verification',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>window._verifyColor = getComputedStyle(document.body).backgroundColor;</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'getComputedStyle' },
    { type: 'content', file: 'server.js', pattern: 'reflow-safe' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'reflow', 'FB-01'],
  rationale: 'Assumed: getComputedStyle is a pure read. Actual: forces synchronous layout reflow. No "reflow-safe" marker in server.js.',
});

// FB-01b: getBoundingClientRect forces layout recalculation
scenarios.push({
  id: nextId('reflow'),
  description: 'FB-01: getBoundingClientRect inserted — reading element bounds forces layout recalculation',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>document.querySelector(".hero").getBoundingClientRect();</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'getBoundingClientRect' },
    { type: 'content', file: 'config.json', pattern: 'getBoundingClientRect' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'reflow', 'FB-01'],
  rationale: 'Assumed: reading element bounds is side-effect-free. Actual: forces layout recalculation. config.json has no reference to this API.',
});

// FB-01c: offsetHeight read forces layout — classic forced reflow pattern
scenarios.push({
  id: nextId('reflow'),
  description: 'FB-01: offsetHeight read on body forces layout — classic forced reflow during verification',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>var _h = document.body.offsetHeight; /* force layout */</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'offsetHeight' },
    { type: 'content', file: 'server.js', pattern: 'layout-observed' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'reflow', 'FB-01'],
  rationale: 'Assumed: reading offsetHeight is inert. Actual: triggers synchronous layout. No "layout-observed" comment in server.js.',
});

// FB-01d: scrollTop read on overflow container forces scroll layout
scenarios.push({
  id: nextId('reflow'),
  description: 'FB-01: scrollTop read on overflow container forces scroll layout recalculation',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll" id="scroller">Scroll content</div>\n      <script>var _s = document.getElementById("scroller").scrollTop;</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'scrollTop' },
    { type: 'content', file: 'config.json', pattern: 'scroll' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'reflow', 'FB-01'],
  rationale: 'Assumed: reading scrollTop is a pure getter. Actual: forces scroll layout computation on overflow container. config.json has no scroll config.',
});

// FB-01e: Control — server.js has CSS body background, check server.js for it (no reflow)
scenarios.push({
  id: nextId('reflow'),
  description: 'FB-01 control: server.js has body background-color in CSS, predicate checks server.js',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'background' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'browser', 'reflow', 'FB-01', 'control'],
  rationale: 'Static file check — reading CSS text in server.js does not trigger any browser reflow.',
});

// =============================================================================
// Shape FB-02: Screenshot capture triggers repaint / lazy-load
// Taking a screenshot for visual verification forces a full repaint.
// Elements with lazy loading, IntersectionObserver, or deferred rendering
// materialize during screenshot — the observation changes what's visible.
// =============================================================================

// FB-02a: Screenshot triggers lazy-load of images via IntersectionObserver
scenarios.push({
  id: nextId('screenshot'),
  description: 'FB-02: IntersectionObserver lazy-load — screenshot forces all images to load, changing visible state',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <img data-src="/logo.png" class="lazy" />\n      <script>new IntersectionObserver((e)=>e.forEach(i=>i.target.src=i.target.dataset.src)).observe(document.querySelector(".lazy"));</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'IntersectionObserver' },
    { type: 'content', file: 'server.js', pattern: 'loading="eager"' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'screenshot_sideeffect', 'FB-02'],
  rationale: 'Assumed: screenshot observes current state. Actual: viewport expansion during screenshot triggers IntersectionObserver, loading lazy images. No eager loading in server.js.',
});

// FB-02b: MutationObserver reacts to screenshot-triggered DOM changes
scenarios.push({
  id: nextId('screenshot'),
  description: 'FB-02: MutationObserver fires during screenshot render — observation triggers DOM mutation callbacks',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>new MutationObserver(()=>document.title+=" [observed]").observe(document.body, {childList:true, subtree:true});</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'MutationObserver' },
    { type: 'content', file: 'config.json', pattern: 'MutationObserver' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'screenshot_sideeffect', 'FB-02'],
  rationale: 'Assumed: MutationObserver is passive. Actual: any DOM change (including verification tooling injections) fires callbacks. config.json has no reference.',
});

// FB-02c: ResizeObserver fires during viewport sizing for screenshot
scenarios.push({
  id: nextId('screenshot'),
  description: 'FB-02: ResizeObserver fires when viewport is set for screenshot — observation triggers resize callbacks',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>new ResizeObserver(()=>console.log("resized")).observe(document.body);</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ResizeObserver' },
    { type: 'content', file: 'server.js', pattern: 'resize-aware' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'screenshot_sideeffect', 'FB-02'],
  rationale: 'Assumed: ResizeObserver only fires on user actions. Actual: setting viewport for screenshot triggers resize. No "resize-aware" in server.js.',
});

// FB-02d: CSS animation state changes during screenshot repaint
scenarios.push({
  id: nextId('screenshot'),
  description: 'FB-02: CSS animation — screenshot captures mid-animation frame, not resting state',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll" style="animation: fadeIn 2s forwards;">Scroll content</div>\n      <style>@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }</style>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '@keyframes' },
    { type: 'content', file: 'server.js', pattern: 'animation-fill-mode: none' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'screenshot_sideeffect', 'FB-02'],
  rationale: 'Assumed: screenshot captures final state. Actual: captures mid-animation frame. No animation-fill-mode:none in server.js.',
});

// FB-02e: Control — server.js has static HTML, screenshot captures what exists
scenarios.push({
  id: nextId('screenshot'),
  description: 'FB-02 control: server.js has static h1 "Demo App", screenshot captures static content',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'Demo App' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'browser', 'screenshot_sideeffect', 'FB-02', 'control'],
  rationale: 'Static HTML — screenshot of static content has no observer effects.',
});

// =============================================================================
// Shape FB-03: DOM measurement via offset/scroll triggers layout thrash
// Multiple measurement reads interleaved with writes cause layout thrashing.
// The verification read pattern itself degrades performance and may trigger
// browser safeguards (forced GC, frame drops) that alter observable state.
// =============================================================================

// FB-03a: scrollIntoView forces layout + scroll position change
scenarios.push({
  id: nextId('thrash'),
  description: 'FB-03: scrollIntoView to check element visibility — changes scroll position as side effect',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>document.querySelector("h1").scrollIntoView(); /* verify visible */</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'scrollIntoView' },
    { type: 'content', file: 'server.js', pattern: 'scroll-position-preserved' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'layout_thrash', 'FB-03'],
  rationale: 'Assumed: scrollIntoView just checks visibility. Actual: physically scrolls the page, changing scroll position. No preservation marker in server.js.',
});

// FB-03b: Read-write-read pattern causes layout thrashing
scenarios.push({
  id: nextId('thrash'),
  description: 'FB-03: offsetWidth read, style write, offsetWidth read — classic layout thrash pattern',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>var w=document.body.offsetWidth; document.body.style.padding="1px"; var w2=document.body.offsetWidth;</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'offsetWidth' },
    { type: 'content', file: 'config.json', pattern: 'layoutThrash' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'layout_thrash', 'FB-03'],
  rationale: 'Assumed: measuring width is harmless. Actual: read-write-read forces two reflows. config.json has no layoutThrash awareness.',
});

// FB-03c: focus() on element during verification changes :focus-visible styles
scenarios.push({
  id: nextId('thrash'),
  description: 'FB-03: element.focus() during check — changes :focus-visible styles, altering visual state',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <button id="verify-btn">Click</button>\n      <script>document.getElementById("verify-btn").focus();</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '.focus()' },
    { type: 'content', file: 'server.js', pattern: 'focus-management' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'layout_thrash', 'FB-03'],
  rationale: 'Assumed: calling focus() for verification is read-like. Actual: changes :focus-visible state, altering visual appearance. No focus-management in server.js.',
});

// FB-03d: window.getSelection() during check can trigger selection change events
scenarios.push({
  id: nextId('thrash'),
  description: 'FB-03: window.getSelection() check — may trigger selectionchange event listeners',
  edits: [{
    file: 'server.js',
    search: '<div class="overflow-scroll">Scroll content</div>',
    replace: '<div class="overflow-scroll">Scroll content</div>\n      <script>document.addEventListener("selectionchange", ()=>console.log("selection observed")); window.getSelection();</script>'
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'getSelection' },
    { type: 'content', file: 'config.json', pattern: 'selection' },
  ],
  expectedSuccess: false,
  tags: ['observation', 'browser', 'layout_thrash', 'FB-03'],
  rationale: 'Assumed: getSelection is pure read. Actual: accessing selection can fire selectionchange event. config.json has no selection config.',
});

// FB-03e: Control — server.js has static CSS classes, check for them (no DOM measurement)
scenarios.push({
  id: nextId('thrash'),
  description: 'FB-03 control: server.js has overflow-scroll class, predicate checks server.js text',
  edits: [],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'overflow-scroll' },
  ],
  expectedSuccess: true,
  tags: ['observation', 'browser', 'layout_thrash', 'FB-03', 'control'],
  rationale: 'Static file check — reading CSS class names in source text causes no layout thrashing.',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} observation-browser scenarios → ${outPath}`);
