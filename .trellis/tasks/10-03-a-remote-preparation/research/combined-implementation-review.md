# Independent combined implementation review

Active task: `10-03-a-remote-preparation`. Reviewer: `/root/remote_lane_review`.
Read-only review against accepted base `2095660a1fe546412430b5d630d4837dc550155b`.
Only this report was written. Other agents' source, evidence and pending work were
preserved; no test matrix, credentials, host/provider effect or lifecycle command
was run.

## Findings (fixed)

None fixed by this reviewer. The previous Runner SHA256 store and native helper
pre-effect findings have separate READY dispositions in
`runner-full-lane-independent-review.md` and `native-provider-kernel-review.md`;
their unchanged product inputs/evidence are reused.

## Findings (not fixed)

### P2 — installation spacing can terminate a healthy automatic push

- Files: `apps/server/src/remote-preparation-access.ts:77`, `:88`, `:94`;
  `runner/internal/host/publication_remote.go:117`, `:264`, `:265`.
- A normal Runner first requests observe access, which acquires and releases an
  installation reservation with a further one-second spacing interval. It then
  verifies the advertised ref and immediately requests push access. If the Git
  observation finishes inside that interval, or another item obtains the same
  installation reservation between dispatch and access, `reserveRemoteProvider`
  throws `RemoteProviderWaiting`. The push endpoint has already marked the
  operation started/effect-owned/may-have-mutated. Its generic catch sets
  `reconcile_only=true`. The Runner converts that access error to an immutable
  before-start blocked/access_denied result. Automatic preparation now requires
  an actual Owner Retry and a replacement operation although no push token or
  physical write was issued.
- Contract: installation spacing is scheduling, not provider failure or possible
  effect evidence; Retry cannot bypass cooldown. Autonomous preparation must
  survive normal spacing while retaining claim-before-write and after-token
  admission checks. Both accepted cooldown and concurrent installation work can
  reach this supported production path.
- Existing PG tests do not exercise this case: their `due()` helper explicitly
  expires every cooldown before `claim()`. Existing positive tests remain valid
  for their tested scopes. Root was notified; product fixes are outside review
  ownership. An affected access/Runner regression is sufficient; broad suites
  and screenshot recapture are unnecessary unless their inputs change.

### P2 — provider count gaps can become complete current checks

- Files: `apps/server/src/github-remote.ts:98`, `:103`;
  `apps/server/src/remote-preparation-poll.ts:22`, `:33`, `:35`.
- The adapter validates that `total_count` is nonnegative but never validates the
  expected number of rows on each page or the collected total. For example,
  `{total_count:1,check_runs:[]}` is accepted as a final page. Polling then appends
  `complete=true`, `aggregate=no_checks` and potentially `current=true`. Missing
  rows on intermediate pages can similarly produce complete success from the
  remaining subset. Before/after PR head/base brackets do not establish checks
  collection completeness.
- Contract: partial, truncated or changing collections must not become complete
  current observations. Retain an incomplete outcome or reject inconsistent
  page cardinality/totals; do not infer completion from the page number alone.
- Root was notified. Existing 600-check staged positive evidence remains useful;
  only the affected count-gap regression/provider/poll checks need refresh.

No additional blocking source defects were identified in the reviewed authority,
original-operation recovery, mapping/exposure, Cancel or Web scope paths.

## Reviewed behavior and seams

- Every ordinary effect checks automatic mode, exact repository/source/effective
  basis, latest local prepared/mapped result, configuration, complete explicit
  workflow fact, actual eligible waiver receipts, input fences and permanent
  known-public exposure. Admission and provider result settlement use Task before
  item; actual token I/O is followed by configuration/current admission checks.
- Original uncertain push result and ACK remain terminal immutable facts. Later
  exact-ref proof appends under the original operation/result digest, with physical
  absence required. Published exposure attribution is atomic and includes waived
  credential findings. Clean/deleted/mapped output cannot clear exposure authority.
- Mappings preserve the original manifest/source/public parents, bind the new
  source/effective basis/configuration/scan and mapping digest, and select exact
  waiver receipts. Supported publication ancestry uses the verified original or
  published first parent. Optional integration-target transport remains explicitly
  deferred, as recorded in the Runner review; it is not a new blocking defect in
  the admitted single-parent path.
- Both Cancel paths persist cleanup in the terminal transaction, revoke untouched
  admissions and retain in-flight ownership. Cleanup operates on the exact owned
  PR/marker/head/base and retains the branch. Source changes, guidance, Spec and
  Replan publication wait for remote quiescence through their owning modules.
- PR intent precedes effects. Started/lost-create operations perform exact paginated
  lookup; absent/ambiguous lookup cannot issue another POST. Same PR identity is
  immutable; metadata update and close validate the exact tuple. Literal-head
  checks, bounded pagination, scoped ETags, persisted provider cooldown and
  unknown required-check/merge-readiness semantics were reviewed, subject to the
  count-gap finding above.
- Web independently reads latest canonical capability without replacing selected
  historical bytes. Ordinary Retry additionally requires current overview REVIEW
  and exact effective Specification/Plan; read-only recovery and terminal cleanup
  use distinct canonical capabilities. Task/session/item/operation/observation/
  head/base query keys and post-digest abort checks prevent scope reuse. Task
  overview keys the component by session and Task. Exact retry envelopes persist
  before POST; only authoritative unknown permits identical replay, and receipts
  require actual operation ID/digest/version. Mapped override review includes its
  immutable mapping digest. Literal provider text stays React text and PR links
  are constrained to the verified GitHub tuple.
- `after_acceptance` cannot pass fresh remote admission or obtain a new write
  grant; local inspection and deferred projection remain available. No acceptance,
  merge, accepted-batch or new Task lifecycle authority was added.

## Verification

### Actually performed

- Read current `check.jsonl`, PRD/design/implement, architecture execution/delivery
  and invariants, verification-scope/collaboration contracts, backend executable
  remote-preparation spec, and relevant frontend execution/query/visual/quality
  contracts. Read bounded assigned source/diffs and relevant provider, PG, API and
  browser assertions. Initial assigned dirty paths were recorded; no source fixes.
- Read-only Python SHA256 audit: all **27** backend handoff entries match live
  files, ordered aggregate
  `987f56d2590d926b5c47b2fddf8be70c85da058ba2303c6f995d15331ca7f2ab`.
  Exact ordered path/hash table is retained in
  `backend-implementation-verification.md`, itself SHA256
  `b9e10820aff9e938201c1c546c86d1b8586f6c7db25bfdc78157422d162036fa`.
- Audited Web source hashes against `frontend-final-inputs-and-images.json`
  SHA256 `3b6258daa74c1f3e3fec7469e3534879dd45c1469e94b39b589e4389116cf004`.
  All Web product source and execution UI fixture entries match. The browser
  e2e source has the announced in-progress capture-only delta; do not claim the
  old e2e input hash covers that delta. Current browser test hash:
  `97e513328b5e8cbbe3bdf1d054ecd089aa1cbad14f4a283d7d70f992965c7e63`.
- Root provider test reviewed SHA256
  `77a86c1d9292e0adba4887505f22a0d38a335343a5d8d96e2b2555c968d401c4`.
  Backend executable spec reviewed SHA256
  `1474bd869997e6a16781b567098a37069312f577e885f6d9dbf4b48ea932d971`.

### Exact principal Web reviewed inputs

| Path | SHA256 |
| --- | --- |
| `apps/web/src/features/remote-preparation.tsx` | `1cd652cb48d994ab6f9452288775601e1e981236689cdf6134ae022a8022786e` |
| `apps/web/src/features/task-overview.tsx` | `622d603448a7d23271a417c23a76cde525dffcc167b0cf0a5f4a75f2c6de6842` |
| `apps/web/src/features/publication-candidate.tsx` | `02c93db8b3a95103ddac3d87728bbbe91c0e7dd56af6446b2152b051133a07ae` |
| `apps/web/src/features/task-ui.css` | `e86f603175910bd98f398c91137bb1a6e317d6b4b61e0a3bc148e1feda5fd51e` |
| `apps/web/src/lib/remote-preparation-api.ts` | `1659156728ff137eb5391bea2503c61f3f0108d97d804b006995555193d20fbe` |
| `apps/web/src/lib/remote-preparation-api.test.ts` | `eed675680ec6069404e804c61191146b5d18fa239c2f61b2e6e275c364d289d6` |
| `apps/web/src/lib/publication-api.ts` | `083a7d02ab46dc11c49402249b2da785fb18856509a493c3d4d66dccefbea98f` |
| `apps/web/src/lib/task-api.ts` | `108db796c7639869398ca764f834244b56c5e2567db0fa61b9a297312dfa9e5b` |
| `apps/web/src/lib/use-task-command.ts` | `34952477a31410dd313e23af5e8726d95744e4cc4ff30aae74de963f6e9efde6` |
| `apps/server/test/fixtures/execution-ui-fixture.ts` | `89414316693730df162c7d5a8144a3bd56d0edf0e93b11066a91a08efbf9346f` |

### Reused evidence and limits

- Reuse backend **11 actual PG/WSS PASS**, local publication **12 PASS plus one
  focused corrected lock observation PASS**, provider **30 PASS**, shared **331
  TS PASS/generation/Go wire**, Web API **56 PASS**, browser **13 functional PASS**
  and representative capture PASS as reported by their owners for valid hashes.
  These establish their actual scopes, not the two uncovered cases above.
- Reuse Runner original whole-module Darwin/Linux and affected permission/SHA256
  delta evidence under their existing manifests. No unchanged command was rerun.
- Root still owns final integrated lint/typecheck/provider deltas, final native
  source/binary identity and authorized actual GitHub trial. Web owns final PNG
  inspection/capture manifest and capture-only delta verification. Their pending
  evidence is distinct from source defects; this review did not fabricate it.
- The native lower-level fixture does not establish a live installed GitHub App,
  formal workspace/Runner coordinator or product-side OAuth/App provisioning.
  Production App integration remains an explicitly documented prerequisite.

Disposition: **two P2 findings require bounded fixes/re-review**. Other reviewed
source seams are ready, subject to the separately owned final evidence gates.

## Focused P2 and final Web re-review (2026-10-05)

This addendum supersedes the two original open P2 dispositions only for the
current inputs below. Original findings, hashes and evidence remain preserved.
Product source remains read-only; this reviewer did not run tests or effects.

### Findings (fixed by owners; independently reviewed)

1. **Push scheduling before claim.** `remote-preparation-access.ts:67-106` now
   separates prepare, claim and verify phases. Fresh permission validation occurs
   before claim; installation reservation and possible-effect ownership are
   atomic in the claim transaction, under the same configuration/channel/Task/
   item/operation guards. Waiting rolls the transaction back and propagates a
   typed `RemoteProviderWaiting`, leaving original state/version/claim unchanged
   and issuing no push grant. Only failures after a real claim set conservative
   reconcile-only state. Token I/O is still followed by the original fresh
   channel/source/effective-basis/configuration/permission checks.
   `remote-preparation-state.ts:19-29` carries the actual deadline and positive
   ceiling seconds; `app.ts:79` returns typed rate_limited 429 plus Retry-After.
   This fixes the backend half of P2 #1 without bypassing cooldown or admitting
   a write before durable claim.
2. **Exact checks page/count completeness.** `github-remote.ts:97-105` verifies
   exact page cardinality and continuation against advertised total for both
   raw pages and retained 304 pages. `remote-preparation-poll.ts:14-34` binds a
   collection total across checkpoints/turns. A changed total clears progress
   and throws before a complete observation; old progressed checkpoints lacking
   the total restart. The existing 8-call bound, before/after literal-head/base
   brackets and unknown readiness semantics remain intact. P2 #2 is resolved.
3. **Runner scheduling consumer (current source review).**
   `control/publication_remote.go:28-104` retries only a validated typed
   rate_limited 429 with valid no-store response and bounded Retry-After, waits
   the actual interval and retains the exact serialized incarnation/request/
   attempt under bounded context. Each retry rechecks the channel. Over-budget
   waiting returns a typed grant-free scheduling error. Host observe/push paths
   propagate that error rather than writing a blocked terminal result; the
   daemon returns without publishing a fictional result and can accept normal
   original-operation redelivery. Real denial wording does not trigger retry.
   Existing started-worker recovery also propagates scheduling without another
   physical push. Current narrow source/tests are sound; final Runner owner
   verification/handoff is still separately pending at this review snapshot.

### Findings (not fixed)

No additional concrete source defect found in this delta. Full resolution of
P2 #1's end-to-end scheduling claim awaits the owner’s affected Runner verification
and frozen handoff, not a new implementation change identified by this review.

### Final Web driver and retained visual evidence

- Reviewed the bounded driver changes: prepared long text is actually scrolled
  into the contained check list before capture; deferred capture waits for the
  actual populated local candidate; held detail is released only after Task
  switch, and held checks only after actual logout. These change test/capture
  behavior; product assets and command authority remain unchanged.
- Current `frontend-final-inputs-and-images-v2.json` preserves old image/driver
  hashes, records per-image reuse and final late-fence evidence. All current Web
  product, fixture and driver entries match live source. Final inventory contains
  14 selected PNGs (six viewport pairs and two material full-page companions).
  Web owner inspected every selected image; root reports an independent full
  image/hash audit and two representative image inspections. This reviewer
  reused those visual inspections instead of repeating them.
- Source aggregate includes final driver; same non-driver inputs and actual
  built assets establish the stated reuse. Backend scheduling/count fixes have
  separate current behavioral evidence; historical screenshots keep their
  actual captured server hashes and are not relabelled as tests of those fixes.

### Verification actually performed / evidence reused

- Direct current six-path backend source/test delta, Runner typed retry/error
  propagation/test assertions, Web final driver and final handoff/manifest reads.
- Read-only SHA256 audit: **all 27 backend inputs match** current ordered
  aggregate `cc221e8e91ff656dbe33dba8825e82b5381e547941bf048b5d2bc9d133a1a644`.
  Backend report SHA256
  `85ccd08056f42d2c5be376d68aeb365b8bff90e45817e4c431381634e6ce2bcf`.
- Reuse actual affected PG **3 PASS / 8 skipped** (5.94 s), including immediate
  observe→push 429, unchanged original pending fields/no new grant, real wait and
  same-attempt 200, plus after-token input guard and bounded poll. The subsequent
  amended count-drift poll **1 PASS / 10 skipped** (1.64 s) replaces only its
  earlier case evidence: staged 500/600 then 601 refuses completion/clears
  checkpoint; fresh stable 600 completes. Reuse scoped lint, native Node import,
  whitespace and current root/server TypeScript PASS. Root provider **30 PASS**
  includes count-gap regression. No unchanged PG case, broad suite or screenshots
  were rerun by this reviewer.
- Web final report SHA256
  `7338dada6573c59696920ce3186b2bd21f6599dcc173fc1403472b227ab045cb`;
  final **v2** manifest SHA256
  `19ba9ee108c7e1397a0dd308ce0c352895dbd9af988644dd2f6707042c5afb1a`.
  Current Web/fixture/driver hash audit found no mismatch. Reuse the owner’s
  final lint/typecheck/build, 13 distinct retained functional passes, affected
  final late-fence pass, image inspections and zero-owned-schema leak evidence.
- Root final native source/binary refresh, actual GitHub continuation trial and
  combined quality integration remain outside this reviewer’s executed evidence.
  No live trial success, App issuance or installed coordinator claim is made.

### Current changed inputs

| Path | SHA256 |
| --- | --- |
| `apps/server/src/app.ts` | `c1169b26b54c1526b70796e9eba62200d74c274a12a68ab67738bb28dff09fa6` |
| `apps/server/src/github-remote.ts` | `239a1c2622d4f913ba048b1cfd28d7cb3babc23a80302673752343771d0038bc` |
| `apps/server/src/remote-preparation-access.ts` | `0cb63ab9711982c179ddc995d55a870b8b0bbe5c1f51805776c42bc37279098e` |
| `apps/server/src/remote-preparation-state.ts` | `e7f8e495160de65d72834e70aef5a1bed04c24e4cae15a37d0e14f6b701c6b83` |
| `apps/server/src/remote-preparation-poll.ts` | `09a35527b8afe0de5a6a7510364aad13eccab03c896721e6eb8f30d8498d6061` |
| `apps/server/test/postgres-remote-preparation.test.ts` | `3366cb605c3f460f7a3b76c990f15bba52e15cc0872edfdd049c312d579e37b4` |
| `apps/server/test/github-remote.test.ts` | `746ce9e27ebc0e8a9b5ce22218ba296db1d10440f581fa54724300c72f495290` |
| `apps/web/test/remote-preparation.e2e.ts` | `97e513328b5e8cbbe3bdf1d054ecd089aa1cbad14f4a283d7d70f992965c7e63` |
| `runner/internal/control/publication_remote.go` | `54736cb2f40712317404feeb7b780cb7b8ad18bc99151c8dbacd72f0f0167e32` |
| `runner/internal/control/publication_remote_test.go` | `afa5d46efd81fa9b8a4262ad8bbc5aa674a510fba335cf26165e7cddc1ae4001` |
| `runner/internal/host/publication_remote.go` | `8bf3abb4190c746c8fca717cabfb4adfcae8efe5f63616aae6cc0362abdaff41` |
| `runner/internal/host/publication_remote_test.go` | `d6d034a20e5cb2170f7df749564ae161bf0cc5ab3fd0353a22e743dd5cb3b93a` |

Disposition: **backend and final Web source READY; Runner current scheduling
source READY with its affected verification/handoff pending**. No source blocker
remains identified; root's native/provider and final integration gates remain.

## Final scheduling handoff closure (2026-10-05)

Runner's final four hashes exactly match the current-source table above.
`runner-scheduling-handoff.md` SHA256
`7a8796a789d5864e4a2ccc58cd9fa20b4d4f25ad311f4e5616f8411b41edc8ea` and
`evidence/runner-scheduling-final-inputs.json` SHA256
`7eba8893262b572f8e886a20aba4cc7181191187b687d60359dfdba4a8ee8c18`
were read. The retained focused command selects the three existing affected
control/host tests; actual stdout reports control **1.798 s PASS**, host
**7.387 s PASS**, and affected two-package vet reports exit **0**. Their covered
TLS wait/same-envelope/budget/denial and physical-Git pending/started intent
preservation assertions support the reviewed source. No command was rerun.

Both original P2 source findings are now **CLOSED / fixed by owners**. Backend,
Runner and final Web source review is **READY**, with no remaining blocking source
finding in the assigned scope. Root's current narrow Linux delta (including the
separate timestamp bridge), final binaries and actual GitHub continuation remain
separate evidence gates; previous full race/process/Git/permission evidence keeps
its original scope and is not repeated.

Reviewed executable spec SHA256 at closure:
`aa5b8489c7d311673717532cb3712d72b960eece0481200d6aa1d59eeb1eae60`.
Typed waiting/admission and page cardinality/total paragraphs match the fixed
contracts. One nonblocking wording correction was sent to root: lines 148-149
say both missing rows and changed totals discard checkpoints. Actual malformed
rows reject completion before staging; count drift explicitly discards the
checkpoint. The precise wording is “Missing rows reject completion; changed
totals discard the partial checkpoint for a fresh collection.” Root owns this
spec edit; no source change or additional test is required for that precision.

## Final required evidence and acceptance disposition (2026-10-05)

**READY for the assigned leaf acceptance scope.** Both source P2 findings are
closed, the executable-spec wording is corrected, and the previously pending
native/Linux and actual provider trial evidence is now present with current
source/binary binding. No unresolved blocking finding remains in this review.

### Verification actually performed

Read the current Linux delta result/collection audit, actual GitHub original
operation continuation command, original-operation native intent/candidate/scan/
absence/result/proof, correction transport/parent, create reconciliation, owned
close/retained ref, main provider audit and final Web audit. Performed only a
read-only hash/source binding audit; no tests, token lookup, host/provider effect
or evidence/source mutation was executed.

- Linux manifest has **139 current source inputs, all matching live bytes**,
  SHA256 `f6c69995f5d2afe55e3b4ad6505d238ddfc6a417f685f20c1e5902be22657741`.
  Current result SHA256
  `1eceffe6239b6a6b46c6441372c45004e71a3809190427a85ba335993156b978`
  records all **8 steps PASS**: affected scheduling, race, vet, host test binary
  and four production binary builds. Actual retained log hash audit is recorded
  in `final-linux-scheduling-bridge-delta/main-collection-verification.json`,
  SHA256 `cb8dae1be84c9a32cbc69f970046b6ea2fb96a06fddb1736a8401f17a5d25383`.
  Its prior complete gate has **134 unchanged inputs** and preserves whole
  process/native Git/21 protected-path proof with **42 access denials**.
  This exact reuse plus the affected five-file delta supports current Linux
  claims without rerunning the unchanged full matrix.
- Actual GitHub continuation command reports exit **0**, **38.6739 s**, original
  pre-push operation `0fa427c1-8ca3-4b13-ab77-99eb6ed6956a` and exact historical
  synthetic fixture. Original failed trial/input remain preserved. First head
  `6392b5e58114018aa414b906f8cc75ea2add7cb5` is parented by the verified original
  public baseline; correction
  `3901e493dc54c07b0197c3c66b0648c17a290b26` is parented by that first head.
  Two actual native pushes retain exactly that fast-forward lineage and stable
  ref; each transport reports the same current host binary SHA256
  `20bfa5fe62e8b5dd1e5573dc8b2fa59b2ec1c17ccfcf07961662478b417ecf81`.
- GitHub main audit inventories **58 retained evidence files**; this reviewer
  independently matched all their recorded hashes. Its **150 source input**
  hashes also all independently match current bytes and the Linux manifest
  digest. Both native transports retain service UID **997**, execution UID
  **1000** and six protected artifacts each, with read/write denial on every
  artifact (**24 denials**). Exact original input/scan/candidate/result/absence/
  proof bindings and correction parent were read; physical absence is an actual
  retained transport fact rather than an inference from ref equality.
- Actual provider evidence records **one POST with one withheld successful
  response**, resolved by exact unique lookup; **one metadata PATCH** on the
  same PR and **one owned close PATCH**. PR **#4 / ID 4738307408** remains the
  same numeric repository/head-ref/base-ref/marker identity. Authoritative
  `cancel-close-result.snapshot.review.state` is **closed**, and the exact branch
  remains at the correction head. `trial-result.pr` is correctly treated as the
  earlier pre-close tuple, not current PR state.
- Reuse final Web **12 owned input / 14 image** audit, every image's owner
  inspection and root's two independent representative inspections. Final
  manifest, product assets, actual driver hashes, scoped functional evidence and
  zero owned-schema leak attribution remain as reviewed above. Current root
  provider **30 PASS** and root TypeScript PASS cover their affected inputs;
  unchanged prior PG/shared/Runner gates retain their original scopes.

### Exact final evidence identities

| Evidence | SHA256 |
| --- | --- |
| `evidence/native-github-continuation-v1.main-verification.json` | `24a74ab6c36d92c0dc6daeda0b64060a8d206c5d6c05bc31221104504e430954` |
| `evidence/native-github-continuation-v1.command.json` | `bdc22f6278fd15eba46dfd7a079e47570a90c3dcf79e699bc5ad243c4306f75d` |
| `evidence/native-github-continuation-v1/cancel-close-result.json` | `842212f037f85fe8a77a51a030fdde2957677d1cad1558226bb29c09f7df75ad` |
| `main-frontend-final-verification.json` | `4f2cad2514ef1dc8e9e999aa5488a4a2c9ee2f09a8d7ee0894c0feeb1cffa335` |
| `.trellis/spec/backend/remote-preparation.md` | `36909c4d782e270a0b8ec17279ecda661324eb05f690aa389607ed0141162ee9` |

### Acceptance claim limits

Actual external trial is explicitly **OAuth-injected native lower-kernel**
evidence with controlled synthetic content. It proves the tested Git/provider
effects, their exact identity/lineage, lost-response recovery, scoped update,
owned closure, branch retention and protected native artifact boundary. Actual
authenticated PG/WSS/coordinator and Owner cancellation/recovery semantics have
their separate retained product evidence. This combination is attributed
accurately; it does not assert a live installed GitHub App, installed product
coordinator, formal native workspace dispatch, Owner acceptance or merge.

These are explicit evidence boundaries, not newly manufactured acceptance gates
for installing an external App or repeating the trial. Main retains integration,
task lifecycle and final user-response ownership. The assigned independent source
and required-evidence acceptance review is complete.
