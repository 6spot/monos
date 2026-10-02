# Runner Verification

Sources: [Stage A](../../../docs/09-first-executable-slice.md), [readiness](../../../docs/10-architecture-readiness.md).

## Tooling status

From `runner/`, run `go test -race ./...` and `go vet ./...`. The [module](../../../runner/go.mod) requires Go 1.26 or later. SQLite uses CGO, so deploy builds need a C compiler; a `CGO_ENABLED=0` cross-compile is not runtime validation. [build.sh](../../../infra/runner/build.sh) builds the four executables. Do not claim a macOS run, or Linux container unit tests, proves native systemd/cgroup lifecycle behavior.

The [installation recipe](../../../infra/runner/README.md) provides a read-only `bootstrap.sh <root-owned-binaries> --check` preflight before task-owned host installation. Never run real CLI trials as root. Record source hashes, CLI/model versions and each failed trial alongside successes in the active task's evidence report.

Stage the complete Runner plus generated protocol when an interface changes. Build into a fresh artifact directory and inspect the final successful exit status before installing any executable: a failed sequential build can leave a mixture of new and old binaries. Bootstrap preflight checks ownership, not whether all binaries came from one successful build.

The real Node harness must compare the driver's committed Git tree with the finalized result tree; nonempty hashes alone do not prove exact-result preservation. Run `python3 -m unittest discover -s infra/probe -p 'test_*.py'` after changing these evidence checks.

## Probe interruption evidence

- Scope: root-side `infra/probe/probe.py` trials can outlive their invoking session.
- Signature: `Probe.start(attempt, kind, hold=False, peer_attempt=None)` writes
  `prepared-<attempt>.json` before admission and `started-<attempt>.json` after
  acknowledgement. Pair runs save `before-restart-<prefix>.json` and
  `after-restart-<prefix>.json` before releasing drivers.
- Contract: retain Attempt ID, kind, selected catalog metadata, source hashes,
  timestamps and acknowledged dispatch ID; no bearer material. Files are
  immutable evidence, never canonical execution state or relaunch authority.
- Errors: prepared-evidence write failure prevents admission; admission timeout
  leaves an uncertain prepared record; later evidence failure does not undo a
  dispatch. Existing evidence refuses overwrite before a repeated admission.
- Cases: acknowledged start retains its ID even without a final report; a
  prepared-only record requires canonical inspection; missing final evidence
  cannot establish process absence or authorize a replacement.
- Tests: inject failed evidence persistence and lost admission response; verify
  zero admission on the former, retained intent on the latter, acknowledged
  metadata persistence and no second admission on same-ID rerun.
- Wrong: infer completion or retry because the harness disconnected. Correct:
  inspect backend/journal/process identity and use authenticated revoke plus
  successful physical Stop when ending a bounded test. The polling deadline is
  not a product silence timeout; snapshot subprocesses can extend elapsed time.

`probe.py ... idle-restart <attempt>` is the model-independent completed-result
check: reject any unresolved Attempt and require an existing committed handoff;
persist the before snapshot, restart only the task Runner/backend, then compare
receipts, operations, request digests, ownership, events and scoped result reads.
Test refusal before service mutation and detection of lost receipts. A passing
idle check never substitutes for live concurrent restart or host reboot.

`probe.py ... reboot-hold <attempt>` writes a live Node checkpoint only when the
bounded hold, exact process identity, descendants, claim and retained unsent request
all agree. After host-wide authorization, persist reboot intent and revalidate
immediately before interruption; a conversational/tool turn can exceed the 300-second
hold. An expired window requires inspection and physical Stop, then a fresh trial ID.
Never overwrite the old evidence or count cleanup as a reboot pass.

`probe.py ... reboot-verify <attempt>` performs read-only post-boot verification:
changed boot, old identity retained, descendants absent, Stop/release, BLOCKED work,
immutable requests/receipts, no replacement Start, existing result readable and
unsent handoff unknown. It never reboots, replays requests or starts Runner. Record
whether Runner needed manual startup separately from container/service recovery.

Final host audits must distinguish PID-zero absent/revoked records without a
historical cgroup from a launched process whose cgroup status is unknown. Verify
durable records and boot identity together with current unit/cgroup/process inventory;
do not turn missing identity evidence into absence. Retain failed audit reports and
state precisely why a corrected check changes the conclusion.

## Shared-slot integration evidence

1. **Scope:** selected Runtime integration across queue promotion, native processes,
   service reconnect and authenticated Owner reads.
2. **Signature:** `python3 infra/probe/queue_probe.py --evidence <private-dir>
   --password-file <root-private-file> <fresh-prefix>` creates `-node`, `-planner`
   and `-queued` trial identities on an idle, ready two-slot Runner.
3. **Contract:** retain immutable preparation/checkpoint evidence, exact selection
   and Start outbox IDs, two distinct held process identities, queued status/logs,
   and complete resumed ordered logs. Use one SQL statement for capacity/Start
   observations. Samples establish observed invariants, not every instant;
   PostgreSQL race tests independently establish the promotion guard. A repeated
   factual `started` event does not itself prove a duplicate OS process.
4. **Errors:** reused trial ID, unrelated work, missing identity, invalid model
   catalog, expired fixture hold, changed selection or over-capacity sample fails
   the trial. Cancel queued work before releasing predecessors; an uncertain
   cancellation stops cleanup and retains claims for explicit reconciliation.
5. **Cases:** good is a queued Planner surviving reconnect and starting once after
   Node release; base is idle preflight refusal; bad is freeing a predecessor
   while the queued cancellation is still unknown.
6. **Tests:** `test_queue_probe.py` rejects missing claims, false queue visibility,
   changed Start/selection/identity, unsafe promotion and uncertain cleanup.
   Regular Python tests do not substitute for the installed native CLI trial.
7. **Wrong/correct:** never cancel a selected queued Attempt with the fixture
   `revoke` shortcut (it skips `mutation_allowed=false` rows). Use authenticated
   Owner Stop; pre-Plan Planner fixtures permit `stop_initial_planning` before a
   queued model launches. Preserve failed evidence and verify physical release.

## Combined Capture/Discussion idle persistence

1. **Scope:** retained Todo sources, exact created Task and immutable receipts
   across independent restarts of the existing idle backend and Runner.
2. **Signature:** `capture_discussion_acceptance.py --evidence <fresh-dir>
   --password-file <private-file> --prior-index <versioned-evidence-index>`;
   `--check-only` records preflight without service restart. No model is invoked.
3. **Contract:** verify prior report hashes, deployed product manifest and installed
   binary hashes; require globally settled work, fresh Runner registration and
   exact canonical Task/Specification/preview/receipt facts. Persist single-use
   claim and checkpoint-bound intent before each restart. Compare immutable
   semantic records after each restart, and prove actual process/connection
   identity change plus whole-tree absence of historical native Attempts.
4. **Errors:** existing evidence, unresolved work, changed content/source/binaries,
   missing ownership, stale registration or lost canonical state rejects the run.
   An uncertain restart preserves intent and requires inspection, never automatic
   repetition under another directory. Authentication/session observations are
   operational facts and are not compared as immutable business records.
5. **Cases:** historical early snapshots may predate the final log drain even
   after a command/process settled. Retain every prior per-stream event unchanged;
   only contiguous later output/exit events are acceptable, with no extra Start.
   Record the appended metadata. The same asynchronous boundary exists during
   reconnect: an already released/revoked Attempt may report its final output or
   exit. Validate exact dispatch/boot, event digests, stream/order continuity and
   prior-row retention. Only the appended events may explain changes to
   `activity_at`, `log_visible_sequence` and `exit_observed`; preserve every other
   Attempt field, ownership fact, command receipt and Task/Specification exactly.
   Keep local journal raw bytes and backend canonical JSON digests distinct:
   preserve each old local byte string, decode and compare the full event, then
   hash with the backend's canonical encoder for its digest. Do not assume every
   historical journal serializer emitted backend-canonical bytes. For a specific
   claimed identical raw append, verify that byte equality separately.
   Native/local/API reads may precede the raw database event collection; verify
   their retained prefix instead of claiming one cross-process atomic snapshot.
6. **Tests:** reject lost/changed/reordered events, duplicate sequence or Start,
   missing receipt/Task, unexplained projection changes, unresolved process,
   failed evidence write and repeat invocation after an uncertain restart. An
   explicit `--resume-after-backend <prior-dir>` must verify retained intent and
   changed backend identity, take an exclusive continuation claim, and restart
   only the unperformed Runner stage. A native reply without an earlier
   process snapshot still needs exact source/watermark/body and journal/receipt
   provenance; do not invent a historical PID comparison.
   Validate historical heartbeat/report freshness against its recorded observation
   time, or retain its original passed boundary check with exact snapshot hashes.
   Current-wall-clock freshness belongs only to the newly captured live state;
   elapsed review time must not invalidate a previously observed service boundary.
7. **Wrong/correct:** persisted `ready=true` alone is not reconnect proof. Verify
   fresh Runtime registration, advanced Runner incarnation and changed backend
   connection or systemd invocation identity, with unchanged retained results.

## Replan native observation contracts

1. **Scope:** `infra/probe/task_replan_driver.py` and `task_replan_probe.py`
   observe replacement work. Local observer tests are not installed Linux proof.
2. **Signatures:** replacement driver takes exact Task/resource/old/new Attempt,
   Node/Plan/Specification and explicit guidance declarations. `--predecessor`
   selects `unfinished|completed`; completed mode additionally requires exact
   `--finalized-commit` and `--finalized-tree`. The original workspace fixture's
   `--replan-reason <file>` performs the actual terminal Node handoff.
3. **Contracts:** retain request evidence before invoking bundled CLI. Uncertain
   response never authorizes a new identity. Agent-declared IDs are observations;
   root-side authority comparison must bind canonical source, publication, exact
   command receipts and lease descriptor. Compare both graph content/membership
   and independent saved Owner envelopes. Joint approval has a separate exact
   requirements confirmation consumed by that same publication.
   Physical absence can precede the backend's effect-result commit. A readiness
   predicate must require both native absence and the same SQL snapshot's
   `process_absent/process_released`, terminal operation state and released leases;
   `settled_checks(native)` alone is not canonical settlement.
   Handle a provably never-launched QUEUED→CANCELLED Attempt separately: bind
   its canonical source/predecessor and exact cancellation receipt, require no
   admitted Start/outbox/effects/leases/events, no local journal/launch/spool, and
   actual expected unit/cgroup absence. It has no launched-process identity for
   `settled_checks`. Missing evidence alone is never this proof, and this narrow
   branch must not relax checks for any launched or uncertain Attempt.
   A Planner Stop has `repository_free=NULL` in SQL (omitted on the wire), not
   `true`: migration0018 and Host scope validation reserve that flag exclusively
   for repository-free `complete_node`. Require the exact sole Stop receipt,
   `result.writer_absent=true`, absent resource/workspace/lease/completion fields,
   and both physical and canonical release. Repository-free phase semantics do
   not imply the similarly named completion-only database flag.
4. **Errors:** mismatched predecessor mode/identity, changed private files/lineage,
   missing root checkpoint, foreign source/lease, reused evidence and lost exact
   approvals fail observation. A completed driver's `completion_submitting` stage
   alone is not success: require actual canonical completion and finalized Git.
   For an unexposed first-open network failure, retain the original recovery
   record. Current formal recovery is exact Owner Stop, cancellation/lease release,
   then Continue with a fresh source/Attempt. `monos retry` only replays the receipt;
   fixture-only `admin retry_operation` is not native product recovery evidence.
5. **Cases:** unfinished transfer preserves private HEAD/index/files. Completed
   transfer preserves finalized commit/tree and private file bytes, allowing the
   earlier HEAD/index to differ. `from_plan_id` names the actual old source Plan,
   which may precede the most recent applicable Plan. Never rewrite it to satisfy
   a current-pointer comparison.
6. **Tests:** real local Git must detect lost ignored files, changed fixed lineage,
   stale finalized commit and late writers. Negative authority tests substitute
   graph membership, Task/Runner/source/lease/Plan, approval and consumed request.
   Snapshot extensions remain one SQL statement: PostgreSQL's 100-argument
   function limit requires concatenated `jsonb_build_object` chunks once more
   than 50 key/value pairs are collected. Do not split into inconsistent queries.
   Preinstall/restart runnable checks must use actual initial-plan or Replan
   publication authority, as the Node pump does. Historical fixture rows with
   RUNNING/PENDING labels and no canonical source are not runnable; snapshot
   and compare their complete records separately rather than deleting them.
   Probe fixtures must model the actual operation union: reject a Stop carrying
   completion-only fields, workspace authority, missing writer absence, or a
   mismatched receipt. A corrected observer uses a separate evidence filename;
   preserve the original failed report. Observer-only source changes may carry
   existing build evidence only with an exact hash delta proving every Docker
   and Go build input unchanged, plus fresh observer tests and a final manifest.
   Source context/identity is immutable; operational `waiting_reason` can change.
   A terminal `request_replan` changes the requesting source from no wait to
   `semantic`. Bind that change to its exact request/blocker/Attempt/receipt;
   compare all other source fields instead of declaring the entire row immutable
   or broadly omitting lifecycle fields from the audit.
   Keep three completion records distinct: the original async receipt remains
   `admitted`; the successful physical operation result contains Git/workspace
   facts; the formal completion result adds manifest summary, artifacts, guidance
   and digest. Compare the complete manifest against the operation's manifest
   digest column and the formal result, then independently require physical
   success. Never expect the raw Git result to contain semantic manifest fields.
7. **Wrong/correct:** matching IDs/nonempty hashes do not establish publication.
   Verify complete content hashes, normalized members, exact proposal source,
   independent Owner requests, backend/native journal receipts and actual Git.

## Test layers

- Unit: adapter event normalization, schema validation, bounded recovery decisions.
- Local integration: SQLite durability, spool acknowledgement, Git journals and replay.
- Linux host: two identities, cgroups, descendants, reboot, credential isolation.
- Real CLI: noninteractive permission mode, bundled command access, required lifecycle call, lazy workspace grants.
- Control integration: separate filesystem roots, duplicate/reordered RPC and two fake Runner identities.
- Provider: expected-head merge, uncertain responses, remote checks and partial delivery.

Fakes establish control behavior only. Record supported CLI/version/settings and actual host profile for probes. Native session resume and live steering remain optional until independently verified.

## Review checklist

Use structured process arguments, propagate cancellation without discarding admitted operations, bound buffers and apply backpressure, protect unresolved journals/workspaces from cleanup. Do not invent a general workflow engine or a second scheduler. Explain every new Go dependency against standard-library alternatives.
