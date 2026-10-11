# Parallel Nodes and worktree integration

## Goal

Execute concurrent Nodes on isolated worktrees with serialized recoverable integration.

## Completion status

Functionally complete on 2026-10-11 and archived at the Owner's request. Code is
committed and pushed on `feat/stage-a-boundary-probe`; no main-branch merge or
native V1 release acceptance is claimed. The Owner explicitly prioritized
functional development and deferred host/CLI/provider acceptance.

## Background and scope

Execute concurrent Nodes on isolated worktrees with serialized recoverable integration.

Architecture modules remain authoritative. Implemented product code, local Git/process checks and PostgreSQL evidence establish this functional package. Actual installed CLI/account/cgroup, provider and reboot acceptance remain with the open Stage A/V1 gates.

## Dependencies and order

- [Planner inspection and multi-Node Replan](../09-28-b-planner-replan/prd.md)

This records the original implementation order. Native upstream acceptance remains a separate open gate under the Owner’s feature-first instruction; parent/child links express scope ownership, not product scheduler dependencies.

## Acceptance criteria

- [x] Concurrent Nodes cannot write each other’s private worktrees; integration has one physical owner.
- [x] Conflicts route to correction and combined-result evidence binds the actual integrated revision.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Implementation and evidence

Parallel Nodes use distinct owned worktree allocations. Integration serializes physical publication, preserves exact Node and combined Task result provenance, and routes conflicts through correction without losing private work.

Commits: `130eec1`, `499cf78`.

Owning regression evidence is recorded in these existing tests and the
[functional completion record](../../../../../docs/research/v1-functional-completion.md):

- [postgres-parallel-workspaces.test.ts](../../../../../apps/server/test/postgres-parallel-workspaces.test.ts)
- [postgres-parallel-integration.test.ts](../../../../../apps/server/test/postgres-parallel-integration.test.ts)
- [postgres-parallel-replan.test.ts](../../../../../apps/server/test/postgres-parallel-replan.test.ts)
- [workspace_integration_test.go](../../../../../runner/internal/host/workspace_integration_test.go)

Reuse the passing scoped PostgreSQL, local Git, Runner and protocol/type/lint/build
evidence for unchanged code. This archive does not substitute local tests for
the deferred native acceptance matrix.

## Source contracts

- [Architecture](../../../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../../../docs/10-architecture-readiness.md)
- [Invariants](../../../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../../../spec/index.md)
