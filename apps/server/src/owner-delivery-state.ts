import {repositoryAdapter} from '../../../packages/domain/src/repositories.ts';
import type {Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {DeliveryAcceptanceBasis,DeliveryAcceptanceManifest,DeliveryRepository,DeliveryBatch,DeliveryBatchSummary,DeliveryItemProgress,PublicationFinding,RemotePreparationReview} from '../../../packages/protocol/src/index.ts';
import {localAdmissionAllowed,effectiveResult} from './publication-candidates.ts';
import type {DeliveryOperation} from './publication-candidates.ts';
import {publicationConfiguration,publicationPermissionCurrent,permissionConfigurationFingerprint,publicationDigest as hash} from './publication-policy.ts';
import {taskInputGuards} from './task-guidance.ts';
import {knownPublicExposureCount} from './publication-candidate-reads.ts';
import {actualOverrideProofs,retainedPublishedProof} from './remote-preparation-state.ts';
import type {RemoteItem} from './remote-preparation-state.ts';
import {remoteContent} from './remote-preparation.ts';
import {planningEvent} from './task-planning-state.ts';
import {readAcceptedReadiness} from './owner-delivery-worker.ts';
import {canonicalReviewManifest} from './task-review-basis.ts';
import {reviewRevocationSettled} from './task-review-state.ts';

export interface DeliveryBatchRecord {
 id:string;task_id:string;manifest:DeliveryAcceptanceManifest;content_digest:string;proposal_id:string;confirmation_id:string;admission_request_id:string;
 input_cutoff:string;accepted_at:Date;status:DeliveryBatchSummary['status'];version:string;attention_reason:string|null;due_at:Date;checkpoint:Record<string,unknown>|null;
}
export interface DeliveryBatchItemRecord {batch_id:string;ordinal:number;task_id:string;item_id:string|null;resource_id:string;repository:DeliveryRepository;repository_digest:string}
export async function deliveryBatch(tx:Transaction,taskId:string,id:string,lock=false):Promise<DeliveryBatchRecord> {
 const row=(await tx.query<DeliveryBatchRecord>('SELECT * FROM owner_delivery_batches WHERE task_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[taskId,id])).rows[0];
 if(!row)throw new CommandError('denied_scope','Unknown delivery batch');return row;
}
export async function assertDeliveryBatchAuthority(tx:Transaction,b:DeliveryBatchRecord):Promise<void> {
 validate('DeliveryAcceptanceManifest',b.manifest);
 if(hash(b.manifest)!==b.content_digest||b.manifest.task_id!==b.task_id)throw new CommandError('unmet_precondition','authority_invalid');
 const authority=(await tx.query<{ok:boolean}>(`SELECT (
 p.task_id=b.task_id AND p.action='accept_delivery' AND p.content=b.manifest AND p.content_digest=b.content_digest
 AND a.proposal_id=p.id AND a.consumed_by=b.admission_request_id
 AND cc.envelope->>'name'='confirm_delivery_acceptance' AND cc.envelope->'payload'=jsonb_build_object('proposal_id',p.id,'content_digest',p.content_digest)
 AND cc.response->>'status'='committed' AND cc.response->>'confirmation_id'=a.id AND cc.response->>'content_digest'=b.content_digest
 AND ac.envelope->>'name'='accept_delivery' AND ac.envelope->'payload'=jsonb_build_object('proposal_id',p.id,'confirmation_id',a.id,'content_digest',p.content_digest,'basis',p.basis)
 AND ac.response->>'status'='committed' AND ac.response->>'operation_id'=b.id AND ac.response->>'content_digest'=b.content_digest AND ac.response->'input_cutoff'=to_jsonb(b.input_cutoff)
 ) IS TRUE ok FROM owner_delivery_batches b JOIN task_command_proposals p ON p.id=b.proposal_id JOIN authorization_receipts a ON a.id=b.confirmation_id
 JOIN owner_delivery_authorization_commands ca ON ca.authorization_id=a.id AND ca.task_id=b.task_id
 JOIN owner_delivery_command_receipts cc ON cc.task_id=ca.task_id AND cc.request_id=ca.request_id
 JOIN owner_delivery_command_receipts ac ON ac.task_id=b.task_id AND ac.request_id=b.admission_request_id WHERE b.id=$1 AND b.task_id=$2 AND b.content_digest=$3 AND b.manifest=$4 AND b.input_cutoff=$5`,[b.id,b.task_id,b.content_digest,b.manifest,b.input_cutoff])).rows[0];
 const items=(await tx.query<DeliveryBatchItemRecord>('SELECT * FROM owner_delivery_batch_items WHERE batch_id=$1 ORDER BY ordinal',[b.id])).rows;
 if(!authority?.ok||canonicalJSON(items.map(i=>i.repository))!==canonicalJSON(b.manifest.repositories)||items.some(i=>i.repository_digest!==hash(i.repository)))throw new CommandError('unmet_precondition','authority_invalid');
}
export async function acceptedDeliveryItem(tx:Transaction,batchId:string,itemId:string):Promise<DeliveryBatchItemRecord> {
 const row=(await tx.query<DeliveryBatchItemRecord>('SELECT * FROM owner_delivery_batch_items WHERE batch_id=$1 AND item_id=$2',[batchId,itemId])).rows[0];
 if(!row)throw new CommandError('denied_scope','Item is outside accepted delivery batch');return row;
}

export async function buildDeliveryAcceptance(tx:Transaction,taskId:string,reviewedBasis?:DeliveryAcceptanceBasis):Promise<DeliveryAcceptanceManifest> {
 const task=(await tx.query<{id:string;state:string;control_version:string;specification_id:string;plan_id:string|null;accepted_delivery_operation_id:string|null}>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];
 if(!task)throw new CommandError('denied_scope','Unknown Task');
 if(task.state!=='REVIEW'||task.accepted_delivery_operation_id||!task.plan_id)throw new CommandError('unmet_precondition',task.accepted_delivery_operation_id?'accepted':task.plan_id?'not_review':'no_plan');
 const basis:DeliveryAcceptanceBasis={control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id};
 if(reviewedBasis&&canonicalJSON(basis)!==canonicalJSON(reviewedBasis))throw new CommandError('version_conflict','source_changed');
 if((await taskInputGuards(tx,taskId)).length)throw new CommandError('unmet_precondition','input_pending');
 if(!await localAdmissionAllowed(tx,taskId))throw new CommandError('unmet_precondition','work_unsettled');
 const reviewed=await canonicalReviewManifest(tx,taskId),outputs=reviewed.outputs;
 const revision={specification_digest:reviewed.specification_digest,plan_digest:reviewed.plan_digest};
 const resources=[...new Set(outputs.flatMap(o=>o.sources.map(s=>s.source.resource_id)))].sort(),repositories:DeliveryRepository[]=[];
 if(resources.length>64)throw new CommandError('unmet_precondition','unsupported_mode');
 for(const resourceId of resources){
  const resource=(await tx.query<{repository_identity:string;settings:{provider?:string;provider_repo_id?:string;remote_preparation?:'automatic'|'after_acceptance';merge_method?:'merge'|'squash'|'rebase'};remote_url:string}>('SELECT * FROM project_resources WHERE id=$1',[resourceId])).rows[0];
  const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[taskId,resourceId])).rows[0];
  if(!resource||!op||op.state!=='terminal'||!op.result||op.request_digest!==hash(op.request)||op.result_digest!==hash(op.result)||!outputs.some(o=>o.sources.some(s=>s.source_digest===op.request.source_digest))||!(await effectiveResult(tx,op.request)).current)throw new CommandError('unmet_precondition','retained_unavailable');
  const common={resource_id:resourceId,repository_identity:resource.repository_identity,provider_metadata:resource.settings.provider_repo_id?{github:{repository_id:resource.settings.provider_repo_id}}:{},source:op.request.source,source_digest:op.request.source_digest,effective_basis:op.request.effective_basis,effective_basis_digest:op.request.effective_basis_digest,preparation_request:op.request,preparation_request_digest:op.request_digest,preparation_result:op.result,preparation_result_digest:op.result_digest!};
  if(await knownPublicExposureCount(tx,taskId,resourceId,resource.repository_identity))throw new CommandError('unmet_precondition','known_public_exposure');
  if(op.result.status==='not_applicable'&&op.result.reason==='no_change'){repositories.push(validate('DeliveryRepository',{...common,outcome:'no_change'}));continue;}
  if(!['prepared','mapped'].includes(op.result.status)||!op.result.candidate||!op.item_id)throw new CommandError('unmet_precondition','retained_unavailable');
  const delivery_kind=repositoryAdapter(resource.remote_url)==='github'?'github_pr':'git_branch';
  if(delivery_kind==='github_pr'&&!resource.settings.provider_repo_id)throw new CommandError('unmet_precondition','unsupported_mode');
  const r=op.result,request=op.request;
  if(hash(await publicationConfiguration(tx,resourceId))!==request.configuration_digest)throw new CommandError('unmet_precondition','configuration_changed');
  if(r.scan?.status!=='complete'||typeof r.scan.workflow_changes!=='boolean')throw new CommandError('unmet_precondition','scan_incomplete');
  const proof=request.permission_proof;
  if(!proof||hash(proof)!==request.permission_proof_digest||proof.permission_fingerprint!==request.configuration.permission_fingerprint||!await publicationPermissionCurrent(tx,resourceId,proof,r.scan.workflow_changes))throw new CommandError('unmet_precondition','permission_unknown');
  // Expiry is a renewable credential observation, not a change to approved scope.
  const waivers=(await actualOverrideProofs(tx,taskId,r.scan.scan_id)).filter(w=>w.selection.candidate_id===r.candidate!.candidate_id&&w.selection.candidate_manifest_digest===r.candidate_manifest_digest&&w.selection.effective_basis_digest===request.effective_basis_digest&&w.selection.scan_digest===r.scan_digest&&w.selection.mapping_digest===r.mapping_digest);
  const findings=(await tx.query<{finding:PublicationFinding}>('SELECT finding FROM publication_findings WHERE scan_id=$1',[r.scan.scan_id])).rows.map(x=>x.finding),covered=new Set(waivers.flatMap(w=>w.selection.finding_ids));
  if(findings.length!==r.scan.findings_count||findings.some(f=>!f.override_eligible||!covered.has(f.finding_id)))throw new CommandError('unmet_precondition','findings_blocked');
  const existing=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1',[op.item_id])).rows[0];
  const ref=`refs/heads/monos/task/${taskId}/${resourceId}`,marker=`<!-- monos-delivery-item:${op.item_id} -->`,item={item_id:op.item_id,task_id:taskId,resource_id:resourceId,delivery_ref:ref,marker,delivery_kind} as RemoteItem;
  const content=delivery_kind==='github_pr'?await remoteContent(tx,item,op):undefined,published=await retainedPublishedProof(tx,taskId,resourceId);
  const review=(await tx.query<{observation:{review:RemotePreparationReview}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind='review' ORDER BY created_at DESC,id DESC LIMIT 1",[op.item_id])).rows[0]?.observation.review;
  if(existing&&(existing.repository_identity!==resource.repository_identity||existing.delivery_ref!==ref||existing.target_branch!==request.construction.target_branch||existing.item_id!==op.item_id))throw new CommandError('unmet_precondition','identity_mismatch');
  repositories.push(validate('DeliveryRepository',{...common,outcome:'modified',delivery_kind,item_id:op.item_id,candidate:r.candidate,candidate_manifest_digest:r.candidate_manifest_digest,scan:r.scan,scan_digest:r.scan_digest,permission_proof:proof,permission_proof_digest:hash(proof),waivers,target_branch:request.construction.target_branch,delivery_ref:ref,remote_preparation:resource.settings.remote_preparation??'automatic',...(delivery_kind==='github_pr'?{marker,provider_content:content,provider_content_digest:hash(content),...(resource.settings.merge_method?{merge_method:resource.settings.merge_method}:{})}:{}),...(r.mapping?{mapping:r.mapping,mapping_digest:r.mapping_digest}:{}),...(published?{published,published_digest:hash(published)}:{}),...(delivery_kind==='github_pr'&&review?{review}:{})}));
 }
 const manifest=validate<DeliveryAcceptanceManifest>('DeliveryAcceptanceManifest',{schema_version:1,task_id:taskId,basis,...revision,outputs,repositories});
 // Reserve room for detail/batch wrappers and progress, not a clipped manifest.
 if(Buffer.byteLength(JSON.stringify(manifest))>512*1024-32768)throw new CommandError('unmet_precondition','Complete delivery manifest exceeds response budget');
 return manifest;
}

export async function deliveryBatchRecord(tx:Transaction,b:DeliveryBatchRecord):Promise<DeliveryBatch> {
 await assertDeliveryBatchAuthority(tx,b);
 const items:DeliveryItemProgress[]=[];
 for(const r of b.manifest.repositories.filter(r=>r.outcome==='modified')){
  const final=(await tx.query<{kind:'github_merge'|'git_branch';final_commit:string;finalized_at:Date}>('SELECT kind,final_commit,finalized_at FROM owner_delivery_finalizations WHERE batch_id=$1 AND item_id=$2',[b.id,r.item_id])).rows[0];
  const merge=(await tx.query<{id:string;request_digest:string;status:DeliveryItemProgress['operation_state'];selected_method:DeliveryItemProgress['merge_method'];reason:string|null}>('SELECT * FROM owner_delivery_merge_operations WHERE batch_id=$1 AND item_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[b.id,r.item_id])).rows[0];
  const preparation=(await tx.query<{id:string;request_digest:string;kind:DeliveryItemProgress['operation_kind'];state:string;reason:string|null;result:{status?:string}|null}>(`SELECT o.* FROM owner_delivery_preparation_links l JOIN remote_preparation_operations o ON o.id=l.operation_id WHERE l.batch_id=$1 AND l.item_id=$2 ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,[b.id,r.item_id])).rows[0];
  const observed=(await tx.query<{observation:{review:RemotePreparationReview;head:string;base_head:string}}>(`SELECT o.observation FROM remote_preparation_observations o JOIN owner_delivery_preparation_links l ON l.operation_id=o.operation_id WHERE l.batch_id=$1 AND l.item_id=$2 AND o.kind='review' ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,[b.id,r.item_id])).rows[0]?.observation;
  let checks:DeliveryItemProgress['checks']='unknown',status:DeliveryItemProgress['status']='preparing',review=r.review,observedBase:string|undefined,testHead:string|undefined;
  const progress=(await tx.query<{stage:Record<string,unknown>|null;status:'waiting'|'attention';reason:string|null}>('SELECT stage,status,reason FROM owner_delivery_item_readiness WHERE batch_id=$1 AND item_id=$2',[b.id,r.item_id])).rows[0];
  const ready=r.delivery_kind==='git_branch'?undefined:readAcceptedReadiness(progress?.stage?{schema_version:1,stage:progress.stage}:null),stage=ready?.stage;
  if(progress?.status==='attention')status='attention';
  if(r.delivery_kind==='github_pr'&&observed?.head===r.candidate!.head&&observed.review.repository_id===r.provider_metadata.github!.repository_id&&observed.review.marker===r.marker&&observed.review.head_ref===r.delivery_ref!.slice(11)&&observed.review.base_ref===r.target_branch){review=observed.review;observedBase=observed.base_head;}
  if(r.delivery_kind==='github_pr'&&stage&&stage.item_id===r.item_id&&stage.review.head===r.candidate!.head&&stage.review.review.repository_id===r.provider_metadata.github!.repository_id&&stage.review.review.marker===r.marker&&stage.review.review.head_ref===r.delivery_ref!.slice(11)&&stage.review.review.base_ref===r.target_branch){
   review=stage.review.review;observedBase=stage.review.base_head;testHead=stage.review.test_head??undefined;
   const decision=ready!.decision;checks=decision.state==='ready'?'passing':decision.reason==='required_check_failed'?'failing':decision.reason==='required_check_pending'||decision.reason==='required_check_missing'?'pending':'unknown';if(progress?.status!=='attention')status=decision.state==='ready'?'ready':decision.state==='conflicting'?'attention':'waiting_checks';
  }
  if(await permissionConfigurationFingerprint(tx,r.resource_id)!==r.permission_proof!.configuration_fingerprint||await knownPublicExposureCount(tx,b.task_id,r.resource_id,r.repository_identity)){checks='unknown';status='attention';}
  if(r.delivery_kind==='git_branch'){checks='not_applicable';const published=await retainedPublishedProof(tx,b.task_id,r.resource_id);if(status!=='attention'&&published?.candidate.head===r.candidate!.head)status='ready';}
  const operation=merge?{operation_id:merge.id,operation_digest:merge.request_digest,operation_kind:'merge',operation_state:merge.status,merge_method:merge.selected_method}:preparation?{operation_id:preparation.id,operation_digest:preparation.request_digest,operation_kind:preparation.kind,operation_state:preparation.state==='settled'?preparation.result?.status==='reconciliation_required'?'unknown':preparation.reason?'failed':'succeeded':preparation.state==='revoked'?'cancelled':preparation.state}:{};
  let reconciliation:DeliveryItemProgress['reconciliation'];
  if(['cancelled','revoked'].includes(b.status)){
   const item=(await tx.query<{cleanup_state:string}>('SELECT cleanup_state FROM remote_preparation_items WHERE item_id=$1',[r.item_id])).rows[0];
   const pendingMerge=(await tx.query("SELECT 1 FROM owner_delivery_merge_operations WHERE item_id=$1 AND (effect_owned OR status IN ('started','unknown')) LIMIT 1",[r.item_id])).rowCount;
   const pendingPreparation=(await tx.query(`SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=$1 AND (o.effect_owned OR o.may_have_mutated AND o.state NOT IN ('settled','revoked') OR o.kind='push' AND o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')) LIMIT 1`,[r.item_id])).rowCount;
   reconciliation=final&&r.delivery_kind==='github_pr'||item?.cleanup_state==='externally_merged'?'externally_merged':pendingMerge?'waiting_original_merge':pendingPreparation?'waiting_preparation':b.status==='revoked'?'none':item?.cleanup_state==='closed'?'closed':item?.cleanup_state==='not_needed'?'not_needed':item?.cleanup_state==='attention'?'attention':'pending_close';
  }
  items.push(validate('DeliveryItemProgress',{item_id:r.item_id,resource_id:r.resource_id,delivery_kind:r.delivery_kind,accepted_head:r.candidate!.head,checks,status:final?'finalized':b.status==='cancelled'?'cancelled':b.status==='revoked'?'revoked':merge?.status==='unknown'?'reconciling':merge?.status==='started'?'merging':merge?.status==='failed'?'failed':status,...(reconciliation?{reconciliation}:{}),...(review?{review}:{}),...(observedBase?{observed_base:observedBase}:{}),...(testHead?{test_merge_head:testHead}:{}),...operation,...(!final&&(merge?.reason||preparation?.reason||progress?.reason)?{reason:merge?.reason??preparation?.reason??progress?.reason}:{}),...(final?{finality_kind:final.kind,final_commit:final.final_commit,finalized_at:final.finalized_at.toISOString()}:{})}));
 }
 const revocation=(await tx.query<{feedback_id:string;id:string;request_id:string}>('SELECT feedback_id,id,request_id FROM owner_delivery_revocations WHERE batch_id=$1',[b.id])).rows[0];
 const summary:DeliveryBatchSummary={operation_id:b.id,content_digest:b.content_digest,version:Number(b.version),status:b.status,input_cutoff:Number(b.input_cutoff),accepted_at:b.accepted_at.toISOString(),modified_items:items.length,finalized_items:items.filter(i=>i.status==='finalized').length,retry_allowed:['waiting','failed','reconciling','attention'].includes(b.status),cancel_allowed:!['completed','cancelled','revoked'].includes(b.status),...(b.attention_reason?{reason:b.attention_reason}:{})};
 return validate('DeliveryBatch',{schema_version:1,task_id:b.task_id,batch:summary,proposal_id:b.proposal_id,confirmation_id:b.confirmation_id,admission_request_id:b.admission_request_id,manifest:b.manifest,items,...(revocation?{revocation:{feedback_id:revocation.feedback_id,revocation_id:revocation.id,request_id:revocation.request_id,settled:await reviewRevocationSettled(tx,revocation.id)}}:{})});
}
export async function completeLocalDelivery(tx:Transaction,b:DeliveryBatchRecord):Promise<void> {
 if(b.manifest.repositories.some(r=>r.outcome==='modified'))throw new CommandError('unmet_precondition','Modified delivery cannot complete locally');
 await tx.query("UPDATE owner_delivery_batches SET status='completed' WHERE id=$1",[b.id]);
 const done=await tx.query("UPDATE tasks SET state='COMPLETED',control_version=control_version+1 WHERE id=$1 AND state='REVIEW' AND accepted_delivery_operation_id=$2 RETURNING id",[b.task_id,b.id]);
 if(done.rowCount)await planningEvent(tx,b.task_id,'delivery_completed',{batch_id:b.id,content_digest:b.content_digest,local_only:true});
}
export async function completeAcceptedBatch(tx:Transaction,b:DeliveryBatchRecord):Promise<void> {
 await assertDeliveryBatchAuthority(tx,b);
 const modified=b.manifest.repositories.filter(r=>r.outcome==='modified');
 const final=(await tx.query<{item_id:string}>('SELECT item_id FROM owner_delivery_finalizations WHERE batch_id=$1',[b.id])).rows;
 if(final.some(f=>!modified.some(r=>r.item_id===f.item_id)))throw new CommandError('unmet_precondition','Finality is outside accepted membership');
 const task=(await tx.query<{state:string;accepted_delivery_operation_id:string|null}>('SELECT state,accepted_delivery_operation_id FROM tasks WHERE id=$1 FOR UPDATE',[b.task_id])).rows[0];
 if(task?.state==='CANCELLED'||['cancelled','revoked'].includes(b.status))return;
 if(task?.accepted_delivery_operation_id!==b.id||!['REVIEW','COMPLETED'].includes(task.state))throw new CommandError('unmet_precondition','Delivery no longer owns Task completion');
 if(modified.some(r=>!final.some(f=>f.item_id===r.item_id))){
  await tx.query("UPDATE owner_delivery_batches SET status='active',attention_reason=NULL,due_at=clock_timestamp(),version=version+1 WHERE id=$1",[b.id]);
  return;
 }
 await tx.query("UPDATE owner_delivery_batches SET status='completed',version=version+1 WHERE id=$1 AND status<>'completed'",[b.id]);
 const done=await tx.query("UPDATE tasks SET state='COMPLETED',control_version=control_version+1 WHERE id=$1 AND state='REVIEW' RETURNING id",[b.task_id]);
 if(done.rowCount)await planningEvent(tx,b.task_id,'delivery_completed',{batch_id:b.id,content_digest:b.content_digest,local_only:false});
}
