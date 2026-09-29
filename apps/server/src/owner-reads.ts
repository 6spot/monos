import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { AttemptListPage, AttemptLogPage, AttemptStatus, FormalTaskEvent, NodeCounts, RuntimeEvent, TaskEventPage, TaskOverview } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';

interface TaskRow { id: string; control_version: string; state: TaskOverview['state']; specification_id: string; plan_id: string | null; event_sequence: string; title: string | null; todo_id: string | null; project_id: string | null; initial_specification_id: string | null; created_at: Date | null }

export function taskEventCursor(taskId: string, after: number): string {
  validate('Id', taskId); validate('Counter', after);
  return Buffer.from(canonicalJSON({ version: 1, task_id: taskId, after })).toString('base64url');
}

function readCursor(taskId: string, cursor?: string): number {
  if (cursor === undefined) return 0;
  let value: { version: number; task_id: string; after: number };
  try {
    validate('TaskEventCursor', cursor);
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('Noncanonical base64');
    value = JSON.parse(bytes.toString('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'after,task_id,version' || value.version !== 1) throw new Error('Invalid cursor');
    if (taskEventCursor(value.task_id, value.after) !== cursor) throw new Error('Noncanonical cursor');
  } catch { throw new CommandError('invalid_input', 'Invalid Task event cursor'); }
  if (value.task_id !== taskId) throw new CommandError('denied_scope', 'Cursor belongs to another Task');
  return value.after;
}

async function readTask(tx: Transaction, token: string, taskId: string): Promise<TaskRow> {
  validate('Id', taskId); await authenticateOwner(tx, token);
  const task = (await tx.query<TaskRow>('SELECT id,control_version,state,specification_id,plan_id,event_sequence,title,todo_id,project_id,initial_specification_id,created_at FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rows[0];
  if (!task) throw new CommandError('denied_scope', 'Unknown Task');
  return task;
}

export function attemptLogCursor(taskId: string, attemptId: string, after: number): string {
  validate('Id', taskId); validate('Id', attemptId); validate('Counter', after);
  return Buffer.from(canonicalJSON({ version: 1, task_id: taskId, attempt_id: attemptId, after })).toString('base64url');
}

function readAttemptLogCursor(taskId: string, attemptId: string, cursor?: string): number {
  if (cursor === undefined) return 0;
  let value: { version: number; task_id: string; attempt_id: string; after: number };
  try {
    validate('AttemptLogCursor', cursor);
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('Noncanonical base64');
    value = JSON.parse(bytes.toString('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'after,attempt_id,task_id,version' || value.version !== 1) throw new Error('Invalid cursor');
    if (attemptLogCursor(value.task_id, value.attempt_id, value.after) !== cursor) throw new Error('Noncanonical cursor');
  } catch { throw new CommandError('invalid_input', 'Invalid Attempt log cursor'); }
  if (value.task_id !== taskId || value.attempt_id !== attemptId) throw new CommandError('denied_scope', 'Cursor belongs to another Attempt');
  return value.after;
}

interface AttemptLogRow { id: string; task_id: string; node_id: string | null; runner_id: string; kind: AttemptStatus['kind']; state: AttemptStatus['state']; started: boolean; process_absent: boolean; process_released: boolean; mutation_allowed: boolean; launch: { log_mode?: string }; log_visible_sequence: string; activity_at: Date | null; created_at: Date; end_reason: string | null }

async function readAttempt(tx: Transaction, token: string, taskId: string, attemptId: string): Promise<AttemptLogRow> {
  await readTask(tx, token, taskId); validate('Id', attemptId);
  const row = (await tx.query<AttemptLogRow>('SELECT id,task_id,node_id,runner_id,kind,state,started,process_absent,process_released,mutation_allowed,launch,log_visible_sequence,activity_at,created_at,end_reason FROM attempts WHERE id=$1 AND task_id=$2', [attemptId, taskId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown Attempt for Task');
  return row;
}

export function attemptListCursor(taskId: string, createdAt: string, attemptId: string): string {
  validate('Id', taskId);
  if (createdAt && (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)))) throw new CommandError('invalid_input', 'Invalid Attempt list cursor time');
  if (attemptId) validate('Id', attemptId);
  if (Boolean(createdAt) !== Boolean(attemptId)) throw new CommandError('invalid_input', 'Incomplete Attempt list cursor');
  return Buffer.from(canonicalJSON({ version: 1, task_id: taskId, created_at: createdAt, attempt_id: attemptId })).toString('base64url');
}

function readAttemptListCursor(taskId: string, cursor?: string): { created_at: string; attempt_id: string } {
  if (cursor === undefined) return { created_at: '', attempt_id: '' };
  let value: { version: number; task_id: string; created_at: string; attempt_id: string };
  try {
    validate('AttemptListCursor', cursor);
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('Noncanonical base64');
    value = JSON.parse(bytes.toString('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'attempt_id,created_at,task_id,version' || value.version !== 1 || typeof value.created_at !== 'string' || typeof value.attempt_id !== 'string') throw new Error('Invalid cursor');
    if (attemptListCursor(value.task_id, value.created_at, value.attempt_id) !== cursor) throw new Error('Noncanonical cursor');
  } catch { throw new CommandError('invalid_input', 'Invalid Attempt list cursor'); }
  if (value.task_id !== taskId) throw new CommandError('denied_scope', 'Cursor belongs to another Task');
  return { created_at: value.created_at, attempt_id: value.attempt_id };
}

function attemptStatus(row: AttemptLogRow, latest: number): AttemptStatus {
  return validate<AttemptStatus>('AttemptStatus', {
    schema_version: 1, task_id: row.task_id, attempt_id: row.id, kind: row.kind,
    ...(row.node_id ? { node_id: row.node_id } : {}), state: row.state, runner_id: row.runner_id,
    started: row.started, process_absent: row.process_absent, process_released: row.process_released,
    mutation_allowed: row.mutation_allowed, log_mode: row.launch.log_mode === 'ordered_v1' ? 'ordered_v1' : 'legacy',
    visible_sequence: Number(row.log_visible_sequence), latest_sequence: latest, created_at: row.created_at.toISOString(),
    ...(row.end_reason ? { end_reason: row.end_reason } : {}),
    ...(row.activity_at ? { activity_at: row.activity_at.toISOString() } : {}),
  });
}

export class OwnerReads {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async attempts(token: string, taskId: string, cursor?: string): Promise<AttemptListPage> {
    return transaction(this.db, async (tx) => {
      await readTask(tx, token, taskId);
      const after = readAttemptListCursor(taskId, cursor);
      const rows = (await tx.query<AttemptLogRow & { latest: string; created_cursor: string }>(`SELECT a.id,a.task_id,a.node_id,a.runner_id,a.kind,a.state,a.started,a.process_absent,a.process_released,a.mutation_allowed,a.launch,a.log_visible_sequence,a.activity_at,a.created_at,a.end_reason,a.created_at::text AS created_cursor,
        COALESCE((SELECT max(order_sequence) FROM attempt_log_entries WHERE attempt_id=a.id),0)::text AS latest
        FROM attempts a WHERE a.task_id=$1 AND ($2='' OR (a.created_at,a.id)<(NULLIF($2,'')::timestamptz,$3)) ORDER BY a.created_at DESC,a.id DESC LIMIT 65`, [taskId, after.created_at, after.attempt_id])).rows;
      const pageRows = rows.slice(0, 64);
      return validate<AttemptListPage>('AttemptListPage', {
        schema_version: 1, task_id: taskId, attempts: pageRows.map((row) => attemptStatus(row, Number(row.latest))),
        cursor: attemptListCursor(taskId, pageRows.at(-1)?.created_cursor ?? after.created_at, pageRows.at(-1)?.id ?? after.attempt_id), has_more: rows.length > 64,
      });
    });
  }

  async attempt(token: string, taskId: string, attemptId: string): Promise<AttemptStatus> {
    return transaction(this.db, async (tx) => {
      const row = await readAttempt(tx, token, taskId, attemptId);
      const latest = (await tx.query<{ latest: string }>('SELECT COALESCE(max(order_sequence),0)::text AS latest FROM attempt_log_entries WHERE attempt_id=$1', [attemptId])).rows[0]!;
      return attemptStatus(row, Number(latest.latest));
    });
  }

  async logs(token: string, taskId: string, attemptId: string, cursor?: string): Promise<AttemptLogPage> {
    return transaction(this.db, async (tx) => {
      const row = await readAttempt(tx, token, taskId, attemptId);
      if (row.launch.log_mode !== 'ordered_v1') throw new CommandError('unmet_precondition', 'Legacy Attempt has no global log order');
      const after = readAttemptLogCursor(taskId, attemptId, cursor);
      const cutoff = Number(row.log_visible_sequence);
      if (after > cutoff) throw new CommandError('version_conflict', 'Log cursor is beyond acknowledged history');
      const rows = (await tx.query<{ order_sequence: string; body: RuntimeEvent }>('SELECT order_sequence,body FROM attempt_log_entries WHERE attempt_id=$1 AND order_sequence>$2 AND order_sequence<=$3 ORDER BY order_sequence LIMIT 65', [attemptId, after, cutoff])).rows;
      const events: RuntimeEvent[] = []; let last = after; let bytes = 1024;
      for (const entry of rows) {
        if (events.length === 64) break;
        if (Number(entry.order_sequence) !== last + 1) throw new CommandError('unmet_precondition', 'Attempt log history is missing');
        const event = validate<RuntimeEvent>('RuntimeEvent', entry.body);
        const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (bytes + size > MAX_BODY_BYTES) {
          if (!events.length) throw new CommandError('unmet_precondition', 'Attempt log entry exceeds page limit');
          break;
        }
        events.push(event); bytes += size; last = Number(entry.order_sequence);
      }
      if (last < cutoff && rows.length === 0) throw new CommandError('unmet_precondition', 'Attempt log history is missing');
      const latest = (await tx.query<{ latest: string }>('SELECT COALESCE(max(order_sequence),0)::text AS latest FROM attempt_log_entries WHERE attempt_id=$1', [attemptId])).rows[0]!;
      return validate<AttemptLogPage>('AttemptLogPage', { schema_version: 1, task_id: taskId, attempt_id: attemptId,
        events, cursor: attemptLogCursor(taskId, attemptId, last), has_more: last < cutoff, gap_after: Number(latest.latest) > cutoff ? cutoff : 0 });
    });
  }

  async overview(token: string, taskId: string): Promise<TaskOverview> {
    return transaction(this.db, (tx) => readTaskOverview(tx, token, taskId));
  }

  async events(token: string, taskId: string, cursor?: string): Promise<TaskEventPage> {
    return transaction(this.db, async (tx) => {
      const task = await readTask(tx, token, taskId);
      const after = readCursor(taskId, cursor); const cutoff = Number(task.event_sequence);
      const reset = (): TaskEventPage => ({ schema_version: 1, task_id: taskId, events: [], cursor: taskEventCursor(taskId, cutoff), has_more: false, reset_required: true });
      if (after > cutoff) return reset();
      const rows = (await tx.query<{ sequence: string; kind: string; attempt_id: string | null; operation_id: string | null; body: Record<string, unknown> }>('SELECT sequence,kind,attempt_id,operation_id,body FROM task_events WHERE task_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence LIMIT 65', [taskId, after, cutoff])).rows;
      const events: FormalTaskEvent[] = []; let last = after; let bytes = 1024;
      for (const row of rows) {
        if (events.length === 64) break;
        if (Number(row.sequence) !== last + 1) return reset();
        const event = validate<FormalTaskEvent>('FormalTaskEvent', { sequence: Number(row.sequence), kind: row.kind, ...(row.attempt_id ? { attempt_id: row.attempt_id } : {}), ...(row.operation_id ? { operation_id: row.operation_id } : {}), body: row.body });
        const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (bytes + size > MAX_BODY_BYTES) {
          if (!events.length) throw new CommandError('unmet_precondition', 'Formal event exceeds page limit; managed content is required');
          break;
        }
        events.push(event); bytes += size; last = event.sequence;
      }
      if (last < cutoff && events.length === rows.length) return reset();
      return validate<TaskEventPage>('TaskEventPage', { schema_version: 1, task_id: taskId, events, cursor: taskEventCursor(taskId, last), has_more: last < cutoff, reset_required: false });
    });
  }
}

export async function readTaskOverview(tx: Transaction, token: string, taskId: string): Promise<TaskOverview> {
  const task = await readTask(tx, token, taskId);
  const rows = (await tx.query<{ state: string; count: string }>('SELECT n.state,count(*) FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE pn.plan_id=$1 GROUP BY n.state', [task.plan_id])).rows;
  const nodes: NodeCounts = { pending: 0, running: 0, blocked: 0, completed: 0, cancelled: 0 };
  for (const row of rows) nodes[row.state.toLowerCase() as keyof NodeCounts] = Number(row.count);
  const attempts = (await tx.query<{ queued: string; held: string }>("SELECT count(*) FILTER(WHERE state='QUEUED') AS queued,count(*) FILTER(WHERE NOT process_released) AS held FROM attempts WHERE task_id=$1", [taskId])).rows[0]!;
  const operations = (await tx.query<{ count: string }>("SELECT count(*) FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND o.state NOT IN ('succeeded','cancelled')", [taskId])).rows[0]!;
  const revision = (await tx.query<{ content: unknown }>('SELECT content FROM specification_revisions WHERE task_id=$1 AND id=$2', [taskId, task.specification_id])).rows[0];
  return validate<TaskOverview>('TaskOverview', {
    schema_version: 1, task_id: taskId, control_version: Number(task.control_version), state: task.state,
    specification_id: task.specification_id, ...(task.plan_id ? { plan_id: task.plan_id } : {}), nodes,
    queued_attempts: Number(attempts.queued), held_attempts: Number(attempts.held), open_operations: Number(operations.count),
    ...(task.title !== null ? { title: task.title } : {}), ...(task.todo_id ? { todo_id: task.todo_id } : {}),
    ...(task.project_id ? { project_id: task.project_id } : {}), ...(task.initial_specification_id ? { initial_specification_id: task.initial_specification_id } : {}),
    ...(task.created_at ? { created_at: task.created_at.toISOString() } : {}), ...(typeof revision?.content === 'string' ? { specification: revision.content } : {}),
    event_cursor: taskEventCursor(taskId, Number(task.event_sequence)),
  });
}
