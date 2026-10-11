# Serial Nodes and Rework invalidation

## Goal

Execute serial dependencies using current completion evidence and scoped Rework invalidation.

## Completion status

Functionally complete on 2026-10-11 and archived at the Owner's request. Code is
committed and pushed on `feat/stage-a-boundary-probe`; no main-branch merge or
native V1 release acceptance is claimed. The Owner explicitly prioritized
functional development and deferred host/CLI/provider acceptance.

## Background and scope

Execute serial dependencies using current completion evidence and scoped Rework invalidation.

Architecture modules remain authoritative. Implemented product code, local Git/process checks and PostgreSQL evidence establish this functional package. Actual installed CLI/account/cgroup, provider and reboot acceptance remain with the open Stage A/V1 gates.

## Dependencies and order

- [Second Runtime and ordered fallback](../../../09-28-b-runtime-fallback/prd.md)

This records the original implementation order. Native upstream acceptance remains a separate open gate under the Owner’s feature-first instruction; parent/child links express scope ownership, not product scheduler dependencies.

## Acceptance criteria

- [x] Dependencies unlock only from valid activations in the effective graph.
- [x] Upstream Rework invalidates affected descendants, preserves unrelated work and retained code/history.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Implementation and evidence

Dependency admission and exact workspace handoff use current completion evidence. Rework preserves private/history data and invalidates only affected descendants. Artifact consumption and complete upstream multi-repository context were finished in 499cf78.

Commits: `47a79e2`, `4413c39`, `499cf78`.

Owning regression evidence is recorded in these existing tests and the
[functional completion record](../../../../../docs/research/v1-functional-completion.md):

- [postgres-serial-nodes.test.ts](../../../../../apps/server/test/postgres-serial-nodes.test.ts)
- [postgres-serial-workspaces.test.ts](../../../../../apps/server/test/postgres-serial-workspaces.test.ts)
- [postgres-node-rework.test.ts](../../../../../apps/server/test/postgres-node-rework.test.ts)
- [postgres-node-rework-guards.test.ts](../../../../../apps/server/test/postgres-node-rework-guards.test.ts)
- [postgres-node-consumes.test.ts](../../../../../apps/server/test/postgres-node-consumes.test.ts)

Reuse the passing scoped PostgreSQL, local Git, Runner and protocol/type/lint/build
evidence for unchanged code. This archive does not substitute local tests for
the deferred native acceptance matrix.

## Source contracts

- [Architecture](../../../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../../../docs/10-architecture-readiness.md)
- [Invariants](../../../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../../../spec/index.md)
