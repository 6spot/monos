# Explicit Start and initial Task planning design

The preceding serial-workspace leaf passed and is archived at commit `97cf6a9`.
This design adopts the researched seams in `research/backend-seams.md` under the
Owner's standing authorization to execute the roadmap without further approval.
Architecture modules 01–06 and 08 remain the source of product rules.

## Boundary and decisions

- Task creation stays PLANNING and creates no planning work. Explicit Start
  records one durable source and moves to RUNNING with no Plan. There is no new
  Task lifecycle or permanently running Planner.
- Reuse the existing backend pump, RuntimeScheduling, DispatchQueue, generic
  Task Planner Attempts, scoped receipts, immutable Plan primitives and Stop.
  Add a Task initial-planning module; do not reuse Todo context or its tables.
- This leaf ends at one immutable Plan with one PENDING Node, or a formal
  planning issue. The following Node-execution leaf consumes that membership.
- Start/restart requires an active Project and at least one selected available
  Role. Resources may be empty. Archiving a Project does not cancel a RUNNING
  planning chain; Retry of that chain is continuation. Stop/Cancel never depends
  on configuration eligibility, a Runtime slot or Runner connectivity.
- Provide source-targeted Stop and Retry, including exact issue answer + Retry.
  Provide pre-Plan `cancel_task` so the documented terminal exit is available.
  Reject post-Plan cancellation here; its orchestration/delivery guards belong
  to the following leaves. Stop is the explicit withdrawal of an initial-planning
  request and returns to PLANNING; merely answering cannot resume work.
- Current Stage A Runtime selection and one-Node limit remain explicit. No
  fallback expansion, Planner inspection, Artifact store, Task Conversation,
  requirement revision, Replan, execution board or provider publication.

## Shared protocol

All new objects are strict JSON Schema definitions, regenerated into TS/Go and
OpenAPI. Keep old envelopes/dispatches/results byte-compatible. New fields are
optional for historical data, never inferred from missing metadata.

```ts
interface ExecutionPlanNode {
  node_id: Id;
  role_id: Id;
  goal: string;                 // nonblank, <= 65,536 code points / 256 KiB
  dependencies: Id[];           // unique, bounded at 256
  hard_requirements?: string[]; // <= 64 nonblank strings, <= 4,096 code points each
  expected_outputs?: string[];  // same bounds; semantic guidance, not Artifact types
  consumes?: Id[];              // bounded/unique; Stage A accepts only absent/empty
}
interface TaskPlanningSource {
  intent_id: Id;
  specification_id: Id;
  context_digest: SHA256;
}
// Dispatch.task_planning_source?: TaskPlanningSource
// Only Task Planner, never Node/Todo; canonical empty workspace reservations.

// publish_execution_plan payload
{ planning_intent_id: Id, plan_id: Id, nodes: ExecutionPlanNode[] }
// raise_planning_issue payload
{ planning_intent_id: Id, reason: string }
// reason and Owner answer: nonblank, <= 65,536 code points / 256 KiB

// EffectResult.planning_outcome?:
{ kind: 'plan', planning_intent_id: Id, plan_id: Id }
  | { kind: 'issue', planning_intent_id: Id, issue_sequence: Counter }
```

General graph validation retains the existing 1..256-member contract and new
optional definition fields. The public initial-plan boundary accepts exactly one
Node with no dependencies. A valid larger graph produces `unmet_precondition`
with an explicit unsupported-multi-Node explanation and no publication. Nonempty
`consumes` likewise explains unsupported Artifact consumption. Malformed graphs,
unknown fields and wrong types are validation errors. Never truncate/flatten a
graph, silently discard objective requirements, or treat validation as a Runtime
failure; the same authorized Planner may correct its request or raise an issue.

No Runtime/model/thinking, full Role instructions, repository binding, branch or
filesystem path belongs in a Node definition. Preserve the existing `dependencies`
spelling and exact absent/empty optional fields in new immutable Plan content.

New initial-planning commands require the current source-bound Task Planner.
Node Agents, Todo Planners, legacy probe Planners and other Task Planner phases
cannot acquire this authority from `kind=planner` alone. Initial Planner cannot
complete its phase with the generic `commit_task_turn`; use publish or issue.
Existing read-only inspection still returns the Stage A unavailable response.

## Owner commands and reads

Reuse `/v1/owner/commands`, its Owner session/CSRF validation and immutable
`(scope_id, request_id)` receipt namespace. Every new mutation keeps exact expected
Task control version; replay checks the original digest before current guards.

| Action | Payload and behavior |
| --- | --- |
| `start_task` | `{specification_id}`. Require PLANNING/no Plan, exact viewed Specification and Start eligibility. Atomically create source, increment control version, record Start and receipt, enter RUNNING. |
| `stop_initial_planning` | Add strict `{planning_intent_id, issue_sequence?}` variant. Match current source and, when present, exact open issue. Revoke pending selection and queued/running authority, retain/admit necessary Stop, withdraw issue, record decision and return PLANNING. |
| `retry_initial_planning` | Add `{planning_intent_id, issue_sequence?, answer?}` variant. An open issue requires its exact sequence and nonblank answer together. Record answer/Retry and fresh source/context; remain RUNNING, or explicitly restart a stopped Task under Start eligibility. |
| `cancel_task` | `{specification_id, planning_intent_id?}`. Pre-Plan only, exact current Specification and source when one exists. Revoke planning, resolve its issue, record cancellation, enter CANCELLED while retaining required cleanup. Also allow a never-started PLANNING Task with no source. |

Retain legacy attempt-targeted initial Stop/Retry wire variants and receipt
semantics. For canonical planning Attempts route them through the same module so
Retry creates a real successor source and Stop cannot strand pending selection.
Old attempt-targeted Retry still requires physical release. Source-targeted Retry
may record its fresh intent after the old Attempt is logically terminal and
mutation-fenced, while cleanup is pending; promotion waits for every prior owner
claim/effect to release. Do not retry an actively mutating Planner. A published
Plan wins and prevents pre-Plan Stop/Retry/Cancel from reverting it.

`GET /v1/owner/tasks/:task_id/planning` returns a bounded `TaskPlanningStatus`:
Task/control/Specification/Plan identity; current source; optional selected Attempt
and cleanup operation; current issue sequence/reason; factual waiting/end reason;
and derived available actions. Display status may distinguish not-started, pending,
unavailable, queued, processing, settling, interrupted, issue, stopped, cancelled
and published. This is a rebuildable read projection, not persisted Task lifecycle.
Capacity queueing alone is not failure attention. Action availability is advisory;
the command backend revalidates all guards.

`GET /v1/owner/tasks/:task_id/plans/:plan_id` returns the exact immutable revision,
its Specification and definitions within Task scope. Mutable Node state stays in
the existing execution projections. Existing receipt, Attempt/log, event and
operation reads remain authoritative for diagnostics and uncertain responses.

## Persistence and context

Migration 17 adds nullable Task pointers `initial_planning_intent_id` and
`planning_issue_sequence`; the issue points to an immutable Task event. Add
`task_planning_outbox` as durable Runtime-selection bookkeeping, not a second
execution queue. It stores:

- stable source ID and Task; previous source and originating Owner request;
- effective Specification and intended post-command control version;
- one immutable `planned_attempt_id`;
- bounded frozen context/prompt and digest, plus configuration provenance;
- `done`, factual waiting reason and last-checked time for the existing pump.

Add nullable `attempts.planning_intent_id` with same-Task/source constraints;
canonical initial Attempts are Task Planner, no Node and no Plan. Enforce unique
planned Attempt, one pending source per Task and immutable source/context bindings.
Use same-Task FKs for head, previous intent, issue/answer event and Attempt. Keep
legacy rows null; do not synthesize historical Start or issue events.

Reuse `task_events` for Start, Plan publication, issue and Owner answer/Retry/Stop/
Cancel decisions. Event sequence is an issue identity, not a control-version CAS.
Use existing Owner and Agent receipts. Backend `operations` remains the Runner
effect table and never holds a fabricated no-Attempt planning operation.

Prepare semantic context at each admitted Start/Retry under configuration SHARE
and Task lock. Include fixed initial-planning protocol, Owner Planner Guidance,
the effective immutable Specification, current Project context and active resource
summary, current available selected Role descriptors (ID/name/description only),
and ordered applicable issue/answer decisions for that Specification. Repeated
issue answers remain available to later retries; do not silently forget earlier
direction. They do not mutate or override the Specification. Conflicts require
another issue or the later explicitly authorized revision flow.

Never read Todo Discussion/cache/session, another Task, repository contents or
operation logs for this context. Stable ID ordering and canonical JSON determine
the digest; keep the digest outside its own canonical input. Preserve configuration
version as provenance, not a publication CAS on unrelated settings.

Respect existing prompt code-point and encoded Dispatch/item/envelope byte limits.
Do not clip Specification, Role descriptors or applicable answers to fit. If the
complete context cannot fit, persist the source with immutable preparation-failure
reason and no executable prompt; expose `context_budget_exceeded` and allow Stop,
Cancel or explicit Retry after correction. The pump cannot silently rebuild this
same source from newer configuration. Successful context and queued prompt remain
immutable; a fresh Retry captures current facts and the latest selection policy.

## Admission, scheduling and settlement

Lock order follows existing configuration/Runner/Task ownership:

1. Owner Start: session -> configuration SHARE -> scoped request serialization ->
   Task -> source/events/receipt. Commit before Runtime selection; no capacity wait.
2. Pump: configuration SHARE -> planned-Attempt advisory -> Runner selection lock
   -> Task -> source -> Attempt. Call RuntimeScheduling before retaining any Task
   lock; recheck current source/head/Task/Spec/control in the same transaction as
   queue insertion, including scheduler replay paths. Unavailable creates no fake
   Attempt and changes only current-source waiting facts. Existing backend pump
   and shutdown tracking own bounded polling; no new service or broker.
3. Owner Stop/Retry/Cancel: session -> configuration SHARE -> request serialization;
   discover candidate Runner first, then Runner -> Task -> source -> Attempt/Stop.
   Recheck source identity after locking and repeat discovery if it changed.
4. Planner outcome: existing authenticated configuration -> Runner -> Task ->
   Attempt -> source. Require current connection, source/head/planned Attempt,
   dispatch/fence, RUNNING/no Plan, exact Spec/control and no prior terminal phase.

Extend enqueue and promotion with current planning-source guards. Reuse
`owner_key='planner:'+task_id` and existing physical capacity/locality rules. A
new source cannot promote while any old Planner claim/effect remains unresolved,
even if another Runner slot is free. New queue rows have empty canonical workspace
reservations; planning never creates a Task workspace/cache or legacy grant.

Publication calls `publishInitialPlan` while its Planner claim is still valid,
then atomically writes formal event/receipt/outcome, marks the Planner SUCCEEDED
and mutation-fenced, ends its Start outbox and admits repository-free Stop. Avoid
double incrementing control version: Plan publication already advances it. Issue
records its event/pointer and closes the phase in the same way without a Plan or
Task state change. Command response is committed semantic output with a separate
cleanup operation reference. Physical reservation persists until actual Stop.

Exit after either outcome cannot become missing-outcome failure. Exit without an
outcome remains a factual failed/interrupted Planner with no Plan and explicit
Retry; Stage A does not silently start a replacement. Stale outcomes after Owner
Stop/Retry/Cancel are rejected even with a forged latest expected version.

Implementation review found that repository-free Stop could be stranded after a
temporary host failure: normal delivery sends admitted operations only, while
process absence alone cannot release the old claim. Extend the existing finite
reconnect recovery batch narrowly to source-bound initial Task Planner Stops.
Retain the original operation, matching local recoverable failure and fencing
checks; replay terminal success without calling Host. No periodic retry loop,
backend state reset, or change to legacy/Todo recovery is part of this repair.

## Rollout and verification

Generate schemas first and coordinate backend/Runner consumers. Run complete
PostgreSQL and relevant TS/Go/Python/protocol/lint/typecheck/build checks. Test fresh
migration and version-16 upgrade with retained receipts and existing workspace
results. Reuse existing test installation on port 18444 with its deployment-only
Compose override; preserve source/binary hashes, backups and actual registration.
No new permanent service, automatic Runtime install/login, or remote publication.

Native evidence uses canonical Owner-created/confirmed Tasks and the real bundled
CLI, not the prior test-only Plan/Node admission seam. Show zero planning before
Start, real one-Node publication with objective requirements, and a real planning
issue followed by exact Owner answer/Retry and/or Stop withdrawal. Verify all
processes settle, no repository materializes, and no Node execution is claimed.
Crash/lock/queue timing is established deterministically in separate-connection
tests rather than relying on unpredictable model timing.

Before deployment, rollback is simply the uninstalled code. After migration,
retain new records; do not drop tables or reset pointers to imitate rollback.
Preserve and inspect any failed native trial before resuming its exact intent.
