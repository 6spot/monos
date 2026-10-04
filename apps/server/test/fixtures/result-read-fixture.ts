import { randomUUID } from 'node:crypto';
import { Configuration } from '../../src/configuration.ts';
import { conversationFixture } from './task-conversation-fixture.ts';
export async function resultReadFixture(options:{runnerCredential?:string}={}) {
 const x=await conversationFixture(options);
 try {
 const resource=randomUUID(),configuration=new Configuration(x.db);
 await configuration.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:(await configuration.read(x.token)).control_version,name:'save_project',payload:{id:x.f.project,name:'Result project',context:'Exact result fixture',resources:[{id:resource,remote_url:'https://github.com/example/result.git',remote_preparation:'after_acceptance',default_branch:'main'}],role_ids:[x.f.role],archived:false}});
 await x.start();const node=await x.node();const opened=await x.agent(node,'open_workspace',{resource_id:resource});const op=await x.service.recoverOperation(x.f.runner,opened.operation_id!);const w=op.workspace!;
 const metadata={generation:w.generation,storage_id:'result-read-storage',provider_metadata:{github:{repository_id:'42'}},lease_id:w.lease_id,repository_identity:w.resource.repository_identity,base_commit:'a'.repeat(40),target_branch:'main',target_commit:'a'.repeat(40),finalized_commit:'a'.repeat(40)};
 await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:op.operation_id,attempt_id:node.dispatch.attempt_id,success:true,result:{workspace_id:w.workspace_id,path:'/runner/private/worktree',instruction_files:[],workspace_metadata:metadata}});
 const done=await x.agent(node,'complete_node',{summary:'Retained exact result'});
 await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:done.operation_id!,attempt_id:node.dispatch.attempt_id,success:true,result:{writer_absent:true,workspace_id:w.workspace_id,workspace_metadata:{...metadata,finalized_commit:'b'.repeat(40)},git_commit:'b'.repeat(40),git_tree:'c'.repeat(40)}});
 return {...x,operationId:done.operation_id!,resource,initialNode:node,descriptor:w};
 } catch (error) {
  await x.close();
  throw error;
 }
}
