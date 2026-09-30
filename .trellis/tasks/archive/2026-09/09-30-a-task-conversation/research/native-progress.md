# Task Conversation native work log

## Preparation (no rollout yet)

Previous leaf is fully committed/archived/journaled:
`c5ce437` -> `44b4eb4` -> `a4a8baf` (Session 19).

Current task sources and tests are uncommitted and still under independent review.
The accepted host remains on migration18 and the previous Node source/binaries.
Do not rerun `/root/monos-node-deploy-v1/install.py` or reset its native trials.

Read-only host inspection confirmed the existing Node installer/manifest and the
available `golang:1.27.1-bookworm` test image. Host shell has no direct `go` binary;
use the existing Go container image for Linux module/race/vet/build, as before.

Prepared but **not executed** local deployment script:
`/tmp/monos-task-conversation-install-v1.py`. It derives from the accepted installer
with new immutable evidence roots, migration19, empty expected canonical pending
membership, Node/conversation/guidance idle checks and actual running-image binding.
Before using it, review the final table/status contracts and freeze verified source.
Its destinations are:

- `/root/monos-conversation-deploy-v1`
- `/root/monos-conversation-build-src-v1`
- `/root/monos-conversation-manifest-v1.json`
- `artifacts/conversation-v1` under the frozen build root

`before` and `install` each take exclusive evidence claims and must run once only.
No destination was created by this preparation. SSH master remains
`/tmp/monos-runtime-acceptance-ssh`. The private forwarded test DB URL remains in
`/tmp/monos-task-planning-db-url`; never print its content.

## Root-owned harness

`infra/probe/task_conversation_probe.py` reuses canonical Git Task creation and
explicit Start from the previous probe, then owns Task Conversation commands and
scoped receipt recovery. It collects all execution/conversation/guidance tables in
one PostgreSQL statement snapshot to avoid the prior torn-observer problem.

- `create_git(prefix)` and `start_git()` use actual Todo preview/Owner confirmation/
  Task Start; no fake Task or direct SQL state repair.
- `submit_task`, `submit_while_active`, `observe_turns` retain exact Owner requests,
  source/watermark and native immutable command bytes. The busy helper requires
  intermediate proof that message2 arrived while message1 remained current/live.
- `execution_unchanged` checks all non-conversation Attempts, initial/Node sources,
  Starts/effects and execution facts. Only the three documented raw-log projection
  fields are excluded from Attempt comparison.
- `handling_checks` checks v2 manifest digest, exact Node/source/Attempt/activation,
  source guidance content and successful per-obligation handling. It does not use
  launch or completion admission as successful handling evidence.
- `node_snapshot` additionally reads the native conversation-driver report.

`task_conversation_driver.py` is the Agent-invoked Stop/resume fixture. Initial
private-work creation still uses `workspace_driver.py`. The new driver accepts only
an exact same-Task/resource/prior-Attempt `held_for_stop` report, checks the entire
private HEAD/index/files and fixed lineage after reopen, and can hold again or
complete with explicit Agent-supplied guidance IDs. It is deliberately not the
post-completion/new-activation observer; finalization legitimately changes HEAD.

Root focused Python suite last ran **7 tests, passed**. No native Task Conversation
attempts, new service starts or rollout have occurred yet. Actual next native work
must wait for backend/reviewer gates; retain every failed observation verbatim.

## Frozen build, rollout and native continuation

See verification.md for the exact 293-file hash and complete PG254/22, TS263,
Python162 and cached Linux Go gates. Installation completed under deployment-v2;
v1 retains its raw-boolean preflight error and build network failure. The resumed
bootstrap retained and audited nine historical failed unit markers before clearing
them; no canonical records were reset.

Task `6462642a-b5f0-4590-a372-43b386ff2966` has passed pre-Start ordered/native
replies and scope/cutoff isolation. Guidance auto-fenced initial Node
`b1ab398b-9566-4bfe-ac4c-9af753ac629c`, released its private workspace and created
fresh same-activation successor `a9cff687-4a2f-4a74-815c-0cf49306cb78`.
That successor's harness command failed first on Agent quote transcription and
then runpy import path; it never opened the workspace. Its raw logs and
`guidance-harness-failed.json` remain. Root used exact Owner Stop and fixed only
the native Role's invocation, then explicit Continue created
`3cb6bf09-dd6b-4295-9e2e-be115e23d837`. This recovered Attempt proved identical
private HEAD/index/files and fixed lineage against the actual initial held report.
Do not describe this successful recovery as an automatic successor completing.

Owner Stop of the recovered Attempt retained its checkpoint and removed all
process descendants. Stopped reply changed no execution records; another guidance
remained pending with no automatic resume. Explicit Continue created the fourth
Node Attempt, whose complete_node handled both exact assigned guidance IDs and
produced a v2 manifest plus successful Git result. Independent review checked
native CLI envelopes/receipts, exact assignments, obligations and real file/tree
bytes. `guidance-final.json` and `guidance-final-git-object-verified.json` pass.

The first additional Git audit incorrectly expected final commit parent=public
base. This system retains the initial private commit; the correct assertions are
final parent=original private HEAD, and private HEAD parent=base. The initial
`guidance-final-git-object.json` failure is retained; corrected read-only audit
verifies both actual objects and the unchanged private tree. Product sources and
binaries remain the original frozen snapshot throughout.

Terminal Stop/Retry/queued Withdraw and service restart are now in progress.

## Final closure

Terminal Retry's original Attempt completed after the first observer deadline;
its late read-only observation passed without replacement execution. Both existing
services were restarted from idle. Canonical records/receipt maps and all12 original
Attempt physical identities were preserved, and all process trees remained absent.
Independent live re-audit confirmed idle, source/binary hashes, port18444 and the
unrelated monolab service. Final review: ACCEPT; see acceptance-review.md.
