# Ordered Attempt execution logs

Sources: [Runtime](../../../docs/03-runtime-and-execution.md), [formal data](../../../docs/06-state-and-formal-data.md), [Runner execution](../runner/execution-guidelines.md), [wire schema](../protocol/schema-generation.md).

## 1. Scope / Trigger

Use this contract when changing selected Attempt dispatch, Runner output capture, backend Runtime event ingestion, or authenticated Owner Attempt reads. Execution logs are factual Runtime observations; they do not grant Agent authority or complete a Task/Node.

## 2. Signatures

- Selected `Dispatch.log_mode = "ordered_v1"` requires the Runner `Ready.log_modes` declaration before promotion.
- `RuntimeEvent` retains `(attempt_id, stream_id, sequence)` and adds `order_sequence` for one Attempt-wide order. Output entries also carry `data_base64` containing the source bytes; `text` is display text.
- PostgreSQL migration `0011_attempt_logs.sql` adds `attempts.log_visible_sequence`, `attempts.activity_at`, `attempts.exit_observed`, and `attempt_log_entries(attempt_id, order_sequence, stream_id, stream_sequence, body)`. `runtime_events` remains the raw delivery record; `task_events` remains formal history.
- Authenticated Owner reads: `GET /v1/owner/tasks/:task_id/attempts`, `GET /v1/owner/tasks/:task_id/attempts/:attempt_id`, and `GET /v1/owner/tasks/:task_id/attempts/:attempt_id/logs?cursor=...` return generated `AttemptListPage`, `AttemptStatus`, and `AttemptLogPage`.

## 3. Contracts

Runner journal allocation, source offset advance, and event persistence are one transaction. Reconnect resends the original event identity and bytes. The order is Runner observation order across stdout, stderr and objective facts; it makes no claim about simultaneous OS pipe writes. Historical events without `order_sequence` remain decodable but cannot be served as a globally ordered Attempt.

Backend inserts the raw event and ordered index atomically. Exact duplicates are no-ops; same stream identity with different content or one Attempt order assigned to another event is a conflict. `log_visible_sequence` advances only over a contiguous prefix, so a later arrival cannot cause Owner pages to skip a gap. `activity_at` is an observed fact and must not be interpreted as semantic progress.

Owner status distinguishes `QUEUED` from started work, exposes factual `process_absent`, `process_released`, `mutation_allowed`, `visible_sequence`, `latest_sequence`, and optional activity/end reason. Attempt list order is `(created_at DESC, id DESC)`, at most 64 entries per page. Log cursor is canonical base64url of `{version:1,task_id,attempt_id,after}` and is a position, never authorization. An Owner page contains at most 64 consecutive events and stays below the 2 MiB encoded response budget. Only returned entries advance the cursor. `has_more=false` means none was visible at that read; an active or recently stopped Runner may deliver more later. `gap_after` identifies stored entries beyond the visible prefix.

The browser persists a cursor only after rendering or otherwise retaining the returned page. Retrying an unacknowledged page is safe. Log output and any display category remain separate from Task Events, Timeline and formal Planner/Node results.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing Owner session or unknown Task/Attempt | `unauthorized` or `denied_scope` |
| Malformed/noncanonical cursor | `invalid_input` |
| Cursor bound to another Task/Attempt | `denied_scope` |
| Cursor beyond acknowledged visible history | `version_conflict` |
| Legacy Attempt without global order | `unmet_precondition` |
| Missing stored entry within visible prefix or one entry over page budget | `unmet_precondition`; never advance past the gap |
| Exact event retry / conflicting duplicate | Existing record / `payload_conflict` |
| Ordered output without canonical `data_base64` or Attempt order | `invalid_input` |
| Old Runner without `ordered_v1` | Reject selected dispatch before Start |

## 5. Good / Base / Bad Cases

Good: sequence 3 arrives before 2; Owner reads only 1, then 1–3 after 2 arrives, and resumes after a backend restart from the last acknowledged cursor.

Base: a queued Attempt appears in Owner status with no logs or inferred activity; a legacy Attempt remains readable as status but its ordered-log endpoint rejects it.

Bad: a text line saying “done” creates a Task Event, or `has_more=false` is treated as proof that no later Runtime event can arrive.

## 6. Tests Required

`postgres.test.ts` checks exact/conflicting duplicates, gaps, activity and missing formal outcomes. `postgres-reads.test.ts` checks list order, authentication, cursor scope, page byte bounds, restart and gap visibility. `app.test.ts` checks route authentication and malformed input. `attempt-logs.test.ts` checks acknowledgement after browser retention. Runner journal/Adapter/daemon tests check durable ordering, complete raw bytes, spool failure, retransmission and distinct main-exit/whole-tree absence. Real installed CLI evidence must separately exercise selected Node and Planner Attempts, a backend restart with cursor resume, and missing-result physical Stop.

## 7. Wrong vs Correct

Wrong: expose the largest received order or stdout text as formal history, then advance the cursor over a missing entry.

Correct: persist all received evidence, publish only the contiguous ordered prefix, and let formal Tool Protocol commands own lifecycle transitions.
