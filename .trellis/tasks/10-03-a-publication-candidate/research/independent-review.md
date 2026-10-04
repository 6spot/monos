# Independent combined review

Active task: `10-03-a-publication-candidate`. Reviewer owns this report only. Product, tests, generated contracts and specs are read-only. Initial scoped dirty state consists of the task's new publication files plus integrations in server, Web, protocol, database and Runner; unrelated AGENTS/Trellis/hooks changes are excluded and preserved.

## Findings (fixed)

No reviewer product fixes. Planning issues P1/P2 are closed in the frozen contract: any scanned credential version matching any verified public-baseline blob is non-eligible, and sensitive paths are redacted before IDs and persistence. Historical known-public-exposure facts remain a separate permanent guard.

### Product findings resolved by owning writers

### F1 — blocked oldest operations starve dispatchable work

- File: `apps/server/src/publication-candidates.ts:103` and `:108`.
- Issue: `pending()` selects the oldest two pending rows before checking `localAdmissionAllowed`. Temporarily blocked Tasks retain these rows without backoff, so later eligible Tasks on the same Runner can remain indefinitely undispatched.
- Requested fix: filter canonical admission before the dispatch limit, or use a bounded scan/backoff that advances blocked rows while preserving operation identity. Add real-PG coverage with two older blocked operations and later eligible operations.
- Disposition: current owner fix adds canonical admission predicates before `LIMIT 16`, rechecks under the Task lock, retains a five-second backoff for racing blockers and sends at most two frames. The real-Planner pause/settlement regression checks later Tasks and unchanged original operation requests. Closed: independently read `publication-postgres-11-final.log` and the later combined `publication-postgres-13-final.log`; current backend input inventory matches every file.

### F2 — legitimate multiple-rule findings cannot settle

- File: `runner/internal/host/publication_scan.go:237`, `:326`, `:336`; `apps/server/src/publication-candidates.ts:140`, `:147`.
- Issue: every finding for one scanned version receives `out.Occurrences`. A tracked ignored credential blob, or a blob matching two credential rules, produces multiple distinct findings with the same `occurrence_ordinal`. Server page assembly rejects globally repeated ordinals, preventing legitimate physical scanner results from settling.
- Requested fix: use a finding-level stable ordinal without changing version coverage counts, and verify actual multi-rule scanning plus server acceptance of the assembled pages.
- Disposition: owner changed ordinal to `len(out.Findings)+1`, keeping version coverage independent. New actual-Git preparation regression checks eight visited versions versus ten distinct findings, four rules in both publication-commit and final-tree scopes, unique IDs/ordinals, byte-safe redaction and identical rescanned pages. Backend regression rejects duplicate ordinals before saving a page and accepts two rules for one version with distinct ordinals. Closed on current source: current focused regression and affected host module/race/vet pass, actual PG combined 13-case log passes, and native Linux-v3 repeats the corrected physical regression successfully. The individual current source hashes match; aggregate-ordering correction is recorded below.

### F3 — direct candidate detail can report obsolete applicability

- File: `apps/server/src/publication-candidate-reads.ts:69–72`.
- Issue: direct `candidate()` omits the Task `FOR SHARE` lock used by `list()`. `publicationRecord()` reads source/Spec/Plan applicability and then awaits additional queries. An ordinary Owner requirement/Plan update can commit during those queries, leaving a response that reports old `current`, `scan_applicable` and `override_allowed` values. Command-side locking rejects stale authority, but the read's applicability labels/actions are incorrect.
- Requested fix: lock the selected Task before direct detail assembly and cover concurrent actual-PG mutation/read ordering.
- Disposition: direct detail now takes the same Task `FOR SHARE` lock as list reads. The new PG regression pauses detail assembly on an actual table lock, observes an ordinary Owner carry command waiting for the Task lock, then verifies the pinned earlier response and the later historical response. Closed: focused two-case and combined 13-case real-PG logs pass and all current backend input hashes match.

## Findings (not fixed)

None. No uncorrected confirmed product defect or unresolved acceptance blocker remains. No product/spec/test edits were made by the reviewer.

## Verification

- Loaded task `check.jsonl`, PRD/design/implementation, frozen contract, planning report and relevant architecture/specs. Followed `agent-collaboration.md` and `trellis-check` scope rules.
- Read complete publication backend migration, policy, candidate creation/dispatch/result assembly, Owner commands and paginated reads. Checked exact source/effective-basis/configuration identities, independent durable non-Attempt operations, staged complete-page validation before settlement, stale-source authority, confirmation/receipt recovery and retained public-exposure guard.
- Read complete Runner preparation, scanner, ignore evaluator, pages, private journal and daemon publication paths, plus control/recovery integrations. Checked original public pin provenance, retained export validation, exact result tree, controlled metadata, construction CAS, frozen construction versus new scan runs, cancellation, partial/incomplete coverage, private evidence and bounded Git subprocesses.
- Read Web publication API and candidate UI plus command-journal integration. Checked canonical digests, scoped paginated reads, historical evidence, exact selected-finding authority, separate prepare/confirm/apply commands, lost-response recovery and session/abort fences.
- Reviewed isolated `research/native-linux-validation.py` before main's execution. It uses a unique private validation root and service-owned native fixture, CGO/module/race/vet gates and execution-user permission-denial checks. It does not install into the production Runner. Any successful output establishes isolated native Linux/service-account behavior with a synthetic public baseline, not production original-remote-open or installed acceptance.
- Initial reported frozen gates: Darwin module/race/vet on 118 inputs (component-ordered aggregate `70379b8bf0e4e8449e21825901f7fccc3174fae6541fb5005444129ed881a50c`); frontend 50 units and 34 browser cases, source aggregate `59f989f0c0558d819ad490e35f06290ecd6fda2dd3d7bbd1cd408abc676c31f2`, assets `8c01cd86ca33e61a57fdeb6af555953f69bee02b9b21f380c2c3e6d149fe8898`. Later affected gates and explicit reuse boundaries below govern final acceptance.
- Independently recomputed the 118-file Go aggregate and matched it before F2 edits. Verified all 60 frontend screenshot/metadata hashes, both actual dist asset hashes and index HTML. Frontend manifest itself hashes to `b493bfb9e4523f3f502a53ce38aa08473ad5ea522f68085a734fcf8b92dd88cf`; its 154 source entries had only the F1 backend change at first audit. Backend 29-file snapshot had only F1 source/test deltas. Those changes require refreshed affected backend evidence, not a claim that the old inventory is current.
- Actually viewed four retained PNGs: clean-known-exposure mobile full page, exact override review desktop full page, historical mobile viewport and incomplete desktop viewport. Their visible guard text, exact evidence, disabled historical/hard actions and wrapping match the contract. Broader 24-viewport visual inspection belongs to the frontend report, not this reviewer's claim.
- Read durable generation-check, shared-fixture 250-pass, wire race, affected-PG 46-pass and combined-browser 34-pass logs. Backend results predate F1/F3, and the Linux job using the pre-F2 scanner is intermediate evidence only. No production/native end-to-end claims are inferred from synthetic WSS peers.
- No duplicate broad tests, generation, ports, host/provider/model actions or product writes by reviewer. Earlier gates become stale for relevant files when F1/F2 fixes change their inputs.
- After fixes, all 29 final backend manifest entries and all 119 Linux-v3 packaging manifest entries match actual current files. Read actual `direct-read-multi-rule-focused.log` (2 passed, 11 deliberately skipped) and `publication-postgres-13-final.log` (13 passed). Unchanged daemon/control/wire whole-module evidence is reused; current affected host gates supersede its old input.
- Aggregate ordering correction: the earlier reviewer/Runner value `da9b580e00cc10477ae37d66600582e9c5a0daf2ce3464a161af8fcde0649dc4` was reproduced using `sorted(pathlib.Path objects)`, which sorts path components. Globally sorting the same 118 repo-relative path strings and hashing identical `<SHA256>  <path>\n` bytes gives `a7ace85a28cfbf39d4f1bcc5552da3f54e591689e18d4765a8dd32382b69c715`. Main identified the discrepancy; reviewer independently recomputed both. The first order difference is `runner/cmd/monos/main.go` versus `runner/cmd/monos-probe-exec/main.go`. Individual inputs are unchanged; the prior aggregate cannot be described as global full-path lexical order. This corrects evidence wording without invalidating the verified source bytes or requiring repeated gates.
- Independently read final Linux-v3 `result.json` and actual logs: all 11 stages exit zero, including full CGO module/race/vet, four binary builds, native service-account publication tests and retained-permission fixture. Every retained stage-log SHA256 equals its recorded original hash; the source manifest hash matches and all 119 packaged inputs match current files. The actual native log includes the new multi-rule regression PASS. Five code-produced export/journal/intent/pages/candidate records have service UID 997, directory mode 0700 or file mode 0600, with execution-account read and write denied; source unchanged and complete are true. These establish isolated native Linux behavior, not installed product or remote-origin admission.
- Reviewed all seven sections of `.trellis/spec/backend/publication-candidates.md` and three layer-index links. Main corrected temporary-ignore repository wording and distinguished missing export (`unavailable`) from retained journal/parent identity mismatch (`reconciliation_required`). The spec accurately captures F1/F2/F3, source/public-provenance/CAS/scan/page/receipt guards, known exposure and native evidence limits.
- Read final task `verification.md`, `research/main-linux-verification.md`, `main-visual-review.md`, final source-ordering audit and main independent native observation. The latter records distinct service/execution UIDs 997/1000, repeats all ten read/write denials and identifies all four built executables as Linux ELF x86-64. Native log contains 19 top-level publication passes; the opt-in fixture initially skips without its explicit environment and then passes in its separate admitted run. The optional skip is not counted as a pass.
- Independently checked `frontend-reuse-delta-v1.json`: all ten unchanged owned inputs and both current server deltas match actual hashes. Original 154-file browser inventory differs only in the two server modules fixed by F1/F3. Asset/DOM/contract evidence can be reused; the old full-server browser aggregate is not relabeled current. Main's report accurately limits default-suite and earlier affected-PG evidence and relies on fresh publication13 for the changed source/test paths.
- New executable spec's local Markdown links resolve. Reviewer report scoped `git diff --check` passes. No need to repeat unchanged broad tests or synthetic browser gates; current Linux whole-module gates, affected actual PG and unchanged Web evidence cover the remaining risks.

## Acceptance

**PASS — bounded leaf acceptance ready.** All three findings are closed, current input/evidence audit passes and the executable contract is synchronized. No remaining blocker before main marks the leaf's acceptance criteria or performs its authorized integration steps.

| Leaf acceptance criterion | Evidence reviewed |
| --- | --- |
| Immutable exact candidate, public parents and private ancestry exclusion | Current Runner factory/CAS/source proof, actual Git crash/replay tests and native Linux run |
| Historical deleted credentials and identity invalidation | Actual all-parent/version/final-tree scanner tests; source/config/run-bound pages and Owner validation |
| Bounded redacted desktop/mobile review | Exact Web API/schema, built SPA 34-case log, retained current assets/screenshots and actual visual inspection |
| Actual PG worker/recovery plus actual Git durable construction | Frozen original 46-case integration plus fresh publication13, Linux full-module/native service fixture |
| Idempotent exact eligible override and atomic denial | Actual authenticated Owner three-step receipts, replay/cancel/stale/mixed-hard PG cases and browser lost-response recovery |
| Repo-free/no-change and both preparation modes remain local | Actual PG formal completion/no-item/mode cases, factory physical tree comparison and separate non-Attempt daemon lane |

This accepts local preparation/review only. No native Runtime/provider/install/publication acceptance is inferred; synthetic public baseline and synthetic WSS scan peers retain their explicitly stated evidence limits. Main owns commit, archive, journal and subsequent task execution.
