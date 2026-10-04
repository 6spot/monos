# Remote preparation shared contract

2026-10-04. Active task: `10-03-a-remote-preparation`.

This freezes step 2 for main review. The schema, generated TS/Go/OpenAPI,
shared validation/fixtures and migration 23 are implemented. Server coordinator,
provider, routes and consumers described below are the implementation contract;
they are not claimed operational by this freeze. Main releases dependent writers.
No provider, host installation, source push, acceptance or merge occurred.

## Authoritative representation and bounds

`packages/protocol/schemas/v1/contracts.json` remains the sole template. All roots
are exported from `packages/protocol/src/index.ts`; browser validation imports
`src/validation.ts`. Go types are `monos.local/protocol`, shared validation is
`runner/internal/wire.Validate/Decode/CanonicalRaw`. Generated representations
require validation before interpreting optional fields; schema conditionals and
domain checks supply authority, not Go pointers or TS interfaces.

New public roots: `PublicationPermissionGrants`, `PublicationPermissionProof`,
`PublicationPermissionRequest`, `PublicationPermissionResult`,
`PublicationRefObservation`, `PublicationPublishedProof`, `PublishedResultMapping`,
`PublicationOverrideSelection`, `PublicationOverrideProof`,
`PublicationPushRequest`, `PublicationPushResult`, `PublicationPushAck`,
`PublicationAccessRequest`, `PublicationAccessResult`, `PublicationExposure`,
`RemotePreparationOperation`, `RemotePreparationReview`, `RemotePreparationCheck`,
`RemotePreparationChecks`, `RemotePreparationRecord`, `RemotePreparationQuery`,
`RemotePreparationPage`, `RemotePreparationChecksQuery`,
`RemotePreparationChecksPage`, `RemotePreparationCommand`,
`RemotePreparationCommandResult`, `RemotePreparationProviderRequest`,
`RemotePreparationContent`.

The generated TS/Go name for schema `PublicationPushAck` is
**`PublicationPushACK`**. Narrow nested generated prepared types are
`PublicationPushRequestPrepared` and `RemotePreparationProviderRequestPrepared`;
decode/validate those as part of the full request, rather than casting unchecked
historical results. `expected_head` is required and nullable; Go uses `*string`
without `omitempty`, preserving explicit JSON `null` for an absent initial ref.

Every new publication/published-result/remote root and complete WSS publication
frame is at most **512 KiB encoded UTF-8**. Access and permission HTTP roots are
at most **16 KiB**. Each path/baseline path is at most **4096 UTF-8 bytes** and
well-formed Unicode. Metadata title is at most 256 code points, body at most
64 KiB raw UTF-8; encoding escaping still counts toward the outer budget.
Producers and HTTP/WSS ingress enforce actual transport bytes before parsing;
TS validates encoded object bytes, Go additionally validates original raw bytes.
No access token may enter WSS, SQLite, PG, receipts, logs, URL or child argv.

Original scan budgets remain: policy 50 MiB, provider hard limit strictly over
100 MiB, physical scan 128 MiB, unique blobs aggregate 512 MiB, 256 commits,
8192 paths per tree, 32768 visited versions, 4096 findings, 8 MiB evidence,
120 seconds. Coverage paths is the union of visited paths, not the per-tree cap;
paths must be at most versions. Findings pages carry at most 64 facts and whole
frames obey 512 KiB. Empty canonical findings are two bytes; configuration
evidence minimum remains 2. Interrupted physical reads retain the original
operation; terminal incomplete remains immutable and explicit Retry creates a
new scan run over the same construction.

## Dedicated Runner lane

Ready adds optional `remote_preparation_modes:["github_review_v1"]`; absent
capability means unsupported. Existing Ready/Start/effect/log frames retain their
meaning. Strict one-payload frames are:

| Type | Payload | Required framing |
| --- | --- | --- |
| `publication_push` | `PublicationPushRequest` | schema 1, current incarnation |
| `publication_push_result` | `PublicationPushResult` | schema 1, current incarnation |
| `publication_push_ack` | `PublicationPushACK` | schema 1, current incarnation |

This is durable Delivery work, not an Attempt or Runtime operation. Request
contains operation/item/Task/resource/Runner/storage/repository IDs, fixed URL,
ref/target, the exact local preparation request and complete prepared result,
result digest, actual override receipts, permission proof/digest, workflow-change
flag, required nullable expected head and paired optional prior published proof.
Only `prepared` results can push. A mapped result has no new head to push.

Result binds original operation/request/item/ref/candidate head/manifest digest,
typed observation/digest, `push_started`, `worker_absent:true`, status and safe
reason. Published requires a present observation; backend additionally requires
its exact head equal the candidate and all scope fields equal the admitted
request. `blocked` and `reconciliation_required` require a reason. Published
forbids one. ACK binds operation/request/item/result digest and only follows
atomic verified settlement. Replayed exact results recover the same ACK; changed
bytes conflict. Disconnect/timeout alone cannot settle worker absence.

Ref observations are `present` with head, `absent` without head/reason, or
`unavailable` with typed reason and no head. Absent before an admitted effect is
not absence after uncertainty. An exact candidate ref settles published without
repeating push. An uncertain effect with expected/absent/unavailable or any
unexpected head retains reconciliation attention and blocks successor writes.

### Append-only resolution after an immutable uncertain result

An ACKed reconciliation_required result remains terminal and byte-identical forever;
its remote operation row, result_digest and ACK never change. A later exact match
is not another publication_push_result or push attempt. The backend fixed-host
provider performs authenticated read-only observation of that operation's exact
numeric repository and literal delivery ref, under the retained item scope and
installation cooldown. Only a present head equal to the original candidate, with
the original result proving worker_absent=true and all admitted request/manifest/
scope digests verified, resolves it. Absent/unavailable/unexpected heads preserve
uncertainty. A timeout, lease expiry or absent goroutine cannot supply this proof.

In one item-locked transaction, append a kind=ref observation and a kind=published
PublicationPublishedProof to remote_preparation_observations, both linked to the
ORIGINAL operation. The proof retains the original request_digest and terminal
result_digest, but embeds the NEW independently obtained exact ref observation
and its digest. Pin the first valid published resolution for an operation; replay
recovers that same proof rather than creating a replacement authority. Update the
item's last_published_proof/digest and append immediate credential exposures in
that transaction. Do not update the settled operation. Unresolved possibly-mutated
terminal results remain an explicit item-level successor/quiescence guard even
though the SQL active-operation index excludes settled rows. A resolved proof
removes only that operation's uncertainty guard, never Task/input/exposure guards.
Cancel may then close an exact owned PR; it never revives ordinary admission.

The existing authenticated local PublicationPrepareRequest.published/published_digest
transports this retained resolution to Runner when a subsequent local preparation
needs a published parent or same-tree mapping. No new WSS result/ACK or token-bearing
transport is added. Runner loads its private original push intent, canonical
terminal result and ACK, verifies every original request/result/candidate/scope
binding, worker absence and the incoming full proof/digest. When that original
result is reconciliation_required, it additionally obtains observe-only access
for the ORIGINAL remote operation and independently observes the exact ref/head,
then atomically retains the validated resolution in its service-owned private
journal alongside (not over) the original result. Failure/unavailable/mismatched
ref stays incomplete without construction or push. The retained original prepared
public object graph supplies tree/parent verification; mere OID presence does not.
Later published-parent verification loads this retained resolution and its original
result digest; it does not demand original result.status=published. Direct published
results still follow their original exact-result proof path. The backend cannot
make a locally missing intent/result/ACK or unresolved live worker trustworthy by
sending a proof. Actual PG and Runner tests must retain uncertain result bytes/ACK,
resolve the same operation, preserve exposures, and construct/map a new source
without another push of the resolved candidate.

## Published parent and same-tree mapping

`PublicationParent.kind` is `materialization|target|published`. Original variants
require workspace/outcome/original observation operation/digest and forbid public
proof fields. Published requires full `PublicationPublishedProof` plus digest and
forbids those original-open fields. Common fields are kind/commit/repository
identity. Verify published commit equals candidate head and exact Task/resource/
Runner/storage/repository/item/ref lineage; historical generation/activation need
not equal current ones. Never forge an original `open_workspace` outcome.

Published proof contains original push operation/request/**result digest**,
scope/ref, immutable full candidate manifest/digest, exact ref observation/digest.
It is derived from the canonical admitted request and settled push result. Push
result does not contain the proof, so no digest cycle exists. The trusted service
journal and service-owned public object store retain it; original completion
export is never repaired or substituted. First production candidate still uses
the original verified materialization base. No integration-target transport is
introduced by this leaf.

`PublicationPrepareRequest` optionally carries paired `published/published_digest`.
Its construction remains an immutable intent. If source tree equals the verified
last published candidate tree, Runner returns `PublicationResult.status=mapped`
with the **old candidate manifest unchanged**, new request-bound scan, mapping and
mapping digest. Provisional construction is unused; its presence is not a claim
that objects were constructed or pushed. If trees differ, parent the new candidate
on the exact published head. Reverting to the original base after a published
modification therefore remains a real correction, not `not_applicable`.

`PublishedResultMapping` binds mapping ID (the preparation operation ID), original
request digest, existing item, full NEW source/digest and effective basis/digest,
full published proof/digest, old manifest digest/reused head, result tree and
CURRENT configuration digest. Verify all these equal the request and proof,
source tree equals old candidate tree, candidate equals proof manifest, and the
new scan ID/configuration belongs to the current operation. Scan baseline/range
comes from the current request's verified published head, even though the returned
old manifest parents remain unchanged. There are zero newly reachable commits
in the same-tree case, but the complete final-tree scan still executes.

Database settlement does not alter immutable `delivery_operations.candidate_id`
(the provisional intent). `published_result_mappings` records the actual old
candidate separately; `publication_scans.candidate_id` points to that candidate
and `operation_id` to the NEW request. Reads, finding selection, latest scan and
override admission resolve via scan operation and mapping, never via the old
`publication_candidates.source_operation_id` as current authority.

`PublicationRecord` adds paired mapping fields and `mapped` status. Its source,
effective basis, scan/config/current flags are new; candidate source/parents stay
old. Web permits differing candidate/record source digests only after exact
mapping verification. History never relabels an old manifest or scan as current.

`PublicationOverrideSelection` and prepare/apply `PublicationCommand.payload`
gain optional **`mapping_digest`**. Domain admission requires exact mapping digest
for mapped scans and absence for ordinary scans. Confirmation loads the same
prepared immutable selection. Receipt selection digest binds candidate manifest,
NEW effective basis, NEW scan digest, sorted unique finding IDs and mapping digest.
Old ordinary command bytes/digests remain unchanged; old receipts cannot authorize
a new mapped scan. Wrong/omitted mapped digest is a domain conflict, not a schema
claim of current authority. Actual prepare→confirm→apply commands remain required.

## Permission bootstrap and ephemeral access

| HTTP route | Request | Response |
| --- | --- | --- |
| `POST /v1/runner/publication-operations/{operation_id}/permission` | `PublicationPermissionRequest` | `PublicationPermissionResult` |
| `POST /v1/runner/remote-preparation/{operation_id}/access` | `PublicationAccessRequest` | `PublicationAccessResult` |

Both use existing Runner authentication, exact operation ownership/request digest
and current incarnation; no-store and 16 KiB bound. Permission request has schema/
incarnation/request digest. Response binds operation/request and proof/digest;
it grants no push authority or token. Access additionally carries purpose
`observe|push` and attempt ID; response echoes operation/request/item/attempt/
purpose/URL/repository/ref/candidate/nullable expected head and ephemeral
`github_installation` authentication. Observe forbids write claim and proof.
Push requires claim ID/expiry and verified permission proof/digest. Backend saves
write ownership before returning a token and rechecks admission after token I/O.

Before full scan eligibility, the automatic permission observer may obtain a
minimal exact-repository App grant under current source/config/input guards. It
performs no repository write. This avoids workflow-unknown finding → no remote
admission → no proof deadlock. Persist safe proof, then create a new scan run over
the same immutable construction when scan configuration changes. The configuration
builder reads verified retained proof, rather than always returning unknown.

Proof binds resource/repository identity and numeric ID/App/installation/key,
configuration fingerprint, exact granted contents-write/metadata-read and optional
workflows-write, observation/expiry. Stable permission fingerprint is
`H({configuration_fingerprint,repository_id,permissions})`; it excludes expiry and
observation ID. Configuration fingerprint binds exact credential configuration
and repository scope. Missing workflows-write cannot authorize workflow changes.
Fresh proof on an unchanged grant can refresh at the request-bound HTTPS endpoint;
changed scope/grants fails that request context and schedules a new current scan.
Runtime verifies valid times and at least 30 seconds expiry safety, not just the
schema timestamp pattern.

Existing workspace contents-read issuance and API version `2022-11-28` stay intact.
Production profiles: observation/push contents-write (workflows-write only if
needed); PR mutation pull_requests-write plus required contents-read/metadata-read;
poll contents/PR/checks/statuses-read. Strict token response verifies one selected
exact repository, requested permissions and expiry; no anonymous write fallback.

The provider constructor will accept a narrow **ephemeral grant acquisition**
dependency for tests, alongside the existing fixed-host HTTP fetch dependency.
It accepts exact repository/scope/profile and returns token/expiry/verified grant
facts in memory. It does not accept an arbitrary API URL or production fixture
flag. Main's native OAuth injection is explicitly kernel evidence, not App JWT,
installation selection or production grant evidence. No test token persistence.

## Immediate public exposure guard

On exact push reconciliation, atomically derive `PublicationExposure` for every
credential-pattern finding in the exact published candidate scan, even if it had
a genuine local eligible override. Exposure ID is
`H({item_id,published_proof_digest,finding_id})`; safe fact stores scope/proof/
manifest/finding/published head/commit/blob/content digest/rule/sanitized path and
ordinal. No match bytes or matching filename hash are public. Existing finite
credential rules/path redaction validation still applies before persistence.

`remote_published_exposures` is append-only. Known exposure projection unions
distinct safe blob/content/rule attribution with existing `published_credential`
history scoped to exact Task/resource/repository/item. A later clean/deleted or
mapped result cannot clear it. The next ordinary effect, **including PR create or
update**, blocks and reports remediation. Exact reconciliation and narrowly scoped
Cancel close remain possible. No waiver/remediation setter is introduced.

Real PG verification after backend implementation must prove waived credential →
published proof → positive guard → no PR POST, and clean/mapped later guard retention.
The freeze does not claim that scenario already passed.

## Owner reads, Retry and provider facts

| Method and path | Input/output |
| --- | --- |
| `GET /v1/owner/tasks/{task_id}/remote-preparation` | `RemotePreparationQuery` → `RemotePreparationPage` |
| `GET /v1/owner/tasks/{task_id}/remote-preparation/{item_id}` | `RemotePreparationRecord` |
| `GET /v1/owner/tasks/{task_id}/remote-preparation/{item_id}/checks/{observation_id}` | `RemotePreparationChecksQuery` → `RemotePreparationChecksPage` |
| `POST /v1/owner/tasks/remote-preparation/commands` | `RemotePreparationCommand` → `RemotePreparationCommandResult` |
| `GET /v1/owner/tasks/{task_id}/remote-preparation/commands/{request_id}` | original `RemotePreparationCommandResult` |

List one row per immutable remote operation, ordered by operation.created_at DESC
then operation.id DESC. Source filtering uses request.preparation.source.operation_id.
The canonical cursor binds Task/source, row kind and the exact stable operation
position. A tagged latest applicable local-only fallback row appears once per item
ONLY when that item has no remote operation. Web row, selection and query identity
bind item_id plus operation_id (or the tagged fallback). Latest-item detail must
never replace selected historical content; it independently fences cached ordinary
and cleanup Retry. Historical operation rows have current=false even when source
and head match. Existing history remains visible after mode changes.

Page limit 32, whole response at most 512 KiB. Detail is exact Task/item scoped;
Task FOR SHARE pins current applicability.
Checks page binds item/immutable observation/head/base/time, at most 64 entries,
cursor cannot switch observation. Historical facts remain readable with truthful
current/stale/time flags, never represented as current authority.

Records include source/effective basis/candidate/scan digest, optional exact mapping
and published proof, operation ID/request digest/version/kind/state/physical flags,
stable review identity, checks summary, mode/status/reason/cooldown and separate
`current`, `scan_applicable`, `retry_allowed`, `cleanup_allowed`,
`read_retry_allowed`, `known_public_exposure_count`. `after_acceptance` projects
local_only and causes zero new remote operations/write-token requests. Existing
terminal cleanup remains visible. No preparing candidate means local inspector
continues to show its original preparation; no fictional remote item is admitted.

Only command is `retry_remote_preparation`, payload operation ID/request digest
(`operation_digest`) and expected version. Committed receipt returns **actual**
operation ID/**`operation_digest`**/**`operation_version`** (digest is the immutable request digest); unknown returns schema/Task/request ID
only. Family URL suffix is `remote-preparation`. Check original receipt on response
loss before generating another request. Retry cannot bypass cooldown, input,
exposure or possible-effect uncertainty; it wakes original-operation read-only reconciliation for interrupted/started/unknown
effects. Only an exact immutable terminal blocked result with push_started=false,
worker_absent=true and fresh admission permits actual Owner Retry to create a NEW
operation ID/request digest over the same candidate/ref/expected published parent.
Preserve the old result; the automatic pump cannot replace this blocked context
without the real receipt. Cleanup Retry checks terminal Task
scope and exact owned PR, not ordinary REVIEW authority.

Stable branch is `refs/heads/monos/task/<Task UUID>/<resource UUID>`; marker is
`<!-- monos-delivery-item:<item UUID> -->`. Review identity binds exact numeric repo
and PR ID/number, literal head/base refs and marker. PR IDs assign once. Immutable
provider request kinds are create_pr/update_pr/close_pr; all carry exact local
request/result and receipts. Create has content and no review; update has both;
close has exact review and no content. Prepared may be prepared or mapped, never
failed/not_applicable. Runtime enforces head/proof/current guard separately.

## Durable polling and uncertainty

Fixed `https://api.github.com` and canonical GitHub Git HTTPS only; no redirects.
Per HTTP request: 10 seconds, 1 MiB response body, 100 records/page. Maximum
**10 pages per collection and 8 provider calls per coordinator turn** (including grant issuance and PR brackets). Progress
persists in `remote_preparation_items.poll_progress`: scope/config fingerprint,
PR identity/head/base, initial bracket, next collection/page, safe staged facts,
counts/digests and read timestamps. A turn stopping at 8 calls saves incomplete
progress and resumes that exact scope on a later turn. It does not publish partial
all-pass. Both collections completed within bounds plus final PR/head/base bracket
produce one immutable checks observation. Scope change discards staging and starts
a new observation; a tenth page still needing continuation yields terminal
incomplete for that observation. Retained old complete observation becomes stale
while unavailable/new head is incomplete. Every saved stage obeys bounded counts
and bytes; staging is safe typed data, never raw provider body/token.

Checks aggregate distinguishes pending/success/failure/no_checks/unknown/incomplete.
`complete:false` cannot be success/current; stale cannot be current. Each check
binds literal head, provider ID, kind and bounded name/conclusion. Required checks
is always unknown in this leaf. Neutral/skipped/cancelled never silently mean
required all-pass. Polling runs without Web: normal 15 seconds, pending mergeability
5→10→30 seconds, transient jitter backoff at most 5 minutes. Installation cooldown
uses spacing, primary reset/Retry-After and secondary at least 60 seconds, which
Owner Retry cannot bypass. ETag identity binds repo/head/base/query/config and a
304 retains only corresponding typed facts.

Lost create response reconciles exact complete repo/head/base/marker lookup; zero
or ambiguous matches after started create never authorizes another POST. Lost
PATCH settles only exact intended immutable content digest, otherwise attention.
Manually closed/merged PR keeps identity, no replacement/reopen/merge. Cancel
reconciles admitted effects then closes exact undelivered owned open PR, retains
branch; lost close reconciles exact closed state. Denied cleanup is durable.

## Backend implementation signatures and ownership

These names are the planned concrete internal server API, not additional public
wire shapes. All implementations are backend-owned; no generic effect engine.

- `remote-preparation.ts`: `RemotePreparation(db,instanceId,provider)`,
  `pump():Promise<void>`, `pending(runnerId,incarnation,supported):Promise<Frame[]>`,
  `finish(runnerId,incarnation,input):Promise<PublicationPushACK>`;
  `remoteItemQuiescent(tx,taskId):Promise<boolean>`,
  `requestRemoteCancel(tx,taskId):Promise<void>`.
- `remote-preparation-access.ts`: request-bound Runner `access(token,operationId,input)`
  and local publication `permission(token,operationId,input)` methods; no-store
  credentials confined to the HTTP return value after final guards.
- `remote-preparation-reads.ts`: `RemotePreparationReads(db,instanceId?)` with
  `list(token,taskId,input)`, `item(token,taskId,itemId)`,
  `checks(token,taskId,itemId,observationId,input)` returning generated contracts.
- `remote-preparation-commands.ts`: `RemotePreparationCommands(db)` with
  `command(token,input)` and `receipt(token,taskId,requestId)` generated responses.
- `github-remote.ts`: fixed-host bounded `GitHubRemote` provider with ephemeral grant
  acquisition dependency, typed safe lookup/create/update/close/poll methods and
  no raw-error-body persistence. Extend existing `github.ts` narrowly for App grant
  profile issuance; preserve ciphertext/key derivation and read access behavior.

Every new ordinary admission takes configuration/Runner/Task/item/operation locks
in existing coordination order, holds Task with canonical input admission, checks
`localAdmissionAllowed` **and** empty `taskInputGuards`, exact current source/basis/
scan/config/real receipts, service mode and zero hard/exposure findings. Persist
physical/provider ownership before write capability. Recheck after token I/O.
No transaction spans external I/O; lease expiry never proves absence.

Narrow Node/Specification/Replan/guidance publication/reactivation seams query
Delivery remote quiescence without borrowing task_publication_slots. Cancel paths
persist terminal cleanup in the same transaction. Main owns architectural specs;
Runner owns handwritten host/daemon/control, Web owns UI/browser fixtures.

## Migration 23 and verification

`0023_remote_preparation.sql` adds Runner capability plus immutable permission,
observation, mapping, exposure and command receipt tables; fixed remote item
identity, dedicated mutation operations and installation cooldown. One active
unfinished mutation per item, effect ownership persists past timeout, immutable
intent/terminal result, monotonic may-have-mutated/Cancel, set-once PR identity.
Migration 1–22 checksums are untouched. Registry advances additively to 23.
No down migration/reset, accepted-delivery field or Attempt added.

Shared TS/Go fixtures contain 51 identical structural positive/negative cases,
canonical push bytes/digest and a new-source mapped result with old manifest.
Mapped-digest omission/wrong value requires future domain PG tests; schema cannot
decide current mapping from a standalone Owner selection. Evidence below is
specific to this freeze, not whole leaf acceptance or production App integration.

### Current freeze evidence

Toolchain: Node v26.3.0, pnpm 12.6.0, Go 1.27.1 darwin/arm64.

| Command / boundary | Result |
| --- | --- |
| `pnpm protocol:generate` then `pnpm protocol:check` | PASS; generated outputs current after all schema changes |
| `pnpm exec vitest run packages/protocol/test` | PASS: 7 files, 327 tests; new fixture has 51 shared cases plus 3 TS boundary/identity tests |
| `go test -race ./internal/wire -count=1` (Runner directory, pinned Go PATH) | PASS: full shared wire suite, typed nullable-head round trip and all 51 shared cases |
| `go vet ./internal/wire` | PASS |
| `pnpm exec tsc --noEmit` | PASS after two known-materialization fixture pointer assertions |
| Scoped ESLint on protocol validation/generator/new test, migration registry, existing publication PG test and new remote PG test | PASS, zero warnings |
| `pnpm exec vitest run apps/server/test/postgres-remote-preparation.test.ts apps/server/test/postgres-publication.test.ts -t upgrades` with privately loaded retained PG URL and MONOS_TEST_DATABASE=1 | PASS: 2 real PostgreSQL upgrade tests; 12 unrelated tests skipped by name filter; actual 22→23 and 21→23, repeated migrate, historical checksums and empty additive tables verified |
| Scoped `git diff --check` | PASS |

Full `go test ./... -run '^$'` was intentionally used to enumerate consumer
compilation deltas and **failed**, not claimed as a full gate. New published
parent fields are pointers: host/publication_candidate.go lines 83–84,112,116,156
need validated original/published variant handling. Quicktype renamed old
`PublicationResultReason` to `PreparedReason` and `RuleID` to
`PublicationFindingRuleID`; host/publication_candidate.go:412 and
host/publication_pages.go:18 need consumer adaptation. Runner owner receives these
exact deltas after main release; handwritten Runner sources were not edited.

Intermediate failure retained: one wire command was launched from repository
root and Go correctly reported no module; rerun from `runner` passed, including
race/vet. The initial ad hoc fixture helper could swallow accepted negative cases;
it was corrected and replaced as evidence by strict TS/Go expected-validity tests.
Initial root typecheck exposed the two known-materialization optional-field test
accesses; scoped mechanical assertions repaired them without changing product
provenance validation. These are resolved validation setup failures, not omitted
checks. The old local publication tests otherwise keep their accepted behavior.

Server/provider runtime, full Runner/Web compilation, coordinator PG/WSS races,
actual Git/provider effects, default units/build and browser/native checks remain
pending dependent implementation. No phase-2 evidence proves a real App grant,
current Owner waiver, remote mutation or end-to-end leaf completion.

### Original step-2 frozen input SHA256

This table binds the original step-2 shared/migration/test inputs reviewed before
the additive workflow amendment below. Later source changes invalidate affected
evidence and require a separately bound amendment report. Generated unchanged files (go.mod/schema.go/
workspace_json.go) remain generator-owned but have no content delta in this step.

| Input | SHA256 |
| --- | --- |
| `packages/protocol/schemas/v1/contracts.json` | `16477ae19df48af2bb88d207c2345d7f578fbf8b2ff1227a4380e7b28093fbc8` |
| `packages/protocol/scripts/generate.mjs` | `1a4bb2c8f8ade7f17f212048563ab1cec1c450bf95f9f81192738bc9bac58746` |
| `packages/protocol/src/validation.ts` | `f10670752da4f5b55bde52f1877ee68cd4dff9e110f2b8baa171cf146c4b4a66` |
| `packages/protocol/generated/types.ts` | `faf9977e27c003a334a6d49ce7b8b86ec9db18839609e521c2f8b7eb72d423f0` |
| `packages/protocol/generated/go/types.go` | `ef7776c8799033d322087153db475518b528089c4a216d90c273a48198f6b49a` |
| `packages/protocol/generated/go/contracts.json` | `16477ae19df48af2bb88d207c2345d7f578fbf8b2ff1227a4380e7b28093fbc8` |
| `packages/protocol/generated/openapi.json` | `0329bee7a6ab2b26e79d8aec0ed31bb1f43710e45b387bd025f698e978a82999` |
| `packages/protocol/fixtures/remote-preparation.json` | `066e0c971e9d6005788dbb63ed5e486547dfecef09f639d944fc48e9ce6f5773` |
| `packages/protocol/test/remote-preparation.test.ts` | `24426b47dd2f2ace01cbcc8418856b15d76188fde728b367f3dec128cb5296b9` |
| `runner/internal/wire/wire.go` | `3b18b0a1c461ef0e19841f5f492b8ae8d919146ed7ae0d2a4761cc37113df4fd` |
| `runner/internal/wire/remote_preparation_test.go` | `942070a13438475eea9bbccecb752f06b6107d68b2c17f38d1e92898da8d8ba1` |
| `packages/db/migrations/0023_remote_preparation.sql` | `44b852add8dc5fed6dce9a510116f94f7e33c0b1d6db647fb7c7488b6aba8d3b` |
| `packages/db/src/migrate.ts` | `8a7a951f4b2629188ceb24726ef8c81b23446355d4fb31b3772cb176c7132d61` |
| `apps/server/test/postgres-remote-preparation.test.ts` | `149c4eea74de9239116eee6ae0dc1cc468c00d41fbf835883484c8505ba92df0` |
| `apps/server/test/postgres-publication.test.ts` | `ad5e6de52f45ee4e2b4b2b0dd845b63831fd724658c8e88ef6b3010445c152ed` |


## Additive current-scan workflow fact

Implementation found that backend cannot infer actual workflow changes from
findings after a workflows grant makes that finding disappear. Approve the narrow
additive `PublicationScanSummary.workflow_changes?:boolean`: historical immutable
scans remain structurally valid and their canonical bytes/digests stay unchanged.
Every newly admitted remote mutation requires an explicit boolean from the exact
current complete Runner scan, covered by its canonical scan digest. Missing means
fresh scan required, never false or inferred permission. New Runner scans emit it.

The scanner sets true for any changed/deleted `.github/workflows/` version in the
newly reachable public commit range. Unchanged final-tree workflows do not count;
same-tree mapping with zero new public commits is false. Full final-tree policy
and credential scans still execute. A true result requires an actual verified
workflows-write grant for a push. Contents-only permission bootstrap and a fresh
scan reveal this fact without granting a repository write; if workflow permission
changes, rescan the same immutable construction under the new current proof.
The current proof/flag/config and push request must agree exactly at admission and
again after token I/O. Never reuse an older waiver, flag or missing metadata.

Backend owns the additive schema/generation/strict TS+Go fixtures and amended
source hashes/gates. Runner emits/binds the flag; Web new-current fixtures carry
it while historical fixtures may omit it. Remote effects remain gated on the
amendment review. Original step-2 freeze evidence remains historical and is not
relabeled as evidence of changed source. Final combined review covers this seam.
