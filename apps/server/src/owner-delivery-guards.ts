import type { Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { DeliveryAcceptanceManifest, DeliveryRepository, PublicationPrepareRequest, PublicationResult, PublicationOverrideProof } from '../../../packages/protocol/src/index.ts';
import { publicationConfiguration, publicationDigest as hash, permissionConfigurationFingerprint } from './publication-policy.ts';
import { effectiveResult } from './publication-candidates.ts';
import { knownPublicExposureCount } from './publication-candidate-reads.ts';
import { actualOverrideProofs } from './remote-preparation-state.ts';
import type { RemoteItem } from './remote-preparation-state.ts';
import { ordinaryRemoteAdmission, freshRemoteSource, RemoteAdmissionError } from './remote-preparation-guards.ts';
import { assertDeliveryBatchAuthority } from './owner-delivery-state.ts';
import type { DeliveryBatchRecord } from './owner-delivery-state.ts';

const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b);

// The Task lock is held by the caller. This is accepted result authority, not
// ordinary input/current-control authority. Physical work remains a guard.
export async function frozenDeliveryRepository(
  tx: Transaction,
  item: Pick<RemoteItem, 'task_id' | 'resource_id' | 'repository_identity' | 'repository_id'>,
  request: PublicationPrepareRequest,
  result?: PublicationResult,
): Promise<{ batch: DeliveryBatchRecord; repository: DeliveryRepository } | undefined> {
  const task = (await tx.query<{ state: string; specification_id: string; plan_id: string | null; accepted_delivery_operation_id: string | null; accepted_delivery_input_cutoff: string | null }>(
    'SELECT state,specification_id,plan_id,accepted_delivery_operation_id,accepted_delivery_input_cutoff FROM tasks WHERE id=$1', [item.task_id],
  )).rows[0];
  if (!task?.accepted_delivery_operation_id) return;
  const batch = (await tx.query<DeliveryBatchRecord>('SELECT * FROM owner_delivery_batches WHERE id=$1 AND task_id=$2', [task.accepted_delivery_operation_id, item.task_id])).rows[0];
  if (!batch) throw new RemoteAdmissionError('identity_mismatch');
  await assertDeliveryBatchAuthority(tx, batch);
  if (task.state !== 'REVIEW' || ['cancelled', 'completed', 'revoked'].includes(batch.status)) throw new RemoteAdmissionError('cancel_requested');
  const manifest = validate<DeliveryAcceptanceManifest>('DeliveryAcceptanceManifest', batch.manifest);
  if (manifest.task_id !== item.task_id || hash(manifest) !== batch.content_digest || task.specification_id !== manifest.basis.specification_id || task.plan_id !== manifest.basis.plan_id || Number(task.accepted_delivery_input_cutoff) !== Number(batch.input_cutoff)) throw new RemoteAdmissionError('source_changed');
  const repository = manifest.repositories.find(r => r.resource_id === item.resource_id);
  if (!repository || repository.outcome !== 'modified' || repository.repository_identity !== item.repository_identity || repository.provider_metadata.github?.repository_id !== item.repository_id || repository.preparation_request_digest !== hash(request) || !same(repository.preparation_request, request) || result && (repository.preparation_result_digest !== hash(result) || !same(repository.preparation_result, result))) throw new RemoteAdmissionError('identity_mismatch');
  const member = (await tx.query<{ repository: DeliveryRepository; repository_digest: string }>('SELECT repository,repository_digest FROM owner_delivery_batch_items WHERE batch_id=$1 AND item_id=$2 AND resource_id=$3', [batch.id, repository.item_id, item.resource_id])).rows[0];
  if (!member || !same(member.repository, repository) || member.repository_digest !== hash(repository)) throw new RemoteAdmissionError('identity_mismatch');
  const resource = (await tx.query<{ repository_identity: string; remote_url: string; active: boolean; settings: { provider_repo_id?: string; remote_preparation?: string; merge_method?: string } }>('SELECT * FROM project_resources WHERE id=$1', [item.resource_id])).rows[0];
  if (!resource?.active || resource.repository_identity !== item.repository_identity || resource.settings.provider_repo_id !== item.repository_id || (resource.settings.remote_preparation ?? 'automatic') !== repository.remote_preparation || resource.settings.merge_method !== repository.merge_method) throw new RemoteAdmissionError('configuration_changed');
  const destination=(await tx.query<{remote_url:string}>('SELECT remote_url FROM remote_preparation_items WHERE item_id=$1 AND task_id=$2',[repository.item_id,item.task_id])).rows[0];
  if(!destination||resource.remote_url!==destination.remote_url)throw new RemoteAdmissionError('configuration_changed');
  if (!(await effectiveResult(tx, request)).current) throw new RemoteAdmissionError('source_changed');
  if (hash(await publicationConfiguration(tx, item.resource_id)) !== request.configuration_digest || !repository.permission_proof || repository.permission_proof.configuration_fingerprint !== await permissionConfigurationFingerprint(tx, item.resource_id)) throw new RemoteAdmissionError('configuration_changed');
  const local = (await tx.query<{ request_digest: string; result_digest: string; state: string }>('SELECT request_digest,result_digest,state FROM delivery_operations WHERE id=$1 AND task_id=$2 AND resource_id=$3', [request.operation_id, item.task_id, item.resource_id])).rows[0];
  if (!local || local.state !== 'terminal' || local.request_digest !== repository.preparation_request_digest || local.result_digest !== repository.preparation_result_digest) throw new RemoteAdmissionError('source_changed');
  if (repository.scan?.status !== 'complete' || typeof repository.scan.workflow_changes !== 'boolean') throw new RemoteAdmissionError('scan_incomplete');
  if (await knownPublicExposureCount(tx, item.task_id, item.resource_id, item.repository_identity)) throw new RemoteAdmissionError('known_public_exposure');
  const proofs = await actualOverrideProofs(tx, item.task_id, repository.scan.scan_id);
  if (!repository.waivers || repository.waivers.some(proof => proof.selection.candidate_id !== repository.candidate?.candidate_id || proof.selection.candidate_manifest_digest !== repository.candidate_manifest_digest || proof.selection.effective_basis_digest !== repository.effective_basis_digest || proof.selection.scan_digest !== repository.scan_digest || proof.selection.mapping_digest !== repository.mapping_digest || !proofs.some(actual => same(actual, proof)))) throw new RemoteAdmissionError('findings_blocked');
  const covered = new Set(repository.waivers.flatMap(proof => proof.selection.finding_ids));
  const findings = (await tx.query<{ finding: { finding_id: string; override_eligible: boolean } }>('SELECT finding FROM publication_findings WHERE scan_id=$1', [repository.scan.scan_id])).rows;
  if (findings.length !== repository.scan.findings_count || findings.some(({ finding }) => !finding.override_eligible || !covered.has(finding.finding_id))) throw new RemoteAdmissionError('findings_blocked');
  // Only canonical reply-only Planner sources are exempt. A named scratch process
  // without its exact persisted source/launch chain is not physical isolation.
  const writers = await tx.query(`SELECT 1 FROM attempts a WHERE a.task_id=$1 AND NOT a.process_released AND NOT EXISTS (
    SELECT 1 FROM task_conversation_outbox s JOIN task_inputs i ON i.id=s.input_id AND i.task_id=s.task_id
    WHERE s.task_id=a.task_id AND s.planned_attempt_id=a.id AND s.reply_only AND i.accepted_delivery_operation_id=$2
      AND s.id=a.launch->'task_conversation_source'->>'source_id'
      AND s.context_digest=a.launch->'task_conversation_source'->>'context_digest'
      AND a.launch->'task_conversation_source'->>'reply_only'='true'
      AND COALESCE(jsonb_array_length(a.launch->'workspace_reservations'->'resources'),0)=0
      AND NOT(a.launch ? 'resource_id'))
    UNION ALL SELECT 1 FROM workspace_leases WHERE task_id=$1 AND state<>'released'
    UNION ALL SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1
      AND o.state NOT IN ('succeeded','cancelled') AND (o.workspace_descriptor IS NOT NULL OR o.kind IN ('open_workspace','complete_node')) LIMIT 1`, [item.task_id,batch.id]);
  if (writers.rowCount) throw new RemoteAdmissionError('source_changed');
  return { batch, repository };
}

export async function remoteSourceAdmission(tx: Transaction, item: Pick<RemoteItem, 'task_id' | 'resource_id' | 'repository_identity' | 'repository_id'>, request: PublicationPrepareRequest, purpose: 'preparation'|'permission' = 'preparation'): Promise<void> {
  if (!await frozenDeliveryRepository(tx, item, request)) await freshRemoteSource(tx, item, request, purpose);
}

export async function remoteAdmissionForOperation(tx: Transaction, item: RemoteItem, request: PublicationPrepareRequest, result: PublicationResult, operationId?: string): Promise<PublicationOverrideProof[]> {
  // A retained accepted operation never acquires ordinary authority when its
  // Task pointer is cleared, withdrawn, or replaced by a fresh acceptance.
  if (operationId && (await tx.query(`SELECT 1 FROM owner_delivery_preparation_links l
    JOIN owner_delivery_batches b ON b.id=l.batch_id JOIN tasks t ON t.id=b.task_id
    WHERE l.operation_id=$1 AND (b.status IN ('revoked','cancelled','completed')
      OR t.accepted_delivery_operation_id IS DISTINCT FROM b.id) LIMIT 1`, [operationId])).rowCount) throw new RemoteAdmissionError('cancel_requested');
  const accepted = await frozenDeliveryRepository(tx, item, request, result);
  if (!accepted) return ordinaryRemoteAdmission(tx, item, request, result, operationId);
  if (item.cancel_requested) throw new RemoteAdmissionError('cancel_requested');
  if (!operationId || !(await tx.query(`SELECT 1 FROM owner_delivery_preparation_links l JOIN remote_preparation_operations o ON o.id=l.operation_id
    WHERE l.batch_id=$1 AND l.item_id=$2 AND l.operation_id=$3 AND l.request_digest=o.request_digest`, [accepted.batch.id, item.item_id, operationId])).rowCount) throw new RemoteAdmissionError('identity_mismatch');
  if ((await tx.query(`SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=$1 AND o.id<>$2 AND
    (o.effect_owned OR o.active AND o.state NOT IN ('settled','revoked') OR o.kind='push' AND o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS (SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published'))
    UNION ALL SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR may_have_mutated AND status IN ('started','unknown')) LIMIT 1`, [item.item_id, operationId])).rowCount) throw new RemoteAdmissionError('possible_publication');
  return accepted.repository.waivers!;
}
