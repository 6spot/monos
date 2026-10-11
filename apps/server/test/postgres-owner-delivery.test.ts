import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
import type {Transaction} from '../../../packages/db/src/index.ts';
import type {DeliveryAcceptanceManifest} from '../../../packages/protocol/src/index.ts';
import {database,transaction} from '../../../packages/db/src/index.ts';
import {migrate} from '../../../packages/db/src/migrate.ts';
import {ProtocolValidationError} from '../../../packages/protocol/src/index.ts';
import {ownerDeliveryFixture} from './fixtures/owner-delivery-fixture.ts';
import {OwnerCommands,prepareTaskProposal} from '../src/owner-commands.ts';
import {publicationDigest as hash} from '../src/publication-policy.ts';
import {assertDeliveryBatchAuthority,deliveryBatch} from '../src/owner-delivery-state.ts';
import {ownerDeliveryHooks} from '../src/owner-delivery-control.ts';
import {initializeTask} from '../src/task-records.ts';

function independentCommand(input:{database_url:string;token:string;command:unknown;family:'delivery'|'conversation';mode:'hold'|'kill_before'|'kill_after'}){
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('./fixtures/owner-delivery-transaction-child.ts',import.meta.url))],{stdio:['pipe','pipe','pipe']});
 let resolveReady:(pid:number)=>void=()=>{},rejectReady:(error:Error)=>void=()=>{},bytes='',errors='';const records:{boundary:string;pid?:number;result?:unknown}[]=[];
 const ready=new Promise<number>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 child.stdout.on('data',chunk=>{bytes+=chunk.toString();let n;while((n=bytes.indexOf('\n'))>=0){const row=JSON.parse(bytes.slice(0,n));bytes=bytes.slice(n+1);records.push(row);if(row.boundary==='before_commit')resolveReady(row.pid);}});
 child.stderr.on('data',chunk=>{errors+=chunk.toString();});
 const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>{if(!records.length)rejectReady(new Error('Independent command did not reach commit boundary: '+errors.slice(0,1200)));resolve({code,signal});}));
 child.stdin.write(JSON.stringify(input)+'\n');return {child,ready,done,records};
}

// Only negative tests call this deliberately forged direct-SQL chain. Successful
// acceptance tests always use the actual authenticated Owner command path.
async function forgedSQLAdmission(tx:Transaction,taskId:string,manifest:DeliveryAcceptanceManifest){
    const proposal=await prepareTaskProposal(tx,{id:randomUUID(),task_id:taskId,action:'accept_delivery',content:manifest});
    const prepareId=randomUUID(),confirmId=randomUUID(),admissionId=randomUUID(),authorization=randomUUID(),batchId=randomUUID();
    const receipt=async(requestId:string,name:string,payload:object,outcome:object)=>{const envelope={schema_version:1,task_id:taskId,request_id:requestId,name,payload};await tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[taskId,requestId,hash(envelope),envelope,{schema_version:1,task_id:taskId,request_id:requestId,status:'committed',name,...outcome}]);};
    await tx.query('INSERT INTO owner_delivery_proposals(proposal_id,task_id,request_id) VALUES($1,$2,$3)',[proposal.proposal_id,taskId,prepareId]);
    await receipt(prepareId,'prepare_delivery_acceptance',{basis:manifest.basis},{proposal_id:proposal.proposal_id,content_digest:proposal.content_digest});
    await tx.query('INSERT INTO authorization_receipts(id,proposal_id,consumed_by) VALUES($1,$2,$3)',[authorization,proposal.proposal_id,admissionId]);
    await tx.query('INSERT INTO owner_delivery_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[authorization,taskId,confirmId]);
    await receipt(confirmId,'confirm_delivery_acceptance',{proposal_id:proposal.proposal_id,content_digest:proposal.content_digest},{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest});
    await receipt(admissionId,'accept_delivery',{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest,basis:manifest.basis},{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest,operation_id:batchId,operation_version:1,input_cutoff:0});
    await tx.query('INSERT INTO owner_delivery_batches(id,task_id,manifest,content_digest,proposal_id,confirmation_id,admission_request_id,input_cutoff) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[batchId,taskId,manifest,proposal.content_digest,proposal.proposal_id,authorization,admissionId]);
    for(const [ordinal,r] of manifest.repositories.entries()){
     if(r.item_id){const url=(await tx.query('SELECT remote_url FROM project_resources WHERE id=$1',[r.resource_id])).rows[0]!.remote_url;
      await tx.query('INSERT INTO remote_preparation_items(item_id,task_id,resource_id,runner_id,storage_id,repository_identity,repository_id,remote_url,delivery_ref,target_branch,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(item_id) DO NOTHING',[r.item_id,taskId,r.resource_id,r.source.runner_id,r.source.storage_id,r.repository_identity,r.provider_metadata.github!.repository_id,url,r.delivery_ref,r.target_branch,r.marker]);}
     await tx.query('INSERT INTO owner_delivery_batch_items(batch_id,ordinal,task_id,item_id,resource_id,repository,repository_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[batchId,ordinal,taskId,r.item_id??null,r.resource_id,r,hash(r)]);
    }
}

const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('exact Owner delivery authority',()=>{
 it('uses dedicated authenticated prepare/confirm/Accept and completes repository-free output with immutable exact receipt replay',async()=>{
  const x=await ownerDeliveryFixture();try{
   const p=await x.prepareDelivery(),detail=await x.reads.proposal(x.token,x.f.task,p.proposal_id!);expect(detail.manifest.outputs).toHaveLength(1);expect(detail.manifest.outputs[0]!.repository_free).toBe(true);expect(detail.manifest.repositories).toEqual([]);
   await expect(new OwnerCommands(x.db).confirm(x.token,{schema_version:1,scope_id:x.f.task,request_id:randomUUID(),expected_control_version:await x.version(),name:'confirm_proposal',payload:{proposal_id:p.proposal_id,content_digest:p.content_digest}})).rejects.toMatchObject({detail:{code:'denied_scope'}});
   const c=await x.confirmDelivery(p),requestId=randomUUID(),result=await x.acceptDelivery(p,c,requestId);
   expect(result).toMatchObject({status:'committed',name:'accept_delivery',operation_version:1,input_cutoff:0});
   expect((await x.db.pool.query('SELECT state,accepted_delivery_operation_id FROM tasks WHERE id=$1',[x.f.task])).rows[0]).toEqual({state:'COMPLETED',accepted_delivery_operation_id:result.operation_id});
   await transaction(x.db,async tx=>assertDeliveryBatchAuthority(tx,await deliveryBatch(tx,x.f.task,result.operation_id!)));
   const original=(await x.db.pool.query('SELECT envelope FROM owner_delivery_command_receipts WHERE task_id=$1 AND request_id=$2',[x.f.task,requestId])).rows[0]!.envelope;
   expect(await x.commands.command(x.token,original)).toEqual(result);expect(await x.commands.status(x.token,x.f.task,requestId)).toEqual(result);
   await expect(x.commands.command(x.token,{...original,payload:{...original.payload,proposal_id:randomUUID()}})).rejects.toMatchObject({detail:{code:'payload_conflict'}});
   await expect(x.deliveryCommand('cancel_delivery',{operation_id:result.operation_id,content_digest:result.content_digest,expected_version:1})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   expect((await x.reads.batch(x.token,x.f.task,result.operation_id!)).batch).toMatchObject({status:'completed',modified_items:0,finalized_items:0,cancel_allowed:false});expect(x.grantCalls()).toBe(0);
   expect((await x.db.pool.query("SELECT kind FROM task_events WHERE task_id=$1 AND kind IN ('delivery_accepted','delivery_completed') ORDER BY sequence",[x.f.task])).rows.map(r=>r.kind)).toEqual(['delivery_accepted','delivery_completed']);
  }finally{await x.close();}
 });
 it('rejects missing SQL authority, direct pointers, missing JSON and modified unsupported mode before consuming confirmation',async()=>{
  const x=await ownerDeliveryFixture('modified');try{
   const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),detail=await x.reads.proposal(x.token,x.f.task,p.proposal_id!);expect(detail.manifest.repositories[0]).toMatchObject({outcome:'modified',scan:{status:'complete',workflow_changes:false}});expect(x.grantCalls()).toBe(1);
   const before=(await x.db.pool.query('SELECT state,control_version,accepted_delivery_operation_id,accepted_delivery_input_cutoff FROM tasks WHERE id=$1',[x.f.task])).rows[0];
   await expect(x.db.pool.query('UPDATE tasks SET accepted_delivery_operation_id=$2,accepted_delivery_input_cutoff=0 WHERE id=$1',[x.f.task,randomUUID()])).rejects.toMatchObject({code:'23514',message:'Accepted pointer must install a fresh unrevoked live batch'});
   expect((await x.db.pool.query('SELECT state,control_version,accepted_delivery_operation_id,accepted_delivery_input_cutoff FROM tasks WHERE id=$1',[x.f.task])).rows[0]).toEqual(before);
   expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1',[c.confirmation_id])).rows[0]!.consumed_by).toBeNull();
   await expect(transaction(x.db,tx=>tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[x.f.task,randomUUID(),'a'.repeat(64),{},{schema_version:1}]))).rejects.toMatchObject({code:'23514'});
   await expect(x.db.pool.query('INSERT INTO authorization_receipts(id,proposal_id) VALUES($1,$2)',[randomUUID(),p.proposal_id])).rejects.toMatchObject({code:'23505'});
   await expect(x.db.pool.query("UPDATE task_command_proposals SET content=content||'{\"task_id\":\"wrong\"}'::jsonb WHERE id=$1",[p.proposal_id])).rejects.toMatchObject({code:'23514'});
   await expect(transaction(x.db,async tx=>{
    const requestId=randomUUID(),batchId=randomUUID();await tx.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1',[c.confirmation_id,requestId]);
    await tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[x.f.task,requestId,'a'.repeat(64),{schema_version:1,task_id:x.f.task,request_id:requestId,name:'accept_delivery',payload:{}},{schema_version:1,task_id:x.f.task,request_id:requestId,status:'committed',name:'accept_delivery'}]);
    await tx.query('INSERT INTO owner_delivery_batches(id,task_id,manifest,content_digest,proposal_id,confirmation_id,admission_request_id,input_cutoff) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[batchId,x.f.task,detail.manifest,p.content_digest,p.proposal_id,c.confirmation_id,requestId]);
   })).rejects.toMatchObject({code:'23514'});
   await x.db.pool.query("UPDATE project_resources SET settings=settings||'{\"remote_preparation\":\"after_acceptance\"}'::jsonb WHERE id=$1",[detail.manifest.repositories[0]!.resource_id]);
   await expect(x.acceptDelivery(p,c)).rejects.toMatchObject({detail:{code:'unmet_precondition'}});expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1',[c.confirmation_id])).rows[0]!.consumed_by).toBeNull();expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_batches')).rows[0]!.n).toBe('0');
  }finally{await x.close();}
 });
 it('retains true no-change preparation and completes locally without a permission grant or fabricated repository identity',async()=>{
  const x=await ownerDeliveryFixture('no_change');try{const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),detail=await x.reads.proposal(x.token,x.f.task,p.proposal_id!);expect(detail.manifest.repositories).toHaveLength(1);expect(detail.manifest.repositories[0]!.outcome).toBe('no_change');expect(detail.manifest.repositories[0]!.candidate).toBeUndefined();const result=await x.acceptDelivery(p,c);expect((await x.reads.batch(x.token,x.f.task,result.operation_id!)).batch.status).toBe('completed');expect(x.grantCalls()).toBe(0);}finally{await x.close();}
 });
 it('rejects duplicate selected artifacts and altered metadata even under a shape-consistent forged SQL receipt chain',async()=>{
  const x=await ownerDeliveryFixture('repository_free',{}, {artifactCount:2});try{
   const p=await x.prepareDelivery(),detail=await x.reads.proposal(x.token,x.f.task,p.proposal_id!);expect(detail.manifest.outputs[0]!.artifacts).toHaveLength(2);
   for(const forgery of ['duplicate','metadata','completion'])await expect(transaction(x.db,async tx=>{
    // Deliberately untrusted direct SQL, not a genuine Owner confirmation. The
    // complete forged chain must still fail selected-evidence enforcement.
    const manifest=structuredClone(detail.manifest),selected=manifest.outputs[0]!.artifacts;
    if(forgery==='duplicate')selected[1]=structuredClone(selected[0]!);else if(forgery==='metadata')selected[0]!.title='Forged metadata';else manifest.outputs[0]!.completion.node_id=randomUUID();
    await forgedSQLAdmission(tx,x.f.task,manifest);
   })).rejects.toMatchObject({code:'23514',message:'Delivery output attribution or selected evidence differs'});
   const c=await x.confirmDelivery(p),accepted=await x.acceptDelivery(p,c);expect((await x.reads.batch(x.token,x.f.task,accepted.operation_id!)).manifest.outputs[0]!.artifacts).toEqual(detail.manifest.outputs[0]!.artifacts);
  }finally{await x.close();}
 });
 it('rejects a forged local-only batch omitting the canonical Git output repository',async()=>{
  const x=await ownerDeliveryFixture('modified');try{
   const p=await x.prepareDelivery(),detail=await x.reads.proposal(x.token,x.f.task,p.proposal_id!);
   expect(detail.manifest.outputs[0]!.repository_free).toBe(false);expect(detail.manifest.repositories).toHaveLength(1);
   const manifest=structuredClone(detail.manifest);manifest.repositories=[];
   await expect(transaction(x.db,tx=>forgedSQLAdmission(tx,x.f.task,manifest))).rejects.toMatchObject({code:'23514',message:'Delivery repository set differs from Git outputs'});
   expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_batches')).rows[0]!.n).toBe('0');
  }finally{await x.close();}
 });
 it('serializes actual message and Accept in both orders with independently observed Task lock contention',async()=>{
  for(const acceptFirst of [false,true]){
   const x=await ownerDeliveryFixture('modified',ownerDeliveryHooks);let child:ReturnType<typeof independentCommand>|undefined;
   try{
    const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),accept={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'accept_delivery',payload:{proposal_id:p.proposal_id,confirmation_id:c.confirmation_id,content_digest:p.content_digest,basis:await x.deliveryBasis()}},message={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'submit_task_message',payload:{message_id:randomUUID(),content:'Independent actual Owner input'}};
    child=independentCommand({database_url:x.databaseUrl,token:x.token,command:acceptFirst?accept:message,family:acceptFirst?'delivery':'conversation',mode:'hold'});const holder=await child.ready;
    const following=acceptFirst?x.conversation.command(x.token,message):x.commands.command(x.token,accept);
    const settled=following.then(value=>({value}),error=>({error}));
    await expect.poll(async()=>{const rows=await x.admin.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[holder]);return rows.rows.map(r=>r.pid).filter(pid=>pid!==holder);},{timeout:5000}).not.toEqual([]);
    child.child.stdin.write('release\n');expect(await child.done).toMatchObject({code:0,signal:null});const after=await settled;
    const attribution=(await x.db.pool.query('SELECT accepted_delivery_operation_id FROM task_inputs WHERE message_id=$1',[message.payload.message_id])).rows[0]!.accepted_delivery_operation_id;
    if(acceptFirst){expect('error' in after?after.error:undefined).toBeUndefined();const batch=(await x.db.pool.query('SELECT * FROM owner_delivery_batches')).rows[0]!;expect(attribution).toBe(batch.id);expect(Number(batch.input_cutoff)).toBe(0);expect((await x.db.pool.query('SELECT state FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.state).toBe('REVIEW');await transaction(x.db,tx=>assertDeliveryBatchAuthority(tx,batch));}
    else {expect(after).toMatchObject({error:{detail:{code:'unmet_precondition',message:'input_pending'}}});expect(attribution).toBeNull();expect((await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1',[c.confirmation_id])).rows[0]!.consumed_by).toBeNull();expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_batches')).rows[0]!.n).toBe('0');}
   }finally{if(child){child.child.kill('SIGKILL');await child.done;}await x.close();}
  }
 },20000);
 it('rolls back before COMMIT process death and recovers the immutable receipt after COMMIT process death',async()=>{
  for(const mode of ['kill_before','kill_after'] as const){
   const x=await ownerDeliveryFixture();let child:ReturnType<typeof independentCommand>|undefined;
   try{const p=await x.prepareDelivery(),c=await x.confirmDelivery(p),requestId=randomUUID(),command={schema_version:1,task_id:x.f.task,request_id:requestId,name:'accept_delivery',payload:{proposal_id:p.proposal_id,confirmation_id:c.confirmation_id,content_digest:p.content_digest,basis:await x.deliveryBasis()}};
    child=independentCommand({database_url:x.databaseUrl,token:x.token,command,family:'delivery',mode});await child.ready;expect(await child.done).toMatchObject({signal:'SIGKILL'});
    const receipt=await x.commands.status(x.token,x.f.task,requestId),consumed=(await x.db.pool.query('SELECT consumed_by FROM authorization_receipts WHERE id=$1',[c.confirmation_id])).rows[0]!.consumed_by;
    if(mode==='kill_before'){expect(receipt.status).toBe('unknown');expect(consumed).toBeNull();expect((await x.db.pool.query('SELECT accepted_delivery_operation_id FROM tasks WHERE id=$1',[x.f.task])).rows[0]!.accepted_delivery_operation_id).toBeNull();}
    else {expect(receipt.status).toBe('committed');expect(consumed).toBe(requestId);expect(await x.commands.command(x.token,command)).toEqual(receipt);expect((await x.db.pool.query('SELECT count(*) n FROM owner_delivery_batches')).rows[0]!.n).toBe('1');}
   }finally{if(child){child.child.kill('SIGKILL');await child.done;}await x.close();}
  }
 },20000);
 it('upgrades exact version 23 to version 26 and atomically refuses legacy nonnull seam values without changing history',async()=>{
  for(const legacy of [false,true]){
   const url=new URL(process.env.DATABASE_URL!),admin=database(url.toString()),schema='delivery_upgrade_'+randomUUID().replaceAll('-','');await admin.pool.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema}`);const db=database(url.toString());
   try{
    await db.pool.query('CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL)');const files=(await readdir(new URL('../../../packages/db/migrations/',import.meta.url))).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
    for(const [i,file] of files.slice(0,23).entries()){const sql=await readFile(new URL('../../../packages/db/migrations/'+file,import.meta.url),'utf8');await db.pool.query(sql);await db.pool.query('INSERT INTO schema_migrations VALUES($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}
    const old=(await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
    if(legacy){const task=randomUUID();await transaction(db,tx=>initializeTask(tx,{task_id:task,specification_id:randomUUID(),specification:'Legacy seam test'}));await db.pool.query('UPDATE tasks SET accepted_delivery_operation_id=$2,accepted_delivery_input_cutoff=0 WHERE id=$1',[task,randomUUID()]);await expect(migrate(db)).rejects.toMatchObject({code:'23514'});expect((await db.pool.query("SELECT to_regclass('owner_delivery_batches') present")).rows[0]!.present).toBeNull();expect((await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows).toEqual(old);expect((await db.pool.query('SELECT accepted_delivery_operation_id FROM tasks')).rows[0]!.accepted_delivery_operation_id).not.toBeNull();}
    else {await migrate(db);expect((await db.pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows.slice(0,23)).toEqual(old);expect((await db.pool.query('SELECT max(version) v FROM schema_migrations')).rows[0]!.v).toBe(26);}
   }finally{await db.pool.end();await admin.pool.query(`DROP SCHEMA ${schema} CASCADE`);await admin.pool.end();}
  }
 },20000);
 it('pages actual proposal history with exact microsecond keysets while current authority stays independent',async()=>{
  const x=await ownerDeliveryFixture();try{
   const ids=[];for(let i=0;i<65;i++)ids.push((await x.prepareDelivery()).proposal_id!);
   const first=await x.reads.task(x.token,x.f.task);expect(first.proposals).toHaveLength(64);expect(first.proposals_has_more).toBe(true);expect(first.next_proposal_cursor).toBeTruthy();
   const next=await x.reads.task(x.token,x.f.task,{proposal_cursor:first.next_proposal_cursor});expect(next.proposals.map(p=>p.proposal_id)).toEqual([ids[0]]);expect(next.accept_allowed).toBe(true);expect(next.proposals_has_more).toBe(false);expect(next.next_proposal_cursor).toBeUndefined();
   const value=JSON.parse(Buffer.from(first.next_proposal_cursor!,'base64url').toString('utf8'));value.task_id=randomUUID();const crossed=Buffer.from(JSON.stringify(value)).toString('base64url');await expect(x.reads.task(x.token,x.f.task,{proposal_cursor:crossed})).rejects.toMatchObject({detail:{code:'denied_scope'}});
   await expect(x.reads.task(x.token,x.f.task,{proposal_cursor:first.next_proposal_cursor+'='})).rejects.toBeInstanceOf(ProtocolValidationError);
  }finally{await x.close();}
 },20000);
});
