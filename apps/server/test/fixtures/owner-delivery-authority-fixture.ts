import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../../packages/db/src/index.ts';
import type { DeliveryAcceptanceManifest } from '../../../../packages/protocol/src/index.ts';
import { prepareTaskProposal } from '../../src/owner-commands.ts';
import { publicationDigest as hash } from '../../src/publication-policy.ts';

// Only negative tests call this deliberately forged direct-SQL chain. Successful
// acceptance tests always use the actual authenticated Owner command path.
export async function forgedSQLAdmission(tx:Transaction,taskId:string,manifest:DeliveryAcceptanceManifest){
    const proposal=await prepareTaskProposal(tx,{id:randomUUID(),task_id:taskId,action:'accept_delivery',content:manifest});
    const prepareId=randomUUID(),confirmId=randomUUID(),admissionId=randomUUID(),authorization=randomUUID(),batchId=randomUUID();
    const receipt=async(requestId:string,name:string,payload:object,outcome:object)=>{const envelope={schema_version:1,task_id:taskId,request_id:requestId,name,payload};await tx.query('INSERT INTO owner_delivery_command_receipts(task_id,request_id,digest,envelope,response) VALUES($1,$2,$3,$4,$5)',[taskId,requestId,hash(envelope),envelope,{schema_version:1,task_id:taskId,request_id:requestId,status:'committed',name,...outcome}]);};
    await tx.query('INSERT INTO owner_delivery_proposals(proposal_id,task_id,request_id) VALUES($1,$2,$3)',[proposal.proposal_id,taskId,prepareId]);
    await receipt(prepareId,'prepare_delivery_acceptance',{basis:manifest.basis},{proposal_id:proposal.proposal_id,content_digest:proposal.content_digest});
    await tx.query('INSERT INTO authorization_receipts(id,proposal_id,consumed_by) VALUES($1,$2,$3)',[authorization,proposal.proposal_id,admissionId]);
    await tx.query('INSERT INTO owner_delivery_authorization_commands(authorization_id,task_id,request_id) VALUES($1,$2,$3)',[authorization,taskId,confirmId]);
    await receipt(confirmId,'confirm_delivery_acceptance',{proposal_id:proposal.proposal_id,content_digest:proposal.content_digest},{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest});
    await receipt(admissionId,'accept_delivery',{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest,basis:manifest.basis},{proposal_id:proposal.proposal_id,confirmation_id:authorization,content_digest:proposal.content_digest,operation_id:batchId,operation_version:1,input_cutoff:0});
    await tx.query('INSERT INTO owner_delivery_batches(id,task_id,manifest,content_digest,proposal_id,confirmation_id,admission_request_id,input_cutoff) VALUES($1,$2,$3,$4,$5,$6,$7,0)',[batchId,taskId,manifest,proposal.content_digest,proposal.proposal_id,authorization,admissionId]);
    for(const [ordinal,r] of manifest.repositories.entries()){
     if(r.item_id){const url=(await tx.query('SELECT remote_url FROM project_resources WHERE id=$1',[r.resource_id])).rows[0]!.remote_url;
      await tx.query('INSERT INTO remote_preparation_items(item_id,task_id,resource_id,runner_id,storage_id,repository_identity,repository_id,remote_url,delivery_ref,target_branch,marker) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(item_id) DO NOTHING',[r.item_id,taskId,r.resource_id,r.source.runner_id,r.source.storage_id,r.repository_identity,r.provider_metadata.github!.repository_id,url,r.delivery_ref,r.target_branch,r.marker]);}
     await tx.query('INSERT INTO owner_delivery_batch_items(batch_id,ordinal,task_id,item_id,resource_id,repository,repository_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',[batchId,ordinal,taskId,r.item_id??null,r.resource_id,r,hash(r)]);
    }
}
