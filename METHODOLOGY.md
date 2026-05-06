# Verify methodology

How Verify makes its claims, and how you can check them.

## What Verify does

Verify reads the files changed by a pull request, runs a small set of structural checks against them, and posts a single receipt summarizing what it found. The receipt names:

- which checks ran,
- which fired and where,
- which ran and were clear,
- what was deliberately not checked, and
- a SHA-256 digest pinning the result to a specific commit.

The receipt is the product. Everything else is supporting evidence.

## Why deterministic

The checks are deterministic. Same files in, same receipt out, every time. No machine learning model in the check path, no random sampling, no "confidence score." When a check fires, the reason is a specific structural pattern in the file. You can read the detector source, trace the logic, and decide for yourself whether you agree.

That property is what allows the receipt to be useful in CI. Probabilistic tools produce different verdicts on different runs and engineers turn them off within a week. A deterministic receipt produces a verdict you can evaluate once and trust going forward.

## What "calibrated" means here

Every check Verify ships goes through the same pipeline before it lands in a receipt:

1. **A pre-registered rubric** is written before any measurement runs. It says exactly what the check should fire on, what counts as a true positive, what counts as a false positive, and what counts as ambiguous. Once measurement starts, the rubric does not move.
2. **A pinned third-party corpus** is selected. The corpus is a real open-source codebase frozen at a specific commit. Synthetic fixtures do not count.
3. **The detector runs** against the corpus and emits findings.
4. **Every finding is classified** against the rubric as true positive, false positive, or ambiguous.
5. **A precision number is computed:** true positives divided by (true positives + false positives).
6. **The attempt is recorded** in [calibration/attempts.jsonl](calibration/attempts.jsonl) — whether it promoted, whether it did not, and the reason.
7. **A check is promoted to "calibrated"** only if the precision clears a pre-set threshold on the corpus.

Recording the attempts that did not promote as prominently as successful ones is the discipline that makes the ledger trustworthy. Anyone can publish wins. Publishing the misses is what proves the bar is real.

## The promotion paths

A check can promote in one of three ways. Each is defined before measurement; none is invented after the fact.

- **Two-corpus standard.** The check clears the precision threshold on at least two independently-pinned corpora, with ambiguity below 50% on each. This is the default path; it shows the check generalizes.
- **Strong-single-corpus.** The check clears the threshold on one corpus with at least 30 findings and ambiguity below 40%. This path exists for shapes whose base rate is naturally low across most corpora — rejecting them outright would hide real signals.
- **Aggregate-rare-signal.** The check is summed across corpora with a tighter precision floor (95%) and a tighter ambiguity cap (25%). This path requires the rubric to declare aggregate evaluation in advance — it cannot be invoked after the data is in.

## The published ledger

Three files in this repo:

- [calibration/shapes.json](calibration/shapes.json) — every shape Verify ships, its current tier, its severity in the receipt.
- [calibration/corpora.json](calibration/corpora.json) — every corpus referenced by a calibration attempt, with the source repo and the pinned commit SHA.
- [calibration/attempts.jsonl](calibration/attempts.jsonl) — every calibration attempt: shape, corpus, precision, ambiguity, disposition, and the reason for the disposition.

Detector source and per-finding evidence stay private. The aggregate counts and dispositions are public so the receipt's claims are independently checkable from the ledger alone.

## Methodology vs. policy

The receipt represents the methodology. The CI behaviour represents your team's policy. These are deliberately decoupled.

A check's calibrated severity reflects what the calibration measurement supports. A check that has cleared the bar on one corpus but not two stays at warning severity until cross-corpus confirmation. The receipt's `status` reflects this honestly.

Whether your CI fails on a finding is a separate question, owned by your team. The Action's `fail-on-findings` input lets you opt into hard-stop enforcement. The receipt's severity claim does not move when you do; only the CI behaviour does. Severity belongs to the discipline. Enforcement belongs to you.

## Suppressions and intent

Verify does not infer author intent. Sometimes a finding fires on something the operator has decided is correct — a dev cluster running an edge tag, an internal action they trust. The receipt records that intent only when the operator declares it explicitly.

The mechanism is an in-band comment on the trigger line or the line immediately above it:

```
# verify:ignore <SHAPE-ID> reason:"<text>"
```

A suppression must declare a real shape ID and a non-empty reason. When a suppression is recognized:

- The finding moves out of the primary findings list and into the receipt's "Manifest Intent / Suppressions" block.
- The file path, shape ID, comment line, and verbatim reason are recorded.
- The suppression record is part of the receipt's SHA-256 packet digest.

The packet digest covering suppressions is the load-bearing property here. A suppression cannot be silently removed: doing so changes the digest. A reviewer reading two receipts can tell whether a suppression was added, removed, or modified between commits. The audit chain holds.

Comments that look like suppressions but don't match a fired finding (typo'd shape ID, comment placed where no detector fired) are recorded as suppression warnings rather than silently treated as no-ops. Silent failures are the enemy of auditable systems.

## Reproducing a receipt

The receipt is byte-deterministic. Identical inputs (scan root, source commit, generated-at timestamp, Action bundle version, including any in-band suppression comments) produce a byte-identical artifact.

```
git clone <repo> && cd <repo> && git checkout <commit>
bun scripts/iac/change-receipt/cli.ts . \
  --out .verify --repo owner/name --pr 123 --source-commit <sha>
```

If you get a different digest, the inputs differ — file an issue with what you changed.

## What Verify is not

- Not a security scanner. Verify does not check for secrets, vulnerabilities, or runtime cloud state.
- Not a code reviewer. Verify does not read application code or evaluate logic.
- Not a linter. Verify does not check style.
- Not a complete-coverage tool. Verify checks a small set of calibrated shapes and names everything else explicitly in the receipt's "Not checked" block.

The product is the receipt: a short, honest record of what Verify did and didn't do, pinned to a digest you can verify yourself.
