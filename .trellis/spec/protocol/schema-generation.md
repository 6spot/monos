# Wire Schema Ownership and Evolution

Sources: [technology](../../../docs/11-technology-and-deployment.md), [evolution](../../../docs/05-tool-protocol.md), [implemented protocol](../../../packages/protocol/README.md).

## 1. Scope / Trigger

Every command, dispatch, normalized Runtime event, recovery page or backend/Runner RPC change. Generated language types are data representations, not a substitute for validation.

## 2. Signatures

- Authority: [schemas/v1/contracts.json](../../../packages/protocol/schemas/v1/contracts.json), JSON Schema draft 7.
- Generator: [generate.mjs](../../../packages/protocol/scripts/generate.mjs), pinned `quicktype-core` from the root manifest; `pnpm protocol:generate` updates TS, Go, embedded Go schema and OpenAPI together.
- Drift gate: `pnpm protocol:check`; never hand-edit `packages/protocol/generated`.
- Runtime validation: browser-safe [protocol/src/validation.ts](../../../packages/protocol/src/validation.ts) uses AJV and TextEncoder byte limits; Node-only canonicalization/crypto stays in [protocol/src/index.ts](../../../packages/protocol/src/index.ts); [wire.go](../../../runner/internal/wire/wire.go) validates against the same embedded schema before decoding Go structs.
- `RunnerInventory { schema_version, snapshot_id, dispatches, operations, next_cursor? }`; `InventoryQuery { after?, snapshot_id? }` requires both query fields together.
- `OperationResult { operation_id, attempt_id, success, result, failure_kind? }`; failure classification is forbidden on success.
- `Dispatch.log_mode="ordered_v1"`, `Ready.log_modes`, `RuntimeEvent.order_sequence` and `RuntimeEvent.data_base64` establish ordered capture. `AttemptStatus`, `AttemptListPage`, and `AttemptLogPage` are generated Owner read contracts; see [execution logs](../backend/execution-logs.md).

## 3. Contracts

Commands, normalized events and backend/Runner frames carry explicit schema versions. Negotiate before dispatch; unsupported required semantics fail clearly. Optional fields are absent, not null. Unknown fields and command/frame-specific irrelevant fields are rejected by schema conditionals. Use the same schema definitions in OpenAPI, not hand-maintained DTOs.

Counters are integers in `0..9007199254740991`, with event sequences starting at 1. Do not conflate domain IDs, Node activation, Attempt fencing, connection incarnation, event sequence and message cutoff. During an execution, stored operations retain their admitted schema and meaning. Before actual use begins, breaking development versions update all current producers/consumers and use fresh scoped test state; historical wire/schema migration support is not required. See the [development policy](../../../docs/12-product-naming-and-upgrades.md). Never reinterpret a live admitted operation to fabricate a new receipt or successful recovery.

RFC 8785 canonical JSON defines the immutable UTF-8 envelope and SHA256 digest. Reject malformed Unicode before language decoders can substitute a different string. Preserve absent versus empty arrays and exact payloads on replay.

WSS frames/inventory pages have a 1 MiB **encoded byte** limit. Dispatch/operation/operation-result items reserve 4096 bytes for wrappers. Command submission has a 2 MiB outer HTTP limit around a canonical envelope of at most 1 MiB. Schema `maxLength` counts characters, so Unicode byte limits require explicit transport validation before admission; merely increasing character or item counts is not a fix.

Inventory pages contain only unresolved ownership/operations. Collect every page under the returned snapshot token before reconciliation or `ready`; reject stale snapshots and start a fresh complete scan. The server bounds each page by bytes and 64 records. Heartbeats do not invalidate the snapshot, while relevant row changes do. Released history remains available through separate scoped receipt reads.

Runtime delivery is at least once. Deduplicate `(attempt_id, stream_id, sequence)` without acknowledging missing earlier events. A transport acknowledgement is not lifecycle completion. Large logs/content use bounded authenticated batches; credentials never enter envelopes or journals.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unsupported schema version | Reject before dispatch/admission |
| Null/unknown/irrelevant field | Schema validation failure |
| Unsafe or fractional counter | Validation failure |
| Unicode payload exceeds encoded byte budget | Reject before dispatch admission |
| Success result includes `failure_kind` | Validation failure |
| Cursor without snapshot, or snapshot without cursor | Validation failure |
| Snapshot changes between pages | HTTP 409 `version_conflict`; discard partial scan |
| Duplicate/conflicting page records or cursor loop | Deduplicate exact records; reject conflicts/loops without releasing ownership |

## 5. Good / Base / Bad Cases

Good: three long Unicode prompts cross a page boundary; the Runner collects all pages and preserves all claims.
Base: matching generated TS/Go validators accept the same shared fixture.
Bad: a Go struct silently ignores a field, or one partial recovery page is treated as the complete live-process set.

## 6. Tests Required

Run `pnpm protocol:check` and `pnpm test`, then `go test ./...` from `runner`. Shared [validation](../../../packages/protocol/fixtures/validation.json) and [canonicalization](../../../packages/protocol/fixtures/canonicalization.json) fixtures cover versions, optional/null fields, unknown members and stable UTF-8 content.

Real [PostgreSQL tests](../../../apps/server/test/postgres.test.ts) exercise Unicode/operation pagination, stale snapshot restart, preserved receipt reads, event reordering and typed failure recovery. Producer and consumer tests must agree after regeneration. Quicktype may rename existing Go enums when another definition introduces the same field/value; compile every Runner consumer after adding schemas, even when existing wire values are unchanged. Distinct backend/Runner roots and verified TLS still require real deployment evidence.

## 7. Wrong vs Correct

Wrong: edit generated Go fields or return the first 1000 rows as a complete inventory.
Correct: edit the versioned schema, regenerate both consumers, and use bounded pages with explicit completeness and snapshot conflict handling.
