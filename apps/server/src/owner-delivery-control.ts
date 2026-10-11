import type { Transaction } from '../../../packages/db/src/index.ts';
import type { DeliveryRepository } from '../../../packages/protocol/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { assertDeliveryBatchAuthority } from './owner-delivery-state.ts';
import type { DeliveryBatchRecord } from './owner-delivery-state.ts';
import type { OwnerDeliveryHooks } from './owner-delivery-commands.ts';
import { admitAcceptedPreparationForItem } from './owner-delivery-preparation.ts';
import { requestRemoteCancel } from './remote-preparation-state.ts';
import type { RemoteItem } from './remote-preparation-state.ts';
import { cancelTaskInputEffects } from './task-guidance.ts';
import { admitCompletionSettlement, stopAttempt } from './node-execution.ts';
import type { Attempt, CompletionOperation } from './node-execution.ts';
import { lockAttemptWorkspace } from './workspaces.ts';
import { planningEvent } from './task-planning-state.ts';
import { retryAcceptedMerge } from './owner-delivery-worker.ts';
import {cancelReviewOperations} from './task-review-state.ts';

export async function admitAcceptedPreparation(tx: Transaction, batch: DeliveryBatchRecord, repositories: DeliveryRepository[], retry = false): Promise<void> {
  await assertDeliveryBatchAuthority(tx, batch);
  for (const repository of repositories.filter(r => r.outcome === 'modified').sort((a, b) => a.resource_id<b.resource_id?-1:a.resource_id>b.resource_id?1:0)) {
    const item = (await tx.query<RemoteItem>('SELECT * FROM remote_preparation_items WHERE item_id=$1 AND task_id=$2 FOR UPDATE', [repository.item_id, batch.task_id])).rows[0];
    if (!item) throw new CommandError('unmet_precondition', 'Accepted remote item is unavailable');
    await admitAcceptedPreparationForItem(tx, item, retry);
  }
}

// OwnerDeliveryCommands discovers and locks every relevant Runner before Task,
// then revalidates that discovery. This hook never discovers another Runner.
export async function cancelAcceptedDelivery(tx: Transaction, batch: DeliveryBatchRecord, requestId: string): Promise<void> {
  await assertDeliveryBatchAuthority(tx, batch);
  await cancelReviewOperations(tx,batch.task_id,requestId);
  await cancelTaskInputEffects(tx, batch.task_id);
  await requestRemoteCancel(tx, batch.task_id);
  await tx.query("UPDATE owner_delivery_merge_operations SET status='cancelled',effect_owned=false,reason='cancel_requested',version=version+1 WHERE batch_id=$1 AND status='pending' AND NOT may_have_mutated", [batch.id]);
  await tx.query("UPDATE tasks SET state='CANCELLED',control_version=control_version+1 WHERE id=$1", [batch.task_id]);
  await tx.query("UPDATE nodes SET state='CANCELLED' WHERE task_id=$1 AND state<>'COMPLETED'", [batch.task_id]);
  await tx.query("UPDATE node_execution_outbox SET done=true,waiting_reason='task_cancelled' WHERE task_id=$1 AND NOT done", [batch.task_id]);
  const attempts = (await tx.query<Attempt>('SELECT * FROM attempts WHERE task_id=$1 ORDER BY id FOR UPDATE', [batch.task_id])).rows;
  for (const attempt of attempts) {
    if (attempt.process_released && attempt.state !== 'QUEUED') continue;
    await lockAttemptWorkspace(tx, attempt.id);
    const original = (await tx.query<CompletionOperation>("SELECT * FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state NOT IN ('succeeded','cancelled') FOR UPDATE", [attempt.id])).rows[0];
    if (original) await admitCompletionSettlement(tx, attempt, original, requestId, 'cancel_task');
    else await stopAttempt(tx, attempt, requestId, 'task_cancelled');
    await tx.query('UPDATE attempts SET mutation_allowed=false WHERE id=$1', [attempt.id]);
  }
  await planningEvent(tx, batch.task_id, 'task_cancelled', { batch_id: batch.id, content_digest: batch.content_digest });
}

export const ownerDeliveryHooks: OwnerDeliveryHooks = {
  admitAcceptedPreparation,
  cancelAcceptedDelivery,
  retryAcceptedDelivery: async (tx, batch) => {
    await retryAcceptedMerge(tx, batch);
    await admitAcceptedPreparation(tx, batch, batch.manifest.repositories, true);
  },
};
