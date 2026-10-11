import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';

export async function taskCompletionPending(tx: Transaction, taskId: string, exceptAttemptId?: string): Promise<boolean> {
  return !!(await tx.query(`SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id
    WHERE a.task_id=$1 AND ($2::text IS NULL OR a.id<>$2) AND o.kind='complete_node'
      AND o.state NOT IN ('succeeded','cancelled') LIMIT 1`, [taskId, exceptAttemptId ?? null])).rowCount;
}

export async function assertCompletionBoundaryAvailable(tx: Transaction, taskId: string, exceptAttemptId?: string): Promise<void> {
  if (await taskCompletionPending(tx, taskId, exceptAttemptId))
    throw new CommandError('unmet_precondition', 'Another completion still owns the Task integration boundary; retry after it settles');
}
