# Handoff: Moves 16-19 — Infrastructure Runtime Phase

Written March 24, 2026 by Claude (Opus 4.6) after completing Moves 7-15 across multiple sessions. This document transfers accumulated context to a new context window.

## Read These First (in order)

1. **`ASSESSMENT.md`** — What verify IS. The value hierarchy. Do not form opinions before reading this.
2. **`NEXT-MOVES.md`** — The build plan. Moves 7-15 are complete. Moves 16-19 are your work.
3. **`FAILURE-TAXONOMY.md`** — The algebra of failure shapes. Every shape ID referenced in scenarios comes from here.
4. **`README.md`** — The public-facing docs. Keep numbers synchronized.

## Current State (verified March 24, 2026)

| Metric | Value |
|--------|-------|
| Total scenarios | **669** (12 families) |
| Failure classes covered | **350** / 579 (60%) |
| Shape rules in decompose.ts | **259** across 18 domains |
| Known bugs | **3** (N-07 case-sensitive content, PERF-06 unminified small files — both pre-existing) |
| npm version | 0.3.1 |
| Gates | 17 (all implemented) |

### Family Breakdown (from self-test)

| Family | Count | Status |
|--------|-------|--------|
| A (fingerprints) | 20 | clean |
| B (K5 constraints) | 14 | clean |
| C (gate sequencing) | 7 | clean |
| D (G5 containment) | 23 | clean |
| E (grounding + edge cases) | 114 | 1 dirty (N-07) |
| G (everything else) | 323 | 1 dirty (PERF-06) |
| H (filesystem) | 47 | clean |
| I (interactions) | 28 | clean |
| L (convergence/govern) | 15 | clean |
| M (message gate) | 21 | clean |
| P (HTTP gate) | 43 | clean |
| V (vision + triangulation) | 14 | clean |

## Critical Architecture Knowledge

### Entry Points (DON'T GET THIS WRONG)

- **CLI entry**: `scripts/self-test.ts` — imports and calls `runSelfTest()` from runner.ts
- **Runner library**: `scripts/harness/runner.ts` — exports `runSelfTest()`, has NO main entry point
- **Scenario generator**: `scripts/harness/scenario-generator.ts` — exports `generateAllScenarios(appDir)` and family-specific `generateFamilyX(appDir)` functions
- **Decomposition engine**: `src/store/decompose.ts` — exports `decomposeFailure()`, `getShapeCatalog()`, shape rule definitions

**Never** run `bun scripts/harness/runner.ts` directly — it produces no output. Always use `bun scripts/self-test.ts`.

### Runner Phases

The self-test runner has 3 phases:

1. **Phase 1 (Pure, Parallel)**: All scenarios with `requiresDocker: false` and no `requiresHttp` flag. Runs in parallel via `Promise.all` for speed.
2. **Phase 1.5 (HTTP Mock, Sequential)**: Scenarios that need the HTTP mock server. Runner starts `http.createServer` on port 13579, runs scenarios sequentially (shared port), then shuts down.
3. **Phase 2 (Multi-step K5, Sequential)**: Scenarios that need sequential state (multi-step constraint learning). Identified by `multiStep: true` flag.

**For Moves 16-17**: You'll need to add a **Phase 3 (Docker)** or extend Phase 1.5. The P-family Docker scenarios (18 of 43) already exist but are skipped when Docker isn't available — they have `requiresDocker: true`.

### Scenario Structure

Every scenario in `scenario-generator.ts` follows this shape:

```typescript
scenarios.push({
  id: nextId('X', 'descriptive_name'),  // Family letter + descriptive ID
  family: 'X',                          // Family letter
  generator: 'descriptive_name',        // Unique name within family
  failureClass: 'SHAPE-ID',             // From FAILURE-TAXONOMY.md
  description: 'SHAPE-ID: Human-readable description',
  edits: [{ file: 'server.js', search: '...', replace: '...' }],
  predicates: [{ type: 'css', selector: 'h1', property: 'color', expected: 'red', path: '/' }],
  config: {
    appDir,
    gates: { staging: false, browser: false, http: false },
    // Optional: constraints, stateDir, invariants, etc.
  },
  invariants: [groundingRan(), shouldNotCrash('description')],
  requiresDocker: false,  // true for Docker scenarios
});
```

### The Fixture App

`fixtures/demo-app/server.js` — a vanilla Node.js HTTP server with 5 routes:
- `/` — Homepage with CSS, nav, item list
- `/about` — Rich page with hero, cards, team list, search, data table
- `/form` — Contact form with validation
- `/edge-cases` — CSS edge cases (minified, `@keyframes`, `@media`, shorthand, flex, grid, overflow, etc.)
- `/api/items` — JSON API
- `/api/echo` — POST echo
- `/health` — Health check

This is the ONLY fixture app. All 669 scenarios test against it. For DB scenarios, you'll need `fixtures/demo-app/init.sql` (already exists with basic tables).

### Decomposition Engine Architecture

`src/store/decompose.ts` has three key parts:

1. **Shape rules**: Objects with `{ id, domain, predicateMatch, resultMatch }` — patterns that match against `VerifyResult` observations
2. **DOMINANCE map**: Controls which specific shapes suppress generic ones (e.g., C-05 "named color" suppresses C-01 "generic mismatch")
3. **`decomposeFailure(result)`**: Runs all rules against a result, applies dominance, returns `DecomposedShape[]`

When adding new shapes for Moves 16-19, you need BOTH:
- The shape rule in `decompose.ts` (so the engine can recognize the failure)
- The scenario in `scenario-generator.ts` (so the harness tests for it)

### invariants (Scenario Test Assertions)

Scenarios use `invariants` to assert expected behavior:
- `groundingRan()` — Grounding gate executed
- `shouldNotCrash(description)` — verify() didn't throw
- `predicateIsGrounded(index, reason)` — Specific predicate was grounded with a specific reason
- `predicatePassed(index)` / `predicateFailed(index)` — Predicate pass/fail assertion
- `gatePassedAll()` / `gateFailed(gateName)` — Gate-level assertions
- `verifySucceeded(description)` / `verifyFailed(description)` — Overall result assertions

These are defined at the top of `scenario-generator.ts`. For Docker scenarios, you may need new invariant helpers.

## What Moves 16-19 Actually Require

### Move 16: Postgres Instance (~46 shapes)

**The Goal**: Test DB predicates (`db` type) against a real Postgres instance instead of just parsing `init.sql`.

**What exists today**:
- `validateDB()` in `src/verify.ts` validates `db` predicates against `init.sql` schema (static parsing)
- 18 DB scenarios (D-01 through D-20) test static schema validation
- `fixtures/demo-app/init.sql` has table definitions

**What you need to build**:
1. `fixtures/docker-compose.test.yml` — Postgres service, port 15432 (avoid conflicts)
2. `fixtures/db-harness.ts` — Connect to Postgres, run init.sql, provide query interface, teardown
3. New scenarios testing LIVE DB behavior: row counts, data integrity after migration, constraint violations, deadlocks, transaction isolation
4. New shapes in `decompose.ts` for DB runtime failures (D-21+)
5. Runner integration — probably a new Phase 3 that starts Docker before running Docker-dependent scenarios

**Key insight from building HTTP mock**: The HTTP mock (Move 13) was added as Phase 1.5 in the runner — a new sequential phase between pure parallel and multi-step K5. For Postgres, you'll likely want Phase 3 (after Phase 2), since it needs Docker startup/teardown which is slow.

**Watch out for**:
- Port conflicts on CI machines
- Docker startup time (warm vs cold)
- Cleanup between scenarios (truncate tables, reset sequences)
- Connection pooling (don't open 50 connections for 50 scenarios)

### Move 17: Docker Staging Lifecycle (~15 shapes)

**The Goal**: Test the staging gate's actual runtime behavior — Docker build, container start, health check, etc.

**What exists today**:
- The staging gate in `src/verify.ts` is implemented but most scenarios disable it (`gates: { staging: false }`)
- 6 F-family scenarios test Docker build but require Docker
- The `config.docker` options control staging behavior

**What you need to build**:
1. `fixtures/docker-staging/` — Dedicated Dockerfile and docker-compose.yml for staging gate tests
2. A staging harness that builds, starts, and tears down containers
3. Scenarios for: build failure (bad Dockerfile), start failure (port conflict), health check timeout, env var injection, etc.
4. STG-* shapes in decompose.ts

**Key insight**: Keep staging scenarios minimal and fast. Each Docker build is 10-30s. With 12 scenarios at 15s each, that's 3 minutes. Consider sharing a single built image across multiple scenarios where possible.

### Move 18: Cross-cutting Runtime (~47 shapes)

**The Goal**: Test multi-gate interactions with real side effects — temporal ordering, observer effects, concurrency.

**What exists today**:
- Some cross-cutting scenarios exist (X-01 through X-75) but most are pure (no Docker)
- Temporal modes (TO-*), observer effects (OE-*), concurrency (CO-*) shapes have some coverage but lack runtime validation

**What you need to build**:
1. Integration scenarios that exercise multiple gates in sequence with real timing
2. Temporal scenarios: file changes during verify, stale grounding, timing windows
3. Observer effect scenarios: HTTP check triggers rate limit, verify changes app state
4. Gate correlation scenarios: staging passes but browser fails

**Key insight**: These are the hardest scenarios to make deterministic. Use controlled timing (explicit delays, known state) rather than hoping for race conditions. The value is in PROVING that verify handles these correctly, not in reproducing production chaos.

### Move 19: Coverage Completion + Thesis Defense

**The Goal**: Audit remaining uncovered shapes, close reachable gaps, mark unreachable shapes as theoretical, ship v1.0.0.

**What you need to do**:
1. Run `getShapeCatalog()` and cross-reference with the self-test summary's `failureClassCoverage`
2. For each uncovered shape: can it be reached with existing infrastructure? If yes, write it. If no, mark it `theoretical`.
3. Update all docs (ASSESSMENT.md, README.md, FAILURE-TAXONOMY.md)
4. Final self-test: 0 bugs, 0 unexpected
5. Bump version to 1.0.0 in package.json

## Lessons Learned (from 15 moves of development)

### 1. The fixture app is your constraint

Every scenario runs against `fixtures/demo-app/server.js`. When a shape requires a specific HTML structure or CSS rule that doesn't exist, you have two choices: (a) modify server.js to include it, or (b) design the scenario around what's already there. Choice (b) is almost always better — server.js is already rich with structure (5 pages, CSS, forms, tables, lists, nav, API endpoints).

### 2. `noopEdit` is family-scoped

The `noopEdit` helper variable (`[{ file: 'server.js', search: 'const http', replace: 'const http' }]`) is defined locally in some family generators but not others. If a scenario doesn't need real edits (testing grounding, or testing predicate validation), use the inline form. Don't reference `noopEdit` in a generator that doesn't define it.

### 3. Shape rules need to match SPECIFIC observations

A shape rule in decompose.ts with only a `resultMatch` (no `predicateMatch`) is too broad — it'll fire for many unrelated failures. Always include a `predicateMatch` when possible to narrow which scenarios trigger the shape.

### 4. DOMINANCE matters

When you add a specific shape (like C-05 "named color mismatch"), add it to the DOMINANCE map so it suppresses the generic shape (C-01 "generic CSS mismatch"). Otherwise both shapes fire for the same failure, which is confusing.

### 5. Test incrementally

After adding each batch of 3-5 scenarios, run `bun scripts/self-test.ts` to verify. Don't write 30 scenarios and then debug them all at once. The error output is helpful but the harness is 669 scenarios — finding your broken one in the output is tedious.

### 6. The HTTP mock was the breakthrough

Move 13 (HTTP server mock) was the single biggest coverage expansion — 25 new scenarios in one move. It taught us that you don't always need Docker. A simple `http.createServer` on a test port can validate HTTP predicates without any containers. Consider whether Postgres scenarios could use a similar lightweight approach (e.g., SQLite as a standin for simple schema tests, with Docker Postgres only for Postgres-specific behavior).

### 7. Pre-existing bugs are documented, not fixed

N-07 (case-sensitive content matching) and PERF-06 (unminified assets threshold for small files) are KNOWN bugs in verify's pipeline code, not in the test harness. They're tracked as dirty scenarios. The improve loop is designed to eventually fix these autonomously. Don't spend time fixing pipeline bugs — the coverage work is more valuable.

### 8. Numbers drift — keep docs synchronized

After every significant batch of scenario additions, update the numbers in:
- `NEXT-MOVES.md` — the "Where We Are" table
- `ASSESSMENT.md` — the Current State table
- `README.md` — the scenario counts, family table, and summary paragraph

These four docs were stale by 60+ scenarios before this session caught it. The self-test summary JSON (`data/self-test-summary-*.json`) is the source of truth.

## Quick Start for the New Context

```bash
# 1. Verify current state
cd packages/verify
bun scripts/self-test.ts
# Expected: 3 bugs | 669 scenarios | 0 unexpected

# 2. Read the docs (in order)
# ASSESSMENT.md → NEXT-MOVES.md → FAILURE-TAXONOMY.md

# 3. Understand the generator structure
# Read scripts/harness/scenario-generator.ts (big file — focus on one generateFamily* at a time)

# 4. Start with Move 16 (Postgres)
# - Create fixtures/docker-compose.test.yml
# - Create fixtures/db-harness.ts
# - Add Phase 3 to scripts/harness/runner.ts
# - Write scenarios incrementally (3-5 at a time, test between batches)

# 5. After each move, update numbers in all docs
```

## The End State

When Moves 16-19 are complete:
- **~750+ scenarios** across 12 families
- **~500/579 failure classes** covered (86%+)
- **~300+ decomposition rules** across 18+ domains
- **All infrastructure gates** exercised (Docker, Postgres, staging lifecycle)
- **v1.0.0** on npm

The thesis: a finite algebra of failure shapes can make AI agents converge instead of flail. Every known way a predicate can disagree with reality has a name, a generator, a decomposition rule, and a narrowing hint. `govern()` speaks this language. The taxonomy is complete.
