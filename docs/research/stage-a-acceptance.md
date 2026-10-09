# Research: Stage A acceptance evidence

- Query: What remains after native delivery acceptance, without repeating accepted trials?
- Scope: evidence reconciliation and retained read-only terminal browser views; no new model generation or provider mutation
- Date: 2026-10-09
- Status: **Integrated acceptance remains open.** The native delivery leaf is complete; this report does not declare Stage A or V1 complete.

## Findings

The [Module 09 matrix](../09-first-executable-slice.md#stage-a-acceptance-gate)
permits fault injection for exact crash windows together with real-process
CLI/tool/isolation evidence. Historical native trials and real PostgreSQL/process
tests can therefore be combined, provided their revisions and limits remain
explicit. An unchecked old roadmap box is not evidence of missing implementation.
The old [integration PRD](../../.trellis/tasks/09-28-a-integration-acceptance/prd.md)
and Stage A parent still contain planning-era descriptions; no lifecycle or
checklist changes are made here.

**Mapped** below means the cited accepted report supplies evidence for the stated
boundary at its own revision. It does not mean the whole case was repeated on
the latest build. **Partial** identifies an exact observation or evidence link
not established by this bounded audit; it is not automatically a product defect
or a request for a new native trial. Test files cited by the original locator audit were read, not executed. The
subsequent [focused gap checks][gap-checks] record their own executed tests and
updated input hashes.

### Revision and environment boundaries

| Evidence set | Binding and limit |
| --- | --- |
| [Boundary probe][probe] and [Runtime integration][runtime] | Accepted Linux/OpenCode 1.18.30 evidence, including actual CLI/systemd/account boundaries. Probe source `5b940b049d4591b780b191e8f1de29777149b0d9`; controlled drivers prove compatibility, not autonomous semantic quality. Reboot required manually starting previously disabled Runner units. |
| [Task execution integration][execution] | Accepted ordinary Owner-originated native chain at final source `04c0380`, with disclosed Retry and documentation correction, exact Git/result review and populated desktop/mobile/reload evidence. Its exit/continuity table explicitly reuses revision-bound Node, Conversation, Spec and Replan trials. |
| [Owner delivery][delivery] and [Review correction][correction] | Accepted exact-command, PG/process, provider and browser evidence. Their final `integration-inputs.json` manifests bind inputs. Synthetic provider/physical facts remain synthetic; their then-pending native semantic gate is supplied by the later native report. |
| [Optional transport][transport] | Product `4a48cdc7f7eb78f201828733307b030c3de4448a`; 55 affected PG cases, nine browser flows and scoped Go/Linux checks, followed by installed HTTP/App prerequisites. Its initial installation reported OpenCode 1.18.30, not the later v2 Runtime. |
| [Native delivery][native] | Report committed as `56cb426`: OpenCode 2.0.20 with explicitly authorized DeepSeek; recorded backend `acff7663209949929c11d7543eb6453e19cee6ea`, Runner `e2cbca97d529692c61f18aa60a6c7f45981d2592`, incarnation 27. Same Node/PR correction, independent eight-test result, exact lost Accept response recovery, browser-closed merge and separate Cancel are complete. These are recorded installation facts, not a fresh host assertion. |
| Subsequent bounded Runner changes | `cd24e94` removes stderr-text inference of permission waiting; `afd33bc` settles version-probe inherited process groups even after successful exit. [Multica application report][multica] records local Go 1.27.1 race/vet and real probe-child regression evidence. Neither commit supplies a new Linux deployment, whole-Attempt/cgroup trial or universal interactive-wait support. |
| Free-model startup continuation | `a93f300` passed the [Linux build and native catalog preflight](evidence/opencode-v2-free-catalog-build-v1/README.md), followed by [Runner installation at incarnation 28](evidence/opencode-v2-free-catalog-install-v1/README.md) and a [formal LongCat Discussion reply](evidence/opencode-v2-free-reply-v1/README.md). The global model policy is now the free LongCat target with no fallback; one new Attempt succeeded and released, while the original two Tasks remained terminal. Installation evidence explicitly limits historical full-row preservation claims. |

The free-only v2 cold-catalog and formal-reply continuation is now recorded
separately above. The historical native delivery report still claims neither a
policy switch nor free-model delivery. Its paid-model execution is not relabelled
as free-model acceptance. The new reply does not close the observation gaps by itself. The subsequent
[focused gap checks][gap-checks] supply A25, C02, C03 and E01 at their explicit
PostgreSQL/process/fake-Runner boundaries; A06 and A30 remain partial.

### Main matrix: capture, execution and recovery

IDs follow the 34 Module 09 exercise rows in order.

| Case | Mapped evidence and remaining limit |
| --- | --- |
| A01 Passive capture | **Mapped:** [Capture][capture] and [Execution][execution] retain zero AI work before discussion/Start. |
| A02 Two messages while Planner is busy | **Mapped:** [Capture][capture] ordered Todo turns; [Conversation][conversation] actual ordered pre-Start Task replies. |
| A03 Failed first Todo input with a waiting second | **Mapped:** [Capture][capture] same-source Retry, Stop/Withdraw, preserved history and next-source progression. |
| A04 Withdrawal versus reply COMMIT/restart | **Mapped:** [Capture][capture] real PG rollback/independent-process before/after-COMMIT failures, native withdrawal and persisted idle restart. Exact races are injected, not all native. |
| A05 Two clients confirm one preview | **Mapped:** [Capture][capture] exact confirmation/creation identity and browser lost-response/concurrent-client cases. |
| A06 Browser close/reopen during Node execution | **Partial:** [Runtime][runtime] retains live execution/log identity across service reconnect; [Execution][execution] verifies final browser navigation/reload and persisted results. This audit has not bound a retained browser-close/reopen observation specifically inside a live Node interval. [Native][native] browser closure occurs during accepted delivery, not Node coding. |
| A07 Backend death after completion intent/Git integration | **Mapped:** [Probe][probe] request/handoff recovery plus [Node][node] independent-process COMMIT/terminal ordering, Git finalization and preserved operations. Exact crash windows use injected failures; native Stop/recovery supplies the physical boundary. |
| A08 Stop with background children | **Mapped:** [Probe][probe] and [Node][node] real setsid/double-fork writers, trusted Stop, preserved private work and release before successors. Version-probe group cleanup is a separate, narrower guarantee. |
| A09 Runtime exits without `complete_node` | **Mapped:** [Runtime][runtime], [Execution][execution] and [Native][native] retain factual `missing_formal_outcome` failures and released processes; no false completion. |
| A10 Real Agent invokes bundled `monos` | **Mapped:** [Probe][probe] real long-payload/scoped command and recovery evidence; [Execution][execution] and [Native][native] actual semantic Tool Protocol use without supplied implementation drivers. |
| A11 Two same-account Attempts and forged attribution | **Mapped:** [Probe][probe] actual concurrent UID-1000 executions, forged hints/out-of-cgroup rejection; PID reuse/ambiguity are injected checks. |
| A12 Lost CLI response plus changed input file | **Mapped:** [Probe][probe] retained original envelopes, same-ID content conflict and immutable Retry, without a fresh command ID. |
| A13 Crash before/after send/admission | **Mapped:** [Probe][probe] journal-write failure prevents sending; admitted receipts recover, revoked work is not replayed. These are controlled crash/fault tests, not disk-exhaustion claims. |
| A14 Completion stops caller; old credential expires | **Mapped:** [Probe][probe] fresh stopped handoffs and scoped expired-grant recovery; no renewed Agent mutation authority. |
| A15 Planner CLI under read-only repository access | **Mapped at the recorded Runtime profile:** [Probe][probe] native 160,000-character submission, socket/HTTPS, scratch, and snapshot write/chmod/rename denial. Later [Execution][execution] retains Planner source/context and no writable workspace. The old v1 smoke is not a new v2 long-payload/DAC trial. |
| A20 Remove opaque session before Retry | **Mapped for the observable fresh-context contract:** [Execution][execution] binds actual same-Node/activation Retry to a new source, independently recomputed context/prompt and successful native completion. [Planning tests][planning-tests] retain multiple exact answers in a fresh prompt and exclude other Task/Todo context; [Node tests][node-tests] preserve activation, carry the exact recovery answer and prevent overlap. The supported fresh-run path does not require a prior Runtime session. A literal deletion setup was not performed/located and is not claimed. See the exact checkpoint below. |
| A25 Progress question while Node runs | **Mapped:** [Focused gap checks][gap-checks] exercise a started Node and an overlapping progress-only Conversation reply in real PostgreSQL. Exact observation provenance is retained; Node/source/Attempt/Start, control, Spec/Plan and mutation authority are unchanged, and the original credential then completes the same Node. This is canonical continuity with normalized fake Runner events, not a new native liveness trial. |
| A26 Change requirements during execution, then restart | **Mapped:** [Spec review][spec] native exact proposal/publication, physical old-writer settlement, retained same activation/workspace and fresh execution; backend/Runner restart persistence. [Replan review][replan] supplies confirmed replacement-Node lineage. Those restart trials are idle after settlement, not live-change restart claims. |
| A27 Input while Planner busy or Node completes | **Mapped:** [Conversation][conversation] ordered native input plus real PG guidance/completion orderings; [Delivery][delivery] and [Correction][correction] accepted cutoff and reply-only/reconsidered input guards. |
| A29 Chat before Start, stopped or terminal | **Mapped:** [Conversation][conversation] native pre-Start replies, stopped conversation without implicit resume and terminal Stop/Retry/Withdraw followed by one formal reply. [Native][native] adds accepted late conversation. |
| A30 Further implementation requested in terminal Task | **Partial:** [conversation lifecycle tests][conversation-lifecycle-tests]:86 actually Cancels a Task, submits `Please adjust the result`, rejects guidance, commits a reply and preserves Task/Node/outbox facts. [Conversation][conversation] independently verifies a native terminal reply with no execution reopening. The semantic reply explaining return to Todo, followed by an independent no-inherited-context Task, remains unlocated. |
| A31 Local hard capture limit | **Mapped with a distinction:** [Node][node] accepted Runner/PG hard-recovery checks and native `invalid_finalization` correction retain recovery data and authority. The native induced defect is broken ancestry, not actual disk exhaustion; do not conflate it with a native storage-capacity trial. |

### Main matrix: review and delivery

| Case | Mapped evidence and remaining limit |
| --- | --- |
| A16 Lost PR-create/merge response | **Mapped:** [Uncertain effects][uncertain] supplies PR-create/reconciliation primitives; [Delivery][delivery] supplies worker restart, withheld merge success and controlled actual PR 5 read-only recovery with no second successful PUT. PR 6 need not repeat that fault. |
| A17 Request Changes after REVIEW | **Mapped:** [Correction][correction] source-bound Rework without unnecessary Replan; [Native][native] same Task/Node/PR, failed activation 2 retained and effective activation 3 independently verified. |
| A18 PR head changes after acceptance | **Mapped:** [Delivery][delivery] exact-head checks and actual stale-head 409 on controlled PR 5; changed results cannot inherit old acceptance. |
| A19 Provider unavailable or required checks fail | **Mapped:** [Delivery][delivery] readiness, complete collections, producer identity and failed/unknown/retry branches; [Native][native] actual required-status waiting and later successful finality. |
| A21 One-Node Replan request and Dismiss | **Mapped:** [Replan review][replan] native Node/Conversation Replan, exact publication, expiry Retry and explicit exits; PG/process tests cover publication/Dismiss and terminal races. |
| A22 Dismiss Replan from review feedback | **Mapped:** [Correction][correction] exact immutable successor, feedback-preserving routing, genuine later answer and disabled old acceptance; this branch is PG/browser evidence, not a new native Dismiss trial. |
| A23 Sensitive private history removed before delivery | **Mapped:** [Candidate][candidate] controlled exact-tree export and real Git range/final-tree scanning; [Native][native] exact final public tree, controlled public parents and same-PR correction. Actual deleted-sensitive-content coverage belongs to candidate tests, not the ordinary native code request. |
| A24 Scope-changing review feedback | **Mapped:** [Correction][correction] genuine prepared requirement adoption/Owner publication, retained Node lineage and fresh approval; [Spec review][spec] native sufficient-graph change. Do not claim the native PR 6 wording correction was a scope-changing requirement. |
| A28 Stale proposal/input/change versus Accept | **Mapped:** [Delivery][delivery] both observed PG lock winners and before/after-COMMIT SIGKILL; [Correction][correction], [Spec review][spec] and [Replan review][replan] exact basis, expiry and invalidated approval guards. |
| A32 Ignored tracked/oversized/credential findings | **Mapped:** [Candidate][candidate] complete actual publication scan, real Git/OS checks, bounded findings, hard-limit/permission refusal and inspected browser states. It does not silently include ignored untracked private files. |
| A33 CLI asks for approval | **N/A for ordinary permission waiting in the fixed OpenCode 2.0.20 `run --standalone --auto --format json` profile.** [Installed/upstream audit][approval] shows internal automatic replies; the non-auto stderr warning says auto-rejecting. Generic login/global forms and their Owner attention projection are **unverified/unsupported**, not passed. |
| A34 Cancel in REVIEW | **Mapped:** [Native][native] separate Task B CANCELLED, PR 7 closed unmerged, branch/local result retained and no held execution/effect ownership. [Delivery][delivery]/[Correction][correction] cover unknown-effect and late-finality guards. |

### Conversation closure matrix

IDs follow Module 09's nine closure bullets; none is replaced by a blanket
"conversation passed" claim.

| Case | Evidence and limit |
| --- | --- |
| C01 Joint replacement Plan/Spec, new Node, preserved workspace | **Mapped:** [Replan review][replan] exact standalone/joint publication, unfinished/completed private-work inheritance and new Node's own completion. |
| C02 Prepared proposal then crash before canonical reply | **Mapped:** [Focused gap checks][gap-checks] prepare a real draft through Tool Protocol admission, then kill an independent backend process immediately before/after proposal-reply COMMIT. Before COMMIT the retained draft is unconfirmable; Owner Stop and trusted fixture settlement permit same-input Retry with a fresh source and proposal. Both branches end with exactly one canonical reply, attachment and eligible proposal; receipt replay cannot duplicate them. Process death is real; Runner absence is a trusted test fixture. |
| C03 Progress during confirmation/settlement without holding publication lock | **Mapped:** [Spec input tests][spec-input-tests] retain the confirmation branch. [Focused gap checks][gap-checks] add a settling change with an unreleased writer, hold its exact publication-slot row lock, observe another PostgreSQL connection blocked on that row, and complete a progress reply while the lock remains held. Reply provenance is exact; change/slot/Spec/Plan/authorization remain intact. Only original Stop settlement enables one publication. This does not claim a native writer or model run. |
| C04 Withdraw admitted change after writers stop | **Mapped:** [Spec tests][spec-tests] withdrawal retains old effective Spec and fresh eligible work; Owner Stop remains explicit. [Replan review][replan] independently withdraws requirements without dismissing the graph request. [Correction][correction] preserves revoked acceptance rather than resurrecting it. |
| C05 Guidance immediately before/after completion | **Mapped:** [Conversation][conversation] accepted real PG/Runner ordering and native handled assignments; [conversation tests][conversation-tests] retain frozen manifest and one follow-up activation. Delivered-but-unhandled is not completion evidence. |
| C06 Withdraw failed input without Planner availability | **Mapped:** [Capture][capture] and [Conversation][conversation] Owner-only withdrawal, ordered advancement and settled old execution without model availability. |
| C07 Later input before push, during CI or after merge dispatch | **Mapped as composed coverage:** [Delivery][delivery] accepted preparation/cutoff and reply-only worker/browser cases; [Correction][correction] preserves original input attribution; [Native][native] actual late reply and frozen batch. Not every timing position has a separate native trial. |
| C08 Planner unavailable, backend restart or first push fails | **Mapped:** [Delivery][delivery] preparation Retry/original-operation adoption, worker restart and cutoff isolation. [Native][native] final nonessential chat fails `missing_formal_outcome` without blocking merge. The failure is not relabelled as a successful reply or attributed to billing. |
| C09 Explicit pre-finalization revocation and input restoration | **Mapped:** [Correction][correction] real effects/lock guards and replied/failed/pending input preservation; [Native][native] exact accepted-batch revocation and native reconsider-input, without duplicate replies. |

### Expansion guards required in Stage A

| Guard | Evidence and limit |
| --- | --- |
| E01 Cardinalities, logical Runtime selection, two fake Runners/distinct roots, locality and stale dispatch | **Mapped:** [Focused gap checks][gap-checks] combine two child fake Runners with distinct real filesystem roots and authenticated backend WebSockets. Logical Auto, ambiguous placement refusal, explicit B selection, pinned Task locality, cross-Runner authorization denial and a revoked held Start all use the real scheduling/authorization paths. Markers bind process/root/Runner/Task/Attempt/dispatch and appear only after authorization. This proves the requested fixture control/placement boundary, not native permissions or workspace transfer. |
| E02 Second backend cannot double-claim/oversubscribe or own one effect twice | **Mapped:** [Claims][claims] separate Node processes/PG sessions, four workers/capacity two and observed locks; [Dispatch][dispatch] one durable Start around COMMIT death; [Delivery][delivery] shared effect-claim exclusion and [Correction][correction] original-effect ordering. |
| E03 Duplicate/reordered normalized transport events | **Mapped:** [Dispatch][dispatch] late/duplicate event behavior, [Probe][probe] duplicate/lost-ack/versioned channel recovery and [Runtime][runtime] durable ordered logs/reconnect. These do not establish multi-Runner failover. |

### Focused locator follow-up

The A20 native checkpoint is [Execution][execution]'s `retry-launched` snapshot, SHA-256
`813ef25ba8d6cf8fe90f778018d40f3f94347699cdc7acbd6f8865b838c74cc2`.
Owner request `009b1bb2-79aa-44fc-80b7-ddab713fdcf9` creates source
`05b5049a-41ea-46b9-bdcc-5a8a03078e23` and Attempt
`399596a8-3c15-4591-b140-31f5aa98e9d7` for the same Node/activation/Spec/Plan.
The independent reviewer recomputed context/prompt/receipt digests and then
verified completion; this is stronger evidence of usable formal-context recovery
than merely finding a test with “fresh context” in its title. The disclosed Owner
Role clarification remains part of the trial. No opaque-session deletion is added
to its historical description.

For A25/A30/C02, the accepted [Conversation][conversation] source archive contains
293 files with SHA-256
`12d6b6bcc223b4e802db2dd56739da79dd68c00c498d50ea5f9d0780ab04b72f`;
its reported Linux PG run passed 254 cases including lifecycle/process suites.
The native terminal reply checkpoint in [independent review][conversation-review]
retains original input `d474a359-a27c-4382-8d6c-e5932b142a86` and fresh Attempt
`971c4dd3-8ec6-453f-86a2-84a5a90c3006`; it does not document the further-implementation
handoff requested by A30. At the original locator audit, the process test last changed in
`609e3925f57aa881448d9287453889e87ddcb28b`; its then-recorded SHA-256 was
`493262062fdb67aa85bdee067c472400e926c3df39316aaf2da33286afd48d84`.

For C03, at the original locator audit the specification input test last changed in
`f4114bff30c1f3c027f45f01f3461b86af787ea3`; its then-recorded SHA-256 was
`4f19b97f7c61d0bc1b2fafcc795a8083a0bb02e574411cb1fa57dcd036458417`.
[Spec review][spec] binds the accepted installed v2 archive to SHA-256
`996211bfa1acf3eb5eaeef5c9a7d7a5994c13dab0ad7350e94d470ba1d3293d2` and explicitly
reuses the unchanged non-Runner inputs from its 292-case PG result. This preserves
the confirmation-branch evidence. The later [gap checks][gap-checks] bind
updated test hashes and the new settling-branch assertions separately.

For E01, [Scheduling][scheduling] records 81 PG cases including the selected-path
guards; [Dispatch][dispatch] records 49 including locality. Current scheduling
test SHA-256 is `4ca2d53c783599816c942b1c9bed315547987b5f4145a20c0e148e3148ad5660`;
its last change, `74fc8a8993bfe7bab8c21367485b47241b651e64`, only adds a separate
explicit-DeepSeek selection test, leaving the located Auto guard bodies unchanged.
Current dispatch test SHA-256 is
`c5ff02e4859f660ae85c7ac7f24b4c8fd9d8588b74804e86db5150940aa3422e`, last changed in
`97cf6a94e04fc4dcd6efcf6cb62658fe130bb22a`. Current file hashes identify the inspected
locators; they are not new test results or an assertion that every old report
tested today's complete file.

## Caveats / Not Found

### Current terminal visual provenance recorded

[Visual migration][migration] accepted 41 states/164 retained PNGs and 50 distinct
browser cases across scoped runs; [Execution][execution] accepted installed
Todo→Task result/reload evidence. [Delivery][delivery] and [Correction][correction]
retain inspected desktop/mobile review images at their own recorded builds.
[Native][native] inspected 1440×1000 and 390×844 waiting/recovery views inline but
explicitly could not save screenshot files. [Transport][transport] records the
same limitation for installed login.

The [frontend quality contract](../../.trellis/spec/frontend/quality-guidelines.md#visual-acceptance)
requires retained, inspected images tied to build/source, route and data state,
and coherent integrated Todo→Task→Review presentation. The new
[installed terminal capture](evidence/2026-10-09-stage-a-visual/README.md)
retains inspected header and delivery-section images at both required sizes,
with actual Task/control states and served asset hashes independently matched
inside the installed container. Web/protocol source is unchanged between that
server's `acff766` and local `afd33bc`. Completed and cancelled views have no
horizontal overflow, false current acceptance or lost retained result.
This closes image retention for current terminal views; earlier accepted layouts
retain their own reports. It does not recreate historical waiting/recovery views
or supply A06's live-Node browser observation.

The [local inspection record](evidence/2026-10-09-stage-a-visual/inspection.json)
binds the preserved capture manifests and eight selected images. A local
documentation check found all 34 main cases, nine closure cases and three
expansion guards exactly once, resolved the report and visual README's local
links, and matched the four focused test-locator hashes above. No test suite,
browser session or native trial was rerun for that check.

### Remaining decisions and smallest next work

1. Resolve the remaining observation/evidence portions of **A06 and A30**. A20 now maps the observable fresh-context contract without
   pretending a literal deletion trial occurred. The remaining portions are
   incomplete mappings, not demonstrated implementation defects.
   First use accepted reports and their retained tests/checkpoints; add a bounded
   check only when a required behavior actually lacks valid evidence. Do not
   repeat the full matrix or all historical native races.
2. Current terminal visual provenance and the completed free-only cold-start
   installation/reply are recorded above. The [focused gap checks][gap-checks]
   change tests and evidence only; the installed service sources remain as recorded.
3. Keep A33's distinction explicit: the supported automatic-permission profile
   has no ordinary Owner approval wait; generic login/global forms have no verified
   waiting signal or Owner projection. Do not infer a wait from silence/raw text,
   declare universal support, or silently erase the architectural contract. Any
   future support requires an objective adapter signal and scoped validation.

No new product implementation is justified solely by stale parent checkboxes.
Second CLI/fallback, multi-Node/parallel worktrees, multi-repository/plain-Git
delivery and the complete [V1 release gate](../09-first-executable-slice.md#v1-single-host-release-gate)
remain separate scope. Historical controlled reboot is not automatic boot readiness.

This report reused earlier research, repository reports and focused test locators.
The supplementary browser capture used authenticated reads of the existing
terminal Tasks, with successful logout and closed temporary forwarding; its build
inspection read installed asset hashes. No new model call, business transition,
provider mutation, task lifecycle or journal change was made by that capture. External
source conclusions are attributed to [the OpenCode audit][approval] and
[the pinned Multica research][multica], not a new external lookup.

## Evidence references

[probe]: ../../.trellis/tasks/archive/2026-09/09-28-stage-a-boundary-probe/research/acceptance-status.md
[runtime]: ../../.trellis/tasks/archive/2026-09/09-29-a-runtime-integration-acceptance/verification.md
[capture]: ../../.trellis/tasks/archive/2026-09/09-29-a-capture-discussion-acceptance/verification.md
[node]: ../../.trellis/tasks/archive/2026-09/09-30-a-node-execution/verification.md
[conversation]: ../../.trellis/tasks/archive/2026-09/09-30-a-task-conversation/verification.md
[conversation-review]: ../../.trellis/tasks/archive/2026-09/09-30-a-task-conversation/research/acceptance-review.md
[spec]: ../../.trellis/tasks/archive/2026-10/09-30-a-specification-changes/research/acceptance-review.md
[replan]: ../../.trellis/tasks/archive/2026-10/09-30-a-single-node-replan/research/acceptance-review.md
[execution]: ../../.trellis/tasks/archive/2026-10/09-30-a-task-execution-acceptance/research/acceptance-review.md
[candidate]: ../../.trellis/tasks/archive/2026-10/10-03-a-publication-candidate/verification.md
[delivery]: ../../.trellis/tasks/archive/2026-10/10-03-a-owner-delivery/research/integration-verification.md
[correction]: ../../.trellis/tasks/archive/2026-10/10-03-a-review-correction/research/integration-verification.md
[transport]: ../../.trellis/tasks/10-03-a-delivery-acceptance/research/optional-transport-verification.md
[native]: ../../.trellis/tasks/10-03-a-delivery-acceptance/research/native-http-acceptance.md
[migration]: ../../.trellis/tasks/archive/2026-10/10-02-a-existing-screen-visual-migration/verification.md
[uncertain]: ../../.trellis/tasks/archive/2026-09/09-28-github-uncertain-effects/research/verification.md
[claims]: ../../.trellis/tasks/archive/2026-09/09-28-pg-claim-capacity/research/verification.md
[dispatch]: ../../.trellis/tasks/archive/2026-09/09-28-durable-dispatch-events/research/verification.md
[scheduling]: ../../.trellis/tasks/archive/2026-09/09-29-a-runtime-target-scheduling/verification.md
[node-tests]: ../../apps/server/test/postgres-node-execution.test.ts
[planning-tests]: ../../apps/server/test/postgres-task-planning.test.ts
[scheduling-tests]: ../../apps/server/test/postgres-runtime-scheduling.test.ts
[dispatch-tests]: ../../apps/server/test/postgres-dispatch.test.ts
[conversation-tests]: ../../apps/server/test/postgres-task-conversation.test.ts
[conversation-lifecycle-tests]: ../../apps/server/test/postgres-task-conversation-lifecycle.test.ts
[conversation-process-tests]: ../../apps/server/test/postgres-task-conversation-process.test.ts
[spec-tests]: ../../apps/server/test/postgres-task-specification.test.ts
[spec-input-tests]: ../../apps/server/test/postgres-task-specification-inputs.test.ts
[approval]: opencode-v2-noninteractive-approval.md
[multica]: multica-agent-adapters.md

[gap-checks]: evidence/stage-a-gap-checks-v1/README.md
