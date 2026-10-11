import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { MAX_ITEM_BYTES } from '../../../packages/protocol/src/index.ts';

/** Only current completed direct dependencies contribute input evidence. Artifact
 * bodies stay behind read_artifact; unselected and historical outputs stay out. */
export async function nodeUpstreamContext(tx: Transaction, taskId: string, planId: string, dependencies: string[]) {
  const rows = (await tx.query<{ item: Record<string, unknown>; bytes: string }>(`WITH inputs AS (
    SELECT jsonb_build_object('node_id',n.id,'node_activation',n.activation,
      'completion_operation_id',c.operation_id,'completion_manifest_digest',m.content_digest,
      'summary',m.summary,'git_commit',c.result->'git_commit','git_tree',c.result->'git_tree',
      'artifacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('artifact_id',a.id,'title',a.title,
        'media_type',a.media_type,'size_bytes',a.size_bytes,'content_digest',a.content_digest,
        'references',a.external_references) ORDER BY a.id) FROM artifacts a
        WHERE a.task_id=n.task_id AND a.node_id=n.id AND a.node_activation=n.activation AND m.artifact_ids ? a.id),'[]'::jsonb)) item
    FROM nodes n JOIN tasks t ON t.id=n.task_id
      JOIN plan_nodes pn ON pn.plan_id=t.plan_id AND pn.node_id=n.id
      JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
      JOIN completion_manifests m ON m.operation_id=c.operation_id
      JOIN operations o ON o.id=c.operation_id AND o.state='succeeded'
    WHERE n.task_id=$1 AND t.plan_id=$2 AND n.id=ANY($3::text[]) AND n.state='COMPLETED'
      AND activation_applies(t.id,n.id,n.activation,t.specification_id,t.plan_id)
  ), sized AS (SELECT item, sum(octet_length(item::text)) OVER () bytes FROM inputs)
  SELECT CASE WHEN bytes<=$4 THEN item ELSE '{}'::jsonb END item,bytes FROM sized ORDER BY item->>'node_id'`,
  [taskId, planId, dependencies, MAX_ITEM_BYTES / 2])).rows;
  if (rows.length !== dependencies.length) throw new CommandError('unmet_precondition', 'Node dependencies lack current completion evidence');
  if (rows.some(row => Number(row.bytes) > MAX_ITEM_BYTES / 2)) throw new CommandError('unmet_precondition', 'context_budget_exceeded');
  return { validity: 'Current completed dependency activations only. Each result records its actual revision; later integrated code needs fresh validation.', items: rows.map(row => row.item) };
}
