import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON,digest,validate } from '../../../packages/protocol/src/index.ts';
import type { PrepareReplan,TaskReplanResult,WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import { prepareTaskProposal } from './owner-commands.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import type { ReplanSource,ReplanProposal } from './task-replan-state.ts';
import { eligibleReplan,replanQuiescent } from './task-replan-state.ts';
import { planningEvent } from './task-planning-state.ts';
import { bindTaskGuidance,withdrawGuidance } from './task-guidance.ts';
import { prepareNodeSource } from './node-execution-state.ts';
import type { NodeTask,ExecutionNode,NodeSource } from './node-execution-state.ts';

export async function prepareJointRequirement(tx:Transaction,task:SpecificationTask,source:ReplanSource,input:PrepareReplan):Promise<string>{
 const req=input.requirement!;const old=(await tx.query(`SELECT p.* FROM requirement_proposals p JOIN requirement_obligations o ON o.current_proposal_id=p.id WHERE p.replan_source_id IN(SELECT id FROM replan_sources WHERE request_id=$1) AND o.status='pending' ORDER BY p.created_at DESC LIMIT 1`,[source.request_id])).rows[0];
 const obligation=old?.obligation_id??randomUUID();if(!old)await tx.query('INSERT INTO requirement_obligations(id,task_id) VALUES($1,$2)',[obligation,task.id]);
 const request=(await tx.query('SELECT input_id,reason FROM replan_requests WHERE id=$1',[source.request_id])).rows[0];const ids=request.input_id?[request.input_id]:[];
 const impact={graph_sufficient:false,replan_request_id:source.request_id,replan_proposal_id:input.proposal_id,reason:request.reason,replan_impact:input.impact};
 const specificationDigest=digest(canonicalJSON(req.specification)),impactDigest=digest(canonicalJSON(impact));
 const content={task_id:task.id,proposal_id:req.proposal_id,specification:req.specification,summary:req.summary,impact,basis:input.basis,source_input_ids:ids,input_cutoff:Number(source.input_cutoff),source_id:null,replan_source_id:source.id,specification_digest:specificationDigest,impact_digest:impactDigest};
 const g=await prepareTaskProposal(tx,{id:req.proposal_id,task_id:task.id,action:'apply_specification_revision',content});
 await tx.query('INSERT INTO requirement_proposals(id,task_id,obligation_id,predecessor_id,replan_source_id,specification,summary,impact,specification_digest,impact_digest,content_digest,base_specification_id,base_plan_id,base_control_version,input_cutoff) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[req.proposal_id,task.id,obligation,old?.id,source.id,req.specification,req.summary,impact,specificationDigest,impactDigest,g.content_digest,task.specification_id,task.plan_id,task.control_version,source.input_cutoff]);
 for(const id of ids)await tx.query('INSERT INTO requirement_sources(task_id,proposal_id,input_id) VALUES($1,$2,$3)',[task.id,req.proposal_id,id]);
 await tx.query('INSERT INTO requirement_attachments(task_id,proposal_id,replan_source_id) VALUES($1,$2,$3)',[task.id,req.proposal_id,source.id]);
 if(old)await tx.query('UPDATE task_command_proposals SET revoked=true WHERE id=$1 AND NOT revoked',[old.id]);
 await tx.query('UPDATE requirement_obligations SET current_proposal_id=$2,version=version+1 WHERE id=$1',[obligation,req.proposal_id]);return g.content_digest;
}
export async function publishReplan(tx:Transaction,task:SpecificationTask,p:ReplanProposal,confirmation:string,requirementConfirmation:string|undefined,requestId:string,configurationVersion:number):Promise<Partial<TaskReplanResult>>{
 const prior=(await tx.query('SELECT * FROM replan_publications WHERE proposal_id=$1',[p.id])).rows[0];
 if(prior){const originalRequirement=prior.requirement_change_id?(await tx.query('SELECT authorization_id FROM requirement_changes WHERE id=$1',[prior.requirement_change_id])).rows[0]?.authorization_id:undefined;if(originalRequirement!==requirementConfirmation)throw new CommandError('payload_conflict','Published joint graph requires its original requirements confirmation');if(prior.authorization_id!==confirmation)throw new CommandError('payload_conflict','Published graph requires original confirmation');return {publication_id:prior.id,plan_id:prior.new_plan_id,specification_id:prior.new_specification_id};}
 await eligibleReplan(tx,task,p);if(!await replanQuiescent(tx,task.id))throw new CommandError('unmet_precondition','Replan publication waits for all processes, effects and leases');
 if((await tx.query('SELECT 1 FROM task_publication_slots WHERE task_id=$1',[task.id])).rowCount)throw new CommandError('unmet_precondition','Another publication owns this Task');
 const auth=(await tx.query('SELECT * FROM authorization_receipts WHERE id=$1 AND proposal_id=$2 FOR UPDATE',[confirmation,p.id])).rows[0];if(!auth||auth.consumed_by)throw new CommandError('denied_scope','Exact unused graph approval required');
 const definition=p.content.nodes[0]!;
 if(!(await tx.query('SELECT 1 FROM tasks t JOIN project_roles pr ON pr.project_id=t.project_id JOIN roles r ON r.id=pr.role_id WHERE t.id=$1 AND r.id=$2 AND NOT r.archived',[task.id,definition.role_id])).rowCount)throw new CommandError('unmet_precondition','Selected Role is no longer available');
 const publicationId=randomUUID();let specificationId=task.specification_id,changeId:string|undefined;
 if(p.requirement_proposal_id){
  const req=(await tx.query('SELECT * FROM requirement_proposals WHERE id=$1',[p.requirement_proposal_id])).rows[0];
  const ra=(await tx.query('SELECT * FROM authorization_receipts WHERE id=$1 AND proposal_id=$2 FOR UPDATE',[requirementConfirmation,p.requirement_proposal_id])).rows[0];if(!ra||ra.consumed_by)throw new CommandError('denied_scope','Joint publication requires its exact unused requirements approval');
  await tx.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1',[ra.id,requestId]);changeId=randomUUID();specificationId=randomUUID();
  await tx.query("INSERT INTO requirement_changes(id,task_id,proposal_id,authorization_id,admission_control_version,specification_id,admission_request_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'published')",[changeId,task.id,req.id,ra.id,Number(task.control_version)+1,specificationId,requestId]);
  await tx.query("INSERT INTO task_publication_slots(task_id,operation_id,owner_kind) VALUES($1,$2,'requirement')",[task.id,changeId]);
  await tx.query('INSERT INTO specification_revisions(id,task_id,parent_id,content,content_digest,authorization_id) VALUES($1,$2,$3,to_jsonb($4::text),$5,$6)',[specificationId,task.id,task.specification_id,req.specification,req.specification_digest,ra.id]);
 }else {if(requirementConfirmation)throw new CommandError('invalid_input','Standalone graph has no requirements approval');await tx.query("INSERT INTO task_publication_slots(task_id,operation_id,owner_kind) VALUES($1,$2,'replan')",[task.id,p.request_id]);}
 await tx.query('UPDATE authorization_receipts SET consumed_by=$2 WHERE id=$1',[confirmation,requestId]);
 const graph={node_ids:[definition.node_id],nodes:p.content.nodes};await tx.query('INSERT INTO plan_revisions(id,task_id,content,specification_id,content_digest) VALUES($1,$2,$3,$4,$5)',[p.plan_id,task.id,graph,specificationId,digest(canonicalJSON(graph))]);
 const n=p.content.impact.node,changed=n.node_id!==n.target_node_id;
 if(changed)await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')",[n.target_node_id,task.id]);
 await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)',[task.id,p.plan_id,n.target_node_id,definition]);
 if(changed||n.disposition==='invalidate'){
  if(!changed)await tx.query("UPDATE nodes SET activation=$2,state='PENDING',execution_source_id=NULL,blocker_id=NULL,result=NULL WHERE id=$1",[n.target_node_id,n.target_node_activation]);
  await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,$3,$4,$5,'recorded')",[task.id,n.target_node_id,n.target_node_activation,specificationId,p.plan_id]);
 }else if(n.disposition==='refresh')await tx.query("UPDATE nodes SET state='PENDING',execution_source_id=NULL,blocker_id=NULL WHERE id=$1",[n.node_id]);
 if(changeId){await tx.query('INSERT INTO requirement_publications(task_id,change_id,specification_id,parent_id,plan_id) VALUES($1,$2,$3,$4,$5)',[task.id,changeId,specificationId,task.specification_id,p.plan_id]);await tx.query("UPDATE requirement_obligations SET status='published',version=version+1 WHERE current_proposal_id=$1",[p.requirement_proposal_id]);}
 await tx.query('INSERT INTO replan_publications(id,task_id,request_id,proposal_id,authorization_id,owner_request_id,old_plan_id,new_plan_id,old_specification_id,new_specification_id,requirement_change_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[publicationId,task.id,p.request_id,p.id,confirmation,requestId,task.plan_id,p.plan_id,task.specification_id,specificationId,changeId]);
 await tx.query('INSERT INTO replan_node_applicability(task_id,publication_id,node_id,node_activation,disposition,target_node_id,target_node_activation,completion_operation_id,completion_manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[task.id,publicationId,n.node_id,n.node_activation,n.disposition,n.target_node_id,n.target_node_activation,n.completion_operation_id,n.completion_manifest_digest]);
 for(const w of p.content.impact.workspaces){if(w.from_node_id===n.target_node_id&&w.from_node_activation===n.target_node_activation)continue;const transfer:WorkspaceTransfer={...w,publication_id:publicationId,proposal_id:p.id,to_plan_id:p.plan_id,to_node_id:n.target_node_id,to_node_activation:n.target_node_activation};validate('WorkspaceTransfer',transfer);await tx.query('INSERT INTO replan_workspace_transfers(id,task_id,publication_id,workspace_id,target_node_id,target_node_activation,descriptor) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),task.id,publicationId,w.workspace_id,n.target_node_id,n.target_node_activation,transfer]);}
 for(const g of p.content.impact.guidance){if(g.disposition==='supersede')await withdrawGuidance(tx,task.id,g.guidance_id);else await tx.query('INSERT INTO replan_guidance_applicability(task_id,publication_id,guidance_id,node_id) VALUES($1,$2,$3,$4)',[task.id,publicationId,g.guidance_id,g.target_node_id]);}
 if(changed||n.disposition==='invalidate'){await tx.query("UPDATE task_guidance_obligations SET status='carried',version=version+1 WHERE node_id=$1 AND node_activation=$2 AND status='pending'",[n.node_id,n.node_activation]);await bindTaskGuidance(tx,task.id,n.target_node_id,n.target_node_activation);}
 const holds=p.content.impact.holds;
 for(const hold of holds)await tx.query('INSERT INTO replan_control_holds(id,task_id,publication_id,node_id,node_activation,origin) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM replan_control_holds WHERE task_id=$2 AND node_id=$4 AND node_activation=$5 AND origin=$6::jsonb AND resolved_by IS NULL)',[randomUUID(),task.id,publicationId,n.target_node_id,n.target_node_activation,hold]);
 await tx.query("UPDATE replan_requests SET status='published',version=version+1 WHERE id=$1",[p.request_id]);
 await tx.query("UPDATE tasks SET plan_id=$2,specification_id=$3,state=$4,control_version=control_version+1 WHERE id=$1",[task.id,p.plan_id,specificationId,holds.length?'BLOCKED':n.disposition==='carry'?'REVIEW':'RUNNING']);
 await tx.query('DELETE FROM task_publication_slots WHERE task_id=$1 AND operation_id=$2',[task.id,changeId??p.request_id]);
 if(holds.length){
  const t=(await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0]!,node=(await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1',[n.target_node_id])).rows[0]!;
  const source=n.disposition==='carry'?(await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1',[node.execution_source_id])).rows[0]!:await prepareNodeSource(tx,t,node,configurationVersion,{recovery:{replan_publication_id:publicationId}});const {activateInheritedHold}=await import('./task-replan-holds.ts');await activateInheritedHold(tx,source);await tx.query('UPDATE nodes SET guidance_paused=$2 WHERE id=$1',[n.target_node_id,holds.some(h=>h.kind==='owner_stopped')]);
 }
 await planningEvent(tx,task.id,'replan_published',{publication_id:publicationId,replan_request_id:p.request_id,proposal_id:p.id,plan_id:p.plan_id,specification_id:specificationId});
 return {publication_id:publicationId,plan_id:p.plan_id,specification_id:specificationId,...(p.requirement_proposal_id?{requirement_proposal_id:p.requirement_proposal_id,requirement_confirmation_id:requirementConfirmation}:{})};
}
