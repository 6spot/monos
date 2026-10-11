import { randomUUID } from 'node:crypto';
import type { Operation, WorkspaceIntegrationResult, WorkspaceMetadata } from '../../../../packages/protocol/src/index.ts';
import { Configuration } from '../../src/configuration.ts';
import { multiReplanFixture } from './task-replan-multi-fixture.ts';

type BaseFixture = Awaited<ReturnType<typeof multiReplanFixture>>;
export type ParallelTurn = Awaited<ReturnType<BaseFixture['promote']>>;

export async function parallelWorkspacesFixture() {
  const x = await multiReplanFixture(), resource = randomUUID();
  try {
    const configuration = new Configuration(x.db);
    await configuration.save(x.token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Parallel repository', context: 'Integrate independent branches',
        resources: [{ id: resource, remote_url: 'https://github.com/example/parallel.git', remote_preparation: 'after_acceptance', default_branch: 'main' }], role_ids: [x.f.role], archived: false } });
    async function admitOpen(turn: ParallelTurn) {
      const response = await x.agent(turn, 'open_workspace', { resource_id: resource });
      return x.service.recoverOperation(x.f.runner, response.operation_id!);
    }
    async function finishOpen(turn: ParallelTurn, operation: Operation) {
      const w = operation.workspace!;
      const metadata: WorkspaceMetadata = { generation: w.generation, lease_id: w.lease_id, storage_id: 'parallel-storage',
        repository_identity: w.resource.repository_identity, provider_metadata: { github: { repository_id: '42' } },
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40),
        finalized_commit: w.transfer?.kind === 'checkpoint' ? w.transfer.metadata.finalized_commit : w.basis?.finalized_commit ?? 'a'.repeat(40),
        ...(w.isolation ? { isolation: { allocation_id: w.isolation.allocation_id,
          start_commit: w.transfer?.kind === 'checkpoint' ? w.transfer.metadata.isolation?.start_commit ?? w.transfer.metadata.finalized_commit : w.basis?.finalized_commit ?? 'a'.repeat(40) } } : {}),
      };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id,
        success: true, result: { workspace_id: w.workspace_id, path: `/runner/allocations/${w.isolation?.allocation_id ?? 'direct'}`, instruction_files: [], workspace_metadata: metadata } });
      return { operation, workspace: w, metadata };
    }
    async function open(turn: ParallelTurn) { return finishOpen(turn, await admitOpen(turn)); }
    async function admitCompletion(turn: ParallelTurn, requestId = randomUUID()) {
      const response = await x.agent(turn, 'complete_node', { summary: 'Exact parallel branch result' }, requestId);
      return { response, operation: await x.service.recoverOperation(x.f.runner, response.operation_id!) };
    }
    async function settleCompletion(turn: ParallelTurn, operation: Operation, outcome: 'integrated' | 'conflict' = 'integrated', commit = 'c'.repeat(40)) {
      const input = operation.workspaces![0]!, w = input.workspace;
      const open = (await x.db.pool.query<{ result: { workspace_metadata: WorkspaceMetadata } }>('SELECT result FROM operations WHERE id=$1', [w.open_operation_id])).rows[0]!;
      const before = open.result.workspace_metadata, expected = input.integration?.expected_task_commit;
      const integration: WorkspaceIntegrationResult | undefined = w.isolation ? {
        outcome, start_commit: before.isolation!.start_commit, node_commit: commit, node_tree: 'd'.repeat(40), expected_task_commit: expected!,
        task_commit: outcome === 'integrated' ? commit : expected!, task_tree: 'e'.repeat(40),
      } : undefined;
      const metadata: WorkspaceMetadata = { ...before, finalized_commit: outcome === 'integrated' ? commit : before.finalized_commit };
      const result = { writer_absent: true, completion_outcome: outcome === 'integrated' ? 'finalized' as const : 'conflict' as const,
        workspace_results: [{ resource_id: w.resource_id, workspace_id: w.workspace_id, workspace_metadata: metadata,
          capture: { start_commit: before.isolation?.start_commit ?? before.finalized_commit, node_commit: commit, node_tree: integration?.node_tree ?? 'e'.repeat(40) },
          ...(outcome === 'integrated' ? { git_commit: commit, git_tree: integration?.task_tree ?? 'e'.repeat(40) } : {}), ...(integration ? { integration } : {}) }] };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id, success: true, result });
      return result;
    }
    async function checkpoint(turn: ParallelTurn, kind: 'block_node' | 'request_replan' = 'block_node') {
      const response = await x.agent(turn, kind, { reason: 'Preserve this independent private branch' });
      const operation = await x.service.recoverOperation(x.f.runner, response.operation_id!), w = operation.workspace!;
      const open = (await x.db.pool.query<{ result: { workspace_metadata: WorkspaceMetadata } }>('SELECT result FROM operations WHERE id=$1', [w.open_operation_id])).rows[0]!;
      const metadata: WorkspaceMetadata = { ...open.result.workspace_metadata, checkpoint: { operation_id: operation.operation_id,
        head_commit: open.result.workspace_metadata.finalized_commit, tree_id: 'd'.repeat(40), commit_id: 'f'.repeat(40) } };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id,
        success: true, result: { writer_absent: true, workspace_id: w.workspace_id, workspace_metadata: metadata } });
      return { response, operation, metadata };
    }
    async function concurrentAdmissions<T>(actions: [() => Promise<T>, () => Promise<T>]) {
      const lock = await x.db.pool.connect();
      let pending: Promise<PromiseSettledResult<T>[]> | undefined;
      try {
        await lock.query('BEGIN');
        await lock.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [x.f.task]);
        const pid = (await lock.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
        pending = Promise.allSettled(actions.map(action => action()));
        let contenders = 0;
        for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
          contenders = Number((await x.db.pool.query(`WITH RECURSIVE waiting(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
            UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
          ) SELECT count(*) FROM waiting`, [pid])).rows[0].count);
          if (contenders >= 2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await lock.query('COMMIT');
        return { contenders, results: await pending };
      } finally {
        await lock.query('ROLLBACK'); lock.release();
        if (pending) await pending;
      }
    }
    return { ...x, resource, admitOpen, finishOpen, open, admitCompletion, settleCompletion, checkpoint, concurrentAdmissions };
  } catch (error) { await x.close(); throw error; }
}
