import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { OwnerCommand } from '../../../packages/protocol/src/index.ts';
import { issueAttemptCredential } from '../src/auth.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { OwnerCommands, issueOwnerSession } from '../src/owner-commands.ts';
import { BoundaryService } from '../src/service.ts';
import { initializeTask } from '../src/task-records.ts';

const signingKey = 'owner-execution-regression-signing-key';
const error = (code: string) => ({ detail: { code } });
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Owner Stop and recovery', () => {
  let db: Database; let admin: Database; let owner: OwnerCommands;
  const namespace = `owner_exec_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db); owner = new OwnerCommands(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function node() {
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID(), 2);
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: 'Owner Stop test' });
    const session = await issueOwnerSession(db); const service = new BoundaryService(db, { signingKey });
    const incarnation = await service.connect(runner, 'boot-one'); await service.touch(runner, incarnation, true);
    const stop: OwnerCommand = { schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: 1, name: 'stop_node', payload: { attempt_id: launch.attempt_id, node_id: launch.node_id!, node_activation: 1 } };
    return { runner, launch, session, service, incarnation, stop };
  }
  it('fences a running Node, retains its slot until Stop settles and replays the exact receipt', async () => {
    const f = await node();
    const stopped = await owner.confirm(f.session.token, f.stop);
    expect(stopped).toMatchObject({ status: 'admitted', attempt_id: f.launch.attempt_id, end_reason: 'owner_stopped' });
    expect(await owner.confirm(f.session.token, f.stop)).toEqual(stopped);
    await expect(owner.confirm(f.session.token, { ...f.stop, payload: { ...f.stop.payload, node_activation: 2 } })).rejects.toMatchObject(error('payload_conflict'));
    await expect(owner.confirm(f.session.token, { ...f.stop, payload: { ...f.stop.payload, attempt_id: randomUUID() } })).rejects.toMatchObject(error('payload_conflict'));
    expect((await db.pool.query('SELECT state,process_released,mutation_allowed FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', process_released: false, mutation_allowed: false });
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('BLOCKED');
    const attemptToken = issueAttemptCredential({ attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, fencing_generation: 1, expires: Date.now() + 60000 }, signingKey);
    await expect(f.service.admit(attemptToken, submission({ schema_version: 1, request_id: randomUUID(), scope_id: f.launch.task_id,
      expected_control_version: 1, name: 'complete_node', payload: { summary: 'late completion' } }))).rejects.toMatchObject(error('stale_execution'));
    const continueCommand: OwnerCommand = { ...f.stop, request_id: randomUUID(), expected_control_version: 2, name: 'continue_node' };
    await expect(owner.confirm(f.session.token, continueCommand)).rejects.toMatchObject(error('unmet_precondition'));
    expect(await owner.operation(f.session.token, f.launch.task_id, stopped.operation_id!)).toMatchObject({ state: 'admitted', process_released: false, attention: false });
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: stopped.operation_id!, attempt_id: f.launch.attempt_id, success: true, result: { writer_absent: true } });
    expect(await owner.operation(f.session.token, f.launch.task_id, stopped.operation_id!)).toMatchObject({ state: 'succeeded', process_absent: true, process_released: true });
    const continued = await owner.confirm(f.session.token, continueCommand);
    expect(continued).toMatchObject({ status: 'committed', control_version: 3 });
    expect(await owner.confirm(f.session.token, continueCommand)).toEqual(continued);
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('PENDING');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.launch.task_id])).rows[0].state).toBe('RUNNING');
    const queue = new DispatchQueue(db);
    const successor = randomUUID();
    await transaction(db, (tx) => queue.enqueue(tx, { attempt_id: successor, runner_id: f.runner, task_id: f.launch.task_id,
      node_id: f.launch.node_id, kind: 'node', expected: { control_version: 3, specification_id: `spec_${f.launch.task_id}`, plan_id: `plan_${f.launch.task_id}` },
      resource_id: 'repo', runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt: 'current canonical fixture', source_watermark: 1 }));
    expect((await queue.promoteNext(f.runner, f.service.instanceId, f.incarnation))?.attempt_id).toBe(successor);
  });

  it('keeps independent runnable Nodes eligible when the Owner stops one Node', async () => {
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID(), 2);
    const taskId = randomUUID(); const specId = `spec_${taskId}`; const planId = `plan_${taskId}`;
    const stoppedNode = randomUUID();
    const otherNode = randomUUID();
    await transaction(db, async (tx) => {
      await initializeTask(tx, { task_id: taskId, specification_id: specId, specification: { title: 'independent work' } });
      await tx.query("UPDATE tasks SET resource_id='repo',state='RUNNING' WHERE id=$1", [taskId]);
      await tx.query('INSERT INTO plan_revisions(id,task_id,content,specification_id) VALUES($1,$2,$3,$4)',
        [planId, taskId, { node_ids: [stoppedNode, otherNode] }, specId]);
      for (const [nodeId, state] of [[stoppedNode, 'RUNNING'], [otherNode, 'PENDING']]) {
        await tx.query('INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,$3)', [nodeId, taskId, state]);
        await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)',
          [taskId, planId, nodeId, { node_id: nodeId, dependencies: [] }]);
        await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')",
          [taskId, nodeId, specId, planId]);
      }
      await tx.query('UPDATE tasks SET plan_id=$2 WHERE id=$1', [taskId, planId]);
    });
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: taskId,
      node_id: stoppedNode, kind: 'node', resource_id: 'repo', prompt: 'independent work' });
    const session = await issueOwnerSession(db);
    await owner.confirm(session.token, { schema_version: 1, request_id: randomUUID(), scope_id: taskId,
      expected_control_version: 1, name: 'stop_node', payload: { attempt_id: launch.attempt_id, node_id: stoppedNode, node_activation: 1 } });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [taskId])).rows[0].state).toBe('RUNNING');
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [otherNode])).rows[0].state).toBe('PENDING');
  });

  it('retains the process claim until an earlier workspace effect settles before Stop', async () => {
    const f = await node();
    const token = issueAttemptCredential({ attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id,
      fencing_generation: 1, expires: Date.now() + 60000 }, signingKey);
    const workspace = await f.service.admit(token, submission({ schema_version: 1, request_id: randomUUID(),
      scope_id: f.launch.task_id, expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'repo' } }));
    const stopped = await owner.confirm(f.session.token, f.stop);
    const stoppedResult = { operation_id: stopped.operation_id!, attempt_id: f.launch.attempt_id,
      success: true, result: { writer_absent: true } };
    await expect(f.service.finishOperation(f.runner, f.incarnation, stoppedResult)).rejects.toMatchObject(error('unmet_precondition'));
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(false);
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: workspace.operation_id!,
      attempt_id: f.launch.attempt_id, success: true, result: { workspace_id: randomUUID(), path: '/tmp/owner-stop-test' } });
    await f.service.finishOperation(f.runner, f.incarnation, stoppedResult);
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].process_released).toBe(true);
  });

  it('cancels a queued Node without a Stop operation and allows Continue only after the exact receipt', async () => {
    const f = await node();
    await transaction(db, async (tx) => {
      await tx.query("UPDATE attempts SET state='QUEUED',mutation_allowed=false,process_released=true WHERE id=$1", [f.launch.attempt_id]);
      await tx.query("UPDATE nodes SET state='PENDING' WHERE id=$1", [f.launch.node_id]);
    });
    const stopped = await owner.confirm(f.session.token, f.stop);
    expect(stopped).toMatchObject({ status: 'committed', control_version: 2 });
    expect(stopped.operation_id).toBeUndefined();
    expect((await db.pool.query('SELECT state,process_absent,process_released FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', process_absent: true, process_released: true });
    expect((await db.pool.query('SELECT count(*) FROM operations WHERE attempt_id=$1', [f.launch.attempt_id])).rows[0].count).toBe('0');
    const continued = await owner.confirm(f.session.token, { ...f.stop, request_id: randomUUID(), expected_control_version: 2, name: 'continue_node' });
    expect(continued).toMatchObject({ status: 'committed', control_version: 3 });
    // A later blocker cannot consume the same old Owner-stop decision again.
    await db.pool.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1", [f.launch.node_id]);
    await db.pool.query("UPDATE tasks SET state='BLOCKED',control_version=4 WHERE id=$1", [f.launch.task_id]);
    await expect(owner.confirm(f.session.token, { ...f.stop, request_id: randomUUID(), expected_control_version: 4, name: 'continue_node' })).rejects.toMatchObject(error('unmet_precondition'));
  });

  it('lets an already admitted completion win without creating a competing Stop', async () => {
    const f = await node();
    const token = issueAttemptCredential({ attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, fencing_generation: 1, expires: Date.now() + 60000 }, signingKey);
    const completed = await f.service.admit(token, submission({ schema_version: 1, request_id: randomUUID(), scope_id: f.launch.task_id,
      expected_control_version: 1, name: 'complete_node', payload: { summary: 'finished' } }));
    expect(completed.status).toBe('admitted');
    const stop = await owner.confirm(f.session.token, f.stop);
    expect(stop).toMatchObject({ status: 'admitted', operation_id: completed.operation_id });
    expect((await db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1 AND kind='stop'", [f.launch.attempt_id])).rows[0].count).toBe('0');
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: completed.operation_id!, attempt_id: f.launch.attempt_id, success: true,
      result: { writer_absent: true, git_commit: 'a'.repeat(40), git_tree: 'b'.repeat(40) } });
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('COMPLETED');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.launch.task_id])).rows[0].state).toBe('REVIEW');
  });

  it('retries a factual missing-result blocker only after its Stop released the old writer', async () => {
    const f = await node();
    await f.service.event(f.runner, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id,
      stream_id: 'runtime', sequence: 1, kind: 'exited', text: 'main process ended without formal handoff' });
    const stop = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [f.launch.attempt_id])).rows[0];
    expect(stop).toBeTruthy();
    const retry: OwnerCommand = { ...f.stop, request_id: randomUUID(), expected_control_version: 2, name: 'retry_node' };
    await expect(owner.confirm(f.session.token, retry)).rejects.toMatchObject(error('unmet_precondition'));
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: stop.id, attempt_id: f.launch.attempt_id, success: true, result: { writer_absent: true } });
    expect(await owner.confirm(f.session.token, retry)).toMatchObject({ status: 'committed', control_version: 3 });
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [f.launch.node_id])).rows[0].state).toBe('PENDING');
    await expect(owner.confirm(f.session.token, { ...retry, request_id: randomUUID(), expected_control_version: 3, name: 'continue_node' })).rejects.toMatchObject(error('unmet_precondition'));
  });

  it('reconciles a running pre-Plan Stop after backend and Runner reconnect with the same operation', async () => {
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID(), 1);
    const taskId = randomUUID(); const basis = await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: { title: 'preplan running' } }));
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [taskId]);
    const attemptId = randomUUID(); const queue = new DispatchQueue(db);
    await transaction(db, (tx) => queue.enqueue(tx, { attempt_id: attemptId, runner_id: runner, task_id: taskId, kind: 'planner', expected: basis,
      resource_id: 'repo', runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt: 'preplan running', source_watermark: 1 }));
    const first = new BoundaryService(db, { signingKey }); const firstIncarnation = await first.connect(runner, 'boot-one'); await first.touch(runner, firstIncarnation, true);
    expect((await queue.promoteNext(runner, first.instanceId, firstIncarnation))?.attempt_id).toBe(attemptId);
    const session = await issueOwnerSession(db);
    const stop: OwnerCommand = { schema_version: 1, request_id: randomUUID(), scope_id: taskId, expected_control_version: 1, name: 'stop_initial_planning', payload: { attempt_id: attemptId } };
    const result = await owner.confirm(session.token, stop);
    expect(result.status).toBe('admitted');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [taskId])).rows[0].state).toBe('PLANNING');
    const restarted = new BoundaryService(db, { signingKey });
    const before = await restarted.inventory(runner);
    expect(before.dispatches.some((dispatch) => dispatch.attempt_id === attemptId && !dispatch.mutation_allowed)).toBe(true);
    expect(before.operations.some((operation) => operation.operation_id === result.operation_id)).toBe(true);
    const incarnation = await restarted.connect(runner, 'boot-two'); await restarted.touch(runner, incarnation, true);
    const frames = await restarted.pending(runner, incarnation);
    expect(frames.some((frame) => frame.type === 'effect' && frame.operation?.operation_id === result.operation_id)).toBe(true);
    expect(frames.some((frame) => frame.type === 'start' && frame.dispatch?.attempt_id === attemptId)).toBe(false);
    await restarted.finishOperation(runner, incarnation, { operation_id: result.operation_id!, attempt_id: attemptId, success: true, result: { writer_absent: true } });
    const retry: OwnerCommand = { ...stop, request_id: randomUUID(), expected_control_version: 2, name: 'retry_initial_planning' };
    expect(await owner.confirm(session.token, retry)).toMatchObject({ status: 'committed', control_version: 3 });
    expect(await owner.confirm(session.token, stop)).toEqual(result);
  });

  it('cancels queued initial planning without a process and retries only the settled Planner', async () => {
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID(), 1);
    const taskId = randomUUID(); const basis = await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: { title: 'preplan' } }));
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [taskId]);
    const attemptId = randomUUID(); const queue = new DispatchQueue(db);
    await transaction(db, (tx) => queue.enqueue(tx, { attempt_id: attemptId, runner_id: runner, task_id: taskId, kind: 'planner', expected: basis,
      resource_id: 'repo', runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt: 'preplan', source_watermark: 1 }));
    const session = await issueOwnerSession(db);
    const stop: OwnerCommand = { schema_version: 1, request_id: randomUUID(), scope_id: taskId, expected_control_version: 1, name: 'stop_initial_planning', payload: { attempt_id: attemptId } };
    const result = await owner.confirm(session.token, stop);
    expect(result).toMatchObject({ status: 'committed', end_reason: 'owner_stopped', control_version: 2 });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [taskId])).rows[0].state).toBe('PLANNING');
    expect((await db.pool.query('SELECT state,process_absent,process_released FROM attempts WHERE id=$1', [attemptId])).rows[0]).toEqual({ state: 'CANCELLED', process_absent: true, process_released: true });
    expect((await db.pool.query("SELECT count(*) FROM operations WHERE attempt_id=$1", [attemptId])).rows[0].count).toBe('0');
    const retry: OwnerCommand = { ...stop, request_id: randomUUID(), expected_control_version: 2, name: 'retry_initial_planning' };
    expect(await owner.confirm(session.token, retry)).toMatchObject({ status: 'committed', control_version: 3 });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [taskId])).rows[0].state).toBe('RUNNING');
    const successor = randomUUID();
    await transaction(db, (tx) => queue.enqueue(tx, { attempt_id: successor, runner_id: runner, task_id: taskId, kind: 'planner',
      expected: { ...basis, control_version: 3 }, resource_id: 'repo', runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free',
      prompt: 'new current fixture', source_watermark: 2 }));
    const service = new BoundaryService(db, { signingKey }); const incarnation = await service.connect(runner, 'boot-one'); await service.touch(runner, incarnation, true);
    expect((await queue.promoteNext(runner, service.instanceId, incarnation))?.attempt_id).toBe(successor);
  });
});
