import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { describe,expect,it,vi } from 'vitest';
import { database } from '../../../packages/db/src/index.ts';
import { Configuration } from '../src/configuration.ts';
import { createApp } from '../src/app.ts';
import { selectedTaskResult,taskResults } from '../src/task-result-reads.ts';
import { issueOwnerSession,revokeOwnerSession } from '../src/owner-commands.ts';
import { digest,validate } from '../../../packages/protocol/src/index.ts';
import type { Frame,ConfigurationCommand } from '../../../packages/protocol/src/index.ts';
import { resultReadFixture } from './fixtures/result-read-fixture.ts';

const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('Exact local result authenticated reads',()=>{
 it('drops its owned schema when result setup fails before returning the fixture',async()=>{
  const admin=database(process.env.DATABASE_URL!);
  let ownedSchema:string|undefined;
  const save=Configuration.prototype.save;
  const mock=vi.spyOn(Configuration.prototype,'save').mockImplementation(async function(this: Configuration,token,input) {
   const command=validate<ConfigurationCommand>('ConfigurationCommand',input);
   if(command.name==='save_project' && command.payload.name==='Result project') {
    ownedSchema=(await this.db.pool.query<{name:string}>('SELECT current_schema() name')).rows[0]!.name;
    throw new Error('result fixture setup failure');
   }
   return save.call(this,token,input);
  });
  try {
   await expect(resultReadFixture()).rejects.toThrow('result fixture setup failure');
   expect(ownedSchema).toMatch(/^conversation_[a-f0-9]+$/);
   expect((await admin.pool.query('SELECT nspname FROM pg_namespace WHERE nspname=$1',[ownedSchema])).rows).toEqual([]);
  } finally {mock.mockRestore();await admin.pool.end();}
 });
 it('uses correlated authenticated WSS, authenticates again after read, and preserves every canonical record',async()=>{
  const x=await resultReadFixture(),app=createApp(x.service);let socket:WebSocket|undefined;
  const selected=await selectedTaskResult(x.db,x.token,x.f.task,x.operationId,x.resource),identity=selected.git.identity_digest;
  const url=`/v1/owner/tasks/${x.f.task}/results/${x.operationId}/file?${new URLSearchParams({resource_id:x.resource,identity_digest:identity,path:'literal :path.txt',side:'result'})}`;
  const headers={authorization:`Bearer ${x.token}`};
  const ownerSession=(await x.db.pool.query('SELECT id FROM owner_sessions WHERE token_digest=$1',[digest(x.token)])).rows[0].id;
  try {
   const snapshot=async()=>{
    const names=(await x.db.pool.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('runners','owner_sessions','runtime_installations') ORDER BY tablename")).rows.map(row=>row.tablename);
    return Object.fromEntries(await Promise.all(names.map(async n=>[n,(await x.db.pool.query(`SELECT to_jsonb(t) data FROM ${n} t ORDER BY to_jsonb(t)::text`)).rows])));
   };
   const before=await snapshot();
   expect((await app.inject({url,headers})).json().status).toBe('offline');
   const runnerToken=randomUUID();await x.db.pool.query('UPDATE runners SET credential_hash=$2 WHERE id=$1',[x.f.runner,digest(runnerToken)]);
   await app.listen({host:'127.0.0.1',port:0});socket=new WebSocket(`ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1/runner`,{headers:{authorization:`Bearer ${runnerToken}`}});await once(socket,'open');
   const welcome=once(socket,'message');socket.send(JSON.stringify({schema_version:1,type:'hello',runner_id:x.f.runner,boot_id:'read-restart'}));const incarnation=JSON.parse((await welcome)[0].toString()).incarnation;
   socket.send(JSON.stringify({schema_version:1,type:'ready',incarnation,log_modes:['ordered_v1']}));
   await expect.poll(async()=> (await x.db.pool.query('SELECT ready FROM runners WHERE id=$1',[x.f.runner])).rows[0].ready).toBe(true);
   expect((await app.inject({url,headers})).json().status).toBe('unsupported');
   socket.send(JSON.stringify({schema_version:1,type:'ready',incarnation,log_modes:['ordered_v1'],result_read_modes:['git_objects_v1']}));
   const nextRead=async()=>{while(true){const f=JSON.parse((await once(socket!,'message'))[0].toString()) as Frame;if(f.type==='result_read')return f;}};
   // Barrier distinguishes received bytes from authorization: revoke while pending.
   let inbound=nextRead();const pending=app.inject({url,headers});const frame=await inbound;
   expect(frame.result_read!.identity).toEqual(selected.identity);expect(frame.result_read!.path).toBe('literal :path.txt');
   const send=(f:Frame,text='  exact\n\n')=>socket!.send(JSON.stringify({schema_version:1,type:'result_read_result',incarnation,correlation_id:f.correlation_id,result_read_result:{schema_version:1,request:f.result_read,status:'available',object:{oid:'d'.repeat(40),mode:'100644',size:Buffer.byteLength(text)},text}}));
   send(frame);const good=await pending;expect(good.statusCode).toBe(200);expect(good.json()).toMatchObject({status:'available',text:'  exact\n\n',current:true});expect(good.headers['cache-control']).toBe('no-store');expect(validate('ResultReadResponse',good.json())).toEqual(good.json());
   inbound=nextRead();const during=app.inject({url,headers});const stale=await inbound;await revokeOwnerSession(x.db,ownerSession);send(stale,'private bytes');const revoked=await during;expect(revoked.statusCode).toBe(401);expect(revoked.body).not.toContain('private bytes');
   const fresh=await issueOwnerSession(x.db);const freshHeaders={authorization:`Bearer ${fresh.token}`};
   for (const [suffix,code] of [[url.replace(identity,'e'.repeat(64)),409],[url.replace(x.operationId,randomUUID()),403],[url.replace('side=result','side=base&unknown=x'),409],[url.replace('literal+%3Apath.txt','..%2Fsecret'),409]] as const)expect((await app.inject({url:suffix,headers:freshHeaders})).statusCode).toBe(code);
   expect((await app.inject({url,headers:{...freshHeaders,'x-monos-session':randomUUID()}})).statusCode).toBe(401);
   expect((await app.inject({url:url.replace(x.f.task,randomUUID()),headers:freshHeaders})).statusCode).toBe(403);
   const changesUrl=`/v1/owner/tasks/${x.f.task}/results/${x.operationId}/changes`;
   const crossCursor=Buffer.from(JSON.stringify({after:0,identity:'f'.repeat(64),version:1})).toString('base64url');
   expect((await app.inject({url:`${changesUrl}?${new URLSearchParams({resource_id:x.resource,identity_digest:identity,cursor:crossCursor})}`,headers:freshHeaders})).statusCode).toBe(403);
   expect((await app.inject({url:`${changesUrl}?${new URLSearchParams({resource_id:x.resource,identity_digest:identity,cursor:'not-json'})}`,headers:freshHeaders})).statusCode).toBe(409);
   inbound=nextRead();const afterCancel=app.inject({url,headers:freshHeaders});const oldCurrent=await inbound;await x.db.pool.query("UPDATE tasks SET state='CANCELLED' WHERE id=$1",[x.f.task]);send(oldCurrent);expect((await afterCancel).json()).toMatchObject({status:'available',current:false});await x.db.pool.query("UPDATE tasks SET state='REVIEW' WHERE id=$1",[x.f.task]);
   expect(await snapshot()).toEqual(before);
   inbound=nextRead();const disconnected=app.inject({url,headers:freshHeaders});await inbound;socket.terminate();expect((await disconnected).json().status).toBe('offline');
  } finally {socket?.terminate();await app.close();await x.close();}
 },30000);
 it('resolves selected historical results beyond the first 32 and refuses mutable result relabeling',async()=>{
  const x=await resultReadFixture();try{
   const completed=[x.operationId];let finalized='b'.repeat(40);
   for(let index=0;index<34;index++) {
    await x.send(`Refine result ${index}`);await x.service.touch(x.f.runner,x.f.incarnation,true);
    const planner=await x.turn();const reply=await x.reply(planner,{kind:'guidance',text:`Refine result ${index}`,basis:await x.basis()});
    await x.finish(reply.operation_id!,planner.dispatch.attempt_id);await x.conversation.pump();
    const node=await x.node();const opened=await x.agent(node,'open_workspace',{resource_id:x.resource});const op=await x.service.recoverOperation(x.f.runner,opened.operation_id!),w=op.workspace!;
    const metadata={generation:w.generation,storage_id:'result-read-storage',provider_metadata:{github:{repository_id:'42'}},lease_id:w.lease_id,repository_identity:w.resource.repository_identity,base_commit:'a'.repeat(40),target_branch:'main',target_commit:'a'.repeat(40),finalized_commit:finalized};
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:op.operation_id,attempt_id:node.dispatch.attempt_id,success:true,result:{workspace_id:w.workspace_id,path:'/runner/private/worktree',instruction_files:[],workspace_metadata:metadata}});
    const handling=(await x.db.pool.query('SELECT guidance_id FROM task_guidance_assignments WHERE source_id=$1',[node.dispatch.node_execution_source!.source_id])).rows.map(r=>r.guidance_id);
    const done=await x.agent(node,'complete_node',{summary:`Result ${index}`,handled_guidance_ids:handling});
    finalized=(index+1).toString(16).padStart(40,'0');
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:done.operation_id!,attempt_id:node.dispatch.attempt_id,success:true,result:{writer_absent:true,completion_outcome:'finalized',workspace_results:[{resource_id:x.resource,workspace_id:w.workspace_id,workspace_metadata:{...metadata,finalized_commit:finalized},capture:{start_commit:metadata.finalized_commit,node_commit:finalized,node_tree:'c'.repeat(40)},git_commit:finalized,git_tree:'c'.repeat(40)}]}});
    completed.push(done.operation_id!);
   }
   const first=await taskResults(x.db,x.token,x.f.task);expect(first.items).toHaveLength(32);expect(first.has_more).toBe(true);const next=await taskResults(x.db,x.token,x.f.task,first.cursor);expect(first.items.length+next.items.length).toBe(35);
   const selectedId=completed.slice(0,-1).sort().at(-1)!;expect(first.items.some(i=>i.manifest.operation_id===selectedId)).toBe(false);
   const selected=await selectedTaskResult(x.db,x.token,x.f.task,selectedId,x.resource);expect(selected.identity.operation_id).toBe(selectedId);expect(selected.item.current).toBe(false);
   await expect(x.db.pool.query('UPDATE task_workspaces SET finalized_commit=$2 WHERE id=$1',[x.descriptor.workspace_id,'f'.repeat(40)])).rejects.toMatchObject({code:'23514'});expect(await selectedTaskResult(x.db,x.token,x.f.task,selectedId,x.resource)).toEqual(selected);
  }finally{await x.close();}
 },60000);
});
