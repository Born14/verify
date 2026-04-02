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

type A11yCheckType = 'aria_label' | 'alt_text' | 'heading_hierarchy' | 'landmark' | 'color_contrast' | 'focus_management'
  | 'form_labels' | 'link_text' | 'lang_attr' | 'autoplay' | 'skip_nav';

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

      // Skip images with role="presentation" or role="none" (decorative)
      if (/role\s*=\s*["'](presentation|none)["']/i.test(tag)) continue;
      // Skip images with aria-label or aria-labelledby (accessible name provided)
      if (/aria-label\s*=/i.test(tag)) continue;

      if (!tag.includes('alt=') && !tag.includes('alt =')) {
        findings.push({
          check: 'alt_text',
          file: file.relativePath,
          detail: 'Image missing alt attribute',
          severity: 'error',
        });
      } else {
        // Check for empty or whitespace-only alt
        const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
        if (altMatch) {
          const altText = altMatch[1].trim().toLowerCase();
          if (altText === '') {
            findings.push({ check: 'alt_text', file: file.relativePath, detail: 'Image has empty alt attribute', severity: 'warning' });
          } else if (['image', 'picture', 'photo', 'logo'].includes(altText)) {
            findings.push({ check: 'alt_text', file: file.relativePath, detail: `Image has generic alt text: "${altMatch[1]}"`, severity: 'warning' });
          }
        }
      }
    }
  }
  return findings;
}

/**
 * Check heading hierarchy (h1→h2→h3, no skipping) and empty headings.
 */
function checkHeadingHierarchy(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const headingRegex = /<h([1-6])\b/gi;
  // Empty heading: <hN></hN> or <hN>  </hN> or <hN><span style="display:none">...</span></hN>
  const emptyHeadingRegex = /<h([1-6])\b[^>]*>(\s*(<[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[^<]*<\/[^>]+>\s*)*)<\/h\1>/gi;

  for (const file of files) {
    // Check empty headings
    let emptyMatch;
    emptyHeadingRegex.lastIndex = 0;
    while ((emptyMatch = emptyHeadingRegex.exec(file.content)) !== null) {
      const innerContent = emptyMatch[2];
      // Strip HTML tags and check if remaining text is empty
      const textOnly = innerContent.replace(/<[^>]*>/g, '').trim();
      if (textOnly === '') {
        findings.push({
          check: 'heading_hierarchy',
          file: file.relativePath,
          detail: `Empty heading: h${emptyMatch[1]}`,
          severity: 'error',
        });
      }
    }

    // Check headings that contain only visually hidden text (display:none)
    const headingWithHiddenRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let hiddenMatch;
    headingWithHiddenRegex.lastIndex = 0;
    while ((hiddenMatch = headingWithHiddenRegex.exec(file.content)) !== null) {
      const inner = hiddenMatch[2];
      // Skip if already caught by empty heading regex (pure whitespace)
      if (inner.replace(/<[^>]*>/g, '').trim() === '' && !/<[^>]*style/i.test(inner)) continue;
      // Strip elements with display:none, then check if visible text remains
      const withoutHidden = inner.replace(/<[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
      const visibleText = withoutHidden.replace(/<[^>]*>/g, '').trim();
      if (visibleText === '' && /<[^>]*style\s*=\s*["'][^"']*display\s*:\s*none/i.test(inner)) {
        findings.push({
          check: 'heading_hierarchy',
          file: file.relativePath,
          detail: `Empty heading: h${hiddenMatch[1]} (contains only hidden text)`,
          severity: 'error',
        });
      }
    }

    const headings: number[] = [];
    let match;
    // Strip HTML comments to avoid matching headings inside <!-- ... -->
    const contentWithoutComments = file.content.replace(/<!--[\s\S]*?-->/g, '');
    headingRegex.lastIndex = 0;
    while ((match = headingRegex.exec(contentWithoutComments)) !== null) {
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

/**
 * Check for missing form labels.
 */
function checkFormLabels(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const inputRegex = /<input\b[^>]*>/gi;
  for (const file of files) {
    let match;
    inputRegex.lastIndex = 0;
    while ((match = inputRegex.exec(file.content)) !== null) {
      const tag = match[0];
      if (/type\s*=\s*["'](?:hidden|submit|button|reset|image)["']/i.test(tag)) continue;
      if (!tag.includes('aria-label') && !tag.includes('aria-labelledby') && !tag.includes('id=')) {
        findings.push({ check: 'form_labels', file: file.relativePath, detail: 'Input without associated label or aria-label', severity: 'error' });
      } else if (tag.includes('id=')) {
        const idMatch = tag.match(/id\s*=\s*["']([^"']+)["']/);
        if (idMatch) {
          const hasLabel = files.some(f => new RegExp(`for\\s*=\\s*["']${idMatch[1]}["']`).test(f.content));
          if (!hasLabel && !tag.includes('aria-label')) {
            findings.push({ check: 'form_labels', file: file.relativePath, detail: `Input #${idMatch[1]} has no matching <label for="">`, severity: 'warning' });
          }
        }
      }
    }
  }
  return findings;
}

/**
 * Check for non-descriptive link text.
 */
function checkLinkText(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const BAD_TEXTS = ['click here', 'here', 'read more', 'more', 'link', 'this'];
  const linkRegex = /<a\b([^>]*)>(.*?)<\/a>/gi;
  for (const file of files) {
    let match;
    linkRegex.lastIndex = 0;
    while ((match = linkRegex.exec(file.content)) !== null) {
      const attrs = match[1];
      const text = match[2].replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (text === '') {
        // Links with aria-label or aria-labelledby have accessible names despite empty visible text
        const hasAriaLabel = /aria-label\s*=/i.test(attrs);
        if (!hasAriaLabel) {
          findings.push({ check: 'link_text', file: file.relativePath, detail: `Empty link text`, severity: 'error' });
        }
      } else if (BAD_TEXTS.includes(text)) {
        findings.push({ check: 'link_text', file: file.relativePath, detail: `Non-descriptive link text: "${text}"`, severity: 'warning' });
      }
    }
  }
  return findings;
}

/**
 * Check for missing lang attribute on html element.
 */
function checkLangAttr(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const allContent = files.map(f => f.content).join('\n');
  if (/<html\b/i.test(allContent) && !/<html\b[^>]*\blang\s*=/i.test(allContent)) {
    return [{ check: 'lang_attr', file: '(project)', detail: '<html> element missing lang attribute', severity: 'error' }];
  }
  return [];
}

/**
 * Check for auto-playing media.
 */
function checkAutoplay(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  for (const file of files) {
    if (/<(?:video|audio)\b[^>]*\bautoplay\b/i.test(file.content)) {
      findings.push({ check: 'autoplay', file: file.relativePath, detail: 'Auto-playing media without user control', severity: 'warning' });
    }
  }
  return findings;
}

/**
 * Check for skip navigation link.
 */
function checkSkipNav(files: Array<{ relativePath: string; content: string }>): A11yFinding[] {
  const allContent = files.map(f => f.content).join('\n');
  if (/<main\b/i.test(allContent) && !/<a\b[^>]*href\s*=\s*["']#(?:main|content|skip)/i.test(allContent)) {
    return [{ check: 'skip_nav', file: '(project)', detail: 'No skip-to-content navigation link found', severity: 'warning' }];
  }
  return [];
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
    case 'form_labels': return checkFormLabels(files);
    case 'link_text': return checkLinkText(files);
    case 'lang_attr': return checkLangAttr(files);
    case 'autoplay': return checkAutoplay(files);
    case 'skip_nav': return checkSkipNav(files);
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

  // Use staged dir if available (edits applied there), else original appDir
  const scanDir = ctx.stageDir ?? ctx.config.appDir;
  const htmlFiles = readHTMLContent(scanDir);
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
