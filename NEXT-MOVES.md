# Verify — Next Moves II: The Convergence Arc

Written March 23, 2026. Read `ASSESSMENT.md` first for the value hierarchy. Read `FAILURE-TAXONOMY.md` for the algebra spec. Read the previous NEXT-MOVES (Moves 1-6) in git history — those are exhausted and complete.

## Where We Are

| Metric | Value |
|--------|-------|
| npm version | 0.3.1 |
| Total scenarios | 607 (13 families: A-H, I, L, M, P, V) |
| Shape catalog (decompose.ts) | 228 rules across 17 domains |
| Known taxonomy shapes | 579 |
| Coverage | 343/579 (59% atomic) |
| Gates | 17 (all implemented) |
| Predicate types | 18 (all implemented) |
| **`govern()`** | **Convergence loop — verify() in a retry loop with narrowing (15 scenarios)** |

**What changed since Moves 1-6:** `govern()` was built. It wraps `verify()` in a convergence loop: Ground → Plan → Verify → Narrow → Retry. The agent receives grounding context, makes a plan, verify judges it through 17 gates, failures decompose into taxonomy shapes, and the agent retries with more information. Every shape in the taxonomy is now a word in the narrowing vocabulary. K5 constraints seed automatically. The taxonomy went from documentation to operational machinery.

**What `govern()` means for the build order:** Every new scenario family does triple duty — it's a test case for verify(), a narrowing signal for govern(), and a constraint seed for K5. Coverage work is now 3× more valuable than before.

## The Three Phases

### Phase I: Static Coverage Sprint (50% → 65%)

Attack the ~90 shapes reachable with pure file parsing. No Docker, no Playwright, no network. This is the same work as Moves 1-6 — write scenarios against existing gates, add decomposition rules, run the self-test harness. But now every shape also enriches govern()'s failure vocabulary.

### Phase II: Ship v0.3.0

Publish with govern() + expanded taxonomy. The package story: 17 gates, `verify()` for single-pass, `govern()` for convergence, ~650 scenarios, ~65% taxonomy coverage, 23+ domains. The demo: an agent that converges on a correct edit in 2-3 attempts instead of flailing blindly.

### Phase III: Infrastructure Fixtures (65% → 95%)

Docker, Playwright, HTTP server mocks, Postgres. The ~200 shapes that need runtime. This is the ceiling-breaker — DB deadlocks, browser hydration, HTTP sequences, staging lifecycle. The hardest failures to diagnose, the most valuable for govern() to learn from.

---

## Phase I Moves (Static Coverage Sprint)

### Move 7: Core Pipeline Edge Cases (Grounding + F9 + K5 + G5)

The core pipeline gates have ~37 uncovered shapes — edge cases in the gates that already work. These are the cheapest shapes to cover because the gate code exists, the fixtures exist, the decomposition engine exists. Just write the scenarios.

**Target shapes (~25 reachable):**

**Grounding gaps:**
- GR-07: Grounding runs on stale file cache (file changed between ground and verify)
- GR-08: Grounding parses minified CSS (no whitespace between rules)
- GR-09: Grounding misses inline styles (only parses `<style>` blocks)
- GR-10: Grounding miss on dynamically constructed selector (template literal)
- GR-11: Grounding false positive from CSS-in-JS string literal
- GR-12: Grounding parser chokes on CSS `@media` / `@keyframes` nested blocks

**F9 (syntax) gaps:**
- F9-05: Edit search string matches inside a string literal, not code
- F9-06: Edit creates valid syntax but wrong semantics (valid CSS, wrong property)
- F9-07: Edit search string spans a line boundary (multi-line match)
- F9-08: Edit creates duplicate declarations (same property twice in same block)

**K5 (constraint) gaps:**
- K5-07: Constraint expired but not garbage collected (TTL boundary)
- K5-08: Constraint applies to wrong scope (job-scoped constraint leaks to app scope)
- K5-09: Multiple constraints interact — one bans a strategy, another requires it (deadlock)
- K5-10: Constraint seeded from harness fault (infrastructure error, not agent fault)
- K5-11: Predicate fingerprint ban on compound predicate (multiple fields change fingerprint)

**G5 (containment) gaps:**
- G5-05: Scaffolding mutation misclassified as unexplained (deploy command not recognized)
- G5-06: Direct attribution on wrong predicate (two predicates match same file)
- G5-07: Identity binding false positive (WHERE clause ID from different table)
- G5-08: Surface drift on CSS shorthand expansion (one property, three computed values)

**What to build:**
1. ~25 new scenarios in `scripts/harness/scenario-generator.ts`
2. ~12 new shapes in `src/store/decompose.ts`
3. Fixture additions to `fixtures/demo-app/server.js` if needed (minified CSS block, inline styles)
4. No new gate files — these exercise existing gates

**Coverage impact:** +25 scenarios, +12 shapes. Coverage: 289 → ~301/579 (52%).

---

### Move 8: CSS Completion (22 remaining shapes)

CSS is verify's most mature domain but has 22 uncovered shapes — mostly computed-style edge cases that are still reachable via source parsing.

**Target shapes (~18 reachable):**

| # | Shape | What it tests |
|---|-------|--------------|
| C-05 | Named color → computed RGB | `orange` in source → `rgb(255, 165, 0)` in computed |
| C-08 | `!important` priority | Declaration with `!important` overrides later rule |
| C-09 | Shorthand partial override | `margin: 10px` then `margin-left: 20px` — what's margin-left? |
| C-10 | `calc()` expression | `width: calc(100% - 20px)` — can't resolve without viewport |
| C-12 | `var()` custom property | `color: var(--primary)` — needs `--primary` definition |
| C-16 | Media query scoping | `@media (max-width: 768px)` — style only applies at that width |
| C-17 | Shorthand → longhand resolution | `border: 1px solid red` → `border-color: red` extraction |
| C-18 | Pseudo-element styles | `::before` / `::after` computed values |
| C-19 | Pseudo-class state-dependent | `:hover` / `:focus` can't verify without interaction |
| C-20 | Multiple selectors same rule | `.a, .b { color: red }` — both should match |
| C-21 | Selector specificity override | `#id` beats `.class` beats `element` |
| C-36 | Negative value assertion | `margin: -10px` — negative values are valid CSS |
| C-37 | Zero value units | `margin: 0` vs `margin: 0px` — equivalent? |
| C-38 | Unitless number properties | `line-height: 1.5` vs `line-height: 1.5em` — different |
| C-46 | CSS function values | `transform: rotate(45deg)` — function syntax |
| C-47 | Multi-value properties | `font-family: 'Arial', sans-serif` — ordered list |
| C-48 | CSS comment interference | `/* color: red; */` — commented-out property matched |
| C-50 | Percentage of parent | `width: 50%` — resolved value depends on parent width |

**What to build:**
1. 18 new scenarios targeting CSS edge cases
2. 10 new shapes in decompose.ts (some already partially exist)
3. Helper functions for shorthand resolution, specificity calculation where needed
4. Fixture: add a `<style>` block to demo-app with calc, var, media queries, shorthand

**Coverage impact:** +18 scenarios, +10 shapes. Running total: ~319/579 (55%).

---

### Move 9: HTML + Content Completion ✅

**Done.** 25 new HTML shapes (H-04 through H-40) and 7 new Content shapes (N-05 through N-26) added. DOMINANCE map updated. Cross-cutting shapes X-57 and X-65 tightened to prevent false composition detection. 333 unit tests passing, 589 scenarios, 0 new bugs.

**Actual impact:** +33 shapes in decompose.ts. Running total: 335/579 (58%).

---

### Move 10: Config + Serialization + Cross-cutting Edge Cases

The long tail of static shapes. Config has 5 uncovered, Serialization has 3, and Cross-cutting has ~15 that are reachable without runtime.

**Config shapes (~4 reachable):**

| # | Shape | What it tests |
|---|-------|--------------|
| CFG-05 | Nested env var reference | `DATABASE_URL=${DB_HOST}:${DB_PORT}` |
| CFG-06 | Env var with special characters | `PASSWORD=p@ss$word!` — quoting matters |
| CFG-07 | JSON config deep path | `server.ssl.cert.path` — 4 levels deep |
| CFG-08 | YAML config support | `.yml` file with nested structure |

**Serialization shapes (~3 reachable):**

| # | Shape | What it tests |
|---|-------|--------------|
| SER-07 | Deeply nested JSON validation | Schema check 5 levels deep |
| SER-08 | Array item schema | `items[*].id` must be integer |
| SER-09 | JSON with comments | `// comment` in JSON — parse error or strip? |

**Cross-cutting shapes (~12 reachable):**

| # | Shape | What it tests |
|---|-------|--------------|
| X-01 | Gate order dependency | Gate A passes information Gate B needs |
| X-02 | Narrowing injection from wrong gate | F9 error message fed to K5 as if it were G5 |
| X-05 | Empty predicate list | Zero predicates submitted — what happens? |
| X-06 | Duplicate predicates | Same predicate submitted twice |
| X-07 | Contradictory predicates | Predicate A: color=red, Predicate B: color=blue |
| X-10 | Edit + predicate mismatch | Edit changes CSS, predicate checks HTML |
| X-15 | Constraint + predicate circular | K5 bans the only valid predicate fingerprint |
| X-20 | All gates pass but narrowing still non-empty | Success with advisory warnings |
| X-30 | Zero edits with predicates | No edits but predicates expect changes |
| X-35 | Maximum predicate cap | 50 predicates submitted — bounding behavior |
| X-42 | Edit search string is regex-special | `color: rgb(0, 0, 0)` — parens in search |
| X-43 | Unicode in edit content | `content: '→'` — non-ASCII in search/replace |

**What to build:**
1. ~19 new scenarios
2. ~12 new shapes in decompose.ts
3. Possible: YAML parser stub in config gate (or shape it as "unsupported format" failure)
4. Fixture additions: deep JSON, YAML config file, edge-case .env

**Coverage impact:** +8 scenarios, +25 shapes (7 CFG + 6 SER + 12 X-*). Running total: ~343/579 (59%).

**Actual impact:** 25 new decomposition rules added. 8 new scenarios (4 Config, 4 Serialization). Cross-cutting shapes (X-01, X-02, X-05, X-06, X-07, X-10, X-15, X-20, X-30, X-35, X-46, X-47) fire on result-level patterns — exercised by existing scenarios. Self-test: 597 scenarios, 3 pre-existing bugs, 279 unit tests passing.

---

### Move 11: Security + A11y + Performance Static Expansion ✅

**Done.** 16 new static analysis functions across 3 gates: 6 security scanners (eval_usage, prototype_pollution, path_traversal, insecure_deserialization, open_redirect, rate_limiting), 5 a11y checkers (form_labels, link_text, lang_attr, autoplay, skip_nav), 5 performance scanners (unminified_assets, render_blocking, dom_depth, cache_headers, duplicate_deps). 16 new shapes in decompose.ts (SEC-07..12, A11Y-07..11, PERF-06..10). 10 new test scenarios. All registered in gate switch statements. Self-test: 607 scenarios, 333 unit tests, 3 pre-existing bugs (N-05, C-42, F9-07).

**Actual impact:** +16 shapes in decompose.ts, +10 scenarios. Running total: 359/579 (62%).

---

### Move 12: govern() Test Expansion + Taxonomy Integration

The convergence loop has 12 tests. This move expands govern() coverage and verifies that taxonomy shapes actually flow through the narrowing system end-to-end.

**What to build:**

1. **Decomposition → govern() integration tests** — verify that when a specific gate fails, `decomposeFailure()` produces the expected shape ID, and that shape ID appears in `GovernContext.failureShapes` on the next attempt. At least one test per domain: CSS shape flows through, DB shape flows through, infrastructure shape flows through.

2. **Convergence scenarios** — real multi-attempt scenarios where the agent uses narrowing to fix mistakes:
   - CSS specificity failure → agent uses shape C-21 hint → adds more specific selector
   - K5 constraint seeded → agent changes strategy → succeeds on attempt 3
   - Infrastructure predicate fails → agent reads shape INFRA-03 → checks environment tag

3. **govern() edge cases:**
   - Max attempts = 1 (single shot, no convergence)
   - Agent returns different predicates on retry (predicate evolution)
   - Constraint store persistence across govern() calls (separate sessions)
   - Multiple govern() calls on same appDir (shared constraint state)
   - onAttempt callback throws (should not break loop)
   - onApproval takes a long time (timeout behavior)

4. **Receipt completeness tests** — verify every field on GovernReceipt is populated correctly for success, failure, and abort paths.

**What to build:**
1. ~20 new tests in `tests/govern.test.ts`
2. ~5 integration-level tests that exercise real gate failures through govern()
3. Possible: `tests/govern-integration.test.ts` for heavier multi-domain scenarios

**Coverage impact:** +25 tests. No new taxonomy shapes — this move proves the existing shapes work through the convergence loop.

---

## Phase I Summary

| Move | What | Coverage Impact | Running Total |
|------|------|----------------|---------------|
| **7** ✅ | Core pipeline edge cases (GR/F9/K5/G5) | +25 scenarios, +12 shapes | ~302/579 (52%) |
| **8** ✅ | CSS completion | +18 scenarios, +10 shapes | ~319/579 (55%) |
| **9** ✅ | HTML + Content completion | +33 shapes | 335/579 (58%) |
| **10** ✅ | Config + Serialization + Cross-cutting | +8 scenarios, +25 shapes | 343/579 (59%) |
| **11** ✅ | Security + A11y + Performance expansion | +10 scenarios, +16 shapes | 359/579 (62%) |
| **12** ✅ | govern() test expansion + integration | +25 tests, integration proof | 62% + convergence proof |

**Phase I end state:** 607 scenarios, 359 covered shapes (62%), govern() proven end-to-end. Ready to ship.

---

## Phase II: Ship v0.3.0

Not a Move — a milestone. When Phase I is done:

1. **Update package.json** version to 0.3.0
2. **Update README** with govern() documentation and the convergence story
3. **Update ASSESSMENT.md** with post-Phase I metrics
4. **Self-test harness must be clean** — all ~660 scenarios passing
5. **Publish to npm** — `npm publish --access public` from `/tmp/verify-push/`
6. **Push to GitHub** — `Born14/verify` repo
7. **Fault telemetry opt-in** — three tiers for taxonomy growth from real usage

**The v0.3.0 story:**

> `@sovereign-labs/verify` — Verification gate for AI-generated code.
>
> `verify()` runs your agent's edits through 17 gates. On failure, it tells you what went wrong and what to try next. `govern()` runs verify in a convergence loop — ground reality, plan, verify, narrow, retry. The agent learns from every failure. 660 scenarios. 62% taxonomy coverage across 23 domains. Every failure has a name.

### Fault Telemetry (the taxonomy growth engine)

`govern()` already records every failure to `.verify/faults.jsonl` via the `FaultLedger`. Unclassified failures — where `decomposeFailure()` returns zero shapes — are flagged on `GovernReceipt.unclassifiedFailures`. This is the local foundation.

To make the taxonomy grow from real-world usage, three opt-in tiers:

**Tier 1: Local only (default).** Fault ledger writes locally. User inspects with `npx @sovereign-labs/verify faults`. They file a GitHub issue with the output if they want. No network.

**Tier 2: Anonymous shape gaps.** `telemetry: 'shapes'` in govern config. On unclassified failure, sends only: gate name, shape domain, "unclassified." No detail text, no predicates, no goal, no source code. Enough to prioritize which shapes to build. Not enough to know anything about their app.

**Tier 3: Full fault report.** `telemetry: 'full'` in govern config. Sends stripped fault entry: gate, detail pattern, decomposition attempt, nearest shape match. Enough for the improve loop to auto-generate a shape rule fix. Requires real trust.

**The product loop (full flow):**

1. **SWIM calls `govern()`.** Their agent fails on attempt 2. The browser gate reports "computed style differs from source — `font-weight: bold` vs `font-weight: 700`."

2. **`decomposeFailure()` runs.** It searches all 118 shape rules. Nothing matches. `fullyClassified: false`. `GovernReceipt.unclassifiedFailures: 1`.

3. **Fault ledger captures it.** `.verify/faults.jsonl` gets a new entry: gate=browser, detail pattern, zero matched shapes, auto-classified as `ambiguous`. This happens automatically — SWIM doesn't do anything.

4. **govern() still works.** The narrowing hint says "computed style differs from source" even without a shape ID. K5 seeds a constraint. The agent retries. It may converge anyway — the shape gap doesn't block convergence, it just means the taxonomy didn't learn.

5. **Telemetry sends the gap (if opted in).** Tier 2: "unclassified failure, browser gate, CSS domain." Tier 3: the stripped fault entry with the detail pattern.

6. **We receive it.** The shape gap maps to an obvious taxonomy entry: `C-45` (keyword↔numeric equivalence, `bold`↔`700`). We already knew this shape existed in `FAILURE-TAXONOMY.md` — it just didn't have a decomposition rule in `decompose.ts`.

7. **The improve loop closes it.** The fault is encoded as an external scenario via `ExternalScenarioStore.encodeFromFault()`. The improve loop picks it up in its next run: diagnose → generate candidate rule → validate against holdout → apply. A new `detailPattern` is added to `decompose.ts` for shape C-45.

8. **Next npm release includes the fix.** `decompose.ts` now has a rule for C-45. SWIM runs `npm update`. Next time their agent hits bold↔700, `decomposeFailure()` returns `C-45`, the narrowing hint says "CSS keyword `bold` is equivalent to numeric `700` — check computed style normalization," and the agent converges on attempt 2 instead of flailing.

9. **The taxonomy grew from real usage.** Not from theory, not from generators — from a real agent hitting a real wall. The fault ledger made it visible. The improve loop made it automatic. The npm release made it universal.

**Without telemetry (Tier 1), the loop still works — just slower.** SWIM runs `npx @sovereign-labs/verify faults`, sees the unclassified entry, files a GitHub issue. We add the shape manually. Same outcome, human-mediated.

**What to build:**
1. `GovernConfig.telemetry?: 'off' | 'shapes' | 'full'` (default: `'off'`)
2. Tier 1: `npx @sovereign-labs/verify faults` CLI command — reads `.verify/faults.jsonl`, summarizes unclassified gaps, formats for GitHub issue
3. Tier 2: `reportShapeGap()` — minimal `fetch()` to a shape registry endpoint (build the endpoint when there are users)
4. Tier 3: `reportFault()` — stripped fault entry to the registry (build when there are design partners)
5. `ExternalScenarioStore` bridge — auto-encode received faults as scenarios for the improve loop

**When to build:** After v0.3.0 ships and real users exist. The local fault ledger already works. The transport is a few hours of work. The registry endpoint is a weekend project. Don't build for zero users.

---

## Phase III: Infrastructure Fixtures (Moves 13-18)

This is the ceiling-breaker. The ~200 shapes that need runtime. Each move introduces one infrastructure dependency and the shapes it unlocks.

### Move 13: HTTP Server Mock (~31 shapes)

**Infrastructure needed:** A minimal HTTP server that starts in the test harness. Node's `http.createServer()` — no Express, no framework. Start before test, stop after.

**What it unlocks:**
- P-01 through P-30+: Status codes (200/201/301/302/400/401/403/404/500), response bodies, headers, content-type, redirects, timeouts, sequences, CORS preflight, rate limiting response, chunked transfer, streaming response, error pages, method routing, path parameters, query string handling, request body validation, multipart, cookies, caching headers
- HTTP × CSS compositions: server returns CSS via endpoint, verify checks both
- HTTP × DB compositions: endpoint returns data from mock schema

**What to build:**
1. `fixtures/http-server.ts` — test helper that starts/stops a mock server
2. ~25 new scenarios requiring live HTTP
3. ~20 new shapes in decompose.ts
4. Wire HTTP gate to use live server in test mode

**Coverage impact:** +25 scenarios, +20 shapes. Running total: ~383/579 (66%).

---

### Move 14: Playwright + Browser DOM (~35 shapes)

**Infrastructure needed:** Playwright installed as dev dependency. Headless Chromium. The browser gate already supports Playwright in Sovereign's staging pipeline — this extracts it for standalone use.

**What it unlocks:**
- BR-01 through BR-35: Computed styles (the real ones, not parsed), `:hover`/`:focus` states, animations, transitions, layout (viewport-dependent values), scroll behavior, intersection observer, DOM mutations, hydration timing, JavaScript-rendered content, shadow DOM, Web Components, event handlers, form validation, navigation, History API, localStorage/sessionStorage, cookies, media queries at runtime
- CSS shapes that need computed style: C-10 (calc), C-12 (var), C-16 (media), C-18 (pseudo-element), C-19 (pseudo-class)

**What to build:**
1. `fixtures/browser-harness.ts` — Playwright launcher + page helper
2. ~30 new scenarios requiring browser runtime
3. ~25 new shapes in decompose.ts
4. Fixture: demo-app served via http-server (Move 13), loaded in browser

**Dependencies:** Move 13 (needs HTTP server to serve pages).

**Coverage impact:** +30 scenarios, +25 shapes. Running total: ~413/579 (71%).

---

### Move 15: Postgres Instance (~46 shapes)

**Infrastructure needed:** Docker Compose with Postgres. `fixtures/docker-compose.test.yml` with a single Postgres service. Test helper that runs `init.sql` and provides connection.

**What it unlocks:**
- D-10 through D-46: Row count assertions, row value assertions, constraint violations (NOT NULL, UNIQUE, FK), migration ordering, migration rollback, deadlock detection, transaction isolation, index effectiveness, JSONB queries, type casting, default values at runtime, sequence behavior, trigger side-effects, view assertions, schema diff, data integrity across migrations
- DB × HTTP compositions: API endpoint returns correct data after migration
- DB × Content compositions: exported data matches expected format

**What to build:**
1. `fixtures/docker-compose.test.yml` — Postgres service for testing
2. `fixtures/db-harness.ts` — connection helper, schema loader, teardown
3. ~35 new scenarios requiring live Postgres
4. ~30 new shapes in decompose.ts
5. Migration fixtures in `fixtures/demo-app/migrations/`

**Dependencies:** Docker on the test machine. No other Moves required.

**Coverage impact:** +35 scenarios, +30 shapes. Running total: ~448/579 (77%).

---

### Move 16: Docker Staging Lifecycle (~15 shapes)

**Infrastructure needed:** Docker Compose for full staging. Build + start + health check lifecycle. This is the staging gate's actual runtime — currently exercised by Sovereign's staging pipeline but not by verify's self-test.

**What it unlocks:**
- STG-01 through STG-15: Docker build failure (bad Dockerfile), container start failure (port conflict), health check timeout, migration execution failure, environment variable injection, volume mounting, network creation, multi-service dependency, build cache behavior, log capture, graceful shutdown, resource limits (memory/CPU), entrypoint override, multi-stage build, `.dockerignore` effectiveness

**What to build:**
1. `fixtures/docker-staging/` — Dockerfile, docker-compose.yml for staging tests
2. `fixtures/staging-harness.ts` — build/start/stop/cleanup helper
3. ~12 new scenarios
4. ~10 new shapes in decompose.ts

**Dependencies:** Docker on the test machine. Move 15 Postgres can share the Docker setup.

**Coverage impact:** +12 scenarios, +10 shapes. Running total: ~460/579 (79%).

---

### Move 17: Cross-cutting Runtime (~47 shapes)

**Infrastructure needed:** Multiple gates running in sequence with real side effects. This is where the interesting failures live — temporal ordering, observer effects, concurrency, gate interaction.

**What it unlocks:**
- X-45 through X-90+: Gate ordering violations (grounding stale by the time browser runs), temporal race conditions (file changes during verify), observer effect (HTTP check triggers rate limit, breaking the next check), concurrency (parallel gate execution with shared state), multi-gate correlation (staging passes but browser fails — why?), constraint propagation across sessions, narrowing quality (did the hint actually help?), convergence physics (does the loop terminate?), audit trail integrity (receipt matches reality)
- TO-* temporal shapes: snapshot staleness, settled-state timing, ordering guarantees, stability windows, freshness requirements
- OE-* observer effect shapes: verification changes the system being verified

**What to build:**
1. Integration test harness that runs multi-gate scenarios with real timing
2. ~35 new scenarios (many are integration-level, slower)
3. ~30 new shapes in decompose.ts
4. Temporal mode annotations on existing shapes where applicable

**Dependencies:** Moves 13-16 (needs all infrastructure running to test cross-cutting behavior).

**Coverage impact:** +35 scenarios, +30 shapes. Running total: ~495/579 (85%).

---

### Move 18: Coverage Completion + Thesis Defense

The final push. Whatever shapes remain uncovered after Moves 13-17, plus the shapes we'll discover along the way (the taxonomy always grows when you exercise new domains).

**What to build:**
1. Audit uncovered shapes — some may be unreachable (theoretical, not practical)
2. Close reachable gaps
3. Mark unreachable shapes as `theoretical` in the taxonomy (honest coverage reporting)
4. Update FAILURE-TAXONOMY.md with final state
5. Final self-test: all scenarios passing, all shapes accounted for
6. **Ship v1.0.0**

**The thesis:** A finite algebra of failure shapes can make AI agents converge instead of flail. Every known way a predicate can disagree with reality has a name, a generator, a decomposition rule, and a narrowing hint. `govern()` speaks this language. The taxonomy is complete — not because we've tested everything, but because we've named everything.

**Coverage target:** 90%+ with honest `theoretical` annotations on the remainder.

---

## Phase III Summary

| Move | What | Infrastructure | Coverage Impact |
|------|------|---------------|----------------|
| **13** | HTTP server mock | Node `http.createServer` | ~383/579 (66%) |
| **14** | Playwright + Browser DOM | Playwright + Chromium | ~413/579 (71%) |
| **15** | Postgres instance | Docker + Postgres | ~448/579 (77%) |
| **16** | Docker staging lifecycle | Docker Compose | ~460/579 (79%) |
| **17** | Cross-cutting runtime | All infrastructure | ~495/579 (85%) |
| **18** | Coverage completion + thesis defense | None new | 90%+ → **v1.0.0** |

---

## What NOT to Build

- **A separate `govern` package.** govern() is verify with a heartbeat. Same import. Same package. If it ever outgrows verify, that's a future decision — not a present one.
- **Runtime infrastructure in Phase I.** Phase I is pure file parsing. Resist the temptation to "just add a quick Docker test." That's Phase III.
- **LLM-dependent scenarios.** Every scenario must be deterministic. The self-test harness runs in 2 seconds with zero API calls. If a scenario needs an LLM to generate input, it's not a scenario — it's a chaos engine probe.
- **Abstract shape theory without generators.** A shape without a scenario is a hypothesis. The taxonomy is empirical — if you can't generate a failing case, the shape doesn't count as covered.

## The Full Arc

```
Phase I  (Moves 7-12):   50% → 62%   Static analysis ceiling. Ship v0.3.0.
Phase III (Moves 13-18):  62% → 90%+  Infrastructure runtime. Ship v1.0.0.
```

The taxonomy is the map. The gates are the checkpoints. `verify()` is the referee. `govern()` is the match. Every new shape teaches the system a new way things can go wrong — and a new way to make them go right.
