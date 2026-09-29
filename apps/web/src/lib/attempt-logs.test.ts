import { afterEach, expect, it, vi } from 'vitest';
import { readAttemptLogPage } from './attempt-logs.ts';
import type { AttemptLogPage } from '../../../../packages/protocol/generated/types.ts';

afterEach(() => vi.unstubAllGlobals());

it('replays an unacknowledged browser page and resumes after reconnect from the acknowledged cursor', async () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const calls: string[] = [];
  const response = (cursor: string, text: string): AttemptLogPage => ({ schema_version: 1, task_id: 'task', attempt_id: 'attempt',
    events: [{ attempt_id: 'attempt', dispatch_id: 'dispatch', stream_id: 'stdout', sequence: 1, order_sequence: 1, kind: 'output', text }],
    cursor, has_more: false, gap_after: 0 });
  vi.stubGlobal('fetch', async (path: string) => { calls.push(path); return Response.json(path.includes('cursor=') ? response('cursor2', 'second') : response('cursor1', 'first')); });
  const first = await readAttemptLogPage('task', 'attempt', storage);
  expect(first.page.events[0]?.text).toBe('first');
  expect((await readAttemptLogPage('task', 'attempt', storage)).page.events[0]?.text).toBe('first');
  first.acknowledge();
  const afterReload = await readAttemptLogPage('task', 'attempt', storage);
  expect(afterReload.page.events[0]?.text).toBe('second');
  expect(calls[2]).toContain('cursor=cursor1');
  afterReload.acknowledge();
  expect([...saved.values()]).toEqual(['cursor2']);
});
