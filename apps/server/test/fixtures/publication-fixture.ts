import { resultReadFixture } from './result-read-fixture.ts';
import { PublicationPreparation } from '../../src/publication-candidates.ts';
import { publicationDigest as hash } from '../../src/publication-policy.ts';
import { canonicalJSON,validate } from '../../../../packages/protocol/src/index.ts';
import type { PublicationPrepareRequest,PublicationCandidateManifest,PublicationFinding,PublicationResult,PublicationResultPage } from '../../../../packages/protocol/src/index.ts';
export async function publicationFixture(options:{runnerCredential?:string}={}) {
 const x=await resultReadFixture(options);
 try {
  const preparation=new PublicationPreparation(x.db,x.service.instanceId);
  const row=(await x.db.pool.query<{id:string;request:PublicationPrepareRequest}>('SELECT id,request FROM delivery_operations WHERE source_operation_id=$1',[x.operationId])).rows[0];
  if(!row)throw new Error('Automatic publication admission missing');
  return {...x,preparation,request:row.request,deliveryOperationId:row.id};
 }catch(e){await x.close();throw e;}
}
export function publicationPages(request:PublicationPrepareRequest,count=0,status:'complete'|'incomplete'='complete',hard=false):PublicationResultPage[] {
 const candidate:PublicationCandidateManifest={schema_version:1,candidate_id:request.construction.candidate_id,construction_id:request.construction.construction_id,construction_digest:request.construction_digest,source_digest:request.source_digest,head:'d'.repeat(40),tree:request.source.git_tree,parents:request.construction.parents.map(p=>p.commit) as [string,...string[]]};
 const manifestDigest=hash(candidate),findings:PublicationFinding[]=[];
 for(let i=0;i<count;i++) {
  const facts={kind:hard&&i===count-1?'workflow_permission' as const:'tracked_ignore' as const,rule_id:hard&&i===count-1?'workflow_permission' as const:'tracked_ignore' as const,scope:'final_tree' as const,commit:candidate.head,path:`file-${i}.txt`,path_redacted:false,occurrence_ordinal:i,override_eligible:!(hard&&i===count-1),message:hard&&i===count-1?'Workflow write permission is not verified.' as const:'Tracked file matches ignore rules.' as const};
  findings.push({...facts,finding_id:hash({candidate_manifest_digest:manifestDigest,configuration_digest:request.configuration_digest,scan_run_id:request.scan_run_id,finding_facts_without_id:facts})});
 }
 const scan={schema_version:1 as const,scan_id:request.scan_run_id,candidate_manifest_digest:manifestDigest,configuration_digest:request.configuration_digest,status,...(status==='incomplete'?{reason:'timeout' as const}:{}),coverage:{commits:1,paths:count,versions:count,unique_blob_bytes:0},findings_count:count,findings_bytes:Buffer.byteLength(canonicalJSON(findings)),findings_digest:hash(findings)};
 const result:PublicationResult={schema_version:1,operation_id:request.operation_id,request_digest:hash(request),status:'prepared',candidate,candidate_manifest_digest:manifestDigest,scan,scan_digest:hash(scan)};
 const pageCount=Math.max(1,Math.ceil(findings.length/64));
 return Array.from({length:pageCount},(_,i)=>validate<PublicationResultPage>('PublicationResultPage',{schema_version:1,result,page_index:i,page_count:pageCount,findings:findings.slice(i*64,(i+1)*64),page_digest:hash(findings.slice(i*64,(i+1)*64))}));
}
