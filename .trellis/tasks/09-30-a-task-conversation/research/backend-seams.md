# Research: ordered Task input, canonical conversation and guidance

- Active task: `.trellis/tasks/09-30-a-task-conversation`; research only.
- Baseline: committed Node execution leaf `c5ce437`, database migration 18.
- Ownership: this file only. Product code, task activation, host operations and acceptance remain with the parent.
- Related research: [Runner guidance](runner-guidance.md), [acceptance](acceptance.md).

## Recommended smallest complete slice

Implement an ordered, repository-free Task Conversation source under the existing `planner:<task_id>` authority. Keep conversation epoch/message sequence separate from execution `tasks.control_version`. One Owner message per immutable input batch is sufficient for this leaf; later batching can combine contiguous messages without changing the contracts. Commit reply, input interpretation resolution, durable routing obligations and Stop outbox atomically.

Supported routing is an ordinary reply, in-scope guidance, an exact existing issue/blocker answer, an explicit no-work resolution of an existing guidance obligation, or an open requirement/change issue. The last route recognizes requested Spec/Plan scope changes but does not publish them: actual revision/proposal machinery belongs to the next leaf. Its durable open obligation continues to guard acceptance and remains visible with Retry/Withdraw/answer exits. Marking interpretation complete must not claim the requested change is applied.

Guidance uses launch context plus controlled Stop/fresh Attempt, preserving unfinished Node activation/workspace. Completion already admitted keeps its immutable manifest; later guidance waits for successful settlement and then uses an explicitly recorded fresh-activation correction or Planner re-evaluation. No live provider steering, generic workflow engine, new permanent service, Todo context or another-Task preview is needed.

## Architecture requirements and decisive existing seams

| Contract / current code | Consequence |
| --- | --- |
| `docs/02-planner-and-planning.md:404` | One logical Task Planner across initial planning and conversation; incoming input queues behind its physical/mutation authority. |
| `docs/02-planner-and-planning.md:406`, `:414`, `:437`, `:439`, `:443`, `:445` | Chat never implicitly starts/continues/unblocks; pre-acceptance unclassified input guards acceptance but does not stop Nodes; reply-only validates input claim and records observed execution basis separately; answers do not replace Owner Retry; pre-Plan guidance gets recipients on publication. |
| `docs/05-tool-protocol.md:338`, `:354`, `:356` | Ordered submit/commit/Retry/Withdraw are formal commands; routing is atomic and input-authorized; exact in-scope correction is possible, implicit Spec/approval change is not. |
| `docs/06-state-and-formal-data.md:482`, `:518`, `:531`, `:537`, `:539`, `:543`, `:551` | Keep canonical control on `tasks`; input interpretation and resulting obligations are distinct; guards are operation-owned; delivery cutoff is an actual accepted batch, not a proposal; Cancel retains history/reconciliation. |
| `docs/03-runtime-and-execution.md:562`, `:566`, `:576`, `:578`, `:582` | Exact guidance assignment; launch receipt is not handling; controlled continuation cannot override Owner Stop; completion/routing serialize and settle only declared obligations on successful completion. |
| `apps/server/src/discussion.ts:23`, `:40`, `:48`, `:116` and `discussion-state.ts:54`, `:68`, `:101`, `:147` | Reuse patterns for immutable request receipts, ordered source discovery, bounded history, prepare/select split and atomic canonical reply. Do not copy Todo control/cache/preview into Task. |
| `apps/server/src/task-planning-state.ts:50`, `:74`, `:86` | Initial planning is frozen at Start and exact global-control-bound. Ordinary input/pre-Plan guidance must not invalidate it. |
| `apps/server/src/dispatch-queue.ts:62`, `:75`, `:155`, `:168` | Current enqueue/promotion assumes every Task is RUNNING/global-CAS-bound. Add a source-bound conversation branch; reuse `planner:<task>`. |
| `apps/server/src/dispatch-queue.ts:126`, `:161` | Preserve same-Runner locality. Narrow the blanket held-workspace rejection for canonical scratch-only conversation; it otherwise prevents guidance during Git execution. |
| `packages/domain/src/commands.ts:25`, `apps/server/src/service.ts:208`, `:233`, `:274` | Current generic Task commit checks/bump global control and records a legacy reply event only. New canonical conversation needs an early source-specific admission branch. |
| `apps/server/src/service.ts:77` | `missingFormalOutcome` currently bumps global control for every Task Planner failure. Conversation failure must update only its input/source state and epoch. |
| `apps/server/src/node-execution-state.ts:54`, `:99`, `:198` | Node source is exact global-CAS-bound, immutable and carries reservations; inject required guidance while preparing a fresh source. |
| `apps/server/src/artifacts.ts:123`, `:148`, `:161`; `node-completion.ts:25`, `:64`, `:84` | Freeze handling declarations before fencing; resolve obligations only with formal successful completion. Preserve old digest bytes. |
| `apps/server/src/task-records.ts:113` | Rework primitive handles settled affected nodes, but must clear/rebind migration-18 source/blocker pointers before activation changes. |

## Minimal persisted representation

The names below are recommendations, not existing API claims.

1. Add `conversation_sequence`, `conversation_processed_watermark`, `conversation_epoch`, `conversation_input_id` and `conversation_source_id` to **`tasks`**. Keep task lifecycle/Spec/Plan/control authoritative there. Sequence changes on message append; epoch changes only when the current conversation source is replaced/resolved/fenced. Appending a later message must not invalidate the active source. Normal chat and input preparation/failure do not increment execution control.
2. `task_messages`: immutable ID, Task, monotonic sequence, author, bounded content, created time; assistant records reference exact input operation/source/watermark and observed execution control version/time. Unique `(task_id,sequence)` and one canonical assistant reply per source. Owner source IDs and assistant source watermark determine historical visibility; assistant append sequence alone does not define what earlier turns knew.
3. `task_input_operations`: Task/message or follow-up provenance, immutable ordered batch IDs and source watermark, version, current source pointer and explicit interpretation status (`pending`, `processing`, `failed`, `replied`, `withdrawn`). The initial batch contains one Owner message. Use immutable payload columns plus narrowly mutable operational state or an immutable disposition table, with database validation preventing history rewrite. A resolved interpretation references child guidance/change obligations instead of remaining a head-of-line blocker.
4. `task_conversation_outbox`: immutable source ID, input operation ID, previous source ID, planned Attempt ID, epoch, exact batch/watermark, configuration version, source capability (`action_eligible` or `reply_only`), captured Task observation/time, frozen context/prompt/digest, preparation failure; mutable selection bookkeeping only. One pending source per input/current head. `done` means scheduling consumed, not semantic success. Retain all failed/replaced sources.
5. Attempts gain exact `task_conversation_source_id`, composite FK to source/planned Attempt/Task, and source/launch immutability/exclusivity checks. Conversation is `kind=planner`, no Todo/Node/initial-planning source, `node_activation=0`, `owner_key=planner:<task>`, empty workspace reservations. No writable repository effect.
6. `task_guidance` owns immutable text/digest/applicability/source input and activation policy plus durable withdrawal/supersession history. `task_guidance_obligations` owns exact Task/Node/activation (or pre-Plan pending recipient), requiredness, operation version, current disposition and handling/resolution evidence. Per-source assignment records bind guidance/obligation to exact Node source/planned Attempt; a later dispatch/started-event projection is a transport fact, not semantic handling.
7. A small `task_input_obligations` or equivalent typed child-operation table represents open requirement/change issues and exact issue answers. Keep it separate from Runtime `operations`: those rows currently describe physical effects and cannot truthfully become semantic workflow state. Every acceptance guard has an owning operation and version; do not use one global `needs_attention` boolean.
8. Durable guidance follow-up records bind original guidance/input, exact recipient/source/activation, continuation policy, current intent/version and settling Stop/completion operation. They are deterministic domain-specific work, not a second Planner authority or generic scheduler. They may reference a fresh conversation source for semantic re-evaluation, but never launch a concurrent Planner.

Use composite same-Task FKs, unique input/source resolutions, immutable-source triggers, nonnegative JS-safe integer bounds and bounded UTF-8 text/JSON sizes. Preserve migration 18 unchanged; add migration 19 and update `packages/db/src/migrate.ts` explicit list/output plus typed mappings if needed. Add only indexes that support oldest unresolved input, current source, active obligation and pending follow-up scans.

### Accepted-delivery seam

There is no real accepted-delivery batch/table/worker in this baseline. `task_command_proposals.action='accept_delivery'` and its `authorization_receipts` are confirmation facts only (`packages/db/migrations/0004_owner_commands.sql:9`; `node-execution.ts:318`). Do not classify input using their existence.

Smallest useful future seam: nullable paired `tasks.accepted_delivery_operation_id` / `accepted_delivery_input_cutoff`, and immutable input attribution carrying the exact accepted operation ID when submitted after that cutoff. This leaf exposes **no command that sets the pair**. Direct SQL fixtures may populate the seam to test later-input classification and reply-only/nonblocking behavior, clearly identifying this as a future accepted-delivery fixture. The delivery leaf must add/validate the operation FK and atomically publish exact result identity, acceptance receipt, cutoff and delivery outbox. It must lock the same Task and query open per-operation guards; confirmation alone cannot set this pointer. If fields are deferred entirely, explicitly retain this unmet production capability instead of claiming accepted-batch integration.

Pending pre-cutoff inputs/obligations remain blocking. Post-cutoff input is immutable conversation-only for that accepted batch even if its Planner fails. A source prepared earlier must also recheck the current accepted/terminal constraint when committing action. No later input revokes an accepted batch implicitly; the later delivery/revision workflow owns any explicit revocation and new batch.

## Owner and Agent command boundaries

Prefer a Task-specific Owner command schema, analogous to `DiscussionCommand`, instead of overloading global `expected_control_version` for ordinary submit.

- `submit_task_message`: authenticated Task scope, immutable request/message IDs, bounded nonblank content. Serialize append under the Task lock, persist input and return message/input IDs and sequence. No current execution-version CAS is necessary. Concurrent clients cannot lose input, and unavailable Runtime does not prevent receipt.
- `retry_task_input {operation_id, expected_version}`: target the exact failed/unprepared input or unresolved child obligation. For an input, fence/settle prior source as needed and prepare a **new immutable source with fresh current Task/configuration facts**. Preserve batch/message identity and old source history. Do not blindly copy Todo Retry's old prompt. Do not retry a replied/withdrawn interpretation or create its duplicate canonical reply.
- `withdraw_task_input {operation_id, expected_version}`: durable disposition; withdraw only that input or child obligation and fence associated unpublished work. Retain messages/replies/physical effects. Advances input head only for a head input; withdrawing an obligation does not erase the resolved original interpretation or independent blockers. A running guidance recipient may require Stop/reconciliation before a fresh context without withdrawn instructions; withdrawal itself never releases physical claims.
- Optional `stop_task_turn` gives an explicit Owner interruption that leaves the input failed/pending for Retry/Withdraw. Do not route it through initial-planning Stop or change Task lifecycle.

Agent `commit_task_turn` must include exact source/input/watermark, bounded reply and a strict routing union. The source-specific branch of `guardNewCommand` interprets the envelope control value as the conversation epoch; execution action basis is a separate routing field. Fixed Runner envelope construction cannot silently update its launch global version after a read, so conflating these two values prevents stale action correction.

Suggested routing variants:

- `reply`: no execution CAS; persists captured/read observed version/time with the canonical reply.
- `guidance`: bounded instruction, Task-before-Plan or exact Node/activation/source applicability, current effective Spec/Plan/control action basis, and `continue_unfinished` / `correct_completed` / `reevaluate_after_completion` policy. Program validates structural scope and existing Owner source authority; Agent decides semantics. This does not edit Spec/Plan definitions.
- `issue`: recognized new requirement/ambiguity/unpublished change with reason and current basis; creates an open child obligation, truthful reply and Owner exits. It does not publish a revision or claim fulfillment. Later messages can continue because the original interpretation is resolved.
- `answer`: exact planning issue sequence, Node blocker ID or input issue ID/version plus answer, recorded immutably. Existing Owner Retry/Continue must consume that recorded answer with exact target checks; this command does not clear the issue/blocker or start execution.
- `resolve_guidance`: exact existing obligation/version, current relevant evidence and explicit no-work explanation. It closes only this obligation through a recorded semantic decision, without rewriting old handling/withdrawal evidence.

Retry of a **resolved interpretation's child issue** must not reopen/overwrite its original resolution. It either reattempts deterministic guidance work under retained authority or creates a distinct linked follow-up input/source for Planner re-evaluation with its own canonical reply. New Owner answers remain ordered messages. A plain reply about an issue cannot silently resolve its required-work obligation.

Before terminal handoff, validate the whole routing and current source. In one transaction insert canonical reply/resolution, persist all guidance/issue/follow-up effects, update only affected versions, fence Planner, admit/reuse repository-free Stop, append formal events/receipt and advance next ordered input. A crash after commit returns the original receipt and cannot duplicate reply, guidance or continuation. Validation failure is correctable within the same live source; it must not persist a partial reply.

`read_task_context` and `read_task_history` should be strict read-only Task tools available only to canonical conversation. They may reuse bounded existing projections but cannot expose arbitrary SQL, another Task, Todo cache, raw Runtime transcript or writable inspection. A latest Task read carries observation version/time and exact active sources/blockers so stale action routing can be corrected. History uses scope/cutoff/query-bound cursors and capped rows/encoded bytes. Initial Planner retains its existing publish/issue-only outcome scope.

## Context preparation, ordering and initial planning

Required context: fixed Tool Protocol contract, Owner Planner guidance, current effective Spec, compact current Plan definitions/Node and output facts, task lifecycle/control observation, open planning/Node/input issues and physical operations, active applicable guidance, recent Task-only history and **all exact batch messages**. Project context may be included as the existing Task context input; no Todo Original Capture or Working Requirement cache. Bound required content before reads where possible and then bound the encoded Dispatch. Trim only the declared recent-history window; never clip Spec, batch or required guidance. An oversized required context yields a visible preparation failure and Retry/Withdraw exits.

Historical reads must enforce the source cutoff: Owner sequence at/before source watermark; assistant reply's source watermark preceding the current source. Current formal facts can be read separately with a recorded fresh observation. Use deterministic ordering and bounded search rather than automatically appending an unbounded transcript.

The initial-planning/source interlock needs explicit treatment:

1. Reuse `planner:<task_id>` in both queues. Existing selected-QUEUED owner check and physical owner exclusion prevent overlap. Do not create `conversation-planner:<task>`.
2. Initial Start can create its durable source while a conversation Attempt holds Planner authority; selection waits. A conversation source can likewise wait for initial planning/issue outcome and physical Stop settlement. Preserve oldest input order; selection availability should not discard/replace either source.
3. Ordinary input/reply and **pre-Plan guidance registration** update only conversation/obligation state. They do not bump execution control, so queued initial planning remains valid. Fresh initial context may include already-active guidance at preparation; later guidance does not mutate its frozen prompt.
4. On `publishInitialPlan`, bind pre-Plan Task guidance to the published single Node/activation in the same transaction before execution source discovery. Node source then includes it. This is sufficient for this leaf: guidance cannot change Spec or plan definitions. No initial-source rebuild solely for later ordinary guidance is required.
5. Actual Spec/control mutation retains exact current CAS and immutable-source rules. If a future feature requires rebasing queued initial planning, use an explicitly linked successor under retained Start authorization, not silent prompt replacement or indefinite `stale_source` waiting.

Conversation can be selected before Start, while blocked/stopped and after terminal state because it has its own source eligibility. Preserve same Runner locality, shared capacity/configuration selection, stale-connection protection and one physical Planner owner. Exempt only the authenticated canonical scratch-only conversation source from `dispatch-queue.ts:161` workspace-lease exclusion; leave writable Node exclusion intact.

## Guidance continuation and completion races

| State at routing commit | Required persisted result |
| --- | --- |
| Before Start/no Plan | Task-scoped guidance pending recipient, no lifecycle change. Publication binds recipient before Node preparation. |
| Node pending, no frozen source | Bind obligation; next source captures it. |
| Node frozen/QUEUED | Retire the exact source/queued Attempt and create a successor with full active guidance; no prompt mutation. |
| Running mutable Node | Persist guidance/follow-up, fence old Attempt and admit exact Stop. After process/effects/lease settle, fresh source resumes same Node/activation/workspace under Planner's retained in-scope routing authority. |
| Owner-stopped or unrelated blocked Node | Persist guidance/answer only; preserve exact blocker. Only explicit appropriate Owner Continue/Retry clears it. |
| Completion already admitted | Preserve old source/manifest. Persist a pending post-completion policy; do not Stop as if the completion were ordinary mutable work. |
| Already completed Node | Exact input-authorized in-scope correction invalidates current evidence and creates new activation once old effects settle, or Planner explicitly resolves no-work with evidence. |
| Terminal / accepted-batch conversation-only | Canonical reply only, no new execution guidance/rework/change obligation for that accepted result. |

The Task lock serializes routing against `complete_node` admission and projection; exact Node/source/activation validation is still mandatory. If guidance wins first, this adapter fences/stops the old writer and assigns a fresh source. If completion admission wins, it freezes its handled set; later guidance remains a separate obligation. Successful projection must atomically close only old declared obligations and preserve/enqueue later follow-up (or Planner re-evaluation) so acceptance/downstream scheduling cannot observe an unguarded gap.

Avoid calling Owner Stop/Continue internally: that would fabricate Owner intent and can override a genuine Stop. Extract/reuse physical Stop primitives and give the follow-up its own exact domain reason. An Owner Stop that arrives while continuation waits must cancel/suspend that continuation; later cleanup success cannot revive it. Guidance while an independently blocked Node waits does not create a competing recovery owner.

`complete_node.handled_guidance_ids` is already an empty placeholder. Extend to bounded unique IDs: omitted/[] explicitly declares none, null is invalid, unknown/cross-Task/cross-Node/cross-activation or unassigned IDs are denied. Every still-required active launch-assigned guidance must be declared or completion returns a correctable precondition **before** fencing/admitting the physical effect. `block_node` remains the honest exit for unhandled required work. Withdrawn/superseded IDs can remain historical declarations if launch-assigned, but must not regain active/handled status.

Freeze declaration and assignment provenance alongside summary/Artifact selection. Add a manifest version (existing rows version 1, new handled-ID manifests version 2) or equivalent unambiguous new-only hash representation. Adding an empty column default must **not recompute/reinterpret historical hashes**. Existing operation `completion_manifest_digest`, old command receipts, completion identities and settlement pairs remain byte-identical. New finalization copies frozen handling evidence into completion projection and closes matching active obligations in the same transaction only on success.

For settled reactivation, clear `nodes.execution_source_id` and `blocker_id` before advancing activation, preserve old sources/completions/Artifacts, create explicit carried obligation identities for the new activation and prepare a new canonical Node source. `reactivateSettledNodes` alone currently leaves migration-18 source FK/pointer inconsistent. Do not relabel an old Artifact/manifest as output of the new activation.

Hard completion retains its existing exact recovery owner. Guidance arriving during recovery cannot silently choose correction or reset the lease. Owner `recover_completion(retry)` repeats the old manifest; `correct` settlement cancellation handles no guidance, so its new source must rebind active guidance. An `already_finalized` pair closes only old declared IDs, then follows the persisted later policy. Cancelled Tasks retain historical settlement without marking current guidance handled or reopening execution.

## Failure and cancellation integration

Branch `service.ts:77` missing-formal-outcome handling for conversation before generic Task failure/control mutation: record failed input/current source, fence Attempt and Stop, retain ordered head for explicit Retry/Withdraw. Runtime saturation, configuration/required-context failure and no eligible Runner are durable waiting/preparation facts, not a reason to lose input or auto-create endless Attempts.

Source-based Owner controls must reject a canonical conversation Attempt passed to initial-planning or legacy Planner controls. `TaskPlanning.stop_initial_planning` only owns its immutable initial intent; generic `commit_task_turn` scaffold cannot accept the new source without canonical resolution. Reply-only failure/Stop/Retry/Withdraw cannot change execution control or stale an unrelated Node/initial-planning source.

Task Cancel currently fences all Task Attempts in `node-execution.ts`, while pre-Plan Cancel is handled by `task-planning.ts`. Both paths need conversation-aware handling: revoke action authority and unpublished guidance/change obligations, retain messages/receipts/physical recovery, and allow unresolved input to be retried/continued under a new immutable terminal reply-only source after the old physical Planner settles. A previously action-eligible source must never commit actions after terminal state even if its conversation epoch has not otherwise changed.

## Locks and service/file integration

Follow existing ordering: Owner session/authentication and configuration, discover affected Runner identities without Task lock, lock Runner capacity (sorted if multiple), then Task, current input/source/Attempt/Node and operation rows. `service.ts:44-52` states Runner -> Task -> Attempt -> operation. Since Task locality prevents different live hosts, ordinary Planner+Node routing is normally one Runner lock; still revalidate discovery before mutation. Never acquire an undiscovered Runner after holding Task; use retry-on-pointer-change as in `task-planning.ts:33-44` and `discussion.ts:32-38`.

Task-only append/preparation/reads need no Runner lock when they cannot affect physical Attempt ownership. Scheduler selection remains configuration/runtime/Runner before Task and rechecks exact conversation source on replay/promotion. Use bounded preparation/select/follow-up pump passes and the existing backend wake/tick loop; no extra service. All network effects remain existing transactional outbox work.

Suggested implementation split:

- `task-conversation-state.ts`: records, bounded context/history, source assertions, canonical commit/resolution and guard query.
- `task-conversation.ts`: Owner submit/Retry/Withdraw/status/history/receipt and preparation/selection pump.
- `task-guidance.ts`: routing, per-recipient obligations/assignments, exact follow-up advancement and completion hooks.
- Modify `service.ts`, `packages/domain/src/commands.ts` for source-specific admission/read/failure handling; `dispatch-queue.ts` and `runtime-scheduling.ts` for conversation source/eligibility and safe scratch exception.
- Modify `task-planning-state.ts`/`task-records.ts` for existing pre-Plan guidance capture/recipient publication; `node-execution-state.ts`, `artifacts.ts`, `node-completion.ts`, `node-execution.ts` for fresh guidance binding, frozen handling, continuation/recovery and Cancel.
- `app.ts` routes/status and the existing pump integration; add Owner Task projection pointers/counters without full conversation payload on every overview.
- Protocol source schemas, generated TS/Go/OpenAPI and schema fixtures; Runner scope/local allowlist/Host Stop-only handling as described in companion research. Root owns final file split and spec updates.

## Meaningful test matrix

1. Two independent clients submit concurrently; unique increasing sequence, exact request replay/conflict, immutable one-message batches; no head skipped while failed; later input does not fence the active source.
2. Initial Planner and conversation contend for the same owner; only one mutation/physical Planner; Plan publication under existing Stop settlement; pre-Plan guidance does not stale initial source and is included in the first Node source.
3. Submit, reply, input failure, Stop/Retry/Withdraw during a running/queued Node preserve global control/evidence/source validity. Reply survives unrelated completion progress and records observation basis; stale action rejects atomically without partial reply, then a fresh read/action or reply remains usable.
4. Live Node workspace with spare shared capacity permits repository-free conversation on the same Runner; no Planner workspace grant; no cross-Runner shortcut or same-owner overlap.
5. Commit-before-lost-ack/replay/reconnect retains exactly one reply/resolution/guidance/follow-up; new payload under same request conflicts. Oversized source is visible, immutable, retryable/withdrawable without clipped requirements.
6. Task history scope, cutoff and cursor binding; older search works; required batch is complete; no Todo/other Task data or raw logs enter prompt/read. Exact answer records cannot clear unrelated blockers or implicitly Retry.
7. Guidance before Node preparation, queued replacement, running controlled Stop, both Owner Stop/follow-up orders; exact same unfinished activation/workspace and no launch before physical effects settle.
8. Missing/duplicate/foreign/unassigned handled IDs reject before fencing. Assigned-but-withdrawn declaration preserves withdrawal. Only successful completion closes required active obligations; Artifact/log/started/Stop/admission does not.
9. Both routing/completion-admission orders and both late-follow-up/physical-success orders. New guidance never enters old manifest; post-completion correction uses fresh activation/source and preserves old evidence. No transient acceptance/downstream gap.
10. Hard recovery retry/correct-cancelled/already-finalized paired outcomes carry correct manifests/obligations; Cancel during settlement never revives Task. Migration 18 -> 19 preserves an actual old completion manifest/hash/operation/settlement identity.
11. Two independent open obligations: resolving/withdrawing one leaves the other guard. Requirement issue remains open after ordinary reply while later conversation progresses; Retry creates a distinct follow-up source rather than duplicate original interpretation.
12. Pre-Start/stopped/terminal conversation does not Start/Continue/reopen. Terminal action denied. Future accepted-cutoff fixture proves later input is conversation-only and nonblocking even on Planner failure; a mere acceptance proposal/confirmation does not activate that behavior.

Use focused PostgreSQL tests adjacent to `postgres-discussion.test.ts`, `postgres-task-planning.test.ts`, `postgres-node-execution.test.ts`, `postgres-dispatch.test.ts` and `postgres-task-records.test.ts`, with process workers where commit/race order matters. Protocol/domain/Go source-scope tests and existing generation/type/lint/test gates remain required. Native acceptance is owned by the parent and detailed in the companion files.

## Research outcome and limits

No production behavior, migration, host service or task state was changed by this research. The minimal decisions above include real required-work recognition and owner exits while leaving actual Spec/Plan revision publication and accepted-delivery admission to their roadmap leaves. Guidance continuation remains source-bound Stop/fresh launch; Runtime launch facts must not be advertised as provider understanding or completed handling.
