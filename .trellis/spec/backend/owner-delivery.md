# Exact Owner delivery acceptance

## 1. Scope / Trigger

`owner-delivery-{commands,state,reads,guards,preparation,control,worker}.ts`,
`github-finalization.ts`, migration `0024_owner_delivery.sql` and protected Web
implement exact acceptance and finality. Read [delivery contracts](delivery-contracts.md),
[remote preparation](remote-preparation.md), [candidates](publication-candidates.md)
and [result identities](result-content-reads.md).

Stage A supports complete collections with zero/one modified automatic GitHub
repository. Repository-free and actual no-change results complete locally. Mapped
results remain modified even when publication creates no new commit. Multiple
modified repositories, plain Git and configured `after_acceptance` final delivery
reject before approval consumption. Explicit Request Changes, receipt-backed
revocation and input reconsideration follow [review correction](review-correction.md). No new Task states, Runtime work or Agent acceptance.

## 2. Signatures

```text
POST /v1/owner/tasks/delivery/commands
GET  /v1/owner/tasks/:task_id/delivery?proposal_cursor=...&batch_cursor=...
GET  /v1/owner/tasks/:task_id/delivery/proposals/:proposal_id
GET  /v1/owner/tasks/:task_id/delivery/batches/:operation_id
GET  /v1/owner/tasks/:task_id/delivery/commands/:request_id

OwnerDeliveryCommands(db, hooks).command(token, envelope)
OwnerDeliveryReads(db).task(token, task_id, query)
OwnerDeliveryWorker(db, instance_id, GitHubFinalization).pump()
```

Strict envelope: `schema_version:1,task_id,request_id,name,payload`, optional
transport `expected_control_version`. Exact payload variants:

| Name | Payload |
| --- | --- |
| `prepare_delivery_acceptance` | `basis:{control_version,specification_id,plan_id}` |
| `confirm_delivery_acceptance` | `proposal_id,content_digest` |
| `accept_delivery` | `proposal_id,confirmation_id,content_digest,basis` |
| `retry_delivery` / `cancel_delivery` | `operation_id,content_digest,expected_version` |

Per-action committed receipts return actual proposal/confirmation/batch identities.
Unknown names only Task/request and `status:'unknown'`. Replay precedes terminal/
currentness checks. Generic `confirm_proposal` rejects `accept_delivery`.

Migration 24 adds command receipts, actual proposal/authorization links, immutable
batch/manifests/members/preparation links, merge requests, observations/finality.
Status/version/due/checkpoint are mutable; approved content, admission, confirmation
and cutoff are immutable. Terminal merge status/result/digest/reason cannot change.

## 3. Contracts

### Complete result and actual authority

Build from effective Spec/Plan and every completed member's canonical valid evidence.
Retain original execution attribution and effective basis; do not fabricate carry
IDs. The complete embedded completion equals the stored canonical completion,
including Task, Node, activation and digest. Selected Artifact IDs are distinct
and equal the completion selection, with exact stored metadata. An earlier Attempt within the same valid Node activation
may contribute; preserve each Artifact's own Attempt/revision attribution.
The distinct Git-output resource set equals the complete repository member set,
including no-change. Modified entries bind actual local request/result, source,
candidate, scan, mapping, permission proof and eligible waiver receipts.

Before acceptance the candidate must already bind a verified permission observation
matching complete-scan configuration. Expired credentials can renew that same
fingerprint; first permission establishment cannot change a frozen candidate.

SQL validates actual prepare/confirm/Accept envelopes and committed receipts,
consumed confirmation, complete membership and selected metadata. Missing JSON
uses `IS NOT TRUE`; legacy nullable Git `repository_free` uses canonical
`COALESCE(...,false)`. Count plus membership does not establish distinct completeness.
Upgrade preflight atomically rejects non-null legacy acceptance seams without
manufacturing approval or clearing history.

### Admission, conversation and physical isolation

Message append and Accept serialize on Task control. Earlier unresolved input/work
rejects without consuming confirmation. Receipt, exact batch/current conversation
cutoff, attribution, preparation and formal event commit together. Events/timestamps/
watermarks do not enter the reviewed digest. Resolved unchanged reply-only input
can retain the proposal; admission still records current sequence.

Later chat is reply-only and cannot dispatch Nodes/guidance/requirements/Replan.
Its control version does not invalidate accepted Retry/preparation. Frozen guards
retain real batch authority, current effective source, destination/configuration,
complete scan/waivers and permanent exposure checks. Only canonical reply-only
conversation sources with exact persisted launch/input attribution, empty workspace
reservations and no resource are exempt from physical writer checks. Leases and
unsettled workspace operations remain blockers.

Compatible pending preparation with no claim/possible effect can gain an immutable
batch-operation link. Started/unknown/incompatible operations cannot be adopted.
Ordinary preparation/execution freezes. Every accepted mutation verifies frozen
authority/link before and after token I/O. Actual accepted Retry may wake a linked
definitive pre-effect failure under the original request. Unknown effects retain
the original observation identity.

### Readiness and effect

Supported: classic required checks, App-bound check producers, strict immutable
ancestry and positively observed unprotected branches. Reviews/rulesets/queues/
deployments/signatures/unknown restrictions stay unsupported. Bare protection 404,
aggregate success and `mergeable=true` alone grant no authority.

Collect complete literal candidate and test-merge check/status sets. Any test-merge
evidence selects that whole input; never borrow individual passing candidate
contexts. App-bound legacy statuses stay unknown. Validate identity, producer,
counts and pagination. Each page's actual observation must be at most 15 seconds
old at mutation admission; collection completion cannot restamp pages. Private
checkpoint limit is 8 MiB for four bounded collections; public bounds stay 512 KiB.

Protected effect turn: readiness grant, PR before, protection, rules, merge grant,
repository settings, PR after, PUT: exactly eight calls. Unprotected substitutes
positive `protected:false` branch observation. PR base SHA provides fresh target
brackets; strict compare facts can be reused only for immutable same-base/head.
Head/base/test/policy/config changes discard readiness. No atomic target-base CAS
is claimed. Preserve configured merge/squash/rebase, otherwise first compatible
allowed method in that order. Persist concrete method, complete original request,
claim and possible effect before expected-head PUT. Shared Task/item locking and
SQL ownership exclude preparation/close/merge collisions. No DB transaction spans
provider I/O. Tokens never enter persistence/Agent environment/logs.

### Recovery, Cancel and finality

Validated rejection requires actual Owner Retry. Unknown outcomes use original exact
PR/repository/ref/marker/head reads. Expired claims or open/missing observations
never authorize another PUT or method fallback. Actual final OIDs may differ from
candidate after squash/rebase; 40/64 lowercase hex is accepted consistently.

Post-effect settlement retains valid original observed facts despite later source/
config drift, without granting another read/write credential or mutation. New grants
retain current guards. Immediate finality and Task completion are distinct. Complete
only the current authorized Task after all supported items finalize; emit one
`delivery_completed`. No-change/repository-free need zero provider calls.

Accepted Cancel locks discovered Runners before Task, revokes new effects and stops/
settles actual attempts under workspace guards. Unknown merge ownership suppresses
PR close while original read-only reconciliation continues. Late success records
historical finality/externally-merged cleanup; Task and batch remain cancelled.
Completed rejects new Cancel while committed receipts replay. Revoked batches also
reject Retry/Cancel; their original preparation links never regain ordinary authority.
Worker catch/settlement paths preserve revoked status. Correction preserves PR/ref;
terminal cleanup remains a separate explicit Cancel path.

### Reads and UI

Delivery wire enforces well-formed Unicode and 512 KiB encoded UTF-8. Manifests:
1–256 outputs, at most 256 selected Artifacts/output and 64 repositories. Reject
complete oversize approval; builder reserves 32 KiB for wrappers/progress.
History has 64 summaries/lane and canonical opaque Task/kind/time/ID keyset cursors,
six-microsecond timestamp positions and conditional next fields. Details are exact
selected reads, independent of summary page selection.

Existing Owner cookie/session, Origin and session-header fences apply; no-store/
nosniff. Overview exposes paired batch/cutoff. Web verifies digest/member/source
bindings and retains exact pre-HTTP command journals. Current capability reads stay
independent of older pages and later chat. Logout/session/selection changes fence
late callbacks/receipts. Show unknown readiness and Cancel honestly; further
implementation links to independent Todo Discussion.

## 4. Validation & Error Matrix

| Condition | Required outcome |
| --- | --- |
| Invalid variant/query/Unicode/size | `invalid_input`; no clipped approval |
| Wrong Task/detail/confirmation | `denied_scope`; no authority reuse |
| Different envelope under same ID | `payload_conflict`; retain original |
| Changed basis/capability version | `version_conflict`; no implicit refresh |
| Earlier work/input or unsupported mode | `unmet_precondition`; unconsumed confirmation |
| Missing SQL member/metadata/receipt | Atomic SQL rejection |
| Drifted head/base/policy or stale/partial checks | Wait/refresh/attention; no merge |
| Unknown merge or admitted-effect Cancel | Original read-only recovery; no second PUT |
| Source/config drift after actual success | Retain truth; no new authority |
| No modified items | Local completion; zero provider effects |

## 5. Good / Base / Bad Cases

Good: accept before first push, receive later chat, lose merge reply and restart to
recover the same PR once. Base: repository-free output completes locally. Bad:
duplicate selected Artifact A to omit B, omit a Git repository, or restamp old checks.

## 6. Tests Required

Apply [verification scope](../guides/verification-scope.md). Owning tests cover real
PG receipts/SQL authority, upgrade/preflight, observed Task-lock races, process loss
around COMMIT, cutoff/freeze, nomination/Retry, token-I/O Cancel, shared claims,
readiness age/count/budget, unknown recovery and terminal precedence. Strict wire/
shared Go consumer and built Web checks prove their actual boundaries. One authorized
synthetic GitHub kernel proves current expected-head rejection, protected eight-call
merge and lost-reply/original PR recovery. OAuth synthetic evidence does not prove
installed App issuance, least privilege or installed coordinator delivery; those
remain the later combined installed gate. Reuse unchanged physical/native evidence.

## 7. Wrong vs Correct

```text
Wrong: later chat -> replace approved result -> repeat unknown merge -> revive Cancel
Correct: actual receipt + complete immutable batch/cutoff -> frozen current guards
         -> bounded fresh readiness -> durable possible effect -> original recovery
         -> final fact; Cancel remains terminal
```
