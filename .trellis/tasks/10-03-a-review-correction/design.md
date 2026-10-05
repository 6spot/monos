# Review correction design

## Architecture and scope

Semantic decisions remain with the existing Task Planner. Program owns exact Owner
commands, SQL authority, source scheduling, effect settlement, Node invalidation,
Replan/requirement publication and read projections. No new Task state or framework.
Current Stage A is one Node and zero/one modified automatic GitHub repository.

Upstream delivery is committed at `c0212a9`; its adapter, expected-head merge,
readiness methods and original mutation recovery are retained. This leaf extends
review control, canonical Planner source and explicit exits, not provider methods.

## Review identity and Owner command contract

Request Changes uses server-authored local review identity independent of Accept
eligibility. Enumerate complete current Plan membership, canonical completions,
selected immutable ArtifactMetadata, Git source/tree and original/effective evidence.
Reuse canonical result enumeration from acceptance through a small shared owning
helper. Neither provider grants, scan readiness nor a successful PR is required.
The semantic result digest excludes unrelated observation times and event counters;
current execution basis is separately bound in the Owner payload.
`TaskReviewBasis` is `{control_version,specification_id,plan_id,
review_result_digest}` with a nonnull Plan. The client creates feedback_id once
before journaling; the actual committed receipt must retain that same ID.

Proposed single family: `OwnerReviewCommand`, exact `{schema_version,request_id,
task_id,name,payload}` and action-specific committed/unknown receipts. Request
Changes binds `{feedback_id,text,basis,accepted_batch?}`; accepted_batch binds
operation_id/content_digest/expected_version and is required iff a pointer is current.
Retry/Withdraw bind exact feedback routing operation and capability version, with
optional exact issue/answer for Retry. Existing Owner session/Origin/no-store and
request journal behavior apply. The sole schema writer freezes final strict shapes,
collection/encoded bounds and generated consumers before dependent implementation.

## Durable authority and effect boundary

Migration 25 is additive; migrations 19/24 and retained checksums remain unchanged.
Use immutable feedback, Owner decisions/command receipts, revocations and terminal
semantic resolutions; durable versioned routing operation/source generations;
explicit input reconsideration applicability. Task-scoped FKs and deferred SQL
validators bind actual envelopes/results, basis, source/Attempt and predecessor.

Sorted Runner locks precede Task, then batch and stable item/resource locks; recheck
discovery before writes. Request Changes checks exact local review and optional
active accepted batch. Any historical item finality for the Task or unresolved
possible merge rejects atomically. Pending never-started merge/preparation may be
revoked. Held credential preflight must fail repeated current-authority checks.

A real receipt-backed revocation adds batch `revoked` status, updates the live-batch
index, clears only the matching Task acceptance pair and increments capability once.
The pointer trigger permits this one exact NULL/NULL transition with complete actual
revocation authority; direct replacement or unbacked clear still fails. Original
approval, manifest, members, cutoff and input attribution remain immutable.

Do not set remote item cancel_requested for correction. Retain original admitted
push/PR operations, possible-effect marker, worker absence and exact observations.
Settle them read-only under the original identity before routing/Rework. No provider
I/O inside a transaction. Uncertainty remains attention, never guessed absence.

Every retained accepted preparation link must validate current unrevoked batch for
new mutation, including when the Task pointer is absent. Old IDs cannot fall back
to ordinary authority after Withdrawal or a later Accept. Newly admitted operation
IDs may reuse an unchanged candidate only under fresh current ordinary authority.
Worker catch/final callbacks cannot overwrite revoked status or revive stale claims.

## Routing, scheduling and independent guards

Dedicated `TaskReviewSource` uses existing `planner:<task>` ownership, Runtime
selection, DispatchQueue, empty resource reservations and repository-free scratch.
Exact source/context/Spec/Plan/control and operation generation are exclusive from
Todo, initial planning, Conversation, Node and Replan sources. Tool/CLI allowlists
admit only that phase's source-bound formal actions; unknown/foreign sources fail.
Queued/failed/issue feedback remains REVIEW. Real graph insufficiency alone enters
REPLAN_REQUIRED.

Within-Specification Rework invokes existing descendant invalidation/reactivation,
retains Task/Node/code/public lineage and requires settled old processes/effects.
Changed scope invokes existing complete Specification proposal and exact Owner
confirmation, with a genuine feedback obligation origin. Replan extends the current
request origin with actual review/routing identity; never fabricate a Node/input.
Clarification retains a source-bound issue and exact Answer & Retry.

Common task input/preparation/acceptance/dispatch guards include unresolved feedback,
revocation settlement and input reconsiderations. Each formal successor owns its
specific guard. A sufficient correction must not drop other input/requirement/Stop
controls. New Node dispatch waits for all ordinary obligations to settle even when
feedback routing has already made a valid Rework decision.

## Immutable late-input reconsideration

Clearing the Task pointer alone cannot restore immutable input applicability.
Append revocation-scoped entries for non-withdrawn post-cutoff messages, retaining
original input/message/batch/reply/sequence. Old reply-only Planner ownership settles
before fresh ordinary-capable sources. Do not clear accepted input IDs, regress
watermarks, reset replied status, duplicate messages or append a second reply.

Pending/failed originals gain explicit ordinary applicability through the retained
reconsideration authority. Already-replied messages gain a fresh semantic routing
obligation; prior explanatory reply is history, not an implementation decision.
Exact bounded source pages and per-obligation versions retain unprocessed remainder.
No-work may resolve a reconsideration, but it cannot silently withdraw Owner feedback.
Use one exact TaskReviewSource purpose (`route_feedback` or `reconsider_input`).
Reconsideration additionally binds reconsideration_id/input_id; its operation has
its own capability version/source chain and never resolves the main feedback.
Enqueue reconsiderations in original sequence before main feedback, under the same
Planner owner. Terminal `resolve_review_input` records a fresh semantic decision
using exact existing routing primitives (no-work, guidance, issue, answer, requirement
proposal, guidance resolution, or genuinely insufficient Replan transfer). It does
not append a chat reply or original task_input_resolution. Both pending/failed and
already-replied originals use this path: no resetting the old turn/source.
A real successor obligation must exist before its reconsideration guard transfers.
Nonterminal prepare_specification_revision creates the full retained proposal from
the actual review source; exact terminal attachment links it to feedback or the
real reconsidered input, never a ghost input. Existing exact Owner confirmation
and publication own revision changes. Main feedback routing uses source-bound
apply_review_rework, request_replan, raise_planning_issue and terminal
commit_review_feedback for an exact prepared requirement proposal. All terminal
results record the original Attempt command receipt and Stop intent atomically.
The source version is execution control; operation_version independently fences
its exact obligation. Full canonical context rejects oversize, rather than clipping.

Review Rework excludes its own feedback from preconditions and preserves independent
waits. Node promotion distinguishes executable assigned guidance from unresolved
classification/issue/requirement/Replan/publication controls; it cannot count the
very guidance the Node must handle as a prohibition on work. Guidance followup
cannot reactivate a Node while main feedback is unresolved. Read projections consult
the new disposition and do not repeatedly select the historically accepted input.
Reconsideration Retry/Withdrawal uses explicit exact reconsideration identity; it
cannot masquerade as main-feedback Withdrawal.

## Explicit exits and terminal truth

Retry records exact issue/answer, retains the same unresolved operation_id,
increments operation version once, and replaces only source_id through an immutable
previous_source_id chain after old Planner ownership settles. Failed/issued source
is not a terminal operation resolution. Withdrawal records the Owner decision immediately, fences source,
admits Stop if needed, retains physical capacity until verified settlement, and
leaves REVIEW. It never revives the revoked acceptance; new Accept is always fresh.

Existing `dismiss_replan` creates a NEW routing operation for the same feedback
(the predecessor terminally transferred to Replan). It creates that successor in its actual Owner
transaction, with predecessor/dismissal receipt/direction/basis retained and no guard
gap. It returns REVIEW; successor dispatch waits for actual old Planner/effect
settlement. Same feedback/basis without new Owner direction cannot automatically
repeat the dismissed structural request. Dismissal and Withdrawal are distinct.

Cancel uses existing terminal cleanup and is not correction. Preserve Task CANCELLED
while exposing original reconciliation/cleanup and eventual verified final commit.
Unknown merge excludes PR close; finalized history is never reopened or reverted.

## Verification and rollback

Apply the smallest sufficient verification scope. Real PostgreSQL proves authority,
SQL negatives, independent observed lock winners, source/exit ordering, original
preparation settlement, late-input restoration and genuine finality refusal. Actual
source-bound Agent commands prove semantics. Shared fixtures/consumer compilation
and affected Go CLI/source/Host scope tests prove new source grants; reuse unchanged
physical supervision/private-publication/provider methods. If native new-source
compatibility is claimed, exercise the actual bundled CLI and scoped launcher.
Current-built browser scenarios prove distinct exits and session/journal fences;
representative desktop/mobile layouts only. No new live merge or full method matrix.

Rollback uses normal versioned migration/startup compatibility. Never downgrade by
removing retained approval, revocation, published history or original possible effects.
An uncertain effect/absent Runner remains visibly unsettled; it is not authorization
for a replacement worker or acceptance. Installed live App remains the next gate.

## Research and convergence

[Backend](research/backend-correction-design.md),
[delivery boundaries](research/delivery-correction-boundaries.md),
and Web/wire research own source anchors. Dedicated revoked status, actual review
source and conservative immutable-input reconsideration are selected. Concrete reconsideration/source/requirement identity and ordering are now resolved
above. Independent researcher findings are preserved below; the final main pass
reconciles them because the platform interrupted the reviewers with a usage limit.
No product implementation has started.
