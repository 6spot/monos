# Focused upgrade regression

Two concrete stale migration assertions expected23 and24 while canonical `migrate()` now applies25. Updated only `postgres-publication.test.ts` and `postgres-owner-delivery.test.ts`; production migrations/code unchanged. The21→25 case now starts with a real initialized Task/immutable Specification, captures prior1–21 checksums, migrates twice and compares all retained Task/revision rows. The23→25 case retains its atomic refusal branch for legacy nonnull accepted seams and unchanged pre-migration history.

Actual command on private isolated PostgreSQL17.10:

```sh
pnpm exec vitest run apps/server/test/postgres-publication.test.ts apps/server/test/postgres-owner-delivery.test.ts -t 'upgrades populated version21|upgrades exact version23 to version25'
```

`MONOS_TEST_DATABASE=1`, URL supplied privately in subprocess environment. Result **2PASS,20skipped**,1.40seconds, start17:00:48. Each case drops only its own unique test schema. This proves its upgrade assertions, not the installed production database upgrade. Affected2-file ESLint with `--max-warnings 0`:PASS; `git diff --check`:PASS. No production service/schema/provider/Agent action; no unrelated suite repeated.
