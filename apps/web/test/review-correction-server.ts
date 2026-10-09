import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { reviewCorrectionFixture } from '../../server/test/fixtures/review-correction-fixture.ts';
import { createApp } from '../../server/src/app.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import { initializeTask } from '../../server/src/task-records.ts';

// Isolated loopback only. Owner/Agent commands and sources are genuine SQL paths.
// Runtime delivery and process absence are synthetic fixture boundaries.
if (!process.env.MONOS_TEST_WEB_DATABASE_URL) throw new Error('Isolated browser database is required');
process.env.DATABASE_URL=process.env.MONOS_TEST_WEB_DATABASE_URL;
type Fixture=Awaited<ReturnType<typeof reviewCorrectionFixture>>;
let current:{fixture:Fixture;app:ReturnType<typeof createApp>;heartbeat:NodeJS.Timeout;second:string;schema:string}|undefined;
let closing=false;
const ownedScopes:string[]=[],closedScopes:string[]=[];
async function recordCleanup(){if(process.env.MONOS_TEST_WEB_CLEANUP_PROOF)await writeFile(process.env.MONOS_TEST_WEB_CLEANUP_PROOF,JSON.stringify({ownedScopes,closedScopes,closing})+'\n');}
async function dispose(){const old=current;current=undefined;if(!old)return;clearInterval(old.heartbeat);try{await old.app.close();}finally{await old.fixture.close();closedScopes.push(old.schema);await recordCleanup();}}
const origin='http://127.0.0.1:18557';
async function pump(x:Fixture){
  await x.service.touch(x.f.runner,x.f.incarnation,true);
  // Advance mutable due times, never fabricate semantic outcomes or receipts.
  await x.db.pool.query('UPDATE task_review_operations SET due_at=clock_timestamp() WHERE task_id=$1',[x.f.task]);
  await x.reviewCoordinator.pump();
}
async function semantic(x:Fixture,action:string){
  await pump(x);
  const a=await x.promote(),source=a.dispatch.task_review_source;
  if(!source)throw new Error('Expected a genuine dedicated review source');
  const binding={feedback_id:source.feedback_id,operation_id:source.operation_id,operation_version:source.operation_version,source_id:source.source_id};
  const basis={control_version:a.dispatch.control_version,specification_id:source.specification_id,plan_id:source.plan_id};
  const outcome=action==='issue'?await x.agent(a,'raise_planning_issue',{...binding,reason:'Which part of the current output should be corrected?'}):action==='replan'?source.purpose==='reconsider_input'?await x.agent(a,'resolve_review_input',{...binding,basis,reconsideration_id:source.reconsideration_id,summary:'The preserved input requires genuinely different collaboration structure.',routing:{kind:'replan',basis,text:'The current collaboration structure is insufficient for the preserved input.'}}):await x.agent(a,'request_replan',{reason:'The current collaboration structure is insufficient for the requested correction.'}):action==='rework'?await x.agent(a,'apply_review_rework',{...binding,basis,node_ids:[x.f.node],reason:'The current single Node can implement the requested correction.'}):action==='resolve-input'?await x.agent(a,'resolve_review_input',{...binding,basis,reconsideration_id:source.reconsideration_id,summary:'Reconsidered the preserved original input without another reply.',routing:{kind:'reply'}}):undefined;
  if(!outcome || !['committed','admitted'].includes(outcome.status))throw new Error('Genuine semantic outcome was not admitted');
  if(outcome.operation_id)await x.finish(outcome.operation_id,a.dispatch.attempt_id);
  return {source_id:source.source_id,operation_id:source.operation_id,operation_version:source.operation_version,outcome:outcome.status};
}
const server=createServer((request,response)=>{void(async()=>{
  if(request.url==='/health'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"test_fixture":"ready"}');return;}
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>2*1024*1024)throw new Error('Test body too large');chunks.push(chunk);}
  const payload=Buffer.concat(chunks);
  if(request.url?.startsWith('/__test__/')){
    if(request.method!=='POST'||request.headers.origin!==origin){response.writeHead(403);response.end();return;}
    const body=payload.length?JSON.parse(payload.toString('utf8')) as Record<string,unknown>:{};
    if(request.url==='/__test__/review-scenario'){
      await dispose();if(!['repository_free','modified'].includes(String(body.mode)))throw new Error('Unknown fixture mode');
      const fixture=await reviewCorrectionFixture(body.mode as 'repository_free'|'modified');
      const schema=new URL(fixture.databaseUrl).searchParams.get('options')?.match(/search_path=(conversation_[a-z0-9]+)/)?.[1];
      if(!schema){await fixture.close();throw new Error('Exact owned fixture schema is missing');}ownedScopes.push(schema);
      const second=randomUUID();await transaction(fixture.db,tx=>initializeTask(tx,{task_id:second,specification_id:randomUUID(),project_id:fixture.f.project,specification:'Independent Task for response fencing'}));
      const app=createApp(fixture.service,undefined,fileURLToPath(new URL('../dist',import.meta.url)));await app.ready();
      const heartbeat=setInterval(()=>{void fixture.service.touch(fixture.f.runner,fixture.f.incarnation,true).catch(()=>{});},1000);
      current={fixture,app,heartbeat,second,schema};
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`monos=${fixture.token}; Path=/; HttpOnly; SameSite=Strict`});response.end(JSON.stringify({task:fixture.f.task,second,schema}));return;
    }
    if(!current)throw new Error('Scenario is not initialized');
    const x=current.fixture;
    let value:unknown;
    if(request.url==='/__test__/review-pump'){await pump(x);value={pumped:true};}
    else if(request.url==='/__test__/review-semantic'){
      if(!['issue','replan','rework','resolve-input'].includes(String(body.action)))throw new Error('Unknown semantic fixture action');value=await semantic(x,String(body.action));
    }else if(request.url==='/__test__/review-observe'){
      value={review:(await x.db.pool.query('SELECT request_id,envelope,response FROM owner_review_command_receipts WHERE task_id=$1 ORDER BY request_id',[x.f.task])).rows,replan:(await x.db.pool.query("SELECT request_id,envelope_json::jsonb envelope,response FROM owner_command_receipts WHERE scope_id=$1 AND envelope_json::jsonb->>'name'='dismiss_replan' ORDER BY request_id",[x.f.task])).rows,delivery:(await x.db.pool.query('SELECT id,status,content_digest FROM owner_delivery_batches WHERE task_id=$1',[x.f.task])).rows,inputs:(await x.db.pool.query('SELECT id,accepted_delivery_operation_id,status FROM task_inputs WHERE task_id=$1 ORDER BY id',[x.f.task])).rows,feedback:(await x.db.pool.query('SELECT id,status,current_operation_id FROM task_review_feedback WHERE task_id=$1',[x.f.task])).rows};
    }else{response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(value));return;
  }
  if(!current){response.writeHead(503);response.end('Initialize the isolated scenario');return;}
  if(!['GET','POST'].includes(request.method??'')){response.writeHead(405);response.end();return;}
  const result=await current.app.inject({method:request.method as 'GET'|'POST',url:request.url??'/',headers:request.headers,...(payload.length?{payload}:{})});response.writeHead(result.statusCode,result.headers);response.end(result.rawPayload);
})().catch(error=>{process.stderr.write(`Review fixture request failed: ${error instanceof Error?error.message:'unknown'}\n`);if(!response.headersSent)response.writeHead(500);response.end('Isolated fixture request failed');});});
server.listen(18557,'127.0.0.1',()=>process.stdout.write('Isolated review correction browser fixture ready on port 18557.\n'));
async function close(){if(closing)return;closing=true;await new Promise<void>(resolve=>server.close(()=>resolve()));await dispose();process.stdout.write(`Closed ${closedScopes.length} exact owned review browser schemas.\n`);}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void close();});
