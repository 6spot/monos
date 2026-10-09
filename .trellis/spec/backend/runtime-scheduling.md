# Runtime target selection and shared capacity

## 1. Scope / Trigger

Use `RuntimeScheduling` when an authenticated product control command has prepared immutable Planner or Node context and must choose a Stage A Runtime target before queuing an Attempt. It resolves policy and installation facts; `DispatchQueue` owns the actual queue and promotion. Todo/Task semantic control remains with the caller, and Runner never selects product policy.

## 2. Signatures

- `new RuntimeScheduling(queue, backendInstance).selectAndEnqueue(tx, SchedulingRequest): Promise<SchedulingResult>` runs inside the caller's receipt/admission transaction. `SchedulingRequest` contains `attempt_id`, Task/Node identity, kind, exact control basis, resource, prompt, source watermark, optional `role_id`, and optional `explicit_target`.
- Result is `{status:'queued',dispatch_id,runner_id,source,target}` or `{status:'unavailable',reason,source?,target?}`. `queued` is the selection/admission receipt; canonical Attempt reads provide its later execution state.
- `DispatchQueue.enqueue(tx, QueueInput)` persists the selected launch plus optional `selection_context`. Migration 10 adds nullable `attempts.selection_context` and `runners.runtime_report_incarnation`. Null preserves old probe dispatches and an omitted legacy discovery report.
- `BoundaryService.touch(..., ready=true, runtimes=[])` records a complete empty installation report for that Runner incarnation. Omitting `runtimes` retains observations as non-current rather than asserting absence.

## 3. Contracts

Selection priority is explicit target → Planner or Role policy → Global policy. Stage A uses the default target; ordered fallback is a later Stage B capability. A hard `runner_id` pin never moves. Auto chooses one eligible Runner; if more than one is eligible, it returns `ambiguous_auto_placement`. This decision is serialized with connection/registry changes by taking `LOCK TABLE runners IN EXCLUSIVE MODE` before the Auto scan or any Runner row lock. Pinned selection takes only its Runner row lock. EXCLUSIVE conflicts with the ROW SHARE table lock acquired by `connect`/`touch` through `SELECT FOR UPDATE`, letting an already-started heartbeat finish before Auto selects. SHARE ROW EXCLUSIVE is insufficient: it permits that ROW SHARE lock, then blocks the heartbeat's UPDATE while Auto waits for the heartbeat's Runner row, creating a deadlock. Plain SELECT reads remain compatible with EXCLUSIVE; hold it only through the short admission transaction.

The current adapter accepts explicitly selected `opencode/longcat-2.5-preview-free` or `volcengine/deepseek-v4-flash-ga-260731` and does not support thinking level. A missing/different model, other Runtime, or thinking setting is reported as unsupported. Dispatch preserves the selected model; it is never silently replaced with LongCat. Selection requires a current ready Runner installation observation; CLI version discovery alone does not prove model login or quota. The free model requires verified zero pricing; the explicitly authorized DeepSeek model may incur provider charges. DeepSeek startup uses the native OpenCode v2 activation barrier and records actual provider/model errors; a cold catalog snapshot is not a readiness barrier.

An Attempt ID is serialized by a transaction advisory lock. Replay of identical caller input returns its original target and dispatch ID even if policy later changes; changed input gives `payload_conflict`. `selection_context` records source, configuration version, exact target, observed CLI version when available, and caller-input digest. Admission, receipt and queued Attempt must commit together. The caller handles an unavailable result without creating a fake process or new Task state.

Planner and Node Attempts share the configured Runner slots; the existing enrollment helper defaults to two. A separate production enrollment flow is still pending. Promotion counts unresolved physical reservations, prioritizes Planner over Node and uses oldest `created_at,id` within a class. A blocked owner is filtered before choosing a candidate. Stale queue heads are cancelled and retried in separate transactions, at most 16 per poll, so each transaction locks only one Task. A full slot or disconnected sole Runner leaves work `QUEUED`; a complete current report showing Runtime absence/unavailability cancels selected pre-start work with a factual reason and no Start. Promotion commits fence, reservation, Node state and Start outbox atomically.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No applicable policy / missing Role | `unavailable: policy_missing` / `role_missing` |
| Unsupported Runtime, model or thinking | `unavailable: unsupported_*`; no Start |
| Pinned Runner missing/offline | `unavailable: runner_missing` / `runner_offline` |
| Stale/absent/unavailable installation or model control | Factual `unavailable` reason |
| More than one eligible Auto Runner | `unavailable: ambiguous_auto_placement` |
| Same Attempt ID and caller input | Original target and dispatch ID |
| Same Attempt ID, changed input | `payload_conflict` |
| Queued target loses Runtime after a complete current report | `CANCELLED`, `runtime_missing_before_start` or `runtime_unavailable_before_start`; no Start |
| Full capacity or sole Runner disconnect | Remain `QUEUED`; no fallback or Task `BLOCKED` inference |
| Obsolete Task/Plan/Node basis | `CANCELLED`, `stale_queue_basis`; owning module reconsiders |

## 5. Good / Base / Bad Cases

Good: two slots serve any mix of Planner/Node work; the next free slot goes to the oldest eligible Planner, with one durable Start. Base: a queued Attempt survives backend restart and a temporary Runner disconnect with its original target. Bad: Auto selects Runner A while Runner B becomes eligible in the same admission, or repeated stale Planner heads delay an eligible Node across many polls.

## 6. Tests Required

`postgres-runtime-scheduling.test.ts` checks precedence, exact replay, unsupported settings, hard pins, complete versus omitted installation reports, pre-start cancellation, Auto serialization and two-slot priority. Its heartbeat regression pauses a real `touch` at installation replacement after its Runner row lock, observes Auto waiting in a distinct PostgreSQL backend, then releases the barrier and requires both transactions to commit using the new installation observation. This catches the ROW SHARE/UPDATE upgrade cycle; a timing delay alone does not establish contention. `postgres-dispatch.test.ts` verifies competing promoters, physical reservations, start replay, locality and crash recovery. Run `pnpm test:db` with a real isolated PostgreSQL instance after changes to selection, queue or migration; regular `pnpm test` skips DB suites. Run lint, typecheck, protocol drift and build for the affected backend/transport path. Real CLI/model and host restart behavior belong to the later integration acceptance task.

## 7. Wrong vs Correct

Wrong: let a configured target silently become the probe model, choose Auto from an unlocked registry snapshot, or clear stale queue heads one Runner poll at a time.

Correct: report unsupported settings, serialize Auto placement, preserve exact selected context, and retry stale-head cleanup in separate bounded transactions before dispatching eligible work.
