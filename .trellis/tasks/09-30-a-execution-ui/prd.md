# Execution Board and Task control UI

## Goal

Expose real Task progress and controls through responsive canonical views.

## Requirements

- Provide Ready to start/Running/Review board and factual attention, Task Conversation/Overview/Timeline and execution diagnostics.
- Expose Start/Stop/Retry/Continue, blocker/issue answers, exact proposal decisions, input withdrawal and Replan dismissal through existing authenticated commands.
- Preserve source/Task navigation, per-scope drafts and uncertain request identity; terminal conversation and local REVIEW remain correctly labeled.
- Use normal work/progress presentation; keep DAG and raw logs in diagnostics and do not infer state from prose.

## Visual requirements

Build Board and full Task surfaces using the [visual contract](../../spec/frontend/visual-design.md) and [owned component rules](../../spec/frontend/component-guidelines.md). Coordinate shared shell/primitives with the separately planned [existing-screen migration](../archive/2026-09/09-30-frontend-visual-standards/migration-handoff.md); this leaf owns new execution surfaces, not the entire existing Settings/Todo migration.

## Acceptance criteria

- [ ] Board and Task sections meet the [visual quality gate](../../spec/frontend/quality-guidelines.md): inspected desktop/mobile screenshots cover populated, empty, queued, disabled, error and long-content states with reference comparison and recorded deviations.

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
