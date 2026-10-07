import type { TaskActionBasis, TaskReviewBasis, ReviewAcceptedBatch } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { intentTask, validateTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';

const prefix = 'monos:task-ui:v1:';
const limit = 2 * 1024 * 1024;
let epoch = 0;
export function taskStorageEpoch() { return epoch; }
export interface TaskDraft { text: string; basis?: TaskActionBasis; review?: { basis: TaskReviewBasis; accepted_batch?: ReviewAcceptedBatch } }
export interface TaskLocal { drafts: Record<string, TaskDraft>; pending: Record<string, TaskIntent> }
export interface TaskJournal { version: 1; session_id: string; tasks: Record<string, TaskLocal> }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export function own<T>(record: Record<string, T>, key: string): T | undefined { return Object.hasOwn(record, key) ? record[key] : undefined; }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Incompatible Task recovery data'); }

export function validateTaskJournal(value: unknown, sessionId: string): TaskJournal {
  if (!record(value)) throw new Error('Invalid Task recovery data');
  keys(value, ['version', 'session_id', 'tasks']);
  if (value.version !== 1 || value.session_id !== sessionId || !record(value.tasks) || Object.keys(value.tasks).length > 64) throw new Error('Incompatible Task recovery session');
  for (const [taskId, local] of Object.entries(value.tasks)) {
    validate('Id', taskId);
    if (!record(local)) throw new Error('Invalid Task recovery scope');
    keys(local, ['drafts', 'pending']);
    if (!record(local.drafts) || !record(local.pending) || Object.keys(local.drafts).length > 64 || Object.keys(local.pending).length > 32) throw new Error('Task recovery capacity exceeded');
    for (const [key, draft] of Object.entries(local.drafts)) {
      if (!key || key.length > 256 || !record(draft) || typeof draft.text !== 'string' || draft.text.length > 262144) throw new Error('Invalid saved Task draft');
      keys(draft, ['text', 'basis', 'review']);
      if (draft.basis !== undefined) validate('TaskActionBasis', draft.basis);
      if (draft.review !== undefined) {
        if (draft.basis !== undefined || !record(draft.review)) throw new Error('Invalid saved review draft');
        keys(draft.review, ['basis', 'accepted_batch']);
        validate('TaskReviewBasis', draft.review.basis);
        if (draft.review.accepted_batch !== undefined) validate('ReviewAcceptedBatch', draft.review.accepted_batch);
      }
    }
    for (const [scope, intent] of Object.entries(local.pending)) {
      if (!scope || scope.length > 256 || intentTask(validateTaskIntent(intent)) !== taskId) throw new Error('Task recovery scope mismatch');
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > limit) throw new Error('Task recovery capacity exceeded');
  return value as unknown as TaskJournal;
}

export function clearTaskStorage(storage?: StoragePort) {
  epoch += 1;
  try {
    const target = storage ?? sessionStorage;
    const names = Array.from({ length: target.length }, (_, i) => target.key(i));
    for (const key of names) if (key?.startsWith(prefix)) target.removeItem(key);
  } catch { /* A revoked session never reuses inaccessible recovery storage. */ }
}

export function loadTaskJournal(sessionId: string, storage: StoragePort = sessionStorage): TaskJournal {
  validate('Id', sessionId);
  const key = prefix + sessionId;
  const names = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const prior of names) if (prior?.startsWith(prefix) && prior !== key) storage.removeItem(prior);
  const raw = storage.getItem(key);
  if (raw === null) return { version: 1, session_id: sessionId, tasks: {} };
  if (new TextEncoder().encode(raw).length > limit) throw new Error('Task recovery capacity exceeded');
  return validateTaskJournal(JSON.parse(raw), sessionId);
}

export function saveTaskJournal(journal: TaskJournal, expectedEpoch: number, storage: StoragePort = sessionStorage) {
  if (expectedEpoch !== epoch) throw new Error('Task session changed');
  validateTaskJournal(journal, journal.session_id);
  if (!Object.keys(journal.tasks).length) storage.removeItem(prefix + journal.session_id);
  else storage.setItem(prefix + journal.session_id, JSON.stringify(journal));
}

export function retryTaskJournal(journal: TaskJournal, expectedEpoch: number, failedInitialLoad: boolean, storage: StoragePort = sessionStorage): TaskJournal {
  if (expectedEpoch !== epoch) throw new Error('Task session changed');
  if (failedInitialLoad) return loadTaskJournal(journal.session_id, storage);
  // A failed later save can leave a newer draft only in memory. Reading the old
  // disk value here would discard it, including any still-pending exact command.
  saveTaskJournal(journal, expectedEpoch, storage);
  return journal;
}
