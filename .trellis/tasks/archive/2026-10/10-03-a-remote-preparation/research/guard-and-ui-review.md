# Remote preparation: canonical guards and review UI

Active task: `10-03-a-remote-preparation`, planning only. Reviewer owns this report only. Initial task scope was dirty PRD/context/task metadata; no product/spec/test/provider/host/lifecycle changes or broad tests were performed. Other sessions' changes remain untouched.

## Findings (fixed)

None: this is source-backed planning research, not an implementation review.

## Findings (not fixed)

### P1 — remote admission cannot reuse local-only admission unchanged

`apps/server/src/publication-candidates.ts:23` currently guards settled REVIEW,
publication slots, pending Replan and physical process/lease release. This is
appropriate for local construction/scanning. It does not guard unclassified
messages or already-classified unresolved requirements/guidance/issues.

The existing semantic union is `taskInputGuards()` in
`apps/server/src/task-guidance.ts:410–420`:

- `task_inputs.status IN ('pending','failed')` and no accepted-batch attribution;
- pending `requirement_obligations` with an attached `current_proposal_id`;
- open `task_input_issues`;
- active guidance with no recipient obligations, or any pending recipient obligation.

Use this union for remote preparation in addition to the local/current-result,
configuration, mode, scan and ownership guards. Do not use only
`conversation_watermark`, `conversation_input_id`, unread count or absence of a
live Planner. A replied input can transfer responsibility to an unresolved
proposal/issue/guidance. Withdrawn input resolves only its own responsibility.
`taskInputGuards` returns an empty array for terminal Tasks, so REVIEW/nonterminal
authority must be checked independently. Its 257-row bound is sufficient to
detect a blocker; a truncated UI list cannot establish that no blocker exists.

Planning disposition: main accepted reuse of this guard for every new remote
effect. Keep local
scans readable/runnable under their existing physical guards; neither remote
failure nor a newly saved message should hide or destroy their immutable results.

### P2 — Cancel needs a durable remote cleanup seam once this leaf creates PRs

`docs/04-workspace-and-git.md:305` requires cancellation to reconcile admitted
effects, close open undelivered review requests and keep their branches. Current
`apps/server/src/node-execution.ts:318–354` and
`apps/server/src/task-planning.ts:95–103` revoke local execution, input and change
responsibility but contain no remote preparation/PR cleanup. Accepted-delivery
cancellation is explicitly rejected by these paths, since it remains future work.

Minimum this-leaf seam: Cancel serializes with remote admission, stops new
push/create/update work, persists exact item/operation reconciliation and then
closes the same identified undelivered PR. Keep the branch. Do not close an
unmatched PR, recreate a PR, infer that an uncertain create failed, or reopen
CANCELLED from a late success. Read-only reconciliation and exact cleanup remain
possible after cancellation; lack of credentials leaves visible pending cleanup.

Main explicitly included this minimum durable Cancel cleanup in this leaf.
Accept/merge/explicit Request Changes and accepted-batch correction remain the
next-leaf boundary. P2 is closed as a scope decision; its implementation and
actual uncertain-create/Cancel tests remain required later.

## Exact admission and recovery boundary

Sources: `docs/04:347–365`, `docs/06:506–551`, `docs/07:632–706`,
`docs/08:125–157`, Stage A in `docs/09`, accepted publication-candidate spec,
current Conversation/Specification/Replan/Cancel implementations.

| Canonical fact | Remote preparation behavior | Local/result behavior |
| --- | --- | --- |
| Pending/failed ordinary input | Pause new remote mutation; show input/Planner recovery reference | Preserve local inspector/scans |
| Status reply formally committed | This input guard clears; reevaluate every other guard | Do not change source attribution |
| Attached pending requirement proposal | Pause even though input is replied | Existing proposal Revise/Withdraw stays available |
| Change settling or withdrawing | Publication-slot freeze remains until physical reconciliation releases it | Do not claim new requirements effective early |
| Open input issue | Pause until its actual resolution/withdrawal | Answer in Conversation; exact Retry remains separate |
| Pending guidance | Pause until handled, explicitly resolved, superseded or withdrawn | Delivered instruction is not completed work |
| Pending Replan | Pause; dismissal resolves only Replan ownership | Linked requirement/input responsibility can remain |
| Current complete scan plus exact eligible overrides | Eligible only after all other remote guards pass | Hard findings/incomplete scan/known exposure still block |
| after_acceptance mode | No remote preparation admission, token mint or mutation in this leaf | Keep local candidate/findings/result visible |
| Runner/provider offline or missing permission | Retain same operation and truthful attention | Task remains REVIEW, local result remains inspectable |
| CANCELLED/COMPLETED | No ordinary preparation/Retry; reconcile historical effect truth | Never reopen lifecycle through callbacks |

Message admission already takes canonical Task control through
`conversationTask()` (`task-conversation-state.ts:56`), and writes accepted-batch
attribution plus ordered input/message together (`task-conversation.ts:43–65`).
Remote claim/admission must take the same Task lock and relevant configuration/
item locks, persist exact authority and ownership, then release the transaction
before Runner/provider I/O. Recheck current source, effective Spec/Plan/result,
mode/credentials/configuration, exact scan/override coverage and input guards at
each new mutation boundary. Do not let a later broad Task control increment alone
replace precise result/operation guards.

The design must define the ordering when input, Cancel or requirement publication
arrives after an effect was admitted but before its response: stop subsequent
effects, reconcile the admitted effect under the original identity and preserve
remote truth as history. A database guard cannot undo an already sent provider
request. No successor worker or new result may overtake an unresolved push/create/
update merely because a claim lease expired. No DB lock spans RPC/Git/HTTP.

Requirement withdrawal illustrates the separate responsibilities:
`task-specification.ts:60–69` changes an admitted operation to withdrawing;
`task-specification-settlement.ts` releases its publication slot only after its
recorded physical owners/effects settle. Clearing one input cannot clear that slot
or an independent Replan/guidance issue. Preserve these owning-module seams.

### Active effect versus revision/Cancel fences

Use the existing Task/configuration locking boundary and a narrow per-item remote
effect ownership/settlement predicate. The accepted local publication operation
is not a mutable remote provider job; retain immutable local history separately.
An admitted remote effect keeps its exact operation/source/head/request payload
and durable unresolved ownership until its host/provider outcome is reconciled.

Do not simply insert a remote preparation operation into `task_publication_slots`:
the current slot is requirement/Replan ownership (`0020_task_specification.sql`,
`task-replan-publication.ts:43–45`). `specificationFrozen()` tests any slot, while
`admitSpecification():21` rejects an existing slot. A long provider outage would
then suppress ordinary guidance and prevent admission of the very change needed
to revoke stale preparation. Keep the existing direction: a requirement/Replan
publication slot blocks new remote effects, while the change's own settlement
waits for already-admitted remote effects through a specific Delivery predicate.

| Owning path | Minimum addition before advancing authority |
| --- | --- |
| Remote admission/send/replay | Validate ordinary remote authority under Task/item/config lock; mark exact effect ownership before I/O; do not resend an uncertain effect without reconciliation |
| `advanceSpecification()` | Before publishing a new basis or releasing the change's slot, wait for that Task/item's previously admitted push/create/update to reconcile; retain settling/withdrawing attention |
| `replanQuiescent()` / `publishReplan()` | Include pending remote mutation outcome as unsettled work before graph/basis/workspace transfer publication; lease expiry is not quiescence |
| `advanceGuidanceFollowup()` before completed-node reactivation | Do not start corrective follow-up over an unresolved admitted remote mutation; an input/guidance guard already prevents the next ordinary preparation effect |
| Existing Cancel command | Atomically revoke new remote work and persist exact cleanup intent alongside local cancellation; leave in-flight effect ownership/reconciliation intact |
| Cancel cleanup worker | Reconcile admitted effects, discover the precise same PR if create was uncertain, then close it once; retain branch and truthful late success without lifecycle revival |

Requirement and Replan ownership/effect tables are tied to existing Runtime
`operations`/Attempts. Do not coerce independent Delivery jobs into those rows or
invent an Attempt just to reuse settlement. A small Delivery-owned query/journal
seam can be called from the current module publication hooks. Retain each owner's
own IDs and release only its own guard.

Once input or a newer basis blocks an old operation, permit read-only reconciliation
of already-admitted effects but no new ordinary mutation. A successful historical
push is recorded as published ancestry, not undone or force-reset. A successor
must use the recorded verified public head, compare its exact parent/result tree,
rescan and retain the existing branch/PR. Input guards cannot authorize cleanup;
Cancel's explicit cleanup identity provides that limited authority separately.

An uncertain PR body/title PATCH is also an admitted effect: reconcile its content
identity before submitting a newer payload. Merely observing the expected branch
head cannot settle an uncertain metadata update. Required-check/mergeability reads
may refresh historical evidence while mutation authority is paused.

## Minimum API and UI projection

Use a separate typed remote preparation collection/read projection and exact
Retry receipt, or an explicitly optional block on the existing local record.
Do not overload the immutable local scan run as a mutable provider poll.
Retain per-Task/resource/item cardinality even while Stage A supports one repo.

Minimum remote evidence:

- stable item, operation and remote lineage identity; source/candidate/scan/
  effective-basis/configuration digests; current applicability;
- recorded repository/target, controlled branch, verified pushed head and exact
  PR identity/URL; no credential/header/raw provider response;
- phase/progress, sanitized failure or guard reason and referenced resolution
  operation; reconciliation-required versus known-failed must remain distinct;
- provider observation time and exact repository/PR/branch/head, target head,
  checks/commit-status summaries and mergeability, including unknown/stale;
- exact rendered title/body identity and content version, next refresh/backoff,
  scoped Retry availability and receipt recovery.

The Task title comes from `tasks.title` (`task-records.ts:60`), not from an Agent's
free-form inferred headline. Completion summaries/artifact references come from
the current canonical manifests (`node-completion.ts:80–96`) and effective
applicability, not the latest log or historical result. Render a deterministic
monos Task reference. Re-render current content on the same PR under exact lineage;
never mint a replacement identity because text changed. Freeze the actual payload
for each admitted update and reconcile uncertain updates before replacement.

Keep Overview's local results and existing `ResultInspector` and
`PublicationCandidates`. Add an adjacent remote preparation card: preparing,
waiting for input/change, awaiting access/Runner, reconciling, failed step, or
prepared PR with current head-bound observations. Read failures offer read Retry;
effect Retry is a separate authenticated command on the same operation and goes
through the existing session-bound pending-request journal. Never offer a normal
Prepare PR button. No Accept/Merge/Request Changes placeholder should imply those
next-leaf commands already exist.

Checks pending/failing and mergeability unknown/conflicting are preparation
observations, not new Task states or evidence of delivery success. A green check
for an earlier SHA cannot appear as current pass. A prepared PR remains awaiting
future Owner acceptance; a pushed branch alone never makes COMPLETED. An old
source/scan/permission observation can remain historical, with actions disabled.

Backend durable polling runs without a browser and survives restart. Use bounded
backoff/jitter/rate-limit scheduling and retain the previous observation with
timestamp/staleness instead of inventing success. UI polling reads canonical
facts; it does not own provider synchronization or domain transitions. Maintain
Task/session/selected item keys, AbortSignal plus late-response fences, no-store,
safe React text and existing responsive wrapping. Do not clear the current
inspector/file selection when a provider observation refreshes.

## Recommended focused gates after design freeze

- Real PG: pending/failed input races remote claim; reply clears only its input;
  replied proposal/issue/guidance continues guarding; withdrawal while effects
  settle; dismissed Replan with independent guard; guard count beyond UI page.
- Same result/basis and changed unrelated conversation/control version;
  changed Spec/Plan/candidate/config/mode must revoke new mutation authority.
- after_acceptance plus both clean and overridden local scans: zero remote
  operations/write-token minting while local inspection remains functional.
- Offline REVIEW, missing credentials, bounded provider error/rate limit,
  reconnect/Restart and response loss: exact same operation/branch/PR, no
  speculative duplicate create or force push.
- Cancel before claim, after push admission, after uncertain PR creation and
  after prepared PR: terminal Task, reconciled truth, precise PR closure and branch
  retention; cleanup access failure is retained attention.
- Built SPA current/historical head, old-green/new-pending checks, unknown
  mergeability, input/change attention, same-PR content refresh, exact lost Retry
  receipt recovery, session replacement and late provider-read response. Confirm
  no normal Prepare PR/Accept/Merge action and unchanged local file inspection.

## Verification

Read task PRD and context manifest, relevant architecture paragraphs, accepted
publication/delivery/configuration specs and the anchored current server/Web paths.
Used scoped `git status` and read-only searches/reads only. No implementation or
provider correctness claim is made before design/contract freeze and actual tests.
P1/P2 planning decisions are now resolved by main. This research is ready to inform
design freeze; effect-ordering, cleanup and UI/API contracts must be explicit in
that handoff. Final planning-artifact review and implementation acceptance are
later independent gates. No issue is inferred from code that does not yet exist.
