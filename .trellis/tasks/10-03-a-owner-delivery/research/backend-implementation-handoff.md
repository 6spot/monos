# Backend Owner delivery implementation handoff

Date: 2026-10-05, Asia/Singapore. Active task: `10-03-a-owner-delivery`.
This report covers only the backend worker's assigned files. Main owns integrated
app/control/preparation/guards and provider worker owns accepted delivery execution.
No commits, lifecycle changes, host actions or live provider effects were performed.

## Implemented contracts

- Migration 24 adds actual dedicated prepare, confirmation and admission receipts,
  immutable batch/membership/preparation links, durable merge operations and
  append-only observations/finality. Deferred SQL authority validates the real
  command envelopes/results, consumed authorization, complete output membership,
  original completion/artifact attribution and retained preparation evidence.
  Missing JSON conditions use `IS NOT TRUE`. Task pointers and input attribution
  reference a batch of the same Task and exact cutoff. Legacy nonnull seam values
  abort before installing any new table or migration version.
- `OwnerDeliveryCommands` implements prepare, dedicated confirm, Accept, Retry and
  Cancel. Original request receipt recovery precedes currentness/discovery. Accept
  atomically consumes actual confirmation, creates exact remote item/membership,
  installs the Task pointer/cutoff and receipt, then invokes the rollbackable root
  admission hook. Modified delivery without its coordinator cannot be admitted.
  Cancellation locks discovered Runner rows in sorted order before the Task and
  revalidates discovery. Retry/Cancel use frozen batch digest/version, independently
  of later conversation control.
- `buildDeliveryAcceptance` enumerates every effective output and selected artifact,
  retaining original completion/source alongside current effective Spec/Plan basis.
  Modified Git binds actual current complete scan, explicit workflow fact, retained
  permission observation/configuration fingerprint, exact eligible waiver receipts,
  candidate/mapping and original provider identity. Known public exposure blocks
  admission. No-change and repository-free are honest local completion paths.
- Manifest assembly rejects above 480 KiB to reserve response wrapper space;
  generated 512 KiB validation remains the final public response boundary. Nothing
  is clipped or partially accepted. Stage A admits at most one modified repository.
- Reads derive progress from retained preparation/merge/finality rows and actual
  head-bound provider readiness checkpoint. `readAcceptedReadiness` validates and
  recomputes current page age; persisted passing labels alone grant no readiness.
  The original frozen manifest is preserved. Configuration drift/public exposure
  produces attention rather than stale passing checks.
- Formal `delivery_accepted` precedes local-only `delivery_completed`. Actual
  REVIEW-to-COMPLETED wins emit completion once; replay does not duplicate it.
  Cancelled Task/batch cannot be revived by late finality.
- Proposal/batch history uses independent 64-row exact microsecond keyset pages.
  Cursor is canonical base64url of `{v:1,task_id,kind,created_at,id}`, with UTC
  `YYYY-MM-DDTHH:mm:ss.ffffffZ`, Task/kind and canonical byte checks. Current
  acceptance authority and accepted pointer remain independent of older pages.

## Exported integration seams

`owner-delivery-state.ts` exports `DeliveryBatchRecord`,
`DeliveryBatchItemRecord`, `deliveryBatch`, `assertDeliveryBatchAuthority`,
`acceptedDeliveryItem`, `buildDeliveryAcceptance`, `deliveryBatchRecord`,
`completeLocalDelivery`, and `completeAcceptedBatch`.

`OwnerDeliveryHooks` provides `admitAcceptedPreparation(tx,batch,repositories)`,
`retryAcceptedDelivery(tx,batch,requestId)`, and
`cancelAcceptedDelivery(tx,batch,requestId)`. Root hooks do not write the Cancel
batch version; commands write it once. The admission hook sees the actual receipt,
Task pointer and immutable members inside the same rollbackable transaction.

`OwnerDeliveryReads.task(token,taskId,input={})` consumes the generated
`OwnerDeliveryHistoryQuery`; proposal and batch detail are Task scoped.

`ownerDeliveryFixture(mode,hooks,options={runnerCredential?})` supplies genuine
Owner prepare/confirm/Accept commands to main/provider tests. Provider permission
bytes and Git/scanner data are synthetic test boundaries; authoritative receipts,
canonical completion, configuration, scan ingestion and admission use actual code
and real isolated PostgreSQL. No remote projection or approval row is seeded.

## Verification and observed failures

Private PG locator was read into child environment only: `DATABASE_URL`,
`MONOS_TEST_DATABASE_URL`, and **`MONOS_TEST_DATABASE=1`**. URLs/credentials were
not printed. Test-owned namespaces are isolated and cleaned by their fixtures.

1. `pnpm exec vitest run apps/server/test/postgres-owner-delivery.test.ts` at
   15:14:56: six PASS; seventh history case failed only because the assertion
   expected internal `CommandError`, while malformed padding correctly failed the
   strict query schema as `ProtocolValidationError`. Actual history pagination and
   cross-Task denial assertions passed before that final assertion.
2. After correcting that boundary assertion and adding terminal merge outcome
   preservation, focused command with `-t 'pages actual proposal history|upgrades
   exact version23'` at 15:20:31: two PASS, five intentionally unselected, 1.95 s.
   This validates current migration startup, exact retained versions 1–23,
   atomic legacy refusal and current 65-proposal paging without repeating unaffected
   command/process cases. Together with retained six-case execution, all seven
   distinct owned behaviors have passing evidence.
3. Actual independent Node processes exercise both Task lock race orders. Parent
   queries `pg_blocking_pids` to observe real contention before releasing holder:
   message-first remains ordinary input and Accept fails without consuming approval;
   Accept-first binds the subsequent message to that batch while modified Task
   remains REVIEW. No fixture time, lock result or authority is manufactured.
4. A separate actual Node process receives private credentials through stdin and
   is SIGKILLed immediately before or after actual COMMIT. Before COMMIT rolls back
   receipt, approval consumption and pointer; after COMMIT recovers the exact
   original committed receipt and one batch. These children also import the actual
   erasable-TypeScript backend, including the state/worker function import cycle.
5. SQL negatives cover direct unbacked pointer, missing JSON receipt, duplicated
   approval, proposal mutation and partial admission chain. Repository-free and
   true no-change complete with zero grant calls; unsupported modified mode does
   not consume confirmation or create a batch.
6. Seven owned executable paths scoped ESLint: PASS at 15:20. Final current TypeScript
   `pnpm exec tsc --noEmit`, owned scoped ESLint and `git diff --check`: PASS at
   15:29 after the review fixes and test/fixture deltas.

Raw intermediate defects were resolved at their actual boundaries: extra SQL
parenthesis, PL/pgSQL artifact alias collision, nullable Git repository_free
comparison (canonical value is `COALESCE(...,false)`), and JSON text/bigint PR number
comparison (explicit bigint-to-text). These occurred before provider PUT. No
constraint was weakened or false confirmation inserted to advance a fixture.

The final migration additionally preserves terminal failed/succeeded/cancelled
merge status/result/result_digest/reason. Unknown-to-success reconciliation and
claim/checkpoint cleanup remain allowed. Provider worker/main should attach the
narrow actual terminal UPDATE rejection assertion to an existing merge case; it
is the only newly added SQL behavior awaiting that worker evidence at this handoff.

## Carry and evidence limits

Current canonical resolver only carries the same Node/activation across effective
Spec/Plan changes. `task-replan-state.ts` preserves activation for carry; only
invalidation increments it. Current and original evidence fields remain distinct,
but this leaf does not invent cross-activation completion applicability. Root owns
any future extension and genuine mapping integration evidence.

This worker proves actual DB/receipt/process recovery boundaries with synthetic
Git/provider inputs. It does not claim live installed App issuance, native Runner
absence, actual provider effects, packet loss or an end-to-end production deployment.
Protocol, provider, root prep/HTTP and Web evidence are separate reports and reused
only where their inputs remain unchanged. No unrelated Go/native/build/provider
suite was repeated.

## Independent review fixes and final deltas

The final review found two concrete completeness gaps in direct SQL authority:
completion `[A,B]` with selected artifacts `[A,A]`, and Git output with omitted
repository membership. Migration now requires distinct selected artifact IDs,
exact immutable public ArtifactMetadata (including original attribution,
references/timestamp/supersedes), and equality of distinct Git output resource IDs
with frozen repository IDs, rejecting missing or extra resources. Artifact
selection preserves the producer's existing same-Node/activation rule and each
artifact's actual original Attempt/Spec/Plan; it does not falsely relabel it as the
completion Attempt. The unique fixture can publish two real artifacts before the
actual canonical completion.

One additional existing shared GitOID mismatch was repaired: final_commit accepts
40 or 64 hex digits, consistent with schema/adapter; main owns the affected worker
64-digit persistence assertion.

Focused new actual PG tests deliberately construct untrusted shape-consistent SQL
receipt chains inside transactions. Duplicate IDs and altered title are rejected
at selected-evidence enforcement; omitted Git repository is rejected at repository
set enforcement. No fabricated approval is used in successful tests; the positive
case runs actual Owner confirmation/Accept and reads both exact artifacts back.
These two focused cases PASS at 15:28:40 (1.66 s; seven intentionally unselected).
The first resource-set trial failed with PL/pgSQL alias `r` colliding with the
response variable; alias changed to `repository_entry` and the two exact cases
were rerun successfully. Earlier PG claims remain scoped to unaffected behaviors.

Terminal merge immutability assertion and actual 64-digit finality persistence are
main-owned affected worker checks. This report does not substitute an unaffected
suite for those deltas. Main reconciles their results in final integration.

## Current input hashes

| Path | SHA-256 |
| --- | --- |
| `packages/db/migrations/0024_owner_delivery.sql` | `8a2e51f2a73c27a2623dcbf994359d2da039b7d2491f763a1d911e489e8723a8` |
| `packages/db/src/migrate.ts` | `0a42755b22f5e53d2c0747934b116d142499b7889bffa7fc3c8995ac30602d9c` |
| `apps/server/src/owner-delivery-state.ts` | `50b73008aac2c231f4c3b5cee665bee65c8fceeec6dd258023332224dea60bf5` |
| `apps/server/src/owner-delivery-commands.ts` | `1e94d523602bd79356b7cdcbef6527c1ac67e000a4ef6ed03700364a6fec4de3` |
| `apps/server/src/owner-delivery-reads.ts` | `95783de9f701088370e778e6f5bb6964a7960b34f37ec3edd9be5752f673cc3e` |
| `apps/server/test/postgres-owner-delivery.test.ts` | `8c8bd140c8e84dbe01c2303e7e7077bb777156dd7b15b4e9a7043750e67385e1` |
| `apps/server/test/fixtures/owner-delivery-fixture.ts` | `413fb535f9090d1232ef4e79cd8843374bb284c02f360d9659c3455dc4db9b20` |
| `apps/server/test/fixtures/owner-delivery-transaction-child.ts` | `86bf0378b7527dd5cbaff88644878b0b156de933e3c54a10c2d3e5454370e29a` |
| `apps/server/src/owner-delivery-worker.ts` | `a85b8e261c560710be744833f2238da60380b0732aba356b1beb6d8919edb6cd` |
| `packages/protocol/schemas/v1/contracts.json` | `2f17d24b9ba4391e78b6f4a09b4d5cf59713b256c0e9f10cdeca0ce41a51bcc9` |
