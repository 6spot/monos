import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPolicy, ExecutionTarget, PolicyConfiguration, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { lockDiscussion } from './discussion-state.ts';
import type { DispatchQueue, QueueInput } from './dispatch-queue.ts';
import type { RuntimeContinuationRow, RuntimePredecessor } from './runtime-continuation-state.ts';

const freeModel = 'opencode/longcat-2.5-preview-free';
const deepSeekModel = 'volcengine/deepseek-v4-flash-ga-260731';
const codexModel = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const codexThinking = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
type Source = 'explicit' | 'planner' | 'role' | 'global';
export type SelectionReason = 'policy_missing' | 'role_missing' | 'unsupported_runtime' | 'unsupported_model' |
  'unsupported_thinking' | 'runner_missing' | 'runner_offline' | 'installation_stale' |
  'installation_unavailable' | 'model_control_unavailable' | 'thinking_control_unavailable' | 'ambiguous_auto_placement' | 'unsupported_runner_transfer' | 'runtime_targets_exhausted';
export type SchedulingRequest = Omit<QueueInput, 'runner_id' | 'runtime_id' | 'model' | 'thinking_level' | 'selection_context' | 'runtime_chain_root_id' | 'runtime_target_index' | 'runtime_predecessor_id'> & {
  role_id?: string; explicit_target?: ExecutionTarget;
};
export type SchedulingResult =
  | { status: 'queued'; dispatch_id: string; runner_id: string; source: Source; target: ExecutionTarget }
  | { status: 'unavailable'; reason: SelectionReason; source?: Source; target?: ExecutionTarget };

interface RunnerFact {
  id: string; incarnation: string; online: boolean; runtime_report_incarnation: string | null;
  installation_incarnation: string | null; observation: RuntimeInstallation | null;
}

function issue(fact: RunnerFact, target: ExecutionTarget): SelectionReason | null {
  if (!fact.online) return 'runner_offline';
  if (!fact.observation || Number(fact.installation_incarnation) !== Number(fact.incarnation))
    return Number(fact.runtime_report_incarnation) === Number(fact.incarnation) ? 'installation_unavailable' : 'installation_stale';
  if (fact.observation.availability !== 'detected') return 'installation_unavailable';
  if (!fact.observation.supports_model) return 'model_control_unavailable';
  if (target.thinking_level !== undefined && !fact.observation.supports_thinking) return 'thinking_control_unavailable';
  return null;
}

function targetIssue(target: ExecutionTarget): SelectionReason | null {
  // An absent model cannot be interpreted as an approved model implicitly.
  if (target.runtime_id === 'codex') {
    if (!target.model_id || !codexModel.test(target.model_id)) return 'unsupported_model';
    if (target.thinking_level !== undefined && !codexThinking.has(target.thinking_level)) return 'unsupported_thinking';
    return null;
  }
  if (target.runtime_id !== 'opencode') return 'unsupported_runtime';
  if (target.model_id !== freeModel && target.model_id !== deepSeekModel) return 'unsupported_model';
  if (target.thinking_level !== undefined) return 'unsupported_thinking';
  return null;
}

function allowsFallback(reason: SelectionReason): boolean {
  return reason === 'unsupported_runtime' || reason === 'unsupported_model' || reason === 'unsupported_thinking' ||
    reason === 'installation_unavailable' || reason === 'model_control_unavailable' || reason === 'thinking_control_unavailable' || reason === 'unsupported_runner_transfer' || reason === 'runtime_targets_exhausted';
}

/**
 * Product-facing Runtime admission. The owning command supplies immutable
 * context and authorization, calls this inside its transaction before taking
 * Runner/Task locks, then records its receipt in that same transaction.
 */
export class RuntimeScheduling {
  private readonly queue: DispatchQueue;
  private readonly backendInstance: string;
  constructor(queue: DispatchQueue, backendInstance: string) { this.queue = queue; this.backendInstance = backendInstance; }

  async selectAndEnqueue(tx: Transaction, request: SchedulingRequest): Promise<SchedulingResult> {
    validate('Id', request.attempt_id);
    if (request.role_id) validate('Id', request.role_id);
    if (request.explicit_target) validate('ExecutionTarget', request.explicit_target);
    const requestDigest = digest(canonicalJSON(request));
    const configurationVersion = await lockConfiguration(tx);
    // Serialize the identity before reading it, including Auto resolutions
    // that could otherwise lock different Runners on concurrent submissions.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1729))', [request.attempt_id]);
    // Replay uses the original choice even if saved policy or installation
    // facts have since changed. A different caller input cannot reuse the ID.
    const prior = (await tx.query<{ dispatch_id: string; runner_id: string; selection_context: QueueInput['selection_context'] | null }>('SELECT dispatch_id,runner_id,selection_context FROM attempts WHERE id=$1', [request.attempt_id])).rows[0];
    if (prior) {
      if (!prior.selection_context || prior.selection_context.request_digest !== requestDigest) throw new CommandError('payload_conflict', 'Selected Attempt identity has different content');
      return { status: 'queued', dispatch_id: prior.dispatch_id, runner_id: prior.runner_id, source: prior.selection_context.source, target: prior.selection_context.target };
    }

    const continuation = (await tx.query<RuntimeContinuationRow>(
      'SELECT * FROM runtime_continuations WHERE successor_planned_attempt_id=$1', [request.attempt_id])).rows[0];
    if (continuation && continuation.state !== 'prepared') throw new CommandError('stale_execution', 'Runtime continuation no longer owns this source');
    const predecessor = continuation ? (await tx.query<RuntimePredecessor>('SELECT * FROM attempts WHERE id=$1', [continuation.predecessor_attempt_id])).rows[0]! : undefined;
    let source: Source; let targets: ExecutionTarget[]; let firstIndex = 0;
    if (predecessor) {
      if (!predecessor.selection_context?.policy_targets || predecessor.runtime_target_index == null || !predecessor.runtime_chain_root_id)
        throw new CommandError('stale_execution', 'Runtime continuation has no frozen policy');
      source = predecessor.selection_context.source; targets = predecessor.selection_context.policy_targets;
      firstIndex = predecessor.runtime_target_index + 1;
    } else {
      const policies = (await tx.query<{ policies: PolicyConfiguration }>('SELECT policies FROM execution_policies')).rows[0]!.policies;
      let rolePolicy: ExecutionPolicy | null = null;
      if (request.kind === 'node' && request.role_id) {
        const role = (await tx.query<{ execution_policy: ExecutionPolicy | null }>('SELECT execution_policy FROM roles WHERE id=$1', [request.role_id])).rows[0];
        if (!role) return { status: 'unavailable', reason: 'role_missing' };
        rolePolicy = role.execution_policy;
      }
      source = request.explicit_target ? 'explicit' :
        request.kind === 'planner' && policies.planner ? 'planner' :
          request.kind === 'node' && rolePolicy ? 'role' : 'global';
      const policy = source === 'planner' ? policies.planner : source === 'role' ? rolePolicy : policies.global;
      targets = request.explicit_target ? [request.explicit_target] : policy ? [policy.default_target, ...policy.fallback_targets] : [];
    }
    const candidates = targets.slice(firstIndex).map((target, offset) => ({
      target, index: firstIndex + offset,
      placement: predecessor ? { ...target, runner_id: predecessor.runner_id } : target,
      reason: predecessor && target.runner_id && target.runner_id !== predecessor.runner_id ? 'unsupported_runner_transfer' as const : targetIssue(target),
    }));
    const compatible = candidates.filter((candidate) => candidate.reason === null);

    // Lock the entire candidate scope before any Runner row lock. Auto must
    // see one stable Runner set through queue admission. EXCLUSIVE
    // waits for the ROW SHARE table lock taken by connect/touch's FOR UPDATE.
    // SHARE ROW EXCLUSIVE would permit their row lock, then block their UPDATE
    // while Auto waits for that row, forming a deadlock. Pinned-only policies
    // acquire all candidate rows in one order, even if policy order differs.
    if (predecessor) await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [predecessor.runner_id]);
    else if (compatible.some(({ placement }) => !placement.runner_id)) await tx.query('LOCK TABLE runners IN EXCLUSIVE MODE');
    else if (compatible.length) {
      const runnerIds = [...new Set(compatible.map(({ placement }) => placement.runner_id!))].sort();
      await tx.query('SELECT id FROM runners WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [runnerIds]);
    }

    let unavailable: Extract<SchedulingResult, { status: 'unavailable' }> = { status: 'unavailable', reason: predecessor ? 'runtime_targets_exhausted' : 'policy_missing', source };
    let selected: { target: ExecutionTarget; runner: RunnerFact; index: number } | undefined;
    for (const candidate of candidates) {
      const result = candidate.reason ? { reason: candidate.reason } : await this.selectRunner(tx, candidate.placement, !!request.node_execution_source);
      if ('reason' in result) {
        unavailable = { status: 'unavailable', reason: result.reason, source, target: candidate.target };
        if (!allowsFallback(result.reason)) break;
      } else {
        selected = { target: candidate.target, runner: result.runner, index: candidate.index };
        break;
      }
    }
    if (!selected) {
      if (continuation) {
        // Owner controls can hold Task/Todo without locking a physically
        // released Runner. Preserve Runner -> scope -> continuation order even
        // when no queue admission will take the scope lock for us.
        if (predecessor!.todo_id) await lockDiscussion(tx, predecessor!.todo_id);
        else await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE', [predecessor!.task_id]);
        const changed = await tx.query(`UPDATE runtime_continuations SET state=$2,reason=$3,last_checked_at=clock_timestamp()
          WHERE predecessor_attempt_id=$1 AND state='prepared'`, [continuation.predecessor_attempt_id, allowsFallback(unavailable.reason) ? 'exhausted' : 'prepared', unavailable.reason]);
        if (!changed.rowCount) throw new CommandError('stale_execution', 'Runtime continuation was superseded during selection');
      }
      return unavailable;
    }
    const { target, runner } = selected;
    const selection_context: NonNullable<QueueInput['selection_context']> = {
      source, configuration_version: predecessor?.selection_context?.configuration_version ?? configurationVersion, target, policy_targets: targets,
      ...(runner.observation!.version ? { observed_version: runner.observation!.version } : {}), request_digest: requestDigest,
    };
    // Capacity and Task locality remain queue concerns. Enqueue only the final
    // choice; a locality error must roll back, never advance policy while
    // holding the Task lock acquired by enqueue.
    const dispatch_id = await this.queue.enqueue(tx, {
      attempt_id: request.attempt_id, task_id: request.task_id, node_id: request.node_id,
      todo_id: request.todo_id, discussion_context: request.discussion_context, task_review_source:request.task_review_source, task_replan_source: request.task_replan_source, task_planning_source: request.task_planning_source, task_conversation_source: request.task_conversation_source, node_execution_source: request.node_execution_source,
      kind: request.kind, expected: request.expected, resource_id: request.resource_id,
      ...(request.legacy_probe ? { legacy_probe: true as const } : {}),
      runtime_chain_root_id: predecessor?.runtime_chain_root_id ?? request.attempt_id, runtime_target_index: selected.index,
      ...(predecessor ? { runtime_predecessor_id: predecessor.id } : {}),
      prompt: request.prompt, source_watermark: request.source_watermark,
      runner_id: runner.id, runtime_id: target.runtime_id as QueueInput['runtime_id'], model: target.model_id!,
      ...(target.thinking_level !== undefined ? { thinking_level: target.thinking_level as QueueInput['thinking_level'] } : {}), selection_context,
    });
    if (continuation) {
      const changed = await tx.query("UPDATE runtime_continuations SET state='queued',reason=NULL,resolved_at=clock_timestamp() WHERE predecessor_attempt_id=$1 AND state='prepared'", [continuation.predecessor_attempt_id]);
      if (!changed.rowCount) throw new CommandError('stale_execution', 'Runtime continuation was superseded before queue admission');
    }
    return { status: 'queued', dispatch_id, runner_id: runner.id, source, target };
  }

  private async selectRunner(tx: Transaction, target: ExecutionTarget, nodeExecution: boolean): Promise<{ runner: RunnerFact } | { reason: SelectionReason }> {
    // The candidate scope is already locked, including every pinned row or
    // the whole Auto set, before reading connection and installation facts.
    const facts = (await tx.query<RunnerFact>(`SELECT r.id,r.incarnation,r.runtime_report_incarnation,
      (r.connected AND r.ready AND r.connection_instance=$2 AND r.last_seen>clock_timestamp()-interval '15 seconds') AS online,
      i.incarnation AS installation_incarnation,i.observation
      FROM runners r LEFT JOIN runtime_installations i ON i.runner_id=r.id AND i.runtime_id=$1
      WHERE ($3::text IS NULL OR r.id=$3) ORDER BY r.id`, [target.runtime_id, this.backendInstance, target.runner_id ?? null])).rows;
    if (!facts.length) return { reason: target.runner_id || nodeExecution ? 'runner_missing' : 'installation_unavailable' };
    const eligible = facts.filter((fact) => issue(fact, target) === null);
    if (!target.runner_id && eligible.length > 1) return { reason: 'ambiguous_auto_placement' };
    if (eligible[0]) return { runner: eligible[0] };
    // One unavailable installation cannot establish objective Auto failure
    // while another Runner is offline or has not supplied current facts.
    const reasons = facts.map((fact) => issue(fact, target));
    return { reason: reasons.find((reason) => reason !== null && !allowsFallback(reason)) ?? reasons[0]! };
  }
}
