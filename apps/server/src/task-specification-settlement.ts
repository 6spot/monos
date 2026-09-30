import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import type { SpecificationTask, RequirementProposal } from './task-specification-state.ts';
import { checkImpact, laterSpecificationInputs, eligibleRequirement, requirementProposal } from './task-specification-state.ts';
import { admitCompletionSettlement } from './node-execution.ts';
import type { Attempt, CompletionOperation } from './node-execution.ts';
import { admitWorkspaceEffect, lockAttemptWorkspace } from './workspaces.ts';
import { createPlanningIntent, planningEvent } from './task-planning-state.ts';
import type { PlanningTask } from './task-planning-state.ts';
import { prepareNodeSource,blockNodeSource } from './node-execution-state.ts';
import type { NodeTask,ExecutionNode } from './node-execution-state.ts';
import { bindTaskGuidance, withdrawGuidance, settleHandledGuidance } from './task-guidance.ts';

export interface RequirementChange {id:string;task_id:string;proposal_id:string;authorization_id:string;status:string;version:string;specification_id:string;admission_control_version:string;attention:string|null}
export async function admitSpecification(tx:Transaction,task:SpecificationTask,p:RequirementProposal,confirmationId:string,requestId:string,admissionAttemptId?:string):Promise<RequirementChange>{
 const prior=(await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE proposal_id=$1',[p.id])).rows[0];if(prior){if(prior.authorization_id!==confirmationId)throw new CommandError('payload_conflict','Applied proposal requires its original confirmation');return prior;}
 await eligibleRequirement(tx,task,p);
 if((await tx.query('SELECT 1 FROM task_publication_slots WHERE task_id=$1',[task.id])).rowCount)throw new CommandError('unmet_precondition','Previous publication must settle before admission');
 const auth=(await tx.query<{consumed_by:string|null}>('SELECT consumed_by FROM authorization_receipts WHERE id=$1 AND proposal_id=$2 FOR UPDATE',[confirmationId,p.id])).rows[0];
 if(!auth||auth.consumed_by)throw new CommandError('denied_scope','Exact unused Owner authorization required');
 const id=randomUUID();
 await tx.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1',[confirmationId,requestId]);
 await tx.query('INSERT INTO requirement_changes(id,task_id,proposal_id,authorization_id,admission_control_version,specification_id,admission_request_id,admission_attempt_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,task.id,p.id,confirmationId,Number(task.control_version)+1,randomUUID(),requestId,admissionAttemptId??null]);
 await tx.query('INSERT INTO task_publication_slots(task_id,operation_id) VALUES($1,$2)',[task.id,id]);
 await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1',[task.id]);
 await tx.query("UPDATE node_execution_outbox SET done=true,waiting_reason='specification_change' WHERE task_id=$1 AND NOT done",[task.id]);
 await tx.query("UPDATE task_planning_outbox SET done=true,waiting_reason='specification_change' WHERE task_id=$1 AND NOT done",[task.id]);
 const attempts=(await tx.query<Attempt>(`SELECT * FROM attempts WHERE task_id=$1 AND task_conversation_source_id IS NULL AND (state='QUEUED' OR NOT process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=attempts.id AND o.state NOT IN ('succeeded','cancelled'))) ORDER BY id FOR UPDATE`,[task.id])).rows;
 for(const a of attempts){
  await tx.query('INSERT INTO requirement_change_attempts(task_id,change_id,attempt_id) VALUES($1,$2,$3)',[task.id,id,a.id]);
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'",[a.id]);
  await tx.query("UPDATE attempts SET mutation_allowed=false,state=CASE WHEN state='SUCCEEDED' THEN state ELSE 'CANCELLED' END,end_reason='specification_change',process_absent=CASE WHEN state='QUEUED' THEN true ELSE process_absent END WHERE id=$1",[a.id]);
  await lockAttemptWorkspace(tx,a.id);
  const original=(await tx.query<CompletionOperation>("SELECT * FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state NOT IN ('succeeded','cancelled') FOR UPDATE",[a.id])).rows[0];
  let effect:string|undefined;
  if(original?.workspace_descriptor)effect=await admitCompletionSettlement(tx,a,original,requestId,'specification_change');
  else if(original)effect=original.id;
  else if(!a.process_released&&a.state!=='QUEUED')effect=(await tx.query<{id:string}>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop'",[a.id])).rows[0]?.id??await admitWorkspaceEffect(tx,a,'stop',requestId);
  if(effect)await tx.query('INSERT INTO requirement_change_effects(task_id,change_id,operation_id) VALUES($1,$2,$3)',[task.id,id,effect]);
  await tx.query("INSERT INTO requirement_change_effects(task_id,change_id,operation_id) SELECT $1,$2,id FROM operations WHERE attempt_id=$3 AND state NOT IN ('succeeded','cancelled') ON CONFLICT DO NOTHING",[task.id,id,a.id]);
 }
 await planningEvent(tx,task.id,'specification_change_admitted',{change_id:id,proposal_id:p.id,base_specification_id:p.base_specification_id});
 return (await tx.query<RequirementChange>('SELECT * FROM requirement_changes WHERE id=$1',[id])).rows[0]!;
}
export async function advanceSpecification(tx:Transaction,task:SpecificationTask,c:RequirementChange,configurationVersion:number):Promise<void>{
 if(!['settling','withdrawing'].includes(c.status))return;
 const unsettled=await tx.query(`SELECT 1 FROM requirement_change_attempts ca JOIN attempts a ON a.id=ca.attempt_id WHERE ca.change_id=$1 AND (NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')) OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=a.id AND l.state<>'released')) LIMIT 1`,[c.id]);
 if(unsettled.rowCount){await attention(tx,c,'waiting_for_physical_settlement');return;}
 const p=await requirementProposal(tx,c.proposal_id,task.id);
 const withdrawing=c.status==='withdrawing'||task.state==='CANCELLED';
 if(!withdrawing){
  if(task.specification_id!==p.base_specification_id||task.plan_id!==p.base_plan_id||task.accepted_delivery_operation_id){await attention(tx,c,'assessment_basis_changed');return;}
  try{await checkImpact(tx,task,p.impact,true);await laterSpecificationInputs(tx,p);}catch(e){if(!(e instanceof CommandError))throw e;await attention(tx,c,e.message);return;}
 }
 const blockedContinuations:{nodeId:string;kind:'semantic'|'factual'|'owner_stopped';reason:string}[]=[];
 const status=withdrawing?(task.state==='CANCELLED'?'cancelled':'withdrawn'):'published';
 await tx.query('UPDATE requirement_changes SET status=$2,attention=NULL,version=version+1 WHERE id=$1',[c.id,status]);
 if(!withdrawing){
  await tx.query('INSERT INTO specification_revisions(id,task_id,parent_id,content,content_digest,authorization_id) VALUES($1,$2,$3,to_jsonb($4::text),$5,$6)',[c.specification_id,task.id,p.base_specification_id,p.specification,p.specification_digest,c.authorization_id]);
  await tx.query('INSERT INTO requirement_publications(task_id,change_id,specification_id,parent_id,plan_id) VALUES($1,$2,$3,$4,$5)',[task.id,c.id,c.specification_id,p.base_specification_id,p.base_plan_id]);
  await tx.query('UPDATE tasks SET specification_id=$2,control_version=control_version+1 WHERE id=$1',[task.id,c.specification_id]);
  for(const g of p.impact.guidance)if(g.disposition==='supersede')await withdrawGuidance(tx,task.id,g.guidance_id);
  for(const n of p.impact.nodes){
   const completed=(await tx.query<{operation_id:string}>('SELECT operation_id FROM node_completions WHERE node_id=$1 AND activation=$2',[n.node_id,n.node_activation])).rows[0];
   if(n.disposition==='carry'){
    await tx.query("INSERT INTO specification_node_applicability(task_id,change_id,specification_id,parent_id,plan_id,node_id,node_activation,disposition,completion_operation_id,completion_manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7,'carry',$8,$9)",[task.id,c.id,c.specification_id,p.base_specification_id,p.base_plan_id,n.node_id,n.node_activation,n.completion_operation_id,n.completion_manifest_digest]);
   }else if(completed){
    const prior=(await tx.query("SELECT n.guidance_paused,b.kind,b.reason FROM nodes n LEFT JOIN node_blockers b ON b.id=n.blocker_id WHERE n.id=$1",[n.node_id])).rows[0]!;
    if(prior.guidance_paused||prior.kind)blockedContinuations.push({nodeId:n.node_id,kind:prior.kind??'owner_stopped',reason:prior.reason??'owner_stopped'});
    // Keep independent Stop/blockers. Only the completed activation is invalidated.
    await tx.query("UPDATE nodes SET activation=activation+1,state=CASE WHEN guidance_paused OR blocker_id IS NOT NULL THEN 'BLOCKED' ELSE 'PENDING' END,result=NULL,execution_source_id=NULL,blocker_id=NULL WHERE id=$1",[n.node_id]);
    await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,$3,$4,$5,'recorded')",[task.id,n.node_id,n.node_activation+1,c.specification_id,p.base_plan_id]);
    await tx.query("UPDATE task_guidance_obligations SET status='carried',version=version+1 WHERE node_id=$1 AND node_activation=$2 AND status='pending'",[n.node_id,n.node_activation]);
    await bindTaskGuidance(tx,task.id,n.node_id,n.node_activation+1);
    await tx.query("INSERT INTO specification_node_applicability(task_id,change_id,specification_id,parent_id,plan_id,node_id,node_activation,disposition) VALUES($1,$2,$3,$4,$5,$6,$7,'invalidate')",[task.id,c.id,c.specification_id,p.base_specification_id,p.base_plan_id,n.node_id,n.node_activation]);
   }else{
    await tx.query("INSERT INTO specification_node_applicability(task_id,change_id,specification_id,parent_id,plan_id,node_id,node_activation,disposition) VALUES($1,$2,$3,$4,$5,$6,$7,'refresh')",[task.id,c.id,c.specification_id,p.base_specification_id,p.base_plan_id,n.node_id,n.node_activation]);
    await tx.query("UPDATE nodes SET execution_source_id=CASE WHEN guidance_paused OR blocker_id IS NOT NULL THEN execution_source_id ELSE NULL END,state=CASE WHEN guidance_paused OR blocker_id IS NOT NULL THEN 'BLOCKED' ELSE 'PENDING' END WHERE id=$1",[n.node_id]);
   }
  }
 }
 await tx.query("UPDATE requirement_obligations SET status=$2,version=version+1 WHERE id=$1 AND current_proposal_id=$3 AND status='pending'",[p.obligation_id,status,p.id]);
 await tx.query('DELETE FROM task_publication_slots WHERE task_id=$1 AND operation_id=$2',[task.id,c.id]);
 for(const blocked of blockedContinuations){const freshTask=(await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0]!;const node=(await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1',[blocked.nodeId])).rows[0]!;const source=await prepareNodeSource(tx,freshTask,node,configurationVersion,{recovery:{requirement_change_id:c.id}});await blockNodeSource(tx,source,blocked.kind,blocked.reason);}
 if(withdrawing&&task.state!=='CANCELLED'){
  const completed=(await tx.query<{id:string;result:object;operation_id:string;source_id:string;handled_guidance_ids:string[]}>(`SELECT n.id,c.result,c.operation_id,m.source_id,m.handled_guidance_ids FROM nodes n JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE n.task_id=$1 AND n.state<>'COMPLETED'`,[task.id])).rows;
  for(const result of completed){await settleHandledGuidance(tx,result.source_id,result.operation_id,result.handled_guidance_ids);await tx.query("UPDATE nodes SET state='COMPLETED',result=$2 WHERE id=$1",[result.id,result.result]);}
  await tx.query("UPDATE nodes SET execution_source_id=CASE WHEN guidance_paused OR blocker_id IS NOT NULL THEN execution_source_id ELSE NULL END,state=CASE WHEN guidance_paused OR blocker_id IS NOT NULL THEN 'BLOCKED' ELSE 'PENDING' END WHERE task_id=$1 AND state<>'COMPLETED'",[task.id]);
 }
 if(task.plan_id&&task.state!=='CANCELLED')await tx.query("UPDATE tasks SET state=CASE WHEN EXISTS(SELECT 1 FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE pn.plan_id=tasks.plan_id AND n.state='BLOCKED') THEN 'BLOCKED' WHEN NOT EXISTS(SELECT 1 FROM nodes n JOIN plan_nodes pn ON pn.node_id=n.id WHERE pn.plan_id=tasks.plan_id AND n.state<>'COMPLETED') THEN 'REVIEW' ELSE 'RUNNING' END WHERE id=$1",[task.id]);
 if(!task.plan_id&&task.state==='RUNNING'&&task.planning_issue_sequence===null){const fresh=(await tx.query<PlanningTask>('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0]!;await createPlanningIntent(tx,fresh,c.id,configurationVersion,c.id);}
 await planningEvent(tx,task.id,'specification_change_'+status,{change_id:c.id,proposal_id:p.id,...(!withdrawing?{specification_id:c.specification_id}: {})});
}
async function attention(tx:Transaction,c:RequirementChange,message:string){if(c.attention!==message)await tx.query('UPDATE requirement_changes SET attention=$2,version=version+1 WHERE id=$1',[c.id,message]);}
