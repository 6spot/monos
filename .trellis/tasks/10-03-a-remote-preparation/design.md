# Automatic remote preparation design

## Boundaries and smallest behavior gap

Accepted local preparation creates exact candidate objects and complete scans,
but cannot publish a review branch/PR. Add Delivery-owned deterministic remote
coordination and one service-account Git push lane. Backend owns canonical
admission, credentials, provider HTTP, PR/poll/Cancel and receipts; Runner owns
trusted local objects, physical effect ownership and exact-ref Git. Web only
reads canonical facts and invokes scoped Owner Retry. No Agent execution involved.

## Stable identities and storage

Migration23 adds remote_preparation_items keyed by existing delivery_items.id,
remote_preparation_operations, immutable remote_preparation_observations and
remote_preparation_command_receipts. Keep provider-neutral core item/source/head
facts with GitHub-specific review adapter fields. Freeze branch
`monos/task/<task UUID>/<resource UUID>` and marker
`<!-- monos-delivery-item:<item UUID> -->`. Require exact numeric repository ID,
same-repo branch/base and marker together; PR number/id assigned once after
verified discovery. One unresolved mutation per item; it persists beyond a worker
lease or socket. No Attempt row or accepted-delivery fields are added.

Operations are narrow push/create_pr/update_pr/close_pr intents, canonical hashed
and immutable. Dispatch progress, retry/cooldown/poll clock and attempt ownership
are separate mutable infrastructure facts. Exact observation/result is appended
before terminal settlement. No credentials/raw error bodies enter persistence.
Claim Task/config/item/operation in established lock order; no transaction spans
HTTP/Git/WSS. Changing Task control version alone is not result authorization.

Migration 23 also retains immutable published-result mappings, permission facts
and published exposure attribution. On exact push reconciliation, every ordinary
credential-pattern finding in the published candidate range becomes an immutable
known-public exposure fact immediately. The next ordinary mutation, including PR
creation/update, stops for remediation; exact reconciliation and Cancel closure
remain available. A prior local override does not erase this publication fact.

## Admission and owning-module fences

Every new ordinary mutation requires REVIEW, exact current canonical source and
effective basis, fresh automaticGitHub mode/resource/repository/config, complete
current scan and exact eligible receipts covering all findings, zero hard findings
and retained known-public exposure, localAdmissionAllowed and empty taskInputGuards.
Hold the same Task lock as input/revision/Cancel admission. Save effect ownership
before write credentials/provider invocation. Repeat authority/config checks after
provider token I/O, returning no write capability if any guard changed.

If input/Cancel/newchange wins first, no effect starts. If effect wins first, later
input blocks subsequent effects; revoke/pause, retain exact in-flight ownership and
reconcile. Do not pretend a sent request was canceled by a DB update. Claim expiry
or incarnation loss permits read-only reconciliation, never duplicate write.

Keep requirement/Replan task_publication_slots ownership. Add a narrow Delivery
remoteItemQuiescent query to Specification publication/withdraw-release, Replan
quiescence/publication, guidance corrective reactivation and other actual source
mutation boundaries. They can admit pending change and revoke new work while
waiting for admitted remote effects to settle. Minimal Cancel hooks in both
prePlan/taskexecution paths persist cleanup in the same terminal transaction.
Cancel cleanup has exact limited close authority, independent of ordinary REVIEW
and input guards, after previous admitted effects reconcile.

## Protocol freeze responsibility

Backend/protocol owner writes exact schema signatures and frozen-contract.md
before dependent Runner/Web edits. Use these agreed concepts/names:

- Ready remote_preparation_modes:["github_review_v1"].
- Frames publication_push, publication_push_result, publication_push_ack, each
  current incarnation and one strict typed payload, ≤512KiB whole encoded frame.
- PublicationPushRequest: schema/operation/item/task/resource/Runner/storage,
  immutable source/effective basis and digests, exact candidate manifest/scan/local
  prepare result/config/override selection, repository ID/canonical HTTPS URL,
  stable ref/target, nullable expected published head and prior proof digest.
- PublicationPushResult/ACK: original operation/request/item/ref/head binding,
  typed exact observation/reconciled outcome/result digest; no free-form Git text.
- Runner HTTPS access exchange: current incarnation/requestdigest, exact existing
  operation and purpose observe|push. Observe-only historical access remains
  available after revoke/Cancel; push access requires fresh mutation claim.
  Bounded16KiB no-store response; token excluded from WSS/journals/receipts.
- Permission proof: nonsecret observation ID/digest, exact repo/App/installation/
  key/config/granted permissions/expiry, authenticated provider observation.
  Store safe facts and bind config fingerprint; unknown→verified gets a new scan
  run over the same construction. Runner retrieves/verifies an authenticated
  request-bound proof rather than accepting a flipped allowed enum.
- PublicationParent published variant is a distinct tagged reconciled push proof
  with item/ref/repository/storage lineage, prior push/request/result/observation
  and candidate manifest digest. Never fake original open workspace/outcome.
- PublishedResultMapping: distinct typed mapping from current original result +
  effective basis to prior immutable published manifest/head/tree/proof when tree
  equals verified last published tree. Do not rewrite old manifest.source_digest.
  Preserve existing item/PR and clearly label source mapping/reused scan evidence.
  It grants no new push/override/Accept authority. Backend/Runner freeze its exact
  result/read placement before consumers; do not manufacture empty new ancestry.
  A mapped result carries a new request-bound scan over the verified published
  head baseline and full final tree. Preserve the old manifest's parents and
  source identity; any provisional new construction remains unused. Never reuse
  historical scan/waiver authority merely because the physical tree is identical.
- RemotePreparationRecord/Page/ChecksPage, strict Owner list/detail/read bounds,
  current/history/cleanup/failed step/safe reason/exact-head observations.
  Retry_remote_preparation binds exact operation ID/digest/current version;
  receipt recovery uses original request ID and existing scoped session journal.

## Physical push, credentials and races

Use private service journal0700/files0600 and per-item lock through construction,
push/reconciliation. A retained started/unknown intent blocks successors after
worker exits. Validate original retained completion/export, exact candidate ref/
tree/parents, complete safe pages and new proof binding before each push. Preserve
original source/workspace/resultref attribution; no private mirror/alternates.
Only controlled public candidate reachable objects may enter execution-readable
resource cache. Store prior public graph in a service-owned candidate object store
when needed for a new source/export; original result export is not repaired or
substituted. Last published proof need not match new source generation/activation,
but must match same Task/resource/repository/storage/item and own durable receipt.

Ordinary explicit one-ref push, no force/lease-force/plus/mirror/all/tags/delete.
Fixed system-owned pre-push hook in unique privatehooksPath checks exactly one
advertised update, localcandidate, remoteref and expected old OID (zero if absent),
fixed canonical destination. Repository/Agent hooks remain disabled. Receiver
old/new OID CAS handles later race. Preflight ls-remote alone is insufficient.
Post-effect authenticated exact-ref observation supplies the durable published
proof; porcelain success alone does not. Bounded controlled Git subprocess with
no shell refspec, URL rewrite, lazy/submodule fetch or raw stderr persistence.

Tokens are exact single repository App installation grants, minimal per-effect
permissions and validated expiry/repo/selection/permission response. Preserve
workspace contents-read path. Git push needs contentswrite and workflowswrite only
for actualworkflow changes; PR write profile has pull_requestswrite; poll profile
checks/statuses/PR/read plus required contentsread. No administration/write CI
permissions. Token stays transient service-only memory/child credential plumbing,
never Agent env/argv/URL/Gitconfig/private journal/files. Controlled TLS/redirect/
credential-helper settings and120s worker bound; expiry safety margin30s.

Permission observation uses real fixed-host authorized grant metadata, not public
read success. Fresh issued push grant agrees with scan proof. Declined/expired/
malformed/changed observation stays unknown or denied. A read token cannot grant
workflowwrite. App-key encryption compatibility and existing API version2022-11-28
remain unchanged.

## Operation history

List one row per immutable remote operation, ordered by operation.created_at DESC
then operation.id DESC. Source filtering uses request.preparation.source.operation_id.
The canonical cursor binds Task/source, row kind and the exact stable operation
position. A tagged latest applicable local-only fallback row appears once per item
ONLY when that item has no remote operation. Web row, selection and query identity
bind item_id plus operation_id (or the tagged fallback). Latest-item detail must
never replace selected historical content; it independently fences cached ordinary
and cleanup Retry. Historical operation rows have current=false even when source
and head match. Existing history remains visible after mode changes.

## Recovery state machine

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


Exact candidate remotehead -> reconcile published without another push, including
historical success afterCancel. Unknown started push plus current expected/absent
head -> reconciliation_required possible-publication attention; no inferred
never-exposed result, replacement parent or automatic mutation. Unexpected head
always attention, even ancestor/descendant; no adoption/reset/force. Definitive
before-start/rejected outcome can retry only same authorized intent after fresh
checks. Missing/denied/malformed remote read is unknown, not absent. Preserve
failed attempts and uncertainty without destructive cache rewrite.

An immutable terminal Runner result cannot be replaced by retrying its physical
operation ID. Exact Owner Retry may admit a new remote operation only for a
verified terminal blocked result with `push_started=false` and
`worker_absent=true`, after fresh ordinary admission. Keep the same candidate,
ref and expected published parent, preserve the old result, and return the actual
new operation identity/digest/version in the receipt. The automatic pump cannot
replace that blocked same-context result without the receipt. Started, interrupted
or unknown effects keep the original operation and reconcile by observation;
this does not grant another push.

PR first create requires complete authorized exact lookup with zero matches and
no prior startedcreate. Lost create response -> exact unique repo/head/base/marker
lookup settles samePR; zero/ambiguous/foreign identity staysunknown, no secondPOST.
Freeze title/body for update; GET exactcontent digest settles uncertainPATCH,
otherwise attention until originaleffect outcome known. No blind later overwrite.
Manuallyclosed/mergedPR keeps identity and attention, no replacement/reopen/merge.

Cancel revokes unstarted effects, reconciles admitted push/create/update then
closes exact owned undeliveredopenPR. Lostclose reconciles GET closed state; retain
branch. ExternallymergedPR is remote truth, never invented Owneracceptance or
Taskcompletion. Access-denied cleanup persists on terminal Task for scopedRetry.
Mode after_acceptance stops new writes but does not implicitlyclose existingPR.

## Provider projection and polling

Fixed APIhost, no redirects,10s/request1MiBbody,100/page max10pages; unknownoverflow
never all-pass. Persist normal15s/pendingmergeability5→10→30s, error jitterbackoff
up to5min. Bound8requests/turn and serialize installation; support RetryAfter/
remaining-reset/secondary≥60s cooldown that OwnerRetry cannot bypass. Safe ETag
cache identity includesrepo/head/base/query/config;304 retains correcttypedfacts.

Observe PR/head/base, query checks/statuses literalheadSHA then reread PRidentity/
head/base. Changedhead/target yields stale/incomplete, never fresh correlatedpass.
No checks is distinct fromsuccess; neutral/skipped/canceled/unknown remain typed.
Requiredprotection/ruleset readiness unknown here; nextOwnerdeliveryleaf owns
merge prerequisites. Keep stale prior facts timestamped while unavailable.

PR title/current completion summaries/fixedTaskitemreference are deterministic.
Bound title256Unicodecodepoints/body64KiBUTF8; safe finite credential redaction
before external publication and safe markdown rendering. No Agentcommit messages,
conversationhistory, privatepaths or Artifactpayload dumps. Canonical Task source
text remains unchanged. Each metadata payload/digest is immutable; update samePR.

Web adjacentremote card preserves localinspection and sessionselection. Show
preparing/inputpaused/offline/accessdenied/reconciling/failedstep/cooldown/current
exactheadchecks/mergeability/history/cancelcleanup. EffectRetry distinct from
readRetry; lostreply usesoriginalreceipt, no neweffectidentity. No PreparePR/
Accept/Merge/RequestChanges placeholders. Backendpolling doesnotneedbrowser.

## Evidence and external configuration

Production App issuer/profile/secret nonpersistence use actualsignedsynthetickey
and strict fixedprovider test responses. PhysicalGit/SQLite/WSS/PG race tests prove
coordinator, and actualauthorized syntheticGitHub effects prove native service
push/PR/Cancel kernel with explicit test credential dependency. OAuth native test
injection is never represented as liveAppJWT/one-repotoken issuance. Existing
installedAppconfiguration0 is an external gate for later complete delivery/native
App integration; no installation/grant is fabricated. Retain exact failed trials,
source/binary/config/intent/results and UIassets/screenshots. No monos source push.

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
