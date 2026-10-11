import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { PublicationPrepareRequest, PublicationPushRequest, PublicationRecord, PublicationResult, RemotePreparationChecksPage, RemotePreparationRecord } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError, UncertainError } from './api.ts';
import { publicationCandidate, publicationDigest } from './publication-api.ts';
import { remoteChecks, remotePreparation, remotePreparations, remoteRowKey } from './remote-preparation-api.ts';
import { recoverTaskIntent, submitTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';
import { validateTaskJournal } from './task-storage.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../../packages/protocol/fixtures/remote-preparation.json', import.meta.url), 'utf8'));
const push = validate<PublicationPushRequest>('PublicationPushRequest', fixture.push);
afterEach(() => vi.unstubAllGlobals());

function record(): RemotePreparationRecord {
  return validate<RemotePreparationRecord>('RemotePreparationRecord', {
    schema_version: 1, task_id: push.task_id, item_id: push.item_id, resource_id: push.resource_id, runner_id: push.runner_id, provider_metadata: push.provider_metadata, delivery_kind: 'github_pr', repository_identity: push.repository_identity, delivery_ref: push.delivery_ref, target_branch: push.target_branch,
    source: push.preparation.source, source_digest: push.preparation.source_digest, effective_basis: push.preparation.effective_basis, effective_basis_digest: push.preparation.effective_basis_digest, candidate: push.prepared.candidate, candidate_manifest_digest: push.prepared.candidate_manifest_digest, scan_digest: push.prepared.scan_digest,
    published: fixture.published, published_digest: 'a'.repeat(64),
    remote_preparation: 'automatic', status: 'prepared', current: true, scan_applicable: true, retry_allowed: true, cleanup_allowed: false, read_retry_allowed: true, known_public_exposure_count: 0,
    operation: { operation_id: push.operation_id, request_digest: fixture.request_digest, version: 1, kind: 'push', state: 'settled', may_have_mutated: true, worker_absent: true, reconcile_only: true },
    checks: fixture.checks,
  });
}
async function evidence(): Promise<RemotePreparationRecord> {
  const value = record(); value.published_digest = await publicationDigest(value.published); return value;
}

it('keeps distinct operation history over one item and binds session/no-store/abort reads', async () => {
  const value = await evidence(), controller = new AbortController(), calls: { path: string; init: RequestInit }[] = [];
  const old = { ...value, current: false, scan_applicable: false, retry_allowed: false, operation: { ...value.operation!, operation_id: 'older-operation' } };
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, init }); return Response.json(path.endsWith(value.item_id) ? value : { schema_version: 1, task_id: value.task_id, items: [value, old], next_cursor: 'older-page' }); });
  const page = await remotePreparations(value.task_id, {}, 'session-a', controller.signal);
  expect(page.items.map(remoteRowKey)).toEqual([remoteRowKey(value), remoteRowKey(old)]);
  expect(remoteRowKey({ ...value, operation: undefined })).not.toBe(remoteRowKey({ ...value, operation: { ...value.operation!, operation_id: 'local-only' } }));
  await expect(remotePreparation(value.task_id, value.item_id, 'session-a', controller.signal)).resolves.toEqual(value);
  expect(calls[1]!.path).toContain(`/remote-preparation/${value.item_id}`);
  expect(calls.every(({ init }) => init.signal === controller.signal && init.cache === 'no-store' && (init.headers as Record<string, string>)['X-Monos-Session'] === 'session-a')).toBe(true);
});

it('rejects crossed Task/item/ref/source/review/proof and cached false current flags', async () => {
  const value = await evidence();
  for (const changed of [
    { ...value, task_id: 'other' }, { ...value, item_id: 'other' }, { ...value, source_digest: 'f'.repeat(64) },
    { ...value, resource_id: 'other' }, { ...value, delivery_ref: value.delivery_ref + '-foreign' },
    { ...value, published_digest: 'f'.repeat(64) },
    { ...value, current: false, retry_allowed: true },
    { ...value, checks: { ...value.checks!, complete: true, current: true, aggregate: 'success', head: 'f'.repeat(40) } },
  ]) {
    vi.stubGlobal('fetch', async () => Response.json(changed));
    await expect(remotePreparation(value.task_id, value.item_id, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});

it('checks pages retain the exact immutable observation and accept fresh historical applicability', async () => {
  const value = await evidence();
  const base: RemotePreparationChecksPage = { schema_version: 1, task_id: value.task_id, item_id: value.item_id, observation: value.checks!, items: [{ head: value.checks!.head, provider_id: 1, kind: 'check_run', name: '<script>literal provider name</script>', state: 'neutral', conclusion: 'neutral' }], next_cursor: 'next-page' };
  vi.stubGlobal('fetch', async () => Response.json(base));
  await expect(remoteChecks(value.task_id, value, {}, 'session-a')).resolves.toEqual(base);
  for (const changed of [{ ...base, item_id: 'other' }, { ...base, observation: { ...base.observation, base_head: 'f'.repeat(40) } }, { ...base, observation: { ...base.observation, observation_id: 'other' } }, { ...base, items: [{ ...base.items[0], head: 'f'.repeat(40) }] }]) {
    vi.stubGlobal('fetch', async () => Response.json(changed));
    await expect(remoteChecks(value.task_id, value, {}, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});

it('a late transport result is fenced even when fetch ignores cancellation', async () => {
  const value = await evidence(), controller = new AbortController();
  vi.stubGlobal('fetch', async () => { controller.abort(); return Response.json(value); });
  await expect(remotePreparation(value.task_id, value.item_id, 'session-a', controller.signal)).rejects.toHaveProperty('name', 'AbortError');
});

it('remote Retry journals exact payload and requires actual committed operation fields', async () => {
  const value = await evidence();
  const intent: TaskIntent = { family: 'remote-preparation', command: { schema_version: 1, request_id: 'request-a', task_id: value.task_id, name: 'retry_remote_preparation', payload: { operation_id: value.operation!.operation_id, operation_digest: value.operation!.request_digest, expected_version: 1 } } };
  expect(validateTaskJournal({ version: 1, session_id: 'session-a', tasks: { [value.task_id]: { drafts: {}, pending: { retry: intent } } } }, 'session-a').tasks[value.task_id]!.pending.retry).toEqual(intent);
  const receipt = { schema_version: 1, task_id: value.task_id, request_id: 'request-a', status: 'committed', operation_id: 'new-definitive-before-start-operation', operation_digest: 'b'.repeat(64), operation_version: 1 };
  vi.stubGlobal('fetch', async () => Response.json(receipt));
  await expect(submitTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
  for (const field of ['operation_id', 'operation_digest', 'operation_version', 'task_id']) {
    const missing: Record<string, unknown> = { ...receipt }; delete missing[field];
    const fetch = vi.fn(async () => Response.json(missing)); vi.stubGlobal('fetch', fetch);
    await expect(recoverTaskIntent(intent, 'session-a')).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
  }
  const calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, body: init.body }); return Response.json(init.body ? receipt : { schema_version: 1, task_id: value.task_id, request_id: 'request-a', status: 'unknown' }); });
  await expect(recoverTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
  expect(calls[0]!.path).toBe(`/v1/owner/tasks/${value.task_id}/remote-preparation/commands/request-a`);
  expect(JSON.parse(calls[1]!.body as string)).toEqual(intent.command);
});

it('mapped local candidate permits an old manifest only through the complete exact new mapping', async () => {
  const request = validate<PublicationPrepareRequest>('PublicationPrepareRequest', fixture.mapping_request), result = validate<PublicationResult>('PublicationResult', fixture.mapped);
  const value = validate<PublicationRecord>('PublicationRecord', { operation_id: result.operation_id, request_digest: result.request_digest, status: result.status, candidate: result.candidate, candidate_manifest_digest: result.candidate_manifest_digest, scan: result.scan, scan_digest: result.scan_digest, mapping: result.mapping, mapping_digest: result.mapping_digest, source: request.source, source_digest: request.source_digest, effective_basis: request.effective_basis, effective_basis_digest: request.effective_basis_digest, current: true, scan_applicable: true, retry_allowed: false, override_allowed: true, override_receipt_ids: [], known_public_exposure_count: 0, remote_preparation: 'automatic' });
  vi.stubGlobal('fetch', async () => Response.json(value));
  await expect(publicationCandidate(value.source.task_id, value.candidate!.candidate_id, 'session-a')).resolves.toEqual(value);
  for (const change of [
    { ...value, mapping: undefined, mapping_digest: undefined },
    { ...value, mapping_digest: 'f'.repeat(64) },
    { ...value, mapping: { ...value.mapping!, configuration_digest: 'f'.repeat(64) } },
    { ...value, mapping: { ...value.mapping!, reused_head: 'f'.repeat(40) } },
    { ...value, mapping: { ...value.mapping!, published: { ...value.mapping!.published, item_id: 'foreign-item' } } },
  ]) {
    if (change.mapping && change.mapping !== value.mapping) change.mapping_digest = await publicationDigest(change.mapping);
    vi.stubGlobal('fetch', async () => Response.json(change));
    await expect(publicationCandidate(value.source.task_id, value.candidate!.candidate_id, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});
