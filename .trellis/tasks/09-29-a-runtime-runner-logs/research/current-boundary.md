# Current boundary and architecture anchors

## Source facts

- `apps/server/src/runtime-scheduling.ts` selects an explicit/Planner/Role/global target and calls `DispatchQueue.enqueue` inside an owning transaction. `apps/server/src/dispatch-queue.ts` records QUEUED work, promotes it under capacity and owner fences, then writes Start outbox.
- `apps/server/src/service.ts:event` validates and persists `RuntimeEvent` by `(attempt_id,stream_id,sequence)` with digest-based duplicate conflict detection. It handles `started`, `exited`, `process_absent` and missing formal outcome. It currently does not require contiguous ingestion for Owner visibility.
- `runner/internal/daemon/daemon.go` reads stdout/stderr files in 32 KiB chunks, journals each chunk with its source offset and retransmits pending events. `runner/internal/journal/journal.go` allocates sequence per stream, so no cross-stream order exists.
- `runner/internal/adapter/opencode.go` currently limits retained stdout to 4 MiB and stderr to 1 MiB, appending a truncation marker. This conflicts with the complete-log contract in `docs/06-state-and-formal-data.md` under “Execution Log”.
- `apps/server/src/owner-reads.ts` and `apps/server/src/app.ts` expose a formal Task event cursor and overview, but no Execution Log reader. `apps/web` currently presents configuration, not Task detail.

## Required contracts

- `docs/03-runtime-and-execution.md`: Runner owns process/log facts; backend owns Attempt/Task/Node claims. Missing formal completion blocks a Node; admitted completion settles first. Heartbeat loss never proves process absence. Planner Attempts use the same Runtime infrastructure.
- `docs/05-tool-protocol.md`: Agent formal actions use Attempt-scoped `monos` commands and backend admission; raw output is no state transition.
- `docs/06-state-and-formal-data.md`: Execution Log is a complete append-only Attempt history, separate from Task Event, Timeline and Current Task State.
- `docs/07-owner-review-and-ui.md`: Owner Task Overview shows formal state; Execution Details exposes current/latest Attempt and log without making Attempt a required navigation layer.
- `docs/09-first-executable-slice.md`: Stage A real CLI and browser reconnect cases remain acceptance gates; fake adapters alone are insufficient.

## Planning implications

The new order must be assigned before transport and retained across retransmission; backend arrival order alone cannot repair reordered delivery. Across independent stdout/stderr pipes, the only honest total order is Runner observation order. Full output retention needs disk-pressure failure handling, not silent truncation. Owner pagination must stop at gaps and must not share the formal event cursor.
