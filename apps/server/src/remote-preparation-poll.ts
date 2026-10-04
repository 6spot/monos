import {randomUUID} from 'node:crypto';
import {transaction} from '../../../packages/db/src/index.ts';
import type {Database} from '../../../packages/db/src/index.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {RemotePreparationCheck,RemotePreparationChecks} from '../../../packages/protocol/src/index.ts';
import type {GitHubRemote,GitHubRemoteScope,ProviderBudget} from './github-remote.ts';
import {appendRemoteObservation} from './remote-preparation-state.ts';
import type {RemoteItem} from './remote-preparation-state.ts';
import {remoteReview} from './remote-preparation.ts';
import {RemoteProviderError} from './github-remote.ts';
import {publicationDigest as hash} from './publication-policy.ts';

type CachedPage={etag:string;items:RemotePreparationCheck[];more:boolean;total?:number};
interface Progress {kind:'checks';scope:string;head:string;base_head:string;collection:'check_run'|'status';page:number;items:RemotePreparationCheck[];complete:boolean;check_run_total?:number;cache:Record<string,CachedPage>}
export async function pollRemoteChecks(db:Database,provider:GitHubRemote,item:RemoteItem,scope:GitHubRemoteScope,budget:ProviderBudget):Promise<void> {
 const intent={item_id:item.item_id,delivery_ref:item.delivery_ref,target_branch:item.target_branch,kind:'update_pr' as const,review:remoteReview(item)},grant=await provider.grant(scope,'poll',budget);
 const before=await provider.review(scope,intent,grant,budget),configuration=hash({app_id:scope.config?.app_id,installation_id:scope.config?.installation_id,key_fingerprint:scope.config?.key_fingerprint}),binding=hash({repository_id:item.repository_id,review:before.review,head:before.head,base:before.base_head,configuration});
 const retained=item.poll_progress as unknown as Progress|null;
 const prior=(await db.pool.query<{observation:{scope_digest:string;cache?:Record<string,CachedPage>;merge_unknown_count?:number}}>("SELECT observation FROM remote_preparation_observations WHERE item_id=$1 AND kind='checks' ORDER BY created_at DESC,id DESC LIMIT 1",[item.item_id])).rows[0]?.observation;
 const progress:Progress=retained?.kind==='checks'&&retained.scope===binding&&(retained.check_run_total!==undefined||retained.collection==='check_run'&&retained.page===1)?retained:{kind:'checks',scope:binding,head:before.head,base_head:before.base_head,collection:'check_run',page:1,items:[],complete:false,cache:prior?.scope_digest===binding?prior.cache??{}:{}};
 let finished=false,incomplete=false;
 while(budget.remaining>1) {
  const key=progress.collection+':'+progress.page,page=await provider.checkPage(scope,before.head,progress.collection,progress.page,grant,budget,progress.cache[key]);
  if(progress.collection==='check_run'){
   if(progress.check_run_total!==undefined&&progress.check_run_total!==page.total){await db.pool.query('UPDATE remote_preparation_items SET poll_progress=NULL WHERE item_id=$1',[item.item_id]);throw new RemoteProviderError('invalid_provider_response');}
   progress.check_run_total=page.total;
  }
  progress.items.push(...page.items);
  if(page.etag)progress.cache[key]={...page,etag:page.etag};
  if(page.more){if(progress.page===10){incomplete=true;finished=true;break;}progress.page++;}
  else if(progress.collection==='check_run'){progress.collection='status';progress.page=1;}
  else {finished=true;break;}
 }
 if(!finished){await db.pool.query("UPDATE remote_preparation_items SET poll_progress=$2,next_poll_at=clock_timestamp()+interval '1 second' WHERE item_id=$1",[item.item_id,progress]);return;}
 const after=await provider.review(scope,intent,grant,budget);
 const fresh=after.head===before.head&&after.base_head===before.base_head&&after.review.state===before.review.state;
 const latest=new Map<string,RemotePreparationCheck>();for(const check of progress.items){const key=check.kind+':'+check.name,old=latest.get(key);if(!old||check.provider_id>old.provider_id)latest.set(key,check);}
 const checks=[...latest.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name)||a.provider_id-b.provider_id);
 const states=checks.map(c=>c.state),complete=!incomplete&&fresh;
 const aggregate:RemotePreparationChecks['aggregate']=!complete?'incomplete':!checks.length?'no_checks':states.includes('failure')?'failure':states.includes('pending')?'pending':states.every(s=>s==='success')?'success':'unknown';
 const observation=validate<RemotePreparationChecks>('RemotePreparationChecks',{observation_id:randomUUID(),head:before.head,base_head:before.base_head,observed_at:new Date().toISOString(),complete,current:complete&&item.last_published_proof?.candidate.head===before.head,stale:!fresh,aggregate,mergeability:after.mergeability,required_checks:'unknown'});
 await transaction(db,async tx=>{
  await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[item.task_id]);const locked=(await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 FOR UPDATE',[item.item_id])).rows[0]!;
  const current=observation.current&&!locked.cancel_requested&&locked.last_published_proof?.candidate.head===observation.head;
  const unknown=after.mergeability==='unknown'?(prior?.scope_digest===binding?prior.merge_unknown_count??0:0)+1:0;
  await appendRemoteObservation(tx,locked,null,'checks',{observation:{...observation,current},items:checks,scope_digest:binding,configuration_digest:configuration,cache:progress.cache,merge_unknown_count:unknown},observation.observation_id);
  const delay=unknown?unknown===1?5000:unknown===2?10000:30000:15000;
  await tx.query("UPDATE remote_preparation_items SET poll_progress=NULL,next_poll_at=clock_timestamp()+$2*interval '1 millisecond' WHERE item_id=$1",[item.item_id,delay]);
 });
}
