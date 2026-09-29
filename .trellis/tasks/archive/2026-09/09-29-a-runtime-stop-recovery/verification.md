# Verification: Runtime Stop and restart reconciliation

Date: 2026-09-29. The selected live trials ran on the Owner-authorized Debian host `100.120.14.84`, using `/root/monos-boundary-probe-src`, the task Compose server on `127.0.0.1:18444`, and `monos-probe-runner.service`. The earlier `monolab` installation on port `18443` remained installed. Private, non-overwriting evidence is under `/root/monos-stop-evidence-v1` on that host.

## Real-host acceptance

| Case | Retained evidence | Result |
| --- | --- | --- |
| Selected Node Stop, service restarts and Continue | `stop-final-stopn-20260929-a3.json`, `stop-before-stopn-20260929-a3.json`, `stop-after-restart-stopn-20260929-a3.json`, `stop-admitted-stopn-20260929-a3.json` | Pass. The installed OpenCode and `monos` CLI reached a held native tool checkpoint. Backend and Runner restarts retained the live PID, birth, boot and cgroup identity and physical reservation. Owner Stop revoked mutation authority, kept one immutable admitted receipt across replay, rejected changed Attempt ID under the same request ID with `payload_conflict`, stopped detached/double-fork descendants, settled the Stop operation and released the claim. Continue returned that same Node to PENDING without automatically launching a successor. |
| Selected initial Planner Stop and Retry | `stop-final-stopp-20260929-a2.json`, `stop-admitted-stopp-20260929-a2.json` | Pass. This Task had no published Plan. Stop fenced the held Planner and returned the Task to PLANNING; its process tree was absent and released. Retry returned the same Task to RUNNING without manufacturing a Plan, formal reply or successor Attempt. Changed Attempt ID replay conflicted. |
| Controlled host reboot during selected Node hold | `reboot-before-reboot-stop-20260929-a1.json`, `reboot-issued-reboot-stop-20260929-a1.json`, `reboot-after-reboot-stop-20260929-a1.json`, `reboot-host-preflight.json`, `reboot-host-after.json` | Pass. The reboot was issued with 269 seconds remaining in the recorded hold. The new boot ID differed; the original dispatch and old PID/birth/boot/cgroup record remained attributable, while its writers and descendants were absent. The Stop settled and released the claim; the Node and Task remained BLOCKED. The admitted workspace receipt remained readable; the unsent Agent command remained unknown and was not replayed; no replacement Start appeared. |

The source profile is `profile.json` with fingerprint `610001953d2ae211be3726495ade0050f8d27f1d76e28f04b7403551ea753ffa`; it records OpenCode 1.18.30 and the exact `opencode/longcat-2.5-preview-free` model as active, tool-call capable, and zero input/output/cache cost. Each real start refreshed this catalog before use. The installed Runner SHA256 is `1ef5e0f8a5aa2dcfb416ad09747be235fd4c28d758747d4048d608145b73a523`; installed CLI SHA256 is `55d4d139a55a48b031eb31e63bbf34ea526fb0e13729ba83b3ac98c73b55ab62`. The final deployed `owner-execution.ts` and `stop_probe.py` hashes matched the local reviewed files.

The first Node trial, `stopn-20260929-a1`, stopped and released its process correctly but the changed Attempt ID check returned `denied_scope`. Full-scope review found the backend looked up a new payload's Attempt before its existing request receipt. The backend now compares existing receipt digest first; the old Node was safely continued, and fresh strict Node and Planner trials passed on the corrected backend. The intermediate `stopn-20260929-a2` and `stopp-20260929-a1` evidence remains retained and is not used as the final contract proof.

## Quality gates

- Final Linux Compose PostgreSQL suite: 12 files, **96 tests passed**, including Stop/Continue/Retry, completion-wins and Stop-first ordering, earlier workspace effects, independent runnable Nodes, pre-Plan Planner, reconnect identity and one-time recovery lineage.
- Linux Go 1.27.1: `go test -race ./...` and `go vet ./...` passed on the staged Runner source.
- Local: `pnpm protocol:check`, lint, typecheck, build, Vitest **86 passed** (database suites skipped locally), Python probe **33 passed**, and `git diff --check` passed.
- Immediately before reboot, task and old service databases each had zero unrelated unreleased Attempts and no active Attempt units. At the checkpoint only the selected held Attempt occupied a unit. After reboot, all 12 prior container names had the same status/health classification; both Runner units were restored active, and both databases had zero unreleased Attempts.

## Limits and host note

The selected real trials use a deterministic driver invoked through OpenCode's native bash tool. They prove the Runtime/CLI and Tool Protocol boundary, not autonomous semantic planning. The later Task Context Builder owns full current conversation construction before production successor scheduling; this leaf only restores eligibility and proves selected successor admission through a current canonical fixture in PostgreSQL tests.

Both Runner systemd units were active before reboot but configured `disabled`, so they were manually started after the host boot before reconciliation was verified. The reboot proves durable identity, receipt and physical Stop recovery after those services reconnect; automatic boot enablement is deployment configuration outside this task. The pre-existing unrelated Chronicle worker was already in a restarting state before reboot and remained so afterward.
