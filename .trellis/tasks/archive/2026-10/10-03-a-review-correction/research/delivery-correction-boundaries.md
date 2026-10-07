# Delivery correction boundaries

Date: 2026-10-05. Main source research only; no new product effect or test.
Upstream exact Owner delivery is accepted at `c0212a9`, archive `80f57b5`.

## Owning architecture and observed implementation

`docs/04-workspace-and-git.md:316` requires explicit Request Changes to serialize
with dispatch and finality, reject any finalized item or unresolved merge, revoke
accepted authority/cancel pending dispatch before routing, and settle previously
admitted pushes/effects. It preserves PR/branch and immutable message provenance.
Ordinary chat is never this action. `docs/07-owner-review-and-ui.md:642` keeps
REVIEW while semantic routing is pending, with Answer & Retry/Withdraw feedback.
Only an actual insufficient graph warrants REPLAN_REQUIRED.

The accepted implementation has no revocation/correction command yet. Migration 24
retains the Task acceptance pointer; migration 19 retains each input's accepted
attribution. Revocation must add receipt-backed narrow authority, not weaken those
retention rules or manufacture a second approval. Original batch/content remains
history. A later Accept requires a fresh proposal/confirmation and new batch.

## New effect versus historical settlement

- `owner-delivery-worker.ts:125` discovers accepted batches; `:183` rechecks Task,
  claim and frozen authority before grants/effects. A revocation state must not be
  changed to attention by a stale worker catch/final callback. Revoke only while
  no original merge is started/unknown/effect-owned and no finality exists.
  Pre-effect held-grant turns must fail the post-I/O current-authority check.
- `remote-preparation-access.ts:77` authorizes push before/after token I/O. The
  claim at `:84` records possible effect *before* issuance; revocation waits for
  its original Runner result with worker absence and ref reconciliation. An
  already issued credential is not proof that the push is absent.
- `remote-preparation.ts:108` dispatches pending pushes; `:122` accepts original
  exact results without rediscovering current result authority, preserving truth.
  `:140` observes original refs; `:161` observes original PR outcomes. The latter
  checks current mutation authority only when no possible effect exists. Retain
  these read-only paths during settlement; never allocate a replacement push/PR
  until they settle.
- `remote-preparation.ts:210` settles original provider results even after control
  changes, binding original PR identity. Preserve real published proof and private
  historical preparation records as parents for subsequent fast-forward work.
- `remote-preparation-state.ts:42` quiescence includes effect-owned operations and
  unresolved settled push outcomes. Correction additionally needs all admitted
  physical attempts/workspace leases/local operations settled before Rework.

## Critical stale fallback to close

`owner-delivery-guards.ts:74` currently falls back to ordinary admission whenever
the Task has no accepted pointer. Once legitimate revocation can clear that pointer,
an old accepted operation must not thereby regain ordinary authority. Require
current batch identity for any operation with retained acceptance links, regardless
of identical source/candidate. Revoke all pending unclaimed linked operations;
retain possible effects for original observation only. Never revive their IDs on
Withdraw or subsequent reacceptance.

Add unresolved feedback guards to ordinary local and remote source/preparation
admission. That stops automatic new work while feedback is queued, routing, failed,
waiting for an answer or awaiting structural settlement. Successful push/check
refresh cannot remove the guard. Cancel remains terminal and closes undelivered PRs
through existing cleanup; Request Changes does not close the reused PR.

## Input reconsideration

Pending later messages must regain ordinary applicability after the original
revoked operation and relevant reply-only Attempts settle. Preserve original
accepted attribution and message/reply rows; never clear provenance or replay prior
replies. Use an explicit restoration/applicability fact rather than deleting
accepted IDs. The canonical backend design owns how fresh classification is
scheduled on the existing input source without duplicating a prior reply.

## Minimum evidence

Genuine Owner/real PG tests: Request Changes before acceptance, accepted-before-push,
pre-effect merge grant race, actual admitted push/token race and original settlement,
unknown merge/finality rejection, no stale linked fallback after withdrawal/new
acceptance, later input restoration with prior reply retained, and cancelled late
truth. Use existing production preparation/worker fixtures and existing native
worker-absence evidence where unchanged. No new live merge or repeated provider
method matrix is needed for this correction control leaf. Stage A remains zero/one
modified automatic GitHub repository; multi-repository partial delivery is a
negative finality guard/support boundary, not new delivery-mode implementation.
