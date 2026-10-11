import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { EffectResult, ReworkActivationMap, WorkspaceDescriptor, WorkspaceReworkHistory, WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import { assertNodeSource } from './node-execution-state.ts';
import type { WorkspaceAttempt } from './workspaces.ts';

// A checkpoint is historical input for exactly the request's applied target
// activations. It is never completion evidence or an automatic worktree replay.
export async function workspaceReworkHistory(tx: Transaction, attempt: WorkspaceAttempt, workspaceId: string): Promise<WorkspaceReworkHistory[]> {
  const source = attempt.launch.node_execution_source;
  if (!source || !attempt.task_id || !attempt.node_id) return [];
  await assertNodeSource(tx, attempt.task_id, source, attempt.id);
  const rows = (await tx.query<{
    id: string; agent_request_id: string; plan_id: string; requester_node_id: string;
    requester_activation: string; requester_attempt_id: string; stop_operation_id: string;
    lease_id: string; result: EffectResult; workspace_descriptor: WorkspaceDescriptor; workspace_digest: string;
    generation: string; storage_id: string; repository_identity: string; provider_metadata: unknown;
    base_commit: string; target_branch: string; activations: ReworkActivationMap;
  }>(`SELECT r.id,r.agent_request_id,r.plan_id,r.requester_node_id,r.requester_activation,
      r.requester_attempt_id,r.stop_operation_id,l.id AS lease_id,op.result,op.workspace_descriptor,op.workspace_digest,
      w.generation,w.storage_id,w.repository_identity,w.provider_metadata,w.base_commit,w.target_branch,
      (SELECT jsonb_agg(jsonb_build_object('node_id',x.node_id,'from_activation',x.from_activation,
        'to_activation',x.from_activation+1) ORDER BY x.node_id) FROM node_rework_targets x WHERE x.request_id=r.id) AS activations
    FROM node_rework_requests r JOIN node_rework_targets target ON target.request_id=r.id
    JOIN tasks t ON t.id=r.task_id JOIN task_workspaces w ON w.task_id=t.id AND w.id=$1
    JOIN attempts old ON old.id=r.requester_attempt_id
    JOIN operations op ON op.id=r.stop_operation_id AND op.attempt_id=old.id
    JOIN workspace_leases l ON l.id=op.workspace_lease_id AND l.workspace_id=w.id
    JOIN attempts current ON current.id=$2 JOIN nodes n ON n.id=current.node_id
    WHERE r.task_id=$3 AND r.status='applied' AND r.plan_id=$4 AND r.plan_id=t.plan_id
      AND r.specification_id=t.specification_id AND t.state='RUNNING'
      AND target.node_id=$5 AND target.from_activation+1=$6
      AND current.task_id=t.id AND current.node_id=target.node_id AND current.node_activation=$6
      AND current.plan_id=r.plan_id AND current.specification_id=r.specification_id
      AND current.node_execution_source_id=$7 AND current.launch->'node_execution_source'=$8::jsonb
      AND current.runner_id=$9 AND current.dispatch_id=$10 AND current.mutation_allowed
      AND NOT current.process_released AND NOT current.process_absent
      AND n.state='RUNNING' AND n.execution_source_id=current.node_execution_source_id AND n.activation=current.node_activation
      AND w.runner_id=current.runner_id AND w.ever_materialized
      AND old.task_id=t.id AND old.plan_id=r.plan_id AND old.specification_id=r.specification_id
      AND old.node_id=r.requester_node_id AND old.node_activation=r.requester_activation
      AND old.node_execution_source_id=r.requester_source_id AND old.runner_id=w.runner_id
      AND old.process_released AND old.process_absent AND NOT old.mutation_allowed
      AND op.kind='stop' AND op.state='succeeded' AND op.request_id=r.agent_request_id
      AND l.attempt_id=old.id AND l.task_id=t.id AND l.node_id=old.node_id AND l.node_activation=old.node_activation
      AND l.dispatch_id=old.dispatch_id AND l.settle_operation_id=op.id AND l.state='released'
      AND l.checkpoint=op.result->'workspace_metadata'->'checkpoint'
      AND NOT EXISTS(SELECT 1 FROM operations effect WHERE effect.attempt_id=old.id AND effect.state IN ('admitted','recovery'))
    ORDER BY r.id LIMIT 65`, [workspaceId, attempt.id, attempt.task_id, source.plan_id,
    attempt.node_id, attempt.node_activation, source.source_id, source, attempt.runner_id, attempt.dispatch_id])).rows;
  if (rows.length > 64) throw new CommandError('unmet_precondition', 'context_budget_exceeded: too many historical workspaces');
  return rows.map(row => {
    const m = row.result.workspace_metadata, w = row.workspace_descriptor;
    if (!m?.checkpoint || m.checkpoint.operation_id !== row.stop_operation_id || m.checkpoint.completion_operation_id
      || row.result.writer_absent !== true || row.result.workspace_id !== workspaceId
      || m.lease_id !== row.lease_id || m.generation !== Number(row.generation) || m.storage_id !== row.storage_id
      || m.repository_identity !== row.repository_identity || m.base_commit !== row.base_commit || m.target_branch !== row.target_branch
      || canonicalJSON(m.provider_metadata ?? null) !== canonicalJSON(row.provider_metadata)
      || !w || row.workspace_digest !== digest(canonicalJSON(w)) || w.workspace_id !== workspaceId
      || w.task_id !== attempt.task_id || w.runner_id !== attempt.runner_id || w.lease_id !== row.lease_id
      || w.node_id !== row.requester_node_id || w.node_activation !== Number(row.requester_activation)) {
      throw new CommandError('unmet_precondition', 'Applied Rework checkpoint evidence differs');
    }
    return validate<WorkspaceReworkHistory>('WorkspaceReworkHistory', {
      rework_request_id: row.id, rework_command_request_id: row.agent_request_id, plan_id: row.plan_id,
      from_node_id: row.requester_node_id, from_node_activation: Number(row.requester_activation),
      from_attempt_id: row.requester_attempt_id, from_lease_id: row.lease_id,
      settle_operation_id: row.stop_operation_id, metadata: m, rework_activations: row.activations,
    });
  });
}

export function reworkWorkspaceTransfer(attempt: WorkspaceAttempt, workspace: {
  id: string; resource_id: string; finalized_commit: string | null;
}, leaseId: string, histories: WorkspaceReworkHistory[]): WorkspaceTransfer | undefined {
  const h = histories.find(history => history.from_lease_id === leaseId);
  if (!h || h.metadata.finalized_commit !== workspace.finalized_commit) return;
  return validate('WorkspaceTransfer', {
    purpose: 'rework', kind: 'checkpoint', workspace_id: workspace.id, task_id: attempt.task_id,
    resource_id: workspace.resource_id, runner_id: attempt.runner_id,
    from_plan_id: h.plan_id, to_plan_id: h.plan_id,
    from_node_id: h.from_node_id, from_node_activation: h.from_node_activation,
    from_attempt_id: h.from_attempt_id, from_lease_id: h.from_lease_id,
    to_node_id: attempt.node_id, to_node_activation: Number(attempt.node_activation),
    settle_operation_id: h.settle_operation_id, metadata: h.metadata,
    rework_request_id: h.rework_request_id, rework_command_request_id: h.rework_command_request_id,
    rework_activations: h.rework_activations,
  });
}
