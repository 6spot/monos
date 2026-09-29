# Todo capture and lifecycle

Sources: architecture modules [01](../../../docs/01-product-and-domain.md),
[05](../../../docs/05-tool-protocol.md), [06](../../../docs/06-state-and-formal-data.md)
and [07](../../../docs/07-owner-review-and-ui.md). Implementation:
[`Todos`](../../../apps/server/src/todos.ts), migration
[`0013_todos.sql`](../../../packages/db/migrations/0013_todos.sql).

## 1. Scope / Trigger

Use for Todo capture, Project assignment, archive/restore, list/detail and command
recovery. Capture and opening a Todo never enqueue Runtime work or create a Task
or Discussion message. Original Capture is immutable Owner text.

## 2. Signatures

- `POST /v1/owner/todos/commands`: generated `TodoCommand` discriminates
  `capture_todo`, `assign_todo_project`, `set_todo_archived`.
- `GET /v1/owner/todos/commands/:request_id`: `TodoCommandResult` is `committed`
  with the original Todo snapshot, or `unknown` without a Todo.
- `GET /v1/owner/todos/:todo_id`: `TodoRecord`.
- `GET /v1/owner/todos?scope=all|inbox|project|archived&project_id=...&cursor=...`:
  `TodoPage`; `project_id` is required only for `project` scope.
- Tables: `todos` and immutable `todo_command_receipts`. No delete route.

## 3. Contracts

Authenticate Owner → configuration SHARE lock → same-request advisory lock →
receipt lookup → Todo row lock/version check → atomic record and receipt COMMIT.
Same-ID replay returns its original snapshot even after organization or Project
changes; never replace it with a newer record. A changed digest conflicts.

Capture payload is `{todo_id, original_capture, project_id?}`. Organization
commands additionally bind `expected_control_version`; omitting `project_id`
returns the Todo to Inbox. Newly selected Projects must be active. No-op
organization commands retain the Todo version. Moving a Todo never migrates
existing Tasks. Original text, ID and creation time are protected by DB trigger.

Capture permits at most 65,536 characters and 256 KiB UTF-8, rejects blank/NUL or
malformed text, and never trims stored content. `label` derives deterministically
from the first meaningful line, capped at 160 Unicode codepoints. `created_at`
and `discussion_activity_at` have millisecond precision; organization does not
advance Discussion activity.

Pages use descending `(discussion_activity_at,id)`, at most 64 records and 2 MiB
encoded bytes. Canonical base64url cursors bind version, scope, optional Project
and exact timestamp/ID position. Only returned records advance the cursor.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid/missing Owner session | `unauthorized` |
| Unknown Todo or cross-scope cursor | `denied_scope` |
| Malformed capture/query/cursor | `invalid_input` |
| Reused request with different digest or duplicate Todo ID | `payload_conflict` |
| Stale organization version | `version_conflict`; retain draft |
| New assignment to missing/archived Project | `unmet_precondition` |
| Lost command response | Look up/replay same immutable request |

## 5. Good / Base / Bad Cases

Good: two tabs retry one capture and observe one exact Todo with no Attempt.
Base: archive/restore changes its organization while preserving original text and
activity ordering. Bad: confirming an old receipt overwrites a newer UI record or
an assignment races Project archive without the shared configuration lock.

## 6. Tests Required

[`postgres-todos.test.ts`](../../../apps/server/test/postgres-todos.test.ts)
verifies pure capture, exact replay/conflicts, immutable rows, receipt-failure
rollback, per-Todo versions, Project locking/eligibility, archive/restore,
scope/cursor/byte bounds and authenticated native HTTP routes. Shared protocol
fixtures cover malformed commands, cursors and result variants. Run real DB
checks on the same-host test network: multi-query tests can exceed their normal
deadline over a high-latency SSH tunnel without a product assertion failure.

## 7. Wrong vs Correct

Wrong: invoke Planner from capture or selection, trim the original idea, rebase a
stale organization draft automatically, or create another request after timeout.
Correct: persist exact capture only; let explicit future Discussion messages
invoke Planner; recover immutable commands and reload current projections.
