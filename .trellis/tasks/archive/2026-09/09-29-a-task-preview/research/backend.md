# Exact Task preview: backend and protocol research

Research only. No product files changed. Discussion shipped in `d623444`.

## Source contracts and existing implementation

- `docs/01-product-and-domain.md`: an Execution Task has stable Todo/Project/title
  and an immutable initial Specification. Creation is a hard context boundary;
  subsequent Todo discussion and Project moves never mutate that Task.
- `docs/02-planner-and-planning.md`, Discussion behavior and durable output:
  preview is structured content on a committed assistant message, not a Draft
  Task. Only explicit Owner confirmation creates a Task. Planner cannot create.
- `docs/05-tool-protocol.md:234`: confirmation binds exact title/specification,
  Todo, Project, source proposal, action and request identity. At most one Task
  per source proposal, including requests from different clients. Creation
  consumes the receipt atomically. Creation and Start are separate commands.
- `docs/06-state-and-formal-data.md`: creation with matching authorization and
  active Project yields PLANNING with no Plan. Domain associations, revision
  provenance, Owner decisions and command receipts are canonical records.
- `apps/server/src/discussion-state.ts`: `commit_discussion_turn` already writes
  immutable `task_preview: {title,specification,project_id?}` on an assistant
  message; title/specification are bounded and nonblank. Message attribution
  includes source Owner ID/watermark, Todo Project ID and assignment epoch.
- Migration 14 makes messages and resolutions immutable. The resolution points
  to the originating Attempt if further launch provenance is needed. An
  assistant append sequence can be later than an already-queued Owner message;
  it does not express the handled Owner-input cutoff.
- `task-records.ts::initializeTask` already creates PLANNING, null Plan/resource,
  and one immutable Specification in a caller transaction, with no Attempt or
  scheduling. It accepts optional Project and checks it under configuration
  SHARE. `tasks` remains the existing physical canonical control row.
- Existing Task confirmations in `owner-commands.ts` cannot authorize creation:
  proposals, authorization receipts and command receipts have Task FKs and
  snapshot an existing Task basis. Reuse authentication/canonicalization/error
  conventions, but do not create a temporary Task or weaken those FKs.
- `specification_revisions.authorization_id` specifically references those
  Task-scoped receipts. A new creation receipt cannot be inserted into that
  column without a deliberately separate schema contract.
- Existing Task overview contains execution counters/revision IDs but does not
  expose title, Specification content, Todo association or creation metadata.

## Product decisions confirmed by root

The preview selector may choose **any active Project**, including for an Inbox
proposal. Default to structured proposal Project when it remains active, else
the current Todo Project when active. The choice is exact confirmation content
and does not assign/reassign the Todo. Source Todo Project freshness is separate
from the selected Task Project. Do not invalidate a preview for unrelated policy
changes or merely changing Project Context; Project context remains mutable.

Same proposal and same selected Project/content returns the same created Task
across devices even after later Todo input or archive. Changed content/Project
cannot inherit that result. Cancel is a durable immutable source-proposal
decision. Continue discussing only focuses the composer; actual new submitted
input invalidates old eligibility. Confirmation alone creates no Task.

## Recommended public contract

Use separate generated Owner contracts, without extending Agent CommandEnvelope
or adding a Runner CLI creation command:

- `POST /v1/owner/task-previews/commands`: `TaskPreviewCommand` discriminated by
  `confirm_task_preview`, `create_execution_task`, `cancel_task_preview`.
- `GET /v1/owner/task-previews/commands/:request_id`: immutable
  `TaskPreviewCommandResult`, or `unknown`.
- `GET /v1/owner/todos/:todo_id/task-previews/:message_id?project_id=...`:
  `TaskPreviewStatus`, reconstructing canonical content, selected/default Project,
  digest, source basis, eligibility/reason, and prior confirmation/created Task.
  Reads never create confirmation rows, Tasks, messages or Runtime work.
- Extend existing `TaskOverview` and `GET /v1/owner/tasks/:task_id` with optional
  `title`, `todo_id`, `project_id`, `initial_specification_id`, `specification`
  (exact Markdown string), and `created_at`. New canonical Tasks return all six;
  legacy rows omit unavailable provenance. Existing `specification_id` remains
  the current revision pointer. This is the smallest usable read-only View Task
  target; it needs no competing detail route. A bounded Todo Task list or
  message-level created reference must survive
  history pagination and reconnect; do not depend on a client-held create result.

Envelope fields: `schema_version:1`, `request_id`, `todo_id`, `name`, `payload`.
Payload recommendations:

| Command | Payload | Result |
| --- | --- | --- |
| confirm_task_preview | proposal_message_id, project_id, content_digest | confirmation_id, proposal_message_id, content_digest; existing task_id when already created |
| create_execution_task | proposal_message_id, confirmation_id, content_digest | same Task identity and initial Specification identity |
| cancel_task_preview | proposal_message_id | durable cancelled disposition for that source |

Cancellation binds the immutable source identity, not a selector's temporary
Project choice. It must work for an unassigned/archived-Project preview. It does
not cancel an already-created Task, remove messages, change the cache or stop
the Discussion process. Existing created outcome wins and cancellation rejects
with an unmet precondition identifying that creation already happened.

Prefer server-returned display digests over requiring the browser to reproduce
Node-only canonicalization. The digest covers a versioned canonical object:

```text
schema_version, action=create_execution_task,
todo_id, proposal_message_id,
source_message_id, source_watermark,
source_project_id (explicit null if unassigned), source_project_context_version,
title, specification, selected_project_id
```

No trimming, Markdown normalization or title rewriting. A full content object
instead of a digest is also safe if the server compares every field against the
immutable message; do not accept client text as a new proposal. Chosen Project
belongs in the confirmation object, without rewriting `message.task_preview`.
The server must rederive the digest from the source, never trust a client digest
as evidence that arbitrary content was displayed.

An `expected_discussion_version` alone is insufficient: submitting later Owner
input intentionally does not advance that version. A source-bound digest plus
freshness guards below is sufficient; exposing source basis in the read contract
also makes conflict handling explicit.

## Freshness and replay algorithm

For every new confirmation and every unconsumed creation:

1. Require an assistant message in exactly this Todo with non-null structured
   preview, linked to a committed `replied` source resolution. An Owner message,
   Task conversation, raw log, unattached draft or foreign Todo is not eligible.
2. Require `MAX(sequence) WHERE author='owner'` to equal the proposal's
   `source_watermark`, and the Discussion source to be resolved. This rejects
   later queued, processing, failed or withdrawn input, including input stored
   before this assistant reply was appended. Do not use newest assistant
   sequence, overall message count or only the Discussion epoch.
3. Compare message source Project ID and `project_context_version` to current
   Todo binding. The epoch catches away-and-back moves. Do not compare selected
   Task Project to current Todo Project; they may intentionally differ.
4. Require selected Project active under the configuration SHARE barrier at
   both confirmation and creation. Project Context, Role selection and Runtime
   changes are not preview freshness versions. Roles/resources/Runner are not
   prerequisites for Task creation.
5. Reject cancelled source and changed exact content/binding. A new independent
   task needs another committed proposal message even if title/spec match.

Owner request replay first authenticates, locks request identity, checks original
digest and returns the immutable response before current-state guards. Across
different requests, check the existing source outcome after exact source/content
binding but **before** fresh eligibility checks. A created outcome returns its
original Task for the same selected Project/content despite later input,
reassignment/archive or Task execution progress. A different Project/digest is a
conflict, never a second Task. New request receipts record that same result with
their own request IDs.

Use immutable confirmations unique by `(proposal_message_id, content_digest)`.
Concurrent same-content confirmations reuse their identity. Before creation,
the Owner may explicitly confirm another displayed active Project, creating a
different receipt/digest without changing the first one. This avoids stranding
the preview when the first selected Project becomes archived. Reads and selector
changes never mint or mutate authorization. The old receipt cannot authorize a
new digest. Title/specification changes still require a new committed source
message because those fields come from immutable Discussion content.

Creation remains unique by source proposal, so differently-confirmed Projects
race for one outcome: the winner creates, the loser gets a content conflict.
After creation, no new selected Project can inherit its result. No arbitrary
expiry is necessary for correctness: source freshness and explicit cancellation
already control eligibility. If expiry is added, never let it break created Task
recovery or silently mint replacement approval. UI must recover a pending unknown
command before changing the selection or sending a different intended command.

Cancellation may record a source even when stale (it prevents reuse), but cannot
undo creation. Same-source repeated cancellation can return the same disposition.
Serialization with create guarantees precisely one terminal outcome. Cancel vs
confirm can both commit only if the later cancel renders the earlier unused
confirmation unusable; cancel vs create must have one winner.

## Minimal persistence/migration

Add migration `0015_task_creation.sql` and register it. Suggested records are
authorization/decision bookkeeping, not a Draft Task object:

1. `task_creation_confirmations`: immutable receipt ID; unique pair of source
   proposal message identity and content digest; Todo/source attribution; selected Project; exact content
   digest and optionally canonical confirmation body; confirming request ID/time.
   FK `(todo_id,proposal_message_id)` to immutable Discussion message. Protect
   rows from UPDATE/DELETE using the existing immutable-record trigger.
2. `task_preview_resolutions`: proposal identity PK; Todo; disposition
   `created|cancelled`; first deciding request/time; nullable created Task and
   confirmation references required only for `created`. One row provides DB
   exclusion of create versus cancel, and unique Task mapping for all devices.
   Immutable. Do not spread outcomes across unrelated tables whose mutual
   exclusion depends only on an application check.
3. `task_preview_command_receipts`: globally unique Owner request ID within this
   endpoint family; canonical request digest; immutable response. A request
   advisory lock protects replay even when malicious reuse changes Todo ID.
4. Extend the existing `tasks` row with stable title, Todo FK, initial
   Specification pointer, creation authorization/proposal provenance and
   millisecond creation time. Keep current `specification_id`, state and control
   fields as existing mutable control. Use same-Task deferred FK for initial
   Specification and an immutability trigger for stable creation fields.

Legacy Tasks lack source/creation evidence. Leave new provenance nullable for
those rows; do not invent historical Todo, initial revision or confirmation.
Enforce complete metadata on new formally-created Tasks. Test constraints and
triggers without preventing legitimate current Specification/control changes.
Project association on formally-created Tasks must never follow Todo moves.

Keep initial Specification as exact Markdown in the existing immutable revision
storage: pass the exact string to `initializeTask`; its canonical JSON stores a
JSONB string losslessly. Stable title lives on Task. Legacy revision objects stay
unchanged. Never insert Original Capture, requirement
cache, Discussion history, another Task or provider session into it. Creation
authorization provenance may be a dedicated initial-revision receipt column or
the immutable Task→initial revision→creation receipt relationship; do not misuse
the existing Task-scoped `authorization_id` FK.

All writes occur in one create transaction: check receipt/outcome/freshness,
validate matching confirmation, initialize Task + initial revision, add immutable
created outcome/consumption, and save the command receipt. Any error rolls all
of them back. No Plan, Node, Attempt, Start/outbox or Task Planner invocation is
created. No Runner lock or physical-release wait is required because this is a
new independent Task and does not authorize execution. A committed Discussion
reply remains usable while its old Planner Stop is still settling.

## Lock order and races

Use `authenticateOwner` → `lockConfiguration(tx)` SHARE → command request advisory
lock → receipt lookup → Todo row/control lock → confirmation/outcome access →
new Task insertion. This matches Todo submission/assignment locking. New Task
creation has no pre-existing Task/Runner lock. Never call RuntimeScheduling.

Holding Todo serializes with message submission, Project reassignment, Discussion
commit and withdraw; even if another command holds Runner first, creation never
waits on that Runner, so it introduces no reversed edge. The configuration
barrier serializes active Project validation with archive/delete. Call
`initializeTask` only after already acquiring configuration before Todo; its
internal reacquisition then introduces no new lock-order edge. Reads acquire
configuration then Todo SHARE and never install bookkeeping rows.

## Files likely affected

- New `apps/server/src/task-previews.ts` for preview reads, confirmations,
  creation/cancel and immutable recovery; optional separate pure helpers if the
  module becomes large.
- `task-records.ts` for stable initialization inputs/provenance; `app.ts` for
  authenticated routes. `owner-reads.ts` for optional canonical fields on existing
  TaskOverview; the new preview module for Todo-created-Task/source reads.
- Migration 15 + `packages/db/src/migrate.ts`. Drizzle currently maps only a
  small subset, so inspect consumers before adding unused mirrored mappings.
- Protocol source schema, generated TS/Go/OpenAPI/embedded schema, validation
  roots and generator route/type lists, shared validation fixtures. Generate,
  never hand-edit generated files. Existing Runner contracts need no behavior
  change, but compile after generation because quicktype can rename shared types.
- New `postgres-task-previews.test.ts`, root `test:db` registration, plus focused
  existing Task-record/Owner/Discussion regression changes where necessary.
- Backend creation spec, Task-record and Owner-command/spec index updates; keep
  source API contracts explicit rather than implying existing Task confirmation
  helpers can consume Todo creation approval.

## Meaningful database and protocol verification

1. Assigned and Inbox proposals; select a different active Task Project; confirm
   alone has zero Tasks; create exact Markdown/title once; Todo binding unchanged.
2. No Roles/resources/Runtime is required. Creation has PLANNING/null Plan,
   immutable initial revision, zero Nodes/Attempts/Start/outbox and no inherited
   capture/cache/history. It also works before old Discussion Stop settles.
3. Same request across sessions and simultaneous different requests/devices:
   same confirmation and one Task. Changed digest/Project under an existing
   receipt, foreign proposal or request-ID reuse across Todos conflicts. Deliberately duplicated semantic
   content under a fresh proposal creates an independent second Task.
   Before creation, explicitly confirming a different selected Project yields
   another immutable receipt. Competing creations from these two receipts have
   one winner and one content conflict. An archived first selected Project can
   be replaced through another explicit confirmation while the source is fresh.
4. Later input before reply append; input after confirm but before create;
   pending/failed/withdrawn later input; Project move and away/back. Reject stale
   creation with no partial Task or consumed authorization. Prove ordinary
   Project Context/policy edits do not incorrectly stale the proposal.
5. Active selected Project validation races archive both at confirm and create.
   Force actual lock contention and observe PostgreSQL blocked sessions before
   release, not merely concurrent promises or arbitrary timing delays.
6. Cancel without a Project; confirm→cancel→create rejection; cancel/create
   race; repeats across sessions; created outcome never acts as Task cancellation.
7. After successful creation, later input/Todo move/archive/Project archive do
   not break same-content cross-request recovery; different Project still fails.
8. Inject receipt/outcome insertion failure and verify full rollback, including
   Task/Specification and authorization consumption. Independent-process SIGKILL
   immediately before/after COMMIT should prove zero-or-one durable creation.
9. DB attempts to alter title, Todo/Project, initial revision, receipt or source
   outcome fail; existing current-revision transitions and legacy fixtures remain
   valid. Upgrade populated migration-14 schema without rewriting legacy evidence.
10. Authenticated HTTP reads/receipts, malformed/NUL/lone-surrogate/oversized
    content and unknown/irrelevant schema fields; generated cross-language
    fixtures. Task record and preview link survive reconnect/history pagination.

Run protocol generation/drift, lint/typecheck/unit/build and focused real DB
tests, then full Task/Runtime DB regression because migration and initialization
are shared. Browser behavior belongs to the UI worker. This task needs no live
model invocation to prove deterministic creation; model preparation already
belongs to shipped Discussion, and creation must remain Runtime-independent.
