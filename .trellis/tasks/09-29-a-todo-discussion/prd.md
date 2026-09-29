# Ordered Todo Planner discussion

## Goal

Let the Owner discuss an assigned or unassigned Todo using real Planner execution, with durable ordered input and recoverable formal replies.

## Requirements

- Follow Todo capture. Discussion starts only from an explicit Owner message; capture and selection remain model-free.
- Extend existing generic Attempt/dispatch ownership to Todo scope without creating fake Execution Tasks, PlannerInvocation records or a separate capacity pool. Preserve existing Task ownership/recovery compatibility.
- Context includes fixed protocol, configured Planner guidance, current Project context when assigned, immutable capture, current Working Requirement State and a deterministic recent-message window. Other Todo and Task contexts never leak.
- Persist Owner messages and per-Todo order before scheduling. A Planner commits its exact handled input, final reply, rebuildable requirement state and optional structured proposal atomically through the Tool Protocol.
- Busy/offline Planner leaves a visible queue. Missing formal outcome or Stop leaves explicit Retry/Withdraw; later same-Todo input waits until resolution and physical ownership settlement. Other Todos continue within shared slots.
- Browser drafts and messages are scoped per Todo. Reconnect reloads committed replies without duplicates; provisional logs never become formal Discussion.

## Acceptance criteria

- [ ] Real Todo-scoped Planner uses existing shared slots and native monos commands without manufacturing a Task.
- [ ] Concurrent messages preserve order; atomic reply/requirement state/watermark commit and receipt replay are crash-safe.
- [ ] Retry/Withdraw/Stop and reconnect preserve physical fencing, queue progress and immutable history.
- [ ] Unassigned and reassigned Todo context, UI drafts and committed replies remain properly isolated.

## Scope

No Task creation or execution planning. Structured proposal content is allowed in committed replies, but its exact confirmation and Task creation belong to the next leaf. Read source contracts in architecture modules 01–08 before detailed design.
