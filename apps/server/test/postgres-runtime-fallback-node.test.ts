import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { RuntimeContinuation } from '../src/runtime-continuation.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Node Runtime continuation', () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let continuation: RuntimeContinuation;
  const primaryModel = 'opencode/longcat-2.5-preview-free';
  const fallbackModel = 'volcengine/deepseek-v4-flash-ga-260731';

  beforeEach(async () => {
    x = await conversationFixture();
    continuation = new RuntimeContinuation(x.db);
  });
  afterEach(async () => { await x?.close(); });

  async function policy(fallback = true) {
    const configuration = new Configuration(x.db);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_policies', payload: { global: {
        default_target: { runtime_id: 'opencode', model_id: primaryModel, runner_id: x.f.runner },
        fallback_targets: fallback ? [{ runtime_id: 'opencode', model_id: fallbackModel, runner_id: x.f.runner }] : [{ runtime_id: 'unavailable' }],
      } },
    });
  }

  async function launch(fallback = true) {
    await x.start();
    await policy(fallback);
    return x.node();
  }

  async function fail(a: Awaited<ReturnType<typeof x.node>>) {
    const event: RuntimeEvent = {
      attempt_id: a.dispatch.attempt_id, dispatch_id: a.dispatch.dispatch_id,
      stream_id: 'runtime', sequence: 1, order_sequence: 1, kind: 'exited', exit_code: 1,
      runtime_failure: 'native_terminal_error', text: 'synthetic terminal Runtime evidence',
    };
    await x.service.event(x.f.runner, x.f.incarnation, event);
    const row = (await x.db.pool.query<{ stop_operation_id: string; state: string }>('SELECT * FROM runtime_continuations WHERE predecessor_attempt_id=$1', [a.dispatch.attempt_id])).rows[0]!;
    expect(row).toBeDefined();
    return row;
  }

  async function pump() {
    await continuation.pump();
    await x.execution.pump();
  }

  it('waits for the exact Stop and rebuilds fresh context on the same Node activation', async () => {
    const resource = randomUUID();
    const configuration = new Configuration(x.db);
    let snapshot = await configuration.read(x.token);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: snapshot.control_version,
      name: 'save_project', payload: { ...snapshot.projects.find((p) => p.id === x.f.project)!,
        resources: [{ id: resource, remote_url: 'https://github.com/example/runtime-fallback.git', default_branch: 'main', remote_preparation: 'after_acceptance' }] },
    });
    const a = await launch();
    const artifact = randomUUID();
    await x.agent(a, 'publish_artifact', { artifact_id: artifact, title: 'Retained output', content: { text: 'Current activation output', media_type: 'text/plain' } });
    const failed = await fail(a);
    await x.service.finishOperation(x.f.runner, x.f.incarnation, {
      operation_id: failed.stop_operation_id, attempt_id: a.dispatch.attempt_id, success: false,
      result: { message: 'synthetic Stop recovery still owns the writer' },
    });
    await pump();
    let status = await x.execution.status(x.token, x.f.task, x.f.node);
    expect(status).toMatchObject({ state: 'RUNNING', node_activation: 1, blocker: null });
    expect(status.waiting_reason).not.toBeNull();
    expect(status.source?.source_id).toBe(a.dispatch.node_execution_source!.source_id);
    expect((await x.db.pool.query('SELECT id FROM node_execution_outbox WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    snapshot = await configuration.read(x.token);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: snapshot.control_version,
      name: 'save_role', payload: { ...snapshot.roles.find((r) => r.id === x.f.role)!, instructions: 'CURRENT_ROLE_AFTER_RUNTIME_FAILURE' },
    });
    await x.finish(failed.stop_operation_id, a.dispatch.attempt_id);
    await pump();
    const successor = await x.promote();
    expect(successor.dispatch).toMatchObject({ node_id: x.f.node, node_activation: a.dispatch.node_activation, runner_id: x.f.runner, model: fallbackModel });
    expect(successor.dispatch.attempt_id).not.toBe(a.dispatch.attempt_id);
    expect(successor.dispatch.workspace_reservations?.resources).toEqual(a.dispatch.workspace_reservations?.resources);
    const context = JSON.parse(successor.dispatch.prompt);
    expect(context.role.instructions).toBe('CURRENT_ROLE_AFTER_RUNTIME_FAILURE');
    expect(context.artifact_history.items).toEqual(expect.arrayContaining([expect.objectContaining({ artifact_id: artifact })]));
    expect(context.recovery).toMatchObject({ runtime_predecessor_attempt_id: a.dispatch.attempt_id, prior_source_id: a.dispatch.node_execution_source!.source_id });
    expect((await x.db.pool.query('SELECT runtime_predecessor_id,runtime_target_index FROM attempts WHERE id=$1', [successor.dispatch.attempt_id])).rows[0]).toMatchObject({ runtime_predecessor_id: a.dispatch.attempt_id, runtime_target_index: 1 });
    status = await x.execution.status(x.token, x.f.task, x.f.node);
    expect(status.blocker).toBeNull();
    await expect(x.agent(a, 'publish_artifact', { artifact_id: randomUUID(), title: 'Stale', content: { text: 'old authority', media_type: 'text/plain' } })).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
  });

  it.each(['settling', 'prepared'] as const)('Owner Stop supersedes a %s continuation and Continue starts a fresh policy chain', async (phase) => {
    const a = await launch();
    const failed = await fail(a);
    if (phase === 'prepared') {
      await x.finish(failed.stop_operation_id, a.dispatch.attempt_id);
      await continuation.pump();
    }
    const before = await x.execution.status(x.token, x.f.task, x.f.node);
    await x.owner('stop_node', { node_id: x.f.node, node_activation: before.node_activation, source_id: before.source!.source_id });
    if (phase === 'settling') await x.finish(failed.stop_operation_id, a.dispatch.attempt_id);
    await pump();
    const stopped = await x.execution.status(x.token, x.f.task, x.f.node);
    expect(stopped).toMatchObject({ state: 'BLOCKED', blocker: { kind: 'owner_stopped' } });
    expect((await x.db.pool.query('SELECT state FROM runtime_continuations WHERE predecessor_attempt_id=$1', [a.dispatch.attempt_id])).rows[0].state).toBe('superseded');
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    await x.owner('continue_node', { node_id: x.f.node, node_activation: stopped.node_activation, source_id: stopped.source!.source_id, blocker_id: stopped.blocker!.id });
    await x.execution.pump();
    const continued = await x.promote();
    expect(continued.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 1, model: primaryModel });
    expect((await x.db.pool.query('SELECT runtime_predecessor_id FROM attempts WHERE id=$1', [continued.dispatch.attempt_id])).rows[0].runtime_predecessor_id).toBeNull();
  });

  it('records one factual blocker on suffix exhaustion and Owner Retry re-resolves policy', async () => {
    const a = await launch(false);
    const failed = await fail(a);
    await x.finish(failed.stop_operation_id, a.dispatch.attempt_id);
    await pump();
    await pump();
    const status = await x.execution.status(x.token, x.f.task, x.f.node);
    expect(status).toMatchObject({ state: 'BLOCKED', blocker: { kind: 'factual' } });
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT id FROM node_blockers WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT state,resolved_at FROM runtime_continuations WHERE predecessor_attempt_id=$1', [a.dispatch.attempt_id])).rows[0]).toMatchObject({ state: 'exhausted', resolved_at: expect.any(Date) });
    await policy();
    await x.owner('retry_node', { node_id: x.f.node, node_activation: status.node_activation, source_id: status.source!.source_id, blocker_id: status.blocker!.id });
    await x.execution.pump();
    const retry = await x.promote();
    expect(retry.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 1, model: primaryModel });
  });

  it('consumes the original frozen multi-hop suffix after policy changes without resetting workspace ownership', async () => {
    const configuration = new Configuration(x.db);
    const snapshot = await configuration.read(x.token);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: snapshot.control_version,
      name: 'save_project', payload: { ...snapshot.projects.find((p) => p.id === x.f.project)!,
        resources: [{ id: randomUUID(), remote_url: 'https://github.com/example/frozen-runtime-chain.git', default_branch: 'main', remote_preparation: 'after_acceptance' }] },
    });
    await x.start();
    await x.service.touch(x.f.runner, x.f.incarnation, true, [
      { runtime_id: 'opencode', executable: '/opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] },
      { runtime_id: 'codex', executable: '/codex', availability: 'detected', supports_model: true, supports_thinking: true, model_ids: [] },
    ]);
    const targets = [
      { runtime_id: 'opencode', model_id: primaryModel, runner_id: x.f.runner },
      { runtime_id: 'opencode', model_id: fallbackModel, runner_id: x.f.runner },
      { runtime_id: 'codex', model_id: 'owner/frozen-last', thinking_level: 'high', runner_id: x.f.runner },
    ];
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_policies', payload: { global: { default_target: targets[0]!, fallback_targets: targets.slice(1) } },
    });
    const first = await x.node();
    const frozen = (await x.db.pool.query('SELECT selection_context FROM attempts WHERE id=$1', [first.dispatch.attempt_id])).rows[0].selection_context;
    expect(frozen.policy_targets).toEqual(targets);
    expect(first.dispatch.workspace_reservations?.resources).toHaveLength(1);
    const firstFailure = await fail(first);
    await x.finish(firstFailure.stop_operation_id, first.dispatch.attempt_id);
    await pump();
    const second = await x.promote();
    expect(second.dispatch.model).toBe(fallbackModel);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_policies', payload: { global: {
        default_target: { runtime_id: 'codex', model_id: 'owner/reconfigured', runner_id: x.f.runner },
        fallback_targets: [{ runtime_id: 'opencode', model_id: primaryModel, runner_id: x.f.runner }],
      } },
    });
    const secondFailure = await fail(second);
    await x.finish(secondFailure.stop_operation_id, second.dispatch.attempt_id);
    await pump();
    const third = await x.promote();
    expect(third.dispatch).toMatchObject({ runtime_id: 'codex', model: 'owner/frozen-last', thinking_level: 'high' });
    for (const [index, attempt] of [first, second, third].entries()) {
      expect(attempt.dispatch).toMatchObject({ node_id: x.f.node, node_activation: first.dispatch.node_activation, runner_id: x.f.runner });
      expect(attempt.dispatch.workspace_reservations?.resources).toEqual(first.dispatch.workspace_reservations?.resources);
      expect((await x.db.pool.query('SELECT runtime_chain_root_id,runtime_target_index,runtime_predecessor_id,selection_context FROM attempts WHERE id=$1', [attempt.dispatch.attempt_id])).rows[0]).toMatchObject({
        runtime_chain_root_id: first.dispatch.attempt_id, runtime_target_index: index,
        runtime_predecessor_id: index === 0 ? null : [first, second][index - 1]!.dispatch.attempt_id,
        selection_context: { policy_targets: targets, source: frozen.source, configuration_version: frozen.configuration_version, target: targets[index] },
      });
    }
    const thirdFailure = await fail(third);
    await x.finish(thirdFailure.stop_operation_id, third.dispatch.attempt_id);
    await pump();
    await pump();
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=$1', [x.f.node])).rowCount).toBe(3);
    expect((await x.db.pool.query('SELECT state,resolved_at FROM runtime_continuations WHERE predecessor_attempt_id=$1', [third.dispatch.attempt_id])).rows[0]).toMatchObject({ state: 'exhausted', resolved_at: expect.any(Date) });
    expect(await x.execution.status(x.token, x.f.task, x.f.node)).toMatchObject({ state: 'BLOCKED', blocker: { kind: 'factual' } });
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
  });

  it('serializes concurrent coordinators and replay after process absence reports Runtime failure before exit', async () => {
    const first = await launch();
    const event: RuntimeEvent = {
      attempt_id: first.dispatch.attempt_id, dispatch_id: first.dispatch.dispatch_id,
      stream_id: 'runtime', sequence: 1, order_sequence: 1, kind: 'process_absent',
      runtime_failure: 'native_terminal_error', text: 'synthetic absence-first terminal Runtime evidence',
    };
    await Promise.all([
      x.service.event(x.f.runner, x.f.incarnation, event),
      x.service.event(x.f.runner, x.f.incarnation, event),
    ]);
    await x.service.event(x.f.runner, x.f.incarnation, {
      attempt_id: first.dispatch.attempt_id, dispatch_id: first.dispatch.dispatch_id,
      stream_id: 'runtime', sequence: 2, order_sequence: 2, kind: 'exited', exit_code: 1, text: 'later exit observation',
    });
    const failures = (await x.db.pool.query('SELECT * FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ state: 'settling', failure_stream_id: 'runtime', failure_sequence: '1' });
    expect((await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [first.dispatch.attempt_id])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT end_reason,process_absent,exit_observed FROM attempts WHERE id=$1', [first.dispatch.attempt_id])).rows[0]).toEqual({ end_reason: 'runtime_error', process_absent: true, exit_observed: true });
    await x.finish(failures[0].stop_operation_id, first.dispatch.attempt_id);
    const barrier = await x.db.pool.connect();
    const workers: Promise<void>[] = [];
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [x.f.runner]);
      const holder = (await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      workers.push(new RuntimeContinuation(x.db).pump(), new RuntimeContinuation(x.db).pump());
      for (const worker of workers) void worker.catch(() => undefined);
      // Prove both database transactions overlap, including a waiter queued
      // behind the first coordinator instead of directly behind this barrier.
      await expect.poll(async () => (await x.admin.pool.query(`WITH RECURSIVE waiting(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
      ) SELECT pid FROM waiting`, [holder])).rowCount, { timeout: 5000 }).toBe(2);
    } finally {
      await barrier.query('COMMIT');
      barrier.release();
      await Promise.all(workers);
    }
    await x.execution.pump();
    const second = await x.promote();
    await x.service.event(x.f.runner, x.f.incarnation, event);
    await pump();
    expect(second.dispatch.model).toBe(fallbackModel);
    expect((await x.db.pool.query('SELECT id FROM node_execution_outbox WHERE node_id=$1', [x.f.node])).rowCount).toBe(2);
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE runtime_predecessor_id=$1', [first.dispatch.attempt_id])).rows).toEqual([{ id: second.dispatch.attempt_id }]);
    expect((await x.db.pool.query("SELECT id FROM outbox WHERE attempt_id=$1 AND kind='start'", [second.dispatch.attempt_id])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT state,successor_planned_attempt_id,resolved_at FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows[0]).toEqual({ state: 'queued', successor_planned_attempt_id: second.dispatch.attempt_id, resolved_at: expect.any(Date) });
    expect((await x.db.pool.query('SELECT id FROM node_blockers WHERE node_id=$1', [x.f.node])).rowCount).toBe(0);
  });

  it('resolves a prepared continuation when canonical Owner guidance replaces its source', async () => {
    const first = await launch();
    const failed = await fail(first);
    await x.finish(failed.stop_operation_id, first.dispatch.attempt_id);
    await continuation.pump();
    const prepared = (await x.db.pool.query('SELECT * FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows[0];
    expect(prepared.state).toBe('prepared');
    await x.send('Apply the clarified formatting guidance');
    await continuation.pump();
    expect((await x.db.pool.query('SELECT state,resolved_at FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows[0]).toEqual({ state: 'prepared', resolved_at: null });
    const turn = await x.turn();
    const reply = await x.reply(turn, { kind: 'guidance', text: 'Use the clarified formatting', basis: await x.basis() });
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    await x.conversation.pump();
    await pump();
    const guided = await x.promote();
    expect(guided.dispatch).toMatchObject({ node_id: x.f.node, node_activation: first.dispatch.node_activation, model: primaryModel });
    expect(guided.dispatch.prompt).toContain('Use the clarified formatting');
    expect((await x.db.pool.query('SELECT runtime_predecessor_id FROM attempts WHERE id=$1', [guided.dispatch.attempt_id])).rows[0].runtime_predecessor_id).toBeNull();
    expect((await x.db.pool.query('SELECT state,reason,resolved_at FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows[0]).toEqual({ state: 'superseded', reason: 'prepared_source_changed', resolved_at: expect.any(Date) });
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE id=$1', [prepared.successor_planned_attempt_id])).rowCount).toBe(0);
  });

  it('Cancel after preparation leaves no runnable continuation source', async () => {
    const a = await launch();
    const failed = await fail(a);
    await x.finish(failed.stop_operation_id, a.dispatch.attempt_id);
    await continuation.pump();
    await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    await pump();
    expect((await x.db.pool.query('SELECT state FROM nodes WHERE id=$1', [x.f.node])).rows[0].state).toBe('CANCELLED');
    expect((await x.db.pool.query('SELECT state FROM runtime_continuations WHERE predecessor_attempt_id=$1', [a.dispatch.attempt_id])).rows[0].state).toBe('superseded');
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=$1', [x.f.node])).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT id FROM node_execution_outbox WHERE node_id=$1 AND NOT done', [x.f.node])).rowCount).toBe(0);
  });
});
