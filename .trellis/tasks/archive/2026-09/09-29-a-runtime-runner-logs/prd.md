# Production Runner dispatch and execution logs

## Goal and Owner value

A selected Planner or Node Attempt runs through the installed Runtime and bundled `monos` command path. The Owner can inspect factual status and complete execution output, then resume reading after a browser or backend disconnect without treating output as formal Task history.

## Background and confirmed facts

- Runtime target selection and shared slots are complete. Their selected Attempt, durable Start outbox and Planner priority are the admission boundary.
- The accepted boundary probe already has authenticated WSS dispatch, supervised starts, scoped CLI attribution, a local SQLite event journal and backend `runtime_events` ingestion. Reuse those contracts.
- The current Runner reads stdout/stderr independently and truncates them at fixed per-Attempt limits. The backend has no Owner execution-log reader; its Task event cursor is for formal events only.
- Product Todo/Task conversation, Owner Start and full Task detail UI belong to later Stage A packages. This leaf provides the selected-Attempt path and Owner read contract they can consume; acceptance uses canonical seeded Planner and Node owners through the real Runner/CLI boundary.

## Requirements

1. A promoted, selected Attempt carries its exact owner, revision basis, fencing generation, context, Runtime target and command authority through durable dispatch. Duplicate or delayed Start cannot spawn twice or revive revoked authority.
2. The installed Runtime launches for Planner and Node owners with the bundled `monos` CLI available. Agent calls are admitted under the current Attempt scope; Runner output cannot mutate Task or Node state.
3. Runner durably captures complete raw process output and objective lifecycle facts in a stable, gap-detectable per-Attempt order. Local storage failure raises explicit attention and stops or isolates affected work safely instead of silently discarding output.
4. Backend stores the log separately from formal Task Events and provides authenticated, bounded Owner pages with an Attempt-bound resumable cursor. Exact duplicates are idempotent, conflicting duplicates fail, and reordered delivery cannot skip missing entries.
5. Canonical Owner reads identify queued/running Planner and Node Attempts, factual activity and log availability. The later Task detail UI can consume these reads without interpreting output as lifecycle authority.
6. Runtime exit without required formal completion leaves a Node blocked for Owner Retry. An admitted completion operation is settled before exit is interpreted. A Planner exit without its required formal result cannot fabricate a Plan or reply.

## Acceptance criteria

- [x] Canonical seeded Planner and Node Attempts each launch through the installed CLI using the selected target and invoke a scoped `monos` command; stale and cross-Attempt authority is rejected.
- [x] An Owner pages multi-stream output, disconnects, restarts the backend and resumes from the last acknowledged cursor without duplicate or skipped entries; duplicate/reordered Runner delivery preserves order.
- [x] Output remains available after process exit and absent from formal Task Events/Timeline; queued work and objective activity are visible without inferring progress from log text.
- [x] Exit without `complete_node` does not complete a Node; an already admitted completion wins the exit race. Missing Planner formal output does not publish semantic results.
- [x] Storage/backpressure and interrupted delivery preserve recoverable evidence or safely isolate execution with explicit attention, with no false success.

See [verification](verification.md) for the final real-host records, local/host checks and fault-injection limits.

## Out of scope

Full Todo/Task semantic commands, full Task detail UI, Stop/restart settlement, other Runtimes, native session resume, cross-Runner movement, live steering, GitHub delivery and complete Stage A host acceptance remain in their owning tasks. No new Task state, Agent-authored recovery checkpoint, team abstraction or model selection algorithm is introduced.

## Source contracts

[Architecture](../../../ARCHITECTURE.md), [Runtime](../../../docs/03-runtime-and-execution.md), [Tool Protocol](../../../docs/05-tool-protocol.md), [State and logs](../../../docs/06-state-and-formal-data.md), [Owner diagnostics](../../../docs/07-owner-review-and-ui.md), [Stage A](../../../docs/09-first-executable-slice.md), [invariants](../../../docs/08-principles-and-non-goals.md).
