import { assertNoReplan, eligibleReplan, replanProposal } from './task-replan-state.ts';
import { assertCurrentNode } from './task-records.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { PrepareSpecificationRevision, RequirementImpact, SpecificationImpact, TaskActionBasis } from '../../../packages/protocol/src/index.ts';
import { prepareTaskProposal } from './owner-commands.ts';

export interface SpecificationTask { id:string; specification_id:string; plan_id:string|null; control_version:string; state:string; accepted_delivery_operation_id:string|null; initial_planning_intent_id?:string|null; planning_issue_sequence?:string|null }
export interface RequirementProposal { review_source_id:string|null;review_operation_id:string|null; id:string; task_id:string; obligation_id:string; predecessor_id:string|null; source_id:string|null; input_id:string|null; specification:string; summary:string; impact:SpecificationImpact | (RequirementImpact & {graph_sufficient:false}); specification_digest:string; impact_digest:string; content_digest:string; base_specification_id:string; base_plan_id:string|null; base_control_version:string; input_cutoff:string }
export async function specificationFrozen(tx:Transaction,taskId:string):Promise<boolean>{return !!(await tx.query('SELECT 1 FROM task_publication_slots WHERE task_id=$1',[taskId])).rowCount;}
export async function assertTaskUnaccepted(tx:Transaction,taskId:string):Promise<void>{if((await tx.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL',[taskId])).rowCount)throw new CommandError('unmet_precondition','Accepted delivery freezes execution');}
export async function assertSpecificationUnfrozen(tx:Transaction,taskId:string):Promise<void>{await assertTaskUnaccepted(tx,taskId);if(await specificationFrozen(tx,taskId))throw new CommandError('unmet_precondition','Requirement change owns execution settlement');}
export function mutableSpecification(task:SpecificationTask):void{if(['COMPLETED','CANCELLED'].includes(task.state)||task.accepted_delivery_operation_id)throw new CommandError('unmet_precondition','Task cannot change accepted or terminal requirements');}
export function exactBasis(task:SpecificationTask,basis:TaskActionBasis):void{if(task.specification_id!==basis.specification_id||task.plan_id!==basis.plan_id||Number(task.control_version)!==basis.control_version)throw new CommandError('version_conflict','Specification assessment basis changed',Number(task.control_version));}
export async function specificationImpact(tx:Transaction,task:SpecificationTask):Promise<SpecificationImpact>{
 const nodes=(await tx.query<{node_id:string;node_activation:string;source_id:string|null;completion_operation_id:string|null;completion_manifest_digest:string|null;state:string}>(`SELECT n.id node_id,n.activation node_activation,n.execution_source_id source_id,n.state,c.operation_id completion_operation_id,m.content_digest completion_manifest_digest FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE pn.plan_id=$1 ORDER BY n.id`,[task.plan_id])).rows;
 if(nodes.length>256)throw new CommandError('unmet_precondition','Complete Node impact exceeds supported budget');
 const guidance=(await tx.query<{guidance_id:string;version:string}>("SELECT id guidance_id,version FROM task_guidance WHERE task_id=$1 AND status='active' ORDER BY id LIMIT 257",[task.id])).rows;
 if(guidance.length>256)throw new CommandError('unmet_precondition','Complete guidance impact exceeds supported budget');
 return {graph_sufficient:true,nodes:nodes.map(n=>({node_id:n.node_id,node_activation:Number(n.node_activation),source_id:n.source_id,completion_operation_id:n.completion_operation_id,completion_manifest_digest:n.completion_manifest_digest,disposition:n.completion_operation_id?'invalidate':'refresh'})),guidance:guidance.map(g=>({...g,version:Number(g.version),disposition:'retain'}))};
}
export async function checkImpact(tx:Transaction,task:SpecificationTask,impact:SpecificationImpact,settled=false):Promise<void>{
 validate('SpecificationImpact',impact);if(new Set(impact.guidance.map(g=>g.guidance_id)).size!==impact.guidance.length)throw new CommandError('invalid_input','Impact guidance IDs must be unique');const actual=await specificationImpact(tx,task);
 if(actual.nodes.length>1)throw new CommandError('unmet_precondition','unsupported_multi_node_specification_change: Requirement mutation supports one unchanged Node graph');
 if(actual.nodes.length!==impact.nodes.length||actual.guidance.length!==impact.guidance.length)throw new CommandError('version_conflict','Complete impact membership changed');
 for(const n of impact.nodes){await assertCurrentNode(tx,{task_id:task.id,node_id:n.node_id,node_activation:n.node_activation});const a=actual.nodes.find(x=>x.node_id===n.node_id);if(!a||a.node_activation!==n.node_activation||a.source_id!==n.source_id)throw new CommandError('version_conflict','Node activation/source changed');
 if(n.disposition==='refresh'&&n.completion_operation_id!==null)throw new CommandError('invalid_input','Completed work requires carry or invalidate');
 if(n.disposition!=='refresh'&&n.completion_operation_id===null)throw new CommandError('invalid_input','Unfinished work requires disclosed fresh context');
 if(!(settled&&n.disposition==='refresh')&&(a.completion_operation_id!==n.completion_operation_id||a.completion_manifest_digest!==n.completion_manifest_digest))throw new CommandError('version_conflict','Exact completion evidence changed');
 }
 for(const g of impact.guidance)if(!actual.guidance.some(a=>a.guidance_id===g.guidance_id&&a.version===g.version))throw new CommandError('version_conflict','Guidance impact changed');
}
export async function laterSpecificationInputs(tx:Transaction,p:RequirementProposal):Promise<void>{
 const blocked=await tx.query(`SELECT i.id FROM task_inputs i JOIN task_messages m ON m.id=i.message_id LEFT JOIN task_input_resolutions r ON r.input_id=i.id WHERE i.task_id=$1 AND m.sequence>$2 AND i.accepted_delivery_operation_id IS NULL AND i.status<>'withdrawn' AND COALESCE(r.routing->>'kind','')<>'reply' AND NOT EXISTS(SELECT 1 FROM requirement_input_deferrals d WHERE d.proposal_id=$3 AND d.input_id=i.id AND d.input_version=i.version) LIMIT 1`,[p.task_id,p.input_cutoff,p.id]);
 if(blocked.rowCount)throw new CommandError('unmet_precondition','Later input requires interpretation or exact Owner deferral');
}
export async function requirementProposal(tx:Transaction,id:string,taskId:string):Promise<RequirementProposal>{const p=(await tx.query<RequirementProposal>('SELECT * FROM requirement_proposals WHERE id=$1 AND task_id=$2',[id,taskId])).rows[0];if(!p)throw new CommandError('denied_scope','Unknown requirement proposal');return p;}
export async function eligibleRequirement(tx:Transaction,task:SpecificationTask,p:RequirementProposal,checkControl=true):Promise<void>{
 mutableSpecification(task);
 if(!(await tx.query(`SELECT 1 FROM requirement_attachments a JOIN requirement_obligations o ON o.current_proposal_id=a.proposal_id JOIN task_command_proposals g ON g.id=a.proposal_id WHERE a.proposal_id=$1 AND o.status='pending' AND NOT g.revoked AND g.expires_at>clock_timestamp()`,[p.id])).rowCount)throw new CommandError('unmet_precondition','Proposal is unattached, replaced, withdrawn or expired');
 if(task.specification_id!==p.base_specification_id||task.plan_id!==p.base_plan_id||(checkControl&&Number(task.control_version)!==Number(p.base_control_version)))throw new CommandError('version_conflict','Proposal assessment is stale',Number(task.control_version));
 if(!p.impact.graph_sufficient){const linked=(await tx.query<{id:string}>('SELECT id FROM replan_proposals WHERE requirement_proposal_id=$1',[p.id])).rows[0];if(!linked)throw new CommandError('unmet_precondition','Joint graph proposal missing');await eligibleReplan(tx,task,await replanProposal(tx,task.id,linked.id));return;}
 await checkImpact(tx,task,p.impact);await laterSpecificationInputs(tx,p);
}
export async function prepareSpecification(tx:Transaction,task:SpecificationTask,input:PrepareSpecificationRevision,source?:{id:string;input_id?:string;review_operation_id?:string;source_watermark:string}):Promise<RequirementProposal>{
 validate('PrepareSpecificationRevision',input);if((await tx.query('SELECT 1 FROM task_command_proposals WHERE id=$1',[input.proposal_id])).rowCount)throw new CommandError('payload_conflict','Proposal identity already exists');mutableSpecification(task);exactBasis(task,input.basis);await assertNoReplan(tx,task.id);validate('SpecificationImpact',input.impact);await checkImpact(tx,task,input.impact as SpecificationImpact);
 if(!input.specification.trim()||!input.summary.trim())throw new CommandError('invalid_input','Complete Specification and summary must be nonblank');
 if(new Set(input.source_input_ids).size!==input.source_input_ids.length||source?.input_id&&!input.source_input_ids.includes(source.input_id))throw new CommandError('invalid_input','Proposal must retain its canonical source input');
 const cutoff=source?Number(source.source_watermark):Number((await tx.query('SELECT COALESCE(max(sequence),0) cutoff FROM task_messages WHERE task_id=$1 AND author=\'owner\'',[task.id])).rows[0].cutoff);
 for(const id of input.source_input_ids)if(!(await tx.query('SELECT 1 FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.id=$1 AND i.task_id=$2 AND m.sequence<=$3',[id,task.id,cutoff])).rowCount)throw new CommandError('denied_scope','Proposal source is outside exact Task cutoff');
 let obligationId:string=randomUUID();
 if(input.supersedes){const old=await requirementProposal(tx,input.supersedes,task.id);obligationId=old.obligation_id;if(!(await tx.query("SELECT 1 FROM requirement_obligations WHERE id=$1 AND status='pending' AND current_proposal_id=$2",[obligationId,old.id])).rowCount)throw new CommandError('version_conflict','Replacement predecessor is no longer current');}
 else await tx.query('INSERT INTO requirement_obligations(id,task_id,source_issue_id) VALUES($1,$2,(SELECT parent_issue_id FROM task_inputs WHERE id=$3))',[obligationId,task.id,source?.input_id]);
 const specDigest=digest(canonicalJSON(input.specification)),impactDigest=digest(canonicalJSON(input.impact));
 const envelope={task_id:task.id,proposal_id:input.proposal_id,specification:input.specification,summary:input.summary,impact:input.impact,basis:input.basis,source_input_ids:input.source_input_ids,input_cutoff:cutoff,source_id:source?.review_operation_id?null:source?.id??null,...(source?.review_operation_id?{review_source_id:source.id,review_operation_id:source.review_operation_id}:{}),specification_digest:specDigest,impact_digest:impactDigest};
 const prepared=await prepareTaskProposal(tx,{id:input.proposal_id,task_id:task.id,action:'apply_specification_revision',content:envelope});
 await tx.query(`INSERT INTO requirement_proposals(id,task_id,obligation_id,predecessor_id,source_id,input_id,specification,summary,impact,specification_digest,impact_digest,content_digest,base_specification_id,base_plan_id,base_control_version,input_cutoff,review_source_id,review_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[input.proposal_id,task.id,obligationId,input.supersedes,source?.review_operation_id?null:source?.id,source?.input_id,input.specification,input.summary,input.impact,specDigest,impactDigest,prepared.content_digest,task.specification_id,task.plan_id,task.control_version,cutoff,source?.review_operation_id?source.id:null,source?.review_operation_id]);
 for(const id of input.source_input_ids)await tx.query('INSERT INTO requirement_sources(task_id,proposal_id,input_id) VALUES($1,$2,$3)',[task.id,input.proposal_id,id]);
 // A draft is not the current eligible proposal until its canonical reply attaches it.
 return requirementProposal(tx,input.proposal_id,task.id);
}
export async function attachSpecification(tx:Transaction,task:SpecificationTask,p:RequirementProposal,sourceId:string|null,inputId:string|null,reviewSourceId?:string):Promise<void>{
 if(!p.impact.graph_sufficient)throw new CommandError('unmet_precondition','Joint requirements attach only through their exact Replan outcome');
 mutableSpecification(task);exactBasis(task,{control_version:Number(p.base_control_version),specification_id:p.base_specification_id,plan_id:p.base_plan_id});await checkImpact(tx,task,p.impact);
 if(p.source_id!==sourceId||p.input_id!==inputId||p.review_source_id!==(reviewSourceId??null))throw new CommandError('denied_scope','Draft belongs to a different source');
 const old=(await tx.query<{current_proposal_id:string|null;status:string}>('SELECT current_proposal_id,status FROM requirement_obligations WHERE id=$1 FOR UPDATE',[p.obligation_id])).rows[0]!;
 if(old.current_proposal_id!==p.predecessor_id)throw new CommandError('version_conflict','Replacement predecessor changed');
 if(old.status!=='pending')throw new CommandError('unmet_precondition','Change obligation is terminal');
 if(old.current_proposal_id){await tx.query('UPDATE task_command_proposals SET revoked=true WHERE id=$1',[old.current_proposal_id]);await tx.query("UPDATE requirement_changes SET status='withdrawing',version=version+1 WHERE proposal_id=$1 AND status='settling'",[old.current_proposal_id]);}
 await tx.query('INSERT INTO requirement_attachments(task_id,proposal_id,source_id,input_id,review_source_id) VALUES($1,$2,$3,$4,$5)',[task.id,p.id,sourceId,inputId,reviewSourceId??null]);
 await tx.query('UPDATE requirement_obligations SET current_proposal_id=$2,version=version+1 WHERE id=$1',[p.obligation_id,p.id]);
}
