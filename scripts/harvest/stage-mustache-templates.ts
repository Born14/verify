#!/usr/bin/env bun
/**
 * stage-mustache-templates.ts — Mustache Template Rendering Scenario Stager
 *
 * Generates verify scenarios from Mustache template spec patterns.
 * Based on the 203 known test cases from the official Mustache spec
 * (https://github.com/mustache/spec).
 *
 * Sections covered:
 *   - Comments ({{! comment}})
 *   - Delimiters ({{=<% %>=}})
 *   - Interpolation ({{name}}, {{{html}}}, {{&html}})
 *   - Sections ({{#list}}...{{/list}})
 *   - Inverted ({{^list}}...{{/list}})
 *   - Partials ({{> partial}})
 *   - Lambdas (functions as values)
 *
 * Each scenario uses content predicates against template source files.
 * No edits (pure tier) — checks grounding gate behavior against
 * template patterns that exist (or don't exist) in the app source.
 *
 * Run: bun scripts/harvest/stage-mustache-templates.ts
 * Output: fixtures/scenarios/mustache-templates-staged.json
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve(__dirname, '../../fixtures/scenarios/mustache-templates-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `mustache-${String(id++).padStart(3, '0')}`, requiresDocker: false, ...s });
}

// =============================================================================
// Template source files used as fixture content.
// These represent what a Mustache-powered app's source might contain.
// =============================================================================

const TEMPLATE_FILE = 'templates/main.mustache';
const PARTIAL_FILE = 'templates/partials/header.mustache';
const HELPER_FILE = 'lib/render.js';
const DATA_FILE = 'data/context.json';

// =============================================================================
// SECTION 1: COMMENTS — {{! comment }} stripping
// Mustache spec: comments should be stripped from output entirely
// =============================================================================

// TMPL-01: Basic comment syntax
push({
  description: 'comments: inline comment is present in template source',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{! This is a comment }}' }],
  expectedSuccess: true,
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Mustache comment tag exists in template source',
});

push({
  description: 'comments: multiline comment block in template',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{!\nThis is a\nmultiline comment\n}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Multiline comment not present in template — fabricated pattern',
});

push({
  description: 'comments: comment with leading whitespace',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{!   padded comment   }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Padded comment does not exist in source',
});

push({
  description: 'comments: standalone comment on its own line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '  {{! standalone comment }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Standalone comment with indentation — fabricated',
});

push({
  description: 'comments: comment between HTML elements',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<div>{{! separator }}</div>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Comment embedded in HTML — pattern not in source',
});

push({
  description: 'comments: empty comment tag',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{!}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Empty comment tag not present',
});

push({
  description: 'comments: comment with special characters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{! <script>alert("xss")</script> }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Comment containing HTML/script — fabricated',
});

push({
  description: 'comments: comment should not appear in rendered output',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'comment' }],
  expectedSuccess: true,
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'The word comment may appear in helper code discussing rendering',
});

push({
  description: 'comments: adjacent comments',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{! first }}{{! second }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Adjacent comment tags — fabricated pattern',
});

push({
  description: 'comments: comment containing mustache-like syntax',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{! {{name}} is not rendered }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'comments', 'TMPL-01'],
  rationale: 'Nested mustache in comment — fabricated',
});

// =============================================================================
// SECTION 2: DELIMITERS — Custom {{=<% %>=}} delimiters
// Mustache spec: delimiters can be changed mid-template
// =============================================================================

// TMPL-02: Delimiter changes
push({
  description: 'delimiters: set delimiter tag in template',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{=<% %>=}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Custom delimiter syntax — not present in standard template',
});

push({
  description: 'delimiters: ERB-style delimiters after change',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%name%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'ERB-style tag after delimiter change — fabricated',
});

push({
  description: 'delimiters: reset to default delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%={{ }}=%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Delimiter reset from ERB back to mustache — fabricated',
});

push({
  description: 'delimiters: pipe-style custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{=| |=}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Pipe delimiters — fabricated',
});

push({
  description: 'delimiters: triple mustache with custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%{html}%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Unescaped with custom delimiters — fabricated',
});

push({
  description: 'delimiters: section with custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%#section%>content<%/section%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Section using ERB delimiters — fabricated',
});

push({
  description: 'delimiters: standalone delimiter on own line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n{{=<< >>=}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Standalone angle bracket delimiters — fabricated',
});

push({
  description: 'delimiters: inverted section with custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%^missing%>default<%/missing%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Inverted section with ERB delimiters — fabricated',
});

push({
  description: 'delimiters: partial with custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%> header%>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Partial include with custom delimiters — fabricated',
});

push({
  description: 'delimiters: comment with custom delimiters',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<%! custom comment %>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'delimiters', 'TMPL-02'],
  rationale: 'Comment with custom delimiters — fabricated',
});

// =============================================================================
// SECTION 3: INTERPOLATION — {{name}}, {{{html}}}, {{&html}}
// Mustache spec: basic variable interpolation and HTML escaping
// =============================================================================

// TMPL-03: Interpolation
push({
  description: 'interpolation: basic variable tag in template',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{name}}' }],
  expectedSuccess: true,
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Basic mustache variable tag likely present in template',
});

push({
  description: 'interpolation: triple mustache unescaped',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{{htmlContent}}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Triple mustache for unescaped HTML — fabricated variable name',
});

push({
  description: 'interpolation: ampersand unescaped',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{&rawHtml}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Ampersand unescaped syntax — fabricated variable',
});

push({
  description: 'interpolation: dot notation for nested object',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{person.name}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Dot notation access — fabricated nested variable',
});

push({
  description: 'interpolation: integer value rendered as string',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"age": 30' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Integer in data context — fabricated data file content',
});

push({
  description: 'interpolation: decimal value rendered without trailing zeros',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"price": 1.50' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Decimal in data — fabricated',
});

push({
  description: 'interpolation: null value renders as empty string',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"value": null' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Null in data — fabricated',
});

push({
  description: 'interpolation: HTML entities escaped in double mustache',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: '&amp;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'HTML entity escape reference — not in helper source',
});

push({
  description: 'interpolation: context miss returns empty string',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{nonexistentVariable}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Variable that does not exist in any context — fabricated',
});

push({
  description: 'interpolation: surrounding whitespace preserved',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '| {{string}} |' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Interpolation with surrounding pipes — fabricated pattern',
});

push({
  description: 'interpolation: standalone tag should not trim',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '  {{standalone}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Standalone interpolation with indent — fabricated',
});

push({
  description: 'interpolation: multiple variables on one line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{first}} {{last}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Two variables on one line — fabricated',
});

push({
  description: 'interpolation: deeply nested dot notation',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{a.b.c.d.e}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Five-level deep dot notation — fabricated',
});

push({
  description: 'interpolation: implicit iterator dot',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{.}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'Implicit iterator (dot) — fabricated',
});

push({
  description: 'interpolation: HTML special chars require escaping in double mustache',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'escapeHtml' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'interpolation', 'TMPL-03'],
  rationale: 'escapeHtml function reference — fabricated helper',
});

// =============================================================================
// SECTION 4: SECTIONS — {{#list}}...{{/list}}
// Mustache spec: sections for truthy values, lists, and context pushing
// =============================================================================

// TMPL-04: Sections
push({
  description: 'sections: basic truthy section in template',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#shown}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Truthy section tag — fabricated',
});

push({
  description: 'sections: closing tag for section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{/shown}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Section closing tag — fabricated',
});

push({
  description: 'sections: list iteration with item variable',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#items}}{{name}}{{/items}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'List iteration pattern — fabricated',
});

push({
  description: 'sections: nested section context',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#person}}{{#address}}{{city}}{{/address}}{{/person}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Nested context pushing — fabricated',
});

push({
  description: 'sections: falsy value hides section',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"hidden": false' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Falsy boolean in data — fabricated',
});

push({
  description: 'sections: empty list hides section',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"emptyList": []' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Empty array in data — fabricated',
});

push({
  description: 'sections: section with implicit iterator',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#names}}{{.}} {{/names}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Implicit iterator in list — fabricated',
});

push({
  description: 'sections: doubled section renders twice',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#bool}}first{{/bool}}{{#bool}}second{{/bool}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Doubled section — fabricated',
});

push({
  description: 'sections: deeply nested sections',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#a}}{{#b}}{{#c}}deep{{/c}}{{/b}}{{/a}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Three-level nested sections — fabricated',
});

push({
  description: 'sections: context resolution walks up stack',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#section}}{{parentVar}}{{/section}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Parent context resolution — fabricated',
});

push({
  description: 'sections: standalone section tags',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n{{#items}}\n  {{name}}\n{{/items}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Standalone section on own lines — fabricated multiline',
});

push({
  description: 'sections: indented standalone section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '  {{#section}}\n  content\n  {{/section}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Indented standalone section — fabricated',
});

push({
  description: 'sections: section with whitespace around tag name',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{# list }}item{{/ list }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'Section with padded tag names — fabricated',
});

push({
  description: 'sections: section renders multiple list items',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#repos}}<b>{{name}}</b>{{/repos}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'sections', 'TMPL-04'],
  rationale: 'List rendering with HTML — fabricated',
});

// =============================================================================
// SECTION 5: INVERTED — {{^list}}...{{/list}}
// Mustache spec: inverted sections render when value is falsy/empty
// =============================================================================

// TMPL-05: Inverted sections
push({
  description: 'inverted: basic inverted section tag',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^missing}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted section tag — fabricated',
});

push({
  description: 'inverted: inverted closing tag',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{/missing}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted section closing — fabricated',
});

push({
  description: 'inverted: false value shows inverted content',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^showBanner}}No banner{{/showBanner}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted with false value — fabricated',
});

push({
  description: 'inverted: null value shows inverted content',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^user}}Guest{{/user}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted with null — fabricated',
});

push({
  description: 'inverted: empty list shows inverted content',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^items}}No items found{{/items}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted with empty list — fabricated',
});

push({
  description: 'inverted: truthy value hides inverted content',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"loggedIn": true' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Truthy boolean hiding inverted section — fabricated data',
});

push({
  description: 'inverted: non-empty list hides inverted content',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"users": [{"name": "admin"}]' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Non-empty list hiding inverted — fabricated data',
});

push({
  description: 'inverted: standalone inverted section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n{{^items}}\n  No items\n{{/items}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Standalone inverted on own lines — fabricated',
});

push({
  description: 'inverted: nested inverted and normal sections',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#users}}{{name}}{{/users}}{{^users}}No users{{/users}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Normal + inverted combo — fabricated',
});

push({
  description: 'inverted: inverted with context miss',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^undefinedKey}}default content{{/undefinedKey}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Inverted section for undefined key — fabricated',
});

push({
  description: 'inverted: double inverted section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{^a}}A{{/a}}{{^b}}B{{/b}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Two consecutive inverted sections — fabricated',
});

push({
  description: 'inverted: indented inverted section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '  {{^empty}}has content{{/empty}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'inverted', 'TMPL-05'],
  rationale: 'Indented inverted — fabricated',
});

// =============================================================================
// SECTION 6: PARTIALS — {{> partial}}
// Mustache spec: partials include external templates
// =============================================================================

// TMPL-06: Partials
push({
  description: 'partials: basic partial include',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{> header}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Partial include tag — fabricated',
});

push({
  description: 'partials: partial with indentation',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '  {{> footer}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Indented partial — fabricated',
});

push({
  description: 'partials: partial renders in parent context',
  edits: [],
  predicates: [{ type: 'content', file: PARTIAL_FILE, pattern: '<header>{{title}}</header>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Partial with parent context access — fabricated partial file',
});

push({
  description: 'partials: nested partial inclusion',
  edits: [],
  predicates: [{ type: 'content', file: PARTIAL_FILE, pattern: '{{> nav}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Partial including another partial — fabricated',
});

push({
  description: 'partials: standalone partial on own line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n{{> sidebar}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Standalone partial — fabricated',
});

push({
  description: 'partials: partial with padding should indent content',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '    {{> item}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Padded partial with indentation inheritance — fabricated',
});

push({
  description: 'partials: partial in section context',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#items}}{{> item_row}}{{/items}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Partial inside section — fabricated',
});

push({
  description: 'partials: missing partial renders empty',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{> nonexistent_partial}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Missing partial tag — fabricated',
});

push({
  description: 'partials: partial file content check',
  edits: [],
  predicates: [{ type: 'content', file: PARTIAL_FILE, pattern: '<nav class="main-nav">' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Navigation markup in partial — fabricated',
});

push({
  description: 'partials: partial with special characters in name',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{> shared/components/button}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Path-style partial name — fabricated',
});

push({
  description: 'partials: dynamic partial via section',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'registerPartial' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'partials', 'TMPL-06'],
  rationale: 'Handlebars-style registerPartial — not mustache spec, fabricated',
});

// =============================================================================
// SECTION 7: LAMBDAS — Functions as values
// Mustache spec: when a value is callable, it is invoked
// =============================================================================

// TMPL-07: Lambdas
push({
  description: 'lambdas: function value in context data',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'function () { return' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda function in helper — fabricated',
});

push({
  description: 'lambdas: lambda receives raw template text',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'function (text) { return text.toUpperCase()' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda with text parameter — fabricated',
});

push({
  description: 'lambdas: section lambda with render function',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'function (text, render) { return "<b>" + render(text) + "</b>"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Section lambda with render callback — fabricated',
});

push({
  description: 'lambdas: lambda returning dynamic content',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'return new Date().getFullYear()' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Dynamic lambda — fabricated',
});

push({
  description: 'lambdas: lambda wrapping section content',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#bold}}This is bold{{/bold}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda section in template — fabricated',
});

push({
  description: 'lambdas: lambda as interpolation value',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{currentYear}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda interpolation — fabricated variable name',
});

push({
  description: 'lambdas: lambda that returns template syntax for re-parsing',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'return "{{planet}}"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda returning mustache syntax — fabricated',
});

push({
  description: 'lambdas: lambda section wrapping with custom tags',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'function (text) { return "<em>" + text + "</em>"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda wrapping text in HTML — fabricated',
});

push({
  description: 'lambdas: non-callable value is not invoked',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"notAFunction": "just a string"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Non-callable in data — fabricated',
});

push({
  description: 'lambdas: lambda caching — should be called per render',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: 'let callCount = 0' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'lambdas', 'TMPL-07'],
  rationale: 'Lambda call counting — fabricated',
});

// =============================================================================
// SECTION 8: HTML ESCAPING — Cross-cutting across interpolation
// Mustache spec: {{var}} escapes, {{{var}}} and {{&var}} do not
// =============================================================================

// TMPL-08: HTML escaping
push({
  description: 'escaping: ampersand entity in escaped output',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: '&amp;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Ampersand entity — fabricated',
});

push({
  description: 'escaping: less-than entity in escaped output',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: '&lt;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Less-than entity — fabricated',
});

push({
  description: 'escaping: greater-than entity in escaped output',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: '&gt;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Greater-than entity — fabricated',
});

push({
  description: 'escaping: double-quote entity in escaped output',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: '&quot;' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Quote entity — fabricated',
});

push({
  description: 'escaping: triple mustache preserves raw HTML',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{{rawContent}}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Triple mustache unescaped — fabricated variable',
});

push({
  description: 'escaping: ampersand syntax preserves raw HTML',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{&userHtml}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Ampersand unescaped syntax — fabricated variable',
});

push({
  description: 'escaping: script tag gets escaped in double mustache',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"content": "<script>alert(1)</script>"' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'XSS payload in data — fabricated',
});

push({
  description: 'escaping: single quote not escaped by default',
  edits: [],
  predicates: [{ type: 'content', file: HELPER_FILE, pattern: "&#39;" }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'escaping', 'TMPL-08'],
  rationale: 'Single quote entity — fabricated',
});

// =============================================================================
// SECTION 9: WHITESPACE HANDLING — Standalone tags and indentation
// Cross-cutting: affects comments, sections, partials, delimiters
// =============================================================================

// TMPL-09: Whitespace
push({
  description: 'whitespace: standalone comment removes entire line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n{{! standalone }}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Standalone comment line removal — fabricated pattern',
});

push({
  description: 'whitespace: standalone section removes entire line',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\n  {{#section}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Standalone section tag — fabricated pattern',
});

push({
  description: 'whitespace: inline tags preserve surrounding text',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: ' {{tag}} ' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Inline tag with spaces — fabricated pattern',
});

push({
  description: 'whitespace: partial indentation inherits',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '   {{> partial}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Triple-space indented partial — fabricated',
});

push({
  description: 'whitespace: mixed content and standalone',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: 'text {{! comment }} text' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Comment between text is inline, not standalone — fabricated',
});

push({
  description: 'whitespace: tabs count as whitespace for standalone',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '\t{{#section}}\n\t\tcontent\n\t{{/section}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Tab-indented standalone section — fabricated',
});

push({
  description: 'whitespace: newlines within interpolation are not trimmed',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: 'Hello\n{{name}}\nWorld' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Newlines around interpolation — fabricated',
});

push({
  description: 'whitespace: trailing newline in template preserved',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{name}}\n' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'whitespace', 'TMPL-09'],
  rationale: 'Trailing newline after interpolation — fabricated',
});

// =============================================================================
// SECTION 10: NESTED CONTEXTS — Dot notation and parent context lookup
// Cross-cutting: affects interpolation and sections
// =============================================================================

// TMPL-10: Nested contexts
push({
  description: 'nested: single level object access',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{user.name}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Dot notation single level — fabricated',
});

push({
  description: 'nested: two level deep access',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{company.address.city}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Two-level dot notation — fabricated',
});

push({
  description: 'nested: context pushed by section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#user}}Hello {{name}}, you are {{age}}{{/user}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Section context push — fabricated',
});

push({
  description: 'nested: parent context accessible from child section',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#child}}{{parentName}}{{/child}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Parent variable in child section — fabricated',
});

push({
  description: 'nested: deeply nested data structure',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"level1": { "level2": { "level3": "deep" } }' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Deeply nested JSON — fabricated data',
});

push({
  description: 'nested: array of objects with nested access',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"items": [{"meta": {"type": "widget"}}]' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Nested array item — fabricated data',
});

push({
  description: 'nested: context miss at deep level returns empty',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{a.b.c.missing}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Deep context miss — fabricated',
});

push({
  description: 'nested: section creates new scope that shadows parent',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#override}}{{value}}{{/override}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'nested', 'TMPL-10'],
  rationale: 'Context shadowing via section — fabricated',
});

// =============================================================================
// SECTION 11: EDGE CASES — Spec compliance corner cases
// =============================================================================

// TMPL-11: Edge cases
push({
  description: 'edge: empty template renders empty string',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Empty pattern — should fail grounding (no pattern field)',
});

push({
  description: 'edge: template with no mustache tags',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '<p>Static content only</p>' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Static HTML only — fabricated',
});

push({
  description: 'edge: mismatched section tags',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{#open}}content{{/close}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Mismatched open/close tags — fabricated',
});

push({
  description: 'edge: orphaned closing tag',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{/orphan}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Closing tag without opener — fabricated',
});

push({
  description: 'edge: single curly braces are literal text',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{notATag}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Single curly braces — fabricated',
});

push({
  description: 'edge: four curly braces are not valid syntax',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{{{quad}}}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Quadruple braces — fabricated',
});

push({
  description: 'edge: tag with only whitespace name',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{   }}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Whitespace-only variable name — fabricated',
});

push({
  description: 'edge: boolean false value',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"active": false' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Boolean false in data — fabricated',
});

push({
  description: 'edge: zero renders as "0" not empty',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"count": 0' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Zero value in data — fabricated',
});

push({
  description: 'edge: empty string renders as empty',
  edits: [],
  predicates: [{ type: 'content', file: DATA_FILE, pattern: '"empty": ""' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Empty string in data — fabricated',
});

push({
  description: 'edge: unicode variable name',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{nombre}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Non-English variable name — fabricated',
});

push({
  description: 'edge: variable name with hyphens',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{first-name}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Hyphenated variable name — fabricated',
});

push({
  description: 'edge: variable name with underscores',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{first_name}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Underscored variable name — fabricated',
});

push({
  description: 'edge: consecutive interpolation tags',
  edits: [],
  predicates: [{ type: 'content', file: TEMPLATE_FILE, pattern: '{{a}}{{b}}{{c}}' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['template', 'edge', 'TMPL-11'],
  rationale: 'Three consecutive tags — fabricated',
});

// =============================================================================
// Write output + summary
// =============================================================================

writeFileSync(outPath, JSON.stringify(scenarios, null, 2));

console.log(`\nMustache Template Scenario Stager`);
console.log(`=================================`);
console.log(`Total: ${scenarios.length} scenarios`);

// Count by section tag
const bySection: Record<string, number> = {};
const byTmpl: Record<string, number> = {};
let expectedPass = 0;
let expectedFail = 0;

for (const s of scenarios) {
  for (const tag of s.tags) {
    if (['comments', 'delimiters', 'interpolation', 'sections', 'inverted', 'partials', 'lambdas', 'escaping', 'whitespace', 'nested', 'edge'].includes(tag)) {
      bySection[tag] = (bySection[tag] || 0) + 1;
    }
    if (tag.startsWith('TMPL-')) {
      byTmpl[tag] = (byTmpl[tag] || 0) + 1;
    }
  }
  if (s.expectedSuccess) expectedPass++;
  else expectedFail++;
}

console.log(`\nBy section:`);
for (const [k, v] of Object.entries(bySection).sort()) {
  console.log(`  ${k}: ${v}`);
}

console.log(`\nBy tag:`);
for (const [k, v] of Object.entries(byTmpl).sort()) {
  console.log(`  ${k}: ${v}`);
}

console.log(`\nExpected pass: ${expectedPass}`);
console.log(`Expected fail: ${expectedFail}`);
console.log(`Output: ${outPath}`);
