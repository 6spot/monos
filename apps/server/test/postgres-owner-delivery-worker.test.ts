import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {OwnerDeliveryWorker} from '../src/owner-delivery-worker.ts';
import {GitHubFinalization} from '../src/github-finalization.ts';
import {GitHub} from '../src/github.ts';
import {Configuration} from '../src/configuration.ts';
import {reviewDeliveryWorkerFixture as fixture,reviewCorrectionEnvelope} from './fixtures/review-delivery-worker-fixture.ts';
import {TaskReviewCommands} from '../src/task-review-commands.ts';
import {ownerReviewHooks} from '../src/owner-review-control.ts';

const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('accepted GitHub worker durable boundary',()=>{
 it('accepts current mapped carry with zero new commits as modified and finalizes the same PR/head',async()=>{
  const x=await fixture(true);try {
   const correction=await reviewCorrectionEnvelope(x);
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
   await expect(new TaskReviewCommands(x.db,ownerReviewHooks).command(x.token,correction)).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   expect((await x.db.pool.query('SELECT count(*) n FROM task_review_feedback')).rows[0]!.n).toBe('0');
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
   const correction=await reviewCorrectionEnvelope(x);await x.prepareChecks();x.state.drop=true;await x.pump();
   const original=(await x.db.pool.query('SELECT id,request_digest,status,effect_owned FROM owner_delivery_merge_operations')).rows[0]!;expect(original).toMatchObject({status:'unknown',effect_owned:true});
   await expect(new TaskReviewCommands(x.db,ownerReviewHooks).command(x.token,correction)).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_revocations')).rows[0]!.n).toBe('0');
   const merged={...x.state.pr!};Object.assign(x.state.pr!,{state:'open',merged:false,merged_at:null,merge_commit_sha:'e'.repeat(40)});
   const restarted=new OwnerDeliveryWorker(x.db,randomUUID(),new GitHubFinalization(x.provider));await x.pump(restarted);
   expect((await x.db.pool.query('SELECT status,effect_owned FROM owner_delivery_merge_operations')).rows[0]).toEqual({status:'unknown',effect_owned:true});
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
   await x.cancel();
   expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).items[0]).toMatchObject({status:'cancelled',reconciliation:'waiting_original_merge'});
   await x.due();await x.remote.pump();expect(x.calls.filter(c=>c.method==='PATCH')).toHaveLength(0);
   Object.assign(x.state.pr!,merged);await x.pump(restarted);await x.remote.pump();
   expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(x.calls.filter(c=>c.method==='POST')).toHaveLength(1);
   expect((await x.db.pool.query('SELECT id,request_digest,status FROM owner_delivery_merge_operations')).rows[0]).toEqual({id:original.id,request_digest:original.request_digest,status:'succeeded'});
   expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('CANCELLED');
   expect((await x.db.pool.query('SELECT status FROM owner_delivery_batches')).rows[0]!.status).toBe('cancelled');
   expect((await x.db.pool.query('SELECT cleanup_state FROM remote_preparation_items')).rows[0]!.cleanup_state).toBe('externally_merged');
   expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_finalizations')).rows[0]!.n).toBe('1');
   expect((await x.reads.batch(x.token,x.f.task,x.accepted.operation_id!)).items[0]).toMatchObject({status:'finalized',reconciliation:'externally_merged'});
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
   await x.prepareChecks();await x.db.pool.query("UPDATE owner_delivery_item_readiness SET stage=jsonb_set(stage,'{collections,head,0,pages,0,observed_at}',to_jsonb($2::text)) WHERE batch_id=$1",[x.accepted.operation_id,new Date(Date.now()-16_000).toISOString()]);
   const pages=x.calls.filter(c=>c.path.includes('/check-runs')).length;await x.pump();expect(x.calls.filter(c=>c.path.includes('/check-runs')).length).toBeGreaterThan(pages);expect(x.calls.filter(c=>c.method==='PUT')).toHaveLength(0);
   await x.db.pool.query("UPDATE owner_delivery_item_readiness SET stage=jsonb_set(stage,'{collections,head,0,pages,0,total}','2'::jsonb) WHERE batch_id=$1",[x.accepted.operation_id]);
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
