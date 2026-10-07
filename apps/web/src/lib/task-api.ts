import type { OwnerCommand, OwnerCommandResult, TaskConversationCommand, TaskConversationCommandResult, TaskSpecificationCommand, TaskSpecificationResult, TaskReplanCommand, TaskReplanResult, ResultReadRequest, ResultReadResponse, PublicationCommand, PublicationCommandResult, RemotePreparationCommand, RemotePreparationCommandResult, OwnerDeliveryCommand, OwnerDeliveryCommandResult, OwnerReviewCommand, OwnerReviewCommandResult } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError, UncertainError, request } from './api.ts';
import { taskStorageEpoch } from './task-storage.ts';

export type TaskIntent =
  | { family: 'execution'; command: OwnerCommand }
  | { family: 'conversation'; command: TaskConversationCommand }
  | { family: 'specification'; command: TaskSpecificationCommand }
  | { family: 'replan'; command: TaskReplanCommand; review_origin?: {feedback_id:string;operation_id:string} }
  | { family: 'publication'; command: PublicationCommand }
  | { family: 'remote-preparation'; command: RemotePreparationCommand }
  | { family: 'delivery'; command: OwnerDeliveryCommand }
  | { family: 'review'; command: OwnerReviewCommand };
export type TaskReceipt = OwnerCommandResult | TaskConversationCommandResult | TaskSpecificationResult | TaskReplanResult | PublicationCommandResult | RemotePreparationCommandResult | OwnerDeliveryCommandResult | OwnerReviewCommandResult;

const families = {
  execution: { command: 'OwnerCommand', result: 'OwnerCommandResult', post: '/v1/owner/commands' },
  conversation: { command: 'TaskConversationCommand', result: 'TaskConversationCommandResult', post: '/v1/owner/tasks/conversation/commands' },
  specification: { command: 'TaskSpecificationCommand', result: 'TaskSpecificationResult', post: '/v1/owner/tasks/specification/commands' },
  replan: { command: 'TaskReplanCommand', result: 'TaskReplanResult', post: '/v1/owner/tasks/replan/commands' },
  publication: { command: 'PublicationCommand', result: 'PublicationCommandResult', post: '/v1/owner/tasks/publication/commands' },
  'remote-preparation': { command: 'RemotePreparationCommand', result: 'RemotePreparationCommandResult', post: '/v1/owner/tasks/remote-preparation/commands' },
  delivery: { command: 'OwnerDeliveryCommand', result: 'OwnerDeliveryCommandResult', post: '/v1/owner/tasks/delivery/commands' },
  review: { command: 'OwnerReviewCommand', result: 'OwnerReviewCommandResult', post: '/v1/owner/tasks/review/commands' },
} as const;

export function intentTask(intent: TaskIntent): string {
  return intent.family === 'execution' ? intent.command.scope_id : intent.command.task_id;
}

export function validateTaskIntent(value: unknown): TaskIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['command,family','command,family,review_origin'].includes(Object.keys(value).sort().join(','))) throw new Error('Invalid Task recovery record');
  const data = value as Record<string, unknown>;
  if (typeof data.family !== 'string' || !Object.hasOwn(families, data.family)) throw new Error('Unknown Task command family');
  const family = data.family as TaskIntent['family'];
  validate(families[family].command, data.command);
  if (Object.hasOwn(data, 'review_origin')) {
    const intent = value as TaskIntent;
    const origin = data.review_origin;
    if (intent.family !== 'replan' || intent.command.name !== 'dismiss_replan' || !origin || typeof origin !== 'object' || Array.isArray(origin) || Object.keys(origin).sort().join(',') !== 'feedback_id,operation_id') throw new Error('Invalid review-origin recovery record');
    validate('Id', intent.review_origin?.feedback_id); validate('Id', intent.review_origin?.operation_id);
  }
  return value as TaskIntent;
}

export async function taskRead<T>(taskId: string, suffix: string, schema: string, query?: Record<string, string | undefined>, sessionId?: string, signal?: AbortSignal): Promise<T> {
  validate('Id', taskId);
  const epoch = taskStorageEpoch();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, value);
  const value = await request<T>(`/v1/owner/tasks/${encodeURIComponent(taskId)}${suffix}${params.size ? `?${params}` : ''}`, schema, undefined, sessionId, signal);
  signal?.throwIfAborted();
  if (epoch !== taskStorageEpoch()) throw new DOMException('Owner session changed', 'AbortError');
  if (value && typeof value === 'object' && 'task_id' in value && value.task_id !== taskId) throw new APIError('invalid_response', 'The server returned another Task.');
  return value;
}

function checkedReceipt(intent: TaskIntent, result: TaskReceipt, allowUnknown: boolean): TaskReceipt {
  if (result.request_id !== intent.command.request_id || (!allowUnknown && result.status === 'unknown')) throw new UncertainError();
  if ('task_id' in result && result.task_id !== undefined && result.task_id !== intentTask(intent)) throw new UncertainError();
  if (['remote-preparation', 'delivery', 'review'].includes(intent.family) && (!('task_id' in result) || result.task_id !== intentTask(intent))) throw new UncertainError();
  if (result.status === 'unknown') {
    if (Object.keys(result).some((key) => !['schema_version', 'request_id', 'task_id', 'status'].includes(key))) throw new UncertainError();
    return result;
  }
  if (['conversation', 'publication'].includes(intent.family) && (!('task_id' in result) || result.task_id !== intentTask(intent))) throw new UncertainError();
  // The shared result schemas permit fields to be absent for other commands.
  // A well-formed but incomplete receipt is still uncertain for this command.
  const fields: Record<string, unknown> = { ...result };
  const payload: Record<string, unknown> = { ...intent.command.payload };
  const requireFields = (...names: string[]) => {
    if (names.some((name) => fields[name] === undefined)) throw new UncertainError();
  };
  const same = (name: string, expected: unknown) => {
    if (fields[name] !== expected) throw new UncertainError();
  };
  if (payload.proposal_id !== undefined && (intent.family !== 'publication' || fields.proposal_id !== undefined)) same('proposal_id', payload.proposal_id);
  if (intent.family === 'review') {
    same('status', 'committed'); same('name', intent.command.name); same('feedback_id', payload.feedback_id);
    requireFields('operation_id', 'operation_version');
    if (intent.command.name === 'request_changes') {
      const basis = intent.command.payload.basis;
      same('review_result_digest', basis?.review_result_digest); same('operation_version', 1);
      const accepted = intent.command.payload.accepted_batch;
      if (accepted) {
        const revoked = 'revoked_batch' in result ? result.revoked_batch : undefined;
        if (!revoked || revoked.operation_id !== accepted.operation_id || revoked.content_digest !== accepted.content_digest || revoked.operation_version !== accepted.expected_version + 1) throw new UncertainError();
      } else if ('revoked_batch' in result) throw new UncertainError();
    } else {
      same('operation_id', payload.operation_id); same('operation_version', Number(payload.expected_version) + 1);
      if (payload.reconsideration_id !== undefined) same('reconsideration_id', payload.reconsideration_id);
    }
  } else if (intent.family === 'delivery') {
    same('status', 'committed'); same('name', intent.command.name); requireFields('content_digest');
    if (payload.content_digest !== undefined) same('content_digest', payload.content_digest);
    switch (intent.command.name) {
      case 'prepare_delivery_acceptance': requireFields('proposal_id'); break;
      case 'confirm_delivery_acceptance': requireFields('proposal_id', 'confirmation_id'); break;
      case 'accept_delivery':
        same('confirmation_id', payload.confirmation_id); requireFields('proposal_id', 'operation_id', 'operation_version', 'input_cutoff'); break;
      case 'retry_delivery':
      case 'cancel_delivery':
        same('operation_id', payload.operation_id); same('operation_version', Number(payload.expected_version) + 1); break;
    }
  } else if (intent.family === 'conversation') {
    requireFields('version');
    if (intent.command.name === 'submit_task_message') {
      same('message_id', payload.message_id); requireFields('input_id'); same('version', 1);
    } else {
      same('version', (intent.command.expected_version ?? -1) + 1);
      if (intent.command.name === 'retry_task_input') requireFields('input_id');
      if (intent.command.name === 'stop_task_turn') same('input_id', payload.operation_id);
    }
  } else if (intent.family === 'specification') {
    switch (intent.command.name) {
      case 'edit_specification':
        same('status', 'admitted'); requireFields('confirmation_id', 'content_digest', 'operation_id'); break;
      case 'confirm_specification':
        same('status', 'committed'); requireFields('confirmation_id'); same('content_digest', payload.content_digest); break;
      case 'apply_specification_revision':
        same('status', 'admitted'); requireFields('operation_id'); break;
      case 'retry_specification':
        same('status', 'committed'); same('operation_id', payload.operation_id); break;
      case 'withdraw_specification':
      case 'defer_specification_inputs':
        same('status', 'committed'); break;
    }
  } else if (intent.family === 'replan') {
    requireFields('replan_request_id');
    if (payload.replan_request_id !== undefined) same('replan_request_id', payload.replan_request_id);
    if (intent.review_origin) {
      same('review_feedback_id', intent.review_origin.feedback_id); same('review_predecessor_operation_id', intent.review_origin.operation_id);
      requireFields('review_operation_id');
      if (fields.review_operation_id === intent.review_origin.operation_id) throw new UncertainError();
    }
    if (intent.command.name === 'confirm_replan') {
      requireFields('confirmation_id'); same('content_digest', payload.content_digest);
    }
    if (intent.command.name === 'publish_replan') {
      requireFields('publication_id', 'plan_id', 'specification_id');
      // A new command replaying an existing publication need not repeat its
      // optional joint metadata; when supplied, it must retain exact authority.
      if (fields.requirement_confirmation_id !== undefined) same('requirement_confirmation_id', payload.requirement_confirmation_id);
    }
  } else if (intent.family === 'remote-preparation') {
    same('status', 'committed'); requireFields('operation_id', 'operation_digest', 'operation_version');
  } else if (intent.family === 'publication') {
    same('status', 'committed');
    switch (intent.command.name) {
      case 'retry_publication_preparation': requireFields('operation_id'); break;
      case 'prepare_publication_override': requireFields('proposal_id', 'content_digest'); break;
      case 'confirm_publication_override': requireFields('confirmation_id'); if (fields.content_digest !== undefined) same('content_digest', payload.content_digest); break;
      case 'override_publication_findings': requireFields('receipt_id'); break;
    }
  } else if (intent.command.name === 'confirm_proposal') {
    same('status', 'committed'); requireFields('confirmation_id');
  } else {
    requireFields('control_version');
    if (typeof fields.control_version !== 'number' || fields.control_version < intent.command.expected_control_version
      || (payload.attempt_id === undefined && fields.control_version === intent.command.expected_control_version)) throw new UncertainError();
    if (payload.attempt_id !== undefined) same('attempt_id', payload.attempt_id);
    else same('task_id', intent.command.scope_id);
    if (['start_task', 'retry_initial_planning'].includes(intent.command.name)) requireFields('planning_intent_id');
    if (payload.node_id !== undefined) requireFields('source_id');
    if (intent.command.name === 'recover_completion') {
      same('status', 'admitted');
      if (payload.mode === 'retry') same('operation_id', payload.operation_id);
    }
  }
  if (result.status === 'admitted' && (!('operation_id' in result) || !result.operation_id)) throw new UncertainError();
  return result;
}

export async function submitTaskIntent(intent: TaskIntent, sessionId: string): Promise<TaskReceipt> {
  validateTaskIntent(intent); validate('Id', sessionId);
  const family = families[intent.family];
  return checkedReceipt(intent, await request<TaskReceipt>(family.post, family.result, intent.command, sessionId), false);
}

export async function recoverTaskIntent(intent: TaskIntent, sessionId: string): Promise<TaskReceipt> {
  validateTaskIntent(intent); validate('Id', sessionId);
  const taskId = encodeURIComponent(intentTask(intent));
  const id = encodeURIComponent(intent.command.request_id);
  const path = intent.family === 'execution' ? `/v1/owner/scopes/${taskId}/commands/${id}` : `/v1/owner/tasks/${taskId}/${intent.family}/commands/${id}`;
  let receipt: TaskReceipt;
  try { receipt = checkedReceipt(intent, await request<TaskReceipt>(path, families[intent.family].result, undefined, sessionId), true); }
  catch (error) { if (error instanceof APIError && error.code === 'unauthorized') throw error; throw new UncertainError(); }
  return receipt.status === 'unknown' ? submitTaskIntent(intent, sessionId) : receipt;
}

export async function resultRead(taskId: string, operationId: string, identity: string, mode: ResultReadRequest['mode'], params: Pick<ResultReadRequest, 'cursor'|'path'|'side'>, sessionId: string, signal?: AbortSignal): Promise<ResultReadResponse> {
  validate('Id', operationId); validate('Id', sessionId);
  const query = Object.fromEntries(Object.entries({ ...params, identity_digest: identity }).filter(([,value]) => value !== undefined));
  validate(`ResultRead${mode[0]!.toUpperCase()+mode.slice(1)}Query`, query);
  const response = await taskRead<ResultReadResponse>(taskId, `/results/${encodeURIComponent(operationId)}/${mode}`, 'ResultReadResponse', query, sessionId, signal);
  const r = response.request;
  // The wire response schema is shared with Runner replies, where applicability
  // is absent. Owner reads must supply the freshly resolved applicability.
  if (typeof response.current !== 'boolean' || r.identity.task_id !== taskId || r.identity.operation_id !== operationId || r.identity_digest !== identity || r.mode !== mode || r.path !== params.path || r.side !== params.side || r.cursor !== params.cursor) throw new APIError('invalid_response', 'Result response did not match the selected content.');
  // Identity is a flat generated scalar projection. Verify its complete digest,
  // rather than accepting an echoed digest beside unrelated identity fields.
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(r.identity).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  signal?.throwIfAborted();
  if (Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('') !== identity) throw new APIError('invalid_response', 'Result response did not match the selected identity.');
  return response;
}
