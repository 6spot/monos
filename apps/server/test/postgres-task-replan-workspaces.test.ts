import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {replanFixture} from './fixtures/task-replan-fixture.ts';
import type {WorkspaceMetadata} from '../../../packages/protocol/src/index.ts';
import {Configuration} from '../src/configuration.ts';
const suite=process.env.MONOS_TEST_DATABASE==='1'?describe:describe.skip;
suite('Replan backend workspace authority',()=>{
 for(const mode of ['checkpoint','completed','corrected'])it(`requires exact ${mode} inheritance for replacement Node`,async()=>{
  const completed=mode==='completed',corrected=mode==='corrected';const x=await replanFixture();try{
   const resource=randomUUID(),config=new Configuration(x.db);
   await config.save(x.token,{schema_version:1,request_id:randomUUID(),expected_control_version:(await config.read(x.token)).control_version,name:'save_project',payload:{id:x.f.project,name:'Project',context:'Task project',resources:[{id:resource,remote_url:'https://github.com/example/replan.git',remote_preparation:'after_acceptance',default_branch:'main'}],role_ids:[x.f.role],archived:false}});
   await x.start();const old=await x.node();const opened=await x.agent(old,'open_workspace',{resource_id:resource});const op=await x.service.recoverOperation(x.f.runner,opened.operation_id!),w=op.workspace!;
   const metadata={generation:1,storage_id:'replan-storage',lease_id:w.lease_id,repository_identity:w.resource.repository_identity,provider_metadata:{github:{repository_id:'42'}},base_commit:'a'.repeat(40),target_branch:'main',target_commit:'b'.repeat(40),finalized_commit:'a'.repeat(40)};
   await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:op.operation_id,attempt_id:old.dispatch.attempt_id,success:true,result:{workspace_id:w.workspace_id,path:'/runner/worktree',instruction_files:[],workspace_metadata:metadata}});
   const end=await x.agent(old,completed||corrected?'complete_node':'request_replan',completed||corrected?{summary:'Original finalized result'}:{reason:'A replacement formal definition is needed'});
   let settlementId=end.operation_id!;
   let settledMetadata:WorkspaceMetadata=completed?{...metadata,finalized_commit:'c'.repeat(40)}:{...metadata,checkpoint:{operation_id:end.operation_id!,head_commit:'a'.repeat(40),tree_id:'b'.repeat(40),commit_id:'c'.repeat(40)}};
   if(corrected){
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:end.operation_id!,attempt_id:old.dispatch.attempt_id,success:false,failure_kind:'invalid_finalization',result:{writer_absent:true,message:'Invalid ancestry'}});
    const status=await x.execution.status(x.token,x.f.task,x.f.node),original=status.operations.find(o=>o.operation_id===end.operation_id)!;
    const decision=await x.owner('recover_completion',{node_id:x.f.node,node_activation:1,source_id:old.dispatch.node_execution_source!.source_id,operation_id:end.operation_id,completion_identity_digest:original.completion_identity_digest,mode:'correct'});
    const settlement=await x.service.recoverOperation(x.f.runner,decision.operation_id!);settlementId=settlement.operation_id;
    settledMetadata={...metadata,checkpoint:{operation_id:settlementId,head_commit:'a'.repeat(40),tree_id:'b'.repeat(40),commit_id:'c'.repeat(40),completion_operation_id:end.operation_id!,completion_identity_digest:settlement.completion_identity_digest!}};
    await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:settlementId,attempt_id:old.dispatch.attempt_id,success:true,result:{writer_absent:true,workspace_results:[{resource_id:resource,workspace_id:w.workspace_id,workspace_metadata:settledMetadata}]},completion_settlement:{completion_operation_id:end.operation_id!,disposition:'cancelled',completion_result:{operation_id:end.operation_id!,attempt_id:old.dispatch.attempt_id,success:false,cancelled_by_operation_id:settlementId,result:{writer_absent:true}}}});
   }else
   await x.service.finishOperation(x.f.runner,x.f.incarnation,{operation_id:end.operation_id!,attempt_id:old.dispatch.attempt_id,success:true,result:completed?{writer_absent:true,completion_outcome:'finalized',workspace_results:[{resource_id:resource,workspace_id:w.workspace_id,workspace_metadata:settledMetadata,capture:{start_commit:metadata.finalized_commit,node_commit:'c'.repeat(40),node_tree:'b'.repeat(40)},git_commit:'c'.repeat(40),git_tree:'b'.repeat(40)}]}:{writer_absent:true,workspace_id:w.workspace_id,workspace_metadata:settledMetadata}});
   if(completed||corrected){await x.send('Replace the completed formal Node definition');const turn=await x.turn();const r=await x.reply(turn,{kind:'replan',basis:await x.basis(),text:'Different formal goal needs a new identity'});await x.finish(r.operation_id!,turn.dispatch.attempt_id);}
   const p=await x.prepare();expect(p.payload.impact.workspaces[0]!.input.settle_operation_id).toBe(settlementId);await x.publish(p);
   if(corrected){const n=(await x.db.pool.query('SELECT * FROM nodes WHERE id=$1',[p.payload.nodes[0]!.node_id])).rows[0];if(n.state==='BLOCKED')await x.owner('retry_node',{node_id:n.id,node_activation:1,source_id:n.execution_source_id,blocker_id:n.blocker_id});}
   const fresh=await x.node();
   if(!completed)await expect(x.agent(fresh,'complete_node',{summary:'Skip inherited private work'})).rejects.toMatchObject({detail:{code:'unmet_precondition'}});
   const next=await x.agent(fresh,'open_workspace',{resource_id:resource});const adopted=await x.service.recoverOperation(x.f.runner,next.operation_id!);expect(adopted.workspace!.transfer).toMatchObject({from_lease_id:w.lease_id,to_node_id:fresh.dispatch.node_id,kind:completed?'completed':'checkpoint',metadata:settledMetadata});
  }finally{await x.close();}
 },60000);
});
