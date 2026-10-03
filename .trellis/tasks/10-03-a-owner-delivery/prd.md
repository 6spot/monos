# Exact Owner delivery acceptance

## Goal

Freeze exact Owner-approved delivery batches and finalize expected-head GitHub or verified plain-Git delivery.

## Planning status

Backlog leaf; refine source-backed design, execution checklist and contexts before implementation. The user delegates successive task execution and routine decisions autonomously.

## Dependencies and order

- [10-03-a-remote-preparation](../10-03-a-remote-preparation/prd.md).

## Requirements

- Owner acceptance binds effective Spec/Plan/evidence, every exact source result/candidate/parents/target and atomically freezes a delivery operation plus input cutoff.
- Serialize input and acceptance; earlier unresolved input blocks admission, later chat remains durable and nonblocking through checks, restart, failure and Retry.
- Stage A GitHub finalization requires applicable checks, current mergeability and expected-head merge. Preserve provider-neutral exact candidate/result contracts; plain-Git final delivery remains a later V1 leaf.
- Retain collection-shaped exact acceptance data while explicitly limiting Stage A delivery to one modified GitHub repository. Reject unsupported multi-repository finalization without remote writes; complete Task only after the supported item finalizes.

## Acceptance Criteria

- [ ] Acceptance/message races in both orders preserve one frozen result and correct input attribution.
- [ ] Changed head cannot inherit approval; uncertain merge reconciles remote truth without duplicate mutation.
- [ ] Failed/retry outcomes preserve accepted identity; later chat cannot stall approved delivery.

## Scope boundary

Implement this leaf only after its upstream evidence is accepted. Preserve [architecture](../../../ARCHITECTURE.md) and [invariants](../../../docs/08-principles-and-non-goals.md); no generic workflow engine, new Git Task states, team abstraction, remote source push, distributed workspace transfer or permanent disk-loss recovery.

## Deferred V1 behavior

Multi-repository partial delivery, plain-Git branch-only finalization and after-acceptance remote preparation belong to later slices under module 04. This Stage A leaf must expose unsupported modes honestly and preserve their contract seams without claiming them implemented.
