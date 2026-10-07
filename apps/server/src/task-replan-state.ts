import { remoteItemQuiescent } from './remote-preparation-state.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { TaskReplanSource, ReplanImpact, ReplanWorkspaceInput, CommandEnvelope, EffectResult, PrepareReplan, WorkspaceTransfer } from '../../../packages/protocol/src/index.ts';
import type { SpecificationTask } from './task-specification-state.ts';
import { exactBasis, mutableSpecification } from './task-specification-state.ts';
import { planningEvent, stopPlanningAttempt } from './task-planning-state.ts';
import type { PlanningAttempt } from './task-planning-state.ts';
import { blockNodeSource } from './node-execution-state.ts';
import type { NodeSource } from './node-execution-state.ts';
import { assertCurrentNode, validatePlan } from './task-records.ts';
import { prepareTaskProposal } from './owner-commands.ts';

export interface ReplanRequest { review_operation_id:string|null;review_source_id:string|null; id:string;task_id:string;reason:string;status:string;version:string;source_id:string|null;proposal_id:string|null;issue_id:string|null;origin_node_id:string|null;origin_activation:string|null;input_id:string|null;direction:string|null;requester_blocker_id:string|null }
export interface ReplanSource { id:string;task_id:string;request_id:string;planned_attempt_id:string;specification_id:string;plan_id:string;expected_version:string;input_cutoff:string;event_cutoff:string;context:Record<string,unknown>|null;context_digest:string;prompt:string|null;done:boolean;preparation_failure:string|null;waiting_reason:string|null }
export interface ReplanProposal {id:string;task_id:string;request_id:string;source_id:string;plan_id:string;content:PrepareReplan & {input_cutoff:number;requirement_content_digest?:string};content_digest:string;requirement_proposal_id:string|null}
export async function pendingReplan(tx:Transaction,taskId:string):Promise<ReplanRequest|undefined>{return (await tx.query<ReplanRequest>("SELECT * FROM replan_requests WHERE task_id=$1 AND status='pending'",[taskId])).rows[0];}
export async function assertNoReplan(tx:Transaction,taskId:string):Promise<void>{const r=await pendingReplan(tx,taskId);if(r)throw new CommandError('unmet_precondition',`Replan ${r.id} owns new execution; resolve or publish its exact graph`);}
export async function replanQuiescent(tx:Transaction,taskId:string):Promise<boolean>{return await remoteItemQuiescent(tx,taskId) && !(await tx.query(`SELECT 1 FROM attempts a WHERE a.task_id=$1 AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')) OR EXISTS(SELECT 1 FROM workspace_leases l WHERE l.attempt_id=a.id AND l.state<>'released')) LIMIT 1`,[taskId])).rowCount;}
export async function liveReplanAuthority(tx:Transaction,taskId:string,attemptId:string):Promise<boolean>{return !!(await tx.query(`SELECT 1 FROM replan_live_attempts x JOIN replan_requests r ON r.id=x.request_id JOIN tasks t ON t.id=x.task_id JOIN attempts a ON a.id=x.attempt_id JOIN node_execution_outbox s ON s.id=x.source_id JOIN nodes n ON n.id=a.node_id WHERE x.task_id=$1 AND x.attempt_id=$2 AND r.status='pending' AND t.state='REPLAN_REQUIRED' AND t.control_version=x.freeze_control_version AND a.mutation_allowed AND NOT a.process_released AND n.state='RUNNING' AND n.execution_source_id=s.id AND n.activation=a.node_activation AND s.expected_version=x.prior_control_version AND t.plan_id=s.plan_id AND t.specification_id=s.specification_id`,[taskId,attemptId])).rowCount;}
export async function requestReplan(tx:Transaction,task:SpecificationTask,attempt:PlanningAttempt,reason:string,requestId:string,origin:{node?:NodeSource;input_id?:string;source_id?:string;review_operation_id?:string;review_source_id?:string}):Promise<string>{
 mutableSpecification(task);validate('PlanningText',reason);if(!task.plan_id)throw new CommandError('unmet_precondition','Replan requires an effective Plan');await assertNoReplan(tx,task.id);
 if((await tx.query('SELECT 1 FROM task_publication_slots WHERE task_id=$1',[task.id])).rowCount)throw new CommandError('unmet_precondition','Existing publication must reconcile before Replan');
 const id=randomUUID();await tx.query('INSERT INTO replan_requests(id,task_id,reason,origin_attempt_id,origin_node_id,origin_activation,input_id,origin_source_id,base_plan_id,review_operation_id,review_source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,task.id,reason,attempt.id,origin.node?.node_id,origin.node?.node_activation,origin.input_id,origin.source_id,task.plan_id,origin.review_operation_id,origin.review_source_id]);
 await tx.query(`INSERT INTO replan_live_attempts(task_id,request_id,attempt_id,source_id,prior_control_version,freeze_control_version) SELECT $1,$2,a.id,a.node_execution_source_id,s.expected_version,$3 FROM attempts a JOIN node_execution_outbox s ON s.id=a.node_execution_source_id WHERE a.task_id=$1 AND a.kind='node' AND a.state='RUNNING' AND a.mutation_allowed AND a.id<>$4`,[task.id,id,Number(task.control_version)+1,origin.node?attempt.id:'']);
 await tx.query("UPDATE outbox SET done=true WHERE kind='start' AND attempt_id IN(SELECT id FROM attempts WHERE task_id=$1 AND kind='node' AND state='QUEUED')",[task.id]);
 await tx.query("UPDATE attempts SET state='CANCELLED',mutation_allowed=false,process_absent=true,end_reason='replan_queued' WHERE task_id=$1 AND kind='node' AND state='QUEUED'",[task.id]);
 await tx.query("UPDATE node_execution_outbox SET done=true,waiting_reason='replan_requested' WHERE task_id=$1 AND NOT done",[task.id]);
 await tx.query("UPDATE nodes SET state='PENDING',execution_source_id=NULL WHERE task_id=$1 AND state='RUNNING' AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.node_id=nodes.id AND a.state='RUNNING' AND a.mutation_allowed)",[task.id]);
 if(origin.node){const blocker=await blockNodeSource(tx,origin.node,'semantic',`Replan ${id}: ${reason}`,attempt.id);await tx.query('UPDATE replan_requests SET requester_blocker_id=$2 WHERE id=$1',[id,blocker]);await tx.query("UPDATE attempts SET state='SUCCEEDED',mutation_allowed=false,end_reason='replan_requested' WHERE id=$1",[attempt.id]);await stopPlanningAttempt(tx,attempt,requestId);}
 await tx.query("UPDATE tasks SET state='REPLAN_REQUIRED',control_version=control_version+1 WHERE id=$1",[task.id]);
 await planningEvent(tx,task.id,'replan_requested',{replan_request_id:id,reason,origin_node_id:origin.node?.node_id,input_id:origin.input_id},attempt.id);return id;
}
export function replanSource(s:ReplanSource):TaskReplanSource{return {request_id:s.request_id,source_id:s.id,specification_id:s.specification_id,plan_id:s.plan_id,control_version:Number(s.expected_version),context_digest:s.context_digest};}
export async function assertReplanSource(tx:Transaction,taskId:string,source:TaskReplanSource,attemptId:string,prompt?:string):Promise<ReplanSource>{
 const s=(await tx.query<ReplanSource>(`SELECT s.* FROM replan_sources s JOIN replan_requests r ON r.source_id=s.id JOIN tasks t ON t.id=s.task_id WHERE s.id=$1 AND s.task_id=$2 AND s.planned_attempt_id=$3 AND r.status='pending' AND r.issue_id IS NULL AND r.proposal_id IS NULL AND t.state='REPLAN_REQUIRED' AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id AND t.control_version=s.expected_version AND NOT EXISTS(SELECT 1 FROM task_publication_slots p WHERE p.task_id=t.id)`,[source.source_id,taskId,attemptId])).rows[0];
 if(!s||s.preparation_failure||canonicalJSON(replanSource(s))!==canonicalJSON(source)||(prompt!==undefined&&s.prompt!==prompt))throw new CommandError('stale_execution','Replan source or exact basis is no longer current');return s;
}
export async function replanImpact(tx:Transaction,task:SpecificationTask,targetNodeId?:string):Promise<ReplanImpact>{
 const n=(await tx.query(`SELECT n.*,c.operation_id,m.content_digest FROM nodes n JOIN plan_nodes p ON p.node_id=n.id LEFT JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation LEFT JOIN completion_manifests m ON m.operation_id=c.operation_id WHERE p.plan_id=$1`,[task.plan_id])).rows;
 if(n.length!==1)throw new CommandError('unmet_precondition','Replan supports exactly one existing Node');const node=n[0]!;const target=targetNodeId??node.id;
 const req=await pendingReplan(tx,task.id);const blocker=node.blocker_id?(await tx.query('SELECT * FROM node_blockers WHERE id=$1',[node.blocker_id])).rows[0]:null;
 const requestBlock=blocker&&req&&blocker.id===req.requester_blocker_id;
 const inherited=(await tx.query<{origin:ReplanImpact['holds'][number]}>('SELECT origin FROM replan_control_holds WHERE node_id=$1 AND node_activation=$2 AND resolved_by IS NULL ORDER BY id',[node.id,node.activation])).rows.map(h=>h.origin);
 const ownerStop=(await tx.query<{request_id:string}>("SELECT request_id FROM owner_command_receipts WHERE scope_id=$1 AND envelope_json::jsonb->>'name'='stop_node' AND envelope_json::jsonb->'payload'->>'node_id'=$2 ORDER BY (response->>'control_version')::bigint DESC LIMIT 1",[task.id,node.id])).rows[0]?.request_id??null;
 const provenance={origin_node_id:node.id,origin_node_activation:Number(node.activation),owner_request_id:ownerStop};
 const holds:ReplanImpact['holds']=[...inherited];
 const inheritedBlocker=blocker&&(await tx.query('SELECT 1 FROM replan_control_holds WHERE node_id=$1 AND current_blocker_id=$2 AND resolved_by IS NULL',[node.id,blocker.id])).rowCount;
 if(blocker&&!requestBlock&&!inheritedBlocker)holds.push({blocker_id:blocker.id,kind:blocker.kind,reason:blocker.reason,...provenance,owner_request_id:blocker.kind==='owner_stopped'?ownerStop:null});
 if(node.guidance_paused&&!holds.some(h=>h.kind==='owner_stopped'))holds.push({blocker_id:null,kind:'owner_stopped',reason:'owner_stopped',...provenance});
 const guidance=(await tx.query("SELECT id,version FROM task_guidance WHERE task_id=$1 AND status='active' ORDER BY id LIMIT 257",[task.id])).rows;if(guidance.length>256)throw new CommandError('unmet_precondition','Guidance exceeds complete impact budget');
 const workspaces:ReplanWorkspaceInput[]=[];
 for(const w of (await tx.query(`SELECT w.*,l.id lease_id,l.attempt_id,l.node_id,l.node_activation,l.settle_operation_id,l.checkpoint,a.plan_id FROM task_workspaces w JOIN LATERAL(SELECT * FROM workspace_leases WHERE workspace_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1) l ON true JOIN attempts a ON a.id=l.attempt_id WHERE w.task_id=$1 AND w.ever_materialized`,[task.id])).rows){
  const settlementId=w.checkpoint?.operation_id??w.settle_operation_id;
  if(!settlementId)throw new CommandError('unmet_precondition','Workspace has no exact settlement');const op=(await tx.query("SELECT * FROM operations WHERE id=$1 AND workspace_lease_id=$2 AND state='succeeded'",[settlementId,w.lease_id])).rows[0];
  if(!op)throw new CommandError('unmet_precondition','Workspace settlement is not successful');
  const result=op.result as {workspace_metadata?:ReplanWorkspaceInput['metadata'];git_tree?:string}|null;
  if(!result?.workspace_metadata)throw new CommandError('unmet_precondition','Workspace settlement metadata unavailable');
  const item:ReplanWorkspaceInput={workspace_id:w.id,task_id:task.id,resource_id:w.resource_id,runner_id:w.runner_id,from_plan_id:w.plan_id,from_node_id:w.node_id,from_node_activation:Number(w.node_activation),from_attempt_id:w.attempt_id,from_lease_id:w.lease_id,settle_operation_id:settlementId,kind:w.checkpoint?'checkpoint':'completed',metadata:result.workspace_metadata};
  if(!w.checkpoint){const c=(await tx.query('SELECT operation_id FROM node_completions WHERE attempt_id=$1',[w.attempt_id])).rows[0];if(!c||!result.git_tree)throw new CommandError('unmet_precondition','Completed workspace lacks exact completion');item.completion_operation_id=c.operation_id;item.completion_manifest_digest=op.completion_manifest_digest;item.finalized_tree=result.git_tree;}
  workspaces.push(item);
 }
 return {node:{node_id:node.id,node_activation:Number(node.activation),source_id:node.execution_source_id,completion_operation_id:node.operation_id??null,completion_manifest_digest:node.content_digest??null,disposition:target!==node.id?'replace':node.operation_id?'carry':'refresh',target_node_id:target,target_node_activation:target!==node.id?1:Number(node.activation)},guidance:guidance.map(g=>({guidance_id:g.id,version:Number(g.version),disposition:'retain',target_node_id:target})),holds,workspaces};
}
export async function checkReplanImpact(tx:Transaction,task:SpecificationTask,impact:ReplanImpact):Promise<void>{
 validate('ReplanImpact',impact);const actual=await replanImpact(tx,task,impact.node.target_node_id);
 const omit=(x:ReplanImpact['node'])=>{const rest={...x} as Partial<ReplanImpact['node']>;delete rest.disposition;delete rest.target_node_activation;return rest;};
 if(canonicalJSON(omit(actual.node))!==canonicalJSON(omit(impact.node))||canonicalJSON(actual.holds)!==canonicalJSON(impact.holds)||canonicalJSON(actual.workspaces)!==canonicalJSON(impact.workspaces))throw new CommandError('version_conflict','Exact Node, independent holds or workspace facts changed');
 await assertCurrentNode(tx,{task_id:task.id,node_id:impact.node.node_id,node_activation:impact.node.node_activation});
 const n=impact.node;const changed=n.node_id!==n.target_node_id;
 if(changed?(n.disposition!=='replace'||n.target_node_activation!==1):(n.disposition==='replace'||n.target_node_activation!==n.node_activation+(n.disposition==='invalidate'?1:0)))throw new CommandError('invalid_input','Invalid target activation disposition');
 if(!changed&&((n.disposition==='refresh')!==!n.completion_operation_id))throw new CommandError('invalid_input','Completion requires exact carry or invalidation');
 if(impact.guidance.length!==actual.guidance.length||new Set(impact.guidance.map(g=>g.guidance_id)).size!==impact.guidance.length||impact.guidance.some(g=>g.target_node_id!==n.target_node_id||!actual.guidance.some(a=>a.guidance_id===g.guidance_id&&a.version===g.version)))throw new CommandError('version_conflict','Complete guidance disposition changed');
}
export async function createReplanSource(tx:Transaction,task:SpecificationTask,r:ReplanRequest,config:number):Promise<void>{
 if(!await replanQuiescent(tx,task.id))return;
 const predecessor=(await tx.query<{id:string}>('SELECT s.id FROM replan_sources s WHERE s.request_id=$1 AND NOT EXISTS(SELECT 1 FROM replan_sources next WHERE next.previous_source_id=s.id)',[r.id])).rows[0]?.id??null;
 const id=randomUUID(),attemptId=randomUUID();const input=Number((await tx.query("SELECT COALESCE(max(sequence),0) n FROM task_messages WHERE task_id=$1 AND author='owner'",[task.id])).rows[0].n);
 const graph=(await tx.query('SELECT content FROM plan_revisions WHERE id=$1',[task.plan_id])).rows[0].content;
 const spec=(await tx.query('SELECT content FROM specification_revisions WHERE id=$1',[task.specification_id])).rows[0].content;
 const roles=(await tx.query('SELECT r.id,r.name,r.description FROM roles r JOIN project_roles p ON p.role_id=r.id JOIN tasks t ON t.project_id=p.project_id WHERE t.id=$1 AND NOT r.archived ORDER BY r.id',[task.id])).rows;
 const decisions=(await tx.query('SELECT kind,body FROM replan_decisions WHERE request_id=$1 ORDER BY owner_request_id LIMIT 257',[r.id])).rows;
 const messages=(await tx.query('SELECT sequence,author,content FROM task_messages WHERE task_id=$1 ORDER BY sequence DESC LIMIT 33',[task.id])).rows.reverse();
 const project=(await tx.query("SELECT p.id,p.name,p.context,COALESCE((SELECT jsonb_agg(settings ORDER BY id) FROM project_resources WHERE project_id=p.id AND active),'[]'::jsonb) resources FROM projects p JOIN tasks t ON t.project_id=p.id WHERE t.id=$1",[task.id])).rows[0];
 const ownerGuidance=(await tx.query('SELECT planner_guidance FROM execution_policies')).rows[0]?.planner_guidance??'';
 const taskGuidance=(await tx.query("SELECT id,text,node_id,version FROM task_guidance WHERE task_id=$1 AND status='active' ORDER BY id LIMIT 257",[task.id])).rows;
 const event=Number((await tx.query('SELECT event_sequence FROM tasks WHERE id=$1',[task.id])).rows[0].event_sequence);
 const historicalResults=(await tx.query('SELECT n.id node_id,n.activation,n.state,n.result FROM nodes n JOIN plan_nodes p ON p.node_id=n.id WHERE p.plan_id=$1 ORDER BY n.id',[task.plan_id])).rows.map(n=>({...n,activation:Number(n.activation),validity:'Historical source evidence; only approved applicability can retain current authority'}));
 const requirements=(await tx.query("SELECT p.id,p.specification,p.summary,p.content_digest FROM requirement_proposals p JOIN requirement_obligations o ON o.current_proposal_id=p.id WHERE p.replan_source_id IN(SELECT id FROM replan_sources WHERE request_id=$1) AND o.status='pending' ORDER BY p.id LIMIT 65",[r.id])).rows;
 let impact:ReplanImpact|undefined,preparationFailure:string|null=null;
 try{impact=await replanImpact(tx,task);}catch(e){if(!(e instanceof CommandError))throw e;preparationFailure=e.detail.code;}
 const reviewOrigin=r.review_operation_id?(await tx.query('SELECT f.id feedback_id,f.text,o.basis,o.id operation_id,s.context FROM task_review_operations o JOIN task_review_feedback f ON f.id=o.feedback_id JOIN task_review_sources s ON s.id=$2 WHERE o.id=$1',[r.review_operation_id,r.review_source_id])).rows[0]:null;
 let context:Record<string,unknown>|null={review_origin:reviewOrigin,historical_results:historicalResults,project,owner_planner_guidance:ownerGuidance,task_guidance:taskGuidance,pending_requirements:requirements,protocol:'You are the canonical Replan Planner. Call prepare_replan with the exact source/request/basis, complete single Node graph and explicit impact, or raise_planning_issue with source/request/reason. Both are terminal. Requirements may change only through optional full requirement proposal and two exact Owner confirmations. No Node workspace or writable repository. Do not use commit_task_turn or publish_execution_plan. Uncertain requests must replay original IDs.',source_id:id,replan_request_id:r.id,reason:r.reason,basis:{control_version:Number(task.control_version),specification_id:task.specification_id,plan_id:task.plan_id},specification:spec,graph,impact,roles,decisions,messages:messages.slice(-32),messages_has_more:messages.length>32,input_cutoff:input,event_cutoff:event};
 let prompt:string|null=canonicalJSON(context);if(preparationFailure||taskGuidance.length>256||requirements.length>64||decisions.length>256||Buffer.byteLength(JSON.stringify({prompt}))>MAX_ITEM_BYTES-16384){prompt=null;context=null;preparationFailure??='context_budget_exceeded';}
 const hash=digest(prompt??canonicalJSON({source_id:id,preparation_failure:preparationFailure}));
 await tx.query('INSERT INTO replan_sources(id,task_id,request_id,previous_source_id,planned_attempt_id,specification_id,plan_id,expected_version,input_cutoff,event_cutoff,configuration_version,context,prompt,context_digest,preparation_failure,waiting_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)',[id,task.id,r.id,predecessor,attemptId,task.specification_id,task.plan_id,task.control_version,input,event,config,context,prompt,hash,preparationFailure]);
 await tx.query('UPDATE replan_requests SET source_id=$2,issue_id=NULL,proposal_id=NULL,version=version+1 WHERE id=$1',[r.id,id]);
}
export async function replanProposal(tx:Transaction,taskId:string,id:string):Promise<ReplanProposal>{const p=(await tx.query<ReplanProposal>('SELECT * FROM replan_proposals WHERE task_id=$1 AND id=$2',[taskId,id])).rows[0];if(!p)throw new CommandError('denied_scope','Unknown Replan proposal');return p;}
export async function laterReplanInputs(tx:Transaction,p:ReplanProposal):Promise<void>{if((await tx.query(`SELECT 1 FROM task_inputs i JOIN task_messages m ON m.id=i.message_id LEFT JOIN task_input_resolutions r ON r.input_id=i.id WHERE i.task_id=$1 AND (m.sequence>$2 OR i.status IN ('pending','failed')) AND i.id IS DISTINCT FROM (SELECT input_id FROM replan_requests WHERE id=$4) AND i.accepted_delivery_operation_id IS NULL AND i.status<>'withdrawn' AND COALESCE(r.routing->>'kind','')<>'reply' AND NOT EXISTS(SELECT 1 FROM replan_input_deferrals d WHERE d.proposal_id=$3 AND d.input_id=i.id AND d.input_version=i.version) LIMIT 1`,[p.task_id,p.content.input_cutoff,p.id,p.request_id])).rowCount)throw new CommandError('unmet_precondition','Later input requires interpretation or exact Replan deferral');}
export async function eligibleReplan(tx:Transaction,task:SpecificationTask,p:ReplanProposal):Promise<void>{
 mutableSpecification(task);exactBasis(task,p.content.basis);
 if(!(await tx.query("SELECT 1 FROM replan_requests r JOIN task_command_proposals g ON g.id=r.proposal_id WHERE r.id=$1 AND r.status='pending' AND r.proposal_id=$2 AND NOT g.revoked AND g.expires_at>clock_timestamp()",[p.request_id,p.id])).rowCount)throw new CommandError('unmet_precondition','Replan proposal no longer eligible');
 await checkReplanImpact(tx,task,p.content.impact);await laterReplanInputs(tx,p);
 if(p.requirement_proposal_id&&!(await tx.query("SELECT 1 FROM requirement_obligations o JOIN task_command_proposals g ON g.id=o.current_proposal_id WHERE g.id=$1 AND o.status='pending' AND NOT g.revoked AND g.expires_at>clock_timestamp()",[p.requirement_proposal_id])).rowCount)throw new CommandError('unmet_precondition','Joint requirements were withdrawn or replaced');
}
export async function handleReplanCommand(tx:Transaction,task:SpecificationTask,attempt:PlanningAttempt,command:CommandEnvelope):Promise<{result:EffectResult;operation_id:string}>{
 const binding=attempt.launch.task_replan_source;if(!binding)throw new CommandError('denied_scope','Dedicated Replan source required');
 const source=await assertReplanSource(tx,task.id,binding,attempt.id,attempt.launch.prompt);
 if(command.payload.replan_request_id!==source.request_id||command.payload.source_id!==source.id)throw new CommandError('denied_scope','Exact Replan source required');
 let outcome:NonNullable<EffectResult['replan_outcome']>;
 if(command.name==='prepare_replan'){
  const input=validate<PrepareReplan>('PrepareReplan',command.payload);exactBasis(task,input.basis);validatePlan(input.nodes);if(input.nodes.length!==1||input.nodes[0]!.dependencies.length||input.nodes[0]!.consumes?.length)throw new CommandError('unmet_precondition','Only one Node without dependencies/consumes is supported');
  const node=input.nodes[0]!;if(node.node_id!==input.impact.node.target_node_id)throw new CommandError('invalid_input','Impact target differs from complete graph');await checkReplanImpact(tx,task,input.impact);
  const old=(await tx.query('SELECT definition FROM plan_nodes WHERE plan_id=$1 AND node_id=$2',[task.plan_id,node.node_id])).rows[0];
  if(old&&canonicalJSON(old.definition)!==canonicalJSON(node))throw new CommandError('invalid_input','Changed formal definition requires a new Node ID');
  if(!old&&(await tx.query('SELECT 1 FROM nodes WHERE id=$1',[node.node_id])).rowCount)throw new CommandError('payload_conflict','Replacement Node ID already exists');
  if(!(await tx.query('SELECT 1 FROM tasks t JOIN project_roles p ON p.project_id=t.project_id JOIN roles r ON r.id=p.role_id WHERE t.id=$1 AND r.id=$2 AND NOT r.archived',[task.id,node.role_id])).rowCount)throw new CommandError('unmet_precondition','Node Role must remain Project-selected');
  let requirementDigest:string|undefined;
  if(input.requirement){const {prepareJointRequirement}=await import('./task-replan-publication.ts');requirementDigest=await prepareJointRequirement(tx,task,source,input);}
  const content={...input,input_cutoff:Number(source.input_cutoff),...(requirementDigest?{requirement_content_digest:requirementDigest}:{})};
  const g=await prepareTaskProposal(tx,{id:input.proposal_id,task_id:task.id,action:'publish_replan',content});
  await tx.query('INSERT INTO replan_proposals(id,task_id,request_id,source_id,plan_id,content,content_digest,requirement_proposal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[input.proposal_id,task.id,source.request_id,source.id,input.plan_id,content,g.content_digest,input.requirement?.proposal_id]);
  await tx.query('UPDATE replan_requests SET proposal_id=$2,version=version+1 WHERE id=$1',[source.request_id,input.proposal_id]);
  outcome={kind:'proposal',replan_request_id:source.request_id,source_id:source.id,proposal_id:input.proposal_id,content_digest:g.content_digest,...(input.requirement?{requirement_proposal_id:input.requirement.proposal_id,requirement_content_digest:requirementDigest}:{})};
 }else if(command.name==='raise_planning_issue'){
  validate('PlanningText',command.payload.reason);const id=randomUUID();await tx.query('INSERT INTO replan_issues(id,task_id,request_id,source_id,reason) VALUES($1,$2,$3,$4,$5)',[id,task.id,source.request_id,source.id,command.payload.reason]);await tx.query('UPDATE replan_requests SET issue_id=$2,version=version+1 WHERE id=$1',[source.request_id,id]);outcome={kind:'issue',replan_request_id:source.request_id,source_id:source.id,issue_id:id};
 }else throw new CommandError('denied_scope','Replan phase requires prepare_replan or planning issue');
 await tx.query("UPDATE attempts SET state='SUCCEEDED',mutation_allowed=false,end_reason='replan_outcome' WHERE id=$1",[attempt.id]);
 await tx.query('UPDATE replan_sources SET done=true,waiting_reason=NULL WHERE id=$1',[source.id]);
 const operation=await stopPlanningAttempt(tx,attempt,command.request_id);if(!operation)throw new CommandError('stale_execution','Replan process claim missing');
 await planningEvent(tx,task.id,'replan_'+outcome.kind+'_prepared',outcome,attempt.id,operation);return {result:{replan_outcome:outcome},operation_id:operation};
}
export async function workspaceTransfer(tx:Transaction,taskId:string,nodeId:string,activation:number,workspaceId:string,leaseId:string):Promise<WorkspaceTransfer|undefined>{
 return (await tx.query<{descriptor:WorkspaceTransfer}>(`SELECT x.descriptor FROM replan_workspace_transfers x JOIN replan_publications p ON p.id=x.publication_id JOIN tasks t ON t.id=x.task_id WHERE x.task_id=$1 AND x.target_node_id=$2 AND x.target_node_activation=$3 AND x.workspace_id=$4 AND x.descriptor->>'from_lease_id'=$5 AND p.new_plan_id=t.plan_id AND activation_applies(t.id,x.target_node_id,x.target_node_activation,t.specification_id,t.plan_id)`,[taskId,nodeId,activation,workspaceId,leaseId])).rows[0]?.descriptor;
}
