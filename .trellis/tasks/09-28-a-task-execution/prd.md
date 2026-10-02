# Task conversation and single-Node execution

## Goal

Deliver one-Node planning, Task conversation, revision settlement and recoverable workspace completion.

## Planning status

Roadmap level: **work-package**. Status: **decomposed**, with independently planned leaves. The Owner approved the three-level roadmap structure on 2026-09-28. This PRD records scope and acceptance, not approval to start implementation.

## Background and scope

Deliver one-Node planning, Task conversation, revision settlement and recoverable workspace completion.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Capture and Discussion](../archive/2026-09/09-28-a-capture-discussion/prd.md)
- [Production Runtime integration](../archive/2026-09/09-28-a-runtime-integration/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Execute in order; each leaf has an independent API/Runner or browser acceptance:

1. [Authorized Project repositories and serial Task workspaces](../archive/2026-09/09-30-a-serial-workspaces/prd.md).
2. [Explicit Task Start and initial planning](../archive/2026-09/09-30-a-task-start-planning/prd.md).
3. [Single-Node execution, artifacts and recovery](../archive/2026-09/09-30-a-node-execution/prd.md).
4. [Ordered Task Conversation and guidance](../archive/2026-09/09-30-a-task-conversation/prd.md).
5. [Exact Specification changes and settlement](../archive/2026-10/09-30-a-specification-changes/prd.md).
6. [One-Node replacement Plan and Replan exits](../09-30-a-single-node-replan/prd.md).
7. [Execution Board and Task control UI](../09-30-a-execution-ui/prd.md).
8. [Task execution integration acceptance](../09-30-a-task-execution-acceptance/prd.md).

The Owner authorized routine planning, implementation, testing and task transitions
without repeated approval. This parent coordinates acceptance, not bulk code edits.
Research: [decomposition](research/decomposition.md) and [workspace design](research/workspace-design.md).

## Visual requirements

Require the [visual contract](../../spec/frontend/visual-design.md) across execution UI and its integration with existing Todo/preview surfaces. Track the separately planned [existing-screen migration](../archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md) as an integrated visual evidence dependency; backend leaves remain independently verifiable.

## Acceptance criteria

- [ ] Shared shell and Todo→Task→local REVIEW presentation pass the [visual quality gate](../../spec/frontend/quality-guidelines.md) using both existing-screen migration and new execution UI evidence; standards documentation alone does not close this criterion.

- [ ] Ordered Task input and Planner routing distinguish replies, guidance and authorized requirement revisions.
- [ ] One-Node initial/replacement Plans, lazy workspace opening and recoverable Git completion preserve Task identity and produce REVIEW.
- [ ] Withdrawal, stale proposals and controlled Stop/Continue preserve writer and evidence guards.

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
