import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { expect, it, vi } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import { createApp } from '../src/app.ts';
import { BoundaryService } from '../src/service.ts';

it('serves only the shell and hashed assets with separate cache rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'monos-web-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>monos</title>');
  await writeFile(join(root, 'assets/app-hash.js'), 'export const ready = true;');
  const db = database('postgres://unused:unused@127.0.0.1:1/unused');
  const app = createApp(new BoundaryService(db, { signingKey: 'test-only-signing-key-never-for-deployment' }), undefined, root);
  try {
    const shell = await app.inject('/');
    expect(shell.statusCode).toBe(200); expect(shell.headers['cache-control']).toBe('no-store');
    expect(shell.headers['content-type']).toContain('text/html');
    const asset = await app.inject('/assets/app-hash.js');
    expect(asset.statusCode).toBe(200); expect(asset.headers['cache-control']).toContain('immutable');
    expect(asset.headers['content-type']).toContain('javascript');
    for (const path of ['/assets/%2e%2e/index.html', '/assets/.env', '/src/main.tsx', '/v1/unknown']) {
      expect([403, 404]).toContain((await app.inject(path)).statusCode);
    }
    expect((await app.inject('/v1/owner/configuration')).statusCode).toBe(401);
  } finally { await app.close(); await db.pool.end(); await rm(root, { recursive: true, force: true }); }
});

it('rejects malformed, oversized and unsupported HTTP bodies without an internal-error result', async () => {
  // These fail before admission; there is deliberately no live database here.
  const db = database('postgres://unused:unused@127.0.0.1:1/unused');
  const app = createApp(new BoundaryService(db, { signingKey: 'test-only-signing-key-never-for-deployment' }));
  try {
    for (const [contentType, payload] of [['application/json', '{'], ['application/json', JSON.stringify('x'.repeat(MAX_BODY_BYTES))], ['application/octet-stream', 'body']]) {
      const response = await app.inject({ method: 'POST', url: '/v1/commands', headers: { 'content-type': contentType! }, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    }
  } finally { await app.close(); await db.pool.end(); }
});

it('bounds and sanitizes repository-access responses with no-store even before the handler runs', async () => {
  const db = database('postgres://unused:unused@127.0.0.1:1/unused');
  const service = new BoundaryService(db, { signingKey: 'test-only-signing-key-never-for-deployment' });
  const auth = vi.spyOn(service, 'authenticateRunner').mockResolvedValue('runner');
  const access = vi.spyOn(service, 'repositoryAccess').mockRejectedValue(new CommandError('unmet_precondition', 'credentials_missing: synthetic-secret'));
  const app = createApp(service), url = '/v1/runner/operations/open/repository-access';
  const payload = { schema_version: 1, incarnation: 1, workspace_digest: 'a'.repeat(64) };
  try {
    const missing = await app.inject({ method: 'POST', url, payload });
    expect(missing.statusCode).toBe(401); expect(missing.json()).toEqual({ schema_version: 1, reason: 'ownership_unresolved' });
    expect(auth).not.toHaveBeenCalled(); expect(access).not.toHaveBeenCalled();
    const denied = await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer fixture-token' }, payload });
    expect(auth).toHaveBeenCalledWith('fixture-token'); expect(access).toHaveBeenCalledWith('runner', 'open', payload);
    expect(denied.statusCode).toBe(409); expect(denied.json()).toEqual({ schema_version: 1, reason: 'credentials_missing' });
    for (const response of [missing, denied,
      await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{' }),
      await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: JSON.stringify('x'.repeat(4096)) }),
    ]) {
      expect(response.headers['cache-control']).toBe('no-store'); expect(response.body).not.toContain('synthetic-secret');
      expect(Object.keys(response.json()).sort()).toEqual(['reason', 'schema_version']);
    }
    access.mockRejectedValueOnce(new Error('synthetic-secret'));
    const internal = await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer fixture-token' }, payload });
    expect(internal.statusCode).toBe(500); expect(internal.json()).toEqual({ schema_version: 1, reason: 'ownership_unresolved' });
    expect(internal.headers['cache-control']).toBe('no-store');
  } finally { await app.close(); await db.pool.end(); }
});

it('bounds queued Runner frames and disconnects before a stalled request finishes', async () => {
  const db = database('postgres://unused:unused@127.0.0.1:1/unused');
  const service = new BoundaryService(db, { signingKey: 'test-only-signing-key-never-for-deployment' });
  vi.spyOn(service, 'authenticateRunner').mockResolvedValue('runner-test');
  vi.spyOn(service, 'connect').mockResolvedValue(1);
  vi.spyOn(service, 'pending').mockResolvedValue([]);
  const disconnect = vi.spyOn(service, 'disconnect').mockResolvedValue();
  let release!: () => void;
  const stalled = new Promise<void>((resolve) => { release = resolve; });
  const touch = vi.spyOn(service, 'touch').mockImplementation(() => stalled);
  const app = createApp(service);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`, { headers: { authorization: 'Bearer fixture-only' } });
  socket.on('error', () => undefined);
  try {
    await once(socket, 'open');
    const welcome = once(socket, 'message');
    socket.send(JSON.stringify({ schema_version: 1, type: 'hello', runner_id: 'runner-test', boot_id: 'boot-test' }));
    await welcome;
    socket.send(JSON.stringify({ schema_version: 1, type: 'ready', incarnation: 1, log_modes: ['ordered_v1'] }));
    await expect.poll(() => touch.mock.calls.length).toBe(1);
    const closed = once(socket, 'close');
    for (let index = 0; index < 70; index++) socket.send(JSON.stringify({ schema_version: 1, type: 'heartbeat', incarnation: 1 }));
    expect((await closed)[0]).toBe(4008);
    await expect.poll(() => disconnect.mock.calls.length).toBe(1);
    release();
    await expect.poll(() => disconnect.mock.calls.length).toBe(2);
    expect(touch).toHaveBeenCalledTimes(1);
  } finally { release(); socket.terminate(); await app.close(); await db.pool.end(); }
});

it('does not mark a legacy Runner ready for ordered-log dispatches', async () => {
  const db = database('postgres://unused:unused@127.0.0.1:1/unused');
  const service = new BoundaryService(db, { signingKey: 'test-only-signing-key-never-for-deployment' });
  vi.spyOn(service, 'authenticateRunner').mockResolvedValue('runner-test');
  vi.spyOn(service, 'connect').mockResolvedValue(1);
  vi.spyOn(service, 'pending').mockResolvedValue([]);
  vi.spyOn(service, 'disconnect').mockResolvedValue();
  const touch = vi.spyOn(service, 'touch').mockResolvedValue();
  const app = createApp(service);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`, { headers: { authorization: 'Bearer fixture-only' } });
  socket.on('error', () => undefined);
  try {
    await once(socket, 'open');
    const welcome = once(socket, 'message');
    socket.send(JSON.stringify({ schema_version: 1, type: 'hello', runner_id: 'runner-test', boot_id: 'boot-test' }));
    await welcome;
    const answer = once(socket, 'message');
    socket.send(JSON.stringify({ schema_version: 1, type: 'ready', incarnation: 1 }));
    const frame = JSON.parse((await answer)[0].toString());
    expect(frame).toMatchObject({ type: 'error', error: { code: 'unmet_precondition' } });
    expect(touch).not.toHaveBeenCalled();
  } finally { socket.terminate(); await app.close(); await db.pool.end(); }
});
