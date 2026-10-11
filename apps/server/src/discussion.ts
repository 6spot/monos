import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { DiscussionCommand, DiscussionCommandResult, DiscussionPage, DiscussionStatus } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { DispatchQueue } from './dispatch-queue.ts';
import { RuntimeScheduling } from './runtime-scheduling.ts';
import { discussionHistory, discussionText, ensureDiscussionIntent, lockDiscussion, prepareDiscussionContext, projectBinding, readDiscussionControl, resolveDiscussionSource, stopDiscussionAttempt } from './discussion-state.ts';
import type { DiscussionAttempt, DiscussionContext } from './discussion-state.ts';
import { activeRuntimeContinuation, supersedeRuntimeContinuation } from './runtime-continuation-state.ts';

interface Intent { id: string; todo_id: string; source_message_id: string; planned_attempt_id: string; expected_version: string; context: DiscussionContext | null; done: boolean }
interface OwnerAttempt extends DiscussionAttempt { process_absent: boolean; recovery_consumed_by: string | null; end_reason: string | null }

export class Discussion {
  readonly db: Database;
  private readonly scheduling: RuntimeScheduling;
  private pumping = false;
  constructor(db: Database, backendInstance: string) { this.db = db; this.scheduling = new RuntimeScheduling(new DispatchQueue(db), backendInstance); }

  async command(token: string, body: unknown): Promise<DiscussionCommandResult> {
    const command = validate<DiscussionCommand>('DiscussionCommand', body); const json = canonicalJSON(command);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Discussion command exceeds request budget');
    const hash = digest(json); const retryLocks = Symbol('retry changed Attempt lock');
    for (let retry = 0; retry < 8; retry++) {
      const result = await transaction(this.db, async (tx) => {
        await authenticateOwner(tx, token); await lockConfiguration(tx);
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('discussion-command:'||$1,0))", [command.request_id]);
        const prior = (await tx.query<{ digest: string; response: DiscussionCommandResult }>('SELECT digest,response FROM discussion_command_receipts WHERE request_id=$1', [command.request_id])).rows[0];
        if (prior) { if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different Discussion content'); return prior.response; }
        const submitting = command.name === 'submit_discussion_message';
        const desired = submitting ? null : (await tx.query<{ desired_attempt_id: string | null }>('SELECT desired_attempt_id FROM todo_discussion_controls WHERE todo_id=$1', [command.todo_id])).rows[0]?.desired_attempt_id ?? null;
        const recovery = !submitting && !desired ? await this.fallbackIntent(tx, command.todo_id) : undefined;
        const selected = desired ?? recovery?.predecessor_attempt_id;
        const candidate = selected ? (await tx.query<{ runner_id: string }>('SELECT runner_id FROM attempts WHERE id=$1 AND todo_id=$2', [selected, command.todo_id])).rows[0] : null;
        if (candidate) await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [candidate.runner_id]);
        const control = await lockDiscussion(tx, command.todo_id);
        if (!submitting && control.desired_attempt_id !== desired) return retryLocks;
        let messageId: string | undefined; let operationId: string | undefined;
        if (submitting) {
          const content = command.payload.content!; discussionText(content); messageId = command.payload.message_id!;
          const inserted = await tx.query("INSERT INTO todo_discussion_messages(id,todo_id,sequence,author,content) VALUES($1,$2,$3,'owner',$4) ON CONFLICT(id) DO NOTHING", [messageId, control.todo_id, Number(control.sequence) + 1, content]);
          if (!inserted.rowCount) throw new CommandError('payload_conflict', 'Message ID belongs to earlier input');
          await tx.query('UPDATE todo_discussion_controls SET sequence=sequence+1 WHERE todo_id=$1', [control.todo_id]);
          await tx.query('UPDATE todos SET discussion_activity_at=clock_timestamp() WHERE id=$1', [control.todo_id]);
          await ensureDiscussionIntent(tx, control);
        } else {
          if (control.source_message_id !== command.payload.source_message_id) throw new CommandError('unmet_precondition', 'Source is no longer the unresolved Discussion input');
          if (Number(control.version) !== command.expected_discussion_version) throw new CommandError('version_conflict', 'Discussion control changed', Number(control.version));
          const currentFallback = !desired ? await this.fallbackIntent(tx, control.todo_id) : undefined;
          if (currentFallback?.planned_attempt_id !== recovery?.planned_attempt_id) return retryLocks;
          const attempt = selected ? (await tx.query<OwnerAttempt>('SELECT * FROM attempts WHERE id=$1 AND todo_id=$2 FOR UPDATE', [selected, control.todo_id])).rows[0] : undefined;
          const continuing = await activeRuntimeContinuation(tx, currentFallback?.planned_attempt_id ?? attempt?.id ?? '');
          if (command.name === 'stop_discussion_turn') {
            if (!attempt || attempt.id !== command.payload.attempt_id) throw new CommandError('denied_scope', 'Stop does not bind the current Attempt');
            if (!continuing && (!['QUEUED', 'RUNNING'].includes(attempt.state) || (attempt.state === 'RUNNING' && !attempt.mutation_allowed))) throw new CommandError('unmet_precondition', 'Current Attempt is not stoppable');
            await supersedeRuntimeContinuation(tx, currentFallback?.planned_attempt_id ?? attempt.id, 'owner_stopped');
            await tx.query('UPDATE todo_discussion_outbox SET done=true WHERE todo_id=$1 AND NOT done', [control.todo_id]);
            operationId = await stopDiscussionAttempt(tx, attempt, command.request_id);
            await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason='owner_stopped' WHERE id=$1", [attempt.id]);
            await tx.query('UPDATE todo_discussion_controls SET version=version+1,desired_attempt_id=$2 WHERE todo_id=$1', [control.todo_id, attempt.id]);
          } else if (command.name === 'retry_discussion_turn') {
            if (continuing) throw new CommandError('unmet_precondition', 'Stop the automatic Runtime continuation before Retry');
            if (!attempt || !['FAILED', 'CANCELLED'].includes(attempt.state) || !attempt.process_released || !attempt.process_absent || attempt.recovery_consumed_by) throw new CommandError('unmet_precondition', 'Retry requires a settled interrupted Attempt');
            if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Earlier effects remain unresolved');
            await tx.query('UPDATE attempts SET recovery_consumed_by=$2 WHERE id=$1', [attempt.id, command.request_id]);
            await tx.query('UPDATE todo_discussion_outbox SET done=true WHERE todo_id=$1 AND NOT done', [control.todo_id]);
            await tx.query('UPDATE todo_discussion_controls SET version=version+1,desired_attempt_id=NULL,waiting_reason=NULL WHERE todo_id=$1', [control.todo_id]);
            if (!attempt.discussion_context) throw new CommandError('unmet_precondition', 'Interrupted source context is unavailable');
            await tx.query('INSERT INTO todo_discussion_outbox(id,todo_id,source_message_id,planned_attempt_id,expected_version,context) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), control.todo_id, control.source_message_id, randomUUID(), Number(control.version) + 1, { ...attempt.discussion_context, discussion_version: Number(control.version) + 1 }]);
          } else {
            if (currentFallback || attempt) await supersedeRuntimeContinuation(tx, currentFallback?.planned_attempt_id ?? attempt!.id, 'owner_withdrawn');
            if (attempt) {
              operationId = await stopDiscussionAttempt(tx, attempt, command.request_id);
              await tx.query("UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason='owner_withdrawn' WHERE id=$1", [attempt.id]);
            }
            const source = (await tx.query<{ sequence: string }>('SELECT sequence FROM todo_discussion_messages WHERE id=$1', [control.source_message_id])).rows[0]!;
            await tx.query("INSERT INTO todo_discussion_resolutions(todo_id,source_message_id,disposition,request_id,attempt_id) VALUES($1,$2,'withdrawn',$3,$4)", [control.todo_id, control.source_message_id, command.request_id, attempt?.id ?? null]);
            // A withdrawal adds no semantic instruction; retain cache text while
            // recording that its unchanged value covers this resolved disposition.
            await tx.query('UPDATE todo_requirement_cache SET resolved_watermark=$2 WHERE todo_id=$1 AND resolved_watermark=$3', [control.todo_id, source.sequence, control.resolved_watermark]);
            await resolveDiscussionSource(tx, control, Number(source.sequence));
          }
        }
        const response = validate<DiscussionCommandResult>('DiscussionCommandResult', { schema_version: 1, request_id: command.request_id, status: 'committed', todo_id: control.todo_id,
          discussion_version: Number(control.version) + (submitting ? 0 : 1), ...(messageId ? { message_id: messageId } : {}), ...(desired ? { attempt_id: desired } : {}), ...(operationId ? { operation_id: operationId } : {}) });
        await tx.query('INSERT INTO discussion_command_receipts(request_id,digest,response) VALUES($1,$2,$3)', [command.request_id, hash, response]);
        return response;
      });
      if (result !== retryLocks) return result;
    }
    throw new CommandError('unmet_precondition', 'Discussion changed during admission; retry the same request');
  }

  private async fallbackIntent(tx: Pick<Database['pool'], 'query'>, todoId: string): Promise<{ planned_attempt_id: string; predecessor_attempt_id: string } | undefined> {
    return (await tx.query<{ planned_attempt_id: string; predecessor_attempt_id: string }>(`SELECT s.planned_attempt_id,r.predecessor_attempt_id
      FROM todo_discussion_controls c JOIN todo_discussion_outbox s ON s.todo_id=c.todo_id AND s.source_message_id=c.source_message_id AND s.expected_version=c.version
      JOIN runtime_continuations r ON r.successor_planned_attempt_id=s.planned_attempt_id
      WHERE c.todo_id=$1 AND c.desired_attempt_id IS NULL ORDER BY s.created_at DESC,s.id DESC LIMIT 1`, [todoId])).rows[0];
  }

  async receipt(token: string, requestId: string): Promise<DiscussionCommandResult> {
    validate('Id', requestId);
    return transaction(this.db, async (tx) => { await authenticateOwner(tx, token); return (await tx.query<{ response: DiscussionCommandResult }>('SELECT response FROM discussion_command_receipts WHERE request_id=$1', [requestId])).rows[0]?.response ?? { schema_version: 1, request_id: requestId, status: 'unknown' }; });
  }

  async status(token: string, todoId: string): Promise<DiscussionStatus> {
    validate('Id', todoId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await lockConfiguration(tx); const control = await readDiscussionControl(tx, todoId); const binding = await projectBinding(tx, control);
      const cache = (await tx.query<{ content: string }>('SELECT content FROM todo_requirement_cache WHERE todo_id=$1 AND resolved_watermark=$2 AND project_context_version=$3 AND project_context_digest=$4', [todoId, control.resolved_watermark, binding.project_context_version, binding.project_context_digest])).rows[0];
      let current: DiscussionStatus['current_source'];
      if (control.source_message_id) {
        const source = (await tx.query<{ sequence: string }>('SELECT sequence FROM todo_discussion_messages WHERE id=$1', [control.source_message_id])).rows[0]!;
        const attempt = control.desired_attempt_id ? (await tx.query<OwnerAttempt>('SELECT * FROM attempts WHERE id=$1', [control.desired_attempt_id])).rows[0] : undefined;
        const fallback = !attempt ? await this.fallbackIntent(tx, todoId) : undefined;
        const continuing = await activeRuntimeContinuation(tx, fallback?.planned_attempt_id ?? attempt?.id ?? '');
        const held = (await tx.query("SELECT 1 FROM attempts a WHERE todo_id=$1 AND id<>COALESCE($2,'') AND (NOT process_released OR EXISTS(SELECT 1 FROM operations WHERE attempt_id=a.id AND state NOT IN ('succeeded','cancelled')))", [todoId, control.desired_attempt_id])).rowCount;
        const unsettled = attempt && (!attempt.process_released || (await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount);
        const status = attempt?.state === 'RUNNING' ? 'processing' : continuing ? 'settling' : attempt && ['FAILED', 'CANCELLED'].includes(attempt.state) ? unsettled ? 'settling' : 'interrupted' : fallback ? 'interrupted' : held ? 'settling' : 'queued';
        current = { message_id: control.source_message_id, source_watermark: Number(source.sequence), status, ...(attempt || fallback ? { attempt_id: attempt?.id ?? fallback!.predecessor_attempt_id } : {}), ...(attempt?.end_reason ? { end_reason: attempt.end_reason } : {}), ...(control.waiting_reason ? { waiting_reason: control.waiting_reason } : {}) };
      }
      return validate('DiscussionStatus', { schema_version: 1, todo_id: todoId, discussion_version: Number(control.version), resolved_watermark: Number(control.resolved_watermark), latest_sequence: Number(control.sequence), project_context_version: binding.project_context_version, project_context_digest: binding.project_context_digest, ...(cache ? { working_requirement_state: cache.content } : {}), ...(current ? { current_source: current } : {}) });
    });
  }

  async messages(token: string, todoId: string, cursor?: string): Promise<DiscussionPage> {
    validate('Id', todoId);
    return transaction(this.db, async (tx) => { await authenticateOwner(tx, token); await readDiscussionControl(tx, todoId); return validate('DiscussionPage', await discussionHistory(tx, todoId, cursor, null, MAX_BODY_BYTES, true)); });
  }

  async pump(limit = 8): Promise<void> {
    if (this.pumping) return; this.pumping = true;
    try {
      const candidates = (await this.db.pool.query<{ id: string }>('SELECT id FROM todo_discussion_outbox WHERE NOT done ORDER BY last_checked_at,created_at,id LIMIT $1', [limit])).rows;
      for (const candidate of candidates) {
        try {
          const intent = await transaction(this.db, async (tx) => {
            const configurationVersion = await lockConfiguration(tx);
            const row = (await tx.query<Intent>('SELECT * FROM todo_discussion_outbox WHERE id=$1', [candidate.id])).rows[0];
            if (!row || row.done) return null;
            const control = await lockDiscussion(tx, row.todo_id);
            const current = (await tx.query<Intent>('SELECT * FROM todo_discussion_outbox WHERE id=$1 FOR UPDATE', [row.id])).rows[0]!;
            if (current.done) return null;
            if (control.source_message_id !== row.source_message_id || control.version !== row.expected_version || control.desired_attempt_id) { await tx.query('UPDATE todo_discussion_outbox SET done=true WHERE id=$1', [row.id]); return null; }
            const context = current.context ?? await prepareDiscussionContext(tx, control, configurationVersion);
            await tx.query('UPDATE todo_discussion_outbox SET context=$2,last_checked_at=clock_timestamp() WHERE id=$1', [row.id, context]);
            return { ...row, context };
          });
          if (!intent) continue;
          await transaction(this.db, async (tx) => {
            const context = intent.context;
            const result = await this.scheduling.selectAndEnqueue(tx, { attempt_id: intent.planned_attempt_id, todo_id: intent.todo_id, kind: 'planner', expected: { control_version: Number(intent.expected_version) }, prompt: context.prompt, source_watermark: context.source_watermark, discussion_context: context });
            const control = await lockDiscussion(tx, intent.todo_id);
            if (result.status === 'queued') await tx.query('UPDATE todo_discussion_outbox SET done=true WHERE id=$1', [intent.id]);
            else if (control.source_message_id === intent.source_message_id && control.version === intent.expected_version && !control.desired_attempt_id) await tx.query('UPDATE todo_discussion_controls SET waiting_reason=$2 WHERE todo_id=$1', [intent.todo_id, result.reason]);
          });
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          // Keep durable input. A subsequent Owner decision or valid Runtime report
          // can progress it; a failed pump never fabricates a reply or skips a source.
          await this.db.pool.query('UPDATE todo_discussion_outbox SET last_checked_at=clock_timestamp() WHERE id=$1', [candidate.id]);
          await transaction(this.db, async (tx) => {
            await lockConfiguration(tx);
            const intent = (await tx.query<Intent>('SELECT * FROM todo_discussion_outbox WHERE id=$1', [candidate.id])).rows[0];
            if (!intent || intent.done) return;
            const control = await lockDiscussion(tx, intent.todo_id);
            if (control.source_message_id === intent.source_message_id && !control.desired_attempt_id) await tx.query('UPDATE todo_discussion_controls SET waiting_reason=$2 WHERE todo_id=$1', [intent.todo_id, error.detail.message.includes('budget') ? 'context_budget_exceeded' : 'context_unavailable']);
          });
        }
      }
    } finally { this.pumping = false; }
  }
}
