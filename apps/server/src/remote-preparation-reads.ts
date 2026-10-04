import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {RemotePreparationRecord,RemotePreparationPage,RemotePreparationQuery,RemotePreparationOperation,RemotePreparationChecks,RemotePreparationCheck,RemotePreparationChecksPage,RemotePreparationChecksQuery,PublicationRefObservationReason} from '../../../packages/protocol/src/index.ts';
import {authenticateOwner} from './owner-commands.ts';
import {effectiveResult} from './publication-candidates.ts';
import type {DeliveryOperation} from './publication-candidates.ts';
import {currentLocalPreparation,ordinaryRemoteAdmission,RemoteAdmissionError} from './remote-preparation-guards.ts';
import {knownPublicExposureCount} from './publication-candidate-reads.ts';
import type {RemoteItem,RemoteOperation} from './remote-preparation-state.ts';
import {remoteReview} from './remote-preparation.ts';

const encode=(binding:unknown,after:unknown)=>Buffer.from(canonicalJSON({version:1,binding,after})).toString('base64url');
function decode(binding:unknown,cursor?:string):unknown {
 if(!cursor)return null;
 try{validate('TaskListCursor',cursor);const raw=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(raw.version!==1||encode(raw.binding,raw.after)!==cursor)throw new Error();if(canonicalJSON(raw.binding)!==canonicalJSON(binding))throw new CommandError('denied_scope','Remote cursor belongs to another selection');return raw.after;}
 catch(error){if(error instanceof CommandError)throw error;throw new CommandError('invalid_input','Invalid remote cursor');}
}
export function remoteOperation(op:RemoteOperation):RemotePreparationOperation {
 return validate('RemotePreparationOperation',{operation_id:op.id,kind:op.kind,request_digest:op.request_digest,version:Number(op.version),state:op.state,may_have_mutated:op.may_have_mutated,worker_absent:op.worker_absent,reconcile_only:op.reconcile_only,...(op.reason?{reason:op.reason}:{}),...(op.next_attempt_at?{next_attempt_at:new Date(op.next_attempt_at).toISOString()}:{})});
}
export async function remoteRecord(tx:Transaction,item:RemoteItem,op?:RemoteOperation,local?:DeliveryOperation,instanceId?:string):Promise<RemotePreparationRecord> {
 const preparation=op?.request.preparation??local?.request,prepared=op?.request.prepared??local?.result;if(!preparation||!prepared?.candidate||!prepared.scan)throw new CommandError('denied_scope','Remote item has no local candidate');
 const latest=await currentLocalPreparation(tx,item),last=(await tx.query<{id:string}>('SELECT id FROM remote_preparation_operations WHERE item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[item.item_id])).rows[0];
 const effective=await effectiveResult(tx,preparation),current=effective.current&&latest?.id===preparation.operation_id&&(!op||last?.id===op.id);
 const mode=(await tx.query<{mode:'automatic'|'after_acceptance'}>("SELECT COALESCE(settings->>'remote_preparation','automatic') mode FROM project_resources WHERE id=$1",[item.resource_id])).rows[0]!.mode;
 const runner=(await tx.query<{online:boolean;remote_preparation_supported:boolean}>("SELECT connected AND ready AND last_seen>clock_timestamp()-interval '15 seconds' AND ($2::text IS NULL OR connection_instance=$2) online,remote_preparation_supported FROM runners WHERE id=$1",[item.runner_id,instanceId??null])).rows[0];
 const exposure=await knownPublicExposureCount(tx,item.task_id,item.resource_id,item.repository_identity);
 let admitted=false,why:PublicationRefObservationReason|undefined;
 try{await ordinaryRemoteAdmission(tx,item,preparation,prepared,op?.id);admitted=current&&!item.cancel_requested;}catch(error){if(!(error instanceof RemoteAdmissionError))throw error;why=error.reason;}
 const unresolved=op?.kind==='push'&&op.state==='settled'&&op.result?.status==='reconciliation_required'&&!(await tx.query("SELECT 1 FROM remote_preparation_observations WHERE operation_id=$1 AND kind='published'",[op.id])).rowCount;
 const retry=!!op&&current&&admitted&&op.state==='settled'&&op.result?.status==='blocked'&&op.result.push_started===false&&op.worker_absent;
 const checkHistory=(await tx.query<{observation:{observation?:RemotePreparationChecks;attention?:PublicationRefObservationReason}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind='checks' ORDER BY created_at DESC,id DESC LIMIT 1",[item.item_id])).rows[0]?.observation;
 const readRetry=!!op&&last?.id===op.id&&(unresolved||op.may_have_mutated&&['unknown','started'].includes(op.state)||current&&admitted&&['failed','pending'].includes(op.state)||!!checkHistory?.attention);
 let status:RemotePreparationRecord['status']=item.cancel_requested?(item.cleanup_state==='closed'||item.cleanup_state==='not_needed'?'cancelled':'cancel_cleanup'):mode==='after_acceptance'?'local_only':why==='input_pending'||why==='source_changed'?'paused_input':!runner?.online?'offline':!runner.remote_preparation_supported?'unsupported':unresolved?'reconciliation_required':op?.may_have_mutated&&op.state!=='settled'?'reconciling':op?.reason==='access_denied'||why==='credentials_missing'?'access_denied':op?.state==='failed'||op?.result?.status==='blocked'?'failed':item.pr_id?'prepared':'preparing';
 if(exposure&&!item.cancel_requested&&mode==='automatic'){status='failed';why='known_public_exposure';}
 if(checkHistory?.attention&&!item.cancel_requested&&!exposure){status=checkHistory.attention==='access_denied'?'access_denied':'failed';why=checkHistory.attention;}
 const latestReview=(await tx.query<{observation:{review?:RemotePreparationRecord['review']}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind IN('review','cleanup') ORDER BY created_at DESC,id DESC LIMIT 1",[item.item_id])).rows[0]?.observation.review??remoteReview(item);
 const stored=(await tx.query<{observation:{observation:RemotePreparationChecks}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind='checks' AND observation ? 'observation' ORDER BY created_at DESC,id DESC LIMIT 1",[item.item_id])).rows[0]?.observation.observation;
 const checks=stored?{...stored,current:stored.current&&current&&stored.head===prepared.candidate.head&&!item.cancel_requested&&!checkHistory?.attention,stale:stored.stale||stored.head!==prepared.candidate.head||!!checkHistory?.attention}:undefined;
 const cooldown=(await tx.query<{next_request_at:Date}>('SELECT c.next_request_at FROM github_remote_cooldowns c JOIN github_configuration g ON g.installation_id=c.installation_id WHERE c.next_request_at>clock_timestamp()')).rows[0];
 return validate('RemotePreparationRecord',{schema_version:1,item_id:item.item_id,task_id:item.task_id,resource_id:item.resource_id,runner_id:item.runner_id,repository_identity:item.repository_identity,repository_id:item.repository_id,delivery_ref:item.delivery_ref,target_branch:item.target_branch,remote_preparation:mode,source:preparation.source,source_digest:preparation.source_digest,effective_basis:preparation.effective_basis,effective_basis_digest:preparation.effective_basis_digest,candidate:prepared.candidate,candidate_manifest_digest:prepared.candidate_manifest_digest,scan_digest:prepared.scan_digest,...(prepared.mapping?{mapping:prepared.mapping,mapping_digest:prepared.mapping_digest}:{}),...(op?{operation:remoteOperation(op)}:{}),...(item.last_published_proof?{published:item.last_published_proof,published_digest:item.last_published_digest}:{}),...(latestReview?{review:latestReview}:{}),...(checks?{checks}:{}),status,...(why??op?.reason?{reason:why??op?.reason}:{}),current,scan_applicable:admitted,retry_allowed:retry,read_retry_allowed:readRetry,cleanup_allowed:item.cancel_requested&&last?.id===op?.id&&!['closed','not_needed','externally_merged'].includes(item.cleanup_state),known_public_exposure_count:exposure,...(cooldown?{cooldown_until:cooldown.next_request_at.toISOString()}:{})});
}
export class RemotePreparationReads {
 readonly db:Database;readonly instanceId?:string;
 constructor(db:Database,instanceId?:string){this.db=db;this.instanceId=instanceId;}
 async list(token:string,taskId:string,input:unknown):Promise<RemotePreparationPage> {
  validate('Id',taskId);const query=validate<RemotePreparationQuery>('RemotePreparationQuery',input),binding={kind:'remote_history',task_id:taskId,source_operation_id:query.source_operation_id??null},after=decode(binding,query.cursor);
  if(after!==null&&(typeof after!=='object'||!after||!('id' in after)||!('kind' in after)||!['operation','local'].includes(String(after.kind))))throw new CommandError('invalid_input','Invalid remote history position');
  const position=after as {kind:'operation'|'local';id:string}|null;if(position)validate('Id',position.id);
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
   if(query.source_operation_id&&!(await tx.query('SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE o.id=$1 AND a.task_id=$2 AND o.kind=\'complete_node\' AND o.state=\'succeeded\'',[query.source_operation_id,taskId])).rowCount)throw new CommandError('denied_scope','Unknown source completion');
   const rows=(await tx.query<{kind:'operation'|'local';id:string;item_id:string}>(`WITH history AS (
    SELECT 'operation' kind,o.id,o.item_id,o.created_at FROM remote_preparation_operations o WHERE o.task_id=$1 AND ($2::text IS NULL OR o.request->'preparation'->'source'->>'operation_id'=$2)
    UNION ALL SELECT 'local',d.id,i.item_id,d.created_at FROM remote_preparation_items i JOIN LATERAL(SELECT * FROM delivery_operations WHERE task_id=i.task_id AND resource_id=i.resource_id AND result->>'status' IN('prepared','mapped') ORDER BY created_at DESC,id DESC LIMIT 1)d ON true WHERE i.task_id=$1 AND NOT EXISTS(SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=i.item_id) AND ($2::text IS NULL OR d.source_operation_id=$2)) SELECT * FROM history WHERE ($3::text IS NULL OR (created_at,id)<(SELECT created_at,id FROM history WHERE kind=$4 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT 33`,[taskId,query.source_operation_id??null,position?.id??null,position?.kind??null])).rows;
   if(position&&!(await tx.query(position.kind==='operation'?"SELECT 1 FROM remote_preparation_operations WHERE id=$1 AND task_id=$2 AND ($3::text IS NULL OR request->'preparation'->'source'->>'operation_id'=$3)":"SELECT 1 FROM delivery_operations WHERE id=$1 AND task_id=$2 AND ($3::text IS NULL OR source_operation_id=$3)",[position.id,taskId,query.source_operation_id??null])).rowCount)throw new CommandError('denied_scope','Remote cursor position differs');
   const items:RemotePreparationRecord[]=[];let size=4096;
   for(const row of rows){if(items.length===32)break;const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[row.item_id])).rows[0]!;const op=row.kind==='operation'?(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1',[row.id])).rows[0]:undefined,local=row.kind==='local'?(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1',[row.id])).rows[0]:undefined;const record=await remoteRecord(tx,item,op,local,this.instanceId),bytes=Buffer.byteLength(JSON.stringify(record))+1;if(size+bytes>512*1024)break;items.push(record);size+=bytes;}
   if(rows.length&&!items.length)throw new CommandError('unmet_precondition','Remote record exceeds read budget');
   const last=rows[items.length-1];return validate('RemotePreparationPage',{schema_version:1,task_id:taskId,items,...(rows.length>items.length?{next_cursor:encode(binding,{kind:last!.kind,id:last!.id})}:{})});
  });
 }
 async item(token:string,taskId:string,itemId:string):Promise<RemotePreparationRecord> {
  validate('Id',taskId);validate('Id',itemId);return transaction(this.db,async tx=>{await authenticateOwner(tx,token);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 AND task_id=$2',[itemId,taskId])).rows[0];if(!item)throw new CommandError('denied_scope','Unknown remote item');const op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[itemId])).rows[0];return remoteRecord(tx,item,op,await currentLocalPreparation(tx,item),this.instanceId);});
 }
 async checks(token:string,taskId:string,itemId:string,observationId:string,input:unknown):Promise<RemotePreparationChecksPage> {
  [taskId,itemId,observationId].forEach(id=>validate('Id',id));const query=validate<RemotePreparationChecksQuery>('RemotePreparationChecksQuery',input),binding={kind:'remote_checks',task_id:taskId,item_id:itemId,observation_id:observationId},after=decode(binding,query.cursor)??0;if(typeof after!=='number'||!Number.isSafeInteger(after)||after<0)throw new CommandError('invalid_input','Invalid checks position');
  return transaction(this.db,async tx=>{await authenticateOwner(tx,token);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId]);const row=(await tx.query<{observation:{observation:RemotePreparationChecks;items:RemotePreparationCheck[]}}>("SELECT observation FROM remote_preparation_observations WHERE id=$1 AND item_id=$2 AND task_id=$3 AND kind='checks' AND observation ? 'observation'",[observationId,itemId,taskId])).rows[0];if(!row)throw new CommandError('denied_scope','Unknown checks observation');if(after>row.observation.items.length)throw new CommandError('invalid_input','Invalid checks position');
   const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[itemId])).rows[0]!,local=await currentLocalPreparation(tx,item),active=local?await effectiveResult(tx,local.request):undefined;
   const later=(await tx.query("SELECT 1 FROM remote_preparation_observations WHERE item_id=$1 AND kind='checks' AND observation ? 'attention' AND created_at>(SELECT created_at FROM remote_preparation_observations WHERE id=$2) LIMIT 1",[itemId,observationId])).rowCount;
   const raw=row.observation.observation,observation={...raw,current:raw.current&&!!active?.current&&!item.cancel_requested&&local?.result?.candidate?.head===raw.head&&!later,stale:raw.stale||!!later};const items:RemotePreparationCheck[]=[];let bytes=4096;for(const check of row.observation.items.slice(after,after+64)){const n=Buffer.byteLength(JSON.stringify(check));if(bytes+n>512*1024)break;items.push(check);bytes+=n;}
   return validate('RemotePreparationChecksPage',{schema_version:1,task_id:taskId,item_id:itemId,observation,items,...(after+items.length<row.observation.items.length?{next_cursor:encode(binding,after+items.length)}:{})});});
 }
}
