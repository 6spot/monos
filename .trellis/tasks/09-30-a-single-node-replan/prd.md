# One-Node replacement Plan and Replan exits

## Goal

Replace a confirmed one-Node graph while retaining Task and workspace lineage.

## Requirements

- Persist actual graph-insufficiency requests and exact complete one-Node replacement proposals; reject unsupported multi-Node graphs explicitly.
- Quiesce old claims/writers/effects before atomic Plan publication or joint Specification+Plan publication.
- Changed formal Node definitions receive new Node identity; retained work/history and private workspace disposition stay explicit.
- Planning issues, Replan dismissal and change/feedback withdrawal resolve only their own obligations.

## Acceptance criteria

- [ ] Confirmed replacement/joint publication preserves one Task/workspace lineage with no partial pointer or stale current evidence.
- [ ] Concurrent confirmation, Stop, new input and crash cannot publish a stale graph or hand over a live writer.
- [ ] Dismissal does not publish a pending Specification or silently clear source feedback; explicit exits remain usable.

## Dependency and scope

Follows [Exact Specification changes and settlement](../09-30-a-specification-changes/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
