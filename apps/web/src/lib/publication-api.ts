import type { PublicationCandidatePage, PublicationCandidateQuery, PublicationFindingPage, PublicationFindingsQuery, PublicationRecord } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { APIError } from './api.ts';
import { taskRead } from './task-api.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function publicationDigest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function mismatch(): never { throw new APIError('invalid_response', 'Publication evidence did not match the selected result.'); }

async function checkedRecord(record: PublicationRecord, task: string, source?: string, candidate?: string): Promise<PublicationRecord> {
  if (record.source.task_id !== task || record.effective_basis.task_id !== task || record.effective_basis.completion_operation_id !== record.source.operation_id || record.effective_basis.completion_manifest_digest !== record.source.manifest_digest || (source !== undefined && record.source.operation_id !== source) || (candidate !== undefined && record.candidate?.candidate_id !== candidate)) mismatch();
  if (await publicationDigest(record.source) !== record.source_digest || await publicationDigest(record.effective_basis) !== record.effective_basis_digest) mismatch();
  if (record.status === 'prepared' && (!record.candidate || !record.candidate_manifest_digest || !record.scan || !record.scan_digest)) mismatch();
  if (record.candidate) {
    if (record.candidate.source_digest !== record.source_digest || record.candidate.tree !== record.source.git_tree || await publicationDigest(record.candidate) !== record.candidate_manifest_digest) mismatch();
  } else if (record.candidate_manifest_digest || record.scan || record.scan_digest) mismatch();
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
