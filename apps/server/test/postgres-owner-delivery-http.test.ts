import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { OwnerAccess } from '../src/owner-access.ts';
import { ownerDeliveryFixture } from './fixtures/owner-delivery-fixture.ts';
import type { OwnerDeliveryCommand, OwnerDeliveryCommandResult } from '../../../packages/protocol/src/index.ts';

const suite = process.env.MONOS_TEST_DATABASE === '1' ? describe : describe.skip;
suite('Owner delivery HTTP boundary', () => {
  it('enforces Owner session, Origin and scoped reads and replays the exact committed receipt after completion', async () => {
    const x = await ownerDeliveryFixture();
    const app = createApp(x.service);
    try {
      const session = await new OwnerAccess(x.db).session(x.token);
      const task = x.f.task, root = `/v1/owner/tasks/${task}/delivery`;
      const headers = { host: 'monos.test', cookie: `monos=${x.token}`, 'x-monos-session': session.session_id };
      const paths = [root, `${root}/proposals/${randomUUID()}`, `${root}/batches/${randomUUID()}`, `${root}/commands/${randomUUID()}`];
      for (const url of paths) {
        const denied = await app.inject({ url });
        expect(denied.statusCode).toBe(401);
        expect(denied.headers['cache-control']).toBe('no-store');
        expect(denied.headers['x-content-type-options']).toBe('nosniff');
      }
      const stale = await app.inject({ url: root, headers: { ...headers, 'x-monos-session': randomUUID() } });
      expect(stale.statusCode).toBe(401);
      expect((await app.inject({ url: root + '?proposal_cursor=bad!', headers })).statusCode).toBe(409);
      const prepare: OwnerDeliveryCommand = { schema_version: 1, task_id: task, request_id: randomUUID(), name: 'prepare_delivery_acceptance', payload: { basis: await x.deliveryBasis() } };
      for (const origin of [undefined, 'http://other.test']) {
        const denied = await app.inject({ method: 'POST', url: '/v1/owner/tasks/delivery/commands', headers: { ...headers, ...(origin ? { origin } : {}) }, payload: prepare });
        expect(denied.statusCode).toBe(403);
      }
      expect((await x.commands.status(x.token, task, prepare.request_id)).status).toBe('unknown');
      const send = async (command: OwnerDeliveryCommand): Promise<OwnerDeliveryCommandResult> => {
        const response = await app.inject({ method: 'POST', url: '/v1/owner/tasks/delivery/commands', headers: { ...headers, origin: 'http://monos.test' }, payload: command });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        return response.json();
      };
      const p = await send(prepare);
      const c = await send({ schema_version: 1, task_id: task, request_id: randomUUID(), name: 'confirm_delivery_acceptance', payload: { proposal_id: p.proposal_id, content_digest: p.content_digest } });
      const accept: OwnerDeliveryCommand = { schema_version: 1, task_id: task, request_id: randomUUID(), name: 'accept_delivery', payload: { proposal_id: p.proposal_id, confirmation_id: c.confirmation_id, content_digest: p.content_digest, basis: await x.deliveryBasis() } };
      const committed = await send(accept);
      const receipt = await app.inject({ url: `${root}/commands/${accept.request_id}`, headers });
      expect(receipt.json()).toEqual(committed);
      expect(await send(accept)).toEqual(committed);
      const batch = await app.inject({ url: `${root}/batches/${committed.operation_id}`, headers });
      expect(batch.statusCode).toBe(200);
      expect(batch.json().batch).toMatchObject({ status: 'completed', retry_allowed: false, cancel_allowed: false });
      const wrongTask = await app.inject({ url: `/v1/owner/tasks/${randomUUID()}/delivery/commands/${accept.request_id}`, headers });
      expect(wrongTask.statusCode).toBe(200);
      expect(wrongTask.json()).toEqual({ schema_version: 1, task_id: wrongTask.json().task_id, request_id: accept.request_id, status: 'unknown' });
      expect(wrongTask.body).not.toContain(committed.operation_id);
      expect((await app.inject({ url: `${root}/proposals/${randomUUID()}`, headers })).statusCode).toBe(403);
      await new OwnerAccess(x.db).logout(x.token);
      expect((await app.inject({ url: root, headers })).statusCode).toBe(401);
    } finally { await app.close(); await x.close(); }
  });
});
