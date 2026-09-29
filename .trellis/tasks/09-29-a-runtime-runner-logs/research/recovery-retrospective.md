# Recovery boundary retrospective

## 1. Root causes

- **Cross-layer contract:** The first Runner exit implementation waited for the entire systemd cgroup to become empty before emitting `exited`. A main process that exited after spawning detached descendants therefore never triggered the backend's missing-formal-result rule.
- **Implicit readiness assumption:** After a backend restart, the new Runner connection instance became visible before inventory reconciliation and `Ready` completed. A valid attributed CLI command could temporarily receive `control_unavailable`.
- **Test coverage gap:** A log page's `has_more=false` described one visible snapshot, but the live acceptance harness interpreted it as a permanent tail while the Runner could still deliver late events.
- **Persistence ownership:** Capture-failure evidence written by the execution account could be unreadable by the Runner service account after restart. Recovery needs a service-owned durable marker as well as the worker's exit status.

## 2. Why earlier fixes were incomplete

The initial selected Node/Planner trials showed a valid CLI launch but formal completion failed during reconnect. Retrying with a fresh request would have changed the operation identity, so the driver was changed to retry the same immutable request only after readiness. The first missing-result trial then exposed the separate main-exit/cgroup-absence mistake. One Planner trial completed formally yet failed harness verification because the harness stopped reading at a transient empty tail.

## 3. Prevention

| Priority | Mechanism | Action |
| --- | --- | --- |
| P0 | Runtime contract | Distinguish main exit from whole-tree absence and keep the physical slot until Stop/absence. |
| P0 | Recovery test | Exercise main exit with detached descendants and verify backend `BLOCKED`, Stop and release on a real Linux host. |
| P0 | Journal test | Inject spool/journal failure and verify durable attention survives a daemon restart. |
| P1 | Client contract | Treat `has_more=false` as a snapshot; advance cursors only after retaining pages. |
| P1 | CLI retry | Reuse the original request ID through transient `control_unavailable`; never reread changed input. |

## 4. Wider implications

The same distinction applies wherever a process supervisor reports both a main process and a tree of descendants. Owner status must display facts separately: `exited`, `process_absent`, `process_released` and formal outcome. A cursor is a retained read position, not proof that the producer has stopped. Permission boundaries around failure evidence must be tested from both the execution and service identities.

## 5. Knowledge capture

Contracts are recorded in `.trellis/spec/runner/execution-guidelines.md`, `.trellis/spec/backend/execution-logs.md` and `.trellis/spec/frontend/state-management.md`; matching Go, backend and browser tests are part of this task. The repository has no `src/templates/markdown/spec/` mirror to sync.
