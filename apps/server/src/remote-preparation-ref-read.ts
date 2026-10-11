import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { PublicationPushRequest, PublicationRefReadRequest, PublicationRefReadResponse } from '../../../packages/protocol/src/index.ts';
import type { PublicationRefReadBroker } from './publication-ref-read-broker.ts';
import { publicationDigest as hash } from './publication-policy.ts';
import { appendRemoteObservation, publishProof, verifyPushObservation } from './remote-preparation-state.ts';
import type { RemoteItem, RemoteOperation } from './remote-preparation-state.ts';
import { RemoteAdmissionError } from './remote-preparation-guards.ts';

export interface RetainedRefRead {
  observation_id: string;
  request: PublicationRefReadRequest;
  response: PublicationRefReadResponse;
  issued_at: string;
  received_at: string;
  incarnation: number;
  backend_instance: string;
}

// A read has a fresh correlation and no durable mutation identity. It always
// inspects the original retained push, including when the accepted result maps
// to that older candidate. Cancel/revocation may retain truthful read history.
export async function readPublicationRef(db: Database, instanceId: string, broker: PublicationRefReadBroker, itemId: string, operationId?: string): Promise<RetainedRefRead> {
  const before = await transaction(db, async tx => {
    const item = (await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1', [itemId])).rows[0];
    if (!item || item.delivery_kind !== 'git_branch') throw new RemoteAdmissionError('identity_mismatch');
    const op = (await tx.query<RemoteOperation>(`SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND id=COALESCE($2,$3)`, [itemId, operationId ?? null, item.last_published_proof?.operation_id ?? null])).rows[0];
    if (!op || op.kind !== 'push' || op.state !== 'settled' || !op.worker_absent || !op.result?.worker_absent || !['published', 'reconciliation_required'].includes(String(op.result.status))) throw new RemoteAdmissionError('possible_publication');
    const runner = (await tx.query<{ incarnation: string }>("SELECT incarnation FROM runners WHERE id=$1 AND connection_instance=$2 AND connected AND ready AND last_seen>clock_timestamp()-interval '15 seconds'", [item.runner_id, instanceId])).rows[0];
    if (!runner) throw new RemoteAdmissionError('retained_unavailable');
    const push = validate<PublicationPushRequest>('PublicationPushRequest', op.request);
    if (hash(push) !== op.request_digest || hash(op.result) !== op.result_digest) throw new RemoteAdmissionError('identity_mismatch');
    return { item, op, incarnation: Number(runner.incarnation), request: validate<PublicationRefReadRequest>('PublicationRefReadRequest', { schema_version: 1, request_id: randomUUID(), push, push_request_digest: op.request_digest }) };
  });
  const outcome = await broker.read(before.request, before.incarnation);
  if (outcome.status !== 'ok') throw new RemoteAdmissionError('retained_unavailable');
  const { response } = outcome;
  if (hash(response.request) !== hash(before.request) || hash(response.observation) !== response.observation_digest || !response.worker_absent) throw new RemoteAdmissionError('identity_mismatch');
  verifyPushObservation(before.request.push, response.observation);
  const observationTime = Date.parse(response.observation.observed_at), issued = Date.parse(outcome.issued_at), received = Date.parse(outcome.received_at);
  // Runner clock skew does not confer freshness. Backend send/receive bounds
  // and correlation do; observation timestamps must still be sane and bounded.
  if (!Number.isFinite(observationTime) || received < issued || received - issued > 10_000 || received > Date.now() + 1000 || Date.now() - received > 30_000) throw new RemoteAdmissionError('identity_mismatch');
  const retained: RetainedRefRead = { observation_id: randomUUID(), request: before.request, response, issued_at: outcome.issued_at, received_at: outcome.received_at, incarnation: before.incarnation, backend_instance: instanceId };
  await transaction(db, async tx => {
    if (!(await tx.query('SELECT 1 FROM runners WHERE id=$1 AND incarnation=$2 AND connection_instance=$3 AND connected AND ready FOR SHARE', [before.item.runner_id, before.incarnation, instanceId])).rowCount) throw new RemoteAdmissionError('retained_unavailable');
    await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [before.item.task_id]);
    const item = (await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE', [itemId])).rows[0]!;
    const op = (await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1', [before.op.id])).rows[0]!;
    if (op.request_digest !== before.op.request_digest || op.result_digest !== before.op.result_digest || op.state !== 'settled' || !op.worker_absent) throw new RemoteAdmissionError('identity_mismatch');
    await appendRemoteObservation(tx, item, op.id, 'ref', retained, retained.observation_id);
    if (response.observation.status === 'present' && response.observation.head === before.request.push.prepared.candidate!.head) await publishProof(tx, item, op, response.observation);
  });
  return retained;
}
