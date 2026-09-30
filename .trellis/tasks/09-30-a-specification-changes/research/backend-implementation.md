# Specification backend implementation — final review pending

Owner: `/root/specification_backend`. No commit, deployment or historical migration edit.

## Implemented surface

- Additive migration20: immutable proposals, normalized sources and canonical attachment;
  one originating obligation, exact existing Owner authorization, durable change and
  shared publication slot; attempt/effect links, exact input deferral, publication
  and activation/evidence applicability. Old manifest/receipt content is untouched.
- Canonical Planner `prepare_specification_revision` then terminal reply routing
  `specification_proposal`; optional `apply_specification_revision` consumes exact
  Owner receipt without ending the conversation turn. A later pending current input
  requires explicit exact Owner deferral, never implicit classification.
- `TaskSpecification` owns typed authenticated `/v1/owner/tasks/specification/commands`:
  `edit_specification`, `confirm_specification`, `apply_specification_revision`,
  `defer_specification_inputs`, `withdraw_specification`, `retry_specification`.
- `/v1/owner/tasks/:task_id/specification` provides typed status/impact;
  `/proposals/:proposal_id` exact full text/source/authorization detail;
  `/proposals?cursor=`, `/revisions?cursor=`, `/revisions/:revision_id` expose bounded
  immutable history; `/changes/:change_id?cursor=` exposes physical effect links;
  `/commands/:request_id` recovers original command response.
- Authoritative source construction, queue admission/promotion and execution/guidance
  pumps honor the shared publication slot. Requirement-owned completion is retained
  as historical evidence before publication, not rejected as stale or projected current.
- Trusted existing Stop/settle_completion effects retain identity and leases.
  `specification_change` settlement purpose cannot run old-basis correction.
  Unfinished activation gets explicit applicability + fresh source. Completed
  invalidation gets a new activation. Carry binds exact manifest and unbroken prior
  applicability; fresh completion after earlier refresh can become next carry evidence.
- Initial planning uses a dedicated `requirement_change_id` provenance column for
  background fresh intent, not a fabricated Owner receipt. Owner Stop remains effective.
- Publication and cancellation/withdrawal respect independent blockers/guidance and
  retain completed physical results. All pending physical operations remain linked;
  Retry does not revive original completion once paired settlement owns it.

## Checks observed (not final freeze evidence)

- Initial main suite: 5/7 passed; two failures were migration trigger record/SQL alias
  collision (`a.attempt_id`), fixed. Targeted rerun: 2/2 passed.
- Expanded main suite: **10/10 passed**, 112.7 seconds.
- Hard settlement suite: **4/4 passed**, 54.4 seconds: cancelled/already-finalized Git
  pairs, withdraw after completion, and fresh change-owned initial-planning intent.
- Five-suite tunneled PG run: **67 passed / 27 failed** of94. New main+settlement and
  existing Node suites passed. Initial planning had23 default5-second timeout failures
  (including cleanup deadlock after timed-out work); Conversation had4 fixture Runner
  heartbeat expiry failures on long scenarios. This is retained failed evidence.
- Sequential regression with30-second test timeout: **45 passed / 4 failed** of49;
  all32 initial planning passed. Four long Conversation cases still expired their
  synthetic Runner heartbeat. Targeted fixture now explicitly sends real service.touch
  before later promotion (product TTL unchanged). Targeted rerun: **4/4 passed**,
  96.54 seconds. Planning32 and Conversation17 have scoped passing evidence; this
  is not a single final combined all-green run.
- Final quick-check session73010 exited0: lint, typecheck, protocol freshness,
  native TypeScript app import and diff check passed before the final SQL-only
  authorization tightening.
- Unit run:268 passed/1 failed because prepare summary initially narrowed the shared
  complete_node summary schema. Shared limit restored to262144, prepare remains4096;
  generation completed; final unit rerun: **269/269 passed**.
- Independent reviewer found four real negative-SQL/API failures: duplicate guidance
  identity, forged deferral receipt, cross-obligation current pointer and lost live slot.
  Fixes added; independent reviewer owns retest. Additional exact source completeness,
  authorization identity, typed eligibility facts and effect reads added subsequently.
- Own main/settlement/initial inputs combined: **18/18 passed**,116.80 seconds.
  Expanded input/history paging suite: **5/5 passed**; final fairness test: **1/1
  passed**,23.04 seconds (five skipped). This gives20 distinct own cases with passing
  scoped evidence before the last authorization tightening.
- Process worker reports **8/8 passed**,107.65 seconds. Earlier7/8 run retained in
  process-tests.md; suspected concurrent schema change, then targeted carry2/2
  passed. Root owns rerun of frozen process suite.
- Reviewer protocol **6/6 passed**. Latest ten-case PG run had1 pass/9 failures
  after migration20 used alias `old`, colliding with PL/pgSQL `OLD`; root corrected
  it to `previous_proposal`. Final reviewer rerun remains pending.
- Last SQL tightening checks full direct-edit payload, exact confirmation payload,
  apply basis and inner response request/status. Targeted direct edit + Agent apply
  rerun could not enter schema setup: **2 setup failures**, ECONNREFUSED at the local
  DB tunnel. This is infrastructure evidence, not a passing product check.
  After root restored the tunnel, the same final direct-edit/Agent-apply checks
  **2/2 passed**,14.72 seconds (14 skipped), on the final SQL constraints.

## Current tests / hooks

- Main: `apps/server/test/postgres-task-specification.test.ts` (10 cases).
- Settlement: `.../postgres-task-specification-settlement.test.ts` (4 cases).
- Inputs/history: `.../postgres-task-specification-inputs.test.ts` (6 cases).
- Reviewer owns `...-review.test.ts`; Runner worker owns `...-process.test.ts`.
- Constructor hooks: `beforeCommit`, `afterCommit` for Owner command transaction;
  `beforePublicationCommit`, `afterPublicationCommit` for actual inline or pump
  publication. Hooks neither authorize nor mutate records.

## Remaining before freeze

Product and migration are held stable for the final reviewer10-case rerun. Latest
SQL authorization tightening passed targeted direct-edit/Agent-apply positive
checks after the DB tunnel was restored. Backend implementation is source-ready;
final combined freeze/acceptance remains conditional on independent review. Root owns final full Linux PG/Go/build/image and installed native acceptance;
synthetic fixture Git results do not establish physical workspace behavior.

The publication pump now orders waiting changes by durable `last_checked_at` so
an input-blocked Task cannot starve another Task. Polling alone leaves the Owner
operation version unchanged; the focused fairness case proves both properties.
