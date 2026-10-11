import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import type { WorkspaceMetadata } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { NodeRework } from '../src/node-rework.ts';
import { workspaceReworkHistory } from '../src/workspace-rework-transfer.ts';
import type { WorkspaceAttempt } from '../src/workspaces.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Upstream Rework workspace disposition', () => {
  it('waits for requester Stop, gives A finalized basis and gives B corrected code plus exact historical checkpoint', async () => {
    const x = await conversationFixture(), rework = new NodeRework(x.db);
    try {
      const resource = randomUUID(), downstream = `rework-b-${randomUUID()}`, config = new Configuration(x.db);
      await config.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(x.token)).control_version,
        name: 'save_project', payload: { id: x.f.project, name: 'Rework project', context: 'Preserve requester code', role_ids: [x.f.role], archived: false,
          resources: [{ id: resource, remote_url: 'https://github.com/example/rework.git', remote_preparation: 'after_acceptance', default_branch: 'main' }] } });
      await x.owner('start_task', { specification_id: x.f.spec }); await x.planning.pump();
      const planner = await x.promote(), publication = await x.agent(planner, 'publish_execution_plan', {
        planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: x.f.plan,
        nodes: [{ node_id: x.f.node, role_id: x.f.role, goal: 'Upstream implementation', dependencies: [] },
          { node_id: downstream, role_id: x.f.role, goal: 'Use upstream implementation', dependencies: [x.f.node] }],
      });
      await x.finish(publication.operation_id!, planner.dispatch.attempt_id);
      const first = await x.node();
      const firstOpen = await x.agent(first, 'open_workspace', { resource_id: resource });
      const firstOperation = await x.service.recoverOperation(x.f.runner, firstOpen.operation_id!), w = firstOperation.workspace!;
      const original: WorkspaceMetadata = { generation: 1, storage_id: 'rework-storage', lease_id: w.lease_id,
        repository_identity: w.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40) };
      const openResult = (op: string, attempt: string, metadata: WorkspaceMetadata) => x.service.finishOperation(x.f.runner, x.f.incarnation, {
        operation_id: op, attempt_id: attempt, success: true,
        result: { workspace_id: w.workspace_id, path: '/runner/worktree', instruction_files: [], workspace_metadata: metadata },
      });
      const complete = async (a: Awaited<ReturnType<typeof x.node>>, metadata: WorkspaceMetadata, commit: string) => {
        const done = await x.agent(a, 'complete_node', { summary: 'Completed upstream implementation' });
        await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: done.operation_id!, attempt_id: a.dispatch.attempt_id, success: true,
          result: { writer_absent: true, completion_outcome: 'finalized', workspace_results: [{ resource_id: resource, workspace_id: w.workspace_id, workspace_metadata: { ...metadata, finalized_commit: commit }, capture: { start_commit: metadata.finalized_commit, node_commit: commit, node_tree: 'd'.repeat(40) }, git_commit: commit, git_tree: 'd'.repeat(40) }] } });
        return done;
      };
      await openResult(firstOpen.operation_id!, first.dispatch.attempt_id, original);
      await complete(first, original, 'c'.repeat(40));
      const requester = await x.node(); expect(requester.dispatch.node_id).toBe(downstream);
      const requesterOpen = await x.agent(requester, 'open_workspace', { resource_id: resource });
      const requesterOperation = await x.service.recoverOperation(x.f.runner, requesterOpen.operation_id!);
      const current = { ...original, lease_id: requesterOperation.workspace!.lease_id, finalized_commit: 'c'.repeat(40) };
      await openResult(requesterOpen.operation_id!, requester.dispatch.attempt_id, current);
      const commandId = randomUUID(), request = await x.agent(requester, 'request_rework', { target_node_id: x.f.node, reason: 'Correct upstream and retain my private work' }, commandId);
      await rework.pump();
      expect((await x.db.pool.query('SELECT activation FROM nodes WHERE id=$1', [x.f.node])).rows[0].activation).toBe('1');
      expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [current.lease_id])).rows[0].state).toBe('settling');
      const checkpoint = { ...current, checkpoint: { operation_id: request.operation_id!, head_commit: current.finalized_commit, commit_id: 'e'.repeat(40), tree_id: 'f'.repeat(40) } };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: request.operation_id!, attempt_id: requester.dispatch.attempt_id, success: true,
        result: { writer_absent: true, workspace_id: w.workspace_id, workspace_metadata: checkpoint } });
      await rework.pump();
      const corrected = await x.node(); expect(corrected.dispatch).toMatchObject({ node_id: x.f.node, node_activation: 2 });
      const correctedOpen = await x.agent(corrected, 'open_workspace', { resource_id: resource });
      const correctedOperation = await x.service.recoverOperation(x.f.runner, correctedOpen.operation_id!);
      const domainId = request.result!.rework_outcome!.rework_request_id;
      const historicalCheckpoint = { workspace_id: w.workspace_id, resource_id: resource,
        stop_operation_id: request.operation_id, checkpoint: checkpoint.checkpoint,
        git_ref: `refs/monos/history/${domainId}` };
      expect(JSON.parse(corrected.dispatch.prompt).node_rework[0].historical_checkpoints).toEqual([historicalCheckpoint]);
      const changes = [{ node_id: x.f.node, from_activation: 1, to_activation: 2 }, { node_id: downstream, from_activation: 1, to_activation: 2 }];
      expect(correctedOperation.workspace).toMatchObject({ basis: { finalized_commit: current.finalized_commit },
        transfer: { purpose: 'rework', kind: 'checkpoint', rework_request_id: domainId, rework_command_request_id: commandId,
          from_plan_id: x.f.plan, to_plan_id: x.f.plan, from_node_id: downstream, from_node_activation: 1,
          to_node_id: x.f.node, to_node_activation: 2, from_lease_id: current.lease_id, settle_operation_id: request.operation_id,
          rework_activations: changes, metadata: checkpoint } });
      const history = correctedOperation.workspace!.rework_history!;
      expect(history).toEqual([{ rework_request_id: domainId, rework_command_request_id: commandId, plan_id: x.f.plan,
        from_node_id: downstream, from_node_activation: 1, from_attempt_id: requester.dispatch.attempt_id,
        from_lease_id: current.lease_id, settle_operation_id: request.operation_id, metadata: checkpoint, rework_activations: changes }]);
      const correctedMetadata = { ...current, lease_id: correctedOperation.workspace!.lease_id };
      await openResult(correctedOpen.operation_id!, corrected.dispatch.attempt_id, correctedMetadata);
      await complete(corrected, correctedMetadata, '1'.repeat(40));
      const next = await x.node(); expect(next.dispatch).toMatchObject({ node_id: downstream, node_activation: 2 });
      expect(JSON.parse(next.dispatch.prompt).node_rework[0].historical_checkpoints).toEqual([historicalCheckpoint]);
      expect(JSON.parse(requester.dispatch.prompt).node_rework).toEqual([]);
      expect((await x.db.pool.query('SELECT prompt FROM node_execution_outbox WHERE id=$1', [requester.dispatch.node_execution_source!.source_id])).rows[0].prompt).toBe(requester.dispatch.prompt);
      const nextOpen = await x.agent(next, 'open_workspace', { resource_id: resource });
      const nextOperation = await x.service.recoverOperation(x.f.runner, nextOpen.operation_id!);
      expect(nextOperation.workspace).toMatchObject({ basis: { finalized_commit: '1'.repeat(40) }, transfer: { purpose: 'serial', kind: 'completed', from_node_id: x.f.node, from_node_activation: 2 } });
      expect(nextOperation.workspace!.rework_history).toEqual(history);
      expect((await x.db.pool.query('SELECT checkpoint FROM workspace_leases WHERE id=$1', [current.lease_id])).rows[0].checkpoint).toEqual(checkpoint.checkpoint);
      const row = (await x.db.pool.query<WorkspaceAttempt>('SELECT * FROM attempts WHERE id=$1', [next.dispatch.attempt_id])).rows[0]!;
      expect(await transaction(x.db, tx => workspaceReworkHistory(tx, { ...row, runner_id: 'wrong-runner' }, w.workspace_id))).toEqual([]);
      expect(await transaction(x.db, tx => workspaceReworkHistory(tx, { ...row, node_activation: '3' }, w.workspace_id))).toEqual([]);
      await expect(x.db.pool.query("UPDATE operations SET workspace_descriptor=jsonb_set(workspace_descriptor,'{rework_history,0,rework_request_id}',to_jsonb('forged'::text)) WHERE id=$1", [nextOperation.operation_id])).rejects.toMatchObject({ code: '23514' });
    } finally { await x.close(); }
  }, 20000);
});
