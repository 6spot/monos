import { assertSpecificationUnfrozen } from './task-specification-state.ts';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate, workspaceId } from '../../../packages/protocol/src/index.ts';
import type { Dispatch, TaskPlanningSource, NodeExecutionSource, TaskConversationSource } from '../../../packages/protocol/src/index.ts';
import { assertCurrentNode } from './task-records.ts';
import type { ControlBasis } from './task-records.ts';
import { lockDiscussion } from './discussion-state.ts';
import type { DiscussionContext } from './discussion-state.ts';
import { assertPlanningSource } from './task-planning-state.ts';
import { assertNodeSource } from './node-execution-state.ts';
import { assertConversationSource } from './task-conversation-state.ts';
import { lockConfiguration } from './configuration-guards.ts';

export interface QueueInput {
  attempt_id: string; runner_id: string; task_id?: string; todo_id?: string; node_id?: string;
  kind: 'node' | 'planner'; expected: ControlBasis | { control_version: number }; resource_id?: string;
  discussion_context?: DiscussionContext;
  task_planning_source?: TaskPlanningSource;
  task_conversation_source?: TaskConversationSource;
  node_execution_source?: NodeExecutionSource;
  legacy_probe?: true; // Internal fixture admission only; never copied to wire data.
  runtime_id: Dispatch['runtime_id']; model: Dispatch['model']; prompt: string; source_watermark: number;
  selection_context?: {
    source: 'explicit' | 'planner' | 'role' | 'global'; configuration_version: number;
    target: { runtime_id: string; runner_id?: string; model_id?: string; thinking_level?: string };
    observed_version?: string; request_digest: string;
  };
}
export type TaskQueueInput = QueueInput & { task_id: string; expected: ControlBasis };
interface Queued { planning_intent_id: string | null; id: string; task_id: string | null; todo_id: string | null; node_id: string | null; owner_key: string; state: string; launch: Dispatch; specification_id: string; plan_id: string | null; selection_context: QueueInput['selection_context'] | null }

export class DispatchQueue {
  readonly db: Database;
  readonly hooks: { beforeCommit?: () => void; afterCommit?: () => void };
  constructor(db: Database, hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {}) { this.db = db; this.hooks = hooks; }

  // The owning command authenticates and writes its receipt with this durable
  // selected Attempt. This method does not select a model or initiate a process.
  async enqueue(tx: Transaction, input: QueueInput): Promise<string> {
    if (input.todo_id !== undefined) return this.enqueueTodo(tx, input);
    if (!input.task_id || !('specification_id' in input.expected)) throw new CommandError('invalid_input', 'Task queue requires its exact revision basis');
    const configurationVersion = await lockConfiguration(tx);
    for (const id of [input.attempt_id, input.runner_id, input.task_id]) validate('Id', id);
    const hash = digest(canonicalJSON(input));
    const runner = await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [input.runner_id]);
    if (!runner.rowCount) throw new CommandError('denied_scope', 'Unknown Runner');
    const task = (await tx.query<{ state: string; control_version: string; specification_id: string; plan_id: string | null; project_id: string | null }>('SELECT state,control_version,specification_id,plan_id,project_id FROM tasks WHERE id=$1 FOR UPDATE', [input.task_id])).rows[0];
    if (!task) throw new CommandError('denied_scope', 'Unknown Task');
    if(!input.task_conversation_source)await assertSpecificationUnfrozen(tx,input.task_id);
    if (input.task_conversation_source) {
      if(input.kind!=='planner'||input.legacy_probe||input.node_id||input.resource_id||input.task_planning_source||input.node_execution_source)throw new CommandError('denied_scope','Conversation source requires scratch-only Planner');
      await assertConversationSource(tx,input.task_id,input.task_conversation_source,input.attempt_id,input.prompt);
    }
    if (input.task_planning_source) {
      if (input.kind !== 'planner' || input.legacy_probe || input.node_id || input.resource_id || input.source_watermark !== 0) throw new CommandError('denied_scope', 'Planning source requires a repository-free Task Planner');
      await assertPlanningSource(tx, input.task_id, input.task_planning_source, input.attempt_id, input.prompt);
    }
    if (input.node_execution_source) {
      if(input.kind !== 'node' || input.legacy_probe || input.task_planning_source || input.node_id !== input.node_execution_source.node_id) throw new CommandError('denied_scope','Canonical Node source mismatch');
      await assertNodeSource(tx,input.task_id,input.node_execution_source,input.attempt_id,input.prompt);
    }
    const existing = (await tx.query<{ queue_digest: string; dispatch_id: string }>('SELECT queue_digest,dispatch_id FROM attempts WHERE id=$1', [input.attempt_id])).rows[0];
    if (existing) {
      if (existing.queue_digest !== hash) throw new CommandError('payload_conflict', 'Queued Attempt identity has different content');
      return existing.dispatch_id;
    }
    if (!input.task_conversation_source && task.state !== 'RUNNING') throw new CommandError('unmet_precondition', 'Task is not executing');
    if (input.legacy_probe ? !input.resource_id : !task.project_id || input.resource_id !== undefined) throw new CommandError('denied_scope', 'Canonical Task requires its Project and no fixture resource');
    if (!input.task_conversation_source && (Number(task.control_version) !== input.expected.control_version || task.specification_id !== input.expected.specification_id || task.plan_id !== input.expected.plan_id)) throw new CommandError('version_conflict', 'Queue input revision basis changed');
    await this.checkLocality(tx, input.task_id, input.runner_id);
    let activation = 0;
    if (input.kind === 'node') {
      if (!input.node_id) throw new CommandError('invalid_input', 'Node owner required');
      const node = (await tx.query<{ activation: string }>('SELECT activation FROM nodes WHERE id=$1 AND task_id=$2', [input.node_id, input.task_id])).rows[0];
      if (!node) throw new CommandError('denied_scope', 'Node belongs to another Task');
      activation = Number(node.activation);
      if ((await assertCurrentNode(tx, { task_id: input.task_id, node_id: input.node_id, node_activation: activation })).state !== 'PENDING') throw new CommandError('unmet_precondition', 'Node is not pending');
      if (!(await this.dependenciesReady(tx, input.expected.plan_id!, input.node_id))) throw new CommandError('unmet_precondition', 'Upstream results are not current');
    } else if (input.node_id) throw new CommandError('invalid_input', 'Planner is not a Node');
    const owner = input.kind === 'node' ? `node:${input.node_id}` : `planner:${input.task_id}`;
    if ((await tx.query("SELECT id FROM attempts WHERE owner_key=$1 AND state='QUEUED'", [owner])).rowCount) throw new CommandError('unmet_precondition', 'Owner already has selected queued work');
    const frozenReservations = input.node_execution_source ? (await tx.query<{context:{workspace_reservations: NonNullable<Dispatch['workspace_reservations']>}}>('SELECT context FROM node_execution_outbox WHERE id=$1',[input.node_execution_source.source_id])).rows[0]!.context.workspace_reservations : undefined;
    const launch: Dispatch = {
      dispatch_id: randomUUID(), attempt_id: input.attempt_id, runner_id: input.runner_id,
      task_id: input.task_id, ...(input.node_id ? { node_id: input.node_id } : {}), kind: input.kind,
      fencing_generation: 1, node_activation: activation, control_version: input.expected.control_version,
      ...(input.legacy_probe ? { resource_id: input.resource_id! } : { workspace_reservations: frozenReservations ?? {
        project_id: task.project_id!, configuration_version: configurationVersion,
        resources: input.kind === 'planner' ? [] : (await tx.query<{ id: string }>('SELECT id FROM project_resources WHERE project_id=$1 AND active ORDER BY id', [task.project_id])).rows.map((row) => ({ resource_id: row.id, workspace_id: workspaceId(input.task_id!, row.id) })),
      } }), runtime_id: input.runtime_id, model: input.model,
      prompt: input.prompt, source_watermark: input.source_watermark, log_mode: 'ordered_v1',
      ...(input.task_conversation_source ? {task_conversation_source:input.task_conversation_source} : {}),
      ...(input.task_planning_source ? { task_planning_source: input.task_planning_source } : {}),
      ...(input.node_execution_source ? { node_execution_source: input.node_execution_source } : {}),
      mutation_allowed: false, process_released: true,
    };
    validate('Dispatch', launch);
    await tx.query(`INSERT INTO attempts(id,runner_id,task_id,node_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,
      launch,mutation_allowed,process_released,state,queue_digest,specification_id,plan_id,selection_context,planning_intent_id,node_execution_source_id,task_conversation_source_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,false,true,'QUEUED',$10,$11,$12,$13,$14,$15,$16)`,
    [input.attempt_id, input.runner_id, input.task_id, input.node_id ?? null, owner, launch.dispatch_id, input.kind, activation, launch, hash, task.specification_id, task.plan_id, input.selection_context ?? null, input.task_planning_source?.intent_id ?? null,input.node_execution_source?.source_id ?? null,input.task_conversation_source?.source_id ?? null]);
    if(input.node_execution_source) await tx.query("UPDATE nodes SET state='RUNNING' WHERE id=$1",[input.node_id]);
    if (input.legacy_probe) await tx.query('INSERT INTO legacy_probe_attempts(attempt_id) VALUES($1)', [input.attempt_id]);
    return launch.dispatch_id;
  }

  private async enqueueTodo(tx: Transaction, input: QueueInput): Promise<string> {
    for (const id of [input.attempt_id, input.runner_id, input.todo_id]) validate('Id', id);
    if (input.task_conversation_source || input.node_execution_source || input.task_planning_source || input.task_id || input.node_id || input.resource_id || input.kind !== 'planner' || !input.discussion_context) throw new CommandError('invalid_input', 'Todo Planner must have one repository-free scope');
    const context = input.discussion_context; const hash = digest(canonicalJSON(input));
    if (!(await tx.query('SELECT id FROM runners WHERE id=$1 FOR UPDATE', [input.runner_id])).rowCount) throw new CommandError('denied_scope', 'Unknown Runner');
    const control = await lockDiscussion(tx, input.todo_id!);
    const prior = (await tx.query<{ queue_digest: string; dispatch_id: string }>('SELECT queue_digest,dispatch_id FROM attempts WHERE id=$1', [input.attempt_id])).rows[0];
    if (prior) { if (prior.queue_digest !== hash) throw new CommandError('payload_conflict', 'Queued Attempt content changed'); return prior.dispatch_id; }
    if (control.source_message_id !== context.source_message_id || Number(control.version) !== input.expected.control_version || context.discussion_version !== Number(control.version)) throw new CommandError('version_conflict', 'Discussion input intent changed');
    if (control.desired_attempt_id) throw new CommandError('unmet_precondition', 'Discussion input already selected');
    const owner = `todo-planner:${input.todo_id}`;
    if ((await tx.query("SELECT 1 FROM attempts WHERE owner_key=$1 AND state='QUEUED'", [owner])).rowCount) throw new CommandError('unmet_precondition', 'Todo already has queued work');
    const launch: Dispatch = { dispatch_id: randomUUID(), attempt_id: input.attempt_id, runner_id: input.runner_id, todo_id: input.todo_id,
      kind: 'planner', fencing_generation: 1, node_activation: 0, control_version: Number(control.version), source_message_id: context.source_message_id,
      project_context_version: context.project_context_version, project_context_digest: context.project_context_digest,
      runtime_id: input.runtime_id, model: input.model, prompt: input.prompt, source_watermark: input.source_watermark,
      log_mode: 'ordered_v1', mutation_allowed: false, process_released: true };
    validate('Dispatch', launch);
    await tx.query(`INSERT INTO attempts(id,runner_id,todo_id,owner_key,dispatch_id,kind,fencing_generation,node_activation,launch,
      mutation_allowed,process_released,state,queue_digest,selection_context,discussion_context)
      VALUES($1,$2,$3,$4,$5,'planner',1,0,$6,false,true,'QUEUED',$7,$8,$9)`, [input.attempt_id, input.runner_id, input.todo_id, owner, launch.dispatch_id, launch, hash, input.selection_context ?? null, context]);
    await tx.query('UPDATE todo_discussion_controls SET desired_attempt_id=$2,waiting_reason=NULL WHERE todo_id=$1', [input.todo_id, input.attempt_id]);
    return launch.dispatch_id;
  }

  private async checkLocality(tx: Transaction, taskId: string, runnerId: string) {
    if ((await tx.query(`SELECT runner_id FROM task_runner_locality WHERE task_id=$1 AND runner_id<>$2
      UNION SELECT runner_id FROM attempts a WHERE task_id=$1 AND runner_id<>$2
        AND (queue_digest IS NULL OR EXISTS (SELECT 1 FROM outbox o WHERE o.attempt_id=a.id AND o.kind='start'))`, [taskId, runnerId])).rowCount) throw new CommandError('unmet_precondition', 'Task workspace belongs to another Runner; transfer is unsupported');
  }

  private async dependenciesReady(tx: Transaction, planId: string, nodeId: string): Promise<boolean> {
    const missing = await tx.query(`SELECT dependency FROM plan_nodes pn,
      jsonb_array_elements_text(pn.definition->'dependencies') dependency
      WHERE pn.plan_id=$1 AND pn.node_id=$2 AND NOT EXISTS (
        SELECT 1 FROM nodes n JOIN node_completions c ON c.node_id=n.id AND c.activation=n.activation
        JOIN plan_nodes member ON member.plan_id=pn.plan_id AND member.node_id=n.id
        WHERE n.id=dependency AND n.state='COMPLETED')`, [planId, nodeId]);
    return !missing.rowCount;
  }

  async promoteNext(runnerId: string, connectionInstance: string, incarnation: number): Promise<Dispatch | null> {
    const retry = Symbol('cancelled queued candidate');
    // A stale row must not consume a whole Runner poll. Bound cleanup work per
    // poll and commit each cancellation before taking another Task lock.
    for (let scanned = 0; scanned < 16; scanned++) {
      const result = await transaction(this.db, async (tx) => {
        const runner = (await tx.query<{ capacity: number; available: boolean; runtime_report_incarnation: string | null }>("SELECT capacity,runtime_report_incarnation,(connected AND ready AND connection_instance=$2 AND incarnation=$3 AND last_seen>now()-interval '15 seconds') AS available FROM runners WHERE id=$1 FOR UPDATE", [runnerId, connectionInstance, incarnation])).rows[0];
        if (!runner?.available) return null;
        const count = (await tx.query<{ count: string }>('SELECT count(*) FROM attempts WHERE runner_id=$1 AND NOT process_released', [runnerId])).rows[0]!;
        if (Number(count.count) >= runner.capacity) return null;
        // Filter unresolved owners before LIMIT. Hold at most one Task lock in this
        // transaction, avoiding cross-Runner lock inversion while skipping waiters.
        // Stage A serializes Node writers for a Task until parallel worktrees exist.
        const candidates = (await tx.query<Queued>(`SELECT q.* FROM attempts q WHERE q.runner_id=$1 AND q.state='QUEUED'
          AND (q.selection_context IS NULL OR $3::boolean OR EXISTS (SELECT 1 FROM runtime_installations i
            WHERE i.runner_id=q.runner_id AND i.runtime_id=(q.launch->>'runtime_id') AND i.incarnation=$2))
          AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.id<>q.id
            AND (a.owner_key=q.owner_key OR (a.task_id=q.task_id AND a.kind='node' AND q.kind='node'))
            AND (NOT a.process_released OR EXISTS (SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled'))))
          AND (q.task_conversation_source_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM workspace_leases l WHERE l.task_id=q.task_id AND l.state<>'released'))
          ORDER BY CASE WHEN q.kind='planner' THEN 0 ELSE 1 END,q.created_at,q.id LIMIT 1`, [runnerId, incarnation, Number(runner.runtime_report_incarnation) === incarnation])).rows;
        for (const candidate of candidates) {
          const discussion = candidate.todo_id ? await lockDiscussion(tx, candidate.todo_id) : null;
          const task = candidate.task_id ? (await tx.query<{ state: string; control_version: string; specification_id: string; plan_id: string | null }>('SELECT state,control_version,specification_id,plan_id FROM tasks WHERE id=$1 FOR UPDATE', [candidate.task_id])).rows[0]! : null;
          const row = (await tx.query<Queued>('SELECT * FROM attempts WHERE id=$1 FOR UPDATE', [candidate.id])).rows[0]!;
          if (row.state !== 'QUEUED') return retry;
          let current = discussion ? Number(discussion.version) === row.launch.control_version && discussion.source_message_id === row.launch.source_message_id && discussion.desired_attempt_id === row.id : !!task && task.state === 'RUNNING' && Number(task.control_version) === row.launch.control_version && task.specification_id === row.specification_id && task.plan_id === row.plan_id;
          if(row.launch.task_conversation_source){try{await assertConversationSource(tx,row.task_id!,row.launch.task_conversation_source,row.id,row.launch.prompt);current=true;}catch(e){if(!(e instanceof CommandError))throw e;current=false;}}
          if (current && (row.planning_intent_id || row.launch.task_planning_source)) {
            try {
              if (!row.launch.task_planning_source || row.planning_intent_id !== row.launch.task_planning_source.intent_id) throw new CommandError('stale_execution', 'Planning source differs');
              await assertPlanningSource(tx, row.task_id!, row.launch.task_planning_source, row.id, row.launch.prompt);
            } catch (error) { if (!(error instanceof CommandError)) throw error; current = false; }
          }
          if(current && row.task_id && !row.launch.task_conversation_source){try{await assertSpecificationUnfrozen(tx,row.task_id);}catch(error){if(!(error instanceof CommandError))throw error;current=false;}}
          if(current && row.launch.node_execution_source) {try { await assertNodeSource(tx,row.task_id!,row.launch.node_execution_source,row.id,row.launch.prompt); } catch(error){if(!(error instanceof CommandError))throw error;current=false;} }
          if (current && row.node_id) {
            try { current = (await assertCurrentNode(tx, { task_id: row.task_id!, node_id: row.node_id, node_activation: row.launch.node_activation })).state === (row.launch.node_execution_source ? 'RUNNING' : 'PENDING') && await this.dependenciesReady(tx, row.plan_id!, row.node_id); }
            catch (error) { if (!(error instanceof CommandError)) throw error; current = false; }
          }
          if (!current) { await tx.query("UPDATE attempts SET state='CANCELLED',process_absent=true,end_reason='stale_queue_basis' WHERE id=$1", [row.id]); return retry; }
          if (row.selection_context) {
            const observed = (await tx.query<{ incarnation: string; observation: { availability: string; supports_model: boolean } }>('SELECT incarnation,observation FROM runtime_installations WHERE runner_id=$1 AND runtime_id=$2', [runnerId, row.launch.runtime_id])).rows[0];
            // An omitted discovery report after reconnect is not evidence that the
            // installation vanished. Wait until the current incarnation reports.
            if (!observed || Number(observed.incarnation) !== incarnation) {
              if (Number(runner.runtime_report_incarnation) !== incarnation) continue;
              await tx.query("UPDATE attempts SET state='CANCELLED',process_absent=true,end_reason='runtime_missing_before_start' WHERE id=$1", [row.id]);
              return retry;
            }
            if (observed.observation.availability !== 'detected' || !observed.observation.supports_model) {
              await tx.query("UPDATE attempts SET state='CANCELLED',process_absent=true,end_reason='runtime_unavailable_before_start' WHERE id=$1", [row.id]);
              return retry;
            }
          }
          const owner = await tx.query(`SELECT a.id FROM attempts a WHERE a.owner_key=$1 AND a.id<>$2 AND
            (NOT a.process_released OR EXISTS (SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))`, [row.owner_key, row.id]);
          if (owner.rowCount) continue;
          try { if (row.task_id) await this.checkLocality(tx, row.task_id, runnerId); }
          catch (error) {
            if (!(error instanceof CommandError)) throw error;
            await tx.query("UPDATE attempts SET state='CANCELLED',process_absent=true,end_reason='unsupported_runner_transfer' WHERE id=$1", [row.id]);
            return retry;
          }
          if (row.task_id) await tx.query('INSERT INTO task_runner_locality(task_id,runner_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [row.task_id, runnerId]);
          const fence = (await tx.query<{ generation: string }>("SELECT COALESCE(max(fencing_generation),0)+1 AS generation FROM attempts WHERE owner_key=$1 AND state<>'QUEUED'", [row.owner_key])).rows[0]!;
          const launch = { ...row.launch, fencing_generation: Number(fence.generation), mutation_allowed: true, process_released: false };
          validate('Dispatch', launch);
          await tx.query("UPDATE attempts SET state='RUNNING',mutation_allowed=true,process_released=false,fencing_generation=$2,launch=$3 WHERE id=$1", [row.id, launch.fencing_generation, launch]);
          if (row.node_id) await tx.query("UPDATE nodes SET state='RUNNING' WHERE id=$1", [row.node_id]);
          await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind) VALUES($1,$2,$3,'start')", [randomUUID(), runnerId, row.id]);
          this.hooks.beforeCommit?.();
          return launch;
        }
        return null;
      });
      this.hooks.afterCommit?.();
      if (result !== retry) return result;
    }
    return null;
  }
}
