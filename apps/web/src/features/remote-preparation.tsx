import { randomUUID } from '../lib/browser-crypto.ts';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { RemotePreparationRecord } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { APIError } from '../lib/api.ts';
import { remoteChecks, remotePreparation, remotePreparations, remoteRowKey } from '../lib/remote-preparation-api.ts';
import { Datum, DetailIDs, human, More, ReadProblem, unique } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

const status: Record<RemotePreparationRecord['status'], string> = {
  local_only: 'Remote preparation is deferred. Local inspection and checks remain available.',
  preparing: 'Preparing the remote delivery branch.',
  paused_input: 'Remote preparation is paused for unresolved Task input or change.',
  offline: 'The owning Runner is offline. Retained remote work is not replaced.',
  unsupported: 'The owning Runner does not support remote preparation.',
  access_denied: 'Remote access is unavailable. Restore the configured repository grant before recovery.',
  reconciling: 'Reconciling the original admitted effect before another mutation.',
  prepared: 'The review request is prepared. Owner acceptance is separate.',
  failed: 'The recorded remote step failed. Its original evidence is retained.',
  cancel_cleanup: 'Task cancelled. Reconciling admitted effects and closing only its owned undelivered PR.',
  cancelled: 'Cancellation cleanup recorded. The delivery branch is retained.',
  reconciliation_required: 'The remote outcome remains uncertain. Reconciliation must settle it before another write.',
};
const sameScope = (row: RemotePreparationRecord, latest: RemotePreparationRecord) => remoteRowKey(row) === remoteRowKey(latest) && row.source_digest === latest.source_digest && row.effective_basis_digest === latest.effective_basis_digest && row.candidate_manifest_digest === latest.candidate_manifest_digest && row.scan_digest === latest.scan_digest && row.mapping_digest === latest.mapping_digest && row.operation?.request_digest === latest.operation?.request_digest;

export function RemotePreparations(props: TaskViewProps) {
  const task = props.task.task_id, session = props.commands.sessionId;
  const [selected, setSelected] = useState<RemotePreparationRecord>();
  const query = useInfiniteQuery({
    queryKey: ['tasks', task, 'remote-preparation', session], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => remotePreparations(task, pageParam ? { cursor: pageParam } : {}, session, signal),
    getNextPageParam: page => page.next_cursor, retry: false, refetchInterval: 3000,
  });
  const rows = unique(query.data?.pages.flatMap(page => page.items) ?? [], remoteRowKey);
  useEffect(() => { if (!selected && rows.length) setSelected(rows.find(row => row.current) ?? rows[0]); }, [rows, selected]);
  const record = selected && (rows.find(row => remoteRowKey(row) === remoteRowKey(selected)) ?? selected);
  const latest = useQuery({
    queryKey: ['tasks', task, 'remote-preparation-current', session, record?.item_id, record?.operation?.operation_id ?? 'local-only'],
    queryFn: ({ signal }) => remotePreparation(task, record!.item_id, session, signal), enabled: !!record, retry: false, refetchInterval: 3000,
  });
  useEffect(() => { if ([query.error, latest.error].some(error => error instanceof APIError && error.code === 'unauthorized')) props.onUnauthorized(); }, [query.error, latest.error, props.onUnauthorized]);
  return <section className="task-section remote-preparation" aria-label="Remote review preparation">
    <h2>Remote review preparation</h2>
    <p className="task-muted">Background preparation and provider observations do not accept delivery or complete the Task.</p>
    <ReadProblem error={query.error ?? latest.error} retry={() => { void query.refetch(); if (record) void latest.refetch(); }} />
    {query.isPending && <p role="status">Reading remote preparation…</p>}
    {!rows.length && !query.isPending && !query.error && <p className="task-muted">No remote preparation is recorded. Local result inspection remains available.</p>}
    {rows.length > 1 && <details><summary>Remote operation history · {rows.length} loaded</summary><div className="remote-history" role="group" aria-label="Remote operation history">
      {rows.map(row => <Button key={remoteRowKey(row)} variant={record && remoteRowKey(row) === remoteRowKey(record) ? 'secondary' : 'outline'} aria-pressed={!!record && remoteRowKey(row) === remoteRowKey(record)} onClick={() => setSelected(row)}>
        {row.current ? 'Current' : 'Historical'} · {row.operation ? `${human(row.operation.kind)} · ${row.operation.operation_id}` : `Local only · ${row.item_id}`}
      </Button>)}
    </div></details>}
    <More hasMore={query.hasNextPage} busy={query.isFetchingNextPage} load={query.fetchNextPage} label="Load older remote operations" />
    {record && <RemoteRecord key={`${session}:${remoteRowKey(record)}`} props={props} record={record} latest={latest.data} fresh={latest.isSuccess && !latest.error} />}
  </section>;
}

function RemoteRecord({ props, record, latest, fresh }: { props: TaskViewProps; record: RemotePreparationRecord; latest?: RemotePreparationRecord; fresh: boolean }) {
  const matched = fresh && !!latest && sameScope(record, latest);
  const overviewCurrent = props.task.state === 'REVIEW' && record.effective_basis.specification_id === props.task.specification_id && record.effective_basis.plan_id === props.task.plan_id;
  const current = overviewCurrent && matched && record.current && latest.current;
  const operation = record.operation;
  const exactVersion = matched && operation?.version === latest.operation?.version;
  const ordinary = exactVersion && current && latest.retry_allowed;
  const cleanup = exactVersion && latest.cleanup_allowed;
  const admittedEffect = !!operation && (operation.may_have_mutated || operation.reconcile_only || operation.state === 'started' || operation.state === 'unknown');
  const readRecovery = exactVersion && latest.read_retry_allowed && (admittedEffect || current);
  const scope = `remote-retry:${record.item_id}:${operation?.operation_id ?? 'local-only'}`;
  const entry = props.commands.entries(props.task.task_id).find(entry => entry.scope === scope);
  return <article className="remote-record" aria-label="Selected remote operation">
    <p><strong>{current ? 'Current remote evidence' : fresh ? 'Historical remote evidence' : 'Checking current remote applicability…'}</strong></p>
    <p className="task-muted">{current && record.scan_applicable && latest.scan_applicable ? 'The exact local scan remains applicable.' : 'The retained scan grants no current publication authority.'}</p>
    <p role="status">{record.delivery_kind === 'git_branch' && record.status === 'prepared' ? 'The delivery branch is published. Owner acceptance and final verification are separate.' : status[record.status]}</p>
    {record.reason && <p className="task-notice">Reason · {human(record.reason)}{record.reason === 'input_pending' && ' · Resolve the actual input, proposal, issue or guidance in Task Conversation.'}</p>}
    <dl><Datum label="Repository">{record.repository_identity}</Datum><Datum label="Delivery branch"><code>{record.delivery_ref}</code></Datum><Datum label="Fixed target">{record.target_branch}</Datum><Datum label="Candidate head"><code>{record.candidate.head}</code></Datum><Datum label="Exact result tree"><code>{record.candidate.tree}</code></Datum>
      {record.published && <Datum label="Verified published head"><code>{record.published.candidate.head}</code></Datum>}
    </dl>
    {record.mapping && <p className="task-notice">Same-tree result mapping · the current result reuses the unchanged published head. Its old candidate manifest and original source remain immutable; the current mapping and scan grant no new acceptance authority.</p>}
    {record.review && <p><a href={record.review.url} target="_blank" rel="noreferrer">Open PR #{record.review.pr_number}</a> · {human(record.review.state)}{record.review.state === 'merged' && ' · Provider state does not establish Owner acceptance.'}</p>}
    {record.known_public_exposure_count > 0 && <p className="task-notice">Known published credential exposure · {record.known_public_exposure_count} retained facts require remediation. Deletion, clean scans and eligible overrides cannot clear this guard.</p>}
    {record.cooldown_until && <p className="task-notice">Provider cooldown until {record.cooldown_until}. Retry cannot bypass this limit.</p>}
    {operation && <p className="task-muted">Recorded step · {human(operation.kind)} · {human(operation.state)}{operation.reconcile_only || operation.may_have_mutated ? ' · Reconciliation retains the original effect identity.' : ''}{operation.next_attempt_at ? ` · Next attempt no earlier than ${operation.next_attempt_at}` : ''}</p>}
    <DetailIDs><dl>
      <Datum label="Delivery item">{record.item_id}</Datum><Datum label="Resource">{record.resource_id}</Datum><Datum label="Original result">{record.source.operation_id}</Datum><Datum label="Original Specification">{record.source.specification_id}</Datum><Datum label="Original Plan">{record.source.plan_id}</Datum>
      <Datum label="Effective Specification">{record.effective_basis.specification_id}</Datum><Datum label="Effective Plan">{record.effective_basis.plan_id}</Datum><Datum label="Source digest">{record.source_digest}</Datum><Datum label="Effective basis">{record.effective_basis_digest}</Datum><Datum label="Candidate manifest">{record.candidate_manifest_digest}</Datum>
      <Datum label="Manifest original source">{record.candidate.source_digest}</Datum><Datum label="Public parents">{record.candidate.parents.map(parent => <code className="publication-parent" key={parent}>{parent}</code>)}</Datum><Datum label="Exact scan">{record.scan_digest}</Datum>
      {record.mapping_digest && <Datum label="Exact mapping">{record.mapping_digest}</Datum>}{record.published_digest && <Datum label="Published proof">{record.published_digest}</Datum>}
      {operation && <><Datum label="Operation">{operation.operation_id}</Datum><Datum label="Request digest">{operation.request_digest}</Datum><Datum label="Operation version">{operation.version}</Datum><Datum label="Physical worker absence">{operation.worker_absent ? 'Recorded absent' : 'Not established'}</Datum></>}
    </dl></DetailIDs>
    {record.delivery_kind === 'git_branch' ? <p className="task-muted">Delivery branch publication is preparation. Final delivery requires exact Owner acceptance and a fresh branch verification; merge into the target branch manually.</p> : record.checks ? <Checks key={record.checks.observation_id} props={props} record={record} latest={latest} current={current} /> : <p className="task-muted">No provider checks observation is recorded. Missing checks are not passing checks.</p>}
    {operation && (record.retry_allowed || record.cleanup_allowed || record.read_retry_allowed || ordinary || cleanup || readRecovery) && <Button variant="outline" disabled={!ordinary && !cleanup && !readRecovery || entry?.busy || !!entry?.pending || !!props.commands.storageError} onClick={() => { void props.commands.execute(props.task.task_id, scope, { family: 'remote-preparation', command: { schema_version: 1, task_id: props.task.task_id, request_id: randomUUID(), name: 'retry_remote_preparation', payload: { operation_id: operation.operation_id, operation_digest: operation.request_digest, expected_version: operation.version } } }); }}>{cleanup ? 'Retry cancellation cleanup' : !ordinary && admittedEffect ? 'Reconcile original remote effect' : 'Retry remote preparation'}</Button>}
    {!current && !cleanup && <p className="task-muted">Historical observations grant no ordinary retry authority. Current applicability is checked independently of the selected bytes.</p>}
  </article>;
}

function Checks({ props, record, latest, current }: { props: TaskViewProps; record: RemotePreparationRecord; latest?: RemotePreparationRecord; current: boolean }) {
  const expected = record.checks!;
  const query = useInfiniteQuery({
    queryKey: ['tasks', props.task.task_id, 'remote-checks', props.commands.sessionId, record.item_id, record.operation?.operation_id ?? 'local-only', expected.observation_id, expected.head, expected.base_head], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => remoteChecks(props.task.task_id, record, pageParam ? { cursor: pageParam } : {}, props.commands.sessionId, signal),
    getNextPageParam: page => page.next_cursor, retry: false, refetchInterval: 3000,
  });
  useEffect(() => { if (query.error instanceof APIError && query.error.code === 'unauthorized') props.onUnauthorized(); }, [query.error, props.onUnauthorized]);
  const observation = query.data?.pages[0]?.observation ?? expected;
  const headCurrent = current && latest?.checks?.observation_id === expected.observation_id && latest.checks.current && latest.checks.head === expected.head && latest.checks.base_head === expected.base_head && !query.error && !!query.data?.pages.length && query.data.pages.every(page => page.observation.current && page.observation.complete && !page.observation.stale);
  const checks = unique(query.data?.pages.flatMap(page => page.items) ?? [], check => `${check.kind}:${check.provider_id}`);
  return <section className="remote-checks" aria-label="Exact head provider observations">
    <h3>Provider observations</h3>
    <p><strong>{headCurrent ? 'Current exact-head observations' : 'Historical or incomplete observations'}</strong> · {human(observation.aggregate)} · {observation.complete ? 'Complete observation' : 'Incomplete observation'}</p>
    <p className="task-muted">Observed {observation.observed_at} · Head <code>{observation.head}</code> · Base <code>{observation.base_head}</code></p>
    <p>Mergeability · {human(observation.mergeability)}. Required check readiness is unknown; these observations grant no merge or acceptance authority.</p>
    <ReadProblem error={query.error} retry={query.refetch} />
    {query.isPending && <p role="status">Reading exact-head checks…</p>}
    {!checks.length && !query.isPending && !query.error && <p className="task-muted">No checks are recorded in this observation.</p>}
    <ul className="remote-check-list">{checks.map(check => <li key={`${check.kind}:${check.provider_id}`}><strong>{check.name}</strong><span>{human(check.kind)} · {human(check.state)}{check.conclusion ? ` · ${human(check.conclusion)}` : ''}</span></li>)}</ul>
    <p className="task-muted">{checks.length} check entries loaded.</p>
    <More hasMore={query.hasNextPage} busy={query.isFetchingNextPage} load={query.fetchNextPage} label="Load more checks" />
  </section>;
}
