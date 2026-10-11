import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { PublicationRefReadBroker } from '../src/publication-ref-read-broker.ts';
import { publicationDigest as hash } from '../src/publication-policy.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { Frame, PublicationPushRequest, PublicationRefReadRequest } from '../../../packages/protocol/src/index.ts';

function request(): PublicationRefReadRequest {
  const fixture = JSON.parse(readFileSync(new URL('../../../packages/protocol/fixtures/remote-preparation.json', import.meta.url), 'utf8'));
  const push = validate<PublicationPushRequest>('PublicationPushRequest', fixture.push);
  return { schema_version: 1, request_id: randomUUID(), push, push_request_digest: hash(push) };
}
function response(frame: Frame): Frame {
  const r = frame.publication_ref_read!, p = r.push;
  const observation = { schema_version: 1, observation_id: randomUUID(), operation_id: p.operation_id, item_id: p.item_id, task_id: p.task_id, resource_id: p.resource_id, runner_id: p.runner_id, storage_id: p.storage_id, repository_identity: p.repository_identity, provider_metadata: p.provider_metadata, delivery_ref: p.delivery_ref, status: 'present', head: p.prepared.candidate!.head, observed_at: new Date().toISOString() };
  return validate('Frame', { schema_version: 1, type: 'publication_ref_read_result', incarnation: frame.incarnation, correlation_id: frame.correlation_id, publication_ref_read_result: { schema_version: 1, request: r, worker_absent: true, observation, observation_digest: hash(observation) } });
}
it('binds each fresh read to socket, incarnation, correlation, full original request and observation digest', async () => {
  const broker = new PublicationRefReadBroker(1000), socket = {}, r = request(); let frame!: Frame;
  broker.register(r.push.runner_id, 2, socket, true, f => { frame = f; return true; });
  const pending = broker.read(r, 2), first = frame;
  broker.response(r.push.runner_id, {}, response(frame));
  broker.response(r.push.runner_id, socket, { ...response(frame), incarnation: 1 });
  const wrong = response(frame); wrong.publication_ref_read_result!.request = { ...r, request_id: randomUUID() };
  broker.response(r.push.runner_id, socket, wrong);
  const wrongDigest = response(frame); wrongDigest.publication_ref_read_result!.observation_digest = 'a'.repeat(64);
  broker.response(r.push.runner_id, socket, wrongDigest);
  broker.response(r.push.runner_id, socket, response(frame));
  const result = await pending; expect(result.status).toBe('ok');
  if (result.status === 'ok') expect(Date.parse(result.received_at)).toBeGreaterThanOrEqual(Date.parse(result.issued_at));
  const second = broker.read(r, 2); expect(frame.correlation_id).not.toBe(first.correlation_id);
  broker.response(r.push.runner_id, socket, response(first)); broker.disconnect(r.push.runner_id, socket);
  expect(await second).toEqual({ status: 'offline' }); broker.shutdown();
});
it('bounds reads and releases timeout, capability, reconnect and send failure cases', async () => {
  const broker = new PublicationRefReadBroker(20), r = request(), socket = {};
  expect(await broker.read(r)).toEqual({ status: 'offline' });
  broker.register(r.push.runner_id, 1, socket, false, () => true); expect(await broker.read(r)).toEqual({ status: 'unsupported' });
  broker.register(r.push.runner_id, 2, socket, true, () => true);
  expect(await broker.read(r, 1)).toEqual({ status: 'offline' });
  const pending = [broker.read(r, 2), broker.read(r, 2)];
  expect(await broker.read(r, 2)).toEqual({ status: 'busy' });
  expect(await Promise.all(pending)).toEqual([{ status: 'timeout' }, { status: 'timeout' }]);
  broker.register(r.push.runner_id, 3, socket, true, () => false); expect(await broker.read(r)).toEqual({ status: 'offline' });
  broker.register(r.push.runner_id, 4, socket, true, () => { throw Error('send'); }); expect(await broker.read(r)).toEqual({ status: 'offline' }); broker.shutdown();
});
