import type { DeliveryAcceptanceManifest, DeliveryBatch, DeliveryBatchSummary, DeliveryProposalDetail, DeliveryProposalSummary, DeliveryRepository, OwnerDeliveryHistoryQuery, OwnerDeliveryStatus, RemotePreparationReview } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError } from './api.ts';
import { publicationDigest, publicationEvidence, publicationProof } from './publication-api.ts';
import { taskRead } from './task-api.ts';
import { taskStorageEpoch } from './task-storage.ts';

function mismatch(): never { throw new APIError('invalid_response', 'Delivery evidence did not match the selected Task, approved version or batch.'); }
function fence(epoch: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (epoch !== taskStorageEpoch()) throw new DOMException('Owner session changed', 'AbortError');
}
function unique(values: string[]) { if (new Set(values).size !== values.length) mismatch(); }
function sameSet(left: string[], right: string[]) {
  unique(left); unique(right);
  if (left.length !== right.length || [...left].sort().some((value, index) => value !== [...right].sort()[index])) mismatch();
}
async function hash(value: unknown, expected: string | undefined) {
  if (!expected || await publicationDigest(value) !== expected) mismatch();
}
function counts(batch: DeliveryBatchSummary) {
  if (batch.finalized_items > batch.modified_items || batch.status === 'completed' && batch.finalized_items !== batch.modified_items || ['completed','cancelled'].includes(batch.status) && (batch.retry_allowed || batch.cancel_allowed)) mismatch();
}
function reviewIdentity(review: RemotePreparationReview, repository: DeliveryRepository) {
  const url = new URL(review.url);
  if (review.repository_id !== repository.provider_metadata.github?.repository_id || review.marker !== repository.marker || review.base_ref !== repository.target_branch || review.head_ref !== repository.delivery_ref?.replace(/^refs\/heads\//,'') || url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password || url.pathname !== `/${repository.repository_identity.replace(/^github\.com\//,'')}/pull/${review.pr_number}`) mismatch();
}

async function repository(repository: DeliveryRepository, manifest: DeliveryAcceptanceManifest) {
  const source = repository.source, request = repository.preparation_request, result = repository.preparation_result;
  if (source.task_id !== manifest.task_id || source.resource_id !== repository.resource_id || source.repository_identity !== repository.repository_identity || repository.effective_basis.specification_id !== manifest.basis.specification_id || repository.effective_basis.plan_id !== manifest.basis.plan_id || request.source_digest !== repository.source_digest || request.effective_basis_digest !== repository.effective_basis_digest || result.operation_id !== request.operation_id || result.request_digest !== repository.preparation_request_digest) mismatch();
  await Promise.all([publicationEvidence(repository, manifest.task_id), hash(request, repository.preparation_request_digest), hash(result, repository.preparation_result_digest), hash(request.source, repository.source_digest), hash(request.effective_basis, repository.effective_basis_digest)]);
  if (repository.outcome === 'no_change') return;
  const { candidate, scan, permission_proof: permission, item_id: item } = repository;
  if (!candidate || !scan || !permission || !item || result.candidate_manifest_digest !== repository.candidate_manifest_digest || result.scan_digest !== repository.scan_digest || request.permission_proof_digest !== repository.permission_proof_digest || scan.candidate_manifest_digest !== repository.candidate_manifest_digest || scan.configuration_digest !== request.configuration_digest || permission.resource_id !== repository.resource_id || permission.repository_identity !== repository.repository_identity || permission.repository_id !== repository.provider_metadata.github?.repository_id || permission.permission_fingerprint !== request.configuration.permission_fingerprint || scan.workflow_changes && permission.permissions.workflows !== 'write' || repository.delivery_ref !== `refs/heads/monos/task/${manifest.task_id}/${repository.resource_id}` || repository.marker !== `<!-- monos-delivery-item:${item} -->` || repository.target_branch !== request.construction.target_branch) mismatch();
  await Promise.all([hash(scan, repository.scan_digest), hash(permission, repository.permission_proof_digest), hash(request.permission_proof, repository.permission_proof_digest), hash(result.candidate, repository.candidate_manifest_digest), hash(result.scan, repository.scan_digest), hash(repository.provider_content, repository.provider_content_digest)]);
  for (const waiver of repository.waivers ?? []) {
    const selection = waiver.selection;
    if (selection.candidate_id !== candidate.candidate_id || selection.candidate_manifest_digest !== repository.candidate_manifest_digest || selection.effective_basis_digest !== repository.effective_basis_digest || selection.scan_digest !== repository.scan_digest || selection.mapping_digest !== repository.mapping_digest) mismatch();
    await hash(selection, waiver.selection_digest);
  }
  if (repository.published) await publicationProof(repository.published, repository.published_digest ?? '', repository);
  if (repository.review) reviewIdentity(repository.review, repository);
}

export async function deliveryManifest(manifest: DeliveryAcceptanceManifest, task: string, digest: string): Promise<void> {
  validate('DeliveryAcceptanceManifest', manifest);
  if (manifest.task_id !== task) mismatch();
  await hash(manifest, digest);
  unique(manifest.outputs.map(output => output.node_id)); unique(manifest.repositories.map(value => value.resource_id));
  for (const output of manifest.outputs) {
    const completion = output.completion, basis = output.effective_basis;
    if (completion.task_id !== task || completion.node_id !== output.node_id || completion.content_digest !== output.completion_manifest_digest || basis.task_id !== task || basis.specification_id !== manifest.basis.specification_id || basis.plan_id !== manifest.basis.plan_id || basis.completion_operation_id !== completion.operation_id || basis.completion_manifest_digest !== output.completion_manifest_digest) mismatch();
    await hash(basis, output.effective_basis_digest);
    sameSet(completion.artifact_ids, output.artifacts.map(artifact => artifact.artifact_id));
    for (const artifact of output.artifacts) if (artifact.task_id !== task || artifact.node_id !== completion.node_id || artifact.node_activation !== completion.node_activation) mismatch();
    if (output.source) {
      const source = output.source;
      if (source.task_id !== task || source.operation_id !== completion.operation_id || source.node_id !== completion.node_id || source.node_activation !== completion.node_activation || source.manifest_digest !== output.completion_manifest_digest || source.attempt_id !== completion.attempt_id || source.specification_id !== completion.specification_id || source.plan_id !== completion.plan_id) mismatch();
      await hash(source, output.source_digest);
    }
  }
  sameSet([...new Set(manifest.outputs.flatMap(output => output.source ? [output.source.resource_id] : []))], manifest.repositories.map(value => value.resource_id));
  for (const value of manifest.repositories) if (!manifest.outputs.some(output => output.source_digest === value.source_digest)) mismatch();
  await Promise.all(manifest.repositories.map(value => repository(value, manifest)));
}

export async function ownerDeliveryStatus(task: string, session: string, signal?: AbortSignal, query: OwnerDeliveryHistoryQuery = {}): Promise<OwnerDeliveryStatus> {
  validate('OwnerDeliveryHistoryQuery', query);
  const epoch = taskStorageEpoch();
  const status = await taskRead<OwnerDeliveryStatus>(task, '/delivery', 'OwnerDeliveryStatus', { ...query }, session, signal);
  if (query.proposal_cursor !== undefined && status.next_proposal_cursor === query.proposal_cursor || query.batch_cursor !== undefined && status.next_batch_cursor === query.batch_cursor) mismatch();
  if (status.accept_allowed && (!status.basis.plan_id || status.accepted_delivery_operation_id)) mismatch();
  unique(status.proposals.map(value => value.proposal_id)); unique(status.batches.map(value => value.operation_id));
  status.batches.forEach(counts);
  fence(epoch, signal); return status;
}

export async function ownerDeliveryProposal(task: string, expected: Pick<DeliveryProposalSummary,'proposal_id'|'content_digest'>, session: string, signal?: AbortSignal): Promise<DeliveryProposalDetail> {
  validate('Id', expected.proposal_id); validate('SHA256', expected.content_digest);
  const epoch = taskStorageEpoch();
  const detail = await taskRead<DeliveryProposalDetail>(task, `/delivery/proposals/${encodeURIComponent(expected.proposal_id)}`, 'DeliveryProposalDetail', undefined, session, signal);
  if (detail.proposal.proposal_id !== expected.proposal_id || detail.proposal.content_digest !== expected.content_digest || (['control_version','specification_id','plan_id'] as const).some(key => detail.proposal.basis[key] !== detail.manifest.basis[key])) mismatch();
  await deliveryManifest(detail.manifest, task, expected.content_digest);
  fence(epoch, signal); return detail;
}

export async function ownerDeliveryBatch(task: string, expected: Pick<DeliveryBatchSummary,'operation_id'|'content_digest'>, session: string, signal?: AbortSignal): Promise<DeliveryBatch> {
  validate('Id', expected.operation_id); validate('SHA256', expected.content_digest);
  const epoch = taskStorageEpoch();
  const detail = await taskRead<DeliveryBatch>(task, `/delivery/batches/${encodeURIComponent(expected.operation_id)}`, 'DeliveryBatch', undefined, session, signal);
  if (detail.batch.operation_id !== expected.operation_id || detail.batch.content_digest !== expected.content_digest) mismatch();
  counts(detail.batch);
  await deliveryManifest(detail.manifest, task, expected.content_digest);
  const modified = detail.manifest.repositories.filter(value => value.outcome === 'modified');
  sameSet(modified.map(value => value.item_id ?? ''), detail.items.map(value => value.item_id));
  if (detail.batch.modified_items !== modified.length || detail.batch.finalized_items !== detail.items.filter(value => value.status === 'finalized').length) mismatch();
  for (const item of detail.items) {
    const original = modified.find(value => value.item_id === item.item_id);
    if (!original || item.resource_id !== original.resource_id || item.accepted_head !== original.candidate?.head) mismatch();
    if (item.review) reviewIdentity(item.review, original);
  }
  fence(epoch, signal); return detail;
}
