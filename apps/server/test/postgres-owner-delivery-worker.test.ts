import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {ownerDeliveryFixture} from './fixtures/owner-delivery-fixture.ts';
import {ownerDeliveryHooks} from '../src/owner-delivery-control.ts';
import {OwnerDeliveryWorker} from '../src/owner-delivery-worker.ts';
import {GitHubFinalization} from '../src/github-finalization.ts';
import {GitHub} from '../src/github.ts';
import {Configuration} from '../src/configuration.ts';
import {GitHubRemote,remoteProfile} from '../src/github-remote.ts';
import {RemotePreparation} from '../src/remote-preparation.ts';
import {publicationDigest as hash} from '../src/publication-policy.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {PublicationPushResult} from '../../../packages/protocol/src/index.ts';
import type {PublicationPrepareRequest} from '../../../packages/protocol/src/index.ts';
import {transaction} from '../../../packages/db/src/index.ts';
import {TaskSpecification} from '../src/task-specification.ts';
import {specificationImpact} from '../src/task-specification-state.ts';
import {PublicationPreparation} from '../src/publication-candidates.ts';
import {publicationPages} from './fixtures/publication-fixture.ts';

async function fixture(mapped=false) {
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
  const prepareChecks=async()=>{for(let i=0;i<8;i++){await pump();const row=(await x.db.pool.query('SELECT checkpoint,status,attention_reason FROM owner_delivery_batches WHERE id=$1',[accepted.operation_id])).rows[0]!;if(row.checkpoint?.stage?.phase==='ready')return;if(row.status==='attention')throw new Error('Worker attention '+row.attention_reason);}throw new Error('Synthetic checks did not become ready: '+JSON.stringify((await x.db.pool.query('SELECT status,attention_reason,checkpoint FROM owner_delivery_batches')).rows)+' remote '+JSON.stringify((await x.db.pool.query('SELECT kind,state,active,reason FROM remote_preparation_operations')).rows));};
  const cancel=async()=>{const row=(await x.reads.batch(x.token,x.f.task,accepted.operation_id!)).batch;return x.deliveryCommand('cancel_delivery',{operation_id:accepted.operation_id!,content_digest:accepted.content_digest!,expected_version:row.version});};
  return {...x,state,calls,grants,turns,accepted,worker,provider,remote,due,pump,prepareChecks,cancel};
 }catch(e){await x.close();throw e;}
}
const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('accepted GitHub worker durable boundary',()=>{
 it('accepts current mapped carry with zero new commits as modified and finalizes the same PR/head',async()=>{
  const x=await fixture(true);try {
   const detail=await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!);
   expect(detail.batch.modified_items).toBe(1);
   expect(detail.manifest.repositories[0]).toMatchObject({outcome:'modified',preparation_result:{status:'mapped',scan:{coverage:{commits:0}}},mapping:{reused_head:x.state.head}});
   expect(detail.manifest.outputs[0]!.completion.specification_id).not.toBe(detail.manifest.basis.specification_id);
   const pushes=(await x.db.pool.query("SELECT id FROM remote_preparation_operations WHERE task_id=$1 AND kind='push'",[x.f.task])).rows;
   expect(pushes).toHaveLength(1);
   await x.prepareChecks();await x.pump();
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('COMPLETED');
   expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch.finalized_items).toBe(1);
  }finally{await x.close();}
 });
 it('stages complete protected checks inside eight calls and delivers despite a later unresolved chat',async()=>{
  const x=await fixture();try {
   x.state.checks=210;await x.send('Explain the accepted result while delivery continues');
   await x.prepareChecks();await x.pump();
   expect(x.calls.filter(c=>c.method==='PUT'),JSON.stringify((await x.db.pool.query('SELECT status,attention_reason FROM owner_delivery_batches')).rows)).toHaveLength(1);
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('COMPLETED');
   expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch).toMatchObject({status:'completed',finalized_items:1});
   expect((await x.db.pool.query('SELECT accepted_delivery_operation_id FROM task_inputs WHERE task_id=$1',[x.f.task])).rows[0]!.accepted_delivery_operation_id).toBe(x.accepted.operation_id);
   expect(x.turns.at(-1)).toBe(8);
   await expect(x.db.pool.query("UPDATE owner_delivery_merge_operations SET status='failed',reason='merge_rejected' WHERE batch_id=$1",[x.accepted.operation_id])).rejects.toMatchObject({code:'23514'});
   expect((await x.db.pool.query('SELECT status FROM owner_delivery_merge_operations WHERE batch_id=$1',[x.accepted.operation_id])).rows[0]!.status).toBe('succeeded');
  }finally{await x.close();}
 });
 it('withholds success, restarts, reconciles the same operation by reads and retains late truth after actual Cancel',async()=>{
  const x=await fixture();try {
   await x.prepareChecks();x.state.drop=true;await x.pump();
   const original=(await x.db.pool.query('SELECT id,request_digest,status,effect_owned FROM owner_delivery_merge_operations')).rows[0]!;expect(original).toMatchObject({status:'unknown',effect_owned:true});
   const merged={...x.state.pr!};Object.assign(x.state.pr!,{state:'open',merged:false,merged_at:null,merge_commit_sha:'e'.repeat(40)});
   const restarted=new OwnerDeliveryWorker(x.db,randomUUID(),new GitHubFinalization(x.provider));await x.pump(restarted);
   expect((await x.db.pool.query('SELECT status,effect_owned FROM owner_delivery_merge_operations')).rows[0]).toEqual({status:'unknown',effect_owned:true});
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
   await x.cancel();
   await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
   Object.assign(x.state.pr!,merged);await x.pump(restarted);await x.remote.pump();
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);
   expect((await x.db.pool.query('SELECT id,request_digest,status FROM owner_delivery_merge_operations')).rows[0]).toEqual({id:original.id,request_digest:original.request_digest,status:'succeeded'});
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('CANCELLED');
   expect((await x.db.pool.query('SELECT status FROM owner_delivery_batches')).rows[0]!.status).toBe('cancelled');
   expect((await x.db.pool.query('SELECT cleanup_state FROM remote_preparation_items')).rows[0]!.cleanup_state).toBe('externally_merged');
   expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_finalizations')).rows[0]!.n).toBe('1');
   expect(x.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
  }finally{await x.close();}
 });
 it('requires actual Owner Retry after a definitive rejection and retains original head/PR/method',async()=>{
  const x=await fixture();try {
   await x.prepareChecks();x.state.reject=true;await x.pump();const old=(await x.db.pool.query('SELECT * FROM owner_delivery_merge_operations')).rows[0]!;
   await x.pump();expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(old.status).toBe('failed');
   const batch=(await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch;
   await x.deliveryCommand('retry_delivery',{operation_id:x.accepted.operation_id!,content_digest:x.accepted.content_digest!,expected_version:batch.version});
   x.state.reject=false;await x.pump();
   const rows=(await x.db.pool.query('SELECT request,selected_method,status FROM owner_delivery_merge_operations ORDER BY created_at')).rows;
   expect(rows).toHaveLength(2);expect(rows[0]!.status).toBe('failed');expect(rows[1]!.status).toBe('succeeded');expect(rows[1]!.selected_method).toBe(rows[0]!.selected_method);
   const {operation_id:oldId,...oldRequest}=rows[0]!.request,{operation_id:newId,...newRequest}=rows[1]!.request;expect(oldId).not.toBe(newId);expect(newRequest).toEqual(oldRequest);expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(2);
  }finally{await x.close();}
 });
 it('rechecks actual Cancel after token I/O and admits no merge effect',async()=>{
  const x=await fixture();try {
   await x.prepareChecks();let release!:()=>void,entered!:()=>void;
   x.state.gate=new Promise<void>(resolve=>{release=resolve;});const waiting=new Promise<void>(resolve=>{entered=resolve;});x.state.entered=entered;
   const running=x.pump();await waiting;const observed=x.calls.length+x.grants.length;await x.pump(new OwnerDeliveryWorker(x.db,randomUUID(),new GitHubFinalization(x.provider)));expect(x.calls.length+x.grants.length).toBe(observed);await x.cancel();release();await running;
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(0);expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_merge_operations')).rows[0]!.n).toBe('0');
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('CANCELLED');
  }finally{await x.close();}
 });
 it('refreshes expired actual pages and rejects truncated persisted collections before any effect',async()=>{
  const x=await fixture();try {
   await x.prepareChecks();await x.db.pool.query("UPDATE owner_delivery_batches SET checkpoint=jsonb_set(checkpoint,'{stage,collections,head,0,pages,0,observed_at}',to_jsonb($2::text)) WHERE id=$1",[x.accepted.operation_id,new Date(Date.now()-16_000).toISOString()]);
   const pages=x.calls.filter(c=>c.path.includes('/check-runs')).length;await x.pump();expect(x.calls.filter(c=>c.path.includes('/check-runs')).length).toBeGreaterThan(pages);expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(0);
   await x.db.pool.query("UPDATE owner_delivery_batches SET checkpoint=jsonb_set(checkpoint,'{stage,collections,head,0,pages,0,total}','2'::jsonb) WHERE id=$1",[x.accepted.operation_id]);
   await x.pump();expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(0);expect((await x.db.pool.query('SELECT status,attention_reason FROM owner_delivery_batches')).rows[0]).toMatchObject({status:'attention',attention_reason:'identity_mismatch'});
  }finally{await x.close();}
 });
 it('retains exact historical success when current App configuration changes after the admitted effect',async()=>{
  const x=await fixture();try {
   x.state.finalHead='f'.repeat(64);
   await x.prepareChecks();const config=new Configuration(x.db,new GitHub(x.service.options.signingKey));
   x.state.beforeReply=async()=>{await config.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:(await config.read(x.token)).control_version,name:'save_github',payload:{app_id:'7',installation_id:'9'}});};
   await x.pump();
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('COMPLETED');
   expect((await x.db.pool.query('SELECT final_commit FROM owner_delivery_finalizations')).rows[0]!.final_commit).toBe('f'.repeat(64));
   expect((await x.db.pool.query('SELECT installation_id FROM github_configuration')).rows[0]!.installation_id).toBe('9');
  }finally{await x.close();}
 });
});
