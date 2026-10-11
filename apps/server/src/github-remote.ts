import {randomUUID} from 'node:crypto';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {PublicationRefObservation,PublicationPushRequest,RemotePreparationProviderRequest,RemotePreparationReview,RemotePreparationCheck} from '../../../packages/protocol/src/index.ts';
import {repositoryIdentity} from '../../../packages/domain/src/repositories.ts';
import {GitHubRequestError,githubExpiry,githubSecondaryLimit} from './github.ts';
import type {GitHub,GitHubCredentials} from './github.ts';
import {publicationDigest as hash} from './publication-policy.ts';

export type GitHubRemoteProfile='permission'|'observe'|'push'|'review'|'poll'|'readiness'|'merge'|'reconcile';
export interface GitHubRemoteScope {resource_id:string;repository_identity:string;repository_id:string;remote_url:string;config?:GitHubCredentials;workflow_changes:boolean}
export interface GitHubRemoteGrant {token:string;expires_at:string;repository_id:string;permissions:Record<string,'read'|'write'>}
export type AcquireGitHubRemoteGrant=(scope:GitHubRemoteScope,profile:GitHubRemoteProfile)=>Promise<GitHubRemoteGrant>;
export type RemoteReviewIntent=Pick<RemotePreparationProviderRequest,'item_id'|'delivery_ref'|'target_branch'|'kind'|'review'|'content'>;
export type RemoteRefIntent=Pick<PublicationPushRequest,'operation_id'|'item_id'|'task_id'|'resource_id'|'runner_id'|'storage_id'|'repository_identity'|'provider_metadata'|'delivery_ref'>;
export interface ProviderBudget {remaining:number}
export class RemoteProviderError extends Error {
 readonly reason:'credentials_missing'|'access_denied'|'rate_limited'|'provider_unavailable'|'invalid_provider_response'|'ambiguous_pr'|'unexpected_head'|'pr_missing';readonly cooldown_ms:number;
 constructor(reason:RemoteProviderError['reason'],cooldown_ms=0) {super(reason);this.reason=reason;this.cooldown_ms=cooldown_ms;}
}
export class ProviderTurnComplete extends Error {}
export interface RemoteReviewSnapshot {review:RemotePreparationReview;head:string;base_head:string;content_digest:string;mergeability:'mergeable'|'conflicting'|'unknown'}
const oid=(v:unknown):v is string=>typeof v==='string'&&/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function invalid():never {throw new RemoteProviderError('invalid_provider_response');}
function object(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
export const remoteProfile=(scope:GitHubRemoteScope,profile:GitHubRemoteProfile):Record<string,'read'|'write'>=>profile==='merge'?{contents:'write',metadata:'read'}:profile==='readiness'?{contents:'read',metadata:'read',pull_requests:'read',checks:'read',statuses:'read',administration:'read'}:profile==='reconcile'?{contents:'read',metadata:'read',pull_requests:'read'}:profile==='permission'||profile==='push'?{contents:'write',metadata:'read',...(scope.workflow_changes?{workflows:'write' as const}:{})}:profile==='review'?{contents:'read',metadata:'read',pull_requests:'write'}:profile==='poll'?{contents:'read',metadata:'read',pull_requests:'read',checks:'read',statuses:'read'}:{contents:'read',metadata:'read'};

export class GitHubRemote {
 readonly fetcher:typeof fetch;readonly acquireGrant:AcquireGitHubRemoteGrant;
 constructor(github:GitHub,options:{fetcher?:typeof fetch;acquireGrant?:AcquireGitHubRemoteGrant}={}) {
  this.fetcher=options.fetcher??fetch;
  this.acquireGrant=options.acquireGrant??(async(scope,profile)=>{
   if(!scope.config)throw new RemoteProviderError('credentials_missing');
   try{return await github.installationGrant(scope.config,scope.repository_id,scope.repository_identity,remoteProfile(scope,profile));}
   catch(e){if(e instanceof GitHubRequestError)throw new RemoteProviderError(e.retry_after_ms?'rate_limited':e.status===401||e.status===403?'access_denied':'provider_unavailable',e.retry_after_ms);throw new RemoteProviderError('access_denied');}
  });
 }
 prefix(scope:GitHubRemoteScope):string {
  if(!/^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(scope.repository_identity)||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(scope.remote_url)||repositoryIdentity(scope.remote_url)!==scope.repository_identity||!/^[1-9][0-9]{0,15}$/.test(scope.repository_id)||!positive(Number(scope.repository_id)))invalid();
  return '/repos/'+scope.repository_identity.slice('github.com/'.length);
 }
 async grant(scope:GitHubRemoteScope,profile:GitHubRemoteProfile,budget?:ProviderBudget):Promise<GitHubRemoteGrant> {
  this.prefix(scope);if(budget){if(budget.remaining<1)throw new ProviderTurnComplete();budget.remaining--;}
  const grant=await this.acquireGrant(scope,profile),expected=remoteProfile(scope,profile);
  if(!grant||grant.repository_id!==scope.repository_id||typeof grant.token!=='string'||!grant.token||grant.token.length>4096||!Number.isFinite(githubExpiry(grant.expires_at))||githubExpiry(grant.expires_at)<=Date.now()+30_000||githubExpiry(grant.expires_at)>Date.now()+7200_000||canonicalJSON(grant.permissions)!==canonicalJSON(expected))invalid();
  return grant;
 }
 async request(scope:GitHubRemoteScope,path:string,grant:GitHubRemoteGrant,budget?:ProviderBudget,method='GET',body?:unknown,etag?:string):Promise<{status:number;data:unknown;etag?:string}> {
  if(!path.startsWith(this.prefix(scope)+'/')&&! (path===this.prefix(scope)))invalid();
  if(budget){if(budget.remaining<1)throw new ProviderTurnComplete();budget.remaining--;}
  try {
   const response=await this.fetcher('https://api.github.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(10_000),headers:{Authorization:'Bearer '+grant.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'monos',...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-None-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(response.status===304||response.status===404&&method==='GET'){await response.body?.cancel();return {status:response.status,data:null};}
   if(!response.ok){const secondary=await githubSecondaryLimit(response);const retry=response.headers.get('retry-after'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
    let delay=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now()):response.headers.get('x-ratelimit-remaining')==='0'?reset-Date.now():0;
    const rate=response.status===429||response.status===403&&(secondary||retry!==null||response.headers.get('x-ratelimit-remaining')==='0');if(rate)delay=Math.max(60_000,delay||0);
    throw new RemoteProviderError(rate?'rate_limited':response.status===401||response.status===403?'access_denied':'provider_unavailable',Math.max(0,Math.min(86400_000,Number.isFinite(delay)?delay:60_000)));
   }
   if(!response.body)invalid();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try {while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1024*1024)invalid();chunks.push(chunk.value);}}finally{await reader.cancel();}
   const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;canonicalJSON(data);
   const tag=response.headers.get('etag');return {status:response.status,data,...(tag&&tag.length<=512?{etag:tag}:{})};
  }catch(e){if(e instanceof RemoteProviderError||e instanceof ProviderTurnComplete)throw e;throw new RemoteProviderError('provider_unavailable');}
 }
 async observeRef(scope:GitHubRemoteScope,request:RemoteRefIntent,grant:GitHubRemoteGrant,budget?:ProviderBudget):Promise<PublicationRefObservation> {
  const reply=await this.request(scope,this.prefix(scope)+'/git/ref/'+request.delivery_ref.slice(5).split('/').map(encodeURIComponent).join('/'),grant,budget);
  const facts={schema_version:1,observation_id:randomUUID(),operation_id:request.operation_id,item_id:request.item_id,task_id:request.task_id,resource_id:request.resource_id,runner_id:request.runner_id,storage_id:request.storage_id,repository_identity:request.repository_identity,provider_metadata:request.provider_metadata,delivery_ref:request.delivery_ref,observed_at:new Date().toISOString()};
  if(reply.status===404)return validate('PublicationRefObservation',{...facts,status:'absent'});
  const raw=reply.data as {ref?:unknown;object?:{type?:unknown;sha?:unknown}};
  if(raw?.ref!==request.delivery_ref||raw.object?.type!=='commit'||!oid(raw.object.sha))invalid();
  return validate('PublicationRefObservation',{...facts,status:'present',head:raw.object.sha});
 }
 snapshot(scope:GitHubRemoteScope,intent:Pick<RemotePreparationProviderRequest,'delivery_ref'|'target_branch'|'item_id'>,raw:unknown):RemoteReviewSnapshot {
  if(!raw||typeof raw!=='object')invalid();const p=object(raw),head=object(p.head),base=object(p.base),headRepo=object(head.repo),baseRepo=object(base.repo),marker=`<!-- monos-delivery-item:${intent.item_id} -->`;
  if(!positive(p.id)||!positive(p.number)||!positive(headRepo.id)||!positive(baseRepo.id)||typeof p.title!=='string'||[...p.title].length>256||typeof p.body!=='string'||Buffer.byteLength(p.body)>64*1024||!p.body.includes(marker)||head?.ref!==intent.delivery_ref.slice(11)||base?.ref!==intent.target_branch||String(headRepo.id)!==scope.repository_id||String(baseRepo.id)!==scope.repository_id||!oid(head.sha)||!oid(base.sha)||!['open','closed'].includes(String(p.state))||p.html_url!==`https://github.com/${scope.repository_identity.slice(11)}/pull/${p.number}`)invalid();
  if(p.merged_at!==null&&p.merged_at!==undefined&&(typeof p.merged_at!=='string'||!Number.isFinite(Date.parse(p.merged_at))))invalid();
  const state=p.merged_at?'merged':p.state==='open'?'open':'closed';
  return {review:validate('RemotePreparationReview',{repository_id:scope.repository_id,pr_id:String(p.id),pr_number:p.number,url:p.html_url,head_ref:head.ref,base_ref:base.ref,marker,state}),head:head.sha,base_head:base.sha,content_digest:hash({title:p.title,body:p.body}),mergeability:p.mergeable===true?'mergeable':p.mergeable===false?'conflicting':'unknown'};
 }
 async findReviewPage(scope:GitHubRemoteScope,intent:RemoteReviewIntent,grant:GitHubRemoteGrant,page:number,budget?:ProviderBudget):Promise<{items:RemoteReviewSnapshot[];more:boolean}> {
  if(!Number.isInteger(page)||page<1||page>10)invalid();const owner=scope.repository_identity.slice(11).split('/')[0]!;
  const query=new URLSearchParams({state:'all',head:owner+':'+intent.delivery_ref.slice(11),base:intent.target_branch,per_page:'100',page:String(page)});
  const reply=await this.request(scope,this.prefix(scope)+'/pulls?'+query,grant,budget);if(!Array.isArray(reply.data)||reply.data.length>100)invalid();
  return {items:reply.data.map(p=>this.snapshot(scope,intent,p)),more:reply.data.length===100};
 }
 async review(scope:GitHubRemoteScope,intent:RemoteReviewIntent,grant:GitHubRemoteGrant,budget?:ProviderBudget):Promise<RemoteReviewSnapshot> {
  if(!intent.review)invalid();const reply=await this.request(scope,this.prefix(scope)+'/pulls/'+intent.review.pr_number,grant,budget);if(reply.status===404)throw new RemoteProviderError('pr_missing');const snap=this.snapshot(scope,intent,reply.data);
  if(snap.review.pr_id!==intent.review.pr_id||snap.review.pr_number!==intent.review.pr_number)invalid();return snap;
 }
 async mutate(scope:GitHubRemoteScope,intent:RemoteReviewIntent,grant:GitHubRemoteGrant,budget?:ProviderBudget):Promise<RemoteReviewSnapshot> {
  const create=intent.kind==='create_pr';const body=intent.kind==='close_pr'?{state:'closed'}:create?{title:intent.content!.title,body:intent.content!.body,head:intent.delivery_ref.slice(11),base:intent.target_branch}:{title:intent.content!.title,body:intent.content!.body};
  const reply=await this.request(scope,this.prefix(scope)+'/pulls'+(create?'':'/'+intent.review!.pr_number),grant,budget,create?'POST':'PATCH',body);
  const snap=this.snapshot(scope,intent,reply.data);if(!create&&(snap.review.pr_id!==intent.review!.pr_id||snap.review.pr_number!==intent.review!.pr_number))invalid();return snap;
 }
 async checkPage(scope:GitHubRemoteScope,head:string,kind:'check_run'|'status',page:number,grant:GitHubRemoteGrant,budget?:ProviderBudget,retained?:{etag:string;items:RemotePreparationCheck[];more:boolean;total?:number}):Promise<{items:RemotePreparationCheck[];more:boolean;total?:number;etag?:string}> {
  if(!oid(head)||page<1||page>10||!Number.isInteger(page))invalid();const reply=await this.request(scope,this.prefix(scope)+`/commits/${head}/`+(kind==='check_run'?'check-runs':'statuses')+`?per_page=100&page=${page}`,grant,budget,'GET',undefined,retained?.etag);
  const countMatches=(count:number,total:unknown,more:boolean)=>Number.isSafeInteger(total)&&Number(total)>=0&&count===Math.max(0,Math.min(100,Number(total)-(page-1)*100))&&more===(page*100<Number(total));
  if(reply.status===304){if(!retained||retained.items.length>100||retained.items.some(c=>c.head!==head||c.kind!==kind)||kind==='check_run'&&!countMatches(retained.items.length,retained.total,retained.more))invalid();retained.items.forEach(c=>validate('RemotePreparationCheck',c));return retained;}
  const result=kind==='check_run'?object(reply.data):{},entries=kind==='check_run'?result.check_runs:reply.data;if(!Array.isArray(entries)||entries.length>100||kind==='check_run'&&(!Number.isSafeInteger(result.total_count)||Number(result.total_count)<0))invalid();
  if(kind==='check_run'&&!countMatches(entries.length,result.total_count,page*100<Number(result.total_count)))invalid();
  const items=entries.map((value:unknown)=>{const p=object(value);if(!positive(p.id)||typeof (kind==='status'?p.context:p.name)!=='string')invalid();let state:RemotePreparationCheck['state'];
   if(kind==='status'){if(!['pending','success','failure','error'].includes(String(p.state)))invalid();state=p.state==='error'||p.state==='failure'?'failure':p.state==='success'?'success':'pending';}
   else {if(p.head_sha!==head||!['queued','in_progress','completed','waiting','requested','pending'].includes(String(p.status)))invalid();state=p.status!=='completed'?'pending':p.conclusion==='success'?'success':['failure','timed_out','action_required','startup_failure'].includes(String(p.conclusion))?'failure':p.conclusion==='neutral'?'neutral':p.conclusion==='skipped'?'skipped':p.conclusion==='cancelled'?'cancelled':'unknown';}
   return validate<RemotePreparationCheck>('RemotePreparationCheck',{kind,provider_id:p.id,head,name:kind==='status'?p.context:p.name,state,...(kind==='check_run'&&typeof p.conclusion==='string'&&['success','failure','neutral','cancelled','skipped','timed_out','action_required','startup_failure','stale'].includes(p.conclusion)?{conclusion:p.conclusion}:{})});});
  return {items,more:kind==='check_run'?page*100<Number(result.total_count):entries.length===100,...(kind==='check_run'?{total:Number(result.total_count)}:{}),...(reply.etag?{etag:reply.etag}:{})};
 }
}
