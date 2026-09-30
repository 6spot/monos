# Research: Canonical Task guidance on the fixed native Runner

- Query: Determine the smallest honest guidance follow-up contract using the existing native CLI, including source injection, Node/activation obligations, delivery provenance, completion handling and hard-completion recovery.
- Scope: internal; Runner/protocol/backend seams and a proposed native acceptance plan. Research only.
- Date: 2026-09-30
- Active task: `.trellis/tasks/09-30-a-task-conversation`, supplied by the parent. Output owned only in this file; no task pointer lookup, product changes, git operations or service actions.

## Findings

### Recommended supported behavior

Stage A should support durable guidance followed by **controlled Stop and a fresh Attempt**. Preserve the Node, activation and managed workspace while unfinished work continues. Do not add live provider steering or native session resume: neither exists in the current Adapter invocation. Planner's committed in-scope routing authorizes automatic continuation of otherwise running work; it cannot override explicit Owner Stop, an unrelated semantic/factual blocker, terminal Task state, or an accepted delivery cutoff.

Completion handling needs no new Agent acknowledgement command. Extend the existing `complete_node.handled_guidance_ids` placeholder, bind its declarations into the immutable completion manifest, and close only attributable obligations after physical completion succeeds. Launch delivery and semantic handling are different persisted facts.

### Architectural contracts and source anchors

| Source | Contract / existing seam |
| --- | --- |
| `docs/02-planner-and-planning.md:404` | Initial planning, Task Conversation, guidance and later change/review share one Task Planner owner claim. |
| `docs/02-planner-and-planning.md:406` | Conversation before Start, while stopped and on terminal Tasks cannot implicitly start, continue or reopen execution. |
| `docs/02-planner-and-planning.md:431` | Guidance has source, intended Nodes, applicability and supersession; delivery is not implementation. |
| `docs/02-planner-and-planning.md:437` | Reply-only commits use captured source/observation; action routing also checks current affected facts. |
| `docs/02-planner-and-planning.md:443` | Answering a blocker does not authorize Retry/Continue. |
| `docs/02-planner-and-planning.md:445` | Pre-Plan guidance remains Task-scoped; completed-work correction uses authorized invalidation. |
| `docs/03-runtime-and-execution.md:562` | Every Attempt retains exact launch input/guidance provenance and context fingerprint. |
| `docs/03-runtime-and-execution.md:564` | Per-recipient Attempt/generation/dispatch delivery facts; no Task-wide delivered flag. |
| `docs/03-runtime-and-execution.md:566` | Stage A controlled follow-up, same Node/workspace, Owner Stop precedence. |
| `docs/03-runtime-and-execution.md:576` | Completion declares handled guidance; backend verifies attribution, not semantic correctness. |
| `docs/03-runtime-and-execution.md:578` | Routing/completion serialize on activation; post-admission guidance cannot join an already frozen completion. |
| `docs/03-runtime-and-execution.md:582` | Missing required launch guidance rejects completion; unresolved later input gets durable follow-up or Planner re-evaluation. |
| `docs/06-state-and-formal-data.md:531` | Each operation owns its guard; resolving one cannot clear independent blockers. |
| `docs/06-state-and-formal-data.md:539` | Obligations separate from receipts; invalidated handling evidence cannot remain current. |
| `runner/internal/adapter/opencode.go:194` | A fixed one-shot native invocation; stdin is a `strings.Reader` over frozen Dispatch prompt. |
| `runner/internal/adapter/opencode.go:227` | `run --pure --auto --format json --model ... --agent monos-probe --dir ...`; no session/steering flag. |
| `runner/internal/daemon/daemon.go:248` | Start journal persists original Dispatch before Host launch. |
| `runner/internal/daemon/daemon.go:262` | `started` reports supervised launch, even if the process is already absent when first inspected. |
| `runner/internal/local/socket.go:133` | Phase-specific command allowlists and fixed launch `control_version` in prepared envelopes. |
| `runner/internal/wire/scope.go:12` | Strict source identity and scope checks. |
| `apps/server/src/node-execution-state.ts:83` | `prepareNodeSource` freezes formal inputs/current Role/Project/reservations into context/prompt/digest. |
| `apps/server/src/node-execution-state.ts:51` | Node source currently checks global Task control version. |
| `apps/server/src/node-execution.ts:109` | Existing Stop helper preserves admitted completion instead of creating competing Stop. |
| `apps/server/src/node-execution.ts:437` | Owner Retry/Continue preserve activation, require exact blocker, prepare a new source. |
| `apps/server/src/artifacts.ts:123` | Completion manifest freezing before mutation fencing. |
| `apps/server/src/node-completion.ts:25` | Physical success projects current completion; cancellation retains historical settlement only. |
| `apps/server/src/node-completion.ts:208` | Hard-settlement pair distinguishes already-finalized success from cancellation and fresh correction. |
| `apps/server/src/task-records.ts:113` | Settled reactivation primitive advances activation while retaining immutable history. |
| `apps/server/src/dispatch-queue.ts:159` | Existing owner/workspace physical barriers and overly broad Task workspace exclusion. |

Related specs read: `.trellis/spec/runner/index.md`, `execution-guidelines.md`, `workspace-guidelines.md`; `.trellis/spec/backend/node-execution.md`; `.trellis/spec/protocol/commands.md`. Architecture remains controlling where the current implementation lacks conversation features.

### Current native capabilities: what can be claimed

The Adapter passes `d.Prompt` once through stdin (`opencode.go:210`) and creates separate Attempt XDG/scratch paths (`:85-86`). No persistent provider-input channel, native turn handle, session ID reuse, live-delivery RPC or provider acknowledgement is implemented. Current code searches did not find a negotiated resume/steering feature that would authorize those claims. Do not infer support because OpenCode itself may offer other modes.

Retain the current command, model preflight, process isolation and filesystem supervision. Guidance requires a new canonical source/Attempt, not writing to old stdin, replaying a previous provider session, editing an old prompt on disk or starting a sidecar service. No new fixed transport feature needs to be advertised merely to perform ordinary Stop/Start with updated context.

An existing `started` event means the supervised wrapper launched; the native model may subsequently fail preflight before consuming the prompt. Therefore a delivery read can truthfully report `included_in_launch` and `launch_started`, backed by source/Dispatch and event provenance. If UI calls this `delivered`, its explicit method must be `launch_context` with acknowledgement `supervised_launch`; never label it provider consumption, understanding or implementation. Failed/unknown launch retains the obligation. Backend response to message submission is only `received`, not Node delivery.

### Minimal immutable guidance/source data

Backend owns three separate facts:

1. **Guidance record:** immutable guidance ID, Task, source input/turn/reply, bounded instruction text/digest, applicability, active-for-future-Attempts policy and supersession history. Do not mutate Project/Role/Specification from guidance.
2. **Obligation:** immutable recipient Node/activation and original input, current disposition plus historical transitions/handling-evidence link. A new activation creates an explicit carried/replaced obligation; never edit an old recipient activation.
3. **Attempt assignment/delivery:** guidance/obligation ID, exact Node source, planned Attempt, later Dispatch/fencing generation, launch context digest and delivery evidence. Unique by exact recipient assignment, not Task alone.

`prepareNodeSource` should read applicable guidance and persist a deterministic assignment set in the same transaction as its existing immutable source. Suggested context shape:

```ts
guidance: {
  items: [{ guidance_id, obligation_id, source_input_id,
            node_id, node_activation, text, content_digest }],
  required_guidance_ids: [...]
}
```

Sort IDs deterministically and budget the whole encoded context. Do not truncate guidance or silently omit a required instruction to fit. Preparation overflow remains an explicit retryable source failure. No Task transcript, Todo context, sibling Task context, other Role instructions or raw execution logs are required in Node context.

The existing Node source/context digest already binds the entire prompt. A separate transport field is optional: backend assignment rows plus frozen prompt and original Dispatch suffice for exact provenance. If a bounded `guidance_ids` or `guidance_manifest_digest` is added to `NodeExecutionSource`/Dispatch for easier Runner validation, include it in scope equality, schema fixtures, retained Start equality and reconnect checks; do not accept a new field without using it. Do not let the Runner semantically choose guidance applicability.

New guidance never patches a queued/started source. Retire/cancel an incompatible queued source and prepare a successor with the new full context. A later Role edit likewise affects only a newly prepared source. A burst of inputs may be coalesced by the backend before source creation, preserving every input/obligation identity; it must not mutate an already-created prompt.

### Stop/follow-up state machine

| Recipient fact when routing commits | Minimal supported action |
| --- | --- |
| Task before Start / no Plan | Retain Task-scoped active guidance; no implicit Start. Assign Node recipients on actual Plan publication and include it in later execution context. |
| Current PENDING Node / no Attempt | Persist obligation and prepare/replace canonical source under the new relevant execution basis. No invented Stop. |
| QUEUED Attempt | Revoke that exact queued source/Attempt and create successor intent; preserve cancelled delivery history. It never received live guidance. |
| Running mutable Attempt without admitted completion | Record routing and follow-up intent, fence old Attempt, admit/reuse exact Stop, then allow new source only after old process/effects/leases settle. Same activation. |
| Explicit Owner-stopped Node | Retain guidance; do not clear its owner-stopped blocker or auto-Continue. Owner Continue injects all still-applicable guidance. |
| Independent semantic/factual blocker | Retain guidance/answer provenance; do not clear or auto-Retry the unrelated blocker. |
| Completion already admitted, including recovery | Keep source/manifest immutable; wait for original physical settlement, then execute recorded post-completion policy or Planner re-evaluation. |
| Node already completed | Answer/no-work routing or authorized Rework/invalidation with a fresh activation. Do not create another successful completion for the old activation. |
| Terminal Task / accepted delivery scope | Reply-only; reject guidance dispatch and continuation. |

Use an explicit internal reason such as guidance follow-up. Calling Owner Stop then Owner Continue internally would falsely record Owner intent and could clear a genuine Stop. Extract/reuse the physical Stop admission helper while keeping Owner controls distinct. A transient Stop/queue wait is normal operation progress; do not fabricate a semantic blocker merely to make existing Owner retry logic fit.

The follow-up intent is durable before performing RPC. Its current source/Node/activation/control and independent blockers are rechecked when promoted. An Owner Stop arriving while cleanup/follow-up waits must stop the successor intent; a later cleanup success cannot erase that Stop. Existing queue barriers keep old Node owners/effects/leases from being bypassed even if another model slot is free.

### Completion handling IDs and immutable manifest

Extend `complete_node {summary,artifact_ids?,handled_guidance_ids?: Id[]}`. Preserve absence versus explicit list without inferring success:

- Omitted or `[]`: declares no handled guidance. This remains valid when no required active launch obligation exists. Never default to all guidance.
- `null`: invalid input; duplicates, excess count, unknown/cross-Task/cross-Node/cross-activation IDs: deterministic rejection.
- Nonempty: each ID must belong to the exact source/Attempt assignment, or an explicitly persisted compatible live recipient record if such transport is added in the future. This leaf has no live assignment path.
- Every still-required active obligation in the frozen launch set must be declared, otherwise return a correctable precondition error before admitting completion/fencing the Attempt. The Agent can correct the payload or `block_node` with a precise unresolved reason.
- A guidance record withdrawn/superseded after launch may still be declared historically if it was actually assigned; it must not become newly handled/current or undo the withdrawal. Do not reject merely because invisible current guidance state changed and trap the old Agent without a read path. Requiredness is checked against the operation-owned disposition at admission.

Freeze declared IDs and assigned-set provenance into the same manifest digest as summary/Artifacts (`artifacts.ts:148-159`, `:169`). `projectCompletion` closes only active matching declared obligations in the same transaction as current Node completion. Transport receipt, normal exit, `block_node`, Artifact publication and completion **admission** do not close them.

If guidance routing wins before completion admission, this Adapter does not pretend the old Attempt received it. Fence/Stop it and assign the guidance to the successor. If completion admission wins, later guidance remains a distinct obligation; it cannot be inserted into the old manifest or retroactively marked handled. Physical success must atomically retain that obligation and enqueue its already-recorded follow-up/re-evaluation, guarding acceptance and affected downstream scheduling.

### Hard-completion recovery interactions

The previous leaf already ships `recover_completion(mode=retry|correct)` and a trusted `settle_completion` pair. Preserve their identities and physical rules:

- Retrying the same completion after infrastructure repair retains the original handled-ID manifest. Success can close only that original set.
- Guidance arriving during recoverable/hard completion waits behind that operation. It must not call generic Stop and assume the returned existing completion ID means a fresh continuation is authorized (`node-execution.ts:115-121`).
- Guidance alone does not choose to abandon a hard completion or bypass required Owner recovery. Preserve explicit attention and pending guidance. An existing exact Owner `recover_completion(correct)` can settle the pair; the new correction source must read all applicable guidance automatically.
- Pair disposition `cancelled` produces no handling evidence. The correcting Attempt uses the same activation and new assignment/delivery rows. Private dirty checkpoint preservation and reopen/finalize requirements remain.
- Pair disposition `already_finalized` closes only the original manifest set, then applies pending guidance's post-completion policy through a new activation or Planner re-evaluation. It cannot silently count the new guidance as handled.
- Cancel retains truthful historical settlement without current guidance handling or Task revival. Withdrawal clears only the targeted guidance guard; it cannot release an outstanding Git operation or revert another Owner recovery decision.

`reactivateSettledNodes()` increments activation and retains history only after all prior owners/operations settle (`task-records.ts:125-132`). Its current caller must additionally prepare a **new** canonical Node source, because merely incrementing activation leaves `nodes.execution_source_id` pointing at the old source. Guidance obligation carry-forward must be explicit for that new activation. Do not edit old completion/Artifact attribution to imply it belongs to the new activation.

### Conversation source and control-version hazards

Add a distinct `Dispatch.task_conversation_source` for Task Planner conversation, mutually exclusive with Todo, initial planning and Node sources. It should bind Task input operation/source, exact batch/watermark, conversation epoch, captured observed execution basis/time, frozen context digest and reply-only versus action-eligible scope. No Node ID, writable resource ID or workspace reservation grant. Use canonical empty workspace reservations to retain scratch-only behavior.

Runner work: `wire.ScopeID`, schema source exclusivity, Adapter fixed protocol, local command allowlist, root request/effect scope and repository-free Stop reconnect recovery must recognize the new source. Allow `commit_task_turn` and the task-scoped read/search tools selected by backend design; reject Todo preview/create, initial Plan outcomes, Node Artifact/block/completion and workspace mutation. Initial Task Planner retains its existing exclusive publish/issue outcome. Fixed text must teach exact `--input FILE`, `command-status`, and same-ID `retry` syntax.

**Do not use ordinary Task conversation as an execution control-version increment.** Current `assertNodeSource` requires `task.control_version=source.expected_version` (`node-execution-state.ts:62`), queued promotion checks launch control (`dispatch-queue.ts:168`), and every new Node command passes global control through `guardNewCommand` (`service.ts:233`; `domain/commands.ts:29`). Incrementing that version on message receipt or a status-only reply would invalidate unrelated running/queued execution.

Use conversation epoch/message sequence independently. Reply-only commit validates exact conversation claim/source/watermark and records its observed execution version/time. Action routing additionally validates live relevant Node/source/activation/Spec/Plan/control facts. The local envelope currently always copies `d.ControlVersion` (`socket.go:163`); for a conversation source this needs well-defined conversation-authority semantics, with execution expected basis carried separately in routing. Otherwise a Planner cannot correct a stale routing proposal after reading newer state because its local envelope remains tied to old global control.

The queue currently excludes **every** Task with any held workspace lease (`dispatch-queue.ts:161`), including a scratch-only Planner. Guidance cannot be interpreted while a Node owns a workspace unless this is narrowed for an authenticated canonical conversation source. Keep Task host locality and single Planner owner/physical exclusion, plus ordinary shared capacity. Do not exempt generic legacy Planner records or permit Planner access to the writable workspace.

### Responsibility split

| Backend / protocol | Runner |
| --- | --- |
| Ordered messages, source batching/watermarks, one Task Planner claim | Retain/run exact conversation Dispatch and process identity |
| Semantic routing validation and source input authority | Enforce source-specific CLI and Host effect scope |
| Guidance, obligations, immutable assignment sets and bounded context | Deliver frozen prompt through existing native launch |
| Stop/follow-up intent and current Node/activation/blocker guards | Stop/reconcile old writers, preserve workspace, acknowledge exact physical facts |
| Completion ID attribution and atomic handling evidence | Retain immutable command envelope and execute original physical completion |
| Delivery projection using source/Dispatch/started-event provenance | Never infer semantic handling from provider text or process exit |
| Retry/Withdraw/supersession and independent guard ownership | Existing same-ID command status/retry and finite reconnect cleanup |

No new semantic scheduler, Role capability taxonomy, provider delivery type system or permanent service is needed.

### Acceptance plan using existing services and native CLI

Parent owns execution/deployment. Reuse the existing backend, PostgreSQL and `monos-probe-runner.service`; do not launch a second Runtime endpoint or provider daemon. Retain the established host port override and model/preflight contract from deployment records.

1. Create a canonical Task through existing Owner/Todo flow. Before Start submit in-scope guidance and a progress question; inspect native Task Planner receipt/source/watermark, ensure zero Node dispatch until explicit Start.
2. Start and publish a real one-Node Plan; verify pre-Plan guidance becomes an exact activation obligation and appears in frozen native Node context. Deliberately omit required handled IDs once: backend rejects before fencing; corrected complete declaration can be tested later.
3. During a repository-backed Node with a tracked/unstaged/untracked change, submit a within-scope execution hint through Task Conversation. Let the actual Planner commit routing. Observe old source fencing, exact Stop/checkpoint, no successor launch before released process/effect/lease, and fresh same-Node/activation context containing the guidance. Check real bytes/HEAD/index and service checkpoint rather than only database status.
4. Owner Stop while continuation waits; submit another guidance message. Conversation may reply, but Node must remain stopped until explicit Continue. Continue starts fresh context with all applicable guidance without clearing an unrelated blocker.
5. Have native Node publish/read an optional Artifact and call `complete_node` with exact handled IDs. Verify command receipt/envelope digest, frozen manifest, physical success and per-obligation handling evidence. Native stdout claims alone fail acceptance.
6. Exercise completion-admission versus later-guidance race deterministically in PostgreSQL; supplement one native late-input run when practical. Original success remains historical/current only for its original activation; follow-up policy persists and new activation starts only after physical release. No duplicate completion or silently consumed instruction.
7. Lost command acknowledgement / Runner reconnect: compare exact source, Attempt, Dispatch, journal envelope and guidance manifest digests before/after; no live-delivery claim, no duplicate reply/routing and no new mutation from revoked Attempt.
8. Terminal/cancelled Task input gives a canonical reply-only turn; guidance dispatch/creation preview/Node tools are rejected. Pending guidance Withdraw leaves immutable message/history and does not undo independent Stop or hard completion recovery.

Meaningful automated gates: cross-language schema fixtures; Adapter/local source allowlists; DB tests for duplicate/cross-scope handled IDs, missing required IDs, both routing/completion orders, queued source immutability, burst coalescing, both Owner Stop/follow-up orders, hard-retry/cancelled/already-finalized pair outcomes, independent withdrawal, and progress-question control-version isolation. Existing Go race/vet and protocol freshness remain required; do not write tests that merely mirror new field declarations.

## External references

No external provider documentation was required to establish the current capability boundary: the actual fixed invocation and stdin wiring are decisive. Existing Runner spec pins the accepted OpenCode baseline/model and two-account/cgroup acceptance. A possible capability in an upstream OpenCode version is not evidence that monos implements or negotiates it.

## Caveats / Not Found

- This file proposes contracts; it does not claim guidance/Task Conversation is implemented or native-accepted.
- No live provider steering, native session reuse or explicit provider-consumption acknowledgement was found in current code. Supervised `started` alone is weaker than prompt consumption.
- Current `commit_task_turn` is a legacy scaffold and initial Planner explicitly rejects it. A distinct canonical conversation source must own new behavior.
- Current `handled_guidance_ids` is only an empty-array placeholder; manifest/obligation handling is not present.
- Conversation support requires narrowing the held-workspace Planner queue exclusion and separating ordinary conversation versioning from execution CAS; otherwise the feature can deadlock or stale ordinary Node work.
- Hard completion retains its existing recovery owner. Guidance is not permission to reset a lease or replace immutable completion input.
- Post-completion guidance needs explicit reactivation/re-evaluation and canonical source rebuilding; keeping the old activation/source would be incorrect.
- Research changed only this file. Native host, services, code, specs and other task records were untouched.
