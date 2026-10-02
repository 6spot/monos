import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest } from '../../../packages/protocol/src/index.ts';
import { replanFixture } from './fixtures/task-replan-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Independent Replan SQL authority', { timeout: 40000 }, () => {
  let x: Awaited<ReturnType<typeof replanFixture>>;
  beforeEach(async () => { x = await replanFixture(); await x.request(); }, 30000);
  afterEach(async () => { await x?.close(); }, 30000);
  it('rejects consumed graph approval without its exact publication', async () => {
    const p = await x.prepare();
    const a = await x.command('confirm_replan', { proposal_id: p.payload.proposal_id, content_digest: p.result.result!.replan_outcome!.content_digest });
    await expect(x.db.pool.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1', [a.confirmation_id, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1', [a.confirmation_id])).rows[0].consumed_by).toBeNull();
  });
  it.each(['request_id', 'response'] as const)('rejects forged deferral with incorrect %s despite matching named input', async defect => {
    const p = await x.prepare(), input = await x.send('An unresolved independent later input');
    const requestId = randomUUID();
    const body = { schema_version: 1, request_id: defect === 'request_id' ? randomUUID() : requestId, task_id: x.f.task, name: 'defer_replan_inputs', payload: { proposal_id: p.payload.proposal_id, inputs: [{ input_id: input.input_id, version: 1 }] } };
    const raw = canonicalJSON(body);
    await expect(transaction(x.db, async tx => {
      await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [x.f.task, requestId, digest(raw), raw, { schema_version: 1, request_id: requestId, status: defect === 'response' ? 'unknown' : 'committed' }]);
      await tx.query('INSERT INTO replan_input_deferrals(task_id,proposal_id,input_id,input_version,request_id) VALUES($1,$2,$3,1,$4)', [x.f.task, p.payload.proposal_id, input.input_id, requestId]);
    })).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects unrelated Owner message as input deferral', async () => {
    const p = await x.prepare(), input = await x.send('Unclassified change');
    await expect(x.db.pool.query('INSERT INTO replan_input_deferrals(task_id,proposal_id,input_id,input_version,request_id) VALUES($1,$2,$3,1,$4)', [x.f.task, p.payload.proposal_id, input.input_id, input.request_id])).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects a self-consistent source digest containing invented effective requirements', async () => {
    const request = (await x.db.pool.query('SELECT * FROM replan_requests')).rows[0];
    const task = (await x.db.pool.query('SELECT * FROM tasks')).rows[0];
    const id = randomUUID();
    const context = { source_id: id, replan_request_id: request.id,
      basis: { control_version: Number(task.control_version), specification_id: task.specification_id, plan_id: task.plan_id },
      input_cutoff: 0, specification: 'INVENTED REQUIREMENTS THAT WERE NEVER AUTHORIZED', graph: { node_ids: [], nodes: [] }, impact: {} };
    const prompt = canonicalJSON(context);
    await expect(transaction(x.db, async tx => {
      await tx.query(`INSERT INTO replan_sources(id,task_id,request_id,planned_attempt_id,specification_id,plan_id,expected_version,input_cutoff,event_cutoff,configuration_version,context,prompt,context_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,1,$9,$10,$11)`, [id, x.f.task, request.id, randomUUID(), task.specification_id, task.plan_id, task.control_version, task.event_sequence, context, prompt, digest(prompt)]);
      await tx.query('UPDATE replan_requests SET source_id=$2 WHERE id=$1', [request.id, id]);
    })).rejects.toMatchObject({ code: '23514' });
  });
  it('Node retry cannot resolve a request-owned blocker instead of explicit Replan dismissal', async () => {
    const request = (await x.db.pool.query('SELECT * FROM replan_requests')).rows[0];
    const node = (await x.db.pool.query('SELECT * FROM nodes WHERE id=$1', [x.f.node])).rows[0];
    await expect(x.owner('retry_node', { node_id: node.id, node_activation: 1,
      source_id: node.execution_source_id, blocker_id: node.blocker_id, answer: 'Continue without changing the graph' }))
      .rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await x.db.pool.query('SELECT state FROM tasks')).rows[0].state).toBe('REPLAN_REQUIRED');
    expect((await x.db.pool.query('SELECT status FROM replan_requests WHERE id=$1', [request.id])).rows[0].status).toBe('pending');
    expect((await x.db.pool.query('SELECT blocker_id FROM nodes WHERE id=$1', [node.id])).rows[0].blocker_id).toBe(node.blocker_id);
    await x.replan.pump();
    expect((await x.db.pool.query('SELECT count(*) FROM replan_sources')).rows[0].count).toBe('1');
  });
  it('joint publication replay requires original requirements approval', async () => {
    const p = await x.prepare(true); await x.publish(p);
    const pub = (await x.db.pool.query('SELECT * FROM replan_publications')).rows[0];
    for (const requirement_confirmation_id of [undefined, randomUUID()]) {
      await expect(x.command('publish_replan', { proposal_id: p.payload.proposal_id, confirmation_id: pub.authorization_id, basis: p.payload.basis, ...(requirement_confirmation_id ? { requirement_confirmation_id } : {}) })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    }
    expect((await x.db.pool.query('SELECT count(*) FROM replan_publications')).rows[0].count).toBe('1');
  });
});

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Independent inherited control receipt', () => {
  it('does not resolve an inherited Owner Stop using a forged unknown-result receipt', async () => {
    const x = await replanFixture();
    try {
      await x.start(); const old = await x.node(); await x.send('Replace the insufficient graph');
      const turn = await x.turn(), requested = await x.reply(turn, { kind: 'replan', basis: await x.basis(), text: 'Replace formal Node work' });
      await x.finish(requested.operation_id!, turn.dispatch.attempt_id);
      const stopped = await x.owner('stop_node', { node_id: x.f.node, node_activation: 1, source_id: old.dispatch.node_execution_source!.source_id });
      await x.finish(stopped.operation_id!, old.dispatch.attempt_id);
      const p = await x.prepare(); await x.publish(p);
      const hold = (await x.db.pool.query('SELECT * FROM replan_control_holds')).rows[0];
      const node = (await x.db.pool.query('SELECT * FROM nodes WHERE id=$1', [hold.node_id])).rows[0];
      const id = randomUUID(), body = { schema_version: 1, request_id: id, scope_id: x.f.task, expected_control_version: await x.version(), name: 'continue_node', payload: { node_id: node.id, node_activation: Number(node.activation), source_id: node.execution_source_id, blocker_id: hold.current_blocker_id } };
      const raw = canonicalJSON(body);
      await expect(transaction(x.db, async tx => {
        await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [x.f.task, id, digest(raw), raw, { schema_version: 1, request_id: id, status: 'unknown' }]);
        await tx.query('UPDATE replan_control_holds SET resolved_by=$2 WHERE id=$1', [hold.id, id]);
      })).rejects.toMatchObject({ code: '23514' });
      expect((await x.db.pool.query('SELECT resolved_by FROM replan_control_holds WHERE id=$1', [hold.id])).rows[0].resolved_by).toBeNull();
    } finally { await x.close(); }
  }, 60000);
});
