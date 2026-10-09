import { randomUUID } from '../lib/browser-crypto.ts';
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  ConfigurationSnapshot,
  OwnerCommand,
  TaskOverview,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { APIError } from "../lib/api.ts";
import { taskRead } from "../lib/task-api.ts";
import type { TaskController } from "../lib/use-task-command.ts";

export interface TaskViewProps {
  task: TaskOverview;
  snapshot: ConfigurationSnapshot;
  commands: TaskController;
  onUnauthorized: () => void;
}
export const taskHref = (task: string, section = "conversation") =>
  `#task?${new URLSearchParams({ task_id: task, section })}`;
export const stateLabel: Record<TaskOverview["state"], string> = {
  PLANNING: "Ready to start",
  RUNNING: "Running",
  BLOCKED: "Needs attention",
  REPLAN_REQUIRED: "Needs a new plan",
  REVIEW: "Review",
  COMPLETED: "Done",
  CANCELLED: "Cancelled",
};
export const human = (text: string) =>
  text.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
export function useTaskRead<T>(
  props: Pick<TaskViewProps, "task" | "commands" | "onUnauthorized">,
  suffix: string,
  schema: string,
  enabled = true,
  check?: (value: T) => void,
) {
  const query = useQuery({
    queryKey: ["tasks", props.task.task_id, suffix, props.commands.sessionId],
    queryFn: async ({signal}) => {
      const value = await taskRead<T>(
        props.task.task_id,
        suffix,
        schema,
        undefined,
        props.commands.sessionId,
        signal,
      );
      check?.(value);
      return value;
    },
    enabled,
    retry: false,
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (query.error instanceof APIError && query.error.code === "unauthorized")
      props.onUnauthorized();
  }, [query.error, props.onUnauthorized]);
  return query;
}
export function useTaskPages<T>(
  props: Pick<TaskViewProps, "task" | "commands" | "onUnauthorized">,
  suffix: string,
  schema: string,
  next: (page: T) => string | undefined,
  params: Record<string, string | undefined> = {},
  enabled = true,
  check?: (value: T) => void,
) {
  const query = useInfiniteQuery({
    queryKey: ["tasks", props.task.task_id, suffix, params, props.commands.sessionId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const value = await taskRead<T>(
        props.task.task_id,
        suffix,
        schema,
        { ...params, cursor: pageParam ?? params.cursor },
        props.commands.sessionId,
        signal,
      );
      check?.(value);
      return value;
    },
    getNextPageParam: next,
    enabled,
    retry: false,
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (query.error instanceof APIError && query.error.code === "unauthorized")
      props.onUnauthorized();
  }, [query.error, props.onUnauthorized]);
  return query;
}
export function ReadProblem({
  error,
  retry,
}: {
  error: Error | null;
  retry: () => unknown;
}) {
  return error ? (
    <div className="task-notice" role="alert">
      <p>{error.message}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void retry();
        }}
      >
        Retry reading
      </Button>
    </div>
  ) : null;
}
export function More({
  hasMore,
  busy,
  load,
  label = "Load more",
}: {
  hasMore: boolean;
  busy: boolean;
  load: () => unknown;
  label?: string;
}) {
  return hasMore ? (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => {
        void load();
      }}
    >
      {busy ? "Loading…" : label}
    </Button>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="task-empty">{children}</p>;
}
export function DetailIDs({ children }: { children: ReactNode }) {
  return (
    <details className="task-advanced">
      <summary>Advanced details</summary>
      <div>{children}</div>
    </details>
  );
}
export function LazyDisclosure({
  summary,
  children,
}: {
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && children}
    </details>
  );
}
export function Datum({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="task-datum">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
export function Busy({
  commands,
  taskId,
  scope,
}: {
  commands: TaskController;
  taskId: string;
  scope: string;
}) {
  return (
    !!commands.storageError ||
    commands
      .entries(taskId)
      .some((e) => e.scope === scope && (e.busy || !!e.pending))
  );
}
export function PendingRequests({
  commands,
  taskId,
}: {
  commands: TaskController;
  taskId: string;
}) {
  return (
    <>
      {commands.storageError && (
        <p role="alert" className="task-notice">
          {commands.storageError}
        </p>
      )}
      {commands.entries(taskId).map((e) => (
        <div
          className="task-notice"
          key={e.scope}
          role={e.notice?.kind === "error" ? "alert" : "status"}
        >
          <p>
            {e.notice?.text ?? "An earlier request needs its result checked."}
          </p>
          {e.pending && (
            <>
              <p className="task-muted">
                {human(e.pending.command.name)} · Original request retained in
                this tab
              </p>
              <Button
                variant="outline"
                disabled={e.busy}
                onClick={() => {
                  void commands.recover(taskId, e.scope);
                }}
              >
                Check request result
              </Button>
            </>
          )}
          {!e.pending && !e.busy && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => commands.dismiss(taskId, e.scope)}
            >
              Dismiss notice
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
export function executeOwner(
  props: TaskViewProps,
  scope: string,
  name: OwnerCommand["name"],
  payload: OwnerCommand["payload"],
  version = props.task.control_version,
) {
  return props.commands.execute(props.task.task_id, scope, {
    family: "execution",
    command: {
      schema_version: 1,
      request_id: randomUUID(),
      scope_id: props.task.task_id,
      expected_control_version: version,
      name,
      payload,
    },
  });
}
export function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}
export function MarkdownText({ text }: { text: string }) {
  return <div className="task-prose">{text}</div>;
}
