import { requestReplan } from './task-replan-state.ts';
import { prepareSpecification, attachSpecification, requirementProposal, exactBasis, specificationImpact } from './task-specification-state.ts';
import { admitSpecification } from './task-specification-settlement.ts';
import type { PrepareSpecificationRevision, ApplySpecificationRevision } from '../../../packages/protocol/src/index.ts';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type {
  CommandEnvelope,
  EffectResult,
  TaskContext,
  TaskConversationSource,
  TaskHistoryPage,
  TaskMessage,
} from '../../../packages/protocol/src/index.ts';
import type { AttemptRow } from './service.ts';
import { admitWorkspaceEffect } from './workspaces.ts';
import { routeTaskInput } from './task-guidance.ts';
import { planningEvent } from './task-planning-state.ts';

export interface ConversationTask {
  id: string;
  project_id: string | null;
  state: string;
  specification_id: string;
  plan_id: string | null;
  control_version: string;
  conversation_sequence: string;
  conversation_watermark: string;
  conversation_version: string;
  conversation_input_id: string | null;
  conversation_source_id: string | null;
  accepted_delivery_operation_id: string | null;
  accepted_delivery_input_cutoff: string | null;
}
export interface ConversationSource {
  id: string;
  task_id: string;
  input_id: string;
  planned_attempt_id: string;
  expected_version: string;
  source_watermark: string;
  context_digest: string;
  prompt: string | null;
  context: { observation: TaskContext } | null;
  reply_only: boolean;
  preparation_failure: string | null;
  waiting_reason: string | null;
  done: boolean;
}
export async function conversationTask(tx: Transaction, id: string): Promise<ConversationTask> {
  const row = (await tx.query<ConversationTask>('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new CommandError('denied_scope', 'Unknown Task');
  return row;
}
export function conversationSource(row: ConversationSource): TaskConversationSource {
  return {
    source_id: row.id,
    input_id: row.input_id,
    source_watermark: Number(row.source_watermark),
    conversation_version: Number(row.expected_version),
    context_digest: row.context_digest,
    reply_only: row.reply_only,
  };
}
export function conversationOnly(task: ConversationTask): boolean {
  return ['COMPLETED', 'CANCELLED'].includes(task.state) || !!task.accepted_delivery_operation_id;
}
export function taskText(text: string): void {
  validate('DiscussionText', text);
  canonicalJSON(text);
  if (!text.trim() || Buffer.byteLength(text) > 262144)
    throw new CommandError('invalid_input', 'Task text must be nonblank and within 256 KiB');
}
export async function assertConversationSource(
  tx: Transaction,
  taskId: string,
  source: TaskConversationSource,
  attemptId: string,
  prompt?: string,
): Promise<ConversationSource> {
  const row = (
    await tx.query<ConversationSource>(
      `SELECT s.* FROM task_conversation_outbox s JOIN tasks t ON t.id=s.task_id JOIN task_inputs i ON i.id=s.input_id
    WHERE s.id=$1 AND s.task_id=$2 AND s.planned_attempt_id=$3 AND t.conversation_source_id=s.id AND t.conversation_input_id=s.input_id AND t.conversation_version=s.expected_version AND i.status='pending'`,
      [source.source_id, taskId, attemptId],
    )
  ).rows[0];
  if (
    !row ||
    row.preparation_failure ||
    canonicalJSON(conversationSource(row)) !== canonicalJSON(source) ||
    (prompt !== undefined && row.prompt !== prompt)
  )
    throw new CommandError('stale_execution', 'Task input source is no longer current');
  return row;
}
export async function ensureConversationHead(tx: Transaction, taskId: string): Promise<void> {
  const task = await conversationTask(tx, taskId);
  if (task.conversation_input_id) return;
  const next = (
    await tx.query<{ id: string; sequence: string }>(
      `SELECT i.id,m.sequence FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.task_id=$1 AND i.status IN ('pending','failed') ORDER BY m.sequence LIMIT 1`,
      [taskId],
    )
  ).rows[0];
  await tx.query(
    `UPDATE tasks SET conversation_input_id=$2,conversation_source_id=NULL,conversation_watermark=COALESCE((SELECT max(m.sequence) FROM task_messages m JOIN task_inputs i ON i.id=m.input_id WHERE m.task_id=$1 AND m.author='owner' AND i.status IN ('replied','withdrawn') AND ($3::bigint IS NULL OR m.sequence<$3)),conversation_watermark) WHERE id=$1`,
    [taskId, next?.id ?? null, next?.sequence ?? null],
  );
}
function cursorValue(taskId: string, before: number, cutoff: number | null, query: string): string {
  return Buffer.from(canonicalJSON({ version: 1, task_id: taskId, before, cutoff, query })).toString(
    'base64url',
  );
}
export async function taskHistory(
  tx: Transaction,
  taskId: string,
  cursor?: string,
  cutoff: number | null = null,
  query = '',
  byteLimit = MAX_ITEM_BYTES - 8192,
): Promise<TaskHistoryPage> {
  validate('TaskHistoryQuery', { ...(cursor ? { cursor } : {}), query });
  if (Buffer.byteLength(query) > 1024)
    throw new CommandError('invalid_input', 'History query exceeds budget');
  let before = Number.MAX_SAFE_INTEGER;
  if (cursor) {
    try {
      validate('TodoCursor', cursor);
      const p = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      validate('Counter', p.before);
      if (p.task_id !== taskId || p.cutoff !== cutoff || p.query !== query)
        throw new CommandError('denied_scope', 'History cursor belongs to another scope');
      if (cursorValue(taskId, p.before, cutoff, query) !== cursor) throw new Error();
      before = p.before;
    } catch (e) {
      if (e instanceof CommandError) throw e;
      throw new CommandError('invalid_input', 'Invalid history cursor');
    }
  }
  const rows = (
    await tx.query(
      `SELECT m.*,i.status disposition FROM task_messages m JOIN task_inputs i ON i.id=m.input_id WHERE m.task_id=$1 AND m.sequence<$2 AND ($3::bigint IS NULL OR (m.author='owner' AND m.sequence<=$3) OR (m.author='assistant' AND m.source_watermark<$3)) AND ($4='' OR strpos(lower(m.content),lower($4))>0) ORDER BY m.sequence DESC LIMIT 65`,
      [taskId, before, cutoff, query],
    )
  ).rows;
  const messages: TaskMessage[] = [];
  let bytes = 2048,
    last = before;
  for (const r of rows) {
    if (messages.length === 64) break;
    const m: TaskMessage = {
      message_id: r.id,
      input_id: r.input_id,
      sequence: Number(r.sequence),
      author: r.author,
      content: r.content,
      created_at: r.created_at.toISOString(),
      disposition: r.disposition,
      ...(r.source_id
        ? {
            source_id: r.source_id,
            source_watermark: Number(r.source_watermark),
            observed_control_version: Number(r.observed_control_version),
            observed_at: r.observed_at.toISOString(),
          }
        : {}),
    };
    const size = Buffer.byteLength(JSON.stringify(m));
    if (bytes + size > byteLimit) {
      if (!messages.length) throw new CommandError('unmet_precondition', 'Message exceeds history budget');
      break;
    }
    messages.push(m);
    bytes += size;
    last = Number(r.sequence);
  }
  return {
    schema_version: 1,
    task_id: taskId,
    messages: messages.reverse(),
    cursor: cursorValue(taskId, last, cutoff, query),
    has_more: rows.length > messages.length,
  };
}
export async function taskContext(tx: Transaction, task: ConversationTask): Promise<TaskContext> {
  // Required facts are bounded together; no raw logs, Todo or other Task context.
  const specification = (
    await tx.query('SELECT content FROM specification_revisions WHERE task_id=$1 AND id=$2', [
      task.id,
      task.specification_id,
    ])
  ).rows[0]?.content;
  const plan = task.plan_id
    ? (
        await tx.query('SELECT content FROM plan_revisions WHERE task_id=$1 AND id=$2', [
          task.id,
          task.plan_id,
        ])
      ).rows[0]?.content
    : null;
  const nodes = (
    await tx.query(
      `SELECT n.id,n.activation,n.state,n.execution_source_id,n.blocker_id,n.result FROM nodes n JOIN plan_nodes p ON p.node_id=n.id AND p.plan_id=$2 WHERE n.task_id=$1 ORDER BY n.id`,
      [task.id, task.plan_id],
    )
  ).rows;
  const guidance = (
    await tx.query(
      `SELECT id,node_id,text,status,version FROM task_guidance WHERE task_id=$1 AND status='active' ORDER BY id LIMIT 257`,
      [task.id],
    )
  ).rows;
  const issues = (
    await tx.query(
      `SELECT id,reason,status,version FROM task_input_issues WHERE task_id=$1 AND status='open' ORDER BY id LIMIT 257`,
      [task.id],
    )
  ).rows;
  const obligations = (
    await tx.query(
      `SELECT id,guidance_id,node_id,node_activation,status,version FROM task_guidance_obligations WHERE task_id=$1 AND status='pending' ORDER BY id LIMIT 257`,
      [task.id],
    )
  ).rows;
  const operations = (
    await tx.query(
      `SELECT o.id,o.kind,o.state,o.failure_kind,a.node_id,a.id attempt_id FROM operations o JOIN attempts a ON a.id=o.attempt_id WHERE a.task_id=$1 AND o.state NOT IN ('succeeded','cancelled') ORDER BY o.id LIMIT 257`,
      [task.id],
    )
  ).rows;
  const planningIssue = (
    await tx.query(
      `SELECT e.sequence,e.body FROM tasks t JOIN task_events e ON e.task_id=t.id AND e.sequence=t.planning_issue_sequence WHERE t.id=$1`,
      [task.id],
    )
  ).rows;
  const blockers = (
    await tx.query(
      `SELECT b.id,b.node_id,b.node_activation,b.kind,b.reason FROM node_blockers b JOIN nodes n ON n.blocker_id=b.id WHERE b.task_id=$1`,
      [task.id],
    )
  ).rows;
  const artifacts = (
    await tx.query(
      'SELECT id,node_id,node_activation,title,content_digest FROM artifacts WHERE task_id=$1 ORDER BY created_at DESC,id LIMIT 32',
      [task.id],
    )
  ).rows;
  const project =
    (await tx.query('SELECT id,name,context FROM projects WHERE id=$1', [task.project_id])).rows[0] ?? null;
  if ([guidance, issues, obligations, operations].some((a) => a.length > 256))
    throw new CommandError('unmet_precondition', 'Required Task facts exceed context budget');
  const changes=(await tx.query(`SELECT o.id obligation_id,o.version,o.current_proposal_id,p.summary,p.specification,p.impact,p.content_digest,c.id operation_id,c.status,c.version operation_version,c.attention FROM requirement_obligations o JOIN requirement_proposals p ON p.id=o.current_proposal_id LEFT JOIN requirement_changes c ON c.proposal_id=p.id WHERE o.task_id=$1 AND o.status='pending' ORDER BY o.id LIMIT 65`,[task.id])).rows.map(r=>({...r,version:Number(r.version),operation_version:r.operation_version===null?null:Number(r.operation_version)}));
  if(changes.length>64)throw new CommandError('unmet_precondition','Required change context exceeds budget');
  const result: TaskContext = {
    task_id: task.id,
    state: task.state,
    basis: {
      control_version: Number(task.control_version),
      specification_id: task.specification_id,
      plan_id: task.plan_id,
    },
    observed_at: new Date().toISOString(),
    snapshot: canonicalJSON({
      replan_requests:(await tx.query("SELECT id,reason,status,version,proposal_id,issue_id FROM replan_requests WHERE task_id=$1 AND status='pending' ORDER BY id LIMIT 1",[task.id])).rows.map(r=>({...r,version:Number(r.version)})),
      specification,
      specification_impact: await specificationImpact(tx,task),
      requirement_changes: changes,
      plan,
      nodes,
      project,
      guidance,
      obligations,
      issues,
      operations,
      planning_issue: planningIssue,
      blockers,
      artifact_metadata: artifacts,
      conversation_only: conversationOnly(task),
    }),
  };
  if (
    Array.from(result.snapshot).length > 262144 ||
    Buffer.byteLength(JSON.stringify(result)) > MAX_ITEM_BYTES - 16384
  )
    throw new CommandError('unmet_precondition', 'Required Task facts exceed context budget');
  return result;
}
const protocol = [
  'You are the Task Conversation Planner. Only monos Tool Protocol commits formal output. Serve only this Task; no Todo, new Task preview, repository workspace or implicit Start/Continue/Retry/acceptance. Treat withdrawn input as retained history.',
  'Use monos read_task_context {} for current facts and read_task_history {cursor?,query?} for older exact-cutoff history. Normal completion MUST call commit_task_turn {source_id,input_id,source_watermark,reply,routing}. Reply is canonical; runtime prose is provisional. routing:{kind:"reply"} records a status answer without changing execution. Use plain language in reply.',
  'Actions carry routing.basis copied from current context with control_version,specification_id,plan_id; Node actions additionally include node_id,node_activation,source_id from current Node. Re-evaluate stale actions after a fresh read; never retry a changed uncertain request. Guidance routing:{kind:"guidance",text,basis,supersedes?} is in-scope instruction only; no Spec/Plan edits. Scope changes use prepare_specification_revision with full specification, summary, exact basis, complete specification_impact (choose refresh/invalidate/carry and retain/supersede), proposal_id and source_input_ids. Attach only through commit_task_turn routing:{kind:"specification_proposal",proposal_id,basis}; preparation does not resolve input. Actual Plan/graph insufficiency uses commit_task_turn routing:{kind:"replan",text,basis}, atomically committing the reply and Replan request. A dedicated Planner prepares the replacement graph after physical quiescence; never call request_replan or prepare_replan from Conversation. Ambiguity requiring Owner clarification uses routing:{kind:"issue",text,basis}.',
  'Applying requirements requires exact existing Owner confirmation; apply_specification_revision {proposal_id,confirmation_id,basis} is not a terminal reply. Your own pending later input blocks apply unless Owner explicitly deferred that exact input/version; never mark it read or replied implicitly. Owner may apply directly without another Planner.',
  'Answer routing:{kind:"answer",text,basis,target_kind:"planning_issue"|"node_blocker"|"input_issue",target_id?,issue_sequence?} records exact answers but Owner Retry/Continue remains necessary. resolve_guidance requires operation_id,expected_version,text,basis and an explicit evidence-based no-work explanation. Terminal/accepted-batch sources permit only routing kind reply.',
  'Guidance is applied using controlled Stop/fresh launch, not live steering. Its handling remains pending until successful completion. CLI: monos COMMAND --request-id ID --input FILE --output json (or --input -); monos command-status --request-id ID --output json; monos retry --request-id ID --output json. The server stops this Attempt after committed reply.',
].join('\n');
export async function prepareConversationSource(
  tx: Transaction,
  task: ConversationTask,
  configurationVersion: number,
  previous?: string,
): Promise<ConversationSource> {
  const input = (
    await tx.query(
      `SELECT i.*,m.sequence,m.content FROM task_inputs i JOIN task_messages m ON m.id=i.message_id WHERE i.id=$1 AND i.task_id=$2`,
      [task.conversation_input_id, task.id],
    )
  ).rows[0];
  const id = randomUUID(),
    attemptId = randomUUID();
  let context: object | null,
    prompt: string | null,
    failure: string | null = null;
  const only = conversationOnly(task) || !!input.accepted_delivery_operation_id;
  try {
    const observation = await taskContext(tx, task);
    const recent = await taskHistory(
      tx,
      task.id,
      undefined,
      Number(input.sequence),
      '',
      MAX_ITEM_BYTES - 8192,
    );
    const history: TaskMessage[] = [];
    let bytes = 0;
    for (const m of [...recent.messages].reverse()) {
      if (m.message_id === input.message_id) continue;
      const size = Buffer.byteLength(JSON.stringify(m));
      if (history.length === 24 || bytes + size > 65536) break;
      history.unshift(m);
      bytes += size;
    }
    const guidance = (await tx.query('SELECT planner_guidance FROM execution_policies')).rows[0]
      .planner_guidance;
    context = {
      protocol,
      binding: {
        source_id: id,
        input_id: input.id,
        source_watermark: Number(input.sequence),
        conversation_version: Number(task.conversation_version),
        reply_only: only,
      },
      observation,
      owner_planner_guidance: guidance,
      recent_history: history,
      input_batch: [{ message_id: input.message_id, content: input.content }],
      ...(input.parent_issue_id ? { parent_issue_id: input.parent_issue_id } : {}),
    };
    prompt = canonicalJSON(context);
    if (
      Array.from(prompt).length > 262144 ||
      Buffer.byteLength(JSON.stringify({ prompt })) > MAX_ITEM_BYTES - 16384
    )
      throw new CommandError('unmet_precondition', 'context_budget_exceeded');
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    context = null;
    prompt = null;
    failure = 'context_budget_exceeded';
  }
  const hash = digest(prompt ?? canonicalJSON({ id, input_id: input.id, failure }));
  await tx.query(
    `INSERT INTO task_conversation_outbox(id,task_id,input_id,previous_source_id,planned_attempt_id,expected_version,source_watermark,configuration_version,reply_only,context,prompt,context_digest,preparation_failure,waiting_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
    [
      id,
      task.id,
      input.id,
      previous ?? null,
      attemptId,
      task.conversation_version,
      input.sequence,
      configurationVersion,
      only,
      context,
      prompt,
      hash,
      failure,
    ],
  );
  await tx.query('UPDATE tasks SET conversation_source_id=$2 WHERE id=$1', [task.id, id]);
  return (await tx.query<ConversationSource>('SELECT * FROM task_conversation_outbox WHERE id=$1', [id]))
    .rows[0]!;
}
export async function stopConversationAttempt(
  tx: Transaction,
  attempt: AttemptRow,
  requestId: string,
): Promise<string | undefined> {
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  if (attempt.state === 'QUEUED') {
    await tx.query(
      "UPDATE attempts SET state='CANCELLED',mutation_allowed=false,process_absent=true WHERE id=$1",
      [attempt.id],
    );
    return;
  }
  const prior = (
    await tx.query<{ id: string }>(
      "SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1",
      [attempt.id],
    )
  ).rows[0];
  return (
    prior?.id ?? (attempt.process_released ? undefined : admitWorkspaceEffect(tx, attempt, 'stop', requestId))
  );
}
export async function handleTaskConversation(
  tx: Transaction,
  attempt: AttemptRow,
  command: CommandEnvelope,
): Promise<{ result: EffectResult; operation_id?: string }> {
  const task = await conversationTask(tx, attempt.task_id!);
  const source = await assertConversationSource(
    tx,
    task.id,
    attempt.launch.task_conversation_source!,
    attempt.id,
    attempt.launch.prompt,
  );
  if (command.name === 'prepare_specification_revision') {
    if(source.reply_only || conversationOnly(task))throw new CommandError('denied_scope','This input is conversation-only');
    const p=await prepareSpecification(tx,task,command.payload as PrepareSpecificationRevision,source);
    return {result:{proposal_id:p.id,content_digest:p.content_digest,obligation_id:p.obligation_id}};
  }
  if(command.name==='apply_specification_revision'){
    if(source.reply_only || conversationOnly(task))throw new CommandError('denied_scope','This input is conversation-only');
    const input=command.payload as ApplySpecificationRevision;exactBasis(task,input.basis);
    const p=await requirementProposal(tx,input.proposal_id,task.id);
    const c=await admitSpecification(tx,task,p,input.confirmation_id,command.request_id,attempt.id);
    return {result:{requirement_operation_id:c.id,proposal_id:p.id}};
  }
  if (command.name === 'read_task_context') return { result: { task_context: await taskContext(tx, task) } };
  if (command.name === 'read_task_history')
    return {
      result: {
        task_history: await taskHistory(
          tx,
          task.id,
          command.payload.cursor,
          Number(source.source_watermark),
          command.payload.query,
        ),
      },
    };
  if (
    command.name !== 'commit_task_turn' ||
    command.payload.source_id !== source.id ||
    command.payload.input_id !== source.input_id ||
    command.payload.source_watermark !== Number(source.source_watermark)
  )
    throw new CommandError('denied_scope', 'Commit requires exact Task input source');
  taskText(command.payload.reply!);
  const routing = command.payload.routing!;
  if (routing.kind === 'reply_only')
    throw new CommandError('denied_scope', 'Canonical replies use routing kind reply');
  if ((source.reply_only || conversationOnly(task)) && routing.kind !== 'reply')
    throw new CommandError('denied_scope', 'This Task input is conversation-only');
  let routed: Pick<EffectResult,'obligation_id'>;
  if(routing.kind==='specification_proposal'){
    exactBasis(task,routing.basis!);const p=await requirementProposal(tx,routing.proposal_id!,task.id);
    await attachSpecification(tx,task,p,source.id,source.input_id);routed={obligation_id:p.obligation_id};
  }else if(routing.kind==='replan'){exactBasis(task,routing.basis!);const id=await requestReplan(tx,task,attempt,routing.text!,command.request_id,{input_id:source.input_id,source_id:source.id});routed={obligation_id:id};}
  else routed = await routeTaskInput(tx, task, source.input_id, routing);
  if (routed.obligation_id)
    await tx.query(
      "UPDATE task_input_issues SET status='retried',version=version+1 WHERE id=(SELECT parent_issue_id FROM task_inputs WHERE id=$1) AND status='open'",
      [source.input_id],
    );
  const messageId = randomUUID();
  const observation = source.context!.observation;
  const sequence = Number(
    (
      await tx.query(
        'UPDATE tasks SET conversation_sequence=conversation_sequence+1 WHERE id=$1 RETURNING conversation_sequence',
        [task.id],
      )
    ).rows[0].conversation_sequence,
  );
  await tx.query(
    `INSERT INTO task_messages(id,task_id,input_id,sequence,author,content,source_id,source_watermark,observed_control_version,observed_at) VALUES($1,$2,$3,$4,'assistant',$5,$6,$7,$8,$9)`,
    [
      messageId,
      task.id,
      source.input_id,
      sequence,
      command.payload.reply,
      source.id,
      source.source_watermark,
      observation.basis.control_version,
      observation.observed_at,
    ],
  );
  await tx.query(
    `INSERT INTO task_input_resolutions(input_id,task_id,source_id,reply_message_id,disposition,routing,request_id,attempt_id) VALUES($1,$2,$3,$4,'replied',$5,$6,$7)`,
    [source.input_id, task.id, source.id, messageId, routing, command.request_id, attempt.id],
  );
  await tx.query("UPDATE task_inputs SET status='replied',version=version+1 WHERE id=$1", [source.input_id]);
  await tx.query('UPDATE task_conversation_outbox SET done=true,waiting_reason=NULL WHERE id=$1', [
    source.id,
  ]);
  await tx.query(
    'UPDATE tasks SET conversation_version=conversation_version+1,conversation_watermark=$2,conversation_input_id=NULL,conversation_source_id=NULL WHERE id=$1',
    [task.id, source.source_watermark],
  );
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='SUCCEEDED' WHERE id=$1", [attempt.id]);
  const operationId = await stopConversationAttempt(tx, attempt, command.request_id);
  await planningEvent(
    tx,
    task.id,
    'task_reply_committed',
    {
      input_id: source.input_id,
      source_id: source.id,
      message_id: messageId,
      routing,
      observed_control_version: observation.basis.control_version,
      observed_at: observation.observed_at,
    },
    attempt.id,
    operationId,
  );
  await ensureConversationHead(tx, task.id);
  return {
    result: {
      message_id: messageId,
      input_id: source.input_id,
      source_id: source.id,
      reply: command.payload.reply!,
      source_watermark: Number(source.source_watermark),
      ...routed,
    },
    ...(operationId ? { operation_id: operationId } : {}),
  };
}
