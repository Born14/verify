# Verify Architecture — Full System Diagram

## The Complete Two-Circle Flow

```
                     ╔═══════════════════════════════════════╗
                     ║          OUTER CIRCLE                 ║
                     ║   Chaos Engine + Campaigns            ║
                     ║   (Creative / Agent LLM here)         ║
                     ║                                       ║
                     ║   3 MCP tools:                        ║
                     ║     verify_chaos_plan    (recon)       ║
                     ║     verify_chaos_run     (fire goals)  ║
                     ║     verify_chaos_encode  (encode bugs) ║
                     ║                                       ║
                     ║   8 goal categories:                  ║
                     ║     css_change, html_mutation,        ║
                     ║     content_change, http_behavior,    ║
                     ║     db_schema, adversarial_predicate, ║
                     ║     mixed_surface, grounding_probe    ║
                     ╚═══════════════════════════════════════╝
                                        │
                                        ▼
                          [Agent proposes code edit]
                            edits[] + predicates[]
                                        │
                                        ▼
                ╔═══════════════════════════════════════════════╗
                ║            THE PIPELINE (12 gates)            ║
                ║                                               ║
                ║   ┌──────────┐    ┌──────────┐    ┌────────┐ ║
                ║   │Grounding │───▶│    F9    │───▶│   K5   │ ║
                ║   │ (reality)│    │ (syntax) │    │(memory)│ ║
                ║   └──────────┘    └──────────┘    └────────┘ ║
                ║         │                              │      ║
                ║         │   CSS selectors exist?       │      ║
                ║         │   Routes valid?              │      ║
                ║         │   Edit creates selector?     │      ║
                ║         │                              ▼      ║
                ║         │              ┌─────────────────────┐║
                ║         │              │         G5          │║
                ║         │              │   (containment)     │║
                ║         │              │  every edit traces   │║
                ║         │              │  to a predicate      │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │    Filesystem       │║
                ║         │              │  Post-edit state    │║
                ║         │              │  exists/absent/     │║
                ║         │              │  unchanged/count    │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │    ════════════════════════════     ║
                ║         │     DOCKER BOUNDARY (below)        ║
                ║         │    ════════════════════════════     ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │      Staging        │║
                ║         │              │  Docker build+start │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │      Browser        │║
                ║         │              │  Playwright CSS/HTML│║
                ║         │              │  getComputedStyle() │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │        HTTP         │║
                ║         │              │  fetch() endpoints  │║
                ║         │              │  status + body      │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │    Invariants       │║
                ║         │              │  Health checks      │║
                ║         │              │  System-scoped      │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │    ════════════════════════════     ║
                ║         │     END DOCKER BOUNDARY              ║
                ║         │    ════════════════════════════     ║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │       Vision        │║
                ║         │              │  Screenshot + model │║
                ║         │              │  (pre-captured buf) │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │              ┌─────────────────────┐║
                ║         │              │   Triangulation     │║
                ║         │              │  3-authority verdict│║
                ║         │              │  deterministic +    │║
                ║         │              │  browser + vision   │║
                ║         │              └─────────────────────┘║
                ║         │                        │            ║
                ║         │                        ▼            ║
                ║         │                        │            ║
                ║         │    On failure: Narrowing (inline)     ║
                ║         │      K5 constraint seeded             ║
                ║         │      Resolution hints returned        ║
                ║         │      Banned fingerprints tracked      ║
                ╚═══════════════════════════════════════════════╝
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
          PASS (apply)            FAIL (learn)            Bad hint
          attestation             narrowing               (misleading
          checkpoint              constraints              direction)
               │                        │                        │
               └────────────────────────┼────────────────────────┘
                                        │
                                        ▼
                          recordFromResult() + patchGoalData()
                          (auto-classifies, persists goal context)
                                        │
                                        ▼
                               .verify/faults.jsonl
                              (the fault ledger)
                                        │
                                        ▼
                                  faults inbox
                          (unencoded verify bugs)
                                        │
                      ┌─────────────────┼─────────────────┐
                      │                 │                 │
                 agent_fault       ambiguous         verify bug
                 (verify was      (uses cached       (auto-encode
                  correct)        expectedOutcome     via chaos)
                      │           to classify)            │
                      ▼                 │                 ▼
                    ignore          classify      verify_chaos_encode
                                                  (or manual scenario
                                                   writing)
                                                         │
                                        ┌────────────────┘
                                        │
                                        ▼
                          .verify/custom-scenarios.json
                         (21 scenarios: 14 false_positive,
                          3 false_negative, 2 bad_hint,
                          2 regression_guard)
                                        │
                                        │  merged with 80 built-in
                                        │  scenarios (families A-H, V)
                                        ▼
                     ╔═══════════════════════════════════════╗
                     ║          INNER CIRCLE                 ║
                     ║   Improve Loop (Self-Hardening)       ║
                     ║                                       ║
                     ║   Frozen constitution:                ║
                     ║     Harness cannot edit itself         ║
                     ║     Bounded to 10 predicate gates     ║
                     ║     Subprocess isolation              ║
                     ║     30% holdout protection             ║
                     ╚═══════════════════════════════════════╝
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  1. verify_improve_discover          │
                     │     Run baseline → find dirty         │
                     │     scenarios → triage → source       │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  2. verify_improve_diagnose          │
                     │     Structured diagnosis context:     │
                     │     target source, coupled files,     │
                     │     invariant contracts               │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  3. verify_improve_read              │
                     │     Inspect additional source files   │
                     │     for root cause analysis           │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  4. Claude Code / LLM reasons        │
                     │     Diagnose root cause from          │
                     │     evidence + source code            │
                     │     Craft search/replace fix edits    │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  5. verify_improve_submit            │
                     │     Validate in subprocess copy:      │
                     │       - Apply edits to temp dir       │
                     │       - Symlink node_modules          │
                     │       - Run all scenarios             │
                     │       - Check holdout (30%)           │
                     │       - Score: improvements -         │
                     │         (regressions × 10) -          │
                     │         min(lines × 0.1, 3.0)        │
                     │     Return: ACCEPTED / REJECTED       │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  6. verify_improve_apply             │
                     │     Apply winning edits to real       │
                     │     source files → revalidate         │
                     │     baseline → confirm 0 dirty        │
                     └──────────────────────────────────────┘
                                        │
                                        ▼
                          ══════════════════════════
                            Verify is now stronger
                          ══════════════════════════
                                        │
                                        └───────────────────┐
                                                            ▼
                                          Back to Outer Circle
                                            (next session)


## The Bounded Edit Surface (10 files)

The improve loop can ONLY modify **predicate gates** — gates that evaluate truth
claims about the world. Everything else is frozen.

The distinction is principled, not mechanical:
- **Predicate gates** evaluate truth ("does this CSS selector have this value?").
  Bugs here mean verify is wrong about reality. Self-improvement makes these more accurate.
- **Environment gates** (`staging.ts`) orchestrate Docker. Mutating this risks
  masking failures instead of detecting them.
- **Constitutional gates** (`invariants.ts`) define what "healthy" means. If the
  loop can rewrite health checks, it can redefine success.

```
  ┌─────────────────────────────────────────────────────┐
  │            EDITABLE — Predicate Gates (10 files)     │
  │                                                     │
  │  src/store/constraint-store.ts   Fingerprinting,    │
  │                                  K5 learning        │
  │                                                     │
  │  src/gates/constraints.ts        K5 enforcement     │
  │  src/gates/containment.ts        G5 attribution     │
  │  src/gates/grounding.ts          CSS/HTML parsing,   │
  │                                  route extraction    │
  │  src/gates/filesystem.ts         Filesystem state   │
  │  src/gates/browser.ts            Playwright         │
  │  src/gates/http.ts               HTTP validation    │
  │  src/gates/syntax.ts             F9 edit app        │
  │  src/gates/vision.ts             Screenshot model   │
  │  src/gates/triangulation.ts      3-authority verdict │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │            FROZEN — Environment + Constitutional     │
  │                                                     │
  │  src/verify.ts                   Pipeline orchestr. │
  │  src/types.ts                    Type definitions   │
  │  src/gates/staging.ts            Docker orchestr.   │
  │  src/gates/invariants.ts         Health definitions │
  │  scripts/harness/*.ts            Harness logic      │
  │  scripts/harness/oracle.ts       Invariant checks   │
  │  scripts/harness/scenario-       Scenario generators│
  │    generator.ts                                     │
  └─────────────────────────────────────────────────────┘
```


## Value Hierarchy

```
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │                                                       │  │
  │  │  ┌─────────────────────────────────────────────────┐  │  │
  │  │  │                                                 │  │  │
  │  │  │  ┌───────────────────────────────────────────┐  │  │  │
  │  │  │  │                                           │  │  │  │
  │  │  │  │  ┌─────────────────────────────────────┐  │  │  │  │
  │  │  │  │  │                                     │  │  │  │  │
  │  │  │  │  │   5. CHAOS ENGINE                   │  │  │  │  │
  │  │  │  │  │   The fuel                          │  │  │  │  │
  │  │  │  │  │   (discovers what to fix)           │  │  │  │  │
  │  │  │  │  │                                     │  │  │  │  │
  │  │  │  │  └─────────────────────────────────────┘  │  │  │  │
  │  │  │  │                                           │  │  │  │
  │  │  │  │   4. IMPROVE LOOP                         │  │  │  │
  │  │  │  │   The factory                             │  │  │  │
  │  │  │  │   (turns bugs into fixes)                 │  │  │  │
  │  │  │  │                                           │  │  │  │
  │  │  │  └───────────────────────────────────────────┘  │  │  │
  │  │  │                                                 │  │  │
  │  │  │   3. SELF-TEST HARNESS                          │  │  │
  │  │  │   The proof                                     │  │  │
  │  │  │   (80+ scenarios, deterministic, <3s)           │  │  │
  │  │  │                                                 │  │  │
  │  │  └─────────────────────────────────────────────────┘  │  │
  │  │                                                       │  │
  │  │   2. VERIFICATION PIPELINE                            │  │
  │  │   The product                                         │  │
  │  │   (12 gates, what users install from npm)             │  │
  │  │                                                       │  │
  │  └───────────────────────────────────────────────────────┘  │
  │                                                             │
  │   1. GOVERNANCE KERNEL (@sovereign-labs/kernel)             │
  │   The foundation                                            │
  │   (7 invariants, 871 tests, domain-agnostic)               │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
```


## The Two Learning Loops

```
  ╔═════════════════════════════════════════════════════════════╗
  ║  GLOBAL LOOP (improves verify for everyone)                ║
  ║                                                            ║
  ║  Chaos → Fault Ledger → Encode → Self-Test → Improve →    ║
  ║  Fix Gates → npm publish → all users benefit               ║
  ║                                                            ║
  ║  Runs on: Lenovo (nightly) or any CI                       ║
  ║  Output:  Stronger gates in next release                   ║
  ╚═════════════════════════════════════════════════════════════╝

  ╔═════════════════════════════════════════════════════════════╗
  ║  PER-PROJECT LOOP (improves verify for one codebase)       ║
  ║                                                            ║
  ║  Agent proposes edit → verify() fails → K5 constraint      ║
  ║  seeded → next attempt blocked from same mistake →         ║
  ║  agent converges → .verify/memory.jsonl grows              ║
  ║                                                            ║
  ║  Runs on: every verify() call, automatic, zero config      ║
  ║  Output:  Smarter constraints for THIS project             ║
  ║  Share:   git commit .verify/memory.jsonl                  ║
  ╚═════════════════════════════════════════════════════════════╝


               Independent but complementary.
          Global makes the tool better for the world.
        Per-project makes it smarter for your codebase.
```


## MCP Tool Surface (16 tools)

```
  ┌─────────────────────────────────────────────────────┐
  │  CORE PIPELINE (any agent)                          │
  │                                                     │
  │  verify_ground ─────── Read CSS/HTML/routes/schema  │
  │  verify_read ──────── Read a source file            │
  │  verify_submit ────── Submit edits through pipeline │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │  CAMPAIGN (surgical fault hunting)                  │
  │                                                     │
  │  verify_campaign_ground ── Ground + format          │
  │  verify_campaign_run_goal ── Submit + get verdict   │
  │  verify_campaign_faults ── View fault ledger        │
  │  verify_campaign_encode ── Encode as scenario       │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │  CHAOS ENGINE (autonomous stress-testing)           │
  │                                                     │
  │  verify_chaos_plan ──── Recon + coverage gaps       │
  │  verify_chaos_run ───── Fire batch of goals         │
  │  verify_chaos_encode ── Encode bugs as scenarios    │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │  IMPROVE LOOP (self-hardening)                      │
  │                                                     │
  │  verify_improve_discover ── Baseline + violations   │
  │  verify_improve_diagnose ── Diagnosis context       │
  │  verify_improve_read ────── Read target files       │
  │  verify_improve_submit ──── Validate + holdout      │
  │  verify_improve_apply ───── Apply + revalidate      │
  │  verify_improve_cycle ───── Full auto (LLM fallback)│
  └─────────────────────────────────────────────────────┘
```


## Scenario Families (80 built-in + custom external)

```
  ┌─────┬────────┬─────────────────────────────────────────────┐
  │ Fam │ Count  │ What It Tests                               │
  ├─────┼────────┼─────────────────────────────────────────────┤
  │  A  │   10   │ Fingerprint collisions (the founding bug)   │
  │  B  │    9   │ K5 constraint learning (multi-step)         │
  │  C  │    7   │ Gate sequencing + consistency               │
  │  D  │    8   │ G5 containment attribution                  │
  │  E  │    6   │ Grounding validation (real vs fabricated)   │
  │  F  │    6   │ Full Docker pipeline (build→stage→verify)   │
  │  G  │   10   │ Edge cases (unicode, empty, no-ops)         │
  │  H  │   10   │ Filesystem predicates (exists/absent/       │
  │     │        │ unchanged/count)                            │
  │  V  │   14   │ Vision + triangulation (screenshot +        │
  │     │        │ 3-authority verdict synthesis)              │
  ├─────┼────────┼─────────────────────────────────────────────┤
  │ EXT │  var   │ Fault-derived from chaos/campaign runs      │
  │     │        │ (false_positive, false_negative, bad_hint,  │
  │     │        │ regression_guard)                           │
  └─────┴────────┴─────────────────────────────────────────────┘

  74 pure (no Docker, <3s)  │  6 Docker (~80s)  │  external varies by app
```


## The Endgame

```
  Chaos discovers bugs ──▶ Scenarios encoded ──▶ Self-test detects
         ▲                                              │
         │                                              ▼
         │                                     Improve loop fixes
         │                                              │
         └──── Verify hardens ◀─────────────────────────┘

  Each cycle:
    • Verify gets stricter (more scenarios, stronger gates)
    • Goals get harder (adversarial categories probe new assumptions)
    • The constraint store grows (K5 blocks more known-bad patterns)
    • Coverage gaps shrink (chaos plan steers toward under-tested gates)

  Stopping condition:
    When adversarial campaigns produce zero verify bugs
    for 5 consecutive sessions.
```
