# Current implementation ownership

Latest AGENTS.md and `.trellis/spec/guides/agent-collaboration.md` were read after the user's explicit update. This tracked leaf retains the user's standing autonomous execution authorization and the same PRD/design scope.

- Main: planning, integration, executable spec updates, scoped repository commits/archive/journal and final acceptance. No source push.
- `/root/local_result_implement`: protocol schema/generation outputs, server product and PG/WSS/unit tests, Runner product and existing tests; research/implementation-verification.md. Web initial edits were explicitly handed over, not reverted.
- `/root/execution_acceptance_helpers`: all apps/web files plus apps/server/test/fixtures/execution-ui-fixture.ts and web-server.ts; research/frontend-verification.md and inspected screenshots. Owns finishing the handed-over initial API/inspector/styles implementation.
- `/root/local_result_go_tests`: new runner/internal/{host,daemon,wire,control}/result_read_test.go files and research/go-read-verification.md; real immutable Git and retained-identity tests. The agent finished and froze its four new test files; main handed their subsequent maintenance to the product implementer. Its focused input hashes are not a substitute for final changed-input race/vet gates.
- Independent check: read-only while an implementer owns a file; report findings to main/owning writer. Any later mechanical self-fix requires explicit handoff. Full combined scope checked after implementations settle.

Concurrent changes to AGENTS.md, Trellis workflow/skills/hooks/profiles/configuration and general collaboration/quality guides are from another session. They are current instructions to follow, not current leaf implementation ownership. Preserve them; exclude unrelated changes from this leaf's commit. If final spec updates touch a guide already modified elsewhere, preserve the earlier changes and stage only the owned additions.

Every check report records command, input scope and result, and marks evidence stale after relevant later changes. Reuse valid unchanged evidence; no test or screenshot alone proves native Linux/model/provider behavior.

## Resolved timing boundary

The intermediate review correctly distinguished broker wait from full HTTP completion. Main selected the smallest scope-preserving contract: 10-second Runner round-trip wait after initial authorization/result resolution, plus a 10-second physical reader budget on Runner. Initial/final PostgreSQL reads retain existing Owner-read transaction semantics; no new general database deadline framework and no end-to-end HTTP 10-second promise. No timeout can skip post-I/O Owner/session/result validation to return private bytes. PRD/design are updated; this is a precise implementation budget decision under standing authorization, not a change to Owner inspection behavior.

## Necessary integration compatibility fix

Real PostgreSQL UI-read regression on the new isolated Asia/Singapore cluster exposed an existing Board cursor decoder that accepts timezone offsets only as hours. A legacy NULL-created Task normalizes to epoch; PostgreSQL returns the exact epoch text with historical Singapore `+07:30`, so existing pagination fails. Main authorizes the smallest timestamp-offset regex compatibility fix in task-board-reads.ts and its real PG regression, preserving exact timestamp text/UTC behavior and avoiding global timezone changes. This is part of combined read validation, not unrelated refactoring. Product implementer owns those files.
