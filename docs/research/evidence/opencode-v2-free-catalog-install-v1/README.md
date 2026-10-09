# Runner-only installation completed

Status: **installed; final read-only audit passed at Ready incarnation 28**.
[final-audit-result.json](final-audit-result.json) is the successful verification
receipt for candidate `a93f3002ae0127098063bc08006a854af547d160`. The installer and
resume failures below remain failures; the final audit reconciles their observed
effects without another restart or binary replacement.

At that audit, Runner `delivery-fresh-runner-v1` was connected and Ready, with
incarnation/report 28, PID `972670`, birth ticks `85903119` and invocation
`ef43b5da1d5f4d4285907cb8792d6259`. OpenCode `2.0.20` was detected at
`/home/linuxbrew/.linuxbrew/bin/opencode`. All recorded ownership/work counts were
zero. This snapshot precedes the separately recorded free-model verification;
installation and version discovery alone do not establish model invocation,
provider quota, semantic completion or Stage A acceptance.

## Retained execution sequence

| Stage | Recorded outcome and effects | Evidence |
| --- | --- | --- |
| Installer v1 | Failed `historical_attempt_not_proven_absent` before stop or replacement. It incorrectly equated Attempt ID with the independently assigned dispatch ID. | [result.json](result.json), [failure-v1.json](failure-v1.json), [physical facts](failed-preflight-physical.json) |
| Installer v2 | Correctly bound units to canonical `attempts.dispatch_id`; stopped Runner and replaced all four binaries. Failed `canonical_fingerprints_changed` before start because the two polling-table hashes changed. | [result-v2.json](result-v2.json), [failure-v2.json](failure-v2.json), [post-replacement observation](post-replacement-observation.json) |
| Single resume | Verified the completed replacement and issued the one remaining Runner start. Reached Ready 28 and physical verification, then failed `journal_history_changed` when local events grew from 178 to 180. The resume did not pass. | [resume.py](resume.py), [resume-result.json](resume-result.json), [journal prefix observation](journal-prefix-observation.json) |
| Read-only audit v1 | Did not pass its initial canonical comparison after the two late events reached the backend. No service action occurred. | [post-start canonical observation](post-start-canonical-observation.json) |
| Read-only audit v2 | Passed exact event-prefix checks, original backup digest verification, retained identity/ownership checks and final physical/readiness checks. No service action occurred. | [final-audit.py](final-audit.py), [final-audit-result.json](final-audit-result.json) |

The original root-private install directories `monos-free-catalog-install-v1` and
`monos-free-catalog-install-v2`, the single `monos-free-catalog-resume-v1` directory,
and both read-only audit directories are retained under `/root`. These are
consumed evidence locations, not reusable execution recipes. No automatic retry,
rollback, backend stop, historical-unit reset or full installer replay occurred.

The [positional journal observation](post-start-journal-observation.json.gz) is useful
for table counts only: tied ordering makes its individual row comparisons invalid.
The [composite-key observation](journal-prefix-observation.json) and final audit
supersede that interpretation without deleting the earlier report.

## What the final audit establishes

- The four installed executables match the successful build's exact hashes.
  Backend/database container bindings, private files, Runner configuration,
  enrollment credential, storage identity and historical physical unit identities
  match the retained evidence. The old Runner PID/invocation was replaced by the
  single recorded start; boot and backend connection instance remain unchanged.
- All 178 original SQLite event rows are byte-identical by the composite key
  `(attempt, stream, seq)`. The saved old journal's event-row digest also matches
  the pinned original [before snapshot](before-v2.json). Other journal tables and
  the events schema match their original fingerprints.
- Exactly two acknowledged local `exited` events were appended, both on stream
  `runtime`, sequence `2`: Attempts `0470064c-b8ea-4e18-a4bb-b3baaa631637`
  and `d5706933-fe21-4781-a10f-4feb496bfade`. They retain the original boot/dispatch
  identities and contiguous stream/Attempt ordering, at order sequences 15 and 29.
  Their full bodies and digests match the corresponding backend runtime events.
- Excluding exactly those two new event keys from each of `runtime_events` and
  `attempt_log_entries` reproduces the original full-table count and hash. The
  original 178 backend rows are therefore retained, with exactly two additions.
- All other originally compared table fingerprints remain exact, except the
  explicitly limited complete Attempt and polling rows described below. Task A
  remains COMPLETED/control 14 and Task B CANCELLED/control 6. All 13 saved Attempt
  identity, dispatch, Task, state and process-ownership fields remain equal; all
  recorded work/ownership counts remain zero.
- From the pinned [post-replacement polling reference](post-replacement-polling.json)
  onward, every item field is retained except `next_poll_at`; every cooldown field
  is retained except `next_request_at`. This includes PR/publication evidence,
  cleanup state, poll progress, installation ID and cooldown reason `spacing`.

## Evidence limits and source explanation

**Original complete Attempt rows and original polling rows were saved only as
full hashes.** Their selected later snapshots cannot recover the old values of
unrecorded columns. The audit proves equality of the saved Attempt
identity/state/ownership projection and polling fields since the later full-row
reference; it cannot assert that every other historical Attempt or original
polling column remained equal. The final receipt retains both limitations.

The deployed backend's [event ingestion](../../../../apps/server/src/service.ts)
appends a new `runtime_events` row and its ordered `attempt_log_entries` row, then
updates `activity_at`, `log_visible_sequence` and, for `exited`, `exit_observed`.
That path explains why these late exit observations can change telemetry after
an Attempt has settled. It is consistent with the exact two appended events and
unchanged saved ownership/state facts; it does not reconstruct missing old
Attempt column values or turn the failed resume into a pass.

The [remote polling loop](../../../../apps/server/src/remote-preparation.ts) selects
due items without a terminal-Task filter and advances `next_poll_at` before
checking whether further work is needed. A completed accepted Task with a PR may
reserve provider spacing before the later accepted-delivery check skips actual
polling. [Reservation/release](../../../../apps/server/src/remote-preparation-state.ts)
updates `next_request_at` with reason `spacing`. This permits clock-only changes
while ownership remains settled, including the cancelled/closed and
completed/merged items in the retained reference. The absence of original full
rows still prevents proving that the earlier hash differences were clock-only.

## Exact release and retained bindings

[build-binding-v2.json](build-binding-v2.json) binds candidate
`a93f3002ae0127098063bc08006a854af547d160` to build receipt SHA-256
`d104602e4540b8b455433ff64af3c17b7cea4612a1a783f50cf610f8ceacd677`.
The release is `/root/monos-free-catalog-release-v2`, built from all 144 tracked
files under `runner` and `packages/protocol/generated/go`. Its archive SHA-256 is
`7609f28eedc018142c42c2c88f7c5b37add2f4dfaad53d0933e60bfb833afe04`.
The four binary hashes are recorded in the final receipt.

Backend source remains `acff7663209949929c11d7543eb6453e19cee6ea`, container
`cbb5b4213ff702cc6af5eb944bb8eeff2b0a686d3abd6d0a7e70b9b3fbf1dec7`, image
`sha256:17b4a92c74067892685fe2b126578a0132335d1610bf7c1f87ad66409e84b92c`.
No new backend image, migration, login, enrollment or model call is part of this
installation/audit evidence.

The corrected [installer](install.py), staged as
`/root/monos-free-catalog-install-v2.py`, has SHA-256
`71fe39ceeeb68dc8a802f1502e7b6468a83826ed4706fcb37bccd04284cd52a5`.
It pinned the original v1 failure SHA-256
`697f46a8378847330ea91a02da41647185592196741e6d96cd62b7e518538de4`.
The [resume helper](resume.py) has SHA-256
`d6c47f9eaa07d1df930372c0dfed0c4e3e00d26baa682c96cfd7a533776f63d5`
and binds the v2 failure, original before snapshot, original physical snapshot and
later polling reference. The selected primitive module and observer remain pinned
at `e4e29961f8fcd58ee4980140b278599f462785af855cccc078f1b29c7d190c73`
and `ce2f7381ef5628cf638b3dba36c67b91b12aa8b999c34431a07a8d6252437669`.
Their old broad installation/containment entrypoints were not invoked.

## Local review checks

Python heredoc harnesses parsed the actual scripts with `ast.parse` and exercised
their definitions without calling the host entrypoints. Checks covered actual
remote-operation SQL, token/dispatch binding, pre-stop Runner equality, retained
physical-unit fixtures, exact prior-failure claims, polling-field comparisons and
one-start-only resume paths. Invalid identities, changed formal history or changed
polling identity fields were rejected before service effects. The resume's local
checks passed 13 comparison cases and three mocked end-to-end paths; the valid
path issued one mocked start and the two changed-input paths issued none.

These local checks support the guards, while the retained root-run receipts above
establish the observed host outcomes and their limits. Failed receipts are not
relabelled or discarded. Documentation finalization checked local links and
whitespace only; it did not rerun installation, a model or the product suites.
