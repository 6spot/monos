# Research: Specification settlement and Runtime reuse

- Query: Minimal safe implementation of an authorized Specification revision with a sufficient one-Node graph, including settlement, withdrawal, applicability, and native acceptance.
- Scope: internal
- Date: 2026-09-30

## Findings

### Architectural contract

The effective Specification must remain old until settlement and final publication commit. Task and sufficient Plan identities remain stable. No Replan state is justified by a requirement-only change. Source contracts are `docs/02-planner-and-planning.md:414–425`, `docs/06-state-and-formal-data.md:504–539`, `docs/05-tool-protocol.md:336–358`. In particular, admission must persist an operation-owned freeze before external effects; publication validates newer input and relevant evidence facts; an operation must advance its own expected control version without laundering external changes into approval.

`docs/03-runtime-and-execution.md:518–522` distinguishes unfinished retry (same activation) from invalidation/rework (new activation), requires physical writer settlement, and preserves at most one successful completion per activation. `docs/04-workspace-and-git.md:257–271` requires Stop checkpoints and exact Git reconciliation, not discarded private changes. `ARCHITECTURE.md` and module 08 prohibit resident semantic controllers, generic workflow machinery, and natural-language state changes.

### Files and reusable seams

| File | Responsibility and reuse |
| --- | --- |
| `apps/server/src/task-planning-state.ts:61` | `createPlanningIntent` freezes current Specification, roles, Project, guidance and answers. It increments control and changes Task to RUNNING; call only for previously started, not stopped, Tasks. |
| `apps/server/src/task-planning-state.ts:111` | `assertPlanningSource` binds immutable intent, Task pointer, Spec, control and exact planned Attempt. Revocation must retire the pointer/source; never rewrite old context. |
| `apps/server/src/task-planning-state.ts:120` | `stopPlanningAttempt` retains an existing Stop, tombstones queued Start, and uses repository-free trusted Stop. Caller must revoke running mutation authority (helper alone does not). |
| `apps/server/src/task-records.ts:90` | Existing pre-start publication only consumes a content confirmation and inserts a revision; insufficient for new proposal/base/impact/input and settlement contract. |
| `apps/server/src/task-records.ts:102` | `assertCurrentNode` currently demands activation creation Spec = effective Spec; this must become explicit applicability-aware for retained activation. |
| `apps/server/src/task-records.ts:115` | `reactivateSettledNodes` computes descendants, checks prior Attempts/effects, increments activation, clears current result, and binds guidance. Useful only for completed affected work after settlement. It clears blockers, so do not use it indiscriminately on unfinished blocked work. |
| `apps/server/src/node-execution-state.ts:53,85` | Current source validation and immutable fresh-source construction. Fresh source naturally receives new Spec while preserving Node/activation and private workspace ownership. |
| `apps/server/src/node-execution.ts:69,109,155` | Exact completion settlement admission, Stop helper and ordinary Node pump. Reuse physical operations, add change ownership/freeze checks. |
| `apps/server/src/task-guidance.ts:88,315` | Guidance Stop and follow-up pump demonstrate same-activation continuation after prior processes/effects/leases settle. Both pumps must honor change-owned freeze independently. |
| `apps/server/src/node-completion.ts:28,106` | Current semantic completion projection and exact physical completion-pair settlement. Add historical-only disposition for affected admitted completion; do not let stale semantic projection roll back truthful physical settlement. |
| `apps/server/src/service.ts:490` | Runner result transaction updates physical operations/ownership then calls semantic projection; capture failure also mutates Node/Task. Both paths need change ownership awareness. |
| `apps/server/src/dispatch-queue.ts:57,157,180,204` | Source revalidation at enqueue AND start, capacity accounting, prior owner settlement, leases. Place freeze guards at authoritative gates, not only candidate scans. |
| `packages/db/migrations/0018_node_execution.sql:87` | Backend-only settlement purpose is constrained to `correct`/`cancel_task`; add a distinct change purpose rather than triggering automatic correction dispatch. Preserve operation identity immutability. |
| `packages/db/migrations/0019_task_conversation.sql:201` | Terminal guidance dispositions are immutable and handling has exact successful completion/manifest/assignment attribution. New revision must not modify old handled rows. |
| `runner/internal/host/completion_settlement.go:124` | Trusted settlement stops writer, returns exact already-finalized result or cancelled-original pair, journals the pair before release. No requirement semantics reside here. |
| `runner/internal/adapter/opencode.go:49,52` | Existing Node and initial Planner prompts already accept frozen fresh source. No live steering needed. |

### Minimal settlement design

1. Add durable requirement proposal/operation, affected-target snapshot, settlement effect links, and applicability records in a new migration. Freeze must be operation-owned (single admitted publication per Task). Record exact Spec/Plan/control/input watermark, Node activation/source, completion identity/result digest, guidance disposition basis, Owner receipt and any Stop decision. Distinguish pending publication, withdrawing, and terminal receipts using operation status, not new Task states.
2. Admission locks using existing configuration/Runner/Task/Attempt/workspace ordering and rechecks Runner set. Retire pending incompatible planning/Node sources, revoke mutation authority, cancel queued Start, and admit existing Stop or exact `settle_completion`. Persist effect IDs before transport; never overwrite lease `settle_operation_id` or reset recovery state.
3. Ordinary incomplete source without completion uses Stop (dirty checkpoint retained). An admitted Git completion uses trusted paired settlement: integration may already have happened. Add backend-only `specification_change` purpose, or equivalently an exact owning-change link interpreted before automatic continuation. Using `correct` unchanged is wrong: `node-completion.ts:226` creates a new source under the old Spec immediately.
4. Advancement waits for affected process release, all admitted operations terminal, and released leases. Do not infer absence from Attempt CANCELLED, timestamps, silence, or Runner disconnect. Preserve unavailable Runner as pending visible settlement. An idempotent Retry reconciles original identities.
5. In publication transaction revalidate exact approval, current base, operation ownership, newer-input resolution/defer facts, target activation/results and independent Stop/blockers. Insert immutable child Specification, switch pointer, record applicability and formal events, resolve linked change obligation, and create eligible scheduling intents atomically.
6. Release only this operation's freeze. Continue through existing pumps with fresh source and existing capacity/locality barriers. Do not recreate old queued Attempts. Proposal preparation/settlement does not retain the Planner claim; subsequent Task input can be interpreted.

### Required phase distinctions

| Case | Required behavior |
| --- | --- |
| Never started, no Plan | Publish without `createPlanningIntent`; keep PLANNING and no Start/Attempt. |
| Started, initial Planner active/queued | Retire old intent and reconcile Stop; publish then fresh initial intent against new Spec. Exactly one eventual Plan publication; late old proposal rejected. |
| Owner stops initial planning during settlement | Preserve stopped PLANNING; publish may succeed but cannot implicitly Start. Historical Start presence is not permission to resume. |
| Unfinished affected Node | Keep Node and activation, stop/reconcile old Attempt, record activation applicability for new Spec, prepare fresh source only if independent guards permit. Preserve blocker and Owner Stop. |
| Completed affected Node | After settlement, invalidate current result, increment activation using settled reactivation, retain completion/Artifacts/old activation, bind still-active guidance to new activation. Correct integrated code rather than undoing Git history. |
| Completed unaffected Node | Exact carry-forward binds old/new Spec, same Plan/Node/activation and original completion operation/manifest/evidence identity. Keep result and REVIEW when otherwise eligible. Never relabel old completion as produced under new Spec. |
| Unfinished declared-unaffected Node | Existing source/CLI has global Spec/control binding; it cannot silently stay mutation-authorized after publication. Define explicit supported policy in impact: conservatively treat unfinished source as requiring fresh context and disclose this before approval, or implement exact compatibility authority throughout guards. Do not simply weaken source checks. |
| Hard completion underway | Reconcile original pair, retaining any finalized code. If affected, historical physical success must not unlock current evidence or settle new guidance. Distinguish completion-first success invalidated at publication from change-first historical-only success. |
| Withdraw during settlement | Persist withdrawal request; reconcile already-admitted effects; keep old Spec; release only change freeze. Fresh old-basis unfinished Attempt may resume when allowed. Never resurrect old Attempts or consumed acceptance. Real integrated effects remain truthful input. |

### Applicability is a necessary new seam

Changing only `tasks.specification_id` breaks `assertCurrentNode` for both retained unfinished activations and carried completed results. Do NOT update `node_activations.specification_id`, Plan creation Spec, Attempt launch, source context or completion manifest: these are historical facts. Add exact applicability relation rooted in authorized published change. Current activation checks accept creation basis OR a valid effective-Spec applicability record, still requiring current Plan/Node/activation. Fresh source continues to bind exact current Spec. The record for evidence carry-forward must additionally bind completion identity/digest, not just Node ID.

Repeated revisions require explicit linkage to the immediately previous effective basis and currently valid evidence. A carry record cannot resurrect an invalidated activation. A frozen completed-evidence impact becoming stale through guidance/completion must be refreshed; do not silently enlarge affected work or replace evidence identity under old receipt.

Guidance handling remains historical. `task_guidance_obligations` terminal rows cannot be changed back to pending. For completed invalidation, new activation gets fresh pending obligations for still-active guidance via `bindTaskGuidance`; old handled attribution stays intact. For same-activation continuation pending assignments get fresh source bindings; superseded/withdrawn guidance must be omitted without rewriting old assignments. Preserve `guidance_paused` and factual/Owner-answerable blockers independently of change freeze.

### Queue/pump and completion pitfalls

- Node fresh-source pump currently scans PENDING without operation guards; source enqueue/start checks and `prepareNodeSource` must reject change freeze too. A scan filter alone races admission.
- Ordinary Node ended-Attempt path excludes guidance-owned cancellations only (`node-execution.ts:230–245`). Add change-owned classification to prevent interrupted work becoming a fabricated factual Runtime blocker.
- `advanceGuidanceFollowup` can reactivate completed work or create old-basis source while change settlement is pending. Gate it before consuming follow-up responsibility, not by deleting guidance.
- Source retirement alone is insufficient if queued attempts already exist. Queue source checks help but formal cancellation and Start tombstone should be part of admission.
- `projectCompletion` currently bypasses current evidence only for cancelled Task. Add explicit affected change ownership before current-source checks, and preserve exact physical result/manifest/history. A global stale-Spec rejection at Runner result ingestion can strand a released physical lease inside rollback.
- Capture-hard-limit/invalid-finalization result path in service currently sets BLOCKED/control; operation must account for its own settlement progress and not fabricate obsolete current Node state.
- Post-result automatic `refreshTaskState` must not erase Stop/freeze semantics. REVIEW alone does not mean acceptance is allowed; `taskInputGuards` must include pending change obligations independently of processed message status.
- An all-status completed unaffected change needs no workspace operation; still validate no unresolved physical effect and exact immutable completion result before carry-forward.

### Runner changes

No new physical Runner operation, service, resident Planner, or live steering is necessary for this leaf. Existing `stop`, `settle_completion`, fresh `Dispatch` and immutable command recovery are sufficient. `settlement_purpose` is backend DB metadata, not a Runner Operation field; extending its backend union/check does not require Go host semantic changes.

Protocol/schema generation and Planner command exposure/prompt updates may require regenerated Go types/CLI command lists and `opencode.go` guidance when `prepare_specification_revision` is introduced. That is command plumbing, not new Runtime behavior. Preserve v1/v2 historical manifest digests and old operation wire identity.

Cross-activation private checkpoint reuse is explicitly unsupported by current workspace contract; completed invalidation normally uses finalized Task base and new activation, while unfinished interrupted work stays same activation. Do not advance unfinished activation just to bypass applicability. If hard settlement cancellation creates retained private work, keep unfinished activation until corrected unless an explicit new checkpoint disposition is implemented and independently verified.

### Real PostgreSQL acceptance matrix

Run production pumps together; do not test only a bespoke advancement helper.

1. Two clients confirm same exact proposal concurrently: one revision/effect journal, duplicate receipt replay; altered digest, base, impact, input cutoff and target evidence reject atomically.
2. Never-started publication: no Attempts/Start/outbox and PLANNING. Started queued and running initial Planner: old publication loses, fresh new-Spec intent exactly once after Stop; Owner Stop in each ordering prevents restart.
3. Active dirty Node: admission cancels source/Start authority; no replacement before Stop/operations/lease settlement; publish same activation/new source with new Spec. Old source rejects new completion/artifact command; old receipt recovery remains available.
4. Completed affected invalidation vs unaffected exact carry: Node/Plan stable; activation advances only invalidation; original completion and handled guidance immutable; current evidence selector and state derivation use applicability.
5. Completion races change in both orders, including repository-free, ordinary Git, hard cancellation, already-finalized pair, and delayed original result. Never lose physical result or expose affected old completion as new-Spec current evidence.
6. Guidance before admission/during settlement/after completed result: no automatic old-basis continuation, no cleared pause/blocker, no old handled evidence counted for new activation. Guidance withdrawal releases its own obligation only.
7. Withdraw vs publish concurrently: one terminal disposition. Withdrawal before/after Stop and already-finalized completion keeps old Spec but never restores old Attempt/acceptance or lies about integrated code.
8. New Owner message while settling blocks stale publication; later conversation can reply/propose without deadlocking Planner claim. Status-only interpretation/defer must be recorded; never blindly copy latest watermark or control version.
9. Backend SIGKILL before/after effect admission, after physical Stop, before/after publication COMMIT; retained operation IDs and at-most-once revision. Lost Runner remains pending until trusted reconnect, no lease timeout handoff.
10. Direct SQL negative tests for cross-Task/change applicability, wrong completion identity, mutating historical revision/manifest, competing active operations, terminal outcome rewriting and widened receipt basis.

### Native evidence cases

- Fresh public-created Task, Owner exact edit before Start: inspect revision and zero physical Starts; explicit Start initial Planner uses new Spec.
- Fresh Task held in initial Planner; authorized revision causes real Planner cgroup Stop and new source after physical settlement, not mutable launch replacement.
- Git Node writes tracked/untracked private changes through managed workspace. Authorized change stops real process tree, waits lease, starts same activation/new source, proves preserved HEAD/index/files and new Spec context, then exact completion.
- Owner Stop during settlement plus additional chat/guidance: no auto-resume across backend/Runner restart; explicit Continue produces fresh new-Spec source.
- Completed result: exact unaffected carry preserves physical completion/Artifacts; separate affected revision produces new activation and corrects existing integrated tree. Do not use held-for-stop predecessor checker for a finalized predecessor.
- Withdrawal after real Stop preserves old effective Spec and private work; fresh old-basis continuation only when no independent Stop. Retain failed/uncertain native evidence and report unsupported combinations honestly.

## Related specs and external references

Read `.trellis/spec/backend/task-planning.md`, `node-execution.md`, `task-conversation.md`, `dispatch-queue.md`, `workspaces.md`, `.trellis/spec/runner/index.md`, `execution-guidelines.md`, `workspace-guidelines.md`. All recommendations use repository contracts; no external research or new dependency is required. Baseline requested by parent: accepted Conversation commit `609e392`, deployed migration 19; this research did not redeploy or independently revalidate that acceptance.

## Caveats / Not Found

- No changes, tests, git operations or deployment performed by this researcher. Code references inspected in shared checkout; another implementer may advance them after this report.
- Full graph replacement/Replan, delivery revocation/provider mutation, multi-Node execution, cross-Runner transfer and cross-activation private checkpoint disposition remain outside this scoped leaf. Reject graph insufficiency visibly rather than publishing requirements against an inadequate immutable definition.
- Existing pre-start `publishPlanningSpecification` is not a complete implementation of the architecture change contract. Route/retire any public legacy shortcut so it cannot bypass new pending-operation/input/impact guards.
- Runtime behavior reuse is a research conclusion; Linux/native acceptance is still required after command/schema or settlement integration changes.
