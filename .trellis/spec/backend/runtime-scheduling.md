# Runtime target selection and shared capacity

## 1. Scope / Trigger

Use `RuntimeScheduling` when an authenticated product control command has prepared immutable Planner or Node context and must choose a Runtime target before queuing an Attempt. It resolves policy and installation facts; `DispatchQueue` owns the actual queue and promotion. Todo/Task semantic control remains with the caller, and Runner never selects product policy. OpenCode and Codex support initial-admission ordered fallback and [post-launch continuation](runtime-continuation.md) after verified native terminal failure and physical settlement.

## 2. Signatures

- `new RuntimeScheduling(queue, backendInstance).selectAndEnqueue(tx, SchedulingRequest): Promise<SchedulingResult>` runs inside the caller's receipt/admission transaction. `SchedulingRequest` contains `attempt_id`, Task/Node identity, kind, exact control basis, resource, prompt, source watermark, optional `role_id`, and optional `explicit_target`.
- Result is `{status:'queued',dispatch_id,runner_id,source,target}` or `{status:'unavailable',reason,source?,target?}`. `queued` is the selection/admission receipt; canonical Attempt reads provide its later execution state.
- `DispatchQueue.enqueue(tx, QueueInput)` persists the selected launch plus optional `selection_context`. Migration 10 adds nullable `attempts.selection_context` and `runners.runtime_report_incarnation`. Null preserves old probe dispatches and an omitted legacy discovery report.
- `BoundaryService.touch(..., ready=true, runtimes=[])` records a complete empty installation report for that Runner incarnation. Omitting `runtimes` retains observations as non-current rather than asserting absence.

## 3. Contracts

Selection priority is explicit target → Planner or Role policy → Global policy.
For the chosen policy, examine `default_target` followed by `fallback_targets` in
their configured order. An explicit target is a single choice with no implicit
fallback. Do not fall through to Global after exhausting a Planner/Role policy.
Skip only `unsupported_runtime`, `unsupported_model`, `unsupported_thinking`,
`installation_unavailable`, `model_control_unavailable` and `thinking_control_unavailable`. Missing/offline Runner,
stale installation and ambiguous Auto observations stop selection. If Auto has no
eligible Runner, any offline/stale observation takes precedence over confirmed
unavailability; a mixed set cannot establish Runtime failure. Exhaustion returns
the last examined target and its reason. Skipped candidates create no Attempts;
only the first usable candidate is enqueued. Capacity is not target failure: a
busy compatible target remains selected and waits in the ordinary queue.

A hard `runner_id` pin never moves. Auto chooses one eligible Runner; if more than
one is eligible, it returns `ambiguous_auto_placement`. Before evaluating compatible
candidates, take `LOCK TABLE runners IN EXCLUSIVE MODE` if any candidate is Auto;
otherwise lock all compatible pinned Runner rows together in ID order. Acquire
these locks before any candidate-specific Runner or Task lock. This prevents a
pinned-to-Auto lock upgrade and opposite fallback lists acquiring rows in reverse
order. EXCLUSIVE conflicts with the ROW SHARE table lock acquired by `connect`/`touch`
through `SELECT FOR UPDATE`, letting an already-started heartbeat finish before
Auto selects. SHARE ROW EXCLUSIVE is insufficient: it permits that ROW SHARE
lock, then blocks the heartbeat's UPDATE while Auto waits for the heartbeat's
Runner row, creating a deadlock. Plain SELECT reads remain compatible with
EXCLUSIVE; hold it only through the short admission transaction.

Queue admission still checks Task locality and all exact source/basis guards.
An admission error rolls back the selection; never catch it to try another Runner
after the queue has acquired a Task lock. Existing queued targets and immutable
replays do not switch when policy or registry facts later change.

OpenCode accepts explicitly selected `opencode/longcat-2.5-preview-free` or `volcengine/deepseek-v4-flash-ga-260731` and does not support thinking level. Codex requires an explicit model identifier matching `^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$`; optional thinking is `none`, `minimal`, `low`, `medium`, `high` or `xhigh`. Dispatch preserves exact runtime/model/thinking in Task and Todo paths, including replay and Start. Installation facts must support model selection and, if selected, thinking control; promotion rechecks these capabilities. CLI discovery establishes no model availability, login, reasoning support for a particular model or quota guarantee. Native rejection remains a factual execution failure. The free OpenCode model requires verified zero pricing; the explicitly authorized DeepSeek model may incur provider charges. DeepSeek startup uses the native OpenCode v2 activation barrier; a cold catalog snapshot is not a readiness barrier. See [Codex profile](../../../docs/research/codex-runtime-adapter.md).

An Attempt ID is serialized by a transaction advisory lock. Replay of identical caller input returns its original target and dispatch ID even if policy later changes; changed input gives `payload_conflict`. `selection_context` records source, configuration version, exact target, complete ordered `policy_targets`, observed CLI version when available, and caller-input digest. Migration 26 binds root, target index and predecessor to each selected Attempt. Admission, receipt and queued Attempt must commit together. The caller handles an unavailable result without creating a fake process or new Task state.

A prepared Runtime continuation selects only the frozen suffix after its predecessor,
on that predecessor's Runner. A different hard pin is `unsupported_runner_transfer`;
Auto stays local. Never restart policy resolution or transfer a workspace implicitly.
Continuation selection locks Runner, then Task/Todo, then continuation, including the
unavailable/exhausted branch. Queue insertion and `queued` continuation resolution
commit together. Exhaustion is projected by the source owner; no skipped Attempt exists.

Planner and Node Attempts share the configured Runner slots; the existing enrollment helper defaults to two. A separate production enrollment flow is still pending. Promotion counts unresolved physical reservations, prioritizes Planner over Node and uses oldest `created_at,id` within a class. A blocked owner is filtered before choosing a candidate. Stale queue heads are cancelled and retried in separate transactions, at most 16 per poll, so each transaction locks only one Task. A full slot or disconnected sole Runner leaves work `QUEUED`; a complete current report showing Runtime absence/unavailability cancels selected pre-start work with a factual reason and no Start. Promotion commits fence, reservation, Node state and Start outbox atomically.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No applicable policy / missing Role | `unavailable: policy_missing` / `role_missing` |
| Unsupported Runtime, model or thinking | Skip to the next configured policy target; explicit target or exhausted list returns `unavailable: unsupported_*`; no skipped Attempt/Start |
| Pinned Runner missing/offline | `unavailable: runner_missing` / `runner_offline` |
| Stale installation or mixed unknown Auto observations | Stop with the waiting reason; no fallback |
| Current complete unavailable installation or unavailable model control | Try the next configured policy target; exhaustion retains its reason |
| More than one eligible Auto Runner | `unavailable: ambiguous_auto_placement` |
| Same Attempt ID and caller input | Original target and dispatch ID |
| Same Attempt ID, changed input | `payload_conflict` |
| Chosen fallback violates existing Task locality | Queue admission rejects and rolls back; no cross-Runner continuation |
| Queued target loses Runtime after a complete current report | `CANCELLED`, `runtime_missing_before_start` or `runtime_unavailable_before_start`; no Start |
| Full capacity or sole Runner disconnect | Remain `QUEUED`; no fallback or Task `BLOCKED` inference |
| Obsolete Task/Plan/Node basis | `CANCELLED`, `stale_queue_basis`; owning module reconsiders |

## 5. Good / Base / Bad Cases

Good: an unsupported default and unsupported first fallback select the next exact
supported target, with one Attempt and stable replay. Base: a queued Attempt
survives backend restart and a temporary Runner disconnect with its original
target. Bad: treat a busy target or unknown Runner report as Runtime failure, or
silently use Global after a Role policy is exhausted. Two slots still serve any
mix of Planner/Node work; the next free slot goes to the oldest eligible Planner.

## 6. Tests Required

`postgres-runtime-scheduling.test.ts` checks precedence, exact replay, unsupported settings, hard pins, complete versus omitted installation reports, pre-start cancellation, Auto serialization and two-slot priority. Its heartbeat regression pauses a real `touch` at installation replacement after its Runner row lock, observes Auto waiting in a distinct PostgreSQL backend, then releases the barrier and requires both transactions to commit using the new installation observation. This catches the ROW SHARE/UPDATE upgrade cycle; a timing delay alone does not establish contention. `postgres-dispatch.test.ts` verifies competing promoters, physical reservations, start replay, locality and crash recovery. Run `pnpm test:db` with a real isolated PostgreSQL instance after changes to selection, queue or migration; regular `pnpm test` skips DB suites. Run lint, typecheck, protocol drift and build for the affected backend/transport path. Real CLI/model and host restart behavior belong to the later integration acceptance task.

Ordered-selection regressions cover the first eligible fallback, exhausted
Planner/Role policies, explicit-target refusal, current unavailable versus
offline/stale/missing facts, mixed unknown Auto reports, capacity waiting and Task
locality rejection. Exercise the heartbeat lock barrier with both direct Auto and
a pinned default followed by Auto. The separate Node/Planner fallback suites cover
post-launch continuation; no native Runtime claim follows from these PostgreSQL tests.

## 7. Wrong vs Correct

Wrong: let a configured target silently become the probe model, choose Auto from an unlocked registry snapshot, or skip to another target because capacity is full.

Correct: inspect the configured target list in order, retain waiting facts,
serialize its Runner locks, preserve exact selected context, and retry stale-head
cleanup in separate bounded transactions before dispatching eligible work.
