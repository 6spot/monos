# Todo capture and lifecycle

## Goal

Let the Owner immediately record an idea, find it in the Todo workspace and organize it without invoking a model.

## Requirements

- Preserve the exact original capture as immutable Owner-authored text. Capture requires no Project; blank capture is rejected. Display labels derive deterministically from its first meaningful line.
- Associate/reassign a Todo to an active Project or return it to Inbox. Existing Tasks keep their own Project association. Archive/restore Todos without creating execution-board states.
- Authenticate reads and formal commands through the existing Owner session/Tool Protocol. Commands use immutable request IDs, replay prior results and reject changed payloads or stale versions.
- Paginate bounded canonical Todo reads for All active, Inbox, Project and Archived scopes. Ordering follows capture/Discussion activity; organization changes do not pretend that a Discussion occurred.
- Add a two-column Todo list and selected-detail workspace within existing primary navigation. No selection opens an arbitrary Todo. Capture, opening, filtering, assignment and archive/restore never dispatch Planner work. Mobile preserves access to list and detail.
- Preserve capture drafts and uncertain command identities across recoverable request failures. Reflect only committed server state. Expose errors and explicit retry/recovery; do not clear text before commit.

## Acceptance criteria

- [x] Capture/replay creates exactly one Todo with exact text, no Discussion message, Attempt, Start outbox or Task.
- [x] Assignment and archive/restore enforce version/Project guards and preserve original capture and Task associations.
- [x] Authenticated, scoped pagination has stable ordering/cursors and rejects malformed or cross-scope cursors.
- [x] Inbox UI supports keyboard-accessible capture, selection, filtering, assignment and archive/restore with retained drafts and no model calls.
- [x] Repository checks and real PostgreSQL cases pass; browser interaction evidence is recorded.

## Dependencies and scope

Follow Production Runtime integration acceptance. Reuse completed Owner configuration and command foundations. This leaf does not implement Discussion, preview, Task creation, deletion, semantic summaries or AI renaming. The next leaf supplies the live Discussion composer; show the captured idea and organization controls here without a fake working composer.

## Authorization

The Owner authorized sequential roadmap implementation and routine decisions on 2026-09-29. No unresolved product choice; architecture modules 01, 05, 06, 07 and 08 define behavior.
