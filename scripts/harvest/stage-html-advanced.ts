#!/usr/bin/env bun
/**
 * stage-html-advanced.ts — HTML Advanced Scenario Stager
 * Shapes: H-07, H-28, H-33, H-41 through H-48
 * Run: bun scripts/harvest/stage-html-advanced.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/html-advanced-staged.json');
const demoDir = resolve(__dirname, '../../fixtures/demo-app');
const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hadv-${prefix}-${String(++counter).padStart(3, '0')}`;
}
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');

function push(prefix: string, s: any) {
  scenarios.push({ id: nextId(prefix), ...s });
}

// =============================================================================
// H-07: SVG content assertion (SVG elements, attributes, paths)
// The /edge-cases route has no explicit SVG yet, but the comment mentions it.
// We add SVG via edits and assert on SVG elements.
// =============================================================================

push('h07', {
  description: 'H-07: Add SVG icon to about page — assert svg element exists',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <svg class="icon-star" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" fill="#f1c40f"/></svg>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'svg.icon-star', expected: 'exists' },
    { type: 'html', selector: 'svg.icon-star path', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'svg', 'H-07'],
  rationale: 'SVG element inserted with class and path child — both should be found.',
});

push('h07', {
  description: 'H-07: Assert SVG attributes — viewBox and dimensions',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <svg id="logo-svg" width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#3498db"/></svg>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'svg#logo-svg', expected: 'exists' },
    { type: 'html', selector: 'svg#logo-svg circle', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'viewBox="0 0 48 48"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'svg', 'H-07'],
  rationale: 'SVG with id, circle child, and viewBox attribute all verifiable.',
});

push('h07', {
  description: 'H-07: SVG assertion on non-existent SVG element — should fail',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'svg.chart-icon', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'svg', 'H-07'],
  rationale: 'No SVG with class chart-icon exists — html gate should fail.',
});

push('h07', {
  description: 'H-07: Inline SVG with complex path data and text element',
  edits: [{
    file: 'server.js',
    search: '  <div class="animated">Pulsing element</div>',
    replace: '  <div class="animated">Pulsing element</div>\n  <svg class="badge-svg" width="100" height="100"><rect x="10" y="10" width="80" height="80" rx="8" fill="#2ecc71"/><text x="50" y="55" text-anchor="middle" fill="white" font-size="14">OK</text></svg>',
  }],
  predicates: [
    { type: 'html', selector: 'svg.badge-svg rect', expected: 'exists' },
    { type: 'html', selector: 'svg.badge-svg text', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'text-anchor="middle"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'svg', 'H-07'],
  rationale: 'SVG with rect and text children, attribute assertions via content check.',
});

// =============================================================================
// H-28: RTL markers (bidi text direction, right-to-left)
// =============================================================================

push('h28', {
  description: 'H-28: Add dir="rtl" attribute to a section on about page',
  edits: [{
    file: 'server.js',
    search: '  <div id="details">\n    <p>Additional details appear here.</p>\n  </div>',
    replace: '  <div id="details" dir="rtl" lang="ar">\n    <p>Additional details appear here.</p>\n    <p class="rtl-text">\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645</p>\n  </div>',
  }],
  predicates: [
    { type: 'html', selector: '#details[dir="rtl"]', expected: 'exists' },
    { type: 'html', selector: '.rtl-text', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'dir="rtl"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'rtl', 'bidi', 'H-28'],
  rationale: 'RTL direction attribute set on container with Arabic text content.',
});

push('h28', {
  description: 'H-28: Bidi override with <bdo> element',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <bdo dir="rtl" class="bidi-override">Reversed text</bdo>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'bdo.bidi-override', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: '<bdo dir="rtl"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'rtl', 'bidi', 'H-28'],
  rationale: 'BDO element with RTL direction — tests bidi text direction rendering.',
});

push('h28', {
  description: 'H-28: Missing dir attribute where RTL expected — predicate fails',
  edits: [{
    file: 'server.js',
    search: '  <div id="details">\n    <p>Additional details appear here.</p>\n  </div>',
    replace: '  <div id="details">\n    <p>Additional details appear here.</p>\n    <p class="arabic-text">\u0645\u0631\u062d\u0628\u0627</p>\n  </div>',
  }],
  predicates: [
    { type: 'html', selector: '#details[dir="rtl"]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'rtl', 'bidi', 'H-28'],
  rationale: 'Arabic text added but dir attribute missing — attribute selector fails.',
});

// =============================================================================
// H-33: Shadow DOM (custom elements with shadow roots)
// =============================================================================

push('h33', {
  description: 'H-33: Add custom element definition with shadow DOM content',
  edits: [{
    file: 'server.js',
    search: '  <footer>Edge cases page</footer>',
    replace: `  <my-widget class="shadow-widget"></my-widget>
  <script>
    class MyWidget extends HTMLElement {
      constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<div class="shadow-inner"><p>Shadow content</p></div>';
      }
    }
    customElements.define('my-widget', MyWidget);
  </script>
  <footer>Edge cases page</footer>`,
  }],
  predicates: [
    { type: 'html', selector: 'my-widget.shadow-widget', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'attachShadow' },
    { type: 'content', file: 'server.js', pattern: "customElements.define('my-widget'" },
  ],
  expectedSuccess: true,
  tags: ['html', 'shadow-dom', 'web-components', 'H-33'],
  rationale: 'Custom element with shadow DOM — host element findable, shadow internals only via content check.',
});

push('h33', {
  description: 'H-33: Shadow DOM — cannot query shadow-internal selector from light DOM',
  edits: [{
    file: 'server.js',
    search: '  <footer>Edge cases page</footer>',
    replace: `  <status-badge></status-badge>
  <script>
    class StatusBadge extends HTMLElement {
      constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<span class="inner-badge">Active</span>';
      }
    }
    customElements.define('status-badge', StatusBadge);
  </script>
  <footer>Edge cases page</footer>`,
  }],
  predicates: [
    { type: 'html', selector: '.inner-badge', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'shadow-dom', 'web-components', 'H-33'],
  rationale: 'Shadow-internal .inner-badge is not queryable from light DOM — html gate fails.',
});

push('h33', {
  description: 'H-33: Custom element host detectable, verify registration via content',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <app-footer class="custom-footer"></app-footer>
  <script>
    class AppFooter extends HTMLElement {
      connectedCallback() { this.innerHTML = '<footer>Custom footer content</footer>'; }
    }
    customElements.define('app-footer', AppFooter);
  </script>`,
  }],
  predicates: [
    { type: 'html', selector: 'app-footer.custom-footer', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: "customElements.define('app-footer'" },
  ],
  expectedSuccess: true,
  tags: ['html', 'shadow-dom', 'web-components', 'H-33'],
  rationale: 'Custom element without shadow DOM — light DOM content injection, host queryable.',
});

// =============================================================================
// H-41: Hydration (SSR vs client, hydration mismatches)
// =============================================================================

push('h41', {
  description: 'H-41: SSR content replaced by client-side hydration script',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <div id="hydration-root" data-ssr="true">Server-rendered content</div>
  <script>
    const root = document.getElementById('hydration-root');
    if (root && root.dataset.ssr) {
      root.innerHTML = 'Client-hydrated content';
      root.removeAttribute('data-ssr');
    }
  </script>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: '#hydration-root', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'data-ssr="true"' },
    { type: 'content', file: 'server.js', pattern: 'Client-hydrated content' },
  ],
  expectedSuccess: true,
  tags: ['html', 'hydration', 'ssr', 'H-41'],
  rationale: 'SSR delivers static content, client script hydrates — both present in source.',
});

push('h41', {
  description: 'H-41: Hydration mismatch — server HTML differs from client expectation',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <div id="app-mount" data-hydrate="v2">Server says v1</div>
  <script>
    const el = document.getElementById('app-mount');
    if (el.dataset.hydrate !== 'v1') {
      console.warn('Hydration mismatch: expected v1, got ' + el.dataset.hydrate);
      el.classList.add('hydration-error');
    }
  </script>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: '#app-mount[data-hydrate="v1"]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'hydration', 'ssr', 'H-41'],
  rationale: 'SSR sends data-hydrate="v2" but predicate expects v1 — attribute mismatch.',
});

push('h41', {
  description: 'H-41: Hydration marker attribute correctly set on server',
  edits: [{
    file: 'server.js',
    search: '  <p class="subtitle">A minimal app for testing @sovereign-labs/verify</p>',
    replace: '  <p class="subtitle" data-reactroot="">A minimal app for testing @sovereign-labs/verify</p>',
  }],
  predicates: [
    { type: 'html', selector: '.subtitle[data-reactroot]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'data-reactroot=""' },
  ],
  expectedSuccess: true,
  tags: ['html', 'hydration', 'ssr', 'H-41'],
  rationale: 'React-style hydration marker attribute added and detected.',
});

// =============================================================================
// H-42: Conditional rendering (elements only in certain states)
// =============================================================================

push('h42', {
  description: 'H-42: Conditionally rendered element — static fallback in SSR',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <div id="conditional-panel" class="panel-hidden" style="display:none;">
    <p class="conditional-content">This shows only when activated</p>
  </div>
  <noscript><p class="no-js-fallback">JavaScript required for interactive features</p></noscript>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: '#conditional-panel', expected: 'exists' },
    { type: 'html', selector: 'noscript', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'class="no-js-fallback"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'conditional', 'rendering', 'H-42'],
  rationale: 'Hidden panel and noscript fallback both in DOM — queryable even if hidden.',
});

push('h42', {
  description: 'H-42: Template element — content not rendered but in DOM',
  edits: [{
    file: 'server.js',
    search: '  <footer>Edge cases page</footer>',
    replace: `  <template id="item-template">
    <div class="template-item"><span class="item-name"></span></div>
  </template>
  <footer>Edge cases page</footer>`,
  }],
  predicates: [
    { type: 'html', selector: 'template#item-template', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'class="template-item"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'conditional', 'template', 'H-42'],
  rationale: 'Template element exists in DOM but content not rendered — host queryable.',
});

push('h42', {
  description: 'H-42: Assert on element that is conditionally absent — fails',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <script>
    if (window.location.hash === '#admin') {
      document.body.insertAdjacentHTML('beforeend', '<div class="admin-panel">Admin Controls</div>');
    }
  </script>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: '.admin-panel', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'conditional', 'rendering', 'H-42'],
  rationale: 'Admin panel only injected when hash is #admin — not in static HTML.',
});

push('h42', {
  description: 'H-42: Conditional via data attribute toggle — element present but inactive',
  edits: [{
    file: 'server.js',
    search: '  <div class="hidden">This content is hidden via CSS.</div>',
    replace: '  <div class="hidden" data-active="false">This content is hidden via CSS.</div>\n  <div class="visible-only" data-active="true">Active content</div>',
  }],
  predicates: [
    { type: 'html', selector: '[data-active="true"]', expected: 'exists' },
    { type: 'html', selector: '[data-active="false"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'conditional', 'data-attribute', 'H-42'],
  rationale: 'Both active and inactive states present — data attributes queryable.',
});

// =============================================================================
// H-43: Meta tags (title, description, og:, viewport)
// =============================================================================

push('h43', {
  description: 'H-43: Verify existing meta tags on homepage',
  edits: [{
    file: 'server.js',
    search: '  <meta name="description" content="A demo application for testing verify pipelines" />',
    replace: '  <meta name="description" content="A demo application for testing verify pipelines" />',
  }],
  predicates: [
    { type: 'html', selector: 'meta[name="description"]', expected: 'exists' },
    { type: 'html', selector: 'meta[property="og:title"]', expected: 'exists' },
    { type: 'html', selector: 'meta[charset="utf-8"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'meta', 'seo', 'H-43'],
  rationale: 'Homepage already has description, og:title, and charset meta tags.',
});

push('h43', {
  description: 'H-43: Add viewport and og:image meta tags',
  edits: [{
    file: 'server.js',
    search: '  <meta charset="utf-8" />',
    replace: '  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <meta property="og:image" content="https://example.com/og.png" />',
  }],
  predicates: [
    { type: 'html', selector: 'meta[name="viewport"]', expected: 'exists' },
    { type: 'html', selector: 'meta[property="og:image"]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'width=device-width, initial-scale=1' },
  ],
  expectedSuccess: true,
  tags: ['html', 'meta', 'viewport', 'og', 'H-43'],
  rationale: 'Viewport and og:image meta tags added to head — queryable by attribute selectors.',
});

push('h43', {
  description: 'H-43: Assert og:type missing when it actually exists — wrong value',
  edits: [{
    file: 'server.js',
    search: '  <meta property="og:type" content="website" />',
    replace: '  <meta property="og:type" content="website" />',
  }],
  predicates: [
    { type: 'html', selector: 'meta[property="og:type"][content="article"]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'meta', 'og', 'H-43'],
  rationale: 'og:type is "website" but predicate expects "article" — attribute mismatch.',
});

push('h43', {
  description: 'H-43: Add title tag to about page head and verify',
  edits: [{
    file: 'server.js',
    search: '  <title>About - Demo App</title>',
    replace: '  <title>About Us - Demo Application</title>\n  <meta name="robots" content="index, follow" />',
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'About Us - Demo Application' },
    { type: 'html', selector: 'meta[name="robots"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'meta', 'title', 'robots', 'H-43'],
  rationale: 'Title changed and robots meta added — content and html checks.',
});

// =============================================================================
// H-44: Form validation (required, pattern, type constraints)
// =============================================================================

push('h44', {
  description: 'H-44: Verify existing form validation attributes on contact form',
  edits: [{
    file: 'server.js',
    search: '      <input type="text" id="name" name="name" required placeholder="Your name" />',
    replace: '      <input type="text" id="name" name="name" required placeholder="Your name" />',
  }],
  predicates: [
    { type: 'html', selector: 'input[name="name"][required]', expected: 'exists' },
    { type: 'html', selector: 'input[type="email"][required]', expected: 'exists' },
    { type: 'html', selector: 'form#contact-form', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'form', 'validation', 'H-44'],
  rationale: 'Contact form has required name and email inputs — attribute selectors match.',
});

push('h44', {
  description: 'H-44: Add pattern and minlength validation attributes',
  edits: [{
    file: 'server.js',
    search: '      <input type="text" id="name" name="name" required placeholder="Your name" />',
    replace: '      <input type="text" id="name" name="name" required minlength="2" maxlength="50" pattern="[A-Za-z\\s]+" title="Letters and spaces only" placeholder="Your name" />',
  }],
  predicates: [
    { type: 'html', selector: 'input[name="name"][minlength="2"]', expected: 'exists' },
    { type: 'html', selector: 'input[name="name"][maxlength="50"]', expected: 'exists' },
    { type: 'html', selector: 'input[name="name"][pattern]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'title="Letters and spaces only"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'form', 'validation', 'pattern', 'H-44'],
  rationale: 'HTML5 validation attributes added — pattern, minlength, maxlength all queryable.',
});

push('h44', {
  description: 'H-44: Add custom validity via setCustomValidity in script',
  edits: [{
    file: 'server.js',
    search: '    <button type="submit">Send Message</button>',
    replace: `    <input type="tel" id="phone" name="phone" pattern="[0-9]{10}" placeholder="1234567890" />
    <button type="submit">Send Message</button>
    <script>
      document.getElementById('phone').addEventListener('input', function(e) {
        if (e.target.validity.patternMismatch) e.target.setCustomValidity('Enter 10 digits');
        else e.target.setCustomValidity('');
      });
    </script>`,
  }],
  predicates: [
    { type: 'html', selector: 'input[type="tel"][pattern]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'setCustomValidity' },
  ],
  expectedSuccess: true,
  tags: ['html', 'form', 'validation', 'custom-validity', 'H-44'],
  rationale: 'Tel input with pattern plus programmatic setCustomValidity.',
});

push('h44', {
  description: 'H-44: Assert required on optional field — fails',
  edits: [{
    file: 'server.js',
    search: '      <label for="subject">Subject</label>',
    replace: '      <label for="subject">Subject</label>',
  }],
  predicates: [
    { type: 'html', selector: 'select[name="subject"][required]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'form', 'validation', 'H-44'],
  rationale: 'Subject select is not required — attribute selector for required fails.',
});

// =============================================================================
// H-45: Accessibility tree (role, aria-*, tabindex)
// =============================================================================

push('h45', {
  description: 'H-45: Add ARIA landmark roles to about page sections',
  edits: [{
    file: 'server.js',
    search: '  <nav>\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/about">About</a>\n  </nav>',
    replace: '  <nav role="navigation" aria-label="Main navigation">\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/about">About</a>\n  </nav>',
  }],
  predicates: [
    { type: 'html', selector: 'nav[role="navigation"]', expected: 'exists' },
    { type: 'html', selector: 'nav[aria-label="Main navigation"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'a11y', 'aria', 'landmark', 'H-45'],
  rationale: 'ARIA role and label added to nav — both queryable via attribute selectors.',
});

push('h45', {
  description: 'H-45: Add tabindex and aria-hidden to interactive elements',
  edits: [{
    file: 'server.js',
    search: '  <input class="search" type="text" placeholder="Search..." />',
    replace: '  <input class="search" type="text" placeholder="Search..." aria-label="Search items" tabindex="1" />',
  }],
  predicates: [
    { type: 'html', selector: 'input.search[aria-label="Search items"]', expected: 'exists' },
    { type: 'html', selector: 'input.search[tabindex="1"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'a11y', 'aria', 'tabindex', 'H-45'],
  rationale: 'aria-label and tabindex on search input — accessible name and tab order.',
});

push('h45', {
  description: 'H-45: Add aria-live region for dynamic content',
  edits: [{
    file: 'server.js',
    search: '  <div id="details">\n    <p>Additional details appear here.</p>\n  </div>',
    replace: '  <div id="details" role="region" aria-live="polite" aria-atomic="true">\n    <p>Additional details appear here.</p>\n  </div>',
  }],
  predicates: [
    { type: 'html', selector: '#details[aria-live="polite"]', expected: 'exists' },
    { type: 'html', selector: '#details[aria-atomic="true"]', expected: 'exists' },
    { type: 'html', selector: '#details[role="region"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'a11y', 'aria-live', 'H-45'],
  rationale: 'ARIA live region with polite announce and atomic update.',
});

push('h45', {
  description: 'H-45: Assert aria-expanded on element without it — fails',
  edits: [{
    file: 'server.js',
    search: '  <button class="primary">Go</button>',
    replace: '  <button class="primary">Go</button>',
  }],
  predicates: [
    { type: 'html', selector: 'button.primary[aria-expanded="true"]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'a11y', 'aria', 'H-45'],
  rationale: 'Button has no aria-expanded attribute — attribute selector fails.',
});

push('h45', {
  description: 'H-45: Add skip navigation link and aria-describedby',
  edits: [{
    file: 'server.js',
    search: '  <nav>\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/about">About</a>\n  </nav>',
    replace: '  <a href="#main-content" class="skip-link" tabindex="0">Skip to content</a>\n  <nav>\n    <a class="nav-link" href="/">Home</a>\n    <a class="nav-link" href="/about">About</a>\n  </nav>',
  }],
  predicates: [
    { type: 'html', selector: 'a.skip-link[href="#main-content"]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'Skip to content' },
  ],
  expectedSuccess: true,
  tags: ['html', 'a11y', 'skip-nav', 'H-45'],
  rationale: 'Skip navigation link for keyboard users — standard a11y pattern.',
});

// =============================================================================
// H-46: Iframes (cross-origin, sandboxed, content assertion)
// =============================================================================

push('h46', {
  description: 'H-46: Add sandboxed iframe to about page',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <iframe class="embed-frame" src="/form" sandbox="allow-forms" width="400" height="300" title="Contact Form"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'iframe.embed-frame[sandbox]', expected: 'exists' },
    { type: 'html', selector: 'iframe[title="Contact Form"]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'sandbox="allow-forms"' },
  ],
  expectedSuccess: true,
  tags: ['html', 'iframe', 'sandbox', 'H-46'],
  rationale: 'Sandboxed iframe with title for a11y — host element queryable.',
});

push('h46', {
  description: 'H-46: Iframe with srcdoc for inline content',
  edits: [{
    file: 'server.js',
    search: '  <footer>Edge cases page</footer>',
    replace: '  <iframe id="inline-frame" srcdoc="<p>Inline frame content</p>" width="300" height="100"></iframe>\n  <footer>Edge cases page</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'iframe#inline-frame[srcdoc]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'Inline frame content' },
  ],
  expectedSuccess: true,
  tags: ['html', 'iframe', 'srcdoc', 'H-46'],
  rationale: 'Iframe with srcdoc — inline content verifiable via content predicate.',
});

push('h46', {
  description: 'H-46: Assert cross-origin iframe without actual src — wrong attribute',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: '  <iframe class="external-embed" src="about:blank" loading="lazy"></iframe>\n  <footer>About page footer</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'iframe.external-embed[src="https://example.com"]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'iframe', 'cross-origin', 'H-46'],
  rationale: 'Iframe src is about:blank but predicate expects https://example.com.',
});

// =============================================================================
// H-47: Picture/source (responsive images, srcset, media queries)
// =============================================================================

push('h47', {
  description: 'H-47: Add picture element with source and img fallback',
  edits: [{
    file: 'server.js',
    search: '  <img class="logo" src="/logo.png" alt="Demo Logo" />',
    replace: `  <picture class="responsive-logo">
    <source srcset="/logo.webp" type="image/webp" />
    <source srcset="/logo.avif" type="image/avif" />
    <img class="logo" src="/logo.png" alt="Demo Logo" />
  </picture>`,
  }],
  predicates: [
    { type: 'html', selector: 'picture.responsive-logo', expected: 'exists' },
    { type: 'html', selector: 'picture source[type="image/webp"]', expected: 'exists' },
    { type: 'html', selector: 'picture source[type="image/avif"]', expected: 'exists' },
    { type: 'html', selector: 'picture img.logo', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'picture', 'responsive', 'srcset', 'H-47'],
  rationale: 'Picture element with WebP/AVIF sources and PNG fallback — all queryable.',
});

push('h47', {
  description: 'H-47: Img with srcset and sizes for responsive loading',
  edits: [{
    file: 'server.js',
    search: '  <img class="logo" src="/logo.png" alt="Demo Logo" />',
    replace: '  <img class="logo" src="/logo.png" srcset="/logo-2x.png 2x, /logo-3x.png 3x" sizes="(max-width: 600px) 50px, 100px" alt="Demo Logo" />',
  }],
  predicates: [
    { type: 'html', selector: 'img.logo[srcset]', expected: 'exists' },
    { type: 'html', selector: 'img.logo[sizes]', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: '/logo-2x.png 2x' },
  ],
  expectedSuccess: true,
  tags: ['html', 'picture', 'srcset', 'responsive', 'H-47'],
  rationale: 'Img with srcset for density descriptors and sizes for breakpoints.',
});

push('h47', {
  description: 'H-47: Picture with media query sources for art direction',
  edits: [{
    file: 'server.js',
    search: '  <img class="logo" src="/logo.png" alt="Demo Logo" />',
    replace: `  <picture>
    <source media="(max-width: 480px)" srcset="/logo-small.jpg" />
    <source media="(max-width: 1024px)" srcset="/logo-medium.jpg" />
    <img class="logo" src="/logo.png" alt="Demo Logo" loading="lazy" />
  </picture>`,
  }],
  predicates: [
    { type: 'html', selector: 'source[media="(max-width: 480px)"]', expected: 'exists' },
    { type: 'html', selector: 'img.logo[loading="lazy"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'picture', 'media-query', 'art-direction', 'H-47'],
  rationale: 'Art direction via picture/source media queries with lazy loading.',
});

push('h47', {
  description: 'H-47: Assert srcset on image that has none — fails',
  edits: [{
    file: 'server.js',
    search: '  <img class="logo" src="/logo.png" alt="Demo Logo" />',
    replace: '  <img class="logo" src="/logo.png" alt="Demo Logo" />',
  }],
  predicates: [
    { type: 'html', selector: 'img.logo[srcset]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'picture', 'srcset', 'H-47'],
  rationale: 'Logo img has no srcset attribute — attribute selector fails.',
});

// =============================================================================
// H-48: Dialog (modal dialog, open/close state)
// =============================================================================

push('h48', {
  description: 'H-48: Add dialog element with open attribute',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <dialog id="info-dialog" open class="modal-dialog">
    <h3>Information</h3>
    <p>This is a native dialog element.</p>
    <button class="close-dialog" onclick="this.closest('dialog').close()">Close</button>
  </dialog>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: 'dialog#info-dialog[open]', expected: 'exists' },
    { type: 'html', selector: 'dialog .close-dialog', expected: 'exists' },
    { type: 'content', file: 'server.js', pattern: 'native dialog element' },
  ],
  expectedSuccess: true,
  tags: ['html', 'dialog', 'modal', 'H-48'],
  rationale: 'Native dialog with open attribute — queryable in DOM, close button inside.',
});

push('h48', {
  description: 'H-48: Dialog without open attribute — closed by default',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <dialog id="confirm-dialog" class="confirm-modal">
    <form method="dialog">
      <p>Are you sure?</p>
      <button value="cancel">Cancel</button>
      <button value="confirm">Confirm</button>
    </form>
  </dialog>
  <button class="open-confirm" onclick="document.getElementById('confirm-dialog').showModal()">Delete</button>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: 'dialog#confirm-dialog', expected: 'exists' },
    { type: 'html', selector: 'dialog form[method="dialog"]', expected: 'exists' },
    { type: 'html', selector: 'button.open-confirm', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'dialog', 'modal', 'form', 'H-48'],
  rationale: 'Closed dialog with form method=dialog pattern — host and contents queryable.',
});

push('h48', {
  description: 'H-48: Assert dialog is open when it is closed — fails',
  edits: [{
    file: 'server.js',
    search: '  <footer>Edge cases page</footer>',
    replace: '  <dialog id="hidden-dialog" class="edge-dialog"><p>Hidden dialog</p></dialog>\n  <footer>Edge cases page</footer>',
  }],
  predicates: [
    { type: 'html', selector: 'dialog#hidden-dialog[open]', expected: 'exists' },
  ],
  expectedSuccess: false,
  expectedFailedGate: 'html',
  tags: ['html', 'dialog', 'state', 'H-48'],
  rationale: 'Dialog has no open attribute — open state assertion fails.',
});

push('h48', {
  description: 'H-48: Dialog with backdrop styling and autofocus',
  edits: [{
    file: 'server.js',
    search: '  <footer>About page footer</footer>',
    replace: `  <dialog id="settings-dialog" open>
    <h3>Settings</h3>
    <label for="theme-select">Theme</label>
    <select id="theme-select" autofocus>
      <option>Light</option>
      <option>Dark</option>
    </select>
    <button onclick="this.closest('dialog').close()">Done</button>
  </dialog>
  <footer>About page footer</footer>`,
  }],
  predicates: [
    { type: 'html', selector: 'dialog#settings-dialog[open]', expected: 'exists' },
    { type: 'html', selector: 'dialog select[autofocus]', expected: 'exists' },
    { type: 'html', selector: 'dialog label[for="theme-select"]', expected: 'exists' },
  ],
  expectedSuccess: true,
  tags: ['html', 'dialog', 'autofocus', 'a11y', 'H-48'],
  rationale: 'Open dialog with autofocus select and label association — a11y aware dialog.',
});

// =============================================================================
// Write output
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} scenarios to ${outPath}`);

// Summary by shape
const shapeCounts: Record<string, number> = {};
for (const s of scenarios) {
  const shapeTag = s.tags.find((t: string) => /^H-\d+/.test(t));
  if (shapeTag) shapeCounts[shapeTag] = (shapeCounts[shapeTag] || 0) + 1;
}
console.log('\nScenarios per shape:');
for (const [shape, count] of Object.entries(shapeCounts).sort()) {
  console.log(`  ${shape}: ${count}`);
}
