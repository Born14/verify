#!/usr/bin/env bun
/**
 * Temporal × Browser scenario generator
 * Grid cell: D×3
 * Shapes: TB-01 (DOM not settled), TB-02 (async content not rendered), TB-03 (CSS transition midpoint)
 *
 * These scenarios test whether verify's browser gate handles temporal issues:
 * - CSS class applied via setTimeout not settled when checked
 * - Async content not yet rendered at evaluation time
 * - CSS transitions captured at intermediate values
 *
 * Browser scenarios require Playwright → requiresPlaywright: true (--full tier).
 * Pure-tier scenarios test CSS predicate structure without browser.
 *
 * Run: bun scripts/harvest/stage-temporal-browser.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/temporal-browser-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `tb-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read server.js to understand existing CSS
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');

// =============================================================================
// Shape TB-01: DOM not settled when CSS evaluated
// Edit injects delayed CSS application via setTimeout. The browser gate should
// wait for DOM settle (300ms mutation silence) before evaluating.
// =============================================================================

// TB-01a: Add setTimeout that changes color after 100ms (within settle window)
scenarios.push({
  id: nextId('settle'),
  description: 'TB-01: setTimeout(100ms) changes h1 color — should settle before eval',
  edits: [{
    file: 'server.js',
    search: `<h1>Demo App</h1>`,
    replace: `<h1 id="main-title">Demo App</h1>\n  <script>setTimeout(() => document.getElementById('main-title').style.color = 'red', 100)</script>`,
  }],
  predicates: [{ type: 'css', selector: '#main-title', property: 'color', expected: 'rgb(255, 0, 0)' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'dom_settle', 'TB-01'],
  rationale: '100ms delay is within 300ms settle window — browser gate should capture final state',
});

// TB-01b: Add class toggle with short delay
scenarios.push({
  id: nextId('settle'),
  description: 'TB-01: setTimeout(50ms) adds CSS class — style should be applied at eval',
  edits: [{
    file: 'server.js',
    search: `<p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>`,
    replace: `<p class="subtitle" id="sub">A minimal app for testing @sovereign-labs/verify</p>\n  <script>setTimeout(() => document.getElementById('sub').classList.add('highlighted'), 50)</script>\n  <style>.highlighted { background-color: yellow; }</style>`,
  }],
  predicates: [{ type: 'css', selector: '#sub.highlighted', property: 'background-color', expected: 'rgb(255, 255, 0)' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'dom_settle', 'TB-01'],
  rationale: '50ms class toggle — settle window should capture the applied class',
});

// TB-01c: Predicate checks CSS before any JS runs (static CSS — control)
scenarios.push({
  id: nextId('settle'),
  description: 'TB-01 control: Static CSS h1 color — no temporal delay',
  edits: [],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: 'rgb(26, 26, 46)', path: '/' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'dom_settle', 'TB-01', 'control'],
  rationale: 'Static CSS — no timing issue, should pass immediately',
});

// =============================================================================
// Shape TB-02: Async content not rendered at check time
// Page loads content dynamically via fetch/innerHTML. If the browser gate
// checks before the async operation completes, the content won't be found.
// The settle detection should handle this by waiting for DOM mutations to stop.
// =============================================================================

// TB-02a: Inject async content loader that resolves quickly
scenarios.push({
  id: nextId('async'),
  description: 'TB-02: Async innerHTML injection at 100ms — content should be present at eval',
  edits: [{
    file: 'server.js',
    search: `<footer>Powered by Node.js</footer>`,
    replace: `<div id="async-box"></div>\n  <script>setTimeout(() => document.getElementById('async-box').innerHTML = '<span class="loaded">Async Content</span>', 100)</script>\n  <footer>Powered by Node.js</footer>`,
  }],
  predicates: [{ type: 'html', selector: '#async-box .loaded', assertion: 'exists' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'async_content', 'TB-02'],
  rationale: 'Async content at 100ms — settle window should wait for mutation before checking',
});

// TB-02b: Check text content of async element
scenarios.push({
  id: nextId('async'),
  description: 'TB-02: Async text content injection — textContent should match',
  edits: [{
    file: 'server.js',
    search: `<footer>Powered by Node.js</footer>`,
    replace: `<div id="dynamic-text"></div>\n  <script>setTimeout(() => { document.getElementById('dynamic-text').textContent = 'Dynamic Data Loaded'; }, 150)</script>\n  <footer>Powered by Node.js</footer>`,
  }],
  predicates: [{ type: 'html', selector: '#dynamic-text', assertion: 'exists' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'async_content', 'TB-02'],
  rationale: 'Text set after 150ms — DOM container exists immediately, content arrives within settle',
});

// TB-02c: Element that doesn't get async content (negative)
scenarios.push({
  id: nextId('async'),
  description: 'TB-02: Check for async element that never gets created',
  edits: [],
  predicates: [{ type: 'html', selector: '#never-created', assertion: 'exists' }],
  expectedSuccess: false,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'async_content', 'TB-02'],
  rationale: 'Element never created — should fail regardless of settle window',
});

// =============================================================================
// Shape TB-03: CSS transition midpoint captured
// Edit adds CSS transition. The browser gate disables animations via injected
// stylesheet — so the final value should be captured, not an intermediate one.
// =============================================================================

// TB-03a: Add CSS transition on hover-like state
scenarios.push({
  id: nextId('trans'),
  description: 'TB-03: CSS transition on opacity — gate should capture final value (animations disabled)',
  edits: [{
    file: 'server.js',
    search: `footer { margin-top: 2rem; color: #999; font-size: 0.8rem; }`,
    replace: `footer { margin-top: 2rem; color: #999; font-size: 0.8rem; transition: opacity 2s; opacity: 0.5; }`,
  }],
  predicates: [{ type: 'css', selector: 'footer', property: 'opacity', expected: '0.5', path: '/' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'transition_midpoint', 'TB-03'],
  rationale: 'Transition exists but animations disabled — gate captures CSS-declared final value',
});

// TB-03b: Animation on edge-cases page (existing animated element)
scenarios.push({
  id: nextId('trans'),
  description: 'TB-03: Animated element on /edge-cases — check color value (animation disabled)',
  edits: [],
  predicates: [{ type: 'css', selector: '.animated', property: 'color', expected: 'rgb(155, 89, 182)', path: '/edge-cases' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'transition_midpoint', 'TB-03', 'control'],
  rationale: 'Animated element has color #9b59b6 — with animations disabled, should get exact value',
});

// TB-03c: Edit adds transition to nav-link, check final color
scenarios.push({
  id: nextId('trans'),
  description: 'TB-03: Add transition to .nav-link color, check authored value',
  edits: [{
    file: 'server.js',
    search: `a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; }`,
    replace: `a.nav-link { color: #0066cc; text-decoration: none; margin-right: 1rem; transition: color 1s ease; }`,
  }],
  predicates: [{ type: 'css', selector: 'a.nav-link', property: 'color', expected: 'rgb(0, 102, 204)', path: '/' }],
  expectedSuccess: true,
  requiresDocker: true,
  requiresPlaywright: true,
  tags: ['temporal', 'browser', 'transition_midpoint', 'TB-03'],
  rationale: 'Transition added but not triggered — color should be the authored #0066cc',
});

// =============================================================================
// Pure-tier structural scenarios (no Docker/Playwright needed)
// Test CSS predicate/edit interaction at file level
// =============================================================================

// TB-pure-01: Edit CSS value, content predicate checks for new value in server.js
scenarios.push({
  id: nextId('pure'),
  description: 'TB-pure: Edit h1 color, content check finds new value in server.js',
  edits: [{ file: 'server.js', search: 'h1 { color: #1a1a2e;', replace: 'h1 { color: #ff0000;' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '#ff0000' }],
  expectedSuccess: true,
  tags: ['temporal', 'browser', 'dom_settle', 'TB-01', 'pure'],
  rationale: 'CSS edited in source — content gate should find new value',
});

// TB-pure-02: Edit CSS but check wrong file for the change
scenarios.push({
  id: nextId('pure'),
  description: 'TB-pure: Edit homepage CSS, check config.json for color (wrong file)',
  edits: [{ file: 'server.js', search: 'background: #ffffff;', replace: 'background: #000000;' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: '#000000' }],
  expectedSuccess: false,
  tags: ['temporal', 'browser', 'dom_settle', 'TB-01', 'pure'],
  rationale: 'CSS change in server.js but config.json has no CSS — cross-file temporal gap',
});

// TB-pure-03: Edit about page CSS, content check for old value
scenarios.push({
  id: nextId('pure'),
  description: 'TB-pure: Edit .hero background, content check for OLD color value',
  edits: [{ file: 'server.js', search: '.hero { background: #3498db;', replace: '.hero { background: #e74c3c;' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '.hero { background: #3498db' }],
  expectedSuccess: false,
  tags: ['temporal', 'browser', 'async_content', 'TB-02', 'pure'],
  rationale: 'CSS edited — old value should no longer be present',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-browser scenarios → ${outPath}`);
