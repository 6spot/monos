# PostgreSQL and Atomic Commands

Sources: [formal data](../../../docs/06-state-and-formal-data.md), [commands](../../../docs/05-tool-protocol.md), [stack](../../../docs/11-technology-and-deployment.md).

## 1. Scope / Trigger

Commands, claims, migrations, completion and delivery persistence. PostgreSQL is canonical; Runner SQLite is effect bookkeeping. Use Drizzle with reviewed SQL for explicit transaction/locking behavior.

## 2. Signatures

Probe records in [migrations](../../../packages/db/migrations/0001_boundary_probe.sql) include `runners`, `tasks`, immutable specification/plan rows, `nodes`, `attempts`, `command_receipts`, `operations`, `outbox`, `runtime_events` and `task_events`. API contracts are not ORM rows. Task-scoped Owner confirmation records are implemented in migration 4; migration 5 adds [immutable Task execution records](task-records.md); domain execution and delivery records remain separate work.

`BoundaryService.admit(token, submission)` and `finishOperation(runnerId, incarnation, result)` use `transaction(db, action)`. `inventory(runnerId, after?, snapshotId?)` reads a consistent page while holding the Runner lock. All inventory-changing writers, including local operation retry, must take that lock first.

Required uniqueness: scoped request IDs; one Task/source proposal; successful `(node_id, activation)` completion; Task event sequence and Plan revision; active owner claim.

## 3. Contracts

Current admission order:

```text
BEGIN
  authenticate credential
  lock Runner capacity -> Task control -> Attempt
  check authenticated scope
  find receipt by principal + scope + request_id
  return recorded result if command/digest match
  validate expected basis and exact authorization
  lock relevant operation before settlement
  write state/operation + event/receipt/outbox
COMMIT
run admitted external effects outside the transaction
```

Check prior receipts before stale-version checks for new effects. Owner claim and Runner capacity are claimed together. Event sequence and control version differ; proposal bookkeeping must not stale its own proposal.

Migration 2 binds `runners.connection_instance` to the backend process: a fresh persisted heartbeat does not authorize effects after backend restart until reconnect/reconciliation. Migration 3 records `operations.failure_kind`; typed capture failures retain the original operation and reservation while blocking the Node. Subsequent transient failures must not erase that blocking attribution. Successful repaired capture still checks the current activation and Task state before completion.

Select only dispatchable outbox rows **before** the batch `LIMIT`. Recovery rows remain durable but cannot consume the batch forever and starve runnable work. `process_released` changes only after verified whole-tree absence and all earlier workspace operations settle, not merely on exit or `process_absent` events.

Acceptance and message admission share a Task control lock; retain input cutoff and later-message attribution. See [delivery](delivery-contracts.md).

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Same key/command/digest | Existing result/operation |
| Same key, changed command/payload | Conflict, no effect |
| New effect, stale basis | Version conflict; no automatic version substitution |
| Failed transaction | No orphan consumed authorization |
| Lost worker wakeup | Durable unfinished work resumes |
| Expired lease, possibly live writer | Reconcile; no blind takeover |
| Previous backend heartbeat still fresh | New effects denied until this backend owns the reconnected channel |
| Typed capture failure followed by transient failure | Retain original blocking attribution and physical claim |
| Inventory changes between pages | Reject stale snapshot; restart complete scan |

## 5. Good / Base / Bad Cases

Good: two dispatchers contend for one slot; one claims it.
Base: replay returns the original receipt.
Bad: commit state then enqueue only in memory; crash strands work.

## 6. Tests Required

Use real PostgreSQL for locking/constraints. Race independent workers and inject a crash between commit and wakeup; assert one transition/event/admission. Test message/acceptance both ways and receipt replay after terminalization.

[postgres.test.ts](../../../apps/server/test/postgres.test.ts) covers the probe's concurrent receipt/capacity races, outbox starvation, restart fencing, recovery reads, Unicode/operation pagination and original-operation capture repair. Run `pnpm test:db` against an isolated real PostgreSQL database; this does not substitute for the full multi-worker or delivery matrix.

Reviewed schema initialization runs under one migration lock before current server
startup. Verify fresh initialization and current constraints. Under the
[pre-use development policy](../../../docs/12-product-naming-and-upgrades.md), old
development database upgrades, historical operation-version compatibility and
cross-version rollback are not required gates. Current-run receipt replay and
crash recovery remain required; migration work is scoped after actual use begins.

Independent claim tests live in `apps/server/test/postgres-claims.test.ts`, with a
test-only IPC child under `test/fixtures`. Different Node processes must report
distinct PostgreSQL backend PIDs. Hold the Runner rows, observe every claimant
waiting on a database lock, then release; a timing delay alone is not contention
evidence. Verify the same-owner unique index across different Runner rows too.
SIGKILL before commit must roll back writes and free locks; after commit it must
retain one unresolved owner and durable Start. Revocation or old heartbeat age
never releases capacity without validated Stop settlement. Kill/wait for child
processes before dropping each isolated test schema; never use canonical data.

`postgres-recovery.test.ts` uses the admission constructor hooks in a separate
process to SIGKILL immediately before/after COMMIT. Before commit, authority,
control version, receipt, event, operation and outbox must all roll back. After
commit, scoped recovery and duplicate replay retain their original identities and
single event. Validate the complete command before interpreting a worker exit as
the injected crash; require SIGKILL rather than treating any exit as success.
Fake workspace/Stop results establish database settlement guards only; they do not
prove physical writer absence or provider exactly-once behavior.

## 7. Wrong vs Correct

Wrong: await Git inside a DB transaction.
Correct: admit, commit, execute/reconcile externally, then commit the guarded result.
