import { afterEach, expect, it, vi } from 'vitest';
import { APIError, UncertainError } from './api.ts';
import { recoverTaskIntent, submitTaskIntent, validateTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';

afterEach(() => vi.unstubAllGlobals());
const intent: TaskIntent = { family: 'specification', command: { schema_version: 1, request_id: 'request-a', task_id: 'task-a', name: 'confirm_specification', payload: { proposal_id: 'proposal-a', content_digest: 'a'.repeat(64) } } };
const receipt = { schema_version: 1, request_id: 'request-a', status: 'committed', proposal_id: 'proposal-a', content_digest: 'a'.repeat(64), confirmation_id: 'confirmation-a' };

it('recovers exact Task commands under a session-bound request and only replays authoritative unknown', async () => {
  const calls: { path: string; body?: string; headers: unknown }[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    calls.push({ path, body: init.body?.toString(), headers: init.headers });
    return Response.json(init.body ? receipt : { schema_version: 1, request_id: 'request-a', status: 'unknown' });
  });
  await expect(recoverTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
  expect(calls.map((item) => item.path)).toEqual(['/v1/owner/tasks/task-a/specification/commands/request-a', '/v1/owner/tasks/specification/commands']);
  expect(calls.map((item) => item.body)).toEqual([undefined, JSON.stringify(intent.command)]);
  expect(calls.every((item) => (item.headers as Record<string, string>)['X-Monos-Session'] === 'session-a')).toBe(true);
});

it('keeps uncertainty after invalid, cross-request or changed exact proposal receipts without replay', async () => {
  for (const value of [{ invalid: true }, { ...receipt, request_id: 'other' }, { ...receipt, proposal_id: 'other' }, { ...receipt, content_digest: 'b'.repeat(64) }, { ...receipt, confirmation_id: undefined }]) {
    const fetch = vi.fn(async () => Response.json(value)); vi.stubGlobal('fetch', fetch);
    await expect(recoverTaskIntent(intent, 'session-a')).rejects.toBeInstanceOf(UncertainError);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('propagates authoritative session rejection without replaying under a replacement session', async () => {
  const fetch = vi.fn(async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unauthorized', message: 'Session changed' } }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(recoverTaskIntent(intent, 'session-a')).rejects.toBeInstanceOf(APIError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not require nonexistent Task fields on Specification/Replan receipts', async () => {
  vi.stubGlobal('fetch', async () => Response.json(receipt));
  await expect(submitTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
  const graphReceipt = { ...receipt, replan_request_id: 'replan-a' };
  vi.stubGlobal('fetch', async () => Response.json(graphReceipt));
  await expect(submitTaskIntent({ family: 'replan', command: { ...intent.command, name: 'confirm_replan' } }, 'session-a')).resolves.toEqual(graphReceipt);
});

it('rejects Conversation success from a different Task or message identity', async () => {
  const message: TaskIntent = { family: 'conversation', command: { schema_version: 1, request_id: 'request-a', task_id: 'task-a', name: 'submit_task_message', payload: { message_id: 'message-a', content: 'Question' } } };
  for (const response of [{ task_id: 'other', message_id: 'message-a' }, { task_id: 'task-a', message_id: 'other' }]) {
    vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, request_id: 'request-a', status: 'committed', ...response }));
    await expect(submitTaskIntent(message, 'session-a')).rejects.toBeInstanceOf(UncertainError);
  }
});

it('does not admit arbitrary endpoints, configuration commands or credentials into Task recovery', () => {
  expect(() => validateTaskIntent({ ...intent, url: '/v1/owner/configuration/commands' })).toThrow();
  expect(() => validateTaskIntent({ family: 'configuration', command: intent.command })).toThrow();
  expect(() => validateTaskIntent({ family: 'execution', command: { ...intent.command, name: 'save_github', payload: { private_key: 'secret' } } })).toThrow();
});

it('does not replay an unknown Conversation receipt attributed to another Task', async () => {
  const message: TaskIntent = { family: 'conversation', command: { schema_version: 1, request_id: 'request-a', task_id: 'task-a', name: 'submit_task_message', payload: { message_id: 'message-a', content: 'Question' } } };
  const fetch = vi.fn(async () => Response.json({ schema_version: 1, request_id: 'request-a', task_id: 'other-task', status: 'unknown' }));
  vi.stubGlobal('fetch', fetch);
  await expect(recoverTaskIntent(message, 'session-a')).rejects.toBeInstanceOf(UncertainError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not replay a contradictory unknown receipt that also claims an authorization or effect', async () => {
  for (const extra of [{ confirmation_id: 'confirmation-a' }, { operation_id: 'operation-a' }, { proposal_id: 'proposal-a' }]) {
    const fetch = vi.fn(async () => Response.json({ schema_version: 1, request_id: 'request-a', status: 'unknown', ...extra }));
    vi.stubGlobal('fetch', fetch);
    await expect(recoverTaskIntent(intent, 'session-a')).rejects.toBeInstanceOf(UncertainError);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('requires each command’s actual receipt fields before resolving its pending stage', async () => {
  const basis = { control_version: 1, specification_id: 'spec-a', plan_id: 'plan-a' };
  const base = { schema_version: 1 as const, request_id: 'request-a', task_id: 'task-a' };
  const cases: { intent: TaskIntent; good: Record<string, unknown>; required: string[] }[] = [
    { intent: { family: 'specification', command: { ...base, name: 'edit_specification', payload: { proposal_id: 'proposal-a', specification: 'Full edited requirements', summary: 'Explicit Owner edit', basis, impact: { graph_sufficient: true, nodes: [], guidance: [] }, source_input_ids: [] } } }, good: { ...receipt, status: 'admitted', operation_id: 'change-a' }, required: ['proposal_id', 'confirmation_id', 'content_digest', 'operation_id'] },
    { intent: { family: 'specification', command: { ...base, name: 'apply_specification_revision', payload: { proposal_id: 'proposal-a', confirmation_id: 'confirmation-a', basis } } }, good: { schema_version: 1, request_id: 'request-a', status: 'admitted', proposal_id: 'proposal-a', operation_id: 'change-a' }, required: ['proposal_id', 'operation_id'] },
    { intent: { family: 'specification', command: { ...base, name: 'retry_specification', payload: { operation_id: 'change-a', expected_version: 2 } } }, good: { schema_version: 1, request_id: 'request-a', status: 'committed', operation_id: 'change-a' }, required: ['operation_id'] },
    { intent: { family: 'specification', command: { ...base, name: 'withdraw_specification', payload: { proposal_id: 'proposal-a', expected_version: 2 } } }, good: { schema_version: 1, request_id: 'request-a', status: 'committed', proposal_id: 'proposal-a' }, required: ['proposal_id'] },
    { intent: { family: 'replan', command: { ...base, name: 'publish_replan', payload: { proposal_id: 'proposal-a', confirmation_id: 'confirmation-a', basis } } }, good: { schema_version: 1, request_id: 'request-a', status: 'committed', replan_request_id: 'replan-a', proposal_id: 'proposal-a', publication_id: 'publication-a', plan_id: 'new-plan-a', specification_id: 'spec-a' }, required: ['replan_request_id', 'proposal_id', 'publication_id', 'plan_id', 'specification_id'] },
    { intent: { family: 'replan', command: { ...base, name: 'retry_replan', payload: { replan_request_id: 'replan-a', expected_version: 2 } } }, good: { schema_version: 1, request_id: 'request-a', status: 'committed', replan_request_id: 'replan-a' }, required: ['replan_request_id'] },
    { intent: { family: 'conversation', command: { ...base, name: 'submit_task_message', payload: { message_id: 'message-a', content: 'Question' } } }, good: { ...base, status: 'committed', message_id: 'message-a', input_id: 'input-a', version: 1 }, required: ['message_id', 'input_id', 'version'] },
    { intent: { family: 'conversation', command: { ...base, name: 'stop_task_turn', expected_version: 2, payload: { operation_id: 'input-a' } } }, good: { ...base, status: 'committed', input_id: 'input-a', version: 3 }, required: ['input_id', 'version'] },
  ];
  for (const item of cases) {
    vi.stubGlobal('fetch', async () => Response.json(item.good));
    await expect(submitTaskIntent(item.intent, 'session-a')).resolves.toEqual(item.good);
    for (const field of item.required) {
      const missing = { ...item.good }; delete missing[field];
      const fetch = vi.fn(async () => Response.json(missing)); vi.stubGlobal('fetch', fetch);
      await expect(recoverTaskIntent(item.intent, 'session-a')).rejects.toBeInstanceOf(UncertainError);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  }
});

it('keeps exact publication replay compatible with omitted historical joint metadata', async () => {
  const publication: TaskIntent = { family: 'replan', command: { schema_version: 1, request_id: 'request-a', task_id: 'task-a', name: 'publish_replan', payload: { proposal_id: 'proposal-a', confirmation_id: 'confirmation-a', requirement_confirmation_id: 'requirement-auth-a', basis: { control_version: 1, specification_id: 'spec-a', plan_id: 'plan-a' } } } };
  const published = { schema_version: 1, request_id: 'request-a', status: 'committed', proposal_id: 'proposal-a', replan_request_id: 'replan-a', publication_id: 'publication-a', plan_id: 'new-plan-a', specification_id: 'new-spec-a' };
  vi.stubGlobal('fetch', async () => Response.json(published));
  await expect(recoverTaskIntent(publication, 'session-a')).resolves.toEqual(published);
  vi.stubGlobal('fetch', async () => Response.json({ ...published, requirement_confirmation_id: 'foreign-auth' }));
  await expect(recoverTaskIntent(publication, 'session-a')).rejects.toBeInstanceOf(UncertainError);
});
