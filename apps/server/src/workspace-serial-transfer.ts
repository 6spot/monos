import type { Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { EffectResult, WorkspaceDescriptor, WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import { assertNodeSource } from './node-execution-state.ts';
import type { WorkspaceAttempt } from './workspaces.ts';

// This is physical lineage, not current completion applicability. A completed
// activation may have been invalidated by Review Rework while its tree remains
// the Task's most recent finalized workspace.
export async function serialWorkspaceTransfer(
  tx: Transaction, attempt: WorkspaceAttempt, workspaceId: string, leaseId: string
): Promise<WorkspaceTransfer | undefined> {
  const target = attempt.launch.node_execution_source;
  if (!target || !attempt.task_id || !attempt.node_id) return;
  await assertNodeSource(tx, attempt.task_id, target, attempt.id);
  const row = (await tx.query<{
    from_plan_id: string; from_node_id: string; from_node_activation: string;
    from_attempt_id: string; resource_id: string; generation: string;
    storage_id: string; repository_identity: string; provider_metadata: unknown;
    base_commit: string; target_branch: string; finalized_commit: string;
    settle_operation_id: string; completion_manifest_digest: string;
    workspace_descriptor: WorkspaceDescriptor; workspace_digest: string;
    result: EffectResult; completion_result: EffectResult & { completion_manifest_digest: string };
  }>(`SELECT old.plan_id AS from_plan_id,l.node_id AS from_node_id,
      l.node_activation AS from_node_activation,l.attempt_id AS from_attempt_id,
      w.resource_id,w.generation,w.storage_id,w.repository_identity,w.provider_metadata,
      w.base_commit,w.target_branch,w.finalized_commit,l.settle_operation_id,
      op.completion_manifest_digest,item.workspace_descriptor,item.workspace_digest,
      item.result||jsonb_build_object('writer_absent',op.result->'writer_absent') result,
      (SELECT completed.value FROM jsonb_array_elements(c.result->'workspace_results') completed WHERE completed.value->>'resource_id'=w.resource_id)
        ||jsonb_build_object('completion_manifest_digest',c.result->'completion_manifest_digest') completion_result
    FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id
    JOIN attempts old ON old.id=l.attempt_id
    JOIN operations op ON op.id=l.settle_operation_id AND op.attempt_id=old.id
    JOIN LATERAL operation_workspace_results(op.id) item ON item.lease_id=l.id
    JOIN completion_manifests m ON m.operation_id=op.id AND m.attempt_id=old.id
    JOIN node_completions c ON c.operation_id=op.id AND c.attempt_id=old.id
    JOIN attempts current ON current.id=$3
    JOIN nodes n ON n.id=current.node_id
    WHERE w.id=$1 AND l.id=$2 AND w.task_id=$4 AND w.runner_id=$5 AND w.ever_materialized
      AND l.state='released' AND l.checkpoint IS NULL
      AND l.task_id=w.task_id AND l.dispatch_id=old.dispatch_id
      AND l.generation=w.generation AND l.node_id=old.node_id AND l.node_activation=old.node_activation
      AND old.task_id=w.task_id AND old.runner_id=w.runner_id AND old.plan_id=$6
      AND old.process_released AND old.process_absent AND NOT old.mutation_allowed
      AND op.kind='complete_node' AND op.state='succeeded' AND op.result->>'completion_outcome'='finalized'
      AND m.task_id=w.task_id AND m.node_id=l.node_id AND m.node_activation=l.node_activation
      AND m.plan_id=old.plan_id AND m.specification_id=old.specification_id
      AND m.source_id=old.node_execution_source_id AND m.content_digest=op.completion_manifest_digest
      AND c.node_id=l.node_id AND c.activation=l.node_activation
      AND current.task_id=w.task_id AND current.runner_id=w.runner_id
      AND current.plan_id=old.plan_id AND current.node_execution_source_id=$7
      AND current.node_id=$8 AND current.node_activation=$9 AND current.dispatch_id=$10
      AND current.launch->'node_execution_source'=$11::jsonb
      AND current.mutation_allowed AND NOT current.process_released AND NOT current.process_absent
      AND n.state='RUNNING'
      AND EXISTS(SELECT 1 FROM plan_nodes WHERE plan_id=old.plan_id AND node_id=old.node_id)
      AND EXISTS(SELECT 1 FROM plan_nodes WHERE plan_id=current.plan_id AND node_id=current.node_id)
      AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=w.id
        AND (later.created_at,later.id)>(l.created_at,l.id))
      AND NOT EXISTS(SELECT 1 FROM workspace_leases live WHERE live.task_id=w.task_id AND live.attempt_id<>current.id AND live.state<>'released')
      AND NOT EXISTS(SELECT 1 FROM attempts writer WHERE writer.task_id=w.task_id AND writer.kind='node' AND writer.id<>current.id
        AND (writer.mutation_allowed OR NOT writer.process_released))
      AND NOT EXISTS(SELECT 1 FROM operations effect JOIN attempts owner ON owner.id=effect.attempt_id
        WHERE owner.task_id=w.task_id AND owner.kind='node' AND owner.id<>current.id AND effect.state IN ('admitted','recovery'))`,
  [workspaceId, leaseId, attempt.id, attempt.task_id, attempt.runner_id, target.plan_id,
    target.source_id, attempt.node_id, attempt.node_activation, attempt.dispatch_id, target])).rows[0];
  if (!row) return;
  const metadata = row.result.workspace_metadata, descriptor = row.workspace_descriptor;
  if (!metadata || !descriptor || metadata.checkpoint || row.result.writer_absent !== true
    || row.result.workspace_id !== workspaceId || row.result.git_commit !== row.finalized_commit || !row.result.git_tree
    || metadata.lease_id !== leaseId || metadata.generation !== Number(row.generation)
    || metadata.storage_id !== row.storage_id || metadata.repository_identity !== row.repository_identity
    || canonicalJSON(metadata.provider_metadata ?? null) !== canonicalJSON(row.provider_metadata)
    || metadata.base_commit !== row.base_commit || metadata.target_branch !== row.target_branch
    || metadata.finalized_commit !== row.finalized_commit
    || row.workspace_digest !== digest(canonicalJSON(descriptor))
    || descriptor.workspace_id !== workspaceId || descriptor.lease_id !== leaseId
    || descriptor.task_id !== attempt.task_id || descriptor.runner_id !== attempt.runner_id
    || descriptor.resource_id !== row.resource_id || descriptor.node_id !== row.from_node_id
    || descriptor.node_activation !== Number(row.from_node_activation)
    || row.completion_result.completion_manifest_digest !== row.completion_manifest_digest
    || row.completion_result.git_commit !== row.result.git_commit || row.completion_result.git_tree !== row.result.git_tree
    || canonicalJSON(row.completion_result.workspace_metadata) !== canonicalJSON(metadata)) return;
  return validate('WorkspaceTransfer', {
    purpose: 'serial', kind: 'completed', workspace_id: workspaceId, task_id: attempt.task_id,
    resource_id: row.resource_id, runner_id: attempt.runner_id,
    from_plan_id: row.from_plan_id, to_plan_id: target.plan_id,
    from_node_id: row.from_node_id, from_node_activation: Number(row.from_node_activation),
    from_attempt_id: row.from_attempt_id, from_lease_id: leaseId,
    to_node_id: attempt.node_id, to_node_activation: Number(attempt.node_activation),
    settle_operation_id: row.settle_operation_id, completion_operation_id: row.settle_operation_id,
    completion_manifest_digest: row.completion_manifest_digest, finalized_tree: row.result.git_tree, metadata,
  });
}
