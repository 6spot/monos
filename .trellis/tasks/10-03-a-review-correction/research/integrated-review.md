# Integrated review — READY

Active task: `.trellis/tasks/10-03-a-review-correction`.

Final review is **READY** for the frozen candidate recorded in the final disposition
and source inventory below. Scope is read-only integrated Task correction, delivery,
Runner/protocol and protected Web; this research file is the only writable file.
Earlier staged findings and NOT READY observations are retained as dated history;
the final section supersedes their pending status.

## Reviewed snapshot

Read PRD/design, the planning convergence and backend correction research,
architecture modules 02/04/05/06/07/08, collaboration and verification-scope
guides, current migration 25, and `task-review-{basis,commands,state,sources,coordinator}`.
The reviewed files were untracked at the initial scoped status check; shared
changes have been preserved.

Migration 25 SHA-256 when the findings below were inspected:
`62eeee3f8506196ccec4f312c3b52f85cc8337d60830efc778643e15c36c8430`.
Concurrent edits invalidate this snapshot as a final verification target.

## Findings observed as addressed in source, not independently tested

- Revoked accepted-pointer reinstallation: migration 25 lines 121–126 now require
  an unrevoked live batch for NULL-to-batch installation and exact original Owner
  revocation for batch-to-NULL clearing. The final receipt/manifest chain remains
  part of the deferred authority review.
- Possible merge rejection: `task-review-commands.ts` lines 28–30 now require a
  settled failed/rejected result, its digest, and an exact retained original merge
  observation. Migration 25 has the corresponding revocation admission refusal.
- Input Replan dismissal: the original reconsideration stays immutable;
  `task_review_input_successors` and `currentReviewInputOperation` record/select a
  new operation. Exact successor insertion authority remains open below.
- Requirement transfer exit: current operation summaries allow Withdrawal of an
  active main feedback after transfer. Requirement withdrawal creates a new main
  feedback operation rather than changing its original terminal resolution.

## Findings not fixed by this reviewer

All items below were sent directly to the backend owner while implementation was
in progress; the main agent was notified of the state transition gap.

1. **Direct UPDATE can clear formal review guards without an actual outcome.**
   Migration 25 lines 88–103 preserve identity and existing terminal facts, but
   allow active feedback to become resolved and pending reconsideration to become
   resolved/transferred. Their deferred authority triggers at line 162 are
   INSERT-only. `validate_review_operation` (lines 182–199 in this snapshot)
   checks basis, predecessor, source version, and issue attribution but does not
   require a resolution/Owner exit for a new terminal status or physical
   settlement for `settlement_pending=false`. A valid initial source-free
   operation can therefore be updated to resolved with settlement false; paired
   feedback/input status updates remove the guards used by
   `task-review-state.ts` lines 17–18. Require real terminal receipt/transfer or
   recorded Owner exit/Cancel/publication as appropriate, and real settlement.
   Retry/version/source changes also need exact recorded generation authority;
   terminal historical provenance must survive authorized cleanup.

2. **The SQL feedback manifest checks shape, not complete actual evidence.**
   Migration 25 line 132 binds task/spec/plan and nonempty outputs to the Owner
   receipt, but does not prove full Plan membership, canonical completion/current
   activation, actual retained carry/source, exact Artifact metadata, or effective
   basis. A receipt's review digest cannot establish that an arbitrary manifest
   contains those facts. Reuse the applicable local evidence constraints from
   migration 24 lines 100–110, independent of remote permission/preparation.
   Check the real admission baseline once; later Rework must not invalidate the
   retained historical manifest by comparing it with new activations.

3. **A real Agent receipt can authorize a different recorded resolution body.**
   Migration 25 lines 148–152 bind source/Attempt/request and permit four command
   names, but do not bind `kind` and body to that command's exact payload/result.
   For example, an actual `apply_review_rework` receipt can be reused for a
   `requirement` kind or changed Node IDs/reason. Bind each command to its actual
   terminal kind, proposal/Replan identity, or exact reconsideration routing.
   Issue creation should also require committed status and the exact result
   source, not merely a matching command name/reason/obligation ID.

4. **Successor membership is append-only but its actual ownership is unproved.**
   Migration 25 lines 114–118 have same-Task FKs, but no insertion validator for
   the successor tuple. `task-review-state.ts` line 43 and source authorization
   treat a selected successor as the owning operation. Require exact original
   reconsideration, feedback, purpose, predecessor, dismissal request, actual
   dismissed Replan/decision/Owner receipt, and one successor per predecessor.
   An unrelated same-Task dismissal receipt must not authorize a different branch.

5. **A settlement marker alone does not prove physical quiescence.**
   Migration 25 lines 109–113 allow direct insertion of a revocation settlement
   with only its FK. `reviewRevocationSettled` accepts marker existence as fact.
   Constrain insertion against actual original remote/merge effects, Attempts,
   Start/Stop operations, and workspace leases. The application coordinator's
   settlement check is present, but does not constrain direct SQL insertion.

## Verification

- Performed path-scoped read-only source/SQL inspection and SHA-256 snapshotting.
- No tests were run, no provider effects occurred, and no product files were
  edited. This follows the bounded assignment and avoids repeating established
  evidence while the migration is changing.
- Main owns the affected PostgreSQL run after the migration freezes. The above
  UPDATE rejection and exact receipt/manifest/successor checks are pending static
  closure and affected evidence; no independent final READY is claimed.

## Resumed integration inspection (2026-10-06)

Migration snapshot inspected during active edits:
`c95259f2a639e19db5791892faed46f73e78fb2da414fdd48b062b767c909d69`.
This is not a frozen handoff hash. New validators now statically address complete
output/Artifact membership, command-specific resolution payloads, committed issue
receipts, exact input successor tuples, and main status/settlement transitions.
The original five findings above describe the earlier snapshot, not five claims
that every part is still unfixed.

### Root-owned remote integration finding

`owner-delivery-preparation.ts` lines 74–78 permit a new operation ID after a
linked accepted operation is revoked with no SQL mutation claim. Its requests
still retain the exact local preparation/result; Worker guards reject reuse of
the old accepted identity. The protocol and Go journal bind each remote result
and ACK to its operation ID and request digest.

However, a previously dispatched push can already have `intent.json` before it
obtains a push grant (`runner/internal/host/publication_remote.go` lines 178–184).
Correction revokes that SQL operation. A denied grant then produces a retained
blocked result with `push_started=false` and `worker_absent=true` (lines 273–282),
but `remote-preparation.ts` line 128 rejects all results for revoked/inactive
operations. Go's successor guard requires predecessor result, actual absence,
and ACK (`publication_remote_journal.go` lines 96–105), so the fresh ID is blocked
permanently. Sent to root: settle/acknowledge the original identity through a
strict read-only no-effect path, preserving its revocation and prohibiting any
new grant; do not weaken the successor physical guard.

### Remaining SQL authority details sent to backend

- `validate_review_settlement` lines 231–232 does not yet include original merge
  effects/claims or started/unknown merges; the root application hook does.
- Terminal operation provenance can still be rewritten without a version/Owner
  decision by keeping its status unchanged and clearing source/previous-source
  IDs. Legitimate Withdrawal has an actual versioned exit; arbitrary updates need
  rejection or binding to that exact exit/generation history.
- An active feedback's owning-operation pointer can change while its status is
  unchanged, bypassing the transition validator's early return. Require exact
  same-feedback main purpose and recorded predecessor/successor authority.

Anti-repeat still awaits final backend handoff: a current-operation dismissal
field alone must not lose the historical same-feedback semantic restriction
after a requirement transfer/Withdrawal creates another operation.

No tests or provider actions were executed for this inspection. Product files
remain read-only; final READY/NOT READY awaits stable source/SQL handoff and root's
affected verification evidence.

## Final review resumed (2026-10-07)

The replacement reviewer recorded the scoped dirty state, read the saved native
check injection plus omitted relevant contracts/task artifacts, and inspected the
integrated SQL, review commands/sources/coordinator/reads, requirement/Replan and
Conversation adapters, Node scheduling/Cancel, delivery workers, revoked push
recovery, Go source/CLI/Stop scope, generated contracts and Web journal/decisions.
Only this report is writable. No suites or external effects were repeated.

Additional concrete findings sent to the owning implementers:

1. `cancelReviewOperations` incremented an operation version while retaining its
   old current source. The SQL source/version validator correctly rejects that
   pairing. Backend now retires the source into retained predecessor ancestry;
   actual live Cancel coverage is being added.
2. Frozen reconsideration proposal candidates originally included every prepared
   draft from an operation that had any terminal resolution. Preparing drafts A
   and B but attaching only B could expose A for main-feedback adoption, leaving
   the feedback transferred to an unattached, unconfirmable draft. Backend now
   requires the exact committed requirement resolution and actual attachment,
   and checks that the obligation remains current and pending during adoption.
3. Terminal operation projection fields also need to bind the exact resolution:
   a matching resolution kind alone does not prove that the projected proposal
   or Replan ID is the one actually adopted. Sent to backend for final SQL closure.
4. Input-origin Replan Dismiss keeps the original reconsideration `transferred`
   while selecting its new live routing successor. Web initially disabled all
   successor actions using that historical status. Web owner accepted the fix to
   use the current operation's canonical Retry/Withdraw capabilities and is
   extending the existing browser case through actual successor Issue/Retry/exit.
5. The original Conversation operation projection still advertised Retry/Withdraw
   for a retained pending or failed input after reconsideration existed. Its old
   Withdrawal path could change original status/resolution while the new routing
   obligation stayed active. Sent to backend to reject new original-turn controls
   after reconsideration, suppress those historical actions, and preserve exact
   receipt replay. The original input-sequence case supplies the regression scope.
6. The Web fixture diagnostic also exposed an admitted product alternative:
   generic `request_replan` was allowed for an input reconsideration source, but
   its branch did not formally transfer the original reconsideration. It remained
   pending; after Dismiss, the successor's attempted resolution would conflict
   with the original operation's generic Replan outcome. Sent to backend/root to
   require the canonical `resolve_review_input` Replan routing for input sources
   and align the CLI/prompt. The main-feedback reason-only tool remains valid.

Initial INSERT overrides also needed the same authority as later transitions.
The frozen migration now requires active feedback, pending reconsideration and
version 1 settling operations with their initial settlement guard. This closes
receipt-shaped insertion of already-resolved rows without an actual outcome.
The reviewer confirmed the frozen migration SHA-256:
`b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.

The previously reported revoked pregrant push journal deadlock has a root-owned
fix: original immutable no-effect results receive their exact ACK without restoring
mutation authority; sent predecessor recovery and successor dispatch retain
operation identity and the Go journal's physical ACK requirement. Root reports
the focused actual journal test and PostgreSQL sent/reconnect case passing. Final
evidence and current hashes will be recorded after backend/Web handoffs freeze.

At that intermediate point the review remained NOT READY pending handoffs and
affected evidence. The final frozen closure follows.

## Final disposition — READY (2026-10-07)

All concrete findings above are now closed in the owning production paths. This
is an independent static review with retained verification from the implementers
and main session. The reviewer changed only this report, ran scoped whitespace
checks and snapshotted the files. No test suite or provider effect was duplicated.

### Findings closed by the owning agents

| Boundary | Closure |
| --- | --- |
| SQL guard clearing and INSERT overrides | Real terminal receipts/Owner exits/publication/Cancel and physical settlement are required; initial active/pending/settling guards cannot be overridden. |
| Complete canonical local manifest | Actual current Spec/Plan, COMPLETED Plan membership, immutable completion/Artifact metadata, exact carry ancestry and canonical manifest/source/effective digests are independently checked. Historical manifests are retained after Rework. |
| Exact resolution and projected successor | Command-specific kind/body and proposal/Replan pointers bind the genuine source/Attempt receipt; same-feedback proposal adoption requires actual attachment and frozen reconsideration ancestry. |
| Input successor and owning feedback pointer | Exact predecessor, original reconsideration, actual Replan dismissal/Owner receipt and unique successor membership are enforced. |
| Physical settlement | Original Attempts, effects, workspace leases, remote preparation and possible/claimed merges constrain append-only settlement insertion. |
| Source retirement and generic Cancel | Version advances retire the current source into its immutable ancestry, retaining original Stop and process capacity until real service settlement. |
| Dismiss history through requirement withdrawal | The semantic feedback/Spec/Plan/result history survives new operation IDs, control changes and Retry. A genuinely later exact issue answer supplies new Owner direction. |
| Unattached reconsideration draft adoption | Only the exact terminally attached current proposal enters the frozen candidate list; an unrelated draft is rejected. |
| Historical input controls | Original receipt replay remains first; new original-turn Retry/Stop/Withdraw are refused after reconsideration and omitted from canonical read actions. Original replied/failed/pending rows and reply history remain unchanged. |
| Input-origin Dismiss actions | Web uses the actual current operation capabilities, retaining the original Transferred status while providing successor Issue/Retry/Withdraw. |
| Input graph insufficiency | Backend and Go deny generic request_replan for reconsider_input; the canonical resolve_review_input Replan routing records transfer before Dismiss. Both prompts agree. |
| Revoked pregrant push journal | Original no-effect result/ACK recovery is immutable, original mutation authority stays revoked, and a fresh successor waits for retained original result plus the actual Go ACK guard. |

### Verification actually performed or reused

- Reviewer: read-only integrated source/SQL/contract inspection; scoped
  `git diff --check -- apps/server packages/db packages/domain packages/protocol apps/web runner .trellis/tasks/10-03-a-review-correction/research/integrated-review.md`:
  PASS. Current exact hashes were computed from disk after the final purpose fix.
- Backend owner: `pnpm exec vitest run apps/server/test/postgres-review-correction.test.ts`:
  13 PASS at 12:05:00, 19.80 seconds. It covers real semantic outcomes, live exits,
  retained replied/failed/pending inputs, exact SQL negatives and populated 24→25
  upgrade preserving prior checksums/revisions. After the final purpose-only fix,
  the affected existing input-origin Replan/Dismiss case passed at 12:07:05,
  1.62 seconds; it proves generic denial without changing input/operation/Attempt/
  Runner rows or creating Replan, then successful canonical transfer and successor
  resolution. The other unchanged cases are reused. Current changed-file ESLint
  and TypeScript no-emit passed.
- Main: `pnpm exec vitest run apps/server/test/postgres-review-delivery-effects.test.ts apps/server/test/postgres-review-http.test.ts apps/server/test/postgres-owner-delivery-worker.test.ts`:
  14 PASS (6 + 1 + 7) at 12:02:09, 7.30 seconds, frozen migration below. Both actual
  lock winners, held grants, original sent/unsent recovery and ACK conflict/ordering,
  fresh acceptance/permanent old-link denial, genuine protected HTTP/replay and
  unknown/finalized refusal plus cancelled late finality are covered. Later narrow
  old-Conversation controls/input-only Replan changes do not alter these exercised
  effects/HTTP/Worker boundaries, so this evidence remains valid there.
- Main: `pnpm build`: PASS. Current Web bundle is
  `index-mkoA3kwR.js`, SHA-256
  `1f5275cc68455ccd9d5a70ad80f0eddbd060a6db6f1b243df4ea2191a7db18f5`.
  Subsequent backend purpose guard has current TypeScript and real PG evidence;
  subsequent Go changes have the scoped consumer check below.
- Retained strict generation and affected protocol/domain evidence: generation
  check and 338 cases PASS on unchanged final schema/generator inputs. Earlier Go
  source/CLI/journal/recovery/shared-fixture checks compiled affected consumers.
- Main: actual Go/Git
  `TestReviewRevokedPregrantPushRequiresOriginalACKBeforeSuccessor`: PASS.
  After the final phase restriction,
  `go test ./internal/local ./internal/adapter -run 'TestTaskReview|TestReviewInput|TestReplan' -count=1`:
  PASS (0.662 / 0.819 seconds). The existing input test covers generic denial,
  allowed main-feedback generic Replan and allowed canonical input routing.
- Web: [focused report](evidence/web-review-verification.md) records four valid
  browser cases: three passed in the current full run, then its only affected
  input fixture branch passed narrowly after two retained fixture failures.
  API/journal 37 PASS are reused on unchanged inputs; Web type/lint/build passed.
  Six representative images were inspected and all six exact owned schemas were
  independently confirmed absent. The later backend restriction agrees with the
  canonical input route already exercised by the browser.

### Evidence limits and remaining work

No unresolved finding remains within this leaf. PG/browser process absence,
provider permission and upstream Git inputs are explicitly synthetic; they prove
formal admission/settlement behavior rather than installed native supervision or
live GitHub effects. Actual local Go/Git journal evidence proves its own physical
boundary. This review does not reopen prior accepted evidence or claim new Linux
isolation, installed CLI/provider compatibility, production App issuance,
multi-repository success, parent package completion or Stage A completion.
The combined installed delivery gate remains the next task. These limits do not
require another unrelated suite or repeated live mutation for the present leaf.

### Frozen review identity

Base HEAD: `0fd3f654704e0ef558aec98dba26312aa107dbe0` plus this dirty candidate.
Migration 25 SHA-256:
`b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18`.
The following 82 task-owned product/generated/fixture/test files form the exact
review input inventory. The SHA-256 of its UTF-8 bytes, with two spaces between
hash/path and one LF after each sorted row, is
`5aa774cd915d771ea9b05c1545df39404667bc2adebaebfb5be9f83b1a338bfa`.
Framework/spec/task/report edits are excluded from this product inventory;
unchanged dependencies remain identified by the base HEAD.

```text
c29be9fb9716912d2d1b0626888e1f93d5ceb235a148954446257baa46659a71  apps/server/src/app.ts
ea68f933a8d3026fd82d45ea97ee845567d9bc765ee9dc0863b427e3bfd2d28f  apps/server/src/dispatch-queue.ts
15095fe8dc50477db2f45f436dd3eeb32cba8248cd1e83269070568fe76e8f18  apps/server/src/main.ts
254eaeb539beabd1abc9bda119a4e2b7240111ec4c9ae239e02731392c4cf867  apps/server/src/node-execution.ts
cda7bd05391ac0ba95894aeca22a4bcefb43822f4142c9fa70148f1956370fde  apps/server/src/owner-delivery-control.ts
8fab5d7dded79c8efbe0161a7aaf2fa6b6ff4f22aed9180a35f1ce018e201e8a  apps/server/src/owner-delivery-guards.ts
40a13c50ffd8dd450ed45598c3c86655a1a8b36bc8cb4712f335bf5ff2538dfc  apps/server/src/owner-delivery-preparation.ts
cef3d3a50c5c58d782e6dd6afed0f935fd7326d9931e4b1e0c09a109ce8dfc8a  apps/server/src/owner-delivery-state.ts
502a6283ad684facc5afd48d6747593093b40086029fa425323041c8ab9d58c4  apps/server/src/owner-delivery-worker.ts
622ee12beccd2eb16fdf292ffb87e362b91d493c440368a749e85226121df0b8  apps/server/src/owner-review-control.ts
5af640af66d3b271b06a141b102706c44f473ceda86f22b59e3ae727b5d1722c  apps/server/src/remote-preparation.ts
7212720ba29344d1a60a632c8c792ce5e66ee851edc2393a10d93a4724a9a789  apps/server/src/runtime-scheduling.ts
df3f8a196dcd85c6117a8bf86e23115bee4a27ebd2bf00de4798fe2d2285d932  apps/server/src/service.ts
0a769a188778b1c9248e40d5d26da91fe487bd75bfabde50f27b0840a72c4ffe  apps/server/src/task-conversation-reads.ts
c89aa70c0f5f6aa80e6f5d4423838df0c5a938b36586a6a0df24af09223b9094  apps/server/src/task-conversation-state.ts
47878703ef1c5114b4db7801098c6bda8148b90680fb347fda13af6fae96ecc8  apps/server/src/task-conversation.ts
c1e6aaf3b6ed01e6b03485316427082e2c3a234a2158ca5223b59eb4a82db514  apps/server/src/task-guidance.ts
e03e6685b37095c665676312d0871e161274df83993eba5f610bf57f72a8d844  apps/server/src/task-planning.ts
739b4cfd34dbf96be5298e6740362bff25880d98b2fca60a4681a3f9143aa369  apps/server/src/task-replan-reads.ts
92999a0462d7042d2f43a7ab4e659347e696f50bc8ee925d11eac8e2d3dce6d3  apps/server/src/task-replan-state.ts
0b5aee76a8d96768f069c45308b3abce9bb3191f87854617a096d2eca7832a87  apps/server/src/task-replan.ts
d71e91a528233320b037ddbc93c39f86c59a5ed8efe37164b6d69c822bd8aa35  apps/server/src/task-review-basis.ts
3c6f617f0f98170e7a9d754731dc0e7b8f4239bcdf288d36080577ee6aeca7c4  apps/server/src/task-review-commands.ts
a0533881146ab65e445bc51d687ff9bc6d82099b6f1943f643f3f663340a815e  apps/server/src/task-review-coordinator.ts
4599215182293c03f2eb787568e4f37e5ac0b1508b63656063a9092d71cfaacd  apps/server/src/task-review-reads.ts
88d85af3ae404216bdb5920ef40ac3207e7dba0e65e3f2d647c26850ab38d3db  apps/server/src/task-review-sources.ts
32e127224409bc370932b7bed2f72944f3ce2c25012583292ec58e74b8fe1bc4  apps/server/src/task-review-state.ts
bfe7ce5547ec43a9dd807f56cb73c2ebe9a158e819685c4bf5a60b7ef794e611  apps/server/src/task-specification-reads.ts
05b50c188560ef874c95efe573d50a474f95359ba109db886bd14723111b479c  apps/server/src/task-specification-settlement.ts
4ca44eba12e76a4990a85eeb31912278b7ea066d3e9b04f9fbb09938a055ff46  apps/server/src/task-specification-state.ts
945d6f5ee0facafcdac9a35ddc726e13c28d85d6e8d77e6353ea919710ca7d46  apps/server/src/task-specification.ts
6d9890bb80b2e496f2e6854be4da9f48f92651bc1a77ee755eef69bb678ee5d9  apps/server/test/fixtures/owner-delivery-transaction-child.ts
66a02219ff1c75a997b403173d8b141ac6eecf60ae28d483cbc7ab3e424bbdc2  apps/server/test/fixtures/review-correction-fixture.ts
a9828df5405650ab8b01d934b1e1843e11341c2385a74728c519018752d74b09  apps/server/test/fixtures/review-delivery-worker-fixture.ts
af94df1ff75c0bb7282df09a356ba3f2e2469ed7307c972100209d30f228d8bc  apps/server/test/postgres-owner-delivery-worker.test.ts
7b2a6a9c822f7d6acc753e696a47957981c882d696a1a3c313448a1a21e7650c  apps/server/test/postgres-review-correction.test.ts
e7f5fb94119bf17f51e76f9e8f41ddf637bd98b9930141779129bfc555a85d9e  apps/server/test/postgres-review-delivery-effects.test.ts
e87d8ea2f639171c6cc55742b3abb44fc985365b418494463e278f54d07c89da  apps/server/test/postgres-review-http.test.ts
1322ffc3697a7a9c4c2aa684075a6e259855fa276f2552bdeb1c20bbffcc99ee  apps/web/review-correction.playwright.config.ts
ab37c592b739d34dacb770a1ca2500a1b26aa6c77e1ecc6eaef94c5bd399c339  apps/web/src/features/owner-delivery.tsx
cdb46f23001ac0397cf7eec640e7aed24f3d0eb047265de160b2127e29ddd090  apps/web/src/features/review-correction.tsx
189df4463564c93c96935c7a8ccd88802ab14f763fb170de1205ec36244677be  apps/web/src/features/task-conversation.tsx
0e40e9b616e16836ff0d22c516d4c10052b90e693dfe26a7d4b373897f528aa6  apps/web/src/features/task-decisions.tsx
7c64ca84d111ce0e454c34d8e8f3e0fd4243fe41ddd111d31e736f45701570dd  apps/web/src/features/task-overview.tsx
bde2155b5e391cf4839f968fc06cd21b4162e92e46e4edbc1a16cd3dd54d4131  apps/web/src/features/task-shared.tsx
a93256b32bd7dcc2c7c1879126e74197c81224dd59af5b9a941abbc78923e558  apps/web/src/lib/owner-delivery-api.test.ts
2b816c2a016f1816d44ef49b2ec631f0f8ba0e12c85bb179e7576f158b119774  apps/web/src/lib/owner-delivery-api.ts
f88b73678e25524e619b1062b06d2aacff240a9cdeda50c5d23367529bd4990c  apps/web/src/lib/review-correction-api.test.ts
cf7373379e5b9199c535003197b2970e68eb568b137df01078a731fd8ff18566  apps/web/src/lib/review-correction-api.ts
efd753d7aea0e1b92bbdcf2c2f5266b935c68cb735b11080a44165f9489851d6  apps/web/src/lib/task-api.ts
25babb39cd53e42dc788656abaa947fd0b9fddaa693dfc048b1ad56eaab0a418  apps/web/src/lib/task-storage.ts
d864e26b336a7560a5b9194bc14a6c001d03fdc707460b7ad6c0de27252cb823  apps/web/src/lib/use-task-command.ts
b303d36b60bc39bd747ebb09c6f601279a1ce8d26d774c118aff6e176e9cc118  apps/web/test/review-correction-server.ts
887dbf2423e5d03ca795c621eff91c40db90fe9a596be336d81a4c19c1a97c3d  apps/web/test/review-correction.e2e.ts
b3bca7c345ac49f39795ca4f4e5f99abf6fecf094833ccb88c7befcd84266f18  packages/db/migrations/0025_review_correction.sql
3b324d0fe201e9809c5c9a5e2824e04caa84495ee5ba31a7d45909f5a167ef59  packages/db/src/migrate.ts
d303b86d569d421845906abc72679fabec13965583479143cd9eee7f1b367a84  packages/domain/src/commands.test.ts
621d96261341ec1684b2544f779da2a7d86ea856bb21e7fbd17e352f2662883c  packages/domain/src/commands.ts
9ebc5d834a3312e5735ca0a6ac03f13bedb20de521ab122617c53f118ded6907  packages/protocol/fixtures/validation.json
408cc98218848bad4524664095ede583f8e9f5fa6f5fff8d25f767961f361099  packages/protocol/generated/go/contracts.json
00e3fd6ac9077c61ad7969785347d59e888ed02a371c7caa2076712787465b00  packages/protocol/generated/go/types.go
3a83df9028e84ae6d6def91c1ad655b56ad4b8239c24a4140b186f1fe45591fe  packages/protocol/generated/openapi.json
acd7ccb0ec53c19230e33c44394980d8e0d78da710e4933858019d4672cdec72  packages/protocol/generated/types.ts
408cc98218848bad4524664095ede583f8e9f5fa6f5fff8d25f767961f361099  packages/protocol/schemas/v1/contracts.json
e2f4dd2df98bb426c2621d1d9174d5d2397ef6c7ea8949cf23166667e53802e9  packages/protocol/scripts/generate.mjs
1d9e91df7740cd281a1fc695f20f1331a13278637ad8b4f1e6e3d58bf3355b6d  packages/protocol/src/validation.ts
ae923b42386bc60d48568c4d54e9dc119e0d5163d188d2b250be06b1d39b13c8  packages/protocol/test/review-correction.test.ts
3a5bf1ae38d9ef052ade7641d41f8ad631fec7b965269816d1730ce237aa0808  runner/cmd/monos/main.go
8f1e1757b76184e812498665700499a0a793e60151a3760b3333f7c2d8b10a85  runner/internal/adapter/opencode.go
f3ccf081aa9737055dbf60b39805b4cb5a9e2a242e985976b0bc92b5379f497e  runner/internal/control/publication_remote.go
110758f48c457c380a66a8acc57c0e8fb3f34e677ffd14c7785392c3f743eecc  runner/internal/daemon/recovery.go
b9c8eeaa14b65cebff00a79c7902b12463db8fe103d4ed23237641586d97ce9d  runner/internal/daemon/review_recovery_test.go
aaf202505218dac7ff28266a9614a16bf7282fa75a32307329c4d19bfddb3db8  runner/internal/host/effect_scope.go
c44764778b1554b45d1c551bed83e350f2c858cee689eab21a74afe1c1f38b08  runner/internal/host/helper.go
d242ee67ec0826bc1a683bd0487f632f1cb78a95162c7164e9193ba32b3d600c  runner/internal/host/publication_remote.go
9a96844b1f51428e2cdacd393abe156606765467c631df346ff4b5614a9a85d9  runner/internal/host/publication_remote_test.go
8f447f3928703ad22d9b050b0e7f5ed64b456ba67df2d0a12f30472c5a38094d  runner/internal/local/review.go
6b83989b147f4d6821caa5de222ab0b0519b20febfce6ab41a31867c91fc7c68  runner/internal/local/review_test.go
05008027e21da39f21604c96016c2e50b47ffd0a46c704c1de5e6173cc0b333f  runner/internal/local/socket.go
ef339e87faee6beebb22b8f45e2207b2e48715542db782d295d7c11be68570fe  runner/internal/wire/review_test.go
1c5649cde4160a49bda8734547b1bc57698adc6721d72ef9fdf3d8d47071fb63  runner/internal/wire/scope.go
9c852d2cf704d6f49e7784c80798b3952393dac2c186980469d5a967e4e613fe  runner/internal/wire/wire.go
```
