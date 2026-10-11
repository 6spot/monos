# Canonical Task workspaces

Sources: [Workspace](../../../docs/04-workspace-and-git.md),
[protocol](../protocol/commands.md), and the
[implementation design](../../tasks/archive/2026-09/09-30-a-serial-workspaces/design.md).
Native public/two-account workspace and unexposed-open cancellation trials passed;
see the task's verification report for versions, retained failures and limits.

## 1. Scope / Trigger

Canonical Node dispatch, lazy `open_workspace`, direct lease reuse and isolated allocations,
completion and system Stop reconciliation. [Node execution](node-execution.md)
adds Task-driven dispatch, Artifacts and hard-completion recovery. Multi-repository
completion remains a later slice. Planner reads use independent
[repository inspection](repository-inspection.md), never workspace leases.

## 2. Signatures

`Dispatch.workspace_reservations` is a bounded Attempt-local Project/configuration
snapshot of resource/workspace IDs. It does not create workspaces or bind resources
to the Task. Workspace identity is `ws_` plus SHA256 of canonical JSON
`[task_id, resource_id]`; shared TS/Go/Python fixtures bind this algorithm.

`Operation.workspace` and `workspace_digest` retain an immutable descriptor of
workspace, resource, lease, Node activation, Runner and fixed basis. Successful
open preserves top-level `workspace_id`, `path`, `instruction_files`; infrastructure
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
  transaction. Stage A permits one materialized repository per Task.
- Initial success fixes storage/generation/repository/base/target. Later opens
  preserve those facts and finalized revision; only the lease's target observation
  changes. Project default edits do not retarget existing workspaces.
- Leases are held/settling/released. Only verified Agent and system-worker absence
  plus exact Git settlement permits release. No TTL, terminal Attempt alone or
  lost network reply releases ownership. Completion advances finalized revision
  atomically with the matching Node activation's completion.
- Stop preserves private work through a system-generated checkpoint and does not
  advance finalized revision. A fresh Attempt in the same activation may reuse it;
  another activation needs explicit disposition from the later settlement slice.
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

Migration 30 and `workspace-placement.ts` freeze optional
`workspace_reservations.isolation: { allocation_id }` before queue admission. A
dependency-ready batch uses independent allocations; retained isolated work keeps
later placement isolated. Retained direct private work keeps serial placement until
adopted/finalized. A queued direct Attempt already excludes other Task writers,
even before first open. Same-allocation ownership remains exclusive independently
of Runner capacity. Task identity and `storage_id` remain allocation-independent.

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

`complete_node` holds a single Task completion admission boundary and freezes
`integration.expected_task_commit`. A competing request fails before fencing its
Attempt or writing its manifest/receipt. No DB lock spans Runner or Git work.
An `integrated` result atomically advances Task Git and exact Node evidence. A
`conflict` result is physical success only: no top-level Git completion fields,
no `node_completions`, unchanged Task revision, and preserved private Node result.
Release settled ownership and retry the same activation with a fresh allocation
and exact `conflict_source`. Three conflicts since the last Owner-created source
exhaust automatic retry into `integration_conflict_limit`; Owner Retry resets the
effective budget. Replan freezes retry; dismissal resumes it idempotently.

Cancellation before integration checkpoints private work. After integration begins,
reconcile the same immutable operation and retain physical code without granting
cancelled work completion evidence. `settle_completion` may report
`already_finalized` for either integrated success or a terminal physical conflict.
See [implementation and verification](../../../docs/research/parallel-workspaces.md).

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unreserved, removed or cross-Project resource | Denied scope |
| Another materialized repository in Stage A | Explicit unsupported multiple workspaces |
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
