import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { digest, submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, OwnerCommand } from '../../../packages/protocol/src/index.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { NodeExecution } from '../src/node-execution.ts';
import { TaskPlanning } from '../src/task-planning.ts';
import { BoundaryService } from '../src/service.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { Configuration } from '../src/configuration.ts';
import { initializeTask } from '../src/task-records.ts';
import { issueOwnerSession, OwnerCommands } from '../src/owner-commands.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { Worker } from './fixtures/process-worker.ts';
import { ownerArtifact, ownerArtifacts } from '../src/artifacts.ts';
import { attemptWorkspace } from '../src/task-workspace-reads.ts';

const key = 'node-execution-test-signing-key-32';
const fault = (code: string) => ({ detail: { code } });
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('canonical Node execution', () => {
  const workers: Worker[] = [];
  let databaseUrl: string;
  let db: Database,
    admin: Database,
    namespace: string,
    token: string,
    service: BoundaryService,
    execution: NodeExecution,
    queue: DispatchQueue;
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = database(url.toString());
    namespace = 'node_' + randomUUID().replaceAll('-', '');
    await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
    databaseUrl = url.toString();
    db = database(databaseUrl);
    await migrate(db);
    token = (await issueOwnerSession(db)).token;
    service = new BoundaryService(db, { signingKey: key });
    execution = new NodeExecution(db, service.instanceId);
    queue = new DispatchQueue(db);
  }, 20000);
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((w) => w.stop()));
    if (db) await db.pool.end();
    if (admin) {
      await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`);
      await admin.pool.end();
    }
  }, 20000);
  async function version(taskId: string) {
    return Number(
      (await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [taskId])).rows[0].control_version
    );
  }
  async function owner(taskId: string, name: OwnerCommand['name'], payload: object) {
    const command = {
      schema_version: 1,
      request_id: randomUUID(),
      scope_id: taskId,
      expected_control_version: await version(taskId),
      name,
      payload,
    };
    return { command, result: await new OwnerCommands(db).confirm(token, command) };
  }
  async function setup(resources: object[] = []) {
    const f = {
      task: randomUUID(),
      spec: randomUUID(),
      project: randomUUID(),
      role: randomUUID(),
      node: randomUUID(),
      plan: randomUUID(),
      runner: randomUUID(),
      incarnation: 0,
    };
    const configuration = new Configuration(db);
    await configuration.save(token, {
      schema_version: 1,
      request_id: randomUUID(),
      expected_control_version: (await configuration.read(token)).control_version,
      name: 'save_role',
      payload: {
        id: f.role,
        name: 'Builder',
        description: 'descriptor',
        instructions: 'CURRENT_ROLE_FULL',
        archived: false,
      },
    });
    await configuration.save(token, {
      schema_version: 1,
      request_id: randomUUID(),
      expected_control_version: (await configuration.read(token)).control_version,
      name: 'save_project',
      payload: {
        id: f.project,
        name: 'Project',
        context: 'Project notes',
        resources,
        role_ids: [f.role],
        archived: false,
      },
    });
    await transaction(db, (tx) =>
      initializeTask(tx, {
        task_id: f.task,
        specification_id: f.spec,
        project_id: f.project,
        specification: 'Build precise result',
      })
    );
    await enrollFixture(db, f.runner, randomUUID(), 2);
    f.incarnation = await service.connect(f.runner, 'node-test');
    await service.touch(f.runner, f.incarnation, true, [
      {
        runtime_id: 'opencode',
        executable: '/opencode',
        availability: 'detected',
        supports_model: true,
        supports_thinking: false,
        model_ids: [],
      },
    ]);
    await db.pool.query('UPDATE execution_policies SET policies=$1,planner_guidance=$2', [
      {
        global: {
          default_target: {
            runtime_id: 'opencode',
            model_id: 'opencode/longcat-2.5-preview-free',
            runner_id: f.runner,
          },
          fallback_targets: [],
        },
      },
      'PLANNER_GUIDANCE_EXCLUDED',
    ]);
    await owner(f.task, 'start_task', { specification_id: f.spec });
    const planning = new TaskPlanning(db, service.instanceId);
    await planning.pump();
    const planner = (await queue.promoteNext(f.runner, service.instanceId, f.incarnation))!;
    const grant = (await service.authorize(f.runner, f.incarnation, planner.dispatch_id))!;
    const result = await service.admit(
      grant.credential,
      submission({
        schema_version: 1,
        request_id: randomUUID(),
        scope_id: f.task,
        expected_control_version: planner.control_version,
        name: 'publish_execution_plan',
        payload: {
          planning_intent_id: planner.task_planning_source!.intent_id,
          plan_id: f.plan,
          nodes: [
            { node_id: f.node, role_id: f.role, goal: 'Build', dependencies: [], hard_requirements: ['Exact output'] },
          ],
        },
      })
    );
    await service.finishOperation(f.runner, f.incarnation, {
      operation_id: result.operation_id!,
      attempt_id: planner.attempt_id,
      success: true,
      result: { writer_absent: true },
    });
    return f;
  }
  async function launch(f: Awaited<ReturnType<typeof setup>>) {
    await execution.pump();
    const dispatch = (await queue.promoteNext(f.runner, service.instanceId, f.incarnation))!;
    expect(dispatch).not.toBeNull();
    const grant = (await service.authorize(f.runner, f.incarnation, dispatch.dispatch_id))!;
    return { dispatch, credential: grant.credential };
  }
  async function agent(
    a: { dispatch: Dispatch; credential: string },
    name: CommandEnvelope['name'],
    payload: CommandEnvelope['payload'],
    requestId = randomUUID()
  ) {
    const command: CommandEnvelope = {
      schema_version: 1,
      request_id: requestId,
      scope_id: a.dispatch.task_id!,
      expected_control_version: await version(a.dispatch.task_id!),
      name,
      payload,
    };
    return { command, result: await service.admit(a.credential, submission(command)) };
  }
  async function complete(
    f: Awaited<ReturnType<typeof setup>>,
    a: Awaited<ReturnType<typeof launch>>,
    payload: CommandEnvelope['payload'] = { summary: 'Done' }
  ) {
    const c = await agent(a, 'complete_node', payload);
    const operation = await service.recoverOperation(f.runner, c.result.operation_id!);
    expect(operation.repository_free).toBe(true);
    await service.finishOperation(f.runner, f.incarnation, {
      operation_id: operation.operation_id,
      attempt_id: a.dispatch.attempt_id,
      success: true,
      result: { writer_absent: true },
    });
    return c;
  }
  it('discovers canonical work once, freezes full current Role and excludes Planner guidance, queues as RUNNING', async () => {
    const f = await setup();
    await db.pool.query('UPDATE roles SET archived=true WHERE id=$1', [f.role]);
    await Promise.all([execution.pump(), new NodeExecution(db, service.instanceId).pump()]);
    const status = await execution.status(token, f.task, f.node);
    expect(status).toMatchObject({ state: 'RUNNING', attempt: { state: 'QUEUED' } });
    const source = (await db.pool.query('SELECT * FROM node_execution_outbox')).rows[0];
    expect(source.prompt).toContain('CURRENT_ROLE_FULL');
    expect(source.prompt).not.toContain('PLANNER_GUIDANCE_EXCLUDED');
    expect(JSON.parse(source.prompt).binding.planned_attempt_id).toBe(source.planned_attempt_id);
    await db.pool.query("UPDATE roles SET instructions='NEW' WHERE id=$1", [f.role]);
    await new NodeExecution(db, service.instanceId).pump();
    expect((await db.pool.query('SELECT count(*) FROM node_execution_outbox')).rows[0].count).toBe('1');
    expect((await db.pool.query('SELECT prompt FROM node_execution_outbox')).rows[0].prompt).toBe(source.prompt);
    await expect(
      db.pool.query("UPDATE node_execution_outbox SET prompt='changed' WHERE id=$1", [source.id])
    ).rejects.toMatchObject({ code: '23514' });
  }, 20000);
  it('publishes immutable scoped HTML and exact completion manifest without Git fiction', async () => {
    const f = await setup();
    const a = await launch(f);
    const id = randomUUID();
    const html = '<button>Add book</button>';
    const published = await agent(a, 'publish_artifact', {
      artifact_id: id,
      title: 'Reading list',
      content: { text: html, media_type: 'text/html' },
    });
    expect(published.result).toMatchObject({ status: 'committed', result: { artifact_id: id } });
    const read = await agent(a, 'read_artifact', { artifact_id: id });
    expect(read.result.result!.artifact!.content.text).toBe(html);
    await expect(ownerArtifact(db, token, 'another-task', id)).rejects.toMatchObject(fault('denied_scope'));
    await expect(db.pool.query("UPDATE artifacts SET content='changed' WHERE id=$1", [id])).rejects.toMatchObject({
      code: '23514',
    });
    const c = await complete(f, a);
    const status = await execution.status(token, f.task, f.node);
    expect(status).toMatchObject({ state: 'COMPLETED', manifest: { summary: 'Done', artifact_ids: [id] } });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.task])).rows[0].state).toBe('REVIEW');
    expect(
      (await db.pool.query('SELECT result FROM operations WHERE id=$1', [c.result.operation_id])).rows[0].result
    ).toEqual({ writer_absent: true });
    expect((await ownerArtifact(db, token, f.task, id)).metadata.content_digest).toBe(digest(html));
    expect((await ownerArtifacts(db, token, f.task)).artifacts).toHaveLength(1);
    expect((await service.admit(a.credential, submission(published.command))).result).toEqual(published.result.result);
  }, 20000);
  it('distinguishes offline waiting from unsupported policy blocking, exact Retry creates fresh context', async () => {
    const f = await setup();
    await service.disconnect(f.runner, f.incarnation);
    await execution.pump();
    expect(await execution.status(token, f.task, f.node)).toMatchObject({
      state: 'PENDING',
      waiting_reason: 'runner_offline',
      attempt: null,
    });
    await db.pool.query('UPDATE execution_policies SET policies=$1', [
      { global: { default_target: { runtime_id: 'unsupported' }, fallback_targets: [] } },
    ]);
    await execution.pump();
    const status = await execution.status(token, f.task, f.node);
    expect(status).toMatchObject({
      state: 'BLOCKED',
      blocker: { kind: 'factual', reason: 'unsupported_runtime' },
      attempt: null,
    });
    const retried = await owner(f.task, 'retry_node', {
      node_id: f.node,
      node_activation: 1,
      source_id: status.source!.source_id,
      blocker_id: status.blocker!.id,
    });
    expect(retried.result.source_id).not.toBe(status.source!.source_id);
    expect((await execution.status(token, f.task, f.node)).node_activation).toBe(1);
  }, 20000);
  it('formal block saves precise answer, waits for old process settlement and selects earlier output only explicitly', async () => {
    const f = await setup();
    const a = await launch(f);
    const id = randomUUID();
    await agent(a, 'publish_artifact', {
      artifact_id: id,
      title: 'Partial',
      content: { text: 'draft', media_type: 'text/plain' },
    });
    const b = await agent(a, 'block_node', { reason: 'Which label?' });
    const status = await execution.status(token, f.task, f.node);
    expect(status).toMatchObject({ state: 'BLOCKED', blocker: { kind: 'semantic', reason: 'Which label?' } });
    await expect(
      owner(f.task, 'retry_node', {
        node_id: f.node,
        node_activation: 1,
        source_id: status.source!.source_id,
        blocker_id: status.blocker!.id,
      })
    ).rejects.toMatchObject(fault('unmet_precondition'));
    await owner(f.task, 'retry_node', {
      node_id: f.node,
      node_activation: 1,
      source_id: status.source!.source_id,
      blocker_id: status.blocker!.id,
      answer: 'Add book',
    });
    await execution.pump();
    expect(await queue.promoteNext(f.runner, service.instanceId, f.incarnation)).toBeNull();
    await service.finishOperation(f.runner, f.incarnation, {
      operation_id: b.result.operation_id!,
      attempt_id: a.dispatch.attempt_id,
      success: true,
      result: { writer_absent: true },
    });
    const next = await launch(f);
    expect(next.dispatch.node_activation).toBe(1);
    expect(next.dispatch.prompt).toContain('Add book');
    await complete(f, next, { summary: 'Used prior output', artifact_ids: [id] });
    expect((await execution.status(token, f.task, f.node)).manifest!.artifact_ids).toEqual([id]);
  }, 20000);
  it('empty selection stays empty, wrong scope and artifact budgets roll back', async () => {
    const f = await setup();
    const a = await launch(f);
    await expect(
      agent(a, 'publish_artifact', {
        artifact_id: randomUUID(),
        title: 'Bad',
        content: { text: '😀'.repeat(65537), media_type: 'text/plain' },
      })
    ).rejects.toMatchObject(fault('invalid_input'));
    await expect(
      agent(a, 'publish_artifact', {
        artifact_id: randomUUID(),
        title: 'Bad URL',
        content: { text: 'x', media_type: 'text/plain' },
        references: [{ url: 'http://[' }],
      })
    ).rejects.toMatchObject(fault('invalid_input'));
    await agent(a, 'publish_artifact', {
      artifact_id: randomUUID(),
      title: 'Ignored',
      content: { text: 'text', media_type: 'text/plain' },
    });
    await expect(agent(a, 'complete_node', { summary: 'wrong', artifact_ids: ['other'] })).rejects.toMatchObject(
      fault('denied_scope')
    );
    await complete(f, a, { summary: 'No selected output', artifact_ids: [] });
    expect((await execution.status(token, f.task, f.node)).manifest!.artifact_ids).toEqual([]);
  }, 20000);
  it('Cancel wins late completion and prevents current evidence while settling original receipt', async () => {
    const f = await setup();
    const a = await launch(f);
    const c = await agent(a, 'complete_node', { summary: 'Done' });
    await owner(f.task, 'cancel_task', { specification_id: f.spec, plan_id: f.plan });
    await service.finishOperation(f.runner, f.incarnation, {
      operation_id: c.result.operation_id!,
      attempt_id: a.dispatch.attempt_id,
      success: true,
      result: { writer_absent: true },
    });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.task])).rows[0].state).toBe('CANCELLED');
    expect((await db.pool.query('SELECT 1 FROM node_completions')).rowCount).toBe(0);
    expect((await execution.status(token, f.task, f.node)).state).toBe('CANCELLED');
    expect((await service.admit(a.credential, submission(c.command))).status).toBe('committed');
  }, 20000);
  it.each([true, false])(
    'recoverable completion stays RUNNING under absence ordering %s',
    async (absenceFirst) => {
      const f = await setup();
      const a = await launch(f);
      const c = await agent(a, 'complete_node', { summary: 'Done' });
      const absent = () =>
        service.event(f.runner, f.incarnation, {
          attempt_id: a.dispatch.attempt_id,
          dispatch_id: a.dispatch.dispatch_id,
          stream_id: 's',
          sequence: 1,
          order_sequence: 1,
          boot_id: 'node-test',
          kind: 'process_absent',
          text: '',
        });
      const failed = () =>
        service.finishOperation(f.runner, f.incarnation, {
          operation_id: c.result.operation_id!,
          attempt_id: a.dispatch.attempt_id,
          success: false,
          failure_kind: 'recoverable',
          result: { writer_absent: true },
        });
      if (absenceFirst) {
        await absent();
        await failed();
      } else {
        await failed();
        await absent();
      }
      expect((await execution.status(token, f.task, f.node)).state).toBe('RUNNING');
      expect((await execution.status(token, f.task, f.node)).attempt!.process_released).toBe(false);
      await service.finishOperation(f.runner, f.incarnation, {
        operation_id: c.result.operation_id!,
        attempt_id: a.dispatch.attempt_id,
        success: true,
        result: { writer_absent: true },
      });
      expect((await execution.status(token, f.task, f.node)).state).toBe('COMPLETED');
    },
    20000
  );
  const oid = 'a'.repeat(40),
    tree = 'b'.repeat(40),
    commit = 'c'.repeat(40);
  async function workspace() {
    const resource = randomUUID();
    const f = await setup([
      {
        id: resource,
        remote_url: 'https://github.com/example/node-test.git',
        remote_preparation: 'after_acceptance',
        default_branch: 'main',
      },
    ]);
    const a = await launch(f);
    const opened = await agent(a, 'open_workspace', { resource_id: resource });
    const op = await service.recoverOperation(f.runner, opened.result.operation_id!);
    const w = op.workspace!;
    const metadata = {
      generation: 1,
      storage_id: 'storage',
      lease_id: w.lease_id,
      repository_identity: w.resource.repository_identity,
      provider_metadata: { github: { repository_id: '42' } },
      base_commit: oid,
      target_branch: 'main',
      target_commit: tree,
      finalized_commit: oid,
    };
    await service.finishOperation(f.runner, f.incarnation, {
      operation_id: op.operation_id,
      attempt_id: a.dispatch.attempt_id,
      success: true,
      result: {
        workspace_id: w.workspace_id,
        path: '/runner/worktree',
        instruction_files: [],
        workspace_metadata: metadata,
      },
    });
    return { f, a, resource, metadata, w };
  }
  async function failedCompletion(w: Awaited<ReturnType<typeof workspace>>) {
    const c = await agent(w.a, 'complete_node', { summary: 'Complete exact tree' });
    await service.finishOperation(w.f.runner, w.f.incarnation, {
      operation_id: c.result.operation_id!,
      attempt_id: w.a.dispatch.attempt_id,
      success: false,
      failure_kind: 'invalid_finalization',
      result: { writer_absent: true, message: 'ancestry differs' },
    });
    return c;
  }
  async function recovery(w: Awaited<ReturnType<typeof workspace>>, mode: 'correct' | 'retry', operationId?: string) {
    const status = await execution.status(token, w.f.task, w.f.node);
    const op = status.operations.find(
      (o) => o.operation_id === operationId || (!operationId && o.kind === 'complete_node')
    )!;
    return owner(w.f.task, 'recover_completion', {
      node_id: w.f.node,
      node_activation: 1,
      source_id: status.source!.source_id,
      operation_id: op.operation_id,
      completion_identity_digest: op.completion_identity_digest!,
      mode,
    });
  }
  it('hard failure explicitly re-admits same completion identity and retains original manifest/receipt', async () => {
    const w = await workspace();
    const c = await failedCompletion(w);
    const before = await service.recoverOperation(w.f.runner, c.result.operation_id!);
    const retry = await recovery(w, 'retry');
    expect(retry.result.operation_id).toBe(before.operation_id);
    const after = await service.recoverOperation(w.f.runner, before.operation_id);
    expect(after).toEqual({ ...before, state: 'admitted' });
    await service.finishOperation(w.f.runner, w.f.incarnation, {
      operation_id: before.operation_id,
      attempt_id: w.a.dispatch.attempt_id,
      success: true,
      result: {
        writer_absent: true,
        workspace_id: w.w.workspace_id,
        workspace_metadata: { ...w.metadata, finalized_commit: commit },
        git_commit: commit,
        git_tree: tree,
      },
    });
    expect((await execution.status(token, w.f.task, w.f.node)).state).toBe('COMPLETED');
    expect((await service.admit(w.a.credential, submission(c.command))).status).toBe('committed');
  }, 20000);
  it('trusted cancelled pair preserves original lease pointer and checkpoint before fresh same-activation correction', async () => {
    const w = await workspace();
    const c = await failedCompletion(w);
    const decision = await recovery(w, 'correct');
    const settlement = await service.recoverOperation(w.f.runner, decision.result.operation_id!);
    const nested = {
      operation_id: c.result.operation_id!,
      attempt_id: w.a.dispatch.attempt_id,
      success: false,
      cancelled_by_operation_id: settlement.operation_id,
      result: { writer_absent: true },
    };
    await expect(service.finishOperation(w.f.runner, w.f.incarnation, nested)).rejects.toMatchObject(
      fault('unmet_precondition')
    );
    const pair = {
      operation_id: settlement.operation_id,
      attempt_id: w.a.dispatch.attempt_id,
      success: true,
      result: {
        writer_absent: true,
        workspace_id: w.w.workspace_id,
        workspace_metadata: {
          ...w.metadata,
          checkpoint: {
            operation_id: settlement.operation_id,
            head_commit: commit,
            tree_id: tree,
            commit_id: commit,
            completion_operation_id: c.result.operation_id!,
            completion_identity_digest: settlement.completion_identity_digest!,
          },
        },
      },
      completion_settlement: {
        completion_operation_id: c.result.operation_id!,
        disposition: 'cancelled' as const,
        completion_result: nested,
      },
    };
    await service.finishOperation(w.f.runner, w.f.incarnation, pair);
    await service.finishOperation(w.f.runner, w.f.incarnation, pair);
    await service.finishOperation(w.f.runner, w.f.incarnation, nested);
    const lease = (await db.pool.query('SELECT * FROM workspace_leases WHERE id=$1', [w.w.lease_id])).rows[0];
    expect(lease.settle_operation_id).toBe(c.result.operation_id);
    expect(lease.state).toBe('released');
    expect(lease.checkpoint.completion_operation_id).toBe(c.result.operation_id);
    const diagnostics = await attemptWorkspace(db, token, w.f.task, w.a.dispatch.attempt_id);
    expect(diagnostics.workspaces[0]).toMatchObject({
      lease_state: 'released', settle_operation_id: c.result.operation_id, settle_state: 'cancelled',
      metadata_operation_id: settlement.operation_id,
      metadata: pair.result.workspace_metadata,
    });
    expect(diagnostics.workspaces[0]!.metadata!.checkpoint!.operation_id).toBe(settlement.operation_id);
    const status = await execution.status(token, w.f.task, w.f.node);
    expect(status).toMatchObject({ node_activation: 1, state: 'PENDING', manifest: null });
    expect(status.source!.source_id).not.toBe(w.a.dispatch.node_execution_source!.source_id);
    const next = await launch(w.f);
    await expect(agent(next, 'complete_node', { summary: 'Skip dirty checkpoint' })).rejects.toMatchObject(
      fault('unmet_precondition')
    );
    expect(next.dispatch.prompt).toContain('invalid_finalization');
    expect((await service.recoverOperation(w.f.runner, c.result.operation_id!)).state).toBe('cancelled');
    await expect(
      service.finishOperation(w.f.runner, w.f.incarnation, { ...pair, result: { writer_absent: true } })
    ).rejects.toMatchObject(fault('payload_conflict'));
  }, 20000);
  it('already finalized pair wins correction race without another source and derives REVIEW after both effects settle', async () => {
    const w = await workspace();
    const c = await failedCompletion(w);
    const decision = await recovery(w, 'correct');
    const pair = {
      operation_id: decision.result.operation_id!,
      attempt_id: w.a.dispatch.attempt_id,
      success: true,
      result: { writer_absent: true },
      completion_settlement: {
        completion_operation_id: c.result.operation_id!,
        disposition: 'already_finalized' as const,
        completion_result: {
          operation_id: c.result.operation_id!,
          attempt_id: w.a.dispatch.attempt_id,
          success: true,
          result: {
            writer_absent: true,
            workspace_id: w.w.workspace_id,
            workspace_metadata: { ...w.metadata, finalized_commit: commit },
            git_commit: commit,
            git_tree: tree,
          },
        },
      },
    };
    await service.finishOperation(w.f.runner, w.f.incarnation, pair);
    expect((await execution.status(token, w.f.task, w.f.node)).state).toBe('COMPLETED');
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [w.f.task])).rows[0].state).toBe('REVIEW');
    expect((await attemptWorkspace(db, token, w.f.task, w.a.dispatch.attempt_id)).workspaces[0]).toMatchObject({
      lease_state: 'released', settle_operation_id: c.result.operation_id, settle_state: 'succeeded',
      metadata_operation_id: c.result.operation_id,
      metadata: pair.completion_settlement.completion_result.result.workspace_metadata,
    });
    expect((await db.pool.query('SELECT 1 FROM node_execution_outbox')).rowCount).toBe(1);
  }, 20000);
  it('Cancel during hard completion uses exact pair and never creates successor/current evidence', async () => {
    const w = await workspace();
    const c = await failedCompletion(w);
    const cancelled = await owner(w.f.task, 'cancel_task', { specification_id: w.f.spec, plan_id: w.f.plan });
    const settlement = await service.recoverOperation(w.f.runner, cancelled.result.operation_id!);
    await service.finishOperation(w.f.runner, w.f.incarnation, {
      operation_id: settlement.operation_id,
      attempt_id: w.a.dispatch.attempt_id,
      success: false,
      failure_kind: 'capture_hard_limit',
      result: { writer_absent: true },
    });
    const cleanupRetry = await recovery(w, 'retry', settlement.operation_id);
    expect(cleanupRetry.result.operation_id).toBe(settlement.operation_id);
    const nested = {
      operation_id: c.result.operation_id!,
      attempt_id: w.a.dispatch.attempt_id,
      success: false,
      cancelled_by_operation_id: settlement.operation_id,
      result: { writer_absent: true },
    };
    await service.finishOperation(w.f.runner, w.f.incarnation, {
      operation_id: settlement.operation_id,
      attempt_id: w.a.dispatch.attempt_id,
      success: true,
      result: {
        writer_absent: true,
        workspace_id: w.w.workspace_id,
        workspace_metadata: {
          ...w.metadata,
          checkpoint: {
            operation_id: settlement.operation_id,
            head_commit: commit,
            tree_id: tree,
            commit_id: commit,
            completion_operation_id: c.result.operation_id!,
            completion_identity_digest: settlement.completion_identity_digest!,
          },
        },
      },
      completion_settlement: {
        completion_operation_id: c.result.operation_id!,
        disposition: 'cancelled',
        completion_result: nested,
      },
    });
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [w.f.task])).rows[0].state).toBe('CANCELLED');
    expect((await db.pool.query('SELECT 1 FROM node_completions')).rowCount).toBe(0);
    expect((await attemptWorkspace(db, token, w.f.task, w.a.dispatch.attempt_id)).workspaces[0]).toMatchObject({
      lease_state: 'released', settle_operation_id: c.result.operation_id, settle_state: 'cancelled',
      metadata_operation_id: settlement.operation_id,
      metadata: { checkpoint: { operation_id: settlement.operation_id, completion_operation_id: c.result.operation_id } },
    });
    expect((await db.pool.query('SELECT 1 FROM node_execution_outbox')).rowCount).toBe(1);
    expect((await execution.status(token, w.f.task, w.f.node)).attempt!.process_released).toBe(true);
  }, 20000);
  it('settlement failure and explicit same-ID repair keep physical ownership and original blocking cause', async () => {
    const w = await workspace();
    const c = await failedCompletion(w);
    const decision = await recovery(w, 'correct');
    for (const failure_kind of ['recoverable', 'capture_hard_limit', 'recoverable'] as const)
      await service.finishOperation(w.f.runner, w.f.incarnation, {
        operation_id: decision.result.operation_id!,
        attempt_id: w.a.dispatch.attempt_id,
        success: false,
        failure_kind,
        result: { writer_absent: true, message: 'full' },
      });
    expect((await execution.status(token, w.f.task, w.f.node)).attempt!.process_released).toBe(false);
    expect(
      (await db.pool.query('SELECT failure_kind FROM operations WHERE id=$1', [decision.result.operation_id])).rows[0]
        .failure_kind
    ).toBe('capture_hard_limit');
    const retry = await recovery(w, 'retry', decision.result.operation_id);
    expect(retry.result.operation_id).toBe(decision.result.operation_id);
    expect(
      (await db.pool.query('SELECT failure_kind FROM operations WHERE id=$1', [c.result.operation_id])).rows[0]
        .failure_kind
    ).toBe('invalid_finalization');
  }, 20000);
  it('rejects fake Git fields on repository-free completion and receipt fault rolls back frozen manifest/fence', async () => {
    const f = await setup();
    const a = await launch(f);
    await db.pool.query(
      "CREATE FUNCTION reject_node_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_name='complete_node' THEN RAISE EXCEPTION 'receipt fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_node_receipt BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION reject_node_receipt()"
    );
    await expect(agent(a, 'complete_node', { summary: 'Done' })).rejects.toThrow('receipt fault');
    expect((await db.pool.query('SELECT 1 FROM completion_manifests')).rowCount).toBe(0);
    expect(
      (await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0]
        .mutation_allowed
    ).toBe(true);
    await db.pool.query('DROP TRIGGER reject_node_receipt ON command_receipts');
    const c = await agent(a, 'complete_node', { summary: 'Done' });
    await expect(
      service.finishOperation(f.runner, f.incarnation, {
        operation_id: c.result.operation_id!,
        attempt_id: a.dispatch.attempt_id,
        success: true,
        result: { writer_absent: true, git_commit: commit, git_tree: tree },
      })
    ).rejects.toMatchObject(fault('denied_scope'));
    expect((await execution.status(token, f.task, f.node)).attempt!.process_released).toBe(false);
  }, 20000);

  it('independent processes contend on canonical Task and retain one source/Attempt across restart', async () => {
    const f = await setup();
    const barrier = await db.pool.connect();
    const barrierPid = Number((await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid);
    const peers = [
      new Worker(databaseUrl, new URL('./fixtures/node-execution-worker.ts', import.meta.url)),
      new Worker(databaseUrl, new URL('./fixtures/node-execution-worker.ts', import.meta.url)),
    ];
    workers.push(...peers);
    const ready = await Promise.all(peers.map((w) => w.next('ready')));
    expect(new Set([barrierPid, ...ready.map((r) => r.pid)]).size).toBe(3);
    try {
      await barrier.query('BEGIN');
      await barrier.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [f.task]);
      for (const peer of peers) peer.send({ instance: service.instanceId });
      await expect
        .poll(
          async () =>
            Number(
              (
                await admin.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",
                  [ready.map((r) => r.pid)]
                )
              ).rows[0].count
            ),
          { timeout: 8000 }
        )
        .toBe(2);
      await barrier.query('COMMIT');
      for (const peer of peers) expect((await peer.next('done', 'failed')).type).toBe('done');
    } finally {
      await barrier.query('ROLLBACK');
      barrier.release();
    }
    await new NodeExecution(db, service.instanceId).pump();
    expect((await db.pool.query('SELECT 1 FROM node_execution_outbox')).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM attempts WHERE kind='node'")).rowCount).toBe(1);
    const a = await launch(f);
    expect(
      (await db.pool.query("SELECT 1 FROM outbox WHERE attempt_id=$1 AND kind='start'", [a.dispatch.attempt_id]))
        .rowCount
    ).toBe(1);
  }, 20000);
  it.each(['before', 'after'] as const)(
    'completion admission crash %s commit atomically preserves manifest, receipt and fence',
    async (phase) => {
      const f = await setup();
      const a = await launch(f);
      const command: CommandEnvelope = {
        schema_version: 1,
        request_id: randomUUID(),
        scope_id: f.task,
        expected_control_version: await version(f.task),
        name: 'complete_node',
        payload: { summary: 'Crash-bound complete', artifact_ids: [] },
      };
      const worker = new Worker(databaseUrl, new URL('./fixtures/admission-worker.ts', import.meta.url));
      workers.push(worker);
      await worker.next('ready');
      worker.send({ launch: a.dispatch, command, crash: phase });
      await worker.exited;
      expect(worker.child.signalCode).toBe('SIGKILL');
      expect(worker.messages).toEqual([]);
      const result = await service.recoverCommand(f.runner, a.dispatch.attempt_id, command.request_id);
      expect(result.status).toBe(phase === 'before' ? 'unknown' : 'admitted');
      expect((await db.pool.query('SELECT 1 FROM completion_manifests')).rowCount).toBe(phase === 'before' ? 0 : 1);
      expect(
        (await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0]
          .mutation_allowed
      ).toBe(phase === 'before');
      const incarnation = await service.connect(f.runner, 'node-test');
      await service.touch(f.runner, incarnation, true);
      if (phase === 'before') {
        const grant = await service.authorize(f.runner, incarnation, a.dispatch.dispatch_id);
        expect((await service.admit(grant!.credential, submission(command))).status).toBe('admitted');
      }
      expect((await db.pool.query('SELECT 1 FROM completion_manifests')).rowCount).toBe(1);
    },
    20000
  );
  it('database rejects missing no-resource marker, partial settlement fields and forged manifest authority', async () => {
    const f = await setup();
    const a = await launch(f);
    await expect(
      db.pool.query(
        "INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state) VALUES($1,$2,1,'complete_node',$3,'admitted')",
        [randomUUID(), a.dispatch.attempt_id, randomUUID()]
      )
    ).rejects.toMatchObject({ code: '23514' });
    const stopId = randomUUID();
    await expect(
      db.pool.query(
        "INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,completion_identity_digest) VALUES($1,$2,1,'stop',$3,'admitted',$4)",
        [stopId, a.dispatch.attempt_id, randomUUID(), 'a'.repeat(64)]
      )
    ).rejects.toMatchObject({ code: '23514' });
    await expect(agent(a, 'complete_node', { summary: '中'.repeat(100000) })).rejects.toMatchObject(
      fault('invalid_input')
    );
    await expect(
      agent(a, 'publish_artifact', {
        artifact_id: randomUUID(),
        title: 'Encoded budget',
        content: { text: '\u0001'.repeat(174000), media_type: 'text/plain' },
      })
    ).rejects.toMatchObject(fault('invalid_input'));
  }, 20000);
  it.each([
    ['publish_artifact', 'complete_node'],
    ['complete_node', 'publish_artifact'],
    ['publish_artifact', 'block_node'],
    ['block_node', 'publish_artifact'],
    ['block_node', 'complete_node'],
    ['complete_node', 'block_node'],
    ['stop_node', 'complete_node'],
    ['complete_node', 'stop_node'],
  ])(
    'observed independent terminal contention: %s before %s',
    async (first, second) => {
      const f = await setup();
      const a = await launch(f);
      const before = await version(f.task);
      const source = a.dispatch.node_execution_source!.source_id;
      const artifactId = randomUUID();
      const make = (name: string) => ({
        schema_version: 1,
        request_id: randomUUID(),
        scope_id: f.task,
        expected_control_version: before,
        name,
        payload:
          name === 'publish_artifact'
            ? { artifact_id: artifactId, title: 'Race output', content: { text: 'body', media_type: 'text/plain' } }
            : name === 'stop_node'
              ? { node_id: f.node, node_activation: 1, source_id: source }
              : name === 'block_node'
                ? { reason: 'Need input' }
                : { summary: 'Done' },
      });
      const commands = [make(first!), make(second!)];
      const peers = commands.map(
        () => new Worker(databaseUrl, new URL('./fixtures/node-command-worker.ts', import.meta.url))
      );
      workers.push(...peers);
      const ready = await Promise.all(peers.map((w) => w.next('ready')));
      const barrier = await db.pool.connect();
      const barrierPid = Number((await barrier.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      expect(new Set([barrierPid, ...ready.map((row) => row.pid)]).size).toBe(3);
      try {
        await barrier.query('BEGIN');
        await barrier.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [f.runner]);
        for (let index = 0; index < peers.length; index++) {
          peers[index]!.send({
            instance: service.instanceId,
            key,
            token: commands[index]!.name === 'stop_node' ? token : a.credential,
            command: commands[index],
            owner: commands[index]!.name === 'stop_node',
          });
          await expect
            .poll(
              async () => {
                const row = (
                  await admin.pool.query(
                    'SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',
                    [ready[index]!.pid]
                  )
                ).rows[0];
                return (
                  row?.wait_event_type === 'Lock' &&
                  (row.blockers.includes(barrierPid) || row.blockers.includes(ready[0]!.pid))
                );
              },
              { timeout: 8000 }
            )
            .toBe(true);
        }
        await barrier.query('COMMIT');
        const outcomes = await Promise.all(peers.map((peer) => peer.next('done', 'rejected')));
        expect(outcomes[0]!.type).toBe('done');
        expect(outcomes[1]!.type).toBe(first === 'publish_artifact' ? 'done' : 'rejected');
        expect(outcomes.some((result) => result.code === 'unexpected_error')).toBe(false);
      } finally {
        await barrier.query('ROLLBACK');
        barrier.release();
      }
      const operations = (
        await db.pool.query("SELECT kind FROM operations WHERE attempt_id=$1 AND kind IN ('complete_node','stop')", [
          a.dispatch.attempt_id,
        ])
      ).rows;
      expect(operations).toHaveLength(1);
      expect((await db.pool.query('SELECT 1 FROM artifacts WHERE id=$1', [artifactId])).rowCount).toBe(
        first === 'publish_artifact' ? 1 : 0
      );
      if (first === 'publish_artifact' && second === 'complete_node')
        expect((await db.pool.query('SELECT artifact_ids FROM completion_manifests')).rows[0].artifact_ids).toEqual([
          artifactId,
        ]);
    },
    25000
  );
  it('waiting source retains exact Project reservations across configuration changes', async () => {
    const f = await setup();
    await service.disconnect(f.runner, f.incarnation);
    await execution.pump();
    const initial = (await db.pool.query('SELECT context FROM node_execution_outbox')).rows[0].context;
    const configuration = new Configuration(db);
    const snapshot = await configuration.read(token);
    const project = snapshot.projects.find((p) => p.id === f.project)!;
    await configuration.save(token, {
      schema_version: 1,
      request_id: randomUUID(),
      expected_control_version: snapshot.control_version,
      name: 'save_project',
      payload: {
        ...project,
        resources: [
          {
            id: randomUUID(),
            remote_url: 'https://github.com/example/new.git',
            remote_preparation: 'after_acceptance',
          },
        ],
      },
    });
    f.incarnation = await service.connect(f.runner, 'node-test');
    await service.touch(f.runner, f.incarnation, true, [
      {
        runtime_id: 'opencode',
        executable: '/opencode',
        availability: 'detected',
        supports_model: true,
        supports_thinking: false,
        model_ids: [],
      },
    ]);
    const a = await launch(f);
    expect(a.dispatch.workspace_reservations).toEqual(initial.workspace_reservations);
    expect(a.dispatch.workspace_reservations!.resources).toEqual([]);
    expect(JSON.parse(a.dispatch.prompt).project.resources).toEqual([]);
  }, 20000);
  it('database manifest guards reject cross-Attempt operation, unselected scope and digest mismatch', async () => {
    const first = await setup();
    const a = await launch(first);
    const second = await setup();
    const b = await launch(second);
    const output = randomUUID();
    await agent(b, 'publish_artifact', {
      artifact_id: output,
      title: 'Other Task output',
      content: { text: 'body', media_type: 'text/plain' },
    });
    const source = (await db.pool.query('SELECT * FROM node_execution_outbox WHERE task_id=$1', [first.task])).rows[0];
    for (const variant of ['wrong_attempt', 'wrong_artifact', 'wrong_digest'])
      await expect(
        transaction(db, async (tx) => {
          const op = randomUUID();
          const hash = 'a'.repeat(64);
          const attemptId = variant === 'wrong_attempt' ? b.dispatch.attempt_id : a.dispatch.attempt_id;
          await tx.query(
            "INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,repository_free,completion_manifest_digest) VALUES($1,$2,1,'complete_node',$3,'admitted',true,$4)",
            [op, attemptId, randomUUID(), hash]
          );
          await tx.query(
            'INSERT INTO completion_manifests(operation_id,task_id,node_id,node_activation,attempt_id,source_id,specification_id,plan_id,summary,artifact_ids,content_digest) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)',
            [
              op,
              first.task,
              first.node,
              a.dispatch.attempt_id,
              source.id,
              first.spec,
              first.plan,
              'Bad attribution',
              JSON.stringify(variant === 'wrong_artifact' ? [output] : []),
              variant === 'wrong_digest' ? 'b'.repeat(64) : hash,
            ]
          );
        })
      ).rejects.toMatchObject({ code: '23514' });
  }, 25000);
  it('canonical Attempt-only controls cannot bypass durable source recovery', async () => {
    const f = await setup();
    const a = await launch(f);
    await expect(
      owner(f.task, 'stop_node', { attempt_id: a.dispatch.attempt_id, node_id: f.node, node_activation: 1 })
    ).rejects.toMatchObject(fault('denied_scope'));
    expect((await execution.status(token, f.task, f.node)).state).toBe('RUNNING');
  }, 20000);
  it('Auto placement without a Runner is durable waiting and creates no fake Attempt', async () => {
    await db.pool.query('UPDATE execution_policies SET policies=$1', [
      {
        global: {
          default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free' },
          fallback_targets: [],
        },
      },
    ]);
    const selected = await transaction(db, (tx) =>
      new RuntimeScheduling(queue, service.instanceId).selectAndEnqueue(tx, {
        attempt_id: 'unselected',
        task_id: 'task',
        node_id: 'node',
        kind: 'node',
        expected: { control_version: 1, specification_id: 'spec', plan_id: 'plan' },
        prompt: 'frozen',
        source_watermark: 0,
        node_execution_source: {
          source_id: 'source',
          node_id: 'node',
          node_activation: 1,
          specification_id: 'spec',
          plan_id: 'plan',
          control_version: 1,
          context_digest: 'a'.repeat(64),
        },
      })
    );
    expect(selected).toMatchObject({ status: 'unavailable', reason: 'runner_missing' });
    expect((await db.pool.query('SELECT 1 FROM attempts')).rowCount).toBe(0);
  }, 20000);
  it('never discovers arbitrary pending membership without canonical publication provenance', async () => {
    const f = await setup();
    const task = randomUUID(),
      spec = randomUUID(),
      plan = randomUUID(),
      node = randomUUID();
    await transaction(db, async (tx) => {
      await initializeTask(tx, {
        task_id: task,
        specification_id: spec,
        project_id: f.project,
        specification: 'Fixture only',
      });
      await tx.query('INSERT INTO plan_revisions(id,task_id,specification_id,content) VALUES($1,$2,$3,$4)', [
        plan,
        task,
        spec,
        { probe: true, node_ids: [node] },
      ]);
      await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node, task]);
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [
        task,
        plan,
        node,
        { node_id: node, role_id: f.role, goal: 'Do not auto-run', dependencies: [] },
      ]);
      await tx.query(
        "INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')",
        [task, node, spec, plan]
      );
      await tx.query("UPDATE tasks SET state='RUNNING',plan_id=$2 WHERE id=$1", [task, plan]);
    });
    await execution.pump();
    expect((await db.pool.query('SELECT 1 FROM node_execution_outbox WHERE task_id=$1', [task])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT 1 FROM attempts WHERE task_id=$1', [task])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT state FROM nodes WHERE id=$1', [node])).rows[0].state).toBe('PENDING');
  }, 20000);
});
