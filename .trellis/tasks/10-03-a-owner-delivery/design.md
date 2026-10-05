# Exact Owner acceptance and GitHub finalization

## Authority and ownership

Read architecture, modules 04/05/06/07 and module 08 before code. Delivery owns
acceptance/provider orchestration; Task owns lifecycle/input serialization. Existing
`delivery_operations` remain immutable local preparation, not batches. No new Task
state, Runtime source, credential file or daemon. Research observations are not
already implemented behavior. Main owns integration; one writer owns shared schemas.

## Commands and reads

Add strict generated `OwnerDeliveryCommand` using existing Owner envelope/IDs/safe
counters/canonical digest schemas and no additional properties per variant:

| Action | Payload |
| --- | --- |
| prepare_delivery_acceptance | basis: TaskBasis |
| confirm_delivery_acceptance | proposal_id, content_digest |
| accept_delivery | proposal_id, confirmation_id, content_digest, basis |
| retry_delivery | operation_id, content_digest, expected_version |
| cancel_delivery | operation_id, content_digest, expected_version |

POST `/v1/owner/tasks/delivery/commands`; protected no-store Task delivery/proposal/
batch/receipt reads. No Agent CLI final acceptance command. Results bind actual
Task/request/action/proposal/confirmation/batch/digest/version per command; committed
admission does not mean merged. Retry/Cancel bind batch progress capability rather
than original Task control version or current conversation sequence. Authenticate
before replay, reject changed request bytes before target lookup, replay committed
receipt before new currentness/terminal checks.

Dedicated confirm rebuilds/validates full current proposal and records exact Owner
envelope/receipt linkage with existing authorization. Generic confirm must reject
Delivery proposals, as for Replan, so it cannot bypass validation. Accept consumes
exact confirmation transactionally. Dialog mount/close/read polling never commands.

## Complete frozen manifest

Versioned `DeliveryAcceptanceManifest` binds Task/effective Spec/Plan IDs/digests,
reviewed basis and complete sorted output/repository membership. Enumerate every
effective plan_nodes activation via canonical completion/source resolution, including
explicit applicable carry. Latest Git completion pump is not an enumerator. Selected
Artifacts bind immutable IDs/digests/attribution. Repository-free completion has no
invented Git ResultReadIdentity.

Repository entries bind explicit no_change/modified, stable item/resource/repository,
original completion/source/digest/retained tree/storage, exact preparation request/
result, candidate/head/tree/parents/fixed target/ref/marker, effective mapped basis,
config/applicable scan/workflow fact/actual eligible waivers and retained publication/
PR proof when present. Freeze deterministic provider metadata from formal facts;
later chat cannot rerender it. Mapping never relabels old source; zero new commits
is not no_change. No-change binds actual terminal not_applicable/no_change result.

Use existing source bounds and an explicit bounded complete manifest. Single schema
owner freezes aggregate collection/byte limits consistent with command/read bounds
and fixtures before consumers. Oversize required membership rejects; never clips.
Keep collections provider-neutral; deliver zero/one modified automatic GitHub item.
Reject unsupported modes before confirmation consumption/batch/write-grant admission.

## Persistence and migration

Migration `0024_owner_delivery.sql` plus registry adds immutable batch authority/
manifest/proposal/confirmation/admission request/basis/cutoff and separate mutable
status/version/attention/due. One live batch per Task. Immutable ordered batch items,
confirmation-command/receipt links, batch-to-remote-operation/request-digest links,
merge request/intent and append-only observations/final facts. Mutable claims and
readiness checkpoints remain separate. Shared item mutation owner fences all lanes.

Task accepted pointer must reference its real batch/Task/cutoff. Input attribution
references same Task batch with sequence above cutoff. Deferred SQL validates actual
Owner envelope/result/proposal/action/content/consumption/admission receipt, immutable
membership and pointer using IS NOT TRUE to reject missing JSON/null. FK/consumed_by
alone is insufficient. Application still validates physical/source/provider guards.

Legacy nonnull acceptance seam values cannot become approval through migration.
Preflight fails with actionable error and no changes rather than clear history or
forge receipts. Stage A has no deployed real acceptance setter. Synthetic tests
explicitly clean/reseed their own fixture; do not weaken constraints to keep old
setters. Test clean install, 23-to-24 and failed preflight rollback.

## Admission and cutoff

Lock authenticated scope/configuration then Task then proposal/authorization/items
in stable order. Plain prepare/confirm/Accept needs no Runner mutation/lock. Cancel
that stops Attempts discovers/locks Runners before Task and revalidates discovery;
never acquire newly discovered Runner under Task. No transaction waits on HTTP/Git.

Require REVIEW, effective Plan/all current valid completed membership and settled
local candidate/applicable scan/waivers; no ordinary unresolved input/planning/Replan/
publication/Node/workspace effect. Modified GitHub candidates must already bind an actual verified permission proof
and its complete-scan configuration fingerprint; missing first observation blocks
admission. Expired proof may refresh only the same fingerprint. This prevents a
first postacceptance proof from changing frozen config/scan. PR/CI may be pending.
Rebuild exact proposal/basis without fresh timestamps, event/watermark counters
or unrelated resolved-reply input sequence in the content digest. Proposal/confirm
events must not bump Task control. A resolved reply-only message can retain reviewed
result/basis; unresolved input or material result drift still blocks.
Consume confirmation, insert immutable batch/items and pending work, set pointer/
current conversation-sequence cutoff and real receipt/event in one transaction.
Empty modified membership completes locally in that transaction; otherwise REVIEW.

Message first commits ordinary unresolved null-attributed input, then Accept rejects
without consumption. Accept first commits cutoff; later message is immutable batch-
attributed reply-only. Later pending/failed/live replies and scratch Planner/Stop
bookkeeping never gate approved delivery or confer execution/change authority.

## Accepted preparation and freeze

Server-owned acceptedRemoteAdmission verifies real batch/receipt/pointer, exact item/
source/candidate/mapping/config/scan/waiver and physical effect owner. Dispatch selects
accepted authority only from persisted operation links. Ignore only later input and
scratch conversation; retain actual Node/workspace writers, predecessor uncertainty,
current App/install/key/repo/profile/channel/storage/scope/config/source/claim guards
before and after token I/O.

Nominate push/create/update only under Task/item locks when exact pending, no possible
mutation/claim/worker/effect owner/reconciliation-only state and all immutable request/
source/basis/candidate/target/scan/waiver/predecessor/provider content match. Link batch
without changing request/ID. Incompatible pending safely revokes via existing guards
or blocks; started/unknown reconciles first. Create stable remote item/exact pending
push if absent using existing deterministic construction and frozen local identity.
Append subsequent exact PR operation links after predecessor settlement; uncertain
POST never repeats. Integrate remote-preparation/access/guards/commands/state sites
identified in backend research, including actual permission checks before/after grant.

Freeze ordinary publication/Retry/override/ensureLocalCandidate and shared Node
reactivation/scheduler/dispatch primitives. Same-fingerprint permission refresh can
authorize frozen candidate without new source/scan or wider profile. Preacceptance
scratch reply cleanup settles conservatively; postacceptance replies do not guard.

## GitHub readiness matrix

Fixed api.github.com/API2022-11-28/current deadlines/body bounds/exact numeric repo.
Keep rich readiness App/draft/merged/final OID separate from informational checks.

| Condition | Decision |
| --- | --- |
| Exact original PR/repo/ref/base/marker/head, open/nondraft | mandatory |
| Unavailable/changed head/identity | unknown or attention; no merge |
| Observed unprotected branch and validated empty applicable rules | supported absence |
| Classic required contexts/checks and strict updates | supported |
| Check success/neutral/skipped; status success | pass only applicable required set |
| Same context has check and status | both must pass |
| App-bound check | actual matching check.app.id |
| App-bound legacy status with unprovable producer | unknown |
| Candidate/base/test merge OIDs | exact scoped applicability; test OID never approved head |
| Linear history | merge disallowed; repo-allowed squash/rebase supported |
| Active rulesets/reviews/queue/deploy/signatures/unknown requirements | unknown/unsupported |
| Bare protection404 or missing rights | unknown, not absence proof |

Implement test-merge applicability: collect complete required check/status sets for
candidate and observed test-merge OID. Choose a whole commit input set: when the
test merge OID carries any check/status evidence, conservatively require the complete
required set on that test OID; no per-context fallback to candidate success. Otherwise
use candidate evidence only after complete observation proves the test set empty.
Ambiguous mixed-source or applicability returns unknown. Bind chosen facts to
head/base/test OIDs and invalidate on bracket drift. Contradictory/insufficient/ambiguous provenance
returns unknown, never head-only shortcut. Strict update compares literal graph and
requires merge-base=current base; no automatic branch update/rebase. Fresh target
brackets are observations, not atomic expected-base CAS (API has none).

Readiness App profile: contents/read, metadata/read, pull_requests/read, checks/read,
statuses/read, administration/read. Merge: contents/write, metadata/read. Reconcile:
contents/read, metadata/read, pull_requests/read. Exact one-repo issuance stays strict.

Allowed-method settings need contents/write. Only after real batch admission issue
minimal merge grant to read settings, before any mutation intent. Freeze configured
preference in manifest, persist concrete selection before first intent: configured
if allowed/compatible or block; unset first allowed/compatible merge,squash,rebase.
Missing settings unknown. Retry retains concrete method; no silent fallback.

## Bounded worker and uncertainty

Eight calls per turn including grants/brackets; 100/page, ten-page cap, stable total/
ETag/exact scope checkpoints. Readiness spans durable staged turns; do not expand
budget. Final protected effect turn: readiness grant, PR before, classic protection,
active branch rules, merge grant, repository settings, PR after, PUT = eight calls.
Unprotected turns use branch protected=false instead of classic protection plus
empty rules; never infer absence from 404. PR base.sha supplies the existing fresh
target bracket. Stage strict ancestry as immutable literal head/base graph proof and
reuse only if both brackets match. Complete check collections must be within
15 seconds at admission, measured from each actual retained-page observation
(never a newly stamped collection-completion time), and bind identical
head/base/test/policy/configuration;
otherwise refresh readiness. Policy/check changes remain GitHub-enforced; unsupported
or bypass-dependent modes cannot qualify. Do not silently add a ninth target-ref read.
Reserve necessary calls before possible effect and refresh final authority/
config/head/base brackets. No DB transaction during HTTP. Cooldown is scheduling,
never absence proof. Shared stable item owner under Task/item locks fences prep/
close/merge; separate unique indexes alone are insufficient.

Persist exact operation/PR/head/method request, claim and possible-effect flag before
PUT `{sha, merge_method}` after credential-I/O and immediate authority recheck. Strict
200 requires merged:true/valid final OID, then append exact verified final fact.
Squash/rebase final OID may differ from candidate. Complete only authorized all-final
batch; retain accepted history/pointer/cutoff.

Validated 403/404/405/409/422 rejection differs from timeout/lost/5xx/invalid body.
Narrow merge classifier preserves generic transport limits. Definitive no-effect
failure permits same-identity new attempt only after established terminal outcome.
Unknown/restart only reads original numeric PR and validates exact identity/head,
merged:true/time/final OID. Open/missing/closed/provisional OID never proves original
PUT cannot finish, so no second PUT. Keep requested method distinct from observed
remote method/actor, which recovered PR truth cannot establish.

## Cancel, correction and UI

Dedicated delivery Cancel atomically revokes new effects and sets Task CANCELLED,
using existing stop ownership/Runner-before-Task locks where needed. Accepted Web
Cancel routes here; legacy cancel consistently rejects/delegates. Do not close PR
while unknown merge remains; reconcile original effect read-only and append late
success without revival/undo. Completion first rejects new Cancel; receipt replay
still first. Next leaf owns Request Changes and append-only restoration of immutable
later-input provenance; no correction action is invented now.

Compose owner-delivery.tsx in Overview, reuse Base UI Dialog/Button, typed API,
TaskIntent/journal and abort/session/query fences. Show actual summary/evidence/public
version with technical disclosure, no mandatory DAG. Explicit prepare/confirm/admit;
local action Accept result, GitHub Accept & Merge. Show frozen batch/cutoff, unknown/
waiting/merge/reconcile/failure/recovery/terminal history. Later input is outside
batch; further execution remains independent Todo Discussion. Pending HTTP is not
acceptance/delivery success.

## Verification and operations

Use verification-scope guide: new real PG authority/race/freeze/Cancel, strict wire,
focused provider cases and current Web interaction/layout. Reuse unchanged upstream
native/push/PR and archived GitHub feasibility only at exact unchanged boundaries.
One marked current-adapter synthetic merge with withheld success can prove one-effect
recovery; no product source and no reuse/reopen old PR4. Live installed App is later
external gate, not inferred from synthetic authority.

Additive transactional migration; failed rollout disables new admission and keeps
original reconciliation/history. Never clear possible effect/undo remote effects as
rollback. Disk loss, atomic target CAS and remote actor attribution are outside claim.
