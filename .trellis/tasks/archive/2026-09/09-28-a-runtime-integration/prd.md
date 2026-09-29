# Production Runtime integration

## Goal

Integrate the proven Runner/CLI boundary with canonical Attempts and two shared execution slots.

## Planning status

Roadmap level: **work-package**. All four implementation/acceptance leaves passed on 2026-09-29. The Owner authorized sequential roadmap execution and completion under the existing architecture.

## Background and scope

Integrate the proven Runner/CLI boundary with canonical Attempts and two shared execution slots.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Runtime and host feasibility](../09-28-gate-runtime/prd.md)
- [Command and persistence foundation](../09-28-a-command-foundation/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

- [Runtime target selection and shared slots](../09-29-a-runtime-target-scheduling/prd.md)
- [Production Runner dispatch and execution logs](../09-29-a-runtime-runner-logs/prd.md)
- [Runtime Stop and restart reconciliation](../09-29-a-runtime-stop-recovery/prd.md)
- [Production Runtime integration acceptance](../09-29-a-runtime-integration-acceptance/prd.md)

The Runtime/host feasibility and command-foundation dependencies are complete. Implement and verify these leaves in order; the parent coordinates their combined acceptance.

## Acceptance criteria

- [x] Real Attempts, ordered log streaming, scoped commands and restart reconciliation use formal dispatch ownership.
- [x] Stop/freeze terminates descendants before slot/workspace reuse; missing complete_node does not report success; queued Planner work is visible.

Combined acceptance: [Runtime integration verification](../09-29-a-runtime-integration-acceptance/verification.md). It records current-source Node/Planner log trials, missing-outcome Stop, two-slot queue/reconnect/promotion, matched prior Stop/reboot evidence, 96 real PostgreSQL tests, Linux Go race/vet and final idle ownership audit. Full Stage A/V1 remains open.

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
