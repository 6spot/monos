# Todo capture and lifecycle design

## Boundary

Add the first real Todo domain records and user surface. Current code has Owner access, configuration, Tasks and Runtime infrastructure, but no Todo storage or routes. Todo capture is a storage command, never a Discussion message or scheduling trigger. The existing architecture and frontend spec own behavior and visual structure.

## Storage and formal commands

An additive migration creates `todos` with stable ID, immutable original capture, optional Project FK, archived flag, per-Todo control version, creation time and Discussion activity time initialized at capture. An immutable database trigger protects original capture/identity. No new Task states or priority metadata. Organization edits do not update Discussion activity. No delete endpoint.

`todo_command_receipts` stores immutable request digest and response globally for the single Owner, including across sessions. `/v1/owner/todos/commands` validates a generated discriminated `TodoCommand` and authenticates the Owner. Serialize same-request admission, look up receipt before current-version checks, then atomically save the Todo change and receipt. `capture_todo` supplies a stable Todo ID and exact capture text plus optional Project; `assign_todo_project` and `set_todo_archived` bind Todo ID and expected version. Unknown, blank, malformed and stale input returns established typed errors. Never silently trim or rewrite stored capture text. Lock configuration before Todo when Project eligibility is checked, preserving configuration/Owner lock conventions.

No command invokes RuntimeScheduling or writes Attempts, Tasks or outbox. Assigning or moving a Todo never updates Task associations. Archived Projects are visible as historical associations but cannot be newly selected. A Todo may be returned to Inbox. Original capture remains unchanged across archive/restore.

## Reads

Authenticated generated contracts serve Todo detail and bounded cursor pages for All active, Inbox, active Project and Archived scopes. Order descending by Discussion activity and stable ID; enforce scope-bound cursors and response byte limits. Use canonical timestamps and opaque IDs. Request IDs have a dedicated authenticated receipt lookup so uncertain writes can be inspected/replayed exactly. Per-Todo version is independent of unrelated Todos and configuration version.

### Selected wire contract

- `TodoRecord`: `schema_version`, `todo_id`, `original_capture`, deterministic `label`, optional `project_id`, `archived`, `control_version`, `created_at`, `discussion_activity_at`.
- `TodoPage`: `schema_version`, `scope` (`all|inbox|project|archived`), optional `project_id` only for Project scope, `todos`, `cursor`, `has_more`. Return at most 64 records and 2 MiB encoded bytes.
- `TodoCommand`: `capture_todo` payload is `{todo_id, original_capture, project_id?}`; `assign_todo_project` payload is `{todo_id, project_id?}` (omitted means Inbox); `set_todo_archived` payload is `{todo_id, archived}`. Every command carries `schema_version` and `request_id`; organization commands also require `expected_control_version`.
- `TodoCommandResult`: `schema_version`, `request_id`, `status: committed|unknown`; only committed includes the original `todo` snapshot. A same-ID replay never replaces that snapshot with newer state. No-op organization commands retain the Todo version.
- Capture is limited to 65,536 characters and 256 KiB UTF-8. Labels derive from the first meaningful capture line and are bounded to 160 Unicode codepoints. Stored capture remains exact.

## UI

Extend existing hash navigation with Todos as the default working surface; retain explicit settings routes and editor state. Within main content, use a compact list with filter and quick-capture form beside selected Todo detail. Initial selection remains empty. Small screens expose list/detail with a clear return action. Detail shows immutable original capture, Project assignment and archive/restore. Do not expose a nonfunctional Discussion composer; the following leaf adds it.

TanStack Query owns reads. Keep capture input and selected Todo/organization drafts scoped and mounted. Hold one exact command while its outcome is uncertain; use status lookup and same-ID replay, never mint a new ID or clear the draft on transport failure. Clear capture only after committed result, then select the created Todo when visible. Scope changes and list refresh do not auto-select arbitrary items. A Todo leaving the filter clears its selection. Use native labeled controls and existing Button/styles; no new UI framework.

## Validation and rollback

Real PostgreSQL tests prove pure capture, immutable text, concurrent replay, receipt rollback, stale-version guards, active Project checks, archive/restore and pagination scope. API tests prove authentication and schema boundaries. Browser tests exercise no-model capture/open, keyboard selection, Inbox/Project/Archived filters, draft retention and lost-response recovery, plus mobile overflow. Add generated shared fixtures and run protocol drift, TypeScript, lint, build and Linux Go wire tests. Keep migrations additive; rollback hides new UI/routes without deleting Todo or receipt history.
