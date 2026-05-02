# CLAUDE.md — Born14/verify (public release)

Orientation for any Claude session that opens this repo. Read this before changing anything.

## What this repo is

This is the **public release** of the Verify GitHub Action. It is a product surface, not a development workspace.

Everything here is one of three things:

- The Action itself: [action.yml](action.yml) and the bundled runtime at [dist/action/index.cjs](dist/action/index.cjs).
- User-facing docs: [README.md](README.md), [METHODOLOGY.md](METHODOLOGY.md), [docs/GITHUB-ACTION-MVP.md](docs/GITHUB-ACTION-MVP.md), [docs/VERIFY-RECEIPT-SAMPLE.md](docs/VERIFY-RECEIPT-SAMPLE.md).
- The public calibration ledger: [calibration/shapes.json](calibration/shapes.json), [calibration/attempts.jsonl](calibration/attempts.jsonl), [calibration/corpora.json](calibration/corpora.json).

That is the entire surface. If something else is here, it is either build output or a leftover from a previous era and should be cleaned up rather than extended.

## What the Action does

It posts a calibrated change receipt on every pull request. The receipt names what was checked, what was found, what was clear, and what was explicitly not checked, and pins the result to a SHA-256 digest. Seven calibrated checks at the moment, covering Kubernetes manifests, Dockerfiles, and GitHub Actions workflows. The full list lives in [README.md](README.md) and ships in every receipt.

## Where the work happens

Development does not happen in this repo. The detectors, calibration corpora, rubrics, and experiments live in a separate private repo (`Born14/verify-engine`) on the operator's machine. When a new shape calibrates or the Action's behaviour changes, the flow is:

1. Build and test in the engine repo.
2. Rebuild the Action bundle there.
3. Copy the new bundle and the slim calibration files into this repo.
4. Update the README and the public ledger if user-visible behaviour changed.
5. Commit and push. Move the `v1` tag only after the new bundle has been smoke-tested on a real PR.

If a Claude session lands in this repo and is asked to write a detector, run a calibration, or add a feature: the right answer is to switch to the engine repo. This repo only receives finished, calibrated output.

## What you can safely do here

- Edit user-facing documentation (README, METHODOLOGY, the docs/ files) for clarity.
- Update copy in [action.yml](action.yml).
- Replace the Action bundle when the engine ships a new build.
- Refresh [calibration/](calibration/) when a new attempt ratifies in the engine.

## What you should not do here

- Add new detectors, gates, or runtime logic.
- Run calibration measurements.
- Restore or reintroduce files from earlier eras (DM-18 migration detector, 26-gate pipeline, harness, etc.). Those have moved out of this repo intentionally.
- Make claims in the README or `action.yml` that are not backed by a row in [calibration/attempts.jsonl](calibration/attempts.jsonl). Every precision number in user-facing copy must trace to a ledger row.

## Tone

Plain, specific, falsifiable. Match the existing copy. The product's promise is that every claim is checkable; the docs need to honour that. No marketing voice, no comparative jabs, no claims that go beyond what the ledger supports.
