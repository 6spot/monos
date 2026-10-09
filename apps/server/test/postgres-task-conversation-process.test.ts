import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { Worker } from './fixtures/process-worker.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope } from '../../../packages/protocol/src/index.ts';
import { TaskSpecification } from '../src/task-specification.ts';
import { specificationImpact } from '../src/task-specification-state.ts';

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
      'SIGKILL %s proposal reply commit preserves one eligible proposal through same-input Retry',
      async (crash) => {
        const spec = new TaskSpecification(x.db);
        const input = await x.send('Change the full requirement');
        const turn = await x.turn();
        const source = turn.dispatch.task_conversation_source!;
        const prepare = async (active: typeof turn) => {
          const proposalId = randomUUID();
          const basis = await x.basis();
          const impact = await transaction(x.db, async (tx) => specificationImpact(
            tx, (await tx.query('SELECT * FROM tasks WHERE id=$1', [x.f.task])).rows[0],
          ));
          const prepared = await x.agent(active, 'prepare_specification_revision', {
            proposal_id: proposalId, specification: 'Exact revised requirement',
            summary: 'Replace the original requirement', basis, impact,
            source_input_ids: [input.input_id!],
          });
          return { proposalId, basis, prepared };
        };
        const confirm = (proposal: Awaited<ReturnType<typeof prepare>>) => spec.command(x.token, {
          schema_version: 1, request_id: randomUUID(), task_id: x.f.task,
          name: 'confirm_specification', payload: {
            proposal_id: proposal.proposalId, content_digest: proposal.prepared.result!.content_digest,
          },
        });
        const controlInput = async (name: 'stop_task_turn' | 'retry_task_input') => {
          const row = (await x.db.pool.query('SELECT version FROM task_inputs WHERE id=$1', [input.input_id])).rows[0];
          return x.conversation.command(x.token, {
            schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name,
            expected_version: Number(row.version), payload: { operation_id: input.input_id },
          });
        };
        const draft = await prepare(turn);
        const retainedDraft = (await x.db.pool.query('SELECT * FROM requirement_proposals WHERE id=$1', [draft.proposalId])).rows[0];
        await expect(confirm(draft)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
        const command: CommandEnvelope = {
          schema_version: 1, request_id: randomUUID(), scope_id: x.f.task,
          expected_control_version: turn.dispatch.control_version, name: 'commit_task_turn',
          payload: {
            source_id: source.source_id, input_id: source.input_id,
            source_watermark: source.source_watermark, reply: 'Exact requirement proposal prepared',
            routing: { kind: 'specification_proposal', proposal_id: draft.proposalId, basis: draft.basis },
          },
        };
        const worker = new Worker(x.databaseUrl, new URL('./fixtures/admission-worker.ts', import.meta.url));
        workers.push(worker);
        await worker.next('ready');
        worker.send({ launch: turn.dispatch, command, crash });
        await worker.exited;
        expect(worker.messages).toEqual([]);
        expect(worker.child.signalCode).toBe('SIGKILL');
        // Receipt recovery takes the canonical locks, so disconnect rollback has completed.
        const recovered = await x.service.recoverCommand(x.f.runner, turn.dispatch.attempt_id, command.request_id);
        expect(recovered.status).toBe(crash === 'before' ? 'unknown' : 'committed');
        const committed = crash === 'after' ? '1' : '0';
        for (const table of ['requirement_attachments', 'task_input_resolutions']) {
          expect((await x.db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe(committed);
        }
        expect((await x.db.pool.query("SELECT count(*) FROM task_messages WHERE author='assistant'")).rows[0].count).toBe(committed);
        expect((await x.db.pool.query('SELECT count(*) FROM command_receipts WHERE request_id=$1', [command.request_id])).rows[0].count).toBe(committed);
        expect((await x.db.pool.query("SELECT count(*) FROM operations WHERE kind='stop'")).rows[0].count).toBe(committed);
        expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [turn.dispatch.attempt_id])).rows[0]).toEqual({
          mutation_allowed: crash === 'before', process_released: false,
        });
        x.f.incarnation = await x.service.connect(x.f.runner, 'proposal-crash-recovery');
        await x.service.touch(x.f.runner, x.f.incarnation, true, [{
          runtime_id: 'opencode', executable: '/opencode', availability: 'detected',
          supports_model: true, supports_thinking: false, model_ids: [],
        }]);
        let eligible = draft;
        let finalTurn = turn;
        let finalReply = recovered;
        if (crash === 'before') {
          await expect(confirm(draft)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
          expect((await x.db.pool.query('SELECT status FROM task_inputs WHERE id=$1', [input.input_id])).rows[0].status).toBe('pending');
          const stopped = await controlInput('stop_task_turn');
          // Trusted fake Runner settlement proves database ownership guards, not native process absence.
          await x.finish(stopped.operation_id!, turn.dispatch.attempt_id);
          await controlInput('retry_task_input');
          finalTurn = await x.turn();
          const fresh = finalTurn.dispatch.task_conversation_source!;
          expect(fresh.input_id).toBe(input.input_id);
          expect(fresh.source_watermark).toBe(source.source_watermark);
          expect(fresh.source_id).not.toBe(source.source_id);
          expect(finalTurn.dispatch.attempt_id).not.toBe(turn.dispatch.attempt_id);
          await expect(x.reply(finalTurn, {
            kind: 'specification_proposal', proposal_id: draft.proposalId, basis: draft.basis,
          })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
          eligible = await prepare(finalTurn);
          const request = randomUUID();
          const routing = { kind: 'specification_proposal' as const, proposal_id: eligible.proposalId, basis: eligible.basis };
          finalReply = await x.reply(finalTurn, routing, request);
          expect(await x.reply(finalTurn, routing, request)).toEqual(finalReply);
          await expect(confirm(draft)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
        } else {
          expect(await x.service.admit(turn.credential, submission(command))).toEqual(recovered);
          await expect(controlInput('retry_task_input')).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
        }
        await x.finish(finalReply.operation_id!, finalTurn.dispatch.attempt_id);
        const confirmation = await confirm(eligible);
        expect(confirmation.confirmation_id).toBeTruthy();
        expect((await confirm(eligible)).confirmation_id).toBe(confirmation.confirmation_id);
        await expect(controlInput('retry_task_input')).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
        await x.conversation.pump();
        expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
        expect((await x.db.pool.query('SELECT * FROM requirement_proposals WHERE id=$1', [draft.proposalId])).rows[0]).toEqual(retainedDraft);
        expect((await x.db.pool.query('SELECT proposal_id,source_id,input_id FROM requirement_attachments')).rows).toEqual([{
          proposal_id: eligible.proposalId, source_id: finalTurn.dispatch.task_conversation_source!.source_id,
          input_id: input.input_id,
        }]);
        expect((await x.db.pool.query("SELECT count(*) FROM requirement_obligations WHERE current_proposal_id IS NOT NULL AND status='pending'")).rows[0].count).toBe('1');
        expect((await x.db.pool.query('SELECT proposal_id FROM authorization_receipts')).rows).toEqual([{ proposal_id: eligible.proposalId }]);
        expect((await x.db.pool.query("SELECT input_id,source_id FROM task_messages WHERE author='assistant'")).rows).toEqual([{
          input_id: input.input_id, source_id: finalTurn.dispatch.task_conversation_source!.source_id,
        }]);
        expect((await x.db.pool.query('SELECT input_id,request_id,attempt_id FROM task_input_resolutions')).rows).toEqual([{
          input_id: input.input_id, request_id: finalReply.request_id, attempt_id: finalTurn.dispatch.attempt_id,
        }]);
        expect((await x.db.pool.query("SELECT count(*) FROM attempts WHERE NOT process_released")).rows[0].count).toBe('0');
        expect((await x.db.pool.query('SELECT conversation_watermark,conversation_input_id FROM tasks WHERE id=$1', [x.f.task])).rows[0]).toEqual({
          conversation_watermark: String(source.source_watermark), conversation_input_id: null,
        });
        expect(await x.version()).toBe(1);
      },
    );
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
