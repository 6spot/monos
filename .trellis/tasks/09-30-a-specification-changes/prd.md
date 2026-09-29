# Exact Specification changes and settlement

## Goal

Publish exact authorized requirements and impact after settling affected old work.

## Requirements

- Prepare complete exact Specification and impact from Task input, bind content/base/impact to Owner confirmation or exact Owner edit.
- Publish pre-start changes without starting work; started changes freeze affected dispatch and settle writers/effects while preserving code/history.
- With sufficient graph, publish only Specification and explicit evidence carry-forward/invalidation; maintain independent guidance/feedback/Stop guards.
- Allow proposal replacement and unpublished withdrawal without restoring revoked Attempts/acceptance or claiming pending content is effective.

## Acceptance criteria

- [ ] Two clients publish at most one revision; changed/new input cannot reuse stale approval or enlarge confirmed impact.
- [ ] Restart/Stop/withdrawal during settlement preserves the old effective basis until atomic publication and prevents old completion on the new revision.
- [ ] Requirement-only change reuses sufficient graph and records exact evidence applicability; Owner Stop stays effective.

## Dependency and scope

Follows [Ordered Task Conversation and guidance](../09-30-a-task-conversation/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
