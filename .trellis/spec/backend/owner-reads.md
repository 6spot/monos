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
queries only; [result content retrieval](result-content-reads.md) uses the owning
Runner/service boundary.
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
through the authenticated service boundary.

## Execution UI collection, results and diagnostics

### Scope and signatures

These read-only projections add no lifecycle/receipt/DB model:

- `GET /v1/owner/tasks` → `TaskListPage` (`task-board-reads.ts`).
- `GET /v1/owner/tasks/:task_id/results?cursor=...` → `TaskResultPage`
  (`task-result-reads.ts`).
- `GET /v1/owner/tasks/:task_id/attempts/:attempt_id/workspace` →
  `AttemptWorkspaceStatus` (`task-workspace-reads.ts`), no query parameters.

### Contracts

Board query fields are `project_id`, `column` (ready/running/review/done/cancelled),
`attention` (all/needed), `history` (active/all), and `cursor`. Defaults are all
attention and active history. Canonical keyset cursor binds every filter and the
exact creation-time/Task-ID position; pages hold at most 32 Tasks and fit the
2 MiB encoded budget. Counts use effective Plan membership, current activation,
actual running/queued/held Attempts and open effects. Up to 16 attention targets
carry explicit overflow; queueing alone is not attention. `canonical_execution`
is a read hint, never a permission or substitute for command guards.

Preserve PostgreSQL's exact cursor timestamp text, including valid timezone offsets
`±HH`, `±HH:mm` and `±HH:mm:ss`. A legacy NULL-created Task normalizes to epoch;
under historical Singapore timezone that can be `1970-01-01 07:30:00+07:30`.
Do not assume current whole-hour offsets or change the database timezone to mask
cursor decoding defects. The real PG regression covers the tied legacy pagination.

Results page by original completion operation ID, at most 32 and below 2 MiB.
Successful exact manifests/effects retain original Spec/Plan/Node/activation/digest.
`current` additionally requires current completed membership/activation plus an
exact carry chain through Specification/Replan applicability. Replacement,
refresh and cancellation cannot grant current applicability. Repository-free
results have `git:null`. Git metadata matches the original successful operation,
workspace and lease; do not relabel history using a later workspace head.
`admitted_at` is completion-operation admission, not the time work completed.
Git results advertise the canonical full `identity_digest` used by the separate
[content read contract](result-content-reads.md); historical result attribution
remains original even when content responses refresh current applicability.

Attempt diagnostics authenticate exact Task+Attempt ownership. `execution` exposes
only recorded Runtime/model/thinking level, with null for unknown, not current
configuration or launch prompt/session/token material. Up to 64 workspace leases
fit the 2 MiB budget; overflow rejects explicitly instead of truncating silently.
Snapshot metadata comes from identified successful open/settle effects. A successful
`settle_completion` child may supply retained checkpoint metadata while the
original completion pointer/state remains; validate the same Attempt, lease and
immutable descriptor. `metadata_operation_id` identifies the actual source. These
facts do not establish completed-result applicability. No backend Runner-path read.

### Validation and errors

| Condition | Result |
| --- | --- |
| Board cursor bound to other filters / result cursor for other Task | `denied_scope` |
| Invalid/noncanonical cursor or unknown query | `invalid_input` |
| Unknown Project/Task or Attempt outside Task | `denied_scope` |
| Inconsistent exact Git result/metadata or exceeded atomic diagnostic bounds | `unmet_precondition` |
| Missing/revoked credential or mismatched supplied session UUID | `unauthorized` |

### Cases and regression assertions

Base: repository-free REVIEW has one current manifest and no Git data.
Good: a carried completion remains current under its new applicable revision,
while still showing original manifest attribution; a replacement makes it historical.
Bad: display mutable `task_workspaces.finalized_commit` as every Attempt's result.

`postgres-task-ui-reads.test.ts` exercises canonical columns/filter cursors, tied
ordering/history/legacy Tasks, UTF-8 limits, independent attention overflow,
repository-free carry/replacement, Git result identity, exact workspace snapshots,
session mismatch and access guards. Completion-correction regressions also assert
successful child-checkpoint attribution. Browser tests verify the reachable page
controls; they do not establish real Runner/model/provider execution.

Wrong: a generic current workspace head proves historical completion.
Correct: expose the identified immutable effect plus separate current manifest
applicability, preserving precise admission/observation timestamps.
