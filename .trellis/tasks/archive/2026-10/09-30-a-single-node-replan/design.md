# One-Node Replan design

## Change boundary

Existing immutable Plans are initial-only. Specification publication can preserve
one graph but cannot replace definitions, maintain Plan applicability or authorize
unfinished workspace inheritance across Node IDs. Add a Task-owned Replan module,
canonical Planner phase and explicit workspace disposition. Preserve existing
Task/Node/Attempt ownership, physical effects and immutable records. No broad
orchestration framework or new Runtime/Host operation is required.

## Request and generation

Node `request_replan` is a terminal source-scoped handoff: under existing lock order
persist request/reason/origin, its blocker and scheduling freeze, cancel queued
Node starts, fence requester and admit trusted Stop with receipt/outbox atomically.
Completion/block/request compete for the one terminal outcome. New commands from
the old source reject; immutable replay remains valid.

A partial unique constraint permits only one unresolved request per Task. A competing
Node/Conversation request loses without terminalizing its caller or processing its
input; replay of the original successful receipt remains valid.

Conversation uses `commit_task_turn` routing `replan` with reason and exact current
action basis. Its canonical reply resolves that input into the independent request
in the same transaction. Do not give Conversation a separate terminal request tool
followed by an impossible second reply. Node-only `request_replan` and dedicated
Replan `prepare_replan` have distinct source allowlists.

An open request freezes new Node dispatch, not all live-source commands. Persist
the exact live Node source/Attempt eligibility across the request's own control
transition; validate unchanged Plan/Spec/activation and no independent revocation.
Do not fetch a current version and bless stale commands. Preserve REPLAN_REQUIRED
while truthful live completion/block/Artifact/workspace effects settle. Owner Stop
remains an explicit separate decision; unavailable/silent Runtime is not permission.

After all relevant processes/effects/leases and shared `planner:<task>` claim settle,
prepare immutable `task_replan_source`: request/version, Task, Spec/Plan/control,
event and input cutoffs, current complete graph, exact evidence, independent holds,
guidance, Project Role descriptors and explicit historical/private-work facts.
Dispatch is scratch-only Planner with empty workspace reservations; source types
are mutually exclusive. Queue/promotion and missing-outcome handling recognize only
this canonical source and its request owner, including REPLAN_REQUIRED eligibility.

Replan Planner commits exactly one `prepare_replan` or scoped planning issue. Both
close its phase and persist repository-free Stop; no conversational second outcome
or wait for Owner. Its request remains durable after process exit. Owner issue
answer/Retry records exact decision and creates a fresh source after old release.
`raise_planning_issue` uses a strict source-discriminated Replan payload, never a
fabricated initial `planning_intent_id`. `retry_replan` also refreshes successfully
prepared but stale proposals, revoking prior graph eligibility. Joint refresh keeps
the same requirement obligation and an immutable predecessor link.

## Proposal and explicit joint ordering

`prepare_replan` supplies reserved proposal/new Plan IDs, complete one-Node graph,
summary, exact basis, old-to-new work/evidence/guidance/private-work disposition,
and optionally a full new Specification proposal. Validate the graph with existing
formal definitions, Project Roles and supported one-Node restrictions. A reused ID
requires exact equality of all old definition fields, including omitted-vs-empty
optional fields. New definition requires unused new ID and activation1.

Joint is **request-first and quiescent**. The dedicated phase atomically prepares
graph plus optional requirements. Extend requirement provenance through a strict
Owner/Conversation/Replan source union; do not fabricate input messages or Owner
receipts. Node-origin proposals may have no input; input-origin source IDs retain
the request's actual canonical source/cutoff. Draft requirement obligation becomes
visible through the Replan terminal attachment.

Keep current graph_sufficient=true behavior unchanged. Add a strict insufficient
branch for joint preparation, including exact request/proposal linkage and reason.
Spec envelope hashes full content/impact and reserved graph identities; graph
envelope includes that Spec proposal/digest, avoiding recursive hashes. Owner sees
and confirms complete graph and complete requirements independently. Ordinary
Specification apply/pump rejects this branch with an actionable linked-graph
reference. Only joint publication can consume both approvals and publish it.

Do not support changing an already-admitted sufficient operation into insufficient
work. Its immutable impact stays unchanged: reconcile/withdraw, then prepare fresh
joint authority. Do not support pre-admitting insufficient requirements before
confirmed quiescent graph in this slice. Reject explicitly; no inferred Stop or
hidden slot transfer. This avoids circular Planner/slot eligibility and preserves
every existing sufficient-change receipt semantics.

## Publication owner, basis and persistence

Additive migration21 owns request/origin, generation source, issues/resolutions,
immutable graph proposals/attachments, graph authorization command links,
publication, Plan applicability and workspace dispositions. Request state owns its
scheduling freeze while awaiting generation/Owner; it does not monopolize the
Specification publication slot. Both request and source pumps rotate poll timestamp
without changing operation version.

Expand the existing slot's requirement-only FK to an exact typed owner with
same-Task constraints, preserving historical default and `(task_id)` uniqueness.
Standalone Replan acquires/releases its slot in final quiescent publication. Joint
uses one requirement-owned change with a durable exact Replan link, created and
published atomically under both confirmations. No competing publication can pass
an open unrelated request. Source generation cannot bypass another operation's slot.

Owner confirm and publish work without any Agent. Receipt lookup precedes stale
version guards; changed content under the same identity conflicts. Bind complete
envelope, request/source, Task, base Plan/Spec/control, input cutoff, evidence,
guidance, holds and transfer details. Confirmation/preparation bookkeeping does not
increment Task control. A later control/semantic change requires refreshed proposal
and confirmation. Exact deferral handles only named input/version, not changed work.

Use actual Owner command/response links for both confirmation creation and approval
consumption. SQL independently checks exact task/request/command/payload/result,
not just FKs or nonempty consumed_by. Positive compound JSON checks use IS NOT TRUE
to reject missing fields. Trigger aliases must avoid OLD/NEW. Publications are
append-only and forbid partial joint pointers or premature owner release.

Publish in one transaction: revalidate quiescence, basis, Roles and input/guards;
consume exact confirmation(s); append complete Plan and optional Spec; insert new
Nodes/activations or explicit applicability; persist workspace/history disposition;
switch both effective pointers as applicable; resolve only own request/change;
record formal events and trusted fresh scheduling origins; release own slot.
Do not forge initial-planning provenance to make Node pump dispatch replacements.
Publication quiescence includes actual process/claim release of the preparing
Planner, not merely the preceding Node settlement or terminal prepare receipt.

## Applicability and independent controls

Currentness follows exact authorized Plan/Spec tuple transitions from an immutable
activation creation basis to current pointers. Compose existing Spec applicability
with new Plan applicability; joint records an atomic old-Plan/Spec→new-Plan/Spec edge.
Carry binds exact original successful completion/manifest and prior valid path.
Refresh retains unfinished activation with fresh source. Invalidation creates fresh
activation; never skip an invalidation gap or relabel old manifest/source/activation.
Changed Node has no inherited completion, even when it receives old Git as input.

Only request-owned blockers clear at publication/dismissal. Preserve independent
Owner Stop and blockers for retained work; replacement inherits equivalent holds
with explicit provenance to original decisions, not fabricated Owner commands.
Plan impact binds active guidance and chosen retention/supersession. Retained scoped
instructions need explicit applicability to replacement Node and fresh assignments;
old handled obligations remain immutable. Do not silently drop Node-scoped guidance
because the old Node leaves current membership. Expose remaining holds in reads.

## Workspace transfer

Keep existing open_workspace and Task/resource/storage/generation. For unfinished
cross-Node inheritance, the confirmed proposal binds exact old Node/activation/
Attempt/lease, settled Stop/checkpoint (commit/tree/HEAD) and fixed lineage, plus
new Plan/Node/activation and disposition as historical input. Publication records
immutable system-owned transfer authority. Backend only admits it for the exact
current target against the latest released predecessor lease.

Include that authority in the new immutable lease descriptor. Root Host independently
matches its released old workspace record, checkpoint and lineage, target dispatch
and operation identity before permitting cross-Node reuse. Preserve private bytes,
HEAD, index and root checkpoint; never clear a checkpoint to bypass old guards.
Missing/forged/changed/stale or physically live predecessors reject at both layers.
After accepted transfer, failed opens recover under the new original lease identity.
If the new lease subsequently Stops/checkpoints, same-target retry uses that new
lease normally; transfer to a third Node needs fresh publication/disposition.
Owner confirmation binds known predecessor facts and proposed Plan/Node; future
Attempt/lease/open identities are bound later in the system-owned descriptor.

Completed predecessor inheritance binds finalized commit/tree as historical input.
Its old pre-finalization HEAD/index need not match; keep a separate observer instead
of weakening the held-private-work driver. New work still produces its own manifest
and completion. Bounded context labels old Artifacts/results with their real origin.

## Dismissal, withdrawal and terminalization

Owner dismiss records direction, resolves only request/proposal eligibility,
cancels queued and fences live Replan Planner with exact Stop. It cannot release
claim/capacity until physical settlement. A requester with only that blocker may
resume under current old graph after reconciliation; unrelated holds remain.
Dismiss with linked requirements does not publish/withdraw them. Withdrawal of
unpublished joint requirements revokes the linked graph proposal but leaves the
request; another graph needs fresh effective-Spec preparation/confirmation. Owner
can issue both explicit decisions. Never infer combined dismissal from an edge.
Withdrawal invalidates dependent generations as well as proposals; fresh graph-only
planning uses a fresh source, never a rewritten stale context. Open-request exclusions
must permit their own Retry/dismiss, input classification and linked withdrawal.
Reads expose actionable exact exits for each remaining independent requirement.

Cancel is terminal for authority while cleanup continues. Accepted delivery and
terminal Tasks reject new requests/proposals/publication. Review feedback remains
unsupported: no public fake origin/withdraw/rework APIs. Preserve a documented
future hook for real feedback dismissal→fresh routing while feedback stays effective,
including same-feedback/basis anti-repeat and old Planner settlement.

## Validation and ownership

Research reports supply detailed races and native matrix. Backend owns server,
domain, DB, schema/generation and root test registration. Runner owns Go source,
Host disposition checks, wire/CLI/prompt/recovery and Go tests. Root owns docs,
native helpers, frozen deployment and evidence. Reviewer owns independent cases.
Coordinate exact descriptor/protocol shape early; generated schema is sole authority.
Recompile all Go consumers after final schema generation to catch enum-name drift.
Use real independent PG processes/lock observation/COMMIT crash hooks plus direct
SQL negatives, then identical frozen Linux and actual CLI/private Git acceptance.
