# Backend seams for single-Node execution, Artifacts and recovery

Research only, 2026-09-30. Active leaf remains `09-30-a-task-start-planning`;
its deployed native acceptance has passed per root's report; final independent audit
and commit/archive remain root-owned. This note changes only itself.
It does not activate the next task, start a Node, mutate product state, deploy, or
claim completion of the native gate. Recheck current-leaf verification and final
source anchors before designing this backlog leaf.

Read: next PRD, parent `09-28-a-task-execution/research/decomposition.md`, architecture
and modules 01/02/03/04/05/06/08/09; current backend Task-planning, Task-record,
queue/scheduling, Owner command/read, database and workspace specs; corresponding
backend/DB/protocol implementation and relevant Runner effect/recovery code.

## Boundary and deployment consequence

The leaf ends at a valid local REVIEW result from a published canonical one-Node
Plan: durable Node execution, optional managed Artifacts, formal block/completion,
physical settlement, and explicit same-Node recovery. It does not implement Task
Conversation, requirement changes, Rework/Replan publication, remote preparation,
PRs, acceptance/merge, multi-Node orchestration or a combined execution UI.

The native initial-planning acceptance intentionally leaves a canonical Task
RUNNING with one PENDING Node. **Enabling the production Node pump will make that
existing membership executable.** Before that deployment, root must inspect its
exact Specification/Plan/Role and either use the authorized Node as the next native
trial or settle/cancel it through the next owning API. Do not silently exclude it,
reset its Task to PLANNING, edit its immutable Plan, fabricate completion, delete it,
or add a hidden allowlist that makes the production scheduler test-only. This
research has not queried the host or changed its state. Root supplied the verified
carryover below after native acceptance passed:

- Task `e14ad4bb-4688-4647-981c-70911889e17b`.
- Specification `a9b8ee1f-af68-45c0-948e-5af22902e05e`.
- Plan `5c99259e-d5d5-4b1f-a784-dc5d2027ddae`.
- Node `04fb910d-fdf9-4e2d-9ae2-ae269f53ca74`.
- Active Project `planning-native-v1-project`, selected Role
  `planning-native-v1-role`; zero resources and zero Node Attempts.
- Objective: a reading-list UI with Add book and mark finished. All three native
  Planner processes are physically released.

Recommended disposition: use this exact Node as the next real no-resource
Artifact/completion trial, for example a standalone HTML Artifact satisfying the
existing Specification. Review the actual immutable Specification/Node/current
Role before execution; this note does not replace them. The managed content read
returns data and must not execute arbitrary HTML in the Owner application's origin.
This creates no stray preexisting Node when the scheduler is enabled.

Existing internal probe Tasks are different: migration/deployment must preserve
explicit fixture provenance and must not automatically execute arbitrary historical
probe PENDING rows. Use canonical publication evidence and current membership for
legacy discovery, not `tasks.resource_id IS NULL` as an authorization shortcut.
Future public Plan publication and Owner recovery should create/reconstruct Node
work durably within their own formal transition boundaries.

## Architecture decisions to carry into design

| Question | Existing decision |
| --- | --- |
| Who schedules? | Program derives eligible effective Plan members and dependencies; no Planner availability check after publication. `docs/03-runtime-and-execution.md:280`. |
| What is a queued Node? | Node RUNNING includes its admitted QUEUED Attempt. Busy capacity alone is normal and never BLOCKED. `docs/03-runtime-and-execution.md:512`, `:145`. |
| What if the Runner is unavailable? | Retain durable work waiting for the sole/pinned Runner to return; temporary Runner absence is not target exhaustion. Full healthy capacity remains QUEUED. V1 has no cross-Runner failover; Runtime fallback concerns Runtime failures on an available Runner. `docs/03-runtime-and-execution.md:192`. |
| What if no supported Runtime/policy target remains? | No fake Attempt for preselection failure. Objectively exhausted supported targets block Node with factual attention and Owner Retry; unsupported/missing Runtime or policy needs an explicit correctable disposition. Distinguish both from Runner waiting. Stage A has one supported target and no cross-runtime fallback. `docs/03-runtime-and-execution.md:131`, `:502`; `docs/09-first-executable-slice.md:25`. |
| What does a new execution receive? | Fixed protocol, selected Role's current full instructions, effective Spec, Project map, exact Node definition, current upstream summaries/Artifact references, applicable scoped direction. Exclude Todo/cache, Planner Guidance, other Role instructions and raw transcripts. `docs/02-planner-and-planning.md:241`; `docs/05-tool-protocol.md:65`. |
| Does hiding a Role invalidate an existing Plan? | No: hiding prevents future selection; referenced Roles stay and later Attempts use latest instructions. Do not reuse initial Start's `NOT archived` eligibility for an already-published Node. `docs/01-product-and-domain.md:168`. |
| Is Artifact publication completion? | No. Published Artifact is immutable history; current evidence requires successful matching activation completion and effective membership. `docs/06-state-and-formal-data.md:393`. |
| Does completion require an Artifact or Git repository? | No Artifact required; no-resource work must have honest completion without invented Git revisions. Opened Git work must finalize before current completion/REVIEW. `docs/05-tool-protocol.md:127`; `docs/04-workspace-and-git.md:138`, `:365`; next PRD. |
| Does block imply Runtime failure? | No: `block_node(reason)` is semantic external inability under a still-valid Node/Plan; it closes mutation authority. Runtime reports factual failure independently. Owner resolves the exact blocker and starts a later Attempt. `docs/05-tool-protocol.md:157`, `:324`; `docs/03-runtime-and-execution.md:330`. |
| Can Stop/Retry release ownership by changing state? | No. Same activation/workspace survives, but whole-tree/system-effect absence and prior operations/leases must settle first. `docs/03-runtime-and-execution.md:480`, `:502`; workspace spec. |
| What state does completion recovery use? | Recoverable completion keeps Node RUNNING with a recovery indicator, including after Runtime exit. Unrecoverable finalization blocks with the operation reference. Retry reconciles partial integration first. `docs/03-runtime-and-execution.md:524`. |
| Is REVIEW Owner acceptance? | No. REVIEW follows all required valid completions plus local operation settlement. Delivery stays a later leaf/package. `docs/03-runtime-and-execution.md:293`. |

## Existing seams and precise gaps

| Source | Reuse / gap |
| --- | --- |
| `apps/server/src/task-records.ts:65`, `:100` | Publication creates immutable membership, activation 1 and PENDING Node. `assertCurrentNode` checks current effective Spec/Plan/activation. No production Node scheduling/context builder exists. |
| `apps/server/src/task-planning.ts:105`; `task-planning-state.ts:50`, `:86` | Durable source, frozen context, source/head checks and replay-aware scheduling pattern. Reuse techniques, not initial-Planner source records or Planner Guidance. Node source must bind Node+activation+Spec+Plan. |
| `apps/server/src/main.ts` | Existing bounded in-process pump handles Discussion and initial planning, with shutdown tracking. Add Node work here; no new service/broker/resident Planner. |
| `apps/server/src/runtime-scheduling.ts:44` | Current Role policy/global policy and shared capacity selection; accepts `role_id`, returns factual unavailable, serializes Attempt IDs and exact request replay. Owning module must still recheck source/basis after replay. |
| `apps/server/src/dispatch-queue.ts:37`, `:123`, `:133` | Already selects canonical Node membership/dependencies, current activation, workspace reservations, physical owner/capacity/locality. Queue currently leaves Node PENDING and promotion requires PENDING, changing it to RUNNING only then. Update canonical production semantics for RUNNING-at-queue; preserve explicit old probe behavior. |
| `apps/server/src/owner-execution.ts:55`, `:102`, `:123` | Stop/Continue/Retry require Attempt ID. Stop expects a queued Node to be PENDING. Recovery requires terminal FAILED/CANCELLED, physical release, settled effects/leases and unused recovery marker; it only restores PENDING, never builds a new source/context. No control target exists before Runtime selection. |
| `apps/server/src/service.ts:199`, `:234`, `:435` | Signed admission/receipt/guard and terminal completion ownership exist. Add Artifact/read/block handlers before generic Runner effect dispatch. Complete freezes authority and records receipt/operation; settlement creates current evidence. |
| `apps/server/src/service.ts:71`, `:362` | Missing formal outcome/capture failures fence, preserve Stop and block Nodes with factual reasons. Preserve this path; process exit/prose cannot complete work or automatically rerun indefinitely. |
| `apps/server/src/service.ts:418`, `:483` | A recovering completion plus process absence currently blocks the Node without distinguishing recoverable from hard failure. Both event and settlement paths conflict with the documented RUNNING-with-recovery rule; adjust together while retaining the original operation and physical claim. |
| `apps/server/src/workspaces.ts:70`, `:109`, `:123` | Lazy authorized open, exact descriptor/lease and physical settlement already work. `admitWorkspaceEffect` currently refuses complete_node without a lease; repository-free settlement only accepts Stop. |
| `apps/server/src/service.ts:461` | Every complete_node success currently requires `git_commit` and `git_tree`, including no-resource Tasks. This must become explicitly conditional on admitted workspace evidence. |
| `packages/db/migrations/0005_task_records.sql:44` | Immutable `node_completions` stores physical `result` plus Attempt/operation. Summary survives only inside command envelope today; it is not a typed completion read/model. Freeze semantic summary and selected Artifacts at admission and attach them to completion. |
| `packages/protocol/schemas/v1/contracts.json` | No publish_artifact/read_artifact/block_node contracts or managed content. `complete_node.artifact_ids` currently permits only empty array. `handled_guidance_ids` also empty: keep it so until Task Conversation owns obligations. `Operation` permits resource omission only for Stop. |
| `apps/server/src/owner-reads.ts:91`, `:159`; `owner-execution.ts:148` | Attempt/log/operation/event reads already exist. Missing per-Node definition/status/blocker/unavailable source/completion/Artifact projection and durable Artifact content reads. |
| `runner/internal/adapter/opencode.go:38`; `runner/internal/local/socket.go` | Node fixed protocol currently describes open/workspace boundaries, not mandatory completion/block or Artifact rules. CLI/local allowlists and phase guards need new contracts; preserve exact `--input`, `command-status`, `retry` syntax. |
| `runner/internal/host/effect_scope.go`; `runner/internal/host/git.go:103` | Canonical no-workspace complete currently cannot pass effect scope and would otherwise enter fixture Git finalization. Add an explicit repository-free canonical completion path, never fixture fallback. |
| `runner/internal/daemon/recovery.go:20`, `:55` | Reconnect retries retained recoverable effects, but repository-free recovery is deliberately restricted to source-bound initial-Planner Stop. Hard capture failures are excluded. Node no-repository Stop/completion requires an equally exact extension. |
| `apps/server/src/fixtures.ts:85`; `admin.ts` | `retry_operation` exists only as fixture/admin helper and resets recovery to admitted. It is not an authenticated product recovery API or native acceptance route. |

## Recommended durable Node selection boundary

Add a Node execution owner module rather than expanding initial-planning commands
or using a generic workflow engine. A concrete design can use `node_execution_outbox`
with stable intent ID, task/node/activation, exact Spec/Plan/control basis, origin
(public Plan membership or Owner decision), one planned Attempt, bounded frozen
context/digest, configuration provenance, done/waiting facts and timestamps. Current
Node points to the source; Attempts have nullable immutable same-Node/source
binding. Use same-Task/activation/revision FKs and unique pending source/owner;
retain history and null legacy metadata, never infer an old launch prompt.

The source records execution intent, not a persisted `runnable` Node state. A
bounded DB scan of canonical eligible membership can prepare a source when none
exists, provided publication/recovery plus the scan are provably reconstructable
through process loss. A matching durable publication event supports rollout of
already-published canonical Plans, including the current native acceptance Task.

Once a source is prepared it is immutable. Source/head/version is rechecked in the
same transaction as selection/enqueue and again at promotion. Same request/Attempt
replay cannot authorize an old source on a coincidentally equal numeric version.
One configuration read barrier snapshots current Role/Project/input at source
admission; a queued Attempt never refreshes its prompt after Role edits. Retry or
Continue prepares a fresh execution source from current configuration.

Recommended state behavior:

- Effective eligible Node starts PENDING; source preparation itself creates no
  process or workspace. A hard context preparation failure records a durable
  correctable blocker/source without fabricating an Attempt; Owner can Retry.
- Temporary unavailability of the sole/pinned Runner retains durable waiting and
  resumes selection when that Runner returns. A source with no admitted Attempt
  remains PENDING with a waiting reason; an already-admitted queued Attempt keeps
  Node RUNNING. Do not force fallback, consume retry budget or require Owner Retry
  merely because that Runner disconnected.
- Healthy selected queue admission atomically sets canonical Node RUNNING and
  Attempt QUEUED. Capacity waiting is normal. Promotion recognizes
  only that source's current RUNNING Node/activation and acquires the shared claim.
- A complete fresh Runtime report cancelling a selected pre-start Attempt also
  records/reconciles the Node's factual blocked/source disposition; leaving a
  RUNNING Node with no live/queued work is not sufficient.
- Old source queue cancellation must never block or change a successor activation.
  Legacy probe PENDING-at-queue tests need explicit compatibility expectations.
- Source/context preparation failure is never silently rebuilt by the pump.
  Preserve whole input or fail within budget; no clipping Specification/Role text.

Final design must name the correctable disposition for unsupported/missing Runtime
or policy and use BLOCKED plus Owner Retry for objectively exhausted supported
targets. Keep those facts distinct from temporary Runner unavailability and healthy
capacity waiting. Do not copy initial Planner's deliberate RUNNING/no-Plan exception
onto Node execution or collapse all scheduler `unavailable` reasons into BLOCKED.

Node execution remains independent of Planner availability after publication.
A prior Planner's repository-free cleanup consumes its own physical slot but does
not create a new cross-owner semantic scheduling dependency when another slot is
free. Same-Node and same-workspace old writers/effects must always block handoff.

## Node context and source map

Freeze deterministic canonical JSON containing:

- fixed Node Tool Protocol, actual CLI examples, mandatory complete/block outcome;
- exact source/task/node/activation, effective Spec/Plan and full Node definition;
- current full selected Role instructions plus identity/name/description;
- current Project context and active resource/workspace reservation map;
- relevant current successful upstream completion summaries and Artifact map;
- explicitly consumed Artifacts when supported/valid, exact applicable blocker
  answers, and same-Node recovery reason/previous result provenance.

Do not include Owner Planner Guidance, other Roles' instructions, Todo/cache/native
sessions, arbitrary other Tasks, complete Timeline/logs/diffs or repository bytes.
Existing hidden but referenced Role still supplies current instructions. Plan and
Node definition remain immutable; do not add Role snapshot/revision tables to them.
An Attempt's retained launch is its context audit, not a new Role version model.

Generic graph primitives retain multiplicity, while public Stage A scheduling
rejects unsupported multi-Node plans without flattening. Existing initial publish
rejects nonempty `consumes`; when enabling Artifact references here, validate scoped
managed references, not arbitrary IDs. `consumes` is an initial-context hint, not
a required producer/consumer taxonomy or replacement for dependency checks.

Budgets must account for encoded Dispatch/item/envelope bytes, code points and
UTF-8. Inline bounded output summaries/Artifact maps rather than all contents;
retrieve additional managed content with scoped read_artifact. The context digest
binds exactly the frozen canonical content and stays outside its own input.

## Artifact and completion contracts

There is no existing Artifact storage to extend. A small explicit initial contract
can support bounded UTF-8 text content without inventing a general file-upload
service. Proposed public command shape (final names/bounds belong in design):

```ts
publish_artifact.payload = {
  artifact_id: Id,
  title: string,                       // nonblank, <= 256 code points
  content: { text: string, media_type: string },
  references?: ExternalReference[],    // bounded, clearly external/mutable
  supersedes?: Id                     // same Task; provenance only
};
read_artifact.payload = { artifact_id: Id };
block_node.payload = { reason: string };
complete_node.payload = {
  summary: string,
  artifact_ids?: Id[],
  handled_guidance_ids?: []            // nonempty remains unsupported this leaf
};
```

Text-only is a concrete Stage A storage boundary, not an Artifact business-type
enum. Define supported content encoding and limits explicitly (for example at most
256 KiB content, bounded MIME value and reference count); larger/binary input must
fail explicitly until a managed upload contract exists. Do not accept an arbitrary
Runner path and report it as captured content. CLI stdin/--input sends exact bytes;
server validates, computes digest/size and stores managed immutable content before
publication can return committed. External references are never auto-fetched or
mislabelled as archived bytes.

Recommended database records:

1. `managed_content`: immutable content bytes/text, server-calculated digest, size,
   encoding/media type; optional deduplication does not remove Task read authority.
2. `artifacts`: immutable global ID, same-Task Node/activation/Attempt attribution,
   effective Spec/Plan provenance, title, managed-content reference, bounded generic
   references, optional same-Task supersedes and creation time.
3. Typed completion manifest keyed by admitted complete_node operation, binding
   the required summary, exact selected Artifact IDs and originating request/basis.
   Normalize completion-to-Artifact links where useful for same-Task/activation FKs.
   Existing `node_completions` can reference the manifest after physical success;
   legacy completion metadata remains explicitly unavailable, not invented.

All Artifact publications remain historical until selected by successful current
activation completion. Missing `artifact_ids` selects this successful Attempt's
published Artifacts; explicit list selects exactly those same-Node/same-activation
outputs, including earlier Attempt outputs if requested; explicit `[]` selects
none. Reject cross-Task/Node/activation IDs and duplicate IDs. `supersedes` never
makes an invalidated result current by itself. Freeze selection before fencing:
late Artifact publication after completion/block/Stop must be rejected.

Store publication event + managed content + Artifact + immutable receipt together.
Same receipt returns identical identity/content; changed payload or a globally
occupied Artifact ID gives a correctable deterministic conflict, not HTTP 500.
Publication must not mutate Task control merely for event/log activity and stale
its own subsequent lifecycle command. The existing separation of event sequence
and control version remains important.

Expose Owner scoped Artifact manifest/content read and bounded list/map, plus
Agent Task-scoped read_artifact. Owner retrieval survives producer exit, reconnect
and workspace retention cleanup. Agent reads do not grant cross-Task authority;
keep source-bound initial Planner/Todo write allowlists unchanged. Do not route
Artifact publication or read into Runner Git `operations`.

## Completion, block and recovery

### Completion with and without a workspace

Reuse complete_node as the single lifecycle command and its existing operation
identity/receipt/unique-per-Attempt barrier. Freeze semantic manifest + revoke
mutation + admit trusted physical finalization atomically. The Runner returns
physical evidence, never authority to choose summary or Artifact selection.

For an opened workspace, retain current lease, exact descriptor, start/basis/final
Git ancestry and service-owned checkpoint/export behavior. `workspaces.ts` advances
finalized Task revision in the same DB transaction as valid completion. No extra
Artifact is mandatory, no automatic remote publication occurs, and local capture
limits remain distinct from publication policy.

For an Attempt with **no opened workspace**, allow an explicitly canonical
repository-free complete_node operation. Schema conditionals, DB resource checks,
backend admission/settlement, Runner scope/helper and reconnect recovery must all
agree. Stop/freeze the whole process tree and require `writer_absent:true`; return
no fabricated commit/tree/workspace metadata. Merely having Project resources or
reserved IDs does not prove open. Conversely, a real outstanding lease/open cannot
be bypassed by choosing the no-workspace branch. Do not fall through to fixture.git.

Only successful physical settlement can create current `node_completions`, mark
Node COMPLETED, select valid Artifacts and expose summary/result. REVIEW requires
all effective required Nodes complete plus settled local operations; later Stop
settlement must trigger/reconstruct derivation if another operation temporarily
held the Task out of REVIEW. `derivedTaskState` alone currently ignores operations;
its completion caller supplies a separate guard. Include held physical claims in
the local-result gate where they can still affect that result.

### block_node and Owner exits

block_node is a terminal semantic handoff under the same live claim/basis guard.
Record exact reason/event/blocker reference, fence mutation, admit or reuse the
trusted Stop/checkpoint, set Node BLOCKED and rederive Task. Distinguish semantic
block from objective failed/missing-outcome Attempt in `end_reason`; do not fake a
Runtime failure just to fit existing retry_node's `state='FAILED'` condition.

Provide exact Node/activation/source/blocker-targeted Owner Retry and Continue,
including a bounded answer with provenance when needed. Stop must also address a
PENDING/unavailable source with no Attempt. Reuse Owner receipt namespace and exact
Task control CAS; preserve legacy attempt-targeted semantics. Continue resolves an
Owner-stopped Node; Retry resolves a factual failure or answered external blocker,
without clearing an unrelated blocker. Responses/reads distinguish saved intent
from physical release and selected execution.

An Owner action can be recorded without a free model slot. If the new source-aware
variant accepts a terminal/fenced old Attempt while Stop is settling, it may persist
future intent only; promotion still waits for every old owner/effect/lease. Keep
legacy released-before-retry behavior. Same Node+activation continues after ordinary
Stop/failure; do not increment activation merely because an Attempt changes.

### Hard finalization failures need an actual product exit

First fix the current recoverable-state discrepancy: `service.ts:418` blocks on
process absence whenever a completion is in recovery, and `service.ts:483` blocks
on failed completion with writer absence, even for a recoverable failure. The
architecture requires Node RUNNING plus an explicit recovery indicator until that
same operation settles; only unrecoverable finalization is BLOCKED. Both message
orders need coverage. Neither state releases the physical claim or permits a fresh
Attempt to bypass the retained operation.

Current recoverable Git effects can reconcile on reconnect, but hard capture
failure remains held and `retry_node` rejects unresolved operations. `existingTerminal`
also makes Owner Stop return the existing completion operation. The fixture-only
retry helper is not enough for a shipped recovery claim.

Final design must choose explicit authenticated infrastructure retry for the **same
admitted operation** after repair, and specify how a failure needing new Agent code
correction can transition to a fresh Attempt. The latter requires trusted abort/
settlement of uncommitted finalization with preserved private work, not resetting
its DB state, creating a competing Stop, changing its immutable input or releasing
its claim speculatively. Existing cancelled-operation semantics cover only an
unexposed open; do not reuse them for completion without a distinct proven host
contract. If a hard-failure correction branch is deferred, report that limitation
explicitly rather than claiming all BLOCKED Nodes are presently recoverable.

### Post-Plan cancellation boundary

Current cancel_task deliberately rejects a published Plan. The next design must
state whether it adds bounded local pre-delivery Task cancellation here. It is
useful for disposing of the retained native PENDING Task and provides the documented
terminal exit, but it must not pretend to cover accepted/remote-delivery cancellation.
No Plan may revert to PLANNING. A minimal local variant binds exact Spec/Plan/control,
revokes all selected Node/Planner sources, fences/cancels queued/running authority,
sets unfinished Nodes and Task CANCELLED, and retains cleanup/history. Completion
or cancellation ordering must prevent late current evidence. If choosing to defer
this variant, explicitly reuse/execute the retained native Task rather than delete
or silently abandon it before pump rollout.

## Lock order and admission hazards

- Semantic context/source preparation: configuration SHARE -> Task -> current
  Node/activation/source; commit before Runtime selection. Owner actions first
  authenticate session and serialize their scoped immutable request.
- Selection: configuration -> planned-Attempt advisory -> Auto registry EXCLUSIVE
  or chosen Runner -> Task -> Node/source -> Attempt. Recheck current source after
  exact scheduler replay, which may return before Runner locking. Roll back stale
  enqueue; never hold Task while entering Runtime selection.
- Owner control: discover current Runner read-only, then Runner -> Task -> Node ->
  Attempt -> workspace/lease -> operation; rediscover if head changed. No-Runner
  sources still have a valid deterministic Owner control path.
- Agent Artifact/block/complete: current signed admission configuration -> Runner
  -> Task -> Attempt; validate scope/source/activation/Spec/Plan/fence/connection
  and exact expected control. Receipt lookup precedes new-effect guards.
- Settlement: existing Runner -> Task -> Attempt -> workspace/lease -> operation;
  no network/Git/content-path access in DB transaction. Preserve original operation
  and exact host ownership through uncertainty.

Do not expand Task control CAS to unrelated Role edits, event appends, Artifact
reads or heartbeats. Do not downgrade state from old queued work after a new source
won. Keep append-only definitions/results and schema-generated strict wire types,
including absent versus empty Artifact selections in Go serialization.

## Independent test gates

1. **Canonical scheduling:** published PENDING discovery after backend restart;
   no Task creation/PLANNING/unrelated probe execution; one source/Attempt/Start
   under distinct-connection observed locks and commit/wakeup crashes. Existing
   native Task disposition is recorded before rollout.
2. **Context:** exact effective Spec/Node/objectives/current selected Role; changed
   Role seen only by fresh execution; archived referenced Role remains usable;
   Todo/cache/Planner Guidance/other Roles/sibling Task sentinels excluded. Bounded
   context failure, no clipping/implicit rebuild, explicit Retry recovers.
3. **Queue/state:** canonical QUEUED means Node RUNNING, healthy saturation no
   blocker, temporary sole-Runner absence waits durably and resumes without Owner
   Retry, missing/unsupported Runtime policy has distinct factual attention,
   current Runtime report cancellation reconciles Node, stale source with forged
   matching version cannot promote, policy replay does not refresh input. Legacy
   queue/Stop assertions remain covered separately.
4. **Physical exclusivity:** same-owner/serial workspace and shared slots; old
   terminal/fenced Node Stop holds successor despite a spare slot. No automatic
   workspace materialization on scheduling; lazy open preserves exact lineage.
5. **Artifacts:** immutable bytes/digest/title/references/supersedes attribution;
   changed receipt/global ID conflict; cross-Task/activation denial; content and
   read response byte limits; owner reads after producer exit/restart; no bare path
   masquerades as managed content. Multiple historical Attempts remain readable.
6. **Evidence selection:** absent vs explicit-empty vs explicit earlier same-
   activation selection, frozen before terminal handoff, unsuccessful Artifact
   producer not current by default, supersedes alone does not change validity.
7. **Terminal races:** Artifact vs complete/block/Owner Stop, complete vs block,
   completion vs Stop/Cancel and stale activation, with both observed lock orders.
   One manifest/operation/event/current completion; receipt-trigger rollback and
   process crash around DB/host commit; no prose/exit completion.
8. **No repository:** native complete and optional Artifact produce truthful local
   REVIEW only after whole-tree absence; no Git fields, fixture commits, leases or
   fake workspace. Failed/unresolved open cannot bypass physical settlement.
9. **Git result/recovery:** real canonical open, dirty tracked/untracked result,
   exact start/final tree, crash after private finalization/before acknowledgement,
   same operation recovery remains RUNNING under both absence/failure message
   orders, Stop checkpoint/Continue and same activation reuse; hard capture failure
   BLOCKED with product recovery or explicit scoped limitation.
10. **Blocker controls:** external block, missing outcome, unavailable with no
    Attempt, queued Stop, disconnected Stop, exact answer/Retry/Continue, replay
    after supersession; preserved private work and no unauthorized auto restart.
11. **Upgrade/full gates:** migration 17 -> next additive migration (likely 18,
    confirm at activation), null historical metadata, retained receipts/workspace
    results; full real PG, TS/protocol/lint/typecheck/build/Go race/vet and native
    module import. Shared fixtures validate both language parsers and byte limits.

Native acceptance must use the already-authorized existing installation and the
real published canonical Plan, actual CLI commands, exact receipts and trusted
process-tree absence. Keep the two-account/credential boundary and existing port
18444. Root owns deployment/host operations. Fake DB results prove transaction
behavior only; they do not prove Linux writer absence, Git recovery or live model
behavior. No new permanent service or remote publication is required by this leaf.
