import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { WorkspaceMetadata } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { NodeRework } from '../src/node-rework.ts';
import { multiReplanFixture } from './fixtures/task-replan-multi-fixture.ts';

type Fixture = Awaited<ReturnType<typeof multiReplanFixture>>;
type Turn = Awaited<ReturnType<Fixture['promote']>>;

async function openedWorkspace(x: Fixture, turn: Turn, resource: string) {
  const result = await x.agent(turn, 'open_workspace', { resource_id: resource });
  const operation = await x.service.recoverOperation(x.f.runner, result.operation_id!), workspace = operation.workspace!;
  const metadata: WorkspaceMetadata = {
    generation: workspace.generation, lease_id: workspace.lease_id, storage_id: 'multi-replan-storage',
    repository_identity: workspace.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
    base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40),
    finalized_commit: workspace.transfer?.kind === 'checkpoint' ? workspace.transfer.metadata.finalized_commit : workspace.basis?.finalized_commit ?? 'a'.repeat(40),
    ...(workspace.isolation ? { isolation: { allocation_id: workspace.isolation.allocation_id,
      start_commit: workspace.transfer?.kind === 'checkpoint' ? workspace.transfer.metadata.isolation?.start_commit ?? workspace.transfer.metadata.finalized_commit : workspace.basis?.finalized_commit ?? 'a'.repeat(40) } } : {}),
  };
  await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id,
    success: true, result: { workspace_id: workspace.workspace_id, path: '/runner/worktree', instruction_files: [], workspace_metadata: metadata } });
  return { operation, workspace, metadata };
}

async function workspaceFixture(kind: 'checkpoint' | 'completed') {
  const x = await multiReplanFixture(), resource = randomUUID();
  try {
    const config = new Configuration(x.db);
    await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Project', context: 'Preserve private work',
        resources: [{ id: resource, remote_url: 'https://github.com/example/multi-replan.git', remote_preparation: 'after_acceptance', default_branch: 'main' }], role_ids: [x.f.role], archived: false } });
    const original = x.definition(x.f.node), sibling = x.definition();
    await x.start([original, sibling]);
    const turn = await x.node(), opened = await openedWorkspace(x, turn, resource);
    const stop = kind === 'checkpoint'
      ? await x.agent(turn, 'request_replan', { reason: 'Split private work across a revised graph' })
      : await x.agent(turn, 'complete_node', { summary: 'Original finalized repository work' });
    const settled: WorkspaceMetadata = kind === 'checkpoint'
      ? { ...opened.metadata, checkpoint: { operation_id: stop.operation_id!, head_commit: 'a'.repeat(40), tree_id: 'b'.repeat(40), commit_id: 'c'.repeat(40) } }
      : { ...opened.metadata, finalized_commit: 'c'.repeat(40) };
    const completion = kind === 'completed' ? await x.service.recoverOperation(x.f.runner, stop.operation_id!) : undefined;
    await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: stop.operation_id!, attempt_id: turn.dispatch.attempt_id,
      success: true, result: kind === 'checkpoint'
        ? { writer_absent: true, workspace_id: opened.workspace.workspace_id, workspace_metadata: settled }
        : { writer_absent: true, completion_outcome: 'finalized', workspace_results: [{ resource_id: resource,
          workspace_id: opened.workspace.workspace_id, workspace_metadata: settled,
          capture: { start_commit: opened.metadata.isolation?.start_commit ?? opened.metadata.finalized_commit, node_commit: 'c'.repeat(40), node_tree: 'b'.repeat(40) },
          git_commit: 'c'.repeat(40), git_tree: 'b'.repeat(40),
          ...(completion!.workspaces![0]!.integration ? { integration: { outcome: 'integrated' as const,
            start_commit: opened.metadata.isolation!.start_commit, expected_task_commit: completion!.workspaces![0]!.integration!.expected_task_commit,
            node_commit: 'c'.repeat(40), node_tree: 'b'.repeat(40), task_commit: 'c'.repeat(40), task_tree: 'b'.repeat(40) } } : {}) }] } });
    if (kind === 'completed') await x.request();
    return { ...x, resource, original, sibling, old: opened.workspace, settled, settlementId: stop.operation_id! };
  } catch (error) { await x.close(); throw error; }
}

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Multi-Node Replan workspace adoption', { timeout: 60000 }, () => {
  it('keeps a checkpoint bound to one unfinished target and creates its transfer only at the first exact open', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const free = x.definition(), adopter = x.definition(randomUUID(), [free.node_id]);
      const p = await x.prepare([free, adopter], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: adopter.node_id, node_activation: 1 }]; });
      await x.publish(p);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      const unrelated = await x.node(); expect(unrelated.dispatch.node_id).toBe(free.node_id);
      expect(unrelated.dispatch.workspace_reservations!.resources[0]!.isolation!.allocation_id).not.toBe(p.payload.impact.workspaces[0]!.input.metadata.isolation!.allocation_id);
      await x.complete(unrelated, 'Repository-free prerequisite');
      const target = await x.node(); expect(target.dispatch.node_id).toBe(adopter.node_id);
      await expect(x.agent(target, 'complete_node', { summary: 'Discard inherited checkpoint' })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      const requestId = randomUUID();
      const open = await x.agent(target, 'open_workspace', { resource_id: x.resource }, requestId);
      const operation = await x.service.recoverOperation(x.f.runner, open.operation_id!);
      expect(operation.workspace!.transfer).toMatchObject({ proposal_id: p.payload.proposal_id, from_lease_id: x.old.lease_id,
        from_node_id: x.original.node_id, to_node_id: adopter.node_id, to_node_activation: 1, kind: 'checkpoint', metadata: x.settled });
      expect((await x.agent(target, 'open_workspace', { resource_id: x.resource }, requestId)).operation_id).toBe(open.operation_id);
      expect((await x.agent(target, 'open_workspace', { resource_id: x.resource })).operation_id).toBe(open.operation_id);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('1');
    } finally { await x.close(); }
  });

  it('lets an earlier eligible Node finish without a repository before a later eligible Node first adopts completed work', async () => {
    const x = await workspaceFixture('completed');
    try {
      const free = x.definition(), adopter = x.definition(randomUUID(), [free.node_id]);
      const p = await x.prepare([free, adopter]); await x.publish(p);
      const first = await x.node(); expect(first.dispatch.node_id).toBe(free.node_id); await x.complete(first);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      const target = await x.node(); expect(target.dispatch.node_id).toBe(adopter.node_id);
      const { workspace } = await openedWorkspace(x, target, x.resource);
      expect(workspace.transfer).toMatchObject({ proposal_id: p.payload.proposal_id, kind: 'completed', from_lease_id: x.old.lease_id,
        to_node_id: adopter.node_id, completion_operation_id: x.settlementId, metadata: x.settled });
      expect((await x.db.pool.query('SELECT target_node_id FROM replan_workspace_transfers')).rows).toEqual([{ target_node_id: adopter.node_id }]);
    } finally { await x.close(); }
  });

  it('does not let the original Node bypass a checkpoint reassigned to a different target', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const replacement = x.definition(undefined, [x.original.node_id]);
      const p = await x.prepare([x.original, replacement], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: replacement.node_id, node_activation: 1 }]; });
      await x.publish(p);
      const oldIdentity = await x.node(); expect(oldIdentity.dispatch.node_id).toBe(x.original.node_id);
      expect(oldIdentity.dispatch.node_execution_source!.node_activation).toBe(1);
      const separate = await openedWorkspace(x, oldIdentity, x.resource);
      expect(separate.workspace.transfer).toBeUndefined();
      expect(separate.workspace.isolation!.allocation_id).not.toBe(x.old.isolation!.allocation_id);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      const done = await x.agent(oldIdentity, 'complete_node', { summary: 'Separate canonical allocation preserves the assigned private checkpoint' });
      const completion = await x.service.recoverOperation(x.f.runner, done.operation_id!);
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: done.operation_id!, attempt_id: oldIdentity.dispatch.attempt_id, success: true,
        result: { writer_absent: true, completion_outcome: 'finalized', workspace_results: [{ resource_id: x.resource, workspace_id: separate.workspace.workspace_id,
          capture: { start_commit: separate.metadata.isolation!.start_commit, node_commit: 'd'.repeat(40), node_tree: 'e'.repeat(40) }, workspace_metadata: { ...separate.metadata, finalized_commit: 'd'.repeat(40) },
          git_commit: 'd'.repeat(40), git_tree: 'e'.repeat(40), integration: { outcome: 'integrated', start_commit: separate.metadata.isolation!.start_commit,
            expected_task_commit: completion.workspaces![0]!.integration!.expected_task_commit, node_commit: 'd'.repeat(40), node_tree: 'e'.repeat(40), task_commit: 'd'.repeat(40), task_tree: 'e'.repeat(40) } }] } });
      const target = await x.node(); expect(target.dispatch.node_id).toBe(replacement.node_id);
      const { workspace } = await openedWorkspace(x, target, x.resource);
      expect(workspace.transfer).toMatchObject({ from_node_id: x.original.node_id, to_node_id: replacement.node_id, kind: 'checkpoint' });
    } finally { await x.close(); }
  });

  it('requires the assigned checkpoint owner to open it before requesting upstream Rework', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const upstream = x.definition(), target = x.definition(undefined, [upstream.node_id]);
      const p = await x.prepare([upstream, target], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: target.node_id, node_activation: 1 }]; });
      await x.publish(p); await x.complete(await x.node());
      const active = await x.node(); expect(active.dispatch.node_id).toBe(target.node_id);
      const version = await x.version();
      await expect(x.agent(active, 'request_rework', { reason: 'Revisit the upstream implementation' })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      expect(await x.version()).toBe(version);
      expect((await x.db.pool.query('SELECT count(*) FROM node_rework_requests')).rows[0].count).toBe('0');
      await openedWorkspace(x, active, x.resource);
      const request = await x.agent(active, 'request_rework', { reason: 'Revisit upstream after adopting the private input' });
      expect(request.result!.rework_outcome).toMatchObject({ status: 'settling', target_node_id: upstream.node_id });
    } finally { await x.close(); }
  });

  it('rejects Rework from another branch when its affected descendants include an unadopted checkpoint target', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const upstream = x.definition(), requester = x.definition(undefined, [upstream.node_id]), reserved = x.definition(undefined, [upstream.node_id]);
      const p = await x.prepare([upstream, requester, reserved], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: reserved.node_id, node_activation: 1 }]; });
      await x.publish(p); await x.complete(await x.node());
      const active = await x.node(); expect(active.dispatch.node_id).toBe(requester.node_id);
      const version = await x.version();
      await expect(x.agent(active, 'request_rework', { target_node_id: upstream.node_id, reason: 'Correct shared upstream before the other branch starts' }))
        .rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
      expect(await x.version()).toBe(version);
      expect((await x.db.pool.query('SELECT count(*) FROM node_rework_requests')).rows[0].count).toBe('0');
      expect((await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [reserved.node_id])).rows[0].activation).toBe('1');
      await x.complete(active);
      const target = await x.node(); expect(target.dispatch.node_id).toBe(reserved.node_id);
      expect((await openedWorkspace(x, target, x.resource)).workspace.transfer).toMatchObject({ kind: 'checkpoint', to_node_id: reserved.node_id, to_node_activation: 1 });
    } finally { await x.close(); }
  });

  it('preserves an unadopted checkpoint target when Conversation guidance tries to reactivate its completed upstream', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const upstream = x.definition(), target = x.definition(undefined, [upstream.node_id]);
      const p = await x.prepare([upstream, target], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: target.node_id, node_activation: 1 }]; });
      await x.publish(p);
      const completed = await x.node(); expect(completed.dispatch.node_id).toBe(upstream.node_id);
      await x.complete(completed, 'Repository-free upstream result');
      await x.send('Refine the completed upstream result before accepting this Task');
      const turn = await x.turn();
      const reply = await x.reply(turn, { kind: 'guidance', text: 'Refine the existing upstream result', basis: {
        control_version: await x.version(), specification_id: x.f.spec, plan_id: p.payload.plan_id,
        node_id: upstream.node_id, node_activation: 1, source_id: completed.dispatch.node_execution_source!.source_id,
      } });
      await x.finish(reply.operation_id!, turn.dispatch.attempt_id);
      const version = await x.version();
      const snapshot = async () => (await x.db.pool.query('SELECT id,activation,state,execution_source_id,blocker_id FROM nodes WHERE id=ANY($1::text[]) ORDER BY id', [[upstream.node_id, target.node_id]])).rows;
      const before = await snapshot();
      expect(before.find(n => n.id === target.node_id)).toMatchObject({ activation: '1', state: 'PENDING', execution_source_id: null });
      await expect(x.conversation.pump()).rejects.toMatchObject({ detail: {
        code: 'unmet_precondition', message: 'Open the approved inherited private workspace before reactivating its target',
      } });
      expect(await x.version()).toBe(version); expect(await snapshot()).toEqual(before);
      expect((await x.db.pool.query('SELECT node_id,activation FROM node_activations WHERE node_id=ANY($1::text[]) ORDER BY node_id', [[upstream.node_id, target.node_id]])).rows)
        .toEqual([upstream.node_id, target.node_id].sort().map(node_id => ({ node_id, activation: '1' })));
      expect((await x.db.pool.query('SELECT status FROM task_guidance_followups WHERE node_id=$1', [upstream.node_id])).rows).toEqual([{ status: 'waiting' }]);
      expect((await x.conversation.status(x.token, x.f.task)).acceptance_guards).toContain(reply.result!.obligation_id);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      expect((await x.db.pool.query('SELECT checkpoint FROM workspace_leases WHERE id=$1', [x.old.lease_id])).rows[0].checkpoint).toEqual(x.settled.checkpoint);
    } finally { await x.close(); }
  });

  it('allows completed workspace disposition with no adopters while denying all new repository opens', async () => {
    const x = await workspaceFixture('completed');
    try {
      const first = x.definition(), second = x.definition();
      const p = await x.prepare([first, second], impact => { impact.workspaces[0]!.target_nodes = []; }); await x.publish(p);
      for (const definition of [first, second]) {
        const turn = await x.node(); expect(turn.dispatch.node_id).toBe(definition.node_id);
        await expect(x.agent(turn, 'open_workspace', { resource_id: x.resource })).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
        await x.complete(turn);
      }
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1', [x.f.task])).rows[0].state).toBe('REVIEW');
    } finally { await x.close(); }
  });

  it('lets a later authorized activation of the same Node first adopt completed code without carrying its old evidence', async () => {
    const x = await workspaceFixture('completed');
    try {
      const target = x.definition(), downstream = x.definition(randomUUID(), [target.node_id]);
      const p = await x.prepare([target, downstream], impact => { impact.workspaces[0]!.target_nodes = [{ node_id: target.node_id, node_activation: 1 }]; });
      await x.publish(p);
      await x.complete(await x.node(), 'Repository-free first activation');
      const dependent = await x.node(); expect(dependent.dispatch.node_id).toBe(downstream.node_id);
      const request = await x.agent(dependent, 'request_rework', { reason: 'Revisit the exact upstream implementation' });
      await x.finish(request.operation_id!, dependent.dispatch.attempt_id); await new NodeRework(x.db).pump();
      const revised = await x.node();
      expect(revised.dispatch.node_id).toBe(target.node_id); expect(revised.dispatch.node_execution_source!.node_activation).toBe(2);
      expect(JSON.parse(revised.dispatch.prompt).upstream_outputs.items).toEqual([]);
      expect((await x.db.pool.query('SELECT count(*) FROM node_completions WHERE node_id=$1 AND activation=2', [target.node_id])).rows[0].count).toBe('0');
      expect((await x.execution.status(x.token, x.f.task, downstream.node_id)).source).toBeNull();
      const { workspace } = await openedWorkspace(x, revised, x.resource);
      expect(workspace.transfer).toMatchObject({ proposal_id: p.payload.proposal_id, kind: 'completed', from_lease_id: x.old.lease_id,
        to_node_id: target.node_id, to_node_activation: 2, completion_operation_id: x.settlementId });
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('1');
    } finally { await x.close(); }
  });

  it('rejects a checkpoint without one exact target and rejects stale predecessor facts', async () => {
    const x = await workspaceFixture('checkpoint');
    try {
      const first = x.definition(), second = x.definition();
      const draft = await x.draft([first, second]);
      for (const targets of [[], [{ node_id: first.node_id, node_activation: 2 }], [{ node_id: randomUUID(), node_activation: 1 }],
        [{ node_id: first.node_id, node_activation: 1 }, { node_id: second.node_id, node_activation: 1 }]]) {
        const payload = structuredClone(draft.payload); payload.proposal_id = randomUUID(); payload.impact.workspaces[0]!.target_nodes = targets;
        await expect(x.agent(draft.turn, 'prepare_replan', payload)).rejects.toThrow();
      }
      const stale = structuredClone(draft.payload); stale.proposal_id = randomUUID(); stale.impact.workspaces[0]!.input.from_lease_id = randomUUID();
      await expect(x.agent(draft.turn, 'prepare_replan', stale)).rejects.toMatchObject({ detail: { code: 'version_conflict' } });
      expect((await x.db.pool.query('SELECT count(*) FROM replan_proposals')).rows[0].count).toBe('0');
      await x.publish(await x.submit(draft));
    } finally { await x.close(); }
  });

  it.each(['checkpoint', 'completed'] as const)('remaps %s work through another Replan before any adoption', async kind => {
    const x = await workspaceFixture(kind);
    try {
      const middle = x.definition(), other = x.definition();
      const initial = await x.prepare([middle, other]); await x.publish(initial); await x.request();
      const final = x.definition(), free = x.definition();
      const next = await x.prepare([final, free]);
      expect(next.payload.impact.workspaces[0]!.input).toEqual(initial.payload.impact.workspaces[0]!.input);
      await x.publish(next);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('0');
      const target = await x.node(); expect(target.dispatch.node_id).toBe(final.node_id);
      const { workspace } = await openedWorkspace(x, target, x.resource);
      expect(workspace.transfer).toMatchObject({ proposal_id: next.payload.proposal_id, from_plan_id: x.f.plan, to_plan_id: next.payload.plan_id,
        from_lease_id: x.old.lease_id, to_node_id: final.node_id, kind });
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('1');
    } finally { await x.close(); }
  });

  it.each(['checkpoint', 'completed'] as const)('retries after %s adoption without consuming the old predecessor twice', async kind => {
    const x = await workspaceFixture(kind);
    try {
      const adopter = x.definition(), other = x.definition(undefined, [adopter.node_id]);
      const p = await x.prepare([adopter, other]); await x.publish(p);
      const target = await x.node(), adopted = await openedWorkspace(x, target, x.resource);
      const blocked = await x.agent(target, 'block_node', { reason: 'Clarify the adopted private work' });
      const checkpoint: WorkspaceMetadata = { ...adopted.metadata, checkpoint: { operation_id: blocked.operation_id!,
        head_commit: adopted.metadata.finalized_commit, tree_id: 'd'.repeat(40), commit_id: 'e'.repeat(40) } };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: blocked.operation_id!, attempt_id: target.dispatch.attempt_id,
        success: true, result: { writer_absent: true, workspace_id: adopted.workspace.workspace_id, workspace_metadata: checkpoint } });
      const status = await x.execution.status(x.token, x.f.task, adopter.node_id);
      await x.owner('retry_node', { node_id: adopter.node_id, node_activation: status.node_activation, source_id: status.source!.source_id,
        blocker_id: status.blocker!.id, answer: 'Continue the already adopted work' });
      const retry = await x.node(); expect(retry.dispatch.node_id).toBe(adopter.node_id);
      const opened = await x.agent(retry, 'open_workspace', { resource_id: x.resource });
      const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!);
      expect(operation.workspace!.workspace_id).toBe(x.old.workspace_id);
      expect(operation.workspace!.lease_id).not.toBe(adopted.workspace.lease_id);
      expect(operation.workspace!.transfer).toBeUndefined();
      expect(operation.workspace!.basis?.finalized_commit).toBe(checkpoint.finalized_commit);
      expect((await x.db.pool.query('SELECT checkpoint FROM workspace_leases WHERE id=$1', [adopted.workspace.lease_id])).rows[0].checkpoint).toEqual(checkpoint.checkpoint);
      expect((await x.db.pool.query('SELECT count(*) FROM replan_workspace_transfers')).rows[0].count).toBe('1');
    } finally { await x.close(); }
  });
});
