import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConfigurationSnapshot, DiscussionMessage } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Select } from '../components/forms.tsx';
import { APIError } from '../lib/api.ts';
import { readTaskPreview } from '../lib/task-preview-api.ts';
import { previewKey } from '../lib/use-task-previews.ts';
import type { useTaskPreviews } from '../lib/use-task-previews.ts';

const reasons = {
  todo_archived: 'This Todo is archived. Continue in an active Todo to propose a Task.',
  newer_input: 'Discussion has moved on. Ask Planner for an updated Task proposal.',
  source_project_changed: 'The Todo’s Project context changed. Ask Planner for an updated Task proposal.',
  project_unavailable: 'This Project is unavailable. Select an active Project.',
};
export function TaskPreviewCard({ todoId, message, snapshot, controller, continueDiscussion, onUnauthorized }: {
  todoId: string; message: DiscussionMessage; snapshot: ConfigurationSnapshot;
  controller: ReturnType<typeof useTaskPreviews>; continueDiscussion: () => void; onUnauthorized: () => void;
}) {
  const local = controller.byProposal[previewKey(todoId, message.message_id)];
  const query = useQuery({ queryKey: ['todos', 'task-preview', todoId, message.message_id, local?.projectId], retry: false, refetchInterval: 2000,
    queryFn: () => readTaskPreview(todoId, message.message_id, local?.projectId),
  });
  useEffect(() => { if (query.error instanceof APIError && query.error.code === 'unauthorized') onUnauthorized(); }, [query.error, onUnauthorized]);
  const status = query.data; const task = status?.state === 'created' ? status.task : undefined;
  const preview = status?.preview ?? message.task_preview;
  const projectId = task?.project_id ?? local?.projectId ?? status?.selected_project_id ?? '';
  const projects = snapshot.projects.filter((project) => !project.archived);
  const projectName = snapshot.projects.find((project) => project.id === projectId)?.name ?? 'Unavailable Project';
  const locked = !!local?.pending || !!local?.busy;
  if (!preview) return null;
  return <aside className="discussion-preview" aria-label={task ? 'Created Task' : 'Proposed Task'}>
    <h3>{task?.title ?? preview.title}</h3>
    {local?.notice && <div className={`notice ${local.notice.kind}`} role={local.notice.kind === 'success' ? 'status' : 'alert'}><span>{local.notice.text}</span>
      {local.notice.kind === 'uncertain' ? <Button variant="outline" disabled={local.busy} onClick={() => { void controller.recover(todoId, message.message_id); }}>Check Task result</Button>
        : <Button variant="ghost" onClick={() => controller.dismiss(todoId, message.message_id)}>Dismiss</Button>}
    </div>}
    {local?.busy && <p role="status" className="hint">{local.pending?.name === 'cancel_task_preview' ? 'Cancelling proposal…' : 'Creating Task…'}</p>}
    {query.error && <div className="notice error" role="alert"><span>{query.error.message}</span><Button variant="outline" onClick={() => { void query.refetch(); }}>Refresh Task preview</Button></div>}
    {task ? <>
      <p className="hint">{projectName}{task.created_at && <> · Created <time dateTime={task.created_at}>{new Date(task.created_at).toLocaleString()}</time></>}</p>
      <p><span className="tag">{task.state === 'PLANNING' ? 'Ready to start' : task.state}</span></p>
      <a className="task-link" href={`#task?${new URLSearchParams({ task_id: task.task_id })}`}>View Task →</a>
    </> : <>
      <p className="hint">Proposed Task · Review the exact specification before creating.</p>
      <p className="discussion-content">{preview.specification}</p>
      {status?.state !== 'cancelled' && <Select label="Task Project" value={projectId} disabled={locked} onChange={(event) => controller.select(todoId, message.message_id, event.target.value)}>
        {!projectId && <option value="">Choose a Project</option>}
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        {projectId && !projects.some((project) => project.id === projectId) && <option value={projectId} disabled>{projectName} (unavailable)</option>}
      </Select>}
      {query.isPending && <p role="status" className="hint">Loading Task preview…</p>}
      {status?.state === 'project_required' && <p className="hint">Choose an active Project to create this Task.</p>}
      {status?.reason && <p className="hint">{reasons[status.reason]}</p>}
      {status?.state === 'cancelled' ? <p className="hint">Task proposal cancelled.</p> : <div className="button-row">
        <Button disabled={locked || query.isFetching || !!query.error || status?.state !== 'eligible'} onClick={() => { if (status) void controller.create(status); }}>Create Task</Button>
        <Button variant="outline" disabled={locked} onClick={() => { void controller.cancel(todoId, message.message_id); }}>Cancel proposal</Button>
        <Button variant="ghost" onClick={continueDiscussion}>Continue discussing</Button>
      </div>}
    </>}
  </aside>;
}
