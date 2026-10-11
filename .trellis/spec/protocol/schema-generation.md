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
- `RuntimeEvent.runtime_failure?: "native_terminal_error"` is allowed only with `kind="exited"` or `kind="process_absent"`. It is a trusted Runner observation, separate from `OperationResult.failure_kind` and any formal Agent outcome.

## 3. Contracts

Commands, normalized events and backend/Runner frames carry explicit schema versions. Negotiate before dispatch; unsupported required semantics fail clearly. Optional fields are absent, not null. Unknown fields and command/frame-specific irrelevant fields are rejected by schema conditionals. Use the same schema definitions in OpenAPI, not hand-maintained DTOs.

Counters are integers in `0..9007199254740991`, with event sequences starting at 1. Do not conflate domain IDs, Node activation, Attempt fencing, connection incarnation, event sequence and message cutoff. During an execution, stored operations retain their admitted schema and meaning. Before actual use begins, breaking development versions update all current producers/consumers and use fresh scoped test state; historical wire/schema migration support is not required. See the [development policy](../../../docs/12-product-naming-and-upgrades.md). Never reinterpret a live admitted operation to fabricate a new receipt or successful recovery.

RFC 8785 canonical JSON defines the immutable UTF-8 envelope and SHA256 digest. Reject malformed Unicode before language decoders can substitute a different string. Preserve absent versus empty arrays and exact payloads on replay.

WSS frames/inventory pages have a 1 MiB **encoded byte** limit. Dispatch/operation/operation-result items reserve 4096 bytes for wrappers. Command submission has a 2 MiB outer HTTP limit around a canonical envelope of at most 1 MiB. Schema `maxLength` counts characters, so Unicode byte limits require explicit transport validation before admission; merely increasing character or item counts is not a fix.

Inventory pages contain only unresolved ownership/operations. Collect every page under the returned snapshot token before reconciliation or `ready`; reject stale snapshots and start a fresh complete scan. The server bounds each page by bytes and 64 records. Heartbeats do not invalidate the snapshot, while relevant row changes do. Released history remains available through separate scoped receipt reads.

Runtime delivery is at least once. Deduplicate `(attempt_id, stream_id, sequence)` without acknowledging missing earlier events. A transport acknowledgement is not lifecycle completion. Large logs/content use bounded authenticated batches; credentials never enter envelopes or journals.

The Runner attaches `runtime_failure` to both its retained main-exit event and
later verified process-absence event when native terminal proof exists. Recovery
must reuse immutable exit proof even after ACK; do not send a bare terminal event
and later rewrite it or expect a separate failure event to reinterpret it.
Absence of this optional field conveys no classified native error. Raw output,
numeric child exit codes and diagnostic message text cannot supply the field.
Capture failure takes precedence. See the [Runner parsing and provenance contract](../runner/execution-guidelines.md#trusted-native-terminal-failure).
Schema shape validation does not replace authenticated Attempt/dispatch ownership
or backend checks for current sources, formal outcomes and physical settlement.

## 4. Validation & Error Matrix

Workspace reservations carry optional isolation per resource. A `complete_node`
operation has one sorted `workspaces` collection, with unique resource/workspace/
lease identities and exact per-member descriptors and digests; explicit `[]`
means repository-free completion. Singular completion workspace/Git/integration
fields are forbidden. Integration input is required exactly for isolated members.
Success carries `completion_outcome` and the complete sorted `workspace_results`.
Every member retains its immutable `capture` (start, private Node commit/tree).
Finalized members also carry Git commit/tree and, when isolated, integrated proof.
A conflict parent advances no Task head and carries no item Git fields; all captures
survive, including clean unpublished siblings without individual integration proof.
The exact `CompletionSettlement` pair binds the original parent/digest and can
settle finalized, conflict or cancelled results. Generated Go marshaling preserves
explicit empty input/result collections instead of dropping them as absent.

Source proofs and result reads select the exact parent plus resource, capture and
completion outcome. `TaskLocalResult.git_results[]` keeps one Node manifest with
all repository results; content queries additionally require `resource_id`.
Publication filters bind resource identity to their cursor. Delivery evidence uses
plural `sources[]`, and Rework exposes exact `stop_operation_ids[]`. Shared TS/Go
fixtures validate shapes; retained identity, complete membership, source and lease
checks remain mandatory in trusted consumers and SQL.

HTTPS Git access uses `RepositoryAccessResult`, exact resource-bound endpoint and
provider metadata. `RepositoryAuthentication` is anonymous, a GitHub installation
grant, or `https_basic` with bounded username/token and a short local-use deadline.
Credential configuration responses expose only safe scope/generation status and
immutable receipt attribution; no secret appears in snapshots or delivery proofs.
`PublicationPermissionProof.kind` separates actual GitHub grants from recorded
HTTPS configuration. Plain scans have `provider_blob_limit:null` and
`workflow_write:not_applicable`; these values do not establish remote permission.

Provider-neutral push/access/ref/published records use `provider_metadata`, with
no fabricated GitHub numeric ID. Fresh `PublicationRefReadRequest/Response` frames
bind their correlation/incarnation, complete original push and digest, exact
observation and worker absence. They cannot reuse an old push result as a new
observation. Push requests reserve 32 KiB inside the 512 KiB publication frame
budget, leaving space for a full fresh-ref echo and bounded observation. Enforce
the 480 KiB push limit both directly and inside push/ref-read frames, accounting
for Go JSON escape expansion as well as nested encoded paths and Unicode;
repository/inspection access responses retain
a 16 KiB service-only limit. Modified delivery members discriminate `github_pr` and `git_branch`;
plain members forbid PR/check/merge fields. Final progress distinguishes
`github_merge` and `git_branch`, with plain `checks:not_applicable`. Shared
[plain Git fixtures](../../../packages/protocol/fixtures/plain-git.json) preserve
these differences in TS and Go. Retained authority, credential scope, current
connection and actual absence still require trusted consumer checks.

| Condition | Result |
| --- | --- |
| Unsupported schema version | Reject before dispatch/admission |
| Null/unknown/irrelevant field | Schema validation failure |
| Unsafe or fractional counter | Validation failure |
| Unicode payload exceeds encoded byte budget | Reject before dispatch admission |
| Success result includes `failure_kind` | Validation failure |
| `runtime_failure` on output/attention/started/capture events, an unknown value or null | Validation failure |
| Cursor without snapshot, or snapshot without cursor | Validation failure |
| Snapshot changes between pages | HTTP 409 `version_conflict`; discard partial scan |
| Duplicate/conflicting page records or cursor loop | Deduplicate exact records; reject conflicts/loops without releasing ownership |

## 5. Good / Base / Bad Cases

Good: three long Unicode prompts cross a page boundary; the Runner collects all pages and preserves all claims.
Base: matching generated TS/Go validators accept the same shared fixture.
Bad: a Go struct silently ignores a field, or one partial recovery page is treated as the complete live-process set.

Terminal proof: typed `exited` and `process_absent` remain usable in either
delivery order; an ordinary untyped exit never becomes a native failure by
examining its text or exit code.

## 6. Tests Required

Run `pnpm protocol:check` and `pnpm test`, then `go test ./...` from `runner`. Shared [validation](../../../packages/protocol/fixtures/validation.json) and [canonicalization](../../../packages/protocol/fixtures/canonicalization.json) fixtures cover versions, optional/null fields, unknown members and stable UTF-8 content.

Real [PostgreSQL tests](../../../apps/server/test/postgres.test.ts) exercise Unicode/operation pagination, stale snapshot restart, preserved receipt reads, event reordering and typed failure recovery. Producer and consumer tests must agree after regeneration. Quicktype may rename existing Go enums when another definition introduces the same field/value; compile every Runner consumer after adding schemas, even when existing wire values are unchanged. Distinct backend/Runner roots and verified TLS still require real deployment evidence.

Runtime-failure fixtures must accept the field on both terminal kinds and reject
null, unknown values and nonterminal kinds in TS and Go. Verify exact replay and
both terminal delivery orders against backend continuation guards; capture or an
already admitted formal outcome must not acquire new fallback authority.

## 7. Wrong vs Correct

Wrong: edit generated Go fields or return the first 1000 rows as a complete inventory.
Correct: edit the versioned schema, regenerate both consumers, and use bounded pages with explicit completeness and snapshot conflict handling.

Wrong: serialize `runtime_failure` on arbitrary output because a log resembles an
error. Correct: generate the restricted terminal field from the trusted Runner
contract and preserve the same immutable evidence through recovery.
