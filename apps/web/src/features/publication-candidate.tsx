import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PublicationCommand, PublicationFinding, PublicationRecord, TaskLocalResult } from '../../../../packages/protocol/generated/types.ts';
import { validate } from '../../../../packages/protocol/src/validation.ts';
import { Button } from '../components/ui/button.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import { Input } from '../components/ui/input.tsx';
import { APIError } from '../lib/api.ts';
import { publicationCandidate, publicationCandidates, publicationFindings } from '../lib/publication-api.ts';
import { taskStorageEpoch } from '../lib/task-storage.ts';
import { Datum, DetailIDs, human, More, ReadProblem, unique } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

const statusText: Record<PublicationRecord['status'], string> = {
  pending: 'Waiting for local preparation.', preparing: 'Preparing the local candidate and scanning its publication range.',
  offline: 'The owning Runner is offline. The original preparation is retained.', unsupported: 'The owning Runner does not support local publication preparation.',
  prepared: 'Local candidate retained.', not_applicable: 'No tree changes from the fixed base. No delivery item is needed.',
  mapped: 'Current result mapped to the unchanged published head. No new candidate was pushed.',
  unavailable: 'Retained source evidence is unavailable. No other result was substituted.', reconciliation_required: 'The original preparation needs reconciliation before it can continue.',
};
const incompleteText: Record<NonNullable<PublicationRecord['scan']>['reason'] & string, string> = {
  commit_limit: 'Commit scan limit reached.', path_limit: 'Path scan limit reached.', version_limit: 'File-version scan limit reached.', blob_limit: 'Blob processing limit reached.',
  aggregate_limit: 'Aggregate processing limit reached.', findings_limit: 'Finding count limit reached.', evidence_limit: 'Evidence size limit reached.', timeout: 'Scan processing timed out.',
  unsupported_path: 'A filename could not be scanned safely.', unsupported_ignore: 'Ignore rules could not be evaluated completely.', missing_object: 'A required Git object is missing.',
  unverified_parent: 'A public parent could not be verified.', retained_unavailable: 'Required retained evidence is unavailable.',
};
const eligible = (finding: PublicationFinding) => finding.override_eligible && !['provider_hard_size', 'workflow_permission', 'published_credential'].includes(finding.kind);

export function PublicationCandidates({ props, result }: { props: TaskViewProps; result: TaskLocalResult }) {
  const task = props.task.task_id, source = result.manifest.operation_id, session = props.commands.sessionId;
  const [selected, setSelected] = useState<{ operation?: string; candidate?: string }>(), [direct, setDirect] = useState(''), [directError, setDirectError] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['tasks', task, 'publication', session, source], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => publicationCandidates(task, { source_operation_id: source, ...(pageParam ? { cursor: pageParam } : {}) }, session, signal),
    getNextPageParam: page => page.next_cursor, retry: false, refetchInterval: 3000,
  });
  const items = unique(query.data?.pages.flatMap(page => page.items) ?? [], record => record.operation_id);
  useEffect(() => { const preferred = items.find(item => item.scan_applicable) ?? items.find(item => item.current) ?? items[0]; if (!selected && preferred) setSelected({ operation: preferred.operation_id }); }, [selected, items]);
  const detail = useQuery({
    queryKey: ['tasks', task, 'publication-candidate', session, source, selected?.candidate],
    queryFn: ({ signal }) => publicationCandidate(task, selected!.candidate!, session, source, signal), enabled: !!selected?.candidate, retry: false, refetchInterval: 3000,
  });
  useEffect(() => { if ([query.error, detail.error].some(error => error instanceof APIError && error.code === 'unauthorized')) props.onUnauthorized(); }, [query.error, detail.error, props.onUnauthorized]);
  const record = selected?.candidate ? detail.data : items.find(item => item.operation_id === selected?.operation);
  return <section className="publication-candidate" aria-label="Local publication candidate">
    <h4>Local publication candidate</h4>
    <ReadProblem error={query.error ?? detail.error} retry={() => { void query.refetch(); if (selected?.candidate) void detail.refetch(); }} />
    {query.isPending && <p role="status">Reading local preparation…</p>}
    {!items.length && !query.isPending && !query.error && <p className="task-muted">No local preparation is recorded for this result yet.</p>}
    {items.length > 1 && <details><summary>Candidate and scan history · {items.length} loaded</summary><div className="publication-history" role="group" aria-label="Candidate history">
      {items.map(item => <Button key={item.operation_id} variant={selected?.operation === item.operation_id ? 'secondary' : 'outline'} aria-pressed={selected?.operation === item.operation_id} onClick={() => setSelected({ operation: item.operation_id })}>
        {item.scan_applicable ? 'Applicable scan' : item.current ? 'Current source · historical scan' : 'Historical source'} · {item.scan?.status ?? human(item.status)} · {item.operation_id}
      </Button>)}
    </div></details>}
    <More hasMore={query.hasNextPage} busy={query.isFetchingNextPage} load={query.fetchNextPage} label="Load older candidates" />
    <details><summary>Open an exact candidate</summary><form className="task-actions" onSubmit={event => { event.preventDefault(); try { validate('Id', direct); setDirectError(''); setSelected({ candidate: direct }); } catch { setDirectError('Enter a valid candidate ID.'); } }}>
      <label>Candidate ID<Input required maxLength={128} value={direct} onChange={event => setDirect(event.target.value)} /></label><Button type="submit" variant="outline">Open candidate's latest scan</Button>
    </form>{directError && <p role="alert">{directError}</p>}</details>
    {detail.isFetching && selected?.candidate && <p role="status">Reading selected candidate…</p>}
    {record && <Candidate key={`${session}:${record.operation_id}:${record.scan_digest ?? 'pending'}`} props={props} record={record} />}
  </section>;
}

function Candidate({ props, record }: { props: TaskViewProps; record: PublicationRecord }) {
  return <div className="publication-record">
    <p><strong>{record.current ? 'Current candidate evidence' : 'Historical candidate evidence'}</strong>{record.scan && <span> · {record.scan_applicable ? 'Scan applicable' : 'Scan historical or configuration changed'}</span>}</p>
    <p role="status">{statusText[record.status]}</p>
    {record.remote_preparation === 'after_acceptance' && <p className="task-muted">Remote preparation is deferred until acceptance. Local checks still run.</p>}
    <p className="task-muted">Local preparation creates no PR, publication or accepted delivery.</p>
    {record.mapping && <p className="task-notice">Reused published manifest · its original source and public parents stay unchanged. The current source, effective basis and scan below belong to this exact mapping.</p>}
    {record.candidate && <dl>
      <Datum label="Candidate head"><code>{record.candidate.head}</code></Datum>
      <Datum label="Exact result tree"><code>{record.candidate.tree}</code></Datum>
      <Datum label="Verified public parents">{record.candidate.parents.map(parent => <code className="publication-parent" key={parent}>{parent}</code>)}</Datum>
    </dl>}
    <DetailIDs><dl>
      <Datum label="Original result commit"><code>{record.source.git_commit}</code></Datum>
      <Datum label="Original Specification">{record.source.specification_id}</Datum><Datum label="Original Plan">{record.source.plan_id}</Datum>
      <Datum label="Effective Specification">{record.effective_basis.specification_id}</Datum><Datum label="Effective Plan">{record.effective_basis.plan_id}</Datum>
      <Datum label="Preparation operation">{record.operation_id}</Datum><Datum label="Source identity">{record.source_digest}</Datum><Datum label="Effective basis">{record.effective_basis_digest}</Datum>
      {record.mapping && <><Datum label="Exact mapping">{record.mapping_digest}</Datum><Datum label="Reused manifest original source">{record.candidate?.source_digest}</Datum><Datum label="Published proof">{record.mapping.published_digest}</Datum></>}
      {record.candidate && <Datum label="Candidate identity">{record.candidate_manifest_digest}</Datum>}
      {record.scan && <><Datum label="Scan identity">{record.scan_digest}</Datum><Datum label="Configuration identity">{record.scan.configuration_digest}</Datum>
        <Datum label="Observed scan coverage">{record.scan.coverage.commits} commits · {record.scan.coverage.paths} paths · {record.scan.coverage.versions} versions · {record.scan.coverage.unique_blob_bytes} unique blob bytes observed</Datum></>}
    </dl></DetailIDs>
    {record.scan?.status === 'incomplete' && <p className="task-notice" role="status">Scan incomplete · {record.scan.reason ? incompleteText[record.scan.reason] : 'Coverage is incomplete.'} Incomplete coverage cannot be overridden.</p>}
    {record.scan?.status === 'complete' && <p className="task-notice">{record.scan.findings_count ? `Local scan complete · ${record.scan.findings_count} redacted findings recorded.` : record.known_public_exposure_count > 0 ? 'Current scan complete with no new findings.' : 'Local publication checks complete for this exact candidate.'} Passing configured rules does not establish that a result is secret-free.</p>}
    {record.known_public_exposure_count > 0 && <p className="task-notice" role="status"><strong>Known published credential exposure · {record.known_public_exposure_count} retained {record.known_public_exposure_count === 1 ? 'fact' : 'facts'}.</strong> Remediation is still required. A clean scan, deletion or policy override cannot clear this blocking history.</p>}
    {record.retry_allowed && record.current && <Button variant="outline" disabled={!!props.commands.storageError || props.commands.entries(props.task.task_id).some(entry => entry.scope === `publication-retry:${record.operation_id}` && (entry.busy || !!entry.pending))} onClick={() => { void props.commands.execute(props.task.task_id, `publication-retry:${record.operation_id}`, { family: 'publication', command: { schema_version: 1, request_id: crypto.randomUUID(), task_id: props.task.task_id, name: 'retry_publication_preparation', payload: { operation_id: record.operation_id, operation_digest: record.request_digest } } }); }}>Retry local preparation</Button>}
    {!record.current && <p className="task-muted">Retained history grants no current preparation or override authority.</p>}
    {record.scan && record.candidate && record.scan_digest && <Findings key={record.scan_digest} props={props} record={record} />}
    {record.override_receipt_ids.length > 0 && <details><summary>Exact override receipts · {record.override_receipt_ids.length}</summary>{record.override_receipt_ids.map(id => <p key={id}><code>{id}</code></p>)}<p className="task-muted">Receipts retain findings and grant no remote-write authority.</p></details>}
  </div>;
}

type Selection = Required<Pick<PublicationCommand['payload'], 'candidate_id' | 'candidate_manifest_digest' | 'effective_basis_digest' | 'scan_digest' | 'finding_ids'>> & Pick<PublicationCommand['payload'], 'mapping_digest'>;
interface Review { selection: Selection; head: string; tree: string; parents: string[]; configuration_digest: string; step: PublicationCommand; stage: 'prepare' | 'confirm' | 'apply' | 'done'; receipt_id?: string }
function parseReview(text: string): Review | undefined {
  if (!text) return undefined;
  const value: Review = JSON.parse(text);
  validate('PublicationCommand', value.step);
  validate('PublicationCommand', { schema_version: 1, request_id: 'review', task_id: value.step.task_id, name: 'prepare_publication_override', payload: value.selection });
  if (!['prepare', 'confirm', 'apply', 'done'].includes(value.stage) || !Array.isArray(value.parents) || !value.parents.length || value.parents.length > 2 || Object.keys(value).some(key => !['selection', 'head', 'tree', 'parents', 'configuration_digest', 'step', 'stage', 'receipt_id'].includes(key))) throw new Error('Invalid saved review');
  for (const oid of [value.head, value.tree, ...value.parents]) validate('GitOID', oid);
  validate('SHA256', value.configuration_digest);
  if (value.step.name !== ({ prepare: 'prepare_publication_override', confirm: 'confirm_publication_override', apply: 'override_publication_findings', done: 'override_publication_findings' } as const)[value.stage]) throw new Error('Invalid saved step');
  if (value.stage === 'prepare' && JSON.stringify(value.step.payload) !== JSON.stringify(value.selection)) throw new Error('Saved selection changed');
  if (value.stage === 'apply' || value.stage === 'done') {
    const selection = { ...value.step.payload }; delete selection.confirmation_id;
    if (JSON.stringify(selection) !== JSON.stringify(value.selection)) throw new Error('Saved selection changed');
  }
  if (value.receipt_id !== undefined) validate('Id', value.receipt_id);
  return value;
}

function Findings({ props, record }: { props: TaskViewProps; record: PublicationRecord }) {
  const task = props.task.task_id, session = props.commands.sessionId, candidate = record.candidate!, scan = record.scan!, scanDigest = record.scan_digest!;
  const [selected, setSelected] = useState<string[]>([]), mounted = useRef(true), epoch = useRef(taskStorageEpoch());
  useEffect(() => () => { mounted.current = false; }, []);
  const query = useInfiniteQuery({
    queryKey: ['tasks', task, 'publication-findings', session, candidate.candidate_id, scanDigest], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => publicationFindings(task, record, { scan_digest: scanDigest, ...(pageParam ? { cursor: pageParam } : {}) }, session, signal),
    getNextPageParam: page => page.next_cursor, retry: false, staleTime: Infinity,
  });
  useEffect(() => { if (query.error instanceof APIError && query.error.code === 'unauthorized') props.onUnauthorized(); }, [query.error, props.onUnauthorized]);
  const items = unique(query.data?.pages.flatMap(page => page.items) ?? [], finding => finding.finding_id);
  const scope = `publication-override:${record.operation_id}:${scan.scan_id}`;
  const pending = props.commands.entries(task).find(entry => entry.scope === scope), busy = !!pending?.busy || !!props.commands.storageError;
  let review: Review | undefined, corrupt = false;
  try { review = parseReview(props.commands.getDraft(task, scope).text); } catch { corrupt = true; }
  const canOverride = record.current && record.scan_applicable && record.override_allowed && scan.status === 'complete';
  const sameReview = review && review.step.task_id === task && review.selection.mapping_digest === record.mapping_digest && review.selection.candidate_id === candidate.candidate_id && review.selection.candidate_manifest_digest === record.candidate_manifest_digest && review.selection.effective_basis_digest === record.effective_basis_digest && review.selection.scan_digest === scanDigest && review.configuration_digest === scan.configuration_digest && review.head === candidate.head && review.tree === candidate.tree && JSON.stringify(review.parents) === JSON.stringify(candidate.parents);
  function save(value: Review) { props.commands.setDraft(task, scope, JSON.stringify(value)); }
  async function step(value: Review) {
    const receipt = pending?.pending ? await props.commands.recover(task, scope) : await props.commands.execute(task, scope, { family: 'publication', command: value.step });
    if (!receipt || !mounted.current || epoch.current !== taskStorageEpoch()) return;
    if (value.stage === 'prepare' && 'proposal_id' in receipt && receipt.proposal_id && 'content_digest' in receipt && receipt.content_digest) save({ ...value, stage: 'confirm', step: { schema_version: 1, task_id: task, request_id: crypto.randomUUID(), name: 'confirm_publication_override', payload: { proposal_id: receipt.proposal_id, content_digest: receipt.content_digest } } });
    else if (value.stage === 'confirm' && 'confirmation_id' in receipt && receipt.confirmation_id) save({ ...value, stage: 'apply', step: { schema_version: 1, task_id: task, request_id: crypto.randomUUID(), name: 'override_publication_findings', payload: { ...value.selection, confirmation_id: receipt.confirmation_id } } });
    else if (value.stage === 'apply' && 'receipt_id' in receipt && receipt.receipt_id) save({ ...value, stage: 'done', receipt_id: receipt.receipt_id });
  }
  return <div className="publication-findings">
    <h5>Publication findings</h5><ReadProblem error={query.error} retry={query.refetch} />
    {query.isPending && <p role="status">Reading redacted findings…</p>}
    <p className="task-muted">{items.length} of {scan.findings_count} findings loaded. Matching values and sensitive filenames are withheld.</p>
    <ul className="publication-finding-list">{items.map(finding => <li key={finding.finding_id}>
      <label className="publication-finding-choice"><Checkbox aria-label={`Select finding ${finding.occurrence_ordinal}: ${human(finding.kind)}`} disabled={!canOverride || !eligible(finding) || !!review || !!pending?.pending || selected.length >= 64 && !selected.includes(finding.finding_id)} checked={selected.includes(finding.finding_id)} onCheckedChange={checked => setSelected(ids => checked ? [...ids, finding.finding_id] : ids.filter(id => id !== finding.finding_id))} /><strong>{finding.message}</strong></label>
      <p className="publication-path">{finding.path_redacted ? '[redacted credential path]' : finding.path}</p>
      <p className="task-muted">{eligible(finding) ? 'Eligible policy finding' : 'Cannot be overridden'} · {human(finding.scope)} · Rule {finding.rule_id}</p>
      {finding.size !== undefined && <p className="task-muted">Measured {finding.size} bytes · limit {finding.limit} bytes</p>}
      <details><summary>Finding provenance</summary><dl><Datum label="Commit"><code>{finding.commit}</code></Datum>{finding.blob && <Datum label="Blob"><code>{finding.blob}</code></Datum>}{finding.content_digest && <Datum label="Full content digest">{finding.content_digest}</Datum>}
        {finding.baseline_commit && <><Datum label="Public baseline"><code>{finding.baseline_commit}</code></Datum><Datum label="Public baseline path">{finding.baseline_path_redacted ? '[redacted credential path]' : finding.baseline_path}</Datum></>}
        <Datum label="Finding identity">{finding.finding_id}</Datum><Datum label="Occurrence">{finding.occurrence_ordinal}</Datum></dl></details>
    </li>)}</ul>
    <More hasMore={query.hasNextPage} busy={query.isFetchingNextPage} load={query.fetchNextPage} label="Load more findings" />
    {corrupt && <p role="alert">Saved override review is incompatible. Resolve existing pending requests before discarding it.</p>}
    {!review && !corrupt && canOverride && <Button variant="outline" disabled={!selected.length || busy || !!pending?.pending} onClick={() => {
      const selection: Selection = { candidate_id: candidate.candidate_id, candidate_manifest_digest: record.candidate_manifest_digest!, effective_basis_digest: record.effective_basis_digest, scan_digest: scanDigest, finding_ids: [...selected].sort() as Selection['finding_ids'], ...(record.mapping_digest ? { mapping_digest: record.mapping_digest } : {}) };
      const value: Review = { selection, head: candidate.head, tree: candidate.tree, parents: candidate.parents, configuration_digest: scan.configuration_digest, stage: 'prepare', step: { schema_version: 1, task_id: task, request_id: crypto.randomUUID(), name: 'prepare_publication_override', payload: selection } };
      save(value); void step(value);
    }}>Review selected policy override</Button>}
    {!canOverride && scan.findings_count > 0 && <p className="task-muted">Override unavailable for this evidence. Hard provider limits, unverified workflow permission, published exposure and incomplete scans cannot be waived.</p>}
    {review && <section className="publication-override-review" aria-label="Exact finding override review">
      <h5>Exact policy override</h5><p>Only these selected findings are covered. The findings remain recorded; this grants no publication or acceptance authority.</p>
      {review.selection.mapping_digest && <p>Exact published-result mapping · <code>{review.selection.mapping_digest}</code></p>}
      <dl><Datum label="Candidate head"><code>{review.head}</code></Datum><Datum label="Result tree"><code>{review.tree}</code></Datum><Datum label="Public parents">{review.parents.map(parent => <code className="publication-parent" key={parent}>{parent}</code>)}</Datum><Datum label="Scan">{review.selection.scan_digest}</Datum><Datum label="Configuration">{review.configuration_digest}</Datum><Datum label="Effective basis">{review.selection.effective_basis_digest}</Datum><Datum label="Selected finding IDs">{review.selection.finding_ids.map(id => <code className="publication-parent" key={id}>{id}</code>)}</Datum></dl>
      {!sameReview && <p role="alert">This review's exact evidence has changed. It cannot authorize the new evidence.</p>}
      {review.stage === 'done' ? <p role="status">Exact override recorded · {review.receipt_id}</p> : <Button variant="outline" disabled={busy || !sameReview || !canOverride} onClick={() => { void step(review!); }}>{pending?.pending || review.stage === 'prepare' ? 'Check original override step' : review.stage === 'confirm' ? 'Confirm exact policy override' : 'Record confirmed override'}</Button>}
    </section>}
    {(review || corrupt) && !pending?.pending && !busy && <Button variant="ghost" onClick={() => { props.commands.clearDraft(task, scope); setSelected([]); }}>Close override review</Button>}
  </div>;
}
