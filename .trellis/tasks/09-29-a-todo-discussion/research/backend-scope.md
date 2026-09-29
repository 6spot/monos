# Todo Planner scope research

Sources: architecture modules 01–08, especially module 02's Discussion turn contract,
module 05's authority matrix/recovery and module 06's persistence map; backend specs
for Todo, dispatch, Runtime scheduling, Owner commands and execution logs. Capture
baseline: `9c3ce55`. Findings are source inspection, not runtime acceptance.

## Existing coupling and smallest compatible extension

| Boundary | Current assumption | Required extension |
| --- | --- | --- |
| `0001_boundary_probe.sql`, `0005_task_records.sql` | Every Attempt has a Task; receipts reference Tasks; composite revision/Node FKs use Task | Nullable Task plus Todo FK, exactly one owner scope; Todo implies Planner/no Node/no revisions. Preserve existing Task rows and constraints. |
| `dispatch-queue.ts` | `QueueInput` requires Task, ControlBasis and resource; enqueue/promotion locks a RUNNING Task; owner=`planner:task`; locality pins Task | Explicit Todo input branch, frozen Discussion epoch/source binding, owner=`todo-planner:todo`; no Task state/revisions/locality for repository-less Todo. Keep shared Runner reservation, fence, priority, Start and owner indexes. |
| `runtime-scheduling.ts` | Policy selection itself is generic, but forwards Task fields; requires current Runtime before enqueue | Forward discriminated owner input. Persist input/scheduling intent before selection so offline/policy-unavailable work exists without an invented Attempt. |
| `service.ts:lockAttempt` | Runner → Task → Attempt for authorization, commands, events, recovery and operation settlement | Runner → the actual Todo or Task → Attempt → operation. Returning a discriminated locked scope prevents null-Task dereferences. |
| `domain/commands.ts`, `service.ts:admit` | `scope_id=attempt.task_id`; planner permits only inspect/commit_task_turn; Task version/resource fixture guard | Resolve scope from immutable Attempt owner; Todo permits only scoped history, cache rebuild, read-only Project inspection and Discussion commit. Deny Task/Node commands even if Todo/Task IDs coincide. |
| `service.ts:missingFormalOutcome`, capture failure | Always bump Task control/write task_events | Todo failure ends Attempt and admits Stop, leaves current source unresolved with Retry/Withdraw; no Task event/state. Late output after formal reply cannot reopen it. |
| `service.ts:admitEffect`, Operation | Always copies launch.resource_id, including Stop | Stop has no required resource; repository operations carry the actual validated command resource. No dummy repository for Inbox. |
| `owner-execution.ts` | Stop/retry receipts, targets, initial Planner and reads are Task-only | Todo-specific Owner commands/receipts/source guards; preserve existing Task routes. Reuse physical-stop primitives, not Task state changes. |
| `owner-reads.ts` | Attempt status/list/log cursors and operation status require Task | Parallel Todo routes/contracts; share byte/order/gap logic where useful. Validate Todo ownership before loading Attempt logs. Keep old Task wire/cursors valid. |
| `main.ts`/`service.pending` | Only selected Runner outbox is pumped | Bounded in-process Discussion intent pump on startup/timer; durable DB source survives lost wakeups, unavailable Runtime and browser disconnect. |

## Storage and FK hazards

- Add append-only Discussion messages, immutable source resolutions (reply versus
  withdrawal, unique source), one current requirement cache per Todo, and durable
  next-turn scheduling intents. Source-processing facts belong to Todo/messages;
  do not introduce a PlannerInvocation/Turn lifecycle domain.
- Existing `outbox` requires Runner and Attempt and admits only Start/effect. An
  unresolved scheduling intent cannot fit without migration. A small Todo-owned
  outbox is preferable to weakening every existing Runner outbox constraint; it
  is delivery bookkeeping, not another queue/capacity authority.
- `command_receipts.scope_id REFERENCES tasks` must change. Preserve referential
  integrity with a generated Attempt scope ID plus `UNIQUE(id,scope_id)` and a
  composite receipt FK `(attempt_id,scope_id)`, or an equivalent explicit binding.
  Simply removing the Task FK loses an important database contract.
- PostgreSQL composite FKs use MATCH SIMPLE: once Task is nullable, they alone do
  not forbid Todo Attempts carrying Node/revision IDs. Add an explicit Todo shape
  CHECK. Scope identity/owner key must be immutable after admission.
- Preserve `one_unresolved_owner`, `one_queued_owner`, `one_start_intent`; use a
  distinct Todo owner prefix to prevent equal Task/Todo IDs sharing a claim.
- Operations, runtime_events, attempt_log_entries and Runner inventory already
  attribute by Attempt and can retain their tables. `task_events` must remain
  Task-only. Existing Owner Task proposal/authorization tables also stay Task-only.

## Frozen context, project changes and ordering

- Discussion control epoch is independent of Todo organization version. Appending
  later Owner input must not stale the current source; assignment/archive/cache
  updates must not silently rewrite its launch.
- `todos.project_context_version` is a monotonic association epoch, incremented on
  actual Project changes including Inbox and away→back. Each frozen context records
  source Project ID/epoch, configuration version and a digest of the exact injected
  Project context/resources. Configuration version is provenance; cache installation
  compares current Project ID/epoch/digest, avoiding unrelated policy-edit invalidation.
- Old-Project replies still commit with original attribution and resolve their input.
  Only current cache installation is suppressed; retain its old attributed state as
  history so later rebuild is explainable. No automatic model call for assignment.
- UI history has monotonic append order, but semantic cutoff is source Owner order.
  An earlier-source reply may append after a later Owner message, so filtering all
  messages by append sequence ≤ source watermark is wrong. Include Owner input through
  the source and earlier-source replies/resolutions; label withdrawn sources. Apply
  the same bound to native `read_discussion`, not only initial prompt construction.
- `update_working_requirement_state` is an explicit nonterminal cache CAS against
  resolved watermark and Project binding. Normal `commit_discussion_turn` atomically
  appends reply/proposal, records resolution, advances watermark, conditionally updates
  cache, fences Attempt, admits Stop, writes receipt and creates next intent.

## Lock order and races

1. Owner authentication → configuration SHARE → request advisory lock → Todo for
   message persistence/frozen intent creation; no Runner selection inside this lock.
2. Selection is a separate transaction: configuration → stable intent/Attempt identity
   serialization → Auto Runner table barrier or selected Runner row → Todo → Attempt
   → operation/outbox. Validate immutable intent/source epoch under Todo lock.
3. Existing Runtime writers preserve Runner → one actual scope → Attempt → operation.
   Never select Runtime while holding Todo, never scan while retaining several scope
   locks, and do not lock an outbox row before Runner if reply commit locks it afterward.
4. Withdraw versus commit serializes on Todo; only one source resolution wins. Stop
   binds exact source+Attempt+Discussion epoch. Retry retains source and needs prior
   physical release/settled effects; withdrawal can resolve immediately but successor
   promotion waits for the old owner. Process-absence alone does not release capacity.
5. A failed/stopped source blocks later sources. Pre-start Runtime cancellation must
   leave durable source attention/reconsideration, not silently consume the intent.

## Wire/Runner impact

Keep Task Dispatch compatible; add strict `todo_id` XOR `task_id`, required Todo
`source_message_id`, Planner kind and zero Node activation, with no Todo resource/Node
ID. `scope_id` remains generic; local CLI currently obtains it from `d.TaskID` at
`runner/internal/local/socket.go:98` and must resolve the actual owner. Add native
`commit_discussion_turn`, `read_discussion`, `update_working_requirement_state`.
Make Operation resource optional only for Stop. Go optional strings become pointers:
host/journal identity comparisons must compare values/nil, never pointer addresses.

## Verification needed

Real PostgreSQL: mixed Task/Todo capacity and equal-ID isolation, identical and changed
receipt races, no-Runner durable input, ordered concurrent messages, source-cutoff
history, commit/withdraw winner, receipt rollback, stopped/failed-source blocking,
whole-tree settlement before successor, Project reassignment and away→back cache CAS,
retry after restart, bounded Unicode messages/replies/logs and malformed scopes.
Run existing Task/Runtime suites after nullable-FK/generalized-lock changes. Native
CLI/Go fixtures must cover repository-less dispatch/Stop and new commands; real model
and restart evidence remains the parent session's integration work.
