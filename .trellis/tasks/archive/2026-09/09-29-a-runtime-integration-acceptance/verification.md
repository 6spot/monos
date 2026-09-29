# Production Runtime integration verification

Date: 2026-09-29. Product source baseline: `197371f`; this leaf changes only the acceptance harness and documentation. The authorized Debian host is `100.120.14.84`, source `/root/monos-boundary-probe-src`, existing task Compose endpoint `127.0.0.1:18444`, Runner `monos-probe-runner.service`. No new standing service was installed. Private immutable evidence is retained in `/root/monos-integration-evidence-v1`.

## Results

| Case | Evidence | Result |
| --- | --- | --- |
| Two shared slots, visible queued Planner, service reconnect and single promotion | `queue-final-integration-queue-20260929-01.json` and its before/after/promotion checkpoints | Pass. A native Node and Planner held distinct supervised processes. The third selected Planner remained QUEUED with no process/Start and empty logs. Existing backend/Runner restart retained the live identities, selections and Start IDs. Three atomic promotion samples respected capacity; the queued Planner started after the Node's verified release. All three formal outcomes and resumed ordered logs passed, with exactly one completed Start record per selection. |
| Selected Node and Planner logs across backend restart | `logs-final-integration-logs-node-20260929-01.json`, `logs-final-integration-logs-planner-20260929-01.json` | Pass on current product source. Cursor continuation equals canonical complete log history; raw output does not enter formal Task history. Both native CLI handoffs succeeded and released their process trees. |
| Exit without formal completion and detached descendants | `missing-final-integration-missing-20260929-01.json` | Pass on current product source. Attempt FAILED with `missing_formal_outcome`, Node/Task BLOCKED, no manufactured completion, revoked mutation authority, whole-tree Stop and released physical reservation. |
| Node Stop/Continue and pre-Plan Planner Stop/Retry | Prior `monos-stop-evidence-v1/stop-final-stopn-20260929-a3.json` and `stop-final-stopp-20260929-a2.json` | Pass, reused after source/binary verification. Immutable receipts, changed-payload conflicts, physical Stop and same-owner recovery remain attributable. |
| Controlled host reboot and scoped recovery | Prior `monos-stop-evidence-v1/reboot-after-reboot-stop-20260929-a1.json` and referenced live checkpoint | Pass, reused after source/binary verification. Changed boot, retained original lineage, old writers absent, interrupted work BLOCKED, existing receipt readable, unsent command unknown and no replacement Start. No repeat host reboot was needed in this leaf. |

The seven result files and their checks/hashes are summarized in `research/host-evidence.json`; `research/product-source-hashes.json` records 120 exact matching local/host product files. Installed Runner SHA256 is `1ef5e0f8a5aa2dcfb416ad09747be235fd4c28d758747d4048d608145b73a523`; bundled CLI SHA256 is `55d4d139a55a48b031eb31e63bbf34ea526fb0e13729ba83b3ac98c73b55ab62`, both identical to the Stop/reboot leaf. The live Runtime is OpenCode 1.18.30 with `opencode/longcat-2.5-preview-free`; each real trial refreshed availability/tool-call/zero input/output/cache-price facts before admission, and Runner performs its own exact-environment preflight.

Final host audit: connected/ready Runner at incarnation 22, capacity two, zero queued/reserved Attempts and zero unresolved operations. No trial Attempt unit remains active; both existing Runner services remain active. Historical evidence/workspaces and canonical receipts remain retained intentionally.

## Quality and review

- Local protocol drift, lint, typecheck, build and unit suite passed: 86 tests (94 DB cases skipped by that entrypoint).
- Real PostgreSQL entrypoint: 12 files, 96 tests passed against the existing isolated Compose database.
- Linux Go 1.27.1 race tests and vet passed using the existing pinned image and dependency cache. First invocation used an incomplete cache and failed dependency downloads due to network timeout; rerunning against the existing populated cache with network disabled passed. No source change was needed.
- Final Python harness: 50 tests pass locally and on Linux, including 17 queue evidence/cleanup regressions. Read-only full-scope harness review found no blocking issue. `git diff --check` passed.

The live queue trial used the retained `queue-tested-source.py`. The final harness adds only a two-line failure-cleanup safeguard: stop cleanup when a cancelled queued selection still has an unknown result. Its added negative test passes; the successful live path is unchanged. Both source hashes are recorded rather than claiming that later edit ran during the earlier trial.

## Limits

Native model calls execute a deterministic driver through the Runtime's shell tool; this proves production Runtime/Tool Protocol integration, not autonomous semantic planning quality. Atomic capacity samples observe particular instants; PostgreSQL contention/crash tests separately establish the scheduling guard. Reused reboot evidence required manual startup of the already-installed disabled Runner units, so automatic boot enablement remains deployment work. This accepts the Runtime integration package only, not Task conversation, complete Stage A, a second CLI, delivery or V1 release.
