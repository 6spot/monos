# Execution plan

1. Inspect current source, previous leaf evidence, host service/binary versions and unresolved Attempts.
2. Implement a bounded selected-runtime queue saturation trial and negative evidence tests using existing harness helpers. Curate implementation/check contexts.
3. Run Python harness checks and repository lint/typecheck/protocol/build/unit gates; run the real PostgreSQL and Linux Go race/vet gates against the reviewed source.
4. Stage only reviewed harness changes, preserving the host's private Compose configuration and installed services. Execute a fresh queue trial after the exact zero-price preflight.
5. Match archived Stop, scoped recovery and reboot evidence to unchanged current product source/binaries. Rerun only where changed code or evidence gaps require it.
6. Audit all trial processes, unresolved effects and physical reservations; retain successful/failed evidence and source manifests. Update verification and parent acceptance only for proven results.
7. Review full diff, update executable spec where new evidence conventions apply, commit and archive this leaf. Close its parent only if all parent acceptance criteria are supported, then continue the next dependency-ready roadmap task.

Validation: `python3 -m unittest discover -s infra/probe -p 'test_*.py'`; `pnpm protocol:check`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `pnpm build`; existing task Compose `--profile test run --rm tests`; Linux `go test -race ./...` and `go vet ./...`; `git diff --check`.

Planning review: scope, risks, acceptance and rollback reviewed against the PRD. User's standing authorization explicitly permits proceeding without another approval question. No unresolved product decision.
