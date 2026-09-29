# Boundary protocol v1

Authority: `schemas/v1/contracts.json`. Run `pnpm protocol:generate` and `pnpm protocol:check`; never hand-edit generated types. JSON Schema validators remain mandatory: Go pointers/structs alone cannot reject null, missing fields or unknown properties. Go module import is `monos.local/protocol`, with Runner `replace monos.local/protocol => ../packages/protocol/generated/go`.

All HTTPS/WSS clients must verify the task CA. Runner credentials and Attempt credentials are different Bearer tokens. No token appears in an envelope, journal, runtime event or log. `POST /v1/commands` accepts `CommandSubmission`: parse input, construct `CommandEnvelope`, canonicalize with RFC 8785, save exact UTF-8 bytes durably, then SHA256 those bytes. Backend requires canonical bytes and validates both digest and schema. Retry uses the retained bytes. Scope is the dispatch's exclusive `task_id` or `todo_id`; backend derives Attempt/fence/activation from the credential and its records. Todo dispatches are Planner-owned with no Task, Node or repository resource. Legacy Task dispatches retain their original wire meaning and journal bytes.

Supported payloads:

- `open_workspace` / `inspect_repository`: `{ "resource_id": "..." }`.
- `complete_node`: `{ "summary": "...", "artifact_ids": [], "handled_guidance_ids": [] }`; optional arrays may be absent, only empty selections are supported in this probe.
- `commit_task_turn`: `{ "reply": "...", "source_watermark": 1, "routing": { "kind": "reply_only" } }`.
- `read_discussion`: `{}` or `{ "cursor": "..." }`; a bounded `result.discussion_page` contains only this Todo's history through the Attempt's launch cutoff.
- `update_working_requirement_state`: `{ "working_requirement_state": "...", "resolved_watermark": 0, "project_context_version": 1, "project_context_digest": "<64 hexadecimal characters>" }`; rebuilding the cache does not resolve pending input.
- `commit_discussion_turn`: `{ "reply": "...", "working_requirement_state": "...", "source_message_id": "...", "source_watermark": 1 }`; optional `task_preview` is `{ "title": "...", "specification": "...", "project_id": "..." }` with optional Project. This is structured proposal content, never Task creation.

The same-named native `monos` commands use `--input <file|-> --request-id <id> --output json`.
Only `commit_discussion_turn` completes a Todo Discussion phase. Resource-free Todo
launches use private scratch and fresh provider context. Repository inspection is
unavailable for Todo Attempts until the Runner implements configured-resource
inspection; the probe repository is never a fallback. Stop may omit `resource_id`,
while workspace effects require a real matching resource. Deploy a compatible
Runner before enabling Todo dispatch; old strict readers reject the new shape.

Unknown or irrelevant payload members are rejected. All requests carry the original `expected_control_version`; opening/inspecting a workspace does not change it. Successful terminal handoff changes it, but receipt replay precedes new-effect guards.

Agent `GET /v1/commands/:request_id` reads its own receipt. Runner `GET /v1/recovery/attempts/:attempt_id/commands/:request_id` and `GET /v1/recovery/operations/:operation_id` read only its recorded dispatch outcomes, including after Attempt token expiry. An unknown receipt returns `status: unknown`, never proof that a request was not in flight. `GET /v1/runner/inventory` returns one `RunnerInventory` page for reconciliation; no mutation authority is created by a read.

## Byte limits and inventory pagination

WSS frames and each inventory response are limited to **1 MiB of encoded UTF-8 JSON**. Individual dispatch, operation and operation-result records are limited to 1 MiB minus 4096 bytes, leaving space for their frame/page wrapper. These are transport byte limits in addition to JSON Schema character/item limits. In particular, a prompt containing many four-byte Unicode characters can exceed the wire limit while satisfying `maxLength`; reject it before dispatch admission. HTTPS command submission allows a 2 MiB outer body because it embeds an escaped canonical envelope, whose own limit is 1 MiB. RFC 8785 inputs must contain well-formed Unicode; do not replace lone surrogate code units and then hash different content.

Inventory includes unresolved Attempt ownership and unfinished operations. Released historical Attempts are omitted unless an unfinished operation still references them; scoped historical receipt reads remain available. The first page has `snapshot_id` and may have `next_cursor`. Fetch subsequent pages with both `?snapshot_id=<same-id>&after=<next_cursor>`. Cursors are opaque. A page can contain dispatches, operations, or both; collect all pages before checking their cross-references or reconciling process absence. Neither a partial page nor a failed scan permits `ready`, release, or replacement execution.

The backend hashes the included row IDs/versions while holding the Runner lock. Heartbeats do not change the snapshot; ownership or operation changes do. A stale snapshot returns `version_conflict` (HTTP 409); discard the partial scan and restart from page one. The client bounds retries and retained scan size, deduplicates identical records, and rejects conflicting IDs or cursor loops. Final scan completeness is established only by a page without `next_cursor`. Each backend page is bounded by encoded bytes and at most 64 records.

## Runner connection

1. Connect WSS `/v1/runner` with Runner Bearer header; send `Frame` `{schema_version:1,type:"hello",runner_id,boot_id}`.
2. Backend returns `welcome` with fresh `incarnation`. All later frames in both directions carry it. A replaced connection is fenced in PostgreSQL.
3. Read the complete paginated inventory and reconcile retained local process/effect ownership. Send `ready` with `log_modes:["ordered_v1"]` only when the Runner can durably number Attempt observations. A Runner without that mode is not marked ready for ordered-log dispatch. `heartbeat` at most every 5 seconds keeps control availability; 15 seconds without it denies new formal mutations. Reconnect does not release reservations.
4. Backend repeats `start` frames with `dispatch` until `started` event is persisted, and `effect` frames with `operation` until successful result is persisted. Receiving duplicates must reconcile the original identity.
5. Before every new start/credential grant, send `authorize_dispatch` with `dispatch_id` and `correlation_id`. Response `authorization` echoes correlation and includes `allowed`; when true, it includes a short-lived `credential` and `expires_at`. Retain tokens only in memory. Denial is not permission to release an uncertain live process reservation.
6. Send `event` with `RuntimeEvent`; stream sequences start at 1. New ordered-log dispatches also require a durable `order_sequence` across stdout, stderr and Runtime facts. Output events retain source bytes in `data_base64` alongside display `text`. `event_ack` echoes Attempt/stream/sequence and acknowledges that individual event, not all earlier events. Retain gaps and replay each unacknowledged event. `started` only acknowledges launch; `exited` does not prove whole-tree absence; `process_absent` reports verified whole-tree absence.
7. Send `operation_result` with stable operation/Attempt IDs, success and `EffectResult`. `operation_ack` confirms durable settlement. For completion/stop success, `writer_absent:true` is mandatory. Successful completion also requires exact finalized `git_commit` and `git_tree`. Workspace/inspection success requires `workspace_id` and opaque Runner-local `path`; backend never opens it.

`Frame` defines transport fields and per-type required/allowed members through schema conditionals, shared by both runtime validators. Command-specific payload members are also schema constraints. An error frame has `error` and optional echoed correlation. This probe's `Dispatch` explicitly selects the Owner-authorized free OpenCode model; it is not a product-wide model restriction.

Owner Attempt status and paginated Attempt discovery live under `/v1/owner/tasks/{task_id}/attempts`. `/v1/owner/tasks/{task_id}/attempts/{attempt_id}/logs` returns only the contiguous ordered prefix, with a Task/Attempt-bound cursor. A missing sequence holds later entries; legacy records remain separately retained as raw Runner events without claiming a global order. Execution output never becomes a formal Task Event.

An admitted completion closes Agent mutation authority before the worker can kill the calling CLI. The operation carries independent system authority. Runner can recover/read it after token expiry. Failed finalization stays `recovery` and does not complete the Node. Optional `failure_kind` is allowed only with `success:false`: `recoverable` (or omitted) preserves the current Node state; `capture_hard_limit` and `invalid_finalization` block the current Node and retain its claim and original operation. Only a completion operation accepts the blocking classifications. Generic Git/IO/systemd failures must not be guessed to be unrecoverable.

After explicit repair/retry, the original operation may settle its blocked Node only while the same activation and Task state remain current. Its blocking classification is retained across intervening transient failures so recovery does not lose attribution. Success still requires whole-tree absence and the exact Git result. Revoked starts are removed from outbox and paired with a stable stop operation; outstanding physical reservations remain until verified absence. This probe covers delayed/revoked Start, not full Task cancellation during admitted finalization.
