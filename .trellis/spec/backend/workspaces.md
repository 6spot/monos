# Canonical Task workspaces

Sources: [Workspace](../../../docs/04-workspace-and-git.md),
[protocol](../protocol/commands.md), and the
[implementation design](../../tasks/archive/2026-09/09-30-a-serial-workspaces/design.md).
The current multi-repository contract is recorded in
[completion and recovery](../../../docs/research/multi-repository-completion-contract.md).
Historical serial native public/two-account workspace and unexposed-open
cancellation trials passed; see that task's verification report for versions,
retained failures and limits. They do not establish multi-repository native acceptance.

## 1. Scope / Trigger

Canonical Node dispatch, lazy `open_workspace`, direct lease reuse and isolated allocations,
completion and system Stop reconciliation. [Node execution](node-execution.md)
adds Task-driven dispatch, Artifacts and hard-completion recovery. One completion
settles the Attempt's entire admitted repository set. Planner reads use independent
[repository inspection](repository-inspection.md), never workspace leases.

## 2. Signatures

`Dispatch.workspace_reservations` is a bounded Attempt-local Project/configuration
snapshot of resource/workspace IDs. It does not create workspaces or bind resources
to the Task. Workspace identity is `ws_` plus SHA256 of canonical JSON
`[task_id, resource_id]`; shared TS/Go/Python fixtures bind this algorithm.

Open and Stop use `Operation.workspace` and `workspace_digest` to retain an immutable
descriptor of workspace, resource, lease, Node activation, Runner and fixed basis.
`complete_node` instead requires `workspaces[]`, sorted by resource ID, with each
member's descriptor/digest and optional integration expectation. Its immutable
`operation_workspaces` rows are the exact member set; zero members is explicit.
`settle_completion` binds the original parent operation ID/digest and resolves that
same set without copying descriptors. Successful open preserves top-level
`workspace_id`, `path`, `instruction_files`; infrastructure
facts live in `workspace_metadata`. Provider metadata is optional and namespaced;
core identity is `repository_identity`, not a GitHub ID.

`POST /v1/runner/operations/:operation_id/repository-access` is a Runner-authenticated
ephemeral exchange. Request binds incarnation and descriptor digest. Responses
are strict, bounded and `no-store`; token material never enters a command receipt,
outbox, operation, dispatch, database journal or Agent environment.

## 3. Contracts

- Explicit internal legacy-probe provenance owns fixture access. Missing Project,
  Task creation metadata or resource metadata is never an implicit fixture grant.
- Configuration SHARE precedes Runner/Task/Attempt/workspace/lease/operation locks.
  Resolve membership against both launch reservations and active Project resources.
  Existing Task access survives Project archive; removal is a separate guard.
- First open freezes resource defaults and pins the Runner. Two request IDs under
  one lease refer to the same original open operation, with distinct receipts.
  Receipt lookup precedes fresh-state checks. No provider call occurs in the DB
  transaction. Every resource has its own fixed Task workspace and lease. Before
  committing a new open, bound the resulting Attempt set to 64 members and reserve
  encoded completion/cancellation payload budgets; reject oversize sets atomically.
- Initial success fixes storage/generation/repository/base/target. Later opens
  preserve those facts and finalized revision; only the lease's target observation
  changes. Project default edits do not retarget existing workspaces.
- Leases are held/settling/released. Only verified Agent and system-worker absence
  plus exact Git settlement permits release. No TTL, terminal Attempt alone or
  lost network reply releases ownership. Completion advances finalized revision
  atomically with the matching Node activation's completion.
- Stop preserves private work through a system-generated checkpoint and does not
  advance finalized revision. A fresh Attempt in the same activation may reuse it;
  another activation needs explicit Rework or Replan disposition.
- Ordinary Stop atomically admits one operation per unreleased lease (one
  repository-free Stop when there are none). Each member settles independently;
  one failed member cannot roll back a sibling's retained checkpoint. Release the
  Attempt only after verified process absence, every operation terminal and every
  lease released. The last open or inspection settlement may satisfy that barrier.
- For open operations, `cancelled` is terminal only for an exact never-materialized open, linked to an
  admitted Stop for its fenced Attempt/lease. Its receipt projects an error, never
  a successful workspace. The matching Stop may release without a checkpoint only
  when that exact cancellation is proved. All unresolved predicates exclude both
  succeeded and cancelled.
- Canonical completion cancellation is a separate exact exported settlement pair
  under [Node execution](node-execution.md); never apply unopened-workspace rules
  to that retained private-work recovery.
- An initialized workspace whose new lease cannot refresh is not cancellable as
  an empty allocation. Stop-only recovered open carries paired
  `recovered_by_stop_operation_id` / `target_observation_lease_id`, binding the
  current Stop and a released lease's genuine fresh target observation. Check fixed
  workspace facts and exact target commit; preserve provenance in Stop checkpoint.
  Repeated recovery points to the original fresh observation, not another recovered
  lease. Ordinary open requires fetch and cannot manufacture this provenance.
- No App: anonymous access requires positive public GitHub metadata and exact
  repository identity. Configured App: mint one-repository contents/metadata read
  access and verify returned scope, repository and expiry; denial never falls back
  anonymously. A previously verified fixed basis may supply the repository ID.
  Check Runner/operation/lease authority before and after provider HTTP calls,
  including connected pre-ready recovery and already-fenced admitted operations.

A `WorkspaceTransfer` with `purpose: serial` admits same-Plan handoff of a completed
workspace between Nodes/activations. It forbids Replan proposal/publication IDs and
checkpoint kind. Bind the genuine previous completed operation, manifest/tree,
released lease and exact Task/Plan/Runner/fixed basis to the current target source.
The admitted open descriptor persists this proof; Runner verifies retained predecessor
manifest and settlement evidence before adoption. Historical completed code may
remain the physical basis after Review Rework without becoming current evidence.
Ordinary cross-Plan Replan transfer retains exact proposal/publication provenance.

### Parallel allocations and integration

Migrations 30/31 and `workspace-placement.ts` freeze optional
`workspace_reservations.resources[].isolation: { allocation_id }` per resource
before queue admission. A dependency-ready batch uses independent allocations;
each inherited checkpoint retains its resource's exact allocation. Retained direct
private work keeps serial placement until adopted/finalized. Any direct reservation
makes the Attempt Task-exclusive, even while queued before first open. An empty
resource set does not itself require exclusive workspace placement. Same-allocation
ownership remains exclusive independently of Runner capacity. Task identity and
`storage_id` remain allocation-independent.

The first isolated initialization is serialized; subsequent descriptors freeze the
exact Task revision and `canonical_source` proof. Initial sources retain original
open pins; completed sources retain protected exports. An optional
`recovery_operation_id` binds the precise succeeded Stop and original result pair.
Never select a newer row as replacement proof. SQL independently checks source
operation, Attempt, released lease, metadata, fixed basis and integration result.

`workspace_metadata.isolation` contains allocation ID and immutable `start_commit`.
Later Stop/open metadata describes that allocation, even when another allocation
advanced the Task. Same-activation checkpoint continuation reuses its allocation;
Rework and conflict retry allocate fresh storage while retaining old private work.

`complete_node` holds one Task-wide completion admission boundary and freezes each
isolated member's `integration.expected_task_commit`. Pending completion, including
hard recovery, blocks new Node source preparation, dispatch and workspace open.
A competing completion fails before fencing its Attempt or writing its
manifest/receipt. No DB lock spans Runner or Git work.

Physical success is `{writer_absent:true, completion_outcome, workspace_results}`,
with `completion_outcome: finalized|conflict` and exactly one ordered result per
input member. Each result binds its workspace/lease, metadata and immutable capture
(`start_commit`, `node_commit`, `node_tree`). A finalized parent atomically advances
all member Task revisions and the one Node completion. If any integration conflicts,
preserve every member's capture, including clean siblings; advance no canonical
Task pointer and create no `node_completions`. Aggregate results carry no singular
top-level Git/workspace fields.

Release settled ownership and retry the same activation with fresh allocations
and each resource's exact `conflict_source`. Retry must reopen every captured
resource before completing, including siblings that did not conflict. Count one
conflict per parent completion, not per resource. Three conflicts since the last
Owner-created source exhaust automatic retry into `integration_conflict_limit`;
Owner Retry resets the effective budget. Replan freezes retry; dismissal resumes
it idempotently.

Cancellation before integration checkpoints private work. After integration begins,
reconcile the same immutable operation and retain physical code without granting
cancelled work completion evidence. `settle_completion` may report
`already_finalized` for either integrated success or a terminal physical conflict.
See [implementation and verification](../../../docs/research/parallel-workspaces.md).

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unreserved, removed or cross-Project resource | Denied scope |
| Next resource exceeds member or encoded aggregate budget | `workspace_set_budget_exceeded`; no committed new open |
| Missing, duplicate, reordered or foreign completion member | Reject whole result; retain recovery ownership |
| Another completion owns the Task boundary | Wait/reject before admitting new work |
| Wrong descriptor, activation, lease or storage identity | Reject; retain recovery ownership |
| Missing credentials, denied repository or unavailable ref | Recoverable bounded attention; Stop stays available |
| Unexposed open cancelled by its admitted Stop | Terminal error receipt; no workspace grant |
| Initialized refresh fails during Stop | Exact attributed old observation plus checkpoint |
| Provider denial after configuration/cancellation changes | No credential response under stale authority |

## 5. Good / Base / Bad Cases

Good: two requests share one open; Stop checkpoints dirty work and a fresh Attempt
reopens the same workspace without resetting HEAD/index/files. Base: a canonical
Node lazily opens a verified public repository. Bad: cancel an initialized failed
refresh, silently adopt a different base, or retry configured-App denial anonymously.

## 6. Tests Required

Use real PostgreSQL for admission/removal/default/Stop races, same-lease replay,
atomic receipt/result rollback, scope checks, original observation provenance and
conditional lease release. Deterministic provider tests require signed synthetic
App requests, exact token scope/expiry and secret non-persistence. Runner tests own
Git and durable-stage behavior; actual Linux/two-account/native CLI evidence owns
physical permissions, process identity and recovery claims. Public success never
establishes live private-token support.

## 7. Wrong vs Correct

Wrong: a failed fetch means there is no prior workspace, so cancel its lease.
Correct: distinguish never-materialized allocation from retained private work;
settle the former by exact cancellation and the latter by attributed recovery and
checkpoint after physical writers stop.
