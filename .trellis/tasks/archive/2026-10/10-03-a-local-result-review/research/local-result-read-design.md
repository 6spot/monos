# Research: Exact local result inspection through its owning Runner

- Query: What is the smallest reusable cross-layer mechanism for immutable local result file and diff inspection, and which guarantees, schemas and tests does it need?
- Scope: internal
- Date: 2026-10-03
- Task: `.trellis/tasks/10-03-a-local-result-review`; PRD read. Research only; no code, host actions or git operations.

## Findings

### Architectural contracts

- `ARCHITECTURE.md`: the backend never reads a Runner path as local; REVIEW exposes integrated local output even when remote preparation fails; valid evidence and retained history are different facts.
- `docs/04-workspace-and-git.md:111`: Task Workspace is the canonical integrated review workspace. `:138–165`: successful completion requires frozen writers, finalized/integrated Git and exact result revisions; private Agent commits remain internal. `:163`: read/display budgets, capture limits and publication limits must not become one implicit maximum.
- `docs/07-owner-review-and-ui.md:605–618`: review presents effective requirements, summaries, Artifacts and final Git changes/diff/commit. The first leaf need not add acceptance or remote delivery controls.
- `docs/11-technology-and-deployment.md:68–73`: authenticated Runner-initiated WSS carries RPC-style versioned, correlated envelopes; bounded content can reuse this boundary; large content must not ride unrestricted small command responses. No inbound Runner HTTP listener or shared backend filesystem is required.
- `docs/08-principles-and-non-goals.md`: no new Git Task state, Agent semantic checkpoint, workflow taxonomy or resource binding. Read-only inspection is a deterministic query, not a new Agent tool command or formal lifecycle transition.

### Files found

| File | Existing ownership / reuse |
| --- | --- |
| `apps/server/src/task-result-reads.ts` | Canonical Owner completion evidence reads, carry applicability and bounded history pages. |
| `apps/server/src/task-workspace-reads.ts` | Exact Attempt/lease diagnostics; avoids substituting later workspace observations. |
| `apps/server/src/app.ts` | Owner routes/session guard, Runner authenticated websocket attachment and strict frame handling. |
| `apps/server/src/service.ts` | Database Runner connection incarnation/instance/availability guards. |
| `runner/internal/control/client.go` | Verified TLS/WSS connection, schema decoding, incarnation guards and correlated authorization pattern. |
| `runner/internal/daemon/daemon.go` | Receives frames, bounded durable effect queue, exports finalized result before reporting success. |
| `runner/internal/journal/journal.go` | Immutable operation descriptor and exact successful effect result; historical read lookup. |
| `runner/internal/host/snapshot.go` | Service-private per-operation bare result repositories and exact result ref. |
| `runner/internal/host/workspace_identity.go` | Shared Task workspace ID and trusted dual storage identity reader. |
| `runner/internal/host/workspace_git.go` | Root workspace materialization descriptor digest, stage and metadata. |
| `runner/internal/host/git.go` | Narrow Git environment/trust scopes; unsuitable existing trimmed/unbounded output wrapper for content. |
| `runner/internal/host/finalize.go` | Frozen finalization intent and private completion ref. |
| `packages/protocol/schemas/v1/contracts.json` | Sole wire schema authority, current result metadata and Frame definitions. |
| `packages/protocol/src/validation.ts` | UTF-8 encoded frame/operation byte budgets. |
| `apps/web/src/features/task-overview.tsx` | Existing paginated Local results section used in both Overview and execution diagnostics. |
| `apps/web/src/features/task-shared.tsx` | Session-scoped Task query and pagination patterns. |
| `apps/web/src/lib/task-api.ts` | Authenticated Task reads and generated-schema validation. |

### Existing backend result guarantees

`task-result-reads.ts:49–58` authorizes old completion evidence only via exact carry edges across specification/replan publications. `:95–102` joins an exact manifest, completed Node activation, matching successful `complete_node` operation and digest, Attempt and Task. Current evidence additionally requires effective graph membership and carry applicability; CANCELLED results are historical. This is the source to reuse rather than approximating `node.state === COMPLETED`.

`:129–154` verifies successful effect Git commit/tree against its workspace/lease/storage/repository/fixed base/target branch, then exposes only IDs and immutable metadata. It deliberately does **not** require equality to the Task workspace's later mutable `finalized_commit`. `postgres-task-ui-reads.test.ts:543–559` proves later workspace observations cannot relabel the old result.

`:17–46`, `:102–184` provide Task-bound canonical keyset cursors, 32-item pages and encoded response budget. Do not implement selected-operation lookup by fetching the first page and searching it: the selected historical completion may be beyond page 32. Refactor/reuse the exact query/projector with an explicit operation selector while preserving existing list semantics.

`task-workspace-reads.ts:85–103` distinguishes completion-recovery child metadata from original lease/operation metadata. It is useful as a diagnostic pattern, not a content source.

### Existing immutable local export is the right content source

`host/snapshot.go:94–118`: each completion or checkpoint is exported as service identity, never root/Agent identity. Canonical completion uses `refs/monos/operations/<operation_id>`.

`host/snapshot.go:121–158`: destination is `Root/results/<operation_id>`, with trusted private service-owned parent/destination directories; clone is bare `--no-local`, then exact operation ref is fetched, Git connectivity verified, commit tree checked, and `refs/monos/result` set to the exact result commit. This already retains the object's complete local ancestry, but none is published.

`daemon.go:402–418`: export happens before the effect can be acknowledged as successful. Recovery disposition `already_finalized` exports using the original completion operation and result. `journal.go:324–358` atomically stores both settlement and exact original completion result, so canonical result content can keep using the original completion export directory.

`journal.go:267–275` and `:361–372` read immutable descriptor and exact outcome; `:193–217` and `:278–303` forbid conflicting identity/success replacement. These provide local authorization evidence independently of mutable filesystem markers.

**Gaps:** no Owner content API, no Runner content request handler, no server-to-Runner correlated read broker, no result-page identity token, no bounded raw Git-object reader, and no content UI. Export directories do not contain a dedicated manifest file; do not pretend such a file exists. Journal/operation/result/ref together are available retained provenance.

### Connection / authorization pattern and missing broker

`app.ts:213–217` authenticates Runner before upgrade. `:253–259` requires hello and binds database incarnation. `:261–279` currently accepts only ready/heartbeat/authorize/event/operation-result requests. `:226–245` enforces output backlog and bounded queued messages. Its `send()` currently returns silently when closed; a query broker must fail a waiting read instead of treating that as dispatch.

`service.ts:179–205`: connect increments incarnation and sets this backend's connection instance; touch checks instance/incarnation and stores ready state. `:207–215` shows availability checks but also live Attempt mutation authority: **do not reuse that authority condition for read-only historical completion**. Completed Attempts are released and should still be readable by Owner.

`control/client.go:211–234` provides existing unique correlation IDs, pending channels and 10-second deadline for Runner-to-server authorization. `:244–249` cancels connection workers on disconnect; `:325–346` validates every frame and incarnation before routing. There is no inverse server-to-Runner request map today.

`daemon.go:196–212` routes start/effect into durable mutating queue; a result read needs a separate small bounded, connection-scoped read queue or semaphore. Do not consume Runtime dispatch capacity, acquire writer leases, journal a new effect, call Host supervision or block the websocket receiver while Git executes. Deadline/cancellation must reach subprocesses.

### Recommended smallest solution (proposed, not existing)

1. Add exact selected-result resolver beside `taskResults`, reuse its immutable joins/projector and authenticate Owner; require selected operation and result digest/basis.
2. Add a process-local Runner read broker registered only after valid handshake/Ready. It owns `(runner_id, incarnation, socket, correlation_id)` pending promises, bounded total/per-Runner requests, deadline, disconnect cleanup and late/duplicate response discard.
3. Extend v1 schema with a dedicated read request and read response Frame family plus optional Ready feature `result_read_modes: ["git_objects_v1"]`. Reject unsupported old Runner honestly before sending new frames. No generic arbitrary filesystem RPC or opaque command string.
4. Runner verifies request against retained journal operation/effect/Start scope and trusted storage lineage; reads the service-private exact export. No new physical workspace or export is created on reads.
5. Broker accepts only matching Runner/socket/incarnation/correlation and exact request identity; backend reauthenticates/rechecks applicable result/session before responding after the await. Never hold a database transaction/Task share lock across Runner I/O.
6. UI opens selected current/historical result with changes and text/diff controls. Keep exact identity in query keys, cancel or ignore late responses across selection/Task/session changes, and refresh current applicability after reads.

Proposed schema names are illustrative and should be finalized in design:

```text
ResultReadIdentity {
  task_id, operation_id, attempt_id, completion_manifest_digest,
  workspace_id, resource_id, runner_id,
  generation, storage_id, lease_id, repository_identity,
  base_commit, git_commit, git_tree
}
ResultReadRequest {
  schema_version: 1, identity, mode: "changes" | "file" | "diff",
  path? (only file/diff), side?: "base" | "result" (file only),
  cursor? (changes only)
}
Frame { type: "result_read", incarnation, correlation_id, result_read }
Frame { type: "result_read_result", incarnation, correlation_id, result_read_result }
ResultReadResult {
  schema_version: 1, identity, mode, path?, side?,
  status: explicit available/unavailable class,
  ... exactly one mode-specific bounded data shape
}
```

Browser supplies operation + server-issued result digest/basis, mode/path/side/cursor only; backend resolves full storage identity from authoritative records. Do not trust Owner query-supplied filesystem paths, repository URLs or Git command strings. Either expose a canonical SHA256 result identity token (operation/manifest/Git metadata) or explicitly bind manifest+commit/tree. The original manifest digest alone does not encode all storage/result facts; full resolved identity is always checked internally.

Possible HTTP surface: `GET /v1/owner/tasks/:task_id/results/:operation_id/changes`, `/file`, `/diff`, each strict generated query/response schema; optional single `/content` mode endpoint is equivalent. Existing Owner Cookie and `X-Monos-Session` guard apply (`app.ts:76–80`). Add no-store response headers for content. These are GET reads, not OwnerCommand envelopes or receipt journals.

### Exact identity and historical applicability

Runner checks canonical `(task_id,resource_id)` workspace ID with `TaskWorkspaceID` (`workspace_identity.go:19–25`), operation kind/Attempt/dispatch/Task/Node activation, descriptor digest, completion manifest digest, successful finalized effect metadata and exact OIDs. Corrupted/missing journal is unavailable, never permission to reconstruct from writable HEAD or ref cache.

The requested generation/lease/storage metadata must equal the **selected successful completion snapshot**. A historical completed result is not invalid merely because a later lease or generation now owns the mutable workspace; compare against retained operation/effect for that history, not the current root workspace lease. Always check that actual host storage identity still equals selected storage. `readStorageIdentity` (`workspace_identity.go:118–133`) already rejects symlink/type/owner problems, missing copies and mismatches. `bootstrap.sh:125` creates root copy 0644 and service copy 0600, so service can verify both without new sudo action; expose a narrow reusable wrapper using actual service UID if needed. Missing initialized lineage must stay unavailable.

For exact export, check trusted private directory, `refs/monos/result == selected git_commit`, commit object type/tree equality and base existence/type. Resolve no symbolic current HEAD or remote branch. Export missing/ref changed/tree mismatch is unavailable or exact identity conflict; never fetch/clone/re-export on a read.

Current applicability is mutable semantic context. If a request expressly requires a current result and the Node was reworked/replaced during I/O, return version conflict; if historical inspection is permitted, return still-pinned bytes with freshly verified historical attribution. Never label old bytes current from a stale initial metadata read. Owner auth/session may change during I/O; recheck before returning private content.

### Safe immutable Git reads and content fidelity

Existing `gitScoped` (`git.go:26–54`) supplies `/usr/bin/git`, no replacement objects, hooks disabled, narrow safe directories, no system/global Owner config and sanitized environment. Reuse these policies, **not its output implementation**: `cmd.Output()` is unbounded and `strings.TrimSpace` destroys leading/trailing whitespace and terminal newlines.

Use a dedicated `exec.CommandContext` raw-byte reader with bounded stdout/stderr, kill/wait on overflow/deadline, `--git-dir=<known export>` and fixed argv. Include no external diff, no textconv, no lazy fetch, no replace objects and literal pathspecs. Never return raw Git stderr to UI; it can contain private host paths/config.

- Changes: deterministic `git diff-tree --no-commit-id --raw -r -z --no-renames <base> <result>` (or equivalent exact-tree diff), parse NUL-delimited paths/OIDs/modes. Rename detection can be omitted explicitly: delete/add is truthful and bounded. Include status, old/new blob OIDs, modes and sizes; symlink 120000 and gitlink 160000 are explicit types.
- Files: exact `ls-tree` lookup under chosen base/result tree, then `cat-file -s` followed by bounded `cat-file blob <verified oid>`. Never filesystem `open(path)` or follow a symlink; a symlink's blob may be shown as its literal target string with a symlink label. Gitlinks are metadata, never traversed/fetched.
- Diff: per literal changed path between exact base/result tree with `--no-ext-diff --no-textconv --no-renames --no-color` and deterministic unified context. Include additions/deletions/type/mode changes. Do not use the private completion's immediate parent as Task diff base: Task delta is fixed materialization base to integrated result.
- Strict UTF-8 validate; NUL/invalid UTF-8 is binary (or unsupported text encoding), no lossy substitution. Empty file and absent file differ. Preserve final newline and trailing spaces. HTML/JS/code render as text in `<pre><code>`, never Markdown, raw HTML or image preview.
- Strict relative repository paths: nonempty, valid Unicode, no NUL, absolute/drive paths, backslash ambiguity, empty/dot/dotdot segments; reject traversal and option/pathspec injection before Git. Paths from Git can include tabs/newlines/spaces/colon; parse NUL and serialize escaped text. Either support valid UTF-8 such names or explicitly report unsupported names; no silent drops. Non-UTF8 Git names require explicit unsupported collection outcome or a lossless encoded-path contract.

### Proposed bounds and complete pagination

These are design recommendations, not current configured limits:

- WSS existing encoded cap is 1 MiB (`validation.ts:4–7`); choose application read reply cap **512 KiB encoded** and raw text/diff cap **64 KiB**, leaving worst-case JSON escaping plus identity wrappers below it. Measure full serialized UTF-8 bytes, not character counts.
- File `cat-file -s` avoids reading oversized blobs. Return size + `oversized` with no fake empty content. Diff overflow may return explicit `truncated` and captured limit, or `oversized` with no content; never call partial patch complete. Binary output includes sizes/OIDs, no random decoding.
- Changes page at most 64 records and byte budget, stable cursor bound to operation/full result identity/base/tree and last exact path/index. Every supported collection must be fully reachable, including >32 historical results and >64 changed files. Wrong Task/result cursor is denied; malformed cursor invalid.
- Stream/parse changes rather than accumulate unbounded whole diff output. A finite supported processing budget may fail the whole changes list honestly with `unsupported_budget` while preserving result; it cannot silently cap total files. If using bounded total scan instead of streaming, document exact record/byte cap separately from page size, no false `has_more=false`.
- Bounded broker concurrency (for example 8 global/4 per Runner), per-Runner read semaphore and a 10-second total deadline. Busy/timeout/offline/unsupported protocol are retryable read errors, never Task BLOCKED or Agent fallback. Reads should not poll full content every three seconds; fetch selected content on demand and use immutable caching within private session scope.

### UI scope

`task-overview.tsx:208–290` currently loads all result pages and labels Current/Historical, summary, Git metadata and technical IDs; `:278–282` explicitly says diff retrieval unavailable. Replace that notice with an accessible result inspector and read retry. This component also appears in execution diagnostics (`task-execution.tsx:89`). Keep summaries/change navigation primary and IDs in existing diagnostic disclosure.

`task-shared.tsx:59–87` provides Task-bound pagination and auth callbacks; extend query key with operation/digest/path/side. Immutable content should use on-demand queries rather than existing 3-second polling. Read failure must not hide result metadata or become empty canonical state. On mobile, file list and code/diff need bounded horizontal code scrolling, no page-width overflow; keyboard selected-state and focus remain usable.

First leaf can list changed files and inspect both base/result sides (deleted files need base). API may allow unchanged result paths if exact tree lookup is implemented. Full repository tree browsing is an optional separate mode; do not introduce a generic host file explorer. Binary/oversized/symlink/gitlink/no-change/Runner offline must be visible product states.

## Tests and reusable fixtures

- Protocol: edit `schemas/v1/contracts.json`, regenerate (`pnpm protocol:generate`), then `pnpm protocol:check`; update mode-specific Frame conditionals rejecting unknown/irrelevant/null fields. Shared TS/Go fixtures test exact identity, bad paths, counters, stale cursors and encoded Unicode byte caps. Adding schemas can rename generated Go enums: compile all Runner consumers.
- Real Git Go tests: `host/finalize_test.go:12–47` fixture setup; `snapshot_test.go:9–91` private detached result/ref with base/history and no alternates. New reader tests should inject temporary export/storage paths or factor pure trusted-reader entry for local tests; public production entry always derives fixed root. Cover changed worktree/HEAD after export, exact old/new results, altered ref/tree/storage, no substitutions, empty files/newlines/Unicode, binary/invalid UTF-8, symlink external target, gitlink, add/delete/mode changes, magic/dash/colon/newline paths, >64 changes and byte-limited pages, huge blobs/diff, timeout and output overflow. Compare export refs and workspace HEAD/index/files before/after reads.
- Runner daemon: existing journal and completion tests cover exact descriptor/outcome; add read tests without Host or Control mutation calls, concurrency bound/cancel/disconnect, already-finalized settlement original export. `control/connection_test.go` and `daemon/recovery_test.go:497` provide TLS/WSS lifecycle harnesses; prove reads don't block Ready/heartbeat/effects or leak old-incarnation replies.
- Backend routing: `apps/server/test/app.test.ts:88,117` has real websocket attachment tests; `postgres.test.ts:332–363` combines real PG and WS framing. Exercise exact broker response, wrong Runner/socket/incarnation/correlation/identity, late duplicate, app shutdown cleanup and timeout. Authenticated Owner requests/session replacement must not expose content.
- Backend canonical data: `postgres-task-ui-reads.test.ts:344–401` covers carry vs historical results/cursors; `:480–559` exact workspace metadata and later mutable head. Extend with selected operation beyond first page, unavailable repository-free result, read racing Rework/cancellation/specification carry and byte-exact control/result/lease preservation.
- Browser: `apps/server/test/fixtures/execution-ui-fixture.ts` and `web-server.ts` are existing canonical fixture entry points; `apps/web/test/execution.e2e.ts:39–56,309–317,462–465` asserts REVIEW metadata/history/recovery. These currently use synthetic Git OIDs for metadata and do **not** establish real Git content. Add a scoped explicit test read transport/provider with deterministic content for UI tests; separately prove actual Go Git path and authenticated WS/PG path. Do not mislabel browser fixture transport as native installed execution.
- Browser scenarios: changed-file navigation, base/result/deletion/diff, stale result refusal/refresh, current vs historical, offline/binary/oversized/truncated/no changes, safe literal HTML, session switch late callback, continuation and mobile code overflow. Capture and inspect 1440×1000 and 390×844 populated states, retain build/state/source identity as frontend quality guidance requires.
- Necessary commands: affected Vitest/PG/Playwright tests, `pnpm lint`, `pnpm typecheck`, protocol drift, Go `go test -race ./...`/`go vet ./...`; broaden only for changed shared contracts/shell and required package gates.

## Related specs

- `.trellis/spec/backend/index.md`, `owner-reads.md`, `workspaces.md`, `node-execution.md`, `delivery-contracts.md`, `error-handling.md`, `quality-guidelines.md`.
- `.trellis/spec/runner/index.md`, `workspace-guidelines.md`, `execution-guidelines.md`, `quality-guidelines.md`.
- `.trellis/spec/protocol/index.md`, `schema-generation.md`.
- `.trellis/spec/frontend/index.md`, `execution-ui.md`, `state-management.md`, `type-safety.md`, `component-guidelines.md`, `visual-design.md`, `quality-guidelines.md`.

## External references / versions

No external research was needed: design depends on repository-owned current code/contracts. Local specs explicitly record Git 2.39 and installed 2.47.3 cross-account differences; this task's new object reader should not claim cross-account transport feasibility from same-account tests. It reuses existing private export rather than adding transport clone/fetch. JSON Schema draft 7/AJV, generated quicktype TS/Go, coder/websocket and ws are existing project mechanisms.

## Caveats / Not Found

- No implemented local content RPC/Owner acceptance/provider coordinator exists today. All proposed schema names, bounds and feature negotiation fields above require design and implementation.
- Existing Stage A canonical completion permits one workspace per Node activation. Preserve the complete result collection/history; do not create an API singleton just because installed acceptance is one Node/repository. Final multi-Node integrated result selection will need a stronger Task result aggregate if later execution expands; this leaf should inspect identified completed integrated snapshots and not claim an aggregate it cannot prove.
- Current result applicability may change without immutable bytes changing. Keep content identity and semantic current/history labeling separate.
- Metadata fixtures contain fake Git OIDs and cannot demonstrate physical object reads. Existing native Linux evidence is valuable context but was not read/revalidated on host during this research.
- No durable operation is needed for bounded read-only RPC. An in-memory broker only works on the backend instance holding the Runner socket; requests reaching another instance must report unavailable or route explicitly in future. Do not imply multi-backend routing support.
- Actual secret matches in repository files are not automatically credentials injected by monos. This first leaf must never include provider/config/access bodies or raw subprocess stderr; publication scanning/redacted findings remain next leaf. Avoid silently altering source code bytes while claiming exact content.

### Follow-up: exact manifest / operation / storage chain

The strongest small identity projection includes `operation_identity_digest`, `dispatch_id`, `node_id`, `node_activation`, `specification_id` and `plan_id` alongside the proposed identity above. `wire/operation.go:11–27` already computes canonical immutable operation identity, excluding transport settlement state, outcome and cancellation marker; backend uses this same completion-target projection. Reuse it instead of inventing a subtly different operation hash.

Binding chain:

1. Backend Owner query verifies authoritative `completion_manifests.operation_id/content_digest`, `node_completions` attribution, successful `operations` kind/Attempt/digest and exact `attempts` source identity. It derives full identity from those joins, never caller OIDs.
2. Runner `DB.Operation(id)` validates `complete_node`, schema, immutable descriptor digest, manifest digest and operation identity digest. `DB.Start(attempt)` (`journal.go:124–131`) provides dispatch, Runner/Task/Node activation and `NodeExecutionSource` original Spec/Plan/source attribution (`wire/scope.go:58–68`). Do not require the historical Start to remain running or original boot to equal current boot; reads intentionally survive process release/reboot.
3. Runner `DB.Effect(id)` requires exact `success=true`, matching Attempt/operation, writer absence, canonical workspace metadata, commit/tree. Compare requested generation/lease/storage/base/repository/finalized commit to this retained successful outcome and immutable descriptor; do not compare historical lease to mutable live lease.
4. **Manifest digest is present on the retained Operation, but may not be present on the Runner's raw successful EffectResult.** Backend enriches `node_completions.result` with summary/Artifact IDs/manifest digest (`node-completion.ts:76–95`) after receiving physical Git result. Do not incorrectly require local raw EffectResult to contain the backend enrichment or compare the whole enriched backend result byte-for-byte to raw local outcome. Compare physical identity fields plus immutable operation manifest digest; successful settlement preserves that exact original result in journal (`journal.go:324–358`).
5. Runner verifies actual root and service storage copies with `readStorageIdentity` (`workspace_identity.go:118–133`). Root copy is root-owned 0644, service copy service-owned 0600 (`bootstrap.sh:125–131`), so no privilege escalation is needed. `trustedFile` (`helper.go:151–159`) uses Lstat and rejects nonregular/symlink/wrong-owner/writable-group-or-other files. Also validate parent lineage explicitly where appropriate; `trustedFile` alone does not walk parents.
6. Trusted `Root/results/<operation_id>` is service-private and independent of Agent-writable Task common/worktree. Verify service ownership/private modes, no symlink parent redirection, exact `refs/monos/result`, exact commit→tree and original base object. Do not infer export identity from refs in the execution-owned source repo. Existing serviceDirectory only validates the specified path, so new read validation must also reject ancestor substitution, not merely trust an Lstat of the last component.
7. Returned full identity must match the broker's admitted exact request, which remains fenced to active Runner socket/incarnation. Backend performs fresh Owner/session/result attribution checks after I/O. This prevents wrong export, wrong history, stale current label and authorization replacement.

No dedicated export manifest currently exists. Adding a small service-private immutable identity marker could strengthen future disk-lineage audit, but is not necessary if the existing journal, operation digest, dual storage copies and export ref/tree chain are required together; the first leaf must fail unavailable if any link is missing. A marker supplied by Agent-writable Git metadata is not an acceptable replacement.
