# Independent migration test repair review

Active task: `.trellis/tasks/10-03-a-delivery-acceptance`.

Reviewer: `/root/review_final_check`, 2026-10-07. **READY** for root's scoped integration/commit and candidate refreeze. No actionable finding remains in the two assigned test diffs. This is test-repair acceptance, not an installed upgrade claim.

## Findings (fixed)

- File: `apps/server/test/postgres-publication.test.ts`. Root corrected the stale final version23 assertion to25 and strengthened the existing case with a genuinely populated version21 schema. The actual production `initializeTask` inserts a Task and immutable Specification before upgrade. The case captures every prior migration row/checksum and complete retained Task/Specification rows, invokes canonical `migrate()` twice, compares retained rows and checks no delivery operation was invented.
- File: `apps/server/test/postgres-owner-delivery.test.ts`. Root corrected the happy version23 upgrade expectation from24 to25. The existing legacy nonnull accepted-operation branch is preserved: actual migration rejects with23514, new delivery tables remain absent, prior migration rows remain unchanged and the old acceptance seam is not cleared to manufacture success.

No production or test source was edited by this reviewer; only this report is written.

## Findings (not fixed)

No issue found. The version21 fixture is one initialized Task/Specification, not a copy of the installed32-Task/88-Attempt database. The later actual install observer must still compare old receipts, operations, Git/storage and physical ownership. There is no reason to repeat historical product/provider suites for this assertion repair.

## Verification

- Initial assigned state: both test files modified and `research/migration-test-verification.md` untracked. Inspected only their scoped diff, affected case context, evidence report and relevant unchanged migration/Task-initialization callees; preserved all concurrent edits.
- Canonical migrator inspection: all25 ordered migrations are under one transaction/advisory lock; existing contiguous migration rows/checksums must match source. Thus calling it twice checks the actual production no-op migration path, and the legacy rejection rolls back the attempted24/25 transaction. Relevant migrator, migration files and Task initializer have no working diff; migration25 hash remains the accepted hash below.
- Reused root's private isolated PostgreSQL17.10 result at17:00:48: `pnpm exec vitest run apps/server/test/postgres-publication.test.ts apps/server/test/postgres-owner-delivery.test.ts -t 'upgrades populated version21|upgrades exact version23 to version25'`, with privately supplied URL and `MONOS_TEST_DATABASE=1`: **2 PASS,20 skipped,1.40 seconds**. Unique test schema cleanup is retained in both cases. No rerun performed.
- Reused root's affected two-file ESLint result with `--max-warnings 0`: PASS. Independently ran `git diff --check -- apps/server/test/postgres-publication.test.ts apps/server/test/postgres-owner-delivery.test.ts`: PASS.
- No host/provider/Agent action, production change, test invocation, commit or workflow dispatch performed. Full suites skipped because the modified expectations and populated upgrade assertion have current focused real-PG evidence; unchanged production inputs retain prior evidence.

## Reviewed SHA256

| Input | SHA256 |
| --- | --- |
| `apps/server/test/postgres-publication.test.ts` | `f82820f90f38506069e1872dcadc43ed677ea8ad229651f0fe1ce3c459b80ac6` |
| `apps/server/test/postgres-owner-delivery.test.ts` | `c9c61e219f5d83fc37ccf9d52d74250da068e19d70bd2672c0a855e5e9df1bf8` |
| `research/migration-test-verification.md` | `1127f982c9281106d6dc2ac41e88d08cdde48665580cec8f194531474738f1ab` |
| `packages/db/migrations/0025_review_correction.sql` | `b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18` |
