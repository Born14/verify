# Verify Improvement Playbook

How verify gets smarter over time. The mental model, the pipeline, the daily rhythm.

## The One-Liner

Verify makes agents converge faster by learning from their mistakes. The constraints file is the product. The improve loop is the factory. Campaigns and the chaos engine are the fuel.

## Anatomy of Verify

The `@sovereign-labs/verify` package has distinct named components. Understanding what each piece is called prevents confusion when discussing the system.

| Component | What It Is | Where It Lives |
|-----------|-----------|----------------|
| **Package** | The npm artifact (`@sovereign-labs/verify` v0.3.0). What users install. | `packages/verify/` |
| **Pipeline** | The `verify()` function — the ordered gate sequence (Grounding→F9→K5→G5→Filesystem→Staging→Browser→Vision→HTTP→Invariants). The core product. | `src/verify.ts` |
| **Gates** | Individual validation steps. Each gate is a pure function: context in, pass/fail out. | `src/gates/*.ts` |
| **Store** | Persistent state — constraint store (K5 learning), fault ledger (discovery tracking + goalData persistence), external scenarios (encoded tests). | `src/store/*.ts` |
| **Harness** | The self-test + improve infrastructure. Runs 80 scenarios across 9 families against the pipeline, detects regressions, proposes fixes. The inner circle's engine. | `scripts/harness/*.ts` |
| **Campaign** | Outer-circle orchestration. Discovers real-world faults by firing diverse goals through `verify()` against real apps. | `scripts/campaign/*.ts` |
| **Chaos Engine** | 3 MCP tools (`verify_chaos_plan`, `verify_chaos_run`, `verify_chaos_encode`) that generate, execute, and encode stress-test goals autonomously. Sits at the intersection of both circles. | `src/mcp-server.ts` |
| **MCP Server** | The tool surface — 16 tools exposing pipeline, harness, campaign, and chaos to any MCP client. | `src/mcp-server.ts` |
| **CLI** | Command-line interface for `self-test`, `faults`, `improve`, and `ground`. | `src/cli.ts` |

**The relationship:** The *pipeline* is the product. The *harness* is the factory that improves it. *Campaigns* and the *chaos engine* are the fuel — they discover what the harness needs to fix. The *store* is the memory that compounds learning across sessions.

## The Two Circles

Verify has two concentric loops that never mix during runtime.

### Outer Circle: Real-World Usage (Campaigns + Chaos)

This is where agents run real tasks against real apps through verify's gates.

- An agent (Cursor, Aider, Claude Code, Sovereign, or a custom agent) proposes edits
- `verify()` gates every edit (Grounding → F9 → K5 → G5 → Filesystem → Staging → Browser → HTTP → Invariants → Vision → Triangulation)
- On failure: narrowing hints tell the agent what to try next
- On repeated failure: K5 blocks known-bad patterns automatically
- Each attempt shrinks the solution space until the agent converges or exhausts

The chaos engine accelerates discovery by firing systematic, diverse goals across 8 categories (css_change, html_mutation, content_change, http_behavior, db_schema, adversarial_predicate, mixed_surface, grounding_probe). `verify_chaos_plan` reports **coverage gaps** — which gate categories have zero custom scenarios — steering Claude toward under-tested areas.

The "intelligence" here is the agent's LLM. It's creative, unpredictable, sometimes wrong. Verify doesn't care which model it is. It just gates the output.

### Inner Circle: Self-Hardening (The Improve Loop)

This is verify's own quality assurance system. It runs offline, after failures have been collected.

- 66+ deterministic scenarios test verify's behavior against known invariants
- When a scenario is dirty (verify violates an invariant), the loop proposes fixes
- Fixes are validated in subprocess isolation with holdout protection
- Human reviews and applies accepted patches (or uses `verify_improve_apply` through MCP)

The loop is mostly deterministic. The only LLM call is for fix-candidate generation when the deterministic triage can't map the bug to an exact function.

### The Key Separation

The outer circle discovers problems in the real world.
The inner circle turns those problems into permanent improvements to verify.
They never run at the same time. Failures are just data (JSONL) that flows between them.

## What Makes This Recursive Self-Improvement

The output of the system improves the system itself:

```
verify gates code -> failures reveal verify bugs -> loop fixes verify -> verify gates better
```

This is structurally recursive. But it has hard limits that prevent runaway:

- **Frozen constitution** - the harness, oracle, scenarios, and constitutional gates never change by the loop
- **Bounded surface** - the loop can only edit 10 predicate gate files, never environment gates, invariant definitions, or its own tests
- **Human veto** - accepted patches require explicit apply (via `verify_improve_apply` or manual)
- **Subprocess isolation** - candidates validated in a copy, never the live codebase
- **Holdout protection** - 30% of clean scenarios catch overfitting
- **Scoring cap** - line penalty capped at 3.0 so correct large fixes aren't rejected

The loop is demand-driven, not continuous. No dirty scenarios = nothing to fix. It runs when there's real signal to learn from.

## The Three Tiers (How Users Benefit)

### Tier 1: Local Learning (Free, Automatic)
Every `verify()` call that fails creates a constraint in `.verify/memory.jsonl`. The next attempt is automatically smarter because K5 blocks the pattern that just failed. This happens inside a single session with zero config.

### Tier 2: Team Learning (Free, Commit the File)
`git commit .verify/constraints.json` shares one project's learning with the whole team. New developer clones the repo, their agent already knows what doesn't work. The file contains failure patterns, not secrets.

### Tier 3: Universal Feed (Paid, Future)
Curated constraints from nightly loop runs across many apps. A fresh install starts with 500+ constraints instead of zero. The pitch: "Your agent's first attempt is as smart as everyone's hundredth."

## Why This Matters for the Industry

2025 was the speed year (agents write code fast). 2026 is the quality year (agents need to write code *correctly*).

Every agent today is stateless. Every attempt starts from zero. Verify gives every agent a memory - not an LLM memory that hallucinates, but a deterministic memory that mechanically blocks known-bad patterns.

A mediocre model behind a thick constraint layer outperforms a frontier model with no constraints. Intelligence without memory repeats mistakes. Memory without intelligence prevents them.

Over enough time, the constraint set becomes so comprehensive that the only moves left are correct ones. From the outside, an agent that never fails is indistinguishable from one that's infinitely smart.

## The Fault Ledger (The Bridge)

The fault ledger (`src/store/fault-ledger.ts`) bridges the two circles. It captures real-world gate faults and tracks them from discovery to encoding.

### Entry Flow

```
Campaign/Chaos runs -> verify produces result + cross-check probes run
    |
    v
FaultLedger.recordFromResult(result, { app, goal, crossCheck })
    |
    v  (auto-classifies)
.verify/faults.jsonl
    |
    v  (chaos_run also patches goalData for cross-session encoding)
FaultLedger.patchGoalData(id, { edits, predicates, category, difficulty, expectedOutcome })
```

### Auto-Classification Rules

When verify says PASS:
- Health probe returns 500 -> `false_positive` (high confidence)
- Browser probe fails -> `false_positive` (high confidence)
- All probes pass -> `correct` (high confidence)

When verify says FAIL:
- All cross-check probes pass -> `false_negative` (medium confidence)
- Cross-check probes also fail -> `agent_fault` (high confidence)

Internal contradictions (success but gate failed, all gates passed but success is false) are always verify bugs regardless of probe results.

No cross-check evidence -> `ambiguous` (low confidence, needs human review or `expectedOutcome` from chaos cache)

### Fault Classifications

| Classification | Meaning | Action |
|---------------|---------|--------|
| `false_positive` | Verify said PASS but app is broken | Encode as scenario |
| `false_negative` | Verify said FAIL but edit was correct | Encode as scenario |
| `bad_hint` | Narrowing sent agent in wrong direction | Encode as scenario |
| `correct` | Verify judged correctly | No action needed |
| `agent_fault` | Agent was wrong, verify was right | No action needed |
| `ambiguous` | Can't determine automatically | Human reviews or chaos encode uses expectedOutcome |

### goalData Persistence (Cross-Session Encoding)

The fault ledger's `goalData` field stores the original edits, predicates, category, difficulty, and `expectedOutcome` from the chaos run. This ensures encoding works even after VS Code restart (when the session cache is lost).

```typescript
interface FaultEntry {
  // ... standard fields ...
  goalData?: {
    edits: Array<{ file: string; search: string; replace: string }>;
    predicates: Array<Record<string, unknown>>;
    category?: string;
    difficulty?: string;
    expectedOutcome?: string;  // 'pass' | 'fail' — used for intent derivation
  };
}
```

### CLI Commands

```bash
npx @sovereign-labs/verify faults inbox      # Unencoded verify bugs (the morning inbox)
npx @sovereign-labs/verify faults review     # Ambiguous entries needing human eyes
npx @sovereign-labs/verify faults summary    # Statistics overview
npx @sovereign-labs/verify faults list       # All entries (--filter=X, --app=X)
npx @sovereign-labs/verify faults log        # Manual entry (--app, --goal, --class, --reason)
npx @sovereign-labs/verify faults classify   # Override classification (<id> --class=X --reason=Y)
npx @sovereign-labs/verify faults link       # Connect fault to scenario (<id> --scenario=A11)
```

## The Daily Rhythm

### Evening: Chaos Runs

The chaos engine fires diverse goals through verify's gates. Goals can be:
- Autonomous (chaos engine generates goals from grounding context via `verify_chaos_plan` + `verify_chaos_run`)
- Manual (you submit through `verify_submit` or `verify_campaign_run_goal`)
- Real usage (end users running verify on their projects)

Every outcome is auto-logged to the fault ledger with cross-check probes. Goal data is persisted for cross-session encoding.

### Morning: Triage + Encode + Fix

```bash
# 1. Check the inbox (~2 minutes)
npx @sovereign-labs/verify faults inbox

# 2. Review ambiguous entries (~3 minutes)
npx @sovereign-labs/verify faults review
npx @sovereign-labs/verify faults classify <id> --class=agent_fault --reason="K5 was right"

# 3. Encode via chaos tools (automatic — or manual scenario writing)
#    verify_chaos_encode handles intent derivation automatically
#    Or write scenarios in scenario-generator.ts and link:
npx @sovereign-labs/verify faults link <id> --scenario=C8

# 4. Run self-test — new scenarios should be dirty (~2 seconds)
npx @sovereign-labs/verify self-test

# 5. Run improve via MCP tools (Claude Code as doctor) or fallback:
bun run packages/verify/scripts/self-test.ts --improve --llm=gemini --api-key=$KEY

# 6. Apply fixes, re-run self-test
#    Via MCP: verify_improve_apply → verify_improve_discover (confirm 0 dirty)
#    Via CLI: manually apply edits, re-run self-test
```

### What Accelerates Failure Discovery

The bottleneck is always discovery, not fixing. Three levers:

1. **More goals per session** - Chaos engine with 10-20 diverse goals across 8 categories. Cost: $0 on Claude Code Max.
2. **More apps** - Different architectures stress different gates. Use GitHub import to bring in React, Python, multi-service apps.
3. **Coverage steering** - `verify_chaos_plan` now reports which gates have zero custom scenarios. Target those gaps first.
4. **Adversarial goals** - Deliberately probe gate boundaries: CSS with !important, 15-file edits, unicode selectors, 10-step HTTP sequences, named colors, shorthand properties.

### The Chaos Engine

Three MCP tools for autonomous stress-testing of any app verify can reach:

1. **`verify_chaos_plan`** — Reads grounding context (routes, CSS, HTML, schema, constraints, prior faults). Returns structured attack surface inventory + generation templates across 8 categories. **New: reports scenario coverage per gate category** — shows which gates have zero scenarios and suggests goal types to fill the gaps.
2. **`verify_chaos_run`** — Takes an array of goals (edits + predicates + expected outcome), fires each through `verify()`, auto-records to the fault ledger, **persists goalData for cross-session encoding**, classifies expected vs actual, caches goal data for encoding. Returns per-goal results + campaign summary with bug fault IDs.
3. **`verify_chaos_encode`** — Takes fault IDs (or "all unencoded bugs"), pulls edits/predicates from session cache **with fault ledger goalData as cross-session fallback**, derives intent from classification + expectedOutcome, creates permanent scenarios via `ExternalScenarioStore`, links back to fault ledger. Turns discovered bugs into self-test armor.

The diversity of target apps matters as much as goal diversity. A chaos engine firing creative goals against one app will eventually plateau. The same engine against 20 different apps surfaces new failure classes for much longer.

## The Pipeline (Complete)

```
Chaos Engine / Campaign (generates diverse goals)
    |
verify_chaos_run / verify_campaign_run_goal
    |
Verify Gates (Grounding -> F9 -> K5 -> G5 -> Filesystem -> Staging -> Browser -> HTTP -> Invariants -> Vision -> Triangulation)
    |
recordFromResult() auto-classifies + patchGoalData() persists goal context
    |
.verify/faults.jsonl (the fault ledger)
    |
faults inbox (unencoded verify bugs)
    |
verify_chaos_encode (automatic) or manual scenario writing
    |
faults link (marks fault as encoded)
    |
self-test (new scenarios are dirty)
    |
Improve Loop (Claude Code as doctor, or API LLM fallback)
    |
verify_improve_apply (apply + revalidate)
    |
Verify is stronger -> back to top
```

### What Exists Today

| Piece | Status |
|-------|--------|
| Verify gates | Shipped (v0.3.0 on npm) |
| Self-test harness | Shipped (80 built-in scenarios, 9 families A-H + V) |
| Improve loop | Built, proven end-to-end (chaos→encode→improve→apply) |
| Fault ledger | Built, wired into CLI, goalData persistence for cross-session |
| memory.jsonl | Works for end users today |
| Chaos engine | Built (3 MCP tools: plan with coverage steering, run with goalData, encode with intent derivation) |
| Auto scenario encoding | Built (via `verify_chaos_encode` with two-source intent derivation) |
| Grounding cache | Built (mtime-based per appDir, cleared after apply) |
| Coverage steering | Built (chaos plan reports scenarios per gate category) |
| Universal constraint feed | Not built (future) |

### Open Source (Everything)

The entire verify system is open source, including the improve loop. Verify is a standard, not a product. Maximum adoption requires zero friction — teams need the full loop to harden verify for their own surfaces.

- `scripts/harness/improve.ts` - improve loop orchestrator
- `scripts/harness/improve-triage.ts` - deterministic triage rules
- `scripts/harness/improve-prompts.ts` - LLM diagnosis + candidate generation
- `scripts/harness/improve-subprocess.ts` - subprocess validation + holdout (capped scoring)
- `scripts/harness/improve-report.ts` - improve result formatting
- `scripts/harness/claude-improve.ts` - Claude-specific prompts with architectural context
- `scripts/harness/llm-providers.ts` - Gemini/Anthropic/Ollama wrappers

Open source everything. The improve loop is the contribution surface, not the moat. The moat is the standard — every agent framework, every surface, every domain speaking the same constraint language.

## Key Analogies

- **Chaos engine** = the geologist (finds new minerals systematically)
- **Campaigns** = the expedition (targeted exploration)
- **You** = the taxonomist (classifies what was found)
- **Fault ledger** = the field notebook (permanent record of discoveries, with goalData for encoding)
- **Scenarios** = the museum collection (encoded knowledge)
- **Improve loop** = the museum guard (nothing in the collection goes missing)
- **constraints.json** = the shared language (what every agent speaks)

## The Long Game

The labs are making models smarter.
We're making failure impossible.

Both look like "it just works."

The difference is: their gains reset with context.
Ours compound with every mistake that never happens again.

Constraints aren't intelligence.
They're the systematic removal of stupidity.

And when enough stupidity is removed, what's left behaves like true intelligence.


                     +-----------------------------------+
                     |          Outer Circle             |
                     |   Chaos Engine + Campaigns        |
                     |   (Creative / Agent LLM here)     |
                     +-----------------------------------+
                                    │
                                    ▼
                        [Agent proposes code edit]
                                    │
                                    ▼
                        [verify gates the edit]
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                    │
          PASS (apply)        FAIL (log)            Bad hint
               │                    │                    │
               └────────────────────┼────────────────────┘
                                    │
                                    ▼
                    recordFromResult() + patchGoalData()
                    (auto-classifies, persists goal context)
                                    │
                                    ▼
                         .verify/faults.jsonl
                                    │
                                    ▼
                            faults inbox
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
               agent_fault     ambiguous      verify bug
               (auto-filtered)  (uses         (auto-encode
                                expectedOutcome  via chaos)
                                to classify)
                    │               │               │
                    ▼               ▼               ▼
                  ignore        classify     verify_chaos_encode
                                                    │
                                    ┌───────────────┘
                                    │  ← Automatic (chaos encode)
                                    │  ← Or manual scenario writing
                                    ▼
                     +-----------------------------------+
                     |          Inner Circle             |
                     |   Improve Loop (MCP-driven)       |
                     +-----------------------------------+
                                    │
                                    ▼
                    verify_improve_discover (dirty?)
                                    │
                                    ▼
                    verify_improve_diagnose + read
                                    │
                                    ▼
                    verify_improve_submit (validate + holdout)
                                    │
                                    ▼
                    verify_improve_apply (apply + revalidate)
                                    │
                                    ▼
                      Verify is now stronger
                                    │
                                    └──────────────┐
                                                   ▼
                              Back to Outer Circle (next session)
