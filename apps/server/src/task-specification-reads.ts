import type { Transaction } from '../../../packages/db/src/index.ts';
import { validate,MAX_BODY_BYTES } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { requirementProposal,specificationImpact } from './task-specification-state.ts';
import type { SpecificationTask } from './task-specification-state.ts';

export async function specificationRead(tx:Transaction,task:SpecificationTask,proposalId?:string){
 const proposals=(await tx.query(`SELECT p.id proposal_id,p.obligation_id,p.summary,p.content_digest,p.base_specification_id,o.status,o.version,g.revoked,(g.expires_at<=clock_timestamp()) expired,g.expires_at,COALESCE(o.current_proposal_id=p.id,false) current,EXISTS(SELECT 1 FROM requirement_attachments a WHERE a.proposal_id=p.id) attached FROM requirement_proposals p JOIN requirement_obligations o ON o.id=p.obligation_id JOIN task_command_proposals g ON g.id=p.id WHERE p.task_id=$1 AND ($2::text IS NULL OR p.id=$2) ORDER BY COALESCE(o.current_proposal_id=p.id,false) DESC,p.created_at DESC,p.id LIMIT 65`,[task.id,proposalId??null])).rows.map(p=>({...p,version:Number(p.version),expires_at:p.expires_at.toISOString()}));
 const changes=(await tx.query('SELECT id operation_id,proposal_id,status,version,specification_id,attention FROM requirement_changes WHERE task_id=$1 AND ($2::text IS NULL OR proposal_id=$2) ORDER BY created_at DESC,id LIMIT 65',[task.id,proposalId??null])).rows.map(c=>({...c,version:Number(c.version)}));
 const basis={control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id};
 let result:unknown;
 if(proposalId){const p=await requirementProposal(tx,proposalId,task.id);const full=(await tx.query('SELECT predecessor_id,replan_source_id FROM requirement_proposals WHERE id=$1',[p.id])).rows[0]!;result={schema_version:1,task_id:task.id,proposal:proposals[0],specification:p.specification,specification_digest:p.specification_digest,impact:p.impact,impact_digest:p.impact_digest,basis:{control_version:Number(p.base_control_version),specification_id:p.base_specification_id,plan_id:p.base_plan_id},...(p.review_source_id?{review_source_id:p.review_source_id,review_operation_id:p.review_operation_id}:{}),source_id:p.source_id,replan_source_id:full.replan_source_id,input_id:p.input_id,source_input_ids:(await tx.query<{input_id:string}>('SELECT input_id FROM requirement_sources WHERE proposal_id=$1 ORDER BY input_id',[p.id])).rows.map(r=>r.input_id),input_cutoff:Number(p.input_cutoff),predecessor_id:full.predecessor_id,confirmation_id:(await tx.query('SELECT id FROM authorization_receipts WHERE proposal_id=$1',[p.id])).rows[0]?.id??null,operation:changes[0]??null};validate('RequirementProposalDetail',result);}
 else {result={schema_version:1,task_id:task.id,basis,impact:await specificationImpact(tx,task),proposals:proposals.slice(0,64),proposals_has_more:proposals.length>64,changes:changes.slice(0,64),changes_has_more:changes.length>64};validate('TaskSpecificationStatus',result);}
 if(Buffer.byteLength(JSON.stringify(result))>MAX_BODY_BYTES-4096)throw new CommandError('unmet_precondition','Specification read exceeds encoded budget');return result;
}
export async function specificationHistory(tx:Transaction,taskId:string,kind:'proposals'|'revisions',cursor?:string,revisionId?:string){
 validate('Id',taskId);if(cursor)validate('Id',cursor);if(revisionId)validate('Id',revisionId);
 if(!(await tx.query('SELECT 1 FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
 let result:unknown;
 if(kind==='proposals'){
 const rows=(await tx.query(`SELECT p.id proposal_id,p.obligation_id,p.summary,p.content_digest,p.base_specification_id,o.status,o.version,g.revoked,(g.expires_at<=clock_timestamp()) expired,g.expires_at,COALESCE(o.current_proposal_id=p.id,false) current,EXISTS(SELECT 1 FROM requirement_attachments a WHERE a.proposal_id=p.id) attached FROM requirement_proposals p JOIN requirement_obligations o ON o.id=p.obligation_id JOIN task_command_proposals g ON g.id=p.id WHERE p.task_id=$1 AND ($2::text IS NULL OR p.id>$2) ORDER BY p.id LIMIT 33`,[taskId,cursor??null])).rows.map(p=>({...p,version:Number(p.version),expires_at:p.expires_at.toISOString()}));
 result={schema_version:1,task_id:taskId,proposals:rows.slice(0,32),next_cursor:rows.length>32?rows[31]!.proposal_id:null};validate('RequirementHistoryPage',result);
 }else{
 const rows=(await tx.query(`SELECT s.id specification_id,s.parent_id,s.content_digest,s.authorization_id,p.change_id FROM specification_revisions s LEFT JOIN requirement_publications p ON p.specification_id=s.id WHERE s.task_id=$1 AND ($2::text IS NULL OR s.id>$2) AND ($3::text IS NULL OR s.id=$3) ORDER BY s.id LIMIT 33`,[taskId,cursor??null,revisionId??null])).rows;
 if(revisionId){if(!rows.length)throw new CommandError('denied_scope','Revision outside Task');const content=(await tx.query('SELECT content FROM specification_revisions WHERE id=$1',[revisionId])).rows[0]!.content;
 const applicability=(await tx.query('SELECT node_id,node_activation,plan_id,parent_id,disposition,completion_operation_id,completion_manifest_digest FROM specification_node_applicability WHERE specification_id=$1 ORDER BY node_id LIMIT 2',[revisionId])).rows.map(a=>({...a,node_activation:Number(a.node_activation)}));
 result={schema_version:1,task_id:taskId,revision:rows[0],content_json:JSON.stringify(content),applicability};validate('SpecificationRevisionDetail',result);
 }else{result={schema_version:1,task_id:taskId,revisions:rows.slice(0,32),next_cursor:rows.length>32?rows[31]!.specification_id:null};validate('SpecificationRevisionPage',result);}
 }
 if(Buffer.byteLength(JSON.stringify(result))>MAX_BODY_BYTES-4096)throw new CommandError('unmet_precondition','History exceeds encoded budget');return result;
}
export async function specificationChangeRead(tx:Transaction,taskId:string,changeId:string,cursor?:string){
 validate('Id',taskId);validate('Id',changeId);if(cursor)validate('Id',cursor);
 await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId]);
 const c=(await tx.query('SELECT id operation_id,proposal_id,status,version,specification_id,attention FROM requirement_changes WHERE task_id=$1 AND id=$2',[taskId,changeId])).rows[0];if(!c)throw new CommandError('denied_scope','Unknown Task change');
 const effects=(await tx.query('SELECT o.id operation_id,o.attempt_id,o.kind,o.state,o.failure_kind,a.process_released FROM requirement_change_effects e JOIN operations o ON o.id=e.operation_id JOIN attempts a ON a.id=o.attempt_id WHERE e.change_id=$1 AND ($2::text IS NULL OR o.id>$2) ORDER BY o.id LIMIT 65',[changeId,cursor??null])).rows;
 const attempts=(await tx.query('SELECT a.id attempt_id,a.process_released FROM requirement_change_attempts ca JOIN attempts a ON a.id=ca.attempt_id WHERE ca.change_id=$1 ORDER BY a.id LIMIT 65',[changeId])).rows;
 return validate('RequirementChangeDetail',{schema_version:1,task_id:taskId,operation:{...c,version:Number(c.version)},effects:effects.slice(0,64),next_cursor:effects.length>64?effects[63]!.operation_id:null,attempts:attempts.slice(0,64),attempts_has_more:attempts.length>64});
}
