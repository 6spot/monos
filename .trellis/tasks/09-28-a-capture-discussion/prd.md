# Capture and Discussion

## Goal

Persist ideas and ordered Planner discussion, then confirm one exact independent
execution Task without starting execution.

## Completed scope

The Owner authorized sequential roadmap execution and routine implementation,
verification and test-host decisions without repeated approval. This work package
coordinates the four completed leaves below; it does not claim Task execution,
delivery or full Stage A/V1 acceptance.

Upstream Command/Persistence, Owner Configuration and Runtime Integration gates
were completed before these leaves. Formal Owner commands preserve immutable
capture, source order, exact confirmations and receipt recovery. Todo remains
independent of Task execution state.

## Completed child tasks

1. [Todo capture and lifecycle](../09-29-a-todo-capture/prd.md): model-free capture,
   organization and responsive Inbox workspace. Work commit `9c3ce55`.
2. [Ordered Todo Planner discussion](../09-29-a-todo-discussion/prd.md): Todo-scoped
   Attempts, ordered input, atomic reply/requirement state and Retry/Withdraw.
   Work commit `d623444`.
3. [Exact Task preview and creation](../09-29-a-task-preview/prd.md): exact Project
   confirmation, one independent PLANNING Task and recoverable preview/detail.
   Work commit `61f140b`.
4. [Integration acceptance](../09-29-a-capture-discussion-acceptance/prd.md): combined
   deterministic, browser and native evidence, distinct concurrent input regression
   and existing backend/Runner idle restart persistence.

## Acceptance criteria

- [x] Capture invokes no model; replies and requirement state commit atomically
  with ordered input handling.
- [x] Failed input can be retried or withdrawn, reconnect restores previews, and
  repeated exact preview confirmation creates one Task.

[Integrated verification](../09-29-a-capture-discussion-acceptance/verification.md)
maps every requirement to its test/native evidence and states each fixture boundary.
The final product baseline passed 151 local, 138 full PostgreSQL and 23 browser
cases plus Go checks. Integration added one real lock-contention database case
and passed 90 Python harness cases. Native ordered/retry/withdraw/preview trials
and backend/Runner restart checks preserve exact Task/Specification/24 Owner
receipts. Six native processes and two known children are absent, with zero queued,
writable/unreleased Attempts, unresolved inputs or unsettled operations. The
retained Task has one initial revision and zero Plan/Node/Attempt/Start.

## Evidence and remaining scope

Private host reports remain versioned on the authorized host. The integration
report retains both harness comparison failures, exact source hashes and the
verified continuation; failed reports were not overwritten. No extra model work
or permanent service was introduced by acceptance.

Task Start, Task Conversation, execution/revision/workspace behavior and delivery
belong to later work packages. Planner repository inspection remains explicitly
unavailable until Stage B. No team abstractions, generic workflow engine,
cross-Runner migration/failover, permanent disk-loss recovery, mandatory live
steering or native session resume were added. Bootstrap guidelines and unrelated
roadmap packages are not accepted by this report.

## Source contracts

- [Architecture](../../../../../ARCHITECTURE.md)
- [Implementation sequence](../../../../../docs/09-first-executable-slice.md)
- [Readiness gates](../../../../../docs/10-architecture-readiness.md)
- [Invariants](../../../../../docs/08-principles-and-non-goals.md)
- [Engineering specs](../../../../spec/index.md)
