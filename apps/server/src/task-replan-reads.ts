import type { Transaction } from '../../../packages/db/src/index.ts';
import { validate,canonicalJSON,MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { replanSource,replanProposal,replanQuiescent } from './task-replan-state.ts';
import type { ReplanSource,ReplanRequest } from './task-replan-state.ts';
const requestColumns='id,task_id,reason,status,version,source_id,proposal_id,issue_id,input_id,origin_node_id,origin_activation,requester_blocker_id,direction';
const summaries=`SELECT p.id proposal_id,p.request_id,p.source_id,p.plan_id,p.content_digest,p.requirement_proposal_id,r.proposal_id=p.id current,g.revoked,g.expires_at<=clock_timestamp() expired FROM replan_proposals p JOIN replan_requests r ON r.id=p.request_id JOIN task_command_proposals g ON g.id=p.id`;
export async function replanRead(tx:Transaction,taskId:string,requestId?:string,proposalId?:string,cursor?:string,effectsCursor?:string){
 for(const id of [taskId,requestId,proposalId,cursor,effectsCursor])if(id)validate('Id',id);
 if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
 let result:unknown;
 if(proposalId){const p=await replanProposal(tx,taskId,proposalId);const summary=(await tx.query(summaries+' WHERE p.id=$1',[p.id])).rows[0];const content={...p.content};delete (content as {input_cutoff?:number}).input_cutoff;delete content.requirement_content_digest;
 result=validate('ReplanProposalDetail',{schema_version:1,task_id:taskId,proposal:summary,content,input_cutoff:p.content.input_cutoff,requirement_content_digest:p.content.requirement_content_digest??null,confirmation_id:(await tx.query('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[p.id])).rows[0]?.id??null});
 }else{
 const rows=(await tx.query<ReplanRequest>(`SELECT ${requestColumns} FROM replan_requests WHERE task_id=$1 AND ($2::text IS NULL OR id=$2) AND ($3::text IS NULL OR id>$3) ORDER BY id LIMIT 65`,[taskId,requestId??null,requestId?null:cursor??null])).rows;
 const projection=async(r:ReplanRequest)=>{const origin=(await tx.query<{feedback_id:string;id:string}>('SELECT feedback_id,id FROM task_review_operations WHERE id=(SELECT review_operation_id FROM replan_requests WHERE id=$1)',[r.id])).rows[0];return {...r,version:Number(r.version),origin_activation:r.origin_activation===null?null:Number(r.origin_activation),...(origin?{review_feedback_id:origin.feedback_id,review_operation_id:origin.id}: {})};};
 const settled=await replanQuiescent(tx,taskId);const requests=await Promise.all(rows.slice(0,64).map(async r=>({...await projection(r),physical_settled:settled})));
 if(!requestId){const current=(await tx.query<ReplanRequest>(`SELECT ${requestColumns} FROM replan_requests WHERE task_id=$1 AND status='pending'`,[taskId])).rows[0];result=validate('TaskReplanStatus',{schema_version:1,task_id:taskId,requests,current_request:current?{...await projection(current),physical_settled:settled}:null,next_cursor:rows.length>64?rows[63]!.id:null});}
 else{
  const request=requests[0];if(!request)throw new CommandError('denied_scope','Unknown Replan request');
  const source=request.source_id?(await tx.query<ReplanSource>('SELECT * FROM replan_sources WHERE id=$1',[request.source_id])).rows[0]:undefined;
  const attempt=source?(await tx.query('SELECT id,state,end_reason FROM attempts WHERE id=$1',[source.planned_attempt_id])).rows[0]:undefined;
  const proposals=(await tx.query(summaries+' WHERE p.task_id=$1 AND p.request_id=$2 AND ($3::text IS NULL OR p.id>$3) ORDER BY p.id LIMIT 33',[taskId,requestId,cursor??null])).rows;
  const effects=(await tx.query(`SELECT o.id operation_id,o.attempt_id,o.kind,o.state,o.failure_kind,a.process_released FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND (a.id=(SELECT origin_attempt_id FROM replan_requests WHERE id=$2) OR a.replan_source_id IN(SELECT id FROM replan_sources WHERE request_id=$2)) AND ($3::text IS NULL OR o.id>$3) ORDER BY o.id LIMIT 65`,[taskId,requestId,effectsCursor??null])).rows;
  const requirements=(await tx.query(`SELECT p.id proposal_id,p.obligation_id,p.summary,p.content_digest,p.base_specification_id,o.status,o.version,g.revoked,g.expires_at<=clock_timestamp() expired,g.expires_at,COALESCE(o.current_proposal_id=p.id,false) current,true attached FROM requirement_proposals p JOIN requirement_obligations o ON o.current_proposal_id=p.id JOIN task_command_proposals g ON g.id=p.id WHERE p.replan_source_id IN(SELECT id FROM replan_sources WHERE request_id=$1) AND o.status='pending' ORDER BY p.id LIMIT 65`,[requestId])).rows.map(p=>({...p,version:Number(p.version),expires_at:p.expires_at.toISOString()}));
  result=validate('ReplanRequestDetail',{schema_version:1,task_id:taskId,request,proposals:proposals.slice(0,32),next_cursor:proposals.length>32?proposals[31]!.proposal_id:null,source:source?replanSource(source):null,attempt_id:attempt?.id??null,waiting_reason:source?.waiting_reason??(attempt&&!['RUNNING','QUEUED'].includes(attempt.state)?attempt.end_reason:null)??(!settled?'waiting_for_physical_settlement':null),issue_reason:request.issue_id?(await tx.query('SELECT reason FROM replan_issues WHERE id=$1',[request.issue_id])).rows[0]?.reason??null:null,effects:effects.slice(0,64),effects_next_cursor:effects.length>64?effects[63]!.operation_id:null,remaining_requirements:requirements.slice(0,64),requirements_has_more:requirements.length>64});
 }
 }
 if(Buffer.byteLength(canonicalJSON(result))>MAX_BODY_BYTES-4096)throw new CommandError('unmet_precondition','Replan read exceeds response budget');return result;
}
