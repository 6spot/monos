import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError, guardNewCommand } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, EffectResult, InspectionDescriptor, OperationResult, WorkspaceMetadata, WorkspaceResource } from '../../../packages/protocol/src/index.ts';
import type { AttemptRow, OperationRow } from './service.ts';
import { projectBinding, readDiscussionControl } from './discussion-state.ts';
import { assertPlanningSource } from './task-planning-state.ts';
import { assertConversationSource, conversationTask } from './task-conversation-state.ts';
import { assertReplanSource } from './task-replan-state.ts';
import { assertReviewSource } from './task-review-sources.ts';
import { resolveCanonicalResult } from './task-result-reads.ts';
import { resourceSnapshot } from './workspaces.ts';

type PlannerSource = InspectionDescriptor['planner_source'];
export interface InspectionOperation {
  id: string; attempt_id: string; kind: string; state: string; request_id: string;
  inspection_descriptor: InspectionDescriptor | null; inspection_digest: string | null;
  result: EffectResult | null;
}
interface ResourceRow { id: string; repository_identity: string; remote_url: string; settings: Record<string, unknown> }
interface InspectionWorkspace {
  id: string; task_id: string; project_id: string; resource_id: string; runner_id: string;
  resource: WorkspaceResource; storage_id: string; base_commit: string; finalized_commit: string;
  repository_identity: string; target_branch: string; materialized_by_operation_id: string;
}

// The caller already holds configuration -> Runner -> Todo/Task -> Attempt.
// This helper only reads source authority; inspection never advances that source.
async function plannerScope(tx: Transaction, attempt: AttemptRow, command: CommandEnvelope, connectionAvailable: boolean) {
  const launch = validate<AttemptRow['launch']>('Dispatch', attempt.launch);
  if (command.name !== 'inspect_repository' || attempt.kind !== 'planner' || launch.kind !== 'planner'
    || launch.attempt_id !== attempt.id || launch.dispatch_id !== attempt.dispatch_id || launch.runner_id !== attempt.runner_id)
    throw new CommandError('denied_scope', 'Inspection requires the exact Planner dispatch');
  const base = { kind: attempt.kind, mutationAllowed: attempt.mutation_allowed, processReleased: attempt.process_released,
    connectionAvailable, sourceWatermark: launch.source_watermark };
  let source: PlannerSource, projectId: string | null;
  if (attempt.todo_id) {
    const control = await readDiscussionControl(tx, attempt.todo_id), context = attempt.discussion_context;
    guardNewCommand(command, { ...base, scopeId: attempt.todo_id, scopeKind: 'todo', controlVersion: Number(control.version) });
    const intent = (await tx.query<{ id: string }>(`SELECT id FROM todo_discussion_outbox WHERE todo_id=$1 AND planned_attempt_id=$2
      AND source_message_id=$3 AND expected_version=$4`, [attempt.todo_id, attempt.id, control.source_message_id, control.version])).rows[0];
    if (!context || !intent || control.desired_attempt_id !== attempt.id || context.source_message_id !== control.source_message_id
      || launch.source_message_id !== context.source_message_id || launch.source_watermark !== context.source_watermark
      || context.discussion_version !== Number(control.version) || launch.prompt !== context.prompt)
      throw new CommandError('stale_execution', 'Todo inspection source was replaced');
    if (!control.project_id || !context.project_id) throw new CommandError('denied_scope', 'Inspection requires a Project');
    const binding = await projectBinding(tx, control);
    if (control.project_id !== context.project_id || binding.project_context_version !== context.project_context_version
      || binding.project_context_digest !== context.project_context_digest)
      throw new CommandError('version_conflict', 'Todo inspection Project context changed');
    projectId = control.project_id;
    source = { kind: 'todo_discussion', source_id: context.source_message_id, control_version: Number(control.version),
      source_watermark: launch.source_watermark, context_digest: digest(context.prompt) };
  } else {
    if (!attempt.task_id || launch.task_id !== attempt.task_id) throw new CommandError('denied_scope', 'Inspection Task scope is missing');
    const task = await conversationTask(tx, attempt.task_id);
    projectId = task.project_id;
    if (launch.task_conversation_source) {
      guardNewCommand(command, { ...base, taskId: task.id, taskConversation: true, controlVersion: Number(task.conversation_version) });
      const current = await assertConversationSource(tx, task.id, launch.task_conversation_source, attempt.id, launch.prompt);
      if (Number(current.source_watermark) !== launch.source_watermark) throw new CommandError('stale_execution', 'Conversation inspection watermark differs from its source');
      source = { kind: 'task_conversation', source_id: current.id, control_version: Number(current.expected_version),
        source_watermark: launch.source_watermark, context_digest: current.context_digest };
    } else if (launch.task_review_source) {
      guardNewCommand(command, { ...base, taskId: task.id, taskReview: true, controlVersion: Number(task.control_version) });
      const current = await assertReviewSource(tx, task.id, launch.task_review_source, attempt.id, launch.prompt);
      source = { kind: 'task_review', source_id: current.id, control_version: launch.task_review_source.control_version,
        source_watermark: launch.source_watermark, context_digest: current.context_digest };
    } else if (launch.task_replan_source) {
      guardNewCommand(command, { ...base, taskId: task.id, taskReplan: true, controlVersion: Number(task.control_version) });
      const current = await assertReplanSource(tx, task.id, launch.task_replan_source, attempt.id, launch.prompt);
      source = { kind: 'task_replan', source_id: current.id, control_version: Number(current.expected_version),
        source_watermark: launch.source_watermark, context_digest: current.context_digest };
    } else if (launch.task_planning_source) {
      guardNewCommand(command, { ...base, taskId: task.id, initialPlanning: true, projectResources: true, controlVersion: Number(task.control_version) });
      const current = await assertPlanningSource(tx, task.id, launch.task_planning_source, attempt.id, launch.prompt);
      source = { kind: 'task_initial_planning', source_id: current.id, control_version: Number(current.expected_version),
        source_watermark: launch.source_watermark, context_digest: current.context_digest };
    } else throw new CommandError('denied_scope', 'Inspection requires a canonical Planner source');
  }
  if (source.control_version !== launch.control_version || !attempt.todo_id && !launch.task_conversation_source && launch.source_watermark !== 0)
    throw new CommandError('stale_execution', 'Inspection launch differs from its source version');
  if (!projectId) throw new CommandError('denied_scope', 'Inspection requires a Project');
  return { projectId, source };
}

async function currentResource(tx: Transaction, projectId: string, resourceId: string): Promise<ResourceRow> {
  const row = (await tx.query<ResourceRow>(`SELECT id,repository_identity,remote_url,settings FROM project_resources
    WHERE id=$1 AND project_id=$2 AND active`, [resourceId, projectId])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Repository is not active in this Project');
  return row;
}

async function inspectionOrigin(tx: Transaction, attempt: AttemptRow, resource: ResourceRow): Promise<{ resource: WorkspaceResource; origin: InspectionDescriptor['origin'] }> {
  const workspace = attempt.task_id ? (await tx.query<InspectionWorkspace>(`SELECT * FROM task_workspaces
    WHERE task_id=$1 AND resource_id=$2 AND ever_materialized FOR UPDATE`, [attempt.task_id, resource.id])).rows[0] : undefined;
  if (!workspace) return { resource: resourceSnapshot(resource), origin: { kind: 'default_ref' } };
  if (workspace.runner_id !== attempt.runner_id || workspace.repository_identity !== resource.repository_identity)
    throw new CommandError('unmet_precondition', 'Finalized Task repository belongs to another host or repository');
  const completed = (await tx.query<{ id: string }>(`SELECT o.id FROM operations o JOIN node_completions c ON c.operation_id=o.id
    JOIN LATERAL operation_workspace_results(o.id) member ON member.workspace_id=$1
    WHERE o.kind='complete_node' AND o.state='succeeded' AND o.result->>'completion_outcome'='finalized'
      AND member.result->>'git_commit'=$2 ORDER BY o.created_at DESC,o.id DESC LIMIT 1`, [workspace.id, workspace.finalized_commit])).rows[0];
  if (completed) {
    const { identity } = await resolveCanonicalResult(tx, attempt.task_id!, completed.id, resource.id);
    if (!identity || identity.workspace_id !== workspace.id || identity.runner_id !== attempt.runner_id || identity.git_commit !== workspace.finalized_commit)
      throw new CommandError('unmet_precondition', 'Finalized Task revision lacks exact completion evidence');
    return { resource: workspace.resource, origin: { kind: 'task_completion', identity, identity_digest: digest(canonicalJSON(identity)) } };
  }
  const open = (await tx.query<OperationRow>("SELECT * FROM operations WHERE id=$1 AND kind='open_workspace' AND state='succeeded'", [workspace.materialized_by_operation_id])).rows[0];
  const descriptor = open?.workspace_descriptor, metadata = open?.result?.workspace_metadata;
  if (!open || !descriptor || !metadata || descriptor.workspace_id !== workspace.id || descriptor.basis
    || descriptor.task_id !== attempt.task_id || descriptor.runner_id !== attempt.runner_id || descriptor.resource_id !== resource.id
    || open.workspace_digest !== digest(canonicalJSON(descriptor)) || open.result?.workspace_id !== workspace.id
    || metadata.checkpoint || metadata.storage_id !== workspace.storage_id || metadata.repository_identity !== workspace.repository_identity
    || metadata.lease_id !== descriptor.lease_id || metadata.generation !== descriptor.generation
    || metadata.base_commit !== workspace.base_commit || metadata.finalized_commit !== workspace.base_commit
    || workspace.finalized_commit !== workspace.base_commit)
    throw new CommandError('unmet_precondition', 'Finalized Task base lacks exact initial open evidence');
  return { resource: workspace.resource, origin: { kind: 'task_open', operation_id: open.id,
    workspace: descriptor, workspace_digest: open.workspace_digest!, metadata: validate<WorkspaceMetadata>('WorkspaceMetadata', metadata) } };
}

export async function admitRepositoryInspection(tx: Transaction, attempt: AttemptRow, command: CommandEnvelope, connectionAvailable: boolean): Promise<string> {
  const { projectId, source } = await plannerScope(tx, attempt, command, connectionAvailable);
  const resource = await currentResource(tx, projectId, command.payload.resource_id!);
  const selected = await inspectionOrigin(tx, attempt, resource), id = randomUUID();
  const descriptor = validate<InspectionDescriptor>('InspectionDescriptor', { schema_version: 1, inspection_id: id,
    attempt_id: attempt.id, dispatch_id: attempt.dispatch_id, scope_kind: attempt.todo_id ? 'todo' : 'task',
    scope_id: command.scope_id, project_id: projectId, runner_id: attempt.runner_id, planner_source: source, ...selected });
  await tx.query(`INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state,resource_id,inspection_descriptor,inspection_digest)
    VALUES($1,$2,1,'inspect_repository',$3,'admitted',$4,$5,$6)`, [id, attempt.id, command.request_id, resource.id, descriptor, digest(canonicalJSON(descriptor))]);
  await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [randomUUID(), attempt.runner_id, attempt.id, id]);
  return id;
}

function operationDescriptor(attempt: AttemptRow, operation: InspectionOperation, expectedDigest?: string): InspectionDescriptor {
  const descriptor = operation.inspection_descriptor;
  if (operation.kind !== 'inspect_repository' || !descriptor || operation.attempt_id !== attempt.id
    || descriptor.inspection_id !== operation.id || descriptor.attempt_id !== attempt.id || descriptor.dispatch_id !== attempt.dispatch_id
    || descriptor.scope_id !== (attempt.todo_id ?? attempt.task_id) || descriptor.scope_kind !== (attempt.todo_id ? 'todo' : 'task')
    || descriptor.runner_id !== attempt.runner_id || operation.inspection_digest !== digest(canonicalJSON(descriptor))
    || expectedDigest !== undefined && expectedDigest !== operation.inspection_digest)
    throw new CommandError('denied_scope', 'Inspection operation identity differs');
  return validate<InspectionDescriptor>('InspectionDescriptor', descriptor);
}

// Invoked before and after provider I/O. A frozen request is not fresh access authority.
export async function assertInspectionAccess(tx: Transaction, attempt: AttemptRow, operation: InspectionOperation, expectedDigest: string): Promise<void> {
  const descriptor = operationDescriptor(attempt, operation, expectedDigest);
  if (!['admitted', 'recovery'].includes(operation.state) || descriptor.origin.kind !== 'default_ref')
    throw new CommandError('denied_scope', 'Inspection does not need remote repository access');
  const current = await plannerScope(tx, attempt, { schema_version: 1, name: 'inspect_repository', scope_id: descriptor.scope_id,
    request_id: operation.request_id, expected_control_version: descriptor.planner_source.control_version,
    payload: { resource_id: descriptor.resource.resource_id } }, true);
  const resource = await currentResource(tx, current.projectId, descriptor.resource.resource_id);
  if (current.projectId !== descriptor.project_id || canonicalJSON(current.source) !== canonicalJSON(descriptor.planner_source)
    || canonicalJSON(resourceSnapshot(resource)) !== canonicalJSON(descriptor.resource))
    throw new CommandError('stale_execution', 'Inspection source or repository configuration changed');
}

export async function settleRepositoryInspection(tx: Transaction, attempt: AttemptRow, operation: InspectionOperation, message: OperationResult): Promise<void> {
  const descriptor = operationDescriptor(attempt, operation);
  if (message.operation_id !== operation.id || message.attempt_id !== attempt.id || message.cancelled_by_operation_id || message.completion_settlement)
    throw new CommandError('denied_scope', 'Inspection result belongs to another operation');
  if (operation.state === 'succeeded') {
    if (!message.success || canonicalJSON(message.result) !== canonicalJSON(operation.result))
      throw new CommandError('payload_conflict', 'Settled inspection result cannot change');
    return;
  }
  if (!['admitted', 'recovery'].includes(operation.state)) throw new CommandError('denied_scope', 'Inspection operation is not pending');
  if (!message.success) {
    if (Object.keys(message.result).some(key => key !== 'message') || message.failure_kind && message.failure_kind !== 'recoverable')
      throw new CommandError('denied_scope', 'Inspection failure cannot assert execution or workspace facts');
    await tx.query("UPDATE operations SET state='recovery',result=$2 WHERE id=$1", [operation.id, message.result]);
    return;
  }
  const result = message.result.inspection;
  if (!result || Object.keys(message.result).length !== 1 || result.inspection_id !== operation.id || result.descriptor_digest !== operation.inspection_digest)
    throw new CommandError('denied_scope', 'Inspection result lacks its exact descriptor identity');
  validate('InspectionResult', result);
  if (result.status === 'available') {
    const snapshot = result.snapshot!, origin = descriptor.origin;
    if (snapshot.snapshot_id !== descriptor.inspection_id || snapshot.repository_identity !== descriptor.resource.repository_identity
      || origin.kind === 'task_completion' && (snapshot.storage_id !== origin.identity!.storage_id || snapshot.commit !== origin.identity!.git_commit || snapshot.tree !== origin.identity!.git_tree)
      || origin.kind === 'task_open' && (snapshot.storage_id !== origin.metadata!.storage_id || snapshot.commit !== origin.metadata!.base_commit))
      throw new CommandError('denied_scope', 'Inspection snapshot differs from its frozen finalized revision');
  }
  await tx.query("UPDATE operations SET state='succeeded',result=$2,failure_kind=NULL WHERE id=$1", [operation.id, message.result]);
  await tx.query('UPDATE outbox SET done=true WHERE operation_id=$1', [operation.id]);
}
