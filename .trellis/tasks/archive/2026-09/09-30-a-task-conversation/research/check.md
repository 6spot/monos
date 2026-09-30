# Independent review — Task Conversation

Status: **code clear for source freeze; final native acceptance pending**. Baseline: accepted
Node execution leaf `c5ce437`. The current source and native acceptance evidence
have not been frozen. This report covers code readiness, not final ACCEPT.

## Findings (fixed)

- `packages/protocol/schemas/v1/contracts.json`: Owner commands failed AJV
  strictRequired compilation; canonical commits accepted incomplete source
  identity and legacy routing. Backend fixed both. All 6 independent protocol
  regressions pass, including valid command/Dispatch/legacy positive cases.
- `packages/db/migrations/0019_task_conversation.sql`: independent input/source/
  reply/Attempt and guidance assignment/followup references allowed inconsistent
  attribution. Backend added exact checks. Reviewer tests reject cross-Task and
  same-Task cross-activation attribution using otherwise-valid committed fixtures.
- The manifest validator accepted numeric guidance IDs via text conversion.
  Backend requires string elements and matching frozen assignments. Tests reject
  numeric/mixed/duplicate/unassigned IDs and version-1 handling declarations.
- Frozen source assignments could previously be added later. Migration now
  requires membership in the immutable source context and all frozen assignments
  at source commit. Reviewer fixtures now insert real guidance items, source and
  assignments in one transaction, keeping context/prompt/digest/launch consistent.
  New regressions reject missing assignments and later unfrozen additions.
- **Terminal handling attribution:** a successful guidance obligation could be
  rewritten to point to a conversation Stop. The new regression reproduced this
  with real service completion before the fix. Backend made non-pending obligation
  dispositions immutable and added a deferred check against the exact successful
  completion, manifest, declaration, assignment and Node completion. Tests now
  reject Stop-as-handling, admitted-but-unsuccessful completion, later operation
  replacement and reverting handled to pending; real successful handling passes.
- `apps/server/src/node-execution.ts`: a normal scheduler pass treated a
  guidance-owned cancelled Attempt as factual failure, blocking continuation.
  Backend checks durable waiting-followup ownership both in selection and after
  locking. The independent scheduler regression passes with Stop still outstanding
  and proves same-activation continuation only after settlement.
- Completed Continue originally used an Owner Stop flag alone to reactivate work.
  Backend requires actual waiting guidance. The independent regression proves a
  Stop that loses to completion cannot authorize guidance-free rework.
- `NodeExecution.command(cancel_task)` used a confirmed acceptance proposal as an
  accepted-delivery shortcut. Backend removed it in favor of the actual accepted
  pointer. Independently rerun proposal/authorization fixture passes.
- `TaskConversation.status` exposed string counters and incomplete/unbounded
  recovery lists. Backend added typed numeric summaries, explicit completeness,
  ordered-head preservation and bounded operation/recipient pages. Owner history
  query validation now precedes SQL and cursor construction. Focused numeric,
  query-budget and over-64-input pagination tests pass independently.
- Assigned-guidance withdrawal now preserves necessary unfinished continuation
  while removing the withdrawn instruction. Its focused real PG test passes.
- `infra/probe/task_conversation_driver.py`: prior reports admitted a completion
  boundary while asserting pre-completion Git state. Root restricted the driver to
  the exact prior Attempt at `held_for_stop` and added negative regressions.
- `infra/probe/task_conversation_probe.py`: execution isolation omitted initial
  Planner Attempts/sources/Starts/effects. Root added their comparison and actual
  busy-input intermediate evidence. All 7 focused Python tests pass.

## Findings (not fixed)

- No remaining confirmed defect from this review is left unfixed.
- Final acceptance is intentionally outstanding: complete the owning spec sync,
  frozen-source full gates and Linux/native installed-CLI/restart evidence, then
  independently validate those artifacts. Earlier-leaf evidence is not acceptance
  evidence for this leaf. These are main-session integration responsibilities;
  this reviewer did not deploy, commit or start services.

Disposition history uses existing immutable input resolutions/routing, Agent and
Owner command receipts, guidance provenance/supersession links, terminal activation
obligations and completion manifests/Node completions. No separate generic history
table is required. Later withdrawal of parent guidance affects pending obligations
and cannot rewrite historical handling; terminal projection is now DB-enforced.

## Verification

Independent checks after fixture adaptation and terminal constraint fix:

- Lint: **pass** (`pnpm lint`).
- TypeCheck: **pass** (`pnpm typecheck`, server/packages and web).
- Diff whitespace: **pass** (`git diff --check`).
- Protocol generation: **current**; dedicated wire review **6/6 pass**.
- PostgreSQL dedicated review suite: **8/8 pass** against isolated schemas on real
  PostgreSQL. Includes frozen assignments and terminal handling checks. The rerun
  requested after restoration of SSH forwarding also passed **8/8** (48.21 s).
- Additional focused main-suite regressions: **4/4 pass** (assigned withdrawal,
  proposal confirmation, Owner query/numeric pages, ordered head beyond 64 inputs).
- Earlier in this review: focused Runner adapter/daemon/host/local Conversation
  tests and explicit journal TaskTurnRetry/GuidanceDeclarations tests **pass**;
  Python conversation driver/observer tests **7/7 pass**.
- Backend full/focused implementation runs are documented separately in
  [backend-implementation.md](backend-implementation.md); they are not relabeled
  as independently rerun here. Frozen-source full and deployed-native gates remain
  pending.

Reviewer-owned files: this report,
`packages/protocol/test/task-conversation-review.test.ts`, and
`apps/server/test/postgres-task-conversation-review.test.ts`. Product fixes were
coordinated with backend/Runner/root owners to avoid shared-file edit races.
