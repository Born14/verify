# Verify GitHub Action

## What the Action does

It posts a **calibrated change receipt** on every pull request. The receipt is a single artifact -- a markdown PR comment, plus `.json` and `.md` files -- that records:

- which calibrated checks ran
- which fired and where
- which ran and were clear
- what was explicitly not checked
- a SHA-256 digest pinning the result to a specific commit

The receipt is the product. Everything else is supporting evidence.

## Install

Add `.github/workflows/verify.yml`:

```yaml
name: Verify
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  verify:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Born14/verify@v1
```

That is the entire setup. The default `GITHUB_TOKEN` is sufficient.

Optional input:

```yaml
      - uses: Born14/verify@v1
        with:
          scan-root: .   # default: repo root
```

## Surfaces inspected

| Surface | Files |
|---|---|
| Kubernetes | `*.yaml`, `*.yml` (excludes `.github/workflows/`, `examples/`, `tests/`, `fixtures/`, etc., and Helm-templated YAML) |
| Dockerfile | `Dockerfile`, `Dockerfile.<suffix>`, `Containerfile` |
| GitHub Actions | `.github/workflows/*.yml`, `.github/workflows/*.yaml` |

Not inspected: Terraform, CloudFormation, Helm chart templates, Pulumi, CDK, Kustomize overlays.

## Calibrated checks (Gate A)

Seven checks. Each row points at a calibration ledger entry that supports the published precision.

| # | Shape | Surface | Calibrated precision |
|---|---|---|---|
| 1 | `CONTAINER-ROOT-01` | Dockerfile | 85.71% on 23 (`iac-grafana-v1`) |
| 2 | `K8S-MISSING-LIMITS-01` | Kubernetes | 100.00% on 149 (`iac-argo-cd-v1`) |
| 3 | `K8S-MISSING-PROBES-01` | Kubernetes | 100.00% on 41 / 52.00% on 25 |
| 4 | `K8S-MISSING-SECURITY-CONTEXT-01` | Kubernetes | 100.00% on 14 (`iac-argo-cd-v1`) |
| 5 | `K8S-IMAGE-TAG-LATEST-01` | Kubernetes | 100.00% on 62 (`iac-argo-cd-v1`) |
| 6 | `GHA-SHA-PIN-01` | GitHub Actions | 75.00% on 20 / 69.44% on 37 |
| 7 | `DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01` | Dockerfile | 100.00% on 30 / 100.00% on 14 |

The supporting calibration evidence (rubric, classifier output, per-finding evidence) lives in the public ledger at `Born14/verify-engine` under `calibration/`.

## What the Action emits

Three files in `.verify/` under the workflow's working directory:

```
.verify/
  verify-receipt.json             machine-readable receipt
  verify-receipt.md               human-readable receipt
  verify-receipt.pr-comment.md    body posted as the PR comment
```

The Action posts the contents of `verify-receipt.pr-comment.md` to the PR. If a prior Verify comment exists, the Action replaces it.

## Sample PR comment

```
VERIFY CHANGE RECEIPT
Kubernetes / Dockerfile / GitHub Actions
----------------------------------------------------------------
scope:   K8s 2 / Dockerfile 1 / GHA 1
checks:  7 calibrated
result:  3 FINDINGS
digest:  sha256:bceed6d396217a7ef677e2701c7a657b0f3721bc73b2b77eba378c5c172e39cc
```

**Findings**

```
01. K8S-MISSING-LIMITS-01 [calibrated 100.0% on 149, iac-argo-cd-v1] -- k8s/api-deployment.yaml
02. GHA-SHA-PIN-01        [calibrated 75.0%  on 20,  gha-calcom-v1]  -- .github/workflows/deploy.yml
03. DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01 [calibrated 100.0% on 30, iac-grafana-v1] -- Dockerfile
```

**Checks with no findings**

```
- [CLEAR] CONTAINER-ROOT-01
- [CLEAR] K8S-MISSING-PROBES-01
- [CLEAR] K8S-MISSING-SECURITY-CONTEXT-01
- [CLEAR] K8S-IMAGE-TAG-LATEST-01
```

**Not checked**

> Terraform, CloudFormation, Helm-templated YAML, Kustomize overlays, runtime cloud state, business logic, intent, recall, uncalibrated shapes.

```
Receipt artifacts: verify-receipt.md, verify-receipt.json.
Digest: sha256:bceed6d396217a7ef677e2701c7a657b0f3721bc73b2b77eba378c5c172e39cc.
```

The `Not Checked` block ships in the receipt itself on every PR.

## Not Checked (full list)

- **surface:terraform** -- Terraform .tf files are not parsed.
- **surface:cloudformation** -- CloudFormation YAML/JSON templates are not parsed.
- **surface:helm-templated** -- Helm chart templates (`{{ ... }}` expressions) are skipped at detector level.
- **surface:kustomize-overlays** -- Kustomize strategic-merge patches and overlay resolution are not modeled.
- **state:runtime-cloud** -- Live cloud-account state (deployed IAM policies, running pods, attached security groups) is not consulted.
- **semantics:business-logic** -- Application correctness, business-rule integrity, user-facing behavior.
- **semantics:intent** -- Author intent (by-design vs. mistake) is not inferred.
- **completeness:recall** -- The receipt does not establish what verify missed. Calibration measures precision on pinned corpora, not recall on the inspected changeset.
- **completeness:uncalibrated-shapes** -- Shipped-but-uncalibrated detectors are excluded from receipts until calibrated.

## Reproducing a receipt locally

```
git clone <repo>
cd <repo>
git checkout <commit>
bun scripts/iac/change-receipt/cli.ts . \
  --out .verify \
  --repo owner/name \
  --pr 123 \
  --source-commit <sha>
```

Identical inputs (scan root, source commit, generated_at, engine commit) produce a byte-identical artifact.

## Versioning

The Action is published as `Born14/verify@v1`. The `v1` tag moves only when user-visible behavior changes. The receipt's `schema_version` field will increment if the JSON structure changes incompatibly.

## Status

Free during the design-partner phase. Terraform support is not currently in scope; the receipt's `Not Checked` block names that boundary explicitly until a Terraform check calibrates.
