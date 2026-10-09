import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../src/service.ts';
import { Configuration } from '../src/configuration.ts';
import { OwnerDeliveryCommands } from '../src/owner-delivery-commands.ts';
import type { OwnerDeliveryCommand } from '../../../packages/protocol/src/index.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')(
  'ordered Task conversation',
  { timeout: 20000 },
  () => {
    let x: Awaited<ReturnType<typeof conversationFixture>>;
    beforeEach(async () => {
      x = await conversationFixture();
    }, 20000);
    afterEach(async () => {
      await x?.close();
    }, 20000);
    it('orders concurrent input, preserves active epoch and one canonical reply across replay', async () => {
      const [a, b] = await Promise.all([x.send('first'), x.send('second')]);
      const before = await x.version();
      const turn = await x.turn();
      await x.send('later');
      expect((await x.conversation.status(x.token, x.f.task)).conversation_version).toBe(
        turn.dispatch.control_version,
      );
      const request = randomUUID(),
        out = await x.reply(turn, { kind: 'reply' }, request);
      expect(await x.reply(turn, { kind: 'reply' }, request)).toEqual(out);
      expect(await x.version()).toBe(before);
      expect((await x.db.pool.query('SELECT count(*) FROM task_input_resolutions')).rows[0].count).toBe('1');
      await x.conversation.pump();
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
      await x.finish(out.operation_id!, turn.dispatch.attempt_id);
      const next = await x.promote();
      expect([a.input_id, b.input_id]).toContain(next.dispatch.task_conversation_source!.input_id);
      expect(next.dispatch.task_conversation_source!.input_id).not.toBe(
        turn.dispatch.task_conversation_source!.input_id,
      );
    });
    it('retains input without Runtime and offers withdrawal independent of capacity', async () => {
      await x.db.pool.query("UPDATE execution_policies SET policies='{}'");
      const msg = await x.send('work');
      await x.conversation.pump();
      const state = await x.conversation.status(x.token, x.f.task);
      expect(state.waiting_reason).toBe('policy_missing');
      await x.conversation.command(x.token, {
        schema_version: 1,
        request_id: randomUUID(),
        task_id: x.f.task,
        name: 'withdraw_task_input',
        expected_version: 1,
        payload: { operation_id: msg.input_id },
      });
      expect((await x.conversation.messages(x.token, x.f.task)).messages[0]?.disposition).toBe('withdrawn');
      expect(await x.version()).toBe(1);
    });
    it('progress reply preserves the running Node and records its observation without creating revisions', async () => {
      await x.start();
      const node = await x.node();
      // Normalized fake Runner event: this test proves canonical continuity, not native liveness.
      await x.service.event(x.f.runner, x.f.incarnation, {
        attempt_id: node.dispatch.attempt_id, dispatch_id: node.dispatch.dispatch_id,
        stream_id: 'lifecycle', sequence: 1, order_sequence: 1,
        boot_id: 'progress-test', kind: 'started', text: '',
      });
      const executionFacts = async () => (await x.db.pool.query(`SELECT
        (SELECT jsonb_build_object('state',state,'control_version',control_version,
          'specification_id',specification_id,'plan_id',plan_id) FROM tasks WHERE id=$1) task,
        (SELECT to_jsonb(n) FROM nodes n WHERE id=$2) node,
        (SELECT to_jsonb(a) FROM attempts a WHERE id=$3) attempt,
        (SELECT jsonb_agg(o ORDER BY id) FROM outbox o WHERE attempt_id=$3) outbox,
        (SELECT jsonb_agg(s ORDER BY id) FROM specification_revisions s WHERE task_id=$1) specifications,
        (SELECT jsonb_agg(p ORDER BY id) FROM plan_revisions p WHERE task_id=$1) plans,
        (SELECT count(*) FROM node_execution_outbox WHERE task_id=$1) node_sources,
        (SELECT count(*) FROM operations WHERE attempt_id=$3) node_operations,
        (SELECT count(*) FROM task_guidance_obligations WHERE task_id=$1) guidance,
        (SELECT count(*) FROM requirement_proposals WHERE task_id=$1) proposals`,
      [x.f.task, x.f.node, node.dispatch.attempt_id])).rows[0];
      const before = await executionFacts();
      expect(before.task.state).toBe('RUNNING');
      expect(before.node.state).toBe('RUNNING');
      expect(before.attempt).toMatchObject({ started: true, mutation_allowed: true, process_released: false });
      const input = await x.send('What is the current progress?');
      const turn = await x.turn();
      const source = (await x.db.pool.query('SELECT context FROM task_conversation_outbox WHERE id=$1',
        [turn.dispatch.task_conversation_source!.source_id])).rows[0];
      expect(JSON.parse(source.context.observation.snapshot).nodes).toEqual([
        expect.objectContaining({ id: x.f.node, state: 'RUNNING', execution_source_id: node.dispatch.node_execution_source!.source_id }),
      ]);
      const reply = await x.reply(turn);
      await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
      await x.conversation.pump();
      await x.execution.pump();
      expect(await executionFacts()).toEqual(before);
      const message = (await x.db.pool.query("SELECT source_id, observed_control_version, observed_at FROM task_messages WHERE input_id=$1 AND author='assistant'",
        [input.input_id])).rows[0];
      expect(message.source_id).toBe(turn.dispatch.task_conversation_source!.source_id);
      expect(Number(message.observed_control_version)).toBe(source.context.observation.basis.control_version);
      expect(message.observed_at.toISOString()).toBe(source.context.observation.observed_at);
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
      // The original credential/source still admits completion after the progress-only reply.
      const completion = await x.agent(node, 'complete_node', { summary: 'Same Node continued after the progress reply' });
      await x.finish(completion.operation_id!, node.dispatch.attempt_id);
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
    });
    it('reply survives unrelated Node progress; stale action is atomic and correctable', async () => {
      await x.start();
      const n = await x.node();
      await x.send('status');
      const t = await x.turn(),
        oldBasis = await x.basis();
      const complete = await x.agent(n, 'complete_node', { summary: 'done' });
      await x.finish(complete.operation_id!, n.dispatch.attempt_id);
      await expect(
        x.reply(t, {
          kind: 'guidance',
          text: 'adjust within scope',
          basis: oldBasis,
        }),
      ).rejects.toMatchObject({ detail: { code: 'version_conflict' } });
      expect((await x.db.pool.query('SELECT count(*) FROM task_input_resolutions')).rows[0].count).toBe('0');
      const version = await x.version();
      await x.reply(t);
      expect(await x.version()).toBe(version);
    });
    it('binds pre-Plan guidance and rejects missing handling before fencing; successful completion settles only declared assignment', async () => {
      await x.send('Keep exact output');
      const t = await x.turn(),
        r = await x.reply(t, {
          kind: 'guidance',
          text: 'Keep exact output',
          basis: await x.basis(),
        });
      await x.finish(r.operation_id!, t.dispatch.attempt_id);
      await x.start();
      const n = await x.node();
      expect(n.dispatch.prompt).toContain(r.result!.obligation_id!);
      await expect(x.agent(n, 'complete_node', { summary: 'done' })).rejects.toMatchObject({
        detail: { code: 'unmet_precondition' },
      });
      expect(
        (await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [n.dispatch.attempt_id]))
          .rows[0].mutation_allowed,
      ).toBe(true);
      const c = await x.agent(n, 'complete_node', {
        summary: 'done',
        handled_guidance_ids: [r.result!.obligation_id!],
      });
      expect((await x.db.pool.query('SELECT status FROM task_guidance_obligations')).rows[0].status).toBe(
        'pending',
      );
      await x.finish(c.operation_id!, n.dispatch.attempt_id);
      expect((await x.db.pool.query('SELECT status FROM task_guidance_obligations')).rows[0].status).toBe(
        'handled',
      );
    });
    it('guidance before completion controls Stop/resume under same activation and waits for physical release', async () => {
      await x.start();
      const n = await x.node();
      await x.send('Adjust formatting');
      const t = await x.turn(),
        r = await x.reply(t, {
          kind: 'guidance',
          text: 'Adjust formatting',
          basis: await x.basis(),
        });
      await x.conversation.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count).toBe('1');
      await expect(x.agent(n, 'complete_node', { summary: 'old' })).rejects.toMatchObject({
        detail: { code: 'stale_execution' },
      });
      const stop = (
        await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [
          n.dispatch.attempt_id,
        ])
      ).rows[0];
      await x.finish(stop.id, n.dispatch.attempt_id);
      await x.finish(r.operation_id!, t.dispatch.attempt_id);
      await x.conversation.pump();
      const next = await x.node();
      expect(next.dispatch.node_activation).toBe(n.dispatch.node_activation);
      expect(next.dispatch.attempt_id).not.toBe(n.dispatch.attempt_id);
      expect(next.dispatch.prompt).toContain('Adjust formatting');
    });
    it('guidance after admission preserves frozen manifest and reactivates after success', async () => {
      await x.start();
      const n = await x.node(),
        c = await x.agent(n, 'complete_node', { summary: 'original' });
      const original = (await x.db.pool.query('SELECT * FROM completion_manifests')).rows[0];
      await x.send('Now refine');
      const t = await x.turn(),
        r = await x.reply(t, {
          kind: 'guidance',
          text: 'Refine current scope',
          basis: await x.basis(),
        });
      await x.finish(r.operation_id!, t.dispatch.attempt_id);
      await x.conversation.pump();
      expect((await x.db.pool.query('SELECT * FROM completion_manifests')).rows[0]).toEqual(original);
      await x.finish(c.operation_id!, n.dispatch.attempt_id);
      await x.conversation.pump();
      const next = await x.node();
      expect(next.dispatch.node_activation).toBe(2);
      expect((await x.db.pool.query('SELECT count(*) FROM node_completions')).rows[0].count).toBe('1');
      expect(next.dispatch.prompt).toContain('Refine current scope');
    });
    it.each(['retry', 'cancelled', 'already_finalized'] as const)(
      'hard completion %s preserves exact handling and later guidance responsibility',
      async (mode) => {
        const config = new Configuration(x.db),
          resource = randomUUID();
        await config.save(x.token, {
          schema_version: 1,
          request_id: randomUUID(),
          expected_control_version: (await config.read(x.token)).control_version,
          name: 'save_project',
          payload: {
            id: x.f.project,
            name: 'Project',
            context: 'Task project',
            archived: false,
            role_ids: [x.f.role],
            resources: [
              {
                id: resource,
                remote_url: 'https://github.com/example/conversation-test.git',
                remote_preparation: 'after_acceptance',
                default_branch: 'main',
              },
            ],
          },
        });
        const route = async (text: string) => {
          await x.send(text);
          await x.service.touch(x.f.runner,x.f.incarnation,true);
          const turn = await x.turn();
          const receipt = await x.reply(turn, { kind: 'guidance', text, basis: await x.basis() });
          await x.finish(receipt.operation_id!, turn.dispatch.attempt_id);
          return receipt.result!.obligation_id!;
        };
        const initial = await route('Original assigned instruction');
        await x.start();
        const n = await x.node();
        const opened = await x.agent(n, 'open_workspace', { resource_id: resource });
        const open = await x.service.recoverOperation(x.f.runner, opened.operation_id!);
        const w = open.workspace!,
          commit = 'c'.repeat(40),
          tree = 'b'.repeat(40);
        const metadata = {
          generation: 1,
          storage_id: 'storage',
          lease_id: w.lease_id,
          repository_identity: w.resource.repository_identity,
          provider_metadata: { github: { repository_id: '42' } },
          base_commit: 'a'.repeat(40),
          target_branch: 'main',
          target_commit: tree,
          finalized_commit: 'a'.repeat(40),
        };
        await x.service.finishOperation(x.f.runner, x.f.incarnation, {
          operation_id: open.operation_id,
          attempt_id: n.dispatch.attempt_id,
          success: true,
          result: {
            workspace_id: w.workspace_id,
            path: '/runner/worktree',
            instruction_files: [],
            workspace_metadata: metadata,
          },
        });
        const c = await x.agent(n, 'complete_node', {
          summary: 'Original completion',
          handled_guidance_ids: [initial],
        });
        const original = (await x.db.pool.query('SELECT * FROM completion_manifests')).rows[0];
        const later = await route('Later instruction outside the frozen manifest');
        await x.service.finishOperation(x.f.runner, x.f.incarnation, {
          operation_id: c.operation_id!,
          attempt_id: n.dispatch.attempt_id,
          success: false,
          failure_kind: 'invalid_finalization',
          result: { writer_absent: true, message: 'ancestry differs' },
        });
        await x.execution.pump();
        await x.conversation.pump();
        expect((await x.execution.status(x.token, x.f.task, x.f.node)).state).toBe('BLOCKED');
        expect((await x.db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count).toBe('1');
        const status = await x.execution.status(x.token, x.f.task, x.f.node);
        const operation = status.operations.find((o) => o.operation_id === c.operation_id)!;
        const recovery = await x.owner('recover_completion', {
          node_id: x.f.node,
          node_activation: 1,
          source_id: n.dispatch.node_execution_source!.source_id,
          operation_id: c.operation_id,
          completion_identity_digest: operation.completion_identity_digest,
          mode: mode === 'retry' ? 'retry' : 'correct',
        });
        const successful = {
          operation_id: c.operation_id!,
          attempt_id: n.dispatch.attempt_id,
          success: true,
          result: {
            writer_absent: true,
            workspace_id: w.workspace_id,
            workspace_metadata: { ...metadata, finalized_commit: commit },
            git_commit: commit,
            git_tree: tree,
          },
        };
        if (mode === 'retry') {
          expect(recovery.operation_id).toBe(c.operation_id);
          await x.service.finishOperation(x.f.runner, x.f.incarnation, successful);
        } else {
          const settlement = await x.service.recoverOperation(x.f.runner, recovery.operation_id!);
          await x.service.finishOperation(x.f.runner, x.f.incarnation, {
            operation_id: settlement.operation_id,
            attempt_id: n.dispatch.attempt_id,
            success: true,
            result:
              mode === 'already_finalized'
                ? { writer_absent: true }
                : {
                    writer_absent: true,
                    workspace_id: w.workspace_id,
                    workspace_metadata: {
                      ...metadata,
                      checkpoint: {
                        operation_id: settlement.operation_id,
                        head_commit: commit,
                        tree_id: tree,
                        commit_id: commit,
                        completion_operation_id: c.operation_id!,
                        completion_identity_digest: settlement.completion_identity_digest!,
                      },
                    },
                  },
            completion_settlement: {
              completion_operation_id: c.operation_id!,
              disposition: mode,
              completion_result:
                mode === 'already_finalized'
                  ? successful
                  : {
                      operation_id: c.operation_id!,
                      attempt_id: n.dispatch.attempt_id,
                      success: false,
                      cancelled_by_operation_id: settlement.operation_id,
                      result: { writer_absent: true },
                    },
            },
          });
        }
        expect((await x.db.pool.query('SELECT * FROM completion_manifests')).rows[0]).toEqual(original);
        const initialObligation = (
          await x.db.pool.query(
            'SELECT status FROM task_guidance_obligations WHERE guidance_id=$1 AND node_activation=1',
            [initial],
          )
        ).rows[0];
        expect(initialObligation.status).toBe(mode === 'cancelled' ? 'pending' : 'handled');
        expect(
          (
            await x.db.pool.query('SELECT status FROM task_guidance_obligations WHERE guidance_id=$1', [
              later,
            ])
          ).rows[0].status,
        ).toBe('pending');
        expect((await x.db.pool.query('SELECT count(*) FROM node_completions')).rows[0].count).toBe(
          mode === 'cancelled' ? '0' : '1',
        );
        await x.conversation.pump();
        await x.service.touch(x.f.runner,x.f.incarnation,true);
        const next = await x.node();
        expect(next.dispatch.node_activation).toBe(mode === 'cancelled' ? 1 : 2);
        expect(next.dispatch.node_execution_source!.source_id).not.toBe(
          n.dispatch.node_execution_source!.source_id,
        );
        const required = JSON.parse(next.dispatch.prompt).guidance.required_guidance_ids as string[];
        expect(required).toContain(later);
        if (mode === 'cancelled') expect(required).toContain(initial);
        expect(
          (await x.db.pool.query("SELECT count(*) FROM task_guidance_obligations WHERE status='pending'"))
            .rows[0].count,
        ).not.toBe('0');
      },
      30000,
    );
    it('a genuinely accepted repository-free Task keeps later input reply-only', async () => {
      await x.start();
      const node = await x.node();
      const completion = await x.agent(node, 'complete_node', { summary: 'Repository-free result' });
      await x.finish(completion.operation_id!, node.dispatch.attempt_id);
      const commands = new OwnerDeliveryCommands(x.db);
      const delivery = (name: OwnerDeliveryCommand['name'], payload: OwnerDeliveryCommand['payload']) =>
        commands.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload });
      const basis = { control_version: await x.version(), specification_id: x.f.spec, plan_id: x.f.plan };
      const proposal = await delivery('prepare_delivery_acceptance', { basis });
      const confirmation = await delivery('confirm_delivery_acceptance', {
        proposal_id: proposal.proposal_id, content_digest: proposal.content_digest,
      });
      const accepted = await delivery('accept_delivery', {
        proposal_id: proposal.proposal_id, content_digest: proposal.content_digest,
        confirmation_id: confirmation.confirmation_id, basis,
      });
      expect((await x.db.pool.query('SELECT state, accepted_delivery_operation_id FROM tasks WHERE id=$1', [x.f.task])).rows[0])
        .toEqual({ state: 'COMPLETED', accepted_delivery_operation_id: accepted.operation_id });
      await x.send('new request');
      const t = await x.turn();
      expect(t.dispatch.task_conversation_source!.reply_only).toBe(true);
      expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([]);
      await expect(
        x.reply(t, {
          kind: 'guidance',
          text: 'change',
          basis: await x.basis(),
        }),
      ).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
      await x.reply(t);
    });
    it('rolls back canonical reply, source resolution, guidance and Stop when admission commit fails', async () => {
      await x.send('change');
      const t = await x.turn();
      const service = new BoundaryService(x.db, {
        signingKey: 'rollback-conversation-signing-key',
        beforeAdmissionCommit: () => {
          throw new Error('rollback');
        },
      });
      const incarnation = await service.connect(x.f.runner, 'conversation-test');
      await service.touch(x.f.runner, incarnation, true);
      const grant = (await service.authorize(x.f.runner, incarnation, t.dispatch.dispatch_id))!;
      await expect(
        service.admit(
          grant.credential,
          submission({
            schema_version: 1,
            request_id: randomUUID(),
            scope_id: x.f.task,
            expected_control_version: t.dispatch.control_version,
            name: 'commit_task_turn',
            payload: {
              source_id: t.dispatch.task_conversation_source!.source_id,
              input_id: t.dispatch.task_conversation_source!.input_id,
              source_watermark: t.dispatch.source_watermark,
              reply: 'saved',
              routing: {
                kind: 'guidance',
                text: 'change',
                basis: await x.basis(),
              },
            },
          }),
        ),
      ).rejects.toThrow('rollback');
      expect((await x.db.pool.query('SELECT count(*) FROM task_guidance')).rows[0].count).toBe('0');
      expect((await x.db.pool.query('SELECT count(*) FROM task_input_resolutions')).rows[0].count).toBe('0');
      expect((await x.db.pool.query("SELECT count(*) FROM operations WHERE kind='stop'")).rows[0].count).toBe(
        '0',
      );
    });
    it('withdraws assigned guidance through physical Stop and retains guidanceless continuation', async () => {
      await x.send('Initial instruction');
      const t = await x.turn(),
        r = await x.reply(t, {
          kind: 'guidance',
          text: 'Initial instruction',
          basis: await x.basis(),
        });
      await x.finish(r.operation_id!, t.dispatch.attempt_id);
      await x.start();
      const n = await x.node();
      await x.conversation.command(x.token, {
        schema_version: 1,
        request_id: randomUUID(),
        task_id: x.f.task,
        name: 'withdraw_task_input',
        expected_version: 1,
        payload: { operation_id: r.result!.obligation_id },
      });
      await x.execution.pump();
      expect((await x.db.pool.query('SELECT state FROM nodes WHERE id=$1', [x.f.node])).rows[0].state).toBe(
        'RUNNING',
      );
      const stop = (
        await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [
          n.dispatch.attempt_id,
        ])
      ).rows[0];
      await x.finish(stop.id, n.dispatch.attempt_id);
      await x.conversation.pump();
      const next = await x.node();
      const context = JSON.parse(next.dispatch.prompt);
      expect(context.guidance.required_guidance_ids).toEqual([]);
      expect(next.dispatch.node_activation).toBe(1);
      expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([]);
    });
    it('Owner Stop pauses post-completion guidance until explicit Continue creates a new activation', async () => {
      await x.start();
      const n = await x.node(),
        c = await x.agent(n, 'complete_node', { summary: 'original' });
      await x.send('refine');
      const t = await x.turn(),
        r = await x.reply(t, {
          kind: 'guidance',
          text: 'refine current work',
          basis: await x.basis(),
        });
      await x.finish(r.operation_id!, t.dispatch.attempt_id);
      await x.owner('stop_node', {
        node_id: x.f.node,
        node_activation: 1,
        source_id: n.dispatch.node_execution_source!.source_id,
      });
      await x.finish(c.operation_id!, n.dispatch.attempt_id);
      await x.conversation.pump();
      expect(
        (await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [x.f.node])).rows[0].activation,
      ).toBe('1');
      await x.owner('continue_node', {
        node_id: x.f.node,
        node_activation: 1,
        source_id: n.dispatch.node_execution_source!.source_id,
      });
      await x.conversation.pump();
      const next = await x.node();
      expect(next.dispatch.node_activation).toBe(2);
      const done = await x.agent(next, 'complete_node', {
        summary: 'refined',
        handled_guidance_ids: [r.result!.obligation_id!],
      });
      await x.finish(done.operation_id!, next.dispatch.attempt_id);
      expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([]);
    });
    it('an ordinary completed Stop does not authorize a guidance-free reactivation', async () => {
      await x.start();
      const n = await x.node(),
        c = await x.agent(n, 'complete_node', { summary: 'original' });
      await x.owner('stop_node', {
        node_id: x.f.node,
        node_activation: 1,
        source_id: n.dispatch.node_execution_source!.source_id,
      });
      await x.finish(c.operation_id!, n.dispatch.attempt_id);
      await expect(
        x.owner('continue_node', {
          node_id: x.f.node,
          node_activation: 1,
          source_id: n.dispatch.node_execution_source!.source_id,
        }),
      ).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      expect((await x.db.pool.query('SELECT count(*) FROM node_activations')).rows[0].count).toBe('1');
    });
    it('proposal confirmation alone neither attributes later messages nor prevents local Cancel', async () => {
      await x.start();
      const proposal = randomUUID();
      await x.db.pool.query(
        "INSERT INTO task_command_proposals(id,task_id,action,content,content_digest,basis,expires_at) VALUES($1,$2,'accept_delivery','{}',$3,'{}',clock_timestamp()+interval '1 hour')",
        [proposal, x.f.task, 'a'.repeat(64)],
      );
      await x.db.pool.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)', [
        randomUUID(),
        proposal,
      ]);
      await x.send('unaccepted input');
      const t = await x.turn();
      expect(t.dispatch.task_conversation_source!.reply_only).toBe(false);
      await x.owner('cancel_task', {
        specification_id: x.f.spec,
        plan_id: x.f.plan,
      });
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe(
        'CANCELLED',
      );
    });
    it('bounds direct Owner history queries and exposes numeric recoverable operation pages', async () => {
      const input = await x.send('pending');
      await expect(x.conversation.messages(x.token, x.f.task, undefined, 'x'.repeat(257))).rejects.toThrow();
      const status = await x.conversation.status(x.token, x.f.task);
      expect(status.inputs[0]?.version).toBe(1);
      const page = await x.conversation.operations(x.token, x.f.task);
      expect(page.items[0]).toMatchObject({
        id: input.input_id,
        version: 1,
        content: 'pending',
        available_actions: ['retry_task_input', 'withdraw_task_input'],
      });
      expect(page.has_more).toBe(false);
    });
    it('keeps the ordered head recoverable when input summaries overflow and pages retain every target', async () => {
      const inputs: string[] = [];
      for (let i = 0; i < 65; i++) inputs.push((await x.send(`pending ${i}`)).input_id!);
      await x.service.touch(x.f.runner,x.f.incarnation,true);
      const turn = await x.turn();
      const status = await x.conversation.status(x.token, x.f.task);
      expect(status.inputs).toHaveLength(64);
      expect(status.inputs_has_more).toBe(true);
      expect(status.inputs[0]).toMatchObject({
        id: inputs[0],
        available_actions: ['stop_task_turn', 'withdraw_task_input'],
      });
      expect(status.available_actions).toEqual(['stop_task_turn', 'withdraw_task_input']);
      expect(turn.dispatch.task_conversation_source!.input_id).toBe(inputs[0]);
      const first = await x.conversation.operations(x.token, x.f.task);
      expect(first.has_more).toBe(true);
      const second = await x.conversation.operations(x.token, x.f.task, first.cursor);
      expect(second.has_more).toBe(false);
      expect([...first.items, ...second.items].map((item) => item.id).sort()).toEqual(inputs.sort());
    }, 30000);
  },
);
