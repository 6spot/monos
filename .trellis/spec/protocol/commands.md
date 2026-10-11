# Command, Identity and Replay Contracts

Source: [Tool Protocol](../../../docs/05-tool-protocol.md).

## 1. Scope / Trigger

Owner HTTP(S) commands, Agent `monos` commands, Runner WS(S) RPC/events and scoped recovery reads. Transport selection follows [optional HTTP/TLS](transport.md); envelopes and authorization are unchanged.

## 2. Signatures

Implemented probe envelope from [contracts.json](../../../packages/protocol/schemas/v1/contracts.json):

```text
schema_version=1, request_id, name, scope_id, payload
expected_control_version (required in this probe)
server-authenticated binding:
  attempt_id, fencing_generation, node_activation?
```

`POST /v1/commands` receives `CommandSubmission { envelope_json, sha256 }`. `GET /v1/commands/:request_id` reads the authenticated Attempt's receipt. Runner recovery uses `/v1/recovery/attempts/:attempt_id/commands/:request_id` or `/v1/recovery/operations/:operation_id`; its service credential never permits Agent command admission.

The bundled [monos](../../../runner/cmd/monos/main.go) supports immutable retry/status, `open_workspace`, `inspect_repository`, `complete_node` and `commit_task_turn`. Consult its help and the [protocol README](../../../packages/protocol/README.md) for exact CLI argument syntax. Task-scoped Owner confirmation, Stop and recovery use separate Owner routes described in [Owner commands](../backend/owner-commands.md); delivery execution remains separate work.

## 3. Contracts

Canonical Node execution adds `publish_artifact`, `read_artifact`, `block_node`,
`Dispatch.node_execution_source`, explicit repository-free completion and exact
`settle_completion` pairs. See [Node execution](../backend/node-execution.md) for
strict payloads, omitted/empty Artifact selection and canonical Owner controls.

Canonical Task Conversation adds `Dispatch.task_conversation_source`,
`read_task_context`, `read_task_history` and source-bound `commit_task_turn` with
routing kind `reply` or exact action basis. Its envelope version binds conversation
authority; execution mutations separately validate current control/Spec/Plan/Node.
Reply-only observations survive unrelated Node progress. Node completion version2
manifests include explicit handled guidance IDs; version1 digests remain unchanged.
See [Task Conversation](../backend/task-conversation.md) for strict scopes and
independent Owner input controls.

- Schemas/versioned generated types own wire fields; domain services own transitions.
- Backend derives caller identity and scope. Owner flags, socket paths and claimed Attempt IDs cannot grant authority.
- Owner, Runner and Attempt credentials are separate. Never expose secrets in logs/prompts/arguments.
- Same principal/scope/request ID and digest replay the existing result; changed command/payload conflicts.
- Authenticated receipt lookup precedes new-effect version checks.
- Return committed result, admitted operation or deterministic error distinctly.
- Canonical workspace operations bind an immutable descriptor/digest and physical
  lease. A cancelled never-materialized open projects its original receipt as an
  error linked to the exact admitted Stop; `cancelled` is terminal for recovery
  queues. Stop-only recovery of initialized work carries paired old-target
  provenance, never an assertion that a failed fetch refreshed the repository.
- Retry loads the immutable original payload; no mutable-file reread or new ID after uncertainty.
- Revoked Attempts cannot make new effects. Scoped recovery reads never renew old mutation authority.
- Current-run envelopes, digests and process identities remain exact. `monos` is the current CLI and `MONOS_SOCKET` its local-channel setting; historical raw evidence retains original bytes. Follow the [pre-use development policy](../../../docs/12-product-naming-and-upgrades.md): old development versions need no storage/wire migration support; validate the current version with fresh scoped state when needed.
- Authenticate the signed Attempt identity's exact fields/types and expiry, not only its signature. Reject malformed, padded or trailing credential encodings as `unauthorized`.
- Canonical envelope input rejects malformed Unicode instead of hashing a replacement string differently in TS and Go.
- Complete every inventory page under the same snapshot before reconciliation; a partial page never proves process absence.
- Owner acceptance serializes with message admission; later conversation cannot route execution changes into the accepted batch.
- Owner execution commands bind Task, Attempt, control version and, for Nodes,
  activation. A queued Stop commits without an operation; a running Stop returns
  a stable admitted operation. Legacy Continue/Retry requires verified process
  absence, physical release and settled effects. Canonical source-aware controls
  may save a successor intent while cleanup is pending, but never promote before
  those same physical conditions hold. The Owner command receipt is immutable;
  the scoped operation read reports later settlement or recovery attention.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Caller outside scope | Denied, including receipt reads |
| Terminal/stale Attempt, new request | Stale execution |
| Authorized prior receipt lookup | Existing result, no new effect |
| Same ID with changed payload | Conflict |
| New request on stale control basis | Version conflict |
| Unsupported required schema semantics | Reject/upgrade |
| Accepted asynchronous command | Return stable operation reference |
| Inventory snapshot changed | `version_conflict`; restart all pages without releasing ownership |
| Malformed signed credential | `unauthorized`, not an internal error |
| CLI journal write fails | Do not send HTTP(S) |
| Receipt missing but send uncertain | Preserve uncertainty; reconcile |

## 5. Good / Base / Bad Cases

Good: completion stops its CLI; Runner reads the admitted result through its own recovery scope.
Base: transport retries return the same operation.
Bad: trusting an environment Attempt ID or retrying with a fresh current version.

## 6. Tests Required

Use common TS/Go fixtures for versions, optional/null fields and malformed messages. Assert replay/conflict, stale authority, concurrent same-UID CLI attribution, lost response, changed input file, journal failure and expired-credential recovery. Real Linux/CLI tests are required for the socket/cgroup/permission boundary.

Backend coverage: [auth.test.ts](../../../apps/server/test/auth.test.ts), [app.test.ts](../../../apps/server/test/app.test.ts), [postgres.test.ts](../../../apps/server/test/postgres.test.ts) and [postgres-owner-execution.test.ts](../../../apps/server/test/postgres-owner-execution.test.ts). They exercise strict authentication, queue/disconnect behavior and real database admission/recovery. The shared schema corpus lives in [validation.json](../../../packages/protocol/fixtures/validation.json).

## 7. Wrong vs Correct

Initial Task planning adds source-bound `publish_execution_plan` and
`raise_planning_issue`, strict `ExecutionPlanNode` definitions and
`EffectResult.planning_outcome`. Optional `Dispatch.task_planning_source` is
Task-Planner-only with empty canonical reservations. A legacy Planner kind does
not imply this authority. Source-targeted Owner Start/Stop/Retry/Cancel and scoped
read contracts are documented in [Task planning](../backend/task-planning.md).
Keep the historical attempt-targeted Stop/Retry variants. Preserve optional Node
arrays as absent versus empty across JSON -> TS -> Go -> immutable Plan storage;
regeneration must retain the explicit Go marshaling rules.

Wrong: transport timeout -> generate request ID -> repeat effect.
Correct: retain original envelope -> read receipt -> explicitly retry under still-valid authority.

Execution UI adds `TaskListQuery/TaskListPage`, `TaskResultPage` and
`AttemptWorkspaceStatus` projections plus authenticated `OwnerSessionStatus.session_id`.
See [Owner reads](../backend/owner-reads.md) and [Owner access](../backend/owner-access.md)
for exact fields, encoded bounds and session-header validation. These reads do not
introduce Owner command names, authorization states or completion timestamps.

Exact delivery uses dedicated `OwnerDeliveryCommand` and per-action receipts in
[Owner delivery](../backend/owner-delivery.md). Preserve exact proposal/confirmation/
basis and batch/digest/version variants. Unknown receipts contain no committed IDs.
`Delivery*`/`OwnerDelivery*` enforce 512 KiB encoded bytes and well-formed Unicode.
Summaries omit manifests; details are selected reads. History uses separate bounded
proposal/batch cursors and conditional next fields. Generated Go enum collisions
must preserve actual wire values/types and compile affected consumers.

Review correction uses `OwnerReviewCommand` with `request_changes`,
`retry_review_feedback`, `withdraw_review_feedback`, `retry_review_input` and
`withdraw_review_input`; every committed action binds actual feedback/operation/
capability, and input variants bind reconsideration. Request Changes alone carries
the exact local result digest and optional exact accepted batch; server admission
requires that batch iff current. Unknown receipts contain no committed IDs.
`TaskReviewSource` is mutually exclusive with all other dispatch sources and adds
purpose `route_feedback|reconsider_input`; only the second carries paired input and
reconsideration IDs. Transport watermark/activation is zero, reservations are empty
and source control matches dispatch. New tools are `apply_review_rework`,
`commit_review_feedback`, `resolve_review_input`, plus the strict review issue
variant. Their source/op IDs and op version cannot be replaced by control version.
`request_replan` retains reason-only payload and genuine launch authority.
Review families enforce 512 KiB encoded UTF-8/well-formed Unicode and 64 KiB raw
feedback text in TS/Go. Requirement detail exposes paired review source/operation
IDs; Replan exposes actual review feedback/predecessor/successor. Delivery adds
`revoked`, selected detail `revocation` and separate item `reconciliation` facts.
See [review correction](../backend/review-correction.md) for signatures, SQL,
error matrix and required authority/race checks.

Canonical Node envelope control binds its immutable `node_execution_source`, while
Owner execution commands retain live Task CAS. Initial Plan transport supports
1..256 Nodes with dependencies; backend validates DAG completeness and current Roles.
`SpecificationImpact` transports up to 256 Node observations, without granting
multi-Node requirement-publication authority. `WorkspaceTransfer.purpose: serial`
permits completed same-Plan handoff and forbids Replan provenance fields; absent
purpose still requires the genuine Replan proposal and publication pair.

Upstream `request_rework` is canonical Node-only in both backend and the Runner
local socket allowlist; CLI command recognition alone does not grant transport
authority. Its payload is reason plus optional ancestor target, with bounded
`NodeReworkOutcome`. Owner `apply_rework` / `continue_without_rework` use the existing
Owner envelope with exact request/version and optional answer. Unknown receipts
cannot carry `rework_outcome`; consumers validate the actual request, decision,
version and budget instead of accepting a generic committed response.

System-authored `WorkspaceTransfer.purpose: rework` requires checkpoint metadata,
the original Rework/Agent request pair and complete activation map, and forbids
Replan provenance. `WorkspaceDescriptor.rework_history` carries separately proven
historical checkpoints, so later serial handoff retains the current integrated
commit while restoring read-only historical Git references. Shared TS/Go fixtures
must reject absent checkpoint/provenance and serial/Rework identity mixing.
