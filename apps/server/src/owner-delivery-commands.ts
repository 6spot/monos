import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {OwnerDeliveryCommand,OwnerDeliveryCommandResult,DeliveryAcceptanceBasis,DeliveryRepository} from '../../../packages/protocol/src/index.ts';
import {authenticateOwner,prepareTaskProposal,consumeTaskConfirmation} from './owner-commands.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {publicationDigest as hash} from './publication-policy.ts';
import {buildDeliveryAcceptance,deliveryBatch,deliveryBatchRecord,completeLocalDelivery} from './owner-delivery-state.ts';
import type {DeliveryBatchRecord} from './owner-delivery-state.ts';
import {planningEvent} from './task-planning-state.ts';

export interface OwnerDeliveryHooks {
 admitAcceptedPreparation?:(tx:Transaction,batch:DeliveryBatchRecord,items:DeliveryRepository[])=>Promise<void>;
 retryAcceptedDelivery?:(tx:Transaction,batch:DeliveryBatchRecord,requestId:string)=>Promise<void>;
 cancelAcceptedDelivery?:(tx:Transaction,batch:DeliveryBatchRecord,requestId:string)=>Promise<void>;
}
const discoveryChanged=Symbol('delivery cancellation Runner discovery changed');
export class OwnerDeliveryCommands {
 readonly db:Database;readonly hooks:OwnerDeliveryHooks;
 constructor(db:Database,hooks:OwnerDeliveryHooks={}){this.db=db;this.hooks=hooks;}
 async status(token:string,taskId:string,requestId:string):Promise<OwnerDeliveryCommandResult>{
  validate('Id',taskId);validate('Id',requestId);
  return transaction(this.db,async tx=>{await authenticateOwner(tx,token);return (await tx.query<{response:OwnerDeliveryCommandResult}>('SELECT response FROM owner_delivery_command_receipts WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0]?.response??{schema_version:1,task_id:taskId,request_id:requestId,status:'unknown'};});
 }
 async command(token:string,input:unknown):Promise<OwnerDeliveryCommandResult>{
  const command=validate<OwnerDeliveryCommand>('OwnerDeliveryCommand',input),commandDigest=hash(command);
  for(let attempt=0;attempt<3;attempt++)try{return await transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);
   const prior=async()=>{
    const row=(await tx.query<{digest:string;response:OwnerDeliveryCommandResult}>('SELECT digest,response FROM owner_delivery_command_receipts WHERE task_id=$1 AND request_id=$2',[command.task_id,command.request_id])).rows[0];
    if(row&&row.digest!==commandDigest)throw new CommandError('payload_conflict','Request ID has different immutable delivery content');return row?.response;
   };
   const replay=await prior();if(replay)return replay;
   await lockConfiguration(tx);
   const discover=async()=>(await tx.query<{runner_id:string}>('SELECT DISTINCT runner_id FROM attempts WHERE task_id=$1 AND NOT process_released ORDER BY runner_id',[command.task_id])).rows.map(r=>r.runner_id);
   const runners=command.name==='cancel_delivery'?await discover():[];
   for(const id of runners)await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE',[id]);
   const task=(await tx.query<{state:string;conversation_sequence:string;accepted_delivery_operation_id:string|null}>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[command.task_id])).rows[0];
   if(!task)throw new CommandError('denied_scope','Unknown Task');
   const lockedReplay=await prior();if(lockedReplay)return lockedReplay;
   if(command.name==='cancel_delivery'&&canonicalJSON(await discover())!==canonicalJSON(runners))throw discoveryChanged;
   const result:OwnerDeliveryCommandResult={schema_version:1,task_id:command.task_id,request_id:command.request_id,status:'committed',name:command.name};let receiptWritten=false;
   switch(command.name){
    case 'prepare_delivery_acceptance':{
     const manifest=await buildDeliveryAcceptance(tx,command.task_id,command.payload.basis as DeliveryAcceptanceBasis);
     const prepared=await prepareTaskProposal(tx,{id:randomUUID(),task_id:command.task_id,action:'accept_delivery',content:manifest});
     await tx.query('INSERT INTO owner_delivery_proposals(proposal_id,task_id,request_id) VALUES($1,$2,$3)',[prepared.proposal_id,command.task_id,command.request_id]);
     result.proposal_id=prepared.proposal_id;result.content_digest=prepared.content_digest;break;
    }
    case 'confirm_delivery_acceptance':case 'accept_delivery':{
     const proposal=(await tx.query<{id:string;content_digest:string;basis:DeliveryAcceptanceBasis;content:unknown;eligible:boolean}>(`SELECT p.*,NOT p.revoked AND p.expires_at>clock_timestamp() eligible FROM task_command_proposals p JOIN owner_delivery_proposals d ON d.proposal_id=p.id WHERE p.id=$1 AND p.task_id=$2 AND p.action='accept_delivery' FOR UPDATE OF p`,[command.payload.proposal_id,command.task_id])).rows[0];
     if(!proposal)throw new CommandError('denied_scope','Unknown delivery proposal');
     if(proposal.content_digest!==command.payload.content_digest)throw new CommandError('payload_conflict','Delivery proposal content differs');
     if(!proposal.eligible)throw new CommandError('unmet_precondition','Delivery proposal expired or revoked');
     const manifest=await buildDeliveryAcceptance(tx,command.task_id,proposal.basis);
     if(hash(manifest)!==proposal.content_digest||canonicalJSON(manifest)!==canonicalJSON(proposal.content))throw new CommandError('version_conflict','source_changed');
     result.proposal_id=proposal.id;result.content_digest=proposal.content_digest;
     if(command.name==='confirm_delivery_acceptance'){
      const old=(await tx.query<{id:string}>('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[proposal.id])).rows[0];
      const authorization=old?.id??randomUUID();
      if(!old){await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[authorization,proposal.id]);await tx.query('INSERT INTO owner_delivery_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[authorization,command.task_id,command.request_id]);}
      result.confirmation_id=authorization;
     }else{
      if(canonicalJSON(command.payload.basis)!==canonicalJSON(proposal.basis))throw new CommandError('version_conflict','Delivery admission basis differs');
      const confirmation=(await tx.query<{id:string}>(`SELECT a.id FROM authorization_receipts a JOIN owner_delivery_authorization_commands c ON c.authorization_id=a.id WHERE a.id=$1 AND a.proposal_id=$2 AND c.task_id=$3 AND a.consumed_by IS NULL FOR UPDATE OF a`,[command.payload.confirmation_id,proposal.id,command.task_id])).rows[0];
      if(!confirmation)throw new CommandError('denied_scope','Dedicated unconsumed delivery confirmation required');
      const id=randomUUID(),cutoff=Number(task.conversation_sequence);
      if(manifest.repositories.some(r=>r.outcome==='modified')&&!this.hooks.admitAcceptedPreparation)throw new CommandError('unmet_precondition','Accepted preparation coordinator is unavailable');
      for(const r of manifest.repositories.filter(r=>r.outcome==='modified')){
       const url=(await tx.query<{remote_url:string}>('SELECT remote_url FROM project_resources WHERE id=$1',[r.resource_id])).rows[0]!.remote_url;
       await tx.query('INSERT INTO remote_preparation_items(item_id,task_id,resource_id,runner_id,storage_id,repository_identity,repository_id,remote_url,delivery_ref,target_branch,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(item_id) DO NOTHING',[r.item_id,command.task_id,r.resource_id,r.source.runner_id,r.source.storage_id,r.repository_identity,r.provider_metadata.github!.repository_id,url,r.delivery_ref,r.target_branch,r.marker]);
      }
      const batch=(await tx.query<DeliveryBatchRecord>('INSERT INTO owner_delivery_batches(id,task_id,manifest,content_digest,proposal_id,confirmation_id,admission_request_id,input_cutoff) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,command.task_id,manifest,proposal.content_digest,proposal.id,confirmation.id,command.request_id,cutoff])).rows[0]!;
      for(const [ordinal,r] of manifest.repositories.entries())await tx.query('INSERT INTO owner_delivery_batch_items(batch_id,ordinal,task_id,item_id,resource_id,repository,repository_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ordinal,command.task_id,r.item_id??null,r.resource_id,r,hash(r)]);
      await consumeTaskConfirmation(tx,token,confirmation.id,command.request_id,{scope_id:command.task_id,action:'accept_delivery',content_digest:proposal.content_digest});
      await tx.query('UPDATE tasks SET accepted_delivery_operation_id=$2,accepted_delivery_input_cutoff=$3 WHERE id=$1',[command.task_id,id,cutoff]);
      result.confirmation_id=confirmation.id;result.operation_id=id;result.operation_version=1;result.input_cutoff=cutoff;
      validate('OwnerDeliveryCommandResult',result);
      await tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,commandDigest,command,result]);receiptWritten=true;
      await this.hooks.admitAcceptedPreparation?.(tx,batch,manifest.repositories);
      await planningEvent(tx,command.task_id,'delivery_accepted',{batch_id:id,content_digest:proposal.content_digest,input_cutoff:cutoff});
      if(!manifest.repositories.some(r=>r.outcome==='modified'))await completeLocalDelivery(tx,batch);
     }
     break;
    }
    case 'retry_delivery':case 'cancel_delivery':{
     const b=await deliveryBatch(tx,command.task_id,command.payload.operation_id!,true);
     if(b.content_digest!==command.payload.content_digest)throw new CommandError('payload_conflict','Frozen delivery digest differs');
     if(Number(b.version)!==command.payload.expected_version)throw new CommandError('version_conflict','Delivery capability version changed');
     if(task.accepted_delivery_operation_id!==b.id)throw new CommandError('unmet_precondition','Delivery batch is historical');
     const projection=await deliveryBatchRecord(tx,b);
     if(command.name==='retry_delivery'){
      if(!projection.batch.retry_allowed)throw new CommandError('unmet_precondition','Delivery is not eligible for Retry');
      await this.hooks.retryAcceptedDelivery?.(tx,b,command.request_id);
      await tx.query("UPDATE owner_delivery_batches SET due_at=clock_timestamp(),version=version+1 WHERE id=$1",[b.id]);
     }else{
      if(!projection.batch.cancel_allowed||task.state==='COMPLETED')throw new CommandError('unmet_precondition','Completed delivery cannot be cancelled');
      if(!this.hooks.cancelAcceptedDelivery)throw new CommandError('unmet_precondition','Accepted cancellation coordinator is unavailable');
      await this.hooks.cancelAcceptedDelivery(tx,b,command.request_id);
      await tx.query("UPDATE owner_delivery_batches SET status='cancelled',due_at=clock_timestamp(),version=version+1 WHERE id=$1",[b.id]);
     }
     result.operation_id=b.id;result.content_digest=b.content_digest;result.operation_version=Number((await deliveryBatch(tx,command.task_id,b.id)).version);break;
    }
   }
   validate('OwnerDeliveryCommandResult',result);
   if(!receiptWritten)await tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,commandDigest,command,result]);return result;
  });}catch(error){if(error!==discoveryChanged)throw error;}
  throw new CommandError('unmet_precondition','Execution ownership changed during cancellation');
 }
}
