# Design: Runner dispatch and execution logs

## Boundaries and data flow

The future owning Todo/Task command assembles authorized context and calls `RuntimeScheduling.selectAndEnqueue` in its transaction. The existing queue claims owner/capacity and commits a Start outbox row. Backend sends the immutable Dispatch over authenticated WSS. Runner validates current authority, persists start intent, launches the selected installed CLI through the narrow host helper, and supplies the bundled `monos` path. Agent calls reach only the Tool Protocol with Attempt/fencing scope. Runner never writes domain tables. Acceptance fixtures create canonical Planner and Node owners and use this selected path; they do not replace later Owner conversation commands.

## Stable log order

Use one durable per-Attempt sequence allocated by the Runner journal for observed stdout, stderr and objective Runtime facts. Each entry retains source, raw text or structured payload, and dispatch identity. The sequence denotes Runner observation order; it cannot claim exact interleaving of concurrent OS pipe writes. Split bounded transport frames without dropping source bytes or UTF-8 boundaries. Retain OpenCode structured lines even when extracting a display category. Never infer completion from text or exit code.

Extend the versioned wire additively so new events carry this order and source while historical per-stream records remain decodable. The Runner journal atomically records each chunk and advances its source offset before sending. Acknowledgement marks the same immutable event. Reconnect retransmits original identities. Backend accepts exact duplicates, rejects same-identity content conflicts, stores out-of-order arrivals, and exposes only the contiguous prefix. A missing entry holds later entries. Legacy records may be read in deterministic per-stream order but cannot be advertised as globally ordered.

Remove silent fixed stdout/stderr truncation. Spool and transfer bounded chunks with disk-space and write-error handling. If output cannot be durably captured, raise factual infrastructure attention and stop/freeze the supervised process. Keep slot/workspace ownership until separate Stop/recovery handling verifies absence. Retain complete acknowledged logs as required by module 06; unresolved operations and evidence are never deleted to reclaim space.

## Backend and Owner reads

Keep `runtime_events` as raw delivery evidence; add an additive Attempt-scoped ordered log index and contiguous watermark. Apply event insert, duplicate comparison, activity update and visibility atomically. Do not place log text into `task_events` or Current Task State; existing formal event reads stay unchanged.

Provide authenticated Owner Attempt status and `GET /v1/owner/tasks/:task_id/attempts/:attempt_id/logs?cursor=...`. Its canonical cursor binds version, Task, Attempt and acknowledged sequence. Bound each page by item count and encoded bytes, advancing only over returned contiguous entries. Reject wrong scope/malformed cursors and explicitly report future cursor or missing history. Queued Attempts have no log. The current Web app is configuration-only: add a minimal browser consumer or reconnect fixture to prove Owner access; the full Task detail layout belongs to later Task execution UI. No top-level Activity page.

## Exit, compatibility and rollback

Completion admission and operation settlement remain authoritative. Exit without an admitted formal outcome fails the Attempt and blocks a Node; a Planner missing result records attention without inventing a Plan or reply. Late logs remain attributed history and never restore mutation authority. No successor starts on heartbeat loss, terminal DB state or unresolved process ownership.

Migration is additive, including deterministic handling of legacy probe rows. Protocol negotiation rejects an unsupported ordered-log mode rather than exposing an incomplete cursor. Backend rollback leaves new rows intact; Runner rollback gates new ordered-log dispatches from old binaries. Storage failure cannot be translated into success.

## Verification limit

Exercise independent backend workers, reordered/duplicated/gapped events, restart/reconnect, cursor scope/limits and spool failure. Real Planner and Node installed-CLI cases run only on an authorized test host with the Owner-selected LongCat free model after a fresh zero-price check. Local fake-process tests do not establish real-host acceptance. Remote publication is outside this task.
