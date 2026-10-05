import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { ownerDeliveryFixture } from './fixtures/owner-delivery-fixture.ts';
import { ownerDeliveryHooks } from '../src/owner-delivery-control.ts';
import { RemotePreparation } from '../src/remote-preparation.ts';
import { RemotePreparationAccess } from '../src/remote-preparation-access.ts';
import { GitHubRemote, remoteProfile } from '../src/github-remote.ts';
import { GitHub } from '../src/github.ts';
import { reactivateSettledNodes } from '../src/task-records.ts';
import { readTaskOverview } from '../src/owner-reads.ts';
import type { RemoteOperation } from '../src/remote-preparation-state.ts';
import { OwnerDeliveryWorker } from '../src/owner-delivery-worker.ts';
import { GitHubFinalization } from '../src/github-finalization.ts';

const suite = process.env.MONOS_TEST_DATABASE === '1' ? describe : describe.skip;
suite('accepted preparation authority', () => {
  it('does not adopt an ordinary operation after its possible effect was admitted or consume confirmation', async () => {
    const credential = randomUUID(), x = await ownerDeliveryFixture('modified', ownerDeliveryHooks, { runnerCredential: credential });
    try {
      const provider = new GitHubRemote(new GitHub(x.service.options.signingKey), { acquireGrant: async (scope, profile) => ({ token: 'memory-only-preaccept-grant', expires_at: new Date(Date.now() + 3600_000).toISOString(), repository_id: scope.repository_id, permissions: remoteProfile(scope, profile) }) });
      const remote = new RemotePreparation(x.db, x.service.instanceId, provider);
      await remote.pump();
      const p = await x.prepareDelivery(), c = await x.confirmDelivery(p);
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp() WHERE installation_id='8'");
      const frame = (await remote.pending(x.f.runner, x.f.incarnation, true))[0]!;
      const operation = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1', [frame.publication_push!.operation_id])).rows[0]!;
      await new RemotePreparationAccess(x.service, provider).access(credential, operation.id, { schema_version: 1, incarnation: x.f.incarnation, request_digest: operation.request_digest, purpose: 'push', attempt_id: randomUUID() });
      await expect(x.acceptDelivery(p, c)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [c.confirmation_id])).rows[0]!.consumed_by).toBeNull();
      expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_batches WHERE task_id=$1', [x.f.task])).rows[0]!.n).toBe('0');
      expect((await x.db.pool.query('SELECT may_have_mutated,effect_owned FROM remote_preparation_operations WHERE id=$1', [operation.id])).rows[0]).toEqual({ may_have_mutated: true, effect_owned: true });
    } finally { await x.close(); }
  });
  it('retries a linked failure before any effect using its original accepted request', async () => {
    const x = await ownerDeliveryFixture('modified', ownerDeliveryHooks);
    try {
      const p = await x.prepareDelivery(), c = await x.confirmDelivery(p), accepted = await x.acceptDelivery(p, c);
      const original = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows[0]!;
      // Synthetic durable pre-effect failure, with actual batch/receipt/link authority.
      await x.db.pool.query("UPDATE remote_preparation_operations SET state='failed',reason='access_denied',version=version+1 WHERE id=$1", [original.id]);
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp() WHERE installation_id='8'");
      const provider = new GitHubRemote(new GitHub(x.service.options.signingKey), { fetcher: async () => { throw new Error('Pre-publication waiting needs no provider request'); } });
      await new OwnerDeliveryWorker(x.db, x.service.instanceId, new GitHubFinalization(provider)).pump();
      const batch = (await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch;
      expect(batch.retry_allowed).toBe(true);
      await x.send('A later unanswered question must not change this Retry.');
      await x.deliveryCommand('retry_delivery', { operation_id: accepted.operation_id, content_digest: accepted.content_digest, expected_version: batch.version });
      const retained = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows;
      expect(retained).toHaveLength(1);
      expect(retained[0]).toMatchObject({ id: original.id, state: 'pending', reason: null, request: original.request, request_digest: original.request_digest, may_have_mutated: false, effect_owned: false });
    } finally { await x.close(); }
  });
  it.each([false, true])('admits before push/PR and preserves exact dispatch during later live conversation (nomination=%s)', async nominated => {
    const x = await ownerDeliveryFixture('modified', ownerDeliveryHooks);
    try {
      const provider = new GitHubRemote(new GitHub(x.service.options.signingKey), {fetcher: async () => {throw new Error('No remote request is needed for this admission claim');}});
      const remote = new RemotePreparation(x.db, x.service.instanceId, provider);
      if (nominated) await remote.pump();
      const predecessor = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows[0];
      expect(!!predecessor).toBe(nominated);
      const p = await x.prepareDelivery(), c = await x.confirmDelivery(p), accepted = await x.acceptDelivery(p, c);
      const operation = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows[0]!;
      if (predecessor) expect(operation.id).toBe(predecessor.id);
      expect(operation).toMatchObject({kind: 'push', state: 'pending', may_have_mutated: false, effect_owned: false});
      expect((await x.db.pool.query('SELECT operation_id,request_digest FROM owner_delivery_preparation_links WHERE batch_id=$1', [accepted.operation_id])).rows).toEqual([{operation_id: operation.id, request_digest: operation.request_digest}]);
      const nodeAttempts = (await x.db.pool.query("SELECT count(*) n FROM attempts WHERE task_id=$1 AND node_id IS NOT NULL", [x.f.task])).rows[0]!.n;
      await x.send('Explain this accepted version; do not change it.');
      const live = await x.turn();
      expect(live.dispatch.task_conversation_source?.reply_only).toBe(true);
      // The fixture's permission observation reserves the installation. Spacing
      // is covered upstream; this case starts at its next eligible dispatch.
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp() WHERE installation_id='8'");
      const frames = await remote.pending(x.f.runner, x.f.incarnation, true);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({type: 'publication_push', publication_push: operation.request});
      const overview = await transaction(x.db, tx => readTaskOverview(tx, x.token, x.f.task));
      expect(overview).toMatchObject({state: 'REVIEW', accepted_delivery_operation_id: accepted.operation_id, accepted_delivery_input_cutoff: accepted.input_cutoff});
      const attributed = (await x.db.pool.query('SELECT accepted_delivery_operation_id FROM task_inputs WHERE task_id=$1', [x.f.task])).rows;
      expect(attributed).toEqual([{accepted_delivery_operation_id: accepted.operation_id}]);
      await expect(transaction(x.db, async tx => reactivateSettledNodes(tx, {task_id: x.f.task, expected: await x.deliveryBasis(), node_ids: [x.f.node]}))).rejects.toMatchObject({detail: {code: 'unmet_precondition'}});
      expect((await x.db.pool.query("SELECT count(*) n FROM attempts WHERE task_id=$1 AND node_id IS NOT NULL", [x.f.task])).rows[0]!.n).toBe(nodeAttempts);
      expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).manifest).toEqual((await x.reads.proposal(x.token, x.f.task, p.proposal_id!)).manifest);
    } finally {await x.close();}
  });

  it('Cancel during push token I/O denies credential return, retains original possible effect and allows read-only recovery', async () => {
    const credential = randomUUID();
    const x = await ownerDeliveryFixture('modified', ownerDeliveryHooks, {runnerCredential: credential});
    try {
      const p = await x.prepareDelivery(), c = await x.confirmDelivery(p), accepted = await x.acceptDelivery(p, c);
      const operation = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows[0]!;
      const profiles: string[] = [];
      const provider = new GitHubRemote(new GitHub(x.service.options.signingKey), {acquireGrant: async (scope, profile) => {
        profiles.push(profile);
        if (profile === 'push') {
          const current = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
          await x.deliveryCommand('cancel_delivery', {operation_id: accepted.operation_id, content_digest: accepted.content_digest, expected_version: current.batch.version});
        }
        return {token: 'memory-only-cancel-race-token', expires_at: new Date(Date.now() + 3600_000).toISOString(), repository_id: scope.repository_id, permissions: remoteProfile(scope, profile)};
      }});
      const remote = new RemotePreparation(x.db, x.service.instanceId, provider);
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp() WHERE installation_id='8'");
      await remote.pending(x.f.runner, x.f.incarnation, true);
      const access = new RemotePreparationAccess(x.service, provider), attempt = randomUUID();
      await expect(access.access(credential, operation.id, {schema_version: 1, incarnation: x.f.incarnation, request_digest: operation.request_digest, purpose: 'push', attempt_id: attempt})).rejects.toMatchObject({detail: {code: 'unmet_precondition'}});
      expect(profiles).toEqual(['push']);
      const retained = (await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1', [operation.id])).rows[0]!;
      expect(retained).toMatchObject({state: 'started', may_have_mutated: true, effect_owned: true, reconcile_only: true});
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0]!.state).toBe('CANCELLED');
      expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch.status).toBe('cancelled');
      // Reuse the exact original operation. No new mutation grant or Task revival.
      await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp() WHERE installation_id='8'");
      const observed = await access.access(credential, operation.id, {schema_version: 1, incarnation: x.f.incarnation, request_digest: operation.request_digest, purpose: 'observe', attempt_id: attempt});
      expect(observed).toMatchObject({operation_id: operation.id, request_digest: operation.request_digest, purpose: 'observe'});
      expect(profiles).toEqual(['push', 'observe']);
      expect((await x.db.pool.query('SELECT count(*) n FROM remote_preparation_operations WHERE task_id=$1', [x.f.task])).rows[0]!.n).toBe('1');
    } finally {await x.close();}
  });
});
