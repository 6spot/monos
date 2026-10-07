# Review correction: Web and wire design

Research only, 2026-10-05. Active task `10-03-a-review-correction`.
Source snapshot `ea1a15dd17c98330fd6a97286974e910a2075e95` plus existing framework
changes. Initial dirty state was the shared Trellis/framework/spec work; product
sources were read-only. This worker owns only this document, performs no lifecycle
operation, and creates no product implementation or test result.

## Requirements and current support

Authority is [Owner UI](../../../../../../docs/07-owner-review-and-ui.md:642),
[review-feedback planning](../../../../../../docs/02-planner-and-planning.md:360), and
[delivery correction guards](../../../../../../docs/04-workspace-and-git.md:315).
Request Changes records an explicit Owner decision, stays REVIEW during routing,
and asks the Planner for within-scope Rework, a real insufficient-graph Replan,
an exact requirement proposal, or a planning issue. No Owner Node/DAG selection,
new Task state, new Fix Role or prose-based state transition belongs here.

| Existing seam | Actual support and required delta |
| --- | --- |
| `task-overview.tsx:57` | Current work, local results, exact Owner delivery and remote preparations are composed already. Insert a Review correction card alongside that result/delivery area; retain result inspection even when publication fails. |
| `owner-delivery.tsx:43` | Exact acceptance, frozen batch actions and paged history exist. There is no Request Changes control. New correction eligibility must be independent of `acceptanceFresh`. |
| `task-conversation.tsx:253` | Later input retains its accepted-batch attribution; ordinary input Retry/Withdraw is independent. Those controls cannot authorize feedback withdrawal or accepted revocation. |
| `task-controls.tsx:129` | Accepted Task Cancel routes to exact batch controls. Keep that distinction while adding correction/routing Cancel exits. |
| `task-decisions.tsx:479` | Replan already supports versioned Retry, optional issue answer, optional dismissal direction, retained proposals and physical settlement copy. Extend the existing view with real feedback origin/successor facts. |
| `task-decisions.tsx:256` | Exact previous/proposed requirements and impact already render; keep their Confirm/Apply/Withdraw flow. Correction text changing scope cannot silently replace it. |
| `task-api.ts:5` | One Task journal/transport supports seven families. Add `review`; do not introduce another queue, storage key or fetch mechanism. |
| `task-api.ts:47`, `:149` | Receipt checking and original scoped receipt recovery already exist. Add exact review action bindings and no committed fields on unknown. |
| `use-task-command.ts:64` | Persist before POST, preserve uncertain envelope across reload, epoch-fence callbacks, invalidate Task/Board after canonical receipt. Reuse it. |

No review-feedback schema/source/Owner route is implemented at this snapshot.
`task-replan.ts:29` currently derives state from Nodes after dismissal; there is
no review-origin feedback successor. The existing Replan spec explicitly marks
review routing as a future seam. Existing conversation Planner instructions
(`task-conversation-state.ts:294`) forbid execution changes for accepted inputs.
Changing that allowlist to interpret chat as correction would violate the cutoff.

## Product behavior and guards

### Explicit Request Changes

Show it on a current canonical REVIEW result. Open a Base UI dialog containing
human feedback and the actual result version/Specification/Plan; preserve this
draft and captured basis across close/reopen. The submit action is Request Changes.
Opening, typing, status polling and preparing a draft issue no command.

Request Changes must remain available when Accept is unavailable due to access,
publication findings, missing scan or unsupported remote mode. Its exact basis is
a complete canonical **local review result** digest, not a successful
`DeliveryAcceptanceManifest` built through acceptance permission gates. The server
derives result membership from the effective Plan and applicable completion/evidence
records, preserving each original revision/activation/Artifact attribution.
`TaskResultPage/TaskLocalResult` in generated types expose the existing completion
manifest, current applicability and original Git identity; an arbitrary first
bounded result page is insufficient to calculate a complete Task review digest.

Before acceptance: submit exact current local basis. On success invalidate old
acceptance proposals/confirmations, show `Processing requested changes`, and retain
REVIEW until a formal routing outcome applies. Acceptance and automatic new remote
preparation remain guarded while feedback is unresolved. Queueing/Planner failure
does not move the Task to RUNNING or REPLAN_REQUIRED.

After acceptance: additionally display the actual frozen batch ID/digest/version
and explain revocation. Admission is allowed only for the active entirely
undelivered batch, with no finalized item and no unresolved/started/effect-owned
merge. The backend serializes with finalization and dispatch and rechecks all
guards. An admitted push/create/update may need settlement after revocation;
successful admission never means its remote effect was absent or physically stopped.
Show `Stopping previously admitted delivery before routing changes` until the
canonical settlement facts allow a new Planner/Rework. Preserve branch/PR lineage;
Request Changes does not close the reused PR or reset its target/base.

If merge is unresolved, disable Request Changes with the real reconciliation
reason and show the original reconciliation action. If any item finalized, do not
offer in-place correction; retain exact remainder Retry/Cancel when applicable and
link further execution to Todo Discussion. Stage A remains zero/one modified
automatic GitHub repository. Test the actual supported finality boundary rather
than creating a new multi-repository delivery mode to obtain a partial screenshot.

Provider conflict/outdated-target attention may offer `Update from target branch`:
it opens the same feedback dialog with that text prefilled. It is not a command
on observation and does not grant unreviewed code an old acceptance.

### Routing, answer, withdrawal and requirement change

Render actual feedback text, current routing generation, queued/processing/failed/
planning-issue/requirement-wait status and a concrete reason on the Review card.
Keep technical IDs in advanced details. Normal capacity waiting is factual waiting,
not failure. Allow ordinary Task conversation independently.

- A routing failure offers Retry for the same feedback and routing-operation version. When there is a
  current planning issue, display an answer field and `Answer & Retry`; submit
  exact issue ID plus nonblank answer atomically. Text is durable Task context,
  not a silently applied requirement revision or a generic conversation answer.
- Withdraw feedback remains available during queued/running/issued routing when
  the canonical server capability permits it. Bind exact feedback, operation and version;
  revoke the old Planner source, retain feedback/history, and expose termination
  or effect settlement until actually finished. Fresh acceptance requires a new
  exact review and confirmation. Withdrawal does not revive a revoked batch or
  authorize its linked old provider operations.
- A scope-changing outcome links the existing concrete requirement proposal.
  Confirm/Apply remains separate; feedback is not marked implemented before its
  exact publication/settlement. Withdrawing requirements and withdrawing feedback
  are separate exits, and neither clears independent Replan/input/blocker guards.
- Cancel is always the exact owning Task/batch command, with a disclosure of remote
  cleanup and remaining uncertainty. It is not feedback withdrawal.

### Real review-originated Replan and dismissal

Continue using `TaskReplanCommand` and existing approval/publication UI. An actual
canonical origin must link feedback ID and routing operation; never add a forged
`review` flag to a generic input/Replan in a fixture.

Dismiss records the explicit decision that the current graph is sufficient.
For a review origin, the server atomically retains the feedback, returns to REVIEW
with acceptance blocked, and creates a **new** routing generation referencing
the same feedback and exact dismissal receipt. The earlier resolution remains
immutable. Show old Planner termination pending; the successor does not start
until process/claim/effect settlement. It routes to Rework or a planning issue,
and may not immediately re-create the same dismissed graph decision for unchanged
feedback/basis without new Owner direction. Dismiss does not Withdraw feedback.

Existing `retry_replan` and `dismiss_replan` payloads are sufficient; extend only
the actual origin and dismissal successor/read/result references required to prove
those outcomes. Node-origin dismissal retains its current semantics and independent
blockers. Linked requirement decisions remain independently visible.

## Concrete proposed wire surface for contract freeze

Parent adopted one `OwnerReviewCommand` family and independent local result basis.
The exact storage/source restoration design is owned by the backend researcher;
the following is the Web proposal for alignment, not an implemented endpoint.

Envelope: `{schema_version:1,task_id,request_id,name,payload}`; no `scope_id`.
Reuse `Id`, `Counter`, `PositiveCounter`, `SHA256`, `PlanningText` and canonical
UTF-8 validation. `PlanningText` currently permits 1..65536 characters, rejects
NUL/blank-only text, and is bounded additionally by encoded command size.

| Command | Strict payload proposal |
| --- | --- |
| `request_changes` | `{feedback_id,text,basis,accepted_batch?}` |
| `retry_review_feedback` | `{feedback_id,operation_id,expected_version,issue_id?,answer?}` |
| `withdraw_review_feedback` | `{feedback_id,operation_id,expected_version}` |

`basis` proposes `{control_version,specification_id,plan_id,review_result_digest}`,
with nonnull Plan for REVIEW. The server compares the complete local snapshot
digest against the saved exact Spec/Plan/control/result, independently of scan and
provider permissions. `accepted_batch` is exactly
`{operation_id,content_digest,expected_version}` when there is an active batch;
omit it only when genuinely unaccepted. Missing active-batch binding or attaching
a historical/foreign batch fails; no optional field lets an accepted command
silently become unaccepted correction.

The Web creates `feedback_id` once before journaling, like existing immutable
message IDs. If backend chooses a server-created feedback ID instead, committed
Request Changes must still require a real feedback/routing identity and canonical
detail hydration; do not accept generic `committed` as proof.

Retry answer/issue are paired, required for the exact current issue and forbidden
without one; ordinary failure Retry has neither. Withdrawal forbids answer/issue.
Retry/Withdraw bind the active routing generation/version; do not retarget a saved
envelope when Replan dismissal has created a successor. All irrelevant/unknown/null
payload fields reject. No confirmation of an unseen graph or requirements is added.

POST `/v1/owner/tasks/review/commands`; recovery
GET `/v1/owner/tasks/{task_id}/review/commands/{request_id}`. This `review` suffix
fits existing `recoverTaskIntent` routing.

Proposed strict `OwnerReviewCommandResult` always contains schema version,
Task/request ID, `status:committed|unknown`. Committed requires matching name,
feedback ID, actual `operation_id` and `operation_version`. Request Changes also binds
the reviewed result digest; accepted revocation additionally binds the original
batch/digest/version and its actual settlement operation, if one was admitted.
Retry/Withdraw match the submitted feedback/operation and advance that operation's
capability version once. Backend/Web coordination chose Retry retaining the same
unresolved operation ID, with a new immutable source/predecessor chain. Failed or
issued sources are not terminal semantic resolutions. Dismiss of review-origin
Replan instead creates a NEW routing operation, because the predecessor already
terminally transferred to Replan. Unknown contains no name, outcome IDs, version
or revocation fields. Keep original physical `TaskReplanResult.operation_id`
semantics: proposed dedicated fields `review_feedback_id,review_operation_id,
review_predecessor_operation_id` bind dismissal to its actual feedback successor,
not to a Stop operation. The exact original dismissal receipt is retained in detail.

Canonical read proposal: GET `/tasks/{task}/review` plus `/feedback/{id}` detail.
Status supplies nullable current local review basis, Request Changes eligibility/
reason, exact active batch binding where applicable, current effective feedback
summary, and separately bounded feedback history. Current effective feedback must
not disappear behind history caps. Summary includes feedback ID/version, generation,
disposition, waiting/issue/requirement/Replan references and explicit permitted
actions. Detail supplies full feedback, original reviewed basis/result digest,
Owner decisions, actual source/issue and settlement/successor references. Do not
embed 64 full feedback texts/manifest histories in a status response.

Suggested bounds: reuse 512 KiB encoded UTF-8 per read/command, well-formed Unicode,
256 complete output references, existing 256 selected Artifacts per output,
64 history summaries per page and canonical unpadded cursor <=2048 characters.
Required canonical context must reject oversize rather than silently truncate.
History uses exact Task/kind and immutable created-at/ID keyset identity; missing
continuation is never a manual-ID fallback. Reuse existing canonical cursor
mechanism where practical, not another serialization framework.

Actual Agent/source integration is necessary beyond Owner wire: backend proposes
`TaskReviewSource {feedback_id,operation_id,source_id,specification_id,plan_id,
control_version,review_result_digest,context_digest}`, an immutable source under
the shared `planner:<task>` claim with zero writable reservations. Formal outcomes must cover `apply_review_rework`,
real graph insufficiency Replan, exact requirement proposal and planning issue;
validate live Attempt/source ownership and one terminal outcome. Generic
Conversation, Node or Replan credentials do not acquire this authority. Source
launch/prompts/Runner allowlist and strict mutually exclusive dispatch source
definitions require their owning backend/Runner implementation and wire gates.

## Delivery and input read additions needed for truthful integration

Keep revoked accepted manifests/receipts immutable and readable. A revoked batch
must be distinguishable from terminal Task cancellation; recommended batch
disposition is `revoked` with revocation feedback/decision and settling/settled facts.
Do not resurrect its original proposal/confirmation or reuse that batch for the
new result. A subsequent Accept prepares fresh content and creates a fresh batch.

`owner-delivery-state.ts:125` presently gives batch `cancelled` priority over an
unknown/started merge's item status. `operation_state` retains uncertainty only in
secondary details. Add a direct canonical reconciliation/cleanup projection while
keeping Task CANCELLED: waiting original merge, pending PR close, closed,
externally merged, not needed or attention. `remote-preparation-reads.ts:37` also
does not make `externally_merged` a terminal cleanup projection. Verified final
commit/count must remain visible if a withheld success is discovered after Cancel;
it cannot turn Task CANCELLED into COMPLETED or authorize another merge.

Existing production paths support this truth: `owner-delivery-worker.ts:272`
records immutable late finalization; `remote-preparation.ts:164` prevents close
while a merge may have affected the PR, and `:210` retains original provider
observations. `requestRemoteCancel` (`remote-preparation-state.ts:41`) is terminal
cleanup, so Request Changes must not reuse it merely to stop dispatch and thereby
close a PR intended for corrected work.

After legitimate revocation settles, later inputs may regain unfinished Task
applicability. Preserve `accepted_delivery_operation_id` provenance and existing
replies; do not clear metadata or replay replies. Add an explicit canonical
reconsideration/applicability fact, e.g. a feedback-linked restoration reference,
so the existing Conversation card no longer implies an active frozen Retry for
a revoked batch. Backend coordination proposes a separate revocation/input
restoration obligation: pending/failed inputs use a fresh source after settlement;
already-replied input routes the new obligation without writing a second reply.
Genuine review-origin Replan/requirements use actual third-source-kind/FKs, never
ghost input or Node origins. Backend owns source selection and prior-reply preservation.
Existing input IDs/versions remain exact; new work does not derive from UI copy.

Critical server counterpart: `owner-delivery-guards.ts:74` falls back to ordinary
admission when there is no current accepted repository. Clearing the acceptance
pointer must not let an old batch-linked operation gain ordinary new mutation
authority. Retain acceptance-link provenance and reject stale accepted workers
before any grant/effect; preserve only original read-only settlement.

## Session, draft, receipt and read fences

Reuse the existing journal key/quota, pending-command allowlist and original
receipt-first replay. Suggested scopes: `review-request`, `review-feedback:<id>`,
draft `review-feedback:<captured-result-digest>`, answer `review-answer:<issue>`,
and existing Replan direction/answer scopes. Validate loaded review envelopes
against generated strict schema, Task identity and all actual per-action results.
Do not evict uncertainty, send after persistence failure, regenerate IDs on reload,
silently refresh basis, or clear a newer draft when an older command succeeds.

Current shared `useTaskRead/useTaskPages` (`task-shared.tsx:33/:59`) omit session UUID
from query keys and do not forward query AbortSignal. New review reads and touched
review-origin Replan views need session-scoped keys and post-await epoch/signal
fences equivalent to `owner-delivery-api.ts:68`. This can be a narrow shared-hook
repair or a dedicated fenced API; do not assume generic current hooks supply it.
Read errors disable dependent actions while preserving canonical history/drafts.
Mount handlers, history selection, prefilled conflict text and dialog open never
POST. Backend validates the authenticated credential plus X-Monos-Session on the
actual command; client preflight alone cannot fence cookie replacement.

## Genuine browser acceptance plan and stopping rule

Reuse the current built SPA, actual `createApp` protected HTTP routes, genuine
PostgreSQL fixture and exact owned-schema cleanup. Use actual semantic source
commands/receipts to create routing issues/Rework/Replan; never populate feedback
or fake origin by direct SQL. Synthetic Runtime/provider observations remain
explicitly bounded evidence; native/live effect claims belong to their existing
owning acceptance gates.

1. Current local review with acceptance blocked by actual permission/findings:
   Request Changes opens with retained draft/basis, reopening issues no command,
   actual submit records one feedback, Task stays REVIEW and acceptance disables.
2. Canonical queued/issue routing: submit Answer & Retry to exact issue, retain
   old/new generation and answer across reload. Withhold a committed response,
   reload, recover its real receipt and prove no duplicate generation/outcome.
3. Withdraw while running/issued: actual Owner command fences old source, retained
   process settlement remains visible, stale Agent outcome rejects, and new
   acceptance requires a new proposal/confirmation. Independent guards remain.
4. Actual review-origin graph-insufficient outcome then Dismiss: actual command
   returns REVIEW with feedback effective and a real linked successor, not Accept;
   old source cannot publish/raise another issue, and unchanged direction cannot
   immediately repeat the dismissed Replan. Requirement withdrawal stays separate.
5. Accepted-before-effect correction: display exact frozen batch, revoke through
   real Owner route, keep branch/PR lineage and historical accepted evidence;
   no new old-batch push/merge, fresh Rework returns to new exact review/acceptance.
6. Actual Stage A unresolved merge/finalization negatives: Request Changes denied
   under the owning guards, original reconciliation/remainder actions remain.
   Cancel with lost merge reply preserves late remote truth and Task CANCELLED,
   closes only undelivered open PRs after original reconciliation, keeps branches.
7. Hold canonical review/detail/Replan responses during Task switch, logout and
   session replacement; no private state or pending envelope is restored. Two
   tabs compete on exact feedback/operation/version; the loser retains draft and refreshes
   facts without automatic resubmission. Journal quota/error prevents POST.

Capture and open desktop 1440×1000 / mobile 390×844 companions only for distinct
new layouts: feedback dialog, pending/planning-issue correction card and
revoked/reconciling delivery. Reuse unchanged Owner delivery and shared shell
evidence at its original scope; do not redraw the old full matrix. Tie source/build,
route/data/actual receipts and synthetic boundaries to metadata; inspect overflow,
focus return, mobile action reachability and composer availability. Once the
changed boundary cases and required wire/consumer/type/lint/build gates pass,
stop optional testing. Research-only work runs formatting/link checks, not these
future product suites.

## Handoff

Implementation dependencies: backend freezes canonical local snapshot, review source
generation, revocation/restoration semantics and real Replan successor; protocol
freezes strict shapes before Web/API work. Recommended Web files are a focused
`review-correction.tsx` and `review-correction-api.ts`, existing Task API/journal
integration, Overview/Conversation/Replan decision integration and owned focused
API/browser tests. Do not widen Task states, delivery modes or normal chat authority.
No unresolved user decision is required for these routine choices.

### Reconciliation with the refined PRD

The main session's latest PRD has eight requirements and six ACs. This research
matches its canonical review authority and retained history without mode expansion:

| PRD AC | Research coverage |
| --- | --- |
| AC1 Owner/revocation authority | Separate local-review basis; strict exact batch variant and real per-action receipts; no caller-supplied origin or forged pointer clear |
| AC2 effect/routing order | Dispatch/finality serialization, stale accepted fallback closure, actual old-effect/physical settlement before routing; no PR close on Request Changes |
| AC3 semantic correction | Genuine read-only review source, sufficient Rework vs formal insufficient Replan, exact changed requirements and fresh acceptance |
| AC4 explicit exits | Operation-versioned Answer & Retry/Withdraw, new same-feedback successor on Dismiss, source settlement and anti-repeat boundary |
| AC5 restored input/Cancel truth | Separate restoration obligation for replied inputs, retained attribution/replies, canonical cleanup/reconciliation and late finality without Task revival |
| AC6 wire/Web | Shared journal and strict receipt recovery, session/selection fences, genuine-route browser plan and representative inspected layouts |

Documentation verification: owned-file whitespace check and relative-link/anchor
source review only. No product test or provider effect was run for this research.
