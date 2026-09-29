# Single-Node execution, Artifacts and recovery

## Goal

Execute a canonical published one-Node Plan and expose a truthful, recoverable
local REVIEW result. The Owner can read durable outputs and resolve blocked or
stopped work without losing private changes or releasing uncertain writers.

## Background and authority

Serial workspaces and Task Start/planning are accepted and archived (latest
implementation `edc7bea`, Session 18). Production can publish a Plan but has no
canonical Node execution pump or managed Artifacts. The Owner explicitly authorized
sequential implementation, routine decisions, commits and test-host use without
repeated approval. Reuse existing services.

Architecture modules 03–06 and 08 own the contracts. Detailed source anchors and
test cases remain in [backend research](research/backend-seams.md) and
[Runner research](research/runner-recovery.md), part of this requirements context.

## Requirements

1. **Canonical scheduling and context.** Discover only effective canonical published
   membership, persist immutable Node work and share existing Runtime capacity.
   Selected QUEUED means Node RUNNING. Offline Runner waiting resumes automatically;
   unsupported policy/Runtime or exhaustion has factual attention and Owner Retry.
   Fresh Attempts receive full current referenced Role instructions (including an
   archived referenced Role), effective Spec, immutable Node, Project map and scoped
   formal recovery input. Never silently refresh queued context. Exclude Todo,
   sibling Tasks, Planner Guidance, other Roles and raw logs/repository bytes.
2. **Optional managed outputs.** Immutable bounded UTF-8 Artifact content/title/
   external references carry exact Task/Node/activation/Attempt/Spec/Plan provenance.
   Scoped reads survive producer exit and workspace cleanup. HTML is returned as
   data, not executed on the app origin. URLs are references, not captured content.
   Publication alone is historical, not current completion evidence.
3. **Formal completion.** Freeze summary and selection before fencing mutation.
   Omitted selection means this Attempt's outputs; explicit IDs may select earlier
   same-Node/same-activation outputs; [] means none. Artifacts are optional. Honest
   no-repository completion requires whole-tree absence with no fake Git evidence.
   Outstanding opens/leases or retained dirty workspace require real settlement.
   Opened workspaces finalize through trusted recoverable Git effects before current
   completion/REVIEW. Prose and successful process exit never complete a Node.
4. **Block and Owner controls.** `block_node(reason)` records semantic handoff,
   fences mutation and preserves a precise answerable blocker without fabricating
   Runtime failure. Exact answer/Retry and Stop/Continue cover unavailable, queued
   and running work. Saved successor intent cannot promote before old physical
   ownership/effects/leases settle. Ordinary recovery changes Attempt, not activation.
5. **Completion recovery.** Recoverable completion stays RUNNING with attention
   after exit; hard capture/invalid finalization stays BLOCKED with ownership held.
   Owner may retry the same operation after repair. Fresh Agent correction requires
   trusted reconciliation and a preserved recovery checkpoint first. Already-successful
   finalization must reconcile truthfully, never be abandoned. Broken ancestry is
   never silently repaired; later completion must pass original lineage checks.
6. **Local cancellation.** Before delivery, Cancel revokes sources/queued/live
   authority, cancels unfinished Nodes/Task and retains history/workspace/cleanup.
   Late settlement cannot create current evidence or overwrite CANCELLED. No
   post-Plan action returns the Task to PLANNING.

## Acceptance criteria

- [x] Canonical published work survives restart with one source/Attempt/Start;
  arbitrary fixture PENDING Nodes never execute automatically.
- [x] Current/frozen context, byte limits, offline/capacity distinctions and exact
  source/physical ownership guards pass real PostgreSQL contention/crash tests.
- [x] Artifact immutability/provenance/scope/budgets and omitted/empty/earlier-Attempt
  selection pass protocol/DB tests and remain readable after producer release.
- [x] Complete/block/Stop/Cancel races retain one outcome/original receipts, with no
  stale evidence. Both process-absence/recovery-result orders are covered.
- [x] Exact blocker resolution, Stop/Continue, same-ID repair and trusted correction
  settlement preserve same activation, private work and old operation history.
- [x] Native canonical no-resource work publishes a usable HTML Artifact and reaches
  REVIEW only after process release, without Git/lease fiction.
- [x] Native canonical Git work preserves tracked/untracked changes through recovery;
  actual result tree equals retained execution input/output evidence.
- [x] Migration, full TS/PG/Python/Go race/vet, protocol generation, lint/typecheck,
  production build/native imports and independent deployed acceptance pass.

## Scope limits

One public Plan Node and at most one opened repository per Task. Text content is
supported; binary upload, Task Conversation/guidance delivery, Spec changes,
Rework/Replan, execution UI, remote publication/acceptance, multiple Runtimes/Nodes/
repositories, cross-Runner transfer and generic workflow/upload services belong to
later leaves. Local Cancel does not claim accepted/remote-delivery cancellation.

## Native carryover

Use Task `e14ad4bb-4688-4647-981c-70911889e17b`, Node
`04fb910d-fdf9-4e2d-9ae2-ae269f53ca74`, Plan
`5c99259e-d5d5-4b1f-a784-dc5d2027ddae` for no-resource acceptance. Inspect its
immutable Spec/Plan/current Role before pump rollout. No hidden allowlist or reset.
Its reading-list result supports adding titles and marking finished, with primary
button exactly “Add book”.
