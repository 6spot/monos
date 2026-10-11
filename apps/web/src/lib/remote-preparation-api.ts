import type { RemotePreparationChecksPage, RemotePreparationChecksQuery, RemotePreparationPage, RemotePreparationQuery, RemotePreparationRecord } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError } from './api.ts';
import { publicationEvidence, publicationProof } from './publication-api.ts';
import { taskRead } from './task-api.ts';

function mismatch(): never { throw new APIError('invalid_response', 'Remote preparation evidence did not match the selected Task or operation.'); }
export const remoteRowKey = (record: RemotePreparationRecord) => JSON.stringify([record.item_id, record.operation ? ['operation', record.operation.operation_id] : ['local-only']]);

async function checked(record: RemotePreparationRecord, task: string, item?: string, source?: string): Promise<RemotePreparationRecord> {
  if (record.task_id !== task || item !== undefined && record.item_id !== item || source !== undefined && record.source.operation_id !== source) mismatch();
  for (const key of ['resource_id', 'runner_id', 'repository_identity'] as const) if (record[key] !== record.source[key]) mismatch();
  if (record.delivery_ref !== `refs/heads/monos/task/${task}/${record.resource_id}`) mismatch();
  await publicationEvidence(record, task);
  if (!!record.published !== !!record.published_digest) mismatch();
  if (record.published) {
    await publicationProof(record.published, record.published_digest!, record);
    if (record.published.item_id !== record.item_id || record.published.provider_metadata.github?.repository_id !== record.provider_metadata.github?.repository_id || record.published.delivery_ref !== record.delivery_ref) mismatch();
  }
  if (record.mapping && (record.mapping.item_id !== record.item_id || record.mapping.published.provider_metadata.github?.repository_id !== record.provider_metadata.github?.repository_id || record.mapping.published.delivery_ref !== record.delivery_ref)) mismatch();
  if (record.review) {
    const url = new URL(record.review.url);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || url.pathname !== `/${record.repository_identity.replace(/^github\.com\//, '')}/pull/${record.review.pr_number}` || record.review.repository_id !== record.provider_metadata.github?.repository_id || record.review.marker !== `<!-- monos-delivery-item:${record.item_id} -->` || record.review.head_ref !== record.delivery_ref.replace(/^refs\/heads\//, '') || record.review.base_ref !== record.target_branch) mismatch();
  }
  if (record.scan_applicable && !record.current || record.retry_allowed && (!record.current || !record.operation) || (record.cleanup_allowed || record.read_retry_allowed) && !record.operation) mismatch();
  if (record.checks?.current && (!record.current || !record.checks.complete || record.checks.stale || record.checks.head !== record.candidate.head)) mismatch();
  return record;
}

export async function remotePreparations(task: string, query: RemotePreparationQuery, session: string, signal?: AbortSignal): Promise<RemotePreparationPage> {
  validate('RemotePreparationQuery', query);
  const page = await taskRead<RemotePreparationPage>(task, '/remote-preparation', 'RemotePreparationPage', { ...query }, session, signal);
  if (query.cursor !== undefined && page.next_cursor === query.cursor || new Set(page.items.map(remoteRowKey)).size !== page.items.length) mismatch();
  await Promise.all(page.items.map(record => checked(record, task, undefined, query.source_operation_id)));
  signal?.throwIfAborted(); return page;
}

export async function remotePreparation(task: string, item: string, session: string, signal?: AbortSignal): Promise<RemotePreparationRecord> {
  validate('Id', item);
  const record = await taskRead<RemotePreparationRecord>(task, `/remote-preparation/${encodeURIComponent(item)}`, 'RemotePreparationRecord', undefined, session, signal);
  await checked(record, task, item);
  signal?.throwIfAborted(); return record;
}

export async function remoteChecks(task: string, record: RemotePreparationRecord, query: RemotePreparationChecksQuery, session: string, signal?: AbortSignal): Promise<RemotePreparationChecksPage> {
  validate('RemotePreparationChecksQuery', query);
  const expected = record.checks;
  if (!expected) mismatch();
  const page = await taskRead<RemotePreparationChecksPage>(task, `/remote-preparation/${encodeURIComponent(record.item_id)}/checks/${encodeURIComponent(expected.observation_id)}`, 'RemotePreparationChecksPage', { ...query }, session, signal);
  if (page.item_id !== record.item_id || query.cursor !== undefined && page.next_cursor === query.cursor) mismatch();
  for (const key of ['observation_id', 'head', 'base_head', 'observed_at', 'aggregate', 'complete', 'mergeability', 'required_checks'] as const) if (page.observation[key] !== expected[key]) mismatch();
  if (page.items.some(check => check.head !== expected.head) || new Set(page.items.map(check => `${check.kind}:${check.provider_id}`)).size !== page.items.length) mismatch();
  signal?.throwIfAborted(); return page;
}
