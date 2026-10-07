import {reviewInputDisposition} from './task-review-state.ts';
import { operationSummary, inputOperationPage, guidanceRecipientPage } from './task-conversation-reads.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type {
  TaskConversationCommand,
  TaskConversationCommandResult,
  TaskConversationStatus,
} from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { RuntimeScheduling } from './runtime-scheduling.ts';
import { DispatchQueue } from './dispatch-queue.ts';
import {
  conversationTask,
  conversationSource,
  ensureConversationHead,
  prepareConversationSource,
  stopConversationAttempt,
  taskHistory,
  taskText,
} from './task-conversation-state.ts';
import type { ConversationTask, ConversationSource } from './task-conversation-state.ts';
import type { AttemptRow } from './service.ts';
import { taskInputGuards, advanceGuidanceFollowup, withdrawGuidance } from './task-guidance.ts';
import type { NodeTask, ExecutionNode } from './node-execution-state.ts';

export class TaskConversation {
  readonly db: Database;
  private readonly scheduling: RuntimeScheduling;
  private pumping = false;
  constructor(db: Database, backendInstance = '') {
    this.db = db;
    this.scheduling = new RuntimeScheduling(new DispatchQueue(db), backendInstance);
  }
  private async submit(
    tx: Transaction,
    task: ConversationTask,
    messageId: string,
    content: string,
    parentIssue?: string,
  ) {
    taskText(content);
    const inputId = randomUUID();
    await tx.query(
      'INSERT INTO task_inputs(id,task_id,message_id,accepted_delivery_operation_id,parent_issue_id) VALUES($1,$2,$3,$4,$5)',
      [inputId, task.id, messageId, task.accepted_delivery_operation_id, parentIssue ?? null],
    );
    const seq = (
      await tx.query(
        'UPDATE tasks SET conversation_sequence=conversation_sequence+1 WHERE id=$1 RETURNING conversation_sequence',
        [task.id],
      )
    ).rows[0].conversation_sequence;
    await tx.query(
      "INSERT INTO task_messages(id,task_id,input_id,sequence,author,content) VALUES($1,$2,$3,$4,'owner',$5)",
      [messageId, task.id, inputId, seq, content],
    );
    await ensureConversationHead(tx, task.id);
    return inputId;
  }
  async command(token: string, body: unknown): Promise<TaskConversationCommandResult> {
    const command = validate<TaskConversationCommand>('TaskConversationCommand', body),
      json = canonicalJSON(command),
      hash = digest(json);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES)
      throw new CommandError('invalid_input', 'Task input exceeds budget');
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      await lockConfiguration(tx);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('task-input:'||$1||':'||$2,0))", [
        command.task_id,
        command.request_id,
      ]);
      const prior = (
        await tx.query<{
          digest: string;
          response: TaskConversationCommandResult;
        }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [
          command.task_id,
          command.request_id,
        ])
      ).rows[0];
      if (prior) {
        if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request content differs');
        return prior.response;
      }
      let lockedRunners: { runner_id: string }[] = [];
      if (command.name !== 'submit_task_message') {
        // Lock every existing Task host before Task. A newly selected host is
        // detected below before touching its Attempt; selection cannot pass Task.
        const runners = (
          await tx.query<{ runner_id: string }>(
            'SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',
            [command.task_id],
          )
        ).rows;
        lockedRunners = runners;
        for (const r of runners)
          await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [r.runner_id]);
      }
      const task = await conversationTask(tx, command.task_id);
      const lockedReceipt = (
        await tx.query<{ digest: string; response: TaskConversationCommandResult }>(
          'SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',
          [command.task_id, command.request_id],
        )
      ).rows[0];
      if (lockedReceipt) {
        if (lockedReceipt.digest !== hash)
          throw new CommandError('payload_conflict', 'Request content differs');
        return lockedReceipt.response;
      }

      if (
        command.name !== 'submit_task_message' &&
        canonicalJSON(lockedRunners) !==
          canonicalJSON(
            (
              await tx.query('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id', [
                task.id,
              ])
            ).rows,
          )
      )
        throw new CommandError(
          'unmet_precondition',
          'Task host changed during admission; retry the same request',
        );
      let inputId: string | undefined,
        messageId: string | undefined,
        operationId: string | undefined,
        version = 1;
      if (command.name === 'submit_task_message') {
        messageId = command.payload.message_id!;
        if ((await tx.query('SELECT 1 FROM task_messages WHERE id=$1', [messageId])).rowCount)
          throw new CommandError('payload_conflict', 'Message identity already exists');
        inputId = await this.submit(tx, task, messageId, command.payload.content!);
      } else {
        const target = command.payload.operation_id!;
        const input = (
          await tx.query('SELECT * FROM task_inputs WHERE id=$1 AND task_id=$2 FOR UPDATE', [target, task.id])
        ).rows[0];
        if (input) {
          if (await reviewInputDisposition(tx,input.id)) throw new CommandError('unmet_precondition','Original input is retained under explicit review reconsideration; use its review operation');
          inputId = input.id;
          version = Number(input.version) + 1;
          if (Number(input.version) !== command.expected_version)
            throw new CommandError('version_conflict', 'Input operation version changed');
          if (['replied', 'withdrawn'].includes(input.status))
            throw new CommandError(
              'unmet_precondition',
              'Input interpretation is already resolved; target its open obligation',
            );
          const source =
            task.conversation_input_id === input.id && task.conversation_source_id
              ? (
                  await tx.query<ConversationSource>('SELECT * FROM task_conversation_outbox WHERE id=$1', [
                    task.conversation_source_id,
                  ])
                ).rows[0]
              : undefined;
          const attempt = source
            ? (
                await tx.query<AttemptRow>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [
                  source.planned_attempt_id,
                ])
              ).rows[0]
            : undefined;
          if (command.name === 'retry_task_input') {
            if (task.conversation_input_id !== input.id)
              throw new CommandError('unmet_precondition', 'Earlier input must be resolved first');
            if (attempt && (attempt.mutation_allowed || attempt.state === 'QUEUED'))
              throw new CommandError('unmet_precondition', 'Stop the live turn before Retry');
            if (source)
              await tx.query('UPDATE task_conversation_outbox SET done=true WHERE id=$1', [source.id]);
            await tx.query("UPDATE task_inputs SET status='pending',version=version+1 WHERE id=$1", [
              input.id,
            ]);
            await tx.query(
              'UPDATE tasks SET conversation_version=conversation_version+1,conversation_source_id=NULL WHERE id=$1',
              [task.id],
            );
          } else {
            if (attempt) {
              operationId = await stopConversationAttempt(tx, attempt, command.request_id);
              await tx.query(
                "UPDATE attempts SET mutation_allowed=false,state=CASE WHEN state='SUCCEEDED' THEN state ELSE 'CANCELLED' END,end_reason='owner_stopped' WHERE id=$1",
                [attempt.id],
              );
            }
            if (command.name === 'stop_task_turn') {
              if (!source) throw new CommandError('unmet_precondition', 'No current source to stop');
              await tx.query("UPDATE task_inputs SET status='failed',version=version+1 WHERE id=$1", [
                input.id,
              ]);
              await tx.query('UPDATE tasks SET conversation_version=conversation_version+1 WHERE id=$1', [
                task.id,
              ]);
            } else {
              await tx.query(
                "INSERT INTO task_input_resolutions(input_id,task_id,source_id,disposition,request_id,attempt_id) VALUES($1,$2,$3,'withdrawn',$4,$5)",
                [input.id, task.id, source?.id ?? null, command.request_id, attempt?.id ?? null],
              );
              await tx.query("UPDATE task_inputs SET status='withdrawn',version=version+1 WHERE id=$1", [
                input.id,
              ]);
              if (source)
                await tx.query('UPDATE task_conversation_outbox SET done=true WHERE id=$1', [source.id]);
              if (task.conversation_input_id === input.id)
                await tx.query(
                  'UPDATE tasks SET conversation_version=conversation_version+1,conversation_input_id=NULL,conversation_source_id=NULL WHERE id=$1',
                  [task.id],
                );
              await ensureConversationHead(tx, task.id);
            }
          }
        } else {
          if (command.name === 'stop_task_turn')
            throw new CommandError('denied_scope', 'Stop requires a current input');
          const guidance = (
            await tx.query('SELECT * FROM task_guidance WHERE id=$1 AND task_id=$2 FOR UPDATE', [
              target,
              task.id,
            ])
          ).rows[0];
          const issue = guidance
            ? undefined
            : (
                await tx.query('SELECT * FROM task_input_issues WHERE id=$1 AND task_id=$2 FOR UPDATE', [
                  target,
                  task.id,
                ])
              ).rows[0];
          const row = guidance ?? issue;
          if (!row) throw new CommandError('denied_scope', 'Unknown input obligation');
          if (Number(row.version) !== command.expected_version)
            throw new CommandError('version_conflict', 'Obligation changed');
          if (row.status !== (guidance ? 'active' : 'open'))
            throw new CommandError('unmet_precondition', 'Obligation is already resolved');
          version = Number(row.version) + 1;
          if (command.name === 'withdraw_task_input') {
            if (guidance) {
              await withdrawGuidance(tx, task.id, target);
            } else
              await tx.query(
                "UPDATE task_input_issues SET status='withdrawn',version=version+1 WHERE id=$1",
                [target],
              );
          } else if (issue) {
            if (
              (
                await tx.query(
                  "SELECT 1 FROM task_inputs WHERE parent_issue_id=$1 AND status IN ('pending','failed')",
                  [target],
                )
              ).rowCount
            )
              throw new CommandError(
                'unmet_precondition',
                'Issue already has unresolved re-evaluation input',
              );
            const answers = (
              await tx.query(
                "SELECT answer FROM task_input_answers WHERE task_id=$1 AND target_kind='input_issue' AND target_id=$2 ORDER BY created_at,id",
                [task.id, target],
              )
            ).rows.map((r) => r.answer);
            messageId = randomUUID();
            inputId = await this.submit(
              tx,
              task,
              messageId,
              `Re-evaluate this pending input issue: ${issue.reason}\nRecorded Owner answers:\n${answers.join('\n')}`,
              target,
            );
            await tx.query('UPDATE task_input_issues SET version=version+1 WHERE id=$1', [target]);
          } else {
            // Retry guidance re-evaluation through ordered Planner work; never
            // bypass an Owner-stopped Node or a hard-completion recovery owner.
            messageId = randomUUID();
            inputId = await this.submit(
              tx,
              task,
              messageId,
              `Re-evaluate unresolved guidance ${target}: ${guidance.text}`,
            );
            await tx.query('UPDATE task_guidance SET version=version+1 WHERE id=$1', [target]);
          }
        }
      }
      const response: TaskConversationCommandResult = {
        schema_version: 1,
        request_id: command.request_id,
        task_id: task.id,
        status: 'committed',
        version,
        ...(inputId ? { input_id: inputId } : {}),
        ...(messageId ? { message_id: messageId } : {}),
        ...(operationId ? { operation_id: operationId } : {}),
      };
      await tx.query(
        'INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)',
        [task.id, command.request_id, hash, json, response],
      );
      return response;
    });
  }
  async pump(limit = 8): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const heads = (
        await this.db.pool.query<{ id: string }>(
          `SELECT t.id FROM tasks t JOIN task_inputs i ON i.id=t.conversation_input_id WHERE t.conversation_source_id IS NULL AND i.status='pending' AND NOT EXISTS(SELECT 1 FROM task_input_reconsiderations re WHERE re.input_id=i.id) AND NOT EXISTS(SELECT 1 FROM task_review_feedback f WHERE f.task_id=t.id AND f.status='active') ORDER BY i.created_at,i.id LIMIT $1`,
          [limit],
        )
      ).rows;
      for (const h of heads)
        await transaction(this.db, async (tx) => {
          const config = await lockConfiguration(tx),
            task = await conversationTask(tx, h.id);
          if (task.conversation_source_id || !task.conversation_input_id) return;
          const previous = (
            await tx.query<{ id: string }>(
              'SELECT id FROM task_conversation_outbox WHERE input_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
              [task.conversation_input_id],
            )
          ).rows[0];
          await prepareConversationSource(tx, task, config, previous?.id);
        });
      const sources = (
        await this.db.pool.query<ConversationSource>(
          'SELECT * FROM task_conversation_outbox WHERE NOT done AND preparation_failure IS NULL ORDER BY last_checked_at,created_at,id LIMIT $1',
          [limit],
        )
      ).rows;
      for (const source of sources) {
        try {
          await transaction(this.db, async (tx) => {
            const task = (
              await tx.query<ConversationTask>('SELECT * FROM tasks WHERE id=$1', [source.task_id])
            ).rows[0]!;
            const result = await this.scheduling.selectAndEnqueue(tx, {
              attempt_id: source.planned_attempt_id,
              task_id: source.task_id,
              kind: 'planner',
              expected: {
                control_version: Number(source.expected_version),
                specification_id: task.specification_id,
                plan_id: task.plan_id,
              },
              prompt: source.prompt!,
              source_watermark: Number(source.source_watermark),
              task_conversation_source: conversationSource(source),
            });
            if (result.status === 'queued')
              await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [result.runner_id]);
            await conversationTask(tx, task.id);
            await tx.query(
              'UPDATE task_conversation_outbox SET done=$2,waiting_reason=$3,last_checked_at=clock_timestamp() WHERE id=$1',
              [source.id, result.status === 'queued', result.status === 'unavailable' ? result.reason : null],
            );
          });
        } catch (e) {
          if (!(e instanceof CommandError)) throw e;
          await this.db.pool.query(
            'UPDATE task_conversation_outbox SET waiting_reason=$2,last_checked_at=clock_timestamp() WHERE id=$1 AND NOT done',
            [source.id, e.detail.code],
          );
        }
      }
      const followups = (
        await this.db.pool.query<{ task_id: string; node_id: string }>(
          "SELECT DISTINCT task_id,node_id FROM task_guidance_followups WHERE status='waiting' ORDER BY task_id,node_id LIMIT $1",
          [limit],
        )
      ).rows;
      for (const f of followups)
        await transaction(this.db, async (tx) => {
          const config = await lockConfiguration(tx);
          const runners = (
            await tx.query<{ runner_id: string }>(
              'SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',
              [f.task_id],
            )
          ).rows;
          for (const r of runners)
            await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [r.runner_id]);
          const task = await conversationTask(tx, f.task_id);
          const node = (
            await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [f.node_id])
          ).rows[0]!;
          await advanceGuidanceFollowup(tx, task as NodeTask, node, config);
        });
    } finally {
      this.pumping = false;
    }
  }
  async status(token: string, taskId: string): Promise<TaskConversationStatus> {
    validate('Id', taskId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const task = await conversationTask(tx, taskId);
      const source = task.conversation_source_id
        ? (
            await tx.query<ConversationSource>('SELECT * FROM task_conversation_outbox WHERE id=$1', [
              task.conversation_source_id,
            ])
          ).rows[0]
        : undefined;
      const inputs = await operationSummary(tx, taskId, 'input'),
        guidance = await operationSummary(tx, taskId, 'guidance'),
        issues = await operationSummary(tx, taskId, 'issue');
      const attempt = source
        ? (
            await tx.query(
              'SELECT id,state,mutation_allowed,process_released,process_absent,end_reason FROM attempts WHERE id=$1',
              [source.planned_attempt_id],
            )
          ).rows[0]
        : undefined;
      const guards = await taskInputGuards(tx, taskId);
      const current = inputs.items.find((i) => i.id === task.conversation_input_id);
      return validate<TaskConversationStatus>('TaskConversationStatus', {
        schema_version: 1,
        task_id: taskId,
        conversation_version: Number(task.conversation_version),
        sequence: Number(task.conversation_sequence),
        processed_watermark: Number(task.conversation_watermark),
        inputs: inputs.items,
        inputs_has_more: inputs.has_more,
        guidance: guidance.items,
        guidance_has_more: guidance.has_more,
        issues: issues.items,
        issues_has_more: issues.has_more,
        acceptance_guards: guards,
        acceptance_guards_has_more: guards.length === 257,
        ...(source
          ? {
              source: conversationSource(source),
              waiting_reason: source.waiting_reason,
              preparation_failure: source.preparation_failure,
            }
          : {}),
        ...(attempt ? { attempt } : {}),
        available_actions: current?.available_actions ?? [],
      });
    });
  }
  async operations(token: string, taskId: string, cursor?: string) {
    validate('Id', taskId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      await conversationTask(tx, taskId);
      return inputOperationPage(tx, taskId, cursor);
    });
  }
  async recipients(token: string, taskId: string, guidanceId: string, cursor?: string) {
    validate('Id', taskId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      await conversationTask(tx, taskId);
      return guidanceRecipientPage(tx, taskId, guidanceId, cursor);
    });
  }
  async messages(token: string, taskId: string, cursor?: string, query?: string) {
    validate('Id', taskId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      await conversationTask(tx, taskId);
      return taskHistory(tx, taskId, cursor, null, query);
    });
  }
  async receipt(token: string, taskId: string, requestId: string) {
    validate('Id', taskId);
    validate('Id', requestId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      await conversationTask(tx, taskId);
      return (
        (
          await tx.query<{ response: TaskConversationCommandResult }>(
            "SELECT response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2 AND envelope_json::jsonb->>'task_id'=$1",
            [taskId, requestId],
          )
        ).rows[0]?.response ?? {
          schema_version: 1,
          request_id: requestId,
          task_id: taskId,
          status: 'unknown',
        }
      );
    });
  }
}
