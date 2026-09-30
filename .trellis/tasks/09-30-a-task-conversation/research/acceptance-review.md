# Independent frozen deployment and native evidence audit

Status: **ACCEPT — Task Conversation leaf**, with the explicit evidence limits
below. This audit is independent read-only inspection of the
existing host and retained records, not another deployment or test execution.
Full code review and dedicated regression execution are in `check.md`.

## Findings (fixed)

None in this audit; product files and host state were not changed.

## Findings (not fixed)

- No confirmed code, deployment or native acceptance defect remains open.
- Initial harness/observer failures are retained and explained below. They are
  not relabeled as clean automatic success; subsequent exact recovery and
  independent evidence establish the required behavior.
- Completion-first/new-activation and hard-recovery combinations are covered by
  real PostgreSQL/Runner tests, not claimed as additional native trials. Actual
  delivery, revision workflows and execution UI remain later leaves.

## Verification

### Frozen Linux build and installation

Independently rehashed all 293 manifest entries in both
`/root/monos-conversation-build-src-v1` and the installed
`/root/monos-boundary-probe-src`. Both match
`/root/monos-conversation-manifest-v1.json`. Recomputed tar SHA256:
`12d6b6bcc223b4e802db2dd56739da79dd68c00c498d50ea5f9d0780ab04b72f`.

Read the actual fail-fast build scripts, result files and logs in
`/root/monos-conversation-deploy-v1`: Docker server/test builds pass; isolated
real PostgreSQL suite **254 tests / 22 files pass**. Initial Go proxy timeout is
retained in `linux-go.log`; separate `linux-go-cached.log`/result prove module
verification, Linux race tests, vet and all four production binary builds pass
using the existing cache with `GOPROXY=off` and `GOTOOLCHAIN=local`.

Recomputed four staged/installed binary hashes and verified exact equality with
installation intent/results. Recomputed four old backup binary hashes against
the preinstall baseline. Private backup sizes are 8,605,487 bytes for the SQL
dump and 5,476,352 bytes for SQLite; no private contents were printed.

Live read-only checks independently confirm migration 19, installed built server
image identity, loopback port 18444, and unchanged monolab container identity,
start time, image and ports. All original full-row receipt hash multiplicities
remain present: command 65, configuration 19, discussion 12, Owner 23, preview 12,
Todo 10. New native receipts are additive.

The original v1 boolean-query failure and v2 bootstrap failure are preserved.
Reviewed `resume-install.py`: it validates unchanged baseline DB receipts,
binaries, containers, idle state and copied manifest before touching failed-unit
markers. Retained reconciliation covers exactly nine historical failed Attempt
units, with process-released/absent/nonwritable DB facts, zero MainPID/ControlPID
and no cgroup members. It resets only those unit failure markers and resumes the
already-claimed install. No product record reset or second installation claim is
used. `installed.json` records all eight postflight checks passing and zero
pending/writable/held work at that installation boundary.

### Ordered pre-Start conversation

Evidence directory: `/root/monos-conversation-native-v1`.
Task: `6462642a-b5f0-4590-a372-43b386ff2966`.

Independently recomputed checks from retained raw records/native journal evidence
in `prestart-replies.json`, `prestart-isolation.json` and
`question-two-queued.json`. Both sources resolve exactly once through installed
CLI commits; canonical envelope bytes/digests, source/launch/input/watermark,
reply/routing, SQLite requests and PostgreSQL receipts agree. Each native Planner
has one Start, repository-free ownership and successful physical cleanup.
Second input was durably pending while the first actual native Planner was live.
All non-conversation execution state, Attempts, sources and effects are unchanged.

Actual `read_task_history` receipts prove source 1 cutoff 1 excludes already
queued input 2. Source 2 cutoff 2 contains both Owner inputs and reply 1; reply 1
has message sequence 3 but resolves input 1, so this is valid source attribution.
The first frozen recent-history window is empty; the second includes input/reply
1. Both current-context replies report PLANNING with null Plan and no Node work.

The Todo capture sentinel `Canonical private Git execution acceptance.` is absent
from frozen Task contexts and actual context/history read results. Existing
Task `70810e87-c861-4257-a9c3-ad346abb342c` completion sentinels
`Native same-Node Git break-ancestry trial.` and
`Native same-Node Git repair-ancestry trial.` are also absent, as is the existing
reading-list Task's unique completion content. These are existing canonical
records; no sentinel data was inserted.

### Guidance progress and preserved failed invocation

`guidance-reply.json` proves actual native routing with the current Spec/Plan,
Node activation 1 and original Node source `6645d6aa-e57b-4496-8468-263fec11bd0b`.
Original Attempt `b1ab398b-9566-4bfe-ac4c-9af753ac629c` is cancelled with
`end_reason=guidance_followup`, process absent/released and mutation disabled.
Fresh source `5874f138-e39a-45fe-bc9d-0416e4a46cb3` assigns guidance
`39ad3f9a-7193-4d86-a1f5-ab93481960cb` at the same activation.

Fresh Attempt `a9cff687-4a2f-4a74-815c-0cf49306cb78` then encountered Agent shell
transcription and harness `runpy` import-path errors before a Conversation driver
report or `open_workspace` receipt. Root retained the original failure in
`guidance-harness-failed.json` and native logs. This proves routing/Stop/fresh
assignment, but **does not yet prove successful private-work continuation or
guidance handling**. The failed Attempt must remain in subsequent evidence;
recovery must bind the actual last `held_for_stop` workspace predecessor rather
than inventing a driver checkpoint for the failed invocation.

### Explicit recovery, Owner Stop and successful handling

Subsequent `guidance-continuity.json` preserves all three Node Attempts: automatic
successor 2 remains the failed trial, while explicit Owner Stop/Continue creates
Attempt 3 `3cb6bf09-dd6b-4295-9e2e-be115e23d837` with fresh source
`918a1ff6-1666-40ed-8083-504b68773f8f`, same Node and activation 1. **Automatic
guidance routing/Stop/source selection and explicit recovery/private-work
verification are separate proven stages**, not an uninterrupted automatic success.

Independently recomputed report fingerprint/HEAD/index/file equality against
initial Attempt `b1ab398b-9566-4bfe-ac4c-9af753ac629c`, exact predecessor report
SHA256, shared workspace/fixed lineage and distinct new lease. All pass. Original
Stop checkpoint and physical descendant cleanup also pass. `owner-stopped.json`
then proves Attempt 3's Stop checkpoint and full physical cleanup. For the older
checkpoint helper, the new driver's `open.result.workspace_id` and
`expected_git_tree` were normalized to the helper's old field names in memory;
the evidence files were not changed. `stopped-chat-isolation.json` independently
recomputes unchanged execution state and effects across a native status reply.

`stopped-guidance-paused.json` independently recomputes three retained Node
Attempts, all nonwritable/released, no completion and two pending obligations.
Only explicit Continue then launches Attempt 4
`2773a2e7-7a2b-40f7-b7a2-99ab91148740`.

`guidance-final.json` passes independently recomputed exact v2 manifest SHA256,
successful operation/Node completion/source/activation binding and handling of
both declared guidance IDs. This includes original
`39ad3f9a-7193-4d86-a1f5-ab93481960cb` and stopped-input guidance
`b6c69999-cd77-48cc-9a57-2d22e96d6e41`. Agent-written declared IDs match the actual
installed CLI `complete_node` envelope and frozen assignments. Both workspace-open
and completion PostgreSQL envelopes/digests match SQLite native requests exactly.

Attempt 4's prior report hash and pre-completion HEAD/index/private files/lineage
match stopped Attempt 3, with a fresh lease. Live read-only Git inspection confirms
final commit `28f9550221224448dbcc4ddd40f2dcf5d77a8ee9` has tree
`946bdab3247e0178c099cf77dbacb1cd0de54afb`, equal to the driver expected tree and
trusted completion result. All four private file hashes still match, including
ignored data. Completion ends in REVIEW, same activation 1, with exact declared
obligations handled and no remaining physical writer. These checks do not claim
provider live steering or a native completion-first/new-activation trial.

`guidance-final-git-object-verified.json` also confirms finalization preserves the
private HEAD as the final commit's parent; that private commit is rooted at the
fixed public base. Root retained an earlier observer failure that incorrectly
expected the final commit's direct parent to be the public base. The corrected
check reflects the private-history contract and does not rewrite Git evidence.

### Terminal turn Stop, Retry, queued Withdraw and late reply

After explicit Task Cancel, `terminal-before.json` establishes CANCELLED at
control version 11. Independently recomputed `execution_unchanged` across
`terminal-turn-stopped.json`, queued withdrawal, fresh-source Retry and final
reply; all pass. Native Attempt `67af8652-f653-4c09-96ac-15d9c8642933` is physically
settled after explicit turn Stop. Retry retains input
`d474a359-a27c-4382-8d6c-e5932b142a86`, creates source
`c099ad82-a3a7-400c-992a-ca9dcb9e9416` and Attempt
`971c4dd3-8ec6-453f-86a2-84a5a90c3006`, and preserves reply-only terminal scope.
Queued input `11435896-0131-4abc-ac73-a955fb12c9fb` has one withdrawn disposition
and never acquires a source or fabricated reply.

The initial 300-second observation expired while the Retry Attempt was genuinely
running. `terminal-retried-reply-incomplete.json` is retained. That same Attempt,
without replacement/reexecution, later committed unique `commit-001` at
12:52:34 UTC. `terminal-retried-reply-late-observation.json` and
`terminal-recovery-final.json` pass independently recomputed exact source/reply/
envelope/SQLite receipt/launch/physical cleanup checks. All Attempts are now
released and nonwritable; terminal conversation did not reopen execution.

### Spec synchronization review

Reviewed Task Conversation, Node execution, Task planning, dispatch queue,
protocol commands, delivery contracts and index edits. Explicit source authority,
saved-answer Retry, manifest compatibility, physical ownership and delivery
scope are consistent. Owner acceptance/delivery Retry remain future work; the
paired cutoff is not a public acceptance setter. Root owns final index/status and
task archival bookkeeping after this ACCEPT. Consolidated `verification.md`
accurately distinguishes successful gates, retained deviations and native limits.

### Existing backend and Runner restart — final gate

Independently reviewed the restart script and recomputed retained
`conversation-restart-before.json`, `conversation-backend-restarted.json` and
`conversation-restart-final.json`. Backend connection identity changes first;
Runner registration incarnations are 37 → 38 → 39, and the final systemd
InvocationID changes. All canonical record categories compare equal across both
restarts, including Task, inputs/messages/sources/resolutions, guidance/obligations/
assignments/followups, issues/answers, all execution sources/revisions/Attempts,
Starts/operations, manifests/completions and workspaces/leases. Only documented
raw-log Attempt projections (`activity_at`, `log_visible_sequence`, `exit_observed`)
are excluded. All six full-row receipt multiplicity maps are identical.

All 12 original Attempts preserve original PID, birth, boot, cgroup and dispatch
identity, and independently recomputed physical settlement checks prove their
original process trees absent. Global pending/writable/held counts are zero.

Final independent live database reads still equal the restart snapshot and all
receipt hashes; global idle remains true. Rehashed installed source/binaries still
match the frozen manifest/build, and monolab identity and monos port 18444 remain
unchanged. No pending integration gate remains for this leaf's documented scope.

Local lint/typecheck and dedicated review tests: **pass**, independently executed
by the previous reviewer as documented in `check.md`; not rerun or relabeled as
new executions here. No permanent service, canonical mutation, commit or push was
performed by this evidence reviewer.
