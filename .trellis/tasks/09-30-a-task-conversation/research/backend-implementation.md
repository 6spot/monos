# Task Conversation backend implementation

## Scope and ownership

Implemented the backend/database/shared protocol portion of
`09-30-a-task-conversation` in the shared checkout. No commit, deployment, service
change, new permanent process or archived-task change was performed by this
implementer. Root owns acceptance, probes, final specs and release. Runner changes
and the independent review/lifecycle suites are owned by their respective workers.

## Product changes

- `apps/server/src/task-conversation-state.ts` owns independent message ordering,
  immutable source/head/epoch, bounded Task-only context/history, exact source
  assertions and atomic reply/routing/resolution/watermark/Planner Stop.
- `task-conversation.ts` owns authenticated Owner submission, command recovery,
  input/issue/guidance Retry and Withdraw, conversation Stop, durable preparation,
  Runtime selection and guidance follow-up pumping. Receipt replay is checked
  again after acquiring the Task lock. Failed input keeps the original message;
  Retry creates a fresh source. Issue Retry retains the existing open obligation
  until a new disposition takes responsibility.
- `task-conversation-reads.ts` owns bounded typed operation/recipient pages.
  Status summaries contain at most 64 rows per kind and explicit completeness
  flags; input summaries follow message sequence so the current head cannot
  disappear behind unrelated identities. Recovery versions are JSON numbers.
  Recipient records distinguish frozen source, dispatch inclusion and supervised
  launch; none claims that the provider understood or handled the instruction.
- `task-guidance.ts` owns durable guidance, activation obligations, exact frozen
  assignments, pre-Plan binding, semantic issue/answer routing and controlled
  follow-up. Withdrawal of assigned guidance stops the old source and retains
  necessary continuation; withdrawal of late guidance during frozen completion
  can cancel an unnecessary follow-up without changing that manifest.
- Existing queue/scheduling/service hooks preserve `planner:<task>` ownership,
  ordinary capacity and Task-host locality. Only canonical scratch-only Task
  conversation bypasses blanket Task workspace exclusion; Planner physical
  ownership still serializes initial planning and conversation. Conversation
  failure, `capture_failed`, reply and input controls do not advance execution CAS.
- Existing planning/records/Node hooks bind guidance at Plan publication and
  fresh source creation. Completion freezes explicit handling in version 2
  manifests and settles only declared active obligations after trusted success.
  Owner Stop survives completion admission through `guidance_paused`; explicit
  Continue cannot invent guidance-free rework. The ordinary ended-Attempt pump
  recognizes durable guidance follow-ups instead of misclassifying their Stop as
  factual Runtime failure. Exact saved planning/blocker answers are consumed only
  on explicit Owner Retry. Actual accepted delivery, not proposal/confirmation,
  prevents local cancellation/action routing.
- `apps/server/src/app.ts` exposes authenticated routes; `main.ts` uses the existing
  backend pump. `packages/domain/src/commands.ts` separates conversation source
  authority from the current execution basis required for action routing.

## Public contract

`TaskConversationCommand` contains `schema_version:1`, `request_id`, `task_id`,
`name`, optional `expected_version`, and `payload`:

- `submit_task_message {message_id,content}` has no execution CAS.
- `retry_task_input`, `withdraw_task_input`, `stop_task_turn` target
  `{operation_id}` and the exact input/guidance/issue operation version.

Owner routes:

- POST `/v1/owner/tasks/conversation/commands`
- GET `/v1/owner/tasks/:task_id/conversation`
- GET `/v1/owner/tasks/:task_id/conversation/messages?cursor=&query=`
- GET `/v1/owner/tasks/:task_id/conversation/commands/:request_id`
- GET `/v1/owner/tasks/:task_id/conversation/operations?cursor=`
- GET `/v1/owner/tasks/:task_id/conversation/guidance/:guidance_id/recipients?cursor=`

Dispatch `task_conversation_source` binds source/input/watermark/conversation
version/context digest/reply-only authority, is exclusive with other source types,
and requires matching outer watermark/control version and empty canonical workspace
reservations. Canonical `commit_task_turn` carries exact source/input/watermark,
reply and routing. Routing kinds are `reply`, `guidance`, `issue`, `answer`,
`resolve_guidance`. Legacy `reply_only` remains explicit-probe-only. Action routing
requires current `TaskActionBasis`; reply records the source-captured observation
without forcing an execution mutation. `read_task_context {}` and
`read_task_history {cursor?,query?}` remain source scoped. Context is a bounded
canonical JSON snapshot string within a typed response.

`complete_node.handled_guidance_ids` is unique/bounded and accepts absent or empty
as no handling; null is invalid. Recorded planning-issue answers permit explicit
`retry_initial_planning` with `issue_sequence` and no repeated `answer`; an answer
without issue sequence remains invalid. Shared schema, fixtures, TS/Go consumers
and OpenAPI paths/query parameters were regenerated together.

## Database and compatibility

Additive migration `packages/db/migrations/0019_task_conversation.sql` is registered
in `packages/db/src/migrate.ts` (reported schema version 19). It creates Task
input/message/source/resolution, guidance/obligation/assignment/follow-up and
issue/answer records. Guards enforce immutable source/message/resolution/content,
same-Task/input/source/reply/Attempt attribution, exact Node/activation ownership,
and JavaScript-safe counters. Guidance assignments must match the exact frozen
`source.context.guidance.items`; a deferred source trigger requires all frozen
items to receive their assignments within the same transaction. JSON handling IDs
are checked for string type and uniqueness before text coercion.

Existing version 1 completion digests, operation identities, launch bytes and
receipts keep their original meaning. New version 2 manifests bind handling IDs.
No historical source or guidance authority is invented. Future paired accepted
delivery operation/cutoff columns have no public setter; direct SQL contract
fixtures establish the boundary only, not provider delivery. Cancelled correction
pairs settle no handling; already-finalized/retry success settles only the original
manifest. Later guidance retains separate responsibility and historical evidence.

The final independent SQL review reproduced mutable handled-obligation completion
attribution. Migration 19 now makes all non-pending obligation dispositions
immutable, pairs handled status with a completion operation, and defers an exact
successful completion/manifest/assignment check until COMMIT. It joins matching
Task, Node, activation, Attempt, source and manifest digest/declaration with
`node_completions`; deferral preserves the existing atomic projection order.

## Tests and checks executed

All PostgreSQL runs use the private existing forwarded URL read into subprocess
environment from `/tmp/monos-task-planning-db-url`, with unique temporary schemas;
credentials are never printed. The root `test:db` command registers all four new
conversation suites.

- Main `postgres-task-conversation.test.ts`: original **13/13 passed**, 72.62 s.
  Covers input order/replay, no-Runtime withdrawal, execution version isolation,
  atomic stale-action rejection/rollback, pre-Plan required handling, controlled
  same-activation Stop, frozen completion/later reactivation, accepted cutoff,
  withdrawal continuation, Owner Stop precedence and numeric bounded reads.
- Later combined run of main + independent-process conversation + existing Task
  records + dispatch: **34/34 passed**, 74.27 s (started 2026-09-30 07:37:17 tool
  local time). Includes the strict frozen-assignment migration checks in normal
  source creation. Earlier new/old initial-planning/Node combined gate passed
  **71 tests** before the later focused additions.
- Four additional targeted cases in the main suite: **4/4 passed**, 48.97 s
  (started 07:42:55). Three combine original assigned handling, late guidance and
  hard completion recovery: same-operation Retry, cancelled correction pair and
  already-finalized pair. They assert unchanged original manifest, correct old
  handling evidence, pending later responsibility and fresh same/new activation.
  The fourth verifies an active ordered head stays recoverable with 65 queued
  inputs and that operation pagination returns every target. The main suite now
  contains **17 cases**, covered by the complete 13-case and targeted 4-case runs;
  a complete 17-case rerun is left to root's final combined gate.
- `postgres-task-conversation-process.test.ts`: **4/4 passed**. Two independent
  PostgreSQL backend PIDs are observed waiting on Task locks for input admission
  and source preparation/selection. Separate admission worker SIGKILL before/after
  COMMIT verifies rollback or exact durable receipt/resolution/guidance/Stop/outbox.
- Process + independent-review suite combined: **10/10 passed** before the final
  stricter frozen-assignment fixture adaptation; reviewer owns that latest rerun.
- `postgres-task-conversation-lifecycle.test.ts`: worker reports **11/11 passed**,
  112.35 s. See `lifecycle-tests.md` for exact assertions, intermediate findings
  and evidence boundaries. Independent reviewer owns its protocol/SQL tests.
- `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm protocol:check` and native stripped-TS
  import of `apps/server/src/app.ts` passed at the stable implementation checkpoint.
- `pnpm test`: **263 passed, 246 skipped** at that checkpoint. The skips are gated
  PostgreSQL tests, covered separately where noted. Runner worker also reports
  generated Go consumer `go test ./...` and `go build ./cmd/...` passed.
- Final post-addition targeted PG, typecheck, `pnpm lint`, `pnpm protocol:check`
  and `git diff --check` passed. OpenAPI query-only generation was run successfully.

The first new hard-recovery test run failed at a test-only receipt wrapper access
(`recovery.result` rather than the fixture's direct result); it was corrected,
typechecked and all three scenarios then passed without a product change.

The first complete 17-case rerun after the terminal-attribution SQL fix (started
07:53:22) passed its first five cases, then lost the private PostgreSQL forward
(`Connection terminated unexpectedly`, later `ECONNREFUSED 127.0.0.1:15439`).
The remaining 12 cases failed due to the connection/cleanup cascade; this run is
not a passing gate. Root is restoring the existing tunnel for a clean rerun.

## Remaining acceptance boundaries

Root owns final full TS/PG/Python/Go/Linux gates, independent review closure,
installed native CLI and real private-Git/process/lease/restart evidence. Synthetic
Stop/workspace results above prove database guards only. This backend assignment
does not claim physical process absence, provider consumption, real delivery,
Task Conversation UI, exact Specification revisions or replacement Plans.

Owning specs should include the new reads module/routes/completeness flags and
transport-only recipient statuses, and remove the old Node spec statement that
nonempty handled guidance IDs are unsupported. Parent already received these
specific follow-ups. No additional service is needed.

## Root final combined gate

The later verified Linux snapshot ran the complete DB command successfully:
**254 tests in 22 files**, including all **17** main Conversation cases, reviewer8,
lifecycle11 and process4. This supersedes the interrupted private-forward rerun
for acceptance without relabeling its failed execution as passing. Source manifest
and logs are recorded in ../verification.md and
`/root/monos-conversation-deploy-v1/docker-postgres-tests.log`.
