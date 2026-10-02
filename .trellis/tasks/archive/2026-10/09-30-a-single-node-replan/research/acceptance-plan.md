# Independent acceptance plan — one-Node Replan

Status: research only. No implementation, test execution, host mutation or source
approval is implied. Ownership: this report only; other agents own design/source.

## Basis and smallest honest scope

Read task PRD; ARCHITECTURE; docs02 Replan/publication/dismissal and review routing;
docs05 request_replan, terminal handoff and exact authorization; docs06 control,
immutable membership, publication and independent guards; docs08 invariants.
The preceding Specification leaf is accepted. This leaf adds a complete one-Node
replacement graph, not a general workflow engine or review-feedback subsystem.

A one-Node Replan is meaningful when the formal work or selected Role must change:
replace the old Node definition with one new sufficient Node. A runtime switch,
ordinary correction or stronger tests under the same work definition is not
itself graph insufficiency. Agent semantic judgment must be recorded through an
authenticated request with reason and current source/basis. The program checks
scope, provenance and structural validity; it cannot infer insufficiency from
silence, retries, Request Changes, a failed test, or proposal text.

Multi-Node, empty, cyclic, foreign-dependency and unsupported output-reference
graphs must be rejected explicitly. The one-Node limit belongs in validation,
not global singleton storage or removal of membership/Node cardinality.

## Design red lines

1. **Actual request and durable origin.** A Replan request owns its freeze and
   origin, distinct from input, requirement change, guidance, planning issue and
   Owner Stop. A Node-origin request binds Task/Node/activation/source/Attempt;
   a requirement-origin request binds the real current operation and authenticated
   Planner source. Do not accept arbitrary client-supplied origin strings as
   authority. Record formal event provenance but use Task control version for CAS.
2. **Terminal Node handoff.** In one transaction persist request/blocker/freeze,
   fence the requester and admit Stop/outbox work. The Agent need not call again.
   One terminal handoff wins against complete/block; replay remains available,
   every later new mutation is rejected. Queued Node work is cancelled/returned
   to PENDING. Other running work finishes normally unless explicit compatible
   authority mandates Stop. Silence never creates that authority.
3. **Quiescent planning and publication.** Initial replacement generation waits
   for relevant Attempt processes, claims and completion/workspace operations to
   settle. Logical cancellation alone is insufficient. Dismissal acknowledges
   a decision before physical cleanup may finish; successor Planner capacity
   and workspace handoff wait for reconciliation. Crash recovery retains the
   same operation identity and reconstructable work.
4. **Complete immutable graph, exact confirmation.** Prepared graph is operation
   payload, not another mutable Plan lifecycle. Bind complete graph/digest,
   human-readable change summary, Task, request, current Plan/Specification and
   control basis. Authorizing planning is not authorizing an unseen graph.
   Owner can confirm/publish without reviving its original Planner. Proposal or
   confirmation bookkeeping cannot invalidate itself; externally changed basis
   requires refreshed semantic review and, when content changes, new approval.
5. **Identity and evidence are separate.** Retain Node ID only if goal, Role ID,
   dependencies, hard requirements, consumes and outputs are exactly unchanged.
   Changed formal definition gets a new Node ID. Even unchanged identity cannot
   implicitly carry invalid evidence: explicit applicability must bind the actual
   Specification, activation, completion and guidance assessment. Removed Nodes
   remain historical and cannot dispatch or contribute current completion.
6. **Same Task/private workspace, explicit new-work input.** Retain Task/resource
   workspace identity, history and Git lineage. Replacement can explicitly use
   old private work as historical input after old writers settle. It must not
   silently inherit old completed evidence, relabel old manifests, lose private
   files, reset fixed ancestry, or integrate a live writer's tree.
7. **One publication owner.** Replan publication and Specification publication
   serialize through the existing Task publication boundary. Joint publication
   switches both pointers, membership/applicability, guards, events and outbox in
   one transaction. No visible new Specification/old incompatible Plan interval.
   Exact requirements authorization and graph confirmation bind the same complete
   joint proposal; neither receipt independently grants the other action.
8. **Independent exits.** Dismissal publishes no Plan/Specification, discards its
   prepared graph and fences/cancels request-bound Planner work. It resolves only
   its request and blocker. A retained requester becomes eligible only after its
   earlier handoff settles and only if no Owner Stop or independent blocker remains.
   Direction is a durable Owner decision included in the next relevant source.
   A late prepare/issue/publication from the dismissed request cannot commit.
9. **Linked Specification is not automatic dismissal/withdrawal.** Dismissal leaves
   the requirement input/change unresolved. Withdrawing a linked change leaves an
   independently raised Replan effective. If a request exists solely for that
   proposal, Owner resolution must explicitly target/include its dismissal; do not
   infer that decision from link traversal. Repeated exits return their receipts;
   withdrawal/publication cannot both win. Interrupted real effects never restore
   invalidated evidence merely because a proposal was withdrawn.
10. **Planning issue remains an exit-capable phase outcome.** Raise issue closes
    its Planner mutation phase and retains REPLAN_REQUIRED/request ownership.
    Answer+Retry creates fresh context only after old ownership settles; Dismiss
    remains usable. No automatic fallback after a committed issue and no second
    controller resolving the same input through another phase.

## Review-feedback extension boundary

Review feedback routing is not implemented by this leaf unless the parent
explicitly broadens scope and implements its actual owning module. Do not add a
public feedback_id, mock feedback rows, accept arbitrary operation IDs, expose
apply_review_rework as a no-op, fabricate an Owner Request Changes receipt, or
claim native feedback dismissal coverage using synthetic SQL state.

Keep Replan origin and resolution ownership explicit and modular. Public schema
accepts only implemented authenticated caller/source variants. Unsupported
feedback-origin requests fail closed with the normal unsupported/precondition
contract; ordinary Task messages do not masquerade as feedback. Future integration
must add real referential/transactional provenance, not reinterpret old receipts.

Document a mandatory future owner hook/transaction seam: on feedback-origin
Dismiss, atomically preserve feedback, return REVIEW with acceptance guarded,
create a fresh routing operation linked to feedback and dismissal, preserve old
routing history and prevent immediate same-feedback/same-basis re-request without
new explicit Owner direction. New routing executes only after old Planner settles;
it applies within-graph Rework or raises an issue. Feedback Withdraw remains a
separate exact Owner decision. No generic callback framework is needed now.

Current tests should prove supported exits cannot clear unrelated guards and
unsupported origin cannot be forged. Future real feedback routing tests are
explicitly deferred, not counted as passing this leaf.

## Real PostgreSQL and independent-process matrix

Use actual migrations, canonical tool/Owner commands and independent PostgreSQL
connections. Race tests need observable lock/barrier evidence, not arbitrary
sleeps or two promises sharing one transaction. Kill independent worker processes
at known transaction boundaries and retain exit/receipt evidence.

| Area | Required cases | Assert |
| --- | --- | --- |
| Authenticated request | Node request; real requirement Planner source; wrong Task/activation/source; missing reason; unsupported feedback origin | One durable request/freeze, exact provenance; invalid sources cause no effects |
| Terminal competition | request versus complete/block/artifact; same request replay; changed bytes under same ID | One terminal winner; no late mutation; byte-identical retry receipt |
| Queued/running boundary | Request with queued Node; requester still physically owned; pending completion; capacity reserved | No old dispatch or early Planner/workspace successor; truthful historical completion |
| Proposal validation | Empty/multi-Node graph, duplicate ID, foreign dependency/Role, dangling consumes; changed definition with old ID | Explicit rejection, old pointers/history unchanged |
| Retention | Unchanged formal Node with applicable evidence; changed Role/goal with new Node; guidance or result changed | Correct identity/applicability; no historical result becomes current implicitly |
| Exact authorization | Two clients confirm/publish same proposal; edited graph/summary/requirements; obsolete control/Plan/Spec; prepare bookkeeping | One admitted publication; stale graph rejected; bookkeeping does not self-stale |
| New input and Stop | Publication versus Owner message, guidance/result update, Stop, dismissal | No lost input or stale basis; Owner Stop survives; exactly one compatible outcome |
| Shared publication | Replan versus standalone change; linked joint proposal | One owner; no partial pointer or mixed applicability; complete exact receipt chain |
| Dismissal | Queued/running/prepared/issue Planner; stale late prepare/issue; requester has sole versus additional blocker | Only request resolved; no Plan publication; claim retained until settlement; direction in fresh source |
| Linked exits | Dismiss with pending Specification; withdraw change with independent request; explicit proposal-only linked dismissal | Independent obligations remain; neither change nor graph publishes accidentally |
| Crash before commit | Kill request/prepare/confirm/publish/dismiss workers before commit | No orphan consumed receipt, request, pointer, freeze or scheduling intent |
| Crash after commit | Kill before wake-up, after Stop effect, between settlement and publication, after pointer commit before response | Same operation recovers; exactly one Plan/joint revision; receipt replay; no duplicate starts |
| Two backend workers | Competing settlement/publication/dismiss pumps and stale takeover | SQL ownership establishes authority; no in-memory-only exclusion |
| Fresh execution source | Replacement launch after publication and after Owner direction/Role edit | Exact effective Plan/Spec, new Node identity, latest Role context, historical input explicitly labeled |
| Projection noise | Late exited logs/heartbeat between confirmation or restart snapshots | No semantic version bump; diagnostics never restore mutation or current evidence |

Direct-SQL negative tests supplement command-path cases for cross-request proposal,
confirmation/consumption links, active publication owner and joint pointer integrity.
They do not substitute for authenticated tool flows or physical host evidence.
Preserve existing initial Plan/Specification/guidance/Stop/completion regressions.

## Installed native proof matrix

Use the existing authorized test host and services only. Freeze source manifest,
builds and exact migration history first; preserve old accepted leaf evidence.
Native model variability must leave failed attempts/receipts visible. Observe one
controlled flow; do not secretly retry new Tasks until a success looks clean.

| Scenario | Evidence required |
| --- | --- |
| Real insufficiency handoff | Agent receives actual one-Node insufficiency (e.g. required replacement Role/work definition), native request journal matches server receipt; private work and live descendants observed before accepted terminal handoff |
| Quiescent preparation | Same requester identity becomes absent; leases/effects settled; original private fingerprint/HEAD/index/ignored files retained; no replacement Planner start before boundary |
| Exact prepared graph | Native prepare payload/receipt/source bindings; full human-readable summary; independently saved exact Owner graph confirmation; no unseen-graph approval |
| Confirmed replacement | Before/admitted/after snapshots; old Plan while pending, one new Plan after settlement, changed Node ID, old membership/activation/history immutable; existing Task/workspace lineage preserved |
| Fresh replacement completion | Actual new Node/Attempt source and launch bind effective graph/Spec; explicit old private-result input; native open/complete receipts and manifest digests; actual private Git and exported tree/ancestry agree |
| Dismissal and issue | Real request-bound Planner/issue or prepared graph; exact Owner dismiss; no new Plan/Spec; old claim physically settled; late outcome rejected; direction in next eligible source, independent Owner Stop retained |
| Joint requirements/graph | Full exact Specification authorization plus graph confirmation; same admitted owner; no partial pointer switch; fresh execution uses both revisions, historical evidence unchanged |
| Linked withdrawal | Saved explicit Owner change withdrawal/dismissal identities; independent request/input not silently cleared; admitted physical effects reconciled |
| Backend/Runner restart | Separate recorded restart intents; exact request/proposal/receipt/history persistence; no duplicate dispatch; original process identities absent; global idle and current registration/Git unchanged |

The design may consolidate compatible scenarios but must not substitute a source
unit test for the actual terminal handoff/private-work/fresh-source/native completion
chain. If a particular matrix scenario is intentionally covered only by real PG,
state that boundary and why in acceptance evidence rather than implying host proof.
Late raw-log projections can differ only with exact appended event attribution;
retain the original failed assertion and all semantic/authority comparisons.

## Review decision before implementation

Proceed once design explicitly chooses request/proposal ownership, exact graph
confirmation basis, shared joint-publication ownership, retained/new Node
applicability and explicit linked exits. Unresolved design choices are not safe
mechanical fixes. Final checks must include generated TS/Go/OpenAPI consumers,
Runner native command forwarding, schema migrations, owning backend/runner specs,
lint/typecheck/build, real PG/process tests and frozen Linux/native evidence.


## Converged design review

Reviewed the expanded PRD, design and implementation plan before product work.
**No remaining design blocker found; implementation may proceed within this scope.**
The following are deliberate, coherent choices rather than missing subsystems:

- Node request is terminal. Conversation creates the request atomically with its
  reply routing instead of closing the Attempt and then requiring another reply.
  Dedicated quiescent Replan prepare/issue is its own terminal phase. This preserves
  exact phase outcomes and one shared Planner claim.
- Request freeze is separated from eligible live-source authority. Persisted exact
  eligibility across the request's own transition lets old work settle truthfully;
  it is not permission to substitute a new control version into arbitrary calls.
- Request-first joint preparation with two exact confirmations permits atomic
  quiescent Owner publication and avoids an admitted-change/Planner-slot deadlock.
  Unsupported pre-admitted insufficient order fails explicitly. Already admitted
  sufficient impact stays immutable until reconciled/withdrawn.
- One typed slot, atomic Plan/Spec applicability edges and explicit two-layer
  workspace transfer make the new identity/history boundary concrete. Completed
  finalized input is correctly distinguished from unfinished private checkpoint
  inheritance rather than weakening a shared observer.
- Dismiss, requirement withdrawal, guidance and Owner Stop retain separate owners.
  Joint requirement withdrawal invalidates linked graph eligibility but does not
  dismiss the request; dismissal does not authorize standalone requirement publish.
  Real review-feedback remains a documented future integration obligation only.

Implementation review must verify these precise consequences of the chosen design;
they do not require another requirements round or broader scope:

1. Open request/slot exclusions must still permit its own answer/Retry/dismiss,
   exact input processing/deferral and linked withdrawal. A rejected unsupported
   apply must return the linked request plus usable remaining exits, not leave an
   unreachable requirement obligation. New graph preparation after withdrawal
   must use effective old requirements and fresh exact authority.
2. Revalidating quiescence at Owner publication includes the preparing Planner's
   physical claim and Stop, not merely the earlier Node settlement. A just-returned
   terminal prepare receipt may precede actual Planner process release.
3. Canonical source and validation must agree on the complete joint graph/Spec
   basis. Draft linkage and two approvals are immutable; neither a new proposal
   ID nor normalized source rows may detach a still-live origin obligation.
4. Retained eligibility must not survive independent Owner Stop, guidance/result
   invalidation, another publication or activation change. Artifact/open/complete
   paths all check the same explicit captured eligibility rather than only the
   nominal Node state or request status.
5. Target lease descriptor transfer is server-owned and authenticated. Agent
   payloads cannot manufacture it. Host must validate released predecessor and
   exact latest lease/checkpoint independently before the new lease gains write
   access; ordinary same-Node and old receipt recovery must remain compatible.
6. Bound reads and prompts must expose only implemented sources and commands.
   Conversation routing must use its actual committed input/source; neither an
   unattached proposal nor fabricated feedback/Owner receipt closes that input.

These points are already represented by PRD/design commitments and the test
matrix. They are review assertions for implementation, not additional API features.
