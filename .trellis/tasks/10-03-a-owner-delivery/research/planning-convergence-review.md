# Research: Planning convergence review

- Query: Independent backend convergence of PRD/design/execution order and Web acceptance contract; identify blocking architecture, admission, freeze, migration and Cancel gaps.
- Scope: internal; read-only product source. Provider-specific readiness/permissions/merge policy are reviewed independently by the provider researcher.
- Date: 2026-10-05
- Active task: `.trellis/tasks/10-03-a-owner-delivery`.
- Owned output: this file only. Preserve concurrent edits; no implementation, commits, lifecycle, DB, provider, host or model effects.

## Findings

**READY for backend implementation.** One concrete permission/current-configuration gap was found, resolved by the parent's explicit decision, and verified in updated PRD requirement3 and design admission prose. No remaining blocking backend contract or architecture defect was identified. Shared wire/aggregate bounds still belong to the single contract owner's prerequisite handoff; implementation must complete that handoff before dependent UI/coordinator edits.

### Reviewed files

- `prd.md`: seven acceptance criteria, Stage A support boundary, exact Owner versus development authority and separate future correction/installed acceptance scope.
- `design.md`: proposal/confirmation/admission, exact manifest/persistence, input serialization, nominated accepted preparation, frozen authority, shared item ownership, Cancel and rollback.
- `implement.md`: single schema/persistence owner, provider isolation, accepted coordinator and Web after concrete schema handoff, main wiring/integration and focused validation.
- `research/backend-acceptance-design.md`: actual source signatures/seams, original result/carry/mapped scan/actual waiver authority, immutable legacy preparation and input provenance, affected files.
- `research/owner-acceptance-ui-design.md`: Owner prepare/confirm/admit, exact read/receipt/journal authority, frozen Retry and session/Task fences, supported/unsupported layout and conversation behavior.
- Existing source read only at the concrete permission/configuration, proposal/currentness and message-event seams noted below. Previously loaded architecture/spec contracts were reused; no broad exploration or tests were repeated.

### Resolved blocking finding: first permission observation changes frozen configuration

`apps/server/src/publication-policy.ts:13` computes the stable configuration scope, but `:19` uses either an actual permission proof's fingerprint or that fallback scope. The first real proof therefore changes `PublicationScanConfiguration.permission_fingerprint` and its digest. `apps/server/src/remote-preparation.ts:90` requires a permission proof on the exact request before push. Accepting a workflow-free completed scan whose request had no verified proof could otherwise strand the batch: first issuance changes the frozen configuration, while rebuilding source/candidate/scan after acceptance is forbidden.

Selected resolution: **a modified GitHub candidate must already bind an actual verified permission proof and matching complete-scan configuration fingerprint before admission**. An expired proof may renew only that same authority fingerprint. First push, PR and checks may still be absent. No first observation after acceptance may change frozen configuration. This is now explicit in `prd.md` requirement3 and `design.md` Admission and cutoff; it preserves source privacy and existing before/after-token guards without widening profile or creating a new candidate. Repository-free/no-change acceptance keeps zero provider/token effects.

### Authority and serialization are feasible

- `TaskProposalAction` already contains `accept_delivery`; local `delivery_operations` remain migration22 preparation records. Dedicated delivery confirmation explicitly rejects the generic confirmation path, avoiding `OwnerCommands.confirm`'s lack of delivery-specific input/source guards (`apps/server/src/owner-commands.ts:79`). The design requires exact confirmation/admission envelope/result SQL linkage, not a UUID/FK/consumed token alone.
- Admission and message append use the same Task `FOR UPDATE` (`task-conversation-state.ts:52`; submission at `task-conversation.ts:104`). Message-first rejects without consuming authorization; Accept-first records exact batch plus admission sequence before later immutable attribution. The paired seam from migration19 gains actual batch scope/cutoff ownership instead of a synthetic setter.
- Accepted preparation adopts only exact pending/unstarted push/create/update through persistent batch-operation/request-digest links. Started/unknown effects reconcile first. The accepted branch retains source/candidate/mapping/configuration/scan/actual waiver, owning Runner/channel/profile and pre/posttoken checks at `remote-preparation-access.ts:28`, `:46`, `:78` and provider effect admission at `remote-preparation.ts:192`. It excludes only later scratch conversation, rather than calling ordinary pending-input/all-Planner guards.
- Full canonical membership/carry and repository-free/no-change semantics remain bounded and provider-neutral. The design rejects incomplete manifests and unsupported multi/plain-Git/after-acceptance before authority consumption; mapped zero-new-commit remains modified. No new Task state or automatic execution origin was introduced.

### Reviewed basis and processed-input currentness

The implementation must preserve the **original reviewed TaskBasis** through prepare/confirm/Accept. Existing `prepareTaskProposal` captures `{control_version,specification_id,plan_id}` from locked Task (`owner-commands.ts:43`, `:63`); exact consumption compares it (`:123`). Proposal/confirmation events must not advance that semantic basis. `planningEvent` only increments `event_sequence` (`task-planning-state.ts:29`), so it provides the existing event pattern without self-invalidating approval.

Ordinary message submission increments conversation sequence only (`task-conversation.ts:53`). A reply increments conversation sequence/version/watermark and records an event, rather than bumping Task control (`task-conversation-state.ts:480`, `:508`, `:513`). Consequently:

1. Pending ordinary input arriving after proposal still blocks confirmation/admission, under current guards.
2. After a genuine reply-only resolution or explicit withdrawal and required local cleanup, unchanged result/TaskBasis can remain eligible. Recheck all child guidance/requirements/issues/current result facts; “processed” alone cannot excuse them.
3. Accept stamps the then-current conversation sequence. Changing event sequence, processed watermark, new observation times or proposal/confirmation bookkeeping must not silently enter the reconstructed result digest and invalidate otherwise identical approved content.
4. A material source/Spec/Plan/activation/evidence/candidate/configuration change requires fresh review; the UI never substitutes a newly fetched basis into its stored confirmation command.

The parent refined the Web research and design admission prose during review: unresolved pre-cutoff input blocks, resolved reply-only sequence drift can retain reviewed result/basis, and proposal/confirm events do not bump Task control or add unrelated sequence/timestamps to the digest. These exact updates were verified in current `design.md` Admission and cutoff and `research/owner-acceptance-ui-design.md` confirmation prose. This consistency item is resolved; it grants no permission to auto-update a saved command.

### Migration, Cancel and dependency ordering

- The selected migration24 preflight **rejects legacy nonnull acceptance seam values with no changes**, rather than clearing provenance or manufacturing Owner receipts. Preserve existing migration bytes/checksums; real new constraints reject direct setters/missing JSON/substituted membership. Legacy seam-only tests must reseed their own synthetic fixtures. This decision resolves the original legacy-data question without an approval gate.
- Existing canonical Cancel rejects accepted batches (`node-execution.ts:322`, `task-planning.ts:97`). Dedicated accepted Cancel plus Web routing is required and explicitly owned by the coordinator. It uses Runner-before-Task locks if it stops Attempts, revokes new effects, leaves Task CANCELLED and shares item exclusion with prep/close/merge. Unknown merge delays PR close; late success is history and cannot revive Task. COMPLETED rejects new Cancel but authenticated committed receipts still replay first.
- Existing shared `reactivateSettledNodes` permits REVIEW (`task-records.ts:119`), so coordinator freeze changes to shared reactivation/scheduler/dispatch are required. Design explicitly assigns them; existing routing/mutableSpecification already covers much of guidance/Spec/Replan mutation.
- Request Changes/restoration remains next leaf. Immutable input provenance cannot be cleared (`0019_task_conversation.sql:111`). Current leaf retains Cancel and truthful unsupported correction; it creates no fake review-routing or input restoration transition.
- Persistence/schema handoff precedes accepted coordinator/Web. Provider worker owns its independent adapter only; main owns app/main wiring and integration. Actual child assignments must name non-overlapping files and serialize shared module edits, as the execution plan requires. No circular dependency prevents this ordering.

### Required implementation evidence retained

The plan correctly assigns distinct evidence to real PG authority/lock/commit boundaries, protocol generation/Owner HTTP fences, current provider mocks versus authorized external mutation, and actual current built Web layouts. Existing synthetic accepted-pointer conversation tests do not count as product admission. Current acceptance-before-push and token-I/O Cancel need new focused boundary cases; unchanged physical Runner/scan evidence may be reused only for unchanged claims. No broad test/count gate or duplicate native/browser matrix was added by this review.

## Caveats / Not Found

- Provider-specific readiness, test-merge precedence, App profiles, method selection and response classification are delegated to the independent provider convergence review; this READY decision does not approve those unreviewed details.
- Final concrete collection/byte bounds and wire/receipt variants are intentionally the contract owner's first implementation prerequisite. Consumers must wait for their handoff.
- Exact backend/frontend file ownership remains a dispatch responsibility of the main agent; this review edited no product/shared planning artifact.
- Validation scope/result: read-only comparison of assigned planning artifacts against the cited existing source/architecture; verified selected permission prerequisite in current PRD/design. No product tests, DB, host or provider calls ran. Research structure/format checks apply only to this written review; later material plan edits require reconciling their changed claims.
