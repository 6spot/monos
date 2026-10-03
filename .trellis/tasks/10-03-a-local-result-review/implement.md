# Implementation checklist

1. Read curated contexts, PRD/design/research and inspect exact existing code before edits; preserve architecture boundaries and state the actual changed file set.
2. Add generated strict identity/read query/response/frame schemas, optional Ready capability and shared malformed/size/path fixtures; regenerate all consumers, never hand-edit generated code.
3. Extract/reuse exact selected completion projection and content identity; implement bounded connection-scoped broker and Owner routes with before/after auth/result validation and no transaction across I/O.
4. Implement Runner capability/frame routing and separate bounded read handling; validate retained operation/start/effect/storage/export chain and build cancellable raw-byte immutable Git reader. No new local export or mutable worktree read.
5. Add on-demand result inspector/API validation in the existing Task results location; cover selection/continuation/base/result/diff, literal safe rendering, immutable identity and session cleanup.
6. Add meaningful schema, real Git/Runner, WSS/real PostgreSQL and focused browser regressions for the behaviors in design. Use actual data beyond one page and actual changed worktree/ref/storage failures; include original completion recovered through settlement. Do not infer physical object reads from synthetic browser OIDs.
7. Run lint/typecheck/protocol drift/default test/build and Go race/vet. Run affected PG and browser checks; preserve failures and broaden only for remaining concrete risks or required shared-contract gates.
8. Capture desktop 1440x1000/mobile390x844 populated, empty/no-changes, loading, offline/error/retry, historical, binary/oversized and long path/code states as applicable. Retain source/build/route/fixture metadata and inspect screenshots against frontend visual spec. Explain nonapplicable states.
9. Write research/implementation-verification.md with changed files, exact executed checks, outcomes/limits and screenshot manifest. Main dispatches independent check, updates executable specs, commits/archive/journal and moves to next leaf.

## Validation commands/environment

- Root: pnpm lint; pnpm typecheck; pnpm protocol:check; pnpm test; pnpm build.
- Runner: prepend /Users/me/.local/share/mise/installs/go/1.27.1/bin then go test -race ./... and go vet ./... from runner; compile all generated consumers.
- Isolated PG: read /tmp/monos-local-review-pg-path, then its database-url into MONOS_TEST_DATABASE_URL and MONOS_TEST_WEB_DATABASE_URL in child environment without printing. Set MONOS_TEST_DATABASE=1 for affected suites; tests create/drop only their own schemas. Existing package test:db must register new real-PG suite.
- Browser: pnpm --filter @monos/web test:e2e with affected new tests; broaden existing tests only if shared shell/API fixture contract changes need it. Use SIGTERM graceful shutdown and verify own schemas cleaned.

No native host transport, provider write, Runtime/model invocation, deployment or source push belongs to this leaf. Do not modify global tool settings, unrelated task artifacts or another agent's edits. Report substantive contract/scope discoveries to main before widening implementation.
