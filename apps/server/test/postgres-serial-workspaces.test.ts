import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest } from '../../../packages/protocol/src/index.ts';
import type { WorkspaceMetadata } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { serialWorkspaceTransfer } from '../src/workspace-serial-transfer.ts';
import type { WorkspaceAttempt } from '../src/workspaces.ts';
import { conversationFixture } from './fixtures/task-conversation-fixture.ts';
import { reviewCorrectionFixture } from './fixtures/review-correction-fixture.ts';

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Serial completed workspace handoff', () => {
  async function fixture(mode: 'completed' | 'checkpoint' = 'completed') {
    const x = await conversationFixture(), resource = randomUUID(), downstream = `serial-next-${randomUUID()}`;
    try {
      const config = new Configuration(x.db);
      await config.save(x.token, { schema_version: 1, request_id: randomUUID(),
        expected_control_version: (await config.read(x.token)).control_version,
        name: 'save_project', payload: { id: x.f.project, name: 'Serial project', context: 'Retain finalized code',
          resources: [{ id: resource, remote_url: 'https://github.com/example/serial.git', remote_preparation: 'after_acceptance', default_branch: 'main' }],
          role_ids: [x.f.role], archived: false } });
      await x.owner('start_task', { specification_id: x.f.spec });
      await x.planning.pump();
      const planner = await x.promote();
      const publication = await x.agent(planner, 'publish_execution_plan', {
        planning_intent_id: planner.dispatch.task_planning_source!.intent_id, plan_id: x.f.plan,
        nodes: [
          { node_id: x.f.node, role_id: x.f.role, goal: 'Create code', dependencies: [] },
          { node_id: downstream, role_id: x.f.role, goal: 'Extend code', dependencies: mode === 'completed' ? [x.f.node] : [] },
        ],
      });
      await x.finish(publication.operation_id!, planner.dispatch.attempt_id);
      const first = await x.node();
      const opened = await x.agent(first, 'open_workspace', { resource_id: resource });
      const open = await x.service.recoverOperation(x.f.runner, opened.operation_id!), w = open.workspace!;
      const metadata: WorkspaceMetadata = { generation: 1, storage_id: 'serial-storage', lease_id: w.lease_id,
        repository_identity: w.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40), finalized_commit: 'a'.repeat(40),
        ...(w.isolation ? { isolation: { allocation_id: w.isolation.allocation_id, start_commit: 'a'.repeat(40) } } : {}) };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: open.operation_id,
        attempt_id: first.dispatch.attempt_id, success: true,
        result: { workspace_id: w.workspace_id, path: '/runner/worktree', instruction_files: [], workspace_metadata: metadata } });
      const completion = mode === 'completed'
        ? await x.agent(first, 'complete_node', { summary: 'Upstream finalized code' })
        : await x.agent(first, 'block_node', { reason: 'Need an answer before continuing private work' });
      const finalized: WorkspaceMetadata = mode === 'completed' ? { ...metadata, finalized_commit: 'c'.repeat(40) }
        : { ...metadata, checkpoint: { operation_id: completion.operation_id!, head_commit: metadata.base_commit,
          tree_id: 'd'.repeat(40), commit_id: 'c'.repeat(40) } };
      const settle = () => x.service.finishOperation(x.f.runner, x.f.incarnation, {
        operation_id: completion.operation_id!, attempt_id: first.dispatch.attempt_id, success: true,
        result: { writer_absent: true, workspace_id: w.workspace_id, workspace_metadata: finalized,
          ...(mode === 'completed' ? { git_commit: finalized.finalized_commit, git_tree: 'd'.repeat(40) } : {}) },
      });
      return { ...x, resource, downstream, first, w, completion, finalized, settle };
    } catch (error) { await x.close(); throw error; }
  }

  it('waits for exact completion then freezes serial handoff while scratch Conversation is running', async () => {
    const x = await fixture();
    try {
      await x.execution.pump();
      expect((await x.execution.status(x.token, x.f.task, x.downstream)).source).toBeNull();
      expect((await x.db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [x.w.lease_id])).rows[0].state).toBe('settling');
      await x.settle();
      const second = await x.node();
      expect(second.dispatch.node_id).toBe(x.downstream);
      await x.send('Explain current progress without changing work');
      const conversation = await x.turn();
      expect(conversation.dispatch.task_conversation_source).toBeDefined();
      const requestId = randomUUID();
      const opened = await x.agent(second, 'open_workspace', { resource_id: x.resource }, requestId);
      const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!);
      expect(operation.workspace).toMatchObject({ workspace_id: x.w.workspace_id,
        basis: { storage_id: 'serial-storage', finalized_commit: x.finalized.finalized_commit },
        transfer: { purpose: 'serial', kind: 'completed', from_plan_id: x.f.plan, to_plan_id: x.f.plan,
          from_node_id: x.f.node, from_node_activation: 1, from_attempt_id: x.first.dispatch.attempt_id,
          from_lease_id: x.w.lease_id, to_node_id: x.downstream, to_node_activation: 1,
          completion_operation_id: x.completion.operation_id, settle_operation_id: x.completion.operation_id,
          finalized_tree: 'd'.repeat(40), metadata: x.finalized } });
      expect(operation.workspace!.transfer).not.toHaveProperty('publication_id');
      expect(operation.workspace!.transfer).not.toHaveProperty('proposal_id');
      expect(operation.workspace_digest).toBe(digest(canonicalJSON(operation.workspace)));
      expect((await x.agent(second, 'open_workspace', { resource_id: x.resource }, requestId)).operation_id).toBe(opened.operation_id);
      expect((await x.agent(second, 'open_workspace', { resource_id: x.resource })).operation_id).toBe(opened.operation_id);
      const descriptor = JSON.stringify(operation.workspace);
      await expect(x.db.pool.query("UPDATE operations SET workspace_descriptor=jsonb_set(workspace_descriptor,'{transfer,finalized_tree}',to_jsonb($2::text)) WHERE id=$1", [operation.operation_id, 'e'.repeat(40)])).rejects.toMatchObject({ code: '23514' });
      expect(JSON.stringify((await x.service.recoverOperation(x.f.runner, operation.operation_id)).workspace)).toBe(descriptor);
      const row = (await x.db.pool.query<WorkspaceAttempt>('SELECT * FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0]!;
      expect(await transaction(x.db, tx => serialWorkspaceTransfer(tx, row, x.w.workspace_id, x.w.lease_id))).toBeUndefined();
    } finally { await x.close(); }
  }, 15000);

  it('requires retained current finalized basis, genuine released predecessor and canonical target', async () => {
    const x = await fixture();
    try {
      await x.settle();
      const second = await x.node();
      const row = (await x.db.pool.query<WorkspaceAttempt>('SELECT * FROM attempts WHERE id=$1', [second.dispatch.attempt_id])).rows[0]!;
      expect(await transaction(x.db, tx => serialWorkspaceTransfer(tx, row, x.w.workspace_id, x.w.lease_id))).toMatchObject({ purpose: 'serial' });
      for (const changed of [
        { ...row, runner_id: 'wrong-runner' },
        { ...row, node_id: x.f.node },
        { ...row, dispatch_id: 'wrong-dispatch' },
        { ...row, node_activation: '2' },
      ]) expect(await transaction(x.db, tx => serialWorkspaceTransfer(tx, changed, x.w.workspace_id, x.w.lease_id))).toBeUndefined();
      const changedSource = { ...row, launch: { ...row.launch, node_execution_source: { ...row.launch.node_execution_source!, plan_id: randomUUID() } } };
      await expect(transaction(x.db, tx => serialWorkspaceTransfer(tx, changedSource, x.w.workspace_id, x.w.lease_id))).rejects.toMatchObject({ detail: { code: 'stale_execution' } });
      await expect(x.db.pool.query('UPDATE attempts SET process_released=false WHERE id=$1', [x.first.dispatch.attempt_id]))
        .rejects.toMatchObject({ code: '23514', message: 'direct Node admission requires exclusive Task ownership' });
      for (const [sql, params] of [
        ['UPDATE attempts SET process_absent=false WHERE id=$1', [x.first.dispatch.attempt_id]],
        ['UPDATE task_workspaces SET finalized_commit=$2 WHERE id=$1', [x.w.workspace_id, 'e'.repeat(40)]],
      ] as const) {
        const rollback = new Error('rollback serial proof probe');
        await expect(transaction(x.db, async tx => {
          await tx.query(sql, [...params]);
          expect(await serialWorkspaceTransfer(tx, row, x.w.workspace_id, x.w.lease_id)).toBeUndefined();
          throw rollback;
        })).rejects.toBe(rollback);
      }
    } finally { await x.close(); }
  }, 15000);

  it('preserves a released private checkpoint when an independent same-Plan allocation opens canonical code', async () => {
    const x = await fixture('checkpoint');
    try {
      await x.settle();
      const second = await x.node();
      expect(second.dispatch.node_id).toBe(x.downstream);
      const opened = await x.agent(second, 'open_workspace', { resource_id: x.resource });
      const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!);
      expect(operation.workspace!.isolation?.allocation_id).not.toBe(x.w.isolation!.allocation_id);
      expect(operation.workspace!.transfer).toBeUndefined();
      expect(operation.workspace!.basis?.finalized_commit).toBe('a'.repeat(40));
      expect(operation.workspace!.canonical_source).toMatchObject({ operation_id: x.w.open_operation_id, kind: 'open_workspace' });
      expect((await x.db.pool.query('SELECT id,state,checkpoint FROM workspace_leases WHERE id=$1', [x.w.lease_id])).rows)
        .toEqual([{ id: x.w.lease_id, state: 'released', checkpoint: x.finalized.checkpoint }]);
    } finally { await x.close(); }
  }, 15000);

  it('retains historical completed code as physical basis for a new Review Rework activation', async () => {
    const x = await reviewCorrectionFixture('no_change');
    try {
      const old = (await x.db.pool.query('SELECT w.id,w.resource_id,w.finalized_commit,l.id AS lease_id,l.settle_operation_id FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id WHERE w.task_id=$1', [x.f.task])).rows[0]!;
      await x.requestChanges('Correct the existing implementation');
      const planner = await x.reviewTurn();
      const rework = await x.agent(planner, 'apply_review_rework', { ...x.reviewBinding(planner), basis: x.reviewActionBasis(planner), node_ids: [x.f.node], reason: 'Preserve the completed code and fix its behavior' });
      await x.finish(rework.operation_id!, planner.dispatch.attempt_id);
      await expect.poll(async () => { await x.reviewCoordinator.pump(); return (await x.reviewReads.task(x.token, x.f.task)).feedback; }, { timeout: 5000 }).toBeNull();
      await expect.poll(async () => {
        await x.reviewCoordinator.pump();
        await x.execution.pump();
        return (await x.db.pool.query("SELECT 1 FROM attempts WHERE node_id=$1 AND node_activation=2 AND state='QUEUED'", [x.f.node])).rowCount;
      }, { timeout: 5000 }).toBe(1);
      const next = await x.promote();
      expect(next.dispatch.node_activation).toBe(2);
      const opened = await x.agent(next, 'open_workspace', { resource_id: old.resource_id });
      const operation = await x.service.recoverOperation(x.f.runner, opened.operation_id!);
      expect(operation.workspace).toMatchObject({ workspace_id: old.id,
        basis: { finalized_commit: old.finalized_commit },
        transfer: { purpose: 'serial', from_plan_id: x.f.plan, to_plan_id: x.f.plan,
          from_node_id: x.f.node, from_node_activation: 1, to_node_id: x.f.node, to_node_activation: 2,
          from_lease_id: old.lease_id, completion_operation_id: old.settle_operation_id } });
      expect((await x.db.pool.query('SELECT activation FROM node_completions WHERE node_id=$1', [x.f.node])).rows).toEqual([{ activation: '1' }]);
      expect((await x.db.pool.query('SELECT activation,state FROM nodes WHERE id=$1', [x.f.node])).rows[0]).toMatchObject({ activation: '2', state: 'RUNNING' });
    } finally { await x.close(); }
  }, 15000);
});
