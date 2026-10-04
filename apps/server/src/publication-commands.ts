import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { PublicationCommand, PublicationCommandResult, PublicationFinding, PublicationPrepareRequest } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner, prepareTaskProposal, consumeTaskConfirmation } from './owner-commands.ts';
import { insertOperation, effectiveResult, localAdmissionAllowed } from './publication-candidates.ts';
import type { DeliveryOperation } from './publication-candidates.ts';
import { publicationRecord } from './publication-candidate-reads.ts';
import { publicationDigest as hash } from './publication-policy.ts';
import { lockConfiguration } from './configuration-guards.ts';

type Selection=Pick<PublicationCommand['payload'],'candidate_id'|'candidate_manifest_digest'|'effective_basis_digest'|'scan_digest'|'finding_ids'>;
function selection(payload:PublicationCommand['payload']):Selection {
 const {candidate_id,candidate_manifest_digest,effective_basis_digest,scan_digest,finding_ids}=payload;
 if(!finding_ids || canonicalJSON(finding_ids)!==canonicalJSON([...finding_ids].sort()))throw new CommandError('invalid_input','Finding IDs must be sorted and unique');
 return {candidate_id,candidate_manifest_digest,effective_basis_digest,scan_digest,finding_ids};
}
async function validateSelection(tx:Transaction,taskId:string,s:Selection) {
 const op=(await tx.query<DeliveryOperation>("SELECT * FROM delivery_operations WHERE task_id=$1 AND candidate_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[taskId,s.candidate_id])).rows[0];
 if(!op)throw new CommandError('denied_scope','Unknown publication candidate');
 const record=await publicationRecord(tx,op);
 if(!record.override_allowed || !record.scan_applicable || record.candidate_manifest_digest!==s.candidate_manifest_digest || record.effective_basis_digest!==s.effective_basis_digest || record.scan_digest!==s.scan_digest)throw new CommandError('version_conflict','Publication override basis is stale or incomplete');
 const findings=(await tx.query<{finding:PublicationFinding}>('SELECT finding FROM publication_findings WHERE scan_id=$1 AND id=ANY($2::text[])',[op.result!.scan!.scan_id,s.finding_ids])).rows.map(r=>r.finding);
 if(findings.length!==s.finding_ids!.length || findings.some(f=>!f.override_eligible || !['tracked_ignore','publication_policy_size','credential_pattern'].includes(f.kind)))throw new CommandError('denied_scope','Every selected finding must be eligible in this exact scan');
 return op;
}
export class PublicationCommands {
 readonly db:Database;
 constructor(db:Database) {this.db=db;}
 async receipt(token:string,taskId:string,requestId:string):Promise<PublicationCommandResult> {
  validate('Id',taskId);validate('Id',requestId);
  return transaction(this.db,async tx=>{await authenticateOwner(tx,token);const prior=(await tx.query<{response:PublicationCommandResult}>('SELECT response FROM publication_command_receipts WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0];return prior?.response ?? {schema_version:1,task_id:taskId,request_id:requestId,status:'unknown'};});
 }
 async command(token:string,input:unknown):Promise<PublicationCommandResult> {
  const command=validate<PublicationCommand>('PublicationCommand',input),commandDigest=hash(command);
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);await lockConfiguration(tx);
   const task=(await tx.query<{control_version:string;specification_id:string;plan_id:string}>('SELECT control_version,specification_id,plan_id FROM tasks WHERE id=$1 FOR UPDATE',[command.task_id])).rows[0];
   if(!task)throw new CommandError('denied_scope','Unknown Task');
   const prior=(await tx.query<{digest:string;response:PublicationCommandResult}>('SELECT digest,response FROM publication_command_receipts WHERE task_id=$1 AND request_id=$2',[command.task_id,command.request_id])).rows[0];
   if(prior){if(prior.digest!==commandDigest)throw new CommandError('payload_conflict','Publication request ID has immutable content');return prior.response;}
   const result:PublicationCommandResult={schema_version:1,task_id:command.task_id,request_id:command.request_id,status:'committed'};
   switch(command.name) {
    case 'retry_publication_preparation': {
     const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1 AND task_id=$2 FOR UPDATE',[command.payload.operation_id,command.task_id])).rows[0];
     if(!op)throw new CommandError('denied_scope','Unknown preparation operation');
     if(op.request_digest!==command.payload.operation_digest)throw new CommandError('payload_conflict','Preparation request digest differs');
     const record=await publicationRecord(tx,op);
     if(!record.retry_allowed || !await localAdmissionAllowed(tx,op.task_id) || !(await effectiveResult(tx,op.request)).current)throw new CommandError('unmet_precondition','Preparation is not eligible for Retry');
     if(op.state==='pending') {await tx.query('UPDATE delivery_operations SET next_attempt_at=clock_timestamp() WHERE id=$1',[op.id]);result.operation_id=op.id;}
     else {
      if((await tx.query("SELECT 1 FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 AND state='pending' AND dispatch_active",[op.task_id,op.resource_id])).rowCount)throw new CommandError('unmet_precondition','Another preparation remains unresolved');
      const request:PublicationPrepareRequest={...op.request,operation_id:randomUUID(),scan_run_id:randomUUID()};
      await insertOperation(tx,request,hash({retry_of:op.id,request_id:command.request_id}));result.operation_id=request.operation_id;
     }
     break;
    }
    case 'prepare_publication_override': {
     const exact=selection(command.payload);await validateSelection(tx,command.task_id,exact);
     const proposal=await prepareTaskProposal(tx,{id:randomUUID(),task_id:command.task_id,action:'override_publication_findings',content:exact});
     result.proposal_id=proposal.proposal_id;result.content_digest=proposal.content_digest;break;
    }
    case 'confirm_publication_override': {
     const proposal=(await tx.query<{id:string;task_id:string;action:string;content:Selection;content_digest:string;basis:unknown;eligible:boolean}>("SELECT *,NOT revoked AND expires_at>clock_timestamp() AS eligible FROM task_command_proposals WHERE id=$1 FOR UPDATE",[command.payload.proposal_id])).rows[0];
     if(!proposal || proposal.task_id!==command.task_id || proposal.action!=='override_publication_findings')throw new CommandError('denied_scope','Unknown publication override proposal');
     if(proposal.content_digest!==command.payload.content_digest)throw new CommandError('payload_conflict','Confirmation content differs');
     if(!proposal.eligible || canonicalJSON(proposal.basis)!==canonicalJSON({control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id}))throw new CommandError('version_conflict','Confirmation basis changed');
     await validateSelection(tx,command.task_id,proposal.content);
     const existing=(await tx.query<{id:string}>('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[proposal.id])).rows[0];
     result.confirmation_id=existing?.id ?? randomUUID();
     if(!existing)await tx.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[result.confirmation_id,proposal.id]);
     break;
    }
    case 'override_publication_findings': {
     const exact=selection(command.payload),op=await validateSelection(tx,command.task_id,exact);
     await consumeTaskConfirmation(tx,token,command.payload.confirmation_id!,command.request_id,{scope_id:command.task_id,action:'override_publication_findings',content_digest:hash(exact)});
     result.receipt_id=randomUUID();await tx.query('INSERT INTO publication_override_receipts(id,task_id,candidate_id,scan_id,request_id,confirmation_id,selection,selection_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[result.receipt_id,command.task_id,exact.candidate_id,op.result!.scan!.scan_id,command.request_id,command.payload.confirmation_id,exact,hash(exact)]);break;
    }
   }
   validate('PublicationCommandResult',result);
   await tx.query('INSERT INTO publication_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,commandDigest,command,result]);return result;
  });
 }
}
