# monos delivery task map

Approved structure: stage → work package → implementation subtask. All newly created records are planning backlog, not approved implementation plans.

## Sequencing

Feasibility gates → Stage A product loop → Stage B capabilities → single-host V1 release. Existing probe evidence is reused; no Stage A/V1 completion is inferred from scaffolding.

## Task tree

- [Stage 0: Feasibility gates](prd.md)
  - [Runtime and host feasibility](../archive/2026-09/09-28-gate-runtime/prd.md)
    - [Existing boundary feasibility probe](../archive/2026-09/09-28-stage-a-boundary-probe/prd.md) — in progress; unchanged scope.
  - [PostgreSQL concurrency feasibility](../09-28-gate-postgres/prd.md)
    - [Verify cross-worker claims and capacity](../archive/2026-09/09-28-pg-claim-capacity/prd.md)
    - [Verify atomic receipts and effect recovery](../archive/2026-09/09-28-pg-transaction-recovery/prd.md)
  - [GitHub provider feasibility](../09-28-gate-github/prd.md)
    - [Verify GitHub checks and exact-head merge](../archive/2026-09/09-28-github-head-checks/prd.md)
    - [Verify uncertain GitHub create and merge recovery](../archive/2026-09/09-28-github-uncertain-effects/prd.md)
- [Stage A: Single-Node product loop](../09-28-stage-a-product-loop/prd.md)
  - [Command and persistence foundation](../archive/2026-09/09-28-a-command-foundation/prd.md)
    - [Formal command scopes and receipts](../archive/2026-09/09-28-command-scopes-receipts/prd.md)
    - [Task control and revision records](../archive/2026-09/09-28-task-control-records/prd.md)
    - [Durable dispatch and event ingestion](../archive/2026-09/09-28-durable-dispatch-events/prd.md)
    - [Rebuildable reads and reconnect cursors](../archive/2026-09/09-28-read-projections-cursors/prd.md)
  - [Owner access and minimum configuration](../archive/2026-09/09-28-a-owner-configuration/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Capture and Discussion](../archive/2026-09/09-28-a-capture-discussion/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Production Runtime integration](../archive/2026-09/09-28-a-runtime-integration/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Task conversation and single-Node execution](../archive/2026-10/09-28-a-task-execution/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [GitHub review and correction](../09-28-a-review-delivery/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Stage A integrated acceptance](../09-28-a-integration-acceptance/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
- [Stage B: Remaining V1 execution capabilities](../09-28-stage-b-v1-capabilities/prd.md)
  - [Second Runtime and ordered fallback](../09-28-b-runtime-fallback/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Serial Nodes and Rework invalidation](../09-28-b-serial-graphs/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Planner inspection and multi-Node Replan](../09-28-b-planner-replan/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Parallel Nodes and worktree integration](../09-28-b-parallel-workspaces/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Multiple repositories and delivery modes](../09-28-b-delivery-modes/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
- [V1: Single-host release](../09-28-stage-v1-release/prd.md)
  - [Installation, settings and operations](../09-28-v1-install-operations/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.
  - [Single-host release acceptance](../09-28-v1-release-evidence/prd.md)
    - Decompose after upstream evidence; this package is not an implementation leaf.

## Task sizing and closure

- Stage: milestone and cross-package acceptance; never one bulk implementation assignment.
- Work package: bounded functional outcome, child map and integration acceptance.
- Subtask: one independently reviewable behavior including its necessary failure/recovery tests; may cross schema, backend and UI layers.
- Keep atomic publication and transaction contracts together. Split a leaf when it introduces independently deliverable behaviors or unrelated recovery mechanisms.
- Archive leaves after their evidence and review pass; close packages/stages only after their own integration criteria pass.
- Near-term PostgreSQL, GitHub and command foundation leaves are seeded now. Later packages intentionally await evidence before detailed design and child creation.
- Parent links do not encode execution order: each PRD records upstream gates.
- bootstrap-guidelines remains open and outside this tree. Implementation leaves should update specs with real source/test references as patterns become established; do not mark its examples requirement complete preemptively.

## Coverage

Stage A maps to module-09 steps 1–6 through command foundation, configuration, Discussion, Runtime integration, Task execution, review/correction and integrated acceptance. Stage B maps to second Runtime, serial Nodes, inspection/Replan, parallel worktrees and delivery modes. Release maps to first-run operations and the complete single-host matrix. This index does not supersede module-09 acceptance cases.
