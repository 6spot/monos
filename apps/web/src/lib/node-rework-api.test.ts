import { afterEach, expect, it, vi } from 'vitest';
import { UncertainError } from './api.ts';
import { recoverTaskIntent, submitTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';
import { validateTaskJournal } from './task-storage.ts';

afterEach(() => vi.unstubAllGlobals());
const intent = (apply: boolean): TaskIntent => ({ family: 'execution', command: {
  schema_version: 1, request_id: 'decision', scope_id: 'task', expected_control_version: 8,
  name: apply ? 'apply_rework' : 'continue_without_rework',
  payload: { rework_request_id: 'rework', expected_version: 1, answer: 'Preserved direction' },
} });
const receipt = (apply: boolean) => ({ schema_version: 1, request_id: 'decision', task_id: 'task', status: 'committed', control_version: 9,
  rework_outcome: { rework_request_id: 'rework', status: apply ? 'applied' : 'continued', version: apply ? 3 : 2,
    target_node_id: 'upstream', affected_node_ids: ['upstream', 'requester'], automatic_requests_used: apply ? 0 : 3, limit: 3 },
});

it.each([true, false])('retains and recovers the exact Rework decision (apply=%s)', async apply => {
  const pending = intent(apply), result = receipt(apply);
  const journal = { version: 1, session_id: 'session', tasks: { task: { drafts: {}, pending: { execution: pending } } } };
  expect(validateTaskJournal(journal, 'session')).toEqual(journal);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(result)); vi.stubGlobal('fetch', fetch);
  await expect(recoverTaskIntent(pending, 'session')).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe('/v1/owner/scopes/task/commands/decision');
});

it.each([true, false])('rejects missing, foreign or conflicting Rework decision outcomes (apply=%s)', async apply => {
  const good = receipt(apply);
  const bad = [undefined, { ...good.rework_outcome, rework_request_id: 'another' },
    { ...good.rework_outcome, status: apply ? 'continued' : 'applied' },
    { ...good.rework_outcome, version: 1 }, { ...good.rework_outcome, automatic_requests_used: apply ? 3 : 0 }];
  for (const rework_outcome of bad) {
    const fetch = vi.fn(async () => Response.json({ ...good, rework_outcome })); vi.stubGlobal('fetch', fetch);
    await expect(recoverTaskIntent(intent(apply), 'session')).rejects.toBeInstanceOf(UncertainError);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('replays authoritative unknown using the saved Rework capability and request ID', async () => {
  const pending = intent(false), calls: RequestInit[] = [];
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
    calls.push(init);
    return Response.json(init.body ? receipt(false) : { schema_version: 1, request_id: 'decision', status: 'unknown' });
  });
  await expect(recoverTaskIntent(pending, 'session')).resolves.toEqual(receipt(false));
  expect(calls.map(x => x.body)).toEqual([undefined, JSON.stringify(pending.command)]);
  await expect(submitTaskIntent(pending, 'session')).resolves.toEqual(receipt(false));
});
