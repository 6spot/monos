import { transaction } from '../../../packages/db/src/index.ts';
import type { Database, Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, validate } from '../../../packages/protocol/src/index.ts';
import type { NodeReworkStatus, OwnerCommand, OwnerCommandResult } from '../../../packages/protocol/src/index.ts';
import { authenticateOwner } from './owner-commands.ts';
import { lockConfiguration } from './configuration-guards.ts';
import { derivedTaskState } from './owner-execution.ts';
import { planningEvent } from './task-planning-state.ts';
import { prepareNodeSource } from './node-execution-state.ts';
import { nodeDependenciesReady, serialNodeReady } from './dispatch-queue.ts';
import type { ExecutionNode, NodeTask } from './node-execution-state.ts';
import {
  advanceNodeRework, assertReworkTargetsSettled, checkReworkBasis, reworkOutcome, reworkRequest, reworkSettled, reworkUsage,
} from './node-rework-state.ts';
import type { NodeReworkRequest } from './node-rework-state.ts';

export class NodeRework {
  readonly db: Database;
  private pumping = false;
  constructor(db: Database) { this.db = db; }

  async status(token: string, taskId: string): Promise<NodeReworkStatus> {
    validate('Id', taskId);
    return transaction(this.db, async tx => {
      await authenticateOwner(tx, token);
      const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR SHARE', [taskId])).rows[0];
      if (!task) throw new CommandError('denied_scope', 'Unknown Task');
      const request = (await tx.query<NodeReworkRequest>("SELECT * FROM node_rework_requests WHERE task_id=$1 AND status IN('settling','limit_blocked')", [taskId])).rows[0];
      let eligible = false;
      let waiting = request?.attention ?? null;
      if (request?.status === 'limit_blocked' && await reworkSettled(tx, request)) {
        try { const targets = await checkReworkBasis(tx, task, request); await assertReworkTargetsSettled(tx, task.id, targets.map(x => x.node_id)); eligible = true; }
        catch (error) { if (!(error instanceof CommandError)) throw error; waiting = error.message; }
      }
      const requester = request ? (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1', [request.requester_node_id])).rows[0] : undefined;
      const canContinue = !!request && request.status === 'limit_blocked' && await reworkSettled(tx, request) &&
        task.plan_id === request.plan_id && task.specification_id === request.specification_id && ['RUNNING', 'BLOCKED'].includes(task.state) &&
        requester?.activation === request.requester_activation && requester.execution_source_id === request.requester_source_id &&
        requester.blocker_id === request.blocker_id && !requester.guidance_paused;
      return validate('NodeReworkStatus', { schema_version: 1, task_id: taskId, automatic_requests_used: await reworkUsage(tx, taskId), limit: 3,
        current: request ? { ...await reworkOutcome(tx, request), requester_node_id: request.requester_node_id,
          requester_node_activation: Number(request.requester_activation), reason: request.reason, stop_operation_id: request.stop_operation_id,
          waiting_reason: waiting, can_apply: eligible, can_continue: canContinue } : null });
    });
  }

  async command(token: string, input: unknown): Promise<OwnerCommandResult> {
    const command = validate<OwnerCommand>('OwnerCommand', input);
    if (!['apply_rework', 'continue_without_rework'].includes(command.name)) throw new CommandError('denied_scope', 'Expected a preserved Rework decision');
    const json = canonicalJSON(command), hash = digest(json);
    const payload = command.payload as { rework_request_id: string; expected_version: number; answer?: string };
    return transaction(this.db, async tx => {
      await authenticateOwner(tx, token);
      const replay = async () => {
        const prior = (await tx.query<{ digest: string; response: OwnerCommandResult }>('SELECT digest,response FROM owner_command_receipts WHERE scope_id=$1 AND request_id=$2', [command.scope_id, command.request_id])).rows[0];
        if (prior?.digest !== undefined && prior.digest !== hash) throw new CommandError('payload_conflict', 'Rework decision request content changed');
        return prior?.response;
      };
      const old = await replay();
      if (old) return old;
      const config = await lockConfiguration(tx);
      const candidate = await reworkRequest(tx, command.scope_id, payload.rework_request_id);
      await this.lockRunner(tx, candidate);
      const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [command.scope_id])).rows[0]!;
      const locked = await replay();
      if (locked) return locked;
      const request = await reworkRequest(tx, task.id, candidate.id, true);
      if (Number(task.control_version) !== command.expected_control_version || Number(request.version) !== payload.expected_version)
        throw new CommandError('version_conflict', 'Rework decision capability changed', Number(task.control_version));
      if (request.status !== 'limit_blocked') throw new CommandError('unmet_precondition', 'Only the preserved limit request can receive an Owner decision');
      if (!await reworkSettled(tx, request)) throw new CommandError('unmet_precondition', 'The requesting process and workspace must settle first');
      if (payload.answer !== undefined && !payload.answer.trim()) throw new CommandError('invalid_input', 'Owner direction must be nonblank when supplied');
      const node = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1 FOR UPDATE', [request.requester_node_id])).rows[0]!;
      if (task.plan_id !== request.plan_id || task.specification_id !== request.specification_id || !['RUNNING', 'BLOCKED'].includes(task.state) ||
          node.activation !== request.requester_activation || node.execution_source_id !== request.requester_source_id || node.blocker_id !== request.blocker_id || node.guidance_paused)
        throw new CommandError('version_conflict', 'The preserved requester blocker or execution basis changed');
      await tx.query(`INSERT INTO node_rework_decisions(request_id,task_id,owner_request_id,name,expected_version,answer)
        VALUES($1,$2,$3,$4,$5,$6)`, [request.id, task.id, command.request_id, command.name, request.version, payload.answer]);
      let nextSource: string | undefined;
      if (command.name === 'apply_rework') {
        const targets = await checkReworkBasis(tx, task, request);
        await assertReworkTargetsSettled(tx, task.id, targets.map(x => x.node_id));
        await tx.query("UPDATE node_rework_requests SET status='settling',version=version+1,owner_decision_request_id=$2,attention=NULL WHERE id=$1", [request.id, command.request_id]);
        await advanceNodeRework(tx, task, await reworkRequest(tx, task.id, request.id));
        if ((await reworkRequest(tx, task.id, request.id)).status !== 'applied') throw new CommandError('unmet_precondition', 'Rework application must settle before the Owner decision');
      } else {
        await tx.query("UPDATE node_rework_requests SET status='continued',version=version+1,owner_decision_request_id=$2,attention=NULL WHERE id=$1", [request.id, command.request_id]);
        await tx.query("UPDATE nodes SET state='PENDING',blocker_id=NULL,execution_source_id=NULL WHERE id=$1", [node.id]);
        await tx.query('UPDATE tasks SET control_version=control_version+1,state=$2 WHERE id=$1', [task.id, await derivedTaskState(tx, task.plan_id)]);
        const freshTask = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0]!;
        if (await nodeDependenciesReady(tx, task.plan_id, node.id) && await serialNodeReady(tx, task.id, node.id)) {
          const source = await prepareNodeSource(tx, freshTask, { ...node, state: 'PENDING', blocker_id: null, execution_source_id: null }, config,
            { request_id: command.request_id, recovery: { rework_request_id: request.id, owner_decision: 'continue_without_rework', ...(payload.answer ? { answer: payload.answer } : {}) } });
          nextSource = source.id;
          await tx.query('UPDATE node_rework_requests SET continued_source_id=$2 WHERE id=$1', [request.id, source.id]);
        }
        await planningEvent(tx, task.id, 'node_rework_continued', { rework_request_id: request.id, owner_request_id: command.request_id, ...(payload.answer ? { answer: payload.answer } : {}) });
      }
      const current = await reworkRequest(tx, task.id, request.id);
      const result: OwnerCommandResult = { schema_version: 1, request_id: command.request_id,
        status: 'committed', task_id: task.id,
        control_version: Number((await tx.query('SELECT control_version FROM tasks WHERE id=$1', [task.id])).rows[0].control_version),
        rework_outcome: await reworkOutcome(tx, current), ...(nextSource ? { source_id: nextSource } : {}) };
      validate('OwnerCommandResult', result);
      await tx.query('INSERT INTO owner_command_receipts(scope_id,request_id,digest,envelope_json,response) VALUES($1,$2,$3,$4,$5)', [task.id, command.request_id, hash, json, result]);
      return result;
    });
  }

  private async lockRunner(tx: Transaction, request: NodeReworkRequest): Promise<void> {
    await tx.query('SELECT id FROM runners WHERE id=(SELECT runner_id FROM attempts WHERE id=$1) FOR UPDATE', [request.requester_attempt_id]);
  }

  async pump(limit = 8): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const rows = (await this.db.pool.query<NodeReworkRequest>("SELECT * FROM node_rework_requests WHERE status='settling' ORDER BY last_checked_at,created_at,id LIMIT $1", [limit])).rows;
      for (const row of rows) await transaction(this.db, async tx => {
        await lockConfiguration(tx);
        await this.lockRunner(tx, row);
        const task = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [row.task_id])).rows[0]!;
        const current = await reworkRequest(tx, task.id, row.id, true);
        if (current.status !== 'settling') return;
        await tx.query('UPDATE node_rework_requests SET last_checked_at=clock_timestamp() WHERE id=$1', [row.id]);
        await advanceNodeRework(tx, task, current);
      });
    } finally { this.pumping = false; }
  }
}
