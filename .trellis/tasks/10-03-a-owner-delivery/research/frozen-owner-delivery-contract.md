# Frozen Owner delivery contracts

Authority: `packages/protocol/schemas/v1/contracts.json`; generated TS/Go/OpenAPI follow
`pnpm protocol:generate`. Existing historical definitions retain their meaning.
Implementation coordination snapshot: 2026-10-05. Source schema and generated outputs
are settled. See the scoped validation evidence below before relying on a claim.

## Envelope and receipts

`OwnerDeliveryCommand` requires `schema_version:1, task_id, request_id, name, payload`.
No `scope_id`. Optional `expected_control_version` is transport compatibility only;
frozen Retry/Cancel authority is its batch digest/version, never later chat control.

| name | exact payload |
| --- | --- |
| prepare_delivery_acceptance | basis: DeliveryAcceptanceBasis |
| confirm_delivery_acceptance | proposal_id, content_digest |
| accept_delivery | proposal_id, confirmation_id, content_digest, basis |
| retry_delivery | operation_id, content_digest, expected_version |
| cancel_delivery | operation_id, content_digest, expected_version |

`DeliveryAcceptanceBasis` requires `control_version, specification_id, plan_id`.
Plan is nonnull for review acceptance. Counters use existing safe Counter/PositiveCounter.
Unknown/null/irrelevant payload members fail. All committed results require name.
`OwnerDeliveryCommandResult` always requires `schema_version, task_id, request_id,status`.

| committed name | required exact outcome fields |
| --- | --- |
| prepare | proposal_id, content_digest |
| confirm | proposal_id, confirmation_id, content_digest |
| accept | proposal_id, confirmation_id, operation_id, content_digest, operation_version, input_cutoff |
| retry / cancel | operation_id, content_digest, operation_version |

The full names match the command table. Irrelevant outcome fields are forbidden.
`status:unknown` forbids name and every outcome field. Committed admission is not
remote completion. All content digests bind the same complete accepted manifest.

## Manifest

`DeliveryAcceptanceManifest` requires `schema_version:1, task_id, basis,
specification_digest, plan_digest, outputs, repositories`.

`DeliveryOutputEvidence` requires `node_id,node_activation,completion,
completion_manifest_digest,effective_basis,effective_basis_digest,artifacts,
repository_free`. `completion` is original `CompletionManifest`; current activation
is independent from its historical activation. `effective_basis` is existing
`PublicationEffectiveBasis`. `artifacts` is selected immutable `ArtifactMetadata[]`,
not content bodies. Each Artifact retains its actual immutable Attempt/Specification/Plan
attribution; an earlier Attempt artifact is eligible when the selected canonical metadata
belongs to the same Task/Node/original activation. It is not rewritten to the completing
Attempt. Repository-free forbids `source/source_digest`; Git requires
real `ResultReadIdentity` and its digest. Original/effective identities are frozen;
server revalidates exact real canonical carry chain, without invented carry records.

`DeliveryRepository` requires `outcome:no_change|modified,resource_id,
repository_identity,provider_metadata,source,source_digest,effective_basis,
effective_basis_digest,preparation_request,preparation_request_digest,
preparation_result,preparation_result_digest`. It uses existing exact publication
request/result shapes and provider-neutral `RepositoryProviderMetadata`.

No-change requires terminal `preparation_result.status:not_applicable,reason:no_change`
and forbids every modified-only field. Modified requires additionally:

- `item_id,candidate,candidate_manifest_digest,scan,scan_digest`;
- `permission_proof,permission_proof_digest` (actual existing proof);
- `waivers:PublicationOverrideProof[]` (actual exact receipt/confirmation/selection proofs);
- `target_branch,delivery_ref,marker,remote_preparation`;
- `provider_content:RemotePreparationContent,provider_content_digest`.

Modified result status is `prepared|mapped`, scan status is complete and includes
the actual required `workflow_changes` boolean. Optional
`merge_method:merge|squash|rebase`; absent freezes default preference. Optional paired
`mapping/mapping_digest,published/published_digest`, and existing exact `review`.
Mapped zero-new-commit stays modified. Schema collections preserve provider-neutral
shape; backend rejects unsupported Stage A modes before consuming confirmation.

## Reads and progress

`DeliveryProposalSummary`: proposal_id,content_digest,basis,expires_at,current;
optional confirmation_id. `DeliveryProposalDetail`: schema_version,task_id,proposal,
manifest. Detail hydration verifies digest and exact membership.

`DeliveryBatchSummary`: operation_id,content_digest,version,status,input_cutoff,
accepted_at,modified_items,finalized_items,retry_allowed,cancel_allowed; optional reason.
Status: active|waiting|failed|reconciling|attention|completed|cancelled.

`DeliveryItemProgress`: item_id,resource_id,status,accepted_head,checks; optional
reason, paired operation_id/operation_digest/operation_kind/operation_state,
merge_method,review,observed_base,test_merge_head,final_commit,finalized_at,cooldown_until.
Item status: pending|preparing|waiting_checks|ready|merging|reconciling|failed|attention|
finalized|cancelled. Checks: unknown|pending|passing|failing. Finalized requires exact
final_commit/finalized_at. Operation kinds: push|create_pr|update_pr|close_pr|merge.
States: pending|started|unknown|failed|succeeded|cancelled.

`DeliveryBatch`: schema_version,task_id,batch,proposal_id,confirmation_id,
admission_request_id,manifest,items. `OwnerDeliveryStatus`: schema_version,task_id,
basis,accept_allowed,proposals,proposals_has_more,batches,batches_has_more; optional
reason and paired accepted_delivery_operation_id/accepted_delivery_input_cutoff.
Status basis is `DeliveryReadBasis` with control_version/specification_id and nullable
plan_id; admission/manifest `DeliveryAcceptanceBasis.plan_id` stays nonnull. Status
is readable while planning with disabled not_review/no_plan, not a fabricated Plan.
Safe status reason codes: not_review,no_plan,accepted,terminal,unsupported_mode,
input_pending,work_unsettled,source_changed,configuration_changed,permission_unknown,
expired_permission,scan_incomplete,findings_blocked,known_public_exposure,
retained_unavailable,identity_mismatch,possible_publication,reconciliation_required,
authority_invalid. Status carries summaries, not duplicate full proposal and batch manifests.

`OwnerDeliveryHistoryQuery` has only optional `proposal_cursor,batch_cursor`, each an
unpadded base64url string of 1..2048 characters. Status requires the corresponding
`next_proposal_cursor` / `next_batch_cursor` exactly when that list has_more is true,
and forbids it when false. Each cursor decodes strict canonical JSON
`{v:1,task_id,kind:proposals|batches,created_at:UTC-six-fractional-digits,id}`. The
backend validates calendar, Task/kind, canonical bytes and stable keyset ordering;
wrong scope is denied_scope, malformed/noncanonical is invalid_input. Separate
64-row continuation pages never grant action authority or replace the accepted pointer.
`TaskOverview` adds the same paired optional accepted fields. Conversation types
remain unchanged; accepted input attribution already exists.

## Bounds and completeness

Outputs: 1..256 (Plan cap). Selected artifacts: 0..256 per output. Repositories and
progress items: 0..64. Waivers: 0..4096 (scan finding cap). Summary lists: 0..64 with
explicit has_more. Complete acceptance membership is sorted and verified by server;
JSON Schema cannot establish cross-row correspondence, canonical order or digest truth.
Every Delivery*/OwnerDelivery* value is limited to **512 KiB encoded UTF-8 JSON**,
including the complete manifest and its detail wrapper; all strings must be well-formed
Unicode. Keep wrapper space by rejecting oversize at proposal/acceptance admission;
never clip required evidence. Full Artifact bodies/Specification/Plan text stay on
existing authenticated detail routes. Existing nested source/body limits also apply.

Go fixture validation checks schema parity; these Owner-only encoded read bounds
are enforced by TypeScript producer/consumer validation, not a new Runner transport.
Generation may rename Go enum symbols; compile all Runner consumers after settlement.

## Endpoints

POST `/v1/owner/tasks/delivery/commands`.
GET `/v1/owner/tasks/{task_id}/delivery`.
GET `/v1/owner/tasks/{task_id}/delivery/proposals/{proposal_id}`.
GET `/v1/owner/tasks/{task_id}/delivery/batches/{operation_id}`.
GET `/v1/owner/tasks/{task_id}/delivery/commands/{request_id}`.
Owner authentication/session header/Origin/no-store/receipt-first behavior belongs to
actual server routes; schema generation is not evidence those routes exist.

## Scoped validation evidence

- `pnpm protocol:check`: **PASS**, main 2026-10-05 15:10 after history generation, including TypeScript,
  Go schema/types and OpenAPI paths. Generated files were produced from source only.
- `pnpm exec vitest run packages/protocol/test/protocol.test.ts packages/protocol/test/owner-delivery.test.ts`:
  **305 PASS**, 2026-10-05 15:11:23 local after the history extension. New shared schema cases cover exact command/
  receipt bindings, unknown outcomes, original/effective activation, repository-free/
  no-change/mapped distinction, actual permission/workflow facts and nullable read basis.
  Four focused tests cover encoded Unicode limit, valid bounded evidence, malformed
  Unicode and complete output collection cap.
- `pnpm exec eslint packages/protocol/src/validation.ts packages/protocol/test/owner-delivery.test.ts --max-warnings 0`:
  **PASS** on the final owned executable TypeScript inputs.
- From `runner`, Go 1.27.1 `go test ./... -run '^(TestSharedSchemaFixtures|TestSharedCanonicalFixtures|TestSharedCompletionIdentityFixtures)$' -count=1`:
  **PASS**, 2026-10-05 15:30 after history extension, across all consumer packages and shared wire fixtures. Initial compile
  identified generated enum naming collision at daemon attention; main changed its
  consumer to `protocol.RuntimeEventKind("attention")`, retaining exact wire value.
  Final compile is after that concrete repair and final regeneration.
- Scoped `git diff --check`: **PASS**. Only pre-existing definition changed is the
  approved optional paired TaskOverview acceptance pointer; 15 definitions are added, including strict history queries and next-cursor conditions.
- No full native/host/race/provider suite or real effects: no owned Runtime behavior,
  provider authority or migration changed. Real SQL/admission/provider/Web claims
  remain the implementation owners' integration gates.

Frozen schema SHA256: `2f17d24b9ba4391e78b6f4a09b4d5cf59713b256c0e9f10cdeca0ce41a51bcc9`.
Shared fixtures SHA256: `3ec0f70742352542f1e4cafc8a8d71e417f891c8cb05a58ef4b3f19254aef3ed`.
Later edits to these inputs invalidate only their affected checks.
