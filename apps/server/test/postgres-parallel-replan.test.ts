import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parallelWorkspacesFixture } from './fixtures/parallel-workspaces-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Parallel Replan private input preservation', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof parallelWorkspacesFixture>>;
  beforeEach(async () => { x = await parallelWorkspacesFixture(); });
  afterEach(async () => { await x?.close(); });

  it('inventories both private allocations and adopts each checkpoint once at its own approved target', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    const opened = [await x.open(first), await x.open(second)];
    await x.checkpoint(first); await x.checkpoint(second, 'request_replan');
    const left = x.definition(), right = x.definition(), held = x.definition();
    const p = await x.prepare([left, right, held], impact => {
      expect(impact.workspaces).toHaveLength(2);
      impact.workspaces.forEach((w, i) => { w.target_nodes = [{ node_id: [left.node_id, right.node_id][i]!, node_activation: 1 }]; });
      for (const hold of impact.holds) hold.target_node_ids = [held.node_id];
    });
    expect(new Set(p.payload.impact.workspaces.map(w => w.input.from_lease_id))).toEqual(new Set(opened.map(w => w.workspace.lease_id)));
    expect(new Set(p.payload.impact.workspaces.map(w => w.input.workspace_id)).size).toBe(1);
    const invalid = structuredClone(p.payload.impact);
    invalid.workspaces[1]!.target_nodes = structuredClone(invalid.workspaces[0]!.target_nodes);
    await expect(x.db.pool.query(`SELECT validate_replan_graph_impact(jsonb_populate_record(NULL::replan_proposals,
      (SELECT to_jsonb(p)||jsonb_build_object('content',p.content||jsonb_build_object('impact',$2::jsonb)) FROM replan_proposals p WHERE p.id=$1)))`,
    [p.payload.proposal_id, JSON.stringify(invalid)])).rejects.toMatchObject({ code: '23514', message: 'multiple private checkpoints cannot share one target' });
    await x.publish(p); await x.execution.pump();
    const targets = [await x.promote(), await x.promote()];
    for (const target of targets) {
      const adopted = await x.open(target), approved = p.payload.impact.workspaces.find(w => w.target_nodes[0]?.node_id === target.dispatch.node_id)!;
      expect(adopted.workspace.transfer).toMatchObject({ kind: 'checkpoint', from_lease_id: approved.input.from_lease_id, to_node_id: target.dispatch.node_id });
      expect(adopted.workspace.isolation?.allocation_id).toBe(approved.input.metadata.isolation!.allocation_id);
      expect(adopted.metadata.isolation?.start_commit).toBe(approved.input.metadata.isolation!.start_commit);
    }
    expect((await x.db.pool.query('SELECT from_lease_id FROM replan_workspace_transfers ORDER BY from_lease_id')).rows.map(r => r.from_lease_id))
      .toEqual(opened.map(w => w.workspace.lease_id).sort());
    expect((await x.db.pool.query("SELECT count(*) FROM workspace_leases WHERE state='held'")).rows[0].count).toBe('2');
  });

  it('preserves an admitted sibling completion and another frozen live source across the completion control update', async () => {
    // Provision three physical slots before any Task execution is admitted.
    await x.db.pool.query('UPDATE runners SET capacity=3 WHERE id=$1', [x.f.runner]);
    const nodes = [x.definition(x.f.node), x.definition(), x.definition()] as const;
    await x.start([...nodes]); await x.execution.pump();
    const requester = await x.promote(), completing = await x.promote(), other = await x.promote();
    await x.open(completing);
    const admitted = await x.admitCompletion(completing), source = completing.dispatch.node_execution_source!.source_id;
    await x.request(requester);
    expect((await x.db.pool.query('SELECT execution_source_id FROM nodes WHERE id=$1', [completing.dispatch.node_id])).rows[0].execution_source_id).toBe(source);
    const frozen = await x.version();
    await x.settleCompletion(completing, admitted.operation);
    expect(await x.version()).toBeGreaterThan(frozen);
    const blocked = await x.agent(other, 'block_node', { reason: 'Retain the independently frozen live source' });
    await x.finish(blocked.operation_id!, other.dispatch.attempt_id);
    const p = await x.prepare([...nodes]);
    expect(p.payload.impact.nodes.find(n => n.node_id === completing.dispatch.node_id)).toMatchObject({ source_id: source,
      disposition: 'carry', completion_operation_id: admitted.operation.operation_id });
    expect(p.payload.impact.workspaces).toHaveLength(1);
    expect(p.payload.impact.workspaces[0]!.input).toMatchObject({ kind: 'completed', completion_operation_id: admitted.operation.operation_id });
  });

  it('resumes a conflict suspended by Replan after Owner dismissal without repeating its historical event', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const requester = await x.promote(), completing = await x.promote();
    const opened = await x.open(completing), admitted = await x.admitCompletion(completing);
    await x.request(requester);
    await x.settleCompletion(completing, admitted.operation, 'conflict');
    const source = completing.dispatch.node_execution_source!.source_id;
    expect((await x.db.pool.query('SELECT execution_source_id FROM nodes WHERE id=$1', [completing.dispatch.node_id])).rows[0].execution_source_id).toBe(source);
    const request = (await x.db.pool.query("SELECT id,version FROM replan_requests WHERE task_id=$1 AND status='pending'", [x.f.task])).rows[0];
    await x.command('dismiss_replan', { replan_request_id: request.id, expected_version: Number(request.version), direction: 'The current independent graph remains sufficient' });
    await x.execution.pump(); await x.execution.pump();
    const sources = (await x.db.pool.query('SELECT id,node_activation FROM node_execution_outbox WHERE node_id=$1 ORDER BY created_at DESC', [completing.dispatch.node_id])).rows;
    expect(sources).toHaveLength(2); expect(sources[0].id).not.toBe(source); expect(sources[0].node_activation).toBe('1');
    expect((await x.db.pool.query("SELECT count(*) FROM task_events WHERE operation_id=$1 AND kind='node_integration_conflict'", [admitted.operation.operation_id])).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1', [completing.dispatch.node_id])).rows[0].count).toBe('0');
    const resumed = [await x.promote(), await x.promote()].find(turn => turn.dispatch.node_id === completing.dispatch.node_id)!;
    const fresh = await x.open(resumed);
    expect(fresh.workspace.isolation!.allocation_id).not.toBe(opened.workspace.isolation!.allocation_id);
    expect(fresh.workspace.conflict_source?.operation_id).toBe(admitted.operation.operation_id);
  });

  it('allows separate isolated recipients to claim the same completed canonical Replan input', async () => {
    await x.start([x.definition(x.f.node), x.definition()]); await x.execution.pump();
    const first = await x.promote(), second = await x.promote();
    await x.open(first); await x.open(second);
    await x.settleCompletion(first, (await x.admitCompletion(first)).operation, 'integrated', 'c'.repeat(40));
    const canonical = (await x.admitCompletion(second)).operation;
    await x.settleCompletion(second, canonical, 'integrated', 'f'.repeat(40));
    await x.request();
    const p = await x.prepare([x.definition(), x.definition()]); await x.publish(p); await x.execution.pump();
    expect(p.payload.impact.workspaces).toHaveLength(1);
    const targets = [await x.promote(), await x.promote()];
    for (const target of targets) {
      const opened = await x.open(target);
      expect(opened.workspace.transfer).toMatchObject({ kind: 'completed', from_lease_id: canonical.workspace!.lease_id, to_node_id: target.dispatch.node_id });
      expect(opened.metadata.isolation!.start_commit).toBe('f'.repeat(40));
    }
    expect((await x.db.pool.query('SELECT from_lease_id,target_node_id FROM replan_workspace_transfers')).rows)
      .toEqual(expect.arrayContaining(targets.map(t => ({ from_lease_id: canonical.workspace!.lease_id, target_node_id: t.dispatch.node_id }))));
    expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('2');
  });

  it('reactivates carried direct completion with isolated placement while an unrelated writer remains live', async () => {
    const carried = x.definition(x.f.node);
    await x.start([carried]);
    const original = await x.node();
    expect(original.dispatch.workspace_reservations!.isolation).toBeUndefined();
    const originalOpen = await x.open(original);
    expect(originalOpen.workspace.isolation).toBeUndefined();
    const originalCompletion = (await x.admitCompletion(original)).operation;
    await x.settleCompletion(original, originalCompletion);

    await x.request();
    const left = x.definition(), right = x.definition();
    const proposal = await x.prepare([carried, left, right]);
    expect(proposal.payload.impact.nodes).toContainEqual(expect.objectContaining({
      node_id: carried.node_id, disposition: 'carry', completion_operation_id: originalCompletion.operation_id,
    }));
    await x.publish(proposal);
    await x.execution.pump();
    const first = await x.promote(), other = await x.promote();
    expect(new Set([first.dispatch.node_id, other.dispatch.node_id])).toEqual(new Set([left.node_id, right.node_id]));
    expect(first.dispatch.workspace_reservations!.isolation).toBeDefined();
    expect(other.dispatch.workspace_reservations!.isolation).toBeDefined();
    await x.open(first);
    const otherOpen = await x.open(other);
    await x.settleCompletion(first, (await x.admitCompletion(first)).operation, 'integrated', 'f'.repeat(40));

    await x.send('Refine the carried completed work');
    const turn = await x.turn();
    const guidance = await x.reply(turn, { kind: 'guidance', text: 'REFINE_CARRIED_DIRECT_RESULT', basis: await x.basis() });
    await x.finish(guidance.operation_id!, turn.dispatch.attempt_id);
    await x.conversation.pump();
    expect(await x.execution.status(x.token, x.f.task, carried.node_id)).toMatchObject({ node_activation: 2 });
    expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [otherOpen.workspace.lease_id])).rows[0].state).toBe('held');

    const corrected = await x.node();
    expect(corrected.dispatch).toMatchObject({ node_id: carried.node_id, node_activation: 2 });
    expect(corrected.dispatch.prompt).toContain('REFINE_CARRIED_DIRECT_RESULT');
    const correctedOpen = await x.open(corrected);
    expect(correctedOpen.workspace.isolation).toBeDefined();
    expect(correctedOpen.workspace.isolation).not.toEqual(otherOpen.workspace.isolation);
    await x.settleCompletion(other, (await x.admitCompletion(other)).operation, 'integrated', '1'.repeat(40));
    const done = await x.agent(corrected, 'complete_node', {
      summary: 'Applied guidance to the carried result', handled_guidance_ids: [guidance.result!.obligation_id!],
    });
    await x.settleCompletion(corrected, await x.service.recoverOperation(x.f.runner, done.operation_id!), 'integrated', '2'.repeat(40));
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
  });
});
