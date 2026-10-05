# Backend review correction design

Date: 2026-10-05. Active task: `10-03-a-review-correction`.
Research only; product files were read, not modified. Source baseline HEAD
`ea1a15d` (journal after accepted Owner-delivery leaf). Concurrent framework changes
are preserved. `task-inputs.md` does not exist: its actual contracts are
`task-conversation.md`, `task-guidance.ts`, and migration 19.

## 1. Required semantics and existing seams

The authoritative rules are architecture invariants, docs 02:360–374,
04:299–315, 05:115/169–202/318–320, and 06:414–420/543–547:
Request Changes is an explicit authenticated Owner decision while REVIEW. It does
not itself invalidate a Node or establish graph insufficiency. Feedback routing
leaves REVIEW and blocks fresh acceptance/merge. Direct Rework within the effective
Specification preserves the Task/Node and advances affected activations; graph
insufficiency alone creates Replan. No finalized result may be reopened and no
unresolved merge may be abandoned. Later chat is never revocation authority.

| Actual source anchor | Consequence for this leaf |
| --- | --- |
| `owner-delivery-state.ts:buildDeliveryAcceptance` | Full current output enumeration/approval already exists. Reuse its canonical evidence construction, but Request Changes must also work when scan/permission/preparation failed; do not require acceptance eligibility just to request correction. |
| `owner-delivery-commands.ts:command` | Immutable receipt-first replay and sorted Runner discovery before Task are existing patterns. Request Changes needs the same atomic boundary with capability/version checks. |
| `owner-delivery-worker.ts:guard/effect/finish` | Task/batch/item lock, repeated after-grant checks and durable possible merge effect precede PUT. Finality and correction must serialize here. |
| `owner-delivery-guards.ts:frozenDeliveryRepository/remoteAdmissionForOperation` | Accepted authority is exact; after clearing the pointer the current fallback is ordinary authority. A revoked operation link must prevent that fallback permanently. |
| Migration 24:`preserve_owner_delivery_task_pointer` | Clearing/replacing an accepted pair is currently forbidden. Add a receipt-backed narrow revocation transition; do not drop the trigger. |
| Migration 24:live-batch index and shared item owner trigger | A revoked batch must no longer occupy the live acceptance index; possible preparation effects retain item ownership until settled. |
| `remote-preparation-state.ts:38–46` | `remoteItemQuiescent` tracks possible effects and immutable terminal push uncertainty. `requestRemoteCancel` sets Cancel cleanup/PR closure: correction must not call it. |
| `remote-preparation-access.ts:access` | Push claim follows scheduling reservation; admission is rechecked after token I/O. Observe access can reconcile the original started operation without new push authority. Preserve typed scheduling waits. |
| `task-guidance.ts:412` | Common pre-acceptance input guard is the right place to include feedback/restored obligations. Guard ownership must remain independent. |
| `task-records.ts:119` | `reactivateSettledNodes` computes descendants, checks physical settlement, advances activations and preserves history. Use this primitive for authorized review Rework. |
| `task-replan-state.ts:requestReplan/replanQuiescent` | Existing graph freeze/source/issue/publication machinery is sufficient once real feedback origin is bound. Quiescence includes remote effects and actual Planner ownership. |
| `task-replan.ts:revokeReplanGeneration/reconcileDismissal` | Revocation/Stop already preserves physical claims; review-origin dismissal currently has no real feedback successor. Extend that exact path. |

Do not use `cancelAcceptedDelivery`: it cancels the Task, cancels unrelated inputs
and closes PRs. Correction must preserve the Task, fixed delivery branch/PR, known
published exposure, original public head proof, immutable candidate/scan/waiver
history and all independent input/blocker/Stop guards.

## 2. Request Changes admission and revocation ordering

Suggested dedicated command family `/v1/owner/tasks/review/commands`, with receipt
read `/v1/owner/tasks/:task_id/review/commands/:request_id` and state/history/detail
reads under `/review`. Names are candidates for main's shared freeze:

- `request_changes {feedback_id,text,basis,accepted_batch?}`.
  `basis` is `{control_version,specification_id,plan_id,review_result_digest}`;
  feedback_id is immutable and globally unique, chosen before HTTP.
  Envelope binds schema version, request ID, Task and expected execution control.
  Optional accepted batch is `{operation_id,content_digest,expected_version}` and
  is required exactly when current acceptance exists; clients cannot omit it.
- `retry_review_feedback {feedback_id,operation_id,expected_version,issue_id?,answer?}`.
- `withdraw_review_feedback {feedback_id,operation_id,expected_version}`.
  operation_id identifies the current routing generation; expected_version binds
  that generation capability, not a refreshed Task message version.

Use a canonical review result basis containing effective Spec/Plan, complete
current Node/activation/completion IDs and manifest digests, selected Artifact
IDs/digests, and exact Git source/tree identities. This is server-authored and
fully enumerated. It must not require provider permission, passing CI or an eligible
acceptance manifest. Accepted correction additionally binds the immutable actual
batch digest/current capability. Keep raw feedback bounded by existing PlanningText
and all encoded frames/responses at 512 KiB; no clipping.

Admission transaction:

1. Authenticate session, validate exact command and recover existing receipt before
   fresh-state checks. Lock configuration, discovered Runner rows sorted, Task,
   then relevant batch/item/merge/preparation rows in stable resource order; recheck
   discovery. No provider I/O in this transaction.
2. Require nonterminal REVIEW and exact current result basis; no other unresolved
   feedback/correction or competing admitted requirement publication. If accepted,
   validate actual receipt-chain authority and exact batch/version/current pointer.
3. Reject **any finalized item**, including immutable finality in earlier accepted
   batches for this Task. Reject a started/unknown merge, `may_have_mutated` without
   definitive immutable rejection, or retained effect owner/claim that could still
   PUT. A pending never-started merge can be cancelled atomically. Do not infer
   absence from claim expiry or a provider timeout.
4. Append actual Owner revocation decision linked to this command receipt and exact
   old batch/digest/cutoff. Set batch revoked/version once, clear the Task acceptance
   pair under the new SQL-authorized transition, cancel only never-started merge
   and preparation dispatch, revoke obsolete acceptance proposals, and create the
   immutable feedback plus durable routing operation. All happen atomically.
   Keep REVIEW, increment execution control once, emit formal revocation/feedback
   events, and persist the original committed response.
5. Started preparation effects may still complete. Preserve immutable requests,
   claims/results and item ownership; mark only new-mutation authority revoked and
   reconcile original operation IDs read-only. Do not close/reopen PR, delete a
   branch, force-push, erase exposure or relabel an unknown effect as failed.
6. A durable correction pump waits for admitted preparation and the previous shared
   Task Planner to settle before releasing routing/current-input reconsideration.
   Lost Runner/provider keeps visible operation attention; Retry resumes this same
   settlement, not a new remote mutation. Clear only this operation's settlement
   fence when independently proven quiescent.

Finalization race is determined by the common Task/item transaction: if finality
wins, Request Changes fails and leaves acceptance untouched; if correction wins
before possible merge admission, the worker's after-grant check fails and no PUT
occurs. A possible already-admitted merge is a refusal/reconciliation condition,
not an accepted correction waiting to find out whether it shipped.

## 3. Narrow SQL additions (migration 25 candidate)

Do not rewrite migrations 19/24 or historical checksums. Minimum concrete records:

- `review_feedback`: immutable ID, Task, original Owner command/request, text,
  reviewed basis/digest and optional original accepted batch/digest/cutoff.
- `review_routing_operations`: feedback ID, generation/predecessor, immutable basis,
  explicit originating dismissal decision when present; mutable version, source,
  settlement/queued/running/issue/failure status and due time. One unresolved
  effective feedback per Task. Generation history and successful resolution are
  append-only; no replacing a terminal resolution with a different action.
- `review_routing_sources`: immutable source ID, planned Attempt, Task/operation/
  generation, frozen current Spec/Plan/control, ordered Owner decisions/answers,
  complete reviewed outputs and context digest. Source and launch enforce one
  exclusive scratch Planner scope, zero workspace reservations and exact phase.
- `review_feedback_decisions/resolutions`: actual Owner Retry/Withdraw receipts and
  Agent Rework/Replan/requirement outcomes, exact source/Attempt/fence/basis and
  terminal winner. SQL validates command envelopes/results, not only an FK.
- `owner_delivery_revocations`: immutable Task/batch/digest/cutoff/Owner-request/
  feedback linkage, plus exact admission response. Only an actual authenticated
  Request Changes receipt may authorize pointer clear; mutable settlement progress
  belongs to the routing operation, not the revocation evidence.
- `task_input_reconsiderations`: unique `(revocation_id,input_id)`, original immutable
  batch/message/reply/sequence references, mutable obligation version/status and
  append-only semantic disposition/source proof. These are infrastructure guards,
  not new user-facing Task states.

Add `revoked` to delivery batch status (or an equally explicit immutable revocation
read overlay chosen by main); update the live-batch partial index and every worker
selection/admission to exclude revocations. Keeping status `active`, or labeling
Task correction as `cancelled`, gives misleading reads and can strand new Accept.

Replace the pointer-preservation function with an equally strict version: existing
non-null pair may transition to NULL/NULL only when the exact immutable revocation
and real receipt exist and no finality/unresolved merge exists. Old batch/cutoff/
receipts remain. Replacing directly with another non-null batch remains forbidden;
a fresh later Accept creates a new batch and real approval chain.

Permanent stale-link check: before `remoteAdmissionForOperation` can use ordinary
fallback, look up **that exact remote operation ID** in retained accepted preparation
links and its revocation. Reject every new mutation under revoked links, even after
feedback withdrawal and even if old local result is still current. Pure permission
refresh/newly admitted operation for the same unmodified result may be permitted
later under fresh current ordinary/new-batch authority; do not globally ban the
candidate identity forever. Read-only original reconciliation remains available.

Add feedback/settling/reconsideration guards to common ordinary input/source/local
preparation/new merge admission. Completing checks or local preparation cannot
resolve feedback. Each guard is released only by its own validated resolution;
use SQL `IS NOT TRUE` for missing/null authority, Task-scoped composite FKs and
immutable terminal facts as in migration 24.

## 4. Late-message restoration: retain provenance, do not replay replies

This is a real existing-source gap, not solved by pointer clear:

- `task-conversation-state.ts:318` sets reply_only from **input** accepted batch
  attribution as well as current Task pointer.
- Migration 19:110–116 makes that input provenance immutable; :188 makes replied/
  withdrawn input terminal, :27 enforces one assistant reply per original input,
  and input resolution is immutable.
- `ensureConversationHead` selects only pending/failed originals, while
  `taskInputGuards` excludes originals with historical accepted attribution.

After revocation settlement, derive reconsideration entries for the old batch's
later Owner messages in their original order, excluding explicit withdrawal. Keep
original text, batch attribution, replies, source, observed version and watermark.
Do not set accepted_delivery_operation_id=NULL on those inputs, set replied back to
pending, regress processed watermark, duplicate Owner messages or replay replies.

Pending/failed originals may acquire a **fresh** ordinary-capable source only after
old reply-only source/Attempt ownership settles. A helper computes effective input
applicability from released revocation/reconsideration authority; the immutable
historical batch ID alone is no longer the reply-only decision. Already-replied
originals need new semantic reconsideration obligations, not another
`task_input_resolutions` row or reply. Planner may explicitly record no work, transfer
a requirement/guidance/correction obligation, or the Owner may withdraw that exact
reconsideration. Acceptance blocks until these obligations resolve.

Use bounded ordered reconsideration pages/context, exact source cutoff and each
obligation's version. A page resolving some inputs never clears the remainder.
Ordinary newer messages and independent failed inputs retain their own guards.
Previously accepted reply-only Planner work may finish its original reply only if
still valid; simpler admission is to fence/Stop it and wait before successors. No
shared Planner owner/capacity claim is released until actual process settlement.

## 5. Planner routing and existing explicit exits

Recommend a dedicated **review source** using the existing Task Planner owner
`planner:<task_id>` and existing RuntimeScheduling/DispatchQueue/Stop mechanisms.
This is one semantic phase of the same Task Planner, not a new Agent type or
persistent process. A distinct retained source is safer than pretending an
already-replied conversation input can be reopened. Current Conversation can still
read/answer other messages; it does not implicitly withdraw feedback.

Candidate `TaskReviewSource` binds `feedback_id`, `operation_id`, `source_id`,
`specification_id`, `plan_id`, `control_version`, `review_result_digest`, and
`context_digest`. operation_id already identifies the routing generation. Add exact source to
Dispatch/launch/Attempts and Tool Protocol phase allowlists. Runner retains the
same scratch workspace/physical attribution rules as initial planning/Replan.
Backend selects one shared Planner owner; unavailable Runtime yields operation
attention in REVIEW, never REPLAN_REQUIRED.

- `apply_review_rework {feedback_id,operation_id,source_id,expected_version,basis,
  target_node_ids}`: validate exact current unresolved operation/source/Attempt/
  fencing, effective unchanged Specification/Plan and reviewed output applicability;
  await remote and physical settlement; call `reactivateSettledNodes`, append one
  terminal resolution/event, schedule the same Node under new activation. Stage A
  accepts one current Node; descendant computation remains the existing primitive.
  Incrementing activation makes old completion/scan/waivers historical. Preserve
  integrated code/public head, including target-branch merge facts in new context.
- Planner `request_replan`: same source/basis and exact concrete graph-insufficiency
  reason, atomically create the existing Replan request and a terminal routing
  transfer. Extend origin with feedback/routing IDs, rather than forging Node
  blocker or ordinary input provenance. No graph is published without real Owner
  confirmation. Rework never clears an unresolved Replan.
- `raise_planning_issue`: record exact operation/source-bound issue, fence/end the
  Planner mutation phase and retain REVIEW. Existing initial-planning issue_seq
  must not be used as review phase authority. Explicit Answer & Retry records a
  Task-scoped answer and creates a fresh source after old ownership settles; exact
  issue/version required, no silent answer reuse for another generation.
- Out-of-Spec feedback uses existing full Specification proposal and exact approval
  machinery. Link its obligation to feedback. Proposal preparation/confirmation
  does not resolve feedback; only actual authorized revision publication or a
  durable successor owning its guard may do so. Withdrawal/replacement retains
  independent feedback and Replan obligations.
- Withdraw feedback resolves only that feedback operation, fences queued/running
  source and stops/reconciles old Planner, leaves REVIEW and never restores the old
  approval. If remote settlement is pending, withdrawal decision is immediate but
  release/fresh acceptance still waits for settlement. Independent inputs/changes/
  blockers remain. Cancel remains terminal and uses existing real cleanup path.

**Review-origin Replan dismissal:** extend `TaskReplan.command` at :65 and
`reconcileDismissal`, not a parallel dismiss command. In the same actual Owner
transaction retain dismissal/request outcome, revoke old source/proposal, append
new review routing generation referencing the same feedback, original routing
resolution, exact dismissal receipt/direction and current reviewed basis. Return
REVIEW with effective feedback guard immediately; successor dispatch waits for
old Planner/workspace/remote ownership. Do not wait for a pump cycle to create the
new guard. Maintain an explicit prohibition on recreating the dismissed graph
request for the same feedback/basis/direction decision without new Owner direction;
retry-generated source IDs are not new direction. Direct within-graph Rework or
an honest planning issue are allowed. Withdrawing feedback remains a separate
Owner action; requirement-origin dismissal retains its existing obligation guards.

## 6. Small verification surface and work division

| Distinct behavior | Required actual boundary |
| --- | --- |
| Request Changes with no accepted batch, before push, during CI, after PR creation | Genuine Owner command + real PG feedback/source/revocation read; retain same branch/PR identity; no Node invalidation on admission |
| Before possible merge vs finality wins | Independently observe Task/item lock race; after-token held grant yields no PUT if correction wins; possible/unknown/final fact rejects correction without pointer changes |
| Started preparation and backend/Runner restart | Actual retained original-operation result/observation/ACK and physical settlement; no repeat mutation or correction before ownership ends |
| Late pending/failed and already-replied input | Original attribution/text/reply immutable; fresh semantic obligation and correct guards; no duplicate replies/watermark regression |
| Rework and stale outcomes | Real source-bound Planner tool, same Node activation+1, previous completed evidence remains historical, late old source rejects |
| Issue answer/Retry/Withdraw | Exact issue/version + actual Owner answer receipt, one terminal winner against live Planner outcome, retained claim until Stop |
| Review Replan → Dismiss → fresh routing | Real graph request/dismissal receipts, predecessor retained, no guard gap or immediate same-basis request recreation; independent feedback withdrawal required |
| SQL authority and response loss | Unbacked pointer clear/forged revocation/resolution rejects, receipt replay remains original, COMMIT loss resumes same operation |
| Fresh review/Accept | Current source/scan/mapping/waivers/permission + new approval, old batch receipt cannot authorize corrected result; known public exposure persists |

Reuse existing adapter/check scheduling/expected-head tests, migration24 receipt
recovery, physical Stop/Runner attribution and installed evidence at unchanged input
boundaries. Add only affected protocol/source/CLI consumer tests and one integration
run after writers settle. No need repeat remote protected merge or every method
variant for research/ordinary UI changes. Live App integration remains externally
missing and explicit; OAuth/kernel evidence is not installed App authority. Stage A
remains zero/one modified automatic GitHub repository and one public Node.

Suggested non-overlapping implementation ownership after main freeze:

1. Protocol/migration/feedback authority, commands, reads and PG tests (one schema
   writer; migration25 plus changes to invariant functions, never old migrations).
2. Shared accepted/ordinary/provider settlement and stale-link guards: root's
   existing owner-delivery/remote-preparation modules; coordinate Task/item lock order.
3. Task Planner review source/Tool Protocol/Replan dismissal/Node rework plus Runner
   exact phase support (backend service/queue shared paths serialized with owner1).
4. Web source/receipt journal/operation exits under exact approved frozen contract.

## 7. Decisions for main before shared freeze

Recommended choices are above; these are internal technical decisions, not requests
for user authorization:

1. Explicit `revoked` batch status plus immutable revocation record, versus only a
   read overlay. Prefer status to avoid active-index/worker/UI ambiguity; preserve
   original batch manifest/admission and SQL receipt-backed pointer clear.
2. Dedicated Task review source versus extending immutable Conversation source
   with a review-operation link. Prefer dedicated source using the same Planner
   owner, because replied-input reconsideration and dismissal successors need
   independent durable operation ownership. Do not reset old input/source state.
3. Reconsider all non-withdrawn late inputs, including prior reply-only replies,
   rather than automatically treating old replies as semantic resolution. Prefer
   conservative reconsideration; explicit no-work outcomes can release these guards.
4. Exact review basis format/API action names and generation version policy should
   be finalized by the sole protocol writer before consumers start. It must remain
   available even when local/preparation permission/CI is unavailable.

### Concrete launch and requirement-source integration

`DispatchQueue.enqueue` currently requires one exclusive source and checks state
RUNNING except Replan's REPLAN_REQUIRED; add REVIEW only for a genuine current
TaskReviewSource and an explicit scratch/no-resource reservation. Preserve the
canonical `owner_key = planner:<task_id>`, fencing and physical owner exclusion.
`Dispatch`, `Start`, retained launch/Attempts, Go wire/ScopeID, daemon Runner
allowlist and CLI typed payloads bind this exact new source. Review phase receives
`read_task_context`, `read_task_history`, scoped repository inspection,
`apply_review_rework`, review-bound `request_replan`,
`prepare_specification_revision`/its exact attachment outcome, and
`raise_planning_issue`; it receives neither writable workspace nor Node lifecycle
completion authority. Shared source read/history helpers can be reused without
claiming Conversation input authority. Backend `service.ts` gets a dedicated exact
source dispatch before generic Node/initial-planning handlers. Missing formal
outcome follows existing phase failure handling: close mutation phase, retain
feedback guard and require actual Retry. Committed semantic outcome plus Stop
receipt survives later exit; no second source overlaps old physical ownership.

Replan SQL migration21:4–15 currently requires exactly Node or Conversation input
origin. New migration adds actual `review_operation_id`/`review_source_id` origin
with same-Task composite FKs and changes that check to exactly one of those three
real origins. Retain original Node and input requirements unchanged. No dummy Node
or source message is created to satisfy the old XOR. The new source's retained
Attempt must equal origin_attempt_id and current feedback basis.

Similarly requirement proposals/attachments have actual source checks in
migration21:207/226/241, plus Replan origin support. Add genuine review source/
feedback origin to the existing typed source discriminator and deferred authority
checks. A review-driven proposal's Owner-facing complete Specification, impact and
exact content digest are the same existing contracts; its source attribution is
the actual review source and feedback/reconsideration obligation, with the frozen
context's real input cutoff. Do not manufacture `source_input_ids` to satisfy the
Conversation-only helper; real additional input IDs may be referenced when present
and must still satisfy Task/cutoff. Refactor only the source adapter in
`prepareSpecification`/`attachSpecification` and publication guard resolution.
Applied authorized revision resolves/continues the linked feedback in the same
publication transaction; a draft or ordinary Planner reply cannot do so. A
graph-insufficient changed-requirement proposal uses the existing joint approval
path under the genuine review-origin Replan. Existing exact full approvals and
settlement remain mandatory, including independent Withdraw/Dismiss guards.

### Concrete reconsideration ordering and tools

Use the same TaskReviewSource transport with an explicit source purpose:
`route_feedback` or `reconsider_input`. The latter additionally requires one exact
`reconsideration_id` and original `input_id`; it cannot resolve the main feedback.
Each reconsideration has its own operation/version/source chain, independent of
feedback Withdrawal. These are two concrete owning records, not an extensible
workflow engine. Before main feedback routing, enqueue eligible reconsiderations
in original Owner-message sequence under the single existing Planner owner.
The original feedback remains pending/guarding during these classifications.

- Nonterminal `prepare_specification_revision` accepts the existing full content,
  impact and approval-proposal fields under the genuine review source. It changes
  no effective revision and grants no implicit approval. A reconsideration source
  can reference its **real** original input ID; a pure feedback source references
  its actual feedback and has no invented input ID.
- Terminal `resolve_review_input {operation_id,source_id,reconsideration_id,
  expected_version,basis,summary,routing}` commits a new reconsideration decision.
  Allowed routing is the existing semantic primitives: `reply` means explicit
  no-work classification (summary is a decision, not a second chat reply),
  `guidance`, `specification_proposal`, `issue`, `answer` or `resolve_guidance` with
  their existing exact target/obligation fields. Full graph-insufficiency handling
  remains main feedback routing or the existing genuine ordinary input flow.
  `specification_proposal` must bind and attach the full retained proposal created
  by this exact source. Terminal source success, Stop intent and decision receipt
  are atomic. It never writes another task_message/task_input_resolution or resets
  original status; pending/failed originals acquire ordinary semantic action
  authority through this fresh exact source as well.
- Reconsideration outcome transfers its guard only when a real successor obligation
  already exists in the same transaction. No-work resolves that new obligation;
  guidance remains the original input's exact executable obligation; issue and
  requirements remain independently actionable waits. Original attribution/reply
  rows stay unchanged. Reads show that original input is now reclassified/awaiting
  its actual successor instead of misleadingly showing it as fresh unanswered chat.
- Existing ordinary head selection and taskInputGuards must consult this effective
  disposition. They must not repeatedly select historical originals whose new
  semantic obligation has already resolved/transferred, and must not count a
  transferred input and its successor as two unresolved owners of the same work.
  Unrelated pending ordinary inputs remain in their existing source/sequence flow.
- Suppress `advanceGuidanceFollowup` reactivation while unresolved feedback exists;
  classification must not accidentally change the reviewed activation before main
  routing. Once sufficient review Rework atomically creates the new activation,
  existing binding supplies applicable guidance to its actual new Node source.
  Pending executable guidance is resolved by work/handling, so it is not a blanket
  prohibition on the very Node that must handle it. Unclassified reconsiderations,
  open issues and unsettled requirement/Replan/publication controls are dispatch
  blockers; exact launch-assigned guidance is a runnable successor, not a control
  wait. Preserve independent Owner Stop/blocker rules.

No aggregate taskInputGuards check belongs inside the authorized review Rework
primitive: that would count its own feedback and deadlock. Main source validates
its own exact operation/basis and physical settlement; Rework commits a durable
successor (Node activation/outbox), and resolves only that feedback. If independent
classification/requirement/issue waits remain, new Node **promotion** stays blocked
and the durable successor remains queued. An Owner may then answer/withdraw that
specific obligation; the already-recorded Rework is not replayed. Source guards
must distinguish review-origin authority from ordinary sources, rather than add a
broad boolean bypass to lifecycle helpers. Ordinary local/remote preparation still
requires all its existing input/control guards.

Retry retains the same unresolved operation ID and increments its version, creates
a new immutable source with previous_source_id and includes the exact issue answer.
Failed/issued source is not a terminal semantic operation resolution. Review-origin
Dismissal creates a **new** main feedback routing operation ID because the old one
already terminally transferred to a real Replan request; it references predecessor
and actual dismissal receipt. Receipts/read fields must distinguish these two
cases and never rename an old ID as a new generation.

### Alignment with the refined PRD

The six ACs in the current PRD are all represented: section2/3 receipt and SQL
authority (AC1), settlement/races/permanent stale-operation fences (AC2), section5
and the genuine source adaptations above (AC3), issues/answers/withdrawal/dismissal
successor (AC4), immutable reconsideration/terminal Cancel truth (AC5), and strict
source/launch/read/frame proposals with assigned Web implementation (AC6). Any
finalized item is a universal refusal guard, exercised with a genuine Stage A
finalized item; no unsupported multi-repository/batch success fixture is proposed.
Main's `delivery-correction-boundaries.md` owns detailed provider settlement/Cancel
implementation. This report's recommendations preserve its exact original effect
IDs, no mutation after revocation and no historical result overwrite.

No product code/tests/provider effects were executed for this research-only assignment.
All acceptance tests here are proposed gates, not claims of existing validation.
