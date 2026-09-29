import { useEffect, useId, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ConfigurationSnapshot, DiscussionCommand, TodoRecord } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { APIError } from '../lib/api.ts';
import { readDiscussion, readDiscussionPage } from '../lib/discussion-api.ts';
import { useDiscussion } from '../lib/use-discussion.ts';
import { useTaskPreviews } from '../lib/use-task-previews.ts';
import { TaskPreviewCard } from './task-preview.tsx';

const sourceLabels = { queued: 'Planner queued', processing: 'Planner is answering', interrupted: 'Discussion interrupted', settling: 'Stopping and settling previous work' } as const;
const waitingReasons: Record<string, string> = {
  policy_missing: 'Choose a Planner execution policy in Execution settings.',
  role_missing: 'The selected role is unavailable. Review its role and execution settings.',
  runner_offline: 'The execution machine is offline. Reconnect it or choose another in Execution settings. Your message is saved.',
  runner_missing: 'The configured execution machine is unavailable. Choose another in Execution settings.',
  installation_stale: 'Waiting for the execution machine to report its coding tools. Check its connection if this request stays queued.',
  installation_unavailable: 'The selected coding tool is unavailable. Check its installation or choose another in Execution settings.',
  model_control_unavailable: 'The coding tool cannot select the configured model. Update the tool or choose a supported tool in Execution settings.',
  unsupported_runtime: 'The configured coding tool is not supported. Choose a supported tool in Execution settings.',
  unsupported_model: 'The configured model is not supported. Choose a supported model in Execution settings.',
  unsupported_thinking: 'The configured reasoning setting is not supported. Remove it in Execution settings.',
  ambiguous_auto_placement: 'Choose an execution machine in the Planner policy.',
  context_budget_exceeded: 'This discussion is too long to prepare. Shorten Planner guidance or Project context, or withdraw this message and send a shorter one. Your message is saved.',
  context_unavailable: 'Planner cannot prepare this discussion. Review its Project and Planner guidance, or withdraw this message and try again. Your message is saved.',
};
const endReasons: Record<string, string> = {
  owner_stopped: 'You stopped this discussion. The original message is retained.',
  missing_formal_outcome: 'Planner stopped before saving a reply.',
  runtime_failed: 'Planner could not finish this request.',
};

// Always mounted by Todos: changing selection must retain each Todo's draft and
// uncertain request, including while the next detail query is loading.
export function Discussion({ todo, snapshot, onUnauthorized }: { todo?: TodoRecord; snapshot: ConfigurationSnapshot; onUnauthorized: () => void }) {
  const local = useDiscussion(onUnauthorized);
  const previews = useTaskPreviews(onUnauthorized);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerId = useId(); const noticeId = useId();
  const id = todo?.todo_id;
  const status = useQuery({ queryKey: ['todos', 'discussion', id, 'status'], enabled: !!id, retry: false, refetchInterval: 2000,
    queryFn: () => { if (!id) throw new Error('Select a Todo.'); return readDiscussion(id); },
  });
  const history = useInfiniteQuery({ queryKey: ['todos', 'discussion', id, 'messages'], enabled: !!id, initialPageParam: '', retry: false, refetchInterval: 2000,
    queryFn: ({ pageParam }) => { if (!id) throw new Error('Select a Todo.'); return readDiscussionPage(id, pageParam); },
    getNextPageParam: (page) => page.has_more ? page.cursor : undefined,
  });
  useEffect(() => {
    if ([status.error, history.error].some((error) => error instanceof APIError && error.code === 'unauthorized')) onUnauthorized();
  }, [status.error, history.error, onUnauthorized]);
  if (!todo || !id) return null;
  const state = local.byTodo[id]; const disabled = !!state?.busy || !!state?.pending;
  const current = status.data?.current_source;
  // The first page is the recent window; later pages move backward in history.
  // Refetch keeps that window current and lets newer withdrawal dispositions win.
  const messages = [...new Map(history.data?.pages.toReversed().flatMap((page) => page.messages).map((message) => [message.message_id, message])).values()].sort((a, b) => a.sequence - b.sequence);
  const projectName = (projectId?: string) => projectId ? snapshot.projects.find((project) => project.id === projectId)?.name ?? 'Previous Project' : 'Inbox';
  const refresh = () => { void status.refetch(); void history.refetch(); };
  function action(name: 'retry_discussion_turn' | 'withdraw_discussion_turn' | 'stop_discussion_turn') {
    if (!id || !current || !status.data) return;
    if (name === 'stop_discussion_turn' && !current.attempt_id) return;
    const command: DiscussionCommand = { schema_version: 1, request_id: crypto.randomUUID(), todo_id: id, name,
      expected_discussion_version: status.data.discussion_version, payload: { source_message_id: current.message_id,
        ...(name === 'stop_discussion_turn' ? { attempt_id: current.attempt_id } : {}) } };
    void local.execute(command);
  }
  return <section className="card editor todo-discussion" aria-label="Todo Discussion">
    <div className="section-label"><h2>Discussion</h2><Button variant="ghost" disabled={status.isFetching || history.isFetching} onClick={refresh}>Refresh Discussion</Button></div>
    {state?.notice && <div id={noticeId} className={`notice ${state.notice.kind}`} role={state.notice.kind === 'success' ? 'status' : 'alert'}><span>{state.notice.text}</span>
      {state.notice.kind === 'uncertain' ? <Button variant="outline" disabled={state.busy} onClick={() => { void local.recover(id); }}>Check Discussion result</Button> : <Button variant="ghost" onClick={() => local.dismiss(id)}>Dismiss</Button>}
    </div>}
    {(status.error || history.error) && <div className="notice error" role="alert"><span>{status.error?.message ?? history.error?.message} Your saved messages and draft are retained.</span><Button variant="outline" onClick={refresh}>Retry Discussion connection</Button></div>}
    {history.isPending && <p role="status">Loading Discussion…</p>}
    {!history.isPending && !history.error && !messages.length && <p className="inline-note">Send a message when you’re ready to discuss this idea with Planner.</p>}
    <ol className="discussion-messages" aria-label="Discussion messages">{messages.map((message) => {
      const source = messages.find((item) => item.message_id === message.source_message_id);
      const queued = message.author === 'owner' && !message.disposition && status.data && message.sequence > status.data.resolved_watermark && message.message_id !== current?.message_id;
      return <li key={message.message_id} className={`discussion-message ${message.author}`} data-message-id={message.message_id}>
        <div className="discussion-message-meta"><strong>{message.author === 'owner' ? 'You' : 'Planner'}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
          {message.disposition === 'withdrawn' ? <span className="tag">Withdrawn</span> : queued ? <span className="tag">Queued</span> : message.message_id === current?.message_id ? <span className="tag">{sourceLabels[current.status]}</span> : null}
        </div>
        {message.author === 'assistant' && <p className="hint">Reply using {projectName(message.project_id)} context{source ? ` · In reply to “${Array.from(source.content).slice(0, 100).join('')}”` : ''}</p>}
        <p className="discussion-content">{message.content}</p>
        {message.task_preview && <TaskPreviewCard todoId={id} message={message} snapshot={snapshot} controller={previews} continueDiscussion={() => composer.current?.focus()} onUnauthorized={onUnauthorized} />}
      </li>;
    })}</ol>
    {history.hasNextPage && <Button variant="outline" disabled={history.isFetching} onClick={() => { void history.fetchNextPage(); }}>Load earlier messages</Button>}
    {current && <div className="discussion-attention"><p role="status"><strong>{sourceLabels[current.status]}</strong></p>
      {current.waiting_reason && <p className="hint">{waitingReasons[current.waiting_reason] ?? 'This request is waiting. Your message remains saved.'}</p>}
      {current.end_reason && <p className="hint">{endReasons[current.end_reason] ?? 'The request was interrupted. Your original message is retained.'}</p>}
      {current.status === 'interrupted' && <p className="hint">Retry this message or withdraw it so later messages can proceed.</p>}
      {current.status === 'settling' && <p className="hint">Later messages wait until the previous execution has stopped.</p>}
      <div className="button-row">
        {(current.status === 'processing' || current.status === 'queued') && current.attempt_id && <Button variant="outline" disabled={disabled} onClick={() => action('stop_discussion_turn')}>Stop Discussion</Button>}
        {current.status === 'interrupted' && <Button variant="outline" disabled={disabled} onClick={() => action('retry_discussion_turn')}>Retry message</Button>}
        {current.status !== 'settling' && <Button variant="ghost" disabled={disabled} onClick={() => action('withdraw_discussion_turn')}>Withdraw message</Button>}
      </div>
    </div>}
    {status.data?.working_requirement_state && <details className="subsection"><summary>Current understanding</summary><p className="discussion-content">{status.data.working_requirement_state}</p></details>}
    <form className="discussion-composer subsection" aria-label="Discussion composer" onSubmit={(event) => { event.preventDefault(); void local.execute({ schema_version: 1, request_id: crypto.randomUUID(), todo_id: id, name: 'submit_discussion_message', payload: { message_id: crypto.randomUUID(), content: state?.draft ?? '' } }); }}>
      <div className="field"><label htmlFor={composerId}>Message Planner</label><textarea id={composerId} ref={composer} rows={4} required maxLength={65536} disabled={disabled} value={state?.draft ?? ''} onChange={(event) => local.setDraft(id, event.target.value)} aria-describedby={`${composerId}-hint${state?.notice ? ` ${noticeId}` : ''}`} /><p id={`${composerId}-hint`} className="hint">{current ? 'New messages are saved and queued behind this request.' : 'Sending a message starts a Planner discussion for this Todo.'}</p></div>
      <Button type="submit" disabled={disabled || !state?.draft.trim()}>{state?.busy ? 'Saving message…' : 'Send message'}</Button>
    </form>
  </section>;
}
