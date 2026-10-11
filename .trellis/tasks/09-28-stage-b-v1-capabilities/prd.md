# Stage B: Remaining V1 execution capabilities

## Goal

Extend the accepted single-Node loop to the remaining V1 execution and delivery capabilities.

## Current status

Functional development is complete through `499cf78` (2026-10-11). All Stage B functional capabilities are implemented. Four functional packages are archived; the actual installed two-CLI fallback gate and upstream Stage A/native release acceptance remain open.

The task stays open for that acceptance. Local passing checks and prior evidence
are recorded in the [functional completion record](../../../docs/research/v1-functional-completion.md).

## Background and scope

Extend the accepted single-Node loop to the remaining V1 execution and delivery capabilities.

Architecture modules remain authoritative. Functional code is implemented and pushed; the remaining gates concern actual installed host/CLI/provider/reboot acceptance deferred by the Owner.

## Dependencies and order

- [Stage A: Single-Node product loop](../09-28-stage-a-product-loop/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

- [Second Runtime and ordered fallback](../09-28-b-runtime-fallback/prd.md)
- [Serial Nodes and Rework invalidation](../archive/2026-10/09-28-b-serial-graphs/prd.md)
- [Planner inspection and multi-Node Replan](../archive/2026-10/09-28-b-planner-replan/prd.md)
- [Parallel Nodes and worktree integration](../archive/2026-10/09-28-b-parallel-workspaces/prd.md)
- [Multiple repositories and delivery modes](../archive/2026-10/09-28-b-delivery-modes/prd.md)

## Acceptance criteria

- [ ] Second Runtime fallback, serial and parallel Nodes, multi-Node Replan and repository inspection pass owning contracts.
- [ ] Multiple repository items and all V1 delivery modes retain exact-result acceptance and truthful partial outcomes.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Remaining acceptance

Resume the concrete installed-environment checks when the Owner returns to native
acceptance. Preserve existing fixtures, receipts and ownership; do not repeat
unchanged broad suites or treat a deferred native check as missing feature code.

## Source contracts

- [Architecture](../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../docs/10-architecture-readiness.md)
- [Invariants](../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../spec/index.md)
