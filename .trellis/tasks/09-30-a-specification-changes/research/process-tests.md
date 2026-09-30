# Independent Specification transaction/process tests

Owned files: `apps/server/test/postgres-task-specification-process.test.ts`, `apps/server/test/fixtures/task-specification-worker.ts`, and this report. No product edits, deployment, commit, service startup or push.

## Coverage

Uses existing `conversationFixture` in a fresh isolated PostgreSQL schema per test. Child processes inherit only the private test database URL through environment; no credential is printed. All children are stopped/joined before schema teardown.

1. Two different Owner sessions and OS processes confirm the same attached canonical proposal. Assert distinct PostgreSQL backend PIDs, observe both in `pg_stat_activity` with `wait_event_type='Lock'` and nonempty `pg_blocking_pids`, including one blocked by the holder's Task lock. Then release the holder and verify one authorization, both immutable receipts, and no change/publication.
2. Two different Owner sessions/processes apply the same exact confirmation. Repeat actual observed lock contention, then assert one change/publication/revision pointer, identical operation identity and immutable duplicate replay.
3–4. SIGKILL before/after the production Owner admission transaction COMMIT while a canonical Node is active. Before COMMIT the complete semantic snapshot is unchanged and receipt unknown. After COMMIT the original admitted receipt/change/Stop already exist before recovery replay. Assert exact consumed authorization, one publication slot, Stop ownership, revoked mutation with unreleased process, old effective requirements until Stop settlement, then one publication.
5–6. After the existing Stop result settles, SIGKILL before/after the production asynchronous publication pump COMMIT. The coherent snapshot proves atomic effective pointer, immutable child revision, applicability, obligation, events, slot release and retained receipt. Repeated pump is inert; a subsequent Node uses a fresh Attempt on the same activation with the new Specification.
7–8. Completed Node with explicit exact evidence carry-forward: SIGKILL before/after immediate Owner publication COMMIT. Assert publication/receipt/pointer/applicability atomicity, retained REVIEW and byte-equivalent original completion/manifest rows. Replay and pump cannot duplicate publication or relabel historical result provenance.

The child validates Owner wire input before invoking production services. Its only SIGKILL path is the selected synchronous production commit hook. Parent requires `signalCode === 'SIGKILL'`, null exitCode and no error/unexpected-survival messages; an arbitrary failure is never accepted as crash evidence. Poll delays only pace observation of actual PostgreSQL lock state.

## Verification

First six-case run: **6/6 passed**, 74.43 seconds, real PostgreSQL via the private URL file. Then added the two completed-evidence cases and expanded the atomic snapshot. First expanded eight-case run: **7 passed / 1 failed**, 107.28 seconds. The before-publication immediate carry worker exited without SIGKILL; the test correctly failed rather than claiming crash evidence. Backend reported a concurrent migration/code addition that can produce an old-fixture/new-code missing-column failure; this is a suspected cause, not yet established by the original output. Added sanitized child message codes to signal assertion diagnostics and started fresh-fixture targeted carry verification. Fresh-fixture targeted carry run: **2/2 passed**, 29.78 seconds. After the backend completed its final SQL authority checks, a stable fresh-fixture full run completed: **8/8 passed**, 107.65 seconds (start 22:35:36). This final run also snapshots immutable proposal envelopes and the new exact authorization-command linkage.

ESLint for both owned TypeScript files and root `pnpm exec tsc --noEmit` passed after the final test additions and again alongside the final eight-case run. Root registered the suite in `test:db`; this worker did not edit package.json.

## Limits

These are real database/OS-process transaction tests using canonical product admission and pump paths. `conversationFixture.finish` supplies a synthetic trusted Runner result; tests do not establish physical cgroup absence, actual private Git preservation or installed Agent tool behavior. Root's Linux/native gate remains required.
