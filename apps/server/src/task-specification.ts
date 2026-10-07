import {resumeReviewAfterRequirementWithdrawal} from './task-review-state.ts';
import type { ReplanRequest } from './task-replan-state.ts';
import { specificationRead,specificationHistory,specificationChangeRead } from './task-specification-reads.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database,Transaction } from '../../../packages/db/src/index.ts';
import { canonicalJSON,digest,validate } from '../../../packages/protocol/src/index.ts';
import type { TaskSpecificationCommand,TaskSpecificationResult,PrepareSpecificationRevision,ApplySpecificationRevision } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { prepareSpecification,attachSpecification,requirementProposal,eligibleRequirement,exactBasis } from './task-specification-state.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { admitSpecification,advanceSpecification } from './task-specification-settlement.ts';
import type { RequirementChange } from './task-specification-settlement.ts';

// Every writer discovers Runner ownership before Task, then verifies the discovered set.
export async function lockSpecificationTask(tx:Transaction,taskId:string):Promise<SpecificationTask>{
 const runners=(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[taskId])).rows;
 for(const r of runners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[r.runner_id]);
 const task=(await tx.query<SpecificationTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];if(!task)throw new CommandError('denied_scope','Unknown Task');
 const current=(await tx.query('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 ORDER BY runner_id',[taskId])).rows;
 if(canonicalJSON(runners)!==canonicalJSON(current))throw new CommandError('control_unavailable','Runner ownership changed; retry immutable request');
 return task;
}
export class TaskSpecification {
 readonly db:Database;
 readonly hooks: {beforeCommit?:()=>void;afterCommit?:()=>void;beforePublicationCommit?:()=>void;afterPublicationCommit?:()=>void};
 constructor(db:Database,hooks:{beforeCommit?:()=>void;afterCommit?:()=>void;beforePublicationCommit?:()=>void;afterPublicationCommit?:()=>void}={}){this.db=db;this.hooks=hooks;}
 async command(token:string,body:unknown):Promise<TaskSpecificationResult>{
 const cmd=validate<TaskSpecificationCommand>('TaskSpecificationCommand',body),json=canonicalJSON(cmd),hash=digest(json);
 let published=false;
 const committed=await transaction(this.db,async tx=>{
  await authenticateOwner(tx,token);const config=await lockConfiguration(tx);const task=await lockSpecificationTask(tx,cmd.task_id);
  const prior=(await tx.query<{digest:string;response:TaskSpecificationResult}>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',[task.id,cmd.request_id])).rows[0];
  if(prior){if(prior.digest!==hash)throw new CommandError('payload_conflict','Request content changed');return prior.response;}
  const payload=cmd.payload as Record<string,unknown>;let result:TaskSpecificationResult={schema_version:1,request_id:cmd.request_id,status:'committed'};
  if(cmd.name==='edit_specification'){
   const p=await prepareSpecification(tx,task,cmd.payload as unknown as PrepareSpecificationRevision);await attachSpecification(tx,task,p,null,null);
   const confirmation=randomUUID();await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[confirmation,p.id]);await tx.query('INSERT INTO requirement_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[confirmation,task.id,cmd.request_id]);
   const c=await admitSpecification(tx,task,p,confirmation,cmd.request_id);await advanceSpecification(tx,task,c,config);
   result={...result,proposal_id:p.id,content_digest:p.content_digest,confirmation_id:confirmation,operation_id:c.id,status:'admitted'};
  }else if(cmd.name==='confirm_specification'){
   const p=await requirementProposal(tx,String(payload.proposal_id),task.id);await eligibleRequirement(tx,task,p);
   if(payload.content_digest!==p.content_digest)throw new CommandError('payload_conflict','Displayed exact proposal digest changed');
   let confirmation=(await tx.query<{id:string}>('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[p.id])).rows[0]?.id;
   if(!confirmation){confirmation=randomUUID();await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[confirmation,p.id]);await tx.query('INSERT INTO requirement_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[confirmation,task.id,cmd.request_id]);}
   result={...result,proposal_id:p.id,content_digest:p.content_digest,confirmation_id:confirmation};
  }else if(cmd.name==='apply_specification_revision'){
   const input=cmd.payload as unknown as ApplySpecificationRevision,p=await requirementProposal(tx,input.proposal_id,task.id);
   const existing=(await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE proposal_id=$1',[p.id])).rows[0];
   if(existing&&existing.authorization_id!==input.confirmation_id)throw new CommandError('payload_conflict','Applied proposal requires its original confirmation');
   if(!existing)exactBasis(task,input.basis);
   const c=existing??await admitSpecification(tx,task,p,input.confirmation_id,cmd.request_id);if(!existing)await advanceSpecification(tx,task,c,config);
   result={...result,operation_id:c.id,proposal_id:p.id,status:'admitted'};
  }else if(cmd.name==='defer_specification_inputs'){
   const p=await requirementProposal(tx,String(payload.proposal_id),task.id);
   if(!(await tx.query("SELECT 1 FROM requirement_obligations WHERE id=$1 AND current_proposal_id=$2 AND status='pending'",[p.obligation_id,p.id])).rowCount)throw new CommandError('unmet_precondition','Proposal no longer owns pending work');
   for(const input of payload.inputs as {input_id:string;version:number}[]){if(!(await tx.query('SELECT 1 FROM task_inputs WHERE task_id=$1 AND id=$2 AND version=$3',[task.id,input.input_id,input.version])).rowCount)throw new CommandError('version_conflict','Deferral requires exact input version');await tx.query('INSERT INTO requirement_input_deferrals(task_id,proposal_id,input_id,input_version,request_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[task.id,p.id,input.input_id,input.version,cmd.request_id]);}
   result={...result,proposal_id:p.id};
  }else if(cmd.name==='withdraw_specification'){
   const p=await requirementProposal(tx,String(payload.proposal_id),task.id);
   const c=(await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE proposal_id=$1',[p.id])).rows[0];
   if(c){if(Number(c.version)!==payload.expected_version||c.status!=='settling')throw new CommandError('version_conflict','Change operation no longer withdrawable');await tx.query("UPDATE requirement_changes SET status='withdrawing',version=version+1 WHERE id=$1",[c.id]);await advanceSpecification(tx,task,{...c,status:'withdrawing'},config);result={...result,operation_id:c.id};}
   else {const o=(await tx.query<{version:string;current_proposal_id:string;status:string}>('SELECT * FROM requirement_obligations WHERE id=$1',[p.obligation_id])).rows[0]!;if(Number(o.version)!==payload.expected_version||o.status!=='pending'||o.current_proposal_id!==p.id)throw new CommandError('version_conflict','Proposal no longer withdrawable');await tx.query("UPDATE requirement_obligations SET status='withdrawn',version=version+1 WHERE id=$1",[p.obligation_id]);}
   const linked=(await tx.query<{request_id:string}>('SELECT s.request_id FROM requirement_proposals p JOIN replan_sources s ON s.id=p.replan_source_id WHERE p.id=$1',[p.id])).rows[0];
   if(linked){const {revokeReplanGeneration}=await import('./task-replan.ts');const r=(await tx.query<ReplanRequest>('SELECT * FROM replan_requests WHERE id=$1',[linked.request_id])).rows[0];if(r?.status==='pending'){await revokeReplanGeneration(tx,r,cmd.request_id);await tx.query('UPDATE replan_requests SET source_id=NULL,proposal_id=NULL,issue_id=NULL,version=version+1 WHERE id=$1',[r.id]);}}
   await tx.query('UPDATE task_command_proposals SET revoked=true WHERE id=$1 AND NOT revoked',[p.id]);await resumeReviewAfterRequirementWithdrawal(tx,task.id,p.id,cmd.request_id);result={...result,proposal_id:p.id};
  }else if(cmd.name==='retry_specification'){
   const c=(await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE id=$1 AND task_id=$2',[payload.operation_id,task.id])).rows[0];if(!c||Number(c.version)!==payload.expected_version||!['settling','withdrawing'].includes(c.status))throw new CommandError('version_conflict','Exact unsettled change operation required');
   await tx.query("UPDATE operations SET state='admitted' WHERE id IN(SELECT operation_id FROM requirement_change_effects WHERE change_id=$1) AND state='recovery' AND NOT EXISTS(SELECT 1 FROM operations child WHERE child.completion_operation_id=operations.id)",[c.id]);
   await tx.query("UPDATE outbox SET done=false,last_sent_at=NULL WHERE operation_id IN(SELECT e.operation_id FROM requirement_change_effects e JOIN operations o ON o.id=e.operation_id WHERE e.change_id=$1 AND o.state='admitted')",[c.id]);await advanceSpecification(tx,task,c,config);result={...result,operation_id:c.id};
  }
  validate('TaskSpecificationResult',result);await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)',[task.id,cmd.request_id,hash,json,result]);if(result.operation_id)published=!!(await tx.query("SELECT 1 FROM requirement_changes WHERE id=$1 AND status='published'",[result.operation_id])).rowCount;if(published)this.hooks.beforePublicationCommit?.();this.hooks.beforeCommit?.();return result;
 });
 this.hooks.afterCommit?.();if(published)this.hooks.afterPublicationCommit?.();return committed;
 }
 async pump(limit=8):Promise<void>{
  const rows=(await this.db.pool.query<{task_id:string;id:string}>("SELECT id,task_id FROM requirement_changes WHERE status IN ('settling','withdrawing') ORDER BY last_checked_at,created_at,id LIMIT $1",[limit])).rows;
  for(const row of rows){const published=await transaction(this.db,async tx=>{const config=await lockConfiguration(tx);const task=await lockSpecificationTask(tx,row.task_id);const c=(await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE id=$1 FOR UPDATE',[row.id])).rows[0]!;if(!['settling','withdrawing'].includes(c.status))return false;await tx.query('UPDATE requirement_changes SET last_checked_at=clock_timestamp() WHERE id=$1',[c.id]);await advanceSpecification(tx,task,c,config);const published=c.status!=='published'&&(await tx.query("SELECT status FROM requirement_changes WHERE id=$1",[c.id])).rows[0]?.status==='published';if(published)this.hooks.beforePublicationCommit?.();return published;});if(published)this.hooks.afterPublicationCommit?.();}
 }
 async status(token:string,taskId:string,proposalId?:string){validate('Id',taskId);if(proposalId)validate('Id',proposalId);return transaction(this.db,async tx=>{await authenticateOwner(tx,token);const task=(await tx.query<SpecificationTask>('SELECT * FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rows[0];if(!task)throw new CommandError('denied_scope','Unknown Task');return specificationRead(tx,task,proposalId);});}
 async change(token:string,taskId:string,changeId:string,cursor?:string){return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return specificationChangeRead(tx,taskId,changeId,cursor);});}
 async history(token:string,taskId:string,kind:'proposals'|'revisions',cursor?:string,revisionId?:string){return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return specificationHistory(tx,taskId,kind,cursor,revisionId);});}
 async receipt(token:string,taskId:string,requestId:string){return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return (await tx.query('SELECT response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.response??{schema_version:1,request_id:requestId,status:'unknown'};});}
}
