# Task execution package decomposition

Research only, 2026-09-30. No product changes, task creation/start, host inspection
or host mutations were performed for this note. Source baseline includes completed
Task preview/creation and the existing Runtime/Discussion implementation. This is
input to package planning, not a finalized first-leaf design or acceptance claim.

## Stage boundary

The Stage A table in `docs/09-first-executable-slice.md:25` explicitly defers
**Planner repository inspection** and multi-Node graphs. Its `:39` paragraph
explicitly requires **one-Node replacement Plans**, including joint Specification
publication when the Node definition changes. The general inspection rules in
`docs/02-planner-and-planning.md:156` describe the eventual feature, not permission
to pull `09-28-b-planner-replan` into this package.

Stage A's execution prerequisite is real Project resource access through
`open_workspace`, a persistent serial Task Workspace, and recoverable completion.
PR creation, publication scans, acceptance/merge and delivery correction surfaces
remain owned by `09-28-a-review-delivery`. This package must provide exact local
result/evidence and input guards for that handoff; reaching REVIEW is not delivery.

## Suggested eight leaves

These are proposed boundaries and dependencies, not new roadmap records. Each
behavior leaf needs its own executable API/Runner evidence; the final acceptance
leaf combines them through the real Owner flow.

| Order / proposed leaf | Concrete scope and reusable seams | Independent acceptance boundary |
| --- | --- | --- |
| 1. Authorized Project resources and serial Task workspace | Real read-only remote fetch into service-owned per-resource caches; authenticated lazy Node open; stable Task/resource workspace, fixed base/target, direct physical lease and interrupted-work preservation. Replace fixture-only routing for new Project Tasks. Details below. | Real authorized repository, two OS identities, duplicate opens/reconnect, fresh Attempt reopening the same Task workspace, ref edits/removal races and uncertain materialization recovery. No Start/Planner feature is needed to test the scoped operation using a test-owned admitted Node. |
| 2. Explicit Start and initial Task planning | Owner Start/receipt, RUNNING with no Plan, durable planning intent and unavailable/queued reasons; deterministic fresh Task Planner context; public `publish_execution_plan` and `raise_planning_issue`; one-Node limit at the Stage A command boundary; Stop/Retry of initial planning and explicit answer/Retry/Withdraw for planning issues. Reuse `initializeTask`, `publishInitialPlan`, `RuntimeScheduling`, `DispatchQueue` and current Owner Stop primitives. | A created PLANNING Task performs zero execution until Start. Duplicate Start yields one planning intent. Current Project/selected Role descriptors and current Specification are used without Todo context. A real Planner publishes exactly one immutable one-Node Plan or an actionable issue; no workspace materialization is caused by Start. Test stale publication and restart before/after scheduling. Keep Node execution acceptance separate in leaf 3. |
| 3. One-Node execution, completion and recovery | Durable scheduling of eligible Plan membership; current Role instructions and Node context; lazy open; required summary, optional managed `publish_artifact`/`read_artifact` with Task/Attempt attribution and durable content references, `block_node` with explicit Retry/Continue exits; finalization and exact Task workspace result; REVIEW derivation; failure/Stop/Retry/Continue through settled physical ownership. Reuse queue promotion, `assertCurrentNode`, `derivedTaskState`, host stop/finalize/export and completion history. | A real CLI executes from the published Plan and reaches REVIEW only after physical settlement and one formal completion. Missing tool outcome blocks. Managed artifacts remain readable after producer exit/reconnect; no artifact is required for completion. Crash after Git commit/before DB acknowledgement recovers once. Stop preserves private dirty work and Continue restores it without claiming completion; no fabricated Git result when no repository was opened. |
| 4. Ordered Task Conversation and within-scope guidance | Task-owned messages/source watermarks, bounded deterministic context, canonical reply/routing; progress reads, planning-issue answers, guidance obligations and controlled follow-up/stop-and-resume; explicit input Retry/Withdraw. Reuse Discussion's receipt/outbox/settlement patterns, not its Todo session or tables. | Two inputs during busy Planner processing retain ordered dispositions. Progress questions do not alter execution. Before Start/while stopped/terminal replies cannot Start/Continue/reopen. Guidance delivered immediately before/after completion stays pending until handled or explicitly withdrawn; old-basis completion cannot hide it. Queue saturation still permits Owner exits. |
| 5. Exact Specification revisions with a sufficient graph | Committed Task proposal, exact content plus impact authorization; pre-start edit and started settlement operation; guidance/evidence invalidation or explicit carry-forward; proposal replacement and withdrawal. Extend `publishPlanningSpecification`/confirmation primitives rather than relaxing their PLANNING guard. | Two-device confirmation publishes one revision. Stop or backend restart during settlement preserves the previous effective revision until atomic publication, old writers cannot complete on the new basis, and Owner Stop remains effective. A requirement-only change reuses the graph and keeps provenance of invalidated/retained evidence. |
| 6. One-Node replacement Plan and linked operation exits | Quiescent Replan request/freeze, complete one-Node proposal, graph/impact confirmation, atomic replacement or joint Specification+Plan publication; changed formal definition creates a new Node; same Task/workspace lineage; planning issues and dismissal/withdrawal retain independent obligations. | Changed Node goal cannot be disguised as Rework. Old queued/running claims are fenced and physically settled before replacement; stale confirmation fails without partial pointers. Dismissing Replan does not publish a pending Specification or clear its input/feedback. Multi-Node proposals produce explicit unsupported attention, never flattening. |
| 7. Execution UI and scoped reads | Ready to start/Running/Review board and factual attention; Task detail Conversation/Overview/Timeline and execution diagnostics; Start/Stop/Retry/Continue, proposal decisions, input withdrawal and Replan dismissal. Extend current `#task?task_id=...` and authenticated Task reads; preserve `#execution` as settings. | Browser reload/two clients/lost responses preserve exact command identities and drafts. All actions use canonical projections; logs do not transition lifecycle. Task/source navigation and mobile keyboard focus work. REVIEW exposes the local result without claiming PR/acceptance completion. |
| 8. Task execution integration acceptance | Existing installation: new Owner-configured Project/resource/Role, real capture→proposal→Task→Start→Plan→Node→local REVIEW; conversation/guidance/revision/replacement/Stop recovery. Preserve versioned source and absence evidence. | Native run plus deterministic fault tests prove no fixture repository/context fallback, no duplicate process/workspace/completion/revision after reconnect, scoped credentials, retained workspace lineage and no unintended remote write. Record remaining delivery gate separately. |

Each leaf exposes its decisions/exits through authenticated APIs and scoped reads;
API/Runner tests can establish those behaviors before the final UI leaf. Small UI
pieces may accompany an owning leaf when useful, but a full UI is not a prerequisite
for every leaf. Leaf 7 owns the combined workspace and cross-feature regression. Leaf 2's publication primitive can
be tested with durable PENDING membership before leaf 3 consumes it; do not invent
a new Task state or promise a shipped end-to-end execution loop at that boundary.

## First leaf: concrete existing gaps and reusable anchors

| Source anchor | Actual behavior now | Required touch point |
| --- | --- | --- |
| `packages/domain/src/commands.ts:guardNewCommand`; `apps/server/src/service.ts:184` | Task resource authorization first compares to `tasks.resource_id`. The later active Project-resource query cannot rescue a canonical new Task whose legacy resource column is null. | Separate general Attempt/scope/version/role guards from canonical Project resource resolution. New Project Tasks use their Project and current active resource records, never a copied Task list or probe fallback. Explicitly isolate historical fixture compatibility. |
| `apps/server/src/service.ts:admitEffect`, `toOperation`, `recoverOperation`, `inventory` | Admission persists `attempt.launch.resource_id`, not the requested resource descriptor. Operations carry only resource ID; replay/inventory therefore cannot pin mutable Project defaults. | Persist the resolved nonsecret resource/admission basis and workspace identity with receipt/outbox in one transaction, and return the same descriptor through every delivery/recovery projection. An Agent supplies only `resource_id`; it must not choose remote URL, filesystem path or credentials. |
| `packages/protocol/schemas/v1/contracts.json` definitions `Dispatch`, `Operation`, `EffectResult`; `apps/server/src/dispatch-queue.ts:enqueue` | Task Dispatch and queue require one `resource_id`. `EffectResult` lacks root `instruction_files`, materialization generation and durable base/target attribution. | Add strict generated operation/materialization contracts and remove the single fixture resource requirement for canonical Task dispatches, including repository-free Task Planner. Keep legacy receipt/envelope bytes readable. Shared TS/Go fixtures must test both branches. |
| `apps/server/src/configuration.ts:31`, `:55`; `configuration-guards.ts:lockConfiguration`; `packages/domain/src/repositories.ts` | Project resources have immutable Project/remote/provider identity, mutable defaults and active tombstones. Configuration removal checks admitted open operations. | Reuse the configuration SHARE-before-Runner/Task barrier and immutable repository identity. Extend removal protection to the new durable materialization/lease facts if those outlive the current operation query. Do not reduce it to Task status. |
| `apps/server/src/github.ts:repositories` | Backend already stores encrypted App keys, signs JWTs and privately mints read-only installation tokens to list repos. There is no scoped Runner Git-credential exchange. | Extract/reuse provider authorization for the exact admitted repository, narrow read permission and repository scope, and add a Runner-authenticated short-lived exchange. Return secrets only to the service account's effect path; never in persisted `Operation`, Task context, command receipt or UI. |
| `runner/internal/host/git.go:GitEffect`, `gitEnv`; `materialization.go:materialize` | Cache is hard-coded `cache/fixture.git`; common/workspace/base record are under `AttemptRoot`. IDs hash Attempt ID. Clone checks current cache HEAD twice; interrupted materialization is rejected for recovery, not resumed. | Per-resource cache plus stable `(Task, resource)` materialization independent of Attempt; clone/check out a persisted resolved object ID, not moving HEAD. Keep no-hardlink `--no-local`, exact safe-directory config and existing-path validation. Add recoverable staged materialization. |
| `runner/internal/host/helper.go:prepare`, `executionDirectories`; `helper_effect.go:sameOperation`, `rootMaterializationBase` | Path grants and privileged records are Attempt based. Repeated operation validation and root-retained finalization base compare only legacy fields/Attempt ownership. | Reserve bounded task-resource paths/common directories without moving a live process. Bind local effects to descriptor/workspace generation/lease and compare those fields on replay. Trusted base/target and allocation intent must be service/root owned, not re-derived from Agent-writable HEAD or metadata. |
| `runner/internal/daemon/daemon.go:269`; `runner/internal/journal/journal.go:192`; `host/effect_scope.go` | Durable BeginEffect/FinishEffect and effect recovery exist, but equality/scope compare one dispatch resource; enqueue deduplicates per operation ID. Different open requests can still compete at one future workspace. | Retain descriptor equality/digest in journal, validate operation→Task/resource/lease ownership, and serialize both same-resource cache writers and same-Task-resource materializers across distinct operation IDs. Deduplication by request/operation ID alone is insufficient. |
| `apps/server/src/dispatch-queue.ts:checkLocality`, `promoteNext`; `owner-execution.ts:executeOwnerAction` | Runner locality, capacity, same-Task Node serialization, unresolved-operation guards and physical Stop receipt already exist. Continue changes Node to PENDING; it does not itself build context/enqueue a successor. | Reuse these barriers. Add materialization/lease lifetime to eligibility; stopped dirty work must be preserved before release. Leaf 3 supplies the production successor intent and context, not Runner-owned scheduling. |
| `runner/internal/host/finalize.go`, `snapshot.go:Export` | Persisted finalization intent, fixed commit metadata, ancestry checks and operation refs already support replay; export retains private exact result. Both operate on Attempt paths. | Reuse algorithms with Task workspace/generation and activation-start revision. Do not treat private export as a delivery candidate or consider old completion evidence current after a revision/reactivation. |

`task-records.ts:initializeTask` correctly leaves new Tasks without a fixture
resource. Migration 5 already made `tasks.resource_id` nullable; populating it for
new Tasks would hide the missing boundary and reintroduce rejected Task binding.
The missing primitive is a lazy materialization record, not a resource selection
field on Task.

## First-leaf contract proposal

The architecture requires behavior/ownership below; proposed record grouping,
field names, RPC shape and lock implementation still need a leaf design.

1. **Resolve and reserve under canonical admission.** Receipt replay remains ahead
   of fresh eligibility checks. For a new Node open, verify current Task/Node
   activation/fence, current active Project resource and launch path reservation;
   capture repository identity, remote/provider identity, requested base ref and
   separate branch target defaults under the existing configuration barrier.
   Reserve workspace use with the operation, so removal cannot race a queued open.
   Keep Task Project association and actual opened-workspace records; never copy
   the Project resource list onto the Task.

2. **Immutable nonsecret effect descriptor.** Suggested content is operation +
   Task/resource/workspace IDs, Runner/storage/materialization generation, current
   activation/lease attribution, normalized repository/provider identity, and
   the captured first-open ref/branch settings. Subsequent opens use the workspace's
   already-fixed base/target and current activation refresh intent. The descriptor
   is infrastructure authorization for this effect; it is not a new domain object
   defining which repositories a Task may use. Operation recovery and conflict
   comparisons must bind its exact content. Network fetch happens outside the DB
   transaction; resolved base commit is durably recorded before checkout, so a
   moved remote ref after a crash cannot silently rebase that operation.

3. **Credentialed service cache, uncredentialed Node workspace.** Use the exact
   repository's read-only short-lived provider token. The App private key stays
   backend-owned. The Runner service obtains an operation-bound token through its
   existing authenticated control boundary, passes it via environment/inherited
   descriptor to service Git, and discards it. Keep token bytes out of argv,
   remote config, SQLite, operation JSON, logs, errors and execution environment.
   Tokens expire independently of immutable descriptor/retry identity; recovery
   may obtain a new token for the same admitted effect without renewing revoked
   Agent authority. Never reuse a future delivery write token for cache fetch.

4. **Stable workspace and physical ownership.** Backend owns formal identity,
   host pinning, fixed base/target, latest finalized revision and operation/lease
   references. Runner owns path allocation, durable local stages and Git objects.
   Serialize cache mutation by resource and workspace allocation by Task/resource;
   a direct lease also blocks another Node activation for the Task. Persist intent
   before filesystem mutation, validate existing owners/types/modes, and reuse the
   actual lineage after restart. A timeout, released DB claim or absent directory
   alone never authorizes a successor writer or recloning an established workspace.

5. **Per-activation refresh without implicit rebase.** Before an activation first
   opens the resource, fetch the fixed delivery target into the cache and refresh
   workspace remote-tracking refs. Clone/fetch from the cache without hardlinks or
   shared alternates and with exact `safe.directory` scopes. Workspace `origin`
   points to an execution-readable, non-writable cache. Do not reset dirty files,
   move Task HEAD to current remote HEAD, or change base/target after Project edits.
   Return logical workspace ID, local path and bounded root instruction filenames;
   fixed Node protocol instructs reading them before coding.

6. **Stop/recovery before lease handoff.** Reuse whole-cgroup Stop and separate
   system-effect cgroups. Record interrupted private changes before relinquishing
   the direct lease; they are not a finalized Task revision. A later same-Node
   Attempt restores that result under a fresh claim. Completing, invalidating or
   replacing an activation must not orphan its lease/dirty recovery data. The
   first leaf establishes this storage/ownership invariant; leaf 3 applies formal
   Node transitions and the durable continuation scheduler.

7. **Keep inspection explicitly unavailable.** Todo already rejects it in
   `discussion-state.ts:147`. Canonical Task Planner must also reject it without
   entering `host.Inspect`'s fixture path. Existing probe evidence/fixtures may keep
   their explicit compatibility route. Future Stage B inspection can reuse the
   resource resolver/cache but must create service-owned immutable snapshots at a
   finalized Task/default revision with read/traversal permissions, no workspace
   lease/delivery lineage. Do not implement that feature here.

Splitting cache authorization from materialization is possible only if the former
has its own real two-account scoped-fetch/restart test and strict Runner credential
exchange. A generic clone helper or descriptor-only patch is not independently
product-verifiable. Recommend one first leaf with two internal checkpoints, then
separate Start/initial planning and Node execution as above; split it into two
leaves only if concrete sizing shows that native credential testing and workspace
recovery cannot fit one reviewable implementation.

## First-leaf acceptance that current probe evidence does not establish

- Canonical new Project Task with null legacy `resource_id` opens its authorized
  Project repository; unrelated, removed and unreserved resource IDs reject before
  an effect. Removing the fixture cache cannot redirect or break this positive
  case. A Planner cannot open writable workspace or accidentally inspect fixture.
- Read-only GitHub token is repository scoped; unauthorized repository/provider
  identity mismatch, expired token and lost exchange response preserve one effect.
  No provider token exists in command/operation/SQLite/Agent output or workspace
  remotes. Native Node can read/write workspace but cannot mutate cache, read
  service secrets or publish through its cache `origin`.
- Two concurrent Task opens share cache fetch safely but use distinct workspaces;
  two different request IDs for the same activation/resource return one logical
  workspace. A second Node owner cannot receive that direct lease while either
  the first process tree or its system operation remains unresolved.
- Crash at admitted→credential/fetch→base pin→clone→checkout→result acknowledgement
  recovers the same operation/base/workspace. Concurrent cache fetch and changed
  branch/default settings do not substitute another base or target. Tag/commit
  checkout still records a branch delivery destination.
- Backend/Runner restart and a fresh Attempt preserve Task workspace identity and
  old dirty/private recovery state. Storage disappearance/generation mismatch
  reports unavailable recovery; it does not silently recreate an old Task lineage.
- Native two-account test covers inherited permissions, cache refresh and Git
  common directory access; low disk/failed durable stage writes preserve evidence
  and prevent premature acknowledgement. Existing finalization ancestry/ref tests
  remain green after adapting their path inputs.

Reuse DB tests `postgres-configuration.test.ts`, `postgres-dispatch.test.ts`,
`postgres-owner-execution.test.ts`, `postgres-task-records.test.ts` for locks and
history boundaries, plus host `materialization_test.go`, `finalize_test.go`,
`git_test.go`, `stop_test.go`, daemon/journal scope/recovery tests. New deterministic
tests can use a temporary Git server, but the claimed provider/token/OS behavior
needs the actual authorized GitHub repository and Linux service/execution users.
No new permanent service is needed.

## Decisions and risks to resolve in first-leaf design

- **Live acceptance inputs:** root reports the existing host currently has only
  an archived preview Project with no resources or Roles. This is contextual
  information, not a host fact checked by this researcher. Native acceptance must
  configure a fresh task-owned Project/resource/Role via the Owner API and establish
  actual repository read authorization. The existing fixture repository is not a
  fallback. Repository identity/credential availability remains an external input.
- **Git URL/provider policy:** configuration accepts HTTPS/SSH/arbitrary remote
  forms, while App tokens authorize GitHub HTTPS fetch. Decide and document the
  Stage A supported subset and whether an authorized SSH alias is normalized to
  provider HTTPS after identity verification. Unsupported private arbitrary Git
  must surface unavailable, not invoke execution-account SSH agents or guess
  credentials. This does not remove the provider-neutral resource model.
- **Archive/admission semantics:** active resource membership/removal locking is
  specified; whether archiving a Project blocks a fresh open on an existing Task
  needs an explicit product-consistent decision. Defaults edits cannot alter an
  admitted descriptor or established workspace. Fresh authorization checks and
  already-admitted effect recovery must remain distinguishable.
- **Reservation versus lazy discovery:** runner workspace spec requires reserving
  paths before launch and makes newly added resources available on later Attempts.
  Model this as bounded Attempt access/reservation metadata checked together with
  current Project membership, not Task Resource Binding. Current OpenCode
  `external_directory: allow` and native bash are broader than those grants;
  neither metadata nor prompts establish adversarial per-Attempt OS containment.
- **Credential boundary, not sandbox redesign:** module 11 relies on separate
  service/execution identities, service-owned cache/secret storage and process
  supervision. Current adapter allows native shell and normal execution-account
  activity. Preserve that explicit residual boundary; do not claim it prevents
  access to credentials the Owner independently gave that account or add a broad
  shell/global filesystem sandbox as a prerequisite.
- **Read-only cache versus Git refresh:** trusted remote fetch runs as service;
  workspace finalization runs as execution account. Ensure per-resource locks and
  pinned object IDs cross that boundary safely; existing `gitEnv` is deliberately
  fixture-specific and reports raw Git stderr. Credentialed network errors need
  bounded/redacted handling before reuse.
- **Persistent base and recovery ownership:** current trusted base attribution is
  found through prior open operations of the same Attempt. Stable Task workspaces
  require trusted records that survive replacement Attempts and reference the
  correct activation-start revision. An Agent-writable materialization JSON alone
  is insufficient authority; do not weaken the root-retained base checks.
- **Scope size and legacy compatibility:** support one actual repository per
  Stage A Project without replacing collection identities with another singleton
  field. Keep historical dispatch/receipt fixtures readable and explicitly probe
  scoped; new canonical Tasks must never fall back to `fixture.git` or manual
  `tasks.resource_id` updates.

Other package gaps are real, not first-leaf scope: `validatePlan` currently allows
1..256 Nodes and validates only the small internal PlanNode shape; the public
Stage A publication boundary needs a clear one-Node limit/full definition schema.
`commit_task_turn` currently commits a reply plus Stop without durable Task input
or semantic routing tables. `publishPlanningSpecification` deliberately rejects
started Tasks. No production Start/Task-context builder/continuation consumer is
present in these seams. `complete_node` currently requires Git commit/tree even
when no resource was opened, so repository-free completion needs an honest formal
path rather than a synthetic fixture commit. These belong to leaves 2–6 above.
