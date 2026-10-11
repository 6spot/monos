import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parallelWorkspacesFixture } from './fixtures/parallel-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Parallel completion integration', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof parallelWorkspacesFixture>>;
  beforeEach(async () => { x = await parallelWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('freezes one completion boundary, preserves the losing writer, and releases the join only after both integrations', async () => {
    const a = x.definition(x.f.node), b = x.definition(), join = x.definition(undefined, [a.node_id, b.node_id]);
    await x.start([a, b, join]); await x.execution.pump();
    let first = await x.promote(), second = await x.promote();
    await x.open(first); await x.open(second);
    const race = await x.concurrentAdmissions([() => x.admitCompletion(first), () => x.admitCompletion(second)]);
    expect(race.contenders).toBe(2);
    const winner = race.results.find(result => result.status === 'fulfilled')!, loser = race.results.find(result => result.status === 'rejected')!;
    expect(winner.status).toBe('fulfilled'); expect(loser).toMatchObject({ reason: { detail: { code: 'unmet_precondition' } } });
    if (winner.status !== 'fulfilled') throw new Error('No completion was admitted');
    const admitted = winner.value;
    if (admitted.operation.attempt_id !== first.dispatch.attempt_id) [first, second] = [second, first];
    expect(admitted.operation.integration).toEqual({ expected_task_commit: 'a'.repeat(40) });
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0])
      .toEqual({ mutation_allowed: true, process_released: false });
    expect((await x.db.pool.query('SELECT count(*) FROM completion_manifests WHERE attempt_id=$1', [second.dispatch.attempt_id])).rows[0].count).toBe('0');
    await expect(x.db.pool.query('UPDATE operations SET integration=$2 WHERE id=$1', [admitted.operation.operation_id, { expected_task_commit: 'f'.repeat(40) }])).rejects.toMatchObject({ code: '23514' });
    await x.settleCompletion(first, admitted.operation, 'integrated', 'c'.repeat(40));
    await x.execution.pump();
    expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE node_id=$1', [join.node_id])).rows[0].count).toBe('0');
    const next = await x.admitCompletion(second);
    expect(next.operation.integration).toEqual({ expected_task_commit: 'c'.repeat(40) });
    await x.settleCompletion(second, next.operation, 'integrated', 'f'.repeat(40));
    const joined = await x.node(); expect(joined.dispatch.node_id).toBe(join.node_id);
    const result = await x.open(joined);
    expect(result.workspace.basis?.finalized_commit).toBe('f'.repeat(40));
    expect(result.workspace.canonical_source?.operation_id).toBe(next.operation.operation_id);
    expect(JSON.parse(joined.dispatch.prompt).upstream_outputs.items).toHaveLength(2);
  });

  it('retains a conflict as historical input and retries the same activation from the latest integrated Task base', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    await x.open(first); const prior = await x.open(second);
    await x.settleCompletion(first, (await x.admitCompletion(first)).operation, 'integrated', 'c'.repeat(40));
    const failed = await x.admitCompletion(second), version = await x.version();
    const conflict = await x.settleCompletion(second, failed.operation, 'conflict', 'f'.repeat(40));
    expect(conflict.integration).toMatchObject({ outcome: 'conflict', expected_task_commit: 'c'.repeat(40), task_commit: 'c'.repeat(40), node_commit: 'f'.repeat(40) });
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces')).rows[0].finalized_commit).toBe('c'.repeat(40));
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1', [second.dispatch.node_id])).rows[0].count).toBe('0');
    await expect(x.db.pool.query('INSERT INTO node_completions(node_id,activation,attempt_id,operation_id,result) VALUES($1,1,$2,$3,$4)',
      [second.dispatch.node_id, second.dispatch.attempt_id, failed.operation.operation_id, conflict])).rejects.toMatchObject({ code: '23514' });
    expect(await x.version()).toBeGreaterThan(version);
    const retry = await x.node(); expect(retry.dispatch.node_id).toBe(second.dispatch.node_id);
    expect(retry.dispatch.node_execution_source!.node_activation).toBe(1); expect(retry.dispatch.attempt_id).not.toBe(second.dispatch.attempt_id);
    const opened = await x.open(retry);
    expect(opened.workspace.isolation!.allocation_id).not.toBe(prior.workspace.isolation!.allocation_id);
    expect(opened.workspace.basis?.finalized_commit).toBe('c'.repeat(40));
    expect(opened.workspace.conflict_source).toMatchObject({ operation_id: failed.operation.operation_id, integration: { outcome: 'conflict', node_commit: 'f'.repeat(40) } });
    expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [prior.workspace.lease_id])).rows[0].state).toBe('released');
    await x.settleCompletion(retry, (await x.admitCompletion(retry)).operation, 'integrated', '1'.repeat(40));
    expect((await x.db.pool.query('SELECT activation FROM node_completions WHERE node_id=$1', [retry.dispatch.node_id])).rows).toEqual([{ activation: '1' }]);
  });

  it.each(['missing', 'stale'] as const)('SQL rejects %s integration authority without retaining fences, manifests or receipts', async mode => {
    await x.start([x.definition(x.f.node), x.definition()]); const turn = await x.node(); await x.open(turn);
    const before = (await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0];
    const version = await x.version();
    await x.db.pool.query(`CREATE FUNCTION forge_parallel_integration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='complete_node' THEN NEW.integration := ${mode === 'missing' ? 'NULL' : "jsonb_build_object('expected_task_commit',repeat('f',40))"}; END IF; RETURN NEW; END $$;
      CREATE TRIGGER a_forge_parallel_integration BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION forge_parallel_integration()`);
    await expect(x.admitCompletion(turn)).rejects.toMatchObject({ code: '23514' });
    expect(await x.version()).toBe(version);
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0]).toEqual(before);
    expect((await x.db.pool.query('SELECT count(*) FROM completion_manifests WHERE attempt_id=$1', [turn.dispatch.attempt_id])).rows[0].count).toBe('0');
    expect((await x.db.pool.query("SELECT count(*) FROM command_receipts WHERE attempt_id=$1 AND command_name='complete_node'", [turn.dispatch.attempt_id])).rows[0].count).toBe('0');
  });

  it('bounds automatic conflict retries and preserves an actionable Owner Retry without incrementing activation', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    let turn = await x.promote(); const sibling = await x.promote(); await x.complete(sibling);
    const allocations = new Set<string>();
    for (let i = 0; i < 3; i++) {
      allocations.add((await x.open(turn)).workspace.isolation!.allocation_id);
      await x.settleCompletion(turn, (await x.admitCompletion(turn)).operation, 'conflict', String(i + 1).repeat(40));
      if (i < 2) turn = await x.node();
    }
    expect(allocations.size).toBe(3);
    const blocked = await x.execution.status(x.token, x.f.task, turn.dispatch.node_id!);
    expect(blocked.state).toBe('BLOCKED'); expect(blocked.node_activation).toBe(1);
    expect(blocked.blocker!.reason).toContain('integration_conflict_limit');
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1', [turn.dispatch.node_id])).rows[0].count).toBe('0');
    await x.owner('retry_node', { node_id: turn.dispatch.node_id, node_activation: 1, source_id: blocked.source!.source_id,
      blocker_id: blocked.blocker!.id, answer: 'Inspect the retained conflict history and try again' });
    const retry = await x.node(); expect(retry.dispatch.node_activation).toBe(1);
    expect(allocations.has((await x.open(retry)).workspace.isolation!.allocation_id)).toBe(false);
  });

  it('preserves Owner Stop when the admitted completion resolves as a conflict', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const turn = await x.promote(), sibling = await x.promote(); await x.complete(sibling); await x.open(turn);
    const admitted = await x.admitCompletion(turn);
    await x.owner('stop_node', { node_id: turn.dispatch.node_id, node_activation: 1, source_id: turn.dispatch.node_execution_source!.source_id });
    const before = (await x.db.pool.query('SELECT count(*) FROM node_execution_outbox WHERE node_id=$1', [turn.dispatch.node_id])).rows[0].count;
    await x.settleCompletion(turn, admitted.operation, 'conflict');
    const blocked = await x.execution.status(x.token, x.f.task, turn.dispatch.node_id!);
    expect(blocked.state).toBe('BLOCKED'); expect(blocked.blocker!.kind).toBe('owner_stopped');
    expect((await x.db.pool.query('SELECT count(*) FROM node_execution_outbox WHERE node_id=$1', [turn.dispatch.node_id])).rows[0].count).toBe(before);
    await x.owner('continue_node', { node_id: turn.dispatch.node_id, node_activation: 1, source_id: blocked.source!.source_id, blocker_id: blocked.blocker!.id });
    const retry = await x.node(); expect(retry.dispatch.node_activation).toBe(1); expect(retry.dispatch.node_id).toBe(turn.dispatch.node_id);
  });

  it.each(['cancelled', 'integrated', 'conflict'] as const)('retains truthful %s settlement after Task cancellation without evidence or successor work', async outcome => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const turn = await x.promote(), sibling = await x.promote(); await x.complete(sibling);
    const opened = await x.open(turn), admitted = await x.admitCompletion(turn);
    const manifest = (await x.db.pool.query('SELECT * FROM completion_manifests WHERE operation_id=$1', [admitted.operation.operation_id])).rows[0];
    const cancelled = await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    const settlement = await x.service.recoverOperation(x.f.runner, cancelled.operation_id!);
    expect(settlement.completion_operation_id).toBe(admitted.operation.operation_id);
    const queued = (await x.db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count;
    const integration = { outcome: outcome === 'integrated' ? 'integrated' as const : 'conflict' as const,
      start_commit: opened.metadata.isolation!.start_commit, node_commit: 'c'.repeat(40), node_tree: 'd'.repeat(40),
      expected_task_commit: admitted.operation.integration!.expected_task_commit,
      task_commit: outcome === 'integrated' ? 'c'.repeat(40) : admitted.operation.integration!.expected_task_commit, task_tree: 'e'.repeat(40) };
    const pair = {
      operation_id: settlement.operation_id, attempt_id: turn.dispatch.attempt_id, success: true,
      result: outcome === 'cancelled' ? { writer_absent: true, workspace_id: opened.workspace.workspace_id,
        workspace_metadata: { ...opened.metadata, checkpoint: { operation_id: settlement.operation_id,
          head_commit: opened.metadata.finalized_commit, tree_id: 'd'.repeat(40), commit_id: 'c'.repeat(40),
          completion_operation_id: admitted.operation.operation_id, completion_identity_digest: settlement.completion_identity_digest! } } } : { writer_absent: true },
      completion_settlement: { completion_operation_id: admitted.operation.operation_id,
        disposition: outcome === 'cancelled' ? 'cancelled' as const : 'already_finalized' as const,
        completion_result: outcome === 'cancelled' ? { operation_id: admitted.operation.operation_id, attempt_id: turn.dispatch.attempt_id,
          success: false, cancelled_by_operation_id: settlement.operation_id, result: { writer_absent: true } } : {
          operation_id: admitted.operation.operation_id, attempt_id: turn.dispatch.attempt_id, success: true,
          result: { writer_absent: true, workspace_id: opened.workspace.workspace_id, integration,
            workspace_metadata: { ...opened.metadata, finalized_commit: outcome === 'integrated' ? integration.task_commit : opened.metadata.finalized_commit },
            ...(outcome === 'integrated' ? { git_commit: integration.task_commit, git_tree: integration.task_tree } : {}) } } },
    };
    await x.service.finishOperation(x.f.runner, x.f.incarnation, pair);
    await x.service.finishOperation(x.f.runner, x.f.incarnation, pair);
    await x.execution.pump();
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('CANCELLED');
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces')).rows[0].finalized_commit).toBe(outcome === 'integrated' ? 'c'.repeat(40) : 'a'.repeat(40));
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1', [turn.dispatch.node_id])).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count).toBe(queued);
    expect((await x.db.pool.query('SELECT * FROM completion_manifests WHERE operation_id=$1', [admitted.operation.operation_id])).rows[0]).toEqual(manifest);
    expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [opened.workspace.lease_id])).rows[0].state).toBe('released');
    expect((await x.service.recoverOperation(x.f.runner, admitted.operation.operation_id)).state).toBe(outcome === 'cancelled' ? 'cancelled' : 'succeeded');
  });
});
