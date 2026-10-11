import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_FRAME_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { CleanupSummary, Frame, ResultReadIdentity, RetentionPolicy, TaskCleanupACK, TaskCleanupAttempt, TaskCleanupRequest, TaskCleanupResult, TaskCleanupWorkspace } from '../../../packages/protocol/src/index.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { resolveNodeResult } from './task-result-reads.ts';

interface Job { id: string; task_id: string; runner_id: string; request: TaskCleanupRequest | null; request_digest: string | null; status: 'pending' | 'blocked' | 'completed'; result: TaskCleanupResult | null }

export async function retentionPolicy(tx: Transaction): Promise<RetentionPolicy> {
  return validate('RetentionPolicy', (await tx.query<{ retention: RetentionPolicy }>('SELECT retention FROM maintenance_configuration')).rows[0]!.retention);
}

export async function cleanupSummary(tx: Transaction): Promise<CleanupSummary> {
  const counts = (await tx.query<{ pending: number; completed: number; attention: number }>(`SELECT
    count(*) FILTER(WHERE status='pending')::int pending,
    count(*) FILTER(WHERE status='completed')::int completed,
    count(*) FILTER(WHERE status='blocked')::int attention FROM task_cleanup_jobs`)).rows[0]!;
  const attention_items = (await tx.query<NonNullable<CleanupSummary['attention_items']>[number]>(`SELECT task_id,runner_id,reason
    FROM task_cleanup_jobs WHERE status='blocked' ORDER BY created_at DESC,id LIMIT 16`)).rows;
  return { policy: await retentionPolicy(tx), ...counts, attention_items };
}

// Cleanup is infrastructure work, not a Task lifecycle event or an Agent tool.
// Every request is frozen after retention and ownership checks under the same
// Runner -> Task lock order as execution. Retries never broaden its path scope.
export class TaskCleanup {
  private readonly db: Database;
  private readonly instanceId: string;
  private cursor: [string, string] = ['', ''];
  constructor(db: Database, instanceId: string) { this.db = db; this.instanceId = instanceId; }

  async pump(): Promise<void> {
    const candidates = (await this.db.pool.query<{ task_id: string; runner_id: string }>(`WITH candidates AS (SELECT DISTINCT t.id task_id,a.runner_id
      FROM tasks t JOIN attempts a ON a.task_id=t.id JOIN maintenance_configuration c ON true
      LEFT JOIN task_cleanup_jobs j ON j.task_id=t.id AND j.runner_id=a.runner_id
      WHERE t.state='COMPLETED' AND (c.retention->>'enabled')::boolean
        AND t.completed_at<=clock_timestamp()-(c.retention->>'completed_task_days')::int*interval '1 day'
        AND EXISTS(SELECT 1 FROM outbox o WHERE o.attempt_id=a.id AND o.kind='start')
        AND (j.id IS NULL OR j.request IS NULL AND j.last_sent_at<clock_timestamp()-interval '60 seconds')
      ) SELECT task_id,runner_id FROM candidates
      ORDER BY (task_id,runner_id)<=($1::text,$2::text),task_id,runner_id LIMIT 16`, this.cursor)).rows;
    // An old completed Task can still have an unresolved owner or a busy lock.
    // Rotate past it so it cannot starve later Tasks of maintenance forever.
    const last = candidates.at(-1);
    if (last) this.cursor = [last.task_id, last.runner_id];
    for (const candidate of candidates) await this.admit(candidate.task_id, candidate.runner_id);
  }

  private async admit(taskId: string, runnerId: string): Promise<void> {
    await transaction(this.db, async tx => {
      await lockConfiguration(tx);
      const policy = await retentionPolicy(tx);
      if (!policy.enabled) return;
      if (!(await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE SKIP LOCKED', [runnerId])).rowCount) return;
      const task = (await tx.query<{ completed_at: Date }>(`SELECT completed_at FROM tasks WHERE id=$1 AND state='COMPLETED'
        AND completed_at<=clock_timestamp()-$2*interval '1 day' FOR UPDATE SKIP LOCKED`, [taskId, policy.completed_task_days])).rows[0];
      if (!task) return;
      const prior = (await tx.query<Job>('SELECT * FROM task_cleanup_jobs WHERE task_id=$1 AND runner_id=$2 FOR UPDATE', [taskId, runnerId])).rows[0];
      if (prior?.request) return;
      // COMPLETED alone never proves that the last writer or provider worker
      // has gone away. Keep all storage until these existing owners settle.
      const unsettled = (await tx.query<{ value: boolean }>(`SELECT
        EXISTS(SELECT 1 FROM attempts WHERE task_id=$1 AND (state='QUEUED' OR NOT process_released OR NOT process_absent OR mutation_allowed))
        OR EXISTS(SELECT 1 FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND o.state NOT IN ('succeeded','cancelled'))
        OR EXISTS(SELECT 1 FROM outbox o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND NOT o.done)
        OR EXISTS(SELECT 1 FROM workspace_leases WHERE task_id=$1 AND state<>'released')
        OR EXISTS(SELECT 1 FROM delivery_operations WHERE task_id=$1 AND state='pending' AND dispatch_active)
        OR EXISTS(SELECT 1 FROM remote_preparation_operations WHERE task_id=$1 AND (effect_owned OR NOT worker_absent OR active AND state NOT IN ('settled','revoked')))
        OR EXISTS(SELECT 1 FROM owner_delivery_merge_operations m JOIN owner_delivery_batches b ON b.id=m.batch_id
          WHERE b.task_id=$1 AND (m.effect_owned OR m.status IN ('pending','started','unknown'))) AS value`, [taskId])).rows[0]!.value;
      if (unsettled) return;
      const id = prior?.id ?? randomUUID();
      let request: TaskCleanupRequest | null = null, reason: string | null = null;
      try { request = await this.request(tx, id, taskId, runnerId, task.completed_at); }
      catch (error) {
        if (!(error instanceof CommandError)) throw error;
        reason = error.detail.code === 'invalid_input' ? 'request_too_large' : 'result_unavailable';
      }
      const requestDigest = request ? digest(canonicalJSON(request)) : null;
      await tx.query(`INSERT INTO task_cleanup_jobs(id,task_id,runner_id,request,request_digest,status,reason,last_sent_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $4::jsonb IS NULL THEN clock_timestamp() END)
        ON CONFLICT(task_id,runner_id) DO UPDATE SET request=EXCLUDED.request,request_digest=EXCLUDED.request_digest,
          status=EXCLUDED.status,reason=EXCLUDED.reason,last_sent_at=EXCLUDED.last_sent_at`,
      [id, taskId, runnerId, request, requestDigest, request ? 'pending' : 'blocked', reason]);
    });
  }

  private async request(tx: Transaction, cleanupId: string, taskId: string, runnerId: string, completedAt: Date): Promise<TaskCleanupRequest> {
    const workspaces = (await tx.query<TaskCleanupWorkspace>(`SELECT w.id workspace_id,w.resource_id,w.generation::int,w.storage_id,w.finalized_commit,
      EXISTS(SELECT 1 FROM workspace_leases l WHERE l.workspace_id=w.id AND l.allocation_id IS NULL) AS direct,
      COALESCE((SELECT jsonb_agg(x.allocation_id ORDER BY x.allocation_id) FROM
        (SELECT DISTINCT l.allocation_id FROM workspace_leases l WHERE l.workspace_id=w.id AND l.allocation_id IS NOT NULL) x),'[]'::jsonb) allocation_ids
      FROM task_workspaces w WHERE w.task_id=$1 AND w.runner_id=$2 AND w.ever_materialized ORDER BY w.id`, [taskId, runnerId])).rows;
    const attempts = (await tx.query<TaskCleanupAttempt>(`SELECT a.id attempt_id,a.dispatch_id FROM attempts a WHERE a.task_id=$1 AND a.runner_id=$2
      AND EXISTS(SELECT 1 FROM outbox o WHERE o.attempt_id=a.id AND o.kind='start') ORDER BY a.id`, [taskId, runnerId])).rows;
    const results: ResultReadIdentity[] = [];
    // Use the same exact-result validator as Owner file/diff reads. Each
    // disposable workspace must have its final current result independently
    // exported; Replan leftovers without that proof remain untouched.
    const operations = (await tx.query<{ operation_id: string }>(`SELECT DISTINCT c.operation_id FROM node_completions c
      JOIN attempts a ON a.id=c.attempt_id WHERE a.task_id=$1 AND a.runner_id=$2 ORDER BY c.operation_id`, [taskId, runnerId])).rows;
    for (const operation of operations) {
      const resolved = await resolveNodeResult(tx, taskId, operation.operation_id);
      if (!resolved.item.current) continue;
      for (const identity of resolved.identities) {
        const workspace = workspaces.find(item => item.workspace_id === identity.workspace_id && item.finalized_commit === identity.git_commit
          && item.generation === identity.generation && item.storage_id === identity.storage_id && item.resource_id === identity.resource_id
          && identity.task_id === taskId && identity.runner_id === runnerId);
        if (workspace && !results.some(item => item.workspace_id === workspace.workspace_id)) results.push(identity);
      }
    }
    if (workspaces.some(workspace => !results.some(result => result.workspace_id === workspace.workspace_id)))
      throw new CommandError('unmet_precondition', 'Final result is not available for workspace cleanup');
    const request: TaskCleanupRequest = { schema_version: 1, cleanup_id: cleanupId, task_id: taskId, runner_id: runnerId,
      completed_at: completedAt.toISOString(), workspaces, attempts, results };
    if (Buffer.byteLength(canonicalJSON(request)) > MAX_FRAME_BYTES - 4096 || workspaces.length > 256 || attempts.length > 4096
      || workspaces.some(workspace => workspace.allocation_ids.length > 1024))
      throw new CommandError('invalid_input', 'Cleanup request exceeds its bounded transport');
    return validate('TaskCleanupRequest', request);
  }

  async pending(runnerId: string, incarnation: number, supported: boolean): Promise<Frame[]> {
    if (!supported) return [];
    return transaction(this.db, async tx => {
      if (!await this.channel(tx, runnerId, incarnation)) return [];
      const row = (await tx.query<Job>(`SELECT * FROM task_cleanup_jobs WHERE runner_id=$1 AND status<>'completed' AND request IS NOT NULL
        AND (last_sent_at IS NULL OR last_sent_at<clock_timestamp()-interval '60 seconds') ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [runnerId])).rows[0];
      if (!row) return [];
      await tx.query('UPDATE task_cleanup_jobs SET last_sent_at=clock_timestamp() WHERE id=$1', [row.id]);
      return [{ schema_version: 1, type: 'task_cleanup', incarnation, cleanup_request: row.request! }];
    });
  }

  async finish(runnerId: string, incarnation: number, input: unknown): Promise<TaskCleanupACK | null> {
    const result = validate<TaskCleanupResult>('TaskCleanupResult', input);
    return transaction(this.db, async tx => {
      if (!await this.channel(tx, runnerId, incarnation)) throw new CommandError('stale_execution', 'Cleanup connection was replaced');
      const row = (await tx.query<Job>('SELECT * FROM task_cleanup_jobs WHERE id=$1 AND runner_id=$2 FOR UPDATE', [result.cleanup_id, runnerId])).rows[0];
      if (!row?.request || row.request_digest !== result.request_digest) throw new CommandError('denied_scope', 'Cleanup result differs from its exact request');
      if (row.status === 'completed') {
        if (canonicalJSON(row.result) !== canonicalJSON(result)) throw new CommandError('payload_conflict', 'Completed cleanup receipt is immutable');
      } else {
        await tx.query(`UPDATE task_cleanup_jobs SET status=$2,reason=$3,result=$4,
          completed_at=CASE WHEN $2='completed' THEN clock_timestamp() END WHERE id=$1`, [row.id, result.status, result.reason ?? null, result]);
        if (result.status === 'completed') await tx.query('UPDATE task_workspaces SET cleaned_at=clock_timestamp() WHERE task_id=$1 AND id=ANY($2::text[]) AND cleaned_at IS NULL',
          [row.task_id, row.request.workspaces.map(workspace => workspace.workspace_id)]);
      }
      return result.status === 'completed' ? { cleanup_id: row.id, request_digest: row.request_digest } : null;
    });
  }

  private async channel(tx: Transaction, runnerId: string, incarnation: number): Promise<boolean> {
    const row = (await tx.query<{ available: boolean }>(`SELECT connected AND ready AND NOT credential_revoked AND incarnation=$2
      AND connection_instance=$3 AND last_seen>clock_timestamp()-interval '15 seconds' AS available FROM runners WHERE id=$1 FOR UPDATE`,
    [runnerId, incarnation, this.instanceId])).rows[0];
    return row?.available ?? false;
  }
}
