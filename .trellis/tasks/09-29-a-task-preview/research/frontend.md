# Task preview frontend research

Research only, 2026-09-30. Product baseline: Discussion commit `d623444`.
No product code changed. The task PRD, architecture modules 01/02/05/07 and
frontend component/query/state/type/quality specs define the recommendations below.

## Existing implementation and missing boundaries

- `apps/web/src/features/discussion.tsx` renders the committed
  `DiscussionMessage.task_preview` as title, plain Markdown text and optional
  Project attribution. It does not prepare/confirm/create/cancel a Task.
- `TaskPreview` has only `{title, specification, project_id?}`. The enclosing
  committed message supplies `message_id`, sequence and source provenance.
  No generated projection currently exposes eligibility, cancellation, a
  confirmation identity, or the Task already created from that proposal.
- Discussion uses a bounded recent page with earlier pages on demand. It remains
  mounted across Todo selection changes; its hook preserves per-Todo drafts and
  pending commands. Reuse this state ownership, but key preview Project choices
  and command recovery by both Todo and proposal message identity.
- `apps/web/src/app/app.tsx` has Todos and settings hash navigation. The
  `#execution` route is execution policy/Planner guidance settings, not an
  Execution Board. There is no existing Task detail UI or Task library route.
- The backend already serves generated `TaskOverview`, but that record has only
  Task/state/control/Specification ID/Plan ID/counts/event cursor. It does not
  contain title, immutable Specification content, Project, Todo or creation time.
  A functional View Task link therefore needs a small canonical detail read and
  an actual read-only route in this leaf.
- Existing `OwnerCommand.confirm_proposal` is Task-scoped and requires an existing
  Task control basis. Existing proposal actions do not include Task creation.
  Do not send Todo creation through that interface unchanged or create a dummy
  Task to obtain a confirmation scope.

## Recommended interaction

Keep the proposal inline on its committed Planner reply. Show the full exact
title and Specification, its source association, and the Project that the Owner
will authorize. Label it Execution Task Preview; it remains structured message
content and a derived presentation, never a Draft Task record.

Use three actions from module 07:

1. **Create Task** explicitly confirms the displayed content and creates the
   independent Task through the formal Owner command. The same surface can
   orchestrate a separate authorization receipt and its consumption if required
   by backend design; the click must never confirm unseen/refreshed content.
   Explain before submission: creation saves a ready-to-start Task and does not
   start execution. Do not offer Start or Confirm and Start in this leaf.
2. **Cancel** durably cancels eligibility of this source proposal via its own
   authenticated idempotent command. Keep the historical reply/specification
   visible with a cancelled disposition. It is not Discussion source withdrawal,
   deletion of the reply, cancellation of a Task, or a Runtime Stop.
3. **Continue discussing** focuses the existing Message Planner composer and
   preserves any unfinished draft. It does not submit synthetic text, invoke a
   model, or create a Task. The next actual Discussion input makes the old
   proposal stale under the backend's source-basis guard. This avoids silently
   mutating domain state from a focus/navigation action.

Keep the composer usable while a proposal awaits a decision. A creation request
with an uncertain outcome disables changes/repeated decisions for that proposal,
not unrelated Todos. If new input and creation race, canonical transaction order
decides whether creation succeeded or the proposal became stale; client timestamps
must not decide. Do not imply that later input undid an already-created Task.

Use a native inline form, existing Button and labeled Select. A second modal or
new UI dependency is unnecessary. Preserve raw Markdown and whitespace exactly;
the current plain-text/pre-wrap display can be labeled Specification (Markdown).
If richer rendering is chosen, treat it as presentation only and do not admit
raw HTML or derive the confirmation digest from rendered DOM/excerpts.

## Project selection and changed content

- Active Project is required at confirmation; Roles/repositories are not creation
  prerequisites. A Project with no Role can hold a PLANNING Task.
- An unassigned proposal prompts for an active Project using the existing
  configuration snapshot. No automatic first-Project selection. Capture and
  Discussion remain available without one.
- Project choice is part of the concrete preview and authorization. A changed
  choice must reset any unconsumed exact-content confirmation and require review
  of the newly displayed preview. Never silently replace the Project in a pending
  command or reuse approval obtained for another Project.
- Root's selected design allows **any active Project**, independently of the
  Todo's current binding. Preserve the original reply's historical attribution;
  choosing another Project refetches the canonical exact preview and its new
  digest before confirmation. It does not mutate the committed source message or
  silently reinterpret approval for an earlier Project. This is the refreshed
  preview required when the Project changes.
- An archived/missing choice cannot create. Keep it visibly unavailable and allow
  an explicit active replacement followed by that canonical preview refresh.
  Do not automatically choose the Todo's current Project or the first active one.
- Refreshes never rebase a locally edited Project choice or pending authorization.
  Expose explicit reload/review after a definitive version/precondition failure.

## Generated API information needed before implementation

Root/backend selected the following routes and actions during research:

- `POST /v1/owner/task-previews/commands`: `confirm_task_preview`,
  `create_execution_task`, `cancel_task_preview`.
- `GET /v1/owner/task-previews/commands/:request_id`: command result recovery.
- `GET /v1/owner/todos/:todo_id/task-previews/:message_id?project_id=...`:
  canonical exact card, eligibility, selected-Project `content_digest` and existing
  Task association. Selector changes refetch this record before confirmation.

Generated schema/type names and exact payload fields still belong to the backend
owner; use these semantic needs when reviewing their published contract.

| Boundary | Required information / behavior |
| --- | --- |
| Proposal read/projection | Todo ID, committed proposal message ID, exact title/specification/original Project, source basis/version, server-computed content identity, current derived eligibility and reason, optional created Task association. Can be attached to Discussion reads or fetched by proposal ID. |
| Exact authorization | Binds Owner action, Todo, source proposal, exact title/specification digest, selected active Project and expected source/control basis. A Project/content change invalidates the earlier authorization. |
| `create_execution_task` | Uses that exact authorization. Returns the one canonical Task even for a different request ID/device confirming the same proposal. No caller-authored Task lifecycle, inherited Discussion fields, Start, Plan or Attempt. |
| Proposal cancellation | Exact source proposal plus expected basis; immutable receipt; races creation atomically. A creation winner returns/discloses the existing Task rather than presenting a successful cancellation of that Task. |
| Command receipt lookup | Authenticated committed/unknown variants with request identity and scoped proposal/Task/confirmation identity as appropriate. Durable across Owner sessions. |
| Created Task read | Stable Task/Project/Todo identity, title, creation time, initial immutable Specification content/ID and actual current state. Reuse/add to existing Task read ownership without importing Todo history into the Task record. |

Do not rely exclusively on request-ID lookup to restore a created card: a second
device never held the first device's request ID. Proposal-to-Task uniqueness must
be discoverable through an authenticated source projection. A historical proposal
outside the newest 64 messages must reconstruct the same result when loaded later.

If confirmation and creation are separate wire requests, preserve the exact
confirmation request, its receipt ID, and the exact creation request as a small
UI command sequence. Resolve an uncertain first step before consuming it; resolve
an uncertain second step before minting another creation request. This is UI
request bookkeeping, not a new execution scheduler or Draft Task lifecycle.

## Created card and minimal Task destination

After a committed creation result, invalidate authoritative proposal/Discussion
and Task reads. Render the source card as created using the canonical mapping,
with title, created time, **Ready to start** for `PLANNING`, and **View Task**.
Do not overwrite a newer Task state with an older immutable creation receipt.
No progress percentage, Node graph, fake running status or placeholder Start.

Root accepted a minimal internal hash route, for example `#task?task_id=<opaque-id>`, without
repurposing the existing Execution settings navigation. The destination displays
the canonical confirmed Specification and Project, and says Ready to start while
there is no Plan. Keep Todos/settings mounted to retain drafts. Direct reload of
the Task URL must authenticate and load that Task rather than fall back to Todos.

Provide Back to Todo using a stable source link. Support explicitly supplied Todo
and optional proposal-message IDs in the return route if needed; this is an Owner
navigation selection, not arbitrary auto-opening of the first Todo. A new tab can
therefore return to the source while normal `#todos` still begins unselected.
Task detail receives identity links only, not the Todo's capture, Discussion,
Working Requirement State or provider session. The full execution board, Start,
Task conversation and delivery remain later work.

Root is coordinating whether `TaskOverview` gains optional exact title, Project,
Specification content and creation time (legacy-compatible) or an additional
small Task read supplies them. Do not invent a frontend-only record before that
contract is finalized.

## Minimal frontend change locations

| File | Change |
| --- | --- |
| `apps/web/src/features/discussion.tsx` | Replace the display-only preview with an inline proposal/created-card component; pass canonical source identity and composer focus callback. Preserve recent/earlier history semantics. |
| `apps/web/src/features/task-preview.tsx` (new) | Exact-content display, active Project selection, explicit decisions and created Task link. Scope state by proposal identity; do not reset on history polling. |
| `apps/web/src/lib/task-preview-api.ts` plus tests (new) | Validate generated reads/results and scope identities; immutable confirmation/create/cancel submission and status recovery. |
| A local preview-command hook if needed | Keep pending stages/Project choices mounted across Todo changes, following existing hooks without copying a generic workflow framework. |
| `apps/web/src/features/task-detail.tsx` (new) | Small canonical read-only Task destination with confirmed Specification and truthful state label. |
| `apps/web/src/app/app.tsx`, `features/todos.tsx` | Internal Task/source return routing and stable mounted draft ownership. Keep Execution settings intact. |
| `apps/web/src/styles.css` | Small card/action wrapping and mobile/readable Markdown styles using existing tokens. |
| `apps/web/test/task-preview.e2e.ts` (new), existing Discussion tests | Real proposal-to-Task and recovery interactions; update current display-only preview expectations. |
| `apps/web/README.md` | Actual routes, command recovery boundaries and remaining Start limitation. |

Shared schemas/generated artifacts, creation/cancellation storage and task reads
remain backend/protocol ownership. No frontend DB import, local-storage command
queue, new router framework or copied Task state model is needed.

## Browser and adapter validation

1. Use a committed structured proposal fixture in the isolated real database;
   render its exact title/specification/Project. Prose saying “create” or an
   uncommitted Runtime fragment must never produce a working creation action.
2. Unassigned proposal cannot create until an active Project is explicitly chosen.
   Archived/missing Project failures retain choice and show a factual error. A
   Project without Roles/repositories still permits creation.
3. Create from two pages/devices with distinct request IDs concurrently; both
   receive/render the same Task. Backend assertions establish one Task/initial
   Specification, no Plan/Attempt/Start and no inherited Todo context.
4. Drop confirmation/create responses at each actual step. Recover the original
   request before replay; malformed/5xx/status-identity mismatch retains uncertainty.
   Switch Todos while pending without losing drafts/Project choice/command identity.
5. Reload and reopen in another session; reconstruct the created link from the
   proposal projection without the original request ID. Load an older proposal
   beyond 64 messages and obtain the same card, not another Create button.
6. Cancel then reconnect: cancelled proposal remains historical and cannot create.
   Exercise cancel/create and new-input/create races. Show the authoritative winner.
7. Continue discussing focuses the existing draft with zero write/model request.
   Actual later input stales the older proposal. Project/content changes require
   a new displayed exact confirmation; no expected-version auto-substitution.
8. View Task, direct URL reload and Back to Todo work with keyboard/mobile focus,
   retained source drafts and no horizontal overflow. PLANNING says Ready to start;
   no Start command or synthetic execution request occurs on opening the detail.
9. Keep existing capture/organization, Discussion queue/recovery, settings and
   session tests. Take populated desktop/mobile screenshots after canonical data
   loads, reset scroll before full-page captures, and visually inspect them.

Run web/root lint, typecheck, affected API tests, protocol drift/build and the real
browser suite after implementation. Browser response fixtures may test malformed
reads and visual states, but must not replace the real cross-device creation race
and backend atomicity/absence-of-dispatch checks.
