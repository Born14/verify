# Beyond Code: Verify as a Universal Agent Gate

Written March 20, 2026. The realization that verify's gates are domain-agnostic — only the predicates are domain-specific — and what that means for the product.

## The Insight

We built verify to gate AI-generated code edits. CSS predicates, HTML selectors, Docker staging, Playwright browser checks. But strip away the vocabulary and look at what the gates actually enforce:

| Gate | What it does (physics) | Code vocabulary | Universal vocabulary |
|------|----------------------|-----------------|---------------------|
| Grounding | "Does your target exist in reality?" | CSS selector exists in source | Slack channel exists, file path exists, email recipient exists |
| F9 | "Is your mutation well-formed?" | Search string found exactly once | Message not empty, file path valid, API payload schema-valid |
| K5 | "Has this pattern failed before?" | Predicate fingerprint banned | Any action fingerprint banned — same channel, same recipient, same folder |
| G5 | "Does every action trace to your goal?" | Edit traces to a predicate | File move traces to "organize docs," message traces to "notify team" |
| Filesystem | "Is the filesystem in the expected state?" | File exists at expected path | Config file created, temp file deleted, backup file unchanged |
| Invariants | "Is the system still healthy?" | Health endpoint returns 200 | Critical folders still exist, permissions unchanged, no data lost |
| Narrowing | "Here's why it failed and what to try next" | "Use .roster-link not .sidebar" | "Use #deployments not #engineering — that's where deploys go" |

**The gates are universal. The predicates are the plugin layer.**

Every new domain is just a new set of predicate types + a grounding function that reads reality for that domain.

## The Six User Classes

### Class 1: Code Agents (current)
Cursor, Aider, Claude Code, OpenHands, Windsurf, Codex, custom coding agents.
**Pain:** Agent writes plausible code that breaks unrelated things.
**Predicates today:** css, html, content, http, http_sequence, db.
**Status:** Shipped. v0.2.1 on npm.

### Class 2: No-Docker Developers (current, underserved)
Solo devs, frontend developers, laptop users without Docker.
**Pain:** Same as Class 1, but can't run staging/browser/HTTP gates.
**Predicates today:** Same types, but only Grounding + F9 + K5 + G5 + Narrowing run (5 pure gates, no Docker).
**Status:** Works today. Need better messaging that Docker is optional.

### Class 3: CI/Pre-commit Teams (current, underserved)
Teams adding verify to GitHub Actions, pre-commit hooks, merge gates.
**Pain:** AI-generated PRs merge without verification. Review burden on humans.
**Predicates today:** Same types via `git diff | verify check --diff`.
**Status:** Works today. Need the diff parser and CI examples.

### Class 4: Agent Builders / MCP Developers (current)
People building agent frameworks, MCP servers, tool chains.
**Pain:** Their agents have no verification layer. Users don't trust the output.
**Predicates today:** Library API — `verify(edits, predicates, config)`.
**Status:** Works today. MCP server mode ships with the package.

### Class 5: File System Agents (NEW — near-term)
Claude Desktop + filesystem MCP, local file organizers, document managers, backup agents.
**Pain:** Agent moves files to wrong places. Deletes things. Overwrites documents. No undo.
**New predicates needed:**
- `filesystem_exists` — file/directory exists at expected path after operation
- `filesystem_content` — file contains expected content (subsumes current `content` type)
- `filesystem_absent` — file does NOT exist at path (verifies deletion was correct)
- `filesystem_count` — directory contains expected number of files
- `filesystem_unchanged` — critical file was not modified (hash comparison)
**Grounding function:** `fs.readdirSync` / `fs.statSync` — reads what actually exists before the agent acts.
**Invariants:** Critical paths still exist. No files in unexpected locations. Permissions unchanged.
**Effort to build:** Small. `content` predicate already reads files. Extend with path existence, hash comparison, directory counting.

### Class 6: Communication Agents (NEW — medium-term)
Slack bots, email assistants, Telegram agents, Discord bots, Anthropic Channels.
**Pain:** Agent messages wrong channel. Sends to wrong person. Leaks sensitive info. No recall.
**New predicates needed:**
- `message_recipient` — correct channel/user/email address
- `message_content` — body contains expected content, does NOT contain banned content
- `message_scope` — number of recipients within expected bounds (1, not "all")
- `message_sensitivity` — no PII, no credentials, no internal links in external messages
- `api_call` — outbound API request matches expected endpoint + method + payload shape
**Grounding function:** Read channel list, contact list, org directory — what targets actually exist.
**Invariants:** No DMs sent outside goal scope. No messages to public channels with internal data.
**Effort to build:** Medium. Requires adapter pattern — verify doesn't call Slack directly, it validates the action description before the agent executes.

### Class 7: Data & Document Agents (NEW — medium-term)
Spreadsheet agents, PDF processors, database query agents, report generators.
**Pain:** Agent overwrites the wrong cells. Queries delete instead of select. Report has wrong numbers.
**New predicates needed:**
- `document_structure` — expected sections/headings exist in output document
- `spreadsheet_cell` — cell at position contains expected value/formula
- `query_readonly` — SQL query is SELECT only (no mutations)
- `query_scoped` — WHERE clause limits blast radius (not `DELETE FROM users`)
- `data_bounds` — numeric output within expected range (revenue isn't negative)
**Grounding function:** Read document structure, schema, cell ranges — what exists before the agent acts.
**Invariants:** Source data unchanged. Backup exists before mutation. Output row count within bounds.
**Effort to build:** Medium. DB predicate already exists. Extend to spreadsheets and document structure.

### Class 8: Infrastructure / DevOps Agents (NEW — longer-term)
Terraform agents, Kubernetes operators, cloud resource managers, CI/CD pipeline agents.
**Pain:** Agent provisions wrong instance size. Deletes production database. Modifies security groups.
**New predicates needed:**
- `resource_exists` — cloud resource present after operation
- `resource_config` — resource has expected configuration (instance type, region, etc.)
- `resource_absent` — resource correctly deleted (not orphaned)
- `security_unchanged` — security groups, IAM policies, firewall rules not modified unless explicitly in goal
- `cost_bounded` — estimated cost delta within approved budget
**Grounding function:** Cloud API reads — what resources exist, what state they're in.
**Invariants:** Production resources untouched unless explicitly targeted. DNS still resolves. Health checks pass.
**Effort to build:** Large. Requires cloud provider adapters. But the gate logic is identical.

### Class 9: Browser / Computer Use Agents (NEW — longer-term)
Anthropic computer use, OpenAI operator, browser automation agents, RPA replacements.
**Pain:** Agent clicks wrong button. Fills wrong form. Navigates to wrong page. Submits prematurely.
**New predicates needed:**
- `page_url` — browser is on expected URL after action
- `element_state` — form field contains expected value, checkbox is checked/unchecked
- `element_visible` — expected confirmation/error message appeared
- `no_navigation` — agent did not leave the expected page
- `no_submission` — form was not submitted (for preview/draft operations)
**Grounding function:** DOM snapshot — what elements exist, what state they're in.
**Invariants:** No unexpected tabs opened. No downloads initiated. No form submissions outside goal.
**Effort to build:** Large. Requires browser instrumentation. But Playwright is already a dependency.

## The Expansion Architecture

The key insight is that verify doesn't need to be rebuilt for each domain. It needs a **predicate plugin system** and a **domain adapter** pattern.

```
                    ┌─────────────────────────┐
                    │     verify() pipeline    │
                    │                         │
                    │  Grounding → F9 → K5 →  │
                    │  G5 → Staging → Browser →│
                    │  HTTP → Invariants →    │
                    │  Vision → Triangulation →│
                    │  Narrowing               │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   Predicate Registry    │
                    │                         │
                    │   Built-in:             │
                    │     css, html, content,  │
                    │     http, http_sequence, │
                    │     db                   │
                    │                         │
                    │   Plugins:              │
                    │     filesystem           │
                    │     message              │
                    │     document             │
                    │     infrastructure       │
                    │     browser_state        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │    Domain Adapters      │
                    │                         │
                    │  Each adapter provides: │
                    │    ground() — read      │
                    │      reality for this   │
                    │      domain             │
                    │    validate() — check   │
                    │      predicate against  │
                    │      actual state       │
                    │    fingerprint() — K5   │
                    │      identity for this  │
                    │      predicate type     │
                    └─────────────────────────┘
```

### What Changes Per Domain

| Component | Changes? | How |
|-----------|----------|-----|
| Gate sequence | No | Same 12 gates, same order |
| K5 constraint store | No | Fingerprints any predicate type |
| G5 containment | No | Attributes any mutation to any predicate |
| Narrowing | No | Returns hints for any failure type |
| Grounding | **Yes** | New `ground()` function per domain |
| Predicates | **Yes** | New predicate types per domain |
| Validation | **Yes** | New `validate()` per predicate type |
| Staging | Maybe | Some domains need a "dry run" equivalent |
| Scenarios | **Yes** | New test scenarios per domain |

### What Stays Universal

- **K5 learning** — fingerprint any action, ban any pattern, persist any constraint
- **G5 containment** — "does this action trace to the stated goal?" works for file moves, messages, API calls, anything
- **Narrowing** — "here's why it failed and what to try instead" works for any domain
- **Improve loop** — chaos engine generates goals, harness validates, loop fixes gates — domain-agnostic
- **Self-test** — scenario families extend to new predicate types
- **MCP surface** — `verify_ground`, `verify_submit` work for any domain with the right predicates

## Expansion Roadmap

### Phase 1: Filesystem Predicates ✅ BUILT (March 2026)
- Added `filesystem_exists`, `filesystem_absent`, `filesystem_unchanged`, `filesystem_count`
- Grounding: validates path existence, hash fields, count fields at grounding time
- Gate position: after G5 (containment), before Staging — the first post-edit verification gate on the pure (no-Docker) side
- G5 containment: filesystem predicates fully attributed (direct match on `file`/`path`)
- K5 fingerprinting: `count` and `hash` fields included in predicate fingerprints
- **Why this proves the thesis:** K5, G5, and Narrowing work unchanged for filesystem predicates. Only the predicates are domain-specific — the gates are universal.

### Phase 2: Communication Predicates (1-2 months)
- Add `message_recipient`, `message_content`, `message_scope`, `message_sensitivity`
- Grounding: adapter reads channel/contact list from Slack/email/Telegram API
- **Why second:** Highest stakes. Wrong message to wrong person is not recoverable. Anthropic Channels makes this urgent.

### Phase 3: Document/Data Predicates (2-3 months)
- Add `document_structure`, `spreadsheet_cell`, `query_readonly`, `query_scoped`, `data_bounds`
- Grounding: read document structure, schema, cell ranges
- **Why third:** Large user base (spreadsheet agents, SQL agents). Existing `db` predicate is a starting point.

### Phase 4: Infrastructure Predicates (3-6 months)
- Add `resource_exists`, `resource_config`, `security_unchanged`, `cost_bounded`
- Grounding: cloud API reads (Terraform state, K8s API, AWS/GCP/Azure)
- **Why fourth:** Highest complexity but also highest value per customer. Enterprise contracts.

### Phase 5: Browser State Predicates (6+ months)
- Add `page_url`, `element_state`, `element_visible`, `no_navigation`, `no_submission`
- Grounding: DOM snapshot via Playwright (already a dependency)
- **Why fifth:** Computer use agents are still early. Playwright foundation exists. Build when the market matures.

## The Adapter Interface

Each domain implements three functions:

```typescript
interface DomainAdapter {
  // Read reality — what exists right now in this domain?
  ground(config: AdapterConfig): Promise<GroundingContext>;

  // Validate a predicate — does reality match the expectation?
  validate(predicate: Predicate, context: GroundingContext): Promise<ValidationResult>;

  // Fingerprint — deterministic identity for K5 banning
  fingerprint(predicate: Predicate): string;
}
```

The pipeline calls these through the predicate registry. Adding a new domain = implementing these three functions + writing scenarios. The gates, K5, G5, narrowing, and improve loop work unchanged.

## The Market Sentence

**2025:** Agents write code fast.
**2026:** Agents touch everything — files, messages, documents, infrastructure, browsers.
**The gap:** No verification layer between "agent wants to" and "agent did."
**Verify:** The gate that learns. Works for code today. Works for everything tomorrow.

## What This Means for the Demo

Don't lead with CSS predicates. Lead with the universal story:

> Every agent acts without checking. Verify checks before every action.
> It catches mistakes. It remembers them. The same mistake never happens twice.
> Today: code. Tomorrow: files, messages, documents, infrastructure.
> The gates are universal. Only the predicates change.

Then show Demo A (no Docker, K5 learning) and Demo B (filesystem smoke test) side by side. Two domains, same pipeline, same K5 memory. That's the proof.

## What This Means for the Business

| Phase | TAM | Competitor landscape |
|-------|-----|---------------------|
| Code agents only | ~$2B (developer tools) | Linters, test runners, CI gates |
| + Filesystem/Communication | ~$15B (agent safety) | Almost nobody. CalypsoAI (acquired). Invariant (acquired). |
| + Document/Infrastructure | ~$50B+ (enterprise AI governance) | Snyk (post-Invariant). Large compliance vendors. |

You're not building a code verification tool. You're building the verification layer for the agent era. Code is just where you proved the architecture works.

## The Competitive Moat

The chaos engine + improve loop + K5 constraint store is the moat. Any competitor can build a gate sequence. Nobody else has:

1. A self-improving verification system that finds its own bugs
2. A constraint store that compounds learning across sessions
3. A chaos engine that systematically probes for new failure classes
4. Domain-agnostic gates that work for any predicate type

By the time a competitor builds gates for filesystem agents, your K5 store will have 500 constraints from real-world filesystem failures. They start from zero. You start from memory.

**The labs make agents smarter. You make agents trustworthy. Both are needed. Only one compounds.**
