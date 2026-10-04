# Publication contract freeze v1

2026-10-03. Protocol source: `packages/protocol/schemas/v1/contracts.json`.
This file resolves names/ownership before dependent Runner/Web implementation.

## Identity and digest algorithm

All `*_digest` fields are lower-case SHA256 over UTF-8 RFC8785 canonical JSON,
using existing protocol `canonicalJSON` / Runner `wire.CanonicalRaw`.
No secret, matching value, token or free-form stderr belongs in any record.

- `source_digest`: entire original `ResultReadIdentity` unchanged.
- `effective_basis_digest`: `PublicationEffectiveBasis {task_id,specification_id,
  plan_id,completion_operation_id,completion_manifest_digest}`. Original and
  effective revisions are separate; exact canonical carry determines authority.
- `PublicationParent`: kind `materialization|target|published`, commit,
  repository_identity, observation_operation_id, exact WorkspaceDescriptor,
  original raw successful EffectResult, observation_digest. Observation digest
  covers `{operation_id,workspace,outcome}` (omit observation_digest itself).
  Materialization must resolve the original successful Basis-absent open,
  not the completion's later OpenOperationID. Runner verifies journal/pin/cache
  provenance. Target requires exact verified observation plus integrated source
  ancestry; production published parent is unavailable until reconciliation leaf.
  Production admission in this leaf freezes the materialization base parent only.
  Optional verified target construction is a supported explicit Runner proof seam;
  no backend observation transport or implicit integration claim is introduced.
- `PublicationConstruction`: schema_version, construction_id, candidate_id,
  source_digest, repository_identity, target_branch, ordered parent descriptors,
  author_name=`monos`, author_email=`monos@localhost`, timestamp=`<10-digit Unix
  seconds> +0000`, message=`monos Task <task UUID> result v1`.
  construction_digest hashes the entire construction. Construction/candidate IDs,
  metadata, parent order and reference remain identical across scan retries.
- `PublicationPrepareRequest`: schema_version, operation_id, scan_run_id, source,
  source_digest, effective_basis/effective_basis_digest, construction/
  construction_digest, configuration/configuration_digest. Request digest hashes
  the entire request (no request_digest self-field). It is independent of socket
  incarnation. A terminal incomplete retry creates new operation/scan_run IDs
  while reusing exact construction; interrupted recovery sends identical request.
- `PublicationCandidateManifest`: schema_version,candidate_id,construction_id,
  construction_digest,source_digest,head,tree,ordered `parents` OIDs.
  candidate_manifest_digest hashes entire manifest; tree equals source.git_tree.
- `PublicationScanSummary`: schema_version,scan_id (=scan_run_id),
  candidate_manifest_digest,configuration_digest,status `complete|incomplete`,
  reason only when incomplete, coverage {commits,paths,versions,unique_blob_bytes},
  findings_count,findings_bytes,findings_digest. scan_digest hashes entire summary.

## Pinned scan policy

`PublicationScanConfiguration` has policy_version=`local_publication_v1`,
rule_version=`credential_rules_v1`, traversal_version=`all_parents_final_tree_v1`,
local_blob_limit=50MiB, provider_blob_limit=100MiB (provider hard finding when >),
max_commits=256,max_paths=8192,max_versions=32768,max_blob_bytes=128MiB,
max_aggregate_bytes=512MiB,max_findings=4096,max_evidence_bytes=8MiB,
deadline_seconds=120,workflow_write=`unknown`,permission_fingerprint.
Tests may lower bounded processing/local-policy values. Production grants no
workflow permission; fingerprint binds relevant repository/App/installation/key
configuration without a token or ciphertext. No provider permission observer here.

`PublicationFinding` requires finding_id,kind,rule_id,scope (`publication_commit|
final_tree`),commit,path,override_eligible,message. Optional exact blob,
content_digest,size,limit,baseline_commit where relevant. finding_id hashes canonical {candidate_manifest_digest,configuration_digest,
scan_run_id,finding_facts_without_id}; no circular scan_digest. Every finding
requires occurrence_ordinal (stable opaque ordinal) and path_redacted. Finite credential
rules also inspect filenames: matching path is the fixed literal
`[redacted credential path]` with path_redacted=true; do not persist raw sensitive
path or a path/matching-value hash. Baseline attribution uses baseline_path and
baseline_path_redacted with the same rule. Public baseline identical blob lookup
matches at ANY path, not just the new path. Exact paths remain private Git data. Fixed safe message enum is in schema.
Kinds: tracked_ignore,publication_policy_size,provider_hard_size,
credential_pattern,published_credential,workflow_permission.
Provider hard/workflow/published credential are always noneligible.
Published credential applies to ANY scanned version with identical blob present
at ANY path in verified baselines. It additionally requires baseline_commit/baseline_path/baseline_path_redacted/blob/content_digest;
known exposure is not erased by candidate deletion or normal waiver. Ordinary
credential findings require full blob content digest and redact matching values.
Local size/provider size require size/limit/blob. No matching-value hashes/snippets.

## Durable pages / WSS

Ready adds optional `publication_modes:["local_candidate_v1"]`.
Dedicated Frame types/fields: `publication_prepare:PublicationPrepareRequest`,
`publication_result:PublicationResultPage`, `publication_ack:PublicationACK (schema name PublicationAck)`.
Only schema_version,type,incarnation and that payload field are permitted.
Each frame ≤512KiB encoded (including wrapper); preparation/result processing
uses an independent two-worker Runner lane and no Attempt/Runtime capacity.

`PublicationResult` repeats operation_id/request_digest and status:
prepared (candidate, candidate_manifest_digest,scan,scan_digest required),
not_applicable (reason=no_change, no candidate/scan), unavailable or
reconciliation_required (typed reason, no candidate/scan).
`PublicationResultPage` has schema_version,result,page_index (zero based),
page_count (>=1),findings (<=64),page_digest. Page digest hashes canonical findings
array. Full findings are ordered pages flattened; findings_digest hashes that
canonical entire array, findings_bytes is its UTF8 length (empty [] is 2 bytes).
One empty page is required for zero findings/nonprepared outcome. Every page
repeats identical result summary. Different pages may arrive in any order;
exact duplicate pages replay, conflicting duplicate rejects. Persist page assembly
separately; no complete result/candidate/scan settlement before all pages, exact
counts/digests/bytes/IDs and source/tree/parents/config echoes validate. At most
4096 findings and8MiB; overbudget is incomplete, never truncated complete.

Backend validates authenticated owning Runner/current instance/incarnation before
accepting each page; connection holds scope. Backend atomic final persistence then
acks `{schema_version,operation_id,request_digest,result_digest}` where result_digest
hashes canonical PublicationResult. Response/ack loss safely replays pages. Restart
reconciles durable pending operations independently of Attempt inventory. Cancel or
changed authority suppresses new dispatch; late exact replies can persist history
without restoring current. No DB transaction spans Runner/provider I/O.

## Exported names / backend integration

Generated TS/Go types have identical names: PublicationEffectiveBasis,
PublicationParent,PublicationConstruction,PublicationScanConfiguration,
PublicationPrepareRequest,PublicationCandidateManifest,PublicationFinding,
PublicationCoverage,PublicationScanSummary,PublicationResult,PublicationResultPage,
PublicationACK (schema definition PublicationAck),PublicationRecord,PublicationCandidatePage,PublicationFindingPage,
PublicationCandidateQuery,PublicationFindingsQuery,PublicationCommand,
PublicationCommandResult.

Server class `PublicationPreparation(db,instanceId)` exports `pump()`,
`pending(runnerId,incarnation,supported)`, `finish(runnerId,incarnation,page)`.
Canonical transaction resolver `resolveCanonicalResult(tx,taskId,operationId?)`
returns original identity, item projection,current flag and effective basis.
Nullable item is admitted before actual Runner base/result tree comparison;
not_applicable creates no delivery item. Stable task/resource lock serializes work.

## Owner reads and exact commands

All authenticated no-store/nosniff and existing X-Monos-Session checks:

- GET `/v1/owner/tasks/:task_id/publication-candidates`
  PublicationCandidateQuery {source_operation_id?,cursor?}; returns
  PublicationCandidatePage {schema_version,task_id,items<=32,next_cursor?}.
  Includes operations with no candidate yet. Canonical task/source scoped cursor.
- GET `/v1/owner/tasks/:task_id/publication-candidates/:candidate_id`
  returns PublicationRecord for direct older candidate (latest scan operation).
- GET `/v1/owner/tasks/:task_id/publication-candidates/:candidate_id/findings`
  PublicationFindingsQuery {scan_digest,cursor?}; returns PublicationFindingPage
  {schema_version,task_id,candidate_id,scan_digest,items<=64,next_cursor?}, ≤512KiB.
- POST `/v1/owner/tasks/publication/commands`: PublicationCommand ->
  PublicationCommandResult. GET
  `/v1/owner/tasks/:task_id/publication/commands/:request_id` recovers same receipt.

PublicationRecord includes operation_id,request_digest,original source/source_digest,
effective_basis/effective_basis_digest,status (pending|preparing|offline|unsupported|
prepared|not_applicable|unavailable|reconciliation_required),optional candidate/
manifest digest/scan/scan digest,current,scan_applicable,retry_allowed,
override_allowed,override_receipt_ids,remote_preparation and safe reason.
Current derives exact canonical source + effective basis; scan_applicable also
requires current relevant policy/config/permission. Client labels grant no authority.

PublicationCommand always schema_version,task_id,request_id,name,payload:

1. retry_publication_preparation payload {operation_id,operation_digest}.
   Interrupted pending resumes same operation; terminal incomplete gets new run
   over same construction/candidate, preserving terminal history.
2. prepare_publication_override payload {candidate_id,candidate_manifest_digest,
   effective_basis_digest,scan_digest,finding_ids} (sorted exact unique IDs,1..64).
   Returns proposal_id/content_digest; stores exact authenticated scope/basis.
3. confirm_publication_override payload {proposal_id,content_digest}.
   Uses existing Owner proposal authorization rules; returns confirmation_id.
4. override_publication_findings payload same exact selection plus confirmation_id.
   Atomically checks entire eligible current complete selection, consumes exact
   confirmation, stores immutable receipt_id. Mixed hard/eligible rejects all.

No accepted-delivery fields change. Replay checks immutable prior request before
new-effect staleness checks. Receipts never erase findings or authorize writes.

## Finite credential rules v1 and rule IDs

Byte patterns shared by Scanner and independent backend path guard: PEM header
`-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`; classic
`gh[pousr]_[A-Za-z0-9]{36}`; fine-grained `github_pat_[A-Za-z0-9_]{22,255}`;
AWS `(AKIA|ASIA)[A-Z0-9]{16}`. Detection need not match whole string. Streaming
uses512-byte overlap; maximum pattern width266 bytes. Rule IDs are schema enum:
tracked_ignore,policy_blob_size,provider_blob_size,workflow_permission,
pem_private_key,github_classic_token,github_fine_grained_token,aws_access_key.
Published credential retains original credential rule ID. No arbitrary label.

## Persistent known-public exposure guard (2026-10-04)

PublicationRecord requires known_public_exposure_count, derived as distinct
(baseline_commit,blob,content_digest,credential_rule_id) facts from ALL immutable
published_credential findings across that exact Task/resource/repository item.
Preparation with nullable item resolves the same existing item scope. Later clean
scans/new candidate/source/no-change do not clear it; it is a separate blocking
remediation guard, never a fabricated finding in the new scan. No remediation
setter exists in this leaf. Eligible override receipts cannot remove this guard.
History pages sort newest first by (created_at,id); canonical cursor carries last
operation ID and backend resolves its exact Task/source-owned timestamp.
