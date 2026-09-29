# Independent Node execution review

Status: **ACCEPT — full-scope independent review and deployed native acceptance
passed**. All confirmed product findings are fixed. No unresolved product finding
or acceptance gate remains. The checkpoint sections below retain the review and
trial history; final acceptance and verification are recorded at the end.
Reviewer owns this report,
`packages/protocol/test/node-execution-review.test.ts` and the 26 added shared
transport fixtures in `packages/protocol/fixtures/validation.json`; product changes remain with
the backend and Runner workers. No deployment or live-host mutation by reviewer.

## Context and boundaries

Read the complete saved Trellis hook output, PRD/design/implementation plan,
backend and Runner research, architecture/invariants, and applicable backend,
protocol and Runner specifications. Review follows actual implementation paths.
Root owns full gates, deployment and native evidence; no fake result establishes
Linux process isolation or cross-account Git durability.

## Findings fixed and checked

1. Shared settlement schema initially permitted contradictory disposition and
   nested terminal result, and cancellation results accepted the new Artifact and
   planning fields. Backend fixed the schema; all 6 reviewer protocol regressions
   now pass, including both valid terminal dispositions.
2. New Operation conditional `required` fields lack matching local `properties`,
   caused AJV strictRequired schema compilation to fail even for valid explicit
   repository-free completion. Fixed by backend owner. Negative schema tests
   alone can falsely pass under this failure; a positive case is required.
3. Root settlement pair precedes service export. A separately replayed original
   completion may expose its cancellation tombstone first. Backend must retain
   ownership and reject standalone cancellation as pair settlement authority.
   Backend now rejects standalone completion cancellation. Runner redirects
   original tombstone replay through the same settlement flight key/export,
   atomically journals the exact pair, and prevents a hard settlement failure
   from acquiring automatic retry through original-operation redelivery.
4. `completionTombstone` initially dereferenced a retained pair's Result without a
   nil check. Corrupt/incomplete root material must fail recovery, not panic.
   Runner added the nil guard.
5. Artifact publish/read wrappers could exceed the Runner's 1 MiB response bound
   after accepted content gained provenance metadata. Backend now reserves encoded
   wrapper headroom at publication and checks reads. Malformed URL constructors
   now produce invalid_input; concurrent global ID collisions use a deterministic
   conflict path. Same-activation map is explicitly historical selection input.
6. Owner commands discovered Runner IDs before locking Task without checking for
   a concurrently selected new owner. Backend now rechecks under Task and retries
   bounded discovery before mutation.
7. Native no-resource evidence originally did not require a publish_artifact
   receipt and compared completion evidence to bare physical result. Root added
   exact native publication payload/journal/source provenance, distinguishes the
   frozen semantic manifest from physical result, and added negative harness tests.

## Additional findings fixed

1. A Task Cancel can admit a settlement that later fails hard. The outer Owner
   Task-state guard currently rejects CANCELLED, stranding explicit repair of that
   cleanup operation. Backend added narrowly scoped exact same-ID retry after
   Cancel without restoring Task/source/Agent execution. The regression passed.
2. Migration nullable CHECK expressions can permit a no-resource completion without
   the explicit flag or partial target fields on another effect kind. The manifest
   relation also needs exact operation/source/selection attribution constraints.
   Backend tightened these with a manifest ownership trigger and direct SQL
   negative cases. Full database verification passed.
3. Source preparation freezes a Project map under configuration A, but queue
   admission currently rebuilds reservations under configuration B. A source that
   waits offline can launch with a mismatched prompt/resource grant. Backend
   now freezes canonical reservations in source context. Admission uses them and
   the database launch trigger checks exact equality. The offline/config-edit
   regression passed.
4. Old attempt-targeted Owner activation decoding remains compatible; the first
   schema draft's outer PositiveCounter is restored to Counter.
5. Cancelled completion receipt text originally described an unopened workspace
   cancelled by Stop. Backend returns the completion-specific outcome.
6. Settlement failure_kind used first-write COALESCE and lost a later hard failure
   classification. It now accepts hard escalation and preserves that attribution
   through later transient failure. The ordered regression passed.

## Frozen-source review checkpoint

Root supplied the freeze candidate: **273 files**, source SHA256
`51f954e95514d7523412773cbd2ef120984d9c6b0c331e50e4e86da640e40361`.
Root reports Linux race/vet/binaries, Docker and installed-environment PostgreSQL
checks passed, followed by installation with migration 18, all original receipts,
all source/binary hashes, unchanged unrelated service and port 18444. Reviewer has
made no frozen product changes.

Reviewed the new `backend/node-execution.md`, task design and backend/protocol/
Runner index links. The new owning contract matches current behavior, including
original tombstone replay after atomic pair settlement and cleanup-only Retry
after Cancel.

The two harness findings are fixed and reviewed: `durable_execution` compares
complete Attempt rows except the three documented raw-log projections; Git native
provenance requires all three opens and both completions before validating receipt
bytes. Negative cases cover unknown future identity fields and removed receipts.
Root reports **151 Python tests passed** after the policy-retry regression.

Reviewed all five old-spec corrections: backend workspace, Owner commands and
dispatch queue, Runner workspace, and protocol commands now scope legacy rules
and link the canonical Node contract. Task design now distinguishes supported
Cancel cleanup from future superseded-source settlement; current stale
activation/source success remains rejected.

## Native policy correction independently checked

The initial canonical source truthfully blocked with `policy_missing`, with no
Attempt or Start. The retained source was not reset. Root saved global policy to
the same catalog-verified target as Planner through `save_policies`, then used an
exact source/activation/blocker `retry_node` command.

Reviewer read retained files under `/root/monos-node-native-v1` and independently
queried PostgreSQL read-only. All 12 comparisons passed: old source equality,
zero old Attempt/Start, exact blocker payload, Owner canonical envelope/digest,
stored response, configuration digest/response, Task control version, successor
source/configuration linkage, unique retry event, unchanged Spec/Plan/activation,
same global/Planner target, and exact replay. The optional harness receipt is thus
corroborated by independent durable records. New planned Attempt:
`e9ef42b7-fe12-40fc-9140-1992bbcbbe8a`. Reviewer reran the focused probe suite:
**8 passed**.

Root reports a native model deviation: a literal JSON string was passed to the
CLI's file-valued `--input`, then the same HTML was republished under a new Artifact
ID. Two historical Artifacts are retained. This is not a backend request
deduplication failure. The strict one-Artifact observer's
`artifact-count-failed.json` remains intact.

## Native Artifact and installation audit

Reviewer independently recomputed SHA256 for all **273 installed source files**,
the source archive and **all four installed binaries**; all match the frozen
manifest/installation record. Reviewed actual Linux Go race and PostgreSQL logs
(**214 tests / 18 files**), plus the six successful installation checks.

After no-resource completion, reviewer independently read fresh PostgreSQL rows,
the SQLite journal in read-only mode, and current PID/cgroup state. All **13 audit
comparisons passed**:

- One canonical Node Attempt and Start; Task REVIEW / Node COMPLETED.
- Every retained Artifact, receipt, operation, source, manifest and completion is
  unchanged from the strict observer's original failed snapshot.
- Both historical publications map one-to-one to exact title/content/references/
  supersedes, full source/basis attribution and committed responses. All **five
  formal Agent receipts** match native canonical envelope bytes and SHA256.
- The unique manifest explicitly selects only
  `c1e9683d-3bbc-423a-abb4-6b3f6dbcb9fd`; original operation and completion agree
  exactly with its summary/selection/digest.
- Selected Agent read-back, saved authenticated Owner read and database content
  agree: **3903 UTF-8 bytes**, SHA256
  `4d56199cf4cf7a30a816d886f9f7a9caac56c1933ab53f717256b60e75ecc20f`.
- Explicit repository-free operation has only `writer_absent:true`, zero
  workspaces/leases and no fabricated Git. Fresh physical observation finds the
  original PID absent, cgroup unpopulated, mutation fenced and process released.

The model summary says “3901 bytes”; this is a prose measurement error, not the
trusted UTF-8 metadata. Do not replace actual stored bytes/digest with that claim.
The separate v3 `artifact-review` passed. Reviewer read and checked both complete
Owner responses (including actual references/supersedes), both JSON/no-store/
nosniff headers, exact list metadata, browser-file SHA256 binding, saved browser
checks and the screenshot. The visible Add book action, finished state and literal
HTML-looking title agree with the recorded browser checks. **No-resource Artifact
sub-acceptance passes with the retained model deviations.**

Reviewer reran **10 focused probe/driver tests**, all passed. Root reports **152
full Python tests passed**. v3 leaves the original strict single-Artifact path
unchanged; its optional audit validates both complete retained Artifact rows,
all native publication receipts, both Owner reads and one exact final selection.
The two narrowly scoped follow-ups are fixed in v4: documentation describes full
retained Artifact history (the helper does not compare the entire failed snapshot),
and the reusable helper now checks Owner read metadata references/supersedes,
with negative cases. Actual installed evidence also passed independent checks.

## Git preview audit

The strict Git preview check retained a failure because the model moved the exact
Markdown heading into `title`. The body is otherwise unchanged (the outer trailing
newline belongs to the probe constant). Reviewer independently queried the
committed Discussion proposal, creation confirmation, Owner command receipts and
initial Specification. Recombining `# ` + exact title + blank line + exact body +
newline equals `GIT_SPECIFICATION`. Stored Specification equals the actual proposal
body, its canonical JSON digest matches, and confirmation/creation both use the
exact actual proposal digest and retained responses. No Specification content was
rewritten to force the earlier assertion to pass. The audited acceptance is valid.

Canonical Git Task: `931aa5ba-f844-4230-b350-c9aa53476c3c`; initial Specification:
`7ea5c9fb-a491-4ada-b46f-64e7b27a8d4c`. Root reports a premature Start observer only
created its claim before missing `git-created.json`; no product command was sent.
Preserve that failed claim when proceeding with the intended canonical Start.
Git recovery and restart remain pending; final task acceptance is not granted.

## Native Git v1 failed-driver cleanup and v4 harness

The Git v1 model supplied an extra leading `e` in the driver Task argument.
Formal `open_workspace` remained bound to the actual authenticated Task/Attempt;
the driver then rejected the mismatched expected path before its private-work
marker writes. Root retained `git-driver-identity-failure.json` and the original
`git-held-deadline.json`, formally stopped the exact source, waited for settlement,
and locally cancelled the Task. No failure was reset or claimed as a Git pass.

Reviewer independently read fresh PostgreSQL/SQLite, current PID/cgroup state,
the retained driver report, clean worktree and private service-owned Git export.
All **11 cleanup checks passed**: driver-only incorrect argument, correctly bound
formal open, absence of all four private markers and clean worktree, checkpoint
equal to original HEAD tree, exact service export/result ref, Task/Node CANCELLED,
all Attempts/leases released with no completion, fresh physical absence, exact
Stop replay, and canonical Stop/Cancel envelopes/digests/responses in the DB.
Retained Stop `2092a3eb-2e4b-4e6e-a408-b7db4aaf692f` exports checkpoint
`7d453dd456726bd57955044288a132709af78e4c`, tree
`5f99cee88b73c985a5a6d4bfb63abe13a099a94c`.

Reviewed v4's narrow harness correction: before canonical Start, formally save
the Role with literal exact Task/resource IDs. The shell-quoted Python wrapper
derives only Attempt from the expected scratch working-directory shape and runs
the existing installed driver. Continue and correction instructions also bind the
same exact Task. Wrong cwd rejection, argument binding and exact title/body
matching have regression coverage. **12 focused tests passed** in review; root
reports **154 full Python tests passed**. No product code or binary changed.

The new canonical Git trial has separate evidence at `/root/monos-node-native-v2`.
Reviewer recomputed all four imported Artifact/browser evidence files against both
their v1 originals and recorded SHA256 values; every byte matches. Its Git
Stop/Continue/correction/finalization and restart acceptance remain pending.

## Native Git v2 Stop and v5 observation correction

Canonical Git v2 Task `70810e87-c861-4257-a9c3-ad346abb342c` reached the original
`held_for_stop` proof with private committed/staged/unstaged/untracked/ignored
work and both independent descendant patterns. The formal Stop succeeded, but
`git-stopped.json` retained a false checkpoint failure: its earlier operations
query still showed `admitted`, while a later native query saw physical release.
Reviewer confirmed this exact mixed observation in the original failed file.

Reviewed v5: after a predicate matches, `observe_git` requires another equal
`durable_execution` view and rechecks the native predicate before accepting. The
injected torn-operation regression rejects the old mixed observation. The
separate read-only `git-stop-audit` requires the original held pass plus that
specific failed checkpoint check, then re-verifies the complete checkpoint,
lease/process release and actual private service-owned export. Continue accepts
only a passed original or supplementary audit; it does not rewrite the failure.
Reviewer reran **13 focused tests**, all passed.

Independent fresh DB/SQLite/physical/Git verification passed **10 comparisons**:
original held proof and live descendant identities; exact mixed-read failure;
full checkpoint attribution; service export tree/parent/ref; unchanged actual
HEAD, staged index and all four private files; original released lease/settle
pointer; same process identity and absent descendant trees; no completion; exact
Owner receipt/envelope/digest; and all native Agent receipt bytes.

- Attempt: `6136cca3-46d2-4d45-84ac-9e8105a835c8`.
- Stop: `3e5cef7e-5e2b-4b46-ab88-773accf15e3f`.
- Lease: `c8e679d1-f51d-4ad3-be51-ad922e70aa62`.
- Checkpoint: `2ed63b1c665b8ad1cf77c52e294365681bf51925`.
- Exact tree: `946bdab3247e0178c099cf77dbacb1cd0de54afb`.
- Exact parent/private HEAD: `55ab2e26d8ef29564948453bdcf1c2ff9ea8d5e2`.

The native Stop preservation sub-check is clear. Continue, hard-completion
correction, finalization and restart remain pending; no product code changed.

## Completed scope and spec follow-up

- Backend finished source-bound control and no-Runner Auto waiting corrections;
  the freeze candidate includes these changes.
- Spec scope drift is fixed and independently reviewed.
- Real Linux process, cross-account Git/export, native CLI, functional HTML and
  idle restart evidence passed independent review.

## Completed review coverage

- Complete diff, migration constraints, scoped reads, source/selection/promotion
  and offline/unsupported distinctions; no arbitrary fixture discovery.
- Prior dirty workspace history cannot bypass finalization through a new
  repository-free Attempt. Source and immutable lease target remain exact.
- Root marker/writer-lock race, partial Git finalization, exact success/cancel pair,
  recoverable/hard event orderings, Cancel/Stop and late success.
- Artifact byte budgets include encoded read envelopes; historical artifacts are
  not presented as current selected evidence. Absent/empty/earlier-Attempt selection
  remains exact and immutable after terminal admission.
- Meaningful PostgreSQL contention/crash tests and real Git/journal tests.
- Full lint/type-check/tests/protocol/build checks and final native evidence.

## Final native completion and restart acceptance

After `git-final.json` passed, reviewer independently read fresh PostgreSQL,
read-only SQLite effects/requests, trusted root operation records, original
driver reports, actual private worktree Git objects and private service-owned
exports. **25 completion checks passed**:

- Exact original completion identity digest and immutable lease settle pointer;
  settlement references the same Attempt/dispatch/workspace/lease/basis.
- Original cancellation plus successful settlement agree exactly across the DB,
  atomic SQLite pair and trusted root records. Checkpoint attributes the exact
  original operation/digest and real failed HEAD/tree.
- The actual checkpoint export has the exact expected tree, parent and result
  ref; it does not claim broken ancestry as a valid finalized revision.
- Three exact source/Attempt/Start chains share the same Node/activation/Spec/Plan,
  preserve frozen prompts, and carry explicit correction provenance.
- The final semantic manifest preserves exact summary, explicit empty Artifact
  selection and canonical digest; only the final Attempt has current completion.
- All three native opens and both completion receipts match native journal bytes;
  original receipts remain unchanged. Owner Continue/correct and exact replays
  match stored canonical envelopes, digests and responses.
- Actual final HEAD/tree and ancestry match retained finalization; all four
  private file hashes, including ignored bytes, remain intact. All three leases
  and process trees are released. The earlier cancelled v1 Task remains inert.

Final Attempt `88fae332-f4ae-4fd9-9bb2-b054d300d517`, completion
`2177721d-b3f2-485e-84cd-f2e16a2bd9d6`, finalized commit
`6e967b4fd6293302818b0b1e3a083535af750adc`, tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`.
Settlement `322014b4-0344-4f1d-b5a1-954ef11f2fb9` retained original
`6500b097-0adc-4ff3-8f96-bfbf5592c550`, identity SHA256
`7d8f86cdcec0983ced1b057265a13d6d8a35911955b36ec22e09d8a8fdc0ceb2`,
and checkpoint `fd4a506736c8ce022e22587ed1b6381ce824aa62` with failed
HEAD parent `d6104d742369afed27842cb4c264e2329592fb15`.

After both existing backend and Runner were restarted, reviewer independently
performed **20 final restart/deployment checks**, all passed. Actual backend start
and backend identity changed; Runner InvocationID and incarnation changed and
reconnected ready. Both accepted Tasks' complete durable semantic rows match
before, retained after and fresh reads. All four original Node process identities
remain retained and their trees absent. Artifact bytes remain exact.

The actual server container runs the verified built image. All 273 installed
source files and all four binaries still match the frozen manifest; migration is
18. Original receipts in all six receipt tables remain unchanged by full-row
SHA256 multiplicity. The unrelated service is unchanged and port 18444 remains.
All ten fresh global counts are zero: leases, queue, writable/unreleased Attempts,
unresolved operations, outbox, Discussion, source controls, Node sources and
planning work. These are actual deployed observations, not inferred test results.

## Final verification

Initial focused protocol run reproduced 3 failures across 6 cases. After fixes:

- `pnpm exec vitest run packages/protocol/test/node-execution-review.test.ts`: **6 passed**.
- Reviewer added **26 shared transport fixtures**, making 186 validation fixtures.
  Combined TS protocol suites: **201 passed**. Go `internal/wire`: **passed**.
- `pnpm lint`: **passed**, independently rerun after native acceptance.
- `pnpm typecheck`: **passed** (root and web), independently rerun at final review.
- `pnpm protocol:check`: **passed**; `git diff --check`: **passed**.
- Backend full real PostgreSQL final Linux suite: **214 passed across 18 files**
  (reported by root; reviewer read the observed independent
  lock contention, SIGKILL, settlement and direct SQL regression assertions).
- Full TypeScript: **249 passed** (root's full gate).
- Full Linux Go race/vet/build passed; reviewer read actual race logs, real Git,
  journal/reconnect regressions and implementation report. Native cross-account
  export and physical process proofs passed independently.
- Full Python: **155 passed** (root's final gate); reviewer independently reran
  **13 focused probe/driver regressions** after the last harness change.
- Deployed Artifact/browser, canonical Stop/Continue/hard-finalization correction,
  trusted settlement/export, final completion and idle restart: **passed**.

**Final verdict: ACCEPT.** No unresolved findings. The documented model and
observer deviations remain preserved as trial history. Root may complete the
authorized commit/archive/journal workflow and continue the next roadmap task.
