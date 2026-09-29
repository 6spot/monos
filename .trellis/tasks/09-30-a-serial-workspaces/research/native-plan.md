# Native evidence plan and preparation

Existing installation only: `/root/monos-boundary-probe-src`, HTTPS port 18444,
`monos-probe-runner.service`. The old installation on 18443 remains independent.
Current status: deployment and the native first-open/restart stages have run.
See [verification](../verification.md) for exact build/deployment evidence and the
retained Stop recovery failure. The preparation notes below describe earlier
build-only snapshots; they are not the current installed-state claim.

Preparation update: a **build-only** 245-file source snapshot has now been staged
at the existing source root; running containers and installed Runner binaries
remain unchanged. `/root/monos-workspaces-build-v1/manifest.json` binds archive
SHA256 `ea9180516643760e192d718fdc8e89172d20ab42b7276370bedf27ccc7fc0621`.
This snapshot is for backend image/complete PostgreSQL validation; Runner's final
partial-pin recovery fix is still in progress and requires a later final snapshot.

Read-only preparation on 2026-09-30 confirmed the existing Runner is active and
GitHub returned positive public metadata for the already-authorized repository:

- `6spot/monolab-feasibility-20260928-160020-public`
- repository ID `1393178791`, `private=false`, default branch `main`
- HTTPS clone URL exactly matches the selected resource
- Host Git `2.47.3`, Docker Compose `v5.5.1`
- Existing native build image `golang:1.27.1-bookworm`; no host Go binary at
  `/usr/local/go/bin/go`, so use the established Linux build container.

This preliminary metadata read is not a workspace-open acceptance result. The
deployed provider exchange must independently verify it at actual open time.

## Test-owned admissions

`infra/probe/workspace-attempt.ts` calls existing initialization and selected queue
primitives inside a transaction with an actual Owner-configured Project. It
creates a test-owned immutable Specification/Plan/Node/activation without a legacy
resource grant. A fresh subsequent Attempt uses the same Node activation after
authenticated Owner Continue. This fixture is copied only into the test image.
It does not establish completion of the later product Start/planning leaf.

`workspace_probe.py` and its native driver cover first lazy public open, duplicate
request IDs sharing one operation, local cache read/write isolation, root
instructions, private commit and staged/dirty/untracked/ignored files. The first
Agent remains held while the existing Runner restarts, then Owner Stop must
checkpoint and physically settle it and its two known detached descendants.
Project defaults change to unavailable refs before the second Attempt: reopening
must still use the pinned target/base and preserve all files/index/HEAD. Completion
must bind the actual Git object tree, operation, Node completion and workspace
finalized pointer, with both leases released. The Project is archived afterwards.

`workspace_cancel_probe.py` uses a fresh Project/Task and intentionally unavailable
ref, observes a native admitted open in recovery, then admits Owner Stop. Only
the exact never-exposed open may become cancelled, linked to that Stop; both
physical ownership and lease release plus the scoped error receipt are required.
No native private App token evidence is claimed by either public trial.

Each script refuses reused evidence/admission identities and preserves exact
prepared intent before admission or restart. A failure requires inspection of
retained canonical/journal/physical state, not rerunning the same trial or erasing
its evidence. Poll bounds fail the test; they are not Runtime silence policy.

## Gate sequence

1. Finish implementation and independent review; local protocol/TS/Go/Python checks.
2. Stage complete source and hash manifest, build server/test images and fresh
   four-binary directory; run complete PostgreSQL and Linux Go race/vet tests.
3. Preserve installed hashes and confirm globally idle state; stop the existing
   Runner for reviewed bootstrap preflight/install, replace only task deployment,
   and verify migration/HTTPS/fresh Runner registration.
4. Run native trials in fresh private evidence directories, retaining any failures.
5. Independent evidence review, spec update, commit/archive/journal; proceed to
   Task Start/planning. Prior Capture/Discussion restart acceptance is retained
   and is not repeated as part of this leaf.

Steps 1–4 passed. Initial source v4/Runner v2 exposed a Stop export failure;
retain that evidence. Final complete source v5/Runner v4 fixed the explicit Git
fetch entry and missing reconnect recovery edge. The same Stop recovered without
changing root records. Explicit continuation passed reuse/completion without
repeating the trial's earlier stages; the separate cancellation trial also passed.
Step 5's final independent evidence review passed; commit/archive/journal follows.
