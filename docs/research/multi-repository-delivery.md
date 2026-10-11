# Multi-repository execution and delivery: implementation research

Research date: 2026-10-11. Source snapshot: `130eec1`. The local completion and GitHub delivery increment is now implemented; this document retains the initial gap analysis and sequence. Plain Git/mixed delivery remains next. No Trellis task was created; the user declined tracking.

## Implementation status

Multi-repository workspace allocation, aggregate completion/recovery, plural result
reads, per-resource candidates, both GitHub preparation modes, all-item readiness
and durable per-item finality are implemented. The final contracts and scoped
verification are recorded in [completion implementation](multi-repository-completion-contract.md#verification).
The browser exercises deferred two-repository acceptance, partial success and
remaining-item Retry against the actual service/PostgreSQL with synthetic provider
responses. These checks do not claim native or real remote acceptance.

The next increment follows [plain Git and mixed delivery](plain-git-delivery.md).

## Initial implementation sequence

Implement multi-repository execution and GitHub delivery, including both automatic and after-acceptance preparation. Follow with supported plain-Git branch delivery and mixed-provider batches. This follows the ordering in [Stage B](../09-first-executable-slice.md#stage-b-and-v1-completion); both increments remain required by the [V1 release gate](../09-first-executable-slice.md#v1-single-host-release-gate).

The first increment must cover the complete path: lazy workspace access, whole-Node completion and Stop, retained result reads, candidates for every resource, exact acceptance, and truthful partial delivery. Removing the one-repository guards alone would expose incomplete recovery and finalization behavior.

Use the existing Task, Node, Attempt, workspace, operation and delivery-item identities. Keep one Runner, Project-level resources, Agent-driven lazy discovery and Tool Protocol state transitions. Do not add Task resource bindings, a Planner repository-selection gate, new Task lifecycle states, distributed workspace transport or organizational abstractions. These boundaries come from [architecture](../../ARCHITECTURE.md), [Workspace & Git](../04-workspace-and-git.md) and [principles](../08-principles-and-non-goals.md).

## Initial contracts and gaps at `130eec1`

| Boundary | Current implementation | Required extension |
| --- | --- | --- |
| Workspace admission | [workspaces.ts](../../apps/server/src/workspaces.ts) rejects another materialized/live Task resource with `unsupported_multiple_workspaces`; completion selects one lease | Admit multiple resources and collect the complete authoritative lease set under Task control |
| Reservations | [protocol contracts](../../packages/protocol/schemas/v1/contracts.json) already retain `WorkspaceReservations.resources[]`, but isolation/allocation is Attempt-wide | Preserve per-resource allocation provenance, particularly when Replan combines checkpoints from different source allocations |
| Completion and Stop | Protocol `Operation` and `EffectResult` hold scalar workspace, Git and integration identities | One parent completion/settlement with an exact, bounded repository-item array; ordinary Stop can retain one operation per lease under an exact Attempt-wide settlement set |
| Runner effects | [daemon](../../runner/internal/daemon/daemon.go), [workspace effects](../../runner/internal/host/workspace_effect.go) and [completion settlement](../../runner/internal/host/completion_settlement.go) execute/export/release one workspace | Parent journal with per-resource stages and one durable completion decision; ordinary Stop retains Attempt ownership until every lease is settled |
| Current output evidence | [task-review-basis.ts](../../apps/server/src/task-review-basis.ts), [task-result-reads.ts](../../apps/server/src/task-result-reads.ts) and SQL source proofs address one result per completion | Select exact resource items within one parent result, including canonical, conflict, Rework and transfer proofs |
| Candidate discovery | [publication-candidates.ts](../../apps/server/src/publication-candidates.ts), `ensureLocalCandidate`, selects the latest matching completion across the Task with `LIMIT 1` | Discover every current canonical resource head; represent no-change outcomes so omission cannot mean success |
| Acceptance | [owner-delivery-state.ts](../../apps/server/src/owner-delivery-state.ts) derives resources from singular output sources, rejects multiple modified repositories and requires GitHub automatic mode | Freeze complete resource coverage, configured preparation mode and exact source/candidate/target evidence |
| Accepted preparation | [owner-delivery-guards.ts](../../apps/server/src/owner-delivery-guards.ts) rejects deferred mode even for an accepted batch | Distinguish pre-acceptance automatic authority from accepted automatic/deferred authority |
| Delivery progression | [owner-delivery-worker.ts](../../apps/server/src/owner-delivery-worker.ts) chooses the first modified item and immediately calls `completeAcceptedBatch` after its merge | Validate all items before first finalization; persist each success; select unfinished items in resource order; complete only when all are final |
| Finality storage | [0024_owner_delivery.sql](../../packages/db/migrations/0024_owner_delivery.sql) binds finalizations to merge operations and confirmed merged evidence | Retain merge finality for GitHub; add separately typed accepted-branch publication finality for plain Git |
| Repository access | [github.ts](../../apps/server/src/github.ts), [remote-preparation.ts](../../apps/server/src/remote-preparation.ts) and [remote-preparation-access.ts](../../apps/server/src/remote-preparation-access.ts) require GitHub identity/grants | A real provider/transport boundary for supported plain-Git access, credentials, publication and reconciliation |
| Owner controls | [owner-delivery.tsx](../../apps/web/src/features/owner-delivery.tsx) describes zero/one automatic GitHub repository and labels modified acceptance `Accept & Merge` | Per-repository progress, meaningful mixed-mode labels, partial delivery and remaining-item Retry/Cancel |

Several foundations can stay: stable delivery-item uniqueness per `(task_id, resource_id)`, acceptance `repositories[]`, Task completion admission barriers, resource-scoped publication preparation, controlled public candidate ancestry, durable provider polling, accepted input cutoffs and existing preparation-operation attribution.

The current delivery worker has a particularly important trap: after recording a successful merge it invokes `completeAcceptedBatch` in the same transaction. That function rejects unfinished items. Merely permitting a second modified repository would therefore roll back the first success record after the remote merge had already occurred. Item recording and batch completion must be separated before increasing cardinality.

## Proposed local completion contract

The architecture requires a whole local completion boundary before any integration, stable resource-ID locking, per-repository recovery stages, and one formal Node completion after every opened repository settles. The following is a proposed implementation of that contract; field and journal-stage names are provisional.

### Immutable parent and resource items

Keep `open_workspace` singular. For `complete_node`, the backend constructs a resource-sorted array containing each successful held open's full descriptor, descriptor digest and expected canonical Task commit; an empty array represents repository-free completion. The Agent must not choose a subset.

Require unique resource, workspace and lease identities, and exact Task/Attempt/dispatch attribution. The parent owns the summary, Artifact manifest and semantic completion. Resource items are infrastructure effects, not additional Node completions. A parent result carries a complete per-resource result map plus the parent outcome; a top-level Git pair cannot describe it adequately.

Settlement binds the original parent operation and digest, including exact membership. One aggregate completion-cancellation pair settles an already-admitted completion; do not replace that pair with independent ordinary Stops.

Ordinary Stop can remain one operation per lease. Atomically revoke the Attempt and persist the exact set of lease Stops/outbox records, covering every admitted unresolved or held open. Stop the Agent first, retain open-worker Agent-absence/fence checks, and settle each lease's workers under its coordinator. Already-running workers of later resources remain owned until their own Stop; no successor is admitted until the full set settles. A durable Attempt-wide local fence is an optional simplification. Each Stop preserves its own prior-open result, checkpoints initialized work or cancels exact unexposed fresh opens, and may release its lease after physical settlement. Release the Attempt only after process absence, every required operation's terminal result and every lease's release are established. Do not reject a successful Stop merely because a sibling Stop is unresolved: that would deadlock independent settlement. A failed fence/storage write retains unresolved ownership. Rework's scalar `stop_operation_id` must become exact request-to-Stop membership, with each lease's history bound to its own settlement operation. This keeps ordinary Stop small while making completeness an explicit backend contract.

Move reserved allocation provenance to each resource where needed. Today's single Attempt-level allocation can represent several opens from the same allocation, but cannot represent Replan transferring repository A from allocation X and repository B from allocation Y into one replacement Node. A target may receive one private checkpoint per resource, while preserving each source identity. Retain the conservative Task-wide exclusion rule whenever any direct workspace path is inherited or live. Do not substitute one source allocation for another to fit the current schema.

### One durable publish decision

Extend the Runner parent journal with progress keyed by resource identity:

1. Admit the exact parent manifest and stop/prove absence of writers.
2. Capture every initialized workspace and protect/export every captured result.
3. Prepare all repository integrations under the reserved completion boundary.
4. Persist one durable decision: publish, conflict or cancel.
5. For publish, apply/reconcile each prepared canonical-ref compare-and-set in resource order and finish required exports.
6. Return one aggregate terminal result after the full physical manifest succeeds; commit all canonical backend pointers, one Node completion and backend lease/Attempt release in the same database transaction.

This requires splitting preparation/merge calculation from publication in [workspace_integration.go](../../runner/internal/host/workspace_integration.go) and [workspace_integration_effect.go](../../runner/internal/host/workspace_integration_effect.go). Repository/allocation locks follow stable resource order. The root decision/cancellation lock must not span Git or network waits; database transactions must not span Runner RPC or Git either.

If any integration conflicts before the publish decision, no canonical Task result is advanced. Preserve every repository's captured Node commit/tree and original start, including otherwise clean prepared items. Those items are not yet integrated. A fresh Attempt on the same activation receives the complete correction basis and cannot complete while required preserved work remains unreconciled.

A direct workspace may move its exclusively owned local worktree HEAD while capturing a result; this is capture evidence, not authority to publish the parent, advance canonical backend pointers or release ownership early.

Completion admits only successful initialized opens. Before its durable publish decision, Cancel checkpoints every member. After the decision, Cancel/restart must finish or reconcile all authorized publications, even when no ref has moved yet. Do not roll back published refs or checkpoint-cancel the remaining items. Unexpected revisions or unrecoverable I/O leave the parent in recovery with ownership retained. Partial physical publication blocks review and further Task workspace use until reconciled.

Persist the active resource/action before launching a worker. One parent systemd worker unit can be reused sequentially after settling its prior invocation; no child domain operation IDs are needed. Recovery follows recorded refs and per-item stages, never a loop index. Stop must discover and settle the exact active worker before handoff. The existing Stop-before-first-open distinction remains necessary for every item: fresh unexposed work without inherited checkpoint state can cancel without reading nonexistent history; initialized, direct or inherited work must preserve/reconcile its history.

### Retained results and limits

Namespace exports by parent and resource, for example `service/node-results/<operation_id>/<resource_id>` and `results/<operation_id>/<resource_id>`. Current operation-only export paths would collide. Reuse `(parent_operation_id, resource_id)` with the existing resource/workspace fields in `ResultReadIdentity`; validate the selected item against its parent digest, materialization and exact OIDs. Owner reads must identify the resource explicitly.

Update review evidence, canonical/conflict source proofs, Rework, Replan transfer inventory and publication source verification to select the matching resource item. Prepared-only or conflicting items never become current completed output or delivery evidence. One completed Node can contribute several resource results while retaining one summary and Artifact manifest.

Cardinality is not the only bound. The wire currently has a 1 MiB envelope limit, the workspace worker reply is bounded at 64 KiB, reservations allow 128 resources, and acceptance allows 64 repositories plus its own response-byte budget. Descriptor history can make a small resource count large. Define a supported whole-flow resource limit and preflight prospective completion/aggregate-settlement encoding on each new open admission, before allocating another lease; ordinary per-lease Stop envelopes remain independently bounded. Successful opens must not create an Attempt that can no longer stop, complete or reach review because its manifest cannot fit. Keep single-resource worker replies bounded; measure aggregate envelopes, avoid duplicating the full parent in completion settlement, and reject excess admission explicitly. Raising the global wire limit alone is insufficient.

## Candidate coverage and accepted delivery batches

Build one current source/candidate outcome per resource from authoritative canonical results. A later completion touching repository B must not hide repository A. Include no-change evidence for opened repositories; create a delivery item only for an actual modified result. Repository-free and all-no-change work retain exact local Owner acceptance without a nonexistent PR.

Acceptance freezes Specification/Plan, current activations and Artifacts, complete repository coverage, source trees, candidate heads/parents, targets, configured preparation modes and the input cutoff. Candidates exist locally in both preparation modes. Keep public ancestry controlled and preserve exact tree equality; do not publish internal Agent or completion commits.

The existing [owner preparation code](../../apps/server/src/owner-delivery-preparation.ts) already iterates accepted items and attributes reusable preparation operations. Extend it together with the frozen-mode guards. Keep the ordinary pre-acceptance guard in [remote-preparation-guards.ts](../../apps/server/src/remote-preparation-guards.ts): after-acceptance mode must still prohibit early remote writes.

Use separate durable per-item readiness/progress, plus a batch decision that establishes all applicable prerequisites before the first finalization. GitHub items need prepared exact-head PRs, permitted merge method, checks, mergeability and authorization. Later finalizations recheck their applicable provider conditions; an earlier all-item check does not promise atomicity against remote changes.

Finalize in stable resource order. Record each confirmed success immediately and independently of whether another item is pending. Select the next unfinished accepted item, preserve successes through retries/restarts, and mark the Task `COMPLETED` only when every modified item has final proof. A later failure keeps `REVIEW` and displays completed versus remaining items.

An uncertain effect must be reconciled before retry or correction. Request Changes may revoke only a wholly undelivered batch under the existing unresolved-effect guards. Once any item finalizes, the accepted remainder cannot be reopened for in-place changes. Cancel reconciles remote truth, closes undelivered PRs and keeps branches; it never compensates for a completed merge. Later chat remains outside the frozen input cutoff and cannot block preparation, checks, Retry or finalization.

## Plain-Git increment and delivery modes

| Repository and preparation | Before acceptance | Exact acceptance and finality |
| --- | --- | --- |
| GitHub automatic | Prepare/push candidate and open/update PR in `REVIEW` | Freeze the batch; finalize on confirmed expected-head merge |
| GitHub after acceptance | Construct and inspect candidate locally | Freeze the batch, then push/create PR/check/merge; finalize on confirmed expected-head merge |
| Plain Git automatic | Publish verified candidate branch in `REVIEW`; it remains correctable | Finalize only after exact Owner acceptance and verified candidate publication are both recorded |
| Plain Git after acceptance | Construct and inspect candidate locally | `Accept & publish branch`; finalize after exact accepted head is verified on the delivery branch |
| No-change or non-Git | Show local outputs and evidence | Exact Owner acceptance completes locally without PR or branch delivery |

Plain Git does not mean merging the target branch. A preparation push is not finality. A mixed batch uses the same all-item prerequisite check, stable ordering and partial-delivery rules, with provider-appropriate final proof for each item. A previously prepared plain-Git branch must not become final during acceptance before prerequisites for the entire batch have been validated.

URL normalization in [repositories.ts](../../packages/domain/src/repositories.ts) already accepts non-GitHub HTTPS/SSH remotes, but that is configuration capability, not working delivery. Actual checkout, credential issuance, permission proof, push requests and finality are GitHub-specific. Introduce a bounded provider/transport interface covering:

- canonical repository identity, supported remote scheme and recorded base/target resolution;
- service-owned read/write authentication and scope/configuration proof;
- branch push with expected-ref/lineage constraints and exact remote-ref reconciliation;
- provider facts and hard limits, with optional PR/check/expected-head merge capabilities.

Keep GitHub installation grants and permission/workflow semantics in its adapter. The common scan can be reused, but [publication-policy.ts](../../apps/server/src/publication-policy.ts)'s GitHub blob/workflow policy must not silently define every Git host. Preserve no-force-push behavior, controlled delivery refs and unknown-outcome reconciliation. Do not inherit Agent credentials or arbitrary credential-helper configuration to make generic remotes work.

The protocol needs discriminated provider authentication/permission requests and accepted repository/finality evidence. SQL needs exact accepted-branch publication authority alongside existing merge authority, rather than a fictitious merge row. Both proofs must bind the immutable accepted item, operation identity, exact head and verified repository/ref.

Before implementing this slice, choose and document the first supported plain-Git transport and service credential provisioning path. HTTPS with a service credential and SSH with host-key/identity management are different deliverables; the current code does not justify claiming either works. The choice need not block multi-repository GitHub execution. Broader provider support and repository-picker polish can follow separately.

## Implementation ownership and order

The integrator owns shared protocol schema/generated outputs, the migration contract and final integration. Resolve item membership, per-resource reservation identity, parent settlement and finality shapes before dependent code. With four concurrent agent slots including the main session, use bounded waves:

| Wave | Independent ownership after shared contracts settle | Integration condition |
| --- | --- | --- |
| 1: local execution | Worker A: backend workspace/completion admission and DB authority. Worker B: Runner journal, integration, Stop, exports and recovery. Worker C: current-result/read/provenance changes | One parent result and settlement contract agrees across TypeScript, SQL and Go; Replan/Rework retain each resource's identity |
| 2: GitHub delivery | Worker A: candidate coverage and exact acceptance. Worker B: batch preparation/finalization/Retry/Cancel. Worker C: Owner read/UI progress and mode controls | Read/UI work consumes a settled read model; avoid overlapping owner-delivery state/guard files between workers |
| 3: plain Git | Provider/transport and credential owner; branch-finality/DB owner; mixed-mode UI/acceptance owner | Integrator first freezes discriminated provider/finality schema; use additional subwaves for files shared with GitHub delivery |

Ownership refers to non-overlapping file sets agreed at dispatch, not permission to edit every file in a named layer. Review can run against a stable slice while the integrator handles another; no worker independently regenerates shared contracts or commits integration work.

## Acceptance and evidence plan

| Area | Required observable cases |
| --- | --- |
| Admission and limits | Two or more lazy resource opens; Task-wide direct exclusion retained; duplicate identities rejected; per-resource inherited allocations preserved; prospective aggregate overflow rejected before lease admission |
| Local completion | Multiple repositories succeed as one Node; second-repository conflict advances no canonical Task result; all captures remain available; no child completion or premature dependent dispatch |
| Crash and cancellation | Faults after capture/export/prepare and each ref publication; Cancel before and after durable publish decision; restart finishes the exact parent; mixed fresh/initialized ordinary Stops settle independently without releasing the Attempt early; admitted completion retains aggregate settlement |
| Authority | Omitted/duplicate/reordered/substituted completion or settlement items rejected as specified by canonical ordering; stale parent/lease/materialization rejected; canonical/conflict/Rework/Replan SQL proofs select exact resources |
| Reads and candidates | Distinct per-resource exports/read identities; later single-resource completion does not hide another resource; prepared/conflict evidence excluded; mixed modified/no-change coverage complete |
| GitHub modes | Automatic and after-acceptance preparation; deferred mode makes no early remote write; all-item readiness before first merge; exact-head conditions rechecked; browser-independent progress |
| Partial delivery | First success persists when a later item fails; remaining-only Retry after backend restart; uncertain merge reconciles without duplicate effect; Cancel preserves remote truth; finalized batch cannot enter Request Changes |
| Input cutoff | Later conversation and unavailable Planner do not stop accepted preparation/Retry/finalization, including partial delivery; explicit correction retains existing guards |
| Plain Git and mixed batches | Preparation push remains correctable; exact acceptance plus verified branch publication is finality; no target merge claim; mixed GitHub/plain-Git failure retries only accepted unfinished items |

Use schema/generation and consumer checks for wire changes, real PostgreSQL tests for authority/locking, and Runner Git/process fault tests for local recovery. The release claim additionally needs the actual supported Linux/CLI/provider scenarios on persistent storage, including restart and uncertain remote outcomes. Fake results or unit tests cannot establish that evidence.

The initial research was documentation-only. Implementation and current verification are now recorded above; the historical gap table is not a description of the completed increment. Native acceptance, real remote effects and deployment remain deferred.
