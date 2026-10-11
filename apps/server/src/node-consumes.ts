import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { MAX_ITEM_BYTES } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPlanNode } from '../../../packages/protocol/src/index.ts';

// A consumes ID names immutable, already published Task content. Future output
// belongs in dependencies/expected_outputs, never a dangling Artifact promise.
export async function assertNodeConsumes(tx: Transaction, taskId: string, nodes: Pick<ExecutionPlanNode, 'consumes'>[]): Promise<void> {
  const ids = [...new Set(nodes.flatMap(node => node.consumes ?? []))];
  if (!ids.length) return;
  const found = await tx.query('SELECT id FROM artifacts WHERE task_id=$1 AND id=ANY($2::text[])', [taskId, ids]);
  if (found.rowCount !== ids.length) throw new CommandError('denied_scope', 'Consumed Artifacts must already exist in this Task');
}

export async function nodeConsumedArtifacts(tx: Transaction, taskId: string, planId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = (await tx.query<{ item: Record<string, unknown>; bytes: string }>(`WITH inputs AS (
    SELECT selected.ordinal, jsonb_build_object(
      'validity',CASE WHEN EXISTS(SELECT 1 FROM nodes n
        JOIN plan_nodes pn ON pn.node_id=n.id AND pn.plan_id=t.plan_id
        JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
        JOIN completion_manifests m ON m.operation_id=c.operation_id
        JOIN operations o ON o.id=c.operation_id AND o.state='succeeded'
        WHERE n.task_id=t.id AND n.id=a.node_id AND n.activation=a.node_activation
          AND n.state='COMPLETED' AND m.artifact_ids ? a.id
          AND activation_applies(t.id,n.id,n.activation,t.specification_id,t.plan_id))
        THEN 'current_completion' ELSE 'historical_context' END,
      'metadata',jsonb_strip_nulls(jsonb_build_object('artifact_id',a.id,'task_id',a.task_id,
        'node_id',a.node_id,'node_activation',a.node_activation,'attempt_id',a.attempt_id,
        'specification_id',a.specification_id,'plan_id',a.plan_id,'title',a.title,
        'media_type',a.media_type,'size_bytes',a.size_bytes,'content_digest',a.content_digest,
        'references',a.external_references,'supersedes',a.supersedes,
        'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
      'content',jsonb_build_object('text',a.content,'media_type',a.media_type)) item
    FROM unnest($3::text[]) WITH ORDINALITY selected(id,ordinal)
      JOIN artifacts a ON a.id=selected.id AND a.task_id=$1
      JOIN tasks t ON t.id=a.task_id AND t.plan_id=$2
  ), sized AS (SELECT ordinal,item,sum(octet_length(item::text)) OVER () bytes FROM inputs)
  SELECT CASE WHEN bytes<=$4 THEN item ELSE '{}'::jsonb END item,bytes FROM sized ORDER BY ordinal`,
  [taskId, planId, ids, MAX_ITEM_BYTES / 2])).rows;
  if (rows.length !== ids.length) throw new CommandError('denied_scope', 'Consumed Artifacts must already exist in this Task');
  if (rows.some(row => Number(row.bytes) > MAX_ITEM_BYTES / 2)) throw new CommandError('unmet_precondition', 'context_budget_exceeded');
  return rows.map(row => row.item);
}
