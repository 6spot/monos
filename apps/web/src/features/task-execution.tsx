import { useState } from "react";
import type {
  AttemptListPage,
  AttemptWorkspaceStatus,
  AttemptLogPage,
  AttemptStatus,
  NodeExecutionStatus,
  TaskPlanRevision,
  TaskPlanningStatus,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { NativeSelect } from "../components/ui/native-select.tsx";
import { NodeControls } from "./task-controls.tsx";
import { TaskResults } from "./task-overview.tsx";
import {
  Datum,
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

export function TaskExecution(props: TaskViewProps) {
  const plan = useTaskRead<TaskPlanRevision>(
    props,
    `/plans/${encodeURIComponent(props.task.plan_id ?? "unpublished")}`,
    "TaskPlanRevision",
    !!props.task.plan_id,
  );
  const planning = useTaskRead<TaskPlanningStatus>(
    props,
    "/planning",
    "TaskPlanningStatus",
    !props.task.plan_id,
  );
  const [selected, setSelected] = useState("");
  const nodeId = plan.data?.nodes.some((n) => n.node_id === selected)
    ? selected
    : plan.data?.nodes[0]?.node_id;
  return (
    <section className="task-execution" aria-label="Execution diagnostics">
      <h2>Execution details</h2>
      <p className="task-muted">
        Execution state, raw logs and local workspace evidence. Logs cannot
        change formal Task state.
      </p>
      <ReadProblem
        error={plan.error ?? planning.error}
        retry={() => {
          void plan.refetch();
          void planning.refetch();
        }}
      />
      {plan.data && (
        <Label>
          Work item
          <NativeSelect
            aria-label="Work item"
            value={nodeId ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {plan.data.nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                {n.goal}
              </option>
            ))}
          </NativeSelect>
        </Label>
      )}
      {nodeId ? (
        <SelectedNode key={nodeId} {...props} nodeId={nodeId} />
      ) : (
        <>
          <h3>Initial planning</h3>
          {planning.data?.attempt_id ? (
            <SelectedAttempt {...props} attemptId={planning.data.attempt_id} />
          ) : (
            <Empty>No initial planning execution has started.</Empty>
          )}
        </>
      )}
      <AttemptHistory {...props} nodeId={nodeId} />
      <TaskResults {...props} />
    </section>
  );
}
function SelectedNode({
  nodeId,
  ...props
}: TaskViewProps & { nodeId: string }) {
  const q = useTaskRead<NodeExecutionStatus>(
    props,
    `/nodes/${encodeURIComponent(nodeId)}/execution`,
    "NodeExecutionStatus",
  );
  return (
    <section className="task-section">
      <ReadProblem error={q.error} retry={q.refetch} />
      {q.data && (
        <>
          <h3>{human(q.data.state.toLowerCase())}</h3>
          <NodeControls {...props} status={q.data} />
          {q.data.attempt ? (
            <SelectedAttempt
              key={q.data.attempt.attempt_id}
              {...props}
              attemptId={q.data.attempt.attempt_id}
            />
          ) : (
            <Empty>No execution has been selected yet.</Empty>
          )}
          {q.data.operations.length > 0 && (
            <details>
              <summary>Execution operations</summary>
              <ul>
                {q.data.operations.map((o) => (
                  <li key={o.operation_id}>
                    {human(o.kind)} · {o.completion_outcome === "conflict" ? "Integration conflict · result preserved" : human(o.state)}
                    {o.failure_kind ? ` · ${human(o.failure_kind)}` : ""}
                    {" "}
                    <code>{o.operation_id}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <DetailIDs>
            <dl>
              <Datum label="Node">{nodeId}</Datum>
              <Datum label="Activation">{q.data.node_activation}</Datum>
              <Datum label="Source">
                {q.data.source?.source_id ?? "Not prepared"}
              </Datum>
            </dl>
          </DetailIDs>
        </>
      )}
    </section>
  );
}
function SelectedAttempt({
  attemptId,
  ...props
}: TaskViewProps & { attemptId: string }) {
  const status = useTaskRead<AttemptStatus>(
    props,
    `/attempts/${encodeURIComponent(attemptId)}`,
    "AttemptStatus",
  );
  const logs = useTaskPages<AttemptLogPage>(
    props,
    `/attempts/${encodeURIComponent(attemptId)}/logs`,
    "AttemptLogPage",
    (p) => (p.has_more ? p.cursor : undefined),
    {},
    status.data?.log_mode === "ordered_v1",
  );
  const entries = unique(
    logs.data?.pages.flatMap((p) => p.events) ?? [],
    (e) => `${e.stream_id}:${e.sequence}`,
  ).sort((a, b) => (a.order_sequence ?? 0) - (b.order_sequence ?? 0));
  return (
    <div className="task-attempt">
      <ReadProblem
        error={status.error ?? logs.error}
        retry={() => {
          void status.refetch();
          void logs.refetch();
        }}
      />
      {status.data && (
        <>
          <div className="task-attempt-status">
            <strong>{human(status.data.state.toLowerCase())}</strong>
            <span>
              {status.data.started ? "Execution started" : "Not started"}
            </span>
            <span>
              {status.data.process_released
                ? "Process ownership released"
                : status.data.process_absent
                  ? "Process absent; cleanup pending"
                  : "Process absence not confirmed"}
            </span>
          </div>
          <p className="task-muted">
            Created{" "}
            <time dateTime={status.data.created_at}>
              {new Date(status.data.created_at).toLocaleString()}
            </time>
            {status.data.activity_at && (
              <>
                {" "}
                · Last observed activity{" "}
                <time dateTime={status.data.activity_at}>
                  {new Date(status.data.activity_at).toLocaleString()}
                </time>
              </>
            )}
          </p>
          {status.data.end_reason && <p>{human(status.data.end_reason)}</p>}
          <ExecutionWorkspace {...props} attemptId={attemptId} />
          {status.data.log_mode === "legacy" ? (
            <p className="task-notice">
              This legacy execution has no ordered raw log history.
            </p>
          ) : (
            <>
              <h4>Raw execution log</h4>
              {!entries.length ? (
                <Empty>No captured output yet.</Empty>
              ) : (
                <pre className="task-log" aria-label="Raw execution log">
                  {entries
                    .map(
                      (e) =>
                        `${e.kind === "output" ? "" : `[${human(e.kind)}] `}${e.text}`,
                    )
                    .join("\n")}
                </pre>
              )}
              {logs.data?.pages.some((p) => p.gap_after > 0) && (
                <p className="task-notice">
                  A log gap is awaiting acknowledgement. Later output has not
                  been skipped.
                </p>
              )}
              <More
                hasMore={logs.hasNextPage}
                busy={logs.isFetchingNextPage}
                load={logs.fetchNextPage}
                label="Load more log output"
              />
            </>
          )}
          <DetailIDs>
            <dl>
              <Datum label="Execution">{attemptId}</Datum>
              <Datum label="Runner">{status.data.runner_id}</Datum>
              <Datum label="Visible log sequence">
                {status.data.visible_sequence}
              </Datum>
            </dl>
          </DetailIDs>
        </>
      )}
    </div>
  );
}
function AttemptHistory({
  nodeId,
  ...props
}: TaskViewProps & { nodeId?: string }) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState("");
  const [filter, setFilter] = useState(nodeId ? "selected" : "all");
  const q = useTaskPages<AttemptListPage>(
    props,
    "/attempts",
    "AttemptListPage",
    (p) => (p.has_more ? p.cursor : undefined),
    {},
    open,
  );
  const attempts = unique(
    q.data?.pages.flatMap((p) => p.attempts) ?? [],
    (a) => a.attempt_id,
  ).filter((a) =>
    filter === "planner"
      ? a.kind === "planner"
      : filter === "selected" && nodeId
        ? a.node_id === nodeId
        : true,
  );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Previous executions and Planner activity</summary>
      <Label>
        Execution history scope
        <NativeSelect
          aria-label="Execution history scope"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setSelected("");
          }}
        >
          {nodeId && <option value="selected">Selected work item</option>}
          <option value="all">All work, including replaced items</option>
          <option value="planner">Planner activity</option>
        </NativeSelect>
      </Label>
      <ReadProblem error={q.error} retry={q.refetch} />
      {!attempts.length && !q.isPending && (
        <Empty>No matching executions in the loaded page.</Empty>
      )}
      <ul>
        {attempts.map((a) => (
          <li key={a.attempt_id}>
            <Button variant="ghost" onClick={() => setSelected(a.attempt_id)}>
              {human(a.kind)} · {human(a.state.toLowerCase())} ·{" "}
              {new Date(a.created_at).toLocaleString()}
            </Button>
          </li>
        ))}
      </ul>
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
        label="Load earlier executions"
      />
      {selected && (
        <SelectedAttempt key={selected} {...props} attemptId={selected} />
      )}
    </details>
  );
}

function ExecutionWorkspace({
  attemptId,
  ...props
}: TaskViewProps & { attemptId: string }) {
  const q = useTaskRead<AttemptWorkspaceStatus>(
    props,
    `/attempts/${encodeURIComponent(attemptId)}/workspace`,
    "AttemptWorkspaceStatus",
  );
  return (
    <section
      className="task-section"
      aria-label="Execution environment and workspace"
    >
      <h4>Execution environment</h4>
      {q.data && (
        <>
          <dl>
            <Datum label="Runtime">
              {q.data.execution.runtime_id ?? "Not recorded"}
            </Datum>
            <Datum label="Model">
              {q.data.execution.model_id ?? "Not recorded"}
            </Datum>
            <Datum label="Thinking level">
              {q.data.execution.thinking_level ?? "Not recorded"}
            </Datum>
          </dl>
          <p className="task-muted">
            These are the choices recorded when this execution was admitted.
          </p>
        </>
      )}
      <h4>Workspace and Git</h4>
      <ReadProblem error={q.error} retry={q.refetch} />
      {q.data?.workspaces.length === 0 && (
        <p className="task-muted">No workspace was opened by this execution.</p>
      )}
      {q.data?.workspaces.map((w) => (
        <div className="task-work-card" key={w.lease_id}>
          <dl>
            <Datum label="Repository">{w.repository_identity}</Datum>
            {w.cleaned_at && (
              <Datum label="Workspace storage">
                Cleaned {new Date(w.cleaned_at).toLocaleString()}; results and history retained
              </Datum>
            )}
            <Datum label="Workspace access">
              {human(w.lease_state)} · open {human(w.open_state)}
              {w.settle_state ? ` · cleanup ${human(w.settle_state)}` : ""}
            </Datum>
            {w.metadata?.checkpoint?.completion_operation_id && (
              <Datum label="Completion recovery">
                Cleanup succeeded; private checkpoint retained
              </Datum>
            )}
            {w.failure_kind && (
              <Datum
                label={
                  w.open_state === "recovery" || w.settle_state === "recovery"
                    ? "Recovery"
                    : "Recorded failure"
                }
              >
                {human(w.failure_kind)}
              </Datum>
            )}
            {w.metadata && (
              <>
                <Datum label="Fixed base">
                  <code>{w.metadata.base_commit}</code>
                </Datum>
                <Datum label="Target branch">{w.metadata.target_branch}</Datum>
                <Datum label={w.cleaned_at ? "Recorded finalized commit" : "Verified local head"}>
                  <code>{w.metadata.finalized_commit}</code>
                </Datum>
              </>
            )}
          </dl>
          {w.metadata ? (
            <p className="task-muted">
              Metadata is the verified snapshot from this execution's identified
              operation. It does not by itself establish a completed result.
            </p>
          ) : (
            <p className="task-muted">
              Workspace opening has not yet produced verified Git metadata.
            </p>
          )}
          <DetailIDs>
            <dl>
              <Datum label="Workspace">{w.workspace_id}</Datum>
              <Datum label="Resource">{w.resource_id}</Datum>
              <Datum label="Runner">{w.runner_id}</Datum>
              <Datum label="Lease">{w.lease_id}</Datum>
              <Datum label="Metadata operation">
                {w.metadata_operation_id ?? "Not available"}
              </Datum>
            </dl>
            {w.metadata?.checkpoint && (
              <pre>{JSON.stringify(w.metadata.checkpoint, null, 2)}</pre>
            )}
          </DetailIDs>
        </div>
      ))}
    </section>
  );
}
