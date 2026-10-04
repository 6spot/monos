import { afterEach, expect, it, vi } from 'vitest';
import type { PublicationFinding, PublicationRecord, ResultReadIdentity } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError, UncertainError } from './api.ts';
import { publicationCandidate, publicationCandidates, publicationDigest, publicationFindings } from './publication-api.ts';
import { recoverTaskIntent, submitTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';

afterEach(() => vi.unstubAllGlobals());
const hash = 'a'.repeat(64), oid = 'b'.repeat(40);
const source: ResultReadIdentity = { task_id: 'task-a', operation_id: 'completion-a', attempt_id: 'attempt-a', dispatch_id: 'dispatch-a', node_id: 'node-a', node_activation: 1, specification_id: 'original-spec', plan_id: 'original-plan', manifest_digest: hash, operation_identity_digest: hash, workspace_id: 'workspace-a', resource_id: 'resource-a', runner_id: 'runner-a', storage_id: 'storage-a', generation: 1, lease_id: 'lease-a', repository_identity: 'github.com/example/repo', base_commit: oid, git_commit: 'c'.repeat(40), git_tree: 'd'.repeat(40) };
async function evidence(): Promise<PublicationRecord> {
  const source_digest = await publicationDigest(source);
  const effective_basis = { task_id: source.task_id, specification_id: 'effective-spec', plan_id: 'effective-plan', completion_operation_id: source.operation_id, completion_manifest_digest: source.manifest_digest };
  const candidate = { schema_version: 1, candidate_id: 'candidate-a', construction_id: 'construction-a', construction_digest: hash, source_digest, head: 'e'.repeat(40), tree: source.git_tree, parents: [oid] as [string] };
  const candidate_manifest_digest = await publicationDigest(candidate);
  const scan = { schema_version: 1, scan_id: 'scan-a', candidate_manifest_digest, configuration_digest: hash, status: 'complete' as const, coverage: { commits: 1, paths: 2, versions: 2, unique_blob_bytes: 12 }, findings_count: 1, findings_bytes: 2, findings_digest: hash };
  return validate<PublicationRecord>('PublicationRecord', { operation_id: 'prepare-a', request_digest: hash, source, source_digest, effective_basis, effective_basis_digest: await publicationDigest(effective_basis), candidate, candidate_manifest_digest, scan, scan_digest: await publicationDigest(scan), current: true, scan_applicable: true, retry_allowed: false, override_allowed: true, override_receipt_ids: [], known_public_exposure_count: 0, remote_preparation: 'after_acceptance', status: 'prepared' });
}
async function finding(record: PublicationRecord): Promise<PublicationFinding> {
  const facts = { occurrence_ordinal: 0, kind: 'credential_pattern' as const, rule_id: 'github_classic_token' as const, scope: 'final_tree' as const, commit: record.candidate!.head, path: '[redacted credential path]', path_redacted: true, override_eligible: true, message: 'Credential pattern matched; value redacted.' as const, blob: oid, content_digest: hash };
  return { ...facts, finding_id: await publicationDigest({ candidate_manifest_digest: record.candidate_manifest_digest, configuration_digest: record.scan!.configuration_digest, scan_run_id: record.scan!.scan_id, finding_facts_without_id: facts }) };
}

it('reads exact source history and direct older candidates with session, abort and no-store binding', async () => {
  const record = await evidence(), calls: { path: string; init: RequestInit }[] = [], controller = new AbortController();
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push({ path, init }); return Response.json(path.includes('candidate-a') ? record : { schema_version: 1, task_id: source.task_id, items: [record], next_cursor: 'exact-cursor' }); });
  await expect(publicationCandidates(source.task_id, { source_operation_id: source.operation_id }, 'session-a', controller.signal)).resolves.toMatchObject({ items: [record], next_cursor: 'exact-cursor' });
  await expect(publicationCandidate(source.task_id, 'candidate-a', 'session-a', source.operation_id, controller.signal)).resolves.toEqual(record);
  expect(calls[0]!.path).toBe('/v1/owner/tasks/task-a/publication-candidates?source_operation_id=completion-a');
  expect(calls[1]!.path).toBe('/v1/owner/tasks/task-a/publication-candidates/candidate-a');
  expect(calls.every(({ init }) => init.cache === 'no-store' && init.signal === controller.signal && (init.headers as Record<string, string>)['X-Monos-Session'] === 'session-a')).toBe(true);
});

it('rejects crossed source/task/candidate/tree/digest/applicability instead of substituting history', async () => {
  const record = await evidence();
  for (const changed of [
    { ...record, source: { ...source, task_id: 'other' } }, { ...record, source_digest: 'f'.repeat(64) },
    { ...record, effective_basis_digest: 'f'.repeat(64) }, { ...record, candidate: { ...record.candidate, tree: oid } },
    { ...record, candidate_manifest_digest: 'f'.repeat(64) }, { ...record, scan_digest: 'f'.repeat(64) },
    { ...record, current: false, scan_applicable: true }, { ...record, candidate: undefined },
  ]) {
    vi.stubGlobal('fetch', async () => Response.json(changed));
    await expect(publicationCandidate('task-a', 'candidate-a', 'session-a', source.operation_id)).rejects.toBeInstanceOf(APIError);
  }
  vi.stubGlobal('fetch', async () => Response.json(record));
  await expect(publicationCandidate('task-a', 'other', 'session-a')).rejects.toBeInstanceOf(APIError);
  await expect(publicationCandidate('task-a', 'candidate-a', 'session-a', 'other')).rejects.toBeInstanceOf(APIError);
});

it('keeps filename/content redaction and rejects changed contextual finding identity or scan pages', async () => {
  const record = await evidence(), item = await finding(record), base = { schema_version: 1, task_id: source.task_id, candidate_id: 'candidate-a', scan_digest: record.scan_digest, items: [item], next_cursor: 'page-two' };
  vi.stubGlobal('fetch', async () => Response.json(base));
  await expect(publicationFindings('task-a', record, { scan_digest: record.scan_digest!, cursor: 'page-one' }, 'session-a')).resolves.toEqual(base);
  for (const changed of [{ ...base, candidate_id: 'other' }, { ...base, scan_digest: 'f'.repeat(64) }, { ...base, items: [{ ...item, path: 'ghp_' + 'X'.repeat(36) }] }, { ...base, items: [{ ...item, occurrence_ordinal: 1 }] }, { ...base, items: [{ ...item, override_eligible: false }] }]) {
    vi.stubGlobal('fetch', async () => Response.json(changed));
    await expect(publicationFindings('task-a', record, { scan_digest: record.scan_digest! }, 'session-a')).rejects.toBeInstanceOf(APIError);
  }
});

it('fences a late transport response after cancellation even when the transport ignores AbortSignal', async () => {
  const record = await evidence(), controller = new AbortController();
  vi.stubGlobal('fetch', async () => { controller.abort(); return Response.json(record); });
  await expect(publicationCandidate('task-a', 'candidate-a', 'session-a', undefined, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
});

it('retains known exposure independently of a clean current scan and rejects a missing guard', async () => {
  const original = await evidence(), scan = { ...original.scan!, findings_count: 0, findings_bytes: 2, findings_digest: await publicationDigest([]) };
  const record = { ...original, scan, scan_digest: await publicationDigest(scan), known_public_exposure_count: 1 };
  vi.stubGlobal('fetch', async () => Response.json(record));
  await expect(publicationCandidate('task-a', 'candidate-a', 'session-a')).resolves.toMatchObject({ known_public_exposure_count: 1, scan: { status: 'complete', findings_count: 0 } });
  const missing: Record<string, unknown> = { ...record }; delete missing.known_public_exposure_count;
  vi.stubGlobal('fetch', async () => Response.json(missing));
  await expect(publicationCandidate('task-a', 'candidate-a', 'session-a')).rejects.toBeInstanceOf(APIError);
});

it('requires each exact publication step receipt, supports new-run retry and only replays authoritative unknown', async () => {
  const record = await evidence();
  const selection = { candidate_id: 'candidate-a', candidate_manifest_digest: record.candidate_manifest_digest!, effective_basis_digest: record.effective_basis_digest, scan_digest: record.scan_digest!, finding_ids: [hash] as [string] };
  const cases = [
    { name: 'retry_publication_preparation', payload: { operation_id: 'old-op', operation_digest: hash }, fields: { operation_id: 'new-scan-op' } },
    { name: 'prepare_publication_override', payload: selection, fields: { proposal_id: 'proposal-a', content_digest: hash } },
    { name: 'confirm_publication_override', payload: { proposal_id: 'proposal-a', content_digest: hash }, fields: { confirmation_id: 'confirmation-a' } },
    { name: 'override_publication_findings', payload: { ...selection, confirmation_id: 'confirmation-a' }, fields: { receipt_id: 'receipt-a' } },
  ] as const;
  for (const item of cases) {
    const intent: TaskIntent = { family: 'publication', command: { schema_version: 1, task_id: 'task-a', request_id: 'request-a', name: item.name, payload: item.payload } };
    const receipt = { schema_version: 1, task_id: 'task-a', request_id: 'request-a', status: 'committed', ...item.fields };
    vi.stubGlobal('fetch', async () => Response.json(receipt));
    await expect(submitTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
    for (const field of Object.keys(item.fields)) {
      const missing: Record<string, unknown> = { ...receipt }; delete missing[field];
      const fetch = vi.fn(async () => Response.json(missing)); vi.stubGlobal('fetch', fetch);
      await expect(recoverTaskIntent(intent, 'session-a')).rejects.toBeInstanceOf(UncertainError); expect(fetch).toHaveBeenCalledTimes(1);
    }
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { calls.push(path); return Response.json(init.body ? receipt : { schema_version: 1, task_id: 'task-a', request_id: 'request-a', status: 'unknown' }); });
    await expect(recoverTaskIntent(intent, 'session-a')).resolves.toEqual(receipt);
    expect(calls).toEqual(['/v1/owner/tasks/task-a/publication/commands/request-a', '/v1/owner/tasks/publication/commands']);
  }
});
