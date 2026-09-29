import type { DiscussionCommand, DiscussionCommandResult, DiscussionPage, DiscussionStatus } from '../../../../packages/protocol/generated/types.ts';
import { APIError, request, UncertainError } from './api.ts';

function committed(command: DiscussionCommand, result: DiscussionCommandResult) {
  if (result.request_id !== command.request_id || result.status !== 'committed' || result.todo_id !== command.todo_id
      || (command.name === 'submit_discussion_message' && result.message_id !== command.payload.message_id)) throw new UncertainError();
  return result;
}

export async function submitDiscussion(command: DiscussionCommand): Promise<DiscussionCommandResult> {
  return committed(command, await request('/v1/owner/todos/discussion/commands', 'DiscussionCommandResult', command));
}

export async function recoverDiscussion(command: DiscussionCommand): Promise<DiscussionCommandResult> {
  let result: DiscussionCommandResult;
  try { result = await request(`/v1/owner/todos/discussion/commands/${encodeURIComponent(command.request_id)}`, 'DiscussionCommandResult'); }
  catch (error) {
    if (error instanceof APIError && error.code === 'unauthorized') throw error;
    throw new UncertainError();
  }
  if (result.request_id !== command.request_id) throw new UncertainError();
  return result.status === 'unknown' ? submitDiscussion(command) : committed(command, result);
}

export async function readDiscussion(todoId: string): Promise<DiscussionStatus> {
  const status = await request<DiscussionStatus>(`/v1/owner/todos/${encodeURIComponent(todoId)}/discussion`, 'DiscussionStatus');
  if (status.todo_id !== todoId) throw new APIError('invalid_response', 'The Discussion response belongs to another Todo.');
  return status;
}

export async function readDiscussionPage(todoId: string, cursor = ''): Promise<DiscussionPage> {
  const page = await request<DiscussionPage>(`/v1/owner/todos/${encodeURIComponent(todoId)}/discussion/messages${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`, 'DiscussionPage');
  if (page.todo_id !== todoId || (page.has_more && (!page.messages.length || page.cursor === cursor))) throw new APIError('invalid_response', 'Discussion history could not be read safely. Refresh and retry.');
  const ids = new Set<string>(); let previous = 0;
  for (const message of page.messages) {
    if (ids.has(message.message_id) || message.sequence <= previous) throw new APIError('invalid_response', 'Discussion history contains conflicting message order.');
    ids.add(message.message_id); previous = message.sequence;
  }
  return page;
}
