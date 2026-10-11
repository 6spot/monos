# Workspace and Git Effects

Sources: [Workspace](../../../docs/04-workspace-and-git.md), [parallel workspaces](../../../docs/research/parallel-workspaces.md), [multi-repository completion](../../../docs/research/multi-repository-completion-contract.md), [host permissions](../../../docs/11-technology-and-deployment.md).

## 1. Scope / Trigger

Lazy open/inspection, direct leases, isolated worktrees, finalization/integration, candidate export and retention.

## 2. Signatures

`open_workspace(resource_id)` returns logical workspace ID, Runner-local path and root instruction files. Identity is `(task_id, resource_id)`; records retain host/storage incarnation/materialization generation, base/target and finalized revision. Backend addresses IDs, not host paths.

Canonical Project-backed serial workspaces use the workspace modules beside
[Git effects](../../../runner/internal/host/git.go), [snapshot export](../../../runner/internal/host/snapshot.go)
and [finalization](../../../runner/internal/host/finalize.go). Explicit legacy probe
dispatches retain fixture behavior. Product Start/Node scheduling is backend-owned;
[Node execution](../backend/node-execution.md) defines canonical completion and
hard-recovery pairs. Delivery remains separate work; native serial-workspace acceptance is recorded in the
[serial-workspace task](../../tasks/archive/2026-09/09-30-a-serial-workspaces/prd.md).

Each `WorkspaceReservation.isolation` freezes that resource's allocation in the
Attempt launch. Different resources may retain different checkpoint allocations.
`WorkspaceDescriptor.isolation` repeats it, and the open result adds
`WorkspaceMetadata.isolation: {allocation_id,start_commit}`. Completion requires a
sorted `Operation.workspaces` array of descriptor/digest/integration inputs (maximum
64, unique resource/workspace/lease); an explicit empty array means no repository.
The parent owns the manifest digest and no singular completion fields are accepted.

[Integration](../../../runner/internal/host/workspace_integration.go) exposes:

```go
func PrepareWorkspaceIntegration(ctx context.Context, input WorkspaceIntegrationInput) (WorkspaceIntegrationResult, error)
func PublishWorkspaceIntegration(ctx context.Context, input WorkspaceIntegrationInput) (WorkspaceIntegrationResult, error)
```

Preparation protects its result without advancing canonical refs. Publication
requires the retained preparation; missing state is an error rather than permission
to prepare again after the parent decision.

Input binds the operation ID, protected Task and Node repositories, expected Task
commit, Node start commit, produced Node commit and tree. Each item's wire
`integration` object records `outcome`, `start_commit`, `node_commit`, `node_tree`,
`expected_task_commit`, `task_commit` and `task_tree`. Backend Tool Protocol
settlement owns canonical Task state and Node completion; a Git ref alone does
not publish either domain fact.

`Daemon.Reconcile(ctx, inventory)` validates and retains one recovery batch;
`Daemon.ConnectionReady(ctx)` enables it only after the Ready frame is sent.
`exportFetchArgs(workspace, common, ref)` selects the exact administrative source
for importing the operation ref into service-owned result storage.

## 3. Contracts

Reserve allowed paths before CLI launch, including Git common directories. Materialize lazily without moving a live process. A resource added after launch is available to later Attempts.

Canonical paths derive from the logical workspace hash and admitted allocation:

| Purpose | Path under `Root` (`/var/lib/monos-probe`) |
| --- | --- |
| Direct private workspace | `tasks/<workspace_id>/{worktree,common}` |
| Isolated private workspace | `tasks/<workspace_id>/allocations/<allocation_id>/{worktree,common}` |
| Resource object cache | `cache/resources/<resource_id>.git` |
| Protected original Node result | `service/node-results/<completion_operation_id>/<workspace_id>` |
| Protected canonical Task repository | `service/task-results/<workspace_id>.git` |
| Completion / aggregate cancellation export | `results/<operation_id>/<workspace_id>` |
| Ordinary Stop export | `results/<stop_operation_id>` |

`WorkspacePath` and allocation-keyed root records/coordinator/writer locks must
agree with the launch reservation. One allocation never receives a sibling's
writable paths. The root-owned parent/metadata and service-owned cache and exports
are separate from execution-owned Git/files. A stable storage
ID has service-private and root-owned copies; missing/mismatched initialized
identity requires recovery, never replacement cloning.

An isolated open with an existing Task basis requires the exact
`canonical_source` operation and metadata; a conflict retry also carries the
same Node activation's exact settled `conflict_source`. Validate root-owned
operation/manifest identity and protected exports, never select the latest local
directory or trust mutable Agent refs. Original materialization recovered by Stop
may name `recovery_operation_id`; accept only its exact successful
`PriorOperationResult` pair, preserving any already-retained original open result.
Fresh allocations pin their admitted Task start even if the Task advances before
open finishes. Checkpoint continuation/adoption reuses its original allocation and
start revision; unrelated siblings cannot change that basis.

SQLite effects retain immutable descriptor/digest and terminal results; root
workspace/operation JSON owns fsynced stages and physical lease identity; private
service pin records plus Git refs retain exact fetched OIDs. These are deliberately
not duplicated in three additional SQLite projections. Reconcile all authorities;
never trust an Agent-writable marker as a substitute for missing root data.

Persist worker identity before transient unit launch. Service identity fetches
with ephemeral read access through stdin/private environment, never argv, persisted
Git config or Agent environment. Execution identity clones from the uncredentialed
cache. Resource/workspace locks own mutation; helper/daemon global locks cannot
cover network waits and prevent Stop. A lost launch response still owns its exact
unit until physical reconciliation. Pin base/target before checkout, preserve clone
staging after failure, and refresh only remote observations on later leases.

Stop cancels only an allocation with no exposed or previously initialized open.
Initialized work needs
checkpoint, including a new lease whose refresh failed. Stop-only recovery carries
exact old-observation provenance under the [backend contract](../backend/workspaces.md);
ordinary opens still fetch. Checkpoints use a temporary index and preserve actual
HEAD/index/files, including ignored private local data. Only completion updates the
finalized pointer. Preserve the original fresh target-observation lease across
repeated Stop recovery; clear recovery provenance after a genuine new fetch.

For an isolated fresh allocation, Stop may overtake the first local open intent.
`recoverWorkspaceForStop` skips history import/recovery for unexposed `intent`,
`pinned`, `promoting`, `common_ready` and `cancelled` stages; the final Stop record
retains the exact original-open cancellation pair and writer absence. Rework
history already exists in protected predecessor storage and does not require a
new allocation merely to cancel it. Starting a history worker before any local
allocation record exists otherwise loops on missing-record failure. A checkpoint
transfer with missing initialized state, unknown stage or missing direct-workspace
basis marker remains a recovery error. Initialized `refresh_intent` and
`refresh_pinned` still recover an open and produce a checkpoint after any required
history import. These rules do not release a sibling lease or discard its files.

A complete reconnect inventory must not strand canonical workspace operations
in `recovery` while normal outbox delivery handles only `admitted`. After Start
reconciliation and connection readiness, retry each matching retained recoverable
journal failure once through the existing bounded effect queue, preserving any
overflow tail. Keep original identities and leases; skip remote terminal and local hard outcomes
and missing failure evidence. An existing untyped failure can retry as recoverable;
missing journal evidence cannot. A local terminal result for a remotely unresolved
operation is resent exactly, without rerunning its physical effect.
Failure remains recovery until another successful
reconnect or explicit scoped repair; no timer loop or automatic Agent retry.

The probe's `createTraversalRoot(path, uid, gid)` explicitly applies `0755` after creating/chowning a new Attempt parent; `mkdir(0755)` alone is filtered by the service's `0027` umask. Execution-owned children explicitly receive `02750`. Existing parents must already have the exact expected owner/group/type/mode; reject symlinks or mismatches without taking them over. Preserve failed Attempt directories and use a fresh Attempt ID after verified release.

A direct Node launch reservation excludes other Node writers for that Task before
its first repository open, including queued direct Attempts. Independent isolated
Attempts may coexist, with one live lease per logical workspace/allocation. The
backend serializes initial Task materialization and completion admission; an
already-running sibling can continue using its private allocation. The direct path
preserves the same Task worktree across Nodes and activations. A multi-repository completion retains one whole boundary before any partial
integration becomes visible. Ordinary Stop stays one operation per lease; sibling
Stops settle independently, while backend Attempt release waits for all members.

An immutable open descriptor may carry `WorkspaceTransfer.purpose: serial` only
for a completed predecessor in the same Plan. It carries no Replan publication or
proposal ID and cannot adopt a private checkpoint. Bind both sides to the exact
Task/Runner/workspace, predecessor Attempt/lease/activation and target canonical
dispatch Plan. Before first adoption, verify the root-owned predecessor manifest,
released workspace record and settled completion operation, including writer
absence, exact metadata, completion manifest digest and finalized commit/tree.
Changing either Node or activation requires an explicit valid transfer. Preserve
the fixed basis and existing code; historical completed code after Review Rework
is physical lineage, not completion evidence for the new activation. Once adopted,
replay uses the immutable new lease without adopting its predecessor again. Replan
transfers retain their cross-Plan publication/proposal and checkpoint contracts.

Upstream Agent Rework uses `purpose: rework`, `kind: checkpoint`, the exact domain
request ID, original command request ID matching the requester Stop, and the full
applied old/new activation map. Verify the old manifest/Stop/lease and current
target scope before replacing ownership. The Stop must already have exported its
checkpoint into the service-private result repository. Mutable execution Git refs
never replace that export as historical authority.

Rework persists `rework_intent`, `rework_archiving` and `rework_archived` before
rebuilding the same stable paths at the current finalized revision. Root moves the
whole old `common` and `worktree` into a request-keyed private archive; retain every
raw file and index byte, including ignored content that is absent from the Git
checkpoint. Never reset/clean away the old allocation. Interrupted renames and
rebuilds resume under the same immutable lease. Stop can finish that local rebuild
and recover the prior target observation before producing its own checkpoint;
an interrupted Rework is never an empty initial allocation.

That archive/rebuild flow applies to a direct allocation transfer. Isolated Rework
starts a fresh allocation at the current Task revision; its prior checkpoint is
historical input. Integration-conflict retry also uses a fresh allocation, while
retaining the same Node activation. The backend owns retry policy and Replan's
exact checkpoint recipient; the Runner never chooses a successor or merges
unrelated private allocations on its own.

`WorkspaceDescriptor.rework_history` admits bounded history only for the exact
applied target activation. Service verifies the protected export and seeds the
resource cache; execution imports the exact checkpoint objects under
`refs/monos/history/<rework_request_id>`. These objects are historical input for
native Git inspection and deliberate adaptation. Import never checks out or
replays the checkpoint over upstream's newer finalized code. Ref names in the
execution repository are mutable conveniences; exact commit/tree and protected
export remain authoritative. Raw archives are system recovery data, not an
Agent-readable history browser.

[Parent completion](../../../runner/internal/host/completion_batch.go) stops writers,
captures and protects every repository, then prepares every isolated integration.
One root operation record retains the true immutable parent and separate member
capture/protected/prepared/published/exported state. The same sequential worker unit
records its workspace/action/invocation digest before launch; that digest also binds
the unit description. Reconcile the prior invocation before reusing the unit.
Never create protocol Operations by copying the parent's ID into singular items.

Acquire allocation coordinators in sorted resource order. Only after all preparation
finishes, fsync one parent decision (`publish`, `conflict`, or `cancel`) under the
short helper lock shared with cancellation. No Git/network operation holds that
lock. Service workers consume protected Node exports and service-owned Task storage;
missing initialized storage is an error, never permission to re-clone it. New export
parents are service-private and workspace path components use validated logical
workspace hashes, never unchecked resource IDs.

The per-Task integration lock and `monos-integration-<operation_id>.json` retain
immutable inputs, commit date, expected tree and prepared outcome. Git 2.39's
`merge-tree --write-tree` uses a synthetic Node-tree commit whose sole parent is
the recorded Node start, fixing the three-way merge base even if private history
contains other merges. The actual integrated commit keeps the expected Task head
and original Node commit as parents. `refs/monos/integration-inputs/<operation>`
pins imported history; `refs/monos/integration-prepared/<operation>` and
`refs/monos/integration-conflicts/<operation>` retain prepared commits/trees
through garbage collection without granting success.

`git update-ref --stdin` with expected-old-value checks publishes
`refs/monos/task-finalized` and `refs/monos/integrations/<operation>` together.
Replay validates the retained intent, repairs a partially installed ref pair, and
returns the original result even when later integrations advanced the Task. A
changed input/ref or unrelated Task head is an error. A killed Git transaction may
leave `.lock` files: current recovery retains intent and fails closed; it does not
remove an unproven lock or claim automatic stale-lock repair.

A terminal completion has `writer_absent`, `completion_outcome` and an explicit
`workspace_results` array covering every admitted member in order. Finalized items
carry capture plus Git commit/tree; isolated items additionally carry integrated
proof. Conflict retains every capture, publishes no item Git pair, and keeps each
original finalized metadata revision. Only actually conflicting items carry conflict
integration; clean unpublished siblings omit integration. Protected terminal exports
hold integrated Task output on finalization and original Node output on conflict.
Only backend settlement advances all logical Task pointers and one Node completion.

Cancellation before the publish decision checkpoints every initialized member,
even if private finalization already produced commits. After the publish decision,
recovery rolls every member forward, including when no ref has moved yet. A retained
conflict decision also finishes its exact aggregate export. Neither partial ref
publication nor a single private commit grants parent completion or cancellation.
Persist the terminal aggregate before releasing any allocation; retain release
progress so replay does not touch a newer lease.

`settle_completion` names only the original parent and identity digest. Resolve its
membership from the retained parent, persist the exact terminal pair before release,
and commit both journal outcomes atomically. `already_finalized` embeds the exact
finalized/conflict aggregate; `cancelled` embeds the original absence tombstone and
outer checkpoints for every member. Ordinary Stop exports and original-open recovery
pairs retain their singular provenance.

Canonical/conflict sources, transfer proofs, immutable reads, Planner inspection
and publication verify the true parent plus the matching resource/workspace item.
A clean sibling capture from a conflicting parent is valid retry history. Result
read identity binds capture and integration, and every trusted consumer validates
whole-parent coverage before selecting an item. Never select the first result as a
default repository. Tests of a private branch alone do not validate integrated code.

The probe persists finalization inputs before `commit-tree` and retains an operation-specific ref for replay. Typed `recoverable` failures retain the admitted operation; `capture_hard_limit` and `invalid_finalization` block completion. Retrying repairs the same operation, under current activation/basis guards, rather than granting the terminal Agent a fresh mutation.

Service-owned repository caches are execution-readable, not writable. Cross-account clones use `--no-local` without hardlinks/alternates. Scoped `safe.directory` does not replace filesystem permission. Credentialed push stays service-owned. On Git 2.39, local clone strips `GIT_CONFIG_PARAMETERS` before `upload-pack`; argv `-c` trust alone is insufficient across owners. The [Git wrapper](../../../runner/internal/host/git.go) passes only exact known paths in a temporary 0600 `GIT_CONFIG_GLOBAL` file inherited by the transport child, then removes it. Do not modify user/global Git configuration or use wildcard safe directories.

For explicit export fetches from a linked worktree, use its exact administrative
Git directory (`common/worktrees/<worktree-name>`) as the local source. Host Git
2.47.3 rejects the cross-owner worktree-directory entry even with those exact safe
paths configured; clone resolves that entry differently. Preserve narrow trust
scopes. A partial service export is retried under the same operation/ref and must
verify the original commit/tree; do not regenerate a successful root checkpoint
or release its lease merely because the writer already stopped. Same-account or
newer-Git tests alone do not establish cross-account export compatibility.

Planner inspection is a service-owned immutable snapshot with service-owned parent directories. Execution can read/traverse it but cannot write, chmod or replace its root through shell. Native shell remains available; ownership protects the supplied snapshot without introducing a global filesystem sandbox.

Export the exact final tree with controlled public parents; never push private Agent commits or all refs. Persist candidate identity once, scan introduced history and final tree, and reconcile uncertain push before replacing a candidate.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Stale materialization generation | Reject local mutation |
| Integration conflict | Preserve result; bounded retry same Node/activation |
| Fresh isolated Stop before local open intent, including Rework history | No history worker; persist exact cancelled-open/Stop pair |
| Lost checkpoint-transfer marker or unknown recovery stage | Error and retain ownership; no empty cancellation |
| Cancel before parent publish decision | Preserve every checkpoint; canonical Task heads unchanged |
| Cancel after parent publish decision | Roll every member forward and retain the exact terminal pair |
| Changed integration inputs/ref or unrelated canonical Task head | Identity/revision error; no replacement integration |
| Unresolved Git transaction lock after process loss | Retain durable intent; no unproven lock removal |
| Unexpected revision | Stop for reconciliation |
| Local capture hard limit | Preserve work; Node BLOCKED; no completion |
| Publication-only finding | Finalized result enters REVIEW; no remote write |
| Unknown push result | Reconcile before candidate replacement |
| Missing disk lineage | Explicit unavailable; no silent clone-as-recovery |
| Existing Attempt parent has wrong owner/type/mode | Reject preparation; preserve original path |
| Recovery inventory lacks matching local failure/identity | Retain recovery; no speculative execution |
| Old connection still owns operation queue key | Keep pending entry until key release; recheck local outcome |
| Remote recovery, local terminal result | Resend original result; no physical effect |

## 5. Good / Base / Bad Cases

Good: a crash after Git integration resolves from operation refs once.
Base: serial work lazily opens one Task workspace.
Bad: expose partially integrated repositories to downstream work or publish all private refs.

Parallel case: two allocations start at the same Task commit, produce disjoint
edits, and integrate in sequence without losing either edit. A conflicting second
result remains readable but cannot complete its Node. A same-request replay after
a later integration returns its original Task/Node identities without advancing
the Task again.

## 6. Tests Required

Exercise two-account fetch/clone/export, direct-lease late repository access, concurrent integrations, crash after each effect, retained private work, cleanup protection and exact candidate-tree equality. Test capture/publication limits separately. Provider write tests require an explicitly authorized test repository.

Use real local Git to prove completed serial handoff preserves actual HEAD/tree
and code for both a new Node and a new activation, with exact lease replay. Reject
cross-Plan serial transfers, checkpoints, mismatched source/target or manifest/tree,
and unreleased writers/effects. Keep the existing Replan transfer cases passing.

Rework tests inject export, archive-intent, both rename, rebuild and final-save
failures. Verify Stop resumption, raw ignored/untracked/index retention, exact
finalized checkout, historical object restoration from protected export, and
unchanged HEAD/files after later history import.

Run traversal-root tests under umask `0027`, asserting final `0755`, and reject existing files, symlinks and wrong ownership without chmod/replacement. Probe-tool installation separately tests root umask `0077` so its shared driver remains readable.

Exercise real Git partial export with a detached private HEAD and checkpoint ref
absent from the initial bare clone; repeated fetch must retain exact commit/tree
and source HEAD/index/files. Verify actual host Git under both OS identities.
Recovery tests cover Ready-before-result ordering over TLS/WSS, more than 64
operations, cancelled old keys with failure/success/hard outcomes, missing and
changed journal/Start scope, open plus Stop, and one retry per complete connection
snapshot. Cached terminal replay must make zero Host calls.

Parallel regression scope is in
[integration tests](../../../runner/internal/host/workspace_integration_test.go),
[effect tests](../../../runner/internal/host/workspace_integration_effect_test.go)
and [allocation tests](../../../runner/internal/host/workspace_isolation_test.go).
Use real local Git for disjoint/conflicting edits, immutable start ancestry,
input/result/ref-stage interruption, partial ref-pair recovery, GC retention and
replay after later Task advancement. Effect tests assert protected export
identity, both sides of the parent publish decision, all-member conflict, and
retained Node output. Inject loss after each capture, protection, preparation,
publication and export; reload the durable parent before continuing. Stop tests cover no local open record, partially materialized
unexposed stages, initialized recovery and unknown/checkpoint state rejection.
Repository-free completion inspects only its own reserved allocation.

The multi-repository implementation has real local Git/fault tests, a full Host
race run, daemon/journal race tests, targeted checks for later export-directory fixes,
and Go compile/vet evidence. This includes independent sibling Stops, atomic
multi-item settlement, fresh Stop and initialized/direct Rework regressions. Service
export tests require a non-root account and skip when run as root. These checks do
not establish native systemd/cgroup cancellation, deployed two-account permissions,
live concurrent restart or host reboot behavior. Those real-host parallel acceptance
checks remain deferred; previous serial host evidence does not cover them. Reuse
unchanged local evidence and run the affected compile/vet/integration gates under
the [verification scope rule](../guides/verification-scope.md).

## 7. Wrong vs Correct

Wrong: a lease timeout alone permits another worker to reset the workspace.
Correct: validate generation/revision, stop/reconcile the old effect owner, then acquire physical ownership.

Wrong: import Rework history before cancelling a fresh allocation whose open never
wrote its root record, or clear a Git transaction lock on the assumption that its
owner died. Correct: cancel only proven unexposed allocation state without a worker;
reconcile admitted integration from durable intent and preserve unresolved locks.
