# Explicit Task Start and initial planning

## Goal

Start one independent Task planning chain and publish a valid one-Node Plan.

## Requirements

- Explicit Owner Start moves PLANNING to RUNNING and records one durable planning intent; duplicate Start cannot create another chain.
- Build Task-scoped context from effective Specification, current Project/resources and selected Role descriptors without Todo Discussion/cache/session.
- Planner publishes one immutable valid Node or raises a planning issue; unsupported multi-Node plans are not flattened.
- Expose queued/unavailable reasons, Stop/Retry and planning-issue answer/Retry plus appropriate explicit withdrawal/exit.

## Acceptance criteria

- [ ] Created Tasks do no planning until Start; real Planner produces one valid Plan or recorded issue with exact source/claim/revision guards.
- [ ] Concurrent/replayed Start, stale publication, process loss and restart preserve one planning chain and no automatic workspace creation.
- [ ] Owner exits work without free model capacity; stopped Tasks do not restart through chat or stale work.

## Dependency and scope

Follows [Authorized Project repositories and serial Task workspaces](../archive/2026-09/09-30-a-serial-workspaces/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
