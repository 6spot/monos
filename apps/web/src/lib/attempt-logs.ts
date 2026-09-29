import type { AttemptLogPage } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError, request } from './api.ts';

// A browser may acknowledge a page only after it has rendered or retained it.
// A failed request or reload before acknowledgement replays the same page.
export async function readAttemptLogPage(taskId: string, attemptId: string, storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage): Promise<{ page: AttemptLogPage; acknowledge: () => void }> {
  validate('Id', taskId); validate('Id', attemptId);
  const key = `monos:attempt-log:v1:${taskId}:${attemptId}`;
  const saved = storage.getItem(key);
  if (saved !== null) validate('AttemptLogCursor', saved);
  const path = `/v1/owner/tasks/${encodeURIComponent(taskId)}/attempts/${encodeURIComponent(attemptId)}/logs${saved ? `?cursor=${encodeURIComponent(saved)}` : ''}`;
  const page = await request<AttemptLogPage>(path, 'AttemptLogPage');
  if (page.task_id !== taskId || page.attempt_id !== attemptId) throw new APIError('invalid_response', 'The server returned logs for another Attempt.');
  return { page, acknowledge: () => storage.setItem(key, page.cursor) };
}
