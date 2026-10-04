# Runner remote preparation design

Active task: `10-03-a-remote-preparation`; planning only, 2026-10-04.
This delegate owns this report only. Initial dirty state contains concurrent task
and Trellis/framework edits; no product, spec, lifecycle, host or provider mutation
was performed. Recommendations require main's shared protocol/design freeze.

## 1. Existing authority and missing seams

Sources read: current PRD; ARCHITECTURE; docs04 publication/delivery/input guards,
docs05 authenticated at-least-once service protocol, docs08 invariants, docs11
service/execution identities; accepted `backend/publication-candidates.md`;
Runner host publication candidate/scanner/pages/private journal, daemon publication
and control repository access; workspace Git token/fetch code; historical GitHub
head-check and uncertain-effects reports and `infra/github/README.md`.

Existing local preparation supplies controlled immutable candidate/ref/tree,
complete bounded sanitized scans, exact source and separate effective basis,
durable paged result/ack replay, and actual Owner override receipts. It creates no
write credential. Daemon admits only original successful workspace-open parent
observations; host rejects `kind=published`. Production workflow permission is
unknown and a requested `allowed` enum is rejected independently by daemon.

Important implementation deltas:

- `publication_candidate.go:ValidatePublicationRequest`, `verifyPublicationPin`
  and daemon `retainedPublicationIdentity` need a distinct published-proof branch;
  an old successful open, prepared local head or backend OID alone is insufficient.
- Current no-change check compares result tree to original source.BaseCommit tree.
  After a push, compare to the last reconciled delivery parent tree instead. A
  corrected result reverting to the original base still needs a fast-forward
  correction commit. Preserve original source.BaseCommit attribution.
- Construction locking currently uses construction ID. Add item-level exclusion
  covering construction, push and reconciliation, plus a retained unresolved-intent
  guard after worker exit. A released flock alone never proves remote settlement.
- The service-owned retained export and publication journal are private; the
  per-resource bare cache is 0750 and execution-readable. Copy only candidate
  public reachable objects into that cache, never clone/mirror the private export.
- Existing read-token `RepositoryAccess` is bound to an open workspace operation;
  reuse its transport/security pattern, not its mutation scope or read grant.

Stage A enables only GitHub automatic remote preparation. Local candidates still
exist for after_acceptance, but those items get no remote dispatch, write access
or PR operation. No merge, Accept, target mutation, source-repository push or new
Task state is introduced.

## 2. Smallest effect split and stable identity

Backend owns delivery-item authority, provider credential issuance, PR create/
update/reconciliation and provider checks. Runner owns candidate objects and one
Git effect: observe the exact delivery ref, optionally fast-forward it to the exact
authorized candidate, then report remote observation. Use the existing bounded
two-worker service lane, per-item exclusion, and no Runtime/Attempt slot/helper.
Do not hold daemon's global Runtime mutex across Git or network work.

Owner Cancel cleanup belongs in this leaf: after every admitted push/create/update
has settled, backend reconciles and closes only the exact undelivered item's PR
(repository/number/marker/head/base match), retaining its branch. Runner supplies
remote truth and worker-absence facts; it does not close arbitrary PRs or infer
that a canceled request undid a completed write. No merge or Accept is admitted.

Persist delivery item identity once for `(Task,resource,canonical repository)`.
Suggested branch: `monos/task-<Task UUID>/item-<item UUID>` and full ref
`refs/heads/<branch>`. Backend chooses and freezes it; Runner recomputes/validates
the derivation and `git check-ref-format`. Do not derive it from title, untrusted
text, current candidate or an Attempt. Keep the same branch through Request
Changes and new source results. PR lookup/marker uses this same item identity.

Suggested wire names, subject to main freeze:

| Contract | Required nonsecret bindings |
| --- | --- |
| `PublicationPushRequest` | schema, stable operation/item ID, Runner/storage ID, repository identity/provider repository ID, canonical HTTPS URL, delivery ref, target branch; complete source/effective basis and digests; immutable candidate plus manifest digest; prepare operation/run/result/scan/config digests; exact applicable override receipt IDs/digest; permission fingerprint; nullable expected published head and prior publication proof digest |
| `PublicationPushResult` | stable operation/request digest, item/repository/ref/candidate bindings, observation status present/absent/unavailable, exact observed head when present, attempt/observation identity and digest; published/reconciliation_required/blocked/interrupted outcome with finite safe reason |
| `PublicationPushAck` | operation/request/result digest after durable backend settlement |
| Ready capability | additive `remote_preparation_modes:["github_ff_v1"]` |

Use separate `publication_push`, `publication_push_result`, `publication_push_ack`
frames rather than Start/effect. Whole frames remain 512 KiB with no raw Git output.
Incarnation is the authenticated current transport fence, excluded from immutable
request identity. Exact persisted results may replay on a new authenticated owning
connection after backend commit/ack loss. Old connection replies cannot admit a
new effect. Incompatible Runners receive no remote operations.

The durable request contains no token, credential-bearing URL or authorization
header. Result state describes preparation and remote truth; successful push is
not Task acceptance/final delivery. An observation matching candidate head permits
backend PR preparation only under still-current authority.

## 3. Ephemeral access and first-write authority

Add a separate authenticated Runner HTTPS endpoint such as
`POST /v1/runner/publication-operations/:id/access`, no-store, redirect disabled,
bounded 16 KiB request/response. Request binds current incarnation, immutable push
request digest and `purpose=observe|push`, plus attempt ID. Backend checks exact
owning Runner/current socket/backend instance, storage/item/source/scan/config/
override receipts and mode. It never accepts an arbitrary repository/ref request.

For observation-only reconciliation of an admitted operation, issue a read token
even after Owner cancellation, strictly to read that existing operation's ref.
This cannot renew mutation authority. For push, serialize a fresh mutation claim
with Task control/item guard before issuing a write token: exact current result,
complete scan, all eligible findings covered by genuine exact Owner receipts,
zero hard findings and zero historical known-public exposure; no pending
pre-acceptance input/change/correction/replan/active writer/lease, no predecessor
uncertainty, mode automatic. Record admitted in-flight attempt durably. Release
DB locks before token/provider/Git I/O; recheck config/claim after token issuance
if any asynchronous provider step intervenes.

Input arriving after the first-write claim is retained and blocks subsequent
preparation. It cannot pretend the already admitted effect never existed. Owner
Request Changes/Cancel revokes new claims, requests worker cancellation and waits
for remote observation/physical worker absence before permitting successor code
or reporting settled remote outcome. A credential response is not a process-stop
receipt. Trusted Runner must recheck its connection context and claim deadline
immediately before starting Git. A cancellation racing that final check is an
admitted in-flight effect requiring reconciliation, never guessed failure.

Issue installation tokens restricted to the exact numeric repository ID and the
permissions needed by this effect (contents write, metadata read; workflows write
when required/actually granted). Verify provider token response repository
selection, exact ID, granted permissions and bounded expiry, following existing
`github.ts` read-token validation. No anonymous write fallback, execution-account
`gh` login, persisted credential helper, SSH key or resource URL override.

Return a nonsecret permission observation/fingerprint bound to provider repository,
installation/config revision, granted permissions and validity. A current scan
with workflow grant must have that proof; setting workflow_write=allowed alone
cannot bypass the present daemon check. Persist the safe proof separately from
credentials and bind it into scan configuration. A permission change creates a
new scan run over the same fixed construction when needed. Before push require
the actual issued token grant to agree with the scan permission facts; denied
workflow add/modify/delete/mode changes block before mutation.

Token stays in service memory and the credentialed Git child's environment or
inherited descriptor. Reuse the current HTTPS extraHeader environment technique:
credential.helper empty, system/global config disabled, redirects false, TLS
verification true, protocol default never and HTTPS explicitly allowed. Never
serialize access results into publication intent, SQLite, helper request files,
logs or Agent context. No token in argv/URL/cache config. Bound the worker to 120 seconds
and token/claim expiry minus a safety margin (suggest 30 seconds). If remaining validity
cannot cover the current bounded step, fetch fresh access under the same still-
authorized operation, then observe again. Expiration or issuance failure grants
no automatic success. Repository-scoped tokens still rely on trusted service
code to enforce candidate/ref authority; they are not cryptographically ref-scoped.

## 4. Physical guards and push command

Under the item lock, load exact durable local prepare intent/pages, validate full
canonical page assembly/count/digests and source/result identity, complete scan,
candidate/config/run and safe findings. Verify source export retention/storage,
candidate ref, exact tree and ordered parent objects again. Reject stale or
conflicting manifests, incomplete scans, hard findings and unapproved eligible
findings. Recompute applicability against the admitted immutable request; backend
retains canonical current-result and actual Owner receipt authority.

Import only the candidate's reachable controlled public graph from the private
export into resource cache under an explicit system ref using Git transport with
no local hardlinks/shared alternates. Verify resulting head/tree/parents and
expected-parent ancestry. Preserve internal refs/workspace/index/files. Suppress
replace refs, hooks, lazy/submodule fetch, global credential helpers, URL rewrites,
following tags, push options, mirror behavior and config-based remote selection.
Use the canonical verified HTTPS URL directly and exactly one refspec:

```text
git --no-replace-objects --git-dir=<service cache> [fixed safe config]
    push --porcelain --no-follow-tags --recurse-submodules=no
    <canonical HTTPS URL> <exact candidate OID>:refs/heads/<stable branch>
```

No plus refspec, force option, all/tags/mirror, deletion, remote shell/receive-pack
override or Agent-supplied refspec. Normal branch updates retain Git's ancestor
requirement; refspec can use an exact object ID and explicit destination. This is
supported by [Git push documentation](https://git-scm.com/docs/git-push).

### Exact expected head without force

A separate ls-remote before ordinary push is insufficient: another writer can
move the ref between calls, even to another ancestor of the candidate. Recommend
one narrowly allowed **system-owned pre-push guard**, with all repository hooks
disabled. Create a private 0700 hook directory containing only a fixed executable
pre-push script; no credential contents. The hook checks bounded stdin contains
exactly one update, exact local candidate OID, exact remote ref and advertised
remote OID equal the authorized expected head (all-zero for first creation), and
fixed destination arguments. Reject any discrepancy; never use --no-verify.
Git supplies these fields and a failed hook aborts the push, per
[Git hooks documentation](https://git-scm.com/docs/githooks#_pre_push).

The Git wire update carries old/new OIDs and the receiver verifies the old OID
has not changed before applying it. Thus the controlled advertised-head check
plus ordinary FF push closes both races without enabling history replacement.
See [Git pack protocol](https://git-scm.com/docs/gitprotocol-pack#_reference_update_request_and_packfile_transfer).
This is a proposed explicit exception to the local scanner's no-hooks rule:
repository/Agent hooks remain disabled; only deterministic system guard code runs.
Freeze and test the exception before claiming exact expected-head enforcement.

If remote already equals candidate, reconciliation succeeds without push/hook.
Post-push always perform a new authenticated exact-ref observation; stdout success
alone is not the durable published proof. Bound/discard raw stderr and status
details; provider rejection reasons map to fixed safe messages. The remote may
move after observation; retain historical exact observation, never claim permanent
prevention of external edits.

## 5. Durable journal, observations and retry

Reuse publication 0700/0600 canonical exclusive records and file+parent fsync.
Suggested layout: service/publication/remote/items/<item>/ and
remote/operations/<operation>/, with item lock; immutable intent, numbered attempt
intent, before-observation, push-started marker, after-observation, result, ack.
Safe records contain operation/request/item/head/ref/proof/claim IDs and timestamps,
never token or raw provider output. Pin unresolved source/construction/scan and
publication objects against retention. A monotonic item index may accelerate reads
but never replaces validated immutable operation receipts as proof.

Persist push-started before invoking Git, not after. Any retained push-started
without reconciled outcome is uncertain across cancellation, timeout, crash,
connection loss or result-write failure. On every original-operation resume:

1. Reconcile after a current read grant. Do not obtain fresh mutation credentials
   or construct another candidate while remote truth is unknown.
2. Authenticate and observe exactly `refs/heads/<stable branch>`. Use `ls-remote
   --refs --exit-code <URL> <exact ref>`, parse bounded output and require exact
   returned ref despite ls-remote's pattern matching. A successful authenticated
   no-match observation can establish absence; authentication/network/malformed
   output cannot. [Git ls-remote](https://git-scm.com/docs/git-ls-remote).
3. Use the matrix below. Record an exact observation before deriving outcome.
4. If mutation is still needed, acquire a fresh backend claim and access, validate
   local manifests again, persist the next attempt intent, then push the same head.
5. Persist reconciled publication receipt before sending result. Backend settles
   and returns digest ack; lost ack replays exact result only.

| Remote observation | Action |
| --- | --- |
| Exact candidate head | Published proof; never issue duplicate push; report history even if canceled, no new PR mutation under revoked authority |
| Exact expected prior head, no unresolved exposure/history concern | Candidate not current; retry same head only with fresh valid mutation claim |
| Authenticated absent, no prior publication, no previous uncertain start | Initial create can proceed with fresh claim and hook's zero-head check |
| Authenticated absent after prior published head | Reconciliation_required; do not recreate deleted lineage automatically |
| Different head, even a descendant/ancestor | Reconciliation_required; never adopt/rebase/force, fabricate published proof or construct successor |
| Unavailable/denied/ambiguous read | Retain uncertainty, typed access/network attention and same-operation read retry |

Strict uncertainty refinement: a current expected/absent ref after a *previously
started uncertain push* cannot prove the candidate was never exposed (external
deletion/reset may have occurred). Keep possible-publication history attributed
to that attempt. Main must freeze conservative treatment: recommend observe-only
reconciliation_required until stronger provider/audit facts resolve it, rather
than automatically labeling the candidate unpushed and replacing it. Synthetic
response-loss success case is recoverable by exact candidate equality. This avoids
claiming a clean replacement erased possible published history.

Terminal denied/missing-credential outcomes describe a failed attempt, not a
permanent cached reply which makes Retry unable to progress. Explicit Retry may
admit another access/observation attempt under the same frozen item/candidate,
or a new operation referencing the prior immutable failure. Pick one schema rule;
keep failed attempt records immutable. Irrecoverable foreign-head ambiguity offers
reconciliation attention, not a Retry button claiming it can resolve the conflict.

## 6. Published parent for subsequent corrected source

Add a tagged published-parent proof containing item/repository/ref, prior push
operation/request digest, candidate manifest and exact reconciled observation/
result digest. It is distinct from workspace-open `{workspace,outcome}` proof.
Do not require the prior source activation/generation to equal the new one;
require same Task/resource/canonical repository/storage lineage and delivery item.

Runner validates that proof against its own private durable successful reconciled
operation, exact prior head/ref/item/provider ID, local pinned public graph and
no newer admitted/unresolved operation. Backend independently validates the
canonical latest reconciled item head. A requested OID or prepared candidate alone
cannot create this proof. Missing prior local storage is unavailable, not permission
to fabricate lineage from a remote clone. Replay exact prior receipt on reconnect
before dispatching dependent construction.

Import the prior controlled public head graph into the new source export/cache
without importing private execution refs, verify it, then construct candidate with
first parent that exact published head and optional verified integrated target
parent. Ordered parents retain public provenance; exact result tree and controlled
metadata stay fixed. Scan newly reachable versions excluding verified public
parents plus final tree under existing complete scan contract. All known historical
public credential exposure remains a separate positive guard through clean,
deleted/no-change and new-source results; ordinary correction/override does not
clear it. Last-head equality alone is not evidence that old exposure never occurred.

For identical result tree to published parent tree, reuse the existing published
head/PR binding with new effective applicability rather than manufacture an empty
successor commit. The local record should explicitly describe this reuse and its
new source/effective basis; it must not discard the existing item or portray it
as a first-publication no-item result. Minimal proposed reuse record:
`{schema_version,item_id,new_source,new_source_digest,effective_basis_digest,
prior_candidate_manifest_digest,publication_proof_digest,published_head,result_tree}`.
Validate exact retained new-source tree equality to that verified published head's
tree and persist the record durably. Keep the prior manifest's source_digest and
construction identity unchanged; never relabel them as the new source or fabricate
a new construction. Backend binds the existing item/PR to this explicit mapping.
If permission/policy evidence needs refreshing, admit a separate scan applicability
run over the reused physical head with explicit mapping context, rather than
silently claim the prior scan approved a new configuration. Main freezes whether
that is a tagged prepare outcome or a dedicated reuse record; no new item is needed.

## 7. File boundaries and concrete tests

Runner implementer: new handwritten `host/publication_remote.go` (physical guards,
credentialed Git, system guard hook, immutable remote journal) and tests; add
published-proof/no-change seams to `publication_candidate.go` and tests; daemon
`publication_remote.go` and tests (scope, item lane, cancellation/recovery);
control `publication_access.go` and tests; bounded Ready/dispatch/recovery changes.
Protocol implementer alone owns schemas/generated files/wire validation. Backend
implementer owns delivery item/claim/access/provider/outbox/result settlement/
PR/checks. Main integrates and owns all host/provider coordination.

Actual Git local tests, no provider required:

- Separate source/export/cache/bare remote: first create, same-head observation,
  second corrected-source FF push on verified published parent; exact source tree,
  preserved private source refs/index/files and no private ancestry on remote.
- Revert to original base after published change must produce successor; unchanged
  latest published tree must reuse existing lineage with truthful applicability.
- Hook rejection: unexpected ref already present during initial create, different
  advertised prior head even if ancestor of candidate, multiple updates, deletion,
  wrong local OID/ref/remote, disabled/missing/tampered hook. Race remote update
  after advertisement to ensure receive-pack CAS rejects it.
- Crash injections after intent/observation/push-started, successful push before
  result/observation persistence, before result send and backend commit/lost ack;
  same head and exact result replay, no duplicate mutation when remote equals head.
- Remote denied/missing/ambiguous/deleted/foreign head, token expiry and reconnect,
  canceled-before-start versus canceled-in-flight, old claim/scan/source/storage,
  revoked exact receipt and workflow permission; bounded safe stdout/stderr and
  token-free journal/argv/workspace/environment for execution account.
- Concurrent different operations on same item, canceled lock owner with retained
  uncertainty, competing new construction, missing prior published receipt and
  fabricated remote OID. Different items use at most two workers without Runtime
  slot or daemon mutex dependence.

WSS/HTTPS tests validate enrollment/current incarnation/access result binding,
observe-only recovery after revoke, stale connection fences and exact lost-ack
replay. Real PostgreSQL tests validate input/Cancel first-write-claim serialization,
old operation settlement before new result, item ordering and no transactions
spanning remote I/O; backend alone tests PR create/update marker reconciliation.

Main's current prerequisite inventory reports zero `monos.github_configuration`
rows and an active `gh` OAuth account; the latter is not a GitHub App installation
grant. Do not claim a live App JWT, installation token issuance, selected-repository
permission proof or fully installed App acceptance from that account.

Native plan for main after source freeze: pinned Linux CGO build/race/vet, fresh
service-owned 0700 fixture and TMPDIR, two-account file/credential boundary checks;
production App credential path covered by strict mocked HTTP/authority tests. A
separately authorized dedicated synthetic GitHub trial may exercise the bounded
native Git/push/PR/reconciliation kernel via explicit test-only token injection.
That seam must remain outside product routes/configuration, never reinterpret an
OAuth token as App proof, and record the injected token's limited test provenance
without its value. It proves exact branch/PR, correction FF, response-loss
observation and restart under that synthetic credential, not production App
issuance/grant readiness. The fully installed production App gate is an external
prerequisite for a later truthful scope once actual App configuration/grants exist.
Retain intent/request/result/source/binary/config hashes,
every failed trial and remote branch/PR identities. No monos source payload,
production repository visibility change, wildcard cleanup or merge/Accept effects.

Historical reports establish bounded GitHub behavior, not this coordinator:
`09-28-github-head-checks/research/verification.md` retains private protection 403,
initial stale-SHA inconclusive 405, then passing exact-head checks;
`09-28-github-uncertain-effects/research/verification.md` records one create/merge
request with successful response withheld and exact lookup recovery. That was
application-return suppression, not TCP loss or current Runner write-token proof.
Reuse only the provider feasibility conclusion, never claim this leaf's acceptance.

## 8. Verification of this report

Only this Markdown report was created. No product suites were run for research.
Read-only source inspection and official Git manuals support the proposal; no
local Git effects, installed host trial, token issuance or provider write occurred.
Main must resolve shared protocol names, the controlled-hook exception, conservative
ambiguous-exposure recovery and same-tree published-head reuse before implementation.
