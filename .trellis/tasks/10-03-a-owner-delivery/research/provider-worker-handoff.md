# Accepted GitHub worker implementation handoff

Date: 2026-10-05. Active task: `10-03-a-owner-delivery`.

## Ownership

This worker changed only:

- `apps/server/src/owner-delivery-worker.ts`
- `apps/server/test/postgres-owner-delivery-worker.test.ts`
- This handoff.

Earlier adapter handoff owns `github-finalization.ts`, its focused test and the
minimal additive profiles in `github-remote.ts`. Those inputs remained unchanged;
no adapter test or authenticated remote effect was repeated. Migration, acceptance
commands/state/reads and fixture are owned by the backend implementer. Root owns
accepted preparation, guards, control/Cancel, application wiring and integration.
Existing unrelated framework and concurrent edits were preserved. No commits,
workflow lifecycle changes, live credentials, provider operations or Runtime work.

## Actual APIs and durable records

`OwnerDeliveryWorker(db, instanceId, provider: GitHubFinalization).pump()` discovers
due active/waiting/reconciling batches and cancelled batches with original uncertain
merge work. It requires real Owner proposal, confirmation, consumption, receipt,
immutable complete membership and the Task acceptance pointer through the backend
helper. It waits for production preparation's exact published proof and existing
original PR, rather than creating branches, pushing or creating PRs itself.

`retryAcceptedMerge(tx, batch)` runs only under the genuine authenticated Owner
Retry hook, after Task and stable item locks. It requires a terminal rejected result
with its exact result digest and matching append-only original merge observation.
It preserves PR/head/method/request content, allocating a new operation ID only for
that established rejection. Unknown effects retain the original operation.

`readAcceptedReadiness(checkpoint)` validates the whole durable checkpoint and
recomputes readiness from actual page ages for the read projection. A persisted
passing label is never current authority. The backend projection consumes this
function; the module cycle contains function definitions only, with no initial
cross-module invocation.

Checkpoint: `{schema_version:1, claim?, stage?}`. Claim includes original ID,
backend instance and bounded expiry. Stage includes item, phase, last decision,
scoped digest, exact rich PR, protection, head/test collection pages and optional
immutable literal ancestry proof. The scope digest binds batch/content/item/member,
current public App/install/key configuration fingerprint, head/base/test/PR and
complete policy digest. Every persisted page is validated for exact repository,
head, kind, position, cardinality, stable total, producer, unique provider ID,
state, timestamp and bound. Complete sets reuse the adapter's validator. Pages are
100 rows, at most 10 pages per collection; private complete checkpoint bound is
8 MiB to accommodate all four bounded collections without clipping. Public read
bounds remain owned by the backend read contract.

The merge request is immutable:
`{schema_version, operation_id, batch_id, content_digest, item_id, task_id,
repository_digest, scope_fingerprint, intent, review, head, target_branch,
merge_method}`. It contains no token or encrypted App key. The SQL owner enforces
exact batch/member/head/original PR/method attribution. Shared item triggers fence
preparation/close against pending/started/unknown merge ownership.

## Call and uncertainty boundaries

Staging uses eight calls including grant and PR brackets: readiness grant, PR before,
classic policy plus complete rules, up to three collection pages (or a literal
ancestry read), PR after. Missing protection may stage an explicit unprotected
branch observation; a bare 404 never supplies absence. Durable progress spans turns.
Actual retained-page times must be within 15 seconds at effect admission. Missing,
expired or partial sets refresh rather than authorizing merge. Required pending
checks use the normal 15-second schedule; incomplete staging uses a short next turn.

Protected effect turn is exactly eight calls: readiness grant, PR before, protection,
rules, merge grant, settings, PR after, PUT. Current immutable authority, physical
writers, configuration, shared owner and claim are checked after credential I/O.
Concrete method and possible effect are committed before the single PUT. A lost,
invalid or unknown response retains the original effect and only reads the original
PR after restart. An open/closed/missing PR cannot authorize a second PUT.

After an admitted effect, valid original response settlement retains immutable
history even if current App/source configuration drifts. This exception permits no
new grant/read/mutation: all such admission still checks current configuration.
Cancel never revives the Task or undoes a merge. Original late success updates exact
item cleanup to `externally_merged`, appends finality and keeps Task/batch cancelled.

## Verification actually executed

Commands used a private `DATABASE_URL` loaded in Python from the local PG locator;
its value was never printed. `MONOS_TEST_DATABASE=1` enables real PostgreSQL. Each
fixture creates and finally drops its own schema. Provider/Git bytes are explicitly
synthetic test boundaries; real Owner commands, transactions, SQL constraints and
worker persistence are exercised. No actual remote or physical-process claim follows.

1. `pnpm exec vitest run apps/server/test/postgres-owner-delivery-worker.test.ts`
   passed all six real PG cases at 15:12:35, duration 4.88 seconds:
   - 210 required check records staged inside eight-call turns; later unresolved
     batch-attributed Owner chat does not block exact final delivery.
   - Withheld merge success, restarted worker and a subsequent open-PR observation
     retain the same unknown effect with one PUT; actual Owner Cancel blocks close;
     late exact merged truth finalizes history without Task revival.
   - Definitive 409 does not automatically retry; genuine Owner Retry preserves
     every original request field except new operation ID, including selected method.
   - Held merge grant followed by actual Owner Cancel produces no PUT or merge row.
   - Truncated persisted collection cannot grant readiness.
   - Actual Owner changes App installation configuration after admitted PUT but
     before successful response; exact original finality survives the drift.
2. Two existing cases gained distinct assertions. A second worker while the first
   holds its merge grant observes the durable claim and performs no extra provider
   call; this focused case passed at 15:13:27. Valid expired ISO page timestamps
   cause an actual refetch before any effect, then truncated total still rejects;
   that focused case passed at 15:13:45. The initial stale-page fixture used PostgreSQL
   text date formatting and was correctly rejected as invalid, then fixed to ISO.
3. Retry provenance was strengthened to require the immutable original rejection
   observation. Its affected genuine Owner Retry case passed at 15:16:11.
4. `pnpm exec eslint apps/server/src/owner-delivery-worker.ts
   apps/server/test/postgres-owner-delivery-worker.test.ts --max-warnings 0`: PASS.
5. Focused TypeScript compile with `--ignoreConfig --noEmit --target ES2023
   --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess
   --verbatimModuleSyntax --erasableSyntaxOnly --allowImportingTsExtensions
   --skipLibCheck --types node` on the two owned executable files: PASS.

Initial runs found backend SQL defects before PUT: PL/pgSQL alias collision, nullable
Git `repository_free` comparison and text/bigint PR-number comparison. The backend
owner repaired these; no constraint was bypassed or synthetic acceptance setter added.
Valid current evidence is six-case execution plus affected focused checks, rather
than a claim of another full run after every narrow assertion or bound edit. The
last checkpoint byte bound expands from 1 MiB to 8 MiB only; existing page/counter/
expiry/authority and effect behavior are unchanged. Root reconciles later input
changes and runs any missing integration gate once after writers settle.

## Final input hashes

| Path | SHA-256 |
| --- | --- |
| owner-delivery-worker.ts | 2b8a7ae5aef5554fefb63e257456a3481b9acae94e65f71a6269896fd8d2047c |
| postgres-owner-delivery-worker.test.ts | 4fd9087b58aa259742d5a362b4bbad63af1519a5f61aa10d1b8eef3e1167bd5a |
| github-finalization.ts (reused) | 95cc97a7be85238864cec3b28847a31a332964f4f15276599a97ea064b805938 |
| github-remote.ts (reused) | cfdf0ac01279a93b86f3c56ac1feb70121814bb19dc69d3febba0a0ef80c42f3 |
| github-finalization.test.ts (reused) | 0c498a585330a0f9237b26d8250f36a1a38437f25202fbc933c838886ede6d08 |

## Remaining integration responsibilities

Root owns current app/main pump wiring, physical/source guards, accepted preparation
and Cancel/Retry composition, final combined SQL/code review and source hash closure.
Root's subsequent failed-preparation Retry repair does not invalidate worker evidence
whose preparation already succeeded. Backend owns immutable terminal merge-result
hardening and final projection/schema integration. Current source mocks plus actual
PG do not prove live installed App issuance, real Linux credential/absence behavior,
remote effects or TCP packet loss. One controlled current-adapter synthetic live merge
may be performed by root at that distinct boundary; the installed App gate remains
explicit. No method permutation or repeated native/unchanged adapter suite is needed.
