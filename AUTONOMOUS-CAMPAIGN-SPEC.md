# Autonomous Verify Campaign System

**Goal:** A fully autonomous loop that discovers verify bugs by running diverse, LLM-generated edits against real apps — then feeds those bugs into the improve loop to fix them. The outer loop (fault discovery) is driven by Claude Code via MCP tools. The inner loop (fix generation) uses Claude Code as the primary doctor, with cloud LLM fallback.

## Two Loops, Two Architectures

### Outer Loop — Fault Discovery (MCP-driven)

Claude Code acts as the campaign brain, calling MCP tools step by step. Each tool call is atomic — Claude Code reasons between calls. No API key needed for reasoning (Max subscription). Works today.

**Chaos Engine (preferred — autonomous stress-testing):**
```
Claude Code
  ├─ verify_chaos_plan            → Recon: grounding + fault history + coverage gaps + goal templates
  ├─ (reason about attack surface, craft diverse goals across 8 categories)
  ├─ verify_chaos_run             → Fire goals through verify(), auto-classify, cache for encoding
  ├─ (analyze results, identify verify bugs by fault ID)
  └─ verify_chaos_encode          → Encode bugs as permanent self-test scenarios
```

**Campaign Tools (manual/surgical fault hunting):**
```
Claude Code
  ├─ verify_campaign_ground       → Get app's CSS, HTML, routes, schema
  ├─ (reason about grounding, craft adversarial goals)
  ├─ verify_campaign_run_goal     → Submit edits + predicates through verify pipeline
  ├─ (analyze result, identify verify bugs)
  ├─ verify_campaign_faults       → Review fault ledger
  └─ verify_campaign_encode       → Encode verify bugs as self-test scenarios
```

**Why MCP works here:** Each step returns a result, Claude Code reasons about it, then decides the next step. The LLM reasoning happens *between* tool calls — no blocking.

### Inner Loop — Fix Generation (MCP-driven, Claude Code primary)

Claude Code drives the improve loop directly via MCP tools — same pattern as the outer loop. Each tool call is atomic, Claude Code reasons between calls, no subprocess deadlock.

```
Claude Code
  ├─ verify_improve_discover      → Run baseline, get violations + triage + source code
  ├─ verify_improve_diagnose      → Get structured diagnosis context (source, coupled files, contracts)
  ├─ (reason about root cause from evidence)
  ├─ verify_improve_read          → Inspect additional files for context
  ├─ (craft fix edits)
  ├─ verify_improve_submit        → Submit diagnosis + fix edits for validation
  ├─ (harness validates in subprocess, runs holdout, returns verdict)
  └─ verify_improve_apply         → Apply winning edits to real source + revalidate
```

**Why this works:** The previous `--llm=claude-code` CLI mode deadlocked because the improve CLI spawned as a subprocess that blocks waiting for Claude Code's response while Claude Code blocks on the subprocess. The MCP approach eliminates the subprocess — each step returns a result, Claude Code reasons, then calls the next step.

**Fallback:** `verify_improve_cycle` runs the full pipeline with a cloud LLM (Gemini, Anthropic) for diagnosis and fix generation. This is the batch fallback when interactive improvement isn't practical.

```bash
# Via MCP tool (fallback mode)
verify_improve_cycle llm=gemini apiKey=$GEMINI_API_KEY

# Via CLI (same fallback)
bun run src/cli.ts improve --llm=gemini --api-key=$GEMINI_API_KEY
```

**Why Claude Code is the preferred doctor:** Claude Code built the verify pipeline. It understands every gate, every invariant, every triage rule. Gemini hallucinates file names (`verifier.py`) when diagnosing without a targeted triage rule. Claude Code reads the actual source and reasons from structure.

## Proven End-to-End Cycle (March 2026)

### First Campaign Session (March 19)

```
1. Ground football app          → verify_campaign_ground
2. Craft adversarial goals      → Claude Code reasons about grounding
3. Run goals through verify     → verify_campaign_run_goal (×3)
4. Discover 3 real verify bugs  → Analysis of verify results
5. Encode as scenarios          → verify_campaign_encode
6. Run self-test                → bun run src/cli.ts self-test
7. Oracle detects bugs          → 1 dirty (fabricated .sidebar selector)
8. Fix the bug                  → Added grounding gate to verify.ts
9. Re-run self-test             → 0 dirty, 0 regressions
```

### Second Session: Full Chaos→Encode→Improve Cycle (March 20)

```
1. Chaos plan (football app)    → verify_chaos_plan  (recon + coverage gaps)
2. Generate 8 goals across categories → Claude Code crafts from templates
3. Chaos run                    → verify_chaos_run (8 goals, 3 bugs found)
4. Encode bugs                  → verify_chaos_encode (3 scenarios created)
5. Run self-test                → 1 dirty scenario (named color normalization)
6. Discover + diagnose          → verify_improve_discover + verify_improve_diagnose
7. Submit fix                   → verify_improve_submit → ACCEPTED (score: +1.9)
8. Apply fix                    → verify_improve_apply → 0 dirty confirmed
```

### Bugs Discovered Across Sessions

| Bug | What Happened | Gate | Session |
|-----|--------------|------|---------|
| Fabricated CSS selector passes | `.sidebar` doesn't exist in app but verify says PASS | grounding | 1 |
| Cross-route style bleeding | Path-less CSS predicate matches first route, ignoring conflicts | grounding/browser | 1 |
| Wrong HTML text passes | HTML predicate with incorrect expected text passes all gates | browser | 1 |
| Named color normalization | `orange` in CSS not matched by `rgb(255, 165, 0)` in predicate | grounding | 2 |
| Shorthand→longhand gap | CSS `border: 1px solid black` not matched by `border-color: black` | grounding | 2 |
| HTML wrong route match | HTML predicate matches wrong route handler content | grounding | 2 |

## Architecture

### What's Built

```
packages/verify/
  src/
    mcp-server.ts             # MCP server with 16 tools (3 verify + 4 campaign + 6 improve + 3 chaos)
    verify.ts                 # Core pipeline: grounding → F9 → K5 → G5 → filesystem → staging → browser → ...
    gates/
      grounding.ts            # groundInReality() + validateAgainstGrounding() + mtime cache
      syntax.ts               # F9: edit application
      constraints.ts          # K5: learned constraint enforcement
      containment.ts          # G5: mutation attribution
      filesystem.ts           # Filesystem state verification (exists/absent/unchanged/count)
      staging.ts              # Docker build + start
      browser.ts              # Playwright CSS/HTML validation
      http.ts                 # HTTP endpoint validation
      vision.ts               # Screenshot + model verification
      invariants.ts           # System health checks
    store/
      constraint-store.ts     # K5 constraint persistence + fingerprinting
      fault-ledger.ts         # Fault classification + JSONL persistence + goalData
      external-scenarios.ts   # Custom scenario store (.verify/custom-scenarios.json)
  scripts/
    harness/
      runner.ts               # Self-test runner (loads built-in + external scenarios)
      scenario-generator.ts   # Built-in scenarios (families A-G)
      external-scenario-loader.ts  # Deserialize fault-derived scenarios
      oracle.ts               # Invariant checking
      improve.ts              # Improve loop orchestrator
      improve-triage.ts       # Deterministic violation → target file mapping
      improve-prompts.ts      # Generic LLM prompts for diagnosis + fix gen
      improve-subprocess.ts   # Subprocess validation + holdout + capped scoring
      improve-report.ts       # Improve result formatting
      claude-improve.ts       # Claude-specific prompts with architectural context
      llm-providers.ts        # Gemini, Anthropic, Ollama, Claude Code providers
    campaign/
      campaign.ts             # CLI entry
      campaign-runner.ts      # Orchestrator
      goal-generator.ts       # LLM goal generation
      edit-generator.ts       # LLM edit generation
      app-registry.ts         # App discovery
      cross-check.ts          # Independent probes
      claude-brain.ts         # Claude API provider for campaign
      claude-code-brain.ts    # File exchange provider (deadlocks — see above)
  fixtures/
    demo-app/                 # Self-test fixture app
      .verify/
        custom-scenarios.json # Fault-derived scenarios
```

### MCP Tools (16 total)

| Tool | Loop | Purpose |
|------|------|---------|
| **Core Pipeline** | | |
| `verify_ground` | Both | Read CSS, HTML, routes, schema from app |
| `verify_read` | Both | Read a source file |
| `verify_submit` | Both | Submit edits + predicates through pipeline |
| **Campaign (Surgical)** | | |
| `verify_campaign_ground` | Outer | Ground + format for campaign brain |
| `verify_campaign_run_goal` | Outer | Submit goal with edits + predicates, get verdict |
| `verify_campaign_faults` | Outer | View fault ledger |
| `verify_campaign_encode` | Outer | Encode fault as self-test scenario |
| **Chaos Engine (Autonomous)** | | |
| `verify_chaos_plan` | Outer | Recon: grounding + constraints + faults + coverage gaps + templates |
| `verify_chaos_run` | Outer | Fire batch of goals, auto-classify, cache for encoding |
| `verify_chaos_encode` | Outer | Encode bugs from chaos run as permanent scenarios |
| **Improve Loop** | | |
| `verify_improve_discover` | Inner | Run baseline, return violations + triage + source |
| `verify_improve_diagnose` | Inner | Structured diagnosis context (source, coupled files, contracts) |
| `verify_improve_read` | Inner | Read verify pipeline source file for diagnosis |
| `verify_improve_submit` | Inner | Submit diagnosis + fix edits, validate + holdout |
| `verify_improve_apply` | Inner | Apply winning edits to real source + revalidate baseline |
| `verify_improve_cycle` | Inner | Full automated cycle with API LLM (fallback) |

### Gate Sequence

```
grounding → F9 (syntax) → K5 (constraints) → G5 (containment) →
filesystem (post-edit state) → staging (Docker) → browser (Playwright) →
HTTP (fetch) → invariants (health) → vision (screenshot) →
triangulation (3-authority verdict) → narrowing (learning)
```

## Self-Test Scenario Families

| Family | Count | What It Tests |
|--------|-------|---------------|
| A | 10 | Predicate fingerprinting (distinct, deterministic) |
| B | 9 | K5 constraint enforcement (multi-step, persistence) |
| C | 7 | Gate sequencing (order, consistency, disabled gates) |
| D | 8 | G5 containment attribution (direct, scaffolding, unexplained) |
| E | 6 | Grounding validation (real vs fabricated selectors) |
| F | 6 | Docker scenarios (requires Docker) |
| G | 10+ | Edge cases + fault-derived external scenarios |

External scenarios (from campaign/chaos fault discovery) are loaded from `.verify/custom-scenarios.json` and merged into family G.

## Improve Loop Triage

The improve loop maps self-test invariant violations to target files using deterministic pattern matching. Rules cover both built-in invariants and fault-derived scenarios:

| Invariant Pattern | Target | Confidence |
|-------------------|--------|------------|
| `fingerprint_*` | `src/store/constraint-store.ts` | mechanical |
| `k5_should_*` | `src/store/constraint-store.ts` | mechanical |
| `gate_*` | `src/verify.ts` | heuristic |
| `should_fail_at_grounding` | `src/gates/grounding.ts` | heuristic |
| `should_fail_at_browser` | `src/gates/browser.ts` | heuristic |
| `should_fail_at_constraints` | `src/gates/constraints.ts` | heuristic |
| `should_fail_at_http` | `src/gates/http.ts` | heuristic |
| `should_detect_problem` | (needs LLM — ambiguous target) | needs_llm |
| `should_accept_valid_edit` | (needs LLM) | needs_llm |

### Bounded Edit Surface

The improve loop can only modify these 8 files:

| File | What It Does |
|------|-------------|
| `src/store/constraint-store.ts` | Fingerprinting, K5 learning |
| `src/gates/constraints.ts` | K5 enforcement logic |
| `src/gates/containment.ts` | G5 attribution |
| `src/gates/grounding.ts` | CSS/HTML parsing, route extraction |
| `src/gates/filesystem.ts` | Filesystem state verification |
| `src/gates/browser.ts` | Playwright CSS/HTML validation |
| `src/gates/http.ts` | HTTP predicate validation |
| `src/gates/syntax.ts` | F9 edit application |

Frozen files: `src/verify.ts` (orchestrator), `src/types.ts`, `scripts/harness/` (harness logic).

## Running the Loops

### Chaos Engine (Autonomous Stress-Testing — Preferred)

Claude Code calls chaos tools for systematic, diverse testing:

1. **Plan the attack:** `verify_chaos_plan` with `appDir` → returns recon, templates, and **coverage gaps** (which gates have zero custom scenarios)
2. **Craft goals:** Reason about recon, generate goals across 9 categories (css_change, html_mutation, content_change, http_behavior, db_schema, filesystem_change, adversarial_predicate, mixed_surface, grounding_probe)
3. **Run all goals:** `verify_chaos_run` with goals array → auto-records faults, caches goal data
4. **Encode bugs:** `verify_chaos_encode` with fault IDs (or "all") → creates permanent scenarios

### Campaign Tools (Manual Fault Hunting)

1. **Ground the app:** `verify_campaign_ground` with `appDir` pointing to the app
2. **Craft goals:** Reason about the grounding context, design adversarial edits
3. **Run each goal:** `verify_campaign_run_goal` with edits + predicates
4. **Review faults:** `verify_campaign_faults` to see what was discovered
5. **Encode bugs:** `verify_campaign_encode` to create self-test scenarios

### Inner Loop (Improve — via MCP, Claude Code primary)

Claude Code calls MCP tools directly (preferred — you are the doctor):

1. **Discover violations:** `verify_improve_discover` → baseline + triage + source code
2. **Get diagnosis context:** `verify_improve_diagnose` → target source, coupled files, invariant contracts
3. **Read target files:** `verify_improve_read` → full source with line numbers
4. **Reason:** Diagnose the root cause from the evidence and source code
5. **Craft fix:** Design search/replace edits targeting the bounded edit surface
6. **Submit fix:** `verify_improve_submit` → harness validates, holdout checks, returns verdict
7. **Apply winning edits:** `verify_improve_apply` → applies edits to real source + revalidates baseline
8. **Confirm:** `verify_improve_discover` again → should show 0 dirty

**Fallback (API LLM):**

```bash
# Via MCP tool
verify_improve_cycle llm=gemini apiKey=$GEMINI_API_KEY

# Via CLI
bun run src/cli.ts improve --llm=gemini --api-key=$GEMINI_API_KEY

# Dry run — see triage without generating fixes
bun run src/cli.ts improve --llm=gemini --api-key=$GEMINI_API_KEY --dry-run
```

### Self-Test

```bash
# All families
bun run src/cli.ts self-test

# Specific families
bun run src/cli.ts self-test --families=G     # External scenarios only
bun run src/cli.ts self-test --families=A,B   # Fingerprint + K5 only

# With Docker
bun run src/cli.ts self-test --docker
```

## Custom Scenario Format

Encoded by `verify_chaos_encode` or `verify_campaign_encode` into `.verify/custom-scenarios.json`:

```json
[
  {
    "id": "cs-1773979765152-2pnu03",
    "description": "Fabricated CSS selector (.sidebar) passes verify",
    "intent": "false_positive",
    "expectedSuccess": false,
    "edits": [
      { "file": "server.js", "search": "h1 { ... }", "replace": "h1 { ... }" }
    ],
    "predicates": [
      { "type": "css", "selector": ".sidebar", "property": "background-color", "expected": "red", "path": "/" }
    ],
    "requiresDocker": false,
    "expectedFailedGate": "grounding",
    "rationale": "Predicate references .sidebar which does not exist. Verify should reject.",
    "tags": ["css", "grounding", "fabricated-selector"],
    "transferability": "universal",
    "category": "grounding",
    "encodedAt": "2026-03-20T04:09:25.152Z"
  }
]
```

### Scenario Classification

Each encoded scenario gets two classification fields:

**Transferability** — how portable is this scenario:
- `universal` — tests a verify gate bug that applies to any app (CSS spec, grounding logic)
- `framework` — tests a pattern specific to a framework structure
- `app_specific` — tests something unique to this app's code

**Category** — which verify subsystem it exercises:
- `grounding`, `containment`, `constraints`, `staging`, `syntax`, `sequencing`, `evidence`, `narrowing`

These are computed deterministically by `classifyTransferability()` and `classifyCategory()`. Existing scenarios without classification get backfilled via `backfillClassifications()`.

### Intent Semantics (Critical)

| Intent | Meaning | Oracle Invariant |
|--------|---------|-----------------|
| `false_positive` | Verify wrongly PASSES (should fail) | `should_detect_problem`: if `result.success` → bug |
| `false_negative` | Verify wrongly FAILS (should pass) | `should_accept_valid_edit`: if `!result.success` → bug |
| `bad_hint` | Narrowing sends wrong direction | `narrowing_should_be_helpful`: check hint exists |
| `regression_guard` | General regression | `outcome_matches_expected`: success matches expected |

**Common mistake:** Encoding a "verify passes when it shouldn't" bug as `false_negative` instead of `false_positive`. The intent describes the bug class, not the current behavior.

### Intent Derivation (Chaos Encode)

The `verify_chaos_encode` tool derives intent using a two-source strategy:

1. **Session cache (primary):** Goal data including `expectedOutcome` is cached in memory during `verify_chaos_run`. Fast, available within the same session.
2. **Fault ledger `goalData` (fallback):** Goal data is persisted to the fault ledger entry via `patchGoalData()`. Survives VS Code restart / session loss.

**Derivation rules:**
- `classification === 'false_positive'` → `intent: 'false_positive'`
- `classification === 'false_negative'` → `intent: 'false_negative'`
- `classification === 'bad_hint'` → `intent: 'bad_hint'`
- `classification === 'ambiguous'` + `expectedOutcome === 'fail'` + verify passed → `intent: 'false_positive'`
- `classification === 'ambiguous'` + `expectedOutcome === 'pass'` + verify failed → `intent: 'false_negative'`
- Default → `intent: 'regression_guard'`

## What Each Gate Needs

| Gate | Docker | Playwright | Network | LLM | File System |
|------|--------|-----------|---------|-----|-------------|
| Grounding | - | - | - | - | Read source files |
| F9 Syntax | - | - | - | - | Read + write staging copy |
| K5 Constraints | - | - | - | - | Read constraint store |
| G5 Containment | - | - | - | - | Analyze edits vs predicates |
| Filesystem | - | - | - | - | Read filesystem (exists, hash, count) |
| Staging | YES | - | localhost | - | Build + start container |
| Browser | YES | YES | localhost | - | Playwright in Docker |
| Vision | YES | YES | vision API | YES | Screenshot + model call |
| HTTP | YES | - | localhost | - | fetch() to container |
| Invariants | YES | - | localhost | - | Health checks |

**Pure gate testing (no Docker):** Grounding, F9, K5, G5, and Filesystem run without Docker. This covers fabricated selectors, edit syntax, constraint enforcement, mutation attribution, and filesystem state verification — the most common fault classes.

## Scoring Formula

Fix candidates are scored by the subprocess validator:

```
score = improvements - (regressions × 10) - min(changedLines × 0.1, 3.0)
```

- **Improvements:** Dirty scenarios that became clean with the fix
- **Regressions:** Clean scenarios that broke (heavily penalized at 10×)
- **Line penalty:** Minimal-patch bias, but capped at 3.0 — a correct 56-line fix pays the same penalty as a 30-line fix. Preserves preference for smaller patches without rejecting correct large fixes.
- **Score -100:** Edit application failed (search string not found)

## Cost Model

| Activity | LLM | Cost |
|----------|-----|------|
| Outer loop (chaos engine) | Claude Code Max | $0 (subscription) |
| Outer loop (campaign) | Claude Code Max | $0 (subscription) |
| Inner loop (improve, primary) | Claude Code Max | $0 (subscription) |
| Inner loop (improve, fallback) | Gemini Flash | ~$0.005 per run (2-5 calls) |
| Self-test | None | $0 |

Both loops run at $0 under the Max subscription. The Gemini fallback exists for automation scenarios where interactive MCP isn't available.

## Performance Optimizations (March 2026)

| Optimization | What | Impact |
|-----|------|--------|
| Grounding cache | Mtime-based cache per appDir in `grounding.ts` | 8 chaos goals = 1 filesystem scan instead of 8 |
| Session invalidation | `verify_improve_apply` resets stale baseline/bundles/split | `discover` after `apply` always reflects current state |
| Cross-session encoding | `goalData` persisted to fault ledger via `patchGoalData()` | Encoding works after VS Code restart |
| Coverage steering | `verify_chaos_plan` reports scenarios per gate category | Claude sees which gates have zero scenarios |
| Intent derivation | Two-source strategy (session cache + fault ledger fallback) | Correct intent even for `ambiguous` classifications |
| Scoring cap | Line penalty capped at 3.0 | Large correct fixes no longer penalized to death |

## Known Gaps

### Pre-existing K5 Bugs (B/C families)

3 K5 constraint enforcement bugs surfaced during testing. These are pre-existing issues in `constraint-store.ts`, not caused by the grounding gate:

- B3: Same predicate fingerprint not blocked after evidence failure
- B5: Constraint seeded in one store instance doesn't persist across reload
- C7: K5 constraint failure doesn't prevent staging from running

These are the first targets for the MCP-driven improve loop — Claude Code can diagnose and fix them interactively.

### Not Yet Addressed

- **Custom scenarios not loaded by CLI `self-test.ts`**: The runner loads them, but the CLI may not pass the right appDir for non-fixture apps
- **Search-string pre-validation in chaos_run**: No check that edits match the actual file content before firing
- **LLM improve cycle quality**: Gemini hallucinates filenames; Claude Code is the reliable doctor

## The Endgame

```
Chaos discovers bugs → Scenarios encoded → Self-test detects → Improve loop fixes → Verify hardens
                                                                                        |
Chaos runs again → fewer bugs → goals get more adversarial → new fault classes found ──┘
```

Each cycle:
- Verify gets stricter (more scenarios, stronger gates)
- Goals get harder (adversarial categories probe new assumptions)
- The constraint store grows (K5 blocks more known-bad patterns)
- Coverage gaps shrink (chaos plan steers toward under-tested gates)

**Stopping condition:** When adversarial campaigns produce zero verify bugs for 5 consecutive sessions.
