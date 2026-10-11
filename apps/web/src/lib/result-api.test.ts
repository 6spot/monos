import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { ResultReadIdentity, ResultReadResponse } from '../../../../packages/protocol/generated/types.ts';
import { APIError } from './api.ts';
import { canonicalJSON } from '../../../../packages/protocol/src/index.ts';
import { resultRead } from './task-api.ts';

const identity: ResultReadIdentity = {
  task_id: 'task-a', operation_id: 'operation-a', attempt_id: 'attempt-a', dispatch_id: 'dispatch-a',
  node_id: 'node-a', node_activation: 1, specification_id: 'spec-a', plan_id: 'plan-a',
  manifest_digest: 'a'.repeat(64), operation_identity_digest: 'b'.repeat(64), workspace_id: 'workspace-a',
  resource_id: 'resource-a', runner_id: 'runner-a', generation: 1, storage_id: 'storage-a', lease_id: 'lease-a',
  capture: { node_tree: 'c'.repeat(40), start_commit: 'a'.repeat(40), node_commit: 'b'.repeat(40) },
  repository_identity: 'example/repository', base_commit: 'a'.repeat(40), git_commit: 'b'.repeat(40), git_tree: 'c'.repeat(40),
};
const digest = createHash('sha256').update(canonicalJSON(identity)).digest('hex');
const path = 'src/literal: name\n文件.txt';
const value = (): ResultReadResponse => ({ schema_version: 1, current: true, status: 'available', request: { identity, identity_digest: digest, mode: 'file', path, side: 'base' }, object: { oid: 'd'.repeat(40), mode: '100644', size: 0 }, text: '' });
afterEach(() => vi.unstubAllGlobals());

it('verifies exact result identities on HTTP without SubtleCrypto and still rejects tampered identity fields', async () => {
  vi.stubGlobal('crypto', {});
  vi.stubGlobal('fetch', async () => Response.json(value()));
  await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a')).resolves.toMatchObject({ status: 'available' });
  vi.stubGlobal('fetch', async () => Response.json({ ...value(), request: { ...value().request, identity: { ...identity, storage_id: 'other-storage' } } }));
  await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a')).rejects.toMatchObject({ code: 'invalid_response' });
});

it('encodes the exact literal path/side/digest and carries session and AbortSignal; empty file remains available', async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async () => Response.json(value())); vi.stubGlobal('fetch', fetch);
  await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a', controller.signal)).resolves.toMatchObject({ status: 'available', text: '' });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const parsed = new URL(url, 'https://monos.test');
  expect(parsed.pathname).toBe('/v1/owner/tasks/task-a/results/operation-a/file');
  expect(Object.fromEntries(parsed.searchParams)).toEqual({ resource_id: 'resource-a', identity_digest: digest, path, side: 'base' });
  expect(new Headers(init.headers).get('X-Monos-Session')).toBe('session-a');
  expect(init.signal).toBe(controller.signal); expect(init.cache).toBe('no-store'); expect(init.method).toBeUndefined();
});

it('rejects late/crossed Task, operation, path, side, digest and missing fresh applicability replies', async () => {
  const wrong = [
    { ...value(), current: undefined },
    { ...value(), request: { ...value().request, identity: { ...identity, capture: { ...identity.capture, node_commit: 'f'.repeat(40) } } } },
    { ...value(), request: { ...value().request, path: 'other.txt' } },
    { ...value(), request: { ...value().request, side: 'result' } },
    { ...value(), request: { ...value().request, identity_digest: 'e'.repeat(64) } },
    ...['task_id', 'operation_id', 'resource_id', 'git_commit', 'storage_id'].map(field => ({ ...value(), request: { ...value().request, identity: { ...identity, [field]: field === 'git_commit' ? 'e'.repeat(40) : 'other' } } })),
  ];
  for (const response of wrong) {
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});

it('validates mode-specific query fields before sending a read, including traversal and required side', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const params of [{ path: '../secret', side: 'base' as const }, { path }, { path, side: 'base' as const, cursor: 'wrong-mode' }]) {
    await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', params, 'session-a')).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('fences an already-cancelled response even when a transport ignores abort', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', async () => { controller.abort(); return Response.json(value()); });
  await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('preserves truthful binary/oversized/absent statuses without accepting forbidden bytes or malformed text', async () => {
  for (const status of ['binary', 'oversized', 'absent'] as const) {
    const response = { ...value(), status, text: undefined, ...(status === 'absent' ? { object: undefined } : {}) };
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a')).resolves.toMatchObject({ status });
    vi.stubGlobal('fetch', async () => Response.json({ ...response, text: 'unverified bytes' }));
    await expect(resultRead('task-a', 'operation-a', 'resource-a', digest, 'file', { path, side: 'base' }, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});
