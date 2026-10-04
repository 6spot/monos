# Execution plan

## Change boundary before code

Smallest gap: local REVIEW currently exposes immutable Git results but has no controlled publication head, durable preparation or exact redacted scan/override records. Delivery owns new backend admission/history; Runner service owns local Git effects; Web owns presentation.

Expected files and necessity:

- `packages/protocol/schemas/v1/contracts.json` and generated TS/Go/embedded/OpenAPI outputs: shared strict identities, frames and Owner contracts; one writer/generator.
- `packages/db/migrations/0022_publication_candidates.sql`, migration registry and useful schema mappings: immutable canonical records and serialized durable outbox.
- `apps/server/src/publication-{candidates,candidate-reads,policy,commands}.ts` plus focused tests/fixtures: system admission, replay, exact reads and receipts. Integrate `service.ts`, `main.ts`, `app.ts`, `node-completion.ts` and canonical resolver in `task-result-reads.ts` only as needed.
- `runner/internal/host/publication_{candidate,scan,ignore}.go` and tests: trusted exact-tree construction and complete version scans; shared retained-export helper in `result_read.go` only if necessary, verified by existing read regressions.
- `runner/internal/daemon/publication.go`, control interfaces/client and focused tests: independent bounded durable system lane, negotiated support, reconnect/replay without Attempt scheduling. Infrastructure bootstrap only if directory creation cannot safely remain lazy.
- `apps/web/src/features/publication-candidate.tsx`, task overview/API integration and focused tests/browser fixtures: exact candidate and findings inspection/commands. No broad visual redesign.
- Task evidence and focused new executable spec/index links: main session owns acceptance, not delegates.

No remote publication/acceptance, new role/state/workflow framework, source push, filesystem substitution, quota workaround or changes to concurrent Trellis/hooks/AGENTS work. Local extraction of canonical source/trusted export helpers must preserve existing result-read behavior via unchanged contract and regression suites.

## Ordered implementation and ownership

1. Main converges PRD/design/contexts and activates under existing full authorization.
2. Backend/protocol implementer owns schema source/generated files, migration/backend code and backend tests. First freeze protocol/digest/page/routes contract in `research/frozen-contract.md`, generate and notify main. Do not edit Runner handwritten code or Web code.
3. Runner implementer starts after freeze, owns handwritten Runner code/tests only. Coordinate generated changes with protocol owner; never regenerate concurrently. Record actual Git/Go checks and recovery limits.
4. Frontend implementer starts after freeze, owns Web code and browser acceptance scripts/fixtures only. Built SPA browser waits until backend routes are stable. Use real PostgreSQL fixtures where applicable; retain exact code/assets/screenshots provenance.
5. Main integrates, verifies real DB two-worker/recovery and shared frame/digest producer-consumer coverage, resolves source changes, coordinates any necessary actual Linux scoped evidence. Independent reviewer is read-only; stop source writers before final review.
6. Main runs missing/invalidated gates, inspects final build screenshots, updates executable specs, explicit owned-file work commit, archive commit and journal commit; continue next ordered leaf. Never push.

All delegates load their role context and task artifacts, inspect dirty state, retain nonoverlapping ownership, preserve others' edits, and do not commit/archive/start tasks or spawn nested agents (depth cap 1, four active slots including main).

## Required evidence

- Protocol strict omitted/null/unknown/UTF-8 bounds and canonical cross-language digest tests; generated consumers compile.
- PostgreSQL actual contention on separate connections, one admitted operation, rollback and before/after-commit restart replay; current/carry/historical/cancel/config semantics and exact override idempotency/rejection.
- Actual Git candidate tree/parents/private exclusion, immutable CAS/recovery/permission-safe filesystem, streamed finite rules and historical deleted version/all-parent merge checks, tree-specific ignore and workflow deletion, every incomplete guard. Source/workspace/result ref unchanged.
- Zero network Git/write-token/Runtime start in local preparation; both remote preparation modes and no-change/repository-free behavior.
- Web API/session races, built SPA desktop/mobile current/historical/incomplete/findings pagination and confirmation; no matched value in responses/logs/UI/artifacts.
- `pnpm protocol:check`, affected lint/type/test/build, real affected PG gate; actual Go module/race/vet. Never infer Linux/provider/native claims from Darwin/fakes.

## Handoff reports

Each worker records owned paths, commands/results with input hashes and unmet risks in assigned task research. Main retains failures and corrections; page/evidence overflow remains blocking. Final acceptance requires integrated current inputs and independent review, not accumulated intermediate passes.
