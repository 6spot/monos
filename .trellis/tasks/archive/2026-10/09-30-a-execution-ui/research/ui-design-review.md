# Independent UI design and recovery review

Status: **ACCEPT — full-scope Execution UI review complete, 2026-10-02**.
Reviewer remains the dispatched trellis-check agent. Root owns shared Web/session/
API/state implementation; the backend implementer owns backend/protocol and the
subsequently assigned feature surfaces. The initial design pass was read-only;
subsequent mechanical fixes and owner-coordinated corrections are recorded below.

Read PRD, design, implement, implement/check manifests and both research reports;
cross-checked relevant frontend/protocol/backend contracts and actual command/read
paths. Prior native Replan acceptance is complete and is not repeated here.

## Findings requiring an explicit implementation contract

### 1. Session preflight alone cannot bind a mutation to its stored session

Evidence: existing `app.ts` ownerCredential reads the actual request Cookie/Bearer;
Task commands and receipts currently accept that credential without a caller's
expected session UUID. A GET /session for A followed by a POST leaves a window for
another tab to log in as B and replace the shared cookie. A's old pending envelope
can then execute under B despite the client preflight having passed.

Root accepted an optional **X-Monos-Session** request guard: authenticate the
request's real credential, compare its UUID to the expected header, and reject
mismatch before routing. New Task mutation and receipt adapters always send the
stored verified session ID. It remains non-authenticating metadata; normal Cookie/
Bearer authentication, Origin checks and operation guards remain authoritative.
Existing callers can remain compatible when the header is absent.

Resolution: **design decision accepted; implementation/test pending**. Do not claim
the frontend-only GET closes this race. Test holding A's session preflight response,
logging another shared-cookie tab into B, then releasing A's old mutation/receipt:
there must be no new effect and no successful result delivered into A's controller.
Test wrong/malformed header and valid matching header through real routes.

### 2. Owner edit_specification already admits/applies the change

Evidence: `TaskSpecification.command`'s edit_specification branch prepares and
attaches the proposal, creates its authorization, calls admitSpecification and
advanceSpecification, then returns admitted with confirmation and operation IDs
in the same transaction. The research command table's brief "creates an exact
proposal" description is incomplete and must not determine the UI interaction.

Owner text editing remains a local draft until explicit submission. Before the
actual command show complete new text, comparison to the correct base revision,
summary and impact, and explain that submission applies/starts this change. Do not
label that POST "Save draft" or send it automatically before another confirmation.
The separate confirm_specification → apply_specification_revision chain is for an
existing proposal. Preserve the accepted backend behavior; no mutation redesign.

Resolution: **source fact sent to root/feature implementer; presentation and adapter
assertions pending**. The edit response must require admitted plus its exact
proposal/confirmation/content/operation identities, and poll canonical settlement;
it must not be presented as already published solely because the receipt arrived.

## Recovery cases that must pass

These are concrete acceptance obligations, not findings that unimplemented code
already violates them.

| Window | Required invariant |
| --- | --- |
| Storage quota/unavailable before first send | No POST; preserve draft and actionable local error. |
| Response lost after backend commit, then real reload | Hydrate exact session/Task/action record; explicit recovery reads original receipt; one canonical effect. |
| Request never reaches server | Only authoritative unknown permits identical envelope replay; never refresh basis/request/message IDs. |
| Malformed, foreign-identity or unavailable receipt | Preserve uncertainty and original record; no replay or automatic next stage. |
| Confirmation committed, next-stage storage fails | Keep the confirmed/previous recoverable stage and exact authorization; do not send an unpersisted apply/publication or misclassify storage failure as a definitive server rejection. |
| Joint confirmation1/confirmation2/publication response lost | Recover that exact stage; both proposal identities/digests/bases and returned authorizations survive reload; no new approval from refreshed data. |
| Draft edited while old submit is in flight | Clear only the submitted value if still equal; preserve newer draft and unrelated Task drafts. |
| Logout/revocation/A→B change while response is delayed | Invalidate old controller/store epoch. Late success/error/finally must not restore A storage/private queries, advance a chain, or write a new A stage after cleanup. |
| Duplicate tab copies sessionStorage | Exact envelope can safely replay against immutable receipts; independent fresh actions still use unique IDs. |
| Definitive version conflict | Release transport uncertainty only after its local update is durable; preserve original draft/basis for an explicit correction. No silent rebase. |
| Corrupt or incompatible record | No new request generated as a substitute; show recoverability error. Do not evict unresolved records for quota/age. Preserve valid independent scopes where the storage layout can identify them. |

The session epoch obligation applies to **local storage writes and async callbacks**,
not only to the next fetch. A header protects routing but does not prevent stale
callbacks from repopulating cleared private state. Root was notified separately.

Family adapters must validate command-specific result identities after shared JSON
Schema validation. Spec/Replan results lack task_id, so the saved envelope and exact
scoped URL are necessary; a success-shaped response with missing confirmation or
wrong proposal/digest must remain uncertain. Request IDs are unique across all
families because they share owner_command_receipts(scope_id,request_id).

## Complete controls and evidence

The research endpoint matrix is usable with the Owner-edit correction above.
Trace the following controls through their **actual** parameters and reads:

- Initial Start/Stop/Retry use exact Specification/intent/issue sequence. Opening
  Board/Task, sending a question or navigating never implicitly starts execution.
- Node Stop/Continue/Retry use current membership, activation and source; include
  exact blocker/answer when required. Owner-stopped uses Continue. Completed work
  may still have a separately paused guidance followup. A state label alone does
  not determine availability or permit fallback to a legacy Attempt-only command.
- Completion recovery retains operation and completion_identity_digest; retry
  cannot bypass a settlement child, and correction targets the original completion.
  Cancelled Tasks can still have exact allowed cleanup recovery.
- Conversation Stop/Retry/Withdraw target input-operation IDs and expected_version,
  not the physical Stop operation ID. Guidance and issues have independent exits.
  Input issue answers use normal Conversation routing plus explicit Retry if still
  required; there is no invented direct Owner answer payload for that family.
- Existing Specification proposals expose full text/impact, exact confirmation,
  apply, withdrawal, original change retry and selected exact input deferral.
  Joint graph_sufficient=false requirements must not pass standalone apply.
- Replan supports exact confirm/publish, same-request Retry and scoped issue answer,
  dismissal and selected exact deferral. Requirement withdrawal and graph dismissal
  stay separate. Pending proposal visibility must not block unrelated chat.

Old/new comparisons use **proposal.base_specification_id's revision**, not the
latest effective Specification substituted after a refresh. Keep displayed proposal
and approval basis stable during each chain; later drift requires explicit review.
Graph details must expose changed/retained work, evidence and independent holds,
not only graph IDs or a generic "approve" button.

The new result reader must classify current applicability through canonical
Specification/Plan applicability; Node ID/activation equality alone is insufficient.
Preserve the manifest's original source/Plan/Spec attribution after carry. Completed
historical input never becomes completion of a changed Node. Backend implementer
was notified to test carry/invalidation/changed-definition paths. REVIEW is local
result readiness; no fabricated delivery, PR, merge or Accept action.

## Pagination and navigation acceptance

- Board queries are bounded per column/filter. Done/cancelled use history=all;
  active default does not accidentally hide the requested history. Show available
  attention and expose attention_has_more through the Task's paginated readers.
  Queue-only cards are normal waiting, not an attention reason.
- A refreshed newest messages page coexists with explicitly loaded older pages;
  preserve immutable content and refresh canonical disposition. Search/cursor/Task
  keys stay separate. Timeline contains only formal events, sequence when no true
  timestamp exists, and explicit reset_required recovery.
- Specification summary caps do not hide remaining exits: proposal history plus
  exact proposal detail discovers its operation. Replan proposal/effect cursors
  are independent; remaining requirements can be reached through full requirement
  history. Never treat a has-more flag as completeness.
- Attempts/Artifacts/guidance recipients have actual Load more paths. Existing
  operation-list or attributed-attempt caps need truthful unavailable/incomplete
  presentation; no empty success panel when a bounded read rejects.
- Keep rendered log entries with their cursor; the existing default cursor-only
  sessionStorage helper is unsuitable for a fresh Task view that drops entries on
  reload. Use selected-view memory and restart a bounded read after reload, or an
  explicitly paired retention model consistent with no persisted raw logs.
- Preserve #execution settings, #board filters, Task section/back/source Todo links,
  and mounted existing Todo/settings drafts. Do not poll every historical Task to
  preserve client drafts. Do not cancel execution on unmount.

## Verification scope and handoff

Required real backend/browser cases include session race, stale two-client exact
decisions, actual response loss and reload, all three joint stages, independent
withdrawal/dismissal, semantic answer/Retry, current versus historical result,
pagination and log cursor recovery. Use existing isolated browser schema/runtime
fixtures and label their synthetic process facts. No native Task/service restart.

Run lint/type/unit/protocol/build and the full browser suite because shared shell,
session and primitives affect old mounted screens. Inspect actual-build desktop
1440×1000 and mobile390×844 images for Board and all Task sections, including long
content, queued/disabled/error/empty states, focus and contained overflow. Base UI
owns modal/sheet focus. Legacy interior migration remains its separate next leaf.

No independent implementation tests have run yet: this report is design/source
contract review, **not final UI ACCEPT**. Session routing and Owner-edit findings
must be verified in the resulting code; remaining cases form the final check matrix.

## Incremental implementation check — API boundary fixed

Root subsequently supplied Task API/storage/controller, shared shell and primitive
files for focused review. Backend now has the optional session UUID request guard;
full guard acceptance still requires its route/browser tests.

**Fixed locally in task-api.ts and task-api.test.ts:**

- Shared Spec/Replan result schemas allow fields to be absent for other commands.
  The original checkedReceipt therefore accepted bare committed responses for
  publish/apply/retry/withdraw and could clear pending state without evidence of
  the command's actual outcome. Added command-specific state/required-identity
  checks against the real server branches, including the Owner edit's admitted
  operation, publication/Plan/Spec identities, exact retry targets and Conversation
  input/message/version facts.
- A Conversation unknown receipt from another Task previously returned before
  Task identity checking and could trigger replay. Scope is now checked first.
- An unknown receipt that also claims an authorization/effect is contradictory,
  although its generic schema is valid. It now remains uncertain without replay.
- Preserve real historical replay shapes: an already-published joint result may
  omit optional joint metadata; when present its confirmation must still match.
  Legacy Attempt control receipts retain their existing version semantics.

Targeted API + storage unit tests **15/15 PASS**, including missing-result-field
negatives and no-replay call-count checks. Targeted ESLint passes. Web typecheck
has only the expected unfinished ExecutionBoard import and TaskDetail commands
prop errors at this checkpoint; no error remains in the fixed API files. No browser
fixture, state controller, primitive or backend code was changed by the reviewer.

**Reported, not changed:** sessionMatches clears Task storage and then awaits
cancelQueries before removing private queries and replacing the session cache.
That await needs a transition epoch/mounted check: another session transition
during it must not let A's old callback restore B over newer C or remove C's queries.
Root notified with the exact source path and local repair suggestion.

**Product recovery decision still needed in implementation:** initial storage load
failure permanently sets corrupt.current. The fail-closed rule is correct, but the
current UI has no retry-load or explicit damaged-record recovery path; both a
temporary read failure and genuine corruption produce an indefinite banner.
Do not silently reset unknown pending commands. Root owns the explicit recovery
interaction; this reviewer has not introduced a destructive reset API.

This is an incremental check. Full lint/type/browser/visual gates and the feature
surface implementation remain outstanding; **no final UI ACCEPT**.

### Controller/storage follow-up fixed under root's decision

Root approved the exact transition-epoch repair and specified a nondestructive
local recovery interaction. Reviewer added the post-cancelQueries mounted/epoch
guard in sessionMatches. A superseded callback cannot then remove private queries
or overwrite the newer session cache.

Added controller retryStorage backed by the small retryTaskJournal policy: after
an initial load failure, reread and validate the same-session record; after a later
save/quota failure, persist the current in-memory journal rather than loading stale
disk data over a newer draft. Damaged same-session records remain unchanged when
validation fails. Unknown pending records remain exact. Old controller epochs
cannot retry load/save. No network mutation or new request ID is involved.

Root owns the visible Retry local recovery button and its sign-out explanation;
genuine corruption remains an explicit failed recovery unless corrected or the
Owner signs out. There is no implicit reset that discards uncertain commands.

API/storage tests now **18/18 PASS**; affected five-file ESLint passes. Added cases
cover damaged-record preservation/reload, a newer unsaved draft versus stale disk,
retained pending envelopes and stale-epoch refusal. Web typecheck still reports only
the same two in-progress feature integration errors. Full actual browser session
race/reload/visual acceptance remains pending with the rest of this leaf.

## Full-scope implementation checkpoint — 2026-10-02

Reviewed every new Board/Task feature, the shared Task controller/session shell,
Board/result SQL, session routing and protocol generation touch points. At this
checkpoint **full `pnpm lint`, full `pnpm typecheck`, focused API/storage 18/18 and
`pnpm protocol:check` PASS**. Backend owner reports isolated PostgreSQL reads 8/8,
Owner access 5/5 and Go tests passed; root owns whole-suite/browser evidence.

The implemented session guard authenticates the captured Cookie/Bearer credential
before comparing the nonsecret UUID. Actual route and browser cookie-replacement
cases now exist. Direct Owner editing is accurately labelled as applying/admitting
the full requirement change and keeps the original basis/impact in scoped storage.
Result SQL follows only exact completion/digest carry edges; source manifests keep
their original Specification/Plan identities, while refresh/replacement cannot
grant old evidence current applicability.

### Feature issues fixed by the assigned owner

- `task-execution.tsx`: filtering all execution history by the selected current
  Node made Planner and replaced-Node history inaccessible. Added explicit selected
  work/all work/Planner scope selection; paging remains available in each view.
- `task-decisions.tsx`: closing and reopening the requirement editor called begin
  again and overwrote the saved draft. Reopening now resumes the original draft,
  basis and impact; only explicitly beginning a new edit replaces them.
- `task-detail.tsx`: owner additionally keyed the body by Task ID so transient
  selections reset on cross-Task navigation while persisted drafts stay scoped.

Root was asked to add browser regressions for the first two fixes and cover actual
UI paging, explicit deferrals and local storage retry, in addition to existing
response-loss/session-race/independent-exit tests.

### Open acceptance gaps requiring implementation decisions

- `task-timeline.tsx` lacks the separate lightweight Execution Flow required by
  PRD/design and `docs/07-owner-review-and-ui.md`. Formal events do not have true
  timestamps; completion operation admission is not completion time. Use only
  actual available timestamps and explicitly label unavailable timing.
- Timeline currently promotes every formal event, including routine operation
  events, rather than defaulting to meaningful semantic history. The product
  contract places routine diagnostics in Execution Details unless material.
- `task-execution.tsx` exposes Attempt state/logs and finalized TaskResults but no
  in-progress Workspace/Git attribution. Existing AttemptStatus has no such fields;
  this requires the owner's narrow read-interface decision, not a reviewer silently
  widening public contracts.

These were reported to root and the feature/backend owner. Actual browser/visual
evidence and final source verification of the missing surfaces remain required.
**No final UI ACCEPT at this checkpoint.**

Subsequent source checks: artifact history now explicitly preserves original
Specification/Plan/activation/digest attribution. A Timeline Flow and collapsed
bookkeeping were added; reviewer requested work-goal/Node grouping instead of a
generic per-Attempt list. Timeline gap recovery now obtains a fresh authoritative
overview before resuming. Summary overflow still needs a visible pointer to all
decisions so additional active exits are not presented as merely historical.

Default full `pnpm test`: **19 files / 290 tests PASS**; **31 DB files / 334 tests
SKIPPED** because the database gate was not enabled. `git diff --check` passes.
This does not substitute for root's isolated database/browser/visual gates. Existing
test-results task-detail screenshots were inspected and are visibly the previous
green UI; they are stale evidence and cannot establish this leaf's acceptance.

## Diagnostics and Flow follow-up review

The former source gaps are now implemented. Flow groups executions by Node with
current Plan goals and canonical state, labels replaced work explicitly, keeps
Planner activity separate and uses only recorded admission/activity timestamps.
Summary cap flags visibly direct the Owner to all paginated decisions. The new
`/tasks/:task/attempts/:attempt/workspace` route checks Task/Attempt scope, rejects
unknown query fields and bounds output. It projects only recorded Runtime/Model/
Thinking choices from immutable admission data plus exact workspace lease facts;
no launch body, prompt, path, credential or whole configuration is serialized.

Reviewer traced the new projection through real workspace settlement. A completion
correction leaves `workspace_leases.settle_operation_id` on the original completion,
while the successful `settle_completion` child owns checkpoint evidence. The first
reader missed that child. The owner fixed selection using same Attempt/lease/
descriptor/digest plus the canonical unique completion-child relationship. The
metadata operation ID now names the actual successful evidence source while the
original lease pointer/state remain unchanged. Already-finalized pairs correctly
read evidence from the original successful completion. Existing real PostgreSQL
correction, already-finalized and Task Cancel scenarios now assert these reads;
owner reports all three focused cases passed.

Flow status read errors now have an explicit retry. One minor follow-up was sent:
an already-finalized original may retain a historical failure_kind; label that as
recorded history rather than an active Recovery when its operation succeeded.

New neutral mobile populated/queued Board and desktop blocked diagnostics images
were inspected: no visible clipping or accidental overflow. The blocked image
does not include a populated asynchronous environment/workspace panel, so root
still needs that current-build screenshot and the remaining functional/visual gate.
No final ACCEPT is issued by this incremental source review.

Follow-up: historical failure labels now say Recorded failure unless the open or
settlement operation is actively in recovery. Full lint and full TypeScript checks
pass after diagnostics/Flow changes. Newly written frontend execution-ui, Owner
read/access and protocol spec updates were reviewed against these implementations.
No unresolved source-correctness finding remains at this checkpoint; browser and
final visual evidence are still pending and remain an acceptance gate.

## Final full-scope verdict — ACCEPT

All previously reported findings are resolved. The last production delta adds
Task identity to the configuration-refresh effect, correctly covering same-view
Task switches without rebasing or resetting local drafts. Reviewed frontend,
backend, protocol and generated Runner-consumer Quality Checks and final spec
updates. No additional dependency, lifecycle state or physical execution effect
was introduced by these UI/read changes.

The final evidence is recorded in [verification](../verification.md) and
[visual verification](visual-verification.md). Root's full actual-build browser
suite passed **46/46**. After the final refresh-only production change, the rebuilt
SPA passed **4/4** focused cases: affected Task-switch/capture scenarios and the
new joint recovery regression. The browser inventory is **47 unique tests**; do
not misreport the four focused cases as four additional unique tests.

The reviewer inspected the new joint regression: actual committed responses are
lost for requirement confirmation, graph confirmation and publication, with a
reload after each. Every stage reads the original receipt without a second POST;
the two exact confirmation identities and original proposals remain bound, and
publication produces one stable final Plan/Specification only after explicit
Publish. This closes the last recovery evidence gap.

Verification accepted at its actual boundary:

- Lint and TypeScript: PASS; protocol drift, native module import and production
  build: PASS. Full default unit/schema suite: **290 PASS / 334 DB SKIPPED**.
- Real isolated PostgreSQL: UI reads **8/8**, Owner/Node regressions **36/36**;
  the three amended correction/settlement diagnostic cases also passed. Go full
  tests/generated consumers passed as recorded by the implementer.
- Browser: **46/46 full + 4/4 final-build focused PASS**. Both runs left **zero**
  temporary browser schemas. No deployment/native provider trial was rerun.
- Artifact integrity: all **60** retained PNGs match their recorded hashes and
  dimensions. **44** belong to `index-6eFJJQ-h.js`, **16** recaptured affected images
  to `index-D7bq4c-w.js`; both use `index-B0ijfbLx.css`. All **49** recorded Web
  source hashes and both final asset hashes match the current files.
- Root inspected all 15 desktop/mobile state pairs and their full-page coverage
  against the recorded Multica-derived contract. Reviewer additionally inspected
  mobile Board, desktop blocked diagnostics and the final mobile running-workspace
  and desktop finalized-Git full captures: names resolve, important content/actions
  remain readable/reachable, and no unintended overflow or clipping was found.
  Intentional 1100px detail width, stacked mobile Board, native select truncation
  with full work text elsewhere, and unavailable actual completion timestamps are
  explicitly documented rather than presented as new product facts.
- Task context paths and diff whitespace checks pass. No unresolved correctness,
  scope, interface, test or visual finding remains for this leaf.

This verdict accepts **this Execution Board/full Task/shared-shell/read/recovery
leaf only**. It does not accept existing-screen interior migration, native runtime
integration, remote Git delivery, Owner delivery acceptance or Stage A/V1 release.
Root may mark this leaf's gates complete, commit/archive it and continue the
separately planned existing-screen visual migration under the standing sequence.

## Verification erratum — final browser-test source types

During the next leaf, Web TypeScript checking found 11
`noUncheckedIndexedAccess` errors in the last-minute three-stage joint recovery
test added after the previous full type-check. The final 4/4 browser run had
passed, but this review's blanket final TypeScript PASS overstated coverage of
that newly added test source. The earlier claim is corrected here.

Root added explicit missing-evidence guards before indexed command/result access
and named the three checked command/result pairs. Reviewer verified that all
receipt-read, no-additional-POST, exact proposal/confirmation, publication and
post-reload Plan assertions remain intact; missing evidence now fails explicitly.
No assertion was relaxed, no type suppression was added, and no product source,
runtime behavior, schema or screenshot build changed in this correction.

Reviewer reran `pnpm --filter @monos/web typecheck` and targeted ESLint on
`apps/web/test/execution.e2e.ts`: both PASS. The prior runtime/visual evidence stays
valid; the test-source type gap is now repaired. This erratum does not extend
acceptance to the next migration leaf.
