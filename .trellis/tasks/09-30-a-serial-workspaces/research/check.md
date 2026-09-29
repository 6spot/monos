# Serial workspace implementation review

2026-09-30. Independent source review of the backend, shared protocol, Runner and
native acceptance harness against the current PRD, design and package specs.
This report includes implementation review and the final public Stage A native
evidence review below. It does not establish live private-App access or product
Task Start/planning acceptance.

## Status and boundaries

The initial source pass found no unresolved product defect after F1–F4 below.
Native integration subsequently exposed export and reconnect-recovery gaps;
their follow-up review is recorded below. Both source repairs have now been
independently reviewed without remaining findings. The Runner owner reports the
final full race/vet/lint/typecheck gates passing. Both native trials and the exact
retained-Stop repair have now been independently checked and passed within this
leaf's public/test-owned-graph scope.
The real PostgreSQL contention follow-up passed its five targeted cases.
Deployed source/binary identity, physical settlement, public repository lineage,
two-account evidence, fresh-Attempt reuse/completion and unexposed cancellation
are documented in the final evidence review. No remaining acceptance finding was
identified. Root integration owns task-status, commit and archival actions.

This pass changed only this report. Earlier assigned harness corrections and
their checks are documented separately in `research/harness-review.md`. Product
changes were sent to their owning implementers. This reviewer performed no host
operations, deployment, commits or task-status changes.

## Findings and disposition

### F1 — Partial fetch recovery could change or lose admitted Git intent

If the base fetch succeeded but the target fetch failed, recovery previously
resolved the configured short ref again before consulting its retained base pin.
A deleted ref or newly ambiguous branch/tag could prevent recovery despite the
existing pin. A changed provider default could also replace the original target
branch because the service record was only persisted after both fetches.

**Resolved in reviewed source.** `host/workspace_git.go` now persists the first
base-ref, target-branch and provider identity with the descriptor digest before
fetching. An incomplete record retains that intent, and an existing operation
base pin is consulted before any short-ref lookup. A completed record replays its
retained metadata. Real Git regression tests cover failed target fetch followed
by changed provider default, branch/tag ambiguity, deleted base ref, and retained
base bytes. The Runner owner reports the full Go race and vet gates passing.

### F2 — Broken workspace storage could prevent physical Owner Stop

Workspace storage/lock preparation and durable fence persistence previously
preceded stopping the Agent. Missing storage identity or a failed marker write
could therefore leave an Agent running after the Owner had requested Stop.

**Resolved in reviewed source.** After manifest and exact effect-scope validation,
the canonical helper stops the Agent before writing the Stop marker or inspecting
workspace storage. Unknown/populated status cannot establish absence. A failed
fence write returns an error, attempts owned worker settlement, and retains the
operation and lease for recovery; it does not fabricate successful settlement.
Every subsequent open-worker launch also checks, under the helper lock, that the
Agent remains populated, preventing a delayed old helper from starting a writer
after a successful kill when the durable fence could not be written.

`TestStopKillsAgentBeforeMarkerAndStorageFailures` covers marker and missing
storage failures with no successful result. The source ordering and worker gate
were reviewed. These tests use injected process callbacks; actual Linux process
absence still belongs to native acceptance.

### F3 — A slow canonical effect could overwrite newer Start identity

Moving network/Git work outside the daemon lifecycle mutex enabled Stop and
Reconcile to progress, but terminal processing could save the Start snapshot
captured before the wait. A later reconciled PID/birth/cgroup or revoked phase
could be replaced by stale data.

**Resolved in reviewed source.** `daemon.recordEffectAbsence` takes the short
lifecycle lock for canonical workspace effects, rereads the latest Start,
validates dispatch identity, and changes only the phase while preserving revoked.
No network or host operation runs under this lock. A gated concurrent regression
test writes newer PID/birth/cgroup and tests both running and revoked phases while
the effect is suspended, then verifies the latest identity survives. The Runner
owner reports the full Go race and vet gates passing.

### F4 — Concurrent DB tests did not establish actual contention

The original parallel Promise calls could execute serially without showing any
database lock wait. That was insufficient evidence for admission/removal/default
races or both possible ordering winners.

**Resolved; source reviewed and owner-reported real DB gate passed.** The backend owner added
separate pools/backend PIDs, an explicit transaction barrier, and polling of
`pg_stat_activity.wait_event_type` plus `pg_blocking_pids`. Tests assert two
simultaneously waiting connections before releasing the barrier. Conflicting
commands must queue behind the first; two compatible open readers both wait on
the exclusive configuration barrier. Coverage includes distinct request IDs reusing one open operation,
resource removal before/after open admission, and default edits before/after
first-open descriptor capture. The winner-specific durable resource, workspace,
operation, receipt and descriptor assertions were reviewed. The backend owner's
targeted run passed all five cases in 14.27 seconds (seven unrelated cases skipped).
TypeScript, focused ESLint and diff whitespace checks also passed. These were
test-only changes; no product lock ordering was changed to satisfy the tests.

### Integrator finding — Initialized refresh failure needs Stop recovery

The root integrator identified that a failed refresh on a new lease of an already
initialized workspace must not be classified as cancellation of an unexposed
initial allocation. The resulting implementation and contract were reviewed.

Stop-only recovered open carries paired `recovered_by_stop_operation_id` and
`target_observation_lease_id` fields. Backend validation requires the admitted
same-lease Stop, a fenced Attempt, an existing materialized workspace and the
exact fixed descriptor/basis. The target source must be a released lease of the
same workspace with a real fresh target observation and matching target commit;
another recovered lease cannot manufacture freshness. Runner recovery chains
retain the original observation source, including Stop before local new-lease
intent. A genuinely fresh fetch clears recovery provenance. Stop still checkpoints
the preserved workspace and release requires physical settlement.

## Other reviewed contracts

- Configuration, Runner, Task/Attempt, workspace/lease and operation locks follow
  the existing backend ordering. Provider calls occur outside transactions and
  authorization/configuration are rechecked before returning access material.
- Stable Task/resource workspace identity is shared by TS/Go fixtures. First
  materialization fixes repository/provider/base/branch/storage/Runner lineage;
  later Project defaults cannot rewrite admitted descriptors or materialized
  basis. Lease admission, receipts and terminal effects are transactional.
- Migration 0016 adds deferred descriptor/Attempt/lease/workspace consistency,
  immutable lineage/operation fields and one-live-lease constraints. Completion's
  finalized revision, lease release and Node completion roll back together when
  any later guard fails.
- Cancellation is terminal only for a never-materialized open through its exact
  admitted Stop. Original command receipts project error, and the lease remains
  owned until Stop settles. Admitted/recovery predicates exclude both succeeded
  and cancelled operations across queue, runtime and Owner flows.
- Public access requires positive exact GitHub metadata. Configured App exchange
  requests one repository with contents/read and metadata/read, validates scope,
  identity and bounded expiry, and never retries a denial anonymously. Access is
  operation/digest/incarnation bound and remains available for fenced system
  reconciliation only while ownership is unresolved.
- Tokens exist only in transient backend/helper/worker input and service Git
  environment. Persisted results/errors do not retain provider response bodies or
  raw credential-bearing Git diagnostics. Actual private App access is not proven
  by synthetic exchange tests or a public-repository native trial.
- Service-owned cache and uncredentialed worktree clones use no hardlinks or
  alternates. Git uses scoped temporary configuration and fsync. Checkpoints use
  a temporary index and private commits while retaining Agent HEAD/index/dirty
  work; exported checkpoint/final objects remain local and no provider write is
  part of this leaf.
- Existing SQLite effects own immutable operation/result bytes; root workspace
  and operation JSON own physical stages and retained results; service fetch JSON
  owns pins and fetch intent. Recovery uses those explicit records, not cache HEAD
  or elapsed time as proof of writer absence. Root ready is treated as potential
  exposure, so lost acknowledgement cannot turn a successful open into cancellation.
- Canonical effects use separate coordination/writer locks and existing transient
  systemd workers. Backend release waits for prior effects and export settlement.
  This is not a hostile same-UID sandbox claim.
- Generated Go marshaling preserves an explicit empty `instruction_files: []`
  separately from absence; the generator owns the additional generated file.
- Legacy fixture authority requires explicit internal provenance. Historical
  receipt/result bytes remain readable; canonical Tasks cannot acquire fixture
  fallback or Planner inspection. Test-only Task/Plan/Node admission is explicitly
  within this leaf; product Start/planning belongs to the next leaf.

## Verification and evidence attribution

Executed directly by this reviewer in this implementation pass:

- `pnpm exec vitest run apps/server/test/github-workspace.test.ts packages/protocol/test/protocol.test.ts`:
  **2 files, 139 tests passed**.
- `pnpm protocol:check`: **passed**, generated protocol is current.
- Local `go version` could not run through the unconfigured mise Go shim on this
  Darwin host. No local Linux Go, real DB or native test pass is claimed here.

Earlier harness assignment: **129 Python tests passed**, including **39 workspace
and cancellation cases**, plus py_compile and diff whitespace checks. The root
subsequently updated shared cancellation predicates and independently repeated
the 129-test pass. See `research/harness-review.md` for exact scope and limits.

Attributed to the Runner owner's latest `research/runner.md`: full
`go test -race ./...`, `go vet ./...`, repository lint/typecheck, diff whitespace,
bootstrap shell syntax and embedded Python AST checks passed. These include the
F1–F3 regressions and Stop-recovery provenance tests.

The backend owner's report records the earlier 9/9 real PostgreSQL workspace
tests, focused protocol/provider/HTTP tests and local checks. The final F4 gate
used `MONOS_TEST_DATABASE=1 python3 /tmp/monos-todo-test-env.py pnpm exec vitest run apps/server/test/postgres-workspaces.test.ts --testNamePattern 'serializes different|observed lock queue' --testTimeout=30000`:
**5 passed, 7 skipped**, 14.27 seconds. The complete workspace file now defines
12 cases. Root integration owns the complete current regression and native gates.

## Native follow-up

Review retained native evidence only after execution: deployed source/binary
hashes and test provenance; one canonical Start with no fixture registration;
public GitHub repository ID/base-tree verification; real cache permission denial
and local-only rejected push; dirty/private work across an actual Runner restart;
two originally live escaped children and exact identity/absence after Stop;
checkpoint/final tree ancestry; fresh-Attempt reuse and completion; initial-open
missing-ref cancellation; final zero unresolved writers/leases/operations/outbox.
Harness source and synthetic report tests alone cannot satisfy these claims.

## Follow-up from the first native trial

### F5 — Cross-account linked-worktree export failed after checkpoint capture

The native v1 trial retained a real public first open and a live Runner restart,
then left the original Stop in recovery. Physical Agent and descendant Stop had
finished and root retained the correct checkpoint; the service result clone lacked
the private checkpoint object. Host Git 2.47.3 rejected fetch/upload-pack through
the cross-account linked-worktree entry despite the exact protected trust scopes.

**Repair reviewed and same-operation native recovery verified.**
`snapshot.go::exportFetchArgs` now fetches the explicit original private ref from
the known `common/worktrees/<worktree basename>` administrative directory. It
preserves the same exact worktree/administrative safe-directory scopes, existing
service-private export and final tree validation. No wildcard trust, new checkpoint,
new operation or lease reset is introduced. The daemon still requires export
success before reporting Stop success. The owner's real-Git regression proves the
initial clone lacks the checkpoint, then fetches twice and checks exact objects,
connectivity, no alternates and preserved source HEAD/index/files.

The Runner owner reports full Go race/vet, lint/typecheck and diff checks passing;
root additionally reports the export-fix Linux race/vet/build passing. The final
deployment includes this repair together with F6 below. The diagnostic's negative worktree and positive admin
source reads used real service UID 997/GID 986 on Git 2.47.3; diagnostic evidence is
retained at `/root/monos-workspaces-diagnostic-v1/export-source-sj9x3wyx/`.
See `research/runner.md` and the independent repair review in
`research/harness-review.md` for attribution and limits.

### F6 — Reconnect did not dispatch retained canonical recovery effects

Complete backend inventory includes operations in `recovery`, but ordinary outbox
delivery only repeats `admitted` operations. Start reconciliation alone therefore
cannot finish the retained Stop after a repair. The updated design adds one finite
pass through the existing bounded effect queue after full reconciliation and
connection readiness. It must use the exact original operation/descriptor/lease
and matching journal evidence, retain overflow, skip hard/missing-journal cases,
and introduce no timer, replacement IDs, fixture transition or backend state reset.

**Implementation reviewed; owner full verification and native recovery passed.**
Two additional race boundaries were
raised during independent pre-review and accepted by the root integrator:

- A queued key can still belong to a cancelled old-connection worker. The new
  connection must retain its candidate until that key releases, then reread the
  latest outcome and scope; duplicate occupancy is not proof of current recovery.
- An old worker can finish non-context-aware Git export after disconnect, persist
  success, and fail to send it. If backend inventory still says recovery, the
  current connection must be able to resend the immutable local terminal result
  without any Host call. Skipping physical execution must not discard result replay.

The final source review covers `daemon/recovery.go`, `daemon.go` queue/reconciliation
changes, `control/client.go` readiness callback and `daemon/recovery_test.go`.

- `Reconcile` rejects a partial inventory and completes existing Start reconciliation
  before collecting a recovery batch. Only canonical remote-recovery operations
  qualify. Remote terminal/admitted and fixture operations do not enter this pass.
- The result must exist in the local journal and match the original operation and
  Attempt. `BeginEffect` validates the immutable retained body, including descriptor
  and digest; both inventory dispatch and latest local Start pass effect-scope
  validation. The queued function repeats this check immediately before execution.
- Failure classification comes only from retained `OperationResult.FailureKind`.
  Hard outcomes are skipped. Under the root's explicit compatibility decision, an
  existing nonterminal failure with no classification is the older recoverable
  form; absence of a result remains insufficient. The design/spec now say so.
- `ConnectionReady` is invoked only after the Ready frame is sent and `c.ready`
  is set. It activates only the matching noncancelled connection batch. A late
  `context.AfterFunc` cancellation compares the batch pointer before clearing it,
  so it cannot erase a newer connection's inventory.
- `enqueueLocked` preserves the existing 64-job bound and common per-operation
  key. Failed admission due to fullness or an occupied key retains the candidate.
  Worker cleanup releases the key and drains pending work under `queueMu`, without
  recursively locking it. Actual effect work happens outside that lock and outside
  the lifecycle mutex for canonical workspaces. Existing host workspace locks
  still own physical settlement. Stop candidates are ordered before open fetches.
- Once queued, a candidate leaves this batch; another failed attempt is not added
  back by heartbeat or a timer. Disconnect clears only the memory batch and cancels
  its jobs, retaining canonical DB/journal facts for the next complete inventory.
- A local terminal result for remote recovery follows the existing cached-result
  branch, which resends the immutable result without physical work. Remote terminal
  outcomes need no such pass.

Reviewed tests include Ready-before-work refusal and same-snapshot finite retry;
typed and untyped retained failures; remote terminal/legacy/hard/missing-result
exclusions; partial inventory and changed request/lease/dispatch/reservation/result
scope; 70 candidates with exactly 64 active slots and six retained pending entries;
duplicate frames; old cancelled-key release followed by success/hard/recoverable
outcome recheck; late old cancellation; changed Start scope after preparation;
coexisting unexposed open and Stop; and real TLS/WebSocket ordering of Ready before
unchanged success/cancellation result replay with zero Host effects.

The owner reports final `go test -race ./...`, `go vet ./...`, `pnpm lint`,
`pnpm typecheck` and `git diff --check` all passing. The last test-only adjustments
were also reviewed: missing-journal exclusion, reliable gate cleanup, valid Stop
versus completion outcomes in the old-key cases, and successful completion with
Git evidence versus cancelled open in the TLS replay case. They preserve product
validation rather than weakening it to satisfy a fake supervisor.

This reviewer performed source/spec/test inspection and diff checks only for
this implementation follow-up, with no host mutation or product source edit. The
subsequent native evidence review below separately establishes that the original
Stop and lease settled using the retained checkpoint and service export.

## Final independent native evidence review

Both native trials passed, including the original Stop repaired through reconnect
and the explicit continuation under the same evidence directory. This reviewer
used read-only SSH, SQLite `mode=ro`, PostgreSQL SELECTs, filesystem hashing and
Git object/index reads with optional index locking disabled. No service restart,
trial rerun, provider request/write, canonical mutation or host file write was
performed during this review. Original failed evidence was retained.

### Reviewed source and installed artifacts

- `/root/monos-workspaces-manifest-v5.json` contains 248 file hashes. All 248 staged
  files and all 248 corresponding files in the reviewed local tree matched. The
  source tar's 248 members and Runner tar's 83 members matched those same source
  hashes without extraction or mutation.
- Source archive `/root/monos-workspaces-source-v5.tar` SHA256:
  `2a54b7bd925a8c8a5517250a9f984d7fbbdf0e2aa9e682ad69e002f7d1dad4fa`.
  Runner archive `/root/monos-workspaces-runner-v4.tar` SHA256:
  `e4edaf25e5380e1f5ef1b9835619a1510999e06d753db08b5d9596aa01ceef68`.
- All four installed executables matched
  `/root/monos-workspaces-build-v6/runner-result.json`. Its source archive digest
  matches the reviewed Runner archive. The build log records successful module
  verification and Linux race tests for every package; root's build invocation
  additionally records vet and all four builds succeeding.
- The repair replaced Runner executables. Before/after Runner registration retains
  backend `bbc72501-c042-497c-9644-802e06191ed9` and advances incarnation 31 to 32,
  with matching runtime-report incarnation and fresh ready/connected state. The
  original backend migration-16 image remained in use.

### Original open, live restart and repaired Stop

Evidence: `/root/monos-workspace-native-v1/` and
`/root/monos-workspaces-repair-v1/{before,after,settled-unit}.json`.

The public source proof binds repository ID `1393178791`, the authorized repository
name, `private=false`, base commit and the actual local base tree. The first native
driver ran as execution UID 1000; its read-only-cache, local-only rejected push,
exclusive write denial, uncredentialed environment/config and instruction checks
passed. The current cache is service UID 997/GID 986, mode 0750, and worktree origin
is the exact local cache path. Those permission facts corroborate the already
reviewed native negative checks; this reviewer did not repeat a push/write probe.

The retained live restart proves changed systemd invocation/activation time and
advanced Runner registration while the original native process/open result and
two separately identified live setsid/double-fork children stayed unchanged.
The later repair restart is recorded separately and is not counted as another
live-restart acceptance trial.

Original Stop `540d85fa-f866-4bcc-b44f-ba63eae4753a` now succeeds and releases lease
`21d248a5-b543-4b86-a6b1-f218d05c34f8` for the original first Attempt. The root
checkpoint is still `ef96da624b83b3b53284c75b81041f5be628073a`, tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`, with original private Agent HEAD
`dbfd87bd52b350ce4d587f31a19f22e95a41ab18` as its parent. A direct read as the
service account verifies those exact objects and `refs/monos/result` in the
service-private export. No new Stop, Start, checkpoint or fixture identity was
substituted to clear recovery.

All four saved pre-repair root records match their recorded hashes. The immutable
original open-operation, Stop-operation and launch-manifest files still match
those hashes after completion. The root repair report verifies the workspace
record was also unchanged at repair settlement; that record later advances
legitimately for the second lease/completion. The original process identity remains
retained, while current PID and cgroup observations show absence. Both originally
live child identities remain exactly retained and absent. The settled unit records
MainPID 0, empty ControlGroup and no processes.

### Explicit continuation and exact completion

All 12 original JSON files hashed by `resume-after-stop-intent.json` still match
their recorded bytes, including the failed recovery snapshot. The continuation
uses the original first Attempt, Stop request, lease and workspace. It records
`resumed-stopped.json` separately and executes only the remaining stages.

The first and second native driver fingerprints match exactly before completion:
private HEAD, index tree, tracked/staged/untracked/ignored file hashes and status
digest. The second Attempt receives the same workspace, storage identity, fixed
base and target branch under a fresh lease, despite deliberately changed Project
defaults. It completes exactly once through operation
`660f0d9a-b17b-4b6c-9090-c0766a132714`, producing commit
`44393a6d649619b7779586171393ceb310de6e1f` and tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`. Backend Node completion, operation result,
workspace finalized pointer and released second lease agree. The service export's
actual commit, tree, parent and result ref agree too.

The Task is `REVIEW`, with canonical Project identity and null fixture resource.
Completion intentionally stages/finalizes the private work; current worktree HEAD
and index now match the finalized commit/tree. The dirty/index preservation claim
applies through Stop and fresh-Attempt reopening, as shown by the two pre-completion
fingerprints; it does not incorrectly claim that finalization leaves HEAD/index
at their earlier values. The four private file contents, including ignored data,
still match their original hashes.

### Missing-ref cancellation

Evidence: `/root/monos-workspace-cancel-native-v1/`.

The originally live native Attempt admitted open
`4b535481-3e64-4092-b2e5-44f0a4400229` and received explicit recoverable
`ref_unavailable` for the configured nonexistent ref. The exact admitted Stop
`50c89726-1771-4e20-85e0-edbe17405954` succeeds; the original open becomes cancelled
by that Stop. Their descriptors and original lease
`907cd27d-1b1b-49c5-a2c2-528b3672faa7` agree, and the lease is released. The workspace
remains never materialized, with no invented base, checkpoint, finalized commit or
workspace grant. Both operation results contain only writer absence, and scoped
recovery of the original native request is an error. The retained original process
identity and current physical observations establish absence.

### Independent durable provenance and final state

For all three native Attempts, this review independently reread SQLite request
envelope bytes and backend receipt envelope bytes, recomputed both SHA256 values,
and compared their exact bytes, parsed commands and operation references with the
retained evidence. Each Attempt has exactly one Start and zero legacy-probe
registrations. All six current terminal operation rows match the evidence and
their current local journal results. Both Stop commands' original envelope bytes,
digests, immutable Owner receipts and operation IDs also match current DB state.

Current direct process/cgroup observations establish all three Attempts absent;
the first Attempt's two retained descendants remain absent. Both test Projects
are archived. A current independent DB read confirms all eight global counters
are zero: queued, unreleased, writable, unresolved operations, live leases,
pending outbox, pending Discussion outbox and unresolved Discussion sources.

The root's final read-only environment audit additionally passes its six checks:
unchanged backend and independent installation, preserved port 18444, source
identity, global idle, and the prior captured public Task remaining `PLANNING`
with one Specification and no Plan, Node or Attempt.

### Acceptance limits

The evidence accepts this leaf's public GitHub, two-account serial workspace and
native Tool Protocol behavior. It does not prove actual private GitHub App access;
scoped-token/error/non-persistence support has deterministic tests only. Task,
Plan and Node admission here uses the explicit test-only graph seam and is not
product Start/planning acceptance. No provider publication or hostile same-UID
sandbox claim is made. No remaining implementation or native acceptance finding
was identified within those boundaries.
