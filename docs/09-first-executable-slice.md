# First Executable Slice

This is an implementation sequence and acceptance boundary, not another owner of domain rules. Modules 01–08 remain authoritative. Stage A is an internal usable slice of V1, not a claim that all V1 capabilities have shipped.

## Outcome

An Owner can capture an idea, discuss it, confirm and start a Task, close the browser, return to a prepared GitHub PR, guide or revise the running Task through conversation, request a correction, and accept the corrected result. Service/Runner restart and repeated commands must preserve that same execution and delivery lineage.

```text
Capture (no AI)
→ Discussion (durable reply and requirement state)
→ confirm exact Task preview + Start
→ Task Planner publishes one Node
→ Owner chats with Task Planner; confirmed requirement change settles execution and continues the same Task (retaining or replacing its Node according to Plan rules)
→ Node opens repository, edits/tests, completes through Tool Protocol
→ system finalizes result and prepares PR
→ Owner Request Changes (Task remains REVIEW; acceptance blocked)
→ Task Planner routes feedback to Rework of the same Node (Task becomes RUNNING)
→ new activation updates the same PR
→ Owner accepts the exact result
→ expected-head merge succeeds
→ Task COMPLETED
```

## Stage A scope

| Area | Included | Deferred from this stage |
| --- | --- | --- |
| Deployment | One backend application, one relational database, one persistent Runner with a serializable authenticated service boundary; backend and Runner may share a host | Multiple Runner placement and machine migration |
| Owner access | One authenticated Owner, protected UI/API, separately authenticated Runner and scoped Attempt tools | Team/multi-tenant authorization |
| Client | Responsive Web capture, Discussion, Execution Board, Task detail/review, minimal configuration | Native mobile apps, external push/email |
| Project | Owner Context, one GitHub repository, one selected reusable Role; resource belongs to Project | Repository picker polish and multiple repositories per Project |
| Planning | Real Todo Planner and separate on-demand Task Planner, Task Conversation, Specification revisions, one-Node initial and confirmed replacement Plans, existing-Node review Rework, planning issues, feedback/change withdrawal and Replan dismissal | Multi-Node graphs and Planner repository inspection |
| Runtime | One installed, Owner-authenticated CLI Adapter with the bundled `monos` command client, two concurrent execution slots by default, Stop/Retry/Continue and durable guidance through controlled follow-up/stop-and-resume | Live steering, second real CLI and automatic cross-runtime fallback |
| Workspace | Lazy repository open, serial Task Workspace, private scratch, separate workspace directories, recoverable completion | Parallel worktrees and concurrent integration |
| Delivery | One PR per modified repository, pre-push checks, checks/mergeability, same-PR correction, exact-head acceptance, PR closed on Cancel | Multi-repository partial delivery, plain-Git branch-only delivery and `after_acceptance` remote preparation |
| Recovery | Durable dispatch, request idempotency, process fencing, restart reconciliation, attention | Permanent Runner-disk loss recovery |

The one-Node limit is an implementation boundary, not a fixed workflow template or new Plan type. Stage A Planner receives the supported limit; validator returns a clear unsupported-plan error for larger graphs and never silently flattens dependencies. Stage A supports confirmed Replan publication when the replacement still has one Node, including atomic publication with a requirement revision. This is necessary when a scope change changes that Node’s formal definition; give changed work a new Node identity under the existing Plan contract and preserve the Task/workspace lineage. A proposal requiring multiple Nodes remains unsupported with explicit attention: revise it to a genuinely sufficient one-Node plan, dismiss only if the current graph is sufficient, or cancel. Never flatten dependencies or pretend Rework satisfied a structural change.

Execution slots are configuration, not a separate scheduler implementation. Stage A defaults to two so one long Node does not starve Discussion. Discussion and Task planning still share slots with Node execution, so queued conversation must be visible. Owner may stop a Node to free capacity; the UI does not imply that queued Planner messages are being processed immediately.

Repository selection may initially accept one authorized GitHub repository identifier rather than implement the full picker. Installation/login of the coding CLI remains an Owner prerequisite. monos's GitHub delivery integration and CLI authentication are separate concerns and separate credentials.

## Implementation order and module contracts

0. **Boundary feasibility probe.** Before broad implementation, demonstrate the intended Runner OS/isolation with a real installed CLI: bundled `monos` discovery/invocation and authenticated commands, including Planner calls with read-only repository access, a non-interactive permission mode, lazy workspace exposure through reserved path grants (including a worktree's Git common directory), descendant-process termination, the module-11 host identity profile with no delivery-credential access, and recovery after losing a start acknowledgement. Measure how reliably the CLI makes its required commit/lifecycle calls and whether it exposes partial output for streaming. Also exercise the backend/Runner transport across separate process/filesystem roots. If these do not work, revise the Adapter/isolation choice before building product modules. This probe is not a full multi-Runner implementation.
1. **Command and persistence foundation.** Implement authenticated caller scopes, request receipts, exact-content confirmation, Task control records, Node activation, event sequence, transactional dispatch, and read projections. Verify with deterministic fake Runtime and delivery adapters before starting real processes. Fakes are test fixtures, not another product Runtime.
2. **Capture and Discussion.** Persist Original Capture without model invocation. Serialize Owner messages, commit replies/requirement state atomically, restore previews on reconnect, and create/start Tasks through authenticated commands. A replayed preview confirmation resolves to the same Task.
3. **Runner and real CLI.** Probe the selected installed CLI, validate scoped `monos` invocation and isolation, start one Attempt, stream logs, terminate its whole process tree, and reconcile after disconnect. Fresh-session reconstruction is sufficient initially; native resume is enabled only after Adapter compatibility is verified.
4. **Task conversation, planning and workspace execution.** Persist ordered Task messages and Planner replies/routing; publish authorized Specification revisions with impact and evidence guards; implement queued guidance and controlled stop-and-resume without requiring live steering. Publish a validated one-Node Plan, open the Project repository lazily, execute through the selected Role, finalize Git through a recoverable operation, and project REVIEW. Task Workspace contents stay private to the correct execution.
5. **GitHub delivery and review.** Export the finalized result tree into a controlled delivery commit, scan its actual publication range, automatically prepare the PR, show the exact local/remote result mapping, accept with a result-bound receipt, and merge through the provider expected-head guard. Handle failed checks and uncertain remote responses without new Task states.
6. **Correction and recovery UI.** Route Request Changes to the same Node, invalidate old evidence, start a new activation, update the same PR, and require new acceptance. Expose planning issues, feedback withdrawal, Replan dismissal, Retry, Stop/Continue, Cancel, and durable attention at the relevant scope.

Implement each step through its owning modules rather than having the UI or Runner update domain tables directly. Do not build a standalone generic workflow engine before this loop works.

### Boundary payloads

| Boundary | Minimum input | Durable result |
| --- | --- | --- |
| Owner → Todo | Original Capture or message, request ID | Todo/message ID and ordered sequence |
| Planner → Todo | Source turn, reply, requirement state, optional proposal | Atomic committed reply and processed watermark |
| Owner → Task | Exact preview/Project, proposal identity, confirmation and request ID | One stable Task, initial immutable Specification revision and control record |
| Owner → Task Conversation | Message or exact change confirmation, source/base identity, request ID | Ordered input and pending operation or authorized change |
| Task Planner → Task | Input watermark, reply/routing, expected basis | Durable reply and guidance/change proposal |
| Task Planner → Orchestrator | Task, current claim, effective Specification, graph or authorized change impact | Immutable revisions, settlement operation and atomic effective pointers |
| Orchestrator → Runner | Dispatch ID, Attempt/claim, context, selected target | Registered process ownership and ordered runtime events |
| Agent → Workspace | Authenticated execution scope, Project resource ID | Workspace ID/path, instruction files and recorded Git base |
| Agent → Orchestrator | Summary, optional Artifact IDs, request ID, current activation/claim | Recoverable completion operation, then current completion evidence |
| Orchestrator → Delivery | Result manifest/version and repository delivery identity | PR preparation operation and reconciled remote identity |
| Owner → Delivery | Exact result acceptance, request ID | Accepted delivery operation, then completion on confirmed success |

## Stage A acceptance gate

Demonstrate the full flow against an Owner-designated test repository and one real installed CLI. Publishing or merging in that repository requires the corresponding test-run authorization; the design document itself is not authorization to modify a remote repository.

| Exercise | Passing evidence |
| --- | --- |
| Capture several Todos without discussing them | No Planner Attempt exists for capture alone |
| Submit two messages while Planner is busy | Ordered replies; no lost input, duplicated reply, or newer-state overwrite |
| First Todo message fails while a second waits | Retry targets the first message; Withdraw preserves history, records its disposition and lets the second proceed after old execution settles, without requiring Planner availability or blocking another Todo |
| Withdraw Todo input races with reply commit or backend restart | One resolution wins; receipt/watermark/next-turn intent survive restart, late output is rejected, and no reply or next Attempt is duplicated |
| Confirm the same preview from two clients | One Task; second confirmation returns its existing identity |
| Close/reopen browser during Node execution | Same backend execution continues; persisted state/log cursor restores |
| Kill backend after completion intent or Git integration | Recovery finishes once; no duplicated commit/integration or missing completion event |
| Stop execution with a background child process | No successor writes until the old writers are terminated/isolated |
| End Runtime without `complete_node` | BLOCKED with Retry; no false completion |
| Invoke bundled `monos` from a real Agent | No MCP registration or separate CLI installation; scoped JSON command results, stable request-ID retries, stale-attempt rejection, and operation lookup after a lost response |
| CLI attribution with two concurrent Attempts under one execution account | Each CLI maps to its own supervised dispatch; another Attempt ID/socket hint cannot change identity, and an unrelated process or revoked Attempt is denied |
| CLI response is lost and its input file changes | Retry uses the retained original envelope; same ID with different payload is rejected; no duplicate effect or automatic fresh ID |
| Crash before/after request send and backend admission | Journal failure prevents sending; restart queries receipt truth; uncertainty is retained, and unaccepted work is never replayed under revoked authority |
| Completion stops the CLI before its response; old credential expires | Runner/backend recover the admitted operation and UI result through scoped reads; no old-credential renewal or dependency on the stopped process |
| Planner invokes `monos` under read-only execution | Submit long JSON through stdin and, where required, reserved scratch files; CLI/socket/HTTP(S) access works without interactive approval while repository writes fail. Record the supported Runtime version/settings; unsupported combinations fail the probe |
| Simulate lost PR-create or merge response | Query remote truth before retry; no duplicate PR or invented failure |
| Request Changes after REVIEW | REVIEW while routing, then RUNNING on Rework with no REPLAN_REQUIRED; same Task/Node/PR, new activation; obsolete outputs not current evidence |
| Change PR head after acceptance | Old acceptance cannot merge the changed result |
| Break provider access or required checks | Remain REVIEW with clear delivery failure and recovery action |
| Remove opaque session state before Retry | Current formal data reconstructs a usable execution context |
| Agent requests Replan in the one-Node Plan | Dismissal revokes associated Planner work and resumes the same Node after reconciliation, without a Plan revision |
| Owner dismisses Replan raised from review feedback | Feedback remains effective in REVIEW; fresh routing applies Rework or raises an issue, and Accept stays disabled |
| Agent commits then removes sensitive content before delivery | Exact final tree exported without private commit ancestry; later correction fast-forwards the public delivery branch |
| Feedback changes scope within the same delivery | Inline Specification proposal; confirmed revision reworks the same Node when graph suffices; stale acceptance rejected |
| Ask progress while a Node runs | Planner replies from current facts; execution continues and no revision is created |
| Revise requirements during execution, then restart backend | Same Task/workspace lineage; retain or replace Node as the confirmed Plan requires; one new requirement revision; old writers reconciled before continuation |
| Message arrives while Planner is busy or Node completes | Before acceptance, input preserves routing/follow-up guards; after acceptance, later conversation cannot alter or block the frozen batch |
| Confirm stale proposal or race input/change with Accept | Input/change first blocks acceptance; acceptance first rejects in-place changes and records later conversation; stale publication is rejected |
| Chat before Start, while stopped, or after completion | Reply available; no implicit Start/Continue or reopening of terminal delivery |
| Ask for further implementation in a terminal Task | Explain the terminal boundary; no Task-creation preview or automatic transfer to Todo. Owner returns to Todo Discussion and confirms an independent Task without inherited Task context |
| Result cannot be durably captured because of a local hard limit | Node BLOCKED with preserved recovery data; reconcile/repair before Retry, no false completion |
| Finalized result includes a tracked ignored file, publication-oversized file or credential-like content | Findings shown in REVIEW before remote write; provider hard limits cannot be overridden; ignored untracked files are not silently added |
| CLI asks for interactive approval | Owner attention appears; no silent wait |
| Cancel a Task in REVIEW | Open PR closed and branch kept; local result retained |

Use fault injection for exact crash windows and a real-process smoke run for CLI/tool/isolation compatibility. Passing only fake-adapter tests is not sufficient. Stage A does not claim the multi-repository or parallel acceptance cases in module 06 have passed.

## Stage B and V1 completion

After Stage A passes, add a second CLI Adapter and ordered fallback on the same Node, then serial multi-Node dependencies, Rework invalidation, and Planner repository inspection. Extend the Stage A confirmed Replan publication contract to multi-Node graphs before parallel execution. Finally add isolated worktree allocation/integration and multi-repository delivery, exercising their corresponding module-06 failure scenarios.

Plain-Git delivery, the full repository picker, and broader settings/UI can follow the same established command boundaries. These are later implementation slices of the existing V1 design, not excuses to bypass an invariant in Stage A.

## Selected technology and remaining feasibility work

[Technology & Deployment](11-technology-and-deployment.md) fixes React/Vite/TypeScript Web, Fastify/Node.js backend, PostgreSQL/Drizzle, a Go Runner on Linux invoking host-installed CLIs as native processes, and HTTP(S)/SSE/WS(S) transports with optional TLS. These are accepted choices, not open language/framework questions.

Before broad implementation, verify PostgreSQL transaction/claim behavior, the native host process-supervision and workspace-permission design, and cross-process protocol generation/validation. Select an actually available Owner-installed host CLI and test its existing authentication, `monos` commands and lazy workspace access. Configure an authorized GitHub test repository and verify expected-head merge/check behavior. Choose the Owner sign-in and TLS setup before exposing the service.

Concrete tool/package versions are pinned at scaffolding time. A selected stack does not waive any feasibility or fault-recovery acceptance gate.

## Expansion guards required in Stage A

Keep the full collection cardinalities and location-independent IDs even where Stage A accepts one item. Test the control/placement boundary with two fake Runner identities and distinct filesystem roots: Auto must resolve logical Runtime IDs, an existing workspace host must prevent unsupported movement, and a delayed old dispatch must be rejected. Production deployment still uses one Runner. Do not claim these tests prove actual workspace transfer or cross-machine recovery.

A second backend worker against the same database must not double-claim an Attempt, exceed capacity, or concurrently own the same integration/delivery effect. Exercise duplicate and reordered normalized events through the versioned transport. These checks belong in Stage A because process-local shortcuts are expensive to remove later.

### Conversation closure acceptance cases

- A single-Node requirement change alters the Node goal: confirm and publish the replacement Plan and Specification together, preserve workspace history, and continue under the replacement Node without forcing a new Task.
- Planner prepares a proposal then crashes before committing its reply: the proposal cannot be confirmed; Retry produces one canonical reply and eligible proposal.
- Ask a progress question while awaiting confirmation or settlement: reply commits with observation provenance, without clearing the pending change or holding its publication lock.
- Withdraw an admitted change after writers stopped: reconcile, retain the previous Specification, release only its freeze, and resume eligible old-basis work without resurrecting acceptance or ignoring Owner Stop.
- Route guidance immediately before/after completion admission: exactly one input disposition survives; delivered-but-unhandled guidance cannot unblock acceptance.
- Withdraw failed input while Planner is unavailable: the Owner command resolves only that obligation and lets later queued conversation proceed.
- Receive new input after acceptance but before any push, during CI, or after merge dispatch: preserve and answer it without blocking the frozen batch; no in-place change is applied, and completion binds only the originally accepted result.
- Keep Planner unavailable while later messages wait, restart the backend, or fail the first push: delivery/Retry retains its input cutoff and proceeds without requiring those replies.
- Explicitly Request Changes before any item finalizes: revoke the batch under the delivery guards, reconcile effects and restore later requests to ordinary input handling without duplicating replies.

## V1 single-host release gate

V1 is a complete deployment on one Linux host with one Runner, not merely the Stage A single-Node demonstration. The host runs Compose backend/PostgreSQL and the native Runner/Owner-installed CLIs. Normal operation requires network access to configured model providers and Git remotes, but not a second Runner, external queue service, object store, or publicly reachable webhook receiver. Browser closure must not interrupt execution.

Stage A and Stage B are implementation ordering within this V1. Single host does not mean single Task, Node, Role, or repository. Before declaring V1 complete, demonstrate the Stage A loop plus the following on that same host:

| Gate | Required evidence |
| --- | --- |
| Fresh install and first Task | Follow module-11 setup from empty product state, authenticate Owner, enroll Runner, configure one working CLI/Planner/Role/Project/GitHub integration, and create the first Task without manual database edits |
| Conversation and revision | Question, guidance, requirement-only revision, changed-Node Replan, proposal replacement/withdrawal, and review correction all reach a documented result or recoverable Owner action |
| Serial multi-Node work | Dependencies unlock from current completion evidence; upstream Rework invalidates descendants and preserves unrelated work |
| Parallel work on one Runner | Two Nodes use separate worktrees; integration is serialized; conflicts route to correction; combined-result evidence has the correct revision |
| Replan after execution began | Retained/replaced Nodes and interrupted private work follow the same publication and workspace ownership contracts |
| Runtime fallback | Two supported installed/authenticated CLIs can continue the same Node/workspace through ordered fallback with fresh formal context; no shared opaque session assumption |
| Multiple repositories | A Task can deliver multiple repository items; partial success, remaining-item Retry and Cancel report remote truth without pretending atomicity |
| Delivery modes | GitHub automatic preparation and after-acceptance preparation, plus supported plain-Git branch delivery, preserve exact-result acceptance; non-Git/no-change work can complete through Owner acceptance without a PR |
| Plain-Git preparation versus acceptance | Preparation remains correctable before Owner acceptance; acceptance freezes the batch, then verified publication finalizes the item. Later chat cannot block push Retry or finalization; explicit Request Changes obeys finalization guards. No target-branch merge is claimed |
| Mixed GitHub/plain-Git delivery | Preparation pushes do not count as final success; confirmed merges and recorded branch acceptances do. Partial failure retains completed items and retries only the unchanged accepted remainder, even while later conversation is queued |
| Provider refresh without webhooks | PR checks/mergeability/remote outcomes advance via durable polling after the browser closes; transient access failure can recover through Retry |
| Restart recovery | Independently restart backend, Runner and the entire host with persistent disks; reconcile Attempts, pending inputs, workspace and delivery operations before replacement execution |
| Capacity saturation | With every execution slot occupied, chat shows queued status and authenticated Stop/Cancel/Withdraw remain usable without scheduling an Agent |
| Resource/configuration failures | Expired CLI/Git credentials, missing build tools, unavailable Runtime and low disk space have actionable attention, preserved work and explicit recovery |
| Settings and result access | Owner can configure required Project/Role/Runtime/delivery settings and inspect conversation, history, managed Artifacts and errors after reconnect |

Native mobile, same-Task distributed execution, workspace transfer, automatic recovery from permanent Runner disk loss, live steering and native session resume are not prerequisites for this gate. Future extension guards remain in place, but no V1 core path may require those features. Tests for the claimed CLI/provider/host behavior use actual supported installations, not only fake adapters. Record versions, host profile and results in the release evidence; documentation alone is not a passing run.
