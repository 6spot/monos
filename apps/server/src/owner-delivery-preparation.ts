import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { PublicationPushRequest, RemotePreparationProviderRequest } from '../../../packages/protocol/src/index.ts';
import { publicationDigest as hash } from './publication-policy.ts';
import { frozenDeliveryRepository } from './owner-delivery-guards.ts';
import { RemoteAdmissionError } from './remote-preparation-guards.ts';
import { insertRemoteOperation, remoteReview } from './remote-preparation.ts';
import type { RemoteItem, RemoteOperation } from './remote-preparation-state.ts';

const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b);

// Caller holds Task and item locks. The immutable candidate is already accepted;
// a new request is deterministic dispatch under that batch, never new acceptance.
export async function admitAcceptedPreparationForItem(tx: Transaction, item: RemoteItem, retry = false): Promise<void> {
  const local = (await tx.query<{ request: PublicationPushRequest['preparation']; result: PublicationPushRequest['prepared'] }>(
    `SELECT o.request,o.result FROM owner_delivery_batch_items m JOIN owner_delivery_batches b ON b.id=m.batch_id
     JOIN tasks t ON t.accepted_delivery_operation_id=b.id
     JOIN delivery_operations o ON o.id=m.repository->'preparation_request'->>'operation_id'
     WHERE m.item_id=$1 AND m.task_id=$2`, [item.item_id, item.task_id],
  )).rows[0];
  if (!local) throw new RemoteAdmissionError('identity_mismatch');
  const accepted = await frozenDeliveryRepository(tx, item, local.request, local.result);
  if (!accepted || item.cancel_requested) throw new RemoteAdmissionError('cancel_requested');
  const repository = accepted.repository;
  for (const [key, value] of Object.entries({ runner_id: repository.source.runner_id, storage_id: repository.source.storage_id, delivery_ref: repository.delivery_ref, target_branch: repository.target_branch, marker: repository.marker })) {
    if ((item as unknown as Record<string, unknown>)[key] !== value) throw new RemoteAdmissionError('identity_mismatch');
  }
  if ((await tx.query("SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR status IN ('pending','started','unknown')) LIMIT 1", [item.item_id])).rowCount) return;
  const active = (await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND active AND state NOT IN ('settled','revoked') FOR UPDATE", [item.item_id])).rows[0];
  if (active) {
    const linked = (await tx.query('SELECT 1 FROM owner_delivery_preparation_links WHERE batch_id=$1 AND item_id=$2 AND operation_id=$3 AND request_digest=$4', [accepted.batch.id, item.item_id, active.id, active.request_digest])).rowCount;
    if (linked) {
      if (retry && active.state === 'failed' && !active.may_have_mutated && !active.effect_owned && !active.reconcile_only && !active.claim_id && !active.claim_instance && !active.claim_expires_at) {
        await tx.query("UPDATE remote_preparation_operations SET state='pending',reason=NULL,next_attempt_at=clock_timestamp(),version=version+1 WHERE id=$1", [active.id]);
        await tx.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp() WHERE item_id=$1', [item.item_id]);
      }
      return;
    }
    if (active.state !== 'pending' || active.may_have_mutated || active.effect_owned || active.reconcile_only || active.claim_id || active.claim_instance || active.claim_expires_at || !['push', 'create_pr', 'update_pr'].includes(active.kind)) throw new RemoteAdmissionError('possible_publication');
    const request = active.request;
    if (hash(request) !== active.request_digest || request.item_id !== item.item_id || request.task_id !== item.task_id || request.resource_id !== item.resource_id || request.runner_id !== item.runner_id || request.storage_id !== item.storage_id || request.repository_identity !== item.repository_identity || request.repository_id !== item.repository_id || request.remote_url !== item.remote_url || request.delivery_ref !== item.delivery_ref || request.target_branch !== item.target_branch || !same(request.preparation, repository.preparation_request) || !same(request.prepared, repository.preparation_result) || request.preparation_result_digest !== repository.preparation_result_digest || !same(request.override_receipts, repository.waivers)) throw new RemoteAdmissionError('identity_mismatch');
    if (active.kind === 'push') {
      const push = validate<PublicationPushRequest>('PublicationPushRequest', request);
      if (!same(push.permission_proof, repository.permission_proof) || push.workflow_changes !== repository.scan!.workflow_changes || push.expected_head !== (item.last_published_proof?.candidate.head ?? null) || !same(push.prior_published ?? null, item.last_published_proof ?? null)) throw new RemoteAdmissionError('identity_mismatch');
    } else {
      const provider = validate<RemotePreparationProviderRequest>('RemotePreparationProviderRequest', request);
      if (!same(provider.content, repository.provider_content) || !same(provider.review ?? null, remoteReview(item) ?? null)) throw new RemoteAdmissionError('identity_mismatch');
    }
    await link(tx, accepted.batch.id, item, active);
    return;
  }
  const unresolved = await tx.query(`SELECT 1 FROM remote_preparation_operations o WHERE item_id=$1 AND
    (effect_owned OR may_have_mutated AND state NOT IN ('settled','revoked') OR kind='push' AND state='settled' AND result->>'status'='reconciliation_required' AND NOT EXISTS (SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')) LIMIT 1`, [item.item_id]);
  if (unresolved.rowCount) throw new RemoteAdmissionError('possible_publication');
  const facts = { schema_version: 1, operation_id: randomUUID(), item_id: item.item_id, task_id: item.task_id, resource_id: item.resource_id, runner_id: item.runner_id, storage_id: item.storage_id, repository_identity: item.repository_identity, repository_id: item.repository_id, remote_url: item.remote_url, delivery_ref: item.delivery_ref, target_branch: item.target_branch, preparation: repository.preparation_request, prepared: repository.preparation_result, preparation_result_digest: repository.preparation_result_digest, override_receipts: repository.waivers! };
  if (item.last_published_proof?.candidate.head !== repository.candidate!.head) {
    const prior = (await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND kind='push' ORDER BY created_at DESC,id DESC LIMIT 1", [item.item_id])).rows[0];
    if (prior && prior.request.preparation.operation_id === repository.preparation_request.operation_id && !retry) throw new RemoteAdmissionError('possible_publication');
    if (repository.preparation_result.status !== 'prepared') throw new RemoteAdmissionError('identity_mismatch');
    const request = validate<PublicationPushRequest>('PublicationPushRequest', { ...facts, permission_proof: repository.permission_proof, permission_proof_digest: repository.permission_proof_digest, workflow_changes: repository.scan!.workflow_changes, expected_head: item.last_published_proof?.candidate.head ?? null, ...(item.last_published_proof ? { prior_published: item.last_published_proof, prior_published_digest: item.last_published_digest } : {}) });
    await link(tx, accepted.batch.id, item, await insertRemoteOperation(tx, item, request));
    return;
  }
  if (repository.review && (item.pr_id !== repository.review.pr_id || Number(item.pr_number) !== repository.review.pr_number)) throw new RemoteAdmissionError('identity_mismatch');
  const prior = (await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND kind IN ('create_pr','update_pr') ORDER BY created_at DESC,id DESC LIMIT 1", [item.item_id])).rows[0];
  if (prior && prior.request.preparation.operation_id === repository.preparation_request.operation_id && prior.state === 'settled' && !prior.reason && prior.result && 'content_digest' in prior.result && prior.result.content_digest === repository.provider_content_digest) return;
  if (prior && prior.request.preparation.operation_id === repository.preparation_request.operation_id && !retry) throw new RemoteAdmissionError('possible_publication');
  const request = validate<RemotePreparationProviderRequest>('RemotePreparationProviderRequest', { ...facts, kind: item.pr_id ? 'update_pr' : 'create_pr', ...(remoteReview(item) ? { review: remoteReview(item) } : {}), content: repository.provider_content });
  await link(tx, accepted.batch.id, item, await insertRemoteOperation(tx, item, request));
}

async function link(tx: Transaction, batchId: string, item: RemoteItem, operation: RemoteOperation): Promise<void> {
  await tx.query('INSERT INTO owner_delivery_preparation_links(batch_id,item_id,operation_id,request_digest) VALUES($1,$2,$3,$4)', [batchId, item.item_id, operation.id, operation.request_digest]);
}
