import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { ReplanImpact, WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import { assertNodeSource } from './node-execution-state.ts';
import type { WorkspaceAttempt } from './workspaces.ts';
import { reservationsIsolated } from './workspace-placement.ts';

/** Called while the canonical workspace row is locked. Private input has one
 * recipient; each approved reader of completed code gets an exact transfer. */
export async function workspaceTransfer(tx: Transaction, attempt: WorkspaceAttempt, workspaceId: string, leaseId: string): Promise<WorkspaceTransfer | undefined> {
  const source = attempt.launch.node_execution_source;
  if (!source || !attempt.task_id || !attempt.node_id) return;
  await assertNodeSource(tx, attempt.task_id, source, attempt.id);
  const row = (await tx.query<{
    publication_id: string; proposal_id: string; plan_id: string; specification_id: string;
    disposition: ReplanImpact['workspaces'][number]; prior: WorkspaceTransfer | null;
  }>(`SELECT p.id publication_id,p.proposal_id,t.plan_id,t.specification_id,w.value disposition,x.descriptor prior
    FROM tasks t JOIN replan_publications p ON p.task_id=t.id AND p.new_plan_id=t.plan_id
    JOIN replan_proposals proposal ON proposal.id=p.proposal_id
    CROSS JOIN LATERAL jsonb_array_elements(proposal.content->'impact'->'workspaces') w
    LEFT JOIN replan_workspace_transfers x ON x.publication_id=p.id AND x.from_lease_id=$3
      AND (w.value->'input'->>'kind'='checkpoint' OR (x.target_node_id=$4 AND x.target_node_activation=$5))
    WHERE t.id=$1 AND w.value->'input'->>'workspace_id'=$2 AND w.value->'input'->>'from_lease_id'=$3`,
  [attempt.task_id, workspaceId, leaseId, attempt.node_id, attempt.node_activation])).rows[0];
  if (!row) return;
  const { input, target_nodes: targets } = row.disposition;
  const approved = targets.find(n => n.node_id === attempt.node_id && (input.kind === 'checkpoint'
    ? n.node_activation === Number(attempt.node_activation) : n.node_activation <= Number(attempt.node_activation)));
  if (!approved || !(await tx.query('SELECT 1 WHERE activation_applies($1,$2,$3,$4,$5)',
    [attempt.task_id, attempt.node_id, approved.node_activation, row.specification_id, row.plan_id])).rowCount) {
    throw new CommandError('unmet_precondition', 'Workspace adoption is outside the exact approved Node scope');
  }
  if (row.prior) {
    if (row.prior.to_node_id !== attempt.node_id || row.prior.to_node_activation !== Number(attempt.node_activation)) throw new CommandError('unmet_precondition', 'Workspace adoption already belongs to another activation');
    return row.prior;
  }
  // Recheck the physical predecessor, including original Plan attribution. A
  // later Rework can use finalized code without carrying its completion evidence.
  const physical = (await tx.query<{ metadata: unknown }>(`SELECT item.result->'workspace_metadata' metadata
    FROM task_workspaces w JOIN workspace_leases l ON l.workspace_id=w.id JOIN attempts old ON old.id=l.attempt_id
    JOIN operations op ON op.id=$4 AND op.attempt_id=old.id
    JOIN LATERAL operation_workspace_results(op.id) item ON item.lease_id=l.id
    WHERE w.id=$1 AND w.task_id=$2 AND w.runner_id=$3 AND w.ever_materialized
      AND l.id=$5 AND l.state='released' AND l.node_id=$6 AND l.node_activation=$7 AND l.attempt_id=$8
      AND old.plan_id=$9 AND old.process_released AND old.process_absent AND NOT old.mutation_allowed
      AND op.state='succeeded' AND op.result->>'writer_absent'='true'
      AND (CASE WHEN $10='checkpoint' THEN l.checkpoint->>'operation_id'=$4 ELSE l.checkpoint IS NULL AND l.settle_operation_id=$4 END)
      AND ($10<>'checkpoint' OR NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=w.id
        AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id)))
      AND NOT EXISTS(SELECT 1 FROM workspace_leases live WHERE live.task_id=w.task_id AND live.attempt_id<>$11 AND live.state<>'released'
        AND (NOT $12::boolean OR live.allocation_id IS NULL OR ($10='checkpoint' AND live.allocation_id=l.allocation_id)))
      AND NOT EXISTS(SELECT 1 FROM attempts writer WHERE writer.task_id=w.task_id AND writer.kind='node' AND writer.id<>$11
        AND (writer.mutation_allowed OR NOT writer.process_released)
        AND (NOT $12::boolean OR NOT workspace_reservations_isolated(writer.launch->'workspace_reservations')))
      AND NOT EXISTS(SELECT 1 FROM operations effect JOIN attempts owner ON owner.id=effect.attempt_id
        WHERE owner.task_id=w.task_id AND owner.kind='node' AND owner.id<>$11 AND effect.state IN ('admitted','recovery')
        AND (NOT $12::boolean OR NOT workspace_reservations_isolated(owner.launch->'workspace_reservations')))`,
  [workspaceId, attempt.task_id, attempt.runner_id, input.settle_operation_id, leaseId, input.from_node_id,
    input.from_node_activation, input.from_attempt_id, input.from_plan_id, input.kind, attempt.id, reservationsIsolated(attempt.launch.workspace_reservations)])).rows[0];
  if (!physical || canonicalJSON(physical.metadata) !== canonicalJSON(input.metadata)) throw new CommandError('unmet_precondition', 'Approved workspace predecessor is no longer exact and settled');
  const descriptor = validate<WorkspaceTransfer>('WorkspaceTransfer', { ...input, publication_id: row.publication_id,
    proposal_id: row.proposal_id, to_plan_id: row.plan_id, to_node_id: attempt.node_id, to_node_activation: Number(attempt.node_activation) });
  await tx.query('INSERT INTO replan_workspace_transfers(id,task_id,publication_id,workspace_id,target_node_id,target_node_activation,descriptor) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), attempt.task_id, row.publication_id, workspaceId, attempt.node_id, attempt.node_activation, descriptor]);
  return descriptor;
}

/** A private checkpoint cannot disappear through repository-free completion,
 * even before a first opener has materialized the transfer receipt. */
export async function hasUnadoptedReplanCheckpoint(tx: Transaction, attempt: WorkspaceAttempt): Promise<boolean> {
  return !!attempt.task_id && !!attempt.node_id && hasUnadoptedCheckpointTargets(tx, attempt.task_id, [attempt.node_id]);
}

/** Reactivating any affected target, including an unstarted descendant, must
 * not abandon an exact private-work assignment. */
export async function hasUnadoptedCheckpointTargets(tx: Transaction, taskId: string, nodeIds: string[]): Promise<boolean> {
  return !!(await tx.query(`SELECT 1 FROM tasks t JOIN replan_publications p ON p.task_id=t.id AND p.new_plan_id=t.plan_id
    JOIN replan_proposals proposal ON proposal.id=p.proposal_id
    CROSS JOIN LATERAL jsonb_array_elements(proposal.content->'impact'->'workspaces') w
    JOIN workspace_leases l ON l.id=w.value->'input'->>'from_lease_id'
    WHERE t.id=$1 AND w.value->'input'->>'kind'='checkpoint'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.value->'target_nodes') target
        JOIN nodes n ON n.id=target->>'node_id' AND n.task_id=t.id
        WHERE n.id=ANY($2::text[]) AND (target->>'node_activation')::bigint<=n.activation)
      AND NOT EXISTS(SELECT 1 FROM workspace_leases later WHERE later.workspace_id=l.workspace_id AND later.allocation_id IS NOT DISTINCT FROM l.allocation_id AND (later.created_at,later.id)>(l.created_at,l.id))`,
  [taskId, nodeIds])).rowCount;
}
