# Backend contract research: one-Node Replan

Research only, 2026-10-01. Owner: `/root/specification_backend`; only this file
changed. Based on architecture modules02/05/06/08, accepted Specification migration20,
Task planning/records specs and current source. Recommendations below are design
inputs, not implemented behavior or passing acceptance claims.

## Minimum complete boundary

Use Task-owned Replan requests, immutable complete proposals, exact Owner receipts
and the existing Task Planner claim/Runner effects. Do not make an editable draft
Plan, another Task state, or another Planner controller. `REPLAN_REQUIRED` already
exists in migration5; actual accepted graph insufficiency is its only trigger.
One Node, no dependencies and no consumes remain the public supported graph;
reject larger graphs explicitly after normal structural validation. Changed Role,
goal, hard requirements or expected outputs is a real one-Node replacement.
Runtime switching, insufficient runtime capacity and infrastructure failures are
not Replan. Review-feedback routing itself remains outside this leaf until its
own backend exists; preserve an explicit origin seam, never invent feedback rows
or expose a fake withdrawal API to claim that branch is implemented.

The essential distinction is between a scheduling freeze and mutation revocation:

- Every unresolved request freezes **new Node starts**, retires/cancels queued
  sources/Attempts, and blocks initial-plan/replacement publication competition.
- A Node calling `request_replan` terminally hands off **itself**: receipt, request,
  Replan blocker, fenced mutation, trusted Stop and preserved private work commit
  together. Its semantic outcome wins over later exit.
- A Task Planner calling it for its source input/requirement operation terminally
  resolves that routing phase, stops its own repository-free process and creates
  the request. It does not stop a live Node merely because a graph is insufficient.
- Other live work can use its current source to finish/block normally. Explicit
  Owner Stop or an independently authorized requirement change may stop it. No
  timeout or silence establishes process absence or permission to stop it.
- Initial Replan generation waits for all relevant old Node writers, claimed
  Planner execution, workspace effects and leases to settle. A BLOCKED Node with
  released process is quiescent; a terminal Attempt with an unreleased lease is not.

## Command/source proposal

Add a strict `task_replan_source` dispatch binding (request/source/attempt IDs,
current Spec/Plan, control basis and context digest). Reuse owner key `planner:<task_id>`
for the Task Planner and RuntimeScheduling/DispatchQueue; never create a parallel
claim. Freeze request reason, current complete Plan, formal Node/activation/result
facts, bounded guidance/input context, Project Role descriptors and read-only
inspection facts. Use the same encoded-size and failed-preparation conventions as
initial planning. No full Role instruction snapshots or writable Planner repository.

Suggested public commands, with final names chosen during design:

| Principal / command | Semantic effect |
| --- | --- |
| Node `request_replan {reason}` | Exact current Node/source terminal handoff and request |
| Canonical Task Planner `request_replan {reason, source binding}` | Terminal routing resolution for authenticated current input/change, no Node Stop |
| Replan Planner `prepare_replan {request_id, proposal_id, plan_id, basis, nodes, summary, applicability, linked_requirement?}` | Persist complete immutable proposal and terminally finish this Replan generation phase |
| Replan Planner `raise_planning_issue {request_id, source_id, reason}` | Owner-attention issue, ends only this generation phase; request stays unresolved |
| Owner `confirm_replan {proposal_id, content_digest}` | Exact graph/summary/basis receipt, no Runtime required |
| Owner `publish_replan {proposal_id, confirmation_id, basis}` | Consume exact receipt and atomically publish if all guards still hold |
| Owner `dismiss_replan {request_id, expected_version, direction?}` | Resolve only request; revoke draft/confirmation eligibility, reconcile Planner |
| Owner `retry_replan {request_id, expected_version, issue_id?, answer?}` | Fresh source after failure or exact issue answer; retain old source/history |

Owner confirm-and-publish may compose the last two graph actions in one transaction;
separating them enables explicit receipt recovery and Agent publication if required.
The documented `publish_execution_plan` may instead use a strict discriminated
initial/Replan payload; do not let the current initial-planning guard accept any
Planner kind. The architecture allows publication without restarting the proposal
producer. A Replan `prepare_replan` is the terminal outcome for that dedicated
phase, unlike nonterminal Conversation `prepare_specification_revision`; expose
this difference explicitly in protocol/CLI rather than requiring a second reply
for the same phase. Routing `request_replan` must similarly resolve input provenance
atomically, not leave the original pending input with no authorized finisher.

Owner reads need request state/version, physical waits, source/issue/direction,
full proposal and exact digest, current/revoked/expired eligibility, confirmation,
linked requirement and independent remaining guards, effects, immutable publication
and bounded history/cursors. Reuse Owner auth/session/CSRF/receipt conventions;
request replay precedes current-version checking.

## Data and migration21

Never edit migration20. Additive migration21 can replace its functions/constraints
where the contract explicitly expands, while preserving all already-recorded rows.

Suggested domain records (some immutable payloads can share a table):

- `replan_requests`: Task, origin kind and exact Node activation/source or input/
  requirement identity, reason, base Plan, operation version, current source/
  proposal, semantic resolution and `last_checked_at`. Separate independently
  raised insufficiency from a request solely for one unpublished requirement.
- Immutable request-origin/routing records, generation outbox sources and attempt/
  Stop-effect links. Source attempts must reference the same Task/request/planned
  Attempt. Open issue and Owner resolutions remain attributable history.
- `replan_proposals`: exact complete graph, graph and full envelope digests,
  readable summary, Task control basis, event sequence for provenance, input cutoff,
  current activation/source/completion identities, guidance dispositions, optional
  exact linked requirement proposal/operation/digest. Mutable eligibility belongs
  to request/current-proposal or generic revocation, never proposal content.
- Exact authorization/admission command links to actual Owner receipts, following
  migration20's independent SQL checks of name, scope, payload, response and digest.
- `replan_publications`: one request/proposal publication, parent/new Plan, old/new
  Spec, confirmation and optional requirement publication link, publication event.
- `plan_node_applicability`: immutable prior/next Plan and Spec, Node/activation,
  retained-definition digest, disposition and exact completion/manifest where carried.
  Explicit historical-input links for a replaced Node reference old results/private
  workspace lineage; they grant no completion authority to its new identity.

Use same-Task composite FKs, unique current source/proposal/publication and deferred
constraints proving exact owner/receipt/slot/publication pairs. Reject cross-Task or
cross-request substitution even if a referenced ID exists. Retained Node definitions
must be equal to the prior immutable definition, not merely share an ID. Preserve
optional versus omitted fields as initial Plan currently does; do not silently
normalize away a meaningful change. Do not create global singleton constraints
for the deployment's one-Node/one-Runner limits.

## Shared publication ownership without starvation

Current `task_publication_slots.operation_id` has an actual FK to
`requirement_changes(task_id,id)`; it is not yet a generic slot. Minimal expansion:
add a discriminator `owner_kind = requirement | replan`, defaulting historical rows
to requirement; replace that FK with deferred exact typed-owner validation.
Keep `(task_id)` unique and slot identity immutable, and independently validate
live-owner retention and terminal publication/slot disposition. A Replan-only
publication uses its request/operation identity; **joint publication continues
under the already admitted requirement change's slot**, plus an exact durable
Replan-to-change link. Do not transfer a live slot or create two competing owners.
An alternative is typed nullable FK columns, but it must preserve identical exact
ownership guarantees; an unchecked polymorphic ID is insufficient.

Do not acquire a long-lived publication slot merely to record a Replan request.
The request itself owns its new-dispatch freeze. Replan-only final publication can
acquire and release its slot inside one transaction once quiescent and confirmed.
This avoids holding a Spec publication slot while waiting for a Planner whose
queue gate rejects that same slot. During a linked admitted requirement change,
its exact Replan source is allowed to generate after change-owned physical effects
settle; unrelated mutation/dispatch remains blocked. Generation may proceed only
with no incompatible publication owner or its explicitly linked requirement owner.

A new unrelated requirement apply while a request is unresolved must not publish
Specification-only behind that request. Reject with the active request identity
or bind it through explicit joint preparation/authorization. Likewise an unrelated
Replan cannot silently annex a different requirement's slot. Refresh/cancel/link
requires a formal decision and exact provenance, not pump inference.

Both pumps rotate `last_checked_at` independently of semantic versions. Waiting
for input, Owner graph approval, unavailable Runtime, or a lost Runner on Task A
cannot starve ready Task B. Keep source dispatch and settlement advancement separate;
no repeated poll may refresh the displayed proposal or its confirmation basis.

## Extending graph_sufficient without premature Spec publication

Today all three layers reject `false`: protocol `SpecificationImpact` uses const
true, `checkImpact` validates it, and migration20's proposal trigger requires true.
The `advanceSpecification` pump always performs Spec-only publication after checks.
Changing only the schema boolean would therefore silently publish inadequate work.

Recommended strict union: preserve the existing sufficient branch byte-for-byte;
add an insufficient branch requiring explicit graph-insufficiency reason and an
exact Replan link by the time it is admitted. The link is part of the full immutable
proposal/impact digest, not an independently replaceable status field. Every
insufficient admitted change enters a durable wait-for-confirmed-Replan path;
`advanceSpecification` may settle/withdraw it but **cannot publish it alone**.
Joint publication validates both full approvals and publishes both pointers in one
transaction. Existing authorization for `true` cannot authorize a materially
changed `false` assessment: prepare a replacement and obtain fresh authorization.

Define one complete public sequence during design rather than relying on an
implicit circular link. A straightforward supported sequence is:

1. Canonical Planner explicitly requests Replan for the source requirement input,
   transferring routing responsibility while leaving that requirement unresolved.
2. After quiescence, the dedicated Replan source prepares the complete graph and
   linked full requirement proposal together (IDs are reserved in one transaction).
   Owner sees full requirements, graph summary and explicit old-work disposition.
3. Owner gives exact Specification and graph authorization. Their envelopes bind
   one another's immutable identities/digests without recursive digest construction:
   hash Spec content/impact first, then graph envelope includes that digest; Spec
   envelope binds the reserved Replan request/proposal IDs, not its final hash.
4. Admission/publication uses one requirement-owned slot and two exact receipts;
   both revisions and applicability become effective atomically.

This requires extending requirement proposal provenance beyond its current
Conversation-only source FK: use a constrained source union and a canonical
Replan terminal attachment, not fabricated Conversation messages or Owner receipts.
The existing `prepareSpecification` helper accepts only Conversation source/input;
make the shared immutable preparation primitive source-explicit before reuse.

Also support attachment to an already authorized, exact insufficient requirement
operation that owns settlement: the operation may mandate Stop before generation,
then its linked Replan source proceeds through the same final joint gate. Design
must define how that request/link is created before its insufficient proposal is
admitted; never bypass exact-basis validation by copying current control_version.
If not supporting this ordering in the first implementation, reject it explicitly
and document the supported request-first sequence; do not claim its Stop path exists.

## Publication, retained Nodes and evidence

At final publication lock Owner session/request, configuration, discovered Runners,
Task, source/Attempt/operations in existing order; revalidate discovery. Require no
live writers, nonterminal workspace effects, unreleased leases or obsolete Planner
claim. Preparing a proposal and recording its confirmation do not increment Task
control version. Other relevant control changes stale the proposal; event/log or
heartbeat changes alone do not. A later effectful/unclassified input requires new
assessment or exact proposal/input-version Owner deferral, never a fresh version
substitution. Freeze input cutoff and evaluate all source obligations, not only
message processing status. An Owner Stop after preparation stales graph approval;
it must remain effective when the refreshed proposal is finally published.

Reuse `validatePlan`, Project Role checks and immutable transaction-complete
`plan_nodes` insertion. Add parent/source/authorization attribution for new Plan
revisions. Retained Node definitions must match every formal field exactly. Changed
Node gets a new globally unique ID and activation1; old Node/activations/results stay
historical. It can receive old integrated/private work only through explicit
historical-input/workspace disposition; never copy old completion as its result.

For a retained Node, `assertCurrentNode` currently requires `a.plan_id=t.plan_id`.
Add a verified cross-Plan applicability chain, composed with existing cross-Spec
applicability, rather than rewriting the old activation's Plan. Carry requires
exact manifest/completion identity, valid prior applicability and guidance handling;
an unchanged definition by itself does not establish it. Unfinished retained work
can preserve activation but receives fresh execution source on the new Plan.
Completed invalidation receives a new activation with fresh obligations. Repeated
Plan/Spec changes must not jump an invalidation gap or revive an old Attempt source.

Atomically insert complete Plan (+Spec for joint), applicability/new Nodes and
activations, switch pointers, consume confirmation(s), resolve only covered guards,
record event/publication and durable fresh scheduling intents. Preserve Owner Stop
and independent blockers/guidance. Current acceptance evidence uses effective
membership; historical Plan reads use publication/activation/event basis rather
than today's mutable Node row.

## Explicit exits

| Decision | Resolves | Must remain |
| --- | --- | --- |
| Dismiss Replan | Only graph-insufficiency request and its proposals | Pending requirement input/feedback, independent Stop/blockers |
| Answer issue + Retry | Exact generation issue; creates fresh source | Same unresolved request, pending requirements, old cleanup until proven |
| Withdraw linked unpublished Spec | That requirement proposal/change after effects reconcile | Independently raised Replan; solely-linked request unless explicitly also dismissed |
| Explicit combined withdraw+dismiss | Exact named requirement and eligible solely-linked request | Unrelated requests/feedback/Stop/guidance |
| Cancel Task | Execution authority immediately | Physical cleanup/effect ownership until settlement |

Dismissal revokes queued/running Replan source authority and receipts immediately,
records repository-free Stop, and retains claim/capacity until actual release. A
requesting Node can resume under the old graph only after its handoff settles and
only if that resolved request was its sole blocker. Carry Owner direction into its
fresh source. The Node may not auto-complete from retained private work.

If a linked requirement already owns settlement, dismissal does not release that
slot, publish the Spec, or restart its old authority. Return explicit remaining
requirement operation/withdrawal or refreshed-assessment choices. Withdrawing a Spec
invalidates any joint graph proposal bound to it; continuing independent Replan
needs a fresh effective-Spec proposal and graph confirmation. Two separate Owner
commands must not each silently clear the other obligation. Future feedback-origin
requests require a durable successor routing operation on dismissal, with the same
feedback still guarding acceptance and no immediate unchanged-basis Replan loop.

## Concrete integration seams and risks

- `task-specification-state.ts`: `specificationFrozen`, `checkImpact`, preparation/
  attachment/source union, currentness and exact later-input gate. Split scheduling
  freeze from live-source permission; blanket reuse is incorrect.
- `task-specification-settlement.ts`: admission slot owner, shared effects, explicit
  insufficient/joint gate, withdrawal and independent remaining guards. Do not let
  its current Spec-only publication loop run for an insufficient proposal.
- `node-execution-state.ts:assertNodeSource`: currently rejects any slot, requires
  Task RUNNING and exact Task/source control version. Replan changes state/version
  while letting old live Nodes finish: persist exact grandfathered Attempt/source/
  activation/revision eligibility for this scheduling-only transition; validate
  its unchanged facts per command. Never globally ignore control versions or
  permit new starts. Role/source/Owner Stop/Spec fences remain authoritative.
- `service.ts` and `packages/domain/src/commands.ts`: global expected-control guard,
  phase allowlists, terminal handoff receipt-before-replay and source dispatch.
  Add narrow live-Node eligibility and dedicated Replan phase instead of any-Planner
  permission. Native CLI supplies launch basis, so fetching a newer Task version
  is not a sound fix for the live-Node issue.
- `node-completion.ts`: completion currently requires RUNNING/BLOCKED Task; permit
  truthful old-Plan completion during scheduling-only REPLAN_REQUIRED while keeping
  the freeze projection. Joint change-owned completions stay historical as today.
- `dispatch-queue.ts`: enqueue/promotion default to RUNNING and reject slots for
  every non-Conversation source. Add exact Replan-source exception after quiescence;
  cancel queued old Node starts atomically and keep final promotion guards.
- `node-execution.ts:pump`: fresh candidate SQL requires a `plan_published` event
  joined to initial planning outbox/Attempt. Owner-published replacement will never
  launch with this predicate. Recognize an actual Replan publication record as an
  alternative trusted origin, not a forged initial-planning intent/event.
- `task-records.ts:assertCurrentNode` and `reactivateSettledNodes`: cross-Plan
  applicability; new publication primitive must not call initial-only publication
  or blindly clear blockers through existing reactivation helper.
- `task-guidance.ts`, `owner-execution.ts`, `owner-reads.ts`, cancellation/Continue
  paths: separate freeze ownership, preserve obligations, support REPLAN_REQUIRED
  Owner exits, and keep historical/current result semantics distinct.
- `task-planning-state.ts`, `task-conversation-state.ts`, RuntimeScheduling: reuse
  frozen source/issue/Stop mechanics and one Planner claim; do not reuse the
  initial-planning source identity for a replacement Plan.
- `app.ts`, `main.ts`, protocol schema + generated TS/Go/OpenAPI, Runner CLI/wire/
  fixed prompt allowlists: expose typed source/commands/reads and recurring pump.
- Migration21: slot owner expansion, source union, same-Task exact authorization,
  evidence chains and semantic resolution versus unsettled physical cleanup.

## Required meaningful PostgreSQL/process races

1. Two clients confirm/publish one graph under different requests: one publication,
   replayable original receipts, no double confirmation consumption; changed bytes
   under same request conflicts. Direct SQL forged receipt/graph/basis rejected.
2. Request admission versus queued promotion in both lock orders: no post-freeze
   old start; if already live, no implicit Stop. Real independent processes should
   observe lock contention, not only concurrent promises on one backend.
3. Planner request versus live Node complete/block/open-workspace: unchanged live
   source remains usable; real completion persists, freeze stays; no source renewal.
4. Node `request_replan` versus `complete_node`/Artifact mutation: exactly one
   terminal handoff. Trusted Stop identity/workspace lineage survives retry/restart.
5. Replan generation waits for process release, completion/settlement pair and all
   leases; process_absent, logical cancellation or Node state alone cannot unlock it.
6. Dismissal versus prepare/issue/publication: one semantic resolution; late output
   rejected, old Planner claim/capacity held until Stop. Sole request blocker clears
   only after handoff; Owner Stop remains.
7. Owner Stop/new input/guidance versus confirmation/publication: stale graph fails;
   explicit exact deferral cannot excuse changed evidence/guidance/graph. Status-only
   events do not stale their own proposal.
8. Retained unchanged definition + exact carry, retained unfinished activation,
   changed goal/Role/new Node ID, removed historical Node rejection, completed
   invalidation and repeated Plan/Spec applicability chains including invalidation
   gaps. Reject cross-Task completion and fabricated manifest links by direct SQL.
9. Joint Spec+Plan observers see both old or both new pointers; two exact receipts,
   one slot/publication; insufficient Spec pump never publishes alone. Competing
   requirement/Replan and link-substitution races cannot annex another operation.
10. Withdraw Spec versus dismiss Replan/publication, independently raised versus
    solely-linked request, remaining guard status and exact replay. No exit silently
    authorizes old-basis work or invents receipt/initial-planning provenance.
11. Crash before/after request COMMIT, proposal outcome, admission and publication;
    after writer Stop before publication; fresh process recovery without duplicate
    effects/revisions or premature handoff. Include owner-claim/capacity assertions.
12. Waiting Task A cannot starve Task B across request generation, joint settlement
    and inputs; polling leaves semantic operation versions unchanged. Runtime
    unavailable retains actionable Retry/dismiss/withdraw controls.
13. Migration20 populated upgrade and prior full planning/Node/Conversation/Spec
    regression. Initial planning remains initial-only; generated schema bounds and
    native CLI phase replay preserve immutable envelopes.

Native acceptance must independently establish old process absence, read-only
Planner inspection, private Git continuity, source/receipt bytes and new-Plan
execution; synthetic PostgreSQL effect results are not that evidence.

## Convergence review of root PRD/design/implementation plan

Reviewed 2026-10-01 after root's design convergence. This section supersedes the
exploratory alternatives above. **No remaining architectural contradiction blocks
the chosen request-first design.** In particular, the following choices resolve
the earlier circularity and phase concerns:

- Node alone exposes terminal `request_replan`; Conversation uses its existing
  `commit_task_turn` with `routing.kind = replan`, not a second terminal command.
- Dedicated `prepare_replan` is terminal and may attach complete joint requirements
  in that same transaction. No fabricated Conversation source is required.
- Joint preparation occurs only after request/quiescence; ordinary Specification
  admission and its pump reject insufficient proposals. A joint internal publisher
  creates/publishes its requirement change under two exact approvals in one tx.
- Already admitted sufficient proposals cannot mutate into insufficient ones;
  reconcile/withdraw before fresh request/proposal. No slot handoff or speculative
  Stop-before-graph path needs implementing in this leaf.
- Plan/Spec tuple applicability, cross-new-Node holds/guidance and backend/Host
  transfer verification are explicit requirements, not implicit ID retention.

### Two small decisions to settle before product changes

1. **Concurrent distinct request origins.** The documents say open request(s), but
   do not specify two fresh requests for the same Task: e.g. a Node terminal request
   races Conversation Replan routing. Do not accidentally create two incompatible
   frozen requests whose proposals both depend on the old Plan, or resolve both by
   publishing only one owner's proposal. Minimal recommendation: one unresolved
   Replan request per Task (partial unique constraint under Task serialization),
   reject a *different* request/source with `unmet_precondition` and the existing
   request ID, before any terminal outcome/input resolution. Accepted same-command
   replay still returns its receipt. The losing Conversation may correct its reply
   routing or remain pending; it is never silently processed. The losing Node keeps
   mutation authority unless another accepted control revoked it. This is operation
   serialization, not a one-Node domain cardinality constraint. Do not silently
   merge independent reasons/obligations. If multiple origins are desired instead,
   their explicit complete origin set must be covered by confirmation/dismissal;
   that is a larger change than this leaf needs.

2. **Fresh proposal after a prepared proposal becomes stale.** Design requires
   refreshed assessment/confirmation, while Retry is described as failure or issue
   answer recovery. Add an explicit allowed `retry_replan` reason for an unresolved
   request whose current prepared proposal is stale/revoked (or Owner explicitly
   requests refresh). Revoke its eligibility and create a new source after prior
   cleanup, preserving immutable proposal/receipts; never update its basis. For
   joint refresh, the replacement requirement proposal must reuse the originating
   obligation with predecessor linkage, and atomically supersede the old graph's
   eligibility. Otherwise new input/Owner Stop after prepare can leave a successful
   terminal generation without any permitted refresh action, or accumulate orphan
   pending requirement obligations. Dismiss/withdraw remain independent choices.

These are small missing transition definitions, not reasons to redesign the chosen
sequence or seek new user authorization. Include their race cases in PG fixtures.

### Protocol and Runner agreement required before parallel implementation

Freeze one schema draft with the Runner owner before generating production code:

- Exact `TaskReplanSource` keys, exclusive Dispatch union, frozen source/control/
  request versions, returned phase outcome and missing-outcome classification.
- `request_replan` Node payload and Conversation `replan` routing payload; strict
  `PrepareReplan` optional full-Spec envelope, explicit old/new Node/evidence/hold/
  guidance/workspace disposition, plus scoped `raise_planning_issue` union.
- Typed Owner confirm/publish/Retry/dismiss/read results and stable request/proposal/
  operation IDs; a publication response must distinguish graph and requirement
  confirmation references. The two consumed authorizations may reference one
  actual Owner publication request, but SQL must validate both exact bindings.
- `WorkspaceDescriptor` optional transfer authority with explicit predecessor
  workspace/resource/storage/generation, Node/activation/Attempt/lease, settled
  operation/checkpoint and fixed ancestry, target publication/Plan/Node/activation.
  Owner confirms the immutable *semantic transfer target*. The future target
  Attempt/lease/open-operation IDs do not yet exist at preparation: the backend
  later binds those generated IDs in its immutable descriptor, and Host compares
  them with actual dispatch/journal. Do not pretend those future runtime IDs were
  part of the Owner's earlier graph digest. Completed versus checkpoint inheritance
  needs a strict discriminator, not nullable fields interpreted heuristically.
- Existing descriptor schema_version/replay compatibility: absence preserves old
  lease semantics; new authority is immutable and part of workspace digest. Agree
  exact field names/types before Runner changes so generated Go names stay stable.

No new Runner effect type is required. Existing canonical `inspect_repository`
currently has a Stage-A denial in service.ts; if the new Replan phase exposes it,
explicitly extend that source allowlist through the existing read-only Host path.
Scratch-only launch must not be mistaken for a writable workspace or an already
verified repository inspection. This is an implementation seam, not a requirement
to add a separate inspection subsystem.

### Migration details which must not be mistaken for reusable behavior

Joint internal publication cannot call ordinary `admitSpecification` unchanged.
Migration20 currently validates only edit/apply admission commands, insists that
`requirement_publications.plan_id` equals the proposal's **old** Plan, and attributes
all canonical requirement sources to Conversation. Migration21 must provide an
explicit joint branch in each exact-attribution function with old/new Plan meanings
unambiguous, rather than merely broadening the graph_sufficient boolean. Keep the
sufficient branch's existing semantics and historical rows unchanged.

For request-only live Node permission, the semantic transition record must identify
which control transition is exempted, not just record a broad `allowed_attempt_id`.
Independent Owner Stop, new effective Spec/Plan, activation/source replacement or
terminalization must still reject old mutations. This satisfies the root design's
narrow original-authority rule without modifying Runner request envelopes.

Research validation: read the complete converged PRD/design/implement files and
checked current source/SQL seams; no product files changed, no DB/Host action and
no tests claimed beyond documentation diff checks.
