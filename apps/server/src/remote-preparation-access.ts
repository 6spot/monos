import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database,Transaction} from '../../../packages/db/src/index.ts';
import {repositoryAdapter} from '../../../packages/domain/src/repositories.ts';
import {GitHTTPSCredentials,gitHTTPSCredentialScope,verifyGitHTTPSCredentialReceipt} from './git-https-credentials.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {PublicationPermissionProof,PublicationPermissionRequest,PublicationPermissionResult,PublicationAccessRequest,PublicationAccessResult,PublicationPushRequest} from '../../../packages/protocol/src/index.ts';
import type {BoundaryService} from './service.ts';
import type {DeliveryOperation} from './publication-candidates.ts';
import {ensureLocalCandidate} from './publication-candidates.ts';
import {permissionConfigurationFingerprint,publicationPermissionCurrent,publicationDigest as hash} from './publication-policy.ts';
import {lockConfiguration} from './configuration-guards.ts';
import type {GitHubRemote} from './github-remote.ts';
import {remoteProfile} from './github-remote.ts';
import {remoteProviderMetadata,same,remoteScope,reserveRemoteProvider,releaseRemoteProvider,appendRemoteObservation} from './remote-preparation-state.ts';
import type {RemoteItem,RemoteOperation} from './remote-preparation-state.ts';
import {RemoteAdmissionError} from './remote-preparation-guards.ts';
import {remoteSourceAdmission,remoteAdmissionForOperation} from './owner-delivery-guards.ts';

async function channel(tx:Transaction,service:Pick<BoundaryService,'instanceId'>,runnerId:string,incarnation:number):Promise<void> {
 const row=(await tx.query<{ok:boolean}>('SELECT connected AND ready AND incarnation=$2 AND connection_instance=$3 AND last_seen>clock_timestamp()-interval \'15 seconds\' ok FROM runners WHERE id=$1 FOR UPDATE',[runnerId,incarnation,service.instanceId])).rows[0];
 if(!row?.ok)throw new CommandError('stale_execution','Remote Runner channel changed');
}
export async function observePublicationPermission(db:Database,provider:GitHubRemote,operationId:string):Promise<PublicationPermissionProof> {
 const plain=await transaction(db,async tx=>{
  await lockConfiguration(tx);
  const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1',[operationId])).rows[0];
  if(!op)throw new CommandError('denied_scope','Unknown publication operation');
  await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[op.task_id]);
  const resource=(await tx.query('SELECT repository_identity,remote_url FROM project_resources WHERE id=$1',[op.resource_id])).rows[0];
  if(repositoryAdapter(resource.remote_url)==='github')return;
  await remoteSourceAdmission(tx,{task_id:op.task_id,resource_id:op.resource_id,repository_identity:resource.repository_identity,repository_id:null},op.request,'permission');
  const scope=await gitHTTPSCredentialScope(tx,op.resource_id);
  if(!scope||!await verifyGitHTTPSCredentialReceipt(tx,scope))throw new RemoteAdmissionError('credentials_missing');
  const fingerprint=await permissionConfigurationFingerprint(tx,op.resource_id);
  const retained=(await tx.query<{proof:PublicationPermissionProof}>("SELECT proof FROM publication_permission_observations WHERE resource_id=$1 AND configuration_fingerprint=$2 AND expires_at>clock_timestamp()+interval '30 seconds' ORDER BY observed_at DESC,id DESC LIMIT 1",[op.resource_id,fingerprint])).rows[0]?.proof;
  if(retained)return retained;
  const proof=validate<PublicationPermissionProof>('PublicationPermissionProof',{schema_version:1,kind:'git_https_configuration',observation_id:randomUUID(),resource_id:scope.resource_id,repository_identity:scope.repository_identity,remote_url:scope.remote_url,username:scope.username,configuration_request_id:scope.configuration_request_id,scope_digest:scope.scope_digest,configuration_fingerprint:fingerprint,permission_fingerprint:hash({kind:'git_https_configuration',scope_digest:scope.scope_digest}),observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+300_000).toISOString()});
  await tx.query('INSERT INTO publication_permission_observations(id,resource_id,repository_identity,repository_id,configuration_fingerprint,permission_fingerprint,proof,proof_digest,observed_at,expires_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9)',[proof.observation_id,proof.resource_id,proof.repository_identity,proof.configuration_fingerprint,proof.permission_fingerprint,proof,hash(proof),proof.observed_at,proof.expires_at]);
  const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE task_id=$1 AND resource_id=$2 FOR UPDATE',[op.task_id,op.resource_id])).rows[0];
  if(item){await appendRemoteObservation(tx,item,null,'checks',{permission_observed:hash(proof),observed_at:proof.observed_at});await tx.query('UPDATE remote_preparation_items SET poll_progress=NULL,next_poll_at=clock_timestamp() WHERE item_id=$1',[item.item_id]);}
  await ensureLocalCandidate(tx,op.task_id);return proof;
 });
 if(plain)return plain;
 const snapshot=()=>transaction(db,async tx=>{
  await lockConfiguration(tx);const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1',[operationId])).rows[0];if(!op)throw new CommandError('denied_scope','Unknown publication operation');
  await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[op.task_id]);
  const r=(await tx.query<{id:string;repository_identity:string;remote_url:string;settings:{provider_repo_id?:string}}>('SELECT * FROM project_resources WHERE id=$1',[op.resource_id])).rows[0];
  if(!r?.settings.provider_repo_id)throw new RemoteAdmissionError('credentials_missing');
  const binding={task_id:op.task_id,resource_id:op.resource_id,repository_identity:r.repository_identity,repository_id:r.settings.provider_repo_id};await remoteSourceAdmission(tx,binding,op.request,'permission');
  // A permission refresh may precede the next scan, but its workflow scope
  // comes from a verified complete scan of this exact source/range. A broader
  // old grant or absence of a finding is never evidence about changed paths.
  const scan=op.result?.scan??(await tx.query<{summary:{status:string;workflow_changes?:boolean}}>(`SELECT s.summary FROM publication_scans s JOIN delivery_operations o ON o.id=s.operation_id WHERE o.task_id=$1 AND o.request->>'source_digest'=$2 AND o.request->>'effective_basis_digest'=$3 AND o.request->>'construction_digest'=$4 AND (o.request->>'published_digest') IS NOT DISTINCT FROM $5 ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,[op.task_id,op.request.source_digest,op.request.effective_basis_digest,op.request.construction_digest,op.request.published_digest??null])).rows[0]?.summary;
  const workflows=scan?.status==='complete'&&scan.workflow_changes===true;
  const scope=await remoteScope(tx,{...binding,remote_url:r.remote_url},workflows);if(!scope.config)throw new RemoteAdmissionError('credentials_missing');
  const fingerprint=await permissionConfigurationFingerprint(tx,op.resource_id);
  const retained=(await tx.query<{proof:PublicationPermissionProof}>("SELECT proof FROM publication_permission_observations WHERE resource_id=$1 AND configuration_fingerprint=$2 AND expires_at>clock_timestamp()+interval '30 seconds' AND proof->'permissions'=$3::jsonb ORDER BY observed_at DESC,id DESC LIMIT 1",[op.resource_id,fingerprint,remoteProfile(scope,'permission')])).rows[0]?.proof;
  return {op,scope,fingerprint,retained};
 });
 const before=await snapshot();if(before.retained)return before.retained;
 const reservation=await transaction(db,tx=>reserveRemoteProvider(tx,before.scope));
 let grant;let failure:unknown;
 try{grant=await provider.grant(before.scope,'permission');}catch(error){failure=error;throw error;}finally{await transaction(db,tx=>releaseRemoteProvider(tx,before.scope,reservation,failure));}
 const proof=validate<PublicationPermissionProof>('PublicationPermissionProof',{schema_version:1,kind:'github_installation',observation_id:randomUUID(),resource_id:before.op.resource_id,repository_identity:before.scope.repository_identity,repository_id:before.scope.repository_id,app_id:before.scope.config!.app_id,installation_id:before.scope.config!.installation_id,key_fingerprint:before.scope.config!.key_fingerprint,configuration_fingerprint:before.fingerprint,permissions:grant.permissions,permission_fingerprint:hash({configuration_fingerprint:before.fingerprint,repository_id:before.scope.repository_id,permissions:grant.permissions}),observed_at:new Date().toISOString(),expires_at:grant.expires_at});
 return transaction(db,async tx=>{
  await lockConfiguration(tx);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[before.op.task_id]);
  await remoteSourceAdmission(tx,{task_id:before.op.task_id,...before.scope},before.op.request,'permission');
  if(await permissionConfigurationFingerprint(tx,before.op.resource_id)!==before.fingerprint)throw new RemoteAdmissionError('configuration_changed');
  await tx.query('INSERT INTO publication_permission_observations(id,resource_id,repository_identity,repository_id,configuration_fingerprint,permission_fingerprint,proof,proof_digest,observed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[proof.observation_id,proof.resource_id,proof.repository_identity,proof.repository_id,proof.configuration_fingerprint,proof.permission_fingerprint,proof,hash(proof),proof.observed_at,proof.expires_at]);
  const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE task_id=$1 AND resource_id=$2 FOR UPDATE',[before.op.task_id,before.op.resource_id])).rows[0];
  if(item){await appendRemoteObservation(tx,item,null,'checks',{permission_observed:hash(proof),observed_at:proof.observed_at});await tx.query('UPDATE remote_preparation_items SET poll_progress=NULL,next_poll_at=clock_timestamp() WHERE item_id=$1',[item.item_id]);}
  await ensureLocalCandidate(tx,before.op.task_id);return proof;
 });
}

export class RemotePreparationAccess {
 readonly service:BoundaryService;readonly provider:GitHubRemote;
 constructor(service:BoundaryService,provider:GitHubRemote) {this.service=service;this.provider=provider;}
 async permission(token:string,operationId:string,input:unknown):Promise<PublicationPermissionResult> {
  validate('Id',operationId);const request=validate<PublicationPermissionRequest>('PublicationPermissionRequest',input),runnerId=await this.service.authenticateRunner(token);
  const authorized=()=>transaction(this.service.db,async tx=>{await lockConfiguration(tx);await channel(tx,this.service,runnerId,request.incarnation);const op=(await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE id=$1 AND runner_id=$2',[operationId,runnerId])).rows[0];if(!op)throw new CommandError('denied_scope','Unknown publication operation');if(op.request_digest!==request.request_digest)throw new CommandError('payload_conflict','Permission request differs');return op;});
  const op=await authorized(),proof=await observePublicationPermission(this.service.db,this.provider,operationId);await authorized();
  if(op.request.permission_proof&&op.request.permission_proof.permission_fingerprint!==proof.permission_fingerprint)throw new RemoteAdmissionError('configuration_changed');
  return validate('PublicationPermissionResult',{schema_version:1,operation_id:operationId,request_digest:request.request_digest,proof,proof_digest:hash(proof)});
 }
 async access(token:string,operationId:string,input:unknown):Promise<PublicationAccessResult> {
  validate('Id',operationId);const request=validate<PublicationAccessRequest>('PublicationAccessRequest',input),runnerId=await this.service.authenticateRunner(token);
  const plain=await this.plainAccess(runnerId,operationId,request);if(plain)return plain;
  const snapshot=async(phase:'prepare'|'claim'|'verify'='prepare',expectedScope?:Awaited<ReturnType<typeof remoteScope>>)=>transaction(this.service.db,async tx=>{
   await lockConfiguration(tx);await channel(tx,this.service,runnerId,request.incarnation);
   const located=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 AND runner_id=$2',[operationId,runnerId])).rows[0];if(!located||located.kind!=='push')throw new CommandError('denied_scope','Unknown remote push');
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[located.task_id]);
   const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[located.item_id])).rows[0]!,op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 FOR UPDATE',[operationId])).rows[0]!;
   const push=validate<PublicationPushRequest>('PublicationPushRequest',op.request);if(op.request_digest!==request.request_digest||hash(push)!==request.request_digest)throw new CommandError('payload_conflict','Remote access request differs');
   const scope=await remoteScope(tx,item,push.workflow_changes);
   if(expectedScope&&(scope.config?.app_id!==expectedScope.config?.app_id||scope.config?.installation_id!==expectedScope.config?.installation_id||scope.config?.key_fingerprint!==expectedScope.config?.key_fingerprint||scope.repository_id!==expectedScope.repository_id||scope.repository_identity!==expectedScope.repository_identity||scope.workflow_changes!==expectedScope.workflow_changes))throw new RemoteAdmissionError('configuration_changed');
   let reservation:Date|undefined;
   if(request.purpose==='push') {
    if(!op.active||op.reconcile_only||item.cancel_requested||phase!=='verify'&&op.state!=='pending'||phase==='verify'&&(op.state!=='started'||op.claim_id!==request.attempt_id||op.claim_instance!==this.service.instanceId||Number(op.sent_incarnation)!==request.incarnation))throw new RemoteAdmissionError('possible_publication');
    await remoteAdmissionForOperation(tx,item,push.preparation,push.prepared,op.id);
    if(typeof push.prepared.scan!.workflow_changes!=='boolean'||push.workflow_changes!==push.prepared.scan!.workflow_changes)throw new RemoteAdmissionError('identity_mismatch');
    if(phase==='claim') {
     // Waiting for the installation is scheduling, before any possible effect.
     // Reserve and claim atomically so spacing cannot strand a started operation.
     reservation=await reserveRemoteProvider(tx,scope);
     await tx.query("UPDATE remote_preparation_operations SET state='started',effect_owned=true,may_have_mutated=true,worker_absent=false,claim_id=$2,claim_instance=$3,sent_incarnation=$4,claim_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 WHERE id=$1",[op.id,request.attempt_id,this.service.instanceId,request.incarnation]);
    }
   }
   return {item,op,push,scope,reservation};
  });
  const before=await snapshot();let claimed=false;
  try {
   let proof:PublicationPermissionProof|undefined;
   if(request.purpose==='push') {
    proof=await observePublicationPermission(this.service.db,this.provider,before.push.preparation.operation_id);
    if(proof.permission_fingerprint!==before.push.permission_proof.permission_fingerprint)throw new RemoteAdmissionError('configuration_changed');
   }
   let reservation:Date|undefined;
   if(request.purpose==='push'){reservation=(await snapshot('claim',before.scope)).reservation;claimed=true;}
   else reservation=await transaction(this.service.db,tx=>reserveRemoteProvider(tx,before.scope));
   let failure:unknown;let grant;
   try{grant=await this.provider.grant(before.scope,request.purpose==='push'?'push':'observe');}catch(error){failure=error;throw error;}finally{await transaction(this.service.db,tx=>releaseRemoteProvider(tx,before.scope,reservation,failure));}
   const after=await snapshot('verify',before.scope);
   if(after.scope.config?.app_id!==before.scope.config?.app_id||after.scope.config?.installation_id!==before.scope.config?.installation_id||after.scope.config?.key_fingerprint!==before.scope.config?.key_fingerprint||after.scope.repository_id!==before.scope.repository_id||after.scope.repository_identity!==before.scope.repository_identity||after.scope.workflow_changes!==before.scope.workflow_changes)throw new RemoteAdmissionError('configuration_changed');
   return validate('PublicationAccessResult',{schema_version:1,operation_id:operationId,request_digest:request.request_digest,item_id:before.item.item_id,purpose:request.purpose,attempt_id:request.attempt_id,remote_url:before.item.remote_url,provider_metadata:remoteProviderMetadata(before.item),delivery_ref:before.item.delivery_ref,candidate_head:before.push.prepared.candidate!.head,expected_head:before.push.expected_head,authentication:{kind:'github_installation',token:grant.token,expires_at:grant.expires_at},...(proof?{claim_id:request.attempt_id,claim_expires_at:after.op.claim_expires_at!.toISOString(),permission_proof:proof,permission_proof_digest:hash(proof)}:{})});
  }catch(e){
   if(claimed)await this.service.db.pool.query("UPDATE remote_preparation_operations SET reconcile_only=true,reason='access_denied',version=version+1 WHERE id=$1 AND state NOT IN ('settled','revoked')",[operationId]);
   if(e instanceof CommandError)throw e;throw new RemoteAdmissionError('access_denied');
  }
 }
 private async plainAccess(runnerId:string,operationId:string,request:PublicationAccessRequest):Promise<PublicationAccessResult|undefined> {
  return transaction(this.service.db,async tx=>{
   await lockConfiguration(tx);await channel(tx,this.service,runnerId,request.incarnation);
   const located=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 AND runner_id=$2',[operationId,runnerId])).rows[0];
   if(!located||located.kind!=='push')throw new CommandError('denied_scope','Unknown remote push');
   await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[located.task_id]);
   const item=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[located.item_id])).rows[0]!;
   if(item.delivery_kind!=='git_branch')return;
   const op=(await tx.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE id=$1 FOR UPDATE',[operationId])).rows[0]!,push=validate<PublicationPushRequest>('PublicationPushRequest',op.request);
   if(op.request_digest!==request.request_digest||hash(push)!==request.request_digest||push.remote_url!==item.remote_url||!same(push.provider_metadata,{}))throw new CommandError('payload_conflict','Remote access request differs');
   const current=(await tx.query('SELECT repository_identity,remote_url FROM project_resources WHERE id=$1',[item.resource_id])).rows[0];
   if(!current||current.remote_url!==item.remote_url||current.repository_identity!==item.repository_identity)throw new RemoteAdmissionError('configuration_changed');
   const scope=await gitHTTPSCredentialScope(tx,item.resource_id);let proof=push.permission_proof;
   if(proof.kind!=='git_https_configuration')throw new RemoteAdmissionError('identity_mismatch');
   if(request.purpose==='push') {
    if(!op.active||op.reconcile_only||item.cancel_requested||op.state!=='pending')throw new RemoteAdmissionError('possible_publication');
    await remoteAdmissionForOperation(tx,item,push.preparation,push.prepared,op.id);
    if(!await publicationPermissionCurrent(tx,item.resource_id,proof,push.workflow_changes)||typeof push.prepared.scan?.workflow_changes!=='boolean'||push.workflow_changes!==push.prepared.scan.workflow_changes)throw new RemoteAdmissionError('configuration_changed');
   }
   if(request.purpose==='push'&&Date.parse(proof.expires_at)<Date.now()+30_000){
    proof=validate('PublicationPermissionProof',{...proof,observation_id:randomUUID(),observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+300_000).toISOString()});
    await tx.query('INSERT INTO publication_permission_observations(id,resource_id,repository_identity,repository_id,configuration_fingerprint,permission_fingerprint,proof,proof_digest,observed_at,expires_at) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9)',[proof.observation_id,proof.resource_id,proof.repository_identity,proof.configuration_fingerprint,proof.permission_fingerprint,proof,hash(proof),proof.observed_at,proof.expires_at]);
   }
   // Recovery may try an anonymous read after clearing a credential. A changed
   // configured identity can never silently acquire the old push's authority.
   const authentication=await new GitHTTPSCredentials(this.service.options.signingKey).authentication(tx,item.resource_id,request.purpose==='push'||scope?proof.scope_digest:undefined);
   let claimExpires:Date|undefined;
   if(request.purpose==='push')claimExpires=(await tx.query<{claim_expires_at:Date}>("UPDATE remote_preparation_operations SET state='started',effect_owned=true,may_have_mutated=true,worker_absent=false,claim_id=$2,claim_instance=$3,sent_incarnation=$4,claim_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 WHERE id=$1 RETURNING claim_expires_at",[op.id,request.attempt_id,this.service.instanceId,request.incarnation])).rows[0]!.claim_expires_at;
   return validate('PublicationAccessResult',{schema_version:1,operation_id:op.id,request_digest:op.request_digest,item_id:item.item_id,purpose:request.purpose,attempt_id:request.attempt_id,remote_url:item.remote_url,provider_metadata:{},delivery_ref:item.delivery_ref,candidate_head:push.prepared.candidate!.head,expected_head:push.expected_head,authentication,...(claimExpires?{claim_id:request.attempt_id,claim_expires_at:claimExpires.toISOString(),permission_proof:proof,permission_proof_digest:hash(proof)}:{})});
  });
 }

}
