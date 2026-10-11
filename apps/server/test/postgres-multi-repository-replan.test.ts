import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeRework } from '../src/node-rework.ts';
import { multiRepositoryWorkspacesFixture } from './fixtures/multi-repository-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-repository Replan provenance', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryWorkspacesFixture>>;
  beforeEach(async () => { x = await multiRepositoryWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('retains one completed resource input per member of the same parent completion', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn); await x.settleCompletion(turn, operation);
    const inputs = (await x.db.pool.query('SELECT input FROM replan_workspace_input_rows($1) ORDER BY input->>\'resource_id\'', [x.f.task])).rows.map(row => row.input);
    expect(inputs.map(input => input.resource_id)).toEqual(x.resources);
    expect(inputs.map(input => input.completion_operation_id)).toEqual([operation.operation_id, operation.operation_id]);
    expect(inputs.map(input => input.finalized_tree)).toEqual(['e'.repeat(40), 'f'.repeat(40)]);
    expect(new Set(inputs.map(input => input.from_lease_id)).size).toBe(2);
  });

  it('allows two repository checkpoints to target one replacement Node and retains their exact lease histories', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node();
    const opened = await x.openAll(turn); await x.checkpoint(turn, 'request_replan');
    const replacement = x.definition(), prepared = await x.prepare([replacement]);
    expect(prepared.payload.impact.workspaces).toHaveLength(2);
    expect(prepared.payload.impact.workspaces.map(row => row.target_nodes[0]!.node_id)).toEqual([replacement.node_id, replacement.node_id]);
    await x.publish(prepared); await x.execution.pump(); const next = await x.promote();
    const inherited = await x.openAll(next);
    expect(inherited.map(row => row.workspace.transfer?.from_lease_id)).toEqual(opened.map(row => row.workspace.lease_id));
    expect(inherited.every(row => row.workspace.transfer?.kind === 'checkpoint')).toBe(true);
    expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers WHERE target_node_id=$1', [replacement.node_id])).rows[0].count).toBe('2');
    await x.settleCompletion(next, (await x.admitCompletion(next)).operation);
  });

  it('preserves different source allocations when two repository checkpoints share one replacement Node', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    const opened = [await x.open(first, x.resources[0]), await x.open(second, x.resources[1])];
    expect(opened[0]!.workspace.isolation!.allocation_id).not.toBe(opened[1]!.workspace.isolation!.allocation_id);
    await x.checkpoint(first); await x.checkpoint(second, 'request_replan');
    const target = x.definition(), held = x.definition();
    const prepared = await x.prepare([target, held], impact => {
      for (const hold of impact.holds) hold.target_node_ids = [held.node_id];
    });
    await x.publish(prepared); await x.execution.pump(); const next = await x.promote();
    expect(next.dispatch.node_id).toBe(target.node_id);
    const inherited = await x.openAll(next);
    for (const row of inherited) {
      const source = opened.find(item => item.workspace.resource_id === row.workspace.resource_id)!;
      expect(row.workspace.isolation).toEqual(source.workspace.isolation);
      expect(row.workspace.transfer?.from_lease_id).toBe(source.workspace.lease_id);
      expect(next.dispatch.workspace_reservations!.resources.find(item => item.resource_id === row.workspace.resource_id)!.isolation).toEqual(source.workspace.isolation);
    }
    await x.settleCompletion(next, (await x.admitCompletion(next)).operation);
  });

  it('waits for every Rework Stop and binds each reopened repository to its own historical checkpoint', async () => {
    const root = x.definition(x.f.node), dependent = x.definition(undefined, [root.node_id]);
    await x.start([root, dependent]); const first = await x.node(); await x.openAll(first);
    await x.settleCompletion(first, (await x.admitCompletion(first)).operation);
    const requester = await x.node(), opened = await x.openAll(requester), commandId = randomUUID();
    const request = await x.agent(requester, 'request_rework', { target_node_id: root.node_id, reason: 'Correct both upstream repository results' }, commandId);
    const requestId = request.result!.rework_outcome!.rework_request_id, rework = new NodeRework(x.db);
    const members = (await x.db.pool.query<{ operation_id: string; lease_id: string; workspace_id: string }>(
      'SELECT * FROM node_rework_request_stops WHERE request_id=$1 ORDER BY workspace_id', [requestId])).rows;
    expect(members).toHaveLength(2);
    expect(new Set(members.map(member => member.lease_id))).toEqual(new Set(opened.map(row => row.workspace.lease_id)));
    await x.finishStop(requester, await x.service.recoverOperation(x.f.runner, members[0]!.operation_id));
    await rework.pump();
    expect((await x.db.pool.query('SELECT status FROM node_rework_requests WHERE id=$1', [requestId])).rows[0].status).toBe('settling');
    await x.finishStop(requester, await x.service.recoverOperation(x.f.runner, members[1]!.operation_id));
    await rework.pump();
    expect((await x.db.pool.query('SELECT status FROM node_rework_requests WHERE id=$1', [requestId])).rows[0].status).toBe('applied');
    const corrected = await x.node(); expect(corrected.dispatch.node_activation).toBe(2);
    const reopened = await x.openAll(corrected);
    for (const row of reopened) {
      const member = members.find(item => item.workspace_id === row.workspace.workspace_id)!;
      expect(row.workspace.rework_history).toEqual([expect.objectContaining({ rework_request_id: requestId,
        from_lease_id: member.lease_id, settle_operation_id: member.operation_id })]);
    }
  });

  it('SQL rejects incomplete Rework Stop membership and rolls back the request and lease settlement', async () => {
    const root = x.definition(x.f.node), dependent = x.definition(undefined, [root.node_id]);
    await x.start([root, dependent]); await x.complete(await x.node());
    const requester = await x.node(), opened = await x.openAll(requester);
    await x.db.pool.query(`CREATE FUNCTION omit_rework_stop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.lease_id='${opened[1]!.workspace.lease_id}' THEN RETURN NULL;END IF;RETURN NEW;END $$;
      CREATE TRIGGER z_omit_rework_stop BEFORE INSERT ON node_rework_request_stops FOR EACH ROW EXECUTE FUNCTION omit_rework_stop()`);
    await expect(x.agent(requester, 'request_rework', { target_node_id: root.node_id, reason: 'Correct the exact upstream work' })).rejects.toMatchObject({ code: '23514' });
    expect((await x.db.pool.query('SELECT count(*) FROM node_rework_requests')).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [requester.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE attempt_id=$1 AND state='held' AND settle_operation_id IS NULL", [requester.dispatch.attempt_id])).rows[0].count).toBe('2');
  });
});
