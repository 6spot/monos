import type {
  NodeExecutionStatus,
  OwnerCommand,
  TaskPlanningStatus,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Busy,
  executeOwner,
  human,
  ReadProblem,
  useTaskRead,
} from "./task-shared.tsx";
import type { TaskViewProps } from "./task-shared.tsx";

export function TaskControls(props: TaskViewProps) {
  const planning = useTaskRead<TaskPlanningStatus>(
    props,
    "/planning",
    "TaskPlanningStatus",
  );
  const p = planning.data,
    task = props.task,
    scope = "execution",
    busy = Busy({ commands: props.commands, taskId: task.task_id, scope });
  const answerKey = `planning-answer:${p?.planning_source?.intent_id ?? "none"}:${p?.issue?.issue_sequence ?? 0}`;
  const answer = props.commands.getDraft(task.task_id, answerKey).text;
  const command = (
    name: OwnerCommand["name"],
    payload: OwnerCommand["payload"],
  ) =>
    executeOwner(
      props,
      scope,
      name,
      payload,
      p?.control_version ?? task.control_version,
    );
  const terminal = ["CANCELLED", "COMPLETED"].includes(task.state);
  return (
    <div className="task-controls">
      <ReadProblem error={planning.error} retry={planning.refetch} />
      {!task.plan_id && p && (
        <>
          <p className="task-muted">
            Initial planning · {human(p.status)}
            {p.waiting_reason ? ` · ${human(p.waiting_reason)}` : ""}
            {p.end_reason ? ` · ${human(p.end_reason)}` : ""}
          </p>
          {p.issue && (
            <div className="task-notice">
              <p>{p.issue.reason}</p>
              <Label>
                Planning answer
                <Textarea
                  aria-label="Planning answer"
                  value={answer}
                  onChange={(e) =>
                    props.commands.setDraft(
                      task.task_id,
                      answerKey,
                      e.target.value,
                    )
                  }
                />
              </Label>
            </div>
          )}
          <div className="task-actions">
            {task.state === "PLANNING" && (
              <Button
                disabled={busy || !p.available_actions.includes("start_task")}
                onClick={() => {
                  void command("start_task", {
                    specification_id: p.specification_id,
                  });
                }}
              >
                Start task
              </Button>
            )}
            {p.available_actions.includes("stop_initial_planning") &&
              p.planning_source && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void command("stop_initial_planning", {
                      planning_intent_id: p.planning_source?.intent_id,
                      ...(p.issue
                        ? { issue_sequence: p.issue.issue_sequence }
                        : {}),
                    });
                  }}
                >
                  Stop planning
                </Button>
              )}
            {p.available_actions.includes("retry_initial_planning") &&
              p.planning_source && (
                <Button
                  variant="outline"
                  disabled={busy || (!!p.issue && !answer.trim())}
                  onClick={() => {
                    void command("retry_initial_planning", {
                      planning_intent_id: p.planning_source?.intent_id,
                      ...(p.issue
                        ? { issue_sequence: p.issue.issue_sequence, answer }
                        : {}),
                    });
                  }}
                >
                  Retry planning
                </Button>
              )}
          </div>
          {task.state === "PLANNING" &&
            !p.available_actions.includes("start_task") && (
              <p className="task-muted">
                Starting requires an active Project and an available selected
                Role. No execution starts when this page opens.
              </p>
            )}
        </>
      )}
      {!terminal && (
        <Button
          variant="ghost"
          disabled={busy || !p}
          onClick={() => {
            void command("cancel_task", {
              specification_id: task.specification_id,
              ...(task.plan_id
                ? { plan_id: task.plan_id }
                : p?.planning_source
                  ? { planning_intent_id: p.planning_source.intent_id }
                  : {}),
            });
          }}
        >
          Cancel task
        </Button>
      )}
      {task.open_operations > 0 && (
        <p className="task-muted">
          {task.open_operations} execution or cleanup operations remain open.
          Saved decisions may still be settling.
        </p>
      )}
    </div>
  );
}
export function NodeControls({
  status,
  ...props
}: TaskViewProps & { status: NodeExecutionStatus }) {
  const s = status,
    scope = `node:${s.node_id}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  const answer = props.commands.getDraft(
    props.task.task_id,
    `node-answer:${s.blocker?.id ?? s.source?.source_id ?? s.node_id}`,
  ).text;
  const terminal = ["CANCELLED", "COMPLETED"].includes(props.task.state);
  const recovery = s.operations.filter(
    (o) => o.state === "recovery" && o.completion_identity_digest,
  );
  const completion = s.operations.some(
    (o) =>
      ["complete_node", "settle_completion"].includes(o.kind) &&
      !["succeeded", "cancelled"].includes(o.state),
  );
  const target = {
    node_id: s.node_id,
    node_activation: s.node_activation,
    source_id: s.source?.source_id,
    ...(s.blocker ? { blocker_id: s.blocker.id } : {}),
  };
  const run = (
    name: OwnerCommand["name"],
    payload: OwnerCommand["payload"] = target,
  ) => executeOwner(props, scope, name, payload, s.control_version);
  if (!s.source)
    return (
      <p className="task-muted">
        Execution source is not prepared yet. Controls become available when its
        exact source is recorded.
      </p>
    );
  return (
    <div className="task-controls">
      {s.blocker && (
        <div className="task-notice">
          <p>
            {human(s.blocker.kind)} · {s.blocker.reason}
          </p>
          {s.blocker.kind === "semantic" && (
            <Label>
              Work answer
              <Textarea
                aria-label="Work answer"
                value={answer}
                onChange={(e) =>
                  props.commands.setDraft(
                    props.task.task_id,
                    `node-answer:${s.blocker?.id ?? s.source?.source_id ?? s.node_id}`,
                    e.target.value,
                  )
                }
              />
            </Label>
          )}
        </div>
      )}
      {s.waiting_reason && s.waiting_reason !== s.blocker?.reason && (
        <p className="task-muted">{human(s.waiting_reason)}</p>
      )}
      <div className="task-actions">
        {!terminal &&
          (["PENDING", "RUNNING"].includes(s.state) ||
            (s.state === "COMPLETED" &&
              s.guidance_followup_pending &&
              !s.guidance_paused)) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void run("stop_node");
              }}
            >
              Stop work
            </Button>
          )}
        {!terminal &&
          ((s.state === "BLOCKED" && s.blocker?.kind === "owner_stopped") ||
            (s.state === "COMPLETED" &&
              s.guidance_paused &&
              s.guidance_followup_pending)) && (
            <Button
              disabled={busy || completion}
              onClick={() => {
                void run("continue_node");
              }}
            >
              Continue work
            </Button>
          )}
        {!terminal &&
          s.state === "BLOCKED" &&
          s.blocker?.kind !== "owner_stopped" && (
            <Button
              disabled={
                busy ||
                completion ||
                (s.blocker?.kind === "semantic" && !answer.trim())
              }
              onClick={() => {
                void run("retry_node", {
                  ...target,
                  ...(s.blocker?.kind === "semantic" ? { answer } : {}),
                });
              }}
            >
              Retry work
            </Button>
          )}
        {recovery.map((op) => (
          <span className="task-actions" key={op.operation_id}>
            <Button
              variant="outline"
              disabled={
                busy ||
                s.attempt?.process_released ||
                props.task.state === "COMPLETED"
              }
              onClick={() => {
                void run("recover_completion", {
                  ...target,
                  operation_id: op.operation_id,
                  completion_identity_digest: op.completion_identity_digest,
                  mode: "retry",
                });
              }}
            >
              Retry completion cleanup
            </Button>
            {!terminal && op.kind === "complete_node" && (
              <Button
                variant="outline"
                disabled={busy || s.attempt?.process_released}
                onClick={() => {
                  void run("recover_completion", {
                    ...target,
                    operation_id: op.operation_id,
                    completion_identity_digest: op.completion_identity_digest,
                    mode: "correct",
                  });
                }}
              >
                Settle before correcting
              </Button>
            )}
          </span>
        ))}
      </div>
      {completion && (
        <p className="task-muted">
          The retained completion owns recovery. Resolve its exact operation
          before retrying work.
        </p>
      )}
    </div>
  );
}
