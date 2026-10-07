import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { ExecutionPolicy, ExecutionTarget, PolicyConfiguration, RuntimeInstallation } from '../../../packages/protocol/src/index.ts';
import { lockConfiguration } from './configuration-guards.ts';
import type { DispatchQueue, QueueInput } from './dispatch-queue.ts';

const supportedModel = 'opencode/longcat-2.5-preview-free';
type Source = 'explicit' | 'planner' | 'role' | 'global';
export type SelectionReason = 'policy_missing' | 'role_missing' | 'unsupported_runtime' | 'unsupported_model' |
  'unsupported_thinking' | 'runner_missing' | 'runner_offline' | 'installation_stale' |
  'installation_unavailable' | 'model_control_unavailable' | 'ambiguous_auto_placement';
export type SchedulingRequest = Omit<QueueInput, 'runner_id' | 'runtime_id' | 'model' | 'selection_context'> & {
  role_id?: string; explicit_target?: ExecutionTarget;
};
export type SchedulingResult =
  | { status: 'queued'; dispatch_id: string; runner_id: string; source: Source; target: ExecutionTarget }
  | { status: 'unavailable'; reason: SelectionReason; source?: Source; target?: ExecutionTarget };

interface RunnerFact {
  id: string; incarnation: string; online: boolean; runtime_report_incarnation: string | null;
  installation_incarnation: string | null; observation: RuntimeInstallation | null;
}

function issue(fact: RunnerFact): SelectionReason | null {
  if (!fact.online) return 'runner_offline';
  if (!fact.observation || Number(fact.installation_incarnation) !== Number(fact.incarnation))
    return Number(fact.runtime_report_incarnation) === Number(fact.incarnation) ? 'installation_unavailable' : 'installation_stale';
  if (fact.observation.availability !== 'detected') return 'installation_unavailable';
  if (!fact.observation.supports_model) return 'model_control_unavailable';
  return null;
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

    const policies = (await tx.query<{ policies: PolicyConfiguration }>('SELECT policies FROM execution_policies')).rows[0]!.policies;
    let rolePolicy: ExecutionPolicy | null = null;
    if (request.kind === 'node' && request.role_id) {
      const role = (await tx.query<{ execution_policy: ExecutionPolicy | null }>('SELECT execution_policy FROM roles WHERE id=$1', [request.role_id])).rows[0];
      if (!role) return { status: 'unavailable', reason: 'role_missing' };
      rolePolicy = role.execution_policy;
    }
    const source: Source = request.explicit_target ? 'explicit' :
      request.kind === 'planner' && policies.planner ? 'planner' :
        request.kind === 'node' && rolePolicy ? 'role' : 'global';
    const target = request.explicit_target ?? (source === 'planner' ? policies.planner : source === 'role' ? rolePolicy : policies.global)?.default_target;
    if (!target) return { status: 'unavailable', reason: 'policy_missing', source };
    // The current adapter pins both the runtime and model. In particular, an
    // absent model cannot be interpreted as the approved model implicitly.
    if (target.runtime_id !== 'opencode') return { status: 'unavailable', reason: 'unsupported_runtime', source, target };
    if (target.model_id !== supportedModel) return { status: 'unavailable', reason: 'unsupported_model', source, target };
    if (target.thinking_level !== undefined) return { status: 'unavailable', reason: 'unsupported_thinking', source, target };

    // Auto must see one stable Runner set through queue admission. EXCLUSIVE
    // waits for the ROW SHARE table lock taken by connect/touch's FOR UPDATE.
    // SHARE ROW EXCLUSIVE would permit their row lock, then block their UPDATE
    // while Auto waits for that row, forming a deadlock. Pinned targets only
    // need their row lock.
    if (!target.runner_id) await tx.query('LOCK TABLE runners IN EXCLUSIVE MODE');

    const facts = (await tx.query<RunnerFact>(`SELECT r.id,r.incarnation,r.runtime_report_incarnation,
      (r.connected AND r.ready AND r.connection_instance=$2 AND r.last_seen>clock_timestamp()-interval '15 seconds') AS online,
      i.incarnation AS installation_incarnation,i.observation
      FROM runners r LEFT JOIN runtime_installations i ON i.runner_id=r.id AND i.runtime_id=$1
      WHERE ($3::text IS NULL OR r.id=$3) ORDER BY r.id`, [target.runtime_id, this.backendInstance, target.runner_id ?? null])).rows;
    if (!facts.length) return { status: 'unavailable', reason: target.runner_id || request.node_execution_source ? 'runner_missing' : 'installation_unavailable', source, target };
    const eligible = facts.filter((fact) => issue(fact) === null);
    if (!target.runner_id && eligible.length > 1) return { status: 'unavailable', reason: 'ambiguous_auto_placement', source, target };
    const chosen = eligible[0];
    if (!chosen) return { status: 'unavailable', reason: issue(facts[0]!)!, source, target };

    // Recheck after taking the same Runner row lock used by connection reports
    // and queue promotion. The configuration share lock still protects policy.
    const locked = (await tx.query<RunnerFact>(`SELECT r.id,r.incarnation,r.runtime_report_incarnation,
      (r.connected AND r.ready AND r.connection_instance=$2 AND r.last_seen>clock_timestamp()-interval '15 seconds') AS online,
      i.incarnation AS installation_incarnation,i.observation
      FROM runners r LEFT JOIN runtime_installations i ON i.runner_id=r.id AND i.runtime_id=$1
      WHERE r.id=$3 FOR UPDATE OF r`, [target.runtime_id, this.backendInstance, chosen.id])).rows[0]!;
    const changed = issue(locked);
    if (changed) return { status: 'unavailable', reason: changed, source, target };
    const selection_context: NonNullable<QueueInput['selection_context']> = {
      source, configuration_version: configurationVersion, target,
      ...(locked.observation!.version ? { observed_version: locked.observation!.version } : {}), request_digest: requestDigest,
    };
    const dispatch_id = await this.queue.enqueue(tx, {
      attempt_id: request.attempt_id, task_id: request.task_id, node_id: request.node_id,
      todo_id: request.todo_id, discussion_context: request.discussion_context, task_review_source:request.task_review_source, task_replan_source: request.task_replan_source, task_planning_source: request.task_planning_source, task_conversation_source: request.task_conversation_source, node_execution_source: request.node_execution_source,
      kind: request.kind, expected: request.expected, resource_id: request.resource_id,
      ...(request.legacy_probe ? { legacy_probe: true as const } : {}),
      prompt: request.prompt, source_watermark: request.source_watermark,
      runner_id: chosen.id, runtime_id: 'opencode', model: supportedModel, selection_context,
    });
    return { status: 'queued', dispatch_id, runner_id: chosen.id, source, target };
  }
}
