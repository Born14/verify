/**
 * Accessibility Gate
 * ==================
 *
 * Validates accessibility predicates by scanning HTML source for
 * common a11y patterns and anti-patterns.
 * Pure static analysis — no browser, no screen reader.
 *
 * Predicate type: a11y
 * Check types:
 *   - aria_label: Interactive elements have aria-label/aria-labelledby
 *   - alt_text: Images have alt attributes
 *   - heading_hierarchy: h1→h2→h3 without skipping levels
 *   - landmark: Landmark regions (main, nav, header, footer) present
 *   - color_contrast: (Advisory) CSS color contrast ratios
 *   - focus_management: Interactive elements are keyboard-accessible
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import type { GateContext, GateResult, Predicate, PredicateResult } from '../types.js';

// =============================================================================
// HTML FILE DISCOVERY
// =============================================================================

function readHTMLContent(appDir: string): Array<{ relativePath: string; content: string }> {
  const files: Array<{ relativePath: string; content: string }> = [];
  const HTML_EXTS = new Set(['.html', '.htm', '.ejs', '.hbs', '.jsx', '.tsx', '.js', '.ts']);
  const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.sovereign', '.verify']);

  function scan(dir: string, rel: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, rel ? `${rel}/${entry.name}` : entry.name);
        } else if (HTML_EXTS.has(extname(entry.name).toLowerCase())) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            // Only include files that have HTML-like content
            if (content.includes('<') && (content.includes('</') || content.includes('/>'))) {
              files.push({ relativePath: rel ? `${rel}/${entry.name}` : entry.name, content });
            }
          } catch { /* unreadable */ }
        }
      }
    } catch { /* unreadable dir */ }
  }

  scan(appDir, '');
  return files;
}

// =============================================================================
// A11Y CHECKERS
// =============================================================================

type A11yCheckType = 'aria_label' | 'alt_text' | 'heading_hierarchy' | 'landmark' | 'color_contrast' | 'focus_management';

interface A11yFinding {
  check: A11yCheckType;
  file: string;
  detail: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Check that images have alt attributes.
 */
function checkAltText(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const imgRegex = /<img\b[^>]*>/gi;

  for (const file of files) {
    let match;
    imgRegex.lastIndex = 0;
    while ((match = imgRegex.exec(file.content)) !== null) {
      const tag = match[0];
      if (!tag.includes('alt=') && !tag.includes('alt =')) {
        findings.push({
          check: 'alt_text',
          file: file.relativePath,
          detail: 'Image missing alt attribute',
          severity: 'error',
        });
      }
    }
  }
  return findings;
}

/**
 * Check heading hierarchy (h1→h2→h3, no skipping).
 */
function checkHeadingHierarchy(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const headingRegex = /<h([1-6])\b/gi;

  for (const file of files) {
    const headings: number[] = [];
    let match;
    headingRegex.lastIndex = 0;
    while ((match = headingRegex.exec(file.content)) !== null) {
      headings.push(parseInt(match[1], 10));
    }

    for (let i = 1; i < headings.length; i++) {
      if (headings[i] > headings[i - 1] + 1) {
        findings.push({
          check: 'heading_hierarchy',
          file: file.relativePath,
          detail: `Heading level skipped: h${headings[i - 1]} → h${headings[i]}`,
          severity: 'warning',
        });
      }
    }
  }
  return findings;
}

/**
 * Check for landmark regions.
 */
function checkLandmarks(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const allContent = files.map(f => f.content).join('\n');
  const findings: A11yFinding[] = [];

  const landmarks = [
    { tag: 'main', role: 'role="main"', label: '<main>' },
    { tag: 'nav', role: 'role="navigation"', label: '<nav>' },
  ];

  for (const { tag, role, label } of landmarks) {
    const hasTag = new RegExp(`<${tag}\\b`, 'i').test(allContent);
    const hasRole = allContent.includes(role);
    if (!hasTag && !hasRole) {
      findings.push({
        check: 'landmark',
        file: '(project)',
        detail: `Missing landmark: ${label} or ${role}`,
        severity: 'warning',
      });
    }
  }
  return findings;
}

/**
 * Check interactive elements have aria labels.
 */
function checkAriaLabels(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  // Buttons and links without text content or aria-label
  const buttonRegex = /<button\b[^>]*>(\s*)<\/button>/gi;
  const iconButtonRegex = /<button\b[^>]*>\s*<(?:i|svg|span)\b[^>]*(?:\/>|>.*?<\/(?:i|svg|span)>)\s*<\/button>/gi;

  for (const file of files) {
    let match;

    // Empty buttons
    buttonRegex.lastIndex = 0;
    while ((match = buttonRegex.exec(file.content)) !== null) {
      if (!match[0].includes('aria-label') && !match[0].includes('aria-labelledby')) {
        findings.push({
          check: 'aria_label',
          file: file.relativePath,
          detail: 'Empty button without aria-label',
          severity: 'error',
        });
      }
    }

    // Icon-only buttons
    iconButtonRegex.lastIndex = 0;
    while ((match = iconButtonRegex.exec(file.content)) !== null) {
      if (!match[0].includes('aria-label') && !match[0].includes('aria-labelledby') && !match[0].includes('title=')) {
        findings.push({
          check: 'aria_label',
          file: file.relativePath,
          detail: 'Icon-only button without aria-label',
          severity: 'error',
        });
      }
    }
  }
  return findings;
}

/**
 * Check focus management basics.
 */
function checkFocusManagement(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  for (const file of files) {
    // tabindex > 0 is an anti-pattern
    if (/tabindex\s*=\s*["']?[1-9]/i.test(file.content)) {
      findings.push({
        check: 'focus_management',
        file: file.relativePath,
        detail: 'tabindex > 0 disrupts natural tab order',
        severity: 'warning',
      });
    }
    // outline: none without alternative focus style
    if (/outline\s*:\s*none/i.test(file.content) && !/:focus-visible/i.test(file.content)) {
      findings.push({
        check: 'focus_management',
        file: file.relativePath,
        detail: 'outline: none without :focus-visible alternative',
        severity: 'warning',
      });
    }
  }
  return findings;
}

function runA11yCheck(
  check: A11yCheckType,
  files: Array<{ relativePath: string; content: string }>,
): A11yFinding[] {
  switch (check) {
    case 'alt_text': return checkAltText(files);
    case 'heading_hierarchy': return checkHeadingHierarchy(files);
    case 'landmark': return checkLandmarks(files);
    case 'aria_label': return checkAriaLabels(files);
    case 'focus_management': return checkFocusManagement(files);
    case 'color_contrast': return []; // Requires computed styles — deferred to browser gate
    default: return [];
  }
}

// =============================================================================
// A11Y GATE
// =============================================================================

export function runA11yGate(ctx: GateContext): GateResult & { predicateResults: PredicateResult[] } {
  const start = Date.now();
  const a11yPreds = ctx.predicates.filter(p => p.type === 'a11y');

  if (a11yPreds.length === 0) {
    return {
      gate: 'a11y' as any,
      passed: true,
      detail: 'No a11y predicates to check',
      durationMs: Date.now() - start,
      predicateResults: [],
    };
  }

  const htmlFiles = readHTMLContent(ctx.config.appDir);
  const results: PredicateResult[] = [];
  let allPassed = true;
  const details: string[] = [];

  for (let i = 0; i < a11yPreds.length; i++) {
    const p = a11yPreds[i];
    const result = validateA11yPredicate(p, htmlFiles);
    results.push({ ...result, predicateId: `a11y_p${i}` });

    if (!result.passed) {
      allPassed = false;
      details.push(result.actual ?? 'failed');
    }
  }

  const passCount = results.filter(r => r.passed).length;
  const detail = allPassed
    ? `All ${a11yPreds.length} a11y predicates passed`
    : `${passCount}/${a11yPreds.length} passed: ${details.join('; ')}`;

  ctx.log(`[a11y] ${detail}`);

  return {
    gate: 'a11y' as any,
    passed: allPassed,
    detail,
    durationMs: Date.now() - start,
    predicateResults: results,
  };
}

function validateA11yPredicate(
  p: Predicate,
  files: Array<{ relativePath: string; content: string }>,
): Omit<PredicateResult, 'predicateId'> {
  const check = p.a11yCheck;
  const fingerprint = `type=a11y|check=${check}`;

  if (!check) {
    return { type: 'a11y', passed: false, expected: 'a11y check type', actual: '(no a11yCheck specified)', fingerprint };
  }

  const expected = p.expected ?? 'no_findings';
  const findings = runA11yCheck(check, files);

  if (expected === 'no_findings' || expected === 'clean' || expected === 'pass') {
    const passed = findings.length === 0;
    return {
      type: 'a11y',
      passed,
      expected: `${check}: no findings`,
      actual: passed
        ? `${check}: clean`
        : `${findings.length} finding(s): ${findings.slice(0, 3).map(f => `${f.file}: ${f.detail}`).join('; ')}`,
      fingerprint,
    };
  }

  if (expected === 'has_findings' || expected === 'fail') {
    const passed = findings.length > 0;
    return {
      type: 'a11y',
      passed,
      expected: `${check}: has findings`,
      actual: passed
        ? `${findings.length} finding(s) detected`
        : `${check}: no findings (expected some)`,
      fingerprint,
    };
  }

  return { type: 'a11y', passed: false, expected, actual: `unknown expected value: ${expected}`, fingerprint };
}
