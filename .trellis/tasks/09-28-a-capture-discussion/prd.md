# Capture and Discussion

## Goal

Persist ideas and ordered Planner discussion, then confirm a stable execution Task.

## Planning status

Roadmap level: **work-package**. Status: **planning / backlog**, not implementation-ready. The Owner approved the three-level roadmap structure on 2026-09-28. This PRD records scope and acceptance, not approval to start implementation.

## Background and scope

Persist ideas and ordered Planner discussion, then confirm a stable execution Task.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Command and persistence foundation](../archive/2026-09/09-28-a-command-foundation/prd.md)
- [Owner access and minimum configuration](../archive/2026-09/09-28-a-owner-configuration/prd.md)
- [Production Runtime integration](../archive/2026-09/09-28-a-runtime-integration/prd.md)

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Execute these independently verifiable leaves in order after Runtime integration acceptance:

1. [Todo capture and lifecycle](../archive/2026-09/09-29-a-todo-capture/prd.md): model-free capture, organization and Inbox workspace.
2. [Ordered Todo Planner discussion](../archive/2026-09/09-29-a-todo-discussion/prd.md): Todo-scoped Attempts, ordered input, atomic replies/requirement state and recovery.
3. [Exact Task preview and creation](../09-29-a-task-preview/prd.md): structured previews, exact Owner confirmation and independent Task creation.
4. [Capture and Discussion integration acceptance](../09-29-a-capture-discussion-acceptance/prd.md): combined real-service and browser acceptance.

On 2026-09-29 the Owner authorized sequential roadmap execution and delegated routine planning, implementation and testing decisions without repeated approval prompts. This parent remains an acceptance coordinator, not a bulk implementation assignment.

## Acceptance criteria

- [ ] Capture invokes no model; replies and requirement state commit atomically with ordered input handling.
- [ ] Failed input can be retried or withdrawn, reconnect restores previews, and repeated exact preview confirmation creates one Task.

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
