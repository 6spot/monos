# Acceptance, Conversation and File Limits

Sources: [Workspace/delivery](../../../docs/04-workspace-and-git.md), [commands](../../../docs/05-tool-protocol.md), [atomic control](../../../docs/06-state-and-formal-data.md), [acceptance tests](../../../docs/09-first-executable-slice.md).

## 1. Scope / Trigger

Owner acceptance, Task messages, provider workers, explicit correction/cancellation, capture and pre-push validation.

## 2. Signatures

Canonical Task Conversation implements source-bound `commit_task_turn` and Owner
`submit_task_message`, Retry/Withdraw/Stop through the routes in
[Task Conversation](task-conversation.md). Canonical Node completion implements
`complete_node(summary, artifact_ids?, handled_guidance_ids?)`; source-aware local
pre-delivery Cancel is also implemented. Exact Owner Accept, accepted Retry/Cancel
and zero/one modified automatic GitHub finality follow [Owner delivery](owner-delivery.md).
Dedicated prepare/confirm/Accept receipts are enforced in SQL; confirmation alone
is not acceptance. Request Changes/revocation/restoration is the next slice.
Multi-repository/plain-Git/deferred-mode final delivery remains outside Stage A.

## 3. Contracts

Successful acceptance persists one delivery operation with its receipt, exact Specification/Plan/evidence/result, repository candidates/targets and input cutoff. Admission and message append serialize on Task control.

```text
message commits first -> ordinary pending input -> acceptance waits
acceptance commits first -> frozen batch -> later conversation is nonblocking
```

Later input retains message order and the accepted-operation attribution. Planner can answer/explain but cannot dispatch guidance, revise requirements or rework this batch. It may finish delivery before those replies. Further implementation after delivery requires a new Task through Todo Discussion; no automatic transfer/creation.

Workers check operation authority and exact item/result versions. An unrelated message/control-version increment must not invalidate them. Checks, push, merge, plain-Git verification, restart and partial-item Retry retain the same cutoff.

Explicit Request Changes may revoke a batch only while entirely undelivered and without unresolved merge outcome. Stop pending dispatch, reconcile admitted effects, then restore later unresolved requests to ordinary input handling without duplicating replies. Result/authorization drift requires reconciliation; replacement acceptance and restored input obligations are allowed only before any item finalizes. After partial delivery, recover the original accepted remainder where possible or cancel it; never accept a changed remainder or apply later requirements to this Task. Transient provider failure retains the batch. Cancel Task stays terminal.

Local capture hard limits protect reliable storage/processing. Publication limits apply to a finalized candidate. Keep limits separately named/configured; exact environment keys and values are chosen with implementation. Findings record measured size, limit, rule version and candidate identity. Provider hard limits are not overridable.

## 4. Validation & Error Matrix

| Input/state | Expected result |
| --- | --- |
| Pre-acceptance unresolved request | Reject acceptance with precondition |
| Later chat while CI/push/merge waits | Save/reply; accepted batch continues |
| Later chat during partial delivery | Unchanged remainder may continue/Retry |
| Plain-Git push succeeds | Preparation only until accepted publication is verified |
| Uncertain provider result | Reconcile; never duplicate or infer failure |
| Explicit correction after an item finalized | Reject in-place correction; finish/cancel remainder |
| Result/head changed | Old acceptance cannot authorize it |
| Capture cannot meet local hard limit | No Node completion; BLOCKED with recovery |
| Candidate exceeds publication limit only | REVIEW finding; no remote write |
| Provider hard-limit override requested | Reject override |

## 5. Good / Base / Bad Cases

Good: accept, receive another requirement, restart while CI waits; same result delivers and the later request gets an explanatory reply.
Base: accept unchanged completed output and deliver once.
Bad: a new status question changes global control version and silently cancels an approved merge.

## 6. Tests Required

Race acceptance/message both ways. Test later input before first write, during checks, between repositories, after failed push and while Planner is unavailable. Assert no stale authorization, no lost message and no false “implemented” disposition. Race explicit correction with finalization and reconcile unknown merges. Test cutoff persistence and result-drift revocation.

Capture fixtures must distinguish local hard limits from provider/policy publication limits. Assert preserved work, correct Node/Task state and no remote mutation. Test eligible override binding versus non-overridable provider constraints.

## 7. Wrong vs Correct

Wrong: `if (task.hasPendingMessages) pauseEveryDelivery()`.
Correct: classify under the acceptance transaction; only pre-acceptance obligations block admission. Accepted workers follow the frozen batch plus explicit authority/result/provider guards.

## Provider feasibility evidence

`infra/github/probe.py` verifies required commit-status enforcement and expected
SHA rejection on an explicitly authorized synthetic repository. Wait for current
head checks and clean mergeability before isolating the old-SHA guard: a transient
405 is not proof of SHA comparison. Observed old-SHA rejection is 409; required
pending/failure statuses return 405; successful exact-head merge returns 200.
Private branch protection can be unavailable by plan (403). Never infer required
check enforcement merely because setting a commit status succeeded.

`infra/github/uncertain.py` discards successful API replies, then resolves the PR
by exact repository/head/base/operation marker and confirms merged head/commit
through a fresh read. Missing or ambiguous lookup results remain unresolved,
without another create/merge. Tests assert one mutation each and reject changed
heads or ambiguous identities. This is application-response-loss evidence, not
TCP packet injection or the production delivery coordinator.
