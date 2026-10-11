import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { latestSchemaVersion, migrate } from '../../../packages/db/src/migrate.ts';
import type { ExecutionPolicy, PolicyConfiguration, ProjectConfiguration, RoleConfiguration, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { createApp } from '../src/app.ts';
import { Configuration } from '../src/configuration.ts';
import { DispatchQueue } from '../src/dispatch-queue.ts';
import { enrollFixture } from '../src/fixtures.ts';
import { issueOwnerSession, revokeOwnerSession } from '../src/owner-commands.ts';
import { RuntimeScheduling } from '../src/runtime-scheduling.ts';
import { BoundaryService } from '../src/service.ts';
import { setupReadiness } from '../src/setup-readiness.ts';
import { initializeTask } from '../src/task-records.ts';

const model = 'opencode/longcat-2.5-preview-free';
const installation: RuntimeInstallation = { runtime_id: 'opencode', executable: '/opencode', version: '1.18.30', availability: 'detected', supports_model: true, supports_thinking: false, model_ids: [] };
const policy = (runner_id?: string): ExecutionPolicy => ({ default_target: { runtime_id: 'opencode', model_id: model, ...(runner_id ? { runner_id } : {}) }, fallback_targets: [] });
const fault = (code: string) => ({ detail: { code } });

describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('authenticated setup prerequisites report', () => {
  let db: Database; let admin: Database; let token: string; let configuration: Configuration; let service: BoundaryService;
  const namespace = `setup_readiness_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    db = database(url.toString()); await migrate(db); configuration = new Configuration(db); token = (await issueOwnerSession(db)).token;
  });
  beforeEach(async () => {
    // Keep durable history intact; each case observes only its active Projects
    // and its current backend's connected Runners.
    await db.pool.query('UPDATE projects SET archived=true');
    await db.pool.query('UPDATE roles SET archived=true');
    await db.pool.query('UPDATE runners SET connected=false,ready=false');
    await db.pool.query("UPDATE execution_policies SET policies='{}'");
    service = new BoundaryService(db, { signingKey: 'synthetic-setup-report-signing-key' });
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  const report = () => setupReadiness(db, token, service.instanceId);
  async function save(payload: ProjectConfiguration | RoleConfiguration | PolicyConfiguration) {
    return configuration.save(token, { schema_version: 1, request_id: randomUUID(),
      expected_control_version: (await configuration.read(token)).control_version,
      name: 'resources' in payload ? 'save_project' : 'instructions' in payload ? 'save_role' : 'save_policies', payload });
  }
  async function role(execution_policy?: ExecutionPolicy) {
    const value: RoleConfiguration = { id: randomUUID(), name: 'Builder', description: 'private role description', instructions: 'private role instructions', archived: false, ...(execution_policy ? { execution_policy } : {}) };
    await save(value); return value;
  }
  async function project(role_ids: string[] = []) {
    const value: ProjectConfiguration = { id: randomUUID(), name: 'Repo-free Project', context: 'private project context', archived: false, resources: [], role_ids };
    await save(value); return value;
  }
  async function runner(capacity = 2) {
    const id = randomUUID(); await enrollFixture(db, id, randomUUID(), capacity);
    const incarnation = await service.connect(id, 'boot'); await service.touch(id, incarnation, true, [installation]);
    return { id, incarnation };
  }
  async function admit() {
    const task_id = randomUUID();
    const expected = await transaction(db, tx => initializeTask(tx, { task_id, specification_id: randomUUID(), specification: { title: 'Readiness parity probe' } }));
    await db.pool.query("UPDATE tasks SET state='RUNNING' WHERE id=$1", [task_id]);
    const request = { attempt_id: randomUUID(), task_id, kind: 'planner' as const, expected, legacy_probe: true as const, resource_id: 'repo', prompt: 'synthetic setup test; no model launch', source_watermark: 1 };
    const result = await transaction(db, tx => new RuntimeScheduling(new DispatchQueue(db), service.instanceId).selectAndEnqueue(tx, request));
    return { request, result };
  }
  async function durableState() {
    const rows: Record<string, unknown> = {};
    for (const table of ['tasks', 'attempts', 'outbox', 'operations', 'runners', 'runtime_installations', 'configuration_control', 'configuration_receipts', 'owner_command_receipts', 'owner_sessions', 'projects', 'project_roles', 'roles', 'execution_policies']) {
      rows[table] = (await db.pool.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return rows;
  }

  it('reports an empty initialized product without claiming host or model verification', async () => {
    expect(await report()).toEqual({ schema_version: 1, observed_at: expect.any(String), configuration_version: 0,
      schema: { status: 'current', current_version: latestSchemaVersion, expected_version: latestSchemaVersion },
      planner: { status: 'unavailable', source: 'global', reason: 'policy_missing', action: 'configure_policy' },
      projects: [], runners: [], unverified: ['storage', 'cli_authentication', 'model_execution', 'git_read', 'git_write'] });
    await save({ global: policy() });
    expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'installation_unavailable', action: 'enroll_runner' });
    await save({ global: policy(randomUUID()) });
    expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'runner_missing', action: 'enroll_runner' });
  });

  it('requires valid Owner authentication on the HTTP route and sets no-store', async () => {
    const app = createApp(service);
    const revoked = await issueOwnerSession(db); await revokeOwnerSession(db, revoked.session_id);
    const expired = await issueOwnerSession(db); await db.pool.query("UPDATE owner_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.session_id]);
    try {
      for (const credential of ['', 'runner-credential', revoked.token, expired.token]) {
        const response = await app.inject({ method: 'GET', url: '/v1/owner/setup-readiness', headers: { authorization: `Bearer ${credential}` } });
        expect(response.statusCode).toBe(401); expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).not.toHaveProperty('runners');
      }
      for (const headers of [{ authorization: `Bearer ${token}` }, { cookie: `monos=${token}` }]) {
        const response = await app.inject({ method: 'GET', url: '/v1/owner/setup-readiness', headers });
        expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toMatchObject({ schema_version: 1, projects: [] });
      }
    } finally { await app.close(); }
  });

  it('accepts repo-free Projects and omits archived Projects, Roles and private configuration', async () => {
    const r = await runner(); await save({ global: policy(r.id) });
    const selected = await role(); const archived = await role();
    const configured = await project([selected.id, archived.id]);
    const empty = await project(); const archivedOnly = await project([archived.id]); const hidden = await project([selected.id]);
    await save({ ...archived, archived: true }); await save({ ...hidden, archived: true });
    const actual = await report();
    expect(actual.configuration_version).toBe((await configuration.read(token)).control_version);
    expect(actual.projects).toHaveLength(3);
    expect(actual.projects.find(p => p.project_id === configured.id)).toEqual({ project_id: configured.id, name: configured.name, status: 'configured',
      roles: [{ role_id: selected.id, name: selected.name, policy: { status: 'available', source: 'global', target: policy(r.id).default_target, runner_id: r.id } }] });
    for (const value of [empty, archivedOnly]) expect(actual.projects.find(p => p.project_id === value.id)).toMatchObject({ status: 'missing_roles', roles: [] });
    const serialized = JSON.stringify(actual);
    for (const privateValue of [selected.instructions, selected.description, configured.context, token]) expect(serialized).not.toContain(privateValue);
    expect(actual).not.toHaveProperty('github');
  });

  it('keeps Planner and Role overrides independent of Global and matches actual fallback admission', async () => {
    const r = await runner();
    const unavailable: ExecutionPolicy = { default_target: { runtime_id: 'unrecognized' }, fallback_targets: [{ runtime_id: 'opencode', model_id: 'unsupported/model' }] };
    await save({ global: policy(r.id), planner: unavailable });
    const selected = await role(unavailable); const p = await project([selected.id]);
    let actual = await report();
    expect(actual.planner).toMatchObject({ status: 'unavailable', source: 'planner', reason: 'unsupported_model', action: 'review_target' });
    expect(actual.projects.find(v => v.project_id === p.id)).toMatchObject({ status: 'runtime_unavailable', roles: [{ policy: { status: 'unavailable', source: 'role', reason: 'unsupported_model' } }] });
    expect((await admit()).result).toMatchObject({ status: actual.planner.status, source: actual.planner.source, reason: actual.planner.reason, target: actual.planner.target });
    const fallback = { default_target: unavailable.default_target, fallback_targets: [policy(r.id).default_target] };
    await save({ global: unavailable, planner: fallback }); await save({ ...selected, execution_policy: fallback });
    actual = await report();
    expect(actual.planner).toEqual({ status: 'available', source: 'planner', target: policy(r.id).default_target, runner_id: r.id });
    expect(actual.projects.find(v => v.project_id === p.id)).toMatchObject({ status: 'configured', roles: [{ policy: { source: 'role', status: 'available', runner_id: r.id } }] });
    expect((await admit()).result).toMatchObject({ status: 'queued', source: actual.planner.source, target: actual.planner.target, runner_id: actual.planner.runner_id });
  });

  it('stops fallback for missing, offline, or stale pinned Runners, but permits objective installation loss', async () => {
    const first = await runner(); const second = await runner();
    const configured = { ...policy(first.id), fallback_targets: [policy(second.id).default_target] };
    await save({ global: configured });
    await service.touch(first.id, first.incarnation, true, [{ ...installation, availability: 'not_found' }]);
    expect((await report()).planner).toMatchObject({ status: 'available', runner_id: second.id });
    await service.disconnect(first.id, first.incarnation);
    expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'runner_offline', action: 'start_runner', target: configured.default_target });
    const next = await service.connect(first.id, 'reconnect'); await service.touch(first.id, next, true);
    const stale = await report();
    expect(stale.planner).toMatchObject({ status: 'unavailable', reason: 'installation_stale', action: 'refresh_runtime' });
    expect(stale.runners.find(v => v.runner_id === first.id)).toMatchObject({ online: true, runtimes: [{ current: false }] });
    await save({ global: { ...configured, default_target: policy(randomUUID()).default_target } });
    expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'runner_missing', action: 'select_runner' });
  });

  it('uses current backend and heartbeat facts and never bypasses Auto ambiguity', async () => {
    const first = await runner(); const second = await runner();
    await save({ global: { ...policy(), fallback_targets: [policy(first.id).default_target] } });
    expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'ambiguous_auto_placement', action: 'select_runner', target: policy().default_target });
    await db.pool.query('UPDATE runners SET connection_instance=$2 WHERE id=$1', [second.id, randomUUID()]);
    let actual = await report();
    expect(actual.planner).toMatchObject({ status: 'available', runner_id: first.id });
    expect(actual.runners.find(v => v.runner_id === second.id)?.online).toBe(false);
    await save({ global: policy(first.id) });
    await db.pool.query("UPDATE runners SET last_seen=clock_timestamp()-interval '16 seconds' WHERE id=$1", [first.id]);
    actual = await report();
    expect(actual.planner).toMatchObject({ status: 'unavailable', reason: 'runner_offline' });
    expect(actual.runners.find(v => v.runner_id === first.id)?.online).toBe(false);
    await service.touch(first.id, first.incarnation, true, []);
    actual = await report();
    expect(actual.planner).toMatchObject({ status: 'unavailable', reason: 'installation_unavailable' });
    expect(actual.runners.find(v => v.runner_id === first.id)).toMatchObject({ online: true, runtimes: [] });
  });

  it('reports compatibility at full capacity without changing any durable state', async () => {
    const r = await runner(1); await save({ global: policy(r.id) });
    await project([(await role()).id]);
    const admitted = await admit(); expect(admitted.result.status).toBe('queued');
    const queue = new DispatchQueue(db);
    expect((await queue.promoteNext(r.id, service.instanceId, r.incarnation))?.attempt_id).toBe(admitted.request.attempt_id);
    const waiting = await admit(); expect(waiting.result.status).toBe('queued');
    expect(await queue.promoteNext(r.id, service.instanceId, r.incarnation)).toBeNull();
    const before = await durableState();
    const actual = await report();
    expect(actual.planner).toMatchObject({ status: 'available', runner_id: r.id });
    expect(actual.projects[0]?.status).toBe('configured');
    expect(actual.unverified).toEqual(['storage', 'cli_authentication', 'model_execution', 'git_read', 'git_write']);
    expect(await durableState()).toEqual(before);
  });

  it('reads Runner and configuration rows without waiting for their write locks', async () => {
    const r = await runner(); await save({ global: policy(r.id) });
    const writer = await db.pool.connect();
    try {
      await writer.query('BEGIN'); await writer.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [r.id]);
      await writer.query('SELECT version FROM configuration_control FOR UPDATE');
      // If report introduces SELECT FOR SHARE/UPDATE, its statement timeout
      // fails this read while the writer remains held.
      expect((await report()).planner).toMatchObject({ status: 'available', runner_id: r.id });
    } finally { await writer.query('ROLLBACK'); writer.release(); }
  }, 15000);

  it('keeps one snapshot when configuration and Runner facts commit during report generation', async () => {
    const r = await runner(); await save({ global: policy(r.id) });
    const version = (await configuration.read(token)).control_version;
    const writer = await db.pool.connect(); let pending: ReturnType<typeof report> | undefined;
    try {
      await writer.query('BEGIN'); await writer.query('LOCK TABLE configuration_control IN ACCESS EXCLUSIVE MODE');
      const pid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
      pending = report(); void pending.catch(() => undefined);
      let blocked = false;
      for (let count = 0; count < 500; count++) {
        if ((await admin.pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query='SELECT version FROM configuration_control'", [pid])).rowCount) { blocked = true; break; }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await writer.query('UPDATE configuration_control SET version=version+1');
      await writer.query('UPDATE runners SET connected=false WHERE id=$1', [r.id]);
      await writer.query('COMMIT');
      const actual = await pending;
      expect(actual.configuration_version).toBe(version);
      expect(actual.planner).toMatchObject({ status: 'available', runner_id: r.id });
      expect(actual.runners.find(v => v.runner_id === r.id)?.online).toBe(true);
      expect((await report()).planner).toMatchObject({ status: 'unavailable', reason: 'runner_offline' });
    } finally { await writer.query('ROLLBACK'); await pending?.catch(() => undefined); writer.release(); }
  }, 15000);

  it('reports migration metadata gaps even when the highest version is current', async () => {
    const missing = (await db.pool.query<{ version: number; checksum: string }>('DELETE FROM schema_migrations WHERE version=2 RETURNING version,checksum')).rows[0]!;
    try {
      expect((await report()).schema).toEqual({ status: 'mismatch', current_version: latestSchemaVersion, expected_version: latestSchemaVersion });
    } finally { await db.pool.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [missing.version, missing.checksum]); }
    expect((await report()).schema.status).toBe('current');
  });

  it('rejects an oversized report instead of silently dropping Projects', async () => {
    await db.pool.query("INSERT INTO projects(id,name,context) SELECT 'oversized-'||n,repeat('n',180),'' FROM generate_series(1,10000) n");
    await expect(report()).rejects.toMatchObject(fault('unmet_precondition'));
  });
});
