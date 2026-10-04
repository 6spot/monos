# Backend remote preparation research

2026-10-04. Research only, `/root/local_result_implement`.
Accepted product source is `1ad5735`; inspected checkout HEAD `2095660a1fe546412430b5d630d4837dc550155b`
also includes upstream archival bookkeeping. Initial workspace had concurrent
framework/task/doc changes; none were edited. This assignment writes this file only.
No provider mutation, source push, credential read, host action or model call ran.

## 1. Existing boundaries to reuse

- `apps/server/src/publication-candidates.ts`: immutable original result identity,
  effective basis, fixed construction, separate non-Attempt outbox, bounded/fair
  dispatch and exact page settlement. Its current `localAdmissionAllowed` checks
  REVIEW, requirement publication slot, pending Replan, unreleased process/lease.
  It does **not** implement all pre-acceptance input guards.
- `task-guidance.ts:taskInputGuards`: pending/failed ordinary inputs, attached pending
  requirement obligations, open input issues and unresolved guidance obligations.
  Call it explicitly for new remote effects; an interpreted reply-only status
  question can clear its input guard. Do not substitute message sequence or the
  unrelated Task control version for exact result/basis authority.
- `publication-candidate-reads.ts`: Task share lock, current basis/config projection,
  immutable findings, permanent item-scoped known-public-exposure guard.
  `publication-commands.ts`: exact real Owner override receipts, not permission to
  Accept, merge or publish a changed candidate.
- Migration `0022_publication_candidates.sql`: stable delivery item by Task/resource;
  immutable local candidate/scan/page records. Do not turn terminal local operations
  back into pending remote operations or attach transient tokens to their JSON.
- `github.ts`: encrypted App key, fixed API host, redirect denial, RS256 JWT,
  one-repository **read** token validation, 10s HTTP deadline and 1MiB JSON cap.
  Existing `request` collapses error types and discards rate-limit headers. A
  separate typed provider request primitive is needed for remote effects.
- `service.ts:repositoryAccess`: pre/post authority/config checks around provider
  I/O; ephemeral no-store Runner exchange. Its Attempt/open-workspace lease rules
  cannot authorize delivery: the remote lane needs its own operation exchange.
- `runner/internal/daemon/publication.go`: all current parents must be retained
  successful open-workspace effects; `workflow_write=allowed` is deliberately
  rejected. A published-parent OID or flipped enum cannot unlock those guards.
- `node-execution.ts`, `task-planning.ts`, `task-specification-settlement.ts` and
  Replan settlement own canonical cancellation/revision effects. Remote mutation
  settlement must join those guards; no separate Task lifecycle is introduced.

Architecture docs04 sections Git delivery, controlled ancestry, uncertainty and
provider refresh; docs06 transactional outbox/control/accepted cutoff; docs07
Review/input/cancellation; docs08 invariants remain authoritative. This leaf
implements automatic GitHub preparation and minimal Cancel cleanup. Existing
`after_acceptance` resources stay local-only. Accept/merge/Request Changes and
required-check authorization remain next-leaf work.

## 2. Small persistent model

Use a dedicated mutation-specific subsystem, not a generic workflow engine.
Suggested migration 0023 has these records:

| Record | Identity and authority |
| --- | --- |
| `remote_preparation_items` | One row keyed by existing delivery `item_id`, exact Task/resource/repository ID, immutable target branch, deterministic branch and PR marker; provider PR number/id set once after verified discovery |
| `remote_preparation_operations` | Stable UUID, item, kind `push/create_pr/update_pr/close_pr`, immutable canonical request/digest and admission basis; mutable dispatch/retry/unknown progress, terminal immutable reconciled outcome |
| `remote_preparation_observations` | Immutable bounded typed observations: operation/item, repository ID, ref/head, PR ID/number/head/base/state, safe content digest, server time, observed permissions or check summary; no provider raw body/token |
| `remote_preparation_commands` | Actual Owner session-scoped Retry request/digest/envelope/safe receipt; original command recovery, no new identity on reload/response loss |
| Item mutation fence | At most one admitted unresolved mutating operation per item; active worker/attempt attribution and cancellation requested; an expired dispatch lease never clears unknown effect ownership |

Optional separate permission-observation table is acceptable; it can use the typed
observation table if exact scope and immutable kind are explicit. Store scheduled
poll due times/backoff/rate-limit scope independently of immutable observations.
Unique constraints bind operation/item/task and immutable provider ID; do not use
a mutable Task-level `pr_url` as sole identity. Lock configuration, relevant Runner
where needed, Task, item, operation in the established stable order. Workers claim
short transactions; no lock or transaction spans provider HTTP, Git or WSS I/O.

Branch recommendation: `monos/task/<Task UUID>/<resource UUID>`; if chosen schema
prefers item UUID, freeze that equivalent mapping once at first admission. Marker:
`<!-- monos-delivery-item:<item UUID> -->`, fixed across scan/run/source corrections.
Each PR lookup additionally verifies numeric repository ID, same-repository head
repo ID/ref, fixed base ref and marker. Marker alone is not ownership proof. Treat
zero visible candidates after a lost create, multiple matches, foreign marker,
foreign PR head or changed repository ID as unresolved; no replacement PR.

PR title/body are a deterministic bounded projection of current Task title,
current applicable completion summaries and fixed Task/item reference. Never copy
Agent commit messages, conversation history, arbitrary Artifact contents or private
paths. Freeze each admitted update's rendered content/digest; later metadata gets
another serialized update, not mutation of old operation intent. Recommend a
256-character title/64KiB body budget, safe finite-pattern redaction for credential
looking metadata, and explicit attention if rendering cannot fit. Canonical Task
content remains unchanged. This rendering policy needs root's final frozen choice.

## 3. New-effect admission and fencing

In one transaction, resolve the exact **current** canonical local candidate and:

1. Require Task REVIEW, `localAdmissionAllowed`, no `taskInputGuards`, no accepted
   delivery setter/active batch from this leaf, active exact Project/resource scope.
2. Read current resource settings through service configuration SHARE. Require
   GitHub HTTPS identity/verified numeric repository ID and **fresh**
   `remote_preparation=automatic`. A completion descriptor's old mode is insufficient.
   Never retarget the workspace/item when Project defaults change.
3. Require complete current scan, matching source/effective basis/head/tree/parents/
   config; every eligible finding covered by exact applicable Owner receipts;
   no hard/noneligible finding and known-public-exposure count zero. New verified
   permission config requires a fresh scan, not reuse of unknown-policy findings.
4. Require no predecessor effect unknown/in flight and verified expected published
   ref basis, or a first-publication branch verified absent. Persist exact intent
   and active fence **before** any write capability or provider mutation.

The effect is admitted at this serialization point. A new input or Cancel that
commits before it prevents admission; one committing after it cannot pretend the
already admitted external request never existed. Set cancellation/pause, reconcile
that exact effect, and block all later new remote effects. Continued preparation
is not an accepted input cutoff: ordinary pre-acceptance input remains blocking
at each next effect. Already admitted reconciliation GETs must remain possible
despite new input, changed basis/mode, Cancel or offline Runner.

Before write-token issuance repeat the above checks; after provider token I/O
repeat them and exact relevant configuration equality before returning capability.
No token is returned on stale mode/result/input/cancel/session/instance scope.
Persist a started effect fence immediately before provider/Git invocation. Revision
writers may admit a pending change/withdrawal, but cannot publish new effective
Spec/Plan, launch correction, switch delivery parent or forget the fence while its
push/PR effect remains unresolved. Minimal helpers belong to existing settlement
and cancellation boundaries; do not reinterpret `task_publication_slots` as a new
generic kind. Cancel itself stays immediately terminal, with cleanup progressing
as an independent durable remote operation.

Backend worker takeover: fresh DB claim allows reconciliation only until predecessor
I/O/Runner process absence and exact remote truth settle. WSS incarnation and claim
TTL are not proof old remote work stopped. Every result/ack binds operation,
request digest, item, repo/ref/head and current transport incarnation; admitted
historical effects persist even if their current applicability was revoked.

## 4. Credentials and workflow observation

Preserve existing read-only workspace access unchanged. Add separate non-Attempt
Runner exchange, e.g. `POST /v1/runner/remote-preparation/:operation_id/access`:
owning Runner authentication, current backend instance/incarnation, immutable
operation digest, exact candidate manifest/head and started mutation scope.
Response is no-store, bounded and ephemeral; exact repo HTTPS URL, short-lived
one-repo token and expiry, operation digest and expected ref/head only. No generic
URL, refspec or arbitrary token request. Agent account/runtime never receives it;
Runner must use service-owned controlled Git credential plumbing without token in
argv, URL, `.git/config`, journal, WSS frame, outcome, logs or durable DB record.

Use separate downscoped token profiles (request and verify returned scope/expiry):

| Operation | Minimal repository permission request |
| --- | --- |
| Git push | `contents:write`, `metadata:read`; `workflows:write` only when exact scan proves workflow changes |
| PR create/update/Cancel close | `pull_requests:write`, `metadata:read`; add contents read only if the specific verified endpoint requires it |
| Checks/status/PR observation | `checks:read`, `statuses:read`, `pull_requests:read`, `metadata:read`; contents read for explicit ref/commit observation |

No actions write, checks write, statuses write, administration write or merge
permission is requested. Observed checks are information here; do not request
administration read just to advertise a fictional required-check readiness result.
GitHub documents repository/permission downscoping and forbids a token from
exceeding its App installation grant. HTTP Git uses Contents, with Workflows for
workflow-file access. ([Installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[Git access permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app))

Permission observer must positively verify same App/installation/key fingerprint,
numeric repository and requested/returned permissions via authenticated fixed-host
API; persist only safe grant facts/digest/observation identity/expiry. Missing,
expired, changed config, 401/403/404 or malformed response is unknown/denied, never
allowed. Minting/observing a valid repo-scoped Workflows write grant is evidence;
successful public read or old contents read token is not. Incorporate this retained
observation into permission fingerprint; config unknown→verified triggers a new
scan run under the same construction. Runner must verify its request-bound retained
permission proof instead of simply removing the accepted `allowed` rejection.
Fresh push capability still revalidates the grant; old scan alone is no token grant.

Keep API version `2022-11-28` for compatibility in this leaf. Current GitHub docs
list its supported sunset as 2028-03-10; 2026-03-10 is newer, but adopting it here
would unnecessarily change the existing read adapter. Pin and test profiles rather
than following website samples silently. ([API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions))

## 5. Publication ancestry and Runner protocol seam

First remote push reuses the accepted exact base-parent candidate and original
public materialization proof. A reconciled push observation creates a new tagged
**published** parent proof: remote operation ID/request digest, item/repository/ref,
exact observed published head, observation digest and trusted retained Runner
push/result journal attribution. This is not an `open_workspace` outcome. Extend
`PublicationParent` as a discriminated proof shape; do not fake an open operation
for a published head or infer publication from object availability.

For a genuinely corrected source, create a new construction whose ordered parent
is the verified last published delivery head (plus explicit verified integrated
target only if used). Exact tree remains the corrected result; private execution
ancestry stays excluded. New construction requires a new complete scan and new
overrides where applicable. The old unpushed base-parent candidate remains history.
Rescan/retry of one unchanged construction still preserves head/dates/parents.
If old push is uncertain, construct nothing against an assumed replacement parent.

No-change must compare **verified delivery parent tree**, not always original
materialization base. After publishing a modification, reverting to the original
base is a real correction commit, not no-change. Keep original source provenance
distinct from current delivery parent and read both in the UI.

Suggested additive capability `remote_preparation_modes:["github_review_v1"]` and
dedicated request/result/ack frames with full operation/request/item/candidate/
expected-ref scope. Immutable push request: explicit one candidate ref/head and
one destination branch; no force/mirror/all/tags flags or caller refspec. Runner
persists intent before Git and reports exact before/after observations. Backend
owns GitHub HTTP PR writes/polling; Runner owns Git object/push work. Frame512KiB,
path/ref bounds, byte-bounded subprocesses and service/Root ownership invariants
remain. Root/Runner research is evaluating a controlled pre-push hook that rejects
an advertised head differing from the admitted expected ref; confirm its actual
Git transport behavior with tests. Do not claim ordinary non-force push or GitHub
`force:false` provides an expected-old-SHA CAS: it prevents non-FF overwrite but
not every external actor race. ([Git reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference))

## 6. Provider adapter and reconciliation

Add a fixed-endpoint GitHub review adapter with typed methods `observeRepository`,
`observePermissions`, `observeRef`, `findPullRequest`, `getPullRequest`,
`createPullRequest`, `updatePullRequest`, `closePullRequest`, `observeChecks`.
No merge method/route is exposed in this leaf. Verify every response's repository,
PR number/id, same-repo head/base and exact SHA; redirects and response URLs never
select the next request host. Retain only allowed status/rate-limit/ETag headers
and sanitized enum categories, not raw error bodies.

Before first create, look up by exact repo/head/base and marker; zero complete
authenticated matches permits **first** create only if no earlier create intent
could have reached provider. After lost response or restarted started intent,
zero matches stays unknown, not permission for a second POST. A positive unique
match settles the original operation. Persist PR ID/number and use it afterward;
never find a different PR merely because the old one was externally closed.
GitHub list supports head user/ref and base filters; GET PR may return null
mergeability while its computation is pending. ([Pull request API](https://docs.github.com/en/rest/pulls/pulls))

PATCH updates freeze title/body digest and same PR identity. After response loss,
GET compares the exact rendered fields/digest. Exact match settles; mismatch is
attention until predecessor completion/definitive rejection is established, not
automatic replay to overwrite external edits. Definitively rejected writes can
be re-attempted only through fresh guards on the same immutable effect intent.
Transport timeout/network/5xx/oversized success body is unknown. Generic 404 can
hide loss of private-repository authorization; never interpret it as absence.
([API troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api))

Push recovery reads the exact ref: desired head proves publication; a different
head requires known predecessor/process absence and ancestry reconciliation.
An absent ref or unchanged old head alone after timeout does not establish that
a server-side operation cannot still finish. Keep unknown until definitive
non-execution/settlement evidence or exact intended remote effect is observed.
Never delete branch, reset or force-push to restore expectations.

Cancel transaction fences all unstarted remote effects and schedules reconcile/
cleanup. Resolve admitted push/create/update first; if an exact owned undelivered
PR is open, admit one durable `close_pr` (`state:closed`) operation. Lost close
response is reconciled with GET; already closed settles without duplicate PATCH.
Keep branch and local results. If PR was externally merged, record remote truth
and cancellation attention without inventing Owner acceptance or Task completion.
Unknown/access denied cleanup remains visible/retryable, Task stays CANCELLED.
Mode change to after_acceptance stops new preparation but is not Cancel and must
not automatically close/delete an existing review request.

## 7. Bounded polling/read model

Persist next poll time for active item/unknown operation. Recommend normal 15s,
pending mergeability 5→10→30s, transient error exponential jitter up to 5min,
bounded8 requests/worker turn and serial per-installation requests. Each HTTP
request10s, decoded JSON1MiB, page100, maximum10 pages per observation. More pages
or truncated pagination => explicit incomplete observation, never aggregate success.
Retain the previous complete observation with timestamp/stale flag; ETag304 reuses
only the same repo/head/base/query/config cache identity. Browser/webhooks do not
own polling authority. Provider webhook support is optional and out of this leaf.

Read PR head/base SHA, query check-runs with the **literal head SHA**, combined
statuses with that same SHA, then re-read PR identity/head/base. If either changed,
do not publish a fresh complete correlated snapshot. Check-run `head_sha` and
combined-status SHA must equal expected head. Keep suite pending/completed/failure,
neutral/skipped/cancelled and no-checks distinct; no statuses is not success.
Required check protection/ruleset readiness is explicitly unknown in this leaf;
mergeability=true is informational, not merge permission. Persist target/base SHA
so target movement invalidates freshness and schedules another observation without
rewriting fixed delivery target or workspace. ([Check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference),
[Commit statuses](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference))

Honor `Retry-After`; if primary remaining0 wait to reset; otherwise secondary
limit waits at least60s with increasing backoff. Persist cooldown by installation,
not just Task, so another item or Owner Retry cannot bypass it. Conditional reads
and at least1s spacing between mutation requests follow GitHub guidance. Retry
wakes reconciliation under unchanged operation ID; it does not authorize a POST.
([API best practices](https://docs.github.com/en/enterprise-cloud%40latest/rest/using-the-rest-api/best-practices-for-using-the-rest-api))

Suggested Owner projection: `RemotePreparationRecord` includes item/operation IDs,
version/digest, current source/effective basis/candidate head/tree/parents, stable
branch/PR, observed published head/proof, state/failed step/safe reason,
observation age/exact observed head/base, check completeness, mergeability, cooldown,
current applicability, Retry/cleanup capability. Local candidate reads remain
available regardless of provider failure. Task FOR SHARE covers applicability;
no provider calls inside reads. API list32/details/checks64/page512KiB with scoped
canonical cursors. Actual session-authenticated `retry_remote_preparation` binds
operation ID/digest/version and returns immutable request receipt; GET original
receipt recovers response loss. No `Prepare PR`, Accept or merge action.

## 8. Failure matrix and test plan

| Boundary/failure | Required observation/action |
| --- | --- |
| after_acceptance / non-GitHub / no change | Local-only; zero remote mutation/token request |
| Pending input commits before effect | No remote admission; original local result readable |
| Input/Spec/Plan/Cancel after admission | Fence next effect; reconcile old effect; no stale basis becomes current |
| Incomplete/hard/known public exposure | No write capability; existing exact eligible receipts cannot waive hard/exposure |
| Missing/revoked App/repo/workflow grant | Safe denied/unknown; no anonymous write fallback or guessed permission |
| Push succeeded, reply/ack lost | Same op resolves exact branch head; no new candidate/ref/force push |
| Old ref absent/different while push unknown | Retain fence and reconcile; do not substitute a new branch/parent |
| PR create succeeded, response lost | Exactly one intent/POST; unique exact lookup settles same PR |
| PR lookup0/2+/foreign marker/404auth | Unknown/ambiguous/denied; zero repeat POST |
| PATCH success lost, stale renderer/external edit | Observe exact fields; settle original or attention; no blind overwrite |
| Rate limit / 5xx / bad JSON / timeout | Typed cooldown/unknown; bounded reads, persisted schedule survives restart |
| Old-head success / PR head changes midpoll | Stale/incomplete facts; no fresh all-pass snapshot |
| mergeable null / checks absent/neutral/failing | Truthful informational projection; never permission to merge |
| Cancel before dispatch / during push/create | No unstarted writes; reconcile admitted work; close exact owned PR, retain branch |
| Cancel close reply lost/access denied | GET exact closed state or cleanup attention; Task remains terminal |
| Later correction/revert-to-original | Same branch/PR, new published-parent candidate and scan, genuine FF correction |
| Other worker/old incarnation after restart | Reconciliation takeover only; no lease-only ownership release or duplicate effect |

Actual PG: migrate22→23 checksums, immutable/scoped constraints, worker contention,
fair due-row selection, rollback/restart, both message/effect admission orders,
actual Owner Specification carry vs direct read locks, Cancel stages and receipt
replay, resource mode/remove/archive/config races, no accepted-delivery mutation,
whole exact findings/override selection and persistent exposure. Assert old operation
cannot dispatch after newer authority and unknown fence blocks basis publication.

Deterministic adapter: signed synthetic App JWT, returned one-repo/permission/expiry
validation and secret non-persistence; typed401/403/404/429/5xx, Retry-After/reset,
ETag identity, pagination overflow and malformed/head-crossed responses. A fake
server must audit one create/update/close intent despite discarded success replies;
crash after intent/before dispatch/after remote effect/before DB receipt/after receipt
before ack. Mutation request bodies remain exact over restart.

Actual Git/WSS: controlled service push to an owned local bare fixture validates
private-parent exclusion, literal ref-only push/no force, advertised-head race,
published proof tamper, later correction FF, revert-to-base semantics, process
kill/wait/cancellation and pending journal replay. Authenticated native transport
validates exact capability/item/op/instance/incarnation/ack without Runtime slots.
Built SPA: local-readable failed/preparing/unknown/denied/cooldown states, old vs
fresh check SHA, Retry reload/session fence, Cancel cleanup and same PR history.

Authorized GitHub synthetic native validation is a **later explicit execution**
gate, not run by this research: one dedicated marked repository, only synthetic
content; create/update/push/check observations and Cancel-close, discarded-success
response recovery with audited single create, no source upload or merge. Existing
`infra/github/probe.py` and `uncertain.py` are feasibility evidence only: old-SHA
409 after clean prerequisites, enforced statuses, unique marker lookup and one
create/merge despite application response loss. They do not prove production token,
push, coordinator, TCP loss or native cancellation behavior. Retain historical
failed405 isolation and private protection403 evidence instead of treating those
as successful expected-head checks.

## 9. Ownership and decisions for root freeze

Suggested non-overlapping implementation slices:

- Protocol/backend owner: schema/generation, migration23/registry, remote
  operation/read/Retry/Cancel modules, provider adapter, service/main/app integration,
  relevant domain settlement guards, PG/provider/WSS tests.
- Runner owner: published/permission proof validation, candidate parent/no-change
  changes, remote Git journal/push/access/reconcile lane, host/daemon/control tests.
- Web owner: typed remote API, Task command journal, Review progress/checks/Retry/
  Cancel cleanup, browser fixtures and inspected screenshots.
- Freeze shared proof/frame/operation digests and budgets before dependent writes;
  protocol owner owns shared Go wire validation, not simultaneous Runner edits.

Root's resolved choices are recorded above: minimal Cancel cleanup included;
automatic GitHub only; after_acceptance local-only; no Accept/merge/Request Changes;
actual published proof rather than fake open outcome; no-change against delivery
parent; retained exact permission observer, fresh scan/config and service mode.

Remaining implementation choices/recommendations:

1. **Push advertised-head race:** controlled pre-push hook + non-force push,
   exact expected advertised remote-head comparison proved by actual transport tests.
   No `--force-with-lease`, force, mirror/all-tags or repository-supplied hook is
   allowed. The fixed hook checks the actual advertised local/ref/remote tuples;
   receive-pack must reject a subsequent remote-ref race. If the
   mechanism cannot guarantee the intended comparison, preserve reconciliation
   attention rather than advertise atomic CAS or use force flags.
2. **Unknown create zero matches:** remain unknown, Retry reads only. A bounded
   poll window never authorizes an unproven second create; exposing uncertainty
   is preferable to silently duplicate a review request.
3. **Required checks:** information-only exact-head summary now; no administration
   permission/protection enforcement inference. Next acceptance leaf owns readiness.
4. **PR manually closed/merged:** attention and original identity, no new PR or
   auto-reopen. Only Cancel cleanup can deliberately close the owned request here.
5. **Metadata render bounds/redaction:** freeze256 title/64KiB body with finite
   token redaction/attention rather than copy unsafe/unbounded free text to a
   public PR or effect journal.
6. **Proof freshness:** permission observation has validated expiry/config identity;
   each write-token exchange rechecks. Poll snapshot carries exact head/base/time,
   no long-lived unconditional “ready” boolean.

These are research recommendations, not unreviewed schema/API commitments. No
product tests were rerun for this documentation-only assignment; source inspection
and current official documentation supported the recommendations. Final root
planning must choose names/budgets/proofs and curate implement/check manifests.

## 10. Live prerequisite and evidence boundary

Main's read-only `main-scope-and-prerequisites.md` and
`host-provider-inventory.json` report zero configured App rows in the exact existing
monos DB. The existing authenticated `gh` account has repo/workflow OAuth scope;
installation inventory was unavailable, so this does not establish installation
absence or an App grant. No key/installation identity may be invented, and OAuth
credentials must not be relabeled as one-repository App tokens.

Planning/code work can proceed. Keep three evidence classes explicit:

1. Synthetic signed JWT/provider-response tests establish adapter scope checking,
   encrypted-key handling and rejection contracts; they do not establish that a
   live App installation issued a token.
2. Actual native Git and actual authenticated GitHub lower-level effect tests may
   use the previously authorized marked synthetic repository/account. If a test
   injects OAuth solely at the transport boundary, name that injection and prove
   immutable operation/push/PR/recovery semantics without claiming App JWT/token
   issuance, repository-downscoped production credentials or installed integration.
3. Fully installed product remote preparation requires a real Owner-managed App
   key/installation/repository grant and actual token issuance/permission validation.
   This is currently an external prerequisite; retain a clearly unrun production
   App gate rather than fake it or stop independent implementation work.

No new provider calls were made to check these credentials during this research;
the main inventory is the evidence source. Root reports the remaining prerequisite
after concrete reviewable work and scoped acceptance evidence are available.
