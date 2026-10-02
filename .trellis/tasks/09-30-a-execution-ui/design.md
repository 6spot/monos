# Execution UI design

## Behavior gap and ownership

Canonical execution exists, but there is no collection read or usable Task control
workspace. Add projections at their backend owners and compose existing Tool Protocol
commands in Web. Do not introduce client lifecycle state or derive results from text.
Research: [frontend seams](research/frontend-seams.md) and
[backend contracts](research/backend-ui-contracts.md).

## Read boundary

- Add authenticated, bounded Task collection/Board read at `/v1/owner/tasks` with
  schema-owned Project/attention/history filters and a canonical filter-bound cursor.
  Stable deterministic ordering and response byte budgets must hold under refresh.
  Project-only Tasks are not discovered by crawling Todos. Legacy records are
  readable but labels alone never grant canonical execution controls.
- Current progress uses effective Plan membership and activation. Attention is a
  projection of existing planning/conversation/revision/Replan/blocker/recovery
  facts, not a persisted second status. Queueing alone is not attention.
- Add narrowly scoped read fields/projection for exact completed local Git result,
  current applicability and readable execution details absent from current reads.
  Reuse immutable completion/effect records; never access Runner paths on backend.
  No invented diff endpoint: show actual available commit/tree/result metadata and
  explain missing content retrieval. Do not relabel historical manifests after carry.
- Keep existing bounded message/proposal/revision/Artifact/Attempt/event/log reads.
  Paginate every has-more path required to reach remaining Owner exits. Poll selected
  scopes using TanStack Query; SSE is not needed for this slice. No command on mount.

## Session and immutable recovery

Expose the existing random non-authenticating `session_id` on successful login and
session reads. The secret token/digest stays server-only. This is additive protocol
data, not new identity or authentication authority; no DB migration is needed.

Explicitly extend the previous memory-only frontend rule for **Task-only** drafts
and noncredential command chains in `sessionStorage`. Configuration/provider/Todo
behavior is unchanged. Use an allowlist of execution/conversation/Specification/
Replan command schemas, validate stored version/identity/envelopes, bound bytes and
record counts, and partition by the verified session ID and Task/action scope.
Never store passwords, token material, provider settings, raw logs or arbitrary
request endpoints. Do not use localStorage. Same-origin script can read Task text;
this matches existing authenticated page access, with tab/session-limited retention.

Persist an immutable pending stage **before** POST; storage failure prevents send.
Never evict unresolved requests for quota. Reload displays recovery for retained
stages; explicit Check result reads its exact receipt. Unknown permits exact replay;
malformed/unavailable reads retain uncertainty. A definitive rejection releases the
transport stage while preserving draft/original basis for explicit correction.
Stage transitions (confirm requirement/graph, apply/publish) retain exact proposal
and basis plus returned authorization IDs before the next send. Reload cannot
substitute current content or generate replacement IDs. Clear only the submitted
draft when its value still matches, so late responses preserve newer input.

On logout, revocation or verified session replacement, clear only owned Task storage
and private queries and remount session-bound Workspace. Transient session-read
failure preserves existing mounted drafts. Before mutation/recovery verify the live
session binding and send `X-Monos-Session` on the actual Task command/receipt request.
Backend authenticates that request’s credential and rejects a mismatched session UUID
before routing; the nonsecret header never authenticates. This closes the cross-tab
cookie replacement window after a successful preliminary session read. Invalidate a
local epoch on logout/replacement; all late callbacks, storage and query updates
must still match that epoch, including after awaited query cancellation.
Duplicate tabs may copy exact envelopes; backend immutable receipts deduplicate them.

## Web composition

Keep hash routing. Add `#board` with filter parameters; preserve `#execution` for
Execution settings. `#task?task_id=...&section=...` selects a Task section; default
Conversation. Source Todo links retain existing mounted Todo/settings state.
Own Task local state above conditional route content or in a scoped controller
hydrated from validated sessionStorage. Do not mount/poll every Task to keep drafts.

Board shows compact cards/counts, primary attention and access to all reasons.
Mobile stacks or intentionally scrolls columns within the Board, never the page.
Task chrome includes title/status/source links and stage-appropriate controls.
Conversation separates saved messages, Planner work, structured proposals and
operation receipts. Overview shows current requirements/work/outputs and local
REVIEW. Timeline maps formal events to readable history and hides routine operation
noise. Execution Details selects a Node and immediately displays current execution,
logs and Workspace/Git metadata, with previous executions and advanced IDs collapsed.

Use typed family API adapters over existing validated `request`; exact response
identity mismatches remain uncertain. Group command availability from server facts;
backend guards remain authoritative and definitive failures refresh affected reads.
Direct Owner `edit_specification` already authorizes and admits the change in one
command: display the full new/old text and complete impact before an explicitly
labelled Apply requirement change action. It is not a Save draft endpoint. Existing
Agent proposals use separate Confirm requirements and Apply confirmed requirements
actions; canonical confirmation reads retain those steps across reload. Joint graph
publication similarly exposes two exact confirmations and an explicit Publish.
No optimistic formal transitions. No pending proposal or accepted historical receipt
can masquerade as new current authority. Terminal Task conversation allows questions
without new execution/proposal creation.

## Shared visual integration and migration handoff

This leaf owns `styles.css` semantic tokens/document resets and shared shell/chrome,
`app.tsx` routing/session/mobile navigation, needed owned Base UI primitives and new
Board/Task feature compositions. Remove global button overrides that defeat owned
variants; preserve legacy interior behavior with limited compatibility selectors.
Use 256px desktop navigation, 48px header/toolbar, 16px gutter, neutral surfaces,
14/20 compact UI and 15/22 conversation, 44px primary mobile targets below 768px.
Mobile sheet uses Base UI focus management. No extra UI library/router/state store.

The separately created [migration leaf](../10-02-a-existing-screen-visual-migration/prd.md)
owns Login, Settings and Todo/preview **interiors** and remaining legacy form skins.
This allocation supersedes the unscheduled shared-file ownership in the original
handoff; its requirement for separately verified migration is preserved. Full Task
replaces minimal Task here. Shared-theme changes do not establish old-screen visual
acceptance. Parent sequence is execution UI → existing-screen migration → integration.

## Verification and rollback

Use real isolated PostgreSQL routes for collection/current-result/session checks and
browser interactions. Fixture-only scenario helpers may simulate runtime facts;
label them and keep production free of seed endpoints. Test reload after actual
committed response loss and before receipt existence, stale two-client decisions,
multi-stage confirmation recovery, independent exits and session replacement.
Inspect screenshots against local Multica workspace images listed in frontend research.
No deployed native record or service change is necessary for UI development.

Rollback removes new routes/UI exposure while retaining canonical records and
receipts. Session fields are additive; local storage is versioned and session-scoped.
No execution migration or source/prompt changes are planned. Any discovered command
correctness defect returns to design before broadening ownership.
