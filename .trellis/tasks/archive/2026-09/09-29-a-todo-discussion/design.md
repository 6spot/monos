# Ordered Todo Discussion design

## Boundary and compatibility

Todo capture is complete. The missing behavior is durable Owner input invoking a
real Todo Planner, with atomic semantic replies and explicit interrupted-input
recovery. Extend generic Attempts and their existing queue/Runner process owner;
do not create an Execution Task, Plan Node, PlannerInvocation, separate scheduler
service or capacity pool. Architecture modules 01/02/03/05/06/07/08 govern this.

`Dispatch` retains `kind: node|planner`. Exactly one of `task_id` and `todo_id`
identifies its owner. Existing Task dispatches still require their resource and
retain their wire meaning. Todo dispatches require `kind: planner`,
`source_message_id`, zero Node activation, and no Node or implicit repository.
Repository-free Planner execution uses its reserved scratch directory. A Stop
operation may omit `resource_id`; workspace operations require an actual resource.
Old persisted Task envelopes, receipts and launch JSON are not rewritten. The
current host inspection implementation is fixture-only: Todo repository inspection
returns an explicit unsupported precondition until real resource materialization
is implemented; it must never expose that fixture as an assigned Project.

Add a nullable Todo FK and exclusive scope constraints to Attempts. Command
receipt scope is validated against its Attempt instead of a Task-only FK. Owner
claims distinguish Todo Planner from Task Planner. Runner capacity, fencing,
outbox effects, logs, inventory reconciliation and whole-process-tree release are
shared. Every scope-sensitive service path must branch explicitly; Task event or
workspace records must never be fabricated for Todo work.

## Ordered input and semantic state

Append-only Discussion messages contain immutable text, author, Todo sequence,
identity, time and reply provenance. Each Owner message is a separate source
turn. Messages submitted during a turn never change its fixed input cutoff.
Store immutable reply/withdrawal resolutions separately from original messages.
One Todo control record owns resolved watermark, Discussion control epoch and
current source/desired Attempt references. These are message-processing fields,
not a new Planner execution lifecycle. Attempt facts remain canonical for Runtime.

Persist an explicit durable Discussion outbox intent with Owner input and each
resolution. A bounded worker inside the existing server prepares context and
selects work; unavailable Runtime leaves retained input/intent and a factual
waiting reason. Busy capacity creates a selected QUEUED Attempt through the
existing RuntimeScheduling and DispatchQueue. Only explicit Retry creates a new
Attempt after an interrupted source; later same-Todo input waits. Other Todos
can proceed within shared slots. Stage B still owns ordered runtime fallback.

Use two transactions if context preparation needs the Todo lock before Runtime
selection: prepare immutable context/intent under configuration then Todo; later
select under configuration then Runner then Todo/Attempt, revalidating the exact
intent epoch. Never invert the established Runner-before-scope lock order. A
competing worker must not duplicate admission or consume a changed intent.

## Context and Project changes

Assemble fixed managed protocol, Owner Planner guidance, optional current Project
context/resource descriptors, immutable Original Capture, applicable Working
Requirement State, bounded recent resolved history and the exact source message.
Use deterministic message and UTF-8 budgets below transport limits; never silently
truncate the current source/capture. Exclude later input, other Todos and all Task
conversation/execution state. Older in-scope history remains available through a
bounded `read_discussion` tool, restricted to the launch input cutoff and labeled
withdrawal dispositions. Start fresh when an opaque provider session cannot honor
this scope/cutoff; durable context, not provider transcript, is authoritative.

Freeze source Project attribution with the turn. A Project-assignment epoch and
Project context fingerprint identify the cache basis independently of Todo's
organization version. Reassignment never invalidates the right to commit an
attributed reply, but an old-Project cache must not replace the current cache.
Future turns rebuild with current Project context; moving a Todo does not itself
invoke Planner. An explicit cache rebuild compares the resolved watermark and
current Project-context identity and cannot consume current unresolved input.

## Formal command boundary

Owner Discussion commands have immutable global Owner request IDs and their own
generated result contracts; capture command receipts retain their existing shape.
Submission appends exact input before scheduling and requires no live Runner.
Stop binds current source and exact Attempt/version. Retry and Withdraw bind the
current unresolved source; neither needs a live Planner. Preserve original request
receipts across sessions and check replay before fresh-version guards.

The local `monos` socket derives Todo/Task scope from authenticated dispatch. Add:

- `commit_discussion_turn`: reply, Working Requirement State, exact source message
  ID/watermark and optional structured `{title,specification,project_id?}` preview.
- `read_discussion`: bounded source-cutoff history page/cursor.
- `update_working_requirement_state`: explicit cache value with resolved watermark
  and Project-context version compare-and-set.

A normal commit atomically appends one final assistant message, records source
resolution, advances watermark, conditionally updates cache, saves immutable
command receipt, revokes mutation authority, admits the existing Stop effect and
retains the next-turn intent. Preview is structured message content only; exact
confirmation and Task creation remain the next task. Raw output is never a reply.

Withdrawal serializes with commit: one resolution wins. It preserves original
input/logs and cache, revokes queued/running work, admits/reuses Stop as needed,
advances watermark and retains next intent. A successor waits for old process
release and all admitted effects. Retry refuses active or unreconciled work. An
exit without a formal outcome retains source input for Retry/Withdraw. A committed
reply stays successful after lost response or later exit. The managed launch protocol names the correct Todo formal tool. The current
OpenCode adapter is one-shot; do not invent a reminder via a second invocation.
A future supported in-process reminder must respect the architecture's single-reminder bound.

## Reads and UI

Authenticated, bounded Discussion pages expose canonical messages/resolutions,
current source status, applicable cache and factual Attempt attention. Add
Todo-scoped Attempt/log/operation reads while preserving Task read contracts and
cursor isolation. Reads and selection never schedule work.

Extend Todo detail with Discussion and a labeled composer. Drafts and uncertain
commands are scoped by Todo ID and survive selection changes while mounted. Clear
only the submitted draft after confirmed commit. Show queued versus answering,
interrupted with Retry/Withdraw, and exact current Stop. Poll canonical records
across reconnect; deduplicate by immutable message ID. Provisional Runtime output
may remain in a separate execution disclosure; a working indicator is sufficient
when no streaming surface is used. Preserve mobile navigation and keyboard focus.

## Validation and rollout

Real PostgreSQL checks cover competing submissions/workers, receipt failure
rollback, stable cutoff and Project attribution, commit versus withdrawal,
interrupted Retry, shared capacity and old-owner settlement. Shared schema fixtures
reject mixed scopes and missing resources for workspace effects. Runner tests
cover scope derivation, repository-free launch, reminder/handoff and journal
recovery. Browser cases cover per-Todo drafts, canonical reconnect, failure exits
and queued later input.

After deterministic gates, stage final source and Runner build on the authorized
test host. Reuse installed services and native CLI with the established zero-price
preflight. Demonstrate an actual unassigned Todo turn via `monos`, exact reply and
absence of synthetic Task/Node. Migrate additively. Install compatible Runner
before permitting Todo dispatch; rollback disables new Discussion admission and
reconciles existing processes without deleting receipts/messages.
