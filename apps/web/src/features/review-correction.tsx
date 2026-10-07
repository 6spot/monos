import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OwnerReviewCommandName, OwnerReviewPayload, OwnerReviewStatus, ReviewFeedbackSummary, ReviewInputSummary, ReviewOperationSummary } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../components/ui/dialog.tsx';
import { Label } from '../components/ui/label.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { APIError } from '../lib/api.ts';
import { reviewFeedback, reviewOperation, reviewStatus } from '../lib/review-correction-api.ts';
import type { TaskDraft } from '../lib/task-storage.ts';
import { Busy, Datum, DetailIDs, human, MarkdownText, ReadProblem, taskHref } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

function useReadError(error: Error | null, onUnauthorized: () => void) {
  useEffect(() => { if (error instanceof APIError && error.code === 'unauthorized') onUnauthorized(); }, [error,onUnauthorized]);
}
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}
function command(props: TaskViewProps, scope: string, name: OwnerReviewCommandName, payload: OwnerReviewPayload) {
  return props.commands.execute(props.task.task_id,scope,{family:'review',command:{schema_version:1,task_id:props.task.task_id,request_id:crypto.randomUUID(),name,payload}});
}
const reasons: Record<string,string> = {
  not_review: 'Request Changes is available for a current result in Review.',
  no_plan: 'The current Plan has not been published.',
  terminal: 'This Task is terminal. Further execution begins independently through Todo Discussion.',
  finalized: 'This delivery has finalized. Its shipped result cannot be reopened.',
  reconciliation_required: 'The original merge outcome must be reconciled before requesting changes.',
  feedback_pending: 'Requested changes remain active. Resolve that routing or explicitly withdraw the feedback.',
  input_pending: 'Earlier input or a decision still requires attention.',
  work_unsettled: 'Previously admitted work or delivery effects still need to settle.',
};
const explain = (reason: string) => reasons[reason] ?? human(reason);
export function ReviewConversationNotice(props: TaskViewProps) {
  const task=props.task.task_id,session=props.commands.sessionId;
  const status=useQuery({queryKey:['tasks',task,'review',session],queryFn:({signal})=>reviewStatus(task,session,signal),retry:false,refetchInterval:3000});
  useReadError(status.error,props.onUnauthorized);
  const data=status.data;
  if (!data?.feedback && !data?.inputs.some(value=>value.status==='pending')) return null;
  return <aside className="task-notice" aria-label="Review correction decisions">
    <ReadProblem error={status.error} retry={status.refetch} />
    <p>Requested changes and later input reconsideration have separate formal decisions. Sending a message does not retry, withdraw or answer those decisions.</p>
    <a href={taskHref(task,'overview')}>Manage correction decisions in Overview</a>
  </aside>;
}
const operationText: Record<ReviewOperationSummary['status'],string> = {
  settling: 'Waiting for previously admitted execution and delivery to settle.',
  queued: 'Requested changes are queued for Planner routing.',
  running: 'Processing requested changes. The Task remains in Review until a formal decision applies.',
  issue: 'Planner needs an answer before routing these changes.',
  failed: 'Correction routing did not finish. Retry retains this same requested correction.',
  rework: 'Rework was applied to the current structure. The changed result requires fresh review and acceptance.',
  replan: 'Planner requested a replacement Plan because the current structure is insufficient.',
  requirement: 'A concrete requirement proposal needs its separate exact Owner decision.',
  withdrawn: 'This routing obligation was withdrawn. Any earlier execution still needs its own settlement.',
  cancelled: 'This correction was cancelled. Recorded remote effects remain history.',
  resolved: 'This routing obligation has a recorded formal resolution.',
};
function sameReview(review: TaskDraft['review'], data: OwnerReviewStatus) {
  if (!review || !data.basis) return false;
  if ((['control_version','specification_id','plan_id','review_result_digest'] as const).some(key => review.basis[key] !== data.basis?.[key])) return false;
  const accepted = review.accepted_batch, current = data.accepted_batch;
  return !accepted && !current || !!accepted && !!current && accepted.operation_id === current.operation_id && accepted.content_digest === current.content_digest && accepted.expected_version === current.expected_version;
}

export function ReviewCorrection(props: TaskViewProps) {
  const task = props.task.task_id, session = props.commands.sessionId;
  const status = useQuery({queryKey:['tasks',task,'review',session],queryFn:({signal})=>reviewStatus(task,session,signal),retry:false,refetchInterval:3000});
  useReadError(status.error,props.onUnauthorized);
  const data = status.data;
  const [feedbackPages,setFeedbackPages] = useState<string[]>([]), [inputPages,setInputPages] = useState<string[]>([]);
  const [selected,setSelected] = useState<ReviewFeedbackSummary>();
  const feedbackCursor = feedbackPages.at(-1), inputCursor = inputPages.at(-1);
  const olderFeedback = useQuery({queryKey:['tasks',task,'review-history',session,'feedback',feedbackCursor],queryFn:({signal})=>reviewStatus(task,session,signal,{feedback_cursor:feedbackCursor}),enabled:!!feedbackCursor,retry:false,refetchInterval:3000});
  const olderInputs = useQuery({queryKey:['tasks',task,'review-history',session,'inputs',inputCursor],queryFn:({signal})=>reviewStatus(task,session,signal,{input_cursor:inputCursor}),enabled:!!inputCursor,retry:false,refetchInterval:3000});
  useReadError(olderFeedback.error,props.onUnauthorized); useReadError(olderInputs.error,props.onUnauthorized);
  const history = feedbackCursor ? olderFeedback.data : data, inputs = inputCursor ? olderInputs.data : data;
  const selectedHistory = selected && (history?.history.find(value=>value.feedback_id===selected.feedback_id) ?? selected);
  return <section className="task-section" aria-label="Review correction">
    <div className="task-section-heading"><h2>Requested changes</h2></div>
    <ReadProblem error={status.error} retry={status.refetch} />
    {status.isPending && <p role="status">Reading correction authority and settlement…</p>}
    {data && <>
      <RequestChanges {...props} data={data} readable={status.isSuccess && !status.error} />
      {data.feedback && <FeedbackCard key={`${session}:${task}:${data.feedback.feedback_id}`} {...props} summary={data.feedback} current />}
      {inputs && inputs.inputs.length>0 && <section aria-label="Reconsidered Task inputs">
        <h3>Later input after revoked delivery</h3>
        <p className="task-muted">Original messages and replies remain unchanged. These separate decisions reconsider their execution meaning before feedback routing.</p>
        {inputs.inputs.map(value=><ReconsiderationCard key={`${session}:${task}:${value.reconsideration_id}`} {...props} input={value} />)}
      </section>}
      <ReadProblem error={olderInputs.error} retry={olderInputs.refetch} />
      <div className="task-actions">{inputCursor && <Button variant="outline" disabled={olderInputs.isFetching} onClick={()=>setInputPages(pages=>pages.slice(0,-1))}>Newer reconsidered inputs</Button>}{inputs?.inputs_next_cursor && <Button variant="outline" disabled={olderInputs.isFetching || !!olderInputs.error} onClick={()=>{const cursor=inputs.inputs_next_cursor;if(cursor)setInputPages(pages=>[...pages,cursor]);}}>Older reconsidered inputs</Button>}</div>
      {(data.history.length>0 || feedbackCursor) && <details className="task-advanced"><summary>Review feedback history</summary>
        <ReadProblem error={olderFeedback.error} retry={olderFeedback.refetch} />
        <div className="task-actions">{history?.history.map(value=><Button key={value.feedback_id} variant="outline" aria-pressed={selected?.feedback_id===value.feedback_id} onClick={()=>setSelected(value)}>{human(value.status)} · {new Date(value.created_at).toLocaleString()}</Button>)}</div>
        <div className="task-actions mt-3">{feedbackCursor && <Button variant="outline" disabled={olderFeedback.isFetching} onClick={()=>setFeedbackPages(pages=>pages.slice(0,-1))}>Newer feedback</Button>}{history?.history_next_cursor && <Button variant="outline" disabled={olderFeedback.isFetching || !!olderFeedback.error} onClick={()=>{const cursor=history.history_next_cursor;if(cursor)setFeedbackPages(pages=>[...pages,cursor]);}}>Older feedback</Button>}</div>
        {selectedHistory && selectedHistory.feedback_id!==data.feedback?.feedback_id && <FeedbackCard key={`${session}:${task}:${selectedHistory.feedback_id}`} {...props} summary={selectedHistory} current={false} />}
      </details>}
    </>}
  </section>;
}

function RequestChanges({data,readable,...props}:TaskViewProps & {data:OwnerReviewStatus;readable:boolean}) {
  const task=props.task.task_id, scope='review-request', draftScope='review-feedback';
  const draft=props.commands.getDraft(task,draftScope), [open,setOpen]=useState(false), mounted=useMounted();
  const busy=Busy({commands:props.commands,taskId:task,scope});
  const allowed=readable && data.request_changes_allowed && !!data.basis && props.task.state==='REVIEW';
  const fresh=allowed && sameReview(draft.review,data);
  function capture(text=draft.text) {
    if(data.basis)props.commands.setReviewDraft(task,draftScope,text,{basis:data.basis,...(data.accepted_batch?{accepted_batch:data.accepted_batch}:{})});
  }
  async function submit() {
    if(!fresh || !draft.review || !draft.text.trim())return;
    const result=await command(props,scope,'request_changes',{feedback_id:crypto.randomUUID(),text:draft.text,basis:draft.review.basis,...(draft.review.accepted_batch?{accepted_batch:draft.review.accepted_batch}:{})});
    if(mounted.current && result)setOpen(false);
  }
  return <>
    {!allowed && <p className="task-muted">{data.reason?explain(data.reason):'Correction is currently guarded by the canonical Task and delivery state.'}</p>}
    <Dialog open={open} onOpenChange={next=>{if(next&&!draft.review)capture();setOpen(next);}}>
      <DialogTrigger render={<Button className="max-sm:min-h-11" variant="outline" disabled={!allowed || busy} />}>Request Changes</DialogTrigger>
      <DialogContent><DialogTitle className="pr-8 text-xl font-medium">Request changes to this result</DialogTitle>
        <DialogDescription>Describe the improvement. Planner will route it within this Task. Changed requirements and replacement Plans require their own exact Owner decisions.</DialogDescription>
        {draft.review && <>
          <p className="break-all text-sm">Reviewed result · <code>{draft.review.basis.review_result_digest}</code></p>
          {draft.review.accepted_batch && <p className="task-notice">This explicitly revokes the entirely undelivered accepted version. Original admitted delivery must settle before correction starts. Its existing branch and PR are retained.</p>}
          <DetailIDs><dl><Datum label="Specification">{draft.review.basis.specification_id}</Datum><Datum label="Plan">{draft.review.basis.plan_id}</Datum><Datum label="Control basis">{draft.review.basis.control_version}</Datum>{draft.review.accepted_batch && <><Datum label="Accepted batch">{draft.review.accepted_batch.operation_id}</Datum><Datum label="Accepted digest">{draft.review.accepted_batch.content_digest}</Datum><Datum label="Batch version">{draft.review.accepted_batch.expected_version}</Datum></>}</dl></DetailIDs>
          <Label>Review feedback<Textarea aria-label="Review feedback" maxLength={65536} value={draft.text} onChange={event=>{if(draft.review)props.commands.setReviewDraft(task,draftScope,event.target.value,draft.review);}} /></Label>
        </>}
        {!fresh && <p className="task-notice">The captured review basis is no longer current. Keep your feedback and explicitly review the current result before submitting.</p>}
        <div className="task-actions"><Button className="max-sm:min-h-11" disabled={!fresh || busy || !draft.text.trim()} onClick={()=>{void submit();}}>Request these changes</Button>{!fresh && <Button variant="outline" disabled={!allowed || busy} onClick={()=>capture()}>Review current result</Button>}</div>
        <p className="text-sm text-muted-foreground">Request admission does not mean Rework has applied or a remote effect has stopped.</p>
      </DialogContent>
    </Dialog>
  </>;
}

function FeedbackCard({summary,current,...props}:TaskViewProps & {summary:ReviewFeedbackSummary;current:boolean}) {
  const task=props.task.task_id,session=props.commands.sessionId;
  const [pages,setPages]=useState<string[]>([]), cursor=pages.at(-1);
  const detail=useQuery({queryKey:['tasks',task,'review-feedback',session,summary.feedback_id,summary.review_result_digest,cursor],queryFn:({signal})=>reviewFeedback(task,summary,session,signal,{decision_cursor:cursor}),retry:false,refetchInterval:3000});
  useReadError(detail.error,props.onUnauthorized);
  const data=detail.data;
  return <article className="task-work-card" aria-label={current?'Current review feedback':'Historical review feedback'}>
    <h3>{current?'Requested correction':'Historical correction'} · {human(data?.feedback.status ?? summary.status)}</h3>
    <ReadProblem error={detail.error} retry={detail.refetch} />
    {detail.isPending && <p role="status">Reading recorded feedback…</p>}
    {data && <>
      <MarkdownText text={data.text} />
      <p className="break-all text-sm">Reviewed result · <code>{data.basis.review_result_digest}</code></p>
      {data.revoked_batch && <p className="task-notice">Accepted batch {data.revoked_batch.operation_id} was revoked. Its frozen evidence stays in delivery history; withdrawing this feedback cannot restore its approval.</p>}
      <OperationCard {...props} operation={summary.operation} enabled={current && !detail.error} />
      <details className="task-advanced"><summary>Recorded Owner decisions</summary>
        {data.decisions.map(value=><p key={value.request_id}>{human(value.name)} · {new Date(value.created_at).toLocaleString()}{value.has_answer?' · Answer recorded':''}</p>)}
        <div className="task-actions">{cursor && <Button variant="outline" disabled={detail.isFetching} onClick={()=>setPages(values=>values.slice(0,-1))}>Newer decisions</Button>}{data.decisions_next_cursor && <Button variant="outline" disabled={detail.isFetching || !!detail.error} onClick={()=>{const next=data.decisions_next_cursor;if(next)setPages(values=>[...values,next]);}}>Older decisions</Button>}</div>
      </details>
      <DetailIDs><dl><Datum label="Feedback">{summary.feedback_id}</Datum><Datum label="Owner request">{data.request_id}</Datum><Datum label="Original Specification">{data.basis.specification_id}</Datum><Datum label="Original Plan">{data.basis.plan_id}</Datum></dl></DetailIDs>
    </>}
  </article>;
}
function ReconsiderationCard({input,...props}:TaskViewProps & {input:ReviewInputSummary}) {
  return <article className="task-input-card" aria-label="Reconsidered input">
    <h4>Input {input.sequence} · {human(input.status)}</h4>
    <p className="task-muted">Originally saved outside accepted batch {input.accepted_batch_id}.{input.original_reply_id?' Its original reply is preserved; this does not create a second reply.':' Original message provenance is preserved.'}</p>
    <OperationCard {...props} operation={input.operation} enabled={input.operation.purpose==='reconsider_input' && (input.operation.retry_allowed || input.operation.withdraw_allowed)} />
  </article>;
}
function OperationCard({operation,enabled,...props}:TaskViewProps & {operation:ReviewOperationSummary;enabled:boolean}) {
  const task=props.task.task_id,session=props.commands.sessionId,scope=`review-operation:${operation.operation_id}`;
  const detail=useQuery({queryKey:['tasks',task,'review-operation',session,operation.operation_id],queryFn:({signal})=>reviewOperation(task,operation,session,signal),retry:false,refetchInterval:3000});
  useReadError(detail.error,props.onUnauthorized);
  const data=detail.data, current=data?.operation, issue=data?.issue;
  const answerKey=`review-answer:${issue?.issue_id ?? operation.operation_id}`, answer=props.commands.getDraft(task,answerKey).text;
  const busy=Busy({commands:props.commands,taskId:task,scope}), mounted=useMounted();
  const [withdrawOpen,setWithdrawOpen]=useState(false);
  const fresh=enabled && !['COMPLETED','CANCELLED'].includes(props.task.state) && detail.isSuccess && !detail.error && !!current && current.operation_version===operation.operation_version;
  const input=operation.purpose==='reconsider_input';
  async function act(withdraw:boolean) {
    if(!fresh || !current || !(withdraw?current.withdraw_allowed && operation.withdraw_allowed:current.retry_allowed && operation.retry_allowed))return;
    if(!withdraw && current.issue_id && (!issue || issue.issue_id!==current.issue_id || !answer.trim()))return;
    const result=await command(props,scope,withdraw?(input?'withdraw_review_input':'withdraw_review_feedback'):(input?'retry_review_input':'retry_review_feedback'),{
      feedback_id:current.feedback_id,operation_id:current.operation_id,expected_version:current.operation_version,
      ...(input?{reconsideration_id:current.reconsideration_id}:{}),
      ...(!withdraw && current.issue_id?{issue_id:current.issue_id,answer}:{}),
    });
    if(mounted.current && result && withdraw)setWithdrawOpen(false);
  }
  return <section aria-label={input?'Input reconsideration routing':'Feedback routing'}>
    <ReadProblem error={detail.error} retry={detail.refetch} />
    <p role="status">{operationText[current?.status ?? operation.status]}</p>
    {(current?.reason ?? operation.reason) && <p className="task-notice">{explain(current?.reason ?? operation.reason ?? '')}</p>}
    {(current?.settlement_pending ?? operation.settlement_pending) && <p className="task-notice">Earlier process or delivery settlement is still pending. A saved decision does not release physical ownership.</p>}
    {issue && <div className="task-notice"><MarkdownText text={issue.reason} /><Label>Answer to {input?'input reconsideration':'review issue'}<Textarea aria-label={input?'Input reconsideration answer':'Review issue answer'} maxLength={65536} value={answer} onChange={event=>props.commands.setDraft(task,answerKey,event.target.value)} /></Label></div>}
    {current?.replan_request_id && <p><a href={taskHref(task)}>Review the replacement Plan and its Dismiss action in Conversation.</a> Dismiss preserves this requested correction.</p>}
    {current?.requirement_proposal_id && <p><a href={taskHref(task)}>Review the exact proposed requirements in Conversation.</a> Requirements and feedback have separate withdrawal decisions.</p>}
    {enabled && <div className="task-actions">
      {current?.retry_allowed && <Button className="max-sm:min-h-11" variant="outline" disabled={!fresh || !operation.retry_allowed || busy || !!current.issue_id && (!issue || !answer.trim())} onClick={()=>{void act(false);}}>{current.issue_id?'Answer & Retry':input?'Retry input reconsideration':'Retry feedback routing'}</Button>}
      {current?.withdraw_allowed && <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}><DialogTrigger render={<Button className="max-sm:min-h-11" variant="outline" disabled={!fresh || !operation.withdraw_allowed || busy} />}>{input?'Withdraw reconsidered input':'Withdraw feedback'}</DialogTrigger><DialogContent><DialogTitle className="pr-8 text-xl font-medium">{input?'Withdraw this input reconsideration?':'Withdraw this review feedback?'}</DialogTitle><DialogDescription>{input?'This resolves this exact reconsideration obligation while retaining its original message and reply. It does not withdraw the main requested correction.':'This records withdrawal and stops this feedback source. It does not revive a revoked acceptance or resolve independent requirement, Replan or input decisions.'}</DialogDescription><Button className="max-sm:min-h-11" disabled={!fresh || busy} onClick={()=>{void act(true);}}>{input?'Withdraw this reconsideration':'Withdraw this feedback'}</Button></DialogContent></Dialog>}
    </div>}
    {current?.predecessor_operation_id && <p className="task-muted">This is a fresh same-feedback routing successor after an explicit decision; its predecessor remains history.</p>}
    {data && <DetailIDs><dl><Datum label="Routing operation">{current?.operation_id}</Datum><Datum label="Capability version">{current?.operation_version}</Datum>{current?.source_id && <Datum label="Current source">{current.source_id}</Datum>}{current?.previous_source_id && <Datum label="Earlier source">{current.previous_source_id}</Datum>}{current?.predecessor_operation_id && <Datum label="Predecessor operation">{current.predecessor_operation_id}</Datum>}{data.stop_operation_ids.map(id=><Datum key={id} label="Original termination operation">{id}</Datum>)}</dl></DetailIDs>}
  </section>;
}
