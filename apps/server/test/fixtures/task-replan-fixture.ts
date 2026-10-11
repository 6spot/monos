import { validate } from '../../../../packages/protocol/src/index.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../../packages/db/src/index.ts';
import { TaskReplan } from '../../src/task-replan.ts';
import { TaskSpecification } from '../../src/task-specification.ts';
import { replanImpact } from '../../src/task-replan-state.ts';
import { conversationFixture } from './task-conversation-fixture.ts';
import type { CommandEnvelope, PrepareReplan, TaskReplanCommand, ReplanImpact } from '../../../../packages/protocol/src/index.ts';
export function replacementImpact(impact: ReplanImpact, target: string): ReplanImpact {
 return validate<ReplanImpact>('ReplanImpact', {...impact,
  nodes: impact.nodes.map(n=>({...n,disposition:'remove',target_node_id:null,target_node_activation:null})),
  guidance: impact.guidance.map(g=>({...g,target_node_ids:g.disposition==='retain'?[target]:[]})),
  holds: impact.holds.map(h=>({...h,target_node_ids:[target]})),
  workspaces: impact.workspaces.map(w=>({...w,target_nodes:[{node_id:target,node_activation:1}]})),
 });
}
export async function replanFixture(){
 const x=await conversationFixture(),replan=new TaskReplan(x.db,{},x.service.instanceId),spec=new TaskSpecification(x.db);
 const command=(name:TaskReplanCommand['name'],payload:unknown,requestId=randomUUID())=>replan.command(x.token,{schema_version:1,request_id:requestId,task_id:x.f.task,name,payload});
 async function request(){await x.start();const node=await x.node();const result=await x.agent(node,'request_replan',{reason:'The current formal Node definition needs replacement'});await x.finish(result.operation_id!,node.dispatch.attempt_id);return result.result!.replan_outcome!.replan_request_id;}
 async function prepare(joint=false,replace=true){await x.service.touch(x.f.runner,x.f.incarnation,true);await replan.pump();const turn=await x.promote();const binding=turn.dispatch.task_replan_source!;const task=(await x.db.pool.query('SELECT * FROM tasks WHERE id=$1',[x.f.task])).rows[0];const definition=(await x.db.pool.query('SELECT definition FROM plan_nodes WHERE plan_id=$1',[task.plan_id])).rows[0].definition;const nodeId=replace?randomUUID():definition.node_id;
 const originalImpact=await transaction(x.db,tx=>replanImpact(tx,task));const impact=replace?replacementImpact(originalImpact,nodeId):originalImpact;const payload:PrepareReplan={replan_request_id:binding.request_id,source_id:binding.source_id,proposal_id:randomUUID(),plan_id:randomUUID(),basis:await x.basis(),nodes:[{...definition,node_id:nodeId,...(replace?{goal:'Replacement formal goal'}:{})}],summary:'Replace exact work',impact,...(joint?{requirement:{proposal_id:randomUUID(),specification:'Joint full requirements',summary:'Joint change'}}:{})};
 const result=await x.agent(turn,'prepare_replan',payload as CommandEnvelope['payload']).catch((e:unknown)=>{const error=e as {detail?:string;where?:string;message:string};throw new Error([error.message,error.detail,error.where].filter(Boolean).join('\n'));});await x.finish(result.operation_id!,turn.dispatch.attempt_id);return {payload,result,turn};}
 async function publish(p:Awaited<ReturnType<typeof prepare>>){const auth=await command('confirm_replan',{proposal_id:p.payload.proposal_id,content_digest:p.result.result!.replan_outcome!.content_digest});let requirement_confirmation_id:string|undefined;
 if(p.payload.requirement){const a=await spec.command(x.token,{schema_version:1,request_id:randomUUID(),task_id:x.f.task,name:'confirm_specification',payload:{proposal_id:p.payload.requirement.proposal_id,content_digest:p.result.result!.replan_outcome!.requirement_content_digest}});requirement_confirmation_id=a.confirmation_id;}
 return command('publish_replan',{proposal_id:p.payload.proposal_id,confirmation_id:auth.confirmation_id,basis:p.payload.basis,...(requirement_confirmation_id?{requirement_confirmation_id}:{})});}
 return {...x,replan,spec,command,request,prepare,publish};
}
