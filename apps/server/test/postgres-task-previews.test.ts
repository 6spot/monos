import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { validate } from '../../../packages/protocol/src/index.ts';
import type { ProjectConfiguration, TaskPreviewCommand } from '../../../packages/protocol/src/index.ts';
import { TaskPreviews } from '../src/task-previews.ts';
import { Todos } from '../src/todos.ts';
import { Discussion } from '../src/discussion.ts';
import { Configuration } from '../src/configuration.ts';
import { BoundaryService } from '../src/service.ts';
import { OwnerReads } from '../src/owner-reads.ts';
import { initializeTask } from '../src/task-records.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { createApp } from '../src/app.ts';
import { prepareProposalFixture, reviseSpecificationFixture } from './fixtures/task-preview-fixture.ts';
import { Worker } from './fixtures/process-worker.ts';

const fault = (code: string) => ({ detail: { code } });
const markdown = '  # Exact Specification\n\n- 数据 😀\n\nKeep **this** spacing.\n';
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('exact Task preview and creation', () => {
  let db: Database; let admin: Database; let namespace: string; let databaseUrl: string; let token: string;
  let previews: TaskPreviews; let service: BoundaryService; const workers: Worker[] = [];
  beforeEach(async () => {
    namespace = `task_preview_${randomUUID().replaceAll('-', '')}`; admin = database(process.env.DATABASE_URL!); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db); token = (await issueOwnerSession(db)).token;
    previews = new TaskPreviews(db); service = new BoundaryService(db, { signingKey: 'synthetic-task-creation-test-signing-key' });
  }, 20000);
  afterEach(async () => { await Promise.all(workers.splice(0).map((worker) => worker.stop())); if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } }, 20000);
  async function project(name = 'Project'): Promise<ProjectConfiguration> {
    const p = { id: randomUUID(), name, context: '', resources: [], role_ids: [], archived: false }; await saveProject(p); return p;
  }
  async function saveProject(p: ProjectConfiguration) {
    const config = new Configuration(db); return config.save(token, { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: (await config.read(token)).control_version, payload: p });
  }
  async function todo(projectId?: string) {
    const id = randomUUID(); await new Todos(db).command(token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: id, original_capture: 'Original capture must stay outside the Task', ...(projectId ? { project_id: projectId } : {}) } }); return id;
  }
  async function proposal(projectId?: string, settle = true) {
    const id = await todo(projectId); const fixture = await prepareProposalFixture(db, service, token, id); return fixture.commit('Exact Task title', markdown, settle);
  }
  async function confirm(p: { todo_id: string; proposal_message_id: string }, projectId: string, session = token) {
    const preview = await previews.read(session, p.todo_id, p.proposal_message_id, projectId);
    const command: TaskPreviewCommand = { schema_version: 1, request_id: randomUUID(), todo_id: p.todo_id, name: 'confirm_task_preview', payload: { proposal_message_id: p.proposal_message_id, project_id: projectId, content_digest: preview.content_digest! } };
    return { command, result: await previews.command(session, command) };
  }
  function creation(c: Awaited<ReturnType<typeof confirm>>): TaskPreviewCommand {
    return { schema_version: 1, request_id: randomUUID(), todo_id: c.command.todo_id, name: 'create_execution_task', payload: { proposal_message_id: c.command.payload.proposal_message_id, confirmation_id: c.result.confirmation_id!, content_digest: c.result.content_digest! } };
  }
  async function send(todoId: string) {
    return new Discussion(db, service.instanceId).command(token, { schema_version: 1, request_id: randomUUID(), todo_id: todoId, name: 'submit_discussion_message', payload: { message_id: randomUUID(), content: 'Newer Owner instruction' } });
  }
  async function assign(todoId: string, projectId?: string) {
    const todos = new Todos(db); const current = await todos.read(token, todoId);
    return todos.command(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: current.control_version, name: 'assign_todo_project', payload: { todo_id: todoId, ...(projectId ? { project_id: projectId } : {}) } });
  }

  it('creates one exact independent PLANNING Task from Inbox without Roles, resources or settled Discussion process', async () => {
    const p = await proposal(undefined, false); const chosen = await project();
    expect(await previews.read(token, p.todo_id, p.proposal_message_id)).toMatchObject({ state: 'project_required' });
    expect((await db.pool.query('SELECT 1 FROM task_creation_confirmations')).rowCount).toBe(0);
    const c = await confirm(p, chosen.id); expect(c.result.outcome).toBe('confirmed');
    expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(0);
    const command = creation(c); const result = await previews.command(token, command);
    expect(result.outcome).toBe('created'); expect(await previews.command(token, command)).toEqual(result);
    const task = await new OwnerReads(db).overview(token, result.task_id!);
    expect(task).toMatchObject({ title: 'Exact Task title', todo_id: p.todo_id, project_id: chosen.id, specification: markdown, specification_id: result.specification_id, initial_specification_id: result.specification_id, state: 'PLANNING', queued_attempts: 0, held_attempts: 0, open_operations: 0 });
    expect(task).not.toHaveProperty('plan_id'); expect(task.created_at).toBeDefined();
    expect((await db.pool.query('SELECT project_id FROM todos WHERE id=$1', [p.todo_id])).rows[0].project_id).toBeNull();
    expect((await db.pool.query('SELECT content FROM specification_revisions WHERE id=$1', [result.specification_id])).rows[0].content).toBe(markdown);
    for (const table of ['attempts', 'nodes', 'plan_revisions']) expect((await db.pool.query(`SELECT 1 FROM ${table} WHERE task_id=$1`, [result.task_id])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT 1 FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1', [result.task_id])).rowCount).toBe(0);
    expect((await new OwnerReads(db).events(token, result.task_id!)).events.map((event) => event.kind)).toEqual(['task_created']);
  }, 20000);

  it('deduplicates different requests/devices and same-content confirmations with one source outcome', async () => {
    const chosen = await project(); const p = await proposal(chosen.id); const second = (await issueOwnerSession(db)).token;
    const confirmations = await Promise.all([confirm(p, chosen.id), confirm(p, chosen.id, second)]);
    expect(confirmations[0]!.result.confirmation_id).toBe(confirmations[1]!.result.confirmation_id);
    const commands = Array.from({ length: 6 }, (_, index) => creation(confirmations[index % 2]!));
    const results = await Promise.all(commands.map((command, index) => previews.command(index % 2 ? second : token, command)));
    expect(new Set(results.map((result) => result.task_id)).size).toBe(1);
    expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(1); expect((await db.pool.query('SELECT 1 FROM task_preview_resolutions')).rowCount).toBe(1);
    const next = await prepareProposalFixture(db, service, token, p.todo_id); const fresh = await next.commit('Exact Task title', markdown);
    const independent = await previews.command(token, creation(await confirm(fresh, chosen.id))); expect(independent.task_id).not.toBe(results[0]!.task_id);
  }, 20000);

  it('allows explicit Project reconfirmation and one winner across differently authorized creations', async () => {
    const first = await project('First'); const second = await project('Second'); const p = await proposal();
    const a = await confirm(p, first.id); const b = await confirm(p, second.id); expect(a.result.confirmation_id).not.toBe(b.result.confirmation_id);
    const results = await Promise.allSettled([previews.command(token, creation(a)), previews.command(token, creation(b))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: fault('payload_conflict') });
    expect((await db.pool.query('SELECT 1 FROM task_creation_confirmations')).rowCount).toBe(2); expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(1);
  }, 20000);

  it('uses Owner source cutoff even when later input predates the assistant append', async () => {
    const chosen = await project(); const id = await todo(); const prepared = await prepareProposalFixture(db, service, token, id);
    await send(id); const p = await prepared.commit('Historical proposal', markdown);
    expect(await previews.read(token, id, p.proposal_message_id, chosen.id)).toMatchObject({ state: 'stale', reason: 'newer_input' });
    await expect(confirm(p, chosen.id)).rejects.toMatchObject(fault('version_conflict'));
    expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(0);
  }, 20000);

  it('rejects unconsumed confirmation after later input, including withdrawn input, while receipts remain immutable', async () => {
    const chosen = await project(); const p = await proposal(); const c = await confirm(p, chosen.id); await send(p.todo_id);
    await expect(previews.command(token, creation(c))).rejects.toMatchObject(fault('version_conflict'));
    const discussion = new Discussion(db, service.instanceId); const current = await discussion.status(token, p.todo_id);
    await discussion.command(token, { schema_version: 1, request_id: randomUUID(), todo_id: p.todo_id, name: 'withdraw_discussion_turn', expected_discussion_version: current.discussion_version, payload: { source_message_id: current.current_source!.message_id } });
    await expect(previews.command(token, creation(c))).rejects.toMatchObject(fault('version_conflict'));
    expect(await previews.command(token, c.command)).toEqual(c.result);
    expect((await db.pool.query('SELECT 1 FROM task_preview_resolutions')).rowCount).toBe(0);
  }, 20000);

  it('guards source Project epoch independently of selected Project and ignores ordinary context edits', async () => {
    const origin = await project('Origin'); const chosen = await project('Chosen'); const p = await proposal(origin.id);
    await saveProject({ ...origin, context: 'Edited Project Context does not stale exact proposal content' });
    const c = await confirm(p, chosen.id); await assign(p.todo_id, chosen.id); await assign(p.todo_id, origin.id);
    expect(await previews.read(token, p.todo_id, p.proposal_message_id, chosen.id)).toMatchObject({ state: 'stale', reason: 'source_project_changed' });
    await expect(previews.command(token, creation(c))).rejects.toMatchObject(fault('version_conflict'));
    expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(0);
  }, 20000);

  it('persists Cancel without Project and serializes cancellation versus creation', async () => {
    const p = await proposal(); const cancel: TaskPreviewCommand = { schema_version: 1, request_id: randomUUID(), todo_id: p.todo_id, name: 'cancel_task_preview', payload: { proposal_message_id: p.proposal_message_id } };
    const result = await previews.command(token, cancel); expect(await previews.command(token, cancel)).toEqual(result);
    expect(await previews.read(token, p.todo_id, p.proposal_message_id)).toMatchObject({ state: 'cancelled' });
    await expect(confirm(p, (await project()).id)).rejects.toThrow();
    const q = await proposal(); const c = await confirm(q, (await project()).id);
    const results = await Promise.allSettled([previews.command(token, creation(c)), previews.command(token, { ...cancel, request_id: randomUUID(), todo_id: q.todo_id, payload: { proposal_message_id: q.proposal_message_id } })]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect((await db.pool.query('SELECT 1 FROM task_preview_resolutions WHERE proposal_message_id=$1', [q.proposal_message_id])).rowCount).toBe(1);
  }, 20000);

  it('restores created Project before selector/default/freshness checks and preserves replay after later changes', async () => {
    const origin = await project('A'); const chosen = await project('B'); const later = await project('C'); const p = await proposal(origin.id); const c = await confirm(p, chosen.id);
    const result = await previews.command(token, creation(c)); await assign(p.todo_id, later.id); await send(p.todo_id);
    const todos = new Todos(db); await todos.command(token, { schema_version: 1, request_id: randomUUID(), name: 'set_todo_archived', expected_control_version: (await todos.read(token, p.todo_id)).control_version, payload: { todo_id: p.todo_id, archived: true } });
    await saveProject({ ...origin, archived: true }); await saveProject({ ...chosen, archived: true });
    for (const selection of [undefined, origin.id, later.id, 'missing-project']) expect(await previews.read(token, p.todo_id, p.proposal_message_id, selection)).toMatchObject({ state: 'created', selected_project_id: chosen.id, content_digest: c.result.content_digest, task: { task_id: result.task_id, project_id: chosen.id } });
    expect((await previews.command(token, creation(c))).task_id).toBe(result.task_id);
    expect(await previews.command(token, { ...c.command, request_id: randomUUID() })).toMatchObject({ outcome: 'created', task_id: result.task_id });
    await expect(previews.command(token, { ...c.command, request_id: randomUUID(), payload: { ...c.command.payload, project_id: later.id } })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id: p.todo_id, name: 'cancel_task_preview', payload: { proposal_message_id: p.proposal_message_id } })).rejects.toMatchObject(fault('unmet_precondition'));
  }, 20000);

  it('rejects unavailable selected Project, but permits a new explicit confirmation for an active replacement', async () => {
    const a = await project('A'); const b = await project('B'); const p = await proposal(); const c = await confirm(p, a.id); await saveProject({ ...a, archived: true });
    expect(await previews.read(token, p.todo_id, p.proposal_message_id, a.id)).toMatchObject({ state: 'unavailable', reason: 'project_unavailable' });
    await expect(previews.command(token, creation(c))).rejects.toMatchObject(fault('unmet_precondition'));
    const replacement = await confirm(p, b.id); expect(replacement.result.confirmation_id).not.toBe(c.result.confirmation_id);
    expect((await previews.command(token, creation(replacement))).outcome).toBe('created');
  }, 20000);

  it('serializes Project archive with exact creation using actual PostgreSQL lock contention', async () => {
    const chosen = await project(); const p = await proposal(); const c = await confirm(p, chosen.id); const writer = await db.pool.connect();
    let creating: ReturnType<typeof previews.command> | undefined;
    try {
      await writer.query('BEGIN'); await writer.query('SELECT version FROM configuration_control FOR UPDATE');
      const pid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      creating = previews.command(token, creation(c)); void creating.catch(() => undefined); let blocked = false;
      for (let n = 0; n < 500; n++) { if ((await admin.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'", [pid])).rowCount) { blocked = true; break; } await delay(10); }
      expect(blocked).toBe(true); await writer.query('UPDATE projects SET archived=true WHERE id=$1', [chosen.id]); await writer.query('COMMIT');
      await expect(creating).rejects.toMatchObject(fault('unmet_precondition')); expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(0);
    } finally { await writer.query('ROLLBACK'); await creating?.catch(() => undefined); writer.release(); }
  }, 20000);

  it('rolls back confirmation/creation/cancellation together with failed receipts', async () => {
    const chosen = await project(); const p = await proposal();
    await db.pool.query("CREATE FUNCTION fail_preview_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected preview receipt failure'; END; $$");
    await db.pool.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON task_preview_command_receipts FOR EACH ROW EXECUTE FUNCTION fail_preview_receipt()');
    await expect(confirm(p, chosen.id)).rejects.toThrow('injected preview receipt failure'); expect((await db.pool.query('SELECT 1 FROM task_creation_confirmations')).rowCount).toBe(0);
    await db.pool.query('DROP TRIGGER fail_receipt ON task_preview_command_receipts'); const c = await confirm(p, chosen.id); const command = creation(c);
    await db.pool.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON task_preview_command_receipts FOR EACH ROW EXECUTE FUNCTION fail_preview_receipt()');
    await expect(previews.command(token, command)).rejects.toThrow('injected preview receipt failure');
    for (const table of ['tasks', 'specification_revisions', 'task_preview_resolutions', 'task_events']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    await expect(previews.command(token, { schema_version: 1, request_id: randomUUID(), todo_id: p.todo_id, name: 'cancel_task_preview', payload: { proposal_message_id: p.proposal_message_id } })).rejects.toThrow('injected preview receipt failure');
    expect((await db.pool.query('SELECT 1 FROM task_preview_resolutions')).rowCount).toBe(0); expect((await previews.receipt(token, command.request_id)).status).toBe('unknown');
    await db.pool.query('DROP TRIGGER fail_receipt ON task_preview_command_receipts'); expect((await previews.command(token, command)).outcome).toBe('created');
  }, 20000);

  it('protects immutable Task provenance while pairing Markdown with the current Specification revision', async () => {
    const chosen = await project(); const p = await proposal(); const result = await previews.command(token, creation(await confirm(p, chosen.id)));
    for (const assignment of ["title='changed'", 'todo_id=NULL', 'project_id=NULL', 'initial_specification_id=NULL', 'creation_confirmation_id=NULL']) await expect(db.pool.query(`UPDATE tasks SET ${assignment} WHERE id=$1`, [result.task_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query("UPDATE specification_revisions SET content='{}' WHERE id=$1", [result.specification_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('DELETE FROM task_creation_confirmations WHERE id=$1', [result.confirmation_id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query('DELETE FROM task_preview_resolutions WHERE proposal_message_id=$1', [p.proposal_message_id])).rejects.toMatchObject({ code: '23514' });
    // Existing Task revision primitives allow more Markdown than one Discussion message.
    const currentMarkdown = '# New current requirement\n' + 'x'.repeat(70000);
    const next = await reviseSpecificationFixture(db, token, result.task_id!, currentMarkdown);
    expect(await new OwnerReads(db).overview(token, result.task_id!)).toMatchObject({ initial_specification_id: result.specification_id, specification_id: next.specification_id, specification: currentMarkdown });
    const legacy = await reviseSpecificationFixture(db, token, result.task_id!, { legacy: 'untyped content' });
    const overview = await new OwnerReads(db).overview(token, result.task_id!); expect(overview.specification_id).toBe(legacy.specification_id); expect(overview).not.toHaveProperty('specification');
    expect((await previews.read(token, p.todo_id, p.proposal_message_id)).task).toEqual(overview);
  }, 20000);

  it('authenticates reads/recovery, denies foreign source/confirmation and preserves request identity before lookup', async () => {
    const chosen = await project(); const p = await proposal(); const c = await confirm(p, chosen.id); const other = await todo();
    await expect(previews.command(token, { ...c.command, todo_id: 'missing' })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(previews.read(token, other, p.proposal_message_id)).rejects.toMatchObject(fault('denied_scope'));
    await expect(previews.command(token, { ...creation(c), payload: { ...creation(c).payload, confirmation_id: 'missing' } })).rejects.toMatchObject(fault('denied_scope'));
    const app = createApp(service); const session = await issueOwnerSession(db); const headers = { authorization: `Bearer ${session.token}` };
    try {
      const url = `/v1/owner/todos/${p.todo_id}/task-previews/${p.proposal_message_id}?project_id=${chosen.id}`;
      expect((await app.inject({ url })).statusCode).toBe(401); const read = await app.inject({ url, headers }); expect(read.statusCode).toBe(200); validate('TaskPreviewStatus', read.json()); expect(read.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST', url: '/v1/owner/task-previews/commands', headers: { cookie: `monos=${session.token}`, origin: 'https://foreign.invalid' }, payload: creation(c) })).statusCode).toBe(403);
      expect((await app.inject({ url: `${url}&extra=true`, headers })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: '/v1/owner/task-previews/commands', headers, payload: { ...creation(c), payload: { ...creation(c).payload, start: true } } })).statusCode).toBe(409);
      await revokeOwnerSession(db, session.session_id); expect((await app.inject({ url: `/v1/owner/task-previews/commands/${c.command.request_id}`, headers })).statusCode).toBe(401);
    } finally { await app.close(); }
  }, 20000);

  it('reads legacy Markdown without inventing unavailable Task creation metadata', async () => {
    const reads = new OwnerReads(db);
    for (const specification of ['# Legacy exact Markdown\n', { legacy: 'arbitrary JSON' }]) {
      const taskId = randomUUID(); await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification }));
      const overview = await reads.overview(token, taskId);
      if (typeof specification === 'string') expect(overview.specification).toBe(specification); else expect(overview).not.toHaveProperty('specification');
      for (const field of ['title', 'todo_id', 'project_id', 'initial_specification_id', 'created_at']) expect(overview).not.toHaveProperty(field);
    }
  }, 20000);

  it('recovers zero-or-one Task across independent process SIGKILL before and after COMMIT', async () => {
    const chosen = await project();
    for (const phase of ['before', 'after'] as const) {
      const p = await proposal(); const c = await confirm(p, chosen.id); const command = creation(c);
      const worker = new Worker(databaseUrl, new URL('./fixtures/task-creation-worker.ts', import.meta.url)); workers.push(worker);
      await worker.next('ready'); worker.send({ command, crash: phase });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([worker.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Creation child did not terminate')), 10000); })]); } finally { clearTimeout(timer); }
      expect(worker.messages).toEqual([]); expect(worker.child.signalCode).toBe('SIGKILL');
      expect((await previews.receipt(token, command.request_id)).status).toBe(phase === 'before' ? 'unknown' : 'committed');
      expect((await db.pool.query('SELECT 1 FROM tasks WHERE todo_id=$1', [p.todo_id])).rowCount).toBe(phase === 'before' ? 0 : 1);
      const replayed = await previews.command(token, command); expect((await previews.command(token, creation(c))).task_id).toBe(replayed.task_id);
      expect((await db.pool.query('SELECT 1 FROM tasks WHERE todo_id=$1', [p.todo_id])).rowCount).toBe(1);
    }
  }, 30000);
});
