# Ordered Task Conversation and guidance

## 1. Scope / Trigger

Task-owned messages, shared Task Planner source selection, reply/routing admission,
guidance continuation and completion handling. Owners are
`task-conversation.ts`, `task-conversation-state.ts`, `task-conversation-reads.ts`,
`task-guidance.ts`, migration19,
the shared queue and the existing backend pump. Architecture modules02/03/05/06
own semantics. Exact revisions, replacement Plans, execution UI and actual delivery
admission remain separate leaves. The owning task `09-30-a-task-conversation`
records full gates and native ordered replies, explicit recovery, guidance/private
workspace handling and existing-service restart evidence.

## 2. Signatures

- `POST /v1/owner/tasks/conversation/commands`: `TaskConversationCommand` with
  `schema_version:1`, immutable `request_id`, `task_id`, name and payload.
- `submit_task_message {message_id,content}`; source/obligation controls
  `retry_task_input`, `withdraw_task_input`, `stop_task_turn` use `{operation_id}`
  and exact `expected_version`. They do not use execution control as a message CAS.
- GET `/v1/owner/tasks/:task_id/conversation`, `/conversation/messages?cursor=&query=`,
  `/conversation/commands/:request_id` provide status, bounded history and receipt
  recovery. GET `/conversation/operations?cursor=` and
  `/conversation/guidance/:guidance_id/recipients?cursor=` page operation and recipient
  projections. Generated status schemas use numeric counters and explicit `has_more`
  or `*_has_more` flags; bounded input lists retain the current head. Existing Task
  Attempt/operation reads remain physical truth. `launch_started` proves transport
  launch only, never provider consumption or successful guidance handling.
- Agent `commit_task_turn {source_id,input_id,source_watermark,reply,routing}`.
  Canonical routing uses `reply`, `guidance`, `issue`, `answer`, `resolve_guidance`,
  `specification_proposal` and `replan`;
  legacy `reply_only` has no canonical conversation authority. Action routing
  carries `TaskActionBasis`, with current execution control/Spec/Plan and applicable
  Node/activation/source. `read_task_context {}` and
  `read_task_history {cursor?,query?}` are source-scoped read commands.
  Actual graph insufficiency uses `replan` with a concrete reason and exact basis:
  the reply and request commit together, and a separate quiescent Planner prepares
  the replacement. Clarification uses `issue`. Keep backend frozen instructions
  and Runner instructions consistent; Conversation cannot call the Node-only
  `request_replan` or dedicated-Planner `prepare_replan` directly. Existing source
  prompts stay immutable when instructions change; explicit same-input Retry
  creates a fresh source with the current instructions.
- `Dispatch.task_conversation_source` binds `source_id`, `input_id`,
  `source_watermark`, `conversation_version`, `context_digest`, `reply_only`.
  It is mutually exclusive with Todo, initial-planning and Node sources.
- `complete_node {summary,artifact_ids?,handled_guidance_ids?}` declares a bounded
  unique list of launch-assigned guidance IDs. Absent/[] declares no handling.
- `tasks` owns conversation sequence/watermark/version/current input/source.
  `task_inputs`, `task_messages`, `task_conversation_outbox`,
  `task_input_resolutions` own input and immutable interpretation/disposition.
  Guidance/obligation/assignment/follow-up and input issue/answer records each keep
  their own attribution and guards; they are not physical Runtime operations.

## 3. Contracts

One Owner message is the bounded immutable input batch for this slice. Append
later input without advancing the active source epoch or changing its prompt.
Input resolution advances the processed watermark exactly once through a canonical
reply or explicit withdrawal. Retain withdrawn content and label it in history.
Interpreted input may still own an unresolved guidance/change issue; that child
obligation does not hold the Planner claim or block later conversation.

Use the existing `planner:<task>` claim for initial planning and conversation.
Owner session/request guards precede configuration -> Runner -> Task ->
source/Attempt/Node -> operation locks. Discover affected Runners before Task lock
and revalidate changed pointers. Preparation and Runtime selection are separate
transactions. Do not acquire a newly discovered Runner while holding Task.

Conversation may run before Start, while stopped/blocked and after terminal state.
It shares capacity and Task-host locality. Only authenticated canonical scratch-only
conversation can bypass the queue's blanket held-Task-workspace exclusion; it still
cannot overlap another Task Planner owner or acquire a writable workspace.

Submission, reply, turn failure, Retry/Withdraw and conversation Stop change only
conversation state. In particular, branch before the generic Task
`missingFormalOutcome` control-version bump. A progress reply records its observed
execution version/time and remains admissible as Node progress changes. Routing
that requests effects must re-evaluate exact current affected facts; reading a new
version does not authorize replaying an old assessment or changing a journaled ID.

Canonical reply, source resolution, routing obligations, watermark, receipt,
SUCCEEDED/fenced Planner, repository-free Stop and next intent share one transaction.
A process exit or prepared draft cannot resolve input. Physical cleanup and logical
reply are separate; retain owner claims until original effects and process trees
settle. Explicit Retry creates a fresh source while preserving the same unresolved
input, and cannot duplicate an already committed reply.

Freeze bounded current Spec/Plan/control/Node/output/operation facts, active
guidance, actual Planner Guidance, applicable Project context, recent Task history
and exact input. Older history is searchable under the same Task/source cutoff.
Earlier replies are selected by the input they resolved, not merely their append
sequence. Exclude later Owner input, Todo capture/cache/discussion, other Tasks,
raw logs and provider-session authority. Required input/Spec/guidance cannot be
clipped to fit; retain a preparation failure with explicit recovery exits.

Pre-Plan guidance is Task-scoped and binds recipients on Plan publication. It does
not invalidate a frozen initial-planning source or implicitly Start. Fresh Node
sources include all active relevant guidance, deterministic assignments and
required IDs. Assignment, supervised launch and successful handling are distinct.
The one-shot Adapter has no live steering or provider-consumption acknowledgement.

Within-scope guidance can retire a queued source or fence/Stop unfinished execution,
then create a same-activation successor after physical/effect/lease settlement.
This is guidance-authorized continuation, not Owner Stop/Continue. Preserve explicit
Owner Stop and unrelated blockers. Both the ordinary Node pump and guidance pump
must recognize intentional `guidance_followup` cancellation; treating it as Runtime
failure blocks the continuation and is a correctness bug.

For serial multi-Node plans, follow-ups wait for current dependency completion and
Task Node writer/effect/lease settlement before preparing a source or reactivating
completed work with descendants. Keep the obligation waiting; a not-yet-ready Node
must not throw repeatedly and starve other Task follow-ups. Pending guidance bound
to a retired source prevents its admission even when a scheduler read it earlier.

Completion admission freezes its manifest. Later guidance remains a separate pending
obligation and cannot join that completion. After successful physical settlement,
required later work uses settled reactivation plus a fresh canonical source; clear
old mutable source/blocker pointers before the activation change and retain all
immutable old evidence. Pending follow-up responsibility must remain durable in
the completion transaction, leaving no acceptance/downstream gap.

Validate handled IDs against the exact frozen source assignment before fencing.
Missing required active guidance rejects completion as correctable; `block_node`
can leave it unresolved. Withdrawn/superseded assigned IDs may retain historical
declaration but cannot regain active status. New version2 manifest hashes include
handling declarations. Historical version1 hashes, operation identities and receipts
remain byte-identical. Only successful trusted completion closes active declared
obligations atomically with evidence. Terminal handling attribution is immutable;
deferred database constraints require the exact successful completion operation,
manifest declaration, assignment, source, Node and activation. A generic operation
foreign key is insufficient, including when directly updating the projection.

Same-operation hard Retry preserves that manifest. Cancelled correction pairs close
no guidance; fresh correction receives applicable instructions. Already-finalized
reconciliation settles only original declared IDs and preserves later follow-up.
Guidance cannot abandon a hard completion or replace its lease settlement pointer.
Task Cancel retains history/cleanup and only conversation-only authority thereafter.

`accepted_delivery_operation_id` and `accepted_delivery_input_cutoff` form the
exact paired control owned by [Owner delivery](owner-delivery.md), with actual
receipt-backed admission under the Task lock. Proposal/confirmation alone is not
acceptance. Later input records that batch and stays nonblocking/reply-only even
on Planner failure.

Explicit [review correction](review-correction.md) appends fresh reconsideration
obligations for later input after eligible revocation. Preserve the original
pending/failed/replied row, attribution, resolution and reply. Original Conversation
Retry/Stop/Withdraw capabilities are suppressed once reconsideration exists;
reject new old-turn commands even after the original batch pointer clears. Recover
an exact existing receipt first. Fresh reconsideration commands own its new routing
decisions and exits; withdrawing them does not rewrite the original input.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Same request with changed payload | `payload_conflict`; original receipt retained |
| Wrong source/head/epoch/watermark or ended claim | Stale/version rejection, no partial reply |
| Unrelated Node progress, reply route | Commit observed reply without execution changes |
| Stale current action basis | `version_conflict`; explicit fresh semantic assessment |
| Missing required handled ID | Correctable `unmet_precondition` before fencing |
| Foreign/unassigned handling ID | Scope rejection; no new manifest |
| Empty/null/oversize or malformed cursor | Typed input/preparation error; no silent loss |
| No Runner/shared capacity full | Durable waiting, no invented failed Attempt |
| Task stopped/blocked | Chat permitted; independent execution control remains |
| Terminal/accepted batch | Reply only; no guidance/Plan/Spec/Node effects |
| Original input has reconsideration | No original Retry/Stop/Withdraw; exact old receipt replay remains valid |
| Required-work issue interpreted | Reply exists, separate obligation and Owner exit remain |

## 5. Good / Base / Bad Cases

Base: two Owner messages produce two ordered native replies after each prior
Planner settles. Good: guidance interrupts a private Git Node, preserves files and
resumes with exact assigned IDs; completion records handling only after finalization.
Bad: bump execution control for a status reply, resolve guidance from `started`,
or declare an admitted completion successful handling.

## 6. Tests Required

Use independent PostgreSQL sessions/processes with observed contention and
before/after-COMMIT crash injection. Test reply/withdraw both orders, shared initial
Planner, failed head with queued input, ordinary message/reply/failure version
isolation, stopped/terminal control and bounded source-cutoff reads. Exercise both
production pumps during guidance Stop; testing the guidance pump alone misses
ordinary Node failure projection races.

Direct SQL negative tests must prevent otherwise-valid cross-Task/source/input/
Node/activation assignment and reply resolutions. Validate JSON ID element types
before text conversion. Test migration18 manifests/operation identity retention.
Test routing/completion/Stop/Cancel and hard-recovery orders, independent obligations,
post-completion reactivation, explicit answers and withdrawal without false resume.
After review revocation, assert replied/failed/pending original inputs retain their
rows and sequence, get fresh ordered decisions with no second reply, and expose no
original control capability. New old-turn commands reject without changing history.

Shared TS/Go schemas, CLI phase allowlists, immutable journal retries and finite
conversation Stop reconnect recovery must pass alongside full relevant suites.
Native proof requires actual command bytes/receipts, intermediate busy-input state,
private-work/lease continuity and original process-tree absence. Observer snapshots
must not combine torn DB reads. Compare non-conversation Attempts, initial sources,
Starts and effects when proving chat did not execute work. Final ordered messages
alone do not prove that message2 arrived while message1 was active.

Native fixture invocation must be tested from the actual Attempt scratch directory.
`runpy.run_path` does not add the target script directory to Python imports; supply
its root-owned tools directory explicitly or execute the script directly. Serialize
argument arrays with JSON to avoid nested shell quote transcription. A failed
harness Attempt remains historical; explicit recovery must compare private work
against the last actual `held_for_stop` report, never invent one for a successor
that failed before workspace open. Keep failed observations and exact recovery
commands alongside the later passing evidence.

## 7. Wrong vs Correct

Wrong: `submit_task_message` increments global Task control and a failed progress
question makes the active Node stale. Correct: append independent conversation
input; route execution mutations through their separately validated current basis.

Wrong: clear an obligation when a new Attempt starts or overwrite an old manifest
with new guidance. Correct: retain immutable assignments/manifests and settle only
declared guidance with successful exact completion, preserving later follow-up.
