import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { Worker } from './fixtures/process-worker.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')(
  'Task conversation independent processes',
  { timeout: 30000 },
  () => {
    let x: Awaited<ReturnType<typeof conversationFixture>>;
    const workers: Worker[] = [];
    beforeEach(async () => {
      x = await conversationFixture();
    }, 20000);
    afterEach(async () => {
      await Promise.all(workers.splice(0).map((w) => w.stop()));
      await x?.close();
    }, 20000);
    async function contention(mode: 'submit' | 'pump') {
      const holder = await x.db.pool.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
      const group = Array.from(
        { length: 2 },
        () => new Worker(x.databaseUrl, new URL('./fixtures/task-conversation-worker.ts', import.meta.url)),
      );
      workers.push(...group);
      try {
        const ready = await Promise.all(group.map((w) => w.next('ready')));
        expect(new Set(ready.map((r) => r.pid)).size).toBe(2);
        group.forEach((w) =>
          w.send({
            mode,
            instance: x.service.instanceId,
            token: x.token,
            body: {
              schema_version: 1,
              request_id: randomUUID(),
              task_id: x.f.task,
              name: 'submit_task_message',
              payload: {
                message_id: randomUUID(),
                content: 'Independent process input',
              },
            },
          }),
        );
        let waiting = 0;
        for (let i = 0; i < 500; i++) {
          waiting = Number(
            (
              await x.admin.pool.query(
                "SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",
                [ready.map((r) => r.pid)],
              )
            ).rows[0].count,
          );
          if (waiting === 2) break;
          await delay(10);
        }
        expect(waiting).toBe(2);
        await holder.query('COMMIT');
        const done = await Promise.all(group.map((w) => w.next('done', 'error')));
        expect(done.map((r) => r.type)).toEqual(['done', 'done']);
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
    }
    it('serializes distinct Owner appends from two observed waiting backends', async () => {
      await contention('submit');
      const rows = (
        await x.db.pool.query("SELECT sequence FROM task_messages WHERE author='owner' ORDER BY sequence")
      ).rows;
      expect(rows.map((r) => Number(r.sequence))).toEqual([1, 2]);
      expect((await x.db.pool.query('SELECT count(*) FROM task_inputs')).rows[0].count).toBe('2');
      expect(await x.version()).toBe(1);
    });
    it('prepares and selects one frozen source when two Planner workers contend', async () => {
      await x.send('plan a reply');
      await contention('pump');
      expect((await x.db.pool.query('SELECT count(*) FROM task_conversation_outbox')).rows[0].count).toBe(
        '1',
      );
      expect((await x.db.pool.query('SELECT count(*) FROM attempts')).rows[0].count).toBe('1');
      const a = await x.promote();
      expect(a.dispatch.task_conversation_source).toBeDefined();
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    });
    it.each(['before', 'after'] as const)(
      'SIGKILL %s commit preserves atomic reply/obligation/Stop ownership',
      async (crash) => {
        const input = await x.send('Keep exact output');
        const a = await x.turn(),
          source = a.dispatch.task_conversation_source!,
          request = randomUUID();
        const command = {
          schema_version: 1,
          request_id: request,
          scope_id: x.f.task,
          expected_control_version: a.dispatch.control_version,
          name: 'commit_task_turn',
          payload: {
            source_id: source.source_id,
            input_id: source.input_id,
            source_watermark: source.source_watermark,
            reply: 'Instruction recorded',
            routing: {
              kind: 'guidance',
              text: 'Keep exact output',
              basis: await x.basis(),
            },
          },
        };
        const worker = new Worker(x.databaseUrl, new URL('./fixtures/admission-worker.ts', import.meta.url));
        workers.push(worker);
        await worker.next('ready');
        worker.send({ launch: a.dispatch, command, crash });
        await worker.exited;
        expect(worker.child.signalCode).toBe('SIGKILL');
        const wanted = crash === 'after' ? '1' : '0';
        for (const table of ['command_receipts', 'task_input_resolutions', 'task_guidance'])
          expect((await x.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe(wanted);
        expect(
          (await x.db.pool.query("SELECT count(*) FROM operations WHERE kind='stop'")).rows[0].count,
        ).toBe(wanted);
        expect((await x.db.pool.query("SELECT count(*) FROM outbox WHERE kind='effect'")).rows[0].count).toBe(
          wanted,
        );
        const state = (await x.db.pool.query('SELECT status FROM task_inputs WHERE id=$1', [input.input_id]))
          .rows[0].status;
        expect(state).toBe(crash === 'after' ? 'replied' : 'pending');
        const attempt = (
          await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [
            a.dispatch.attempt_id,
          ])
        ).rows[0];
        expect(attempt.process_released).toBe(false);
        expect(attempt.mutation_allowed).toBe(crash === 'before');
        expect(await x.version()).toBe(1);
      },
    );
  },
);
