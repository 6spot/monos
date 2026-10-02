import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  ConfigurationSnapshot,
  TaskListPage,
  TaskListItem,
  Column,
} from "../../../../packages/protocol/generated/types.ts";
import { PageHeader } from "../components/page-header.tsx";
import { Button } from "../components/ui/button.tsx";
import { NativeSelect } from "../components/ui/native-select.tsx";
import { Label } from "../components/ui/label.tsx";
import { APIError, request } from "../lib/api.ts";
import type { TaskController } from "../lib/use-task-command.ts";
import {
  Empty,
  More,
  ReadProblem,
  human,
  taskHref,
  unique,
} from "./task-shared.tsx";
import "./task-ui.css";

interface Props {
  snapshot: ConfigurationSnapshot;
  onUnauthorized: () => void;
  commands: TaskController;
}
function filters() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  return {
    project: params.get("project_id") ?? "",
    attention: params.get("attention") === "needed" ? "needed" : "all",
    history: params.get("history") === "all",
  };
}
export function ExecutionBoard(props: Props) {
  const [selected, setSelected] = useState(filters);
  useEffect(() => {
    const change = () => setSelected(filters());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  function select(next: typeof selected) {
    setSelected(next);
    const p = new URLSearchParams();
    if (next.project) p.set("project_id", next.project);
    if (next.attention === "needed") p.set("attention", "needed");
    if (next.history) p.set("history", "all");
    location.hash = `board${p.size ? "?" + p : ""}`;
  }
  const columns: { id: Column; label: string }[] = [
    { id: "ready", label: "Ready to start" },
    { id: "running", label: "Running" },
    { id: "review", label: "Review" },
    ...(selected.history
      ? [
          { id: "done" as const, label: "Done" },
          { id: "cancelled" as const, label: "Cancelled" },
        ]
      : []),
  ];
  return (
    <section className="execution-board">
      <PageHeader title="Execution board">
        <Button
          variant="outline"
          onClick={() => select({ ...selected, history: !selected.history })}
        >
          {selected.history ? "Hide history" : "Show history"}
        </Button>
      </PageHeader>
      <div className="task-toolbar">
        <Label>
          Project
          <NativeSelect
            aria-label="Project"
            value={selected.project}
            onChange={(e) => select({ ...selected, project: e.target.value })}
          >
            <option value="">All projects</option>
            {props.snapshot.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
                {p.archived ? " · Archived" : ""}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label>
          Attention
          <NativeSelect
            aria-label="Attention"
            value={selected.attention}
            onChange={(e) => select({ ...selected, attention: e.target.value })}
          >
            <option value="all">All tasks</option>
            <option value="needed">Needs attention</option>
          </NativeSelect>
        </Label>
        <p className="task-muted">
          Queue waiting is normal. Review means the local result is ready to
          inspect.
        </p>
      </div>
      <div className="board-columns">
        {columns.map((c) => (
          <BoardColumn
            key={c.id}
            {...props}
            column={c.id}
            label={c.label}
            selected={selected}
          />
        ))}
      </div>
    </section>
  );
}
function BoardColumn({
  column,
  label,
  selected,
  ...props
}: Props & {
  column: Column;
  label: string;
  selected: ReturnType<typeof filters>;
}) {
  const q = useInfiniteQuery({
    queryKey: ["board", column, selected],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({
        column,
        attention: selected.attention,
        history: selected.history ? "all" : "active",
      });
      if (selected.project) p.set("project_id", selected.project);
      if (pageParam) p.set("cursor", pageParam);
      return request<TaskListPage>(
        `/v1/owner/tasks?${p}`,
        "TaskListPage",
        undefined,
        props.commands.sessionId,
      );
    },
    getNextPageParam: (p) => (p.has_more ? p.cursor : undefined),
    retry: false,
    refetchInterval: 4000,
  });
  useEffect(() => {
    if (q.error instanceof APIError && q.error.code === "unauthorized")
      props.onUnauthorized();
  }, [q.error, props.onUnauthorized]);
  const items = unique(
    q.data?.pages.flatMap((p) => p.items) ?? [],
    (i) => i.task_id,
  );
  return (
    <section className="board-column" aria-label={label}>
      <h2 aria-label={label}>
        {label}
        <span className="task-count">
          {items.length}
          {q.hasNextPage ? "+" : ""}
        </span>
      </h2>
      <ReadProblem error={q.error} retry={q.refetch} />
      {q.isPending ? (
        <Empty>Loading tasks…</Empty>
      ) : !items.length && !q.error ? (
        <Empty>No tasks here.</Empty>
      ) : null}
      {items.map((item) => (
        <BoardCard key={item.task_id} item={item} snapshot={props.snapshot} />
      ))}
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
        label={`Load more ${label.toLowerCase()}`}
      />
    </section>
  );
}
function BoardCard({
  item,
  snapshot,
}: {
  item: TaskListItem;
  snapshot: ConfigurationSnapshot;
}) {
  const n = item.nodes,
    total = n.pending + n.running + n.blocked + n.completed + n.cancelled;
  return (
    <article className="board-card">
      <a className="board-task-title" href={taskHref(item.task_id)}>
        {item.title ?? "Execution task"}
      </a>
      <p className="task-muted">
        {snapshot.projects.find((p) => p.id === item.project_id)?.name ??
          "Project unavailable"}
      </p>
      {item.plan_id ? (
        <p>
          {n.completed} of {total} work items complete
          {item.running_attempts ? ` · ${item.running_attempts} executing` : ""}
        </p>
      ) : (
        <p>
          {item.planning_status === "not_started"
            ? "Not started"
            : item.planning_status === "stopped"
              ? "Planning stopped"
              : `Initial planning · ${human(item.planning_status ?? "details unavailable")}`}
        </p>
      )}
      {item.queued_attempts > 0 && (
        <p className="task-muted">Queued · waiting to run</p>
      )}
      {item.planning_reason && (
        <p className="task-muted">{human(item.planning_reason)}</p>
      )}
      {item.attention.length > 0 && (
        <details className="board-attention">
          <summary>
            {item.attention[0]?.reason}
            <span>
              {item.attention.length > 1
                ? ` +${item.attention.length - 1}${item.attention_has_more ? "+" : ""}`
                : ""}
            </span>
          </summary>
          <ul>
            {item.attention.map((reason) => (
              <li key={`${reason.kind}:${reason.target_id}`}>
                {reason.reason}
              </li>
            ))}
          </ul>
          <a href={taskHref(item.task_id)}>View all decisions and exits</a>
        </details>
      )}
      {!item.canonical_execution && (
        <p className="task-muted">
          Legacy execution details may be unavailable.
        </p>
      )}
      {item.state === "REVIEW" && (
        <p className="task-muted">Local result · delivery not recorded</p>
      )}
    </article>
  );
}
