import type {Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import {validate} from '../../../packages/protocol/src/index.ts';
import type {TaskReviewManifest,TaskReviewBasis,DeliveryOutputEvidence,PublicationEffectiveBasis} from '../../../packages/protocol/src/index.ts';
import {resolveNodeResult} from './task-result-reads.ts';
import {readArtifact} from './artifacts.ts';
import {publicationDigest as hash} from './publication-policy.ts';

// Canonical complete evidence is shared with acceptance. Remote permission,
// findings/readiness, message counts and observation times are not its identity.
export async function canonicalReviewManifest(tx:Transaction,taskId:string):Promise<TaskReviewManifest>{
 const task=(await tx.query<{specification_id:string;plan_id:string|null}>('SELECT specification_id,plan_id FROM tasks WHERE id=$1',[taskId])).rows[0];
 if(!task?.plan_id)throw new CommandError('unmet_precondition','No current review Plan');
 const revision=(await tx.query<{specification_digest:string;plan_digest:string}>('SELECT s.content_digest specification_digest,p.content_digest plan_digest FROM specification_revisions s JOIN plan_revisions p ON p.task_id=s.task_id WHERE s.task_id=$1 AND s.id=$2 AND p.id=$3',[taskId,task.specification_id,task.plan_id])).rows[0];
 if(!revision)throw new CommandError('unmet_precondition','retained_unavailable');
 const members=(await tx.query<{node_id:string;activation:string;state:string;operation_id:string|null}>(`SELECT pn.node_id,n.activation,n.state,c.operation_id FROM plan_nodes pn JOIN nodes n ON n.id=pn.node_id AND n.task_id=pn.task_id LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation WHERE pn.task_id=$1 AND pn.plan_id=$2 ORDER BY pn.node_id`,[taskId,task.plan_id])).rows;
 if(!members.length||members.length>256||members.some(m=>m.state!=='COMPLETED'||!m.operation_id))throw new CommandError('unmet_precondition','work_unsettled');
 const outputs:DeliveryOutputEvidence[]=[];
 for(const m of members){
  const {item,identities}=await resolveNodeResult(tx,taskId,m.operation_id!);
  if(!item.current||item.manifest.node_id!==m.node_id||item.manifest.node_activation!==Number(m.activation))throw new CommandError('unmet_precondition','source_changed');
  const completion=item.manifest,artifacts=[];
  if(new Set(completion.artifact_ids).size!==completion.artifact_ids.length)throw new CommandError('unmet_precondition','identity_mismatch');
  for(const id of [...completion.artifact_ids].sort()){
   const a=(await readArtifact(tx,taskId,id)).metadata;
   if(a.task_id!==taskId||a.node_id!==m.node_id||a.node_activation!==completion.node_activation)throw new CommandError('unmet_precondition','identity_mismatch');artifacts.push(a);
  }
  const effective:PublicationEffectiveBasis={task_id:taskId,specification_id:task.specification_id,plan_id:task.plan_id,completion_operation_id:completion.operation_id,completion_manifest_digest:completion.content_digest};
  outputs.push(validate('DeliveryOutputEvidence',{node_id:m.node_id,node_activation:Number(m.activation),completion,completion_manifest_digest:completion.content_digest,effective_basis:effective,effective_basis_digest:hash(effective),artifacts,repository_free:item.repository_free,sources:identities.map(source=>({source,source_digest:hash(source)}))}));
 }
 return validate('TaskReviewManifest',{schema_version:1,task_id:taskId,specification_id:task.specification_id,plan_id:task.plan_id,...revision,outputs});
}
export async function reviewBasis(tx:Transaction,taskId:string):Promise<TaskReviewBasis>{
 const manifest=await canonicalReviewManifest(tx,taskId),task=(await tx.query<{control_version:string}>('SELECT control_version FROM tasks WHERE id=$1',[taskId])).rows[0]!;
 return {control_version:Number(task.control_version),specification_id:manifest.specification_id,plan_id:manifest.plan_id,review_result_digest:hash(manifest)};
}
