import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import type { EffectResult, WorkspaceDescriptor } from '../../../packages/protocol/src/index.ts';

type Source = NonNullable<WorkspaceDescriptor['canonical_source']>;
type SourceRow = { id: string; attempt_id: string; kind: Source['kind']; result: EffectResult; recovery_operation_id?: string | null };

function physicalSource(row: SourceRow): Source {
  const metadata = row.result.workspace_metadata;
  if (!metadata) throw new CommandError('unmet_precondition', 'Protected workspace source metadata is missing');
  return { operation_id: row.id, attempt_id: row.attempt_id, kind: row.kind, metadata,
    ...(row.recovery_operation_id ? { recovery_operation_id: row.recovery_operation_id } : {}),
    ...(row.result.integration ? { integration: row.result.integration } : {}) };
}

export async function canonicalWorkspaceSource(tx: Transaction, workspaceId: string): Promise<Source> {
  const row = (await tx.query<SourceRow>(`SELECT op.id,op.attempt_id,op.kind,op.result FROM task_workspaces w
    JOIN workspace_leases l ON l.workspace_id=w.id JOIN operations op ON op.workspace_lease_id=l.id
    WHERE w.id=$1 AND op.state='succeeded' AND op.kind='complete_node' AND l.state='released'
      AND op.result->>'writer_absent'='true' AND op.result->'workspace_metadata'->>'finalized_commit'=w.finalized_commit
      AND op.result->>'git_commit'=w.finalized_commit
      AND (op.result->'integration' IS NULL OR op.result->'integration'->>'outcome'='integrated')
    ORDER BY op.created_at DESC,op.id DESC LIMIT 1`, [workspaceId])).rows[0];
  if (row) return physicalSource(row);
  const initial = (await tx.query<SourceRow>(`SELECT op.id,op.attempt_id,op.kind,op.result,stop.id recovery_operation_id FROM task_workspaces w
    JOIN operations op ON op.id=w.materialized_by_operation_id JOIN workspace_leases l ON l.id=op.workspace_lease_id
    LEFT JOIN operations stop ON stop.id=l.settle_operation_id AND stop.attempt_id=op.attempt_id
      AND stop.workspace_lease_id=l.id AND stop.kind='stop' AND stop.state='succeeded'
    WHERE w.id=$1
      AND op.kind='open_workspace' AND op.state='succeeded' AND w.finalized_commit=w.base_commit`, [workspaceId])).rows[0];
  if (!initial) throw new CommandError('unmet_precondition', 'Exact protected canonical workspace source is unavailable');
  return physicalSource(initial);
}

export async function workspaceConflictSource(tx: Transaction, workspaceId: string, nodeId: string, activation: string): Promise<Source | undefined> {
  const row = (await tx.query<SourceRow>(`SELECT op.id,op.attempt_id,op.kind,op.result FROM operations op
    JOIN workspace_leases l ON l.id=op.workspace_lease_id JOIN attempts a ON a.id=op.attempt_id
    WHERE l.workspace_id=$1 AND l.node_id=$2 AND l.node_activation=$3 AND l.state='released'
      AND op.kind='complete_node' AND op.state='succeeded' AND op.result->'integration'->>'outcome'='conflict'
      AND a.process_absent AND a.process_released AND NOT a.mutation_allowed
    ORDER BY op.created_at DESC,op.id DESC LIMIT 1`, [workspaceId, nodeId, activation])).rows[0];
  return row ? physicalSource(row) : undefined;
}
