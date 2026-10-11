import { transaction } from "../../../packages/db/src/index.ts";
import type { Database } from "../../../packages/db/src/index.ts";
import { CommandError } from "../../../packages/domain/src/commands.ts";
import {
  MAX_BODY_BYTES,
  validate,
} from "../../../packages/protocol/src/index.ts";
import type {
  AttemptWorkspace,
  AttemptWorkspaceStatus,
  EffectResult,
  WorkspaceEffectResult,
} from "../../../packages/protocol/src/index.ts";
import { authenticateOwner } from "./owner-commands.ts";

interface WorkspaceRow
  extends Omit<AttemptWorkspace, "metadata" | "metadata_operation_id"> {
  open_result: unknown;
  settle_result: unknown;
  settle_kind: string | null;
  recovery_operation_id: string | null;
  recovery_result: unknown;
}
// This is exact lease diagnostics. Metadata belongs to an identified successful
// effect for this Attempt; a later Task workspace head is never relabeled here.
export async function attemptWorkspace(
  db: Database,
  token: string,
  taskId: string,
  attemptId: string,
): Promise<AttemptWorkspaceStatus> {
  validate("Id", taskId);
  validate("Id", attemptId);
  return transaction(db, async (tx) => {
    await authenticateOwner(tx, token);
    if (
      !(await tx.query("SELECT id FROM tasks WHERE id=$1 FOR SHARE", [taskId]))
        .rowCount
    )
      throw new CommandError("denied_scope", "Unknown Task");
    // Project only the admitted execution choices. Never serialize launch or
    // configuration bodies (which include prompts and unrelated private data).
    const execution = (
      await tx.query<AttemptWorkspaceStatus["execution"]>(
        `SELECT launch->>'runtime_id' runtime_id,launch->>'model' model_id,
       selection_context->'target'->>'thinking_level' thinking_level
       FROM attempts WHERE id=$1 AND task_id=$2`,
        [attemptId, taskId],
      )
    ).rows[0];
    if (!execution)
      throw new CommandError("denied_scope", "Attempt is outside Task");
    const rows = (
      await tx.query<WorkspaceRow>(
        `SELECT w.id workspace_id,w.resource_id,w.runner_id,l.id lease_id,l.state lease_state,w.repository_identity,
   opened.id open_operation_id,opened.state open_state,opened.result open_result,
   settled.id settle_operation_id,settled.state settle_state,settled.kind settle_kind,settled_item.result settle_result,COALESCE(settled.failure_kind,opened.failure_kind) failure_kind,
   recovered.id recovery_operation_id,recovered_item.result recovery_result
   FROM workspace_leases l JOIN task_workspaces w ON w.id=l.workspace_id AND w.task_id=l.task_id
   JOIN operations opened ON opened.id=l.open_operation_id AND opened.attempt_id=l.attempt_id
   LEFT JOIN operations settled ON settled.id=l.settle_operation_id AND settled.attempt_id=l.attempt_id
   LEFT JOIN LATERAL operation_workspace_results(settled.id) settled_item ON settled_item.lease_id=l.id
   LEFT JOIN operations recovered ON recovered.completion_operation_id=settled.id
     AND recovered.kind='settle_completion' AND recovered.state='succeeded'
     AND recovered.attempt_id=l.attempt_id
   LEFT JOIN LATERAL operation_workspace_results(recovered.id) recovered_item ON recovered_item.lease_id=l.id
     AND recovered_item.workspace_digest=settled_item.workspace_digest AND recovered_item.workspace_descriptor=settled_item.workspace_descriptor
   WHERE l.task_id=$1 AND l.attempt_id=$2 ORDER BY w.resource_id,l.id LIMIT 65`,
        [taskId, attemptId],
      )
    ).rows;
    if (rows.length > 64)
      throw new CommandError(
        "unmet_precondition",
        "Attempt workspace list exceeds supported budget",
      );
    const workspaces: AttemptWorkspace[] = rows.map((row) => {
      const opened =
        row.open_state === "succeeded"
          ? validate<EffectResult>("EffectResult", row.open_result)
          : null;
      const settled =
        row.settle_state === "succeeded"
          ? row.settle_kind === "complete_node"
            ? validate<WorkspaceEffectResult>("WorkspaceEffectResult", row.settle_result)
            : validate<EffectResult>("EffectResult", row.settle_result)
          : null;
      const recovered = row.recovery_operation_id && row.recovery_result
        ? validate<WorkspaceEffectResult>("WorkspaceEffectResult", row.recovery_result)
        : null;
      // Correction leaves the lease pointing at its original completion. The
      // exact successful child owns the private checkpoint, while an already-
      // finalized pair owns its Git evidence on the original completion.
      const snapshot = recovered?.workspace_metadata
        ? recovered
        : settled?.workspace_metadata
          ? settled
          : opened;
      const metadata = snapshot?.workspace_metadata ?? null;
      if (
        metadata &&
        (snapshot?.workspace_id !== row.workspace_id ||
          metadata.lease_id !== row.lease_id ||
          metadata.repository_identity !== row.repository_identity)
      )
        throw new CommandError(
          "unmet_precondition",
          "Workspace metadata differs from exact lease",
        );
      return validate<AttemptWorkspace>("AttemptWorkspace", {
        workspace_id: row.workspace_id,
        resource_id: row.resource_id,
        runner_id: row.runner_id,
        lease_id: row.lease_id,
        lease_state: row.lease_state,
        repository_identity: row.repository_identity,
        open_operation_id: row.open_operation_id,
        open_state: row.open_state,
        settle_operation_id: row.settle_operation_id,
        settle_state: row.settle_state,
        failure_kind: row.failure_kind,
        metadata,
        metadata_operation_id: metadata
          ? recovered?.workspace_metadata
            ? row.recovery_operation_id
            : settled?.workspace_metadata
              ? row.settle_operation_id
              : row.open_operation_id
          : null,
      });
    });
    const result = validate<AttemptWorkspaceStatus>("AttemptWorkspaceStatus", {
      schema_version: 1,
      task_id: taskId,
      attempt_id: attemptId,
      execution,
      workspaces,
    });
    if (Buffer.byteLength(JSON.stringify(result)) >= MAX_BODY_BYTES)
      throw new CommandError(
        "unmet_precondition",
        "Attempt workspace read exceeds response budget",
      );
    return result;
  });
}
