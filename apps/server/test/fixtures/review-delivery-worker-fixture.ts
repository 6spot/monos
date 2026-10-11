import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import {ownerDeliveryFixture} from './owner-delivery-fixture.ts';
import {ownerDeliveryHooks} from '../../src/owner-delivery-control.ts';
import {OwnerDeliveryWorker} from '../../src/owner-delivery-worker.ts';
import {GitHubFinalization} from '../../src/github-finalization.ts';
import {GitHub} from '../../src/github.ts';
import {GitHubRemote,remoteProfile} from '../../src/github-remote.ts';
import {RemotePreparation} from '../../src/remote-preparation.ts';
import {publicationDigest as hash} from '../../src/publication-policy.ts';
import {validate} from '../../../../packages/protocol/src/index.ts';
import type {PublicationPushResult} from '../../../../packages/protocol/src/index.ts';
import type {PublicationPrepareRequest} from '../../../../packages/protocol/src/index.ts';
import {transaction} from '../../../../packages/db/src/index.ts';
import {TaskSpecification} from '../../src/task-specification.ts';
import {specificationImpact} from '../../src/task-specification-state.ts';
import {PublicationPreparation} from '../../src/publication-candidates.ts';
import {publicationPages} from './publication-fixture.ts';
import {reviewBasis} from '../../src/task-review-basis.ts';
import type {OwnerReviewCommand} from '../../../../packages/protocol/src/index.ts';

export async function reviewCorrectionEnvelope(x:Awaited<ReturnType<typeof ownerDeliveryFixture>>):Promise<OwnerReviewCommand>{
 const accepted=(await x.db.pool.query('SELECT * FROM owner_delivery_batches WHERE id=(SELECT accepted_delivery_operation_id FROM tasks WHERE id=$1)',[x.f.task])).rows[0];
 return {schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'request_changes',payload:{feedback_id:randomUUID(),text:'Improve the reviewed result within the same Task',basis:await transaction(x.db,tx=>reviewBasis(tx,x.f.task)),...(accepted?{accepted_batch:{operation_id:accepted.id,content_digest:accepted.content_digest,expected_version:Number(accepted.version)}}:{})}};
}

export async function reviewDeliveryWorkerFixture(mapped=false) {
 const x=await ownerDeliveryFixture('modified',ownerDeliveryHooks);
 try {
  const calls:{method:string;path:string}[]=[],grants:string[]=[],turns:number[]=[];
  const state:{head:string|null;pr:Record<string,unknown>|null;drop:boolean;reject:boolean;finalHead:string;gate?:Promise<void>;entered?:()=>void;beforeReply?:()=>Promise<void>;checks:number}={head:null,pr:null,drop:false,reject:false,finalHead:'f'.repeat(40),checks:1};
  const provider=new GitHubRemote(new GitHub(x.service.options.signingKey),{acquireGrant:async(scope,profile)=>{grants.push(profile);if(profile==='merge'&&state.gate){state.entered?.();await state.gate;}return {token:'ephemeral-worker-test-grant',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:scope.repository_id,permissions:remoteProfile(scope,profile)};},fetcher:async(input,init)=>{
   const url=new URL(String(input)),method=init?.method??'GET';calls.push({method,path:url.pathname+url.search});
   if(url.pathname.includes('/git/ref/'))return Response.json({ref:decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/git/ref/')+9)).replace(/^heads\//,'refs/heads/'),object:{type:'commit',sha:state.head}});
   if(url.pathname.endsWith('/pulls')&&method==='GET')return Response.json(state.pr?[state.pr]:[]);
   if(url.pathname.endsWith('/pulls')&&method==='POST') {
    const body=JSON.parse(String(init?.body));state.pr={id:101,number:1,title:body.title,body:body.body,html_url:'https://github.com/example/result/pull/1',state:'open',draft:false,merged:false,merged_at:null,mergeable:true,merge_commit_sha:'e'.repeat(40),head:{ref:body.head,sha:state.head,repo:{id:42}},base:{ref:'main',sha:'a'.repeat(40),repo:{id:42}}};return Response.json(state.pr);
   }
   if(url.pathname.endsWith('/pulls/1/merge')) {
    expect(method).toBe('PUT');expect(JSON.parse(String(init?.body)).sha).toBe(state.head);
    if(state.reject)return Response.json({message:'synthetic expected-head rejection'},{status:409});
    Object.assign(state.pr!,{state:'closed',merged:true,merged_at:new Date().toISOString(),merge_commit_sha:state.finalHead});
    await state.beforeReply?.();
    if(state.drop)throw new Error('synthetic lost successful merge reply');return Response.json({merged:true,sha:state.finalHead,message:'Merged'});
   }
   if(url.pathname.endsWith('/pulls/1')) {if(method==='PATCH')Object.assign(state.pr!,JSON.parse(String(init?.body)));return Response.json(state.pr);}
   if(url.pathname.endsWith('/branches/main/protection'))return Response.json({required_status_checks:{strict:true,contexts:['build'],checks:[{context:'build',app_id:10}]},required_linear_history:{enabled:false},required_pull_request_reviews:null});
   if(url.pathname.includes('/rules/branches/'))return Response.json([]);
   if(url.pathname.includes('/compare/'))return Response.json({base_commit:{sha:'a'.repeat(40)},merge_base_commit:{sha:'a'.repeat(40)},status:'ahead'});
   if(url.pathname.endsWith('/check-runs')) {
    const sha=url.pathname.split('/')[5],page=Number(url.searchParams.get('page')),rows=sha===state.head?Array.from({length:state.checks},(_,i)=>({id:i+1,name:i===0?'build':'other-'+i,head_sha:sha,status:'completed',conclusion:'success',started_at:new Date().toISOString(),app:{id:10}})):[];
    return Response.json({total_count:rows.length,check_runs:rows.slice((page-1)*100,page*100)});
   }
   if(url.pathname.endsWith('/statuses'))return Response.json([]);
   if(url.pathname==='/repos/example/result')return Response.json({id:42,full_name:'example/result',allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true});
   throw new Error('Unexpected synthetic fixture provider path');
  }}),remote=new RemotePreparation(x.db,x.service.instanceId,provider);
  const due=async()=>{await x.service.touch(x.f.runner,x.f.incarnation,true);await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()-interval '1 second'");await x.db.pool.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp()');await x.db.pool.query('UPDATE owner_delivery_batches SET due_at=clock_timestamp()');};
  await x.db.pool.query('UPDATE runners SET remote_preparation_supported=true WHERE id=$1',[x.f.runner]);
  await due();await remote.pump();await due();
  const push=(await remote.pending(x.f.runner,x.f.incarnation,true))[0]!.publication_push!;
  state.head=push.prepared.candidate!.head;
  const observation={schema_version:1,observation_id:randomUUID(),operation_id:push.operation_id,item_id:push.item_id,task_id:push.task_id,resource_id:push.resource_id,runner_id:push.runner_id,storage_id:push.storage_id,repository_identity:push.repository_identity,repository_id:push.repository_id,delivery_ref:push.delivery_ref,status:'present',head:state.head,observed_at:new Date().toISOString()};
  const result=validate<PublicationPushResult>('PublicationPushResult',{schema_version:1,operation_id:push.operation_id,request_digest:hash(push),item_id:push.item_id,delivery_ref:push.delivery_ref,candidate_head:state.head,candidate_manifest_digest:push.prepared.candidate_manifest_digest,push_started:false,worker_absent:true,status:'published',observation,observation_digest:hash(observation)});
  await remote.finish(x.f.runner,x.f.incarnation,result);await due();await remote.pump();
  if(mapped) {
   const impact=await transaction(x.db,async tx=>specificationImpact(tx,(await tx.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0]!));
   impact.nodes[0]!.disposition='carry';
   await new TaskSpecification(x.db).command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'edit_specification',payload:{proposal_id:randomUUID(),specification:'Carry this same result tree under the revised exact requirements',summary:'Explicit same-tree applicability',impact,basis:await x.basis(),source_input_ids:[]}});
   const preparation=new PublicationPreparation(x.db,x.service.instanceId);
   await preparation.pump();await preparation.pending(x.f.runner,x.f.incarnation,true);
   const request=(await x.db.pool.query<{request:PublicationPrepareRequest}>("SELECT request FROM delivery_operations WHERE task_id=$1 AND state='pending' AND dispatch_active ORDER BY created_at DESC,id DESC LIMIT 1",[x.f.task])).rows[0]!.request;
   const old=push.prepared.candidate!,manifestDigest=hash(old),mapping={schema_version:1,mapping_id:request.operation_id,operation_id:request.operation_id,request_digest:hash(request),item_id:push.item_id,source:request.source,source_digest:request.source_digest,effective_basis:request.effective_basis,effective_basis_digest:request.effective_basis_digest,published:request.published!,published_digest:request.published_digest!,candidate_manifest_digest:manifestDigest,reused_head:old.head,result_tree:old.tree,configuration_digest:request.configuration_digest};
   const scan={...publicationPages(request)[0]!.result.scan!,candidate_manifest_digest:manifestDigest,workflow_changes:false,coverage:{commits:0,paths:0,versions:0,unique_blob_bytes:0}};
   const result={schema_version:1,operation_id:request.operation_id,request_digest:hash(request),status:'mapped',candidate:old,candidate_manifest_digest:manifestDigest,mapping,mapping_digest:hash(mapping),scan,scan_digest:hash(scan)};
   await preparation.finish(x.f.runner,x.f.incarnation,{schema_version:1,result,page_index:0,page_count:1,findings:[],page_digest:hash([])});
   await due();await remote.pump();
  }
  const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),accepted=await x.acceptDelivery(p,c),worker=new OwnerDeliveryWorker(x.db,x.service.instanceId,new GitHubFinalization(provider));
  const pump=async(w=worker)=>{await due();const start=calls.length+grants.length;await w.pump();turns.push(calls.length+grants.length-start);expect(turns.at(-1)).toBeLessThanOrEqual(8);};
  const prepareChecks=async()=>{for(let i=0;i<8;i++){await pump();const row=(await x.db.pool.query('SELECT checkpoint,status,attention_reason FROM owner_delivery_batches WHERE id=$1',[accepted.operation_id])).rows[0]!;if((await x.db.pool.query('SELECT 1 FROM owner_delivery_item_validations WHERE batch_id=$1',[accepted.operation_id])).rowCount)return;if(row.status==='attention')throw new Error('Worker attention '+row.attention_reason);}throw new Error('Synthetic checks did not become ready: '+JSON.stringify((await x.db.pool.query('SELECT status,attention_reason,checkpoint FROM owner_delivery_batches')).rows)+' remote '+JSON.stringify((await x.db.pool.query('SELECT kind,state,active,reason FROM remote_preparation_operations')).rows));};
  const cancel=async()=>{const row=(await x.reads.batch(x.token,x.f.task,accepted.operation_id!)).batch;return x.deliveryCommand('cancel_delivery',{operation_id:accepted.operation_id!,content_digest:accepted.content_digest!,expected_version:row.version});};
  return {...x,state,calls,grants,turns,accepted,worker,provider,remote,due,pump,prepareChecks,cancel};
 }catch(e){await x.close();throw e;}
}
