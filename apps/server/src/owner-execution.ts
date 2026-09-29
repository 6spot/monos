import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { Dispatch, OwnerCommand, OwnerCommandResult, OwnerOperationStatus } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { assertCurrentNode } from './task-records.ts';
import { NodeExecution } from './node-execution.ts';
import { TaskPlanning } from './task-planning.ts';
import { admitWorkspaceEffect } from './workspaces.ts';

type Action = Exclude<OwnerCommand['name'], 'confirm_proposal'>;
interface Target { attempt_id: string; node_id?: string; node_activation?: number }
interface Attempt {
  id: string; runner_id: string; task_id: string; node_id: string | null; kind: 'node' | 'planner';
  node_activation: string; state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  mutation_allowed: boolean; process_absent: boolean; process_released: boolean; end_reason: string | null;
  recovery_consumed_by: string | null;
  specification_id: string | null; plan_id: string | null; launch: Dispatch; dispatch_id: string;
}
interface Task { id: string; control_version: string; state: string; specification_id: string; plan_id: string | null }
interface Operation { id: string; kind: string; state: string }

export async function derivedTaskState(tx: Transaction, planId: string): Promise<'RUNNING' | 'BLOCKED' | 'REVIEW'> {
  const rows = (await tx.query<{ state: string; runnable: boolean }>(`SELECT n.state,
    n.state='RUNNING' OR (n.state='PENDING' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(pn.definition->'dependencies','[]'::jsonb)) dep
      LEFT JOIN nodes upstream ON upstream.id=dep.value AND upstream.state='COMPLETED'
      LEFT JOIN node_completions c ON c.node_id=upstream.id AND c.activation=upstream.activation
      WHERE upstream.id IS NULL OR c.node_id IS NULL)) AS runnable
    FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id WHERE pn.plan_id=$1`, [planId])).rows;
  if (rows.some((row) => row.runnable)) return 'RUNNING';
  if (rows.some((row) => row.state !== 'COMPLETED')) return 'BLOCKED';
  const held = await tx.query(`SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.plan_id=$1 AND (NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled'))) UNION SELECT 1 FROM workspace_leases l JOIN tasks t ON t.id=l.task_id WHERE t.plan_id=$1 AND l.state<>'released'`, [planId]);
  return held.rowCount ? 'RUNNING' : 'REVIEW';
}

async function event(tx: Transaction, attempt: Attempt, kind: string, body: object, operationId: string | null) {
  const sequence = (await tx.query<{ event_sequence: string }>('UPDATE tasks SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence', [attempt.task_id])).rows[0]!.event_sequence;
  await tx.query('INSERT INTO task_events(task_id,sequence,kind,attempt_id,operation_id,body) VALUES($1,$2,$3,$4,$5,$6)', [attempt.task_id, sequence, kind, attempt.id, operationId, body]);
}

async function receipt(tx: Transaction, command: OwnerCommand, hash: string, envelope: string, response: OwnerCommandResult) {
  validate('OwnerCommandResult', response);
  await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [command.scope_id, command.request_id, hash, envelope, response]);
  return response;
}

async function existingTerminal(tx: Transaction, attempt: Attempt): Promise<Operation | undefined> {
  const completion = (await tx.query<Operation>("SELECT id,kind,state FROM operations WHERE attempt_id=$1 AND kind='complete_node' ORDER BY created_at LIMIT 1", [attempt.id])).rows[0];
  if (completion) return completion;
  const reply = (await tx.query<{ operation_id: string }>("SELECT operation_id FROM command_receipts WHERE attempt_id=$1 AND command_name='commit_task_turn' ORDER BY request_id LIMIT 1", [attempt.id])).rows[0];
  if (!reply) return undefined;
  return (await tx.query<Operation>('SELECT id,kind,state FROM operations WHERE id=$1', [reply.operation_id])).rows[0];
}

export async function executeOwnerAction(db: Database, token: string, command: OwnerCommand): Promise<OwnerCommandResult> {
  if ('source_id' in command.payload || command.name === 'recover_completion' || (command.name === 'cancel_task' && 'plan_id' in command.payload)) return new NodeExecution(db).command(token,command);
  if (command.name === 'start_task' || command.name === 'cancel_task' || 'planning_intent_id' in command.payload
    || (['stop_initial_planning', 'retry_initial_planning'].includes(command.name) && 'attempt_id' in command.payload
      && (await db.pool.query('SELECT 1 FROM attempts WHERE id=$1 AND planning_intent_id IS NOT NULL', [command.payload.attempt_id])).rowCount)) return new TaskPlanning(db).command(token, command);
  const action = command.name as Action;
  const target = command.payload as Target;
  const envelope = canonicalJSON(command); const hash = digest(envelope);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    // Replay is scoped to the authenticated Owner request, not to a fresh
    // interpretation of its payload. Check before resolving a possibly changed
    // Attempt target; recheck under the Task lock below for concurrent admission.
    const priorReceipt = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [command.scope_id, command.request_id])).rows[0];
    if (priorReceipt) {
      if (priorReceipt.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content');
      return priorReceipt.response;
    }
    const candidate = (await tx.query<{ runner_id: string; task_id: string }>('SELECT runner_id,task_id FROM attempts WHERE id=$1', [target.attempt_id])).rows[0];
    if (!candidate || candidate.task_id !== command.scope_id) throw new CommandError('denied_scope', 'Attempt is outside Task scope');
    await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [candidate.runner_id]);
    const task = (await tx.query<Task>('SELECT id,control_version,state,specification_id,plan_id FROM tasks WHERE id=$1 FOR UPDATE', [command.scope_id])).rows[0];
    if (!task) throw new CommandError('denied_scope', 'Unknown Task scope');
    const attempt = (await tx.query<Attempt>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [target.attempt_id])).rows[0];
    if (!attempt || attempt.runner_id !== candidate.runner_id || attempt.task_id !== task.id) throw new CommandError('denied_scope', 'Attempt ownership changed');
    const prior = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [task.id, command.request_id])).rows[0];
    if (prior) {
      if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content');
      return prior.response;
    }
    const nodeAction = action.endsWith('_node');
    if (nodeAction && attempt.launch.node_execution_source) throw new CommandError('denied_scope', 'Canonical Node controls require exact source and blocker targeting');
    if (nodeAction) {
      if (attempt.kind !== 'node' || attempt.node_id !== target.node_id || Number(attempt.node_activation) !== target.node_activation) throw new CommandError('denied_scope', 'Node Attempt binding differs');
      if (!task.plan_id || attempt.plan_id !== task.plan_id || attempt.specification_id !== task.specification_id) throw new CommandError('version_conflict', 'Attempt revision basis changed', Number(task.control_version));
      await assertCurrentNode(tx, { task_id: task.id, node_id: target.node_id!, node_activation: target.node_activation! });
    } else if (attempt.kind !== 'planner' || task.plan_id !== null || attempt.specification_id !== task.specification_id) {
      throw new CommandError('unmet_precondition', 'Initial Planner is no longer current');
    }
    if (action.startsWith('stop_')) {
      // Formal handoff admitted first owns the result. Never create a competing
      // terminal Stop that would wait on that completion while it waits on Stop.
      const terminal = await existingTerminal(tx, attempt);
      if (terminal && (attempt.state === 'SUCCEEDED' || !attempt.mutation_allowed)) {
        return receipt(tx, command, hash, envelope, { schema_version: 1, request_id: command.request_id,
          status: terminal.state === 'succeeded' ? 'committed' : 'admitted', operation_id: terminal.id,
          attempt_id: attempt.id, ...(attempt.node_id ? { node_id: attempt.node_id } : {}), control_version: Number(task.control_version) });
      }
    }
    if (Number(task.control_version) !== command.expected_control_version) throw new CommandError('version_conflict', 'Task control basis changed', Number(task.control_version));
    if (action.startsWith('stop_')) {
      if (attempt.state !== 'QUEUED' && (attempt.state !== 'RUNNING' || !attempt.mutation_allowed)) throw new CommandError('unmet_precondition', 'Attempt is not stoppable');
      if (nodeAction) {
        const node = (await tx.query<{ state: string }>('SELECT state FROM nodes WHERE id=$1', [attempt.node_id])).rows[0];
        if (node?.state !== (attempt.state === 'QUEUED' ? 'PENDING' : 'RUNNING')) throw new CommandError('unmet_precondition', 'Node is not owned by this Attempt');
      } else if (task.state !== 'RUNNING') throw new CommandError('unmet_precondition', 'Initial planning is not running');
      const queued = attempt.state === 'QUEUED';
      await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason='owner_stopped',process_absent=CASE WHEN $2::boolean THEN true ELSE process_absent END WHERE id=$1", [attempt.id, queued]);
      await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
      const operationId = queued ? null : await admitWorkspaceEffect(tx, attempt, 'stop', command.request_id);
      if (nodeAction) await tx.query("UPDATE nodes SET state='BLOCKED' WHERE id=$1", [attempt.node_id]);
      const state = nodeAction ? await derivedTaskState(tx, task.plan_id!) : 'PLANNING';
      await tx.query('UPDATE tasks SET state=$2,control_version=control_version+1 WHERE id=$1', [task.id, state]);
      await event(tx, attempt, 'owner_stopped', { ...(attempt.node_id ? { node_id: attempt.node_id, node_activation: Number(attempt.node_activation) } : {}), queued }, operationId);
      return receipt(tx, command, hash, envelope, { schema_version: 1, request_id: command.request_id,
        status: operationId ? 'admitted' : 'committed', ...(operationId ? { operation_id: operationId } : {}),
        attempt_id: attempt.id, ...(attempt.node_id ? { node_id: attempt.node_id } : {}), control_version: Number(task.control_version) + 1, end_reason: 'owner_stopped' });
    }
    if (attempt.state !== 'FAILED' && attempt.state !== 'CANCELLED') throw new CommandError('unmet_precondition', 'Attempt is not terminal and blocked');
    if (attempt.recovery_consumed_by) throw new CommandError('unmet_precondition', 'Old Attempt recovery decision was already consumed');
    if (!attempt.process_released || !attempt.process_absent) throw new CommandError('unmet_precondition', 'Old process has not been physically released');
    if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Old operations remain unresolved');
    if ((await tx.query("SELECT 1 FROM workspace_leases WHERE attempt_id=$1 AND state<>'released'", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Old workspace lease remains unresolved');
    if ((await tx.query("SELECT 1 FROM attempts WHERE owner_key=(SELECT owner_key FROM attempts WHERE id=$1) AND id<>$1 AND (state='QUEUED' OR NOT process_released OR EXISTS (SELECT 1 FROM operations WHERE operations.attempt_id=attempts.id AND operations.state NOT IN ('succeeded','cancelled')))", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Another owner claim remains unresolved');
    if (nodeAction) {
      if (!['RUNNING', 'BLOCKED'].includes(task.state)) throw new CommandError('unmet_precondition', 'Task is not eligible for Node recovery');
      const node = (await tx.query<{ state: string }>('SELECT state FROM nodes WHERE id=$1', [attempt.node_id])).rows[0];
      if (node?.state !== 'BLOCKED') throw new CommandError('unmet_precondition', 'Node is not blocked');
      if (action === 'continue_node' && attempt.end_reason !== 'owner_stopped') throw new CommandError('unmet_precondition', 'Continue requires an Owner-stopped Node');
      if (action === 'retry_node' && (attempt.state !== 'FAILED' || attempt.end_reason === 'owner_stopped')) throw new CommandError('unmet_precondition', 'Retry requires a factual failed Node');
      await tx.query("UPDATE nodes SET state='PENDING' WHERE id=$1", [attempt.node_id]);
      const state = await derivedTaskState(tx, task.plan_id!);
      await tx.query('UPDATE tasks SET state=$2,control_version=control_version+1 WHERE id=$1', [task.id, state]);
    } else {
      if (attempt.end_reason !== 'owner_stopped' && attempt.state !== 'FAILED') throw new CommandError('unmet_precondition', 'Planner is not stopped or failed');
      if (!['PLANNING', 'RUNNING'].includes(task.state)) throw new CommandError('unmet_precondition', 'Task cannot retry initial planning');
      await tx.query("UPDATE tasks SET state='RUNNING',control_version=control_version+1 WHERE id=$1", [task.id]);
    }
    await tx.query('UPDATE attempts SET recovery_consumed_by=$2 WHERE id=$1', [attempt.id, command.request_id]);
    await event(tx, attempt, action, { ...(attempt.node_id ? { node_id: attempt.node_id, node_activation: Number(attempt.node_activation) } : {}), prior_reason: attempt.end_reason }, null);
    return receipt(tx, command, hash, envelope, { schema_version: 1, request_id: command.request_id, status: 'committed',
      attempt_id: attempt.id, ...(attempt.node_id ? { node_id: attempt.node_id } : {}), control_version: Number(task.control_version) + 1 });
  });
}

export async function ownerOperationStatus(db: Database, token: string, taskId: string, operationId: string): Promise<OwnerOperationStatus> {
  validate('Id', taskId); validate('Id', operationId);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    if (!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rowCount) throw new CommandError('denied_scope', 'Unknown Task scope');
    const row = (await tx.query<{ attempt_id: string; kind: OwnerOperationStatus['kind']; state: OwnerOperationStatus['state']; cancelled_by_operation_id: string | null; failure_kind: string | null; end_reason: string | null; process_absent: boolean; process_released: boolean }>(`SELECT o.attempt_id,o.kind,o.state,o.cancelled_by_operation_id,o.failure_kind,a.end_reason,a.process_absent,a.process_released
      FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=$1 AND a.task_id=$2`, [operationId, taskId])).rows[0];
    if (!row) throw new CommandError('denied_scope', 'Operation is outside Task scope');
    return validate<OwnerOperationStatus>('OwnerOperationStatus', { schema_version: 1, task_id: taskId, operation_id: operationId,
      attempt_id: row.attempt_id, kind: row.kind, state: row.state, process_absent: row.process_absent,
      process_released: row.process_released, attention: row.state === 'recovery',
      ...(row.cancelled_by_operation_id ? { cancelled_by_operation_id: row.cancelled_by_operation_id } : {}),
      ...(row.failure_kind ? { failure_kind: row.failure_kind } : {}), ...(row.end_reason ? { end_reason: row.end_reason } : {}) });
  });
}
