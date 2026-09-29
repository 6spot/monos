import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { TaskPreview, TaskPreviewCommand, TaskPreviewCommandResult, TaskPreviewStatus } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { assertActiveProject, lockConfiguration } from './configuration-guards.ts';
import { discussionText } from './discussion-state.ts';
import { initializeTask } from './task-records.ts';
import { readTaskOverview } from './owner-reads.ts';

interface Source {
  id: string; todo_id: string; task_preview: TaskPreview; source_message_id: string; source_watermark: string;
  project_id: string | null; project_context_version: string;
}
interface TodoBasis { project_id: string | null; project_context_version: string; archived: boolean }
interface Confirmation { id: string; todo_id: string; proposal_message_id: string; project_id: string; content_digest: string }
interface Outcome { disposition: 'created' | 'cancelled'; task_id: string | null; confirmation_id: string | null }

async function source(tx: Transaction, todoId: string, messageId: string, write: boolean) {
  const todo = (await tx.query<TodoBasis>(`SELECT project_id,project_context_version,archived FROM todos WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [todoId])).rows[0];
  if (!todo) throw new CommandError('denied_scope', 'Unknown Todo');
  const message = (await tx.query<Source>(`SELECT m.* FROM todo_discussion_messages m JOIN todo_discussion_resolutions r ON r.reply_message_id=m.id AND r.todo_id=m.todo_id
    WHERE m.todo_id=$1 AND m.id=$2 AND m.author='assistant' AND m.task_preview IS NOT NULL AND r.disposition='replied'`, [todoId, messageId])).rows[0];
  if (!message) throw new CommandError('denied_scope', 'Unknown committed Discussion proposal');
  validate('TaskPreview', message.task_preview); discussionText(message.task_preview.title); discussionText(message.task_preview.specification);
  const outcome = (await tx.query<Outcome>('SELECT disposition,task_id,confirmation_id FROM task_preview_resolutions WHERE proposal_message_id=$1', [messageId])).rows[0];
  return { todo, message, outcome };
}

function content(message: Source, projectId: string) {
  return { schema_version: 1, action: 'create_execution_task', todo_id: message.todo_id, proposal_message_id: message.id,
    source_message_id: message.source_message_id, source_watermark: Number(message.source_watermark),
    source_project_id: message.project_id, project_context_version: Number(message.project_context_version),
    title: message.task_preview.title, specification: message.task_preview.specification, selected_project_id: projectId };
}
function contentDigest(message: Source, projectId: string) { return digest(canonicalJSON(content(message, projectId))); }

async function staleReason(tx: Transaction, todo: TodoBasis, message: Source): Promise<TaskPreviewStatus['reason'] | undefined> {
  if (todo.archived) return 'todo_archived';
  if (todo.project_id !== message.project_id || todo.project_context_version !== message.project_context_version) return 'source_project_changed';
  const row = (await tx.query<{ latest: string; source_message_id: string | null }>(`SELECT (SELECT max(sequence) FROM todo_discussion_messages WHERE todo_id=$1 AND author='owner') AS latest,
    source_message_id FROM todo_discussion_controls WHERE todo_id=$1`, [message.todo_id])).rows[0];
  if (!row || row.latest !== message.source_watermark || row.source_message_id !== null) return 'newer_input';
  return undefined;
}

export class TaskPreviews {
  readonly db: Database;
  readonly hooks: { beforeCommit?: () => void; afterCommit?: () => void };
  // Constructor-only crash checkpoints; no transport-controlled fault injection.
  constructor(db: Database, hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {}) { this.db = db; this.hooks = hooks; }

  async read(token: string, todoId: string, messageId: string, projectId?: string): Promise<TaskPreviewStatus> {
    for (const id of [todoId, messageId, ...(projectId !== undefined ? [projectId] : [])]) validate('Id', id);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await lockConfiguration(tx);
      const { todo, message, outcome } = await source(tx, todoId, messageId, false);
      const base = { schema_version: 1, todo_id: todoId, proposal_message_id: messageId, preview: message.task_preview,
        source_message_id: message.source_message_id, source_watermark: Number(message.source_watermark), project_context_version: Number(message.project_context_version), ...(message.project_id ? { source_project_id: message.project_id } : {}) };
      if (outcome?.disposition === 'created') {
        const confirmation = (await tx.query<Confirmation>('SELECT * FROM task_creation_confirmations WHERE id=$1', [outcome.confirmation_id])).rows[0]!;
        return validate('TaskPreviewStatus', { ...base, state: 'created', selected_project_id: confirmation.project_id, content_digest: confirmation.content_digest, confirmation_id: confirmation.id, task: await readTaskOverview(tx, token, outcome.task_id!) });
      }
      if (outcome) return validate('TaskPreviewStatus', { ...base, state: 'cancelled' });
      let selected = projectId;
      if (!selected) {
        for (const candidate of [message.task_preview.project_id, todo.project_id]) {
          if (candidate && (await tx.query('SELECT 1 FROM projects WHERE id=$1 AND NOT archived', [candidate])).rowCount) { selected = candidate; break; }
        }
      }
      const hash = selected ? contentDigest(message, selected) : undefined;
      const confirmation = hash ? (await tx.query<{ id: string }>('SELECT id FROM task_creation_confirmations WHERE proposal_message_id=$1 AND content_digest=$2', [messageId, hash])).rows[0] : undefined;
      const reason = await staleReason(tx, todo, message);
      const available = selected && (await tx.query('SELECT 1 FROM projects WHERE id=$1 AND NOT archived', [selected])).rowCount;
      return validate('TaskPreviewStatus', { ...base, state: reason ? 'stale' : !selected ? 'project_required' : !available ? 'unavailable' : 'eligible',
        ...(reason ? { reason } : selected && !available ? { reason: 'project_unavailable' } : {}),
        ...(selected ? { selected_project_id: selected, content_digest: hash } : {}), ...(confirmation ? { confirmation_id: confirmation.id } : {}) });
    });
  }

  async receipt(token: string, requestId: string): Promise<TaskPreviewCommandResult> {
    validate('Id', requestId);
    return transaction(this.db, async (tx) => { await authenticateOwner(tx, token); return (await tx.query<{ response: TaskPreviewCommandResult }>('SELECT response FROM task_preview_command_receipts WHERE request_id=$1', [requestId])).rows[0]?.response ?? { schema_version: 1, request_id: requestId, status: 'unknown' }; });
  }

  async command(token: string, body: unknown): Promise<TaskPreviewCommandResult> {
    const command = validate<TaskPreviewCommand>('TaskPreviewCommand', body); const hash = digest(canonicalJSON(command));
    const result = await transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token); await lockConfiguration(tx);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1733))', [command.request_id]);
      const prior = (await tx.query<{ digest: string; response: TaskPreviewCommandResult }>('SELECT digest,response FROM task_preview_command_receipts WHERE request_id=$1', [command.request_id])).rows[0];
      if (prior) { if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request identity has different content'); return prior.response; }
      const { todo, message, outcome } = await source(tx, command.todo_id, command.payload.proposal_message_id, true);
      const base = { schema_version: 1, request_id: command.request_id, status: 'committed', todo_id: command.todo_id, proposal_message_id: message.id };
      let response: TaskPreviewCommandResult;
      if (command.name === 'cancel_task_preview') {
        if (outcome?.disposition === 'created') throw new CommandError('unmet_precondition', 'Preview already created a Task');
        if (!outcome) await tx.query("INSERT INTO task_preview_resolutions(proposal_message_id,todo_id,disposition,request_id) VALUES($1,$2,'cancelled',$3)", [message.id, command.todo_id, command.request_id]);
        response = validate('TaskPreviewCommandResult', { ...base, outcome: 'cancelled' });
      } else {
        let confirmation: Confirmation | undefined;
        if (command.name === 'create_execution_task') {
          confirmation = (await tx.query<Confirmation>('SELECT * FROM task_creation_confirmations WHERE id=$1', [command.payload.confirmation_id])).rows[0];
          if (!confirmation || confirmation.todo_id !== command.todo_id || confirmation.proposal_message_id !== message.id) throw new CommandError('denied_scope', 'Confirmation belongs to another proposal');
        }
        const projectId = command.name === 'confirm_task_preview' ? command.payload.project_id! : confirmation!.project_id;
        const expectedDigest = contentDigest(message, projectId);
        if (command.payload.content_digest !== expectedDigest || (confirmation && confirmation.content_digest !== expectedDigest)) throw new CommandError('payload_conflict', 'Exact preview content differs from confirmation');
        if (outcome?.disposition === 'cancelled') throw new CommandError('unmet_precondition', 'Preview was cancelled');
        if (outcome) {
          const consumed = (await tx.query<Confirmation>('SELECT * FROM task_creation_confirmations WHERE id=$1', [outcome.confirmation_id])).rows[0]!;
          if (consumed.content_digest !== expectedDigest) throw new CommandError('payload_conflict', 'Proposal already created a Task with different content');
          const task = (await tx.query<{ initial_specification_id: string }>('SELECT initial_specification_id FROM tasks WHERE id=$1', [outcome.task_id])).rows[0]!;
          response = validate('TaskPreviewCommandResult', { ...base, outcome: 'created', confirmation_id: consumed.id, content_digest: expectedDigest, task_id: outcome.task_id, specification_id: task.initial_specification_id });
        } else {
          const reason = await staleReason(tx, todo, message);
          if (reason) throw new CommandError('version_conflict', `Preview source is stale: ${reason}`);
          await assertActiveProject(tx, projectId);
          if (command.name === 'confirm_task_preview') {
            confirmation = (await tx.query<Confirmation>('SELECT * FROM task_creation_confirmations WHERE proposal_message_id=$1 AND content_digest=$2', [message.id, expectedDigest])).rows[0];
            if (!confirmation) {
              confirmation = { id: randomUUID(), todo_id: command.todo_id, proposal_message_id: message.id, project_id: projectId, content_digest: expectedDigest };
              await tx.query('INSERT INTO task_creation_confirmations(id,todo_id,proposal_message_id,project_id,content_digest,content,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [confirmation.id, command.todo_id, message.id, projectId, expectedDigest, content(message, projectId), command.request_id]);
            }
            response = validate('TaskPreviewCommandResult', { ...base, outcome: 'confirmed', confirmation_id: confirmation.id, content_digest: expectedDigest });
          } else {
            const taskId = randomUUID(); const specificationId = randomUUID();
            await initializeTask(tx, { task_id: taskId, specification_id: specificationId, specification: message.task_preview.specification, project_id: projectId,
              creation: { title: message.task_preview.title, todo_id: command.todo_id, proposal_message_id: message.id, confirmation_id: confirmation!.id } });
            await tx.query("INSERT INTO task_preview_resolutions(proposal_message_id,todo_id,disposition,task_id,confirmation_id,request_id) VALUES($1,$2,'created',$3,$4,$5)", [message.id, command.todo_id, taskId, confirmation!.id, command.request_id]);
            await tx.query("INSERT INTO task_events(task_id,sequence,kind,body) VALUES($1,1,'task_created',$2)", [taskId, { todo_id: command.todo_id, proposal_message_id: message.id, confirmation_id: confirmation!.id, project_id: projectId, initial_specification_id: specificationId }]);
            await tx.query('UPDATE tasks SET event_sequence=1 WHERE id=$1', [taskId]);
            await tx.query('UPDATE todos SET discussion_activity_at=clock_timestamp() WHERE id=$1', [command.todo_id]);
            response = validate('TaskPreviewCommandResult', { ...base, outcome: 'created', confirmation_id: confirmation!.id, content_digest: expectedDigest, task_id: taskId, specification_id: specificationId });
          }
        }
      }
      await tx.query('INSERT INTO task_preview_command_receipts(request_id,digest,response) VALUES($1,$2,$3)', [command.request_id, hash, response]);
      this.hooks.beforeCommit?.();
      return response;
    });
    this.hooks.afterCommit?.(); return result;
  }
}
