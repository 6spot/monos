# Post-launch Runtime continuation

Sources: [Runtime contract](../../../docs/03-runtime-and-execution.md),
[coordinator](../../../apps/server/src/runtime-continuation.ts),
[state](../../../apps/server/src/runtime-continuation-state.ts),
[migration 26](../../../packages/db/migrations/0026_runtime_continuations.sql).

## Scope and admission

Authenticated Runner `exited` or `process_absent` events may carry
`runtime_failure: native_terminal_error`. The backend never inspects log prose or
infers failure from silence, a nonzero code alone, offline facts or capacity.
Only a current RUNNING canonical source with live mutation authority and a frozen
policy chain can admit continuation. Successful formal outcomes, admitted Node
completion, admitted requirement publication and retained capture failure suppress it.

`recordRuntimeContinuation` runs inside event ingestion's Runner → Task/Todo →
Attempt transaction. It retains the event, marks the Attempt FAILED/runtime_error,
revokes Start, admits/reuses its exact Stop, and creates one continuation. It does
not first project missing-formal-outcome attention. The event, Stop and successor
bindings are immutable; replay cannot schedule a second successor.

## Settlement and source ownership

`RuntimeContinuation.pump(limit = 8)` takes configuration SHARE → Runner → Task/Todo
→ Attempt → continuation locks. Discovery is not authority. Before preparation it
requires successful exact Stop, `process_absent`, `process_released`, all predecessor
operations terminal and all its leases released. Existing whole-Task Review/Replan
barriers still apply. Per-candidate `CommandError` records reason/last-check time
after rollback so an unavailable source does not starve other owners.

Six explicit owning-module integrations inspect, prepare and exhaust their sources:

| Source | Preserved obligation |
| --- | --- |
| Node | Node, activation, effective Spec/Plan and workspace lineage |
| Initial planning | Task and initial Specification lineage |
| Todo Discussion | Same ordered unresolved message and cutoff |
| Task Conversation | Same input, watermark and reply-only restrictions |
| Replan | Same unresolved request and proposal/issue authority |
| Review | Same operation, purpose, feedback/reconsideration and semantic basis |

Each builder creates fresh immutable context using current formal records and
Project/Role configuration. No opaque CLI session or raw execution history is
copied. A new source plus `successor_planned_attempt_id` commits as `prepared`;
the ordinary source pump selects/queues separately using the frozen policy suffix.
Initial planning uses explicit Runtime-predecessor provenance, never a fabricated
Owner Retry receipt. SQL constraints validate source-family parity and exact lineage;
the common Task Planner owner key alone is insufficient.

Prepared-source validity is checked using the successor ID. A temporary freeze,
input ordering barrier or capacity wait does not invalidate a current source.
Resolved/withdrawn input, replaced source, Owner Stop/Cancel or committed formal
outcome supersedes the pending handoff. Source-specific Owner controls remain
available before any successor Attempt exists; Todo uses its retained predecessor.

## Chain and resolution

Attempts retain `runtime_chain_root_id`, increasing `runtime_target_index`, unique
`runtime_predecessor_id` and immutable `selection_context.policy_targets`.
Automatic selection uses only the remaining ordered targets on the original Runner.
Policy edits affect fresh context and later explicit retries, not this chain.
Explicit target roots have one element. Unknown/offline installation facts wait;
full capacity queues the selected target. No fallback causes implicit transfer.

Continuation states are `settling`, `prepared`, `queued`, `exhausted`, `superseded`.
`resolved_at` distinguishes an exhausted decision whose factual source projection
still waits on a temporary guard. Such a row remains active but cannot choose
another target. Once projection applies, close it exactly once. Obsolete sources
are superseded. Context-budget failure similarly leaves one retained failed source.

Capture failure has precedence even after terminal Runtime evidence or physical
release. `failRuntimeContinuationCapture` projects attention for any still-pending
handoff through its source owner, preserving explicit Owner Retry. Merely marking
it superseded would strand Planner inputs as running. Already queued handoffs are
resolved records; the trusted Runner must retain terminal evidence before reporting
release, and replay must not mutate acknowledged events.

## Verification and limits

The two `postgres-runtime-fallback-{node,planner}.test.ts` suites cover real database
lock contention, multi-hop frozen policy, source identity, Stop/lease settlement,
capture-event ordering, Owner exits, exhaustion and formal-outcome precedence.
Run affected real PostgreSQL suites plus protocol TS/Go parity when transport or
constraints change. Runner tests own native envelope parsing and durable replay.

No local test proves installed Linux/model acceptance. Selected queued work that
loses its Runtime before Start still uses existing cancellation/Owner recovery.
Ordinary exits without verified native failure retain missing-outcome behavior.
