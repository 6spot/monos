# Exact Specification changes and settlement

## Goal

Let the Owner change the complete requirements of an unfinished Task through an
exact, reviewable authorization, while preserving existing private work and history.
Publish the new effective Specification only after affected old execution settles.

## Background and authorized scope

Ordered Task Conversation and guidance is accepted in commit `609e392`, archived
with native/private-Git/terminal/restart evidence. The current backend provides
immutable revision/Plan/activation records, exact Owner confirmation primitives,
Task-scoped ordered input, independent conversation authority, trusted Stop and
hard-completion recovery. `publishPlanningSpecification` is currently a pre-start
primitive; it must not become a shortcut around started-work settlement.

This is the next ordered leaf under the Owner's continuing authorization to
implement, test, decide routine issues and proceed without additional permission.
Reuse the existing backend, PostgreSQL and Runner; no new permanent service or push.
Owning contracts: docs/02-planner-and-planning.md:412–423,
docs/05-tool-protocol.md:338–349 and docs/06-state-and-formal-data.md:504–527.

## Requirements

1. **Exact visible proposal.** A canonical Task Conversation Planner may prepare a
   full immutable Specification, compact change summary and explicit impact against
   the current Task/Specification/Plan/control, source inputs and activation/result
   identities. Preparing is not a turn outcome: only its committed reply attaches
   the proposal for Owner review. Unattached drafts cannot be confirmed. Ordinary
   replies and guidance remain independent and do not implicitly revise requirements.
2. **Owner authorization.** Confirmation binds Task, source proposal, complete
   content digest, base revision and displayed impact digest. An explicit complete
   Owner edit can directly authorize exactly that content and impact. Changed
   content, graph, materially enlarged impact or different evidence carry-forward
   needs fresh authorization. Replays retain the original immutable receipt.
3. **One recoverable publication.** Admission serializes with other changes,
   completion and Plan publication, freezes affected dispatch, revokes incompatible
   queued/running authority and records trusted Stop/settlement responsibility before
   physical effects. Pending proposal/operation does not hold the Planner claim.
   Existing hard-completion recovery retains exact original identity and leases.
   Infrastructure attention does not invent REPLAN_REQUIRED.
4. **Atomic sufficient-graph publication.** Preserve Task and Plan identity and
   immutable Plan/Node definitions. After physical settlement and revalidation, append
   a parent/source/authorization-linked Specification, switch its effective pointer,
   record exact evidence carry-forward/invalidation and Plan applicability, update
   affected activations and emit events/intents atomically. Old results remain
   historical; they cannot acquire new evidence authority through relabeling.
5. **No implicit execution intent.** Before Start, publication remains PLANNING.
   Started initial planning is revoked/settled and receives a fresh source when
   still authorized. Affected unfinished work retains private workspace and continues
   through fresh authority; completed affected work is reactivated. Explicit Owner
   Stop, guidance obligations and unrelated blockers remain effective. Unaffected
   evidence can preserve REVIEW only with explicit applicability.
6. **Ordered input and recovery exits.** Later messages remain durable and do not
   mutate a frozen proposal. New input prevents stale publication until interpreted
   or explicitly deferred by the Owner; changed impact cannot be approved by merely
   substituting a newer version. Replacement links a new proposal and revokes old
   confirmation eligibility without orphaning its source obligation. Withdrawal of
   an unpublished proposal reconciles admitted effects and retains the old effective
   revision; it does not revive old Attempts or a revoked acceptance. Retry/status
   reads and withdrawal work without available Runtime capacity.
7. **Scope and admission guards.** Terminal Tasks and active accepted batches reject
   requirement mutations. No fake acceptance setter or provider integration is added.
   This leaf publishes only when the existing single-Node graph is explicitly
   sufficient; a changed formal Node definition requires the following Replan leaf.
   Unsupported graph changes remain actionable pending input, never silent edits.

## Acceptance criteria

- [x] Two clients confirm/apply at most one revision; changed content, impact, basis
  or newer input cannot reuse stale authorization or enlarge approved work.
- [x] Separate-process lock contention and crash-before/after-publication demonstrate
  atomic receipts, pointers, evidence applicability and durable recovery intent.
- [x] Pre-Start edit causes no Plan/Attempt/Start; started planning cannot publish
  against the old Specification after authorized replacement.
- [x] Completion, Owner Stop, guidance, withdrawal and restart during settlement
  preserve old effective requirements until publication and prevent old completion
  from becoming current evidence on a superseded activation.
- [x] Sufficient-graph change retains Plan/Node definitions and private Git work;
  exact carry-forward/invalidation preserves provenance and independent Stop guards.
- [x] Replacement/withdrawal/retry preserve immutable history and leave no orphaned
  input guard; terminal/accepted-batch changes are rejected deterministically.
- [x] Strict generated TS/Go schemas, bounded scoped Owner/Agent reads, full relevant
  PG/unit/Runner gates and independent review pass.
- [x] Existing-host native CLI and Owner API prove exact proposal/authorization,
  real private-work settlement, new-revision execution and restart without duplicate
  publication or new permanent services.

## Scope limits

One current Plan Node, one Runner and at most one opened repository. No replacement
Plan/Replan implementation, multi-Node scheduling, execution UI, review-feedback
product flow, live steering, mandatory provider-session resume, provider delivery,
team model or generic workflow framework. Reversing a published requirement means
another exact authorized revision; unpublished withdrawal is not reversal.

## Dependency

Follows [Task Conversation](../archive/2026-09/09-30-a-task-conversation/prd.md).
This dependency is an evidence gate; parent links express ownership only.
Technical research, final design and curated contexts are prepared in this leaf
before implementation starts.
