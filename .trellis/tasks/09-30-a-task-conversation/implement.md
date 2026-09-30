# Task Conversation implementation plan

## Ordered work

1. [x] Converge PRD/design and backend/Runner research; curate both JSONL contexts,
   validate paths and activate this leaf under standing Owner authorization.
2. [x] Backend: additive migration, strict protocol types, ordered Task input/source
   and bounded reads; shared Planner arbitration, independent versioning and
   failure/Retry/Withdraw handling. Preserve immutable receipts and source cutoffs.
3. [x] Backend: scoped guidance/obligations/assignment, initial Plan binding, Node
   source injection, controlled Stop/follow-up, manifest handling and activation
   races. Preserve existing hard-completion recovery and Owner-stop precedence.
4. [x] Runner: source/CLI allowlist, strict transport/effect scope, immutable command
   recovery and finite reconnect cleanup. Build all consumers after generation.
5. [x] Test real PostgreSQL contention/crash/rollback/scope/lifecycle cases and
   shared protocol negative/positive fixtures; verify old suites remain correct.
6. [x] Independent full-scope review, resolve findings; synchronize owning specs.
7. [x] Freeze/build Linux source; run full relevant gates, install into existing
   services, prove native ordered replies, controlled guidance/workspace continuity,
   receipt/manifest binding and service restart with retained old history.
8. [x] Final independent acceptance, commit coherent work, archive and journal;
   automatically continue Exact Specification changes and settlement.

## Ownership and change boundary

- Backend implementer: `apps/server/**`, `packages/db/**`,
  `packages/domain/src/commands.ts`, `packages/protocol/**`, root DB test command.
  New Task conversation/guidance modules own semantics; only necessary hooks enter
  existing planning/Node/service/queue modules. Local helper extractions require
  existing behavior tests; no general controller refactor.
- Runner implementer: `runner/**` only; coordinate wire names with backend and
  never hand-edit generated files. New commands enforce exact source identity.
- Root: task/spec docs, `infra/probe/**`, full gates and host evidence/deployment.
- Reviewer: independent findings/report and agreed dedicated regression fixtures;
  coordinate fixes with owners to avoid simultaneous source edits.

All workers share a checkout; no one may revert unrelated edits. No new permanent
service, no remote push. Existing Node task is archived; do not modify its evidence.

## Validation commands

Run scoped tests during implementation, then once source is ready:

```sh
pnpm protocol:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
node --experimental-strip-types -e "import('./apps/server/src/app.ts')"
python3 -m unittest discover -s infra/probe -p 'test_*.py'
```

`pnpm test:db` must use the private forwarded PostgreSQL URL or the isolated Linux
test container; read credentials privately, never print them. Database tests create
unique temporary schemas. From `runner`, verify modules, `go test -race ./...`,
`go vet ./...` and all four production binaries on Linux. Regular local tests alone
cannot establish physical systemd/Git/native CLI behavior.

Run `git diff --check` and task JSONL/link checks. Preserve actual executed counts
and limitations in `verification.md`, not planned checks presented as successes.
Do not repeat expensive full suites without new changes or concrete concerns.

## Risk checkpoints

- Ordinary message/reply/failure must not stale Node execution; input append must
  not stale its own earlier active source.
- Shared Planner authority and Node workspace locality cannot deadlock or bypass
  physical process/operation ownership when a second capacity slot exists.
- Current execution read versus historical reply observation must not silently
  substitute newer facts into an already assessed action or an uncertain request.
- Completion/guidance ordering, Cancel, Stop and hard recovery retain exactly one
  disposition, immutable old manifests and independent pending obligations.
- Existing accepted source/binary/receipt snapshot and port18444 remain intact
  until a verified additive deployment. Preserve previous native failed trials.
- Exact requirements/replacement Plans, UI and provider delivery remain next leaves;
  do not route unsupported changes as if already effective.
