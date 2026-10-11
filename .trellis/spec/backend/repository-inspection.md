# Planner Repository Inspection

Sources: [Planner](../../../docs/02-planner-and-planning.md),
[Workspace](../../../docs/04-workspace-and-git.md),
[Runner inspection](../runner/planner-inspection.md).

## Scope and signatures

`admitRepositoryInspection`, `assertInspectionAccess` and
`settleRepositoryInspection` own the canonical inspection boundary. All five
Planner sources participate: Todo Discussion, initial planning, Task Conversation,
Replan and Review (including reconsideration). Reply-only accepted/terminal
conversation may inspect without acquiring execution authority. Nodes are denied.

The operation is independent of Task Workspace, lease, reservation, Node evidence,
publication and delivery lineage. `Operation.inspection` and `inspection_digest`
retain exact scope/Project/resource/Runner/dispatch/source/origin identity.

## Admission and source selection

Receipt replay precedes current-source checks. A fresh request requires the exact
canonical source, version, watermark and frozen context digest, current connection
and active same-Project resource. Todo verifies the actual outbox, desired Attempt
and Project binding. Project archive alone does not remove an active resource.

Lock configuration, Runner, Task/Todo and Attempt before the operation/workspace.
Admission, original command receipt and outbox are atomic. Migration 28 protects
the descriptor/digest, original canonical source, origin evidence and settlement.

- No materialized Task workspace: use the selected resource default ref; Runner
  fixes its exact revision on the first successful physical fetch.
- Latest finalized Task result: use its exact existing `ResultReadIdentity`,
  digest and protected completion export, even after a later private checkpoint.
- Original successful open without completion: only use the original open
  descriptor/metadata with no basis/transfer/history/checkpoint, and require
  `finalized_commit == base_commit`. Runner independently verifies the private pin.

Never treat mutable Node files or a Stop checkpoint as current Task code. A retry
of the original request retains its revision; a fresh request may see newer code.

## Access and settlement

`POST /v1/runner/operations/:operation_id/inspection-access` accepts the exact
incarnation and inspection digest. Only default-ref inspection needs credentials.
Verify source/resource/connection before and after provider I/O, and reject a
changed provider configuration. Do not hold a transaction over that I/O or require
Ready for an already admitted recovery. Responses are bounded and `no-store`;
secrets do not enter descriptors, receipts, outbox, journals or Agent context.

Available results bind the operation, descriptor digest, repository/storage and
exact commit/tree where preselected. Typed unavailable results are successful
settlement; unknown physical ownership remains recovery. Inspection cannot return
workspace fields, completion evidence or writer-absence proof. Repeated terminal
results must match exactly. Late results use the original saved identity rather
than current source authority. Stop and terminal Planner outcomes wait for pending
inspection settlement; Stop remains able to cancel and drain the physical worker.

## Verification

Real PostgreSQL covers five source kinds, accepted/terminal conversations, exact
base/completion selection, moving finalized revisions, same-request replay, SQL
forgery, transient credential races and Stop-before-result ordering. Shared TS/Go
fixtures cover descriptor pairs and exclusive result variants. Actual local Git
and daemon tests cover pins, cancellation and retained result recovery; Linux
two-account permissions and installed native execution require separate evidence.
