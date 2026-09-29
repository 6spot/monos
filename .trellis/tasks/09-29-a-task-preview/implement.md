# Implementation plan

1. Finalize backend/frontend source research and review PRD/design. Existing Owner
   authorization covers this leaf's planning, implementation, tests and deployment.
2. Curate backend/protocol/frontend manifests and start this task. Backend owns
   migration 15, strict shared schemas/generated fixtures, exact authorization,
   creation/cancel/read service, Task metadata/read additions and actual DB tests.
   Publish final type/field names to the UI owner before parallel integration.
3. Frontend owns proposal display/controller/API, Project choice, recovery, minimal
   Task read-only route, supporting styles and browser/API tests. No Start or board.
   All workers preserve others' edits. No new permanent service or dependencies.
4. Root owns integration, live acceptance harness/evidence, spec updates and roadmap
   bookkeeping. Review source-to-Task identity and confirmation consumption across
   schema, DB, UI and immutable receipt boundaries with independent check agent.
5. Run protocol drift, lint, types, unit tests/build, full same-host PostgreSQL,
   affected/full browser checks and shared Go fixture validation. Review the entire
   change scope after chunk-level checks; fix concrete findings and recheck.
6. Stage final files (preserve host Compose/private configuration), build, deploy
   existing server and verify migration/Runner continuity. Real native proposal →
   exact Owner confirmation → duplicate-safe Task creation must produce no Start.
7. Record tests/source evidence and scope limits. Commit work, archive and journal.
   Continue Capture and Discussion integration acceptance automatically.

Likely changes: packages/protocol schema/generator/fixtures, packages/db migration
and register, apps/server task-previews/Task primitives/reads/routes and tests,
apps/web Discussion preview/API/controller/app route/Task detail/styles/tests,
root test registration, task/spec and infra/probe acceptance files. Refactor only
where required to keep an existing stable contract reusable; test old Task paths.

Commands: `pnpm protocol:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:db`, `pnpm --filter @monos/web test:e2e`, Go protocol/shared
fixture tests (full race/vet if Runner behavior changes), `git diff --check`.
