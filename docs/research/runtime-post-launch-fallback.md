# Post-launch Runtime fallback

Date: 2026-10-11. Implementation design for the next untracked Stage B slice.
The Owner authorized ordered feature development and deferred native acceptance.
This document describes proposed behavior, not completed implementation or native
CLI evidence. The [initial policy fallback](runtime-policy-fallback.md) is already
implemented; second-Adapter work is proceeding independently.

Sources: [Runtime](../03-runtime-and-execution.md),
[Workspace](../04-workspace-and-git.md), [invariants](../08-principles-and-non-goals.md),
[scheduling spec](../../.trellis/spec/backend/runtime-scheduling.md),
[Node spec](../../.trellis/spec/backend/node-execution.md).

## Smallest integrated change

Add one durable continuation table, immutable chain metadata on selected Attempts,
and one bounded backend coordinator. Keep the existing source builders and source
pumps. The coordinator calls six explicit source-specific preparation functions;
it does not introduce a source registry, workflow engine, Runtime scoring,
generic lifecycle framework, session portability, or a new Task state.

An automatic continuation consumes the remaining targets of the policy that
selected the failed Attempt. It starts a new Attempt and fresh Runtime session
after physical settlement, preserving the original work identity. Owner Retry
starts a new policy chain using current configuration. Explicit selection remains
one target unless a separate future Owner permission contract allows fallback.

Scope is objective post-launch failure. Existing queued pre-start cancellation
continues its current recovery path; integrating that separate trigger should be
an explicit subsequent change, not an incidental behavior of this worker.

## Objective failure input

Current `adapter.runWithPreflight` in
[opencode.go](../../runner/internal/adapter/opencode.go) returns a Go error and
durably captures raw output. `Daemon.observeMainExit` in
[daemon.go](../../runner/internal/daemon/daemon.go) emits `exited` from retained
systemd facts. Neither currently supplies structured provider-failure evidence.
Do not infer a provider reason from the error string returned by `exec.Cmd.Run`.

Prefer an optional typed `failure` object on the existing `RuntimeEvent` variant
`exited`, rather than separate failure and exit events. The failure body should
contain a normalized reason and bounded machine-readable evidence identifiers,
such as Adapter ID/version, documented native event type/code and invocation
identity. Retained provider message text is diagnostic and does not select the
reason. Schema validation rejects failure on arbitrary output/attention events.

This avoids an existing ordering hazard: `BoundaryService.event` records events
at arbitrary stream/order positions and immediately applies their effects. If
bare `exited` arrives first, `missingFormalOutcome` fences the Attempt. A later
independent failure event must not retroactively reinterpret that terminal result.
If an independent event is chosen instead, terminal observation needs a durable
ordering/merging contract before either event can drive lifecycle changes.

| Fact available to Adapter or supervisor | Admissible interpretation |
| --- | --- |
| Supported CLI's documented, top-level terminal error envelope | `runtime_error`; more specific reason only from documented structured fields |
| Exact documented authentication code or typed provider status tied to that envelope | `auth_required` |
| Exact documented quota-exhaustion code | `quota_exhausted` |
| Terminal documented throttling code or provider 429 without a quota subtype | `rate_limited`; never guess quota exhaustion |
| Native turn failure with only a free-text message | Generic terminal `runtime_error` only if the envelope itself guarantees failure; never classify the message |
| Raw stdout/stderr, assistant prose, nested shell output, model/tool text containing JSON | Log data; no failure authority |
| Ordinary exit, including exit code 1, without a typed terminal failure | Existing `missing_formal_outcome`; no automatic continuation in this slice |
| Capture marker, fsync/ENOSPC failure, malformed/truncated diagnostic capture | Capture/recovery attention; no Runtime fallback |
| Owner Stop, semantic block, admitted completion, successful terminal Planner tool | Existing formal outcome; subsequent exit cannot create continuation |
| Silence, duration budget, heartbeat loss, interactive-input attention | Waiting/attention; no automatic continuation |

Do not claim specific Codex/OpenCode native code mappings until their supported
version's parser fixtures or documented envelopes establish them. A generic
typed terminal Runtime error is sufficient to exercise the shared mechanism.
Avoid a speculative catalog of provider codes.

The execution supervisor must retain normalized terminal evidence before exposing
its exit observation. Parse only documented native framing, outside nested text
fields; preserve raw output unchanged. A bounded Adapter-owned diagnostic record
must bind Attempt, dispatch and exact invocation and survive daemon restart.
The execution-account Agent must not gain a new writable authority file or an
endpoint for declaring its own Runtime failure. If the chosen supervisor channel
cannot protect provenance under the existing two-account model, do not enable
automatic classification from that channel. A storage/parse error follows the
existing capture-failure path and retains physical ownership.

`Daemon.observeMainExit`, its reconcile/poll callers, journal event persistence,
`RuntimeEvent` schema and generated TS/Go consumers are the concrete transport
entry points. Emit the same immutable terminal event on recovery; never recreate
it with changed failure fields after backend acknowledgment.

## Persisted chain and migration

Add these nullable fields to `attempts` for selected canonical work. Legacy probe
Attempts remain outside automatic continuation:

| Field | Constraint |
| --- | --- |
| `runtime_chain_root_id` | FK to `attempts(id)`; a root points to itself |
| `runtime_target_index` | Integer index into the frozen target array, nonnegative |
| `runtime_predecessor_id` | Nullable unique FK to `attempts(id)` |

Require the first two together, and require them when predecessor is non-null.
Add `UNIQUE(runtime_chain_root_id, runtime_target_index)`. At insertion validate
same root, strictly increasing index, equal execution owner and scope, same
Runner, and same Node/activation when applicable. Equal Task planner owner keys
are insufficient: also require the same source family and original obligation
(initial planning lineage, Todo message, Conversation input, Replan request or
Review operation). An input cannot change kind merely because all Task Planners
share `planner:<task_id>`.

Extend immutable `selection_context` with `policy_targets`, the complete ordered
array selected for the root. Preserve its existing source and policy
configuration version. Store the actual chosen index in the Attempt column,
including targets skipped before its initial admission. Each successor retains
that snapshot and selects strictly after its predecessor. The latest source
configuration version can differ: fresh context and the in-flight policy
snapshot are separate facts. Use the existing ExecutionPolicy size bound; do
not allow growth of the array during recovery. Explicit roots have one entry.

Add `runtime_continuations`:

| Field | Constraint / purpose |
| --- | --- |
| `predecessor_attempt_id` | Primary key and FK to the failed Attempt; one automatic successor decision |
| `failure_stream_id`, `failure_sequence` | Composite FK with predecessor ID to the exact `runtime_events` record |
| `stop_operation_id` | FK to the exact admitted Stop; same predecessor, kind `stop` |
| `successor_planned_attempt_id` | Nullable unique ID; populated atomically with its new source before an Attempt exists |
| `state` | `settling`, `prepared`, `queued`, `exhausted`, `superseded` |
| `reason` | Bounded current waiting/exhaustion diagnostic |
| `created_at`, `last_checked_at` | Durable bounded-worker ordering |

No FK from `successor_planned_attempt_id` directly to `attempts`: selected work
may remain unavailable before any Attempt is created. A deferred constraint
trigger, on transition to `prepared`, verifies exactly one matching source row
in the appropriate existing source table, the same semantic obligation and its
predecessor link. On transition to `queued`, verify the actual Attempt and chain
columns. Freeze the event, Stop and assigned successor identity after insertion
or first assignment. Terminal continuation states cannot return to `settling`.
For nullable bindings, reject SQL NULL explicitly rather than allowing CHECK's
unknown result to accept a partial identity.

The queue's two Attempt insert paths (`DispatchQueue.enqueue` and `enqueueTodo`)
must persist and validate chain fields together with selection context. Keep all
existing exact source/launch constraints and foreign keys; do not weaken them
to reuse a source for a second Attempt.

Initial planning needs one additional provenance column:
`task_planning_outbox.runtime_predecessor_attempt_id`, referencing the continuation
predecessor. Replace migration 20's Owner-request/requirement-change XOR with
exactly one of Owner request, requirement change, Runtime predecessor. Validate
that the predecessor points to `previous_intent_id` in the same Task and initial
Specification lineage. Automatic recovery must not fabricate an Owner receipt.

Todo Discussion currently lacks a source predecessor link. Add
`todo_discussion_outbox.previous_intent_id` with a same-Todo FK; validate unchanged
source message and one automatic successor through the continuation relation.
Other source tables already provide predecessor fields and should retain them.

## Event transaction and coordinator

In [service.ts](../../apps/server/src/service.ts), add a narrow
`recordRuntimeContinuation` helper before the ordinary `missingFormalOutcome`
branch. Call it only for validated terminal failure on a canonical selected
Attempt with current mutation authority and no admitted terminal operation.
Within the existing event transaction:

1. Persist and deduplicate the exact event using current stream identity rules.
2. Verify current source authority and no successful terminal handoff or already
   admitted requirement-change operation owned by this Attempt.
3. Mark the Attempt `FAILED`, revoke mutation authority and its Start outbox.
4. Admit or recover its exact Stop via `admitWorkspaceEffect`.
5. Insert continuation `settling`; keep semantic work unresolved.

Do not call `missingFormalOutcome` as an intermediate step: it immediately
blocks Nodes, marks Conversation inputs failed and changes Review operations.
The normalized Runtime reason must remain on the Attempt and event while
continuation waits. `finishOperation` keeps the failed Attempt failed when Stop
succeeds; Stop success is physical settlement, not work completion.

Add `RuntimeContinuation.pump(limit = 8)` in a new small module and instantiate
it in [main.ts](../../apps/server/src/main.ts), alongside the existing bounded
source pumps. It may run concurrently with them because database constraints
and source guards are the authority. Do not rely on timer order or the local
`pumping` boolean for mutual exclusion.

Preparation lock order is configuration SHARE, Runner rows in sorted order,
Task/Todo control, Attempt, continuation and required source/operation/workspace
rows following their owning contracts. Never lock a continuation row first and
then its Runner; event ingestion takes Runner before continuation. Discovery
queries do not establish authority: reload and compare under those locks.
If full-Task quiescence requires multiple Runner rows, discover before Task,
lock in sorted order and retry if the set changed, as existing Owner coordinators
already do. Never acquire a Runner-table lock after a Runner row lock.

After locking, require `process_absent && process_released`, every predecessor
Operation terminal (`succeeded` or `cancelled`), all its leases released and its
admitted Stop successful. Preserve stricter existing Replan/Review whole-Task
quiescence, remote-operation and delivery guards. No source creation while a
writer, Git effect or Stop recovery still owns the prior work.

Revalidate the exact current source, obligation, accepted-delivery status,
effective Spec/Plan/activation and relevant control version. Owner Stop/Cancel,
resolved input, planning issue, published Plan, published replacement graph or
changed Review basis supersedes the continuation. Do not silently rebase a
failed control decision onto a later semantic revision. Transient independent
guards may wait; an obsolete source cannot regain authority by waiting.

Preparation then creates one fresh source, updates the current source pointer,
stores its `planned_attempt_id` and commits `prepared` atomically. A builder
returning a context-budget failure creates the existing immutable failed source
and records exhaustion/attention once; it does not poll-rebuild the context.

The existing source pump later calls `RuntimeScheduling.selectAndEnqueue` in a
separate transaction. The scheduler looks up a prepared continuation by requested
Attempt ID and uses its trusted predecessor snapshot. Do not add a caller-
supplied arbitrary target offset or predecessor that bypasses this relation.
Resolve only the remaining suffix, constrain Auto to the predecessor Runner,
and treat a different hard Runner pin as unsupported transfer. Skip that
incompatible candidate without moving work; if no same-Runner target remains,
expose exhaustion. Offline Runner and unknown installation wait; capacity waits
on the chosen queued Attempt. Policy selection does not need a new global Auto
scan once locality is fixed.

`enqueue` plus continuation `queued` commit together. Admission replay returns
the original target/dispatch and verifies the same continuation link. A policy
or installation edit cannot restart the scan at zero. Do not select a target
inside the source-preparation transaction: builders already hold Task locks,
while scheduling must acquire Runner locks first.

On confirmed suffix exhaustion, the source-specific handler records the factual
attention once and closes that continuation. No fake final Attempt is inserted
for skipped targets. Waiting conditions remain `prepared`; mark that source's
waiting reason and retry later without refreshing its context.

## Six concrete source integrations

Use explicit functions in the existing owning modules. Passing a small record of
predecessor/continuation identity is sufficient; no plugin registration surface
or common abstract source superclass is needed.

### Node

Entry points: `NodeExecution.pump`, `NodeExecution.command`,
`prepareNodeSource`, `assertNodeSource`, `blockNodeSource` in
[node-execution.ts](../../apps/server/src/node-execution.ts) and
[node-execution-state.ts](../../apps/server/src/node-execution-state.ts).

Exclude a failed Attempt with a `settling`/`prepared` continuation from pump's
`ended` factual-block loop. After settlement, set the same Node to `PENDING` and
call `prepareNodeSource` with `previous_source_id` retained through the current
Node pointer and recovery metadata naming the failed Attempt/reason. Preserve
activation, Spec and Plan. Rebuild Role, Project, formal answers, Artifact
metadata, guidance assignments and reserved workspace identities. Do not carry
old raw logs or opaque Runtime sessions into the prompt.

On exhaustion call `blockNodeSource` with the exact current source and factual
cause. Existing `admitWorkspaceOpen` then reopens the same Task/resource workspace
under a new lease after old settlement. Retained checkpoint work still forbids
repository-free completion. Existing guidance followups, Replan authority,
requirement freeze and admitted completion take precedence over fallback.

### Initial Task planning

Entry points: `createPlanningIntent`, `assertPlanningSource`, `TaskPlanning.pump`
and `TaskPlanning.command` in
[task-planning-state.ts](../../apps/server/src/task-planning-state.ts) and
[task-planning.ts](../../apps/server/src/task-planning.ts).

Refactor `createPlanningIntent`'s authorization argument into the three explicit
provenance variants above; preserve current Owner and requirement-change callers.
Before automatic creation require Task `RUNNING`, no Plan, no planning issue and
the exact current original intent. Mark old selection outbox consumed and create
the new intent through the existing context builder, which already rebuilds
formal answers, guidance and current Project/Role descriptors. Its established
control-version increment remains explicit; no fake `planning_retried` Owner
answer/event is added. Exhaustion leaves Task `RUNNING`, no Plan and attention.

### Todo Discussion

Entry points: `Discussion.pump`, `Discussion.command`, `lockDiscussion`,
`prepareDiscussionContext` in
[discussion.ts](../../apps/server/src/discussion.ts) and
[discussion-state.ts](../../apps/server/src/discussion-state.ts).

Preserve the same unresolved `source_message_id` and message cutoff; confirm
`desired_attempt_id` is the predecessor and no resolution exists. In one
transaction replace the consumed outbox with a fresh predecessor-linked intent,
clear `desired_attempt_id`, increment the existing discussion control version,
and build context through `prepareDiscussionContext`. The source remains the
ordered head; later messages cannot overtake it. `ensureDiscussionIntent` alone
is insufficient because it returns early when that source message is present.
Exhaustion keeps the unresolved message and sets control attention; no reply,
resolution or cache update is fabricated.

### Task Conversation

Entry points: `prepareConversationSource`, `assertConversationSource`,
`TaskConversation.pump` and command handling in
[task-conversation-state.ts](../../apps/server/src/task-conversation-state.ts) and
[task-conversation.ts](../../apps/server/src/task-conversation.ts).

Keep the same pending `conversation_input_id` and source watermark; require no
input resolution, reconsideration takeover or active Review routing guard.
Mark old outbox consumed, advance conversation authority as appropriate to the
existing command contract, and call `prepareConversationSource` with the old
source ID as `previous`. It reconstructs canonical Task observation and bounded
history. Preserve `reply_only`/accepted-batch restrictions; no Task execution
control version is substituted for conversation version. Exhaustion marks the
input failed through its owning code, without changing Task lifecycle.

There is one concrete guard beyond `mutation_allowed`: Runtime module 03 treats
admitting an authorized requirement change as an achieved formal phase outcome,
while current `handleTaskConversation` returns `requirement_operation_id` from
`apply_specification_revision` without ending the reply Attempt. Before admitting
automatic continuation, check `requirement_changes.admission_attempt_id` and its
exact immutable admission receipt. Such an operation continues through system
settlement and must not be submitted again by automatic fallback. Preserve the
existing remaining reply/Owner recovery behavior; this slice does not rewrite
Conversation's separate reply contract. A draft prepared by
`prepare_specification_revision` alone does not count as admitted publication.

### Replan

Entry points: `createReplanSource`, `assertReplanSource`, `replanQuiescent` and
`TaskReplan.pump` in
[task-replan-state.ts](../../apps/server/src/task-replan-state.ts) and
[task-replan.ts](../../apps/server/src/task-replan.ts).

Require the same pending request, exact current source, no prepared proposal or
issue, and `REPLAN_REQUIRED`. Retain original request/reason and existing
single-root/single-successor source constraints. After whole-Task quiescence,
invoke `createReplanSource`; it already finds the source predecessor, snapshots
formal graph/impact/private-work facts and increments request version. Verify
creation occurred and bind its `planned_attempt_id` in the same transaction.
Do not clear an existing issue/proposal just to satisfy the builder. Exhaustion
leaves the request pending and Task `REPLAN_REQUIRED` with waiting reason.

### Review routing and input reconsideration

Entry points: `createReviewSource`, `assertReviewSource`, `reviewSettlementReady`,
`TaskReviewCoordinator.pump`, `TaskReviewCommands.command` in
[task-review-sources.ts](../../apps/server/src/task-review-sources.ts),
[task-review-state.ts](../../apps/server/src/task-review-state.ts),
[task-review-coordinator.ts](../../apps/server/src/task-review-coordinator.ts) and
[task-review-commands.ts](../../apps/server/src/task-review-commands.ts).

Both Review purposes use this one source family. Preserve feedback, operation,
purpose, reconsideration identity and exact semantic basis. Require unresolved
current operation and no outcome/issue; apply existing ordered reconsideration
and whole-Task settlement guards. Move current source to `previous_source_id`,
then invoke `createReviewSource` with fresh canonical manifest/history. Never
copy a proposal to another feedback/basis or create a second reply for an
already-replied input. Successful preparation returns operation to its existing
`queued` status; exhaustion uses existing `failed` attention while Task remains
`REVIEW`. Do not use `settlement_pending` to imply Owner delivery revocation
when the only pending effect is Runtime Stop.

## Owner controls and read projections

An active continuation is not an ordinary interrupted Attempt waiting for manual
Retry. Existing status methods currently infer that condition from `FAILED` and
`process_released`. Include continuation state in those predicates and expose
existing waiting/settling reasons until it exhausts or is superseded.

Owner Stop/Withdraw/Cancel remain effective before and after successor preparation.
Their source-owning command transaction must supersede pending continuation and
revoke any prepared source or queued successor through existing controls. Manual
Retry, when its existing preconditions permit it, supersedes the chain before
starting a new one; a concurrent automatic worker cannot also publish a successor.
Do not manufacture a blocker or weaken exact blocker/issue-answer rules merely to
enable Retry during automatic recovery. Preserve existing Owner exits.

The exact insertion of source and `prepared` relation is one commit; therefore
Owner controls either see the predecessor or the new current source. Their
existing source/version CAS must reject stale control without losing its receipt.
Current raw failed Attempt diagnostics remain readable throughout.

## Focused validation and ownership

Use a new `postgres-runtime-continuation.test.ts` for integrated mechanism tests,
with real isolated PostgreSQL and fake Runner events/effects. Reuse existing
fixture helpers; do not build a generic source fixture framework. Add a small
number of lifecycle regressions to the source-specific files below.

| Test location | Required observable regression |
| --- | --- |
| `postgres-runtime-continuation.test.ts` | Typed failure atomically creates one Stop and continuation; no successor before process, operations and leases settle; same-Runner fresh Attempt uses the next frozen target |
| Same integrated file | Two coordinators contend through separate connections; one source/Attempt. Kill before/after preparation and queue COMMIT; restart preserves exact identity and target index |
| Same integrated file | Policy edits, skipped unsupported targets, full slots, offline Runner, explicit target, different Runner pin and exhausted suffix preserve ordering and bounds |
| `postgres-node-execution.test.ts` | Same Node/activation/workspace and new lease; prior dirty checkpoint retained; old credentials rejected; guidance/freeze/Cancel owns competing work |
| `postgres-task-planning.test.ts` | No Plan/issue creation on failure; fresh formal context and runtime provenance; Plan or issue committed before late failure forbids successor |
| `postgres-discussion.test.ts` | Same ordered message, exactly one committed reply, new source context; later messages stay behind; Withdraw/Stop wins continuation race |
| `postgres-task-conversation-process.test.ts` | Same input/cutoff, fresh context and independent conversation version; reply/requirement admission/reconsideration does not repeat |
| `postgres-task-replan-process.test.ts` | Same request and single source successor; pending proposal/issue or dismissal suppresses fallback; whole-Task settlement retained |
| `postgres-review-correction.test.ts` | Both purposes preserve operation/basis and prior reply; terminal routing or withdrawal wins; no new Owner decision fabricated |
| Adapter/daemon/journal tests | Native terminal fixture maps without message heuristics; nested output cannot spoof classification; capture failure remains separate; restart replays identical terminal event |

Additional cross-boundary cases: terminal tool receipt versus failure transaction
in both lock orders; ordinary exit remains missing outcome; event replay/conflict;
source context-budget failure exhausts once; initial pre-start loss does not gain
automatic retry accidentally; schema rejects wrong owner/scope/index/event/Stop,
partial chain identity and a prepared continuation without its genuine source.

Source workers should own their existing modules and tests. One central owner
must own migration, protocol/generated outputs, `service.ts`, scheduler/queue,
the continuation module and `main.ts` to avoid shared-file edits. Agree the small
source preparation/exhaustion callback signatures before parallel implementation;
the central module uses explicit imports and dispatch over six known families.
Independent review starts after those interfaces and the combined diff settle.

Run affected PostgreSQL and TS/Go/protocol checks for changed inputs. Full suites
are an integration decision, not a loop after every edit. No test described here
proves a supported real CLI installation, Linux account isolation, native provider
failure, service restart or retained-work native continuity. Those deferred
acceptance claims remain open.
