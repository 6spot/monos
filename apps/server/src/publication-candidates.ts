import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { Frame, PublicationPrepareRequest, PublicationResultPage, PublicationResult, PublicationFinding, PublicationACK, PublicationEffectiveBasis, WorkspaceDescriptor, EffectResult } from '../../../packages/protocol/src/index.ts';
import { resolveCanonicalResult } from './task-result-reads.ts';
import { publicationConfiguration, publicationDigest as hash, credentialPath } from './publication-policy.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { specificationFrozen } from './task-specification-state.ts';

export interface DeliveryOperation {
 id:string;task_id:string;resource_id:string;workspace_id:string;runner_id:string;source_operation_id:string;
 request:PublicationPrepareRequest;request_digest:string;state:'pending'|'terminal';dispatch_active:boolean;
 result:PublicationResult|null;result_digest:string|null;item_id:string|null;sent_incarnation:string|null;
}
export async function effectiveResult(tx:Transaction, request:PublicationPrepareRequest) {
 const resolved=await resolveCanonicalResult(tx,request.source.task_id,request.source.operation_id);
 const basis:PublicationEffectiveBasis={task_id:request.source.task_id,specification_id:resolved.item.current_specification_id,plan_id:resolved.item.current_plan_id!,completion_operation_id:request.source.operation_id,completion_manifest_digest:request.source.manifest_digest};
 const head=(await tx.query<{finalized_commit:string}>('SELECT finalized_commit FROM task_workspaces WHERE id=$1',[request.source.workspace_id])).rows[0];
 return {resolved,basis,current:!!resolved.identity && resolved.item.current && head?.finalized_commit===request.source.git_commit && hash(resolved.identity)===request.source_digest && hash(basis)===request.effective_basis_digest};
}
export async function localAdmissionAllowed(tx:Transaction, taskId:string):Promise<boolean> {
 const task=(await tx.query<{state:string}>('SELECT state FROM tasks WHERE id=$1',[taskId])).rows[0];
 return task?.state==='REVIEW' && !(await specificationFrozen(tx,taskId)) && !(await tx.query("SELECT 1 FROM replan_requests WHERE task_id=$1 AND status='pending'",[taskId])).rowCount
  && !(await tx.query("SELECT 1 FROM attempts WHERE task_id=$1 AND NOT process_released UNION ALL SELECT 1 FROM workspace_leases WHERE task_id=$1 AND state<>'released'",[taskId])).rowCount;
}
async function sourceParent(tx:Transaction, source:PublicationPrepareRequest['source']) {
 const row=(await tx.query<{id:string;workspace_descriptor:WorkspaceDescriptor;result:EffectResult;workspace_digest:string;materialized_by_operation_id:string;storage_id:string;repository_identity:string;runner_id:string;task_id:string;resource_id:string}>(`SELECT o.id,o.workspace_descriptor,o.workspace_digest,o.result,w.materialized_by_operation_id,w.storage_id,w.repository_identity,w.runner_id,w.task_id,w.resource_id
 FROM task_workspaces w JOIN operations o ON o.id=w.materialized_by_operation_id WHERE w.id=$1 AND o.kind='open_workspace' AND o.state='succeeded'`,[source.workspace_id])).rows[0];
 if(!row)throw new CommandError('unmet_precondition','Original materialization evidence unavailable');
 const workspace=validate<WorkspaceDescriptor>('WorkspaceDescriptor',row.workspace_descriptor),outcome=validate<EffectResult>('EffectResult',row.result);
 if(workspace.basis || workspace.transfer || workspace.open_operation_id!==row.id || workspace.task_id!==source.task_id || workspace.resource_id!==source.resource_id || workspace.runner_id!==source.runner_id || workspace.workspace_id!==source.workspace_id || hash(workspace)!==row.workspace_digest || row.storage_id!==source.storage_id || row.repository_identity!==source.repository_identity || row.task_id!==source.task_id || row.runner_id!==source.runner_id || row.resource_id!==source.resource_id || (outcome.git_commit!==undefined && outcome.git_commit!==source.base_commit) || outcome.workspace_metadata?.base_commit!==source.base_commit || outcome.workspace_metadata.storage_id!==source.storage_id || outcome.workspace_metadata.repository_identity!==source.repository_identity)throw new CommandError('unmet_precondition','Original public parent evidence differs');
 return {kind:'materialization' as const,commit:source.base_commit,repository_identity:source.repository_identity,observation_operation_id:row.id,workspace,outcome,observation_digest:hash({operation_id:row.id,workspace,outcome})};
}
export async function ensureLocalCandidate(tx:Transaction,taskId:string):Promise<string|undefined> {
 if(!await localAdmissionAllowed(tx,taskId))return;
 const sourceId=(await tx.query<{id:string}>(`SELECT o.id FROM operations o JOIN attempts a ON a.id=o.attempt_id JOIN completion_manifests m ON m.operation_id=o.id JOIN task_workspaces w ON w.id=o.workspace_descriptor->>'workspace_id'
 WHERE a.task_id=$1 AND o.kind='complete_node' AND o.state='succeeded' AND w.finalized_commit=o.result->>'git_commit' ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,[taskId])).rows[0]?.id;
 if(!sourceId)return;
 const {item,identity:source}=await resolveCanonicalResult(tx,taskId,sourceId);
 if(!source || !item.current)return;
 const basis:PublicationEffectiveBasis={task_id:taskId,specification_id:item.current_specification_id,plan_id:item.current_plan_id!,completion_operation_id:source.operation_id,completion_manifest_digest:source.manifest_digest};
 const configuration=await publicationConfiguration(tx,source.resource_id), sourceDigest=hash(source),basisDigest=hash(basis),configDigest=hash(configuration);
 const prior=(await tx.query<DeliveryOperation>("SELECT * FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 ORDER BY created_at DESC,id DESC",[taskId,source.resource_id])).rows;
 for(const p of prior.filter(p=>p.state==='pending' && p.dispatch_active)) {
  if(p.request.source_digest===sourceDigest && p.request.effective_basis_digest===basisDigest && p.request.configuration_digest===configDigest)return p.id;
  await tx.query('UPDATE delivery_operations SET dispatch_active=false WHERE id=$1',[p.id]);
 }
 const same=prior.find(p=>p.request.source_digest===sourceDigest && p.request.effective_basis_digest===basisDigest && p.request.configuration_digest===configDigest);
 if(same){if(same.state==='pending' && !same.dispatch_active)await tx.query('UPDATE delivery_operations SET dispatch_active=true,next_attempt_at=clock_timestamp() WHERE id=$1',[same.id]);return same.id;} // terminal incomplete requires explicit Retry.
 const existing=prior.find(p=>p.request.source_digest===sourceDigest);
 const construction=existing?.request.construction ?? validate<PublicationPrepareRequest['construction']>('PublicationConstruction',{
  schema_version:1,construction_id:randomUUID(),candidate_id:randomUUID(),source_digest:sourceDigest,repository_identity:source.repository_identity,
  target_branch:item.git!.metadata.target_branch,parents:[await sourceParent(tx,source)],author_name:'monos',author_email:'monos@localhost',timestamp:`${Math.floor(Date.now()/1000)} +0000`,message:`monos Task ${taskId} result v1`,
 });
 const operationId=randomUUID();
 const request=validate<PublicationPrepareRequest>('PublicationPrepareRequest',{schema_version:1,operation_id:operationId,scan_run_id:randomUUID(),source,source_digest:sourceDigest,effective_basis:basis,effective_basis_digest:basisDigest,construction,construction_digest:hash(construction),configuration,configuration_digest:configDigest});
 const admissionDigest=hash({source_digest:sourceDigest,effective_basis_digest:basisDigest,configuration_digest:configDigest});
 await insertOperation(tx,request,admissionDigest);
 return operationId;
}
export async function insertOperation(tx:Transaction,request:PublicationPrepareRequest,admissionDigest:string) {
 await tx.query(`INSERT INTO delivery_operations(id,task_id,resource_id,workspace_id,runner_id,source_operation_id,construction_id,candidate_id,scan_run_id,admission_digest,request,request_digest)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[request.operation_id,request.source.task_id,request.source.resource_id,request.source.workspace_id,request.source.runner_id,request.source.operation_id,request.construction.construction_id,request.construction.candidate_id,request.scan_run_id,admissionDigest,request,hash(request)]);
}
function reject(message:string):never {throw new CommandError('payload_conflict',message);}
function verifyResult(request:PublicationPrepareRequest,result:PublicationResult) {
 if(result.operation_id!==request.operation_id || result.request_digest!==hash(request))reject('Publication request identity differs');
 if(result.status==='not_applicable' && result.reason!=='no_change')reject('No-change result reason differs');
 if(result.status!=='prepared')return;
 const c=result.candidate!,scan=result.scan!;
 if(c.candidate_id!==request.construction.candidate_id || c.construction_id!==request.construction.construction_id || c.construction_digest!==request.construction_digest || c.source_digest!==request.source_digest || c.tree!==request.source.git_tree || canonicalJSON(c.parents)!==canonicalJSON(request.construction.parents.map(p=>p.commit)) || hash(c)!==result.candidate_manifest_digest || scan.scan_id!==request.scan_run_id || scan.candidate_manifest_digest!==result.candidate_manifest_digest || scan.configuration_digest!==request.configuration_digest || hash(scan)!==result.scan_digest)reject('Publication candidate or scan identity differs');
}
export function verifyPublicationFinding(f:PublicationFinding,request:PublicationPrepareRequest,result:PublicationResult) {
 const {finding_id,...facts}=f;
 if(hash({candidate_manifest_digest:result.candidate_manifest_digest,configuration_digest:request.configuration_digest,scan_run_id:request.scan_run_id,finding_facts_without_id:facts})!==finding_id)reject('Finding identity differs');
 if(credentialPath(f.path) || f.baseline_path && credentialPath(f.baseline_path) || f.path_redacted && f.path!=='[redacted credential path]' || f.baseline_path_redacted && f.baseline_path!=='[redacted credential path]')reject('Finding path is not safely redacted');
 const messages={tracked_ignore:'Tracked file matches ignore rules.',publication_policy_size:'Blob exceeds local publication policy.',provider_hard_size:'Blob exceeds provider hard limit.',credential_pattern:'Credential pattern matched; value redacted.',published_credential:'Previously published credential exposure requires remediation.',workflow_permission:'Workflow write permission is not verified.'};
 const rules={tracked_ignore:['tracked_ignore'],publication_policy_size:['policy_blob_size'],provider_hard_size:['provider_blob_size'],workflow_permission:['workflow_permission'],credential_pattern:['pem_private_key','github_classic_token','github_fine_grained_token','aws_access_key'],published_credential:['pem_private_key','github_classic_token','github_fine_grained_token','aws_access_key']};
 if(messages[f.kind]!==f.message || !rules[f.kind].includes(f.rule_id) || f.kind==='published_credential' && !request.construction.parents.some(p=>p.commit===f.baseline_commit) || f.kind==='publication_policy_size' && (f.limit!==request.configuration.local_blob_limit || f.size!<=f.limit) || f.kind==='provider_hard_size' && (f.limit!==request.configuration.provider_blob_limit || f.size!<=f.limit) || f.kind==='workflow_permission' && request.configuration.workflow_write==='allowed')reject('Finding rule facts differ');
 const eligible=['tracked_ignore','publication_policy_size','credential_pattern'].includes(f.kind);
 if(f.override_eligible!==eligible)reject('Finding policy eligibility differs');
}
export class PublicationPreparation {
 private afterTask='';
 readonly db:Database;readonly instanceId:string;
 constructor(db:Database,instanceId:string) {this.db=db;this.instanceId=instanceId;}
 async pump():Promise<void> {
  const tasks=(await this.db.pool.query<{id:string}>("SELECT id FROM tasks WHERE state='REVIEW' AND id>$1 ORDER BY id LIMIT 128",[this.afterTask])).rows;
  this.afterTask=tasks.length===128?tasks.at(-1)!.id:'';
  for(const t of tasks)await transaction(this.db,async tx=>{
   await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[t.id]);
   await ensureLocalCandidate(tx,t.id);
  });
 }
 async pending(runnerId:string,incarnation:number,supported:boolean):Promise<Frame[]> {
  return transaction(this.db,async tx=>{
   await lockConfiguration(tx);
   const runner=(await tx.query<{available:boolean}>("SELECT connected AND ready AND connection_instance=$3 AND incarnation=$2 AND last_seen>now()-interval '15 seconds' AS available FROM runners WHERE id=$1 FOR UPDATE",[runnerId,incarnation,this.instanceId])).rows[0];
   if(!runner?.available)throw new CommandError('stale_execution','Publication Runner connection changed');
   if(!supported)return [];
   const rows=(await tx.query<DeliveryOperation>(`SELECT o.* FROM delivery_operations o JOIN tasks t ON t.id=o.task_id
    WHERE o.runner_id=$1 AND o.state='pending' AND o.dispatch_active AND o.next_attempt_at<=clock_timestamp() AND t.state='REVIEW'
     AND NOT EXISTS(SELECT 1 FROM task_publication_slots s WHERE s.task_id=o.task_id)
     AND NOT EXISTS(SELECT 1 FROM replan_requests r WHERE r.task_id=o.task_id AND r.status='pending')
     AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.task_id=o.task_id AND NOT a.process_released)
     AND NOT EXISTS(SELECT 1 FROM workspace_leases l WHERE l.task_id=o.task_id AND l.state<>'released')
    ORDER BY o.created_at,o.id LIMIT 16`,[runnerId])).rows;
   const frames:Frame[]=[];
   for(const row of rows) {
    await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[row.task_id]);
    if(!(await effectiveResult(tx,row.request)).current || hash(await publicationConfiguration(tx,row.resource_id))!==row.request.configuration_digest) {await tx.query('UPDATE delivery_operations SET dispatch_active=false WHERE id=$1',[row.id]);continue;}
    if(!await localAdmissionAllowed(tx,row.task_id)) {
     // Pause the same durable operation while allowing later due Tasks to progress.
     await tx.query("UPDATE delivery_operations SET next_attempt_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",[row.id]);continue;
    }
    await tx.query("UPDATE delivery_operations SET sent_incarnation=$2,last_sent_at=clock_timestamp(),next_attempt_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[row.id,incarnation]);
    frames.push(validate<Frame>('Frame',{schema_version:1,type:'publication_prepare',incarnation,publication_prepare:row.request}));
    if(frames.length===2)break;
   }
   return frames;
  });
 }
 async finish(runnerId:string,incarnation:number,input:unknown):Promise<PublicationACK|undefined> {
  const page=validate<PublicationResultPage>('PublicationResultPage',input);
  return transaction(this.db,async tx=>{
   const runner=(await tx.query<{ok:boolean}>("SELECT connected AND ready AND connection_instance=$3 AND incarnation=$2 AS ok FROM runners WHERE id=$1 FOR UPDATE",[runnerId,incarnation,this.instanceId])).rows[0];
   if(!runner?.ok)throw new CommandError('stale_execution','Publication reply connection changed');
   const locator=(await tx.query<{task_id:string}>('SELECT task_id FROM delivery_operations WHERE id=$1 AND runner_id=$2',[page.result.operation_id,runnerId])).rows[0];
   if(!locator)throw new CommandError('denied_scope','Unknown publication operation');
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[locator.task_id]);
   const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1 FOR UPDATE',[page.result.operation_id])).rows[0]!;
   if(op.state!=='terminal' && Number(op.sent_incarnation)!==incarnation)throw new CommandError('stale_execution','Publication dispatch incarnation changed');
   verifyResult(op.request,page.result);
   if(page.page_index>=page.page_count || hash(page.findings)!==page.page_digest)reject('Publication page identity differs');
   const declared=page.result.scan;
   if(declared && (declared.findings_count>op.request.configuration.max_findings || declared.findings_bytes>op.request.configuration.max_evidence_bytes || page.page_count>Math.max(1,declared.findings_count) || declared.findings_count>0 && !page.findings.length) || !declared && (page.findings.length || page.page_count!==1))reject('Publication declared page budget differs');
   page.findings.forEach(f=>verifyPublicationFinding(f,op.request,page.result));
   const prior=(await tx.query<{page:PublicationResultPage}>('SELECT page FROM publication_result_pages WHERE operation_id=$1 AND page_index=$2',[op.id,page.page_index])).rows[0];
   if(prior && canonicalJSON(prior.page)!==canonicalJSON(page))reject('Publication page replay conflicts');
   if(op.state==='terminal') {
    if(!prior || op.result_digest!==hash(page.result))reject('Terminal publication result is immutable');
    return {schema_version:1,operation_id:op.id,request_digest:op.request_digest,result_digest:op.result_digest!};
   }
   const existing=(await tx.query<{page:PublicationResultPage}>('SELECT page FROM publication_result_pages WHERE operation_id=$1 ORDER BY page_index',[op.id])).rows.map(x=>x.page);
   if(existing.some(p=>p.page_count!==page.page_count || canonicalJSON(p.result)!==canonicalJSON(page.result)))reject('Publication page summary conflicts');
   const accumulated=prior?existing:[...existing,page];
   const partial=accumulated.flatMap(p=>p.findings);
   if(partial.length>op.request.configuration.max_findings || Buffer.byteLength(canonicalJSON(partial))>op.request.configuration.max_evidence_bytes || new Set(partial.map(f=>f.finding_id)).size!==partial.length || new Set(partial.map(f=>f.occurrence_ordinal)).size!==partial.length)reject('Publication accumulated page budget differs');
   if(!prior)await tx.query('INSERT INTO publication_result_pages(operation_id,page_index,page,page_digest) VALUES($1,$2,$3,$4)',[op.id,page.page_index,page,page.page_digest]);
   const pages=prior?existing:[...existing,page];
   if(pages.length!==page.page_count)return;
   pages.sort((a,b)=>a.page_index-b.page_index);
   if(pages.some((p,i)=>p.page_index!==i))reject('Publication coverage pages missing');
   const findings=pages.flatMap(p=>p.findings),encoded=canonicalJSON(findings),scan=page.result.scan;
   if(findings.length>op.request.configuration.max_findings || Buffer.byteLength(encoded)>op.request.configuration.max_evidence_bytes || new Set(findings.map(f=>f.finding_id)).size!==findings.length || new Set(findings.map(f=>f.occurrence_ordinal)).size!==findings.length)reject('Publication findings coverage bounds differ');
   if(scan ? scan.findings_count!==findings.length || scan.findings_bytes!==Buffer.byteLength(encoded) || scan.findings_digest!==hash(findings) : findings.length!==0 || page.page_count!==1)reject('Publication complete counts or digest differ');
   if(scan?.status==='complete' && (scan.coverage.commits>op.request.configuration.max_commits || scan.coverage.paths>scan.coverage.versions || scan.coverage.versions>op.request.configuration.max_versions || scan.coverage.unique_blob_bytes>op.request.configuration.max_aggregate_bytes))reject('Complete publication scan exceeds coverage bounds');
   if(page.result.status==='prepared') {
    const r=page.result,c=r.candidate!;
    const item=(await tx.query<{id:string}>(`INSERT INTO delivery_items(id,task_id,resource_id,workspace_id,runner_id,repository_identity,target_branch) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(task_id,resource_id) DO UPDATE SET task_id=delivery_items.task_id RETURNING id`,[randomUUID(),op.task_id,op.resource_id,op.workspace_id,runnerId,op.request.source.repository_identity,op.request.construction.target_branch])).rows[0]!;
    const candidate=(await tx.query<{manifest_digest:string;construction_digest:string}>('SELECT manifest_digest,construction_digest FROM publication_candidates WHERE id=$1',[c.candidate_id])).rows[0];
    if(candidate && (candidate.manifest_digest!==r.candidate_manifest_digest || candidate.construction_digest!==op.request.construction_digest))reject('Candidate construction replay conflicts');
    if(!candidate)await tx.query(`INSERT INTO publication_candidates(id,task_id,item_id,construction_id,construction,construction_digest,source_operation_id,source_digest,manifest,manifest_digest,prepared_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[c.candidate_id,op.task_id,item.id,c.construction_id,op.request.construction,op.request.construction_digest,op.source_operation_id,op.request.source_digest,c,r.candidate_manifest_digest,op.id]);
    await tx.query('INSERT INTO publication_scans(id,candidate_id,operation_id,summary,digest,configuration,configuration_digest,effective_basis,effective_basis_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[scan!.scan_id,c.candidate_id,op.id,scan,r.scan_digest,op.request.configuration,op.request.configuration_digest,op.request.effective_basis,op.request.effective_basis_digest]);
    for(const [i,f] of findings.entries())await tx.query('INSERT INTO publication_findings(scan_id,ordinal,id,finding) VALUES($1,$2,$3,$4)',[scan!.scan_id,i,f.finding_id,f]);
    await tx.query('UPDATE delivery_operations SET item_id=$2 WHERE id=$1',[op.id,item.id]);
   }
   const resultDigest=hash(page.result);
   await tx.query("UPDATE delivery_operations SET state='terminal',dispatch_active=false,result=$2,result_digest=$3 WHERE id=$1",[op.id,page.result,resultDigest]);
   return {schema_version:1,operation_id:op.id,request_digest:op.request_digest,result_digest:resultDigest};
  });
 }
}
