# Single-host release acceptance

## Goal

Run and retain the full single-host V1 acceptance matrix.

## Planning status

Roadmap level: **work-package**. Status: **planning / backlog**, not implementation-ready. The Owner approved the three-level roadmap structure on 2026-09-28. This PRD records scope and acceptance, not approval to start implementation.

## Background and scope

Run and retain the full single-host V1 acceptance matrix.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Installation, settings and operations](../09-28-v1-install-operations/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Child decomposition is deferred until upstream evidence is available. Before implementation, split this package into independently verifiable behavior slices; do not start the entire package as one implementation task.

## Visual requirements

Include the [visual contract](../../spec/frontend/visual-design.md) in release acceptance for Login, Settings, Todos, Discussion, Board and Task/review surfaces. Inherit completed existing-screen migration and new UI evidence; do not count a standards-only change as migration.

## Acceptance criteria

- [ ] The release build has traceable inspected desktop/mobile visual coverage under the [quality gate](../../spec/frontend/quality-guidelines.md), including reference comparison, representative states and documented deviations.

- [ ] Every release-matrix row has versioned reproduction, actual evidence and pass/fail status.
- [ ] Full capacity leaves authenticated control exits usable; supported restart and resource failures preserve work.
- [ ] Release cannot be marked complete based solely on documentation or fake adapters.

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
