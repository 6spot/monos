# Stage A: Single-Node product loop

## Goal

Deliver the complete capture-to-reviewed-delivery loop with one Runner, repository and Node.

## Planning status

Roadmap level: **stage**. Status: **planning / backlog**, not implementation-ready. The Owner approved the three-level roadmap structure on 2026-09-28. This PRD records scope and acceptance, not approval to start implementation.

## Background and scope

Deliver the complete capture-to-reviewed-delivery loop with one Runner, repository and Node.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Stage 0: Feasibility gates](../09-28-stage-0-feasibility/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

- [Command and persistence foundation](../09-28-a-command-foundation/prd.md)
- [Owner access and minimum configuration](../09-28-a-owner-configuration/prd.md)
- [Capture and Discussion](../09-28-a-capture-discussion/prd.md)
- [Production Runtime integration](../archive/2026-09/09-28-a-runtime-integration/prd.md)
- [Task conversation and single-Node execution](../09-28-a-task-execution/prd.md)
- [GitHub review and correction](../09-28-a-review-delivery/prd.md)
- [Stage A integrated acceptance](../09-28-a-integration-acceptance/prd.md)

## Acceptance criteria

- [ ] All Stage A acceptance and conversation-closure cases in module 09 have recorded outcomes.
- [ ] Browser closure, retries and service restarts preserve execution and delivery lineage.

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
