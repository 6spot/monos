import { liveReplanAuthority, assertNoReplan } from './task-replan-state.ts';
import { assertSpecificationUnfrozen, assertTaskUnaccepted } from './task-specification-state.ts';
import { guidanceContext, assignGuidance } from './task-guidance.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, workspaceId } from '../../../packages/protocol/src/index.ts';
import type { NodeExecutionSource } from '../../../packages/protocol/src/index.ts';
import { planningEvent } from './task-planning-state.ts';

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
  if(await liveReplanAuthority(tx,taskId,attemptId)){const live=(await tx.query<NodeSource>('SELECT * FROM node_execution_outbox WHERE id=$1',[source.source_id])).rows[0];if(live&&canonicalJSON(nodeSource(live))===canonicalJSON(source)&&(prompt===undefined||live.prompt===prompt))return live;throw new CommandError('stale_execution','Live Replan source differs');}
  await assertSpecificationUnfrozen(tx,taskId);
  const row = (
    await tx.query<NodeSource>(
      `SELECT s.* FROM node_execution_outbox s JOIN tasks t ON t.id=s.task_id JOIN nodes n ON n.id=s.node_id
  WHERE s.id=$1 AND s.task_id=$2 AND s.planned_attempt_id=$3 AND n.execution_source_id=s.id AND n.activation=s.node_activation
  AND t.specification_id=s.specification_id AND t.plan_id=s.plan_id AND t.control_version=s.expected_version AND t.state='RUNNING'`,
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
  'Use monos open_workspace with resource_id only when repository work is needed. Work freely within that managed workspace; preserve previous private work and fixed Git ancestry. Do not create your own repository as a substitute for managed work.',
  'Optional durable outputs use monos publish_artifact with artifact_id, title, content:{text,media_type}, optional references:[{url,label?}] and supersedes. UTF-8 text is limited to 256 KiB. Artifact publication is not completion. Read exact Task content with monos read_artifact {artifact_id}. HTML is managed data.',
  'Finish with monos complete_node {summary,artifact_ids?,handled_guidance_ids?}. Explicitly declare every required_guidance_id you have handled; absence declares none and rejects missing required handling. If blocked, use block_node with the precise reason. Guidance launch is not proof of handling. Omitted artifact_ids selects outputs from this Attempt; [] selects none; explicit IDs select same Node/activation outputs. No Artifact or repository is mandatory. If a previous Attempt left a private workspace checkpoint, reopen and finalize it before completion. Complete closes mutation authority and the system stops the process and finalizes Git; prose/process exit never completes.',
  'If external input prevents this valid Node from continuing, call monos block_node {reason}. This records a precise Owner-answerable blocker and closes this Attempt. Never fabricate Runtime failure.',
  'Use monos COMMAND --request-id ID --input payload.json --output json (or --input -); monos command-status --request-id ID --output json; monos retry --request-id ID --output json. On uncertainty recover the same request, never substitute a new lifecycle command.',
].join('\n');
export async function prepareNodeSource(
  tx: Transaction,
  task: NodeTask,
  node: ExecutionNode,
  configurationVersion: number,
  options: { request_id?: string; recovery?: object } = {}
): Promise<NodeSource> {
  await assertSpecificationUnfrozen(tx,task.id);
  await assertNoReplan(tx,task.id);
  const id = randomUUID(),
    attemptId = randomUUID();
  const definition = (
    await tx.query<{ definition: { role_id: string } }>(
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
  const count = Number(
    (await tx.query<{ count: string }>('SELECT count(*) FROM plan_nodes WHERE plan_id=$1', [task.plan_id])).rows[0]!
      .count
  );
  let failure: string | null = count !== 1 ? 'unsupported_multi_node_plan' : null;
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
      context = {
        protocol,
        guidance,
        binding,
        specification,
        node: definition,
        role,
        project,
        workspace_reservations: {
          project_id: task.project_id,
          configuration_version: configurationVersion,
          resources: (project.resources as { resource_id: string }[]).map((r) => ({
            resource_id: r.resource_id,
            workspace_id: workspaceId(task.id, r.resource_id),
          })),
        },
        issue_answers: answers,
        artifact_history: {
          validity: 'Historical output candidates only; publication does not establish successful current completion.',
          items: artifacts,
        },
        replan_history:(await tx.query("SELECT p.id publication_id,a.node_id origin_node_id,a.node_activation origin_activation,a.disposition,c.result historical_result,COALESCE((SELECT jsonb_agg(descriptor ORDER BY id) FROM replan_workspace_transfers w WHERE w.publication_id=p.id AND w.target_node_id=$2),'[]'::jsonb) workspace_dispositions FROM replan_publications p JOIN replan_node_applicability a ON a.publication_id=p.id LEFT JOIN node_completions c ON c.node_id=a.node_id AND c.activation=a.node_activation WHERE p.new_plan_id=$1 AND a.target_node_id=$2 AND a.target_node_activation=$3",[task.plan_id,node.id,node.activation])).rows.map(r=>({...r,origin_activation:Number(r.origin_activation),validity:'Historical input only; never completion of the new activation'})),
        recovery: options.recovery ?? {},
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
      options.recovery ?? {},
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
  if (failure) await blockNodeSource(tx, source, 'factual', failure);
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
  await tx.query("UPDATE tasks SET state='BLOCKED' WHERE id=$1 AND state='RUNNING'", [source.task_id]);
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
