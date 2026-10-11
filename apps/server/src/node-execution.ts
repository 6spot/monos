import { remoteItemQuiescent, requestRemoteCancel } from './remote-preparation-state.ts';
import { retryIntegrationConflict } from './node-integration.ts';
import type { OperationRow } from './service.ts';
import { cancelReviewOperations } from './task-review-state.ts';
import { activateInheritedHold,resolveInheritedHold } from './task-replan-holds.ts';
import { assertCurrentNode } from './task-records.ts';
import { specificationFrozen } from './task-specification-state.ts';
import { cancelTaskInputEffects } from './task-guidance.ts';
import { reactivateSettledNodes } from './task-records.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate, MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import type {
  Operation,
  OwnerCommand,
  OwnerCommandResult,
  NodeExecutionStatus,
} from '../../../packages/protocol/src/index.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { authenticateOwner } from './owner-commands.ts';
import { derivedTaskState } from './owner-execution.ts';
import { DispatchQueue, nodeDependenciesReady, serialNodeReady } from './dispatch-queue.ts';
import { RuntimeScheduling } from './runtime-scheduling.ts';
import { planningEvent, planningText } from './task-planning-state.ts';
import { assertNodeSource, blockNodeSource, exhaustNodeRuntimeFallback, nodeSource, prepareNodeSource } from './node-execution-state.ts';
import type { ExecutionNode, NodeSource, NodeTask } from './node-execution-state.ts';
import { activeRuntimeContinuation, runtimeContinuation, supersedeRuntimeContinuation } from './runtime-continuation-state.ts';
import { admitWorkspaceEffect, lockAttemptWorkspace } from './workspaces.ts';
import type { WorkspaceAttempt } from './workspaces.ts';
import { cancelTaskRework, currentNodeRework, reactivationNodeRework } from './node-rework-state.ts';

export interface Attempt extends WorkspaceAttempt {
  state: string;
  specification_id: string;
  plan_id: string;
  end_reason: string | null;
  recovery_consumed_by: string | null;
}
export interface CompletionOperation {
  id: string;
  attempt_id: string;
  schema_version: number;
  kind: Operation['kind'];
  request_id: string;
  resource_id: string | null;
  workspace_descriptor: Operation['workspace'] | null;
  integration?: Operation['integration'] | null;
  result?: Operation['result'] | null;
  workspace_digest: string | null;
  workspace_lease_id: string | null;
  repository_free: boolean | null;
  completion_manifest_digest: string | null;
  state: string;
  failure_kind: string | null | undefined;
  completion_operation_id: string | null;
  completion_identity_digest: string | null;
  settlement_purpose: 'correct' | 'cancel_task' | 'specification_change' | null;
}
export function completionIdentity(operation: CompletionOperation, dispatchId: string): string {
  return digest(
    canonicalJSON({
      schema_version: operation.schema_version,
      operation_id: operation.id,
      attempt_id: operation.attempt_id,
      dispatch_id: dispatchId,
      request_id: operation.request_id,
      kind: operation.kind,
      ...(operation.resource_id ? { resource_id: operation.resource_id } : {}),
      ...(operation.integration ? { integration: operation.integration } : {}),
      ...(operation.workspace_descriptor
        ? { workspace: operation.workspace_descriptor, workspace_digest: operation.workspace_digest }
        : {}),
      ...(operation.repository_free ? { repository_free: true } : {}),
      ...(operation.completion_manifest_digest
        ? { completion_manifest_digest: operation.completion_manifest_digest }
        : {}),
    })
  );
}
export async function admitCompletionSettlement(
  tx: Transaction,
  attempt: Attempt,
  original: CompletionOperation,
  requestId: string,
  purpose: 'correct' | 'cancel_task' | 'specification_change'
): Promise<string> {
  if (
    !original.workspace_descriptor ||
    !original.completion_manifest_digest ||
    !attempt.launch.node_execution_source ||
    original.kind !== 'complete_node'
  )
    throw new CommandError('unmet_precondition', 'Only canonical workspace completion can be settled for correction');
  const prior = (
    await tx.query<{ id: string }>('SELECT id FROM operations WHERE completion_operation_id=$1', [original.id])
  ).rows[0];
  if (prior) return prior.id;
  const id = randomUUID();
  await tx.query(
    `INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id,workspace_descriptor,workspace_digest,workspace_lease_id,completion_operation_id,completion_identity_digest,settlement_purpose) VALUES($1,$2,1,'settle_completion',$3,'admitted',$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      attempt.id,
      requestId,
      original.resource_id,
      original.workspace_descriptor,
      original.workspace_digest,
      original.workspace_lease_id,
      original.id,
      completionIdentity(original, attempt.dispatch_id),
      purpose,
    ]
  );
  await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [
    randomUUID(),
    attempt.runner_id,
    attempt.id,
    id,
  ]);
  return id;
}
export async function stopAttempt(
  tx: Transaction,
  attempt: Attempt,
  requestId: string,
  reason: string
): Promise<string | undefined> {
  const terminal = (
    await tx.query<CompletionOperation>(
      "SELECT * FROM operations WHERE attempt_id=$1 AND kind='complete_node' ORDER BY created_at LIMIT 1",
      [attempt.id]
    )
  ).rows[0];
  if (terminal) return terminal.id;
  const prior = (
    await tx.query<{ id: string }>(
      "SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1",
      [attempt.id]
    )
  ).rows[0];
  if (prior) return prior.id;
  if (attempt.state === 'QUEUED') {
    await tx.query(
      "UPDATE attempts SET mutation_allowed=false,state='CANCELLED',process_absent=true,end_reason=$2 WHERE id=$1",
      [attempt.id, reason]
    );
    return undefined;
  }
  if (attempt.process_released) return undefined;
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason=$2 WHERE id=$1", [
    attempt.id,
    reason,
  ]);
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  return admitWorkspaceEffect(tx, attempt, 'stop', requestId);
}
export class NodeExecution {
  readonly db: Database;
  private readonly scheduling: RuntimeScheduling;
  private pumping = false;
  constructor(db: Database, backendInstance = '') {
    this.db = db;
    this.scheduling = new RuntimeScheduling(new DispatchQueue(db), backendInstance);
  }
  async pump(limit = 8): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const fresh = (
        await this.db.pool.query<{ task_id: string; node_id: string }>(
          `SELECT t.id task_id,n.id node_id FROM tasks t JOIN plan_nodes pn ON pn.plan_id=t.plan_id JOIN nodes n ON n.id=pn.node_id
    WHERE (t.state='RUNNING' OR (t.state='BLOCKED' AND EXISTS(SELECT 1 FROM replan_control_holds h JOIN replan_publications rp ON rp.id=h.publication_id WHERE h.task_id=t.id AND rp.new_plan_id=t.plan_id AND h.node_id=n.id AND h.node_activation=n.activation AND h.resolved_by IS NULL))) AND n.state='PENDING' AND n.execution_source_id IS NULL AND (EXISTS(
     SELECT 1 FROM task_events e JOIN attempts a ON a.id=e.attempt_id JOIN task_planning_outbox p ON p.id=a.planning_intent_id
     WHERE e.task_id=t.id AND a.task_id=t.id AND p.task_id=t.id AND e.kind='plan_published' AND e.body->>'plan_id'=t.plan_id AND e.body->>'planning_intent_id'=p.id) OR EXISTS(SELECT 1 FROM replan_publications rp WHERE rp.task_id=t.id AND rp.new_plan_id=t.plan_id))
    AND NOT EXISTS(SELECT 1 FROM node_rework_requests r WHERE r.task_id=t.id AND (
      (r.status='settling' AND EXISTS(SELECT 1 FROM node_rework_targets x WHERE x.request_id=r.id AND x.node_id=n.id))
      OR (r.status='limit_blocked' AND r.requester_node_id=n.id)))
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(pn.definition->'dependencies') dep WHERE NOT EXISTS(
      SELECT 1 FROM nodes upstream JOIN node_completions c ON c.node_id=upstream.id AND c.activation=upstream.activation
      JOIN plan_nodes member ON member.plan_id=t.plan_id AND member.node_id=upstream.id
      WHERE upstream.id=dep.value AND upstream.state='COMPLETED'
        AND activation_applies(t.id,upstream.id,upstream.activation,t.specification_id,t.plan_id)))
    ORDER BY t.id,n.id LIMIT $1`,
          [limit]
        )
      ).rows;
      for (const candidate of fresh)
        await transaction(this.db, async (tx) => {
          const version = await lockConfiguration(tx);
          const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [candidate.task_id]))
            .rows[0]!;
          const node = (
            await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [candidate.node_id])
          ).rows[0]!;
          if (!(await specificationFrozen(tx,task.id)) && !await currentNodeRework(tx, task.id, node.id) && (task.state === 'RUNNING' || (task.state === 'BLOCKED' && !!(await tx.query(`SELECT 1 FROM replan_control_holds h JOIN replan_publications p ON p.id=h.publication_id WHERE h.task_id=$1 AND p.new_plan_id=$2 AND h.node_id=$3 AND h.node_activation=$4 AND h.resolved_by IS NULL`,[task.id,task.plan_id,node.id,node.activation])).rowCount)) && node.state === 'PENDING' && !node.execution_source_id &&
              await nodeDependenciesReady(tx, task.plan_id, node.id) && await serialNodeReady(tx, task.id, node.id))
            await prepareNodeSource(tx, task, node, version);
        });
      const sources = (
        await this.db.pool.query<NodeSource>(
          'SELECT * FROM node_execution_outbox WHERE NOT done ORDER BY last_checked_at,created_at,id LIMIT $1',
          [limit]
        )
      ).rows;
      for (const source of sources) {
        try {
          await transaction(this.db, async (tx) => {
            const result = await this.scheduling.selectAndEnqueue(tx, {
              attempt_id: source.planned_attempt_id,
              task_id: source.task_id,
              node_id: source.node_id,
              kind: 'node',
              role_id: source.role_id,
              expected: {
                control_version: Number(source.expected_version),
                specification_id: source.specification_id,
                plan_id: source.plan_id,
              },
              prompt: source.prompt!,
              source_watermark: 0,
              node_execution_source: nodeSource(source),
            });
            if (result.status === 'queued')
              await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [result.runner_id]);
            await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [source.task_id]);
            await assertNodeSource(tx, source.task_id, nodeSource(source), source.planned_attempt_id, source.prompt!);
            if (
              result.status === 'unavailable' &&
              !['runner_offline', 'runner_missing', 'installation_stale'].includes(result.reason)
            ) {
              await exhaustNodeRuntimeFallback(tx, source.planned_attempt_id, result.reason);
              return;
            }
            await tx.query(
              'UPDATE node_execution_outbox SET done=$2,waiting_reason=$3,last_checked_at=clock_timestamp() WHERE id=$1 AND NOT done',
              [source.id, result.status === 'queued', result.status === 'unavailable' ? result.reason : null]
            );
          });
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          await this.db.pool.query(
            'UPDATE node_execution_outbox SET last_checked_at=clock_timestamp(),waiting_reason=$2 WHERE id=$1 AND NOT done',
            [source.id, error.detail.code]
          );
        }
      }
      // A factual prelaunch rejection has no live writer. Preserve its source and expose Retry.
      const ended = (
        await this.db.pool.query<{ id: string; runner_id: string; task_id: string }>(
          `SELECT a.id,a.runner_id,a.task_id FROM attempts a JOIN nodes n ON n.execution_source_id=a.node_execution_source_id WHERE n.state='RUNNING' AND a.state IN ('FAILED','CANCELLED') AND NOT a.mutation_allowed AND a.node_execution_source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_guidance_followups f WHERE f.source_id=a.node_execution_source_id AND f.status='waiting')
            AND NOT EXISTS(SELECT 1 FROM node_rework_requests r WHERE r.task_id=a.task_id AND (
              (r.status='settling' AND EXISTS(SELECT 1 FROM node_rework_targets x WHERE x.request_id=r.id AND x.node_id=n.id))
              OR (r.status='limit_blocked' AND r.requester_node_id=n.id)))
            AND NOT EXISTS(SELECT 1 FROM runtime_continuations c WHERE (c.predecessor_attempt_id=a.id OR c.successor_planned_attempt_id=a.id)
              AND (c.state IN('settling','prepared') OR (c.state='exhausted' AND c.resolved_at IS NULL))) ORDER BY a.id LIMIT $1`,
          [limit]
        )
      ).rows;
      for (const row of ended)
        await transaction(this.db, async (tx) => {
          const configurationVersion = await lockConfiguration(tx);
          await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [row.runner_id]);
          const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [row.task_id])).rows[0]!;
          const attempt = (await tx.query<Attempt>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [row.id])).rows[0]!;
          if (await activeRuntimeContinuation(tx, attempt.id)) return;
          const source = (
            await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1', [
              attempt.launch.node_execution_source!.source_id,
            ])
          ).rows[0]!;
          const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1', [source.node_id])).rows[0]!;
          if (await currentNodeRework(tx, task.id, node.id)) return;
          const guidanceOwned=(await tx.query("SELECT 1 FROM task_guidance_followups WHERE source_id=$1 AND status='waiting'",[source.id])).rowCount;
          if (!(await specificationFrozen(tx,task.id)) && attempt.end_reason!=='specification_change' && !guidanceOwned && task.state === 'RUNNING' && node.state === 'RUNNING' && node.execution_source_id === source.id) {
            if (attempt.end_reason === 'integration_conflict' && attempt.process_released) {
              const conflict = (await tx.query<OperationRow>(`SELECT * FROM operations WHERE attempt_id=$1 AND kind='complete_node'
                AND state='succeeded' AND result->'integration'->>'outcome'='conflict' ORDER BY created_at DESC,id DESC LIMIT 1`, [attempt.id])).rows[0];
              if (conflict?.result) {
                await retryIntegrationConflict(tx, attempt, conflict, { operation_id: conflict.id, attempt_id: attempt.id,
                  success: true, result: conflict.result }, configurationVersion);
                return;
              }
            }
            await blockNodeSource(tx, source, 'factual', attempt.end_reason ?? 'missing_formal_outcome', attempt.id);
          }
        });
    } finally {
      this.pumping = false;
    }
  }
  async command(token: string, body: unknown): Promise<OwnerCommandResult> {
    const command = validate<OwnerCommand>('OwnerCommand', body),
      json = canonicalJSON(command),
      hash = digest(json);
    const target = command.payload as {
      node_id?: string;
      node_activation?: number;
      source_id?: string;
      blocker_id?: string;
      answer?: string;
      operation_id?: string;
      completion_identity_digest?: string;
      mode?: 'retry' | 'correct';
      specification_id?: string;
      plan_id?: string;
    };
    const changed = Symbol('Runner set changed');
    for (let retry = 0; retry < 8; retry++) {
      const response = await transaction(this.db, async (tx) => {
        await authenticateOwner(tx, token);
        const config = await lockConfiguration(tx);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1742))', [command.scope_id]);
        // Discover Runner locks before Task, then recheck the set under Task and retry if selection added an owner.
        const identities = (
          await tx.query<{ runner_id: string }>(
            'SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',
            [command.scope_id]
          )
        ).rows;
        for (const row of identities) await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [row.runner_id]);
        const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [command.scope_id]))
          .rows[0];
        if (!task) throw new CommandError('denied_scope', 'Unknown Task');
        const currentRunners = (
          await tx.query<{ runner_id: string }>(
            'SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',
            [task.id]
          )
        ).rows;
        if (canonicalJSON(currentRunners) !== canonicalJSON(identities)) return changed;
        const prior = (
          await tx.query<{ digest: string; response: OwnerCommandResult }>(
            'SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',
            [task.id, command.request_id]
          )
        ).rows[0];
        if (prior) {
          if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request content changed');
          return prior.response;
        }
        if (Number(task.control_version) !== command.expected_control_version)
          throw new CommandError('version_conflict', 'Task control basis changed', Number(task.control_version));
        if (
          !task.plan_id ||
          (!['RUNNING', 'BLOCKED', 'REVIEW','REPLAN_REQUIRED'].includes(task.state) &&
            !(task.state === 'CANCELLED' && command.name === 'recover_completion' && target.mode === 'retry'))
        )
          throw new CommandError('unmet_precondition', 'Task has no active local Plan');
        let operationId: string | undefined,
          sourceId: string | undefined,
          blockerId: string | undefined,
          attemptId: string | undefined;
        if (command.name === 'cancel_task') {
          if (target.specification_id !== task.specification_id || target.plan_id !== task.plan_id)
            throw new CommandError('version_conflict', 'Cancel requires exact Specification and Plan');
          if((await tx.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL',[task.id])).rowCount)throw new CommandError('unmet_precondition','Accepted delivery requires delivery cancellation');
          await cancelReviewOperations(tx,task.id,command.request_id);
          await cancelTaskRework(tx, task.id);
          await cancelTaskInputEffects(tx,task.id);
          await requestRemoteCancel(tx,task.id);
          await tx.query("UPDATE tasks SET state='CANCELLED',control_version=control_version+1 WHERE id=$1", [task.id]);
          await tx.query("UPDATE nodes SET state='CANCELLED' WHERE task_id=$1 AND state<>'COMPLETED'", [task.id]);
          await tx.query(
            "UPDATE node_execution_outbox SET done=true,waiting_reason='task_cancelled' WHERE task_id=$1 AND NOT done",
            [task.id]
          );
          const attempts = (
            await tx.query<Attempt>('SELECT * FROM attempts WHERE task_id=$1 ORDER BY id FOR UPDATE', [task.id])
          ).rows;
          for (const source of (await tx.query<{ planned_attempt_id: string }>('SELECT planned_attempt_id FROM node_execution_outbox WHERE task_id=$1', [task.id])).rows)
            await supersedeRuntimeContinuation(tx, source.planned_attempt_id, 'task_cancelled');
          for (const attempt of attempts) {
            if (attempt.process_released && attempt.state !== 'QUEUED') continue;
            attemptId = attempt.id;
            await lockAttemptWorkspace(tx, attempt.id);
            const original = (
              await tx.query<CompletionOperation>(
                "SELECT * FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state NOT IN ('succeeded','cancelled') FOR UPDATE",
                [attempt.id]
              )
            ).rows[0];
            if (original?.workspace_descriptor)
              operationId = await admitCompletionSettlement(tx, attempt, original, command.request_id, 'cancel_task');
            else operationId = await stopAttempt(tx, attempt, command.request_id, 'task_cancelled');
            await tx.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1', [attempt.id]);
          }
          await planningEvent(tx, task.id, 'task_cancelled', {
            specification_id: task.specification_id,
            plan_id: task.plan_id,
          });
        } else {
          const node = (
            await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 AND task_id=$2 FOR UPDATE', [
              target.node_id,
              task.id,
            ])
          ).rows[0];
          if (
            !node ||
            Number(node.activation) !== target.node_activation ||
            node.execution_source_id !== target.source_id
          )
            throw new CommandError('stale_execution', 'Node source or activation differs');
          const source = (
            await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1', [node.execution_source_id])
          ).rows[0]!;
          if (source.specification_id !== task.specification_id || source.plan_id !== task.plan_id)
            await assertCurrentNode(tx,{task_id:task.id,node_id:node.id,node_activation:Number(node.activation)});
          const attempt = (
            await tx.query<Attempt>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [source.planned_attempt_id])
          ).rows[0];
          attemptId = attempt?.id;
          sourceId = source.id;
          if (command.name === 'recover_completion') {
            if (!attempt) throw new CommandError('unmet_precondition', 'Completion has no Attempt');
            await lockAttemptWorkspace(tx, attempt.id);
            const original = (
              await tx.query<CompletionOperation>('SELECT * FROM operations WHERE id=$1 AND attempt_id=$2 FOR UPDATE', [
                target.operation_id,
                attempt.id,
              ])
            ).rows[0];
            if (
              !original ||
              !['complete_node', 'settle_completion'].includes(original.kind) ||
              original.state !== 'recovery' ||
              attempt.process_released ||
              target.completion_identity_digest !==
                (original.kind === 'settle_completion'
                  ? original.completion_identity_digest
                  : completionIdentity(original, attempt.dispatch_id))
            )
              throw new CommandError('unmet_precondition', 'Recovery requires the exact retained completion');
            if (target.mode === 'retry') {
              if ((await tx.query('SELECT 1 FROM operations WHERE completion_operation_id=$1', [original.id])).rowCount)
                throw new CommandError('unmet_precondition', 'Completion settlement already owns recovery');
              await tx.query("UPDATE operations SET state='admitted' WHERE id=$1", [original.id]);
              await tx.query('UPDATE outbox SET done=false,last_sent_at=NULL WHERE operation_id=$1', [original.id]);
              operationId = original.id;
            } else {
              if (original.kind !== 'complete_node')
                throw new CommandError('unmet_precondition', 'Correction must target original completion');
              operationId = await admitCompletionSettlement(tx, attempt, original, command.request_id, 'correct');
            }
            await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
            await planningEvent(
              tx,
              task.id,
              'completion_recovery_requested',
              { node_id: node.id, source_id: source.id, mode: target.mode, completion_operation_id: original.id },
              attempt.id,
              operationId
            );
          } else if (command.name === 'stop_node') {
            if (await currentNodeRework(tx, task.id, node.id))
              throw new CommandError('unmet_precondition', 'Rework already owns process settlement; resolve the saved Rework request or Cancel the Task');
            await tx.query('UPDATE nodes SET guidance_paused=true WHERE id=$1',[node.id]);
            const pendingGuidance=(await tx.query("SELECT 1 FROM task_guidance_followups WHERE node_id=$1 AND status='waiting'",[node.id])).rowCount;
            if (!['PENDING', 'RUNNING'].includes(node.state) && !(node.state==='COMPLETED'&&pendingGuidance))
              throw new CommandError('unmet_precondition', 'Node is not stoppable');
            await supersedeRuntimeContinuation(tx, source.planned_attempt_id, 'owner_stopped');
            if(node.state==='COMPLETED'){await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[task.id]);return this.receipt(tx,command,hash,json,{schema_version:1,request_id:command.request_id,status:'committed',task_id:task.id,control_version:Number(task.control_version)+1,source_id:source.id});}
            if (attempt) {
              operationId = await stopAttempt(tx, attempt, command.request_id, 'owner_stopped');
              const original = (
                await tx.query("SELECT 1 FROM operations WHERE id=$1 AND kind='complete_node'", [operationId])
              ).rowCount;
              if (original){
                await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[task.id]);
                return this.receipt(tx, command, hash, json, {
                  schema_version: 1,
                  request_id: command.request_id,
                  status: 'admitted',
                  attempt_id: attempt.id,
                  task_id: task.id,
                  operation_id: operationId,
                  control_version: Number(task.control_version)+1,
                  source_id: source.id,
                });
              }
            }
            blockerId = await blockNodeSource(tx, source, 'owner_stopped', 'owner_stopped', attempt?.id);
            await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
          } else if (command.name === 'retry_node' || command.name === 'continue_node') {
            if (await currentNodeRework(tx, task.id, node.id))
              throw new CommandError('unmet_precondition', 'Resolve the exact upstream Rework request before Retry or Continue');
            if(!await remoteItemQuiescent(tx,task.id))throw new CommandError('unmet_precondition','Admitted remote effects must reconcile before correction');
            const paused=(await tx.query('SELECT guidance_paused FROM nodes WHERE id=$1',[node.id])).rows[0].guidance_paused;
            if(command.name==='continue_node'&&node.state==='COMPLETED'&&paused){
              if (await reactivationNodeRework(tx, task.id, node.id))
                throw new CommandError('unmet_precondition', 'Resolve the preserved Rework request before reactivating its ancestor');
              if(!(await tx.query("SELECT 1 FROM task_guidance_followups WHERE node_id=$1 AND status='waiting'",[node.id])).rowCount)throw new CommandError('unmet_precondition','No paused guidance followup needs continuation');
              await reactivateSettledNodes(tx,{task_id:task.id,expected:{control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id},node_ids:[node.id]});
              await tx.query('UPDATE nodes SET guidance_paused=false WHERE id=$1',[node.id]);
              const freshTask=(await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0]!;const freshNode=(await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1',[node.id])).rows[0]!;
              const next=await prepareNodeSource(tx,freshTask,freshNode,config,{request_id:command.request_id,recovery:{owner_continued_guidance:true}});
              return this.receipt(tx,command,hash,json,{schema_version:1,request_id:command.request_id,status:'committed',task_id:task.id,control_version:Number(freshTask.control_version),source_id:next.id});
            }
            if (node.state !== 'BLOCKED') throw new CommandError('unmet_precondition', 'Node is not blocked');
            const blocker = node.blocker_id
              ? (
                  await tx.query<{ id: string; kind: string; reason: string }>(
                    'SELECT * FROM node_blockers WHERE id=$1',
                    [node.blocker_id]
                  )
                ).rows[0]
              : undefined;
            if (blocker && target.blocker_id !== blocker.id)
              throw new CommandError('stale_execution', 'Retry requires exact blocker');
            if (command.name === 'continue_node' && blocker?.kind !== 'owner_stopped')
              throw new CommandError('unmet_precondition', 'Continue requires Owner Stop');
            if (command.name === 'retry_node' && blocker?.kind === 'owner_stopped')
              throw new CommandError('unmet_precondition', 'Owner Stop requires Continue');
            if(blocker?.kind==='semantic'&&!target.answer){target.answer=(await tx.query<{answer:string}>("SELECT answer FROM task_input_answers WHERE task_id=$1 AND target_kind='node_blocker' AND target_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[task.id,blocker.id])).rows[0]?.answer;}
            if (blocker?.kind === 'semantic') {
              if (!target.answer)
                throw new CommandError('unmet_precondition', 'Semantic blocker needs exact Owner answer');
              planningText(target.answer);
            }
            if (attempt?.mutation_allowed)
              throw new CommandError('unmet_precondition', 'Old Attempt retains mutation authority');
            if (
              attempt &&
              (
                await tx.query(
                  "SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state NOT IN ('succeeded','cancelled')",
                  [attempt.id]
                )
              ).rowCount
            )
              throw new CommandError('unmet_precondition', 'Recover original completion before a fresh Attempt');
            await supersedeRuntimeContinuation(tx, source.planned_attempt_id, command.name === 'retry_node' ? 'owner_retried' : 'owner_continued');
            const carriedHold=blocker&&(await tx.query(`SELECT 1 FROM replan_control_holds h JOIN replan_publications p ON p.id=h.publication_id JOIN tasks t ON t.id=h.task_id JOIN node_completions c ON c.node_id=h.node_id AND c.activation=h.node_activation WHERE p.new_plan_id=t.plan_id AND h.node_id=$1 AND h.current_blocker_id=$2 AND h.resolved_by IS NULL`,[node.id,blocker.id])).rowCount;
            if(carriedHold){
              await resolveInheritedHold(tx,node.id,blocker!.id,command.request_id);
              const nextBlocker=await activateInheritedHold(tx,source);
              if(!nextBlocker)await tx.query("UPDATE nodes SET state='COMPLETED',blocker_id=NULL,guidance_paused=false WHERE id=$1",[node.id]);
              await tx.query("UPDATE tasks SET state=CASE WHEN state='REPLAN_REQUIRED' THEN state ELSE $2 END,control_version=control_version+1 WHERE id=$1",[task.id,await derivedTaskState(tx,task.plan_id)]);
              await planningEvent(tx,task.id,command.name,{node_id:node.id,node_activation:Number(node.activation),source_id:source.id,blocker_id:blocker!.id,...(target.answer?{answer:target.answer}:{})});
              return this.receipt(tx,command,hash,json,{schema_version:1,request_id:command.request_id,status:'committed',task_id:task.id,control_version:Number(task.control_version)+1,source_id:source.id,...(nextBlocker?{blocker_id:nextBlocker}:{})});
            }
            await tx.query('UPDATE node_execution_outbox SET done=true WHERE id=$1', [source.id]);
            await tx.query("UPDATE tasks SET state='RUNNING',control_version=control_version+1 WHERE id=$1", [task.id]);
            await tx.query('UPDATE nodes SET guidance_paused=false WHERE id=$1',[node.id]);
            await tx.query("UPDATE nodes SET state='PENDING',blocker_id=NULL WHERE id=$1", [node.id]);
            const next = await prepareNodeSource(
              tx,
              { ...task, state: 'RUNNING', control_version: String(Number(task.control_version) + 1) },
              node,
              config,
              {
                request_id: command.request_id,
                recovery: {
                  prior_source_id: source.id,
                  ...(blocker ? { blocker_id: blocker.id, reason: blocker.reason } : {}),
                  ...(target.answer ? { answer: target.answer } : {}),
                },
              }
            );
            await resolveInheritedHold(tx,node.id,blocker?.id,command.request_id);
            blockerId=await activateInheritedHold(tx,next);
            sourceId = next.id;
            if (attempt)
              await tx.query('UPDATE attempts SET recovery_consumed_by=$2 WHERE id=$1', [
                attempt.id,
                command.request_id,
              ]);
            await planningEvent(tx, task.id, command.name, {
              node_id: node.id,
              node_activation: Number(node.activation),
              source_id: next.id,
              previous_source_id: source.id,
              ...(target.answer ? { answer: target.answer } : {}),
            });
          } else throw new CommandError('denied_scope', 'Unknown Node control');
        }
        return this.receipt(tx, command, hash, json, {
          schema_version: 1,
          request_id: command.request_id,
          task_id: task.id,
          status: operationId ? 'admitted' : 'committed',
          control_version: Number(task.control_version) + 1,
          ...(operationId ? { operation_id: operationId } : {}),
          ...(sourceId ? { source_id: sourceId } : {}),
          ...(blockerId ? { blocker_id: blockerId } : {}),
          ...(attemptId ? { attempt_id: attemptId } : {}),
        });
      });
      if (response !== changed) return response;
    }
    throw new CommandError(
      'control_unavailable',
      'Runner ownership changed during control admission; retry same request'
    );
  }
  private async receipt(
    tx: Transaction,
    command: OwnerCommand,
    hash: string,
    json: string,
    response: OwnerCommandResult
  ) {
    validate('OwnerCommandResult', response);
    await tx.query(
      'INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)',
      [command.scope_id, command.request_id, hash, json, response]
    );
    return response;
  }
  async status(token: string, taskId: string, nodeId: string): Promise<NodeExecutionStatus> {
    validate('Id', taskId);
    validate('Id', nodeId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rows[0];
      const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 AND task_id=$2', [nodeId, taskId]))
        .rows[0];
      if (!task || !node) throw new CommandError('denied_scope', 'Node is outside Task');
      const source = node.execution_source_id
        ? (await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1', [node.execution_source_id]))
            .rows[0]
        : null;
      const attempt = source
        ? (await tx.query<Attempt>('SELECT * FROM attempts WHERE id=$1', [source.planned_attempt_id])).rows[0]
        : null;
      const continuation = source ? await runtimeContinuation(tx, source.planned_attempt_id) : undefined;
      const blocker = node.blocker_id
        ? (await tx.query('SELECT id,kind,reason FROM node_blockers WHERE id=$1', [node.blocker_id])).rows[0]
        : null;
      const rows = attempt
        ? (
            await tx.query<CompletionOperation>(
              'SELECT * FROM operations WHERE attempt_id=$1 ORDER BY created_at,id LIMIT 257',
              [attempt.id]
            )
          ).rows
        : [];
      if (rows.length > 256)
        throw new CommandError('unmet_precondition', 'Execution operation list exceeds supported budget');
      const operations = rows.map((o) => ({
        operation_id: o.id,
        kind: o.kind,
        state: o.state,
        failure_kind: o.failure_kind ?? null,
        ...(o.result?.integration ? { integration: o.result.integration } : {}),
        ...(o.kind === 'complete_node'
          ? { completion_identity_digest: completionIdentity(o, attempt!.dispatch_id) }
          : {}),
        ...(o.kind === 'settle_completion' ? { completion_identity_digest: o.completion_identity_digest } : {}),
      }));
      const manifest = (
        await tx.query(
          'SELECT m.* FROM completion_manifests m JOIN node_completions c ON c.operation_id=m.operation_id WHERE c.node_id=$1 AND c.activation=$2',
          [nodeId, node.activation]
        )
      ).rows[0];
      if (manifest) manifest.node_activation = Number(manifest.node_activation);
      let waitingReason = source?.waiting_reason ?? null;
      const rework = await currentNodeRework(tx, task.id, node.id);
      if (rework) waitingReason = 'waiting_for_node_rework';
      else if (!source && node.state === 'PENDING' && task.plan_id) {
        if (!await nodeDependenciesReady(tx, task.plan_id, node.id)) waitingReason = 'waiting_for_dependencies';
        else if (!await serialNodeReady(tx, task.id, node.id)) waitingReason = 'waiting_for_workspace_ownership';
      }
      const result = {
        schema_version: 1,
        task_id: taskId,
        node_id: nodeId,
        node_activation: Number(node.activation),
        control_version: Number(task.control_version),
        specification_id: task.specification_id,
        plan_id: task.plan_id,
        state: node.state,
        guidance_paused:node.guidance_paused,
        guidance_followup_pending:!!(await tx.query("SELECT 1 FROM task_guidance_followups WHERE node_id=$1 AND status='waiting'",[nodeId])).rowCount,
        source: source ? nodeSource(source) : null,
        waiting_reason: continuation ? (continuation.reason ?? (continuation.state === 'settling' ? 'runtime_fallback_settling' : 'runtime_fallback_pending')) : waitingReason,
        attempt: attempt
          ? {
              attempt_id: attempt.id,
              state: attempt.state,
              process_released: attempt.process_released,
              end_reason: attempt.end_reason,
            }
          : null,
        blocker,
        operations,
        manifest: manifest ?? null,
      };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BODY_BYTES)
        throw new CommandError('unmet_precondition', 'Execution read exceeds budget');
      return validate<NodeExecutionStatus>('NodeExecutionStatus', result);
    });
  }
}
