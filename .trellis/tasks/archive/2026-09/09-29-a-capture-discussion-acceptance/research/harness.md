# Idle restart acceptance harness

Implementation: `infra/probe/capture_discussion_acceptance.py`, reusing the existing
`TaskPreviewProbe` read/snapshot infrastructure. This adds no product state command,
model invocation, service, container or database fixture. The main session owns
host execution and final evidence review.

## Invocation

Run as root on the authorized existing test installation. Upload the reviewed
`research/prior-native-evidence.json` index without changing its contents. The
password stays in the existing root-private file and is never an argument value.

```sh
python3 infra/probe/capture_discussion_acceptance.py \
  --check-only \
  --evidence /root/monos-capture-discussion-preflight-v2 \
  --password-file <existing-private-password-file> \
  --prior-index <uploaded-prior-native-evidence.json>
```

The separate preflight writes `claim`, `prior-evidence`, `before` and `checked`
records, with no restart. For actual acceptance, omit `--check-only` and use
`/root/monos-capture-discussion-acceptance-v1`. Do not reuse a preflight directory.

The inherited source root is fixed to `/root/monos-boundary-probe-src`. HTTPS
endpoint, CA, Runner identity and read-only journal path come from the existing
private installation configuration; no port or token is copied into this file.

## Evidence and guards

- Verify the hash and complete pass result of each indexed prior report, including
  capture, native ordered/interrupted Discussion, exact preview and shared queue.
- Bind the final 205-file product manifest and archive SHA-256
  `a0913337e59aa109940bd2486c1e5b0264d27aba44af54d53c4ac6af39b1a014`.
  Reject traversal, escaping symlinks, missing files and changed bytes.
- Bind installed Compose images to the final Preview installation audit. Bind the
  four installed Runner binaries to Discussion's retained `runner-updated.json`;
  Preview did not redeploy those binaries.
- Require zero global queued, unreleased or writable Attempts, unsettled operations,
  pending delivery/outbox rows and unresolved Discussion sources.
- Read all three native source Todos, complete messages, Discussion status, exact
  created preview (including a wrong Project selector), independent PLANNING Task,
  original Owner receipts, creation provenance and initial exact Markdown. Require
  one Task/revision and no Task-side Plan, Node, Attempt or Start.
- Require all six native Attempts recorded in the passed trial audits, exact
  retained ownership, physically absent main processes/cgroups and both recorded
  native sleep children. Missing ownership or unknown physical state fails.
- Compare canonical database records, native journal/handoff identities and global
  counts exactly across restarts. The only permitted raw-record changes are the
  validated late Runtime event append and three matching log projections below.
  Runtime authentication, heartbeat and current process observations are checked
  separately from durable semantics.
- Require authenticated healthy Owner reads and an online Runner from the backend's
  own infrastructure read, plus fresh ready database connection and matching runtime
  report incarnation. Persisted `ready=true` alone cannot pass.

The existing backend is restarted first. It must keep its container/image, change
its actual start timestamp and backend connection instance, advance Runner
incarnation and leave the Runner process identity unchanged. The existing Runner
then must change its systemd invocation/start identity and advance incarnation,
while leaving the backend identity/connection instance unchanged. Host boot must
remain the same. Readiness polling is bounded; individual subprocess/HTTP reads
have their own timeouts, so the polling deadline is not a hard wall-clock bound.

Each step saves a full guarded checkpoint and immutable intent before issuing
exactly one restart command. Failed evidence persistence prevents that mutation.
An uncertain command, failed reconnect or semantic mismatch stops the workflow;
there is no automatic second attempt or cleanup. The exclusive fresh-directory
claim refuses reruns, concurrent duplicate invocations and partial evidence files.
Changing directories is not evidence that an uncertain restart may be repeated.

## Historical event correction

The main session's first **read-only** host preflight retained a failed report in
`/root/monos-capture-discussion-preflight-v1/read-only-preflight.json`. No service
was restarted. Only five historical native event comparisons failed: four old
snapshots preceded a final `runtime` exit event, and the Preview snapshot preceded
a final stdout chunk. Every other guard passed. This was an overly strict harness
comparison, not product state loss; the failed evidence remains intact.

Historical event summaries now require an exact unchanged per-stream prefix.
Only contiguous `output` or `exited` appends are accepted; missing/changed records,
duplicate identities, sequence reassignment, gaps, new starts, attention/failure
facts and unknown kinds fail. SQL array
ordering is normalized because it does not define stream order. Appended summary
metadata is stored as `historical_event_appends` in current snapshots. Every
already-recorded event remains exactly unchanged, including its complete body.

Five historical native snapshots exist: two ordered turns, two interrupted/Stop
turns, and Preview. The final later successful interrupted-source turn has retained
audit/messages but no historical native snapshot in `withdrawn-…`. All four
successful native turns must bind the retained source/watermark and exact reply
(including any structured preview) to one current native handoff, its verified
journal digest and a committed same-scope formal receipt. The sixth Attempt's
current ownership/physical state is also checked and included in exact restart
comparison. Do not describe a sixth historical native snapshot as existing evidence.

## Late Runtime exit after the actual backend restart

The actual run with harness SHA-256
`a2e1184c053672e5c239b1d40dc9ac11aec784a6a69d69c9d779b3f5d913b034`
restarted the backend successfully. Its `after-backend` checkpoint failed only
the former blanket semantic equality check; **Runner was not restarted**. All
original reports in `/root/monos-capture-discussion-acceptance-v1` remain intact.

The retained raw SQL snapshot received one delayed `runtime/exited` event for the
already released Preview Attempt. Its original dispatch/boot were unchanged.
Only `exit_observed`, `log_visible_sequence` and `activity_at` advanced with that
event. `BoundaryService.event` permits these factual updates after formal release;
they do not regain mutation authority or create a semantic outcome. The native
sub-snapshot was read earlier than the raw SQL snapshot and had not seen the exit.

`semantic_progress` now verifies this narrow contract:

- Every existing event row, digest, body and identity must remain exact. Only
  contiguous per-stream and global-order appends from a released, absent, revoked
  Attempt are allowed, using its retained dispatch and boot.
- New output must have canonical source bytes; a new exit must use the real
  Runtime exit shape/text and valid exit code. Canonical event digests are checked.
  Starts, attention, failures, gaps, duplicates and unknown event forms fail.
- All other raw records and Attempt fields stay exact. A changed log-visible
  watermark must equal the complete ordered prefix; exit observation equals its
  old value or a newly appended exit. Activity may advance monotonically only
  with an appended event. Without an event, all three projections stay exact.
- Native event summaries may lag the later raw SQL snapshot in the same
  collection, but every summary must match a raw event and only the permitted
  output/exit tail may remain unseen. Journal/receipt/ownership fields stay exact.

The raw snapshots and accepted append/projection details remain in evidence;
the comparator does not erase them to manufacture equality.

## Explicit continuation after that backend-only failure

```sh
python3 infra/probe/capture_discussion_acceptance.py \
  --resume-after-backend /root/monos-capture-discussion-acceptance-v1 \
  --evidence <fresh-resume-evidence-directory> \
  --password-file <existing-private-password-file> \
  --prior-index <uploaded-prior-native-evidence.json>
```

This narrowly accepts the reviewed failed harness version and its seven original
files. It verifies/hash-binds the saved baseline, backend intent and after state,
requires that semantic equality was the only failed check, rejects any Runner or
extra stage, and re-evaluates the already-completed backend restart. Old reports
are copied into new evidence with their original failed outcomes, not rewritten.

An exclusive `resume-claim.json` is appended to the old directory before any new
service effect. This prevents another fresh output directory from repeating an
uncertain resume. Fresh Owner/source/physical guards and exact current backend,
Runner and connection identities must match the retained post-backend state.
The resume path then emits **only one Runner restart**, with its own immutable
intent and post-checkpoint. It cannot issue another backend restart. Failure to
persist any evidence, changed state/identity, late work or an uncertain command
stops the path without automatic retry or cleanup.

## Local verification and limits

`python3 -m unittest discover -s infra/probe -p 'test_*.py'`: **90 passed**, including
23 acceptance tests. Python syntax compilation and `git diff --check`: passed. Regressions cover unsafe
preflight, read-only mode, late queued work, evidence persistence failure,
uncertain restart/rerun retention, concurrent claims, lost receipts/messages/
Specification/Task/native receipt/counts, stale identities, missing prior cases,
manifest escapes, process uncertainty and historical append versus current exactness.
The added handoff regression refuses missing/duplicate commands, wrong source,
watermark or scope, altered reply, corrupt journal digest, unknown formal receipt
and another Attempt identity even without a prior native snapshot. Global writable
authority and pending outbox work also prevent service mutation.
Late exit/output tests verify exact rows, digest/source bytes, ordering and matching
projections, and reject unrelated authority/state/receipt/identity changes. Resume
tests verify retained failure evidence, exactly one Runner effect, refusal on
invalid intent/extra stages/current identity changes, evidence failures, late work,
and cross-directory refusal after an uncertain resume.

Unit tests use fake service/HTTP adapters and establish refusal/evidence behavior,
not real Linux restart success. This leaf establishes idle persistence only when
the main session's retained actual host reports pass. It does not establish live
interruption, reboot, Task execution/delivery or full Stage A/V1 completion.
