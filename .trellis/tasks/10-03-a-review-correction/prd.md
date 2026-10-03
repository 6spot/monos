# Review correction and delivery recovery

## Goal

Route explicit review feedback, revoke eligible undelivered batches and reconcile retry/cancel without losing remote truth.

## Planning status

Backlog leaf; refine source-backed design, execution checklist and contexts before implementation. The user delegates successive task execution and routine decisions autonomously.

## Dependencies and order

- [10-03-a-owner-delivery](../10-03-a-owner-delivery/prd.md).

## Requirements

- Explicit Owner Request Changes remains REVIEW while Planner routes feedback; use Rework when graph is sufficient and Replan only for actual graph insufficiency.
- Revoke accepted operations only with no finalized item and no unresolved merge, cancel pending dispatch and settle admitted effects before correction.
- Keep same Task/Node and normally delivery branch/PR; updated result needs fresh exact review and acceptance. Later chat alone never invokes correction.
- Expose Answer & Retry, Withdraw feedback, Dismiss Replan and Cancel according to owning guards. Cancel reconciles in-flight truth, closes undelivered open PRs and retains branches; never reverts finalized delivery.

## Acceptance Criteria

- [ ] Correction at each delivery boundary preserves settled effects and rejects stale accepted workers.
- [ ] Routing failures and explicit exits leave truthful state and do not silently clear acceptance guards.
- [ ] Partial delivery prevents reopening shipped results and offers only permitted remainder recovery/cancellation.

## Scope boundary

Implement this leaf only after its upstream evidence is accepted. Preserve [architecture](../../../ARCHITECTURE.md) and [invariants](../../../docs/08-principles-and-non-goals.md); no generic workflow engine, new Git Task states, team abstraction, remote source push, distributed workspace transfer or permanent disk-loss recovery.
