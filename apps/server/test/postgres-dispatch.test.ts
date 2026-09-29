import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import type { TaskQueueInput as QueueInput } from '../src/dispatch-queue.ts';
import { initializeTask, publishInitialPlan } from '../src/task-records.ts';
import { BoundaryService } from '../src/service.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { Worker } from './fixtures/process-worker.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('durable selected Attempt dispatch', () => {
  let db: Database; let admin: Database; let queue: DispatchQueue; let url: string;
  const namespace = `dispatch_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const parsed = new URL(process.env.DATABASE_URL); parsed.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    url = parsed.toString(); db = database(url); await migrate(db); queue = new DispatchQueue(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function runner(capacity = 1) {
    const id = randomUUID(); await enrollFixture(db, id, randomUUID(), capacity);
    const service = new BoundaryService(db, { signingKey: 'test-only-dispatch-queue-signing-key' });
    const incarnation = await service.connect(id, 'boot'); await service.touch(id, incarnation, true);
    return { id, service, incarnation };
  }
  async function input(runnerId: string): Promise<QueueInput> {
    const task_id = randomUUID();
    const expected = await transaction(db, (tx) => initializeTask(tx, { task_id, specification_id: randomUUID(), specification: { title: 'dispatch test' } }));
    // Public Owner Start is a later command; this is the authenticated-system fixture.
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [task_id]);
    return { task_id, expected, attempt_id: randomUUID(), runner_id: runnerId, kind: 'planner', resource_id: 'repo', runtime_id: 'opencode', model: 'opencode/mimo-v2.6-flash-free', prompt: 'fake adapter; do not invoke a model', source_watermark: 1 };
  }
  async function enqueue(value: QueueInput) { return transaction(db, (tx) => queue.enqueue(tx, value)); }

  it('queues without capacity claims and replays immutable selection even after promotion', async () => {
    const r = await runner(); const value = await input(r.id);
    const dispatch = await enqueue(value); expect(await enqueue(value)).toBe(dispatch);
    expect((await db.pool.query('SELECT state,process_released,mutation_allowed FROM attempts WHERE id=$1', [value.attempt_id])).rows[0]).toEqual({ state: 'QUEUED', process_released: true, mutation_allowed: false });
    expect((await r.service.inventory(r.id)).dispatches).toHaveLength(0);
    await expect(r.service.event(r.id, r.incarnation, { attempt_id: value.attempt_id, dispatch_id: dispatch, stream_id: 'process', sequence: 1, kind: 'started', text: '' })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rowCount).toBe(0);
    await expect(enqueue({ ...value, prompt: 'changed' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const launch = await queue.promoteNext(r.id, r.service.instanceId, r.incarnation);
    expect(launch?.dispatch_id).toBe(dispatch); expect(await enqueue(value)).toBe(dispatch);
    expect((await r.service.inventory(r.id)).dispatches).toHaveLength(1);
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rowCount).toBe(1);
  });

  it('serializes independent promotion transactions and leaves healthy capacity waits queued', async () => {
    const r = await runner(); const first = await input(r.id); const second = await input(r.id);
    await enqueue(first); await enqueue(second);
    const results = await Promise.all(Array.from({ length: 6 }, () => queue.promoteNext(r.id, r.service.instanceId, r.incarnation)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.pool.query("SELECT count(*) FROM attempts WHERE runner_id=$1 AND state='QUEUED'", [r.id])).rows[0].count).toBe('1');
    expect((await db.pool.query('SELECT count(*) FROM attempts WHERE runner_id=$1 AND NOT process_released', [r.id])).rows[0].count).toBe('1');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=ANY($1::text[])', [[first.task_id, second.task_id]])).rows.every((row) => row.state === 'RUNNING')).toBe(true);
  });

  for (const crash of ['before', 'after'] as const) it(`preserves atomic promotion when an independent process dies ${crash} commit`, async () => {
    const r = await runner(); const value = await input(r.id); const dispatch = await enqueue(value);
    const worker = new Worker(url, new URL('./fixtures/promotion-worker.ts', import.meta.url));
    try {
      await worker.next('ready');
      worker.send({ runner: r.id, instance: r.service.instanceId, incarnation: r.incarnation, crash });
      await worker.exited;
      expect(worker.child.signalCode).toBe('SIGKILL');
      const row = (await db.pool.query('SELECT state,process_released FROM attempts WHERE id=$1', [value.attempt_id])).rows[0];
      expect(row).toEqual({ state: crash === 'before' ? 'QUEUED' : 'RUNNING', process_released: crash === 'before' });
      expect((await db.pool.query('SELECT count(*) FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rows[0].count).toBe(crash === 'before' ? '0' : '1');
      const restarted = new BoundaryService(db, { signingKey: 'test-only-restarted-dispatch-service' });
      expect(await queue.promoteNext(r.id, restarted.instanceId, r.incarnation)).toBeNull();
      const current = await restarted.connect(r.id, 'boot'); await restarted.touch(r.id, current, true);
      const frames = await restarted.pending(r.id, current);
      expect(frames.find((frame) => frame.type === 'start')?.dispatch?.dispatch_id).toBe(dispatch);
      expect((await db.pool.query('SELECT count(*) FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rows[0].count).toBe('1');
    } finally { await worker.stop(); }
  }, 15000);

  it('cancels stale queued context without silently rebasing or sending it', async () => {
    const r = await runner(); const value = await input(r.id); await enqueue(value);
    await db.pool.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [value.task_id]);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    expect((await db.pool.query('SELECT state,end_reason FROM attempts WHERE id=$1', [value.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', end_reason: 'stale_queue_basis' });
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rowCount).toBe(0);
  });

  it('retains old physical ownership through exit, ignores late starts, then uses a newer fence', async () => {
    const r = await runner(2); const value = await input(r.id); await enqueue(value);
    const launch = (await queue.promoteNext(r.id, r.service.instanceId, r.incarnation))!;
    const event = { attempt_id: launch.attempt_id, dispatch_id: launch.dispatch_id, stream_id: 'process', sequence: 2, order_sequence: 1, kind: 'exited' as const, text: '', exit_code: 0 };
    await r.service.event(r.id, r.incarnation, event); await r.service.event(r.id, r.incarnation, event);
    await r.service.event(r.id, r.incarnation, { ...event, sequence: 1, order_sequence: 2, kind: 'started' });
    await expect(r.service.event(r.id, r.incarnation, { ...event, text: 'conflict' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    expect((await db.pool.query('SELECT state,process_released FROM attempts WHERE id=$1', [launch.attempt_id])).rows[0]).toEqual({ state: 'FAILED', process_released: false });
    const next = { ...value, attempt_id: randomUUID(), expected: { ...value.expected, control_version: 2 } }; await enqueue(next);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    const stop = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [launch.attempt_id])).rows;
    expect(stop).toHaveLength(1);
    await r.service.finishOperation(r.id, r.incarnation, { operation_id: stop[0].id, attempt_id: launch.attempt_id, success: true, result: { writer_absent: true } });
    const promoted = await queue.promoteNext(r.id, r.service.instanceId, r.incarnation);
    expect(promoted?.fencing_generation).toBeGreaterThan(launch.fencing_generation);
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [launch.attempt_id])).rows[0].state).toBe('FAILED');
  });

  it('pins Task locality after first claim and rejects an unsupported Runner move', async () => {
    const r = await runner(); const other = await runner(); const value = await input(r.id);
    await enqueue(value); await queue.promoteNext(r.id, r.service.instanceId, r.incarnation);
    await expect(enqueue({ ...value, runner_id: other.id, attempt_id: randomUUID() })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await db.pool.query('SELECT runner_id FROM task_runner_locality WHERE task_id=$1', [value.task_id])).rows[0].runner_id).toBe(r.id);
  });

  it('requires current upstream evidence and atomically claims a pending Node with its Start', async () => {
    const r = await runner(2); const value = await input(r.id); await enqueue(value);
    const planner = (await queue.promoteNext(r.id, r.service.instanceId, r.incarnation))!;
    const first = randomUUID(); const downstream = randomUUID();
    const expected = await transaction(db, (tx) => publishInitialPlan(tx, { task_id: value.task_id, plan_id: randomUUID(), expected: value.expected,
      nodes: [{ node_id: first, role_id: 'role', goal: 'first', dependencies: [] }, { node_id: downstream, role_id: 'role', goal: 'second', dependencies: [first] }],
      claim: { attempt_id: planner.attempt_id, fencing_generation: planner.fencing_generation } }));
    const node = { ...value, attempt_id: randomUUID(), kind: 'node' as const, node_id: first, expected };
    await expect(enqueue({ ...node, attempt_id: randomUUID(), node_id: downstream })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await enqueue(node);
    const launch = await queue.promoteNext(r.id, r.service.instanceId, r.incarnation);
    expect(launch?.node_id).toBe(first);
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [first])).rows[0].state).toBe('RUNNING');
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [node.attempt_id])).rowCount).toBe(1);
  });
});
