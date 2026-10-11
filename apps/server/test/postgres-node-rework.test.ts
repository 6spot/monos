import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionPlanNode, OwnerCommand } from '../../../packages/protocol/src/index.ts';
import { NodeRework } from '../src/node-rework.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Exact serial upstream Rework requests', { timeout: 20000 }, () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let rework: NodeRework;
  let nodes: ExecutionPlanNode[];
  beforeEach(async () => {
    x = await conversationFixture(); rework = new NodeRework(x.db);
    nodes = [
      { node_id: x.f.node, role_id: x.f.role, goal: 'Upstream output', dependencies: [] },
      { node_id: `rework-b-${randomUUID()}`, role_id: x.f.role, goal: 'Verify upstream', dependencies: [x.f.node] },
      { node_id: `rework-c-${randomUUID()}`, role_id: x.f.role, goal: 'Other work', dependencies: [] },
    ];
  }, 20000);
  afterEach(async () => { await x?.close(); }, 20000);
  async function start() {
    await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump();
    const planner = await x.promote(), result = await x.agent(planner, 'publish_execution_plan', {
      planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: x.f.plan, nodes: [nodes[0]!, ...nodes.slice(1)],
    });
    await x.finish(result.operation_id!, planner.dispatch.attempt_id);
  }
  async function completeNext() {
    const a = await x.node(), result = await x.agent(a, 'complete_node', { summary: `Completed ${a.dispatch.node_id}` });
    await x.finish(result.operation_id!, a.dispatch.attempt_id); return a;
  }
  async function requester() { await completeNext(); const a = await x.node(); expect(a.dispatch.node_id).toBe(nodes[1]!.node_id); return a; }
  async function reachLimit() {
    await start(); let a = await requester();
    for (let i = 0; i < 3; i++) {
      const result = await x.agent(a, 'request_rework', { reason: `Correction ${i + 1}` });
      await x.finish(result.operation_id!, a.dispatch.attempt_id); await rework.pump(); a = await requester();
    }
    const result = await x.agent(a, 'request_rework', { reason: 'Preserved fourth correction' });
    return { a, result, request: result.result!.rework_outcome! };
  }
  async function decision(name: 'apply_rework' | 'continue_without_rework', request: { rework_request_id: string; version: number }, id = randomUUID()): Promise<OwnerCommand> {
    return { schema_version: 1, scope_id: x.f.task, request_id: id, expected_control_version: await x.version(), name,
      payload: { rework_request_id: request.rework_request_id, expected_version: request.version, answer: 'Exact Owner direction' } };
  }

  it('rejects a root or independent target without effects and commits duplicate requests exactly once', async () => {
    await start(); const upstream = await x.node();
    await expect(x.agent(upstream, 'request_rework', { reason: 'No upstream' })).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    const done = await x.agent(upstream, 'complete_node', { summary: 'Upstream ready' }); await x.finish(done.operation_id!, upstream.dispatch.attempt_id);
    const a = await x.node(), version = await x.version();
    for (const target of [a.dispatch.node_id, nodes[2]!.node_id, 'outside-plan'])
      await expect(x.agent(a, 'request_rework', { target_node_id: target, reason: 'Invalid target' })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    expect(await x.version()).toBe(version);
    expect((await x.db.pool.query('SELECT 1 FROM node_rework_requests')).rowCount).toBe(0);
    const id = randomUUID(), payload = { reason: 'Correct exact upstream' };
    const [first, second] = await Promise.all([x.agent(a, 'request_rework', payload, id), x.agent(a, 'request_rework', payload, id)]);
    expect(second).toEqual(first);
    expect(first.result!.rework_outcome).toMatchObject({ status: 'settling', version: 1, automatic_requests_used: 1, target_node_id: x.f.node, affected_node_ids: nodes.slice(0, 2).map(n => n.node_id) });
    await expect(x.agent(a, 'request_rework', { reason: 'Changed request' }, id)).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    await x.finish(first.operation_id!, a.dispatch.attempt_id);
    await Promise.all([new NodeRework(x.db).pump(), new NodeRework(x.db).pump()]);
    expect((await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [x.f.node])).rows[0].activation).toBe('2');
    expect((await x.db.pool.query("SELECT 1 FROM task_events WHERE kind='node_rework_applied'")).rowCount).toBe(1);
    expect(await x.agent(a, 'request_rework', payload, id)).toEqual(first);
  });

  it('requires an explicit target for multiple direct upstreams and accepts a transitive ancestor', async () => {
    nodes[2]!.dependencies = [x.f.node];
    const last = { node_id: `rework-d-${randomUUID()}`, role_id: x.f.role, goal: 'Join both branches', dependencies: [nodes[1]!.node_id, nodes[2]!.node_id] };
    nodes.push(last); await start();
    for (let i = 0; i < 3; i++) await completeNext();
    const a = await x.node(); expect(a.dispatch.node_id).toBe(last.node_id);
    await expect(x.agent(a, 'request_rework', { reason: 'Ambiguous upstream' })).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    const result = await x.agent(a, 'request_rework', { target_node_id: x.f.node, reason: 'Correct the original shared output' });
    expect(result.result!.rework_outcome!.affected_node_ids).toEqual(nodes.map(n => n.node_id));
    await x.finish(result.operation_id!, a.dispatch.attempt_id); await rework.pump();
    expect((await x.db.pool.query('SELECT activation FROM nodes')).rows.every(n => n.activation === '2')).toBe(true);
    expect((await x.db.pool.query('SELECT 1 FROM node_completions')).rowCount).toBe(3);
  });

  it('rejects affected Owner holds before fencing and retains immutable request and Stop attribution', async () => {
    await start(); const a = await requester();
    // Independent control hold fixture: admission must never erase this bit.
    await x.db.pool.query('UPDATE nodes SET guidance_paused=true WHERE id=$1', [x.f.node]);
    await expect(x.agent(a, 'request_rework', { reason: 'Must not bypass Owner Stop' })).rejects.toThrow('Owner Stop');
    expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    expect((await x.db.pool.query('SELECT 1 FROM node_rework_requests')).rowCount).toBe(0);
    await x.db.pool.query('UPDATE nodes SET guidance_paused=false WHERE id=$1', [x.f.node]);
    const result = await x.agent(a, 'request_rework', { reason: 'Exact retained request' });
    const id = result.result!.rework_outcome!.rework_request_id;
    for (const sql of [
      "UPDATE node_rework_requests SET reason='forged' WHERE id=$1",
      'DELETE FROM node_rework_requests WHERE id=$1',
      'UPDATE node_rework_targets SET from_activation=from_activation+1 WHERE request_id=$1',
      'DELETE FROM node_rework_targets WHERE request_id=$1',
      "UPDATE node_rework_requests SET status='applied',version=version+1,applied_control_version=99 WHERE id=$1",
    ]) await expect(x.db.pool.query(sql, [id])).rejects.toMatchObject({ code: '23514' });
    await expect(x.db.pool.query('UPDATE tasks SET rework_epoch=rework_epoch+1 WHERE id=$1', [x.f.task])).rejects.toMatchObject({ code: '23514' });
    await rework.pump();
    expect((await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [x.f.node])).rows[0].activation).toBe('1');
    expect((await x.db.pool.query('SELECT request_id FROM operations WHERE id=$1', [result.operation_id])).rows[0].request_id).toBe(result.request_id);
    await x.finish(result.operation_id!, a.dispatch.attempt_id); await rework.pump();
    expect((await x.db.pool.query('SELECT status FROM node_rework_requests WHERE id=$1', [id])).rows[0].status).toBe('applied');
  });

  it('waits for Stop before an exact Owner Apply, resets only once and replays its receipt', async () => {
    const { a, result, request } = await reachLimit();
    await expect(x.db.pool.query("UPDATE node_rework_requests SET status='settling',version=version+1 WHERE id=$1", [request.rework_request_id]))
      .rejects.toMatchObject({ code: '23514' });
    expect((await x.db.pool.query('SELECT status,version FROM node_rework_requests WHERE id=$1', [request.rework_request_id])).rows[0])
      .toEqual({ status: 'limit_blocked', version: '1' });
    expect(await rework.status(x.token, x.f.task)).toMatchObject({ automatic_requests_used: 3, current: { can_apply: false, can_continue: false } });
    await expect(rework.command(x.token, await decision('apply_rework', request))).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await x.finish(result.operation_id!, a.dispatch.attempt_id);
    const command = await decision('apply_rework', request), applied = await rework.command(x.token, command);
    expect(applied.rework_outcome).toMatchObject({ status: 'applied', version: 3, automatic_requests_used: 0 });
    expect(await rework.command(x.token, command)).toEqual(applied);
    expect((await x.db.pool.query('SELECT rework_epoch FROM tasks WHERE id=$1', [x.f.task])).rows[0].rework_epoch).toBe('2');
    expect((await x.db.pool.query('SELECT 1 FROM node_rework_decisions')).rowCount).toBe(1);
    await expect(rework.command(x.token, { ...command, payload: { ...command.payload, answer: 'Changed decision' } })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const next = await requester(), automatic = await x.agent(next, 'request_rework', { reason: 'First correction after explicit reset' });
    expect(automatic.result!.rework_outcome).toMatchObject({ status: 'settling', automatic_requests_used: 1 });
  });

  it('serializes competing Owner decisions and Continue preserves activation and consumed budget', async () => {
    const { a, result, request } = await reachLimit(); await x.finish(result.operation_id!, a.dispatch.attempt_id);
    const continued = await decision('continue_without_rework', request), applied = await decision('apply_rework', request);
    // Hold the Task so both commands have reached real database lock contention.
    const barrier = await x.db.pool.connect();
    await barrier.query('BEGIN'); await barrier.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
    const holder = (await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const decisions = [rework.command(x.token, continued), new NodeRework(x.db).command(x.token, applied)];
    for (const promise of decisions) void promise.catch(() => undefined);
    try {
      await expect.poll(async () => (await x.admin.pool.query(`WITH RECURSIVE waiting(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
      ) SELECT pid FROM waiting`, [holder])).rowCount, { timeout: 5000 }).toBe(2);
    } finally { await barrier.query('COMMIT'); barrier.release(); }
    const results = await Promise.allSettled(decisions);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await x.db.pool.query('SELECT 1 FROM node_rework_decisions')).rowCount).toBe(1);
    const row = (await x.db.pool.query('SELECT status FROM node_rework_requests WHERE id=$1', [request.rework_request_id])).rows[0];
    expect((await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [a.dispatch.node_id])).rows[0].activation).toBe(row.status === 'continued' ? '4' : '5');
    expect((await rework.status(x.token, x.f.task)).automatic_requests_used).toBe(row.status === 'continued' ? 3 : 0);
  });

  it('disables stale saved Apply after another affected branch progresses while retaining Continue', async () => {
    nodes[2]!.dependencies = [x.f.node];
    const { a, result, request } = await reachLimit(); await x.finish(result.operation_id!, a.dispatch.attempt_id);
    expect((await rework.status(x.token, x.f.task)).current!.can_apply).toBe(true);
    await completeNext();
    const status = await rework.status(x.token, x.f.task);
    expect(status.current).toMatchObject({ can_apply: false, can_continue: true });
    expect(status.current!.waiting_reason).toContain('completion evidence changed');
    await expect(rework.command(x.token, await decision('apply_rework', request))).rejects.toMatchObject({ detail: { code: 'version_conflict' } });
    const continued = await rework.command(x.token, await decision('continue_without_rework', request));
    expect(continued.rework_outcome).toMatchObject({ status: 'continued', automatic_requests_used: 3 });
    expect((await x.db.pool.query('SELECT state,activation FROM nodes WHERE id=$1', [nodes[2]!.node_id])).rows[0]).toEqual({ state: 'COMPLETED', activation: '4' });
  });
});
