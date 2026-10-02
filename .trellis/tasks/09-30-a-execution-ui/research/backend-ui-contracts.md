# Research: Backend contracts for Execution Board and Task UI

- Query: Which existing authenticated reads, commands and event contracts support Board, Task Conversation/Overview/Timeline/Execution Details and every existing Owner exit? What minimal additions are needed?
- Scope: internal; source and generated-schema inspection, no mutation/deployment/service work
- Date: 2026-10-02
- Task: `.trellis/tasks/09-30-a-execution-ui`

## Findings

### Recommended implementation boundary

All execution, Conversation, Specification and Replan mutations already exist. Reuse these command families and their scoped immutable receipts; do not introduce a combined “approve and execute” mutation or derive state from prose.

Required additions are a bounded canonical Board read and a noncredential browser session identifier to scope reload-safe Task draft/command storage. A narrow result/workspace read is warranted if the UI must show finalized Git identity: existing Node reads expose the completion manifest, but not the finalized Git commit/tree or complete workspace attribution. Existing frontend Task API adapters and components cover almost none of this surface.

There is **no Owner SSE route** in `apps/server/src/app.ts`. `/v1/runner` is Runner WSS (`app.ts:195–200`) and must not be consumed by the browser. Existing bounded read contracts can support polling immediately. If the design explicitly chooses SSE, implement an authenticated read/invalidation transport over the same canonical readers, with reconnect cursors and teardown; it must not become another state store or permanent service. Task formal events alone cannot drive all invalidation: Conversation messages and some queue/physical settlement changes do not append Task formal events.

### Sources and invariants

| File | Relevant responsibility |
| --- | --- |
| `ARCHITECTURE.md`, `docs/08-principles-and-non-goals.md` | Agent semantic work versus deterministic Tool Protocol transitions; no natural-language transition authority |
| `docs/07-owner-review-and-ui.md:356` | Board mapping and queued versus attention distinction |
| `docs/07-owner-review-and-ui.md:401` | Overview/current effective progress; historical graph work belongs to Timeline |
| `.trellis/tasks/09-28-a-task-execution/research/decomposition.md:37` | This leaf owns combined execution UI/scoped reads and exact reload recovery; `#execution` remains settings |
| `.trellis/tasks/archive/2026-10/09-30-a-specification-changes/design.md:22` | Separate Owner authorization/application and bounded complete proposal reads |
| `.trellis/tasks/archive/2026-10/09-30-a-single-node-replan/design.md:101` | Exact independent Owner approvals, publication and independent exits |
| `packages/protocol/schemas/v1/contracts.json` | Sole wire authority (`definitions`); generated TS/Go/OpenAPI must follow changes |
| `apps/server/src/app.ts:132` | Registered Task read/command routes |
| `apps/server/src/owner-reads.ts:101` | Attempt, raw-log, overview and formal-event reads |
| `apps/server/src/task-planning.ts:148` | Initial planning status, available actions and immutable Plan detail |
| `apps/server/src/node-execution.ts:256` | Canonical Node controls and recovery guards |
| `apps/server/src/node-execution.ts:561` | Node source/blocker/operations/current activation manifest |
| `apps/server/src/task-conversation.ts:64` | Ordered input commands and immutable receipt admission |
| `apps/server/src/task-conversation-reads.ts:11` | Input/guidance/issue projections and action lists |
| `apps/server/src/task-specification-reads.ts:7` | Exact requirements proposal/detail/history/change reads |
| `apps/server/src/task-replan-reads.ts:8` | Request, graph proposal, effects and remaining requirements reads |
| `apps/web/src/lib/api.ts:11` | Validated same-origin HTTP and uncertain-response handling |

Backend/protocol specs consulted: `backend/index.md`, `owner-reads.md`, `owner-commands.md`, `execution-logs.md`, `task-planning.md`, `node-execution.md`, `task-conversation.md`, `task-specification.md`, `task-replan.md`; `protocol/index.md`, `protocol/commands.md`; frontend `state-management.md` and `type-safety.md`. Workflow read: `.trellis/workflow.md`.

### Authentication, errors and shared replay rules

- Browser uses same-origin HTTPS and the `__Host-monos` Secure/HttpOnly/SameSite=Strict cookie. Mutation requests with cookie authentication must carry the exact same Origin (`app.ts:32–47`); never expose the token to JavaScript. `Cache-Control: no-store` applies to all `/v1/owner/` routes (`app.ts:68`).
- Authenticate every read, receipt lookup and replay. `owner_sessions.id` is a random UUID separate from the random `owner.v1.*` credential and its stored digest (`owner-commands.ts:25–40`). Session expiry/revocation must clear UI sensitive/local state and end subscriptions.
- Errors use `CommandResult {schema_version:1,status:'error',error:{code,message,...}}`. HTTP 401=`unauthorized`, 403=`denied_scope`, 429=`rate_limited`, 500=`internal_error`, other domain/schema errors=409 (`app.ts:49–66`). Use error codes, not message matching.
- All Task command families store immutable `owner_command_receipts` under `(scope_id=task_id,request_id)` and compare a canonical digest. Generate unique request IDs across families, not just per endpoint. Identical replay returns the original response after later state changes; changed payload with the same identity is `payload_conflict`.
- Read the exact receipt before deciding a mutation was lost. `unknown` means no recorded result yet, not proof of failure. Only resend the exact saved envelope, with the original IDs, versions, digests and basis. A refreshed snapshot never silently rebases it.
- Transport interruption, malformed/incompatible success JSON or HTTP 5xx after POST is uncertain. Existing `request()` already models this (`apps/web/src/lib/api.ts:11–23`). Extend the existing adapter pattern to all families and validate response `request_id`, family-specific result identity and Task scope where present.
- `TaskSpecificationResult` and `TaskReplanResult` **do not contain `task_id`**. Bind their scope from the saved request and scoped receipt URL. `TaskConversationCommandResult` does contain `task_id`.
- `committed` records the Owner decision; `admitted` points to physical work. Even a `committed` Conversation/Replan result may contain `operation_id` whose process cleanup is pending. Never label physical completion from receipt status alone.

### Existing read route matrix

All paths below start with `/v1/owner`; `:t` is exact Task ID. Query cursors are opaque and must be URL-encoded.

| Route | Schema and key contents | Paging / use |
| --- | --- | --- |
| `GET /tasks/:t` | `TaskOverview`: Task/control/state/current Spec, optional Plan, Node counts, queued/held Attempt counts, open operations, event cursor; optional title/Todo/Project/initial Spec/created time/current Spec text | Consistent canonical share-lock snapshot; no list route |
| `GET /tasks/:t/planning` | `TaskPlanningStatus`: state/control/Spec, optional Plan/source/Attempt/operation/issue, status/reasons, `available_actions` | Initial planning controls; source includes `intent_id` |
| `GET /tasks/:t/plans/:plan_id` | `TaskPlanRevision`: exact Plan/Spec/digest and complete `ExecutionPlanNode[]` | Immutable definition; historical IDs accepted if same Task; legacy missing canonical definitions rejects |
| `GET /tasks/:t/nodes/:node_id/execution` | `NodeExecutionStatus`: current activation/control/Spec/Plan, Node state, nullable source/wait/Attempt/blocker/manifest, operations, optional `guidance_paused` | Read current Plan's Node IDs, not arbitrary historical Nodes; no `available_actions` field today |
| `GET /tasks/:t/events?cursor=` | `TaskEventPage`: `events,cursor,has_more,reset_required` | Forward Task formal history, at most 64 and below 2 MiB |
| `GET /tasks/:t/attempts?cursor=` | `AttemptListPage`: `attempts,cursor,has_more` | 64 newest-first, cursor bound to Task and `(created_at,id)` |
| `GET /tasks/:t/attempts/:attempt_id` | `AttemptStatus` | Explicit selected Attempt status and physical facts |
| `GET /tasks/:t/attempts/:attempt_id/logs?cursor=` | `AttemptLogPage`: raw events, `cursor,has_more,gap_after` | Up to 64 contiguous globally ordered events; separate from formal events |
| `GET /tasks/:t/operations/:operation_id` | `OwnerOperationStatus`: exact operation/Attempt/kind/state, process absent/released, attention/failure/end reason/cancellation link | Poll after admitted Stop or completion recovery |
| `GET /tasks/:t/artifacts?cursor=` | `ArtifactPage`: metadata array, optional `next_cursor` | At most 64; Task history includes older outputs, so distinguish current manifest selection |
| `GET /tasks/:t/artifacts/:artifact_id` | `ArtifactRecord {metadata,content:{text,media_type}}` | Authenticated managed content; no local filesystem path fetch |
| `GET /tasks/:t/conversation` | `TaskConversationStatus`: independent version/sequence/watermark, input/guidance/issue summaries and has-more flags, source/Attempt/reasons, acceptance guards, current actions | Per-kind summaries at most 64; content is omitted from summaries |
| `GET /tasks/:t/conversation/messages?cursor=&query=` | `TaskHistoryPage`: messages, cursor, has_more | Latest 64 initially; cursor loads older; page rendered in ascending sequence; search bound into cursor |
| `GET /tasks/:t/conversation/operations?cursor=` | `TaskInputOperationPage`: items, cursor, has_more | Full content/action/version for all input/guidance/issues; 64 and byte bounded; lexicographic ID order |
| `GET /tasks/:t/conversation/guidance/:guidance_id/recipients?cursor=` | `TaskGuidanceRecipientPage` | Exact Node/activation obligation/source/Attempt attribution; 64 per page |
| `GET /tasks/:t/specification` | `TaskSpecificationStatus`: current `basis`, current full `impact`, proposal/change summaries and has-more flags | At most 64 each; active proposal prioritized |
| `GET /tasks/:t/specification/proposals?cursor=` | `RequirementHistoryPage`: proposals, nullable next_cursor | 32 per page, raw ID cursor |
| `GET /tasks/:t/specification/proposals/:proposal_id` | `RequirementProposalDetail` | Full untruncated requirements + summary, proposal/content/spec/impact digests, exact basis/impact/input cutoff/source IDs/predecessor/confirmation/operation; optional Replan source |
| `GET /tasks/:t/specification/revisions?cursor=` | `SpecificationRevisionPage` | 32 immutable revision summaries, nullable next_cursor |
| `GET /tasks/:t/specification/revisions/:revision_id` | `SpecificationRevisionDetail` | Revision, `content_json`, exact applicability; parse JSON once, do not render JSON quoting as Markdown |
| `GET /tasks/:t/specification/changes/:change_id?cursor=` | `RequirementChangeDetail` | Exact operation/version/attention; 64 effects with next cursor; first 64 attributed Attempts plus has-more |
| `GET /tasks/:t/replan?cursor=` | `TaskReplanStatus`: requests, nullable next_cursor, independently resolved current_request | 64 summaries, raw ID cursor |
| `GET /tasks/:t/replan/requests/:id?cursor=&effects_cursor=` | `ReplanRequestDetail` | Request, 32 proposal summaries, source, Attempt ID, waiting/issue reason, 64 physical effects, remaining requirements + has-more |
| `GET /tasks/:t/replan/proposals/:id` | `ReplanProposalDetail` | Exact complete `PrepareReplan` content, input cutoff, linked requirements digest, nullable confirmation |

Route registration: `app.ts:132–172`. Readers enforce Task ownership and bounded content. Do not derive these route forms from the raw DB schema or use Runner credentials from the browser.

#### Important response semantics

- `TaskOverview.state` is one of PLANNING/RUNNING/BLOCKED/REPLAN_REQUIRED/REVIEW/COMPLETED/CANCELLED. Missing `plan_id` is omitted in overview; `TaskActionBasis.plan_id` is explicitly nullable. Preserve this difference.
- `TaskOverview.held_attempts` includes every not-yet-released Attempt, not only running work. It cannot establish active execution or queue prominence. Add explicit `running_attempts` to Board projection rather than calling held work “running.”
- Planning status values: `not_started,pending,unavailable,queued,processing,settling,interrupted,issue,stopped,cancelled,published` (`task-planning.ts:165`). Available actions are authoritative hints but the mutation rechecks guards.
- `NodeExecutionStatus.source` can be null before source preparation. Its nested Attempt has only `attempt_id,state,process_released,end_reason`; fetch `AttemptStatus` for `mutation_allowed`, started/process_absent and log facts.
- Node operation entries contain `operation_id,kind,state,failure_kind`; completion/settlement entries include `completion_identity_digest`. Preserve that exact digest for recovery.
- `CompletionManifest` binds operation/Task/Node/activation/Attempt/source/Spec/Plan, summary, artifact IDs and digest; optional version/handled guidance IDs. It **does not contain Git commit/tree**. Only a manifest attached to the current applicable completion is formal result evidence.
- `TaskMessage` is immutable message ID/sequence/author/content/created time/input ID, with source/watermark/observed-control/observed-time on canonical replies. `disposition` may refresh when input is withdrawn. Merge by message ID and sequence, preserving immutable text while accepting current disposition.
- Guidance recipient `launch_status` distinguishes included_in_source, included_in_launch and launch_started; none means handled. Handling needs the canonical obligation/completion status.
- `ReplanRequestSummary.physical_settled` currently reflects Task-wide `replanQuiescent`, including for historical summaries (`task-replan-reads.ts:16`), not an immutable historical milestone. Label as current settlement observation.
- Proposal existence or confirmation is not publication. Use `current/attached/revoked/expired`, independent operation status and canonical current pointers.

### Existing command matrix

#### Task planning and Node execution

`POST /v1/owner/commands` takes `OwnerCommand`:

```text
{schema_version:1, request_id, scope_id:task_id,
 expected_control_version, name, payload}
```

Recover at `GET /v1/owner/scopes/:task_id/commands/:request_id` -> `OwnerCommandResult {schema_version,request_id,status:committed|admitted|unknown,...}`. A committed result includes an authorization or Task/Attempt control outcome. Admitted result includes exact `attempt_id,operation_id`.

| name | Canonical payload | Guard / UI meaning |
| --- | --- | --- |
| `start_task` | `{specification_id}` | Viewed PLANNING Spec, no Plan, active Project and selected available Role; creates intent, not instant Runtime execution |
| `stop_initial_planning` | `{planning_intent_id,issue_sequence?}` | Exact current pre-Plan RUNNING source; returns Task to PLANNING, fences/settles only its Planner |
| `retry_initial_planning` | `{planning_intent_id,issue_sequence?,answer?}` | Exact intent; live mutation authority must be stopped; open issue requires current sequence and nonblank answer |
| `cancel_task` | `{specification_id,planning_intent_id?,plan_id?}` | Preserve exact current Spec/Plan; post-Plan path performs canonical Node/input cleanup; accepted delivery has its own future cancellation semantics |
| `stop_node` | `{node_id,node_activation,source_id}` | Exact current membership/source; queued Stop may commit without operation; running work settles asynchronously |
| `continue_node` | `{node_id,node_activation,source_id,blocker_id?,answer?}` | Owner-stopped exact blocker, or completed Node's explicitly paused guidance followup; not a generic Retry |
| `retry_node` | `{node_id,node_activation,source_id,blocker_id?,answer?}` | Exact blocked semantic/factual source; semantic blocker needs explicit answer or recorded exact answer; Owner Stop requires Continue |
| `recover_completion` | `{node_id,node_activation,source_id,operation_id,completion_identity_digest,mode:'retry'|'correct'}` | Recover original completion identity; correct must first settle the original; Cancelled Task permits exact cleanup retry only |

Older Attempt-only Stop/Retry/Continue forms remain in schema for legacy sources. New canonical UI should use source/activation identity and not downgrade to legacy Attempt payloads. Canonical successor intents may be saved while old cleanup is pending, but promotion never bypasses physical release or unresolved operations. A retained completion owns recovery; a fresh Retry cannot bypass it. Relevant source: `task-planning.ts:51–99`, `node-execution.ts:307–513`.

There is no explicit `answer_node_issue` Owner endpoint. The direct Node answer belongs in `retry_node.answer`; initial planning answer belongs in `retry_initial_planning.answer`. Conversation can also route a recorded answer, but ordinary text admission itself does not resolve a blocker.

#### Task Conversation and obligations

`POST /v1/owner/tasks/conversation/commands` takes:

```text
{schema_version:1,request_id,task_id,name,payload,expected_version?}
```

Recover at `GET /v1/owner/tasks/:t/conversation/commands/:request_id` -> `TaskConversationCommandResult` (`committed|unknown`, Task/request ID and optional input/message/operation/version).

- `submit_task_message`: `{message_id,content}`; preserve both request ID and message ID. Text max 65,536 characters, nonblank, bounded UTF-8; submit has no execution control version. It appends ordered input; before Start/while stopped/terminal messages do not implicitly start/reopen work.
- `stop_task_turn`: `{operation_id}` plus `expected_version`; target ID is the **input operation ID**, not the physical Stop operation. Retains input and stops its current Planner source.
- `retry_task_input`: same target/version shape; input must be current unresolved head with no live mutation authority. Guidance Retry requests ordered reassessment; issue Retry creates a new related input using recorded answers. This command has no freeform answer field.
- `withdraw_task_input`: same target/version shape; works for unresolved input, active guidance or open input issue. Resolved replied input cannot substitute for its remaining obligation. Withdrawal leaves historical messages/dispositions visible.

Per-operation `available_actions` is more useful than only top-level actions. `task-conversation-reads.ts:16–36` offers Stop+Withdraw for live input, Retry+Withdraw for other active obligations, none for resolved. These are hints: later queued input may still require earlier head resolution on Retry. `task-conversation.ts:142–289` rechecks exact versions and targets. For an input issue answer, use the normal composer for semantic routing, then its explicit Retry if still needed; do not fabricate an unsupported answer payload.

#### Exact Specification proposals

`POST /v1/owner/tasks/specification/commands` takes `{schema_version:1,request_id,task_id,name,payload}`. Recovery: `GET /v1/owner/tasks/:t/specification/commands/:request_id` -> `TaskSpecificationResult` (`committed|admitted|unknown`, **no task_id**).

| name | payload | UI contract |
| --- | --- | --- |
| `edit_specification` | Full `PrepareSpecificationRevision`: `{proposal_id,specification,summary,basis,impact,source_input_ids,supersedes?}` | Owner edit creates an exact proposal; use read basis/complete impact, never infer graph sufficiency from prose |
| `confirm_specification` | `{proposal_id,content_digest}` | Approves exactly displayed full text/impact; retain returned confirmation ID |
| `apply_specification_revision` | `{proposal_id,confirmation_id,basis}` | Separate application; only sufficient graph branch; can admit without Runtime availability |
| `withdraw_specification` | `{proposal_id,expected_version}` | If a change exists, version is change.operation.version and status must be settling; otherwise pending obligation/proposal.version |
| `retry_specification` | `{operation_id,expected_version}` | Exact settling/withdrawing change; retry its original physical effects |
| `defer_specification_inputs` | `{proposal_id,inputs:[{input_id,version}]}` | Explicit exact input deferral only; no automatic blanket deferral |

Read full `RequirementProposalDetail` before confirmation, including exact basis/impact and source attribution. Details contain confirmation ID and operation so two clients/reload recover authorization and settlement. Full Spec is max 65,536 chars; summary max 4,096. Required contents cannot be clipped for approval.

Precondition/eligibility rejects changed basis/evidence, unattached draft, replaced/withdrawn/revoked/expired proposal, later unresolved inputs without exact deferral, terminal/accepted Task. A `graph_sufficient:false` joint requirement can be confirmed/withdrawn independently but **cannot be applied through standalone Spec apply**. Show linked Replan and remaining exits. Sources: `task-specification.ts:29–84`, `task-specification-reads.ts:7–14`, backend Specification spec.

#### Exact Replan graph and independent exits

`POST /v1/owner/tasks/replan/commands` uses the same Task envelope shape. Recovery: `GET /v1/owner/tasks/:t/replan/commands/:request_id` -> `TaskReplanResult` (`committed|unknown`, **no task_id**).

| name | payload | UI contract |
| --- | --- | --- |
| `confirm_replan` | `{proposal_id,content_digest}` | Exact full graph+summary+impact; confirmation does not publish |
| `publish_replan` | `{proposal_id,confirmation_id,basis,requirement_confirmation_id?}` | Preserve proposal's approved basis; joint graph needs independently confirmed linked requirements |
| `dismiss_replan` | `{replan_request_id,expected_version,direction?}` | Resolves only graph request and its authority; linked requirements remain independently withdrawable |
| `retry_replan` | `{replan_request_id,expected_version,issue_id?,answer?}` | Exact pending request; current issue requires exact issue ID and answer; no issue rejects answer/issue extras |
| `defer_replan_inputs` | `{proposal_id,inputs:[{input_id,version}]}` | Explicit exact deferral; does not withdraw guidance/requirements |

`replan/requests/:id` is necessary after dismissal/withdrawal to keep independent `remaining_requirements` and physical cleanup discoverable. Requirements withdrawal invalidates dependent graph eligibility but does not dismiss the Replan request. An expired graph must be regenerated via Retry on the same Replan request with its current version; do not extend expiry or reuse authorization for a new proposal. A fresh Retry command request ID is a new Owner decision; it does not mean changing the Replan request ID. Lost Retry response reuses the Retry **command** ID/payload.

Publication waits for actual old/preparing process and lease release (`physical_settled` is necessary, not sufficient). State still rechecks exact current graph, basis, freezes, input cutoffs, digests and both approvals. Keep complete source/requirement linkage. Sources: `task-replan.ts:38–72`, `task-replan-reads.ts:12–25`, backend Replan spec.

### Timeline, raw logs and result presentation

- Only `task_events` supplies formal Timeline. Events are `{sequence,kind,body,attempt_id?,operation_id?}`; **there is no top-level timestamp** in the current schema. Display sequence/order when a truthful time is unavailable; add a canonical persisted timestamp field only if required, never invent browser receive time as event time.
- Event cursor is canonical Task-bound `{version:1,task_id,after}` encoded base64url (`owner-reads.ts:10–27`). It is a position, not a token. On `reset_required`, refresh overview, show unavailable history, and resume using its authoritative cursor. Deduplicate by Task+sequence.
- Current event source examples: planning/node decisions, `specification_change_admitted`, `specification_change_published|withdrawn|cancelled`, `replan_requested`, prepared outcome, `replan_published`, `dismiss_replan`, `retry_replan` (`task-specification-settlement.ts:45,96`; `task-replan-state.ts:33,132`; `task-replan-publication.ts:70`; `task-replan.ts:70`). Group low-level events for readability without fabricating semantic outcomes. Unknown kinds need a safe fallback.
- Raw logs use separate Attempt-scoped cursor `{version:1,task_id,attempt_id,after}` and global `order_sequence`. `gap_after` marks unacknowledged continuation; never silently skip holes. Legacy Attempts have no global log order and reject ordered log reads (`owner-reads.ts:128–151`). Raw `started/output/attention/capture_failed/exited/process_absent` are diagnostics; output saying completed changes nothing.
- Overview current progress must join current Plan membership. Existing `TaskOverview.nodes` does this; `GET nodes/:id/execution` alone accepts any same-Task Node, so drive it from current Plan IDs and explicitly label historical context elsewhere (`owner-reads.ts:184–200`, `node-execution.ts:565–569`).
- REVIEW means a settled local result ready for inspection. Do not expose a pretend PR/acceptance/Deliver command. Finalized Git identity requires trusted effect/workspace projection, not an Artifact's claimed SHA or prose. `task_workspaces` persists `base_commit,target_branch,finalized_commit`; trusted completion effects carry `git_commit,git_tree` (`0016_serial_workspaces.sql:16–25`, `node-completion.ts:179–193`).

### Minimal new read contracts

#### Board

Recommended route: `GET /v1/owner/tasks?project_id=&state=&cursor=` (final names may follow parent design), generated strict `TaskListQuery/TaskListPage/TaskListItem` schemas.

- Bounded page (e.g. 32, at most 64), explicit `has_more`/opaque cursor, deterministic `(created_at,id)` ordering with cursor-bound filter. Prefer per-column/status queries if required to avoid showing a partial global page as a complete Board.
- Item: Task ID, title, nullable/optional Project and source Todo, created time, canonical state, control/current Spec/optional Plan, exact current Node counts, `queued_attempts`, **`running_attempts`**, `held_attempts`, open-operation count, factual attention entries (kind+scope/target+short reason), planning phase/reason as applicable. Include current event sequence/cursor only if useful for refresh.
- Canonical PLANNING -> Ready to start includes stopped initial planning; distinguish status `not_started` versus `stopped` using initial intent/provenance. RUNNING/BLOCKED/REPLAN_REQUIRED -> Running; REVIEW -> Review; COMPLETED -> Done; CANCELLED -> history filter. Do not derive board state from Attempt labels alone.
- Read must rebuild from canonical tables, authenticate, filter scope correctly, and give a consistent bounded snapshot. Avoid N+1 full Spec/Plan bodies and avoid returning secrets/provider config. No Board lifecycle table or mutating drag/drop API.
- Queue capacity alone is not attention. Collect independent factual issues/blockers/change attention/replan waits without losing their identities. Card may show a primary reason with a count/link to all current attention.
- Preserve unsupported/legacy fixtures as records with unavailable canonical details if included; never pretend they have runnable sources or synthesize a Plan.

#### Reload-safe session identity and storage

Extend `OwnerSessionStatus` with noncredential `session_id` when authenticated; expose existing UUID from login and session read (`owner-commands.ts:25–29`, `owner-access.ts:53–58`, `app.ts:118–125`). No migration or new authentication mechanism is needed. UUID must never authorize any request.

Explicitly amend the old frontend spec's blanket memory-only/persistent-command prohibition **only for Task draft/exact command state**. That older policy admits reload loses uncertainty and conflicts with this leaf's explicit reload acceptance.

- Use same-tab `sessionStorage`, keyed by protocol/storage version + authenticated session UUID + Task ID + action target/family. Store only supported Task draft bodies and immutable allowlisted Task command envelopes; no password/provider/Runtime keys, cookies, token digest, auth headers or configuration commands.
- Persist and validate the exact envelope **before** POST. If storage quota/availability fails, do not send an unjournaled action while claiming reload-safe recovery; show actionable local-storage failure.
- On reload, authenticate first, discard mismatched/expired namespaces, validate saved schema/family/Task/size bounds, then lookup exact receipts. Unknown permits exact resend, not a new ID or updated version. Incompatible/corrupt journal data must not be treated as a safe replay.
- Keep chained approvals separate: save confirmation command, resolve it, save apply/publication envelope containing exact returned authorization(s), then send. For a known confirmed proposal read from another client, explicit action may use that exact canonical authorization. A lost publication response must not create fresh confirmation IDs.
- Clear exact committed submission draft only if it still matches the submitted draft; retain any later edits and unrelated Task drafts. After commit/recovery invalidate canonical queries; never overwrite newer server state with old receipt snapshots.
- Clear namespace on logout/revocation/expired session and detected session replacement. For same-origin other tabs, a nonsecret BroadcastChannel/session-change notification can invalidate caches and purge their own namespaces; do not persist secrets or claim sessionStorage is cross-device storage.
- Two clients reconstruct known results from canonical reads/receipts; one client's unknown not-yet-committed envelope cannot be reconstructed by another client that never possessed it. Acceptance should test each client's same-envelope recovery and concurrent exact authority checks, not impossible cross-device recovery of an unsent local draft.
- Server-only receipt recovery cannot meet full reload replay with unknown result unless the client retains payload or a new server journal is introduced. The scoped sessionStorage approach is the smaller change.

#### Optional narrow execution result/actions projection

If the UI design requires actual Git/workspace details, add an authenticated Task/Node completion result read or additive validated fields. Return only exact trusted completion operation/manifest plus finalized Git commit/tree and fixed workspace/resource/base/target identity with current applicability. Omit or explicitly null repository data for repository-free completion. Never read a Runner path on the backend.

For action availability, either use existing planning/Conversation hints plus exact Node/Spec/Replan guards above, or add a read-only `available_actions`/disabled-reason projection beside these readers. Do not create a second permission authority: commands still revalidate under locks. Node controls must not be enabled merely because state=BLOCKED; source/activation/blocker/recovery ownership matters.

## Caveats / Not Found

- Source inspection only; no new tests, network requests, services or deployment were performed by this research.
- No `GET /v1/owner/tasks` Board list, Owner SSE endpoint, Task workspaces list, or dedicated finalized completion Git result API exists at the inspected baseline.
- Formal Timeline currently lacks canonical timestamps. Conversation status summaries omit content; use operation pages rather than presenting blank issue/guidance cards.
- Specification change attributed Attempts have `attempts_has_more` without a separate Attempts continuation cursor. Replan remaining requirements likewise has a has-more flag; complete proposal history provides the next discovery path. Do not hide truncation or claim all items were read.
- Node execution operations read hard-fails beyond 256 rather than paginating. This is an existing bounded-contract limitation; surface an explicit unavailable state, not a blank success panel.
- Existing Spec/Replan receipt functions authenticate but do not validate path IDs or assert Task existence as strongly as Conversation/Owner reads (`task-specification.ts:84`, `task-replan.ts:86`). They query shared scope/request rows and may return another command family's stored response for a deliberately reused ID. Browser must validate family-specific result and maintain globally unique IDs. Read hardening can be scoped if acceptance exposes this, without altering accepted mutation semantics.
- No direct Owner “request Replan” button contract exists: canonical Node terminal request or Conversation routing creates the request. UI should expose existing proposal/issue/dismissal exits, not invent a new semantic command.
- Review acceptance/delivery, review-feedback routing and multi-Node graphs remain later scope. Do not expand this leaf into these absent subsystems.

## External references

No external service or documentation lookup was required. Repository JSON Schema v1 and its generated TS/Go/OpenAPI outputs are the authority. Past archived artifacts were used for intent/provenance; current implementation and schemas govern exact fields.
