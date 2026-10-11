# Planner inspection and multi-Node Replan

## Goal

Extend planning with read-only repository inspection and atomic multi-Node graph publication.

## Completion status

Functionally complete on 2026-10-11 and archived at the Owner's request. Code is
committed and pushed on `feat/stage-a-boundary-probe`; no main-branch merge or
native V1 release acceptance is claimed. The Owner explicitly prioritized
functional development and deferred host/CLI/provider acceptance.

## Background and scope

Extend planning with read-only repository inspection and atomic multi-Node graph publication.

Architecture modules remain authoritative. Implemented product code, local Git/process checks and PostgreSQL evidence establish this functional package. Actual installed CLI/account/cgroup, provider and reboot acceptance remain with the open Stage A/V1 gates.

## Dependencies and order

- [Serial Nodes and Rework invalidation](../09-28-b-serial-graphs/prd.md)

This records the original implementation order. Native upstream acceptance remains a separate open gate under the Owner’s feature-first instruction; parent/child links express scope ownership, not product scheduler dependencies.

## Acceptance criteria

- [x] Planner inspection cannot modify repositories.
- [x] Retained/replaced Nodes, pending revisions and interrupted private work reconcile before graph publication; dismissal preserves originating feedback.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Implementation and evidence

Planner inspection uses independently retained read-only snapshots. Multi-Node Replan settles old physical ownership before atomic graph publication, preserves dismissal feedback, and carries exact retained results. Unchanged-graph multi-Node Specification revisions and explicit Artifact consumption are implemented.

Commits: `1e3e727`, `71e0222`, `499cf78`.

Owning regression evidence is recorded in these existing tests and the
[functional completion record](../../../../../docs/research/v1-functional-completion.md):

- [postgres-repository-inspection.test.ts](../../../../../apps/server/test/postgres-repository-inspection.test.ts)
- [postgres-task-replan-multi-node.test.ts](../../../../../apps/server/test/postgres-task-replan-multi-node.test.ts)
- [postgres-task-replan-multi-workspaces.test.ts](../../../../../apps/server/test/postgres-task-replan-multi-workspaces.test.ts)
- [postgres-multi-node-specification.test.ts](../../../../../apps/server/test/postgres-multi-node-specification.test.ts)

Reuse the passing scoped PostgreSQL, local Git, Runner and protocol/type/lint/build
evidence for unchanged code. This archive does not substitute local tests for
the deferred native acceptance matrix.

## Source contracts

- [Architecture](../../../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../../../docs/10-architecture-readiness.md)
- [Invariants](../../../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../../../spec/index.md)
