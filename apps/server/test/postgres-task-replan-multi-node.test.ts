import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Configuration } from '../src/configuration.ts';
import { multiReplanFixture } from './fixtures/task-replan-multi-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-Node Replan graph authority', { timeout: 60000 }, () => {
  let x: Awaited<ReturnType<typeof multiReplanFixture>>;
  beforeEach(async () => { x = await multiReplanFixture(); });
  afterEach(async () => { await x?.close(); });

  it('adds and removes work, carries exact completion, and reruns invalidated evidence before dependents', async () => {
    const upstream = x.definition(x.f.node), carried = x.definition(), removed = x.definition(), retained = x.definition();
    await x.start([upstream, carried, removed, retained]);
    await x.complete(await x.node(), 'Old upstream evidence');
    const carriedResult = await x.complete(await x.node(), 'Preserved independent result');
    const old = await x.node();
    expect(old.dispatch.node_id).toBe(removed.node_id);
    await x.request(old);
    const added = x.definition(randomUUID(), [upstream.node_id, retained.node_id]);
    const p = await x.prepare([upstream, carried, retained, added], impact => {
      const row = impact.nodes.find(n => n.node_id === upstream.node_id)!;
      row.disposition = 'invalidate'; row.target_node_activation = 2;
    });
    expect(p.payload.impact.nodes).toHaveLength(4);
    expect(p.payload.impact.nodes.find(n => n.node_id === removed.node_id)).toMatchObject({ disposition: 'remove', target_node_id: null, target_node_activation: null });
    expect(p.payload.impact.nodes.find(n => n.node_id === carried.node_id)).toMatchObject({ disposition: 'carry', completion_operation_id: carriedResult.operation_id });
    await x.publish(p);
    await expect(x.agent(old, 'complete_node', { summary: 'Removed source cannot regain authority' })).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    expect((await x.db.pool.query('SELECT node_id FROM plan_nodes WHERE plan_id=$1 ORDER BY node_id', [p.payload.plan_id])).rows.map(r => r.node_id))
      .toEqual([upstream.node_id, carried.node_id, retained.node_id, added.node_id].sort());
    const fresh = await x.node();
    expect(fresh.dispatch.node_id).toBe(upstream.node_id);
    expect(fresh.dispatch.node_execution_source!.node_activation).toBe(2);
    const current = await x.complete(fresh, 'New upstream evidence');
    const next = await x.node();
    expect(next.dispatch.node_id).toBe(retained.node_id);
    await x.complete(next);
    const dependent = await x.node();
    expect(dependent.dispatch.node_id).toBe(added.node_id);
    expect(JSON.parse(dependent.dispatch.prompt).upstream_outputs.items).toContainEqual(expect.objectContaining({ node_id: upstream.node_id, node_activation: 2, completion_operation_id: current.operation_id, summary: 'New upstream evidence' }));
    expect(JSON.parse(dependent.dispatch.prompt).upstream_outputs.items).not.toContainEqual(expect.objectContaining({ summary: 'Old upstream evidence' }));
    await x.complete(dependent);
    expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE node_id=$1', [carried.node_id])).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE node_id=$1', [removed.node_id])).rows[0].count).toBe('1');
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
  });

  it('requires a new identity for changed goals, dependencies, and omitted-versus-empty formal fields', async () => {
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]);
    await x.request();
    const draft = await x.draft([first, second]);
    for (const changed of [{ ...first, goal: 'Changed goal' }, { ...first, dependencies: [second.node_id] }, { ...first, hard_requirements: [] }, { ...first, expected_outputs: [] }]) {
      await expect(x.agent(draft.turn, 'prepare_replan', { ...draft.payload, proposal_id: randomUUID(), nodes: [changed, second] }))
        .rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    }
    expect((await x.db.pool.query('SELECT count(*) FROM replan_proposals')).rows[0].count).toBe('0');
    await x.publish(await x.submit(draft));
  });

  it('rejects carrying a completed dependent after invalidating its dependency', async () => {
    const first = x.definition(x.f.node), second = x.definition(randomUUID(), [first.node_id]);
    await x.start([first, second]);
    await x.complete(await x.node()); await x.complete(await x.node()); await x.request();
    const draft = await x.draft([first, second], impact => {
      const row = impact.nodes.find(n => n.node_id === first.node_id)!;
      row.disposition = 'invalidate'; row.target_node_activation = 2;
    });
    await expect(x.agent(draft.turn, 'prepare_replan', draft.payload)).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    expect((await x.db.pool.query('SELECT count(*) FROM replan_proposals')).rows[0].count).toBe('0');
  });

  it.each(['archive', 'deselect'] as const)('rechecks Role availability at publication after %s', async change => {
    const first = x.definition(x.f.node), second = x.definition(), config = new Configuration(x.db);
    const proposedRole = change === 'deselect' ? randomUUID() : x.f.role;
    if (change === 'deselect') {
      await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
        name: 'save_role', payload: { id: proposedRole, name: 'Proposed reviewer', description: 'Review new work', instructions: 'Review', archived: false } });
      await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
        name: 'save_project', payload: { id: x.f.project, name: 'Project', context: 'Task project', resources: [], role_ids: [x.f.role, proposedRole], archived: false } });
    }
    await x.start([first, second]); await x.request();
    const added = { ...x.definition(), role_id: proposedRole };
    const p = await x.prepare([first, second, added]), approval = await x.approve(p);
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      ...(change === 'archive' ? { name: 'save_role' as const, payload: { id: x.f.role, name: 'Builder', description: 'Build', instructions: 'Build', archived: true } }
        : { name: 'save_project' as const, payload: { id: x.f.project, name: 'Project', context: 'Task project', resources: [], role_ids: [x.f.role], archived: false } }) });
    await expect(x.command('publish_replan', { proposal_id: p.payload.proposal_id, confirmation_id: approval.confirmation_id, basis: p.payload.basis }))
      .rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await x.db.pool.query('SELECT plan_id FROM tasks WHERE id=$1', [x.f.task])).rows[0].plan_id).toBe(x.f.plan);
    expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [approval.confirmation_id])).rows[0].consumed_by).toBeNull();
  });

  it('uses current Role instructions when the retained Node starts after approval', async () => {
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]); await x.request();
    const p = await x.prepare([first, second]), config = new Configuration(x.db);
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      name: 'save_role', payload: { id: x.f.role, name: 'Builder', description: 'Build', instructions: 'CURRENT_ROLE_AFTER_REPLAN_PREPARATION', archived: false } });
    await x.publish(p);
    expect(JSON.parse((await x.node()).dispatch.prompt).role.instructions).toBe('CURRENT_ROLE_AFTER_REPLAN_PREPARATION');
  });

  it('preserves two independent Owner holds with overlapping targets while an unrelated branch runs', async () => {
    const first = x.definition(x.f.node), second = x.definition(), requester = x.definition();
    await x.start([first, second, requester]);
    const origins: string[] = [];
    for (const node of [first, second]) {
      const turn = await x.node(); expect(turn.dispatch.node_id).toBe(node.node_id);
      const stop = await x.owner('stop_node', { node_id: node.node_id, node_activation: 1, source_id: turn.dispatch.node_execution_source!.source_id });
      origins.push(stop.request_id); await x.finish(stop.operation_id!, turn.dispatch.attempt_id);
    }
    await x.request(await x.node());
    const left = x.definition(), shared = x.definition(), free = x.definition();
    const p = await x.prepare([left, shared, free], impact => {
      expect(impact.holds).toHaveLength(2);
      for (const hold of impact.holds) hold.target_node_ids = hold.origin.origin_node_id === first.node_id ? [left.node_id, shared.node_id] : [shared.node_id];
    });
    await x.publish(p);
    const holds = (await x.db.pool.query('SELECT node_id,origin,resolved_by FROM replan_control_holds')).rows;
    expect(holds).toHaveLength(3);
    expect(new Set(holds.map(h => h.origin.owner_request_id))).toEqual(new Set(origins));
    // Each pump prepares one candidate; held roots acquire sources without dispatching.
    await x.execution.pump(); await x.execution.pump();
    const independent = await x.node(); expect(independent.dispatch.node_id).toBe(free.node_id); await x.complete(independent);
    const node = (await x.db.pool.query('SELECT * FROM nodes WHERE id=$1', [left.node_id])).rows[0];
    await x.owner('continue_node', { node_id: node.id, node_activation: 1, source_id: node.execution_source_id, blocker_id: node.blocker_id });
    expect((await x.db.pool.query('SELECT node_id FROM replan_control_holds WHERE resolved_by IS NULL ORDER BY node_id')).rows.map(h => h.node_id)).toEqual([shared.node_id, shared.node_id]);
    const continued = await x.node(); expect(continued.dispatch.node_id).toBe(left.node_id);
    await x.complete(continued);
    expect((await x.execution.status(x.token, x.f.task, shared.node_id)).state).toBe('BLOCKED');
  });

  it('uses only the latest explicit guidance recipients across repeated Replans', async () => {
    await x.send('Preserve the public compatibility rule');
    const conversation = await x.turn();
    const guidance = await x.reply(conversation, { kind: 'guidance', basis: await x.basis(), text: 'PUBLIC_COMPATIBILITY_RULE' });
    await x.finish(guidance.operation_id!, conversation.dispatch.attempt_id);
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]); await x.request();
    const middle = x.definition(), free = x.definition();
    const initial = await x.prepare([middle, free], impact => { impact.guidance[0]!.target_node_ids = [middle.node_id]; });
    await x.publish(initial); await x.request();
    const last = x.definition();
    const final = await x.prepare([free, last], impact => { impact.guidance[0]!.target_node_ids = [last.node_id]; });
    await x.publish(final);
    const unguided = await x.node(); expect(unguided.dispatch.node_id).toBe(free.node_id);
    expect(JSON.parse(unguided.dispatch.prompt).guidance.required_guidance_ids).toEqual([]);
    await x.complete(unguided);
    const guided = await x.node(); expect(guided.dispatch.node_id).toBe(last.node_id);
    expect(JSON.parse(guided.dispatch.prompt).guidance.required_guidance_ids).toEqual([final.payload.impact.guidance[0]!.guidance_id]);
    const done = await x.agent(guided, 'complete_node', { summary: 'Compatibility retained', handled_guidance_ids: [final.payload.impact.guidance[0]!.guidance_id] });
    await x.finish(done.operation_id!, guided.dispatch.attempt_id);
  });

  it('publishes joint requirements and graph only with the two exact approval receipts', async () => {
    const first = x.definition(x.f.node), second = x.definition();
    await x.start([first, second]); await x.request();
    const p = await x.prepare([first, second, x.definition()], undefined, true), graph = await x.approve(p);
    const payload = { proposal_id: p.payload.proposal_id, confirmation_id: graph.confirmation_id, basis: p.payload.basis };
    await expect(x.command('publish_replan', payload)).rejects.toThrow();
    await expect(x.command('publish_replan', { ...payload, requirement_confirmation_id: graph.confirmation_id })).rejects.toThrow();
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('0');
    const requirement = await x.approveRequirement(p);
    await x.command('publish_replan', { ...payload, requirement_confirmation_id: requirement.confirmation_id });
    const task = (await x.db.pool.query('SELECT plan_id,specification_id FROM tasks WHERE id=$1', [x.f.task])).rows[0];
    expect(task.plan_id).toBe(p.payload.plan_id); expect(task.specification_id).not.toBe(x.f.spec);
    await expect(x.command('publish_replan', { ...payload, requirement_confirmation_id: randomUUID() })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('1');
  });
});
