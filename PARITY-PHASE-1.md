# Parity Phase 1: Temporal Row (Cells D×1 through D×5)

**Goal:** Fill the 5 highest-priority blind cells on the parity grid — the entire Temporal failure class across Filesystem, HTTP, Browser, Database, and CLI capabilities. Move parity from 50% to ~59%.

**Prerequisites:** None. All infrastructure exists. This is scenario generation + minor gate enhancements, not new architecture.

**Estimated output:** ~75-100 new scenarios across 5 staged files, 5 new harvest scripts, 1 small extension to the HTTP gate for timing simulation.

---

## Context: What You Need to Know

### What verify() is
`verify(edits, predicates, config)` runs 17 gates against a real app. No scenarios are involved in production use. Scenarios are tests of verify itself — they check whether verify's gates produce correct verdicts.

### What the parity grid is
An 8×7 matrix: 8 agent capabilities × 7 failure classes = 56 cells. Currently 50% covered. The Temporal column (D) is **completely blind** — 0/8 cells. Temporal failures are the most common real-world agent failures (race conditions, stale reads, timing issues).

### What "filling a cell" means
1. Write a harvest script (`scripts/harvest/stage-temporal-{cap}.ts`)
2. It generates scenarios that simulate the real timing failure
3. Output goes to `fixtures/scenarios/temporal-{cap}-staged.json`
4. Self-test loads these automatically and runs them through `verify()`
5. Oracle checks if verify got the right verdict
6. If verify gets it wrong → that's a bug in verify's gates → fix the gate

### Key files to read first
- `packages/verify/PARITY-GRID.md` — The grid. Cells D×1 through D×5 are defined with shapes and generator patterns.
- `packages/verify/GLOSSARY.md` — All terms defined.
- `packages/verify/ASSESSMENT.md` — What verify is and isn't. Read before forming opinions.
- `packages/verify/src/verify.ts` — The main pipeline. Gate sequence is hardcoded.
- `packages/verify/src/gates/http.ts` — HTTP gate (243 lines). Will need timing extension.
- `packages/verify/src/gates/browser.ts` — Browser gate (303 lines). Already has DOM settle detection.
- `packages/verify/scripts/harvest/stage-db-leaves.ts` — Example harvest script to follow.
- `packages/verify/scripts/harness/external-scenario-loader.ts` — How staged scenarios get loaded.
- `packages/verify/fixtures/demo-app/` — The test fixture app (server.js, init.sql, docker-compose.test.yml).

---

## The 5 Cells to Fill

### Cell D×1: Temporal × Filesystem

**Shapes (from PARITY-GRID.md):**
- TF-01: File written but not flushed when checked
- TF-02: Source edited but build artifact stale
- TF-03: Container volume mount not synced

**What to build:**
- `scripts/harvest/stage-temporal-fs.ts`
- Output: `fixtures/scenarios/temporal-fs-staged.json`
- ~15 scenarios

**How it works:** Generate scenarios where an edit is applied to a source file but the filesystem gate checks a different file (build output, cached copy) that hasn't updated yet. The scenario sets up edits that change `server.js` but the predicate checks a content hash or file content that would only be correct if a build step ran. `expectedSuccess: false` — verify should detect the staleness.

**No gate changes needed.** The filesystem gate already checks file hashes and content. The scenarios just expose whether it catches stale artifacts.

**Scenario pattern:**
```json
{
  "id": "tf-stale-001",
  "description": "Edit to server.js but content predicate checks stale cached copy",
  "edits": [{"file": "server.js", "search": "old-value", "replace": "new-value"}],
  "predicates": [{"type": "content", "file": "dist/bundle.js", "pattern": "new-value"}],
  "expectedSuccess": false,
  "expectedFailedGate": "filesystem",
  "tags": ["temporal", "filesystem", "stale_artifact"]
}
```

---

### Cell D×2: Temporal × HTTP

**Shapes:**
- TH-01: Server started but not accepting connections (ECONNREFUSED)
- TH-02: Response cached by proxy after deploy (stale response)

**What to build:**
- `scripts/harvest/stage-temporal-http.ts`
- Output: `fixtures/scenarios/temporal-http-staged.json`
- ~15-20 scenarios

**How it works:** Generate scenarios where HTTP predicates validate against a server that hasn't fully started, or where cached responses return stale data after a deploy.

**Gate enhancement needed:** The HTTP gate currently does single-shot validation. For temporal scenarios, we need `http_sequence` steps with an optional `delayBeforeMs` field — a pause between steps to simulate "check before server is ready" vs "check after server is ready." This is a small addition to `src/gates/http.ts`:

```typescript
// In the http_sequence step loop:
if (step.delayBeforeMs) {
  await new Promise(r => setTimeout(r, step.delayBeforeMs));
}
```

**Scenario pattern:**
```json
{
  "id": "th-race-001",
  "description": "HTTP request before server startup completes",
  "edits": [{"file": "server.js", "search": "listen(3000)", "replace": "listen(3000, () => { /* delayed init */ })"}],
  "predicates": [{
    "type": "http_sequence",
    "steps": [
      {"method": "GET", "path": "/health", "delayBeforeMs": 0, "expect": {"status": 200}},
      {"method": "GET", "path": "/health", "delayBeforeMs": 3000, "expect": {"status": 200}}
    ]
  }],
  "expectedSuccess": false,
  "tags": ["temporal", "http", "startup_race"]
}
```

---

### Cell D×3: Temporal × Browser

**Shapes:**
- TB-01: DOM not settled when CSS evaluated
- TB-02: Async content not rendered at check time
- TB-03: CSS transition midpoint captured

**What to build:**
- `scripts/harvest/stage-temporal-browser.ts`
- Output: `fixtures/scenarios/temporal-browser-staged.json`
- ~15 scenarios

**How it works:** The browser gate already has DOM settle detection (300ms mutation silence, 3s hard cap) and animation disabling. Temporal browser scenarios test whether these mechanisms are sufficient. Generate pages with:
- Delayed CSS class application (via JS setTimeout)
- Async-loaded content (fetch then render)
- CSS transitions/animations that would produce intermediate values

**No gate changes likely needed.** The browser gate's settle detection should handle most cases. If scenarios reveal gaps, the fix is in the settle algorithm, not new gate infrastructure.

**Scenario pattern:**
```json
{
  "id": "tb-settle-001",
  "description": "CSS class applied via setTimeout(100ms) — check before settle",
  "edits": [{
    "file": "server.js",
    "search": "<style>.delayed { color: red; }</style>",
    "replace": "<style>.delayed { color: red; }</style><script>setTimeout(() => document.querySelector('.delayed').style.color = 'blue', 100)</script>"
  }],
  "predicates": [{"type": "css", "selector": ".delayed", "property": "color", "expected": "blue"}],
  "expectedSuccess": true,
  "tags": ["temporal", "browser", "dom_settle"]
}
```

**Note:** These require `requiresPlaywright: true` and will only run in the `--full` tier.

---

### Cell D×4: Temporal × Database

**Shapes:**
- TD-01: Connection pool serves stale schema after migration
- TD-02: Read-after-write returns old data (replication lag)
- TD-03: Auto-increment not visible after migration

**What to build:**
- `scripts/harvest/stage-temporal-db.ts`
- Output: `fixtures/scenarios/temporal-db-staged.json`
- ~15-20 scenarios

**How it works:** The demo-app has a Postgres setup (`docker-compose.test.yml`, `init.sql` with 4 tables). Generate scenarios where:
- A migration adds a column, then a DB predicate immediately checks for it (may hit cached schema)
- An INSERT runs, then an immediate SELECT expects the row (replication lag simulation)
- Schema DDL runs but connection pool serves pre-DDL schema

**These require `requiresLiveHttp: true` and `requiresDocker: true`** — they need a real Postgres instance. Will only run in `--live` or `--full` tiers.

**Gate enhancement possibly needed:** The DB gate (`src/gates/grounding.ts` for schema introspection) may need a "force refresh" option to simulate pool staleness vs fresh introspection. Alternatively, scenarios can use `http_sequence` to test the API layer's response to schema changes (which is how agents actually interact with DBs in practice).

**Scenario pattern:**
```json
{
  "id": "td-stale-001",
  "description": "ALTER TABLE adds column, immediate DB predicate sees stale schema",
  "edits": [],
  "predicates": [{"type": "db", "table": "users", "column": "bio", "assertion": "column_exists"}],
  "config": {
    "migrations": [{"name": "add_bio", "sql": "ALTER TABLE users ADD COLUMN bio TEXT;"}]
  },
  "expectedSuccess": true,
  "expectedFailedGate": null,
  "tags": ["temporal", "database", "stale_pool"],
  "requiresDocker": true,
  "requiresLiveHttp": true
}
```

---

### Cell D×5: Temporal × CLI/Process

**Shapes:**
- TC-01: Process restart not complete when checked
- TC-02: Config change not picked up by running process

**What to build:**
- `scripts/harvest/stage-temporal-cli.ts`
- Output: `fixtures/scenarios/temporal-cli-staged.json`
- ~10-15 scenarios

**How it works:** Generate scenarios where a config file is edited but the running process hasn't reloaded. The infrastructure gate checks Terraform state / manifest files — temporal scenarios would test whether config edits are detected as "applied" when the process hasn't actually picked them up.

**No gate changes needed.** The config gate and infrastructure gate already check file state. The scenarios test whether verify correctly identifies "config file changed but process behavior unchanged" as a failure.

**Scenario pattern:**
```json
{
  "id": "tc-reload-001",
  "description": "Config file updated but process still serves old values",
  "edits": [{"file": "config.json", "search": "\"port\": 3000", "replace": "\"port\": 4000"}],
  "predicates": [{"type": "config", "file": "config.json", "key": "port", "expected": "4000"}],
  "expectedSuccess": true,
  "tags": ["temporal", "cli", "config_reload"]
}
```

---

## Execution Order

Work the cells in this order — each builds on the previous:

| Step | Cell | Why This Order | Gate Changes? |
|------|------|----------------|---------------|
| 1 | D×1 (Filesystem) | Simplest — pure filesystem, no Docker needed | No |
| 2 | D×5 (CLI/Process) | Also pure — config file checks, no Docker | No |
| 3 | D×2 (HTTP) | Needs `delayBeforeMs` extension to HTTP gate | Small |
| 4 | D×4 (Database) | Needs live Docker + Postgres | Possibly small |
| 5 | D×3 (Browser) | Needs Playwright Docker image | No |

Steps 1-2 run in the pure tier. Steps 3-5 need Docker or Playwright.

---

## Harvest Script Template

Every new script follows this exact pattern:

```typescript
#!/usr/bin/env bun
/**
 * Temporal × {Capability} scenario generator
 * Grid cell: D×{N}
 * Shapes: T{X}-01, T{X}-02, T{X}-03
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DEMO_APP = resolve(__dirname, '../../fixtures/demo-app');
const OUTPUT = resolve(__dirname, '../../fixtures/scenarios/temporal-{cap}-staged.json');

interface Scenario {
  id: string;
  description: string;
  edits: Array<{ file: string; search: string; replace: string }>;
  predicates: Array<Record<string, any>>;
  expectedSuccess: boolean;
  expectedFailedGate?: string;
  tags: string[];
  requiresDocker?: boolean;
  requiresPlaywright?: boolean;
  requiresLiveHttp?: boolean;
}

let counter = 0;
function nextId(prefix: string): string {
  return `td{n}-${prefix}-${String(++counter).padStart(3, '0')}`;
}

const scenarios: Scenario[] = [];

// --- Shape T{X}-01: {description} ---
// Generate scenarios here...

// --- Shape T{X}-02: {description} ---
// Generate scenarios here...

// Write output
writeFileSync(OUTPUT, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} temporal-{cap} scenarios → ${OUTPUT}`);
```

---

## Scenario Loading (Automatic)

No wiring needed. `external-scenario-loader.ts` automatically scans `fixtures/scenarios/*-staged.json` and loads any file that:
1. Is not `wpt-staged.json` (WPT is opt-in)
2. Contains objects with `edits: Array` and `predicates: Array`

New staged files are picked up on the next `bun run self-test`.

---

## Definition of Done

Phase 1 is complete when:

- [ ] 5 harvest scripts exist in `scripts/harvest/stage-temporal-{fs,http,browser,db,cli}.ts`
- [ ] 5 staged files exist in `fixtures/scenarios/temporal-{fs,http,browser,db,cli}-staged.json`
- [ ] ~75-100 total new scenarios across the 5 files
- [ ] `bun run self-test` passes with 0 dirty (pure tier covers D×1, D×5)
- [ ] `bun run self-test --live` passes (covers D×2, D×4)
- [ ] `bun run self-test --full` passes (covers D×3)
- [ ] If any scenario reveals a verify bug → gate is fixed, scenario stays as regression guard
- [ ] PARITY-GRID.md updated: D×1 through D×5 flipped from ✗ to ◐ or ✓
- [ ] FAILURE-TAXONOMY.md updated: temporal shapes added with grid cell references
- [ ] Memory file updated with new scenario counts

---

## What NOT to Do

- Do not build new gates. All 17 gates exist and work. You're writing scenarios, not architecture.
- Do not restructure the demo-app. Generate scenarios that work against the existing `fixtures/demo-app/`.
- Do not add new predicate types. Use existing types: `css`, `html`, `content`, `db`, `http`, `http_sequence`, `filesystem_*`, `config`, `infrastructure`.
- Do not modify the self-test runner. Staged scenarios load automatically.
- The only gate modification allowed is adding `delayBeforeMs` to HTTP sequence steps (Cell D×2). Keep it backward-compatible.

---

## After Phase 1

Phase 2 (Propagation row, E×1 through E×3) and Phase 3 (State Assumption cells) follow the same pattern but test cross-surface chains and environment divergence respectively. Phase 1 establishes the pattern; Phases 2-3 reuse it.

Expected parity after all 3 phases: ~68% (up from 50%).
