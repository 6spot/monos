import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { TodoAssignProjectCommand, TodoCaptureCommand, TodoCommand, TodoCommandResult, TodoListQuery, TodoPage, TodoRecord, TodoSetArchivedCommand } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { assertActiveProject, lockConfiguration } from './configuration-guards.ts';

interface TodoRow {
  id: string; original_capture: string; project_id: string | null; archived: boolean;
  control_version: string; created_at: Date; discussion_activity_at: Date;
}
type TodoScope = Pick<TodoListQuery, 'scope' | 'project_id'>;
interface CursorPosition { discussion_activity_at: string; todo_id: string }
const columns = 'id,original_capture,project_id,archived,control_version,created_at,discussion_activity_at';

function record(row: TodoRow): TodoRecord {
  const line = row.original_capture.split(/\r\n|[\r\n\u2028\u2029]/u).find((part) => part.trim())?.trim() ?? '';
  return validate<TodoRecord>('TodoRecord', {
    schema_version: 1, todo_id: row.id, original_capture: row.original_capture,
    label: Array.from(line).slice(0, 160).join(''), ...(row.project_id ? { project_id: row.project_id } : {}),
    archived: row.archived, control_version: Number(row.control_version),
    created_at: row.created_at.toISOString(), discussion_activity_at: row.discussion_activity_at.toISOString(),
  });
}

export function todoCursor(scope: TodoScope, position: CursorPosition = { discussion_activity_at: '', todo_id: '' }): string {
  validate('TodoListQuery', scope);
  if (typeof position.discussion_activity_at !== 'string' || typeof position.todo_id !== 'string' || Boolean(position.discussion_activity_at) !== Boolean(position.todo_id)) throw new CommandError('invalid_input', 'Incomplete Todo cursor');
  if (position.discussion_activity_at) {
    validate('Id', position.todo_id);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(position.discussion_activity_at) || new Date(position.discussion_activity_at).toISOString() !== position.discussion_activity_at) throw new CommandError('invalid_input', 'Invalid Todo cursor time');
  }
  return Buffer.from(canonicalJSON({ version: 1, ...scope, ...position })).toString('base64url');
}

function readCursor(scope: TodoScope, cursor?: string): CursorPosition {
  if (cursor === undefined) return { discussion_activity_at: '', todo_id: '' };
  let value: TodoScope & CursorPosition & { version: number };
  try {
    validate('TodoCursor', cursor);
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('Noncanonical base64');
    value = JSON.parse(bytes.toString('utf8'));
    if (!value || value.version !== 1) throw new Error('Invalid cursor');
    const cursorScope = { scope: value.scope, ...(value.project_id !== undefined ? { project_id: value.project_id } : {}) };
    if (todoCursor(cursorScope, { discussion_activity_at: value.discussion_activity_at, todo_id: value.todo_id }) !== cursor) throw new Error('Noncanonical cursor');
  } catch { throw new CommandError('invalid_input', 'Invalid Todo cursor'); }
  if (value.scope !== scope.scope || value.project_id !== scope.project_id) throw new CommandError('denied_scope', 'Cursor belongs to another Todo scope');
  return { discussion_activity_at: value.discussion_activity_at, todo_id: value.todo_id };
}

async function selectTodo(tx: Transaction, todoId: string, write = false): Promise<TodoRow> {
  const row = (await tx.query<TodoRow>(`SELECT ${columns} FROM todos WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [todoId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown Todo');
  return row;
}

async function capture(tx: Transaction, command: TodoCaptureCommand): Promise<TodoRecord> {
  const { todo_id, original_capture, project_id } = command.payload;
  if (!original_capture.trim() || Buffer.byteLength(original_capture) > 262144) throw new CommandError('invalid_input', 'Capture requires nonblank text within 256 KiB');
  if (project_id) await assertActiveProject(tx, project_id);
  const inserted = await tx.query<TodoRow>(`INSERT INTO todos(id,original_capture,project_id,created_at,discussion_activity_at)
    VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`, [todo_id, original_capture, project_id ?? null]);
  if (!inserted.rows[0]) throw new CommandError('payload_conflict', 'Todo ID already belongs to an earlier capture');
  return record(inserted.rows[0]);
}

async function organize(tx: Transaction, command: TodoAssignProjectCommand | TodoSetArchivedCommand): Promise<TodoRecord> {
  const row = await selectTodo(tx, command.payload.todo_id, true);
  if (Number(row.control_version) !== command.expected_control_version) throw new CommandError('version_conflict', 'Todo changed; reload and review your edit', Number(row.control_version));
  const assignment = command.name === 'assign_todo_project';
  const projectId = assignment ? (command as TodoAssignProjectCommand).payload.project_id ?? null : row.project_id;
  const archived = assignment ? row.archived : (command as TodoSetArchivedCommand).payload.archived;
  if (projectId === row.project_id && archived === row.archived) return record(row);
  if (assignment && projectId) await assertActiveProject(tx, projectId);
  if (Number(row.control_version) === Number.MAX_SAFE_INTEGER) throw new CommandError('unmet_precondition', 'Todo version limit reached');
  const changed = (await tx.query<TodoRow>(`UPDATE todos SET project_id=$2,archived=$3,control_version=control_version+1 WHERE id=$1 RETURNING ${columns}`, [row.id, projectId, archived])).rows[0]!;
  return record(changed);
}

export class Todos {
  readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async command(token: string, body: unknown): Promise<TodoCommandResult> {
    const command = validate<TodoCommand>('TodoCommand', body);
    const json = canonicalJSON(command);
    if (Buffer.byteLength(json) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Todo command exceeds the request limit');
    const hash = digest(json);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      // Configuration precedes Todo locks, matching Project admission/removal.
      await lockConfiguration(tx);
      // Cross-session same-request admission, including captures of a new row.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('todo-command:' || $1,0))", [command.request_id]);
      const prior = (await tx.query<{ digest: string; response: TodoCommandResult }>('SELECT digest,response FROM todo_command_receipts WHERE request_id=$1', [command.request_id])).rows[0];
      if (prior) {
        if (prior.digest !== hash) throw new CommandError('payload_conflict', 'Request ID has different immutable content');
        return prior.response;
      }
      const todo = command.name === 'capture_todo' ? await capture(tx, command as TodoCaptureCommand) : await organize(tx, command as TodoAssignProjectCommand | TodoSetArchivedCommand);
      const response = validate<TodoCommandResult>('TodoCommandResult', { schema_version: 1, request_id: command.request_id, status: 'committed', todo });
      await tx.query('INSERT INTO todo_command_receipts(request_id,digest,response) VALUES($1,$2,$3)', [command.request_id, hash, response]);
      return response;
    });
  }

  async status(token: string, requestId: string): Promise<TodoCommandResult> {
    validate('Id', requestId);
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      return (await tx.query<{ response: TodoCommandResult }>('SELECT response FROM todo_command_receipts WHERE request_id=$1', [requestId])).rows[0]?.response ?? { schema_version: 1, request_id: requestId, status: 'unknown' };
    });
  }

  async read(token: string, todoId: string): Promise<TodoRecord> {
    validate('Id', todoId);
    return transaction(this.db, async (tx) => { await authenticateOwner(tx, token); return record(await selectTodo(tx, todoId)); });
  }

  async list(token: string, input: unknown): Promise<TodoPage> {
    const query = validate<TodoListQuery>('TodoListQuery', input);
    const scope: TodoScope = { scope: query.scope, ...(query.project_id ? { project_id: query.project_id } : {}) };
    return transaction(this.db, async (tx) => {
      await authenticateOwner(tx, token);
      const after = readCursor(scope, query.cursor);
      await lockConfiguration(tx);
      if (query.project_id) await assertActiveProject(tx, query.project_id);
      const rows = (await tx.query<TodoRow>(`SELECT ${columns} FROM todos
        WHERE archived=$1 AND ($2<>'inbox' OR project_id IS NULL) AND ($2<>'project' OR project_id=$3)
        AND ($4='' OR (discussion_activity_at,id)<(NULLIF($4,'')::timestamptz,$5))
        ORDER BY discussion_activity_at DESC,id DESC LIMIT 65`, [query.scope === 'archived', query.scope, query.project_id ?? null, after.discussion_activity_at, after.todo_id])).rows;
      const todos: TodoRecord[] = []; let position = after; let bytes = 2048;
      for (const row of rows) {
        if (todos.length === 64) break;
        const todo = record(row); const size = Buffer.byteLength(JSON.stringify(todo)) + 1;
        if (bytes + size > MAX_BODY_BYTES) break;
        todos.push(todo); bytes += size;
        position = { discussion_activity_at: todo.discussion_activity_at, todo_id: todo.todo_id };
      }
      return validate<TodoPage>('TodoPage', { schema_version: 1, ...scope, todos, cursor: todoCursor(scope, position), has_more: rows.length > todos.length });
    });
  }
}
