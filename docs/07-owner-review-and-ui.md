# Owner Review & UI

## Visual and layout direction

Use the Multica **application workspace** as the reference for monos layout and visual style: neutral layered surfaces, compact navigation and page chrome, consistent typography, restrained borders, and clear list/detail and conversation workspaces. Translate that reference into the monos surfaces below. Projects, Todos, Execution Board and Task sections retain their own meaning; Multica organization/team abstractions and unrelated features are not part of this direction.

The [frontend visual contract](../.trellis/spec/frontend/visual-design.md) defines measurable layout, typography, token and responsive conventions. The selected component baseline remains shadcn/ui + Base UI + Tailwind. Visual acceptance requires inspected desktop/mobile evidence against that contract, not just the presence of shadcn configuration or saved screenshots.

This is the target for new UI and planned visual migration. Existing green-theme screens are not evidence of compliance; their migration is a separate deliverable from documenting this standard.

## UI principle

Do not expose orchestration internals as the primary product experience.

The Owner should see work, results, decisions, and attention requirements.

Node IDs, Attempt IDs, Runtime sessions, Worktrees, raw DAGs, and logs are secondary debugging/execution details.

## Primary information architecture

~~~text
Todo / Inbox
→ long-lived things to think about

Todo Detail
→ Discussion
→ independent Execution Tasks created over time

Execution Board
→ global view of formal Execution Tasks

Execution Task Detail
→ Conversation
→ Overview
→ Timeline
→ Execution Details

Projects
→ long-lived Project context/resources
~~~

Planner, reusable Role, and Runtime configuration belong to settings/infrastructure areas. Projects select which reusable Roles are available to Planner.

Do not introduce a separate Activity page to replace the Execution Board.


## Todo workspace

Todo is the fastest capture surface in the product.

Creating a Todo should require only the idea itself. Project selection is optional and must not block capture. The Owner can associate the Todo with a Project later.

On desktop/web, selecting a Todo should not navigate away from the Todo list into a completely separate page.

The application already has a global primary navigation sidebar. Do not add a separate third scope column inside Todo, because that would create an unnecessarily deep four-column desktop layout.

Prefer a two-column Todo workspace inside the main content area:

~~~text
Global navigation | Todo workspace

┌───────────────┬──────────────────────┬─────────────────────────────────────┐
│ App menu      │ Todo list            │ Selected Todo                       │
│               │                      │                                     │
│ Todos         │ [scope/filter ▼]     │ Discussion with Planner             │
│ Execution     │ [search]             │                                     │
│ Projects      │                      │ Execution Task preview/cards        │
│ Settings      │ Todo A               │                                     │
│               │ Todo B ← selected    │ Message composer                    │
│               │ Todo C               │                                     │
└───────────────┴──────────────────────┴─────────────────────────────────────┘
~~~

Scope/filter controls belong at the top of the Todo list column rather than in a separate column.

Useful scopes are intentionally small:

- Active — default working set;
- Inbox — active Todos with no Project;
- Project — filter active Todos by one Project;
- Archived — explicit secondary view.

Project filters may use a compact dropdown/menu rather than permanently listing every Project.

The Todo list remains visible while the Owner discusses the selected Todo on the right.

This reduces context drift when several Todos are active: the Owner can always see which Todo is selected and can switch directly without leaving the workspace.

### No Todo selected

When no Todo is selected, the right workspace should show a quiet empty state rather than auto-opening an arbitrary Todo.

Recommended empty state:

~~~text
No Todo selected

Select a Todo on the left to view it or start a discussion.

[Create Todo]
~~~

The primary creation surface still lives in the Todo list column. The right-side Create Todo action, if shown, should simply focus/open that same capture flow rather than introducing a second creation model.

Do not invoke Planner, show Current Understanding, or preload a Discussion when no Todo is selected.

When possible, the client may restore the Owner's previously selected Todo for the current scope/session if it still exists and is visible. If there is no valid previous selection, remain in the explicit empty state rather than automatically selecting the first Todo.

If the current scope contains no Todos at all, the empty state may instead explain that the scope is empty and point to the same quick-capture action.

The right side is the Todo working surface, not a modal that hides the surrounding Todo context. On smaller/mobile screens the same information may use a full-screen presentation, but the conceptual model remains list + selected Todo workspace.

The selected Todo workspace contains:

- Todo title and optional Project association;
- Original Capture;
- optional expandable Current Understanding after Discussion has begun;
- long-lived Discussion;
- transient Execution Task preview when proposed;
- inline cards for confirmed Execution Tasks created from this Todo;
- message composer.

### Todo list behavior

Default ordering is by recent Discussion activity, not by manual priority.

Discussion activity includes Owner messages, Planner replies, and creation of a confirmed Execution Task from that Todo. Background execution state changes must not reorder the Todo list.

A lightweight unread/new-reply dot may appear beside a Todo when Planner activity completed while the Owner was viewing another Todo. Do not show Execution Task states such as Running, Review, Agent count, or Node progress on Todo rows.

Todo rows should remain compact and recognizable rather than becoming mini task cards.

Recommended row content:

~~~text
● Runtime fallback handling           monos
  Codex quota exhausted; switch Claude        12m
~~~

Use:

- first line: Owner-controlled title when one exists; otherwise a deterministic display excerpt from the original capture text;
- second line: most recent meaningful Owner/Planner Discussion text, truncated to one line;
- trailing time: recent Discussion activity;
- optional unread/new-reply dot;
- optional lightweight Project label only in cross-Project views such as Active.

Do not auto-generate or silently replace the Todo title with AI, and do not create or persist a separate AI-generated Todo summary only for list rendering. Prefer deterministic use of recent meaningful Discussion text. If the latest message is trivial or empty, the UI may walk backward to the most recent useful text.

When the current scope is already a specific Project, omit the repeated Project label from every Todo row.

Do not add priority, labels, due date, board status, Agent count, progress, or other project-management metadata to the Todo row.

Each Todo keeps its own composer draft. Switching from Todo A to Todo B and back must restore A's unfinished draft instead of sharing one global draft buffer.

Planner work is independent per Todo. The Owner may switch to Todo B while Planner is still responding in Todo A. A may complete in the background and surface a lightweight unread indicator without stealing focus or blocking work in B.

Todo conversation context, Working Requirement State, draft text, and unread state are isolated per Todo to prevent cross-Todo context leakage.

### Planner activation

Todo capture is passive. Creating a Todo does not automatically start Planner work.

Simply selecting/opening a Todo also does not invoke Planner. The Owner may review, organize, or archive captured ideas without spending model work or creating unsolicited replies.

Planner is invoked only after an explicit discussion action, such as:

- the Owner sends a message in that Todo's Discussion composer; or
- the Owner explicitly chooses a "Discuss / Ask Planner" action.

The original capture text remains available as context for the first Planner turn, but Planner does not respond to it until the Owner explicitly starts Discussion.

This allows the Owner to rapidly capture many ideas and leave some untouched indefinitely.

### Original Capture presentation

Do not render the Todo's creation content as if it were the first chat message sent to Planner.

Show it as a lightweight, distinct Original Capture block above Discussion, for example:

~~~text
Original Capture

Runtime fallback should not replan the Node when Codex quota is exhausted...

Captured Sep 27, 20:42
~~~

Below that block, Discussion begins only after the Owner sends the first message to Planner.

On the first Planner request, provide Original Capture + Project Context when assigned + the Owner's first Discussion message as context.

This preserves the semantic distinction:

- Original Capture = what the Owner wanted to remember;
- Discussion = when the Owner decided to actively work through it with Planner.

### Execution Task preview

Every proposed Execution Task must be previewed before formal creation, regardless of whether creation was initiated through natural language or a UI button.

The preview should be lightweight:

~~~text
Execution Task Preview

Title
...

Specification
...

Project
Morie / Select a Project before creating

[Cancel] [Continue discussing] [Create Task]
~~~

The Owner can reread the exact title/specification that will create the Task and its immutable initial requirement revision.

The preview is not a persisted Draft Task and should not introduce another domain lifecycle. It is temporary UI state reconstructed from structured proposal content on its committed Discussion message.

After confirmation, the system creates the Execution Task with its initial Specification revision in PLANNING and replaces/inserts the preview with a confirmed inline card in the Discussion flow. Creation does not start Planner or execution automatically.

A confirmed Execution Task card may show:

- title;
- created time;
- current execution state;
- View Task;
- a Start action while the Task is still in PLANNING;
- Run/Review status appropriate to later Task states.

The card anchors the moment in the Discussion when that formal execution was created, while full execution detail remains in Execution Task Detail / Execution Board.


## Project overview

Project UI should remain a light overview and scope lens, not become another project-management dashboard.

A Project overview may show:

- Project name and Owner-authored Context;
- linked Resources with their default refs and delivery settings;
- selected reusable Roles;
- a compact summary of active Todos;
- a compact summary of current Execution Tasks;
- actions to edit Project Context / Resources / selected Roles.

Project-scoped Todos and Execution Tasks should still use the canonical Todo Workspace and Execution Board.

Roles are created and maintained in a global reusable Role library:

~~~text
Settings
└─ Roles
   ├─ General Coding
   ├─ Swift / macOS
   ├─ Debug
   └─ + New Role
~~~

A Role editor may include:

- name;
- description;
- instructions;
- optional custom Execution Policy, otherwise use the applicable default policy.

Each Project has a lightweight Roles section that selects from this library:

~~~text
Project
├─ Context
├─ Resources
└─ Available Roles
   ├─ ✓ General Coding
   ├─ ✓ Swift / macOS
   └─ + Add Role
~~~

`Add Role` opens the reusable Role picker. It may also offer `Create New Role`, which creates a global reusable Role and selects it for the current Project.

Do not add a Team/Blueprint layer between the global Role library and Project.

For example:

~~~text
Project: monos

Context
...

Resources
6spot/monos · main

Roles
General Coding · Swift/macOS · Debug

Active Todos        8   [View in Todos]
Current Executions  3   [View in Execution]
~~~

Selecting `View in Todos` opens the Todo Workspace with the Project filter applied.

Selecting `View in Execution` opens the Execution Board filtered to the Project.

Avoid duplicating a full Todo list, full Execution Board, or another task state model inside Project Overview.

## Runtime and Runner configuration

Runner selection is optional wherever an Execution Target is configured or explicitly overridden.

Use a simple selector:

~~~text
Runner
[ Auto ▼ ]

Auto
monos-01
~~~

Default is `Auto`. The Owner is never required to choose a Runner.

Selecting a concrete Runner means "run this target only on that Runner", not merely "prefer this Runner".

V1 may expose only one concrete Runner plus Auto, but the UI and data model should already support multiple Runner instances later without introducing different Runner types.

Model and Thinking are monos-defined common fields. The selected Runtime Adapter reports whether each field is supported and which values are discoverable; unsupported fields are hidden.

Do not let Runtime Adapters dynamically add arbitrary provider-specific form controls. monos owns the fixed settings surface and only renders common fields it explicitly understands.

Manual model entry remains available for new or provider-specific model identifiers that discovery does not yet return.

monos does not install coding tools and does not manage their login credentials. Runtime setup/authentication stays with the tool on the Runner machine.

An Execution Policy may set an optional duration budget. Present it as an attention threshold, not a timeout: exceeding it never stops execution.

Runner status also lists unsafe host conditions found at enrollment (module 11).

## Runner capacity UI

Runner configuration may expose one simple capacity control:

~~~text
Max concurrent executions
[ 4 ]
~~~

Do not expose smart scheduling weights, CPU cost scores, model cost scores, or user-facing priority numbers in V1.

Runner status may show factual active usage such as `3 / 4 running`. Do not attribute centrally queued Auto Attempts to a specific Runner before placement is resolved. Only work explicitly pinned to a Runner can truthfully be shown as waiting specifically for that Runner.


## Execution Board

Board columns are user-facing organization, not a 1:1 copy of internal Task states.

V1:

~~~text
Ready to start
Running
Review
Done
~~~

Suggested mapping:

~~~text
PLANNING
→ Ready to start

RUNNING / BLOCKED / REPLAN_REQUIRED
→ Running
  + Needs Attention decoration when applicable

REVIEW
→ Review

COMPLETED
→ Done

CANCELLED
→ history/filter, not a permanent primary column
~~~

Attention may be shown as a filter/section inside the Board.

For a RUNNING Task with no published Plan yet (`current_plan_id = null`), the UI should present initial planning rather than Node progress. If Planner execution cannot proceed, show the Planner failure/availability reason and actions such as Retry, Stop, or Cancel Task. A planning issue shows the Planner's reason with an answer field next to those actions.

Stopping during this pre-Plan RUNNING phase returns the Task to PLANNING. Once a Plan exists, stopping execution must not reuse PLANNING because the Task has already begun formal execution.

A RUNNING Task may be waiting for execution capacity. Do not create another Board column for this. When no Attempt is currently running but one or more Planner/Node Attempts are QUEUED, show a lightweight `Queued` / `Waiting for capacity` badge on the card within Running.

If some work is actively running and additional Attempts are queued, keep the primary visual state as Running and optionally show a small queued count/detail. Runtime-capacity queueing is normal scheduling, not Needs Attention.

Todo cards do not show Execution Task runtime state. Todo and Execution Task are separate concepts.

## Task Overview

Overview should answer four questions:

1. What is this Task?
2. Where is it now?
3. What has it produced?
4. Does the Owner need to do anything?

Default content:

- effective Specification with revision history;
- current status/attention;
- current Progress;
- formal Outputs;
- stage-appropriate Owner actions.

Do not default to DAGs, Attempts, Runtimes, or raw logs.

## Progress

Do not use percentages or ETA.

Use deterministic counts and human-readable groups, for example:

~~~text
3 / 5 completed

Completed
✓ Analyze current lifecycle
✓ Refactor window management
✓ Fix history layout

In progress
● Verify memory release

Waiting
○ Final regression check
~~~

Progress is a projection of the current effective Plan and Node states.

After Rework/Replan, show only the current effective work. Old Plan structure, removed Nodes, and rework history belong in Timeline.

The real DAG is for development/debugging only and should not appear in normal Owner UI.

## Timeline

Timeline shows meaningful formal changes, not raw operation noise.

Default emphasis:

- meaningful work completed;
- formal Artifacts published;
- Rework requested;
- Replan requested/approved/published;
- Owner decisions;
- Task ready for review;
- Task completed.

Runtime failover, session resume, heartbeat, Workspace creation, and raw commands belong in Execution Details unless they materially affect Owner understanding.

Multiple low-level Events may be grouped into one human-readable Timeline entry.

Timeline is semantic history: it explains what formally happened and what was produced.

## Execution Flow

Below Timeline, show a separate lightweight execution-flow block.

This is not another semantic Timeline and it is not the Plan DAG.

Its purpose is to let the Owner visually see how work moved through the Task by showing when each Node/work item was triggered and when it reached its current or terminal state.

A compact row may show:

~~~text
Analyze current lifecycle
Triggered 18:32
Completed 18:47

Refactor window management
Triggered 18:47
Completed 19:06

Verify memory release
Triggered 19:06
Running

Final regression check
Waiting
~~~

Recommended fields:

- human-readable Node goal;
- trigger/start time;
- current Node state;
- completion/block/cancel time when applicable;
- duration may be derived for display.

Do not show percentage progress.

Do not show the DAG or dependency edges.

Do not show Runtime, Session, Attempt IDs, Worktree details, or raw logs in this block.

Sort primarily by actual trigger time so the Owner can read the execution sequence directly.

A Node that has never been triggered may appear as Waiting without a trigger time.

If a Node is reactivated by Rework, keep the same Node identity and show its additional activation in a compact way rather than inventing a new Node. The full historical reason for the Rework remains in Timeline.

This block is a deterministic projection of Node lifecycle timestamps/states, not a new persisted object and not model-generated content.

## Execution Details

Execution Details is the diagnostic layer, but the UI should remain flat.

Node is the primary visible execution unit. Attempt remains an important backend model for fallback, recovery, Session ownership, and log attribution, but it should not become a required navigation level.

Do not force the Owner through:

~~~text
Node
→ Attempt
→ Log
~~~

Instead, select a Node and show its current/latest execution information directly in the same view:

~~~text
Node Detail

Status / trigger time / completion time

Current execution
- Runtime
- Model
- Thinking
- start time
- last activity / end time
- end reason when relevant

Execution Log

Workspace / Git
- workspace/repository
- start/completion revision
- changed files
- diff

Previous executions   # only when more than one Attempt exists
~~~

The term `Attempt` does not need to appear in normal UI.

If a Node has only one execution, show it directly.

If fallback, retry, or manual Runtime switching creates additional Attempts, expose them as a compact `Previous executions` or `Execution history` section inside the same Node detail view.

For example:

~~~text
Current execution
Claude Code · Succeeded
19:06 → 19:38

Previous executions (1)
Codex · Quota exhausted
18:47 → 19:06
~~~

Selecting a previous execution may switch the visible Execution Log without navigating to another page.

Runtime, Model, Thinking, status, timestamps, and end reason are useful diagnostic information here.

Session ID, Runner ID, Runtime version, raw runtime payloads, and similar infrastructure data should be hidden under an advanced/debug affordance.

For a running Node, execution controls such as Stop or Switch Runtime belong here. These actions affect execution of the same Node; they do not create a new Node or require Replan.

After Plan publication:

- Stop cancels the current Attempt and blocks that Node until the Owner continues it;
- Continue reactivates the same Node and normal scheduling creates a new Attempt;
- Switch Runtime / Runner / Model / Thinking ends the current Attempt and queues another for the same Node; execution waits for old writers to stop and capacity to become available;
- Cancel Task remains a separate Task-level terminal action.

Do not expose a V1 whole-Task Pause control unless a real pause lifecycle is introduced later.
Workspace/Git information belongs in the same Node detail view but remains visually distinct from the Execution Log:

- Execution Log answers how the Agent worked.
- Workspace/Git answers what code state the Node produced.

The backend remains precise:

~~~text
Node
└─ Attempt 1
└─ Attempt 2
~~~

The product UI does not have to mirror that storage hierarchy.

## Owner Review

When all required work is finished, Task enters REVIEW, not COMPLETED.

Review targets the final integrated Task result.

For Git Tasks, Owner reviews the final Task Workspace, not an individual Node Worktree.

Default Review content includes:

- Execution Task Specification;
- completion summaries;
- Artifacts;
- final Git changes/diff/commit information.

V1 Owner actions:

~~~text
Accept / Merge
Request Changes
Cancel
~~~

No Git:
- Accept → COMPLETED.

Git:
- entering REVIEW automatically prepares the delivery branch and creates/updates the GitHub PR, unless the repository defers remote preparation until acceptance;
- Review shows the local diff plus PR preparation progress or the prepared PR, checks/CI, and mergeability;
- Accept & Merge → deterministic Git Delivery;
- delivery success → COMPLETED;
- delivery failure → remain REVIEW.

There is no normal Owner-facing "Prepare PR" action.

If checks are still running, Review may show them in progress. Accept & Merge may wait for required checks for the exact accepted head; changed code requires renewed acceptance rather than silently applying the old decision.

Request Changes keeps the Task in REVIEW while Planner processes the feedback, shown as an internal operation status on the Review card (for example `Processing requested changes`). Disable Accept / Merge while that operation is unresolved; queueing or failure is shown there with Retry/attention rather than moving the card to Running. When Rework is applied, work resumes under the same delivery branch / PR and later returns to REVIEW. Move to REPLAN_REQUIRED only after a formal decision that the graph is insufficient.

If Planner raises a planning issue while routing, the Review card shows its reason with Answer & Retry, Withdraw feedback, and Cancel. Withdraw feedback is also available while routing is still running; the Task stays in REVIEW, and Accept needs a fresh confirmation of the exact result.

When the provider reports conflicts or an out-of-date branch, Review shows it with a prefilled `Update from target branch` Request Changes action.

For multi-repository Tasks, Review may show multiple delivery items/PRs under one Task-level delivery while retaining one Owner-level Accept & Merge action.

Git Delivery has its own operation state. Do not expand Task states with MERGING/MERGED/etc.

Request Changes asks to improve the current result. Within the effective Specification it routes to Rework; changed scope requires the exact requirement-revision confirmation below. After acceptance, the explicit action first revokes an entirely undelivered batch under module 04's guards; ordinary chat does not trigger that action.

The Owner should provide human-readable review feedback rather than being required to choose a Node or understand the internal DAG.

Execution Task Planner receives the effective Specification revision, relevant Task Conversation, current Plan/formal execution state, review feedback, completion summaries/Artifacts, and current Project Context. It decides whether to apply Rework, propose a requirement revision, request Replan for an insufficient graph, or ask for clarification.

Use Rework when the current collaboration structure remains sufficient. Use Replan only when the future collaboration structure must change.

Request Changes keeps the same Task, Task Workspace, and delivery lineage. Changes within this delivery can produce a new Specification revision in the same Task.

For a separate delivery objective or further work after terminal delivery, direct the Owner back to Todo Discussion to initiate an independent Execution Task through the normal preview/confirmation flow. Task Conversation never displays a creation preview for another Task or automatically copies its context into Todo Discussion.

Only the Owner can finally accept the Task. Agents cannot self-approve or directly perform final merge/close.

## Confirmation and recovery presentation

Use `Ready to start` / `待开始` for the PLANNING library column; show `Planning execution` only for RUNNING Tasks with no Plan. Preview may offer both `Create Task` and `Confirm and Start`, using the same exact-content confirmation. An unassigned preview prompts for a Project before confirmation; capture and Discussion remain available without one.

Review always exposes the local integrated result, even when PR preparation failed. Show Preparing PR, Retry preparation, failed checks, and partial delivery as delivery details within REVIEW. Pre-push findings appear there too, identifying affected paths and candidate commit versions with sensitive values redacted. Offer Request Changes or an exact-candidate override for eligible content findings; permission failures require fixing access or removing the change. Review identifies the exported delivery head and its matching internal result tree; it must not imply that private Agent commits are published. Already-published sensitive history requires separate remediation, not a claim that a deletion commit removed it. For repositories that defer remote preparation until acceptance, Review shows only the local result and explains that Accept & Merge will push, open the PR, wait for required checks on that exact head, and merge. Acceptance identifies the exact reviewed version. Changed delivery code requires renewed acceptance; never leave an old approval appearing applicable to a new head.

For plain Git automatic preparation, show `Branch published · awaiting acceptance` and label the action `Accept delivered branch`. Before Owner acceptance, ordinary correction remains available even though the branch is pushed. After acceptance, the batch is frozen; only the explicit guarded Request Changes action can return an entirely undelivered batch to correction. For after-acceptance preparation, label the action `Accept & publish branch` and explain that completion waits for verified publication; push failures remain retryable in REVIEW without waiting for later chat. In both modes explain that target-branch merging is manual and is not performed by this action. For partially finalized multi-repository delivery, including mixed GitHub/plain-Git items, list succeeded and remaining items separately, and offer retry remaining delivery or cancel remaining work. A preparation push does not count as final delivery. Do not offer ordinary Request Changes over already-delivered code. Cancel explains that open PRs for undelivered items will be closed and their branches kept.

Blocked recovery accepts an optional Owner answer alongside Retry/Continue. Persist it as Task-scoped context for the next execution. Replan confirmation shows the concrete proposed changes and their effect on existing work, without exposing the DAG as required UI. REPLAN_REQUIRED also offers Dismiss with optional direction, meaning the current graph remains sufficient. For a Node-originated request, normal work resumes after process/capacity reconciliation. For a review-originated request, return to Review with the requested correction still pending and Accept disabled; show Rework routing or a planning issue. Withdraw feedback is a separate action with its own explicit meaning. During dismissal, show any Planner termination still pending instead of claiming the process already stopped. When the Rework limit blocks a requesting Node, Node detail shows the preserved request with Apply Rework, which resets the limit, and Continue without it.

## Attention and asynchronous notifications

Execution Board is the canonical inbox for execution attention; no separate Activity product is needed. Surface review readiness, a missing Owner decision, planning issues, exhausted execution, Runtime input requests, exceeded duration budgets, and delivery failure there. Multiple simultaneous blockers must remain discoverable even if a card shows only one primary attention pointer.

V1 requires durable in-app notifications derived from formal events/operation failures, keyed by source identity and activation or delivery version. Replayed events do not create duplicates. Resolve a notification when its underlying condition clears; reading it only marks it read. Browser reconnect reloads current attention and unread notifications from the backend. Ordinary capacity queueing is not an alert. External email/mobile push is optional and can be added without changing lifecycle truth.

## Discussion delivery and queued input

Show a submitted Owner message immediately after server persistence, with a queued indicator when another turn is still active. Stream the Planner's provisional output when the Adapter exposes it, otherwise show a working indicator, and render the reply only from the atomic Discussion commit. Reconnect loads committed messages and then resumes any provisional stream; it never appends the same final reply twice.

A failed or interrupted turn offers Retry or Withdraw request. Retry handles that same message again. Withdrawal keeps the message visible with a withdrawn label, ends its pending request without a fabricated reply, and lets later messages proceed after prior execution has stopped/reconciled. Until either resolution, later messages in that Todo remain queued; other Todos continue independently within shared capacity. Stop during active processing only interrupts the turn and leaves these recovery actions available. A restored proposal card displays the exact structured content attached to its committed reply. Its confirmed Task link is reconstructed from the creation receipt, so a second device cannot create a duplicate Task by confirming the same proposal. Creating another independent Task requires a new explicit proposal/confirmation action.

## Task Conversation as the ongoing control surface

Task detail keeps a message composer available alongside progress and results throughout delivery. The Owner can ask questions, add guidance, answer blockers, or change requirements without returning to Todo or choosing a message category. Show Planner replies and concise action receipts in Conversation; formal revision/rework decisions also appear in Timeline. Conversation and Timeline are distinct projections, not duplicate copies of canonical messages/events.

Show the effective requirement and its history in Overview. A proposed change appears inline with the exact proposed requirement, concise diff, affected work, and Confirm / Revise / Withdraw actions. Confirmation may cover requirements and a replacement Plan together when both are shown. Ordinary questions and within-scope guidance have no approval dialog. Before Start or while stopped, chatting must not implicitly start execution.

Distinguish message saved, Planner queued/processing, awaiting Owner, instruction delivered/queued/failed, and change effective. Do not label a delivered instruction implemented or imply every Node received it. Failed routing/delivery has Retry and a clear reason. A change settling old execution shows that work before claiming the new requirement is active. Surface these as operation attention, never new Task states.

Before acceptance, unclassified input temporarily guards acceptance and automatic preparation; status-only replies clear that guard. Unresolved changes/corrections keep Accept disabled with a concrete explanation. Once Owner acceptance succeeds, show the frozen delivered-to-be version and explain that later chat does not change or pause it. Planner can answer while preparation/checks/delivery continue, including after a retryable failure. New requirements after delivery belong in a new independent Task through Todo Discussion. An eligible explicit Request Changes action may revoke an entirely undelivered batch and return it to correction; ordinary messages do not do so. A published requirement revision needs fresh exact-result acceptance.

The conversation/delivery cutoff is successful Owner acceptance, even before a push or merge starts. Show later requests as outside that accepted batch, never as changes waiting to modify it. If a merge was dispatched, reconcile its actual outcome before offering explicit correction. After partial or completed delivery, changed requirements cannot redefine delivered work; the Owner returns to Todo Discussion for independent work. Terminal Task chat remains available for read-only questions and answers; it offers no new-Task preview or creation action.

### Visible exits for conversational waits

Pending/failed input and guidance offer Retry and Withdraw. Pending requirement proposals offer Revise or Withdraw; an admitted withdrawal shows reconciliation until its freeze is actually released. Explain any independent feedback/Replan/blocker still requiring action. A proposal waiting for confirmation does not disable the conversation composer. Blocker answers expose the existing Retry/Continue action with the recorded answer instead of implying that an ordinary reply resumed execution.

After delivery succeeds, show the accepted version and explain that later input did not affect it. Queued replies must not leave the Task permanently waiting for changes. Partial delivery still offers Retry of the accepted remainder without requiring later chat to finish. Further execution begins only when the Owner returns to Todo Discussion and confirms an independent Task preview there; Task Conversation does not generate that preview or transfer its messages automatically.

Local capture hard-limit failures appear on the blocked Node with recovery details. Publication-only size/content findings appear in REVIEW with the preserved result and remote preparation stopped. Show measured size, applicable limit and correction actions; only explicitly eligible policy findings offer an override. Provider hard limits do not.
