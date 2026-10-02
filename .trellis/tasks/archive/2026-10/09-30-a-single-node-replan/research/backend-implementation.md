# Replan backend implementation handoff

Status: SOURCE-READY; Root froze product source and started Linux/full-DB gates. No further product edits authorized within this frozen candidate.

## Changed ownership

Server Replan modules own terminal Node/Conversation request, scheduling freeze with
exact live Node exception, dedicated quiescent Planner source/outcome, immutable
proposals and joint requirements, exact Owner confirmation/publication, issue/retry/
dismissal and bounded recovery reads. Node/Spec/workspace/scheduling integration
preserves original evidence, independent holds and historical workspace provenance.
Additive migration0021, migration registration, domain allowlists, shared protocol
schemas/generated TS/Go/OpenAPI, and DB test registration are included. Migration0020
and all earlier migrations remain unchanged.

Latest self-audit fixes:
- Forward and validate read cursors; always expose current_request beyond history pages.
- Expose joint requirement replan_source_id; register actual Replan OpenAPI paths.
- Completed carry with holds gets actionable blockers; exact Continue/Retry restores
  REVIEW without rerunning or altering completion/activation. Same activation repeated
  publication avoids duplicating an existing unresolved hold.
- Preserve inherited holds plus any new independent current blocker.
- Use checkpoint.operation_id for corrected-completion workspace settlement proof.
- Require explicit completed cross-Node transfer and prohibit repository-free
  completion bypass of an unconsumed checkpoint transfer.
- Retain unconsumed transfer across later sufficient Spec applicability on same Plan.
- Route Replan capture_failed through dedicated failure/Stop; preserve control version.
- Persist source preparation impact failures so one Task cannot prevent later polling.
- RequirementProposal backend type includes strict sufficient/joint runtime branches.

## Executed evidence

Earlier current-leaf main Replan6 + Specification10:16/16 passed (219.80s).
Controls initial4/4 passed (70.50s); expanded controls6/6 passed (105.72s).
Added capture-failure control case1/1 passed (17.85s).
Queued-Node cancellation/quiescent promotion case1/1 passed (15.55s).
All17 distinct own Replan PG cases have passed (main6 + controls8 + workspace3);
this is a combined coverage count, not one frozen full-suite run.
Backend checkpoint and completed transfer cases2/2 passed (44.15s).
Corrected-completion checkpoint transfer case1/1 passed (26.22s).
Unit/schema suite272/272 passed. Protocol check, lint, typecheck, build, native
server module import and git diff --check passed; later test additions have targeted
checks and final collection pending. These are synthetic PG effect results, not
physical Host proof.

Preserved failed observations: initial live-completion test erased REPLAN_REQUIRED
into REVIEW; fixed node-completion projection and targeted rerun passed. Initial
corrected-transfer test wrongly attempted Retry on already-pending new Node and failed
strict Owner payload validation; removed that false precondition, rerun passed.
Temporary lint inline type-import and union narrowing errors fixed before green checks.
Earlier schema AJV and SQL expression issues are retained in session handoff summary.

## Remaining required gates

Independent reviewer owns SQL negatives and separate-process lock/crash tests.
Runner reports genuine settle_completion checkpoint proof, generated-consumer
compilation and local full race/vet/four binaries passed. Parent owns frozen Linux checks, full DB
entrypoint, real CLI/private Git/restart acceptance, docs/spec updates and commit/archive.
No host mutation, deployment, commit or push performed by backend implementer.

## Follow-up after Root predecessor finding

Source retry now derives predecessor from the immutable same-request chain tail,
independent of the cleared current source pointer. Migration21 enforces same-request
predecessor identity, one root and one successor. Stale successful joint retry test
checks source predecessor, reused requirement obligation, immutable old proposal and
requirement predecessor before exact publication.

Independent negative-test review prompted stricter successful deferral receipt checks
and source snapshot validation against actual Spec/Plan/Node/evidence/guidance/latest
settled workspace/all independent hold facts. Reviewer test files are registered.

First retry PG attempt did not reach fixture creation: ECONNREFUSED on the previously
authorized local DB tunnel. Static lint/typecheck/diff checks pass; awaiting restored
tunnel for this additive change. This infrastructure failure is not a product pass.

## Restored DB and incremental review results

Restored-tunnel stale joint retry:1/1 passed,27.03s. First full own Replan regression:
17/18 passed,351.10s; the one actual failure was an over-strict deferral SQL check
requiring response.task_id although TaskReplanResult intentionally has no such field.
Removed that nonexistent response requirement while retaining command Task scope,
exact request/proposal and committed-response checks.

Transport source_watermark is now consistently0 for dedicated Replan Planner,
enforced by producer, queue and SQL Attempt admission; real input_cutoff remains
unchanged in immutable source/context/proposal. Conversation-origin nonzero-cutoff
regression checks this separation. Runner confirmed context cutoff37 with transport0
accepted, transport37/reconnect substitution rejected; full race/vet passed.

Proposal SQL now binds immutable source Node evidence, workspace snapshot, every
independent hold and complete exact guidance while permitting documented Planner
disposition/target decisions. Exact deferral + nonzero-context cutoff + stale joint
retry targeted regression:3/3 passed,62.26s. Final own18-case regression is running
on unchanged product source.

Independent reviewer first9 SQL/process cases passed87.43s. Suspected Node Retry
bypass was disproved by its actual1/1 regression: existing assertNoReplan rolls back
the whole command; no product change made for that suspicion. Reviewer is expanding
request/prepare/dismiss before/after-COMMIT crash matrix.

## Final backend candidate verification

Unchanged final product source: all18 own Replan PostgreSQL cases passed in one
run (3 files,353.53s):main6 + controls9 + workspace3. This includes final proposal
source-impact SQL and transport watermark fixes. Current lint/typecheck/diff checks
also pass. Unit272, protocol consistency, build and native module import passed in
this verification round; subsequent product changes were the tested watermark/SQL
fixes and passed current type/lint checks.

Backend has no known unresolved implementation failure and is ready to freeze for
parent's complete Linux/full-DB/native gates. Independent reviewer is extending
request/prepare/dismiss before/after-COMMIT checks; await that result before final
full-scope acceptance. Previous failures remain above and are not erased.

## Final inherited-control receipt review

Independent review demonstrated an actual additional SQL gap: a fabricated
unknown-status Owner receipt could set inherited hold.resolved_by. It failed the
new negative test as expected for the bug (21.74s); prior17 independent cases passed.

Migration21 now binds original Stop to exact scope/request/Node activation/source,
control increment and committed/admitted response. Resolution binds exact blocker
source, scope/request/activation, committed response, control increment and actual
fresh Owner-linked source (or carried completed evidence on the same source).
Continue resolves only Owner Stop; Retry resolves other holds. Referenced origin
and resolution Owner receipts are immutable, preventing post-validation edits.
No Runner/Root code or older migration was changed.

Legal Continue and carried-completion Continue targeted positive cases2/2 passed
48.19s. Existing positive now also verifies both accepted Stop/Continue receipts
cannot later be changed to unknown; that targeted run and independent expanded
18-case review/process run are pending. No broad18-case backend rerun was needed
for this narrowly scoped hold-authority migration fix.

Post-validation receipt-tamper assertions passed in the existing legal
OwnerStop/Continue integration case1/1 (29.62s). Current lint/typecheck/diff checks
passed. Product and migration remain unchanged while independent18-case result
is collected; no known backend implementation failure remains.

## Source-ready handoff

Independent final18 review/process cases passed163.73s, including the previously
red unknown-resolution-result regression. Backend18 full regression and last-hold
legal positives2 plus referenced-receipt tamper assertions1 passed as recorded above.
Root acknowledged SOURCE-READY and froze apps/packages/runner/infra/scripts.
No known source defect remains; Linux/full-DB/native acceptance is owned by Root.
Any newly necessary product change must first be reported to Root and invalidate
the frozen candidate explicitly.
