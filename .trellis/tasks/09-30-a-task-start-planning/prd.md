# Explicit Task Start and initial planning

## Goal

Start one independent Task planning chain and publish a valid one-Node Plan.

## Requirements

- Explicit Owner Start moves PLANNING to RUNNING and records one durable planning intent; duplicate Start cannot create another chain.
- Build Task-scoped context from effective Specification, current Project/resources and selected Role descriptors without Todo Discussion/cache/session.
- Planner publishes one immutable valid Node or raises a planning issue; unsupported multi-Node plans are not flattened.
- Expose queued/unavailable reasons, source-targeted Stop/Retry, exact planning-issue answer + Retry, and pre-Plan Cancel. These controls remain available without model capacity; successor execution waits for prior physical settlement.
- Preserve immutable bounded context, exact Owner/Agent receipts, current source/claim/revision guards, and historical attempt-targeted Stop/Retry compatibility.
- Publish only a single PENDING Node in this leaf; production Node execution follows in the next leaf.

## Acceptance criteria

- [x] Created Tasks do no planning until Start; real Planner produces one valid Plan or recorded issue with exact source/claim/revision guards.
- [x] Concurrent/replayed Start, stale publication, process loss and restart preserve one planning chain and no automatic workspace creation.
- [x] Owner exits work without free model capacity; stopped/cancelled Tasks do not restart through chat or stale work.
- [x] An open issue has exact answer + Retry, Stop withdrawal and Cancel exits; repeated answers remain in fresh Task-only context.
- [x] Context/transport budgets reject oversized input without clipping, and an explicit Retry is required to refresh a failed frozen source.
- [x] Real canonical Owner-created Tasks prove no planning before Start and real bundled-CLI Plan/issue outcomes, with settled processes and no repository/Node execution.

## Dependency and scope

Follows [Authorized Project repositories and serial Task workspaces](../archive/2026-09/09-30-a-serial-workspaces/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

Design, implementation ownership and validation gates are recorded in `design.md`
and `implement.md`; curated context manifests include the completed backend-seam
research. Planning was reviewed under the standing sequential-work authorization.
