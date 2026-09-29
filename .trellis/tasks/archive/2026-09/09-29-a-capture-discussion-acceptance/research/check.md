# Independent acceptance review

Reviewed product baseline `61f140b`, the current PRD/design/implementation plan,
the parent Capture and Discussion acceptance, the three archived leaf reports,
the Runtime integration report, the retained native result hash index and the
specific database/browser/harness assertions cited below. This review performs
no host actions and does not rerun already-passed product suites.

## Findings and closure

1. **Closed: distinct concurrent Discussion submissions.** The PRD
   requires ordered concurrent messages. The original `postgres-discussion.test.ts`
   raced five replays of one already-committed request, two pumps, duplicate final
   commits and commit versus withdrawal. Its different Owner inputs were submitted
   sequentially, as are `discussion_probe.py`'s native ordered inputs. These prove
   replay, queue and source-order behavior, but not simultaneous first submission
   of two distinct inputs to one Todo. Added one focused real PostgreSQL case with
   two Owner sessions/Discussion instances and distinct request/message IDs;
   assert both retained messages have unique consecutive sequences, processing
   follows database order, each source obtains one reply, and the next promotion
   waits for the previous physical settlement. The new case now does this using
   distinct Owner sessions, connection pools and Discussion instances, observing
   both transactions blocked behind a held Todo row before release. It passed
   against real PostgreSQL without a model call. The spare Runner slot does not
   permit the second source to bypass the first Stop settlement.
2. **Closed: idle restart and final ownership evidence.** Reviewed the final
   `restart-evidence.json` and `backend-restart-reconciliation.json` after the main
   session inspected the private raw snapshots. Backend restarted once in v1;
   explicit v2 resume restarted only Runner once. All final guards pass, original
   failed reports remain preserved, and the current physical/global audit is clean.

## Evidence attribution

| Required boundary | Evidence inspected | Assessment |
| --- | --- | --- |
| Capture/open causes no model work | Todo database exact footprint case; browser request-count/capture/reload case; native captured report checks `pure_capture` and `no_task` | Adequate combined evidence. Browser request counting alone is not a Runtime proof. |
| Assigned and unassigned Discussion | Project move-away/back/Retry attribution and context-edit database cases; unassigned native ordered and preview trials | Adequate with the existing explicit statement that assigned native execution was not run. |
| Ordered concurrent input | Sequential native source watermarks; database duplicate/replay and active-turn successor ordering; new distinct two-client admission regression | Adequate after the new focused database case passed. The new case proves database settlement guards with synthetic Stop facts, not native process absence. |
| Shared slots and queueing | Current database Task/Todo/equal-ID capacity case and heartbeat regression; historical Runtime native queue/reconnect trial | Adequate layered evidence; the historical native trial remains attributed to its original source, not a new current-source live interruption. |
| Atomic reply/cache and no duplicate outcome | Real database receipt-insertion rollback and independent process death around COMMIT; native journal/source/result checks | Adequate. Synthetic Runtime facts in database fixtures do not claim native process behavior. |
| Failed/interrupted Retry and Withdraw | Database missing-formal-outcome/retry-settlement and withdrawal race; native two stopped sleep children followed by withdrawal/later successful input | Adequate. Browser recovery controls use explicit canonical status/command fixtures and prove projection/recovery behavior only. |
| Exact stale/repeated/two-client preview | Current Task Preview database cases; actual two-browser contexts; native parallel confirmation/creation with independent digest and stored provenance checks | Adequate. Lost-response browser routes are intentional transport fault injection. |
| Independent Task/no inherited semantic context | Exact revision equality, one PLANNING Task, no Task Plan/Node/Attempt/Start; source Todo reassigned/archived while original Task Project remains | Adequate. No execution or automatic planning is established or requested. |
| Browser reconnect and canonical Task restoration | Discussion projection reconnect; real persisted preview recovery/direct Task URL/reload/navigation cases | Adequate when each fixture boundary is named. In-memory drafts/request envelopes are not claimed to survive a full browser reload. |
| Current backend/Runner persistence and reconnect | Versioned v1 backend reconciliation and v2 explicit Runner resume | Passed. Actual identities prove one restart of each service; backend identity remains unchanged during resume. This supplements prior live interruption/reboot evidence. |
| No trial process/claim/unresolved operation remains | Final v2 six-Attempt physical audit, both known sleep children and global guards | Passed. All six main process/cgroup checks and both child checks pass; queued/unreleased/writable work, unresolved operations/sources and pending outboxes are zero. |

## Review limits and required final checks

- The archived Task Preview report records the final 151 local, 138 PostgreSQL,
  23 browser, 67 Python and Go checks. Those are reused results, not checks rerun
  by this reviewer in the integration leaf.
- The native index preserves file SHA-256 values and selected outcome/checks.
  Full raw records remain on the private host. New restart evidence must bind to
  the retained source manifest, receipt identities and native trial lineages.
- No new model work is planned, so this leaf has no new model-pricing assertion;
  prior native trials retain their own fresh availability/tool-call/price preflight.
- Restart intent must be durable before service mutation; repeated or uncertain
  runs must retain original evidence and never silently restart again. Require
  global settlement immediately before each restart, service reconnect afterward,
  immutable scoped records and unchanged Start/Attempt footprint.
- The evidence map's earlier invalid archive strings were corrected to explicit
  repository paths.
- Only this leaf and its Capture and Discussion parent may be accepted from these
  results. Task execution, delivery and full Stage A/V1 remain outside the claim.

## Checks performed by this reviewer

Requirement-to-assertion inspection and attribution review; one focused test added
to `apps/server/test/postgres-discussion.test.ts`. No production source changed
and no host commands were run. The isolated test used the existing private DB
wrapper and passed 1/1 (14 unrelated cases skipped, 5.67 seconds total). Focused
ESLint, `pnpm exec tsc --noEmit` and `git diff --check` passed.

The first run passed the behavioral assertions but failed its final audit because
the new test queried `source_message_id` as an Attempt column. The corrected query
reads it from the existing `launch` JSON. This was a test error, not a product
failure. The subsequent focused run passed without changing product code or
relaxing test timeouts. This is one additional result beside the archived 138-case
database baseline; it is not a new full 139-case run.

## Harness review and fixes

Reviewed `capture_discussion_acceptance.py` and its tests after the implementer
handoff. Existing exclusive claims, fsynced checkpoints/intents, exact-once restart
calls, service identity/reconnect assertions and failure retention meet the scoped
idle-restart design. Read-only mode never issues a service command. A failed or
uncertain run never retries automatically, and existing evidence refuses overwrite.

The first read-only host preflight (run by the main session) found delayed output
and exit records after five old snapshots. The failed preflight is retained. The
reviewed correction preserves every historical event summary by stream/sequence
and allows only contiguous `output`/`exited` appends. It rejects changes, deletions,
duplicate sequence identities, gaps, starts, attention/failure facts and unknown
kinds. The later actual backend restart exposed one legitimate delayed exit; the
corrected current-record comparison is documented below.

The sixth Attempt lacked an old native snapshot. Added exact source/watermark/
reply/structured-preview binding from every historical successful reply to one
current native handoff, verified journal digest and committed same-scope receipt.
This supplies the missing current provenance check without inventing a historical
snapshot. Added a separate global writable-authority count to match the documented
idle requirement. The regression refuses wrong source/scope/watermark, changed
reply, missing or duplicate handoffs, corrupt journal/receipt and wrong Attempt.

Initial reviewed Python suite: **82/82**, including **15** tests for this harness. Python syntax
compilation and `git diff --check` passed. These use fake local service adapters;
the separate final host result is recorded below. No host operation was performed
by this reviewer.

## Review of the actual backend-only failure and explicit resume

The main session's first actual run restarted the backend and preserved
`after-backend.json` as failed solely because a delayed Runtime exit advanced
three log projections. All canonical Task/receipt/authority/ownership/source
checks passed. Runner had not restarted. Code inspection confirms
`BoundaryService.event` accepts late factual exit/output after mutation release.

Replaced blanket equality with a bounded event/Attempt comparator: retain every
old full event row; permit only digest-verified contiguous output/exit appends on
the same released/revoked dispatch and boot; derive the log-visible and exit
projection values and require monotonic activity only when an event arrived.
All remaining fields, receipts, journals, semantic history and execution counts
stay exact. Native summaries are allowed to lag the later raw SQL snapshot but
must be a matching prefix, avoiding a false claim of one atomic collection.

Added explicit `--resume-after-backend` for the reviewed failed version. It hashes
and retains all seven old reports, verifies the original backend intent and actual
backend identity transition, accepts only the known sole semantic-comparison
failure, and rejects a prior Runner/unknown stage. It adds an exclusive old-directory
resume claim, revalidates the current unchanged service/connection identities and
all guards, and can issue exactly one Runner restart. It never restarts backend
again and never changes the original failed reports. An uncertain resume cannot
be repeated with another output directory.

Final Python suite: **90/90**, including **23** harness cases; syntax compilation
and diff checks pass. Added meaningful positive exit/output and negative changed
authority/state/receipt/order/digest/projection cases, plus resume identity,
persistence failure, late-work and cross-directory uncertainty cases. The main
session performed the actual resumed Runner execution and inspected private raw
evidence; this reviewer performed no host action.

## Final host evidence review

`restart-evidence.json` records a passing explicit resume in
`/root/monos-capture-discussion-acceptance-v2` with the reviewed harness hash
`9ea5e1b42515a198ca42918fd3cdc021ce18ec8463413813c24490b29c6ab3ba`.
`backend-restart-reconciliation.json` retains the original v1 failed outcome and
seven raw-file hashes; the main session verified that those original bytes remain
unchanged. The corrected comparison accepts exactly the known exit event with
digest `97316eb5840b5627044b2bfb021100ad4d8d7ef70a1000721bfcd0b7e24544a9`
and its three matching projections, with no old event removed.

Reviewed the local evidence values and independently recomputed that event digest.
Backend container/image/PID/start identity matches from v1 completion through both
v2 snapshots, proving no second backend restart in the recorded resume. Runner's
systemd invocation, start timestamp and PID change once, with incarnation 28 → 29
and the same backend connection instance. All after-Runner checks are true; its
Runtime comparison reports no further event or projection delta.

The final report binds 205 deployed product files and four installed binaries,
preserves 24 Owner receipts, verifies six native Attempts and four successful
reply handoffs, correctly attributes five historical native snapshots, and proves
both known sleep children absent. Global idle counts are all zero. The retained
Task has one exact Specification revision and zero Plan, Node, Task Attempt or
Start. This covers current idle persistence and settlement; it adds no model call,
live interruption, host reboot, execution or full Stage A/V1 claim.

**No remaining review blockers for this leaf or its scoped Capture and Discussion
parent acceptance.** No additional test suite was needed for this final evidence
review; local JSON/hash/cross-report consistency and final diff checks passed.
