import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as requestHTTP } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { request as requestHTTPS } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  let directory: string; let tls: { key: Buffer; cert: Buffer };
  const namespace = `access_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    admin = database(process.env.DATABASE_URL); await admin.pool.query(`CREATE SCHEMA ${namespace}`);
    const parsed = new URL(process.env.DATABASE_URL); parsed.searchParams.set('options', `-c search_path=${namespace} -c statement_timeout=10000`);
    url = parsed.toString(); db = database(url); await migrate(db); access = new OwnerAccess(db);
    directory = await mkdtemp(join(tmpdir(), 'monos-owner-transport-'));
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore' });
    tls = { key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) };
  });
  afterAll(async () => { if (db) await db.pool.end(); if (admin) { await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`); await admin.pool.end(); } if (directory) await rm(directory, { recursive: true, force: true }); });

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

  it.each(['http', 'https'] as const)('enforces %s Cookie flags, actual-connection origin, expiry and logout over a real listener', async (protocol) => {
    await bootstrapOwner(db, password, true);
    const secure = protocol === 'https';
    const app = createApp(new BoundaryService(db, { signingKey: 'test-only-owner-access-signing-key' }), secure ? tls : undefined);
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const origin = { host: new URL(base).host, origin: base };
    const cookieName = secure ? '__Host-monos' : 'monos';
    const forwarded = { 'x-forwarded-proto': secure ? 'http' : 'https', 'x-forwarded-host': 'other.test', forwarded: `host=other.test;proto=${secure ? 'http' : 'https'}` };
    const send = (input: { method?: string; url: string; headers?: Record<string, string>; payload?: unknown }) => new Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string; json: () => ReturnType<typeof JSON.parse> }>((resolve, reject) => {
      const body = input.payload === undefined ? undefined : JSON.stringify(input.payload);
      const request = (secure ? requestHTTPS : requestHTTP)(new URL(input.url, base), {
        method: input.method ?? 'GET', ca: tls.cert, rejectUnauthorized: true, agent: false,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...input.headers },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => { const body = Buffer.concat(chunks).toString(); resolve({ statusCode: response.statusCode!, headers: response.headers, body, json: () => JSON.parse(body) }); });
      });
      request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('Owner test request timed out'))); request.end(body);
    });
    try {
      const login = { method: 'POST' as const, url: '/v1/owner/login', payload: { schema_version: 1, password } };
      for (const headers of [{ host: origin.host }, { ...origin, origin: 'https://other.test' }, { ...origin, ...forwarded, origin: `${forwarded['x-forwarded-proto']}://other.test` }]) {
        expect((await send({ ...login, headers })).statusCode).toBe(403);
      }
      const response = await send({ ...login, headers: { ...origin, ...forwarded } });
      expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
      const setCookie = String(response.headers['set-cookie']); const cookie = setCookie.split(';')[0]!;
      for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/']) expect(setCookie).toContain(flag);
      expect(setCookie.startsWith(`${cookieName}=`)).toBe(true); expect(setCookie.includes('; Secure;')).toBe(secure); expect(setCookie).not.toContain('Domain='); expect(response.json()).not.toHaveProperty('token'); expect(response.body).not.toContain(password);
      const headers = { ...origin, cookie };
      const sessionRead = await send({ method: 'GET', url: '/v1/owner/session', headers });
      expect(sessionRead.statusCode).toBe(200);
      expect(response.json().session_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sessionRead.json().session_id).toBe(response.json().session_id);
      expect(sessionRead.body).not.toContain(cookie.slice(cookieName.length + 1));
      for (const rejected of [
        { ...headers, cookie: `${cookie}; ${cookie}` },
        { ...headers, ...forwarded, cookie: `${secure ? 'monos' : '__Host-monos'}=${cookie.slice(cookieName.length + 1)}` },
        { ...headers, authorization: 'Bearer invalid' },
      ]) expect((await send({ url: '/v1/owner/session', headers: rejected })).statusCode).toBe(401);
      const taskId = randomUUID();
      await transaction(db, (tx) => initializeTask(tx, { task_id: taskId, specification_id: randomUUID(), specification: {} }));
      const proposal = await transaction(db, (tx) => prepareTaskProposal(tx, { task_id: taskId, id: randomUUID(), action: 'apply_rework', content: {} }));
      const command = { schema_version: 1, name: 'confirm_proposal', scope_id: taskId, request_id: randomUUID(), expected_control_version: 1, payload: { proposal_id: proposal.proposal_id, content_digest: proposal.content_digest } };
      expect((await send({ method: 'POST', url: '/v1/owner/commands', headers: { host: origin.host, cookie }, payload: command })).statusCode).toBe(403);
      expect((await send({ method: 'POST', url: '/v1/owner/commands', headers, payload: command })).statusCode).toBe(200);
      expect((await send({ method: 'POST', url: '/v1/owner/logout', headers: { ...headers, origin: 'https://other.test' } })).statusCode).toBe(403);
      const logout = await send({ method: 'POST', url: '/v1/owner/logout', headers });
      expect(logout.statusCode).toBe(200); expect(String(logout.headers['set-cookie'])).toBe(`${cookieName}=; Path=/;${secure ? ' Secure;' : ''} HttpOnly; SameSite=Strict; Max-Age=0`);
      expect((await send({ method: 'GET', url: '/v1/owner/session', headers })).statusCode).toBe(401);
      const expired = await access.login(password);
      await db.pool.query("UPDATE owner_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.session_id]);
      expect((await send({ method: 'GET', url: '/v1/owner/session', headers: { authorization: `Bearer ${expired.token}` } })).statusCode).toBe(401);
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
