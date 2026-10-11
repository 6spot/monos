import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, digest, submission } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, Dispatch, ExecutionPlanNode, OwnerCommand } from '../../../packages/protocol/src/index.ts';
import { TaskPlanning } from '../src/task-planning.ts';
import { BoundaryService } from '../src/service.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { Configuration } from '../src/configuration.ts';
import { initializeTask } from '../src/task-records.ts';
import { issueOwnerSession, OwnerCommands, revokeOwnerSession } from '../src/owner-commands.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { createApp } from '../src/app.ts';

const signingKey = 'initial-planning-test-signing-key';
const fault = (code: string) => ({ detail: { code } });
type Fixture = { task: string; spec: string; project: string; role: string };
type Runner = { id: string; incarnation: number };
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('explicit initial Task planning', () => {
  let db: Database; let admin: Database; let namespace: string; let databaseUrl: string; let token: string;
  let planning: TaskPlanning; let service: BoundaryService; let queue: DispatchQueue;
  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    namespace = `planning_${randomUUID().replaceAll('-', '')}`; admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db); token = (await issueOwnerSession(db)).token;
    service = new BoundaryService(db, { signingKey }); planning = new TaskPlanning(db, service.instanceId); queue = new DispatchQueue(db);
  }, 20000);
  afterEach(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } }, 20000);
  async function task(specification = 'Produce one exact result'): Promise<Fixture> {
    const f = { task: randomUUID(), spec: randomUUID(), project: randomUUID(), role: randomUUID() }; const config = new Configuration(db);
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_role', payload: { id: f.role, name: 'Builder', description: 'ROLE_DESCRIPTOR', instructions: 'ROLE_INSTRUCTION_MUST_NOT_LEAK', archived: false } });
    await config.save(token, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await config.read(token)).control_version, name: 'save_project', payload: { id: f.project, name: 'Project', context: 'PROJECT_CONTEXT', resources: [], role_ids: [f.role], archived: false } });
    await transaction(db, (tx) => initializeTask(tx, { task_id: f.task, specification_id: f.spec, project_id: f.project, specification }));
    return f;
  }
  async function command(f: Fixture, name: OwnerCommand['name'], payload: object) {
    return { schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: (await planning.status(token, f.task)).control_version, name, payload };
  }
  async function start(f: Fixture) { const c = await command(f, 'start_task', { specification_id: f.spec }); return { command: c, result: await new OwnerCommands(db).confirm(token, c) }; }
  async function runner(capacity = 2): Promise<Runner> {
    const id = randomUUID(); await enrollFixture(db, id, randomUUID(), capacity); const incarnation = await service.connect(id, 'planning-test');
    await service.touch(id, incarnation, true, [{ runtime_id: 'opencode', executable: '/owner/opencode', version: '1.18.30', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] }]);
    await db.pool.query('UPDATE execution_policies SET policies=$1', [{ planner: { default_target: { runtime_id: 'opencode', model_id: 'opencode/longcat-2.5-preview-free', runner_id: id }, fallback_targets: [] } }]);
    return { id, incarnation };
  }
  async function launch(f: Fixture, r: Runner) {
    await planning.pump(); const dispatch = await queue.promoteNext(r.id, service.instanceId, r.incarnation); expect(dispatch?.task_id).toBe(f.task);
    const grant = await service.authorize(r.id, r.incarnation, dispatch!.dispatch_id); expect(grant).not.toBeNull(); return { dispatch: dispatch!, credential: grant!.credential };
  }
  function node(f: Fixture): ExecutionPlanNode { return { node_id: randomUUID(), role_id: f.role, goal: 'Deliver exact result', dependencies: [], hard_requirements: ['A verifiable objective 😀'], expected_outputs: [], consumes: [] }; }
  function outcome(d: Dispatch, name: 'publish_execution_plan' | 'raise_planning_issue', payload: object): CommandEnvelope {
    return { schema_version: 1, request_id: randomUUID(), scope_id: d.task_id!, expected_control_version: d.control_version, name, payload: { planning_intent_id: d.task_planning_source!.intent_id, ...payload } };
  }
  async function settle(r: Runner, attemptId: string) {
    const op = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'", [attemptId])).rows[0]; expect(op).toBeDefined();
    await service.finishOperation(r.id, r.incarnation, { attempt_id: attemptId, operation_id: op.id, success: true, result: { writer_absent: true } });
  }
  async function noWorkspace() { for (const table of ['task_workspaces', 'workspace_leases']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0); }

  it('does no work before Start, persists unavailable intent and exact replay, and stops/cancels without a Runtime', async () => {
    const f = await task(); await planning.status(token, f.task); await planning.pump();
    for (const table of ['task_planning_outbox', 'attempts', 'nodes', 'plan_revisions', 'outbox']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    const first = await start(f); await planning.pump();
    expect(await planning.status(token, f.task)).toMatchObject({ state: 'RUNNING', status: 'unavailable', waiting_reason: 'policy_missing' });
    expect((await db.pool.query('SELECT 1 FROM attempts')).rowCount).toBe(0);
    const secondToken = (await issueOwnerSession(db)).token;
    expect(await new TaskPlanning(db).command(secondToken, first.command)).toEqual(first.result);
    await expect(planning.command(token, { ...first.command, payload: { specification_id: 'missing' } })).rejects.toMatchObject(fault('payload_conflict'));
    await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: first.result.planning_intent_id }));
    await new TaskPlanning(db, service.instanceId).pump(); expect((await planning.status(token, f.task)).state).toBe('PLANNING');
    expect(await planning.command(token, first.command)).toEqual(first.result);
    await expect(planning.command(token, { ...first.command, request_id: randomUUID() })).rejects.toMatchObject(fault('version_conflict'));
    await planning.command(token, await command(f, 'cancel_task', { specification_id: f.spec, planning_intent_id: first.result.planning_intent_id }));
    expect((await planning.status(token, f.task)).status).toBe('cancelled'); await noWorkspace();
  });

  it('requires an active Project and currently available selected Role only for Start/restart', async () => {
    const f = await task(); await db.pool.query('UPDATE roles SET archived=true WHERE id=$1', [f.role]);
    await expect(start(f)).rejects.toMatchObject(fault('unmet_precondition'));
    await db.pool.query('UPDATE roles SET archived=false WHERE id=$1', [f.role]); await db.pool.query('UPDATE projects SET archived=true WHERE id=$1', [f.project]);
    await expect(start(f)).rejects.toMatchObject(fault('unmet_precondition')); await db.pool.query('UPDATE projects SET archived=false WHERE id=$1', [f.project]);
    const s = await start(f); await db.pool.query('UPDATE projects SET archived=true WHERE id=$1', [f.project]);
    const retry = await planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
    await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: retry.planning_intent_id }));
    await expect(planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: retry.planning_intent_id }))).rejects.toMatchObject(fault('unmet_precondition'));
    expect((await planning.status(token, f.task)).state).toBe('PLANNING');
  });

  it('publishes one immutable exact Node and committed receipt, retaining Stop ownership and scoped reads', async () => {
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r); const n = node(f); const planId = randomUUID();
    const c = outcome(a.dispatch, 'publish_execution_plan', { plan_id: planId, nodes: [n] });
    const responses = await Promise.all([service.admit(a.credential, submission(c)), service.admit(a.credential, submission(c))]); expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toMatchObject({ status: 'committed', result: { planning_outcome: { kind: 'plan', plan_id: planId } } });
    expect((await db.pool.query('SELECT state,mutation_allowed,process_released FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0]).toEqual({ state: 'SUCCEEDED', mutation_allowed: false, process_released: false });
    expect((await db.pool.query('SELECT state,activation FROM nodes WHERE id=$1', [n.node_id])).rows[0]).toEqual({ state: 'PENDING', activation: '1' });
    expect(await planning.plan(token, f.task, planId)).toMatchObject({ specification_id: f.spec, nodes: [n] });
    await expect(planning.plan(token, (await task()).task, planId)).rejects.toMatchObject(fault('denied_scope'));
    for (const sql of ['UPDATE plan_revisions SET content=content WHERE id=$1', 'DELETE FROM plan_nodes WHERE plan_id=$1']) await expect(db.pool.query(sql, [planId])).rejects.toMatchObject({ code: '23514' });
    await expect(planning.command(token, await command(f, 'cancel_task', { specification_id: f.spec, planning_intent_id: a.dispatch.task_planning_source!.intent_id }))).rejects.toMatchObject(fault('unmet_precondition'));
    await settle(r, a.dispatch.attempt_id); expect(await new BoundaryService(db, { signingKey }).recoverCommand(r.id, a.dispatch.attempt_id, c.request_id)).toEqual(responses[0]);
    expect((await db.pool.query("SELECT 1 FROM task_events WHERE kind='plan_published'")).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM operations WHERE kind='stop'")).rowCount).toBe(1); await noWorkspace();
  });

  it('rejects missing graph dependencies/Artifacts/unknown fields and archived Roles without ending the correctable Attempt', async () => {
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r); const n = node(f);
    for (const [nodes, code] of [
      [[{ ...n, dependencies: ['missing-node'] }], 'invalid_input'],
      [[{ ...n, consumes: ['unavailable-artifact'] }], 'unmet_precondition'],
    ] as const) {
      await expect(service.admit(a.credential, submission(outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes })))).rejects.toMatchObject(fault(code));
    }
    const bad = outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [{ ...n, role_instructions: 'not permitted' }] });
    const json = canonicalJSON(bad); await expect(service.admit(a.credential, { envelope_json: json, sha256: digest(json) })).rejects.toMatchObject(fault('invalid_input'));
    await db.pool.query('UPDATE roles SET archived=true WHERE id=$1', [f.role]);
    await expect(service.admit(a.credential, submission(outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [n] })))).rejects.toMatchObject(fault('unmet_precondition'));
    expect((await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    await db.pool.query('UPDATE roles SET archived=false WHERE id=$1', [f.role]);
    expect((await service.admit(a.credential, submission(outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [n] })))).status).toBe('committed');
  });

  it('reports global Plan/Node ID collisions as correctable conflicts in the same Attempt', async () => {
    const first = await task(); const r = await runner(); await start(first); const original = await launch(first, r); const originalNode = node(first); const planId = randomUUID();
    await service.admit(original.credential, submission(outcome(original.dispatch, 'publish_execution_plan', { plan_id: planId, nodes: [originalNode] })));
    await settle(r, original.dispatch.attempt_id);
    const next = await task(); await start(next); const a = await launch(next, r);
    for (const payload of [{ plan_id: planId, nodes: [node(next)] }, { plan_id: randomUUID(), nodes: [{ ...node(next), node_id: originalNode.node_id }] }]) {
      await expect(service.admit(a.credential, submission(outcome(a.dispatch, 'publish_execution_plan', payload)))).rejects.toMatchObject(fault('payload_conflict'));
      expect((await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
      expect((await db.pool.query('SELECT 1 FROM plan_revisions WHERE task_id=$1', [next.task])).rowCount).toBe(0);
    }
    expect((await service.admit(a.credential, submission(outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [node(next)] })))).status).toBe('committed');
  });

  it('retains multiple exact issue answers in fresh context and queues Retry without overlapping physical cleanup', async () => {
    const f = await task(); const r = await runner(2); await start(f); let a = await launch(f, r);
    for (const [reason, answer] of [['FIRST_ISSUE', 'FIRST_ANSWER'], ['SECOND_ISSUE', 'SECOND_ANSWER']]) {
      const result = await service.admit(a.credential, submission(outcome(a.dispatch, 'raise_planning_issue', { reason })));
      const sequence = result.result!.planning_outcome!.issue_sequence!;
      const current = await planning.status(token, f.task); expect(current).toMatchObject({ state: 'RUNNING', status: 'issue', issue: { issue_sequence: sequence, reason } });
      await expect(planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: current.planning_source!.intent_id }))).rejects.toMatchObject(fault('unmet_precondition'));
      await expect(planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: current.planning_source!.intent_id, issue_sequence: sequence + 1, answer }))).rejects.toMatchObject(fault('version_conflict'));
      const retry = await command(f, 'retry_initial_planning', { planning_intent_id: current.planning_source!.intent_id, issue_sequence: sequence, answer });
      const retryResult = await planning.command(token, retry); expect(await planning.command(token, retry)).toEqual(retryResult);
      await planning.pump(); expect((await planning.status(token, f.task)).status).toBe('settling'); expect(await queue.promoteNext(r.id, service.instanceId, r.incarnation)).toBeNull();
      await expect(service.admit(a.credential, submission({ ...outcome(a.dispatch, 'raise_planning_issue', { reason: 'late' }), expected_control_version: retryResult.control_version! }))).rejects.toMatchObject(fault('stale_execution'));
      await settle(r, a.dispatch.attempt_id); a = await launch(f, r); expect(a.dispatch.prompt).toContain(answer!);
    }
    expect(a.dispatch.prompt).toContain('FIRST_ANSWER'); expect(a.dispatch.prompt).toContain('SECOND_ANSWER');
    expect(a.dispatch.prompt).not.toContain('ROLE_INSTRUCTION_MUST_NOT_LEAK');
    await service.admit(a.credential, submission(outcome(a.dispatch, 'raise_planning_issue', { reason: 'THIRD_ISSUE' })));
    const current = await planning.status(token, f.task);
    await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: current.planning_source!.intent_id, issue_sequence: current.issue!.issue_sequence }));
    expect(await planning.status(token, f.task)).toMatchObject({ state: 'PLANNING', status: 'stopped' });
    await planning.pump(); expect((await db.pool.query("SELECT count(*) FROM attempts WHERE state='SUCCEEDED'")).rows[0].count).toBe('3'); await noWorkspace();
  });

  it.each(['pending', 'queued', 'running'] as const)('Stop at %s revokes selection and late output without model capacity or connectivity', async (stage) => {
    const f = await task(); const s = await start(f); let r: Runner | undefined; let a: Awaited<ReturnType<typeof launch>> | undefined;
    if (stage !== 'pending') { r = await runner(); await planning.pump(); }
    if (stage === 'running') a = await launch(f, r!);
    if (r) await service.disconnect(r.id, r.incarnation);
    const result = await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
    expect(result.status).toBe('committed'); expect((await planning.status(token, f.task)).state).toBe('PLANNING');
    await planning.pump(); expect((await db.pool.query('SELECT 1 FROM task_planning_outbox WHERE NOT done')).rowCount).toBe(0);
    if (a) {
      expect((await db.pool.query('SELECT process_released FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].process_released).toBe(false);
      await expect(planning.command(token, await command(f, 'retry_initial_planning', { attempt_id: a.dispatch.attempt_id }))).rejects.toMatchObject(fault('unmet_precondition'));
      await planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
    }
    await noWorkspace();
  });

  it.each(['never_started', 'running', 'issue'] as const)('Cancel at %s is a pre-Plan terminal exit and keeps physical cleanup', async (stage) => {
    const f = await task(); let source: string | undefined; let a: Awaited<ReturnType<typeof launch>> | undefined;
    if (stage !== 'never_started') { const r = await runner(); source = (await start(f)).result.planning_intent_id!; a = await launch(f, r); }
    if (stage === 'issue') await service.admit(a!.credential, submission(outcome(a!.dispatch, 'raise_planning_issue', { reason: 'Need direction' })));
    const c = await command(f, 'cancel_task', { specification_id: f.spec, ...(source ? { planning_intent_id: source } : {}) });
    const result = await planning.command(token, c); expect(await planning.command(token, c)).toEqual(result);
    expect(await planning.status(token, f.task)).toMatchObject({ state: 'CANCELLED', available_actions: [], status: 'cancelled' });
    await planning.pump(); await expect(start(f)).rejects.toMatchObject(fault('unmet_precondition'));
    if (a) expect((await db.pool.query('SELECT process_released,mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0]).toEqual({ process_released: false, mutation_allowed: false });
  });

  it('freezes context/digest, excludes other Task/Todo content, and only explicit Retry refreshes a failed budget source', async () => {
    const f = await task(); await task('SIBLING_TASK_SECRET'); await db.pool.query('UPDATE execution_policies SET planner_guidance=$1', ['OWNER_GUIDANCE']);
    const todoId = randomUUID(); await db.pool.query('INSERT INTO todos(id,original_capture,project_id) VALUES($1,$2,$3)', [todoId, 'TODO_CAPTURE_SECRET', f.project]);
    await db.pool.query("INSERT INTO todo_discussion_messages(id,todo_id,sequence,author,content) VALUES($1,$2,1,'owner','TODO_MESSAGE_SECRET')", [randomUUID(), todoId]);
    await db.pool.query("INSERT INTO todo_requirement_cache(todo_id,content,resolved_watermark,project_context_version,project_context_digest) VALUES($1,'TODO_CACHE_SECRET',0,0,$2)", [todoId, 'a'.repeat(64)]);
    const s = await start(f); const frozen = (await db.pool.query('SELECT * FROM task_planning_outbox WHERE id=$1', [s.result.planning_intent_id])).rows[0];
    expect(frozen.prompt).toContain('--input payload.json'); expect(frozen.prompt).toContain('monos command-status'); expect(frozen.prompt).not.toContain('--payload');
    expect(frozen.prompt).toContain('OWNER_GUIDANCE'); expect(frozen.prompt).toContain('ROLE_DESCRIPTOR'); expect(frozen.prompt).toContain('PROJECT_CONTEXT');
    for (const secret of ['SIBLING_TASK_SECRET', 'TODO_CAPTURE_SECRET', 'TODO_MESSAGE_SECRET', 'TODO_CACHE_SECRET']) expect(frozen.prompt).not.toContain(secret); expect(frozen.prompt).not.toContain('ROLE_INSTRUCTION_MUST_NOT_LEAK'); expect(frozen.context_digest).toBe(digest(canonicalJSON(frozen.context)));
    await db.pool.query("UPDATE projects SET context='CURRENT_PROJECT' WHERE id=$1", [f.project]); await runner(); await planning.pump();
    expect((await db.pool.query('SELECT launch FROM attempts WHERE planning_intent_id=$1', [s.result.planning_intent_id])).rows[0].launch.prompt).toBe(frozen.prompt);
    await expect(db.pool.query('UPDATE task_planning_outbox SET prompt=$2 WHERE id=$1', [frozen.id, 'changed'])).rejects.toMatchObject({ code: '23514' });
    const huge = await task('x'.repeat(210000)); await db.pool.query('UPDATE projects SET context=$2 WHERE id=$1', [huge.project, 'y'.repeat(60000)]); const h = await start(huge);
    expect(await planning.status(token, huge.task)).toMatchObject({ status: 'unavailable', waiting_reason: 'context_budget_exceeded' });
    await db.pool.query("UPDATE projects SET context='' WHERE id=$1", [huge.project]); await new TaskPlanning(db, service.instanceId).pump();
    expect((await db.pool.query('SELECT prompt,preparation_failure FROM task_planning_outbox WHERE id=$1', [h.result.planning_intent_id])).rows[0]).toEqual({ prompt: null, preparation_failure: 'context_budget_exceeded' });
    expect((await db.pool.query('SELECT 1 FROM attempts WHERE task_id=$1', [huge.task])).rowCount).toBe(0);
    const retry = await planning.command(token, await command(huge, 'retry_initial_planning', { planning_intent_id: h.result.planning_intent_id })); expect(retry.planning_intent_id).not.toBe(h.result.planning_intent_id);
    await planning.pump(); expect((await db.pool.query('SELECT 1 FROM attempts WHERE task_id=$1', [huge.task])).rowCount).toBe(1);
  });

  it('rejects wrong source/basis/generic phase command, and missing-outcome process loss is explicit retry attention', async () => {
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r);
    await expect(service.admit(a.credential, submission(outcome(a.dispatch, 'raise_planning_issue', { planning_intent_id: 'wrong', reason: 'bad source' })))).rejects.toMatchObject(fault('stale_execution'));
    await expect(service.admit(a.credential, submission({ ...outcome(a.dispatch, 'raise_planning_issue', { reason: 'bad version' }), expected_control_version: 1 }))).rejects.toMatchObject(fault('version_conflict'));
    await expect(service.admit(a.credential, submission({ schema_version: 1, request_id: randomUUID(), scope_id: f.task, expected_control_version: a.dispatch.control_version, name: 'commit_task_turn', payload: { reply: 'wrong phase', source_watermark: 0, routing: { kind: 'reply_only' } } }))).rejects.toMatchObject(fault('denied_scope'));
    await service.event(r.id, r.incarnation, { attempt_id: a.dispatch.attempt_id, dispatch_id: a.dispatch.dispatch_id, stream_id: 'runtime', sequence: 1, order_sequence: 1, kind: 'exited', text: '', exit_code: 1 });
    expect((await planning.status(token, f.task)).status).toBe('settling'); await settle(r, a.dispatch.attempt_id);
    expect(await planning.status(token, f.task)).toMatchObject({ state: 'RUNNING', status: 'interrupted', end_reason: 'missing_formal_outcome' });
    await new TaskPlanning(db, service.instanceId).pump(); expect((await db.pool.query('SELECT 1 FROM attempts')).rowCount).toBe(1);
    await new OwnerCommands(db).confirm(token, await command(f, 'retry_initial_planning', { attempt_id: a.dispatch.attempt_id }));
    expect((await launch(f, r)).dispatch.attempt_id).not.toBe(a.dispatch.attempt_id);
  });

  it('rolls back every phase effect on receipt failure and recovers the exact commit after restart', async () => {
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r);
    const c = outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [node(f)] });
    const crashing = new BoundaryService(db, { signingKey, beforeAdmissionCommit: () => { throw new Error('injected before commit'); } });
    Object.defineProperty(crashing, 'instanceId', { value: service.instanceId });
    await expect(crashing.admit(a.credential, submission(c))).rejects.toThrow('injected before commit');
    for (const table of ['plan_revisions', 'nodes', 'operations', 'command_receipts']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    expect((await db.pool.query('SELECT mutation_allowed FROM attempts WHERE id=$1', [a.dispatch.attempt_id])).rows[0].mutation_allowed).toBe(true);
    const committed = await service.admit(a.credential, submission(c));
    expect(await new BoundaryService(db, { signingKey }).recoverCommand(r.id, a.dispatch.attempt_id, c.request_id)).toEqual(committed);
  });

  async function contend<A, B>(relation: string, values: string[], sql: string, first: (peer: Database) => Promise<A>, second: (peer: Database) => Promise<B>, secondQuery?: string) {
    const peers = [database(databaseUrl), database(databaseUrl)]; const barrier = await db.pool.connect(); const pending: Promise<unknown>[] = [];
    const settled = <T>(promise: Promise<T>) => promise.then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
    const wait = async (pid: number, blocker: number, query = `FROM ${relation}`) => expect.poll(async () => {
      const row = (await admin.pool.query<{ wait_event_type: string; query: string; blockers: number[] }>('SELECT wait_event_type,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
      return row?.wait_event_type === 'Lock' && row.query.includes(query) && row.blockers.includes(blocker);
    }, { timeout: 5000 }).toBe(true);
    try {
      const pids = await Promise.all(peers.map(async (peer) => Number((await peer.pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid))); const bp = Number((await barrier.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      expect(new Set([...pids, bp]).size).toBe(3); await barrier.query('BEGIN'); await barrier.query(sql, values);
      const a = settled(first(peers[0]!)); pending.push(a); await wait(pids[0]!, bp);
      const b = settled(second(peers[1]!)); pending.push(b); await wait(pids[1]!, pids[0]!, secondQuery);
      await barrier.query('COMMIT'); return await Promise.all([a, b]);
    } finally { await barrier.query('ROLLBACK'); barrier.release(); await Promise.allSettled(pending); await Promise.all(peers.map((peer) => peer.pool.end())); }
  }

  it('serializes distinct Start requests on observed independent Task locks with one durable source', async () => {
    const f = await task(); const c = await command(f, 'start_task', { specification_id: f.spec });
    const results = await contend('tasks', [f.task], 'SELECT id FROM tasks WHERE id=$1 FOR UPDATE',
      (peer) => new TaskPlanning(peer).command(token, c), (peer) => new TaskPlanning(peer).command(token, { ...c, request_id: randomUUID() }));
    expect(results[0].status).toBe('fulfilled'); expect(results[1]).toMatchObject({ status: 'rejected', reason: fault('version_conflict') });
    expect((await db.pool.query('SELECT 1 FROM task_planning_outbox')).rowCount).toBe(1); expect((await db.pool.query("SELECT 1 FROM task_events WHERE kind='task_started'")).rowCount).toBe(1);
  });

  it.each(['plan/stop/outcome', 'plan/stop/owner', 'plan/cancel/outcome', 'plan/cancel/owner', 'issue/stop/outcome', 'issue/stop/owner', 'issue/cancel/outcome', 'issue/cancel/owner'])('serializes %s at the observed Runner lock', async (scenario) => {
    const [phase, control, first] = scenario.split('/');
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r); const c = outcome(a.dispatch, phase === 'plan' ? 'publish_execution_plan' : 'raise_planning_issue', phase === 'plan' ? { plan_id: randomUUID(), nodes: [node(f)] } : { reason: 'Exact issue' });
    const stop = await command(f, control === 'stop' ? 'stop_initial_planning' : 'cancel_task', { planning_intent_id: a.dispatch.task_planning_source!.intent_id, ...(control === 'cancel' ? { specification_id: f.spec } : {}) });
    const actions = { outcome: (peer: Database) => { const svc = new BoundaryService(peer, { signingKey }); Object.defineProperty(svc, 'instanceId', { value: service.instanceId }); return svc.admit(a.credential, submission(c)); }, owner: (peer: Database) => new TaskPlanning(peer).command(token, stop) };
    const results = await contend('runners', [r.id], 'SELECT id FROM runners WHERE id=$1 FOR UPDATE', actions[first as 'outcome' | 'owner'], actions[first === 'owner' ? 'outcome' : 'owner']);
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
    expect((await db.pool.query('SELECT 1 FROM plan_revisions')).rowCount).toBe(first === 'outcome' && phase === 'plan' ? 1 : 0);
    expect((await db.pool.query("SELECT 1 FROM operations WHERE kind='stop'")).rowCount).toBe(1);
  });

  it('replays one same-request Start under observed independent locks', async () => {
    const f = await task(); const c = await command(f, 'start_task', { specification_id: f.spec });
    const results = await contend('tasks', [f.task], 'SELECT id FROM tasks WHERE id=$1 FOR UPDATE',
      (peer) => new TaskPlanning(peer).command(token, c), (peer) => new TaskPlanning(peer).command(token, c), 'pg_advisory_xact_lock');
    expect(results[0]).toEqual(results[1]); expect(results[0].status).toBe('fulfilled');
    expect((await db.pool.query('SELECT 1 FROM task_planning_outbox')).rowCount).toBe(1);
  });

  it.each(['plan', 'issue'] as const)('serializes competing formal phases with %s first', async (phase) => {
    const f = await task(); const r = await runner(); await start(f); const a = await launch(f, r);
    const plan = outcome(a.dispatch, 'publish_execution_plan', { plan_id: randomUUID(), nodes: [node(f)] }); const issue = outcome(a.dispatch, 'raise_planning_issue', { reason: 'Need exact direction' });
    const run = (c: CommandEnvelope) => (peer: Database) => { const svc = new BoundaryService(peer, { signingKey }); Object.defineProperty(svc, 'instanceId', { value: service.instanceId }); return svc.admit(a.credential, submission(c)); };
    const results = await contend('runners', [r.id], 'SELECT id FROM runners WHERE id=$1 FOR UPDATE', run(phase === 'plan' ? plan : issue), run(phase === 'plan' ? issue : plan));
    expect(results[0].status).toBe('fulfilled'); expect(results[1]).toMatchObject({ status: 'rejected', reason: fault('stale_execution') });
    expect((await db.pool.query("SELECT 1 FROM task_events WHERE kind IN ('plan_published','planning_issue_raised')")).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM operations WHERE kind='stop'")).rowCount).toBe(1);
  });

  it('restarts before/after selection with one Attempt and Start and rejects stale source even with a forged matching version', async () => {
    const f = await task(); const s = await start(f); const r = await runner();
    await Promise.all([new TaskPlanning(db, service.instanceId).pump(), new TaskPlanning(db, service.instanceId).pump()]);
    const queued = (await db.pool.query<{ id: string; launch: Dispatch }>('SELECT id,launch FROM attempts WHERE task_id=$1', [f.task])).rows;
    expect(queued).toHaveLength(1); await new TaskPlanning(db, service.instanceId).pump();
    await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
    const next = await planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
    // Model a retained stale queue candidate with equal numeric control basis.
    // Source identity must still fence it; a number is not source authorization.
    await db.pool.query("UPDATE attempts SET state='QUEUED' WHERE id=$1", [queued[0]!.id]);
    await db.pool.query('UPDATE tasks SET control_version=$2 WHERE id=$1', [f.task, queued[0]!.launch.control_version]);
    expect(await queue.promoteNext(r.id, service.instanceId, r.incarnation)).toBeNull();
    expect((await db.pool.query('SELECT end_reason FROM attempts WHERE id=$1', [queued[0]!.id])).rows[0].end_reason).toBe('stale_queue_basis');
    await db.pool.query('UPDATE tasks SET control_version=$2 WHERE id=$1', [f.task, next.control_version]);
    await new TaskPlanning(db, service.instanceId).pump();
    const requests = (await db.pool.query('SELECT id,prompt,expected_version,specification_id,planned_attempt_id,context_digest FROM task_planning_outbox WHERE id=$1', [next.planning_intent_id])).rows[0];
    const scheduler = new RuntimeScheduling(queue, service.instanceId);
    const request = { attempt_id: requests.planned_attempt_id, task_id: f.task, kind: 'planner' as const, expected: { control_version: Number(requests.expected_version), specification_id: f.spec, plan_id: null }, prompt: requests.prompt, source_watermark: 0, task_planning_source: { intent_id: requests.id, specification_id: f.spec, context_digest: requests.context_digest } };
    const replay = await transaction(db, (tx) => scheduler.selectAndEnqueue(tx, request)); expect(replay.status).toBe('queued');
    const d = await queue.promoteNext(r.id, service.instanceId, r.incarnation); expect(d?.task_planning_source!.intent_id).toBe(next.planning_intent_id);
    await new TaskPlanning(db, service.instanceId).pump(); expect((await db.pool.query("SELECT 1 FROM outbox WHERE kind='start'")).rowCount).toBe(1);
    await expect(db.pool.query('UPDATE attempts SET planning_intent_id=$2 WHERE id=$1', [d!.attempt_id, s.result.planning_intent_id])).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a stale pump snapshot after scheduler receipt replay without rewriting the superseded source', async () => {
    const f = await task(); const s = await start(f); await runner(); const peer = database(databaseUrl);
    let captured!: () => void; let release!: () => void;
    const read = new Promise<void>((resolve) => { captured = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalQuery = peer.pool.query.bind(peer.pool);
    // Hold only the read snapshot, not a DB lock, so another real scheduler and
    // Owner can commit while this pump still holds its earlier candidate bytes.
    const spy = vi.spyOn(peer.pool, 'query').mockImplementationOnce((async (sql: string, values: unknown[]) => {
      const rows = await originalQuery(sql, values); captured(); await gate; return rows;
    }) as typeof peer.pool.query);
    const pending = new TaskPlanning(peer, service.instanceId).pump();
    try {
      await read; await planning.pump();
      await planning.command(token, await command(f, 'stop_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
      const next = await planning.command(token, await command(f, 'retry_initial_planning', { planning_intent_id: s.result.planning_intent_id }));
      await db.pool.query('CREATE TABLE superseded_source_writes(id text)');
      await db.pool.query("CREATE FUNCTION observe_superseded_source_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND initial_planning_intent_id=NEW.id) THEN INSERT INTO superseded_source_writes VALUES(NEW.id); END IF; RETURN NEW; END; $$");
      await db.pool.query('CREATE TRIGGER observe_superseded_source_write AFTER UPDATE ON task_planning_outbox FOR EACH ROW EXECUTE FUNCTION observe_superseded_source_write()');
      release(); await pending;
      expect((await db.pool.query('SELECT 1 FROM superseded_source_writes')).rowCount).toBe(0);
      expect((await planning.status(token, f.task)).planning_source!.intent_id).toBe(next.planning_intent_id);
      expect((await db.pool.query('SELECT 1 FROM attempts')).rowCount).toBe(1);
      await planning.pump(); expect((await db.pool.query('SELECT 1 FROM attempts')).rowCount).toBe(2);
    } finally { release(); await pending; spy.mockRestore(); await peer.pool.end(); }
  });

  it('rolls back Start/source/event when its durable Owner receipt cannot commit', async () => {
    const f = await task(); const c = await command(f, 'start_task', { specification_id: f.spec });
    await db.pool.query("CREATE FUNCTION fail_planning_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END; $$");
    await db.pool.query('CREATE TRIGGER fail_planning_receipt BEFORE INSERT ON owner_command_receipts FOR EACH ROW EXECUTE FUNCTION fail_planning_receipt()');
    await expect(planning.command(token, c)).rejects.toThrow('injected receipt failure');
    expect((await planning.status(token, f.task)).status).toBe('not_started');
    for (const table of ['task_planning_outbox', 'task_events', 'owner_command_receipts']) expect((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
    await db.pool.query('DROP TRIGGER fail_planning_receipt ON owner_command_receipts'); expect((await planning.command(token, c)).status).toBe('committed');
  });

  it('authenticates scoped HTTP reads and keeps never-started cancellation independent of configuration', async () => {
    const f = await task(); const app = createApp(service);
    try {
      const url = `/v1/owner/tasks/${f.task}/planning`;
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { authorization: `Bearer ${token}` } })).json()).toMatchObject({ status: 'not_started' });
      await db.pool.query('UPDATE projects SET archived=true WHERE id=$1', [f.project]);
      expect((await app.inject({ url: '/v1/owner/commands', method: 'POST', headers: { authorization: `Bearer ${token}` }, payload: await command(f, 'cancel_task', { specification_id: f.spec }) })).statusCode).toBe(200);
      const session = await issueOwnerSession(db); await revokeOwnerSession(db, session.session_id);
      expect((await app.inject({ url, headers: { authorization: `Bearer ${session.token}` } })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('upgrades version 16 without inventing source bindings or changing retained receipts', async () => {
    const oldNamespace = `${namespace}_old`; await admin.pool.query(`CREATE SCHEMA ${oldNamespace}`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${oldNamespace}`); const old = database(url.toString());
    try {
      await old.pool.query('CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
      const { readdir } = await import('node:fs/promises'); const root = new URL('../../../packages/db/migrations/', import.meta.url);
      const files = (await readdir(root)).filter((name) => name.endsWith('.sql') && Number(name.slice(0, 4)) <= 16).sort();
      for (const [i, file] of files.entries()) { const sql = await readFile(new URL(file, root), 'utf8'); await transaction(old, async (tx) => { await tx.query(sql); await tx.query('INSERT INTO schema_migrations VALUES($1,$2)', [i + 1, digest(sql)]); }); }
      const id = randomUUID(); await transaction(old, (tx) => initializeTask(tx, { task_id: id, specification_id: randomUUID(), specification: 'Historical Task' }));
      const result = { schema_version: 1, request_id: 'old-request', status: 'unknown' };
      await old.pool.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [id, 'old-request', digest('{}'), '{}', result]);
      await migrate(old); expect((await old.pool.query('SELECT initial_planning_intent_id,planning_issue_sequence FROM tasks WHERE id=$1', [id])).rows[0]).toEqual({ initial_planning_intent_id: null, planning_issue_sequence: null });
      expect((await old.pool.query('SELECT response FROM owner_command_receipts WHERE scope_id=$1', [id])).rows[0].response).toEqual(result);
      expect((await old.pool.query('SELECT 1 FROM task_planning_outbox')).rowCount).toBe(0); await migrate(old);
    } finally { await old.pool.end(); await admin.pool.query(`DROP SCHEMA ${oldNamespace} CASCADE`); }
  }, 30000);
});
