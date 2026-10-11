import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { Dispatch, RuntimeEvent } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { Discussion } from '../src/discussion.ts';
import { Todos } from '../src/todos.ts';
import { TaskSpecification } from '../src/task-specification.ts';
import { specificationImpact } from '../src/task-specification-state.ts';
import { RuntimeContinuation } from '../src/runtime-continuation.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { replanFixture } from './fixtures/task-replan-fixture.ts';
import { reviewCorrectionFixture } from './fixtures/review-correction-fixture.ts';

type Fixture = Awaited<ReturnType<typeof conversationFixture>>;

async function policy(x: Fixture) {
  await x.service.touch(x.f.runner, x.f.incarnation, true, [
    { runtime_id: 'opencode', executable: '/opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] },
    { runtime_id: 'codex', executable: '/codex', availability: 'detected', supports_model: true, supports_thinking: true, model_ids: [] },
  ]);
  await x.db.pool.query('UPDATE execution_policies SET policies=$1', [{ global: {
    default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free', runner_id: x.f.runner },
    fallback_targets: [{ runtime_id: 'codex', model_id: 'gpt-5.4', runner_id: x.f.runner }],
  } }]);
}

async function failure(x: Fixture, d: Dispatch, typed = true) {
  const event: RuntimeEvent = { attempt_id: d.attempt_id, dispatch_id: d.dispatch_id, stream_id: 'runtime', sequence: 1,
    order_sequence: 1, kind: 'exited', text: '', exit_code: 1, ...(typed ? { runtime_failure: 'native_terminal_error' as const } : {}) };
  await x.service.event(x.f.runner, x.f.incarnation, event);
  await x.service.event(x.f.runner, x.f.incarnation, event);
}

async function settle(x: Fixture, d: Dispatch) {
  const stop = (await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [d.attempt_id])).rows[0];
  expect(stop).toBeDefined();
  await x.finish(stop.id, d.attempt_id);
}

async function removeSuffix(x: Fixture) {
  await x.service.touch(x.f.runner, x.f.incarnation, true, [{ runtime_id: 'opencode', executable: '/opencode', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
}

async function refreshProject(x: Fixture, context: string) {
  const configuration = new Configuration(x.db);
  await configuration.save(x.token, { schema_version: 1, request_id: randomUUID(),
    expected_control_version: (await configuration.read(x.token)).control_version, name: 'save_project',
    payload: { id: x.f.project, name: 'Project', context, archived: false, resources: [], role_ids: [x.f.role] } });
}

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Planner Runtime continuation', () => {
  it('rebuilds initial planning after Stop with genuine Runtime provenance and the frozen policy', async () => {
    const x = await conversationFixture();
    try {
      await policy(x);
      await x.owner('start_task', { specification_id: x.f.spec });
      await x.planning.pump();
      const first = await x.promote(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch);
      await worker.pump();
      expect((await x.db.pool.query('SELECT successor_planned_attempt_id FROM runtime_continuations WHERE predecessor_attempt_id=$1', [first.dispatch.attempt_id])).rows[0]).toEqual({ successor_planned_attempt_id: null });
      expect((await x.planning.status(x.token, x.f.task)).available_actions).not.toContain('retry_initial_planning');
      await refreshProject(x, 'Fresh planning project context');
      await x.db.pool.query('UPDATE execution_policies SET policies=$1', [{}]);
      await settle(x, first.dispatch);
      await worker.pump();
      await x.planning.pump();
      const next = await x.promote();
      expect(next.dispatch).toMatchObject({ runtime_id: 'codex', model: 'gpt-5.4', task_id: x.f.task, runner_id: x.f.runner });
      expect(next.dispatch.prompt).toContain('Fresh planning project context');
      expect(next.dispatch.task_planning_source!.intent_id).not.toBe(first.dispatch.task_planning_source!.intent_id);
      const source = (await x.db.pool.query('SELECT owner_request_id,requirement_change_id,runtime_predecessor_attempt_id,previous_intent_id FROM task_planning_outbox WHERE id=$1', [next.dispatch.task_planning_source!.intent_id])).rows[0];
      expect(source).toEqual({ owner_request_id: null, requirement_change_id: null, runtime_predecessor_attempt_id: first.dispatch.attempt_id, previous_intent_id: first.dispatch.task_planning_source!.intent_id });
      const result = await x.agent(next, 'publish_execution_plan', { planning_intent_id: next.dispatch.task_planning_source!.intent_id,
        plan_id: x.f.plan, nodes: [{ node_id: x.f.node, role_id: x.f.role, goal: 'Build exact result', dependencies: [] }] });
      await failure(x, next.dispatch);
      await x.finish(result.operation_id!, next.dispatch.attempt_id);
      await worker.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM runtime_continuations')).rows[0]!.count).toBe('1');
      expect((await x.planning.status(x.token, x.f.task)).status).toBe('published');
    } finally { await x.close(); }
  }, 20000);

  it('keeps an ordinary missing outcome on explicit recovery and lets Owner Stop cancel automatic planning', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump();
      const first = await x.promote(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch, false); await settle(x, first.dispatch); await worker.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM runtime_continuations')).rows[0]!.count).toBe('0');
      await x.owner('retry_initial_planning', { planning_intent_id: first.dispatch.task_planning_source!.intent_id });
      await x.planning.pump(); const second = await x.promote(); await failure(x, second.dispatch);
      await x.owner('stop_initial_planning', { planning_intent_id: second.dispatch.task_planning_source!.intent_id });
      await settle(x, second.dispatch); await worker.pump(); await x.planning.pump();
      expect((await x.planning.status(x.token, x.f.task)).state).toBe('PLANNING');
      expect((await x.db.pool.query('SELECT state FROM runtime_continuations WHERE predecessor_attempt_id=$1', [second.dispatch.attempt_id])).rows[0]!.state).toBe('superseded');
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    } finally { await x.close(); }
  }, 20000);

  it('leaves initial planning explicitly retryable after the remaining Runtime target is unavailable', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump();
      const first = await x.promote(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await removeSuffix(x); await worker.pump(); await x.planning.pump(); await worker.pump();
      const status = await x.planning.status(x.token, x.f.task);
      expect(status.available_actions).toContain('retry_initial_planning'); expect(status.state).toBe('RUNNING');
      expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE task_id=$1', [x.f.task])).rows[0]!.count).toBe('1');
      await x.owner('retry_initial_planning', { planning_intent_id: status.planning_source!.intent_id }); await x.planning.pump();
      expect((await x.promote()).dispatch.runtime_id).toBe('opencode');
    } finally { await x.close(); }
  }, 20000);

  it('continues the same Todo message with fresh context, preserving later input order and one reply', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const todo = randomUUID(), discussion = new Discussion(x.db, x.service.instanceId), worker = new RuntimeContinuation(x.db);
      await new Todos(x.db).command(x.token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: todo, original_capture: 'A durable idea', project_id: x.f.project } });
      const message = randomUUID();
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message', payload: { message_id: message, content: 'First exact input' } });
      await discussion.pump(); const first = await x.promote();
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message', payload: { message_id: randomUUID(), content: 'Later input must wait' } });
      await failure(x, first.dispatch); await refreshProject(x, 'Fresh Discussion context'); await settle(x, first.dispatch); await worker.pump();
      await discussion.pump(); const next = await x.promote();
      expect(next.dispatch).toMatchObject({ runtime_id: 'codex', todo_id: todo, source_message_id: message, source_watermark: 1 });
      expect(next.dispatch.prompt).toContain('Fresh Discussion context'); expect(next.dispatch.prompt).not.toContain('Later input must wait');
      const result = await x.service.admit(next.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: todo,
        expected_control_version: next.dispatch.control_version, name: 'commit_discussion_turn', payload: { source_message_id: message, source_watermark: 1, reply: 'One formal reply', working_requirement_state: 'Durable understanding' } }));
      await x.finish(result.operation_id!, next.dispatch.attempt_id);
      expect((await discussion.messages(x.token, todo)).messages.filter(row => row.author === 'assistant').map(row => row.content)).toEqual(['One formal reply']);
    } finally { await x.close(); }
  }, 20000);

  it('makes a Todo suffix exhausted before launch explicitly retryable without inventing an Attempt', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const todo = randomUUID(), message = randomUUID(), discussion = new Discussion(x.db, x.service.instanceId), worker = new RuntimeContinuation(x.db);
      await new Todos(x.db).command(x.token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: todo, original_capture: 'Idea' } });
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message', payload: { message_id: message, content: 'Discuss' } });
      await discussion.pump(); const first = await x.promote(); await failure(x, first.dispatch); await settle(x, first.dispatch);
      await removeSuffix(x);
      await worker.pump(); await discussion.pump(); await worker.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE todo_id=$1', [todo])).rows[0]!.count).toBe('1');
      const status = await discussion.status(x.token, todo); expect(status.current_source!.status).toBe('interrupted');
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'retry_discussion_turn', expected_discussion_version: status.discussion_version, payload: { source_message_id: message } });
      await discussion.pump(); expect((await x.promote()).dispatch.runtime_id).toBe('opencode');
    } finally { await x.close(); }
  }, 20000);

  it('lets Owner Stop a prepared Todo successor through the retained real predecessor', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const todo = randomUUID(), message = randomUUID(), discussion = new Discussion(x.db, x.service.instanceId), worker = new RuntimeContinuation(x.db);
      await new Todos(x.db).command(x.token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: todo, original_capture: 'Idea' } });
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message', payload: { message_id: message, content: 'Discuss' } });
      await discussion.pump(); const first = await x.promote(); await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump();
      const status = await discussion.status(x.token, todo);
      expect(status.current_source).toMatchObject({ status: 'settling', attempt_id: first.dispatch.attempt_id });
      await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'stop_discussion_turn', expected_discussion_version: status.discussion_version,
        payload: { source_message_id: message, attempt_id: status.current_source!.attempt_id! } });
      await worker.pump(); await discussion.pump();
      expect((await x.db.pool.query('SELECT state FROM runtime_continuations')).rows[0]!.state).toBe('superseded');
      expect((await discussion.status(x.token, todo)).current_source!.status).toBe('interrupted');
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    } finally { await x.close(); }
  }, 20000);

  it('preserves the same Conversation input, exposes Stop while settling and commits once after fresh context', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const sent = await x.send('Current input'), first = await x.turn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await worker.pump();
      const status = await x.conversation.status(x.token, x.f.task);
      expect(status.available_actions).toContain('stop_task_turn'); expect(status.available_actions).not.toContain('retry_task_input');
      await refreshProject(x, 'Fresh Conversation context'); await settle(x, first.dispatch); await worker.pump();
      const next = await x.turn();
      expect(next.dispatch.task_conversation_source).toMatchObject({ input_id: sent.input_id, source_watermark: 1 });
      expect(next.dispatch.runtime_id).toBe('codex'); expect(next.dispatch.prompt).toContain('Fresh Conversation context');
      const reply = await x.reply(next); await x.finish(reply.operation_id!, next.dispatch.attempt_id); await failure(x, next.dispatch); await worker.pump();
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0]!.state).toBe('PLANNING');
      expect((await x.db.pool.query("SELECT count(*) FROM task_messages WHERE author='assistant' AND input_id=$1", [sent.input_id])).rows[0]!.count).toBe('1');
      expect((await x.db.pool.query('SELECT count(*) FROM runtime_continuations')).rows[0]!.count).toBe('1');
    } finally { await x.close(); }
  }, 20000);

  it('withdraws a prepared Conversation successor before any new Attempt exists', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const sent = await x.send('May be withdrawn'), first = await x.turn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump();
      const input = (await x.db.pool.query('SELECT version FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0]!;
      await x.conversation.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'withdraw_task_input', expected_version: Number(input.version), payload: { operation_id: sent.input_id } });
      await worker.pump(); await x.conversation.pump();
      expect((await x.db.pool.query('SELECT state FROM runtime_continuations')).rows[0]!.state).toBe('superseded');
      expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    } finally { await x.close(); }
  }, 20000);

  it('keeps an exhausted Conversation input unresolved and allows one explicit Retry', async () => {
    const x = await conversationFixture();
    try {
      await policy(x); const sent = await x.send('Still needs an answer'), first = await x.turn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await removeSuffix(x); await worker.pump(); await x.conversation.pump(); await worker.pump();
      const input = (await x.db.pool.query('SELECT status,version FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0]!;
      expect(input.status).toBe('failed'); expect((await x.conversation.status(x.token, x.f.task)).available_actions).toContain('retry_task_input');
      await x.conversation.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'retry_task_input', expected_version: Number(input.version), payload: { operation_id: sent.input_id } });
      const next = await x.turn(); expect(next.dispatch).toMatchObject({ runtime_id: 'opencode', task_conversation_source: { input_id: sent.input_id } });
    } finally { await x.close(); }
  }, 20000);

  it('continues an existing reply-only input after Task Cancel without reopening execution', async () => {
    const x = await conversationFixture();
    try {
      await x.owner('cancel_task', { specification_id: x.f.spec });
      await policy(x); const sent = await x.send('Explain the cancelled task'), first = await x.turn(), worker = new RuntimeContinuation(x.db);
      expect(first.dispatch.task_conversation_source!.reply_only).toBe(true);
      const before = (await x.db.pool.query('SELECT state,control_version,specification_id,plan_id FROM tasks WHERE id=$1', [x.f.task])).rows[0];
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump(); const next = await x.turn();
      expect(next.dispatch).toMatchObject({ runtime_id: 'codex', task_conversation_source: { input_id: sent.input_id, reply_only: true } });
      const reply = await x.reply(next); await x.finish(reply.operation_id!, next.dispatch.attempt_id);
      expect((await x.db.pool.query('SELECT state,control_version,specification_id,plan_id FROM tasks WHERE id=$1', [x.f.task])).rows[0]).toEqual(before);
    } finally { await x.close(); }
  }, 20000);

  it('never replays an admitted Specification apply even though its input still awaits a reply', async () => {
    const x = await conversationFixture();
    try {
      const specification = new TaskSpecification(x.db), proposalId = randomUUID();
      const command = (name: string, payload: object) => specification.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload });
      const proposalInput = await x.send('Revise exact requirement'), original = await x.turn(), basis = await x.basis();
      const impact = await transaction(x.db, async tx => specificationImpact(tx, (await tx.query('SELECT * FROM tasks WHERE id=$1', [x.f.task])).rows[0]));
      const prepared = await x.agent(original, 'prepare_specification_revision', { proposal_id: proposalId, specification: 'Exact revised requirement', summary: 'Exact revision', impact, basis, source_input_ids: [proposalInput.input_id!] });
      const reply = await x.reply(original, { kind: 'specification_proposal', proposal_id: proposalId, basis }); await x.finish(reply.operation_id!, original.dispatch.attempt_id);
      const confirmed = await command('confirm_specification', { proposal_id: proposalId, content_digest: prepared.result!.content_digest });
      await policy(x); const sent = await x.send('Apply the confirmed requirement'), first = await x.turn(), worker = new RuntimeContinuation(x.db);
      await command('defer_specification_inputs', { proposal_id: proposalId, inputs: [{ input_id: sent.input_id, version: 1 }] });
      await x.agent(first, 'apply_specification_revision', { proposal_id: proposalId, confirmation_id: confirmed.confirmation_id!, basis: await x.basis() });
      expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [first.dispatch.attempt_id])).rows[0]!.mutation_allowed).toBe(true);
      expect((await x.db.pool.query('SELECT status FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0]!.status).toBe('pending');
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM runtime_continuations')).rows[0]!.count).toBe('0');
      expect((await x.db.pool.query('SELECT count(*) FROM requirement_changes')).rows[0]!.count).toBe('1');
      expect((await x.db.pool.query('SELECT status FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0]!.status).toBe('failed');
    } finally { await x.close(); }
  }, 20000);

  it('continues one unresolved Replan request and lets dismissal revoke the fresh source', async () => {
    const x = await replanFixture();
    try {
      await policy(x); const request = await x.request(); await x.replan.pump(); const first = await x.promote(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump(); await x.replan.pump(); const next = await x.promote();
      expect(next.dispatch).toMatchObject({ runtime_id: 'codex', task_replan_source: { request_id: request, specification_id: x.f.spec, plan_id: x.f.plan } });
      expect(next.dispatch.task_replan_source!.source_id).not.toBe(first.dispatch.task_replan_source!.source_id);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_requests')).rows[0]!.count).toBe('1');
      expect((await x.db.pool.query('SELECT count(*) FROM replan_decisions')).rows[0]!.count).toBe('0');
      await failure(x, next.dispatch);
      const current = (await x.db.pool.query('SELECT version FROM replan_requests WHERE id=$1', [request])).rows[0]!;
      await x.command('dismiss_replan', { replan_request_id: request, expected_version: Number(current.version) });
      await settle(x, next.dispatch); await worker.pump(); await x.replan.pump();
      expect((await x.db.pool.query('SELECT status FROM replan_requests WHERE id=$1', [request])).rows[0]!.status).toBe('dismissed');
    } finally { await x.close(); }
  }, 20000);

  it('leaves an exhausted Replan request pending for a genuine Owner Retry', async () => {
    const x = await replanFixture();
    try {
      await policy(x); const request = await x.request(); await x.replan.pump(); const first = await x.promote(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await removeSuffix(x); await worker.pump(); await x.replan.pump(); await worker.pump();
      const current = (await x.db.pool.query('SELECT status,version FROM replan_requests WHERE id=$1', [request])).rows[0]!;
      expect(current.status).toBe('pending');
      await x.command('retry_replan', { replan_request_id: request, expected_version: Number(current.version) }); await x.replan.pump();
      expect((await x.promote()).dispatch).toMatchObject({ runtime_id: 'opencode', task_replan_source: { request_id: request } });
    } finally { await x.close(); }
  }, 20000);

  it('retains Review feedback and operation while refreshing the source without a fake Owner decision', async () => {
    const x = await reviewCorrectionFixture();
    try {
      await policy(x); const feedback = await x.requestChanges(), first = await x.reviewTurn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await worker.pump();
      expect((await x.reviewReads.operation(x.token, x.f.task, feedback.operation_id!)).operation.retry_allowed).toBe(false);
      await settle(x, first.dispatch); await worker.pump(); await x.reviewCoordinator.pump(); const next = await x.promote();
      expect(next.dispatch).toMatchObject({ runtime_id: 'codex', task_review_source: { operation_id: feedback.operation_id, feedback_id: feedback.feedback_id, purpose: 'route_feedback' } });
      expect(next.dispatch.task_review_source!.operation_version).toBe(first.dispatch.task_review_source!.operation_version + 1);
      expect((await x.db.pool.query('SELECT count(*) FROM task_review_decisions')).rows[0]!.count).toBe('1');
      const result = await x.agent(next, 'apply_review_rework', { ...x.reviewBinding(next), basis: x.reviewActionBasis(next), node_ids: [x.f.node], reason: 'The existing graph suffices' });
      await failure(x, next.dispatch); await x.finish(result.operation_id!, next.dispatch.attempt_id); await worker.pump();
      expect((await x.db.pool.query('SELECT count(*) FROM runtime_continuations')).rows[0]!.count).toBe('1');
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0]!.state).toBe('RUNNING');
    } finally { await x.close(); }
  }, 20000);

  it('continues Review reconsideration without resetting its original reply or input attribution', async () => {
    const x = await reviewCorrectionFixture('modified');
    try {
      const prepared = await x.prepareDelivery(), confirmed = await x.confirmDelivery(prepared); await x.acceptDelivery(prepared, confirmed);
      const sent = await x.send('Already replied late input'), original = await x.turn(), replied = await x.reply(original); await x.finish(replied.operation_id!, original.dispatch.attempt_id);
      await policy(x); await x.requestChanges(); const first = await x.reviewTurn(), worker = new RuntimeContinuation(x.db);
      expect(first.dispatch.task_review_source!.purpose).toBe('reconsider_input');
      const originalInput = (await x.db.pool.query('SELECT * FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0];
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump(); await x.reviewCoordinator.pump(); const next = await x.promote();
      expect(next.dispatch.task_review_source).toMatchObject({ purpose: 'reconsider_input', input_id: sent.input_id,
        reconsideration_id: first.dispatch.task_review_source!.reconsideration_id, operation_id: first.dispatch.task_review_source!.operation_id });
      const result = await x.agent(next, 'resolve_review_input', { ...x.reviewBinding(next), basis: x.reviewActionBasis(next),
        reconsideration_id: next.dispatch.task_review_source!.reconsideration_id!, summary: 'No additional work', routing: { kind: 'reply' } });
      await x.finish(result.operation_id!, next.dispatch.attempt_id);
      expect((await x.db.pool.query('SELECT * FROM task_inputs WHERE id=$1', [sent.input_id])).rows[0]).toEqual(originalInput);
      expect((await x.db.pool.query("SELECT id FROM task_messages WHERE author='assistant' AND input_id=$1", [sent.input_id])).rows).toEqual([{ id: replied.result!.message_id }]);
    } finally { await x.close(); }
  }, 20000);

  it('leaves exhausted Review feedback failed and permits an actual Owner Retry on the same operation', async () => {
    const x = await reviewCorrectionFixture();
    try {
      await policy(x); const feedback = await x.requestChanges(), first = await x.reviewTurn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await removeSuffix(x); await worker.pump(); await x.reviewCoordinator.pump(); await worker.pump();
      const current = (await x.reviewReads.operation(x.token, x.f.task, feedback.operation_id!)).operation;
      expect(current).toMatchObject({ status: 'failed', retry_allowed: true });
      await x.reviewCommands.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name: 'retry_review_feedback', payload: { feedback_id: feedback.feedback_id, operation_id: current.operation_id, expected_version: current.operation_version } });
      const next = await x.reviewTurn(); expect(next.dispatch).toMatchObject({ runtime_id: 'opencode', task_review_source: { operation_id: feedback.operation_id, feedback_id: feedback.feedback_id } });
    } finally { await x.close(); }
  }, 20000);

  it.each(['settling', 'settled', 'prepared'] as const)('capture failure during %s handoff cancels automatic Review continuation and retains explicit recovery', async phase => {
    const x = await reviewCorrectionFixture();
    try {
      await policy(x); const feedback = await x.requestChanges(), first = await x.reviewTurn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch);
      if (phase !== 'settling') await settle(x, first.dispatch);
      if (phase === 'prepared') await worker.pump();
      await x.service.event(x.f.runner, x.f.incarnation, { attempt_id: first.dispatch.attempt_id, dispatch_id: first.dispatch.dispatch_id,
        stream_id: 'runtime', sequence: 2, order_sequence: 2, kind: 'capture_failed', text: '' });
      if (phase === 'settling') await settle(x, first.dispatch);
      await worker.pump(); await x.reviewCoordinator.pump();
      expect((await x.db.pool.query('SELECT state,reason FROM runtime_continuations')).rows).toEqual([{ state: 'exhausted', reason: 'capture_failed' }]);
      const current = (await x.reviewReads.operation(x.token, x.f.task, feedback.operation_id!)).operation;
      expect(current).toMatchObject({ status: 'failed', retry_allowed: true });
      expect((await x.db.pool.query('SELECT count(*) FROM attempts WHERE runtime_predecessor_id IS NOT NULL')).rows[0]!.count).toBe('0');
      await x.reviewCommand('retry_review_feedback', { feedback_id: feedback.feedback_id, operation_id: current.operation_id, expected_version: current.operation_version });
      expect((await x.reviewTurn()).dispatch).toMatchObject({ runtime_id: 'opencode', task_review_source: { operation_id: feedback.operation_id } });
    } finally { await x.close(); }
  }, 20000);

  it('waits for Review Task ownership before locking continuation on an unavailable suffix', async () => {
    const x = await reviewCorrectionFixture();
    const owner = await x.db.pool.connect(), schedulerClient = await x.db.pool.connect();
    let scheduled: Promise<unknown> | undefined;
    try {
      await policy(x); await x.requestChanges(); const first = await x.reviewTurn(), worker = new RuntimeContinuation(x.db);
      await failure(x, first.dispatch); await settle(x, first.dispatch); await worker.pump(); await removeSuffix(x);
      const source = (await x.db.pool.query('SELECT s.* FROM task_review_sources s JOIN task_review_operations o ON o.source_id=s.id WHERE o.task_id=$1', [x.f.task])).rows[0]!;
      await owner.query('BEGIN'); await owner.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
      const ownerPid = (await owner.query('SELECT pg_backend_pid() id')).rows[0].id;
      const schedulerPid = (await schedulerClient.query('SELECT pg_backend_pid() id')).rows[0].id;
      scheduled = (async () => {
        await schedulerClient.query('BEGIN');
        try {
          const result = await new RuntimeScheduling(x.queue, x.service.instanceId).selectAndEnqueue(schedulerClient, {
            attempt_id: source.planned_attempt_id, task_id: x.f.task, kind: 'planner', expected: {
              control_version: source.source.control_version, specification_id: source.source.specification_id, plan_id: source.source.plan_id,
            }, prompt: source.prompt, source_watermark: 0, task_review_source: source.source,
          });
          await schedulerClient.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
          await schedulerClient.query('COMMIT'); return result;
        } catch (error) { await schedulerClient.query('ROLLBACK'); throw error; }
      })();
      void scheduled.catch(() => {});
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const blockers = (await x.db.pool.query('SELECT pg_blocking_pids($1) ids', [schedulerPid])).rows[0].ids as number[];
        blocked = blockers.includes(ownerPid); if (!blocked) await delay(20);
      }
      expect(blocked).toBe(true);
      // Owner withdrawal holds Task before continuation. The scheduler must not
      // hold the latter while waiting for the former, even when no target queues.
      await expect(owner.query('SELECT predecessor_attempt_id FROM runtime_continuations WHERE predecessor_attempt_id=$1 FOR UPDATE NOWAIT', [first.dispatch.attempt_id])).resolves.toMatchObject({ rowCount: 1 });
      await owner.query('COMMIT'); await expect(scheduled).resolves.toMatchObject({ status: 'unavailable', reason: 'installation_unavailable' });
    } finally {
      await owner.query('ROLLBACK'); await scheduled?.catch(() => {}); owner.release(); schedulerClient.release(); await x.close();
    }
  }, 20000);
});
