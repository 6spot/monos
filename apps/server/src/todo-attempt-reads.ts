import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { RuntimeEvent, TodoAttemptListPage, TodoAttemptLogPage, TodoAttemptStatus, TodoOperationStatus } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { readDiscussionControl } from './discussion-state.ts';

interface Row { id: string; todo_id: string; runner_id: string; state: TodoAttemptStatus['state']; started: boolean; process_absent: boolean; process_released: boolean; mutation_allowed: boolean; launch: { log_mode?: string }; log_visible_sequence: string; latest: string; created_at: Date; activity_at: Date | null; end_reason: string | null; created_cursor: string }
const selection = "SELECT a.*,a.created_at::text AS created_cursor,COALESCE((SELECT max(order_sequence) FROM attempt_log_entries WHERE attempt_id=a.id),0)::text AS latest FROM attempts a";
function status(row: Row): TodoAttemptStatus {
  return validate('TodoAttemptStatus', { schema_version: 1, todo_id: row.todo_id, attempt_id: row.id, kind: 'planner', runner_id: row.runner_id, state: row.state,
    started: row.started, process_absent: row.process_absent, process_released: row.process_released, mutation_allowed: row.mutation_allowed,
    log_mode: row.launch.log_mode === 'ordered_v1' ? 'ordered_v1' : 'legacy', visible_sequence: Number(row.log_visible_sequence), latest_sequence: Number(row.latest), created_at: row.created_at.toISOString(),
    ...(row.activity_at ? { activity_at: row.activity_at.toISOString() } : {}), ...(row.end_reason ? { end_reason: row.end_reason } : {}) });
}
function encode(value: object): string { return Buffer.from(canonicalJSON(value)).toString('base64url'); }
function decode(cursor: string): Record<string, unknown> {
  try {
    validate('TodoCursor', cursor); const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || value.version !== 1 || encode(value) !== cursor) throw new Error('Invalid cursor');
    return value;
  } catch { throw new CommandError('invalid_input', 'Invalid Todo execution cursor'); }
}
async function owned(tx: Transaction, token: string, todoId: string, attemptId?: string): Promise<Row | undefined> {
  validate('Id', todoId); await authenticateOwner(tx, token); await readDiscussionControl(tx, todoId);
  if (attemptId === undefined) return undefined;
  validate('Id', attemptId); const row = (await tx.query<Row>(`${selection} WHERE a.id=$1 AND a.todo_id=$2`, [attemptId, todoId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Attempt is outside Todo scope'); return row;
}

export class TodoAttemptReads {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async attempt(token: string, todoId: string, attemptId: string): Promise<TodoAttemptStatus> {
    return transaction(this.db, async (tx) => status((await owned(tx, token, todoId, attemptId))!));
  }

  async attempts(token: string, todoId: string, cursor?: string): Promise<TodoAttemptListPage> {
    return transaction(this.db, async (tx) => {
      await owned(tx, token, todoId); let time = ''; let id = '';
      if (cursor !== undefined) {
        const value = decode(cursor);
        if (Object.keys(value).sort().join(',') !== 'attempt_id,created_at,todo_id,version' || typeof value.created_at !== 'string' || typeof value.attempt_id !== 'string') throw new CommandError('invalid_input', 'Invalid Todo Attempt cursor');
        if (value.todo_id !== todoId) throw new CommandError('denied_scope', 'Cursor belongs to another Todo');
        time = value.created_at; id = value.attempt_id;
        if (Boolean(time) !== Boolean(id)) throw new CommandError('invalid_input', 'Incomplete Todo Attempt cursor');
        if (time && (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d$/.test(time) || !Number.isFinite(Date.parse(time)))) throw new CommandError('invalid_input', 'Invalid cursor time');
        if (id) validate('Id', id);
      }
      const rows = (await tx.query<Row>(`${selection} WHERE a.todo_id=$1 AND ($2='' OR (a.created_at,a.id)<(NULLIF($2,'')::timestamptz,$3)) ORDER BY a.created_at DESC,a.id DESC LIMIT 65`, [todoId, time, id])).rows;
      const page = rows.slice(0, 64); const last = page.at(-1);
      return validate('TodoAttemptListPage', { schema_version: 1, todo_id: todoId, attempts: page.map(status), has_more: rows.length > 64,
        cursor: encode({ version: 1, todo_id: todoId, created_at: last?.created_cursor ?? time, attempt_id: last?.id ?? id }) });
    });
  }

  async logs(token: string, todoId: string, attemptId: string, cursor?: string): Promise<TodoAttemptLogPage> {
    return transaction(this.db, async (tx) => {
      const row = (await owned(tx, token, todoId, attemptId))!; let after = 0;
      if (row.launch.log_mode !== 'ordered_v1') throw new CommandError('unmet_precondition', 'Attempt has no global log order');
      if (cursor !== undefined) {
        const value = decode(cursor);
        if (Object.keys(value).sort().join(',') !== 'after,attempt_id,todo_id,version') throw new CommandError('invalid_input', 'Invalid log cursor');
        validate('Counter', value.after);
        if (value.todo_id !== todoId || value.attempt_id !== attemptId) throw new CommandError('denied_scope', 'Cursor belongs to another Todo Attempt');
        after = value.after as number;
      }
      const cutoff = Number(row.log_visible_sequence);
      if (after > cutoff) throw new CommandError('version_conflict', 'Log cursor is beyond visible history');
      const rows = (await tx.query<{ order_sequence: string; body: RuntimeEvent }>('SELECT order_sequence,body FROM attempt_log_entries WHERE attempt_id=$1 AND order_sequence>$2 AND order_sequence<=$3 ORDER BY order_sequence LIMIT 65', [attemptId, after, cutoff])).rows;
      const events: RuntimeEvent[] = []; let bytes = 2048; let last = after;
      for (const entry of rows) {
        if (events.length === 64) break;
        if (Number(entry.order_sequence) !== last + 1) throw new CommandError('unmet_precondition', 'Attempt log history is missing');
        const event = validate<RuntimeEvent>('RuntimeEvent', entry.body); const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (bytes + size > MAX_BODY_BYTES) break;
        events.push(event); bytes += size; last++;
      }
      if (last < cutoff && !events.length) throw new CommandError('unmet_precondition', 'Attempt log page cannot advance');
      return validate('TodoAttemptLogPage', { schema_version: 1, todo_id: todoId, attempt_id: attemptId, events, cursor: encode({ version: 1, todo_id: todoId, attempt_id: attemptId, after: last }), has_more: last < cutoff, gap_after: Number(row.latest) > cutoff ? cutoff : 0 });
    });
  }

  async operation(token: string, todoId: string, operationId: string): Promise<TodoOperationStatus> {
    validate('Id', operationId);
    return transaction(this.db, async (tx) => {
      await owned(tx, token, todoId);
      const row = (await tx.query<{ attempt_id: string; kind: string; state: string; failure_kind: string | null; end_reason: string | null; process_absent: boolean; process_released: boolean }>(`SELECT o.attempt_id,o.kind,o.state,o.failure_kind,a.end_reason,a.process_absent,a.process_released FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=$1 AND a.todo_id=$2`, [operationId, todoId])).rows[0];
      if (!row) throw new CommandError('denied_scope', 'Operation is outside Todo scope');
      return validate('TodoOperationStatus', { schema_version: 1, todo_id: todoId, operation_id: operationId, attempt_id: row.attempt_id, kind: row.kind, state: row.state, process_absent: row.process_absent, process_released: row.process_released, attention: row.state === 'recovery', ...(row.failure_kind ? { failure_kind: row.failure_kind } : {}), ...(row.end_reason ? { end_reason: row.end_reason } : {}) });
    });
  }
}
