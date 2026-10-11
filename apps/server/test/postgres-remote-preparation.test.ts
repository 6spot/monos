import {randomUUID,createHash,generateKeyPairSync} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {database,transaction} from '../../../packages/db/src/index.ts';
import {migrate} from '../../../packages/db/src/migrate.ts';
import {publicationFixture,publicationPages} from './fixtures/publication-fixture.ts';
import {Configuration} from '../src/configuration.ts';
import {GitHub} from '../src/github.ts';
import {GitHubRemote,remoteProfile} from '../src/github-remote.ts';
import {RemotePreparation} from '../src/remote-preparation.ts';
import {RemotePreparationAccess} from '../src/remote-preparation-access.ts';
import {RemotePreparationReads} from '../src/remote-preparation-reads.ts';
import {RemotePreparationCommands} from '../src/remote-preparation-commands.ts';
import {publicationDigest as hash} from '../src/publication-policy.ts';
import {PublicationCommands} from '../src/publication-commands.ts';
import {PublicationCandidateReads,knownPublicExposureCount} from '../src/publication-candidate-reads.ts';
import {remoteItemQuiescent} from '../src/remote-preparation-state.ts';
import {TaskSpecification} from '../src/task-specification.ts';
import {specificationImpact} from '../src/task-specification-state.ts';
import {canonicalJSON,validate} from '../../../packages/protocol/src/index.ts';
import type {PublicationPrepareRequest,PublicationPushResult} from '../../../packages/protocol/src/index.ts';
import {createApp} from '../src/app.ts';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import type {Frame} from '../../../packages/protocol/src/index.ts';

async function remoteFixture(credentialFinding=false,legacyCurrent=false,workflowChanges=false,resourceId?:string) {
 const credential=randomUUID(),x=await publicationFixture({runnerCredential:credential,resourceId});
 const github=new GitHub(x.service.options.signingKey),config=new Configuration(x.db,github),save=async(name:'save_github'|'save_project',payload:object)=>config.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:(await config.read(x.token)).control_version,name,payload});
 try {
  await save('save_github',{app_id:'7',installation_id:'8',private_key:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString()});
  await save('save_project',{id:x.f.project,name:'Remote project',context:'Safe provider fixture',role_ids:[x.f.role],archived:false,resources:[{id:x.resource,provider:'github',provider_repo_id:'42',remote_url:'https://github.com/example/result.git',remote_preparation:'automatic',default_branch:'main'}]});
  await x.db.pool.query('UPDATE runners SET publication_supported=true,remote_preparation_supported=true WHERE id=$1',[x.f.runner]);
  const gate:{wait?:Promise<void>;entered?:()=>void}={},profiles:{profile:string;workflows:boolean}[]=[],calls:{method:string;path:string}[]=[],state:{head:string|null;pull:Record<string,unknown>|null;loseCreate:boolean;checks:number;denyPoll:boolean}={head:null,pull:null,loseCreate:false,checks:70,denyPoll:false};
  const provider=new GitHubRemote(github,{acquireGrant:async(scope,profile)=>{profiles.push({profile,workflows:scope.workflow_changes});if(profile==='push'&&gate.wait){gate.entered?.();await gate.wait;}return {token:'ephemeral-test-grant',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:scope.repository_id,permissions:remoteProfile(scope,profile)};},fetcher:async(input,init)=>{
   const url=new URL(String(input)),method=init?.method??'GET';calls.push({method,path:url.pathname+url.search});expect(url.origin).toBe('https://api.github.com');
   if(url.pathname.includes('/git/ref/'))return Response.json(state.head?{ref:`refs/heads/monos/task/${x.f.task}/${x.resource}`,object:{type:'commit',sha:state.head}}:{message:'not found'},{status:state.head?200:404});
   if(url.pathname.endsWith('/pulls')&&method==='GET')return Response.json(state.pull?[state.pull]:[]);
   if(url.pathname.endsWith('/pulls')&&method==='POST') {
    const body=JSON.parse(String(init!.body));state.pull={id:101,number:1,title:body.title,body:body.body,html_url:'https://github.com/example/result/pull/1',state:'open',merged_at:null,mergeable:true,head:{ref:body.head,sha:state.head,repo:{id:42}},base:{ref:'main',sha:'a'.repeat(40),repo:{id:42}}};
    if(state.loseCreate){state.loseCreate=false;throw new Error('synthetic lost response');}return Response.json(state.pull);
   }
   if(url.pathname.endsWith('/pulls/1')){if(!state.pull)return Response.json({message:'not found'},{status:404});if(method==='PATCH')Object.assign(state.pull,JSON.parse(String(init!.body)));return Response.json(state.pull);}
   if(url.pathname.endsWith('/check-runs')){if(state.denyPoll)return Response.json({}, {status:503});const page=Number(url.searchParams.get('page')),tag='"checks-'+page+'-'+state.checks+'"';if(new Headers(init?.headers).get('if-none-match')===tag)return new Response(null,{status:304});const rows=Array.from({length:state.checks},(_,i)=>({id:i+1,name:'check-'+i,status:'completed',conclusion:'success',head_sha:state.head}));return Response.json({total_count:state.checks,check_runs:rows.slice((page-1)*100,page*100)},{headers:{ETag:tag}});}
   if(url.pathname.endsWith('/statuses'))return Response.json([]);
   throw new Error('Unexpected fixed-host fixture request');
  }}),remote=new RemotePreparation(x.db,x.service.instanceId,provider),access=new RemotePreparationAccess(x.service,provider),reads=new RemotePreparationReads(x.db,x.service.instanceId),commands=new RemotePreparationCommands(x.db);
  const due=async()=>{await x.service.touch(x.f.runner,x.f.incarnation,true);await x.db.pool.query("UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()-interval '1 second'");await x.db.pool.query('UPDATE remote_preparation_items SET next_poll_at=clock_timestamp()');};
  const finishLocal=async(count=credentialFinding?1:0,includeWorkflow=true)=>{
   await x.preparation.pump();await x.preparation.pending(x.f.runner,x.f.incarnation,true);const row=(await x.db.pool.query<{request:PublicationPrepareRequest}>("SELECT request FROM delivery_operations WHERE state='pending' AND dispatch_active ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0];if(!row)return;
   const pages=publicationPages(row.request,count);for(const page of pages){
    if(credentialFinding)page.findings=page.findings.map(f=>{const {finding_id:ignored,...facts}=f;void ignored;const safe={...facts,kind:'credential_pattern' as const,rule_id:'github_classic_token' as const,blob:'e'.repeat(40),content_digest:'f'.repeat(64),message:'Credential pattern matched; value redacted.' as const};return {...safe,finding_id:hash({candidate_manifest_digest:page.result.candidate_manifest_digest,configuration_digest:row.request.configuration_digest,scan_run_id:row.request.scan_run_id,finding_facts_without_id:safe})};});
    page.page_digest=hash(page.findings);page.result.scan!.findings_digest=hash(page.findings);page.result.scan!.findings_bytes=Buffer.byteLength(canonicalJSON(page.findings));if(includeWorkflow)page.result.scan!.workflow_changes=workflowChanges;page.result.scan_digest=hash(page.result.scan);await x.preparation.finish(x.f.runner,x.f.incarnation,page);
   }return {request:row.request,pages};
  };
  await finishLocal(undefined,!workflowChanges);await remote.pump();const prepared=await finishLocal(undefined,!legacyCurrent);
  if(credentialFinding){const page=prepared!.pages[0]!,commands=new PublicationCommands(x.db),select={candidate_id:page.result.candidate!.candidate_id,candidate_manifest_digest:page.result.candidate_manifest_digest,effective_basis_digest:prepared!.request.effective_basis_digest,scan_digest:page.result.scan_digest,finding_ids:page.findings.map(f=>f.finding_id).sort()};
   const send=(name:string,payload:object)=>commands.command(x.token,{schema_version:1,task_id:x.f.task,request_id:randomUUID(),name,payload});
   const proposal=await send('prepare_publication_override',select),confirmed=await send('confirm_publication_override',{proposal_id:proposal.proposal_id,content_digest:proposal.content_digest});await send('override_publication_findings',{...select,confirmation_id:confirmed.confirmation_id});
  }
  await due();await remote.pump();if(legacyCurrent||workflowChanges){await finishLocal();await due();await remote.pump();}await due();
  const push=(await remote.pending(x.f.runner,x.f.incarnation,true))[0]!.publication_push!;
  const result=(status:PublicationPushResult['status'],started:boolean,head=push.prepared.candidate!.head):PublicationPushResult=>{
   const observation={schema_version:1,observation_id:randomUUID(),operation_id:push.operation_id,item_id:push.item_id,task_id:push.task_id,resource_id:push.resource_id,runner_id:push.runner_id,storage_id:push.storage_id,repository_identity:push.repository_identity,repository_id:push.repository_id,delivery_ref:push.delivery_ref,status:'present',head,observed_at:new Date().toISOString()};
   return validate('PublicationPushResult',{schema_version:1,operation_id:push.operation_id,request_digest:hash(push),item_id:push.item_id,delivery_ref:push.delivery_ref,candidate_head:push.prepared.candidate!.head,candidate_manifest_digest:push.prepared.candidate_manifest_digest,push_started:started,worker_absent:true,status,...(status!=='published'?{reason:status==='blocked'?'access_denied':'possible_publication'}:{}),observation,observation_digest:hash(observation)});
  };
  const claim=async()=>{await due();return access.access(credential,push.operation_id,{schema_version:1,incarnation:x.f.incarnation,request_digest:hash(push),purpose:'push',attempt_id:randomUUID()});};
  return {...x,credential,remote,provider,access,reads,commands,state,calls,profiles,gate,due,finishLocal,push,result,claim};
 }catch(error){await x.close();throw error;}
}

const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('remote preparation durable boundary',()=>{
 it('reads remote preparation and delivery for a named resource through authenticated Owner routes',async()=>{
  const x=await remoteFixture(false,false,false,'Delivery_Acceptance-repo-v1'),app=createApp(x.service,undefined,undefined,{remoteProvider:x.provider});
  try {
   const deliveryRef=`refs/heads/monos/task/${x.f.task}/${x.resource}`;
   expect(x.push.delivery_ref).toBe(deliveryRef);
   const remote=await app.inject({method:'GET',url:`/v1/owner/tasks/${x.f.task}/remote-preparation`,headers:{authorization:'Bearer '+x.token}});
   expect(remote.statusCode).toBe(200);
   expect(JSON.stringify(remote.json())).toContain(deliveryRef);
   const delivery=await app.inject({method:'GET',url:`/v1/owner/tasks/${x.f.task}/delivery`,headers:{authorization:'Bearer '+x.token}});
   expect(delivery.statusCode).toBe(200);
   expect(delivery.json()).toMatchObject({task_id:x.f.task,accept_allowed:true});
   expect(x.calls.filter(c=>c.method!=='GET')).toEqual([]);
  }finally{await app.close();await x.close();}
 });
 it('resumes bounded checks across turns without partial success and marks retained evidence stale on unavailable refresh',async()=>{
  const x=await remoteFixture();try {
   await x.claim();x.state.head=x.push.prepared.candidate!.head;await x.remote.finish(x.f.runner,x.f.incarnation,x.result('published',true));await x.due();await x.remote.pump();x.state.checks=600;
   let calls=x.calls.length,grants=x.profiles.length;await x.due();await x.remote.pump();expect(x.calls.length-calls+x.profiles.length-grants).toBeLessThanOrEqual(8);expect((await x.reads.item(x.token,x.f.task,x.push.item_id)).checks).toBeUndefined();expect((await x.db.pool.query('SELECT poll_progress FROM remote_preparation_items')).rows[0]!.poll_progress.items).toHaveLength(500);
   x.state.checks=601;await x.due();await x.remote.pump();expect(await x.reads.item(x.token,x.f.task,x.push.item_id)).toMatchObject({reason:'invalid_provider_response'});expect((await x.reads.item(x.token,x.f.task,x.push.item_id)).checks).toBeUndefined();expect((await x.db.pool.query('SELECT poll_progress FROM remote_preparation_items')).rows[0]!.poll_progress).toBeNull();
   x.state.checks=600;await x.due();await x.remote.pump();
   calls=x.calls.length;grants=x.profiles.length;await x.due();await x.remote.pump();expect(x.calls.length-calls+x.profiles.length-grants).toBeLessThanOrEqual(8);const complete=await x.reads.item(x.token,x.f.task,x.push.item_id);expect(complete.checks).toMatchObject({complete:true,aggregate:'success'});
   x.state.denyPoll=true;await x.due();await x.remote.pump();const failed=await x.reads.item(x.token,x.f.task,x.push.item_id);expect(failed).toMatchObject({reason:'provider_unavailable',read_retry_allowed:true,checks:{current:false,stale:true}});expect((await x.reads.checks(x.token,x.f.task,x.push.item_id,complete.checks!.observation_id,{})).observation.current).toBe(false);
   const receipt=await x.commands.command(x.token,{schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'retry_remote_preparation',payload:{operation_id:failed.operation!.operation_id,operation_digest:failed.operation!.request_digest,expected_version:failed.operation!.version}});expect(receipt.operation_id).toBe(failed.operation!.operation_id);expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);
  }finally{await x.close();}
 });
 it('uses real authenticated WSS capability and refuses a cross-item result before recovering the exact ACK',async()=>{
  const x=await remoteFixture(),app=createApp(x.service,undefined,undefined,{remoteProvider:x.provider});let ws:WebSocket|undefined;
  try {
   await app.listen({host:'127.0.0.1',port:0});const port=(app.server.address() as AddressInfo).port,frames:Frame[]=[];
   ws=new WebSocket(`ws://127.0.0.1:${port}/v1/runner`,{headers:{Authorization:'Bearer '+x.credential}});ws.on('message',bytes=>frames.push(JSON.parse(bytes.toString())));await once(ws,'open');
   ws.send(JSON.stringify({schema_version:1,type:'hello',runner_id:x.f.runner,boot_id:'remote-read-reconnect'}));await expect.poll(()=>frames.find(f=>f.type==='welcome')).toBeTruthy();x.f.incarnation=frames.find(f=>f.type==='welcome')!.incarnation!;
   ws.send(JSON.stringify({schema_version:1,type:'ready',incarnation:x.f.incarnation,log_modes:['ordered_v1'],publication_modes:['local_candidate_v1'],runtimes:[]}));await expect.poll(async()=>(await x.db.pool.query('SELECT ready FROM runners WHERE id=$1',[x.f.runner])).rows[0]!.ready).toBe(true);expect(await x.remote.pending(x.f.runner,x.f.incarnation,false)).toEqual([]);
   ws.send(JSON.stringify({schema_version:1,type:'ready',incarnation:x.f.incarnation,log_modes:['ordered_v1'],publication_modes:['local_candidate_v1'],remote_preparation_modes:['github_review_v1'],runtimes:[]}));await x.due();await expect.poll(()=>frames.find(f=>f.type==='publication_push'),{timeout:5000}).toBeTruthy();
   const wrong={...x.result('published',false),item_id:randomUUID()};ws.send(JSON.stringify({schema_version:1,type:'publication_push_result',incarnation:x.f.incarnation,publication_push_result:wrong}));await expect.poll(()=>frames.find(f=>f.type==='error'&&f.error?.code==='payload_conflict')).toBeTruthy();expect((await x.db.pool.query('SELECT state FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]!.state).toBe('pending');
   await x.due();const accessPayload={schema_version:1,incarnation:x.f.incarnation,request_digest:hash(x.push),purpose:'push',attempt_id:randomUUID()},invoke=(purpose:string)=>app.inject({method:'POST',url:`/v1/runner/remote-preparation/${x.push.operation_id}/access`,headers:{authorization:'Bearer '+x.credential},payload:{...accessPayload,purpose}});
   expect((await invoke('observe')).statusCode).toBe(200);
   const unchanged=(await x.db.pool.query('SELECT state,version,may_have_mutated,effect_owned,worker_absent,reconcile_only,claim_id FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0],grants=x.profiles.length;
   const queued=await invoke('push');expect(queued.statusCode).toBe(429);expect(queued.json()).toMatchObject({schema_version:1,status:'error',error:{code:'rate_limited'}});expect(queued.headers['retry-after']).toBe('1');expect(queued.headers['cache-control']).toBe('no-store');expect(x.profiles).toHaveLength(grants);
   expect((await x.db.pool.query('SELECT state,version,may_have_mutated,effect_owned,worker_absent,reconcile_only,claim_id FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]).toEqual(unchanged);expect(unchanged).toMatchObject({state:'pending',may_have_mutated:false,effect_owned:false,reconcile_only:false,claim_id:null});
   // Let the actual installation spacing expire; no cooldown-row edit here.
   await new Promise(resolve=>setTimeout(resolve,Number(queued.headers['retry-after'])*1000+20));
   const reply=await invoke('push');expect(reply.statusCode).toBe(200);expect(reply.headers['cache-control']).toBe('no-store');expect(validate<{attempt_id:string}>('PublicationAccessResult',reply.json()).attempt_id).toBe(accessPayload.attempt_id);
   const result=x.result('published',true);x.state.head=x.push.prepared.candidate!.head;ws.send(JSON.stringify({schema_version:1,type:'publication_push_result',incarnation:x.f.incarnation,publication_push_result:result}));await expect.poll(()=>frames.find(f=>f.type==='publication_push_ack')).toBeTruthy();expect(frames.find(f=>f.type==='publication_push_ack')!.publication_push_ack).toMatchObject({operation_id:x.push.operation_id,result_digest:hash(result)});
   const read=await app.inject({method:'GET',url:`/v1/owner/tasks/${x.f.task}/remote-preparation`,headers:{authorization:'Bearer '+x.token}});expect(read.statusCode).toBe(200);validate('RemotePreparationPage',read.json());expect(read.headers['cache-control']).toBe('no-store');
  }finally{ws?.terminate();await app.close();await x.close();}
 },30000);
 it('withholds the token when actual Owner input arrives during grant I/O and pins Specification settlement on admitted push',async()=>{
   const x=await remoteFixture();let release!:()=>void;try {
   x.gate.wait=new Promise<void>(resolve=>{release=resolve;});const entered=new Promise<void>(resolve=>{x.gate.entered=resolve;});const claiming=x.claim();await entered;
   const impact=await transaction(x.db,async tx=>specificationImpact(tx,(await tx.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0]));impact.nodes[0]!.disposition='carry';
   const changed=await new TaskSpecification(x.db).command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'edit_specification',payload:{proposal_id:randomUUID(),specification:'Wait for admitted physical publication before carrying the result',summary:'Exact carry after settlement',impact,basis:await x.basis(),source_input_ids:[]}});expect(changed.status).toBe('admitted');
   expect((await x.db.pool.query('SELECT specification_id FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.specification_id).toBe(x.f.spec);expect((await x.db.pool.query('SELECT attention FROM requirement_changes')).rows[0]!.attention).toBe('waiting_for_remote_settlement');
   await x.conversation.command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'submit_task_message',payload:{message_id:randomUUID(),content:'New input while scoped grant is pending'}});release();await expect(claiming).rejects.toThrow(/input_pending|source_changed/);expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(false);
   // Read the admitted physical fence itself; pending input independently prevents
   // new effects, while publication must wait on real original-worker evidence.
   expect((await x.db.pool.query('SELECT effect_owned,reconcile_only FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]).toMatchObject({effect_owned:true,reconcile_only:true});
   await x.remote.finish(x.f.runner,x.f.incarnation,x.result('blocked',false,'a'.repeat(40)));expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(true);
  }finally{release?.();await x.close();}
 });
 it('bootstraps minimally then refreshes workflow scope from the explicit complete scan without a finding',async()=>{
  const x=await remoteFixture(false,false,true);try {
   expect(x.profiles.filter(p=>p.profile==='permission')).toEqual([{profile:'permission',workflows:false},{profile:'permission',workflows:true}]);
   expect(x.push.workflow_changes).toBe(true);expect(x.push.prepared.scan!.workflow_changes).toBe(true);expect(x.push.prepared.scan!.findings_count).toBe(0);expect(x.push.permission_proof.permissions.workflows).toBe('write');
   const locals=(await x.db.pool.query('SELECT request,result FROM delivery_operations ORDER BY created_at,id')).rows;expect(locals.at(-2)!.request.construction).toEqual(locals.at(-1)!.request.construction);expect(locals.at(-1)!.request.configuration.workflow_write).toBe('allowed');
  }finally{await x.close();}
 });
 it('upgrades a legacy missing workflow flag with a fresh scan and pauses fresh admission on actual pending input',async()=>{
  const x=await remoteFixture(false,true);try {
   const locals=(await x.db.pool.query("SELECT * FROM delivery_operations WHERE state='terminal' ORDER BY created_at,id")).rows;
   const previous=locals.at(-2)!,current=locals.at(-1)!;expect(previous.result.scan.workflow_changes).toBeUndefined();expect(current.result.scan.workflow_changes).toBe(false);expect(current.request.construction).toEqual(previous.request.construction);expect(current.request.scan_run_id).not.toBe(previous.request.scan_run_id);
   await x.conversation.command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'submit_task_message',payload:{message_id:randomUUID(),content:'Review pending before remote write'}});await x.due();
   expect(await x.remote.pending(x.f.runner,x.f.incarnation,true)).toEqual([]);await expect(x.claim()).rejects.toThrow(/input_pending|source_changed/);expect(x.calls.filter(c=>c.method!=='GET')).toEqual([]);expect((await x.db.pool.query('SELECT may_have_mutated FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]!.may_have_mutated).toBe(false);
  }finally{await x.close();}
 });
 it('retains immediate published exposure through a real waived scan and clean mapped Specification carry',async()=>{
  const x=await remoteFixture(true);try {
   expect(x.push.override_receipts).toHaveLength(1);await x.claim();x.state.head=x.push.prepared.candidate!.head;await x.remote.finish(x.f.runner,x.f.incarnation,x.result('published',true));
   expect(await transaction(x.db,tx=>knownPublicExposureCount(tx,x.f.task,x.resource,x.push.repository_identity))).toBe(1);await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='POST')).toEqual([]);
   const impact=await transaction(x.db,async tx=>specificationImpact(tx,(await tx.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0]));impact.nodes[0]!.disposition='carry';
   await new TaskSpecification(x.db).command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'edit_specification',payload:{proposal_id:randomUUID(),specification:'Carry same physical tree with revised requirements',summary:'Explicit applicability',impact,basis:await x.basis(),source_input_ids:[]}});await x.preparation.pump();
   await x.preparation.pending(x.f.runner,x.f.incarnation,true);const request=(await x.db.pool.query<{request:PublicationPrepareRequest}>("SELECT request FROM delivery_operations WHERE state='pending' AND dispatch_active ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0]!.request;
   const old=x.push.prepared.candidate!,manifestDigest=hash(old),mapping={schema_version:1,mapping_id:request.operation_id,operation_id:request.operation_id,request_digest:hash(request),item_id:x.push.item_id,source:request.source,source_digest:request.source_digest,effective_basis:request.effective_basis,effective_basis_digest:request.effective_basis_digest,published:request.published!,published_digest:request.published_digest!,candidate_manifest_digest:manifestDigest,reused_head:old.head,result_tree:old.tree,configuration_digest:request.configuration_digest};
   const scan={...publicationPages(request)[0]!.result.scan!,candidate_manifest_digest:manifestDigest,workflow_changes:false,coverage:{commits:0,paths:0,versions:0,unique_blob_bytes:0}};
   const mapped={schema_version:1,operation_id:request.operation_id,request_digest:hash(request),status:'mapped',candidate:old,candidate_manifest_digest:manifestDigest,mapping,mapping_digest:hash(mapping),scan,scan_digest:hash(scan)};
   await x.preparation.finish(x.f.runner,x.f.incarnation,{schema_version:1,result:mapped,page_index:0,page_count:1,findings:[],page_digest:hash([])});
   const record=await new PublicationCandidateReads(x.db).candidate(x.token,x.f.task,old.candidate_id);expect(record).toMatchObject({status:'mapped',current:true,known_public_exposure_count:1,candidate:old,effective_basis:request.effective_basis,mapping_digest:hash(mapping)});expect(record.effective_basis_digest).not.toBe(x.push.preparation.effective_basis_digest);
   await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='POST')).toEqual([]);expect((await x.db.pool.query('SELECT * FROM remote_published_exposures')).rows).toHaveLength(1);
  }finally{await x.close();}
 },30000);
 it('closes only the exact owned PR after actual Cancel and retains its branch',async()=>{
  const x=await remoteFixture();try {
   await x.claim();x.state.head=x.push.prepared.candidate!.head;await x.remote.finish(x.f.runner,x.f.incarnation,x.result('published',true));await x.due();await x.remote.pump();
   const cancelled=await x.execution.command(x.token,{schema_version:1,request_id:randomUUID(),scope_id:x.f.task,expected_control_version:await x.version(),name:'cancel_task',payload:{specification_id:x.f.spec,plan_id:x.f.plan}});expect(cancelled.status).toBe('committed');expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('CANCELLED');
   await x.due();await x.remote.pump();await x.due();await x.remote.pump();expect(x.state.pull?.state).toBe('closed');expect(x.state.head).toBe(x.push.prepared.candidate!.head);expect(x.calls.filter(c=>c.method==='PATCH')).toHaveLength(1);expect(await x.reads.item(x.token,x.f.task,x.push.item_id)).toMatchObject({status:'cancelled',review:{pr_id:'101',state:'closed'}});
  }finally{await x.close();}
 },30000);
 it('claims the exact push, reconciles lost PR response without another POST, and pages literal-head checks',async()=>{
  const x=await remoteFixture();try {
   const grant=await x.claim();expect(grant).toMatchObject({purpose:'push',item_id:x.push.item_id,candidate_head:x.push.prepared.candidate!.head});
   const storedClaim=(await x.db.pool.query('SELECT claim_expires_at FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]!.claim_expires_at;expect(grant.claim_expires_at).toBe(storedClaim.toISOString());
   x.state.head=x.push.prepared.candidate!.head;const result=x.result('published',true),ack=await x.remote.finish(x.f.runner,x.f.incarnation,result);expect(await x.remote.finish(x.f.runner,x.f.incarnation,result)).toEqual(ack);
   x.state.loseCreate=true;await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);
   expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(false);
   await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(true);
   await x.due();await x.remote.pump();const record=await x.reads.item(x.token,x.f.task,x.push.item_id);expect(record).toMatchObject({status:'prepared',current:true,review:{pr_id:'101'},checks:{aggregate:'success',complete:true,head:x.state.head,required_checks:'unknown'}});
   const first=await x.reads.checks(x.token,x.f.task,x.push.item_id,record.checks!.observation_id,{});expect(first.items).toHaveLength(64);expect(first.next_cursor).toBeTruthy();const second=await x.reads.checks(x.token,x.f.task,x.push.item_id,record.checks!.observation_id,{cursor:first.next_cursor});expect(second.items).toHaveLength(6);
   expect((await x.db.pool.query('SELECT * FROM remote_preparation_operations')).rows).toHaveLength(2);
  }finally{await x.close();}
 },30000);
 it('keeps terminal uncertainty and ACK immutable while a later exact ref appends the original proof',async()=>{
  const x=await remoteFixture();try {
   await x.claim();const uncertain=x.result('reconciliation_required',true,'a'.repeat(40)),ack=await x.remote.finish(x.f.runner,x.f.incarnation,uncertain),before=(await x.db.pool.query('SELECT * FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0];
   expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(false);x.state.head=x.push.prepared.candidate!.head;await x.due();await x.remote.pump();
   expect((await x.db.pool.query('SELECT * FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0]).toEqual(before);expect(await x.remote.finish(x.f.runner,x.f.incarnation,uncertain)).toEqual(ack);expect(await transaction(x.db,tx=>remoteItemQuiescent(tx,x.f.task))).toBe(true);
   expect((await x.db.pool.query("SELECT observation FROM remote_preparation_observations WHERE kind='published'")).rows[0]!.observation).toMatchObject({operation_id:x.push.operation_id,result_digest:hash(uncertain),observation:{head:x.state.head}});
   expect(x.calls.filter(c=>c.method!=='GET')).toEqual([]);
  }finally{await x.close();}
 });
 it('uses actual Owner Retry for an unstarted blocked operation and recovers the exact receipt',async()=>{
  const x=await remoteFixture();try {
   await x.remote.finish(x.f.runner,x.f.incarnation,x.result('blocked',false,'a'.repeat(40)));const old=(await x.db.pool.query('SELECT * FROM remote_preparation_operations WHERE id=$1',[x.push.operation_id])).rows[0];await x.due();await x.remote.pump();expect((await x.db.pool.query('SELECT * FROM remote_preparation_operations')).rows).toHaveLength(1);
   const command={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'retry_remote_preparation',payload:{operation_id:old.id,operation_digest:old.request_digest,expected_version:Number(old.version)}};
   const receipt=await x.commands.command(x.token,command);expect(receipt.operation_id).not.toBe(old.id);expect(await x.commands.receipt(x.token,x.f.task,command.request_id)).toEqual(receipt);expect(await x.commands.command(x.token,command)).toEqual(receipt);expect((await x.db.pool.query('SELECT * FROM remote_preparation_operations WHERE id=$1',[old.id])).rows[0]).toEqual(old);
   await expect(x.commands.command(x.token,{...command,request_id:randomUUID()})).rejects.toThrow('eligible');
  }finally{await x.close();}
 });
 it('upgrades real version 22 to version 26 without rewriting historical checksums',async()=>{
  const url=new URL(process.env.MONOS_TEST_DATABASE_URL??process.env.DATABASE_URL!);
  const admin=database(url.toString()),namespace='remote_upgrade_'+randomUUID().replaceAll('-','');
  await admin.pool.query(`CREATE SCHEMA ${namespace}`);
  url.searchParams.set('options',`-c search_path=${namespace}`);
  const db=database(url.toString());
  try {
   await db.pool.query('CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');
   const directory=new URL('../../../packages/db/migrations/',import.meta.url);
   const names=(await readdir(directory)).filter(n=>/^00(?:0[1-9]|1[0-9]|2[0-2])_.*\.sql$/.test(n)).sort();
   expect(names).toHaveLength(22);
   await transaction(db,async tx=>{
    for(const [i,name] of names.entries()) {
     const sql=await readFile(new URL(name,directory),'utf8');
     await tx.query(sql);
     await tx.query('INSERT INTO schema_migrations VALUES($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);
    }
   });
   const historical=(await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
   await migrate(db);await migrate(db);
   expect((await db.pool.query('SELECT * FROM schema_migrations WHERE version<=22 ORDER BY version')).rows).toEqual(historical);
   expect((await db.pool.query('SELECT max(version) version FROM schema_migrations')).rows[0]!.version).toBe(26);
   const names23=['publication_permission_observations','remote_preparation_items','remote_preparation_operations','remote_preparation_observations','published_result_mappings','remote_published_exposures','remote_preparation_command_receipts','github_remote_cooldowns'];
   for(const name of names23)expect((await db.pool.query(`SELECT * FROM ${name}`)).rows).toEqual([]);
   expect((await db.pool.query("SELECT column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='runners' AND column_name='remote_preparation_supported'",[namespace])).rows[0]!.column_default).toBe('false');
  }finally{
   await db.pool.end();
   await admin.pool.query(`DROP SCHEMA ${namespace} CASCADE`);await admin.pool.end();
  }
 },30000);
});
