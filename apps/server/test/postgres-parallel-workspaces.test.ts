import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parallelWorkspacesFixture } from './fixtures/parallel-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Parallel workspace allocations', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof parallelWorkspacesFixture>>;
  beforeEach(async () => { x = await parallelWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('queues independent isolated Nodes, serializes first initialization, and keeps sibling ownership after Stop', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    expect((await x.db.pool.query("SELECT count(*) FROM attempts WHERE kind='node' AND state='QUEUED'")).rows[0].count).toBe('2');
    let first = await x.promote(), second = await x.promote();
    expect(first.dispatch.workspace_reservations!.isolation).toBeDefined();
    expect(second.dispatch.workspace_reservations!.isolation).toBeDefined();
    expect(first.dispatch.workspace_reservations!.isolation).not.toEqual(second.dispatch.workspace_reservations!.isolation);
    const race = await x.concurrentAdmissions([() => x.admitOpen(first), () => x.admitOpen(second)]);
    expect(race.contenders).toBe(2);
    const winner = race.results.find(result => result.status === 'fulfilled')!, loser = race.results.find(result => result.status === 'rejected')!;
    expect(winner.status).toBe('fulfilled'); expect(loser).toMatchObject({ reason: { detail: { code: 'unmet_precondition' } } });
    if (winner.status !== 'fulfilled') throw new Error('No first initialization was admitted');
    const initial = winner.value;
    if (initial.attempt_id !== first.dispatch.attempt_id) [first, second] = [second, first];
    const opened = await x.finishOpen(first, initial), sibling = await x.open(second);
    expect(sibling.workspace.workspace_id).toBe(opened.workspace.workspace_id);
    expect(sibling.workspace.canonical_source).toMatchObject({ operation_id: initial.operation_id, kind: 'open_workspace' });
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state='held'")).rows[0].count).toBe('2');
    const stopped = await x.checkpoint(first);
    expect((await x.db.pool.query('SELECT state,checkpoint FROM workspace_leases WHERE id=$1', [opened.workspace.lease_id])).rows[0])
      .toEqual({ state: 'released', checkpoint: stopped.metadata.checkpoint });
    expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [sibling.workspace.lease_id])).rows[0].state).toBe('held');
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0])
      .toEqual({ mutation_allowed: true, process_released: false });
    await expect(x.db.pool.query('UPDATE workspace_leases SET allocation_id=$2 WHERE id=$1', [sibling.workspace.lease_id, opened.workspace.isolation!.allocation_id])).rejects.toMatchObject({ code: '23514' });
    await expect(x.db.pool.query('UPDATE workspace_leases SET start_commit=$2 WHERE id=$1', [sibling.workspace.lease_id, 'c'.repeat(40)])).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps a delayed first open direct and excludes late direct leases once isolated successors queue', async () => {
    const root = x.definition(x.f.node), left = x.definition(undefined, [root.node_id]), right = x.definition(undefined, [root.node_id]);
    await x.start([root, left, right]); const turn = await x.node();
    expect(turn.dispatch.workspace_reservations!.isolation).toBeUndefined();
    await x.execution.pump();
    expect((await x.db.pool.query("SELECT count(*) FROM attempts WHERE kind='node'")).rows[0].count).toBe('1');
    const opened = await x.open(turn);
    await x.settleCompletion(turn, (await x.admitCompletion(turn)).operation);
    await x.execution.pump();
    expect((await x.db.pool.query("SELECT count(*) FROM attempts WHERE kind='node' AND state='QUEUED' AND launch->'workspace_reservations' ? 'isolation'")).rows[0].count).toBe('2');
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state<>'released'")).rows[0].count).toBe('0');
    await expect(x.db.pool.query(`INSERT INTO workspace_leases(id,workspace_id,task_id,node_id,node_activation,attempt_id,dispatch_id,generation,open_operation_id)
      SELECT $2,workspace_id,task_id,node_id,node_activation,attempt_id,dispatch_id,generation,$3 FROM workspace_leases WHERE id=$1`,
    [opened.workspace.lease_id, randomUUID(), randomUUID()])).rejects.toMatchObject({ code: '23514', message: 'direct workspace lease requires exclusive Task ownership' });
    await expect(x.db.pool.query('UPDATE attempts SET process_released=false WHERE id=$1', [turn.dispatch.attempt_id]))
      .rejects.toMatchObject({ code: '23514', message: 'direct Node admission requires exclusive Task ownership' });
  });

  it.each([
    ['missing canonical source', "NEW.workspace_descriptor-'canonical_source'", 'isolated open requires exact admitted canonical provenance'],
    ['forged source Attempt', "jsonb_set(NEW.workspace_descriptor,'{canonical_source,attempt_id}','\"other-attempt\"')", 'workspace source differs from exact successful operation ownership'],
    ['forged source metadata', "jsonb_set(NEW.workspace_descriptor,'{canonical_source,metadata,storage_id}','\"other-storage\"')", 'workspace source differs from exact successful operation ownership'],
    ['changed fixed basis', "jsonb_set(NEW.workspace_descriptor,'{basis,storage_id}','\"other-storage\"')", 'workspace source differs from fixed repository lineage'],
    ['unrelated recovery operation', "jsonb_set(NEW.workspace_descriptor,'{canonical_source,recovery_operation_id}',NEW.workspace_descriptor->'canonical_source'->'operation_id')", 'initial source recovery requires its exact settled Stop'],
  ])('SQL rejects %s independently of the descriptor producer and rolls admission back', async (_name, expression, message) => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote(); await x.open(first);
    await x.db.pool.query(`CREATE FUNCTION forge_parallel_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='open_workspace' THEN NEW.workspace_descriptor := ${expression}; END IF; RETURN NEW; END $$;
      CREATE TRIGGER a_forge_parallel_source BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION forge_parallel_source()`);
    await expect(x.admitOpen(second)).rejects.toMatchObject({ code: '23514', message });
    expect((await x.db.pool.query('SELECT count(*) FROM workspace_leases WHERE attempt_id=$1', [second.dispatch.attempt_id])).rows[0].count).toBe('0');
    expect((await x.db.pool.query("SELECT count(*) FROM command_receipts WHERE attempt_id=$1 AND command_name='open_workspace'", [second.dispatch.attempt_id])).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
  });

  it('SQL rejects borrowing another Node activation\'s settled conflict as private retry input', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote(); await x.open(first);
    const completion = await x.admitCompletion(first); await x.settleCompletion(first, completion.operation, 'conflict');
    await x.db.pool.query(`CREATE FUNCTION forge_parallel_conflict_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='open_workspace' THEN NEW.workspace_descriptor := NEW.workspace_descriptor || jsonb_build_object('conflict_source',
        (SELECT jsonb_build_object('operation_id',id,'attempt_id',attempt_id,'kind',kind,'metadata',result->'workspace_metadata','integration',result->'integration')
         FROM operations WHERE result->'integration'->>'outcome'='conflict' LIMIT 1)); END IF; RETURN NEW; END $$;
      CREATE TRIGGER a_forge_parallel_conflict_source BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION forge_parallel_conflict_source()`);
    await expect(x.admitOpen(second)).rejects.toMatchObject({ code: '23514', message: 'conflict source requires this exact activation and settled private result' });
    expect((await x.db.pool.query('SELECT count(*) FROM workspace_leases WHERE attempt_id=$1', [second.dispatch.attempt_id])).rows[0].count).toBe('0');
  });
});
