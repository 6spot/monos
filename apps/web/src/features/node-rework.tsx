import type { NodeReworkStatus } from '../../../../packages/protocol/generated/types.ts';
import { Button } from '../components/ui/button.tsx';
import { Label } from '../components/ui/label.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { Busy, executeOwner, ReadProblem, useTaskRead } from './task-shared.tsx';
import type { TaskViewProps } from './task-shared.tsx';

export function useNodeRework(props: TaskViewProps) {
  return useTaskRead<NodeReworkStatus>(props, '/rework', 'NodeReworkStatus', !!props.task.plan_id);
}

export function NodeReworkPanel(props: TaskViewProps) {
  const query = useNodeRework(props), current = query.data?.current;
  const taskId = props.task.task_id, scope = 'execution';
  const busy = Busy({ commands: props.commands, taskId, scope });
  const answerKey = `rework-answer:${current?.rework_request_id ?? 'none'}`;
  const answer = props.commands.getDraft(taskId, answerKey).text;
  const enabled = !query.error && !!current && !['COMPLETED', 'CANCELLED'].includes(props.task.state);
  async function decide(name: 'apply_rework' | 'continue_without_rework') {
    if (!enabled || busy || !(name === 'apply_rework' ? current.can_apply : current.can_continue)) return;
    await executeOwner(props, scope, name, {
      rework_request_id: current.rework_request_id, expected_version: current.version,
      ...(answer.trim() ? { answer } : {}),
    }, props.task.control_version);
  }
  return <>
    <ReadProblem error={query.error} retry={query.refetch} />
    {current && <section className="task-notice" aria-label="Upstream rework">
      <h3>{current.status === 'limit_blocked' ? 'Rework needs your decision' : 'Preparing upstream rework'}</h3>
      <p className="whitespace-pre-wrap break-words">{current.reason}</p>
      {current.status === 'limit_blocked' ? <>
        <p>The {current.limit} automatic rework requests have been used. Apply this request to repeat {current.affected_node_ids.length} work items and reset the allowance, or continue the requesting work with current upstream results.</p>
        <Label>Direction for the next execution (optional)
          <Textarea aria-label="Rework direction" maxLength={65536} value={answer} onChange={event => props.commands.setDraft(taskId, answerKey, event.target.value)} />
        </Label>
        <div className="task-actions">
          <Button className="max-sm:min-h-11" disabled={!enabled || busy || !current.can_apply} onClick={() => { void decide('apply_rework'); }}>Apply rework</Button>
          <Button className="max-sm:min-h-11" variant="outline" disabled={!enabled || busy || !current.can_continue} onClick={() => { void decide('continue_without_rework'); }}>Continue without rework</Button>
        </div>
      </> : <p role="status">Stopping the requesting execution and preserving its workspace before repeating {current.affected_node_ids.length} work items. {current.automatic_requests_used} of {current.limit} automatic requests used.</p>}
      {current.waiting_reason && <p className="task-muted">{current.waiting_reason === 'waiting_for_physical_settlement' ? 'Waiting for the current process and workspace operations to finish settling.' : current.waiting_reason}</p>}
      {current.status === 'limit_blocked' && !current.can_apply && current.can_continue && <p className="task-muted">The saved upstream result has changed. You can still continue the requesting work.</p>}
    </section>}
  </>;
}
