# Ordered Todo Discussion

Sources: architecture [Planner turns](../../../docs/02-planner-and-planning.md),
[Tool Protocol](../../../docs/05-tool-protocol.md), and
[formal data](../../../docs/06-state-and-formal-data.md). Implementation:
[`discussion.ts`](../../../apps/server/src/discussion.ts),
[`discussion-state.ts`](../../../apps/server/src/discussion-state.ts), migration
[`0014_todo_discussion.sql`](../../../packages/db/migrations/0014_todo_discussion.sql).

## Scope and entry points

Only explicit `submit_discussion_message` starts Discussion. Capture, opening,
assignment and read refresh do not invoke Planner. Todo messages and their
resolution belong to Todo; generic Attempts own runtime, physical claims and logs.
No synthetic Task, Plan Node or PlannerInvocation is permitted.

- `POST /v1/owner/todos/discussion/commands`: `DiscussionCommand`, with immutable
  request ID, Todo ID, name and payload. Submit uses `{message_id,content}`.
- Retry/Withdraw use `{source_message_id}`; Stop also binds `attempt_id`. Each
  control action requires `expected_discussion_version`.
- `GET /v1/owner/todos/discussion/commands/:request_id`: original immutable
  `DiscussionCommandResult`, or `unknown`. Command commit and physical settlement
  are distinct; a returned operation remains independently recoverable.
- `GET /v1/owner/todos/:todo_id/discussion`: `DiscussionStatus`.
- `GET /v1/owner/todos/:todo_id/discussion/messages?cursor=...`: `DiscussionPage`.
  Initial Owner page is a bounded recent window in ascending display order; its
  cursor loads earlier history. It never requires downloading the whole thread.
- Todo `/attempts`, `/attempts/:attempt_id`, `/attempts/:attempt_id/logs` and
  `/operations/:operation_id` expose scoped execution facts via
  [`TodoAttemptReads`](../../../apps/server/src/todo-attempt-reads.ts).

## Atomicity and ordering

Messages are append-only; source resolutions are immutable and unique. Reply
provenance binds exact Owner message and source watermark. Later input cannot
change an active launch. A reply may append after a later Owner message: context
cutoffs use the replied-to Owner sequence, not the assistant append sequence.

One Todo control holds current unresolved source and desired Attempt, processed
watermark and independent Discussion epoch. Todo organization version is separate.
`todo_discussion_outbox` is durable selection bookkeeping, not another runtime
queue or capacity pool. Unavailable policies/Runner retain input without creating
a fake Attempt. Selected capacity wait uses existing Attempt QUEUED and shared
Runner capacity. Failed/stopped input remains unresolved until Retry or Withdraw.

Prepare context under configuration → Todo locks. Select in a separate transaction
under configuration → Runner → Todo → Attempt, rechecking exact intent/version.
Never call Runtime selection while retaining the Todo lock from preparation.
Owner Stop/Withdraw discover the current Runner, lock it before Todo, and retry
discovery if the desired Attempt changed. Preserve same-request advisory/replay
guards before fresh effects.

`commit_discussion_turn` atomically appends the reply/proposal, resolves input,
advances watermark, conditionally installs cache, saves receipt, revokes mutation,
admits Stop and retains next intent. A lost reply response cannot duplicate output.
Withdrawal wins or loses the same resolution race, preserves history/cache and
retains the next intent. Successor promotion waits for physical release and all
admitted effects; process absence alone does not release ownership.

## Context and cache

Use fixed managed protocol, actual Owner Planner guidance, optional current Project
context, Original Capture, valid Working Requirement State, deterministic bounded
recent history and exact source. Exclude later input, other Todos and Task state.
Native `read_discussion` is bounded by the same semantic source cutoff and labels
withdrawn input. Provider transcripts are not canonical continuity.

Prepared prompts must satisfy both the UTF-8 byte budget and Dispatch's 262144
Unicode-code-point limit. Individually valid fields can exceed the combined
limit. Preserve the exact input and report `context_budget_exceeded`; do not
admit an invalid Attempt or silently trim the capture/source.

`project_context_version` increments only on actual Project assignment change,
including away-and-back. Frozen context also records a Project-context digest and
configuration provenance. Old-Project replies can commit with original attribution;
their cache cannot overwrite the current Project cache. Unrelated policy changes
do not invalidate cache. Explicit `update_working_requirement_state` compares
resolved watermark, Project epoch and digest; it neither resolves input nor ends
the Attempt. Normal commits update the cache atomically.

## Scope and recovery

Attempt has exactly one Task or Todo FK. Todo implies Planner, zero Node activation,
no Node/revision/resource and a distinct `todo-planner:` owner key. Receipt scope
binds to the Attempt through a composite FK, including when a Todo and Task share
an equal ID. Existing Task dispatches and immutable envelopes retain their meaning.
Stop may omit resource; repository operations require a real resource.

The current Runner inspection path is fixture-only. Todo inspection explicitly
returns an unmet precondition and never exposes that fixture as a Project. Todo
Planner starts in scratch without a workspace. Real resource materialization is
separate implementation work. No live reminder is claimed for the one-shot
OpenCode adapter; exit without formal outcome remains interrupted.

## Required verification

Real PostgreSQL tests must cover concurrent messages/workers, immutable receipt
rollback and replay, no-Runner intent, Todo/Task equal-ID isolation, shared slots,
reply/withdraw races, current-source Retry, Project reassignment/cache CAS,
semantic history cutoff, cursor/byte bounds and authenticated reads. Keep existing
Task/Runtime regression suites passing after nullable scope changes. Native host
evidence must separately prove Todo-scoped commands, no fake Task, actual Runtime
execution and whole-tree Stop/Retry/Withdraw settlement. Browser tests must cover
per-Todo drafts, uncertain commands, recent history and canonical reconnect.

## Validation and examples

| Condition | Result |
| --- | --- |
| Same request and exact body replayed | Original immutable receipt |
| Same request with changed body | Conflict; no new effects |
| Stale source/Discussion version | Rejected; current input retained |
| Retry before process/effect settlement | Unmet precondition |
| No usable Runtime or oversized context | Durable input with factual attention; no fabricated Attempt |
| Todo repository inspection on fixture-only Runner | Unmet precondition; fixture never exposed |
| Old Project turn commits after reassignment | Attributed reply; current cache unchanged |

Base case: one Owner message produces one formal reply and releases its Attempt.
Good case: submit a second message during execution; the next turn consumes it
only after the first resolution and physical settlement. Bad case: treating an
assistant's append sequence as the handled input watermark can consume later
Owner input; always bind the exact source Owner sequence instead.

Wrong: clear the requirement cache when withdrawing the next source, or infer
release from a terminal database row. Correct: retain cache content, advance only
applicable cache watermark metadata, and verify both the captured process identity
and owned cgroup are absent before handing off physical ownership. The database
regression must prove reply → withdrawal → next launch retains the prior state.
