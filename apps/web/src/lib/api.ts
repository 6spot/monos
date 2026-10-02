import { validate } from '../../../../packages/protocol/src/validation.ts';
import type { CommandResult, ConfigurationCommand, ConfigurationResult, OwnerCommand, OwnerCommandResult, OwnerOperationStatus } from '../../../../packages/protocol/generated/types.ts';

export class APIError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export class UncertainError extends Error {
  constructor() { super('The response was interrupted. Check the result before making another change.'); }
}
export async function request<T>(path: string, schema: string, body?: unknown, sessionId?: string): Promise<T> {
  let response: Response; let raw: unknown;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(sessionId ? { 'X-Monos-Session': sessionId } : {}) },
      ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    raw = await response.json();
  } catch { throw body === undefined ? new APIError('unavailable', 'Unable to reach monos. Check your connection and retry.') : new UncertainError(); }
  if (!response.ok) {
    let result: CommandResult;
    try { result = validate('CommandResult', raw); } catch { throw body === undefined ? new APIError('invalid_response', 'The server returned an incompatible response.') : new UncertainError(); }
    if (response.status >= 500 && body !== undefined) throw new UncertainError();
    throw new APIError(result.error?.code ?? 'invalid_response', result.error?.message ?? 'The request could not be completed.');
  }
  try { return validate<T>(schema, raw); } catch { throw body === undefined ? new APIError('invalid_response', 'The server returned an incompatible response. Refresh after updating monos.') : new UncertainError(); }
}

export async function submit(command: ConfigurationCommand): Promise<ConfigurationResult> {
  const response = await request<ConfigurationResult>('/v1/owner/configuration/commands', 'ConfigurationResult', command);
  if (response.status !== 'committed' || response.request_id !== command.request_id || response.control_version === undefined) throw new UncertainError();
  return response;
}
export async function recover(command: ConfigurationCommand): Promise<ConfigurationResult> {
  let receipt: ConfigurationResult;
  try { receipt = await request<ConfigurationResult>(`/v1/owner/configuration/commands/${command.request_id}`, 'ConfigurationResult'); }
  catch (error) {
    if (error instanceof APIError && error.code === 'unauthorized') throw error;
    throw new UncertainError();
  }
  if (receipt.request_id !== command.request_id) throw new UncertainError();
  if (receipt.status === 'unknown') return submit(command);
  if (receipt.control_version === undefined) throw new UncertainError();
  return receipt;
}
export async function submitOwnerExecution(command: OwnerCommand): Promise<OwnerCommandResult> {
  const result = await request<OwnerCommandResult>('/v1/owner/commands', 'OwnerCommandResult', command);
  if (result.request_id !== command.request_id || result.status === 'unknown') throw new UncertainError();
  return result;
}
export async function recoverOwnerExecution(command: OwnerCommand): Promise<OwnerCommandResult> {
  let result: OwnerCommandResult;
  try { result = await request<OwnerCommandResult>(`/v1/owner/scopes/${command.scope_id}/commands/${command.request_id}`, 'OwnerCommandResult'); }
  catch (error) {
    if (error instanceof APIError && error.code === 'unauthorized') throw error;
    throw new UncertainError();
  }
  if (result.request_id !== command.request_id) throw new UncertainError();
  return result.status === 'unknown' ? submitOwnerExecution(command) : result;
}
export function ownerOperation(taskId: string, operationId: string): Promise<OwnerOperationStatus> {
  return request<OwnerOperationStatus>(`/v1/owner/tasks/${taskId}/operations/${operationId}`, 'OwnerOperationStatus');
}
export async function logout(): Promise<void> {
  let response: Response;
  try { response = await fetch('/v1/owner/logout', { method: 'POST', credentials: 'same-origin' }); }
  catch { throw new APIError('unavailable', 'Sign out could not be confirmed. Retry when connected.'); }
  if (!response.ok) throw new APIError('unavailable', 'Sign out could not be confirmed. Please retry.');
}
