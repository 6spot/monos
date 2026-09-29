# Exact Task creation design

## Boundary and source of truth

A committed assistant Discussion message is the proposal. Its immutable message ID
is the proposal identity; `task_preview` owns title/specification/proposed Project.
The preview UI is a projection. Add authorization, cancellation and creation
records, not a persisted draft or new Task lifecycle. Task title and current
Specification/Project remain Task-owned; source provenance is immutable metadata.

Reuse `initializeTask` for PLANNING/no Plan initialization in the caller transaction.
Existing Task-scoped proposal/authorization tables remain unchanged: their Task FK
cannot describe an action that creates a Task. Keep old fixture Tasks and receipt
bytes compatible. Additive migration 15 supplies the new Todo-scoped records and
new canonical Task metadata; legacy unavailable metadata stays absent.

## Protocol

Shared JSON Schema remains the transport authority; regenerate TS/Go/OpenAPI and
fixtures. The Owner-only command group is:

- `POST /v1/owner/task-previews/commands`: common schema version, immutable request
  ID, Todo ID, command name and strict payload.
- `confirm_task_preview`: proposal message ID, chosen Project ID, exact content digest.
- `create_execution_task`: proposal message ID, confirmation ID, exact content digest.
- `cancel_task_preview`: proposal message ID. Immutable identity already binds the
  proposal; cancellation is not dependent on a transient Project selection.
- `GET /v1/owner/task-previews/commands/:request_id`: immutable result or unknown.
- `GET /v1/owner/todos/:todo_id/task-previews/:message_id?project_id=...`: bounded,
  read-only canonical exact content, source basis, selected Project and digest,
  eligibility/reason, cancellation or created Task association.

A read with a Project selection never grants authorization. The digest includes
`create_execution_task`, Todo/proposal/source identity and Owner watermark, exact
structured title and Markdown, chosen Task Project, and original Todo Project
identity/assignment epoch. It is independent of UI formatting and unrelated
configuration versions. No arbitrary expiry is needed; applicability is guarded
by actual source/cancellation/creation facts.

Confirmations are immutable and unique by `(proposal_message_id, content_digest)`.
Before creation, the Owner can explicitly confirm another displayed active Project
with its new digest. That receipt cannot reuse approval for the old Project.
Competing correctly authorized creations still contend on one unique source
outcome; the first committed Task wins, and changed-Project losers conflict.
No selector/read silently revokes or grants authorization.

A missing selection yields a Project-required state. Default to the proposal's
active Project when supplied, otherwise the Todo's active Project. Selecting
another active Project changes the exact digest and does not move the Todo.

## Freshness, replay and concurrency

Authenticate before any read/replay. For new writes use configuration share barrier
before Todo and new Task locks; retain immutable-request advisory locks and digest
checks. Keep request receipt checks before fresh-state guards. No Runner lock or
external effect is needed because this task does not admit execution.

Source eligibility requires an assistant message with structured preview and exact
Todo ownership, resolved original input, no unresolved newer input, and
`MAX(owner.sequence) == reply.source_watermark`. The assistant append sequence is
not the source cutoff. Current Todo Project identity/assignment epoch must match
the frozen source, including away-and-back moves. Archived Todo and missing/
archived selected Project cannot grant fresh authorization/creation.

Confirmation records exact content without creating a Task or advancing the source
basis. Creation consumes authorization and writes Task, initial Specification,
source association, formal creation event/Discussion activity and immutable
command result in one transaction. A unique proposal-to-Task constraint prevents
duplicate creation even for different request IDs/devices. Database failure rolls
back authorization consumption and every partial row. The initial Specification
retains exact Markdown; no Discussion/capture/cache/session is copied into it.

On same-request retry, return the original receipt. On another exact confirmation
or creation request after the proposal was already consumed, return its same Task
association before testing later Todo freshness or Project availability. Changed
Project/content is a conflict; it never creates a second Task. Canonical reads
show current Task facts rather than replacing them with an old command snapshot.
Created-outcome projection takes precedence over default/queried Project selection
and all new-creation freshness guards: reload always restores the actual created
Task and its Project, including after archive or Todo reassignment. A stale local
selector must not hide that association.

Cancel serializes with creation under the Todo/proposal boundary and persists an
immutable cancellation decision. One wins. A prior successful creation prevents
preview cancellation; cancellation prevents later confirmation consumption. A
stale uncreated proposal can still be dismissed. Continue discussing merely
focuses the composer; only a submitted new input changes proposal eligibility.

## Browser and Task reads

Use a proposal-scoped hook/controller that remains mounted with Discussion. Retain
exact confirmation and creation envelopes for one Create Task action, including
when the selected Todo changes. Resolve uncertainty by original receipt/identity;
never issue a fresh create merely because a response was lost. Reload reads the
canonical source-to-Task mapping, which also supplies cross-device deduplication.

Project selector reads are keyed by Todo, message and selected Project. Creation
must use the digest/content actually displayed for that selection; pending query
or changed selection cannot reuse the prior digest. Do not automatically rebase
an edited/pending confirmation. Expose actionable stale/cancelled/unavailable
states and keep the Discussion composer usable.

Render exact Markdown source in the card using the existing whitespace-preserving
presentation; this task adds no Markdown parser/dependency. The confirmed card
shows title, Project, Ready to start and View Task. A minimal `#task?...` route
reads canonical Task metadata/Specification through an authenticated projection.
Extend existing TaskOverview with optional title, todo_id, project_id,
initial_specification_id, specification (exact Markdown), and created_at. New
canonical Tasks expose these fields; legacy fixture rows omit unavailable data.
`specification` always pairs with current `specification_id`, never the initial
pointer. Read the effective revision and expose exact Markdown only when its
content is a string; never stringify legacy arbitrary JSON into claimed Markdown.
`initial_specification_id` remains immutable provenance. A current non-Markdown
legacy revision omits the optional Markdown field and the UI shows its unavailable
content honestly. Test a created Task after a valid current revision change. Task views do not need Todo Discussion reads.
Retain existing mounted Todo/settings state when navigating to Task and back.

## Validation and deployment

Real PostgreSQL tests cover two-device/new-ID duplicates, changed content/Project,
source-versus-append cutoff, cancellation/creation and input/confirmation races,
Project archive/reassignment, rollback on receipt failure, immutable association/
Specification, clean migration and populated legacy compatibility. Assert zero
Task-side Attempts/outbox/Nodes after creation. Include auth/CSRF/cursor boundaries.

Browser tests use actual persisted messages/proposals via owned test fixtures,
with clearly identified fault injection for lost responses. Verify unassigned
Project choice, exact content, two clients, cancellation, stale inputs, draft
retention and reload/View Task. Visually inspect desktop/mobile cards/details.

Run established local/full DB/browser gates and Go shared-fixture checks after
schema generation. Deploy only the existing test server once no physical work is
unsettled. Native Discussion can produce a real proposal; exercise authenticated
confirmation/creation without Start and retain source/receipt/absence evidence.
Rollback stops new creation routes while preserving all receipts and Task history.
