import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import type { ProjectConfiguration, TodoCaptureCommand, TodoCommand, TodoRecord } from '../../../packages/protocol/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { Todos, todoCursor } from '../src/todos.ts';
import { initializeTask } from '../src/task-records.ts';
import { createApp } from '../src/app.ts';
import { BoundaryService } from '../src/service.ts';

const fault = (code: string) => ({ detail: { code } });
const captureCommand = (text = 'An idea', projectId?: string): TodoCaptureCommand => ({ schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: randomUUID(), original_capture: text, ...(projectId ? { project_id: projectId } : {}) } });
const archiveCommand = (todo: TodoRecord, archived: boolean): TodoCommand => ({ schema_version: 1, request_id: randomUUID(), name: 'set_todo_archived', expected_control_version: todo.control_version, payload: { todo_id: todo.todo_id, archived } });
const assignCommand = (todo: TodoRecord, projectId?: string): TodoCommand => ({ schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: todo.control_version, payload: { todo_id: todo.todo_id, ...(projectId ? { project_id: projectId } : {}) } });

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Todo capture and lifecycle', () => {
  let db: Database; let admin: Database; let todos: Todos; let configuration: Configuration; let token: string;
  const namespace = `todos_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db); todos = new Todos(db); configuration = new Configuration(db); token = (await issueOwnerSession(db)).token;
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function project(): Promise<ProjectConfiguration> {
    const p = { id: randomUUID(), name: 'Todo Project', context: 'Project context', archived: false, resources: [], role_ids: [] };
    await saveProject(p); return p;
  }
  async function saveProject(p: ProjectConfiguration) {
    await configuration.save(token, { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: (await configuration.read(token)).control_version, payload: p });
  }
  async function capture(text?: string, projectId?: string) { return (await todos.command(token, captureCommand(text, projectId))).todo!; }
  async function workCounts() {
    return (await db.pool.query(`SELECT (SELECT count(*) FROM tasks)::int AS tasks,(SELECT count(*) FROM attempts)::int AS attempts,(SELECT count(*) FROM outbox)::int AS outbox,(SELECT count(*) FROM operations)::int AS operations,(SELECT count(*) FROM task_events)::int AS events`)).rows[0];
  }

  it('captures exact immutable Owner text without Discussion, Task or Runtime effects, and opens without effects', async () => {
    const before = await workCounts(); const text = '\n \t\r\n  Think about 😀 & 数据  \r\nSecond line\n'; const command = captureCommand(text);
    const result = await todos.command(token, command); const todo = result.todo!;
    expect(todo).toMatchObject({ todo_id: command.payload.todo_id, original_capture: text, label: 'Think about 😀 & 数据', archived: false, control_version: 1 });
    expect(todo).not.toHaveProperty('project_id'); expect(todo.discussion_activity_at).toBe(todo.created_at);
    expect(await new Todos(db).read(token, todo.todo_id)).toEqual(todo);
    expect((await todos.list(token, { scope: 'inbox' })).todos).toContainEqual(todo);
    expect(await todos.command(token, command)).toEqual(result); expect(await workCounts()).toEqual(before);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM todos WHERE id=$1', [todo.todo_id])).rows[0].count).toBe(1);
  });

  it('serializes cross-session retries and reports changed payloads before target lookup', async () => {
    const session = await issueOwnerSession(db); const command = captureCommand();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => todos.command(index % 2 ? session.token : token, command)));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await todos.status(session.token, command.request_id)).toEqual(results[0]);
    await expect(todos.command(token, { ...command, payload: { ...command.payload, todo_id: 'missing', project_id: 'missing' } })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(todos.command(token, { ...command, request_id: randomUUID() })).rejects.toMatchObject(fault('payload_conflict'));
    const org = archiveCommand(results[0]!.todo!, true); const archived = await todos.command(token, org);
    await expect(todos.command(token, { ...org, payload: { todo_id: 'missing', archived: true } })).rejects.toMatchObject(fault('payload_conflict'));
    expect(await todos.command(token, command)).toEqual(results[0]); expect(await todos.command(token, org)).toEqual(archived);
  });

  it('moves between active Projects and Inbox, preserving capture, activity, and existing Task Project', async () => {
    const p = await project(); const other = await project(); const original = await capture('Original capture', p.id);
    const taskId = randomUUID(); await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: {}, project_id: p.id }));
    await capture('Unrelated'); await saveProject({ ...other, context: 'Changed configuration does not stale Todo' });
    const moved = (await todos.command(token, assignCommand(original, other.id))).todo!;
    expect(moved).toMatchObject({ project_id: other.id, control_version: 2, original_capture: original.original_capture, discussion_activity_at: original.discussion_activity_at });
    expect((await db.pool.query('SELECT project_id FROM tasks WHERE id=$1', [taskId])).rows[0].project_id).toBe(p.id);
    const inbox = (await todos.command(token, assignCommand(moved))).todo!; expect(inbox).not.toHaveProperty('project_id');
    expect(inbox.control_version).toBe(3); expect((await todos.command(token, assignCommand(inbox))).todo).toEqual(inbox);
    const archived = (await todos.command(token, archiveCommand(inbox, true))).todo!;
    expect((await todos.list(token, { scope: 'inbox' })).todos.some((t) => t.todo_id === archived.todo_id)).toBe(false);
    expect((await todos.list(token, { scope: 'archived' })).todos).toContainEqual(archived);
    const restored = (await todos.command(token, archiveCommand(archived, false))).todo!;
    expect(restored).toMatchObject({ archived: false, control_version: 5, original_capture: original.original_capture, discussion_activity_at: original.discussion_activity_at });
    expect((await todos.command(token, archiveCommand(restored, false))).todo).toEqual(restored);
    await expect(todos.command(token, assignCommand(original))).rejects.toMatchObject(fault('version_conflict'));
  });

  it('requires active Project for new associations and allows historical archived association reads', async () => {
    const p = await project(); const command = captureCommand('History', p.id); const result = await todos.command(token, command); const original = result.todo!;
    await saveProject({ ...p, archived: true });
    expect(await todos.command(token, command)).toEqual(result);
    expect((await todos.read(token, original.todo_id)).project_id).toBe(p.id);
    expect((await todos.command(token, assignCommand(original, p.id))).todo).toEqual(original);
    for (const projectId of [p.id, 'missing']) {
      const command = captureCommand('Invalid Project', projectId);
      await expect(todos.command(token, command)).rejects.toMatchObject(fault('unmet_precondition'));
      expect((await todos.status(token, command.request_id)).status).toBe('unknown');
    }
    const moved = (await todos.command(token, assignCommand(original))).todo!;
    await expect(todos.command(token, assignCommand(moved, p.id))).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(todos.list(token, { scope: 'project', project_id: p.id })).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('waits for concurrent Project configuration and rejects an archived association after the lock releases', async () => {
    const p = await project(); const command = captureCommand('Concurrent Project archive', p.id); const blocker = await db.pool.connect();
    let admitted: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT version FROM configuration_control FOR UPDATE');
      const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      admitted = todos.command(token, command).catch((error: unknown) => error);
      // Assert real lock contention, not merely a timing delay.
      await expect.poll(async () => (await db.pool.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))', [pid])).rowCount, { timeout: 5000 }).toBeGreaterThan(0);
      await blocker.query('UPDATE projects SET archived=true WHERE id=$1', [p.id]); await blocker.query('COMMIT');
      expect(await admitted).toMatchObject(fault('unmet_precondition'));
      expect((await todos.status(token, command.request_id)).status).toBe('unknown');
      await expect(todos.read(token, command.payload.todo_id)).rejects.toMatchObject(fault('denied_scope'));
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await admitted; }
  }, 15000);

  it('admits only one concurrent organization change for a Todo version', async () => {
    const p = await project(); const todo = await capture(); const before = await workCounts();
    const commands = [assignCommand(todo, p.id), archiveCommand(todo, true)];
    const results = await Promise.allSettled(commands.map((command) => todos.command(token, command)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: fault('version_conflict') });
    expect((await todos.read(token, todo.todo_id)).control_version).toBe(2); expect(await workCounts()).toEqual(before);
  });

  it('protects original capture, stable identity, creation time and immutable receipts in PostgreSQL', async () => {
    const command = captureCommand(); await todos.command(token, command);
    for (const sql of ["UPDATE todos SET original_capture='changed' WHERE id=$1", "UPDATE todos SET id='changed' WHERE id=$1", "UPDATE todos SET created_at=created_at+interval '1 second' WHERE id=$1", 'DELETE FROM todos WHERE id=$1']) await expect(db.pool.query(sql, [command.payload.todo_id])).rejects.toMatchObject({ code: '23514' });
    for (const sql of ["UPDATE todo_command_receipts SET digest='changed' WHERE request_id=$1", 'DELETE FROM todo_command_receipts WHERE request_id=$1']) await expect(db.pool.query(sql, [command.request_id])).rejects.toMatchObject({ code: '23514' });
    expect((await todos.read(token, command.payload.todo_id)).original_capture).toBe(command.payload.original_capture);
  });

  it('rolls back capture and organization together with failed receipt persistence', async () => {
    const existing = await capture(); const command = captureCommand(); const organization = archiveCommand(existing, true);
    await db.pool.query(`CREATE FUNCTION fail_todo_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END; $$`);
    await db.pool.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON todo_command_receipts FOR EACH ROW EXECUTE FUNCTION fail_todo_receipt()');
    try {
      for (const input of [command, organization]) {
        await expect(todos.command(token, input)).rejects.toThrow('test receipt failure');
        expect((await todos.status(token, input.request_id)).status).toBe('unknown');
      }
      await expect(todos.read(token, command.payload.todo_id)).rejects.toMatchObject(fault('denied_scope'));
      expect(await todos.read(token, existing.todo_id)).toEqual(existing);
    } finally { await db.pool.query('DROP TRIGGER fail_receipt ON todo_command_receipts'); await db.pool.query('DROP FUNCTION fail_todo_receipt()'); }
    expect((await todos.command(token, command)).status).toBe('committed');
  });

  it('pages stable activity/ID order and binds cursors to exact filters', async () => {
    const p = await project(); const other = await project();
    await db.pool.query("INSERT INTO todos(id,original_capture,project_id,created_at,discussion_activity_at) SELECT 'page-'||lpad(n::text,3,'0'),'Paged idea '||n,$1,'2026-09-29T00:00:00.123Z','2026-09-29T00:00:00.123Z' FROM generate_series(1,70) n", [p.id]);
    const scope = { scope: 'project', project_id: p.id } as const; const first = await todos.list(token, scope);
    expect(first.todos).toHaveLength(64); expect(first.has_more).toBe(true); expect(first.todos[0]!.todo_id).toBe('page-070');
    const second = await todos.list(token, { ...scope, cursor: first.cursor });
    expect(second.todos).toHaveLength(6); expect(second.has_more).toBe(false);
    expect([...first.todos, ...second.todos].map((todo) => todo.todo_id)).toEqual(Array.from({ length: 70 }, (_, i) => `page-${String(70 - i).padStart(3, '0')}`));
    expect(await new Todos(db).list(token, { ...scope, cursor: first.cursor })).toEqual(second);
    const empty = await todos.list(token, { ...scope, cursor: second.cursor }); expect(empty.todos).toEqual([]); expect(empty.cursor).toBe(second.cursor);
    for (const input of [{ scope: 'inbox', cursor: first.cursor }, { scope: 'project', project_id: other.id, cursor: first.cursor }]) await expect(todos.list(token, input)).rejects.toMatchObject(fault('denied_scope'));
    const malformed = [first.cursor + '=', Buffer.from(JSON.stringify({ version: 1, scope: 'all', todo_id: 'a', discussion_activity_at: '2026-02-30T00:00:00.000Z' })).toString('base64url'), Buffer.from(canonicalJSON({ version: 1, scope: 'all', todo_id: '', discussion_activity_at: '', extra: true })).toString('base64url')];
    for (const cursor of malformed) await expect(todos.list(token, { scope: 'all', cursor })).rejects.toThrow();
    for (const input of [{ scope: 'project' }, { scope: 'all', project_id: p.id }, { scope: 'all', limit: 1000 }]) await expect(todos.list(token, input)).rejects.toThrow();
    const noRows = await todos.list(token, { scope: 'project', project_id: other.id }); expect(noRows.cursor).toBe(todoCursor({ scope: 'project', project_id: other.id }));
  });

  it('bounds Unicode response pages by encoded bytes and advances only through returned records', async () => {
    const p = await project(); const text = '😀'.repeat(65536);
    await db.pool.query("INSERT INTO todos(id,original_capture,project_id,created_at,discussion_activity_at) SELECT 'large-'||lpad(n::text,2,'0'),$1,$2,'2026-09-29T00:00:00.000Z','2026-09-29T00:00:00.000Z' FROM generate_series(1,12) n", [text, p.id]);
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const page = await todos.list(token, { scope: 'project', project_id: p.id, ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_BODY_BYTES);
      expect(page.todos.length).toBeGreaterThan(0); for (const todo of page.todos) { expect(todo.original_capture).toBe(text); expect(Array.from(todo.label)).toHaveLength(160); seen.push(todo.todo_id); }
      cursor = page.cursor; if (!page.has_more) break;
    }
    expect(seen).toHaveLength(12); expect(new Set(seen).size).toBe(12);
  });

  it('rejects blank, malformed and oversized capture without receipts or domain work', async () => {
    const before = await workCounts();
    for (const text of ['', ' \n\t\r\u2003', 'a\u0000b', '\ud800', 'x'.repeat(65537)]) {
      const command = captureCommand(text); await expect(todos.command(token, command)).rejects.toThrow();
      expect((await todos.status(token, command.request_id)).status).toBe('unknown');
    }
    expect(await workCounts()).toEqual(before);
  });

  it('authenticates detail/list/commands/receipts and validates strict HTTP boundaries', async () => {
    const app = createApp(new BoundaryService(db, { signingKey: 'test-only-todo-capture-signing-key' })); const session = await issueOwnerSession(db); const command = captureCommand();
    const paths = ['/v1/owner/todos?scope=all', `/v1/owner/todos/${command.payload.todo_id}`, `/v1/owner/todos/commands/${command.request_id}`];
    try {
      for (const path of paths) for (const headers of [{}, { authorization: 'Bearer runner-invalid' }]) expect((await app.inject({ method: 'GET', url: path, headers })).statusCode).toBe(401);
      const cookie = `monos=${session.token}`;
      expect((await app.inject({ method: 'POST', url: '/v1/owner/todos/commands', headers: { cookie }, payload: command })).statusCode).toBe(403);
      const headers = { authorization: `Bearer ${session.token}` };
      const saved = await app.inject({ method: 'POST', url: '/v1/owner/todos/commands', headers, payload: command });
      expect(saved.statusCode).toBe(200); expect(saved.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'GET', url: paths[1]!, headers })).json()).toEqual(saved.json().todo);
      expect((await app.inject({ method: 'GET', url: paths[2]!, headers })).json()).toEqual(saved.json());
      for (const [body, code] of [[{ ...command, schema_version: 2 }, 'unsupported_version'], [{ ...command, extra: true }, 'invalid_input'], [captureCommand(' \n'), 'invalid_input']] as const) {
        const response = await app.inject({ method: 'POST', url: '/v1/owner/todos/commands', headers, payload: body }); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe(code);
      }
      const invalid = await app.inject({ method: 'GET', url: '/v1/owner/todos?scope=all&extra=true', headers }); expect(invalid.json().error.code).toBe('invalid_input');
      await revokeOwnerSession(db, session.session_id);
      for (const path of paths) expect((await app.inject({ method: 'GET', url: path, headers })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/v1/owner/todos/commands', headers, payload: command })).statusCode).toBe(401);
    } finally { await app.close(); }
  });
});
