import type { Transaction } from '../../../packages/db/src/index.ts';
import type { Dispatch, ExecutionTarget } from '../../../packages/protocol/src/index.ts';

export interface RuntimeSelectionContext {
  source: 'explicit' | 'planner' | 'role' | 'global'; configuration_version: number;
  target: ExecutionTarget; observed_version?: string; request_digest: string;
  policy_targets?: ExecutionTarget[];
}
export interface RuntimePredecessor {
  id: string; runner_id: string; task_id: string | null; todo_id: string | null; node_id: string | null;
  launch: Dispatch; selection_context: RuntimeSelectionContext | null;
  state: string; mutation_allowed: boolean; process_absent: boolean; process_released: boolean;
  specification_id: string | null; plan_id: string | null; node_activation: string;
  runtime_chain_root_id?: string | null; runtime_target_index?: number | null; runtime_predecessor_id?: string | null;
}
export type RuntimeFallbackInspection = { status: 'ready' } | { status: 'waiting' | 'superseded'; reason: string };
export type RuntimeFallbackPreparation = { status: 'prepared'; source_id: string; planned_attempt_id: string; preparation_failure?: string } |
  { status: 'waiting' | 'superseded'; reason: string };
export interface RuntimeContinuationRow {
  predecessor_attempt_id: string; failure_stream_id: string; failure_sequence: string; stop_operation_id: string;
  successor_planned_attempt_id: string | null;
  state: 'settling' | 'prepared' | 'queued' | 'exhausted' | 'superseded';
  reason: string | null; resolved_at: Date | null;
}

// Callers already hold the source's Runner/Task or Todo locks. Match the
// prepared identity too: a successor source exists before its Attempt does.
export async function runtimeContinuation(tx: Transaction, attemptId: string): Promise<RuntimeContinuationRow | undefined> {
  return (await tx.query<RuntimeContinuationRow>(`SELECT * FROM runtime_continuations
    WHERE (predecessor_attempt_id=$1 OR successor_planned_attempt_id=$1)
      AND (state IN ('settling','prepared') OR (state='exhausted' AND resolved_at IS NULL))
    ORDER BY created_at DESC LIMIT 1`, [attemptId])).rows[0];
}
export async function activeRuntimeContinuation(tx: Transaction, attemptId: string): Promise<boolean> {
  return !!await runtimeContinuation(tx, attemptId);
}
export async function supersedeRuntimeContinuation(tx: Transaction, attemptId: string, reason: string): Promise<void> {
  await tx.query(`UPDATE runtime_continuations SET state='superseded',reason=$2,resolved_at=clock_timestamp(),last_checked_at=clock_timestamp()
    WHERE (predecessor_attempt_id=$1 OR successor_planned_attempt_id=$1)
      AND (state IN ('settling','prepared') OR (state='exhausted' AND resolved_at IS NULL))`, [attemptId, reason]);
}

export async function runtimePredecessorSettled(tx: Transaction, predecessor: RuntimePredecessor): Promise<boolean> {
  if (!predecessor.process_absent || !predecessor.process_released) return false;
  return !(await tx.query(`SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')
    UNION ALL SELECT 1 FROM workspace_leases WHERE attempt_id=$1 AND state<>'released'`, [predecessor.id])).rowCount;
}
