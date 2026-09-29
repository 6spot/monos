import { afterEach, expect, it, vi } from 'vitest';
import type { TodoCommand, TodoRecord } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { recoverTodo, submitTodo } from './todo-api.ts';

afterEach(() => vi.unstubAllGlobals());
const command: TodoCommand = { schema_version: 1, request_id: 'capture-request', name: 'capture_todo', payload: { todo_id: 'idea', original_capture: '  Exact idea\n' } };
const todo: TodoRecord = { schema_version: 1, todo_id: 'idea', original_capture: '  Exact idea\n', label: 'Exact idea', archived: false, control_version: 1, created_at: '2026-09-29T00:00:00.000Z', discussion_activity_at: '2026-09-29T00:00:00.000Z' };
const receipt = { schema_version: 1, request_id: command.request_id, status: 'committed', todo };

it('keeps malformed Todo reads and mismatched commit identities outside the UI', async () => {
  for (const result of [{ ...receipt, request_id: 'other' }, { ...receipt, todo: { ...todo, todo_id: 'other' } }, { ...receipt, todo: { ...todo, original_capture: undefined } }]) {
    vi.stubGlobal('fetch', async () => Response.json(result));
    await expect(submitTodo(command)).rejects.toBeInstanceOf(UncertainError);
  }
});

it('recovers a committed capture with one lookup and replays only an authoritative unknown', async () => {
  const calls: { path: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, body: init.body?.toString() }); return Response.json(receipt); });
  expect(await recoverTodo(command)).toEqual(todo); expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/v1/owner/todos/commands/capture-request');
  calls.length = 0;
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    calls.push({ path, body: init.body?.toString() });
    return Response.json(init.body ? receipt : { schema_version: 1, request_id: command.request_id, status: 'unknown' });
  });
  expect(await recoverTodo(command)).toEqual(todo); expect(calls).toHaveLength(2);
  expect(calls[1]?.body).toBe(JSON.stringify(command));
});

it('retains uncertainty on unavailable, malformed and mismatched receipt reads without replay', async () => {
  for (const result of [{ broken: true }, { schema_version: 1, request_id: 'other', status: 'unknown' }, { ...receipt, todo: undefined }]) {
    const fetch = vi.fn(async () => Response.json(result)); vi.stubGlobal('fetch', fetch);
    await expect(recoverTodo(command)).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
  }
  const fetch = vi.fn(async () => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetch);
  await expect(recoverTodo(command)).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves definitive stale-version errors, authentication and uncertain server errors', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'version_conflict', message: 'Todo changed' } }, { status: 409 }));
  await expect(submitTodo(command)).rejects.toMatchObject({ code: 'version_conflict' });
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unauthorized', message: 'Sign in again' } }, { status: 401 }));
  await expect(recoverTodo(command)).rejects.toBeInstanceOf(APIError);
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unmet_precondition', message: 'Unavailable' } }, { status: 503 }));
  await expect(submitTodo(command)).rejects.toBeInstanceOf(UncertainError);
});
