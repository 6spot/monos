# Canonical Owner reads and formal-event cursors

## 1. Scope / Trigger

Task overview, Timeline pagination and reconnect state. `owner-reads.ts` rebuilds
answers directly from canonical tables; no separate lifecycle cache or Timeline
table is authoritative.

## 2. Signatures

- `GET /v1/owner/tasks/:task_id` -> generated `TaskOverview`.
- `GET /v1/owner/tasks/:task_id/events?cursor=...` -> generated `TaskEventPage`.
- `taskEventCursor(taskId, after)` encodes a canonical versioned Task-bound position.

## 3. Contracts

Authenticate the Owner session on every request, then hold a Task share lock while
assembling consistent control/Node/Attempt/operation counts or an event cutoff.
Missing Plan is omitted from JSON. Physically held and queued Attempts are distinct.
Raw Runtime events/log text cannot change the derived overview or enter Timeline.

Only `task_events` supplies ordered formal history. Cursor base64url decodes to
canonical `{version:1,task_id,after}` with a safe nonnegative sequence. It is a
position, not an authorization token. Return at most 64 events and less than the
2 MiB encoded response budget; only returned events advance the cursor. Stable
Task+sequence identity lets clients deduplicate an at-least-once page retry.

Missing contiguous history or an ahead-of-history cursor returns `reset_required`
with no fabricated events. Refresh the authoritative overview and resume after
its event cursor; display unavailable history explicitly. Empty polling retains
the same position. No history pruning is implemented by this API.

Runner paths in event bodies remain opaque locators. This reader performs database
queries only; content retrieval must later use the owning Runner/service boundary.
Browser UI and SSE bindings consume these contracts in their own implementation.
Selected Attempt status and ordered raw-log cursors use the separate [execution log contract](execution-logs.md); Task event cursors never include raw output.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Wrong/revoked/expired credential | `unauthorized` |
| Unknown Task or cursor for another Task | `denied_scope` |
| Malformed/noncanonical cursor or unknown query field | `invalid_input` |
| Missing sequence or future cursor | `reset_required`, refresh snapshot |
| One event exceeds byte limit | `unmet_precondition`; do not advance |
| Same cursor before new events | Identical immutable page |

## 5. Good / Base / Bad Cases

Good: reconnect at sequence 64 reads 65 onward, including newly appended events.
Base: a new service instance rebuilds the same overview. Bad: a log saying
“COMPLETED” changes Task state or creates a Timeline entry.

## 6. Tests Required

`postgres-reads.test.ts` covers real command completion/rebuild, raw log separation,
64-item paging/replay/restart, UTF-8 byte budgets, opaque Runner paths, missing/future
positions, cross-Task scope, authentication/revocation and PLANNING without a Plan.
Shared TS/Go fixtures and OpenAPI are generated from the same read schemas.

## 7. Wrong vs Correct

Wrong: infer completion from stdout or serve a Runner filesystem path locally.
Correct: read canonical control and formal events; request Runner-owned content
through the authenticated service boundary when that feature is implemented.
