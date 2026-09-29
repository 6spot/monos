import type { TaskOverview, TaskPreviewCommand, TaskPreviewCommandResult, TaskPreviewStatus } from '../../../../packages/protocol/generated/types.ts';
import { APIError, request, UncertainError } from './api.ts';

function committed(command: TaskPreviewCommand, result: TaskPreviewCommandResult) {
  if (result.request_id !== command.request_id || result.status !== 'committed' || result.todo_id !== command.todo_id
      || result.proposal_message_id !== command.payload.proposal_message_id) throw new UncertainError();
  if (command.name === 'cancel_task_preview') {
    if (result.outcome !== 'cancelled') throw new UncertainError();
  } else {
    if (result.content_digest !== command.payload.content_digest) throw new UncertainError();
    if (command.name === 'create_execution_task' && result.confirmation_id !== command.payload.confirmation_id) throw new UncertainError();
    if (result.outcome === 'created') {
      if (!result.task_id || !result.specification_id) throw new UncertainError();
    } else if (command.name !== 'confirm_task_preview' || result.outcome !== 'confirmed' || !result.confirmation_id) throw new UncertainError();
  }
  return result;
}

export async function submitTaskPreview(command: TaskPreviewCommand): Promise<TaskPreviewCommandResult> {
  return committed(command, await request('/v1/owner/task-previews/commands', 'TaskPreviewCommandResult', command));
}

export async function recoverTaskPreview(command: TaskPreviewCommand): Promise<TaskPreviewCommandResult> {
  let result: TaskPreviewCommandResult;
  try { result = await request(`/v1/owner/task-previews/commands/${encodeURIComponent(command.request_id)}`, 'TaskPreviewCommandResult'); }
  catch (error) {
    if (error instanceof APIError && error.code === 'unauthorized') throw error;
    throw new UncertainError();
  }
  if (result.request_id !== command.request_id) throw new UncertainError();
  return result.status === 'unknown' ? submitTaskPreview(command) : committed(command, result);
}

export async function readTaskPreview(todoId: string, proposalId: string, projectId?: string): Promise<TaskPreviewStatus> {
  const query = projectId ? `?${new URLSearchParams({ project_id: projectId })}` : '';
  const status = await request<TaskPreviewStatus>(`/v1/owner/todos/${encodeURIComponent(todoId)}/task-previews/${encodeURIComponent(proposalId)}${query}`, 'TaskPreviewStatus');
  if (status.todo_id !== todoId || status.proposal_message_id !== proposalId
      || (!['created', 'cancelled'].includes(status.state) && projectId && status.selected_project_id !== projectId)
      || (status.state === 'eligible' && (!status.content_digest || !status.selected_project_id))
      || (status.state === 'created' && (!status.task || status.task.todo_id !== todoId || status.task.project_id !== status.selected_project_id))) {
    throw new APIError('invalid_response', 'The Task preview could not be read safely. Refresh and retry.');
  }
  return status;
}

export async function readTask(taskId: string): Promise<TaskOverview> {
  const task = await request<TaskOverview>(`/v1/owner/tasks/${encodeURIComponent(taskId)}`, 'TaskOverview');
  if (task.task_id !== taskId) throw new APIError('invalid_response', 'The Task response belongs to another Task.');
  return task;
}
