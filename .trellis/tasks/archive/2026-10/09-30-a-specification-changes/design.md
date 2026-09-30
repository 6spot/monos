# Exact Specification revision design

## Boundary and behavior gap

The current system has an immutable pre-start revision primitive and exact Owner
receipts, but lacks a complete visible proposal/impact, durable change settlement
and applicability across revisions. Add a Task-owned requirements module; preserve
the current `tasks` control row, shared Task Planner claim and existing Runner effects.
The smallest complete change crosses backend/domain SQL/protocol/CLI because current
activation/source checks assume one Specification basis. It does not change Node
formal definitions or create a replacement Plan.

## Command and ownership boundary

- Canonical Task Conversation Agent `prepare_specification_revision` creates a
  bounded immutable draft against its exact source/input/cutoff and current action
  basis, with full Markdown, summary, complete impact and explicit source input IDs.
- `commit_task_turn` gains `specification_proposal` routing attaching that draft.
  It requires the original source/Attempt and current eligibility. The existing
  atomic reply/resolution/Stop outcome remains the only terminal conversation handoff.
  Unattached drafts are not confirmable or execution-authorizing.
- Dedicated authenticated Owner specification commands perform confirmation, apply,
  direct complete edit, withdrawal, exact input deferral and operation Retry.
  Reuse canonical request hashing/session/CSRF/receipt conventions. Exact confirmation
  itself has no execution effect; apply consumes authorization and admits settlement
  atomically. Another request for the same applied proposal returns the original
  operation/revision; changed request payload conflicts before scope lookup.
- Keep the documented `apply_specification_revision` system contract. Owner apply
  is sufficient to proceed without launching an Agent merely to consume approval.
  A later canonical Task Planner may also call the documented apply command using
  the exact existing Owner receipt through a domain-scoped admission adapter. It
  revalidates current source/action basis and never impersonates an Owner session
  or infers consent from conversation. Applying is not a second terminal outcome;
  the turn still closes through its canonical reply. No new physical effect type.
- Bounded scoped reads expose exact proposal text/impact, eligibility/attention,
  authorization, operation/effect links, revision history and applicability. Current
  Task context includes bounded actionable summaries; full history uses explicit
  reads. No clipping required Spec or impact and no embedding raw logs/Todo history.

## Exact impact and eligibility

Complete impact enumerates current effective Node membership and active guidance
coverage, binds current Plan/Node definitions, each activation/source and exact
completion operation/manifest where applicable, and declares graph sufficiency.
No Plan uses empty Node coverage. For the one-Node Plan:

- `refresh`: unfinished work requires a fresh immutable source on the new Spec.
  Preserve activation and private workspace unless trusted settlement establishes a
  successful completion for that activation; then retain that completion as historical
  and create a fresh activation. This conditional consequence is displayed and
  authorized in the impact before admission, not invented after settlement.
- `invalidate`: completed evidence is no longer applicable; settled publication
  creates a fresh activation and preserves the integrated result as corrective input.
- `carry`: completed evidence remains applicable; bind the exact completion/manifest
  and prior effective applicability, preserve activation and REVIEW if otherwise valid.

Unfinished work cannot claim unrestricted unaffected live authority across a global
Spec change. Even a semantically unaffected unfinished Node requires disclosed fresh
context (`refresh`). Guidance is explicitly retained or superseded by exact IDs;
old terminal handled rows remain immutable. New activations receive fresh pending
obligations for retained active guidance. Independent Owner Stop/blockers survive.

Only sufficient unchanged graph publication is supported here. Graph-insufficient
preparation/admission returns actionable unmet-precondition, and the current Planner
can retain the request through an issue. It cannot silently edit a Node definition,
publish knowingly inadequate requirements or invent REPLAN_REQUIRED. The next leaf
adds linked Replan/joint publication with the same single publication slot.

## Data and authority

New additive migration20 owns:

1. Immutable full requirement proposals, normalized same-Task source links and
   append-only attachment/provenance. Proposal replacement links predecessor and
   shares one durable change obligation; drafts alone do not create acceptance guards.
2. One originating requirement obligation with current eligible proposal pointer,
   explicit terminal disposition and source issue transfer association. A source
   issue transfers responsibility rather than being falsely labelled withdrawn.
3. Exact Owner authorization linked to generic proposal/receipt mechanics, binding
   complete proposal envelope: Task, content/impact digests, base Spec/Plan/control,
   source IDs/cutoff, target activation/source/result identities. A direct complete
   Owner edit supplies the same complete impact, creates equivalent immutable
   authorization/admission records and does not invoke semantic inference in code.
4. Recoverable requirement change operation, immutable admitted target/impact and
   physical effect links, versioned attention/withdrawal state and one active Task
   publication slot. A future Replan shares this slot rather than competing beside it.
5. Immutable exact input deferral/disposition, publication and Plan/activation/evidence
   applicability records. New revision retains parent, source and Owner authorization.

Use same-Task composite FKs, unique proposal/operation/revision identities, immutable
content and one-way terminal constraints plus deferred exact attribution checks.
Retain all old nullable historical metadata; never fabricate sources for legacy rows.
Do not change applied migrations or v1/v2 completion manifest hashes.

## Input, replacement and confirmation discipline

Capture Owner input cutoff from inputs, not assistant message append sequence.
At confirm/admit/publish, inspect every later pre-acceptance input under Task lock.
Unresolved/failed input blocks until interpreted or explicitly Owner-deferred for
this exact proposal/operation and exact input identity/version. Canonical reply-only
or withdrawn input is non-changing; effectful guidance/issue/proposal requires
refreshed compatibility/impact assessment or exact deferral. A processed message may
still own a blocking child obligation. New input after deferral is not covered.

Material base/activation/evidence/impact changes require a fresh proposal/receipt.
Later status-only replies and explicit Owner Stop do not by themselves invalidate
all admitted settlement work. Store the operation's own admission transition and
revalidate exact semantic target facts and independent control decisions; do not
blindly overwrite a frozen expected version to bypass a conflict.

Replacement creates a new immutable proposal under the same originating obligation
and revokes old confirmation eligibility. If the predecessor is admitted, request
withdrawal and finish its physical reconciliation before successor admission. Old
proposals, receipts, dispositions and effects remain readable. Withdrawal does not
withdraw unrelated effective guidance/feedback or reverse a published revision.

## Deterministic settlement and publication

Lock Owner session/request, configuration as needed, discovered Runner set, Task,
source/Attempt/Node and physical operations in existing order. Revalidate discovered
pointers; never acquire a newly discovered Runner while already holding Task.

Admission freezes affected scheduling, retires incompatible planning/Node sources,
revokes mutation and queued Starts, and records Stop or exact completion settlement
links atomically with authorization consumption and command receipt. Pending
operation remains independent of Planner process lifetime and Owner session expiry.
Only a frozen authorized system operation may perform later deterministic steps.

Use existing trusted `stop` and `settle_completion`. Add backend-only settlement
purpose `specification_change` to avoid the existing `correct` branch launching
old-Spec work. Keep original completion identity and lease settlement pointer.
Already-finalized effects remain truthful historical input. Affected completion
projection must not roll back physical settlement merely because old authority was
revoked or the semantic basis changed, and cannot create current evidence that
bypasses the publication freeze.

Both planning/Node pumps, guidance follow-up and queue enqueue/promotion honor the
operation-owned freeze. Ended change-owned Attempts cannot be mistaken for Runtime
failure. Wait for exact process release, all linked effects and leases; no silence,
logical cancellation or timeout establishes physical absence. Expose recoverable
attention when an effect fails; Retry reuses its immutable identity.

After settlement, publication rechecks authorization/basis/input/ownership. In one
transaction append Specification, switch pointer, record retained Plan/applicability,
invalidate or retain exact evidence, update activations, resolve linked obligation,
record event/receipt and schedule only permitted fresh context. No synthetic Plan
revision. Currentness accepts the immutable creation basis or an exact published
applicability chain, still requiring current Plan/Node/activation. This does not
renew an old Attempt/source: fresh commands require fresh current-spec source.

Never-started stays PLANNING. Started initial planning gets a fresh intent only
while still started; Owner Stop to PLANNING survives. Unfinished Node retains its
activation with explicit applicability and fresh source; completed invalidation
uses the settled reactivation primitive without clearing independent Stop/blockers.
Carry-forward preserves original creation/manifest basis and adds new applicability.

Withdrawal first records intent, then reconciles admitted effects. Keep the old
Spec and release only this operation's freeze. Fresh old-basis continuation is
permitted only when still authorized; never revive an old Attempt or acceptance.
Task Cancel is terminal for authority while cleanup can continue. Accepted-delivery
seam rejects change admission; actual provider revocation remains out of scope.

## Implementation map and checks

Backend owns new `task-specification*.ts` modules and SQL/protocol, with necessary
hooks in Task conversation/records/planning/Node/guidance/queue/completion/service.
Runner changes are limited to generated wire consumers, canonical Planner CLI
allowlists/prompt and immutable retry tests. Root owns specs and installed native
acceptance. Reuse existing libraries, transport and physical host operations.

Research: [proposal contracts](research/proposal-contracts.md),
[settlement/runtime](research/settlement-runtime.md),
[acceptance](research/acceptance.md). Run meaningful direct SQL attribution tests,
production-pump races, process-crash publication tests and full relevant suites.
Native proof distinguishes actual CLI/Owner/effect/Git evidence from synthetic PG
results. Freeze/build/backup/deploy only into existing services; retain prior source,
receipts, manifests, every failed observation and exact recovery identity.
