import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {DeliveryAcceptanceManifest,DeliveryProposalSummary,DeliveryProposalDetail,OwnerDeliveryStatus,DeliveryBatch} from '../../../packages/protocol/src/index.ts';
import {authenticateOwner} from './owner-commands.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {publicationDigest as hash} from './publication-policy.ts';
import {buildDeliveryAcceptance,deliveryBatch,deliveryBatchRecord} from './owner-delivery-state.ts';
import type {DeliveryBatchRecord} from './owner-delivery-state.ts';

interface ProposalRow {id:string;content_digest:string;content:DeliveryAcceptanceManifest;basis:DeliveryProposalSummary['basis'];expires_at:Date;revoked:boolean;confirmation_id:string|null;history_at:string}
const proposalSQL=`SELECT p.*,a.id confirmation_id,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') history_at FROM task_command_proposals p JOIN owner_delivery_proposals d ON d.proposal_id=p.id LEFT JOIN authorization_receipts a ON a.proposal_id=p.id WHERE p.task_id=$1`;
interface HistoryCursor {v:1;task_id:string;kind:'proposals'|'batches';created_at:string;id:string}
const encodeHistory=(value:HistoryCursor)=>Buffer.from(canonicalJSON(value)).toString('base64url');
function historyCursor(taskId:string,kind:HistoryCursor['kind'],input?:string):HistoryCursor|undefined {
 if(!input)return;
 try{
  validate('TaskListCursor',input);const value=JSON.parse(Buffer.from(input,'base64url').toString('utf8')) as HistoryCursor;
  if(canonicalJSON(Object.keys(value).sort())!==canonicalJSON(['created_at','id','kind','task_id','v'])||value.v!==1||!['proposals','batches'].includes(value.kind)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.created_at)||new Date(value.created_at).toISOString().slice(0,23)!==value.created_at.slice(0,23)||encodeHistory(value)!==input)throw new Error('Invalid history cursor');
  validate('Id',value.task_id);validate('Id',value.id);
  if(value.task_id!==taskId||value.kind!==kind)throw new CommandError('denied_scope','Delivery cursor belongs to another Task/history');return value;
 }catch(error){if(error instanceof CommandError)throw error;throw new CommandError('invalid_input','Invalid delivery history cursor');}
}
const summary=(p:ProposalRow,currentDigest?:string):DeliveryProposalSummary=>({proposal_id:p.id,content_digest:p.content_digest,basis:p.basis,expires_at:p.expires_at.toISOString(),current:!p.revoked&&p.expires_at.getTime()>Date.now()&&p.content_digest===currentDigest,...(p.confirmation_id?{confirmation_id:p.confirmation_id}:{})});
const reasons=new Set(['not_review','no_plan','accepted','terminal','unsupported_mode','input_pending','work_unsettled','source_changed','configuration_changed','permission_unknown','expired_permission','scan_incomplete','findings_blocked','known_public_exposure','retained_unavailable','identity_mismatch','possible_publication','reconciliation_required','authority_invalid']);
async function applicability(tx:Transaction,taskId:string):Promise<{currentDigest?:string;reason?:OwnerDeliveryStatus['reason']}> {
 try{return {currentDigest:hash(await buildDeliveryAcceptance(tx,taskId))};}
 catch(error){if(!(error instanceof CommandError))throw error;return {reason:(reasons.has(error.detail.message)?error.detail.message:'work_unsettled') as OwnerDeliveryStatus['reason']};}
}
export class OwnerDeliveryReads {
 readonly db:Database;
 constructor(db:Database){this.db=db;}
 async task(token:string,taskId:string,input:unknown={}):Promise<OwnerDeliveryStatus>{
  validate('Id',taskId);const query=validate<{proposal_cursor?:string;batch_cursor?:string}>('OwnerDeliveryHistoryQuery',input),pa=historyCursor(taskId,'proposals',query.proposal_cursor),ba=historyCursor(taskId,'batches',query.batch_cursor);return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);await lockConfiguration(tx);
   const t=(await tx.query<{control_version:string;specification_id:string;plan_id:string|null;accepted_delivery_operation_id:string|null;accepted_delivery_input_cutoff:string|null}>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];if(!t)throw new CommandError('denied_scope','Unknown Task');
   const current=await applicability(tx,taskId),proposals=(await tx.query<ProposalRow>(proposalSQL+' AND ($2::timestamptz IS NULL OR (d.created_at,p.id)<($2::timestamptz,$3)) ORDER BY d.created_at DESC,p.id DESC LIMIT 65',[taskId,pa?.created_at??null,pa?.id??null])).rows,batches=(await tx.query<DeliveryBatchRecord&{history_at:string}>(`SELECT *,to_char(accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') history_at FROM owner_delivery_batches WHERE task_id=$1 AND ($2::timestamptz IS NULL OR (accepted_at,id)<($2::timestamptz,$3)) ORDER BY accepted_at DESC,id DESC LIMIT 65`,[taskId,ba?.created_at??null,ba?.id??null])).rows;
   const summaries=[];for(const b of batches.slice(0,64))summaries.push((await deliveryBatchRecord(tx,b)).batch);
   const p=proposals[63],b=batches[63];
   return validate('OwnerDeliveryStatus',{schema_version:1,task_id:taskId,basis:{control_version:Number(t.control_version),specification_id:t.specification_id,plan_id:t.plan_id},accept_allowed:!!current.currentDigest,...(current.reason?{reason:current.reason}:{}),proposals:proposals.slice(0,64).map(p=>summary(p,current.currentDigest)),proposals_has_more:proposals.length>64,...(proposals.length>64?{next_proposal_cursor:encodeHistory({v:1,task_id:taskId,kind:'proposals',created_at:p!.history_at,id:p!.id})}:{}),batches:summaries,batches_has_more:batches.length>64,...(batches.length>64?{next_batch_cursor:encodeHistory({v:1,task_id:taskId,kind:'batches',created_at:b!.history_at,id:b!.id})}:{}),...(t.accepted_delivery_operation_id?{accepted_delivery_operation_id:t.accepted_delivery_operation_id,accepted_delivery_input_cutoff:Number(t.accepted_delivery_input_cutoff)}:{})});
  });
 }
 async proposal(token:string,taskId:string,proposalId:string):Promise<DeliveryProposalDetail>{
  validate('Id',taskId);validate('Id',proposalId);return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);await lockConfiguration(tx);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
   const p=(await tx.query<ProposalRow>(proposalSQL+' AND p.id=$2',[taskId,proposalId])).rows[0];if(!p)throw new CommandError('denied_scope','Unknown delivery proposal');
   if(hash(p.content)!==p.content_digest)throw new CommandError('unmet_precondition','authority_invalid');
   const current=await applicability(tx,taskId);return validate('DeliveryProposalDetail',{schema_version:1,task_id:taskId,proposal:summary(p,current.currentDigest),manifest:p.content});
  });
 }
 async batch(token:string,taskId:string,operationId:string):Promise<DeliveryBatch>{
  validate('Id',taskId);validate('Id',operationId);return transaction(this.db,async tx=>{await authenticateOwner(tx,token);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');return deliveryBatchRecord(tx,await deliveryBatch(tx,taskId,operationId));});
 }
}
