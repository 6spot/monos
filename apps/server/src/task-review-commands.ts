import { assertNoTaskRework } from './node-rework-state.ts';
import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {OwnerReviewCommand,OwnerReviewCommandResult,TaskReviewBasis} from '../../../packages/protocol/src/index.ts';
import {authenticateOwner} from './owner-commands.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {stopConversationAttempt,ensureConversationHead} from './task-conversation-state.ts';
import type {AttemptRow} from './service.ts';
import {publicationDigest as hash} from './publication-policy.ts';
import {canonicalReviewManifest,reviewBasis} from './task-review-basis.ts';
import {assertDeliveryBatchAuthority,deliveryBatch} from './owner-delivery-state.ts';
import type {DeliveryBatchRecord} from './owner-delivery-state.ts';
import {planningEvent} from './task-planning-state.ts';
import {createReviewOperation,reviewOperation,reviewFeedback,revokeReviewSource,unresolvedReviewStatuses} from './task-review-state.ts';
import type {ReviewInputRow} from './task-review-state.ts';

export interface ReviewHooks {revokeAccepted?:(tx:Transaction,batch:DeliveryBatchRecord,requestId:string)=>Promise<void>;settlementReady?:(tx:Transaction,taskId:string)=>Promise<boolean>}
const discoveryChanged=Symbol('review Runner discovery changed');
export async function assertReviewCorrectionEligible(tx:Transaction,taskId:string):Promise<void>{
 const task=(await tx.query<{state:string}>('SELECT state FROM tasks WHERE id=$1',[taskId])).rows[0];
 if(!task||task.state!=='REVIEW')throw new CommandError('unmet_precondition','Correction requires REVIEW');
 if((await tx.query(`SELECT 1 FROM owner_delivery_finalizations f JOIN owner_delivery_batches b ON b.id=f.batch_id WHERE b.task_id=$1 LIMIT 1`,[taskId])).rowCount)throw new CommandError('unmet_precondition','Finalized delivery cannot be reopened');
 await assertReviewMergeSettled(tx,taskId);
 if((await tx.query(`SELECT 1 FROM task_review_feedback WHERE task_id=$1 AND status='active' UNION ALL SELECT 1 FROM task_review_operations WHERE task_id=$1 AND settlement_pending UNION ALL SELECT 1 FROM task_publication_slots WHERE task_id=$1 LIMIT 1`,[taskId])).rowCount)throw new CommandError('unmet_precondition','An existing review/publication operation must settle');
}
export async function assertReviewMergeSettled(tx:Transaction,taskId:string):Promise<void>{
 const rows=(await tx.query<{id:string;batch_id:string;item_id:string;status:string;effect_owned:boolean;may_have_mutated:boolean;claim:string|null;result:Record<string,unknown>|null;result_digest:string|null}>(`SELECT m.* FROM owner_delivery_merge_operations m JOIN owner_delivery_batches b ON b.id=m.batch_id WHERE b.task_id=$1 AND (m.effect_owned OR m.may_have_mutated OR m.status IN('started','unknown'))`,[taskId])).rows;
 for(const m of rows)if(m.effect_owned||m.claim||m.status!=='failed'||m.result?.state!=='rejected'||m.result_digest!==hash(m.result)||!(await tx.query("SELECT 1 FROM owner_delivery_observations WHERE batch_id=$1 AND item_id=$2 AND operation_id=$3 AND kind='merge' AND digest=$4 AND observation=$5",[m.batch_id,m.item_id,m.id,m.result_digest,m.result])).rowCount)throw new CommandError('unmet_precondition','Original merge must reconcile before correction');
}
export class TaskReviewCommands {
 readonly db:Database;readonly hooks:ReviewHooks;
 constructor(db:Database,hooks:ReviewHooks={}){this.db=db;this.hooks=hooks;}
 async status(token:string,taskId:string,requestId:string):Promise<OwnerReviewCommandResult>{validate('Id',taskId);validate('Id',requestId);return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return (await tx.query<{response:OwnerReviewCommandResult}>('SELECT response FROM owner_review_command_receipts WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.response??{schema_version:1,task_id:taskId,request_id:requestId,status:'unknown'};});}
 async command(token:string,input:unknown):Promise<OwnerReviewCommandResult>{const command=validate<OwnerReviewCommand>('OwnerReviewCommand',input),digest=hash(command);for(let retry=0;retry<3;retry++)try{return await transaction(this.db,async tx=>{
  await authenticateOwner(tx,token);const replay=async()=>{const prior=(await tx.query<{digest:string;response:OwnerReviewCommandResult}>('SELECT digest,response FROM owner_review_command_receipts WHERE task_id=$1 AND request_id=$2',[command.task_id,command.request_id])).rows[0];if(prior&&prior.digest!==digest)throw new CommandError('payload_conflict','Review request content differs');return prior?.response;};const old=await replay();if(old)return old;
  await lockConfiguration(tx);const discover=async()=>(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 AND NOT process_released ORDER BY runner_id',[command.task_id])).rows.map(r=>r.runner_id);const runners=await discover();for(const r of runners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[r]);const task=(await tx.query<{state:string;control_version:string;accepted_delivery_operation_id:string|null}>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[command.task_id])).rows[0];if(!task)throw new CommandError('denied_scope','Unknown Task');const locked=await replay();if(locked)return locked;if(canonicalJSON(await discover())!==canonicalJSON(runners))throw discoveryChanged;
  const p=command.payload,result:OwnerReviewCommandResult={schema_version:1,task_id:command.task_id,request_id:command.request_id,status:'committed',name:command.name,feedback_id:p.feedback_id};let written=false;
  if(command.name==='request_changes'){
  await assertNoTaskRework(tx,command.task_id);
   await assertReviewCorrectionEligible(tx,command.task_id);const basis=await reviewBasis(tx,command.task_id);if(canonicalJSON(basis)!==canonicalJSON(p.basis))throw new CommandError('version_conflict','Reviewed result basis changed');
   if(!!task.accepted_delivery_operation_id!==!!p.accepted_batch)throw new CommandError('unmet_precondition','Exact current accepted batch binding required');
   const batch=task.accepted_delivery_operation_id?await deliveryBatch(tx,command.task_id,task.accepted_delivery_operation_id,true):undefined;
   if(batch){await assertDeliveryBatchAuthority(tx,batch);if(batch.id!==p.accepted_batch!.operation_id||batch.content_digest!==p.accepted_batch!.content_digest||Number(batch.version)!==p.accepted_batch!.expected_version)throw new CommandError('version_conflict','Accepted batch changed');if(!this.hooks.revokeAccepted)throw new CommandError('unmet_precondition','Correction settlement coordinator is unavailable');}
   const manifest=await canonicalReviewManifest(tx,command.task_id);await tx.query('INSERT INTO task_review_feedback(id,task_id,request_id,text,basis,manifest,review_result_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.feedback_id,command.task_id,command.request_id,p.text,basis,manifest,basis.review_result_digest]);
   const currentBasis:TaskReviewBasis={...basis,control_version:Number(task.control_version)+1},operationId=await createReviewOperation(tx,{task_id:command.task_id,feedback_id:p.feedback_id!,basis:currentBasis});await tx.query('UPDATE task_review_feedback SET current_operation_id=$2 WHERE id=$1',[p.feedback_id,operationId]);result.operation_id=operationId;result.operation_version=1;result.review_result_digest=basis.review_result_digest;
   if(batch){const revocationId=randomUUID();result.revoked_batch={operation_id:batch.id,content_digest:batch.content_digest,operation_version:Number(batch.version)+1,input_cutoff:Number(batch.input_cutoff),revocation_id:revocationId};await tx.query('INSERT INTO owner_delivery_revocations(id,task_id,batch_id,feedback_id,request_id,content_digest,input_cutoff,batch_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[revocationId,command.task_id,batch.id,p.feedback_id,command.request_id,batch.content_digest,batch.input_cutoff,Number(batch.version)+1]);
    validate('OwnerReviewCommandResult',result);await tx.query('INSERT INTO owner_review_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,digest,command,result]);written=true;
    await this.hooks.revokeAccepted!(tx,batch,command.request_id);await tx.query("UPDATE owner_delivery_batches SET status='revoked',version=version+1 WHERE id=$1",[batch.id]);await tx.query('UPDATE tasks SET accepted_delivery_operation_id=NULL,accepted_delivery_input_cutoff=NULL WHERE id=$1',[command.task_id]);
    for(const late of (await tx.query<{id:string;sequence:string;reply_id:string|null}>(`SELECT i.id,m.sequence,r.id reply_id FROM task_inputs i JOIN task_messages m ON m.id=i.message_id LEFT JOIN task_messages r ON r.input_id=i.id AND r.author='assistant' WHERE i.task_id=$1 AND i.accepted_delivery_operation_id=$2 AND i.status<>'withdrawn' ORDER BY m.sequence`,[command.task_id,batch.id])).rows){const id=randomUUID();await tx.query('INSERT INTO task_input_reconsiderations(id,task_id,feedback_id,revocation_id,input_id,accepted_batch_id,sequence,original_reply_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,command.task_id,p.feedback_id,revocationId,late.id,batch.id,late.sequence,late.reply_id]);const op=await createReviewOperation(tx,{task_id:command.task_id,feedback_id:p.feedback_id!,basis:currentBasis,purpose:'reconsider_input',reconsideration_id:id});await tx.query('UPDATE task_input_reconsiderations SET operation_id=$2 WHERE id=$1',[id,op]);}
   }
   const scratch=(await tx.query<AttemptRow>(`SELECT a.* FROM attempts a JOIN task_conversation_outbox s ON s.planned_attempt_id=a.id WHERE a.task_id=$1 AND (a.state='QUEUED' OR NOT a.process_released) ORDER BY a.id FOR UPDATE OF a`,[command.task_id])).rows;
   await tx.query('UPDATE task_conversation_outbox SET done=true WHERE task_id=$1 AND NOT done',[command.task_id]);
   for(const a of scratch){await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'",[a.id]);await tx.query("UPDATE attempts SET mutation_allowed=false,state=CASE WHEN state='SUCCEEDED' THEN state ELSE 'CANCELLED' END,process_absent=CASE WHEN state='QUEUED' THEN true ELSE process_absent END,end_reason='review_revoked' WHERE id=$1",[a.id]);await stopConversationAttempt(tx,a,command.request_id);}
   await tx.query('UPDATE tasks SET conversation_source_id=NULL WHERE id=$1',[command.task_id]);
   await tx.query('UPDATE tasks SET conversation_input_id=NULL WHERE id=$1 AND conversation_input_id IN(SELECT input_id FROM task_input_reconsiderations WHERE feedback_id=$2)',[command.task_id,p.feedback_id]);await ensureConversationHead(tx,command.task_id);
   await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[command.task_id]);await planningEvent(tx,command.task_id,'review_feedback_requested',{feedback_id:p.feedback_id,operation_id:operationId,review_result_digest:basis.review_result_digest,...(result.revoked_batch?{revoked_batch:result.revoked_batch}:{})});
  }else{
   const op=await reviewOperation(tx,command.task_id,p.operation_id!,true),f=await reviewFeedback(tx,command.task_id,p.feedback_id!);if(op.feedback_id!==f.id||Number(op.version)!==p.expected_version)throw new CommandError('version_conflict','Review operation capability changed');
   const isInput=command.name.endsWith('_input'),i=op.reconsideration_id?(await tx.query<ReviewInputRow>('SELECT * FROM task_input_reconsiderations WHERE id=$1',[op.reconsideration_id])).rows[0]:undefined;
   if(isInput?op.purpose!=='reconsider_input'||i?.id!==p.reconsideration_id||!!(await tx.query('SELECT 1 FROM task_review_input_successors successor WHERE successor.reconsideration_id=$1 AND successor.predecessor_operation_id=$2',[i?.id,op.id])).rowCount:op.purpose!=='route_feedback'||f.current_operation_id!==op.id)throw new CommandError('denied_scope','Review action addresses another owning obligation');if(!(unresolvedReviewStatuses.includes(op.status)||!isInput&&f.status==='active'&&['requirement','replan'].includes(op.status))||['COMPLETED','CANCELLED'].includes(task.state))throw new CommandError('unmet_precondition','Review operation is already resolved or Task is terminal');
   const isRetry=command.name.startsWith('retry');if(isRetry){if(!['failed','issue'].includes(op.status))throw new CommandError('unmet_precondition','Live or settling review source cannot Retry');if(op.issue_id?p.issue_id!==op.issue_id||!p.answer:p.issue_id!==undefined||p.answer!==undefined)throw new CommandError('unmet_precondition','Exact open issue and Owner answer required');}
   await revokeReviewSource(tx,op,command.request_id);
   const transferred=['requirement','replan'].includes(op.status);
   await tx.query("UPDATE task_review_operations SET status=CASE WHEN $3 THEN status ELSE $2 END,version=version+1,previous_source_id=COALESCE(source_id,previous_source_id),source_id=NULL,issue_id=NULL,settlement_pending=true,reason=NULL,due_at=clock_timestamp() WHERE id=$1",[op.id,isRetry?'settling':'withdrawn',transferred]);
   if(!isRetry){if(isInput&&i!.status==='pending')await tx.query("UPDATE task_input_reconsiderations SET status='withdrawn' WHERE id=$1",[i!.id]);else if(!isInput)await tx.query("UPDATE task_review_feedback SET status='withdrawn' WHERE id=$1",[f.id]);if(!transferred)await tx.query('INSERT INTO task_review_resolutions(operation_id,task_id,request_id,kind,body) VALUES($1,$2,$3,$4,$5)',[op.id,command.task_id,command.request_id,'withdrawn',command]);}
   result.operation_id=op.id;result.operation_version=Number(op.version)+1;if(i)result.reconsideration_id=i.id;await planningEvent(tx,command.task_id,command.name,{feedback_id:f.id,operation_id:op.id,request_id:command.request_id});
  }
  validate('OwnerReviewCommandResult',result);if(!written)await tx.query('INSERT INTO owner_review_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,digest,command,result]);await tx.query('INSERT INTO task_review_decisions(task_id,request_id,operation_id,operation_version,name,body) VALUES($1,$2,$3,$4,$5,$6)',[command.task_id,command.request_id,result.operation_id,result.operation_version,command.name,p]);return result;
 });}catch(error){if(error!==discoveryChanged)throw error;}throw new CommandError('unmet_precondition','Review physical owners changed; retry the original request');}
}
