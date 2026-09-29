import type { TodoCommand, TodoCommandResult, TodoRecord } from '../../../../packages/protocol/generated/types.ts';
import { APIError, request, UncertainError } from './api.ts';

function committed(command: TodoCommand, result: TodoCommandResult): TodoRecord {
  if (result.request_id !== command.request_id || result.status !== 'committed' || result.todo?.todo_id !== command.payload.todo_id) throw new UncertainError();
  return result.todo;
}

export async function submitTodo(command: TodoCommand): Promise<TodoRecord> {
  return committed(command, await request<TodoCommandResult>('/v1/owner/todos/commands', 'TodoCommandResult', command));
}

export async function recoverTodo(command: TodoCommand): Promise<TodoRecord> {
  let result: TodoCommandResult;
  try { result = await request<TodoCommandResult>(`/v1/owner/todos/commands/${encodeURIComponent(command.request_id)}`, 'TodoCommandResult'); }
  catch (error) {
    if (error instanceof APIError && error.code === 'unauthorized') throw error;
    throw new UncertainError();
  }
  if (result.request_id !== command.request_id) throw new UncertainError();
  return result.status === 'unknown' ? submitTodo(command) : committed(command, result);
}
