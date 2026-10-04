import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {RemotePreparationCommand,RemotePreparationCommandResult,PublicationPushRequest} from '../../../packages/protocol/src/index.ts';
import {authenticateOwner} from './owner-commands.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {publicationDigest as hash} from './publication-policy.ts';
import {remoteRecord} from './remote-preparation-reads.ts';
import type {RemoteItem,RemoteOperation} from './remote-preparation-state.ts';
import {ordinaryRemoteAdmission} from './remote-preparation-guards.ts';
import {insertRemoteOperation} from './remote-preparation.ts';

export class RemotePreparationCommands {
 readonly db:Database;
 constructor(db:Database){this.db=db;}
 async receipt(token:string,taskId:string,requestId:string):Promise<RemotePreparationCommandResult> {
  validate('Id',taskId);validate('Id',requestId);return transaction(this.db,async tx=>{await authenticateOwner(tx,token);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');const receipt=(await tx.query<{response:RemotePreparationCommandResult}>('SELECT response FROM remote_preparation_command_receipts WHERE task_id=$1 AND request_id=$2',[taskId,requestId])).rows[0];return receipt?.response??{schema_version:1,task_id:taskId,request_id:requestId,status:'unknown'};});
 }
 async command(token:string,input:unknown):Promise<RemotePreparationCommandResult> {
  const command=validate<RemotePreparationCommand>('RemotePreparationCommand',input),digest=hash(command);
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);await lockConfiguration(tx);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[command.task_id])).rowCount)throw new CommandError('denied_scope','Unknown Task');
   const previous=(await tx.query<{digest:string;response:RemotePreparationCommandResult}>('SELECT digest,response FROM remote_preparation_command_receipts WHERE task_id=$1 AND request_id=$2',[command.task_id,command.request_id])).rows[0];if(previous){if(previous.digest!==digest)throw new CommandError('payload_conflict','Remote Retry request is immutable');return previous.response;}
   const located=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 AND task_id=$2',[command.payload.operation_id,command.task_id])).rows[0];if(!located)throw new CommandError('denied_scope','Unknown remote operation');
   const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[located.item_id])).rows[0]!,op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 FOR UPDATE',[located.id])).rows[0]!;
   if(op.request_digest!==command.payload.operation_digest)throw new CommandError('payload_conflict','Remote operation digest differs');if(Number(op.version)!==command.payload.expected_version)throw new CommandError('version_conflict','Remote operation version changed');
   const record=await remoteRecord(tx,item,op);let actual=op;
   if(record.retry_allowed) {
    const original=validate<PublicationPushRequest>('PublicationPushRequest',op.request),receipts=await ordinaryRemoteAdmission(tx,item,original.preparation,original.prepared,op.id);
    if((item.last_published_proof?.candidate.head??null)!==original.expected_head)throw new CommandError('version_conflict','Published parent changed');
    if((await tx.query("SELECT 1 FROM remote_preparation_operations WHERE item_id=$1 AND active AND state NOT IN('settled','revoked')",[item.item_id])).rowCount)throw new CommandError('unmet_precondition','Another remote operation is unresolved');
    actual=await insertRemoteOperation(tx,item,{...original,operation_id:randomUUID(),override_receipts:receipts});
   } else if(record.read_retry_allowed||record.cleanup_allowed) {
    // A settled uncertain result is never changed. Wake its item-level observer.
    if(op.state!=='settled'&&op.state!=='revoked')actual=(await tx.query<RemoteOperation>("UPDATE remote_preparation_operations SET next_attempt_at=clock_timestamp(),state=CASE WHEN state='failed' AND NOT may_have_mutated THEN 'pending' ELSE state END,version=version+1 WHERE id=$1 RETURNING *",[op.id])).rows[0]!;
    await tx.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp() WHERE item_id=$1',[item.item_id]);
   } else throw new CommandError('unmet_precondition','This exact remote operation is not eligible for Retry');
   const response=validate<RemotePreparationCommandResult>('RemotePreparationCommandResult',{schema_version:1,task_id:command.task_id,request_id:command.request_id,status:'committed',operation_id:actual.id,operation_digest:actual.request_digest,operation_version:Number(actual.version)});
   await tx.query('INSERT INTO remote_preparation_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[command.task_id,command.request_id,digest,command,response]);return response;
  });
 }
}
