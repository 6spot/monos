import type { PublicationCandidatePage, PublicationCandidateQuery, PublicationFindingPage, PublicationFindingsQuery, PublicationRecord, PublicationPublishedProof } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError } from './api.ts';
import { taskRead } from './task-api.ts';
import { sha256 } from './browser-crypto.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function publicationDigest(value: unknown): Promise<string> {
  return sha256(canonical(value));
}
function mismatch(): never { throw new APIError('invalid_response', 'Publication evidence did not match the selected result.'); }

type Evidence = Pick<PublicationRecord, 'source' | 'source_digest' | 'effective_basis' | 'effective_basis_digest' | 'candidate' | 'candidate_manifest_digest' | 'mapping' | 'mapping_digest'>;
export async function publicationProof(proof: PublicationPublishedProof, digest: string, evidence: Evidence): Promise<void> {
  const source = evidence.source, observation = proof.observation;
  if (await publicationDigest(proof) !== digest || await publicationDigest(proof.candidate) !== proof.candidate_manifest_digest || await publicationDigest(observation) !== proof.observation_digest) mismatch();
  for (const key of ['task_id', 'resource_id', 'runner_id', 'storage_id', 'repository_identity'] as const) if (proof[key] !== source[key] || observation[key] !== proof[key]) mismatch();
  for (const key of ['item_id', 'operation_id', 'repository_id', 'delivery_ref'] as const) if (observation[key] !== proof[key]) mismatch();
  if (observation.status !== 'present' || observation.head !== proof.candidate.head) mismatch();
}

export async function publicationEvidence(evidence: Evidence, task: string): Promise<void> {
  const { source, effective_basis: basis, candidate, mapping } = evidence;
  if (source.task_id !== task || basis.task_id !== task || basis.completion_operation_id !== source.operation_id || basis.completion_manifest_digest !== source.manifest_digest) mismatch();
  if (await publicationDigest(source) !== evidence.source_digest || await publicationDigest(basis) !== evidence.effective_basis_digest) mismatch();
  if (!!mapping !== !!evidence.mapping_digest) mismatch();
  if (!candidate) { if (mapping || evidence.candidate_manifest_digest) mismatch(); return; }
  if (candidate.tree !== source.git_tree || await publicationDigest(candidate) !== evidence.candidate_manifest_digest) mismatch();
  if (!mapping) { if (candidate.source_digest !== evidence.source_digest) mismatch(); return; }
  if (await publicationDigest(mapping) !== evidence.mapping_digest || mapping.mapping_id !== mapping.operation_id || mapping.source_digest !== evidence.source_digest || await publicationDigest(mapping.source) !== evidence.source_digest || mapping.effective_basis_digest !== evidence.effective_basis_digest || await publicationDigest(mapping.effective_basis) !== evidence.effective_basis_digest || mapping.candidate_manifest_digest !== evidence.candidate_manifest_digest || mapping.result_tree !== source.git_tree || mapping.reused_head !== candidate.head || mapping.published.candidate_manifest_digest !== evidence.candidate_manifest_digest || mapping.item_id !== mapping.published.item_id) mismatch();
  await publicationProof(mapping.published, mapping.published_digest, evidence);
}

async function checkedRecord(record: PublicationRecord, task: string, source?: string, candidate?: string): Promise<PublicationRecord> {
  if ((source !== undefined && record.source.operation_id !== source) || (candidate !== undefined && record.candidate?.candidate_id !== candidate)) mismatch();
  await publicationEvidence(record, task);
  if (['prepared', 'mapped'].includes(record.status) && (!record.candidate || !record.candidate_manifest_digest || !record.scan || !record.scan_digest)) mismatch();
  if ((record.status === 'mapped') !== !!record.mapping) mismatch();
  if (record.mapping && (record.mapping.operation_id !== record.operation_id || record.mapping.request_digest !== record.request_digest || record.mapping.configuration_digest !== record.scan?.configuration_digest)) mismatch();
  if (!record.candidate && (record.scan || record.scan_digest)) mismatch();
  if (record.scan && (record.scan.candidate_manifest_digest !== record.candidate_manifest_digest || await publicationDigest(record.scan) !== record.scan_digest)) mismatch();
  if (record.scan_applicable && (!record.current || !record.scan) || record.override_allowed && (!record.current || !record.scan_applicable || record.scan?.status !== 'complete')) mismatch();
  return record;
}

export async function publicationCandidates(task: string, query: PublicationCandidateQuery, session: string, signal?: AbortSignal): Promise<PublicationCandidatePage> {
  validate('PublicationCandidateQuery', query);
  const page = await taskRead<PublicationCandidatePage>(task, '/publication-candidates', 'PublicationCandidatePage', { ...query }, session, signal);
  if (query.cursor !== undefined && page.next_cursor === query.cursor || new Set(page.items.map(record => record.operation_id)).size !== page.items.length) mismatch();
  await Promise.all(page.items.map(record => checkedRecord(record, task, query.source_operation_id)));
  signal?.throwIfAborted(); return page;
}
export async function publicationCandidate(task: string, candidate: string, session: string, source?: string, signal?: AbortSignal): Promise<PublicationRecord> {
  validate('Id', candidate);
  const record = await taskRead<PublicationRecord>(task, `/publication-candidates/${encodeURIComponent(candidate)}`, 'PublicationRecord', undefined, session, signal);
  await checkedRecord(record, task, source, candidate);
  signal?.throwIfAborted(); return record;
}
export async function publicationFindings(task: string, record: PublicationRecord, query: PublicationFindingsQuery, session: string, signal?: AbortSignal): Promise<PublicationFindingPage> {
  validate('PublicationFindingsQuery', query);
  if (!record.candidate || !record.scan || !record.candidate_manifest_digest || query.scan_digest !== record.scan_digest) mismatch();
  const candidate = record.candidate.candidate_id;
  const page = await taskRead<PublicationFindingPage>(task, `/publication-candidates/${encodeURIComponent(candidate)}/findings`, 'PublicationFindingPage', { ...query }, session, signal);
  if (page.candidate_id !== candidate || page.scan_digest !== query.scan_digest) mismatch();
  if (query.cursor !== undefined && page.next_cursor === query.cursor || new Set(page.items.map(finding => finding.finding_id)).size !== page.items.length) mismatch();
  await Promise.all(page.items.map(async finding => {
    const { finding_id, ...facts } = finding;
    if (finding.path_redacted && finding.path !== '[redacted credential path]' || finding.baseline_path_redacted && finding.baseline_path !== '[redacted credential path]') mismatch();
    if (await publicationDigest({ candidate_manifest_digest: record.candidate_manifest_digest, configuration_digest: record.scan!.configuration_digest, scan_run_id: record.scan!.scan_id, finding_facts_without_id: facts }) !== finding_id) mismatch();
  }));
  signal?.throwIfAborted(); return page;
}
