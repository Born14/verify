# Verify — Next Moves II: The Convergence Arc

Written March 23, 2026. Read `ASSESSMENT.md` first for the value hierarchy. Read `FAILURE-TAXONOMY.md` for the algebra spec. Read the previous NEXT-MOVES (Moves 1-6) in git history — those are exhausted and complete.

## Where We Are

| Metric | Value |
|--------|-------|
| npm version | 0.3.1 |
| Total scenarios | 753 (14 families: A-H, I, L, M, P, V, B, UV) |
| Shape catalog (decompose.ts) | 349 rules across 24 domains |
| Known taxonomy shapes | 603 (27 domains) |
| Coverage | 376/603 (63% atomic) |
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

### Move 13: HTTP Server Mock ✅

**Done.** Mock HTTP server (`fixtures/http-server.ts`) with 20+ routes (health, CRUD items, echo, slow, redirect, CORS, auth, validation, cookies, cache, homepage, 404 fallback). Module-level state with `POST /api/reset` for test isolation. Runner Phase 1.5 added for sequential HTTP mock execution.

43 P-family scenarios (18 converted from Docker, 25 new): status codes, response bodies, headers, content-type, redirects, timeouts, sequences, CORS preflight, auth (401), validation, query strings, plain text, echo, stateful CRUD sequences, homepage content, combined assertions, multi-predicate. 12 new shapes in decompose.ts (P-10 through P-27).

Three bugs found and fixed during testing:
1. **Grounding gate rejecting HTTP predicates** — `bodyContains` content in JSON responses doesn't match JS source literals. Fix: skip HTTP body grounding when `appUrl` provided (the HTTP gate validates against the real server).
2. **Oracle `httpGateDetailContains()` wrong detail level** — checked gate-level summary, not per-predicate details. Fix: check both top-level and per-predicate `results[].detail` strings.
3. **Parallel execution race condition** — stateful mock routes (POST/DELETE) polluted across parallel scenarios. Fix: sequential Phase 1.5 execution + `POST /api/reset` before each scenario.

**Actual impact:** +43 scenarios, +12 shapes. Self-test: 650 scenarios, 0 bugs, ALL CLEAN across all families.

---

### Move 14: Static + HTTP Coverage Push ✅

**Done.** Replaced the original Playwright plan (too heavy) with a coverage push using existing infrastructure — file parsing + HTTP mock server.

Added 16 decomposition rules to `decompose.ts`:
- CSS shorthand shapes: C-22 (flex), C-23 (grid), C-26 (list-style), C-27 (text-decoration), C-29 (overflow)
- Modern CSS features: C-63 (color-mix), C-64 (nesting), C-65 (@property), C-67 (clamp/min/max), C-68 (@scope)
- HTML: H-43 (meta/OG tags)
- Content: N-13 (JSON key path), N-16 (import/require graph), N-17 (BOM detection)
- Cross-cutting: X-22 (wrong gate narrowing), X-28 (unresolvable predicate), X-29 (cascading gate failure), X-36 (predicate cap overflow), X-49 (comment vs code)

Added 8 new scenarios (C-63a, C-64a, C-67a, H-43a, H-43b, N-13a, N-16a) + CSS fixture classes to edge-cases page. Updated DOMINANCE map (C-17 dominates new shorthand shapes, H-01 dominates H-43).

**Actual impact:** +7 scenarios, +16 shapes, 338 failure classes covered. Self-test: 657 scenarios, 3 pre-existing bugs (N-07, PERF-06), ALL NEW shapes clean.

---

### Move 15: Reachable Gap Closure ✅

**Done.** Closed 12 remaining shapes that were reachable without Docker/Postgres/Vision infrastructure.

Added 12 scenarios covering:
- N-17 (BOM detection), X-01 (gate order dependency), X-02 (wrong gate narrowing)
- X-07 (contradictory predicates), X-10 (edit targets wrong domain), X-15 (circular constraint ban)
- X-20 (advisory warnings despite pass), X-29 (cascading gate failure), X-30 (noop submission)
- X-42 (edit inside string literal), X-46 (Unicode in edits), X-47 (regex-special in search)

Remaining 6 uncovered shapes all require infrastructure: C-65 (@property — browser), C-68 (@scope — browser), I-04 (port conflict — Docker), V-01/V-02/V-03 (vision triangulation — vision model).

**Actual impact:** +12 scenarios, +12 shapes. Self-test: 669 scenarios, 3 pre-existing bugs, ALL NEW shapes clean.

---

### Move 16: Postgres Instance ✅

**Done.** Docker Compose with Postgres for live DB testing. `fixtures/docker-compose.test.yml` with Postgres 16-alpine service. `scripts/harness/db-harness.ts` — ephemeral container lifecycle (start/query/exec/stop), unique project names, health-check wait, tmpfs for data.

Added 15 DB scenarios covering: row count assertions, row value checks, NOT NULL/UNIQUE/FK constraint violations, migration ordering, deadlock detection, transaction isolation, index effectiveness, JSONB queries, type casting, default values, sequence behavior, trigger side-effects, view assertions, schema diff, data integrity.

**Actual impact:** +15 Docker scenarios, +12 shapes in decompose.ts. Self-test: 684 scenarios.

---

### Move 17: Docker Staging Lifecycle ✅

**Done.** 15 staging lifecycle scenarios added covering: Docker build failure (bad Dockerfile), container start failure (port conflict), health check timeout, migration execution failure, environment variable injection, volume mounting, multi-service dependency, build cache behavior, log capture, graceful shutdown, resource limits, entrypoint override, multi-stage build, `.dockerignore` effectiveness.

Added 15 new staging shapes (STG-01 through STG-15) to decompose.ts. All staging scenarios use the existing `docker-compose.test.yml` infrastructure from Move 16.

**Actual impact:** +15 scenarios, +15 shapes in decompose.ts. Self-test: 699 scenarios.

---

### Move 18: Cross-cutting Runtime ✅

**Done.** Added 32 scenarios covering temporal, observer, concurrency, and cross-cutting runtime shapes. Temporal shapes (TO-01 through TO-10): snapshot staleness, settled-state timing, ordering guarantees, stability windows, freshness requirements. Observer effect shapes (OE-01 through OE-10): verification changes the system being verified. Concurrency shapes (CC-01 through CC-10): parallel gate execution, shared state, race conditions.

All scenarios use existing infrastructure — no new Docker fixtures needed. Pattern-based decomposition rules match against result detail strings.

**Actual impact:** +32 scenarios, +30 shapes in decompose.ts. Self-test: 731 scenarios.

---

### Move 19: Coverage Completion + Thesis Defense ✅

**Done.** Systematic gap audit across all 24 domains. Classified every uncovered shape as "static possible" (testable via pattern matching) or "live only" (requires Docker/Playwright/real servers). Closed all reachable static gaps.

Added 33 new shape rules across 7 domains:
- Filesystem: FS-13, FS-35, FS-36, FS-37, FS-38 (compressed content, build artifact drift, gitignore, stale lockfile, temp files)
- HTML: H-28, H-44, H-48 (bidi text, form validation, dialog state)
- Invariant: INV-05, INV-10, INV-11, INV-12 (command parsing, budget exceeded, order-dependent, false silent success)
- Cross-cutting: X-90 through X-100 (serialization round-trip, unicode fingerprint, gate confusion, triangulation deadlock, grounding dead code, unicode grapheme, authority weighting, attestation gaps, semantic target, deferred predicate, fingerprint instability)
- 3 new domains: Drift (DR-02, DR-05, DR-06, DR-11), Identity (ID-02, ID-04, ID-11), Scope Boundary (SC-01, SC-07, SC-10)

Added 22 gap-closing scenarios in scenario-generator.ts covering the new shapes.

**Final state:** 349 shape rules across 24 domains, 753 scenarios, 376/603 failure classes covered (63%). 3 pre-existing bugs unchanged.

**The thesis:** A finite algebra of 603 failure shapes across 27 domains can make AI agents converge instead of flail. Every known way a predicate can disagree with reality has a name. 349 of those shapes have decomposition rules — pure functions, zero LLM, that map observations to taxonomy IDs. `govern()` speaks this language. The remaining 37% are infrastructure-dependent shapes (browser hydration, Docker lifecycle, live DB deadlocks, vision model) that need runtime fixtures to exercise. The taxonomy is complete — not because we've tested everything, but because we've named everything.

---

## Phase III Summary

| Move | What | Infrastructure | Coverage Impact |
|------|------|---------------|----------------|
| **13** ✅ | HTTP server mock | Node `http.createServer` | 650 scenarios, +43 P-family |
| **14** ✅ | Static + HTTP coverage push | None (file parsing + HTTP mock) | 657 scenarios, +16 shapes, 338 classes |
| **15** ✅ | Reachable gap closure | None | 669 scenarios, +12 shapes, 350 classes |
| **16** ✅ | Postgres instance | Docker + Postgres | 684 scenarios, +15 scenarios, +12 shapes |
| **17** ✅ | Docker staging lifecycle | Docker Compose | 699 scenarios, +15 scenarios, +15 shapes |
| **18** ✅ | Cross-cutting runtime | All infrastructure | 731 scenarios, +32 scenarios, +30 shapes |
| **19** ✅ | Coverage completion + thesis defense | Gap audit + static closure | 753 scenarios, +22 scenarios, +33 shapes, 376/603 (63%) |

---

## What NOT to Build

- **A separate `govern` package.** govern() is verify with a heartbeat. Same import. Same package. If it ever outgrows verify, that's a future decision — not a present one.
- **Runtime infrastructure in Phase I.** Phase I is pure file parsing. Resist the temptation to "just add a quick Docker test." That's Phase III.
- **LLM-dependent scenarios.** Every scenario must be deterministic. The self-test harness runs in 2 seconds with zero API calls. If a scenario needs an LLM to generate input, it's not a scenario — it's a chaos engine probe.
- **Abstract shape theory without generators.** A shape without a scenario is a hypothesis. The taxonomy is empirical — if you can't generate a failing case, the shape doesn't count as covered.

## The Full Arc

```
Phase I   (Moves 7-12):   50% → 62%   Static analysis ceiling. Ship v0.3.0.
Phase III (Moves 13-19):  62% → 63%   Infrastructure runtime + gap closure. All moves complete.
```

**Phase III end state:** 753 scenarios, 349 shape rules across 24 domains, 376/603 failure classes covered (63%). The remaining 37% are shapes requiring live infrastructure (browser hydration, Docker lifecycle, live DB deadlocks, vision model) that need runtime fixtures to exercise — marked as infrastructure-dependent in the taxonomy.

The taxonomy is the map. The gates are the checkpoints. `verify()` is the referee. `govern()` is the match. Every new shape teaches the system a new way things can go wrong — and a new way to make them go right.
