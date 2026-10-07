import type {Transaction} from '../../../packages/db/src/index.ts';
import {CommandError} from '../../../packages/domain/src/commands.ts';
import type {DeliveryBatchRecord} from './owner-delivery-state.ts';
import {assertDeliveryBatchAuthority} from './owner-delivery-state.ts';
import {remoteItemQuiescent} from './remote-preparation-state.ts';
import {reviewSettlementReady} from './task-review-state.ts';
import {assertReviewMergeSettled} from './task-review-commands.ts';
import type {ReviewHooks} from './task-review-commands.ts';

// The command owner already locked discovered Runners and Task. Correction
// fences new effects, preserves public refs/PRs, and retains original effect
// identities for read-only settlement. It never requests remote cancellation.
export async function revokeAcceptedForReview(tx:Transaction,batch:DeliveryBatchRecord,requestId:string):Promise<void>{
 await assertDeliveryBatchAuthority(tx,batch);
 await assertReviewMergeSettled(tx,batch.task_id);
 if(!(await tx.query(`SELECT 1 FROM owner_delivery_revocations v JOIN owner_review_command_receipts c ON c.task_id=v.task_id AND c.request_id=v.request_id
   WHERE v.task_id=$1 AND v.batch_id=$2 AND v.request_id=$3 AND v.content_digest=$4 AND c.envelope->>'name'='request_changes'
     AND c.response->'revoked_batch'->>'revocation_id'=v.id AND c.response->>'feedback_id'=v.feedback_id`,[batch.task_id,batch.id,requestId,batch.content_digest])).rowCount)throw new CommandError('unmet_precondition','Correction requires its original Owner revocation receipt');
 await tx.query(`UPDATE owner_delivery_merge_operations SET status='cancelled',effect_owned=false,reason='review_revoked',version=version+1
   WHERE batch_id=$1 AND status='pending' AND NOT may_have_mutated`,[batch.id]);
 await tx.query(`UPDATE remote_preparation_operations o SET state='revoked',active=false,reconcile_only=true,reason='cancel_requested',version=version+1
   WHERE o.task_id=$1 AND o.state NOT IN ('settled','revoked') AND NOT o.may_have_mutated AND NOT o.effect_owned`,[batch.task_id]);
 await tx.query(`UPDATE remote_preparation_operations SET reconcile_only=true,version=version+1
   WHERE task_id=$1 AND state NOT IN ('settled','revoked') AND (may_have_mutated OR effect_owned) AND NOT reconcile_only`,[batch.task_id]);
 await tx.query("UPDATE delivery_operations SET dispatch_active=false WHERE task_id=$1 AND state='pending'",[batch.task_id]);
 // A readiness worker can have a credential/preflight outside SQL without a
 // mutation claim. Its next Task-locked guard must observe this revoked claim.
 await tx.query("UPDATE owner_delivery_batches SET checkpoint=checkpoint-'claim' WHERE id=$1",[batch.id]);
}

export async function reviewDeliverySettlementReady(tx:Transaction,taskId:string):Promise<boolean>{
 return await remoteItemQuiescent(tx,taskId)&&await reviewSettlementReady(tx,taskId)&&!(await tx.query(`SELECT 1 FROM owner_delivery_merge_operations m JOIN owner_delivery_batches b ON b.id=m.batch_id WHERE b.task_id=$1
   AND (m.effect_owned OR m.status IN ('started','unknown')) LIMIT 1`,[taskId])).rowCount;
}
export const ownerReviewHooks:ReviewHooks={revokeAccepted:revokeAcceptedForReview,settlementReady:reviewDeliverySettlementReady};
