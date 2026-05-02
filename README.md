# Verify

**Posts a PR change receipt showing what was checked, what was found, and what was not checked. Covers Kubernetes, Dockerfile, and GitHub Actions.**

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

## What gets checked (Gate A)

Seven calibrated checks. Each links to a calibration ledger entry that supports the published precision.

| Shape | Surface | Calibrated precision | Risk family |
|---|---|---|---|
| `CONTAINER-ROOT-01` | Dockerfile | 85.71% / 23 | unsafe runtime |
| `K8S-MISSING-LIMITS-01` | Kubernetes | 100.00% / 149 | reliability |
| `K8S-MISSING-PROBES-01` | Kubernetes | 100.00% / 41 + 52.00% / 25 | reliability |
| `K8S-MISSING-SECURITY-CONTEXT-01` | Kubernetes | 100.00% / 14 | unsafe runtime |
| `K8S-IMAGE-TAG-LATEST-01` | Kubernetes | 100.00% / 62 | supply-chain drift |
| `GHA-SHA-PIN-01` | GitHub Actions | 75.00% / 20 + 69.44% / 37 | supply-chain drift |
| `DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01` | Dockerfile | 100.00% / 30 + 100.00% / 14 | supply-chain drift |

The supporting calibration ledger lives in this repo at [calibration/](./calibration/): every shape, every corpus, and every attempt that produced the precision numbers above.

## What is not checked

This list ships in the receipt itself on every PR. Excerpted here so it's visible before install:

- Terraform .tf files are not parsed.
- CloudFormation templates are not parsed.
- Helm-templated YAML (`{{ ... }}` expressions) is skipped at detector level.
- Kustomize overlays are not resolved.
- Runtime cloud state (deployed IAM, running pods, attached security groups) is not consulted.
- Business logic, intent, recall, and uncalibrated detectors are out of scope.

## Reproducing a receipt

The receipt is byte-deterministic: identical inputs (scan root, source commit, generated-at timestamp, Action bundle version) produce a byte-identical artifact. The same commit run twice through the Action will produce the same digest. Re-running on a different machine against the same checkout will produce the same digest.

If you want a different digest, change one of those inputs. If you get a different digest from inputs you believe to be identical, that is a reproducibility bug — please open an issue.

## Status

Free to use. Terraform support is paused on public-corpus availability; the receipt's Not Checked block names that boundary explicitly until a Terraform check calibrates.

The public calibration ledger lives in this repo at [calibration/](./calibration/). It includes every shape Verify ships, every corpus those shapes were measured against, and every calibration attempt — the ones that promoted and the ones that did not.
