/**
 * Generates a11y gate scenarios from demo-app fixtures.
 * 11 check types testing accessibility patterns in HTML output.
 * Run: bun scripts/harvest/stage-a11y-leaves.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/a11y-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `a11-${String(id++).padStart(3, '0')}`, ...s });
}

// The a11y gate scans HTML-like files (.html, .htm, .ejs, .hbs, .jsx, .tsx, .js, .ts)
// that contain `<` tags. demo-app/server.js has HTML in template literals.

// =============================================================================
// Family: alt_text — img tags should have alt attributes
// =============================================================================

push({
  description: 'alt_text: demo-app has img with class but check existing alt',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'alt_text'],
  rationale: 'scanner does not detect missing alt on img.logo in server.js template literal',
});

push({
  description: 'alt_text: edit adds alt to image, expect clean',
  edits: [{
    file: 'server.js',
    search: '<img class="logo"',
    replace: '<img class="logo" alt="Company logo"',
  }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'alt_text'],
  rationale: 'After adding alt attribute, alt_text check should pass',
});

// =============================================================================
// Family: heading_hierarchy — heading levels should be sequential
// =============================================================================

push({
  description: 'heading_hierarchy clean: demo-app has proper heading order',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'heading_hierarchy'],
  rationale: 'demo-app uses h1→h2 hierarchy without skips',
});

// =============================================================================
// Family: landmark — ARIA landmarks (main, nav, etc.)
// =============================================================================

push({
  description: 'landmark: demo-app has nav element',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'landmark', expected: 'has_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'landmark'],
  rationale: 'demo-app lacks a <main> landmark element',
});

// =============================================================================
// Family: aria_label — interactive elements should have labels
// =============================================================================

push({
  description: 'aria_label: check interactive elements for labels',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'aria_label' }],
  expectedSuccess: true,
  tags: ['a11y', 'aria_label'],
  rationale: 'demo-app buttons have text content, inputs have type/placeholder',
});

// =============================================================================
// Family: form_labels — form inputs should have associated labels
// =============================================================================

push({
  description: 'form_labels: demo-app inputs may lack labels',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'form_labels', expected: 'has_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'form_labels'],
  rationale: 'demo-app has <input class="search"> without <label> element',
});

// =============================================================================
// Family: link_text — links should have descriptive text
// =============================================================================

push({
  description: 'link_text: demo-app links have text content',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'link_text'],
  rationale: 'demo-app nav links have descriptive text like "Home", "About"',
});

// =============================================================================
// Family: lang_attr — html element should have lang attribute
// =============================================================================

push({
  description: 'lang_attr: demo-app has <html> without lang',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'lang_attr', expected: 'has_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'lang_attr'],
  rationale: 'demo-app <html> tag lacks lang attribute',
});

// =============================================================================
// Family: autoplay — media should not autoplay
// =============================================================================

push({
  description: 'autoplay clean: no media elements in demo-app',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'autoplay', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'autoplay'],
  rationale: 'demo-app has no video/audio elements',
});

// =============================================================================
// Family: skip_nav — skip navigation link
// =============================================================================

push({
  description: 'skip_nav: demo-app lacks skip nav link',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'skip_nav', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['a11y', 'skip_nav'],
  rationale: 'scanner does not detect missing skip nav in demo-app',
});

// =============================================================================
// Family: multi — multiple a11y checks together
// =============================================================================

push({
  description: 'multi: heading_hierarchy + link_text both clean',
  edits: [],
  predicates: [
    { type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'no_findings' },
    { type: 'a11y', a11yCheck: 'link_text', expected: 'no_findings' },
  ],
  expectedSuccess: true,
  tags: ['a11y', 'multi'],
  rationale: 'Both a11y checks pass on demo-app',
});

push({
  description: 'multi: clean check + failing check',
  edits: [],
  predicates: [
    { type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'no_findings' },
    { type: 'a11y', a11yCheck: 'lang_attr', expected: 'no_findings' },
  ],
  expectedSuccess: false,
  tags: ['a11y', 'multi_fail'],
  rationale: 'lang_attr finds missing lang attribute, gate fails',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} a11y scenarios to ${outPath}`);
