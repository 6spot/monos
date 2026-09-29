import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { submission, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, DiscussionCommand, Dispatch, ProjectConfiguration } from '../../../packages/protocol/src/index.ts';
import { Todos } from '../src/todos.ts';
import { Discussion } from '../src/discussion.ts';
import { TodoAttemptReads } from '../src/todo-attempt-reads.ts';
import { BoundaryService } from '../src/service.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { Configuration } from '../src/configuration.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { createApp } from '../src/app.ts';
import { Worker } from './fixtures/process-worker.ts';

const signingKey = 'test-only-admission-worker-signing-key';
const fault = (code: string) => ({ detail: { code } });
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('ordered Todo Discussion', () => {
  let db: Database; let admin: Database; let namespace: string; let databaseUrl: string; let token: string; let discussion: Discussion; let service: BoundaryService; let queue: DispatchQueue;
  const workers: Worker[] = [];
  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    namespace = `discussion_${randomUUID().replaceAll('-', '')}`; admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db); token = (await issueOwnerSession(db)).token;
    service = new BoundaryService(db, { signingKey }); discussion = new Discussion(db, service.instanceId); queue = new DispatchQueue(db);
  }, 20000);
  afterEach(async () => { await Promise.all(workers.splice(0).map((worker) => worker.stop())); if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } }, 20000);
  async function todo(projectId?: string) {
    const id = randomUUID(); await new Todos(db).command(token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: id, original_capture: 'Immutable capture 😀', ...(projectId ? { project_id: projectId } : {}) } }); return id;
  }
  async function send(todoId: string, content = 'Discuss this idea', requestId = randomUUID()) {
    const command: DiscussionCommand = { schema_version: 1, request_id: requestId, todo_id: todoId, name: 'submit_discussion_message', payload: { message_id: randomUUID(), content } };
    return { command, result: await discussion.command(token, command) };
  }
  async function runner(capacity = 2) {
    const id = randomUUID(); await enrollFixture(db, id, randomUUID(), capacity);
    const incarnation = await service.connect(id, 'test-boot');
    await service.touch(id, incarnation, true, [{ runtime_id: 'opencode', executable: '/owner/opencode', version: '1.18.30', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ planner: { default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free', runner_id: id }, fallback_targets: [] } }]);
    return { id, incarnation };
  }
  async function start(todoId: string, r: { id: string; incarnation: number }) {
    await discussion.pump(); const launch = await queue.promoteNext(r.id, service.instanceId, r.incarnation);
    expect(launch?.todo_id).toBe(todoId); const grant = await service.authorize(r.id, r.incarnation, launch!.dispatch_id); expect(grant).not.toBeNull();
    return { launch: launch!, credential: grant!.credential };
  }
  function commit(launch: Dispatch, reply = 'A canonical reply'): CommandEnvelope {
    return { schema_version: 1, request_id: randomUUID(), scope_id: launch.todo_id!, expected_control_version: launch.control_version, name: 'commit_discussion_turn', payload: { reply, working_requirement_state: 'Current understanding', source_message_id: launch.source_message_id!, source_watermark: launch.source_watermark } };
  }
  async function settle(r: { id: string; incarnation: number }, attemptId: string) {
    const op = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [attemptId])).rows[0]; expect(op).toBeDefined();
    await service.finishOperation(r.id, r.incarnation, { attempt_id: attemptId, operation_id: op.id, success: true, result: { writer_absent: true } });
  }
  async function ownerAction(todoId: string, name: 'stop_discussion_turn' | 'retry_discussion_turn' | 'withdraw_discussion_turn') {
    const current = await discussion.status(token, todoId); const command: DiscussionCommand = { schema_version: 1, request_id: randomUUID(), todo_id: todoId, expected_discussion_version: current.discussion_version, name, payload: { source_message_id: current.current_source!.message_id, ...(name === 'stop_discussion_turn' ? { attempt_id: current.current_source!.attempt_id! } : {}) } };
    return { command, result: await discussion.command(token, command) };
  }
  async function project(name: string) {
    const p: ProjectConfiguration = { id: randomUUID(), name, context: `Context ${name}`, archived: false, resources: [], role_ids: [] }; const config = new Configuration(db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: (await config.read(token)).control_version, payload: p }); return p;
  }

  it('persists exact input/receipt/outbox without a Runtime, and reads/capture create no Discussion work', async () => {
    const id = await todo(); await discussion.status(token, id); await discussion.messages(token, id);
    expect((await db.pool.query('SELECT 1 FROM todo_discussion_controls')).rowCount).toBe(0);
    const sent = await send(id, '  Owner text\n数据 😀  '); const secondSession = (await issueOwnerSession(db)).token;
    const results = await Promise.all(Array.from({ length: 5 }, () => discussion.command(secondSession, sent.command)));
    for (const result of results) expect(result).toEqual(sent.result);
    await discussion.pump(); expect((await discussion.status(token, id)).current_source).toMatchObject({ status: 'queued', waiting_reason: 'policy_missing' });
    expect((await discussion.messages(token, id)).messages[0]!.content).toBe('  Owner text\n数据 😀  ');
    for (const table of ['attempts', 'tasks', 'nodes', 'outbox']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    expect((await db.pool.query('SELECT 1 FROM todo_discussion_outbox WHERE NOT done')).rowCount).toBe(1);
    await expect(discussion.command(token, { ...sent.command, todo_id: 'missing' })).rejects.toMatchObject(fault('payload_conflict'));
    await ownerAction(id, 'withdraw_discussion_turn'); expect((await discussion.messages(token, id)).messages[0]!.disposition).toBe('withdrawn');
  }, 20000);

  it('atomically commits one reply and cache, keeps later source ordered and waits for physical Stop', async () => {
    const id = await todo(); const first = await send(id); const r = await runner(); const f = await start(id, r); const second = await send(id, 'Later instruction');
    expect(f.launch).not.toHaveProperty('task_id'); expect(f.launch).not.toHaveProperty('resource_id');
    expect(f.launch.prompt).not.toContain('Later instruction'); const command = commit(f.launch);
    const results = await Promise.all([service.admit(f.credential, submission(command)), service.admit(f.credential, submission(command))]); expect(results[1]).toEqual(results[0]);
    expect((await discussion.status(token, id))).toMatchObject({ resolved_watermark: 1, working_requirement_state: 'Current understanding', current_source: { message_id: second.result.message_id, status: 'settling' } });
    expect((await discussion.messages(token, id)).messages.map((m) => m.author)).toEqual(['owner', 'owner', 'assistant']);
    const reply = (await discussion.messages(token, id)).messages[2]!; expect(reply.source_message_id).toBe(first.result.message_id);
    await discussion.pump(); expect(await queue.promoteNext(r.id, service.instanceId, r.incarnation)).toBeNull();
    await settle(r, f.launch.attempt_id);
    const next = await queue.promoteNext(r.id, service.instanceId, r.incarnation); expect(next?.source_message_id).toBe(second.result.message_id); expect(next!.prompt).toContain('A canonical reply');
    expect((await db.pool.query('SELECT 1 FROM tasks')).rowCount).toBe(0); expect((await db.pool.query('SELECT 1 FROM task_events')).rowCount).toBe(0);
    expect(await service.commandStatus(f.credential, command.request_id)).toEqual(results[0]);
    await service.event(r.id, r.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'facts', sequence: 1, order_sequence: 1, kind: 'exited', text: '', exit_code: 0 });
    expect((await db.pool.query('SELECT state FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].state).toBe('SUCCEEDED');
    await expect(db.pool.query("UPDATE todo_discussion_messages SET content='changed' WHERE id=$1", [reply.message_id])).rejects.toMatchObject({ code: '23514' });
    await expect(service.admit(f.credential, submission({ ...command, request_id: randomUUID() }))).rejects.toMatchObject(fault('stale_execution'));
  }, 20000);

  it('uses shared slots with Task execution and independent Todos, including equal Task/Todo IDs', async () => {
    const a = await todo(); const b = await todo(); const r = await runner(2);
    await createAttemptFixture(db, { runner_id: r.id, task_id: a, attempt_id: randomUUID(), kind: 'node', resource_id: 'repo', prompt: 'Task fixture' });
    await send(a); await send(b); await Promise.all([discussion.pump(), new Discussion(db, service.instanceId).pump()]);
    const first = await queue.promoteNext(r.id, service.instanceId, r.incarnation); expect(first?.todo_id).toBe(a);
    expect(await queue.promoteNext(r.id, service.instanceId, r.incarnation)).toBeNull();
    expect((await db.pool.query('SELECT count(*)::int AS count FROM attempts WHERE NOT process_released')).rows[0].count).toBe(2);
    expect((await db.pool.query("SELECT 1 FROM attempts WHERE todo_id=$1 AND state='QUEUED'", [b])).rowCount).toBe(1);
    const grant = (await service.authorize(r.id, r.incarnation, first!.dispatch_id))!;
    const result = await service.admit(grant.credential, submission(commit(first!))); await settle(r, first!.attempt_id);
    expect((await queue.promoteNext(r.id, service.instanceId, r.incarnation))?.todo_id).toBe(b);
    expect((await db.pool.query('SELECT 1 FROM command_receipts WHERE attempt_id=$1 AND scope_id=$2', [first!.attempt_id, a])).rowCount).toBe(1); expect(result.status).toBe('committed');
  }, 20000);

  it('retains exact input and reports context budget attention before an oversized prompt becomes an Attempt', async () => {
    const id = randomUUID(); const capture = 'A'.repeat(65536); const guidance = 'B'.repeat(65536); const content = 'C'.repeat(65536); const state = 'D'.repeat(65536);
    await new Todos(db).command(token, { schema_version: 1, request_id: randomUUID(), name: 'capture_todo', payload: { todo_id: id, original_capture: capture } });
    const config = new Configuration(db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), name: 'save_planner_guidance', expected_control_version: (await config.read(token)).control_version, payload: { guidance } });
    await send(id, 'Seed understanding'); const r = await runner(); const f = await start(id, r); const command = commit(f.launch); command.payload.working_requirement_state = state;
    await service.admit(f.credential, submission(command)); await settle(r, f.launch.attempt_id);
    const sent = await send(id, content); await discussion.pump();
    expect((await discussion.status(token, id))).toMatchObject({ working_requirement_state: state, current_source: { message_id: sent.result.message_id, status: 'queued', waiting_reason: 'context_budget_exceeded' } });
    expect((await discussion.messages(token, id)).messages.at(-1)!.content).toBe(content);
    expect((await db.pool.query('SELECT 1 FROM attempts WHERE todo_id=$1', [id])).rowCount).toBe(1);
    expect((await db.pool.query('SELECT context FROM todo_discussion_outbox WHERE todo_id=$1 AND NOT done', [id])).rows).toEqual([{ context: null }]);
    expect(await discussion.command(token, sent.command)).toEqual(sent.result);
  }, 20000);

  it('preserves requirement cache content and attribution across withdrawal for status and the next turn', async () => {
    const id = await todo(); await send(id, 'First'); const r = await runner(); const first = await start(id, r);
    await service.admit(first.credential, submission(commit(first.launch))); await settle(r, first.launch.attempt_id);
    const before = (await db.pool.query('SELECT * FROM todo_requirement_cache WHERE todo_id=$1', [id])).rows[0];
    const withdrawn = await send(id, 'Withdraw this request'); const second = await start(id, r); const later = await send(id, 'Continue from the same understanding');
    await ownerAction(id, 'withdraw_discussion_turn');
    expect(await discussion.status(token, id)).toMatchObject({ resolved_watermark: 3, working_requirement_state: before.content, current_source: { message_id: later.result.message_id, status: 'settling' } });
    expect((await db.pool.query('SELECT * FROM todo_requirement_cache WHERE todo_id=$1', [id])).rows[0]).toEqual({ ...before, resolved_watermark: '3' });
    await settle(r, second.launch.attempt_id); const third = await start(id, r);
    const context = JSON.parse(third.launch.prompt.split('\n\n').at(-1)!);
    expect(context.working_requirement_state).toBe(before.content); expect(context.resolved_watermark).toBe(3);
    expect(context.current_owner_message.message_id).toBe(later.result.message_id);
    expect(context.recent_history).toContainEqual(expect.objectContaining({ content: 'Withdraw this request', disposition: 'withdrawn' }));
    expect((await discussion.messages(token, id)).messages.find((message) => message.message_id === withdrawn.result.message_id)!.disposition).toBe('withdrawn');
  }, 20000);

  it('keeps semantic history cutoff despite later append order, and explicit cache rebuild is nonterminal', async () => {
    const id = await todo(); await send(id, 'First'); const second = await send(id, 'Second'); const r = await runner(); const f = await start(id, r);
    const firstRead: CommandEnvelope = { schema_version: 1, request_id: randomUUID(), scope_id: id, expected_control_version: f.launch.control_version, name: 'read_discussion', payload: {} };
    const page = (await service.admit(f.credential, submission(firstRead))).result!.discussion_page!; expect(page.messages.map((m) => m.content)).toEqual(['First']);
    const rebuild: CommandEnvelope = { ...firstRead, request_id: randomUUID(), name: 'update_working_requirement_state', payload: { working_requirement_state: '', resolved_watermark: 0, project_context_version: f.launch.project_context_version!, project_context_digest: f.launch.project_context_digest! } };
    expect((await service.admit(f.credential, submission(rebuild))).result!.cache_updated).toBe(true);
    await expect(service.admit(f.credential, submission({ ...rebuild, request_id: randomUUID(), payload: { ...rebuild.payload, resolved_watermark: 1 } }))).rejects.toMatchObject(fault('version_conflict'));
    expect((await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    await service.admit(f.credential, submission(commit(f.launch, 'First reply'))); await settle(r, f.launch.attempt_id); const next = await start(id, r); expect(next.launch.source_message_id).toBe(second.result.message_id);
    const nextRead = { ...firstRead, request_id: randomUUID(), expected_control_version: next.launch.control_version };
    const nextPage = (await service.admit(next.credential, submission(nextRead))).result!.discussion_page!;
    expect(nextPage.messages.map((m) => m.content)).toEqual(['First', 'Second', 'First reply']);
    await expect(service.admit(next.credential, submission({ ...nextRead, request_id: randomUUID(), payload: { cursor: page.cursor } }))).rejects.toMatchObject(fault('denied_scope'));
  }, 20000);

  it('retains old Project attribution through move-away/back and Retry, without replacing current cache', async () => {
    const p = await project('Old'); const q = await project('New'); const id = await todo(p.id); await send(id); const r = await runner(); const f = await start(id, r);
    const todos = new Todos(db); let state = await todos.read(token, id);
    await todos.command(token, { schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: state.control_version, payload: { todo_id: id, project_id: q.id } });
    state = await todos.read(token, id); await todos.command(token, { schema_version: 1, request_id: randomUUID(), name: 'assign_todo_project', expected_control_version: state.control_version, payload: { todo_id: id, project_id: p.id } });
    await ownerAction(id, 'stop_discussion_turn'); expect((await discussion.status(token, id)).current_source!.status).toBe('settling');
    await settle(r, f.launch.attempt_id); await ownerAction(id, 'retry_discussion_turn'); const retry = await start(id, r);
    expect(retry.launch.project_context_version).toBe(f.launch.project_context_version); expect(retry.launch.prompt).toBe(f.launch.prompt);
    const command = commit(retry.launch); command.payload.task_preview = { title: 'Explicit proposal', specification: 'Exact proposed work', project_id: p.id };
    const result = await service.admit(retry.credential, submission(command)); expect(result.result!.cache_updated).toBe(false);
    const reply = (await discussion.messages(token, id)).messages.at(-1)!; expect(reply.project_id).toBe(p.id); expect(reply.project_context_version).toBe(0); expect(reply.task_preview).toEqual(command.payload.task_preview);
    expect(await discussion.status(token, id)).not.toHaveProperty('working_requirement_state');
  }, 20000);

  it('does not silently skip a missing outcome; Retry waits for settlement and preserves the exact source', async () => {
    const id = await todo(); const first = await send(id); await send(id, 'Later'); const r = await runner(); const f = await start(id, r);
    await service.event(r.id, r.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'facts', sequence: 1, order_sequence: 1, kind: 'exited', text: '', exit_code: 0 });
    expect((await discussion.status(token, id)).current_source).toMatchObject({ message_id: first.result.message_id, status: 'settling', end_reason: 'missing_formal_outcome' });
    await expect(ownerAction(id, 'retry_discussion_turn')).rejects.toMatchObject(fault('unmet_precondition')); await discussion.pump();
    expect((await db.pool.query('SELECT 1 FROM attempts WHERE todo_id=$1', [id])).rowCount).toBe(1);
    await settle(r, f.launch.attempt_id); expect((await discussion.status(token, id)).current_source!.status).toBe('interrupted');
    const retried = await ownerAction(id, 'retry_discussion_turn'); expect(await discussion.command(token, retried.command)).toEqual(retried.result);
    const next = await start(id, r); expect(next.launch.source_message_id).toBe(first.result.message_id); expect(next.launch.fencing_generation).toBeGreaterThan(f.launch.fencing_generation);
  }, 20000);

  it('resolves commit versus withdrawal exactly once and rejects all new late mutations', async () => {
    const id = await todo(); await send(id); const r = await runner(); const f = await start(id, r); const before = await discussion.status(token, id);
    const withdrawal: DiscussionCommand = { schema_version: 1, request_id: randomUUID(), todo_id: id, name: 'withdraw_discussion_turn', expected_discussion_version: before.discussion_version, payload: { source_message_id: before.current_source!.message_id } };
    const result = await Promise.allSettled([service.admit(f.credential, submission(commit(f.launch))), discussion.command(token, withdrawal)]);
    expect(result.filter((value) => value.status === 'fulfilled')).toHaveLength(1); expect((await db.pool.query('SELECT 1 FROM todo_discussion_resolutions')).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM operations WHERE kind='stop'")).rowCount).toBe(1);
    await expect(service.admit(f.credential, submission(commit(f.launch, 'Late')))).rejects.toMatchObject(fault('stale_execution'));
    const messages = (await discussion.messages(token, id)).messages; expect(messages.length === 2 || messages[0]!.disposition === 'withdrawn').toBe(true);
  }, 20000);

  it('rolls back messages, cache, resolution, Stop and next intent if either command receipt fails', async () => {
    const id = await todo(); const sent = { schema_version: 1, request_id: randomUUID(), todo_id: id, name: 'submit_discussion_message', payload: { message_id: randomUUID(), content: 'Original' } };
    await db.pool.query("CREATE FUNCTION fail_discussion_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END; $$");
    await db.pool.query('CREATE TRIGGER fail_owner_receipt BEFORE INSERT ON discussion_command_receipts FOR EACH ROW EXECUTE FUNCTION fail_discussion_receipt()');
    await expect(discussion.command(token, sent)).rejects.toThrow('injected receipt failure'); expect((await discussion.messages(token, id)).messages).toEqual([]);
    expect((await db.pool.query('SELECT 1 FROM todo_discussion_outbox')).rowCount).toBe(0); await db.pool.query('DROP TRIGGER fail_owner_receipt ON discussion_command_receipts');
    await discussion.command(token, sent); const r = await runner(); const f = await start(id, r); const command = commit(f.launch);
    await db.pool.query('CREATE TRIGGER fail_agent_receipt BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION fail_discussion_receipt()');
    await expect(service.admit(f.credential, submission(command))).rejects.toThrow('injected receipt failure');
    for (const table of ['todo_discussion_resolutions', 'todo_requirement_cache', 'operations']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    expect((await discussion.messages(token, id)).messages).toHaveLength(1); expect((await service.commandStatus(f.credential, command.request_id)).status).toBe('unknown');
    expect((await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [f.launch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    await db.pool.query('DROP TRIGGER fail_agent_receipt ON command_receipts'); expect((await service.admit(f.credential, submission(command))).status).toBe('committed');
  }, 20000);

  it('rejects cross-scope tools and fixture repository inspection, and serves scoped ordered logs/recovery', async () => {
    const id = await todo(); const other = await todo(); await send(id); const r = await runner(); const f = await start(id, r); const reads = new TodoAttemptReads(db);
    for (const [name, payload] of [['commit_task_turn', { reply: 'No', source_watermark: 1, routing: { kind: 'reply_only' } }], ['complete_node', { summary: 'No' }], ['open_workspace', { resource_id: 'repo' }]] as const) await expect(service.admit(f.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: id, expected_control_version: f.launch.control_version, name, payload }))).rejects.toMatchObject(fault('denied_scope'));
    await expect(service.admit(f.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: id, expected_control_version: f.launch.control_version, name: 'inspect_repository', payload: { resource_id: 'repo' } }))).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(service.admit(f.credential, submission({ ...commit(f.launch), scope_id: other }))).rejects.toMatchObject(fault('denied_scope'));
    await service.event(r.id, r.incarnation, { attempt_id: f.launch.attempt_id, dispatch_id: f.launch.dispatch_id, stream_id: 'stdout', sequence: 1, order_sequence: 1, kind: 'output', text: 'provisional', data_base64: Buffer.from('provisional').toString('base64') });
    expect((await discussion.messages(token, id)).messages).toHaveLength(1); expect((await reads.logs(token, id, f.launch.attempt_id)).events).toHaveLength(1);
    await expect(reads.logs(token, other, f.launch.attempt_id)).rejects.toMatchObject(fault('denied_scope'));
    const command = commit(f.launch); const result = await service.admit(f.credential, submission(command));
    expect(await service.recoverCommand(r.id, f.launch.attempt_id, command.request_id)).toEqual(result);
    expect(await reads.operation(token, id, result.operation_id!)).toMatchObject({ kind: 'stop', process_released: false });
    const inventory = await service.inventory(r.id); expect(inventory.dispatches[0]!.todo_id).toBe(id); expect(inventory.operations[0]).not.toHaveProperty('resource_id');
    await expect(db.pool.query('UPDATE attempts SET todo_id=$2 WHERE id=$1', [f.launch.attempt_id, other])).rejects.toMatchObject({ code: '23514' });
  }, 20000);

  it('pages recent Owner history backward and rejects malformed input/authenticated reads', async () => {
    const id = await todo(); const other = await todo();
    await db.pool.query("INSERT INTO todo_discussion_messages(id,todo_id,sequence,author,content) SELECT 'history-'||n,$1,n,'owner','Message '||n FROM generate_series(1,70) n", [id]);
    const first = await discussion.messages(token, id); expect(first.messages[0]!.sequence).toBe(7); expect(first.messages.at(-1)!.sequence).toBe(70); expect(first.has_more).toBe(true);
    const older = await discussion.messages(token, id, first.cursor); expect(older.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(discussion.messages(token, other, first.cursor)).rejects.toMatchObject(fault('denied_scope'));
    for (const value of [' \n\u2003', '\ud800', 'a\0b', 'x'.repeat(65537)]) await expect(send(other, value)).rejects.toThrow();
    const app = createApp(service); const session = await issueOwnerSession(db); const headers = { authorization: `Bearer ${session.token}` };
    try {
      expect((await app.inject({ method: 'GET', url: `/v1/owner/todos/${id}/discussion` })).statusCode).toBe(401);
      const response = await app.inject({ method: 'GET', url: `/v1/owner/todos/${id}/discussion/messages`, headers }); expect(response.statusCode).toBe(200); validate('DiscussionPage', response.json()); expect(response.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'GET', url: `/v1/owner/todos/${id}/discussion/messages?unknown=1`, headers })).statusCode).toBe(409);
      await revokeOwnerSession(db, session.session_id); expect((await app.inject({ method: 'GET', url: `/v1/owner/todos/${id}/discussion`, headers })).statusCode).toBe(401);
    } finally { await app.close(); }
  }, 20000);

  it('retains an attributed reply after Project context edits while rejecting the stale cache basis', async () => {
    const p = await project('Original'); const id = await todo(p.id); await send(id); const r = await runner(); const f = await start(id, r); const config = new Configuration(db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), name: 'save_project', expected_control_version: (await config.read(token)).control_version, payload: { ...p, context: 'Updated Project context' } });
    const current = await discussion.status(token, id); expect(current.project_context_version).toBe(f.launch.project_context_version); expect(current.project_context_digest).not.toBe(f.launch.project_context_digest);
    const result = await service.admit(f.credential, submission(commit(f.launch))); expect(result.result!.cache_updated).toBe(false);
    expect((await discussion.messages(token, id)).messages.at(-1)!.project_id).toBe(p.id); expect((await db.pool.query('SELECT 1 FROM todo_requirement_cache')).rowCount).toBe(0);
  }, 20000);

  it('recovers exactly one semantic outcome across independent process death before and after COMMIT', async () => {
    for (const phase of ['before', 'after'] as const) {
      const id = await todo(); await send(id); const r = await runner(); const f = await start(id, r); const command = commit(f.launch);
      const worker = new Worker(databaseUrl, new URL('./fixtures/admission-worker.ts', import.meta.url)); workers.push(worker);
      await worker.next('ready'); worker.send({ launch: f.launch, command, crash: phase });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([worker.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Admission child did not terminate')), 10000); })]); }
      finally { clearTimeout(timer); }
      expect(worker.messages).toEqual([]); expect(worker.child.signalCode).toBe('SIGKILL');
      const recovered = await service.recoverCommand(r.id, f.launch.attempt_id, command.request_id);
      expect(recovered.status).toBe(phase === 'before' ? 'unknown' : 'committed');
      expect((await db.pool.query('SELECT 1 FROM todo_discussion_resolutions WHERE todo_id=$1', [id])).rowCount).toBe(phase === 'before' ? 0 : 1);
      expect((await discussion.messages(token, id)).messages).toHaveLength(phase === 'before' ? 1 : 2);
      if (phase === 'before') {
        const incarnation = await service.connect(r.id, 'restart'); await service.touch(r.id, incarnation, true);
        const grant = (await service.authorize(r.id, incarnation, f.launch.dispatch_id))!; expect((await service.admit(grant.credential, submission(command))).status).toBe('committed');
      } else {
        expect(await service.admit(f.credential, submission(command))).toEqual(recovered);
        expect((await service.inventory(r.id)).operations.filter((op) => op.kind === 'stop')).toHaveLength(1);
      }
    }
  }, 30000);
});
