import {resumeReviewAfterDismissal} from './task-review-state.ts';
import { replanRead } from './task-replan-reads.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database,Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON,digest,validate,MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import type { TaskReplanCommand,TaskReplanResult } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { lockSpecificationTask } from './task-specification.ts';
import { mutableSpecification } from './task-specification-state.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { DispatchQueue } from './dispatch-queue.ts';
import { RuntimeScheduling } from './runtime-scheduling.ts';
import { stopPlanningAttempt,planningEvent } from './task-planning-state.ts';
import type { PlanningAttempt } from './task-planning-state.ts';
import { replanProposal,eligibleReplan,replanQuiescent,createReplanSource,replanSource,assertReplanSource } from './task-replan-state.ts';
import type { ReplanRequest,ReplanSource } from './task-replan-state.ts';
import { publishReplan } from './task-replan-publication.ts';

export interface ReplanHooks {beforeCommit?:()=>void;afterCommit?:()=>void;beforePublicationCommit?:()=>void;afterPublicationCommit?:()=>void}
export async function revokeReplanGeneration(tx:Transaction,r:ReplanRequest,requestId:string):Promise<string|undefined>{
 if(r.proposal_id)await tx.query('UPDATE task_command_proposals SET revoked=true WHERE id=$1 AND NOT revoked',[r.proposal_id]);
 if(!r.source_id)return;
 await tx.query('UPDATE replan_sources SET done=true WHERE id=$1',[r.source_id]);
 const a=(await tx.query<PlanningAttempt>('SELECT a.* FROM attempts a JOIN replan_sources s ON s.planned_attempt_id=a.id WHERE s.id=$1 FOR UPDATE OF a',[r.source_id])).rows[0];if(!a)return;
 await tx.query("UPDATE attempts SET mutation_allowed=false,state=CASE WHEN state='SUCCEEDED' THEN state ELSE 'CANCELLED' END,end_reason=CASE WHEN state='SUCCEEDED' THEN end_reason ELSE 'replan_revoked' END WHERE id=$1",[a.id]);return stopPlanningAttempt(tx,a,requestId);
}
async function reconcileDismissal(tx:Transaction,task:SpecificationTask,r:ReplanRequest):Promise<void>{
 if(!await replanQuiescent(tx,task.id))return;
 if(r.origin_node_id)await tx.query("UPDATE nodes n SET state='PENDING',blocker_id=NULL,execution_source_id=NULL WHERE n.id=$1 AND n.activation=$2 AND NOT n.guidance_paused AND EXISTS(SELECT 1 FROM node_blockers b WHERE b.id=n.blocker_id AND b.id=$3)",[r.origin_node_id,r.origin_activation,r.requester_blocker_id]);
 if(!r.review_operation_id&&task.state!=='CANCELLED')await tx.query("UPDATE tasks SET state=CASE WHEN EXISTS(SELECT 1 FROM nodes n JOIN plan_nodes p ON p.node_id=n.id WHERE p.plan_id=tasks.plan_id AND n.state='BLOCKED') THEN 'BLOCKED' WHEN NOT EXISTS(SELECT 1 FROM nodes n JOIN plan_nodes p ON p.node_id=n.id WHERE p.plan_id=tasks.plan_id AND n.state<>'COMPLETED') THEN 'REVIEW' ELSE 'RUNNING' END,control_version=control_version+1 WHERE id=$1",[task.id]);
 await tx.query('UPDATE replan_requests SET reconciled=true WHERE id=$1',[r.id]);
}
export class TaskReplan {
 readonly db:Database;readonly hooks:ReplanHooks;private readonly scheduling:RuntimeScheduling;
 constructor(db:Database,hooks:ReplanHooks={},backendInstance=''){this.db=db;this.hooks=hooks;this.scheduling=new RuntimeScheduling(new DispatchQueue(db),backendInstance);}
 async command(token:string,body:unknown):Promise<TaskReplanResult>{
  const cmd=validate<TaskReplanCommand>('TaskReplanCommand',body),json=canonicalJSON(cmd);if(Buffer.byteLength(json)>MAX_BODY_BYTES)throw new CommandError('invalid_input','Replan command exceeds budget');const hash=digest(json);let published=false;
  const result=await transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);const config=await lockConfiguration(tx),task=await lockSpecificationTask(tx,cmd.task_id);
   const old=(await tx.query<{digest:string;response:TaskReplanResult}>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',[task.id,cmd.request_id])).rows[0];if(old){if(old.digest!==hash)throw new CommandError('payload_conflict','Request content changed');return old.response;}
   mutableSpecification(task);const payload=cmd.payload as Record<string,unknown>;let result:TaskReplanResult={schema_version:1,request_id:cmd.request_id,status:'committed'};
   if(cmd.name==='confirm_replan'||cmd.name==='publish_replan'||cmd.name==='defer_replan_inputs'){
    const p=await replanProposal(tx,task.id,String(payload.proposal_id));result={...result,replan_request_id:p.request_id,proposal_id:p.id};
    if(cmd.name==='confirm_replan'){
     await eligibleReplan(tx,task,p);if(payload.content_digest!==p.content_digest)throw new CommandError('payload_conflict','Exact graph digest differs');
     let auth=(await tx.query('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[p.id])).rows[0]?.id as string|undefined;
     if(!auth){auth=randomUUID();await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[auth,p.id]);await tx.query('INSERT INTO replan_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[auth,task.id,cmd.request_id]);}
     result={...result,confirmation_id:auth,content_digest:p.content_digest};
    }else if(cmd.name==='publish_replan'){
     if(canonicalJSON(payload.basis)!==canonicalJSON(p.content.basis))throw new CommandError('version_conflict','Publication must retain approved basis');
     result={...result,...await publishReplan(tx,task,p,String(payload.confirmation_id),payload.requirement_confirmation_id as string|undefined,cmd.request_id,config)};published=true;
    }else {
     if(!(await tx.query("SELECT 1 FROM replan_requests WHERE id=$1 AND proposal_id=$2 AND status='pending'",[p.request_id,p.id])).rowCount)throw new CommandError('unmet_precondition','Exact current proposal required');
     for(const i of payload.inputs as {input_id:string;version:number}[]){if(!(await tx.query('SELECT 1 FROM task_inputs WHERE id=$1 AND task_id=$2 AND version=$3',[i.input_id,task.id,i.version])).rowCount)throw new CommandError('version_conflict','Exact input version required');await tx.query('INSERT INTO replan_input_deferrals(task_id,proposal_id,input_id,input_version,request_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[task.id,p.id,i.input_id,i.version,cmd.request_id]);}
    }
   }else {
    const r=(await tx.query<ReplanRequest>('SELECT * FROM replan_requests WHERE id=$1 AND task_id=$2 FOR UPDATE',[payload.replan_request_id,task.id])).rows[0];if(!r||r.status!=='pending'||Number(r.version)!==payload.expected_version)throw new CommandError('version_conflict','Exact unresolved Replan request required');
    if(cmd.name==='retry_replan'&&r.issue_id&&(payload.issue_id!==r.issue_id||typeof payload.answer!=='string'))throw new CommandError('unmet_precondition','Retry requires exact issue and nonblank answer');
    if(payload.answer!==undefined)validate('PlanningText',payload.answer);
    if(cmd.name==='retry_replan'&&!r.issue_id&&(payload.issue_id!==undefined||payload.answer!==undefined))throw new CommandError('unmet_precondition','No current issue accepts that answer');
    const operation=await revokeReplanGeneration(tx,r,cmd.request_id);
    await tx.query('INSERT INTO replan_decisions(task_id,request_id,owner_request_id,kind,body) VALUES($1,$2,$3,$4,$5)',[task.id,r.id,cmd.request_id,cmd.name,payload]);
    if(cmd.name==='dismiss_replan'){
     await tx.query("UPDATE replan_requests SET status='dismissed',direction=$2,version=version+1 WHERE id=$1",[r.id,payload.direction??null]);
     await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[task.id]);await reconcileDismissal(tx,task,r);const successor=await resumeReviewAfterDismissal(tx,task.id,r.id,cmd.request_id,payload.direction as string|undefined);if(successor){result.review_feedback_id=(await tx.query('SELECT feedback_id FROM task_review_operations WHERE id=$1',[successor])).rows[0].feedback_id;result.review_operation_id=successor;result.review_predecessor_operation_id=r.review_operation_id!;}
    }else {await tx.query('UPDATE replan_requests SET source_id=NULL,proposal_id=NULL,issue_id=NULL,version=version+1 WHERE id=$1',[r.id]);}
    result={...result,replan_request_id:r.id,...(operation?{operation_id:operation}:{})};
    await planningEvent(tx,task.id,cmd.name,{replan_request_id:r.id,request_id:cmd.request_id,...payload});
   }
   validate('TaskReplanResult',result);await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)',[task.id,cmd.request_id,hash,json,result]);if(published)this.hooks.beforePublicationCommit?.();this.hooks.beforeCommit?.();return result;
  });this.hooks.afterCommit?.();if(published)this.hooks.afterPublicationCommit?.();return result;
 }
 async pump(limit=8):Promise<void>{
  const requests=(await this.db.pool.query<ReplanRequest>("SELECT * FROM replan_requests WHERE status='pending' OR (status IN ('dismissed','cancelled') AND NOT reconciled) ORDER BY last_checked_at,created_at,id LIMIT $1",[limit])).rows;
  for(const row of requests)await transaction(this.db,async tx=>{const config=await lockConfiguration(tx),task=await lockSpecificationTask(tx,row.task_id),r=(await tx.query<ReplanRequest>('SELECT * FROM replan_requests WHERE id=$1 FOR UPDATE',[row.id])).rows[0]!;await tx.query('UPDATE replan_requests SET last_checked_at=clock_timestamp() WHERE id=$1',[r.id]);
   if(task.state==='CANCELLED'&&r.status==='pending'){await revokeReplanGeneration(tx,r,randomUUID());await tx.query("UPDATE replan_requests SET status='cancelled',version=version+1 WHERE id=$1",[r.id]);r.status='cancelled';}
   if(r.status==='dismissed'||r.status==='cancelled')await reconcileDismissal(tx,task,r);
   else if(r.status==='pending'&&!r.source_id&&!r.proposal_id&&!r.issue_id)await createReplanSource(tx,task,r,config);
  });
  const sources=(await this.db.pool.query<ReplanSource>("SELECT s.* FROM replan_sources s JOIN replan_requests r ON r.source_id=s.id WHERE r.status='pending' AND r.proposal_id IS NULL AND r.issue_id IS NULL AND NOT s.done AND s.preparation_failure IS NULL ORDER BY s.last_checked_at,s.created_at,s.id LIMIT $1",[limit])).rows;
  for(const s of sources)try{await transaction(this.db,async tx=>{const result=await this.scheduling.selectAndEnqueue(tx,{task_id:s.task_id,attempt_id:s.planned_attempt_id,kind:'planner',expected:{control_version:Number(s.expected_version),specification_id:s.specification_id,plan_id:s.plan_id},prompt:s.prompt!,source_watermark:0,task_replan_source:replanSource(s)});if(result.status==='queued')await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[result.runner_id]);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[s.task_id]);await assertReplanSource(tx,s.task_id,replanSource(s),s.planned_attempt_id,s.prompt!);await tx.query('UPDATE replan_sources SET done=$2,waiting_reason=$3,last_checked_at=clock_timestamp() WHERE id=$1',[s.id,result.status==='queued',result.status==='unavailable'?result.reason:null]);});}catch(e){if(!(e instanceof CommandError))throw e;await this.db.pool.query('UPDATE replan_sources SET waiting_reason=$2,last_checked_at=clock_timestamp() WHERE id=$1 AND NOT done',[s.id,e.detail.code]);}
 }
 async status(token:string,taskId:string,requestId?:string,proposalId?:string,cursor?:string,effectsCursor?:string){return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return replanRead(tx,taskId,requestId,proposalId,cursor,effectsCursor);});}
 async receipt(token:string,taskId:string,requestId:string){return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return (await tx.query('SELECT response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.response??{schema_version:1,request_id:requestId,status:'unknown'};});}
}
