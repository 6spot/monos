import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { NodeExecution } from '../src/node-execution.ts';
import { nodeSource } from '../src/node-execution-state.ts';
import type { NodeSource } from '../src/node-execution-state.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Serial multi-Node execution', () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let downstream: string;
  let independent: string;

  beforeEach(async () => {
    x = await conversationFixture();
    downstream = `serial-b-${randomUUID()}`;
    independent = `serial-c-${randomUUID()}`;
    await x.owner('start_task', { specification_id: x.f.spec });
    await x.planning.pump();
    const planner = await x.promote();
    const outcome = await x.agent(planner, 'publish_execution_plan', {
      planning_intent_id: planner.dispatch.task_planning_source!.intent_id,
      plan_id: x.f.plan,
      nodes: [
        { node_id: x.f.node, role_id: x.f.role, goal: 'Create the upstream result', dependencies: [] },
        { node_id: downstream, role_id: x.f.role, goal: 'Use the current upstream result', dependencies: [x.f.node] },
        { node_id: independent, role_id: x.f.role, goal: 'Independent work', dependencies: [] },
      ],
    });
    await x.finish(outcome.operation_id!, planner.dispatch.attempt_id);
  });
  afterEach(async () => { await x?.close(); });

  async function finishNode(attempt: Awaited<ReturnType<typeof x.promote>>, summary: string) {
    const outcome = await x.agent(attempt, 'complete_node', { summary });
    await x.finish(outcome.operation_id!, attempt.dispatch.attempt_id);
  }

  async function sourceNodes() {
    return (await x.db.pool.query<{ node_id: string }>('SELECT node_id FROM node_execution_outbox ORDER BY node_id')).rows.map((r) => r.node_id);
  }

  it('prepares a dependent only after exact completion settlement with fresh Role and selected upstream evidence', async () => {
    const first = await x.node();
    expect(first.dispatch.node_id).toBe(x.f.node);
    const selected = randomUUID();
    const unselected = randomUUID();
    await x.agent(first, 'publish_artifact', { artifact_id: selected, title: 'SELECTED_CURRENT_UPSTREAM', content: { text: 'Current formal output', media_type: 'text/plain' } });
    await x.agent(first, 'publish_artifact', { artifact_id: unselected, title: 'UNSELECTED_UPSTREAM_DRAFT', content: { text: 'Draft only', media_type: 'text/plain' } });
    await x.execution.pump();
    expect(await sourceNodes()).toEqual([x.f.node]);
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ state: 'PENDING', source: null, waiting_reason: 'waiting_for_dependencies' });
    expect(await x.execution.status(x.token, x.f.task, independent)).toMatchObject({ state: 'PENDING', source: null, waiting_reason: 'waiting_for_serial_execution' });
    const completion = await x.agent(first, 'complete_node', { summary: 'CURRENT_UPSTREAM_SUMMARY', artifact_ids: [selected] });
    await x.execution.pump();
    expect(await sourceNodes()).toEqual([x.f.node]);
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    const configuration = new Configuration(x.db);
    const snapshot = await configuration.read(x.token);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: snapshot.control_version,
      name: 'save_role', payload: { ...snapshot.roles.find((r) => r.id === x.f.role)!, instructions: 'ROLE_AFTER_UPSTREAM_COMPLETION_ADMISSION' },
    });
    await x.finish(completion.operation_id!, first.dispatch.attempt_id);
    const second = await x.node();
    expect(second.dispatch.node_id).toBe(downstream);
    const context = JSON.parse(second.dispatch.prompt);
    expect(context.role.instructions).toBe('ROLE_AFTER_UPSTREAM_COMPLETION_ADMISSION');
    expect(context.upstream_outputs.items).toEqual([expect.objectContaining({
      node_id: x.f.node, node_activation: 1, completion_operation_id: completion.operation_id,
      summary: 'CURRENT_UPSTREAM_SUMMARY', artifacts: [expect.objectContaining({ artifact_id: selected, title: 'SELECTED_CURRENT_UPSTREAM' })],
    })]);
    expect(second.dispatch.prompt).not.toContain(unselected);
    expect(second.dispatch.prompt).not.toContain('UNSELECTED_UPSTREAM_DRAFT');
    await finishNode(second, 'Dependent result');
    const third = await x.node();
    expect(third.dispatch.node_id).toBe(independent);
    expect(JSON.parse(third.dispatch.prompt).upstream_outputs.items).toEqual([]);
    await finishNode(third, 'Independent result');
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE task_id=$1 AND kind=\'node\' AND NOT process_released', [x.f.task])).rowCount).toBe(0);
  });

  it('keeps independent work runnable after a blocked Node and preserves its authority across another Node Retry', async () => {
    const first = await x.node();
    const blocked = await x.agent(first, 'block_node', { reason: 'Need an explicit upstream answer' });
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('RUNNING');
    await x.execution.pump();
    expect(await sourceNodes()).toEqual([x.f.node]);
    await x.finish(blocked.operation_id!, first.dispatch.attempt_id);
    const independentAttempt = await x.node();
    expect(independentAttempt.dispatch.node_id).toBe(independent);
    expect((await x.execution.status(x.token, x.f.task, downstream)).source).toBeNull();
    const status = await x.execution.status(x.token, x.f.task, x.f.node);
    await x.owner('retry_node', { node_id: x.f.node, node_activation: status.node_activation, source_id: status.source!.source_id, blocker_id: status.blocker!.id, answer: 'Proceed with the clarified answer' });
    await x.execution.pump();
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    await x.agent(independentAttempt, 'publish_artifact', { artifact_id: randomUUID(), title: 'Independent still authorized', content: { text: 'Other Node Retry does not revoke this source', media_type: 'text/plain' } });
    await finishNode(independentAttempt, 'Independent finished after upstream Retry');
    const retried = await x.node();
    expect(retried.dispatch.node_id).toBe(x.f.node);
    expect(retried.dispatch.prompt).toContain('Proceed with the clarified answer');
    await finishNode(retried, 'Clarified upstream result');
    const dependentAttempt = await x.node();
    expect(dependentAttempt.dispatch.node_id).toBe(downstream);
    await finishNode(dependentAttempt, 'Current dependent result');
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
  });

  it('serializes concurrent pumps before freezing sources and creates only one Node Start', async () => {
    const barrier = await x.db.pool.connect();
    const pumps: Promise<void>[] = [];
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
      const holder = (await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      pumps.push(new NodeExecution(x.db, x.service.instanceId).pump(), new NodeExecution(x.db, x.service.instanceId).pump());
      for (const pending of pumps) void pending.catch(() => undefined);
      await expect.poll(async () => (await x.admin.pool.query(`WITH RECURSIVE waiting(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
      ) SELECT pid FROM waiting`, [holder])).rowCount, { timeout: 5000 }).toBe(2);
    } finally {
      await barrier.query('COMMIT');
      barrier.release();
      await Promise.all(pumps);
    }
    expect(await sourceNodes()).toEqual([x.f.node]);
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE task_id=$1 AND kind=\'node\'', [x.f.task])).rowCount).toBe(1);
    const promoted = await Promise.all([
      x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation),
      x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation),
    ]);
    expect(promoted.filter(Boolean)).toHaveLength(1);
    expect(promoted.find(Boolean)?.node_id).toBe(x.f.node);
    expect((await x.db.pool.query("SELECT o.id FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND a.kind='node' AND o.kind='start'", [x.f.task])).rowCount).toBe(1);
  });

  it('retains guidance for an unprepared dependent until the repository-free upstream settles', async () => {
    const first = await x.node();
    await x.send('Clarify the dependent work before it starts');
    const turn = await x.turn();
    const reply = await x.reply(turn, { kind: 'guidance', text: 'DEPENDENT_GUIDANCE_AFTER_WAIT',
      basis: { ...await x.basis(), node_id: downstream, node_activation: 1, source_id: null } });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    await expect(x.conversation.pump()).resolves.toBeUndefined();
    expect((await x.execution.status(x.token, x.f.task, downstream)).source).toBeNull();
    expect((await x.db.pool.query('SELECT status FROM task_guidance_followups WHERE node_id=$1', [downstream])).rows).toEqual([{ status: 'waiting' }]);
    await finishNode(first, 'Upstream permits dependent guidance');
    await x.conversation.pump();
    const second = await x.node();
    expect(second.dispatch.node_id).toBe(downstream);
    expect(second.dispatch.prompt).toContain('DEPENDENT_GUIDANCE_AFTER_WAIT');
    const completed = await x.agent(second, 'complete_node', { summary: 'Handled dependent instruction', handled_guidance_ids: [reply.result!.obligation_id!] });
    await x.finish(completed.operation_id!, second.dispatch.attempt_id);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_followups WHERE node_id=$1', [downstream])).rows).toEqual([{ status: 'done' }]);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_obligations WHERE guidance_id=$1', [reply.result!.obligation_id])).rows).toEqual([{ status: 'handled' }]);
  });

  it('rejects a captured unqueued source after guidance invalidates it and launches the guided replacement', async () => {
    await x.service.disconnect(x.f.runner, x.f.incarnation);
    await x.execution.pump();
    const captured = (await x.db.pool.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE node_id=$1', [x.f.node])).rows[0]!;
    expect(captured).toMatchObject({ done: false, waiting_reason: 'runner_offline' });
    expect((await x.execution.status(x.token, x.f.task, x.f.node)).attempt).toBeNull();
    x.f.incarnation = await x.service.connect(x.f.runner, 'guidance-source-race');
    await x.service.touch(x.f.runner, x.f.incarnation, true, [{
      runtime_id: 'opencode', executable: '/opencode', availability: 'detected',
      supports_model: true, supports_thinking: false, model_ids: [],
    }]);
    await x.send('Apply the guidance before prepared work starts');
    const turn = await x.turn();
    const reply = await x.reply(turn, { kind: 'guidance', text: 'GUIDANCE_REPLACES_CAPTURED_SOURCE', basis: await x.basis() });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    expect((await x.db.pool.query('SELECT state,execution_source_id FROM nodes WHERE id=$1', [x.f.node])).rows[0]).toEqual({ state: 'PENDING', execution_source_id: captured.id });
    expect((await x.db.pool.query('SELECT done FROM node_execution_outbox WHERE id=$1', [captured.id])).rows[0].done).toBe(true);
    expect((await x.db.pool.query('SELECT status,source_id FROM task_guidance_followups WHERE node_id=$1', [x.f.node])).rows).toEqual([{ status: 'waiting', source_id: captured.id }]);
    // Replay the source-list snapshot taken before guidance committed, without
    // advancing the follow-up that will replace the Node's source pointer.
    await expect(transaction(x.db, (tx) => new RuntimeScheduling(x.queue, x.service.instanceId).selectAndEnqueue(tx, {
      attempt_id: captured.planned_attempt_id, task_id: captured.task_id, node_id: captured.node_id,
      kind: 'node', role_id: captured.role_id,
      expected: { control_version: Number(captured.expected_version), specification_id: captured.specification_id, plan_id: captured.plan_id },
      prompt: captured.prompt!, source_watermark: 0, node_execution_source: nodeSource(captured),
    }))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE id=$1', [captured.planned_attempt_id])).rowCount).toBe(0);
    await x.conversation.pump();
    const guided = await x.node();
    expect(guided.dispatch.node_execution_source!.source_id).not.toBe(captured.id);
    expect(guided.dispatch.prompt).toContain('GUIDANCE_REPLACES_CAPTURED_SOURCE');
    const completion = await x.agent(guided, 'complete_node', {
      summary: 'Only the guided replacement executed', handled_guidance_ids: [reply.result!.obligation_id!],
    });
    await x.finish(completion.operation_id!, guided.dispatch.attempt_id);
    expect((await x.db.pool.query("SELECT o.id FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.node_id=$1 AND o.kind='start'", [x.f.node])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_obligations WHERE guidance_id=$1', [reply.result!.obligation_id])).rows).toEqual([{ status: 'handled' }]);
  });

  it('waits for a running descendant before completed upstream guidance reactivates the exact subgraph', async () => {
    const first = await x.node();
    await finishNode(first, 'First upstream result');
    const second = await x.node();
    expect(second.dispatch.node_id).toBe(downstream);
    await x.send('Correct the completed upstream work');
    const turn = await x.turn();
    const reply = await x.reply(turn, { kind: 'guidance', text: 'UPSTREAM_CORRECTION_AFTER_DESCENDANT', basis: await x.basis() });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    await expect(x.conversation.pump()).resolves.toBeUndefined();
    expect((await x.execution.status(x.token, x.f.task, x.f.node)).node_activation).toBe(1);
    expect((await x.execution.status(x.token, x.f.task, downstream)).node_activation).toBe(1);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_followups WHERE node_id=$1', [x.f.node])).rows).toEqual([{ status: 'waiting' }]);
    await finishNode(second, 'Retained historical descendant result');
    await x.conversation.pump();
    const corrected = await x.node();
    expect(corrected.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 2 });
    expect(corrected.dispatch.prompt).toContain('UPSTREAM_CORRECTION_AFTER_DESCENDANT');
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ state: 'PENDING', node_activation: 2, source: null });
    expect((await x.execution.status(x.token, x.f.task, independent)).node_activation).toBe(1);
    expect((await x.db.pool.query('SELECT activation FROM node_completions WHERE node_id=$1', [downstream])).rows).toEqual([{ activation: '1' }]);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_followups WHERE node_id=$1', [x.f.node])).rows).toEqual([{ status: 'done' }]);
  });
});
