import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import {transaction} from '../../../packages/db/src/index.ts';
import type {OwnerReviewCommand,PublicationPushResult} from '../../../packages/protocol/src/index.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import {ownerDeliveryFixture} from './fixtures/owner-delivery-fixture.ts';
import {reviewDeliveryWorkerFixture,reviewCorrectionEnvelope as correction} from './fixtures/review-delivery-worker-fixture.ts';
import {ownerDeliveryHooks} from '../src/owner-delivery-control.ts';
import {OwnerDeliveryWorker} from '../src/owner-delivery-worker.ts';
import {GitHubFinalization} from '../src/github-finalization.ts';
import {ownerReviewHooks} from '../src/owner-review-control.ts';
import {TaskReviewCommands} from '../src/task-review-commands.ts';
import {TaskReviewCoordinator} from '../src/task-review-coordinator.ts';
import {RemotePreparationAccess} from '../src/remote-preparation-access.ts';
import {RemotePreparation} from '../src/remote-preparation.ts';
import {GitHubRemote,remoteProfile} from '../src/github-remote.ts';
import {GitHub} from '../src/github.ts';
import {remoteAdmissionForOperation} from '../src/owner-delivery-guards.ts';
import type {RemoteOperation,RemoteItem} from '../src/remote-preparation-state.ts';
import {publicationDigest as hash} from '../src/publication-policy.ts';

type Fixture=Awaited<ReturnType<typeof ownerDeliveryFixture>>;
const commands=(x:Fixture)=>new TaskReviewCommands(x.db,ownerReviewHooks);
const coordinator=(x:Fixture)=>new TaskReviewCoordinator(x.db,x.service.instanceId,ownerReviewHooks);
const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;

suite('review correction original delivery effects',()=>{
 it('revokes while merge credentials are held and prevents the old worker from mutating or reviving its batch',async()=>{
  const x=await reviewDeliveryWorkerFixture();let release:()=>void=()=>{};let working:Promise<void>|undefined;
  try{
   await x.prepareChecks();let entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve});x.state.gate=new Promise<void>(resolve=>{release=resolve});x.state.entered=entered;
   working=x.pump();await Promise.race([ready,working.then(()=>{throw new Error("Worker did not request merge credentials")})]);
   const requested=await commands(x).command(x.token,await correction(x));release();await working;
   expect(x.calls.filter(c=>c.method==='PUT')).toEqual([]);
   expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch).toMatchObject({status:'revoked',cancel_allowed:false,retry_allowed:false});
   expect((await x.db.pool.query('SELECT state,accepted_delivery_operation_id FROM tasks WHERE id=$1',[x.f.task])).rows[0]).toEqual({state:'REVIEW',accepted_delivery_operation_id:null});
   expect(x.state.pr).toMatchObject({state:'open',merged:false});
   expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_finalizations')).rows[0].n).toBe('0');
   await coordinator(x).pump();expect((await x.db.pool.query('SELECT source_id FROM task_review_operations WHERE id=$1',[requested.operation_id])).rows[0].source_id).not.toBeNull();
  }finally{release();await working?.catch(()=>{});await x.close();}
 });

 it.each([false,true])('denies a pending push (previously sent: %s) and permanently fences its old accepted identity after fresh acceptance',async previouslySent=>{
  const credential=randomUUID(),x=await ownerDeliveryFixture('modified',ownerDeliveryHooks,{runnerCredential:credential});
  try{
   const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),accepted=await x.acceptDelivery(p,c),old=(await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1',[x.f.task])).rows[0]!;
   const profiles:string[]=[];const provider=new GitHubRemote(new GitHub(x.service.options.signingKey),{acquireGrant:async(scope,profile)=>{profiles.push(profile);return {token:'memory-only-review-preclaim',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:scope.repository_id,permissions:remoteProfile(scope,profile)};}});
   const remote=new RemotePreparation(x.db,x.service.instanceId,provider);await x.db.pool.query('UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()');if(previouslySent)expect(await remote.pending(x.f.runner,x.f.incarnation,true)).toHaveLength(1);
   const requested=await commands(x).command(x.token,await correction(x));
   await expect(new RemotePreparationAccess(x.service,provider).access(credential,old.id,{schema_version:1,incarnation:x.f.incarnation,request_digest:old.request_digest,purpose:'push',attempt_id:randomUUID()})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   expect(profiles).toEqual([]);expect(requested.revoked_batch?.operation_id).toBe(accepted.operation_id);
   expect((await x.db.pool.query('SELECT state,may_have_mutated,effect_owned FROM remote_preparation_operations WHERE id=$1',[old.id])).rows[0]).toEqual({state:'revoked',may_have_mutated:false,effect_owned:false});
   await commands(x).command(x.token,{schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'withdraw_review_feedback',payload:{feedback_id:requested!.feedback_id,operation_id:requested!.operation_id,expected_version:requested!.operation_version}});await coordinator(x).pump();
   await remote.pump();const ordinary=(await x.db.pool.query<RemoteOperation>("SELECT * FROM remote_preparation_operations WHERE item_id=$1 AND active",[old.item_id])).rows[0]!;expect(ordinary.id).not.toBe(old.id);expect(ordinary.state).toBe('pending');expect((await x.db.pool.query('SELECT 1 FROM owner_delivery_preparation_links WHERE operation_id=$1',[ordinary.id])).rowCount).toBe(0);
   const currentIncarnation=previouslySent?await x.service.connect(x.f.runner,randomUUID()):x.f.incarnation;await x.service.touch(x.f.runner,currentIncarnation,true);
   if(previouslySent){
   const replay=await remote.pending(x.f.runner,currentIncarnation,true);expect(replay).toHaveLength(1);expect(replay[0]!.publication_push!.operation_id).toBe(old.id);
   const observation={schema_version:1,observation_id:randomUUID(),operation_id:old.id,item_id:old.item_id,task_id:x.f.task,resource_id:old.resource_id,runner_id:old.runner_id,storage_id:old.request.storage_id,repository_identity:old.request.repository_identity,repository_id:old.request.repository_id,delivery_ref:old.request.delivery_ref,status:'unavailable',reason:'access_denied',observed_at:new Date().toISOString()};
   const result=validate<PublicationPushResult>('PublicationPushResult',{schema_version:1,operation_id:old.id,request_digest:old.request_digest,item_id:old.item_id,delivery_ref:old.request.delivery_ref,candidate_head:old.request.prepared.candidate!.head,candidate_manifest_digest:old.request.prepared.candidate_manifest_digest,push_started:false,worker_absent:true,status:'blocked',reason:'access_denied',observation,observation_digest:hash(observation)});
   const ack=await remote.finish(x.f.runner,currentIncarnation,result);expect(await remote.finish(x.f.runner,currentIncarnation,result)).toEqual(ack);await expect(remote.finish(x.f.runner,currentIncarnation,{...result,reason:'retained_unavailable'})).rejects.toMatchObject({detail:{code:'payload_conflict'}});
   expect((await x.db.pool.query('SELECT state,result FROM remote_preparation_operations WHERE id=$1',[old.id])).rows[0]).toEqual({state:'revoked',result:null});
   }
   expect((await remote.pending(x.f.runner,currentIncarnation,true)).map(f=>f.publication_push!.operation_id)).toEqual([ordinary.id]);
   const fresh=await x.prepareDelivery(),confirmed=await x.confirmDelivery(fresh),replacement=await x.acceptDelivery(fresh,confirmed);expect(replacement.operation_id).not.toBe(accepted.operation_id);expect(confirmed.confirmation_id).not.toBe(c.confirmation_id);
   const item=(await x.db.pool.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE task_id=$1',[x.f.task])).rows[0]!;
   await expect(transaction(x.db,async tx=>{await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[x.f.task]);return remoteAdmissionForOperation(tx,item,old.request.preparation,old.request.prepared,old.id);})).rejects.toMatchObject({detail:{code:'unmet_precondition',message:'cancel_requested'}});
   await expect(x.db.pool.query('UPDATE tasks SET accepted_delivery_operation_id=$2,accepted_delivery_input_cutoff=$3 WHERE id=$1',[x.f.task,accepted.operation_id,accepted.input_cutoff])).rejects.toMatchObject({code:'23514'});
  }finally{await x.close();}
 });

 it('retains an admitted original push during token I/O and waits for its exact worker-absence settlement before routing',async()=>{
  const credential=randomUUID(),x=await ownerDeliveryFixture('modified',ownerDeliveryHooks,{runnerCredential:credential});
  try{
   const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),accepted=await x.acceptDelivery(p,c),old=(await x.db.pool.query<RemoteOperation>('SELECT * FROM remote_preparation_operations WHERE task_id=$1',[x.f.task])).rows[0]!;
   let requested:Awaited<ReturnType<TaskReviewCommands['command']>>|undefined;const profiles:string[]=[];
   const provider=new GitHubRemote(new GitHub(x.service.options.signingKey),{acquireGrant:async(scope,profile)=>{profiles.push(profile);if(profile==='push')requested=await commands(x).command(x.token,await correction(x));return {token:'memory-only-review-original-push',expires_at:new Date(Date.now()+3600_000).toISOString(),repository_id:scope.repository_id,permissions:remoteProfile(scope,profile)};}});
   const remote=new RemotePreparation(x.db,x.service.instanceId,provider);await x.db.pool.query('UPDATE github_remote_cooldowns SET next_request_at=clock_timestamp()');await remote.pending(x.f.runner,x.f.incarnation,true);
   await expect(new RemotePreparationAccess(x.service,provider).access(credential,old.id,{schema_version:1,incarnation:x.f.incarnation,request_digest:old.request_digest,purpose:'push',attempt_id:randomUUID()})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   expect(profiles).toEqual(['push']);expect(requested!.revoked_batch!.operation_id).toBe(accepted.operation_id);
   expect((await x.db.pool.query('SELECT state,may_have_mutated,effect_owned,reconcile_only FROM remote_preparation_operations WHERE id=$1',[old.id])).rows[0]).toEqual({state:'started',may_have_mutated:true,effect_owned:true,reconcile_only:true});
   const review=coordinator(x);await review.pump();expect((await x.db.pool.query('SELECT source_id,settlement_pending FROM task_review_operations WHERE id=$1',[requested!.operation_id])).rows[0]).toEqual({source_id:null,settlement_pending:true});
   const observation={schema_version:1,observation_id:randomUUID(),operation_id:old.id,item_id:old.item_id,task_id:x.f.task,resource_id:old.resource_id,runner_id:old.runner_id,storage_id:old.request.storage_id,repository_identity:old.request.repository_identity,repository_id:old.request.repository_id,delivery_ref:old.request.delivery_ref,status:'absent',observed_at:new Date().toISOString()};
   const result=validate<PublicationPushResult>('PublicationPushResult',{schema_version:1,operation_id:old.id,request_digest:old.request_digest,item_id:old.item_id,delivery_ref:old.request.delivery_ref,candidate_head:old.request.prepared.candidate!.head,candidate_manifest_digest:old.request.prepared.candidate_manifest_digest,push_started:false,worker_absent:true,status:'blocked',reason:'access_denied',observation,observation_digest:hash(observation)});
   await remote.finish(x.f.runner,x.f.incarnation,result);await x.db.pool.query('UPDATE task_review_operations SET due_at=clock_timestamp()');await review.pump();
   expect((await x.db.pool.query('SELECT source_id,settlement_pending FROM task_review_operations WHERE id=$1',[requested!.operation_id])).rows[0]).toMatchObject({settlement_pending:false});expect((await x.db.pool.query('SELECT count(*) n FROM task_review_sources')).rows[0].n).toBe('1');
   expect((await x.reads.batch(x.token,x.f.task,accepted.operation_id!)).revocation).toMatchObject({settled:true});expect((await x.db.pool.query('SELECT count(*) n FROM remote_preparation_operations')).rows[0].n).toBe('1');
  }finally{await x.close();}
 });
});

// A separate backend process holds the real Owner transaction at COMMIT. Only
// private stdin carries credentials; stdout contains SQL PID and public results.
function independentReview(x:Fixture,command:OwnerReviewCommand){
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./fixtures/owner-delivery-transaction-child.ts',import.meta.url))],{stdio:['pipe','pipe','pipe']});
 let resolve:(pid:number)=>void=()=>{},reject:(error:Error)=>void=()=>{},bytes='',errors='';const ready=new Promise<number>((r,j)=>{resolve=r;reject=j});
 child.stdout.on('data',chunk=>{bytes+=chunk.toString();let at;while((at=bytes.indexOf('\n'))>=0){const row=JSON.parse(bytes.slice(0,at));bytes=bytes.slice(at+1);if(row.boundary==='before_commit')resolve(row.pid);}});child.stderr.on('data',chunk=>{errors+=chunk.toString()});
 const done=new Promise<number|null>(r=>child.once('exit',code=>{if(code!==0)reject(new Error('Independent review failed: '+errors.slice(0,1000)));r(code)}));child.stdin.write(JSON.stringify({database_url:x.databaseUrl,token:x.token,command,family:'review',mode:'hold'})+'\n');return {child,ready,done};
}

suite('review correction versus original merge Task locks',()=>{
 it('observes correction holding the Task lock before a separate worker transaction and records zero merge mutation',async()=>{
  const x=await reviewDeliveryWorkerFixture();let child:ReturnType<typeof independentReview>|undefined;let working:Promise<void>|undefined;
  try{await x.prepareChecks();child=independentReview(x,await correction(x));const holder=await child.ready;working=x.pump();
   await expect.poll(async()=> (await x.admin.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[holder])).rowCount,{timeout:5000}).toBeGreaterThan(0);
   child.child.stdin.write('release\n');expect(await child.done).toBe(0);await working;expect(x.calls.filter(c=>c.method==='PUT')).toEqual([]);expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch.status).toBe('revoked');
  }finally{if(child){child.child.kill('SIGKILL');await child.done;}await working?.catch(()=>{});await x.close();}
 },20000);
 it('observes actual merge admission holding the Task lock before correction, rejects correction and records exact finality',async()=>{
  const x=await reviewDeliveryWorkerFixture();let release:()=>void=()=>{};const connect=x.db.pool.connect.bind(x.db.pool),workerPool=Object.create(x.db.pool) as typeof x.db.pool;workerPool.query=x.db.pool.query.bind(x.db.pool);let working:Promise<void>|undefined;
  try{await x.prepareChecks();const command=await correction(x);let entered:(pid:number)=>void=()=>{};const held=new Promise<number>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r});let claimed=false;
   workerPool.connect=(async()=>{const client=await connect(),query=client.query.bind(client) as (...a:unknown[])=>Promise<unknown>,wrapped=Object.create(client) as typeof client;wrapped.release=client.release.bind(client);let mergeAdmission=false;
    wrapped.query=(async(...a:unknown[])=>{if(typeof a[0]==='string'&&a[0].startsWith("UPDATE owner_delivery_merge_operations SET status='started'"))mergeAdmission=true;
     if(a[0]==='COMMIT'&&mergeAdmission&&!claimed){claimed=true;const pid=await query('SELECT pg_backend_pid() pid') as {rows:{pid:number}[]};entered(pid.rows[0]!.pid);await gate;}return query(...a);}) as typeof client.query;return wrapped;}) as typeof x.db.pool.connect;
   working=x.pump(new OwnerDeliveryWorker({...x.db,pool:workerPool},x.service.instanceId,new GitHubFinalization(x.provider)));const holder=await Promise.race([held,working.then(async()=>{throw new Error("Merge did not enter admission: "+JSON.stringify((await x.db.pool.query("SELECT status,attention_reason,checkpoint FROM owner_delivery_batches")).rows))})]);const following=commands(x).command(x.token,command).then(value=>({value}),error=>({error}));
   await expect.poll(async()=> (await x.admin.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[holder])).rowCount,{timeout:5000}).toBeGreaterThan(0);
   release();expect(await following).toMatchObject({error:{detail:{code:'unmet_precondition'}}});await working;expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).batch).toMatchObject({status:'completed',finalized_items:1});expect((await x.db.pool.query('SELECT count(*) n FROM task_review_feedback')).rows[0].n).toBe('0');
  }finally{release();await working?.catch(()=>{});await x.close();}
 },20000);
});
