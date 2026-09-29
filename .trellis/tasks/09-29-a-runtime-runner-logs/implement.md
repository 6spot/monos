# Implementation plan: Runner dispatch and execution logs

1. Recheck archived target-scheduling/boundary-probe evidence and map Dispatch, journal, output files, event admission and Owner reads. Record host/model prerequisites before live verification.
2. Define additive protocol fields and Owner log page/cursor contracts; regenerate TS/Go/OpenAPI and preserve legacy fixture decoding.
3. Update Runner journal/output collection to allocate immutable Attempt order, retain complete bounded chunks, retransmit original identities and isolate safely on spool failure. Preserve supervised launch and CLI identity.
4. Add backend migration and ingestion for contiguous visibility, exact duplicate/conflict handling, activity and missing-gap recovery. Audit exit/completion and Planner missing-result precedence; keep logs out of formal Task Events.
5. Add authenticated Attempt status/log reads with Task/Attempt-bound cursors and byte limits. Add the smallest browser reconnect proof; leave full Task detail UI to its owning package.
6. Verify seeded selected Planner and Node Attempts through installed Runner/CLI with scoped commands. Cover duplicate/delayed Start, reordered events, backend restart, browser reconnect, missing formal result and storage failure. Check the selected LongCat model's current zero prices before any live call.
7. Run `pnpm protocol:check`, `pnpm lint`, `pnpm typecheck`, affected Vitest/DB/Playwright checks, `pnpm build`, `go test -race ./...`, `go vet ./...`, and `git diff --check`. Record real Linux/CLI evidence separately. Perform full affected-layer Trellis check and update executable specs.

## Risk and rollback points

- Roll out additive wire/journal fields and legacy decoding before enabling ordered-log Attempts; retain old journal rows.
- On failed durable capture, isolate execution and retain reservation until physical reconciliation.
- Promise Runner observation order, not unknowable exact interleaving of independent pipes.
- Future semantic Owner commands and full Task UI consume this API in their owning tasks.
