# Parallel Node workspaces

Status: implemented and locally verified on 2026-10-11 after multi-Node Replan (`71e0222`) and its
repository-free Host correction (`eec90a9`). This is an untracked development
increment under the Owner's existing authorization. Native A06/A30 verification
remains deferred. No deployment or remote push is part of this increment.

## Change boundary

The previous scheduler serialized all Node Attempts of a Task; workspace leases
and root records assumed one physical allocation per logical workspace.
This increment admits independent Nodes concurrently on one Runner and one
repository, allocates private working trees and Git administrative storage, and
integrates finalized results before granting completion evidence. Task Workspace
identity remains `(task_id, resource_id)`; allocation is infrastructure identity.

Changes belong in Node admission/scheduling, workspace/completion orchestration,
database constraints, the shared protocol and Runner Git/ownership machinery.
Replan must preserve multiple private inputs; reads must distinguish the Node's
own revision from the combined Task revision. Multiple repositories and delivery
modes follow separately. Nonempty Artifact `consumes` remains unsupported.

## Admission and allocations

- Freeze direct or isolated placement before dispatch. Optional
  `WorkspaceReservations.isolation: { allocation_id }` identifies isolated
  placement; absence denotes the existing direct workspace path. These are
  deterministic program choices, never Planner/Agent parameters.
- Prepare dependency-ready candidates as a bounded batch. Multiple eligible
  branches select isolated placement. Any retained isolated allocation keeps
  subsequent work isolated. A direct Attempt reserves Task exclusivity from queue
  admission through process/effect settlement, including before its first open.
- Retained direct private work keeps the existing serial placement until it is
  adopted/finalized. Only a clean, settled direct result seeds the transition to
  isolated placement. No running process changes its directory.
- Isolated allocations use separate private `worktree` and `common` directories
  below the logical workspace. The stable allocation ID can be reused by an exact
  settled continuation or approved checkpoint recipient. A conflict retry gets a
  fresh allocation; the old files and Git objects remain retained.
- `WorkspaceDescriptor.isolation` binds the same allocation. Lease ownership is
  unique per logical workspace/allocation, with an independent direct-exclusivity
  guard. One canonical Task result remains separately protected from Agent writes.
- First initialization is serialized. A second no-basis open is not admitted while
  the first has unresolved initialization ownership. Later isolated opens fork the
  exact finalized Task revision frozen in their admitted basis. They never fork
  another Node's mutable files.
- `WorkspaceDescriptor.canonical_source` supplies the exact prior successful
  operation, Attempt, kind and metadata that establish a retained Task revision.
  Completed sources use protected result exports; initial sources use retained
  original fetch pins. Root verifies the source and fixed lineage independently.
- `WorkspaceMetadata.isolation` records `{ allocation_id, start_commit }`. The
  allocation's start is immutable. Open/Stop results need not equal a Task head
  that advanced after admission; they bind their own descriptor and start instead.

## Completion and integration

Use one combined `complete_node` operation. The Task lock serializes completion
admission; another completion returns `unmet_precondition` before any fencing,
manifest, receipt or operation write. Its Attempt remains active. Exact replay of
an already-admitted request still returns the original operation first.

`Operation.integration: { expected_task_commit }` freezes the Task revision under
that admission boundary. It is permitted only for an isolated workspace completion
and participates in immutable operation identity. No Task/workspace lock is held
across Git or Runner RPC.

Root stops the owning Agent's entire process tree, finalizes the private allocation,
exports its exact result into protected storage, and performs deterministic Git
integration under the logical repository lock. The integration journal retains the
input, timestamp, finalized Node commit/tree, expected Task commit and resulting
Task commit before changing refs. Operation refs plus Task-head compare-and-set
support recovery without applying a merge twice.

`EffectResult.integration` records:

```text
outcome: integrated | conflict
start_commit, node_commit, node_tree
expected_task_commit, task_commit, task_tree
```

On `integrated`, existing `git_commit`/`git_tree` identify the integrated Task result
and `workspace_metadata.finalized_commit` agrees. Node input/produced revisions
remain explicit; its test claim is not silently attributed to later combined code.
The backend validates the exact expected revision and atomically advances the Task
workspace, immutable completion evidence and downstream eligibility.

On `conflict`, the physical operation has a durable terminal outcome but no Node
completion. Task commit/tree remain the expected Task result; top-level successful
Git completion fields are absent. Preserve the private result and conflict facts,
release physical ownership and the completion boundary, then prepare a new Attempt
for the same Node activation from the latest Task base. The previous result is
explicit historical input, not replayed over the new base. Bound automatic conflict
retries; exhaustion leaves an actionable Node blocker and ordinary Owner Retry.
Command/status/UI projections must not describe this as completed work.

Cancellation before integration preserves private work without changing the Task
head. Once integration has begun, reconcile that exact operation and retain any
actual integrated code, while cancellation/invalidation forbids current completion
evidence or downstream unlock. Hard capture recovery remains distinct from merge
conflict recovery. Neither path advances activation; Rework owns that transition.

## Replan, Rework and retained work

Replan inventories the canonical integrated result and every unconsumed private
checkpoint. Input identity and transfer uniqueness include the source lease or
allocation, not just the logical workspace ID. No sibling checkpoint may disappear
because a later lease exists on the same repository.

Each checkpoint maps to one exact unfinished target. This increment rejects
multiple private checkpoints assigned to the same target: silently overwriting one
with another is not integration. Distinct targets can adopt their exact retained
allocations after publication. Completed canonical code and private work remain
separate facts, with old completion validity governed by graph applicability.

Rework may retain the conservative precondition that other Node ownership settles
before admission. This preserves the existing Stop/closure journal while adding
parallel ordinary execution. Current holds, Task freezes and accepted-delivery
guards still apply. Repository-free completion checks only actual physical
ownership; semantic private-work obligations remain backend-authorized.

## Verification plan

Real PostgreSQL: concurrent admission/capacity, first-open race, direct late-open
exclusivity, isolated lease coexistence, exact completion barrier/CAS, Stop with an
independent writer, conflict same-activation retry, cancellation ordering, two
checkpoint Replan, and join eligibility only after both integrations commit.

Real local Git: separate writable/common directories, disjoint merge, conflict,
private history, replay after each journal/ref stage, expected-revision mismatch,
and complete join checkout containing both branches. Shared protocol fixtures,
all Go consumers, scoped race checks, TypeScript/lint and affected UI/browser
checks accompany integration. Native process/permission claims remain deferred.

## Implemented verification and limits

- Complete PostgreSQL regression: 60 files, 544 cases passed. The subsequent
  prospective-placement fix adds a real direct-result → Replan carry → isolated
  guidance regression; all 49 affected cases passed after that final change.
- Shared protocol fixtures cover allocation/source/integration/result-read/pair
  shapes; TypeScript protocol suites passed 542 cases. Aggregate unit/schema
  verification passed 725 cases. Generated protocol drift, ESLint, root/web
  TypeScript and production build passed.
- Real Git tests verify independent storage, three-way integration against the
  recorded start, preserved conflicts, durable intent/refs, Task-head CAS and replay.
  Helper race checks and the affected Host race suite passed (54 s and 83.5 s).
  The final Stop-before-first-open correction passed focused race tests (16.615 s).
  All Go consumers compile, Host/daemon/wire vet and full wire tests passed.
  Daemon result reads reject missing or changed private/integrated provenance.
- Built SPA browser test passed. Desktop/mobile images and exact source/build
  hashes are retained in [UI evidence](evidence/parallel-workspaces-ui-v1/manifest.json).
  These use actual authenticated backend/PostgreSQL with synthetic Runner facts.
- Independent reviews covered root cancellation/recovery, completion serialization,
  backend/SQL source proofs, checkpoint inventory and guidance reactivation. They
  found and fixed the fresh isolated Rework Stop, descendant-settlement and
  historical-direct-placement defects. Final targeted regressions passed.

Completed-node guidance waits for affected descendants (including queued Attempts,
processes, operations and leases), without waiting on unrelated isolated writers.
Its next activation uses prospective placement instead of the historical source's
direct reservation. Current live sources retain their original placement authority.

This increment supports one Runner and one repository per Task. Multi-repository
completion/delivery remains the next increment. Installed Linux/systemd/native CLI
and remote provider mutation were not exercised. Hard-killed Git may retain its
own lock files: recovery preserves ownership and fails closed; no TTL or automatic
stale-lock deletion is claimed. No remote push or deployment was performed.
