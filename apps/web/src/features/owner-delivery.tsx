import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DeliveryAcceptanceManifest, DeliveryBatch, DeliveryBatchSummary, DeliveryProposalSummary, OwnerDeliveryCommandName, OwnerDeliveryPayload } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../components/ui/dialog.tsx';
import { APIError } from '../lib/api.ts';
import { ownerDeliveryBatch, ownerDeliveryProposal, ownerDeliveryStatus } from '../lib/owner-delivery-api.ts';
import { Busy, Datum, DetailIDs, Empty, human, MarkdownText, ReadProblem, taskHref } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

const reasonText: Record<string, string> = {
  not_review: 'Acceptance becomes available when the current work reaches Review.',
  no_plan: 'The current Plan has not been published.',
  accepted: 'This result has already been accepted. Delivery follows its frozen batch.',
  terminal: 'This Task is terminal. Its accepted history remains available.',
  unsupported_mode: 'Automatic acceptance currently supports zero or one modified GitHub repository with automatic preparation.',
  input_pending: 'Resolve the earlier input or decision in Conversation before accepting.',
  work_unsettled: 'Current work or physical workspace effects still need to settle.',
  permission_unknown: 'Verified repository permissions are missing or unavailable.',
  expired_permission: 'The same repository permission scope needs to be refreshed.',
  scan_incomplete: 'The complete scan of the exact publication candidate is unavailable.',
  findings_blocked: 'Publication findings require an eligible exact policy decision or correction.',
  source_changed: 'The reviewed result is no longer current. Prepare a new review.',
  configuration_changed: 'Repository configuration changed. The old review cannot authorize a changed result.',
  known_public_exposure: 'Recorded publication exposure requires remediation.',
  retained_unavailable: 'The exact retained result or preparation evidence is unavailable.',
  identity_mismatch: 'The exact result identities could not be verified.',
  possible_publication: 'An earlier remote effect must be reconciled before acceptance.',
  reconciliation_required: 'The original remote effect needs reconciliation.',
  authority_invalid: 'The recorded approval authority could not be verified.',
};
const explain = (reason: string) => reasonText[reason] ?? human(reason);
function deliveryCommand(props: TaskViewProps, scope: string, name: OwnerDeliveryCommandName, payload: OwnerDeliveryPayload) {
  return props.commands.execute(props.task.task_id, scope, { family: 'delivery', command: { schema_version: 1, task_id: props.task.task_id, request_id: crypto.randomUUID(), name, payload } });
}
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
function useReadError(error: Error | null, unauthorized: () => void) {
  useEffect(() => { if (error instanceof APIError && error.code === 'unauthorized') unauthorized(); }, [error, unauthorized]);
}

export function OwnerDelivery(props: TaskViewProps) {
  const session = props.commands.sessionId, task = props.task.task_id;
  const status = useQuery({ queryKey: ['tasks', task, 'delivery', session], queryFn: ({ signal }) => ownerDeliveryStatus(task, session, signal), retry: false, refetchInterval: 3000 });
  useReadError(status.error, props.onUnauthorized);
  const mounted = useMounted();
  const [selectedProposal, selectProposal] = useState<DeliveryProposalSummary>();
  const [selectedBatch, selectBatch] = useState<DeliveryBatchSummary>();
  const [proposalPages, setProposalPages] = useState<string[]>([]);
  const [batchPages, setBatchPages] = useState<string[]>([]);
  const proposalCursor = proposalPages.at(-1), batchCursor = batchPages.at(-1);
  const proposalHistory = useQuery({ queryKey: ['tasks',task,'delivery-history',session,'proposals',proposalCursor], queryFn: ({signal}) => ownerDeliveryStatus(task,session,signal,{proposal_cursor:proposalCursor}), enabled: !!proposalCursor, retry: false });
  const batchHistory = useQuery({ queryKey: ['tasks',task,'delivery-history',session,'batches',batchCursor], queryFn: ({signal}) => ownerDeliveryStatus(task,session,signal,{batch_cursor:batchCursor}), enabled: !!batchCursor, retry: false });
  useReadError(proposalHistory.error, props.onUnauthorized); useReadError(batchHistory.error, props.onUnauthorized);
  const data = status.data;
  const proposalPage = proposalCursor ? proposalHistory.data : data;
  const batchPage = batchCursor ? batchHistory.data : data;
  const pointer = data?.accepted_delivery_operation_id ?? props.task.accepted_delivery_operation_id;
  const summary = selectedProposal ? data?.proposals.find(value => value.proposal_id === selectedProposal.proposal_id) ?? proposalPage?.proposals.find(value => value.proposal_id === selectedProposal.proposal_id) ?? selectedProposal : data?.proposals.find(value => value.current);
  const batch = selectedBatch ? data?.batches.find(value => value.operation_id === selectedBatch.operation_id) ?? batchPage?.batches.find(value => value.operation_id === selectedBatch.operation_id) ?? selectedBatch : data?.batches.find(value => value.operation_id === pointer) ?? (!pointer ? data?.batches[0] : undefined);
  const acceptanceFresh = !!data && status.isSuccess && !status.error && data.accept_allowed && !!data.basis.plan_id && props.task.state === 'REVIEW' && data.basis.specification_id === props.task.specification_id && data.basis.plan_id === props.task.plan_id && !pointer;
  const preparing = Busy({ commands: props.commands, taskId: task, scope: 'delivery-prepare' });
  async function prepare() {
    if (!acceptanceFresh || !data?.basis.plan_id) return;
    const result = await deliveryCommand(props, 'delivery-prepare', 'prepare_delivery_acceptance', { basis: { ...data.basis, plan_id: data.basis.plan_id } });
    if (mounted.current && result && 'proposal_id' in result && result.proposal_id && 'content_digest' in result && result.content_digest) {
      const refreshed = await status.refetch();
      if (mounted.current) selectProposal(refreshed.data?.proposals.find(value => value.proposal_id === result.proposal_id));
    }
  }
  return <section className="task-section" aria-label="Owner delivery">
    <div className="task-section-heading"><h2>Acceptance and delivery</h2></div>
    <ReadProblem error={status.error} retry={status.refetch} />
    {status.isPending && <p role="status">Reading exact acceptance and delivery…</p>}
    {data && <>
      {!pointer && <>
        <p>Review the complete result before accepting. Acceptance freezes this version and the conversation cutoff.</p>
        {!acceptanceFresh && <p className="task-muted">{data.reason ? explain(data.reason) : 'Current acceptance eligibility is being checked.'}</p>}
        <div className="task-actions"><Button className="max-sm:min-h-11" variant={summary ? 'outline' : 'default'} disabled={!acceptanceFresh || preparing} onClick={() => { void prepare(); }}>{summary ? 'Prepare new review' : 'Prepare exact review'}</Button></div>
      </>}
      {summary && <ProposalReview key={`${session}:${task}:${summary.proposal_id}`} {...props} summary={summary} enabled={acceptanceFresh && summary.current} />}
      {(data.proposals.length > 0 || proposalCursor) && <details className="task-advanced"><summary>Prepared reviews</summary>
        <ReadProblem error={proposalHistory.error} retry={proposalHistory.refetch} />
        {proposalCursor && proposalHistory.isPending && <p role="status">Reading older reviews…</p>}
        <div className="task-actions">{proposalPage?.proposals.map(value => <Button key={value.proposal_id} variant={summary?.proposal_id === value.proposal_id ? 'secondary' : 'outline'} aria-pressed={summary?.proposal_id === value.proposal_id} onClick={() => selectProposal(value)}>{value.current ? 'Current review' : 'Historical review'} · {value.content_digest.slice(0,12)}</Button>)}</div>
        <div className="task-actions mt-3">{proposalCursor && <Button variant="outline" disabled={proposalHistory.isFetching} onClick={() => setProposalPages(pages => pages.slice(0,-1))}>Newer reviews</Button>}{proposalPage?.next_proposal_cursor && <Button variant="outline" disabled={proposalHistory.isFetching || !!proposalHistory.error} onClick={() => { const cursor = proposalPage.next_proposal_cursor; if (cursor) setProposalPages(pages => [...pages,cursor]); }}>Older reviews</Button>}</div>
      </details>}
      {pointer && <p className="task-notice">The accepted result is frozen. Later messages stay outside this batch and do not pause delivery, checks or Retry.</p>}
      {batch && <AcceptedBatch key={`${session}:${task}:${batch.operation_id}`} {...props} expected={batch} active={pointer === batch.operation_id} />}
      {pointer && !batch && <p className="task-notice">Reading the currently accepted batch. Older history pages cannot grant new delivery authority.</p>}
      {(data.batches.length > 0 || batchCursor) && <details className="task-advanced"><summary>Accepted delivery history</summary>
        <ReadProblem error={batchHistory.error} retry={batchHistory.refetch} />
        {batchCursor && batchHistory.isPending && <p role="status">Reading older accepted batches…</p>}
        <div className="task-actions">{batchPage?.batches.map(value => <Button key={value.operation_id} variant={batch?.operation_id === value.operation_id ? 'secondary' : 'outline'} aria-pressed={batch?.operation_id === value.operation_id} onClick={() => selectBatch(value)}>{human(value.status)} · {value.content_digest.slice(0,12)}</Button>)}</div>
        <div className="task-actions mt-3">{batchCursor && <Button variant="outline" disabled={batchHistory.isFetching} onClick={() => setBatchPages(pages => pages.slice(0,-1))}>Newer accepted batches</Button>}{batchPage?.next_batch_cursor && <Button variant="outline" disabled={batchHistory.isFetching || !!batchHistory.error} onClick={() => { const cursor = batchPage.next_batch_cursor; if (cursor) setBatchPages(pages => [...pages,cursor]); }}>Older accepted batches</Button>}</div>
      </details>}
      {!summary && !batch && !status.isPending && <Empty>No acceptance is recorded. Preparing a review and confirming it are separate from accepting delivery.</Empty>}
    </>}
  </section>;
}

function ProposalReview({ summary, enabled, ...props }: TaskViewProps & { summary: DeliveryProposalSummary; enabled: boolean }) {
  const task = props.task.task_id, session = props.commands.sessionId, scope = `delivery-proposal:${summary.proposal_id}`;
  const detail = useQuery({ queryKey: ['tasks',task,'delivery-proposal',session,summary.proposal_id,summary.content_digest], queryFn: ({ signal }) => ownerDeliveryProposal(task, summary, session, signal), retry: false, refetchInterval: 3000 });
  useReadError(detail.error, props.onUnauthorized);
  const [open, setOpen] = useState(false), mounted = useMounted();
  const proposal = detail.data?.proposal;
  const fresh = enabled && !!proposal?.current && detail.isSuccess && !detail.error && proposal.content_digest === summary.content_digest;
  const busy = Busy({ commands: props.commands, taskId: task, scope });
  const manifest = detail.data?.manifest;
  const modified = manifest?.repositories.some(value => value.outcome === 'modified');
  async function confirm() {
    if (!fresh || !proposal) return;
    await deliveryCommand(props, scope, 'confirm_delivery_acceptance', { proposal_id: proposal.proposal_id, content_digest: proposal.content_digest });
  }
  async function accept() {
    if (!fresh || !proposal?.confirmation_id) return;
    const result = await deliveryCommand(props, scope, 'accept_delivery', { proposal_id: proposal.proposal_id, confirmation_id: proposal.confirmation_id, content_digest: proposal.content_digest, basis: proposal.basis });
    if (mounted.current && result) setOpen(false);
  }
  return <article className="task-work-card" aria-label="Prepared acceptance review">
    <p><strong>{summary.current ? 'Exact prepared review' : 'Historical prepared review'}</strong> · Version <code>{summary.content_digest.slice(0,12)}</code></p>
    <p className="task-muted">{proposal?.confirmation_id ? 'Exact Owner confirmation is recorded. Acceptance is a separate action.' : 'This prepared proposal has not been accepted.'}</p>
    <ReadProblem error={detail.error} retry={detail.refetch} />
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="max-sm:min-h-11" />}>Review exact result</DialogTrigger>
      <DialogContent>
        <DialogTitle className="pr-8 text-xl font-medium">Review exact delivery result</DialogTitle>
        <DialogDescription>Confirm this concrete version, then explicitly accept it. Later conversation cannot change the approved result.</DialogDescription>
        <ReadProblem error={detail.error} retry={detail.refetch} />
        {detail.isPending && <p role="status">Reading the complete reviewed result…</p>}
        {manifest && <ManifestReview manifest={manifest} digest={summary.content_digest} />}
        {proposal && <>
          <p className="text-sm text-muted-foreground">Proposal expires {new Date(proposal.expires_at).toLocaleString()}.</p>
          {!fresh && <p className="task-notice">This review grants no current acceptance authority. Resolve the current guard or prepare a new review.</p>}
          {proposal.confirmation_id && <p role="status">Exact Owner confirmation recorded.</p>}
          <div className="task-actions">
            {!proposal.confirmation_id && <Button className="max-sm:min-h-11" disabled={!fresh || busy} onClick={() => { void confirm(); }}>Confirm exact result</Button>}
            {proposal.confirmation_id && <Button className="max-sm:min-h-11" disabled={!fresh || busy} onClick={() => { void accept(); }}>{modified ? 'Accept & Merge' : 'Accept result'}</Button>}
          </div>
          <p className="text-sm text-muted-foreground">{modified ? 'Acceptance admits this frozen batch. Required checks and remote finalization may still be waiting.' : 'There are no modified repositories to publish. Exact acceptance can complete this result without provider calls.'}</p>
        </>}
      </DialogContent>
    </Dialog>
  </article>;
}

function ManifestReview({ manifest, digest }: { manifest: DeliveryAcceptanceManifest; digest: string }) {
  return <div className="min-w-0 space-y-4 text-sm">
    <p className="break-all"><strong>Result version</strong> · <code>{digest}</code></p>
    <p>{manifest.outputs.length} completed {manifest.outputs.length === 1 ? 'output' : 'outputs'} · {manifest.repositories.filter(value => value.outcome === 'modified').length} modified repositories.</p>
    <section aria-label="Exact output evidence"><h3 className="font-medium">Completed outputs and evidence</h3>{manifest.outputs.map(output => <article className="border-b border-border py-3" key={output.node_id}>
      <MarkdownText text={output.completion.summary} />
      {output.artifacts.length > 0 && <ul className="space-y-1 pl-4">{output.artifacts.map(artifact => <li key={artifact.artifact_id}><strong>{artifact.title || 'Untitled evidence'}</strong><small className="block break-all text-muted-foreground">{artifact.media_type} · {artifact.size_bytes} bytes · {artifact.content_digest}</small><DetailIDs><dl><Datum label="Selected artifact">{artifact.artifact_id}</Datum><Datum label="Original Attempt">{artifact.attempt_id}</Datum><Datum label="Artifact Specification">{artifact.specification_id}</Datum><Datum label="Artifact Plan">{artifact.plan_id}</Datum><Datum label="Artifact activation">{artifact.node_activation}</Datum></dl></DetailIDs></li>)}</ul>}
      {output.repository_free && <p className="text-muted-foreground">This output uses no repository and requires no remote publication.</p>}
      <DetailIDs><dl><Datum label="Current activation">{output.node_activation}</Datum><Datum label="Original activation">{output.completion.node_activation}</Datum><Datum label="Original Specification">{output.completion.specification_id}</Datum><Datum label="Original Plan">{output.completion.plan_id}</Datum><Datum label="Completion digest">{output.completion_manifest_digest}</Datum></dl></DetailIDs>
    </article>)}</section>
    {manifest.repositories.length === 0 && <p className="task-notice">No repository delivery items. Acceptance records the exact completed output.</p>}
    {manifest.repositories.map(value => <article className="space-y-2 border-b border-border py-3" key={value.resource_id}>
      <h3 className="break-all font-medium">{value.repository_identity}</h3>
      {value.outcome === 'no_change' ? <p>No repository changes to publish; the exact terminal preparation reports no change.</p> : <>
        <dl><Datum label="Public head"><code className="break-all">{value.candidate?.head}</code></Datum><Datum label="Exact tree"><code className="break-all">{value.candidate?.tree}</code></Datum><Datum label="Fixed target">{value.target_branch}</Datum><Datum label="Public parents">{value.candidate?.parents.map(parent => <code className="block break-all" key={parent}>{parent}</code>)}</Datum><Datum label="Merge preference">{value.merge_method ? human(value.merge_method) : 'First repository-allowed compatible method: merge, squash, rebase'}</Datum></dl>
        {value.mapping && <p className="task-notice">This exact result maps to an already published candidate. Zero new commits still requires final delivery of the approved head.</p>}
        <p>Complete publication scan · {value.scan?.findings_count} retained findings · {value.waivers?.length ?? 0} exact Owner override receipts.</p>
        {value.review && <p><a href={value.review.url} target="_blank" rel="noreferrer">Open existing PR #{value.review.pr_number}</a></p>}
      </>}
      <DetailIDs><dl><Datum label="Original source">{value.source.operation_id}</Datum><Datum label="Source digest">{value.source_digest}</Datum><Datum label="Original Specification">{value.source.specification_id}</Datum><Datum label="Original Plan">{value.source.plan_id}</Datum><Datum label="Effective Specification">{value.effective_basis.specification_id}</Datum><Datum label="Effective Plan">{value.effective_basis.plan_id}</Datum><Datum label="Preparation request">{value.preparation_request_digest}</Datum><Datum label="Preparation result">{value.preparation_result_digest}</Datum>{value.scan_digest && <Datum label="Exact scan">{value.scan_digest}</Datum>}{value.mapping_digest && <Datum label="Exact mapping">{value.mapping_digest}</Datum>}{value.permission_proof_digest && <Datum label="Permission scope">{value.permission_proof_digest}</Datum>}</dl></DetailIDs>
    </article>)}
    <DetailIDs><dl><Datum label="Effective Specification">{manifest.basis.specification_id}</Datum><Datum label="Specification digest">{manifest.specification_digest}</Datum><Datum label="Effective Plan">{manifest.basis.plan_id}</Datum><Datum label="Plan digest">{manifest.plan_digest}</Datum><Datum label="Reviewed control basis">{manifest.basis.control_version}</Datum></dl></DetailIDs>
  </div>;
}

function AcceptedBatch({ expected, active, ...props }: TaskViewProps & { expected: DeliveryBatchSummary; active: boolean }) {
  const task = props.task.task_id, session = props.commands.sessionId;
  const detail = useQuery({ queryKey: ['tasks',task,'delivery-batch',session,expected.operation_id,expected.content_digest], queryFn: ({ signal }) => ownerDeliveryBatch(task, expected, session, signal), retry: false, refetchInterval: 3000 });
  useReadError(detail.error, props.onUnauthorized);
  const data = detail.data, batch = data?.batch;
  const fresh = active && !!batch && detail.isSuccess && !detail.error && batch.version === expected.version && batch.content_digest === expected.content_digest && batch.status === expected.status;
  const scope = `delivery-batch:${expected.operation_id}`, busy = Busy({ commands: props.commands, taskId: task, scope });
  const [cancelOpen, setCancelOpen] = useState(false), mounted = useMounted();
  async function act(name: 'retry_delivery' | 'cancel_delivery') {
    if (!fresh || !batch || !(name === 'retry_delivery' ? batch.retry_allowed && expected.retry_allowed : batch.cancel_allowed && expected.cancel_allowed)) return;
    const result = await deliveryCommand(props, scope, name, { operation_id: batch.operation_id, content_digest: batch.content_digest, expected_version: batch.version });
    if (mounted.current && result && name === 'cancel_delivery') setCancelOpen(false);
  }
  return <article className="task-work-card" aria-label="Accepted delivery batch">
    <h3>Accepted delivery · {human(batch?.status ?? expected.status)}</h3>
    <ReadProblem error={detail.error} retry={detail.refetch} />
    {detail.isPending && <p role="status">Reading the frozen batch…</p>}
    <p className="break-all">Accepted version · <code>{expected.content_digest}</code></p>
    <p>Conversation cutoff · {batch?.input_cutoff ?? expected.input_cutoff}. Later input is outside this result.</p>
    {batch?.reason && <p className="task-notice">{explain(batch.reason)}</p>}
    {data && <>
      <BatchProgress data={data} />
      {batch?.status === 'completed' && <p className="task-notice">This accepted delivery is complete. Further implementation starts as an independent Task through <a href={props.task.todo_id ? `#todos?${new URLSearchParams({ todo_id: props.task.todo_id })}` : '#todos'}>Todo Discussion</a>.</p>}
      {batch?.status === 'cancelled' && <p className="task-notice">New delivery effects are revoked. Original uncertain effects still require reconciliation. Any later verified remote success stays in history and cannot revive this cancelled Task.</p>}
      <div className="task-actions">
        {batch?.retry_allowed && <Button className="max-sm:min-h-11" variant="outline" disabled={!fresh || !expected.retry_allowed || busy} onClick={() => { void act('retry_delivery'); }}>{batch.status === 'reconciling' ? 'Reconcile original delivery' : 'Retry accepted delivery'}</Button>}
        {batch?.cancel_allowed && <Dialog open={cancelOpen} onOpenChange={setCancelOpen}><DialogTrigger render={<Button className="max-sm:min-h-11" variant="outline" disabled={!fresh || !expected.cancel_allowed || busy} />}>Cancel accepted delivery</DialogTrigger><DialogContent><DialogTitle className="pr-8 text-xl font-medium">Cancel this accepted delivery?</DialogTitle><DialogDescription>This cancels the Task and revokes new effects for this exact batch. It cannot undo a verified merge. Original uncertain effects remain under reconciliation.</DialogDescription><p className="break-all text-sm">Accepted version · <code>{batch.content_digest}</code></p><Button disabled={!fresh || busy} onClick={() => { void act('cancel_delivery'); }}>Cancel this batch and Task</Button></DialogContent></Dialog>}
      </div>
      {!active && <p className="task-muted">Historical approval grants no new Retry or Cancel authority.</p>}
      {active && !fresh && (batch?.retry_allowed || batch?.cancel_allowed) && <p className="task-muted">Refreshing the exact batch capability before another decision.</p>}
      <details className="task-advanced"><summary>Frozen accepted result and evidence</summary><ManifestReview manifest={data.manifest} digest={data.batch.content_digest} /></details>
      <DetailIDs><dl><Datum label="Delivery batch">{data.batch.operation_id}</Datum><Datum label="Batch capability version">{data.batch.version}</Datum><Datum label="Actual confirmation">{data.confirmation_id}</Datum><Datum label="Admission request">{data.admission_request_id}</Datum><Datum label="Accepted at">{new Date(data.batch.accepted_at).toLocaleString()}</Datum></dl></DetailIDs>
    </>}
    {active && <p className="task-muted">Delivery uses the frozen batch. Pending or failed replies in <a href={taskHref(task)}>Conversation</a> do not change its Retry authority.</p>}
  </article>;
}
function BatchProgress({ data }: { data: DeliveryBatch }) {
  return <div>{!data.items.length ? <p>No modified repository items. This exact result needs no remote publication or provider calls.</p> : <>
    <p>{data.batch.finalized_items} of {data.batch.modified_items} repository items finalized.</p>
    {data.items.map(item => <section className="border-b border-border py-3" key={item.item_id}>
      <p><strong>{human(item.status)}</strong> · {item.resource_id}</p>
      <p className="break-all">Accepted head · <code>{item.accepted_head}</code></p>
      {item.status !== 'finalized' && <p>Required checks · {human(item.checks)}{item.checks === 'unknown' ? '. Missing or unsupported readiness is not permission to merge.' : ''}</p>}
      {item.reason && <p className="task-notice">{explain(item.reason)}</p>}
      {item.status === 'reconciling' && <p className="task-muted">Reading the original exact PR to resolve an uncertain merge. A lost reply does not authorize another merge.</p>}
      {item.review && <p><a href={item.review.url} target="_blank" rel="noreferrer">Open PR #{item.review.pr_number}</a></p>}
      {item.final_commit && <p className="break-all">Verified final commit · <code>{item.final_commit}</code>{item.finalized_at && ` · ${new Date(item.finalized_at).toLocaleString()}`}</p>}
      {item.merge_method && <p className="task-muted">Requested merge method · {human(item.merge_method)}. Reconciliation alone does not establish the remote actor or method.</p>}
      {item.cooldown_until && <p className="task-muted">Provider cooldown until {new Date(item.cooldown_until).toLocaleString()}.</p>}
      {item.operation_id && <DetailIDs><dl><Datum label="Original operation">{item.operation_id}</Datum><Datum label="Request digest">{item.operation_digest}</Datum><Datum label="Operation state">{item.operation_state && human(item.operation_state)}</Datum></dl></DetailIDs>}
    </section>)}
  </>}</div>;
}
