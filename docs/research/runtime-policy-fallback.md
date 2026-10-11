# Initial Runtime policy fallback

Date: 2026-10-11. The Owner deferred costly native acceptance and directed
development to continue with local verification. This is an untracked functional
slice of Stage B; it does not close Stage A or the full Runtime fallback package.

## Implemented behavior

The scheduler previously ignored saved `fallback_targets`. It now examines the
chosen policy's default and fallbacks in order, enqueuing the first compatible
available target. Explicit selection remains a single target. Exhausted
Planner/Role policies do not inherit the Global policy's targets.

Only confirmed incompatibility or current installation unavailability permits
the next candidate. Offline/missing Runners, stale reports and ambiguous Auto
placement retain their waiting/error result. Capacity waiting keeps the selected
target. Queue admission still enforces Task locality; a rejected admission rolls
back rather than attempting another Runner under the Task lock.

Candidate locks are acquired before selection: an Auto candidate requires the
Runner table lock; otherwise all compatible pins are locked in ID order. Skipped
targets create no Attempt. The existing selected-target record and request digest
preserve exact replay after policy edits.

See the [executable contract](../../.trellis/spec/backend/runtime-scheduling.md)
and [implementation](../../apps/server/src/runtime-scheduling.ts).

## Verification

Local isolated PostgreSQL 17 cluster; each fixture owns a separate schema. No
deployed service, Runtime model or remote provider was used.

- The new first-fallback regression failed against the original scheduler, which
  returned `unsupported_runtime` instead of choosing the configured fallback.
- `pnpm exec vitest run apps/server/test/postgres-runtime-scheduling.test.ts
  apps/server/test/postgres-dispatch.test.ts` with `MONOS_TEST_DATABASE=1` and the
  isolated `DATABASE_URL`: **23 passed**.
- `pnpm test`: **609 passed**, database suites skipped as designed.
- `pnpm test:db`: **365 passed, 2 timed out** at the existing five-second deadline.
  The two cases in `postgres-task-records.test.ts` and `postgres-publication.test.ts`
  both passed unchanged when rerun with `--maxWorkers=1` and
  `-t 'upgrades populated probe records|creates no delivery operation'`. This is
  combined evidence for 367 cases, not a claim that the aggregate run was green.
- `pnpm lint`, `pnpm typecheck`, `pnpm protocol:check`, `pnpm build`, scoped
  whitespace/link checks and independent read-only review passed. Existing
  Fastify deprecation and Vite bundle-size warnings remain.

## Remaining scope

The [Codex second CLI](codex-runtime-adapter.md) now has a separate implementation
and local verification record. Structured objective Runtime failure reports and
[post-launch fallback](runtime-post-launch-fallback.md) after physical Stop/workspace
settlement are now implemented with local verification. Current queued pre-start
loss still follows its existing cancellation and
Owner recovery path. [A06/A30 native acceptance](stage-a-acceptance.md) remains
deferred, not passed.
