import { assertSpecificationUnfrozen } from './task-specification-state.ts';
import { bindTaskGuidance } from './task-guidance.ts';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_BODY_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPlanNode } from '../../../packages/protocol/src/index.ts';
import { consumeTaskConfirmation } from './owner-commands.ts';
import { assertActiveProject, assertProjectRoles, lockConfiguration } from './configuration-guards.ts';
import { hasUnadoptedCheckpointTargets } from './task-replan-workspaces.ts';

export interface ControlBasis { control_version: number; specification_id: string; plan_id: string | null }
interface ControlRow { id: string; control_version: string; specification_id: string; plan_id: string | null; state: string; project_id: string | null }
export type PlanNode = ExecutionPlanNode;

function contentJSON(value: unknown): string {
  let json: string;
  try { json = canonicalJSON(value); } catch { throw new CommandError('invalid_input', 'Content must be canonical JSON'); }
  if (Buffer.byteLength(json) > MAX_BODY_BYTES) throw new CommandError('invalid_input', 'Content exceeds limit');
  return json;
}

async function control(tx: Transaction, taskId: string, expected?: ControlBasis): Promise<ControlRow> {
  validate('Id', taskId);
  const row = (await tx.query<ControlRow>('SELECT id,control_version,specification_id,plan_id,state,project_id FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown Task');
  if (expected && (Number(row.control_version) !== expected.control_version || row.specification_id !== expected.specification_id || row.plan_id !== expected.plan_id)) throw new CommandError('version_conflict', 'Task revision basis changed', Number(row.control_version));
  return row;
}

export function validatePlan(nodes: PlanNode[]): void {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 256) throw new CommandError('invalid_input', 'Plan requires 1..256 Nodes');
  contentJSON(nodes);
  const byId = new Map<string, PlanNode>();
  for (const node of nodes) {
    try { validate('ExecutionPlanNode', node); } catch { throw new CommandError('invalid_input', 'Invalid Node definition'); }
    if (Buffer.byteLength(node.goal) > 262144) throw new CommandError('invalid_input', 'Node goal exceeds 256 KiB');
    if (byId.has(node.node_id) || typeof node.goal !== 'string' || !node.goal.trim() || !Array.isArray(node.dependencies) || new Set(node.dependencies).size !== node.dependencies.length) throw new CommandError('invalid_input', 'Invalid or duplicate Node definition');
    byId.set(node.node_id, node);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node || visiting.has(id)) throw new CommandError('invalid_input', 'Plan has missing dependencies or a cycle');
    visiting.add(id);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

// Internal primitives: caller authenticates, checks its receipt first, and commits
// these writes with the command receipt/event/outbox. No independent HTTP access.
export async function initializeTask(tx: Transaction, input: { task_id: string; specification_id: string; specification: unknown; project_id?: string; creation?: { title: string; todo_id: string; proposal_message_id: string; confirmation_id: string } }): Promise<ControlBasis> {
  validate('Id', input.task_id); validate('Id', input.specification_id);
  const json = contentJSON(input.specification);
  if (input.project_id !== undefined) { validate('Id', input.project_id); await lockConfiguration(tx); await assertActiveProject(tx, input.project_id); }
  if (input.creation) {
    validate('TaskPreview', { title: input.creation.title, specification: input.specification, project_id: input.project_id });
    for (const id of [input.creation.todo_id, input.creation.proposal_message_id, input.creation.confirmation_id]) validate('Id', id);
    await tx.query(`INSERT INTO tasks(id,specification_id,state,project_id,title,todo_id,initial_specification_id,creation_confirmation_id,source_proposal_message_id,created_at)
      VALUES($1,$2,'PLANNING',$3,$4,$5,$2,$6,$7,clock_timestamp())`, [input.task_id, input.specification_id, input.project_id, input.creation.title, input.creation.todo_id, input.creation.confirmation_id, input.creation.proposal_message_id]);
  } else await tx.query("INSERT INTO tasks(id,specification_id,state,project_id) VALUES($1,$2,'PLANNING',$3)", [input.task_id, input.specification_id, input.project_id ?? null]);
  await tx.query('INSERT INTO specification_revisions(id,task_id,content,content_digest) VALUES($1,$2,$3,$4)', [input.specification_id, input.task_id, json, digest(json)]);
  return { control_version: 1, specification_id: input.specification_id, plan_id: null };
}

export async function publishInitialPlan(tx: Transaction, input: { task_id: string; plan_id: string; expected: ControlBasis; nodes: PlanNode[]; claim: { attempt_id: string; fencing_generation: number } }): Promise<ControlBasis> {
  await assertSpecificationUnfrozen(tx,input.task_id);
  validate('Id', input.plan_id); validatePlan(input.nodes);
  await lockConfiguration(tx);
  const identity = (await tx.query<{ runner_id: string }>('SELECT runner_id FROM attempts WHERE id=$1 AND task_id=$2', [input.claim.attempt_id, input.task_id])).rows[0];
  if (!identity) throw new CommandError('denied_scope', 'Planner claim belongs to another Task');
  await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [identity.runner_id]);
  const task = await control(tx, input.task_id, input.expected);
  const claim = (await tx.query<{ kind: string; fencing_generation: string; mutation_allowed: boolean; process_released: boolean; specification_id: string | null }>('SELECT kind,fencing_generation,mutation_allowed,process_released,specification_id FROM attempts WHERE id=$1 FOR UPDATE', [input.claim.attempt_id])).rows[0]!;
  if (claim.kind !== 'planner' || Number(claim.fencing_generation) !== input.claim.fencing_generation || !claim.mutation_allowed || claim.process_released) throw new CommandError('stale_execution', 'Planner claim is no longer current');
  if (claim.specification_id !== task.specification_id) throw new CommandError('version_conflict', 'Planner launch Specification is stale or unknown');
  if (task.state !== 'RUNNING' || task.plan_id !== null) throw new CommandError('unmet_precondition', 'Initial Plan requires a started Task with no Plan');
  if (task.project_id) await assertProjectRoles(tx, task.project_id, input.nodes.map((node) => node.role_id));
  const json = contentJSON({ node_ids: input.nodes.map((node) => node.node_id), nodes: input.nodes });
  await tx.query('INSERT INTO plan_revisions(id,task_id,content,specification_id,content_digest) VALUES($1,$2,$3,$4,$5)', [input.plan_id, input.task_id, json, task.specification_id, digest(json)]);
  for (const node of input.nodes) {
    await tx.query("INSERT INTO nodes(id,task_id,activation,state) VALUES($1,$2,1,'PENDING')", [node.node_id, input.task_id]);
    await tx.query('INSERT INTO plan_nodes(task_id,plan_id,node_id,definition) VALUES($1,$2,$3,$4)', [input.task_id, input.plan_id, node.node_id, node]);
    await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,1,$3,$4,'recorded')", [input.task_id, node.node_id, task.specification_id, input.plan_id]);
  }
  for(const node of input.nodes)await bindTaskGuidance(tx,input.task_id,node.node_id,1);
  await tx.query('UPDATE tasks SET plan_id=$2,control_version=control_version+1 WHERE id=$1', [input.task_id, input.plan_id]);
  return { control_version: Number(task.control_version) + 1, specification_id: task.specification_id, plan_id: input.plan_id };
}

export async function publishPlanningSpecification(tx: Transaction, token: string, input: { task_id: string; specification_id: string; specification: unknown; confirmation_id: string; request_id: string; expected: ControlBasis }): Promise<ControlBasis> {
  validate('Id', input.specification_id);
  if((await tx.query('SELECT 1 FROM authorization_receipts a JOIN requirement_proposals p ON p.id=a.proposal_id WHERE a.id=$1',[input.confirmation_id])).rowCount)throw new CommandError('denied_scope','Requirement authorization requires its settlement operation');
  await assertSpecificationUnfrozen(tx,input.task_id);
  const json = contentJSON(input.specification);
  // Authentication/session locking must precede the Task lock.
  await consumeTaskConfirmation(tx, token, input.confirmation_id, input.request_id, { scope_id: input.task_id, action: 'apply_specification_revision', content_digest: digest(json) });
  const task = await control(tx, input.task_id, input.expected);
  if (task.state !== 'PLANNING' || task.plan_id !== null) throw new CommandError('unmet_precondition', 'Started Task revisions require a settlement operation');
  await tx.query('INSERT INTO specification_revisions(id,task_id,parent_id,content,content_digest,authorization_id) VALUES($1,$2,$3,$4,$5,$6)', [input.specification_id, input.task_id, task.specification_id, json, digest(json), input.confirmation_id]);
  await tx.query('UPDATE tasks SET specification_id=$2,control_version=control_version+1 WHERE id=$1', [input.task_id, input.specification_id]);
  return { control_version: Number(task.control_version) + 1, specification_id: input.specification_id, plan_id: null };
}

export async function assertCurrentNode(tx: Transaction, input: { task_id: string; node_id: string; node_activation: number }): Promise<{ state: string }> {
  const row = (await tx.query<{ state: string }>(`SELECT n.state FROM nodes n
    JOIN tasks t ON t.id=n.task_id
    JOIN plan_nodes pn ON pn.plan_id=t.plan_id AND pn.node_id=n.id
    JOIN node_activations a ON a.node_id=n.id AND a.activation=n.activation
    WHERE n.id=$1 AND n.task_id=$2 AND n.activation=$3
      AND activation_applies(t.id,n.id,n.activation,t.specification_id,t.plan_id)`, [input.node_id, input.task_id, input.node_activation])).rows[0];
  if (!row) throw new CommandError('stale_execution', 'Node activation or effective revision membership is no longer current');
  return row;
}

export async function inspectNodeReactivation(tx: Transaction, taskId: string, planId: string, nodeIds: string[]): Promise<{ node_ids: string[]; settled: boolean }> {
  const members = (await tx.query<{ node_id: string; definition: { dependencies: string[] } }>('SELECT node_id,definition FROM plan_nodes WHERE plan_id=$1', [planId])).rows;
  const affected = new Set(nodeIds);
  if (!affected.size || nodeIds.some((id) => !members.some((node) => node.node_id === id))) throw new CommandError('denied_scope', 'Reactivation target is outside the Plan');
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of members) if (!affected.has(node.node_id) && node.definition.dependencies.some((id) => affected.has(id))) { affected.add(node.node_id); changed = true; }
  }
  const ids = [...affected].sort();
  const owners = await tx.query(`SELECT a.id FROM attempts a WHERE a.task_id=$1 AND a.node_id=ANY($2::text[])
    AND (a.state='QUEUED' OR NOT a.process_released OR EXISTS (SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))
    UNION ALL SELECT id FROM workspace_leases WHERE task_id=$1 AND node_id=ANY($2::text[]) AND state<>'released' LIMIT 1`, [taskId, ids]);
  return { node_ids: ids, settled: !owners.rowCount };
}

// Caller authorizes Rework and records its decision/event; this primitive only
// resets a fully settled subgraph. Live-writer settlement belongs to orchestration.
export async function reactivateSettledNodes(tx: Transaction, input: { task_id: string; expected: ControlBasis; node_ids: string[] }): Promise<string[]> {
  const task = await control(tx, input.task_id, input.expected);
  await assertSpecificationUnfrozen(tx,input.task_id);
  if (!['RUNNING', 'BLOCKED', 'REVIEW'].includes(task.state) || !task.plan_id) throw new CommandError('unmet_precondition', 'Task cannot reactivate work');
  const { node_ids: ids, settled } = await inspectNodeReactivation(tx, input.task_id, task.plan_id, input.node_ids);
  if (await hasUnadoptedCheckpointTargets(tx, input.task_id, ids))
    throw new CommandError('unmet_precondition', 'Open the approved inherited private workspace before reactivating its target');
  if (!settled) throw new CommandError('unmet_precondition', 'Old writers and admitted operations must settle before reactivation');
  for (const id of ids) {
    const node = (await tx.query<{ activation: string }>("UPDATE nodes SET activation=activation+1,state='PENDING',result=NULL,execution_source_id=NULL,blocker_id=NULL WHERE id=$1 RETURNING activation", [id])).rows[0]!;
    await tx.query("INSERT INTO node_activations(task_id,node_id,activation,specification_id,plan_id,basis_source) VALUES($1,$2,$3,$4,$5,'recorded')", [input.task_id, id, node.activation, task.specification_id, task.plan_id]);
    await tx.query("UPDATE task_guidance_obligations SET status='carried',version=version+1 WHERE node_id=$1 AND node_activation<$2 AND status='pending'",[id,node.activation]);
    await bindTaskGuidance(tx,input.task_id,id,Number(node.activation));
  }
  await tx.query("UPDATE tasks SET state='RUNNING',control_version=control_version+1 WHERE id=$1", [input.task_id]);
  return ids;
}
