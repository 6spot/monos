import { afterEach, expect, it, vi } from 'vitest';
import type { TaskOverview, TaskPreviewCommand, TaskPreviewStatus } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { readTask, readTaskPreview, recoverTaskPreview, submitTaskPreview } from './task-preview-api.ts';

afterEach(() => vi.unstubAllGlobals());
const command: TaskPreviewCommand = { schema_version: 1, request_id: 'request-a', todo_id: 'todo-a', name: 'confirm_task_preview', payload: { proposal_message_id: 'proposal-a', project_id: 'project-a', content_digest: 'a'.repeat(64) } };
const receipt = { schema_version: 1, request_id: command.request_id, todo_id: command.todo_id, proposal_message_id: command.payload.proposal_message_id,
  status: 'committed', outcome: 'confirmed', confirmation_id: 'confirmation-a', content_digest: command.payload.content_digest };
const task: TaskOverview = { schema_version: 1, task_id: 'task-a', todo_id: 'todo-a', project_id: 'project-a', title: 'Exact title', specification: '# Current\n', initial_specification_id: 'initial-a', specification_id: 'current-b', control_version: 2, state: 'PLANNING', nodes: { pending: 0, running: 0, completed: 0, blocked: 0, cancelled: 0 }, held_attempts: 0, queued_attempts: 0, open_operations: 0, event_cursor: 'cursor-a' };
const preview: TaskPreviewStatus = { schema_version: 1, todo_id: 'todo-a', proposal_message_id: 'proposal-a', preview: { title: 'Exact title', specification: '# Initial\n' }, source_message_id: 'source-a', source_watermark: 1, project_context_version: 0, state: 'eligible', selected_project_id: 'project-a', content_digest: 'a'.repeat(64) };

it('validates exact request, proposal, Todo, digest and outcome before consuming confirmation', async () => {
  for (const response of [{ ...receipt, request_id: 'other' }, { ...receipt, todo_id: 'other' }, { ...receipt, proposal_message_id: 'other' }, { ...receipt, content_digest: 'b'.repeat(64) }, { ...receipt, confirmation_id: undefined }, { ...receipt, outcome: 'cancelled' }]) {
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(submitTaskPreview(command)).rejects.toBeInstanceOf(UncertainError);
  }
  vi.stubGlobal('fetch', async () => Response.json({ ...receipt, outcome: 'created', task_id: 'task-a', specification_id: 'initial-a' }));
  await expect(submitTaskPreview(command)).resolves.toMatchObject({ outcome: 'created', task_id: 'task-a' });
});

it('only accepts a created outcome for create and a cancelled outcome for cancellation', async () => {
  vi.stubGlobal('fetch', async () => Response.json(receipt));
  for (const name of ['create_execution_task', 'cancel_task_preview'] as const) await expect(submitTaskPreview({ ...command, name })).rejects.toBeInstanceOf(UncertainError);
  const create: TaskPreviewCommand = { ...command, name: 'create_execution_task', payload: { proposal_message_id: 'proposal-a', content_digest: command.payload.content_digest, confirmation_id: 'confirmation-a' } };
  vi.stubGlobal('fetch', async () => Response.json({ ...receipt, outcome: 'created', task_id: 'task-a', specification_id: 'initial-a', confirmation_id: 'wrong-confirmation' }));
  await expect(submitTaskPreview(create)).rejects.toBeInstanceOf(UncertainError);
});

it('recovers the original envelope and replays only after authoritative unknown', async () => {
  const calls: { body?: string }[] = [];
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => { calls.push({ body: init.body?.toString() }); return Response.json(init.body ? receipt : { schema_version: 1, request_id: command.request_id, status: 'unknown' }); });
  await expect(recoverTaskPreview(command)).resolves.toEqual(receipt);
  expect(calls).toEqual([{ body: undefined }, { body: JSON.stringify(command) }]);
  calls.length = 0;
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => { calls.push({ body: init.body?.toString() }); return Response.json(receipt); });
  await expect(recoverTaskPreview(command)).resolves.toEqual(receipt); expect(calls).toHaveLength(1);
});

it('retains pending identity for malformed, mismatched and unavailable receipt reads', async () => {
  for (const response of [{ invalid: true }, { schema_version: 1, request_id: 'other', status: 'unknown' }, { ...receipt, proposal_message_id: 'other' }]) {
    const fetch = vi.fn(async () => Response.json(response)); vi.stubGlobal('fetch', fetch);
    await expect(recoverTaskPreview(command)).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
  }
  vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
  await expect(recoverTaskPreview(command)).rejects.toBeInstanceOf(UncertainError);
  vi.stubGlobal('fetch', async () => Response.json({ schema_version: 1, status: 'error', error: { code: 'unauthorized', message: 'Sign in again' } }, { status: 401 }));
  await expect(recoverTaskPreview(command)).rejects.toMatchObject({ code: 'unauthorized' });
});

it('rejects cross-scope preview reads but restores canonical created Project despite stale selection', async () => {
  for (const response of [{ ...preview, todo_id: 'other' }, { ...preview, proposal_message_id: 'other' }, { ...preview, selected_project_id: 'other' }]) {
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(readTaskPreview('todo-a', 'proposal-a', 'project-a')).rejects.toBeInstanceOf(APIError);
  }
  vi.stubGlobal('fetch', async () => Response.json({ ...preview, state: 'created', confirmation_id: 'confirmation-a', task }));
  await expect(readTaskPreview('todo-a', 'proposal-a', 'stale-project')).resolves.toMatchObject({ selected_project_id: 'project-a', task });
  vi.stubGlobal('fetch', async () => Response.json({ ...preview, state: 'cancelled', selected_project_id: undefined, content_digest: undefined }));
  await expect(readTaskPreview('todo-a', 'proposal-a', 'previous-selection')).resolves.toMatchObject({ state: 'cancelled' });
});

it('validates Task identity and preserves current Markdown and missing legacy content without coercion', async () => {
  vi.stubGlobal('fetch', async () => Response.json(task));
  await expect(readTask('task-a')).resolves.toMatchObject({ specification_id: 'current-b', initial_specification_id: 'initial-a', specification: '# Current\n' });
  await expect(readTask('other')).rejects.toBeInstanceOf(APIError);
  vi.stubGlobal('fetch', async () => Response.json({ ...task, specification: undefined }));
  expect((await readTask('task-a')).specification).toBeUndefined();
});
