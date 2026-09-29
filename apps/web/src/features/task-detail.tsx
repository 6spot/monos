import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigurationSnapshot } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { APIError } from '../lib/api.ts';
import { readTask } from '../lib/task-preview-api.ts';

export function TaskDetail({ taskId, snapshot, onUnauthorized }: { taskId: string; snapshot: ConfigurationSnapshot; onUnauthorized: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({ queryKey: ['tasks', taskId], enabled: !!taskId, retry: false, queryFn: () => readTask(taskId) });
  useEffect(() => { if (query.error instanceof APIError && query.error.code === 'unauthorized') onUnauthorized(); }, [query.error, onUnauthorized]);
  useEffect(() => { if (query.data) heading.current?.focus(); }, [taskId, !!query.data]);
  if (!taskId) return <p role="alert">Choose a Task to view.</p>;
  if (query.isPending) return <p role="status">Loading Task…</p>;
  if (query.error) return <div className="card editor"><p role="alert">{query.error.message}</p><Button variant="outline" onClick={() => { void query.refetch(); }}>Retry opening Task</Button></div>;
  const task = query.data;
  return <article className="card editor task-detail" aria-label="Task detail">
    <a className="task-link" href={task.todo_id ? `#todos?${new URLSearchParams({ todo_id: task.todo_id })}` : '#todos'}>← Back to Todo{task.todo_id ? '' : 's'}</a>
    <div className="section-label"><h1 ref={heading} tabIndex={-1}>{task.title ?? 'Task'}</h1><span className="tag">{task.state === 'PLANNING' ? 'Ready to start' : task.state}</span></div>
    <p className="hint">{task.project_id ? snapshot.projects.find((project) => project.id === task.project_id)?.name ?? 'Unavailable Project' : 'Project unavailable'}{task.created_at && <> · Created <time dateTime={task.created_at}>{new Date(task.created_at).toLocaleString()}</time></>}</p>
    <section className="subsection" aria-label="Task Specification"><h2>Specification</h2>
      {task.specification === undefined ? <p className="inline-note">The current Specification is unavailable as Markdown.</p> : <p className="discussion-content">{task.specification}</p>}
    </section>
  </article>;
}
