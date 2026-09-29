import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch } from '../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../src/service.ts';
import { createAttemptFixture, enrollFixture, revokeFixture } from '../src/fixtures.ts';
import { issueAttemptCredential } from '../src/auth.ts';
import { Worker } from './fixtures/process-worker.ts';

const signingKey = 'test-only-admission-worker-signing-key';
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('PostgreSQL process-crash admission recovery', () => {
  let db: Database;
  let admin: Database;
  let url: string;
  const namespace = `probe_recovery_${randomUUID().replaceAll('-', '')}`;
  const workers: Worker[] = [];
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const parsed = new URL(process.env.DATABASE_URL);
    parsed.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000 -c lock_timeout=8000`);
    url = parsed.toString(); db = database(url); await migrate(db);
  });
  afterEach(async () => { await Promise.all(workers.splice(0).map((worker) => worker.stop())); });
  afterAll(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop()));
    if (db) await db.pool.end();
    if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); }
  });
  async function fixture(kind: 'planner' | 'node' = 'planner') {
    const runnerId = randomUUID(); await enrollFixture(db, runnerId, randomUUID(), 1);
    return createAttemptFixture(db, { runner_id: runnerId, attempt_id: randomUUID(), task_id: randomUUID(), kind, resource_id: 'repo', prompt: 'atomic crash verification' });
  }
  function reply(launch: Dispatch & { task_id: string }): CommandEnvelope {
    return { schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: 1, name: 'commit_task_turn', payload: { reply: 'durable reply', source_watermark: 1, routing: { kind: 'reply_only' } } };
  }
  async function counts(launch: Dispatch) {
    const values: Record<string, number> = {};
    for (const table of ['command_receipts', 'operations', 'task_events']) values[table] = Number((await db.pool.query(`SELECT count(*) FROM ${table} WHERE attempt_id=$1`, [launch.attempt_id])).rows[0].count);
    values.effects = Number((await db.pool.query("SELECT count(*) FROM outbox WHERE attempt_id=$1 AND kind='effect'", [launch.attempt_id])).rows[0].count);
    values.start_done = Number((await db.pool.query("SELECT count(*) FROM outbox WHERE attempt_id=$1 AND kind='start' AND done", [launch.attempt_id])).rows[0].count);
    const task = (await db.pool.query('SELECT control_version,event_sequence FROM tasks WHERE id=$1', [launch.task_id])).rows[0];
    const attempt = (await db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [launch.attempt_id])).rows[0];
    return { ...values, control: Number(task.control_version), sequence: Number(task.event_sequence), ...attempt };
  }
  async function crash(launch: Dispatch, command: CommandEnvelope, phase: 'before' | 'after') {
    const worker = new Worker(url, new URL('./fixtures/admission-worker.ts', import.meta.url)); workers.push(worker);
    await worker.next('ready'); worker.send({ launch, command, crash: phase });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([worker.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Admission worker did not exit')), 10000); })]);
    } finally { clearTimeout(timer); }
    expect(worker.messages).toEqual([]);
    expect(worker.child.signalCode).toBe('SIGKILL');
  }

  it('rolls back every admission record when the process dies before commit', async () => {
    const launch = await fixture(); const command = reply(launch); const before = await counts(launch);
    await crash(launch, command, 'before');
    const restarted = new BoundaryService(db, { signingKey });
    // Taking the canonical lock also waits for PostgreSQL disconnect rollback.
    expect((await restarted.recoverCommand(launch.runner_id, launch.attempt_id, command.request_id)).status).toBe('unknown');
    expect(await counts(launch)).toEqual(before);
    const incarnation = await restarted.connect(launch.runner_id, 'test-boot'); await restarted.touch(launch.runner_id, incarnation, true);
    const grant = await restarted.authorize(launch.runner_id, incarnation, launch.dispatch_id);
    expect((await restarted.admit(grant!.credential, submission(command))).status).toBe('committed');
    expect(await counts(launch)).toMatchObject({ command_receipts: 1, operations: 1, task_events: 1, effects: 1, start_done: 1, control: 2, sequence: 1, mutation_allowed: false, process_released: false });
  }, 20000);

  it('recovers all records once after commit despite losing the entire worker', async () => {
    const launch = await fixture(); const command = reply(launch);
    await crash(launch, command, 'after');
    const restarted = new BoundaryService(db, { signingKey });
    const recovered = await restarted.recoverCommand(launch.runner_id, launch.attempt_id, command.request_id);
    expect(recovered.status).toBe('committed');
    expect(recovered.result?.reply).toBe('durable reply');
    const token = issueAttemptCredential({ attempt_id: launch.attempt_id, dispatch_id: launch.dispatch_id, fencing_generation: 1, expires: Date.now() + 60000 }, signingKey);
    const replays = await Promise.all(Array.from({ length: 4 }, () => new BoundaryService(db, { signingKey }).admit(token, submission(command))));
    expect(replays.every((result) => result.operation_id === recovered.operation_id)).toBe(true);
    expect(await counts(launch)).toMatchObject({ command_receipts: 1, operations: 1, task_events: 1, effects: 1, start_done: 1, control: 2, sequence: 1, mutation_allowed: false, process_released: false });
    await expect(restarted.admit(token, submission({ ...command, payload: { ...command.payload, reply: 'changed' } }))).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const incarnation = await restarted.connect(launch.runner_id, 'test-boot'); await restarted.touch(launch.runner_id, incarnation, true);
    const pending = await restarted.pending(launch.runner_id, incarnation);
    expect(pending).toHaveLength(1); expect(pending[0]!.operation!.operation_id).toBe(recovered.operation_id);
    const settled = { attempt_id: launch.attempt_id, operation_id: recovered.operation_id!, success: true, result: { writer_absent: true } };
    await restarted.finishOperation(launch.runner_id, incarnation, settled);
    await restarted.finishOperation(launch.runner_id, incarnation, settled);
    expect((await counts(launch)).process_released).toBe(true);
    expect((await counts(launch)).task_events).toBe(1);
    expect(await restarted.pending(launch.runner_id, incarnation)).toEqual([]);
  }, 20000);

  it('retains unresolved workspace ownership across stale control and duplicate recovery', async () => {
    const launch = await fixture('node'); const service = new BoundaryService(db, { signingKey });
    const old = await service.connect(launch.runner_id, 'test-boot'); await service.touch(launch.runner_id, old, true);
    const grant = await service.authorize(launch.runner_id, old, launch.dispatch_id);
    const command: CommandEnvelope = { schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: 1, name: 'open_workspace', payload: { resource_id: 'repo' } };
    const admitted = await service.admit(grant!.credential, submission(command));
    await revokeFixture(db, launch.attempt_id);
    await db.pool.query("UPDATE runners SET last_seen=now()-interval '1 day' WHERE id=$1", [launch.runner_id]);
    const restarted = new BoundaryService(db, { signingKey });
    const current = await restarted.connect(launch.runner_id, 'test-boot'); await restarted.touch(launch.runner_id, current, true);
    const stop = (await restarted.inventory(launch.runner_id)).operations.find((op) => op.kind === 'stop')!;
    await expect(restarted.finishOperation(launch.runner_id, current, { attempt_id: launch.attempt_id, operation_id: stop.operation_id, success: true, result: { writer_absent: true } })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await counts(launch)).process_released).toBe(false);
    expect((await restarted.recoverCommand(launch.runner_id, launch.attempt_id, command.request_id)).operation_id).toBe(admitted.operation_id);
    const result = { attempt_id: launch.attempt_id, operation_id: admitted.operation_id!, success: true, result: { workspace_id: 'workspace', path: '/test-only/workspace' } };
    await expect(service.finishOperation(launch.runner_id, old, result)).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    await restarted.finishOperation(launch.runner_id, current, result);
    await restarted.finishOperation(launch.runner_id, current, result);
    await expect(restarted.finishOperation(launch.runner_id, current, { ...result, result: { ...result.result, path: '/changed' } })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    await restarted.finishOperation(launch.runner_id, current, { attempt_id: launch.attempt_id, operation_id: stop.operation_id, success: true, result: { writer_absent: true } });
    expect((await counts(launch)).process_released).toBe(true);
    expect((await restarted.recoverCommand(launch.runner_id, launch.attempt_id, command.request_id)).status).toBe('committed');
  });
});
