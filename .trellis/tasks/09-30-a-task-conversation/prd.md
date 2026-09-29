# Ordered Task Conversation and guidance

## Goal

Keep ordered Task-owned conversation and durable guidance without implicit lifecycle changes.

## Requirements

- Persist Task inputs, source/watermark, canonical replies/routing and explicit Retry/Withdraw through one Task Planner authority.
- Build bounded Task context and search older in-scope history without Todo context or another Task preview.
- Record Node/activation guidance obligations and handling outcomes; use controlled follow-up/stop-and-resume without claiming live steering.
- Before Start, while stopped and on terminal Tasks, conversation cannot Start/Continue/reopen; later accepted-batch input remains conversation-only under delivery guards.

## Acceptance criteria

- [ ] Two-client concurrent input and busy Planner queueing retain order, one reply per source and recoverable dispositions.
- [ ] Progress questions preserve execution/evidence; guidance racing completion remains pending until handled or explicitly resolved.
- [ ] Saturation, failed reply, terminal input and uncertain command recovery expose usable Owner exits without losing input.

## Dependency and scope

Follows [Single-Node execution, artifacts and recovery](../09-30-a-node-execution/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
