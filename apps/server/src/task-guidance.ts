import { remoteItemQuiescent } from './remote-preparation-state.ts';
import { specificationFrozen } from './task-specification-state.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { digest } from '../../../packages/protocol/src/index.ts';
import type { TaskTurnRouting, EffectResult } from '../../../packages/protocol/src/index.ts';
import type { ConversationTask } from './task-conversation-state.ts';
import type { AttemptRow } from './service.ts';
import type { NodeTask, ExecutionNode } from './node-execution-state.ts';
import { prepareNodeSource } from './node-execution-state.ts';
import { admitWorkspaceEffect } from './workspaces.ts';
import { reactivateSettledNodes } from './task-records.ts';
import { planningEvent } from './task-planning-state.ts';

export async function bindTaskGuidance(
  tx: Transaction,
  taskId: string,
  nodeId: string,
  activation: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO task_guidance_obligations(id,task_id,guidance_id,node_id,node_activation)
    SELECT gen_random_uuid()::text,g.task_id,g.id,$2,$3 FROM task_guidance g WHERE g.task_id=$1 AND g.status='active' AND (g.node_id IS NULL OR g.node_id=$2 OR EXISTS(SELECT 1 FROM replan_guidance_applicability a WHERE a.task_id=$1 AND a.guidance_id=g.id AND a.node_id=$2)) ON CONFLICT(guidance_id,node_id,node_activation) DO NOTHING`,
    [taskId, nodeId, activation],
  );
}
export async function guidanceContext(tx: Transaction, taskId: string, nodeId: string, activation: number) {
  await bindTaskGuidance(tx, taskId, nodeId, activation);
  const rows = (
    await tx.query<{
      guidance_id: string;
      obligation_id: string;
      text: string;
      content_digest: string;
      input_id: string;
    }>(
      `SELECT g.id guidance_id,o.id obligation_id,g.text,g.content_digest,g.input_id FROM task_guidance g JOIN task_guidance_obligations o ON o.guidance_id=g.id WHERE g.task_id=$1 AND o.node_id=$2 AND o.node_activation=$3 AND g.status='active' AND o.status IN ('pending','handled') ORDER BY g.id LIMIT 257`,
      [taskId, nodeId, activation],
    )
  ).rows;
  if (rows.length > 256) throw new CommandError('unmet_precondition', 'Guidance context exceeds budget');
  return { items: rows, required_guidance_ids: rows.map((r) => r.guidance_id) };
}
export async function assignGuidance(
  tx: Transaction,
  sourceId: string,
  items: { guidance_id: string; obligation_id: string }[],
): Promise<void> {
  for (const item of items)
    await tx.query(
      'INSERT INTO task_guidance_assignments(source_id,obligation_id,guidance_id) VALUES($1,$2,$3)',
      [sourceId, item.obligation_id, item.guidance_id],
    );
}
export async function validateHandledGuidance(
  tx: Transaction,
  sourceId: string,
  ids: string[],
): Promise<void> {
  const assigned = (
    await tx.query<{ guidance_id: string; required: boolean }>(
      `SELECT a.guidance_id,(g.status='active' AND o.status='pending') required FROM task_guidance_assignments a JOIN task_guidance g ON g.id=a.guidance_id JOIN task_guidance_obligations o ON o.id=a.obligation_id WHERE a.source_id=$1`,
      [sourceId],
    )
  ).rows;
  if (ids.length > 256 || new Set(ids).size !== ids.length)
    throw new CommandError('invalid_input', 'Guidance IDs must be unique and bounded');
  if (ids.some((id) => !assigned.some((a) => a.guidance_id === id)))
    throw new CommandError('denied_scope', 'Handled guidance must belong to this frozen source');
  if (assigned.some((a) => a.required && !ids.includes(a.guidance_id)))
    throw new CommandError(
      'unmet_precondition',
      'Required launch guidance is not declared handled; correct the payload or block_node',
    );
}
export async function settleHandledGuidance(
  tx: Transaction,
  sourceId: string,
  operationId: string,
  ids: string[],
): Promise<void> {
  await tx.query(
    `UPDATE task_guidance_obligations o SET status='handled',version=o.version+1,completion_operation_id=$2 FROM task_guidance_assignments a,task_guidance g WHERE a.source_id=$1 AND a.obligation_id=o.id AND g.id=a.guidance_id AND a.guidance_id=ANY($3::text[]) AND g.status='active' AND o.status='pending'`,
    [sourceId, operationId, ids],
  );
}
async function stopGuidanceNode(tx: Transaction, node: ExecutionNode, taskId: string): Promise<void> {
  if (!node.execution_source_id) return;
  const attempt = (
    await tx.query<AttemptRow>(
      'SELECT a.* FROM attempts a JOIN node_execution_outbox s ON s.planned_attempt_id=a.id WHERE s.id=$1 FOR UPDATE OF a',
      [node.execution_source_id],
    )
  ).rows[0];
  // An admitted completion owns its terminal handoff, including hard recovery.
  if (
    attempt &&
    (
      await tx.query(
        "SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='complete_node' AND state<>'cancelled'",
        [attempt.id],
      )
    ).rowCount
  )
    return;
  await tx.query('UPDATE node_execution_outbox SET done=true WHERE id=$1', [node.execution_source_id]);
  if (!attempt) return;
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  if (attempt.state === 'QUEUED')
    await tx.query(
      "UPDATE attempts SET state='CANCELLED',mutation_allowed=false,process_absent=true,end_reason='guidance_followup' WHERE id=$1",
      [attempt.id],
    );
  else if (attempt.mutation_allowed) {
    await tx.query(
      "UPDATE attempts SET mutation_allowed=false,state='CANCELLED',end_reason='guidance_followup' WHERE id=$1",
      [attempt.id],
    );
    const prior = (
      await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND kind='stop'", [attempt.id])
    ).rowCount;
    if (!attempt.process_released && !prior) await admitWorkspaceEffect(tx, attempt, 'stop', randomUUID());
  }
  await planningEvent(
    tx,
    taskId,
    'guidance_followup_requested',
    {
      node_id: node.id,
      node_activation: Number(node.activation),
      source_id: node.execution_source_id,
    },
    attempt.id,
  );
}
// Owner withdrawal changes only this instruction. If its prompt still owns an
// unfinished writer, retain deterministic continuation after removing the prompt.
export async function withdrawGuidance(tx: Transaction, taskId: string, guidanceId: string): Promise<void> {
  await tx.query("UPDATE task_guidance SET status='withdrawn',version=version+1 WHERE id=$1", [guidanceId]);
  await tx.query(
    "UPDATE task_guidance_obligations SET status='withdrawn',version=version+1 WHERE guidance_id=$1 AND status='pending'",
    [guidanceId],
  );
  await tx.query(
    "UPDATE task_guidance_followups SET status='cancelled' WHERE obligation_id IN (SELECT id FROM task_guidance_obligations WHERE guidance_id=$1) AND status='waiting' AND (node_id IN (SELECT id FROM nodes WHERE state='COMPLETED') OR EXISTS(SELECT 1 FROM node_execution_outbox s JOIN operations op ON op.attempt_id=s.planned_attempt_id WHERE s.id=task_guidance_followups.source_id AND op.kind='complete_node' AND op.state<>'cancelled'))",
    [guidanceId],
  );
  const nodes = (
    await tx.query<ExecutionNode>(
      `SELECT n.* FROM nodes n JOIN task_guidance_assignments a ON a.source_id=n.execution_source_id WHERE n.task_id=$1 AND a.guidance_id=$2 AND n.state IN ('PENDING','RUNNING') FOR UPDATE OF n`,
      [taskId, guidanceId],
    )
  ).rows;
  for (const node of nodes) {
    if (
      (
        await tx.query(
          "SELECT 1 FROM node_execution_outbox s JOIN operations op ON op.attempt_id=s.planned_attempt_id WHERE s.id=$1 AND op.kind='complete_node' AND op.state<>'cancelled'",
          [node.execution_source_id],
        )
      ).rowCount
    )
      continue;
    await tx.query(
      `INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) SELECT obligation_id,$2,$3,$4,$1 FROM task_guidance_assignments WHERE source_id=$1 AND guidance_id=$5 ON CONFLICT(obligation_id) DO UPDATE SET status='waiting',source_id=EXCLUDED.source_id`,
      [node.execution_source_id, taskId, node.id, node.activation, guidanceId],
    );
    await stopGuidanceNode(tx, node, taskId);
  }
}
export async function routeTaskInput(
  tx: Transaction,
  task: ConversationTask,
  inputId: string,
  routing: TaskTurnRouting,
): Promise<Pick<EffectResult, 'obligation_id'>> {
  if (routing.kind === 'reply' || routing.kind === 'reply_only') return {};
  const basis = routing.basis;
  if (
    !basis ||
    basis.control_version !== Number(task.control_version) ||
    basis.specification_id !== task.specification_id ||
    basis.plan_id !== task.plan_id
  )
    throw new CommandError(
      'version_conflict',
      'Action requires current Task execution basis',
      Number(task.control_version),
    );
  if (['COMPLETED', 'CANCELLED'].includes(task.state) || task.accepted_delivery_operation_id)
    throw new CommandError('denied_scope', 'Task is conversation-only');
  if(await specificationFrozen(tx,task.id) && !['issue','answer'].includes(routing.kind))throw new CommandError('unmet_precondition','Requirement settlement requires refreshed guidance assessment');
  const text = routing.text!;
  if (!text.trim() || Buffer.byteLength(text) > 262144)
    throw new CommandError('invalid_input', 'Action text must be nonblank and bounded');
  if (routing.kind === 'issue') {
    const id = randomUUID();
    await tx.query('INSERT INTO task_input_issues(id,task_id,input_id,reason) VALUES($1,$2,$3,$4)', [
      id,
      task.id,
      inputId,
      text,
    ]);
    return { obligation_id: id };
  }
  if (routing.kind === 'answer') {
    let target = routing.target_id;
    if (routing.target_kind === 'planning_issue') {
      const current = (await tx.query('SELECT planning_issue_sequence FROM tasks WHERE id=$1', [task.id]))
        .rows[0].planning_issue_sequence;
      if (current === null || Number(current) !== routing.issue_sequence)
        throw new CommandError('version_conflict', 'Planning issue is no longer current');
      target = String(current);
    } else if (routing.target_kind === 'node_blocker') {
      if (
        !(await tx.query('SELECT 1 FROM nodes WHERE task_id=$1 AND blocker_id=$2', [task.id, target]))
          .rowCount
      )
        throw new CommandError('stale_execution', 'Node blocker is no longer current');
    } else if (
      !(
        await tx.query("SELECT 1 FROM task_input_issues WHERE task_id=$1 AND id=$2 AND status='open'", [
          task.id,
          target,
        ])
      ).rowCount
    )
      throw new CommandError('stale_execution', 'Input issue is no longer open');
    await tx.query(
      'INSERT INTO task_input_answers(id,task_id,input_id,target_kind,target_id,answer) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), task.id, inputId, routing.target_kind, target, text],
    );
    return {};
  }
  if (routing.kind === 'resolve_guidance') {
    const g = (
      await tx.query('SELECT * FROM task_guidance WHERE id=$1 AND task_id=$2 FOR UPDATE', [
        routing.operation_id,
        task.id,
      ])
    ).rows[0];
    if (!g || g.status !== 'active' || Number(g.version) !== routing.expected_version)
      throw new CommandError('version_conflict', 'Guidance obligation changed');
    await tx.query("UPDATE task_guidance SET status='resolved',version=version+1 WHERE id=$1", [g.id]);
    await tx.query(
      "UPDATE task_guidance_obligations SET status='resolved',version=version+1,reason=$2 WHERE guidance_id=$1 AND status='pending'",
      [g.id, text],
    );
    await tx.query(
      "UPDATE task_guidance_followups SET status='cancelled' WHERE obligation_id IN (SELECT id FROM task_guidance_obligations WHERE guidance_id=$1) AND status='waiting' AND (node_id IN (SELECT id FROM nodes WHERE state='COMPLETED') OR EXISTS(SELECT 1 FROM node_execution_outbox s JOIN operations op ON op.attempt_id=s.planned_attempt_id WHERE s.id=task_guidance_followups.source_id AND op.kind='complete_node' AND op.state<>'cancelled'))",
      [g.id],
    );
    return { obligation_id: g.id };
  }
  let node: ExecutionNode | undefined;
  if (task.plan_id) {
    node = (
      await tx.query<ExecutionNode>(
        'SELECT n.* FROM nodes n JOIN plan_nodes p ON p.node_id=n.id AND p.plan_id=$2 WHERE n.task_id=$1 AND n.id=$3 FOR UPDATE OF n',
        [task.id, task.plan_id, basis.node_id],
      )
    ).rows[0];
    if (
      !node ||
      Number(node.activation) !== basis.node_activation ||
      node.execution_source_id !== basis.source_id
    )
      throw new CommandError(
        'version_conflict',
        'Guidance requires the exact current Node activation and source',
      );
  } else if (basis.node_id || basis.node_activation || basis.source_id)
    throw new CommandError('denied_scope', 'Pre-Plan guidance has no Node recipient');
  if (routing.supersedes) {
    if (
      !(
        await tx.query("SELECT 1 FROM task_guidance WHERE id=$1 AND task_id=$2 AND status='active'", [
          routing.supersedes,
          task.id,
        ])
      ).rowCount
    )
      throw new CommandError('stale_execution', 'Superseded guidance is not active');
    await tx.query("UPDATE task_guidance SET status='superseded',version=version+1 WHERE id=$1", [
      routing.supersedes,
    ]);
    await tx.query(
      "UPDATE task_guidance_obligations SET status='superseded',version=version+1 WHERE guidance_id=$1 AND status='pending'",
      [routing.supersedes],
    );
    await tx.query(
      "UPDATE task_guidance_followups SET status='cancelled' WHERE obligation_id IN (SELECT id FROM task_guidance_obligations WHERE guidance_id=$1)",
      [routing.supersedes],
    );
  }
  const id = randomUUID();
  await tx.query(
    'INSERT INTO task_guidance(id,task_id,input_id,text,content_digest,node_id,supersedes) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, task.id, inputId, text, digest(text), node?.id ?? null, routing.supersedes ?? null],
  );
  if (node) {
    await bindTaskGuidance(tx, task.id, node.id, Number(node.activation));
    const obligation = (
      await tx.query(
        'SELECT id FROM task_guidance_obligations WHERE guidance_id=$1 AND node_id=$2 AND node_activation=$3',
        [id, node.id, node.activation],
      )
    ).rows[0];
    await tx.query(
      'INSERT INTO task_guidance_followups(obligation_id,task_id,node_id,node_activation,source_id) VALUES($1,$2,$3,$4,$5)',
      [obligation.id, task.id, node.id, node.activation, node.execution_source_id],
    );
    if (node.state !== 'BLOCKED') await stopGuidanceNode(tx, node, task.id);
  }
  return { obligation_id: id };
}
export async function advanceGuidanceFollowup(
  tx: Transaction,
  task: NodeTask,
  node: ExecutionNode,
  configurationVersion: number,
): Promise<void> {
  if(await specificationFrozen(tx,task.id))return;
  const pending = (
    await tx.query(
      "SELECT f.* FROM task_guidance_followups f WHERE f.task_id=$1 AND f.node_id=$2 AND f.status='waiting' ORDER BY f.obligation_id FOR UPDATE",
      [task.id, node.id],
    )
  ).rows;
  if (
    !pending.length ||
    !['RUNNING', 'REVIEW'].includes(task.state) ||
    node.state === 'BLOCKED' ||
    (await tx.query('SELECT guidance_paused FROM nodes WHERE id=$1', [node.id])).rows[0].guidance_paused
  )
    return;
  if (
    (
      await tx.query('SELECT 1 FROM tasks WHERE id=$1 AND accepted_delivery_operation_id IS NOT NULL', [
        task.id,
      ])
    ).rowCount
  )
    return;
  const held = (
    await tx.query(
      `SELECT 1 FROM attempts a WHERE a.task_id=$1 AND a.node_id=$2 AND (NOT a.process_released OR EXISTS(SELECT 1 FROM operations o WHERE o.attempt_id=a.id AND o.state NOT IN ('succeeded','cancelled')))`,
      [task.id, node.id],
    )
  ).rowCount;
  if (held) return;
  if (
    (await tx.query("SELECT 1 FROM workspace_leases WHERE task_id=$1 AND state<>'released'", [task.id]))
      .rowCount
  )
    return;
  // An Owner Retry/Continue may already have prepared a source containing all
  // pending guidance; consume follow-up responsibility without replacing it.
  if (
    node.execution_source_id &&
    pending.every((f) => f.source_id !== node.execution_source_id) &&
    !(
      await tx.query(
        `SELECT 1 FROM task_guidance_obligations o WHERE o.node_id=$1 AND o.node_activation=$2 AND o.status='pending' AND NOT EXISTS(SELECT 1 FROM task_guidance_assignments a WHERE a.source_id=$3 AND a.obligation_id=o.id)`,
        [node.id, node.activation, node.execution_source_id],
      )
    ).rowCount
  ) {
    await tx.query("UPDATE task_guidance_followups SET status='done' WHERE node_id=$1 AND status='waiting'", [
      node.id,
    ]);
    return;
  }
  if (node.state === 'COMPLETED') {
    if (!await remoteItemQuiescent(tx,task.id)) return;
    await reactivateSettledNodes(tx, {
      task_id: task.id,
      expected: {
        control_version: Number(task.control_version),
        specification_id: task.specification_id,
        plan_id: task.plan_id,
      },
      node_ids: [node.id],
    });
    await tx.query(
      "UPDATE task_guidance_obligations SET status='carried',version=version+1 WHERE node_id=$1 AND node_activation=$2 AND status='pending'",
      [node.id, node.activation],
    );
  } else {
    if (node.execution_source_id)
      await tx.query('UPDATE node_execution_outbox SET done=true WHERE id=$1', [node.execution_source_id]);
    await tx.query("UPDATE nodes SET state='PENDING',execution_source_id=NULL WHERE id=$1", [node.id]);
    await tx.query('UPDATE tasks SET control_version=control_version+1 WHERE id=$1', [task.id]);
  }
  const freshTask = (await tx.query<NodeTask>('SELECT * FROM tasks WHERE id=$1', [task.id])).rows[0]!;
  const freshNode = (await tx.query<ExecutionNode>('SELECT * FROM nodes WHERE id=$1', [node.id])).rows[0]!;
  await prepareNodeSource(tx, freshTask, freshNode, configurationVersion, {
    recovery: {
      guidance_followup: true,
      prior_source_id: node.execution_source_id,
    },
  });
  await tx.query("UPDATE task_guidance_followups SET status='done' WHERE node_id=$1 AND status='waiting'", [
    node.id,
  ]);
  await planningEvent(tx, task.id, 'guidance_followup_prepared', {
    node_id: node.id,
    node_activation: Number(freshNode.activation),
  });
}
export async function taskInputGuards(tx: Transaction, taskId: string): Promise<string[]> {
  if (
    (await tx.query("SELECT 1 FROM tasks WHERE id=$1 AND state IN ('COMPLETED','CANCELLED')", [taskId]))
      .rowCount
  )
    return [];
  return (
    await tx.query<{ id: string }>(
      `SELECT id FROM task_inputs WHERE task_id=$1 AND status IN ('pending','failed') AND accepted_delivery_operation_id IS NULL UNION SELECT id FROM requirement_obligations WHERE task_id=$1 AND status='pending' AND current_proposal_id IS NOT NULL UNION SELECT id FROM task_input_issues WHERE task_id=$1 AND status='open' UNION SELECT g.id FROM task_guidance g WHERE g.task_id=$1 AND g.status='active' AND (NOT EXISTS(SELECT 1 FROM task_guidance_obligations o WHERE o.guidance_id=g.id) OR EXISTS(SELECT 1 FROM task_guidance_obligations o WHERE o.guidance_id=g.id AND o.status='pending')) ORDER BY id LIMIT 257`,
      [taskId],
    )
  ).rows.map((r) => r.id);
}
export async function cancelTaskInputEffects(tx: Transaction, taskId: string): Promise<void> {
  await tx.query("UPDATE requirement_changes SET status='withdrawing',version=version+1 WHERE task_id=$1 AND status='settling'",[taskId]);
  await tx.query("UPDATE requirement_obligations SET status='cancelled',version=version+1 WHERE task_id=$1 AND status='pending'",[taskId]);
  await tx.query(
    "UPDATE task_guidance SET status='cancelled',version=version+1 WHERE task_id=$1 AND status='active'",
    [taskId],
  );
  await tx.query(
    "UPDATE task_guidance_obligations SET status='cancelled',version=version+1 WHERE task_id=$1 AND status='pending'",
    [taskId],
  );
  await tx.query(
    "UPDATE task_guidance_followups SET status='cancelled' WHERE task_id=$1 AND status='waiting'",
    [taskId],
  );
  await tx.query(
    "UPDATE task_input_issues SET status='cancelled',version=version+1 WHERE task_id=$1 AND status='open'",
    [taskId],
  );
  // Unanswered messages stay ordered; next immutable source is terminal reply-only.
  await tx.query('UPDATE task_conversation_outbox SET done=true WHERE task_id=$1 AND NOT done', [taskId]);
  await tx.query(
    'UPDATE tasks SET conversation_version=conversation_version+1,conversation_source_id=NULL WHERE id=$1',
    [taskId],
  );
  await tx.query(
    "UPDATE task_inputs SET status='pending',version=version+1 WHERE task_id=$1 AND status='failed'",
    [taskId],
  );
}
