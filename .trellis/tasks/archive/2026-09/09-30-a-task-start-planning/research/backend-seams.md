# Backend seams for explicit Task Start and initial planning

Research only, 2026-09-30. The active task remains `09-30-a-serial-workspaces`;
its native Stop/export recovery fix is still being integrated in Runner/harness.
This note does not activate the next task, change product code, deploy, or claim
next-leaf acceptance. Backend/protocol anchors below describe the current shared
working tree; reread affected Runner code after current-leaf acceptance.

Read: this leaf's PRD, parent `research/decomposition.md`, `ARCHITECTURE.md`, modules
02/03/05/06/08, the relevant configuration paragraphs in module 01 and Stage A
boundary in module 09, plus backend Task-record, dispatch, scheduling, Discussion,
Owner-command/read/database and protocol-command/generation specs.

## Recommendation and scope

Add one Task-owned durable **selection intent**, a bounded initial-planning context
builder and two formal Planner commands around existing APIs. Reuse generic
Attempts, the shared Runtime queue, Owner/Attempt receipts, immutable Plan tables,
Task events and repository-free Stop. There is no need for a PlannerInvocation,
new Task state, Task Conversation/message store, second queue service, or permanent
Planner process.

The independent acceptance boundary is RUNNING + one immutable Plan + one PENDING
Node, or RUNNING + an attributed planning issue. Publishing does not execute the
Node in this leaf; production Node scheduling belongs to leaf 3. Planner repository
inspection, Artifact publication/consumption, UI, requirement revision and Task
Conversation remain later work. Initial Plan publication needs no new Owner graph
confirmation; only replacement/Replan has that requirement.

## Decisions already resolved by the architecture

| Question | Decision and authority |
| --- | --- |
| Does creation or opening a Task invoke planning? | No. Only explicit Start changes PLANNING to RUNNING and writes durable work. `docs/03-runtime-and-execution.md:238`; `docs/06-state-and-formal-data.md:403`. |
| What is eligible to Start? | Existing canonical Task, no Plan, PLANNING, active Project and at least one selected available Role. An empty resource list is permitted. Archived Projects reject new starts but do not stop already-started Tasks; `docs/01-product-and-domain.md:162`. Retry of a still-RUNNING chain is continuation; Start after Stop is a new start and requires the Project restored. |
| What if Runtime/policy is unavailable or slots are full? | Unavailable selection preserves RUNNING/no Plan with a reason and no fake Attempt; a selected healthy target at capacity creates ordinary QUEUED work. Neither becomes BLOCKED. `docs/03-runtime-and-execution.md:131`, `:158`, `:264`. |
| Is a planning issue a failure or new Task state? | No. It is the phase's committed formal outcome and ends mutation authority, with an issue event/attention while Task remains RUNNING. It must not trigger fallback. `docs/02-planner-and-planning.md:380`; `docs/03-runtime-and-execution.md:532`. |
| How does the Owner leave an issue? | Answer + explicit Retry, Stop back to PLANNING before a Plan exists, or Cancel. Stop must also work without any selected Attempt. Withdrawal of this initial-planning request is Stop, not an automatic dismissal that resumes work. `docs/02-planner-and-planning.md:382`; `docs/03-runtime-and-execution.md:280`; `docs/08-principles-and-non-goals.md:99`. |
| Can an answer silently change requirements? | No. It is Task-scoped direction under the effective Specification. If requirements must change, keep a planning issue or Stop for the later authorized revision flow. No Task Working Requirement State. `docs/02-planner-and-planning.md:382`; `docs/01-product-and-domain.md:176`. |
| Does Retry resume a provider session or an old prompt? | No requirement to do either. Fresh Attempt, current canonical context and current policy, with retained issue/answer provenance. Todo history/cache/session must never enter it. `docs/02-planner-and-planning.md:76`, `:115`; `docs/03-runtime-and-execution.md:275`, `:526`. |
| Are model fallback, multi-Node orchestration or one fixed workflow needed? | No. Keep Stage A's supported target and explicit unsupported-plan result; do not flatten graphs or invent a workflow template. `docs/09-first-executable-slice.md:31`, `:39`. |

The Owner's standing authorization covers sequential implementation and routine
schema/test decisions. It does not change the product's authenticated commands or
exact-content revision/creation rules. No new permission question is needed for
the work described here; no live model/host action was performed for this research.

## Reusable source seams and actual gaps

| Source anchor | Reuse / required extension |
| --- | --- |
| `apps/server/src/task-records.ts:49` | `initializeTask` already creates PLANNING with immutable Specification and no Plan/Node/Attempt/outbox. Preserve that zero-execution boundary. |
| `apps/server/src/task-records.ts:63` | `publishInitialPlan(tx, {task_id,plan_id,expected,nodes,claim})` checks live Planner/fence, its launch Specification, RUNNING/no Plan, current control/Spec/Plan and Project Roles; inserts complete graph and activation 1 and switches the Plan pointer atomically. It does **not** write a command receipt, formal phase outcome, event, revoke the Planner or admit Stop. The command owner must compose those effects in its transaction. |
| `apps/server/src/task-records.ts:9`, `:26` | `PlanNode` only types `node_id,role_id,goal,dependencies`; generic validation allows 1..256 Nodes and does not reject unknown definition fields. Objective requirements/output hints are not a wire contract yet. Keep the generic graph primitive multi-Node capable; enforce Stage A at its public command boundary. |
| `apps/server/src/service.ts:199`, `:223` | Existing signed Attempt admission already authenticates dispatch/fence/scope and does receipt-first replay under configuration -> Runner -> Task -> Attempt. Add a branch for the authenticated initial-planning source before generic fixture/workspace effect routing; never treat a Plan publication as a Runner Git Operation. |
| `packages/domain/src/commands.ts:23`, `:35` | Current Planner allowlist only recognizes inspect/reply; add publish/issue and require a current initial-planning source. A Todo Planner, Node Agent, historical probe Planner or future conversation-only Planner must not gain initial-plan authority just because `kind='planner'`. |
| `apps/server/src/service.ts:71`, `:234`, `:427` | Existing missing-outcome handler records FAILED + Stop without inventing Plan, and `!mutation_allowed` avoids turning a committed phase into failure. Reuse logical SUCCEEDED + mutation=false + admitted Stop; physical capacity remains held until validated Stop result. |
| `apps/server/src/owner-execution.ts:46`, `:54`, `:114` | Current initial Stop/Retry requires `payload.attempt_id`; no target exists while selection is unavailable. Retry only restores state and consumes old recovery once; it creates no new context/selection intent. It cannot resolve an issue Attempt that logically SUCCEEDED. Extend through the planning module, retaining old receipt semantics. Do not blindly classify every successful phase as a Stop no-op: a published Plan wins, but an issue still has a resolvable Owner obligation. |
| `apps/server/src/runtime-scheduling.ts:44` | Existing `selectAndEnqueue` returns queued or factual unavailable without creating an Attempt for unavailable work, retains exact selected-request replay and uses configuration + Attempt advisory + Runner/table locks. It must run before caller-held Task locks. It currently forwards only Discussion-specific context; add the Task planning source as explicit internal data, not a Todo context alias. |
| `apps/server/src/dispatch-queue.ts:35`, `:64`, `:126` | Canonical Planner enqueue already accepts no fixture resource and emits empty workspace reservations. Promotion checks exact Task/Spec/Plan/control basis, single owner/physical capacity, incarnation, Runtime and local placement. Add source-head equality to enqueue/promotion so a superseded planning intent cannot start on an accidentally equal basis. Keep `owner_key='planner:'+task_id` across all Task Planner phases. |
| `apps/server/src/discussion.ts:23`, `:116`; `discussion-state.ts:52`, `:100`, `:142` | Copy the pattern, not its tables/history: durable no-Runtime selection intent, bounded context freeze, two-transaction prepare/select with rechecks, source-bound formal outcome, current-Runner discovery retry, and receipt/outcome/Stop atomicity. |
| `apps/server/src/main.ts:19` | Existing one-second in-process pump and shutdown tracking can also service planning intents. Database work remains authoritative; restart polls pending rows. No new daemon, queue broker, port or service is necessary. |
| `apps/server/src/owner-commands.ts:35`, `:78`; `apps/server/src/app.ts:125` | Reuse Owner authentication, CSRF/cookie handling and `/v1/owner/commands` receipt namespace. Route new planning actions to their owner before the old generic attempt-target handler. |
| `apps/server/src/owner-reads.ts:184`, `:159` | Existing Task overview, scoped Attempts/logs and contiguous formal-event cursor suffice for most reads. No current read can explain unavailable selection with no Attempt or an open issue. Add a bounded planning status/attention projection and a scoped immutable Plan read. |
| `runner/cmd/monos/main.go:24`, `:95`; `runner/internal/adapter/opencode.go:38`, `:215` | CLI allowlist/help needs publish/issue; the fixed protocol needs the initial-planning outcome contract. Current native OpenCode Arguments start a fresh `run` and do not request session resume. Root is still updating Runner/harness for leaf 1, so refresh these anchors after its acceptance. |

Existing queue promotion pins `task_runner_locality` for Task Planners as well as
Nodes (`dispatch-queue.ts:181`). The architecture eventually permits pre-workspace
Task planning anywhere, but Stage A has one Runner. Do not expand multi-Runner
placement in this leaf or pretend the broader placement behavior is implemented.

## Proposed strict Node and command schemas

These are concrete design suggestions, not generated contracts already present.

```ts
type ExecutionPlanNode = {
  node_id: Id;
  role_id: Id;
  goal: string;                 // nonblank, <= 65,536 code points / 256 KiB
  dependencies: Id[];           // unique, <= 256; stored spelling already in use
  hard_requirements?: string[]; // <= 64 nonblank entries, each <= 4,096 code points
  expected_outputs?: string[];  // same bound; soft human-readable guidance only
  consumes?: Id[];              // unique Artifact IDs; see Stage A restriction below
};

type TaskPlanningSource = {
  intent_id: Id;
  specification_id: Id;
  context_digest: SHA256;
};

publish_execution_plan.payload = {
  planning_intent_id: Id,
  plan_id: Id,
  nodes: ExecutionPlanNode[]
};
raise_planning_issue.payload = {
  planning_intent_id: Id,
  reason: string                // nonblank bounded human-readable text
};
```

Use `additionalProperties:false` throughout; forbid Runtime/model/thinking,
workspace/branch/path, Role instructions, and resource-selection fields. Preserve
optional objective requirements/output hints exactly in immutable Plan content
and `plan_nodes.definition`; they are not scheduler predicates or required Artifact
types. The existing `dependencies` spelling implements architectural `depends_on`;
keep one spelling and do not rewrite old Plan bytes or accept competing aliases.

The general node/graph validator still accepts up to 256 members for existing
internal tests and future stages. The new public initial-plan command accepts
exactly one required Node with no dependencies. A larger graph returns a clear
`unmet_precondition` with `unsupported_multi_node_plan` explanation (the current
error enum has no `unsupported_operation` member); no Plan or terminal outcome is
written. The same authorized Planner may correct it with a new request ID or raise
an issue. Do not silently trim the graph or automatically convert validation failure
into a semantic issue. Malformed IDs/cycles/unknown keys are ordinary validation
errors, not Runtime failures.

For this leaf, `consumes` may be omitted or empty. A nonempty value must return a
clear unsupported-Artifact-consumption precondition until leaf 3 can verify Task-
scoped immutable Artifact references. Silently accepting dangling IDs would make
an invalid Plan; implementing Artifact storage here would cross the leaf boundary.
`hard_requirements` and `expected_outputs` need no such subsystem and should be
supported and retained now. Enforce aggregate canonical-envelope UTF-8 limits in
addition to per-field code-point bounds.

Add an optional `task_planning_source` to canonical Planner Dispatch only. Preserve
legacy dispatches; forbid it for Node/Todo Attempts. Existing `source_watermark=0`
can remain the empty compatibility value, but never pretend it is a Task Conversation
watermark or use it as the planning-source identity. Server joins, not caller echo,
establish source authority.

Add typed semantic result fields to `EffectResult` (or a small nested planning
result): exact planning intent and either published Plan ID or issue event sequence.
A result is `status:'committed'` because publication/issue has committed; its existing
`operation_id` identifies the separately admitted cleanup Stop. No new Runner effect
kind is needed. Regenerate TS/Go/OpenAPI and inspect all consumer enum renames.

## Minimal durable records: no Task Conversation model

A suggested next migration after the final leaf-1 migration is
`0017_task_initial_planning.sql`; confirm the version when implementing.

1. Add nullable `tasks.initial_planning_intent_id` and
   `tasks.planning_issue_sequence`. These are current source/attention references,
   not copies of Task state, Specification or Runtime state. The latter references
   an immutable `task_events(task_id,sequence)` issue event.
2. Add `task_planning_outbox` with stable `id`, `task_id`, optional
   `previous_intent_id`, originating Owner request/decision reference,
   `specification_id`, exact expected Task control version, unique
   `planned_attempt_id`, immutable nonsecret context snapshot/digest, `done`,
   bounded `waiting_reason`, `last_checked_at`, and timestamps. This is durable
   Runtime-selection bookkeeping like `todo_discussion_outbox`, not another
   execution queue or PlannerInvocation. Each authorized Start/Retry creates one
   source row; retry history is retained instead of overwriting old launch input.
3. Add nullable `attempts.planning_intent_id` with composite same-Task FK; enforce
   Task-owned Planner/no Node/null Plan for this initial phase and immutable source
   binding after insert. Retain the full prompt in existing `attempts.launch` and
   retain the referenced immutable source context; do not copy Todo columns.
4. Unique pending source per Task, unique planned Attempt, immutable source basis,
   and same-Task FKs for Task head, issue event, previous intent and Attempt binding.
   Legacy rows remain null; do not infer historical Start decisions or issue history.
   `done` means selection was consumed/revoked, not that a Plan was produced.

Reuse existing `owner_command_receipts` and `command_receipts`; no new receipt
namespace is required. Use existing formal `task_events` for `task_started`,
`plan_published`, `planning_issue_raised`, Owner answer/retry/stop decisions and
source references. Existing events have `(task_id, sequence)`, not an opaque event
ID: an issue can therefore be addressed by exact `issue_sequence` + Task scope.
This avoids inventing a message/source history for Task Conversation. An answer
lives in an immutable Owner decision event and its original command envelope;
context includes the referenced issue reason and answer. Do not scan arbitrary
log prose or treat an event-sequence counter as a Task compare-and-set version.

The backend `operations` table is currently for Runner effects, with a nonnull
Attempt FK and a constrained effect kind. Do **not** insert a synthetic no-Runtime
planning operation there. The dedicated selection outbox is necessary precisely
because Start and Stop must work when no Attempt exists.

## Owner commands and exact issue exits

Keep the existing Owner envelope (`schema_version,request_id,scope_id,
expected_control_version,name,payload`) and authenticated receipt-first replay.
Recommended new/extended actions:

| Command | Payload / exact behavior |
| --- | --- |
| `start_task` | `specification_id` identifying the viewed effective revision; require PLANNING/no Plan and current control/revision/configuration eligibility. Atomically set RUNNING, create one source intent/context, select the Task source head, append Start event and receipt. Do not wait for a live Runtime. |
| `stop_initial_planning` | New source-targeted variant `{planning_intent_id, issue_sequence?}`; preserve existing attempt-targeted variant for retained probe clients. Stop pending selection/queued/running/failed/issue work. Revoke its selection intent and any queued/running authority, reuse/admit cleanup as needed, resolve its exact issue as withdrawn-by-Stop, set PLANNING and record decision/receipt. A published Plan prevents this pre-Plan action from reverting the Task. |
| `retry_initial_planning` | Source-targeted variant `{planning_intent_id, issue_sequence?, answer?}`. Failure/unavailable retry needs no invented answer. An open issue requires both its exact sequence and a nonblank answer; record answer + explicit Retry together, replace current source with a fresh context/Attempt identity, and remain RUNNING. A stopped Task is explicitly restarted by this action under fresh Start eligibility, not by an answer alone. |
| `cancel_task` (pre-Plan scope only) | If exposed in this leaf, require no Plan and nonterminal Task; cancel source/queued work, fence running work, close the exact issue, set CANCELLED, retain cleanup/receipts/history. Reject post-Plan use until its owning lifecycle/delivery implementation exists. Stop already supplies the mandatory non-Cancel exit, so this must not grow into general delivery cancellation here. |

There is no independent “dismiss issue and keep scheduling” operation. For initial
planning, withdrawing the unresolved request means the explicit Stop transition
above. A text answer alone is not Start/Continue, does not mutate Specification,
and must not trigger hidden planning. A combined answer-and-Retry is a deterministic
Owner command, not a request to run a Planner merely to approve its own retry.

Two different Start requests contending on the same PLANNING basis may produce one
success and one version/precondition error; they must never produce two source
chains. Replaying the successful request returns its original receipt even after
Stop or publication. Status reads separately report the current state. An old
Start with a new request ID cannot revive a stopped Task using a stale version.

Stop and issue answer/Retry never require a free model slot. Stop also never
requires Runner connectivity: it fences immediately and retains physical cleanup
until reconnect. The new source-targeted Retry should atomically persist the Owner
answer and fresh intent once the previous Attempt is logically terminal and its
mutation authority is fenced, even if its admitted Stop is still settling. Reject
Retry while that Attempt remains running with mutation authority. A successor
**must not be promoted** until all old owner claims/effects have released; expose
this interval as settling. Preserve the legacy attempt-targeted Retry variant's
strict released-before-Retry precondition for compatibility. This gives the Owner
a durable answer/Retry action without relaxing physical ownership or requiring a
model slot.

## Context, admission and lock order

Freeze semantic context when each Start/Retry intent is admitted, under the current
configuration share lock and Task lock: fixed initial-planning protocol, actual
Owner Planner Guidance, effective Specification, Project context, active resource
summary, selected available Role **descriptors only**, and exact relevant issue/
answer decisions. The architecture explicitly requires fresh configuration on
Retry. Role instructions stay out of Plan and planning context; already selected
hidden Roles remain valid historical references, but new initial selection should
require an available Role rather than choosing an archived one.

Do not query Todo Discussion/cache/session, other Tasks, repository files, or logs.
Use stable ID ordering and canonical JSON for the context fingerprint. Include
configuration version as provenance, not a broad publication CAS that unrelated
policy edits can invalidate. At publication, verify currently selected/available
Role membership; resource membership is not Planner repository-selection authority.
Freeze the selected Attempt's prompt; never refresh an already-queued envelope in
place after configuration edits. If combined context exceeds Dispatch budgets,
retain the source and a factual `context_budget_exceeded` reason without silently
truncating Specification or creating an invalid Attempt; Owner Retry can prepare
a new source after configuration changes.

The lock sequences should be explicit:

- **Start / context preparation:** Owner session -> configuration SHARE -> scoped
  Owner request serialization -> Task -> current planning source/event/receipt.
  Commit before Runtime selection. Start does not take capacity or invent a Runner.
- **Selection pump:** configuration SHARE -> planned-Attempt advisory lock ->
  Runner registry EXCLUSIVE for Auto (or selected Runner row) -> Task -> current
  intent -> Attempt. Call `RuntimeScheduling.selectAndEnqueue` before retaining a
  caller Task lock; recheck RUNNING/no Plan, effective Specification/control,
  current intent and intended Attempt in that same transaction. Roll back any
  queue insertion if source recheck fails. Unavailable result writes only a current
  source's waiting reason. Same-ID scheduler replay is not permission to bypass
  current-source checks; its replay branch may return before taking Runner locks.
- **Owner Stop/Retry/issue resolution:** Owner session -> configuration SHARE ->
  Owner request serialization -> discover candidate Runner without locking Task
  -> Runner row if present -> Task -> intent -> Attempt -> Stop. Recheck current
  source/Attempt after Task lock; retry discovery if it changed. This is the
  Discussion control pattern, not Task -> Runtime selection lock inversion.
- **Planner publication/issue:** existing authenticated admission configuration ->
  Runner -> Task -> Attempt, then planning source and effect as needed. Require
  current source head, source-bound Task Planner, exact dispatch/fence, current
  backend connection, RUNNING/no Plan, effective Spec, expected Task version and
  no competing terminal handoff. Receipt lookup remains before fresh guards.

A successful publication transaction calls `publishInitialPlan`, records the source
resolution/event/receipt, marks Planner SUCCEEDED/mutation=false, ends Start outbox
and admits repository-free Stop. A successful issue transaction records the reason
and current issue reference and performs the same phase closure without a Plan or
Task state change. Both keep physical ownership until Stop settles. Never call the
Plan primitive after revoking the claim it validates. Avoid double-incrementing
control version: the primitive already increments for Plan publication.

A late exit after either formal outcome sees revoked mutation authority and cannot
produce missing-outcome/fallback work. An exit without either outcome remains
RUNNING/no Plan with failed Attempt and retry attention. Structural validation
failure leaves the same Attempt authorized to correct its command. Old source
outcomes after Stop/Retry/withdrawal are rejected even if their expected version is
forged to the latest number.

## Read contracts

Add `TaskPlanningStatus` at `GET /v1/owner/tasks/:task_id/planning`, or the equivalent
small nested projection in `TaskOverview`. It should expose Task control version,
current source ID, effective Specification, optional Plan, selected Attempt and
cleanup operation, current issue `{issue_sequence,reason}`, relevant answer/decision
references, factual waiting/end reason and derived availability of actions.
Derived display states may distinguish queued, processing, settling, awaiting Owner,
unavailable and interrupted; these are not Task states or a new persisted lifecycle.
Capacity waiting alone is not error attention. Unknown receipts remain unknown.

Add a Task-scoped immutable Plan read (for example
`GET /v1/owner/tasks/:task_id/plans/:plan_id`) returning revision/Specification and
exact definitions, without conflating them with mutable current Node state. Existing
Attempt/log/event/operation reads remain the diagnostics path. Reads must expose
unavailable selection before any Attempt exists and remain usable after cleanup.

## Verification plan

Use real PostgreSQL with distinct connections/observed locks, following the newly
strengthened `postgres-workspaces.test.ts:96` contention pattern. Relevant existing
coverage: `postgres-task-records.test.ts:56`/`:67`/`:81`,
`postgres-owner-execution.test.ts:35`, `postgres-runtime-scheduling.test.ts:59`/`:166`,
and `postgres-discussion.test.ts:98`.

1. Creation and reads/pump do no planning. Start with missing Roles/archived Project
   stays PLANNING. No policy/Runner after otherwise valid Start persists one source,
   RUNNING/no Plan and factual unavailability; no Attempt/workspace is fabricated.
2. Same-request replay/conflict and two-session distinct-request Start contention;
   crash before/after receipt commit; restart before selection, after queue insert,
   and before Start delivery. Assert one source/selected Attempt/Start and no lost
   wakeup. Count workspace rows and native workspace allocations as zero.
3. Freeze current Specification/Project/resources/Role descriptors/guidance; exclude
   unique markers in Todo/cache/other Task/full Role instructions. Retry refreshes
   changed configuration and includes exact issue/answer provenance. Test Unicode
   and aggregate context bounds without clipping or invalid dispatch.
4. One immutable Plan/PENDING activation; optional hard requirements/output hints
   survive storage/read/replay. Reject extra keys, multi-Node, wrong/archived Role,
   cycles/dependencies and nonempty unavailable Artifact consumption. Validation
   error is correctable by the same Attempt and does not produce failure/fallback.
5. Publish versus issue and publish/issue versus Stop, both deterministic lock orders;
   wrong Task/source/Spec/claim/fence; old source with a newer payload version;
   same-receipt replay after termination. One phase outcome, one cleanup Stop, no
   partial Plan/activation or duplicate formal event after receipt-trigger rollback.
6. Stop at unavailable, QUEUED, in-flight Start and running points; Stop on a logically
   succeeded issue with cleanup still held; disconnected Runner. No free model slot
   is required. Slot remains held through physical uncertainty; successor source
   cannot promote on another free slot until the old owner/effects settle.
7. Exact issue answer+Retry, stale issue answer, duplicate answer, Stop withdrawal,
   and pre-Plan cancellation if included. Wrong source cannot clear another issue;
   late output cannot restart stopped/cancelled work. Plain answer never revises
   Specification. Failure/normal exit without a formal command remains retryable.
8. Full relevant DB gate, protocol freshness/TS/Go fixtures, CLI help/admission,
   lint/typecheck/build, native Node module load. Keep existing probe and Todo
   contracts/receipts intact; explicitly test Node/Todo/legacy Planner denial.

Native acceptance should use the already-authorized installed Runner/Runtime and
existing services after leaf 1 passes, with fresh source/binary/deployment evidence.
Create or reuse a task-owned active Project/Role and a canonical confirmed Task via
Owner APIs; do not fabricate its Plan/Node/Attempt through a test-only SQL launch.
Prove no Start means no process; Owner Start invokes a fresh Task Planner, which
calls the actual bundled `monos publish_execution_plan` and publishes one exact
Node with an objective requirement. Use a second canonical Task with contradictory
requirements to exercise real `raise_planning_issue`, then Owner answer+Retry or
Stop withdrawal. Verify whole-tree cleanup, receipt recovery and zero repository
materialization. Saturation/exit races remain deterministic DB/native supervisor
cases; do not depend on probabilistic model timing. Refresh installed model/tool
availability evidence required by the Runtime spec without changing Owner logins.
No Node execution, remote publication, new permanent service or live private-App
claim belongs to this acceptance.

## Handoff

Concrete next implementation ownership is backend context/intent/Owner commands,
Task source guards in scheduler/dispatch/service, shared schemas/CLI/fixed protocol,
and focused PG/native acceptance. No product question here requires blocking the
Owner: the architecture defines eligibility, one-Node validation, phase outcomes,
issue exits and physical settlement. The design still needs to select final names;
the recommendation is to persist source-targeted Retry during cleanup after logical
termination/fencing and prevent successor promotion until physical release, while
retaining the legacy attempt-targeted release precondition. No additional Owner
clarification is needed. This note has changed only its own file.
