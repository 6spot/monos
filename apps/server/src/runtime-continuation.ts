import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import type { RuntimeEvent } from '../../../packages/protocol/src/index.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { lockDiscussion, inspectDiscussionRuntimeFallback, prepareDiscussionRuntimeFallback, exhaustDiscussionRuntimeFallback } from './discussion-state.ts';
import { inspectNodeRuntimeFallback, prepareNodeRuntimeFallback, exhaustNodeRuntimeFallback } from './node-execution-state.ts';
import { inspectPlanningRuntimeFallback, preparePlanningRuntimeFallback, exhaustPlanningRuntimeFallback } from './task-planning-state.ts';
import { inspectConversationRuntimeFallback, prepareConversationRuntimeFallback, exhaustConversationRuntimeFallback } from './task-conversation-state.ts';
import { inspectReplanRuntimeFallback, prepareReplanRuntimeFallback, exhaustReplanRuntimeFallback } from './task-replan-state.ts';
import { inspectReviewRuntimeFallback, prepareReviewRuntimeFallback, exhaustReviewRuntimeFallback } from './task-review-sources.ts';
import { runtimeContinuation, runtimePredecessorSettled } from './runtime-continuation-state.ts';
import { preparedRuntimeSourceCurrent } from './runtime-continuation-current.ts';
import type { RuntimePredecessor, RuntimeContinuationRow } from './runtime-continuation-state.ts';
import { admitWorkspaceEffect } from './workspaces.ts';
import type { WorkspaceAttempt } from './workspaces.ts';

function sourceHandlers(predecessor: RuntimePredecessor) {
  if (predecessor.launch.node_execution_source) return { inspect: inspectNodeRuntimeFallback, prepare: prepareNodeRuntimeFallback, exhaust: exhaustNodeRuntimeFallback };
  if (predecessor.launch.task_planning_source) return { inspect: inspectPlanningRuntimeFallback, prepare: preparePlanningRuntimeFallback, exhaust: exhaustPlanningRuntimeFallback };
  if (predecessor.todo_id) return { inspect: inspectDiscussionRuntimeFallback, prepare: prepareDiscussionRuntimeFallback, exhaust: exhaustDiscussionRuntimeFallback };
  if (predecessor.launch.task_conversation_source) return { inspect: inspectConversationRuntimeFallback, prepare: prepareConversationRuntimeFallback, exhaust: exhaustConversationRuntimeFallback };
  if (predecessor.launch.task_replan_source) return { inspect: inspectReplanRuntimeFallback, prepare: prepareReplanRuntimeFallback, exhaust: exhaustReplanRuntimeFallback };
  if (predecessor.launch.task_review_source) return { inspect: inspectReviewRuntimeFallback, prepare: prepareReviewRuntimeFallback, exhaust: exhaustReviewRuntimeFallback };
  return undefined;
}

async function finishRuntimeExhaustion(tx: Transaction, predecessor: RuntimePredecessor, continuation: RuntimeContinuationRow, reason: string): Promise<void> {
  const handlers = sourceHandlers(predecessor)!;
  const applied = await handlers.exhaust(tx, continuation.successor_planned_attempt_id ?? predecessor.id, reason);
  const current = !applied && (continuation.successor_planned_attempt_id
    ? await preparedRuntimeSourceCurrent(tx, predecessor, continuation.successor_planned_attempt_id)
    : (await handlers.inspect(tx, predecessor)).status !== 'superseded');
  // A temporary freeze can prevent a factual source transition. Retain the
  // exhausted continuation until that guard clears; only obsolete obligations
  // are superseded. No further target can be selected from this state.
  await tx.query(`UPDATE runtime_continuations SET state=$2,reason=$3,
    resolved_at=CASE WHEN $4 THEN NULL ELSE clock_timestamp() END WHERE predecessor_attempt_id=$1`,
  [continuation.predecessor_attempt_id, applied || current ? 'exhausted' : 'superseded', reason, current]);
}

/** Called only after the authenticated terminal event is retained under the
 * existing Runner -> Task/Todo -> Attempt lock. Never infers failure from logs. */
export async function recordRuntimeContinuation(tx: Transaction, predecessor: RuntimePredecessor & WorkspaceAttempt, event: RuntimeEvent): Promise<boolean> {
  if (event.runtime_failure !== 'native_terminal_error' || !predecessor.mutation_allowed || predecessor.state !== 'RUNNING' ||
      !predecessor.runtime_chain_root_id || !predecessor.selection_context?.policy_targets) return false;
  const handlers = sourceHandlers(predecessor);
  if (!handlers) return false;
  if ((await tx.query(`SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node'
    UNION ALL SELECT 1 FROM requirement_changes WHERE admission_attempt_id=$1
    UNION ALL SELECT 1 FROM runtime_events WHERE attempt_id=$1 AND body->>'kind'='capture_failed'`, [predecessor.id])).rowCount) return false;
  const inspected = await handlers.inspect(tx, predecessor);
  if (inspected.status === 'superseded') return false;
  await tx.query("UPDATE attempts SET state='FAILED',mutation_allowed=false,end_reason='runtime_error' WHERE id=$1", [predecessor.id]);
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [predecessor.id]);
  const priorStop = (await tx.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1", [predecessor.id])).rows[0];
  const stop = priorStop?.id ?? await admitWorkspaceEffect(tx, predecessor, 'stop', randomUUID());
  await tx.query(`INSERT INTO runtime_continuations(predecessor_attempt_id,failure_stream_id,failure_sequence,stop_operation_id,state,reason)
    VALUES($1,$2,$3,$4,'settling','waiting_for_original_settlement')`, [predecessor.id, event.stream_id, event.sequence, stop]);
  return true;
}

// Capture attention can arrive after the native terminal fact or physical Stop.
// Close any still-pending automatic handoff through its source's ordinary
// failure projection so Owner Retry remains available; merely superseding the
// continuation would strand a failed Planner as "running".
export async function failRuntimeContinuationCapture(tx: Transaction, predecessor: RuntimePredecessor): Promise<void> {
  const continuation = await runtimeContinuation(tx, predecessor.id);
  if (!continuation) return;
  const handlers = sourceHandlers(predecessor);
  if (!handlers) return;
  await finishRuntimeExhaustion(tx, predecessor, continuation, 'capture_failed');
  await tx.query("UPDATE attempts SET end_reason='capture_failed' WHERE id=$1", [predecessor.id]);
}

export class RuntimeContinuation {
  readonly db: Database;
  private pumping = false;
  constructor(db: Database) { this.db = db; }

  async pump(limit = 8): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const candidates = (await this.db.pool.query<{ predecessor_attempt_id: string; runner_id: string; task_id: string | null; todo_id: string | null }>(`SELECT c.predecessor_attempt_id,a.runner_id,a.task_id,a.todo_id
        FROM runtime_continuations c JOIN attempts a ON a.id=c.predecessor_attempt_id
        WHERE c.resolved_at IS NULL ORDER BY c.last_checked_at,c.created_at,c.predecessor_attempt_id LIMIT $1`, [limit])).rows;
      for (const candidate of candidates) {
        try { await transaction(this.db, async (tx) => {
        const configurationVersion = await lockConfiguration(tx);
        await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [candidate.runner_id]);
        if (candidate.todo_id) await lockDiscussion(tx, candidate.todo_id);
        else await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [candidate.task_id]);
        const predecessor = (await tx.query<RuntimePredecessor>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [candidate.predecessor_attempt_id])).rows[0]!;
        const continuation = (await tx.query<RuntimeContinuationRow>('SELECT * FROM runtime_continuations WHERE predecessor_attempt_id=$1 FOR UPDATE', [predecessor.id])).rows[0]!;
        if (continuation.resolved_at) return;
        await tx.query('UPDATE runtime_continuations SET last_checked_at=clock_timestamp() WHERE predecessor_attempt_id=$1', [predecessor.id]);
        const handlers = sourceHandlers(predecessor)!;
        if (continuation.state === 'exhausted') {
          await finishRuntimeExhaustion(tx, predecessor, continuation, continuation.reason ?? 'runtime_targets_exhausted');
          return;
        }
        if (continuation.state === 'prepared') {
          if (!await preparedRuntimeSourceCurrent(tx, predecessor, continuation.successor_planned_attempt_id!))
            await tx.query("UPDATE runtime_continuations SET state='superseded',reason='prepared_source_changed',resolved_at=clock_timestamp() WHERE predecessor_attempt_id=$1", [predecessor.id]);
          return;
        }
        if (continuation.state !== 'settling') return;
        const inspected = await handlers.inspect(tx, predecessor);
        if (inspected.status === 'superseded') {
          await tx.query("UPDATE runtime_continuations SET state='superseded',reason=$2,resolved_at=clock_timestamp() WHERE predecessor_attempt_id=$1", [predecessor.id, inspected.reason]);
          return;
        }
        const stopped = (await tx.query("SELECT 1 FROM operations WHERE id=$1 AND state='succeeded'", [continuation.stop_operation_id])).rowCount;
        if (inspected.status === 'waiting' || !stopped || !await runtimePredecessorSettled(tx, predecessor)) {
          await tx.query('UPDATE runtime_continuations SET reason=$2 WHERE predecessor_attempt_id=$1', [predecessor.id, inspected.status === 'waiting' ? inspected.reason : 'waiting_for_original_settlement']);
          return;
        }
        const prepared = await handlers.prepare(tx, predecessor, configurationVersion);
        if (prepared.status !== 'prepared') {
          await tx.query(`UPDATE runtime_continuations SET state=$2,reason=$3,resolved_at=CASE WHEN $2='superseded' THEN clock_timestamp() ELSE NULL END
            WHERE predecessor_attempt_id=$1`, [predecessor.id, prepared.status === 'superseded' ? 'superseded' : 'settling', prepared.reason]);
          return;
        }
        await tx.query(`UPDATE runtime_continuations SET successor_planned_attempt_id=$2,state=$3,reason=$4 WHERE predecessor_attempt_id=$1`,
          [predecessor.id, prepared.planned_attempt_id, prepared.preparation_failure ? 'exhausted' : 'prepared', prepared.preparation_failure ?? null]);
        }); } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          // A temporary source/configuration guard must not pin the oldest
          // candidate forever or roll back unrelated owners in this pass.
          await this.db.pool.query(`UPDATE runtime_continuations SET reason=$2,last_checked_at=clock_timestamp()
            WHERE predecessor_attempt_id=$1 AND resolved_at IS NULL`, [candidate.predecessor_attempt_id, error.detail.code]);
        }
      }
    } finally { this.pumping = false; }
  }
}
