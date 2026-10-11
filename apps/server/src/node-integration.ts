import type { Transaction } from '../../../packages/db/src/index.ts';
import type { OperationResult } from '../../../packages/protocol/src/index.ts';
import type { AttemptRow, OperationRow } from './service.ts';
import { blockNodeSource, prepareNodeSource } from './node-execution-state.ts';
import type { ExecutionNode, NodeSource, NodeTask } from './node-execution-state.ts';
import { specificationFrozen } from './task-specification-state.ts';
import { planningEvent } from './task-planning-state.ts';
import { refreshTaskState } from './node-completion.ts';

/** A completed physical conflict is historical input, never Node completion. The
 * source intent is committed with its settlement so a restart cannot lose retry. */
export async function retryIntegrationConflict(tx: Transaction,
  attempt: Pick<AttemptRow, 'id' | 'task_id' | 'node_id' | 'node_activation' | 'specification_id' | 'plan_id' | 'launch'>,
  operation: Pick<OperationRow, 'id'>,
  message: OperationResult, configurationVersion: number): Promise<void> {
  if (!(await tx.query("SELECT 1 FROM task_events WHERE task_id=$1 AND operation_id=$2 AND kind='node_integration_conflict'",
    [attempt.task_id, operation.id])).rowCount) {
    await planningEvent(tx, attempt.task_id!, 'node_integration_conflict', {
      node_id: attempt.node_id, node_activation: Number(attempt.node_activation), workspace_results: message.result.workspace_results,
    }, attempt.id, operation.id);
  }
  const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!;
  const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [attempt.node_id])).rows[0]!;
  if (!['RUNNING', 'BLOCKED'].includes(task.state) || await specificationFrozen(tx, task.id)
    || task.specification_id !== attempt.specification_id || task.plan_id !== attempt.plan_id
    || node.activation !== attempt.node_activation || node.execution_source_id !== attempt.launch.node_execution_source?.source_id
    || (await tx.query("SELECT 1 FROM replan_requests WHERE task_id=$1 AND status='pending'", [task.id])).rowCount) return;
  if (node.guidance_paused) {
    const source = (await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1', [node.execution_source_id])).rows[0]!;
    await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
    await blockNodeSource(tx, source, 'owner_stopped', 'owner_stopped', attempt.id);
    return;
  }
  const failures = Number((await tx.query<{ count: string }>(`SELECT count(*) FROM operations op JOIN attempts a ON a.id=op.attempt_id
    WHERE a.task_id=$1 AND a.node_id=$2 AND a.node_activation=$3 AND op.kind='complete_node'
      AND op.state='succeeded' AND op.result->>'completion_outcome'='conflict'
      AND op.created_at>=COALESCE((SELECT max(created_at) FROM node_execution_outbox WHERE task_id=$1 AND node_id=$2
        AND node_activation=$3 AND owner_request_id IS NOT NULL),'-infinity'::timestamptz)`, [task.id, node.id, node.activation])).rows[0]!.count);
  if (failures >= 3) {
    const source = (await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1', [node.execution_source_id])).rows[0]!;
    await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
    await blockNodeSource(tx, source, 'factual', 'integration_conflict_limit: repeated concurrent Git conflicts; inspect retained results and retry the Node', attempt.id);
    await refreshTaskState(tx, task.id);
    return;
  }
  await tx.query("UPDATE node_execution_outbox SET done=true WHERE id=$1", [node.execution_source_id]);
  await tx.query("UPDATE nodes SET state='PENDING',blocker_id=NULL WHERE id=$1", [node.id]);
  const fresh = (await tx.query<NodeTask>("UPDATE tasks SET state='RUNNING',control_version=control_version+1 WHERE id=$1 RETURNING *", [task.id])).rows[0]!;
  await prepareNodeSource(tx, fresh, { ...node, state: 'PENDING', blocker_id: null }, configurationVersion, {
    recovery: { integration_conflict: { operation_id: operation.id, attempt_id: attempt.id,
      workspace_results: message.result.workspace_results } },
  });
}
