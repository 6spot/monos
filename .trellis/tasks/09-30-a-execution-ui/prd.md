# Execution Board and Task control UI

## Goal

Expose real Task progress and controls through responsive canonical views.

## Requirements

- Provide Ready to start/Running/Review board and factual attention, Task Conversation/Overview/Timeline and execution diagnostics.
- Expose Start/Stop/Retry/Continue, blocker/issue answers, exact proposal decisions, input withdrawal and Replan dismissal through existing authenticated commands.
- Preserve source/Task navigation, per-scope drafts and uncertain request identity; terminal conversation and local REVIEW remain correctly labeled.
- Use normal work/progress presentation; keep DAG and raw logs in diagnostics and do not infer state from prose.

## Acceptance criteria

- [ ] Browser reload/two clients/lost response preserve canonical results and recover the original command rather than duplicate it.
- [ ] All backend Owner exits are reachable with clear unavailable/queued/settling behavior and keyboard/mobile accessibility.
- [ ] Local REVIEW exposes exact result without claiming a PR, delivery acceptance or V1 completion.

## Dependency and scope

Follows [One-Node replacement Plan and Replan exits](../09-30-a-single-node-replan/prd.md).
Parent links express ownership; this ordering is an evidence gate. The Owner has
authorized sequential execution and routine implementation/test decisions.
No new permanent service, team model, generic workflow engine, automatic Runtime
hang inference, mandatory native session resume or cross-Runner migration.

This is a scoped backlog leaf; complete its design, implementation plan and real
context manifests immediately before starting it. See parent research for seams.
