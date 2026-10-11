import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attemptWorkspace } from '../src/task-workspace-reads.ts';
import { multiRepositoryWorkspacesFixture } from './fixtures/multi-repository-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-repository completion authority', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiRepositoryWorkspacesFixture>>;
  beforeEach(async () => { x = await multiRepositoryWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('commits both canonical pointers, all leases and one Node completion and replays the exact result', async () => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn), result = await x.settleCompletion(turn, operation);
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces ORDER BY resource_id')).rows.map(row => row.finalized_commit)).toEqual(['c'.repeat(40), 'd'.repeat(40)]);
    expect((await x.db.pool.query('SELECT result FROM operation_workspace_results($1) ORDER BY resource_id', [operation.operation_id])).rows.map(row => row.result)).toEqual(result.workspace_results);
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE operation_id=$1', [operation.operation_id])).rows[0].count).toBe('1');
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state<>'released'")).rows[0].count).toBe('0');
    const read = await attemptWorkspace(x.db, x.token, x.f.task, turn.dispatch.attempt_id);
    expect(read.workspaces.map(item => item.resource_id)).toEqual(x.resources);
    expect(read.workspaces.map(item => item.metadata_operation_id)).toEqual([operation.operation_id, operation.operation_id]);
    expect(read.workspaces.map(item => item.metadata?.finalized_commit)).toEqual(['c'.repeat(40), 'd'.repeat(40)]);
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id, success: true, result });
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE operation_id=$1', [operation.operation_id])).rows[0].count).toBe('1');
    await expect(x.db.pool.query('UPDATE task_workspaces SET finalized_commit=$2 WHERE resource_id=$1', [x.resources[0], '1'.repeat(40)]))
      .rejects.toMatchObject({ code: '23514', message: 'Task repository pointer requires its exact atomic completion result' });
  });

  it('freezes every dependency repository revision and private/integrated provenance in a later Node source', async () => {
    const root = x.definition(x.f.node), independent = x.definition(), dependent = x.definition(undefined, [root.node_id]);
    await x.start([root, independent, dependent]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    const turn = first.dispatch.node_id === root.node_id ? first : second;
    const sibling = turn === first ? second : first;
    await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn), result = await x.settleCompletion(turn, operation);
    await x.complete(sibling);
    const next = await x.node(), context = JSON.parse(next.dispatch.prompt);
    expect(next.dispatch.node_id).toBe(dependent.node_id);
    expect(context.upstream_outputs.items[0].repositories).toEqual(result.workspace_results.map(item => ({
      resource_id: item.resource_id, workspace_id: item.workspace_id,
      git_commit: item.git_commit, git_tree: item.git_tree, capture: item.capture, integration: item.integration,
    })));
    expect(context.upstream_outputs.items[0].repositories.every((item: { integration?: unknown }) => item.integration)).toBe(true);
    expect(context.upstream_outputs.items[0]).not.toHaveProperty('git_commit');
  });

  it.each([
    ['omitted sibling', "jsonb_set(NEW.result,'{workspace_results}',jsonb_build_array(NEW.result->'workspace_results'->0))"],
    ['reordered members', "jsonb_set(NEW.result,'{workspace_results}',jsonb_build_array(NEW.result->'workspace_results'->1,NEW.result->'workspace_results'->0))"],
    ['cross-repository identity', "jsonb_set(NEW.result,'{workspace_results,1,workspace_id}',NEW.result->'workspace_results'->0->'workspace_id')"],
    ['forged capture', "jsonb_set(NEW.result,'{workspace_results,1,capture,start_commit}',to_jsonb(repeat('f',40)))"],
  ])('SQL rejects %s in direct aggregate settlement without partial commit', async (_name, expression) => {
    await x.start([x.definition(x.f.node)]); const turn = await x.node(); await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn);
    await x.db.pool.query(`CREATE FUNCTION forge_multi_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='complete_node' AND NEW.state='succeeded' THEN NEW.result:=${expression};END IF;RETURN NEW;END $$;
      CREATE TRIGGER a_forge_multi_result BEFORE UPDATE ON operations FOR EACH ROW EXECUTE FUNCTION forge_multi_result()`);
    const result = await x.completionResult(operation);
    await expect(transaction(x.db, async tx => {
      for (const member of result.workspace_results) {
        await tx.query('UPDATE task_workspaces SET finalized_commit=$2 WHERE id=$1', [member.workspace_id, member.git_commit]);
      }
      await tx.query("UPDATE workspace_leases SET state='released' WHERE attempt_id=$1", [turn.dispatch.attempt_id]);
      await tx.query('UPDATE attempts SET process_absent=true,process_released=true,mutation_allowed=false WHERE id=$1', [turn.dispatch.attempt_id]);
      await tx.query("UPDATE operations SET state='succeeded',result=$2 WHERE id=$1", [operation.operation_id, result]);
      await tx.query('SET CONSTRAINTS completion_workspace_parent IMMEDIATE');
    })).rejects.toMatchObject({ code: '23514', message: ['omitted sibling', 'reordered members'].includes(_name) ? 'completion result must cover the exact ordered repository membership' : 'completion item requires its exact captured repository result' });
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces')).rows.every(row => row.finalized_commit === 'a'.repeat(40))).toBe(true);
    expect((await x.db.pool.query('SELECT state FROM operations WHERE id=$1', [operation.operation_id])).rows[0].state).toBe('admitted');
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state='settling'")).rows[0].count).toBe('2');
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions')).rows[0].count).toBe('0');
  });

  it.each([0, 1])('SQL rejects conflict retry with only %i reopened captures', async reopenedCount => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const turn = await x.promote(); await x.openAll(turn);
    await x.settleCompletion(turn, (await x.admitCompletion(turn)).operation, x.resources[1]);
    await x.execution.pump(); await x.promote(); const retry = await x.promote();
    // Reopening only the conflicting item must not discard the clean sibling.
    const opened = reopenedCount ? await x.open(retry, x.resources[1]) : undefined;
    await expect(x.admitCompletion(retry)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await expect(transaction(x.db, async tx => {
      const id = randomUUID();
      await tx.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state) VALUES($1,$2,1,'complete_node',$3,'admitted')",
        [id, retry.dispatch.attempt_id, randomUUID()]);
      if (opened) {
        await tx.query("UPDATE workspace_leases SET state='settling',settle_operation_id=$2 WHERE id=$1", [opened.workspace.lease_id, id]);
        await tx.query(`INSERT INTO operation_workspaces(operation_id,resource_id,workspace_id,lease_id,workspace_descriptor,workspace_digest)
          SELECT $1,resource_id,workspace_descriptor->>'workspace_id',workspace_lease_id,workspace_descriptor,workspace_digest FROM operations WHERE id=$2`, [id, opened.operation.operation_id]);
      }
      await tx.query('SET CONSTRAINTS completion_workspace_parent IMMEDIATE');
    })).rejects.toMatchObject({ code: '23514', message: 'completion retry must include every captured conflicting workspace' });
    expect((await x.db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1 AND kind='complete_node'", [retry.dispatch.attempt_id])).rows[0].count).toBe('0');
  });

  it('preserves the clean sibling capture when another repository conflicts and reopens both under the same activation', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const turn = await x.promote(); await x.openAll(turn);
    const { operation } = await x.admitCompletion(turn), result = await x.settleCompletion(turn, operation, x.resources[1]);
    expect(result.workspace_results[0]!.capture).toBeDefined(); expect(result.workspace_results[0]!.integration).toBeUndefined();
    expect(result.workspace_results.every(item => !item.git_commit)).toBe(true);
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces')).rows.every(row => row.finalized_commit === 'a'.repeat(40))).toBe(true);
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE operation_id=$1', [operation.operation_id])).rows[0].count).toBe('0');
    await x.execution.pump();
    await x.promote(); // The original independent sibling was already queued.
    const retry = await x.promote();
    expect(retry.dispatch.node_execution_source!.node_id).toBe(turn.dispatch.node_execution_source!.node_id);
    expect(retry.dispatch.node_execution_source!.node_activation).toBe(turn.dispatch.node_execution_source!.node_activation);
    const reopened = await x.openAll(retry);
    expect(reopened.map(item => item.workspace.conflict_source?.capture)).toEqual(result.workspace_results.map(item => item.capture));
    expect(reopened.map(item => item.workspace.conflict_source?.completion_outcome)).toEqual(['conflict', 'conflict']);
    await x.settleCompletion(retry, (await x.admitCompletion(retry)).operation);
  });

  it.each(['cancelled', 'finalized', 'conflict'] as const)('settles the complete %s parent after Task Cancel without granting current completion', async outcome => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const turn = await x.promote(), sibling = await x.promote(); await x.complete(sibling);
    const opened = await x.openAll(turn), { operation } = await x.admitCompletion(turn);
    const cancelled = await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    const settlement = await x.service.recoverOperation(x.f.runner, cancelled.operation_id!);
    expect(settlement.completion_operation_id).toBe(operation.operation_id);
    expect(settlement.workspace).toBeUndefined(); expect(settlement.workspaces).toBeUndefined();
    const checkpoints = opened.map(row => ({ resource_id: row.workspace.resource_id, workspace_id: row.workspace.workspace_id,
      workspace_metadata: { ...row.metadata, checkpoint: { operation_id: settlement.operation_id,
        head_commit: row.metadata.finalized_commit, tree_id: 'e'.repeat(40), commit_id: 'f'.repeat(40),
        completion_operation_id: operation.operation_id, completion_identity_digest: settlement.completion_identity_digest! } } }));
    const result = await x.completionResult(operation, outcome === 'conflict' ? x.resources[1] : undefined);
    const pair = {
      operation_id: settlement.operation_id, attempt_id: turn.dispatch.attempt_id, success: true,
      result: outcome === 'cancelled' ? { writer_absent: true, workspace_results: checkpoints } : { writer_absent: true },
      completion_settlement: { completion_operation_id: operation.operation_id,
        disposition: outcome === 'cancelled' ? 'cancelled' as const : 'already_finalized' as const,
        completion_result: outcome === 'cancelled' ? { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id,
          success: false, cancelled_by_operation_id: settlement.operation_id, result: { writer_absent: true } } : {
          operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id, success: true, result } },
    };
    await x.service.finishOperation(x.f.runner, x.f.incarnation, pair);
    await x.service.finishOperation(x.f.runner, x.f.incarnation, pair);
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state<>'released'")).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE operation_id=$1', [operation.operation_id])).rows[0].count).toBe('0');
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('CANCELLED');
    expect((await x.db.pool.query('SELECT state FROM operations WHERE id=$1', [operation.operation_id])).rows[0].state).toBe(outcome === 'cancelled' ? 'cancelled' : 'succeeded');
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces ORDER BY resource_id')).rows.map(row => row.finalized_commit))
      .toEqual(outcome === 'finalized' ? ['c'.repeat(40), 'd'.repeat(40)] : ['a'.repeat(40), 'a'.repeat(40)]);
    if (outcome === 'cancelled') {
      const read = await attemptWorkspace(x.db, x.token, x.f.task, turn.dispatch.attempt_id);
      expect(read.workspaces.map(item => item.metadata_operation_id)).toEqual([settlement.operation_id, settlement.operation_id]);
      expect(read.workspaces.map(item => item.metadata?.checkpoint)).toEqual(checkpoints.map(item => item.workspace_metadata.checkpoint));
    }
  });

  it('SQL rejects a completion source borrowing another repository capture from the same parent', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote(); await x.openAll(first);
    const { operation } = await x.admitCompletion(first); await x.settleCompletion(first, operation);
    await x.db.pool.query(`CREATE FUNCTION forge_multi_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='open_workspace' THEN NEW.workspace_descriptor:=jsonb_set(NEW.workspace_descriptor,'{canonical_source,capture}',
        (SELECT result->'workspace_results'->0->'capture' FROM operations WHERE id='${operation.operation_id}'));END IF;RETURN NEW;END $$;
      CREATE TRIGGER a_forge_multi_source BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION forge_multi_source()`);
    await expect(x.admitOpen(second, x.resources[1])).rejects.toMatchObject({ code: '23514', message: 'workspace source differs from exact successful operation ownership' });
    expect((await x.db.pool.query('SELECT count(*) FROM workspace_leases WHERE attempt_id=$1', [second.dispatch.attempt_id])).rows[0].count).toBe('0');
  });
});
