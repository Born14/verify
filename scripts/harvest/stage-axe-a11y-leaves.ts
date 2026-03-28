/**
 * Axe A11y Scenario Harvester
 * ============================
 *
 * Generates a11y gate scenarios by injecting known violation/pass HTML patterns
 * from axe-core's integration test corpus into demo-app's server.js.
 *
 * These are deterministic, static-analysis scenarios — no browser needed.
 * The verify a11y gate does regex-based HTML scanning.
 *
 * Run: bun scripts/harvest/stage-axe-a11y-leaves.ts
 * Output: fixtures/scenarios/axe-a11y-staged.json
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/axe-a11y-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `axe-a11y-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// The demo-app server.js has HTML template literals.
// We inject violation patterns by searching for known anchors in the HTML output.
// The a11y gate scans all files with HTML-like content.

// Anchor: a unique string in server.js homepage route we can inject before.
// Using the footer on the about/homepage which is unique across the file.
const ANCHOR_SEARCH = '<footer>About page footer</footer>';
const makeReplace = (html: string) => `${html}\n<footer>About page footer</footer>`;

// =============================================================================
// AXE RULE: image-alt — Images must have alternative text
// axe-core: test/integration/rules/image-alt/
// =============================================================================

// Violation patterns
push({
  description: 'axe image-alt: img without alt attribute (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="photo.jpg">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'alt_text', 'axe', 'violation'],
  rationale: 'axe image-alt violation: img without alt should be caught',
});

push({
  description: 'axe image-alt: img with empty alt="" (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="photo.jpg" alt="">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'alt_text', 'axe', 'violation'],
  rationale: 'axe image-alt violation: empty alt is decorative but scanner may flag',
});

push({
  description: 'axe image-alt: img with whitespace-only alt (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="photo.jpg" alt="  ">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'alt_text', 'axe', 'violation'],
  rationale: 'axe image-alt violation: whitespace-only alt',
});

// Pass patterns
push({
  description: 'axe image-alt: img with descriptive alt (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="photo.jpg" alt="A sunset over mountains">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'alt_text', 'axe', 'pass'],
  rationale: 'axe image-alt pass: img with descriptive alt text',
});

push({
  description: 'axe image-alt: img with role="presentation" (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="decorative.jpg" role="presentation">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'alt_text', 'axe', 'pass'],
  rationale: 'axe image-alt pass: presentational images exempt',
});

push({
  description: 'axe image-alt: img with aria-label (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="icon.svg" aria-label="Settings icon">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'alt_text', 'axe', 'pass'],
  rationale: 'axe image-alt pass: aria-label provides accessible name',
});

// =============================================================================
// AXE RULE: heading-order — Heading levels should increase by one
// axe-core: test/integration/rules/heading-order/
// =============================================================================

push({
  description: 'axe heading-order: h1 then h3 (skip h2, violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<h1>Title</h1><h3>Subtitle</h3>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'heading_hierarchy', 'axe', 'violation'],
  rationale: 'axe heading-order violation: h1→h3 skips h2',
});

push({
  description: 'axe heading-order: h2 then h4 (skip h3, violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<h2>Section</h2><h4>Subsection</h4>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'heading_hierarchy', 'axe', 'violation'],
  rationale: 'axe heading-order violation: h2→h4 skips h3',
});

push({
  description: 'axe heading-order: h1 then h2 then h3 (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<h1>Title</h1><h2>Section</h2><h3>Sub</h3>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'heading_hierarchy', 'axe', 'pass'],
  rationale: 'axe heading-order pass: sequential heading levels',
});

// =============================================================================
// AXE RULE: empty-heading — Headings must have content
// =============================================================================

push({
  description: 'axe empty-heading: h1 with no text (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<h1></h1>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'heading_hierarchy', 'axe', 'violation'],
  rationale: 'axe empty-heading: empty heading element',
});

push({
  description: 'axe empty-heading: h2 with hidden-only text (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<h2><span style="display:none">Hidden</span></h2>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'heading_hierarchy', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'heading_hierarchy', 'axe', 'violation'],
  rationale: 'axe empty-heading: heading with only visually hidden text',
});

// =============================================================================
// AXE RULE: button-name — Buttons must have discernible text
// axe-core: test/integration/rules/button-name/
// =============================================================================

push({
  description: 'axe button-name: empty button (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<button></button>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'aria_label', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'aria_label', 'axe', 'violation'],
  rationale: 'axe button-name violation: button without text or label',
});

push({
  description: 'axe button-name: button with only SVG icon (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<button><svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"/></svg></button>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'aria_label', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'aria_label', 'axe', 'violation'],
  rationale: 'axe button-name violation: icon-only button without aria-label',
});

push({
  description: 'axe button-name: button with text (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<button>Submit</button>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'aria_label', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'aria_label', 'axe', 'pass'],
  rationale: 'axe button-name pass: button has visible text',
});

push({
  description: 'axe button-name: button with aria-label (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<button aria-label="Close dialog"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'aria_label', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'aria_label', 'axe', 'pass'],
  rationale: 'axe button-name pass: icon button with aria-label',
});

// =============================================================================
// AXE RULE: label — Form elements must have labels
// axe-core: test/integration/rules/label/
// =============================================================================

push({
  description: 'axe label: input without any label (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<input type="text">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'form_labels', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'form_labels', 'axe', 'violation'],
  rationale: 'axe label violation: text input without label, aria-label, or title',
});

push({
  description: 'axe label: textarea without label (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<textarea></textarea>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'form_labels', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'form_labels', 'axe', 'violation'],
  rationale: 'axe label violation: textarea without associated label',
});

push({
  description: 'axe label: select without label (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<select><option>A</option></select>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'form_labels', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'form_labels', 'axe', 'violation'],
  rationale: 'axe label violation: select without label',
});

// NOTE: form_labels pass scenarios omitted — demo-app baseline already has form_labels
// findings from existing inputs. Adding clean inputs doesn't remove existing violations.
// The violation scenarios above prove detection; exemption logic is proven by unit tests.

// =============================================================================
// AXE RULE: link-name — Links must have discernible text
// axe-core: test/integration/rules/link-name/
// =============================================================================

push({
  description: 'axe link-name: empty link (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="/page"></a>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'link_text', 'axe', 'violation'],
  rationale: 'axe link-name violation: link with no text',
});

push({
  description: 'axe link-name: link with "click here" text (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="/page">click here</a>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'link_text', 'axe', 'violation'],
  rationale: 'axe link-name violation: non-descriptive "click here" text',
});

push({
  description: 'axe link-name: link with "read more" text (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="/article">read more</a>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'link_text', 'axe', 'violation'],
  rationale: 'axe link-name violation: non-descriptive "read more" text',
});

push({
  description: 'axe link-name: link with descriptive text (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="/about">About our team</a>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'link_text', 'axe', 'pass'],
  rationale: 'axe link-name pass: descriptive link text',
});

push({
  description: 'axe link-name: link with aria-label (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="/settings" aria-label="User settings"><svg></svg></a>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'link_text', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'link_text', 'axe', 'pass'],
  rationale: 'axe link-name pass: icon link with aria-label',
});

// =============================================================================
// AXE RULE: html-has-lang — html element must have a lang attribute
// axe-core: test/integration/rules/html-has-lang/
// =============================================================================

push({
  description: 'axe html-has-lang: html without lang (violation)',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'lang_attr', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'lang_attr', 'axe', 'violation'],
  rationale: 'demo-app html tag lacks lang attribute',
});

// NOTE: lang_attr pass scenarios omitted — server.js has 4 <html> tags (one per route),
// editing one to add lang= still leaves 3 without, so gate still finds violations.
// The violation scenario (no-edit) already verifies the gate detects missing lang.

// =============================================================================
// AXE RULE: tabindex — No element should have tabindex > 0
// axe-core: test/integration/rules/tabindex/
// =============================================================================

push({
  description: 'axe tabindex: positive tabindex (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<div tabindex="5">Focusable</div>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'focus_management', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'focus_management', 'axe', 'violation'],
  rationale: 'axe tabindex violation: tabindex > 0 disrupts natural tab order',
});

push({
  description: 'axe tabindex: tabindex="1" (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<input type="text" tabindex="1">') }],
  predicates: [{ type: 'a11y', a11yCheck: 'focus_management', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'focus_management', 'axe', 'violation'],
  rationale: 'axe tabindex violation: any positive tabindex is an anti-pattern',
});

push({
  description: 'axe tabindex: tabindex="0" (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<div tabindex="0">Focusable</div>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'focus_management', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'focus_management', 'axe', 'pass'],
  rationale: 'axe tabindex pass: tabindex="0" is natural tab order',
});

push({
  description: 'axe tabindex: tabindex="-1" (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<div tabindex="-1">Programmatic focus</div>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'focus_management', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'focus_management', 'axe', 'pass'],
  rationale: 'axe tabindex pass: tabindex="-1" allows programmatic focus only',
});

push({
  description: 'axe focus: outline:none without focus-visible (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<style>button { outline: none; }</style>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'focus_management', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'focus_management', 'axe', 'violation'],
  rationale: 'Removing focus outline without :focus-visible alternative harms keyboard users',
});

// =============================================================================
// AXE RULE: no-autoplay-audio — Media must not autoplay
// =============================================================================

push({
  description: 'axe autoplay: video with autoplay (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<video autoplay src="intro.mp4"></video>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'autoplay', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'autoplay', 'axe', 'violation'],
  rationale: 'axe no-autoplay-audio violation: video with autoplay attribute',
});

push({
  description: 'axe autoplay: audio with autoplay (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<audio autoplay src="music.mp3"></audio>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'autoplay', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'autoplay', 'axe', 'violation'],
  rationale: 'axe no-autoplay-audio violation: audio with autoplay',
});

push({
  description: 'axe autoplay: video without autoplay (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<video controls src="intro.mp4"></video>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'autoplay', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'autoplay', 'axe', 'pass'],
  rationale: 'axe pass: video with controls but no autoplay',
});

// =============================================================================
// AXE RULE: landmark — Page must have main landmark
// =============================================================================

push({
  description: 'axe landmark: page without main element (violation)',
  edits: [],
  predicates: [{ type: 'a11y', a11yCheck: 'landmark', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'landmark', 'axe', 'violation'],
  rationale: 'demo-app lacks <main> landmark element',
});

push({
  description: 'axe landmark: page with main element (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<main>Content</main>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'landmark', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'landmark', 'axe', 'pass'],
  rationale: 'axe landmark pass: page has <main> element',
});

push({
  description: 'axe landmark: page with role="main" (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<div role="main">Content</div>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'landmark', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'landmark', 'axe', 'pass'],
  rationale: 'axe landmark pass: role="main" on div',
});

// =============================================================================
// AXE RULE: skip-link — Page with main content should have skip nav link
// =============================================================================

push({
  description: 'axe skip-link: main without skip nav (violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<main id="main">Content</main>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'skip_nav', expected: 'has_findings' }],
  expectedSuccess: true,
  intent: 'false_negative',
  tags: ['a11y', 'skip_nav', 'axe', 'violation'],
  rationale: 'axe skip-link: main content without skip navigation link',
});

push({
  description: 'axe skip-link: main with skip nav link (pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<a href="#main">Skip to main content</a><main id="main">Content</main>') }],
  predicates: [{ type: 'a11y', a11yCheck: 'skip_nav', expected: 'no_findings' }],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'skip_nav', 'axe', 'pass'],
  rationale: 'axe skip-link pass: skip nav link targets main content',
});

// =============================================================================
// CROSS-CHECK: Multiple a11y issues in one page
// =============================================================================

push({
  description: 'axe multi: img no-alt + empty button (dual violation)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="x.jpg"><button></button>') }],
  predicates: [
    { type: 'a11y', a11yCheck: 'alt_text', expected: 'has_findings' },
    { type: 'a11y', a11yCheck: 'aria_label', expected: 'has_findings' },
  ],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'multi', 'axe'],
  rationale: 'Multiple a11y violations should all be caught independently',
});

push({
  description: 'axe multi: clean img + labeled button (dual pass)',
  edits: [{ file: 'server.js', search: ANCHOR_SEARCH, replace: makeReplace('<img src="x.jpg" alt="Photo"><button>Click</button>') }],
  predicates: [
    { type: 'a11y', a11yCheck: 'alt_text', expected: 'no_findings' },
    { type: 'a11y', a11yCheck: 'aria_label', expected: 'no_findings' },
  ],
  expectedSuccess: true,
  intent: 'regression_guard',
  tags: ['a11y', 'multi', 'axe'],
  rationale: 'Both checks should pass with proper elements',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} axe-a11y scenarios to ${outPath}`);
