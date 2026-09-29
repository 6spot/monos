# Verification: production Runner dispatch and execution logs

Date: 2026-09-29. The real-host runs used the Owner-authorized Debian Linux host `100.120.14.84`, staging root `/root/monos-boundary-probe-src`, task Compose server on `127.0.0.1:18444`, and task service `monos-probe-runner.service`. The pre-existing `monolab-probe-runner.service` and port `18443` remained active and were not migrated. Final installed Runner SHA256: `8949cbb5700f5bbfcd574e03a8ecb090f54ac9143cc87e6bd7c3f3810e4ac43d` (`/usr/local/libexec/monos-runner`). The final Runner source was staged after the UTF-8 and service-owned failure-marker fixes and built on the host with Go 1.27.1. Backend code used the task Compose image built from the same task worktree; the only later code edits were in Runner and documentation.

## Real-host acceptance

Private evidence is retained under `/root/monos-logs-evidence-v3` on the host. Final successful records:

| Attempt | Evidence | Verified result |
| --- | --- | --- |
| `logs-node-v5-01` | `logs-final-logs-node-v5-01.json`, `prepared-logs-node-v5-01.json` | Selected `ordered_v1` dispatch, installed OpenCode and `monos` formal completion, backend restart, cursor resume with exactly complete raw log, no raw output in formal Task Events, `SUCCEEDED`, physical absence and release. |
| `logs-planner-v5-01` | `logs-final-logs-planner-v5-01.json`, `prepared-logs-planner-v5-01.json` | Same selected CLI/log/restart/cursor assertions for Planner and its formal reply; `SUCCEEDED`, physical absence and release. |
| `logs-missing-v5-01` | `missing-final-logs-missing-v5-01.json`, `missing-prepared-logs-missing-v5-01.json` | Selected Node exited without `complete_node` with detached descendants; Runner reported main exit, backend marked Node `BLOCKED`, no formal completion appeared, authority was revoked, descendants were stopped and physical release was verified. |

Each preparation refreshed the exact `opencode/longcat-2.5-preview-free` catalog entry before the model call. The records show `active`, native tool calls enabled, and input/output/cache-read/cache-write prices all zero. Node and Planner final statuses each had `visible_sequence = latest_sequence = 3`, `process_absent = true`, `process_released = true`, and `mutation_allowed = false`. At the end, PostgreSQL reported zero started Attempts with `process_released = false`; both old and task Runner services were active.

## Quality checks

- Linux host: `go test -race ./...` and `go vet ./...` passed against the final staged Runner source.
- Linux Compose database suite: 11 files, 88 tests passed; output retained as `/root/monos-logs-evidence-v3/db-tests-final.txt`.
- Local full-scope review: `pnpm protocol:check`, lint, typecheck, build, Vitest (81 passed; 86 DB tests skipped without a local `DATABASE_URL`), Python probe tests (33 passed), and `git diff --check` passed. The database suite above ran with the real task PostgreSQL connection.
- Runner regression tests cover durable Attempt-wide ordering and retransmission, spool failure and capture attention, UTF-8 boundaries, `active (exited)` with living descendants, and physical release only after Stop/absence. Backend tests cover duplicate/conflicting and reordered delivery, cursor scope/page limits, activity, missing formal result and admission races. Browser tests cover cursor acknowledgement after retaining a page.

## Limits

Real disk exhaustion and the exact uncertain-admission crash windows were verified by deterministic fault injection, not by filling the host disk. No whole-host reboot was performed for this leaf. The real trials use a deterministic driver invoked by OpenCode's native bash tool; they establish the selected Runtime/CLI boundary, not autonomous planning quality. Full Task detail UI and later delivery gates remain with their owning tasks.
