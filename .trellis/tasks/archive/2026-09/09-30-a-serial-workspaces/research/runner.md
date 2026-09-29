# Runner implementation handoff

2026-09-30. Scope: `runner/**`, `infra/runner/**`; shared schema/generated
bindings belong to the backend implementer. No deployment, host operation,
task-status change or commit was performed by this worker.

## Implemented boundaries

- `host/workspace_identity.go`: canonical Task/resource hash, launch path
  reservations, exact descriptor/digest/scope checks, stable storage identity,
  account-owned directory and lock boundaries. Canonical inspection cannot fall
  through to fixture Git.
- `host/workspace_git.go`: service-account repository fetch; read-only scoped
  credential input; persistent first ref/branch/provider intent and operation
  pins; uncredentialed clone/checkout/target refresh; temporary-index checkpoint;
  fixed root instruction filenames; retained private-work validation.
- `host/workspace_effect.go`: root-owned workspace/operation stages, common
  promotion and exact ready-result replay; existing transient systemd workers;
  per-workspace coordination/writer locks and per-resource fetch locks; Stop
  worker reconciliation, cancellation and checkpoint/finalization adaptation.
- `host/helper.go`: canonical Git/network waits release the helper-wide metadata
  lock. A validated Stop first kills the Agent, then persists its fence and checks
  workspace storage. A fence-write failure still attempts owned worker Stop and
  returns recovery without successful lease settlement. New open worker launches
  require a still-populated Agent tree, so a failed durable fence cannot let an
  older helper restart a writer after the Agent was killed.
- `control/repository_access.go`: operation/digest/incarnation-bound HTTPS
  exchange, including connected pre-ready recovery. Responses are bounded and
  strictly decoded; non-200 responses retain only the allowed structured reason.
  Access material passes through helper/worker stdin and the service Git process
  environment, never operation records, Git config, argv or Agent environment.
- `daemon`: canonical workspace effects do not hold the lifecycle mutex while
  waiting on network/host work. Stop remains reachable concurrently. Terminal
  phase updates re-read the latest Start under a short lock, preserving newer
  PID/birth/cgroup and revocation evidence. Prior open success/cancellation is
  persisted/sent before Stop settlement; cancellation replay never starts work.
- `journal`: immutable workspace descriptor/digest comparison and terminal
  success/cancellation protection. Existing legacy effect paths remain separate.
- `snapshot.go`, worker entrypoint and Adapter: explicit stable workspace export
  paths, private checkpoint-object export, fixed-protocol instruction reading.
- Bootstrap/README: protected Task/cache/metadata directories and matching
  root/service storage IDs, established once without starting another service.

## Reviewed design refinements

The root integrator accepted retaining the existing SQLite `effects` table rather
than adding redundant workspace projections. SQLite owns immutable Operation and
terminal result bytes; root workspace/operation JSON owns physical stages,
identity and exact ready/checkpoint results; service fetch records own first
ref/branch intent and cached pins. All writes use durable records/fsync. Backend
remains formal lease authority. Recovery never reconstructs lineage from cache
HEAD or treats a timer as writer absence.

An initialized workspace whose new lease cannot refresh is never cancelled as
an initial allocation. Stop validates the retained workspace and checkpoints it.
Its recovered open result carries `recovered_by_stop_operation_id` plus
`target_observation_lease_id`, identifying the original released lease with a real
fresh target observation. Repeated Stop-only recovery keeps that original source;
a successful subsequent fetch clears this temporary provenance. The backend
independently validates the source and same-lease Stop. Stop arriving before the
new lease's local open intent follows the same exact-basis transition.

Partial fetch recovery first reads existing base pins. The first target branch
and base-ref intent are persisted before network fetch; deletion/ambiguity of a
previously pinned short ref or a changed provider default cannot replace them.

## Verification performed

- Full `go test -race ./...`: passed using installed Go 1.27.1.
- Full `go vet ./...`: passed.
- Repository `pnpm lint`, `pnpm typecheck`, `git diff --check`: passed.
- `sh -n infra/runner/bootstrap.sh` and AST parsing of all three embedded Python
  blocks: passed.

New tests cover shared hash fixtures and descriptor scope; actual Git base-pin
recovery after a failed target fetch, ambiguous/deleted base refs and changed
provider defaults; expired credential rejection and durable non-persistence;
duplicate clone, interrupted missing-file checkout, changed-file refusal; private
checkpoint replay without changing the real index/HEAD; changed retained private
work; instruction symlinks and empty-array wire serialization; nonexpiring locks;
slow/late worker settlement callback ordering; missing/mismatched/symlink storage
IDs, corrupt root descriptors, common promotion before/after rename and unexpected
data; ready acknowledgement loss and failed ready persistence; initialized
refresh failure, Stop-before-local-intent and chained recovery provenance;
physical Agent Stop before fence/storage failure; blocked-open concurrent
Reconcile/Stop; stale effect Start versus newly reconciled identity; immutable
cancelled-result replay and sanitized repository-access failures.

## Evidence still owned by root integration

Local tests use real Git and filesystem operations, but native process-control
tests use injected settlement/supervisor callbacks. They do not establish Linux
systemd/cgroup absence, two-account permissions or a deployed restart. Root's
native trial must verify these with source/binary hashes, the real public GitHub
repository, dirty work across Runner restart, Stop checkpoint, fresh-Attempt
reopen/completion and unavailable initial-open cancellation. Actual private App
access remains separate evidence; synthetic access tests do not prove it.

Durable-write tests cover explicit save failure and retained stage/rename
boundaries; they do not simulate host power loss or every possible filesystem
failure. Missing initialized storage remains an explicit recovery boundary.

## Native Stop export diagnosis and local repair

The first native trial (`ws-native-v1-first`) retained Stop operation
`540d85fa-f866-4bcc-b44f-ba63eae4753a` in backend recovery with reason
`ownership_unresolved`. Read-only host inspection established that the privileged
Stop had already completed: `writer_absent=true`, no Agent or detached descendants,
root operation `settled=true`, and a retained private checkpoint. Its exact commit
`ef96da624b83b3b53284c75b81041f5be628073a` and tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb` match the native driver's expected tree.
The workspace's finalized revision remains
`9ac3353e97ed6a0cb96a80bb8e136d44cac982e4`; the private Agent HEAD is
`dbfd87bd52b350ce4d587f31a19f22e95a41ab18`.

The service export had completed its bare clone but not its explicit checkpoint
fetch: HEAD was the Agent HEAD, FETCH_HEAD was empty, refs/monos/result and the
checkpoint object were absent. Connectivity fsck of that partial clone passed.
Thus the failure was not checkpoint capture or fsck. Root's released marker is
local bookkeeping; backend correctly retained the lease until export settled.

Host `/usr/bin/git` reports **2.47.3**. Under the actual service UID 997/GID 986,
with a service-owned 0600 protected config trusting exactly the result repository,
worktree and `common/worktrees/worktree`, the read-only command shape was:

```text
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=<private scoped config>
git --no-replace-objects -c core.hooksPath=/dev/null
    -c core.fsync=committed,reference -c core.fsyncMethod=fsync
    ls-remote <source> refs/monos/checkpoints/<same Stop ID>
```

Using the linked worktree as source exits 128 with `dubious ownership` naming its
administrative directory. Using that exact known administrative directory as
source exits 0 and returns the original checkpoint commit. This comparison uses
the same protected config and OS identity; it establishes a source-entry problem,
not a missing credential or unreadable checkpoint. Clone resolves this entry
before transport; the subsequent explicit fetch did not. Native diagnostic script,
results and stderr are preserved at
`/root/monos-workspaces-diagnostic-v1/export-source-sj9x3wyx/`; its nonsecret scoped
config remains at `/tmp/monos-export-source-z8k4q83n/gitconfig`. Only these authorized
diagnostic files were created; canonical workspace, results, journal, service
configuration and process state were not mutated by this reviewer.

`snapshot.go::exportFetchArgs` now uses the already-derived linked-worktree
administrative directory as the explicit fetch source, retaining the exact same
two additional safe-directory scopes. It applies to checkpoint and completion
refs. No wildcard/global trust, new checkpoint, new Stop or workspace reset is
introduced. The existing export result-tree validation and daemon success gate
remain unchanged.

`TestCrossOwnerCheckpointFetchFromDetachedWorktree` uses real Git with
`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`, a detached private Agent commit, distinct staged
and unstaged contents, and untracked data. It verifies the partial clone really
lacks the checkpoint object, imports the retained checkpoint twice, checks exact
commit/tree/connectivity, preserves source HEAD/index/ref/files, and forbids
alternates. The existing finalized-worktree cross-owner clone test also passes.
macOS Git 2.54 accepts the old source form, so the native 2.47.3 negative/positive
diagnostic is the version-specific regression evidence, not the local test alone.

After this fix: full Go race tests and vet, repository lint/typecheck and
`git diff --check` passed. Independent read-only review found no issue in the fix
or new test. Root integration still owns Linux build/deployment and verification
of **the same retained Stop operation**. Reconciliation must reuse its cached root
checkpoint and finish the partial service export before backend lease release;
do not re-open/reclone/reset the Task workspace or manufacture another Stop.
Native recovery and fresh-Attempt acceptance remain unclaimed until root records
their actual results. The Runner workspace spec should preserve the exact
administrative-source rule when root synchronizes final acceptance documentation.

## Finite recovery after an authenticated reconnect

Follow-up inspection found a second current-leaf gap: the complete inventory
included recovery operations, but `Daemon.Reconcile` only reconciled Starts and
the backend outbox deliberately delivered only admitted effects. Owner Stop
receipt replay did not reschedule recovery; Continue/Retry required the old lease
and operations already settled. The only explicit state reset was fixture admin,
which is not an acceptable product recovery path. Backend settlement already
accepts the original recovery operation's validated result without readmission.

Under root's explicit authorization, the fix stays inside Runner. `Reconcile`
validates a complete inventory and retains only canonical workspace recovery
operations with an exact matching local journal result/body and Start scope.
Existing failures with `recoverable` or absent legacy classification may retry;
missing journal/result evidence and typed hard failures are skipped. Matching
local success/cancellation is retained solely for immutable result retransmission.
Remote admitted/succeeded/cancelled operations are not added to this batch.

`control.Client.Run` calls the optional `ConnectionReady(ctx)` hook only after
sending Ready and marking the current connection ready. Before that hook, no
recovery effect or result is emitted. `daemon/recovery.go` activates the finite
batch through the existing single-flight queue: at most 64 jobs, retained overflow
and retained keys still occupied by an older cancelled connection. Worker slot
release drains the remainder, with Stop entries first; no timer, new scheduler,
Task/Agent retry, operation/lease admission or backend state rewrite is added.
An existing failure is attempted once per successful connection snapshot, then
stays in recovery if it still fails. The previous helper's physical lease/fence
rules continue to govern open/Stop coexistence.

The batch belongs to its connection context. Cancellation clears only that exact
batch, so a delayed old cancellation cannot erase a newer snapshot. Before a
waiting entry actually runs, Runner rechecks the current journal outcome and
Start scope: a newly hard failure is skipped; a newly terminal result uses
`effect`'s cached-result branch with zero host calls. This also repairs the lost
success-frame window after an old export finishes during disconnection.

New daemon regressions cover Ready gating, original operation identity, finite
failed-open/completion recovery across separate connections, remote-terminal and
hard/missing-evidence exclusion, incomplete inventory and changed request/lease/
dispatch/reservation/result rejection, 70 operations through the 64-slot queue,
duplicate frames, an occupied old key becoming success/hard/recoverable, delayed
cancellation, changed Start scope before execution, and coexisting unexposed
open/Stop. A real TLS/WSS test asserts Ready precedes retransmission of the exact
retained successful completion or cancelled-open result, without any host effect.
These are dispatcher/journal/transport checks; native deployment and original
Stop recovery are still root integration's evidence boundary.

After this recovery change, full `go test -race ./...`, `go vet ./...`, repository
lint/typecheck and `git diff --check` passed. The independent reviewer found no
remaining source/test issue. This worker made no further host mutations,
deployments, service restarts, fixture retries or canonical state changes.
