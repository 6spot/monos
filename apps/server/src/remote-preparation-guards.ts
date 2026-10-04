import type {Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import type {PublicationPrepareRequest,PublicationResult,PublicationOverrideProof,PublicationFinding,PublicationRefObservation} from '../../../packages/protocol/src/index.ts';
import {effectiveResult,localAdmissionAllowed} from './publication-candidates.ts';
import type {DeliveryOperation} from './publication-candidates.ts';
import {publicationConfiguration,publicationDigest as hash} from './publication-policy.ts';
import {knownPublicExposureCount} from './publication-candidate-reads.ts';
import {taskInputGuards} from './task-guidance.ts';
import {actualOverrideProofs} from './remote-preparation-state.ts';
import type {RemoteItem} from './remote-preparation-state.ts';

export class RemoteAdmissionError extends CommandError {
 readonly reason:NonNullable<PublicationRefObservation['reason']>;
 constructor(reason:NonNullable<PublicationRefObservation['reason']>) {super('unmet_precondition',reason);this.reason=reason;}
}
export async function freshRemoteSource(tx:Transaction,item:Pick<RemoteItem,'task_id'|'resource_id'|'repository_identity'|'repository_id'>,request:PublicationPrepareRequest):Promise<void> {
 const settings=(await tx.query<{repository_identity:string;settings:{remote_preparation?:string;provider_repo_id?:string}}>('SELECT repository_identity,settings FROM project_resources WHERE id=$1',[item.resource_id])).rows[0];
 if(!settings||settings.repository_identity!==item.repository_identity||settings.settings.provider_repo_id!==item.repository_id)throw new RemoteAdmissionError('configuration_changed');
 if((settings.settings.remote_preparation??'automatic')!=='automatic')throw new RemoteAdmissionError('mode_deferred');
 if(!await localAdmissionAllowed(tx,item.task_id))throw new RemoteAdmissionError('source_changed');
 if((await taskInputGuards(tx,item.task_id)).length)throw new RemoteAdmissionError('input_pending');
 if(!(await effectiveResult(tx,request)).current)throw new RemoteAdmissionError('source_changed');
}
export async function currentLocalPreparation(tx:Transaction,item:Pick<RemoteItem,'task_id'|'resource_id'>):Promise<DeliveryOperation|undefined> {
 return (await tx.query<DeliveryOperation>('SELECT * FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[item.task_id,item.resource_id])).rows[0];
}
export async function ordinaryRemoteAdmission(tx:Transaction,item:RemoteItem,request:PublicationPrepareRequest,result:PublicationResult,excludeOperation?:string):Promise<PublicationOverrideProof[]> {
 await freshRemoteSource(tx,item,request);
 if(hash(await publicationConfiguration(tx,item.resource_id))!==request.configuration_digest)throw new RemoteAdmissionError('configuration_changed');
 const latest=await currentLocalPreparation(tx,item);
 if(!latest||latest.id!==request.operation_id||latest.state!=='terminal'||latest.result_digest!==hash(result)||!['prepared','mapped'].includes(result.status))throw new RemoteAdmissionError('source_changed');
 if(result.scan?.status!=='complete'||typeof result.scan.workflow_changes!=='boolean')throw new RemoteAdmissionError('scan_incomplete');
 if(await knownPublicExposureCount(tx,item.task_id,item.resource_id,item.repository_identity))throw new RemoteAdmissionError('known_public_exposure');
 if((await tx.query(`SELECT 1 FROM remote_preparation_operations o WHERE o.item_id=$1 AND o.id IS DISTINCT FROM $2 AND (o.effect_owned OR o.kind='push' AND o.state='settled' AND o.result->>'status'='reconciliation_required' AND NOT EXISTS(SELECT 1 FROM remote_preparation_observations p WHERE p.operation_id=o.id AND p.kind='published')) LIMIT 1`,[item.item_id,excludeOperation??null])).rowCount)throw new RemoteAdmissionError('possible_publication');
 const receipts=await actualOverrideProofs(tx,item.task_id,result.scan.scan_id),eligible=receipts.filter(r=>r.selection.candidate_id===result.candidate!.candidate_id&&r.selection.candidate_manifest_digest===result.candidate_manifest_digest&&r.selection.effective_basis_digest===request.effective_basis_digest&&r.selection.scan_digest===result.scan_digest&&r.selection.mapping_digest===result.mapping_digest);
 const covered=new Set(eligible.flatMap(r=>r.selection.finding_ids));
 const findings=(await tx.query<{finding:PublicationFinding}>('SELECT finding FROM publication_findings WHERE scan_id=$1',[result.scan.scan_id])).rows;
 if(findings.length!==result.scan.findings_count||findings.some(({finding:f})=>!f.override_eligible||!covered.has(f.finding_id)))throw new RemoteAdmissionError('findings_blocked');
 return eligible;
}
