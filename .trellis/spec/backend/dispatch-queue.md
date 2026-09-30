# Durable selected Attempt dispatch

## 1. Scope / Trigger

Use `apps/server/src/dispatch-queue.ts` for already selected system work awaiting
capacity. Runtime/model selection is owned by [Runtime scheduling](runtime-scheduling.md);
Owner Start and semantic context construction are owned by [Task planning](task-planning.md),
[Node execution](node-execution.md) and [Task Conversation](task-conversation.md). Existing WSS `pending` polling promotes durable
queued rows; memory wakeups are not authoritative.

## 2. Signatures

- `DispatchQueue.enqueue(tx, QueueInput)` returns a stable dispatch ID and persists
  selected context, exact revision basis and canonical input digest.
- `promoteNext(runnerId, connectionInstance, incarnation)` atomically claims one
  eligible queued Attempt and returns its Dispatch, or null when none can run.
- Migration 6: `attempts.state`, `queue_digest`, `end_reason`, one queued owner,
  one Start intent, and `task_runner_locality`.
- Migration 10: nullable `selection_context` on Attempts and the Runner's complete-report incarnation. Legacy probe rows remain valid.

## 3. Contracts

QUEUED has no process reservation (`process_released=true`, mutation disabled).
It is omitted from Runner inventory and cannot get tool credentials or send Runtime
events. Capacity waiting is normal and does not make Task BLOCKED.
Canonical source-bound Node admission sets Node RUNNING at enqueue, even while
the Attempt is QUEUED. Its frozen Project map/reservations and source digest must
survive later configuration edits unchanged.

Promotion requires a ready connection owned by the current backend and matching
incarnation, free physical capacity, current Task/revision/activation basis and
settled previous owner. Canonical Conversation validates its independent source
epoch/input watermark, not the global execution control version; it shares the
`planner:<task>` owner with initial planning. Its authenticated scratch-only scope
may overlap a held Task workspace without acquiring writable access, while shared
capacity, locality and previous Planner settlement still apply. Lock Runner -> one Task -> Attempt. Filter blocked owners
before LIMIT and never hold several Task locks while scanning. Stage A serializes
Node writers within one Task until isolated parallel worktrees are implemented.
Selected production Attempts recheck current installation facts before Start. A complete current report of missing/unavailable Runtime cancels pre-start work; an omitted report or disconnected sole Runner leaves it queued. Stale heads are retried in separate transactions, at most 16 per poll, so one transaction never holds several Task locks.

Set RUNNING, physical reservation, monotonic owner fence, Node RUNNING and the
single Start outbox row in one transaction. A failure before commit leaves QUEUED;
a lost return after commit recovers the same dispatch/outbox. Replay of enqueue
requires the same full input digest. Do not silently refresh stale queue context:
cancel it with `stale_queue_basis` for the owning module to reconsider.

Pin Task locality on first claim. Other recorded execution hosts require explicit
reconciliation; reject automatic transfer. Stale cancelled queue-only selections
do not establish workspace ownership. Node dependencies require current completed
activation evidence, not merely a COMPLETED label.

Missing formal outcome sets FAILED and admits Stop, retaining capacity until whole
process absence and all operations settle. Completion succeeds only with finalized
result; committed Planner reply succeeds logically while Stop still owns cleanup.
Late started/output/exit records do not revive terminal status or mutation authority.
Event ACKs identify exact sequences; they do not acknowledge missing lower sequences.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Same Attempt ID and input | Same dispatch ID |
| Same Attempt ID, changed input | `payload_conflict` |
| Unknown Runner/Task/Node | `denied_scope` |
| Duplicate queued owner, wrong Task/Node state, missing upstream evidence | `unmet_precondition` |
| Changed enqueue basis | `version_conflict` |
| Unavailable/stale connection, full capacity or unresolved owner | No promotion |
| Queue becomes obsolete | CANCELLED queue row; no Start |
| Unsupported Runner movement | Rejected enqueue or cancelled queue with explicit reason |
| Duplicate/conflicting event | Existing effect / `payload_conflict` |

## 5. Good / Base / Bad Cases

Good: two promotion workers contend for one slot and create one Start. Base: a
backend restart reconnects and retransmits the existing outbox identity. Bad:
terminalizing an Attempt frees capacity before its physical writer disappears.

## 6. Tests Required

`postgres-dispatch.test.ts` verifies queued visibility/identity, concurrent capacity,
independent SIGKILL before/after promotion commit, restart replay, stale queue basis,
late/duplicate events, Stop settlement/fence advancement, locality and dependencies.
Run all real DB suites because fixture admission and existing event/effect handlers
share the migration. No real model is invoked by this verification.

## 7. Wrong vs Correct

Wrong: send Start then persist the Attempt, or allocate an in-memory-only queue.
Correct: persist QUEUED, atomically claim and commit the durable Start, then send
through the existing authenticated at-least-once Runner channel.
