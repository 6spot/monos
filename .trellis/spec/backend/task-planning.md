# Explicit Task Start and initial planning

## 1. Scope / Trigger

Canonical pre-Plan Task Start, Runtime selection, initial Plan/issue publication
and Owner Stop/Retry/Cancel. Owners are `task-planning.ts`,
`task-planning-state.ts`, migration 17, the shared dispatch queue and the existing
backend pump. Architecture modules 02/03/05/06 own domain meaning. Node execution,
[Task Conversation](task-conversation.md), Specification changes and replacement Plans
have separate owners. Conversation and initial planning share the Task Planner claim.

## 2. Signatures

- Owner `/v1/owner/commands`: `start_task {specification_id}`;
  `stop_initial_planning {planning_intent_id,issue_sequence?}`;
  `retry_initial_planning {planning_intent_id,issue_sequence?,answer?}`;
  pre-Plan `cancel_task {specification_id,planning_intent_id?}`.
- Every Owner command carries `scope_id`, `request_id`, exact
  `expected_control_version` and the normal session/CSRF authentication.
- Agent `publish_execution_plan {planning_intent_id,plan_id,nodes}` or
  `raise_planning_issue {planning_intent_id,reason}` returns a committed
  `EffectResult.planning_outcome` and a separate cleanup `operation_id`.
- Dispatch `task_planning_source {intent_id,specification_id,context_digest}` is
  optional for compatibility and valid only for a canonical Task Planner.
- GET `/v1/owner/tasks/:task_id/planning` -> `TaskPlanningStatus`; GET
  `/v1/owner/tasks/:task_id/plans/:plan_id` -> exact `TaskPlanRevision`.
- `task_planning_outbox` owns frozen source/basis/planned Attempt/context; Task
  pointers reference its current source and immutable issue event. An Attempt's
  `planning_intent_id` is constrained to that Task/source/planned Attempt.

## 3. Contracts

Creation stays PLANNING with no execution. Start requires an active Project and
at least one selected available Role; resources may be empty. It commits a
RUNNING source before selection, even without Runtime capacity. RUNNING Retry is
continuation; restarting a stopped PLANNING Task rechecks Start eligibility.

Lock Owner session, configuration SHARE and request serialization before
Runner/Task/source/Attempt locks. Discover candidate Runner before locking Task
and retry discovery if selection changed. RuntimeScheduling precedes caller-held
Task locks; recheck current source/head/basis even on scheduler replay.

Freeze canonical context at Start/Retry: effective Specification, current Project
and active resources, selected available Role descriptors, Planner Guidance,
fixed initial-planning protocol and ordered applicable issue/answer decisions.
Exclude full Role instructions, Todo/session/history, other Tasks, raw logs and
repository contents. SHA256 binds canonical context and exact queued prompt.
Do not clip to fit code-point or encoded Dispatch limits. Oversize creates a
retained `context_budget_exceeded` preparation failure with no executable prompt;
the pump cannot refresh it. Explicit Retry creates a new context source.

Source identity supplements claim/fence/connection/Spec/control guards. A Planner
kind alone grants no initial publication authority. Exactly one Node, no
dependencies and absent/empty `consumes` are accepted at this public Stage A
boundary; the shared graph primitive still handles 1..256 Nodes. Preserve
optional `hard_requirements`, `expected_outputs` and absent/empty arrays exactly.
No Runtime/model, full Role instructions or repository binding belongs in a Node.

Publication or issue, event, receipt, SUCCEEDED/fenced Attempt and repository-free
Stop admission share one transaction. Publication leaves a PENDING Node; cleanup
retains physical ownership until proven Stop. Committed outcome wins over later
exit. An exit without an outcome remains interrupted/failed and requires Retry.
Structural validation remains correctable within the same Attempt.

An open issue requires its exact sequence and nonblank answer for Retry. An exact
answer saved by canonical Task Conversation may supply that answer; only explicit
Owner Retry consumes it. Chat does not publish or resume planning. Pre-Plan
guidance does not stale this frozen source; Plan publication binds its recipients. Ordered
prior answers remain in subsequent contexts for that Specification. Source Retry
may record a successor while old terminal/fenced cleanup is pending; queue
promotion waits for all old owner claims/effects. Legacy attempt-targeted Retry
still requires physical release. Stop withdraws the pre-Plan request back to
PLANNING; Cancel enters CANCELLED. A published Plan blocks these pre-Plan exits.
Neither control needs a free Runtime. Owner receipts replay original semantic
responses even while their referenced cleanup is pending.

## 4. Validation & Error Matrix

| Input / condition | Result |
| --- | --- |
| Same request, changed content | `payload_conflict` |
| Stale Task version or issue sequence | `version_conflict` |
| Wrong source/head/launch binding | `stale_execution` |
| Wrong Agent phase or Task scope | `denied_scope` |
| Invalid/unknown graph fields | `invalid_input`, no phase outcome |
| Existing global Plan/Node ID | `payload_conflict`, same Attempt may correct with fresh IDs |
| Valid multiple Nodes or nonempty consumes | explicit unsupported `unmet_precondition`, no flattening |
| No available selected Role / invalid Start Project | `unmet_precondition` |
| Missing exact issue answer; active mutation on Retry | `unmet_precondition` |
| Plan already published | pre-Plan control `unmet_precondition` |
| Runtime unavailable | durable source and factual waiting reason; no fake Attempt |
| Context over budget | retained preparation failure; Stop/Cancel/Retry available |

## 5. Good / Base / Bad Cases

Good: issue commits, Owner answers once, successor waits for original Stop, then
publishes one exact Plan. Base: queued source stays visible and stops without a
model. Bad: use a latest version to revive an old intent; silently refresh frozen
context; infer a Plan from prose; release a claim from a terminal database state.

## 6. Tests Required

Real PostgreSQL must cover duplicate/different Start races with observed lock
contention, source/revision authority, unavailable/queued Stop, issue resolution,
physical settlement gates, immutable context/budgets, publication vs controls,
rollback/replay and restart. Shared schema/TS/Go checks cover the same strict wire
contracts. `infra/probe/task_planning_probe.py` supplies canonical Owner/native
evidence; fake tests cannot prove installed CLI or Linux process absence.

## 7. Wrong vs Correct

Wrong: reset a recovery operation to create a new Stop and free the original
claim, or use a fixture helper to establish production Start acceptance.

Correct: preserve original Stop identity and use validated finite reconnect
recovery for the source-bound initial Planner; prove Start through the real Owner
endpoint and immutable native command receipt.
