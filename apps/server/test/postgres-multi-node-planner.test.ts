import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionPlanNode } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { TaskSpecification } from '../src/task-specification.ts';
import { TaskReviewCommands } from '../src/task-review-commands.ts';
import { TaskReviewReads } from '../src/task-review-reads.ts';
import { TaskReviewCoordinator } from '../src/task-review-coordinator.ts';
import { ownerReviewHooks } from '../src/owner-review-control.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-Node planning and correction', { timeout: 30000 }, () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let nodes: ExecutionPlanNode[];

  beforeEach(async () => {
    x = await conversationFixture();
    nodes = [
      { node_id: x.f.node, role_id: x.f.role, goal: 'Create shared output', dependencies: [] },
      { node_id: `multi-b-${randomUUID()}`, role_id: x.f.role, goal: 'Use shared output', dependencies: [x.f.node] },
      { node_id: `multi-c-${randomUUID()}`, role_id: x.f.role, goal: 'Independent output', dependencies: [] },
    ];
  }, 30000);
  afterEach(async () => { await x?.close(); }, 30000);

  async function planner() {
    await x.owner('start_task', { specification_id: x.f.spec });
    await x.planning.pump();
    return x.promote();
  }
  async function publish(a: Awaited<ReturnType<typeof x.promote>>, graph = nodes, requestId = randomUUID()) {
    return x.agent(a, 'publish_execution_plan', {
      planning_intent_id: a.dispatch.task_planning_source!.intent_id,
      plan_id: x.f.plan,
      nodes: [graph[0]!, ...graph.slice(1)],
    }, requestId);
  }
  async function start() {
    const a = await planner(), result = await publish(a);
    await x.finish(result.operation_id!, a.dispatch.attempt_id);
  }
  async function effects() {
    return (await x.db.pool.query(`SELECT
      (SELECT to_jsonb(t) FROM tasks t WHERE id=$1) task,
      (SELECT jsonb_agg(n ORDER BY id) FROM nodes n WHERE task_id=$1) nodes,
      (SELECT jsonb_agg(a ORDER BY id) FROM attempts a WHERE task_id=$1) attempts,
      (SELECT jsonb_agg(o ORDER BY id) FROM operations o WHERE attempt_id IN(SELECT id FROM attempts WHERE task_id=$1)) operations,
      (SELECT count(*) FROM requirement_proposals WHERE task_id=$1) proposals,
      (SELECT count(*) FROM requirement_obligations WHERE task_id=$1) obligations,
      (SELECT count(*) FROM requirement_changes WHERE task_id=$1) changes,
      (SELECT count(*) FROM task_command_proposals WHERE task_id=$1) command_proposals,
      (SELECT count(*) FROM authorization_receipts) authorizations,
      (SELECT count(*) FROM replan_requests WHERE task_id=$1) replans`, [x.f.task])).rows[0];
  }

  it('publishes the complete DAG once with repeated Role membership and exact receipt replay', async () => {
    const a = await planner(), request = randomUUID();
    const first = await publish(a, nodes, request);
    expect(await publish(a, nodes, request)).toEqual(first);
    expect(await x.planning.plan(x.token, x.f.task, x.f.plan)).toMatchObject({ nodes });
    expect((await x.db.pool.query('SELECT id,state,activation FROM nodes ORDER BY id')).rows).toEqual(nodes.map(n => ({ id: n.node_id, state: 'PENDING', activation: '1' })));
    expect((await x.db.pool.query("SELECT 1 FROM task_events WHERE kind='plan_published'")).rowCount).toBe(1);
    expect((await x.db.pool.query("SELECT 1 FROM operations WHERE kind='stop'")).rowCount).toBe(1);
  });

  it('rejects missing references, cycles, and consumes on a later Node while preserving a correctable Planner', async () => {
    const a = await planner();
    for (const graph of [
      nodes.map((n, i) => i === 1 ? { ...n, dependencies: ['missing-node'] } : n),
      nodes.map((n, i) => i === 0 ? { ...n, dependencies: [nodes[1]!.node_id] } : n),
    ]) await expect(publish(a, graph)).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
    await expect(publish(a, nodes.map((n, i) => i === 2 ? { ...n, consumes: ['unavailable-artifact'] } : n))).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect((await x.db.pool.query('SELECT 1 FROM plan_revisions')).rowCount).toBe(0);
    expect((await x.db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    expect((await publish(a)).status).toBe('committed');
  });

  it('checks active Project selection for every Node Role, including non-first Nodes', async () => {
    const a = await planner(), role = randomUUID(), config = new Configuration(x.db);
    const graph = nodes.map((n, i) => i === 2 ? { ...n, role_id: role } : n);
    await expect(publish(a, graph)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      name: 'save_role', payload: { id: role, name: 'Reviewer', description: 'Review', instructions: 'Review output', archived: false } });
    await expect(publish(a, graph)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Project', context: 'Task project', resources: [], role_ids: [x.f.role, role], archived: false } });
    await x.db.pool.query('UPDATE roles SET archived=true WHERE id=$1', [role]);
    await expect(publish(a, graph)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await x.db.pool.query('UPDATE roles SET archived=false WHERE id=$1', [role]);
    expect((await publish(a, graph)).status).toBe('committed');
  });

  it('retains complete Conversation impact and rejects multi-Node requirement mutation before effects', async () => {
    await start();
    const running = await x.node();
    const input = await x.send('Explain current progress'), turn = await x.turn();
    const read = await x.agent(turn, 'read_task_context', {});
    const context = JSON.parse(read.result!.task_context!.snapshot);
    expect(context.nodes.map((n: { id: string }) => n.id)).toEqual(nodes.map(n => n.node_id));
    expect(context.specification_impact.nodes.map((n: { node_id: string }) => n.node_id)).toEqual(nodes.map(n => n.node_id));
    const before = await effects(), basis = await x.basis();
    const proposal = { proposal_id: randomUUID(), specification: 'Changed complete requirement', summary: 'Change scope', basis,
      impact: context.specification_impact, source_input_ids: [input.input_id!] };
    for (const impact of [context.specification_impact, { ...context.specification_impact, nodes: context.specification_impact.nodes.slice(0, 1) }]) {
      await expect(x.agent(turn, 'prepare_specification_revision', { ...proposal, impact })).rejects.toThrow('unsupported_multi_node_specification_change');
      await expect(new TaskSpecification(x.db).command(x.token, { schema_version: 1, task_id: x.f.task, request_id: randomUUID(), name: 'edit_specification', payload: { ...proposal, impact } })).rejects.toThrow('unsupported_multi_node_specification_change');
    }
    expect(await effects()).toEqual(before);
    const reply = await x.reply(turn);
    await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
    expect(await x.version()).toBe(basis.control_version);
    expect((await x.db.pool.query('SELECT state,activation,execution_source_id FROM nodes WHERE id=$1', [running.dispatch.node_id])).rows[0]).toEqual({ state: 'RUNNING', activation: '1', execution_source_id: running.dispatch.node_execution_source!.source_id });
    const done = await x.agent(running, 'complete_node', { summary: 'Original execution remains authorized' });
    await x.finish(done.operation_id!, running.dispatch.attempt_id);
  });

  it.each(['upstream', 'leaf'] as const)('reactivates the requested %s subset and only its descendants with exact Review provenance', async (selection) => {
    await start();
    for (const n of nodes) {
      const a = await x.node();
      expect(a.dispatch.node_id).toBe(n.node_id);
      const artifact = randomUUID();
      await x.agent(a, 'publish_artifact', { artifact_id: artifact, title: `Result ${n.node_id}`, content: { text: n.goal, media_type: 'text/plain' } });
      const out = await x.agent(a, 'complete_node', { summary: n.goal, artifact_ids: [artifact] });
      await x.finish(out.operation_id!, a.dispatch.attempt_id);
    }
    const original = (await x.db.pool.query('SELECT * FROM node_completions ORDER BY node_id')).rows;
    const reads = new TaskReviewReads(x.db), commands = new TaskReviewCommands(x.db, ownerReviewHooks), coordinator = new TaskReviewCoordinator(x.db, x.service.instanceId, ownerReviewHooks);
    const current = await reads.task(x.token, x.f.task), feedback = randomUUID();
    await commands.command(x.token, { schema_version: 1, task_id: x.f.task, request_id: randomUUID(), name: 'request_changes', payload: { feedback_id: feedback, text: 'CORRECT_SELECTED_OUTPUT', basis: current.basis! } });
    await coordinator.pump();
    const a = await x.promote(), source = a.dispatch.task_review_source!;
    const context = JSON.parse(a.dispatch.prompt);
    expect(context.manifest.outputs.map((n: { node_id: string }) => n.node_id)).toEqual(nodes.map(n => n.node_id));
    expect(JSON.parse(context.observation.snapshot).specification_impact.nodes).toHaveLength(3);
    const binding = { feedback_id: feedback, operation_id: source.operation_id, operation_version: source.operation_version, source_id: source.source_id },
      basis = { control_version: source.control_version, specification_id: source.specification_id, plan_id: source.plan_id };
    const before = await effects();
    await expect(x.agent(a, 'apply_review_rework', { ...binding, basis, node_ids: ['outside-plan'], reason: 'Invalid selection' })).rejects.toMatchObject({ detail: { code: 'denied_scope' } });
    await expect(x.agent(a, 'prepare_specification_revision', { proposal_id: randomUUID(), specification: 'Changed full scope', summary: 'Change', basis, impact: JSON.parse(context.observation.snapshot).specification_impact, source_input_ids: [] })).rejects.toThrow('unsupported_multi_node_specification_change');
    expect(await effects()).toEqual(before);
    const requested: [string] = [nodes[selection === 'upstream' ? 0 : 1]!.node_id], affected = selection === 'upstream' ? nodes.slice(0, 2) : [nodes[1]!];
    const payload = { ...binding, basis, node_ids: requested, reason: 'Improve selected output within the existing graph' }, request = randomUUID();
    const result = await x.agent(a, 'apply_review_rework', payload, request);
    expect(await x.agent(a, 'apply_review_rework', payload, request)).toEqual(result);
    expect((await x.db.pool.query('SELECT body FROM task_review_resolutions WHERE operation_id=$1', [source.operation_id])).rows[0].body).toMatchObject({ node_ids: requested, affected_node_ids: affected.map(n => n.node_id) });
    expect((await x.db.pool.query('SELECT id,state,activation FROM nodes ORDER BY id')).rows).toEqual(nodes.map(n => ({ id: n.node_id, state: affected.includes(n) ? 'PENDING' : 'COMPLETED', activation: affected.includes(n) ? '2' : '1' })));
    expect((await x.db.pool.query('SELECT * FROM node_completions ORDER BY node_id')).rows).toEqual(original);
    await x.finish(result.operation_id!, a.dispatch.attempt_id);
    await expect.poll(async () => { await coordinator.pump(); return (await x.db.pool.query('SELECT settlement_pending FROM task_review_operations WHERE id=$1', [source.operation_id])).rows[0].settlement_pending; }, { timeout: 5000 }).toBe(false);
    for (const n of affected) {
      const next = await x.node();
      expect(next.dispatch.node_id).toBe(n.node_id);
      expect(next.dispatch.node_activation).toBe(2);
      expect(JSON.parse(next.dispatch.prompt).review_rework).toEqual([expect.objectContaining({ feedback_id: feedback, text: 'CORRECT_SELECTED_OUTPUT', node_id: n.node_id, node_activation: 2, routing_request_id: request })]);
      const out = await x.agent(next, 'complete_node', { summary: 'Corrected output' });
      await x.finish(out.operation_id!, next.dispatch.attempt_id);
    }
    const unaffected = nodes.filter(n => !affected.includes(n));
    for (const n of unaffected) expect((await x.db.pool.query('SELECT node_activation,context FROM node_execution_outbox WHERE node_id=$1', [n.node_id])).rows).toEqual([expect.objectContaining({ node_activation: '1', context: expect.objectContaining({ review_rework: [] }) })]);
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
  });
});
