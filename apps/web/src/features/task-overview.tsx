import { ResultInspector } from "./result-inspector.tsx";
import { PublicationCandidates } from "./publication-candidate.tsx";
import { RemotePreparations } from "./remote-preparation.tsx";
import { OwnerDelivery } from "./owner-delivery.tsx";
import { useState } from "react";
import type {
  ArtifactPage,
  ArtifactRecord,
  NodeExecutionStatus,
  SpecificationRevisionDetail,
  SpecificationRevisionPage,
  TaskPlanRevision,
  TaskResultPage,
} from "../../../../packages/protocol/generated/types.ts";
import { Button } from "../components/ui/button.tsx";
import { NodeControls } from "./task-controls.tsx";
import {
  Datum,
  DetailIDs,
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

export function TaskOverviewView(props: TaskViewProps) {
  return (
    <div className="task-overview">
      <section className="task-section" aria-label="Task Specification">
        <h2>Specification</h2>
        {props.task.specification === undefined ? (
          <Empty>The current Specification is unavailable as Markdown.</Empty>
        ) : (
          <div className="discussion-content">
            <MarkdownText text={props.task.specification} />
          </div>
        )}
        <DetailIDs>
          <dl>
            <Datum label="Current revision">
              {props.task.specification_id}
            </Datum>
            {props.task.initial_specification_id && (
              <Datum label="Initial revision">
                {props.task.initial_specification_id}
              </Datum>
            )}
          </dl>
        </DetailIDs>
        <RevisionHistory {...props} />
      </section>
      <TaskWork {...props} />
      <TaskResults {...props} />
      <OwnerDelivery key={`${props.commands.sessionId}:${props.task.task_id}`} {...props} />
      <RemotePreparations key={`${props.commands.sessionId}:${props.task.task_id}`} {...props} />
      <TaskArtifacts {...props} />
    </div>
  );
}
export function TaskWork(props: TaskViewProps) {
  const plan = useTaskRead<TaskPlanRevision>(
    props,
    `/plans/${encodeURIComponent(props.task.plan_id ?? "unpublished")}`,
    "TaskPlanRevision",
    !!props.task.plan_id,
  );
  return (
    <section className="task-section" aria-label="Current work">
      <h2>Current work</h2>
      {!props.task.plan_id ? (
        <Empty>
          A Plan has not been published. Initial planning has no Node progress
          yet.
        </Empty>
      ) : (
        <>
          <ReadProblem error={plan.error} retry={plan.refetch} />
          {plan.data?.nodes.map((node) => (
            <section className="task-work-card" key={node.node_id}>
              <h3>{node.goal}</h3>
              <p className="task-muted">
                {props.snapshot.roles.find((role) => role.id === node.role_id)
                  ?.name ?? "Selected role"}
              </p>
              {!!node.hard_requirements?.length && (
                <>
                  <h4>Requirements</h4>
                  <ul>
                    {node.hard_requirements.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!node.expected_outputs?.length && (
                <>
                  <h4>Expected outputs</h4>
                  <ul>
                    {node.expected_outputs.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              <WorkStatus {...props} nodeId={node.node_id} />
            </section>
          ))}
        </>
      )}
    </section>
  );
}
function WorkStatus({ nodeId, ...props }: TaskViewProps & { nodeId: string }) {
  const q = useTaskRead<NodeExecutionStatus>(
    props,
    `/nodes/${encodeURIComponent(nodeId)}/execution`,
    "NodeExecutionStatus",
  );
  return (
    <>
      <ReadProblem error={q.error} retry={q.refetch} />
      {q.data && (
        <>
          <p>{human(q.data.state.toLowerCase())}</p>
          <NodeControls {...props} status={q.data} />
        </>
      )}
    </>
  );
}
function RevisionHistory(props: TaskViewProps) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState("");
  const history = useTaskPages<SpecificationRevisionPage>(
    props,
    "/specification/revisions",
    "SpecificationRevisionPage",
    (p) => p.next_cursor ?? undefined,
    {},
    open,
  );
  const detail = useTaskRead<SpecificationRevisionDetail>(
    props,
    `/specification/revisions/${encodeURIComponent(selected || "none")}`,
    "SpecificationRevisionDetail",
    !!selected,
  );
  let content: unknown;
  try {
    content = detail.data ? JSON.parse(detail.data.content_json) : undefined;
  } catch {
    content = undefined;
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Requirement revision history</summary>
      <ReadProblem
        error={history.error ?? detail.error}
        retry={() => {
          void history.refetch();
          if (selected) void detail.refetch();
        }}
      />
      <ul>
        {unique(
          history.data?.pages.flatMap((p) => p.revisions) ?? [],
          (r) => r.specification_id,
        ).map((r) => (
          <li key={r.specification_id}>
            <Button
              variant="ghost"
              onClick={() => setSelected(r.specification_id)}
            >
              {r.specification_id === props.task.specification_id
                ? "Current revision"
                : r.parent_id
                  ? "Earlier revision"
                  : "Initial revision"}{" "}
              · {r.specification_id.slice(0, 8)}
            </Button>
          </li>
        ))}
      </ul>
      <More
        hasMore={history.hasNextPage}
        busy={history.isFetchingNextPage}
        load={history.fetchNextPage}
        label="Load more revisions"
      />
      {detail.data && (
        <section className="task-history-content">
          <h4>Selected revision</h4>
          {typeof content === "string" ? (
            <MarkdownText text={content} />
          ) : (
            <Empty>This historical revision has no Markdown content.</Empty>
          )}
          {detail.data.applicability.map((a) => (
            <p key={`${a.node_id}:${a.node_activation}`}>
              {human(a.disposition)} · work activation {a.node_activation}
              {a.completion_operation_id ? " · exact completion retained" : ""}
            </p>
          ))}
        </section>
      )}
    </details>
  );
}
export function TaskResults(props: TaskViewProps) {
  const q = useTaskPages<TaskResultPage>(
    props,
    "/results",
    "TaskResultPage",
    (p) => (p.has_more ? p.cursor : undefined),
  );
  const items = unique(
    q.data?.pages.flatMap((p) => p.items) ?? [],
    (r) => r.manifest.operation_id,
  );
  return (
    <section className="task-section" aria-label="Local results">
      <h2>Local results</h2>
      {props.task.state === "REVIEW" && (
        <p className="task-notice">
          The local result is ready for review. No PR, delivery or Owner
          acceptance is recorded by this state.
        </p>
      )}
      <ReadProblem error={q.error} retry={q.refetch} />
      {!items.length && !q.isPending && !q.error && (
        <Empty>No finalized canonical result is available yet.</Empty>
      )}
      {items.map((r) => (
        <article className="task-result" key={r.manifest.operation_id}>
          <h3>{r.current ? "Current result" : "Historical result"}</h3>
          <MarkdownText text={r.manifest.summary} />
          {r.repository_free ? (
            <p className="task-muted">
              Repository-free result · no Git commit or tree.
            </p>
          ) : (
            r.git && (
              <dl>
                <Datum label="Local commit">
                  <code>{r.git.git_commit}</code>
                </Datum>
                <Datum label="Result tree">
                  <code>{r.git.git_tree}</code>
                </Datum>
                <Datum label="Repository">
                  {r.git.metadata.repository_identity}
                </Datum>
                <Datum label="Target branch">
                  {r.git.metadata.target_branch}
                </Datum>
                <Datum label="Fixed base">
                  <code>{r.git.metadata.base_commit}</code>
                </Datum>
              </dl>
            )
          )}
          <DetailIDs>
            <dl>
              <Datum label="Original Specification">
                {r.manifest.specification_id}
              </Datum>
              <Datum label="Original Plan">{r.manifest.plan_id}</Datum>
              <Datum label="Completion manifest">
                {r.manifest.content_digest}
              </Datum>
              <Datum label="Execution">{r.manifest.attempt_id}</Datum>
              <Datum label="Formal artifacts">
                {r.manifest.artifact_ids.length
                  ? r.manifest.artifact_ids.join(", ")
                  : "None"}
              </Datum>
            </dl>
          </DetailIDs>
          {r.git && (
            <ResultInspector key={`${props.commands.sessionId}:${r.manifest.operation_id}:${r.git.identity_digest}`} props={props} result={r} />
          )}
          {r.git && <PublicationCandidates key={`publication:${props.commands.sessionId}:${r.manifest.operation_id}:${r.git.identity_digest}`} props={props} result={r} />}
        </article>
      ))}
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
        label="Load more results"
      />
    </section>
  );
}
export function TaskArtifacts(props: TaskViewProps) {
  const q = useTaskPages<ArtifactPage>(
    props,
    "/artifacts",
    "ArtifactPage",
    (p) => p.next_cursor,
  );
  const [selected, setSelected] = useState("");
  const detail = useTaskRead<ArtifactRecord>(
    props,
    `/artifacts/${encodeURIComponent(selected || "none")}`,
    "ArtifactRecord",
    !!selected,
  );
  return (
    <section className="task-section" aria-label="Formal artifacts">
      <h2>Formal artifacts</h2>
      <p className="task-muted">
        Artifact history includes earlier revisions. Current outputs are
        identified by the exact current completion manifests above.
      </p>
      <ReadProblem
        error={q.error ?? detail.error}
        retry={() => {
          void q.refetch();
          if (selected) void detail.refetch();
        }}
      />
      <ul className="task-artifacts">
        {unique(
          q.data?.pages.flatMap((p) => p.artifacts) ?? [],
          (a) => a.artifact_id,
        ).map((a) => (
          <li key={a.artifact_id}>
            <Button
              variant="outline"
              onClick={() => setSelected(a.artifact_id)}
            >
              {a.title}
            </Button>
            <span className="task-muted">{a.media_type}</span>
          </li>
        ))}
      </ul>
      {detail.data && (
        <article className="task-result">
          <h3>{detail.data.metadata.title}</h3>
          <MarkdownText text={detail.data.content.text} />
          <DetailIDs>
            <dl>
              <Datum label="Original Specification">
                {detail.data.metadata.specification_id}
              </Datum>
              <Datum label="Original Plan">
                {detail.data.metadata.plan_id}
              </Datum>
              <Datum label="Node activation">
                {detail.data.metadata.node_id} ·{" "}
                {detail.data.metadata.node_activation}
              </Datum>
              <Datum label="Execution">{detail.data.metadata.attempt_id}</Datum>
              <Datum label="Content digest">
                {detail.data.metadata.content_digest}
              </Datum>
              {detail.data.metadata.supersedes && (
                <Datum label="Supersedes">
                  {detail.data.metadata.supersedes}
                </Datum>
              )}
            </dl>
            {detail.data.metadata.references.length > 0 && (
              <pre>
                {JSON.stringify(detail.data.metadata.references, null, 2)}
              </pre>
            )}
          </DetailIDs>
        </article>
      )}
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
        label="Load more artifacts"
      />
    </section>
  );
}
