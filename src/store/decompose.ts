/**
 * Failure Decomposition Engine
 * ============================
 *
 * Maps a VerifyResult observation into taxonomy shape IDs from FAILURE-TAXONOMY.md.
 * This is the "reasoning engine" for the failure algebra — it turns the taxonomy
 * from a reference system into an executable classification system.
 *
 * The decomposition follows the 5-step classification algorithm from the taxonomy:
 *   Step 1: Can it decompose into Shape A × Shape B?       → composed failure
 *   Step 2: Can it reduce to existing shape on new data?    → classify under existing
 *   Step 3: Is it a temporal variant of existing shape?      → annotate temporal mode
 *   Step 4: Is it a scope variant of existing shape?         → annotate scope
 *   Step 5: Does it require a new claim↔evidence binding?   → new atomic shape
 *
 * Pure functions, zero side effects, zero LLM calls.
 */

import type { VerifyResult, GateResult, PredicateResult, Predicate } from '../types.js';
import type { FailureKind } from './constraint-store.js';

// =============================================================================
// TYPES
// =============================================================================

export type TemporalMode = 'snapshot' | 'settled' | 'ordered' | 'stable' | 'fresh';

export type ClaimType =
  | 'existence' | 'equality' | 'absence' | 'containment'
  | 'ordering' | 'transformation' | 'invariance' | 'threshold' | 'causal';

export type TruthType = 'deterministic' | 'evaluative' | 'contextual' | 'contractual';

export type OutcomeType =
  | 'pass' | 'fail' | 'partial_success' | 'degraded_correctness'
  | 'misleading_success' | 'honest_uncertainty';

/**
 * A single decomposed failure shape from the taxonomy.
 */
export interface DecomposedShape {
  /** Taxonomy shape ID (e.g., "C-33", "P-07", "X-37") */
  id: string;

  /** Domain the shape belongs to */
  domain: string;

  /** Human-readable name of the failure shape */
  name: string;

  /** What claim type this shape exercises */
  claimType: ClaimType;

  /** What truth type the evidence belongs to */
  truthType: TruthType;

  /** Temporal mode if this is a time-dependent variant */
  temporal?: TemporalMode;

  /** Confidence in this classification (0.0 - 1.0) */
  confidence: number;
}

/**
 * The full decomposition result for one VerifyResult.
 */
export interface DecompositionResult {
  /** Atomic shapes identified (may be single or multiple) */
  shapes: DecomposedShape[];

  /** If composed, the component shape IDs */
  composition?: string[];

  /** Overall outcome classification */
  outcome: OutcomeType;

  /** Which gate failed first (if any) */
  failedGate?: string;

  /** Raw signature from extractSignature (if available) */
  signature?: string;

  /** Whether decomposition fully classified the failure or has unknown components */
  fullyClassified: boolean;
}

// =============================================================================
// SHAPE CATALOG — Maps observable signals to taxonomy shapes
// =============================================================================

/**
 * Shape definition: regex patterns or predicate-type signals that identify this shape.
 */
interface ShapeRule {
  id: string;
  domain: string;
  name: string;
  claimType: ClaimType;
  truthType: TruthType;
  /** Match against gate failure detail text */
  detailPatterns?: RegExp[];
  /** Match against predicate type */
  predicateType?: string;
  /** Match against specific predicate fields */
  predicateMatch?: (p: PredicateResult, pred?: Predicate) => boolean;
  /** Match against overall result structure */
  resultMatch?: (r: VerifyResult) => boolean;
  /** Confidence when matched */
  confidence: number;
}

// ---------------------------------------------------------------------------
// CSS Domain (C-*)
// ---------------------------------------------------------------------------

const CSS_SHAPES: ShapeRule[] = [
  // --- Value normalization (C-01 through C-16, C-44 through C-52) ---
  {
    id: 'C-33', domain: 'css', name: 'CSS value mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && p.actual !== undefined && p.expected !== undefined
      && p.actual !== '(not found)',
    confidence: 0.9,
  },
  {
    id: 'C-01', domain: 'css', name: 'Named color ↔ hex equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isColorMismatch(p.expected, p.actual),
    confidence: 0.85,
  },
  {
    id: 'C-02', domain: 'css', name: 'RGB ↔ hex equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      return (isRgbValue(e) && isHexValue(a)) || (isHexValue(e) && isRgbValue(a));
    },
    confidence: 0.85,
  },
  {
    id: 'C-03', domain: 'css', name: 'HSL ↔ hex/rgb equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      return isHslValue(e) || isHslValue(a);
    },
    confidence: 0.85,
  },
  {
    id: 'C-04', domain: 'css', name: 'RGBA alpha=1 ↔ RGB equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      return /rgba\(.*,\s*1\s*\)/.test(e) || /rgba\(.*,\s*1\s*\)/.test(a);
    },
    confidence: 0.85,
  },
  {
    id: 'C-06', domain: 'css', name: 'Whitespace normalization in CSS values',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (!p.expected || !p.actual || p.passed) return false;
      // Same after collapsing whitespace but different as-written
      return p.expected.replace(/\s+/g, ' ').trim() === p.actual.replace(/\s+/g, ' ').trim()
        && p.expected !== p.actual;
    },
    confidence: 0.85,
  },
  {
    id: 'C-07', domain: 'css', name: 'Case normalization in CSS values',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isCaseMismatch(p.expected, p.actual),
    confidence: 0.85,
  },
  {
    id: 'C-08', domain: 'css', name: 'Zero equivalence (0px → 0)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isZeroMismatch(p.expected, p.actual),
    confidence: 0.9,
  },
  {
    id: 'C-09', domain: 'css', name: 'calc() resolution mismatch',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && (p.expected?.includes('calc(') || p.actual?.includes('calc(')),
    confidence: 0.85,
  },
  {
    id: 'C-10', domain: 'css', name: 'CSS custom property (var()) unresolved',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && (p.expected?.includes('var(') || p.actual?.includes('var(')),
    confidence: 0.85,
  },
  {
    id: 'C-11', domain: 'css', name: 'Unresolvable CSS keyword (auto/inherit/initial)',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p) => {
      const keywords = /^(auto|inherit|initial|unset|revert)$/i;
      return !p.passed && (keywords.test(p.expected ?? '') || keywords.test(p.actual ?? ''));
    },
    confidence: 0.75,
  },
  {
    id: 'C-12', domain: 'css', name: '!important override',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && p.expected?.includes('!important'),
    confidence: 0.8,
  },
  {
    id: 'C-13', domain: 'css', name: 'Relative unit (em) context-dependent',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isRelativeUnitMismatch(p.expected, p.actual, 'em'),
    confidence: 0.7,
  },
  {
    id: 'C-14', domain: 'css', name: 'Percentage value context-dependent',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isRelativeUnitMismatch(p.expected, p.actual, '%'),
    confidence: 0.7,
  },
  {
    id: 'C-15', domain: 'css', name: 'New property not in source CSS',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && !!p.groundingMiss && p.actual === undefined,
    confidence: 0.85,
  },
  {
    id: 'C-44', domain: 'css', name: 'Fractional rounding in CSS values',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isRoundingMismatch(p.expected, p.actual),
    confidence: 0.85,
  },
  {
    id: 'C-45', domain: 'css', name: 'Keyword ↔ numeric equivalence (normal/400, bold/700)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      return isKeywordNumericMismatch(p.expected, p.actual);
    },
    confidence: 0.8,
  },
  {
    id: 'C-49', domain: 'css', name: 'Modern color syntax (space-separated vs legacy)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      const e = p.expected ?? '';
      const a = p.actual ?? '';
      // Space-separated rgb/hsl: rgb(255 0 0 / 1) vs rgb(255,0,0)
      return !p.passed && (/rgb\(\d+\s+\d+/.test(e) || /rgb\(\d+\s+\d+/.test(a)
        || /hsl\(\d+\s+\d+/.test(e) || /hsl\(\d+\s+\d+/.test(a));
    },
    confidence: 0.8,
  },
  {
    id: 'C-52', domain: 'css', name: 'rem depends on root font-size (context-dependent)',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && isRelativeUnitMismatch(p.expected, p.actual, 'rem'),
    confidence: 0.7,
  },
  {
    id: 'C-05', domain: 'css', name: 'HSLA with alpha=1 ↔ HSL equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      return /hsla\(.*,\s*1\s*\)/.test(e) || /hsla\(.*,\s*1\s*\)/.test(a);
    },
    confidence: 0.85,
  },
  {
    id: 'C-16', domain: 'css', name: 'Browser-specific prefix mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const prop = pred?.property?.toLowerCase() ?? '';
      const expected = p.expected?.toLowerCase() ?? '';
      // -webkit-, -moz-, -ms-, -o- prefix on property or value
      return /^-(webkit|moz|ms|o)-/.test(prop)
        || /-(webkit|moz|ms|o)-/.test(expected);
    },
    confidence: 0.8,
  },
  {
    id: 'C-46', domain: 'css', name: 'Font family normalization (quoted vs unquoted)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const prop = pred?.property?.toLowerCase() ?? '';
      if (!prop.includes('font-family') && prop !== 'font') return false;
      const e = p.expected ?? '';
      const a = p.actual ?? '';
      // Quoted vs unquoted: "Arial" vs Arial, 'Helvetica' vs Helvetica
      return e.replace(/['"]/g, '') === a.replace(/['"]/g, '');
    },
    confidence: 0.85,
  },
  {
    id: 'C-47', domain: 'css', name: 'Transform matrix equivalence',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const prop = pred?.property?.toLowerCase() ?? '';
      if (!prop.includes('transform')) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      // translateX(10px) ↔ matrix(1, 0, 0, 1, 10, 0)
      return e.includes('matrix') || a.includes('matrix')
        || e.includes('translate') || a.includes('translate');
    },
    confidence: 0.8,
  },
  {
    id: 'C-48', domain: 'css', name: 'Filter/backdrop-filter normalization',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const prop = pred?.property?.toLowerCase() ?? '';
      return (prop.includes('filter') || prop.includes('backdrop'))
        && p.actual !== undefined && p.actual !== '(not found)';
    },
    confidence: 0.8,
  },
  {
    id: 'C-50', domain: 'css', name: 'CSS variable fallback path',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected?.toLowerCase() ?? '';
      const a = p.actual?.toLowerCase() ?? '';
      // var(--name, fallback) — fallback value used instead of variable
      return /var\(.*,/.test(e) || /var\(.*,/.test(a);
    },
    confidence: 0.8,
  },

  // --- Shorthand resolution (C-17 through C-30) ---
  {
    id: 'C-17', domain: 'css', name: 'Shorthand resolution mismatch',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => !p.passed && pred !== undefined && isShorthandProperty(pred),
    confidence: 0.8,
  },
  {
    id: 'C-18', domain: 'css', name: 'margin → directional components',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed || !pred) return false;
      const prop = pred.property?.toLowerCase() ?? '';
      return prop.startsWith('margin-') && prop !== 'margin';
    },
    confidence: 0.85,
  },
  {
    id: 'C-19', domain: 'css', name: 'padding → directional components',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed || !pred) return false;
      const prop = pred.property?.toLowerCase() ?? '';
      return prop.startsWith('padding-') && prop !== 'padding';
    },
    confidence: 0.85,
  },
  {
    id: 'C-20', domain: 'css', name: 'background → longhand components',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed || !pred) return false;
      const prop = pred.property?.toLowerCase() ?? '';
      return prop.startsWith('background-') && prop !== 'background';
    },
    confidence: 0.85,
  },
  {
    id: 'C-21', domain: 'css', name: 'font → size/weight/family/style components',
    claimType: 'transformation', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed || !pred) return false;
      const prop = pred.property?.toLowerCase() ?? '';
      return prop.startsWith('font-') && prop !== 'font';
    },
    confidence: 0.85,
  },

  // --- Selector & structure (C-32 through C-43) ---
  {
    id: 'C-32', domain: 'css', name: 'Property not in selector source CSS',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => !p.passed && !!p.groundingMiss && !isColorValue(p.expected ?? ''),
    confidence: 0.85,
  },
  {
    id: 'C-34', domain: 'css', name: 'Cross-route selector variance',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      // Route-scoped predicates where same selector has different values per route
      return !p.passed && !!pred?.path && p.actual !== undefined && p.actual !== '(not found)';
    },
    confidence: 0.8,
  },
  {
    id: 'C-35', domain: 'css', name: 'Specificity / cascade conflict',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      // Cascade conflict: both expected and actual exist, but differ (specificity issue)
      return !p.passed && p.actual !== undefined && p.actual !== '(not found)'
        && p.expected !== undefined;
    },
    confidence: 0.6,
  },
  {
    id: 'C-40', domain: 'css', name: 'Inherited vs authored CSS value',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p) => {
      // Grounding misses inherited values — property not authored on the element
      return !p.passed && !!p.groundingMiss;
    },
    confidence: 0.6, // Low confidence — many things cause groundingMiss
  },
  {
    id: 'C-42', domain: 'css', name: 'Multiple style blocks merge failure',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p) => {
      // Multi-block merge: value present but wrong — merge picked wrong block's value
      return !p.passed && p.actual !== undefined && p.actual !== '(not found)';
    },
    confidence: 0.55, // Low — same signal as C-33 but from multi-block merge
  },
  // C-43 (duplicate property cascade) is structurally indistinguishable from C-33
  // at the predicate-result level. It manifests as a value mismatch where
  // the source has duplicates. Detectable only with access to CSS source —
  // handled at scenario level, not decomposition level.

  // --- Selector structure (C-36 through C-38) ---
  {
    id: 'C-36', domain: 'css', name: 'Multi-selector rule (comma-separated)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      // Comma-separated multi-selector: .a, .b { ... }
      return sel.includes(',');
    },
    confidence: 0.75,
  },
  {
    id: 'C-37', domain: 'css', name: 'Selector combinator mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      // Child (>), adjacent (+), general sibling (~) combinators
      return /[>+~]/.test(sel);
    },
    confidence: 0.75,
  },
  {
    id: 'C-38', domain: 'css', name: 'Pseudo-class selector',
    claimType: 'equality', truthType: 'contextual',
    predicateType: 'css',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      // :hover, :focus, :active, :nth-child, ::before, ::after
      return /::?[a-z]/.test(sel) && sel.includes(':');
    },
    confidence: 0.7,
  },
];

// ---------------------------------------------------------------------------
// HTML Domain (H-*)
// ---------------------------------------------------------------------------

const HTML_SHAPES: ShapeRule[] = [
  {
    id: 'H-01', domain: 'html', name: 'HTML element not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && p.actual === '(not found)',
    confidence: 0.9,
  },
  {
    id: 'H-02', domain: 'html', name: 'HTML element exists but wrong content',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && p.actual !== '(not found)' && p.expected !== undefined
      && p.expected !== 'exists',
    confidence: 0.75,
  },
  {
    id: 'H-03', domain: 'html', name: 'Wrong element tag (e.g., h1 vs h2)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && p.actual === '(not found)',
    confidence: 0.7, // Same signal as H-01 but for tag-level mismatch
  },
  // --- Ambiguous / multi-match shapes ---
  {
    id: 'H-04', domain: 'html', name: 'Multiple elements match selector (ambiguous)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    // Generic tag selector (no class/id) with specific expected text — ambiguity risk
    predicateMatch: (p, pred) => {
      if (p.passed || !pred?.selector) return false;
      const sel = pred.selector;
      // Bare tag names without class/id qualifiers are ambiguous when multiple exist
      return /^[a-z]+$/i.test(sel) && p.expected !== 'exists' && p.actual !== '(not found)';
    },
    confidence: 0.7,
  },
  // --- Text content / matching shapes ---
  {
    id: 'H-05', domain: 'html', name: 'Text inside nested/child elements',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'html',
    // Parent element expected to contain child text (nav containing anchor text, etc.)
    predicateMatch: (p, pred) => {
      if (p.passed || !pred?.selector) return false;
      const sel = pred.selector;
      // Container-like selectors (nav, div, section, ul, ol, main, header, footer, article, aside)
      return /^(nav|div|section|ul|ol|main|header|footer|article|aside)$/i.test(sel)
        && p.expected !== 'exists' && p.actual !== '(not found)';
    },
    confidence: 0.7,
  },
  {
    id: 'H-08', domain: 'html', name: 'Whitespace normalization in text content',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    // Expected and actual differ only in whitespace
    predicateMatch: (p) => {
      if (p.passed || !p.expected || !p.actual || p.actual === '(not found)') return false;
      return p.expected.trim() === p.actual.trim() && p.expected !== p.actual;
    },
    confidence: 0.85,
  },
  {
    id: 'H-09', domain: 'html', name: 'HTML entity encoding mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    // Expected or actual contains HTML entities (&amp; &lt; &#39; etc.)
    predicateMatch: (p) => {
      if (p.passed) return false;
      const e = p.expected ?? '';
      const a = p.actual ?? '';
      return /&[a-z]+;|&#\d+;/.test(e) || /&[a-z]+;|&#\d+;/.test(a);
    },
    confidence: 0.85,
  },
  {
    id: 'H-10', domain: 'html', name: 'Case sensitivity mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    // Same text different case
    predicateMatch: (p) => {
      if (p.passed || !p.expected || !p.actual || p.actual === '(not found)') return false;
      return p.expected.toLowerCase() === p.actual.toLowerCase() && p.expected !== p.actual;
    },
    confidence: 0.85,
  },
  {
    id: 'H-13', domain: 'html', name: 'Text spans child elements',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'html',
    // Element contains child tags — text extraction may differ (textContent vs innerText)
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      // Block-level elements that commonly wrap inline children (p, span, td, th, li, dd)
      return /^(p|span|td|th|li|dd|dt|label|figcaption)$/i.test(sel)
        && p.expected !== 'exists' && p.actual !== '(not found)';
    },
    confidence: 0.7,
  },
  // --- Element existence subtypes ---
  {
    id: 'H-06', domain: 'html', name: 'Self-closing / void element existence',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.expected === 'exists'
        && /^(br|hr|img|input|meta|link|source|area|base|col|embed|param|track|wbr)$/i.test(sel);
    },
    confidence: 0.85,
  },
  {
    id: 'H-15', domain: 'html', name: 'Boolean attribute presence',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    // Selector targets elements that commonly carry boolean attributes (input, select, textarea)
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.expected === 'exists'
        && /^(input|select|textarea|button|option)$/i.test(sel);
    },
    confidence: 0.8,
  },
  {
    id: 'H-16', domain: 'html', name: 'Class-based selector existence',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.expected === 'exists' && sel.includes('.');
    },
    confidence: 0.8,
  },
  {
    id: 'H-18', domain: 'html', name: 'Element with URL attribute (anchor/link)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      return /^a\b|^link\b|^img\b|^script\b|^iframe\b/i.test(sel)
        && p.expected !== 'exists';
    },
    confidence: 0.75,
  },
  {
    id: 'H-21', domain: 'html', name: 'Element ordering / first-match dependency',
    claimType: 'ordering', truthType: 'deterministic',
    predicateType: 'html',
    // Bare class or tag selector with specific text — depends on which element matched first
    predicateMatch: (p, pred) => {
      if (p.passed || !p.actual || p.actual === '(not found)') return false;
      const sel = pred?.selector ?? '';
      if (!sel) return false; // Need a selector to reason about ordering
      // Multi-element selector (class, tag) where actual text differs from expected
      return !/[#\[]/.test(sel) && p.expected !== 'exists'
        && p.actual !== p.expected;
    },
    confidence: 0.65,
  },
  {
    id: 'H-22', domain: 'html', name: 'Deeply nested element',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      // Descendant combinator or nesting indicators
      return p.expected === 'exists' && (sel.includes(' ') || sel.includes('>'));
    },
    confidence: 0.75,
  },
  {
    id: 'H-24', domain: 'html', name: 'CSS-hidden element (display:none but exists in source)',
    claimType: 'existence', truthType: 'contextual',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.expected === 'exists' && /hidden|invisible|offscreen|sr-only/i.test(sel);
    },
    confidence: 0.75,
  },
  {
    id: 'H-31', domain: 'html', name: 'Attribute selector (e.g., [selected], [data-*])',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return sel.includes('[') && sel.includes(']');
    },
    confidence: 0.8,
  },
  {
    id: 'H-32', domain: 'html', name: 'Hidden content text extraction',
    claimType: 'containment', truthType: 'contextual',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      return /hidden|invisible/i.test(sel) && p.expected !== 'exists';
    },
    confidence: 0.7,
  },
  {
    id: 'H-34', domain: 'html', name: 'Duplicate ID selector',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return sel.startsWith('#') && p.expected === 'exists';
    },
    confidence: 0.8,
  },
  {
    id: 'H-35', domain: 'html', name: 'Table structure element (thead/tbody/tr/th/td)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return /^(table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)$/i.test(sel);
    },
    confidence: 0.8,
  },
  {
    id: 'H-36', domain: 'html', name: 'Malformed HTML (parser recovery)',
    claimType: 'existence', truthType: 'contextual',
    predicateType: 'html',
    // Element exists but was parsed from malformed source — same signal as successful H-01
    // Only distinguishable when the scenario knows source was malformed; we detect
    // elements that pass despite edits that removed closing tags
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.passed && p.expected === 'exists'
        && /^(footer|div|section|span|p|li|td)$/i.test(sel);
    },
    confidence: 0.5, // Low — cannot definitively detect malformedness from predicate alone
  },
  {
    id: 'H-38', domain: 'html', name: 'Parent-required element (td inside table)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      if (p.passed) return false;
      const sel = pred?.selector ?? '';
      // Elements that require specific parent context
      return /^(td|th|tr|li|dd|dt|option|optgroup|caption|col|colgroup|thead|tbody|tfoot)$/i.test(sel)
        && p.expected !== 'exists';
    },
    confidence: 0.75,
  },
  {
    id: 'H-39', domain: 'html', name: 'Sibling element relationship',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      // Sibling combinator in selector
      return sel.includes('~') || sel.includes('+');
    },
    confidence: 0.75,
  },
  {
    id: 'H-40', domain: 'html', name: 'Semantic HTML element (nav, article, section, aside)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p, pred) => {
      const sel = pred?.selector ?? '';
      return p.expected === 'exists'
        && /^(nav|article|section|aside|main|header|footer|figure|figcaption|details|summary|dialog|mark|time)$/i.test(sel);
    },
    confidence: 0.8,
  },
  {
    id: 'H-17', domain: 'html', name: 'HTML attribute value mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && p.actual !== '(not found)' && p.expected !== 'exists',
    confidence: 0.8,
  },
  {
    id: 'H-20', domain: 'html', name: 'Element count mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && /\d+/.test(p.expected ?? '') && /\d+/.test(p.actual ?? ''),
    confidence: 0.8,
  },
  {
    id: 'H-23', domain: 'html', name: 'Dynamic/JS-rendered element not in static source',
    claimType: 'existence', truthType: 'contextual',
    predicateType: 'html',
    predicateMatch: (p) => !p.passed && !!p.groundingMiss,
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// HTTP/API Domain (P-*)
// ---------------------------------------------------------------------------

const HTTP_SHAPES: ShapeRule[] = [
  // P-01 (HTTP status matches) is a passing scenario — not a failure shape.
  {
    id: 'P-07', domain: 'http', name: 'HTTP status code mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'http',
    predicateMatch: (p) => !p.passed && /status/i.test(p.expected ?? ''),
    confidence: 0.9,
  },
  {
    id: 'P-02', domain: 'http', name: 'HTTP body content missing',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'http',
    predicateMatch: (p) => !p.passed && /body/i.test(p.expected ?? ''),
    confidence: 0.85,
  },
  {
    id: 'P-12', domain: 'http', name: 'HTTP method mismatch (e.g., GET to POST-only)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'http',
    predicateMatch: (p) => !p.passed && /404|405/i.test(p.actual ?? ''),
    confidence: 0.85,
  },
  {
    id: 'P-15', domain: 'http', name: 'Expected redirect but got direct response',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'http',
    predicateMatch: (p) => !p.passed && /30[1-8]/.test(p.expected ?? '') && /200/.test(p.actual ?? ''),
    confidence: 0.85,
  },
  {
    id: 'P-23', domain: 'http', name: 'Error page matched instead of content',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'http',
    predicateMatch: (p) => p.passed && /error|exception|stack|not found/i.test(p.actual ?? ''),
    confidence: 0.7,
  },
  {
    id: 'P-09', domain: 'http', name: 'HTTP sequence step failure',
    claimType: 'ordering', truthType: 'deterministic',
    predicateType: 'http_sequence',
    predicateMatch: (p) => !p.passed,
    confidence: 0.85,
  },
  // P-10 (body interpolation) is a passing scenario — not a failure shape.
];

// ---------------------------------------------------------------------------
// Content Domain (N-*)
// ---------------------------------------------------------------------------

const CONTENT_SHAPES: ShapeRule[] = [
  {
    id: 'N-03', domain: 'content', name: 'Pattern found in comment, not code',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    predicateMatch: (p) => p.passed, // false confidence — matched in comment
    confidence: 0.5, // Low confidence — needs deeper analysis
  },
  {
    id: 'N-04', domain: 'content', name: 'Regex-special characters matched literally',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    predicateMatch: (p) => p.passed && /[.*+?^${}()|[\]\\]/.test(p.expected ?? ''),
    confidence: 0.75,
  },
  {
    id: 'N-05', domain: 'content', name: 'Pattern spans line boundary',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Pattern contains newline — includes() matches across lines
    predicateMatch: (p) => p.passed && /\n/.test(p.expected ?? ''),
    confidence: 0.7,
  },
  {
    id: 'N-06', domain: 'content', name: 'Content pattern not found',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    predicateMatch: (p) => !p.passed,
    confidence: 0.8,
  },
  {
    id: 'N-07', domain: 'content', name: 'Substring false positive',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    predicateMatch: (p) => p.passed, // potential false positive
    confidence: 0.4,
  },
  {
    id: 'N-08', domain: 'content', name: 'Partial substring match (false positive)',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    predicateMatch: (p) => p.passed, // "color" matches "background-color"
    confidence: 0.45,
  },
  {
    id: 'N-09', domain: 'content', name: 'Template expression matched as literal text',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Pattern contains template syntax (${...}, {{...}}, <% %>) matched literally
    predicateMatch: (p) => p.passed && /\$\{|{{|<%/.test(p.expected ?? ''),
    confidence: 0.7,
  },
  {
    id: 'N-10', domain: 'content', name: 'Pattern matches repeated content',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Short common patterns that appear multiple times — includes() returns true
    // but doesn't tell you WHICH occurrence matched
    predicateMatch: (p) => {
      if (!p.passed) return false;
      const pat = p.expected ?? '';
      // Short patterns (<20 chars) that are likely to appear multiple times
      return pat.length > 0 && pat.length < 20;
    },
    confidence: 0.4,
  },
  {
    id: 'N-11', domain: 'content', name: 'Boilerplate/scaffold pattern match',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Common boilerplate patterns that exist in any scaffold — false confidence
    predicateMatch: (p) => {
      if (!p.passed) return false;
      const pat = (p.expected ?? '').toLowerCase();
      return /createserver|require\(|import |module\.exports|listen\(|express\(\)/.test(pat);
    },
    confidence: 0.35,
  },
  {
    id: 'N-12', domain: 'content', name: 'HTML template pattern in source bundle',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Pattern is HTML markup found inside a JS/TS source file (template string)
    predicateMatch: (p) => {
      if (!p.passed) return false;
      const pat = p.expected ?? '';
      return /<[a-z][\s>]/i.test(pat); // HTML tag pattern
    },
    confidence: 0.6,
  },
  {
    id: 'N-26', domain: 'content', name: 'Pattern appears multiple times (ambiguous)',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'content',
    // Generic pass — pattern found, but includes() doesn't report occurrence count
    predicateMatch: (p) => p.passed,
    confidence: 0.3, // Very low — cannot distinguish single vs multiple occurrence
  },
];

// ---------------------------------------------------------------------------
// Database Domain (D-*)
// ---------------------------------------------------------------------------

const DB_SHAPES: ShapeRule[] = [
  // --- Core assertion shapes (D-01 through D-03) ---
  {
    id: 'D-01', domain: 'db', name: 'Table does not exist',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => !p.passed && (pred?.assertion === 'table_exists' || /table/i.test(p.expected ?? '')),
    confidence: 0.9,
  },
  {
    id: 'D-02', domain: 'db', name: 'Column does not exist',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => !p.passed && (pred?.assertion === 'column_exists' || (!pred?.assertion && /column/i.test(p.expected ?? '') && !/type/i.test(p.expected ?? ''))),
    confidence: 0.85,
  },
  {
    id: 'D-03', domain: 'db', name: 'Column type mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => !p.passed && (pred?.assertion === 'column_type' || (!pred?.assertion && /column.*type|type.*mismatch/i.test(p.expected ?? ''))),
    confidence: 0.85,
  },

  // --- Grounding validation shapes (D-04 through D-06) ---
  {
    id: 'D-04', domain: 'db', name: 'Table name case sensitivity',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      if (!pred?.table || pred.assertion !== 'table_exists') return false;
      // Case mismatch: passed (case-insensitive match) but name differs in case
      return p.passed && pred.table !== pred.table.toLowerCase();
    },
    confidence: 0.75,
  },
  {
    id: 'D-05', domain: 'db', name: 'Column name case sensitivity',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      if (!pred?.column || pred.assertion !== 'column_exists') return false;
      return p.passed && pred.column !== pred.column.toLowerCase();
    },
    confidence: 0.75,
  },
  {
    id: 'D-06', domain: 'db', name: 'Type alias normalization',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      if (pred?.assertion !== 'column_type') return false;
      const raw = (pred as any).expected as string | undefined;
      if (!raw) return false;
      // Alias was used (serial, varchar(N), bool, etc.) — normalized to canonical form
      return p.passed && /^(serial|bigserial|smallserial|bool|varchar\(\d+\)|char\(\d+\)|int\b|int4|int8|int2|float4|float8|timestamptz|timetz)/i.test(raw);
    },
    confidence: 0.8,
  },

  // --- Schema constraint shapes (D-07 through D-09) ---
  {
    id: 'D-07', domain: 'db', name: 'Fabricated table reference',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      // Grounding caught a table that doesn't exist in init.sql
      return !p.passed && !!p.groundingMiss && pred?.assertion === 'table_exists';
    },
    confidence: 0.95,
  },
  {
    id: 'D-08', domain: 'db', name: 'Fabricated column reference',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      return !p.passed && !!p.groundingMiss && (pred?.assertion === 'column_exists' || pred?.assertion === 'column_type');
    },
    confidence: 0.95,
  },
  {
    id: 'D-09', domain: 'db', name: 'Type mismatch after normalization',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      // Column found, but type doesn't match even after alias normalization
      return !p.passed && !p.groundingMiss && pred?.assertion === 'column_type';
    },
    confidence: 0.9,
  },

  // --- Data assertion stubs (D-10 through D-12) ---
  {
    id: 'D-10', domain: 'db', name: 'Row count assertion (no live DB)',
    claimType: 'threshold', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      const assertion = pred?.assertion as string | undefined;
      return assertion === 'row_count' || /row.?count/i.test(p.expected ?? '');
    },
    confidence: 0.7,
  },
  {
    id: 'D-11', domain: 'db', name: 'Row value assertion (no live DB)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      const assertion = pred?.assertion as string | undefined;
      return assertion === 'row_value' || /row.?value|field.?value/i.test(p.expected ?? '');
    },
    confidence: 0.7,
  },
  {
    id: 'D-12', domain: 'db', name: 'Constraint exists assertion',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'db',
    predicateMatch: (p, pred) => {
      const assertion = pred?.assertion as string | undefined;
      return assertion === 'constraint_exists' || assertion === 'index_exists' || /constraint|index|unique|foreign/i.test(p.expected ?? '');
    },
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Filesystem Domain (FS-*)
// ---------------------------------------------------------------------------

const FS_SHAPES: ShapeRule[] = [
  {
    id: 'FS-01', domain: 'filesystem', name: 'File not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'filesystem_exists',
    predicateMatch: (p) => !p.passed,
    confidence: 0.95,
  },
  {
    id: 'FS-02', domain: 'filesystem', name: 'File exists when should be absent',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'filesystem_absent',
    predicateMatch: (p) => !p.passed,
    confidence: 0.95,
  },
  {
    id: 'FS-03', domain: 'filesystem', name: 'File changed when should be unchanged',
    claimType: 'invariance', truthType: 'deterministic',
    predicateType: 'filesystem_unchanged',
    predicateMatch: (p) => !p.passed,
    confidence: 0.95,
  },
  {
    id: 'FS-04', domain: 'filesystem', name: 'File count mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'filesystem_count',
    predicateMatch: (p) => !p.passed,
    confidence: 0.95,
  },
  {
    id: 'FS-07', domain: 'filesystem', name: 'Hash drift detected (content changed)',
    claimType: 'invariance', truthType: 'deterministic',
    predicateType: 'filesystem_unchanged',
    predicateMatch: (p) => !p.passed && p.actual !== undefined,
    confidence: 0.9,
  },
  {
    id: 'FS-12', domain: 'filesystem', name: 'Missing file/path field in predicate',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'filesystem_exists',
    predicateMatch: (p, pred) => {
      // Only when the predicate itself lacks a file/path field — structural deficiency
      return !p.passed && pred !== undefined && !pred.file && !pred.path;
    },
    confidence: 0.9,
  },
  {
    id: 'FS-17', domain: 'filesystem', name: 'Extra files detected (count exceeds expected)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'filesystem_count',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const exp = parseInt(p.expected ?? '0');
      const act = parseInt(p.actual ?? '0');
      return !isNaN(exp) && !isNaN(act) && act > exp;
    },
    confidence: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Cross-Cutting: Syntax (X-37..X-41 — F9 Gate)
// ---------------------------------------------------------------------------

const SYNTAX_SHAPES: ShapeRule[] = [
  {
    id: 'X-37', domain: 'cross-cutting', name: 'Search string not found in file',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/search string not found|edit application failed/i],
    confidence: 0.95,
  },
  {
    id: 'X-38', domain: 'cross-cutting', name: 'Search string matches multiple locations',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/matches \d+ locations|ambiguous match|not unique/i],
    confidence: 0.9,
  },
  {
    id: 'X-39', domain: 'cross-cutting', name: 'File does not exist for edit',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/file (does )?not (exist|found)|enoent/i],
    confidence: 0.95,
  },
  {
    id: 'X-40', domain: 'cross-cutting', name: 'Empty search string (degenerate edit)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/empty.*search|search.*empty|ambiguous/i],
    confidence: 0.9,
  },
  {
    id: 'X-41', domain: 'cross-cutting', name: 'Line ending mismatch (LF vs CRLF)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/line ending|crlf|\\r\\n/i],
    confidence: 0.85,
  },
  // Move 7: F9 edge cases
  {
    id: 'X-42', domain: 'cross-cutting', name: 'Edit match inside string literal (not code)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/string literal|matches.*inside|template/i],
    confidence: 0.8,
  },
  {
    id: 'X-43', domain: 'cross-cutting', name: 'Valid syntax but wrong semantics (property mismatch)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      const f9 = r.gates.find(g => g.gate === 'F9');
      const gr = r.gates.find(g => g.gate === 'grounding');
      return (f9?.passed === true) && (gr?.passed === false);
    },
    confidence: 0.8,
  },
  {
    id: 'X-44', domain: 'cross-cutting', name: 'Multi-line search string (spans line boundary)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/multi.line|line boundary|span.*line/i],
    confidence: 0.8,
  },
  {
    id: 'X-45', domain: 'cross-cutting', name: 'Duplicate CSS declaration (same property twice)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/duplicate.*decl|same property twice|last.*wins/i],
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Cross-Cutting: General Edge Cases (X-01..X-35) — Move 10
// ---------------------------------------------------------------------------

const GENERAL_CROSS_CUTTING_SHAPES: ShapeRule[] = [
  {
    id: 'X-01', domain: 'cross-cutting', name: 'Gate order dependency (downstream gate needs upstream data)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      // Grounding gate passed but a downstream gate (goal/verify) fails referencing grounding data
      const grOk = r.gates.some(g => g.gate === 'grounding' && g.passed);
      const downFail = r.gates.some(g => g.gate !== 'grounding' && !g.passed
        && /grounding|selector|property/i.test(g.detail));
      return grOk && downFail;
    },
    confidence: 0.7,
  },
  {
    id: 'X-02', domain: 'cross-cutting', name: 'Narrowing from wrong gate (misattributed hint)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      if (!r.narrowing?.resolutionHint) return false;
      // Hint mentions a gate name that actually passed
      const hint = r.narrowing.resolutionHint.toLowerCase();
      return r.gates.some(g => g.passed && hint.includes(g.gate.toLowerCase()));
    },
    confidence: 0.6,
  },
  {
    id: 'X-05', domain: 'cross-cutting', name: 'Empty predicate list submitted',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      // Fire when predicates are empty, gates exist, all passed, and result has non-trivial content
      // (not just a bare minimum pass with 1 gate)
      return preds.length === 0 && r.gates.length >= 3 && r.gates.every(g => g.passed);
    },
    confidence: 0.85,
  },
  {
    id: 'X-06', domain: 'cross-cutting', name: 'Duplicate predicates submitted (same fingerprint)',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const fps = preds.map(p => p.fingerprint).filter(Boolean);
      return new Set(fps).size < fps.length;
    },
    confidence: 0.8,
  },
  {
    id: 'X-07', domain: 'cross-cutting', name: 'Contradictory predicates (same selector, different expected)',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      // Look for same type+selector but different expected values
      const seen = new Map<string, string>();
      for (const p of preds) {
        const key = `${p.type}|${p.selector ?? ''}|${p.property ?? ''}`;
        if (seen.has(key) && seen.get(key) !== p.expected) return true;
        seen.set(key, p.expected ?? '');
      }
      return false;
    },
    confidence: 0.75,
  },
  {
    id: 'X-10', domain: 'cross-cutting', name: 'Edit targets wrong domain (edit=CSS, predicate=HTML)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      if (r.success) return false;
      const preds = r.predicateResults ?? [];
      const types = new Set(preds.map(p => p.type));
      // Only HTML/content predicates, but gates suggest CSS edits
      return types.has('html') && !types.has('css')
        && r.gates.some(g => g.gate === 'goal' && /css|style/i.test(g.detail));
    },
    confidence: 0.65,
  },
  {
    id: 'X-15', domain: 'cross-cutting', name: 'Constraint bans only valid predicate fingerprint (circular)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => {
      const k5 = r.gates.find(g => g.gate === 'K5' && !g.passed);
      return k5 !== undefined && /predicate_fingerprint/i.test(k5.detail)
        && (r.predicateResults ?? []).length === 1;
    },
    confidence: 0.7,
  },
  {
    id: 'X-20', domain: 'cross-cutting', name: 'All gates pass but narrowing non-empty (advisory warnings)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => {
      return r.success && r.gates.every(g => g.passed)
        && r.narrowing !== undefined && r.narrowing !== null
        && (r.narrowing.resolutionHint !== undefined || (r.narrowing.constraints ?? []).length > 0);
    },
    confidence: 0.6,
  },
  {
    id: 'X-30', domain: 'cross-cutting', name: 'Zero edits with predicates (noop submission)',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      return preds.length > 0
        && r.gates.some(g => g.gate === 'F9' && /no edit|0 edit|empty/i.test(g.detail));
    },
    confidence: 0.8,
  },
  {
    id: 'X-35', domain: 'cross-cutting', name: 'Maximum predicate cap reached (bounded)',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      return preds.length >= 8;
    },
    confidence: 0.65,
  },
  {
    id: 'X-46', domain: 'cross-cutting', name: 'Unicode in edit content (non-ASCII)',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/unicode|non.ascii|utf.?8|emoji|cjk|diacrit/i],
    confidence: 0.75,
  },
  {
    id: 'X-47', domain: 'cross-cutting', name: 'Regex-special characters in edit search string',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/regex|special char|parenthes|bracket/i],
    confidence: 0.75,
  },
];

// ---------------------------------------------------------------------------
// Cross-Cutting: Grounding (X-60..X-67)
// ---------------------------------------------------------------------------

const GROUNDING_SHAPES: ShapeRule[] = [
  {
    id: 'X-60', domain: 'cross-cutting', name: 'CSS selector not in grounding (fabrication)',
    claimType: 'existence', truthType: 'deterministic',
    predicateMatch: (p) => p.groundingMiss === true && p.type === 'css',
    confidence: 0.9,
  },
  {
    id: 'X-61', domain: 'cross-cutting', name: 'DB predicate grounding miss',
    claimType: 'existence', truthType: 'deterministic',
    predicateMatch: (p) => p.groundingMiss === true && p.type === 'db',
    confidence: 0.9,
  },
  // Move 7: Grounding edge cases
  {
    id: 'X-62', domain: 'cross-cutting', name: 'Grounding miss on minified CSS (no whitespace)',
    claimType: 'existence', truthType: 'deterministic',
    predicateMatch: (p) => p.groundingMiss === true && p.type === 'css',
    detailPatterns: [/minif/i],
    confidence: 0.85,
  },
  {
    id: 'X-63', domain: 'cross-cutting', name: 'Grounding miss on inline style (not in <style> block)',
    claimType: 'existence', truthType: 'deterministic',
    predicateMatch: (p) => p.groundingMiss === true && p.type === 'css',
    detailPatterns: [/inline/i],
    confidence: 0.85,
  },
  {
    id: 'X-64', domain: 'cross-cutting', name: 'Grounding miss on dynamic selector (template literal)',
    claimType: 'existence', truthType: 'deterministic',
    predicateMatch: (p) => p.groundingMiss === true && p.type === 'css'
      && /\$\{|\btemplate\b|dynamic/i.test(p.selector ?? ''),
    confidence: 0.8,
  },
  {
    id: 'X-65', domain: 'cross-cutting', name: 'Grounding false positive from CSS-in-JS string',
    claimType: 'existence', truthType: 'deterministic',
    // Only matches CSS predicates that passed despite being in a CSS-in-JS context
    // (detected via grounding gate detail text, not bare predicate type)
    resultMatch: (r) => r.gates.some(g => g.gate === 'grounding'
      && /css.in.js|string literal|fake/i.test(g.detail)),
    confidence: 0.7,
  },
  {
    id: 'X-66', domain: 'cross-cutting', name: 'Grounding parser handles @media/@keyframes blocks',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => r.success && r.predicates?.some(
      (p: any) => p.type === 'css' && /@media|@keyframes|animation/i.test(p.selector ?? ''),
    ),
    confidence: 0.8,
  },
  {
    id: 'X-67', domain: 'cross-cutting', name: 'Grounding sees post-edit state (stale cache)',
    claimType: 'existence', truthType: 'deterministic',
    resultMatch: (r) => !r.success && r.gates.some(g => g.gate === 'grounding' && !g.passed),
    detailPatterns: [/stale|post.edit|removed by.*edit/i],
    confidence: 0.85,
  },
];

// ---------------------------------------------------------------------------
// Cross-Cutting: K5 Constraints (X-51..X-59)
// ---------------------------------------------------------------------------

const K5_SHAPES: ShapeRule[] = [
  {
    id: 'X-51', domain: 'cross-cutting', name: 'K5 constraint violation (forbidden action)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && !g.passed
      && /forbidden_action/i.test(g.detail)),
    confidence: 0.95,
  },
  {
    id: 'X-52', domain: 'cross-cutting', name: 'K5 constraint violation (radius limit)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && !g.passed
      && /radius_limit/i.test(g.detail)),
    confidence: 0.95,
  },
  {
    id: 'X-53', domain: 'cross-cutting', name: 'K5 constraint violation (predicate fingerprint ban)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && !g.passed
      && /predicate_fingerprint/i.test(g.detail)),
    confidence: 0.95,
  },
  {
    id: 'X-54', domain: 'cross-cutting', name: 'K5 constraint violation (goal drift)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && !g.passed
      && /goal_drift/i.test(g.detail)),
    confidence: 0.95,
  },
  // Move 7: K5 edge cases
  {
    id: 'X-55', domain: 'cross-cutting', name: 'K5 expired constraint correctly ignored',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && g.passed),
    confidence: 0.7,
  },
  {
    id: 'X-56', domain: 'cross-cutting', name: 'K5 constraint deadlock (multiple conflicting constraints)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5' && !g.passed
      && /action_class/i.test(g.detail)),
    confidence: 0.9,
  },
  {
    id: 'X-57', domain: 'cross-cutting', name: 'K5 harness fault correctly not seeded',
    claimType: 'invariance', truthType: 'deterministic',
    // Only matches when K5 gate is present and passed (harness correctly didn't seed)
    resultMatch: (r) => r.gates.some(g => g.gate === 'K5') && r.gates.every(g => g.passed),
    detailPatterns: [/harness.*fault|infrastructure.*error|dns.*resolution/i],
    confidence: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Cross-Cutting: Containment (G5)
// ---------------------------------------------------------------------------

const CONTAINMENT_SHAPES: ShapeRule[] = [
  {
    id: 'AT-01', domain: 'attribution', name: 'Unexplained mutation (no predicate trace)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => (r.containment?.unexplained ?? 0) > 0,
    confidence: 0.85,
  },
  {
    id: 'AT-03', domain: 'attribution', name: 'Signature extraction picks first match (compound error)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      // Multiple gate failure patterns present — signature is from first match
      const failedGate = r.gates.find(g => !g.passed);
      if (!failedGate) return false;
      const detail = failedGate.detail;
      let matchCount = 0;
      const patterns = [/syntaxerror/i, /health check/i, /build fail/i, /econnrefused/i];
      for (const p of patterns) {
        if (p.test(detail)) matchCount++;
      }
      return matchCount >= 2;
    },
    confidence: 0.75,
  },
  {
    id: 'AT-04', domain: 'attribution', name: 'First gate failure masks downstream issues',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => {
      // F9 failed with a recognized pattern — only 1-2 gates ran, downstream gates were skipped
      const failedGate = r.gates.find(g => !g.passed);
      if (failedGate?.gate !== 'F9') return false;
      const ranGates = r.gates.filter(g => g.durationMs > 0).length;
      if (ranGates > 2) return false;
      // Must match a known F9 error — not just any unknown failure
      return /search string|ambiguous|not found|enoent|empty/i.test(failedGate.detail);
    },
    confidence: 0.85,
  },
  {
    id: 'AT-05', domain: 'attribution', name: 'Accidental correctness (pass for wrong reason)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => r.success && (r.containment?.unexplained ?? 0) > 0,
    confidence: 0.7,
  },
  // Move 7: G5 edge cases
  {
    id: 'AT-06', domain: 'attribution', name: 'Scaffolding mutation misclassified as unexplained',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => (r.containment?.unexplained ?? 0) > 0
      && (r.containment?.scaffolding ?? 0) === 0,
    confidence: 0.75,
  },
  {
    id: 'AT-07', domain: 'attribution', name: 'Double attribution ambiguity (two predicates match same file)',
    claimType: 'causal', truthType: 'deterministic',
    resultMatch: (r) => (r.containment?.direct ?? 0) >= 2,
    confidence: 0.7,
  },
  {
    id: 'AT-08', domain: 'attribution', name: 'Identity binding false positive (wrong table ID)',
    claimType: 'causal', truthType: 'deterministic',
    detailPatterns: [/identity.*mismatch|wrong.*table|binding.*false/i],
    confidence: 0.7,
  },
  {
    id: 'AT-09', domain: 'attribution', name: 'Surface drift from CSS shorthand expansion',
    claimType: 'causal', truthType: 'deterministic',
    detailPatterns: [/surface.*drift|shorthand.*expand|one property.*three/i],
    confidence: 0.7,
  },
];

// ---------------------------------------------------------------------------
// Staging / Infrastructure shapes
// ---------------------------------------------------------------------------

const STAGING_SHAPES: ShapeRule[] = [
  {
    id: 'I-01', domain: 'interaction', name: 'Build failure in staging',
    claimType: 'causal', truthType: 'deterministic',
    detailPatterns: [/build fail|exit code [1-9]/i],
    confidence: 0.9,
  },
  {
    id: 'I-02', domain: 'interaction', name: 'Container health check failure',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/health check fail|container.*not ready|502/i],
    confidence: 0.85,
  },
  {
    id: 'I-03', domain: 'interaction', name: 'DNS resolution failure in staging',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/getaddrinfo.*(eai_again|enotfound)/i],
    confidence: 0.9,
  },
  {
    id: 'I-04', domain: 'interaction', name: 'Port conflict',
    claimType: 'existence', truthType: 'deterministic',
    detailPatterns: [/eaddrinuse|port.*in use/i],
    confidence: 0.95,
  },
];

// ---------------------------------------------------------------------------
// Composition Interaction shapes (I-05 through I-10)
// Cross-surface failures where two domains fail simultaneously.
// These are the PRODUCT compositions (×) from the failure algebra.
// ---------------------------------------------------------------------------

const COMPOSITION_SHAPES: ShapeRule[] = [
  // CSS × HTTP: color mismatch AND body content mismatch
  {
    id: 'I-05', domain: 'interaction', name: 'CSS × HTTP: style mismatch + body mismatch',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const cssFail = preds.some(p => p.type === 'css' && !p.passed);
      const httpFail = preds.some(p => (p.type === 'http' || p.type === 'http_sequence') && !p.passed);
      return cssFail && httpFail;
    },
    confidence: 0.85,
  },
  // CSS × HTML: color mismatch AND element missing/wrong
  {
    id: 'I-06', domain: 'interaction', name: 'CSS × HTML: style mismatch + element mismatch',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const cssFail = preds.some(p => p.type === 'css' && !p.passed);
      const htmlFail = preds.some(p => p.type === 'html' && !p.passed);
      return cssFail && htmlFail;
    },
    confidence: 0.85,
  },
  // HTML × Content: element missing AND file content missing
  {
    id: 'I-07', domain: 'interaction', name: 'HTML × Content: element mismatch + content missing',
    claimType: 'containment', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const htmlFail = preds.some(p => p.type === 'html' && !p.passed);
      const contentFail = preds.some(p => p.type === 'content' && !p.passed);
      return htmlFail && contentFail;
    },
    confidence: 0.85,
  },
  // HTTP × DB: body mismatch AND table/column missing
  {
    id: 'I-08', domain: 'interaction', name: 'HTTP × DB: body mismatch + schema mismatch',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const httpFail = preds.some(p => (p.type === 'http' || p.type === 'http_sequence') && !p.passed);
      const dbFail = preds.some(p => p.type === 'db' && !p.passed);
      return httpFail && dbFail;
    },
    confidence: 0.85,
  },
  // CSS × Content: style mismatch AND file content missing
  {
    id: 'I-09', domain: 'interaction', name: 'CSS × Content: style mismatch + content missing',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const cssFail = preds.some(p => p.type === 'css' && !p.passed);
      const contentFail = preds.some(p => p.type === 'content' && !p.passed);
      return cssFail && contentFail;
    },
    confidence: 0.85,
  },
  // HTML × HTTP: element missing AND HTTP status/body mismatch
  {
    id: 'I-10', domain: 'interaction', name: 'HTML × HTTP: element mismatch + HTTP mismatch',
    claimType: 'equality', truthType: 'deterministic',
    resultMatch: (r) => {
      const preds = r.predicateResults ?? [];
      const htmlFail = preds.some(p => p.type === 'html' && !p.passed);
      const httpFail = preds.some(p => (p.type === 'http' || p.type === 'http_sequence') && !p.passed);
      return htmlFail && httpFail;
    },
    confidence: 0.85,
  },
];

// ---------------------------------------------------------------------------
// Vision / Triangulation
// ---------------------------------------------------------------------------

const VISION_SHAPES: ShapeRule[] = [
  {
    id: 'V-01', domain: 'vision', name: 'Vision authority disagrees with deterministic',
    claimType: 'equality', truthType: 'evaluative',
    resultMatch: (r) => r.triangulation?.outlier === 'vision'
      && r.triangulation?.action === 'escalate',
    confidence: 0.8,
  },
  {
    id: 'V-02', domain: 'vision', name: 'Deterministic is the outlier (vision + browser agree)',
    claimType: 'equality', truthType: 'evaluative',
    resultMatch: (r) => r.triangulation?.outlier === 'deterministic',
    confidence: 0.8,
  },
  {
    id: 'V-03', domain: 'vision', name: 'Browser is the outlier (deterministic + vision agree)',
    claimType: 'equality', truthType: 'evaluative',
    resultMatch: (r) => r.triangulation?.outlier === 'browser',
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Invariant shapes
// ---------------------------------------------------------------------------

const INVARIANT_SHAPES: ShapeRule[] = [
  {
    id: 'INV-01', domain: 'invariant', name: 'System invariant failed (side effect)',
    claimType: 'invariance', truthType: 'deterministic',
    resultMatch: (r) => r.gates.some(g => g.gate === 'invariants' && !g.passed),
    confidence: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Message gate shapes
// ---------------------------------------------------------------------------

const MESSAGE_SHAPES: ShapeRule[] = [
  {
    id: 'MSG-01', domain: 'message', name: 'Message topic policy violation',
    claimType: 'containment', truthType: 'contractual',
    resultMatch: (r) => r.gates.some(g => g.gate === 'message' as any && !g.passed),
    confidence: 0.85,
  },
];

// ---------------------------------------------------------------------------
// Infrastructure Domain (INFRA-*)
// ---------------------------------------------------------------------------

const INFRA_SHAPES: ShapeRule[] = [
  {
    id: 'INFRA-01', domain: 'infrastructure', name: 'Resource does not exist in state',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'infra_resource',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('not found') ?? false),
    confidence: 0.95,
  },
  {
    id: 'INFRA-02', domain: 'infrastructure', name: 'Resource exists when should be absent',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'infra_resource',
    predicateMatch: (p) => !p.passed && (p.expected?.includes('absent') ?? false),
    confidence: 0.95,
  },
  {
    id: 'INFRA-03', domain: 'infrastructure', name: 'Wrong environment tag',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'infra_attribute',
    predicateMatch: (p) => !p.passed && (p.expected !== p.actual) &&
      ((p.fingerprint ?? '').includes('Environment') || (p.fingerprint ?? '').includes('environment')),
    confidence: 0.9,
  },
  {
    id: 'INFRA-04', domain: 'infrastructure', name: 'Missing deletion protection',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'infra_attribute',
    predicateMatch: (p) => !p.passed &&
      ((p.fingerprint ?? '').includes('deletion_protection') || (p.fingerprint ?? '').includes('delete_protection')),
    confidence: 0.9,
  },
  {
    id: 'INFRA-05', domain: 'infrastructure', name: 'State file drift from manifest',
    claimType: 'invariance', truthType: 'deterministic',
    predicateType: 'infra_manifest',
    predicateMatch: (p) => !p.passed && (p.expected?.includes('matches manifest') ?? false),
    confidence: 0.9,
  },
  {
    id: 'INFRA-06', domain: 'infrastructure', name: 'Bulk destroy scope exceeds intent',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'infra_resource',
    // Matched via result-level check — multiple resource predicates failed
    resultMatch: (r) => {
      const infra = r.predicateResults?.filter(p => p.type === 'infra_resource' && !p.passed) ?? [];
      return infra.length >= 3;
    },
    confidence: 0.85,
  },
  {
    id: 'INFRA-07', domain: 'infrastructure', name: 'Archived/foreign config contamination',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'infra_manifest',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('orphan') ?? false),
    confidence: 0.8,
  },
  {
    id: 'INFRA-08', domain: 'infrastructure', name: 'Resource type mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'infra_attribute',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('attribute=type'),
    confidence: 0.85,
  },
  {
    id: 'INFRA-09', domain: 'infrastructure', name: 'Cross-account resource reference',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'infra_resource',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('not found') ?? false) &&
      ((p.fingerprint ?? '').includes('arn:') || (p.expected ?? '').includes('arn:')),
    confidence: 0.75,
  },
  {
    id: 'INFRA-10', domain: 'infrastructure', name: 'Provider-specific naming mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'infra_attribute',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('attribute=name'),
    confidence: 0.75,
  },
  {
    id: 'INFRA-11', domain: 'infrastructure', name: 'Dependency chain break',
    claimType: 'causal', truthType: 'deterministic',
    predicateType: 'infra_resource',
    // Matched by presence of dependent resources in state that would be orphaned
    predicateMatch: (p) => !p.passed && (p.actual?.includes('dependent') ?? false),
    confidence: 0.8,
  },
  {
    id: 'INFRA-12', domain: 'infrastructure', name: 'State file format/version mismatch',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'infra_resource',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('no state file') ?? false),
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Quality Surface: Serialization (SER-01..SER-06)
// ---------------------------------------------------------------------------

const SER_SHAPES: ShapeRule[] = [
  {
    id: 'SER-01', domain: 'serialization', name: 'JSON parse error',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('parse error') ?? false),
    confidence: 0.95,
  },
  {
    id: 'SER-02', domain: 'serialization', name: 'Schema type mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('type mismatch') ?? false),
    confidence: 0.9,
  },
  {
    id: 'SER-03', domain: 'serialization', name: 'Missing required field',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('missing required') ?? false),
    confidence: 0.9,
  },
  {
    id: 'SER-04', domain: 'serialization', name: 'Value mismatch (strict)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('value mismatch') ?? false),
    confidence: 0.85,
  },
  {
    id: 'SER-05', domain: 'serialization', name: 'Structural mismatch (missing keys)',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('missing key') ?? false),
    confidence: 0.85,
  },
  {
    id: 'SER-06', domain: 'serialization', name: 'File not found for serialization check',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('file not found') ?? false),
    confidence: 0.95,
  },
  // Move 10: Serialization edge cases
  {
    id: 'SER-07', domain: 'serialization', name: 'Deeply nested schema validation failure',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      // Multi-level path in schema validation detail: "foo: bar: type mismatch"
      return (actual.match(/:/g) ?? []).length >= 2;
    },
    confidence: 0.8,
  },
  {
    id: 'SER-08', domain: 'serialization', name: 'Array item schema validation failure',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /items\[/.test(actual);
    },
    confidence: 0.85,
  },
  {
    id: 'SER-09', domain: 'serialization', name: 'JSON parse error (comments or trailing comma)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /parse error/i.test(actual) && /comment|trailing|unexpected/i.test(actual);
    },
    confidence: 0.85,
  },
  {
    id: 'SER-10', domain: 'serialization', name: 'Subset check missing key',
    claimType: 'containment', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /missing key:/i.test(actual);
    },
    confidence: 0.85,
  },
  {
    id: 'SER-11', domain: 'serialization', name: 'Structural comparison type mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /type mismatch: expected (string|number|boolean|object|array)/i.test(actual);
    },
    confidence: 0.85,
  },
  {
    id: 'SER-12', domain: 'serialization', name: 'Schema validation pass',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'serialization',
    predicateMatch: (p) => p.passed && /schema valid/i.test(p.actual ?? ''),
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Quality Surface: Configuration (CFG-01..CFG-04)
// ---------------------------------------------------------------------------

const CONFIG_SHAPES: ShapeRule[] = [
  {
    id: 'CFG-01', domain: 'configuration', name: 'Config key not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('not found') ?? false),
    confidence: 0.95,
  },
  {
    id: 'CFG-02', domain: 'configuration', name: 'Config value mismatch',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => !p.passed && p.expected !== undefined && !p.expected.includes('exists'),
    confidence: 0.85,
  },
  {
    id: 'CFG-03', domain: 'configuration', name: 'No config key specified',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('no key specified') ?? false),
    confidence: 0.9,
  },
  {
    id: 'CFG-04', domain: 'configuration', name: 'Config source not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('not found in') ?? false),
    confidence: 0.85,
  },
  // Move 10: Config edge cases
  {
    id: 'CFG-05', domain: 'configuration', name: 'Nested env var reference (variable interpolation)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /\$\{|\$[A-Z_]/.test(actual);
    },
    confidence: 0.8,
  },
  {
    id: 'CFG-06', domain: 'configuration', name: 'Env var with special characters (quoting issue)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /[@$!#%&*(){}|\\]/.test(actual) && p.expected !== undefined;
    },
    confidence: 0.75,
  },
  {
    id: 'CFG-07', domain: 'configuration', name: 'Deep nested config path (4+ levels)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p, pred) => {
      const key = pred?.key ?? '';
      return (key.split('.').length >= 4);
    },
    confidence: 0.7,
  },
  {
    id: 'CFG-08', domain: 'configuration', name: 'YAML config value (non-JSON source)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p, pred) => {
      const source = pred?.source ?? '';
      return source === 'yaml' || /\.ya?ml/.test(p.actual ?? '');
    },
    confidence: 0.75,
  },
  {
    id: 'CFG-09', domain: 'configuration', name: 'Config value is boolean (type coercion)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /= "(true|false)"/.test(actual);
    },
    confidence: 0.7,
  },
  {
    id: 'CFG-10', domain: 'configuration', name: 'Config value is numeric (type coercion)',
    claimType: 'equality', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => {
      if (p.passed) return false;
      const actual = p.actual ?? '';
      return /= "\d+(\.\d+)?"/.test(actual);
    },
    confidence: 0.7,
  },
  {
    id: 'CFG-11', domain: 'configuration', name: 'Config key exists (pass)',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'config',
    predicateMatch: (p) => p.passed && (p.expected?.includes('exists') ?? false),
    confidence: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Quality Surface: Security (SEC-01..SEC-06)
// ---------------------------------------------------------------------------

const SEC_SHAPES: ShapeRule[] = [
  {
    id: 'SEC-01', domain: 'security', name: 'XSS vulnerability detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=xss'),
    confidence: 0.85,
  },
  {
    id: 'SEC-02', domain: 'security', name: 'SQL injection pattern detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=sql_injection'),
    confidence: 0.85,
  },
  {
    id: 'SEC-03', domain: 'security', name: 'Hardcoded secrets detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=secrets_in_code'),
    confidence: 0.9,
  },
  {
    id: 'SEC-04', domain: 'security', name: 'Missing CSP headers',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=csp'),
    confidence: 0.8,
  },
  {
    id: 'SEC-05', domain: 'security', name: 'CORS wildcard detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=cors'),
    confidence: 0.8,
  },
  {
    id: 'SEC-06', domain: 'security', name: 'Expected security finding not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('no findings (expected some)') ?? false),
    confidence: 0.85,
  },
  // Move 11: Security expansion
  {
    id: 'SEC-07', domain: 'security', name: 'Eval usage detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=eval_usage'),
    confidence: 0.85,
  },
  {
    id: 'SEC-08', domain: 'security', name: 'Prototype pollution pattern detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=prototype_pollution'),
    confidence: 0.85,
  },
  {
    id: 'SEC-09', domain: 'security', name: 'Path traversal in file operations',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=path_traversal'),
    confidence: 0.85,
  },
  {
    id: 'SEC-10', domain: 'security', name: 'Insecure deserialization detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=insecure_deserialization'),
    confidence: 0.8,
  },
  {
    id: 'SEC-11', domain: 'security', name: 'Open redirect vulnerability',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=open_redirect'),
    confidence: 0.8,
  },
  {
    id: 'SEC-12', domain: 'security', name: 'Missing rate limiting on auth endpoint',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'security',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=rate_limiting'),
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Quality Surface: Accessibility (A11Y-01..A11Y-06)
// ---------------------------------------------------------------------------

const A11Y_SHAPES: ShapeRule[] = [
  {
    id: 'A11Y-01', domain: 'accessibility', name: 'Missing alt text on images',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=alt_text'),
    confidence: 0.9,
  },
  {
    id: 'A11Y-02', domain: 'accessibility', name: 'Heading hierarchy skipped',
    claimType: 'ordering', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=heading_hierarchy'),
    confidence: 0.85,
  },
  {
    id: 'A11Y-03', domain: 'accessibility', name: 'Missing landmark regions',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=landmark'),
    confidence: 0.8,
  },
  {
    id: 'A11Y-04', domain: 'accessibility', name: 'Missing aria labels on interactive elements',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=aria_label'),
    confidence: 0.85,
  },
  {
    id: 'A11Y-05', domain: 'accessibility', name: 'Focus management anti-pattern',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=focus_management'),
    confidence: 0.8,
  },
  {
    id: 'A11Y-06', domain: 'accessibility', name: 'Expected a11y finding not found',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('no findings (expected some)') ?? false),
    confidence: 0.85,
  },
  // Move 11: A11y expansion
  {
    id: 'A11Y-07', domain: 'accessibility', name: 'Form input missing label',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=form_labels'),
    confidence: 0.85,
  },
  {
    id: 'A11Y-08', domain: 'accessibility', name: 'Non-descriptive link text',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=link_text'),
    confidence: 0.85,
  },
  {
    id: 'A11Y-09', domain: 'accessibility', name: 'Missing lang attribute on html',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=lang_attr'),
    confidence: 0.9,
  },
  {
    id: 'A11Y-10', domain: 'accessibility', name: 'Auto-playing media without control',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=autoplay'),
    confidence: 0.8,
  },
  {
    id: 'A11Y-11', domain: 'accessibility', name: 'Missing skip navigation link',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'a11y',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=skip_nav'),
    confidence: 0.8,
  },
];

// ---------------------------------------------------------------------------
// Quality Surface: Performance (PERF-01..PERF-05)
// ---------------------------------------------------------------------------

const PERF_SHAPES: ShapeRule[] = [
  {
    id: 'PERF-01', domain: 'performance', name: 'Bundle size exceeds threshold',
    claimType: 'threshold', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=bundle_size'),
    confidence: 0.9,
  },
  {
    id: 'PERF-02', domain: 'performance', name: 'Unoptimized images detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=image_optimization'),
    confidence: 0.85,
  },
  {
    id: 'PERF-03', domain: 'performance', name: 'Missing lazy loading on images',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=lazy_loading'),
    confidence: 0.85,
  },
  {
    id: 'PERF-04', domain: 'performance', name: 'Too many external connections',
    claimType: 'threshold', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=connection_count'),
    confidence: 0.8,
  },
  {
    id: 'PERF-05', domain: 'performance', name: 'Unknown performance check type',
    claimType: 'existence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.actual?.includes('unknown check') ?? false),
    confidence: 0.9,
  },
  // Move 11: Performance expansion
  {
    id: 'PERF-06', domain: 'performance', name: 'Unminified assets detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=unminified_assets'),
    confidence: 0.85,
  },
  {
    id: 'PERF-07', domain: 'performance', name: 'Render-blocking resources in head',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=render_blocking'),
    confidence: 0.85,
  },
  {
    id: 'PERF-08', domain: 'performance', name: 'Excessive DOM depth',
    claimType: 'threshold', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=dom_depth'),
    confidence: 0.8,
  },
  {
    id: 'PERF-09', domain: 'performance', name: 'Missing cache headers on static assets',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=cache_headers'),
    confidence: 0.8,
  },
  {
    id: 'PERF-10', domain: 'performance', name: 'Duplicate dependencies detected',
    claimType: 'absence', truthType: 'deterministic',
    predicateType: 'performance',
    predicateMatch: (p) => !p.passed && (p.fingerprint ?? '').includes('check=duplicate_deps'),
    confidence: 0.85,
  },
];

// =============================================================================
// MASTER CATALOG
// =============================================================================

const ALL_SHAPES: ShapeRule[] = [
  ...CSS_SHAPES,
  ...HTML_SHAPES,
  ...HTTP_SHAPES,
  ...CONTENT_SHAPES,
  ...DB_SHAPES,
  ...FS_SHAPES,
  ...INFRA_SHAPES,
  ...SER_SHAPES,
  ...CONFIG_SHAPES,
  ...SEC_SHAPES,
  ...A11Y_SHAPES,
  ...PERF_SHAPES,
  ...SYNTAX_SHAPES,
  ...GENERAL_CROSS_CUTTING_SHAPES,
  ...GROUNDING_SHAPES,
  ...K5_SHAPES,
  ...CONTAINMENT_SHAPES,
  ...STAGING_SHAPES,
  ...COMPOSITION_SHAPES,
  ...VISION_SHAPES,
  ...INVARIANT_SHAPES,
  ...MESSAGE_SHAPES,
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/** CSS named colors (subset of CSS Color Level 4) */
const CSS_NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey',
  'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred',
  'darksalmon', 'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
  'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
  'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
  'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon',
  'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
  'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred',
  'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod',
  'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru',
  'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown',
  'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat',
  'white', 'whitesmoke', 'yellow', 'yellowgreen', 'transparent', 'currentcolor',
]);

function isColorValue(val: string): boolean {
  const v = val.trim().toLowerCase();
  return CSS_NAMED_COLORS.has(v)
    || /^#[0-9a-f]{3,8}$/i.test(v)
    || /^(rgb|rgba|hsl|hsla)\(/i.test(v);
}

function isColorMismatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  return isColorValue(expected) && isColorValue(actual)
    && expected.trim().toLowerCase() !== actual.trim().toLowerCase();
}

function isCaseMismatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  return expected.toLowerCase() === actual.toLowerCase()
    && expected !== actual;
}

function isZeroMismatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  const zeroPattern = /^0(px|em|rem|%|pt|cm|mm|in|pc|ex|ch|vw|vh|vmin|vmax)?$/i;
  return (zeroPattern.test(expected) || zeroPattern.test(actual))
    && expected !== actual;
}

function isRoundingMismatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  const numE = parseFloat(expected);
  const numA = parseFloat(actual);
  if (isNaN(numE) || isNaN(numA)) return false;
  const diff = Math.abs(numE - numA);
  return diff > 0 && diff < 1; // Close but not exact
}

function isRgbValue(val: string): boolean {
  return /^rgba?\(/.test(val.trim());
}

function isHexValue(val: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(val.trim());
}

function isHslValue(val: string): boolean {
  return /^hsla?\(/.test(val.trim());
}

function isRelativeUnitMismatch(expected?: string, actual?: string, unit?: string): boolean {
  if (!expected || !actual) return false;
  const unitPattern = unit ? new RegExp(`\\d+(\\.\\d+)?${unit}$`, 'i') : null;
  const pxPattern = /\d+(\.\d+)?px$/i;
  if (unitPattern) {
    return (unitPattern.test(expected) && pxPattern.test(actual))
      || (pxPattern.test(expected) && unitPattern.test(actual));
  }
  return false;
}

function isKeywordNumericMismatch(expected?: string, actual?: string): boolean {
  if (!expected || !actual) return false;
  const keywordMap: Record<string, string> = {
    'normal': '400', 'bold': '700', 'lighter': '100', 'bolder': '900',
  };
  const e = expected.trim().toLowerCase();
  const a = actual.trim().toLowerCase();
  return (keywordMap[e] === a) || (keywordMap[a] === e);
}

function isShorthandProperty(pred: Predicate): boolean {
  const shorthandProps = [
    'margin', 'padding', 'border', 'background', 'font', 'flex', 'grid',
    'outline', 'animation', 'transition', 'overflow', 'gap',
  ];
  const prop = pred.property?.toLowerCase() ?? '';
  return shorthandProps.some(s => prop.startsWith(s) && prop !== s);
}

// =============================================================================
// DECOMPOSITION ENGINE
// =============================================================================

/**
 * Decompose a VerifyResult into taxonomy shape IDs.
 *
 * This is the core function — it maps an observation to the failure algebra.
 *
 * @param result - The VerifyResult from verify()
 * @param predicates - The original predicates (for deeper analysis)
 * @returns DecompositionResult with identified shapes and outcome classification
 */
export function decomposeFailure(
  result: VerifyResult,
  predicates?: Predicate[],
): DecompositionResult {
  const shapes: DecomposedShape[] = [];
  const failedGate = result.gates.find(g => !g.passed);

  // Step 1: Classify outcome
  const outcome = classifyOutcome(result);

  // Step 2: Match gate-level failures (detail text patterns)
  if (failedGate) {
    for (const rule of ALL_SHAPES) {
      if (!rule.detailPatterns) continue;
      for (const pattern of rule.detailPatterns) {
        if (pattern.test(failedGate.detail)) {
          shapes.push(ruleToShape(rule));
        }
      }
    }
  }

  // Step 3: Match result-level patterns (structural checks)
  for (const rule of ALL_SHAPES) {
    if (!rule.resultMatch) continue;
    if (rule.resultMatch(result)) {
      if (!shapes.some(s => s.id === rule.id)) {
        shapes.push(ruleToShape(rule));
      }
    }
  }

  // Step 4: Match per-predicate failures
  if (result.predicateResults) {
    const predMap = buildPredicateMap(predicates);

    for (const pr of result.predicateResults) {
      const sourcePred = predMap.get(pr.predicateId);
      for (const rule of ALL_SHAPES) {
        if (!rule.predicateMatch) continue;
        // Filter by predicate type if rule specifies one
        if (rule.predicateType && rule.predicateType !== pr.type) continue;
        if (rule.predicateMatch(pr, sourcePred)) {
          if (!shapes.some(s => s.id === rule.id)) {
            shapes.push(ruleToShape(rule));
          }
        }
      }
    }
  }

  // Step 5: Check for grounding-miss shapes (cross-cutting)
  if (result.effectivePredicates) {
    for (const ep of result.effectivePredicates) {
      if (ep.groundingMiss) {
        for (const rule of GROUNDING_SHAPES) {
          if (rule.predicateMatch && rule.predicateMatch(
            { predicateId: ep.id, type: ep.type, passed: false, fingerprint: ep.fingerprint, groundingMiss: true },
          )) {
            if (!shapes.some(s => s.id === rule.id)) {
              shapes.push(ruleToShape(rule));
            }
          }
        }
      }
    }
  }

  // Step 6: Minimize — remove dominated and redundant shapes
  let minimized = minimizeShapes(shapes);

  // Step 7: Annotate temporal mode from failure context
  const temporalContext = {
    error: failedGate?.detail,
    gateDetail: failedGate?.detail,
  };
  minimized = annotateTemporalMode(minimized, temporalContext);

  // Step 8: Detect compositions — multiple shapes from different domains
  const composition = detectComposition(minimized);

  // Step 9: Deterministic sort
  const sorted = sortShapes(minimized);

  // Determine if fully classified (all failures mapped to at least one shape)
  const fullyClassified = result.success || sorted.length > 0;

  return {
    shapes: sorted,
    composition: composition.length > 0 ? composition : undefined,
    outcome,
    failedGate: failedGate?.gate,
    signature: extractSignatureFromResult(result),
    fullyClassified,
  };
}

/**
 * Decompose a raw failure observation (not from VerifyResult) into shapes.
 *
 * Useful for classifying failures from error strings, gate details, etc.
 */
export function decomposeObservation(observation: {
  error?: string;
  gate?: string;
  predicateType?: string;
  predicateExpected?: string;
  predicateActual?: string;
  groundingMiss?: boolean;
}): DecomposedShape[] {
  const shapes: DecomposedShape[] = [];

  // Match by error text
  if (observation.error) {
    for (const rule of ALL_SHAPES) {
      if (!rule.detailPatterns) continue;
      for (const pattern of rule.detailPatterns) {
        if (pattern.test(observation.error)) {
          shapes.push(ruleToShape(rule));
        }
      }
    }
  }

  // Match by predicate fields
  if (observation.predicateType) {
    const pr: PredicateResult = {
      predicateId: 'obs',
      type: observation.predicateType,
      passed: false,
      expected: observation.predicateExpected,
      actual: observation.predicateActual,
      fingerprint: '',
      groundingMiss: observation.groundingMiss,
    };

    for (const rule of ALL_SHAPES) {
      if (!rule.predicateMatch) continue;
      if (rule.predicateType && rule.predicateType !== observation.predicateType) continue;
      if (rule.predicateMatch(pr)) {
        if (!shapes.some(s => s.id === rule.id)) {
          shapes.push(ruleToShape(rule));
        }
      }
    }
  }

  // Minimize and annotate temporal mode
  let minimized = minimizeShapes(shapes);
  minimized = annotateTemporalMode(minimized, { error: observation.error });
  return sortShapes(minimized);
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function ruleToShape(rule: ShapeRule): DecomposedShape {
  return {
    id: rule.id,
    domain: rule.domain,
    name: rule.name,
    claimType: rule.claimType,
    truthType: rule.truthType,
    confidence: rule.confidence,
  };
}

function buildPredicateMap(predicates?: Predicate[]): Map<string, Predicate> {
  const map = new Map<string, Predicate>();
  if (!predicates) return map;
  for (let i = 0; i < predicates.length; i++) {
    map.set(`p${i + 1}`, predicates[i]);
  }
  return map;
}

function classifyOutcome(result: VerifyResult): OutcomeType {
  if (result.success) {
    // Check for misleading success indicators
    if (result.containment && result.containment.unexplained > 0) {
      return 'misleading_success'; // Passed but with unexplained mutations
    }
    if (result.triangulation?.action === 'escalate') {
      return 'partial_success'; // Authorities disagree
    }
    return 'pass';
  }

  // Check for honest uncertainty (gates didn't run)
  const ranGates = result.gates.filter(g => g.durationMs > 0);
  if (ranGates.length === 0) return 'honest_uncertainty';

  // Check for degraded correctness (some predicates passed, some failed)
  if (result.predicateResults) {
    const passed = result.predicateResults.filter(p => p.passed).length;
    const failed = result.predicateResults.filter(p => !p.passed).length;
    if (passed > 0 && failed > 0) return 'partial_success';
  }

  return 'fail';
}

function detectComposition(shapes: DecomposedShape[]): string[] {
  const domains = new Set(shapes.map(s => s.domain));
  // A composition exists when shapes span 2+ domains
  if (domains.size >= 2) {
    return shapes.map(s => s.id);
  }
  return [];
}

function extractSignatureFromResult(result: VerifyResult): string | undefined {
  if (result.success) return undefined;
  const failedGate = result.gates.find(g => !g.passed);
  if (!failedGate) return undefined;

  // Re-use the signature patterns from constraint-store
  const error = failedGate.detail;
  const signatures: [RegExp, string][] = [
    [/search string not found|edit application failed/i, 'edit_not_applicable'],
    [/browser gate failed/i, 'browser_gate_failed'],
    [/getaddrinfo.*(eai_again|enotfound)/i, 'dns_resolution_failed'],
    [/timeout|exceeded time/i, 'migration_timeout'],
    [/eaddrinuse|port.*in use/i, 'port_conflict'],
    [/syntaxerror|unexpected token|unterminated string/i, 'syntax_error'],
    [/cannot find module/i, 'missing_module'],
    [/build fail|exit code [1-9]/i, 'build_failure'],
    [/health check fail|502/i, 'health_check_failure'],
    [/econnrefused/i, 'connection_refused'],
    [/out of memory|oom/i, 'oom_killed'],
    [/element not found in dom/i, 'selector_not_found'],
    [/actual vs expected|value mismatch/i, 'css_value_mismatch'],
    [/predicate.*failed|evidence failed/i, 'predicate_mismatch'],
  ];

  for (const [regex, sig] of signatures) {
    if (regex.test(error)) return sig;
  }
  return undefined;
}

// =============================================================================
// 2.1 — MINIMAL BASIS ENFORCEMENT
// =============================================================================

/**
 * Specificity ranking for domains.
 * Lower = more specific = preferred over generic.
 */
const DOMAIN_SPECIFICITY: Record<string, number> = {
  css: 1, html: 1, http: 1, db: 1, filesystem: 1, content: 1,
  vision: 2, attribution: 2, invariant: 2, interaction: 2, message: 2,
  'cross-cutting': 3,
};

/**
 * Dominance rules: if both shapes match, the dominant one subsumes the other.
 * Maps dominated shape → set of shapes that dominate it.
 */
const DOMINANCE: Record<string, string[]> = {
  // Specific CSS shapes dominate generic CSS value mismatch
  'C-33': ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10',
    'C-11', 'C-12', 'C-13', 'C-14', 'C-16', 'C-44', 'C-45', 'C-46', 'C-47', 'C-48',
    'C-49', 'C-50', 'C-52', 'C-17', 'C-18', 'C-19', 'C-20', 'C-21'],
  // Specific shorthand shapes dominate generic C-17 shorthand mismatch
  'C-17': ['C-18', 'C-19', 'C-20', 'C-21'],
  // Generic CSS groundingMiss shapes — C-32 (property miss) and C-40 (inherited) are
  // more specific than C-15 (new property)
  'C-15': ['C-32', 'C-40'],
  // C-35 (specificity) and C-42 (multi-block merge) are dominated by C-33
  // because they're structurally indistinguishable from generic value mismatch
  'C-35': ['C-33'],
  'C-42': ['C-33'],
  // Generic HTML element not found — H-03 (wrong tag) is same signal, H-01 dominates
  // Specific HTML shapes dominate generic H-01 (not found) and H-02 (wrong content)
  'H-01': ['H-06', 'H-15', 'H-16', 'H-22', 'H-24', 'H-31', 'H-34', 'H-35', 'H-40'],
  'H-02': ['H-04', 'H-05', 'H-08', 'H-09', 'H-10', 'H-13', 'H-18', 'H-21', 'H-32', 'H-38'],
  'H-03': ['H-01'],
  // Generic HTTP body missing is dominated by error page match
  'P-02': ['P-23'],
  // Generic content not found is dominated by comment match / false positive
  'N-06': ['N-03', 'N-07', 'N-08'],
  // N-07 and N-08 are both "false positive" variants — N-08 is more specific
  'N-07': ['N-04', 'N-05', 'N-08', 'N-09', 'N-10', 'N-11', 'N-12'],
  // N-26 (generic pass, ambiguous) dominated by all specific pass shapes
  'N-26': ['N-03', 'N-04', 'N-05', 'N-07', 'N-08', 'N-09', 'N-10', 'N-11', 'N-12'],
  // N-10 (repeated content) dominated by boilerplate/bundle match
  'N-10': ['N-11', 'N-12'],
  // FS-03 (file changed) dominated by FS-07 (hash drift) when both match
  'FS-03': ['FS-07'],
  // FS-04 (count mismatch) dominated by FS-17 (extra files) when direction is known
  'FS-04': ['FS-17'],
  // Config: generic CFG-01 (not found) dominated by deep path / yaml source specifics
  'CFG-01': ['CFG-07'],
  // Config: generic CFG-02 (value mismatch) dominated by boolean/numeric/special-char specifics
  'CFG-02': ['CFG-05', 'CFG-06', 'CFG-09', 'CFG-10'],
  // Serialization: generic SER-02 (type mismatch) dominated by deep/array specifics
  'SER-02': ['SER-07', 'SER-11'],
  'SER-01': ['SER-09'],
  // Serialization: generic SER-05 (missing keys) dominated by subset missing key
  'SER-05': ['SER-10'],
  // Cross-cutting: X-05 (empty predicates) dominates X-30 (zero edits with predicates)
  // since empty predicates is a more fundamental issue
  'X-55': ['X-57'],
};

/**
 * Remove dominated shapes from the set.
 *
 * Rules:
 *   1. Remove exact duplicates
 *   2. Remove dominated shapes (prefer specific over generic)
 *   3. Remove cross-cutting shapes when a surface-specific shape explains the same failure
 *   4. Prefer the smallest sufficient explanation
 */
export function minimizeShapes(shapes: DecomposedShape[]): DecomposedShape[] {
  if (shapes.length <= 1) return shapes;

  // Step 1: Deduplicate by ID
  const seen = new Set<string>();
  let unique = shapes.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Step 2: Remove dominated shapes
  const ids = new Set(unique.map(s => s.id));
  unique = unique.filter(s => {
    const dominators = DOMINANCE[s.id];
    if (!dominators) return true;
    // If any dominator is present, this shape is subsumed
    return !dominators.some(d => ids.has(d));
  });

  // Step 3: Remove cross-cutting when surface-specific covers it
  const hasSurfaceSpecific = unique.some(s => (DOMAIN_SPECIFICITY[s.domain] ?? 3) === 1);
  if (hasSurfaceSpecific) {
    const crossCuttingCount = unique.filter(s => s.domain === 'cross-cutting').length;
    const surfaceCount = unique.length - crossCuttingCount;
    // Only remove cross-cutting if surface shapes fully explain the failure
    if (surfaceCount > 0 && crossCuttingCount > 0) {
      // Keep cross-cutting shapes that are gate-specific (K5, F9, grounding) — always keep
      unique = unique.filter(s =>
        s.domain !== 'cross-cutting'
        || s.id.startsWith('X-5')  // K5 constraints — always relevant
        || s.id.startsWith('X-6')  // Grounding — always relevant
      );
    }
  }

  return unique;
}

// =============================================================================
// 2.2 — DETERMINISTIC SORT
// =============================================================================

/**
 * Sort shapes in deterministic order.
 *
 * Ordering:
 *   1. Primary surfaces (css, html, http, db, filesystem, content) first
 *   2. Then modifiers (vision, attribution, invariant, interaction, message)
 *   3. Then cross-cutting last
 *   4. Within same priority: by specificity (confidence descending)
 *   5. Final tiebreaker: lexicographic on ID (deterministic)
 */
export function sortShapes(shapes: DecomposedShape[]): DecomposedShape[] {
  return [...shapes].sort((a, b) => {
    const specA = DOMAIN_SPECIFICITY[a.domain] ?? 3;
    const specB = DOMAIN_SPECIFICITY[b.domain] ?? 3;
    if (specA !== specB) return specA - specB;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.id.localeCompare(b.id);
  });
}

// =============================================================================
// 2.5 — DECOMPOSITION SCORING
// =============================================================================

/**
 * Score a decomposition for quality.
 *
 * Higher score = better explanation:
 *   - Fewer shapes = higher score (parsimony)
 *   - Fewer domains = higher score (locality)
 *   - Surface-specific > cross-cutting (precision)
 *   - Higher confidence shapes = higher score
 *   - No redundancy bonus
 *
 * Returns 0.0 - 1.0
 */
export function scoreDecomposition(shapes: DecomposedShape[]): number {
  if (shapes.length === 0) return 0;

  // Parsimony: 1 shape = 1.0, diminishing for each additional shape
  const parsimony = 1 / shapes.length;

  // Locality: penalize for crossing domains
  const domains = new Set(shapes.map(s => s.domain));
  const locality = 1 / domains.size;

  // Precision: ratio of surface-specific to total
  const surfaceSpecific = shapes.filter(s => (DOMAIN_SPECIFICITY[s.domain] ?? 3) === 1).length;
  const precision = shapes.length > 0 ? surfaceSpecific / shapes.length : 0;

  // Mean confidence
  const avgConfidence = shapes.reduce((sum, s) => sum + s.confidence, 0) / shapes.length;

  // Weighted combination
  return (parsimony * 0.3) + (locality * 0.2) + (precision * 0.2) + (avgConfidence * 0.3);
}

// =============================================================================
// 2.6 — CLAIM-TYPE DRIVEN DECOMPOSITION
// =============================================================================

/**
 * Detect the claim type from a predicate definition.
 */
export function detectClaimType(predicate: Predicate): ClaimType {
  // DB predicates
  if (predicate.type === 'db') {
    if (predicate.assertion === 'table_exists' || predicate.assertion === 'column_exists') return 'existence';
    if (predicate.assertion === 'column_type') return 'equality';
    return 'existence';
  }

  // Filesystem predicates
  if (predicate.type === 'filesystem_exists') return 'existence';
  if (predicate.type === 'filesystem_absent') return 'absence';
  if (predicate.type === 'filesystem_unchanged') return 'invariance';
  if (predicate.type === 'filesystem_count') return 'equality';

  // HTTP sequence → ordering
  if (predicate.type === 'http_sequence') return 'ordering';

  // HTTP → equality or containment
  if (predicate.type === 'http') {
    if (predicate.expect?.bodyContains || predicate.expect?.bodyRegex) return 'containment';
    if (predicate.expect?.status) return 'equality';
    return 'equality';
  }

  // Content → containment
  if (predicate.type === 'content') return 'containment';

  // HTML → existence or containment
  if (predicate.type === 'html') {
    if (predicate.expected === 'exists') return 'existence';
    return 'containment';
  }

  // CSS → equality or transformation
  if (predicate.type === 'css') {
    if (predicate.property && isShorthandProperty(predicate)) return 'transformation';
    return 'equality';
  }

  return 'equality';
}

/**
 * Decompose a predicate result based on its claim type.
 * Returns shapes that match the specific claim failure mode.
 */
export function decomposeByClaimType(
  claimType: ClaimType,
  pr: PredicateResult,
  pred?: Predicate,
): DecomposedShape[] {
  const shapes: DecomposedShape[] = [];

  for (const rule of ALL_SHAPES) {
    if (rule.claimType !== claimType) continue;
    if (!rule.predicateMatch) continue;
    if (rule.predicateType && rule.predicateType !== pr.type) continue;
    if (rule.predicateMatch(pr, pred)) {
      if (!shapes.some(s => s.id === rule.id)) {
        shapes.push(ruleToShape(rule));
      }
    }
  }

  return shapes;
}

// =============================================================================
// 2.7 — TEMPORAL INTEGRATION
// =============================================================================

/** Temporal signals in error text or predicate data. */
const TEMPORAL_PATTERNS: Array<{ pattern: RegExp; mode: TemporalMode }> = [
  { pattern: /stale|cache|cached|outdated/i, mode: 'fresh' },
  { pattern: /timeout|timed out|deadline/i, mode: 'settled' },
  { pattern: /race|concurrent|parallel/i, mode: 'stable' },
  { pattern: /sequence|order|step \d/i, mode: 'ordered' },
  { pattern: /hydrat|loading|render/i, mode: 'settled' },
  { pattern: /transition|animation|midpoint/i, mode: 'stable' },
];

/**
 * Detect temporal mode from failure context.
 * Returns the temporal mode if timing is a factor, undefined otherwise.
 */
export function detectTemporalMode(context: {
  error?: string;
  predicateExpected?: string;
  predicateActual?: string;
  gateDetail?: string;
}): TemporalMode | undefined {
  const text = [context.error, context.predicateExpected, context.predicateActual, context.gateDetail]
    .filter(Boolean)
    .join(' ');

  for (const { pattern, mode } of TEMPORAL_PATTERNS) {
    if (pattern.test(text)) return mode;
  }
  return undefined;
}

/**
 * Annotate shapes with temporal mode when detected.
 * Temporal is a modifier — it attaches to primary shapes, not replaces them.
 */
export function annotateTemporalMode(
  shapes: DecomposedShape[],
  context: { error?: string; gateDetail?: string },
): DecomposedShape[] {
  const mode = detectTemporalMode(context);
  if (!mode) return shapes;

  return shapes.map(s => ({ ...s, temporal: mode }));
}

// =============================================================================
// CATALOG QUERIES — Introspect the shape catalog
// =============================================================================

/**
 * Get all known shapes in the catalog.
 */
export function getShapeCatalog(): Array<{
  id: string;
  domain: string;
  name: string;
  claimType: ClaimType;
  truthType: TruthType;
}> {
  return ALL_SHAPES.map(r => ({
    id: r.id,
    domain: r.domain,
    name: r.name,
    claimType: r.claimType,
    truthType: r.truthType,
  }));
}

/**
 * Get shapes by domain.
 */
export function getShapesByDomain(domain: string): DecomposedShape[] {
  return ALL_SHAPES
    .filter(r => r.domain === domain)
    .map(r => ruleToShape(r));
}

/**
 * Get shapes by claim type.
 */
export function getShapesByClaimType(claimType: ClaimType): DecomposedShape[] {
  return ALL_SHAPES
    .filter(r => r.claimType === claimType)
    .map(r => ruleToShape(r));
}

/**
 * Check if a shape ID exists in the catalog.
 */
export function isKnownShape(id: string): boolean {
  return ALL_SHAPES.some(r => r.id === id);
}

/**
 * Check if a set of shapes represents a composition (multi-domain).
 */
export function isComposition(shapeIds: string[]): boolean {
  const domains = new Set<string>();
  for (const id of shapeIds) {
    const rule = ALL_SHAPES.find(r => r.id === id);
    if (rule) domains.add(rule.domain);
  }
  return domains.size >= 2;
}

// =============================================================================
// COMPOSITION OPERATORS — Executable algebra from FAILURE-TAXONOMY.md
// =============================================================================

/**
 * Product composition (×): Given two shapes from different domains, produce the
 * composed failure shape. Returns the composition interaction shape ID if one
 * exists in the catalog, or undefined if no known composition covers this pair.
 *
 * The product of Shape A × Shape B is the failure where BOTH fail simultaneously.
 * The composition map is keyed by sorted domain pairs.
 */
const PRODUCT_COMPOSITION_MAP: Record<string, string> = {
  'css+http': 'I-05',
  'css+html': 'I-06',
  'content+html': 'I-07',
  'db+http': 'I-08',
  'content+css': 'I-09',
  'html+http': 'I-10',
};

/**
 * Product composition operator (×).
 * Given two shape IDs from different domains, returns the composed interaction shape.
 */
export function productComposition(shapeIdA: string, shapeIdB: string): DecomposedShape | undefined {
  const ruleA = ALL_SHAPES.find(r => r.id === shapeIdA);
  const ruleB = ALL_SHAPES.find(r => r.id === shapeIdB);
  if (!ruleA || !ruleB) return undefined;
  if (ruleA.domain === ruleB.domain) return undefined; // Same domain — not a product

  const key = [ruleA.domain, ruleB.domain].sort().join('+');
  const compositionId = PRODUCT_COMPOSITION_MAP[key];
  if (!compositionId) return undefined;

  const compositionRule = ALL_SHAPES.find(r => r.id === compositionId);
  if (!compositionRule) return undefined;

  return {
    ...ruleToShape(compositionRule),
    // Annotate that this shape was produced by composition
    confidence: Math.min(ruleA.confidence, ruleB.confidence) * 0.95,
  };
}

/**
 * Temporal composition operator (⊗).
 * Any shape ⊗ temporal mode = time-dependent variant.
 * Returns a new shape with the temporal annotation applied.
 */
export function temporalComposition(shapeId: string, mode: TemporalMode): DecomposedShape | undefined {
  const rule = ALL_SHAPES.find(r => r.id === shapeId);
  if (!rule) return undefined;

  return {
    ...ruleToShape(rule),
    temporal: mode,
  };
}

/**
 * Enumerate all known product compositions.
 * Returns pairs of domain combinations and their interaction shape IDs.
 */
export function getKnownCompositions(): Array<{ domains: [string, string]; shapeId: string; name: string }> {
  return Object.entries(PRODUCT_COMPOSITION_MAP).map(([key, shapeId]) => {
    const [domainA, domainB] = key.split('+') as [string, string];
    const rule = ALL_SHAPES.find(r => r.id === shapeId);
    return {
      domains: [domainA, domainB],
      shapeId,
      name: rule?.name ?? shapeId,
    };
  });
}

/**
 * Decompose a composed failure back into its component atomic shapes.
 * This is the inverse of productComposition — verifying the algebra's closure property.
 *
 * Given a VerifyResult with failures across multiple domains, returns:
 * - The atomic shapes (one per failing predicate type)
 * - The composition shape (if the domain pair is known)
 * - Whether the round-trip is valid (components → compose → decompose → same components)
 */
export function decomposeComposition(result: VerifyResult, predicates?: Predicate[]): {
  atomicShapes: DecomposedShape[];
  compositionShape?: DecomposedShape;
  roundTripValid: boolean;
} {
  const decomposition = decomposeFailure(result, predicates);
  const atomicShapes = decomposition.shapes.filter(s => s.domain !== 'interaction');
  const compositionIds = new Set(Object.values(PRODUCT_COMPOSITION_MAP));
  const compositionShape = decomposition.shapes.find(s => compositionIds.has(s.id));

  // Check round-trip: if we have 2+ atomic domains, composition should exist
  const atomicDomains = new Set(atomicShapes.map(s => s.domain));
  const shouldHaveComposition = atomicDomains.size >= 2;
  const hasComposition = compositionShape !== undefined;

  // Round-trip valid if: composition present when expected, or no known composition for this pair
  let roundTripValid: boolean;
  if (shouldHaveComposition && hasComposition) {
    roundTripValid = true;
  } else if (!shouldHaveComposition && !hasComposition) {
    roundTripValid = true;
  } else if (shouldHaveComposition && !hasComposition) {
    // Check if we have a known composition for this domain pair
    const domainList = [...atomicDomains].sort();
    const key = domainList.slice(0, 2).join('+');
    roundTripValid = !(key in PRODUCT_COMPOSITION_MAP); // Valid if no known composition
  } else {
    roundTripValid = false;
  }

  return { atomicShapes, compositionShape, roundTripValid };
}

// =============================================================================
// DECOMPOSITION DIAGNOSTICS
// =============================================================================

/**
 * Aggregate decomposition quality metrics across multiple results.
 *
 * Tracks:
 *   - Single vs multi-shape vs empty decompositions
 *   - Composition frequency
 *   - Temporal annotation frequency
 *   - Minimizer reduction rate (shapes removed by minimizeShapes)
 *   - Mean decomposition score
 *   - Fully classified rate
 */
export interface DecompositionDiagnostics {
  total: number;
  singleShape: number;
  multiShape: number;
  empty: number;
  composed: number;
  temporalAnnotated: number;
  fullyClassified: number;
  meanScore: number;
  reducedByMinimizer: number;
  domainDistribution: Record<string, number>;
  claimTypeDistribution: Record<string, number>;
}

/**
 * Compute diagnostics from a batch of decomposition results.
 */
export function computeDecompositionDiagnostics(
  results: DecompositionResult[],
): DecompositionDiagnostics {
  const diag: DecompositionDiagnostics = {
    total: results.length,
    singleShape: 0,
    multiShape: 0,
    empty: 0,
    composed: 0,
    temporalAnnotated: 0,
    fullyClassified: 0,
    meanScore: 0,
    reducedByMinimizer: 0,
    domainDistribution: {},
    claimTypeDistribution: {},
  };

  let scoreSum = 0;

  for (const r of results) {
    if (r.shapes.length === 0) diag.empty++;
    else if (r.shapes.length === 1) diag.singleShape++;
    else diag.multiShape++;

    if (r.composition) diag.composed++;
    if (r.fullyClassified) diag.fullyClassified++;
    if (r.shapes.some(s => s.temporal)) diag.temporalAnnotated++;

    scoreSum += scoreDecomposition(r.shapes);

    for (const s of r.shapes) {
      diag.domainDistribution[s.domain] = (diag.domainDistribution[s.domain] || 0) + 1;
      diag.claimTypeDistribution[s.claimType] = (diag.claimTypeDistribution[s.claimType] || 0) + 1;
    }
  }

  diag.meanScore = results.length > 0 ? scoreSum / results.length : 0;
  return diag;
}

/**
 * Compute minimizer reduction rate: how many shapes does minimizeShapes remove on average?
 * Pass raw (pre-minimized) shape arrays alongside their minimized outputs.
 */
export function computeMinimizerReduction(
  batches: Array<{ before: DecomposedShape[]; after: DecomposedShape[] }>,
): { totalBefore: number; totalAfter: number; reductionRate: number } {
  let totalBefore = 0;
  let totalAfter = 0;
  for (const { before, after } of batches) {
    totalBefore += before.length;
    totalAfter += after.length;
  }
  return {
    totalBefore,
    totalAfter,
    reductionRate: totalBefore > 0 ? 1 - (totalAfter / totalBefore) : 0,
  };
}
