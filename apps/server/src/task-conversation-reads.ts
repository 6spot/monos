import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, MAX_ITEM_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type {
  TaskInputOperation,
  TaskInputOperationPage,
  TaskGuidanceRecipientPage,
  TaskGuidanceRecipient,
} from '../../../packages/protocol/src/index.ts';

const operationQuery = `SELECT i.id,'input' kind,i.status,i.version,m.content,i.message_id,NULL::text node_id,i.accepted_delivery_operation_id,m.sequence input_sequence,EXISTS(SELECT 1 FROM task_input_reconsiderations restored WHERE restored.input_id=i.id) reconsidered,
 EXISTS(SELECT 1 FROM task_conversation_outbox s JOIN attempts a ON a.id=s.planned_attempt_id JOIN tasks t ON t.conversation_source_id=s.id WHERE s.input_id=i.id AND (a.mutation_allowed OR a.state='QUEUED')) live
 FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.task_id=$1
 UNION ALL SELECT id,'guidance',status,version,text,NULL,node_id,NULL,0,false,false FROM task_guidance WHERE task_id=$1
 UNION ALL SELECT id,'issue',status,version,reason,NULL,NULL,NULL,0,false,false FROM task_input_issues WHERE task_id=$1`;
function operation(row: Record<string, unknown>, withContent: boolean): TaskInputOperation {
  const active = !row.reconsidered && ['pending', 'failed', 'active', 'open'].includes(String(row.status));
  return {
    id: String(row.id),
    kind: row.kind as TaskInputOperation['kind'],
    status: String(row.status),
    version: Number(row.version),
    ...(withContent ? { content: String(row.content) } : {}),
    ...(row.message_id ? { message_id: String(row.message_id) } : {}),
    ...(row.node_id ? { node_id: String(row.node_id) } : {}),
    ...(row.accepted_delivery_operation_id
      ? {
          accepted_delivery_operation_id: String(row.accepted_delivery_operation_id),
        }
      : {}),
    available_actions: active
      ? row.live
        ? ['stop_task_turn', 'withdraw_task_input']
        : ['retry_task_input', 'withdraw_task_input']
      : [],
  };
}
export async function operationSummary(tx: Transaction, taskId: string, kind: TaskInputOperation['kind']) {
  const rows = (
    await tx.query(
      `SELECT id,kind,status,version,message_id,node_id,accepted_delivery_operation_id,live,reconsidered FROM (${operationQuery}) q WHERE kind=$2 ${kind === 'input' ? "AND status IN ('pending','failed')" : kind === 'issue' ? "AND status='open'" : ''} ORDER BY input_sequence,id LIMIT 65`,
      [taskId, kind],
    )
  ).rows;
  return {
    items: rows.slice(0, 64).map((r) => operation(r, false)),
    has_more: rows.length > 64,
  };
}
function encode(taskId: string, kind: string, after: string, source = ''): string {
  return Buffer.from(canonicalJSON({ version: 1, task_id: taskId, kind, after, source })).toString(
    'base64url',
  );
}
function decode(taskId: string, kind: string, cursor?: string, source = ''): string {
  if (!cursor) return '';
  try {
    validate('TodoCursor', cursor);
    const p = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (p.task_id !== taskId || p.kind !== kind || p.source !== source)
      throw new CommandError('denied_scope', 'Cursor scope differs');
    if (typeof p.after !== 'string' || encode(taskId, kind, p.after, source) !== cursor) throw new Error();
    return p.after;
  } catch (e) {
    if (e instanceof CommandError) throw e;
    throw new CommandError('invalid_input', 'Invalid operation cursor');
  }
}
export async function inputOperationPage(
  tx: Transaction,
  taskId: string,
  cursor?: string,
): Promise<TaskInputOperationPage> {
  let after = decode(taskId, 'operations', cursor);
  const rows = (
    await tx.query(`SELECT * FROM (${operationQuery}) q WHERE id>$2 ORDER BY id LIMIT 65`, [taskId, after])
  ).rows;
  const items: TaskInputOperation[] = [];
  let bytes = 4096;
  for (const row of rows) {
    const item = operation(row, true),
      size = Buffer.byteLength(JSON.stringify(item));
    if (items.length === 64 || bytes + size > MAX_ITEM_BYTES - 8192) break;
    items.push(item);
    bytes += size;
    after = item.id;
  }
  return validate<TaskInputOperationPage>('TaskInputOperationPage', {
    schema_version: 1,
    task_id: taskId,
    items,
    cursor: encode(taskId, 'operations', after),
    has_more: rows.length > items.length,
  });
}
export async function guidanceRecipientPage(
  tx: Transaction,
  taskId: string,
  guidanceId: string,
  cursor?: string,
): Promise<TaskGuidanceRecipientPage> {
  validate('Id', guidanceId);
  if (
    !(await tx.query('SELECT 1 FROM task_guidance WHERE id=$1 AND task_id=$2', [guidanceId, taskId])).rowCount
  )
    throw new CommandError('denied_scope', 'Guidance belongs to another Task');
  let after = decode(taskId, 'recipients', cursor, guidanceId);
  const rows = (
    await tx.query(
      `SELECT o.id obligation_id,o.node_id,o.node_activation,o.version,o.status,o.completion_operation_id,s.id source_id,s.planned_attempt_id attempt_id,s.context_digest,a.dispatch_id,a.fencing_generation,a.started,
 o.id||'/'||COALESCE(s.id,'') page_key FROM task_guidance_obligations o LEFT JOIN task_guidance_assignments ga ON ga.obligation_id=o.id LEFT JOIN node_execution_outbox s ON s.id=ga.source_id LEFT JOIN attempts a ON a.id=s.planned_attempt_id
 WHERE o.task_id=$1 AND o.guidance_id=$2 AND o.id||'/'||COALESCE(s.id,'')>$3 ORDER BY page_key LIMIT 65`,
      [taskId, guidanceId, after],
    )
  ).rows;
  const items: TaskGuidanceRecipient[] = rows.slice(0, 64).map((r) => ({
    obligation_id: r.obligation_id,
    node_id: r.node_id,
    node_activation: Number(r.node_activation),
    version: Number(r.version),
    status: r.status,
    ...(r.completion_operation_id ? { completion_operation_id: r.completion_operation_id } : {}),
    ...(r.source_id
      ? {
          source_id: r.source_id,
          attempt_id: r.attempt_id,
          context_digest: r.context_digest,
          launch_status: r.started
            ? ('launch_started' as const)
            : r.dispatch_id
              ? ('included_in_launch' as const)
              : ('included_in_source' as const),
        }
      : {}),
    ...(r.dispatch_id
      ? {
          dispatch_id: r.dispatch_id,
          fencing_generation: Number(r.fencing_generation),
        }
      : {}),
  }));
  if (items.length) after = rows[items.length - 1].page_key;
  return validate<TaskGuidanceRecipientPage>('TaskGuidanceRecipientPage', {
    schema_version: 1,
    task_id: taskId,
    guidance_id: guidanceId,
    items,
    cursor: encode(taskId, 'recipients', after, guidanceId),
    has_more: rows.length > items.length,
  });
}
