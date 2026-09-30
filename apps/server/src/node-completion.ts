import { specificationFrozen } from './task-specification-state.ts';
import { settleHandledGuidance } from './task-guidance.ts';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON } from '../../../packages/protocol/src/index.ts';
import type { OperationResult } from '../../../packages/protocol/src/index.ts';
import type { AttemptRow, OperationRow } from './service.ts';
import { completionIdentity } from './node-execution.ts';
import { prepareNodeSource } from './node-execution-state.ts';
import type { NodeTask, ExecutionNode } from './node-execution-state.ts';
import { planningEvent } from './task-planning-state.ts';
import { assertCurrentNode } from './task-records.ts';
import { derivedTaskState } from './owner-execution.ts';
import { settleWorkspaceOperation } from './workspaces.ts';

async function taskEvent(tx: Transaction, attempt: AttemptRow, kind: string, body: object, operationId: string) {
  await planningEvent(tx, attempt.task_id!, kind, body, attempt.id, operationId);
}
export async function refreshTaskState(tx: Transaction, taskId: string): Promise<void> {
  if(await specificationFrozen(tx,taskId))return;
  const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0]!;
  if (task.plan_id && ['RUNNING', 'BLOCKED', 'REVIEW'].includes(task.state)) {
    const state = await derivedTaskState(tx, task.plan_id);
    if (state !== task.state)
      await tx.query('UPDATE tasks SET state=$2,control_version=control_version+1 WHERE id=$1', [taskId, state]);
  }
}
export async function projectCompletion(
  tx: Transaction,
  attempt: AttemptRow,
  operation: OperationRow,
  message: OperationResult
): Promise<void> {
  const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!;
  // A cancellation closes current evidence while retaining truthful physical settlement.
  if (task.state === 'CANCELLED' && attempt.launch.node_execution_source) {
    await taskEvent(tx, attempt, 'completion_settled_after_cancel', { node_id: attempt.node_id }, operation.id);
    return;
  }
  const changeOwned=!!(await tx.query('SELECT 1 FROM requirement_change_attempts ca JOIN task_publication_slots s ON s.operation_id=ca.change_id WHERE ca.attempt_id=$1',[attempt.id])).rowCount;
  if(changeOwned){
    const manifest=(await tx.query('SELECT * FROM completion_manifests WHERE operation_id=$1',[operation.id])).rows[0];
    if(!manifest || manifest.content_digest!==operation.completion_manifest_digest)throw new CommandError('denied_scope','Exact historical completion manifest missing');
    const result={...message.result,summary:manifest.summary,artifact_ids:manifest.artifact_ids,completion_manifest_digest:manifest.content_digest,...(manifest.manifest_version===2?{handled_guidance_ids:manifest.handled_guidance_ids}:{})};
    await tx.query('INSERT INTO node_completions(node_id,activation,attempt_id,operation_id,result) VALUES($1,$2,$3,$4,$5) ON CONFLICT(operation_id) DO NOTHING',[attempt.node_id,attempt.node_activation,attempt.id,operation.id,result]);
    await taskEvent(tx,attempt,'completion_settled_for_specification_change',{node_id:attempt.node_id},operation.id);return;
  }
  await assertCurrentNode(tx, {
    task_id: attempt.task_id!,
    node_id: attempt.node_id!,
    node_activation: Number(attempt.node_activation),
  });
  const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [attempt.node_id]))
    .rows[0]!;
  const blocked =
    node.state === 'BLOCKED' &&
    (operation.failure_kind === 'capture_hard_limit' ||
      operation.failure_kind === 'invalid_finalization' ||
      attempt.process_absent);
  if (
    Number(node.activation) !== Number(attempt.node_activation) ||
    (node.state !== 'RUNNING' && !blocked) ||
    !['RUNNING', 'BLOCKED'].includes(task.state) ||
    attempt.process_released
  )
    throw new CommandError('stale_execution', 'Completion activation is no longer current');
  const source = attempt.launch.node_execution_source;
  if (
    source &&
    (node.execution_source_id !== source.source_id ||
      attempt.specification_id !== task.specification_id ||
      attempt.plan_id !== task.plan_id)
  )
    throw new CommandError('stale_execution', 'Completion source differs');
  const manifest = source
    ? (
        await tx.query<{ summary: string; artifact_ids: string[]; content_digest: string; handled_guidance_ids:string[]; manifest_version:number }>(
          'SELECT summary,artifact_ids,content_digest,handled_guidance_ids,manifest_version FROM completion_manifests WHERE operation_id=$1',
          [operation.id]
        )
      ).rows[0]
    : undefined;
  if (source && (!manifest || manifest.content_digest !== operation.completion_manifest_digest))
    throw new CommandError('denied_scope', 'Frozen completion manifest is missing');
  const result = {
    ...message.result,
    ...(manifest
      ? {
          ...(manifest.manifest_version===2?{handled_guidance_ids:manifest.handled_guidance_ids}:{}),
          summary: manifest.summary,
          artifact_ids: manifest.artifact_ids,
          completion_manifest_digest: manifest.content_digest,
        }
      : {}),
  };
  if(source&&manifest)await settleHandledGuidance(tx,source.source_id,operation.id,manifest.handled_guidance_ids);
  await tx.query(
    'INSERT INTO node_completions(node_id,activation,attempt_id,operation_id,result) VALUES($1,$2,$3,$4,$5)',
    [attempt.node_id, attempt.node_activation, attempt.id, operation.id, result]
  );
  await tx.query("UPDATE nodes SET state='COMPLETED',result=$2,blocker_id=NULL WHERE id=$1", [attempt.node_id, result]);
  await tx.query('UPDATE tasks SET state=$2,control_version=control_version+1 WHERE id=$1', [
    task.id,
    await derivedTaskState(tx, task.plan_id),
  ]);
  await taskEvent(
    tx,
    attempt,
    'node_completed',
    { node_id: attempt.node_id, node_activation: Number(attempt.node_activation), ...result },
    operation.id
  );
}
export async function finishCompletionSettlement(
  tx: Transaction,
  attempt: AttemptRow,
  settlement: OperationRow,
  message: OperationResult,
  configurationVersion: number
): Promise<void> {
  if (!attempt.launch.node_execution_source || attempt.mutation_allowed || settlement.workspace_descriptor === null)
    throw new CommandError('denied_scope', 'Settlement requires fenced canonical workspace ownership');
  if (settlement.state === 'succeeded') {
    if (
      !message.success ||
      canonicalJSON(message.result) !== canonicalJSON(settlement.result) ||
      canonicalJSON(message.completion_settlement ?? null) !== canonicalJSON(settlement.completion_settlement)
    )
      throw new CommandError('payload_conflict', 'Terminal settlement pair cannot change');
    return;
  }
  const original = (
    await tx.query<OperationRow>('SELECT * FROM operations WHERE id=$1 AND attempt_id=$2 FOR UPDATE', [
      settlement.completion_operation_id,
      attempt.id,
    ])
  ).rows[0];
  if (
    !original ||
    original.kind !== 'complete_node' ||
    completionIdentity(original, attempt.dispatch_id) !== settlement.completion_identity_digest ||
    original.workspace_digest !== settlement.workspace_digest ||
    original.workspace_lease_id !== settlement.workspace_lease_id ||
    !original.completion_manifest_digest
  )
    throw new CommandError('denied_scope', 'Completion settlement target differs');
  if (!message.success) {
    if (message.completion_settlement || message.cancelled_by_operation_id)
      throw new CommandError('invalid_input', 'Failed settlement cannot assert a terminal pair');
    await tx.query(
      "UPDATE operations SET state='recovery',result=$2,failure_kind=CASE WHEN failure_kind IN ('capture_hard_limit','invalid_finalization') THEN failure_kind ELSE COALESCE($3,failure_kind) END WHERE id=$1",
      [settlement.id, message.result, message.failure_kind ?? 'recoverable']
    );
    if (message.result.writer_absent)
      await tx.query('UPDATE attempts SET process_absent=true WHERE id=$1', [attempt.id]);
    return;
  }
  const pair = message.completion_settlement;
  if (
    !pair ||
    pair.completion_operation_id !== original.id ||
    pair.completion_result.operation_id !== original.id ||
    pair.completion_result.attempt_id !== attempt.id ||
    message.result.writer_absent !== true ||
    pair.completion_result.result.writer_absent !== true
  )
    throw new CommandError('denied_scope', 'Settlement requires its exact complete terminal pair');
  if (
    (
      await tx.query(
        "SELECT 1 FROM operations WHERE attempt_id=$1 AND id<>ALL($2::text[]) AND state NOT IN ('succeeded','cancelled')",
        [attempt.id, [original.id, settlement.id]]
      )
    ).rowCount
  )
    throw new CommandError('unmet_precondition', 'Unrelated effects still own workspace');
  const nested = pair.completion_result;
  if (pair.disposition === 'already_finalized') {
    if (!nested.success || nested.cancelled_by_operation_id || !nested.result.git_commit || !nested.result.git_tree)
      throw new CommandError('denied_scope', 'Already-finalized result requires exact Git success');
    if (original.state === 'succeeded') {
      if (canonicalJSON(original.result) !== canonicalJSON(nested.result))
        throw new CommandError('payload_conflict', 'Original terminal success differs');
    } else {
      if (original.state === 'cancelled')
        throw new CommandError('payload_conflict', 'Cancelled completion cannot finalize');
      await settleWorkspaceOperation(tx, attempt, original, nested);
      await tx.query("UPDATE operations SET state='succeeded',result=$2 WHERE id=$1", [original.id, nested.result]);
    }
    if (
      message.result.workspace_metadata ||
      message.result.git_commit ||
      message.result.git_tree ||
      message.result.workspace_id
    )
      throw new CommandError('denied_scope', 'Finalized settlement carries original evidence only in its pair');
  } else {
    if (
      nested.success ||
      nested.cancelled_by_operation_id !== settlement.id ||
      original.state === 'succeeded' ||
      canonicalJSON(nested.result) !== canonicalJSON({ writer_absent: true })
    )
      throw new CommandError('denied_scope', 'Cancellation requires exact absence tombstone');
    await settleWorkspaceOperation(tx, attempt, settlement, message);
    await tx.query(
      "UPDATE operations SET state='cancelled',result=$2,cancelled_by_operation_id=$3,failure_kind=NULL WHERE id=$1",
      [original.id, nested.result, settlement.id]
    );
  }
  await tx.query("UPDATE operations SET state='succeeded',result=$2,completion_settlement=$3 WHERE id=$1", [
    settlement.id,
    message.result,
    pair,
  ]);
  await tx.query('UPDATE outbox SET done=true WHERE operation_id=ANY($1::text[])', [[original.id, settlement.id]]);
  await tx.query(
    "UPDATE attempts SET mutation_allowed=false,process_absent=true,process_released=true,state=$2,end_reason=CASE WHEN $3::boolean THEN 'completion_corrected' ELSE end_reason END WHERE id=$1",
    [attempt.id, pair.disposition === 'already_finalized' ? 'SUCCEEDED' : 'CANCELLED', pair.disposition === 'cancelled']
  );
  if (pair.disposition === 'already_finalized') {
    if (!(await tx.query('SELECT 1 FROM node_completions WHERE operation_id=$1', [original.id])).rowCount)
      await projectCompletion(tx, attempt, original, nested);
    else await refreshTaskState(tx, attempt.task_id!);
  } else {
    await taskEvent(
      tx,
      attempt,
      'completion_settled_for_correction',
      { node_id: attempt.node_id, completion_operation_id: original.id, disposition: settlement.settlement_purpose },
      settlement.id
    );
    const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [attempt.task_id])).rows[0]!;
    const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1', [attempt.node_id])).rows[0]!;
    if (
      !(await specificationFrozen(tx,task.id)) && settlement.settlement_purpose === 'correct' &&
      ['RUNNING', 'BLOCKED'].includes(task.state) &&
      task.specification_id === attempt.specification_id &&
      task.plan_id === attempt.plan_id &&
      node.execution_source_id === attempt.launch.node_execution_source.source_id &&
      Number(node.activation) === Number(attempt.node_activation)
    ) {
      await tx.query("UPDATE nodes SET state='PENDING',blocker_id=NULL WHERE id=$1", [node.id]);
      await tx.query("UPDATE tasks SET state='RUNNING',control_version=control_version+1 WHERE id=$1", [task.id]);
      await tx.query('UPDATE node_execution_outbox SET done=true WHERE id=$1', [node.execution_source_id]);
      await prepareNodeSource(
        tx,
        { ...task, state: 'RUNNING', control_version: String(Number(task.control_version) + 1) },
        node,
        configurationVersion,
        {
          request_id: settlement.request_id,
          recovery: {
            completion_operation_id: original.id,
            settlement_operation_id: settlement.id,
            failure_kind: original.failure_kind,
            checkpoint: message.result.workspace_metadata!.checkpoint,
          },
        }
      );
    }
  }
}
