import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, InspectionResult, Operation, WorkspaceMetadata } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { GitHub } from '../src/github.ts';
import { Discussion } from '../src/discussion.ts';
import { Todos } from '../src/todos.ts';
import { TaskReplan } from '../src/task-replan.ts';
import { assertInspectionAccess } from '../src/repository-inspection.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { resultReadFixture } from './fixtures/result-read-fixture.ts';
import { reviewCorrectionFixture } from './fixtures/review-correction-fixture.ts';
import { ownerDeliveryFixture } from './fixtures/owner-delivery-fixture.ts';

type Fixture = Awaited<ReturnType<typeof conversationFixture>>;
type Agent = { dispatch: Dispatch; credential: string };
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Planner repository inspection', { timeout: 20000 }, () => {
  const fixtures: Fixture[] = [];
  async function use<T extends Fixture>(promise: Promise<T>): Promise<T> { const value = await promise; fixtures.push(value); return value; }
  afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); }, 20000);
  async function configure(x: Fixture, resource = randomUUID(), remove = false) {
    const config = new Configuration(x.db);
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), name: 'save_project',
      expected_control_version: (await config.read(x.token)).control_version,
      payload: { id: x.f.project, name: 'Inspection Project', context: 'Inspect exact source code', role_ids: [x.f.role], archived: false,
        resources: remove ? [] : [{ id: resource, remote_url: 'https://github.com/example/inspection.git', remote_preparation: 'after_acceptance', default_branch: 'main' }] } });
    return resource;
  }
  async function inspect(x: Fixture, a: Agent, resource: string, requestId = randomUUID()) {
    const command: CommandEnvelope = { schema_version: 1, request_id: requestId, scope_id: a.dispatch.todo_id ?? a.dispatch.task_id!,
      expected_control_version: a.dispatch.control_version, name: 'inspect_repository', payload: { resource_id: resource } };
    const response = await x.service.admit(a.credential, submission(command));
    const operation = await x.service.recoverOperation(x.f.runner, response.operation_id!);
    return { command, response, operation };
  }
  function observation(op: Operation, status: 'available' | 'unavailable' = 'available'): InspectionResult {
    const d = op.inspection!, origin = d.origin;
    return { inspection_id: op.operation_id, descriptor_digest: op.inspection_digest!, status,
      ...(status === 'unavailable' ? { reason: 'source_stale' as const } : { snapshot: {
        snapshot_id: op.operation_id, storage_id: origin.kind === 'task_completion' ? origin.identity!.storage_id : origin.kind === 'task_open' ? origin.metadata!.storage_id : 'inspection-storage',
        path: `/runner/inspection/${op.operation_id}`, commit: origin.kind === 'task_completion' ? origin.identity!.git_commit : origin.kind === 'task_open' ? origin.metadata!.base_commit : 'a'.repeat(40),
        tree: origin.kind === 'task_completion' ? origin.identity!.git_tree : 'c'.repeat(40), repository_identity: d.resource.repository_identity, instruction_files: [],
      } }) };
  }
  async function finish(x: Fixture, op: Operation, result = observation(op)) {
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: op.operation_id, attempt_id: op.attempt_id, success: true, result: { inspection: result } });
  }
  async function access(x: Fixture, op: Operation) {
    return transaction(x.db, async tx => {
      const attempt = (await tx.query('SELECT * FROM attempts WHERE id=$1', [op.attempt_id])).rows[0];
      const operation = (await tx.query('SELECT * FROM operations WHERE id=$1', [op.operation_id])).rows[0];
      return assertInspectionAccess(tx, attempt, operation, op.inspection_digest!);
    });
  }

  it('binds initial planning, deduplicates admission and preserves exact settlement without reserving a workspace', async () => {
    const x = await use(conversationFixture()), resource = await configure(x);
    await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump(); const a = await x.promote();
    const before = await x.version(), id = randomUUID();
    const [first, duplicate] = await Promise.all([inspect(x, a, resource, id), inspect(x, a, resource, id)]);
    expect(duplicate.response).toEqual(first.response);
    const op = first.operation;
    expect(op.inspection).toMatchObject({ scope_kind: 'task', scope_id: x.f.task, planner_source: { kind: 'task_initial_planning', source_id: a.dispatch.task_planning_source!.intent_id }, origin: { kind: 'default_ref' } });
    expect(op.inspection_digest).toBe(digest(canonicalJSON(op.inspection)));
    expect(op.workspace).toBeUndefined(); expect(await x.version()).toBe(before);
    expect((await x.db.pool.query("SELECT 1 FROM operations WHERE kind='inspect_repository'")).rowCount).toBe(1);
    for (const table of ['task_workspaces', 'workspace_leases']) expect((await x.db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    await access(x, op);
    await expect(inspect(x, a, 'foreign-resource')).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(inspect(x, a, 'foreign-resource', id)).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    await expect(x.db.pool.query("UPDATE operations SET inspection_descriptor=jsonb_set(inspection_descriptor,'{project_id}',to_jsonb('forged'::text)) WHERE id=$1", [op.operation_id])).rejects.toMatchObject({ code: '23514' });
    const forgedDescriptor = { ...op.inspection!, inspection_id: randomUUID() };
    await expect(x.db.pool.query(`INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id,inspection_descriptor,inspection_digest)
      VALUES($1,$2,1,'inspect_repository',$3,'admitted',$4,$5,$6)`, [forgedDescriptor.inspection_id, a.dispatch.attempt_id, randomUUID(), resource,
      forgedDescriptor, digest(canonicalJSON(forgedDescriptor))])).rejects.toMatchObject({ code: '23514' });
    const good = observation(op);
    await expect(finish(x, op, { ...good, descriptor_digest: 'f'.repeat(64) })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await finish(x, op); await finish(x, op);
    await expect(finish(x, op, observation(op, 'unavailable'))).rejects.toMatchObject({ detail: { code: 'payload_conflict' } });
    const terminal = await x.agent(a, 'raise_planning_issue', { planning_intent_id: a.dispatch.task_planning_source!.intent_id, reason: 'Owner clarification needed' });
    await x.finish(terminal.operation_id!, a.dispatch.attempt_id);
    expect((await inspect(x, a, resource, id)).response.result?.inspection).toEqual(good);
    await expect(inspect(x, a, resource)).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
  });

  it('binds Todo source, permits resource removal after inspection and settles unavailable before Stop', async () => {
    const x = await use(conversationFixture()), resource = await configure(x), todo = randomUUID(), discussion = new Discussion(x.db, x.service.instanceId);
    await new Todos(x.db).command(x.token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: todo, original_capture: 'Inspect project', project_id: x.f.project } });
    await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, name: 'submit_discussion_message', payload: { message_id: randomUUID(), content: 'Check repository facts' } });
    await discussion.pump(); const a = await x.promote(), { operation: op } = await inspect(x, a, resource);
    expect(op.inspection).toMatchObject({ scope_kind: 'todo', scope_id: todo, planner_source: { kind: 'todo_discussion', source_id: a.dispatch.source_message_id, context_digest: digest(a.dispatch.prompt) } });
    await configure(x, resource, true);
    await expect(access(x, op)).rejects.toBeDefined();
    const status = await discussion.status(x.token, todo);
    await discussion.command(x.token, { schema_version: 1, request_id: randomUUID(), todo_id: todo, expected_discussion_version: status.discussion_version,
      name: 'stop_discussion_turn', payload: { source_message_id: a.dispatch.source_message_id!, attempt_id: a.dispatch.attempt_id } });
    const stop = (await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [a.dispatch.attempt_id])).rows[0];
    await expect(x.finish(stop.id, a.dispatch.attempt_id)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: op.operation_id, attempt_id: op.attempt_id, success: false, failure_kind: 'recoverable', result: { message: 'Interrupted materialization' } });
    expect((await x.service.recoverOperation(x.f.runner, op.operation_id)).state).toBe('recovery');
    await finish(x, op, observation(op, 'unavailable')); await x.finish(stop.id, a.dispatch.attempt_id);
    expect((await x.db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].process_released).toBe(true);
    expect((await x.db.pool.query('SELECT 1 FROM task_workspaces')).rowCount).toBe(0);
  });

  it('authorizes transient repository credentials before and after provider I/O and never persists them', async () => {
    const x = await use(conversationFixture()), resource = await configure(x), github = new GitHub(x.service.options.signingKey);
    x.service.options.github = github;
    const secret = 'ephemeral-inspection-test-token';
    const credential = { remote_url: 'https://github.com/example/inspection.git', default_branch: 'main',
      provider_metadata: { github: { repository_id: '42' } },
      authentication: { kind: 'github_installation' as const, token: secret, expires_at: new Date(Date.now() + 60000).toISOString() } };
    const provider = vi.spyOn(github, 'repositoryAccess').mockResolvedValue(credential);
    await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump(); const a = await x.promote(), { operation: op } = await inspect(x, a, resource);
    const request = { schema_version: 1, incarnation: x.f.incarnation, inspection_digest: op.inspection_digest! };
    expect(await x.service.inspectionRepositoryAccess(x.f.runner, op.operation_id, request)).toMatchObject({ operation_id: op.operation_id, inspection_digest: op.inspection_digest, authentication: credential.authentication });
    await expect(x.service.inspectionRepositoryAccess(x.f.runner, op.operation_id, { ...request, inspection_digest: 'f'.repeat(64) })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    expect(provider).toHaveBeenCalledTimes(1);
    provider.mockImplementationOnce(async () => { await configure(x, resource, true); return credential; });
    await expect(x.service.inspectionRepositoryAccess(x.f.runner, op.operation_id, request)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    expect(provider).toHaveBeenCalledTimes(2);
    const persisted = (await x.db.pool.query(`SELECT to_jsonb(o) operation,to_jsonb(r) receipt FROM operations o
      JOIN command_receipts r ON r.operation_id=o.id WHERE o.id=$1`, [op.operation_id])).rows[0];
    expect(JSON.stringify(persisted)).not.toContain(secret);
    expect(persisted.operation.state).toBe('admitted');
    await finish(x, op, { ...observation(op, 'unavailable'), reason: 'resource_unavailable' });
    await expect(x.service.inspectionRepositoryAccess(x.f.runner, op.operation_id, request)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('uses the independent Conversation version and permits terminal read-only conversation', async () => {
    const x = await use(conversationFixture()), resource = await configure(x);
    await x.start(); await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    await x.send('Explain the repository after cancellation'); const a = await x.turn();
    expect(a.dispatch.task_conversation_source!.reply_only).toBe(true);
    expect(a.dispatch.control_version).not.toBe(await x.version());
    const { operation: op } = await inspect(x, a, resource);
    expect(op.inspection!.planner_source).toMatchObject({ kind: 'task_conversation', control_version: a.dispatch.task_conversation_source!.conversation_version });
    await finish(x, op);
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('CANCELLED');
    const turn = await x.reply(a); await x.finish(turn.operation_id!, a.dispatch.attempt_id);
  });

  it('permits read-only inspection after exact Owner acceptance without reopening delivery', async () => {
    const x = await use(ownerDeliveryFixture()), resource = await configure(x);
    const proposal = await x.prepareDelivery(), confirmation = await x.confirmDelivery(proposal);
    await x.acceptDelivery(proposal, confirmation);
    const before = (await x.db.pool.query('SELECT state,accepted_delivery_operation_id,control_version FROM tasks WHERE id=$1', [x.f.task])).rows[0];
    await x.send('Explain accepted output using repository facts'); const a = await x.turn(), { operation: op } = await inspect(x, a, resource);
    expect(a.dispatch.task_conversation_source!.reply_only).toBe(true); await finish(x, op);
    expect((await x.db.pool.query('SELECT state,accepted_delivery_operation_id,control_version FROM tasks WHERE id=$1', [x.f.task])).rows[0]).toEqual(before);
    expect((await x.db.pool.query('SELECT 1 FROM task_workspaces')).rowCount).toBe(0);
  });

  it('supports exact Replan and Review sources without resolving their semantic obligations', async () => {
    const x = await use(conversationFixture()), resource = await configure(x);
    await x.start(); const node = await x.node();
    await expect(inspect(x, node, resource)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    const request = await x.agent(node, 'request_replan', { reason: 'Need a different graph' }); await x.finish(request.operation_id!, node.dispatch.attempt_id);
    await new TaskReplan(x.db, {}, x.service.instanceId).pump(); const a = await x.promote(), { operation: op } = await inspect(x, a, resource);
    expect(op.inspection!.planner_source).toMatchObject({ kind: 'task_replan', source_id: a.dispatch.task_replan_source!.source_id });
    await finish(x, op, observation(op, 'unavailable'));
    expect((await x.db.pool.query('SELECT status FROM replan_requests WHERE id=$1', [a.dispatch.task_replan_source!.request_id])).rows[0].status).toBe('pending');
    const review = await use(reviewCorrectionFixture()), reviewResource = await configure(review);
    const feedback = await review.requestChanges(), reviewer = await review.reviewTurn(), inspected = await inspect(review, reviewer, reviewResource);
    expect(inspected.operation.inspection!.planner_source).toMatchObject({ kind: 'task_review', source_id: reviewer.dispatch.task_review_source!.source_id });
    await finish(review, inspected.operation);
    expect((await review.db.pool.query('SELECT status FROM task_review_feedback WHERE id=$1', [feedback.feedback_id])).rows[0].status).toBe('active');
  });

  it('pins the initial open base while a Node writes and excludes its later private Stop checkpoint', async () => {
    const x = await use(conversationFixture()), resource = await configure(x);
    await x.start(); const node = await x.node(), opened = await x.agent(node, 'open_workspace', { resource_id: resource });
    const open = await x.service.recoverOperation(x.f.runner, opened.operation_id!), w = open.workspace!;
    const metadata: WorkspaceMetadata = { storage_id: 'inspection-base-storage', generation: w.generation, lease_id: w.lease_id,
      repository_identity: w.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
      base_commit: 'a'.repeat(40), finalized_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40) };
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: open.operation_id, attempt_id: node.dispatch.attempt_id, success: true,
      result: { workspace_id: w.workspace_id, path: '/runner/private/worktree', instruction_files: [], workspace_metadata: metadata } });
    await x.send('Inspect only finalized code'); const a = await x.turn(), first = await inspect(x, a, resource);
    expect(first.operation.inspection!.origin).toEqual({ kind: 'task_open', operation_id: open.operation_id, workspace: w, workspace_digest: open.workspace_digest, metadata });
    await finish(x, first.operation);
    const stopped = await x.owner('stop_node', { node_id: x.f.node, node_activation: node.dispatch.node_activation, source_id: node.dispatch.node_execution_source!.source_id });
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: stopped.operation_id!, attempt_id: node.dispatch.attempt_id, success: true,
      result: { writer_absent: true, workspace_id: w.workspace_id, workspace_metadata: { ...metadata, checkpoint: {
        operation_id: stopped.operation_id!, head_commit: metadata.finalized_commit, commit_id: 'd'.repeat(40), tree_id: 'e'.repeat(40),
      } } } });
    const second = await inspect(x, a, resource);
    expect(second.operation.inspection!.origin).toEqual(first.operation.inspection!.origin);
    const forged = observation(second.operation); forged.snapshot!.commit = 'd'.repeat(40);
    await expect(finish(x, second.operation, forged)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await finish(x, second.operation);
    expect((await x.db.pool.query('SELECT finalized_commit FROM task_workspaces WHERE id=$1', [w.workspace_id])).rows[0].finalized_commit).toBe(metadata.base_commit);
  });

  it('uses the exact finalized completion and rejects a changed revision or descriptor', async () => {
    const x = await use(resultReadFixture()); await x.send('Inspect finalized result'); const a = await x.turn(), { operation: op } = await inspect(x, a, x.resource);
    expect(op.inspection!.origin).toMatchObject({ kind: 'task_completion', identity: { operation_id: x.operationId, git_commit: 'b'.repeat(40), git_tree: 'c'.repeat(40) } });
    await expect(access(x, op)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    const bad = observation(op); bad.snapshot!.tree = 'e'.repeat(40);
    await expect(finish(x, op, bad)).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(x.db.pool.query("UPDATE operations SET state='succeeded',result=$2 WHERE id=$1", [op.operation_id, { inspection: bad }])).rejects.toMatchObject({ code: '23514' });
    await finish(x, op);
    expect((await x.db.pool.query('SELECT 1 FROM workspace_leases WHERE attempt_id=$1', [a.dispatch.attempt_id])).rowCount).toBe(0);
  });

  it('freezes an admitted revision while the Task advances and gives a later request the new finalized revision', async () => {
    const x = await use(conversationFixture()), resource = await configure(x), nextNode = randomUUID();
    await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump();
    const planner = await x.promote(), plan = await x.agent(planner, 'publish_execution_plan', {
      planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: x.f.plan,
      nodes: [{ node_id: x.f.node, role_id: x.f.role, goal: 'First revision', dependencies: [] },
        { node_id: nextNode, role_id: x.f.role, goal: 'Second revision', dependencies: [x.f.node] }],
    });
    await x.finish(plan.operation_id!, planner.dispatch.attempt_id);
    async function open(a: Agent, finalized: string) {
      const opened = await x.agent(a, 'open_workspace', { resource_id: resource }), op = await x.service.recoverOperation(x.f.runner, opened.operation_id!), w = op.workspace!;
      const metadata: WorkspaceMetadata = { generation: w.generation, lease_id: w.lease_id, storage_id: 'serial-inspection-storage', repository_identity: w.resource.repository_identity,
        provider_metadata: { github: { repository_id: '42' } }, base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'a'.repeat(40), finalized_commit: finalized };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: op.operation_id, attempt_id: a.dispatch.attempt_id, success: true,
        result: { workspace_id: w.workspace_id, path: '/runner/private/worktree', instruction_files: [], workspace_metadata: metadata } });
      return { w, metadata };
    }
    async function complete(a: Agent, opened: Awaited<ReturnType<typeof open>>, commit: string, tree: string) {
      const result = await x.agent(a, 'complete_node', { summary: 'Exact completed revision' });
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: result.operation_id!, attempt_id: a.dispatch.attempt_id, success: true,
        result: { writer_absent: true, workspace_id: opened.w.workspace_id, workspace_metadata: { ...opened.metadata, finalized_commit: commit }, git_commit: commit, git_tree: tree } });
      return result.operation_id!;
    }
    const first = await x.node(), firstOpen = await open(first, 'a'.repeat(40)), firstResult = await complete(first, firstOpen, 'b'.repeat(40), 'c'.repeat(40));
    const second = await x.node(), secondOpen = await open(second, 'b'.repeat(40));
    await x.send('Inspect latest finalized code'); const a = await x.turn(), id = randomUUID(), before = await inspect(x, a, resource, id);
    expect(before.operation.inspection!.origin.identity!.operation_id).toBe(firstResult);
    const secondResult = await complete(second, secondOpen, 'd'.repeat(40), 'e'.repeat(40));
    await finish(x, before.operation);
    const replay = await inspect(x, a, resource, id);
    expect(replay.operation.inspection).toEqual(before.operation.inspection);
    const after = await inspect(x, a, resource);
    expect(after.operation.inspection!.origin).toMatchObject({ kind: 'task_completion', identity: { operation_id: secondResult, git_commit: 'd'.repeat(40), git_tree: 'e'.repeat(40) } });
    await finish(x, after.operation);
  });
});
