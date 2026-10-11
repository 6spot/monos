import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest } from '../../../packages/protocol/src/index.ts';
import type { RetentionPolicy, TaskCleanupRequest, TaskCleanupResult } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { BoundaryService } from '../src/service.ts';
import { setupReadiness } from '../src/setup-readiness.ts';
import { TaskCleanup } from '../src/task-cleanup.ts';
import { taskResults } from '../src/task-result-reads.ts';
import { multiRepositoryDeliveryFixture } from './fixtures/multi-repository-delivery-fixture.ts';
import { ownerDeliveryFixture } from './fixtures/owner-delivery-fixture.ts';

// Only historical age is synthetic. Completion itself goes through exact Owner
// acceptance and delivery; the production timestamp trigger is checked separately.
async function age(db: Database, taskIds: string[], days = 8) {
  await transaction(db, async tx => {
    await tx.query('ALTER TABLE tasks DISABLE TRIGGER task_completion_time');
    await tx.query("UPDATE tasks SET completed_at=clock_timestamp()-$2*interval '1 day' WHERE id=ANY($1::text[]) AND state='COMPLETED'", [taskIds, days]);
    await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
    await tx.query('ALTER TABLE tasks ENABLE TRIGGER task_completion_time');
  });
}

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Completed Task storage cleanup', { timeout: 30000 }, () => {
  it('uses configured retention only after completed-task writers settle and retains formal output', async () => {
    const x = await ownerDeliveryFixture('repository_free', {}, { artifactCount: 1 });
    try {
      const cleanup = new TaskCleanup(x.db, x.service.instanceId), configuration = new Configuration(x.db);
      const jobs = async () => (await x.db.pool.query('SELECT * FROM task_cleanup_jobs')).rows;
      const save = async (retention: RetentionPolicy) => configuration.save(x.token, { schema_version: 1, request_id: randomUUID(),
        expected_control_version: (await configuration.read(x.token)).control_version, name: 'save_retention', payload: retention });
      expect((await configuration.read(x.token)).retention).toEqual({ enabled: true, completed_task_days: 7 });
      await expect(save({ enabled: true, completed_task_days: 0 })).rejects.toThrow();
      await cleanup.pump(); expect(await jobs()).toEqual([]);
      expect((await x.db.pool.query('SELECT state,completed_at FROM tasks WHERE id=$1', [x.f.task])).rows[0]).toEqual({ state: 'REVIEW', completed_at: null });
      const proposal = await x.prepareDelivery(), confirmation = await x.confirmDelivery(proposal);
      await x.acceptDelivery(proposal, confirmation);
      const completed = (await x.db.pool.query('SELECT completed_at FROM tasks WHERE id=$1', [x.f.task])).rows[0].completed_at;
      expect(completed).toBeInstanceOf(Date);
      await expect(x.db.pool.query("UPDATE tasks SET completed_at=completed_at-interval '1 day' WHERE id=$1", [x.f.task])).rejects.toMatchObject({ code: '23514' });
      await expect(x.db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1", [x.f.task])).rejects.toMatchObject({ code: '23514' });
      await cleanup.pump(); expect(await jobs()).toEqual([]);
      await age(x.db, [x.f.task]);
      await save({ enabled: true, completed_task_days: 14 }); await cleanup.pump(); expect(await jobs()).toEqual([]);
      await save({ enabled: false, completed_task_days: 7 }); await cleanup.pump(); expect(await jobs()).toEqual([]);
      await save({ enabled: true, completed_task_days: 7 });
      // Terminal conversation is legitimate new physical ownership. A Task's
      // COMPLETED state must not let cleanup race that still-running Planner.
      await x.send('Explain the retained completed result'); const conversation = await x.turn();
      await cleanup.pump(); expect(await jobs()).toEqual([]);
      const reply = await x.reply(conversation); await x.finish(reply.operation_id!, conversation.dispatch.attempt_id);
      await cleanup.pump();
      const rows = await jobs(); expect(rows).toHaveLength(1);
      const request = rows[0].request as TaskCleanupRequest;
      expect(request).toMatchObject({ task_id: x.f.task, runner_id: x.f.runner, results: [], workspaces: [] });
      expect(request.attempts.map(a => a.attempt_id)).toContain(conversation.dispatch.attempt_id);
      expect((await setupReadiness(x.db, x.token, x.service.instanceId)).cleanup).toMatchObject({ policy: { enabled: true, completed_task_days: 7 }, pending: 1, completed: 0, attention: 0 });
      const records = async () => (await x.db.pool.query(`SELECT
        (SELECT jsonb_agg(a ORDER BY id) FROM artifacts a WHERE task_id=$1) artifacts,
        (SELECT jsonb_agg(c ORDER BY operation_id) FROM completion_manifests c WHERE task_id=$1) completions,
        (SELECT jsonb_agg(m ORDER BY id) FROM task_messages m WHERE task_id=$1) messages`, [x.f.task])).rows[0];
      const before = await records();
      const result: TaskCleanupResult = { schema_version: 1, cleanup_id: request.cleanup_id, request_digest: digest(canonicalJSON(request)), status: 'completed' };
      expect(await cleanup.finish(x.f.runner, x.f.incarnation, result)).toEqual({ cleanup_id: request.cleanup_id, request_digest: result.request_digest });
      expect(await records()).toEqual(before);
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('COMPLETED');
      await x.send('Explain the result after disposable files were cleaned');
      const afterCleanup = await x.turn();
      expect(afterCleanup.dispatch.task_conversation_source).toBeDefined();
      const followup = await x.reply(afterCleanup); await x.finish(followup.operation_id!, afterCleanup.dispatch.attempt_id);
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('COMPLETED');
      await cleanup.pump();
      expect(await jobs()).toHaveLength(1); expect((await jobs())[0].request).toEqual(request);
    } finally { await x.close(); }
  });

  it('freezes every repository result and recovers exact Runner/digest-bound completion and ACK across reconnects', async () => {
    const x = await multiRepositoryDeliveryFixture('after_acceptance', [0, 1]);
    try {
      const accepted = await x.accept(); await x.prepareRemote(); await x.barrier(accepted.operation_id!); await x.pump(); await x.pump();
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('COMPLETED');
      await age(x.db, [x.f.task]);
      const cleanup = new TaskCleanup(x.db, x.service.instanceId);
      await cleanup.pump();
      const job = (await x.db.pool.query('SELECT * FROM task_cleanup_jobs WHERE task_id=$1', [x.f.task])).rows[0];
      expect(job).toBeDefined(); expect(job.status).toBe('pending');
      const request = job.request as TaskCleanupRequest;
      expect(request.results).toHaveLength(2); expect(request.workspaces).toHaveLength(2);
      expect(request.results.map(r => r.resource_id).sort()).toEqual(x.resources);
      expect(request.workspaces.map(w => w.resource_id).sort()).toEqual(x.resources);
      for (const workspace of request.workspaces) expect(request.results).toContainEqual(expect.objectContaining({ workspace_id: workspace.workspace_id, git_commit: workspace.finalized_commit, storage_id: workspace.storage_id, generation: workspace.generation }));
      const retained = async () => ({ result: await taskResults(x.db, x.token, x.f.task), batch: await x.reads.batch(x.token, x.f.task, accepted.operation_id!) });
      const before = await retained();
      expect(await cleanup.pending(x.f.runner, x.f.incarnation, false)).toEqual([]);
      expect(await cleanup.pending(x.f.runner, x.f.incarnation, true)).toEqual([expect.objectContaining({ type: 'task_cleanup', cleanup_request: request })]);
      expect(await cleanup.pending(x.f.runner, x.f.incarnation, true)).toEqual([]);
      await expect(x.db.pool.query("UPDATE task_cleanup_jobs SET request=jsonb_set(request,'{task_id}','\"foreign\"') WHERE id=$1", [job.id])).rejects.toMatchObject({ code: '23514' });
      const result: TaskCleanupResult = { schema_version: 1, cleanup_id: request.cleanup_id, request_digest: job.request_digest, status: 'completed' };
      await expect(cleanup.finish(x.f.runner, x.f.incarnation, { ...result, request_digest: 'f'.repeat(64) })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
      const otherRunner = randomUUID(); await enrollFixture(x.db, otherRunner, randomUUID());
      const otherIncarnation = await x.service.connect(otherRunner, 'other'); await x.service.touch(otherRunner, otherIncarnation, true);
      await expect(cleanup.finish(otherRunner, otherIncarnation, result)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
      // A backend restart and Runner reconnect retain the same request; a stale
      // connection cannot acknowledge a deletion or mutate the completed row.
      const restarted = new BoundaryService(x.db, { signingKey: x.service.options.signingKey }), resumed = new TaskCleanup(x.db, restarted.instanceId);
      const incarnation = await restarted.connect(x.f.runner, 'same-boot', x.runnerCredential);
      await restarted.touch(x.f.runner, incarnation, true);
      await expect(cleanup.finish(x.f.runner, x.f.incarnation, result)).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
      await x.db.pool.query("UPDATE task_cleanup_jobs SET last_sent_at=clock_timestamp()-interval '61 seconds' WHERE id=$1", [job.id]);
      expect(await resumed.pending(x.f.runner, incarnation, true)).toEqual([expect.objectContaining({ cleanup_request: request })]);
      expect(await resumed.finish(x.f.runner, incarnation, { ...result, status: 'blocked', reason: 'ownership_unresolved' })).toBeNull();
      expect((await x.db.pool.query('SELECT cleaned_at FROM task_workspaces WHERE task_id=$1', [x.f.task])).rows.every(w => w.cleaned_at === null)).toBe(true);
      expect((await setupReadiness(x.db, x.token, restarted.instanceId)).cleanup).toMatchObject({ attention: 1 });
      const ack = { cleanup_id: job.id, request_digest: job.request_digest };
      expect(await resumed.finish(x.f.runner, incarnation, result)).toEqual(ack);
      const finished = (await x.db.pool.query('SELECT * FROM task_cleanup_jobs WHERE id=$1', [job.id])).rows[0];
      expect(await resumed.finish(x.f.runner, incarnation, result)).toEqual(ack);
      expect((await x.db.pool.query('SELECT * FROM task_cleanup_jobs WHERE id=$1', [job.id])).rows[0]).toEqual(finished);
      expect(await resumed.pending(x.f.runner, incarnation, true)).toEqual([]);
      expect((await x.db.pool.query('SELECT cleaned_at FROM task_workspaces WHERE task_id=$1', [x.f.task])).rows.every(w => w.cleaned_at instanceof Date)).toBe(true);
      await expect(resumed.finish(x.f.runner, incarnation, { ...result, status: 'blocked', reason: 'cleanup_failed' })).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
      await expect(x.db.pool.query('DELETE FROM task_cleanup_jobs WHERE id=$1', [job.id])).rejects.toMatchObject({ code: '23514' });
      expect(await retained()).toEqual(before);
    } finally { await x.close(); }
  });

  it('advances beyond more than one batch of unresolved owners without cleaning cancelled Tasks', async () => {
    const x = await ownerDeliveryFixture();
    try {
      const proposal = await x.prepareDelivery(); await x.acceptDelivery(proposal, await x.confirmDelivery(proposal));
      await x.db.pool.query('UPDATE runners SET capacity=32 WHERE id=$1', [x.f.runner]);
      const blocked: string[] = [];
      for (let i = 0; i < 17; i++) {
        // Leading '-' sorts before every UUID, ensuring the first batch is
        // entirely unresolved; these are explicit physical-ownership fixtures.
        const task = `-cleanup-owned-${String(i).padStart(2, '0')}`;
        await createAttemptFixture(x.db, { runner_id: x.f.runner, task_id: task, attempt_id: randomUUID(), resource_id: randomUUID(), kind: 'node', prompt: 'unresolved owner' });
        await x.db.pool.query("UPDATE tasks SET state='COMPLETED' WHERE id=$1", [task]); blocked.push(task);
      }
      const cancelled = '-cleanup-cancelled';
      await createAttemptFixture(x.db, { runner_id: x.f.runner, task_id: cancelled, attempt_id: randomUUID(), resource_id: randomUUID(), kind: 'node', prompt: 'cancelled retains storage' });
      await x.db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1", [cancelled]);
      await age(x.db, [x.f.task, ...blocked]);
      const cleanup = new TaskCleanup(x.db, x.service.instanceId);
      await cleanup.pump();
      expect((await x.db.pool.query('SELECT task_id FROM task_cleanup_jobs')).rows).toEqual([]);
      await cleanup.pump();
      expect((await x.db.pool.query('SELECT task_id FROM task_cleanup_jobs')).rows).toEqual([{ task_id: x.f.task }]);
      expect((await x.db.pool.query('SELECT completed_at FROM tasks WHERE id=$1', [cancelled])).rows[0].completed_at).toBeNull();
      const foreignJob = { schema_version: 1, cleanup_id: randomUUID(), task_id: cancelled, runner_id: x.f.runner,
        completed_at: new Date().toISOString(), workspaces: [], attempts: [], results: [] };
      await expect(x.db.pool.query('INSERT INTO task_cleanup_jobs(id,task_id,runner_id,request,request_digest) VALUES($1,$2,$3,$4,$5)',
        [foreignJob.cleanup_id, cancelled, x.f.runner, foreignJob, digest(canonicalJSON(foreignJob))])).rejects.toMatchObject({ code: '23514' });
    } finally { await x.close(); }
  });
});
