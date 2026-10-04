import { resolveCanonicalResult } from './task-result-reads.ts';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, validate } from '../../../packages/protocol/src/index.ts';
import type { PublicationRecord, PublicationCandidatePage, PublicationCandidateQuery, PublicationFindingPage, PublicationFindingsQuery, PublicationFinding } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { effectiveResult, localAdmissionAllowed } from './publication-candidates.ts';
import type { DeliveryOperation } from './publication-candidates.ts';
import { publicationConfiguration, publicationDigest as hash } from './publication-policy.ts';

const cursorEncode=(binding:unknown,after:number|string)=>Buffer.from(canonicalJSON({version:1,binding,after})).toString('base64url');
function cursorDecode(binding:unknown,cursor?:string):number|string {
 if(!cursor)return '';
 try {
  validate('TaskListCursor',cursor);const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  if(value.version!==1 || !['string','number'].includes(typeof value.after) || typeof value.after==='number' && (!Number.isSafeInteger(value.after)||value.after<0) || cursorEncode(value.binding,value.after)!==cursor)throw new Error();
  if(canonicalJSON(value.binding)!==canonicalJSON(binding))throw new CommandError('denied_scope','Publication cursor belongs to another selection');
  return value.after;
 }catch(e){if(e instanceof CommandError)throw e;throw new CommandError('invalid_input','Invalid publication cursor');}
}
export async function knownPublicExposureCount(tx:Transaction,taskId:string,resourceId:string,repositoryIdentity:string):Promise<number> {
 const exposure=(await tx.query<{n:string}>(`SELECT count(DISTINCT fact) n FROM (
 SELECT jsonb_build_array(f.finding->>'blob',f.finding->>'content_digest',f.finding->>'rule_id') fact FROM publication_findings f JOIN publication_scans s ON s.id=f.scan_id JOIN publication_candidates c ON c.id=s.candidate_id JOIN delivery_items i ON i.id=c.item_id WHERE i.task_id=$1 AND i.resource_id=$2 AND i.repository_identity=$3 AND f.finding->>'kind'='published_credential'
 UNION SELECT jsonb_build_array(e.exposure->>'blob',e.exposure->>'content_digest',e.exposure->>'rule_id') FROM remote_published_exposures e JOIN remote_preparation_items i ON i.item_id=e.item_id WHERE i.task_id=$1 AND i.resource_id=$2 AND i.repository_identity=$3) facts`,[taskId,resourceId,repositoryIdentity])).rows[0]!;
 return Number(exposure.n);
}
export async function publicationRecord(tx:Transaction,op:DeliveryOperation,instanceId?:string):Promise<PublicationRecord> {
 const effective=await effectiveResult(tx,op.request);
 const latest=(await tx.query<{id:string}>("SELECT id FROM delivery_operations WHERE task_id=$1 AND resource_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",[op.task_id,op.resource_id])).rows[0];
 const config=await publicationConfiguration(tx,op.resource_id),scanApplicable=latest?.id===op.id && effective.current && hash(config)===op.request.configuration_digest;
 const runner=(await tx.query<{online:boolean;publication_supported:boolean}>("SELECT connected AND ready AND last_seen>clock_timestamp()-interval '15 seconds' AND ($2::text IS NULL OR connection_instance=$2) online,publication_supported FROM runners WHERE id=$1",[op.runner_id,instanceId ?? null])).rows[0];
 const exposure=await knownPublicExposureCount(tx,op.task_id,op.resource_id,op.request.source.repository_identity);
 const receipts=op.result?.scan?(await tx.query<{id:string}>('SELECT id FROM publication_override_receipts WHERE task_id=$1 AND scan_id=$2 ORDER BY id',[op.task_id,op.result.scan.scan_id])).rows.map(r=>r.id):[];
 const allowed=effective.current && scanApplicable && await localAdmissionAllowed(tx,op.task_id);
 return validate<PublicationRecord>('PublicationRecord',{
  operation_id:op.id,request_digest:op.request_digest,source:op.request.source,source_digest:op.request.source_digest,
  effective_basis:op.request.effective_basis,effective_basis_digest:op.request.effective_basis_digest,
  status:op.result?.status ?? (runner?.online?(runner.publication_supported?'preparing':'unsupported'):'offline'),
  ...(op.result?.candidate?{candidate:op.result.candidate,candidate_manifest_digest:op.result.candidate_manifest_digest,scan:op.result.scan,scan_digest:op.result.scan_digest}:{}),
  ...(op.result?.mapping?{mapping:op.result.mapping,mapping_digest:op.result.mapping_digest}:{}),
  ...(op.result?.reason?{reason:op.result.reason}:{}),current:effective.current,scan_applicable:scanApplicable && !!op.result?.scan,
  retry_allowed:allowed && (op.state==='pending' || op.result?.scan?.status==='incomplete'),
  override_allowed:allowed && op.result?.scan?.status==='complete',override_receipt_ids:receipts,known_public_exposure_count:exposure,
  remote_preparation:(await tx.query<{remote_preparation:'automatic'|'after_acceptance'}>("SELECT COALESCE(settings->>'remote_preparation','automatic') remote_preparation FROM project_resources WHERE id=$1",[op.resource_id])).rows[0]!.remote_preparation,
 });
}
export class PublicationCandidateReads {
 readonly db:Database;readonly instanceId?:string;
 constructor(db:Database,instanceId?:string) {this.db=db;this.instanceId=instanceId;}
 async list(token:string,taskId:string,input:unknown):Promise<PublicationCandidatePage> {
  validate('Id',taskId);const q=validate<PublicationCandidateQuery>('PublicationCandidateQuery',input);
  const binding={kind:'publication_operations',task_id:taskId,source_operation_id:q.source_operation_id ?? null};const after=cursorDecode(binding,q.cursor);
  if(typeof after!=='string')throw new CommandError('invalid_input','Invalid publication history position');
  if(after)validate('Id',after);
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
   if(q.source_operation_id)await resolveCanonicalResult(tx,taskId,q.source_operation_id);
   if(after && !(await tx.query('SELECT id FROM delivery_operations WHERE task_id=$1 AND id=$2 AND ($3::text IS NULL OR source_operation_id=$3)',[taskId,after,q.source_operation_id ?? null])).rowCount)throw new CommandError('denied_scope','Publication cursor position belongs to another selection');
   const rows=(await tx.query<DeliveryOperation>(`SELECT * FROM delivery_operations WHERE task_id=$1 AND ($2='' OR (created_at,id)<(SELECT created_at,id FROM delivery_operations WHERE id=$2)) AND ($3::text IS NULL OR source_operation_id=$3) ORDER BY created_at DESC,id DESC LIMIT 33`,[taskId,after,q.source_operation_id ?? null])).rows;
   const items:PublicationRecord[]=[];let bytes=4096;
   for(const op of rows) {
    if(items.length===32)break;const item=await publicationRecord(tx,op,this.instanceId),size=Buffer.byteLength(JSON.stringify(item))+1;
    if(bytes+size>512*1024)break;items.push(item);bytes+=size;
   }
   if(rows.length && !items.length)throw new CommandError('unmet_precondition','Publication record exceeds read budget');
   return validate('PublicationCandidatePage',{schema_version:1,task_id:taskId,items,...(rows.length>items.length?{next_cursor:cursorEncode(binding,items.at(-1)!.operation_id)}:{})});
  });
 }
 async candidate(token:string,taskId:string,candidateId:string):Promise<PublicationRecord> {
  validate('Id',taskId);validate('Id',candidateId);
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);if(!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[taskId])).rowCount)throw new CommandError('denied_scope','Unknown Task');
   const op=(await tx.query<DeliveryOperation>("SELECT o.* FROM delivery_operations o JOIN publication_scans s ON s.operation_id=o.id WHERE o.task_id=$1 AND s.candidate_id=$2 AND o.state='terminal' AND o.result->>'status' IN ('prepared','mapped') ORDER BY o.created_at DESC,o.id DESC LIMIT 1",[taskId,candidateId])).rows[0];
   if(!op)throw new CommandError('denied_scope','Unknown publication candidate');return publicationRecord(tx,op,this.instanceId);
  });
 }
 async findings(token:string,taskId:string,candidateId:string,input:unknown):Promise<PublicationFindingPage> {
  validate('Id',taskId);validate('Id',candidateId);const q=validate<PublicationFindingsQuery>('PublicationFindingsQuery',input);
  const binding={kind:'publication_findings',task_id:taskId,candidate_id:candidateId,scan_digest:q.scan_digest};const position=cursorDecode(binding,q.cursor);const after=position===''?0:position;
  if(typeof after!=='number')throw new CommandError('invalid_input','Invalid publication findings position');
  return transaction(this.db,async tx=>{
   await authenticateOwner(tx,token);const scan=(await tx.query<{id:string}>('SELECT s.id FROM publication_scans s JOIN publication_candidates c ON c.id=s.candidate_id WHERE c.task_id=$1 AND c.id=$2 AND s.digest=$3',[taskId,candidateId,q.scan_digest])).rows[0];
   if(!scan)throw new CommandError('denied_scope','Unknown publication scan');
   const rows=(await tx.query<{ordinal:number;finding:PublicationFinding}>('SELECT ordinal,finding FROM publication_findings WHERE scan_id=$1 AND ordinal>=$2 ORDER BY ordinal LIMIT 65',[scan.id,after])).rows;
   const items:PublicationFinding[]=[];let bytes=4096;
   for(const row of rows) {if(items.length===64)break;const size=Buffer.byteLength(JSON.stringify(row.finding))+1;if(bytes+size>512*1024)break;items.push(row.finding);bytes+=size;}
   return validate('PublicationFindingPage',{schema_version:1,task_id:taskId,candidate_id:candidateId,scan_digest:q.scan_digest,items,...(rows.length>items.length?{next_cursor:cursorEncode(binding,after+items.length)}:{})});
  });
 }
}
