import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database, Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON, validate} from '../../../packages/protocol/src/index.ts';
import type {DeliveryRepository} from '../../../packages/protocol/src/index.ts';
import {lockConfiguration} from './configuration-guards.ts';
import {publicationDigest as hash} from './publication-policy.ts';
import {evaluateReadiness, selectMergeMethod, validateReadinessCollection} from './github-finalization.ts';
import type {GitHubFinalization, ReadinessDecision, AncestryProof, FinalizationIntent, FinalizationReview, MergeMethod, MergeOutcome, MergeRecovery, ProtectionPolicy, ReadinessCollection, ReadinessCollections} from './github-finalization.ts';
import {ProviderTurnComplete, RemoteProviderError} from './github-remote.ts';
import type {GitHubRemoteScope, ProviderBudget} from './github-remote.ts';
import {RemoteAdmissionError} from './remote-preparation-guards.ts';
import {releaseRemoteProvider, remoteScope, reserveRemoteProvider, retainedPublishedProof, RemoteProviderWaiting} from './remote-preparation-state.ts';
import type {RemoteItem} from './remote-preparation-state.ts';
import {remoteReview} from './remote-preparation.ts';
import {assertDeliveryBatchAuthority, completeAcceptedBatch} from './owner-delivery-state.ts';
import type {DeliveryBatchRecord} from './owner-delivery-state.ts';
import {frozenDeliveryRepository} from './owner-delivery-guards.ts';

export interface AcceptedMergeRequest {
 schema_version: 1; operation_id: string; batch_id: string; content_digest: string;
 item_id: string; task_id: string; repository_digest: string; scope_fingerprint: string;
 intent: FinalizationIntent; review: FinalizationIntent['review']; head: string;
 target_branch: string; merge_method: MergeMethod;
}
interface MergeRow {
 id: string; batch_id: string; item_id: string; request: AcceptedMergeRequest; request_digest: string;
 selected_method: MergeMethod; status: 'pending'|'started'|'unknown'|'failed'|'succeeded'|'cancelled';
 version: string; claim: string|null; backend_instance: string|null; claim_expires_at: Date|null;
 may_have_mutated: boolean; effect_owned: boolean; result: MergeOutcome|MergeRecovery|null; result_digest: string|null;
}
export interface AcceptedReadinessStage {
 item_id: string; phase: 'collecting'|'ready'|'waiting'|'attention'; decision?: ReadinessDecision; scope: string; review: FinalizationReview; policy: ProtectionPolicy;
 collections: ReadinessCollections; ancestry?: AncestryProof;
}
type Stage = AcceptedReadinessStage;
interface Checkpoint {schema_version: 1; claim?: {id: string; instance: string; expires_at: string}; stage?: Stage}
interface Work {
 batch: DeliveryBatchRecord; item: RemoteItem; repository: DeliveryRepository;
 scope: GitHubRemoteScope; fingerprint: string; intent: FinalizationIntent;
 claim: string; preflight: boolean; reservation?: Date; checkpoint: Checkpoint; merge?: MergeRow;
}
const same = (a: unknown,b: unknown) => canonicalJSON(a)===canonicalJSON(b);
function fingerprint(scope: GitHubRemoteScope): string {
 return hash({resource_id:scope.resource_id,repository_id:scope.repository_id,repository_identity:scope.repository_identity,remote_url:scope.remote_url,workflow_changes:scope.workflow_changes,app_id:scope.config?.app_id??null,installation_id:scope.config?.installation_id??null,key_fingerprint:scope.config?.key_fingerprint??null});
}
function stageScope(work: Work, review: FinalizationReview, policy: ProtectionPolicy): string {
 return hash({batch:work.batch.id,content:work.batch.content_digest,item:work.item.item_id,repository:hash(work.repository),config:work.fingerprint,head:review.head,base:review.base_head,test:review.test_head,pr:review.review,policy:policy.digest});
}
function bracket(a: FinalizationReview,b: FinalizationReview): boolean {
 return same(a.review,b.review)&&a.head===b.head&&a.base_head===b.base_head&&a.test_head===b.test_head&&a.content_digest===b.content_digest&&a.draft===b.draft&&a.merged===b.merged;
}
function checkpoint(value: Record<string,unknown>|null): Checkpoint {
 if(!value)return {schema_version:1};
 if(value.schema_version!==1)throw new RemoteAdmissionError('identity_mismatch');
 const cp=value as unknown as Checkpoint;
 if(cp.claim&&(!cp.claim.id||!cp.claim.instance||!Number.isFinite(Date.parse(cp.claim.expires_at))))throw new RemoteAdmissionError('identity_mismatch');
 if(cp.stage)validateStage(cp.stage);
 return cp;
}
function validateStage(stage: Stage): void {
 const reject=()=>{throw new RemoteAdmissionError('identity_mismatch');};
 const oid=(v:unknown)=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
 const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const positive=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
 if(!stage||!stage.item_id||!digest(stage.scope)||!['collecting','ready','waiting','attention'].includes(stage.phase)||!stage.review||!stage.policy||!stage.collections||!Array.isArray(stage.collections.head)||!Array.isArray(stage.collections.test)||Buffer.byteLength(canonicalJSON(stage))>8*1024*1024)reject();
 const r=stage.review,p=stage.policy;
 validate('RemotePreparationReview',r.review);
 if(!oid(r.head)||!oid(r.base_head)||!(r.test_head===null||oid(r.test_head))||!(r.final_head===null||oid(r.final_head))||typeof r.draft!=='boolean'||typeof r.merged!=='boolean'||!(r.merged_at===null||date(r.merged_at))||!date(r.observed_at)||!digest(r.content_digest)||!['mergeable','conflicting','unknown'].includes(r.mergeability))reject();
 if(p.repository_id!==r.review.repository_id||p.target_branch!==r.review.base_ref||!digest(p.digest)||!date(p.observed_at)||typeof p.protected!=='boolean'||typeof p.strict!=='boolean'||typeof p.linear_history!=='boolean'||typeof p.supported!=='boolean'||!['supported','unsupported_protection','unsupported_rules','protection_unknown'].includes(p.reason)||!Array.isArray(p.requirements)||p.requirements.length>200||p.requirements.some(c=>typeof c.context!=='string'||!c.context.length||c.context.length>1024||!(c.app_id===null||positive(c.app_id))))reject();
 for(const [lane,head] of [['head',r.head],['test',r.test_head]] as const) {
  const collections=stage.collections[lane];
  if(collections.length>2||new Set(collections.map(c=>c.kind)).size!==collections.length)reject();
  for(const c of collections) {
   if(c.repository_id!==p.repository_id||c.head!==head||!['check_run','status'].includes(c.kind)||!Array.isArray(c.pages)||c.pages.length>10)reject();
   let total:number|undefined;const ids=new Set<number>();
   for(const [i,page] of c.pages.entries()) {
    if(page.repository_id!==c.repository_id||page.head!==c.head||page.kind!==c.kind||page.page!==i+1||!date(page.observed_at)||typeof page.more!=='boolean'||!Array.isArray(page.items)||page.items.length>100||page.etag!==undefined&&(typeof page.etag!=='string'||page.etag.length>512)||i<c.pages.length-1&&!page.more)reject();
    if(c.kind==='check_run') {if(!Number.isSafeInteger(page.total)||page.total!<0||page.total!>1000||total!==undefined&&total!==page.total||page.items.length!==Math.max(0,Math.min(100,page.total!-i*100))||page.more!==((i+1)*100<page.total!))reject();total=page.total;}
    else if(page.more!==(page.items.length===100))reject();
    for(const check of page.items) {if(check.head!==c.head||check.kind!==c.kind||!positive(check.provider_id)||ids.has(check.provider_id)||!check.name||check.name.length>1024||!date(check.created_at)||c.kind==='check_run'&&!positive(check.app_id)||c.kind==='status'&&check.app_id!==null||!['pending','success','failure','neutral','skipped','cancelled','unknown'].includes(check.state))reject();ids.add(check.provider_id);}
   }
   if(c.pages.length&&!c.pages.at(-1)!.more&&!validateReadinessCollection(c))reject();
  }
 }
 if(stage.ancestry&&(stage.ancestry.repository_id!==p.repository_id||stage.ancestry.base!==r.base_head||stage.ancestry.head!==r.head||!oid(stage.ancestry.merge_base)||!date(stage.ancestry.observed_at)))reject();
}
function completeCollections(collections: ReadinessCollection[],scope: GitHubRemoteScope,head: string): boolean {
 return collections.length===2&&['check_run','status'].every(k=>collections.filter(c=>c.kind===k&&c.head===head&&c.repository_id===scope.repository_id&&validateReadinessCollection(c)).length===1);
}
/** Projection callers receive a freshly evaluated public checkpoint, never a
 * persisted passing label that has outlived its underlying page observations. */
export function readAcceptedReadiness(value: Record<string,unknown>|null): {stage: AcceptedReadinessStage; decision: ReadinessDecision}|undefined {
 const stage=checkpoint(value).stage;
 if(!stage)return;
 return {stage,decision:evaluateReadiness({review:stage.review,policy:stage.policy,collections:stage.collections,ancestry:stage.ancestry})};
}
function currentPages(stage: Stage): boolean {
 return [...stage.collections.head,...stage.collections.test].every(c=>c.pages.every(p=>Date.now()-Date.parse(p.observed_at)<=15_000&&Date.parse(p.observed_at)<=Date.now()));
}
function validateMerge(row: MergeRow,work: Work): void {
 const r=row.request;
 if(hash(r)!==row.request_digest||r.operation_id!==row.id||r.batch_id!==work.batch.id||r.item_id!==work.item.item_id||r.task_id!==work.batch.task_id||r.content_digest!==work.batch.content_digest||r.repository_digest!==hash(work.repository)||r.scope_fingerprint!==work.fingerprint||r.head!==work.repository.candidate!.head||r.target_branch!==work.item.target_branch||r.merge_method!==row.selected_method||!same(r.review,r.intent.review)||!same(r.intent,work.intent))throw new RemoteAdmissionError('identity_mismatch');
}

/** Called only by the real authenticated Owner Retry command under Task/item locks.
 * Unknown effects keep their original operation. Failed requests retain their
 * exact PR, head and selected method; this never accepts a replacement result. */
export async function retryAcceptedMerge(tx: Transaction,batch: DeliveryBatchRecord): Promise<void> {
 await assertDeliveryBatchAuthority(tx,batch);
 for(const repository of batch.manifest.repositories.filter(r=>r.outcome==='modified')) {
  if((await tx.query('SELECT 1 FROM owner_delivery_finalizations WHERE batch_id=$1 AND item_id=$2',[batch.id,repository.item_id])).rowCount)continue;
  await tx.query('SELECT item_id FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[repository.item_id]);
  const old=(await tx.query<MergeRow>('SELECT * FROM owner_delivery_merge_operations WHERE batch_id=$1 AND item_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[batch.id,repository.item_id])).rows[0];
  if(!old||old.status!=='failed')continue;
  if(!old.result||old.result.state!=='rejected'||old.effect_owned||old.result_digest!==hash(old.result)||!(await tx.query("SELECT 1 FROM owner_delivery_observations WHERE batch_id=$1 AND item_id=$2 AND operation_id=$3 AND kind='merge' AND digest=$4 AND observation=$5",[batch.id,repository.item_id,old.id,old.result_digest,old.result])).rowCount)throw new CommandError('unmet_precondition','Original merge remains unresolved');
  const id=randomUUID(),request={...old.request,operation_id:id};
  await tx.query('INSERT INTO owner_delivery_merge_operations(id,batch_id,item_id,request,request_digest,selected_method) VALUES($1,$2,$3,$4,$5,$6)',[id,batch.id,repository.item_id,request,hash(request),old.selected_method]);
 }
 await tx.query("UPDATE owner_delivery_batches SET status=CASE WHEN status='reconciling' THEN status ELSE 'active' END,attention_reason=NULL,due_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('completed','cancelled','revoked')",[batch.id]);
}

export class OwnerDeliveryWorker {
 readonly db: Database; readonly instanceId: string; readonly provider: GitHubFinalization;
 constructor(db: Database,instanceId: string,provider: GitHubFinalization) {this.db=db;this.instanceId=instanceId;this.provider=provider;}
 async pump(): Promise<void> {
  const batches=(await this.db.pool.query<{id:string;task_id:string}>(`SELECT b.id,b.task_id FROM owner_delivery_batches b WHERE b.due_at<=clock_timestamp() AND
   (b.status IN ('active','waiting','reconciling') OR b.status IN ('cancelled','revoked') AND EXISTS(SELECT 1 FROM owner_delivery_merge_operations m WHERE m.batch_id=b.id AND m.status IN ('started','unknown') AND m.may_have_mutated)) ORDER BY b.due_at,b.id LIMIT 16`)).rows;
  for(const b of batches) {
   let work: Work|undefined;
   try {
    work=await this.acquire(b.task_id,b.id); if(!work)continue;
    if(work.merge?.may_have_mutated&&['started','unknown'].includes(work.merge.status))await this.reconcile(work);
    else await this.advance(work);
   } catch(error) {
    if(work)await this.settleError(work,error);
    else if(error instanceof RemoteProviderWaiting)await this.db.pool.query('UPDATE owner_delivery_batches SET due_at=$2 WHERE id=$1',[b.id,error.until]);
    else if(!(error instanceof ProviderTurnComplete))await this.db.pool.query("UPDATE owner_delivery_batches SET status=CASE WHEN status IN ('cancelled','revoked') THEN status ELSE 'attention' END,attention_reason=$2,due_at=clock_timestamp()+interval '30 seconds',version=version+1 WHERE id=$1 AND status<>'completed'",[b.id,safeReason(error)]);
   } finally {
    if(work)await transaction(this.db,tx=>releaseRemoteProvider(tx,work!.scope,work!.reservation));
   }
  }
 }
 private async acquire(taskId: string,batchId: string): Promise<Work|undefined> {
  return transaction(this.db,async tx=>{
   await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[taskId]);
   const batch=(await tx.query<DeliveryBatchRecord>('SELECT * FROM owner_delivery_batches WHERE id=$1 AND task_id=$2 FOR UPDATE',[batchId,taskId])).rows[0];
   if(!batch||batch.status==='completed'||batch.status==='failed'||batch.status==='attention')return;
   await assertDeliveryBatchAuthority(tx,batch);
   const progress=(await tx.query<{item_id:string;finalized:boolean;validated:boolean;recovering:boolean}>(`SELECT member.item_id,
    EXISTS(SELECT 1 FROM owner_delivery_finalizations f WHERE f.batch_id=member.batch_id AND f.item_id=member.item_id) finalized,
    EXISTS(SELECT 1 FROM owner_delivery_item_validations v WHERE v.batch_id=member.batch_id AND v.item_id=member.item_id) validated,
    EXISTS(SELECT 1 FROM owner_delivery_merge_operations m WHERE m.batch_id=member.batch_id AND m.item_id=member.item_id AND m.may_have_mutated AND m.status IN('started','unknown')) recovering
    FROM owner_delivery_batch_items member WHERE member.batch_id=$1 AND member.repository->>'outcome'='modified' ORDER BY member.resource_id COLLATE "C"`,[batch.id])).rows;
   const selected=progress.find(p=>p.recovering)??progress.find(p=>!p.finalized&&!p.validated)??progress.find(p=>!p.finalized);
   const repository=batch.manifest.repositories.find(r=>r.item_id===selected?.item_id);if(!selected||!repository)return;
   const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 AND task_id=$2 FOR UPDATE',[repository.item_id,taskId])).rows[0];if(!item)throw new RemoteAdmissionError('identity_mismatch');
   const merge=(await tx.query<MergeRow>('SELECT * FROM owner_delivery_merge_operations WHERE batch_id=$1 AND item_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[batch.id,item.item_id])).rows[0];
   const recovery=merge?.may_have_mutated&&['started','unknown'].includes(merge.status);
   if(['cancelled','revoked'].includes(batch.status)&&!recovery)return;
   if(!recovery) {
    await frozenDeliveryRepository(tx,item,repository.preparation_request,repository.preparation_result);
    if(merge?.status==='failed')return;
    const proof=await retainedPublishedProof(tx,taskId,item.resource_id);
    if(!proof||proof.candidate.head!==repository.candidate!.head||!item.pr_id||!item.pr_number) {await tx.query("UPDATE owner_delivery_batches SET status='waiting',attention_reason='preparation_pending',due_at=clock_timestamp()+interval '1 second' WHERE id=$1",[batch.id]);return;}
    if((await tx.query("SELECT 1 FROM remote_preparation_operations WHERE item_id=$1 AND (active OR effect_owned) LIMIT 1",[item.item_id])).rowCount)return;
    const prepared=(await tx.query<{observation:{content_digest:string;review:FinalizationIntent['review'];head:string}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind='review' ORDER BY created_at DESC,id DESC LIMIT 1",[item.item_id])).rows[0]?.observation;
    if(!prepared||prepared.content_digest!==repository.provider_content_digest||prepared.head!==repository.candidate!.head||prepared.review.pr_id!==item.pr_id||prepared.review.pr_number!==Number(item.pr_number))throw new RemoteAdmissionError('identity_mismatch');
   }
   const scope=await remoteScope(tx,item,repository.scan!.workflow_changes),fp=fingerprint(scope),original=remoteReview(item);
   if(!scope.config||!original)throw new RemoteProviderError('credentials_missing');
   const intent:FinalizationIntent=recovery?merge!.request.intent:{item_id:item.item_id,delivery_ref:item.delivery_ref,target_branch:item.target_branch,kind:'update_pr',review:original,accepted_head:repository.candidate!.head};
   const cp=checkpoint(batch.checkpoint);
   const cached=(await tx.query<{stage:Stage|null}>('SELECT stage FROM owner_delivery_item_readiness WHERE batch_id=$1 AND item_id=$2',[batch.id,item.item_id])).rows[0];
   if(cached?.stage){validateStage(cached.stage);cp.stage=cached.stage;}
   if(cp.claim&&Date.parse(cp.claim.expires_at)>Date.now())return;
   if(recovery&&merge!.claim_expires_at&&merge!.claim_expires_at.getTime()>Date.now()&&merge!.backend_instance===this.instanceId)return;
   const reservation=await reserveRemoteProvider(tx,scope),claim=randomUUID();
   const work:Work={batch,item,repository,scope,fingerprint:fp,intent,claim,preflight:!selected.validated,reservation,checkpoint:cp,...(merge?{merge}:{})};
   if(merge)validateMerge(merge,work);
   cp.claim={id:claim,instance:this.instanceId,expires_at:new Date(Date.now()+120_000).toISOString()};
   await tx.query('UPDATE owner_delivery_batches SET checkpoint=$2 WHERE id=$1',[batch.id,{schema_version:1,claim:cp.claim}]);
   if(recovery)await tx.query("UPDATE owner_delivery_merge_operations SET status='unknown',claim=$2,backend_instance=$3,claim_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 WHERE id=$1",[merge!.id,claim,this.instanceId]);
   return work;
  });
 }
 private async guard(tx: Transaction,work: Work,recovery=false,retainHistorical=false): Promise<DeliveryBatchRecord> {
  await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[work.batch.task_id]);
  const batch=(await tx.query<DeliveryBatchRecord>('SELECT * FROM owner_delivery_batches WHERE id=$1 FOR UPDATE',[work.batch.id])).rows[0]!;
  const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[work.item.item_id])).rows[0]!;
  await assertDeliveryBatchAuthority(tx,batch);
  if(checkpoint(batch.checkpoint).claim?.id!==work.claim)throw new RemoteAdmissionError('identity_mismatch');
  // Current credentials gate every grant/read/new effect. A response already
  // obtained under the admitted original claim is historical remote truth;
  // changing configuration cannot erase that fact or cause another mutation.
  if(!retainHistorical&&fingerprint(await remoteScope(tx,item,work.repository.scan!.workflow_changes))!==work.fingerprint)throw new RemoteAdmissionError('configuration_changed');
  if(!recovery) {
   const approved=await frozenDeliveryRepository(tx,item,work.repository.preparation_request,work.repository.preparation_result);
   if(!approved||approved.batch.id!==batch.id||item.cancel_requested)throw new RemoteAdmissionError('cancel_requested');
   if(item.pr_id!==work.intent.review.pr_id||Number(item.pr_number)!==work.intent.review.pr_number)throw new RemoteAdmissionError('identity_mismatch');
  }
  return batch;
 }
 private async advance(work: Work): Promise<void> {
  const cp=work.checkpoint;
  if(cp.stage&&completeCollections(cp.stage.collections.head,work.scope,work.intent.accepted_head)&&(!cp.stage.review.test_head||completeCollections(cp.stage.collections.test,work.scope,cp.stage.review.test_head))&&currentPages(cp.stage)&&evaluateReadiness({review:cp.stage.review,policy:cp.stage.policy,collections:cp.stage.collections,ancestry:cp.stage.ancestry}).state==='ready')return this.effect(work,cp.stage);
  const budget:ProviderBudget={remaining:8},grant=await this.provider.remote.grant(work.scope,'readiness',budget);
  await transaction(this.db,tx=>this.guard(tx,work));
  const before=await this.provider.review(work.scope,work.intent,grant,budget);
  if(before.content_digest!==work.repository.provider_content_digest)throw new RemoteAdmissionError('identity_mismatch');
  let policy=await this.provider.policy(work.scope,work.item.target_branch,grant,budget,cp.stage?.policy.protected===false?'unprotected':'protected');
  if(policy.reason==='protection_unknown'&&policy.protected&&budget.remaining>=3)policy=await this.provider.policy(work.scope,work.item.target_branch,grant,budget,'unprotected');
  const scoped=stageScope(work,before,policy);
  let stage=cp.stage;
  if(!stage||stage.scope!==scoped)stage={item_id:work.item.item_id,phase:'collecting',scope:scoped,review:before,policy,collections:{head:[],test:[]}};
  stage.review=before;stage.policy=policy;
  if(policy.supported&&policy.strict&&(!stage.ancestry||stage.ancestry.base!==before.base_head||stage.ancestry.head!==before.head)&&budget.remaining>1)stage.ancestry=await this.provider.ancestry(work.scope,before.base_head,before.head,grant,budget);
  if(policy.supported) {
   const targets:[keyof ReadinessCollections,string][]=[['head',before.head],...(before.test_head?[['test',before.test_head] as [keyof ReadinessCollections,string]]:[])];
   for(const [lane,head] of targets)for(const kind of ['check_run','status'] as const) {
    let collection=stage.collections[lane].find(c=>c.kind===kind);
    if(!collection) {collection={repository_id:work.scope.repository_id,head,kind,pages:[]};stage.collections[lane].push(collection);}
    for(let page=1;page<=10&&budget.remaining>1;page++) {
     const old=collection.pages[page-1];
     if(old&&Date.now()-Date.parse(old.observed_at)<=15_000&&Date.parse(old.observed_at)<=Date.now()) {if(!old.more)break;continue;}
     const observed=await this.provider.checkPage(work.scope,head,kind,page,grant,budget,old);
     if(kind==='check_run'&&collection.pages.some(p=>p.total!==observed.total)) {collection.pages=[];if(page!==1)break;}
     collection.pages[page-1]=observed;collection.pages=collection.pages.slice(0,page);
     if(!observed.more)break;
    }
   }
  }
  const after=await this.provider.review(work.scope,work.intent,grant,budget);
  if(!bracket(before,after)) {await this.save(work,{schema_version:1},'waiting','readiness_changed',1000);return;}
  const decision=evaluateReadiness({review:after,policy,collections:stage.collections,ancestry:stage.ancestry});
  stage.decision=decision;
  cp.stage=stage;
  const terminal=decision.state==='conflicting'||decision.state==='unknown'&&['unsupported_protection','unsupported_rules','protection_unknown','status_producer_unknown'].includes(decision.reason);
  stage.phase=terminal?'attention':decision.state==='ready'?'ready':decision.state==='waiting'?'waiting':'collecting';
  const delay=decision.reason==='mergeability_pending'?5000:['required_check_pending','required_check_missing'].includes(decision.reason)?15_000:1000;
  await this.save(work,cp,terminal?'attention':'waiting',decision.state==='ready'?null:decision.reason,delay);
 }
 private async effect(work: Work,stage: Stage): Promise<void> {
  const budget:ProviderBudget={remaining:8},read=await this.provider.remote.grant(work.scope,'readiness',budget);
  await transaction(this.db,tx=>this.guard(tx,work));
  const before=await this.provider.review(work.scope,work.intent,read,budget),policy=await this.provider.policy(work.scope,work.item.target_branch,read,budget,stage.policy.protected?'protected':'unprotected');
  if(stage.scope!==stageScope(work,before,policy)||!bracket(stage.review,before)||evaluateReadiness({review:before,policy,collections:stage.collections,ancestry:stage.ancestry}).state!=='ready') {await this.save(work,{schema_version:1},'waiting','readiness_changed',1000);return;}
  const write=await this.provider.remote.grant(work.scope,'merge',budget);
  await transaction(this.db,tx=>this.guard(tx,work));
  const settings=await this.provider.settings(work.scope,write,budget),method=selectMergeMethod(settings,policy,work.repository.merge_method,work.merge?.selected_method);
  if(!method) {await this.save(work,work.checkpoint,'attention','merge_method_unavailable',1000);return;}
  const after=await this.provider.review(work.scope,work.intent,read,budget);
  if(!bracket(before,after)||after.mergeability!=='mergeable'||evaluateReadiness({review:after,policy,collections:stage.collections,ancestry:stage.ancestry}).state!=='ready'||budget.remaining!==1) {await this.save(work,{schema_version:1},'waiting','readiness_changed',1000);return;}
  if(work.preflight){
   await transaction(this.db,async tx=>{
    await this.guard(tx,work);
    if(!currentPages(stage))throw new RemoteAdmissionError('identity_mismatch');
    stage.review=after;stage.policy=policy;stage.phase='ready';stage.decision=evaluateReadiness({review:after,policy,collections:stage.collections,ancestry:stage.ancestry});
    const id=await this.observe(tx,work,null,'readiness',{batch_id:work.batch.id,content_digest:work.batch.content_digest,repository_digest:hash(work.repository),scope_fingerprint:work.fingerprint,stage,settings,method});
    await tx.query('INSERT INTO owner_delivery_item_validations(batch_id,item_id,observation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[work.batch.id,work.item.item_id,id]);
    await this.saveStage(tx,work,stage,'waiting',null);
    await tx.query("UPDATE owner_delivery_batches SET checkpoint=checkpoint-'claim',status='active',attention_reason=NULL,due_at=clock_timestamp(),version=version+1 WHERE id=$1",[work.batch.id]);
   });
   return;
  }
  const row=await transaction(this.db,async tx=>{
   await this.guard(tx,work);
   if(!currentPages(stage))throw new RemoteAdmissionError('identity_mismatch');
   // Revalidate the complete frozen local authority before admitting any new
   // mutation. Remote preflight remains historical; this item's checks are fresh.
   for(const repository of work.batch.manifest.repositories.filter(r=>r.outcome==='modified')){
    const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[repository.item_id])).rows[0]!;
    const authority=await frozenDeliveryRepository(tx,item,repository.preparation_request,repository.preparation_result);
    if(!authority||authority.batch.id!==work.batch.id)throw new RemoteAdmissionError('identity_mismatch');
   }

   let merge=(await tx.query<MergeRow>('SELECT * FROM owner_delivery_merge_operations WHERE batch_id=$1 AND item_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[work.batch.id,work.item.item_id])).rows[0];
   if(merge) {validateMerge(merge,work);if(merge.status!=='pending'||merge.may_have_mutated)throw new RemoteAdmissionError('possible_publication');}
   else {
    const id=randomUUID(),request:AcceptedMergeRequest={schema_version:1,operation_id:id,batch_id:work.batch.id,content_digest:work.batch.content_digest,item_id:work.item.item_id,task_id:work.batch.task_id,repository_digest:hash(work.repository),scope_fingerprint:work.fingerprint,intent:work.intent,review:work.intent.review,head:work.intent.accepted_head,target_branch:work.intent.target_branch,merge_method:method};
    merge=(await tx.query<MergeRow>('INSERT INTO owner_delivery_merge_operations(id,batch_id,item_id,request,request_digest,selected_method) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,work.batch.id,work.item.item_id,request,hash(request),method])).rows[0]!;
   }
   await this.observe(tx,work,merge.id,'readiness',{review:after,policy,collections:stage.collections,ancestry:stage.ancestry??null,settings,method});
   await tx.query("UPDATE owner_delivery_merge_operations SET status='started',may_have_mutated=true,effect_owned=true,claim=$2,backend_instance=$3,claim_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 WHERE id=$1",[merge.id,work.claim,this.instanceId]);
   await tx.query("UPDATE owner_delivery_batches SET status='reconciling',attention_reason=NULL,version=version+1 WHERE id=$1",[work.batch.id]);
   return merge;
  });
  work.merge=row;
  const outcome=await this.provider.merge(work.scope,row.request.intent,row.selected_method,write,budget);
  if(outcome.state==='rejected'&&outcome.cooldown_ms)await transaction(this.db,tx=>releaseRemoteProvider(tx,work.scope,work.reservation,new RemoteProviderError('rate_limited',outcome.cooldown_ms)));
  await this.finish(work,row,outcome,'merge');
 }
 private async reconcile(work: Work): Promise<void> {
  const budget:ProviderBudget={remaining:8},grant=await this.provider.remote.grant(work.scope,'reconcile',budget);
  await transaction(this.db,tx=>this.guard(tx,work,true));
  const observed=await this.provider.reconcile(work.scope,work.merge!.request.intent,grant,budget);
  await this.finish(work,work.merge!,observed,'reconcile');
 }
 private async finish(work: Work,merge: MergeRow,outcome: MergeOutcome|MergeRecovery,kind: 'merge'|'reconcile'): Promise<void> {
  await transaction(this.db,async tx=>{
   const batch=await this.guard(tx,work,true,true),row=(await tx.query<MergeRow>('SELECT * FROM owner_delivery_merge_operations WHERE id=$1 FOR UPDATE',[merge.id])).rows[0]!;
   validateMerge(row,work);if(row.claim!==work.claim||row.backend_instance!==this.instanceId)return;
   await this.observe(tx,work,row.id,kind,outcome);
   if(outcome.state==='merged') {
    const fact={schema_version:1,batch_id:batch.id,item_id:work.item.item_id,operation_id:row.id,request_digest:row.request_digest,accepted_head:row.request.head,final_commit:outcome.final_head,requested_method:row.selected_method,evidence:outcome};
    await tx.query('INSERT INTO owner_delivery_finalizations(batch_id,item_id,operation_id,final_commit,fact,digest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id,item_id) DO NOTHING',[batch.id,work.item.item_id,row.id,outcome.final_head,fact,hash(fact)]);
    await tx.query("UPDATE owner_delivery_merge_operations SET status='succeeded',result=$2,result_digest=$3,effect_owned=false,claim=NULL,backend_instance=NULL,claim_expires_at=NULL,version=version+1 WHERE id=$1",[row.id,outcome,hash(outcome)]);
    await tx.query("UPDATE remote_preparation_items SET cleanup_state='externally_merged' WHERE item_id=$1",[work.item.item_id]);
    await this.observe(tx,work,row.id,'final',fact);
    await completeAcceptedBatch(tx,batch);
   } else if(outcome.state==='rejected') {
    await tx.query("UPDATE owner_delivery_merge_operations SET status='failed',reason=$2,result=$3,result_digest=$4,effect_owned=false,claim=NULL,backend_instance=NULL,claim_expires_at=NULL,version=version+1 WHERE id=$1",[row.id,outcome.reason,outcome,hash(outcome)]);
    await tx.query("UPDATE owner_delivery_batches SET status=CASE WHEN status IN ('cancelled','revoked') THEN status ELSE 'failed' END,attention_reason=$2,version=version+1 WHERE id=$1",[batch.id,outcome.reason]);
   } else {
    await tx.query("UPDATE owner_delivery_merge_operations SET status='unknown',reason=$2,result=$3,result_digest=$4,claim=NULL,backend_instance=NULL,claim_expires_at=NULL,due_at=clock_timestamp()+interval '5 seconds',version=version+1 WHERE id=$1",[row.id,outcome.reason,outcome,hash(outcome)]);
    await tx.query("UPDATE owner_delivery_batches SET status=CASE WHEN status IN ('cancelled','revoked') THEN status ELSE 'reconciling' END,attention_reason=$2,due_at=clock_timestamp()+interval '5 seconds',version=version+1 WHERE id=$1",[batch.id,outcome.reason]);
   }
   await tx.query("UPDATE owner_delivery_batches SET checkpoint=checkpoint-'claim' WHERE id=$1",[batch.id]);
  });
 }
 private async observe(tx: Transaction,work: Work,operation: string|null,kind: 'readiness'|'merge'|'reconcile'|'final',facts: unknown): Promise<string> {
  const id=randomUUID();
  await tx.query('INSERT INTO owner_delivery_observations(id,batch_id,item_id,operation_id,kind,observation,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,work.batch.id,work.item.item_id,operation,kind,facts,hash(facts)]);
  return id;
 }
 private async saveStage(tx:Transaction,work:Work,stage:Stage|undefined,status:'waiting'|'attention',reason:string|null):Promise<void>{
  await tx.query(`INSERT INTO owner_delivery_item_readiness(batch_id,item_id,stage,status,reason) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(batch_id,item_id) DO UPDATE SET stage=EXCLUDED.stage,status=EXCLUDED.status,reason=EXCLUDED.reason,updated_at=clock_timestamp()`,[work.batch.id,work.item.item_id,stage??null,status,reason]);
 }
 private async save(work: Work,cp: Checkpoint,status: 'waiting'|'attention',reason: string|null,delay: number): Promise<void> {
  await transaction(this.db,async tx=>{
   await this.guard(tx,work);await this.saveStage(tx,work,cp.stage,status,reason);
   await tx.query("UPDATE owner_delivery_batches SET checkpoint=checkpoint-'claim',status=$2,attention_reason=$3,due_at=clock_timestamp()+$4*interval '1 millisecond',version=version+1 WHERE id=$1",[work.batch.id,status,reason,delay]);
  });
 }
 private async settleError(work: Work,error: unknown): Promise<void> {
  const reason=safeReason(error);
  await transaction(this.db,async tx=>{
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[work.batch.task_id]);
   const batch=(await tx.query<DeliveryBatchRecord>('SELECT * FROM owner_delivery_batches WHERE id=$1 FOR UPDATE',[work.batch.id])).rows[0];
   if(!batch||checkpoint(batch.checkpoint).claim?.id!==work.claim)return;
   const possible=(await tx.query<MergeRow>("SELECT * FROM owner_delivery_merge_operations WHERE batch_id=$1 AND item_id=$2 AND may_have_mutated AND status IN ('started','unknown') FOR UPDATE",[batch.id,work.item.item_id])).rows[0];
   if(possible)await tx.query("UPDATE owner_delivery_merge_operations SET status='unknown',reason=$2,claim=NULL,backend_instance=NULL,claim_expires_at=NULL,version=version+1 WHERE id=$1",[possible.id,reason]);
   await this.saveStage(tx,work,work.checkpoint.stage,'attention',reason);
   const transient=error instanceof RemoteProviderError&&['rate_limited','provider_unavailable'].includes(error.reason)||error instanceof ProviderTurnComplete;
   await tx.query("UPDATE owner_delivery_batches SET status=CASE WHEN status IN ('cancelled','revoked') THEN status WHEN $2 THEN 'reconciling' WHEN $3 THEN 'waiting' ELSE 'attention' END,attention_reason=$4,checkpoint=checkpoint-'claim',due_at=clock_timestamp()+interval '5 seconds',version=version+1 WHERE id=$1",[batch.id,!!possible,transient,reason]);
   await releaseRemoteProvider(tx,work.scope,work.reservation,error);
  });
 }
}
function safeReason(error: unknown): string {
 if(error instanceof RemoteAdmissionError||error instanceof RemoteProviderError)return error.reason;
 if(error instanceof ProviderTurnComplete)return 'provider_turn_complete';
 if(error instanceof CommandError)return 'authority_invalid';
 return 'provider_unavailable';
}
