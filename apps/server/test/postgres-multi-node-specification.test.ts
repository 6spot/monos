import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import type { SpecificationImpact } from '../../../packages/protocol/src/index.ts';
import { specificationImpact } from '../src/task-specification-state.ts';
import { multiReplanFixture } from './fixtures/task-replan-multi-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Unchanged multi-Node requirement revisions', () => {
  let x: Awaited<ReturnType<typeof multiReplanFixture>>;
  beforeEach(async () => { x = await multiReplanFixture(); });
  afterEach(async () => { await x?.close(); });
  const impact = () => transaction(x.db, async tx => specificationImpact(tx, (await tx.query('SELECT * FROM tasks WHERE id=$1', [x.f.task])).rows[0]));
  const edit = async (value?: SpecificationImpact) => x.specification.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task,
    name: 'edit_specification', payload: { proposal_id: randomUUID(), specification: 'Revised requirements, unchanged collaboration graph', summary: 'Exact graph-wide impact',
      impact: value ?? await impact(), basis: await x.basis(), source_input_ids: [] } });
  const rows = () => x.db.pool.query('SELECT id,activation,state FROM nodes WHERE task_id=$1 ORDER BY id', [x.f.task]);

  it('invalidates the requested dependency chain, carries independent evidence and publishes complete applicability atomically', async () => {
    const a = x.definition(x.f.node), b = x.definition(undefined, [a.node_id]), c = x.definition();
    await x.start([a, b, c]);
    for (let i = 0; i < 3; i++) await x.complete(await x.node());
    const original = await rows(), value = await impact();
    value.nodes.find(n => n.node_id === c.node_id)!.disposition = 'carry';
    const invalid: SpecificationImpact = structuredClone(value); invalid.nodes.find(n => n.node_id === b.node_id)!.disposition = 'carry';
    await expect(edit(invalid)).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    await expect(x.db.pool.query('SELECT assert_specification_graph_impact($1,$2,$3)', [x.f.task, x.f.plan, invalid])).rejects.toMatchObject({ code: '23514' });
    await expect(x.db.pool.query('SELECT assert_specification_graph_impact($1,$2,$3)', [x.f.task, x.f.plan,
      { ...value, nodes: value.nodes.map(() => value.nodes[0]) }])).rejects.toMatchObject({ code: '23514' });
    await x.db.pool.query(`CREATE FUNCTION omit_applicability() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.node_id='${b.node_id}' THEN RETURN NULL;END IF;RETURN NEW;END $$;
      CREATE TRIGGER omit_applicability BEFORE INSERT ON specification_node_applicability FOR EACH ROW EXECUTE FUNCTION omit_applicability()`);
    await expect(edit(value)).rejects.toMatchObject({ code: '23514', message: 'Specification publication requires every authorized Node applicability' });
    expect((await rows()).rows).toEqual(original.rows);
    expect((await x.db.pool.query('SELECT 1 FROM requirement_changes')).rowCount).toBe(0);
    await x.db.pool.query('DROP TRIGGER omit_applicability ON specification_node_applicability');
    await edit(value);
    expect((await rows()).rows).toEqual([a, b, c].sort((x, y) => x.node_id.localeCompare(y.node_id)).map(n => ({ id: n.node_id,
      activation: n.node_id === c.node_id ? '1' : '2', state: n.node_id === c.node_id ? 'COMPLETED' : 'PENDING' })));
    expect((await x.db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1 ORDER BY node_id', [x.f.plan])).rows.map(row => row.definition))
      .toEqual([a, b, c].sort((x, y) => x.node_id.localeCompare(y.node_id)));
    expect((await x.db.pool.query('SELECT 1 FROM node_completions')).rowCount).toBe(3);
    expect((await x.db.pool.query('SELECT 1 FROM specification_node_applicability')).rowCount).toBe(3);
    const fresh = await x.node(); expect(fresh.dispatch.node_id).toBe(a.node_id); await x.complete(fresh);
    const next = await x.node(); expect(next.dispatch.node_id).toBe(b.node_id); await x.complete(next);
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
  });

  it('settles every active branch and preserves an independent Owner Stop while other work resumes', async () => {
    const a = x.definition(x.f.node), b = x.definition(undefined, [a.node_id]), c = x.definition(); await x.start([a, b, c]);
    await x.execution.pump(); const first = await x.promote(), second = await x.promote();
    const running = first.dispatch.node_id === a.node_id ? first : second, paused = running === first ? second : first;
    const stopped = await x.owner('stop_node', { node_id: c.node_id, node_activation: 1, source_id: paused.dispatch.node_execution_source!.source_id });
    await x.finish(stopped.operation_id!, paused.dispatch.attempt_id);
    const changed = await edit(); await x.specification.pump();
    expect((await x.db.pool.query('SELECT specification_id FROM tasks WHERE id=$1', [x.f.task])).rows[0].specification_id).toBe(x.f.spec);
    const effects = (await x.db.pool.query('SELECT operation_id FROM requirement_change_effects WHERE change_id=$1', [changed.operation_id])).rows;
    for (const effect of effects) await x.finish(effect.operation_id, running.dispatch.attempt_id);
    await x.specification.pump();
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('RUNNING');
    expect((await x.db.pool.query('SELECT state,guidance_paused FROM nodes WHERE id=$1', [c.node_id])).rows[0]).toEqual({ state: 'BLOCKED', guidance_paused: true });
    const fresh = await x.node(); expect(fresh.dispatch.node_id).toBe(a.node_id);
    expect(fresh.dispatch.node_execution_source!.specification_id).not.toBe(x.f.spec);
    await expect(x.agent(running, 'complete_node', { summary: 'Obsolete source' })).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    await x.complete(fresh);
    const dependent = await x.node(); expect(dependent.dispatch.node_id).toBe(b.node_id);
  });

  it('preserves Stop on a newly invalidated dependent without preparing executable context before its upstream', async () => {
    const a = x.definition(x.f.node), b = x.definition(undefined, [a.node_id]); await x.start([a, b]);
    await x.complete(await x.node()); const dependent = await x.node();
    const completion = await x.agent(dependent, 'complete_node', { summary: 'Old dependent result' });
    await x.owner('stop_node', { node_id: b.node_id, node_activation: 1, source_id: dependent.dispatch.node_execution_source!.source_id });
    const change = await edit();
    const settlement = (await x.db.pool.query(`SELECT o.id FROM requirement_change_effects e JOIN operations o ON o.id=e.operation_id
      WHERE e.change_id=$1 AND o.completion_operation_id=$2`, [change.operation_id, completion.operation_id])).rows[0];
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: settlement.id, attempt_id: dependent.dispatch.attempt_id,
      success: true, result: { writer_absent: true }, completion_settlement: { completion_operation_id: completion.operation_id!, disposition: 'already_finalized',
        completion_result: { operation_id: completion.operation_id!, attempt_id: dependent.dispatch.attempt_id, success: true,
          result: { writer_absent: true, completion_outcome: 'finalized', workspace_results: [] } } } });
    await x.specification.pump();
    const blocked = (await x.db.pool.query(`SELECT n.state,n.activation,n.execution_source_id,n.blocker_id,s.prompt,s.preparation_failure
      FROM nodes n JOIN node_execution_outbox s ON s.id=n.execution_source_id WHERE n.id=$1`, [b.node_id])).rows[0];
    expect(blocked).toMatchObject({ state: 'BLOCKED', activation: '2', prompt: null, preparation_failure: 'waiting_for_dependencies' });
    const upstream = await x.node(); expect(upstream.dispatch.node_id).toBe(a.node_id); await x.complete(upstream);
    await x.owner('continue_node', { node_id: b.node_id, node_activation: 2, source_id: blocked.execution_source_id, blocker_id: blocked.blocker_id });
    const fresh = await x.node(); expect(fresh.dispatch.node_id).toBe(b.node_id);
    expect(JSON.parse(fresh.dispatch.prompt).upstream_outputs.items[0]).toMatchObject({ node_id: a.node_id, node_activation: 2 });
  });
});
