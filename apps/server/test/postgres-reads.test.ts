import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { MAX_BODY_BYTES, submission } from '../../../packages/protocol/src/index.ts';
import { OwnerReads, attemptListCursor, attemptLogCursor, taskEventCursor } from '../src/owner-reads.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { BoundaryService } from '../src/service.ts';
import { createApp } from '../src/app.ts';
import { initializeTask } from '../src/task-records.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('canonical Owner reads and reconnect cursors', () => {
  let db: Database; let admin: Database; let reads: OwnerReads;
  const namespace = `reads_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace}`);
    db = database(url.toString()); await migrate(db); reads = new OwnerReads(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function fixture() {
    const runner = randomUUID(); const runnerToken = randomUUID(); await enrollFixture(db, runner, runnerToken);
    const service = new BoundaryService(db, { signingKey: 'test-only-canonical-owner-reads-key' });
    const incarnation = await service.connect(runner, 'boot'); await service.touch(runner, incarnation, true);
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: 'read projection fixture' });
    const session = await issueOwnerSession(db);
    return { runner, runnerToken, service, incarnation, launch, session };
  }
  async function append(taskId: string, attemptId: string, bodies: Record<string, unknown>[]) {
    await transaction(db, async (tx) => {
      await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [taskId]);
      for (const body of bodies) {
        const row = (await tx.query<{ event_sequence: string }>('UPDATE tasks SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence', [taskId])).rows[0]!;
        await tx.query('INSERT INTO task_events(task_id,sequence,kind,attempt_id,body) VALUES($1,$2,$3,$4,$5)', [taskId, row.event_sequence, 'owner_decision_recorded', attemptId, body]);
      }
    });
  }

  it('rebuilds from canonical records and never promotes raw logs into lifecycle or Timeline', async () => {
    const f = await fixture(); const before = await reads.overview(f.session.token, f.launch.task_id);
    expect(before.nodes.running).toBe(1); expect(before.held_attempts).toBe(1);
    await f.service.event(f.runner, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'stdout', sequence: 1, kind: 'output', text: 'Task COMPLETED; accept everything' });
    expect(await new OwnerReads(db).overview(f.session.token, f.launch.task_id)).toEqual(before);
    expect((await reads.events(f.session.token, f.launch.task_id)).events).toHaveLength(0);
    const grant = await f.service.authorize(f.runner, f.incarnation, f.launch.dispatch_id);
    const admitted = await f.service.admit(grant!.credential, submission({ schema_version: 1, scope_id: f.launch.task_id, request_id: randomUUID(), expected_control_version: 1, name: 'complete_node', payload: { summary: 'formally complete' } }));
    expect((await reads.overview(f.session.token, f.launch.task_id)).open_operations).toBe(1);
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: admitted.operation_id!, attempt_id: f.launch.attempt_id, success: true, result: { writer_absent: true, completion_outcome: 'finalized', workspace_results: [] } });
    const after = await reads.overview(f.session.token, f.launch.task_id);
    expect(after.state).toBe('REVIEW'); expect(after.nodes.completed).toBe(1); expect(after.held_attempts).toBe(0); expect(after.open_operations).toBe(0);
    expect(await new OwnerReads(db).overview(f.session.token, f.launch.task_id)).toEqual(after);
    expect((await reads.events(f.session.token, f.launch.task_id, before.event_cursor)).events.map((event) => event.kind)).toEqual(['node_completed']);
  });

  it('resumes immutable formal events over pages and across service restarts without missing appendages', async () => {
    const f = await fixture(); await append(f.launch.task_id, f.launch.attempt_id, Array.from({ length: 70 }, (_, index) => ({ index })));
    const first = await reads.events(f.session.token, f.launch.task_id);
    expect(first.events).toHaveLength(64); expect(first.has_more).toBe(true);
    expect(await reads.events(f.session.token, f.launch.task_id)).toEqual(first);
    await append(f.launch.task_id, f.launch.attempt_id, [{ index: 70 }]);
    const second = await new OwnerReads(db).events(f.session.token, f.launch.task_id, first.cursor);
    expect(second.events.map((event) => event.sequence)).toEqual([65, 66, 67, 68, 69, 70, 71]);
    expect(second.has_more).toBe(false); expect(second.reset_required).toBe(false);
    const empty = await reads.events(f.session.token, f.launch.task_id, second.cursor);
    expect(empty.events).toHaveLength(0); expect(empty.cursor).toBe(second.cursor);
    expect(new Set([...first.events, ...second.events].map((event) => event.sequence)).size).toBe(71);
  });

  it('bounds encoded UTF-8 pages and treats Runner paths as opaque data', async () => {
    const f = await fixture(); const body = { text: '界'.repeat(300000), path: '/nonexistent/runner-only/workspace/file' };
    await append(f.launch.task_id, f.launch.attempt_id, [body, body, body]);
    const page = await reads.events(f.session.token, f.launch.task_id);
    expect(page.events).toHaveLength(2); expect(page.has_more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(page.events[0]!.body.path).toBe(body.path);
    const next = await reads.events(f.session.token, f.launch.task_id, page.cursor);
    expect(next.events.map((event) => event.sequence)).toEqual([3]);
  });

  it('reports gaps and future cursors explicitly instead of silently skipping formal history', async () => {
    const f = await fixture(); await append(f.launch.task_id, f.launch.attempt_id, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    await db.pool.query('DELETE FROM task_events WHERE task_id=$1 AND sequence=2', [f.launch.task_id]);
    for (const cursor of [taskEventCursor(f.launch.task_id, 1), taskEventCursor(f.launch.task_id, 99)]) {
      const page = await reads.events(f.session.token, f.launch.task_id, cursor);
      expect(page.reset_required).toBe(true); expect(page.events).toHaveLength(0);
      expect(page.cursor).toBe((await reads.overview(f.session.token, f.launch.task_id)).event_cursor);
    }
  });

  it('authenticates every overview/page and rejects malformed or cross-Task cursors at HTTP boundaries', async () => {
    const f = await fixture(); const other = await fixture(); const app = createApp(f.service);
    try {
      for (const suffix of ['', '/events']) {
        const url = `/v1/owner/tasks/${f.launch.task_id}${suffix}`;
        expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${f.runnerToken}` } })).statusCode).toBe(401);
        expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(200);
      }
      const prefix = `/v1/owner/tasks/${f.launch.task_id}/events?cursor=`;
      expect((await app.inject({ method: 'GET', url: prefix + taskEventCursor(other.launch.task_id, 0), headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: prefix + 'invalid', headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(409);
      await revokeOwnerSession(db, f.session.session_id);
      expect((await app.inject({ method: 'GET', url: `/v1/owner/tasks/${f.launch.task_id}`, headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(401);
      await expect(reads.events(f.session.token, f.launch.task_id)).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
    } finally { await app.close(); }
  });

  it('pages ordered multi-stream output through gaps and reconnects with scoped cursors', async () => {
    const f = await fixture(); const other = await fixture();
    await db.pool.query("UPDATE attempts SET launch=launch||'{\"log_mode\":\"ordered_v1\"}'::jsonb WHERE id=$1", [f.launch.attempt_id]);
    const event = (stream_id: string, sequence: number, order_sequence: number, text: string) => ({
      attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id, sequence, order_sequence,
      kind: 'output' as const, text, data_base64: Buffer.from(text).toString('base64'),
    });
    const first = event('stdout', 1, 1, 'first'); const second = event('stderr', 1, 2, 'second'); const third = event('stdout', 2, 3, 'third');
    await expect(f.service.event(f.runner, f.incarnation, { ...first, data_base64: 'Zmlyc3Q' })).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    await f.service.event(f.runner, f.incarnation, third);
    await f.service.event(f.runner, f.incarnation, second);
    expect((await reads.logs(f.session.token, f.launch.task_id, f.launch.attempt_id)).events).toHaveLength(0);
    expect((await reads.attempt(f.session.token, f.launch.task_id, f.launch.attempt_id)).latest_sequence).toBe(3);
    expect((await reads.attempts(f.session.token, f.launch.task_id)).attempts.map((row) => row.attempt_id)).toEqual([f.launch.attempt_id]);
    await f.service.event(f.runner, f.incarnation, first);
    await f.service.event(f.runner, f.incarnation, first);
    await expect(f.service.event(f.runner, f.incarnation, { ...first, text: 'conflict' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    await expect(f.service.event(f.runner, f.incarnation, { ...first, stream_id: 'other' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const page = await new OwnerReads(db).logs(f.session.token, f.launch.task_id, f.launch.attempt_id);
    expect(page.events.map((value) => value.text)).toEqual(['first', 'second', 'third']);
    expect(page.events.map((value) => value.order_sequence)).toEqual([1, 2, 3]);
    expect(page.has_more).toBe(false);
    expect((await new OwnerReads(db).logs(f.session.token, f.launch.task_id, f.launch.attempt_id, page.cursor)).events).toHaveLength(0);
    expect((await reads.events(f.session.token, f.launch.task_id)).events).toHaveLength(0);
    await expect(reads.logs(f.session.token, f.launch.task_id, f.launch.attempt_id, attemptLogCursor(other.launch.task_id, other.launch.attempt_id, 0))).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(reads.logs(f.session.token, f.launch.task_id, f.launch.attempt_id, attemptLogCursor(f.launch.task_id, f.launch.attempt_id, 99))).rejects.toMatchObject({ detail: { code: 'version_conflict' } });
    const app = createApp(f.service);
    try {
      const path = `/v1/owner/tasks/${f.launch.task_id}/attempts/${f.launch.attempt_id}/logs`;
      expect((await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${f.runnerToken}` } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/v1/owner/tasks/${f.launch.task_id}/attempts`, headers: { authorization: `Bearer ${f.session.token}` } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('bounds encoded log pages and advances only across returned entries', async () => {
    const f = await fixture();
    await db.pool.query("UPDATE attempts SET launch=launch||'{\"log_mode\":\"ordered_v1\"}'::jsonb WHERE id=$1", [f.launch.attempt_id]);
    const text = '界'.repeat(10000);
    for (let sequence = 1; sequence <= 50; sequence++) {
      await f.service.event(f.runner, f.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id,
        stream_id: 'stdout', sequence, order_sequence: sequence, kind: 'output', text, data_base64: Buffer.from(text).toString('base64') });
    }
    const first = await reads.logs(f.session.token, f.launch.task_id, f.launch.attempt_id);
    expect(first.events.length).toBeGreaterThan(0); expect(first.events.length).toBeLessThan(50);
    expect(first.has_more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(MAX_BODY_BYTES);
    const second = await new OwnerReads(db).logs(f.session.token, f.launch.task_id, f.launch.attempt_id, first.cursor);
    expect(second.events[0]?.order_sequence).toBe(first.events.length + 1);
    expect(first.events.length + second.events.length).toBe(50);
  });

  it('lists queued and historical Attempts by creation time with factual activity', async () => {
    const f = await fixture();
    const before = await reads.attempt(f.session.token, f.launch.task_id, f.launch.attempt_id);
    expect(before).toHaveProperty('created_at');
    expect(before).not.toHaveProperty('activity_at');
    const historical = randomUUID(); const dispatch = randomUUID();
    await db.pool.query(`INSERT INTO attempts(id,runner_id,task_id,node_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,
      mutation_allowed,process_released,process_absent,started,launch,created_at,state,end_reason)
      SELECT $2,runner_id,task_id,node_id,owner_key,$3,kind,fencing_generation,node_activation,
        false,true,true,true,launch,created_at+interval '1 second','FAILED','missing_formal_outcome'
      FROM attempts WHERE id=$1`, [f.launch.attempt_id, historical, dispatch]);
    const listed = await reads.attempts(f.session.token, f.launch.task_id);
    expect(listed.attempts.map((row) => row.attempt_id)).toEqual([historical, f.launch.attempt_id]);
    expect(listed.attempts[0]?.end_reason).toBe('missing_formal_outcome');
    const afterFirst = await reads.attempts(f.session.token, f.launch.task_id, attemptListCursor(f.launch.task_id,
      (await db.pool.query<{ created_cursor: string }>('SELECT created_at::text AS created_cursor FROM attempts WHERE id=$1', [historical])).rows[0]!.created_cursor, historical));
    expect(afterFirst.attempts.map((row) => row.attempt_id)).toEqual([f.launch.attempt_id]);
  });

  it('returns a pre-start projection without inventing a Plan or runtime work', async () => {
    const id = randomUUID(); const session = await issueOwnerSession(db);
    await transaction(db, (tx) => initializeTask(tx, { task_id: id, specification_id: randomUUID(), specification: {} }));
    const value = await reads.overview(session.token, id);
    expect(value.state).toBe('PLANNING'); expect(value).not.toHaveProperty('plan_id');
    expect(value.nodes).toEqual({ pending: 0, running: 0, blocked: 0, completed: 0, cancelled: 0 });
    expect(value.queued_attempts + value.held_attempts + value.open_operations).toBe(0);
  });
});
