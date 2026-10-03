# Automatic review preparation

## Goal

Prepare and reconcile the same delivery branch and GitHub PR under exact result and input guards.

## Planning status

Backlog leaf; refine source-backed design, execution checklist and contexts before implementation. The user delegates successive task execution and routine decisions autonomously.

## Dependencies and order

- [10-03-a-publication-candidate](../10-03-a-publication-candidate/prd.md).

## Requirements

- Automatic mode prepares, scans, fast-forward pushes and creates/updates a single identified review request when entering REVIEW; no Owner Prepare PR action.
- Pending pre-acceptance input and correction guards prevent remote preparation. Stage A implements automatic GitHub preparation; existing after-acceptance resource metadata remains local-only and must not accidentally trigger remote writes. Full deferred preparation belongs to later V1 work.
- Persist deterministic delivery identities, exact result authorization and progress outside Task lifecycle states. Reconcile uncertain push/create/update before retrying.
- Keep Task title/completion summary/reference-derived PR content current; show exact-head checks and mergeability, failures and scoped Retry while local results remain readable.

## Acceptance Criteria

- [ ] Native authorized repository preparation yields one branch/PR and no private ancestry or force push.
- [ ] Response loss and restart reconcile the same remote effect without duplicate PR creation.
- [ ] Changed authorization/result or missing credentials stops remote mutation with truthful local REVIEW and recovery UI.

## Scope boundary

Implement this leaf only after its upstream evidence is accepted. Preserve [architecture](../../../ARCHITECTURE.md) and [invariants](../../../docs/08-principles-and-non-goals.md); no generic workflow engine, new Git Task states, team abstraction, remote source push, distributed workspace transfer or permanent disk-loss recovery.
