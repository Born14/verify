import { describe, test, expect } from 'bun:test';
import {
  decomposeFailure,
  decomposeObservation,
  getShapeCatalog,
  getShapesByDomain,
  getShapesByClaimType,
  isKnownShape,
  isComposition,
} from '../../src/store/decompose.js';
import type { VerifyResult, GateResult, PredicateResult } from '../../src/types.js';

// =============================================================================
// HELPERS — Build VerifyResult fixtures
// =============================================================================

function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    success: false,
    gates: [],
    attestation: '',
    timing: { totalMs: 100, perGate: {} },
    ...overrides,
  };
}

function makeGate(gate: string, passed: boolean, detail = '', durationMs = 10): GateResult {
  return { gate: gate as any, passed, detail, durationMs };
}

function makePredResult(overrides: Partial<PredicateResult> = {}): PredicateResult {
  return {
    predicateId: 'p1',
    type: 'css',
    passed: false,
    fingerprint: 'test',
    ...overrides,
  };
}

// =============================================================================
// CATALOG QUERIES
// =============================================================================

describe('Shape Catalog', () => {
  test('catalog is non-empty', () => {
    const catalog = getShapeCatalog();
    expect(catalog.length).toBeGreaterThan(30);
  });

  test('every shape has required fields', () => {
    for (const shape of getShapeCatalog()) {
      expect(shape.id).toBeTruthy();
      expect(shape.domain).toBeTruthy();
      expect(shape.name).toBeTruthy();
      expect(shape.claimType).toBeTruthy();
      expect(shape.truthType).toBeTruthy();
    }
  });

  test('no duplicate shape IDs', () => {
    const ids = getShapeCatalog().map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('getShapesByDomain returns only matching domain', () => {
    const cssShapes = getShapesByDomain('css');
    expect(cssShapes.length).toBeGreaterThan(5);
    for (const s of cssShapes) {
      expect(s.domain).toBe('css');
    }
  });

  test('getShapesByClaimType returns only matching claim type', () => {
    const existenceShapes = getShapesByClaimType('existence');
    expect(existenceShapes.length).toBeGreaterThan(3);
    for (const s of existenceShapes) {
      expect(s.claimType).toBe('existence');
    }
  });

  test('isKnownShape recognizes valid IDs', () => {
    expect(isKnownShape('C-33')).toBe(true);
    expect(isKnownShape('X-37')).toBe(true);
    expect(isKnownShape('FS-01')).toBe(true);
    expect(isKnownShape('FAKE-99')).toBe(false);
  });

  test('isComposition detects multi-domain shape sets', () => {
    expect(isComposition(['C-33', 'P-07'])).toBe(true);   // css + http
    expect(isComposition(['C-33', 'C-01'])).toBe(false);   // same domain
    expect(isComposition(['C-33', 'X-37'])).toBe(true);    // css + cross-cutting
    expect(isComposition([])).toBe(false);
  });
});

// =============================================================================
// OUTCOME CLASSIFICATION
// =============================================================================

describe('Outcome Classification', () => {
  test('successful result → pass', () => {
    const r = decomposeFailure(makeResult({ success: true, gates: [makeGate('F9', true)] }));
    expect(r.outcome).toBe('pass');
  });

  test('success with unexplained mutations → misleading_success', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true), makeGate('G5', true)],
      containment: { totalMutations: 3, direct: 1, scaffolding: 1, unexplained: 1 },
    }));
    expect(r.outcome).toBe('misleading_success');
  });

  test('success with triangulation escalation → partial_success', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true)],
      triangulation: {
        action: 'escalate', confidence: 'majority', outlier: 'vision',
        authorities: { deterministic: 'pass', browser: 'pass', vision: 'fail' },
        authorityCount: 3, reasoning: 'test',
      },
    }));
    expect(r.outcome).toBe('partial_success');
  });

  test('failure with mixed predicate results → partial_success', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true), makeGate('staging', false, 'predicate failed')],
      predicateResults: [
        makePredResult({ predicateId: 'p1', passed: true }),
        makePredResult({ predicateId: 'p2', passed: false, expected: 'green', actual: 'red' }),
      ],
    }));
    expect(r.outcome).toBe('partial_success');
  });

  test('clear failure → fail', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', false, 'search string not found')],
    }));
    expect(r.outcome).toBe('fail');
  });
});

// =============================================================================
// F9 SYNTAX GATE DECOMPOSITION
// =============================================================================

describe('F9 Gate Failures', () => {
  test('search string not found → X-37', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'Edit failed: search string not found in server.js')],
    }));
    expect(r.shapes.some(s => s.id === 'X-37')).toBe(true);
    expect(r.failedGate).toBe('F9');
    expect(r.signature).toBe('edit_not_applicable');
  });

  test('edit application failed → X-37', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'Edit application failed: no match')],
    }));
    expect(r.shapes.some(s => s.id === 'X-37')).toBe(true);
  });

  test('ambiguous match → X-38', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'Search string matches 3 locations in server.js')],
    }));
    expect(r.shapes.some(s => s.id === 'X-38')).toBe(true);
  });

  test('file not found → X-39', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'File does not exist: routes/missing.js')],
    }));
    expect(r.shapes.some(s => s.id === 'X-39')).toBe(true);
  });
});

// =============================================================================
// K5 CONSTRAINT GATE DECOMPOSITION
// =============================================================================

describe('K5 Gate Failures', () => {
  test('forbidden action → X-51', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: forbidden_action — rewrite_page banned'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-51')).toBe(true);
  });

  test('radius limit → X-52', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: radius_limit — max 3 files'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-52')).toBe(true);
  });

  test('predicate fingerprint ban → X-53', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: predicate_fingerprint banned'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-53')).toBe(true);
  });

  test('goal drift → X-54', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: goal_drift ban'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-54')).toBe(true);
  });
});

// =============================================================================
// CSS PREDICATE DECOMPOSITION
// =============================================================================

describe('CSS Predicate Failures', () => {
  test('CSS value mismatch (non-color) → C-33', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'predicate failed')],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'block', actual: 'inline' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(true);
  });

  test('CSS color mismatch → C-01 dominates C-33', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'predicate failed')],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'green', actual: 'red' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-01')).toBe(true);
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(false); // dominated
  });

  test('color format mismatch → C-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: '#ff0000', actual: 'red' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-01')).toBe(true);
  });

  test('case mismatch → C-07', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'Red', actual: 'red' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-07')).toBe(true);
  });

  test('zero equivalence → C-08', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: '0px', actual: '0' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-08')).toBe(true);
  });

  test('rounding mismatch → C-44', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: '33.33%', actual: '33.3333%' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-44')).toBe(true);
  });

  test('calc() expression → C-09', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'calc(100% - 20px)', actual: '480px' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-09')).toBe(true);
  });

  test('var() unresolved → C-10', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'var(--main-color)', actual: 'blue' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-10')).toBe(true);
  });
});

// =============================================================================
// HTML PREDICATE DECOMPOSITION
// =============================================================================

describe('HTML Predicate Failures', () => {
  test('element not found → H-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'html', passed: false, expected: 'exists', actual: '(not found)' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'H-01')).toBe(true);
  });

  test('element wrong content → H-02', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'html', passed: false, expected: 'Welcome', actual: 'Hello' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'H-02')).toBe(true);
  });
});

// =============================================================================
// HTTP PREDICATE DECOMPOSITION
// =============================================================================

describe('HTTP Predicate Failures', () => {
  test('HTTP status mismatch → P-07', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'http', passed: false, expected: 'status 200', actual: 'status 404' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'P-07')).toBe(true);
  });

  test('HTTP sequence failure → P-09', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'http_sequence', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'P-09')).toBe(true);
  });
});

// =============================================================================
// DB PREDICATE DECOMPOSITION
// =============================================================================

describe('DB Predicate Failures', () => {
  test('table not found → D-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'db', passed: false, expected: 'table_exists' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'D-01')).toBe(true);
  });

  test('column not found → D-02', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'db', passed: false, expected: 'column_exists' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'D-02')).toBe(true);
  });
});

// =============================================================================
// FILESYSTEM PREDICATE DECOMPOSITION
// =============================================================================

describe('Filesystem Predicate Failures', () => {
  test('file not found → FS-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'filesystem_exists', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'FS-01')).toBe(true);
  });

  test('file should be absent → FS-02', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'filesystem_absent', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'FS-02')).toBe(true);
  });

  test('file changed when unchanged expected → FS-03', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'filesystem_unchanged', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'FS-03')).toBe(true);
  });

  test('file count mismatch → FS-04', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'filesystem_count', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'FS-04')).toBe(true);
  });
});

// =============================================================================
// CONTAINMENT DECOMPOSITION
// =============================================================================

describe('Containment (G5) Failures', () => {
  test('unexplained mutation → AT-01', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true), makeGate('G5', true)],
      containment: { totalMutations: 5, direct: 2, scaffolding: 1, unexplained: 2 },
    }));
    expect(r.shapes.some(s => s.id === 'AT-01')).toBe(true);
  });

  test('accidental correctness → AT-05', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true), makeGate('G5', true)],
      containment: { totalMutations: 3, direct: 1, scaffolding: 0, unexplained: 2 },
    }));
    expect(r.shapes.some(s => s.id === 'AT-05')).toBe(true);
  });
});

// =============================================================================
// STAGING / INFRASTRUCTURE DECOMPOSITION
// =============================================================================

describe('Staging Failures', () => {
  test('build failure → I-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'build failure: exit code 1')],
    }));
    expect(r.shapes.some(s => s.id === 'I-01')).toBe(true);
    expect(r.signature).toBe('build_failure');
  });

  test('health check failure → I-02', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'health check failed: 502 Bad Gateway')],
    }));
    expect(r.shapes.some(s => s.id === 'I-02')).toBe(true);
  });

  test('DNS resolution failure → I-03', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'getaddrinfo EAI_AGAIN db')],
    }));
    expect(r.shapes.some(s => s.id === 'I-03')).toBe(true);
  });

  test('port conflict → I-04', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'EADDRINUSE: port 3000 in use')],
    }));
    expect(r.shapes.some(s => s.id === 'I-04')).toBe(true);
  });
});

// =============================================================================
// VISION / TRIANGULATION DECOMPOSITION
// =============================================================================

describe('Triangulation Failures', () => {
  test('vision disagrees → V-01', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true)],
      triangulation: {
        action: 'escalate', confidence: 'majority', outlier: 'vision',
        authorities: { deterministic: 'pass', browser: 'pass', vision: 'fail' },
        authorityCount: 3, reasoning: 'vision says different',
      },
    }));
    expect(r.shapes.some(s => s.id === 'V-01')).toBe(true);
  });

  test('deterministic is outlier → V-02', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true)],
      triangulation: {
        action: 'escalate', confidence: 'majority', outlier: 'deterministic',
        authorities: { deterministic: 'fail', browser: 'pass', vision: 'pass' },
        authorityCount: 3, reasoning: 'deterministic disagrees',
      },
    }));
    expect(r.shapes.some(s => s.id === 'V-02')).toBe(true);
  });
});

// =============================================================================
// INVARIANT DECOMPOSITION
// =============================================================================

describe('Invariant Failures', () => {
  test('invariant failed → INV-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('staging', true),
        makeGate('invariants', false, 'Health endpoint returned 500'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'INV-01')).toBe(true);
  });
});

// =============================================================================
// GROUNDING DECOMPOSITION
// =============================================================================

describe('Grounding Failures', () => {
  test('CSS grounding miss → X-60', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('grounding', false, 'CSS selector fabricated')],
      effectivePredicates: [
        { id: 'p1', type: 'css', fingerprint: 'test', groundingMiss: true },
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-60')).toBe(true);
  });

  test('DB grounding miss → X-61', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('grounding', false, 'DB predicate miss')],
      effectivePredicates: [
        { id: 'p1', type: 'db', fingerprint: 'test', groundingMiss: true },
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-61')).toBe(true);
  });
});

// =============================================================================
// COMPOSITION DETECTION
// =============================================================================

describe('Composition Detection', () => {
  test('CSS + HTTP failure = composition', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: 'green', actual: 'red' }),
        makePredResult({ predicateId: 'p2', type: 'http', passed: false, expected: 'status 200' }),
      ],
    }));
    expect(r.composition).toBeDefined();
    expect(r.composition!.length).toBeGreaterThanOrEqual(2);
    const domains = new Set(r.shapes.map(s => s.domain));
    expect(domains.size).toBeGreaterThanOrEqual(2);
  });

  test('single-domain failure = no composition', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: 'green', actual: 'red' }),
        makePredResult({ predicateId: 'p2', type: 'css', passed: false, expected: 'bold', actual: 'normal' }),
      ],
    }));
    expect(r.composition).toBeUndefined();
  });
});

// =============================================================================
// decomposeObservation (raw observation, not VerifyResult)
// =============================================================================

describe('decomposeObservation', () => {
  test('error text → matching shapes', () => {
    const shapes = decomposeObservation({ error: 'search string not found in server.js' });
    expect(shapes.some(s => s.id === 'X-37')).toBe(true);
  });

  test('predicate type + actual → matching shapes', () => {
    const shapes = decomposeObservation({
      predicateType: 'css',
      predicateExpected: '#ff0000',
      predicateActual: 'red',
    });
    expect(shapes.some(s => s.id === 'C-01')).toBe(true);
  });

  test('grounding miss → matching shapes', () => {
    const shapes = decomposeObservation({
      predicateType: 'css',
      groundingMiss: true,
    });
    expect(shapes.some(s => s.id === 'X-60')).toBe(true);
  });

  test('build failure error → I-01', () => {
    const shapes = decomposeObservation({ error: 'Docker build failure: exit code 1' });
    expect(shapes.some(s => s.id === 'I-01')).toBe(true);
  });

  test('unknown error → empty', () => {
    const shapes = decomposeObservation({ error: 'something completely unprecedented' });
    expect(shapes.length).toBe(0);
  });
});

// =============================================================================
// CONFIDENCE ORDERING
// =============================================================================

describe('Confidence', () => {
  test('shapes sorted by confidence descending', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'search string not found')],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'green', actual: 'red' }),
      ],
    }));
    for (let i = 1; i < r.shapes.length; i++) {
      expect(r.shapes[i - 1].confidence).toBeGreaterThanOrEqual(r.shapes[i].confidence);
    }
  });

  test('all confidences in valid range', () => {
    for (const shape of getShapeCatalog()) {
      const rules = getShapesByDomain(shape.domain);
      for (const r of rules) {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});

// =============================================================================
// FULLY CLASSIFIED
// =============================================================================

describe('Classification Completeness', () => {
  test('success is always fully classified', () => {
    const r = decomposeFailure(makeResult({ success: true, gates: [makeGate('F9', true)] }));
    expect(r.fullyClassified).toBe(true);
  });

  test('known failure is fully classified', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'search string not found')],
    }));
    expect(r.fullyClassified).toBe(true);
  });

  test('unknown failure is not fully classified', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'something never seen before')],
    }));
    expect(r.fullyClassified).toBe(false);
  });
});

// =============================================================================
// SIGNATURE EXTRACTION
// =============================================================================

describe('Signature Extraction', () => {
  test('extracts known signatures from gate detail', () => {
    const cases: [string, string][] = [
      ['search string not found', 'edit_not_applicable'],
      ['BROWSER GATE FAILED', 'browser_gate_failed'],
      ['getaddrinfo EAI_AGAIN db', 'dns_resolution_failed'],
      ['EADDRINUSE: port 3000', 'port_conflict'],
      ['SyntaxError: Unexpected token', 'syntax_error'],
      ['Cannot find module "express"', 'missing_module'],
      ['build failure: exit code 1', 'build_failure'],
      ['health check failed: 502', 'health_check_failure'],
      ['ECONNREFUSED 127.0.0.1:5432', 'connection_refused'],
    ];

    for (const [detail, expectedSig] of cases) {
      const r = decomposeFailure(makeResult({
        gates: [makeGate('F9', false, detail)],
      }));
      expect(r.signature).toBe(expectedSig);
    }
  });
});
