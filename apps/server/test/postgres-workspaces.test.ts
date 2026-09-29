import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { canonicalJSON, digest, submission, workspaceId } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, EffectResult, Operation, ProjectConfiguration } from '../../../packages/protocol/src/index.ts';
import { BoundaryService } from '../src/service.ts';
import { Configuration } from '../src/configuration.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { issueOwnerSession } from '../src/owner-commands.ts';
import { executeOwnerAction, ownerOperationStatus } from '../src/owner-execution.ts';
import { initializeTask } from '../src/task-records.ts';
import { GitHub } from '../src/github.ts';
import { createApp } from '../src/app.ts';

const key = 'synthetic-workspace-service-signing-key';
const oid = 'a'.repeat(40), target = 'b'.repeat(40);
const fault = (code: string) => ({ detail: { code } });

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('canonical serial Task workspaces', () => {
  let db: Database, admin: Database, owner: string, configuration: Configuration, databaseUrl: string;
  const namespace = 'workspaces_' + randomUUID().replaceAll('-', '');
  beforeAll(async () => {
    admin = database(process.env.DATABASE_URL!); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=15000`);
    databaseUrl = url.toString(); db = database(databaseUrl); await migrate(db); owner = (await issueOwnerSession(db)).token; configuration = new Configuration(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function save(project: ProjectConfiguration) {
    return configuration.save(owner, { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(owner)).control_version, name: 'save_project', payload: project });
  }
  async function fixture(github?: GitHub) {
    const project: ProjectConfiguration = { id: randomUUID(), name: 'Workspace', context: '', archived: false, role_ids: [], resources: [
      { id: randomUUID(), remote_url: 'https://github.com/example/repo.git', remote_preparation: 'after_acceptance', default_branch: 'main' },
      { id: randomUUID(), remote_url: 'https://github.com/example/other.git', remote_preparation: 'after_acceptance' },
    ] };
    await save(project);
    const runner = randomUUID(), task = randomUUID(), node = randomUUID(), plan = randomUUID();
    const enrollment = randomUUID(); await enrollFixture(db, runner, enrollment, 4);
    const service = new BoundaryService(db, { signingKey: key, github });
    const incarnation = await service.connect(runner, 'boot'); await service.touch(runner, incarnation, true);
    let expected = await transaction(db, (tx) => initializeTask(tx, { task_id: task, specification_id: randomUUID(), specification: '# Test', project_id: project.id }));
    await transaction(db, async (tx) => {
      await tx.query('INSERT INTO plan_revisions(id,task_id,specification_id,content) VALUES($1,$2,$3,$4)', [plan, task, expected.specification_id, { node_ids: [node] }]);
      await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node, task]);
      await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [task, plan, node, { node_id: node, dependencies: [] }]);
      await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')", [task, node, expected.specification_id, plan]);
      await tx.query("UPDATE tasks SET state='RUNNING',plan_id=$2 WHERE id=$1", [task, plan]);
    });
    expected = { ...expected, plan_id: plan };
    const queue = new DispatchQueue(db);
    async function start() {
      const attempt = randomUUID();
      const version = Number((await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [task])).rows[0].control_version);
      await transaction(db, (tx) => queue.enqueue(tx, { attempt_id: attempt, runner_id: runner, task_id: task, node_id: node,
        kind: 'node', expected: { ...expected, control_version: version }, runtime_id: 'opencode', model: 'opencode/longcat-2.5-preview-free', prompt: 'synthetic canonical workspace', source_watermark: 0 }));
      const launch = (await queue.promoteNext(runner, service.instanceId, incarnation))!;
      const token = (await service.authorize(runner, incarnation, launch.dispatch_id))!.credential;
      return { attempt, launch, token, version };
    }
    const execution = await start();
    return { project, resource: project.resources[0]!.id, runner, enrollment, task, node, service, incarnation, start, ...execution };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function open(f: Fixture, request: string = randomUUID(), resource = f.resource) {
    const command: CommandEnvelope = { schema_version: 1, request_id: request, scope_id: f.task, name: 'open_workspace', expected_control_version: f.version, payload: { resource_id: resource } };
    return { response: await f.service.admit(f.token, submission(command)), command };
  }
  async function operation(f: Fixture, id: string) { return f.service.recoverOperation(f.runner, id); }
  function opened(op: Operation): EffectResult {
    const ws = op.workspace!;
    return { workspace_id: ws.workspace_id, path: '/runner/tasks/' + ws.workspace_id + '/worktree', instruction_files: [], workspace_metadata: {
      generation: ws.generation, storage_id: ws.basis?.storage_id ?? 'storage', lease_id: ws.lease_id, repository_identity: ws.resource.repository_identity,
      provider_metadata: { github: { repository_id: '42' } }, base_commit: ws.basis?.base_commit ?? oid,
      target_branch: ws.basis?.target_branch ?? 'main', target_commit: target, finalized_commit: ws.basis?.finalized_commit ?? oid,
    } };
  }
  async function finish(f: Fixture, op: Operation, result = opened(op)) {
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: op.operation_id, attempt_id: f.attempt, success: true, result });
  }
  async function stop(f: Fixture) {
    const version = Number((await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [f.task])).rows[0].control_version);
    const result = await executeOwnerAction(db, owner, { schema_version: 1, request_id: randomUUID(), scope_id: f.task, name: 'stop_node', expected_control_version: version, payload: { attempt_id: f.attempt, node_id: f.node, node_activation: 1 } });
    return operation(f, result.operation_id!);
  }

  function peerFixture(f: Fixture, peer: Database): Fixture {
    const service = new BoundaryService(peer, f.service.options);
    // Separate connections to the same backend process, not a backend restart.
    Object.defineProperty(service, 'instanceId', { value: f.service.instanceId });
    return { ...f, service };
  }

  async function contend<A, B>(lock: { sql: string; values: string[]; relation: string; ordered?: boolean },
    first: (peer: Database) => Promise<A>, second: (peer: Database) => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
    const peers = [database(databaseUrl), database(databaseUrl)] as const;
    const barrier = await db.pool.connect(), pending: Promise<unknown>[] = [];
    const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> => promise.then(
      (value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason }));
    async function waitForLock(pid: number, blockingPid: number) {
      await expect.poll(async () => {
        const row = (await admin.pool.query<{ wait_event_type: string; query: string; blockers: number[] }>(
          'SELECT wait_event_type,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        return row?.wait_event_type === 'Lock' && row.query.includes(`FROM ${lock.relation}`) && row.blockers.includes(blockingPid);
      }, { timeout: 5000 }).toBe(true);
    }
    try {
      // Each pool has one prewarmed idle connection and exactly one in-flight command.
      const pids = await Promise.all(peers.map(async (peer) => Number((await peer.pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid)));
      const barrierPid = Number((await barrier.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      expect(new Set([barrierPid, ...pids]).size).toBe(3);
      await barrier.query('BEGIN'); await barrier.query(lock.sql, lock.values);
      const a = settle(first(peers[0])); pending.push(a);
      await waitForLock(pids[0]!, barrierPid);
      const b = settle(second(peers[1])); pending.push(b);
      // Conflicting commands must queue in order; compatible readers both wait on the barrier.
      await waitForLock(pids[1]!, lock.ordered === false ? barrierPid : pids[0]!);
      expect((await admin.pool.query("SELECT pid FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rowCount).toBe(2);
      await barrier.query('COMMIT');
      return await Promise.all([a, b]);
    } finally {
      await barrier.query('ROLLBACK'); barrier.release();
      await Promise.allSettled(pending); await Promise.all(peers.map((peer) => peer.pool.end()));
    }
  }

  it('reserves canonical paths without fixture/materialization and serializes different open requests', async () => {
    const f = await fixture();
    expect(f.launch.resource_id).toBeUndefined(); expect(f.launch.workspace_reservations?.resources).toHaveLength(2);
    expect((await db.pool.query('SELECT resource_id FROM tasks WHERE id=$1', [f.task])).rows[0].resource_id).toBeNull();
    expect((await db.pool.query('SELECT 1 FROM task_workspaces WHERE task_id=$1', [f.task])).rowCount).toBe(0);
    const requests = [randomUUID(), randomUUID()];
    const results = await contend({ sql: 'SELECT version FROM configuration_control FOR UPDATE', values: [], relation: 'configuration_control', ordered: false },
      (peer) => open(peerFixture(f, peer), requests[0]), (peer) => open(peerFixture(f, peer), requests[1]));
    for (const [index, result] of results.entries()) expect(result).toMatchObject({ status: 'fulfilled', value: { response: { status: 'admitted', request_id: requests[index] } } });
    if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') throw new Error('Contended workspace admissions failed');
    expect(results[0].value.response.operation_id).toBe(results[1].value.response.operation_id);
    const op = await operation(f, results[0].value.response.operation_id!);
    expect((await db.pool.query('SELECT request_id FROM command_receipts WHERE attempt_id=$1 ORDER BY request_id', [f.attempt])).rows.map((row) => row.request_id)).toEqual([...requests].sort());
    expect((await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='open_workspace'", [f.attempt])).rowCount).toBe(1);
    expect(op.workspace?.workspace_id).toBe(workspaceId(f.task, f.resource));
    expect(op.workspace_digest).toBe(digest(canonicalJSON(op.workspace)));
    expect(op.workspace?.basis).toBeUndefined(); await finish(f, op);
    expect((await open(f)).response).toMatchObject({ status: 'committed', operation_id: op.operation_id, result: opened(op) });
    expect((await db.pool.query('SELECT 1 FROM workspace_leases WHERE task_id=$1', [f.task])).rowCount).toBe(1);
    await expect(open(f, randomUUID(), f.project.resources[1]!.id)).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(save({ ...f.project, resources: [] })).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(db.pool.query("UPDATE operations SET workspace_digest=$2 WHERE id=$1", [op.operation_id, 'f'.repeat(64)])).rejects.toMatchObject({ code: '23514' });
  });

  it('uses first-open defaults, preserves archived Project access and rejects unreserved or removed resources', async () => {
    const f = await fixture();
    const added = { id: randomUUID(), remote_url: 'https://github.com/example/added.git', remote_preparation: 'after_acceptance' as const };
    const edited = { ...f.project, archived: true, resources: [{ ...f.project.resources[0]!, default_ref: 'release', default_branch: 'stable' }, added] };
    await save(edited);
    await expect(open(f, randomUUID(), added.id)).rejects.toMatchObject(fault('denied_scope'));
    await expect(open(f, randomUUID(), f.project.resources[1]!.id)).rejects.toMatchObject(fault('denied_scope'));
    const op = await operation(f, (await open(f)).response.operation_id!);
    expect(op.workspace?.resource).toMatchObject({ default_ref: 'release', default_branch: 'stable' });
    await save({ ...edited, resources: [{ ...edited.resources[0]!, default_ref: 'later', default_branch: 'later' }, added] });
    expect(await operation(f, op.operation_id)).toEqual(op);
  });

  it.each(['open', 'remove'] as const)('serializes resource removal with %s first in the observed lock queue', async (first) => {
    const f = await fixture();
    const command = { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(owner)).control_version,
      name: 'save_project', payload: { ...f.project, resources: [] } };
    const actions = {
      open: (peer: Database) => open(peerFixture(f, peer)),
      remove: (peer: Database) => new Configuration(peer).save(owner, command),
    };
    const second = first === 'open' ? 'remove' : 'open';
    const results = await contend<unknown, unknown>({ sql: 'SELECT version FROM configuration_control FOR UPDATE', values: [], relation: 'configuration_control' }, actions[first], actions[second]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({ status: 'rejected', reason: fault(first === 'open' ? 'unmet_precondition' : 'denied_scope') });
    const workspace = (await db.pool.query('SELECT id FROM task_workspaces WHERE task_id=$1', [f.task])).rows[0];
    const active = (await db.pool.query('SELECT active FROM project_resources WHERE id=$1', [f.resource])).rows[0].active;
    expect(Boolean(workspace)).toBe(first === 'open'); expect(active).toBe(first === 'open');
    expect((await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='open_workspace'", [f.attempt])).rowCount).toBe(first === 'open' ? 1 : 0);
  });

  it.each(['open', 'edit'] as const)('freezes first-open defaults with %s first in the observed lock queue', async (first) => {
    const f = await fixture();
    const command = { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(owner)).control_version,
      name: 'save_project', payload: { ...f.project, resources: [{ ...f.project.resources[0]!, default_ref: 'release', default_branch: 'stable' }, f.project.resources[1]!] } };
    const actions = {
      open: (peer: Database) => open(peerFixture(f, peer)),
      edit: (peer: Database) => new Configuration(peer).save(owner, command),
    };
    const second = first === 'open' ? 'edit' : 'open';
    const results = await contend<unknown, unknown>({ sql: 'SELECT version FROM configuration_control FOR UPDATE', values: [], relation: 'configuration_control' }, actions[first], actions[second]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const id = (await db.pool.query("SELECT id FROM operations WHERE attempt_id=$1 AND kind='open_workspace'", [f.attempt])).rows[0].id;
    const op = await operation(f, id);
    expect(op.workspace!.resource.default_branch).toBe(first === 'edit' ? 'stable' : 'main');
    expect(op.workspace!.resource.default_ref).toBe(first === 'edit' ? 'release' : undefined);
    expect(op.workspace_digest).toBe(digest(canonicalJSON(op.workspace)));
    expect((await configuration.read(owner)).projects.find((project) => project.id === f.project.id)!.resources.find((resource) => resource.id === f.resource)!.default_branch).toBe('stable');
    expect((await open(f)).response.operation_id).toBe(id);
    expect(await operation(f, id)).toEqual(op);
  });

  it('cancels an unexposed failed open only through its exact Stop and permits resource removal', async () => {
    const f = await fixture(); const first = await open(f); const op = await operation(f, first.response.operation_id!);
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: op.operation_id, attempt_id: f.attempt, success: false, failure_kind: 'recoverable', result: { workspace_unavailable_reason: 'credentials_missing', message: 'Configure access' } });
    const stopped = await stop(f);
    expect(stopped.workspace).toEqual(op.workspace); expect(stopped.workspace_digest).toBe(op.workspace_digest);
    const cancelled = { operation_id: op.operation_id, attempt_id: f.attempt, success: false, cancelled_by_operation_id: stopped.operation_id, result: { writer_absent: true } };
    await expect(f.service.finishOperation(f.runner, f.incarnation, { ...cancelled, cancelled_by_operation_id: randomUUID() })).rejects.toMatchObject(fault('unmet_precondition'));
    await f.service.finishOperation(f.runner, f.incarnation, cancelled); await f.service.finishOperation(f.runner, f.incarnation, cancelled);
    expect(await ownerOperationStatus(db, owner, f.task, op.operation_id)).toMatchObject({ state: 'cancelled', cancelled_by_operation_id: stopped.operation_id });
    expect(await f.service.recoverCommand(f.runner, f.attempt, first.command.request_id)).toMatchObject({ status: 'error', operation_id: op.operation_id, error: { code: 'unmet_precondition' } });
    await finish(f, stopped, { writer_absent: true });
    expect((await db.pool.query('SELECT state FROM workspace_leases WHERE id=$1', [op.workspace!.lease_id])).rows[0].state).toBe('released');
    await save({ ...f.project, resources: [f.project.resources[1]!] });
    expect((await f.service.inventory(f.runner)).operations).toEqual([]);
  });

  it('requires Stop checkpoint then reuses the same Task workspace and basis on a new Attempt', async () => {
    const github = new GitHub(key);
    const access = vi.spyOn(github, 'repositoryAccess').mockResolvedValue({ remote_url: 'https://github.com/example/repo.git',
      provider_metadata: { github: { repository_id: '42' } }, default_branch: 'main', authentication: { kind: 'anonymous' } });
    let f = await fixture(github); const op = await operation(f, (await open(f)).response.operation_id!); await finish(f, op);
    const stopped = await stop(f);
    await expect(finish(f, stopped, { writer_absent: true })).rejects.toMatchObject(fault('denied_scope'));
    const result = opened(stopped); result.writer_absent = true;
    result.workspace_metadata!.checkpoint = { operation_id: stopped.operation_id, head_commit: oid, tree_id: 'c'.repeat(40), commit_id: 'd'.repeat(40) };
    await finish(f, stopped, result);
    const version = Number((await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [f.task])).rows[0].control_version);
    await executeOwnerAction(db, owner, { schema_version: 1, request_id: randomUUID(), scope_id: f.task, name: 'continue_node', expected_control_version: version, payload: { attempt_id: f.attempt, node_id: f.node, node_activation: 1 } });
    await save({ ...f.project, resources: [{ ...f.project.resources[0]!, default_branch: 'other' }, f.project.resources[1]!] });
    f = { ...f, ...await f.start() };
    const reopened = await operation(f, (await open(f)).response.operation_id!);
    expect(reopened.workspace?.workspace_id).toBe(op.workspace?.workspace_id);
    expect(reopened.workspace?.lease_id).not.toBe(op.workspace?.lease_id);
    expect(reopened.workspace?.basis).toMatchObject({ base_commit: oid, finalized_commit: oid, target_branch: 'main', storage_id: 'storage' });
    expect(reopened.workspace?.resource.provider_metadata).toBeUndefined();
    await f.service.repositoryAccess(f.runner, reopened.operation_id, { schema_version: 1, incarnation: f.incarnation, workspace_digest: reopened.workspace_digest });
    expect(access.mock.calls[0]![0].provider_metadata).toEqual({ github: { repository_id: '42' } });
    expect(reopened.workspace?.resource.default_branch).toBe('main'); await finish(f, reopened);
    const complete = await f.service.admit(f.token, submission({ schema_version: 1, scope_id: f.task, request_id: randomUUID(), name: 'complete_node', expected_control_version: f.version, payload: { summary: 'Exact completed result' } }));
    const completion = await operation(f, complete.operation_id!); const completed = opened(completion);
    completed.writer_absent = true; completed.git_commit = 'e'.repeat(40); completed.git_tree = 'f'.repeat(40); completed.workspace_metadata!.finalized_commit = completed.git_commit;
    await finish(f, completion, completed);
    expect((await db.pool.query('SELECT finalized_commit FROM task_workspaces WHERE task_id=$1', [f.task])).rows[0].finalized_commit).toBe(completed.git_commit);
    expect((await db.pool.query('SELECT state FROM tasks WHERE id=$1', [f.task])).rows[0].state).toBe('REVIEW');
  });

  it('rolls back malformed result or receipt persistence without partial workspace ownership', async () => {
    const f = await fixture();
    await db.pool.query("CREATE FUNCTION reject_workspace_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='rollback-open' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_workspace_receipt BEFORE INSERT ON command_receipts FOR EACH ROW EXECUTE FUNCTION reject_workspace_receipt();");
    await expect(open(f, 'rollback-open')).rejects.toThrow('test rollback');
    expect((await db.pool.query('SELECT 1 FROM task_workspaces WHERE task_id=$1', [f.task])).rowCount).toBe(0);
    const op = await operation(f, (await open(f)).response.operation_id!); const result = opened(op);
    result.workspace_metadata!.lease_id = 'wrong'; await expect(finish(f, op, result)).rejects.toMatchObject(fault('denied_scope'));
    expect((await db.pool.query('SELECT ever_materialized FROM task_workspaces WHERE task_id=$1', [f.task])).rows[0].ever_materialized).toBe(false);
    await expect(finish(f, op, { ...opened(op), instruction_files: undefined })).rejects.toMatchObject(fault('unmet_precondition'));
    const wrongBranch = opened(op); wrongBranch.workspace_metadata!.target_branch = 'unadmitted';
    await expect(finish(f, op, wrongBranch)).rejects.toMatchObject(fault('payload_conflict'));
    const unverified = opened(op); delete unverified.workspace_metadata!.provider_metadata;
    await expect(finish(f, op, unverified)).rejects.toMatchObject(fault('denied_scope'));
  });

  it('recovers a failed refresh only for its admitted Stop and preserves the exact prior target observation', async () => {
    let f = await fixture(); const first = await operation(f, (await open(f)).response.operation_id!); await finish(f, first);
    const stopped = await stop(f), prior = opened(stopped); prior.writer_absent = true;
    prior.workspace_metadata!.checkpoint = { operation_id: stopped.operation_id, head_commit: oid, tree_id: 'c'.repeat(40), commit_id: 'd'.repeat(40) };
    await finish(f, stopped, prior);
    await executeOwnerAction(db, owner, { schema_version: 1, request_id: randomUUID(), scope_id: f.task, name: 'continue_node',
      expected_control_version: Number((await db.pool.query('SELECT control_version FROM tasks WHERE id=$1', [f.task])).rows[0].control_version),
      payload: { attempt_id: f.attempt, node_id: f.node, node_activation: 1 } });
    f = { ...f, ...await f.start() };
    const reopened = await operation(f, (await open(f)).response.operation_id!);
    await f.service.finishOperation(f.runner, f.incarnation, { operation_id: reopened.operation_id, attempt_id: f.attempt, success: false,
      failure_kind: 'recoverable', result: { workspace_unavailable_reason: 'repository_denied' } });
    const recovered = opened(reopened);
    recovered.workspace_metadata!.recovered_by_stop_operation_id = stopped.operation_id;
    recovered.workspace_metadata!.target_observation_lease_id = first.workspace!.lease_id;
    await expect(finish(f, reopened, recovered)).rejects.toMatchObject(fault('unmet_precondition'));
    const stopping = await stop(f);
    await expect(f.service.finishOperation(f.runner, f.incarnation, { operation_id: reopened.operation_id, attempt_id: f.attempt, success: false,
      cancelled_by_operation_id: stopping.operation_id, result: { writer_absent: true } })).rejects.toMatchObject(fault('unmet_precondition'));
    await expect(finish(f, reopened, recovered)).rejects.toMatchObject(fault('unmet_precondition'));
    recovered.workspace_metadata!.recovered_by_stop_operation_id = stopping.operation_id;
    recovered.workspace_metadata!.target_observation_lease_id = reopened.workspace!.lease_id;
    await expect(finish(f, reopened, recovered)).rejects.toMatchObject(fault('unmet_precondition'));
    recovered.workspace_metadata!.target_observation_lease_id = first.workspace!.lease_id;
    recovered.workspace_metadata!.target_commit = 'f'.repeat(40);
    await expect(finish(f, reopened, recovered)).rejects.toMatchObject(fault('unmet_precondition'));
    recovered.workspace_metadata!.target_commit = target;
    await finish(f, reopened, recovered);
    const checkpoint = structuredClone(recovered); checkpoint.writer_absent = true;
    checkpoint.workspace_metadata!.checkpoint = { operation_id: stopping.operation_id, head_commit: oid, tree_id: 'c'.repeat(40), commit_id: 'e'.repeat(40) };
    const missingProvenance = structuredClone(checkpoint);
    delete missingProvenance.workspace_metadata!.recovered_by_stop_operation_id; delete missingProvenance.workspace_metadata!.target_observation_lease_id;
    await expect(finish(f, stopping, missingProvenance)).rejects.toMatchObject(fault('unmet_precondition'));
    await finish(f, stopping, checkpoint);
    const lease = (await db.pool.query('SELECT state,recovered_by_stop_operation_id,target_observation_lease_id FROM workspace_leases WHERE id=$1', [reopened.workspace!.lease_id])).rows[0];
    expect(lease).toEqual({ state: 'released', recovered_by_stop_operation_id: stopping.operation_id, target_observation_lease_id: first.workspace!.lease_id });
    expect((await db.pool.query('SELECT finalized_commit FROM task_workspaces WHERE id=$1', [first.workspace!.workspace_id])).rows[0].finalized_commit).toBe(oid);
  });

  it('permits operation-bound access before ready and after fencing, then rechecks concurrent cancellation', async () => {
    const hooks: { duringFetch?: () => Promise<void> } = {};
    const github = new GitHub(key, async (_url, init) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      await hooks.duringFetch?.();
      return Response.json({ id: 42, full_name: 'example/repo', clone_url: 'https://github.com/example/repo.git', default_branch: 'main', private: false });
    });
    const f = await fixture(github); const op = await operation(f, (await open(f)).response.operation_id!);
    const incarnation = await f.service.connect(f.runner, 'boot');
    const request = { schema_version: 1, incarnation, workspace_digest: op.workspace_digest! };
    const app = createApp(f.service), url = `/v1/runner/operations/${op.operation_id}/repository-access`;
    try {
      const denied = await app.inject({ method: 'POST', url, payload: request, headers: { authorization: `Bearer ${f.token}` } });
      expect(denied.statusCode).toBe(401); expect(denied.json()).toEqual({ schema_version: 1, reason: 'ownership_unresolved' });
      const allowed = await app.inject({ method: 'POST', url, payload: request, headers: { authorization: `Bearer ${f.enrollment}` } });
      expect(allowed.statusCode).toBe(200); expect(allowed.json().authentication).toEqual({ kind: 'anonymous' });
      expect(allowed.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
    expect((await f.service.repositoryAccess(f.runner, op.operation_id, request)).authentication).toEqual({ kind: 'anonymous' });
    await expect(f.service.repositoryAccess(f.runner, op.operation_id, { ...request, workspace_digest: 'f'.repeat(64) })).rejects.toMatchObject(fault('denied_scope'));
    const stopped = await stop(f);
    expect((await f.service.repositoryAccess(f.runner, op.operation_id, request)).authentication.kind).toBe('anonymous');
    hooks.duringFetch = () => f.service.finishOperation(f.runner, incarnation, { operation_id: op.operation_id, attempt_id: f.attempt, success: false, cancelled_by_operation_id: stopped.operation_id, result: { writer_absent: true } });
    await expect(f.service.repositoryAccess(f.runner, op.operation_id, request)).rejects.toMatchObject(fault('denied_scope'));
    expect(JSON.stringify((await db.pool.query('SELECT to_jsonb(o) FROM operations o WHERE id=$1', [op.operation_id])).rows)).not.toContain('authentication');
  });

  it('rejects an ephemeral access result when provider configuration rotates during the network call', async () => {
    const github = new GitHub(key), f = await fixture(github), provider = new Configuration(db, github);
    const op = await operation(f, (await open(f)).response.operation_id!);
    vi.spyOn(github, 'repositoryAccess').mockImplementationOnce(async () => {
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      // This obtains the configuration write lock while the provider request is in flight.
      await provider.save(owner, { schema_version: 1, request_id: randomUUID(), name: 'save_github',
        expected_control_version: (await provider.read(owner)).control_version,
        payload: { app_id: '123', installation_id: '456', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
      return { remote_url: 'https://github.com/example/repo.git', provider_metadata: { github: { repository_id: '42' } }, default_branch: 'main',
        authentication: { kind: 'github_installation', token: 'synthetic-ephemeral-access-secret', expires_at: new Date(Date.now() + 3600000).toISOString() } };
    });
    await expect(f.service.repositoryAccess(f.runner, op.operation_id, { schema_version: 1, incarnation: f.incarnation,
      workspace_digest: op.workspace_digest })).rejects.toMatchObject(fault('stale_execution'));
    expect(JSON.stringify((await db.pool.query('SELECT to_jsonb(o) FROM operations o WHERE id=$1', [op.operation_id])).rows)).not.toContain('synthetic-ephemeral-access-secret');
  });
});
