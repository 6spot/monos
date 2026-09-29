# Workspace and Git Effects

Sources: [Workspace](../../../docs/04-workspace-and-git.md), [host permissions](../../../docs/11-technology-and-deployment.md).

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

`Daemon.Reconcile(ctx, inventory)` validates and retains one recovery batch;
`Daemon.ConnectionReady(ctx)` enables it only after the Ready frame is sent.
`exportFetchArgs(workspace, common, ref)` selects the exact administrative source
for importing the operation ref into service-owned result storage.

## 3. Contracts

Reserve allowed paths before CLI launch, including Git common directories. Materialize lazily without moving a live process. A resource added after launch is available to later Attempts.

Canonical stable paths derive only from the shared workspace hash under
`Root/tasks/<workspace_id>/{worktree,common}`; cache lives at
`Root/cache/resources/<resource_id>.git`. The root-owned parent/metadata and
service-owned cache are separate from execution-owned Git/files. A stable storage
ID has service-private and root-owned copies; missing/mismatched initialized
identity requires recovery, never replacement cloning.

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

Stop cancels only never-exposed, never-materialized opens. Initialized work needs
checkpoint, including a new lease whose refresh failed. Stop-only recovery carries
exact old-observation provenance under the [backend contract](../backend/workspaces.md);
ordinary opens still fetch. Checkpoints use a temporary index and preserve actual
HEAD/index/files, including ignored private local data. Only completion updates the
finalized pointer. Preserve the original fresh target-observation lease across
repeated Stop recovery; clear recovery provenance after a genuine new fetch.

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

One direct workspace lease prevents other Node dispatch for that Task. Multiple admitted Nodes use isolated worktrees from finalized revisions. Serialize integration and reserve a whole multi-repository completion boundary before partial effects can become visible.

Stop writers, finalize, integrate, then grant completion evidence. Preserve operation-specific refs and local journal stages. Interrupted private work is not a completed integrated result. Rework corrects existing code rather than automatically reverting it.

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

## 6. Tests Required

Exercise two-account fetch/clone/export, direct-lease late repository access, concurrent integrations, crash after each effect, retained private work, cleanup protection and exact candidate-tree equality. Test capture/publication limits separately. Provider write tests require an explicitly authorized test repository.

Run traversal-root tests under umask `0027`, asserting final `0755`, and reject existing files, symlinks and wrong ownership without chmod/replacement. Probe-tool installation separately tests root umask `0077` so its shared driver remains readable.

Exercise real Git partial export with a detached private HEAD and checkpoint ref
absent from the initial bare clone; repeated fetch must retain exact commit/tree
and source HEAD/index/files. Verify actual host Git under both OS identities.
Recovery tests cover Ready-before-result ordering over TLS/WSS, more than 64
operations, cancelled old keys with failure/success/hard outcomes, missing and
changed journal/Start scope, open plus Stop, and one retry per complete connection
snapshot. Cached terminal replay must make zero Host calls.

## 7. Wrong vs Correct

Wrong: a lease timeout alone permits another worker to reset the workspace.
Correct: validate generation/revision, stop/reconcile the old effect owner, then acquire physical ownership.
