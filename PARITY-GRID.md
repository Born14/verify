# Verify Parity Grid

**The map of reality.** FAILURE-TAXONOMY.md is the dictionary. This is the map.

## The Law

> Verify has parity when every (agent capability × failure class) intersection
> is represented by at least one grounded, reproducible failure shape backed
> by a generator that simulates real-world failure mechanics.

A shape without a generator that reproduces the actual failure mechanism (timing, cross-surface chain, environment divergence, denial, exhaustion, collision) does not count toward parity.

## The Three Questions of Agent Failure

Verify was built around: **"Did the agent do the right thing?"**
That naturally covers Selection, Mutation, and Convergence.

True parity requires: **"Did the world react the way you expected?"**
That requires Temporal, Propagation, and State Assumption coverage.

Complete parity requires: **"Was the world even available to act on?"**
That requires Access, Capacity, and Contention coverage.

---

## Capability Axis (8 — what agents actually do)

| # | Capability | What It Means | Verify Domains |
|---|-----------|---------------|---------------|
| 1 | **Filesystem Edits** | Create, modify, delete files and directories | Filesystem, Content, F9 Syntax |
| 2 | **HTTP Calls** | Send requests, validate responses, API interaction | HTTP, Serialization |
| 3 | **Browser Interaction** | DOM manipulation, CSS changes, rendered state | Browser, CSS, HTML |
| 4 | **Database Operations** | Schema changes, migrations, data queries | DB |
| 5 | **CLI/Process Execution** | Run commands, manage services, build pipelines | Infrastructure, Staging, Configuration |
| 6 | **Multi-Step Workflows** | Coordinated actions across surfaces | Interaction, Invariant, Message |
| 7 | **Verification/Observation** | Checking own work, evidence gathering | Attribution, Vision/Triangulation, Observer Effects |
| 8 | **Configuration/State** | Env vars, feature flags, security, a11y, perf | Config, Security, A11y, Performance |

## Failure Class Axis (10 — invariant across all capabilities)

| # | Failure Class | What It Means | Generator Requirement |
|---|-------------|---------------|----------------------|
| A | **Selection** | Wrong target chosen | Static mock sufficient |
| B | **Mutation** | Change didn't apply correctly | Static mock sufficient |
| C | **State Assumption** | Wrong belief about current reality | Must simulate environment divergence |
| D | **Temporal** | Ordering, timing, readiness | Must simulate delay, async, incomplete readiness |
| E | **Propagation** | Change didn't cascade across layers | Must simulate multi-surface chain |
| F | **Observation** | Verification itself is wrong | Must simulate observer effects |
| G | **Convergence** | Repeating failed patterns | Must simulate learning loop |
| H | **Access** | Agent lacks permission to act on correct target | Must simulate permission denial, auth failure, or privilege boundary |
| I | **Capacity** | Environment runs out of a resource the agent needs | Must simulate resource exhaustion (memory, disk, rate limits, quotas) |
| J | **Contention** | Multiple actors collide on the same resource | Must simulate concurrent access, race conditions, or lock conflicts |

---

## The Grid

**Legend:** ✓ = strong coverage, ◐ = partial, ✗ = blind spot

| Capability ↓ / Failure → | A: Selection | B: Mutation | C: State | D: Temporal | E: Propagation | F: Observation | G: Convergence | H: Access | I: Capacity | J: Contention |
|--------------------------|:-----------:|:-----------:|:--------:|:-----------:|:--------------:|:--------------:|:--------------:|:---------:|:-----------:|:-------------:|
| **1. Filesystem** | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **2. HTTP** | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **3. Browser** | ✓ | ✓ | ◐ | ◐ | ◐ | ◐ | ✓ | ✗ | ✗ | ✗ |
| **4. Database** | ✓ | ✓ | ◐ | ◐ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **5. CLI/Process** | ✓ | ✓ | ◐ | ◐ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| **6. Multi-Step** | ✓ | ✓ | ◐ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **7. Verify/Observe** | ✓ | N/A | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| **8. Config/State** | ✓ | ✓ | ◐ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |

### Summary

| Failure Class | Capabilities Covered | Status |
|--------------|---------------------|--------|
| A: Selection | 8/8 | **STRONG** — grounding gate |
| B: Mutation | 7/8 | **STRONG** — F9 + staging |
| G: Convergence | 8/8 | **ELITE** — K5 differentiator |
| F: Observation | 4/8 | **MODERATE** — gaps in DB, CLI, Config |
| C: State Assumption | 2/8 strong, 6/8 partial | **PARTIAL** — Phase 3 complete (C×4, C×5, C×8, 43 scenarios) |
| D: Temporal | 5/8 partial | **PARTIAL** — Phase 1 complete (D×1–D×5, 66 scenarios) |
| E: Propagation | 3/8 partial | **PARTIAL** — Phase 2 complete (E×1–E×3, 44 scenarios) |
| H: Access | 0/8 | **BLIND** — no coverage |
| I: Capacity | 0/8 | **BLIND** — no coverage |
| J: Contention | 0/8 | **BLIND** — no coverage |

**Current parity: ~49% (39/80 cells strong or partial, 41/80 blind)**

---

## Completed Cells (Phases 1–3)

### Cell 1: Temporal × Database (D×4)

**Why first:** Agents constantly run migrations then immediately query. The most common silent failure in agent-driven DB work.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| TD-01 | Connection pool serves stale schema after migration | Simulate: run DDL → query via pooled connection → get old column set. Requires timing between schema change and pool refresh. |
| TD-02 | Read-after-write returns old data (replication lag) | Simulate: INSERT → immediate SELECT → empty result. Requires async delay between write and read visibility. |
| TD-03 | Auto-increment not visible after migration | Simulate: CREATE TABLE with SERIAL → query nextval → get unexpected value. Requires sequence state timing. |

**Definition of Done:** Generator executes DDL, then queries with configurable delay, and asserts stale/fresh result based on timing.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (14 scenarios, 14 clean)

---

### Cell 2: Temporal × Browser (D×3)

**Why second:** DOM settlement failures cause the most false negatives in browser gate verification.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| TB-01 | DOM not settled when CSS evaluated | Simulate: page load → immediate getComputedStyle → UA default value instead of authored. Requires check-before-settle timing. |
| TB-02 | Async content not rendered at check time | Simulate: page with lazy-loaded component → check before load completes → element not found. Requires async boundary simulation. |
| TB-03 | CSS transition midpoint captured | Simulate: trigger transition → sample during animation → intermediate value. Requires mid-transition observation. |

**Definition of Done:** Generator starts browser, evaluates predicate at controlled timing offset, asserts timing-dependent result.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (12 scenarios, 12 clean)

---

### Cell 3: Temporal × Filesystem (D×1)

**Why third:** File edit → immediate check is the most basic agent pattern, and it fails on slow I/O.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| TF-01 | File written but not flushed when checked | Simulate: write file → immediate hash check → stale content. Requires write-without-flush timing. |
| TF-02 | Source edited but build artifact stale | Simulate: edit source.css → check dist/bundle.css → old content. Requires build pipeline delay. |
| TF-03 | Container volume mount not synced | Simulate: host edit → container read → old content. Requires mount propagation delay. |

**Definition of Done:** Generator performs write, then reads at controlled timing, asserts stale content detection.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (15 scenarios, 15 clean)

---

### Cell 4: Temporal × HTTP (D×2)

**Why fourth:** Server startup race is the #1 cause of staging failures in verify already.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| TH-01 | Server started but not accepting connections | Simulate: process started → immediate HTTP request → ECONNREFUSED. Requires startup delay simulation. |
| TH-02 | Response cached by proxy after deploy | Simulate: deploy new code → HTTP GET → stale cached response. Requires cache layer simulation. |

**Definition of Done:** Generator starts server process, sends request at controlled delay offset, asserts connection/staleness failure.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (14 scenarios, 14 clean)

---

### Cell 5: Temporal × CLI/Process (D×5)

**Why fifth:** Config reload failures are invisible — process appears healthy but running old behavior.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| TC-01 | Process restart not complete when checked | Simulate: send SIGTERM → immediate health check → connection refused or partial state. Requires restart timing. |
| TC-02 | Config change not picked up by running process | Simulate: edit config file → check process behavior → old config values used. Requires process-without-restart simulation. |

**Definition of Done:** Generator modifies config/restarts process, probes at controlled timing, asserts old-behavior detection.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (11 scenarios, 11 clean)

---

### Cell 6: Propagation × HTTP (E×2)

**Why sixth:** The DB→API→UI chain is where most multi-layer agent failures originate.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| PH-01 | DB schema changed but API returns old shape | Simulate: add column to DB → GET /api/items → response missing new field. Requires DB change + API layer that doesn't pick it up. |
| PH-02 | API contract changed but frontend not updated | Simulate: change API response structure → frontend renders → missing/wrong data. Requires cross-service chain. |
| PH-03 | Env var changed but process serves old config | Simulate: update .env → HTTP request → response reflects old value. Requires config-without-restart chain. |

**Definition of Done:** Generator performs upstream change, then verifies downstream consumer sees stale/mismatched data through the full chain.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (14 scenarios: 7 pure, 7 live)

---

### Cell 7: Propagation × Filesystem (E×1)

**Why seventh:** Source→build→artifact chain fails constantly with bundled apps.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| PF-01 | Source correct but build artifact differs | Simulate: edit config.json port → check .env/Dockerfile → old value. Cross-file propagation gap. |
| PF-02 | File edit doesn't trigger rebuild | Simulate: rename API route in server.js → nav link still references old route. Edit doesn't cascade to related references. |

**Definition of Done:** Generator edits source, checks downstream artifact/runtime, asserts propagation failure detection.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (15 scenarios, 15 pure)

---

### Cell 8: Propagation × Browser (E×3)

**Why eighth:** CSS↔JS coupling is a common agent blind spot.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| PB-01 | CSS class renamed but HTML still uses old name | Simulate: rename .nav-link → .menu-link in CSS → HTML class="nav-link" unmatched. CSS↔HTML cross-reference. |
| PB-02 | HTML structure changed but selectors target old structure | Simulate: change h1 to h2 → CSS/selector targeting h1 finds nothing. DOM+selector cross-reference. |
| PB-03 | API response changed but frontend renders stale state | Simulate: rename API item → homepage HTML still hardcodes old name. API→UI propagation gap. |

**Definition of Done:** Generator performs upstream change, then checks downstream behavioral impact through cross-surface chain.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (15 scenarios: 9 pure, 6 Playwright)

---

### Cell 9: State Assumption × Config (C×5, C×8)

**Why ninth:** Agents assume their target environment matches their mental model. It usually doesn't.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| SA-01 | Feature flag differs by environment — staging config enables features that prod disables (or vice versa) | Environment-split check: config.staging.json darkMode=true but config.prod.json darkMode=false. Agent grounded on staging, deploys to prod — wrong feature set. |
| SA-02 | Default value masks missing config — fallback silently produces degraded behavior | Remove config value, code fallback takes over: PORT removed from .env, || 3000 masks absence. SECRET_KEY removed, hardcoded default is insecure. |
| SA-03 | Config precedence unpredictable — same value in multiple sources, which wins? | Multi-source disagreement: port in config.json vs .env vs docker-compose vs server.js fallback. DB host in config.json vs DATABASE_URL in .env. |

**Definition of Done:** Generator creates environment divergence, then verifies predicate catches (or misses) the mismatch.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (23 scenarios: 8 SA-01, 6 SA-02, 9 SA-03)

---

### Cell 10: State Assumption × Database (C×4)

**Why tenth:** Agents assume the DB they're looking at is the one they're deploying to.

| Shape | Description | Generator Pattern |
|-------|------------|-------------------|
| SD-01 | Wrong database identity — grounding source and execution target disagree on which DB | Agent inspects one schema/config surface but the actual database is a different one. Not "stale cache" (temporal) — the agent is pointing at the WRONG DATABASE entirely. No amount of waiting resolves this. |
| SD-02 | Data assumed present — table exists (CREATE TABLE) but has zero rows (no INSERT) | Check init.sql for INSERT statements. Agent assumes schema existence implies data existence. |
| SD-03 | Migration targets wrong DB — config.json and .env disagree on database name/host/port | Change DB name in config.json, check .env DATABASE_URL — two truth sources for connection. |

**Definition of Done:** Generator creates state assumption mismatch, then verifies predicate catches the incorrect belief.

**Status:** ☑ Shapes defined ☑ Generator exists ☑ Scenario validated (20 scenarios: 6 SD-01, 7 SD-02, 7 SD-03)

---

## Remaining Blind Cells (41 total)

### Original gaps (17 — from 7-class grid)

| Cell | Priority | Notes |
|------|----------|-------|
| Temporal × Multi-Step (D×6) | High | Cross-surface timing in workflows |
| Temporal × Verify/Observe (D×7) | High | Evidence stale by time of use |
| Temporal × Config (D×8) | Medium | TTL expiry, credential rotation |
| Propagation × DB (E×4) | High | Schema→query→response chain |
| Propagation × CLI (E×5) | Medium | Build→deploy→runtime chain |
| Propagation × Multi-Step (E×6) | Medium | Multi-service cascade |
| Propagation × Verify (E×7) | Low | Verification chain failures |
| Propagation × Config (E×8) | Medium | Config→process→behavior chain |
| State × Filesystem (C×1) | Medium | Wrong directory, stale snapshot |
| State × HTTP (C×2) | Medium | Wrong endpoint, stale cache |
| State × Browser (C×3) | Medium | Wrong viewport, stale DOM |
| State × Multi-Step (C×6) | Low | Cross-step assumption drift |
| Observation × DB (F×4) | Medium | DB read triggers side effects |
| Observation × CLI (F×5) | Medium | Probe changes system state |
| Observation × Config (F×8) | Low | Config check alters config |

### Access gaps (8 — new class H)

| Cell | Priority | Notes |
|------|----------|-------|
| Access × Filesystem (H×1) | High | File permission denied, read-only mount, ownership mismatch |
| Access × HTTP (H×2) | High | 401/403 from API, expired token, CORS rejection |
| Access × Browser (H×3) | Medium | CSP blocks script, CORS blocks fetch, iframe sandbox |
| Access × Database (H×4) | High | GRANT missing, role lacks ALTER/INSERT, connection denied |
| Access × CLI/Process (H×5) | High | sudo required, Docker socket denied, SSH key rejected |
| Access × Multi-Step (H×6) | Medium | Step N succeeds but step N+1 needs elevated privilege |
| Access × Verify/Observe (H×7) | Low | Probe blocked by firewall, metrics endpoint auth-gated |
| Access × Config (H×8) | Medium | .env file 600 permissions, secrets manager ACL, KMS denied |

### Capacity gaps (8 — new class I)

| Cell | Priority | Notes |
|------|----------|-------|
| Capacity × Filesystem (I×1) | High | Disk full during write, inode exhaustion, tmpfs overflow |
| Capacity × HTTP (I×2) | High | Rate limit (429), connection pool exhausted, payload too large (413) |
| Capacity × Browser (I×3) | Medium | Memory limit in headless browser, DOM node limit, localStorage quota |
| Capacity × Database (I×4) | High | Connection pool exhausted, max_connections hit, table bloat/vacuum |
| Capacity × CLI/Process (I×5) | High | OOM killed, PID limit, ulimit (open files, processes) |
| Capacity × Multi-Step (I×6) | Medium | Cumulative resource leak across steps, timeout budget exceeded |
| Capacity × Verify/Observe (I×7) | Low | Log volume overwhelms parser, metrics cardinality explosion |
| Capacity × Config (I×8) | Medium | .env too large for shell, config file exceeds parser limit |

### Contention gaps (8 — new class J)

| Cell | Priority | Notes |
|------|----------|-------|
| Contention × Filesystem (J×1) | High | Two agents edit same file, lock file conflict, git merge conflict |
| Contention × HTTP (J×2) | Medium | Concurrent deploys to same endpoint, session collision |
| Contention × Browser (J×3) | Low | Two tests driving same browser instance, shared cookie jar |
| Contention × Database (J×4) | High | Deadlock, concurrent migrations, row-level lock wait timeout |
| Contention × CLI/Process (J×5) | High | Port already in use, PID file stale, Docker container name conflict |
| Contention × Multi-Step (J×6) | Medium | Step 2 of workflow A conflicts with step 1 of workflow B |
| Contention × Verify/Observe (J×7) | Low | Two verifiers read conflicting snapshots of same resource |
| Contention × Config (J×8) | Medium | Two processes write .env simultaneously, config merge conflict |

---

## Definition of Done (per shape)

A shape counts toward parity when ALL of the following are true:

1. **Shape defined** — Named, described, mapped to grid cell
2. **Generator exists** — Produces scenario(s) that simulate real failure mechanics
3. **Generator simulates reality** — Temporal shapes use timing/delay. Propagation shapes use multi-surface chains. State shapes use environment divergence. Access shapes use permission denial. Capacity shapes use resource exhaustion. Contention shapes use concurrent actors. Static mocks do NOT count for D/E/C/H/I/J cells.
4. **Scenario validated** — Self-test runner executes scenario, asserts correct verdict
5. **Gate wired** — Existing gate(s) can detect the failure (or new gate identified if needed)

---

## The Rule

> Every new shape must answer: **Which capability × failure class cell does this fill?**
>
> If it doesn't fill a blind cell → don't add it.
>
> If the generator doesn't simulate the actual failure mechanism → it doesn't count.

---

## Metrics

| Metric | Current | After 80-cell grid | Parity Target |
|--------|---------|-------------------|---------------|
| Strong cells | 23/80 | — | 64/80 |
| Partial cells | 16/80 | — | 16/80 |
| Blind cells | 41/80 | 0/80 | 0/80 |
| Parity % | 49% | ~100% cell coverage | 100% depth |
| Shapes (total) | ~620 | ~700 | ~750+ |
| Scenarios (total) | ~1,794 | ~2,200 | ~2,500 |

---

## Relationship to FAILURE-TAXONOMY.md

**PARITY-GRID.md** (this file) is the **map of reality** — defines what must be covered.

**FAILURE-TAXONOMY.md** is the **dictionary** — defines individual shapes, their status, and technical details.

Every shape in FAILURE-TAXONOMY.md should reference its grid cell. Every grid cell should reference its shapes in FAILURE-TAXONOMY.md. The grid drives priorities; the taxonomy provides depth.
