# Phase IV: Live Infrastructure Testing

Written March 24, 2026. The plan for breaking through the 63% coverage ceiling.

## Principles (refined after peer review)

1. **Prove the harness before the flood.** Convert 3-5 existing simulated scenarios to truly live before writing new ones. Harness bugs found with 5 scenarios are cheap. Harness bugs found with 50 scenarios are expensive.

2. **Prioritize by truth delta.** Attack shapes where source parsing *literally cannot give the right answer*. Browser: computed styles, visibility, layout, `calc()`/`var()` resolution. HTTP: SSE, CORS, gzip, cookies, timeouts. Not protocol neatness — product value.

3. **Gate live failures before encoding.** The nightly loop must normalize → dedupe → corroborate before encoding a live failure as a permanent pure scenario. Otherwise harness flake pollutes the taxonomy. Same principle as K5's `harness_fault` vs `app_failure` distinction.

4. **Measure shape quality, not shape count.** The real metrics: distinct reusable shape families, new live harness capabilities, govern retry quality improvement, reduction in "unknown" live failures. Coverage percentages are directional, not targets.

## The Problem

753 scenarios test verify's logic. Zero scenarios test verify against real running infrastructure. The 225 uncovered shapes (37%) are concentrated in domains that require live services:

| Domain | Uncovered Shapes | Requires |
|--------|-----------------|----------|
| Browser (BR) | 35 | Playwright + running container |
| HTTP advanced (P) | 31 | Real server (SSE, WebSocket, CORS, TLS) |
| DB full (D) | 20 | Docker Postgres (live queries, deadlocks, migrations) |
| Cross-cutting (X) | 36 | Multi-gate pipeline with real services |
| Quality surfaces | 15 | Live server measurement |
| Temporal/Observer/Concurrency | 33 | Stateful multi-process environment |
| Drift/Config/Identity | 55 | Multi-deploy history, runtime env |

## The Design: Tiered Self-Test

One harness, one scenario list, three tiers controlled by flag:

```bash
bun run self-test              # Tier 0: Pure only (753+ scenarios, ~20s)
bun run self-test --live       # Tier 1: Pure + Docker (800+ scenarios, ~5min)
bun run self-test --full       # Tier 2: Everything (900+ scenarios, ~10min)
```

### What already exists

- `requiresDocker: boolean` on every scenario (filtering works)
- `config.dockerEnabled` flag in runner (Docker scenarios already skipped when unavailable)
- `scripts/harness/db-harness.ts` — ephemeral Postgres lifecycle (start/query/exec/stop)
- `fixtures/demo-app/docker-compose.test.yml` — Postgres 16-alpine service
- `fixtures/http-server.ts` — HTTP mock server
- `fixtures/browser-gate-runner.mjs` — Playwright runner (used in sovereign staging)
- 15 DB scenarios already tagged `requiresDocker: true` (currently pattern-simulated)

### What needs to be built

**Runner changes (Move 20):**
- Add `--live` and `--full` CLI flags
- Add `requiresPlaywright: boolean` to scenario type
- Docker availability detection at startup (try `docker info`)
- Playwright availability detection (try `npx playwright --version`)
- Phase 4: Docker scenarios run sequentially with real containers
- Phase 5: Playwright scenarios run sequentially with real browser
- Clean skip reporting: "Skipped 47 Docker scenarios (Docker not available)"
- Timeout per live scenario: 60s (vs 10s for pure)

**Docker test harness (Move 21):**
- Wire `db-harness.ts` into runner — start Postgres once, share across DB scenarios
- Container lifecycle: start before Docker phase, stop after (not per-scenario)
- App container: build demo-app image, start with `docker-compose.test.yml`
- Health wait with timeout (90s for Postgres, 30s for app)
- Cleanup guarantee: `finally` block tears down even on crash

**Playwright test harness (Move 22):**
- Reuse `browser-gate-runner.mjs` pattern (runner + data separation)
- Start demo-app container → wait for health → run Playwright against it
- `requiresPlaywright: true` scenarios get a `browserContext` in their config
- Predicate types: `getComputedStyle()`, element existence, text content, visibility
- Render settling: DOM mutation wait (300ms no mutations, 3s cap)

---

## The Moves

### Move 20: Runner Tiering + Docker Detection

**What:** Add `--live` and `--full` flags. Detect Docker/Playwright at startup. Clean skip reporting.

**Changes:**
- `scripts/harness/runner.ts` — CLI flag parsing, availability detection, tier filtering
- `scripts/harness/types.ts` — add `requiresPlaywright` to `VerifyScenario`
- `src/cli.ts` — pass `--live`/`--full` through to runner

**Acceptance:** `bun run self-test` unchanged (753 scenarios, ~20s). `bun run self-test --live` prints "Docker available: yes/no" and includes/skips Docker scenarios accordingly.

**No new scenarios.** This is pure infrastructure.

---

### Move 21: Live DB Scenarios

**What:** Convert the 15 existing DB scenarios from pattern-simulated to real Postgres. Prove the harness with 5 high-signal conversions first. Then add ~20 new scenarios that are only possible with a live database.

**Phase A (prove the harness):** Convert 5 existing DB scenarios to real Postgres:
- D-01 (row count) — simplest possible live query
- D-03 (NOT NULL violation) — constraint error string capture
- D-05 (deadlock detection) — concurrent transaction behavior
- D-09 (JSONB query) — complex type handling
- D-12 (trigger side-effect) — write-then-verify pattern

If any of these 5 expose harness bugs, fix them before proceeding. This is the Tier 1.5 gate.

**Phase B (expand):** Wire remaining 10 conversions + add ~20 new scenarios.

**Infrastructure:**
- `db-harness.ts` wired into runner Phase 4
- One Postgres container shared across all DB scenarios
- `query()` runs real SQL, `exec()` runs commands in app container

**New scenarios (~20):**
| Shape | What it tests |
|-------|--------------|
| D-13 | Deadlock detection (two concurrent transactions) |
| D-14 | Migration rollback on failure (partial schema change) |
| D-15 | Connection pool exhaustion |
| D-16 | Long-running query timeout |
| D-17 | VACUUM during active queries |
| D-18 | Sequence gap after rollback |
| D-19 | Concurrent schema migration (two ALTER TABLEs) |
| D-20 | Trigger side-effect verification |
| D-21 | JSONB deep path query failure |
| D-22 | Enum type mismatch after ALTER TYPE |
| D-23 | Foreign key cascade delete verification |
| D-24 | Partition table query routing |
| D-25 | CTE (WITH clause) materialization |
| D-26 | LISTEN/NOTIFY channel verification |
| D-27 | Row-level security policy enforcement |
| D-28 | Full-text search index verification |
| D-29 | Materialized view refresh verification |
| D-30 | Concurrent INSERT conflict (UPSERT) |
| D-31 | Generated column verification |
| D-32 | Prepared statement plan invalidation |

**Coverage impact:** +20 scenarios, +20 shapes. DB domain: 12/56 → 32/56 (57%).

---

### Move 22: Live Browser Scenarios (Playwright)

**What:** Real browser rendering verification. Playwright in Docker visits the running demo-app and checks computed styles, DOM state, visibility, layout.

**Phase A (top 10 truth-delta scenarios first):** These are shapes where source parsing literally cannot give the right answer — the highest-value browser shapes:
1. BR-01 Computed style vs source (shorthand expansion) — THE foundational browser truth
2. BR-20 `calc()` resolved value — requires viewport context
3. BR-21 `var()` resolved value — requires cascade resolution
4. BR-06 `display: none` — exists but not visible
5. BR-07 `visibility: hidden` vs `display: none` — distinction impossible from source
6. BR-08 `opacity: 0` — DOM present, visually absent
7. BR-23 `flex` computed dimensions — layout engine required
8. BR-24 `grid` computed dimensions — layout engine required
9. BR-03 `@media` responsive — viewport-dependent
10. BR-12 Lazy-loaded content below fold — requires scroll context

Prove these 10 work. Fix harness bugs. Then expand to the remaining 20.

**Phase B (remaining 20):** Full browser domain coverage.

**Infrastructure:**
- Demo-app container running (from Move 21's Docker setup)
- Playwright container: `mcr.microsoft.com/playwright:v1.49.0-noble`
- `browser-gate-runner.mjs` receives predicates as JSON, writes results as JSON
- Runner Phase 5 orchestrates: start app → run Playwright → collect results

**All scenarios (~30):**
| Shape | What it tests |
|-------|--------------|
| BR-01 | Computed style vs source style (shorthand expansion) |
| BR-02 | `:hover` pseudo-class (no interaction = default state) |
| BR-03 | `@media` responsive (viewport-dependent) |
| BR-04 | CSS animation computed value (mid-animation) |
| BR-05 | CSS transition computed value (during transition) |
| BR-06 | `display: none` element — exists but not visible |
| BR-07 | `visibility: hidden` vs `display: none` distinction |
| BR-08 | `opacity: 0` — visible in DOM, invisible to user |
| BR-09 | Scroll position affects `position: fixed` elements |
| BR-10 | Font loading — fallback font before webfont loads |
| BR-11 | Image loading — `naturalWidth` before load complete |
| BR-12 | Lazy-loaded content below fold |
| BR-13 | Shadow DOM encapsulation (styles don't leak) |
| BR-14 | `<template>` element — exists in DOM, not rendered |
| BR-15 | `<dialog>` element — open vs closed state |
| BR-16 | Form validation pseudo-classes (`:valid`, `:invalid`) |
| BR-17 | `contenteditable` element text content |
| BR-18 | `<canvas>` element — exists but content not inspectable via DOM |
| BR-19 | `<iframe>` cross-origin — style isolation |
| BR-20 | CSS `calc()` resolved value |
| BR-21 | CSS `var()` resolved value |
| BR-22 | CSS `clamp()` resolved value |
| BR-23 | `flex` layout computed dimensions |
| BR-24 | `grid` layout computed dimensions |
| BR-25 | `z-index` stacking context |
| BR-26 | CSS `filter` effects (blur, brightness) |
| BR-27 | Text overflow with `ellipsis` — actual rendered text |
| BR-28 | Multi-column layout column count |
| BR-29 | `@supports` feature detection |
| BR-30 | Print stylesheet (`@media print`) — computed in print context |

**Coverage impact:** +30 scenarios, +30 shapes. Browser domain: 3/38 → 33/38 (87%).

---

### Move 23: Live HTTP Advanced Scenarios

**What:** Real HTTP server testing — SSE streams, WebSocket, CORS, TLS, compression, caching. Extends the existing HTTP mock server in `fixtures/http-server.ts`.

**Phase A (top 12 product-value scenarios first):** Ranked by how often agents hit these in real deployments:
1. P-39 SSE stream — event arrives within timeout (sovereign uses SSE everywhere)
2. P-43 CORS preflight — OPTIONS response (every SPA hits this)
3. P-45 gzip response — Content-Encoding handling
4. P-49 Rate limiting — 429 response (LLM APIs, any external service)
5. P-50 Request timeout handling — the #1 live failure class
6. P-47 ETag conditional — 304 Not Modified (caching correctness)
7. P-55 Cookie set/get round-trip (auth flows)
8. P-54 HTTPS redirect — 301 from HTTP (deployment reality)
9. P-57 Content-Type negotiation — Accept header
10. P-51 Chunked transfer encoding (streaming responses)
11. P-44 CORS rejected — wrong origin (security boundary)
12. P-48 Cache-Control max-age (CDN correctness)

Prove these 12 work. Then expand to remaining ~13.

**Phase B (remaining ~13):** Full HTTP advanced coverage. HTTP/2 server push (P-52) is optional — low product value in 2026.

**Infrastructure:**
- Expand `http-server.ts` to support SSE, WebSocket, CORS headers, compression
- Run as real server (not mock) for `--live` scenarios
- TLS via self-signed cert for HTTPS scenarios

**All scenarios (~25):**
| Shape | What it tests |
|-------|--------------|
| P-39 | SSE stream — event arrives within timeout |
| P-40 | SSE reconnection after disconnect |
| P-41 | WebSocket handshake + message exchange |
| P-42 | WebSocket close frame handling |
| P-43 | CORS preflight (OPTIONS) response |
| P-44 | CORS rejected (wrong origin) |
| P-45 | Content-Encoding: gzip response |
| P-46 | Content-Encoding: br (brotli) response |
| P-47 | ETag conditional request (304 Not Modified) |
| P-48 | Cache-Control max-age verification |
| P-49 | Rate limiting (429 Too Many Requests) |
| P-50 | Request timeout handling |
| P-51 | Chunked transfer encoding |
| P-52 | HTTP/2 server push (if available) |
| P-53 | TLS certificate validation (self-signed = reject) |
| P-54 | HTTPS redirect (301 from HTTP) |
| P-55 | Cookie set/get round-trip |
| P-56 | Cookie SameSite enforcement |
| P-57 | Content-Type negotiation (Accept header) |
| P-58 | HEAD request (no body, correct Content-Length) |
| P-59 | OPTIONS request (allowed methods) |
| P-60 | 413 Request Entity Too Large |
| P-61 | Multipart form data upload |
| P-62 | Range request (206 Partial Content) |
| P-63 | Keep-alive connection reuse |

**Coverage impact:** +25 scenarios, +25 shapes. HTTP domain: ~18/54 → ~43/54 (80%).

---

### Move 24: Nightly Campaign + Improve Loop Integration

**What:** Wire the live tier into the nightly campaign on the Lenovo. The improve loop runs against `--live` failures.

**Infrastructure:**
- Campaign definition: `bun run self-test --live` as nightly cron
- Failure output feeds improve loop input
- New pure scenarios auto-generated from live failure captures
- Report: email/webhook with pass/fail/new-discoveries

**The encoding gate (critical — prevents taxonomy pollution):**
```
Live failure captured
    ↓ normalize error signature (extractSignature)
    ↓ deduplicate against existing shapes
    ↓ corroborate: seen 2+ times across runs? (not harness flake)
    ↓ classify: harness_fault vs app_failure (reuse K5 FailureKind)
    ↓ only app_failure with 2+ corroborations gets encoded
Pure scenario generated
```

Without this gate, harness flake (Docker timeout, port conflict, image pull failure) pollutes the taxonomy with shapes that aren't verify bugs. Same principle as K5's `harness_fault` classification — infrastructure errors should never poison the learning system.

**The discovery cycle (automated):**
```
Nightly --live run
    ↓ failures captured
Encoding gate (normalize → dedupe → corroborate → classify)
    ↓ only real failures pass
Improve loop diagnoses + patches
    ↓ fix applied
New pure scenario encoded from corroborated failure
    ↓ committed
Next --live run: fewer failures
    ↓ repeat
```

**This is the move that makes verify self-improving without human intervention.**

---

## Summary

| Move | What | New Scenarios | Coverage Impact |
|------|------|--------------|----------------|
| 20 | Runner tiering + detection | 0 | Infrastructure only |
| 21 | Live DB (Postgres) | ~20 | DB: 21% → 57% |
| 22 | Live Browser (Playwright) | ~30 | Browser: 8% → 87% |
| 23 | Live HTTP advanced | ~25 | HTTP: 33% → 80% |
| 24 | Nightly campaign + improve loop | 0 | Autonomous improvement |

**Total new scenarios:** ~95
**Projected coverage:** 376 → ~451/603 (75%)
**Projected total scenarios:** 753 → ~848

The remaining 25% after Phase IV will be the hardest shapes — concurrency, observer effects, multi-deploy drift, vision model. Those are Phase V territory and may require fundamentally new fixtures (multi-process, time control, deploy history simulation).

## Build Order

Move 20 first — pure infrastructure, unblocks everything else.

Then Moves 21-23 each follow the same pattern:
1. **Phase A:** 3-12 high-signal scenarios (prove the harness)
2. **Fix harness bugs** (the Tier 1.5 gate)
3. **Phase B:** Expand to full scenario set

Move 21 next because the DB harness already exists (`db-harness.ts`, `docker-compose.test.yml`). Move 22 after because Playwright is the highest truth-delta domain. Move 23 extends existing HTTP infrastructure. Move 24 last because it needs the live tier working to have something to campaign against.

Move 20 is a session. Moves 21-23 are each 1-2 sessions (Phase A is fast, Phase B depends on harness stability). Move 24 is integration work.
