# Native workspace harness review

Reviewed on 2026-09-30 by the assigned independent harness reviewer. Source
ownership was transferred by the root integrator before edits. No additional
agent, host operation, live provider request, service restart or commit was
performed by this reviewer.

## Scope and decision

Reviewed the canonical serial-workspace and missing-ref cancellation harnesses,
their local/native evidence boundaries, and the test-only admission script.
The admission script intentionally creates one test Plan/Node and then uses the
real Runtime scheduler. It does not establish product Start/planning acceptance.
Canonical admission keeps `tasks.resource_id` null, includes Project workspace
reservations and does not register legacy fixture provenance.

All concrete harness findings below are fixed and covered by local regressions.
The harness is ready for the root integrator's native trial after the product
implementation gates pass. This review is not a passing native-trial report or
an independent sign-off on the complete backend/Runner implementation.

## Findings resolved

| Finding | Correction and proof boundary |
| --- | --- |
| A negative push through `origin` could honor a provider push URL, URL rewrites, hooks or inherited Git settings. | Push names the literal local cache, permits only the file transport, disables hooks/helper/global/system settings and rejects local URL rewrites. Exact cache refs are read before/after through Git, including packed refs. A real local regression supplies a provider push URL but observes only the explicitly named local cache change; writable cache correctly fails the negative check. |
| Nonzero Git push alone did not prove filesystem write denial. | Require independent `os.access` facts and an actual exclusive file-create attempt that raises `PermissionError`. Other errors fail; an unexpectedly created marker is retained. The native two-account test is still required. |
| Settlement could accept missing/partial identity, integer booleans or an escaped main process. | Require valid retained PID/birth/boot/cgroup and exact Attempt dispatch. Only explicit absence without an identity race, or a fully identified reused retained PID, establishes main-process absence. An unchanged PID/birth/boot fails even after cgroup escape. Cgroup absence and descendant checks remain separate. |
| Detached child absence could be vacuously true. | Require two distinct, fully identified, live setsid/double-fork children in the original cgroup/boot before Stop. Compare their retained identities after Stop and require both absent. |
| Fresh persisted `ready` did not prove Runner restart/reconciliation. | Preserve systemd InvocationID, MainPID, monotonic activation time and DB connection facts. Require changed invocation/later activation, advanced incarnation, matching runtime-report incarnation, readiness, fresh heartbeat and unchanged backend. Preserve the same native process/open result/children. |
| Driver JSON and operation existence did not independently establish native Tool Protocol provenance. | Read SQLite envelope bytes and backend envelope bytes independently, recompute both SHA256 values and compare exact parsed commands. Bind request ID, Task, resource, operation kind/state/Attempt, descriptor digest, lease, Project reservation, Node and stable workspace. Require one Start and zero legacy registrations. Duplicate opens share their original descriptor/operation/result; completion requires its own native command. Duplicate evidence rows fail. |
| Nonempty checkpoint/final hashes did not establish Git object contents. | Read exact commit objects as execution user `me` with a fresh Git environment and replacement objects disabled. Check checkpoint tree and private HEAD parent; compare the exported final tree with the driver's expected tree. Existing DB checks bind completion result, finalized pointer, activation and released leases. |
| Supplied repository metadata could not independently exclude fixture Git contents. | First open performs fixed, unauthenticated, bounded GitHub GETs for the authorized public repository and its exact base commit. Require repository ID `1393178791`, `private=false`, exact repository name, metadata repository ID, exact commit SHA and equality between GitHub tree and actual local base tree. Redirects are rejected; errors retain the native snapshot and stop the trial. No live request was made during this local review. |
| Initial idle guard missed queued work and leases; final trial lacked combined settlement evidence. | Both harnesses save exact initial/final counts for queued, unreleased and writable Attempts, unsettled operations/leases, pending general/Discussion outbox and unresolved Discussion sources. All fields must be integer zero. Busy initial state prevents configuration/admission/restart. |
| Missing-ref cancellation lacked native request and direct-lease provenance. | Before/after snapshots bind the unavailable native open to the exact canonical Task/resource/Start/descriptor. Cancellation must reference the exact successful Stop, released original lease and never-materialized workspace. Neither result may expose workspace/Git success fields; scoped original receipt remains error. |
| Interrupted admission or restart could lose reviewable intent. | Preserve exclusive prepared/request/restart evidence before mutation. Tests inject evidence-write failure and lost response, asserting no action or one action respectively. Same evidence directory cannot admit again; exact Owner request recovery reads the original receipt without generating a replacement request. |

## Files

Modified during this review:

- `infra/probe/workspace_probe.py`
- `infra/probe/workspace_driver.py`
- `infra/probe/test_workspace_probe.py`
- `infra/probe/workspace_cancel_probe.py`
- `infra/probe/test_workspace_cancel_probe.py`
- This report.

Reviewed without modification: `workspace_cancel_driver.py`,
`workspace-attempt.ts`, inherited `probe.py` / `discussion_probe.py` / `driver.py`
helpers and relevant product contracts. Both manifests now include every directly
imported probe helper plus the admission script for source attribution.

## Checks executed

- `python3 -m unittest discover -s infra/probe -p 'test_*.py'`: **129/129 passed**,
  including **39 workspace/cancellation cases** (originally 20).
- `python3 -m py_compile` for all six assigned Python files: passed.
- `git diff --check`: passed.
- Actual temporary local Git repositories verify dirty/staged/untracked capture,
  ignored-file preservation, index preservation and local-only push behavior.
- Actual temporary SQLite storage verifies extraction and digest comparison of
  retained envelope bytes. API and service-interruption tests use mocks.

The suite intentionally emits failed-evidence JSON from negative tests; those
messages are expected assertions, not failed native trials.

## Native follow-up and limits

The root integrator must retain deployed source/binary hashes and run both native
trials on the authorized existing installation. Inspect all failed/uncertain
reports before changing IDs, resuming, replacing drivers or repeating a restart.
The public API proof may fail because of access/rate-limit/network conditions;
that preserves an incomplete trial, never a fixture fallback.

Required live evidence is the actual two-account cache denial, original native
request attribution, live Runner restart/reconciliation, Stop checkpoint and
whole-tree absence, second-Attempt dirty/private/index preservation, exact final
Git/DB lineage, missing-ref cancellation and final global idle reports.

Public GitHub access and deterministic token tests do not prove live private App
access. The cache/credential separation is not an adversarial same-UID sandbox.
No provider write is part of either trial; product Start/planning, later leaves
and delivery acceptance remain outside this harness's claims.

## Explicit continuation after recovered Stop

The root's native v1 trial retained passing first-open and live Runner-restart
evidence, then stopped in recovery after physical Agent/descendant absence. The
failed report remains part of the trial. The Runner owner owns the product fix;
this harness change does not reconcile operations or alter database state.

`workspace_probe.py --resume-after-stop` now provides one narrow continuation.
Use the original evidence directory and prefix, after the original Stop has
already succeeded and released its original lease. On the authorized host, with
the existing private login file path supplied through `MONOS_ACCEPTANCE_PASSWORD_FILE`:

```sh
python3 /root/monos-boundary-probe-src/infra/probe/workspace_probe.py \
  --source /root/monos-boundary-probe-src \
  --evidence /root/monos-workspace-native-v1 \
  --password-file "$MONOS_ACCEPTANCE_PASSWORD_FILE" \
  --resume-after-stop ws-native-v1
```

The root's existing Compose port override remains an invocation/deployment concern;
this change does not edit the Compose setup, services or login configuration.

Before any continuation, the script revalidates the original first-open/public
base Git proof, live restart intent/result, exact canonical prepared/started IDs,
native command/receipt/descriptor provenance and original Owner Stop admission.
It compares the retained Stop command with the independent database envelope
bytes and SHA256 plus immutable DB/API receipt. Current state must retain the
same open, dispatch, process identity, two now-absent children, sole workspace and
released original lease, with the exact successful Stop checkpoint and local Git
tree/parent. The Project must still match its original configuration, there must
be no later Owner action or Attempt, and global ownership must be idle.

Original helper/driver hashes must match the old manifest. Only the explicitly
updated workspace harness may differ. Every original JSON report, including
failure/recovery evidence, is hashed and retained byte-for-byte; a file changing
during validation fails. An exclusive `resume-after-stop-intent.json` records the
old evidence hashes, current harness hashes, recovered state, DB records and
checkpoint proof. `resumed-stopped.json` is new evidence, never an overwrite of
`stopped.json` or the original recovery report.

The original trial and continuation share the same `after_stop` implementation:
edit defaults, Continue the original Node, admit only its designated fresh second
Attempt, verify reused private/dirty/index state and completion, then archive the
Project and verify idle. The continuation never reruns the original Task creation,
Runner restart or Stop. Any previous continuation claim or later-stage intent
refuses another invocation, including after a lost response. A failed read-only
precondition creates no continuation claim and performs no product mutation.

Files changed for this follow-up: `workspace_probe.py`,
`test_workspace_probe.py`, and this report. Seven added regression tests contain
parameterized cases for missing/tampered history, changed Stop command/receipt
types or identities, unresolved/replaced operations and leases, live children,
duplicate Starts/Attempts/actions, changed Project, busy host, evidence mutation,
failed claim persistence, lost continuation response and second invocation. They
also verify old evidence bytes and hashes and no duplicate first-stage action.

Verification: full Python probe suite **136/136 passed**; the focused workspace
file contains **40 tests**. Python compilation and `git diff --check` passed.
This follow-up used read-only SSH to inspect retained evidence shapes. It did not
run the old trial, mutate host state, perform a live continuation, or claim that
the still-pending product repair/native acceptance passed.

### Independent review of the native Stop export repair

The Runner owner identified the native failure after checkpoint creation and
service-private clone: Git 2.47.3 rejected fetch/upload-pack through the other
account's linked-worktree `.git` indirection. The reviewed `snapshot.go` repair
fetches the exact checkpoint ref from the already-known administrative directory
`common/worktrees/<worktree basename>`. It retains the same exact worktree and
administrative `safe.directory` scopes in a temporary protected Git configuration;
it adds no wildcard trust, credentials, provider access or persistent global Git
settings. Export still validates the expected commit's tree and remains a gate
before the daemon reports successful Stop settlement. The existing operation and
lease are recovered, not replaced.

`TestCrossOwnerCheckpointFetchFromDetachedWorktree` uses real Git with
`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`, a detached private Agent commit and
staged/unstaged/untracked files. It first proves the checkpoint object is missing
from the initial bare clone, then imports the same checkpoint ref twice and checks
commit, tree, connectivity, absence of alternates and unchanged source
HEAD/index/files. The owner reports the targeted real-Git tests passing. This
review found no additional defect in the repair; the owner's complete Go gate and
actual original-operation native recovery remain separate evidence.
