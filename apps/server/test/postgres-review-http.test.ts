import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {createApp} from '../src/app.ts';
import {OwnerAccess} from '../src/owner-access.ts';
import {ownerDeliveryFixture} from './fixtures/owner-delivery-fixture.ts';
import type {OwnerReviewStatus,OwnerReviewCommand,OwnerReviewCommandResult} from '../../../packages/protocol/src/index.ts';

const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('protected review correction HTTP',()=>{
 it('enforces session and Origin, exact source reads and immutable same-ID receipt after withdrawal',async()=>{
  const x=await ownerDeliveryFixture(),app=createApp(x.service);
  try{
   const root=`/v1/owner/tasks/${x.f.task}/review`,session=await new OwnerAccess(x.db).session(x.token),headers={host:'monos.test',cookie:`monos=${x.token}`,'x-monos-session':session.session_id};
   for(const url of [root,`${root}/feedback/${randomUUID()}`,`${root}/operations/${randomUUID()}`,`${root}/commands/${randomUUID()}`]){const r=await app.inject({url});expect(r.statusCode).toBe(401);expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['x-content-type-options']).toBe('nosniff');}
   expect((await app.inject({url:root,headers:{...headers,'x-monos-session':randomUUID()}})).statusCode).toBe(401);expect((await app.inject({url:root+'?feedback_cursor=bad!',headers})).statusCode).toBe(409);
   const current=await app.inject({url:root,headers});expect(current.statusCode,current.body).toBe(200);const state=current.json<OwnerReviewStatus>();expect(state.request_changes_allowed).toBe(true);
   const command:OwnerReviewCommand={schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'request_changes',payload:{feedback_id:randomUUID(),basis:state.basis!,text:'Please improve this exact local review result'}};
   for(const origin of [undefined,'http://other.test']){const r=await app.inject({method:'POST',url:'/v1/owner/tasks/review/commands',headers:{...headers,...(origin?{origin}:{})},payload:command});expect(r.statusCode).toBe(403);}
   const send=async(c:OwnerReviewCommand):Promise<OwnerReviewCommandResult>=>{const r=await app.inject({method:'POST',url:'/v1/owner/tasks/review/commands',headers:{...headers,origin:'http://monos.test'},payload:c});expect(r.statusCode,r.body).toBe(200);expect(r.headers['cache-control']).toBe('no-store');return r.json();};
   expect((await app.inject({url:`${root}/commands/${command.request_id}`,headers})).json().status).toBe('unknown');const committed=await send(command);expect(await send(command)).toEqual(committed);
   const feedback=await app.inject({url:`${root}/feedback/${committed.feedback_id}`,headers});expect(feedback.statusCode,feedback.body).toBe(200);expect(feedback.json()).toMatchObject({text:command.payload.text,request_id:command.request_id,feedback:{feedback_id:committed.feedback_id,status:'active'}});
   const operation=await app.inject({url:`${root}/operations/${committed.operation_id}`,headers});expect(operation.statusCode,operation.body).toBe(200);expect(operation.json().operation).toMatchObject({operation_id:committed.operation_id,status:'settling'});
   expect((await app.inject({url:`/v1/owner/tasks/${randomUUID()}/review/feedback/${committed.feedback_id}`,headers})).statusCode).toBe(403);
   const withdrawn=await send({schema_version:1,task_id:x.f.task,request_id:randomUUID(),name:'withdraw_review_feedback',payload:{feedback_id:committed.feedback_id,operation_id:committed.operation_id,expected_version:committed.operation_version}});expect(withdrawn.operation_id).toBe(committed.operation_id);expect(await send(command)).toEqual(committed);
   const changed=await app.inject({method:'POST',url:'/v1/owner/tasks/review/commands',headers:{...headers,origin:'http://monos.test'},payload:{...command,payload:{...command.payload,text:'Replaced uncertain feedback'}}});expect(changed.statusCode).toBe(409);expect(changed.json().error.code).toBe('payload_conflict');
   await new OwnerAccess(x.db).logout(x.token);expect((await app.inject({url:root,headers})).statusCode).toBe(401);
  }finally{await app.close();await x.close();}
 });
});
