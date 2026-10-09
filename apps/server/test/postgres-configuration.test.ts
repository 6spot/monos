import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { submission } from '../../../packages/protocol/src/index.ts';
import type { ConfigurationCommand, ProjectConfiguration, RoleConfiguration } from '../../../packages/protocol/src/index.ts';
import { repositoryIdentity, validateGitRef } from '../../../packages/domain/src/repositories.ts';
import { Configuration } from '../src/configuration.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { initializeTask, publishInitialPlan } from '../src/task-records.ts';
import { createAttemptFixture, enrollFixture } from '../src/fixtures.ts';
import { createApp } from '../src/app.ts';
import { BoundaryService } from '../src/service.ts';

const fault = (code: string) => ({ detail: { code } });
const role = (): RoleConfiguration => ({ id: randomUUID(), name: 'Builder', description: 'Reusable behavior', instructions: 'Read context and verify changes.', archived: false });
const project = (): ProjectConfiguration => ({ id: randomUUID(), name: 'Example', context: 'Owner-authored constraints', archived: false, role_ids: [], resources: [{ id: randomUUID(), remote_url: 'https://github.com/example/repository.git', remote_preparation: 'automatic', default_branch: 'main' }] });

it('normalizes repository aliases and rejects local/credentialed remotes and invalid refs', () => {
  expect(repositoryIdentity('git@github.com:Example/Repository.git')).toBe(repositoryIdentity('https://github.com/example/repository'));
  expect(repositoryIdentity('ssh://git@git.example.test/repo.git')).toBe('git.example.test/repo');
  for (const remote of ['/tmp/repo', 'file:///tmp/repo', 'https://token@github.com/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/%2e%2e/b', 'ext::sh command']) expect(() => repositoryIdentity(remote)).toThrow();
  for (const ref of ['-main', 'a..b', 'refs/heads/.hidden', 'main.lock', 'a\\b']) expect(() => validateGitRef(ref)).toThrow();
  for (const ref of ['main', 'release/v1', 'v1.0.0', 'a'.repeat(40)]) expect(() => validateGitRef(ref)).not.toThrow();
});

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('Project and Role configuration', () => {
  let db: Database; let admin: Database; let configuration: Configuration; let token: string;
  const namespace = `configuration_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db); configuration = new Configuration(db); token = (await issueOwnerSession(db)).token;
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });
  async function command(payload: ProjectConfiguration | RoleConfiguration): Promise<ConfigurationCommand> {
    return { schema_version: 1, request_id: randomUUID(), expected_control_version: (await configuration.read(token)).control_version, name: 'resources' in payload ? 'save_project' : 'save_role', payload };
  }
  async function save(payload: ProjectConfiguration | RoleConfiguration) { return configuration.save(token, await command(payload)); }

  it('persists reusable Roles, Project context/resources and archive/restore across service instances', async () => {
    const r = role(); const p = project(); p.role_ids = [r.id];
    await save(r); await save(p);
    const snapshot = await new Configuration(db).read(token);
    expect(snapshot.projects.find((row) => row.id === p.id)).toEqual(p);
    expect(snapshot.roles.find((row) => row.id === r.id)).toEqual(r);
    await save({ ...p, archived: true });
    await expect(transaction(db, (tx) => initializeTask(tx, { task_id: randomUUID(), specification_id: randomUUID(), specification: {}, project_id: p.id }))).rejects.toMatchObject(fault('unmet_precondition'));
    await save(p);
    const taskId = randomUUID(); await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: {}, project_id: p.id }));
    expect((await db.pool.query('SELECT project_id,resource_id FROM tasks WHERE id=$1', [taskId])).rows[0]).toEqual({ project_id: p.id, resource_id: null });
  });

  it('serializes identical retries and conflicting concurrent edits with immutable receipts', async () => {
    const p = project(); const c = await command(p);
    const responses = await Promise.all(Array.from({ length: 6 }, () => configuration.save(token, c)));
    for (const response of responses) expect(response).toEqual(responses[0]);
    expect(await configuration.status(token, c.request_id)).toEqual(responses[0]);
    await expect(configuration.save(token, { ...c, payload: { ...p, name: 'Changed' } })).rejects.toMatchObject(fault('payload_conflict'));
    await expect(configuration.save(token, { ...c, request_id: randomUUID() })).rejects.toMatchObject(fault('version_conflict'));
    const a = await command({ ...p, name: 'A' }); const b = { ...a, request_id: randomUUID(), payload: { ...p, name: 'B' } };
    const results = await Promise.allSettled([a, b].map((value) => configuration.save(token, value)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: fault('version_conflict') });
    expect(await configuration.save(token, c)).toEqual(responses[0]);
    await expect(db.pool.query('DELETE FROM configuration_receipts WHERE request_id=$1', [c.request_id])).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects aliases, identity reassignment and invalid Role selection without partial writes', async () => {
    const p = project(); await save(p); const resource = p.resources[0]!;
    for (const change of [
      { ...p, role_ids: ['missing'] },
      { ...p, resources: [resource, { ...resource, id: randomUUID(), remote_url: 'git@github.com:EXAMPLE/repository.git' }] },
      { ...p, resources: [{ ...resource, remote_url: 'https://github.com/example/different' }] },
      { ...project(), resources: [resource] },
    ]) {
      const before = await configuration.read(token); const c = await command(change);
      await expect(configuration.save(token, c)).rejects.toThrow();
      expect(await configuration.read(token)).toEqual(before);
      expect((await configuration.status(token, c.request_id)).status).toBe('unknown');
    }
    await save({ ...p, resources: [] });
    await expect(save({ ...p, resources: [{ ...resource, id: randomUUID() }] })).rejects.toMatchObject(fault('payload_conflict'));
    await save(p);
    const hidden = { ...role(), archived: true }; await save(hidden);
    await expect(save({ ...p, role_ids: [hidden.id] })).rejects.toMatchObject(fault('unmet_precondition'));
  });

  it('validates Project Roles on Plan publication and prevents removing a Role still used by unfinished work', async () => {
    const r = role(); const p = project(); p.role_ids = [r.id]; await save(r); await save(p);
    const taskId = randomUUID(); const expected = await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: {}, project_id: p.id }));
    const runner = randomUUID(); const attempt = randomUUID(); await enrollFixture(db, runner, randomUUID());
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [taskId]);
    await db.pool.query("INSERT INTO attempts(id,runner_id,task_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,specification_id) VALUES($1,$2,$3,$4,$5,'planner',1,0,'{}',$6)", [attempt, runner, taskId, `planner:${taskId}`, randomUUID(), expected.specification_id]);
    const input = { task_id: taskId, plan_id: randomUUID(), expected, nodes: [{ node_id: randomUUID(), role_id: 'unselected', goal: 'work', dependencies: [] }], claim: { attempt_id: attempt, fencing_generation: 1 } };
    await expect(transaction(db, (tx) => publishInitialPlan(tx, input))).rejects.toMatchObject(fault('unmet_precondition'));
    input.nodes[0]!.role_id = r.id; await transaction(db, (tx) => publishInitialPlan(tx, input));
    await expect(save({ ...p, role_ids: [] })).rejects.toMatchObject(fault('unmet_precondition'));
    await save({ ...r, instructions: 'Latest instructions', archived: true });
    await save({ ...p, name: 'Retain existing hidden Role' });
    expect((await db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1', [input.plan_id])).rows[0].definition).not.toHaveProperty('instructions');
    await db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1", [taskId]); await save({ ...p, role_ids: [] });
  });

  it('holds resources for admitted workspaces until Task terminalization; inspection alone permits removal', async () => {
    const p = project(); await save(p); const resourceId = p.resources[0]!.id;
    const runner = randomUUID(); await enrollFixture(db, runner, randomUUID());
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: resourceId, prompt: 'Workspace removal guard' });
    await db.pool.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id) VALUES($1,$2,1,'inspect_repository',$3,'succeeded',$4)", [randomUUID(), launch.attempt_id, randomUUID(), resourceId]);
    await save({ ...p, resources: [] }); await save(p);
    await db.pool.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id) VALUES($1,$2,1,'open_workspace',$3,'admitted',$4)", [randomUUID(), launch.attempt_id, randomUUID(), resourceId]);
    await expect(save({ ...p, resources: [] })).rejects.toMatchObject(fault('unmet_precondition'));
    await db.pool.query("UPDATE tasks SET state='COMPLETED' WHERE id=$1", [launch.task_id]);
    await expect(save({ ...p, resources: [] })).rejects.toMatchObject(fault('unmet_precondition'));
    await db.pool.query('UPDATE attempts SET process_released=true,process_absent=true WHERE id=$1', [launch.attempt_id]);
    await db.pool.query("UPDATE operations SET state='succeeded' WHERE attempt_id=$1", [launch.attempt_id]);
    await save({ ...p, resources: [] });
  });

  it('protects reads/writes/replay at HTTP boundaries and preserves no-store responses', async () => {
    const app = createApp(new BoundaryService(db, { signingKey: 'test-only-configuration-signing-key' }));
    const session = await issueOwnerSession(db); const c = await command(role());
    try {
      for (const headers of [{}, { authorization: 'Bearer runner-test-token' }]) expect((await app.inject({ method: 'GET', url: '/v1/owner/configuration', headers })).statusCode).toBe(401);
      const cookie = `monos=${session.token}`;
      expect((await app.inject({ method: 'POST', url: '/v1/owner/configuration/commands', headers: { cookie }, payload: c })).statusCode).toBe(403);
      const headers = { authorization: `Bearer ${session.token}` };
      const saved = await app.inject({ method: 'POST', url: '/v1/owner/configuration/commands', headers, payload: c });
      expect(saved.statusCode).toBe(200); expect(saved.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'GET', url: `/v1/owner/configuration/commands/${c.request_id}`, headers })).json()).toEqual(saved.json());
      await revokeOwnerSession(db, session.session_id);
      expect((await app.inject({ method: 'POST', url: '/v1/owner/configuration/commands', headers, payload: c })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('rolls back configuration and its version when receipt persistence fails', async () => {
    const p = project(); const c = await command(p); const before = await configuration.read(token);
    await db.pool.query(`CREATE FUNCTION fail_configuration_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END; $$`);
    await db.pool.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON configuration_receipts FOR EACH ROW EXECUTE FUNCTION fail_configuration_receipt()');
    try {
      await expect(configuration.save(token, c)).rejects.toThrow('test receipt failure');
      expect(await configuration.read(token)).toEqual(before);
      expect((await configuration.status(token, c.request_id)).status).toBe('unknown');
      expect((await db.pool.query('SELECT id FROM project_resources WHERE project_id=$1', [p.id])).rowCount).toBe(0);
    } finally { await db.pool.query('DROP TRIGGER fail_receipt ON configuration_receipts'); await db.pool.query('DROP FUNCTION fail_configuration_receipt()'); }
  });

  it('rejects a new workspace admission after resource removal on a canonical Project', async () => {
    const p = project(); await save(p); const runner = randomUUID(); await enrollFixture(db, runner, randomUUID());
    const service = new BoundaryService(db, { signingKey: 'test-only-project-workspace-signing-key' });
    const incarnation = await service.connect(runner, 'boot'); await service.touch(runner, incarnation, true);
    const launch = await createAttemptFixture(db, { runner_id: runner, attempt_id: randomUUID(), task_id: randomUUID(), kind: 'node', resource_id: p.resources[0]!.id, prompt: 'Canonical resource guard' });
    await db.pool.query('UPDATE tasks SET project_id=$2 WHERE id=$1', [launch.task_id, p.id]);
    const grant = await service.authorize(runner, incarnation, launch.dispatch_id);
    await save({ ...p, resources: [] });
    const request = submission({ schema_version: 1, request_id: randomUUID(), scope_id: launch.task_id, expected_control_version: 1, name: 'open_workspace', payload: { resource_id: p.resources[0]!.id } });
    await expect(service.admit(grant!.credential, request)).rejects.toMatchObject(fault('denied_scope'));
    expect((await db.pool.query('SELECT id FROM operations WHERE attempt_id=$1', [launch.attempt_id])).rowCount).toBe(0);
    await save(p); expect((await service.admit(grant!.credential, request)).status).toBe('admitted');
    await expect(save({ ...p, resources: [] })).rejects.toMatchObject(fault('unmet_precondition'));
  });
});
