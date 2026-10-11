import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, digest, submission, validate } from '../../../packages/protocol/src/index.ts';
import type { RunnerResources, RunnerRotationGrant, RunnerRotationRequest, RunnerRotationResponse, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { createApp } from '../src/app.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { createAttemptFixture, enrollFixture, revokeFixture } from '../src/fixtures.ts';
import { manageRunner, redeemRunnerRotation } from '../src/runner-management.ts';
import { runnerResources } from '../src/runner-observations.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { BoundaryService } from '../src/service.ts';
import { initializeTask } from '../src/task-records.ts';

const secret = () => randomBytes(32).toString('base64url');
const fault = (code: string) => ({ detail: { code } });
const installation: RuntimeInstallation = { runtime_id: 'opencode', executable: '/synthetic/opencode', version: '2.0.20', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] };
const resources = (low = false): RunnerResources => validate('RunnerResources', {
  storage: (['journal', 'logs', 'cache', 'workspaces', 'inspection'] as const).map(scope => ({ scope,
    status: low ? 'low' : 'ok', min_free_bytes: 100, free_bytes: low ? 50 : 500, total_bytes: 1000 })),
  execution_limits: { cpu_quota_percent: 100, memory_max_bytes: 1073741824, tasks_max: 128 },
  log_retention_hours: 24, inspection_retention_hours: 24,
});

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Runner credential maintenance and storage admission', { timeout: 20000 }, () => {
  const namespace = 'runner_operations_' + randomUUID().replaceAll('-', '');
  let db: Database, admin: Database, databaseUrl: string;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  async function runner() {
    const id = randomUUID(), credential = secret(), service = new BoundaryService(db, { signingKey: 'synthetic-runner-operations-signing-key' });
    await enrollFixture(db, id, credential, 3);
    const incarnation = await service.connect(id, 'synthetic-boot', credential);
    await service.touch(id, incarnation, true, [installation], resources());
    return { id, credential, service, incarnation };
  }
  const issue = (id: string) => manageRunner(db, { schema_version: 1, action: 'rotate', runner_id: id, ttl_seconds: 60 }) as Promise<RunnerRotationGrant>;
  const request = (grant: RunnerRotationGrant): RunnerRotationRequest => ({ schema_version: 1, runner_id: grant.runner_id,
    request_id: randomUUID(), rotation_token: grant.rotation_token, credential: secret() });
  const record = async (id: string) => (await db.pool.query('SELECT * FROM runner_credential_rotations WHERE id=$1', [id])).rows[0];

  it('rotates through HTTP, fences the old channel and preserves execution through revoke and exact replay', async () => {
    const r = await runner(), app = createApp(r.service);
    const launch = await createAttemptFixture(db, { runner_id: r.id, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: randomUUID(), prompt: 'retained execution' });
    const ownership = async () => (await db.pool.query('SELECT to_jsonb(a) value FROM attempts a WHERE id=$1', [launch.attempt_id])).rows[0].value;
    const before = await ownership(), grant = await issue(r.id), obsolete = await issue(r.id), input = request(grant);
    const send = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/runner/rotate-credential', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    try {
      const denied = await send({ ...input, rotation_token: secret() });
      expect(denied.statusCode).toBe(401); expect(denied.body).not.toContain(input.credential);
      const response = await send(input), output = response.json();
      expect(response.statusCode).toBe(200);
      expect(response.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      expect(output).toEqual({ schema_version: 1, runner_id: r.id, request_id: input.request_id });
      await expect(r.service.authenticateRunner(r.credential)).rejects.toMatchObject(fault('unauthorized'));
      await expect(r.service.connect(r.id, 'stale-upgrade', r.credential)).rejects.toMatchObject(fault('unauthorized'));
      await expect(r.service.touch(r.id, r.incarnation)).rejects.toMatchObject(fault('stale_execution'));
      expect(await r.service.authenticateRunner(input.credential)).toBe(r.id);
      const incarnation = await r.service.connect(r.id, 'same-runner', input.credential);
      expect((await r.service.inventory(r.id)).dispatches.map(d => d.attempt_id)).toContain(launch.attempt_id);
      await expect(redeemRunnerRotation(db, request(obsolete))).rejects.toMatchObject(fault('unauthorized'));
      await manageRunner(db, { schema_version: 1, action: 'set_capacity', runner_id: r.id, capacity: 1 });
      await manageRunner(db, { schema_version: 1, action: 'revoke', runner_id: r.id });
      const revoked = (await db.pool.query('SELECT credential_generation,incarnation FROM runners WHERE id=$1', [r.id])).rows[0];
      expect(Number(revoked.incarnation)).toBe(incarnation + 1);
      expect((await send(input)).json()).toEqual(output);
      await manageRunner(db, { schema_version: 1, action: 'revoke', runner_id: r.id });
      expect((await db.pool.query('SELECT credential_generation,incarnation FROM runners WHERE id=$1', [r.id])).rows[0]).toEqual(revoked);
      await expect(r.service.authenticateRunner(input.credential)).rejects.toMatchObject(fault('unauthorized'));
      const recovery = request(await issue(r.id)); await redeemRunnerRotation(db, recovery);
      expect(await r.service.authenticateRunner(recovery.credential)).toBe(r.id);
      expect(await ownership()).toEqual(before);
      const row = await record(grant.rotation_id);
      expect(row).toMatchObject({ token_hash: digest(grant.rotation_token), request_digest: digest(canonicalJSON(input)), credential_hash: digest(input.credential) });
      for (const value of [row, output, denied.json()]) for (const token of [input.credential, input.rotation_token]) expect(JSON.stringify(value)).not.toContain(token);
    } finally { await app.close(); }
  });

  it('allows one concurrent claimant and keeps the issued grant and consumed receipt immutable', async () => {
    const r = await runner(), grant = await issue(r.id), inputs = [request(grant), request(grant)];
    const barrier = await db.pool.connect(), peers = inputs.map(() => database(databaseUrl));
    let pending: Promise<PromiseSettledResult<RunnerRotationResponse>>[] = [];
    try {
      const pids = await Promise.all(peers.map(async p => Number((await p.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid)));
      expect(new Set(pids).size).toBe(2);
      await barrier.query('BEGIN'); await barrier.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [r.id]);
      pending = peers.map((peer, i) => redeemRunnerRotation(peer, inputs[i]).then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })));
      await expect.poll(async () => (await admin.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rows[0].n).toBe(2);
      await barrier.query('COMMIT');
      const results = await Promise.all(pending);
      expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: fault('payload_conflict') });
      const winner = inputs[results.findIndex(item => item.status === 'fulfilled')]!;
      expect(await redeemRunnerRotation(db, winner)).toMatchObject({ request_id: winner.request_id });
      await expect(redeemRunnerRotation(db, { ...winner, credential: secret() })).rejects.toMatchObject(fault('payload_conflict'));
      for (const sql of ['UPDATE runner_credential_rotations SET expires_at=expires_at+interval \'1 hour\' WHERE id=$1',
        'UPDATE runner_credential_rotations SET request_digest=\'rewritten\' WHERE id=$1', 'DELETE FROM runner_credential_rotations WHERE id=$1']) {
        await expect(db.pool.query(sql, [grant.rotation_id])).rejects.toMatchObject({ code: '23514' });
      }
      const unused = await issue(r.id);
      await expect(db.pool.query('UPDATE runner_credential_rotations SET credential_generation=credential_generation+1 WHERE id=$1', [unused.rotation_id])).rejects.toMatchObject({ code: '23514' });
    } finally { await barrier.query('ROLLBACK'); barrier.release(); await Promise.all(pending); await Promise.all(peers.map(p => p.pool.end())); }
  });

  it('checks expiry after lock acquisition and rolls back grant consumption with credential replacement', async () => {
    const r = await runner(), rotation_id = randomUUID(), rotation_token = secret();
    await db.pool.query(`INSERT INTO runner_credential_rotations(id,runner_id,credential_generation,token_hash,created_at,expires_at)
      VALUES($1,$2,1,$3,clock_timestamp()-interval '59 seconds',clock_timestamp()+interval '300 milliseconds')`, [rotation_id, r.id, digest(rotation_token)]);
    const input: RunnerRotationRequest = { schema_version: 1, request_id: randomUUID(), runner_id: r.id, rotation_token, credential: secret() };
    const barrier = await db.pool.connect(), peer = database(databaseUrl);
    let pending: Promise<PromiseSettledResult<RunnerRotationResponse>> | undefined;
    try {
      const pid = Number((await peer.pool.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      await barrier.query('BEGIN'); await barrier.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [r.id]);
      pending = redeemRunnerRotation(peer, input).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
      await expect.poll(async () => (await admin.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]?.wait_event_type).toBe('Lock');
      await expect.poll(async () => (await db.pool.query('SELECT expires_at<=clock_timestamp() expired FROM runner_credential_rotations WHERE id=$1', [rotation_id])).rows[0].expired).toBe(true);
      await barrier.query('COMMIT'); expect(await pending).toMatchObject({ status: 'rejected', reason: fault('unauthorized') });
      expect((await record(rotation_id)).request_id).toBeNull();
      expect(await r.service.authenticateRunner(r.credential)).toBe(r.id);
    } finally { await barrier.query('ROLLBACK'); barrier.release(); await pending; await peer.pool.end(); }
    const grant = await issue(r.id), next = request(grant);
    await db.pool.query(`CREATE FUNCTION reject_test_rotation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END; $$`);
    await db.pool.query('CREATE CONSTRAINT TRIGGER reject_test_rotation AFTER UPDATE ON runner_credential_rotations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_test_rotation()');
    try { await expect(redeemRunnerRotation(db, next)).rejects.toMatchObject({ code: 'P0001' }); }
    finally { await db.pool.query('DROP TRIGGER reject_test_rotation ON runner_credential_rotations'); await db.pool.query('DROP FUNCTION reject_test_rotation()'); }
    expect((await record(grant.rotation_id)).request_id).toBeNull();
    expect(await r.service.authenticateRunner(r.credential)).toBe(r.id);
    await redeemRunnerRotation(db, next);
    expect(await r.service.authenticateRunner(next.credential)).toBe(r.id);
  });

  it('holds new consumption on low or stale storage while Stop, events and result replay still settle', async () => {
    const r = await runner(), queue = new DispatchQueue(db), schedule = new RuntimeScheduling(queue, r.service.instanceId);
    const task_id = randomUUID(), expected = await transaction(db, tx => initializeTask(tx, { task_id, specification_id: randomUUID(), specification: { title: 'disk gate' } }));
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [task_id]);
    const input = { attempt_id: randomUUID(), task_id, kind: 'planner' as const, expected, legacy_probe: true as const,
      resource_id: 'storage-test', prompt: 'no native launch', source_watermark: 1,
      explicit_target: { runner_id: r.id, runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free' } };
    const submit = () => transaction(db, tx => schedule.selectAndEnqueue(tx, input));
    await r.service.touch(r.id, r.incarnation, false, undefined, resources(true));
    expect(await submit()).toMatchObject({ status: 'unavailable', reason: 'runner_storage_attention' });
    expect((await db.pool.query('SELECT id FROM attempts WHERE id=$1', [input.attempt_id])).rowCount).toBe(0);
    expect(() => runnerResources({ ...resources(), storage: resources().storage.map(() => resources().storage[0]) })).toThrow();
    expect(() => runnerResources({ ...resources(), storage: resources().storage.map(item => ({ ...item, status: 'low' })) })).toThrow();
    await r.service.touch(r.id, r.incarnation, false, undefined, resources());
    expect(await submit()).toMatchObject({ status: 'queued' });
    const active = await createAttemptFixture(db, { runner_id: r.id, task_id: randomUUID(), attempt_id: randomUUID(), kind: 'node', resource_id: randomUUID(), prompt: 'existing physical owner' });
    const token = (await r.service.authorize(r.id, r.incarnation, active.dispatch_id))!.credential;
    const command = { schema_version: 1 as const, request_id: randomUUID(), scope_id: active.task_id, expected_control_version: active.control_version,
      name: 'open_workspace' as const, payload: { resource_id: active.resource_id } };
    const opened = await r.service.admit(token, submission(command));
    await db.pool.query(`INSERT INTO backend_storage_observations(instance_id,observation) VALUES($1,$2)`, [r.service.instanceId, { scope: 'database', status: 'low', min_free_bytes: 100, free_bytes: 50, total_bytes: 1000 }]);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    expect(await r.service.admit(token, submission(command))).toEqual(opened);
    const newRequest = { ...command, request_id: randomUUID() };
    await expect(r.service.admit(token, submission(newRequest))).rejects.toMatchObject(fault('unmet_precondition'));
    expect((await db.pool.query('SELECT 1 FROM command_receipts WHERE request_id=$1', [newRequest.request_id])).rowCount).toBe(0);
    expect(await r.service.pending(r.id, r.incarnation)).toEqual([expect.objectContaining({ type: 'effect', operation: expect.objectContaining({ operation_id: opened.operation_id }) })]);
    await r.service.finishOperation(r.id, r.incarnation, { attempt_id: active.attempt_id, operation_id: opened.operation_id!, success: true, result: { workspace_id: 'synthetic-workspace', path: '/synthetic/workspace' } });
    await revokeFixture(db, active.attempt_id);
    const stop = (await r.service.pending(r.id, r.incarnation)).find(frame => frame.type === 'effect')!.operation!;
    expect(stop.kind).toBe('stop');
    const event = { attempt_id: active.attempt_id, dispatch_id: active.dispatch_id, stream_id: 'runtime', sequence: 1, kind: 'process_absent' as const, text: 'synthetic verified absence' };
    await r.service.event(r.id, r.incarnation, event); await r.service.event(r.id, r.incarnation, event);
    const result = { attempt_id: active.attempt_id, operation_id: stop.operation_id, success: true, result: { writer_absent: true } };
    await r.service.finishOperation(r.id, r.incarnation, result); await r.service.finishOperation(r.id, r.incarnation, result);
    expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [active.attempt_id])).rows[0].process_released).toBe(true);
    expect((await db.pool.query('SELECT count(*) FROM runtime_events WHERE attempt_id=$1', [active.attempt_id])).rows[0].count).toBe('1');
    await db.pool.query(`UPDATE backend_storage_observations SET observation=$2,observed_at=clock_timestamp()-interval '16 seconds' WHERE instance_id=$1`, [r.service.instanceId, { scope: 'database', status: 'ok', min_free_bytes: 100, free_bytes: 500, total_bytes: 1000 }]);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    await db.pool.query('UPDATE backend_storage_observations SET observed_at=clock_timestamp() WHERE instance_id=$1', [r.service.instanceId]);
    await db.pool.query("UPDATE runners SET resource_observed_at=clock_timestamp()-interval '16 seconds' WHERE id=$1", [r.id]);
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toBeNull();
    await r.service.touch(r.id, r.incarnation, false, undefined, resources());
    expect(await queue.promoteNext(r.id, r.service.instanceId, r.incarnation)).toMatchObject({ attempt_id: input.attempt_id });
  });
});
