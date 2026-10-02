import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ConfigurationSnapshot, TodoPage, TodoRecord } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Label } from '../components/ui/label.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { PageHeading, Select } from '../components/forms.tsx';
import { APIError, request } from '../lib/api.ts';
import { useTodoCommand } from '../lib/use-todo-command.ts';
import { Discussion } from './discussion.tsx';

type Scope = { scope: TodoPage['scope']; projectId?: string };
type ProjectDraft = { projectId: string; basis: number };
function readScope(): Scope {
  const params = new URLSearchParams(location.hash.startsWith('#todos?') ? location.hash.slice(7) : '');
  const scope = params.get('scope'); const projectId = params.get('project_id');
  if (scope === 'project' && projectId) return { scope, projectId };
  return { scope: scope === 'inbox' || scope === 'archived' ? scope : 'all' };
}
function inScope(todo: TodoRecord, filter: Scope) {
  if (filter.scope === 'archived') return todo.archived;
  return !todo.archived && (filter.scope === 'all' || (filter.scope === 'inbox' ? !todo.project_id : todo.project_id === filter.projectId));
}
function scopeValue(filter: Scope) { return filter.scope === 'project' ? `project:${filter.projectId}` : filter.scope; }
function linkedTodo() { return new URLSearchParams(location.hash.startsWith('#todos?') ? location.hash.slice(7) : '').get('todo_id') ?? undefined; }

export function Todos({ snapshot, onUnauthorized }: { snapshot: ConfigurationSnapshot; onUnauthorized: () => void }) {
  const [filter, setFilter] = useState<Scope>(readScope);
  const [selected, setSelected] = useState<string | undefined>(linkedTodo);
  const [capture, setCapture] = useState(''); const [captureProject, setCaptureProject] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({});
  const captureId = useId(); const noticeId = useId();
  const captureInput = useRef<HTMLTextAreaElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  const detailColumn = useRef<HTMLElement>(null); const restoreCaptureFocus = useRef(false);
  const lastFocused = useRef<string | undefined>(undefined); const handledCommit = useRef<string | undefined>(undefined);
  const command = useTodoCommand(onUnauthorized);
  const disabled = command.busy || !!command.pending;
  const list = useInfiniteQuery({
    queryKey: ['todos', 'list', filter.scope, filter.projectId], initialPageParam: '', retry: false,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ scope: filter.scope });
      if (filter.projectId) params.set('project_id', filter.projectId);
      if (pageParam) params.set('cursor', pageParam);
      return request<TodoPage>(`/v1/owner/todos?${params}`, 'TodoPage');
    },
    getNextPageParam: (page) => page.has_more ? page.cursor : undefined,
  });
  const rows = [...new Map(list.data?.pages.flatMap((page) => page.todos).map((todo) => [todo.todo_id, todo])).values()];
  const detail = useQuery({ queryKey: ['todos', 'detail', selected], enabled: !!selected, retry: false,
    queryFn: () => { if (!selected) throw new Error('Select a Todo to open it.'); return request<TodoRecord>(`/v1/owner/todos/${encodeURIComponent(selected)}`, 'TodoRecord'); },
  });
  const todo = detail.data;
  const draft = todo ? drafts[todo.todo_id] : undefined;
  const assignment = draft?.projectId ?? todo?.project_id ?? '';
  const activeProjects = snapshot.projects.filter((project) => !project.archived);
  const projectName = (id?: string) => id ? snapshot.projects.find((project) => project.id === id)?.name ?? 'Unavailable Project' : 'Inbox';

  useEffect(() => {
    const change = () => { if (location.hash === '#todos' || location.hash.startsWith('#todos?')) { setFilter(readScope()); const id = linkedTodo(); if (id) { lastFocused.current = undefined; setSelected(id); } } };
    addEventListener('hashchange', change); return () => removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if ([list.error, detail.error].some((error) => error instanceof APIError && error.code === 'unauthorized')) onUnauthorized();
  }, [list.error, detail.error, onUnauthorized]);
  useEffect(() => {
    if (todo && !inScope(todo, filter)) {
      if (linkedTodo() === todo.todo_id) { setFilter({ scope: todo.archived ? 'archived' : 'all' }); return; }
      restoreCaptureFocus.current = document.activeElement === document.body || !!detailColumn.current?.contains(document.activeElement);
      setSelected(undefined);
    }
  }, [todo, filter]);
  useEffect(() => {
    if (!selected) {
      lastFocused.current = undefined;
      // The committed refresh can remove detail before the command enables the
      // capture form. Wait for both; never steal focus from another control.
      if (restoreCaptureFocus.current && !disabled) {
        restoreCaptureFocus.current = false;
        if (document.activeElement === document.body) captureInput.current?.focus();
      }
    }
    else if (todo && inScope(todo, filter) && lastFocused.current !== selected) { heading.current?.focus(); lastFocused.current = selected; }
  }, [selected, todo, filter, disabled]);
  useEffect(() => {
    const commit = command.committed;
    if (!commit || handledCommit.current === commit.command.request_id) return;
    handledCommit.current = commit.command.request_id;
    if (commit.command.name === 'capture_todo') {
      setCapture('');
      if (inScope(commit.todo, filter)) setSelected(commit.todo.todo_id);
    } else if (commit.command.name === 'assign_todo_project') {
      setDrafts((all) => { const next = { ...all }; delete next[commit.todo.todo_id]; return next; });
    }
  }, [command.committed, filter]);

  function changeScope(value: string) {
    const next: Scope = value.startsWith('project:') ? { scope: 'project', projectId: value.slice(8) } : { scope: value === 'inbox' || value === 'archived' ? value : 'all' };
    setFilter(next); if (!todo || !inScope(todo, next)) setSelected(undefined);
    const params = new URLSearchParams({ scope: next.scope }); if (next.projectId) params.set('project_id', next.projectId);
    location.hash = `todos?${params}`;
  }
  function clearDraft(id: string) { setDrafts((all) => { const next = { ...all }; delete next[id]; return next; }); }
  function backToList() { const id = selected; setSelected(undefined); requestAnimationFrame(() => document.getElementById(`todo-row-${id}`)?.focus()); }

  return <>
    <PageHeading title="Todos" description="Capture ideas and discuss each one with Planner." />
    {command.notice && <div id={noticeId} className={`notice ${command.notice.kind}`} role={command.notice.kind === 'success' ? 'status' : 'alert'}>
      <span>{command.notice.text}</span>{command.notice.kind === 'uncertain' ? <Button variant="outline" disabled={command.busy} onClick={() => { void command.recover(); }}>Check Todo result</Button> : <Button variant="ghost" onClick={command.dismiss}>Dismiss</Button>}
    </div>}
    {command.busy && <p className="save-progress" role="status">Saving Todo…</p>}
    <div className={`todo-workspace${selected ? ' has-selection' : ''}`}>
      <aside className="todo-list-column" aria-label="Todo list">
        <Select label="Todo scope" value={scopeValue(filter)} onChange={(event) => changeScope(event.target.value)}>
          <option value="all">All active</option><option value="inbox">Inbox</option><option value="archived">Archived</option>
          {snapshot.projects.filter((project) => !project.archived || project.id === filter.projectId).map((project) => <option key={project.id} value={`project:${project.id}`}>{project.name}{project.archived ? ' (archived)' : ''}</option>)}
        </Select>
        <form className="todo-capture" aria-label="Quick capture" onSubmit={(event) => {
          event.preventDefault(); void command.execute({ schema_version: 1, request_id: crypto.randomUUID(), name: 'capture_todo', payload: { todo_id: crypto.randomUUID(), original_capture: capture, ...(captureProject ? { project_id: captureProject } : {}) } });
        }}>
          <fieldset disabled={disabled}>
            <div className="field"><Label htmlFor={captureId}>Capture an idea</Label><Textarea id={captureId} ref={captureInput} rows={3} required maxLength={65536} value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="What's on your mind?" aria-describedby={`${captureId}-hint${command.notice ? ` ${noticeId}` : ''}`} /><p id={`${captureId}-hint`} className="hint">Your original words stay intact.</p></div>
            <Select label="Capture Project (optional)" value={captureProject} onChange={(event) => setCaptureProject(event.target.value)}>
              <option value="">Inbox — no Project</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              {captureProject && !activeProjects.some((project) => project.id === captureProject) && <option value={captureProject} disabled>{projectName(captureProject)} (unavailable)</option>}
            </Select>
            <Button type="submit" disabled={disabled || !capture.trim()}>Capture Todo</Button>
          </fieldset>
        </form>
        <div className="todo-list-tools"><span className="hint">Recent activity</span><Button variant="ghost" disabled={list.isFetching} onClick={() => { void list.refetch(); if (selected) void detail.refetch(); }}>Refresh Todos</Button></div>
        {list.isPending && <p role="status" className="empty-list">Loading Todos…</p>}
        {list.error && <p role="alert" className="form-error">{list.error.message}</p>}
        <div className="todo-rows">{rows.map((row) => <button id={`todo-row-${row.todo_id}`} type="button" key={row.todo_id} className={`record todo-row${row.todo_id === selected ? ' selected' : ''}`} aria-pressed={row.todo_id === selected} onClick={() => setSelected(row.todo_id)}>
          <span>{row.label}</span><small>{filter.scope !== 'project' && <span className="todo-project-label">{projectName(row.project_id)}</span>}<time dateTime={row.discussion_activity_at}>{new Date(row.discussion_activity_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></small>
        </button>)}</div>
        {!list.isPending && !list.error && !rows.length && <p className="empty-list">{filter.scope === 'archived' ? 'No archived Todos.' : 'No Todos here yet. Capture an idea above.'}</p>}
        {list.hasNextPage && <Button variant="outline" disabled={list.isFetching} onClick={() => { void list.fetchNextPage(); }}>{list.isFetchingNextPage ? 'Loading more…' : 'Load more Todos'}</Button>}
      </aside>
      <section ref={detailColumn} className="todo-detail-column" aria-label="Selected Todo">
        {selected ? <>
          <Button className="todo-back" variant="ghost" onClick={backToList}>← Back to Todos</Button>
          {detail.isPending && <p className="loading-state" role="status">Opening Todo…</p>}
          {detail.error && <div className="card editor"><p role="alert">{detail.error.message}</p><Button variant="outline" onClick={() => { void detail.refetch(); }}>Retry opening Todo</Button></div>}
          {todo && inScope(todo, filter) && <article className="todo-detail">
            <div className="section-label"><h2 ref={heading} tabIndex={-1}>{todo.label}</h2><span className="tag">{todo.archived ? 'Archived' : 'Active'}</span></div>
            <p className="hint">{projectName(todo.project_id)}{snapshot.projects.find((project) => project.id === todo.project_id)?.archived ? ' (archived Project)' : ''}</p>
            <section className="subsection" aria-label="Original Capture"><h3>Original Capture</h3><p className="todo-original">{todo.original_capture}</p><p className="hint">Captured <time dateTime={todo.created_at}>{new Date(todo.created_at).toLocaleString()}</time></p></section>
            <details key={todo.todo_id} className="todo-organization"><summary>Organize Todo</summary>
            <form className="subsection" aria-label="Todo organization" onSubmit={(event) => { event.preventDefault(); void command.execute({ schema_version: 1, request_id: crypto.randomUUID(), name: 'assign_todo_project', expected_control_version: draft?.basis ?? todo.control_version, payload: { todo_id: todo.todo_id, ...(assignment ? { project_id: assignment } : {}) } }); }}>
              <fieldset disabled={disabled}><h3>Organization</h3><Select label="Todo Project" value={assignment} onChange={(event) => setDrafts((all) => ({ ...all, [todo.todo_id]: { projectId: event.target.value, basis: draft?.basis ?? todo.control_version } }))}>
                <option value="">Inbox — no Project</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                {assignment && !activeProjects.some((project) => project.id === assignment) && <option value={assignment} disabled>{projectName(assignment)} (unavailable)</option>}
              </Select><div className="button-row"><Button type="submit" disabled={disabled || !draft}>Save Project</Button>{draft && <Button type="button" variant="outline" onClick={() => clearDraft(todo.todo_id)}>Reload saved Project</Button>}</div>{draft && <p className="hint">Unsaved Project change</p>}</fieldset>
            </form>
            <div className="subsection"><p className="hint">{todo.archived ? 'Restore this Todo to your active ideas.' : 'Archive this Todo when you want to set it aside.'}</p><Button variant="outline" disabled={disabled} onClick={() => { void command.execute({ schema_version: 1, request_id: crypto.randomUUID(), name: 'set_todo_archived', expected_control_version: todo.control_version, payload: { todo_id: todo.todo_id, archived: !todo.archived } }); }}>{todo.archived ? 'Restore Todo' : 'Archive Todo'}</Button></div>
            </details>
          </article>}
        </> : <div className="empty-state"><h2>No Todo selected</h2><p>Select a Todo from the list to view its original capture or start a discussion.</p><Button variant="outline" onClick={() => captureInput.current?.focus()}>Create Todo</Button></div>}
        <Discussion todo={todo && inScope(todo, filter) ? todo : undefined} snapshot={snapshot} onUnauthorized={onUnauthorized} />
      </section>
    </div>
  </>;
}
