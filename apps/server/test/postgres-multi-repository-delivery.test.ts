import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import { multiRepositoryDeliveryFixture } from './fixtures/multi-repository-delivery-fixture.ts';
import { forgedSQLAdmission } from './fixtures/owner-delivery-authority-fixture.ts';
import { OwnerDeliveryWorker } from '../src/owner-delivery-worker.ts';
import { GitHubFinalization } from '../src/github-finalization.ts';
import { TaskReviewCommands } from '../src/task-review-commands.ts';
import { ownerReviewHooks } from '../src/owner-review-control.ts';
import { reviewBasis } from '../src/task-review-basis.ts';
import { buildDeliveryAcceptance } from '../src/owner-delivery-state.ts';
import { publicationDigest as hash } from '../src/publication-policy.ts';

const suite = process.env.MONOS_TEST_DATABASE === '1' ? describe : describe.skip;
suite('Multi-repository accepted GitHub delivery', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryDeliveryFixture>>;
  afterEach(async () => { await x?.close(); });
  const puts = () => x.calls.filter(c => c.method === 'PUT');
  it.each(['automatic', 'after_acceptance'] as const)('delivers %s repositories with one output, an all-item barrier and stable merge order', async mode => {
    x = await multiRepositoryDeliveryFixture(mode);
    await x.due(); await x.remote.pump();
    if (mode === 'after_acceptance') {
      expect((await x.db.pool.query('SELECT count(*) FROM remote_preparation_operations')).rows[0].count).toBe('0');
      expect(x.calls).toEqual([]);
    } else await x.prepareRemote();
    const accepted = await x.accept(); await x.prepareRemote();
    const before = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(before.manifest.outputs).toHaveLength(1);
    expect(before.manifest.outputs[0]!.sources.map(s => s.source.resource_id)).toEqual(x.resources);
    expect(before.manifest.repositories.map(r => r.remote_preparation)).toEqual([mode, mode]);
    await x.barrier(accepted.operation_id!); expect(puts()).toHaveLength(0);
    await x.pump();
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch).toMatchObject({ finalized_items: 1, status: 'active' });
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
    await x.pump();
    expect(puts().map(c => c.resource)).toEqual(x.resources);
    const final = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(final.batch).toMatchObject({ status: 'completed', modified_items: 2, finalized_items: 2 });
    expect(final.items.map(i => i.final_commit)).toEqual(x.states.map(s => s.finalHead));
  });
  it('withholds all merges until the second repository is ready and projects distinct per-item checks', async () => {
    x = await multiRepositoryDeliveryFixture(); await x.prepareRemote(); const accepted = await x.accept();
    x.states[1]!.ready = false;
    for (let i = 0; i < 8; i++) await x.pump();
    expect(puts()).toHaveLength(0);
    const progress = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(progress.items.map(i => i.checks)).toEqual(['passing', 'pending']);
    expect((await x.db.pool.query('SELECT item_id FROM owner_delivery_item_validations')).rows).toHaveLength(1);
    x.states[1]!.ready = true;
    // Cached pending pages retain their actual times until the worker refreshes them.
    await x.db.pool.query("UPDATE owner_delivery_item_readiness SET stage=NULL WHERE item_id=$1", [progress.items[1]!.item_id]);
    await x.barrier(accepted.operation_id!); expect(puts()).toHaveLength(0);
    await x.pump(); await x.pump(); expect(puts()).toHaveLength(2);
  });
  it('persists the first success, retries only the rejected sibling and ignores later conversational input', async () => {
    x = await multiRepositoryDeliveryFixture(); await x.prepareRemote(); const accepted = await x.accept();
    await x.barrier(accepted.operation_id!); x.states[1]!.reject = true;
    await x.pump(); await x.pump();
    const progress = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(progress.batch).toMatchObject({ status: 'failed', finalized_items: 1 });
    expect(progress.items.map(i => i.status)).toEqual(['finalized', 'failed']);
    expect(progress.items[0]!.reason).toBeUndefined();
    await expect(new TaskReviewCommands(x.db, ownerReviewHooks).command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'request_changes', payload: { feedback_id: randomUUID(), text: 'Reopen the partially delivered result', basis: await transaction(x.db, tx => reviewBasis(tx, x.f.task)), accepted_batch: { operation_id: accepted.operation_id!, content_digest: accepted.content_digest!, expected_version: progress.batch.version } } })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    const original = (await x.db.pool.query('SELECT * FROM owner_delivery_finalizations')).rows[0];
    await x.send('Please explain the accepted result while its remaining repository delivers');
    const pushes = (await x.db.pool.query("SELECT id FROM remote_preparation_operations WHERE kind='push'")).rows;
    await x.control(accepted.operation_id!, 'retry_delivery'); x.states[1]!.reject = false; await x.pump();
    expect(puts().map(c => c.resource)).toEqual([x.resources[0], x.resources[1], x.resources[1]]);
    expect((await x.db.pool.query('SELECT * FROM owner_delivery_finalizations WHERE item_id=$1', [original.item_id])).rows[0]).toEqual(original);
    expect((await x.db.pool.query("SELECT id FROM remote_preparation_operations WHERE kind='push'")).rows).toEqual(pushes);
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).batch.status).toBe('completed');
  });
  it('reconciles an unknown second merge under its original identity after Cancel without another PUT', async () => {
    x = await multiRepositoryDeliveryFixture('after_acceptance'); const accepted = await x.accept(); await x.prepareRemote();
    await x.barrier(accepted.operation_id!); x.states[1]!.drop = true;
    await x.pump(); await x.pump();
    const original = (await x.db.pool.query("SELECT id,request_digest,status FROM owner_delivery_merge_operations WHERE status='unknown'")).rows[0];
    expect(original).toBeDefined(); expect(puts()).toHaveLength(2);
    await x.control(accepted.operation_id!, 'cancel_delivery');
    const restarted = new OwnerDeliveryWorker(x.db, randomUUID(), new GitHubFinalization(x.provider));
    await x.pump(restarted); await x.due(); await x.remote.pump();
    expect(puts()).toHaveLength(2); expect(x.calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
    expect((await x.db.pool.query('SELECT id,request_digest,status FROM owner_delivery_merge_operations WHERE id=$1', [original.id])).rows[0]).toEqual({ ...original, status: 'succeeded' });
    const final = await x.reads.batch(x.token, x.f.task, accepted.operation_id!);
    expect(final.batch).toMatchObject({ status: 'cancelled', finalized_items: 2 });
    expect(final.items.every(i => i.status === 'finalized' && i.reconciliation === 'externally_merged')).toBe(true);
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('CANCELLED');
  });
  it('Cancel after partial success closes only the undelivered PR and retains delivery branches', async () => {
    x = await multiRepositoryDeliveryFixture(); await x.prepareRemote(); const accepted = await x.accept();
    await x.barrier(accepted.operation_id!); await x.pump(); await x.control(accepted.operation_id!, 'cancel_delivery');
    for (let i = 0; i < 4; i++) { await x.due(); await x.remote.pump(); }
    expect(puts().map(c => c.resource)).toEqual([x.resources[0]]);
    expect(x.calls.filter(c => c.method === 'PATCH').map(c => c.resource)).toEqual([x.resources[1]]);
    expect(x.calls.filter(c => c.method === 'DELETE')).toEqual([]);
    expect((await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).items.map(i => i.reconciliation)).toEqual(['externally_merged', 'closed']);
  });
  it('SQL blocks first mutation without all validations and blocks out-of-order finalization', async () => {
    x = await multiRepositoryDeliveryFixture(); await x.prepareRemote(); const accepted = await x.accept();
    const members = (await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).manifest.repositories;
    const insert = (index: number, scope: string) => x.db.pool.query(`INSERT INTO owner_delivery_merge_operations(id,batch_id,item_id,request,request_digest,selected_method,status,may_have_mutated)
      VALUES($1,$2,$3,$4,$5,'merge','started',true)`, [randomUUID(), accepted.operation_id, members[index]!.item_id, { scope_fingerprint: scope }, hash({ scope_fingerprint: scope })]);
    await expect(insert(0, 'a'.repeat(64))).rejects.toMatchObject({ code: '23514', message: 'Every accepted repository requires validation before first merge' });
    await x.barrier(accepted.operation_id!);
    const scope = (await x.db.pool.query(`SELECT o.observation->>'scope_fingerprint' scope FROM owner_delivery_item_validations v JOIN owner_delivery_observations o ON o.id=v.observation_id WHERE v.item_id=$1`, [members[1]!.item_id])).rows[0].scope;
    await expect(insert(1, scope)).rejects.toMatchObject({ code: '23514', message: 'Delivery merges must finalize remaining resources in stable order' });
    expect(puts()).toHaveLength(0);
  });
  it('SQL rejects a validation certificate borrowing a sibling readiness observation', async () => {
    x = await multiRepositoryDeliveryFixture(); await x.prepareRemote(); const accepted = await x.accept();
    for (let i = 0; i < 8; i++) {
      await x.pump(); if ((await x.db.pool.query('SELECT 1 FROM owner_delivery_item_validations')).rowCount) break;
    }
    const members = (await x.reads.batch(x.token, x.f.task, accepted.operation_id!)).manifest.repositories;
    const first = (await x.db.pool.query('SELECT o.* FROM owner_delivery_observations o JOIN owner_delivery_item_validations v ON v.observation_id=o.id')).rows[0];
    await expect(transaction(x.db, async tx => {
      const id = randomUUID();
      await tx.query("INSERT INTO owner_delivery_observations(id,batch_id,item_id,kind,observation,digest) VALUES($1,$2,$3,'readiness',$4,$5)", [id, accepted.operation_id, members[1]!.item_id, first.observation, first.digest]);
      await tx.query('INSERT INTO owner_delivery_item_validations(batch_id,item_id,observation_id) VALUES($1,$2,$3)', [accepted.operation_id, members[1]!.item_id, id]);
    })).rejects.toMatchObject({ code: '23514', message: 'Delivery validation lacks exact accepted repository readiness' });
    expect(puts()).toHaveLength(0);
  });
  it.each(['missing', 'cross_resource', 'digest'] as const)('SQL rejects %s source evidence even with a shape-consistent Owner receipt chain', async forgery => {
    x = await multiRepositoryDeliveryFixture();
    const manifest = await transaction(x.db, tx => buildDeliveryAcceptance(tx, x.f.task));
    if (forgery === 'missing') manifest.outputs[0]!.sources.pop();
    if (forgery === 'cross_resource') manifest.outputs[0]!.sources[1] = structuredClone(manifest.outputs[0]!.sources[0]!);
    if (forgery === 'digest') manifest.outputs[0]!.sources[1]!.source_digest = hash({ forged: true });
    await expect(transaction(x.db, tx => forgedSQLAdmission(tx, x.f.task, manifest))).rejects.toMatchObject({ code: '23514', message: 'Delivery output attribution or selected evidence differs' });
  });
});
