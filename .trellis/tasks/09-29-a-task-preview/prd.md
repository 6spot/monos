# Exact Task preview and creation

## Goal

Turn a committed Discussion proposal into one independent ready-to-start Task after exact Owner confirmation.

## Requirements

- Follow ordered Todo Discussion. Reconstruct preview title, Markdown specification, Project choice and source identity from structured committed reply content; do not add a Draft Task domain object.
- Explicit Owner create_execution_task consumes an exact-content confirmation. Natural-language intent prepares a preview but never creates a Task.
- Require an active Project at confirmation; repeated confirmation of the same proposal, including different request IDs/devices, returns the same Task.
- Create the stable Task association and immutable initial Specification atomically. Initial state is PLANNING with no Plan and no automatic execution-side Planner.
- Revisions to Discussion, cancelled/stale previews and changed exact content cannot inherit old approval. A new independent Task needs a fresh proposal.
- UI restores proposal and created Task link after reconnect. The Task receives only confirmed Specification and Project association, with no Todo session/Discussion/requirement-state inheritance.

## Acceptance criteria

- [ ] Same exact proposal creates one Task across retries, concurrency and reconnect.
- [ ] Stale/cancelled/changed proposals and archived or missing Project are rejected without partial records.
- [ ] Creation produces PLANNING with immutable Specification and no Plan, Attempt or Start.
- [ ] Reconstructed preview/Task link and independent context are verified through backend and browser tests.

## Scope

No initial execution planning, Start implementation, Task conversation or delivery. Those remain with Task execution and later work packages.
