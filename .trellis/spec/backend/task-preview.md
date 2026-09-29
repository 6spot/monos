# Exact Todo proposal to Task creation

## 1. Scope and trigger

Use when projecting committed Discussion previews, confirming/cancelling them,
creating an independent Task, or exposing its confirmed metadata. Sources:
[Planner preview](../../../docs/02-planner-and-planning.md),
[Owner authority](../../../docs/05-tool-protocol.md),
[formal records](../../../docs/06-state-and-formal-data.md),
[preview UI](../../../docs/07-owner-review-and-ui.md).

Implementation: `apps/server/src/task-previews.ts`, `owner-reads.ts`,
`task-records.ts` and migration `0015_task_creation.sql`.

An immutable assistant Discussion message is the proposal. The UI card is a
projection; no Draft Task exists. Only an explicit Owner command creates the Task.
Planner prose or structured proposal content alone grants no creation authority.

## 2. Signatures

- `POST /v1/owner/task-previews/commands`: generated `TaskPreviewCommand`.
- `GET /v1/owner/task-previews/commands/:request_id`: immutable
  `TaskPreviewCommandResult` or `unknown`.
- `GET /v1/owner/todos/:todo_id/task-previews/:message_id?project_id=...`:
  `TaskPreviewStatus`, a read-only exact content/eligibility projection.
- Existing `GET /v1/owner/tasks/:task_id`: `TaskOverview` gains optional canonical
  title, Todo, Project, initial Specification ID, current Markdown and creation time.
- `initializeTask(tx, ...)` remains the transaction-local PLANNING initializer;
  public creation supplies a valid Project and exact confirmed Markdown.

Commands share `schema_version`, `request_id`, `todo_id`, `name`, `payload`.
Confirm uses `{proposal_message_id,project_id,content_digest}`. Create uses
`{proposal_message_id,confirmation_id,content_digest}`. Cancel uses only immutable
`{proposal_message_id}` and never targets an already-created Task for cancellation.

## 3. Contracts and transaction order

The digest binds the `create_execution_task` action, Todo/proposal/source identity,
source Owner watermark, original Todo Project/assignment epoch, exact title and
Markdown, and chosen Task Project. No trimming or Markdown normalization. Project
selection may choose any active Project and never reassigns the Todo. Roles,
resources and live Runner availability are not creation prerequisites.

Authenticate Owner, take configuration SHARE before Todo/Task locks, protect the
request identity and check its immutable receipt before new-effect guards. Reads
never allocate authorization or Task rows. Task creation does not take Runner
capacity or issue execution commands.

New confirmation/consumption checks the committed replied source, latest Owner
sequence equal to the source watermark, no unresolved newer source, current Todo
Project binding/epoch, active Todo and active chosen Project. Assistant append
sequence is not the source watermark. An old Planner Stop may still be settling;
creating an independent nonexecuting Task does not take its physical ownership.

`task_creation_confirmations` stores immutable exact authorizations;
`task_preview_resolutions` records the unique created/cancelled source outcome,
and `task_preview_command_receipts` retains request results. Composite FKs bind
Todo, proposal, chosen Project, confirmation and newly-created Task. Stable Task
creation fields and initial Specification pointer cannot be updated.

Confirmations are immutable and unique by `(proposal_message_id,content_digest)`.
Another explicitly displayed Project can receive a fresh exact confirmation before
creation. Old authorization never applies to that new digest. Source resolution
is unique per proposal, so competing correctly authorized creates/cancel have one
terminal winner. One proposal creates at most one Task, across request identities
and devices. Source revision/cancellation facts govern eligibility, not arbitrary
UI timestamps or unrelated configuration-version changes.

Creation atomically consumes the exact authorization, initializes Task/immutable
initial Specification, records source association/formal event/Discussion activity,
and persists the command receipt. `task_created` is a formal event without an
Attempt; migration 15 permits nullable event Attempt identity rather than creating
a dummy execution. It creates no Plan, Node, Attempt, Start/outbox
or execution Planner. Only exact confirmed Markdown and Project cross the semantic
boundary; no capture, messages, requirement cache or provider session is copied.

Same-request replay returns the original result. Another exact request for an
already-created proposal returns the same Task before later freshness guards;
changed content/Project conflicts. Created-preview reads always restore the actual
Task and its Project before default or queried selection, including after archive
or reassignment. Do not use an old creation receipt as current Task state.

`TaskOverview.specification` pairs with current `specification_id` and comes from
that revision. `initial_specification_id` is immutable provenance. Expose exact
Markdown only for string revision content; do not stringify legacy JSON objects
or substitute initial text for the current Specification. Legacy unavailable
metadata remains absent, never fabricated.

## 4. Validation and error matrix

| Condition | Result |
| --- | --- |
| Missing/revoked/non-Owner authentication | `unauthorized` |
| Wrong Todo/proposal or confirmation scope | `denied_scope` |
| Same request with changed body | `payload_conflict`, before new effects |
| Digest or chosen Project differs from authorization/created result | Conflict; no second Task |
| Later Owner input or changed source Project epoch | Stale/precondition rejection |
| Cancelled source, archived Todo or unavailable selected Project | No fresh creation |
| Cancellation after successful creation | Rejected; preserve Task |
| Receipt insert or initialization fails | Entire authorization/Task/revision transaction rolls back |
| Same exact source already created, now stale/archived | Return existing Task for authenticated exact replay |

## 5. Good, base and bad cases

Base: read preview, explicitly select Project, confirm exact digest, create one
PLANNING Task. Good: two devices confirm/create using different request IDs and
both restore the same Task. If Project A becomes archived before creation, the
Owner can explicitly confirm B using a new digest; A's receipt cannot authorize B.
Bad: a later Owner message was already queued when the assistant reply appended,
but creation uses that assistant append sequence and wrongly considers it current.

## 6. Required tests

Use real PostgreSQL for duplicate confirmations/creates, differing Project race,
cancel/create and new-input/create contention, receipt rollback, Project archive/
reassignment including away-and-back, no Runtime requirements and immutable Task
metadata/Specification. Check legacy migration and actual current revision reads.
Assert zero Task-side Plan/Node/Attempt/Start after creation.

Browser tests must exercise exact Project selection, two real clients, uncertain
confirmation versus creation responses, Todo-switch draft retention, canonical
created Project restoration after archive/reassignment, cancellation and direct
Task URL reload. Label seeded proposals and injected transport failures as test
fixtures. Real native proposal-to-command evidence separately proves installed
Runtime output crosses the formal boundary without starting Task execution.

## 7. Wrong versus correct

Wrong: source proposal uniqueness also permanently fixes its first confirmation's
Project, leaving an uncreated preview stuck if that Project becomes unavailable.
Correct: immutable confirmations per exact digest; one unique terminal source
resolution/Task, and explicit fresh consent for a changed Project.

Wrong: restore the card using today's Todo Project or initial Specification text.
Correct: restore the created Task's immutable Project association and read its
current Specification from the current pointer, preserving initial provenance.
