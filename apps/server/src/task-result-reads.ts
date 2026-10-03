import { transaction } from "../../../packages/db/src/index.ts";
import type { Database } from "../../../packages/db/src/index.ts";
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

interface ResultRow {
  manifest: CompletionManifest;
  operation: CompletionOperation;
  dispatch_id: string;
  launch: Dispatch;
  result: unknown;
  current: boolean;
  repository_free: boolean;
  workspace_id: string | null;
  resource_id: string;
  runner_id: string;
  workspace_lease_id: string | null;
  storage_id: string | null;
  base_commit: string | null;
  target_branch: string | null;
  repository_identity: string | null;
  created_at: Date;
  specification_id: string;
  plan_id: string | null;
}

export async function taskResults(
  db: Database,
  token: string,
  taskId: string,
  cursor?: string,
  operationId?: string,
  captured?: {identity?: ResultReadIdentity},
): Promise<TaskResultPage> {
  validate("Id", taskId);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    if (
      !(await tx.query("SELECT id FROM tasks WHERE id=$1 FOR SHARE", [taskId]))
        .rowCount
    )
      throw new CommandError("denied_scope", "Unknown Task");
    let after = decode(taskId, cursor);
    const rows = (
      await tx.query<ResultRow>(
        `SELECT to_jsonb(m) manifest,to_jsonb(o) operation,a.dispatch_id,a.launch,o.result,COALESCE(o.repository_free,false) repository_free,o.resource_id,o.workspace_lease_id,a.runner_id,o.created_at,t.specification_id,t.plan_id,
      w.id workspace_id,w.storage_id,w.base_commit,w.target_branch,w.repository_identity,
      (t.state<>'CANCELLED' AND n.activation=m.node_activation AND n.state='COMPLETED' AND EXISTS(SELECT 1 FROM plan_nodes pn WHERE pn.plan_id=t.plan_id AND pn.node_id=m.node_id) AND (${appliesSQL})) current
      FROM completion_manifests m JOIN node_completions c ON c.operation_id=m.operation_id AND c.node_id=m.node_id AND c.activation=m.node_activation AND c.attempt_id=m.attempt_id
      JOIN operations o ON o.id=m.operation_id AND o.attempt_id=m.attempt_id AND o.kind='complete_node' AND o.state='succeeded' AND o.completion_manifest_digest=m.content_digest
      JOIN attempts a ON a.id=m.attempt_id AND a.task_id=m.task_id JOIN nodes n ON n.id=m.node_id AND n.task_id=m.task_id JOIN tasks t ON t.id=m.task_id
      LEFT JOIN workspace_leases l ON l.id=o.workspace_lease_id AND l.attempt_id=m.attempt_id LEFT JOIN task_workspaces w ON w.id=l.workspace_id AND w.task_id=m.task_id
      WHERE m.task_id=$1 AND m.operation_id>$2 AND ($3::text IS NULL OR m.operation_id=$3) ORDER BY m.operation_id LIMIT 33`,
        [taskId, after, operationId ?? null],
      )
    ).rows;
    const items: TaskLocalResult[] = [];
    let bytes = 8192;
    for (const row of rows) {
      if (items.length === 32) break;
      const manifest = validate<CompletionManifest>("CompletionManifest", {
        ...row.manifest,
        node_activation: Number(row.manifest.node_activation),
      });
      const effect = validate<EffectResult>("EffectResult", row.result);
      let git: TaskLocalResult["git"] = null;
      if (row.repository_free) {
        if (
          effect.git_commit ||
          effect.git_tree ||
          effect.workspace_metadata ||
          row.workspace_id ||
          row.workspace_lease_id
        )
          throw new CommandError(
            "unmet_precondition",
            "Repository-free result has conflicting workspace evidence",
          );
      } else {
        const metadata = effect.workspace_metadata;
        if (
          !row.workspace_id ||
          !metadata ||
          !effect.git_commit ||
          !effect.git_tree ||
          effect.workspace_id !== row.workspace_id ||
          metadata.lease_id !== row.workspace_lease_id ||
          metadata.storage_id !== row.storage_id ||
          metadata.repository_identity !== row.repository_identity ||
          metadata.base_commit !== row.base_commit ||
          metadata.target_branch !== row.target_branch ||
          metadata.finalized_commit !== effect.git_commit
        )
          throw new CommandError(
            "unmet_precondition",
            "Completed result lacks exact finalized workspace evidence",
          );
        const identity = resultIdentity(row, manifest, effect);
        if (captured) captured.identity=identity;
        git = {
          workspace_id: row.workspace_id,
          resource_id: row.resource_id,
          runner_id: row.runner_id,
          git_commit: effect.git_commit,
          git_tree: effect.git_tree,
          metadata,
          identity_digest: digest(canonicalJSON(identity)),
        };
      }
      const item = validate<TaskLocalResult>("TaskLocalResult", {
        manifest,
        current: row.current,
        current_specification_id: row.specification_id,
        current_plan_id: row.plan_id,
        repository_free: row.repository_free,
        git,
        admitted_at: row.created_at.toISOString(),
      });
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (bytes + size >= MAX_BODY_BYTES) {
        if (!items.length)
          throw new CommandError(
            "unmet_precondition",
            "Local result exceeds response budget",
          );
        break;
      }
      items.push(item);
      bytes += size;
      after = manifest.operation_id;
    }
    return validate<TaskResultPage>("TaskResultPage", {
      schema_version: 1,
      task_id: taskId,
      items,
      cursor: encode(taskId, after),
      has_more: rows.length > items.length,
    });
  });
}

function resultIdentity(row: ResultRow, m: CompletionManifest, effect: EffectResult): ResultReadIdentity {
  const w = row.operation.workspace_descriptor, md = effect.workspace_metadata;
  const d=validate<Dispatch>("Dispatch",row.launch), source=d.node_execution_source;
  if (!source || d.kind!=='node' || d.todo_id!==undefined || d.node_id!==m.node_id || d.node_activation!==m.node_activation || d.task_planning_source!==undefined || d.task_conversation_source!==undefined || d.task_replan_source!==undefined || d.task_id!==m.task_id || d.attempt_id!==m.attempt_id || d.dispatch_id!==row.dispatch_id || d.runner_id!==row.runner_id || source.node_id!==m.node_id || source.node_activation!==m.node_activation || source.specification_id!==m.specification_id || source.plan_id!==m.plan_id || !effect.writer_absent) throw new CommandError("unmet_precondition", "Result original execution identity is inconsistent");
  if (!w || !md || w.task_id !== m.task_id || w.node_id !== m.node_id || w.node_activation !== m.node_activation || w.runner_id !== row.runner_id || w.lease_id !== md.lease_id || w.generation !== md.generation || w.workspace_id !== row.workspace_id || w.resource.resource_id !== row.resource_id || row.operation.workspace_digest !== digest(canonicalJSON(w))) throw new CommandError("unmet_precondition", "Result descriptor identity is inconsistent");
  return validate<ResultReadIdentity>("ResultReadIdentity", {
    task_id:m.task_id, operation_id:m.operation_id, attempt_id:m.attempt_id, dispatch_id:row.dispatch_id,
    node_id:m.node_id, node_activation:m.node_activation, specification_id:m.specification_id, plan_id:m.plan_id,
    manifest_digest:m.content_digest, operation_identity_digest:completionIdentity(row.operation,row.dispatch_id),
    workspace_id:w.workspace_id, resource_id:row.resource_id, runner_id:row.runner_id,
    generation:md.generation, storage_id:md.storage_id, lease_id:md.lease_id, repository_identity:md.repository_identity,
    base_commit:md.base_commit, git_commit:effect.git_commit, git_tree:effect.git_tree
  });
}
export async function selectedTaskResult(db: Database, token: string, taskId: string, operationId: string) {
  validate("Id", operationId);
  const captured:{identity?:ResultReadIdentity}={};
  const page = await taskResults(db,token,taskId,undefined,operationId,captured);
  const item = page.items[0];
  if (!item) throw new CommandError("denied_scope", "Unknown Task result");
  if (!item.git) throw new CommandError("unmet_precondition", "Repository-free result has no Git content");
  const identity=captured.identity!;
  return {item,identity};
}
