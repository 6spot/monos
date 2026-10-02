import { useState } from "react";
import type {
  AttemptListPage,
  AttemptStatus,
  TaskPlanRevision,
  NodeExecutionStatus,
  FormalTaskEvent,
  TaskEventPage,
  TaskOverview,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { APIError } from "../lib/api.ts";
import { taskRead } from "../lib/task-api.ts";
import {
  DetailIDs,
  Empty,
  human,
  More,
  ReadProblem,
  unique,
  useTaskPages,
  useTaskRead,
} from "./task-shared.tsx";
import type { TaskViewProps } from "./task-shared.tsx";
const bookkeeping = new Set([
  "guidance_followup_prepared",
  "completion_settled_after_cancel",
  "completion_settled_for_specification_change",
  "workspace_opened",
  "operation_admitted",
  "operation_completed",
]);
function formalEvent(event: FormalTaskEvent) {
  return (
    <li key={event.sequence}>
      <span className="task-event-order">{event.sequence}</span>
      <div>
        <h3>{human(event.kind)}</h3>
        {typeof event.body.summary === "string" && (
          <p className="task-prose">{event.body.summary}</p>
        )}
        {typeof event.body.reason === "string" && (
          <p className="task-prose">{event.body.reason}</p>
        )}
        <DetailIDs>
          <pre>{JSON.stringify(event.body, null, 2)}</pre>
        </DetailIDs>
      </div>
    </li>
  );
}
export function TaskTimeline(props: TaskViewProps) {
  const [after, setAfter] = useState<string>(),
    [resetError, setResetError] = useState<Error | null>(null);
  const q = useTaskPages<TaskEventPage>(
    props,
    "/events",
    "TaskEventPage",
    (p) => (p.has_more && !p.reset_required ? p.cursor : undefined),
    { cursor: after },
  );
  const reset = q.data?.pages.some((p) => p.reset_required);
  const events = unique(q.data?.pages.flatMap((p) => p.events) ?? [], (e) =>
    String(e.sequence),
  ).sort((a, b) => a.sequence - b.sequence);
  async function resume() {
    try {
      const task = await taskRead<TaskOverview>(
        props.task.task_id,
        "",
        "TaskOverview",
        undefined,
        props.commands.sessionId,
      );
      setAfter(task.event_cursor);
      setResetError(null);
    } catch (error) {
      if (error instanceof APIError && error.code === "unauthorized")
        props.onUnauthorized();
      setResetError(
        error instanceof Error
          ? error
          : new Error("Unable to refresh the current Task"),
      );
    }
  }
  return (
    <>
      <section
        className="task-section task-timeline"
        aria-label="Formal timeline"
      >
        <h2>Timeline</h2>
        <p className="task-muted">
          Formal decisions and results in recorded order. Runtime output is in
          Execution details. Older formal events do not record a timestamp.
        </p>
        <ReadProblem
          error={q.error ?? resetError}
          retry={resetError ? resume : q.refetch}
        />
        {reset && (
          <div role="alert" className="task-notice">
            <p>
              Some formal history is unavailable. Refresh the current Task and
              continue from its recorded position.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void resume();
              }}
            >
              Continue from current state
            </Button>
          </div>
        )}
        {!events.length && !q.isPending && !reset && (
          <Empty>No formal events are available.</Empty>
        )}
        <ol>
          {events.filter((e) => !bookkeeping.has(e.kind)).map(formalEvent)}
        </ol>
        {events.some((e) => bookkeeping.has(e.kind)) && (
          <details>
            <summary>Execution bookkeeping</summary>
            <ol>
              {events.filter((e) => bookkeeping.has(e.kind)).map(formalEvent)}
            </ol>
          </details>
        )}
        <More
          hasMore={q.hasNextPage}
          busy={q.isFetchingNextPage}
          load={q.fetchNextPage}
          label="Load more events"
        />
      </section>
      <ExecutionFlow {...props} />
    </>
  );
}
function ExecutionFlow(props: TaskViewProps) {
  const q = useTaskPages<AttemptListPage>(
    props,
    "/attempts",
    "AttemptListPage",
    (p) => (p.has_more ? p.cursor : undefined),
  );
  const plan = useTaskRead<TaskPlanRevision>(
    props,
    `/plans/${encodeURIComponent(props.task.plan_id ?? "unpublished")}`,
    "TaskPlanRevision",
    !!props.task.plan_id,
  );
  const attempts = unique(
    q.data?.pages.flatMap((p) => p.attempts) ?? [],
    (a) => a.attempt_id,
  ).sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      a.attempt_id.localeCompare(b.attempt_id),
  );
  const nodeIds = [
    ...new Set(attempts.flatMap((a) => (a.node_id ? [a.node_id] : []))),
  ];
  const planners = attempts.filter((a) => a.kind === "planner");
  return (
    <section className="task-section" aria-label="Execution flow">
      <h2>Execution flow</h2>
      <p className="task-muted">
        Work items grouped across their executions. Only recorded admission and
        activity times are shown; runtime duration and completion times are
        unavailable.
      </p>
      <ReadProblem
        error={q.error ?? plan.error}
        retry={() => {
          void q.refetch();
          if (props.task.plan_id) void plan.refetch();
        }}
      />
      {!nodeIds.length && !q.isPending && (
        <Empty>No work-item executions have been admitted.</Empty>
      )}
      <ol className="task-execution-flow">
        {nodeIds.map((nodeId) => (
          <FlowWork
            key={nodeId}
            {...props}
            nodeId={nodeId}
            goal={plan.data?.nodes.find((n) => n.node_id === nodeId)?.goal}
            attempts={attempts.filter((a) => a.node_id === nodeId)}
          />
        ))}
      </ol>
      {planners.length > 0 && (
        <details>
          <summary>
            Planner activity · {planners.length} recorded executions
          </summary>
          <ul>
            {planners.map((a) => (
              <li key={a.attempt_id}>
                <span>{human(a.state.toLowerCase())} · </span>
                <time dateTime={a.created_at}>
                  {new Date(a.created_at).toLocaleString()}
                </time>{" "}
                admission
                {a.activity_at && (
                  <>
                    {" "}
                    · activity observed{" "}
                    <time dateTime={a.activity_at}>
                      {new Date(a.activity_at).toLocaleString()}
                    </time>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
        label="Load earlier execution flow"
      />
    </section>
  );
}
function FlowWork({
  nodeId,
  goal,
  attempts,
  ...props
}: TaskViewProps & {
  nodeId: string;
  goal?: string;
  attempts: AttemptStatus[];
}) {
  const status = useTaskRead<NodeExecutionStatus>(
    props,
    `/nodes/${encodeURIComponent(nodeId)}/execution`,
    "NodeExecutionStatus",
    !!goal,
  );
  const first = attempts[0],
    activity = attempts
      .flatMap((a) => (a.activity_at ? [a.activity_at] : []))
      .sort()
      .at(-1);
  return (
    <li>
      <strong>{goal ?? "Earlier work"}</strong>
      <ReadProblem error={status.error} retry={status.refetch} />
      {goal && status.data && <p>{human(status.data.state.toLowerCase())}</p>}
      <p>
        {attempts.length} recorded execution{attempts.length === 1 ? "" : "s"}
      </p>
      {first && (
        <div>
          First loaded admission{" "}
          <time dateTime={first.created_at}>
            {new Date(first.created_at).toLocaleString()}
          </time>
        </div>
      )}
      {activity && (
        <div>
          Last observed activity{" "}
          <time dateTime={activity}>{new Date(activity).toLocaleString()}</time>
        </div>
      )}
      {!goal && (
        <p className="task-muted">
          Historical work definition is outside the current Plan.
        </p>
      )}
    </li>
  );
}
