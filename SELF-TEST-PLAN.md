# Verify Self-Test Loop — Autoresearch-Style Autonomous Bug Discovery

## Context

The `@sovereign-labs/verify` package (v0.3.0) has a 12-gate verification pipeline (Grounding→F9→K5→G5→Filesystem→Staging→Browser→HTTP→Invariants→Vision→Triangulation→Narrowing). The v0.1.1 fingerprint bug — where HTTP predicates with different `bodyContains` values produced identical fingerprints — was only caught by manual inspection. An autonomous testing loop would have found it by generating HTTP predicates with varying `expect` values and checking that K5 distinguishes them. This plan designs that loop.

**Inspiration:** Karpathy's autoresearch pattern (edit → evaluate → keep/discard → repeat) applied to verify's own test surface. Users on X report autoresearch finding bugs in their own projects overnight. We want the same for verify.

**Existing patterns to reuse:** Sovereign's self-improvement engine (`packages/kernel/src/adapters/improvement-engine.ts`) — subprocess isolation, bounded surface, ledger audit trail.

## Architecture

```
self-test.ts (CLI entry)
  → scenario-generator.ts (9 families × ~15 generators = ~80+ scenarios)
  → external-scenario-loader.ts (loads fault-derived scenarios from .verify/custom-scenarios.json)
  → runner.ts (orchestrate: generate → execute → check → record)
  → oracle.ts (property-based invariant checks)
  → ledger.ts (append-only JSONL recording)
  → report.ts (summary generation)
  → docker-pool.ts (container lifecycle for full pipeline scenarios)
```

## Scenario Families (9)

| Family | What it tests | Docker? | ~Count | Key bug class |
|--------|--------------|---------|--------|---------------|
| **A: Fingerprint Collision** | Same predicate type, different field values must produce different fingerprints | No | 15 | The v0.1.1 bug class |
| **B: K5 Constraint Learning** | Monotonicity, corrected predicates pass, same predicates blocked, TTL, cross-session | No | 12 | Constraint poisoning |
| **C: Gate Sequencing** | F9 before K5, K5 before staging, deterministic order, gate skip config | No | 8 | Gate ordering bugs |
| **D: Containment (G5)** | Direct/scaffolding/unexplained attribution math | No | 6 | Attribution arithmetic |
| **E: Grounding** | Real selectors found, fabricated selectors missed, route discovery | No | 6 | Grounding false negatives |
| **F: Full Pipeline** | Valid CSS edit passes, wrong predicate fails, invariant-breaking edit caught | Yes | 5-10 | End-to-end regressions |
| **G: Edge Cases** | Empty inputs, unicode, very long strings, binary chars, no-op edits | No | 10 | Crash/hang bugs |

### Family A detail (the inspiring bug class)

Generators produce **pairs** of predicates that differ in exactly one field. Oracle asserts `predicateFingerprint(a) !== predicateFingerprint(b)`:

- `A1`: HTTP predicates differing in `expect.status` (200 vs 404)
- `A2`: HTTP predicates differing in `expect.bodyContains` ("Alpha" vs "Beta")
- `A3`: `http_sequence` predicates with different step orderings
- `A4`: CSS predicates differing in `expected` value
- `A5`: Same type/selector, different `path`
- `A6`: Optional field present vs absent (e.g., with/without `property`)
- `A7`: DB predicates differing in `table` or `assertion`
- `A8`: **Canonicalization traps** — absent field vs `undefined` vs explicit `null`; numeric `200` vs string `"200"`; whitespace/casing differences in string fields; semantically equivalent but structurally different objects
- `A9`: **Triplets + permutations** — 3 predicates where any 2 differ in one field; step arrays in different orders
- `A10`: **Regression guard** — intentionally break `predicateFingerprint()` (strip `expect` handling), confirm Family A catches it. This turns v0.1.1 into a permanent regression test.

### Family B detail (K5 learning invariants)

Multi-step scenarios — ordered verify() calls within a session:

- `B1`: 3 sequential failures → constraint count monotonically non-decreasing
- `B2`: Fail with predicate A, retry with predicate B (different fingerprint) → K5 must NOT block B
- `B3`: Fail with predicate A, retry with identical A → K5 MUST block A
- `B4`: Seed constraint, manipulate `expiresAt` to past → constraint should not fire
- `B5`: Seed in session 1, reload store, check in session 2 → constraints persist
- `B6`: Seed 6+ constraints → max depth enforcement (cap at 5)
- `B7`: Override bypass via `overrideConstraints`
- `B8`: DNS/connection error (harness fault) → no constraint seeded
- `B9`: **Scope leakage** — same fingerprint across different routes/files/apps should not cross-pollinate constraints; same predicate on different `path` should be independently trackable
- `B10`: **Cross-session with altered config** — seed constraints, change config between sessions, verify scope isolation

## Oracle (Invariant Checker)

**Two invariant categories** (GPT's best insight — separating these prevents "is verify wrong or is the harness wrong?" confusion):

### Product invariants (verify is correct)
1. `success` is boolean, `gates` is non-empty array
2. If `success === true`, all gates passed. If `success === false`, at least one gate failed
3. Constraint count never decreases within a session
4. Same predicate → same fingerprint (determinism), including after serialization round-trips
5. No individual gate > 5 minutes
6. **First failing gate is the reported failing gate** — downstream gates don't fabricate evidence
7. Skipped gates are explicitly marked skipped, not silently absent

### Harness invariants (self-test harness is correct)
1. verify() completes without throwing (wrapped in try/catch)
2. Temp state dirs cleaned up after each scenario
3. Ledger append succeeds
4. Docker project names don't collide across concurrent scenarios

**Scenario-specific invariants** attached per-family (described above).

**Severity classification:**
- `bug` — invariant violation that indicates a real defect (fingerprint collision, K5 false positive/negative)
- `unexpected` — behavior that's suspicious but might be valid (gate took >30s)
- `info` — interesting observation (e.g., constraint store grew by more than expected)

## Execution Harness

**Phase 1 — Pure scenarios (~80):** Families A-E, G. Run in `Promise.all` batches of 10. <100ms each. Total: ~30 seconds.

**Phase 2 — Docker scenarios (~5-10):** Family F. Sequential (Lenovo has 8GB RAM). Build demo-app image once, reuse across scenarios. ~3-5 min each. Total: ~25-50 minutes.

**Phase 3 — Multi-step K5 (~10):** Family B sequences. Sequential within each scenario, parallel across independent scenarios.

**State isolation:** Each scenario gets `${tmpdir}/verify-selftest-${id}/` as stateDir. Cleaned up in `finally` block.

**Docker cleanup:** `process.on('exit')` handler + unique project names (`verify-selftest-*`) for sweep. **On startup**, sweep any leaked `verify-selftest-*` containers from prior crashed runs before starting new scenarios.

**Hard budgets:** Max 10 min per scenario, max 4 hours total run, max 1 Docker retry on timeout.

## Ledger

**File:** `packages/verify/data/self-test-ledger.jsonl` (append-only, one JSON per line)

```typescript
interface LedgerEntry {
  id: string;                    // scenario_${timestamp}_${index}
  timestamp: string;             // ISO 8601
  scenario: { family, generator, description, predicates, config };
  result: { success, gatesPassed, gatesFailed, totalMs, constraintsBefore, constraintsAfter };
  invariants: Array<{ name, category, passed, violation?, severity? }>;
  clean: boolean;                // all invariants passed?
  worstSeverity?: 'bug' | 'unexpected' | 'info';
}

// Run-level identity (GPT's insight — enables longitudinal analysis)
interface RunIdentity {
  runId: string;
  packageVersion: string;        // from package.json
  gitCommit?: string;            // git rev-parse HEAD (if available)
  runtime: string;               // bun version
  platform: string;              // process.platform + arch
  dockerVersion?: string;        // for Docker-backed runs
}
```

**Summary:** `packages/verify/data/self-test-summary-{runId}.json` — generated at end of each run. Includes one-liner for grep: `"0 bugs | 97 scenarios | 2 unexpected | Family A: clean"`

## File Structure

```
packages/verify/scripts/
  self-test.ts                    # CLI entry: bun run packages/verify/scripts/self-test.ts
  harness/
    types.ts                      # All shared types
    scenario-generator.ts         # 7 families of generators
    external-scenario-loader.ts   # Deserialize fault-derived scenarios into VerifyScenario
    oracle.ts                     # Invariant checks
    docker-pool.ts                # Docker lifecycle
    ledger.ts                     # JSONL persistence
    runner.ts                     # Orchestrator (pure, multi-step, Docker phases)
    report.ts                     # Summary/console output
    improve.ts                    # Improve loop orchestrator
    improve-triage.ts             # Deterministic triage (0 LLM tokens)
    improve-prompts.ts            # LLM diagnosis + candidate generation
    improve-subprocess.ts         # Copy, overlay, subprocess run, holdout (capped scoring)
    improve-report.ts             # Improve result formatting
    claude-improve.ts             # Claude-specific prompts with architectural context
    llm-providers.ts              # Gemini/Anthropic/Ollama fetch wrappers
packages/verify/data/             # Gitignored, runtime output
  self-test-ledger.jsonl
  self-test-summary-*.json
  improvement-ledger.jsonl
```

## CLI Usage

```bash
# Full run against demo-app (default, pure only, ~2s)
bun run packages/verify/scripts/self-test.ts

# Against a real app (built-in scenarios run against demo-app, external against target)
bun run packages/verify/scripts/self-test.ts --appDir=apps/football

# With Docker (includes Family F, ~80s on Lenovo)
bun run packages/verify/scripts/self-test.ts --docker=true

# Specific families
bun run packages/verify/scripts/self-test.ts --families=A,B

# CI mode: exit 1 if any bug-severity violations found
bun run packages/verify/scripts/self-test.ts --fail-on-bug

# Improve loop — detect bugs + propose fixes
bun run packages/verify/scripts/self-test.ts --improve --llm=gemini --api-key=$GEMINI_API_KEY

# Improve dry run — triage only, no LLM calls
bun run packages/verify/scripts/self-test.ts --improve --dry-run --llm=gemini --api-key=$GEMINI_API_KEY
```

### Fixture Isolation (--appDir)

When `--appDir` points to a different app, the runner isolates built-in vs external scenarios:

- **Built-in scenarios** (families A-G, 50 pure / 56 with Docker): Always run against `fixtures/demo-app`. They hardcode demo-app's CSS selectors (`.subtitle`, `h1 { color: #1a1a2e }`), text content (`Demo App`, `Alpha`), and routes. Running them against a different app produces noise, not signal.
- **External scenarios** (from `{appDir}/.verify/custom-scenarios.json`): Run against the target app. These are fault-derived — they encode real bugs discovered by campaigns or chaos runs against that specific app.

This means a user running `--appDir=my-app` sees: built-in scenarios proving verify's gates work (against the fixture), plus external scenarios proving verify works on their app. No false failures from selector mismatches.

## Campaign Integration

Can run as a Sovereign campaign goal on the Lenovo via `sovereign_agent_start`:
- Goal: `"Run verify self-test suite and report findings"`
- Agent executes `bun run packages/verify/scripts/self-test.ts` via shell
- Campaign scheduler triggers nightly via `cron` mode
- Morning report includes self-test summary
- `bug`-severity violations pause the campaign

## Connection to Improve Loop

When the self-test finds bugs:
1. Ledger entry = the "gap" (benchmark that fails)
2. Scenario = the reproduction case
3. Bounded surface = 8 files in `packages/verify/src/` (constraint-store.ts, gates/*.ts)
4. Verification = re-run same scenario after proposed fix → invariant now passes
5. Holdout = 30% of clean scenarios catch overfitting

The improve loop is driven via MCP tools (`verify_improve_discover` → `verify_improve_diagnose` → `verify_improve_submit` → `verify_improve_apply`) with Claude Code as the primary doctor, or via `verify_improve_cycle` with Gemini/Anthropic as fallback.

**Scoring formula:** `improvements - (regressions × 10) - min(changedLines × 0.1, 3.0)`. Line penalty is capped at 3.0 so correct large fixes aren't penalized to death.

## Build Order

1. **Fingerprint & Edge Cases:** Families A + G + oracle + ledger + runner (~600 LOC) — fingerprint collision detection + edge cases. Immediate value, no Docker.
2. **Constraint Learning & Gate Sequencing:** Family B (K5 learning) + Family C (gate sequencing) (~400 LOC) — constraint invariants.
3. **Full Pipeline:** Family F + docker-pool (~300 LOC) — full pipeline scenarios on real Docker.
4. **Containment & Grounding:** Family D + E (containment + grounding) — refinement.
5. **Campaign Integration:** CLI flags, report polish, campaign scheduler integration, nightly runs.

## Verification

After implementation:
```bash
# Run the self-test itself
bun run packages/verify/scripts/self-test.ts --docker=false

# Verify ledger output
cat packages/verify/data/self-test-ledger.jsonl | head -5

# Should find 0 bugs on current code (v0.1.1 fix in place)
# Intentionally break predicateFingerprint() → should find bugs in Family A
```

## Promoted Corpus (v2 — after harness proves signal)

When the harness finds a real bug, the scenario can be **promoted** to a stable regression fixture:

```
packages/verify/scripts/corpus/
  fp-collision-http-expect.json    # promoted from A2 run on 2026-03-20
  k5-scope-leak-cross-route.json   # promoted from B9 run on 2026-03-25
```

Flow: generated case → harness catches invariant violation → developer reviews → promotes to corpus → becomes permanent regression test. This is institutional memory — the harness remembers every class of bug it's ever found.

**Deferred to v2** because we need real signal first. No point building promotion infrastructure before the harness has caught anything.

## What I explicitly evaluated and rejected from external feedback

- **Minimization/shrinking** (GPT) — high complexity, scenarios are already human-authored and minimal by construction. Defer to v2.
- **`--watch` mode** (Grok) — over-engineering for a nightly harness. `bun --watch` on test files already exists.
- **Auto-create improvement campaigns from bugs** (Grok) — too ambitious for v1. The ledger + morning report is sufficient. Human decides what to fix.
- **Move to `src/selftest/`** (GPT) — premature. `scripts/` is fine until this proves signal. Promote later if warranted.
- **Formal property/scenario mode split** (GPT) — families already encode this (`--docker=false` runs pure families). Don't need architectural formalization.
- **Summary synthesis with first-seen/last-seen** (GPT) — good for v2 after multiple runs exist. Raw ledger is sufficient for v1.

## Critical Files to Modify/Create

**Create:**
- `packages/verify/scripts/self-test.ts`
- `packages/verify/scripts/harness/scenario-generator.ts`
- `packages/verify/scripts/harness/oracle.ts`
- `packages/verify/scripts/harness/runner.ts`
- `packages/verify/scripts/harness/ledger.ts`
- `packages/verify/scripts/harness/report.ts`
- `packages/verify/scripts/harness/docker-pool.ts`

**Read (reference during implementation):**
- `packages/verify/src/store/constraint-store.ts` — `predicateFingerprint()`, `seedFromFailure()`, `checkConstraints()`
- `packages/verify/src/verify.ts` — gate orchestration, `buildResult()`
- `packages/verify/src/types.ts` — all type definitions
- `packages/verify/fixtures/demo-app/server.js` — test fixture
- `packages/kernel/src/adapters/improvement-engine.ts` — subprocess isolation pattern

## Phase 1 Results (March 18, 2026)

First run found a real bug:

- **23 scenarios, 1 bug, 0 unexpected, 2.4s**
- **Bug found:** `predicateFingerprint()` uses truthy checks (`if (p.expected)`), so `expected: ""` (empty string) and absent `expected` produce identical fingerprints. A8 canonicalization trap caught it.
- Family A: 10 scenarios, 1 dirty (A8)
- Family B: 1 scenario, clean
- Family C: 2 scenarios, clean
- Family G: 10 scenarios, clean

## Phase 2 Results (March 18-19, 2026)

Expanded from 23 → 50 scenarios across 6 families. Autoresearch loop proven end-to-end.

### Families B + C expanded (March 18)

- B: 2 → 9 scenarios (constraint monotonicity, TTL, persistence, max depth, override, harness fault, scope isolation)
- C: 2 → 7 scenarios (gate ordering, disable config, timing, detail strings, K5→staging blocking)
- Autoresearch loop: first autonomous fix (fingerprint collision bug → `if (p.expected != null)`)

### Families D + E + Vision Gate (March 19)

- **D: Containment (G5)** — 8 new scenarios testing attribution math:
  - D1: CSS edit + CSS predicate → direct
  - D2: Content edit + content predicate → direct
  - D3: Dockerfile edit → scaffolding
  - D4: Unrelated file → unexplained
  - D5: Mixed edits (1 direct, 1 scaffolding, 1 unexplained)
  - D6: HTTP route edit + HTTP predicate → direct
  - D7: Migration file + DB predicate → direct
  - D8: No predicates → all unexplained

- **E: Grounding** — 6 new scenarios testing groundedness validation:
  - E1: Real selector (h1) → grounded
  - E2: Fabricated selector → groundingMiss=true
  - E3: Mixed real + fabricated
  - E4: HTML predicates exempt from grounding check
  - E5: Real class selector (.subtitle) → grounded
  - E6: Content/HTTP/DB predicates exempt

- **Vision Gate** — New gate wired into pipeline between Browser and HTTP:
  - Provider-agnostic: user supplies a callback `(image: Buffer, prompt: string) => Promise<string>`
  - Convenience helpers: `geminiVision()`, `openaiVision()`, `anthropicVision()` from `vision-helpers.ts`
  - Opt-in: requires `gates.vision: true` + `vision.call`
  - Takes Playwright screenshot, sends to vision model, parses per-claim verdicts

- **F: Full Pipeline** — 6 scenarios defined (requires Docker, skipped on Windows):
  - F1: Valid CSS edit passes all gates
  - F2: Nonexistent file fails at F9
  - F3: HTTP with bodyContains passes
  - F4: HTTP with wrong bodyContains fails
  - F5: Health invariant passes
  - F6: Full pipeline audit with metadata

### Phase 3: Full Docker Pipeline (March 19, 2026)

Family F Docker scenarios wired and passing on Lenovo ThinkCentre.

- Browser gate rgb() fix: `getComputedStyle()` returns computed values, not authored values
- Phase 3 runner: sequential Docker execution with availability auto-detection
- Auto-enables `--docker` when `--families=F` is requested

### Current State (March 20, 2026)

```
Default run (demo-app): 50 scenarios, ALL CLEAN, ~2.5s
With Docker:            56 scenarios, ALL CLEAN, ~80s
With --appDir=football: 66+ scenarios (50 built-in + 16+ external)

Family A: 10 (fingerprint collision)         — clean
Family B:  9 (K5 constraint learning)        — clean
Family C:  7 (gate sequencing)               — clean
Family D:  8 (containment attribution)       — clean
Family E:  6 (grounding validation)          — clean
Family F:  6 (full pipeline, Docker)         — clean (14-16s each on Lenovo)
Family G: 10 built-in (edge cases)           — clean
       + 16+ external (chaos-derived)        — clean after improve cycle
```

**Full cycle proven (March 20):** chaos→encode→self-test→improve→apply completed end-to-end. Named color normalization bug found by chaos, fixed by improve loop (score: +1.9), applied and revalidated.

**External scenario classification (football app):**
- 11 universal, 5 app_specific
- 16 grounding category

### Scenario Classification Feature (March 2026)

External scenarios now carry `transferability` and `category` metadata, auto-classified at encoding time:

| Field | Values | Purpose |
|-------|--------|---------|
| `transferability` | `universal`, `framework`, `app_specific` | How portable — marketplace-ready classification |
| `category` | `grounding`, `containment`, `constraints`, `staging`, `syntax`, `sequencing`, `evidence`, `narrowing` | Which verify subsystem |

Classifiers are deterministic (no LLM) — use tags, `expectedFailedGate`, rationale keywords, and predicate patterns. Existing scenarios can be backfilled via `ExternalScenarioStore.backfillClassifications()`.
