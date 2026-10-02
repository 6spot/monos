# Replan Runner phase and retained workspace research

Scope: research only, 2026-10-01. Baseline is accepted Specification changes `f4114bf`, archive `1751565`, journal `aa4c91f`. No product, generated schema, host, service or accepted REVIEW Task was changed. The accepted Task beginning `89effbce` must remain idle; create fresh acceptance Tasks later.

## Owning contracts and key conclusions

Read current PRD; docs/02:321–358; docs/05 `request_replan`, terminal handoff and authorization sections; docs/04 direct-workspace ownership/recovery; docs/03 phase outcome contract.

- Replan requests freeze **new Node dispatch**, tombstone queued Nodes, and wait for running independent Nodes to finish or explicit Owner Stop. Request creation alone cannot kill every running Node. A requesting Node's own `request_replan` is terminal and must revoke/Stop that requester atomically; a frozen already-authorized requirement change can independently mandate incompatible-work Stop.
- Replan generation begins after relevant writers/effects/leases settle. It is an on-demand Task Planner Attempt sharing `planner:<task>` with conversation and initial planning. Waiting for confirmation does not hold its process/claim.
- `prepare_replan` is a terminal **Replan-generation** phase outcome (docs/03:532). This differs from nonterminal `prepare_specification_revision` in a canonical Conversation turn. Owner publication consumes exact graph/basis authorization without relaunching the original Planner.
- Changed goal, Role, dependencies, hard requirements, consumes or expected outputs require a new Node ID. Retaining an identical Node does not automatically carry its completion evidence across a new Spec/Plan.
- Cross-Node reuse of **unfinished** direct private work is explicitly denied by both backend and Host today. A scoped, immutable disposition is required; deleting one guard is not a complete implementation. Completed/finalized reuse already has a physical path that allows different Node identity.

## Minimal Runner/source integration

Proposed name `task_replan_source` is a design suggestion, not an existing contract. Give a Replan Attempt a distinct mutually exclusive canonical source: request/source identity, exact Task/effective or joint Spec, old Plan/control, request version and immutable context digest; keep any formal event cutoff as provenance rather than conflating it with control CAS. Dispatch should remain `kind=planner`, Task-only, no Node/Todo/resource ID, empty canonical workspace reservations, and a scratch-only read-only Planner environment. No new Runtime kind, resident service or generic scheduler is needed.

Affected existing seams:

| File | Required consideration |
| --- | --- |
| `packages/protocol/schemas/v1/contracts.json` | New source and strict command payload/outcome/read schema; mutual-exclusion checks with Todo/initial/Conversation/Node. Preserve schema-v1 stored operation meanings and optional absent fields. |
| `apps/server/src/dispatch-queue.ts:19,52,70,95,170` | Queue input, persisted source pointer, admission and promotion currently know three Task sources; non-Conversation admission requires RUNNING and `assertSpecificationUnfrozen`. A Replan source needs narrowly authorized REPLAN_REQUIRED eligibility and its own freeze-owner exception, not blanket bypass. |
| `apps/server/src/task-planning.ts`, `task-planning-state.ts` | Reuse target selection, Task Planner owner/capacity, immutable source and repository-free Stop patterns. Do not send Replan through `publishInitialPlan`, which requires RUNNING with no Plan. |
| `runner/internal/wire/scope.go:17` | Count/validate new source; reject source combinations, wrong Task/kind/version and resource reservations. |
| `runner/internal/local/socket.go:135` | Source-specific command exposure. Canonical Node allowlist must explicitly admit terminal `request_replan`; Replan Planner gets only its phase reads/prepare/issue tools. Initial, Todo, legacy and reply-only Conversation cannot acquire these implicitly. |
| `runner/internal/wire/wire.go:Envelope` and `runner/cmd/monos/main.go` | Add exact payload members and help; source/request/basis IDs remain immutable through journal retry. |
| `runner/internal/adapter/opencode.go:fixedProtocol`, adapter phase tests | Require one actual `prepare_replan` or source-bound planning issue, tell Planner not to execute work or wait for Owner confirmation. Printed plans are not outcomes; no live steering or provider-session continuity claim. |
| `runner/internal/daemon/recovery.go:46–76` and Host scope validation | Add exact source-bound repository-free Stop recovery for Replan; retain same bounded reconnect queue and original immutable operation. Unknown, altered or missing retained source must fail closed. |
| Backend missing-outcome/Stop paths in `service.ts`, planning/Node pumps | Prepared Replan is formally successful before process release; subsequent exit must not trigger fallback. Dismissed/request-owned cancellation must not fabricate Runtime failure or re-enqueue the dismissed request. |

A Node request should persist the request/freeze, requester blocker, command receipt and its existing `stop` effect together. A later new completion/artifact/request must fail while original receipt recovery remains available. Other running Nodes keep their existing authority until actual completion or explicit Stop; shared capacity is retained until physical release.

For Planner-originated `request_replan`, the design must state its phase precisely. A dedicated feedback-routing source can commit that routing as its terminal outcome. A canonical Conversation cannot silently leave its input without a reply/resolution: use one atomic reply+routing handoff, or explicitly define nonterminal request preparation followed by the existing `commit_task_turn` outcome. Do not accidentally combine a standalone terminal request and a second terminal Conversation commit. The next design should resolve the exact public shape rather than inferring it from `prepare_specification_revision`.

## Workspace handoff: exact current barriers

`apps/server/src/workspaces.ts:73–108` reserves the stable `workspaceId(task,resource)`, locks Task workspace and live lease, and checks the latest released lease. At line 89 it rejects an interrupted checkpoint if predecessor Node or activation differs. Lease identity is `(workspace_id, task_id, node_id, node_activation, attempt_id, dispatch_id, generation, open_operation_id)`; previous `checkpoint` and `settle_operation_id` remain historical. New descriptors carry fixed `basis` and new Node/activation/lease/open identities.

`runner/internal/host/workspace_effect.go:283–339` loads the root-owned `workspaceRecord` and `reuseWorkspaceRecord`. It checks same storage/Task/resource/generation/Runner/Project, old lease released, identical initialized resource snapshot and exact base/target/finalized/provider basis. At line 326, a non-null `PrivateCheckpoint` with changed Node/activation is independently denied. Never clear `PrivateCheckpoint` or rewrite the old Node to evade this.

`runner/internal/host/workspace_git.go:18` stores the root-owned operation, metadata, Released flag and PrivateCheckpoint. `verifyRetainedWorkspace` (:386–410) checks checkpoint ref/commit, exact HEAD and private tree before reuse. `checkpoint` (:429) captures through a temporary index and operation-specific ref, preserving the actual HEAD/index/files. `reuseWorkspaceRecord` advances to `refresh_intent` rather than recloning/resetting the directory. Normal fresh target fetch can update remote-tracking refs; that does not authorize changing the fixed base/target or private work.

### Proposed smallest safe unfinished cross-Node disposition

Reuse the existing `open_workspace` operation, but extend its immutable descriptor with an optional system-authored transfer/disposition reference. This is not an Agent-authored checkpoint or caller-supplied authority hint. Its exact schema should bind:

- accepted Replan publication/confirmation (and joint requirement publication where applicable), old/new Plan and target new Node/activation;
- same Task/resource/workspace/storage/generation;
- predecessor Node/activation/Attempt/lease and successful Stop or paired completion-settlement operation;
- exact retained checkpoint operation/commit/tree/HEAD plus fixed finalized/base/target lineage;
- explicit disposition: this replacement inherits these unfinished private bytes as **historical corrective input**, not completed evidence.

Backend writes the disposition under the quiescent publication transaction, checks it against the latest predecessor lease/checkpoint before admitting new open, and includes it only for the authorized target. Host independently verifies the root record is released and matches the predecessor/checkpoint/lineage, and the descriptor target matches the attributed new Attempt. Only then can it replace the current root operation with the new lease while retaining the private checkpoint and actual directory. Persist/validate this through normal immutable operation digest and replay; no extra permanent service is needed. A changed descriptor under the same lease must still fail. Keep absence of this optional field's historical behavior unchanged.

After handoff, a failed new open/Stop must recover the **new** original operation; it must not transfer the prior checkpoint again to an unrelated Node. Existing previous lease/Stop/ref/manifest rows stay immutable. Stale, cross-Task/resource/Node/activation, changed checkpoint, live writer, hard recovery or missing root marker must reject. Passing DB constraints alone does not establish physical permission.

### Completed result and retained Node variants

Completion clears Host `PrivateCheckpoint` and persists finalized Task HEAD. A different new Node can already open that same Task/resource workspace with a new lease and exact fixed lineage; validate it as finalized input, without asserting pre-finalization HEAD/index equality. New Node activation starts at 1, and old completion/Artifacts remain historical. New Node must execute and produce its own completion; old success does not complete it.

For an unchanged retained Node ID in a new Plan, `assertCurrentNode` in `task-records.ts:102` currently requires activation creation `plan_id == tasks.plan_id`. Specification applicability alone does not solve this. Add explicit Plan/activation/evidence applicability or equivalent authorized relation; never overwrite `node_activations.plan_id`, old Plan membership, old source launch or old manifest. `prepareNodeSource` freezes the new current Plan and Role instructions for a **fresh** Attempt. Its historical Artifact query currently restricts to the current Node/activation; a replacement's explicit old-Node outputs need a bounded provenance-linked historical context addition.

The shared `task_publication_slots` seam is currently FK-bound to `requirement_changes` (migration20). It cannot directly reference a Replan operation today. Evolve the concrete shared publication owner safely so standalone and joint publication acquire one slot; do not create a competing Replan freeze beside it. This is backend orchestration, not Runner scheduling.

## Native acceptance: smallest complete chain

Use fresh Tasks, pinned deployed build/driver hashes and actual bundled `monos` under the execution identity. Preserve every failed observer/CLI attempt and immutable request ID.

1. **Node terminal request and physical handoff:** old Node opens managed workspace and writes tracked staged/unstaged, untracked/private content with detached/private Git history. It calls actual `request_replan`; bind raw canonical request/digest to daemon journal and receipt. Verify one request, requester BLOCKED, old mutation fenced, exact original Stop, descendants absent and checkpoint ref/tree/HEAD preserved. No new Planner/Node work may bypass the unsettled claim/lease.
2. **Dedicated native Planner phase:** after quiescence, one scratch-only Replan source/Attempt under `planner:<task>` receives the current Spec, old graph, explicit reason/source inputs, current formal results and private-work disposition. Native `prepare_replan` commits a full one-Node replacement proposal and ends that Attempt; waiting Owner confirmation does not hold it. Verify exact source/context/prompt digest, proposal content, terminal receipt, Stop and single Start.
3. **Owner exact publication:** confirm the displayed complete graph, summary/basis and retained-private-work disposition (joint Spec content/impact too if changed). Verify original confirmation and admission request bytes/receipts, one publication, atomic Task pointers, new Node identity for changed definition, immutable old definitions/activations/completion and closed shared slot. Old requests cannot publish after dismissal/new basis.
4. **New Node explicit private inheritance:** exact new dispatch/source/current graph, one Start and new lease; descriptor disposition/root checkpoint/old lease identities match. Inspect actual pre-open and reopened HEAD/index/file fingerprint and fixed lineage; check backend and Host guards reject unapproved cross-Node access. Complete through actual CLI and compare manifest Node/activation/new Plan/current Spec to operation/result and actual finalized/service-export Git tree.
5. **Completed predecessor separately:** same result tree and finalized ancestry are reopened by a replacement Node without claiming unchanged old private HEAD. Exact old completion remains historical; new completion has its own Node/source/manifest.
6. **Dismissal/issue exit and restart:** dismiss while Planner pending/running and verify its original Stop/revocation, no late proposal/issue commit, no new Plan/Spec, only request-owned blocker lifted after settlement. Preserve independent Owner Stop and source feedback/change obligation. Idle restart compares all canonical authority records/receipts/Git and original physical identities. If late exit telemetry arrives, bind only exact contiguous log/event identity/digest to the known projection delta; retain original failed evidence.

## Existing driver reuse and limits

- `workspace_driver.py` supplies original held private-work fixture and fingerprint/checkpoint expectations.
- `task_specification_driver.py` accepts only `workspace-driver.json` or another Specification-driver predecessor with `stage=held_for_stop`, verifies Task/resource/Attempt and actual fingerprint/fixed lineage. It has no backend authority and no new-Node disposition verification. It cannot by itself prove authorized cross-Node inheritance. A Replan driver must additionally bind old/new Node/Plan/activation through independently recorded canonical/native evidence.
- It is unsuitable for a **completed** predecessor: successful finalization legitimately changes HEAD/index. Do not reuse its held-only equality test by weakening the required stage. Build a separate completed-result comparison of finalized tree/base and new lease.
- Old `git_receipts_bound` in `node_execution_probe.py` assumes exactly three native Attempts and two completion Attempts; it cannot be blindly reused for the new count. Reuse its per-request digest/journal comparisons with explicit phase-specific expected membership.
- The latest Specification probe validates actual prepare/attached reply and publication/authorization chains but has no Replan source/phase or cross-Node disposition. Its records need new Replan tables and exact Plan applicability/transfer records, and its acceptance must not reuse Agent-declared Spec/Node IDs as authority.

## Generated Go enum risk and verification plan

Quicktype can rename existing constants when new schemas reuse `state`/`admitted`/`recovery`, although wire strings are unchanged. Latest accepted correction mapped `StateAdmitted` → `FluffyAdmitted`, `Recovery` → `PurpleRecovery` for `OperationState` across eight Runner files/11 references. A prior Linux v1 failed after later generation; earlier local success was not current evidence. Regenerate once after final schema changes and immediately compile **all** consumers, then run full local/Linux `go test -race ./...`, vet and all four CGO executables from the identical frozen generated/source snapshot. Preserve failed build directories and use fresh successful destinations; never mix binaries after a partial build.

Tests needed in addition to backend race/crash checks: new source mutual exclusion and wrong-phase commands, exact terminal handoff versus nonterminal Conversation behavior, immutable retry after changed graph/input file, dismissed-source late outcome, repository-free Stop reconnect, missing/forged/stale transfer descriptor and root marker, changed old Node/activation/checkpoint/lineage, real two-account unfinished and completed new-Node reuse, and failed lease recovery. This research ran no tests or host actions.

## Converged design review

Read the newly expanded PRD/design/implement documents. The selected request-first, quiescent joint flow is consistent with this research and the bounded leaf. Node terminal `request_replan`, Conversation's single `commit_task_turn` Replan routing, and dedicated terminal `prepare_replan` avoid competing outcomes. The two exact Owner approvals plus atomic joint publication preserve the standalone sufficient-Spec contract. No further architecture blocker found; no implementation performed.

Three concrete implementation details should be included in the protocol/test contract:

1. Existing `raise_planning_issue` requires `planning_intent_id`. Replan needs a strict source-discriminated issue payload and exact source/request validation; it must not fabricate an initial-planning intent. Test source confusion in both directions, late issue after dismissal, and reconnect Stop with unchanged Replan source.
2. Private-work transfer tests must include failure after new lease admission, new-owner Stop/checkpoint, and subsequent same-target retry. The initial disposition must not become a reusable grant to a third Node or unrelated activation. Root record and new immutable lease identity remain authoritative after accepted transfer; third-party inheritance requires a fresh exact publication/disposition.
3. Dismissal or joint-Spec withdrawal intentionally leaves independent obligations. Bounded reads must name the remaining concrete Owner exit (for example exact requirement withdrawal), including when its linked graph is no longer publishable. Verify request-only blocker clearance never clears independent Owner Stop/guidance or resurrects an old Attempt.
