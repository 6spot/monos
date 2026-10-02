# One-Node replacement Plan and independent Replan exits

## Goal

Let a Task obtain an exactly confirmed sufficient replacement Plan, optionally
with new complete requirements, while preserving old work and physical ownership.
An explicit dismissal or issue answer must remain usable without an Agent running.

## Background and authorization

Specification changes passed independent acceptance at `f4114bf`, archived
`1751565`, journal `aa4c91f` Session22. Existing host uses accepted migration20,
318-file v2 source and existing services; its REVIEW Task and all evidence remain
untouched. Follow [Specification changes](../09-30-a-specification-changes/prd.md).
The Owner authorized sequential task execution, routine decisions, tests and the
existing test host without repeated approval. This existing backlog task now owns
its full design and implementation; no new task-creation decision is needed.

Contracts: docs/02:321–358 (immutable graph and dismissal), docs/05:318–324
(terminal Node handoff), docs/03:532 (Replan phase outcome), docs/04 physical
workspace ownership and docs/06 independent guards/atomic publication.

## Requirements

1. **Actual insufficiency and bounded scope.** A current Node may terminally call
   `request_replan(reason)`. Task Conversation may atomically commit a reply with
   Replan routing and exact action basis. Persist actual semantic reason and caller
   provenance; no Runtime failure, silence or ordinary message implies insufficiency.
   Support one complete Node with the existing structural restrictions; reject
   unsupported graph shape explicitly. No fabricated review-feedback origin.
2. **Scheduling freeze distinct from live authority.** Open requests cancel queued
   Node work and prevent new dispatch. The requesting Node itself is fenced and
   stopped with one terminal receipt. A conversation-origin request lets already
   running Node work finish/block normally on its original exact authority, unless
   explicit Owner Stop applies. Retain all physical claims until actual settlement.
3. **Dedicated quiescent Planner.** Only after old writers, leases/effects and the
   shared Planner claim settle may a canonical read-only Replan source run. Its
   `prepare_replan` or scoped planning issue is terminal, unlike Conversation's
   nonterminal Specification preparation. Preparing a graph never keeps an Agent
   alive awaiting confirmation. Failure leaves explicit Retry/dismiss controls.
4. **Complete exact proposal and Owner publication.** Bind Task/request/source,
   complete graph, readable summary, Spec/Plan/control, event/input cutoffs, current
   activation/source/evidence, guidance and private-work disposition. Confirm exact
   content; Owner publication needs no Agent. Later semantic changes require fresh
   assessment/confirmation; bookkeeping cannot stale itself. Replies or exact
   Owner input deferral may resolve input gating but cannot excuse changed impact.
5. **Atomic Plan or joint publication.** Use one typed shared publication owner.
   Standalone replacement changes only Plan; joint changes both Plan and Spec in
   one transaction with separate exact graph and requirements authorization. Joint
   requirements cannot publish via the standalone Specification pump. The supported
   sequence is request → quiescence → one Replan phase prepares graph plus optional
   requirements → exact confirmations → atomic Owner publication. An already-admitted
   sufficient change must reconcile/withdraw before a new joint proposal; reject
   unsupported pre-admitted insufficient ordering rather than changing its impact.
6. **Identity, current evidence and private work.** A changed formal definition
   receives a new Node ID. Retained identity requires every definition field equal
   and explicit activation/evidence applicability across Plan/Spec. Historical
   results never become completion of a new Node. Retained unfinished work gets a
   fresh source. Cross-Node unfinished private work requires an immutable explicit
   disposition checked by both backend and root Host against old lease, trusted
   checkpoint and fixed lineage. Completed inheritance uses the finalized result
   rather than pretending pre-finalization HEAD/index are unchanged.
7. **Independent controls and exits.** Preserve Owner Stop, unrelated blockers and
   active guidance across retained/replacement work. Dismiss revokes only its graph
   proposal/request, fences request Planner and waits for physical release before
   successors; carry Owner direction into fresh context. It publishes no revision
   and does not withdraw linked requirements. Specification withdrawal likewise
   leaves the graph request until separately dismissed. Issue answer/Retry creates
   a fresh source. Terminal/accepted Tasks reject new mutations; Cancel preserves
   cleanup ownership. No silent evidence resurrection or same-source late outcomes.
8. **Readable recovery and durable fairness.** Bounded scoped reads expose requests,
   proposals, issues, remaining guards, effects, history and exact receipts. Waiting
   for one Task cannot starve another; polling does not advance semantic versions.
   Preserve old migrations, manifests, revisions, source bytes and command receipts.

## Acceptance criteria

- [x] Actual Node terminal request and Conversation reply routing have exact
  provenance, one outcome, proper queued freeze and no implicit Stop of live work.
- [x] Dedicated Planner starts only after physical quiescence; prepare/issue and
  Owner Retry/dismiss survive unavailable Runtime, late outcomes and restart.
- [x] Changed definitions get new IDs; retained definitions/evidence use explicit
  applicability; old Plans/results remain immutable and noncurrent as appropriate.
- [x] Exact graph and joint confirmations publish one complete pointer/graph outcome;
  independent processes, input/Stop/dismiss races and before/after-COMMIT crashes
  cannot lose guards, consume mismatched authority or expose partial publication.
- [x] Backend and Host both reject forged/stale/live cross-Node private inheritance;
  authorized unfinished and completed paths preserve actual Task Git lineage.
- [x] Dismiss/withdraw/issue-answer preserve independent Stop, guidance and linked
  requirements, and make remaining Owner actions visible without fake feedback APIs.
- [x] Additive migration, strict generated TS/Go schemas, full relevant tests,
  frozen Linux builds and independent full-scope review pass.
- [x] Existing-host native request/quiescent proposal/exact publication/new-Node
  private-work completion and recovery evidence pass independently; label PG-only
  race coverage honestly and preserve failed observations.

## Scope limits

No multi-Node scheduling, review-feedback product/API, delivery, execution UI,
cross-Runner migration, new permanent service, generic workflow engine, team model,
automatic silence-based failure, or mandatory provider-session resume. Future real
feedback dismissal must preserve feedback and create its own routing successor;
current unsupported origins fail closed rather than pretending that subsystem exists.
