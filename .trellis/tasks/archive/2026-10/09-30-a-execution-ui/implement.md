# Execution UI implementation plan

## Ordered gates

- [x] Read architecture/invariants and frontend specs; inspect existing endpoints,
  immutable request hooks, browser fixture and Multica reference.
- [x] Resolve shared-file ownership by creating a separate existing-screen migration
  backlog leaf and linking it before integration acceptance.
- [x] Complete backend read/control contract research and reconcile design details.
- [x] Curate implement/check contexts, validate artifacts and activate under the
  Owner's standing sequential-execution authorization.
- [x] Backend implementer: bounded Board/current-result/diagnostic projections and
  nonsecret session identity, schema generation and focused real PostgreSQL tests.
- [x] Web implementer: shared neutral shell/primitives, Task family adapters/scoped
  reload recovery, Board and Task surfaces, applicable exact controls and cursor UI.
- [x] Browser implementer: isolated fixture scenarios and functional/visual tests;
  coordinate with Web DOM/accessibility contracts, no production seed routes.
- [x] Run affected lint/type/unit/protocol/build and real DB/browser gates; fix issues.
- [x] Independent full-scope check reviews all owners and every acceptance criterion;
  fix findings and rerun only affected checks.
- [x] Inspect desktop/mobile screenshots and record source/build identity, reference
  comparison, state matrix and limitations in verification.md.
- [x] Update executable specs for final read/session/Task recovery/UI contracts.
- [x] Commit feature, archive leaf with links fixed, record journal, advance to the
  separately scoped existing-screen migration before integration acceptance.

## Ownership

Backend worker owns `apps/server/src` additions/modifications, protocol schema and
generated consumers/OpenAPI, backend tests (except browser fixture). The same implement-role worker proceeds from backend into Web feature files and
`task-ui.css`. Root implements shared Web shell/primitives/API/session storage and
frontend boundary unit tests; thread capacity prevented a separate Web implementer.
Root owns `apps/web/test` and `apps/server/test/fixtures/web-server.ts` plus
new browser scenario helper; no overlap with backend integration tests. Root also owns
task artifacts/spec updates, review coordination, full gates and actual image review.
Workers do not deploy, start permanent services, commit or spawn additional workers.
Each loads its manifests and writes direct implementation notes under research/.

## Commands and environment

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm protocol:check`, `pnpm build`.
For database tests set `MONOS_TEST_DATABASE=1` and `DATABASE_URL` privately; use an
existing local/test database or existing host tunnel, never modify native Tasks.
Browser: `MONOS_TEST_WEB_DATABASE_URL` privately →
`pnpm --filter @monos/web test:e2e`. Build first. The fixture starts only a temporary
loopback test process and drops its own unique schema on SIGTERM; verify cleanup.
Generate protocol from canonical schema and compile affected generated Go consumers.
Do not rerun accepted native Replan/service restart trials for this UI change.

## Required review matrix

- Board state/filter/paging/attention and legacy rows without invented authority.
- Every implemented Owner exit including exact issue/blocker answers, completion
  recovery, input deferral, linked requirement/Replan independent exits and Cancel.
- Full proposal content/impact/current basis and joint dual confirmation recovery.
- Refresh/lost response/unknown/malformed receipt/two-client race plus session switch.
- Per-Task/action draft isolation, no payload rebasing, persistence quota/corruption.
- Current versus historical result/evidence; local REVIEW and terminal chat semantics.
- Paginated messages/events/Artifacts/executions; log cursor retained with entries.
- Desktop/mobile populated/empty/queued/disabled/error/long content, menu/focus/back.
- Shared shell regression for existing Todo/settings commands/drafts without falsely
  claiming their deferred interior migration is complete.
