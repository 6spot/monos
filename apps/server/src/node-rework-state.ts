import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, NodeReworkOutcome } from '../../../packages/protocol/src/index.ts';
import type { AttemptRow } from './service.ts';
import type { NodeSource, NodeTask } from './node-execution-state.ts';
import { blockNodeSource } from './node-execution-state.ts';
import { assertSpecificationUnfrozen } from './task-specification-state.ts';
import { assertNoReplan } from './task-replan-state.ts';
import { reactivateSettledNodes } from './task-records.ts';
import { planningEvent } from './task-planning-state.ts';
import { admitWorkspaceStops } from './workspaces.ts';
import { supersedeRuntimeContinuation } from './runtime-continuation-state.ts';
import { derivedTaskState } from './owner-execution.ts';
import { hasUnadoptedCheckpointTargets } from './task-replan-workspaces.ts';

export interface NodeReworkRequest {
  id: string; task_id: string; specification_id: string; plan_id: string;
  requester_node_id: string; requester_activation: string; requester_source_id: string;
  requester_attempt_id: string; agent_request_id: string; target_node_id: string; reason: string;
  budget_epoch: string; automatic_ordinal: number | null;
  status: 'settling' | 'limit_blocked' | 'applied' | 'continued' | 'cancelled';
  version: string; blocker_id: string | null;
  owner_decision_request_id: string | null; applied_control_version: string | null;
  continued_source_id: string | null; attention: string | null;
}
export interface NodeReworkTarget {
  request_id: string; task_id: string; node_id: string; from_activation: string;
  source_id: string | null; completion_operation_id: string | null; completion_manifest_digest: string | null;
}
interface Member { node_id: string; definition: { dependencies: string[] } }
const pending = "status IN ('settling','limit_blocked')";

export async function currentNodeRework(tx: Transaction, taskId: string, nodeId: string): Promise<NodeReworkRequest | undefined> {
  return (await tx.query<NodeReworkRequest>(`SELECT r.* FROM node_rework_requests r WHERE r.task_id=$1 AND
    (r.status='limit_blocked' AND r.requester_node_id=$2 OR r.status='settling' AND EXISTS(
      SELECT 1 FROM node_rework_targets x WHERE x.request_id=r.id AND x.node_id=$2))`, [taskId, nodeId])).rows[0];
}
// Guidance/Owner recovery of a completed ancestor also reactivates descendants.
// Protect a preserved requester even when the ancestor itself has no direct hold.
export async function reactivationNodeRework(tx: Transaction, taskId: string, nodeId: string): Promise<NodeReworkRequest | undefined> {
  return (await tx.query<NodeReworkRequest>(`SELECT r.* FROM node_rework_requests r JOIN tasks t ON t.id=r.task_id WHERE r.task_id=$1 AND
    (r.status='limit_blocked' AND r.requester_node_id=ANY(node_rework_closure(t.plan_id,$2)) OR r.status='settling' AND EXISTS(
      SELECT 1 FROM node_rework_targets x WHERE x.request_id=r.id AND x.node_id=ANY(node_rework_closure(t.plan_id,$2))))`, [taskId, nodeId])).rows[0];
}
export async function assertNoTaskRework(tx: Transaction, taskId: string): Promise<void> {
  if ((await tx.query(`SELECT 1 FROM node_rework_requests WHERE task_id=$1 AND ${pending}`, [taskId])).rowCount)
    throw new CommandError('unmet_precondition', 'An unresolved upstream Rework request owns its affected work');
}
export async function cancelTaskRework(tx: Transaction, taskId: string): Promise<void> {
  await tx.query(`UPDATE node_rework_requests SET status='cancelled',version=version+1,attention=NULL WHERE task_id=$1 AND ${pending}`, [taskId]);
}
export async function reworkRequest(tx: Transaction, taskId: string, id: string, lock = false): Promise<NodeReworkRequest> {
  const row = (await tx.query<NodeReworkRequest>(`SELECT * FROM node_rework_requests WHERE task_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [taskId, id])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown upstream Rework request');
  return row;
}
export async function reworkTargets(tx: Transaction, id: string): Promise<NodeReworkTarget[]> {
  return (await tx.query<NodeReworkTarget>('SELECT * FROM node_rework_targets WHERE request_id=$1 ORDER BY node_id', [id])).rows;
}
export async function reworkUsage(tx: Transaction, taskId: string): Promise<number> {
  return Number((await tx.query(`SELECT count(*) n FROM node_rework_requests r JOIN tasks t ON t.id=r.task_id
    WHERE r.task_id=$1 AND r.budget_epoch=t.rework_epoch AND r.automatic_ordinal IS NOT NULL`, [taskId])).rows[0].n);
}
export async function reworkOutcome(tx: Transaction, request: NodeReworkRequest): Promise<NodeReworkOutcome> {
  return validate('NodeReworkOutcome', {
    rework_request_id: request.id, status: request.status, version: Number(request.version),
    target_node_id: request.target_node_id, affected_node_ids: (await reworkTargets(tx, request.id)).map(x => x.node_id),
    automatic_requests_used: await reworkUsage(tx, request.task_id), limit: 3,
  });
}
function closure(members: Member[], target: string): string[] {
  const affected = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of members) if (!affected.has(member.node_id) && member.definition.dependencies.some(id => affected.has(id))) {
      affected.add(member.node_id); changed = true;
    }
  }
  return [...affected].sort();
}
async function noCompetingChange(tx: Transaction, taskId: string): Promise<void> {
  await assertSpecificationUnfrozen(tx, taskId);
  await assertNoReplan(tx, taskId);
  if ((await tx.query(`SELECT 1 FROM task_review_feedback WHERE task_id=$1 AND status='active'
    UNION ALL SELECT 1 FROM task_review_operations WHERE task_id=$1 AND settlement_pending LIMIT 1`, [taskId])).rowCount)
    throw new CommandError('unmet_precondition', 'Review correction must settle before upstream Rework');
}
async function noOwnerHolds(tx: Transaction, taskId: string, ids: string[]): Promise<void> {
  if ((await tx.query(`SELECT 1 FROM nodes n LEFT JOIN node_blockers b ON b.id=n.blocker_id
    WHERE n.task_id=$1 AND n.id=ANY($2::text[]) AND (n.guidance_paused OR b.kind='owner_stopped'
      OR EXISTS(SELECT 1 FROM replan_control_holds h JOIN replan_publications p ON p.id=h.publication_id JOIN tasks current_task ON current_task.id=h.task_id WHERE h.node_id=n.id AND h.node_activation=n.activation AND h.resolved_by IS NULL AND p.new_plan_id=current_task.plan_id))`, [taskId, ids])).rowCount)
    throw new CommandError('unmet_precondition', 'Affected Owner Stop or independent control holds must be resolved before Rework');
}

// The caller owns configuration, requester Runner, Task and Attempt locks and
// checks its command receipt before entering. Strict serial execution makes the
// requester the only live Node; completed/pending descendants have no writers.
export async function requestNodeRework(
  tx: Transaction, task: NodeTask, attempt: AttemptRow, source: NodeSource, command: CommandEnvelope,
): Promise<{ result: { rework_outcome: NodeReworkOutcome }; operation_id: string }> {
  if (command.name !== 'request_rework' || attempt.kind !== 'node' || !attempt.mutation_allowed || attempt.process_released ||
      task.state !== 'RUNNING' || source.node_id !== attempt.node_id || source.planned_attempt_id !== attempt.id)
    throw new CommandError('denied_scope', 'Upstream Rework requires the current canonical Node');
  validate('PlanningText', command.payload.reason);
  const reason = command.payload.reason!;
  if (!reason.trim()) throw new CommandError('invalid_input', 'Rework reason must be nonblank');
  await noCompetingChange(tx, task.id);
  await assertNoTaskRework(tx, task.id);
  const members = (await tx.query<Member>('SELECT node_id,definition FROM plan_nodes WHERE plan_id=$1 ORDER BY node_id', [task.plan_id])).rows;
  const requester = members.find(x => x.node_id === source.node_id);
  if (!requester) throw new CommandError('denied_scope', 'Requester is outside the current Plan');
  const target = command.payload.target_node_id ?? (requester.definition.dependencies.length === 1 ? requester.definition.dependencies[0] : undefined);
  if (!target) throw new CommandError('invalid_input', 'Choose one explicit upstream target when there is not exactly one direct dependency');
  const ancestors = new Set(requester.definition.dependencies);
  const visit = [...ancestors];
  for (let i = 0; i < visit.length; i++) for (const parent of members.find(x => x.node_id === visit[i])?.definition.dependencies ?? [])
    if (!ancestors.has(parent)) { ancestors.add(parent); visit.push(parent); }
  if (!ancestors.has(target)) throw new CommandError('denied_scope', 'Rework target must be upstream in the current Plan');
  const ids = closure(members, target);
  if (await hasUnadoptedCheckpointTargets(tx, task.id, ids))
    throw new CommandError('unmet_precondition', 'Open the approved inherited private workspace before reactivating its target');
  await noOwnerHolds(tx, task.id, ids);
  if ((await tx.query(`SELECT 1 FROM attempts a WHERE a.task_id=$1 AND a.kind='node' AND a.id<>$2 AND
    (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN('succeeded','cancelled')))
    UNION ALL SELECT 1 FROM workspace_leases WHERE task_id=$1 AND attempt_id<>$2 AND state<>'released' LIMIT 1`, [task.id, attempt.id])).rowCount)
    throw new CommandError('unmet_precondition', 'Other Node ownership must settle before serial Rework');
  if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN('succeeded','cancelled')", [attempt.id])).rowCount)
    throw new CommandError('unmet_precondition', 'Earlier workspace effects must settle before Rework');
  const epoch = (await tx.query<{ rework_epoch: string }>('SELECT rework_epoch FROM tasks WHERE id=$1', [task.id])).rows[0]!.rework_epoch;
  const used = await reworkUsage(tx, task.id), limited = used >= 3, id = randomUUID();
  const targets = (await tx.query<Omit<NodeReworkTarget, 'request_id'>>(`SELECT n.task_id,n.id node_id,n.activation from_activation,n.execution_source_id source_id,
    c.operation_id completion_operation_id,m.content_digest completion_manifest_digest FROM nodes n
    LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id
    WHERE n.task_id=$1 AND n.id=ANY($2::text[]) ORDER BY n.id FOR UPDATE OF n`, [task.id, ids])).rows;
  const current = targets.find(x => x.node_id === source.node_id);
  if (!current || current.source_id !== source.id || current.from_activation !== source.node_activation)
    throw new CommandError('stale_execution', 'Requester activation or source changed');
  let blocker: string | null = null;
  if (limited) blocker = await blockNodeSource(tx, source, 'semantic', `Rework limit reached: ${reason}`, attempt.id);
  const stoppedIds = limited ? [source.node_id] : ids;
  for (const previous of (await tx.query<{ id: string; planned_attempt_id: string }>(`SELECT s.id,s.planned_attempt_id FROM node_execution_outbox s
    JOIN nodes n ON n.execution_source_id=s.id WHERE n.task_id=$1 AND n.id=ANY($2::text[])`, [task.id, stoppedIds])).rows) {
    await supersedeRuntimeContinuation(tx, previous.planned_attempt_id, 'rework_requested');
    await tx.query("UPDATE node_execution_outbox SET done=true,waiting_reason='rework_requested' WHERE id=$1", [previous.id]);
  }
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason=$2 WHERE id=$1", [attempt.id, limited ? 'rework_limit' : 'rework_requested']);
  const stops = await admitWorkspaceStops(tx, attempt, command.request_id);
  const stop = stops[0]!;
  await tx.query(`INSERT INTO node_rework_requests(id,task_id,specification_id,plan_id,requester_node_id,requester_activation,requester_source_id,
    requester_attempt_id,agent_request_id,target_node_id,reason,budget_epoch,automatic_ordinal,status,blocker_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
  [id, task.id, task.specification_id, task.plan_id, source.node_id, source.node_activation, source.id, attempt.id, command.request_id, target, reason, epoch, limited ? null : used + 1, limited ? 'limit_blocked' : 'settling', blocker]);
  await tx.query(`INSERT INTO node_rework_request_stops(request_id,operation_id,workspace_id,lease_id)
    SELECT $1,id,workspace_descriptor->>'workspace_id',workspace_lease_id FROM operations WHERE id=ANY($2::text[])`, [id, stops]);
  for (const row of targets) await tx.query(`INSERT INTO node_rework_targets(request_id,task_id,node_id,from_activation,source_id,completion_operation_id,completion_manifest_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, task.id, row.node_id, row.from_activation, row.source_id, row.completion_operation_id, row.completion_manifest_digest]);
  await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
  await planningEvent(tx, task.id, limited ? 'node_rework_limit_reached' : 'node_rework_requested', { rework_request_id: id, target_node_id: target, affected_node_ids: ids, reason }, attempt.id, stop);
  return { result: { rework_outcome: await reworkOutcome(tx, await reworkRequest(tx, task.id, id)) }, operation_id: stop };
}

export async function reworkStopIds(tx: Transaction, requestId: string): Promise<string[]> {
  return (await tx.query<{ operation_id: string }>(`SELECT member.operation_id FROM node_rework_request_stops member
    JOIN operations o ON o.id=member.operation_id WHERE member.request_id=$1 ORDER BY o.resource_id NULLS FIRST,o.id`, [requestId])).rows.map(row => row.operation_id);
}
export async function reworkSettled(tx: Transaction, r: NodeReworkRequest): Promise<boolean> {
  return !!(await tx.query(`SELECT 1 FROM attempts a WHERE a.id=$1 AND a.process_absent AND a.process_released
    AND EXISTS(SELECT 1 FROM node_rework_request_stops WHERE request_id=$2)
    AND NOT EXISTS(SELECT 1 FROM node_rework_request_stops member JOIN operations o ON o.id=member.operation_id
      WHERE member.request_id=$2 AND (o.attempt_id<>a.id OR o.kind<>'stop' OR o.state<>'succeeded' OR o.request_id<>$3))
    AND NOT EXISTS(SELECT 1 FROM operations pending WHERE pending.attempt_id=a.id AND pending.state NOT IN('succeeded','cancelled'))
    AND NOT EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=a.id AND l.state<>'released')`, [r.requester_attempt_id, r.id, r.agent_request_id])).rowCount;
}
export async function checkReworkBasis(tx: Transaction, task: NodeTask, r: NodeReworkRequest): Promise<NodeReworkTarget[]> {
  if (task.specification_id !== r.specification_id || task.plan_id !== r.plan_id || !['RUNNING', 'BLOCKED'].includes(task.state))
    throw new CommandError('version_conflict', 'Rework Specification or Plan basis changed');
  await noCompetingChange(tx, task.id);
  const targets = await reworkTargets(tx, r.id), ids = targets.map(x => x.node_id);
  const members = (await tx.query<Member>('SELECT node_id,definition FROM plan_nodes WHERE plan_id=$1 ORDER BY node_id', [task.plan_id])).rows;
  if (canonicalJSON(closure(members, r.target_node_id)) !== canonicalJSON(ids)) throw new CommandError('version_conflict', 'Rework affected graph changed');
  await noOwnerHolds(tx, task.id, ids);
  for (const target of targets) {
    const node = (await tx.query<{ activation: string; execution_source_id: string | null; completion_operation_id: string | null; completion_manifest_digest: string | null }>(
      `SELECT n.activation,n.execution_source_id,c.operation_id completion_operation_id,m.content_digest completion_manifest_digest
       FROM nodes n LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
       LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE n.id=$1 AND n.task_id=$2`, [target.node_id, task.id])).rows[0];
    if (!node || node.activation !== target.from_activation || node.execution_source_id !== target.source_id ||
        node.completion_operation_id !== target.completion_operation_id || node.completion_manifest_digest !== target.completion_manifest_digest)
      throw new CommandError('version_conflict', 'Rework target activation, source or completion evidence changed');
  }
  return targets;
}
export async function assertReworkTargetsSettled(tx: Transaction, taskId: string, ids: string[]): Promise<void> {
  if ((await tx.query(`SELECT 1 FROM workspace_leases WHERE task_id=$1 AND node_id=ANY($2::text[]) AND state<>'released'
    UNION ALL SELECT 1 FROM attempts a WHERE a.task_id=$1 AND a.node_id=ANY($2::text[]) AND
     (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN('succeeded','cancelled'))) LIMIT 1`, [taskId, ids])).rowCount)
    throw new CommandError('unmet_precondition', 'Affected Rework ownership has not settled');
}
export async function advanceNodeRework(tx: Transaction, task: NodeTask, r: NodeReworkRequest): Promise<void> {
  if (task.state === 'CANCELLED') { await cancelTaskRework(tx, task.id); return; }
  if (r.status !== 'settling') return;
  if (!await reworkSettled(tx, r)) { await tx.query("UPDATE node_rework_requests SET attention='waiting_for_physical_settlement' WHERE id=$1", [r.id]); return; }
  try {
    const targets = await checkReworkBasis(tx, task, r), ids = targets.map(x => x.node_id);
    await assertReworkTargetsSettled(tx, task.id, ids);
    const affected = await reactivateSettledNodes(tx, { task_id: task.id, node_ids: [r.target_node_id], expected: {
      control_version: Number(task.control_version), specification_id: task.specification_id, plan_id: task.plan_id,
    } });
    if (canonicalJSON(affected) !== canonicalJSON(ids)) throw new Error('Rework closure changed under its Task lock');
    // Old follow-ups are replaced by the primitive's new activation guidance.
    await tx.query("UPDATE task_guidance_followups SET status='done' WHERE task_id=$1 AND node_id=ANY($2::text[]) AND status='waiting'", [task.id, ids]);
    if (r.owner_decision_request_id) await tx.query('UPDATE tasks SET rework_epoch=rework_epoch+1 WHERE id=$1', [task.id]);
    await tx.query("UPDATE node_rework_requests SET status='applied',version=version+1,attention=NULL,applied_control_version=$2 WHERE id=$1", [r.id, Number(task.control_version) + 1]);
    await tx.query('UPDATE tasks SET state=$2 WHERE id=$1', [task.id, await derivedTaskState(tx, task.plan_id)]);
    await planningEvent(tx, task.id, 'node_rework_applied', { rework_request_id: r.id, target_node_id: r.target_node_id, affected_node_ids: ids }, r.requester_attempt_id, (await reworkStopIds(tx, r.id))[0]);
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    await tx.query('UPDATE node_rework_requests SET attention=$2 WHERE id=$1', [r.id, error.message]);
  }
}
