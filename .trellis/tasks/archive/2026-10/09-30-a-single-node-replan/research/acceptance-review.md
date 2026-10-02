# Independent implementation and acceptance review — one-Node Replan

Status: **FULL-SCOPE ACCEPT — 2026-10-02**.
Source review, frozen Linux installation, native semantic/recovery cases and final
backend/Runner restart continuation passed independent review. Product source
remains frozen v4 (343 files); final manifest SHA256
`e125d117b5b337cc15f6889c23c5fa2beba2356956dd481b6f17ca58f2e669aa`.
No blocking finding remains. Historical failures below stay retained; the final
verdict and coverage limits at the end supersede their pending status.
Accepted baseline: Specification leaf `f4114bf`, archive `1751565`, journal `aa4c91f`.

## Reviewer ownership

Only this report and:
- `apps/server/test/postgres-task-replan-review.test.ts`
- `apps/server/test/postgres-task-replan-process.test.ts`
- `apps/server/test/task-replan-process-worker.ts`

Backend owns fixture exports, product modules/schema/migration and DB registration.
Runner owns its implementation. Shared checkout edits are preserved; no recursive
agents or host mutations by reviewer. Initial suggested src test paths were
superseded by the explicit test-directory assignment.

## Current context and test seam

Final PRD/design/implement reviewed: no blocking design gap; detailed commitments
and matrices are in `acceptance-plan.md`. Existing conversation fixture and
Specification independent process tests/IPC worker inspected. Reuse isolated
schema migration, authenticated canonical commands, explicit effect reconciliation,
unique worker PID/PG PID, observed lock blocking, and synchronous SIGKILL hooks.
Fake physical results prove only DB ordering, never native writer absence.

Backend has confirmed planned `TaskReplan(db,hooks)` with before/after command
COMMIT and before/after publication COMMIT hooks, strict Owner command envelope,
scoped reads/receipt, and `test/fixtures/task-replan-fixture.ts`. Exact schemas,
command payloads and fixture exports have not landed yet; do not invent passing
placeholder tests against hypothetical fields.

## Independent cases reserved

1. Distinct Owner sessions/processes contend on publish versus dismiss: observe
   both actual blocked PG connections, then prove only one compatible outcome,
   preserved loser receipt/error semantics, no lost independent guard.
2. SIGKILL before/after joint publication COMMIT: exact approvals, both pointer
   switches, applicability, revisions, receipt and operation must roll back or
   persist together. Replay uses original command bytes and IDs; no new approval.
3. Dismiss during request-bound Planner ownership: no successor before trusted
   release; new late prepare/issue rejected, accepted receipt still replayable;
   independent Owner Stop and linked requirement survive.
4. Direct-SQL cross-request/source/authorization attribution, consumed approval
   without exact admission, typed-slot owner substitution and partial joint
   publication. Valid IDs alone must not pass exact ownership constraints.
5. Forged/stale predecessor private-transfer authority and unchanged-definition
   evidence misuse. Backend ownership rejects fake capability independently of
   Runner's separate real Host tests.

Prioritize cases not already covered by backend main/lifecycle suites; coordinate
fixture and root test registration before executing. Keep complete failed-run
history and rerun changed regressions after fixes.

## Verification

- Lint/typecheck/native import/diff: pass; frozen product inputs unchanged during
  final observer corrections, so broad source gates were not repeated.
- Independent real PG/process tests18/18; full PG328/328 and affected prompt-path
  PG17/17; final Linux module/race/vet/four binary builds: pass.
- Installed runtime audit43/43, native semantic supplement69/69, final backend
  observation132/132 and Runner observation136/136: pass.
- Independent final actual evidence recomputation144/144: pass.
- Decision: full-scope ACCEPT with the explicit coverage limits below.


## Incremental source review (implementation incomplete)

Read migration21, task-replan state/publication/Owner module, and initial native
Replan driver/probe. Concrete findings sent to backend/root; not a final verdict.

### Confirmed current code gaps

- `replanImpact` chooses the current non-request blocker OR guidance_paused Owner
  Stop, not both. `publishReplan` recreates only `holds[0]`; immutable provenance
  for each inherited independent hold is absent. Combination blocker+Owner Stop
  can therefore lose an independently owned restriction during replacement.
- `publishReplan` prior-publication branch checks only graph confirmation, not
  requirement confirmation. A new request for an already published joint proposal
  can supply a wrong/missing requirement approval and get a successful receipt;
  standalone replay can accept an unrelated extra requirements approval. Full
  compound approval identity must be checked without breaking exact request replay.
- Request blocker ownership is inferred by human-readable reason string equality.
  Use durable request→blocker identity; prose must not decide which guard resolves.

### In-progress SQL coverage to verify once completed

Current DDL lacks exact same-request source/proposal/issue pointer attribution,
source planned-Attempt matching, graph authorization ownership and actual Owner
command/name/payload/response checks for authorization/deferral. Same-Task FKs do
not prove these. Publication applicability and transfer JSON need exact normalized
identity/approved-envelope consistency. Backend notified; fixture tests will test
final schema rather than treating incomplete constraints as final implementation.

### Initial native observer coverage gaps

`publication_checks` currently checks Plan pointer but not approved complete
Plan content/membership/digest; request current proposal/source and native terminal
preparation attachment require additional binding. Independent saved Owner commands
must be compared to canonical receipts. Partial joint authorization is explicitly
labeled by root and is not yet a full authorization acceptance claim.

Workspace transfer observer also needs complete Task/resource/Runner/workspace/
from-Plan/target source binding beyond mutually consistent descriptor/root fields.
Physical absence remains a separate native observation. Driver correctly treats
completion_submitting as submission only and distinguishes finalized predecessor
from unfinished private HEAD/index preservation.


## Independent tests landed; database forwarding interruption

Owned files now contain six independent real-PG cases and three independent
process cases. Process coverage is before/after joint-publication COMMIT SIGKILL
and distinct-session publish versus dismissal with observed backend lock waiting.
SQL coverage includes unowned consumed graph approval, forged deferral request or
response, unrelated receipt, invented canonical source facts and exact dual-approval
replay. Root/backend registered both suites in the DB entrypoint.

Executed targeted ESLint: pass. `pnpm exec tsc --noEmit`: pass (session95443).
`git diff --check`: pass. First actual PG attempt (then five SQL + three process
cases) failed all eight before CREATE SCHEMA with ECONNREFUSED127.0.0.1:15439;
500ms duration proves no scenario executed. This is infrastructure interruption,
not a product regression or a passing test. Root/backend notified; local forward
recheck still unavailable. Do not claim source-ready until real execution succeeds.

Backend reviewed new negative cases and reports strengthening exact deferral
request/response checks plus canonical source Spec/graph/Node/guidance/workspaces/
holds facts. Earlier dual-approval replay, hold provenance and requester blocker
identity fixes are present/reported. These fixes still require the independent
regressions and full source review; earlier findings remain historical evidence.

Latest native observer review confirms full graph/membership/digest and saved
Owner commands added. Requested final completeness for prepare expected-version/
response-request and full joint requirement envelope/normalized input provenance.
No installed native Replan result has been reviewed or accepted.


## Executed independent gate (latest)

Database forward restored. First full independent nine-case run: **9/9 pass**,
87.43s (session88514). Added Node retry/request-blocker regression: **1/1 pass**,
13.34s. The suspected Node retry bypass is disproven: `prepareNodeSource` rejects
open Replan and rolls back the entire control transaction. No product fix needed.

Expanded request/prepare/dismiss before/after-COMMIT SIGKILL cases plus existing
joint-publication crashes and Owner contention: **16/16 pass**,146.66s,
session90474. A further actual Node request-versus-completion contention with two
observably blocked PostgreSQL worker PIDs passes **1/1**,14.18s,session29016.
Exactly one terminal command commits; replay retains its receipt. Every injected
crash asserts SIGKILL, never treats an arbitrary child exit as success.

Latest full lint, full typecheck, native app import and diff check pass. Backend
reports strict source/proposal snapshots and exact dual-confirmation fixes; Runner
and backend coordinated Replan transport watermark0 while retaining real input
cutoff in canonical context. Observer full graph/independent command/joint envelope
checks have been strengthened. All earlier failures remain historical entries.

### Historical confirmed defect (fixed and regression verified below)

`validate_replan_hold` reads but does not validate Owner response for resolved_by.
Independent real PG case constructs legitimate Owner Stop → replacement inherited
hold, then inserts an exact-shaped Continue receipt whose result is `unknown` and
sets resolved_by. The transaction **incorrectly commits**. Case fails as expected
with “promise resolved undefined instead of rejecting”,21.74s,session16304,
`postgres-task-replan-review.test.ts` inherited control receipt case.

Backend notified to bind committed response, exact request/scope/source/activation
and original Stop provenance. Existing source claims are not sufficient evidence;
re-run the negative and relevant positive control path after fix. **Not yet
source-ready**. No installed native acceptance is claimed.


## Final source gate — SOURCE-READY

Final complete independent suites: **18/18 pass**,163.73s,session3921,
start20:49:25. This final run includes the previously failing forged hold-resolution
receipt case. Backend's current strict hold fix verifies actual successful Owner
response, exact scope/request/activation/source/control, correct Continue versus
Retry kind, and immutable origin/resolution receipts. Backend separately reports
both legitimate Continue/carry positives passed, plus attempts to alter successful
Stop/Continue receipts are rejected (1/1,29.62s). Original failed21.74s evidence
is retained above; it was not weakened or relabeled a pass.

Final independent coverage:
- Eight SQL/control cases: unowned approval consumption, forged deferral request
  and response, unrelated deferral receipt, fabricated source facts with self-
  consistent hash, request-owned blocker Retry rejection, exact joint replay, and
  forged inherited Owner Stop resolution.
- Ten separate-process cases: SIGKILL immediately before and after request,
  terminal prepare, dismissal and joint publication COMMIT; actual observed
  Node request versus completion and Owner publication versus dismissal contention.
- Every crash checks atomic formal snapshot/receipt rollback or persistence and
  exact original-ID replay. Request/prepare/dismiss retain cleanup ownership and
  reject later new outcomes; joint publication preserves both pointers and approvals.

Latest full `pnpm lint`, full `pnpm typecheck`, native server app import and
`git diff --check`: **pass**. Tests use real isolated PostgreSQL schemas and child
processes; fake effect completion in those fixtures proves database ordering only.

Source review covered canonical mutually exclusive source/phase handling, frozen
live authority, queue/pump admission, quiescent publication including preparing
Planner, one typed publication owner, exact requirement/graph consumption,
Plan/Spec applicability, independent holds/guidance/linked exits, both backend and
root Host transfer checks, retained completed history, source predecessor chains,
scoped reads and generated consumers. Replan Dispatch watermark is now0; its real
input cutoff remains in canonical context/proposal and guards. Prior migration20
is unchanged.

Owning spec `.trellis/spec/backend/task-replan.md` records the implemented boundary.
Native observers now bind full graph/membership/digests, exact preparation bytes
and phase version/request, independently saved Owner commands, full joint
requirement envelope and normalized inputs, and exact transfer source scope.
No unresolved confirmed observer false-positive finding remains from this review.

**No remaining confirmed source defect.** Root may freeze fresh source and run
Linux module/build/full-PG and existing-host native acceptance. Actual cross-Node
private work, completion/exported Git, joint publication/exits and restart evidence
are still required; local source gate and observer unit tests do not claim those
physical outcomes. Historical in-progress notes above are superseded by this
source verdict, not by a final native acceptance decision.

## Existing-host native progress and observer corrections (acceptance pending)

Frozen Linux module/race/vet/four binary builds and images are reported PASS;
full actual Docker PostgreSQL suite **328/328 pass**,82.81s. Original network and
bridge proxy build failures remain retained. Native Task is
`dd67088b-1886-4d2c-b402-62c242f9f07b`. Previously accepted Specification Task
`89effbce-76d8-40c6-8702-70d856c369ba` and monolab remain preservation requirements.

Actual original open Attempt `526a61c5-18d8-46d3-bdf1-6a0e5561c061` failed Git fetch
with ref_unavailable before private fixture creation. Root repaired only this
service-owned cache's proxy after backup. Original failure is retained. Actual
Owner Stop `51faef0e-53eb-48a8-8bdd-b08418339be7` and exact replay succeeded; first
Stop observer saw physical absence before its outer SQL snapshot reflected the
canonical release and is retained FAIL. Separate `open-recovery-stopped-observe-v2`
proves both canonical and physical release. Owner Continue and replay created a
fresh exact source/Attempt with the same Task/Node/activation/Spec/Plan; successor
observation passes. This is Stop/Continue recovery, not same-operation open retry.

Continued Attempt `f6f4bf0a-74e7-4da4-8146-2b3b833fd720` authored the actual terminal
Node request and preserved private work. Dedicated request/Planner preparation and
actual generic Owner retry_replan now have native coverage: original Replan source
`336c5815-ae52-400f-9380-83fb5c5ead00` precedes fresh source
`0d00b9c6-19e5-469a-b5c6-33469d74f669`; fresh Planner
`c5c79bef-a36c-45ac-aa3e-0282471accfb` prepared joint proposal
`e90a71be-203f-4f11-ae5d-534f9073cf98` / requirement
`e35ef20a-7c39-4c38-9b96-39582989cd06` and physically released. Issue-answer remains
PG/process-only; do not collapse it into generic Retry coverage.

### Fixed observer defect: Planner Stop repository_free

Original `replan-prepared.json` failed only prepared_planner_physically_released:
the probe wrongly expected repository_free=true. Actual Stop requires null under
migration18 and generic Host effect scope; true describes repository-free Node
completion only. Backend corrected `infra/probe/task_replan_probe.py` and its test,
binding exact succeeded Stop/receipt/request/Attempt, null repository/workspace/
lease/completion scope, actual writer_absent, no workspace/Git result or lease, and
canonical release. Full Python suite **193 pass** local and host; reviewer targeted
**11/11 pass**, including actual retained failure and negative scope checks.

Corrected `replan-prepared-observe-v2.json` is reported PASS. Original SHA256
`8da8fe64cd611dc72713c45e22a732fde73d9105d7a26b3104c898fc2862cc6a` remains exact.
One stdout event at stream sequence13/order14 was already visible in original
subsequent native reads while the outer SQL snapshot ended at13. Reobservation
checks exact 2984-byte body/digest/dispatch/boot/order and only its corresponding
log cutoff/activity projection change; exit_observed remains false. Original raw
prefix bytes were not captured, an explicit historical limitation. No blanket
telemetry suppression or canonical state waiver is used.

Only these two Python observer files changed after the original freeze and are
outside runtime image build inputs. Exact overlay binds installed base, both
manifests and source tar hashes; host observer-overlay-v2 PASS. Base source tar
`2c462d325028f6d644d7d05eba6e3e12bd45daa154fac052a07221f4054680f3`; final v2 tar
`057e6dcb5c25f24b72e13879d2cce217fcae1ece115378dbaa239a73bad909bf`.
Runtime/Go/image inputs and installed binaries remain from the passing frozen build.

### Fixed audit comparison: legitimate historical source operational transition

Actual recovery-chain-v2 failed only historical_source_snapshot_retained; other
**19/20 checks passed**. The continued source
`278f9385-19a7-4a13-b8f4-57f857c00677` changed waiting_reason null→semantic through
request `4b0d7d8c-6cda-4806-96db-5c77214e4381` and requester blocker
`225ba675-46e8-46b3-9fed-17b6b54031e2`. This is `requestReplan`→`blockNodeSource`,
permitted by migration17/18's immutable-source trigger. Every other source field
was exact, including done=true and full prompt/context/digest/identity; the failed
original source remained entirely unchanged.

Independent `/tmp/monos-replan-native-recovery-chain-v3.py` permits only this exact
request/blocker/source/Attempt/receipt-bound reason transition, keeping every other
field exact except existing scheduler polling. It requires the original v2 FAIL
and its exact SHA256 `56e2f903dfd47c2b04ccade8a75848a814635b16b92c7a28f70e4166431393ee`.
Local **6/6 groups pass**, including actual original evidence, 17 immutable-context/
identity/blocker/other-reason negatives and 10 prior attribution negatives. Python
compilation passes. No product-source change was needed. Root owns host execution.

### Required remaining native evidence

Full-scope verdict remains **pending native acceptance**, not ACCEPT:

- recovery-chain-v3 actual PASS;
- exact joint Plan/Specification publication and new Node unfinished-work transfer
  with its own manifest/completion and actual exported Git;
- Conversation-origin standalone replacement from completed work, then second new
  Node manifest/completion/Git;
- actual issue dismissal plus independent requirement withdrawal / graph dismissal,
  all bound to saved Owner command/result/replay bytes;
- supplement-v2 actual PASS and restart-v4 before/backend/Runner PASS with retained
  raw logs, source/receipt/approval/transfer/history, old accepted Task, legacy
  fixtures, monolab, software and root/native/Git records all checked.

Final execution instructions: `/tmp/monos-replan-native-final-audit-v4.md`.
Restart-v4 changes only its prerequisite to recovery-chain-v3 and its distinct
output filenames; strict persistence/physical checks remain unchanged. All failed
observations and earlier audit versions stay immutable. Latest full source lint,
typecheck, import and independent PG gate remain passed; these local audit/report
changes do not justify rerunning the already-passing broad product gates.

### Independently read native recovery and joint publication PASS

Downloaded original host evidence read-only after execution. Recovery-chain-v3
**21/21 checks PASS**, SHA256
`f9b4baccb86492b76e8f911ca8693e5d6fff2bc4de6a79cfe2fe51e919fcc3a8`.
Reviewer reran the precise source comparator against those actual rows successfully.
Joint `replan-published.json` **16/16 PASS**, SHA256
`9e544df78f7435c16abf77800dea5285e0f3d109e6544b78c4d89f177cc28fdb`.
Reviewer separately downloaded saved graph/requirements confirmation and publish
commands, then recomputed 14 full graph/joint authorization checks successfully.
Publication `c0df5251-044d-4447-a1f2-709a6cf33d8a` atomically changed Plan to
`5e4920f7-a7b6-456b-88ce-90b7f0b1aff2` and Specification to
`d9f0b569-1035-433c-9f5b-a299f816038a`, consumed the exact two approvals and released
the publication slot. Native completion, completed transfer, exits, supplement
and final restart remain pending; no full-scope ACCEPT yet.

### First actual new-Node completion and supplemental preflight correction

First `replan-new-completion.json` has **15/15 native checks PASS**. New Node
`21e0c5f6-639d-4261-a6e9-0577e262bcf6`, Attempt
`d5cc59ae-491e-4ae4-9865-50d49d1ea130`, source
`7e378a62-8234-4c7d-bab3-ba9630c80ea6` produced its own manifest digest
`56373f5291a84e897a834a04f1e97c6bf9295dfe670723affde6e46dd1500093` and completion
`ab0c3baa-5281-443c-b7ec-3ecc6c311d3f`. Actual/exported commit
`90e5d0d96e70b3441049320f0ddae6a5746fde1d`, tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`, parent
`e3dbc8e116a4a53f582c3a1d841daedce0cfcc57` preserve the private result under its own
new completion authority. This is no longer a pending unfinished transfer path.

Before any remote supplemental stage ran, reviewer executed the entire stronger
completion comparator on actual evidence. Supplement-v2 raised KeyError for
`operation.result.completion_manifest_digest`; its prior synthetic fixture had
incorrectly duplicated semantic fields into the raw Host result and modeled an
async command receipt as committed. These were audit defects, not product defects.
`apps/server/src/node-completion.ts:85` explicitly enriches only formal completion;
`apps/server/src/service.ts:317` persists the original exact admitted response.

Independent supplement-v3 fixes the exact ownership: operation column digest equals
full manifest digest and formal completion digest; formal completion equals raw
physical result plus frozen summary/artifacts/handled-guidance/digest. Raw physical
result cannot inject any semantic field. Receipt must equal the exact admitted
request/operation response, while operation succeeded/lease released and physical
absence remain separate mandatory checks. v2 and local failure report are retained:
`/tmp/monos-replan-supplement-v2-preflight-failed.json` SHA256
`0a935406dbfc69dcd0893a26f0aa73f2b8ddc313000cd1747cc4704653671b1f`.

Actual-record local regression **3/3 groups PASS**, including 18 tamper negatives.
Reviewer then ran every first-stage supplemental check against fresh host reads
without calling the probe constructor's filesystem mutation: **15/15 PASS** in
`/tmp/monos-replan-supplement-first-preflight-v3.json`. Includes canonical frozen
source/Role/launch, full manifest/body, exact native CLI bytes, original admission,
current immutable records and native account/identity, trusted checkpoint side
branch, actual/export Git parent/tree, fixed-base ancestry and exact operation ref.
No second-completion or exit/restart coverage is claimed by that partial preflight.

Use `/tmp/monos-replan-native-supplement-v3.py` (SHA256
`dfb827b5105748fbf6139ef9607490ddbef53f5f5ab58030070c89801f1484d7`) and independent
`/tmp/monos-replan-native-restart-v5.py` (SHA256
`1ee95b48e92f1933d2c5a76847704327d0c2468dc36c6654118be7665dd3eb62`). Restart-v5 changes
only its own output names and prerequisite to supplement-v3, retaining chain-v3.
Current final instructions are `/tmp/monos-replan-native-final-audit-v5.md`.

### Generic Retry attribution and second-path timeout

Reviewer independently matched actual saved generic retry_replan command to the
immutable DB receipt and source predecessor chain: **8/8 checks PASS** in
`/tmp/monos-replan-generic-retry-review-v1.json`. Same Task/request/Plan/Spec basis,
fresh source/Attempt, both exact frozen context hashes/prompts, old/new canonical
release and fresh terminal joint proposal are checked. This supports generic Retry
native coverage, never issue-answer or same-operation workspace retry.

Root reports `completed-routing-incomplete.json` FAIL after the original 300-second
observation. Conversation Attempt `2c548971-7dc6-4852-b837-92fc60ff8e3a` remains
RUNNING with no formal command (launch and step_start output only). No death or
semantic insufficiency is inferred from timeout. All first-path PASS and the new
failure remain intact. Backend owns a narrow review of the frozen Conversation
protocol's insufficiency/issue wording before any recovery or product-source
change. Reviewer has not changed host state or product source. Native completed
transfer/exits/restarts and final ACCEPT remain pending.

### Confirmed frozen Conversation protocol mismatch; minimal source fix reviewed

Backend/root confirmed canonical Conversation protocol instructed graph
insufficiency→issue while the already implemented Tool Protocol and Runner prompt
support atomic Conversation reply+routing replan. Timeout causation remains
unproven. Backend corrected only that sentence in task-conversation-state.ts;
actual insufficiency now uses replan with exact basis/text, dedicated graph
preparation waits for quiescence, ambiguity still uses issue, and Conversation is
explicitly forbidden to call request_replan/prepare_replan.

Reviewer read original file directly from frozen source-v2 tar and proved current
file equals exactly one old-sentence→new-sentence substitution; every other byte
matches. Before SHA256 `006046a2f73a2ce0e5e0a3d3a8b8b292b3fbc78cf7d274c8282c0ac62d91b706`;
after `568b2997834d9d24d78a3b337c4b18628617c72a3217c9d6f96ef75c1a082145`.
Local exact delta report: `/tmp/monos-replan-prompt-exact-delta-review-v1.json` PASS.
No executable transition, schema, Runner/Go or existing frozen source is rewritten.

New runtime source requires fresh source-v3/server build and a distinct installation
record; prior two-observer overlay cannot authorize a third runtime file. Full
reviewer matrix `/tmp/monos-replan-prompt-fix-validation-v1.md` requires explicit
Owner Stop, canonical and physical release, exact preserved failed input/source,
complete pre/post canonical/raw/native/root/Git/receipt snapshots and fresh backups,
new exact source/image provenance and immutable first-path/accepted history.
Targeted real PG source/fresh-retry paths plus lint/typecheck/import replace an
unnecessary repeat of unaffected full PG/Go gates. Actual same-input Retry must
create a fresh source with corrected prompt and preserve old launch bytes. Final
native paths and replacement final software/restart audit remain pending.

### Prompt v3 built, installation still gated by actual Stop recovery

Reviewer read actual source-v3 manifest: exactly the reviewed one-file prompt delta
from source-v2, no other file changes. Tar SHA256
`7c816332f0d1b94e51a3108ed694390e21db2c7bfd834d0f00e5fa5c8cdd491a`.
`/root/monos-replan-prompt-deploy-v3/build/built.json` PASS binds tests image
`sha256:58638ab9409217350fffdd21c28195c10902a78e8d99ca5f465e24a668d23ced` and server
`sha256:916acb293d39cb6e0e4c8649b133e703a1eb96da717f2df1f7f97a472fb9bca4`, and reports
unchanged Go inputs/no runtime proxy environment. This is built, not installed.
Backend reports lint/typecheck/diff PASS; targeted 17 real PG cases were running
at last report, with native import to follow.

Actual Owner Stop `2f4c18ef-7111-4145-9ad8-caaa4f9228b8` remains recovery. Original
Conversation Attempt is fenced CANCELLED, but canonical process_absent/released
remain false. Root/Runner report systemd active/exited RemainAfterExit, MainPID0,
ExecMainStatus0, no ControlGroup; Host inspection reports unresolved cgroup before
systemctl stop. Reviewer does not infer release from those partial OS facts.
Runner owns the narrow diagnosis/recovery decision; there is no established
post-Stop installation baseline yet. No deployment or retry has been accepted.
Potential further runtime change would require its own affected validation and
fresh provenance; current v3 prompt-only carry-forward claim stays confined to
its actual unchanged Go inputs. All original failures and native successes remain.

Backend targeted-gate update: lint, typecheck, native TS import and diff check PASS.
Two real PG files ran 17 cases in371.11s: **14 PASS,3 FAIL**, not a clean targeted
gate. Passing cases include Conversation→Replan, three missing-outcome Retry
physical-isolation/original-source-immutability cases and concurrent Node lease.
Failures are initial Node promotion No dispatch before Replan withdrawal scenario,
Task Cancel followed by Conversation promotion No dispatch, and 65-row bounded
history withdrawal timing out at60s. Infrastructure timing is suspected but not
proven. Backend is rerunning only those three, without source/test edits, logging
`/tmp/monos-replan-conversation-prompt-recheck.log`. Original failures remain;
reviewer requires the actual rerun results before claiming targeted-gate PASS.

## Independent review of active/exited Runner recovery fix (in progress)

Root reports the exact acknowledged active/exited shell was externally cleaned up,
then the existing Runner restarted; `completed-conversation-shell-recovery-v1.json`
PASS. Same formal Stop `2f4c18ef-7111-4145-9ad8-caaa4f9228b8` subsequently succeeded
with canonical process_absent/released=true. This was explicit infrastructure
intervention, not proof of autonomous product recovery. Earlier 600-second
`completed-conversation-stopped-v1-deadline.json` FAIL remains preserved.

Runner proposed narrow helper.go proof for acknowledged, validated active/exited
RemainAfterExit units whose kernel cgroup and original PID are absent. Verify
stable systemd properties twice, dispatch/Attempt/UID/group/cgroup scope, main exit,
valid invocation, no Restart and no pending unit job; share status path with watch,
reconcile and Stop. New unit tests cover proof negatives and Stop invocation.

Initial independent code review found two concrete gaps; freeze held and Runner
notified to fix them before Linux/native acceptance:

1. `status`'s new Population ENOENT branch cannot run because Linux Population
   already converts ENOENT into false,nil. A nonempty ControlGroup with missing
   kernel cgroup bypasses the new proof. Pure verifier tests do not exercise that
   production routing. Require actual routing coverage and explicit absent-group
   detection without weakening unknown/read-error cases.
2. `status` saves Acknowledged=true before validating the retained exit proof.
   Although exitManifest holds false for the first call, the failing observation
   changes the durable record; a second call can then pass with that new ack.
   Move acknowledgement persistence after successful status validation, and prove
   two uncertain unacknowledged exit observations do not create acknowledgement.

No false physical absence is accepted while these findings remain. Reviewer did
not edit Runner-owned files or run host mutations. Final source-v4 will require
full fresh Linux Go/race/vet/four-binary build and installed native reproduction
without external shell cleanup; prompt-v3 images can carry only by exact Docker
input equality.

Prompt PG gate update from root: actual built-v3 Docker ran both affected files
**17/17 PASS**,11.83s, same test timeout limits/local database network.
`/root/monos-replan-prompt-deploy-v3/build/targeted-postgres.log` and result record
retain exact execution. Prior14/17 and16/17 SSH-forward failures remain; no timeout
or test/source edits were used to obtain the final pass.

### Runner findings fixed and independently source-verified

Runner fixed both findings in its owned files. Production `status` now calls
`statusOfUnit`: Lstat the actual canonical cgroup path before Population, then
Lstat again after a false Population result to detect the shared ENOENT conversion
or disappearance race. Every missing-group case enters the strict retained-exit
proof. Acknowledgement is persisted only after unit/population/PID/exit checks
succeed. No historical failed observation can promote its own acknowledgement.

New tests directly execute that production status core with narrow I/O seams:
initial missing nonempty group; disappearance during Population; failed proof;
two consecutive unacknowledged exits with zero saves for empty/nonempty groups;
normal live acknowledgement; identity/cgroup/population/stat failures with no ack.
Pure proof tests additionally reject foreign dispatch/Attempt/User/Group/cgroup,
missing acknowledgement, nonterminal/main-live state, absent/invalid invocation,
pending start/stop, failed inventory/kernel reads and changed observations. Original
Stop uses the same status proof without controlling an already absent tree.

Independent `mise exec go@1.27.1 -- go test -race ./internal/host -run
'Exited|Status|Stop|MainExit' -count=1`: **PASS**,1.762s. Independent Host vet and
diff check PASS. Initial bare go invocation could not resolve an unset mise shim;
no tests ran in that invocation and no global tool configuration was changed.
These macOS focused tests are not native systemd/cgroup acceptance.

Reviewed hashes: helper.go
`fccac4ca6536c71687739096cdcb8f38c20ba9eef7aa3518aaaf41e82e431940`, exited_unit_test.go
`04f0a494818076c868d05d3d532acb4cb5500d2adaa48aff18b86cbecefc3a6d`.
**No remaining confirmed source defect in this fix.** Source-v4 freeze has343
files and tar `89cf028d514b3b3bd080068db1cdcef9d7962b78f5a0db6941ae9c7a8c95ca1c`.
Root is running fresh full Linux module/race/vet/four builds. Images carry from
prompt-v3 only through exact complete Docker COPY-input equality; final Go binaries
must be rebuilt. Installed genuine active/exited regression, without external
shell cleanup, remains required before claiming the product fix works natively.

### Distinct pre/post installation observer prepared

`/tmp/monos-replan-runtime-install-audit-v4.py` SHA256
`c1196377f2fdd7a645228b6234ce28eec93a4b0388fd8a121b8f65f7ccd4e22e` is prepared for root
execution only. Reviewer has not run this audit or mutated remote state. It writes
exclusive before/installed reports in `/root/monos-replan-runtime-deploy-v4`, using
common-v3 and retained restart-v5 pure checks. Three local groups PASS, covering
actual preserved failed input/source/Stop/replay,10 control/source mutations and
build input/image/binary/scope negatives. Python compilation passes.

Before requires exact failed input `f764608e-74a9-4881-ac9f-08a9fc4a9b1f` version2,
its original source/Attempt/Stop chain, full raw row equality, and zero other global
pending work. Source-v2 and original binary hashes remain the installed baseline;
original running server image is bound to retained build-v1 manifest-list output,
not the mutable latest tag already updated by v3 image build. After requires exact
source-v4 and four rebuilt binaries plus carried v3 image and full immutable build
provenance. Both snapshots preserve complete canonical/raw/native/root/Git/receipt/
old-Task/legacy/evidence records. Across installation only polling timestamps and
explicit service/transport identity changes are allowed. No implicit Retry/input
resolution is accepted; no final ACCEPT until the remaining native chain passes.

### Final runtime installation and installed Host regression independently verified

Source-v4 Linux module/race/vet/four-binary build PASS is bound by actual build
record SHA256 `f45ce8d3aa123e5956a5e3d67f5e6a537b20d2fc12ca9cad994eb9014d0a4e92`.
Complete Docker COPY-input equality carries the v3 tests/server images; final
manifest SHA256 `e125d117b5b337cc15f6889c23c5fa2beba2356956dd481b6f17ca58f2e669aa`.
Reviewer previously recomputed its build contract and actual before-input checks.

Initial installation stopped at bootstrap --check with seven retained failed-unit
metadata records. Root preserved the original failure, verified each exact Attempt
canonically and physically released, reset only those failed metadata records,
then resumed unfinished bootstrap/image/start steps. This installer recovery is
distinct from the earlier external Conversation shell cleanup and from product
runtime recovery; neither failure is discarded.

Actual `/root/monos-replan-runtime-deploy-v4/installed.json` has **43/43 PASS**,
SHA256 `18958cecd5134ead870c6339849894de437a2af969c37a7805660d057449ca28`, bound to
the before snapshot SHA256
`b9d33bc6b37ba2963c0b9d364756974c71412a3e6aa4051db16a7e29fb8a31a9`.
Reviewer downloaded both full snapshots and independently recomputed exact Task/raw
records, native identity/journals, all Git/root facts, receipts, legacy rows, failed
input, evidence hashes, monolab identity and intended service transition. Historical
heartbeat freshness was evaluated at installed-report filesystem mtime, explicitly
not presented as a fresh current heartbeat observation.

Installed Host fixture `/root/monos-host-exited-regression-v1/022-PASS.json` has
SHA256 `ec24a8eed70c2c26927611407bbd35b4a4657bd608beb187cd4e234f07a3075b`.
Actual installed helper SHA256
`8ccda249ce49f52d196085dccab5934b5d8c160dc7bd5e1236ccf47d540be582` matches build4 and
installed4. Reviewer independently checked saved live kernel identity, durable
acknowledgement, natural exit, absent original PID/cgroup, unchanged unit invocation,
and identical installed-helper status/original Stop/replay. Separate read-only host
inspection still found that same absent PID/cgroup, exact retained manifest/unit
and helper bytes. No external unit cleanup or Runner restart occurred in this
fixture. Actual exited ControlGroup was empty: this proves the Host empty-group
status/Stop path, not native nonempty-group coverage or canonical Task/daemon
reconciliation. Local source tests cover the nonempty and disappearing-group cases.

Combined independent pure comparison is **23/23 PASS** in
`/tmp/monos-replan-installed4-host-review-v1/independent-review-v1.json`; all downloaded
raw evidence remains alongside it. No remote audit stages or host mutations were
performed by reviewer.

Restart-v6 (`/tmp/monos-replan-native-restart-v6.py`, SHA256
`448f01302e584b85c0b9c7d52c12bc0c009b72725ef93786d3f5600ac3e03784`) now binds this
exact installation, original before snapshot, every source/build/image authority
and the installed Host fixture with retained absence/manifest/Stop/evidence hashes.
Its four local groups PASS, including twelve Host identity/absence/replay negatives.
Supplement-v3 and recovery-chain-v3 prerequisites stay mandatory. Same-input fresh
Conversation routing, standalone completed-work publication/new completion,
independent exits, supplement and final idle backend/Runner restart stages remain
pending. Full-scope verdict remains **pending native acceptance**, not ACCEPT.

### Same-input Conversation retry and original standalone preparation verified

Actual retry-ready8/8, routing10/10 and prepared8/8 reports PASS. Independent
recomputation of exact retry command/DB receipt/replay, input version2→3,
fresh predecessor-linked source, corrected protocol and preserved old prompt/context,
same Owner message/cutoff, atomic reply/routing/request origin, canonical CLI bytes,
dedicated scratch-only preparation and actual physical release: **27/27 PASS**.
Report: `/tmp/monos-replan-conversation-final-review-v1/independent-review-v2.json`.
Local v1 comparator stopped before output on an optional absent private_checkpoint
key; preserved script v1, corrected v2 uses the actual optional-field contract.
No remote stage was rerun and no product source was changed.

Conversation source `5f19c0ea-d26e-4206-b4d3-b2328c943305`, Attempt
`b75c10ce-24c6-4801-a917-0a26846c78ed`, resolves the original input into request
`0da48a09-7b82-4be9-a631-741a66ef4252`. Dedicated source
`0e0cb290-f51a-4f3f-a659-680b886b43de`, Attempt
`e056ac25-58f9-412f-8fed-52e07417a5e2`, prepared proposal
`24bd71e6-31a4-4157-a23a-03b81203bf31`; both Attempts succeeded and released.
Original prepared report SHA256
`8768fb2355cd85c0dc14c185e14e3bb8c8a8db3f6a677964831988a4d1d8699f` stays immutable.

After overnight interruption, root's first confirmation received HTTP409
unmet_precondition, 'Replan proposal no longer eligible'. Exact rejected command,
repeat response and complete conflict snapshot remain preserved. Independent read
of SQL evidence shows unrevoked original authorization expired at
2026-10-01T16:21:14.308Z before observed 2026-10-02T03:39:43.497855Z. This matches
the actual eligibleReplan clock_timestamp guard; it is not a product defect.
Root is executing formal retry_replan on the same pending request, with distinct
source/proposal and separately named successor evidence. The original preparation
and rejected confirmation are never overwritten or reused as fresh authority.

Owning backend expiry/same-request Retry and Runner exited-unit/acknowledgement
spec additions were reviewed against eligibleReplan and the actual shared Host
status path. No spec/source mismatch found. Supplement-v4 and restart-v7 are being
prepared to bind the full expiry/rejection/Retry/successor/publication chain.

### Expired proposal successor publication and second own completion verified

Fresh source `5410aeb3-8a12-4650-9cc1-6124ade24677` prepared proposal
`640d6060-e200-4a07-b59b-16669e3a68dc` on the same original Conversation request.
Actual successor preparation8/8, standalone publication10/10 and second native
completion15/15 PASS. Reviewer independently recomputed expiry/Retry/source/root/
exact authorization/publication checks **33/33 PASS** plus actual saved second
completion contract **8/8 PASS**. Report:
`/tmp/monos-replan-expiry-review-v1/independent-completion-expiry-v1.json`.
Four actual-record test groups PASS with ten tamper negatives.

Original wrong-basis prepare request is retained in the Planner's local journal.
Actual stdout shows backend version_conflict, command-status unknown, same request
with changed bytes rejected as control_unavailable/payload_conflict, another unknown
status, then fresh request `eaa1295c-a92e-4532-a7b9-ef91e725f5c4` committed after
correcting only the basis Plan ID. Unknown means no committed receipt here, not
no local journal. The model's earlier claim that it was not journaled is disproved
by retained exact bytes/digest. Both rejected and successful journal entries and
stdout SHA256 `08a4ce72f917c0e9d8948f0c520a6885b73b6f56f246f36ff0e7fe81507ea044`
are explicitly checked; root did not repair this Agent-authored payload.

Second Node `7dcdae90-1e3c-4a05-b615-50173bd04417`, Attempt
`90f04541-81e6-4e23-b372-2564f8ee8226`, source
`b46b2510-c3c4-41ba-9b9a-ca3b608f7ae6`, completes through its own operation
`aa499fd8-bee4-45b5-8e9f-85caf4bde381`. Effective Plan
`2a18626b-404f-4486-a665-fd520ff37f36`; unchanged Specification
`d9f0b569-1035-433c-9f5b-a299f816038a`. Manifest digest
`b3305bc090ea896a10bd30add16a9f2c8e868086233f74f6b04bf350afebf5f5`, actual commit
`875b02173ec42708a8d1ebeeb80be4eb56362fd0`, tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`, parent exactly first result
`90e5d0d96e70b3441049320f0ddae6a5746fde1d`. This is completed-result inheritance
and fresh own completion, not historical completion relabeling.

Final immutable audit artifacts supplied for parent-only execution:
`monos_replan_expiry_audit_v1.py` SHA256
`9558e18da0e7b7e645875143678015edf04483c4d8f4804cf6f75e3cb61a8650`;
`monos-replan-native-supplement-v4.py` SHA256
`35c9e294a11a13f947e0f21235e0d8b14040e0521db33f05a8f7dcdbd059f1b7`;
`monos-replan-native-restart-v7.py` SHA256
`50786114afc6715b43db5b0ee21b3c799184df580db2ec7f524f76fdb3fe1db1`.
Restart-v7's retained four regression groups PASS. Full instructions are
`/tmp/monos-replan-native-final-audit-v7.md`; all prior versions remain unchanged.

### Issue-input actual Runtime failure and same-input Retry independently verified

Original issue-dismiss routing300s incomplete report observed a pending input;
no failure was inferred. Continued observation later found actual terminal Runtime
step_finish reason:length with31999 reasoning tokens/output1, followed by
FAILED/missing_formal_outcome and verified canonical/native process release.
Input `261ac0e1-6b98-4279-87fe-cacdff059ab4` failed at version2; original Attempt
`3ceb2a98-3bf4-411f-bfae-3da75e428b15` has no commit_task_turn outcome. Its read
commands and failed raw output remain retained. Original system Stop
`7ba44834-fa93-40ed-8d85-4b35364b62f9` succeeded with writer_absent=true, matching
native journal/absence. Root reports no manual Stop, cleanup, source edit or new
input for this recovery.

Exact Owner retry_task_input version2→3 receipt/replay, same original input/batch/
watermark, entirely unchanged old source, preserved two incomplete observations,
completed work and messages, plus fresh source `dc73d047-106f-42c2-9fce-3cade5755035`
and Attempt `529ffdbe-c018-4ea9-8ccc-e7f648b3b1ff`: **14/14 independently PASS** in
`/tmp/monos-replan-issue-retry-review-v1/independent-review-v1.json`.
Actual failed stdout SHA256
`12cf21c0b655fdfd32d68895fa1c7b817467383f76ec0d654612bfb1b5639708`.
Fresh routing/issue dismissal, linked withdrawal/dismissal, final supplement and
restart remain pending; this additional review does not change the frozen audits.

The second issue-input Attempt `529ffdbe-c018-4ea9-8ccc-e7f648b3b1ff` also ended
with actual Runtime length31999, no semantic tool call, FAILED/missing_formal_outcome,
input failed/version4 and verified release. Independent full raw-log integrity,
decoded step_finish→exit→absence, no receipts/tools, frozen source and completed
result preservation: **6/6 PASS**, evidence SHA256
`11b02af2ac8e9c0a6ee096ae3c8cded95bf70e99f5e7bc339a76f9adf2786a8d`.
Root proposes an explicit Owner Project-context clarification before another
same-input Retry: requested future final verification is additional work outside
the already completed goal, with its missing output to be resolved by dedicated
planning. Reviewer finds this within fixture scope only as a newly recorded Owner
interpretation through the normal configuration command, preserving every prior
input/source/failure and all other Project content. It must not be labeled an
unchanged-context autonomous success or proof the earlier ambiguous text necessarily
implied graph insufficiency. Actual configuration command/replay and fresh frozen
context remain to be reviewed; no product-source change is authorized by this review.

### Clarified same-input issue path and independent dismissal verified

Formal save_project config36→37 appended only this fixture Project's context;
exact command/replay, other config equality, source configuration_version and
parsed observation.snapshot Project context independently **11/11 PASS**. Exact
retry_task_input version4→5 preserved old entire source, message batch, Plan/Spec
and completions. New source `ed168f57-622e-4f8e-a47e-782ef14e7fbf`, Conversation
Attempt `4d4e8520-e142-4f73-9796-8d934530729e`, froze the explicit clarification.
The original temporary observer used context.project incorrectly and failed only
after Retry committed; separate read-only corrected observation used the actual
context.observation.snapshot JSON. No command was repeated.

Actual routing10/10, issue preparation2/2 and dismissal7/7 PASS. Independently
recomputed routing/native receipt/source binding, one terminal scoped issue,
scratch-only source and repository-free Stop/physical release, exact Owner
dismissal receipt/replay/decision, retained issue/direction, unchanged independent
requirements and completed Plan/Spec/result, and no new Node: **19/19 PASS** in
`/tmp/monos-replan-issue-clarification-review-v1/independent-issue-dismiss-v1.json`.
Request `c4381eeb-65af-4f4f-8c59-4e339031b396`, source
`f22c4049-54f1-4425-92ce-eb79a0d3631e`, Planner
`b19625fc-d57f-40de-b2ae-6933f63061c5`, issue
`9f8a0ae2-3210-4c6f-82c9-a9ae4cae88f9` remain precisely attributed.
Dismiss report SHA256
`ee532f5c937ef7de8148f891dcf22b20e86c2aa86f01a6f53cb94ee6a5ee143a`.

Coverage is native issue dismissal following same-input Retry with explicit Owner
context clarification; native issue-answer is not claimed. One retained Agent-text
imprecision is not fixed: its issue reason parenthetically calls the completed
Node's earlier work 'unfinished-checkpoint inheritance', whereas that Node's actual
goal was completed-result validation. The additional undefined output still forms
the real planning issue, and exact formal Node/Plan/source/completion facts remain
unchanged. Do not rewrite historical model text or claim that phrase factually
matches the Node definition. This is not a product transition defect.

### Independent requirement withdrawal and graph dismissal verified

The original withdraw-input Attempt `7b905b2d-3a6e-40ed-a708-8dfff23a7377` actually
failed after Runtime length31999 with no tool/receipt, followed by system Stop and
physical/canonical release. Original pending timeout and terminal observation remain.
Independent raw/source/result/failure checks **8/8 PASS**; full failure evidence
SHA256 `1c724e0645e297730ccf503f6f3ac9bac8626ab67c5734b67d8588c7140e79aa`.
Root explicitly clarified only input `0818803b-f986-44a7-8066-a979817fbed8` through
an appended fixture Project context, then performed same-input Retry2→3. Exact
configuration command/replay, original source/input/protocol/result preservation and
fresh frozen context independently **11/11 PASS**. This is Owner-clarified recovery.

Actual final routing/preparation/withdrawal/dismissal all PASS. Independent exact
native/semantic/source/requirement envelope and two separate Owner exits/replays:
**25/25 PASS** in `/tmp/monos-replan-withdraw-review-v1/independent-final-exits-v1.json`.
Request `98818595-2d66-43d0-8585-4c4f5b5b8583`, graph proposal
`d2447a42-7472-4401-af11-13b3fc067359`, requirement proposal
`d2deeca0-6624-42e8-bfb1-fc0fd3a4400a` remain bound to the original input.
Prepared requirements equal complete existing text plus 'Report the final input
tree.' Withdrawal revokes proposal authority and withdraws only its requirement;
the graph request stays pending until the separate exact dismissal. No Plan/Spec,
completion or Node execution is added. Additional exact original withdrawal POST
replay leaves every canonical record unchanged apart from named scheduler polling.
Replay report SHA256
`4d8e1f77190ad761381832de7db5739852803b1a4cb8680706e91068c7fa5301`.

Final remote supplement-v4 **69/69 PASS**, SHA256
`86eb0562119fcd2df813695fe6595c87a1c8b26eb7194f031498eabd52d64a59`.
Reviewer recomputed both actual manifest/source/Role/native-payload/Git-parent/lease
completion contracts and evidence gates: **20/20 PASS** in
`/tmp/monos-replan-final-audits-review-v1/independent-supplement-v1.json`.

### Retained restart-v7 failure: one provably cancelled-before-launch successor

Original restart-v7-before **25/26 PASS, overall FAIL** remains exact SHA256
`f3c962fb0f9e1fdd7d637f36210a9f88ddff44eaacd9626203dc2cfff2304f0e`.
No service restart occurred. Its sole failing check applied launched-process identity
requirements to Attempt `8e0194f7-e11d-4c8f-9899-6fd288fa7bdb`, which was queued and
cancelled before promotion. Withdrawal had revoked the prepared source; scheduler
created successor `c5e4da04-eb8d-404c-aa2c-59405b94a090` with predecessor
`4d424e65-b499-4db7-820c-e76d3584d786` on the same request. Separate dismissal then
used the actual stopPlanningAttempt QUEUED branch: CANCELLED/owner_stopped, no Host
Stop operation. This is legitimate never-launched history, not failed physical cleanup.

Independent read-only host inspection confirmed exact unit not-found/inactive/dead,
zero MainPID/ControlPID, empty InvocationID/cgroup, and actual lstat absence of root
launch manifest, execution directory, stdout/stderr and expected cgroup. SQLite
starts/requests/events/log_offsets/effects all zero; canonical outbox/Start/effects/
leases/receipts/runtime logs also absent. Original source/dispatch and exact withdraw/
dismiss receipts stay mandatory. Missing generic identity alone is not accepted.

Distinct restart-v8 and `monos_replan_never_started_v1.py` retain the original
failure and allow only this completely proven Attempt through a separate contract.
All launched Attempts retain original settled_checks. Full native equality for the
never-launched record, all original v7 canonical/raw/Git/receipt/software/evidence
bytes, and no service restart before v8 baseline are required. Local testing exposed
the same launched-only assumption inside native_unchanged; v8 corrected that path
under the same exact proof, preserving the failed test invocation. Final four groups
PASS with13 no-launch tamper negatives and3 strict baseline negatives.

Frozen new helper SHA256
`0bcbe73dc8391455d950db3e65cc3612ace64a7790629f4b004cd264b04feb19`;
restart-v8 SHA256
`9f9b80301f45498780affabb1f8075eee9b69148a308204e6ac6cced853ad5bc`.
Owning Runner quality-spec addition matches this exact proof. Full instructions:
`/tmp/monos-replan-native-final-audit-v8.md`. Actual v8 baseline/backend/Runner
observations remain required before final ACCEPT. Product source remains frozen.

### Retained restart-v8 backend failure and exact late-exit explanation

Actual restart-v8-before passed **41/41**, SHA256
`b78926bbb07dc251c93768d1d5beadd8e59bc87504dba0552ad5347289eaa32f`.
Root then restarted the existing backend exactly once; Runner was not restarted.
Original restart-v8-backend passed **53/56, overall FAIL**, retained SHA256
`fef31a91885810fdc96f9e8edc124b760cd072b537f1a0b12ad811a3ba1ebfdd`.
Its failing checks were replan stable_double_snapshot, native_identity_and_journal_unchanged,
and original_v7_native_retained. No repeat backend restart is authorized by the
continuation; the original attempt and service intent remain required evidence.

Exact diagnosis: the first backend records snapshot retained all original 245
runtime/log rows. Its confirmed snapshot contained 253 of each, with every original
full row and digest unchanged. Exactly eight already settled Attempts gained one
runtime sequence2 `exited` event and a contiguous Attempt-order row. Their only
Attempt changes were exit_observed false→true, log_visible_sequence +1, and the
actual activity_at timestamp. Each native object changed only its matching events
projection; ownership, receipts, operations, requests and handoffs remained exact.
The accepted Specification Task's original60 rows, both snapshots, native identity
and Git remained unchanged. No formal completion, Node, Plan, Spec or receipt changed.

The actual Reconcile path calls observeMainExit for retained starts, while normal
Tick only does that for phase=running. These eight starts were already phase=absent.
On this reconnect, their retained main-process exit observations could therefore
be journaled and delivered later. The server event path stores the ordered event
and updates the three observed Attempt fields. Exit telemetry does not itself
grant formal completion or release authority.

Independent read-only SQLite capture (mode=ro, query_only, one transaction) binds
all253 local events and original launches to backend body identities, canonical
digests and exact dispatch/boot. Every event was acknowledged. The eight added
ASCII exit bodies also have raw local byte SHA equal to backend digest. For64
older events, local JSON encoding differs from server canonical encoding; decoded
body including exact output data_base64 is identical, and canonicalized local
digest matches. Raw local JSON bytes and their separate hashes are retained for
strict comparison after the upcoming Runner restart. This encoding distinction
does not permit changed output bytes, row bodies or backend digests.

Independent explanation **76/76 PASS**, retained locally in
`/tmp/monos-replan-final-audits-review-v1/independent-late-exit-v3.json`.
Five local test groups passed, including26 altered-prefix/foreign-dispatch/boot/
extra-field/duplicate-sequence/lost-receipt/Git negatives,12 strict continuation
negatives, and4 service-identity negatives. Initial local v1 and v2 failures remain:
Python3.9 variable timestamp precision and raw-versus-canonical JSON encoding,
respectively. Neither failed draft was executed as a native audit stage.

Final immutable helper `monos_replan_late_exit_v3.py` SHA256
`e3af9186f4f95b54f302f65910b236316310583402df9cf768ba14272201d045`;
`monos-replan-native-restart-v11.py` SHA256
`853da8eccf8b224b8a006973c7a6984e12f47b861d9b685dd48ebf8433930691`.
Only backend-observe and runner entrypoints exist. Backend-observe must prove
stable exact equality with the failed report's confirmed state, unchanged original
evidence, no second backend restart and no Runner restart/reconnect. The following
Runner stage requires its exact backend observation digest and separate restart
intent, preserves all local event bytes/acknowledgements, and permits no additional
telemetry changes. Actual continuation results are still pending; no final ACCEPT.

### Retained v11 time-comparison defect; v13 continuation

Actual restart-v11-backend-observe passed **130/131, overall FAIL**. All76 late-exit
checks, current readiness, stable double snapshots, native identities, raw bytes,
Git and original evidence checks passed. Sole failure:
original_backend_service_boundary_still_proven reused the generic service checker,
which incorrectly compared the retained v8 report's last_seen with the current wall
clock. Its exact original backend boundary had passed when captured; review time
does not invalidate that historical observation. No further service was restarted.
Original report SHA256
`6c927bbe036c39b5afb314a87d5233fa258a88b2cf211042b5604327464a18e7`;
intent SHA256
`21911576d190908c119400415f166294fa330f786301d2c86aee523d6aaa8c7b`.

Distinct final continuation v13 uses a pure historical identity/container/registration
boundary check bound to the original passed check and snapshot digests. The newly
captured current state retains the real15-second freshness requirement. It also
requires v11's exact failed report/intent and unchanged records/native/Git/journal,
not merely retained filenames. Five local test groups pass, with historical-boundary
positives/negatives and original v11 snapshot replay added to the earlier cases.
The intermediate v12 was local only; root executes the final v13 filenames.

`monos_replan_late_exit_v4.py` SHA256
`2dd5cbe1b1249cee3ce84eaf8155b48ba4775d8e88deeec54fdeb6de702a9ce7`;
`monos-replan-native-restart-v13.py` SHA256
`370836f0c6f911eff491ac4d08cea0b36995a4cbf87e25843b4f46876c4740d1`.
Runner quality-spec additions correctly distinguish raw/canonical JSON bytes and
historical/current freshness. Actual v13 backend-observe and the still-unperformed
Runner restart/observation remain required before full-scope ACCEPT.

Actual restart-v13-backend-observe subsequently passed **132/132**, SHA256
`3b6800f35f7c1683e60465ab8186eb0678c6b95697b4057da962f5770da5a769`.
Independent recomputation **118/118 PASS** in
`/tmp/monos-replan-final-audits-review-v1/independent-v13-backend-v1.json`:
all76 exact late-exit checks, both original v8/v11 strict snapshots, complete local
journal raw bytes unchanged since the first independent capture, raw-log integrity,
Git, receipts, software and evidence, original backend boundary, unchanged Runner
and no second backend restart. Root may now perform the one outstanding Runner
restart bound to this exact backend-observe digest; its final result is pending.

## Final full-scope acceptance

Root saved the exact v13 Runner intent bound to backend observation SHA256
`3b6800f35f7c1683e60465ab8186eb0678c6b95697b4057da962f5770da5a769`,
restarted the existing Runner exactly once, and performed the final observation.
No second backend restart, new permanent service or product source change occurred.
Actual restart-v13-runner passed **136/136**, SHA256
`263268a50423c9ca20a158a64c7fe6b798d44a3a5489684cbacbc51f12c9b8d0`.

Reviewer independently recomputed **144/144 PASS** from the downloaded actual
report: exact original v8/v11 and post-backend records/native/Git/evidence, all76
late-exit checks, original and final raw event integrity, every process settlement
or exact never-launched proof, immutable entire local journal bytes and acknowledgements,
unchanged backend/Monolab containers, advanced Runner registration and changed
invocation, exact restart intent/prior digest and all frozen observer dependencies.
Independent report:
`/tmp/monos-replan-final-audits-review-v1/independent-v13-final-v1.json`, SHA256
`92b3607098da38083d3db300ab13eaaeecfa3867bbb9713c8edae852baf40b03`.

Combined with the independently reviewed source/PG/Linux/installation gates and
native Node terminal request, physical quiescence, exact standalone/joint graph
publication, new-Node unfinished/completed private-work inheritance and own
completion, Conversation routing, expired-proposal same-request Retry, issue
dismissal and separate requirement withdrawal/graph dismissal, this satisfies
the leaf's implemented scope. The accepted Specification Task, its Git history,
Monolab identity, legacy pending fixtures, original receipts and failed evidence
remain preserved. No blocking product, observer or spec-drift finding remains.

Coverage and retained limitations:

- Restart proof is idle backend and Runner restart, not a host reboot or live-work
  restart. Independent COMMIT crashes/races and issue-answer are real-PG coverage;
  they are not claimed as installed native scenarios.
- Native recovery includes explicit Owner Project-context clarification before
  same-input Retry. Earlier Conversation Stop required external shell cleanup;
  installation bootstrap separately reset only retained failed-unit metadata.
  These interventions are recorded, not attributed to autonomous runtime recovery.
- Installed Host exited-unit regression exercises actual empty ControlGroup with
  absent kernel/PID and original Stop/replay. Nonempty missing-group routing and
  malformed/forged cases are source-test coverage.
- One Agent issue-reason parenthetical inaccurately calls completed-result work
  'unfinished-checkpoint inheritance'. It remains unchanged historical wording;
  formal identities, source facts, results and issue/dismissal authority are correct.
  No product fix is required for this nonblocking model-text imprecision.

Final verdict: **FULL-SCOPE ACCEPT**. Root may complete the task checklist, scoped
feature commit, archive/journal and proceed to the next execution-UI backlog leaf
under the Owner's existing authorization.
