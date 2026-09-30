import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { MAX_ITEM_BYTES } from '../../../packages/protocol/src/index.ts';
import type { TaskTurnRouting } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { Discussion } from '../src/discussion.ts';
import { initializeTask } from '../src/task-records.ts';
import { Todos } from '../src/todos.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

const fault = (code: string) => ({ detail: { code } });

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Task conversation lifecycle boundaries', { timeout: 20000 }, () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  beforeEach(async () => { x = await conversationFixture(); }, 20000);
  afterEach(async () => { await x?.close(); }, 20000);

  async function inputAction(name: 'retry_task_input' | 'withdraw_task_input', id: string, version = 1) {
    return x.conversation.command(x.token, {
      schema_version: 1, request_id: randomUUID(), task_id: x.f.task,
      name, expected_version: version, payload: { operation_id: id },
    });
  }

  async function resolved(content: string, routing: TaskTurnRouting) {
    const input = await x.send(content), turn = await x.turn(), response = await x.reply(turn, routing);
    // Trusted database settlement fixture; this does not establish native process absence.
    await x.finish(response.operation_id!, turn.dispatch.attempt_id);
    return { input, turn, response };
  }

  async function executionFacts() {
    return (await x.db.pool.query(`SELECT state, control_version, specification_id, plan_id,
      initial_planning_intent_id, planning_issue_sequence FROM tasks WHERE id=$1`, [x.f.task])).rows[0];
  }

  async function nodeFacts() {
    return (await x.db.pool.query(`SELECT state, activation, execution_source_id, blocker_id,
      guidance_paused FROM nodes WHERE id=$1`, [x.f.node])).rows[0];
  }

  it('pre-Start reply and durable guidance leave initial planning entirely unstarted', async () => {
    const before = await executionFacts();
    await resolved('What would this Task do?', { kind: 'reply' });
    const instruction = await resolved('Keep output concise', {
      kind: 'guidance', text: 'Keep output concise', basis: await x.basis(),
    });
    await x.planning.pump();
    await x.execution.pump();
    await x.conversation.pump();
    expect(await executionFacts()).toEqual(before);
    expect(before).toMatchObject({ state: 'PLANNING', plan_id: null, initial_planning_intent_id: null });
    expect((await x.planning.status(x.token, x.f.task)).status).toBe('not_started');
    expect((await x.db.pool.query('SELECT 1 FROM nodes')).rowCount).toBe(0);
    expect((await x.db.pool.query('SELECT 1 FROM task_planning_outbox')).rowCount).toBe(0);
    expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([
      instruction.response.result!.obligation_id!,
    ]);
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
  });

  it('Owner-stopped Node retains its blocker and source through reply and guidance', async () => {
    await x.start();
    const node = await x.node();
    const stopped = await x.owner('stop_node', {
      node_id: x.f.node, node_activation: 1, source_id: node.dispatch.node_execution_source!.source_id,
    });
    await x.finish(stopped.operation_id!, node.dispatch.attempt_id);
    const taskBefore = await executionFacts(), nodeBefore = await nodeFacts();
    expect(nodeBefore).toMatchObject({ state: 'BLOCKED', guidance_paused: true });
    await resolved('What is stopped?', { kind: 'reply' });
    const guidance = await resolved('Use readable labels when continued', {
      kind: 'guidance', text: 'Use readable labels when continued', basis: await x.basis(),
    });
    await x.conversation.pump();
    await x.execution.pump();
    expect(await executionFacts()).toEqual(taskBefore);
    expect(await nodeFacts()).toEqual(nodeBefore);
    expect((await x.execution.status(x.token, x.f.task, x.f.node)).blocker).toMatchObject({ kind: 'owner_stopped' });
    expect((await x.db.pool.query('SELECT 1 FROM node_execution_outbox')).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT status FROM task_guidance_obligations WHERE guidance_id=$1', [guidance.response.result!.obligation_id])).rows).toEqual([{ status: 'pending' }]);
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
  });

  it('actual Task Cancel makes subsequent chat reply-only without reopening execution', async () => {
    await x.start();
    const node = await x.node();
    const cancelled = await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    await x.finish(cancelled.operation_id!, node.dispatch.attempt_id);
    const taskBefore = await executionFacts(), nodeBefore = await nodeFacts();
    expect(taskBefore.state).toBe('CANCELLED');
    await x.send('Please adjust the result');
    const turn = await x.turn();
    expect(turn.dispatch.task_conversation_source!.reply_only).toBe(true);
    await expect(x.reply(turn, { kind: 'guidance', text: 'Adjust result', basis: await x.basis() })).rejects.toMatchObject(fault('denied_scope'));
    expect((await x.db.pool.query('SELECT 1 FROM task_input_resolutions')).rowCount).toBe(0);
    const reply = await x.reply(turn);
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    await x.conversation.pump();
    await x.execution.pump();
    await x.planning.pump();
    expect(await executionFacts()).toEqual(taskBefore);
    expect(await nodeFacts()).toEqual(nodeBefore);
    expect((await x.db.pool.query('SELECT 1 FROM node_execution_outbox')).rowCount).toBe(1);
    expect((await x.db.pool.query('SELECT 1 FROM node_completions')).rowCount).toBe(0);
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
  });

  it('bounded history keeps exact cutoff, late-appended prior replies and withdrawal labels without leaking another scope', async () => {
    const otherTask = randomUUID(), todo = randomUUID();
    await transaction(x.db, tx => initializeTask(tx, {
      task_id: otherTask, specification_id: randomUUID(), project_id: x.f.project,
      specification: 'OTHER_TASK_SPEC_SENTINEL',
    }));
    const otherInput = await x.conversation.command(x.token, {
      schema_version: 1, request_id: randomUUID(), task_id: otherTask, name: 'submit_task_message',
      payload: { message_id: randomUUID(), content: 'OTHER_TASK_MESSAGE_SENTINEL' },
    });
    await x.conversation.command(x.token, {
      schema_version: 1, request_id: randomUUID(), task_id: otherTask, name: 'withdraw_task_input',
      expected_version: 1, payload: { operation_id: otherInput.input_id! },
    });
    await new Todos(x.db).command(x.token, {
      schema_version: 1, request_id: randomUUID(), name: 'capture_todo',
      payload: { todo_id: todo, original_capture: 'TODO_CAPTURE_SENTINEL' },
    });
    await new Discussion(x.db, x.service.instanceId).command(x.token, {
      schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message',
      payload: { message_id: randomUUID(), content: 'TODO_DISCUSSION_SENTINEL' },
    });
    const withdrawn: string[] = [];
    for (let i = 0; i < 65; i++) {
      const input = await x.send(`历史 😀 ${i}`);
      withdrawn.push(input.message_id!);
      await inputAction('withdraw_task_input', input.input_id!);
    }
    await x.send('Previous turn');
    // Building canonical history can outlast the Runner heartbeat window.
    await x.service.touch(x.f.runner, x.f.incarnation, true);
    const previous = await x.turn();
    const current = await x.send('EXACT_SOURCE 😀');
    const previousReply = await x.reply(previous);
    await x.finish(previousReply.operation_id!, previous.dispatch.attempt_id);
    const turn = await x.turn();
    expect(turn.dispatch.task_conversation_source!.input_id).toBe(current.input_id);
    await x.send('LATER_INPUT_SENTINEL');
    const first = (await x.agent(turn, 'read_task_history', {})).result!.task_history!;
    expect(first.messages).toHaveLength(64);
    expect(first.has_more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(MAX_ITEM_BYTES);
    const older = (await x.agent(turn, 'read_task_history', { cursor: first.cursor })).result!.task_history!;
    expect(older.has_more).toBe(false);
    const all = [...older.messages, ...first.messages];
    expect(all).toHaveLength(68);
    expect(new Set(all.map(m => m.message_id)).size).toBe(all.length);
    expect(all.map(m => m.sequence)).toEqual(all.map(m => m.sequence).sort((a, b) => a - b));
    expect(all.filter(m => withdrawn.includes(m.message_id))).toHaveLength(65);
    expect(all.filter(m => withdrawn.includes(m.message_id)).every(m => m.disposition === 'withdrawn')).toBe(true);
    const reply = all.find(m => m.author === 'assistant')!;
    expect(reply.content).toBe('Canonical response');
    expect(reply.sequence).toBeGreaterThan(turn.dispatch.source_watermark);
    expect(reply.source_watermark).toBeLessThan(turn.dispatch.source_watermark);
    const context = await x.agent(turn, 'read_task_context', {});
    const visible = JSON.stringify({ all, context, prompt: turn.dispatch.prompt });
    for (const sentinel of ['OTHER_TASK_SPEC_SENTINEL', 'OTHER_TASK_MESSAGE_SENTINEL', 'TODO_CAPTURE_SENTINEL', 'TODO_DISCUSSION_SENTINEL', 'LATER_INPUT_SENTINEL']) expect(visible).not.toContain(sentinel);
    expect(visible).toContain('EXACT_SOURCE 😀');
    const frozen = JSON.parse(turn.dispatch.prompt);
    expect(frozen.recent_history.length).toBeLessThanOrEqual(24);
    expect(Buffer.byteLength(JSON.stringify(frozen.recent_history))).toBeLessThanOrEqual(65536);
    const search = (await x.agent(turn, 'read_task_history', { query: '历史 😀 0' })).result!.task_history!;
    expect(search.messages.map(m => m.content)).toEqual(['历史 😀 0']);
    const later = (await x.agent(turn, 'read_task_history', { query: 'LATER_INPUT_SENTINEL' })).result!.task_history!;
    expect(later.messages).toEqual([]);
    await expect(x.agent(turn, 'read_task_history', { cursor: first.cursor, query: 'different' })).rejects.toMatchObject(fault('denied_scope'));
    const ownerPage = await x.conversation.messages(x.token, x.f.task);
    await expect(x.agent(turn, 'read_task_history', { cursor: ownerPage.cursor })).rejects.toMatchObject(fault('denied_scope'));
    await expect(x.conversation.messages(x.token, otherTask, first.cursor)).rejects.toMatchObject(fault('denied_scope'));
  }, 60000);

  it.each(['exited', 'process_absent', 'capture_failed'] as const)('%s keeps failed input retryable without changing execution control or releasing the old physical claim', async kind => {
    const input = await x.send('Keep this exact input'), turn = await x.turn();
    const taskBefore = await executionFacts(), source = turn.dispatch.task_conversation_source!;
    const later = await x.send('Later input must wait');
    await x.service.event(x.f.runner, x.f.incarnation, {
      attempt_id: turn.dispatch.attempt_id, dispatch_id: turn.dispatch.dispatch_id,
      stream_id: 'lifecycle-events', sequence: 1, order_sequence: 1, boot_id: 'conversation-test', kind, text: '',
    });
    const failed = await x.conversation.status(x.token, x.f.task);
    expect(await executionFacts()).toEqual(taskBefore);
    expect(failed.conversation_version).toBe(source.conversation_version + 1);
    expect(failed.inputs).toHaveLength(2);
    expect(failed.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: input.input_id, status: 'failed', version: 2 }),
      expect.objectContaining({ id: later.input_id, status: 'pending', version: 1 }),
    ]));
    expect(failed.source!.input_id).toBe(input.input_id);
    expect(failed.attempt).toMatchObject({ state: 'FAILED', mutation_allowed: false, process_released: false,
      end_reason: kind === 'capture_failed' ? 'capture_failed' : 'missing_formal_outcome' });
    expect((await x.db.pool.query('SELECT 1 FROM task_input_resolutions')).rowCount).toBe(0);
    const stop = (await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [turn.dispatch.attempt_id])).rows[0];
    expect(stop).toBeDefined();
    const retry = await inputAction('retry_task_input', input.input_id!, 2);
    expect(retry.input_id).toBe(input.input_id);
    expect((await x.conversation.status(x.token, x.f.task)).conversation_version).toBe(failed.conversation_version + 1);
    expect(await executionFacts()).toEqual(taskBefore);
    await x.conversation.pump();
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    await expect(x.reply(turn)).rejects.toMatchObject(fault('stale_execution'));
    await x.finish(stop.id, turn.dispatch.attempt_id);
    const next = await x.promote();
    expect(next.dispatch.task_conversation_source).toMatchObject({ input_id: input.input_id, source_watermark: source.source_watermark });
    expect(next.dispatch.task_conversation_source!.source_id).not.toBe(source.source_id);
    expect(next.dispatch.prompt).toContain('Keep this exact input');
    expect(next.dispatch.prompt).not.toContain('Later input must wait');
    expect((await x.db.pool.query('SELECT prompt, context_digest FROM task_conversation_outbox WHERE id=$1', [source.source_id])).rows[0]).toEqual({ prompt: turn.dispatch.prompt, context_digest: source.context_digest });
    const reply = await x.reply(next);
    await x.finish(reply.operation_id!, next.dispatch.attempt_id);
    const following = await x.turn();
    expect(following.dispatch.task_conversation_source!.input_id).toBe(later.input_id);
    expect(await executionFacts()).toEqual(taskBefore);
  });

  it('exact input issue answers and Retry/Withdraw preserve other open obligations', async () => {
    const taskBefore = await executionFacts();
    const first = await resolved('Question A', { kind: 'issue', text: 'Need answer A', basis: await x.basis() });
    const second = await resolved('Question B', { kind: 'issue', text: 'Need answer B', basis: await x.basis() });
    const guidance = await resolved('Retain guidance', { kind: 'guidance', text: 'Keep labels readable', basis: await x.basis() });
    const firstId = first.response.result!.obligation_id!, secondId = second.response.result!.obligation_id!, guidanceId = guidance.response.result!.obligation_id!;
    await x.send('Answer A is blue');
    const turn = await x.turn(), basis = await x.basis();
    await expect(x.reply(turn, { kind: 'answer', target_kind: 'input_issue', target_id: randomUUID(), text: 'Blue', basis })).rejects.toMatchObject(fault('stale_execution'));
    expect((await x.db.pool.query('SELECT 1 FROM task_input_answers')).rowCount).toBe(0);
    const answer = await x.reply(turn, { kind: 'answer', target_kind: 'input_issue', target_id: firstId, text: 'Blue', basis });
    await x.finish(answer.operation_id!, turn.dispatch.attempt_id);
    expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([firstId, secondId, guidanceId].sort());
    await expect(inputAction('retry_task_input', first.input.input_id!, 2)).rejects.toMatchObject(fault('unmet_precondition'));
    await x.db.pool.query("UPDATE execution_policies SET policies='{}'");
    const retry = await inputAction('retry_task_input', firstId);
    expect(retry.input_id).not.toBe(first.input.input_id);
    await expect(inputAction('retry_task_input', firstId, 2)).rejects.toMatchObject(fault('unmet_precondition'));
    await x.conversation.pump();
    expect((await x.conversation.status(x.token, x.f.task)).waiting_reason).toBe('policy_missing');
    const recheck = (await x.db.pool.query('SELECT i.parent_issue_id,m.content FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.id=$1', [retry.input_id])).rows[0];
    expect(recheck.parent_issue_id).toBe(firstId);
    expect(recheck.content).toContain('Need answer A');
    expect(recheck.content).toContain('Blue');
    expect(recheck.content).not.toContain('Need answer B');
    await inputAction('withdraw_task_input', firstId, 2);
    expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([secondId, guidanceId, retry.input_id!].sort());
    await inputAction('withdraw_task_input', retry.input_id!);
    const guidanceRetry = await inputAction('retry_task_input', guidanceId);
    await inputAction('withdraw_task_input', guidanceId, 2);
    expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([secondId, guidanceRetry.input_id!].sort());
    await inputAction('withdraw_task_input', guidanceRetry.input_id!);
    expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toEqual([secondId]);
    expect((await x.db.pool.query('SELECT target_id,answer FROM task_input_answers')).rows).toEqual([{ target_id: firstId, answer: 'Blue' }]);
    expect(await executionFacts()).toEqual(taskBefore);
  });

  it.each(['planning_issue', 'node_blocker'] as const)('records an exact %s answer but requires explicit Owner Retry before fresh execution', async targetKind => {
    let targetId: string | undefined, issueSequence: number | undefined, initialIntent: string | undefined;
    if (targetKind === 'planning_issue') {
      await x.owner('start_task', { specification_id: x.f.spec });
      await x.planning.pump();
      const planning = await x.promote();
      initialIntent = planning.dispatch.task_planning_source!.intent_id;
      const issue = await x.agent(planning, 'raise_planning_issue', { planning_intent_id: initialIntent, reason: 'Which label?' });
      issueSequence = issue.result!.planning_outcome!.issue_sequence!;
      await x.finish(issue.operation_id!, planning.dispatch.attempt_id);
    } else {
      await x.start();
      const node = await x.node(), blocked = await x.agent(node, 'block_node', { reason: 'Which label?' });
      await x.finish(blocked.operation_id!, node.dispatch.attempt_id);
      targetId = (await x.execution.status(x.token, x.f.task, x.f.node)).blocker!.id;
    }
    const taskBefore = await executionFacts(), nodeBefore = await nodeFacts();
    await x.send('Use BLUE_LABEL');
    const turn = await x.turn(), basis = await x.basis();
    const route: TaskTurnRouting = { kind: 'answer', target_kind: targetKind, text: 'BLUE_LABEL', basis,
      ...(targetId ? { target_id: targetId } : { issue_sequence: issueSequence! }) };
    await expect(x.reply(turn, { ...route, ...(targetId ? { target_id: randomUUID() } : { issue_sequence: issueSequence! + 1 }) })).rejects.toMatchObject(fault(targetId ? 'stale_execution' : 'version_conflict'));
    const answer = await x.reply(turn, route);
    await x.finish(answer.operation_id!, turn.dispatch.attempt_id);
    await x.planning.pump();
    await x.execution.pump();
    expect(await executionFacts()).toEqual(taskBefore);
    expect(await nodeFacts()).toEqual(nodeBefore);
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    expect((await x.db.pool.query('SELECT target_kind,target_id,answer FROM task_input_answers')).rows).toEqual([
      { target_kind: targetKind, target_id: targetId ?? String(issueSequence), answer: 'BLUE_LABEL' },
    ]);
    if (targetKind === 'planning_issue') {
      await x.owner('retry_initial_planning', { planning_intent_id: initialIntent!, issue_sequence: issueSequence! });
      await x.planning.pump();
    } else {
      await x.owner('retry_node', { node_id: x.f.node, node_activation: 1, source_id: nodeBefore.execution_source_id, blocker_id: targetId! });
      await x.execution.pump();
    }
    const retry = await x.promote();
    expect(retry.dispatch.prompt).toContain('BLUE_LABEL');
  });

  it('canonical scratch-only Planner shares the Task host with a live Node workspace lease', async () => {
    const resource = randomUUID(), configuration = new Configuration(x.db);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Project', context: 'Task project', role_ids: [x.f.role], archived: false,
        resources: [{ id: resource, remote_url: 'https://github.com/example/conversation-test.git', remote_preparation: 'after_acceptance', default_branch: 'main' }] },
    });
    await x.start();
    const node = await x.node(), opened = await x.agent(node, 'open_workspace', { resource_id: resource });
    const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!), workspace = operation.workspace!;
    // This trusted workspace result exercises PostgreSQL ownership, not Git or Linux materialization.
    await x.service.finishOperation(x.f.runner, x.f.incarnation, {
      operation_id: operation.operation_id, attempt_id: node.dispatch.attempt_id, success: true,
      result: { workspace_id: workspace.workspace_id, path: '/runner/conversation-test', instruction_files: [],
        workspace_metadata: { generation: 1, storage_id: 'conversation-test-storage', lease_id: workspace.lease_id,
          repository_identity: workspace.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
          base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40) } },
    });
    const leaseBefore = (await x.db.pool.query('SELECT * FROM workspace_leases WHERE id=$1', [workspace.lease_id])).rows[0];
    expect(leaseBefore.state).toBe('held');
    const taskBefore = await executionFacts(), nodeBefore = await nodeFacts();
    await x.send('Report current progress');
    const turn = await x.turn();
    expect(turn.dispatch.runner_id).toBe(node.dispatch.runner_id);
    expect(turn.dispatch.task_conversation_source).toBeDefined();
    expect(turn.dispatch.workspace_reservations!.resources).toEqual([]);
    expect(turn.dispatch.node_id).toBeUndefined();
    expect(turn.dispatch.resource_id).toBeUndefined();
    expect((await x.db.pool.query('SELECT 1 FROM attempts WHERE task_id=$1 AND NOT process_released', [x.f.task])).rowCount).toBe(2);
    await expect(x.agent(turn, 'open_workspace', { resource_id: resource })).rejects.toMatchObject(fault('denied_scope'));
    const reply = await x.reply(turn);
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    expect(await executionFacts()).toEqual(taskBefore);
    expect(await nodeFacts()).toEqual(nodeBefore);
    expect((await x.db.pool.query('SELECT * FROM workspace_leases WHERE id=$1', [workspace.lease_id])).rows[0]).toEqual(leaseBefore);
    expect((await x.db.pool.query('SELECT mutation_allowed,process_released FROM attempts WHERE id=$1', [node.dispatch.attempt_id])).rows[0]).toEqual({ mutation_allowed: true, process_released: false });
  });
});
