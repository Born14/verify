# Verify Glossary

Plain-language definitions for the terms that matter.

---

### Gate
A checkpoint in the verification pipeline. Each gate checks one thing. If it fails, everything stops. There are 12, they always run in the same order. Think of them as a gauntlet your edit has to survive.

### Predicate
A claim about what should be true after your edit. "The h1 should be red." "The /health endpoint should return 200." You declare what success looks like, verify checks if reality agrees.

### Edit
A search-and-replace mutation. Find this string in this file, replace it with that. The atomic unit of change that verify gates.

### Fingerprint
A deterministic hash of a predicate's important fields. Two predicates that mean the same thing produce the same fingerprint. Used by K5 to remember what already failed.

### Constraint
A hard guardrail learned from a prior failure. "Don't try this predicate fingerprint again" or "Don't touch more than 2 files." Constraints shrink the search space so each retry is smarter, not wider.

### Narrowing
What you get back when verify says no. Includes: what went wrong, what's now banned, what to try next. The failure receipt that makes the next attempt better.

### Attestation
The human-readable verdict. "VERIFY PASSED — Gates: F9✓ K5✓ G5✓ Staging✓ Browser✓" or "VERIFY FAILED at K5 — predicate fingerprint is banned."

### Grounding
Reading the app's actual state before verifying anything. What CSS rules exist? What routes? What HTML elements? What DB tables? Prevents predicates that reference things that don't exist.

### Scenario
A self-test case. Edits + predicates + expected outcome. "Given these edits and these predicates, verify should pass/fail." The unit of knowledge in the harness.

### Family
A group of related scenarios. A tests fingerprints, B tests constraints, C tests gate sequencing, etc. 9 families (A through H, plus V), 80 scenarios total.

### Invariant
A rule that must always hold. Two kinds:
- **Product invariants**: "If verify says PASS, all gates actually passed." Properties of verify itself.
- **System invariants**: "The /health endpoint still responds after every deploy." Properties of the app that never change regardless of the goal.

### Oracle
The set of invariant checks that run after each scenario. The oracle decides if verify did the right thing. It's what makes the self-test a real test — not "did it run" but "did it judge correctly."

### Ledger
The append-only log of all self-test results. Every scenario run gets a line: what happened, which invariants passed, clean or dirty. The raw data the improve loop reads.

### Clean / Dirty
A scenario is **clean** if all its invariants passed. **Dirty** if any invariant failed — meaning verify has a bug. The improve loop only cares about dirty scenarios.

### Fault Ledger
The real-world version of the ledger. Records when verify was wrong against a live app (not a synthetic scenario). Auto-classifies: false positive, false negative, bad hint, correct, agent fault, ambiguous.

### Bounded Surface
The 10 files the improve loop is allowed to edit. All are **predicate gates** — they evaluate truth claims about reality. Two gate types are frozen:
- **Environment gates** (staging.ts) — Docker orchestration, not truth claims.
- **Constitutional gates** (invariants.ts) — defines what "healthy" means. Can't let the loop redefine success.

### Improve Loop
The self-hardening cycle. Run self-test → find dirty scenarios → diagnose the bug → generate fix candidates → validate in subprocess → check holdout → human reviews. Turns discovered bugs into permanent fixes.

### Holdout
30% of clean scenarios held back during fix validation. If a fix breaks a holdout scenario, it's rejected as overfitting. The loop can't cheat by only fixing the scenarios it saw.

### Triage
Deterministic mapping from invariant violation → target function + file. When confidence is "mechanical," no LLM needed. When "needs_llm," the diagnosis step kicks in. Zero tokens for the common case.

### Chaos Engine
Three MCP tools that autonomously stress-test verify. Plan → Run → Encode. Fires diverse goals through the pipeline, auto-records faults, converts bugs into permanent scenarios.

### Campaign
Targeted fault hunting against a real app. More surgical than chaos — you pick the goals. Every outcome feeds the fault ledger.

### K5
The constraint gate. Checks if this edit repeats a known-failed pattern. Named after the constraint store that powers it. The memory that makes agents converge instead of loop.

### F9
The syntax gate. Checks that every search string in your edits exists exactly once in its target file. If the string isn't there or appears twice, the edit is ambiguous.

### G5
The containment gate. Checks that every edit traces to a predicate — no sneaky unrelated changes. Attribution levels: direct (satisfies a predicate), scaffolding (enables one), unexplained (nothing justifies it).

### Triangulation
Three independent authorities vote on whether the edit worked:
1. **Deterministic** — file/HTTP/DB checks (causal truth)
2. **Browser** — Playwright getComputedStyle (rendered truth)
3. **Vision** — screenshot + AI model (perceptual truth)

Majority rules. Outlier is identified. Disagreement escalates to human.

### Vision Gate
Screenshot verification by an AI model. The caller brings their own model (Gemini, GPT, whatever). Verify sends the image + prompt, gets back pass/fail. One of three triangulation authorities.

### Pattern Recall
When a failure matches a known error signature, prior winning fixes are surfaced. "This looks like migration_timeout — last time, splitting the migration worked." Memory that compounds.

### Failure Signature
A regex-extracted error class. 21 signatures: syntax_error, port_conflict, migration_timeout, edit_not_applicable, etc. Deterministic — no LLM needed to classify what went wrong.

### Action Class
How the edit strategy went wrong. rewrite_page (too aggressive), global_replace (too broad), schema_migration (wrong domain), unrelated_edit (off-topic). Used by K5 to ban strategies, not just specific edits.

### Failure Kind
Who was wrong:
- **app_failure** — the agent's code was bad. Learn from it.
- **harness_fault** — infrastructure hiccup (DNS, Docker, SSH). Don't learn from it.
- **unknown** — can't tell. Don't seed constraints.

### Grounding Miss
A predicate references something that doesn't exist in reality. CSS selector `.nonexistent` when the app has no such class. Hard-rejected at the grounding gate for CSS/DB predicates. Soft-rejected for HTML (might be creating a new element).
