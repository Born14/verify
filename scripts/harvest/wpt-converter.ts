#!/usr/bin/env bun
/**
 * WPT → Verify Scenario Converter (Multi-Domain)
 * ================================================
 *
 * Converts Web Platform Tests into verify scenarios across 5 domains:
 *   - CSS (css/)           → css predicates via test_computed_value/test_valid_value
 *   - HTTP (fetch/xhr/cors/) → http predicates via assert_equals(response.status/headers)
 *   - URL (url/)           → content predicates via urltestdata.json structured tests
 *   - Encoding (encoding/) → content predicates via assert_equals(decode(), expected)
 *   - HTML/DOM (html/dom/) → html predicates via assert_equals(el.property, expected)
 *
 * Usage:
 *   bun run scripts/harvest/wpt-converter.ts --wpt-dir=/path/to/wpt --out=file.json [--limit=N] [--stats]
 *   bun run scripts/harvest/wpt-converter.ts --wpt-dir=/path/to/wpt --domain=css --stats
 *   bun run scripts/harvest/wpt-converter.ts --wpt-dir=/path/to/wpt --domain=http --out=http.json
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HarvestedLeaf {
  id: string;
  source: 'wpt';
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
    // CSS fields
    selector?: string;
    property?: string;
    expected?: string;
    // HTTP fields
    path?: string;
    method?: string;
    expect?: { status?: number; bodyContains?: string; contentType?: string };
    // HTML fields
    // Content fields
    pattern?: string;
    file?: string;
    description?: string;
  };
  edit: {
    file: string;
    search: string;
    replace: string;
  };
  expectedVerdict: 'should_fail';
}

interface ConversionStats {
  totalFiles: number;
  parsedFiles: number;
  skippedReftest: number;
  skippedManual: number;
  skippedNoAssertions: number;
  totalAssertions: number;
  convertedLeaves: number;
  byTaxClass: Record<string, number>;
  byTaxFamily: Record<string, number>;
  byAssertionFn: Record<string, number>;
  byDomain: Record<string, number>;
  errors: Array<{ file: string; error: string }>;
}

function freshStats(): ConversionStats {
  return {
    totalFiles: 0, parsedFiles: 0, skippedReftest: 0, skippedManual: 0,
    skippedNoAssertions: 0, totalAssertions: 0, convertedLeaves: 0,
    byTaxClass: {}, byTaxFamily: {}, byAssertionFn: {}, byDomain: {}, errors: [],
  };
}

// ---------------------------------------------------------------------------
// CSS Property → Taxonomy Classification (unchanged from v1)
// ---------------------------------------------------------------------------

function classifyProperty(property: string): { taxFamily: string; taxType: string } {
  const p = property.toLowerCase();

  if (/^(color|background-color|border-.*-color|outline-color|text-decoration-color|caret-color|accent-color|fill|stroke|flood-color|lighting-color|stop-color|column-rule-color)$/.test(p))
    return { taxFamily: 'color_normalization', taxType: classifyValue('') };

  if (/^font/.test(p)) {
    if (p === 'font-weight') return { taxFamily: 'keyword_resolution', taxType: 'font_weight' };
    if (p === 'font-size') return { taxFamily: 'unit_equivalence', taxType: 'font_size' };
    if (p === 'font-family') return { taxFamily: 'keyword_resolution', taxType: 'font_family' };
    return { taxFamily: 'keyword_resolution', taxType: p.replace('font-', '') };
  }

  if (/^(margin|padding|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|gap|row-gap|column-gap|inset|block-size|inline-size)/.test(p))
    return { taxFamily: 'unit_equivalence', taxType: p.replace(/-/g, '_') };

  if (/^border/.test(p)) return { taxFamily: 'shorthand_expansion', taxType: 'border' };
  if (/^background/.test(p)) return { taxFamily: 'shorthand_expansion', taxType: 'background' };

  if (/^(flex|align-|justify-|order|place-)/.test(p))
    return { taxFamily: 'keyword_resolution', taxType: 'flexbox' };

  if (/^grid/.test(p)) return { taxFamily: 'keyword_resolution', taxType: 'grid' };

  if (/^(transform|animation|transition|offset|rotate|scale|translate|perspective|motion)/.test(p))
    return { taxFamily: 'function_values', taxType: 'transform' };

  if (/^(display|position|visibility|overflow|overflow-x|overflow-y|float|clear|z-index|opacity|cursor|pointer-events|user-select|resize|isolation|mix-blend-mode|object-fit|object-position|appearance|box-sizing|contain|content-visibility|will-change|all|direction|unicode-bidi|writing-mode|caption-side|empty-cells|table-layout|color-scheme|dynamic-range-limit|position-try|position-try-fallbacks|position-visibility|hanging-punctuation|view-transition-name|zoom)$/.test(p))
    return { taxFamily: 'keyword_resolution', taxType: p.replace(/-/g, '_') };

  if (/^text-/.test(p) || /^(letter-spacing|word-spacing|line-height|white-space|text-align|text-transform|text-indent|vertical-align|word-break|overflow-wrap|hyphens|tab-size|word-wrap)$/.test(p))
    return { taxFamily: 'keyword_resolution', taxType: 'text' };

  if (/^list-/.test(p) || p === 'counter-increment' || p === 'counter-reset' || p === 'counter-set')
    return { taxFamily: 'keyword_resolution', taxType: 'list' };

  if (/^(column-|columns|break-)/.test(p)) return { taxFamily: 'keyword_resolution', taxType: 'multicol' };
  if (/^outline/.test(p)) return { taxFamily: 'shorthand_expansion', taxType: 'outline' };

  if (/^(filter|backdrop-filter|clip-path|clip|mask|mask-|shape-)/.test(p))
    return { taxFamily: 'function_values', taxType: 'filter_mask' };

  if (/^(scroll-|overscroll-)/.test(p)) return { taxFamily: 'keyword_resolution', taxType: 'scroll' };
  if (/^(aspect-ratio|contain-intrinsic-)/.test(p)) return { taxFamily: 'unit_equivalence', taxType: 'sizing' };
  if (p.startsWith('--')) return { taxFamily: 'function_values', taxType: 'custom_property' };
  if (/^(touch-action|scroll-snap-)/.test(p)) return { taxFamily: 'keyword_resolution', taxType: 'interaction' };
  if (/^(box-decoration-break|box-shadow|text-shadow)/.test(p)) return { taxFamily: 'function_values', taxType: 'shadow' };

  if (/^(margin-block|margin-inline|padding-block|padding-inline|border-block|border-inline|inset-block|inset-inline|min-block-size|min-inline-size|max-block-size|max-inline-size)/.test(p))
    return { taxFamily: 'unit_equivalence', taxType: 'logical_properties' };

  if (/^(image-rendering|image-orientation)$/.test(p)) return { taxFamily: 'keyword_resolution', taxType: 'image' };

  return { taxFamily: 'other', taxType: p.replace(/-/g, '_') };
}

function classifyValue(value: string): string {
  if (!value) return 'computed_color';
  const v = value.trim().toLowerCase();
  if (v.startsWith('rgb')) return 'rgb';
  if (v.startsWith('hsl')) return 'hsl';
  if (v.startsWith('#')) return 'hex';
  if (v.startsWith('calc(')) return 'calc';
  if (v.startsWith('min(') || v.startsWith('max(') || v.startsWith('clamp(')) return 'math_function';
  if (v.startsWith('var(')) return 'custom_property';
  if (v.startsWith('color-mix(')) return 'color_mix';
  if (v === 'transparent') return 'transparent';
  if (v === 'currentcolor') return 'currentcolor';
  if (/^-?\d+(\.\d+)?(px|em|rem|%|vw|vh|pt|pc|in|cm|mm|ex|ch|vmin|vmax)$/.test(v)) return 'unit_value';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'unitless';
  if (v === '0' || v === '0px') return 'zero';
  return 'keyword';
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

function isReftest(content: string): boolean {
  return content.includes('rel="match"') || content.includes("rel='match'") ||
         content.includes('rel="mismatch"') || content.includes("rel='mismatch'");
}

function isManual(filepath: string): boolean {
  return filepath.includes('-manual') || filepath.includes('/manual/');
}

function walkDir(dir: string, maxDepth = 10): string[] {
  const results: string[] = [];
  if (maxDepth <= 0) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['support', 'reference', 'resources', 'tools', '.git', 'node_modules'].includes(entry.name)) continue;
        results.push(...walkDir(fullPath, maxDepth - 1));
      } else if (entry.isFile() && /\.(html|htm|js)$/.test(entry.name)) {
        if (/-ref\.(html|htm)$/.test(entry.name)) continue;
        results.push(fullPath);
      }
    }
  } catch { /* permission errors */ }
  return results;
}

function generateWrongValue(property: string, correctValue: string): string {
  const v = correctValue.trim().toLowerCase();
  if (v.startsWith('rgb')) return 'rgb(0, 0, 0)';
  if (v.startsWith('#')) return '#000000';
  if (/^-?\d+(\.\d+)?(px|em|rem|%)$/.test(v)) return '999px';
  if (v === 'block') return 'inline';
  if (v === 'inline') return 'block';
  if (v === 'flex') return 'block';
  if (v === 'grid') return 'block';
  if (v === 'none') return 'block';
  if (v === 'visible') return 'hidden';
  if (v === 'hidden') return 'visible';
  if (v === 'bold' || v === '700') return '400';
  if (v === 'normal' || v === '400') return '700';
  if (v === 'auto') return '0px';
  if (v === 'left') return 'right';
  if (v === 'right') return 'left';
  if (v === 'center') return 'left';
  if (v === 'uppercase') return 'lowercase';
  if (v === 'lowercase') return 'uppercase';
  if (/^-?\d+(\.\d+)?$/.test(v)) return '999';
  return 'WRONG_VALUE_FOR_TEST';
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain 1: CSS (css/)
// ═══════════════════════════════════════════════════════════════════════════

const COMPUTED_RE = /test_computed_value\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/g;
const VALID_RE = /test_valid_value\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/g;

interface RawAssertion {
  fn: string;
  property: string;
  inputValue: string;
  expectedValue?: string;
}

function extractCSSAssertions(content: string): RawAssertion[] {
  const assertions: RawAssertion[] = [];
  let match;

  const computedRe = new RegExp(COMPUTED_RE.source, 'g');
  while ((match = computedRe.exec(content)) !== null) {
    assertions.push({
      fn: 'test_computed_value', property: match[1],
      inputValue: match[2], expectedValue: match[3] || match[2],
    });
  }

  const validRe = new RegExp(VALID_RE.source, 'g');
  while ((match = validRe.exec(content)) !== null) {
    assertions.push({
      fn: 'test_valid_value', property: match[1],
      inputValue: match[2], expectedValue: match[3] || match[2],
    });
  }

  return assertions;
}

function cssAssertionToLeaf(a: RawAssertion, wptFile: string, index: number, wptRoot: string): HarvestedLeaf | null {
  if (!a.expectedValue || a.expectedValue.includes('var(')) return null;

  const relPath = relative(wptRoot, wptFile).replace(/\\/g, '/');
  const { taxFamily, taxType } = classifyProperty(a.property);
  const finalTaxType = taxFamily === 'color_normalization' ? classifyValue(a.expectedValue) : taxType;
  const wrongValue = generateWrongValue(a.property, a.expectedValue);

  return {
    id: `wpt-css-${a.property.replace(/[^a-z0-9]/gi, '_')}-${index}`,
    source: 'wpt',
    taxClass: 'css_value_resolution', taxFamily, taxType: finalTaxType,
    wptFile: relPath,
    assertion: { fn: a.fn, property: a.property, inputValue: a.inputValue, expectedValue: a.expectedValue },
    predicate: { type: 'css', selector: 'body', property: a.property, expected: a.expectedValue },
    edit: { file: 'server.js', search: `${a.property}: ${a.expectedValue};`, replace: `${a.property}: ${wrongValue};` },
    expectedVerdict: 'should_fail',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain 2: HTTP (fetch/, xhr/, cors/)
// ═══════════════════════════════════════════════════════════════════════════

/** Extract assert_equals(response.status, N) patterns */
const HTTP_STATUS_RE = /assert_equals\s*\(\s*\w+\.status\s*,\s*(\d+)/g;
/** Extract assert_equals(response.type, "value") */
const HTTP_TYPE_RE = /assert_equals\s*\(\s*\w+\.type\s*,\s*"([^"]+)"/g;
/** Extract assert_equals(response.headers.get("name"), "value") */
const HTTP_HEADER_RE = /assert_equals\s*\(\s*\w+\.headers\.get\s*\(\s*"([^"]+)"\s*\)\s*,\s*"([^"]+)"/g;
/** Extract test name from test()/promise_test()/async_test() */
const TEST_NAME_RE = /(?:promise_test|async_test|test)\s*\(\s*(?:function\s*\([^)]*\)|[^,]+)\s*,\s*"([^"]+)"/g;

interface HttpAssertion {
  fn: string;
  subject: string;  // 'status' | 'type' | 'header'
  headerName?: string;
  expectedValue: string;
  testName?: string;
}

function extractHTTPAssertions(content: string): HttpAssertion[] {
  const assertions: HttpAssertion[] = [];

  // Extract test names for context
  const testNames: string[] = [];
  let m;
  const nameRe = new RegExp(TEST_NAME_RE.source, 'g');
  while ((m = nameRe.exec(content)) !== null) testNames.push(m[1]);

  // Status codes
  const statusRe = new RegExp(HTTP_STATUS_RE.source, 'g');
  while ((m = statusRe.exec(content)) !== null) {
    assertions.push({
      fn: 'assert_equals', subject: 'status',
      expectedValue: m[1], testName: testNames[0],
    });
  }

  // Response type
  const typeRe = new RegExp(HTTP_TYPE_RE.source, 'g');
  while ((m = typeRe.exec(content)) !== null) {
    assertions.push({
      fn: 'assert_equals', subject: 'type',
      expectedValue: m[1], testName: testNames[0],
    });
  }

  // Headers
  const headerRe = new RegExp(HTTP_HEADER_RE.source, 'g');
  while ((m = headerRe.exec(content)) !== null) {
    assertions.push({
      fn: 'assert_equals', subject: 'header',
      headerName: m[1], expectedValue: m[2], testName: testNames[0],
    });
  }

  return assertions;
}

function classifyHTTPAssertion(a: HttpAssertion): { taxFamily: string; taxType: string } {
  if (a.subject === 'status') {
    const code = parseInt(a.expectedValue);
    if (code >= 200 && code < 300) return { taxFamily: 'status_codes', taxType: 'success' };
    if (code >= 300 && code < 400) return { taxFamily: 'status_codes', taxType: 'redirect' };
    if (code >= 400 && code < 500) return { taxFamily: 'status_codes', taxType: 'client_error' };
    if (code >= 500) return { taxFamily: 'status_codes', taxType: 'server_error' };
    return { taxFamily: 'status_codes', taxType: 'other' };
  }
  if (a.subject === 'type') return { taxFamily: 'response_type', taxType: a.expectedValue };
  if (a.subject === 'header') {
    const h = (a.headerName || '').toLowerCase();
    if (h.includes('content-type')) return { taxFamily: 'content_negotiation', taxType: 'content_type' };
    if (h.includes('cache') || h.includes('etag') || h.includes('last-modified')) return { taxFamily: 'caching', taxType: h };
    if (h.includes('cors') || h.includes('origin') || h.includes('access-control')) return { taxFamily: 'cors', taxType: h };
    if (h.includes('cookie')) return { taxFamily: 'cookies', taxType: 'cookie_header' };
    if (h.includes('accept')) return { taxFamily: 'content_negotiation', taxType: 'accept' };
    if (h.includes('referrer') || h.includes('referer')) return { taxFamily: 'referrer', taxType: 'referrer_header' };
    return { taxFamily: 'headers', taxType: h.replace(/[^a-z0-9]/g, '_') };
  }
  return { taxFamily: 'other', taxType: 'unknown' };
}

function httpAssertionToLeaf(a: HttpAssertion, wptFile: string, index: number, wptRoot: string): HarvestedLeaf | null {
  const relPath = relative(wptRoot, wptFile).replace(/\\/g, '/');
  const { taxFamily, taxType } = classifyHTTPAssertion(a);

  const id = `wpt-http-${a.subject}-${a.expectedValue.replace(/[^a-z0-9]/gi, '_').slice(0, 20)}-${index}`;

  if (a.subject === 'status') {
    const code = parseInt(a.expectedValue);
    return {
      id, source: 'wpt',
      taxClass: 'http_semantics', taxFamily, taxType,
      wptFile: relPath,
      assertion: { fn: a.fn, property: 'response.status', inputValue: '', expectedValue: a.expectedValue },
      predicate: { type: 'http', path: '/', method: 'GET', expect: { status: code } },
      edit: { file: 'server.js', search: `statusCode = ${code}`, replace: `statusCode = 500` },
      expectedVerdict: 'should_fail',
    };
  }

  if (a.subject === 'header') {
    return {
      id, source: 'wpt',
      taxClass: 'http_semantics', taxFamily, taxType,
      wptFile: relPath,
      assertion: { fn: a.fn, property: `response.headers.${a.headerName}`, inputValue: '', expectedValue: a.expectedValue },
      predicate: { type: 'http', path: '/', method: 'GET', expect: { bodyContains: a.expectedValue } },
      edit: { file: 'server.js', search: a.expectedValue, replace: 'WRONG_HEADER_VALUE' },
      expectedVerdict: 'should_fail',
    };
  }

  // Response type — not directly testable via verify's http predicate, skip
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain 3: URL (url/)
// ═══════════════════════════════════════════════════════════════════════════

interface URLTestEntry {
  input: string;
  base?: string;
  href?: string;
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  failure?: boolean;
}

function harvestURLTests(wptDir: string): HarvestedLeaf[] {
  const jsonPath = join(wptDir, 'url', 'resources', 'urltestdata.json');
  if (!existsSync(jsonPath)) return [];

  const data: (string | URLTestEntry)[] = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const leaves: HarvestedLeaf[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const entry of data) {
    if (typeof entry === 'string') continue; // comment
    if (entry.failure) continue;             // expected-to-fail parse
    if (!entry.href) continue;

    // Each URL property becomes a leaf
    const props: Array<[string, string, string]> = [
      ['protocol', entry.protocol || '', 'protocol'],
      ['hostname', entry.hostname || '', 'hostname'],
      ['port', entry.port || '', 'port'],
      ['pathname', entry.pathname || '', 'pathname'],
      ['search', entry.search || '', 'search'],
      ['hash', entry.hash || '', 'hash'],
    ];

    for (const [prop, value, taxType] of props) {
      if (!value) continue;

      const key = `${entry.input}|${prop}|${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      leaves.push({
        id: `wpt-url-${prop}-${index++}`,
        source: 'wpt',
        taxClass: 'url_parsing', taxFamily: 'url_components', taxType,
        wptFile: 'url/resources/urltestdata.json',
        assertion: { fn: 'url_property', property: prop, inputValue: entry.input, expectedValue: value },
        predicate: {
          type: 'content',
          description: `URL("${entry.input.slice(0, 40)}").${prop} == "${value}"`,
          pattern: value,
          file: 'server.js',
        },
        edit: { file: 'server.js', search: value, replace: 'WRONG_URL_COMPONENT' },
        expectedVerdict: 'should_fail',
      });
    }
  }

  return leaves;
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain 4: Encoding (encoding/)
// ═══════════════════════════════════════════════════════════════════════════

/** Extract encoding test patterns from structured data arrays */
const ENCODING_ASSERT_RE = /assert_equals\s*\(\s*(?:new\s+TextDecoder\s*\([^)]*\)\s*\.decode\s*\([^)]*\)|result|decoded|output)\s*,\s*"([^"]+)"/g;

interface EncodingAssertion {
  fn: string;
  encoding?: string;
  expectedValue: string;
}

function extractEncodingAssertions(content: string): EncodingAssertion[] {
  const assertions: EncodingAssertion[] = [];
  let match;

  // Structured data: { encoding: "utf-16le", input: [...], expected: "\uFFFD" }
  const structRe = /{\s*encoding\s*:\s*['"]([^'"]+)['"]\s*,\s*input\s*:\s*\[[^\]]+\]\s*,\s*expected\s*:\s*['"]([^'"]+)['"]/g;
  while ((match = structRe.exec(content)) !== null) {
    assertions.push({
      fn: 'encoding_decode', encoding: match[1], expectedValue: match[2],
    });
  }

  // Direct assert_equals on decode result
  const assertRe = new RegExp(ENCODING_ASSERT_RE.source, 'g');
  while ((match = assertRe.exec(content)) !== null) {
    // Skip very long expected values (binary blobs)
    if (match[1].length > 100) continue;
    assertions.push({
      fn: 'assert_equals_decode', expectedValue: match[1],
    });
  }

  return assertions;
}

function encodingAssertionToLeaf(a: EncodingAssertion, wptFile: string, index: number, wptRoot: string): HarvestedLeaf | null {
  if (!a.expectedValue) return null;
  // Skip unicode escape sequences — they're internal test infrastructure
  if (a.expectedValue.includes('\\u')) return null;

  const relPath = relative(wptRoot, wptFile).replace(/\\/g, '/');
  const encoding = a.encoding || 'utf-8';

  return {
    id: `wpt-enc-${encoding.replace(/[^a-z0-9]/gi, '_')}-${index}`,
    source: 'wpt',
    taxClass: 'encoding', taxFamily: encoding.toLowerCase().replace(/-/g, '_'), taxType: 'decode',
    wptFile: relPath,
    assertion: { fn: a.fn, property: `TextDecoder(${encoding}).decode()`, inputValue: '', expectedValue: a.expectedValue },
    predicate: {
      type: 'content',
      description: `${encoding} decode produces "${a.expectedValue.slice(0, 40)}"`,
      pattern: a.expectedValue,
      file: 'server.js',
    },
    edit: { file: 'server.js', search: a.expectedValue, replace: 'WRONG_ENCODING_OUTPUT' },
    expectedVerdict: 'should_fail',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Domain 5: HTML/DOM (html/, dom/)
// ═══════════════════════════════════════════════════════════════════════════

// DOM regexes — use [\w.\[\]()]+ for variable prefix to match chained access
// (e.g., element.firstChild.tagName, nodes[0].tagName)
/** assert_equals(el.tagName, "DIV") or el.localName, el.nodeName */
const DOM_TAGNAME_RE = /assert_equals\s*\(\s*[\w.\[\]()]+\.(tagName|localName|nodeName)\s*,\s*"([^"]+)"/g;
/** assert_equals(el.getAttribute("name"), "value") */
const DOM_ATTR_RE = /assert_equals\s*\(\s*[\w.\[\]()]+\.getAttribute\s*\(\s*"([^"]+)"\s*\)\s*,\s*"([^"]+)"/g;
/** assert_true(el.hasAttribute("name")) */
const DOM_HAS_ATTR_RE = /assert_true\s*\(\s*[\w.\[\]()]+\.hasAttribute\s*\(\s*"([^"]+)"\s*\)/g;
/** assert_equals(el.textContent, "value") or el.innerHTML, nodeType, etc */
const DOM_CONTENT_RE = /assert_equals\s*\(\s*[\w.\[\]()]+\.(textContent|innerHTML|innerText|value|className|id|nodeType|nodeValue|namespaceURI|prefix|localName)\s*,\s*"([^"]+)"/g;
/** assert_equals(el.nodeType, N) — numeric */
const DOM_NODETYPE_RE = /assert_equals\s*\(\s*[\w.\[\]()]+\.(nodeType|childElementCount|children\.length|childNodes\.length)\s*,\s*(\d+)/g;
/** assert_equals(el.children.length, N) or childNodes.length, childElementCount */
const DOM_COUNT_RE = /assert_equals\s*\(\s*[\w.\[\]()]+\.(children\.length|childNodes\.length|childElementCount)\s*,\s*(\d+)/g;

interface DOMAssertion {
  fn: string;
  subject: string;  // 'tagName' | 'attribute' | 'hasAttribute' | 'content' | 'count'
  property: string;
  expectedValue: string;
}

function extractDOMAssertions(content: string): DOMAssertion[] {
  const assertions: DOMAssertion[] = [];
  let match;

  // Collapse whitespace so multiline assert_equals(el.tagName,\n"DIV") matches
  const collapsed = content.replace(/\s+/g, ' ');

  const tagRe = new RegExp(DOM_TAGNAME_RE.source, 'g');
  while ((match = tagRe.exec(collapsed)) !== null) {
    assertions.push({ fn: 'assert_equals', subject: 'tagName', property: match[1], expectedValue: match[2] });
  }

  const attrRe = new RegExp(DOM_ATTR_RE.source, 'g');
  while ((match = attrRe.exec(collapsed)) !== null) {
    assertions.push({ fn: 'assert_equals', subject: 'attribute', property: match[1], expectedValue: match[2] });
  }

  const hasAttrRe = new RegExp(DOM_HAS_ATTR_RE.source, 'g');
  while ((match = hasAttrRe.exec(collapsed)) !== null) {
    assertions.push({ fn: 'assert_true', subject: 'hasAttribute', property: match[1], expectedValue: 'true' });
  }

  const contentRe = new RegExp(DOM_CONTENT_RE.source, 'g');
  while ((match = contentRe.exec(collapsed)) !== null) {
    if (match[2].length > 200) continue; // skip huge content blobs
    assertions.push({ fn: 'assert_equals', subject: 'content', property: match[1], expectedValue: match[2] });
  }

  // Numeric nodeType assertions (1=Element, 3=Text, 8=Comment, 9=Document, etc.)
  const nodeTypeRe = new RegExp(DOM_NODETYPE_RE.source, 'g');
  while ((match = nodeTypeRe.exec(collapsed)) !== null) {
    assertions.push({ fn: 'assert_equals', subject: 'count', property: match[1], expectedValue: match[2] });
  }

  const countRe = new RegExp(DOM_COUNT_RE.source, 'g');
  while ((match = countRe.exec(collapsed)) !== null) {
    assertions.push({ fn: 'assert_equals', subject: 'count', property: match[1], expectedValue: match[2] });
  }

  return assertions;
}

function classifyDOMAssertion(a: DOMAssertion): { taxFamily: string; taxType: string } {
  if (a.subject === 'tagName') return { taxFamily: 'element_identity', taxType: 'tag_name' };
  if (a.subject === 'attribute') return { taxFamily: 'element_attributes', taxType: a.property };
  if (a.subject === 'hasAttribute') return { taxFamily: 'element_attributes', taxType: 'existence' };
  if (a.subject === 'content') {
    if (a.property === 'className' || a.property === 'id') return { taxFamily: 'element_identity', taxType: a.property };
    if (a.property === 'nodeType' || a.property === 'nodeValue') return { taxFamily: 'dom_structure', taxType: a.property };
    if (a.property === 'namespaceURI' || a.property === 'prefix' || a.property === 'localName') return { taxFamily: 'element_identity', taxType: a.property };
    return { taxFamily: 'text_content', taxType: a.property };
  }
  if (a.subject === 'count') return { taxFamily: 'dom_structure', taxType: a.property === 'nodeType' ? 'node_type' : 'child_count' };
  return { taxFamily: 'other', taxType: 'unknown' };
}

function domAssertionToLeaf(a: DOMAssertion, wptFile: string, index: number, wptRoot: string): HarvestedLeaf | null {
  const relPath = relative(wptRoot, wptFile).replace(/\\/g, '/');
  const { taxFamily, taxType } = classifyDOMAssertion(a);

  const id = `wpt-dom-${a.subject}-${a.expectedValue.replace(/[^a-z0-9]/gi, '_').slice(0, 20)}-${index}`;

  if (a.subject === 'tagName') {
    return {
      id, source: 'wpt',
      taxClass: 'html_structure', taxFamily, taxType,
      wptFile: relPath,
      assertion: { fn: a.fn, property: a.property, inputValue: '', expectedValue: a.expectedValue },
      predicate: { type: 'html', selector: a.expectedValue.toLowerCase(), expected: 'exists' },
      edit: { file: 'server.js', search: `<${a.expectedValue.toLowerCase()}`, replace: `<div` },
      expectedVerdict: 'should_fail',
    };
  }

  if (a.subject === 'content' && (a.property === 'textContent' || a.property === 'innerText' || a.property === 'innerHTML')) {
    return {
      id, source: 'wpt',
      taxClass: 'html_structure', taxFamily, taxType,
      wptFile: relPath,
      assertion: { fn: a.fn, property: a.property, inputValue: '', expectedValue: a.expectedValue },
      predicate: { type: 'content', pattern: a.expectedValue, file: 'server.js' },
      edit: { file: 'server.js', search: a.expectedValue, replace: 'WRONG_CONTENT' },
      expectedVerdict: 'should_fail',
    };
  }

  if (a.subject === 'attribute') {
    return {
      id, source: 'wpt',
      taxClass: 'html_structure', taxFamily, taxType,
      wptFile: relPath,
      assertion: { fn: a.fn, property: a.property, inputValue: '', expectedValue: a.expectedValue },
      predicate: { type: 'html', selector: `[${a.property}="${a.expectedValue}"]`, expected: 'exists' },
      edit: { file: 'server.js', search: `${a.property}="${a.expectedValue}"`, replace: `${a.property}="WRONG"` },
      expectedVerdict: 'should_fail',
    };
  }

  // hasAttribute, count — less directly mappable, skip for now
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Multi-Domain Pipeline
// ═══════════════════════════════════════════════════════════════════════════

interface DomainConfig {
  name: string;
  dirs: string[];
  taxClass: string;
}

const DOMAINS: DomainConfig[] = [
  { name: 'css', dirs: ['css'], taxClass: 'css_value_resolution' },
  { name: 'http', dirs: ['fetch', 'xhr', 'cors'], taxClass: 'http_semantics' },
  { name: 'url', dirs: ['url'], taxClass: 'url_parsing' },
  { name: 'encoding', dirs: ['encoding'], taxClass: 'encoding' },
  { name: 'html', dirs: ['html', 'dom'], taxClass: 'html_structure' },
];

function processDomain(
  domain: DomainConfig,
  wptDir: string,
  stats: ConversionStats,
  globalIndex: { value: number },
  seen: Set<string>,
  limit?: number,
): HarvestedLeaf[] {
  const leaves: HarvestedLeaf[] = [];

  // URL domain uses structured JSON, not file walking
  if (domain.name === 'url') {
    const urlLeaves = harvestURLTests(wptDir);
    for (const leaf of urlLeaves) {
      if (limit && leaves.length >= limit) break;
      const key = `url|${leaf.assertion.inputValue}|${leaf.assertion.property}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leaves.push(leaf);
      stats.convertedLeaves++;
      stats.totalAssertions++;
      stats.byTaxClass[leaf.taxClass] = (stats.byTaxClass[leaf.taxClass] || 0) + 1;
      stats.byTaxFamily[leaf.taxFamily] = (stats.byTaxFamily[leaf.taxFamily] || 0) + 1;
      stats.byAssertionFn['url_property'] = (stats.byAssertionFn['url_property'] || 0) + 1;
      stats.byDomain['url'] = (stats.byDomain['url'] || 0) + 1;
    }
    stats.parsedFiles += 1;
    return leaves;
  }

  // Walk directories for all other domains
  const allFiles: string[] = [];
  for (const dir of domain.dirs) {
    const dirPath = join(wptDir, dir);
    if (!existsSync(dirPath)) continue;
    allFiles.push(...walkDir(dirPath));
  }

  stats.totalFiles += allFiles.length;
  let processed = 0;
  const progressInterval = Math.max(1, Math.floor(allFiles.length / 10));

  for (const file of allFiles) {
    processed++;
    if (processed % progressInterval === 0) {
      process.stderr.write(`    [${domain.name}] ${Math.round(processed / allFiles.length * 100)}% — ${processed}/${allFiles.length} files, ${leaves.length} leaves\n`);
    }
    if (limit && leaves.length >= limit) break;
    if (isManual(file)) { stats.skippedManual++; continue; }

    try {
      const content = readFileSync(file, 'utf-8');
      if (isReftest(content)) { stats.skippedReftest++; continue; }

      let domainLeaves: HarvestedLeaf[] = [];

      if (domain.name === 'css') {
        const assertions = extractCSSAssertions(content);
        if (assertions.length === 0) { stats.skippedNoAssertions++; continue; }
        stats.parsedFiles++;
        stats.totalAssertions += assertions.length;
        for (const a of assertions) {
          const key = `css|${a.property}|${a.inputValue}|${a.expectedValue || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const leaf = cssAssertionToLeaf(a, file, globalIndex.value++, wptDir);
          if (leaf) {
            domainLeaves.push(leaf);
            stats.byAssertionFn[a.fn] = (stats.byAssertionFn[a.fn] || 0) + 1;
          }
        }
      } else if (domain.name === 'http') {
        const assertions = extractHTTPAssertions(content);
        if (assertions.length === 0) { stats.skippedNoAssertions++; continue; }
        stats.parsedFiles++;
        stats.totalAssertions += assertions.length;
        for (const a of assertions) {
          const key = `http|${a.subject}|${a.headerName || ''}|${a.expectedValue}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const leaf = httpAssertionToLeaf(a, file, globalIndex.value++, wptDir);
          if (leaf) {
            domainLeaves.push(leaf);
            stats.byAssertionFn[`http_${a.subject}`] = (stats.byAssertionFn[`http_${a.subject}`] || 0) + 1;
          }
        }
      } else if (domain.name === 'encoding') {
        const assertions = extractEncodingAssertions(content);
        if (assertions.length === 0) { stats.skippedNoAssertions++; continue; }
        stats.parsedFiles++;
        stats.totalAssertions += assertions.length;
        for (const a of assertions) {
          const key = `enc|${a.encoding || ''}|${a.expectedValue}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const leaf = encodingAssertionToLeaf(a, file, globalIndex.value++, wptDir);
          if (leaf) {
            domainLeaves.push(leaf);
            stats.byAssertionFn[a.fn] = (stats.byAssertionFn[a.fn] || 0) + 1;
          }
        }
      } else if (domain.name === 'html') {
        const assertions = extractDOMAssertions(content);
        if (assertions.length === 0) { stats.skippedNoAssertions++; continue; }
        stats.parsedFiles++;
        stats.totalAssertions += assertions.length;
        for (const a of assertions) {
          const key = `dom|${a.subject}|${a.property}|${a.expectedValue}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const leaf = domAssertionToLeaf(a, file, globalIndex.value++, wptDir);
          if (leaf) {
            domainLeaves.push(leaf);
            stats.byAssertionFn[`dom_${a.subject}`] = (stats.byAssertionFn[`dom_${a.subject}`] || 0) + 1;
          }
        }
      }

      for (const leaf of domainLeaves) {
        if (limit && leaves.length >= limit) break;
        leaves.push(leaf);
        stats.convertedLeaves++;
        stats.byTaxClass[leaf.taxClass] = (stats.byTaxClass[leaf.taxClass] || 0) + 1;
        stats.byTaxFamily[leaf.taxFamily] = (stats.byTaxFamily[leaf.taxFamily] || 0) + 1;
        stats.byDomain[domain.name] = (stats.byDomain[domain.name] || 0) + 1;
      }
    } catch (e: any) {
      stats.errors.push({ file: relative(wptDir, file), error: e.message });
    }
  }

  return leaves;
}

function convertWPT(wptDir: string, domainFilter?: string, limit?: number): { leaves: HarvestedLeaf[]; stats: ConversionStats } {
  const stats = freshStats();
  const leaves: HarvestedLeaf[] = [];
  const seen = new Set<string>();
  const globalIndex = { value: 0 };

  const domains = domainFilter
    ? DOMAINS.filter(d => d.name === domainFilter)
    : DOMAINS;

  for (const domain of domains) {
    const hasDir = domain.dirs.some(d => existsSync(join(wptDir, d)));
    if (!hasDir) {
      console.log(`  [${domain.name}] Skipped — directories not found`);
      continue;
    }
    console.log(`  [${domain.name}] Scanning...`);
    const domainLeaves = processDomain(domain, wptDir, stats, globalIndex, seen, limit ? limit - leaves.length : undefined);
    leaves.push(...domainLeaves);
    console.log(`  [${domain.name}] ${domainLeaves.length} leaves`);
    if (limit && leaves.length >= limit) break;
  }

  return { leaves, stats };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printStats(stats: ConversionStats) {
  console.log('\n════════════════════════════════════════════');
  console.log(' WPT Harvest Statistics');
  console.log('════════════════════════════════════════════\n');

  console.log(`  Files scanned:        ${stats.totalFiles}`);
  console.log(`  Files with assertions: ${stats.parsedFiles}`);
  console.log(`  Skipped (reftest):    ${stats.skippedReftest}`);
  console.log(`  Skipped (manual):     ${stats.skippedManual}`);
  console.log(`  Skipped (no asserts): ${stats.skippedNoAssertions}`);
  console.log(`  Parse errors:         ${stats.errors.length}`);
  console.log();
  console.log(`  Total assertions:     ${stats.totalAssertions}`);
  console.log(`  Converted leaves:     ${stats.convertedLeaves}`);
  console.log(`  Dedup savings:        ${stats.totalAssertions - stats.convertedLeaves}`);

  console.log('\n  By domain:');
  for (const [d, c] of Object.entries(stats.byDomain).sort((a, b) => b[1] - a[1]))
    console.log(`    ${d.padEnd(30)} ${String(c).padStart(6)}`);

  console.log('\n  By taxonomy class:');
  for (const [k, c] of Object.entries(stats.byTaxClass).sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(30)} ${String(c).padStart(6)}`);

  console.log('\n  By taxonomy family:');
  for (const [k, c] of Object.entries(stats.byTaxFamily).sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(30)} ${String(c).padStart(6)}`);

  console.log('\n  By assertion function:');
  for (const [fn, c] of Object.entries(stats.byAssertionFn).sort((a, b) => b[1] - a[1]))
    console.log(`    ${fn.padEnd(30)} ${String(c).padStart(6)}`);

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    console.log('\n  Errors:');
    for (const { file, error } of stats.errors)
      console.log(`    ${file}: ${error.slice(0, 80)}`);
  } else if (stats.errors.length > 10) {
    console.log(`\n  ${stats.errors.length} parse errors (use --verbose to see all)`);
  }

  console.log('\n════════════════════════════════════════════\n');
}

function main() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    flags[key] = rest.join('=') || 'true';
  }

  const wptDir = flags['wpt-dir'];
  if (!wptDir) {
    console.log('Usage: bun run scripts/harvest/wpt-converter.ts --wpt-dir=/path/to/wpt [--out=file.json] [--domain=css|http|url|encoding|html] [--limit=N] [--stats]');
    console.log('\nSetup:');
    console.log('  git clone --depth 1 --filter=blob:none --sparse https://github.com/web-platform-tests/wpt.git /tmp/wpt');
    console.log('  cd /tmp/wpt && git sparse-checkout set css fetch xhr cors html dom encoding url');
    console.log('  mkdir /tmp/wpt-local && cd /tmp/wpt && for d in css fetch xhr cors html dom encoding url; do git archive HEAD -- $d | tar -x -C /tmp/wpt-local/; done');
    console.log('\nConvert:');
    console.log('  bun run scripts/harvest/wpt-converter.ts --wpt-dir=/tmp/wpt-local --out=fixtures/wpt-harvest.json');
    console.log('  bun run scripts/harvest/wpt-converter.ts --wpt-dir=/tmp/wpt-local --domain=http --stats');
    process.exit(1);
  }

  const limit = flags['limit'] ? parseInt(flags['limit']) : undefined;
  const outFile = flags['out'];
  const statsOnly = flags['stats'] === 'true';
  const domainFilter = flags['domain'];

  console.log('═══════════════════════════════════════════');
  console.log(' @sovereign-labs/verify — WPT Harvest v2');
  console.log(`  Source: ${wptDir}`);
  if (domainFilter) console.log(`  Domain: ${domainFilter}`);
  if (limit) console.log(`  Limit: ${limit}`);
  if (outFile) console.log(`  Output: ${outFile}`);
  console.log('═══════════════════════════════════════════');

  const { leaves, stats } = convertWPT(wptDir, domainFilter, limit);

  printStats(stats);

  if (statsOnly) {
    console.log('Stats-only mode. No output file written.');
    return;
  }

  if (outFile) {
    writeFileSync(outFile, JSON.stringify(leaves, null, 2));
    console.log(`Wrote ${leaves.length} leaves to ${outFile}`);
    console.log(`File size: ${(statSync(outFile).size / 1024 / 1024).toFixed(1)}MB`);
  } else {
    console.log('Sample leaves (first 3 per domain):');
    const domainSamples: Record<string, number> = {};
    for (const leaf of leaves) {
      const d = leaf.taxClass;
      domainSamples[d] = (domainSamples[d] || 0) + 1;
      if (domainSamples[d] <= 3) {
        console.log(`\n  ${leaf.id}`);
        console.log(`    Tax: ${leaf.taxClass} → ${leaf.taxFamily} → ${leaf.taxType}`);
        console.log(`    WPT: ${leaf.wptFile}`);
        console.log(`    Predicate: [${leaf.predicate.type}] ${leaf.predicate.property || leaf.predicate.path || leaf.predicate.pattern || ''}`);
      }
    }
    console.log('\nUse --out=file.json to write all leaves.');
  }
}

main();
