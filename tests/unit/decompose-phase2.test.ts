import { describe, test, expect } from 'bun:test';
import {
  decomposeFailure,
  decomposeObservation,
  minimizeShapes,
  sortShapes,
  scoreDecomposition,
  detectClaimType,
  decomposeByClaimType,
  detectTemporalMode,
  annotateTemporalMode,
  getShapeCatalog,
  isKnownShape,
  computeDecompositionDiagnostics,
  computeMinimizerReduction,
} from '../../src/store/decompose.js';
import type { DecomposedShape, DecompositionResult, DecompositionDiagnostics, ClaimType, TemporalMode } from '../../src/store/decompose.js';
import type { VerifyResult, GateResult, PredicateResult, Predicate } from '../../src/types.js';

// =============================================================================
// HELPERS
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

function makeShape(id: string, domain: string, overrides: Partial<DecomposedShape> = {}): DecomposedShape {
  return {
    id,
    domain,
    name: `Test shape ${id}`,
    claimType: 'equality',
    truthType: 'deterministic',
    confidence: 0.9,
    ...overrides,
  };
}

// =============================================================================
// 2.1 — MINIMAL BASIS ENFORCEMENT
// =============================================================================

describe('2.1 — Minimal Basis Enforcement', () => {
  test('removes exact duplicates', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('C-33', 'css'),
      makeShape('C-33', 'css'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('C-33');
  });

  test('removes dominated shapes (C-33 dominated by C-01)', () => {
    const shapes = [
      makeShape('C-33', 'css', { confidence: 0.9 }),
      makeShape('C-01', 'css', { confidence: 0.85 }),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('C-01');
  });

  test('removes dominated shapes (C-33 dominated by C-08)', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('C-08', 'css'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.some(s => s.id === 'C-08')).toBe(true);
    expect(result.some(s => s.id === 'C-33')).toBe(false);
  });

  test('removes dominated shapes (C-33 dominated by C-44)', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('C-44', 'css'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.some(s => s.id === 'C-44')).toBe(true);
    expect(result.some(s => s.id === 'C-33')).toBe(false);
  });

  test('keeps non-dominated shapes intact', () => {
    const shapes = [
      makeShape('C-01', 'css'),
      makeShape('H-01', 'html'),
      makeShape('P-07', 'http'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(3);
  });

  test('removes P-02 when P-23 present', () => {
    const shapes = [
      makeShape('P-02', 'http'),
      makeShape('P-23', 'http'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('P-23');
  });

  test('removes N-06 when N-03 present', () => {
    const shapes = [
      makeShape('N-06', 'content'),
      makeShape('N-03', 'content'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('N-03');
  });

  test('removes cross-cutting X-37/X-38 when surface-specific shapes present', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('X-37', 'cross-cutting'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('C-33');
  });

  test('keeps K5 cross-cutting shapes even when surface-specific present', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('X-51', 'cross-cutting'),  // K5 — always relevant
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(2);
    expect(result.some(s => s.id === 'X-51')).toBe(true);
  });

  test('keeps grounding cross-cutting shapes even when surface-specific present', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('X-60', 'cross-cutting'),  // Grounding — always relevant
    ];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(2);
    expect(result.some(s => s.id === 'X-60')).toBe(true);
  });

  test('single shape passes through unchanged', () => {
    const shapes = [makeShape('C-33', 'css')];
    const result = minimizeShapes(shapes);
    expect(result.length).toBe(1);
  });

  test('empty array passes through', () => {
    expect(minimizeShapes([]).length).toBe(0);
  });

  test('multiple C-33 dominators present — C-33 removed', () => {
    const shapes = [
      makeShape('C-33', 'css'),
      makeShape('C-01', 'css'),
      makeShape('C-08', 'css'),
    ];
    const result = minimizeShapes(shapes);
    expect(result.some(s => s.id === 'C-33')).toBe(false);
    expect(result.some(s => s.id === 'C-01')).toBe(true);
    expect(result.some(s => s.id === 'C-08')).toBe(true);
  });
});

// =============================================================================
// 2.2 — DETERMINISTIC CONSISTENCY
// =============================================================================

describe('2.2 — Deterministic Sort', () => {
  test('primary surfaces sort before modifiers', () => {
    const shapes = [
      makeShape('AT-01', 'attribution'),
      makeShape('C-33', 'css'),
      makeShape('V-01', 'vision'),
      makeShape('H-01', 'html'),
    ];
    const result = sortShapes(shapes);
    expect(result[0].domain).toBe('css');
    expect(result[1].domain).toBe('html');
  });

  test('modifiers sort before cross-cutting', () => {
    const shapes = [
      makeShape('X-37', 'cross-cutting'),
      makeShape('V-01', 'vision'),
    ];
    const result = sortShapes(shapes);
    expect(result[0].domain).toBe('vision');
    expect(result[1].domain).toBe('cross-cutting');
  });

  test('same domain: higher confidence first', () => {
    const shapes = [
      makeShape('C-08', 'css', { confidence: 0.7 }),
      makeShape('C-01', 'css', { confidence: 0.95 }),
      makeShape('C-33', 'css', { confidence: 0.85 }),
    ];
    const result = sortShapes(shapes);
    expect(result[0].id).toBe('C-01');
    expect(result[1].id).toBe('C-33');
    expect(result[2].id).toBe('C-08');
  });

  test('same domain and confidence: lexicographic ID tiebreaker', () => {
    const shapes = [
      makeShape('C-10', 'css', { confidence: 0.9 }),
      makeShape('C-01', 'css', { confidence: 0.9 }),
      makeShape('C-08', 'css', { confidence: 0.9 }),
    ];
    const result = sortShapes(shapes);
    expect(result[0].id).toBe('C-01');
    expect(result[1].id).toBe('C-08');
    expect(result[2].id).toBe('C-10');
  });

  test('idempotent — sorting twice gives same result', () => {
    const shapes = [
      makeShape('P-07', 'http'),
      makeShape('C-33', 'css'),
      makeShape('X-51', 'cross-cutting'),
      makeShape('AT-01', 'attribution'),
    ];
    const r1 = sortShapes(shapes);
    const r2 = sortShapes(r1);
    expect(r1.map(s => s.id)).toEqual(r2.map(s => s.id));
  });

  test('empty array returns empty', () => {
    expect(sortShapes([]).length).toBe(0);
  });

  test('does not mutate input array', () => {
    const shapes = [
      makeShape('X-37', 'cross-cutting'),
      makeShape('C-33', 'css'),
    ];
    const original = [...shapes];
    sortShapes(shapes);
    expect(shapes[0].id).toBe(original[0].id);
    expect(shapes[1].id).toBe(original[1].id);
  });
});

// =============================================================================
// 2.3 — DECOMPOSITION TESTS: SINGLE-SHAPE
// =============================================================================

describe('2.3A — Single-Shape Decomposition', () => {
  test('pure CSS value mismatch (non-color) → only C-33', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'block', actual: 'inline' }),
      ],
    }));
    expect(r.shapes.length).toBe(1);
    expect(r.shapes[0].id).toBe('C-33');
  });

  test('pure HTML element not found → only H-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'html', passed: false, expected: 'exists', actual: '(not found)' }),
      ],
    }));
    expect(r.shapes.length).toBe(1);
    expect(r.shapes[0].id).toBe('H-01');
  });

  test('pure filesystem not found → only FS-01', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'filesystem_exists', passed: false }),
      ],
    }));
    expect(r.shapes.length).toBe(1);
    expect(r.shapes[0].id).toBe('FS-01');
  });

  test('pure K5 forbidden action → only X-51', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: forbidden_action — banned'),
      ],
    }));
    expect(r.shapes.length).toBe(1);
    expect(r.shapes[0].id).toBe('X-51');
  });

  test('pure INV-01 (invariant failed)', () => {
    const r = decomposeFailure(makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('staging', true),
        makeGate('invariants', false, 'Health check returned 500'),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'INV-01')).toBe(true);
  });
});

// =============================================================================
// 2.3B — MULTI-SHAPE DECOMPOSITION
// =============================================================================

describe('2.3B — Multi-Shape Decomposition', () => {
  test('HTTP × DB = composition', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'http', passed: false, expected: 'status 200' }),
        makePredResult({ predicateId: 'p2', type: 'db', passed: false, expected: 'table_exists' }),
      ],
    }));
    expect(r.composition).toBeDefined();
    expect(r.shapes.some(s => s.id === 'P-07')).toBe(true);
    expect(r.shapes.some(s => s.id === 'D-01')).toBe(true);
  });

  test('CSS × HTML = composition', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: 'block', actual: 'none' }),
        makePredResult({ predicateId: 'p2', type: 'html', passed: false, expected: 'exists', actual: '(not found)' }),
      ],
    }));
    expect(r.composition).toBeDefined();
    const domains = new Set(r.shapes.map(s => s.domain));
    expect(domains.has('css')).toBe(true);
    expect(domains.has('html')).toBe(true);
  });

  test('FS + containment = composition', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'filesystem_exists', passed: false }),
      ],
      containment: { totalMutations: 3, direct: 1, scaffolding: 0, unexplained: 2 },
    }));
    expect(r.composition).toBeDefined();
    expect(r.shapes.some(s => s.id === 'FS-01')).toBe(true);
    expect(r.shapes.some(s => s.id === 'AT-01')).toBe(true);
  });
});

// =============================================================================
// 2.3C — AMBIGUOUS INPUT: MINIMAL BASIS SELECTED
// =============================================================================

describe('2.3C — Ambiguous Input Resolution', () => {
  test('CSS color mismatch: C-01 selected, C-33 minimized away', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: '#ff0000', actual: 'red' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-01')).toBe(true);
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(false);
  });

  test('zero mismatch: C-08 selected, C-33 minimized away', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: '0px', actual: '0' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-08')).toBe(true);
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(false);
  });

  test('content pattern not found does not produce N-03 or N-07', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'content', passed: false }),
      ],
    }));
    // N-06 should be present (content not found)
    expect(r.shapes.some(s => s.id === 'N-06')).toBe(true);
    // N-03 / N-07 match on passed=true, so should NOT match here
    expect(r.shapes.some(s => s.id === 'N-03')).toBe(false);
  });
});

// =============================================================================
// 2.3D — IDEMPOTENCE
// =============================================================================

describe('2.3D — Idempotence', () => {
  const fixtures = [
    // Simple CSS
    makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [makePredResult({ type: 'css', passed: false, expected: 'bold', actual: 'normal' })],
    }),
    // Multi-predicate
    makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: 'block', actual: 'none' }),
        makePredResult({ predicateId: 'p2', type: 'http', passed: false, expected: 'status 200' }),
      ],
    }),
    // K5 failure
    makeResult({
      gates: [
        makeGate('F9', true),
        makeGate('K5', false, 'CONSTRAINT VIOLATION: forbidden_action'),
      ],
    }),
    // Success
    makeResult({ success: true, gates: [makeGate('F9', true)] }),
  ];

  for (let i = 0; i < fixtures.length; i++) {
    test(`fixture ${i}: decomposeFailure(x) === decomposeFailure(x)`, () => {
      const a = decomposeFailure(fixtures[i]);
      const b = decomposeFailure(fixtures[i]);
      expect(a.shapes.map(s => s.id)).toEqual(b.shapes.map(s => s.id));
      expect(a.outcome).toBe(b.outcome);
      expect(a.signature).toBe(b.signature);
      expect(a.composition).toEqual(b.composition);
      expect(a.fullyClassified).toBe(b.fullyClassified);
    });
  }
});

// =============================================================================
// 2.3E — NOISE STABILITY
// =============================================================================

describe('2.3E — Noise Stability', () => {
  test('irrelevant gate timing does not affect shapes', () => {
    const base = {
      gates: [makeGate('F9', false, 'search string not found')],
    };
    const r1 = decomposeFailure(makeResult({ ...base, timing: { totalMs: 50, perGate: {} } }));
    const r2 = decomposeFailure(makeResult({ ...base, timing: { totalMs: 99999, perGate: {} } }));
    expect(r1.shapes.map(s => s.id)).toEqual(r2.shapes.map(s => s.id));
  });

  test('attestation text does not affect shapes', () => {
    const base = {
      gates: [makeGate('F9', false, 'search string not found')],
    };
    const r1 = decomposeFailure(makeResult({ ...base, attestation: '' }));
    const r2 = decomposeFailure(makeResult({ ...base, attestation: 'LOTS OF TEXT HERE' }));
    expect(r1.shapes.map(s => s.id)).toEqual(r2.shapes.map(s => s.id));
  });

  test('passing predicates do not pollute failure shapes', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: true, expected: 'green', actual: 'green' }),
        makePredResult({ predicateId: 'p2', type: 'css', passed: false, expected: 'bold', actual: 'normal' }),
      ],
    }));
    // Only the failed predicate should produce shapes
    expect(r.shapes.length).toBe(1);
    expect(r.shapes[0].id).toBe('C-33');
  });

  test('constraintDelta does not affect shapes', () => {
    const base = {
      gates: [makeGate('F9', false, 'search string not found')],
    };
    const r1 = decomposeFailure(makeResult(base));
    const r2 = decomposeFailure(makeResult({
      ...base,
      constraintDelta: { before: 0, after: 5, seeded: ['c1', 'c2'] },
    }));
    expect(r1.shapes.map(s => s.id)).toEqual(r2.shapes.map(s => s.id));
  });
});

// =============================================================================
// 2.3F — REDUNDANCY ELIMINATION (integration with decomposeFailure)
// =============================================================================

describe('2.3F — Redundancy Elimination in decomposeFailure', () => {
  test('CSS color values: only specific shape survives', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'css', passed: false, expected: 'navy', actual: '#000080' }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'C-01')).toBe(true);
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(false);
  });

  test('decomposeObservation also minimizes', () => {
    const shapes = decomposeObservation({
      predicateType: 'css',
      predicateExpected: '#ff0000',
      predicateActual: 'red',
    });
    expect(shapes.some(s => s.id === 'C-01')).toBe(true);
    expect(shapes.some(s => s.id === 'C-33')).toBe(false);
  });
});

// =============================================================================
// 2.4 — OUTCOME ↔ SHAPE ALIGNMENT
// =============================================================================

describe('2.4 — Outcome ↔ Shape Alignment', () => {
  test('misleading_success always has success=true + failure-indicating shapes', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true), makeGate('G5', true)],
      containment: { totalMutations: 3, direct: 1, scaffolding: 0, unexplained: 2 },
    }));
    expect(r.outcome).toBe('misleading_success');
    expect(r.shapes.some(s => s.id === 'AT-05')).toBe(true); // accidental correctness
  });

  test('partial_success has both passed and failed predicates', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true), makeGate('staging', false, 'pred fail')],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: true }),
        makePredResult({ predicateId: 'p2', type: 'css', passed: false, expected: 'bold', actual: 'normal' }),
      ],
    }));
    expect(r.outcome).toBe('partial_success');
    expect(r.shapes.length).toBeGreaterThan(0); // at least one failure shape
  });

  test('honest_uncertainty when no gates ran', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', false, 'not run', 0)],
    }));
    expect(r.outcome).toBe('honest_uncertainty');
  });

  test('honest_uncertainty does not produce false shape mapping', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [], // no gates at all
    }));
    expect(r.outcome).toBe('honest_uncertainty');
    expect(r.shapes.length).toBe(0);
    expect(r.fullyClassified).toBe(false);
  });

  test('pass outcome has no failure shapes', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true)],
    }));
    expect(r.outcome).toBe('pass');
    expect(r.shapes.length).toBe(0);
  });

  test('degraded_correctness: mix of pass and fail predicates signals partial', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true), makeGate('browser', false, 'pred fail')],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: true }),
        makePredResult({ predicateId: 'p2', type: 'html', passed: false, expected: 'exists', actual: '(not found)' }),
        makePredResult({ predicateId: 'p3', type: 'http', passed: true }),
      ],
    }));
    expect(r.outcome).toBe('partial_success');
  });
});

// =============================================================================
// 2.5 — DECOMPOSITION SCORING
// =============================================================================

describe('2.5 — Decomposition Scoring', () => {
  test('single high-confidence surface shape scores highest', () => {
    const score = scoreDecomposition([
      makeShape('C-33', 'css', { confidence: 0.95 }),
    ]);
    expect(score).toBeGreaterThan(0.8);
  });

  test('fewer shapes scores higher', () => {
    const one = scoreDecomposition([makeShape('C-33', 'css')]);
    const two = scoreDecomposition([makeShape('C-33', 'css'), makeShape('C-01', 'css')]);
    expect(one).toBeGreaterThan(two);
  });

  test('fewer domains scores higher', () => {
    const same = scoreDecomposition([
      makeShape('C-33', 'css'),
      makeShape('C-01', 'css'),
    ]);
    const cross = scoreDecomposition([
      makeShape('C-33', 'css'),
      makeShape('P-07', 'http'),
    ]);
    expect(same).toBeGreaterThan(cross);
  });

  test('surface-specific scores higher than cross-cutting', () => {
    const surface = scoreDecomposition([makeShape('C-33', 'css')]);
    const crossCut = scoreDecomposition([makeShape('X-37', 'cross-cutting')]);
    expect(surface).toBeGreaterThan(crossCut);
  });

  test('higher confidence scores higher', () => {
    const high = scoreDecomposition([makeShape('C-33', 'css', { confidence: 0.95 })]);
    const low = scoreDecomposition([makeShape('C-33', 'css', { confidence: 0.5 })]);
    expect(high).toBeGreaterThan(low);
  });

  test('empty shapes scores 0', () => {
    expect(scoreDecomposition([])).toBe(0);
  });

  test('score is always 0.0 - 1.0', () => {
    const cases = [
      [makeShape('C-33', 'css')],
      [makeShape('X-37', 'cross-cutting'), makeShape('X-38', 'cross-cutting')],
      [makeShape('C-33', 'css'), makeShape('P-07', 'http'), makeShape('D-01', 'db')],
      [makeShape('AT-01', 'attribution', { confidence: 0.3 })],
    ];
    for (const shapes of cases) {
      const score = scoreDecomposition(shapes);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// 2.6 — CLAIM-TYPE DRIVEN DECOMPOSITION
// =============================================================================

describe('2.6 — Claim-Type Detection', () => {
  const cases: [Partial<Predicate>, ClaimType][] = [
    [{ type: 'db', assertion: 'table_exists' }, 'existence'],
    [{ type: 'db', assertion: 'column_exists' }, 'existence'],
    [{ type: 'db', assertion: 'column_type' }, 'equality'],
    [{ type: 'filesystem_exists' }, 'existence'],
    [{ type: 'filesystem_absent' }, 'absence'],
    [{ type: 'filesystem_unchanged' }, 'invariance'],
    [{ type: 'filesystem_count' }, 'equality'],
    [{ type: 'http_sequence' }, 'ordering'],
    [{ type: 'http', expect: { bodyContains: 'test' } }, 'containment'],
    [{ type: 'http', expect: { status: 200 } }, 'equality'],
    [{ type: 'content' }, 'containment'],
    [{ type: 'html', expected: 'exists' }, 'existence'],
    [{ type: 'html', expected: 'Welcome' }, 'containment'],
    [{ type: 'css' }, 'equality'],
  ];

  for (const [pred, expected] of cases) {
    test(`${pred.type}${pred.assertion ? ` (${pred.assertion})` : ''} → ${expected}`, () => {
      expect(detectClaimType(pred as Predicate)).toBe(expected);
    });
  }
});

describe('2.6 — Claim-Type Routing', () => {
  test('existence claim routes to existence shapes', () => {
    const pr = makePredResult({ type: 'html', passed: false, expected: 'exists', actual: '(not found)' });
    const shapes = decomposeByClaimType('existence', pr);
    expect(shapes.some(s => s.id === 'H-01')).toBe(true);
  });

  test('equality claim routes to equality shapes', () => {
    const pr = makePredResult({ type: 'css', passed: false, expected: 'bold', actual: 'normal' });
    const shapes = decomposeByClaimType('equality', pr);
    expect(shapes.some(s => s.id === 'C-33')).toBe(true);
  });

  test('containment claim routes to containment shapes', () => {
    const pr = makePredResult({ type: 'content', passed: false });
    const shapes = decomposeByClaimType('containment', pr);
    expect(shapes.some(s => s.id === 'N-06')).toBe(true);
  });

  test('ordering claim routes to ordering shapes', () => {
    const pr = makePredResult({ type: 'http_sequence', passed: false });
    const shapes = decomposeByClaimType('ordering', pr);
    expect(shapes.some(s => s.id === 'P-09')).toBe(true);
  });

  test('wrong claim type returns no shapes', () => {
    const pr = makePredResult({ type: 'css', passed: false, expected: 'bold', actual: 'normal' });
    const shapes = decomposeByClaimType('ordering', pr);
    expect(shapes.length).toBe(0);
  });
});

// =============================================================================
// 2.7 — TEMPORAL INTEGRATION
// =============================================================================

describe('2.7 — Temporal Mode Detection', () => {
  const cases: [string, TemporalMode][] = [
    ['stale cache returned', 'fresh'],
    ['cached response', 'fresh'],
    ['outdated stylesheet', 'fresh'],
    ['timeout waiting for container', 'settled'],
    ['timed out after 30s', 'settled'],
    ['race condition in writes', 'stable'],
    ['concurrent access detected', 'stable'],
    ['sequence step 2 failed', 'ordered'],
    ['hydration not complete', 'settled'],
    ['transition not finished', 'stable'],
    ['animation midpoint captured', 'stable'],
  ];

  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, () => {
      expect(detectTemporalMode({ error: text })).toBe(expected);
    });
  }

  test('non-temporal text returns undefined', () => {
    expect(detectTemporalMode({ error: 'CSS value is wrong' })).toBeUndefined();
    expect(detectTemporalMode({ error: 'search string not found' })).toBeUndefined();
  });

  test('empty/undefined returns undefined', () => {
    expect(detectTemporalMode({})).toBeUndefined();
  });
});

describe('2.7 — Temporal Annotation', () => {
  test('annotates shapes with detected temporal mode', () => {
    const shapes = [makeShape('C-33', 'css'), makeShape('H-01', 'html')];
    const result = annotateTemporalMode(shapes, { error: 'stale cache returned' });
    for (const s of result) {
      expect(s.temporal).toBe('fresh');
    }
  });

  test('leaves shapes unchanged when no temporal signal', () => {
    const shapes = [makeShape('C-33', 'css')];
    const result = annotateTemporalMode(shapes, { error: 'value is wrong' });
    expect(result[0].temporal).toBeUndefined();
  });

  test('temporal mode integrates into decomposeFailure', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', false, 'stale cache returned: search string not found')],
    }));
    expect(r.shapes.some(s => s.id === 'X-37')).toBe(true);
    expect(r.shapes.find(s => s.id === 'X-37')?.temporal).toBe('fresh');
  });

  test('temporal mode integrates into decomposeObservation', () => {
    const shapes = decomposeObservation({ error: 'timeout: search string not found' });
    expect(shapes.some(s => s.id === 'X-37')).toBe(true);
    expect(shapes.find(s => s.id === 'X-37')?.temporal).toBe('settled');
  });

  test('does not mutate input shapes', () => {
    const shapes = [makeShape('C-33', 'css')];
    const result = annotateTemporalMode(shapes, { error: 'cached data' });
    expect(shapes[0].temporal).toBeUndefined(); // original unchanged
    expect(result[0].temporal).toBe('fresh');    // new copy annotated
  });

  test('temporal coexists with primary surface shape', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('staging', false, 'timeout: container health check failed: 502')],
    }));
    // Should have both an infrastructure shape AND temporal annotation
    const infraShape = r.shapes.find(s => s.id === 'I-02');
    expect(infraShape).toBeDefined();
    expect(infraShape!.temporal).toBe('settled');
  });
});

// =============================================================================
// INTEGRATION: FULL PIPELINE (MINIMIZE + SORT + TEMPORAL + OUTCOME)
// =============================================================================

describe('Full Pipeline Integration', () => {
  test('complex multi-domain failure: sorted, minimized, temporal', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'timeout: predicate failed')],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: '#ff0000', actual: 'red' }),
        makePredResult({ predicateId: 'p2', type: 'http', passed: false, expected: 'status 200' }),
      ],
    }));

    // Composition detected (css + http)
    expect(r.composition).toBeDefined();

    // C-01 present, C-33 dominated away
    expect(r.shapes.some(s => s.id === 'C-01')).toBe(true);
    expect(r.shapes.some(s => s.id === 'C-33')).toBe(false);

    // HTTP shape present
    expect(r.shapes.some(s => s.id === 'P-07')).toBe(true);

    // Temporal annotation from "timeout" in gate detail
    expect(r.shapes.every(s => s.temporal === 'settled')).toBe(true);

    // Primary surfaces sort before cross-cutting
    const cssIdx = r.shapes.findIndex(s => s.domain === 'css');
    const httpIdx = r.shapes.findIndex(s => s.domain === 'http');
    const crossIdx = r.shapes.findIndex(s => s.domain === 'cross-cutting');
    if (cssIdx >= 0 && crossIdx >= 0) {
      expect(cssIdx).toBeLessThan(crossIdx);
    }
  });

  test('success with accidental correctness: shapes + outcome align', () => {
    const r = decomposeFailure(makeResult({
      success: true,
      gates: [makeGate('F9', true), makeGate('G5', true)],
      containment: { totalMutations: 5, direct: 2, scaffolding: 1, unexplained: 2 },
    }));
    expect(r.outcome).toBe('misleading_success');
    expect(r.shapes.some(s => s.id === 'AT-05')).toBe(true);
    expect(r.fullyClassified).toBe(true);
  });

  test('deterministic: same complex input → identical output 10x', () => {
    const input = makeResult({
      gates: [makeGate('F9', true), makeGate('staging', false, 'build failure: exit code 1')],
      predicateResults: [
        makePredResult({ predicateId: 'p1', type: 'css', passed: false, expected: '0px', actual: '0' }),
        makePredResult({ predicateId: 'p2', type: 'html', passed: true }),
      ],
      containment: { totalMutations: 2, direct: 1, scaffolding: 0, unexplained: 1 },
    });

    const baseline = decomposeFailure(input);
    for (let i = 0; i < 10; i++) {
      const r = decomposeFailure(input);
      expect(r.shapes.map(s => s.id)).toEqual(baseline.shapes.map(s => s.id));
      expect(r.shapes.map(s => s.temporal)).toEqual(baseline.shapes.map(s => s.temporal));
      expect(r.outcome).toBe(baseline.outcome);
      expect(r.composition).toEqual(baseline.composition);
    }
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  test('all gates pass but success=false → fail (no shapes)', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true), makeGate('staging', true)],
    }));
    expect(r.outcome).toBe('fail');
    expect(r.shapes.length).toBe(0);
    expect(r.fullyClassified).toBe(false);
  });

  test('empty predicateResults array does not crash', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [],
    }));
    expect(r.shapes.length).toBe(0);
  });

  test('predicate with only type (no expected/actual) maps correctly', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('F9', true)],
      predicateResults: [
        makePredResult({ type: 'http_sequence', passed: false }),
      ],
    }));
    expect(r.shapes.some(s => s.id === 'P-09')).toBe(true);
  });

  test('multiple different grounding misses produce distinct shapes', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('grounding', false, 'fabricated')],
      effectivePredicates: [
        { id: 'p1', type: 'css', fingerprint: 'f1', groundingMiss: true },
        { id: 'p2', type: 'db', fingerprint: 'f2', groundingMiss: true },
      ],
    }));
    expect(r.shapes.some(s => s.id === 'X-60')).toBe(true);
    expect(r.shapes.some(s => s.id === 'X-61')).toBe(true);
  });

  test('vision triangulation shapes detected from result.triangulation', () => {
    const r = decomposeFailure(makeResult({
      success: false,
      gates: [makeGate('F9', true)],
      triangulation: {
        action: 'escalate', confidence: 'majority', outlier: 'browser',
        authorities: { deterministic: 'pass', browser: 'fail', vision: 'pass' },
        authorityCount: 3, reasoning: 'browser outlier',
      },
    }));
    expect(r.shapes.some(s => s.id === 'V-03')).toBe(true);
  });

  test('MSG-01 detected when message gate fails', () => {
    const r = decomposeFailure(makeResult({
      gates: [makeGate('message', false, 'topic policy violation')],
    }));
    expect(r.shapes.some(s => s.id === 'MSG-01')).toBe(true);
  });
});

// =============================================================================
// DIAGNOSTICS
// =============================================================================

describe('computeDecompositionDiagnostics', () => {
  function makeShape(overrides: Partial<DecomposedShape> = {}): DecomposedShape {
    return {
      id: 'C-01',
      name: 'test',
      domain: 'css',
      claimType: 'equality',
      truthType: 'structural',
      evidence: [],
      confidence: 1.0,
      ...overrides,
    };
  }

  function makeDecompResult(overrides: Partial<DecompositionResult> = {}): DecompositionResult {
    return {
      shapes: [makeShape()],
      outcome: 'hard_fail',
      fullyClassified: true,
      ...overrides,
    };
  }

  test('empty input returns zeroed diagnostics', () => {
    const d = computeDecompositionDiagnostics([]);
    expect(d.total).toBe(0);
    expect(d.singleShape).toBe(0);
    expect(d.multiShape).toBe(0);
    expect(d.empty).toBe(0);
    expect(d.composed).toBe(0);
    expect(d.temporalAnnotated).toBe(0);
    expect(d.fullyClassified).toBe(0);
    expect(d.meanScore).toBe(0);
    expect(Object.keys(d.domainDistribution)).toHaveLength(0);
    expect(Object.keys(d.claimTypeDistribution)).toHaveLength(0);
  });

  test('single-shape result counted correctly', () => {
    const d = computeDecompositionDiagnostics([makeDecompResult()]);
    expect(d.total).toBe(1);
    expect(d.singleShape).toBe(1);
    expect(d.multiShape).toBe(0);
    expect(d.empty).toBe(0);
  });

  test('multi-shape result counted correctly', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [makeShape(), makeShape({ id: 'H-01', domain: 'html' })] }),
    ]);
    expect(d.total).toBe(1);
    expect(d.singleShape).toBe(0);
    expect(d.multiShape).toBe(1);
  });

  test('empty-shape result counted correctly', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [] }),
    ]);
    expect(d.empty).toBe(1);
    expect(d.singleShape).toBe(0);
  });

  test('composed results counted', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ composition: ['C-01', 'H-01'] }),
      makeDecompResult(),
    ]);
    expect(d.composed).toBe(1);
  });

  test('fullyClassified counted', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ fullyClassified: true }),
      makeDecompResult({ fullyClassified: false }),
      makeDecompResult({ fullyClassified: true }),
    ]);
    expect(d.fullyClassified).toBe(2);
  });

  test('temporal annotation detected from shape.temporal', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [makeShape({ temporal: 'settled' })] }),
      makeDecompResult({ shapes: [makeShape()] }), // no temporal
    ]);
    expect(d.temporalAnnotated).toBe(1);
  });

  test('domain distribution aggregated across shapes', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [makeShape({ domain: 'css' }), makeShape({ domain: 'html' })] }),
      makeDecompResult({ shapes: [makeShape({ domain: 'css' })] }),
    ]);
    expect(d.domainDistribution['css']).toBe(2);
    expect(d.domainDistribution['html']).toBe(1);
  });

  test('claimType distribution aggregated', () => {
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [makeShape({ claimType: 'equality' }), makeShape({ claimType: 'existence' })] }),
    ]);
    expect(d.claimTypeDistribution['equality']).toBe(1);
    expect(d.claimTypeDistribution['existence']).toBe(1);
  });

  test('meanScore computed correctly', () => {
    // scoreDecomposition returns 0 for empty shapes, positive for non-empty
    const d = computeDecompositionDiagnostics([
      makeDecompResult({ shapes: [makeShape({ confidence: 1.0 })] }),
      makeDecompResult({ shapes: [makeShape({ confidence: 0.5 })] }),
    ]);
    expect(d.meanScore).toBeGreaterThan(0);
    expect(typeof d.meanScore).toBe('number');
    expect(Number.isFinite(d.meanScore)).toBe(true);
  });

  test('mixed batch computes all fields', () => {
    const results: DecompositionResult[] = [
      makeDecompResult({ shapes: [], fullyClassified: false }),             // empty
      makeDecompResult({ shapes: [makeShape()], fullyClassified: true }),   // single
      makeDecompResult({                                                     // multi + composed + temporal
        shapes: [makeShape({ temporal: 'snapshot' }), makeShape({ id: 'H-01', domain: 'html', claimType: 'existence' })],
        composition: ['C-01', 'H-01'],
        fullyClassified: true,
      }),
    ];
    const d = computeDecompositionDiagnostics(results);
    expect(d.total).toBe(3);
    expect(d.empty).toBe(1);
    expect(d.singleShape).toBe(1);
    expect(d.multiShape).toBe(1);
    expect(d.composed).toBe(1);
    expect(d.temporalAnnotated).toBe(1);
    expect(d.fullyClassified).toBe(2);
    expect(d.meanScore).toBeGreaterThanOrEqual(0);
  });
});

describe('computeMinimizerReduction', () => {
  function shape(id: string): DecomposedShape {
    return {
      id, name: 'test', domain: 'css', claimType: 'equality',
      truthType: 'structural', evidence: [], confidence: 1.0,
    };
  }

  test('empty input returns zero rate', () => {
    const r = computeMinimizerReduction([]);
    expect(r.totalBefore).toBe(0);
    expect(r.totalAfter).toBe(0);
    expect(r.reductionRate).toBe(0);
  });

  test('no reduction when before == after', () => {
    const shapes = [shape('C-01'), shape('H-01')];
    const r = computeMinimizerReduction([{ before: shapes, after: shapes }]);
    expect(r.totalBefore).toBe(2);
    expect(r.totalAfter).toBe(2);
    expect(r.reductionRate).toBe(0);
  });

  test('50% reduction computed correctly', () => {
    const r = computeMinimizerReduction([
      { before: [shape('C-01'), shape('C-33')], after: [shape('C-01')] },
    ]);
    expect(r.totalBefore).toBe(2);
    expect(r.totalAfter).toBe(1);
    expect(r.reductionRate).toBe(0.5);
  });

  test('100% reduction when all shapes removed', () => {
    const r = computeMinimizerReduction([
      { before: [shape('C-01')], after: [] },
    ]);
    expect(r.reductionRate).toBe(1);
  });

  test('aggregates across multiple batches', () => {
    const r = computeMinimizerReduction([
      { before: [shape('C-01'), shape('C-33')], after: [shape('C-01')] },       // 2 → 1
      { before: [shape('H-01'), shape('H-02'), shape('H-03')], after: [shape('H-01')] }, // 3 → 1
    ]);
    expect(r.totalBefore).toBe(5);
    expect(r.totalAfter).toBe(2);
    expect(r.reductionRate).toBeCloseTo(0.6, 5);
  });

  test('works with real minimizeShapes output', () => {
    const before = [
      shape('C-01'),  // specific: color mismatch
      shape('C-33'),  // generic: value mismatch (dominated by C-01)
    ];
    const after = minimizeShapes(before);
    const r = computeMinimizerReduction([{ before, after }]);
    expect(r.totalBefore).toBeGreaterThanOrEqual(r.totalAfter);
    expect(r.reductionRate).toBeGreaterThanOrEqual(0);
    expect(r.reductionRate).toBeLessThanOrEqual(1);
  });
});
