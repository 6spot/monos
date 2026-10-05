# GitHub review and correction

## Goal

Expose the exact local result, prepare a controlled PR and complete Owner-approved delivery with correction and recovery.

## Planning status

Roadmap level: **work-package**. Coordinate independently verified leaves below; the parent is not a bulk implementation target. The user explicitly delegates successive planning, implementation and routine decisions without further permission requests.

## Background and scope

Expose the exact local result, prepare a controlled PR and complete Owner-approved delivery with correction and recovery.

Architecture modules remain authoritative. The existing boundary probe implements Stage A step 0 only; its local/host evidence does not establish the full Stage A or V1 gate. Reuse its code and tests after reviewing actual results instead of recreating the probe.

## Dependencies and order

- [Task conversation and single-Node execution](../archive/2026-10/09-28-a-task-execution/prd.md)
- [GitHub provider feasibility](../09-28-gate-github/prd.md)

The execution package was independently accepted and archived on 2026-10-03. GitHub child reports prove required-check enforcement, stale-SHA rejection and one-effect response-loss reconciliation on the authorized synthetic public repository ([head/check proof](../archive/2026-09/09-28-github-head-checks/research/verification.md), [uncertain outcome proof](../archive/2026-09/09-28-github-uncertain-effects/research/verification.md)); the feasibility parent remains administratively open. These bounded provider trials do not prove production delivery coordination.

These are completion/evidence gates, not automatic scheduler dependencies. Parent/child links express scope ownership only. Evidence inspection and planning may proceed earlier; implementation must resolve upstream failures first.

## Child tasks

Execute these leaves in order; later leaves remain backlog until their own source-backed planning and upstream acceptance:

1. [Exact local result review](../archive/2026-10/10-03-a-local-result-review/prd.md) — accepted 2026-10-03; immutable local reads, current/history, bounded outcomes and desktop/mobile evidence.
2. [Controlled publication candidate](../archive/2026-10/10-03-a-publication-candidate/prd.md) — accepted2026-10-04; exact-tree public-parent construction, range scans, immutable local receipts and native isolated permissions.
3. [Automatic review preparation](../archive/2026-10/10-03-a-remote-preparation/prd.md) — accepted2026-10-05, commit4b37552; stable GitHub preparation, original-effect recovery, protected UI and native/provider evidence.
4. [Exact Owner delivery acceptance](../10-03-a-owner-delivery/prd.md).
5. [Review correction and delivery recovery](../10-03-a-review-correction/prd.md).
6. [Review and delivery integration acceptance](../10-03-a-delivery-acceptance/prd.md).


## Stage A scope

Implement the module-09 single-repository automatic GitHub delivery loop. Keep collection-shaped identities and frozen-batch guards, but defer multi-repository partial delivery, plain-Git branch-only finalization and after-acceptance remote preparation to later V1 slices. Existing deferred-mode metadata must retain local result access without unauthorized remote writes. Package acceptance does not close those later V1 capabilities.

## Visual requirements

Review/diff, exact acceptance, correction and delivery recovery UI follow the [visual contract](../../spec/frontend/visual-design.md). Future frontend leaves load visual/component/quality specs in both implementation and check contexts.

## Acceptance criteria

- [ ] Review and recovery views pass the [visual quality gate](../../spec/frontend/quality-guidelines.md), including inspected desktop/mobile exact-result, failure and retryable states without changing delivery guards.

- [ ] Private ancestry is excluded; publication-range checks precede remote writes; local REVIEW remains accessible after provider failure.
- [ ] Request Changes reworks the same Node/PR with new evidence; exact-result acceptance uses expected-head merge.
- [ ] Later chat cannot block a frozen batch; Retry, Cancel, withdrawal and Replan dismissal follow owning guards.

## Out of scope

No team abstractions, generic workflow engine, cross-Runner migration/failover, permanent disk-loss recovery, mandatory live steering or native session resume. Do not alter the accepted architecture to bypass a failed feasibility gate. This task does not own unrelated roadmap packages or bootstrap-guidelines.

## Before implementation

Review upstream evidence and the current source, refine leaf boundaries and observable failure cases, and resolve any Owner-owned acceptance choices. For each complex implementation leaf, complete design.md, implement.md and curated implement/check contexts, present the final planning summary, and use the user's standing autonomous-execution authorization for task.py start. Stage and work-package records coordinate acceptance and are not bulk implementation targets.

## Source contracts

- [Architecture](../../../ARCHITECTURE.md)
- [Implementation sequence and acceptance matrices](../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../docs/10-architecture-readiness.md)
- [Invariants](../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../spec/index.md)
