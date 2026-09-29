import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../../packages/db/src/index.ts';
import { CommandError } from '../../../packages/domain/src/commands.ts';
import { canonicalJSON, digest, MAX_ITEM_BYTES, validate } from '../../../packages/protocol/src/index.ts';
import type { CommandEnvelope, DiscussionMessage, DiscussionPage, Dispatch, EffectResult, TaskPreview } from '../../../packages/protocol/src/index.ts';

export interface DiscussionControl {
  todo_id: string; original_capture: string; project_id: string | null; project_context_version: string;
  version: string; sequence: string; resolved_watermark: string; source_message_id: string | null;
  desired_attempt_id: string | null; waiting_reason: string | null;
}
export interface DiscussionContext {
  prompt: string; source_message_id: string; source_watermark: number; discussion_version: number;
  project_id?: string; project_context_version: number; project_context_digest: string; configuration_version: number;
}
export interface DiscussionAttempt {
  id: string; runner_id: string; todo_id: string | null; mutation_allowed: boolean; process_released: boolean;
  state: string; launch: Dispatch; discussion_context: DiscussionContext | null;
}
interface MessageRow {
  id: string; sequence: string; author: 'owner' | 'assistant'; content: string; created_at: Date;
  source_message_id: string | null; source_watermark: string | null; project_id: string | null;
  project_context_version: string | null; task_preview: TaskPreview | null; disposition: string | null;
}

export function discussionText(value: string, allowEmpty = false): void {
  validate('DiscussionText', value); canonicalJSON(value);
  if ((!allowEmpty && !value.trim()) || Buffer.byteLength(value) > 262144) throw new CommandError('invalid_input', 'Discussion text must be nonblank and within 256 KiB');
}

export async function lockDiscussion(tx: Transaction, todoId: string): Promise<DiscussionControl> {
  const todo = (await tx.query<{ id: string; original_capture: string; project_id: string | null; project_context_version: string }>('SELECT id,original_capture,project_id,project_context_version FROM todos WHERE id=$1 FOR UPDATE', [todoId])).rows[0];
  if (!todo) throw new CommandError('denied_scope', 'Unknown Todo');
  await tx.query('INSERT INTO todo_discussion_controls(todo_id) VALUES($1) ON CONFLICT DO NOTHING', [todoId]);
  const control = (await tx.query<Omit<DiscussionControl, 'original_capture' | 'project_id' | 'project_context_version'>>('SELECT * FROM todo_discussion_controls WHERE todo_id=$1 FOR UPDATE', [todoId])).rows[0]!;
  return { ...control, original_capture: todo.original_capture, project_id: todo.project_id, project_context_version: todo.project_context_version };
}

export async function readDiscussionControl(tx: Transaction, todoId: string): Promise<DiscussionControl> {
  const todo = (await tx.query<{ id: string; original_capture: string; project_id: string | null; project_context_version: string }>('SELECT id,original_capture,project_id,project_context_version FROM todos WHERE id=$1 FOR SHARE', [todoId])).rows[0];
  if (!todo) throw new CommandError('denied_scope', 'Unknown Todo');
  const control = (await tx.query<DiscussionControl>('SELECT * FROM todo_discussion_controls WHERE todo_id=$1', [todoId])).rows[0];
  return { todo_id: todoId, version: '1', sequence: '0', resolved_watermark: '0', source_message_id: null, desired_attempt_id: null, waiting_reason: null, ...control, original_capture: todo.original_capture, project_id: todo.project_id, project_context_version: todo.project_context_version };
}

export async function projectBinding(tx: Transaction, control: Pick<DiscussionControl, 'project_id' | 'project_context_version'>) {
  const project = control.project_id ? (await tx.query<{ id: string; name: string; context: string; resources: unknown[] }>(`SELECT p.id,p.name,p.context,
    COALESCE((SELECT jsonb_agg(settings ORDER BY id) FROM project_resources WHERE project_id=p.id AND active),'[]'::jsonb) AS resources FROM projects p WHERE p.id=$1`, [control.project_id])).rows[0] ?? null : null;
  return { project, project_context_version: Number(control.project_context_version), project_context_digest: digest(canonicalJSON(project)) };
}

export async function ensureDiscussionIntent(tx: Transaction, control: DiscussionControl): Promise<void> {
  if (control.source_message_id) return;
  const source = (await tx.query<{ id: string }>(`SELECT id FROM todo_discussion_messages m WHERE todo_id=$1 AND author='owner' AND sequence>$2
    AND NOT EXISTS (SELECT 1 FROM todo_discussion_resolutions r WHERE r.source_message_id=m.id) ORDER BY sequence LIMIT 1`, [control.todo_id, control.resolved_watermark])).rows[0];
  if (!source) return;
  await tx.query('UPDATE todo_discussion_controls SET source_message_id=$2,desired_attempt_id=NULL,waiting_reason=NULL WHERE todo_id=$1', [control.todo_id, source.id]);
  await tx.query('INSERT INTO todo_discussion_outbox(id,todo_id,source_message_id,planned_attempt_id,expected_version) VALUES($1,$2,$3,$4,$5)', [randomUUID(), control.todo_id, source.id, randomUUID(), control.version]);
}

function historyCursor(todoId: string, after: number, cutoff: number | null, recent: boolean): string {
  return Buffer.from(canonicalJSON({ version: 1, todo_id: todoId, after, cutoff, recent })).toString('base64url');
}

export async function discussionHistory(tx: Transaction, todoId: string, cursor?: string, cutoff: number | null = null, byteLimit = 1024 * 1024 - 4096, recent = false): Promise<DiscussionPage> {
  let after = recent ? Number.MAX_SAFE_INTEGER : 0;
  if (cursor !== undefined) {
    let parsed: { version: number; todo_id: string; after: number; cutoff: number | null; recent: boolean };
    try {
      validate('TodoCursor', cursor); parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      validate('Counter', parsed.after); validate('Id', parsed.todo_id);
      if (parsed.cutoff !== null) validate('Counter', parsed.cutoff);
      if (typeof parsed.recent !== 'boolean' || parsed.version !== 1 || historyCursor(parsed.todo_id, parsed.after, parsed.cutoff, parsed.recent) !== cursor) throw new Error('Invalid cursor');
    } catch { throw new CommandError('invalid_input', 'Invalid Discussion cursor'); }
    if (parsed.todo_id !== todoId || parsed.cutoff !== cutoff || parsed.recent !== recent) throw new CommandError('denied_scope', 'Discussion cursor belongs to another input scope');
    after = parsed.after;
  }
  const rows = (await tx.query<MessageRow>(`SELECT m.*,r.disposition FROM todo_discussion_messages m LEFT JOIN todo_discussion_resolutions r ON r.source_message_id=m.id
    WHERE m.todo_id=$1 AND m.sequence${recent ? '<' : '>'}$2 AND ($3::bigint IS NULL OR (m.author='owner' AND m.sequence<=$3) OR (m.author='assistant' AND m.source_watermark<$3))
    ORDER BY m.sequence ${recent ? 'DESC' : 'ASC'} LIMIT 65`, [todoId, after, cutoff])).rows;
  const messages: DiscussionMessage[] = []; let bytes = 2048; let last = after;
  for (const row of rows) {
    if (messages.length === 64) break;
    const message = validate<DiscussionMessage>('DiscussionMessage', {
      message_id: row.id, sequence: Number(row.sequence), author: row.author, content: row.content, created_at: row.created_at.toISOString(),
      ...(row.source_message_id ? { source_message_id: row.source_message_id, source_watermark: Number(row.source_watermark), project_context_version: Number(row.project_context_version) } : {}),
      ...(row.project_id ? { project_id: row.project_id } : {}), ...(row.task_preview ? { task_preview: row.task_preview } : {}),
      ...(row.disposition === 'withdrawn' ? { disposition: 'withdrawn' } : {}),
    });
    const size = Buffer.byteLength(JSON.stringify(message)) + 1;
    if (bytes + size > byteLimit) {
      if (!messages.length) throw new CommandError('unmet_precondition', 'Discussion message exceeds page budget');
      break;
    }
    messages.push(message); bytes += size; last = Number(row.sequence);
  }
  return { schema_version: 1, todo_id: todoId, messages: recent ? messages.reverse() : messages, cursor: historyCursor(todoId, last, cutoff, recent), has_more: rows.length > messages.length };
}

export async function prepareDiscussionContext(tx: Transaction, control: DiscussionControl, configurationVersion: number): Promise<DiscussionContext> {
  const source = (await tx.query<{ id: string; sequence: string; content: string }>("SELECT id,sequence,content FROM todo_discussion_messages WHERE id=$1 AND todo_id=$2 AND author='owner'", [control.source_message_id, control.todo_id])).rows[0];
  if (!source) throw new CommandError('unmet_precondition', 'Discussion source is unavailable');
  const binding = await projectBinding(tx, control);
  const guidance = (await tx.query<{ planner_guidance: string }>('SELECT planner_guidance FROM execution_policies')).rows[0]!.planner_guidance;
  const cache = (await tx.query<{ content: string }>('SELECT content FROM todo_requirement_cache WHERE todo_id=$1 AND resolved_watermark=$2 AND project_context_version=$3 AND project_context_digest=$4', [control.todo_id, control.resolved_watermark, binding.project_context_version, binding.project_context_digest])).rows[0];
  const recent = (await tx.query<{ author: string; content: string; source_message_id: string | null; disposition: string | null }>(`SELECT m.author,m.content,m.source_message_id,r.disposition FROM todo_discussion_messages m LEFT JOIN todo_discussion_resolutions r ON r.source_message_id=m.id
    WHERE m.todo_id=$1 AND ((m.author='owner' AND m.sequence<$2) OR (m.author='assistant' AND m.source_watermark<$2)) ORDER BY m.sequence DESC LIMIT 24`, [control.todo_id, source.sequence])).rows;
  const history: typeof recent = []; let bytes = 0;
  for (const message of recent) { const size = Buffer.byteLength(JSON.stringify(message)); if (bytes + size > 65536) break; history.unshift(message); bytes += size; }
  const context = { source_message_id: source.id, source_watermark: Number(source.sequence), discussion_version: Number(control.version), ...(control.project_id ? { project_id: control.project_id } : {}), project_context_version: binding.project_context_version, project_context_digest: binding.project_context_digest, configuration_version: configurationVersion };
  const prompt = [
    'You are the Todo Discussion Planner. Only monos Tool Protocol commands can commit formal output. Capture text is immutable. Do not create Tasks, execute code changes, or claim a Task exists. Runtime logs are provisional. Treat withdrawn input as historical, not an outstanding instruction.',
    'Use monos read_discussion for older scoped history. Repository inspection is unavailable in this release. Normal completion MUST call monos commit_discussion_turn with reply, working_requirement_state, the exact source_message_id and source_watermark below, and optional structured task_preview. The server stops this process after commit. Do not use commit_task_turn. Query/retry the same request ID after an uncertain result; never invent another effect.',
    'Explicit cache rebuilding uses monos update_working_requirement_state with resolved_watermark and project_context_version/project_context_digest; it must cover resolved history only and is not a turn outcome. Normal turns update cache atomically with the reply.',
    canonicalJSON({ binding: { source_message_id: context.source_message_id, source_watermark: context.source_watermark, project_id: context.project_id, project_context_version: context.project_context_version, project_context_digest: context.project_context_digest, configuration_version: configurationVersion }, resolved_watermark: Number(control.resolved_watermark), owner_planner_guidance: guidance, project: binding.project, original_capture: control.original_capture, working_requirement_state: cache?.content ?? null, recent_history: history, current_owner_message: { message_id: source.id, content: source.content } }),
  ].join('\n\n');
  if (Array.from(prompt).length > 262144 || Buffer.byteLength(JSON.stringify({ ...context, prompt })) > MAX_ITEM_BYTES - 4096) throw new CommandError('unmet_precondition', 'Discussion context exceeds the execution budget');
  return { ...context, prompt };
}

export async function stopDiscussionAttempt(tx: Transaction, attempt: DiscussionAttempt, requestId: string): Promise<string | undefined> {
  await tx.query("UPDATE outbox SET done=true WHERE attempt_id=$1 AND kind='start'", [attempt.id]);
  if (attempt.state === 'QUEUED') {
    await tx.query("UPDATE attempts SET state='CANCELLED',mutation_allowed=false,process_absent=true,end_reason='owner_stopped' WHERE id=$1", [attempt.id]);
    return undefined;
  }
  const prior = (await tx.query<{ id: string }>("SELECT id FROM operations WHERE attempt_id=$1 AND kind='stop' ORDER BY created_at LIMIT 1", [attempt.id])).rows[0];
  if (prior) return prior.id;
  if (attempt.process_released) return undefined;
  const id = randomUUID();
  await tx.query("INSERT INTO operations(id,attempt_id,schema_version,kind,request_id,state) VALUES($1,$2,1,'stop',$3,'admitted')", [id, attempt.id, requestId]);
  await tx.query("INSERT INTO outbox(id,runner_id,attempt_id,kind,operation_id) VALUES($1,$2,$3,'effect',$4)", [randomUUID(), attempt.runner_id, attempt.id, id]);
  return id;
}

export async function resolveDiscussionSource(tx: Transaction, control: DiscussionControl, sourceWatermark: number): Promise<void> {
  await tx.query('UPDATE todo_discussion_outbox SET done=true WHERE todo_id=$1 AND NOT done', [control.todo_id]);
  await tx.query('UPDATE todo_discussion_controls SET version=version+1,resolved_watermark=$2,source_message_id=NULL,desired_attempt_id=NULL,waiting_reason=NULL WHERE todo_id=$1', [control.todo_id, sourceWatermark]);
  await ensureDiscussionIntent(tx, { ...control, version: String(Number(control.version) + 1), resolved_watermark: String(sourceWatermark), source_message_id: null });
}

export async function handleDiscussionCommand(tx: Transaction, control: DiscussionControl, attempt: DiscussionAttempt, command: CommandEnvelope): Promise<{ result: EffectResult; operation_id?: string }> {
  const context = attempt.discussion_context;
  if (!context || control.source_message_id !== context.source_message_id || control.desired_attempt_id !== attempt.id) throw new CommandError('stale_execution', 'Discussion source was replaced');
  if (command.name === 'read_discussion') return { result: { discussion_page: await discussionHistory(tx, control.todo_id, command.payload.cursor, context.source_watermark) } };
  if (command.name === 'inspect_repository') throw new CommandError('unmet_precondition', 'Todo repository inspection is not supported by the current Runner');
  const binding = await projectBinding(tx, control);
  const currentProject = binding.project_context_version === context.project_context_version && binding.project_context_digest === context.project_context_digest;
  const state = command.payload.working_requirement_state!; discussionText(state, true);
  if (command.name === 'update_working_requirement_state') {
    if (command.payload.resolved_watermark !== Number(control.resolved_watermark) || command.payload.project_context_version !== binding.project_context_version || command.payload.project_context_digest !== binding.project_context_digest || !currentProject) throw new CommandError('version_conflict', 'Requirement cache basis changed');
    await tx.query(`INSERT INTO todo_requirement_cache(todo_id,content,resolved_watermark,project_context_version,project_context_digest) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(todo_id) DO UPDATE SET content=$2,resolved_watermark=$3,project_context_version=$4,project_context_digest=$5`, [control.todo_id, state, control.resolved_watermark, binding.project_context_version, binding.project_context_digest]);
    return { result: { cache_updated: true, resolved_watermark: Number(control.resolved_watermark) } };
  }
  if (command.name !== 'commit_discussion_turn') throw new CommandError('denied_scope', 'Command is outside Todo Planner authority');
  if (command.payload.source_message_id !== context.source_message_id || command.payload.source_watermark !== context.source_watermark) throw new CommandError('version_conflict', 'Discussion source differs from launch');
  const reply = command.payload.reply!; discussionText(reply);
  const preview = command.payload.task_preview;
  if (preview) { discussionText(preview.title); discussionText(preview.specification); if (preview.project_id !== context.project_id) throw new CommandError('denied_scope', 'Preview Project differs from the source context'); }
  if ((await tx.query("SELECT 1 FROM operations WHERE attempt_id=$1 AND state NOT IN ('succeeded','cancelled')", [attempt.id])).rowCount) throw new CommandError('unmet_precondition', 'Earlier operations must settle before commit');
  const id = randomUUID();
  await tx.query('UPDATE todo_discussion_controls SET sequence=sequence+1 WHERE todo_id=$1', [control.todo_id]);
  await tx.query(`INSERT INTO todo_discussion_messages(id,todo_id,sequence,author,content,source_message_id,source_watermark,project_id,project_context_version,task_preview,requirement_state)
    VALUES($1,$2,$3,'assistant',$4,$5,$6,$7,$8,$9,$10)`, [id, control.todo_id, Number(control.sequence) + 1, reply, context.source_message_id, context.source_watermark, context.project_id ?? null, context.project_context_version, preview ?? null, state]);
  await tx.query("INSERT INTO todo_discussion_resolutions(todo_id,source_message_id,disposition,reply_message_id,attempt_id,request_id) VALUES($1,$2,'replied',$3,$4,$5)", [control.todo_id, context.source_message_id, id, attempt.id, command.request_id]);
  if (currentProject) await tx.query(`INSERT INTO todo_requirement_cache(todo_id,content,resolved_watermark,project_context_version,project_context_digest) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(todo_id) DO UPDATE SET content=$2,resolved_watermark=$3,project_context_version=$4,project_context_digest=$5`, [control.todo_id, state, context.source_watermark, context.project_context_version, context.project_context_digest]);
  await tx.query("UPDATE attempts SET mutation_allowed=false,state='SUCCEEDED' WHERE id=$1", [attempt.id]);
  const operationId = await stopDiscussionAttempt(tx, attempt, command.request_id);
  await tx.query('UPDATE todos SET discussion_activity_at=clock_timestamp() WHERE id=$1', [control.todo_id]);
  await resolveDiscussionSource(tx, control, context.source_watermark);
  return { result: { reply, source_watermark: context.source_watermark, message_id: id, cache_updated: currentProject }, ...(operationId ? { operation_id: operationId } : {}) };
}
