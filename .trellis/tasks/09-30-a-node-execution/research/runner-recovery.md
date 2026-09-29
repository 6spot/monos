# Research: Runner completion recovery and repository-free completion

- Query: Define the smallest trusted same-operation retry and failed-completion settlement that permits a fresh same-Node correction Attempt, while preserving physical ownership, partial Git results, dirty work and immutable receipts; identify the no-workspace completion changes.
- Scope: internal. Read-only source research; this file is the only mutation.
- Date: 2026-09-30
- Planning target: `.trellis/tasks/09-30-a-node-execution`; parent supplied this path. No current-task pointer was consulted. Native acceptance/deployment remain parent-owned.

## Findings

### Recommendation

Implement two separate Owner decisions: retry capture using the **same** completion operation, or settle the failed completion for correction using a **new, narrowly scoped trusted operation**. Suggested wire kind: `settle_completion`. It may be admitted by exact Owner Node Retry with correction disposition, and by bounded pre-delivery Task Cancel. It is not an Agent command and never grants the terminal Attempt mutation authority.

The new operation reconciles the original completion first. If the original result already finalized, preserve and settle that success; do not rewrite it as cancellation. If it did not finalize, persist a recovery checkpoint, retain all prior intent/ref/object evidence, fence future replay of the original operation, and only then settle the original completion as cancelled. A fresh Attempt can begin after the whole pair and prior physical ownership settle. Same Node and activation survive; Rework is a separate future scope.

**A plain Stop is insufficient.** `checkpoint()` itself enforces ancestry (`runner/internal/host/workspace_git.go:444`). Broken ancestry therefore requires a distinct recovery-capture mode that records the current readable HEAD/tree without certifying it as a valid finalized revision. Normal Stop and completion ancestry rules remain strict.

### Files found and related specs

| File | Relevant responsibility |
| --- | --- |
| `docs/04-workspace-and-git.md:138` | Completion is physical finalization before Node success. |
| `docs/04-workspace-and-git.md:161` | Broken ancestry/hard capture preserves work, blocks, then reconciles partial operations before capture retry or fresh correction. |
| `docs/08-principles-and-non-goals.md` | Tool Protocol authority; Node is not Attempt; logical fencing is not physical isolation. |
| `.trellis/spec/runner/workspace-guidelines.md` | Root/service/execution authorities, exact refs, two-account export, immutable leases, finite reconnect recovery. |
| `.trellis/spec/runner/execution-guidelines.md` | Dispatch source, CLI scope, journal recovery, no fabricated process restart. |
| `.trellis/spec/backend/workspaces.md` | Lazy open, exact descriptor/lease and attributed Stop recovery. |
| `.trellis/spec/protocol/index.md` | Schema authority generates TS/Go; shared fixtures required. |
| `runner/internal/daemon/daemon.go:291` | Effect delivery, terminal-result replay, helper invocation, export, journal/result send. |
| `runner/internal/daemon/recovery.go:22` | Retained recoverable replay; hard failures excluded from automatic reconnect. |
| `runner/internal/journal/journal.go:193` | Immutable effect identity; mutable state is intentionally excluded. |
| `runner/internal/host/finalize.go:46` | Frozen finalization intent, private operation ref, HEAD compare-and-swap. |
| `runner/internal/host/workspace_effect.go:43` | Stop/reconcile exact operation unit, cgroup and pending launch. |
| `runner/internal/host/workspace_effect.go:102` | Coordinator ownership and Stop preemption. |
| `runner/internal/host/workspace_effect.go:668` | Canonical completion retains/replays local success and releases root workspace record only on success. |
| `runner/internal/host/workspace_git.go:386` | A retained private checkpoint permits reopening interrupted work without resetting HEAD. |
| `runner/internal/host/workspace_git.go:429` | Current checkpoint uses a temporary index, pins a private commit, but still requires ancestry. |
| `runner/internal/host/helper_effect.go:155` | Root operation identity equality; must include any new target fields. |
| `runner/internal/host/effect_scope.go:12` | Canonical versus Planner/Todo/legacy effect validation. |
| `runner/internal/host/snapshot.go:105` | Service export verifies exact checkpoint/finalized commit and tree. |
| `apps/server/src/workspaces.ts:109` | Completion admission currently requires a live opened workspace. |
| `apps/server/src/workspaces.ts:123` | Scope, lease, cancellation and Git settlement guards. |
| `apps/server/src/service.ts:436` | Authenticated result application and Node completion projection. |
| `apps/server/src/owner-execution.ts:121` | Current Retry refuses unsettled effects/leases and requires physical release. |
| `apps/server/src/fixtures.ts:85` | Test-only operation retry; not a product Owner API. |
| `packages/db/migrations/0016_serial_workspaces.sql:75` | Immutable operation and lease identity; completion settlement relation needs explicit extension. |
| `packages/protocol/schemas/v1/contracts.json:847` | Current Operation allows resource omission only for Stop. |
| `packages/protocol/schemas/v1/contracts.json:1072` | OperationResult cancellation currently represents only no-workspace-result cancellation. |

The earlier `research/backend-seams.md` supplies scheduling/Artifact design and broader integration tests. This document refines its unresolved hard-finalization branch.

### Same-operation Owner retry after infrastructure repair

`Daemon.effect()` calls `BeginEffect` and only short-circuits a retained success or cancellation (`daemon.go:292-300`). A retained failure can execute again through ordinary admitted delivery. `BeginEffect` compares Attempt/Dispatch/kind/resource/request/schema/workspace/digest, not Operation state (`journal.go:215`). `FinishEffect` allows changing a failure but rejects replacing any terminal success/cancellation (`journal.go:285`).

An authenticated Owner retry can therefore re-admit **the existing operation** under exact Task/Node/activation/source/control guards. Keep request, descriptor, frozen completion manifest and operation ID unchanged. Record the new Owner decision separately, increment control version, and wake its existing outbox delivery. Do not forge a new Agent command or reset its mutation token. Preserve factual failure history in a decision/event record before current failure state changes.

Reject a retry once a settlement operation is admitted, once the original is terminal, after incompatible Node activation/basis change, or after Task Cancel disallows this purpose. A saved Cancel may still require physical reconciliation of that original operation, but that is cleanup authority, not a new Owner capture retry.

Automatic reconnect remains bounded and excludes hard failures (`recovery.go:32`). An explicitly re-admitted operation goes through the ordinary effect path; it does not need a generic new retry-grant wire. Do not change the automatic filter to rerun hard failures indefinitely. Original local terminal success can replay with zero Host calls.

### Exact new settlement operation

Suggested immutable shape, in addition to ordinary Operation fields:

```ts
kind: "settle_completion"
completion_operation_id: Id
completion_identity_digest: SHA256
workspace: OriginalWorkspaceDescriptor
workspace_digest: OriginalWorkspaceDigest
```

For this leaf require an initialized canonical workspace and an original workspace-backed `complete_node`. Source identity comes from the retained canonical Node Dispatch. The target digest should be over an explicitly documented immutable projection of the original operation, excluding state/result/cancellation fields. Include schema, operation/Attempt/Dispatch/request IDs, kind, resource, workspace/digest and any immutable completion-manifest digest added by this task. Never digest the current mutable transport object.

Owner API disposition (`correct` versus `cancel_task`) belongs in the immutable backend decision/source record; the physical operation can perform the same bounded settlement. If transported, it is also immutable and part of every equality/digest guard. Do not accept arbitrary paths, arbitrary target kinds, another Attempt, another workspace, or arbitrary reset/rebase instructions.

Require a unique settlement relation per original completion and exact same Attempt, Dispatch, workspace, lease, generation, Node and activation. Keep `workspace_leases.settle_operation_id` pointing to the **original completion**. Migration 16 expressly forbids changing it (`0016_serial_workspaces.sql:119`), and simply replacing it would make the original result invalid. Add a dedicated immutable completion-settlement relation or guarded write-once pointer instead; terminal lease release is authorized through this relation.

Update Operation kind checks, cancellation state checks, ownership triggers and transport serialization. Add target fields to SQLite `BeginEffect`, root `sameOperation`, inventory conflict checks and any fixture equality tests. State changes and retries cannot substitute a different target.

### Physical algorithm and durable order

1. Validate canonical Node Dispatch, original operation identity, root workspace record, storage incarnation and descriptor/digest. Preserve unresolved/missing identity as recovery; no guessing from Agent-writable files.
2. Fence the original operation locally with a root-owned settlement-intent marker binding both operations. Stop the old Agent and all exact lease operation workers; verify unit ownership, empty cgroups, and no delayed launch jobs. Obtain the workspace coordinator and writer lock; revalidate identities and marker after lock acquisition.
3. Reconcile original finalization evidence before deciding cancellation. Root-retained success wins. A partial Git result that can be finished from the exact frozen intent and expected HEAD is completed under the original identity first. Reconstruct only from validated original evidence, not from a convenient current tree.
4. For an unfinalized failed completion, use an explicit recovery-checkpoint stage. Preserve current HEAD, actual index and files; create the capture tree with a temporary index as current `checkpoint()` does. The recovery mode does **not** require HEAD to descend from the fixed finalized base. Persist HEAD/tree/date/target-operation and any retained-intent digest in an immutable recovery intent, create/pin a private capture commit, and fsync the record/ref/object path.
5. Retain original finalization intent bytes unchanged, including malformed/truncated bytes; retain operation refs, commits and any partial service export. An invalid old intent is history, never an instruction to overwrite it or a barrier to capturing an otherwise readable Git tree. A new recovery intent is under the settlement ID.
6. Record the original completion's cancellation tombstone and settlement result durably before releasing root ownership. On replay the original returns its terminal cancellation, never calls `finalize()` again. A delayed original worker must reject the settlement marker after acquiring the writer lock, including between intent admission and final cancellation. The settling operation itself remains allowed to perform its bounded reconciliation stage.
7. Export the captured exact ref/tree to service-owned storage using the existing two-account path. **Only after successful export** may the daemon report cancellation and successful settlement to the backend. Root may have locally released its lease before export succeeds, as existing Stop does, but backend retains the claim until trusted settlement arrives.
8. Backend applies both operations atomically (recommended below), releases the lease and Attempt claim, and records final outcome. Correction prepares/promotes a fresh source only if the old completion was cancelled and the current Node/activation/basis still authorize it. Task Cancel performs cleanup without restoring execution.

Use `acquireStoppingWorkspace` behavior for the new operation (`workspace_effect.go:110`), not a passive coordinator wait that lets an old network/system worker prevent settlement forever. Existing `WorkspaceWorker` rechecks descriptor after acquiring writer lock (`workspace_git.go:515`), but only open currently checks the Stop marker; completion must also check its new settlement marker before mutation. Do not broaden the Stop marker into an unscoped override.

Root markers must remain root-owned and be validated as such. `saveRecord()` uses temporary file + file sync + rename + directory sync (`helper.go:170`). No disappearance/timestamp/lock timeout substitutes for successful physical settlement.

### Partial finalization and success races

`finalize()` freezes Base/Parent/Tree/Date before `commit-tree` (`finalize.go:80-117`), pins `refs/monos/operations/<id>` (`:126`), then updates HEAD by compare-and-swap against the frozen parent (`:134`). These steps distinguish the following cases:

| Evidence under exclusive ownership | Required disposition |
| --- | --- |
| Original root operation has successful exact result, export failed later | Retry exact service export; settle original success. Never cancel it. |
| Valid frozen intent and exact operation commit/ref exist, HEAD at frozen parent | Reconcile the interrupted original ref/HEAD phase under that intent; then settle original success. |
| HEAD already equals exact expected operation commit but root result write was lost | Verify original ref/tree/intent and reconstruct original successful result, preserving identical bytes. |
| No committed operation result; invalid ancestry or malformed old intent; repository/HEAD/tree remain readable | Recovery capture is permitted; preserve old bytes/refs and cancel old completion after capture/export. |
| Ambiguous success, missing required objects/root identity, changed operation ref or unexplained physical owner | Remain recovery; do not invent either success or cancellation. |
| Capture cannot be made durable because storage is still full | Remain BLOCKED/recovery with ownership retained. Infrastructure repair is still required. |

A commit object existing alone is not proof of integrated completion. Conversely, an already validated committed operation/ref must not be silently abandoned just because the backend has not seen success. The reconciliation helper needs explicit tests at every Git boundary. It must not rerun a fresh `git add` for a retained successful intent or produce another private completion commit.

When a correction decision loses the race to actual finalization, report `already_finalized`; no fresh same-activation correction starts. Treating a valid completed Node as failed to satisfy a stale Retry would silently implement Rework. The later review/Rework leaf owns that decision. If the purpose was Task Cancel, cancellation of the Task can still stand while the finalized result remains historical and cleanup settles; it must not resurrect REVIEW/current completion after the cancellation cutoff.

### Result authority: pair settlement avoids a deadlock

The current Stop path sends a prior open result before its own result (`daemon.go:349-373`). Copying this unchanged is unsafe: `service.ts:460` forbids a terminal completion result while **any other operation remains unresolved**, so original-success and its new settlement operation would wait on each other. The original lease also still points to its completion operation.

Recommended minimal typed extension: a successful `settle_completion` result carries a constrained `completion_settlement` payload with target ID, disposition (`cancelled` or `already_finalized`) and exact prior completion `OperationResult`. This is a single bounded non-recursive pair, not an arbitrary result bundle. `OperationResult` for the nested original may be a separate schema that disallows nested settlement fields.

The backend authenticates the Runner/incarnation and locks Runner → Task → Attempt → workspace/lease/operations, validates the immutable relation and both original/result identities, then settles the original and settlement operation in **one transaction**. Release only after no unrelated operation remains unresolved. Cancellation of original has `success:false`, exact `cancelled_by_operation_id`, `writer_absent:true`, and no fabricated Git-completion result. The new operation owns the private checkpoint evidence. For `already_finalized`, the original has its exact normal successful Git result; the settlement is an acknowledged reconciliation outcome, not another completion.

Daemon journal must retain both exact terminal results atomically, or store the pair under the settlement result and reconstruct the original terminal result from that exact pair before any later replay. Extend `FinishEffect` with a transactionally validated pair helper; never overwrite an existing terminal success/cancellation. A source-level duplicate of the same result is idempotent; altered target/result/descriptor is conflict. The pair remains replayable after restart and lost network acknowledgement without rerunning capture/export.

An alternative sequential protocol is possible only with explicit pair-aware guards that retain ownership until both arrive and permit the exact targeted success while its settlement is unresolved. The atomic pair is easier to audit and avoids an intermediate current completion/REVIEW projection.

### Reopening the captured invalid result for correction

Existing `reuseWorkspaceRecord()` requires released prior lease and same Node/activation for private checkpoints (`workspace_effect.go:306-324`). It retains fixed base/target/finalized revision and moves only to refresh. Existing `verifyRetainedWorkspace()` verifies checkpoint ref, exact HEAD and private tree without an ancestry check (`workspace_git.go:386-409`). This is the correct seam for a recovery checkpoint: the new Agent sees the actual broken result and the recorded failure/required fixed ancestry, and performs semantic correction.

The checkpoint is private retained work, not a new finalized pointer, Artifact or acceptance result. Store a typed recovery reason/provenance so a future read never labels its non-descending HEAD as finalized. Ordinary `complete_node` continues to require descent from the original fixed finalized base. The Program never automatically rebases/resets Agent code. Ignored private files remain locally present; a Git checkpoint does not claim to archive ignored files in the service result repository.

Do not broaden this to arbitrary repository corruption recovery. If HEAD cannot resolve, a required object is absent, or retained root materialization identity is missing, this minimal Git capture cannot establish durability. Preserve work and explicit attention; disk loss remains outside V1's guarantee.

### Repository-free completion

Canonical completion with no workspace is a real physical operation, not a backend-only success. Admit it only for a source-bound Node Dispatch, with no resource/workspace/digest fields and no admitted/opened/held workspace to settle. Having configured/reserved Project repositories alone is not an opened workspace.

Also inspect retained same-Node/activation workspace history. A fresh correction Attempt that has not reopened a previous private checkpoint must not bypass its unfinalized dirty work by submitting no-workspace completion. The smallest safe policy is to reject and require reopening/finalizing that retained workspace. A check limited to the current Attempt's live lease misses this case.

Required changes:

- Schema permits no-resource `complete_node` while source scope is enforced in backend/Runner. For canonical no-workspace success forbid Git commit/tree, workspace ID/metadata/path/instruction files. Require `writer_absent:true`.
- `workspaces.ts:113` replaces unconditional lease requirement with the exact canonical absent-workspace guard; pending/failed open cannot bypass it. `workspaces.ts:128` permits only source-bound canonical Stop/completion with no workspace result fields.
- `ValidateEffectScope` distinguishes initial Planner, Todo, legacy fixture and canonical Node (`effect_scope.go:16-48`). Only canonical Node source gains no-workspace completion. Empty reservations alone must not turn an arbitrary Planner/legacy Dispatch into that source.
- Root helper gets an explicit process-only completion route. Stop/verify whole process tree and retain terminal operation result. Do not enter legacy `runEffect()`/`Effect()` or fixture Git; those require materialization (`helper_effect.go:211`, `git.go:103`).
- `daemon.go:385` and `service.ts:461` require Git evidence only for admitted workspace-backed or explicit legacy Git completion. Export only those cases; no fake Git fields.
- Extend reconnect recovery (`recovery.go:45-67`) to exact source-bound canonical Node process-only Stop/completion. Preserve revoked/unreleased authorization, current inventory/retained Dispatch identity, matching local failure, finite once-after-Ready scheduling, and terminal replay without Host calls.
- Fix both failure/event orderings: current `service.ts:418` and `:483` wrongly block recoverable completion merely on physical absence. Recoverable remains RUNNING with recovery attention; hard failure BLOCKED. Neither frees ownership.

Never infer current completion from process exit, stdout, an Artifact publish, or empty workspace reservations.

### Post-Plan Cancel integration

Parent elected bounded Cancel for RUNNING/BLOCKED/REVIEW before delivery. Serialize exact Spec/Plan/control and record cancellation first; fence Node sources/Attempts, preserve immutable completions and history, and drive cleanup using existing Stop or the targeted completion-settlement operation. A queued or no-Attempt source needs no invented physical operation. A running completed/cancelled pair must settle physical history without turning the Task back to RUNNING/REVIEW or admitting a successor.

Do not rely on existing `service.ts:467-478` unchanged: it requires a current running activation/task before normal success and would reject late truthful cleanup success after Cancel. Separate physical historical settlement from current Node-completion projection under the cancellation guard. Delivery/remote-operation cancellation remains outside this leaf.

### Suggested implementation split

1. Protocol/DB/backend: operation relation/result pair, immutable-field checks, Owner decisions, pair settlement and Task Cancel projection; no-workspace admission and pending-private-work guard.
2. Runner: source scope, journal atomic pair, root cancellation marker and worker fence, partial-finalization reconciliation, recovery-only capture, service export, no-workspace process completion, reconnect extension.
3. Tests/integration: targeted real Git and PostgreSQL races plus root-owned native harness/deployment. Do not install or invoke native test services from research.

### Required tests

| Area | Minimum meaningful cases |
| --- | --- |
| Owner retry | Exact existing ID/digest retained; authorization/control/source/activation mismatch; hard failure retry only explicitly; second action conflict; original receipt unchanged. |
| Git finalization retry | Crash after intent, commit-tree, private ref, HEAD CAS, root result and export; exact commit/tree retained and no extra completion commits. |
| Broken ancestry correction | Create unrelated readable HEAD plus staged/unstaged/untracked/ignored local bytes; ordinary completion and Stop still reject ancestry; recovery capture preserves HEAD/index/files, exports exact capture, opens same Node/activation, Agent repair then strict completion succeeds. |
| Invalid old intent | Malformed/truncated finalization file preserved byte-for-byte; recovery intent distinct; no overwrite on same-ID replay. |
| Storage failure | Capture/export/journal write fails; no backend release/current completion; retry exact settlement resumes without changing capture. |
| Worker races | Original helper or systemd job delayed before/after marker and writer lock; exact cgroups quiesce; stale operation cannot resume after cancellation or new lease. |
| Success race | Original local success/backend unresolved; pair chooses already_finalized, keeps exact original result, no cancellation/new correction source. |
| Pair replay | Network lost after journal pair/before DB, DB commit before ack, restart, duplicate terminal result, altered nested result; no deadlock or partial lease release. |
| Backend constraints | Cross-Task/Attempt/lease/activation/target rejection, second settlement rejection, unchanged original lease settle pointer, terminal result immutability. |
| No workspace | Canonical zero-resource and reserved-but-unopened Node succeed with absence only; no Git/fixture calls; fake Git fields rejected; failed open/live lease/prior dirty checkpoint cannot bypass finalization. |
| Reconnect | Exact Node source and original op; hard/missing failure evidence rejected; Ready precedes result, overflow/single-flight keys retained; zero-Host terminal replay. |
| Cancel | Cancel before/after complete admission/result, during pair/export, and after Node complete; cleanup retains history/ownership until settled, never restores Task execution or REVIEW. |
| State ordering | Recoverable failure then absence and absence then failure both retain RUNNING/recovery; hard failure blocks; later settlement derives REVIEW only with every effect/owner settled. |

Protocol freshness/shared TS+Go transport fixtures, targeted/full meaningful PostgreSQL suites, Go race/vet and native two-account Git/process checks belong in the task verification. Native proof must distinguish trusted process/worker absence from a terminal database row.

## External references

No network/external research was needed. Repository architecture is the controlling reference. Existing workspace spec records Git 2.39 local clone protected-config behavior and Git 2.47.3 linked-worktree export behavior; preserve exact safe paths and two-account native verification rather than assuming a newer same-account local Git test proves deployment behavior.

## Caveats / Not Found

- This is a design recommendation, not implemented behavior or deployment acceptance. Names/schema/result bounds require final parent design.
- Source anchors reflect the files read on 2026-09-30; other workers may add implementation after this research.
- There is no current product Owner operation-retry API and no trusted completion-cancellation contract. The fixture retry helper and unexposed-open cancellation are insufficient.
- Existing operation/lease triggers do not allow substituting the terminal operation. A dedicated relation is required; do not fix this by weakening all identity guards.
- Recovery capture intentionally supports a readable Git repository with invalid ancestry/intent. It cannot promise recovery from missing objects, corrupt root ownership or permanent disk loss, and cannot succeed while required durable storage remains unavailable.
- The no-workspace branch needs the prior-private-work guard described above, beyond the earlier backend research's current-Attempt lease check.
- No product/source files, specs, task status, git state, native services or remote host state were changed by this research.
