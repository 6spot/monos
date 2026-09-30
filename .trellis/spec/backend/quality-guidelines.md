# Backend Quality Gate

Sources: [Stage A](../../../docs/09-first-executable-slice.md), [readiness](../../../docs/10-architecture-readiness.md), [invariants](../../../docs/08-principles-and-non-goals.md).

## Verification status

The boundary probe has actual scripts in [package.json](../../../package.json): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build`, and `pnpm test:db`. Default `pnpm test` deliberately skips the real PostgreSQL suite. On 2026-09-28 the reviewed backend passed 45 unit/schema tests locally and 15 PostgreSQL integration tests in the isolated Node 24/PostgreSQL 17.11 Compose deployment. These tests prove only their asserted probe behavior.

The [Compose README](../../../infra/compose/README.md) describes the private database and real test command. SQL tests create/drop a unique test schema, not production tables or Runner journals. Main-session host evidence owns TLS, Linux processes, real CLI, service restart and reboot claims; no unit test can establish them. Full PostgreSQL multi-worker and authorized GitHub expected-head/merge gates remain separate.

Runtime target selection and shared-slot scheduling passed 79 local tests and 81 real PostgreSQL-entrypoint cases on an isolated PostgreSQL 17.10 instance on 2026-09-29. The DB cases include Auto placement serialization, capacity contention, queue priority and pre-start Runtime loss. They do not establish a new live model run or production host restart. After moving a checkout, `pnpm build` must repair dangling generated `dist/*/node_modules` links before creating fresh links; never replace a real directory.

## Rules

The real database entrypoint now includes `postgres.test.ts` (16 cases),
`postgres-claims.test.ts` (6 independent-process cases) and
`postgres-recovery.test.ts` (3 process-crash/settlement cases). All 25 passed on
the pinned Linux PostgreSQL deployment. The regular unit entrypoint skips all
database suites unless `MONOS_TEST_DATABASE=1`; use `pnpm test:db` for this gate.

- Test deterministic rules independently of HTTP/Git/Runtime.
- Use fakes for races, then real Linux/CLI/provider probes for external assumptions.
- For concurrent input, test distinct first-time requests as well as duplicate
  replay. Use separate connections/sessions and observe lock contention before
  releasing the barrier; verify canonical ordering and one outcome per source.
  `postgres-discussion.test.ts` additionally requires prior physical settlement
  before same-Todo promotion even when another Runner slot is free.
- Validate external payloads and handle result variants exhaustively.
- Never refresh a stale basis automatically to make an action succeed.
- Preserve full collection cardinalities in the single-Node slice.
- Apply the [dependency policy](../index.md); no speculative frameworks.

## High-value tests

Current probe regressions: receipt replay/conflict, atomic rollback/lost reply, capacity reservation, stale connection/credential rejection, event reordering, outbox starvation, complete snapshot pagination with Unicode byte bounds, typed capture repair, and Planner failure state preservation. The table below additionally guides later full-product work; those unimplemented flows are not claimed covered by the probe.

| Boundary | Assertion |
| --- | --- |
| Task creation | Different request IDs for one proposal yield one Task |
| Claims/capacity | Workers cannot double-start or oversubscribe |
| Completion/invalidation | Only current evidence unlocks descendants |
| Replan | Changed definitions get new Node IDs; old writers settle |
| Conversation | Atomic reply/watermark, Retry/Withdraw |
| Acceptance | Input first blocks; acceptance first freezes a nonblocking cutoff |
| Delivery | Expected-head guards, uncertain response, partial Retry |
| Limits | Local hard failure BLOCKED; publication finding REVIEW |
| Restart | Outbox/receipt recovery without session memory |

Test observable behavior and races, not private-helper mirroring. Documentation-only work needs link/consistency/format checks rather than an invented runtime suite.

## Review exit

Exact Specification revision acceptance (2026-10-01):269 unit/schema tests,
292 real PG cases across27 files,179 Python probes and Linux Go module/race/vet/
four-binary checks passed. Native proof covers pre-Start edit, actual prepared and
attached proposal, exact Owner authorization, private writer Stop/checkpoint,
Owner Stop preservation, explicit Continue on fresh Spec, actual Git completion,
completed evidence carry and existing backend/Runner restart. See the Specification
task's immutable source/native reports. The first strict restart comparison failed
on late exit-log projections; retained read-only follow-up ties each of4 exact +1
entries to `exited`, while requiring all other records/receipts/Git unchanged.
Raw activity/log-visible/exit-observed changes do not themselves change authority.

Report executed checks and untested real-host assumptions. The probe does not prove the complete Stage A flow, full multi-worker claims, GitHub delivery or cancellation during admitted finalization. Keep added regressions at their actual boundary instead of declaring external behavior from fake adapters.

Owner command foundation: 51 local unit/schema cases and 32 real PostgreSQL cases
passed on 2026-09-29 (including 7 in `postgres-owner.test.ts`). Full Go race/vet
passed after adapting generated enum references. These checks do not establish
public login, domain action execution or the deferred live Runtime acceptance.

Task record foundation adds `postgres-task-records.test.ts`: eight real database
cases plus one pure graph test. Total: 52 local cases and 41 cases through the DB
entrypoint (40 database cases plus that pure graph test). Check native module load
in addition to Vitest; `erasableSyntaxOnly` prevents non-erasable runtime syntax.

Dispatch foundation adds eight cases in `postgres-dispatch.test.ts`, including
independent-process SIGKILL before/after promotion COMMIT. Total DB entrypoint:
49 cases (48 database cases plus pure graph validation); local suite: 52 cases.

Owner reads add six PostgreSQL cases. The complete DB entrypoint now passes 55
cases (54 DB cases and one pure graph test); the local suite passes 56 cases.
Shared read schemas also pass Linux Go race/vet. UI/SSE remain later work.

Owner access adds five real PostgreSQL/native CLI cases: the full DB entrypoint
passes 60 cases (59 DB plus pure graph validation), local suite 58 cases, and Linux
Go race/vet. Synthetic passwords only; deployed Owner credentials are untouched.

Project/Role configuration adds eight real database cases plus one pure repository/ref
case. DB entrypoint: 69 passed; local suite: 63 passed (including four new wire
fixtures). Linux Go race/vet passed; these checks do not establish live Runtime or
provider discovery. Complete snapshots and receipt-failure rollback are exercised.

Runtime/provider configuration adds five real database cases: 74 DB-entrypoint
cases pass. Local suite is 70 cases after seven shared protocol fixtures. Linux
Go race/vet and an actual execution-account OpenCode 1.18.30 version probe pass;
GitHub tests use synthetic RSA keys and injected provider responses, not live App
credentials or remote write permission evidence.
