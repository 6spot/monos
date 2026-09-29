import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import type { ExecutionPolicy, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import type { SchedulingRequest } from '../src/runtime-scheduling.ts';
import { BoundaryService } from '../src/service.ts';
import { initializeTask } from '../src/task-records.ts';

const model = 'opencode/longcat-2.5-preview-free';
const installation: RuntimeInstallation = { runtime_id: 'opencode', executable: '/opt/owner/bin/opencode', version: '1.18.30', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] };
const policy = (runner_id?: string): ExecutionPolicy => ({ default_target: { runtime_id: 'opencode', model_id: model, ...(runner_id ? { runner_id } : {}) }, fallback_targets: [] });
const signingKey = 'synthetic-runtime-scheduling-signing-key';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('production Runtime target scheduling', () => {
  let db: Database; let admin: Database; let queue: DispatchQueue;
  const namespace = `runtime_scheduling_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db); queue = new DispatchQueue(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  async function runner(capacity = 2) {
    const id = randomUUID(); await enrollFixture(db, id, randomUUID(), capacity);
    const service = new BoundaryService(db, { signingKey });
    const incarnation = await service.connect(id, 'boot'); await service.touch(id, incarnation, true, [installation]);
    return { id, service, incarnation };
  }
  async function request(kind: 'planner' | 'node' = 'planner'): Promise<SchedulingRequest> {
    const task_id = randomUUID();
    let expected = await transaction(db, (tx) => initializeTask(tx, { task_id, specification_id: randomUUID(), specification: { title: 'schedule' } }));
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [task_id]);
    let node_id: string | undefined;
    if (kind === 'node') {
      node_id = randomUUID(); const plan = randomUUID();
      await transaction(db, async (tx) => {
        await tx.query('INSERT INTO plan_revisions(id,task_id,specification_id,content) VALUES($1,$2,$3,$4)', [plan, task_id, expected.specification_id, { node_ids: [node_id] }]);
        await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node_id, task_id]);
        await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [task_id, plan, node_id, { node_id, dependencies: [] }]);
        await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')", [task_id, node_id, expected.specification_id, plan]);
        await tx.query('UPDATE tasks SET plan_id=$2,control_version=control_version+1 WHERE id=$1', [task_id, plan]);
      });
      expected = { ...expected, plan_id: plan, control_version: expected.control_version + 1 };
    }
    return { attempt_id: randomUUID(), task_id, ...(node_id ? { node_id } : {}), kind, expected, resource_id: 'repo', prompt: 'synthetic scheduling test; no model launch', source_watermark: 1 };
  }
  async function submit(service: BoundaryService, value: SchedulingRequest) {
    return transaction(db, (tx) => new RuntimeScheduling(queue, service.instanceId).selectAndEnqueue(tx, value));
  }

  it('resolves explicit, Planner, Role and Global precedence and preserves replay after policy edits', async () => {
    const r = await runner(); const role = randomUUID();
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id), planner: policy(r.id) }]);
    await db.pool.query('INSERT INTO roles(id,name,description,instructions,archived,execution_policy) VALUES($1,$2,$3,$4,false,$5)', [role, 'role', '', '', policy(r.id)]);
    const planner = await request();
    const result = await submit(r.service, planner); expect(result).toMatchObject({ status: 'queued', source: 'planner', runner_id: r.id });
    const node = await request('node'); expect(await submit(r.service, { ...node, role_id: role })).toMatchObject({ status: 'queued', source: 'role' });
    expect(await submit(r.service, { ...await request('node') })).toMatchObject({ status: 'queued', source: 'global' });
    const explicit = await request();
    expect(await submit(r.service, { ...explicit, explicit_target: { runtime_id: 'opencode', model_id: model, runner_id: r.id } })).toMatchObject({ status: 'queued', source: 'explicit' });
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{}]);
    expect(await submit(r.service, planner)).toEqual(result);
    await expect(submit(r.service, { ...planner, prompt: 'different' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const stored = (await db.pool.query('SELECT selection_context,launch FROM attempts WHERE id=$1', [planner.attempt_id])).rows[0];
    expect(stored.selection_context).toMatchObject({ source: 'planner', target: { model_id: model }, observed_version: installation.version });
    expect(stored.launch).toMatchObject({ runtime_id: 'opencode', model, control_version: planner.expected.control_version });
  });

  it('returns factual incompatibility and keeps hard pins, stale reports and disconnected queues', async () => {
    const r = await runner(); await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id) }]);
    const value = await request();
    expect(await submit(r.service, { ...value, explicit_target: { runtime_id: 'opencode', model_id: 'other/model' } })).toMatchObject({ status: 'unavailable', reason: 'unsupported_model' });
    expect(await submit(r.service, { ...value, explicit_target: { runtime_id: 'opencode', model_id: model, thinking_level: 'high' } })).toMatchObject({ status: 'unavailable', reason: 'unsupported_thinking' });
    expect(await submit(r.service, { ...value, explicit_target: { runtime_id: 'opencode', model_id: model, runner_id: randomUUID() } })).toMatchObject({ status: 'unavailable', reason: 'runner_missing' });
    expect(await submit(r.service, value)).toMatchObject({ status: 'queued' });
    await r.service.disconnect(r.id, r.incarnation);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [value.attempt_id])).rows[0].state).toBe('QUEUED');
    const next = await r.service.connect(r.id, 'boot-2'); await r.service.touch(r.id, next, true);
    expect(await queue.promoteNext(r.id, r.service.instanceId, next)).toBeNull();
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [value.attempt_id])).rows[0].state).toBe('QUEUED');
    await r.service.touch(r.id, next, true, [{ ...installation, availability: 'unavailable' }]);
    expect(await queue.promoteNext(r.id, r.service.instanceId, next)).toBeNull();
    expect((await db.pool.query('SELECT state,end_reason FROM attempts WHERE id=$1', [value.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', end_reason: 'runtime_unavailable_before_start' });
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rowCount).toBe(0);
  });

  it('treats a complete empty reconnect report as objective pre-start loss', async () => {
    const r = await runner(); await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id) }]);
    const value = await request(); expect((await submit(r.service, value)).status).toBe('queued');
    const next = await r.service.connect(r.id, 'new-boot');
    await r.service.touch(r.id, next, true, []);
    expect(await queue.promoteNext(r.id, r.service.instanceId, next)).toBeNull();
    expect((await db.pool.query('SELECT state,end_reason FROM attempts WHERE id=$1', [value.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', end_reason: 'runtime_missing_before_start' });
    expect((await db.pool.query('SELECT id FROM outbox WHERE attempt_id=$1', [value.attempt_id])).rowCount).toBe(0);
  });

  it('requires one eligible Auto Runner and skips a queued owner with an unresolved writer', async () => {
    const r = await runner(); const second = await runner();
    const sameBackend = await r.service.connect(second.id, 'shared-backend');
    await r.service.touch(second.id, sameBackend, true, [installation]);
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy() }]);
    expect(await submit(r.service, await request())).toMatchObject({ status: 'unavailable', reason: 'ambiguous_auto_placement' });
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id) }]);
    const first = await request(); await submit(r.service, first);
    expect((await queue.promoteNext(r.id, r.service.instanceId, r.incarnation))?.attempt_id).toBe(first.attempt_id);
    const blocked = { ...first, attempt_id: randomUUID() };
    await submit(r.service, blocked);
    const independent = await request(); await submit(r.service, independent);
    expect((await queue.promoteNext(r.id, r.service.instanceId, r.incarnation))?.attempt_id).toBe(independent.attempt_id);
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [blocked.attempt_id])).rows[0].state).toBe('QUEUED');
    expect((await db.pool.query('SELECT count(*) FROM outbox WHERE attempt_id=$1', [independent.attempt_id])).rows[0].count).toBe('1');
  });

  it('holds Auto placement stable until its selected Attempt commits', async () => {
    const r = await runner(); const second = randomUUID();
    await enrollFixture(db, second, randomUUID());
    await db.pool.query('INSERT INTO runtime_installations(runner_id,runtime_id,incarnation,observation) VALUES($1,$2,1,$3)', [second, installation.runtime_id, installation]);
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy() }]);
    const value = await request();
    let releaseAdmission!: () => void;
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    let signalSelected!: () => void;
    const selected = new Promise<void>((resolve) => { signalSelected = resolve; });
    const admission = transaction(db, async (tx) => {
      const result = await new RuntimeScheduling(queue, r.service.instanceId).selectAndEnqueue(tx, value);
      signalSelected();
      await admissionGate;
      return result;
    });
    const writer = await db.pool.connect();
    let change: Promise<unknown> | undefined;
    try {
      await selected;
      const pid = Number((await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      change = writer.query(`UPDATE runners SET incarnation=1,connected=true,ready=true,
        connection_instance=$2,runtime_report_incarnation=1,last_seen=now() WHERE id=$1`, [second, r.service.instanceId]);
      try {
        let blocked = false;
        for (let count = 0; count < 500; count++) {
          const status = (await admin.pool.query<{ wait_event_type: string | null }>('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
          if (status?.wait_event_type === 'Lock') { blocked = true; break; }
          await delay(10);
        }
        expect(blocked).toBe(true);
      } finally { releaseAdmission(); }
      expect(await admission).toMatchObject({ status: 'queued', runner_id: r.id });
      await change;
      expect(await submit(r.service, await request())).toMatchObject({ status: 'unavailable', reason: 'ambiguous_auto_placement' });
    } finally {
      releaseAdmission();
      await admission.catch(() => undefined);
      await change?.catch(() => undefined);
      writer.release();
    }
  }, 20000);

  it('lets an in-flight Runner heartbeat finish before Auto locks its stable candidate set', async () => {
    const r = await runner(); await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy() }]);
    const value = await request(); const updated = { ...installation, version: '1.18.31' };
    const barrier = await db.pool.connect();
    let heartbeat: Promise<void> | undefined; let admission: ReturnType<typeof submit> | undefined;
    async function blockedBy(pid: number, query?: string): Promise<number> {
      for (let count = 0; count < 500; count++) {
        const waiting = (await admin.pool.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
          WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND ($2::text IS NULL OR query LIKE $2)`, [pid, query ?? null])).rows[0];
        if (waiting) return Number(waiting.pid);
        await delay(10);
      }
      throw new Error('Concurrent transaction did not reach the database lock barrier');
    }
    try {
      await barrier.query('BEGIN');
      // touch has already locked its Runner before this installation DELETE.
      // Hold it there so Auto deterministically arrives between row lock and UPDATE.
      await barrier.query('LOCK TABLE runtime_installations IN SHARE MODE');
      const barrierPid = Number((await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      heartbeat = r.service.touch(r.id, r.incarnation, true, [updated]); void heartbeat.catch(() => undefined);
      const heartbeatPid = await blockedBy(barrierPid, 'DELETE FROM runtime_installations%');
      expect((await db.pool.query("SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='runners'::regclass AND mode='RowShareLock' AND granted", [heartbeatPid])).rowCount).toBe(1);
      admission = submit(r.service, value); void admission.catch(() => undefined);
      const admissionPid = await blockedBy(heartbeatPid);
      expect(new Set([barrierPid, heartbeatPid, admissionPid]).size).toBe(3);
      await barrier.query('COMMIT');
      await expect(heartbeat).resolves.toBeUndefined();
      expect(await admission).toMatchObject({ status: 'queued', runner_id: r.id });
      expect((await db.pool.query('SELECT selection_context FROM attempts WHERE id=$1', [value.attempt_id])).rows[0].selection_context.observed_version).toBe(updated.version);
    } finally {
      await barrier.query('ROLLBACK');
      await Promise.allSettled([heartbeat, admission]);
      barrier.release();
    }
  }, 20000);

  it('clears a stale control head and promotes the next eligible row in one poll', async () => {
    const r = await runner(); await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id) }]);
    const stale = await request(); await submit(r.service, stale);
    const eligible = await request('node'); await submit(r.service, eligible);
    await db.pool.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [stale.task_id]);
    expect((await queue.promoteNext(r.id, r.service.instanceId, r.incarnation))?.attempt_id).toBe(eligible.attempt_id);
    expect((await db.pool.query('SELECT state,end_reason FROM attempts WHERE id=$1', [stale.attempt_id])).rows[0]).toEqual({ state: 'CANCELLED', end_reason: 'stale_queue_basis' });
    expect((await db.pool.query('SELECT count(*) FROM outbox WHERE attempt_id=$1', [eligible.attempt_id])).rows[0].count).toBe('1');
  });

  it('shares two slots and promotes Planner before an older Node under contention', async () => {
    const r = await runner(); await db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: policy(r.id) }]);
    const running = await Promise.all([request(), request()]);
    for (const value of running) expect((await submit(r.service, value)).status).toBe('queued');
    const claims = await Promise.all(Array.from({ length: 5 }, () => queue.promoteNext(r.id, r.service.instanceId, r.incarnation)));
    expect(claims.filter(Boolean)).toHaveLength(2);
    const node = await request('node'); const planner = await request();
    await submit(r.service, node); await submit(r.service, planner);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    expect((await db.pool.query('SELECT count(*) FROM attempts WHERE runner_id=$1 AND NOT process_released', [r.id])).rows[0].count).toBe('2');
    // Simulate a verified, settled process absence; capacity comes from rows.
    await db.pool.query('UPDATE attempts SET process_released=true,mutation_allowed=false,state=$2 WHERE id=$1', [running[0]!.attempt_id, 'SUCCEEDED']);
    const next = await queue.promoteNext(r.id, r.service.instanceId, r.incarnation);
    expect(next?.attempt_id).toBe(planner.attempt_id);
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [node.attempt_id])).rows[0].state).toBe('QUEUED');
    expect((await db.pool.query('SELECT count(*) FROM outbox WHERE attempt_id=$1', [planner.attempt_id])).rows[0].count).toBe('1');
  });
});
