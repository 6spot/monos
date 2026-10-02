import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, transaction } from '../../../packages/db/src/index.ts';
import type { Database } from '../../../packages/db/src/index.ts';
import { migrate } from '../../../packages/db/src/migrate.ts';
import { bootstrapOwner, OwnerAccess } from '../src/owner-access.ts';
import { prepareTaskProposal } from '../src/owner-commands.ts';
import { initializeTask } from '../src/task-records.ts';
import { createApp } from '../src/app.ts';
import { BoundaryService } from '../src/service.ts';

const password = 'synthetic-only-owner-password';
const origin = { host: 'monos.test', origin: 'http://monos.test' };
describe.skipIf(process.env.MONOS_TEST_DATABASE !== '1')('single Owner access and browser sessions', () => {
  let db: Database; let admin: Database; let access: OwnerAccess; let url: string;
  const namespace = `access_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const parsed = new URL(process.env.DATABASE_URL); parsed.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    url = parsed.toString(); db = database(url); await migrate(db); access = new OwnerAccess(db);
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } });

  it('requires local initialization and stores salted hashes rather than passwords', async () => {
    await expect(access.login(password)).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
    await bootstrapOwner(db, password);
    const row = (await db.pool.query('SELECT password_salt,password_hash FROM owner_access')).rows[0];
    expect(row.password_salt).toMatch(/^[0-9a-f]{64}$/); expect(row.password_hash).toMatch(/^[0-9a-f]{128}$/);
    expect(JSON.stringify(row)).not.toContain(password);
    const session = await access.login(password); expect((await access.session(session.token)).authenticated).toBe(true);
    await expect(bootstrapOwner(db, 'another-synthetic-password')).rejects.toMatchObject({ detail: { code: 'unmet_precondition' } });
    await expect(bootstrapOwner(db, 'short')).rejects.toMatchObject({ detail: { code: 'invalid_input' } });
  });

  it('persists concurrent failure throttling across service instances and resets after its window', async () => {
    await bootstrapOwner(db, password, true);
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => access.login('wrong-synthetic-password')));
    const codes = attempts.map((result) => result.status === 'rejected' ? result.reason.detail.code : 'unexpected-success');
    expect(codes.filter((code) => code === 'unauthorized')).toHaveLength(5);
    expect(codes.filter((code) => code === 'rate_limited')).toHaveLength(3);
    expect((await db.pool.query('SELECT failures FROM owner_access')).rows[0].failures).toBe(5);
    await expect(new OwnerAccess(db).login(password)).rejects.toMatchObject({ detail: { code: 'rate_limited' } });
    const app = createApp(new BoundaryService(db, { signingKey: 'test-only-owner-access-signing-key' }));
    try {
      const response = await app.inject({ method: 'POST', url: '/v1/owner/login', headers: origin, payload: { schema_version: 1, password } });
      expect(response.statusCode).toBe(429); expect(response.headers['retry-after']).toBe('60');
    } finally { await app.close(); }
    await db.pool.query("UPDATE owner_access SET window_started=now()-interval '2 minutes'");
    expect((await access.login(password)).token).toMatch(/^owner\.v1\./);
    expect((await db.pool.query('SELECT failures FROM owner_access')).rows[0].failures).toBe(0);
  });

  it('rotates explicitly, invalidates old sessions, and preserves independent new-session authentication', async () => {
    await bootstrapOwner(db, password, true);
    const old = await access.login(password);
    await bootstrapOwner(db, 'rotated-synthetic-owner-password', true);
    await expect(access.session(old.token)).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
    await expect(access.login(password)).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
    const current = await access.login('rotated-synthetic-owner-password');
    await access.logout(current.token); await access.logout(current.token);
    await expect(access.session(current.token)).rejects.toMatchObject({ detail: { code: 'unauthorized' } });
  });

  it('enforces Cookie flags, same-origin writes, duplicate-cookie rejection, expiry and logout', async () => {
    await bootstrapOwner(db, password, true);
    const app = createApp(new BoundaryService(db, { signingKey: 'test-only-owner-access-signing-key' }));
    try {
      const login = { method: 'POST' as const, url: '/v1/owner/login', payload: { schema_version: 1, password } };
      expect((await app.inject({ ...login, headers: { ...origin, origin: 'https://other.test' } })).statusCode).toBe(403);
      const response = await app.inject({ ...login, headers: origin });
      expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
      const setCookie = String(response.headers['set-cookie']); const cookie = setCookie.split(';')[0]!;
      for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) expect(setCookie).toContain(flag);
      expect(setCookie).not.toContain('Domain='); expect(response.json()).not.toHaveProperty('token'); expect(response.body).not.toContain(password);
      const headers = { ...origin, cookie };
      const sessionRead = await app.inject({ method: 'GET', url: '/v1/owner/session', headers });
      expect(sessionRead.statusCode).toBe(200);
      expect(response.json().session_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sessionRead.json().session_id).toBe(response.json().session_id);
      expect(sessionRead.body).not.toContain(cookie.slice('__Host-monos='.length));
      expect((await app.inject({ method: 'GET', url: '/v1/owner/session', headers: { ...headers, cookie: `${cookie}; ${cookie}` } })).statusCode).toBe(401);
      const taskId = randomUUID();
      await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: {} }));
      const proposal = await transaction(db, (tx) => prepareTaskProposal(tx, { task_id: taskId, id: randomUUID(), action: 'apply_rework', content: {} }));
      const command = { schema_version: 1, name: 'confirm_proposal', scope_id: taskId, request_id: randomUUID(), expected_control_version: 1, payload: { proposal_id: proposal.proposal_id, content_digest: proposal.content_digest } };
      expect((await app.inject({ method: 'POST', url: '/v1/owner/commands', headers: { host: origin.host, cookie }, payload: command })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/v1/owner/commands', headers, payload: command })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/v1/owner/logout', headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403);
      const logout = await app.inject({ method: 'POST', url: '/v1/owner/logout', headers });
      expect(logout.statusCode).toBe(200); expect(logout.headers['set-cookie']).toContain('Max-Age=0');
      expect((await app.inject({ method: 'GET', url: '/v1/owner/session', headers })).statusCode).toBe(401);
      const expired = await access.login(password);
      await db.pool.query("UPDATE owner_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.session_id]);
      expect((await app.inject({ method: 'GET', url: '/v1/owner/session', headers: { authorization: `Bearer ${expired.token}` } })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('bootstraps through bounded stdin without exposing the password in arguments or output', async () => {
    const cliPassword = 'synthetic-CLI-owner-password';
    const child = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/owner-admin.ts', import.meta.url)), '--rotate'], {
      input: JSON.stringify({ password: cliPassword }), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DATABASE_URL: url, MONOS_DATABASE_URL_FILE: '' },
    });
    expect(child.status).toBe(0); expect(child.stdout + child.stderr).not.toContain(cliPassword);
    expect((await access.login(cliPassword)).token).toMatch(/^owner\.v1\./);
  });
});
