# Ordered Task Conversation and guidance

## Goal

Let the Owner discuss the current Task, recover a failed conversation turn and
give durable within-scope instructions without losing input or silently changing
execution intent. Show separately what was saved, interpreted, supplied to an
Attempt and completed.

## Background and authority

Follows [Single-Node execution, Artifacts and recovery](../archive/2026-09/09-30-a-node-execution/prd.md),
accepted as `c5ce437` / Session 19. Ordered Todo Discussion and initial Task planning
are implemented; legacy `commit_task_turn` has no canonical Task input authority.
Architecture modules 02/03/05/06 and invariants in module 08 own the contracts.
The Owner explicitly authorized sequential implementation, routine decisions,
tests, commits and use of the existing test host without further approval.

## Requirements

1. **Ordered canonical input.** Persist authenticated Task-owned Owner messages,
   immutable source/batch/watermark and reply/routing provenance. Concurrent
   clients and busy Planner work cannot skip input or produce two resolutions.
   Initial planning and conversation share one Task Planner mutation claim and
   existing Runtime capacity/locality. Later messages wait durably for their own
   turn; a new Attempt waits for previous physical/effect settlement.
2. **Scoped bounded continuity.** Include effective Specification, current Plan
   and control observations, relevant Node/output/operation facts, applicable
   guidance, recent bounded conversation and exact source. Provide bounded older
   history search with the source cutoff and withdrawal labels. Exclude Todo,
   another Task, raw logs and provider-session authority. Oversize retains input
   with factual attention and an explicit recovery exit; no silent clipping.
3. **Conversation is independent of execution control.** Input/reply ordering has
   its own version. Reply-only output retains observed execution version/time
   without invalidating Node sources/evidence or starving on unrelated progress.
   Action routing revalidates current affected facts. Before Start, while stopped,
   during blockers and on terminal Tasks, chat cannot Start/Continue/unblock/reopen
   or create another Task. Terminal and accepted-batch replies are conversation-only.
4. **Recoverable semantic turns.** Committed reply, routing/disposition, processed
   watermark, receipt and next intent commit atomically. No formal output leaves
   the source retryable. Retry and explicit Withdraw remain usable without a free
   Runtime; withdrawal retains content and logs, fences old authority and never
   invents a reply. Expose ordered history, source/queue/attention, command receipt
   recovery and scoped Attempt/operation facts through authenticated Owner reads.
   Interpreted but unresolved work has an explicit obligation and Owner exit.
5. **Durable guidance and handling.** Record source input, Task/Node applicability,
   activation obligations, supersession/withdrawal and per-recipient Attempt/
   dispatch provenance. Pre-Plan guidance binds recipients when the Plan publishes.
   New Attempts receive current active relevant guidance in an immutable launch;
   receiving it is not proof it was handled. `complete_node` explicitly declares
   handled IDs, validated against its frozen assignment; successful finalization
   settles only that manifest. Missing required launch guidance is a correctable
   precondition or remains unresolved through `block_node`.
6. **Controlled continuation and races.** Use queued follow-up and trusted Stop/
   resume with the same Node/private workspace. Preserve old operation/receipt/
   process ownership and hard-completion recovery. Routing before completion can
   authorize fresh same-activation work; routing after completion admission cannot
   mutate that frozen manifest and must retain later follow-up responsibility.
   Completed work that still needs guidance is reactivated with historical evidence
   retained. Owner Stop and unrelated blockers prevent automatic continuation.
   Pending obligations survive exit/restart and guard acceptance until handled or
   explicitly resolved; guidance withdrawal clears only its own obligation.
7. **Future delivery boundary.** Input admission and an actual accepted delivery
   cutoff serialize on Task control. Later input receives nonblocking, conversation-
   only attribution and cannot invalidate accepted work. Acceptance proposals and
   confirmations alone are not an accepted batch. This leaf establishes the
   conversation guard seam; real provider delivery remains a later task.

## Acceptance criteria

- [x] Independent-process concurrent clients and Planner workers retain ordered
  input, immutable sources, one reply/disposition and recoverable crash outcomes.
- [x] Busy initial Planner and Node work share claims/capacity/locality correctly;
  source/UTF-8/search boundaries exclude later input, Todo and other Tasks.
- [x] Progress-only replies preserve execution/evidence, and action routing rejects
  stale affected facts. No input implicitly starts, resumes or reopens execution.
- [x] Saturation, unavailable Runtime, missing formal reply and lost command response
  retain usable Retry/Withdraw/read recovery without losing queued input.
- [x] Guidance launch/receipt/handling are distinct; completion/routing/withdrawal
  races, same-activation correction and later activation follow-up preserve exact
  manifests, old evidence and physical workspace ownership.
- [x] Terminal and later accepted-batch input stay conversation-only and do not
  block the accepted operation; no fake acceptance/remote-delivery claim is made.
- [x] Real installed CLI commits Task replies and handles controlled guidance;
  existing backend/Runner restart preserves canonical records and receipts.
- [x] Migration, relevant full TS/PG/Python/Go gates, protocol generation, lint,
  typecheck, build/native imports and independent review pass.

## Scope limits

One public Plan Node, one Runner and at most one opened repository. No live
steering, mandatory native session resume, separate Planner pool/service, new
Task lifecycle, team model, generic workflow engine, automatic Runtime hang
inference or cross-Runner migration. Exact Specification proposal/publication,
replacement Plan, execution UI and provider delivery are following roadmap leaves.
This task supplies authenticated APIs and CLI behavior; it does not claim the
later Task Conversation UI is already present.

## Research

See [acceptance plan](research/acceptance.md), [backend seams](research/backend-seams.md)
and [Runner guidance](research/runner-guidance.md). The final design and
implementation plan resolve technical contracts before activation; parent links
express ownership, not automatic dependency scheduling.
