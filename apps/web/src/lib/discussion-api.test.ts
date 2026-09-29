import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionCommand } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { readDiscussion, readDiscussionPage, recoverDiscussion, submitDiscussion } from './discussion-api.ts';

afterEach(() => vi.unstubAllGlobals());
const command: DiscussionCommand = { schema_version: 1, request_id: 'request-a', todo_id: 'todo-a', name: 'submit_discussion_message', payload: { message_id: 'message-a', content: ' Exact source\n' } };
const receipt = { schema_version: 1, request_id: command.request_id, todo_id: command.todo_id, message_id: command.payload.message_id, status: 'committed', discussion_version: 1 };

it('checks immutable request, Todo and submitted message identities before acknowledging a save', async () => {
  for (const response of [{ ...receipt, request_id: 'other' }, { ...receipt, todo_id: 'other' }, { ...receipt, message_id: 'other' }]) {
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(submitDiscussion(command)).rejects.toBeInstanceOf(UncertainError);
  }
});

it('replays the exact command only after an authoritative unknown receipt', async () => {
  const calls: { path: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, body: init.body?.toString() }); return Response.json(init.body ? receipt : { schema_version: 1, request_id: command.request_id, status: 'unknown' }); });
  await expect(recoverDiscussion(command)).resolves.toEqual(receipt);
  expect(calls).toHaveLength(2); expect(calls[1]?.body).toBe(JSON.stringify(command));
  calls.length = 0;
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, body: init.body?.toString() }); return Response.json(receipt); });
  await expect(recoverDiscussion(command)).resolves.toEqual(receipt); expect(calls).toHaveLength(1);
});

it('retains uncertainty on unavailable, malformed and mismatched lookup results', async () => {
  for (const response of [{ invalid: true }, { schema_version: 1, request_id: 'other', status: 'unknown' }, { ...receipt, todo_id: 'other' }]) {
    const fetch = vi.fn(async () => Response.json(response)); vi.stubGlobal('fetch', fetch);
    await expect(recoverDiscussion(command)).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
  }
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  await expect(recoverDiscussion(command)).rejects.toBeInstanceOf(UncertainError);
});

it('preserves definitive authentication/version failures and uncertain server failures', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unauthorized', message: 'Sign in again' } }, { status: 401 }));
  await expect(recoverDiscussion(command)).rejects.toBeInstanceOf(APIError);
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'version_conflict', message: 'Discussion changed' } }, { status: 409 }));
  await expect(submitDiscussion(command)).rejects.toMatchObject({ code: 'version_conflict' });
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unmet_precondition', message: 'Unavailable' } }, { status: 503 }));
  await expect(submitDiscussion(command)).rejects.toBeInstanceOf(UncertainError);
});

it('rejects cross-Todo status/history and nonadvancing or duplicated page content', async () => {
  const status = { schema_version: 1, todo_id: 'other', discussion_version: 1, resolved_watermark: 0, latest_sequence: 0, project_context_version: 1, project_context_digest: 'a'.repeat(64) };
  vi.stubGlobal('fetch', async () => Response.json(status));
  await expect(readDiscussion('todo-a')).rejects.toBeInstanceOf(APIError);
  const message = { message_id: 'one', sequence: 1, author: 'owner', content: 'Message', created_at: '2026-09-30T00:00:00.000Z' };
  const page = { schema_version: 1, todo_id: 'todo-a', cursor: 'next', has_more: false, messages: [message] };
  for (const invalid of [{ ...page, todo_id: 'other' }, { ...page, has_more: true, messages: [] }, { ...page, has_more: true, cursor: 'previous' }, { ...page, messages: [message, message] }]) {
    vi.stubGlobal('fetch', async () => Response.json(invalid));
    await expect(readDiscussionPage('todo-a', 'previous')).rejects.toBeInstanceOf(APIError);
  }
});
