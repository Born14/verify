# Verify

**Posts a PR change receipt showing what was checked, what was found, and what was not checked. Covers Kubernetes, Dockerfile, GitHub Actions, and one Terraform shape (warning-only).**

The receipt is the product. On every pull request, Verify writes a short artifact that names which checks ran, which fired and where, which ran and were clear, and what was deliberately not checked. Every check that runs carries a published precision number measured on a pinned third-party corpus under a pre-registered rubric.

## On every PR

A markdown PR comment plus three workflow artifacts:

```
.verify/
  verify-receipt.json             machine-readable receipt
  verify-receipt.md               human-readable receipt
  verify-receipt.pr-comment.md    body posted as the PR comment
```

The PR comment summarizes scope, findings, no-finding checks, an explicit Not-Checked block, and a SHA-256 digest. See [VERIFY-RECEIPT-SAMPLE.md](./docs/VERIFY-RECEIPT-SAMPLE.md) for the annotated full sample.

## Install

```yaml
# .github/workflows/verify.yml
name: Verify
on: pull_request
jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Born14/verify@v1
```

## Optional: fail CI on findings

By default the receipt is informational. To make the workflow fail when there are non-suppressed findings, add `fail-on-findings: true`:

```yaml
      - uses: Born14/verify@v1
        with:
          fail-on-findings: true
```

Suppressed findings (declared with an in-band `# verify:ignore <SHAPE-ID> reason:"..."` comment) do not trigger the failure. They are still recorded in the receipt and covered by the digest.

## Suppressing a finding intentionally

Sometimes a finding fires on something you've decided is correct (a dev cluster running an edge tag, an internal action you trust). Verify lets you declare that intent in-band, on the line where the finding fires:

```yaml
spec:
  containers:
    # verify:ignore K8S-MISSING-LIMITS-01 reason:"unbounded by design pending sizing review"
    - name: api
      image: ghcr.io/example/api:1.4.2
```

A suppression must:

- Use the exact syntax `# verify:ignore <SHAPE-ID> reason:"<text>"`
- Be on the same line as the trigger (trailing) or the line immediately above it
- Name a real shape ID (typos are reported as warnings)
- Provide a non-empty reason

Suppressions move the finding out of the primary findings list and into a separate "Manifest Intent / Suppressions" block on the receipt. They are part of the digest, so they cannot be silently removed without changing the receipt's hash. A reviewer reading the receipt sees both the suppression and the reason.

## What gets checked

Eight calibrated checks. Each links to a calibration ledger entry that supports the published precision.

| Shape | Surface | Calibrated precision | Risk family |
|---|---|---|---|
| `CONTAINER-ROOT-01` | Dockerfile | 85.71% / 23 | unsafe runtime |
| `K8S-MISSING-LIMITS-01` | Kubernetes | 100.00% / 149 | reliability |
| `K8S-MISSING-PROBES-01` | Kubernetes | 100.00% / 41 + 52.00% / 25 | reliability |
| `K8S-MISSING-SECURITY-CONTEXT-01` | Kubernetes | 100.00% / 14 | unsafe runtime |
| `K8S-IMAGE-TAG-LATEST-01` | Kubernetes | 100.00% / 62 | supply-chain drift |
| `GHA-SHA-PIN-01` | GitHub Actions | 75.00% / 20 + 69.44% / 37 | supply-chain drift |
| `DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01` | Dockerfile | 100.00% / 30 + 100.00% / 14 | supply-chain drift |
| `TF-SG-WORLD-OPEN-INGRESS-01` | Terraform | 100.00% / 32 (warning-only, strong-single-corpus) | public exposure |

The Terraform shape is the first calibrated Terraform row. It is narrow but real: one shape, warning-only, single-corpus, measured under the v1.1 same-module Terraform resolver. Not "Terraform solved" and not blocking-tier; future Terraform shapes ship when each one earns its own ledger row.

The supporting calibration ledger lives in this repo at [calibration/](./calibration/): every shape, every corpus, and every attempt that produced the precision numbers above.

## What is not checked

This list ships in the receipt itself on every PR. Excerpted here so it's visible before install:

- Most Terraform .tf surface area is not parsed; only the security-group ingress shape (`TF-SG-WORLD-OPEN-INGRESS-01`, warning-only) is calibrated under the v1.1 same-module resolver.
- CloudFormation templates are not parsed.
- Helm-templated YAML (`{{ ... }}` expressions) is skipped at detector level.
- Kustomize overlays are not resolved.
- Runtime cloud state (deployed IAM, running pods, attached security groups) is not consulted.
- Business logic, intent, recall, and uncalibrated detectors are out of scope.

## Reproducing a receipt

The receipt is byte-deterministic: identical inputs (scan root, source commit, generated-at timestamp, Action bundle version) produce a byte-identical artifact. The same commit run twice through the Action will produce the same digest. Re-running on a different machine against the same checkout will produce the same digest.

If you want a different digest, change one of those inputs. If you get a different digest from inputs you believe to be identical, that is a reproducibility bug — please open an issue.

## Status

Free to use. The first calibrated Terraform shape ships in v1.3 (warning-only, narrow but real); the rest of the Terraform surface remains uncovered, and the receipt's Not Checked block names that boundary explicitly until additional Terraform checks calibrate.

The public calibration ledger lives in this repo at [calibration/](./calibration/). It includes every shape Verify ships, every corpus those shapes were measured against, and every calibration attempt — the ones that promoted and the ones that did not.
