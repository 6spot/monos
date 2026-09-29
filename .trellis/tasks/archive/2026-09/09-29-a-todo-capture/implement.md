# Execution plan

1. After Runtime parent acceptance, activate this leaf. Review architecture modules 01/05/06/07/08 and applicable backend/frontend/protocol specs; no additional authorization is needed under the Owner's standing instruction.
2. Add Todo schemas/generated types/shared fixtures and additive storage migration. Implement authenticated Todo command, read and receipt routes with production transaction conventions.
3. Add real PostgreSQL/API regressions and register DB test entrypoint. Prove capture creates no messages/Attempts/Tasks/outbox and preserves exact text.
4. Implement the Todos workspace using existing components/query/API patterns; add browser tests for capture/organization/drafts/uncertain commands/mobile and preserve settings tests.
5. Run protocol check, lint, typecheck, unit/build, real DB and affected browser suites. Run Linux Go checks after generated wire changes. No live model or new standing service is needed for capture.
6. Review full diff, update specs and verification, commit and archive; continue ordered Todo Discussion.

Expected owning files: `packages/db/migrations/0013_todos.sql`, `packages/protocol/schemas/v1/contracts.json` and generated outputs/fixtures, `apps/server/src/todos.ts` plus route wiring and Todo tests, `apps/web/src/features/todos.tsx` plus scoped command/read helpers if needed, app navigation/styles and browser tests, test entrypoint, task/spec records. Keep unrelated runtime/delivery code unchanged unless a concrete shared-contract issue requires a minimal fix.

Checks: `pnpm protocol:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:db`, `pnpm --filter @monos/web test:e2e`, Linux `go test -race ./...` / `go vet ./...`, `git diff --check`. Use an existing isolated test database or bounded port forward; do not reset production schemas or journal data.
