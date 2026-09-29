# Execution plan

1. Read source modules and scoped specs; record backend and Runner scope research.
   The Owner's standing sequential-work authorization includes this task and
   routine design, implementation, verification, deployment and commits.
2. Backend owner: add strict shared wire contracts/fixtures/generated outputs,
   migrations and generic Todo Attempt ownership. Publish exact schema names to
   Runner/UI workers before they integrate. Preserve legacy Task regression tests.
3. Backend owner: add durable Discussion input/outbox/context/commit/cache/recovery
   and authenticated bounded reads with real PostgreSQL tests. Register suites.
4. Runner owner: adapt optional scope/resource fields, local CLI commands, native
   protocol injection and reminder, scratch launch and regression tests. Do not
   loosen physical isolation or modify old journal envelopes.
5. UI owner: add scoped Discussion composer/status/history/recovery using generated
   contracts and existing UI/query patterns; browser cases with isolated fixtures.
6. Run protocol drift, lint/typecheck/unit/build, complete same-host PostgreSQL
   suite, browser suite, Linux Go race/vet and targeted Python harness regressions.
   Review atomicity, cutoff/context, command authority and physical release.
7. Run real Todo Planner acceptance on the existing test host with fresh native
   availability/tool/price preflight. Record precise source/binary evidence and
   cleanup of only owned trial records/processes. No new standing services.
8. Update specs and verification, commit coherent work, archive and journal. Then
   continue Exact Task preview and creation automatically.

Expected files: protocol schemas/generated/fixtures, DB migration registration,
server service/dispatch/scheduling/Discussion modules and tests, domain command
guards, Runner local/adapter/host/wire tests and CLI docs, web Todo Discussion
components/helpers/browser tests, task/spec records. Main coordinates file
ownership and final integration; workers must not revert others' edits.

Checks: `pnpm protocol:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:db`, `pnpm --filter @monos/web test:e2e`, Linux
`go test -race ./...` and `go vet ./...`, `git diff --check`.
