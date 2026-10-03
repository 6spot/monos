# Exact local result review: design

## Change boundary

The behavior gap is content inspection for existing identified successful completion results. It lives in the canonical Owner result reader, authenticated Runner connection and service-private completion exports. Add read-only schema/broker/Go object reader/UI paths and focused tests. No database migration, new operation or receipt, Agent call, writable workspace lease, provider access or publication occurs.

Expected files: protocol schema/generator registrations/generated outputs/shared fixtures; server task-result-reads.ts, a focused result-content read/broker module and app.ts connection/routes; Runner control/daemon routing plus focused host raw-object reader and journal identity lookup reuse; Web task API/results inspector and its styles; existing test fixture scoped transport plus new cross-layer tests. Preserve unrelated module behavior and source ownership. Any needed small extraction from result projection or Git environment must have regression tests preserving its prior behavior.

## Authoritative result identity

Reuse the existing exact completion join/projector rather than infer current evidence from Node state. A selected result lookup must work beyond result-history page 32. Retained historical results remain inspectable; applicability is separate from immutable content identity. Only valid completed activations in the effective Plan, with exact applicability carry, are labelled current.

Build a generated `ResultReadIdentity` from authoritative records: Task, original complete_node operation/Attempt/dispatch/Node activation/original Spec and Plan, manifest digest, existing canonical operation identity digest, workspace/resource/Runner/storage/generation/lease/repository, fixed base, exact private result commit/tree. Canonical SHA256 of the full resolved projection is the content identity digest advertised with Git result metadata. Browser sends selected operation and that digest, never OIDs, host paths or commands. Full identity is internal transport and returned data attribution.

Runner validates DB.Operation, DB.Start and exact successful DB.Effect against this identity. Do not require running Attempt/old boot/current lease equality: this is historical read authority. The local raw effect does not include backend-enriched completion result fields; compare its exact physical facts and the immutable operation manifest digest, not whole enriched JSON. Verify real root/service storage identities and all service-private export parent ownership/type/modes. Missing initialized storage, symlink/ancestor substitution, missing journal/export, altered result ref or mismatching commit/tree/base fail explicitly. Use `Root/results/<original completion operation ID>` including completion recovered through already_finalized settlement. No fallback to mutable worktree, HEAD, remote clone, cache or re-export.

## Read transport and API

Extend versioned generated Frame with dedicated `result_read` and `result_read_result`, correlation ID and connection incarnation. Ready optionally advertises `result_read_modes=[git_objects_v1]`. Old Runner has no capability and returns unsupported availability before any new frame is sent. Strict schema validation rejects unknown, null and mode-irrelevant fields; existing 1 MiB encoded WSS ceiling remains.

Owner authenticated GET endpoints under `/v1/owner/tasks/:task_id/results/:operation_id/`:

- `changes?identity_digest=...&cursor=...` (cursor optional).
- `file?identity_digest=...&path=...&side=base|result`.
- `diff?identity_digest=...&path=...`.

Use generated strict query/response definitions and `X-Monos-Session`; content replies are no-store. Each reply echoes exact identity/mode/path/side and explicit status plus bounded mode data. Unknown Task/operation or crossed scope is denied; malformed fields/cursor/path are invalid; changed digest is version conflict. Repository-free result has explicit no Git content.

A small instance-local broker binds pending reads to Runner/socket/incarnation/correlation/full request. Bound to 8 total and 4 per Runner, 10-second Runner round-trip deadline, starting after initial authorization/result resolution. Disconnect/shutdown immediately rejects outstanding queries; late/duplicate/wrong identity replies cannot complete another request. Do not claim routing across backend instances: a Runner socket on another instance is unavailable here. Authenticate current Runner connection in DB and register only after valid Ready/capability. Keep WSS send/frame byte guards and close handling honest.

The 10-second budget is a Runner transport/physical-read limit, not an end-to-end HTTP service-level guarantee. Initial and final PostgreSQL authorization/result reads retain the existing Owner API transaction semantics; this leaf adds no general database timeout framework. Database failure or delayed final authorization cannot bypass revalidation or return private bytes.

No DB transaction or Task lock spans Runner I/O. Resolve and authenticate before dispatch, then freshly authenticate Owner/session and re-resolve exact result identity after await before returning bytes. Applicability may have changed: content stays pinned and refreshed results show history; never claim old current status in a stale content response. Session revocation/replacement while waiting must suppress private bytes.

Runner uses a separate bounded 4-read semaphore/queue, independent of Runtime slots and mutating effect queue. Receiver must continue servicing Ready/heartbeats/events. Connection cancellation and the Runner's own 10-second physical-read budget cancel Git subprocesses; no Host launch, systemd action or effect journal write is needed.

## Bounded immutable Git reads

Dedicated raw-byte subprocess reuses fixed executable and sanitized Git environment policies, not trimmed/unbounded gitScoped output. Disable replace objects, hooks, global/system configuration, external diff, textconv and lazy fetch; use known private export git-dir, fixed argv and literal pathspecs. Bound stdout/stderr during execution and kill/wait on overflow/cancel; never expose raw stderr or private host paths.

Changes compare recorded fixed base to exact integrated result, not the private commit's immediate parent. NUL-delimited raw diff/tree parsing; deterministic ordering; rename detection disabled and represented truthfully as delete/add. Include change status, old/new blob IDs/modes/sizes/types as appropriate. File reads look up exact path in selected base/result tree and read the verified blob OID, preserving bytes/newlines/whitespace. Symlinks show literal target text with symlink label and never follow it; gitlinks show metadata and never recurse/fetch. Absent file differs from empty file. Diff uses deterministic unified text and no external filters.

Repository paths are strict relative valid Unicode with no NUL, absolute/drive/backslash ambiguity, empty/dot/dotdot segments; literal spaces/colon/tabs/newlines/dash prefixes remain supported and safely rendered. Invalid UTF-8 Git filenames yield explicit unsupported-path collection status instead of silent dropping; no generic filesystem explorer. Binary/NUL/invalid UTF-8 blob content remains explicit binary/unsupported text, never lossy decoded or rendered as active HTML/Markdown/images.

Chosen initial limits (separate from capture and publication policy):

- 512 KiB fully encoded read response within the existing 1 MiB frame budget.
- 64 KiB raw file or diff text. Too-large diff returns explicit oversized with no purported complete patch; file reports measured size. JSON escaping is measured after serialization.
- At most 64 changes per byte-bounded page; stable canonical cursor binds full result identity and deterministic position. Every page is reachable. A complete scan has a separate 8 MiB raw/8192-record processing ceiling; beyond it return explicit scan-limit status, not silently complete a partial list. Counters and statuses remain honest.
- 10-second broker round-trip wait and 10-second Runner physical-read budget, with bounded concurrency as above. Busy, timeout, offline and unsupported capability are retryable read outcomes without Task state changes.

## Owner UI

Replace the existing diff-unavailable notice in Task Local results with an on-demand inspector in Overview (also reused in diagnostics). Keep completion summaries, Current/Historical attribution and local-result commit visible; technical IDs remain secondary disclosures. Do not label private result commit a published delivery head.

List changed files with accessible selected controls and continuation; offer Diff, Result file and Base file so deletions remain inspectable. Display no changes, empty file, binary, oversized, symlink/gitlink, unavailable Runner and retry states near the selected read while preserving result metadata. Fetch immutable content on selection rather than polling every three seconds. Query keys include session/Task/operation/digest/mode/path/side; fence late callbacks on selection or logout/session replacement. Content is private memory-only and cannot enter sessionStorage, logs or SSE.

Use existing neutral surface tokens, compact hierarchy, Base UI owned controls, literal `<pre><code>` text, keyboard focus and contained code scrolling. At 390x844 list/content/actions remain reachable without page-wide overflow. No new delivery action or Task state is added.

## Compatibility and recovery

No schema/data migration. Ready capability is optional, new read frames go only to capable Runners. Immutable original results survive ordinary daemon restart; replaced/lost storage is explicit unavailable. A failed or interrupted read can be retried without state mutation. Rollback removes the read UI/API capability while preserving original results/journals and prior command contracts.

## Validation boundaries

Actual Go Git tests establish immutable content and preservation. Authenticated WSS plus real PG tests establish identity/auth/correlation and lifecycle independence. Explicit browser read-transport fixtures establish UI behavior, not native host/model/provider execution. Retain inspected actual-build desktop/mobile screenshots and state/source/build metadata. Native installed integration remains the package's later acceptance leaf.
