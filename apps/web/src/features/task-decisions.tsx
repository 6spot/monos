import { useState } from "react";
import type {
  ReplanImpact,
  ReplanProposalDetail,
  ReplanRequestDetail,
  ReplanRequestSummary,
  RequirementChangeDetail,
  RequirementHistoryPage,
  RequirementImpact,
  RequirementProposalDetail,
  RequirementProposalSummary,
  SpecificationRevisionDetail,
  TaskActionBasis,
  TaskInputOperationPage,
  TaskReplanCommandName,
  TaskReplanStatus,
  TaskSpecificationCommandName,
  TaskSpecificationStatus,
} from "../../../../packages/protocol/generated/types.ts";
import { validate } from "../../../../packages/protocol/src/validation.ts";
import { Button } from "../components/ui/button.tsx";
import { Label } from "../components/ui/label.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { APIError } from "../lib/api.ts";
import {
  Busy,
  DetailIDs,
  LazyDisclosure,
  Empty,
  human,
  MarkdownText,
  More,
  ReadProblem,
  taskHref,
  unique,
  useTaskPages,
  useTaskRead,
} from "./task-shared.tsx";
import type { TaskViewProps } from "./task-shared.tsx";

function basisCurrent(basis: TaskActionBasis, props: TaskViewProps) {
  return (
    basis.control_version === props.task.control_version &&
    basis.specification_id === props.task.specification_id &&
    basis.plan_id === (props.task.plan_id ?? null)
  );
}
function specCommand(
  props: TaskViewProps,
  scope: string,
  name: TaskSpecificationCommandName,
  payload: Record<string, unknown>,
) {
  return props.commands.execute(props.task.task_id, scope, {
    family: "specification",
    command: {
      schema_version: 1,
      request_id: crypto.randomUUID(),
      task_id: props.task.task_id,
      name,
      payload,
    },
  });
}
function replanCommand(
  props: TaskViewProps,
  scope: string,
  name: TaskReplanCommandName,
  payload: Record<string, unknown>,
  review_origin?: {feedback_id:string;operation_id:string},
) {
  return props.commands.execute(props.task.task_id, scope, {
    family: "replan",
    ...(review_origin?{review_origin}:{}),
    command: {
      schema_version: 1,
      request_id: crypto.randomUUID(),
      task_id: props.task.task_id,
      name,
      payload,
    },
  });
}

export function TaskDecisions(props: TaskViewProps) {
  const spec = useTaskRead<TaskSpecificationStatus>(
    props,
    "/specification",
    "TaskSpecificationStatus",
  );
  const replans = useTaskPages<TaskReplanStatus>(
    props,
    "/replan",
    "TaskReplanStatus",
    (p) => p.next_cursor ?? undefined,
  );
  const [history, setHistory] = useState(false);
  const proposals = useTaskPages<RequirementHistoryPage>(
    props,
    "/specification/proposals",
    "RequirementHistoryPage",
    (p) => p.next_cursor ?? undefined,
    {},
    history,
  );
  const requests = unique(
    [
      ...(replans.data?.pages[0]?.current_request
        ? [replans.data.pages[0].current_request]
        : []),
      ...(replans.data?.pages.flatMap((p) => p.requests) ?? []),
    ],
    (r) => r.id,
  );
  const active =
    spec.data?.proposals.filter(
      (p) => p.current && p.status === "pending" && p.attached,
    ) ?? [];
  const past = unique(
    proposals.data?.pages.flatMap((p) => p.proposals) ?? [],
    (p) => p.proposal_id,
  ).filter((p) => !active.some((a) => a.proposal_id === p.proposal_id));
  return (
    <section className="task-decisions" aria-label="Decisions">
      <ReadProblem
        error={spec.error ?? replans.error}
        retry={() => {
          void spec.refetch();
          void replans.refetch();
        }}
      />
      {active.map((p) => (
        <RequirementCard key={p.proposal_id} {...props} proposal={p} />
      ))}
      {spec.data?.changes
        .filter(
          (c) =>
            ["settling", "withdrawing"].includes(c.status) &&
            !active.some((p) => p.proposal_id === c.proposal_id),
        )
        .map((c) => (
          <ChangeDetails
            key={c.operation_id}
            {...props}
            changeId={c.operation_id}
          />
        ))}
      {requests
        .filter((r) => r.status === "pending")
        .map((r) => (
          <ReplanCard key={r.id} {...props} request={r} />
        ))}
      {(spec.data?.proposals_has_more || spec.data?.changes_has_more) && (
        <p className="task-notice">
          The current summary is incomplete. Open All requirement and Plan
          decisions and load more proposals to reach remaining current decisions
          and their cleanup operations.
        </p>
      )}
      <details
        className="task-decision-history"
        onToggle={(e) => setHistory(e.currentTarget.open)}
      >
        <summary>All requirement and Plan decisions</summary>
        <ReadProblem error={proposals.error} retry={proposals.refetch} />
        {past.map((p) => (
          <LazyDisclosure
            key={p.proposal_id}
            summary={
              <>
                {p.summary} · {human(p.status)}
              </>
            }
          >
            <RequirementCard {...props} proposal={p} />
          </LazyDisclosure>
        ))}
        <More
          hasMore={proposals.hasNextPage}
          busy={proposals.isFetchingNextPage}
          load={proposals.fetchNextPage}
          label="Load more requirement proposals"
        />
        {requests
          .filter((r) => r.status !== "pending")
          .map((r) => (
            <LazyDisclosure
              key={r.id}
              summary={
                <>
                  {r.reason} · {human(r.status)}
                </>
              }
            >
              <ReplanCard {...props} request={r} />
            </LazyDisclosure>
          ))}
        <More
          hasMore={replans.hasNextPage}
          busy={replans.isFetchingNextPage}
          load={replans.fetchNextPage}
          label="Load more Plan requests"
        />
      </details>
      {spec.data && !["CANCELLED", "COMPLETED"].includes(props.task.state) && (
        <RequirementEditor {...props} status={spec.data} />
      )}
    </section>
  );
}
function RequirementCard({
  proposal,
  ...props
}: TaskViewProps & { proposal: RequirementProposalSummary }) {
  const q = useTaskRead<RequirementProposalDetail>(
    props,
    `/specification/proposals/${encodeURIComponent(proposal.proposal_id)}`,
    "RequirementProposalDetail",
  );
  const old = useTaskRead<SpecificationRevisionDetail>(
    props,
    `/specification/revisions/${encodeURIComponent(proposal.base_specification_id)}`,
    "SpecificationRevisionDetail",
  );
  const d = q.data,
    scope = `requirement:${proposal.proposal_id}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  const active =
    d?.proposal.current &&
    d.proposal.attached &&
    d.proposal.status === "pending" &&
    !["CANCELLED", "COMPLETED"].includes(props.task.state);
  const exact = !!d && basisCurrent(d.basis, props),
    eligible =
      active &&
      exact &&
      !d?.proposal.revoked &&
      !d?.proposal.expired &&
      !d?.operation;
  let oldContent: unknown;
  try {
    oldContent = old.data ? JSON.parse(old.data.content_json) : undefined;
  } catch {
    oldContent = undefined;
  }
  return (
    <article className="task-proposal">
      <h3>Requirements proposal</h3>
      <ReadProblem
        error={q.error ?? old.error}
        retry={() => {
          void q.refetch();
          void old.refetch();
        }}
      />
      {d && (
        <>
          <p className="task-proposal-summary">{d.proposal.summary}</p>
          <div className="task-comparison">
            <section>
              <h4>Previous requirements</h4>
              {typeof oldContent === "string" ? (
                <MarkdownText text={oldContent} />
              ) : (
                <Empty>The original basis is unavailable as Markdown.</Empty>
              )}
            </section>
            <section>
              <h4>Proposed requirements</h4>
              <MarkdownText text={d.specification} />
            </section>
          </div>
          <RequirementImpactView impact={d.impact} />
          {d.impact.graph_sufficient === false && (
            <p className="task-notice">
              This requirement change is linked to a replacement Plan. Confirm
              each exact proposal, then publish the Plan to apply both.
            </p>
          )}
          {active && !exact && !d.operation && (
            <p className="task-notice">
              The Task basis has changed. This proposal cannot inherit approval
              for the newer state. Revise through Conversation or an explicit
              new edit.
            </p>
          )}
          {d.proposal.expired && (
            <p className="task-notice">
              This proposal expired. Its original text and confirmation history
              remain available.
            </p>
          )}
          <div className="task-actions">
            {!d.confirmation_id && active && (
              <Button
                disabled={busy || !eligible || old.isPending || !!old.error}
                onClick={() => {
                  void specCommand(props, scope, "confirm_specification", {
                    proposal_id: d.proposal.proposal_id,
                    content_digest: d.proposal.content_digest,
                  });
                }}
              >
                Confirm requirements
              </Button>
            )}
            {d.confirmation_id && (
              <p className="task-muted">Exact requirements confirmed.</p>
            )}
            {d.confirmation_id &&
              d.impact.graph_sufficient &&
              active &&
              !d.operation && (
                <Button
                  disabled={busy || !eligible}
                  onClick={() => {
                    void specCommand(
                      props,
                      scope,
                      "apply_specification_revision",
                      {
                        proposal_id: d.proposal.proposal_id,
                        confirmation_id: d.confirmation_id,
                        basis: d.basis,
                      },
                    );
                  }}
                >
                  Apply confirmed requirements
                </Button>
              )}
            {active && (!d.operation || d.operation.status === "settling") && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void specCommand(props, scope, "withdraw_specification", {
                    proposal_id: d.proposal.proposal_id,
                    expected_version:
                      d.operation?.version ?? d.proposal.version,
                  });
                }}
              >
                Withdraw requirements
              </Button>
            )}
          </div>
          {d.operation && (
            <ChangeDetails {...props} changeId={d.operation.operation_id} />
          )}{" "}
          {active && (
            <InputDeferrals
              {...props}
              proposalId={proposal.proposal_id}
              family="specification"
            />
          )}
          <DetailIDs>
            <pre>
              {JSON.stringify(
                {
                  basis: d.basis,
                  content_digest: d.proposal.content_digest,
                  source_input_ids: d.source_input_ids,
                  input_cutoff: d.input_cutoff,
                },
                null,
                2,
              )}
            </pre>
          </DetailIDs>
        </>
      )}
    </article>
  );
}
function RequirementImpactView({ impact }: { impact: RequirementImpact }) {
  return (
    <section className="task-impact">
      <h4>Affected work</h4>
      {impact.reason && <p>{impact.reason}</p>}
      {impact.nodes?.length ? (
        <ul>
          {impact.nodes.map((n) => (
            <li key={n.node_id}>
              {human(n.disposition)} work activation {n.node_activation}
              {n.completion_operation_id ? " · exact existing result" : ""}
              <small className="task-muted">{n.node_id}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="task-muted">
          {impact.graph_sufficient
            ? "No current work items are affected."
            : "A replacement Plan defines the affected work."}
        </p>
      )}
      {impact.guidance?.map((g) => (
        <p key={g.guidance_id}>
          {human(g.disposition)} guidance {g.guidance_id}
        </p>
      ))}
      {impact.replan_impact && (
        <ReplanImpactView impact={impact.replan_impact} />
      )}
    </section>
  );
}
function ChangeDetails({
  changeId,
  ...props
}: TaskViewProps & { changeId: string }) {
  const q = useTaskPages<RequirementChangeDetail>(
    props,
    `/specification/changes/${encodeURIComponent(changeId)}`,
    "RequirementChangeDetail",
    (p) => p.next_cursor ?? undefined,
  );
  const operation = q.data?.pages[0]?.operation,
    scope = `requirement-operation:${changeId}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  return (
    <section className="task-change">
      <ReadProblem error={q.error} retry={q.refetch} />
      {operation && (
        <>
          <p>
            Requirement change · {human(operation.status)}
            {operation.attention ? ` · ${operation.attention}` : ""}
          </p>
          {["settling", "withdrawing"].includes(operation.status) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void specCommand(props, scope, "retry_specification", {
                  operation_id: operation.operation_id,
                  expected_version: operation.version,
                });
              }}
            >
              Retry requirement cleanup
            </Button>
          )}
          <ul>
            {unique(
              q.data?.pages.flatMap((p) => p.effects) ?? [],
              (e) => e.operation_id,
            ).map((e) => (
              <li key={e.operation_id}>
                {human(e.kind)} · {human(e.state)} ·{" "}
                {e.process_released ? "Process released" : "Ownership retained"}
                {e.failure_kind ? ` · ${human(e.failure_kind)}` : ""}
              </li>
            ))}
          </ul>
          {q.data?.pages.some((p) => p.attempts_has_more) && (
            <p className="task-muted">
              More attributed executions exist. Use the paginated execution
              history in Execution details.
            </p>
          )}
          <More
            hasMore={q.hasNextPage}
            busy={q.isFetchingNextPage}
            load={q.fetchNextPage}
            label="Load more cleanup effects"
          />
        </>
      )}
    </section>
  );
}
function ReplanCard({
  request,
  ...props
}: TaskViewProps & { request: ReplanRequestSummary }) {
  const checkRequest = (value: ReplanRequestDetail) => {
    if (value.request.id !== request.id || value.request.task_id !== props.task.task_id || value.source && value.source.request_id !== request.id || value.proposals.some(p=>p.request_id!==request.id) || !!value.request.review_feedback_id !== !!value.request.review_operation_id) throw new APIError("invalid_response","The replacement Plan read did not match this request.");
  };
  const q = useTaskPages<ReplanRequestDetail>(
    props,
    `/replan/requests/${encodeURIComponent(request.id)}`,
    "ReplanRequestDetail",
    (p) => p.next_cursor ?? undefined,
    {},
    true,
    checkRequest,
  );
  const [effectCursor, setEffectCursor] = useState<string>();
  const effectPage = useTaskRead<ReplanRequestDetail>(
    props,
    `/replan/requests/${encodeURIComponent(request.id)}${effectCursor ? "?effects_cursor=" + encodeURIComponent(effectCursor) : ""}`,
    "ReplanRequestDetail",
    !!effectCursor,
    checkRequest,
  );
  const d = q.data?.pages[0],
    r = d?.request ?? request,
    scope = `replan:${request.id}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  const answer = props.commands.getDraft(
      props.task.task_id,
      `replan-answer:${r.issue_id ?? r.id}`,
    ).text,
    direction = props.commands.getDraft(
      props.task.task_id,
      `replan-direction:${r.id}`,
    ).text;
  const proposals = unique(
    q.data?.pages.flatMap((p) => p.proposals) ?? [],
    (p) => p.proposal_id,
  );
  const active =
    r.status === "pending" &&
    !["COMPLETED", "CANCELLED"].includes(props.task.state);
  const readable = !!d && !q.error && !effectPage.error;
  return (
    <article className="task-proposal">
      <h3>Replacement Plan</h3>
      <p>{r.reason}</p>
      {r.review_feedback_id && <p className="task-notice">This replacement Plan originated from requested review changes. Dismiss returns to Review with that feedback still effective and a fresh routing successor; it does not withdraw feedback.</p>}
      <ReadProblem
        error={q.error ?? effectPage.error}
        retry={() => {
          void q.refetch();
          if (effectCursor) void effectPage.refetch();
        }}
      />
      {d?.waiting_reason && (
        <p className="task-muted">{human(d.waiting_reason)}</p>
      )}
      {d?.issue_reason && (
        <div className="task-notice">
          <p>{d.issue_reason}</p>
          <Label>
            Replan answer
            <Textarea
              aria-label="Replan answer"
              value={answer}
              onChange={(e) =>
                props.commands.setDraft(
                  props.task.task_id,
                  `replan-answer:${r.issue_id ?? r.id}`,
                  e.target.value,
                )
              }
            />
          </Label>
        </div>
      )}
      {proposals
        .filter((p) => p.current)
        .map((p) => (
          <ReplanProposal
            key={p.proposal_id}
            {...props}
            proposalId={p.proposal_id}
            request={r}
          />
        ))}
      {active && (
        <>
          <Label>
            Direction
            <Textarea
              aria-label="Direction"
              value={direction}
              placeholder="Optional direction after dismissing this request"
              onChange={(e) =>
                props.commands.setDraft(
                  props.task.task_id,
                  `replan-direction:${r.id}`,
                  e.target.value,
                )
              }
            />
          </Label>
          <div className="task-actions">
            <Button
              variant="outline"
              disabled={busy || !readable || (!!r.issue_id && !answer.trim())}
              onClick={() => {
                void replanCommand(props, scope, "retry_replan", {
                  replan_request_id: r.id,
                  expected_version: r.version,
                  ...(r.issue_id ? { issue_id: r.issue_id, answer } : {}),
                });
              }}
            >
              Retry Replan
            </Button>
            <Button
              variant="outline"
              disabled={busy || !readable}
              onClick={() => {
                void replanCommand(props, scope, "dismiss_replan", {
                  replan_request_id: r.id,
                  expected_version: r.version,
                  ...(direction.trim() ? { direction } : {}),
                },r.review_feedback_id && r.review_operation_id?{feedback_id:r.review_feedback_id,operation_id:r.review_operation_id}:undefined);
              }}
            >
              Dismiss Replan
            </Button>
          </div>
          <p className="task-muted">
            Dismissing this Plan request leaves any linked requirements
            independently actionable.
          </p>
          {r.review_feedback_id && <p className="task-muted">Manage the preserved feedback and its independent Withdraw action in <a href={taskHref(props.task.task_id,"overview")}>Overview</a>. Planner termination and successor dispatch may still be settling.</p>}
        </>
      )}
      {!r.physical_settled && (
        <p className="task-muted">
          Old process or workspace cleanup is still pending. Publication waits
          for settlement.
        </p>
      )}
      {d?.remaining_requirements.length ? (
        <p className="task-notice">
          {d.remaining_requirements.length}
          {d.requirements_has_more ? "+" : ""} linked requirement decisions
          remain. Review them in Requirements proposals.
        </p>
      ) : null}
      <details>
        <summary>Plan proposals and cleanup history</summary>
        {proposals
          .filter((p) => !p.current)
          .map((p) => (
            <LazyDisclosure key={p.proposal_id} summary="Earlier Plan proposal">
              <ReplanProposal
                {...props}
                proposalId={p.proposal_id}
                request={r}
              />
            </LazyDisclosure>
          ))}
        <More
          hasMore={q.hasNextPage}
          busy={q.isFetchingNextPage}
          load={q.fetchNextPage}
          label="Load more Plan proposals"
        />
        <ul>
          {(effectPage.data?.effects ?? d?.effects ?? []).map((e) => (
            <li key={e.operation_id}>
              {human(e.kind)} · {human(e.state)} ·{" "}
              {e.process_released ? "Released" : "Cleanup pending"}
            </li>
          ))}
        </ul>
        {(effectCursor
          ? effectPage.data?.effects_next_cursor
          : d?.effects_next_cursor) && (
          <Button
            variant="outline"
            onClick={() =>
              setEffectCursor(
                (effectCursor
                  ? effectPage.data?.effects_next_cursor
                  : d?.effects_next_cursor) ?? undefined,
              )
            }
          >
            Load next Plan effects
          </Button>
        )}
      </details>
    </article>
  );
}
function ReplanProposal({
  proposalId,
  request,
  ...props
}: TaskViewProps & { proposalId: string; request: ReplanRequestSummary }) {
  const q = useTaskRead<ReplanProposalDetail>(
    props,
    `/replan/proposals/${encodeURIComponent(proposalId)}`,
    "ReplanProposalDetail",
    true,
    (value) => {
      if (value.proposal.proposal_id!==proposalId || value.content.proposal_id!==proposalId || value.proposal.request_id!==request.id || value.content.replan_request_id!==request.id || value.content.source_id!==value.proposal.source_id) throw new APIError("invalid_response","The replacement Plan proposal did not match this request and source.");
    },
  );
  const requirementId = q.data?.proposal.requirement_proposal_id;
  const requirement = useTaskRead<RequirementProposalDetail>(
    props,
    `/specification/proposals/${encodeURIComponent(requirementId ?? "none")}`,
    "RequirementProposalDetail",
    !!requirementId,
    (value) => {
      if (value.proposal.proposal_id!==requirementId) throw new APIError("invalid_response","The linked requirement proposal did not match this Plan.");
    },
  );
  const d = q.data,
    scope = `replan-proposal:${proposalId}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  const eligible =
    !q.error && !requirement.error &&
    d?.proposal.current &&
    !d.proposal.revoked &&
    !d.proposal.expired &&
    request.status === "pending" &&
    basisCurrent(d.content.basis, props) &&
    !["COMPLETED", "CANCELLED"].includes(props.task.state);
  return (
    <section className="task-plan-proposal">
      <ReadProblem
        error={q.error ?? requirement.error}
        retry={() => {
          void q.refetch();
          if (requirementId) void requirement.refetch();
        }}
      />
      {d && (
        <>
          <p className="task-proposal-summary">{d.content.summary}</p>
          <h4>Proposed work</h4>
          {d.content.nodes.map((n) => (
            <section className="task-work-card" key={n.node_id}>
              <h4>{n.goal}</h4>
              <p>
                {props.snapshot.roles.find((r) => r.id === n.role_id)?.name ??
                  "Selected role"}
              </p>
              {n.hard_requirements?.map((r, i) => (
                <p key={i}>{r}</p>
              ))}
              {n.expected_outputs?.length && (
                <ul>
                  {n.expected_outputs.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <ReplanImpactView impact={d.content.impact} />
          {requirementId && (
            <p className="task-notice">
              Joint requirement change ·{" "}
              {requirement.data?.confirmation_id
                ? "exact requirements confirmed"
                : "confirm the exact requirements proposal separately before publication"}
              .
            </p>
          )}
          {!eligible && (
            <p className="task-muted">
              This proposal is historical, expired, revoked or based on earlier
              Task state. Retry the current request for a fresh assessment.
            </p>
          )}
          <div className="task-actions">
            {!d.confirmation_id && (
              <Button
                disabled={busy || !eligible}
                onClick={() => {
                  void replanCommand(props, scope, "confirm_replan", {
                    proposal_id: proposalId,
                    content_digest: d.proposal.content_digest,
                  });
                }}
              >
                Confirm plan
              </Button>
            )}
            {d.confirmation_id && (
              <>
                <p className="task-muted">Exact Plan confirmed.</p>
                <Button
                  disabled={
                    busy ||
                    !eligible ||
                    !request.physical_settled ||
                    (!!requirementId && !requirement.data?.confirmation_id)
                  }
                  onClick={() => {
                    void replanCommand(props, scope, "publish_replan", {
                      proposal_id: proposalId,
                      confirmation_id: d.confirmation_id,
                      basis: d.content.basis,
                      ...(requirementId
                        ? {
                            requirement_confirmation_id:
                              requirement.data?.confirmation_id,
                          }
                        : {}),
                    });
                  }}
                >
                  Publish confirmed plan
                </Button>
              </>
            )}
          </div>
          {eligible && (
            <InputDeferrals
              {...props}
              proposalId={proposalId}
              family="replan"
            />
          )}
          <DetailIDs>
            <pre>
              {JSON.stringify(
                {
                  basis: d.content.basis,
                  content_digest: d.proposal.content_digest,
                  input_cutoff: d.input_cutoff,
                },
                null,
                2,
              )}
            </pre>
          </DetailIDs>
        </>
      )}
    </section>
  );
}
function ReplanImpactView({ impact }: { impact: ReplanImpact }) {
  return (
    <section className="task-impact">
      <h4>Result and work impact</h4>
      <p>
        {human(impact.node.disposition)} existing work
        {impact.node.completion_operation_id
          ? " and its exact completed evidence"
          : ""}
        .
      </p>
      {impact.node.disposition === "replace" && (
        <p>
          A different formal work item gets a new identity. Earlier completion
          remains historical input.
        </p>
      )}
      {impact.holds.map((h, i) => (
        <p key={i}>
          {human(h.kind)} remains: {h.reason}
        </p>
      ))}
      {impact.guidance.map((g) => (
        <p key={g.guidance_id}>
          {human(g.disposition)} guidance · {g.guidance_id}
        </p>
      ))}
      {impact.workspaces.map((w) => (
        <p key={w.workspace_id}>
          {w.kind === "completed"
            ? "Inherit finalized local result"
            : "Inherit unfinished private work"}{" "}
          · {w.metadata.repository_identity}
          {w.finalized_tree && <code>{w.finalized_tree}</code>}
        </p>
      ))}
    </section>
  );
}
function InputDeferrals({
  proposalId,
  family,
  ...props
}: TaskViewProps & { proposalId: string; family: "specification" | "replan" }) {
  const [open, setOpen] = useState(false);
  const q = useTaskPages<TaskInputOperationPage>(
    props,
    "/conversation/operations",
    "TaskInputOperationPage",
    (p) => (p.has_more ? p.cursor : undefined),
    {},
    open,
  );
  const scope = `${family === "specification" ? "requirement" : "replan-proposal"}:${proposalId}`,
    busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope,
    });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Explicitly defer later inputs</summary>
      <p className="task-muted">
        Choose each input explicitly. Deferral does not withdraw guidance or
        requirements. The server checks the original proposal cutoff.
      </p>
      <ReadProblem error={q.error} retry={q.refetch} />
      {unique(q.data?.pages.flatMap((p) => p.items) ?? [], (i) => i.id)
        .filter(
          (i) => i.kind === "input" && ["pending", "failed"].includes(i.status),
        )
        .map((i) => (
          <div className="task-input-card" key={i.id}>
            <MarkdownText text={i.content ?? "Input content unavailable"} />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const payload = {
                  proposal_id: proposalId,
                  inputs: [{ input_id: i.id, version: i.version }],
                };
                void (family === "specification"
                  ? specCommand(
                      props,
                      scope,
                      "defer_specification_inputs",
                      payload,
                    )
                  : replanCommand(
                      props,
                      scope,
                      "defer_replan_inputs",
                      payload,
                    ));
              }}
            >
              Defer this input for the proposal
            </Button>
          </div>
        ))}
      <More
        hasMore={q.hasNextPage}
        busy={q.isFetchingNextPage}
        load={q.fetchNextPage}
      />
    </details>
  );
}
function RequirementEditor({
  status,
  ...props
}: TaskViewProps & { status: TaskSpecificationStatus }) {
  const saved = props.commands.getDraft(
    props.task.task_id,
    "requirements-edit",
  );
  const [open, setOpen] = useState(!!saved.basis);
  const draft = props.commands.getDraft(
      props.task.task_id,
      "requirements-edit",
    ),
    summary = props.commands.getDraft(
      props.task.task_id,
      "requirements-summary",
    ).text;
  const impactText = props.commands.getDraft(
    props.task.task_id,
    "requirements-impact",
  ).text;
  let impact: RequirementImpact | undefined;
  try {
    if (impactText)
      impact = validate<RequirementImpact>(
        "RequirementImpact",
        JSON.parse(impactText),
      );
  } catch {
    /* Retain corrupt input without sending a replacement. */
  }
  const old = useTaskRead<SpecificationRevisionDetail>(
    props,
    `/specification/revisions/${encodeURIComponent(draft.basis?.specification_id ?? props.task.specification_id)}`,
    "SpecificationRevisionDetail",
    open,
  );
  let oldText: unknown;
  try {
    oldText = old.data ? JSON.parse(old.data.content_json) : undefined;
  } catch {
    oldText = undefined;
  }
  const busy = Busy({
      commands: props.commands,
      taskId: props.task.task_id,
      scope: "requirements-edit",
    }),
    exact = draft.basis && basisCurrent(draft.basis, props);
  function begin() {
    props.commands.setDraft(
      props.task.task_id,
      "requirements-edit",
      props.task.specification ?? "",
      status.basis,
    );
    props.commands.setDraft(
      props.task.task_id,
      "requirements-impact",
      JSON.stringify(status.impact),
    );
    props.commands.clearDraft(props.task.task_id, "requirements-summary");
    setOpen(true);
  }
  return (
    <section className="task-edit">
      {!open ? (
        <Button
          variant="outline"
          onClick={() => (saved.basis ? setOpen(true) : begin())}
        >
          Edit requirements
        </Button>
      ) : (
        <>
          <h3>Apply a requirement change</h3>
          <p className="task-muted">
            Submitting approves these full requirements and the displayed
            impact, then begins the change. It does not start work.
          </p>
          <ReadProblem error={old.error} retry={old.refetch} />
          <div className="task-comparison">
            <section>
              <h4>Previous requirements</h4>
              {typeof oldText === "string" && <MarkdownText text={oldText} />}
            </section>
            <section>
              <Label>
                New requirements
                <Textarea
                  aria-label="New requirements"
                  value={draft.text}
                  maxLength={65536}
                  onChange={(e) =>
                    props.commands.setDraft(
                      props.task.task_id,
                      "requirements-edit",
                      e.target.value,
                      draft.basis,
                    )
                  }
                />
              </Label>
            </section>
          </div>
          <Label>
            Change summary
            <Textarea
              aria-label="Change summary"
              value={summary}
              maxLength={4096}
              onChange={(e) =>
                props.commands.setDraft(
                  props.task.task_id,
                  "requirements-summary",
                  e.target.value,
                )
              }
            />
          </Label>
          {impact && <RequirementImpactView impact={impact} />}{" "}
          {!exact && (
            <p className="task-notice">
              This draft retains an earlier basis. Read current requirements and
              explicitly begin a new edit to replace its basis.
            </p>
          )}
          {!impact?.graph_sufficient && (
            <p className="task-notice">
              A replacement Plan is required. Discuss the new requirements in
              Conversation to prepare the linked proposals.
            </p>
          )}
          <div className="task-actions">
            <Button
              disabled={
                busy ||
                !exact ||
                !impact?.graph_sufficient ||
                !draft.text.trim() ||
                !summary.trim() ||
                old.isPending ||
                !!old.error
              }
              onClick={() => {
                if (!draft.basis || !impact) return;
                void specCommand(
                  props,
                  "requirements-edit",
                  "edit_specification",
                  {
                    proposal_id: crypto.randomUUID(),
                    specification: draft.text,
                    summary,
                    basis: draft.basis,
                    impact,
                    source_input_ids: [],
                  },
                );
              }}
            >
              Apply requirement change
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close editor
            </Button>
            {!exact && (
              <Button variant="outline" disabled={busy} onClick={begin}>
                Begin a new edit from current requirements
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
