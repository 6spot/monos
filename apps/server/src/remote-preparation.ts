import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {Frame,PublicationPushRequest,PublicationPushResult,PublicationPushACK,RemotePreparationProviderRequest,RemotePreparationReview,PublicationRefObservationReason,PublicationPrepareRequest} from '../../../packages/protocol/src/index.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {RemoteProviderError,ProviderTurnComplete} from './github-remote.ts';
import type {GitHubRemote,RemoteReviewSnapshot,GitHubRemoteScope} from './github-remote.ts';
import {ordinaryRemoteAdmission,currentLocalPreparation,RemoteAdmissionError} from './remote-preparation-guards.ts';
import {remoteAdmissionForOperation} from './owner-delivery-guards.ts';
import {admitAcceptedPreparationForItem} from './owner-delivery-preparation.ts';
import {remoteScope,appendRemoteObservation,publishProof,verifyPushObservation,reserveRemoteProvider,releaseRemoteProvider,RemoteProviderWaiting} from './remote-preparation-state.ts';
import type {RemoteItem,RemoteOperation} from './remote-preparation-state.ts';
import {observePublicationPermission} from './remote-preparation-access.ts';
import {publicationDigest as hash,credentialPath,publicationConfiguration} from './publication-policy.ts';
import {effectiveResult,insertOperation,localAdmissionAllowed} from './publication-candidates.ts';
import type {DeliveryOperation} from './publication-candidates.ts';
import {pollRemoteChecks} from './remote-preparation-poll.ts';

export async function insertRemoteOperation(tx:Transaction,item:RemoteItem,request:PublicationPushRequest|RemotePreparationProviderRequest):Promise<RemoteOperation> {
 const kind='kind' in request?request.kind:'push';validate(kind==='push'?'PublicationPushRequest':'RemotePreparationProviderRequest',request);
 await tx.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp(),poll_progress=NULL WHERE item_id=$1',[item.item_id]);
 return (await tx.query<RemoteOperation>('INSERT INTO remote_preparation_operations(id,item_id,task_id,resource_id,runner_id,kind,request,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[request.operation_id,item.item_id,item.task_id,item.resource_id,item.runner_id,kind,request,hash(request)])).rows[0]!;
}
const reason=(error:unknown):PublicationRefObservationReason=>error instanceof RemoteAdmissionError||error instanceof RemoteProviderError?error.reason:'provider_unavailable';
export function remoteReview(item:RemoteItem):RemotePreparationReview|undefined {
 if(!item.pr_id||!item.pr_number)return;
 return {repository_id:item.repository_id,pr_id:item.pr_id,pr_number:Number(item.pr_number),url:`https://github.com/${item.repository_identity.slice(11)}/pull/${item.pr_number}`,head_ref:item.delivery_ref.slice(11),base_ref:item.target_branch,marker:item.marker,state:'open'};
}
export async function remoteContent(tx:Transaction,item:RemoteItem,local:DeliveryOperation) {
 const task=(await tx.query<{title:string}>('SELECT title FROM tasks WHERE id=$1',[item.task_id])).rows[0]!;
 const summary=(await tx.query<{summary:string}>('SELECT summary FROM completion_manifests WHERE operation_id=$1',[local.source_operation_id])).rows[0]?.summary??'';
 const safe=(text:string)=>credentialPath(text)?'[redacted credential metadata]':text;
 return {title:[...safe(task.title||`Task ${item.task_id}`)].slice(0,256).join(''),body:`${safe([...summary].slice(0,8000).join(''))}\n\nTask: ${item.task_id}\nDelivery ref: ${item.delivery_ref}\n\n${item.marker}`};
}
async function localRequest(tx:Transaction,item:RemoteItem,kind:RemotePreparationProviderRequest['kind']):Promise<RemotePreparationProviderRequest> {
 const local=await currentLocalPreparation(tx,item);if(!local?.result?.candidate||!['prepared','mapped'].includes(local.result.status))throw new RemoteAdmissionError('retained_unavailable');
 const receipts=kind==='close_pr'?[]:await ordinaryRemoteAdmission(tx,item,local.request,local.result);
 return validate('RemotePreparationProviderRequest',{schema_version:1,operation_id:randomUUID(),item_id:item.item_id,task_id:item.task_id,resource_id:item.resource_id,runner_id:item.runner_id,storage_id:item.storage_id,repository_identity:item.repository_identity,repository_id:item.repository_id,remote_url:item.remote_url,delivery_ref:item.delivery_ref,target_branch:item.target_branch,preparation:local.request,prepared:local.result,preparation_result_digest:local.result_digest,override_receipts:receipts,kind,...(remoteReview(item)?{review:remoteReview(item)}:{}),...(kind!=='close_pr'?{content:await remoteContent(tx,item,local)}:{})});
}
export class RemotePreparation {
 readonly db:Database;readonly instanceId:string;readonly provider:GitHubRemote;
 constructor(db:Database,instanceId:string,provider:GitHubRemote){this.db=db;this.instanceId=instanceId;this.provider=provider;}
 async pump():Promise<void> {
  // Discover canonical settled local candidates. This persists identity only;
  // all new effect admissions below recheck Task and configuration under lock.
  const locals=(await this.db.pool.query<DeliveryOperation>(`SELECT DISTINCT ON(task_id,resource_id) * FROM delivery_operations WHERE state='terminal' AND result->>'status' IN('prepared','mapped') ORDER BY task_id,resource_id,created_at DESC,id DESC`)).rows;
  for(const local of locals) {
   try {
    const item=await transaction(this.db,async tx=>{
     await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[local.task_id]);
     const resource=(await tx.query<{repository_identity:string;remote_url:string;settings:{provider_repo_id?:string}}>('SELECT * FROM project_resources WHERE id=$1',[local.resource_id])).rows[0];
     if(!local.item_id||!resource?.settings.provider_repo_id||!/^github\.com\//.test(resource.repository_identity))return;
     const repository_id=resource.settings.provider_repo_id;
     this.provider.prefix({resource_id:local.resource_id,repository_identity:resource.repository_identity,repository_id,remote_url:resource.remote_url,workflow_changes:false});
     await tx.query('INSERT INTO remote_preparation_items(item_id,task_id,resource_id,runner_id,storage_id,repository_identity,repository_id,remote_url,delivery_ref,target_branch,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(item_id) DO NOTHING',[local.item_id,local.task_id,local.resource_id,local.runner_id,local.request.source.storage_id,resource.repository_identity,repository_id,resource.remote_url,`refs/heads/monos/task/${local.task_id}/${local.resource_id}`,local.request.construction.target_branch,`<!-- monos-delivery-item:${local.item_id} -->`]);
     const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[local.item_id])).rows[0]!;
     if(item.repository_id!==repository_id||item.repository_identity!==resource.repository_identity)throw new RemoteAdmissionError('configuration_changed');return item;
    });
    if(!item||item.cancel_requested)continue;
    if(item.poll_progress?.kind==='permission_attention'&&item.poll_progress.operation_id===local.id&&item.next_poll_at.getTime()>Date.now())continue;
    await observePublicationPermission(this.db,this.provider,local.id);
    await transaction(this.db,tx=>this.admit(tx,item.item_id));
   }catch(error){if(!(error instanceof CommandError||error instanceof RemoteProviderError||error instanceof RemoteProviderWaiting))throw error;
    if(error instanceof RemoteProviderError||error instanceof RemoteAdmissionError&&['credentials_missing','access_denied','permission_unknown','expired_permission'].includes(error.reason))await transaction(this.db,async tx=>{
     await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[local.task_id]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[local.item_id])).rows[0];if(!item)return;
     await appendRemoteObservation(tx,item,null,'checks',{attention:reason(error),stage:'permission',failed_at:new Date().toISOString()});await tx.query("UPDATE remote_preparation_items SET poll_progress=$2,next_poll_at=clock_timestamp()+interval '15 seconds' WHERE item_id=$1",[item.item_id,{kind:'permission_attention',operation_id:local.id}]);
    });
   }
  }
  const due=(await this.db.pool.query<{item_id:string}>('SELECT item_id FROM remote_preparation_items WHERE next_poll_at<=clock_timestamp() ORDER BY next_poll_at,item_id LIMIT 8')).rows;
  for(const item of due)await this.turn(item.item_id);
 }
 async admit(tx:Transaction,itemId:string):Promise<void> {
  await lockConfiguration(tx);const located=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[itemId])).rows[0];if(!located)return;
  await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[located.task_id]);
  const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[itemId])).rows[0]!;
  const local=await currentLocalPreparation(tx,item);
  if(item.cancel_requested&&(await tx.query("SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR status IN ('started','unknown')) LIMIT 1",[itemId])).rowCount)return;
  if(!item.cancel_requested&&(await tx.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL',[item.task_id])).rowCount){await admitAcceptedPreparationForItem(tx,item);return;}
  const active=(await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND active AND state NOT IN('settled','revoked') FOR UPDATE",[itemId])).rows[0];
  if(active){if(!active.may_have_mutated&&!active.effect_owned&&(local?.id!==active.request.preparation.operation_id||!(await effectiveResult(tx,active.request.preparation)).current||hash(await publicationConfiguration(tx,item.resource_id))!==active.request.preparation.configuration_digest))await tx.query("UPDATE remote_preparation_operations SET state='revoked',active=false,reason='source_changed',version=version+1 WHERE id=$1",[active.id]);else return;}
  if(!local?.result?.candidate)return;
  if(item.cancel_requested){if(item.pr_id&&!['closed','externally_merged'].includes(item.cleanup_state))await insertRemoteOperation(tx,item,await localRequest(tx,item,'close_pr'));else if(!item.pr_id)await tx.query("UPDATE remote_preparation_items SET cleanup_state='not_needed',next_poll_at=clock_timestamp()+interval '15 seconds' WHERE item_id=$1",[itemId]);return;}
  if(typeof local.result.scan?.workflow_changes!=='boolean') {
   if(await localAdmissionAllowed(tx,item.task_id)&&local.result.scan?.status==='complete') {
    const request:PublicationPrepareRequest={...local.request,operation_id:randomUUID(),scan_run_id:randomUUID()};
    await insertOperation(tx,request,hash({workflow_scope_upgrade:local.id}));
   }return;
  }
  const receipts=await ordinaryRemoteAdmission(tx,item,local.request,local.result);
  if(item.last_published_proof?.candidate.head!==local.result.candidate.head) {
   if(local.result.status!=='prepared'||!local.request.permission_proof)throw new RemoteAdmissionError('permission_unknown');
   const previous=(await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND kind='push' ORDER BY created_at DESC,id DESC LIMIT 1",[itemId])).rows[0];
   if(previous&&previous.request.preparation.operation_id===local.id)return; // blocked needs an actual Owner Retry
   await insertRemoteOperation(tx,item,validate('PublicationPushRequest',{schema_version:1,operation_id:randomUUID(),item_id:item.item_id,task_id:item.task_id,resource_id:item.resource_id,runner_id:item.runner_id,storage_id:item.storage_id,repository_identity:item.repository_identity,repository_id:item.repository_id,remote_url:item.remote_url,delivery_ref:item.delivery_ref,target_branch:item.target_branch,preparation:local.request,prepared:local.result,preparation_result_digest:local.result_digest,override_receipts:receipts,permission_proof:local.request.permission_proof,permission_proof_digest:hash(local.request.permission_proof),workflow_changes:local.result.scan!.workflow_changes,expected_head:item.last_published_proof?.candidate.head??null,...(item.last_published_proof?{prior_published:item.last_published_proof,prior_published_digest:item.last_published_digest}:{})}));return;
  }
  const content=await remoteContent(tx,item,local);
  const previous=(await tx.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND kind IN('create_pr','update_pr') ORDER BY created_at DESC,id DESC LIMIT 1",[itemId])).rows[0];
  if(previous&&('content' in previous.request)&&hash(previous.request.content)===hash(content)&&previous.request.preparation.operation_id===local.id&&previous.result&&'content_digest' in previous.result&&previous.result.content_digest===hash(content)&&!previous.reason)return;
  await insertRemoteOperation(tx,item,await localRequest(tx,item,item.pr_id?'update_pr':'create_pr'));
 }
 async pending(runnerId:string,incarnation:number,supported:boolean):Promise<Frame[]> {
  if(!supported)return [];
  return transaction(this.db,async tx=>{
   const valid=(await tx.query("SELECT 1 FROM runners WHERE id=$1 AND incarnation=$2 AND connection_instance=$3 AND connected AND ready AND last_seen>clock_timestamp()-interval '15 seconds' FOR UPDATE",[runnerId,incarnation,this.instanceId])).rowCount;if(!valid)return [];
   const rows=(await tx.query<RemoteOperation>(`SELECT o.* FROM remote_preparation_operations o WHERE o.runner_id=$1 AND o.kind='push' AND o.active AND o.state NOT IN('settled','revoked') AND o.next_attempt_at<=clock_timestamp() AND (o.last_sent_at IS NULL OR o.last_sent_at<clock_timestamp()-interval '2 seconds') ORDER BY o.next_attempt_at,o.id LIMIT 8`,[runnerId])).rows;
   const frames:Frame[]=[];
   for(const op of rows){await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[op.task_id]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[op.item_id])).rows[0]!;
    try {if(!op.may_have_mutated){const scope=await remoteScope(tx,item);if(scope.config&&(await tx.query('SELECT 1 FROM github_remote_cooldowns WHERE installation_id=$1 AND next_request_at>clock_timestamp()',[scope.config.installation_id])).rowCount)continue;await remoteAdmissionForOperation(tx,item,op.request.preparation,op.request.prepared,op.id);if(item.cancel_requested)continue;}
     await tx.query('UPDATE remote_preparation_operations SET last_sent_at=clock_timestamp(),sent_incarnation=$2 WHERE id=$1',[op.id,incarnation]);frames.push(validate('Frame',{schema_version:1,type:'publication_push',incarnation,publication_push:op.request}));if(frames.length===2)break;
    }catch(error){if(!(error instanceof CommandError))throw error;}
   }return frames;
  });
 }
 async finish(runnerId:string,incarnation:number,input:unknown):Promise<PublicationPushACK> {
  const result=validate<PublicationPushResult>('PublicationPushResult',input);
  return transaction(this.db,async tx=>{
   await lockConfiguration(tx);if(!(await tx.query('SELECT 1 FROM runners WHERE id=$1 AND incarnation=$2 AND connection_instance=$3 AND connected FOR UPDATE',[runnerId,incarnation,this.instanceId])).rowCount)throw new CommandError('stale_execution','Remote Runner channel changed');
   const located=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 AND runner_id=$2',[result.operation_id,runnerId])).rows[0];if(!located||located.kind!=='push')throw new CommandError('denied_scope','Unknown remote operation');
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[located.task_id]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[located.item_id])).rows[0]!;
   const op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 FOR UPDATE',[located.id])).rows[0]!,request=validate<PublicationPushRequest>('PublicationPushRequest',op.request),digest=hash(result);
   if(op.request_digest!==hash(request)||result.request_digest!==op.request_digest||result.item_id!==item.item_id||result.delivery_ref!==item.delivery_ref||result.candidate_head!==request.prepared.candidate!.head||result.candidate_manifest_digest!==request.prepared.candidate_manifest_digest||result.observation_digest!==hash(result.observation)||!result.worker_absent)throw new CommandError('payload_conflict','Push result scope differs');
   verifyPushObservation(request,result.observation);
   if(result.status==='published'&&(result.observation.status!=='present'||result.observation.head!==result.candidate_head))throw new CommandError('payload_conflict','Published head differs');
   if(op.state==='settled'){if(op.result_digest!==digest)throw new CommandError('payload_conflict','Remote result is immutable');}
   else {if(!op.active||op.state==='revoked'||Number(op.sent_incarnation)!==incarnation||result.push_started&&!op.may_have_mutated)throw new CommandError('stale_execution','Push has no admitted physical claim');
    await tx.query("UPDATE remote_preparation_operations SET state='settled',active=false,effect_owned=false,worker_absent=true,result=$2,result_digest=$3,reason=$4,version=version+1 WHERE id=$1",[op.id,result,digest,result.reason??null]);
    const settled={...op,state:'settled' as const,result,result_digest:digest,effect_owned:false,worker_absent:true};if(result.status==='published')await publishProof(tx,item,settled,result.observation);
    await tx.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp(),poll_progress=NULL WHERE item_id=$1',[item.item_id]);
   }
   return validate('PublicationPushAck',{schema_version:1,operation_id:op.id,item_id:item.item_id,request_digest:op.request_digest,result_digest:digest});
  });
 }
 private async turn(itemId:string):Promise<void> {
  const initial=await transaction(this.db,async tx=>{const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[itemId])).rows[0]!;await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[item.task_id]);await tx.query("UPDATE remote_preparation_items SET next_poll_at=clock_timestamp()+interval '15 seconds' WHERE item_id=$1",[itemId]);return {item,scope:await remoteScope(tx,item)};});
  let reservation:Date|undefined;let failure:unknown;
  try {
   const op=(await this.db.pool.query<RemoteOperation>(`SELECT * FROM remote_preparation_operations o WHERE item_id=$1 AND ((active AND state NOT IN('settled','revoked')) OR kind='push' AND state='settled' AND result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')) ORDER BY created_at,id LIMIT 1`,[itemId])).rows[0];
   if(op?.kind==='push'&&op.state!=='settled'||op&&op.state==='failed'&&!op.may_have_mutated)return;
   if(!op&&(!initial.item.pr_id||initial.item.cancel_requested)){if(initial.item.cancel_requested)await transaction(this.db,tx=>this.admit(tx,itemId));return;}
   reservation=await transaction(this.db,tx=>reserveRemoteProvider(tx,initial.scope));const budget={remaining:8};
   if(op?.kind==='push') {
    if(op.state!=='settled')return;
    const request=validate<PublicationPushRequest>('PublicationPushRequest',op.request),grant=await this.provider.grant(initial.scope,'observe',budget),observation=await this.provider.observeRef(initial.scope,request,grant,budget);
    if(observation.status==='present'&&observation.head===request.prepared.candidate!.head)await transaction(this.db,async tx=>{await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[initial.item.task_id]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[itemId])).rows[0]!;await publishProof(tx,item,op,observation);});
    return;
   }
   if(op&&op.state==='failed'&&!op.may_have_mutated)return; // explicit Owner Retry
   if(op)await this.providerOperation(initial.item,initial.scope,op,budget);
   else if(initial.item.pr_id&&!initial.item.cancel_requested&&!(await this.db.pool.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL',[initial.item.task_id])).rowCount)await pollRemoteChecks(this.db,this.provider,initial.item,initial.scope,budget);
   else if(initial.item.cancel_requested)await transaction(this.db,tx=>this.admit(tx,itemId));
  }catch(error){failure=error;if(error instanceof ProviderTurnComplete)return;
   if(error instanceof RemoteProviderWaiting){await this.db.pool.query('UPDATE remote_preparation_items SET next_poll_at=$2 WHERE item_id=$1',[itemId,error.until]);return;}
   if(!(error instanceof RemoteAdmissionError))await transaction(this.db,async tx=>{await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[initial.item.task_id]);const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[itemId])).rows[0]!;await appendRemoteObservation(tx,item,null,'checks',{attention:reason(error),failed_at:new Date().toISOString()});});
   await this.db.pool.query("UPDATE remote_preparation_items SET cleanup_state=CASE WHEN cancel_requested THEN 'attention' ELSE cleanup_state END,next_poll_at=clock_timestamp()+$2*interval '1 millisecond' WHERE item_id=$1",[itemId,error instanceof RemoteProviderError&&error.cooldown_ms?error.cooldown_ms:Math.floor(15_000+Math.random()*5000)]);
   await this.db.pool.query("UPDATE remote_preparation_operations SET reason=$2,version=version+1 WHERE item_id=$1 AND active AND state NOT IN('settled','revoked') AND reason IS DISTINCT FROM $2",[itemId,reason(error)]);
  }finally{await transaction(this.db,tx=>releaseRemoteProvider(tx,initial.scope,reservation,failure));}
 }
 private async providerOperation(item:RemoteItem,scope:GitHubRemoteScope,op:RemoteOperation,budget:{remaining:number}):Promise<void> {
  const request=validate<RemotePreparationProviderRequest>('RemotePreparationProviderRequest',op.request);
  if(!op.may_have_mutated)await transaction(this.db,async tx=>{await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[item.task_id]);const fresh=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[item.item_id])).rows[0]!;
   if(request.kind==='close_pr'){if(!fresh.cancel_requested||fresh.pr_id!==request.review?.pr_id)throw new RemoteAdmissionError('cancel_requested');if((await tx.query("SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR status IN ('started','unknown')) LIMIT 1",[fresh.item_id])).rowCount)throw new RemoteAdmissionError('possible_publication');}
   else {if(fresh.cancel_requested)throw new RemoteAdmissionError('cancel_requested');await remoteAdmissionForOperation(tx,fresh,request.preparation,request.prepared,op.id);}
  });
  const grant=await this.provider.grant(scope,op.may_have_mutated?'poll':'review',budget);
  let snapshot:RemoteReviewSnapshot|undefined;
  if(request.kind==='create_pr') {
   const progress=item.poll_progress as {operation_id?:string;page?:number;matches?:RemoteReviewSnapshot[]}|null;
   let page=progress?.operation_id===op.id?progress.page??1:1,matches=progress?.operation_id===op.id?progress.matches??[]:[];
   for(;page<=10;page++) {
    if(budget.remaining<2){await this.db.pool.query('UPDATE remote_preparation_items SET poll_progress=$2,next_poll_at=clock_timestamp()+interval \'1 second\' WHERE item_id=$1',[item.item_id,{operation_id:op.id,page,matches}]);return;}
    const reply=await this.provider.findReviewPage(scope,request,grant,page,budget);matches=[...matches,...reply.items];if(matches.length>1)throw new RemoteProviderError('ambiguous_pr');
    if(!reply.more){snapshot=matches[0];break;}if(page===10)throw new RemoteProviderError('ambiguous_pr');
   }
   if(!snapshot&&op.may_have_mutated){await this.attention(op,'possible_publication');return;}
  } else snapshot=await this.provider.review(scope,request,grant,budget);
  if(snapshot) {
   if(snapshot.review.state==='merged'){await this.settleProvider(item,op,snapshot,'pr_merged');return;}
   if(request.kind==='close_pr'&&snapshot.review.state==='closed'){await this.settleProvider(item,op,snapshot);return;}
   if(snapshot.review.state==='closed'){await this.settleProvider(item,op,snapshot,'pr_closed');return;}
   if(request.kind!=='close_pr'&&snapshot.head!==request.prepared.candidate!.head){await this.attention(op,'unexpected_head');return;}
   if(request.kind!=='close_pr'&&snapshot.content_digest===hash(request.content)){await this.settleProvider(item,op,snapshot);return;}
   if(request.kind==='create_pr'&&!op.may_have_mutated){await this.settleProvider(item,op,snapshot,'content_mismatch');return;}
   if(op.may_have_mutated){await this.attention(op,'content_mismatch');return;}
  }
  if(op.may_have_mutated){await this.attention(op,'possible_publication');return;}
  // A read-only preflight cannot permit a push/create against a moved branch.
  if(request.kind!=='close_pr') {
   const observed=await this.provider.request(scope,this.provider.prefix(scope)+'/git/ref/'+item.delivery_ref.slice(5).split('/').map(encodeURIComponent).join('/'),grant,budget);
   const raw=observed.data as {ref?:unknown;object?:{type?:unknown;sha?:unknown}};
   if(raw?.ref!==item.delivery_ref||raw.object?.type!=='commit'||raw.object.sha!==request.prepared.candidate!.head)throw new RemoteProviderError('unexpected_head');
  }
  if(budget.remaining<1)throw new ProviderTurnComplete();
  await transaction(this.db,async tx=>{await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[item.task_id]);const fresh=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[item.item_id])).rows[0]!;
   const current=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 FOR UPDATE',[op.id])).rows[0]!;
   if(current.state!=='pending'||current.may_have_mutated)throw new RemoteAdmissionError('possible_publication');
   if(request.kind==='close_pr'){if(!fresh.cancel_requested||fresh.pr_id!==request.review!.pr_id)throw new RemoteAdmissionError('cancel_requested');if((await tx.query("SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR status IN ('started','unknown')) LIMIT 1",[fresh.item_id])).rowCount)throw new RemoteAdmissionError('possible_publication');}
   else {if(fresh.cancel_requested)throw new RemoteAdmissionError('cancel_requested');await remoteAdmissionForOperation(tx,fresh,request.preparation,request.prepared,op.id);}
   const after=await remoteScope(tx,fresh);if(after.config?.key_fingerprint!==scope.config?.key_fingerprint||after.config?.installation_id!==scope.config?.installation_id||after.config?.app_id!==scope.config?.app_id||after.repository_id!==scope.repository_id||after.repository_identity!==scope.repository_identity||after.remote_url!==scope.remote_url)throw new RemoteAdmissionError('configuration_changed');
   await tx.query("UPDATE remote_preparation_operations SET state='started',effect_owned=true,may_have_mutated=true,worker_absent=false,version=version+1 WHERE id=$1",[op.id]);
  });
  try {const result=await this.provider.mutate(scope,request,grant,budget);if(request.kind!=='close_pr'&&(result.head!==request.prepared.candidate!.head||result.content_digest!==hash(request.content)))throw new RemoteProviderError('unexpected_head');await this.settleProvider(item,op,result);}
  catch(error){await this.attention(op,reason(error));throw error;}
 }
 private async attention(op:RemoteOperation,why:PublicationRefObservationReason):Promise<void> {
  await this.db.pool.query("UPDATE remote_preparation_operations SET state=CASE WHEN may_have_mutated THEN 'unknown' ELSE 'failed' END,reconcile_only=may_have_mutated,reason=$2,next_attempt_at=clock_timestamp()+interval '15 seconds',version=version+1 WHERE id=$1 AND state NOT IN('settled','revoked')",[op.id,why]);
 }
 private async settleProvider(item:RemoteItem,op:RemoteOperation,snapshot:RemoteReviewSnapshot,why?:PublicationRefObservationReason):Promise<void> {
  await transaction(this.db,async tx=>{await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[item.task_id]);const fresh=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[item.item_id])).rows[0]!;
   if(fresh.pr_id&&fresh.pr_id!==snapshot.review.pr_id)throw new RemoteProviderError('ambiguous_pr');
   const result={review:snapshot.review,head:snapshot.head,base_head:snapshot.base_head,content_digest:snapshot.content_digest,mergeability:snapshot.mergeability,...(why?{reason:why}:{})};
   await appendRemoteObservation(tx,fresh,op.id,op.kind==='close_pr'?'cleanup':'review',result);
   await tx.query("UPDATE remote_preparation_operations SET state='settled',active=false,effect_owned=false,worker_absent=true,result=$2,result_digest=$3,reason=$4,version=version+1 WHERE id=$1 AND state NOT IN('settled','revoked')",[op.id,result,hash(result),why??null]);
   await tx.query("UPDATE remote_preparation_items SET pr_id=COALESCE(pr_id,$2),pr_number=COALESCE(pr_number,$3),poll_progress=NULL,cleanup_state=CASE WHEN cancel_requested THEN $4 ELSE cleanup_state END,next_poll_at=clock_timestamp()+interval '15 seconds' WHERE item_id=$1",[item.item_id,snapshot.review.pr_id,snapshot.review.pr_number,snapshot.review.state==='merged'?'externally_merged':snapshot.review.state==='closed'?'closed':'pending']);
  });
 }
}
