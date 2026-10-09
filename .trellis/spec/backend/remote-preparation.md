# Automatic GitHub review preparation

## 1. Scope / Trigger

Delivery prepares the exact current settled REVIEW result when a GitHub resource
has `remote_preparation=automatic`. Local candidate preparation remains available
for `after_acceptance`, which requests no remote mutation or write token. This
lane owns no Runtime Attempt, Task state, Specification slot or accepted batch.
Preparation never establishes Accept, merge or Owner confirmation.

Sources: server `remote-preparation{,-access,-commands,-guards,-poll,-reads,-state}.ts`,
`github{,-remote}.ts`, migration `0023_remote_preparation.sql`, Runner
`publication_remote*`, `publication_{credentials,mapping,permission,published,store}.go`,
and Web `remote-preparation.tsx`. Read
[local candidates](publication-candidates.md),
[result identities](result-content-reads.md), [delivery](delivery-contracts.md),
[architecture](../../../ARCHITECTURE.md) and
[invariants](../../../docs/08-principles-and-non-goals.md).

This slice implements one verified original/published public parent. Additional
integration-target transport remains deferred. Cross-Runner transfer, permanent
disk-loss recovery, plain-Git remote delivery and after-acceptance remote effects
are outside this contract.

## 2. Signatures

```text
GET  /v1/owner/tasks/:task_id/remote-preparation?source_operation_id=...&cursor=...
GET  /v1/owner/tasks/:task_id/remote-preparation/:item_id
GET  /v1/owner/tasks/:task_id/remote-preparation/:item_id/checks/:observation_id?cursor=...
POST /v1/owner/tasks/remote-preparation/commands
GET  /v1/owner/tasks/:task_id/remote-preparation/commands/:request_id
POST /v1/runner/publication-operations/:operation_id/permission
POST /v1/runner/remote-preparation/:operation_id/access

RemotePreparation(db, instanceId, provider).pump()
RemotePreparation.pending(runnerId, incarnation, supported) -> Frame[]
RemotePreparation.finish(runnerId, incarnation, result) -> PublicationPushAck?
```

Existing Owner cookie/session authentication protects all reads and commands.
Runner HTTP uses owning bearer identity and exact current channel/incarnation.
Reads and credential HTTP are no-store; reads retain nosniff. Permission/access
request bodies are at most 16 KiB. Ready advertises
`remote_preparation_modes:["github_review_v1"]`. Dedicated WSS frames are
`publication_push`, `publication_push_result`, `publication_push_ack`, each at
most 512 KiB. They do not consume Start/effect/Attempt capacity.

Installation scheduling before push admission returns HTTP 429 with typed
`rate_limited` and bounded `Retry-After`. Reserve the provider slot and claim the
push atomically. A normal spacing wait leaves the original operation pending,
issues no push token and creates no possible-effect or terminal blocked result.
Runner consumes the typed response and retries that original operation after the
wait; actual access denial retains its separate before-start result semantics.

Migration 23 adds permission observations, remote items/operations/observations,
published-result mappings, immediate published exposures, command receipts and
installation cooldowns. DB triggers protect immutable identities, settled facts,
observations, mappings, exposures and receipts. One active mutation owner per
item is necessary; settled uncertain pushes also require item-level fencing.

## 3. Contracts

### Exact scope and new-effect admission

An item permanently binds Task/resource/repository/Runner/storage, fixed target,
`refs/heads/monos/task/<Task UUID>/<resource ID>` and
`<!-- monos-delivery-item:<item UUID> -->`. Numeric repository IDs must be
canonical positive safe decimal integers before credential issuance. An existing
PR also binds exact numeric PR identity, repository, head ref, base ref and marker.
Closed/merged/foreign/ambiguous reviews never authorize replacement or reopening.
The resource segment uses the existing `Id` alphabet `[A-Za-z0-9_-]` and length
`1..128`; it is not restricted to UUIDs. Shared `DeliveryRef` validation preserves
the Task segment constraint and fixed namespace. Producers derive the exact ref
from Task/resource identity, and database/Runner guards compare that same ref.

Before every ordinary mutation, and again after token I/O, require settled REVIEW,
exact current original result/carry and effective Spec/Plan, finalized local
candidate and complete current scan, exact configuration and permission context,
actual eligible Owner waiver receipts, no pending input/proposal/issue/guidance,
no unreleased physical workspace/process or admitted predecessor effect, and no
known published exposure. Task/config/item locks protect admission; no transaction
spans Runner, Git or provider I/O. Late historical success retains evidence without
restoring current source, ordinary retry, Task state or Owner authority.

Every new scan records the actual changed publication-range workflow fact.
`PublicationScanSummary.workflow_changes` is optional only for immutable legacy
bytes; a new remote admission requires explicit boolean in an exact complete scan.
Missing metadata requires a fresh real scan. Unknown scope starts with minimal
contents permission; an actual workflow change requires the workflows-write grant
and a matching refreshed scan context. Finding absence and old grants do not
establish this fact. Unchanged final workflows and zero-new-commit mappings are
false, while introduced/modified/deleted workflow versions in the public range
are true. An exact complete `workflow_changes=false` scan may use the current
least-privilege proof without `workflows:write`, whose scan configuration records
`workflow_write=unknown`. Runner still validates the proof and scan identities;
only actual workflow changes require `workflow_write=allowed` and a matching
write grant. Unknown permission never substitutes for a missing workflow-change
fact. Final-tree policy scanning still applies.

### Public ancestry, result mapping and immutable recovery

Original retained export/ref/tree and original journal/open/cache/service pin
remain the result authority. Do not import private Agent commits, parents or
messages into the service-owned public object store. Import verified public parent
graphs and the exact result tree. Original exports and attribution remain intact.
Controlled metadata/date/candidate CAS remain fixed across permission/scan retries.

A published parent requires the original private push intent, request/result
digests, candidate manifest, exact observed delivery ref/head, ACK and physical
absence evidence. A new source generation can reuse that public proof through its
own verified source identity. Head presence alone cannot substitute for provenance.
Reverting to the original base after publication is a new fast-forward correction.

Same-tree new-source mapping retains the old candidate manifest, head and original
source. It appends a `PublishedResultMapping` over the new source/effective basis,
and runs a new scan against the verified published baseline. The old manifest is
never relabeled. Mapped Owner waiver selections require the exact mapping digest;
old-source receipts do not carry into a new scan or basis.

Private item flock and fsynced immutable intent precede the possible-effect marker
and process spawn. Fixed Git push is nonforce, single-ref, bounded and service
owned. A fixed pre-push hook validates destination, exact candidate and advertised
old head; receiver CAS remains authoritative. No repository hook, arbitrary
executable/ref/URL, Git filter or private ancestry is accepted.

Persist actual worker UID, boot/birth identity and process group. Lost flock,
context cancellation or Runner death do not prove absence. Bounded group recovery
must match identity and establish physical group absence. Missing/tampered identity,
birth reuse and spawn-to-persistence gaps retain attention without unsafe signals.
Started uncertainty with expected/absent/unavailable ref is reconciliation only,
never permission to repeat push. An unacknowledged result replays exactly.

An ACKed `reconciliation_required` result, ACK and settled operation remain
immutable. Backend may append exact original-operation ref/published observations
only when the original result proves worker absence. Retain the first valid
resolution. Runner independently observes the same original ref and appends a
private resolution against its original intent/result/ACK before later parent use.
Do not overwrite the old result or invent workspace-open provenance.

### Credentials, provider operations and bounded checks

Production App issuance signs RS256 and requests one exact selected repository and
the operation's minimal permissions. Preserve compatibility with existing encrypted
App keys. Scope/fingerprint binds repository, App, installation, key, configuration
and exact permission profile. Observation ID/time/expiry may refresh; the stable
authority fingerprint does not change merely with renewal. Validate calendar dates
and sufficient remaining expiry before use. Tokens stay in RAM/anonymous credential
pipe; never in DB, WSS, journal, logs, files, argv, URLs, Git config or Agent env.

Provider requests use fixed `https://api.github.com`, redirect error, 10-second
deadline, 1 MiB UTF-8 JSON response bound and safe finite errors. Each turn budgets
8 calls including issuance and before/after brackets. Collections use 100 entries
per page and at most 10 pages. Persist scoped progress across turns; never advertise
partial collections as complete. ETag/cache reuse binds exact scope and page.
Check-run pages must have the cardinality implied by `total_count`; every resumed
page must retain the same total. Missing rows reject completion; changed totals
discard the partial checkpoint for a fresh collection.

Persist PR intent before POST/PATCH. A lost create response reconciles only through
complete exact lookup. Zero or ambiguous matches never authorize a second POST.
Lost metadata update resolves by exact PR/head/content digest. Deterministic title
is at most 256 codepoints; body at most 64 KiB, using safe Task/completion summary
and fixed references. Finite credential redaction applies; private history,
conversations and artifacts are not provider metadata.

Checks/statuses and mergeability bind literal candidate head, current base and
before/after review brackets. Only complete collections with unchanged brackets
become immutable current observations. No-checks, incomplete, stale, pending,
failure, neutral, skipped, cancelled and unknown are distinct. Required-check and
branch-protection readiness remain unknown until the Owner delivery slice.
Normal polling is 15 seconds; unknown mergeability uses 5/10/30 seconds. Errors
use bounded jitter/backoff. Installation spacing is at least one second. Primary
limits use Retry-After/reset; secondary limits without them wait at least one
minute. Retry cannot bypass persisted cooldown.

Every exact published proof atomically retains credential exposure facts from its
scan, including locally waived ordinary credential findings. This permanent item
guard blocks subsequent ordinary effects, including PR creation. Deletion, clean
scans, mappings and waivers cannot clear it; no remediation setter exists here.

### Retry, cancellation and Owner projections

The only command is `retry_remote_preparation`, with operation ID, immutable
operation digest and expected version. Recover an existing request receipt before
new-effect staleness checks. Committed receipts name the actual operation ID,
digest and version. Never manufacture another request after unknown delivery.

A blocked push with `push_started=false` and proven worker absence may admit a new
operation only through actual Owner Retry and fresh ordinary guards. Started or
possibly mutated effects retain their original identity and observation path.
The automatic pump cannot replace a blocked operation merely to retry it.

An accepted preparation revoked by explicit review correction can be replaced by
a fresh operation ID after ordinary/current or newly accepted guards pass. Require
the immutable old link, actual batch revocation, no possible effect and no claim;
never relink or reactivate its old ID. See [review correction](review-correction.md).
An unsent revoked push has no Runner journal to settle. A previously sent revoked
push resumes its original frame solely to finish its no-effect journal. Write access
stays denied. `finish` accepts only exact original request/result scope, authenticated
current Runner, `push_started=false`, worker absence and no claim/effect/mutation.
It appends `{revoked_push_result: PublicationPushResult}` as an immutable `ref`
observation and returns the exact ACK; conflicting results reject. The revoked row
and publication proof stay unchanged. Reconnection may have a newer incarnation.
Do not send a successor for that item until this original result is retained:
the Go successor guard requires the original result/absence/ACK, and sending a
new intent before the old result exists can create mutual predecessor waits.

Both Task Cancel paths durably revoke ordinary admission, reconcile admitted
effects, then close only the exact owned undelivered PR. Retain its branch. Missing
access or uncertain cleanup stays visible with scoped Retry; terminal Task never
revives. A mode flip does not implicitly close a PR. Spec/Replan/guidance settlement
waits for admitted remote quiescence without borrowing their owning slots.

History contains one row per immutable remote operation, ordered by created time
then ID. Source filters bind the original preparation's source operation. A tagged
local-only fallback is allowed only while that item has no remote operation.
History pages hold at most 32 rows; checks pages at most 64 entries; encoded reads
are at most 512 KiB. Canonical cursors bind Task/source/row kind/exact position or
Task/item/check observation. Task FOR SHARE prevents mixed canonical applicability.

Web keys history by item and operation, retains the selected historical bytes,
and independently fetches latest canonical applicability. Ordinary actions require
fresh exact scope/version plus current REVIEW and matching overview Spec/Plan.
Original-effect reconciliation and terminal cleanup use explicit separate backend
capabilities. Session replacement/logout/selection change fence late responses and
pending receipts. A historical candidate, old successful check or current-looking
cached row never becomes new authority.

## 4. Validation & Error Matrix

| Condition | Required outcome |
| --- | --- |
| Invalid strict schema/query/cursor/size | invalid_input before effect admission |
| Crossed Task/item/operation/repository scope | denied_scope; no token/effect |
| Revoked Owner or stale Runner incarnation | unauthorized / stale_execution |
| Conflicting immutable request/result/receipt | payload_conflict; retained original |
| Current source/basis/config/mode/input changed | Ordinary effect paused; history remains |
| Incomplete/missing workflow fact or grant | Fresh scan/permission required; no guessed authority |
| Missing ACK/birth/absence or started uncertain ref | Original reconciliation attention; no repeated push |
| Lost POST and zero/ambiguous matches | Retain possible-publication attention; no second POST |
| Foreign/closed/merged PR | Retain identity and truthful state; no replacement/reopen/merge |
| Stale/partial/empty checks | Distinct stale/incomplete/no_checks; not passing readiness |
| Provider limit | Persist cooldown; Retry respects it |
| Installation spacing before claim | Typed scheduling wait; same pending operation, no token/effect/result |
| Published credential fact, even waived | Permanent ordinary-effect guard |
| Cancel with missing access/uncertain predecessor | Visible cleanup attention; terminal Task retained |
| Deferred mode | Local-only preparation; zero remote mutation/write-token request |

## 5. Good / Base / Bad Cases

Good: a withheld successful PR-create response resolves to one exact review;
correction fast-forwards the stable branch and updates that same PR. Base: a clean
scan and complete no-checks observation remain inspection evidence, with required
readiness unknown. Bad: absence after a started push triggers another push; a
locally waived credential becomes published without an immediate exposure guard;
a fresh cancelled overview leaves cached ordinary Retry enabled.

## 6. Tests Required

Apply [verification scope and stopping](../guides/verification-scope.md). Select
affected contract claims and reuse valid evidence; this list is not a repeated
full-suite checklist for documentation, handoffs or unrelated fixes.

- Shared TS/Go: strict new wire/HTTP/read/command/mapping/proof payloads, optional
  legacy workflow bytes and explicit modern fact; generation and consumer gates.
- Actual PostgreSQL: migration 22→23 and immutable rows, current admission and
  token-I/O races, original uncertain resolution, immediate waived exposure,
  receipt replay, history scope, Cancel/revision quiescence and bounded polling.
  For review revocation, cover both unsent and sent pregrant push: zero write grants,
  original result/ACK replay after reconnect, conflicting replay rejection and
  successor dispatch ordering without restoring revoked authority.
- Physical Git/journal/process: public-parent exclusion, FF/CAS, same-tree mapping
  and real revert, actual Runner death/birth/group recovery, immutable result/ACK/
  resolution, fresh permission context and anonymous credential boundaries.
- Native Linux where claimed: current-source CGO/builds and service-owned actual
  Git, distinct execution UID read/write denial. A synthetic public-data receiver
  may be0755 behind the fixture's private0700 root; service-private paths remain
  private. Report this fixture exception rather than changing evidence.
- Authorized marked synthetic GitHub: literal stable branch, lost-create response
  recovery, same-PR correction/head-bound checks and owned closure/retained branch.
  OAuth-injected kernel evidence does not prove production live App issuance or
  an installed coordinator. Missing App configuration remains a visible gate.
- Built SPA: scoped current/history/reconciliation/cleanup Retry, exact receipt and
  session fences with preserved local inspection. Inspect representative distinct
  desktop/mobile layouts; equivalent reason variants reuse those images.

## 7. Wrong vs Correct

```text
Wrong: cached latest worktree + broad token -> force push -> retry unknown POST
       -> old checks pass -> cancellation resets Task -> prose acceptance
Correct: current exact result + immutable public provenance + complete fresh scan
         + precise Owner receipts/permission/guards -> durable exact nonforce effect
         -> observe original uncertainty -> same PR/current-head evidence
         -> owned Cancel closure with branch retained; Owner acceptance stays separate
```
