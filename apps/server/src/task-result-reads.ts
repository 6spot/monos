import { transaction } from "../../../packages/db/src/index.ts";
import type { Database, Transaction } from "../../../packages/db/src/index.ts";
import { CommandError } from "../../../packages/domain/src/commands.ts";
import {
  canonicalJSON,
  digest,
  MAX_BODY_BYTES,
  validate,
} from "../../../packages/protocol/src/index.ts";
import type {
  CompletionManifest,
  EffectResult,
  WorkspaceCompletionInput,
  WorkspaceEffectResult,
  TaskLocalResult,
  TaskResultPage,
  Dispatch,
} from "../../../packages/protocol/src/index.ts";
import { completionIdentity } from "./node-execution.ts";
import type { CompletionOperation } from "./node-execution.ts";
import type { ResultReadIdentity } from "../../../packages/protocol/src/index.ts";
import { authenticateOwner } from "./owner-commands.ts";

function encode(taskId: string, after: string): string {
  return Buffer.from(
    canonicalJSON({ version: 1, kind: "task_results", task_id: taskId, after }),
  ).toString("base64url");
}
function decode(taskId: string, cursor?: string): string {
  if (!cursor) return "";
  try {
    validate("TaskListCursor", cursor);
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      value.version !== 1 ||
      value.kind !== "task_results" ||
      typeof value.after !== "string"
    )
      throw new Error();
    validate("Id", value.task_id);
    if (value.after) validate("Id", value.after);
    if (encode(value.task_id, value.after) !== cursor) throw new Error();
    if (value.task_id !== taskId)
      throw new CommandError(
        "denied_scope",
        "Result cursor belongs to another Task",
      );
    return value.after;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("invalid_input", "Invalid result cursor");
  }
}

// Only exact carry edges preserve completed evidence. Activation applicability
// alone is insufficient: refresh does not authorize an old completion manifest.
const appliesSQL = `WITH RECURSIVE edges(old_spec,old_plan,new_spec,new_plan) AS (
 SELECT a.parent_id,a.plan_id,a.specification_id,a.plan_id FROM specification_node_applicability a
 WHERE a.task_id=m.task_id AND a.node_id=m.node_id AND a.node_activation=m.node_activation AND a.disposition='carry' AND a.completion_operation_id=m.operation_id AND a.completion_manifest_digest=m.content_digest
 UNION ALL
 SELECT p.old_specification_id,p.old_plan_id,p.new_specification_id,p.new_plan_id FROM replan_node_applicability a JOIN replan_publications p ON p.id=a.publication_id
 WHERE a.task_id=m.task_id AND a.node_id=m.node_id AND a.node_activation=m.node_activation AND a.target_node_id=m.node_id AND a.target_node_activation=m.node_activation AND a.disposition='carry' AND a.completion_operation_id=m.operation_id AND a.completion_manifest_digest=m.content_digest
 ), path(spec,plan) AS (SELECT m.specification_id,m.plan_id UNION SELECT e.new_spec,e.new_plan FROM path p JOIN edges e ON e.old_spec=p.spec AND e.old_plan=p.plan)
 SELECT EXISTS(SELECT 1 FROM path WHERE spec=t.specification_id AND plan=t.plan_id)`;

interface ResultMember {
  resource_id: string;
  workspace_id: string;
  lease_id: string;
  workspace_descriptor: WorkspaceCompletionInput['workspace'];
  workspace_digest: string;
  integration: WorkspaceCompletionInput['integration'] | null;
  result: WorkspaceEffectResult;
  storage_id: string;
  base_commit: string;
  target_branch: string;
  repository_identity: string;
}
interface ResultRow {
  manifest: CompletionManifest;
  operation: CompletionOperation;
  dispatch_id: string;
  launch: Dispatch;
  result: unknown;
  members: ResultMember[];
  current: boolean;
  runner_id: string;
  created_at: Date;
  specification_id: string;
  plan_id: string | null;
}

export async function taskResults(db: Database, token: string, taskId: string, cursor?: string, operationId?: string): Promise<TaskResultPage> {
  validate('Id', taskId);
  return transaction(db, async tx => {
    await authenticateOwner(tx, token);
    if (!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rowCount)
      throw new CommandError('denied_scope', 'Unknown Task');
    return taskResultsInTransaction(tx, taskId, cursor, operationId);
  });
}

async function taskResultsInTransaction(tx: Transaction, taskId: string, cursor?: string, operationId?: string,
  captured?: Map<string, ResultReadIdentity[]>): Promise<TaskResultPage> {
  let after = decode(taskId, cursor);
  const rows = (await tx.query<ResultRow>(
    `SELECT to_jsonb(m) manifest,to_jsonb(o)||jsonb_build_object('workspaces',operation_workspace_inputs(o.id)) operation,
      a.dispatch_id,a.launch,o.result,a.runner_id,o.created_at,t.specification_id,t.plan_id,
      COALESCE((SELECT jsonb_agg(to_jsonb(member)||jsonb_build_object('storage_id',w.storage_id,'base_commit',w.base_commit,
        'target_branch',w.target_branch,'repository_identity',w.repository_identity) ORDER BY member.resource_id COLLATE "C")
        FROM operation_workspace_results(o.id) member JOIN workspace_leases l ON l.id=member.lease_id AND l.attempt_id=m.attempt_id
        JOIN task_workspaces w ON w.id=l.workspace_id AND w.task_id=m.task_id),'[]'::jsonb) members,
      (t.state<>'CANCELLED' AND n.activation=m.node_activation AND n.state='COMPLETED' AND EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id) AND (${appliesSQL})) current
    FROM completion_manifests m JOIN node_completions c ON c.operation_id=m.operation_id AND c.node_id=m.node_id AND c.activation=m.node_activation AND c.attempt_id=m.attempt_id
    JOIN operations o ON o.id=m.operation_id AND o.attempt_id=m.attempt_id AND o.kind='complete_node' AND o.state='succeeded' AND o.completion_manifest_digest=m.content_digest
    JOIN attempts a ON a.id=m.attempt_id AND a.task_id=m.task_id JOIN nodes n ON n.id=m.node_id AND n.task_id=m.task_id JOIN tasks t ON t.id=m.task_id
    WHERE m.task_id=$1 AND m.operation_id>$2 AND ($3::text IS NULL OR m.operation_id=$3) ORDER BY m.operation_id LIMIT 33`,
    [taskId, after, operationId ?? null])).rows;
  const items: TaskLocalResult[] = [];
  let bytes = 8192;
  for (const row of rows) {
    if (items.length === 32) break;
    const manifest = validate<CompletionManifest>('CompletionManifest', { ...row.manifest, node_activation: Number(row.manifest.node_activation) });
    const effect = validate<EffectResult>('EffectResult', row.result);
    if (effect.writer_absent !== true || effect.completion_outcome !== 'finalized' || !effect.workspace_results ||
      !row.operation.workspaces || row.operation.workspaces.length !== row.members.length || effect.workspace_results.length !== row.members.length)
      throw new CommandError('unmet_precondition', 'Completed result lacks exact aggregate workspace evidence');
    const identities: ResultReadIdentity[] = [];
    const gitResults: TaskLocalResult['git_results'] = row.members.map((member, index) => {
      const result = validate<WorkspaceEffectResult>('WorkspaceEffectResult', member.result);
      const metadata = result.workspace_metadata, integration = result.integration, capture = result.capture;
      const input = row.operation.workspaces![index]!;
      if (canonicalJSON(result) !== canonicalJSON(effect.workspace_results![index]) ||
          input.workspace.resource_id !== member.resource_id || input.workspace.workspace_id !== member.workspace_id ||
          canonicalJSON(input.workspace) !== canonicalJSON(member.workspace_descriptor) || input.workspace_digest !== member.workspace_digest ||
          canonicalJSON(input.integration ?? null) !== canonicalJSON(member.integration) ||
          result.resource_id !== member.resource_id || result.workspace_id !== member.workspace_id ||
          metadata.lease_id !== member.lease_id || metadata.storage_id !== member.storage_id ||
          metadata.repository_identity !== member.repository_identity || metadata.base_commit !== member.base_commit ||
          metadata.target_branch !== member.target_branch || !result.git_commit || !result.git_tree || !capture ||
          capture.start_commit !== (metadata.isolation?.start_commit ?? input.workspace.basis?.finalized_commit ?? metadata.base_commit) ||
          metadata.finalized_commit !== result.git_commit ||
          (index > 0 && row.members[index - 1]!.resource_id >= member.resource_id))
        throw new CommandError('unmet_precondition', 'Completed result lacks exact finalized workspace evidence');
      if (!!metadata.isolation !== !!integration || (integration ? integration.outcome !== 'integrated' ||
          integration.start_commit !== metadata.isolation?.start_commit || integration.start_commit !== capture.start_commit ||
          integration.node_commit !== capture.node_commit || integration.node_tree !== capture.node_tree ||
          integration.task_commit !== result.git_commit || integration.task_tree !== result.git_tree ||
          input.integration?.expected_task_commit !== integration.expected_task_commit :
          capture.node_commit !== result.git_commit || capture.node_tree !== result.git_tree))
        throw new CommandError('unmet_precondition', 'Completed result lacks exact capture and integration provenance');
      const identity = resultIdentity(row, manifest, member, result);
      identities.push(identity);
      return { workspace_id: member.workspace_id, resource_id: member.resource_id, runner_id: row.runner_id,
        git_commit: result.git_commit, git_tree: result.git_tree, metadata, capture,
        identity_digest: digest(canonicalJSON(identity)), ...(integration ? { integration } : {}) };
    });
    const item = validate<TaskLocalResult>('TaskLocalResult', {
      manifest, current: row.current, current_specification_id: row.specification_id, current_plan_id: row.plan_id,
      repository_free: gitResults.length === 0, git_results: gitResults, admitted_at: row.created_at.toISOString(),
    });
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size >= MAX_BODY_BYTES) {
      if (!items.length) throw new CommandError('unmet_precondition', 'Local result exceeds response budget');
      break;
    }
    items.push(item); captured?.set(manifest.operation_id, identities); bytes += size; after = manifest.operation_id;
  }
  return validate('TaskResultPage', { schema_version: 1, task_id: taskId, items, cursor: encode(taskId, after), has_more: rows.length > items.length });
}

export async function resolveNodeResult(tx: Transaction, taskId: string, operationId: string) {
  validate('Id', taskId); validate('Id', operationId);
  const captured = new Map<string, ResultReadIdentity[]>();
  const page = await taskResultsInTransaction(tx, taskId, undefined, operationId, captured);
  const item = page.items.find(result => result.manifest.operation_id === operationId);
  if (!item) throw new CommandError('denied_scope', 'Unknown canonical result');
  return { item, identities: captured.get(operationId)! };
}
export async function resolveCanonicalResult(tx: Transaction, taskId: string, operationId: string, resourceId: string) {
  validate('Id', resourceId);
  const { item, identities } = await resolveNodeResult(tx, taskId, operationId);
  const git = item.git_results.find(result => result.resource_id === resourceId);
  const identity = identities.find(result => result.resource_id === resourceId);
  if (!git || !identity) throw new CommandError('denied_scope', 'Selected resource has no Git result in this completion');
  return { item, git, identity };
}

function resultIdentity(row: ResultRow, m: CompletionManifest, member: ResultMember, effect: WorkspaceEffectResult): ResultReadIdentity {
  const w = member.workspace_descriptor, md = effect.workspace_metadata;
  const d = validate<Dispatch>('Dispatch', row.launch), source = d.node_execution_source;
  if (!source || d.kind !== 'node' || d.todo_id !== undefined || d.node_id !== m.node_id || d.node_activation !== m.node_activation || d.task_planning_source !== undefined || d.task_conversation_source !== undefined || d.task_replan_source !== undefined || d.task_id !== m.task_id || d.attempt_id !== m.attempt_id || d.dispatch_id !== row.dispatch_id || d.runner_id !== row.runner_id || source.node_id !== m.node_id || source.node_activation !== m.node_activation || source.specification_id !== m.specification_id || source.plan_id !== m.plan_id)
    throw new CommandError('unmet_precondition', 'Result original execution identity is inconsistent');
  if (w.task_id !== m.task_id || w.node_id !== m.node_id || w.node_activation !== m.node_activation || w.runner_id !== row.runner_id || w.lease_id !== md.lease_id || w.generation !== md.generation || w.workspace_id !== member.workspace_id || w.resource.resource_id !== member.resource_id || member.workspace_digest !== digest(canonicalJSON(w)))
    throw new CommandError('unmet_precondition', 'Result descriptor identity is inconsistent');
  return validate<ResultReadIdentity>('ResultReadIdentity', {
    task_id: m.task_id, operation_id: m.operation_id, attempt_id: m.attempt_id, dispatch_id: row.dispatch_id,
    node_id: m.node_id, node_activation: m.node_activation, specification_id: m.specification_id, plan_id: m.plan_id,
    manifest_digest: m.content_digest, operation_identity_digest: completionIdentity(row.operation, row.dispatch_id),
    workspace_id: w.workspace_id, resource_id: member.resource_id, runner_id: row.runner_id,
    generation: md.generation, storage_id: md.storage_id, lease_id: md.lease_id, repository_identity: md.repository_identity,
    base_commit: md.base_commit, git_commit: effect.git_commit, git_tree: effect.git_tree, capture: effect.capture,
    ...(effect.integration ? { integration: effect.integration } : {}),
  });
}
export async function selectedTaskResult(db: Database, token: string, taskId: string, operationId: string, resourceId: string) {
  return transaction(db, async tx => {
    await authenticateOwner(tx, token);
    if (!(await tx.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rowCount)
      throw new CommandError('denied_scope', 'Unknown Task');
    return resolveCanonicalResult(tx, taskId, operationId, resourceId);
  });
}
