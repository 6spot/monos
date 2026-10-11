import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { multiRepositoryWorkspacesFixture } from './fixtures/multi-repository-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-repository workspace ownership', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryWorkspacesFixture>>;
  beforeEach(async () => { x = await multiRepositoryWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('opens two direct repositories on one Attempt and freezes exact sorted completion membership', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node();
    const opened = await x.openAll(turn);
    expect(opened.map(row => row.workspace.isolation)).toEqual([undefined, undefined]);
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE attempt_id=$1 AND state='held'", [turn.dispatch.attempt_id])).rows[0].count).toBe('2');
    const admitted = await x.admitCompletion(turn);
    expect(admitted.operation.workspaces!.map(item => item.workspace.resource_id)).toEqual(x.resources);
    expect(admitted.operation.workspace).toBeUndefined();
    expect(admitted.operation.resource_id).toBeUndefined();
    expect((await x.db.pool.query('SELECT operation_workspace_inputs($1) inputs', [admitted.operation.operation_id])).rows[0].inputs).toEqual(admitted.operation.workspaces);
    const replay = await x.admitCompletion(turn, admitted.operation.request_id);
    expect(replay.operation).toEqual(admitted.operation);
    await expect(x.db.pool.query('UPDATE operation_workspaces SET workspace_digest=$2 WHERE operation_id=$1', [admitted.operation.operation_id, '0'.repeat(64)]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(x.db.pool.query('DELETE FROM operation_workspaces WHERE operation_id=$1', [admitted.operation.operation_id])).rejects.toMatchObject({ code: '23514' });
  });

  it.each(['omit', 'substitute'])('SQL rejects %s membership after backend admission and rolls back fencing', async mode => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    await x.db.pool.query(`CREATE FUNCTION forge_multi_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.resource_id='${x.resources[1]}' THEN ${mode === 'omit' ? 'RETURN NULL;' : "NEW.workspace_digest:=repeat('0',64);"} END IF; RETURN NEW; END $$;
      CREATE TRIGGER z_forge_multi_member BEFORE INSERT ON operation_workspaces FOR EACH ROW EXECUTE FUNCTION forge_multi_member()`);
    await expect(x.admitCompletion(turn)).rejects.toMatchObject({ code: '23514' });
    expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE attempt_id=$1 AND state='held' AND settle_operation_id IS NULL", [turn.dispatch.attempt_id])).rows[0].count).toBe('2');
    expect((await x.db.pool.query('SELECT count(*) FROM completion_manifests WHERE attempt_id=$1', [turn.dispatch.attempt_id])).rows[0].count).toBe('0');
  });

  it('settles ordinary Stops independently while retaining the Attempt until every lease settles', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const stops = await x.stopOperations(turn);
    expect(stops.operations).toHaveLength(2);
    await x.finishStop(turn, stops.operations[0]!);
    expect((await x.db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0].process_released).toBe(false);
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE attempt_id=$1 AND state='released'", [turn.dispatch.attempt_id])).rows[0].count).toBe('1');
    await expect(x.db.pool.query('UPDATE attempts SET process_released=true WHERE id=$1', [turn.dispatch.attempt_id])).rejects.toMatchObject({ code: '23514' });
    await x.finishStop(turn, stops.operations[1]!);
    expect((await x.db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0].process_released).toBe(true);
    await x.finishStop(turn, stops.operations[0]!);
    expect((await x.db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1 AND kind='stop' AND state='succeeded'", [turn.dispatch.attempt_id])).rows[0].count).toBe('2');
  });

  it('blocks sibling opens under the completion barrier but permits sibling Stop settlement', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    await x.openAll(first); await x.open(second);
    const complete = await x.admitCompletion(first);
    await expect(x.admitOpen(second, x.resources[1])).rejects.toBeDefined();
    const stopped = await x.checkpoint(second);
    expect(stopped.operations).toHaveLength(1);
    expect((await x.db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0].process_released).toBe(true);
    await x.settleCompletion(first, complete.operation);
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE operation_id=$1', [complete.operation.operation_id])).rows[0].count).toBe('1');
  });

  it('rejects adding a membership row after its parent admission transaction', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn);
    await expect(x.db.pool.query(`INSERT INTO operation_workspaces(operation_id,resource_id,workspace_id,lease_id,workspace_descriptor,workspace_digest,integration)
      SELECT operation_id,$2,workspace_id,lease_id,workspace_descriptor,workspace_digest,integration FROM operation_workspaces WHERE operation_id=$1 LIMIT 1`, [operation.operation_id, randomUUID()]))
      .rejects.toMatchObject({ code: '23514', message: 'completion membership must be admitted with its immutable parent' });
  });
});
