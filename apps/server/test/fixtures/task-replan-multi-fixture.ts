import { randomUUID } from 'node:crypto';
import type { ExecutionPlanNode, PrepareReplan, ReplanImpact, TaskReplanCommand } from '../../../../packages/protocol/src/index.ts';
import { TaskReplan } from '../../src/task-replan.ts';
import { TaskSpecification } from '../../src/task-specification.ts';
import { conversationFixture } from './task-conversation-fixture.ts';

export async function multiReplanFixture() {
  const x = await conversationFixture();
  const replan = new TaskReplan(x.db, {}, x.service.instanceId);
  const specification = new TaskSpecification(x.db);
  type Turn = Awaited<ReturnType<typeof x.promote>>;
  let nodeSequence = 0;
  const definition = (nodeId = `multi-${String(++nodeSequence).padStart(4, '0')}-${randomUUID()}`, dependencies: string[] = [], goal = 'Perform exact graph work'): ExecutionPlanNode =>
    ({ node_id: nodeId, role_id: x.f.role, goal, dependencies });
  const command = (name: TaskReplanCommand['name'], payload: unknown) => replan.command(x.token,
    { schema_version: 1, request_id: randomUUID(), task_id: x.f.task, name, payload });
  async function start(nodes: PrepareReplan['nodes']) {
    await x.owner('start_task', { specification_id: x.f.spec });
    await x.planning.pump();
    const turn = await x.promote();
    const result = await x.agent(turn, 'publish_execution_plan', {
      planning_intent_id: turn.dispatch.task_planning_source!.intent_id, plan_id: x.f.plan, nodes,
    });
    await x.finish(result.operation_id!, turn.dispatch.attempt_id);
  }
  async function complete(turn: Turn, summary = 'Exact repository-free result') {
    const result = await x.agent(turn, 'complete_node', { summary });
    await x.finish(result.operation_id!, turn.dispatch.attempt_id);
    return result;
  }
  async function request(turn?: Turn) {
    if (turn) {
      const result = await x.agent(turn, 'request_replan', { reason: 'The formal graph needs revision' });
      await x.finish(result.operation_id!, turn.dispatch.attempt_id);
      return result;
    }
    await x.send('Revise the insufficient formal graph');
    const planner = await x.turn();
    const result = await x.reply(planner, { kind: 'replan', basis: await x.basis(), text: 'Revise graph membership and applicability' });
    await x.finish(result.operation_id!, planner.dispatch.attempt_id);
    return result;
  }
  async function draft(nodes: PrepareReplan['nodes'], decide?: (impact: ReplanImpact) => void, joint = false) {
    await x.service.touch(x.f.runner, x.f.incarnation, true);
    await replan.pump();
    const turn = await x.promote();
    const source = JSON.parse(turn.dispatch.prompt) as { impact: ReplanImpact; basis: PrepareReplan['basis'] };
    const impact = structuredClone(source.impact);
    const targets: [string, ...string[]] = [nodes[0].node_id, ...nodes.slice(1).map(n => n.node_id)];
    for (const row of impact.nodes) if (!targets.includes(row.node_id)) {
      row.disposition = 'remove'; row.target_node_id = null; row.target_node_activation = null;
    }
    for (const row of impact.guidance) row.target_node_ids = [...targets];
    for (const row of impact.holds) row.target_node_ids = [...targets];
    for (const row of impact.workspaces) row.target_nodes = (row.input.kind === 'checkpoint' ? nodes.slice(0, 1) : nodes)
      .map(n => ({ node_id: n.node_id, node_activation: impact.nodes.find(old => old.node_id === n.node_id)?.target_node_activation ?? 1 }));
    decide?.(impact);
    const payload: PrepareReplan = {
      replan_request_id: turn.dispatch.task_replan_source!.request_id,
      source_id: turn.dispatch.task_replan_source!.source_id,
      proposal_id: randomUUID(), plan_id: randomUUID(), basis: source.basis,
      nodes, impact, summary: 'Publish explicitly scoped graph changes',
      ...(joint ? { requirement: { proposal_id: randomUUID(), specification: 'Revised full requirements for the multi-Node graph', summary: 'Joint requirements and graph change' } } : {}),
    };
    return { payload, turn };
  }
  async function submit(d: Awaited<ReturnType<typeof draft>>) {
    const result = await x.agent(d.turn, 'prepare_replan', d.payload);
    await x.finish(result.operation_id!, d.turn.dispatch.attempt_id);
    return { ...d, result };
  }
  async function prepare(nodes: PrepareReplan['nodes'], decide?: (impact: ReplanImpact) => void, joint = false) {
    return submit(await draft(nodes, decide, joint));
  }
  async function approve(p: Awaited<ReturnType<typeof prepare>>) {
    return command('confirm_replan', { proposal_id: p.payload.proposal_id, content_digest: p.result.result!.replan_outcome!.content_digest });
  }
  async function approveRequirement(p: Awaited<ReturnType<typeof prepare>>) {
    return specification.command(x.token, { schema_version: 1, request_id: randomUUID(), task_id: x.f.task,
      name: 'confirm_specification', payload: { proposal_id: p.payload.requirement!.proposal_id,
        content_digest: p.result.result!.replan_outcome!.requirement_content_digest } });
  }
  async function publish(p: Awaited<ReturnType<typeof prepare>>) {
    const graph = await approve(p);
    const requirement = p.payload.requirement ? await approveRequirement(p) : undefined;
    return command('publish_replan', { proposal_id: p.payload.proposal_id, confirmation_id: graph.confirmation_id,
      basis: p.payload.basis, ...(requirement ? { requirement_confirmation_id: requirement.confirmation_id } : {}) });
  }
  return { ...x, replan, specification, definition, command, start, complete, request, draft, submit, prepare, approve, approveRequirement, publish };
}
