import { afterEach, expect, it, vi } from 'vitest';
import type { OwnerReviewCommand, OwnerReviewStatus, ReviewOperationDetail, ReviewOperationSummary } from '../../../../packages/protocol/generated/types.ts';
import { APIError, UncertainError } from './api.ts';
import { reviewOperation, reviewStatus } from './review-correction-api.ts';
import { recoverTaskIntent, submitTaskIntent, validateTaskIntent } from './task-api.ts';
import type { TaskIntent } from './task-api.ts';
import { clearTaskStorage, validateTaskJournal } from './task-storage.ts';

afterEach(() => vi.unstubAllGlobals());
const basis = {control_version:1,specification_id:'spec-a',plan_id:'plan-a',review_result_digest:'a'.repeat(64)};
const request: OwnerReviewCommand = {schema_version:1,task_id:'task-a',request_id:'request-a',name:'request_changes',payload:{feedback_id:'feedback-a',text:'Correct the output without changing its requirements.',basis}};
const requestReceipt = {schema_version:1,task_id:'task-a',request_id:'request-a',status:'committed',name:'request_changes',feedback_id:'feedback-a',operation_id:'routing-a',operation_version:1,review_result_digest:basis.review_result_digest};
const operation: ReviewOperationSummary = {feedback_id:'feedback-a',operation_id:'routing-a',operation_version:2,purpose:'route_feedback',status:'issue',retry_allowed:true,withdraw_allowed:true,settlement_pending:false,source_id:'source-a',issue_id:'issue-a'};
function status(): OwnerReviewStatus { return {schema_version:1,task_id:'task-a',basis,request_changes_allowed:true,feedback:null,history:[],history_has_more:false,inputs:[],inputs_has_more:false}; }
function detail(): ReviewOperationDetail { return {schema_version:1,task_id:'task-a',basis,operation,stop_operation_ids:[],issue:{issue_id:'issue-a',reason:'Which behavior should change?',source_id:'source-a',version:1},source:{...basis,feedback_id:'feedback-a',operation_id:'routing-a',operation_version:2,purpose:'route_feedback',source_id:'source-a',context_digest:'b'.repeat(64)}}; }

it('recovers the original review request under its exact session and replays only authoritative unknown', async () => {
  const calls: {path:string;init:RequestInit}[]=[];
  vi.stubGlobal('fetch',async(path:string,init:RequestInit)=>{calls.push({path,init});return Response.json(init.body?requestReceipt:{schema_version:1,task_id:'task-a',request_id:'request-a',status:'unknown'});});
  await expect(recoverTaskIntent({family:'review',command:request},'session-a')).resolves.toEqual(requestReceipt);
  expect(calls.map(value=>value.path)).toEqual(['/v1/owner/tasks/task-a/review/commands/request-a','/v1/owner/tasks/review/commands']);
  expect(calls[1]?.init.body).toBe(JSON.stringify(request));
  expect(calls.every(value=>(value.init.headers as Record<string,string>)['X-Monos-Session']==='session-a')).toBe(true);
});

it('requires actual matching reviewed digest, feedback, Task and initial routing version', async () => {
  for(const change of [{review_result_digest:'c'.repeat(64)},{feedback_id:'foreign'},{task_id:'foreign'},{operation_version:2},{name:'withdraw_review_feedback'},{operation_id:undefined}]) {
    const fetch=vi.fn(async()=>Response.json({...requestReceipt,...change}));vi.stubGlobal('fetch',fetch);
    await expect(recoverTaskIntent({family:'review',command:request},'session-a')).rejects.toBeInstanceOf(UncertainError);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

it('accepted Request Changes requires its real original batch revocation receipt and advanced capability', async () => {
  const accepted={operation_id:'batch-a',content_digest:'c'.repeat(64),expected_version:7};
  const intent:TaskIntent={family:'review',command:{...request,payload:{...request.payload,accepted_batch:accepted}}};
  const revoked={operation_id:'batch-a',content_digest:accepted.content_digest,operation_version:8,revocation_id:'revocation-a',input_cutoff:3};
  vi.stubGlobal('fetch',async()=>Response.json({...requestReceipt,revoked_batch:revoked}));
  await expect(submitTaskIntent(intent,'session-a')).resolves.toHaveProperty('revoked_batch.revocation_id','revocation-a');
  for(const value of [undefined,{...revoked,operation_id:'foreign'},{...revoked,content_digest:'d'.repeat(64)},{...revoked,operation_version:7}]) {
    vi.stubGlobal('fetch',async()=>Response.json({...requestReceipt,revoked_batch:value}));
    await expect(recoverTaskIntent(intent,'session-a')).rejects.toBeInstanceOf(UncertainError);
  }
});

it('Retry and Withdraw retain the exact routing generation and bind independent reconsideration', async () => {
  for(const name of ['retry_review_feedback','withdraw_review_feedback','retry_review_input','withdraw_review_input'] as const) {
    const input=name.endsWith('_input');
    const command:OwnerReviewCommand={...request,name,payload:{feedback_id:'feedback-a',operation_id:'routing-a',expected_version:2,...(input?{reconsideration_id:'reconsideration-a'}:{})}};
    const receipt={schema_version:1,task_id:'task-a',request_id:'request-a',status:'committed',feedback_id:'feedback-a',name,operation_id:'routing-a',operation_version:3,...(input?{reconsideration_id:'reconsideration-a'}:{})};
    vi.stubGlobal('fetch',async()=>Response.json(receipt));
    await expect(submitTaskIntent({family:'review',command},'session-a')).resolves.toEqual(receipt);
    for(const change of [{operation_id:'new-unrelated-operation'},{operation_version:2},...(input?[{reconsideration_id:'foreign'}]:[])]) {
      vi.stubGlobal('fetch',async()=>Response.json({...receipt,...change}));
      await expect(recoverTaskIntent({family:'review',command},'session-a')).rejects.toBeInstanceOf(UncertainError);
    }
  }
});

it('captures review drafts and exact answer pairs without admitting credentials or conflicting authority', () => {
  const journal={version:1,session_id:'session-a',tasks:{'task-a':{drafts:{feedback:{text:'Unsent newer correction',review:{basis}}},pending:{feedback:{family:'review',command:request}}}}};
  expect(validateTaskJournal(journal,'session-a')).toEqual(journal);
  expect(()=>validateTaskJournal({...journal,tasks:{'task-a':{...journal.tasks['task-a'],drafts:{feedback:{text:'x',basis,review:{basis}}}}}},'session-a')).toThrow();
  expect(()=>validateTaskJournal({...journal,tasks:{'task-a':{...journal.tasks['task-a'],drafts:{feedback:{text:'x',review:{basis,token:'secret'}}}}}},'session-a')).toThrow();
  const retry={family:'review',command:{...request,name:'retry_review_feedback',payload:{feedback_id:'feedback-a',operation_id:'routing-a',expected_version:2,issue_id:'issue-a',answer:'Preserve the current graph.'}}};
  expect(validateTaskIntent(retry)).toEqual(retry);
  expect(()=>validateTaskIntent({...retry,command:{...retry.command,payload:{...retry.command.payload,answer:undefined}}})).toThrow();
});

it('review-origin Replan dismissal binds real feedback and a distinct successor locally without sending metadata', async () => {
  const intent:TaskIntent={family:'replan',review_origin:{feedback_id:'feedback-a',operation_id:'routing-a'},command:{schema_version:1,task_id:'task-a',request_id:'request-a',name:'dismiss_replan',payload:{replan_request_id:'replan-a',expected_version:2}}};
  const receipt={schema_version:1,request_id:'request-a',status:'committed',replan_request_id:'replan-a',review_feedback_id:'feedback-a',review_predecessor_operation_id:'routing-a',review_operation_id:'successor-a'};
  const fetch=vi.fn(async(path:string,init:RequestInit)=>{expect(path).toBe('/v1/owner/tasks/replan/commands');expect(init.body).toBe(JSON.stringify(intent.command));return Response.json(receipt);});vi.stubGlobal('fetch',fetch);
  await expect(submitTaskIntent(intent,'session-a')).resolves.toEqual(receipt);
  expect(fetch.mock.calls[0]?.[1].body).toBe(JSON.stringify(intent.command));
  for(const change of [{review_feedback_id:'foreign'},{review_predecessor_operation_id:'foreign'},{review_operation_id:'routing-a'},{review_operation_id:undefined}]) {
    vi.stubGlobal('fetch',async()=>Response.json({...receipt,...change}));
    await expect(recoverTaskIntent(intent,'session-a')).rejects.toBeInstanceOf(UncertainError);
  }
  expect(()=>validateTaskIntent({...intent,command:{...intent.command,name:'retry_replan'}})).toThrow();
  expect(()=>validateTaskIntent({...intent,review_origin:undefined})).toThrow();
});

it('rejects canonical review reads from another Task, changed issue/source or selected reconsideration', async () => {
  vi.stubGlobal('fetch',async()=>Response.json({...status(),task_id:'foreign'}));
  await expect(reviewStatus('task-a','session-a')).rejects.toBeInstanceOf(APIError);
  for(const change of [{operation:{...operation,feedback_id:'foreign'}},{issue:{...detail().issue,source_id:'foreign'}},{source:{...detail().source,operation_id:'foreign'}},{operation:{...operation,purpose:'reconsider_input',input_id:'input-a',reconsideration_id:'reconsideration-a'}}]) {
    vi.stubGlobal('fetch',async()=>Response.json({...detail(),...change}));
    await expect(reviewOperation('task-a',operation,'session-a')).rejects.toBeInstanceOf(APIError);
  }
  vi.stubGlobal('fetch',async()=>Response.json(detail()));
  await expect(reviewOperation('task-a',operation,'session-a')).resolves.toEqual(detail());
});

it('fences a late review read after logout or Task query cancellation', async () => {
  for(const logout of [true,false]) {
    let reply:(response:Response)=>void=()=>{};
    vi.stubGlobal('fetch',()=>new Promise<Response>(resolve=>{reply=resolve;}));
    const controller=new AbortController(), read=reviewStatus('task-a','session-a',controller.signal);
    if(logout)clearTaskStorage();else controller.abort();
    reply(Response.json(status()));
    await expect(read).rejects.toBeInstanceOf(Error);
  }
});
