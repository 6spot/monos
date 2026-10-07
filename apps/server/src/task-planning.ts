import { requestRemoteCancel } from './remote-preparation-state.ts';
import { cancelReviewOperations } from './task-review-state.ts';
import { cancelTaskInputEffects } from './task-guidance.ts';
import { stopConversationAttempt } from './task-conversation-state.ts';
import type { AttemptRow } from './service.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPlanNode, OwnerCommand, OwnerCommandResult, TaskPlanningStatus, TaskPlanRevision } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { DispatchQueue } from './dispatch-queue.ts';
import { RuntimeScheduling } from './runtime-scheduling.ts';
import { assertPlanningSource, createPlanningIntent, planningEvent, planningSource, planningTask, planningText, startEligibility, stopPlanningAttempt } from './task-planning-state.ts';
import type { PlanningAttempt, PlanningIntent } from './task-planning-state.ts';

interface Target { specification_id?: string; planning_intent_id?: string; issue_sequence?: number; answer?: string; attempt_id?: string }

export class TaskPlanning {
  readonly db: Database;
  private readonly scheduling: RuntimeScheduling;
  private pumping = false;
  constructor(db: Database, backendInstance = '') { this.db = db; this.scheduling = new RuntimeScheduling(new DispatchQueue(db), backendInstance); }

  async command(token: string, body: unknown): Promise<OwnerCommandResult> {
    const command = validate<OwnerCommand>('OwnerCommand', body); const target = command.payload as Target;
    if (!['start_task', 'stop_initial_planning', 'retry_initial_planning', 'cancel_task'].includes(command.name)) throw new CommandError('denied_scope', 'Command is not an initial-planning control');
    const json = canonicalJSON(command); const hash = digest(json);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Owner command exceeds request budget');
    const retryLocks = Symbol('planning source changed');
    for (let retry = 0; retry < 8; retry++) {
      const result = await transaction(this.db, async (tx) => {
        await authenticateOwner(tx, token); const configurationVersion = await lockConfiguration(tx);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('task-planning:'||$1||':'||$2,0))", [command.scope_id, command.request_id]);
        const prior = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [command.scope_id, command.request_id])).rows[0];
        if (prior) { if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content'); return prior.response; }
        // Discover without a Task lock: Runner always precedes Task/Attempt. The
        // source is immutable, and is checked again after acquiring the Task lock.
        const head = (await tx.query<{ initial_planning_intent_id: string | null }>('SELECT initial_planning_intent_id FROM tasks WHERE id=$1', [command.scope_id])).rows[0]?.initial_planning_intent_id ?? null;
        const selected = head ? (await tx.query<{ id: string; runner_id: string }>('SELECT a.id,a.runner_id FROM attempts a JOIN task_planning_outbox p ON p.planned_attempt_id=a.id WHERE p.id=$1 AND p.task_id=$2', [head, command.scope_id])).rows[0] : undefined;
        const allRunners=(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[command.scope_id])).rows;
        for(const r of allRunners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[r.runner_id]);
        if (selected) await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [selected.runner_id]);
        const task = await planningTask(tx, command.scope_id);
        const lockedReceipt = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [command.scope_id, command.request_id])).rows[0];
        if (lockedReceipt) { if (lockedReceipt.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content'); return lockedReceipt.response; }
        if(canonicalJSON(allRunners)!==canonicalJSON((await tx.query('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[task.id])).rows))return retryLocks;
        if (task.initial_planning_intent_id !== head) return retryLocks;
        const intent = head ? (await tx.query<PlanningIntent>('SELECT * FROM task_planning_outbox WHERE id=$1 AND task_id=$2 FOR UPDATE', [head, task.id])).rows[0] : undefined;
        const attempt = intent ? (await tx.query<PlanningAttempt>('SELECT * FROM attempts WHERE id=$1 AND task_id=$2 FOR UPDATE', [intent.planned_attempt_id, task.id])).rows[0] : undefined;
        if (attempt?.id !== selected?.id || (attempt && attempt.runner_id !== selected?.runner_id)) return retryLocks;
        if (Number(task.control_version) !== command.expected_control_version) throw new CommandError('version_conflict', 'Task control basis changed', Number(task.control_version));
        if (task.plan_id !== null || !['PLANNING', 'RUNNING'].includes(task.state)) throw new CommandError('unmet_precondition', 'Only an unfinished pre-Plan Task accepts this control');
        let next = intent; let operationId: string | undefined; let endReason: string | undefined;
        if (command.name === 'start_task') {
          if (task.state !== 'PLANNING' || task.specification_id !== target.specification_id) throw new CommandError('unmet_precondition', 'Start requires the viewed PLANNING Specification');
          if (!await startEligibility(tx, task)) throw new CommandError('unmet_precondition', 'Start requires an active Project and selected available Role');
          if (intent) await tx.query('UPDATE task_planning_outbox SET done=true WHERE id=$1', [intent.id]);
          next = await createPlanningIntent(tx, task, command.request_id, configurationVersion);
          await planningEvent(tx, task.id, 'task_started', { planning_intent_id: next.id, specification_id: task.specification_id, request_id: command.request_id });
        } else {
          if (command.name === 'cancel_task' && target.specification_id !== task.specification_id) throw new CommandError('version_conflict', 'Cancellation Specification changed');
          if (target.attempt_id) {
            if (!attempt || attempt.id !== target.attempt_id || attempt.planning_intent_id !== intent?.id) throw new CommandError('denied_scope', 'Attempt does not own the current initial-planning source');
          } else if ((intent?.id ?? undefined) !== target.planning_intent_id || (!intent && command.name !== 'cancel_task')) throw new CommandError('stale_execution', 'Initial-planning source is no longer current');
          if (target.issue_sequence !== undefined && target.issue_sequence !== Number(task.planning_issue_sequence)) throw new CommandError('version_conflict', 'Planning issue is no longer current');
          if (command.name === 'retry_initial_planning') {
            if (attempt && (attempt.mutation_allowed || !['FAILED', 'CANCELLED', 'SUCCEEDED'].includes(attempt.state))) throw new CommandError('unmet_precondition', 'Retry requires a terminal mutation-fenced Planner');
            if (attempt?.recovery_consumed_by) throw new CommandError('unmet_precondition', 'Attempt recovery was already consumed');
            if (target.attempt_id && attempt && (!['FAILED', 'CANCELLED'].includes(attempt.state) || !attempt.process_released || !attempt.process_absent
              || (await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount)) throw new CommandError('unmet_precondition', 'Attempt-targeted Retry requires physical release and settled effects');
            if (task.state === 'PLANNING' && !await startEligibility(tx, task)) throw new CommandError('unmet_precondition', 'Restart requires an active Project and selected available Role');
            let issue: { reason: string } | undefined;
            if (task.planning_issue_sequence !== null) {
              if(target.answer===undefined&&target.issue_sequence===Number(task.planning_issue_sequence))target.answer=(await tx.query<{answer:string}>("SELECT answer FROM task_input_answers WHERE task_id=$1 AND target_kind='planning_issue' AND target_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[task.id,String(task.planning_issue_sequence)])).rows[0]?.answer;
              if (target.issue_sequence !== Number(task.planning_issue_sequence) || target.answer === undefined) throw new CommandError('unmet_precondition', 'Retry requires the exact open issue and an Owner answer');
              planningText(target.answer);
              issue = (await tx.query<{ body: { reason: string } }>("SELECT body FROM task_events WHERE task_id=$1 AND sequence=$2 AND kind='planning_issue_raised'", [task.id, task.planning_issue_sequence])).rows[0]?.body;
              if (!issue) throw new CommandError('unmet_precondition', 'Planning issue history is unavailable');
            } else if (target.answer !== undefined || target.issue_sequence !== undefined) throw new CommandError('unmet_precondition', 'No open issue accepts this answer');
            if (attempt) await tx.query('UPDATE attempts SET recovery_consumed_by=$2 WHERE id=$1', [attempt.id, command.request_id]);
            await tx.query('UPDATE task_planning_outbox SET done=true WHERE id=$1', [intent!.id]);
            // Persist the exact answer before freezing the successor, so all
            // accepted answers for this Specification remain in fresh context.
            await planningEvent(tx, task.id, 'planning_retried', { planning_intent_id: intent!.id, specification_id: task.specification_id, request_id: command.request_id,
              ...(issue ? { issue_sequence: target.issue_sequence!, reason: issue.reason, answer: target.answer! } : {}) }, attempt?.id);
            next = await createPlanningIntent(tx, task, command.request_id, configurationVersion);
          } else {
            if (command.name === 'stop_initial_planning' && task.state !== 'RUNNING') throw new CommandError('unmet_precondition', 'Initial planning is already stopped');
            if (intent) await tx.query('UPDATE task_planning_outbox SET done=true,waiting_reason=NULL WHERE id=$1', [intent.id]);
            if (attempt) {
              operationId = await stopPlanningAttempt(tx, attempt, command.request_id);
              // A committed issue stays a successful historical outcome.
              await tx.query("UPDATE attempts SET mutation_allowed=false,state=CASE WHEN state='RUNNING' THEN 'CANCELLED' ELSE state END,end_reason=CASE WHEN state='SUCCEEDED' THEN end_reason ELSE $2 END WHERE id=$1", [attempt.id, command.name === 'cancel_task' ? 'owner_cancelled' : 'owner_stopped']);
            }
            if(command.name==='cancel_task'){
              if((await tx.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL',[task.id])).rowCount)throw new CommandError('unmet_precondition','Accepted delivery requires delivery cancellation');
              const conversations=(await tx.query<AttemptRow>('SELECT * FROM attempts WHERE task_id=$1 AND task_conversation_source_id IS NOT NULL FOR UPDATE',[task.id])).rows;
              for(const a of conversations){await stopConversationAttempt(tx,a,command.request_id);await tx.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1',[a.id]);}
              await cancelReviewOperations(tx,task.id,command.request_id);
              await cancelTaskInputEffects(tx,task.id);
              await requestRemoteCancel(tx,task.id);
            }
            endReason = command.name === 'cancel_task' ? 'owner_cancelled' : 'owner_stopped';
            await tx.query('UPDATE tasks SET state=$2,control_version=control_version+1,planning_issue_sequence=NULL WHERE id=$1', [task.id, command.name === 'cancel_task' ? 'CANCELLED' : 'PLANNING']);
            await planningEvent(tx, task.id, command.name === 'cancel_task' ? 'planning_cancelled' : 'planning_stopped', { request_id: command.request_id, specification_id: task.specification_id,
              ...(intent ? { planning_intent_id: intent.id } : {}), ...(task.planning_issue_sequence ? { issue_sequence: Number(task.planning_issue_sequence), disposition: 'withdrawn' } : {}) }, attempt?.id, operationId);
          }
        }
        const response = validate<OwnerCommandResult>('OwnerCommandResult', { schema_version: 1, request_id: command.request_id, status: 'committed', task_id: task.id,
          control_version: Number(task.control_version) + 1, ...(next ? { planning_intent_id: next.id } : {}), ...(attempt ? { attempt_id: attempt.id } : {}),
          ...(operationId ? { operation_id: operationId } : {}), ...(endReason ? { end_reason: endReason } : {}) });
        await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [task.id, command.request_id, hash, json, response]);
        return response;
      });
      if (result !== retryLocks) return result;
    }
    throw new CommandError('unmet_precondition', 'Planning source changed during admission; retry the same request');
  }

  async pump(limit = 8): Promise<void> {
    if (this.pumping) return; this.pumping = true;
    try {
      const candidates = (await this.db.pool.query<PlanningIntent>('SELECT * FROM task_planning_outbox WHERE NOT done AND preparation_failure IS NULL ORDER BY last_checked_at,created_at,id LIMIT $1', [limit])).rows;
      for (const intent of candidates) {
        try {
          await transaction(this.db, async (tx) => {
            const source = planningSource(intent);
            const result = await this.scheduling.selectAndEnqueue(tx, { attempt_id: intent.planned_attempt_id, task_id: intent.task_id, kind: 'planner',
              expected: { control_version: Number(intent.expected_version), specification_id: intent.specification_id, plan_id: null }, prompt: intent.prompt!, source_watermark: 0, task_planning_source: source });
            // Scheduler replay may return before locking its Runner. Always take
            // that lock before the Task, then revalidate the source even on replay.
            if (result.status === 'queued') await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [result.runner_id]);
            await planningTask(tx, intent.task_id);
            await assertPlanningSource(tx, intent.task_id, source, intent.planned_attempt_id, intent.prompt!);
            await tx.query('UPDATE task_planning_outbox SET done=$2,waiting_reason=$3,last_checked_at=clock_timestamp() WHERE id=$1', [intent.id, result.status === 'queued', result.status === 'unavailable' ? result.reason : null]);
          });
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          // Preserve the exact prepared source and reason; never manufacture a
          // replacement Attempt or rebuild a frozen failed context from new facts.
          await transaction(this.db, async (tx) => {
            await lockConfiguration(tx); const task = await planningTask(tx, intent.task_id);
            if (task.initial_planning_intent_id === intent.id && task.state === 'RUNNING' && !task.plan_id) await tx.query('UPDATE task_planning_outbox SET last_checked_at=clock_timestamp(),waiting_reason=$2 WHERE id=$1 AND NOT done', [intent.id, error.detail.code === 'unmet_precondition' ? 'selection_precondition' : 'stale_source']);
          });
        }
      }
    } finally { this.pumping = false; }
  }

  async status(token: string, taskId: string): Promise<TaskPlanningStatus> {
    validate('Id', taskId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await lockConfiguration(tx); const task = await planningTask(tx, taskId, true);
      const intent = task.initial_planning_intent_id ? (await tx.query<PlanningIntent>('SELECT * FROM task_planning_outbox WHERE id=$1', [task.initial_planning_intent_id])).rows[0] : undefined;
      const attempt = intent ? (await tx.query<PlanningAttempt>('SELECT * FROM attempts WHERE id=$1', [intent.planned_attempt_id])).rows[0] : undefined;
      const operation = attempt ? (await tx.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1", [attempt.id])).rows[0] : undefined;
      const held = !!(await tx.query(`SELECT 1 FROM attempts a WHERE task_id=$1 AND kind='planner' AND
        (NOT process_released OR EXISTS(SELECT 1 FROM operations WHERE attempt_id=a.id AND state NOT IN ('succeeded','cancelled')))`, [task.id])).rowCount;
      const issue = task.planning_issue_sequence ? (await tx.query<{ body: { reason: string } }>("SELECT body FROM task_events WHERE task_id=$1 AND sequence=$2 AND kind='planning_issue_raised'", [task.id, task.planning_issue_sequence])).rows[0]?.body : undefined;
      const actions: TaskPlanningStatus['available_actions'] = [];
      if (!task.plan_id && ['PLANNING', 'RUNNING'].includes(task.state)) {
        actions.push('cancel_task');
        if (task.state === 'PLANNING' && await startEligibility(tx, task)) actions.push('start_task');
        if (intent && task.state === 'RUNNING') actions.push('stop_initial_planning');
        if (intent && (!attempt || (!attempt.mutation_allowed && ['FAILED', 'CANCELLED', 'SUCCEEDED'].includes(attempt.state))) && (task.state === 'RUNNING' || await startEligibility(tx, task))) actions.push('retry_initial_planning');
      }
      const status: TaskPlanningStatus['status'] = task.plan_id ? 'published' : task.state === 'CANCELLED' ? 'cancelled' : task.state === 'PLANNING' ? intent ? 'stopped' : 'not_started'
        : issue ? 'issue' : attempt?.state === 'RUNNING' && attempt.mutation_allowed ? 'processing' : held ? 'settling' : attempt?.state === 'QUEUED' ? 'queued'
          : attempt ? 'interrupted' : intent?.waiting_reason ? 'unavailable' : 'pending';
      return validate<TaskPlanningStatus>('TaskPlanningStatus', { schema_version: 1, task_id: task.id, state: task.state, specification_id: task.specification_id, control_version: Number(task.control_version), status, available_actions: actions,
        ...(task.plan_id ? { plan_id: task.plan_id } : {}), ...(intent ? { planning_source: planningSource(intent) } : {}), ...(attempt ? { attempt_id: attempt.id } : {}),
        ...(operation ? { operation_id: operation.id } : {}), ...(issue ? { issue: { issue_sequence: Number(task.planning_issue_sequence), reason: issue.reason } } : {}),
        ...(intent?.waiting_reason && task.state === 'RUNNING' && !task.plan_id ? { waiting_reason: intent.waiting_reason } : {}), ...(attempt?.end_reason ? { end_reason: attempt.end_reason } : {}) });
    });
  }

  async plan(token: string, taskId: string, planId: string): Promise<TaskPlanRevision> {
    validate('Id', taskId); validate('Id', planId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await planningTask(tx, taskId, true);
      const row = (await tx.query<{ specification_id: string | null; content_digest: string | null; content: { nodes?: ExecutionPlanNode[] } }>('SELECT specification_id,content_digest,content FROM plan_revisions WHERE task_id=$1 AND id=$2', [taskId, planId])).rows[0];
      if (!row) throw new CommandError('denied_scope', 'Plan is outside Task scope');
      if (!row.specification_id || !row.content_digest || !row.content.nodes) throw new CommandError('unmet_precondition', 'Legacy Plan lacks recorded revision definitions');
      const result = validate<TaskPlanRevision>('TaskPlanRevision', { schema_version: 1, task_id: taskId, plan_id: planId, specification_id: row.specification_id, content_digest: row.content_digest, nodes: row.content.nodes });
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BODY_BYTES) throw new CommandError('unmet_precondition', 'Plan exceeds response budget');
      return result;
    });
  }
}
