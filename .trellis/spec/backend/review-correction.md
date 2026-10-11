# Review correction authority and recovery

## 1. Scope / Trigger

`task-review-{basis,commands,state,sources,reads,coordinator}.ts`,
`owner-review-control.ts`, migration `0025_review_correction.sql` and the protected
Task UI implement explicit correction. Read [Owner delivery](owner-delivery.md),
[Replan](task-replan.md), [requirements](task-specification.md) and
[Conversation](task-conversation.md). Serial multi-Node review uses the same canonical
result collection and zero/one modified automatic GitHub repository; no new Task
state or provider method is introduced.

## 2. Signatures

```text
POST /v1/owner/tasks/review/commands
GET /v1/owner/tasks/:task_id/review?feedback_cursor=...&input_cursor=...
GET /v1/owner/tasks/:task_id/review/feedback/:feedback_id?decision_cursor=...
GET /v1/owner/tasks/:task_id/review/operations/:operation_id
GET /v1/owner/tasks/:task_id/review/commands/:request_id
TaskReviewCommands(db, hooks).command(token, OwnerReviewCommand)
TaskReviewCoordinator(db, backendInstance, hooks).pump(limit = 8)
canonicalReviewManifest(tx, taskId); reviewBasis(tx, taskId)
```

`OwnerReviewCommand` strictly binds schema 1, Task, request, name and payload.
Request Changes carries client-retained `feedback_id,text,basis,accepted_batch?`.
Basis is `{control_version,specification_id,plan_id,review_result_digest}`. An active
acceptance requires its exact `{operation_id,content_digest,expected_version}`;
an unaccepted Task forbids that binding. Retry/Withdrawal name exact feedback,
operation and expected version. Input variants additionally name reconsideration.
An issue Retry pairs its actual `issue_id` with the retained Owner answer.

Agent tools: source-bound `apply_review_rework`, `commit_review_feedback`,
`resolve_review_input`, `raise_planning_issue`; main-feedback `request_replan`
retains its reason-only payload and exact launch authority. Reconsideration sources
must use `resolve_review_input` with `routing.kind=replan`, exact current basis and
text reason; generic `request_replan` is denied in backend and Runner. This atomically
records/transfers the input obligation and supports an immutable Dismiss successor.
`prepare_specification_revision`
is nonterminal. Context/history reads are scoped; Stage A repository inspection,
writable workspace, Node completion and Agent requirement application are denied.

## 3. Contracts

### Canonical result and recorded Owner authority

Local review identity shares complete output enumeration with acceptance: actual
Spec/Plan digests, every effective completion, distinct selected exact Artifact
metadata, original Git source and effective applicability. Permission, scan,
readiness, control counters and observation times do not enter its result digest.
Delivery blockers cannot block requesting correction of this local result.

Feedback, receipts, revocation, semantic resolutions and original input attribution
are retained. Actual SQL authority binds Owner envelopes/results and Agent
source/Attempt receipts. NULL/missing JSON fails closed. A receipt-backed revocation
alone may clear the matching Task acceptance pair to NULL/NULL. Never reinstall a
revoked batch or inherit its approval; a fresh result requires fresh confirmation.

### Original effects and scheduling

Discover and lock sorted Runners before Task; revalidate discovery. Any Task item
finality forbids correction. Possible/unknown merge must settle first. A `failed`
projection alone is insufficient: actual definitive rejected result, digest and
original observation plus ended claim establish settlement.

Revoke pending preparation/merge and old ordinary dispatch. Original admitted
push/PR effects retain their identity and reconcile read-only. Preserve public
branch/PR; correction never calls `requestRemoteCancel`. Repeat guards after token
I/O. Historical accepted preparation links remain permanently fenced when the
pointer clears, feedback is withdrawn or another batch is accepted.

Fresh preparation IDs may replace genuinely revoked no-effect identities. Sent
pregrant push journals retain the original no-effect result through an immutable
observation/ACK recovery path. Successor dispatch waits for that retained result;
the Go journal independently requires actual original ACK. See
[remote preparation](remote-preparation.md) for the exact recovery contract.

Old Conversation sources are fenced and stopped without cancelling independent
guidance/requirements, resetting inputs or advancing watermarks. Actual physical
release and original effect settlement precede a new review source. Append-only
revocation settlement records that fact; later new work cannot make it regress.

`TaskReviewSource` has exclusive source/feedback/operation/version, Spec/Plan,
control, result/context digests and purpose. It uses `planner:<task>`, zero transport
watermark/activation, empty reservations and scratch. Retry retains unresolved
operation ID, increments capability version and retains immutable source ancestry.
Missing formal outcome is failure; process launch/exit/prose never resolves feedback.

### Semantic outcomes and preserved obligations

Main routing stays REVIEW until a real outcome. Sufficient Rework names a nonempty
subset of current Nodes; the program invalidates that subset and its descendants
after settlement, retaining unrelated current results and all historical evidence.
The resolution retains exact requested `node_ids` and records the full sorted
`affected_node_ids`; downstream correction context uses the latter. Task/Node/code/
public lineage remains intact. Its own feedback/source is excluded from Rework preconditions; independent
Stop/input/requirement/issue holds remain. Node promotion distinguishes guidance
assigned for that Node to execute from unresolved classification/control guards.

The subsequent Node source freezes `review_rework`: original Owner feedback text
and basis, Planner routing reason, feedback/operation/source/Attempt/request IDs,
and the selected Node/activation. Read the immutable resolved Rework whose exact
Spec/Plan and target Node match; the frozen reviewed output activation plus one
must equal the new activation. This retains context on same-activation Retry and
excludes unrelated feedback and earlier corrections from later activations. Keep
feedback distinct from Task guidance and the Specification. Existing source prompt,
digest and byte-budget guards apply; never refresh already-frozen sources.

Single-Node graph insufficiency creates a genuine review-origin Replan, with no fabricated
Node/input. Dismiss creates a new routing operation linked to the immutable
predecessor and actual Owner direction. Its own control bump, a fresh source or
Retry without a new answer does not permit same-feedback/Spec/Plan/result automatic
repetition. This history survives requirement transfer/Withdrawal. A later actual
recorded issue Answer & Retry can supply new Owner direction; control changes,
fresh sources and requirement Withdrawal alone cannot.
Dismissal and feedback Withdrawal remain separate exits.

Changed scope creates a complete actual review-origin requirement proposal and
independent exact Owner confirmation. A reconsideration proposal cannot publish
while main feedback is unresolved. Main feedback explicitly adopts its exact
same-feedback/basis proposal through retained frozen resolution/proposal lineage;
its guard transfers to the requirement obligation before publication. No silent
basis refresh or inherited approval. An unpublished/withdrawn proposal must retain
an explicit feedback exit or successor.

### Immutable input reconsideration and terminal truth

Revocation appends reconsiderations for nonwithdrawn post-cutoff messages, preserving
input/batch/message/sequence, original reply and resolution. Route in original order
before main feedback under the shared Planner owner. Both pending/failed and replied
inputs gain a fresh semantic decision; neither appends a second reply nor resets
original turn history. A guard transfers only to an actual successor obligation.
Replan dismissal retains an exact input successor without rewriting a terminal
reconsideration. No-work resolution never withdraws the main feedback.

Cancel retains CANCELLED and uses original reconciliation/cleanup. Unknown merge
prevents PR close; later verified finality is retained and never revives the Task.
Delivery item `reconciliation` distinguishes original merge/preparation waiting,
pending close, actual closure/external merge and attention from terminal status.
Both ordinary `cancel_task` paths and accepted-delivery Cancel explicitly fence
review sources and cancel unresolved feedback/reconsideration operations; actual
source Stop/process settlement remains visible after the logical cancellation.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Malformed/oversized Unicode, foreign variant | `invalid_input`; no clipping |
| Stale local result, batch or capability | `version_conflict`; no silent refresh |
| Cross-Task/source/purpose/proposal | `denied_scope`; no successor or publication |
| Finality, uncertain merge or independent work | `unmet_precondition`; preserve truth |
| Same request with different content | `payload_conflict`; retain original receipt |
| Withdrawal during live source | Fence immediately; retain Stop/process capacity |
| Direct unbacked pointer clear/reinstallation | Atomic SQL rejection |
| Original credential callback after revocation | Deny new mutation; retain original effect |

Review reads/Owner commands enforce 512 KiB encoded UTF-8 and well-formed Unicode;
feedback text has a 64 KiB raw-byte bound. Lists return at most 64 summaries with
canonical Task/kind/time/ID cursors and conditional next fields. Details are selected
authenticated no-store/nosniff reads; summaries contain no full manifest.

## 5. Good / Base / Bad Cases

Good: revoke before merge, settle the original push, reinterpret later input and
route the same Task to sufficient Rework with a fresh exact acceptance.
Base: unaccepted local review can request changes despite unavailable delivery.
Bad: reset replied input, reopen shipped work, reuse revoked approval, or silently
publish a reconsideration proposal while main feedback guards the old review.

## 6. Tests Required

Use [verification scope](../guides/verification-scope.md). Actual PG commands prove
receipt/SQL authority, source/exit ordering, requirement adoption/publication,
late-input provenance, both observed lock winners, held grants and original-effect
settlement. Fake provider/absence fixtures prove deterministic DB boundaries only.
Strict TS/Go shared contracts, attributed immutable CLI journal and finite original
Stop recovery prove new source grants. Protected HTTP/session/journal and current
built Web prove distinct exits and representative desktop/mobile presentation.
Reuse unchanged native/provider evidence; installed new-source/native/App delivery
claims require actual installed checks at the combined gate.

## 7. Wrong vs Correct

```text
Wrong: clear acceptance -> old linked operation falls back to ordinary authority
       -> duplicate reply -> publish changed scope under old approval
Correct: exact Owner revocation -> original settlement -> immutable reconsideration
         -> source-bound semantic outcome -> actual successor and exact approval
```

Multi-Node Specification/Replan mutation remains explicitly unavailable in this
increment. Reject it before creating a request, freeze or operation. Ordinary
Conversation/Review reads include the complete bounded graph and stay available.
