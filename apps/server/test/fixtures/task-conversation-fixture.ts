import { randomUUID } from 'node:crypto';
import { database, transaction } from '../../../../packages/db/src/index.ts';
import { migrate } from '../../../../packages/db/src/migrate.ts';
import { initializeTask } from '../../src/task-records.ts';
import { Configuration } from '../../src/configuration.ts';
import { issueOwnerSession, OwnerCommands } from '../../src/owner-commands.ts';
import { BoundaryService } from '../../src/service.ts';
import { TaskConversation } from '../../src/task-conversation.ts';
import { TaskPlanning } from '../../src/task-planning.ts';
import { NodeExecution } from '../../src/node-execution.ts';
import { DispatchQueue } from '../../src/dispatch-queue.ts';
import { enrollFixture } from '../../src/fixtures.ts';
import { submission } from '../../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, OwnerCommand } from '../../../../packages/protocol/src/index.ts';

export async function conversationFixture(options:{runnerCredential?:string}={}) {
  const base = new URL(process.env.DATABASE_URL!),
    admin = database(base.toString()),
    namespace = 'conversation_' + randomUUID().replaceAll('-', '');
  await admin.pool.query(`CREATE SCHEMA ${namespace}`);
  base.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
  const databaseUrl = base.toString(),
    db = database(databaseUrl);
  await migrate(db);
  const token = (await issueOwnerSession(db)).token,
    service = new BoundaryService(db, {
      signingKey: 'conversation-fixture-signing-key',
    }),
    conversation = new TaskConversation(db, service.instanceId),
    queue = new DispatchQueue(db),
    execution = new NodeExecution(db, service.instanceId),
    planning = new TaskPlanning(db, service.instanceId);
  const f = {
    task: randomUUID(),
    spec: randomUUID(),
    plan: randomUUID(),
    node: randomUUID(),
    role: randomUUID(),
    project: randomUUID(),
    runner: randomUUID(),
    incarnation: 0,
  };
  const config = new Configuration(db);
  await config.save(token, {
    schema_version: 1,
    request_id: randomUUID(),
    expected_control_version: (await config.read(token)).control_version,
    name: 'save_role',
    payload: {
      id: f.role,
      name: 'Builder',
      description: 'Build',
      instructions: 'Build exact result',
      archived: false,
    },
  });
  await config.save(token, {
    schema_version: 1,
    request_id: randomUUID(),
    expected_control_version: (await config.read(token)).control_version,
    name: 'save_project',
    payload: {
      id: f.project,
      name: 'Project',
      context: 'Task project',
      resources: [],
      role_ids: [f.role],
      archived: false,
    },
  });
  await transaction(db, (tx) =>
    initializeTask(tx, {
      task_id: f.task,
      specification_id: f.spec,
      project_id: f.project,
      specification: 'Build exact result',
    }),
  );
  await enrollFixture(db, f.runner, options.runnerCredential??randomUUID(), 2);
  f.incarnation = await service.connect(f.runner, 'conversation-test');
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
  await db.pool.query('UPDATE execution_policies SET policies=$1', [
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
  ]);
  const version = async () =>
    Number(
      (await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [f.task])).rows[0]
        .control_version,
    );
  const owner = async (name: OwnerCommand['name'], payload: object) =>
    new OwnerCommands(db).confirm(token, {
      schema_version: 1,
      request_id: randomUUID(),
      scope_id: f.task,
      expected_control_version: await version(),
      name,
      payload,
    });
  const send = async (content: string) =>
    conversation.command(token, {
      schema_version: 1,
      request_id: randomUUID(),
      task_id: f.task,
      name: 'submit_task_message',
      payload: { message_id: randomUUID(), content },
    });
  const promote = async () => {
    const dispatch = (await queue.promoteNext(f.runner, service.instanceId, f.incarnation))!;
    if (!dispatch) throw new Error('No dispatch');
    const grant = (await service.authorize(f.runner, f.incarnation, dispatch.dispatch_id))!;
    return { dispatch, credential: grant.credential };
  };
  const agent = async (
    a: { dispatch: Dispatch; credential: string },
    name: CommandEnvelope['name'],
    payload: CommandEnvelope['payload'],
    requestId: string = randomUUID(),
  ) =>
    service.admit(
      a.credential,
      submission({
        schema_version: 1,
        request_id: requestId,
        scope_id: f.task,
        expected_control_version: a.dispatch.control_version,
        name,
        payload,
      }),
    );
  const finish = async (operationId: string, attemptId: string) => {
    const operation = await service.recoverOperation(f.runner, operationId);
    return service.finishOperation(f.runner, f.incarnation, {
      operation_id: operationId,
      attempt_id: attemptId,
      success: true,
      result: operation.kind === 'complete_node'
        ? { writer_absent: true, completion_outcome: 'finalized', workspace_results: [] }
        : { writer_absent: true },
    });
  };
  const turn = async () => {
    await conversation.pump();
    return promote();
  };
  const reply = async (
    a: Awaited<ReturnType<typeof promote>>,
    routing: CommandEnvelope['payload']['routing'] = { kind: 'reply' },
    requestId?: string,
  ) =>
    agent(
      a,
      'commit_task_turn',
      {
        source_id: a.dispatch.task_conversation_source!.source_id,
        input_id: a.dispatch.task_conversation_source!.input_id,
        source_watermark: a.dispatch.source_watermark,
        reply: 'Canonical response',
        routing,
      },
      requestId,
    );
  const start = async () => {
    await owner('start_task', { specification_id: f.spec });
    await planning.pump();
    const a = await promote();
    const out = await agent(a, 'publish_execution_plan', {
      planning_intent_id: a.dispatch.task_planning_source!.intent_id,
      plan_id: f.plan,
      nodes: [
        {
          node_id: f.node,
          role_id: f.role,
          goal: 'Build exact result',
          dependencies: [],
        },
      ],
    });
    await finish(out.operation_id!, a.dispatch.attempt_id);
  };
  const node = async () => {
    await execution.pump();
    return promote();
  };
  const basis = async () => {
    const t = (await db.pool.query('SELECT * FROM tasks WHERE id=$1', [f.task])).rows[0],
      n = (await db.pool.query('SELECT * FROM nodes WHERE id=$1', [f.node])).rows[0];
    return {
      control_version: Number(t.control_version),
      specification_id: t.specification_id,
      plan_id: t.plan_id,
      ...(n
        ? {
            node_id: n.id,
            node_activation: Number(n.activation),
            source_id: n.execution_source_id,
          }
        : {}),
    };
  };
  return {
    db,
    admin,
    databaseUrl,
    token,
    service,
    conversation,
    queue,
    execution,
    planning,
    f,
    version,
    owner,
    send,
    promote,
    agent,
    finish,
    turn,
    reply,
    start,
    node,
    basis,
    close: async () => {
      await db.pool.end();
      await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`);
      await admin.pool.end();
    },
  };
}
