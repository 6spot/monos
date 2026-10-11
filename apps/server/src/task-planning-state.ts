import { repositoryInspectionInstructions } from './repository-inspection-instructions.ts';
import { assertNodeConsumes } from './node-consumes.ts';
import { assertSpecificationUnfrozen } from './task-specification-state.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, EffectResult, ExecutionPlanNode, TaskPlanningSource } from '../../../packages/protocol/src/index.ts';
import { publishInitialPlan, validatePlan } from './task-records.ts';
import { admitWorkspaceEffect } from './workspaces.ts';
import type { WorkspaceAttempt } from './workspaces.ts';
import type { RuntimePredecessor, RuntimeFallbackInspection, RuntimeFallbackPreparation } from './runtime-continuation-state.ts';
import { specificationFrozen } from './task-specification-state.ts';

export interface PlanningTask {
  id: string; project_id: string | null; state: string; specification_id: string; plan_id: string | null;
  control_version: string; initial_planning_intent_id: string | null; planning_issue_sequence: string | null;
}
export interface PlanningIntent {
  id: string; task_id: string; specification_id: string; planned_attempt_id: string; expected_version: string;
  context_digest: string; prompt: string | null; done: boolean; preparation_failure: string | null; waiting_reason: string | null;
}
export interface PlanningAttempt extends WorkspaceAttempt {
  kind: 'planner' | 'node'; planning_intent_id: string | null; specification_id: string | null; plan_id: string | null;
  state: string; process_absent: boolean; recovery_consumed_by: string | null; end_reason: string | null; fencing_generation: string;
}

export async function planningTask(tx: Transaction, taskId: string, read = false): Promise<PlanningTask> {
  const task = (await tx.query<PlanningTask>(`SELECT * FROM tasks WHERE id=$1 FOR ${read ? 'SHARE' : 'UPDATE'}`, [taskId])).rows[0];
  if (!task) throw new CommandError('denied_scope', 'Unknown Task');
  return task;
}
export async function planningEvent(tx: Transaction, taskId: string, kind: string, body: object, attemptId?: string, operationId?: string): Promise<number> {
  const sequence = Number((await tx.query<{ event_sequence: string }>('UPDATE tasks SET event_sequence=event_sequence+1 WHERE id=$1 RETURNING event_sequence', [taskId])).rows[0]!.event_sequence);
  const provenance = body as { planning_intent_id?: string; issue_sequence?: number };
  await tx.query('INSERT INTO task_events(task_id,sequence,kind,body,attempt_id,operation_id,planning_intent_id,planning_issue_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [taskId, sequence, kind, body, attemptId ?? null, operationId ?? null, provenance.planning_intent_id ?? null, provenance.issue_sequence ?? null]);
  return sequence;
}
export function planningText(value: string): void {
  validate('PlanningText', value); canonicalJSON(value);
  if (Buffer.byteLength(value) > 262144) throw new CommandError('invalid_input', 'Planning text exceeds 256 KiB');
}
export async function startEligibility(tx: Transaction, task: PlanningTask): Promise<boolean> {
  return !!task.project_id && !!(await tx.query(`SELECT 1 FROM projects p WHERE p.id=$1 AND NOT p.archived
    AND EXISTS(SELECT 1 FROM project_roles pr JOIN roles r ON r.id=pr.role_id WHERE pr.project_id=p.id AND NOT r.archived)`, [task.project_id])).rowCount;
}

const protocol = [
  repositoryInspectionInstructions,
  'You are the initial Execution Task Planner. Only monos Tool Protocol commands commit formal state. Plan for the effective Specification using the selected Role descriptors. This is an independent Task: no Todo history, prior Task or Runtime session defines its requirements. Repository snapshots provide code facts, not authority to change the Specification.',
  'Normal completion MUST call monos publish_execution_plan with planning_intent_id, a fresh plan_id, and a complete acyclic graph of 1..256 nodes containing node_id, role_id, goal and dependencies. Every dependency names another Node in this graph. Use the smallest sufficient graph; the program schedules dependency-ready Nodes and chooses concurrency and workspace isolation. Optional hard_requirements and expected_outputs are exact nonblank string arrays. Do not include Role instructions, Runtime/model, paths or repository bindings. Optional consumes lists already published Artifact IDs from this Task as explicit initial context, including clearly historical outputs; it never creates a dependency or validates current work. Future outputs belong in dependencies and expected_outputs, not invented Artifact IDs.',
  'If the Specification is insufficient, contradictory, or cannot be represented by the supported plan, call monos raise_planning_issue with the exact planning_intent_id and a clear reason. Answers below guide planning under the Specification; they cannot silently revise it. Do not use commit_task_turn. Do not execute Nodes from this planning phase.',
  'The server ends this Attempt after either committed outcome. Structural validation can be corrected within this same Attempt. On an uncertain response query or retry the exact same request ID. Natural-language output is provisional. CLI usage: monos COMMAND --request-id ID --input payload.json --output json (or --input - for stdin); monos command-status --request-id ID --output json; monos retry --request-id ID --output json.',
].join('\n');

export async function createPlanningIntent(tx: Transaction, task: PlanningTask, requestId: string | { runtime_predecessor_attempt_id: string }, configurationVersion: number, changeId?: string): Promise<PlanningIntent> {
  await assertSpecificationUnfrozen(tx,task.id);
  const id = randomUUID(); const attemptId = randomUUID(); const version = Number(task.control_version) + 1;
  const basis = { planning_intent_id: id, task_id: task.id, specification_id: task.specification_id, configuration_version: configurationVersion };
  // Account for all applicable answers before reading them. Budget failure is an
  // immutable prepared source, not permission for the pump to clip or rebuild it.
  const answerBytes = Number((await tx.query<{ size: string }>(`SELECT COALESCE(sum(octet_length(body::text)),0) AS size FROM task_events
    WHERE task_id=$1 AND kind='planning_retried' AND body->>'specification_id'=$2 AND body ? 'answer'`, [task.id, task.specification_id])).rows[0]!.size);
  let context: object | null = null; let prompt: string | null = null;
  if (answerBytes <= MAX_ITEM_BYTES) {
    const specification = (await tx.query<{ content: unknown }>('SELECT content FROM specification_revisions WHERE task_id=$1 AND id=$2', [task.id, task.specification_id])).rows[0]!.content;
    const project = (await tx.query<{ id: string; name: string; context: string; resources: unknown[] }>(`SELECT p.id,p.name,p.context,
      COALESCE((SELECT jsonb_agg(settings ORDER BY id) FROM project_resources WHERE project_id=p.id AND active),'[]'::jsonb) AS resources FROM projects p WHERE id=$1`, [task.project_id])).rows[0];
    if (!project) throw new CommandError('unmet_precondition', 'Task Project is unavailable');
    const roles = (await tx.query<{ id: string; name: string; description: string }>('SELECT r.id,r.name,r.description FROM project_roles pr JOIN roles r ON r.id=pr.role_id WHERE pr.project_id=$1 AND NOT r.archived ORDER BY r.id', [task.project_id])).rows;
    const guidance = (await tx.query<{ planner_guidance: string }>('SELECT planner_guidance FROM execution_policies')).rows[0]!.planner_guidance;
    const decisions = (await tx.query<{ sequence: string; body: object }>(`SELECT sequence,body FROM task_events WHERE task_id=$1
      AND kind='planning_retried' AND body->>'specification_id'=$2 AND body ? 'answer' ORDER BY sequence`, [task.id, task.specification_id])).rows.map((row) => ({ sequence: Number(row.sequence), ...row.body }));
    const taskGuidance=(await tx.query("SELECT id,text FROM task_guidance WHERE task_id=$1 AND status='active' ORDER BY id LIMIT 257",[task.id])).rows;
    context = { protocol, binding: basis, owner_planner_guidance: guidance, specification, project, roles, issue_answers: decisions, task_guidance:taskGuidance };
    if(taskGuidance.length>256)context=null;
    prompt = context===null?null:canonicalJSON(context);
    // Worst-case encoded Dispatch envelope is larger than the raw prompt.
    if (prompt===null || Array.from(prompt).length > 262144 || Buffer.byteLength(JSON.stringify({ prompt })) > MAX_ITEM_BYTES - 16384) { context = null; prompt = null; }
  }
  const failure = prompt === null ? 'context_budget_exceeded' : null;
  const hash = digest(prompt ?? canonicalJSON({ ...basis, preparation_failure: failure }));
  await tx.query(`INSERT INTO task_planning_outbox(id,task_id,previous_intent_id,owner_request_id,specification_id,expected_version,
    planned_attempt_id,configuration_version,context,prompt,context_digest,preparation_failure,waiting_reason,requirement_change_id,runtime_predecessor_attempt_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14)`, [id, task.id, task.initial_planning_intent_id, !changeId && typeof requestId === 'string' ? requestId : null, task.specification_id, version, attemptId, configurationVersion, context, prompt, hash, failure, changeId ?? null, typeof requestId === 'string' ? null : requestId.runtime_predecessor_attempt_id]);
  await tx.query("UPDATE tasks SET state='RUNNING',control_version=$2,initial_planning_intent_id=$3,planning_issue_sequence=NULL WHERE id=$1", [task.id, version, id]);
  return { id, task_id: task.id, specification_id: task.specification_id, expected_version: String(version), planned_attempt_id: attemptId, context_digest: hash, prompt, preparation_failure: failure, waiting_reason: failure, done: false };
}

export async function inspectPlanningRuntimeFallback(tx: Transaction, predecessor: RuntimePredecessor): Promise<RuntimeFallbackInspection> {
  const binding = predecessor.launch.task_planning_source;
  if (!binding || !predecessor.task_id) return { status: 'superseded', reason: 'planning_source_missing' };
  const current = (await tx.query(`SELECT 1 FROM task_planning_outbox s JOIN tasks t ON t.id=s.task_id
    WHERE s.id=$1 AND s.planned_attempt_id=$2 AND t.id=$3 AND t.initial_planning_intent_id=s.id
    AND t.state='RUNNING' AND t.plan_id IS NULL AND t.planning_issue_sequence IS NULL
    AND t.specification_id=s.specification_id AND t.control_version=s.expected_version
    AND s.context_digest=$4 AND s.preparation_failure IS NULL`, [binding.intent_id, predecessor.id, predecessor.task_id, binding.context_digest])).rowCount;
  if (!current) return { status: 'superseded', reason: 'planning_source_changed' };
  if (await specificationFrozen(tx, predecessor.task_id)) return { status: 'waiting', reason: 'specification_settling' };
  return { status: 'ready' };
}

export async function preparePlanningRuntimeFallback(tx: Transaction, predecessor: RuntimePredecessor, configurationVersion: number): Promise<RuntimeFallbackPreparation> {
  const inspected = await inspectPlanningRuntimeFallback(tx, predecessor);
  if (inspected.status !== 'ready') return inspected;
  const task = await planningTask(tx, predecessor.task_id!);
  await tx.query('UPDATE task_planning_outbox SET done=true WHERE id=$1', [task.initial_planning_intent_id]);
  const source = await createPlanningIntent(tx, task, { runtime_predecessor_attempt_id: predecessor.id }, configurationVersion);
  return { status: 'prepared', source_id: source.id, planned_attempt_id: source.planned_attempt_id,
    ...(source.preparation_failure ? { preparation_failure: source.preparation_failure } : {}) };
}

export async function exhaustPlanningRuntimeFallback(tx: Transaction, plannedAttemptId: string, reason: string): Promise<boolean> {
  const changed = await tx.query(`UPDATE task_planning_outbox s SET done=true,waiting_reason=$2
    FROM tasks t WHERE s.planned_attempt_id=$1 AND t.id=s.task_id AND t.initial_planning_intent_id=s.id
    AND t.state='RUNNING' AND t.plan_id IS NULL AND t.planning_issue_sequence IS NULL
    AND t.specification_id=s.specification_id AND t.control_version=s.expected_version`, [plannedAttemptId, reason]);
  return !!changed.rowCount;
}

export function planningSource(intent: PlanningIntent): TaskPlanningSource {
  return { intent_id: intent.id, specification_id: intent.specification_id, context_digest: intent.context_digest };
}
// Caller holds configuration/Runner/Task locks as applicable before this source
// guard. `done` only means selection was consumed; it is not semantic resolution.
export async function assertPlanningSource(tx: Transaction, taskId: string, source: TaskPlanningSource, attemptId: string, prompt?: string): Promise<PlanningIntent> {
  await assertSpecificationUnfrozen(tx,taskId);
  const row = (await tx.query<PlanningIntent>(`SELECT p.* FROM task_planning_outbox p JOIN tasks t ON t.id=p.task_id
    WHERE p.id=$1 AND p.task_id=$2 AND t.initial_planning_intent_id=p.id AND t.state='RUNNING' AND t.plan_id IS NULL
      AND t.specification_id=p.specification_id AND t.control_version=p.expected_version AND p.planned_attempt_id=$3`, [source.intent_id, taskId, attemptId])).rows[0];
  if (!row || row.preparation_failure || row.specification_id !== source.specification_id || row.context_digest !== source.context_digest || (prompt !== undefined && row.prompt !== prompt)) throw new CommandError('stale_execution', 'Initial planning source or revision is no longer current');
  return row;
}

export async function stopPlanningAttempt(tx: Transaction, attempt: PlanningAttempt, requestId: string): Promise<string | undefined> {
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  if (attempt.state === 'QUEUED') {
    await tx.query("UPDATE attempts SET state='CANCELLED',mutation_allowed=false,process_absent=true,end_reason='owner_stopped' WHERE id=$1", [attempt.id]);
    return undefined;
  }
  const prior = (await tx.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1", [attempt.id])).rows[0];
  if (prior) return prior.id;
  return attempt.process_released ? undefined : admitWorkspaceEffect(tx, attempt, 'stop', requestId);
}

export async function handlePlanningCommand(tx: Transaction, attempt: PlanningAttempt, command: CommandEnvelope): Promise<{ result: EffectResult; operation_id: string }> {
  const source = attempt.launch.task_planning_source;
  if (!source || attempt.kind !== 'planner' || !attempt.task_id || attempt.planning_intent_id !== source.intent_id || attempt.specification_id !== source.specification_id || attempt.plan_id !== null) throw new CommandError('denied_scope', 'Command requires a source-bound initial Task Planner');
  const intent = await assertPlanningSource(tx, attempt.task_id, source, attempt.id, attempt.launch.prompt);
  if (command.payload.planning_intent_id !== intent.id) throw new CommandError('stale_execution', 'Command targets another planning source');
  if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Earlier effects must settle before the planning outcome');
  let result: EffectResult;
  if (command.name === 'publish_execution_plan') {
    const nodes = command.payload.nodes as ExecutionPlanNode[];
    validatePlan(nodes);
    await assertNodeConsumes(tx, attempt.task_id, nodes);
    const roleIds = [...new Set(nodes.map(node => node.role_id))];
    const roles = (await tx.query(`SELECT r.id FROM project_roles pr JOIN roles r ON r.id=pr.role_id JOIN tasks t ON t.project_id=pr.project_id
      WHERE t.id=$1 AND r.id=ANY($2::text[]) AND NOT r.archived`, [attempt.task_id, roleIds])).rowCount;
    if (roles !== roleIds.length) throw new CommandError('unmet_precondition', 'Every Plan Role must be selected and available');
    try {
      await publishInitialPlan(tx, { task_id: attempt.task_id, plan_id: command.payload.plan_id!, nodes,
        expected: { control_version: command.expected_control_version, specification_id: intent.specification_id, plan_id: null },
        claim: { attempt_id: attempt.id, fencing_generation: Number(attempt.fencing_generation) } });
    } catch (error) {
      // Caller-supplied IDs are global immutable identities. A competing Task may
      // commit one after a precheck; roll back this whole outcome and let this
      // still-authorized Planner correct its IDs with a new command request.
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505' && 'constraint' in error
        && ['plan_revisions_pkey', 'nodes_pkey'].includes(String(error.constraint))) throw new CommandError('payload_conflict', 'Plan or Node identity already exists; choose fresh IDs');
      throw error;
    }
    result = { planning_outcome: { kind: 'plan', planning_intent_id: intent.id, plan_id: command.payload.plan_id! } };
  } else if (command.name === 'raise_planning_issue') {
    planningText(command.payload.reason!);
    const sequence = await planningEvent(tx, attempt.task_id, 'planning_issue_raised', { planning_intent_id: intent.id, specification_id: intent.specification_id, reason: command.payload.reason! }, attempt.id);
    await tx.query('UPDATE tasks SET planning_issue_sequence=$2,control_version=control_version+1 WHERE id=$1', [attempt.task_id, sequence]);
    result = { planning_outcome: { kind: 'issue', planning_intent_id: intent.id, issue_sequence: sequence } };
  } else throw new CommandError('denied_scope', 'Initial Planner requires publish_execution_plan or raise_planning_issue');
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='SUCCEEDED' WHERE id=$1", [attempt.id]);
  const operationId = await stopPlanningAttempt(tx, attempt, command.request_id);
  if (!operationId) throw new CommandError('stale_execution', 'Initial Planner physical claim is missing');
  await tx.query('UPDATE task_planning_outbox SET done=true,waiting_reason=NULL WHERE id=$1', [intent.id]);
  if (command.name === 'publish_execution_plan') await planningEvent(tx, attempt.task_id, 'plan_published', result.planning_outcome!, attempt.id, operationId);
  return { result, operation_id: operationId };
}
