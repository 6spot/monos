# Stage A integrated acceptance

## Goal

Prove the complete Stage A behavior across backend, Runner, real CLI, browser and GitHub.

## Planning status

Roadmap level: **work-package**. Status: **planning / backlog**, not implementation-ready. The Owner approved the three-level roadmap structure on 2026-09-28. This PRD records scope and acceptance, not approval to start implementation.

## Background and scope

Prove the complete Stage A behavior across backend, Runner, real CLI, browser and GitHub.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [GitHub review and correction](../09-28-a-review-delivery/prd.md)
- [Owner access and minimum configuration](../archive/2026-09/09-28-a-owner-configuration/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Child decomposition is deferred until upstream evidence is available. Before implementation, split this package into independently verifiable behavior slices; do not start the entire package as one implementation task.

## Visual requirements

Apply the [visual contract](../../spec/frontend/visual-design.md) to the combined Todo→Task→Review flow. Require completed evidence from the [existing-screen migration](../archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md) and new execution/review surfaces before closing integrated visual acceptance.

## Acceptance criteria

- [ ] The [visual quality gate](../../spec/frontend/quality-guidelines.md) has inspected desktop/mobile evidence from the integrated build; shared shell, typography, controls and representative recovery states remain consistent across the flow.

- [ ] Module-09 Stage A and conversation-closure matrices map to tests and real-run evidence.
- [ ] Crash windows, capacity saturation, browser reconnect, requirement/review races and provider uncertainty pass without false completion.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Before implementation

Review upstream evidence and the current source, refine leaf boundaries and observable failure cases, and resolve any Owner-owned acceptance choices. For each complex implementation leaf, complete design.md, implement.md and curated implement/check contexts, present the final planning summary, and obtain its approval before task.py start. Stage and work-package records coordinate acceptance and are not bulk implementation targets.

## Source contracts

- [Architecture](../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../docs/10-architecture-readiness.md)
- [Invariants](../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../spec/index.md)
