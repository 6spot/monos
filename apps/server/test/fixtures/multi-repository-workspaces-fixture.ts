import { randomUUID } from 'node:crypto';
import type { Operation, WorkspaceEffectResult, WorkspaceMetadata } from '../../../../packages/protocol/src/index.ts';
import { Configuration } from '../../src/configuration.ts';
import { multiReplanFixture } from './task-replan-multi-fixture.ts';

type Base = Awaited<ReturnType<typeof multiReplanFixture>>;
export type MultiRepositoryTurn = Awaited<ReturnType<Base['promote']>>;

export async function multiRepositoryWorkspacesFixture(plain: number[] = []) {
  const x = await multiReplanFixture();
  const resources: [string, string] = [randomUUID(), randomUUID()];
  resources.sort();
  try {
    const configuration = new Configuration(x.db);
    await configuration.save(x.token, {
      schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(x.token)).control_version,
      name: 'save_project', payload: { id: x.f.project, name: 'Multiple repositories', context: 'Complete every repository as one Node',
        resources: resources.map((id, index) => ({ id, remote_url: plain.includes(index)?`https://git.example.test:8443/Exact/Repo-${index}.git`:`https://github.com/example/multi-${index}.git`,
          remote_preparation: 'after_acceptance' as const, default_branch: 'main' })), role_ids: [x.f.role], archived: false },
    });
    async function admitOpen(turn: MultiRepositoryTurn, resource = resources[0]) {
      const response = await x.agent(turn, 'open_workspace', { resource_id: resource });
      return x.service.recoverOperation(x.f.runner, response.operation_id!);
    }
    async function finishOpen(turn: MultiRepositoryTurn, operation: Operation) {
      const w = operation.workspace!;
      const metadata: WorkspaceMetadata = {
        generation: w.generation, lease_id: w.lease_id, storage_id: `storage-${w.resource_id}`,
        repository_identity: w.resource.repository_identity,
        // Successful materialization observes the fixture's GitHub ID even when configuration omitted it.
        provider_metadata: w.resource.repository_identity.startsWith('github.com/')
          ? { github: w.resource.provider_metadata?.github ?? { repository_id: String(resources.indexOf(w.resource_id) + 41) } }
          : {},
        base_commit: 'a'.repeat(40), target_branch: 'main', target_commit: 'b'.repeat(40),
        finalized_commit: w.transfer?.kind === 'checkpoint' ? w.transfer.metadata.finalized_commit : w.basis?.finalized_commit ?? 'a'.repeat(40),
        ...(w.isolation ? { isolation: { allocation_id: w.isolation.allocation_id,
          start_commit: w.transfer?.kind === 'checkpoint' ? w.transfer.metadata.isolation?.start_commit ?? w.transfer.metadata.finalized_commit : w.basis?.finalized_commit ?? 'a'.repeat(40) } } : {}),
      };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, {
        operation_id: operation.operation_id, attempt_id: turn.dispatch.attempt_id, success: true,
        result: { workspace_id: w.workspace_id, path: `/runner/workspaces/${w.workspace_id}`, instruction_files: [], workspace_metadata: metadata },
      });
      return { operation, workspace: w, metadata };
    }
    async function open(turn: MultiRepositoryTurn, resource = resources[0]) { return finishOpen(turn, await admitOpen(turn, resource)); }
    async function openAll(turn: MultiRepositoryTurn) {
      const opened = [];
      for (const resource of resources) opened.push(await open(turn, resource));
      return opened;
    }
    async function admitCompletion(turn: MultiRepositoryTurn, requestId: string = randomUUID()) {
      const response = await x.agent(turn, 'complete_node', { summary: 'One complete multi-repository result' }, requestId);
      return { response, operation: await x.service.recoverOperation(x.f.runner, response.operation_id!) };
    }
    async function completionResult(operation: Operation, conflictResource?: string) {
      const workspaceResults: WorkspaceEffectResult[] = [];
      for (const [index, input] of operation.workspaces!.entries()) {
        const w = input.workspace;
        const before = (await x.db.pool.query<{ result: { workspace_metadata: WorkspaceMetadata } }>('SELECT result FROM operations WHERE id=$1', [w.open_operation_id])).rows[0]!.result.workspace_metadata;
        const commit = (index === 0 ? 'c' : 'd').repeat(40), tree = (index === 0 ? 'e' : 'f').repeat(40);
        const capture = { start_commit: before.isolation?.start_commit ?? before.finalized_commit, node_commit: commit, node_tree: tree };
        workspaceResults.push({ resource_id: w.resource_id, workspace_id: w.workspace_id,
          workspace_metadata: { ...before, finalized_commit: conflictResource ? before.finalized_commit : commit }, capture,
          ...(!conflictResource ? { git_commit: commit, git_tree: tree } : {}),
          ...(input.integration && (!conflictResource || conflictResource === w.resource_id) ? { integration: {
            outcome: conflictResource ? 'conflict' as const : 'integrated' as const, ...capture,
            expected_task_commit: input.integration.expected_task_commit,
            task_commit: conflictResource ? input.integration.expected_task_commit : commit, task_tree: tree,
          } } : {}),
        });
      }
      return { writer_absent: true as const, completion_outcome: conflictResource ? 'conflict' as const : 'finalized' as const, workspace_results: workspaceResults };
    }
    async function settleCompletion(turn: MultiRepositoryTurn, operation: Operation, conflictResource?: string) {
      const result = await completionResult(operation, conflictResource);
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id,
        attempt_id: turn.dispatch.attempt_id, success: true, result });
      return result;
    }
    async function stopOperations(turn: MultiRepositoryTurn, kind: 'block_node' | 'request_replan' = 'block_node') {
      const requestId = randomUUID();
      const response = await x.agent(turn, kind, { reason: 'Preserve every private repository' }, requestId);
      const ids = (await x.db.pool.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' AND request_id=$2 ORDER BY resource_id", [turn.dispatch.attempt_id, requestId])).rows;
      const operations = [];
      for (const { id } of ids) operations.push(await x.service.recoverOperation(x.f.runner, id));
      return { response, operations };
    }
    async function finishStop(turn: MultiRepositoryTurn, operation: Operation) {
      const w = operation.workspace!;
      const before = (await x.db.pool.query<{ result: { workspace_metadata: WorkspaceMetadata } }>('SELECT result FROM operations WHERE id=$1', [w.open_operation_id])).rows[0]!.result.workspace_metadata;
      const metadata: WorkspaceMetadata = { ...before, checkpoint: { operation_id: operation.operation_id,
        head_commit: before.finalized_commit, tree_id: 'e'.repeat(40), commit_id: 'f'.repeat(40) } };
      await x.service.finishOperation(x.f.runner, x.f.incarnation, { operation_id: operation.operation_id,
        attempt_id: turn.dispatch.attempt_id, success: true,
        result: { writer_absent: true, workspace_id: w.workspace_id, workspace_metadata: metadata } });
      return metadata;
    }
    async function checkpoint(turn: MultiRepositoryTurn, kind: 'block_node' | 'request_replan' = 'block_node') {
      const stopped = await stopOperations(turn, kind);
      for (const operation of stopped.operations) await finishStop(turn, operation);
      return stopped;
    }
    return { ...x, resources, admitOpen, finishOpen, open, openAll, admitCompletion, completionResult, settleCompletion, stopOperations, finishStop, checkpoint };
  } catch (error) { await x.close(); throw error; }
}
