# Multi-repository completion implementation contract

Implemented contract, 2026-10-11. This builds on parallel workspaces
(`130eec1`) and the [scope research](multi-repository-delivery.md). No historical
wire/data compatibility is required. Native verification remains deferred.

## Wire and allocation

- `WorkspaceReservation` gains optional `isolation: WorkspaceIsolation`.
  Remove `WorkspaceReservations.isolation`. Placement is frozen per resource;
  any direct reservation keeps conservative Task-wide exclusivity. A collection
  with no repositories requires no writable reservation. Preserve each approved
  checkpoint's allocation independently, including different source allocations
  assigned to the same target Node for different resources.
- `WorkspaceCompletionInput` contains `workspace: WorkspaceDescriptor`,
  `workspace_digest: SHA256`, optional `integration: WorkspaceIntegration`.
  Integration is required exactly when the descriptor is isolated.
- `complete_node` requires `workspaces: WorkspaceCompletionInput[]`, sorted by
  resource ID, maximum 64, with unique resources, workspaces and leases. Empty
  array means no repository. It forbids top-level workspace, workspace digest,
  resource ID, repository-free flag and integration. The parent alone owns the
  completion manifest digest. The Agent cannot select a subset.
- `WorkspaceCaptureResult` contains `start_commit`, `node_commit`, `node_tree`.
- `WorkspaceEffectResult` contains `resource_id`, `workspace_id`,
  `workspace_metadata`, optional `capture`, `git_commit`, `git_tree`, `integration`.
- Successful completion `EffectResult` requires `writer_absent:true`,
  `workspace_results: WorkspaceEffectResult[]`, and
  `completion_outcome: finalized | conflict`. Singular Git/workspace fields are
  forbidden. Exact member coverage/order is checked by every trusted consumer.
- Finalized: every item has capture and Git commit/tree; isolated items additionally
  have integrated proof. Metadata finalized commit equals item Git commit. Empty
  success has an explicit empty result array.
- Conflict: every item has capture; no item has top-level Git commit/tree; no Task
  pointer advances. At least one item has conflict integration. Other captured but
  unpublished items omit integration. Metadata retains each original finalized
  revision. Count conflict budget once per parent. Retry must reopen/reconcile all
  captured resources; clean sibling captures cannot disappear.
- `WorkspaceCanonicalSource` gains optional `capture` and `completion_outcome`.
  Original-open sources omit both. Completed canonical sources bind a finalized
  parent and exact item; conflict sources bind a conflict parent and its exact
  captured item, including an item without an individual conflict. Select by the
  outer descriptor's exact resource/workspace, never the first array element.
- `settle_completion` carries original completion operation ID and identity digest,
  without copying descriptors or manifest. The retained original parent supplies
  membership. `already_finalized` embeds its exact terminal finalized/conflict
  result. `cancelled` embeds the original absence tombstone; outer workspace results
  contain every initialized member's exact checkpoint. One atomic settlement pair.
- Preserve absent versus explicit empty arrays in generated Go JSON marshaling.
  Keep current envelope byte limits. Admission of each new open checks that the
  prospective completion and cancellation result can fit; count alone is insufficient.

## Backend and SQL

Persist immutable parent membership in `operation_workspaces`, keyed by parent
operation and resource, with exact lease/descriptor/digest/integration. SQL-backed
operation JSON includes the sorted collection. A matching result projection by
parent/resource centralizes provenance reads. Keep singular columns only for the
singular open and ordinary Stop operation kinds; they are not completion aliases.
Database migration 31 owns exact cross-row identity, immutability, coverage,
source-result validation and Rework Stop membership.

Whole-Task completion admission freezes all successful held opens and sets every
member lease's settle operation to the parent, before fencing/manifest/receipt writes
become visible. Block new Node source admission/dispatch and new workspace opens
until the parent settles, including recovery. Existing effect recovery, Stop and
Cancel remain permitted. No DB transaction spans Git or Runner RPC. Commit all
canonical pointers, leases and one Node completion atomically after final success.

Ordinary Stop stays singular per lease. One admission transaction revokes Attempt
mutation and persists every required Stop/outbox. An Attempt with no lease gets one
process-only Stop. Each member may settle and release its own lease independently;
it must not wait for sibling Stops. Set `process_released` only after process absence,
all pending operations terminal and every lease released. Duplicate reports reuse
their original result. Never create ordinary Stops beside an admitted completion;
use its aggregate completion settlement.

Rework binds the requesting Attempt and complete immutable request-to-Stop membership;
each workspace history selects its own Stop/lease. Apply waits for all members.
Same-Attempt multiple direct leases are allowed; different Attempts remain excluded.
Replan checkpoint target uniqueness is per target Node/activation/resource.

## Runner

Keep one parent root operation record and one sequential worker unit. Record each
item's capture/prepared/published/exported stages separately from parent settlement.
Persist active resource/action and its exact invocation identity before launch;
settle the previous invocation before reusing the unit. Internal scope helpers bind
parent identity plus exact item and must not create a synthetic protocol Operation.

Capture and protect all results, prepare all integrations, then fsync one decision:
publish, conflict or cancel. Before publish, any conflict keeps all Task heads
unchanged. After publish decision, cancellation/restart rolls forward/reconciles
all members. Partial publication retains the complete ownership barrier; no rollback
or premature checkpoint-cancellation of remaining members. Locks follow resource ID
order; root decision locks do not span Git/network work.

Namespace completed exports by parent and a validated per-workspace key (the hashed
workspace ID is suitable), avoiding unchecked resource IDs as filesystem components.
Operation refs may reuse parent ID inside different repositories. Retain single-lease
Stop exports and exact initial-open recovery pairs. Selected result/transfer/publication
readers verify the parent plus matching resource item and its capture/integration.

## Read and delivery waves

One semantic Node result retains one manifest. `TaskLocalResult.git_results` is a
required array replacing nullable `git`; `repository_free` is a derived read flag.
Each Git result and immutable read identity includes `capture`. Content reads select
an explicit resource as well as operation; UI renders each repository beneath its
Node result. Publication selection follows the same exact resource identity.
Operation status exposes parent completion outcome so conflict never appears as
completed Node work. Attempt workspace reads must expose every lease.

Per-resource candidates, GitHub automatic/deferred acceptance, all-item readiness
and stable-order partial delivery are implemented.
Plain-Git transport/credentials and mixed finality follow as the next wave, as detailed
in the scope research. These are implementation waves of the authorized task sequence.

## Verification

- Protocol: 575 shared fixture tests; `pnpm protocol:check`; full Go wire race.
- TypeScript: 758 unit/schema tests, root/Web type checks, lint and production build.
- PostgreSQL: full 65-suite run exposed 11 outdated fixture/assertion failures;
  all seven affected suites were corrected and rerun (62/62). The other 58 suites
  passed unchanged. Combined current suite coverage is 581 cases.
- Runner: full Host race (291.979 s), final export durability fix race (105.025 s),
  daemon race (4.177 s), journal race (2.102 s), wire race (4.376 s), full consumer
  compilation and scoped vet. These are local tests, not Linux native acceptance.
- Browser: two execution/result-collection tests, six result-inspector tests and
  four Owner delivery tests. Deferred two-repository delivery uses real service,
  PostgreSQL and worker with synthetic Git/provider replies; first success survives
  second-item failure and Retry completes only the remainder.
- Retained desktop/mobile inspection and exact source/build hashes:
  [UI evidence](evidence/multi-repository-ui-v1/manifest.json).

Historical singular completion storage is deliberately unsupported: its migration
failure rolls back atomically without inventing provenance. No live remote effect,
SSH, deployment or native A06/A30 acceptance was performed. Plain Git and mixed
provider finality remain the next implementation increment.
