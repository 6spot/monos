# Multiple repositories and delivery modes

## Goal

Support multiple repository items, plain-Git and after-acceptance delivery without pretending atomic publication.

## Completion status

Functionally complete on 2026-10-11 and archived at the Owner's request. Code is
committed and pushed on `feat/stage-a-boundary-probe`; no main-branch merge or
native V1 release acceptance is claimed. The Owner explicitly prioritized
functional development and deferred host/CLI/provider acceptance.

## Background and scope

Support multiple repository items, plain-Git and after-acceptance delivery without pretending atomic publication.

Architecture modules remain authoritative. Implemented product code, local Git/process checks and PostgreSQL evidence establish this functional package. Actual installed CLI/account/cgroup, provider and reboot acceptance remain with the open Stage A/V1 gates.

## Dependencies and order

- [Parallel Nodes and worktree integration](../09-28-b-parallel-workspaces/prd.md)

This records the original implementation order. Native upstream acceptance remains a separate open gate under the Owner’s feature-first instruction; parent/child links express scope ownership, not product scheduler dependencies.

## Acceptance criteria

- [x] Partial success retains finalized items and retries only the unchanged accepted remainder.
- [x] GitHub/plain-Git preparation and finalization stay distinct; no-change/non-Git acceptance needs no invented PR.
- [x] Later messages cannot stall the frozen batch; explicit correction and Cancel reconcile actual remote outcomes.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Implementation and evidence

Multi-repository completion and GitHub/plain HTTPS Git delivery retain exact accepted items. Partial outcomes remain visible; retry acts only on the unchanged accepted remainder. Repository-free/no-change results do not invent remote work, and late messages do not revise frozen delivery authority.

Commits: `bac64fa`, `d8f1530`, `499cf78`.

Owning regression evidence is recorded in these existing tests and the
[functional completion record](../../../../../docs/research/v1-functional-completion.md):

- [postgres-multi-repository-delivery.test.ts](../../../../../apps/server/test/postgres-multi-repository-delivery.test.ts)
- [postgres-plain-git-delivery.test.ts](../../../../../apps/server/test/postgres-plain-git-delivery.test.ts)
- [postgres-plain-git-delivery-sql.test.ts](../../../../../apps/server/test/postgres-plain-git-delivery-sql.test.ts)
- [postgres-multi-repository-result-reads.test.ts](../../../../../apps/server/test/postgres-multi-repository-result-reads.test.ts)

Reuse the passing scoped PostgreSQL, local Git, Runner and protocol/type/lint/build
evidence for unchanged code. This archive does not substitute local tests for
the deferred native acceptance matrix.

## Source contracts

- [Architecture](../../../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../../../docs/10-architecture-readiness.md)
- [Invariants](../../../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../../../spec/index.md)
