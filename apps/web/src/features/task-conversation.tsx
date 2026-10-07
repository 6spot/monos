import { useState } from "react";
import type {
  TaskConversationStatus,
  TaskHistoryPage,
  TaskInputOperation,
  TaskInputOperationPage,
  TaskGuidanceRecipientPage,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { Input } from "../components/ui/input.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Busy,
  Empty,
  human,
  MarkdownText,
  More,
  ReadProblem,
  unique,
  useTaskPages,
  useTaskRead,
} from "./task-shared.tsx";
import type { TaskViewProps } from "./task-shared.tsx";
import { ReviewConversationNotice } from "./review-correction.tsx";

export function TaskConversationView(props: TaskViewProps) {
  const [search, setSearch] = useState("");
  const status = useTaskRead<TaskConversationStatus>(
    props,
    "/conversation",
    "TaskConversationStatus",
  );
  const messages = useTaskPages<TaskHistoryPage>(
    props,
    "/conversation/messages",
    "TaskHistoryPage",
    (p) => (p.has_more ? p.cursor : undefined),
    { query: search || undefined },
  );
  const rows = unique(
    messages.data?.pages.flatMap((p) => p.messages) ?? [],
    (m) => m.message_id,
  ).sort((a, b) => a.sequence - b.sequence);
  const draft = props.commands.getDraft(
    props.task.task_id,
    "conversation",
  ).text;
  const busy = Busy({
    commands: props.commands,
    taskId: props.task.task_id,
    scope: "conversation",
  });
  const terminal = ["CANCELLED", "COMPLETED"].includes(props.task.state);
  async function send() {
    if (!draft.trim()) return;
    await props.commands.execute(props.task.task_id, "conversation", {
      family: "conversation",
      command: {
        schema_version: 1,
        request_id: crypto.randomUUID(),
        task_id: props.task.task_id,
        name: "submit_task_message",
        payload: { message_id: crypto.randomUUID(), content: draft },
      },
    });
  }
  return (
    <section className="task-conversation" aria-label="Task conversation">
      <div className="task-section-heading">
        <h2>Conversation</h2>
        <Input
          aria-label="Search conversation"
          placeholder="Search messages"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ReadProblem
        error={messages.error ?? status.error}
        retry={() => {
          void messages.refetch();
          void status.refetch();
        }}
      />
      <More
        hasMore={messages.hasNextPage}
        busy={messages.isFetchingNextPage}
        load={messages.fetchNextPage}
        label="Load earlier messages"
      />
      {!rows.length && !messages.isPending && (
        <Empty>
          {search
            ? "No matching messages."
            : "Discuss this Task with Planner. Sending a message does not start execution."}
        </Empty>
      )}
      <ol className="task-messages">
        {rows.map((m) => (
          <li className={`task-message ${m.author}`} key={m.message_id}>
            <div className="task-message-meta">
              <strong>{m.author === "owner" ? "You" : "Planner"}</strong>
              <time dateTime={m.created_at}>
                {new Date(m.created_at).toLocaleString()}
              </time>
              {m.disposition && <span>{human(m.disposition)}</span>}
            </div>
            <MarkdownText text={m.content} />
          </li>
        ))}
      </ol>
      {status.data && (
        <p className="task-muted" role="status">
          {status.data.attempt?.mutation_allowed
            ? "Planner is responding…"
            : status.data.preparation_failure
              ? human(status.data.preparation_failure)
              : status.data.waiting_reason
                ? human(status.data.waiting_reason)
                : status.data.inputs.length
                  ? "Saved inputs await Planner processing."
                  : "Conversation is up to date."}
        </p>
      )}
      {terminal && (
        <p className="task-notice">
          This Task is {props.task.state === "COMPLETED" ? "done" : "cancelled"}
          . Questions remain available. Further execution starts from a new Task
          in{" "}
          <a
            href={
              props.task.todo_id
                ? `#todos?${new URLSearchParams({ todo_id: props.task.todo_id })}`
                : "#todos"
            }
          >
            Todo Discussion
          </a>
          .
        </p>
      )}
      {props.task.accepted_delivery_operation_id && (
        <p className="task-notice">
          This result is frozen at conversation sequence {props.task.accepted_delivery_input_cutoff}.
          Later messages can be answered, but cannot change or pause the accepted delivery.
          Manage its Retry or Cancel in <a href={`#task?${new URLSearchParams({ task_id: props.task.task_id, section: "overview" })}`}>Overview</a>.
        </p>
      )}
      <ReviewConversationNotice {...props} />
      <form
        className="task-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Label htmlFor="task-message">Message to Planner</Label>
        <Textarea
          id="task-message"
          value={draft}
          maxLength={65536}
          onChange={(e) =>
            props.commands.setDraft(
              props.task.task_id,
              "conversation",
              e.target.value,
            )
          }
          placeholder={
            terminal
              ? "Ask about the completed history…"
              : props.task.accepted_delivery_operation_id
                ? "Ask about the frozen result or clarify later needs…"
              : "Ask a question, clarify requirements or give direction…"
          }
        />
        <div className="task-actions">
          <p className="task-muted">Draft saved for this Task in this tab.</p>
          <Button type="submit" disabled={busy || !draft.trim()}>
            Send message
          </Button>
        </div>
      </form>
      <TaskInputOperations {...props} />
    </section>
  );
}
export function TaskInputOperations(props: TaskViewProps) {
  const query = useTaskPages<TaskInputOperationPage>(
    props,
    "/conversation/operations",
    "TaskInputOperationPage",
    (p) => (p.has_more ? p.cursor : undefined),
  );
  const items = unique(
    query.data?.pages.flatMap((p) => p.items) ?? [],
    (i) => i.id,
  );
  return (
    <section className="task-section" aria-label="Inputs and guidance">
      <h3>Inputs and guidance</h3>
      <ReadProblem error={query.error} retry={query.refetch} />
      {items
        .filter((i) => i.available_actions.length)
        .map((i) => (
          <InputOperation key={i.id} item={i} {...props} />
        ))}
      {items.some((i) => !i.available_actions.length) && (
        <details>
          <summary>Resolved input history</summary>
          {items
            .filter((i) => !i.available_actions.length)
            .map((i) => (
              <InputOperation key={i.id} item={i} {...props} />
            ))}
        </details>
      )}
      <More
        hasMore={query.hasNextPage}
        busy={query.isFetchingNextPage}
        load={query.fetchNextPage}
        label="Load more input operations"
      />
    </section>
  );
}
function InputOperation({
  item,
  ...props
}: TaskViewProps & { item: TaskInputOperation }) {
  const scope = `input:${item.id}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  const [recipients, setRecipients] = useState(false);
  return (
    <article className="task-input-card">
      <div className="task-section-heading">
        <h4>
          {human(item.kind)} · {human(item.status)}
        </h4>
      </div>
      {item.content && (
        <MarkdownText
          text={
            item.kind === "input"
              ? "Saved input: " + item.content
              : item.content
          }
        />
      )}
      {item.accepted_delivery_operation_id && (
        <p className="task-muted">
          Originally saved outside accepted delivery {item.accepted_delivery_operation_id}.
          Its frozen evidence and original reply remain history. After revocation,
          manage any separate reconsideration decision in Overview.
        </p>
      )}
      <div className="task-actions">
        {item.available_actions.map((name) => (
          <Button
            key={name}
            variant="outline"
            disabled={busy}
            onClick={() => {
              void props.commands.execute(props.task.task_id, scope, {
                family: "conversation",
                command: {
                  schema_version: 1,
                  request_id: crypto.randomUUID(),
                  task_id: props.task.task_id,
                  name,
                  expected_version: item.version,
                  payload: { operation_id: item.id },
                },
              });
            }}
          >
            {name === "retry_task_input"
              ? "Retry input"
              : name === "withdraw_task_input"
                ? "Withdraw input"
                : "Stop Planner turn"}
          </Button>
        ))}
        {item.kind === "guidance" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRecipients(!recipients)}
          >
            Guidance recipients
          </Button>
        )}
      </div>
      {item.kind === "issue" && item.available_actions.length > 0 && (
        <p className="task-muted">
          Answer in the conversation, then use the exact remaining Retry if
          needed.
        </p>
      )}
      {recipients && <GuidanceRecipients {...props} guidanceId={item.id} />}
    </article>
  );
}
function GuidanceRecipients({
  guidanceId,
  ...props
}: TaskViewProps & { guidanceId: string }) {
  const q = useTaskPages<TaskGuidanceRecipientPage>(
    props,
    `/conversation/guidance/${encodeURIComponent(guidanceId)}/recipients`,
    "TaskGuidanceRecipientPage",
    (p) => (p.has_more ? p.cursor : undefined),
  );
  return (
    <div>
      <ReadProblem error={q.error} retry={q.refetch} />
      <ul>
        {q.data?.pages
          .flatMap((p) => p.items)
          .map((i) => (
            <li key={`${i.obligation_id}:${i.source_id ?? ""}`}>
              {human(i.status)}
              {i.launch_status ? ` · ${human(i.launch_status)}` : ""}
              <small className="task-muted">
                {" "}
                Work {i.node_id} · activation {i.node_activation}
              </small>
            </li>
          ))}
      </ul>
      <p className="task-muted">
        Inclusion in an execution does not mean the guidance was handled.
      </p>
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
      />
    </div>
  );
}
