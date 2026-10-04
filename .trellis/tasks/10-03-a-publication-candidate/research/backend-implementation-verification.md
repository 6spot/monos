# Backend and shared protocol implementation verification

2026-10-04. Delegate `/root/local_result_implement`, task
`10-03-a-publication-candidate`. Main owns final review and integration.

## Implemented scope

The exact frozen contract lives in `frozen-contract.md`. Additive protocol source,
generated TypeScript/Go/schema/OpenAPI, shared fixtures and handwritten shared-wire
validation enforce full publication frame 512KiB, 64 findings/page, valid Unicode
and 4096 UTF8 path bytes. Canonical IDs bind original result, effective basis,
fixed candidate construction, scan configuration/run and sanitized finding facts.

Migration 0022 adds a durable publication lane independent of Attempts, nullable
item until physical tree comparison, immutable pages/candidates/scans/findings and
exact Owner receipts. Automatic settled REVIEW admission/restart pump reuses the
fixed construction, original successful Basis-absent materialization observation
and complete canonical result. Production admission uses the verified base parent;
optional target proofs remain an explicit Runner seam. No remote publication,
observer, provider/model call or accepted-delivery state transition was added.

Backend WSS settlement checks authenticated current instance/incarnation, original
operation/request, exact page/result/count/digest and independent safe finding
rules before persistence. No item, candidate, scan or ack exists before complete
page assembly. Exact settled pages may recover the lost ack after reconnect.
Interrupted operations resume their original identity; terminal incomplete scans
remain immutable and explicit authenticated Retry creates a new scan run/operation
over the same candidate construction. Unavailable/reconciliation states truthfully
disable Retry. History sorts newest first and direct candidate/findings reads retain
original source and current effective authority separately.

Four Owner commands persist exact prepare/confirm/apply/retry receipts and recheck
current complete eligible selections atomically. Hard findings never become
eligible; exact prior receipt replay survives later cancellation. Known public
credential exposures derive from all immutable item-scoped historical findings;
later clean scans/new candidate/deletion do not clear this remediation guard.
Finite-rule credential-bearing finding/baseline names must use the fixed redacted
placeholder before pages can be stored. No raw secret path/hash/value is emitted.

## Current inputs and ownership

`backend-input-manifest.json` records 29 owned input SHA256 values and the source
delta since the preceding snapshot. It is a current snapshot after verification,
not an assertion that every gate took before/after hashes. Unrelated AGENTS,
Trellis hooks/spec edits and Web/Runner host/daemon/control work were preserved.
Owned product groups are server publication modules plus app/main/completion/result
integration, migration/registry/test script, protocol source/generator/generated,
shared `runner/internal/wire` and backend fixtures/tests.

## Verification

Environment: Node 26.3.0, pnpm 12.6.0, Go 1.27.1 darwin/arm64. Actual isolated
PostgreSQL credentials were loaded privately from the active cluster; no credential
was printed. Retained logs live in `backend-evidence/`.

| Command | Scope/result |
| --- | --- |
| `MONOS_TEST_DATABASE=1 pnpm exec vitest run apps/server/test/postgres-publication.test.ts apps/server/test/postgres-result-reads.test.ts apps/server/test/postgres-node-execution.test.ts apps/server/test/postgres-task-replan-workspaces.test.ts` | Actual PG affected integration, 46 PASS at earlier snapshot; unchanged existing result/execution/replan coverage retained |
| `MONOS_TEST_DATABASE=1 pnpm exec vitest run apps/server/test/postgres-publication.test.ts` | Current publication suite 13 PASS, including final queue/direct-read fixes and multi-rule ingest; `publication-postgres-13-final.log` |
| `pnpm exec vitest run packages/protocol/test/protocol.test.ts` | Shared strict fixture corpus 250 PASS; `shared-fixtures-250.log` |
| `pnpm protocol:check` | Generated source/schema/OpenAPI current; PASS |
| `pnpm test` | Default suite 356 PASS, 348 gated tests skipped at pre-starvation snapshot; PG was run explicitly above |
| `pnpm typecheck` | Root and Web types PASS after final direct-read/multi-rule regression addition |
| `pnpm lint` | Full apps/packages PASS before final review delta; affected three source/test files ESLint PASS after final delta |
| `go test -race ./internal/wire -count=1` | Shared Go publication/result boundaries PASS against frozen generated sources |
| `go vet ./internal/wire` | PASS |
| `git diff --check` | PASS after final review delta |

Runner host/daemon/control actual Git/SQLite/TLS tests and whole Go/race/vet gates
belong to `runner-implementation-verification.md`. Web built SPA and screenshot
checks belong to `frontend-implementation-verification.md`; synthetic physical Git
or scan peers in browser/backend fixtures are explicitly distinguished from actual
Runner Git scans. No backend test claims installed native two-account proof.

Actual PG cases cover version21→22 and unchanged checksums; repo-free completion;
both resource modes; formal completion admission and original parent; observed
competing-worker Task lock; transaction rollback/restart; out-of-order 65-findings
pages/reconnect ack; immutable terminal incomplete and exact Retry; actual Owner
three-step eligible confirmation/apply and mixed hard rejection; persistent exposure
through a genuinely command-admitted later clean result and scope isolation;
secret filename ingress rejection; actual authenticated TLS WSS capability and
historical late settlement; no-change with no item; Owner authentication/session
fences and cache/nosniff response headers.

## Review correction: queue fairness

The original due-row LIMIT2 occurred before paused admission guards and could
starve later Tasks. Current query excludes canonical paused guards before its
bounded LIMIT16, then rechecks exact source/config/admission under Task lock and
returns at most two frames. A racing temporary pause gets a five-second retry
clock while retaining the same operation. The regression creates four genuine
Planner/Node completed Tasks on one Runner. Two oldest Tasks retain active
conversation Planners; one pending call returns the later two. Actual reply
settlement releases the old Planners and their exact original operations resume;
there are still only four operations. The final 13-test PG gate supersedes earlier
publication evidence for this source delta; protocol/Go inputs did not change.

## Review corrections: direct-read authority and multi-rule findings

Direct candidate reads now acquire the same Task FOR SHARE as list reads before
loading the operation and projecting current/scan/action flags. The actual PG
regression parks the reader at the delivery_operations relation after its Task
pin. A genuine authenticated Owner `edit_specification` with explicit completion
carry is observed in `pg_stat_activity` waiting at Task FOR UPDATE. Releasing the
relation lets the coherent original read finish; then the Owner command publishes
a new immutable Specification while the Task remains REVIEW. The subsequent read
correctly returns current/scan_applicable/override_allowed false. No fictional
approval, receipt or domain publication was inserted.

The synthetic physical manifest PG fixture also settles a complete same-path/blob
page with classic-token and AWS-key rules, unique ordinals 1/2 and exact canonical
IDs/count/bytes/page/scan digests. Two findings over one visited version are legal.
Duplicate ordinals reject before page persistence. This complements the Runner
owner's actual Git multi-rule blob regression and per-accepted-finding ordinal
fix; this backend fixture does not claim it physically scanned Git. The schema
and shared protocol/Go inputs remained unchanged during these corrections.

## Failed trials and limits

Initial strict AJV required-property declaration, generated `PublicationACK` name,
erasable TypeScript constructor syntax and fixture tuple/assertion issues were
corrected without weakening contracts. The existing delayed Ready test initially
hit its intentionally offline DB after new capability persistence; its focused DB
and publication-pending mocks now preserve the original actual socket race test.
Retained initial failure logs show those resolved boundaries. Fairness regression
initially used the wrong Dispatch task field and omitted verified GitHub repository
metadata; actual settlement correctly rejected it, the fixture was corrected and
the full publication suite passed.

Production first-candidate admission is base-only and local. Optional target
construction is tested in actual Runner code, with no new pre-admission transport.
Workflow permission remains unknown; permission observation, published-parent
reconciliation, permanent storage loss and remote delivery are later-leaf work.
The scan deadline is the frozen 120-second local processing budget; no new full
HTTP/PG deadline framework is claimed. Main's native Linux validation is separate.
