# Independent review: local result inspection

## Scope and review state

- Active task: `.trellis/tasks/10-03-a-local-result-review`.
- Reviewer: `/root/execution_acceptance_review`; mid-implementation, read-only product review on 2026-10-03.
- Assignment covers completed protocol/server additions: schema and validation, Frame/request/response contract, `task-result-reads.ts`, `result-content-reads.ts`, `result-read-broker.ts`, and `app.ts`. Runner consumer paths were inspected for boundary interpretation; unfinished Runner/Web/tests are not findings or blockers in this review.
- Only this research file is reviewer-owned. Product/spec/test files remain owned by active implementers. No generation, builds, broad tests, host actions, model/provider requests, commits, or task-state changes were performed.
- Loaded latest `AGENTS.md`, collaboration contract, Trellis check skill, explicit `check.jsonl` context and task PRD/design/implementation/research. Unrelated dirty instruction/workflow/config changes were followed as instructions and excluded from source review.
- Initial scoped status contained modified protocol schema/generated/validation files and server `app.ts`/`task-result-reads.ts`, plus new broker/content reader and task directory. Nothing was reverted.

This is an intermediate review, not the final combined quality gate. Findings below were immediately sent to the owning implementer and parent. Later edits invalidate these exact input observations until rechecked.

The first findings/verification sections preserve the initial inputs. The follow-up below records current fixes and Runner review separately; the earlier “not fixed” headings are historical review status, not a claim that those fixes are still absent.

## Findings (fixed)

None by reviewer. This assignment does not grant product write access.

## Findings (not fixed)

### 1. Ready processing can register a socket after its close handler ran

- File/source: `apps/server/src/app.ts:270–273`, close handler at `:299–304`; broker registration at `apps/server/src/result-read-broker.ts:14–17`.
- Issue: Ready awaits `service.touch(...)`, then unconditionally registers the broker. A close during that await already runs `resultReads.disconnect`. The continuation installs a closed-socket connection afterward. The existing `processing.finally` repeats only the database disconnect, leaving the newly registered broker entry. Unconditional registration can also displace a newer connection and complete its pending reads as offline.
- Minimal fix: recheck `WebSocket.OPEN` after the await before registration; disconnect the broker when the processing chain finishes after close. Reject registration of a superseded incarnation so an old completion cannot replace a newer connection.
- Verification needed: hold Ready's database await, close the socket, release the await and prove no broker registration remains. Repeat with a replacement Ready/new incarnation and prove only the new socket can settle reads. Existing pre-await OPEN checks do not cover this race.
- Status: reported to implementer/root; no independent verification of a fix yet.

### 2. Throwing send leaves a pending slot until timeout

- File/source: `apps/server/src/result-read-broker.ts:30–36`; production send at `apps/server/src/app.ts:233–239`.
- Issue: the Promise executor stores the pending entry and timer before calling `c.send`. If that callback throws, the Promise rejects while the pending slot and timer survive until the deadline. The callback performs validation and websocket sending, both exception-capable boundaries. This bypasses the explicit offline outcome and immediate capacity cleanup.
- Minimal fix: catch send exceptions and call the same `finish(offline)` used for a false send return.
- Verification needed: a throwing transport must return offline and immediately restore all four per-Runner slots, with no delayed timer effects. This is a focused broker failure-path test, not a substitute for WSS integration.
- Status: reported to implementer/root; no fix made by reviewer.

### 3. Character length does not enforce the 64 KiB raw UTF-8 text limit

- File/source: `packages/protocol/schemas/v1/contracts.json:11802` (`ResultReadResponse.text`), `packages/protocol/src/validation.ts:24–25`; direct response acceptance in broker `:42` and content reader `:23`.
- Issue: `maxLength:65536` permits 65,536 CJK characters. The current AJV schema accepted an available diff containing `"界".repeat(65536)`: 196,608 raw UTF-8 bytes and 197,836 encoded reply bytes. It remains below the separate 512 KiB reply limit while exceeding the agreed 64 KiB raw-text limit by three times.
- Minimal fix: enforce actual UTF-8 text byte count on `ResultReadResponse` and responses nested in Frame, in TS and Go. Preserve the encoded response limit separately. Share negative multibyte/escaping fixtures and positive exact-boundary cases.
- Status: reproduced read-only and reported. Main had separately requested the 512 KiB nested/direct boundary fix; this finding adds the raw-text requirement.

### 4. Change/object metadata accepts contradictory or incomplete shapes

- File/source: `packages/protocol/schemas/v1/contracts.json:11749` (`ResultObject`), `:11774` (`ResultChange`).
- Issue: object size is optional for every mode, and change `old`/`new` objects are optional for every status. Current AJV accepted an available changes reply with `{path:"file.txt",status:"A"}` and no new object. It also accepted an available regular-file reply with text but no measured object size. A/D/M/T can consequently omit or contradict the side attribution the UI needs.
- Minimal fix: A requires only new; D requires only old; M/T require both. Require measured size for blob/symlink modes and explicitly define gitlink metadata without pretending a submodule commit is a blob. Preserve strict status/mode content rules.
- Verification needed: shared positive additions/deletions/modifications/type changes, regular/executable/symlink/gitlink cases, and negatives for missing or contradictory sides and sizes.
- Status: reproduced and reported. This extends main's already-requested status/mode-shape work; unfinished generation/tests are not separate defects.

### 5. Invalid Unicode paths pass the Owner request schema

- File/source: `packages/protocol/schemas/v1/contracts.json:11538` (`ResultPath`), `packages/protocol/src/validation.ts`, `src/index.ts:54`; content reader request construction `:15–16`.
- Issue: read-only AJV probes accepted lone high-surrogate `"\ud800"` and embedded lone low-surrogate `"a/\udfff.txt"` file-query paths. The design requires valid Unicode. TS `validate`/`parseFrame` do not call `assertUnicode`; canonical identity hashing validates the identity rather than the requested path. A malformed path can therefore be dispatched before Go's canonical raw decoder rejects it, potentially invalidating the control connection instead of rejecting the Owner query.
- Minimal fix: reject malformed Unicode at query/request boundaries before broker admission, with matching nested wire validation. Retain legitimate supplementary Unicode and unusual literal filenames.
- Verification needed: shared lone-high/lone-low-surrogate negatives and supplementary Unicode positive, plus route assertion that invalid input sends no Runner frame.
- Status: reproduced and sent to implementer; parent notified.

### 6. Generated OpenAPI declares required read queries optional

- File/source: `packages/protocol/scripts/generate.mjs:76`, new route registration at `:85` and generated OpenAPI result-read GET parameters.
- Issue: the shared `get()` generator hardcodes every query parameter to `required:false`. New endpoints therefore describe `identity_digest`, `path` and `side` as optional where their runtime query schema requires them. Generated clients/documentation can build requests that necessarily fail validation.
- Minimal fix: derive each query parameter's required flag from the referenced query definition's `required` array, then regenerate; preserve genuinely optional cursor fields.
- Verification needed: inspect all three generated endpoints for mandatory digest, mandatory file/diff path and file side, with optional changes cursor. No unrelated API redesign is needed.
- Status: reported to implementer; no generated files edited by reviewer.

## Design boundary for parent resolution

The agreed design says a 10-second **total** deadline. Current `result-content-reads.ts` performs initial auth/result resolution, availability query and final auth/result revalidation without a deadline; only `broker.read` starts a 10-second timer. A blocked database query can therefore leave the HTTP read outstanding beyond the documented total. Parent was asked to preserve a remaining-budget/statement-timeout strategy and a held-query test if total includes the complete HTTP operation, as written. No transaction should span Runner I/O. This needs an implementation/contract decision rather than a reviewer silently changing the public limit.

## Positive static observations

- Owner routes inherit session-header validation, use no-store/nosniff, and send only validated mode/query fields plus a backend-derived identity. No backend Runner-path file access was added.
- Selected operation lookup filters the canonical completion query directly, so it is not limited to the first 32 historical results.
- Existing exact completion joins and carry applicability remain separate from immutable original Spec/Plan/result identity. Full descriptor and canonical operation hashes are included; later mutable finalized HEAD is not substituted.
- The content reader authenticates before dispatch and after awaited read, re-resolves the selected identity, and derives current/history from the fresh projection. No transaction spans broker I/O.
- Availability checks include backend connection instance and exact DB incarnation passed to the broker. Broker reply matching includes runner, socket, connection object, incarnation, correlation and canonical full request; Runner-supplied current applicability is rejected.
- Optional Ready capability keeps old Runners unsupported without sending the new frame. Broker concurrency, disconnect/shutdown settling and timeout outcomes are explicit, subject to the identified lifecycle gaps.
- Runner retained-identity code inspected uses original operation/start/successful physical effect and operation manifest digest; it does not demand backend-enriched semantic fields in the raw effect or a still-running historical Attempt.

These are code-path observations, not claims of completed real PG/WSS/physical Git/browser validation.

## Verification

- Scoped `git status --short` and source `rg`/`sed`/`cat`: completed; no mutation to assigned product files.
- Pure read-only Node/AJV compile of current contract with generated-shaped identity: completed successfully. Negative probes unexpectedly **accepted**, confirming findings 3–5. No fixtures, generated output, or build artifacts were written.
- Pure inline Node import of the actual broker, with a throwing transport: four reads **rejected** and a fifth immediately returned **busy**, confirming finding 2's retained capacity. Broker shutdown cleared all private in-memory timers; no external I/O, fixture or artifact write occurred.
- Generator and generated Go source inspection: completed. Empty changes arrays have an explicit custom marshaler; text/current/size use pointers so absent and empty/false/zero remain representable. This inspection does not replace consumer compile/drift checks after generation. Generated query requiredness produced finding 6.
- Scoped source SHA256 at review boundary:

| File | SHA256 |
| --- | --- |
| `apps/server/src/result-read-broker.ts` | `4c3f2f3b0e6872d3b306ca7740afd4202645c4711e9c72652e47ac0e460cd3d7` |
| `apps/server/src/result-content-reads.ts` | `9e0be1d6eccf2b63640e66a9ca7600ff9e95d27e15825020a7d2b1a5ef9e04d4` |
| `apps/server/src/task-result-reads.ts` | `ec21f65c96682ca6ebd6cba14dbda6392fe7679020d92d1ddbb732e74d71d7b7` |
| `apps/server/src/app.ts` | `45899c0851f0c2dae0d6d0c4e8dbe745959586ccab0cbb73c3a76fe68eb33a97` |
| `packages/protocol/schemas/v1/contracts.json` | `4de501728330db7866aa6b6792e1fddfae63ee65417b2ddda6d27eda59166b1f` |
| `packages/protocol/src/validation.ts` | `65e02e4cbb21b5b170fa2ca68898e65a68508065a9310731b406b3efcbdd7945` |
| `packages/protocol/scripts/generate.mjs` | `21fe8871e692ee63e08809b8067a30326f7496795f19d648fa7b3b2ec0a2766a` |

- Generation/lint/typecheck/default tests/Go race-vet/real PG-WSS/browser checks: deliberately skipped during active implementation, as instructed. Required final combined gates remain with parent and implementers.
- Product/spec/test fixes: none. Final spec sync should describe actual final status/mode/limits and connection cancellation contracts after implementation settles, rather than copying intermediate naming or claiming synthetic browser content establishes native Git reads.

## Follow-up: fixes and Runner review

Latest PRD/design and `research/collaboration-handoff.md` were reloaded. The main session resolved timing to a **10-second Runner round-trip budget after initial authorization**, plus the Runner's physical-read budget. This is not a full HTTP SLA; initial/final PG authorization remains mandatory. The earlier deadline question is resolved under the revised contract, without introducing a general database framework.

### Initial six findings: current disposition

1. Ready lifecycle: source now checks OPEN after awaited touch; processing completion repeats broker disconnect; broker registration refuses lower incarnations. Static recheck passed. Delayed database/close integration coverage still belongs to the final server gate; this review did not run a competing integration suite.
2. Throwing send: source now catches and finishes offline. A new actual broker probe performed five throwing reads; all five returned offline instead of exhausting the four slots. Source and focused regression test were inspected.
3. UTF-8 text bound: actual TS validator now rejects the former 196,608-byte available diff; direct and nested Frame validation apply the raw/encoded limits. Go wire validator also enforces raw bytes and nested encoded replies.
4. Change/object shape: actual validator rejects missing added-file new object and available blob size. Updated shared schema and Go wire test cover A/D/M/T side shape and blob versus gitlink size requirements.
5. Unicode paths: actual TS validator rejects both lone-surrogate cases; a supplementary Unicode emoji path succeeds. Go validates raw Unicode before decoding and checks UTF-8 path byte limits.
6. OpenAPI requiredness: generator uses the query schema's required list. Actual generated routes contain required digest for all modes, file/diff path and file side; changes cursor remains optional.

These fixes were made by the product implementer, not reviewer. Generation/default test/type/build evidence remains a separate final gate.

### Additional finding: retained Start scope inconsistency

- Source: `runner/internal/daemon/result_read.go`, original retained-Start predicate around `:48`; `runner/internal/journal/journal.go` Start reader `:124` only unmarshals. The existing `wire.ScopeID` validates dispatch scope consistency.
- Issue found: the retained predicate checked `NodeExecutionSource` against the selected identity without checking dispatch's redundant root Node ID/activation, kind, conflicting Todo/source attribution or required reservations. A corrupt retained Start could therefore pass while contradicting its canonical source.
- Requested minimal fix: reuse `wire.ScopeID(dispatch)` and require the returned Task scope, retaining historical release/boot independence. Add malformed **retained Start** tests, rather than only changed caller identity fields.
- Implementer fixed: current code calls ScopeID and requires `scope == identity.TaskID`; added six retained Start negatives (Todo, Planner kind, root Node, root activation, missing Node source, missing reservations). Backend identity projection also validates stored Dispatch/source attribution and now captures the identity in the same short transaction as its canonical item.
- Reviewer disposition: static fix recheck passed. No product edit made; latest tests have not been independently executed here. The new source/test hashes invalidate the old aggregate test proof until the final current-input Go gate.

### Actual Runner chain and raw Git paths reviewed

- Retained operation/start/successful effect: original complete_node kind, Attempt/dispatch/Node/original Spec/Plan, canonical operation and descriptor hashes, operation manifest digest, writer absence, exact physical workspace/lease/generation/storage/base/finalized commit/tree. The raw effect is correctly kept separate from backend semantic enrichment. Historical release/old boot/later lease do not become rejection conditions.
- Production Host entry reads existing root/service storage identities without creating them. It validates private service ownership, non-writable/non-symlink ancestors, service-private storage copy, HEAD/config/object/ref directories and existing retained refs; borrowed alternate object storage is rejected. No Agent path or current worktree fallback is used.
- Raw Git uses fixed `/usr/bin/git`, explicit bare export path/argv, literal pathspec environment, sanitized environment, disabled replacements/hooks/global/system configuration/lazy fetch/external diff/textconv, and bounded stdout/stderr. The output wrapper now holds a private bytes.Buffer, so io.Copy cannot bypass its limiting Write via promoted ReadFrom. Overflow/cancellation uses CommandContext, cancels and waits through cmd.Run, and returns no raw stderr.
- File reads verify exact tree path and blob OID, measured size and returned byte length. Symlink targets are literal blobs; gitlinks have metadata only. UTF-8/NUL, absent/empty, oversized and text outcomes remain distinct.
- Changes compare original fixed base to exact result, parse NUL delimiters, sort exact paths, disable rename guesses, enforce 8 MiB/8192 full-scan caps and byte/64-record page bounds. Cursor binds canonical identity and position, allowing long-name pages to continue completely. Diffs perform bounded raw reads with no partial patch reported available.
- Read lane uses a separate four-slot channel and asynchronous worker; completion releases its slot. Connection context is cancelled on control disconnect; typed reply retains correlation, and control/client and backend broker both fence incarnation. Existing broker canonical full-request comparison prevents identity/path/mode/side substitution.

No additional concrete defect was established in these inspected paths. This statement remains bounded by active source ownership and final tests pending.

### Narrow fixed-base export question

Main requested a source-backed check whether an orphan/rewritten private HEAD can produce a legal successful completion whose fixed base is absent from the private export. Current sources do **not** establish that case:

- `docs/04-workspace-and-git.md:161` requires completion to descend from the Node start revision; Agents merge instead of rebase. Broken ancestry fails finalization and preserves blocked work.
- `host/finalize.go` uses requireAncestor against the recorded prior finalized revision, then commit-tree with that exact private parent. `workspace_git.go:589` passes metadata.FinalizedCommit; the initial finalized revision is the fixed BaseCommit. Subsequent legal finalized results therefore retain the original base in their ancestry.
- `host/snapshot.go` clone does not promise to copy custom base pins, but the subsequent fetch of the exact original completion ref imports that commit's complete reachable ancestry. The reader independently checks `base^{commit}`. Existing snapshot test explicitly distinguishes clone from exact custom-ref fetch.
- Internal Agent/completion history being separate from public delivery ancestry does not authorize an orphan internal result. An orphan lacking fixed base is rejected before successful completion, so it is not a supported counterexample for this leaf.

No export change or general history-management refactor was requested on this evidence.

### Reused Go evidence and its limits

- Read `research/go-read-verification.md` and the four focused test sources. Verified the actual retained JSONL SHA256 `bcdc51db680d062248df99e58be01104661e6bd466f1d089bac88204638332bb`; parsed events confirm **20 top-level passes, 43 subtest passes, zero fail events**.
- Exact-input audit found host/result_read.go and wire/wire.go already differed from the focused report's source hashes. At that observation their hashes were respectively `0ec117a3eca71cb39041a8a6a6427fedca34da18ebae4b7042c9f90553ed2632` and `5a9eaf2c270b52664a06782bec451947a9e288569ab9f80050d7ed7847c3654a`; the other twelve table entries and retained log matched. Current 102-file lexical aggregate then was `1cafcb849a30269aa9035983085f2b408f1d3539ccb9bef66401e6d2b91ce5e4`, different from the reported `23027eedaad77c4dff62c38239d6b9468aa7b1d7d5e60a09c741ebe3836de01e`.
- Later edits add the Start-scope fix and stronger export/ref/service-copy guards, invalidating that intermediate current aggregate too. Implementer explains deltas as formatting plus trust/scope checks; root acknowledged that final full race/vet must cover stable latest inputs. Old focused evidence establishes its original observed behavior and is not relabelled final current-source proof.
- Actual local tests cover real immutable Git, SQLite retained authority and local authenticated TLS control transport. Existing `workspace_recovery_test.go` also covers dual-copy loss/change/symlink checks with the current test UID. Public fixed-root native root/service account enforcement is reviewed statically here; macOS tests do not establish installed Linux account ownership/systemd/provider/Agent behavior.
- The control test's reply is a busy result from its test handler; daemon lane test checks capacity/mutation-mutex independence, and host tests separately establish raw object behavior. These are distinct assertions, not a claim that one native end-to-end installed read trial was run.
- No unchanged suite was rerun. No build, generation, native host/model/provider action or lifecycle mutation occurred. Final combined acceptance awaits writer handoff and current-input gates.

## Final combined review, 2026-10-03

The earlier findings above retain their original observation/status as historical evidence. This section supersedes their outstanding status. Reloaded the current check manifest, PRD/design/implement, collaboration contract and the new executable `backend/result-content-reads.md` contract. Product, generated sources, tests and specs remained read-only; only this review note was edited. Unrelated dirty instruction/workflow/skill files were preserved.

### Findings (fixed by owners)

- Initial findings 1–6: final source still contains the closed-Ready guard/disconnect reconciliation, incarnation fence, send-throw cleanup, UTF-8 byte and Unicode guards, strict mode/status/object facts and generated required-query flags. Current shared/app/broker evidence has 244 passing tests; delayed Ready and throwing sends have meaningful regressions.
- Retained Start finding 7: both `wire.ScopeID` and `host.ValidateEffectScope` now validate retained original dispatch/operation scope. Eight contradictory retained Start/reservation cases are covered. Backend identity and canonical item are captured within the same short projection transaction.
- Web finding 8: `result-inspector.tsx` renders canonical `result.current`; new response references plus query update times prevent older immutable cached bytes from continually reapplying their old flag. `results.e2e.ts:181` exercises both ordinary metadata polling and a fresh second changes page while an already-opened file remains selected, byte-identical, and receives no duplicate file/diff request. Both cases are included in the six final result browser tests.
- Main's final integration review established that two retained `conversation_*` schemas belonged to initial failed result-fixture setup. `result-read-fixture.ts` now catches failures after acquisition, closes its exact owned fixture and rethrows; the new real-PG test injects an actual setup failure, captures its exact initialized schema, and verifies that namespace is absent afterward. It avoids a global inventory assertion that could race concurrent fixtures. This is an additional test-resource cleanup correction, not a Task/product authorization change. Final actual PG **12/12** and cleanup evidence close the issue.

### Findings (not fixed)

No remaining concrete product or test-resource defect was found in the assigned scope. All eight established product findings and the additional failed-setup cleanup issue are closed; the independent local result-review gate is **PASS**.

The previously sent cursor-validation concern came from stale input and is withdrawn: the current `result-content-reads.ts:12` calls `resultChangeCursor` before broker admission. Its exact-key/version/safe-position/canonical-base64url/SHA validation distinguishes malformed input from a cross-result cursor. Actual earlier probes accepted the valid cursor, rejected malformed/noncanonical input and denied the wrong digest. No spec adjustment is needed.

A narrow Go JSON HTML-escaping question did not establish a production defect. The actual producer measures page and final response bytes using `json.Marshal`, and the control writer uses that same encoding; nested validation cannot admit an oversized actual producer reply. A hypothetical differently encoded peer reply was not treated as a normal physical Runner result or an acceptance blocker. No production codec or export change was requested.

### Final source and evidence audit

- Independently checked the original 31-path product manifest and main's final 40-path combined product/test/generated manifest. Exactly two PG fixture/test paths changed from the original 31 inputs; all **40 current hashes and byte sizes match** `main-source-manifest-final.json`, whose SHA256 is `e6654a23665c26a1f1d533f04621117751e9e3eb41e5e458389714f484bc5816`. Current Go/generated contract inputs match the final race/vet evidence boundary. The old 102-input focused aggregate remains historical and is not reused as final proof.
- Independently hashed all **61 browser source inputs**, **56 recorded artifacts** (44 PNGs, 11 state JSONs and cleanup JSON), and both current built assets. Every hash and recorded artifact byte length matched the final screenshot manifest `c9ff09347891fdcb83787f9e08ea176ea093208fb66b3b1dfaccc0be535454b9`.
- Recomputed the manifest's sorted compact JSON set digests: source `612e2e1d2fb0da9662e884ad57110884ff46df8e52a998da8b5c3305504e1441`; bundle `709c322e2807a6c183d948c430057636f72d95b49d72a8e19396ad1106a4bb4c`. Actual schema hash is the final `53c4e81894eb365cac8868a68e841761cd35a18e10ea73c44e9785a495968e06`. The final fixture-cleanup delta is outside those browser source inputs; no screenshot was relabelled to a different browser candidate.
- Checked all four actual binary files against `runner-binaries-final.json` hashes and independent `file` output: monos, monos-probe-exec, monos-probe-launch and monos-runner are **Mach-O arm64**. This establishes local build artifacts, not a Linux installation.
- Inspected all eleven added shared newline fixtures as decoded code points: six valid literal names contain real LF/CR/U+2028/U+2029; five invalid cases retain traversal, empty or trailing segments. Both TS and Go fixture loaders execute these same records. Current protocol drift, 244-contract and full Go gates were executed after this final schema generation.
- Read the final logs: lint/typecheck/protocol-current; original default **331 passed / 337 intentionally skipped** and PG **11 passed** are superseded for the final two test inputs by main default **331 passed / 338 intentionally skipped** and real PG **12 passed**. Main's final typecheck and scoped ESLint passed after the cleanup mock used the actual ConfigurationCommand validator; the last narrowing affected only the DB-gated skipped test, whose real-PG run was repeated. Focused contracts **244 passed** and full current Go race across all affected packages/vet remain valid unchanged-input evidence. Read main's actual successful build log with the exact matching JS/CSS assets. Final frontend handoff reports API tests **44 passed**, combined browser **30 passed**, then **6 passed** after only the rich fixture size correction. Tests were reused for unchanged input; the frontend peer's bytes/OIDs/Runtime acknowledgements remain explicitly synthetic.
- Reviewed actual immutable Git/SQLite/start/effect/storage/ref paths and the final service-lineage/dual-copy test. The latter uses the local account for its algorithm fixture and separately rejects claiming service-owned root storage is root-owned. Production still requires actual root UID 0 and service UID; this review does not promote same-account macOS tests to native dual-account evidence.
- New executable spec links resolve. Backend/Runner/frontend indexes and Owner-read guidance point to it. Its exact original `refs/monos/result`, auth-before/after, bounded complete scan, current/history, strict error and 10-second round-trip/physical-read descriptions match the actual paths. Timing is explicitly not a complete HTTP SLA.

### Actual visual inspection

Used `view_image` on the final populated desktop/mobile, historical mobile, long-path mobile, offline mobile and deleted-side mobile PNGs. The actual desktop has an adjacent list/code pane; 390px mobile stacks them with reachable controls. Literal script markup/whitespace remains visible text in the contained code region; long path labels wrap; Historical completion preserves the opened text; offline retains exact metadata and a visible retry; deletion explicitly reports absent on the result side. No cropped page-width overflow, missing identity/applicability label or displaced controls was observed. These independent observations supplement the frontend owner's 22 viewport inspections and main's eight actual inspections, rather than claiming all 44 were individually viewed by this reviewer.

### Final cleanup evidence

- Read the retained initial namespace survey and exact ownership facts: both named leftovers had the leaf's `Result project` / `Exact result fixture`. Prefix alone was correctly rejected as proof. Main cleaned only those two proved owned schemas; final survey after the fresh PG gate records `custom_schemas:[]` at `2026-10-03T12:50:05.764Z`. The reviewer issued no DDL.
- Final PG log SHA256 `17fab79a9a24e3654bbb4eac325a276e242fbfa653d168911e1141e86142e0b1`; final default log `3fcc33f503c8645ccd065457bc4f14621432107f693fd06aba20da9cbd840c63`; final cleanup JSON `73e7aa703040651cf7f7ed2e084252e81b3e0a005391c737bb5e8c2c0e40029c`.
- Scoped `git diff --check` across assigned tracked product/spec paths returned exit 0. New test files are additionally covered by actual scoped ESLint/typecheck. Initial typecheck/mock-narrowing and missing DATABASE_URL invocation failures remain retained under their original failed log names; they are not counted as successful gates.

### Verification limits and conclusion

**PASS — the first exact local result-review leaf is ready for main integration.** The final assigned 40-input candidate, eight product fixes, cleanup correction, executable spec and source/build-bound visual evidence have no remaining established blocker. No unchanged broad suite was rerun by this reviewer. No live host/model/provider call, native Linux trial, remote publication, Owner delivery acceptance, commit/archive or Task lifecycle action occurred. Synthetic WSS/PG/browser assertions, actual macOS Git/SQLite tests and inspected built visuals retain their separate boundaries. This leaf does not accept later delivery/publication/native-install work.
