import {randomUUID} from 'node:crypto';
import type {Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {PublicationPushRequest,PublicationPushResult,PublicationPublishedProof,PublicationRefObservation,PublicationExposure,RemotePreparationProviderRequest,RemotePreparationOperation,PublicationOverrideProof,PublicationFinding} from '../../../packages/protocol/src/index.ts';
import type {GitHubCredentials} from './github.ts';
import type {GitHubRemoteScope} from './github-remote.ts';
import {RemoteProviderError} from './github-remote.ts';
import {publicationDigest as hash,credentialPath} from './publication-policy.ts';

export interface RemoteItem {
 item_id:string;task_id:string;resource_id:string;runner_id:string;storage_id:string;repository_identity:string;repository_id:string|null;remote_url:string;delivery_ref:string;target_branch:string;marker:string|null;delivery_kind:'github_pr'|'git_branch';
 pr_id:string|null;pr_number:string|null;last_published_proof:PublicationPublishedProof|null;last_published_digest:string|null;cancel_requested:boolean;cleanup_state:string;next_poll_at:Date;poll_progress:Record<string,unknown>|null;
}
export interface RemoteOperation extends Omit<RemotePreparationOperation,'operation_id'|'version'> {
 id:string;item_id:string;task_id:string;resource_id:string;runner_id:string;request:PublicationPushRequest|RemotePreparationProviderRequest;request_digest:string;version:string;active:boolean;effect_owned:boolean;
 result:PublicationPushResult|Record<string,unknown>|null;result_digest:string|null;claim_id:string|null;claim_instance:string|null;sent_incarnation:string|null;claim_expires_at:Date|null;
}
export class RemoteProviderWaiting extends CommandError {
 readonly until:Date;
 readonly retry_after_seconds:number;
 constructor(until:Date){super('rate_limited','Provider installation is waiting');this.until=until;this.retry_after_seconds=Math.max(1,Math.ceil((until.getTime()-Date.now())/1000));}
}
export async function reserveRemoteProvider(tx:Transaction,scope:GitHubRemoteScope):Promise<Date|undefined> {
 if(!scope.config)return;
 const id=scope.config.installation_id;
 await tx.query("INSERT INTO github_remote_cooldowns(installation_id,reason) VALUES($1,'spacing') ON CONFLICT DO NOTHING",[id]);
 const row=(await tx.query<{next_request_at:Date;ready:boolean}>("SELECT next_request_at,next_request_at<=clock_timestamp() ready FROM github_remote_cooldowns WHERE installation_id=$1 FOR UPDATE",[id])).rows[0]!;
 if(!row.ready)throw new RemoteProviderWaiting(row.next_request_at);
 return (await tx.query<{next_request_at:Date}>("UPDATE github_remote_cooldowns SET next_request_at=date_trunc('milliseconds',clock_timestamp())+interval '120 seconds',reason='spacing' WHERE installation_id=$1 RETURNING next_request_at",[id])).rows[0]!.next_request_at;
}
export async function releaseRemoteProvider(tx:Transaction,scope:GitHubRemoteScope,reservation:Date|undefined,error?:unknown):Promise<void> {
 if(!scope.config||!reservation)return;
 if(error instanceof RemoteProviderError&&error.cooldown_ms>0) {
  await tx.query("UPDATE github_remote_cooldowns SET next_request_at=GREATEST(next_request_at,clock_timestamp()+$2*interval '1 millisecond'),reason=$3 WHERE installation_id=$1",[scope.config.installation_id,error.cooldown_ms,error.reason==='rate_limited'?'secondary_rate_limit':'transient']);
 } else await tx.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()+interval '1 second' WHERE installation_id=$1 AND reason='spacing' AND next_request_at=$2",[scope.config.installation_id,reservation]);
}
export async function remoteItemQuiescent(tx:Transaction,taskId:string):Promise<boolean> {
 return !(await tx.query(`SELECT 1 FROM remote_preparation_operations o WHERE o.task_id=$1 AND (o.effect_owned OR o.kind='push' AND o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')) LIMIT 1`,[taskId])).rowCount;
}
export async function requestRemoteCancel(tx:Transaction,taskId:string):Promise<void> {
 await tx.query("UPDATE remote_preparation_items SET cancel_requested=true,cleanup_state='pending',next_poll_at=clock_timestamp() WHERE task_id=$1",[taskId]);
 await tx.query("UPDATE remote_preparation_operations SET state='revoked',active=false,version=version+1 WHERE task_id=$1 AND state NOT IN ('settled','revoked') AND NOT may_have_mutated AND NOT effect_owned",[taskId]);
 await tx.query("UPDATE delivery_operations SET dispatch_active=false WHERE task_id=$1 AND state='pending'",[taskId]);
}
export async function remoteScope(tx:Transaction,item:Pick<RemoteItem,'resource_id'|'repository_identity'|'repository_id'|'remote_url'>,workflowChanges=false):Promise<GitHubRemoteScope> {
 if(!item.repository_id)throw new CommandError('denied_scope','GitHub scope requires a GitHub repository');
 const config=(await tx.query<GitHubCredentials>('SELECT app_id,installation_id,encrypted_key,key_fingerprint FROM github_configuration')).rows[0];
 return {resource_id:item.resource_id,repository_identity:item.repository_identity,repository_id:item.repository_id,remote_url:item.remote_url,workflow_changes:workflowChanges,...(config?{config}:{})};
}
export async function appendRemoteObservation(tx:Transaction,item:RemoteItem,operationId:string|null,kind:'ref'|'review'|'checks'|'published'|'cleanup',observation:unknown,id:string=randomUUID()):Promise<string> {
 const digest=hash(observation);
 await tx.query('INSERT INTO remote_preparation_observations(id,item_id,task_id,operation_id,kind,observation,digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,item.item_id,item.task_id,operationId,kind,observation,digest]);return digest;
}
export function verifyPushObservation(request:PublicationPushRequest,observation:PublicationRefObservation):void {
 for(const key of ['operation_id','item_id','task_id','resource_id','runner_id','storage_id','repository_identity','delivery_ref'] as const)if(request[key]!==observation[key])throw new CommandError('payload_conflict','Remote observation scope differs');
 if(!same(request.provider_metadata,observation.provider_metadata))throw new CommandError('payload_conflict','Remote observation provider differs');
 if(!Number.isFinite(Date.parse(observation.observed_at)))throw new CommandError('payload_conflict','Remote observation time differs');
}
export async function publishProof(tx:Transaction,item:RemoteItem,op:RemoteOperation,observation:PublicationRefObservation):Promise<PublicationPublishedProof> {
 const request=validate<PublicationPushRequest>('PublicationPushRequest',op.request),result=validate<PublicationPushResult>('PublicationPushResult',op.result);
 if(op.kind!=='push'||op.state!=='settled'||hash(request)!==op.request_digest||hash(result)!==op.result_digest||!result.worker_absent||!['published','reconciliation_required'].includes(result.status)||result.request_digest!==op.request_digest||result.operation_id!==op.id||request.operation_id!==op.id||request.item_id!==item.item_id||hash(request.prepared)!==request.preparation_result_digest||hash(request.prepared.candidate)!==request.prepared.candidate_manifest_digest||result.item_id!==item.item_id||result.delivery_ref!==item.delivery_ref||result.candidate_head!==request.prepared.candidate?.head||result.candidate_manifest_digest!==request.prepared.candidate_manifest_digest||hash(result.observation)!==result.observation_digest)throw new CommandError('payload_conflict','Retained published operation differs');
 for(const key of ['task_id','resource_id','runner_id','storage_id','repository_identity','delivery_ref'] as const)if(request[key]!==item[key])throw new CommandError('payload_conflict','Published item scope differs');
 if(!same(request.provider_metadata,remoteProviderMetadata(item)))throw new CommandError('payload_conflict','Published provider differs');
 verifyPushObservation(request,result.observation);
 verifyPushObservation(request,observation);
 if(observation.status!=='present'||observation.head!==request.prepared.candidate!.head)throw new CommandError('unmet_precondition','Remote candidate head is not confirmed');
 const prior=(await tx.query<{observation:PublicationPublishedProof}>("SELECT observation FROM remote_preparation_observations WHERE operation_id=$1 AND kind='published' ORDER BY created_at,id LIMIT 1",[op.id])).rows[0];
 if(prior)return prior.observation;
 const proof=validate<PublicationPublishedProof>('PublicationPublishedProof',{schema_version:1,operation_id:op.id,request_digest:op.request_digest,result_digest:op.result_digest,item_id:item.item_id,task_id:item.task_id,resource_id:item.resource_id,runner_id:item.runner_id,storage_id:item.storage_id,repository_identity:item.repository_identity,provider_metadata:remoteProviderMetadata(item),delivery_ref:item.delivery_ref,candidate:request.prepared.candidate,candidate_manifest_digest:request.prepared.candidate_manifest_digest,observation,observation_digest:hash(observation)});
 await appendRemoteObservation(tx,item,op.id,'ref',observation,observation.observation_id);
 const proofDigest=await appendRemoteObservation(tx,item,op.id,'published',proof);
 // The public fact is recorded before the next ordinary provider effect can be
 // admitted, even when the original credential finding had a genuine waiver.
 const findings=(await tx.query<{finding:PublicationFinding}>('SELECT finding FROM publication_findings WHERE scan_id=$1 AND finding->>\'kind\'=\'credential_pattern\'',[request.prepared.scan!.scan_id])).rows;
 for(const {finding:f} of findings) {
  if(!f.blob||!f.content_digest||credentialPath(f.path)||f.path_redacted&&f.path!=='[redacted credential path]')throw new CommandError('payload_conflict','Published exposure facts are unsafe');
  const exposure=validate<PublicationExposure>('PublicationExposure',{schema_version:1,exposure_id:hash({item_id:item.item_id,published_proof_digest:proofDigest,finding_id:f.finding_id}),item_id:item.item_id,task_id:item.task_id,resource_id:item.resource_id,repository_identity:item.repository_identity,published_proof_digest:proofDigest,candidate_manifest_digest:proof.candidate_manifest_digest,finding_id:f.finding_id,published_head:proof.candidate.head,commit:f.commit,blob:f.blob,content_digest:f.content_digest,rule_id:f.rule_id,path:f.path,path_redacted:f.path_redacted,occurrence_ordinal:f.occurrence_ordinal});
  await tx.query('INSERT INTO remote_published_exposures(id,item_id,task_id,operation_id,scan_id,finding_id,published_proof_digest,exposure) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[exposure.exposure_id,item.item_id,item.task_id,op.id,request.prepared.scan!.scan_id,f.finding_id,proofDigest,exposure]);
 }
 await tx.query('UPDATE remote_preparation_items SET last_published_proof=$2,last_published_digest=$3,next_poll_at=clock_timestamp() WHERE item_id=$1',[item.item_id,proof,proofDigest]);return proof;
}
export async function retainedPublishedProof(tx:Transaction,taskId:string,resourceId:string):Promise<PublicationPublishedProof|undefined> {
 const row=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE task_id=$1 AND resource_id=$2',[taskId,resourceId])).rows[0];
 if(!row?.last_published_proof)return;
 const proof=validate<PublicationPublishedProof>('PublicationPublishedProof',row.last_published_proof);
 if(hash(proof)!==row.last_published_digest||proof.task_id!==taskId||proof.resource_id!==resourceId||proof.item_id!==row.item_id||hash(proof.candidate)!==proof.candidate_manifest_digest||hash(proof.observation)!==proof.observation_digest||proof.observation.status!=='present'||proof.observation.head!==proof.candidate.head)throw new CommandError('unmet_precondition','Retained published proof differs');
 const op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 AND item_id=$2',[proof.operation_id,row.item_id])).rows[0];
 if(!op||op.state!=='settled'||hash(op.request)!==proof.request_digest||op.result_digest!==proof.result_digest||!op.result||hash(op.result)!==proof.result_digest||!op.result.worker_absent||!(await tx.query("SELECT 1 FROM remote_preparation_observations WHERE operation_id=$1 AND item_id=$2 AND kind='published' AND digest=$3",[op.id,row.item_id,row.last_published_digest])).rowCount)throw new CommandError('unmet_precondition','Original published receipt differs');
 return proof;
}
export async function actualOverrideProofs(tx:Transaction,taskId:string,scanId:string):Promise<PublicationOverrideProof[]> {
 return (await tx.query<PublicationOverrideProof>(`SELECT r.id receipt_id,r.confirmation_id,r.selection,r.selection_digest FROM publication_override_receipts r JOIN authorization_receipts a ON a.id=r.confirmation_id JOIN task_command_proposals p ON p.id=a.proposal_id JOIN publication_command_receipts c ON c.task_id=r.task_id AND c.request_id=r.request_id WHERE r.task_id=$1 AND r.scan_id=$2 AND a.consumed_by=r.request_id AND p.action='override_publication_findings' AND p.task_id=r.task_id AND p.content_digest=r.selection_digest AND p.content=r.selection AND c.envelope->>'name'='override_publication_findings' AND c.envelope->'payload'->>'confirmation_id'=r.confirmation_id AND ((c.envelope->'payload')-'confirmation_id'::text)=r.selection AND c.response->>'receipt_id'=r.id AND c.response->>'status'='committed' ORDER BY r.id`,[taskId,scanId])).rows.map(row=>{if(hash(row.selection)!==row.selection_digest)throw new CommandError('payload_conflict','Override receipt content differs');return validate('PublicationOverrideProof',row);});
}
export const same=(a:unknown,b:unknown)=>canonicalJSON(a)===canonicalJSON(b);

export function remoteProviderMetadata(item:Pick<RemoteItem,'repository_id'|'delivery_kind'>) {
 return item.delivery_kind==='github_pr'?{github:{repository_id:item.repository_id!}}:{};
}
