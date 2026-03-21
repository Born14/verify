# Verify Testing Protocol

How the self-test harness works, how to run it, how to extend it, and how the improve loop finds and fixes bugs.

## What This Is

An autonomous testing + self-improvement system for `@sovereign-labs/verify` (v0.3.0). 74 built-in scenarios (80 with Docker) across 9 families exercise the verification pipeline's invariants, plus external fault-derived scenarios loaded from `.verify/custom-scenarios.json` when testing against a real app. When invariants are violated, the improve loop diagnoses the bug and proposes fixes — validated in subprocess isolation before any code changes.

Two components:
- **Self-test harness** (frozen) — generates scenarios, checks invariants, records results
- **Improve loop** (frozen) — detects violations, triages, generates fixes via LLM, validates in subprocess

The harness is the constitution. Verify is the governed subject. The improve loop can only edit verify's bounded surface — never itself.

## Quick Reference

```bash
# Pure-only against demo-app (no Docker, ~2.5s)
bun run packages/verify/scripts/self-test.ts

# Against a real app (built-in run against demo-app, external against target)
bun run packages/verify/scripts/self-test.ts --appDir=apps/football

# Full suite with Docker (~80s on Lenovo)
bun run packages/verify/scripts/self-test.ts --docker=true

# Specific families
bun run packages/verify/scripts/self-test.ts --families=A,B,G

# CI mode — exit 1 on bug-severity violations
bun run packages/verify/scripts/self-test.ts --fail-on-bug

# Custom ledger path
bun run packages/verify/scripts/self-test.ts --ledger=path/to/ledger.jsonl

# Improve loop — detect bugs + propose fixes
bun run packages/verify/scripts/self-test.ts --improve --llm=gemini --api-key=$GEMINI_API_KEY

# Improve dry run — triage only, no LLM calls or edits
bun run packages/verify/scripts/self-test.ts --improve --dry-run --llm=gemini --api-key=$GEMINI_API_KEY

# Local LLM for improve
bun run packages/verify/scripts/self-test.ts --improve --llm=ollama --ollama-model=qwen3:4b
```

On the Lenovo via SSH, always prefix with `PATH=$HOME/.bun/bin:$PATH` (non-interactive shells don't source .bashrc).

## The 9 Scenario Families

| Family | Count | Docker? | What It Tests | Key Bug Class |
|--------|-------|---------|---------------|---------------|
| **A** | 10 | No | Fingerprint collision detection | v0.1.1: HTTP predicates with different `bodyContains` producing identical fingerprints |
| **B** | 9 | No | K5 constraint learning (multi-step) | Constraint poisoning, scope leakage, false blocks |
| **C** | 7 | No | Gate sequencing and consistency | Gate ordering bugs, disabled gate leaks |
| **D** | 8 | No | G5 containment attribution | Attribution arithmetic (direct/scaffolding/unexplained) |
| **E** | 6 | No | Grounding validation | Grounding false negatives, fabricated selectors |
| **F** | 6 | Yes | Full Docker pipeline | End-to-end regressions (build → stage → verify) |
| **G** | 10+ | No | Edge cases, robustness, + external fault-derived scenarios | Crash/hang, chaos-discovered bugs |

### Family A: Fingerprint Collision

Generates **pairs** of predicates differing in exactly one field. Oracle asserts `predicateFingerprint(a) !== predicateFingerprint(b)`.

- A1: HTTP status 200 vs 404
- A2: HTTP bodyContains "Alpha" vs "Beta"
- A3: http_sequence with different step orders
- A4: CSS with different expected values
- A5: Same type/selector, different path
- A6: Optional field present vs absent
- A7: DB predicates differing in table/assertion
- A8: Canonicalization traps (null vs undefined vs absent, type coercion)
- A9: Triplets + permutations (3 predicates, any 2 must differ)
- A10: Regression guard (v0.1.1 exact reproduction)

### Family B: K5 Constraint Learning (Multi-Step)

Ordered sequences of `verify()` calls sharing a constraint store. Tests the learning loop.

- B1: 3 failures → constraint count monotonically increases
- B2: Corrected predicate (different fingerprint) passes K5
- B3: Same fingerprint blocked after failure
- B4: Expired constraint does not fire
- B5: Constraints persist across store reload
- B6: Max depth enforcement (cap at 5)
- B7: Override bypass via `overrideConstraints`
- B8: Harness-fault failure (DNS error) does NOT seed constraints
- B9: Scope isolation — constraint for path /a doesn't block path /b

### Family C: Gate Sequencing

- C1: F9 failure prevents K5 from running
- C2: Same input twice → identical gate names and order
- C3: Disabled gates absent from results
- C4: Most gates disabled → only F9 runs
- C5: Every gate has `durationMs >= 0`
- C6: Every failed gate has non-empty detail
- C7: K5 failure prevents staging

### Family D: Containment (G5) Attribution

- D1: CSS edit + CSS predicate → direct
- D2: Content edit + content predicate → direct
- D3: Dockerfile edit → scaffolding
- D4: Unrelated file → unexplained
- D5: Mixed edits → correct attribution split
- D6: Route handler + HTTP predicate → direct
- D7: Migration file + DB predicate → direct
- D8: No predicates → all unexplained

### Family E: Grounding Validation

- E1: Real selector (h1) → grounded
- E2: Fabricated selector → `groundingMiss=true`
- E3: Mixed real + fabricated
- E4: HTML predicates exempt (creation goals)
- E5: Real class selector (.subtitle) → grounded
- E6: Content/HTTP/DB predicates exempt

### Family F: Full Docker Pipeline

Requires Docker. Builds the demo-app fixture, runs verify with real container lifecycle.

- F1: Valid CSS edit passes all gates
- F2: Nonexistent file fails at F9
- F3: HTTP with bodyContains passes
- F4: HTTP with wrong bodyContains fails
- F5: Health invariant passes
- F6: Full pipeline audit (metadata, timing, gate count)

### Family G: Edge Cases

- G1: Empty edit array
- G2: Empty predicate array
- G3: Search string >10KB
- G4: Unicode in selector/expected
- G5: Duplicate edits
- G6: No-op edit (search == replace)
- G7: Non-existent file target
- G8: Predicate with every possible field
- G9: Pipe/equals/newline in values
- G10: Explicit null/undefined in fields

## Fixture Isolation (--appDir)

Built-in scenarios (families A-G) always run against `fixtures/demo-app` — they hardcode demo-app's CSS selectors (`.subtitle`, `h1 { color: #1a1a2e }`), text content (`Demo App`, `Alpha`), and routes. External scenarios (from `{appDir}/.verify/custom-scenarios.json`) run against the target app.

When `--appDir=apps/football`:
- **50 built-in scenarios** run against demo-app → all pass (known fixture)
- **16 external scenarios** run against football → 2 known bugs (G4 named color, G7 shorthand)
- **Total: 66 scenarios**, zero false failures from fixture mismatch

### External Scenario Classification

Each external scenario carries auto-classified metadata:

| Field | Values | How Classified |
|-------|--------|---------------|
| `transferability` | `universal`, `framework`, `app_specific` | Tags, rationale keywords, selector patterns, predicate types |
| `category` | `grounding`, `containment`, `constraints`, `staging`, etc. | `expectedFailedGate`, tags, intent, predicate types |

Classification is deterministic — `classifyTransferability()` and `classifyCategory()` in `src/store/external-scenarios.ts`. No LLM needed.

## How Scenarios Are Created

Scenarios are **deterministic generators** in `scripts/harness/scenario-generator.ts`. Each generator returns a `VerifyScenario` with:

```typescript
interface VerifyScenario {
  id: string;                    // e.g., "A2_http_bodyContains_collision"
  family: ScenarioFamily;        // 'A' | 'B' | ... | 'G'
  generator: string;             // generator function name
  description: string;           // human-readable
  edits: Edit[];                 // file edits to apply
  predicates: Predicate[];       // predicates to verify
  config: Partial<VerifyConfig>; // gate config overrides
  invariants: InvariantCheck[];  // what to check after verify() runs
  requiresDocker: boolean;
  steps?: VerifyScenario[];      // for multi-step (B family)
  expectedSuccess?: boolean;
}
```

To add a new scenario:

1. Pick the family (or create family H if needed)
2. Write a generator function that returns a `VerifyScenario`
3. Add invariant checks — what must be true after `verify()` runs?
4. Register it in `generateFamily()` switch
5. Run `--families=X` to test in isolation

### Adding a New Scenario (Example)

Say you want to test that CSS predicates with `!important` values are fingerprinted correctly:

```typescript
// In scenario-generator.ts, inside generateFamilyA():
scenarios.push({
  id: 'A11_css_important_fingerprint',
  family: 'A',
  generator: 'cssImportantFingerprint',
  description: 'CSS predicates with !important vs without must differ',
  edits: [],
  predicates: [],  // not needed — fingerprint tests don't call verify()
  config: {},
  requiresDocker: false,
  invariants: [
    fingerprintDistinct(
      { type: 'css', selector: 'h1', property: 'color', expected: 'red' },
      { type: 'css', selector: 'h1', property: 'color', expected: 'red !important' },
      'important_vs_plain'
    ),
  ],
});
```

### Adding a New Family

1. Add the letter to `ScenarioFamily` type in `types.ts`
2. Create `generateFamilyH()` in `scenario-generator.ts`
3. Add to the switch in `generateFamily()` and `generateAllScenarios()`
4. Decide: pure or Docker? Multi-step or single?

## The Oracle

Two invariant categories prevent confusion about whether verify is wrong or the harness is wrong:

**Product invariants** (verify is correct):
- `success` is boolean, `gates` is non-empty array
- If `success === true`, all gates passed
- Constraint count never decreases within a session
- Same predicate → same fingerprint (determinism)
- No individual gate > 5 minutes
- First failing gate is the reported failing gate

**Harness invariants** (self-test is correct):
- `verify()` completes without throwing
- Temp state dirs cleaned up
- Ledger append succeeds

**Severity levels:**
- `bug` — real defect (fingerprint collision, K5 false positive)
- `unexpected` — suspicious but possibly valid (gate took >30s)
- `info` — interesting observation

## How the Improve Loop Works

```
baseline → bundle → split → [diagnose] → generate → validate → holdout → verdict
```

### Step 1: Baseline Run
Runs the full self-test. Collects all ledger entries. Separates clean vs dirty.

### Step 2: Evidence Bundling
Groups violations by root cause (invariant name prefix). Each bundle gets a **deterministic triage** (0 LLM tokens):

| Confidence | Meaning | Action |
|------------|---------|--------|
| `mechanical` | Pattern maps to exact function + file | Skip LLM diagnosis, go straight to fix generation |
| `heuristic` | Strong guess at target file | LLM diagnosis for confirmation |
| `needs_llm` | Unknown target (e.g., crash with no stack trace) | Full LLM diagnosis required |

Triage rules in `improve-triage.ts` map invariant patterns to target functions:
- `fingerprint_distinct_*` → `predicateFingerprint()` in `constraint-store.ts`
- `k5_should_block_*` → `checkConstraints()` in `constraint-store.ts`
- `gate_order_*` → `verify()` in `verify.ts` (frozen — will be skipped)

### Step 3: Scenario Split
Clean scenarios split deterministically (hash-based):
- **70% validation** — must stay clean after fix
- **30% holdout** — catches overfitting

### Step 4: LLM Diagnosis (needs_llm only)
Sends violation evidence to Gemini/Anthropic/Ollama. Asks for root cause + specific function/file.

### Step 5: Fix Candidate Generation
LLM receives: violation evidence, target source code (focused on target function), optional diagnosis. Returns 2-3 distinct fix strategies as JSON `[{strategy, rationale, edits: [{file, search, replace}]}]`.

### Step 6: Subprocess Validation
For each candidate:
1. Copy entire package to temp dir (symlink node_modules)
2. Overlay edits onto the copy
3. Run self-test in subprocess
4. Score: `improvements - (regressions × 10) - min(changedLines × 0.1, 3.0)`

The line penalty is **capped at 3.0** — a correct 56-line fix shouldn't be rejected for being readable. Candidates with regressions are rejected. Score -100 = edit application failed.

### Step 7: Holdout Check
Best candidate (positive score, zero regressions) tested against the 30% holdout set. If any holdout scenario breaks → rejected as overfitting.

### Verdict
- `accepted` — winner passed holdout, edits printed for human review
- `rejected_regression` — best candidate broke clean scenarios
- `rejected_overfitting` — holdout caught generalization failure
- `rejected_no_fix` — no candidate improved anything
- `skipped_no_llm` — needs LLM but no provider configured

**Accepted edits are NOT auto-applied.** Human reviews and applies manually, or uses `verify_improve_apply` via MCP.

### MCP-Driven Improve Loop

The improve loop is also available as 6 MCP tools for interactive use (e.g., Claude Code as the doctor):

| Tool | Purpose |
|------|---------|
| `verify_improve_discover` | Run baseline, report dirty scenarios + bundles |
| `verify_improve_diagnose` | Read target source code for a specific bundle |
| `verify_improve_read` | Read arbitrary verify source files |
| `verify_improve_submit` | Submit fix candidate, validate in subprocess + holdout |
| `verify_improve_apply` | Apply accepted fix to live codebase |
| `verify_improve_cycle` | Full automated cycle (discover → generate → validate → report) |

**Session invalidation:** `verify_improve_apply` resets the internal session (baseline, bundles, split) so the next `verify_improve_discover` reflects the applied changes. The grounding cache is also cleared.

## Bounded Edit Surface

The improve loop can ONLY edit these files:

| File | What It Contains |
|------|-----------------|
| `src/store/constraint-store.ts` | Fingerprinting, K5 learning |
| `src/gates/constraints.ts` | K5 enforcement |
| `src/gates/containment.ts` | G5 attribution |
| `src/gates/grounding.ts` | CSS/HTML parsing |
| `src/gates/filesystem.ts` | Filesystem state verification |
| `src/gates/browser.ts` | Playwright validation |
| `src/gates/http.ts` | HTTP predicates |
| `src/gates/syntax.ts` | F9 edit application |

**Frozen (never edited by loop):**
- `src/verify.ts` — gate orchestrator
- `src/types.ts` — type definitions
- `scripts/harness/*` — the harness itself

If the triage targets a frozen file, the bundle is skipped.

## LLM Provider Configuration

```bash
# Gemini (recommended — cheapest, 2.5 Flash)
--llm=gemini --api-key=AIza...

# Anthropic (Claude Sonnet 4)
--llm=anthropic --api-key=sk-ant-...

# Ollama (local, no API key)
--llm=ollama --ollama-model=qwen3:4b --ollama-host=http://localhost:11434

# No LLM (baseline + triage only)
--llm=none
```

Typical cost for a full improve run with bugs: 2 LLM calls, ~7.5K tokens, <$0.01.

## Output Artifacts

All written to `packages/verify/data/` (gitignored):

| File | Contents |
|------|----------|
| `self-test-ledger.jsonl` | Per-scenario results (append-only) |
| `self-test-summary-{runId}.json` | Run summary with one-liner |
| `improvement-ledger.jsonl` | Per-bundle improve results |
| `improve-baseline-*.jsonl` | Temporary baseline (cleaned up) |

## Running on the Lenovo

```bash
# SSH to Lenovo
ssh -o "ProxyCommand='cloudflared access ssh --hostname ssh.vibestarter.net'" \
  -i ~/.ssh/sovereign-test sovereign@ssh.vibestarter.net

# Pure-only (fast)
PATH=$HOME/.bun/bin:$PATH bun run packages/verify/scripts/self-test.ts

# Full with Docker
PATH=$HOME/.bun/bin:$PATH bun run packages/verify/scripts/self-test.ts --docker=true

# Improve with Gemini (key from .env)
cd ~/sovereign
GEMINI_KEY=$(grep GEMINI_API_KEY .env | cut -d= -f2)
PATH=$HOME/.bun/bin:$PATH bun run packages/verify/scripts/self-test.ts \
  --improve --docker=true --llm=gemini --api-key=$GEMINI_KEY
```

**Important:** The Lenovo's auto-sync service (`sovereign-sync.service`) was disabled on March 19, 2026 because it auto-committed test artifacts. To re-enable: `sudo systemctl enable --now sovereign-sync`.

## Key Files

```
packages/verify/
  scripts/
    self-test.ts                    # CLI entry point (--appDir, --families, --improve, --docker, etc.)
    harness/
      types.ts                      # All shared types
      scenario-generator.ts         # 7 families of generators (A-G)
      external-scenario-loader.ts   # Deserialize fault-derived scenarios from custom-scenarios.json
      oracle.ts                     # Invariant checks
      runner.ts                     # Orchestrator (fixture isolation, pure/multi-step/Docker phases)
      ledger.ts                     # JSONL persistence
      report.ts                     # Console output + summary
      improve.ts                    # Improve loop orchestrator
      improve-triage.ts             # Deterministic triage (0 LLM tokens)
      improve-prompts.ts            # LLM diagnosis + candidate generation
      improve-subprocess.ts         # Copy, overlay, subprocess run, holdout
      improve-report.ts             # Improve result formatting
      llm-providers.ts              # Gemini/Anthropic/Ollama fetch wrappers
      claude-improve.ts             # Claude-specific prompts with architectural context
  fixtures/
    demo-app/                       # Test fixture (server.js, Dockerfile, etc.)
  src/
    mcp-server.ts                   # 16 MCP tools: 3 core + 4 campaign + 6 improve + 3 chaos
    verify.ts                       # Core pipeline: Grounding → F9 → K5 → G5 → Filesystem → Staging → Browser → HTTP → Invariants → Vision → Triangulation
    store/
      external-scenarios.ts         # Scenario store + classifyTransferability() + classifyCategory()
      constraint-store.ts           # K5 constraint persistence + fingerprinting
      fault-ledger.ts               # Fault classification + JSONL persistence + goalData for cross-session encoding
    gates/                          # Individual gate implementations (incl. filesystem.ts)

  data/                             # Runtime artifacts (gitignored)
  SELF-TEST-PLAN.md                 # Design doc with full family details
  TESTING-PROTOCOL.md               # This file
  AUTONOMOUS-CAMPAIGN-SPEC.md       # Campaign + improve loop architecture
  IMPROVEMENT-PLAYBOOK.md           # Mental model, two circles, daily rhythm
```

## Fault Discovery (The Outer Circle)

The 50 built-in scenarios are a **closed set** — they test known fault classes. New fault classes only emerge from novel inputs hitting verify's gates in unexpected ways. This section describes how to discover those faults.

### The Chaos Engine (Preferred Method)

Three MCP tools for autonomous, systematic stress-testing:

1. **`verify_chaos_plan`** — Reads grounding context and returns attack surface inventory + generation templates across 8 categories. **Reports scenario coverage per gate category** — flags gates with zero custom scenarios for targeted testing.
2. **`verify_chaos_run`** — Takes an array of goals (edits + predicates + expected outcome), fires each through `verify()`, auto-records to fault ledger, **persists goalData for cross-session encoding**, classifies expected vs actual. Returns per-goal results + campaign summary with bug fault IDs.
3. **`verify_chaos_encode`** — Takes fault IDs (or "all unencoded bugs"), pulls edits/predicates from session cache **with fault ledger goalData as cross-session fallback**, derives intent from classification + `expectedOutcome`, creates permanent scenarios via `ExternalScenarioStore`, links back to fault ledger.

The chaos engine is preferred over manual `verify_submit` because it handles recording, classification, and encoding automatically.

### Manual Fault Discovery

Use `verify_submit` MCP tool directly against a local app with Docker. No daemon, no Lenovo, no MCP relay chain.

```
Claude Code → verify_submit(appDir, edits, predicates)
                  ↓
              verify() pipeline (Grounding → F9 → K5 → G5 → Filesystem → Staging → Browser → Vision → HTTP → Invariants)
                  ↓
              Result + fault ledger entry
```

### The Wrong Way

Do NOT route fault discovery through Sovereign's daemon pipeline (`sovereign_submit` on the Lenovo). That path wraps verify in 15 layers of daemon infrastructure (E-H1 mutex, K5 from prior Sovereign jobs, staging SSH, visual sweep, classification timeouts). Claude loses context to Sovereign bugs instead of focusing on verify faults. Compaction events destroy the fault-hunting thread.

### Setup

1. Docker must be running locally
2. The demo-app fixture lives at `packages/verify/fixtures/demo-app/`
3. Core MCP tools:
   - `verify_ground` — scan app source for CSS/HTML/routes (read before editing)
   - `verify_read` — read a specific file (get exact search strings)
   - `verify_submit` — fire edits + predicates through verify's pipeline
4. Chaos engine tools (for systematic discovery):
   - `verify_chaos_plan` — attack surface inventory with coverage gaps
   - `verify_chaos_run` — batch goal execution with auto-recording
   - `verify_chaos_encode` — convert discovered bugs into permanent scenarios
5. Campaign tools:
   - `verify_campaign_ground` — grounding for a campaign target app
   - `verify_campaign_run_goal` — fire a single goal in campaign context
   - `verify_campaign_faults` — fault ledger queries
   - `verify_campaign_encode` — encode campaign-discovered faults

### Workflow

```bash
# 1. Ground — see what exists
verify_ground(appDir: "packages/verify/fixtures/demo-app")

# 2. Read — get exact file content for search strings
verify_read(appDir: "packages/verify/fixtures/demo-app", file: "server.js")

# 3. Submit — fire an edit with predicates
verify_submit({
  appDir: "packages/verify/fixtures/demo-app",
  edits: [{ file: "server.js", search: "color: #1a1a2e", replace: "color: red" }],
  predicates: [{ type: "css", selector: "h1", property: "color", expected: "rgb(255, 0, 0)" }]
})

# 4. Analyze — did verify get it right?
# If verify said PASS but something is broken → false_positive → encode scenario
# If verify said FAIL but the edit was correct → false_negative → encode scenario
```

### What to Throw at It

The goal is to find cases where **verify is wrong**, not cases where the edit is wrong.

**Adversarial predicates (verify says PASS when it shouldn't):**
- CSS predicate that matches a different element than intended
- HTTP predicate with loose `bodyContains` that matches error pages
- Predicate that passes in staging but fails in production (timing, async)

**False negative hunters (verify says FAIL when it shouldn't):**
- Correct edit but predicate uses authored value vs computed value (e.g., `orange` vs `rgb(255, 165, 0)`)
- CSS shorthand vs longhand mismatch
- Edit that's correct but search string has trailing whitespace difference
- HTTP predicate where response body has extra whitespace

**Edge cases:**
- `!important` in CSS values
- Multiple `<style>` blocks with same selector
- Inline styles vs stylesheet rules
- Unicode in selectors or values
- CSS custom properties (`var(--color)`)
- Predicates on routes that don't exist yet (creation goals)

**Novel app structures (beyond demo-app):**
- Create additional fixtures with different architectures (React, multi-page, API-only)
- Apps with multiple CSS files
- Apps with CSS-in-JS or Tailwind classes
- Apps with database dependencies

### From Fault to Scenario

When verify gets something wrong:

**Via chaos engine (preferred):**
1. The fault ledger entry is auto-created with goalData at `.verify/faults.jsonl`
2. Run `verify_chaos_encode` (or `npx @sovereign-labs/verify faults inbox` to review first)
3. Encoding auto-derives intent from classification + `expectedOutcome`, creates scenario in `.verify/custom-scenarios.json`, links back to fault ledger
4. Run self-test — new scenario should be dirty
5. Run improve loop (via MCP tools or CLI) — it proposes a fix
6. Apply fix, re-run self-test — scenario turns clean. Verify is stronger.

**Manually:**
1. The fault ledger entry is auto-created at `.verify/faults.jsonl`
2. Run `npx @sovereign-labs/verify faults inbox` to see unencoded verify bugs
3. Write a deterministic scenario in `scenario-generator.ts` that reproduces it
4. Link the fault: `npx @sovereign-labs/verify faults link <id> --scenario=A11`
5. Run self-test — new scenario should be dirty
6. Run improve loop — it proposes a fix
7. The scenario count grows. Verify is stronger.

### Why This Matters

The built-in scenarios test known fault classes. External scenarios (from `.verify/custom-scenarios.json`) grow organically as campaigns and chaos runs discover new bugs. But verify's real weakness is fault classes nobody has seen yet. The only way to find them is to throw diverse, creative, adversarial inputs at the pipeline and catch it being wrong.

The chaos engine is the preferred discovery method — it handles recording, classification, goalData persistence, and encoding automatically. `verify_chaos_plan` with coverage steering directs effort toward under-tested gates. The demo-app + `verify_submit` remains available for manual investigation — no Sovereign infrastructure between you and verify's gates.

## Test Results (March 2026)

### Baseline Results

| Test | Scenarios | Result | Dirty | Fix? | LLM Calls | Tokens | Duration |
|------|-----------|--------|-------|------|-----------|--------|----------|
| Default (pure, demo-app) | 50 | All clean | 0 | — | 0 | 0 | ~2.5s |
| Full (Docker) | 56 | All clean | 0 | — | 0 | 0 | ~80s |
| --appDir=football | 66 | 2 bugs (known gate bugs) | 2 | Pending | 0 | 0 | ~3.8s |
| Intentional regression | 50 | Bug found + fix accepted | 4 | Yes (+3.9) | 2 | 6439/1118 | ~3min |

The intentional regression removed `parts.push(body=${bc})` from `predicateFingerprint()`. The loop detected 8 bug violations across 4 scenarios, triaged to `constraint-store.ts`, Gemini proposed 3 candidates, subprocess validation found the winner (4 improvements, 0 regressions), holdout was clean, and it accepted the correct fix.

The football app 2 dirty are known verify gate bugs (G4: named color normalization, G7: CSS shorthand decomposition) — real bugs in verify, not fixture contamination. Both classified as `universal` transferability.

### Full Cycle Proof (March 20, 2026)

End-to-end chaos→encode→self-test→improve cycle against the football app:

1. **Chaos plan** — scanned football app grounding, identified 8 gate categories, reported coverage gaps
2. **Chaos run** — fired 8 diverse goals across categories (css_change, html_mutation, content_change, http_behavior, adversarial_predicate, grounding_probe)
3. **Results** — 4 bugs discovered (false positives + false negatives)
4. **Chaos encode** — auto-encoded bugs as scenarios in `.verify/custom-scenarios.json` with two-source intent derivation (session cache primary, fault ledger goalData fallback)
5. **Self-test** — new scenarios dirty as expected
6. **Improve** — 9 recommendations generated, 6 infrastructure improvements applied

**Bugs discovered across sessions:**

| Bug | Classification | Gate | Category |
|-----|---------------|------|----------|
| Named color normalization (G4) | false_negative | Grounding | grounding |
| CSS shorthand decomposition (G7) | false_negative | Grounding | grounding |
| HTTP bodyContains array handling | false_positive | HTTP | evidence |
| Grounding cache staleness | false_negative | Grounding | grounding |
| Intent derivation for regression_guard | false_positive | Constraints | constraints |
| Scoring cap needed for large fixes | improve_bug | Improve | — |

**Infrastructure improvements (March 2026):**

| Fix | What Changed |
|-----|-------------|
| Chaos encode intent | `regression_guard` classification → `should_fail` intent (was incorrectly `should_pass`) |
| Scoring cap | Line penalty capped at `min(lines × 0.1, 3.0)` — correct 56-line fixes no longer rejected |
| Session invalidation | `verify_improve_apply` resets baseline, bundles, split so next discover reflects changes |
| GoalData persistence | Fault ledger stores edits/predicates/expectedOutcome for cross-session encoding |
| Grounding cache | Mtime-based per appDir in `grounding.ts` with `clearGroundingCache()` export |
| Coverage steering | `verify_chaos_plan` reports scenarios per gate category, flags zero-scenario gates |
