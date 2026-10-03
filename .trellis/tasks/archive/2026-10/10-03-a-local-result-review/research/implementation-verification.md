# Exact local result read implementation verification

Date: 2026-10-03. Scope: first local Review leaf; no delivery acceptance or remote publication. Main owns integration, specs and commits. This implementer made no commit, archive, task transition, deployment, host action, Agent/model call or provider write.

## Implemented behavior

- Canonical result projection now advertises a SHA256 of the exact original completion, Attempt/dispatch/source, manifest, operation identity, workspace/lease/storage/generation/repository, fixed base and result commit/tree. Selected lookup shares that projection and works beyond its 32-result page. Current applicability remains separate from immutable original attribution.
- Owner `changes`, `file` and `diff` reads authenticate the session, resolve authoritative identity, dispatch through the owning connected capable Runner, then authenticate/session-check and resolve the same immutable identity again. No transaction spans Runner I/O. A reworked/cancelled result stays inspectable with freshly historical attribution; revoked credentials suppress returned private bytes.
- The ephemeral broker binds every request to Runner, socket, database incarnation, correlation and full identity/mode/path/side/cursor. It permits 8 total and 4 per Runner, uses a 10-second Runner round-trip wait, releases on disconnect/shutdown/throw/timeout, and rejects late/foreign replies. Initial/final PostgreSQL validation retains existing read semantics: this is **not an end-to-end 10-second HTTP SLA**. Old Runners receive no new read frame and report unsupported.
- Runner reads use the original successful completion journal/export, including already-finalized completion settlement. `wire.ScopeID` and `host.ValidateEffectScope` check original Start/source/reservations without requiring historical running status, current boot or a live lease. Operation identity, descriptor/manifest digest and successful physical effect must match.
- Production disk checks retain root UID 0 for the root storage copy and actual service UID for its private copy; no repair, chown, clone, fetch or fallback is allowed. Root/service storage copies, non-symlink ancestor lineage, private export, service-owned object/ref metadata and exact result ref/commit/tree/base are checked. Inspection never opens an execution worktree file.
- Raw Git subprocess output is bounded while it runs, with kill/wait on overflow and deadline. Its sanitized argv/environment disable replacement objects, hooks, optional locks, lazy fetch, external diff/textconv and user/global config. File bytes/newlines/whitespace stay exact; symlink target text is shown without following; gitlinks remain metadata without fetching. Rename detection is disabled truthfully as delete/add.
- Changes have complete identity-bound pagination, 64 records per byte-bounded page and independent 8 MiB/8192-record scan ceilings. Returned-page sizes are measured without spawning per-object commands for the entire collection. Raw text is at most 64 KiB; full encoded response at most 512 KiB, also checked within Frame and after HTTP applicability enrichment. Binary/invalid UTF-8, missing files, oversized content, unsupported names/scan limits and offline/busy/timeout remain explicit.
- Shared contracts require complete status/mode facts, A/new-only, D/old-only, M/T/both, blob/symlink sizes and no gitlink size/text. They reject unknown/irrelevant/null fields, malformed Unicode and traversal. Literal spaces, colon, leading dash, tabs/newlines and supplementary Unicode are supported. End guards account for the JavaScript/Go `$` difference without admitting traversal.

Frontend implementation, browser interactions and inspected final screenshot provenance are owned separately; see [frontend verification](frontend-verification.md). It retains on-demand immutable reads, safe text presentation and current/history labels in the existing Task Local results surface.

## Changed ownership

| Area | Changed paths |
| --- | --- |
| Protocol | `packages/protocol/schemas/v1/contracts.json`, `scripts/generate.mjs`, `src/validation.ts`, `fixtures/validation.json`, generated TS/OpenAPI/Go outputs |
| Backend | `apps/server/src/app.ts`, `task-result-reads.ts`, new `result-content-reads.ts`, new `result-read-broker.ts` |
| Necessary existing read correction | `apps/server/src/task-board-reads.ts`: legitimate timestamp offsets with minutes/seconds; exact canonical timestamp retained |
| Server checks | `apps/server/test/app.test.ts`, `postgres-task-ui-reads.test.ts`, new `result-read-broker.test.ts`, `postgres-result-reads.test.ts`, `fixtures/result-read-fixture.ts`; `package.json` registers the new PG suite |
| Runner | `runner/internal/{control/client.go,daemon/daemon.go,daemon/result_read.go,host/result_read.go,wire/wire.go}`; four new `result_read_test.go` files initially delegated, then handed off for final scope/lineage regressions |
| Frontend handoff | Initial `apps/web/src/lib/{api.ts,task-api.ts}`, `features/{task-overview.tsx,result-inspector.tsx}`, styles handed to the frontend implementer; its final files/tests/fixtures/evidence are separately attributed |

No database migration or dependency/lockfile change. Concurrent AGENTS/Trellis instruction, workflow, hook, skill, profile and general-guide edits belong to another session; preserve/exclude them from this leaf's implementation commit.

## Final executed gates

The [final source manifest](implementation-source-manifest-final.json) records the 31 owned backend/protocol/Runner source/generated/test inputs. It is an after-run current-input manifest; it is not an invented before/after hash proof. The earlier source manifest and delegated focused-Go report remain retained with their original versions.

| Check | Result / actual boundary |
| --- | --- |
| `pnpm lint` | Passed, 0 warnings ([log](evidence/lint-final.log)) |
| `pnpm typecheck` | Root and Web passed ([log](evidence/typecheck-final.log)) |
| `pnpm protocol:check` | Generated artifacts current after final newline contract ([log](evidence/protocol-check-final.log)) |
| `pnpm test` | **331 passed, 337 deliberately skipped**, 21 passed files/32 skipped; no claim these skips are database execution ([log](evidence/default-tests-final.log)) |
| Focused shared schema/app/broker | **244 passed** across 3 files ([log](evidence/contracts-final.log)) |
| Real PostgreSQL affected reads | **11 passed**: 2 new authenticated result tests plus 9 execution UI/Board reads; isolated PostgreSQL 17.10, schema-per-fixture, database URL loaded privately ([log](evidence/postgres-reads-final.log)) |
| `go test -race ./...` from `runner/` | All packages passed on **Go 1.27.1 darwin/arm64**, final generated contract/source after review fixes ([log](evidence/go-race-final.log)) |
| `go vet ./...` | Passed ([log](evidence/go-vet-final.log)) |
| `sh infra/runner/build.sh /tmp/monos-local-result-runner-binaries-final` | All four executables built with CGO as native **macOS arm64 Mach-O**, no install or Linux/cgroup claim ([binary manifest](runner-binaries-final.json)) |
| `pnpm build`, Web API/browser/screenshots | Executed by frontend owner on final combined backend/protocol input; see its report, build/source manifests and final inspected screenshots |
| `git diff --check` | Passed after frontend-owned final whitespace fix; no unrelated source staged |

### What the real PostgreSQL/WSS tests establish

The initial Git completion and 34 subsequent same-Node guidance reworks use actual formal command admission/settlement and immutable manifests, with explicitly synthetic Git physical result OIDs. The collection has 35 results; the selected historical maximum lies beyond the first 32. Changing later mutable `task_workspaces.finalized_commit` cannot relabel that exact result.

A real authenticated WebSocket peer exercises app Ready capability registration, old unsupported mode, exact correlated request/response, loss of connection, Owner revocation while waiting, expected-session mismatch, crossed Task/result, stale digest, malformed/cross-result canonical cursor and invalid query/path. It is a synthetic peer returning test bytes, **not physical Runner Git or native Agent execution**. A result initially current becomes historical while the response is pending; pinned bytes retain identity and fresh applicability.

Every table in the isolated schema is compared before/after those Owner reads, excluding `runners`, `owner_sessions` and `runtime_installations` because the test explicitly reconnects/authenticates/revokes credentials. Task, Node, activation, formal event, Artifact, operation, receipt, outbox, workspace/lease and conversation/guidance/history records remain unchanged. Successful final-run test schemas are dropped by their owning fixture. Main later found two initial failed-setup leftovers, confirmed their exact Result-project ownership, cleaned only those two, and added a real failed-setup cleanup regression; see main-final-review.md.

### What the Go tests establish

[Delegated Go evidence](go-read-verification.md) initially passed 20 top-level tests/43 subtests, including actual immutable Git files/diffs, >64 pagination, byte-limited long-name pagination, 8193-record and >8 MiB scan failures, binary/invalid encodings, symlink/gitlink, unchanged worktree/index/ref, object replacements/external filters, raw stdout overflow/cancel, exact SQLite original completion and recovered settlement, plus authenticated TLS control correlation/cancellation.

That report's 102-input aggregate **does not describe the final candidate**: product scope validation, storage/ref permissions, formatting, raw validation and the final newline schema changed later. Its report is retained historical evidence. Final full race/vet recompiles/tests the current candidate and also includes eight contradictory retained Start/reservation negatives plus service-lineage/dual-storage-copy validator negatives. The same-account macOS storage validator fixture cannot prove live root/service UID behavior; production keeps strict root ownership and native Linux dual-account acceptance belongs to the later package leaf.

## Retained failures and corrective deltas

1. Initial schema used negative-lookahead path regex; Go JSON Schema's RE2 metaschema rejected it before ordinary consumers could validate. Replaced with portable schema conditions; both languages now pass shared positive/negative path fixtures.
2. Initial Go code used nonexistent quicktype enum `FrameType`; actual generated `Type`/constants replaced it and all consumers/four binaries compile.
3. Initial TypeScript broker constructor used parameter properties, violating `erasableSyntaxOnly`; replaced with an explicit field. Final types/native source remain erasable.
4. Independent checks reproduced closed-Ready ghost registration, send-throw leaked pending capacity, incomplete response facts, raw UTF-8 byte overflow, malformed Unicode, OpenAPI optional-required mismatch and corrupt retained Start scope. Each was corrected with focused app/broker/shared wire/Go regressions. No weakened authorization or renamed successful failure.
5. Actual Go tests exposed promoted `bytes.Buffer.ReadFrom` bypassing the output writer and cancellation mislabeled identity mismatch/overflow. The buffer is now private and parent cancellation is separately classified; actual overflow/deadline tests pass.
6. Initial new PG fixtures omitted positive provider repository metadata, revoked by token rather than session ID, shadowed the helper's `node()` and declared only the newest guidance while earlier active guidance remained assigned. Corrected test setup at the actual admission boundary; all assigned guidance IDs are now declared. Product guards were preserved.
7. Existing Board pagination rejected the legitimate legacy Singapore epoch `1970-01-01 07:30:00+07:30` because its parser allowed only hour offsets. Added minute/second offsets and a real explicit Singapore legacy pagination regression. No database timezone was globally changed and exact keyset timestamps remain canonical.
8. One final Go command was invoked from repository root instead of the `runner` module and failed before tests. [Original failure log](evidence/go-wrong-cwd-retained.log) remains; correctly scoped final full race/vet passed. One checkout-relative append command was likewise attempted from the Runner cwd and wrote no file; the test was added using its correct owned path and passed.
9. The final schema fixes JavaScript's `$` matching before a trailing line terminator versus Go's exact end. Eleven new shared positive/negative cases preserve newline-name support without allowing empty/dot/traversal segments. Final schema/default/Go gates were rerun afterwards.

## Limits and follow-up

- No native installed host, live model/provider, GitHub write, Linux service restart, reboot, cgroup, UID-crossing or paid Runtime trial was done. macOS Git tests and synthetic authenticated peers have their stated boundaries.
- Reads remain ephemeral and instance-local to the backend holding the Runner socket. Other instances report offline; no multi-backend routing guarantee.
- Disk loss/replaced storage, unsupported filenames and scan/inspection ceilings remain explicit unavailable/unsupported outcomes. They do not add Task states, capture failures, publication findings or repair actions.
- Public candidate construction, publication scanning/overrides, PR/check/merge preparation, Owner acceptance and Request Changes delivery guards remain the subsequent package leaves.
- Independent final combined review and main-session specs/commit/archive are still required; this report is implementer evidence, not final task acceptance.
