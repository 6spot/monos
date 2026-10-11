import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConfigurationSnapshot,
  TaskOverview,
} from "../../../../packages/protocol/generated/types.ts";
import { APIError } from "../lib/api.ts";
import { taskRead } from "../lib/task-api.ts";
import type { TaskController } from "../lib/use-task-command.ts";
import { TaskControls } from "./task-controls.tsx";
import { NodeReworkPanel } from "./node-rework.tsx";
import { TaskConversationView } from "./task-conversation.tsx";
import { TaskDecisions } from "./task-decisions.tsx";
import { TaskOverviewView } from "./task-overview.tsx";
import { TaskTimeline } from "./task-timeline.tsx";
import { TaskExecution } from "./task-execution.tsx";
import {
  PendingRequests,
  ReadProblem,
  stateLabel,
  taskHref,
} from "./task-shared.tsx";
import "./task-ui.css";
const sections = [
  ["conversation", "Conversation"],
  ["overview", "Overview"],
  ["timeline", "Timeline"],
  ["execution", "Execution details"],
] as const;
function currentSection() {
  const value = new URLSearchParams(location.hash.split("?")[1] ?? "").get(
    "section",
  );
  return sections.find((s) => s[0] === value)?.[0] ?? "conversation";
}
export function TaskDetail({
  taskId,
  snapshot,
  onUnauthorized,
  commands,
}: {
  taskId: string;
  snapshot: ConfigurationSnapshot;
  onUnauthorized: () => void;
  commands: TaskController;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    [section, setSection] = useState(currentSection);
  const q = useQuery({
    queryKey: ["tasks", taskId, "overview"],
    enabled: !!taskId,
    retry: false,
    refetchInterval: 3000,
    queryFn: () =>
      taskRead<TaskOverview>(
        taskId,
        "",
        "TaskOverview",
        undefined,
        commands.sessionId,
      ),
  });
  useEffect(() => {
    if (q.error instanceof APIError && q.error.code === "unauthorized")
      onUnauthorized();
  }, [q.error, onUnauthorized]);
  useEffect(() => {
    if (q.data) heading.current?.focus();
  }, [taskId, !!q.data]);
  useEffect(() => {
    const change = () => setSection(currentSection());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  if (!taskId) return <p role="alert">Choose a Task to view.</p>;
  if (q.isPending)
    return (
      <p role="status" className="task-empty">
        Loading Task…
      </p>
    );
  if (!q.data) return <ReadProblem error={q.error} retry={q.refetch} />;
  const task = q.data,
    props = { task, snapshot, onUnauthorized, commands };
  return (
    <article className="task-detail" aria-label="Task detail">
      <header className="task-header">
        <div className="task-breadcrumbs">
          <a href="#board">Execution board</a>
          <span>/</span>
          <a
            href={
              task.todo_id
                ? `#todos?${new URLSearchParams({ todo_id: task.todo_id })}`
                : "#todos"
            }
          >
            ← Back to Todo{task.todo_id ? "" : "s"}
          </a>
        </div>
        <div className="task-heading">
          <h1 ref={heading} tabIndex={-1}>
            {task.title ?? "Execution task"}
          </h1>
          <span className={`task-state state-${task.state.toLowerCase()}`}>
            {stateLabel[task.state]}
          </span>
        </div>
        <p className="task-muted">
          {snapshot.projects.find((p) => p.id === task.project_id)?.name ??
            "Project unavailable"}
          {task.created_at && (
            <>
              {" "}
              · Created{" "}
              <time dateTime={task.created_at}>
                {new Date(task.created_at).toLocaleString()}
              </time>
            </>
          )}
        </p>
      </header>
      <nav className="task-tabs" aria-label="Task sections">
        {sections.map(([key, label]) => (
          <a
            key={key}
            href={taskHref(taskId, key)}
            aria-current={section === key ? "page" : undefined}
            onClick={() => setSection(key)}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="task-body" key={task.task_id}>
        <ReadProblem error={q.error} retry={q.refetch} />
        <PendingRequests commands={commands} taskId={taskId} />
        <TaskControls {...props} />
        <NodeReworkPanel {...props} />
        {section === "conversation" ? (
          <>
            <TaskDecisions {...props} />
            <TaskConversationView {...props} />
          </>
        ) : section === "overview" ? (
          <TaskOverviewView {...props} />
        ) : section === "timeline" ? (
          <TaskTimeline {...props} />
        ) : (
          <TaskExecution {...props} />
        )}
      </div>
    </article>
  );
}
