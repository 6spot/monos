import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { assertNodeSource, inspectNodeRuntimeFallback } from '../src/node-execution-state.ts';
import { NodeRework } from '../src/node-rework.ts';
import type { RuntimePredecessor } from '../src/runtime-continuation-state.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Upstream Rework execution guards', () => {
  let x: Awaited<ReturnType<typeof conversationFixture>>;
  let rework: NodeRework;
  let downstream: string;
  let independent: string;

  beforeEach(async () => {
    x = await conversationFixture();
    rework = new NodeRework(x.db);
    downstream = `serial-b-${randomUUID()}`;
    independent = `serial-c-${randomUUID()}`;
    await x.owner('start_task', { specification_id: x.f.spec });
    await x.planning.pump();
    const planner = await x.promote();
    const outcome = await x.agent(planner, 'publish_execution_plan', {
      planning_intent_id: planner.dispatch.task_planning_source!.intent_id,
      plan_id: x.f.plan,
      nodes: [
        { node_id: x.f.node, role_id: x.f.role, goal: 'Produce upstream evidence', dependencies: [] },
        { node_id: downstream, role_id: x.f.role, goal: 'Check and use upstream evidence', dependencies: [x.f.node] },
        { node_id: independent, role_id: x.f.role, goal: 'Independent result', dependencies: [] },
      ],
    });
    await x.finish(outcome.operation_id!, planner.dispatch.attempt_id);
    // Keep the unrelated branch available for later Owner Continue while each
    // Rework request exercises its conservative sibling-settlement precondition.
    await x.execution.pump();
    const status = await x.execution.status(x.token, x.f.task, independent);
    await x.owner('stop_node', { node_id: independent, node_activation: status.node_activation, source_id: status.source!.source_id });
  });
  afterEach(async () => { await x?.close(); });

  async function complete(attempt: Awaited<ReturnType<typeof x.promote>>, summary: string) {
    const result = await x.agent(attempt, 'complete_node', { summary });
    await x.finish(result.operation_id!, attempt.dispatch.attempt_id);
    return result;
  }

  async function resumeIndependent() {
    const status = await x.execution.status(x.token, x.f.task, independent);
    await x.owner('continue_node', { node_id: independent, node_activation: status.node_activation, source_id: status.source!.source_id, blocker_id: status.blocker!.id });
    await x.db.pool.query('UPDATE runners SET capacity=1 WHERE id=$1', [x.f.runner]);
  }

  async function launchRequester() {
    const upstream = await x.node();
    expect(upstream.dispatch.node_id).toBe(x.f.node);
    const completion = await complete(upstream, `Upstream activation ${upstream.dispatch.node_activation}`);
    const requester = await x.node();
    expect(requester.dispatch.node_id).toBe(downstream);
    return { requester, completion };
  }

  async function unresolved() {
    return (await x.db.pool.query("SELECT * FROM node_rework_requests WHERE task_id=$1 AND status IN ('settling','limit_blocked')", [x.f.task])).rows[0]!;
  }

  async function reachLimit() {
    let launched = await launchRequester();
    for (let i = 0; i < 3; i++) {
      const result = await x.agent(launched.requester, 'request_rework', { reason: `Automatic correction ${i + 1}` });
      await x.finish(result.operation_id!, launched.requester.dispatch.attempt_id);
      await rework.pump();
      launched = await launchRequester();
    }
    const result = await x.agent(launched.requester, 'request_rework', { reason: 'PRESERVED_FOURTH_CORRECTION' });
    await x.finish(result.operation_id!, launched.requester.dispatch.attempt_id);
    return unresolved();
  }

  it('fences the old source immediately, preserves receipt replay, and injects exact historical context only after settlement', async () => {
    const { requester, completion } = await launchRequester();
    const draft = randomUUID();
    await x.agent(requester, 'publish_artifact', { artifact_id: draft, title: 'Unfinished requester draft', content: { text: 'Not current evidence', media_type: 'text/plain' } });
    const requestId = randomUUID();
    const result = await x.agent(requester, 'request_rework', { reason: 'UPSTREAM_CORRECTION_REQUIRED' }, requestId);
    const request = await unresolved();
    expect(request.status).toBe('settling');
    await expect(x.owner('stop_node', { node_id: downstream, node_activation: requester.dispatch.node_activation,
      source_id: requester.dispatch.node_execution_source!.source_id })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ guidance_paused: false, blocker: null });
    expect(await x.agent(requester, 'request_rework', { reason: 'UPSTREAM_CORRECTION_REQUIRED' }, requestId)).toEqual(result);
    await expect(x.agent(requester, 'complete_node', { summary: 'Old activation cannot complete' })).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    await expect(transaction(x.db, tx => assertNodeSource(tx, x.f.task, requester.dispatch.node_execution_source!, requester.dispatch.attempt_id, requester.dispatch.prompt))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
    const predecessor = (await x.db.pool.query<RuntimePredecessor>('SELECT * FROM attempts WHERE id=$1', [requester.dispatch.attempt_id])).rows[0]!;
    expect(await transaction(x.db, tx => inspectNodeRuntimeFallback(tx, predecessor))).toEqual({ status: 'superseded', reason: 'node_rework_owned' });
    await rework.pump();
    await x.execution.pump();
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=ANY($1::text[])', [[x.f.node, downstream]])).rowCount).toBe(2);
    expect((await unresolved()).status).toBe('settling');
    await x.finish(result.operation_id!, requester.dispatch.attempt_id);
    await rework.pump();
    const corrected = await x.node();
    expect(corrected.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 2 });
    const context = JSON.parse(corrected.dispatch.prompt);
    expect(context.upstream_outputs.items).toEqual([]);
    expect(context.node_rework).toEqual([expect.objectContaining({
      rework_request_id: request.id, reason: 'UPSTREAM_CORRECTION_REQUIRED', target_node_id: x.f.node,
      requester_node_id: downstream, requester_activation: 1, owner_decision: null,
      affected_nodes: expect.arrayContaining([
        expect.objectContaining({ node_id: x.f.node, prior_activation: 1, node_activation: 2, completion_operation_id: completion.operation_id }),
        expect.objectContaining({ node_id: downstream, prior_activation: 1, node_activation: 2, completion_operation_id: null }),
      ]),
    })]);
    expect(context.node_rework[0].affected_nodes).toHaveLength(2);
    expect(corrected.dispatch.prompt).not.toContain(draft);
    expect((await x.db.pool.query('SELECT activation FROM node_completions WHERE node_id=$1', [x.f.node])).rows).toEqual([{ activation: '1' }]);
    await complete(corrected, 'Corrected upstream current evidence');
    const dependent = await x.node();
    expect(JSON.parse(dependent.dispatch.prompt).upstream_outputs.items).toEqual([expect.objectContaining({ node_id: x.f.node, node_activation: 2, summary: 'Corrected upstream current evidence' })]);
    expect((await x.execution.status(x.token, x.f.task, independent)).node_activation).toBe(1);
  });

  it('keeps the limit-blocked request exact across generic Owner controls and independent work', async () => {
    const request = await reachLimit();
    expect(request.status).toBe('limit_blocked');
    const status = await x.execution.status(x.token, x.f.task, downstream);
    const target = { node_id: downstream, node_activation: status.node_activation, source_id: status.source!.source_id, blocker_id: status.blocker!.id };
    await expect(x.owner('retry_node', { ...target, answer: 'Generic Retry cannot reset the Rework limit' })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await expect(x.owner('continue_node', target)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await expect(x.owner('stop_node', { node_id: target.node_id, node_activation: target.node_activation, source_id: target.source_id })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ guidance_paused: false, blocker: status.blocker });
    await x.send('Keep the requester guidance while the Owner decides');
    const turn = await x.turn();
    const guided = await x.reply(turn, { kind: 'guidance', text: 'GUIDANCE_WAITS_FOR_REWORK_DECISION',
      basis: { ...await x.basis(), node_id: downstream, node_activation: status.node_activation, source_id: status.source!.source_id } });
    await x.finish(guided.operation_id!, turn.dispatch.attempt_id);
    await x.conversation.pump();
    expect((await unresolved()).id).toBe(request.id);
    expect((await x.execution.status(x.token, x.f.task, downstream)).source!.source_id).toBe(status.source!.source_id);
    await x.send('Also correct the completed ancestor without losing the preserved decision');
    const upstreamTurn = await x.turn();
    const upstreamGuidance = await x.reply(upstreamTurn, { kind: 'guidance', text: 'ANCESTOR_GUIDANCE_MUST_WAIT', basis: await x.basis() });
    await x.finish(upstreamGuidance.operation_id!, upstreamTurn.dispatch.attempt_id);
    await x.conversation.pump();
    expect(await x.execution.status(x.token, x.f.task, x.f.node)).toMatchObject({ state: 'COMPLETED', node_activation: 4, guidance_followup_pending: true });
    expect((await x.execution.status(x.token, x.f.task, downstream)).source!.source_id).toBe(status.source!.source_id);
    await resumeIndependent();
    const other = await x.node();
    expect(other.dispatch).toMatchObject({ node_id: independent, node_activation: 1 });
    const ownerRequest = randomUUID();
    await rework.command(x.token, { schema_version: 1, request_id: ownerRequest, scope_id: x.f.task,
      expected_control_version: await x.version(), name: 'apply_rework',
      payload: { rework_request_id: request.id, expected_version: Number(request.version), answer: 'OWNER_APPROVES_EXACT_CORRECTION' } });
    await rework.pump();
    await x.execution.pump();
    expect(await x.execution.status(x.token, x.f.task, x.f.node)).toMatchObject({ node_activation: 5, state: 'RUNNING', attempt: { state: 'QUEUED' } });
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    await complete(other, 'Independent source retains authority after Owner Rework decision');
    await rework.pump();
    const corrected = await x.node();
    expect(corrected.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 5 });
    expect(JSON.parse(corrected.dispatch.prompt).node_rework).toEqual([expect.objectContaining({
      rework_request_id: request.id, reason: 'PRESERVED_FOURTH_CORRECTION',
      owner_decision: expect.objectContaining({ request_id: ownerRequest, name: 'apply_rework', answer: 'OWNER_APPROVES_EXACT_CORRECTION' }),
    })]);
    expect(corrected.dispatch.prompt).toContain('ANCESTOR_GUIDANCE_MUST_WAIT');
    expect((await x.execution.status(x.token, x.f.task, independent))).toMatchObject({ state: 'COMPLETED', node_activation: 1 });
  });

  it('prevents completed-ancestor Continue from resetting a descendant with a preserved limit request', async () => {
    const request = await reachLimit();
    await x.send('Correct the completed ancestor after the pending Rework decision');
    const turn = await x.turn();
    const guidance = await x.reply(turn, { kind: 'guidance', text: 'Ancestor correction waiting for a decision', basis: await x.basis() });
    await x.finish(guidance.operation_id!, turn.dispatch.attempt_id);
    const ancestor = await x.execution.status(x.token, x.f.task, x.f.node);
    const target = { node_id: x.f.node, node_activation: ancestor.node_activation, source_id: ancestor.source!.source_id };
    await x.owner('stop_node', target);
    await expect(x.owner('continue_node', target)).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    expect(await x.execution.status(x.token, x.f.task, x.f.node)).toMatchObject({ state: 'COMPLETED', node_activation: 4, guidance_paused: true });
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ state: 'BLOCKED', node_activation: 4, source: { source_id: request.requester_source_id } });
    expect((await unresolved()).id).toBe(request.id);
  });

  it('retains the Owner continuation decision when independent work delays requester dispatch', async () => {
    const request = await reachLimit();
    await resumeIndependent();
    const other = await x.node();
    expect(other.dispatch.node_id).toBe(independent);
    const ownerRequest = randomUUID();
    await rework.command(x.token, { schema_version: 1, request_id: ownerRequest, scope_id: x.f.task,
      expected_control_version: await x.version(), name: 'continue_without_rework',
      payload: { rework_request_id: request.id, expected_version: Number(request.version), answer: 'CONTINUE_WITHOUT_APPLYING_THE_PROPOSAL' } });
    await x.execution.pump();
    expect(await x.execution.status(x.token, x.f.task, downstream)).toMatchObject({ node_activation: 4, state: 'RUNNING', attempt: { state: 'QUEUED' } });
    expect(await x.queue.promoteNext(x.f.runner, x.service.instanceId, x.f.incarnation)).toBeNull();
    await complete(other, 'Independent work settles before requester continuation');
    const continued = await x.node();
    expect(continued.dispatch).toMatchObject({ node_id: downstream, node_activation: 4 });
    expect(JSON.parse(continued.dispatch.prompt).node_rework).toContainEqual(expect.objectContaining({
      rework_request_id: request.id, status: 'continued', reason: 'PRESERVED_FOURTH_CORRECTION',
      owner_decision: expect.objectContaining({ request_id: ownerRequest, name: 'continue_without_rework', answer: 'CONTINUE_WITHOUT_APPLYING_THE_PROPOSAL' }),
    }));
    expect((await x.execution.status(x.token, x.f.task, x.f.node))).toMatchObject({ state: 'COMPLETED', node_activation: 4 });
    expect((await rework.status(x.token, x.f.task)).automatic_requests_used).toBe(3);
  });

  it('cancels the request without replacing its pending Stop or reviving the Task on late settlement', async () => {
    const { requester } = await launchRequester();
    const result = await x.agent(requester, 'request_rework', { reason: 'Correction before cancellation' });
    const request = await unresolved();
    await x.owner('cancel_task', { specification_id: x.f.spec, plan_id: x.f.plan });
    expect((await x.db.pool.query('SELECT status,(SELECT operation_id FROM node_rework_request_stops WHERE request_id=r.id) stop_operation_id FROM node_rework_requests r WHERE id=$1', [request.id])).rows[0]).toEqual({ status: 'cancelled', stop_operation_id: result.operation_id });
    expect((await x.db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [requester.dispatch.attempt_id])).rowCount).toBe(1);
    await x.finish(result.operation_id!, requester.dispatch.attempt_id);
    await rework.pump();
    await x.execution.pump();
    expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('CANCELLED');
    expect((await x.db.pool.query('SELECT id FROM attempts WHERE node_id=ANY($1::text[])', [[x.f.node, downstream]])).rowCount).toBe(2);
  });
});
