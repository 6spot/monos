import { workspaceIsolation } from './workspace-placement.ts';
import { activateInheritedHold } from './task-replan-holds.ts';
import { liveReplanAuthority, assertNoReplan, pendingReplan } from './task-replan-state.ts';
import { assertSpecificationUnfrozen, assertTaskUnaccepted, specificationFrozen } from './task-specification-state.ts';
import { remoteItemQuiescent } from './remote-preparation-state.ts';
import { reviewDispatchBlocked } from './task-review-state.ts';
import type { RuntimeFallbackInspection, RuntimeFallbackPreparation, RuntimePredecessor } from './runtime-continuation-state.ts';
import { runtimePredecessorSettled } from './runtime-continuation-state.ts';
import { guidanceContext, assignGuidance } from './task-guidance.ts';
import { assertCompletionBoundaryAvailable } from './completion-boundary.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, workspaceId } from '../../../packages/protocol/src/index.ts';
import type { NodeExecutionSource } from '../../../packages/protocol/src/index.ts';
import { planningEvent } from './task-planning-state.ts';
import { derivedTaskState } from './owner-execution.ts';
import { nodeUpstreamContext } from './node-upstream-context.ts';
import { currentNodeRework } from './node-rework-state.ts';

export interface NodeSource {
  id: string;
  task_id: string;
  node_id: string;
  node_activation: string;
  specification_id: string;
  plan_id: string;
  expected_version: string;
  planned_attempt_id: string;
  role_id: string;
  prompt: string | null;
  context_digest: string;
  done: boolean;
  preparation_failure: string | null;
  waiting_reason: string | null;
}
export interface NodeTask {
  id: string;
  state: string;
  project_id: string;
  specification_id: string;
  plan_id: string;
  control_version: string;
}
export interface ExecutionNode {
  guidance_paused: boolean;
  id: string;
  task_id: string;
  activation: string;
  state: string;
  execution_source_id: string | null;
  blocker_id: string | null;
}
export function nodeSource(row: NodeSource): NodeExecutionSource {
  return {
    source_id: row.id,
    node_id: row.node_id,
    node_activation: Number(row.node_activation),
    specification_id: row.specification_id,
    plan_id: row.plan_id,
    control_version: Number(row.expected_version),
    context_digest: row.context_digest,
  };
}
export async function assertNodeSource(
  tx: Transaction,
  taskId: string,
  source: NodeExecutionSource,
  attemptId: string,
  prompt?: string
): Promise<NodeSource> {
  await assertTaskUnaccepted(tx,taskId);
  if (await currentNodeRework(tx, taskId, source.node_id))
    throw new CommandError('stale_execution', 'Upstream Rework owns this Node execution');
  if(await liveReplanAuthority(tx,taskId,attemptId)){const live=(await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1',[source.source_id])).rows[0];if(live&&canonicalJSON(nodeSource(live))===canonicalJSON(source)&&(prompt===undefined||live.prompt===prompt))return live;throw new CommandError('stale_execution','Live Replan source differs');}
  await assertSpecificationUnfrozen(tx,taskId);
  const row = (
    await tx.query<NodeSource>(
      `SELECT s.* FROM node_execution_outbox s JOIN tasks t ON t.id=s.task_id JOIN nodes n ON n.id=s.node_id
  WHERE s.id=$1 AND s.task_id=$2 AND s.planned_attempt_id=$3 AND n.execution_source_id=s.id AND n.activation=s.node_activation
  AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id AND t.state='RUNNING'
  AND (NOT s.done OR EXISTS(SELECT 1 FROM attempts a WHERE a.id=$3 AND a.node_execution_source_id=s.id))
  AND NOT EXISTS(SELECT 1 FROM task_guidance_followups f WHERE f.source_id=s.id AND f.status='waiting')`,
      [source.source_id, taskId, attemptId]
    )
  ).rows[0];
  if (
    !row ||
    row.preparation_failure ||
    canonicalJSON(nodeSource(row)) !== canonicalJSON(source) ||
    (prompt !== undefined && row.prompt !== prompt)
  )
    throw new CommandError('stale_execution', 'Node source or revision is no longer current');
  return row;
}
const protocol = [
  'You execute exactly the bound Node. Only monos Tool Protocol commands change formal state. Follow the effective Specification, exact Node requirements, current Role instructions and formal Owner answers. Todo, prior Tasks and Runtime memory are not authority.',
  'Apply the exact review_rework feedback and Planner routing reason for this activation. They request correction within the effective Specification; they do not replace the Specification or create guidance IDs.',
  'node_rework records the exact upstream correction request, affected activations and any Owner decision. Applied requests require correction of the existing integrated code. A continued request records the Owner decision to continue without its proposed upstream correction; that proposal was not applied. Prior completion results and private workspace checkpoints are retained history, not completion or validation of this activation. Validate the current result.',
  'For every historical_checkpoints item in node_rework, first successfully open_workspace for its resource_id. Inspect the exact checkpoint.commit_id or git_ref with native git show/diff; the stopped private changes are historical context. Adapt relevant work to the current integrated result. Never automatically checkout, cherry-pick or replay the checkpoint. The original raw workspace remains separately archived by the system.',
  'upstream_outputs contains current completed direct dependencies and their selected Artifact metadata. Read exact content with read_artifact. Historical output and earlier Git revisions do not prove that the current combined result is valid.',
  'Use monos open_workspace with resource_id only when repository work is needed. Work freely within that managed workspace; preserve previous private work and fixed Git ancestry. Do not create your own repository as a substitute for managed work.',
  'Optional durable outputs use monos publish_artifact with artifact_id, title, content:{text,media_type}, optional references:[{url,label?}] and supersedes. UTF-8 text is limited to 256 KiB. Artifact publication is not completion. Read exact Task content with monos read_artifact {artifact_id}. HTML is managed data.',
  'Finish with monos complete_node {summary,artifact_ids?,handled_guidance_ids?}. Explicitly declare every required_guidance_id you have handled; absence declares none and rejects missing required handling. If blocked, use block_node with the precise reason. Guidance launch is not proof of handling. Omitted artifact_ids selects outputs from this Attempt; [] selects none; explicit IDs select same Node/activation outputs. No Artifact or repository is mandatory. If a previous Attempt left a private workspace checkpoint, reopen and finalize it before completion. Complete closes mutation authority and the system stops the process and finalizes Git; prose/process exit never completes.',
  'If complete_node reports another completion still owns the Task boundary, your Attempt remains active. Wait briefly and retry; a precondition rejection is not completed work. A recovery.integration_conflict record preserves the old result for inspection: open_workspace on the latest Task base, inspect the supplied old node commit, and adapt your work rather than replaying the old tree. Integration conflict retry retains this Node activation.',
  'If external input prevents this valid Node from continuing, call monos block_node {reason}. This records a precise Owner-answerable blocker and closes this Attempt. Never fabricate Runtime failure.',
  'If existing upstream work must be redone while the graph remains valid, use monos request_rework {target_node_id?,reason}. Omit target_node_id only with exactly one direct dependency; an explicit target must be a current upstream ancestor. The system preserves history and reactivates that Node and every descendant after physical settlement. Three automatic requests are allowed per Task between Owner resets; a further request is preserved for an exact Owner decision. This command ends your current Attempt.',
  'Use monos COMMAND --request-id ID --input payload.json --output json (or --input -); monos command-status --request-id ID --output json; monos retry --request-id ID --output json. On uncertainty recover the same request, never substitute a new lifecycle command.',
].join('\n');

async function nodeReworkContext(tx: Transaction, task: NodeTask, node: ExecutionNode) {
  const rows = (await tx.query<{ item: Record<string, unknown>; bytes: string }>(`WITH contexts AS (
    SELECT jsonb_build_object('rework_request_id',r.id,'status',r.status,'reason',r.reason,'target_node_id',r.target_node_id,
      'requester_node_id',r.requester_node_id,'requester_activation',r.requester_activation,
      'requester_attempt_id',r.requester_attempt_id,'requester_source_id',r.requester_source_id,
      'agent_request_id',r.agent_request_id,'applied_control_version',r.applied_control_version,
      'affected_nodes',(SELECT jsonb_agg(jsonb_build_object('node_id',x.node_id,'prior_activation',x.from_activation,
        'node_activation',CASE WHEN r.status='applied' THEN x.from_activation+1 ELSE x.from_activation END,'prior_source_id',x.source_id,
        'completion_operation_id',x.completion_operation_id,'completion_manifest_digest',x.completion_manifest_digest,
        'historical_result',c.result) ORDER BY x.node_id)
        FROM node_rework_targets x LEFT JOIN node_completions c ON c.operation_id=x.completion_operation_id
        WHERE x.request_id=r.id),
      'owner_decision',CASE WHEN d.owner_request_id IS NOT NULL THEN jsonb_build_object('request_id',d.owner_request_id,
        'name',d.name,'answer',d.answer,'expected_version',d.expected_version) ELSE NULL END,
      'historical_checkpoints',COALESCE((SELECT jsonb_agg(jsonb_build_object('workspace_id',stop.workspace_descriptor->>'workspace_id',
          'resource_id',stop.workspace_descriptor->>'resource_id','stop_operation_id',stop.id,
          'checkpoint',stop.result->'workspace_metadata'->'checkpoint','git_ref','refs/monos/history/'||r.id) ORDER BY stop.resource_id)
        FROM node_rework_request_stops member JOIN operations stop ON stop.id=member.operation_id
        WHERE member.request_id=r.id AND r.status='applied' AND stop.attempt_id=r.requester_attempt_id
          AND stop.kind='stop' AND stop.state='succeeded' AND stop.request_id=r.agent_request_id
          AND stop.result->'workspace_metadata'->'checkpoint' IS NOT NULL),'[]'::jsonb),
      'validity','Prior completion identities and results are historical only; they do not complete or validate the reactivated subgraph.') item
    FROM node_rework_requests r JOIN node_rework_targets target ON target.request_id=r.id
    LEFT JOIN node_rework_decisions d ON d.request_id=r.id AND d.owner_request_id=r.owner_decision_request_id
    WHERE r.task_id=$1 AND r.specification_id=$2 AND r.plan_id=$3 AND target.node_id=$4
      AND ((r.status='applied' AND target.from_activation+1=$5)
        OR (r.status='continued' AND r.requester_node_id=$4 AND r.requester_activation=$5))
  ), sized AS (SELECT item,sum(octet_length(item::text)) OVER () bytes FROM contexts)
  SELECT CASE WHEN bytes<=$6 THEN item ELSE '{}'::jsonb END item,bytes FROM sized ORDER BY item->>'rework_request_id'`,
  [task.id, task.specification_id, task.plan_id, node.id, node.activation, MAX_ITEM_BYTES / 2])).rows;
  if (rows.some(row => Number(row.bytes) > MAX_ITEM_BYTES / 2)) throw new CommandError('unmet_precondition', 'context_budget_exceeded');
  return rows.map(row => row.item);
}

export async function prepareNodeSource(
  tx: Transaction,
  task: NodeTask,
  node: ExecutionNode,
  configurationVersion: number,
  options: { request_id?: string; recovery?: object; defer_dependencies?: true } = {}
): Promise<NodeSource> {
  await assertCompletionBoundaryAvailable(tx, task.id);
  await assertSpecificationUnfrozen(tx,task.id);
  await assertNoReplan(tx,task.id);
  if (await currentNodeRework(tx, task.id, node.id))
    throw new CommandError('unmet_precondition', 'Upstream Rework must resolve before preparing this Node');
  const id = randomUUID(),
    attemptId = randomUUID();
  const definition = (
    await tx.query<{ definition: { role_id: string; dependencies: string[]; consumes?: string[] } }>(
      'SELECT definition FROM plan_nodes WHERE plan_id=$1 AND node_id=$2',
      [task.plan_id, node.id]
    )
  ).rows[0]!.definition;
  const binding = {
    source_id: id,
    task_id: task.id,
    node_id: node.id,
    node_activation: Number(node.activation),
    specification_id: task.specification_id,
    plan_id: task.plan_id,
    control_version: Number(task.control_version),
    planned_attempt_id: attemptId,
    configuration_version: configurationVersion,
  };
  const conflict = (await tx.query<{ facts: object }>(`SELECT jsonb_build_object('operation_id',o.id,'attempt_id',a.id,
    'workspace_results',o.result->'workspace_results') facts FROM operations o JOIN attempts a ON a.id=o.attempt_id
    WHERE a.task_id=$1 AND a.node_id=$2 AND a.node_activation=$3 AND o.kind='complete_node' AND o.state='succeeded'
      AND o.result->>'completion_outcome'='conflict' ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,
  [task.id, node.id, node.activation])).rows[0];
  const recovery = { ...(conflict ? { integration_conflict: conflict.facts } : {}), ...options.recovery };
  let failure: string | null = null;
  let upstream: Awaited<ReturnType<typeof nodeUpstreamContext>> | undefined;
  let rework: Awaited<ReturnType<typeof nodeReworkContext>> = [];
  try {
    upstream = await nodeUpstreamContext(tx, task.id, task.plan_id, definition.dependencies, definition.consumes ?? []);
    rework = await nodeReworkContext(tx, task, node);
  }
  catch (error) {
    if (!(error instanceof CommandError)) throw error;
    if (options.defer_dependencies && error.message === 'Node dependencies lack current completion evidence') failure = 'waiting_for_dependencies';
    else if (error.message === 'context_budget_exceeded') failure = 'context_budget_exceeded';
    else throw error;
  }
  let context: object | null = null,
    prompt: string | null = null;
  const bytes = Number(
    (
      await tx.query<{ size: string }>(
        `SELECT COALESCE(sum(octet_length(body::text)),0) size FROM task_events WHERE task_id=$1 AND kind='planning_retried' AND body->>'specification_id'=$2 AND body ? 'answer'`,
        [task.id, task.specification_id]
      )
    ).rows[0]!.size
  );
  const artifactsBytes = Number(
    (
      await tx.query<{ size: string }>(
        `SELECT COALESCE(sum(octet_length(title)+octet_length(external_references::text)+1024),0) size FROM artifacts WHERE task_id=$1 AND node_id=$2 AND node_activation=$3`,
        [task.id, node.id, node.activation]
      )
    ).rows[0]!.size
  );
  if (!failure && bytes + artifactsBytes > MAX_ITEM_BYTES / 2) failure = 'context_budget_exceeded';
  let guidance: Awaited<ReturnType<typeof guidanceContext>> = {items:[],required_guidance_ids:[]};
  if(!failure){try{guidance=await guidanceContext(tx,task.id,node.id,Number(node.activation));}catch(e){if(!(e instanceof CommandError))throw e;failure='context_budget_exceeded';}}
  if (!failure) {
    const specification = (
      await tx.query<{ content: unknown }>('SELECT content FROM specification_revisions WHERE id=$1 AND task_id=$2', [
        task.specification_id,
        task.id,
      ])
    ).rows[0]!.content;
    const role = (
      await tx.query('SELECT id,name,description,instructions FROM roles WHERE id=$1', [definition.role_id])
    ).rows[0];
    const project = (
      await tx.query(
        `SELECT p.id,p.name,p.context,COALESCE((SELECT jsonb_agg(jsonb_build_object('resource_id',id,'settings',settings) ORDER BY id) FROM project_resources WHERE project_id=p.id AND active),'[]') resources FROM projects p WHERE id=$1`,
        [task.project_id]
      )
    ).rows[0];
    const answers = (
      await tx.query(
        `SELECT sequence,body FROM task_events WHERE task_id=$1 AND kind='planning_retried' AND body->>'specification_id'=$2 AND body ? 'answer' ORDER BY sequence`,
        [task.id, task.specification_id]
      )
    ).rows;
    const artifacts = (
      await tx.query(
        'SELECT id AS artifact_id,title,media_type,size_bytes,content_digest,attempt_id,external_references AS references FROM artifacts WHERE task_id=$1 AND node_id=$2 AND node_activation=$3 ORDER BY id',
        [task.id, node.id, node.activation]
      )
    ).rows;
    if (!role || !project) failure = 'configuration_missing';
    else {
      const resources = [];
      for (const resource of project.resources as { resource_id: string }[]) {
        const isolation = await workspaceIsolation(tx, task.id, node.id, node.activation, resource.resource_id);
        resources.push({ resource_id: resource.resource_id, workspace_id: workspaceId(task.id, resource.resource_id),
          ...(isolation ? { isolation } : {}) });
      }
      context = {
        protocol,
        guidance,
        upstream_outputs: upstream,
        node_rework: rework,
        review_rework:(await tx.query(`SELECT f.id feedback_id,f.request_id owner_request_id,f.text,f.basis,
          o.id operation_id,r.source_id review_source_id,r.attempt_id planner_attempt_id,r.request_id routing_request_id,
          r.body->>'reason' reason,$2::text node_id,$3::bigint node_activation
          FROM task_review_feedback f JOIN task_review_operations o ON o.id=f.current_operation_id AND o.feedback_id=f.id AND o.task_id=f.task_id
          JOIN task_review_resolutions r ON r.operation_id=o.id AND r.task_id=f.task_id
          WHERE f.task_id=$1 AND f.status='resolved' AND o.purpose='route_feedback' AND o.status='rework' AND r.kind='rework'
            AND o.basis->>'specification_id'=$4 AND o.basis->>'plan_id'=$5 AND COALESCE(r.body->'affected_node_ids',r.body->'node_ids') ? $2
            AND f.manifest->'outputs' @> jsonb_build_array(jsonb_build_object('node_id',$2::text,'node_activation',$3::bigint-1))
          ORDER BY r.created_at,r.operation_id`,[task.id,node.id,node.activation,task.specification_id,task.plan_id])).rows.map(r=>({...r,node_activation:Number(r.node_activation)})),
        binding,
        specification,
        node: definition,
        role,
        project,
        workspace_reservations: {
          project_id: task.project_id,
          configuration_version: configurationVersion,
          resources,
        },
        issue_answers: answers,
        artifact_history: {
          validity: 'Historical output candidates only; publication does not establish successful current completion.',
          items: artifacts,
        },
        replan_history:(await tx.query(`SELECT p.id publication_id,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('origin_node_id',a.node_id,'origin_activation',a.node_activation,
            'disposition',a.disposition,'historical_result',c.result) ORDER BY a.node_id)
            FROM replan_node_applicability a LEFT JOIN node_completions c ON c.node_id=a.node_id AND c.activation=a.node_activation
            WHERE a.publication_id=p.id AND (a.target_node_id=$2 OR a.disposition IN ('remove','invalidate'))),'[]'::jsonb) historical_results,
          COALESCE((SELECT jsonb_agg(w ORDER BY w->'input'->>'workspace_id') FROM jsonb_array_elements(proposal.content->'impact'->'workspaces') w
            WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(w->'target_nodes') target WHERE target->>'node_id'=$2)),'[]'::jsonb) workspace_dispositions
          FROM replan_publications p JOIN replan_proposals proposal ON proposal.id=p.proposal_id WHERE p.new_plan_id=$1`,[task.plan_id,node.id])).rows.map(r=>({...r,validity:'Historical input only; never completion of the current activation. Adopt assigned private work through open_workspace before completion; finalized work remains historical code under the exact approved Node scope.'})),
        recovery,
      };
      prompt = canonicalJSON(context);
      if (
        Array.from(prompt).length > 262144 ||
        Buffer.byteLength(JSON.stringify({ prompt })) > MAX_ITEM_BYTES - 16384
      ) {
        failure = 'context_budget_exceeded';
        context = null;
        prompt = null;
      }
    }
  }
  const hash = digest(prompt ?? canonicalJSON({ binding, failure }));
  await tx.query(
    `INSERT INTO node_execution_outbox(id,task_id,node_id,node_activation,specification_id,plan_id,expected_version,planned_attempt_id,configuration_version,role_id,previous_source_id,owner_request_id,recovery,context,prompt,context_digest,preparation_failure,waiting_reason,done)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18)`,
    [
      id,
      task.id,
      node.id,
      node.activation,
      task.specification_id,
      task.plan_id,
      task.control_version,
      attemptId,
      configurationVersion,
      definition.role_id,
      node.execution_source_id,
      options.request_id ?? null,
      recovery,
      context,
      prompt,
      hash,
      failure,
      !!failure,
    ]
  );
  if(!failure)await assignGuidance(tx,id,guidance.items);
  await tx.query('UPDATE nodes SET execution_source_id=$2,blocker_id=NULL WHERE id=$1', [node.id, id]);
  const source: NodeSource = {
    id,
    task_id: task.id,
    node_id: node.id,
    node_activation: node.activation,
    specification_id: task.specification_id,
    plan_id: task.plan_id,
    expected_version: task.control_version,
    planned_attempt_id: attemptId,
    role_id: definition.role_id,
    prompt,
    context_digest: hash,
    preparation_failure: failure,
    waiting_reason: failure,
    done: !!failure,
  };
  // Requirement publication may need an exact blocked source before upstream
  // reactivation finishes. Its caller preserves the original Owner/blocker
  // reason in this transaction; no executable context exists yet.
  if (failure) {
    if (!(options.defer_dependencies && failure === 'waiting_for_dependencies')) await blockNodeSource(tx, source, 'factual', failure);
  }
  else if (!options.request_id) await activateInheritedHold(tx, source);
  return source;
}
export async function blockNodeSource(
  tx: Transaction,
  source: NodeSource,
  kind: 'semantic' | 'factual' | 'owner_stopped',
  reason: string,
  attemptId?: string
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    'INSERT INTO node_blockers(id,task_id,node_id,node_activation,source_id,attempt_id,kind,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, source.task_id, source.node_id, source.node_activation, source.id, attemptId ?? null, kind, reason]
  );
  await tx.query("UPDATE nodes SET state='BLOCKED',blocker_id=$2 WHERE id=$1", [source.node_id, id]);
  await tx.query("UPDATE tasks SET state=$2 WHERE id=$1 AND state IN ('RUNNING','BLOCKED')", [source.task_id, await derivedTaskState(tx, source.plan_id)]);
  await tx.query('UPDATE node_execution_outbox SET done=true,waiting_reason=$2 WHERE id=$1', [
    source.id,
    reason.length <= 128 ? reason : kind,
  ]);
  await planningEvent(
    tx,
    source.task_id,
    'node_blocked',
    {
      node_id: source.node_id,
      node_activation: Number(source.node_activation),
      source_id: source.id,
      blocker_id: id,
      kind,
      reason,
    },
    attemptId
  );
  return id;
}

/** The caller holds Runner and Task control locks before inspecting this source. */
export async function inspectNodeRuntimeFallback(tx: Transaction, predecessor: RuntimePredecessor): Promise<RuntimeFallbackInspection> {
  const binding = predecessor.launch.node_execution_source;
  if (!binding || !predecessor.task_id || !predecessor.node_id || predecessor.todo_id || predecessor.launch.kind !== 'node')
    return { status: 'superseded', reason: 'node_source_missing' };
  if (await currentNodeRework(tx, predecessor.task_id, predecessor.node_id))
    return { status: 'superseded', reason: 'node_rework_owned' };
  const source = (await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE planned_attempt_id=$1', [predecessor.id])).rows[0];
  const task = (await tx.query<NodeTask & { accepted_delivery_operation_id: string | null }>('SELECT * FROM tasks WHERE id=$1', [predecessor.task_id])).rows[0];
  const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 AND task_id=$2', [predecessor.node_id, predecessor.task_id])).rows[0];
  if (!source || !task || !node || source.preparation_failure || source.task_id !== task.id || source.node_id !== node.id ||
      source.planned_attempt_id !== predecessor.id || node.execution_source_id !== source.id ||
      Number(node.activation) !== Number(source.node_activation) || Number(node.activation) !== Number(predecessor.node_activation) ||
      source.specification_id !== predecessor.specification_id || source.plan_id !== predecessor.plan_id ||
      task.specification_id !== source.specification_id || task.plan_id !== source.plan_id ||
      canonicalJSON(nodeSource(source)) !== canonicalJSON(binding) || source.prompt !== predecessor.launch.prompt)
    return { status: 'superseded', reason: 'node_source_obsolete' };
  if (task.accepted_delivery_operation_id || task.state !== 'RUNNING' || node.state !== 'RUNNING' || node.blocker_id || node.guidance_paused)
    return { status: 'superseded', reason: 'node_execution_resolved' };
  if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state<>'cancelled'", [predecessor.id])).rowCount)
    return { status: 'superseded', reason: 'node_completion_owned' };
  if ((await tx.query("SELECT 1 FROM task_guidance_followups WHERE node_id=$1 AND status='waiting'", [node.id])).rowCount)
    return { status: 'superseded', reason: 'node_guidance_owned' };
  if (await specificationFrozen(tx, task.id)) return { status: 'waiting', reason: 'specification_change' };
  if (await pendingReplan(tx, task.id)) return { status: 'waiting', reason: 'replan_pending' };
  if (await reviewDispatchBlocked(tx, task.id)) return { status: 'waiting', reason: 'task_input_pending' };
  if (!await remoteItemQuiescent(tx, task.id)) return { status: 'waiting', reason: 'remote_effects_pending' };
  return { status: 'ready' };
}

export async function prepareNodeRuntimeFallback(tx: Transaction, predecessor: RuntimePredecessor, configurationVersion: number): Promise<RuntimeFallbackPreparation> {
  const inspected = await inspectNodeRuntimeFallback(tx, predecessor);
  if (inspected.status !== 'ready') return inspected;
  // Recheck current physical facts even for a direct caller. Logical failure
  // alone never authorizes another source to reopen the same private workspace.
  const settled = (await tx.query<RuntimePredecessor & { end_reason: string | null }>(`SELECT a.* FROM attempts a
    JOIN runtime_continuations c ON c.predecessor_attempt_id=a.id
    JOIN operations stopped ON stopped.id=c.stop_operation_id AND stopped.attempt_id=a.id AND stopped.kind='stop' AND stopped.state='succeeded'
    WHERE a.id=$1 AND a.state='FAILED' AND NOT a.mutation_allowed AND c.state='settling'`, [predecessor.id])).rows[0];
  if (!settled || !await runtimePredecessorSettled(tx, settled)) return { status: 'waiting', reason: 'runtime_fallback_settling' };
  const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [predecessor.task_id])).rows[0]!;
  const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [predecessor.node_id])).rows[0]!;
  await tx.query('UPDATE node_execution_outbox SET done=true WHERE id=$1', [node.execution_source_id]);
  await tx.query("UPDATE nodes SET state='PENDING' WHERE id=$1", [node.id]);
  const source = await prepareNodeSource(tx, task, node, configurationVersion, {
    recovery: { runtime_predecessor_attempt_id: predecessor.id, prior_source_id: node.execution_source_id, reason: settled.end_reason ?? 'runtime_failed' },
  });
  return { status: 'prepared', source_id: source.id, planned_attempt_id: source.planned_attempt_id,
    ...(source.preparation_failure ? { preparation_failure: source.preparation_failure } : {}) };
}

export async function exhaustNodeRuntimeFallback(tx: Transaction, plannedAttemptId: string, reason: string): Promise<boolean> {
  const source = (await tx.query<NodeSource>(`SELECT s.* FROM node_execution_outbox s JOIN nodes n ON n.id=s.node_id JOIN tasks t ON t.id=s.task_id
    WHERE s.planned_attempt_id=$1 AND n.execution_source_id=s.id AND n.activation=s.node_activation
      AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id
      AND t.accepted_delivery_operation_id IS NULL AND t.state IN('RUNNING','BLOCKED')`, [plannedAttemptId])).rows[0];
  if (!source) return false;
  if (await currentNodeRework(tx, source.task_id, source.node_id)) return false;
  const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1', [source.node_id])).rows[0]!;
  if (node.state === 'BLOCKED') return !!(await tx.query("SELECT 1 FROM node_blockers WHERE id=$1 AND source_id=$2 AND kind='factual' AND reason=$3", [node.blocker_id, source.id, reason])).rowCount;
  if (!['PENDING', 'RUNNING'].includes(node.state) || node.guidance_paused || node.blocker_id || await specificationFrozen(tx, source.task_id) || await pendingReplan(tx, source.task_id)) return false;
  if ((await tx.query("SELECT 1 FROM task_guidance_followups WHERE node_id=$1 AND status='waiting'", [node.id])).rowCount) return false;
  const attempt = (await tx.query<{ id: string }>('SELECT id FROM attempts WHERE id=$1', [plannedAttemptId])).rows[0];
  await blockNodeSource(tx, source, 'factual', reason, attempt?.id);
  return true;
}
