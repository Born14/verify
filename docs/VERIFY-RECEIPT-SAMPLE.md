# Verify Calibrated Change Receipt -- annotated sample

A complete sample receipt from the demo fixture, with short annotations on each block. The receipt is what a reviewer sees on every pull request; this page exists so the format is legible before install.

Inputs that produced this receipt:

- repo: `verify-demo/change-receipt-fixture`
- pull request: `#1`
- source commit: `1111111111111111111111111111111111111111`
- generated_at: `2026-05-01T00:00:00.000Z`
- Action bundle: pinned (the bundle version contributes to the digest)

Identical inputs produce a byte-identical receipt. Re-running the same workflow against the same commit will produce the same digest.

---

## Block 1 -- top banner

```
================================================================
  VERIFY CHANGE RECEIPT
  Kubernetes / Dockerfile / GitHub Actions
----------------------------------------------------------------
  schema:              verify-receipt/v1
  repo:                verify-demo/change-receipt-fixture
  pull request:        #1
  source commit:       1111111111111111111111111111111111111111
  generated at:        2026-05-01T00:00:00.000Z
  scope:               K8s 2 / Dockerfile 1 / GHA 1
  checks calibrated:   7
  result:              3 FINDINGS
  digest:              sha256:bceed6d396217a7ef677e2701c7a657b0f3721bc73b2b77eba378c5c172e39cc
================================================================
```

What the reviewer sees:

- **schema** -- the receipt format version. Stable contract.
- **scope** -- per-surface file counts actually inspected.
- **checks calibrated** -- count of checks that ran. Each has a published precision number.
- **result** -- one-line summary. `CLEAR` or `N FINDINGS`.
- **digest** -- SHA-256 over the receipt content. Identical inputs produce identical digests.

## Block 2 -- CHECKS RUN

```
| # | Shape | Surface | Status | Calibrated precision | Ledger attempt(s) |
|---|---|---|---|---|---|
| 1 | CONTAINER-ROOT-01 | Dockerfile | CALIBRATED / WARNING | 85.71% on 23 (iac-grafana-v1) | container-root-01-v2-iac-grafana-v1-2026-04-28-ratified |
| 2 | K8S-MISSING-LIMITS-01 | Kubernetes | CALIBRATED / WARNING | 100.00% on 149 (iac-argo-cd-v1) | k8s-missing-limits-01-v1-iac-argo-cd-v1-2026-04-29 |
| 3 | K8S-MISSING-PROBES-01 | Kubernetes | CALIBRATED / WARNING | 100.00% on 41 (iac-argo-cd-v1); 52.00% on 25 (iac-k8s-manifests-v1) | k8s-missing-probes-01-v1-iac-argo-cd-v1-2026-04-29, k8s-missing-probes-01-v1-iac-k8s-manifests-v1-2026-04-29 |
| 4 | K8S-MISSING-SECURITY-CONTEXT-01 | Kubernetes | CALIBRATED / WARNING | 100.00% on 14 (iac-argo-cd-v1) | k8s-missing-security-context-01-v1-iac-argo-cd-v1-2026-04-29 |
| 5 | K8S-IMAGE-TAG-LATEST-01 | Kubernetes | CALIBRATED / WARNING | 100.00% on 62 (iac-argo-cd-v1) | k8s-image-tag-latest-01-v1-iac-argo-cd-v1-2026-04-29 |
| 6 | GHA-SHA-PIN-01 | GitHub Actions | CALIBRATED / WARNING | 75.00% on 20 (gha-calcom-v1); 69.44% on 37 (gha-triggerdev-v1) | gha-sha-pin-01-v2-gha-calcom-v1-2026-04-29, gha-sha-pin-01-v2-gha-triggerdev-v1-2026-04-29 |
| 7 | DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01 | Dockerfile | CALIBRATED / WARNING | 100.00% on 30 (iac-grafana-v1); 100.00% on 14 (iac-airflow-v1) | dockerfile-base-image-digest-unpinned-01-v1-iac-grafana-v1-2026-05-02, dockerfile-base-image-digest-unpinned-01-v1-iac-airflow-v1-2026-05-02 |
```

What the reviewer sees:

- **Calibrated precision** -- the published precision for each shape, on a real third-party corpus, under a pre-registered rubric. Two-corpus shapes cite both corpora.
- **Ledger attempt(s)** -- a direct pointer into the public calibration ledger. Open the row and you see the rubric, the classifier output, and the per-finding evidence.
- **Status** -- `CALIBRATED / WARNING` means the check has cleared the calibration bar and the receipt reports it as a warning-tier finding (not a blocking failure).

## Block 3 -- FINDINGS

```
### 01. K8S-MISSING-LIMITS-01 -- k8s/api-deployment.yaml

shape:    K8S-MISSING-LIMITS-01 [calibrated 100.00% on 149, iac-argo-cd-v1]
surface:  Kubernetes
file:     k8s/api-deployment.yaml
site:     kind=Deployment | resource_name=api | container_name=api | missing_shape=no_resources
evidence:
          doc_index: 0
          container_path: spec.template.spec.containers[0]
```

```
### 02. GHA-SHA-PIN-01 -- .github/workflows/deploy.yml

shape:    GHA-SHA-PIN-01 [calibrated 75.00% on 20, gha-calcom-v1]
surface:  GitHub Actions
file:     .github/workflows/deploy.yml
site:     workflow_name=deploy | job_name=deploy | action_ref=tj-actions/changed-files | action_ref_target=v44
evidence:
          step_index: 1
          uses_value: tj-actions/changed-files@v44
          ref_target_shape: tag
```

```
### 03. DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01 -- Dockerfile

shape:    DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01 [calibrated 100.00% on 30, iac-grafana-v1]
surface:  Dockerfile
file:     Dockerfile
site:     stage_index=0 | base_image_raw=node:20-alpine | image_repo=node | image_tag=20-alpine
evidence:
          per_from_exception_comment: false
          is_generated_file: false
          has_file_exception_directive: false
          feeds_later_stage: false
          runtime_stage_digest_pinned: false
          stage_count: 1
```

What the reviewer sees:

- **shape + precision tag** -- every finding carries the precision of the check that produced it.
- **site** -- the structural identity of the finding (kind + resource + container path for Kubernetes; workflow + job + step + action ref for GitHub Actions; stage index + image parts for Dockerfile).
- **evidence** -- the structural facts the detector emitted. No paraphrase, no LLM summary, no interpretation.

## Block 4 -- CHECKS WITH NO FINDINGS

```
- [CLEAR] CONTAINER-ROOT-01
- [CLEAR] K8S-MISSING-PROBES-01
- [CLEAR] K8S-MISSING-SECURITY-CONTEXT-01
- [CLEAR] K8S-IMAGE-TAG-LATEST-01
```

What the reviewer sees:

- Calibrated checks that ran on the changeset and found nothing.
- The block exists so a green receipt is a coverage receipt, not just an empty list.

## Block 5 -- NOT CHECKED

```
This receipt does NOT attest to the items below. They are outside calibrated coverage at v1.

- [NOT CHECKED] surface:terraform -- Terraform .tf files are not parsed.
- [NOT CHECKED] surface:cloudformation -- CloudFormation YAML/JSON templates are not parsed.
- [NOT CHECKED] surface:helm-templated -- Helm chart templates ({{ ... }} expressions) are skipped at detector level. Only files parseable as raw YAML are inspected.
- [NOT CHECKED] surface:kustomize-overlays -- Kustomize strategic-merge patches and overlay resolution are not modeled.
- [NOT CHECKED] state:runtime-cloud -- Live cloud-account state (deployed IAM policies, running pods, attached security groups) is not consulted.
- [NOT CHECKED] semantics:business-logic -- Application correctness, business-rule integrity, and user-facing behavior are not checked.
- [NOT CHECKED] semantics:intent -- Author intent (by-design vs. mistake) is not inferred.
- [NOT CHECKED] completeness:recall -- This receipt does not establish what verify missed. Calibration measures precision on pinned corpora, not recall on the inspected changeset.
- [NOT CHECKED] completeness:uncalibrated-shapes -- Shipped-but-uncalibrated detectors are excluded from change receipts until calibrated.
```

What the reviewer sees:

- The exact boundary of what the receipt attests to.
- Every entry is structural: a parser limitation, a deliberate scope decision, or a not-yet-calibrated shape.
- Recall is named explicitly. The receipt does not claim to catch everything; it claims that what it caught is what it says.

## Block 6 -- REPRODUCTION METADATA

```
schema_version:        verify-receipt/v1
verify_engine_commit:  0000000000000000000000000000000000000000
detector_versions:
  CONTAINER-ROOT-01                  v2
  K8S-MISSING-LIMITS-01              v1
  K8S-MISSING-PROBES-01              v1
  K8S-MISSING-SECURITY-CONTEXT-01    v1
  K8S-IMAGE-TAG-LATEST-01            v1
  GHA-SHA-PIN-01                     v2
  DOCKERFILE-BASE-IMAGE-DIGEST-UNPINNED-01 v1
packet_digest:         sha256:bceed6d396217a7ef677e2701c7a657b0f3721bc73b2b77eba378c5c172e39cc
```

What the reviewer sees:

- **verify_engine_commit** -- pins the exact version of the engine code that produced this receipt. If the engine changes, this commit changes, and the digest changes.
- **detector_versions** -- per-shape detector version. A v2 detector behaves differently from v1; the version is part of the digest so the receipt cannot silently shift behaviour.
- **packet_digest** -- SHA-256 over the receipt content. Identical inputs produce identical digests, byte-for-byte.

## Block 7 -- bottom banner

```
================================================================
  END OF RECEIPT
  digest: sha256:bceed6d396217a7ef677e2701c7a657b0f3721bc73b2b77eba378c5c172e39cc
================================================================
```

The digest appears at top and bottom so a screenshot of either edge of the receipt carries the verifiable hash.
