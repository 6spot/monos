# Plain Git HTTPS and mixed-provider delivery

Status: implementation proposal, based on the current multi-repository completion
and GitHub delivery implementation. This research changes no production code and
performs no remote Git/provider effects. Native acceptance remains deferred.

The next slice should support an ordinary HTTPS Git resource end to end: anonymous
or service-credentialed read, managed workspace and Planner inspection, local
candidate and scan, explicit delivery-branch push, and exact-version Owner
acceptance with verified branch publication. The same accepted batch can contain
GitHub PR items and plain-Git branch items. It does not merge a plain-Git target.

## 1. Decisions and architectural boundary

The behavior is already specified by [Workspace & Git](../04-workspace-and-git.md),
[Owner Review](../07-owner-review-and-ui.md), and
[principles](../08-principles-and-non-goals.md). In particular, publication is
preparation; plain-Git finality requires both the exact Owner acceptance and a
verified accepted branch head. No new Task state, Task resource list, Runtime,
resident Agent, or generic provider plugin framework is needed.

| Concern | First implementation |
| --- | --- |
| Transport | HTTPS with normal TLS verification, exact configured endpoint, no redirects |
| Authentication | Anonymous read, or resource-scoped username/token held by the backend and Runner service accounts |
| Target branch | Require an explicit `default_branch` for a plain-Git resource; do not guess `main` or add a backend Git subprocess to discover HEAD |
| Checkout ref | Existing optional branch/tag/commit `default_ref`; otherwise use the configured target branch |
| Plain-Git delivery | `refs/heads/monos/task/<task_id>/<resource_id>`, controlled candidate ancestry, fast-forward only, manual target merge |
| GitHub delivery | Existing App integration, PR/checks/expected-head merge behavior |
| Preparation modes | Both `automatic` and `after_acceptance` for both item kinds |
| SSH | Explicitly unsupported for generic transport in this slice; the existing verified GitHub SSH alias may still canonicalize to GitHub HTTPS |
| Other transports | No local paths, `file:`, unauthenticated HTTP, custom transport helpers, or arbitrary Git flags |

Keep the secondary “Add Git repository” path in Projects and the preferred GitHub
picker. A plain resource has no GitHub provider metadata. Do not create a fake
numeric provider repository ID. Retain GitHub provider selection for GitHub remotes
that need PR delivery; do not silently reinterpret an existing GitHub item as plain
Git because an App credential is unavailable.

For generic HTTPS, compare the exact validated saved `remote_url`, including its
case-sensitive path, optional port and existing suffix. `repositoryIdentity()`
currently removes `.git` and normalizes host identity; it is an identity, not a URL
constructor. Do not rebuild arbitrary endpoints as `https://<identity>.git` or use
case-insensitive path comparisons. Preserve the current ban on embedded userinfo,
query, fragment, control characters and ambiguous encoded path forms. Generic
resources must be rejected clearly on save/open if they use an unsupported transport.

## 2. Current implementation and extension points

| Boundary | Existing code and reusable behavior | Current GitHub restriction |
| --- | --- | --- |
| Configuration | [configuration.ts](../../apps/server/src/configuration.ts): Owner/CAS/receipt, bounded snapshots, immutable resource identity | Only `save_github` has provider credentials; Project resource accepts a URL but has no usable generic access configuration |
| Secret storage | [github.ts](../../apps/server/src/github.ts): HKDF-derived AES-256-GCM, associated data, ciphertext only | Encryption purpose/AAD and permission minting are App-specific |
| Owner form | [projects.tsx](../../apps/web/src/features/projects.tsx), [github.tsx](../../apps/web/src/features/github.tsx), [use-command.ts](../../apps/web/src/lib/use-command.ts) | Generic URL exists, but merge method is shown for every repository; no scoped HTTPS credential form |
| Read grants | [service.ts](../../apps/server/src/service.ts): `repositoryAccess` and `inspectionRepositoryAccess` preserve exact admitted authority and recheck after access | Both call `GitHub.repositoryAccess`; output URLs/default branch/provider ID come from GitHub metadata |
| Cache fetch | [workspace_git.go](../../runner/internal/host/workspace_git.go), [inspection_source.go](../../runner/internal/host/inspection_source.go) | GitHub-only URL checks, App-only token branch, GitHub ID in retained workspace pin |
| Candidate provenance | [publication_candidate.go](../../runner/internal/host/publication_candidate.go), [publication-candidates.ts](../../apps/server/src/publication-candidates.ts) | Construction/tree/published-parent rules are reusable; `verifyPublicationPinAt` currently requires GitHub metadata |
| Scan and permissions | [publication-policy.ts](../../apps/server/src/publication-policy.ts), [publication_permission.go](../../runner/internal/host/publication_permission.go), [publication_scan.go](../../runner/internal/host/publication_scan.go) | Global App fingerprint, mandatory GitHub permission proof fields, fixed GitHub 100 MiB hard limit, GitHub workflow permission rules |
| Push and recovery | [publication_remote.go](../../runner/internal/host/publication_remote.go), [publication_credentials.go](../../runner/internal/host/publication_credentials.go), [publication_remote_primitives.go](../../runner/internal/host/publication_remote_primitives.go) | Durable intent/worker absence/expected-head pre-push guard already exist; credential validation and URL reconstruction are GitHub-only |
| Remote coordinator | [remote-preparation.ts](../../apps/server/src/remote-preparation.ts), [remote-preparation-access.ts](../../apps/server/src/remote-preparation-access.ts), [remote-preparation-state.ts](../../apps/server/src/remote-preparation-state.ts) | Discovery excludes non-GitHub resources; ref reconciliation uses the GitHub HTTP API; every prepared item proceeds toward PR creation |
| Acceptance/finality | [owner-delivery-state.ts](../../apps/server/src/owner-delivery-state.ts), [owner-delivery-worker.ts](../../apps/server/src/owner-delivery-worker.ts), [migration 32](../../packages/db/migrations/0032_multi_repository_delivery.sql) | Modified members require GitHub proofs/content; readiness certificates describe PRs; finalization currently references a merge operation |

The Runner already owns a dedicated two-slot remote-publication lane, independent
of Runtime execution capacity. Use it for generic Git I/O. The backend must not
read Runner storage or grow a separate Git cache. The original push result is
immutable: replaying a completed `publication_push` returns retained bytes, so it
cannot serve as a fresh branch observation at later acceptance.

## 3. Resource-scoped HTTPS credentials

Add configuration commands `save_git_https_credential` and
`clear_git_https_credential` through the existing Owner configuration endpoint.
The save payload is `{resource_id, username, token}`; clear takes `{resource_id}`.
Require a saved active plain HTTPS resource. A save replaces the entire credential;
there is no token in Project resource settings, Task context, or subsequent reads.
Bound username to 256 characters and token to 4096 bytes, reject NUL/CR/LF and a
colon in the Basic-auth username. Do not install these credentials in Agent CLIs.

Store one row per resource in `git_https_credentials`: immutable resource/remote
binding, username, encrypted token, opaque credential generation, stable
authorization-scope digest, and configuration receipt attribution. Use a separate
HKDF purpose such as `git-https-credential-v1`, random 12-byte GCM IV, and AAD that
binds resource ID, exact remote URL, username and generation. A secret from one
resource cannot be decrypted as another resource's credential. Reuse the existing
private service signing-key source, with a distinct key derivation from GitHub.
Do not expose a raw token hash as its public fingerprint.

`ConfigurationSnapshot.git_https_credentials[]` exposes only
`{resource_id, username, generation, scope_digest}` for configured entries. Keep
the complete snapshot bounded. The receipt stores the command digest and safe
result, as existing configuration receipts do; never persist the credential-bearing
command envelope. Same request plus changed secret is a payload conflict. A replay
of an already committed request does not reinstall an old credential after rotation.
For these commands, add a safe `ConfigurationResult.credential_change` receipt:
`{kind:'saved', resource_id, username, generation, scope_digest}` or
`{kind:'cleared', resource_id}`. This retains independently checkable authorization
scope after a later token rotation; a bare command digest cannot prove the old
resource/username/scope. Permission observations refer to the original safe saved
receipt, while current grants must also match the current credential row's scope.

The form belongs next to a saved plain repository, with username, password-style
token input, configured status and clear/replace actions. Keep secret drafts and
uncertain original requests in component memory only, following the current
GitHub form/`useCommand` model; never put them in the Task journal, sessionStorage,
query cache, URL, error text or configuration response. Clear memory on successful
save/logout. After losing the tab, fetch the safe status instead of recovering a
token from storage.

### Credential renewal is different from authorization scope

A generic static token cannot be attenuated by monos into a provider-enforced
read-only or one-repository token. Scope is enforced by service code: the exact
configured resource URL, an admitted operation, and the fixed read/observe/push
command allowlist. The Owner supplies an appropriately scoped token. Do not call
a local configuration record a verified remote write-permission grant.

The stable scope digest binds resource ID, repository identity, exact remote URL,
username and allowed system use. Material generation changes when the token is
replaced. Exchanging a credential rechecks generation and scope before returning
it; an operation reuses the same frozen scope with fresh material. Same-scope token
rotation can unblock an accepted batch without changing its candidate or requiring
new acceptance. Changing destination/user/scope revokes fresh grants and requires
normal configuration attention; it cannot retarget an accepted batch. Clearing a
credential prevents new credentialed effects but retains historical observations
and unresolved-effect recovery ownership.

Anonymous fetch remains available when no generic credential is configured. A
configured credential denial does not silently fall back to anonymous access.
The unrelated global GitHub App must not enter a plain resource's permission or
scan fingerprint. No generic token is sent to `api.github.com`.

## 4. Read, cache and push contract

Rename the current GitHub-specific repository access response to
`RepositoryAccessResult`, and generalize `InspectionRepositoryAccessResult`.
Both still bind operation ID and the existing workspace/inspection digest, plus
exact remote URL, provider metadata, target/default branch and authentication.
The generic path uses the configured branch and empty provider metadata. GitHub
continues to verify provider metadata and may return its canonical HTTPS alias.
Update current producers/consumers together; the project does not require a
compatibility alias for the old schema name.

Extend `RepositoryAuthentication` with `kind:'https_basic'`, username, token,
and `expires_at`. This expiry is the short local grant-use deadline, not a claim
that the static upstream token expires then. Keep anonymous and GitHub variants
strict; anonymous grants contain no credential fields. Push requires credentialed
authentication; read/observation may use anonymous access where configured.

For fetch and inspection, retain existing authorization/lease/channel checks,
service-owned cache, pinned base/target facts, no-network-in-transaction rule,
literal Git argv, disabled helpers/redirects, TLS verification, bounded output and
physical worker absence. Generalize the durable pin's GitHub ID into exact
provider metadata and compare the correct metadata branch during candidate-parent
verification. Empty provider metadata does not weaken original operation,
resource, cache, commit or tree validation.

Extend the existing service-only credential plumbing. For publication, keep the
fixed askpass script and anonymous inherited descriptors; provide separate bounded
username/token inputs instead of hardcoding `x-access-token`. For cache read and
inspection, either use the same helper or retain the existing service-only env
header mechanism with an exact endpoint-specific header key. Never write a token
to Git config, argv, operation journal or Agent-readable origin. Restrict the child
environment, disable inherited proxies/helpers and preserve the existing timeout
and whole-worker cleanup. Generic transport failure returns bounded reason codes,
not raw credential-bearing Git diagnostics.

Push continues from the service-owned publication store, with exactly one explicit
candidate-to-delivery-ref refspec, no force/tags/mirror/submodules, and the current
pre-push expected-remote-head guard. The candidate's first parent remains the last
verified published head after a previous publication. An uncertain old push must
reconcile under its original identity and physical ownership before admitting a
replacement. Generic transport must not become a second push implementation.

## 5. Scanning and publication authorization

Keep candidate construction, fixed tree, complete newly reachable history scan,
final-tree checks, credential redaction, bounded coverage, exact waiver receipts
and known-public-exposure guard unchanged.

Make provider policy explicit in `PublicationScanConfiguration`:

- `provider_blob_limit` is `104857600` for GitHub and `null` for generic HTTPS.
  Null means no provider-specific hard limit is known; local blob/scan limits still
  apply. Never relabel GitHub's limit as a fact about every Git server.
- Add `workflow_write:'not_applicable'` for plain Git. Continue recording whether
  candidate history touches `.github/workflows`, but generate no GitHub permission
  finding for a plain resource. GitHub still requires its genuine workflow grant.
- Bind a resource-specific authorization/configuration digest. Local scans can
  complete without write credentials; lack of a generic credential is preparation/
  acceptance attention, not a fictitious scan permission result.

Generalize `PublicationPermissionProof` as a discriminated union:

1. `kind:'github_installation'`: current App/install/repository/grants/expiry facts.
2. `kind:'git_https_configuration'`: `schema_version`, `observation_id`, resource
   and repository identity, exact remote URL, username, `configuration_request_id`,
   stable `scope_digest`, `configuration_fingerprint`, `permission_fingerprint`,
   `observed_at`, and a short local grant-use `expires_at`. This means service
   authorization is configured, not that a remote server confirmed write access.

Use `permission_fingerprint = hash({kind, scope_digest})` for the generic branch;
the scope is validated against the actual safe configuration receipt and current
credential row. Material renewal may produce a fresh observation with the same
fingerprint. Never fill App IDs, repository IDs or GitHub `permissions` with
sentinel values. Refactor proof comparisons in both languages by discriminator.
Backend acceptance, push admission and post-access rechecks must all use the same
definition. Missing credentials/actual remote write denial remains retryable in
REVIEW. No probe push is used to manufacture a permission proof.

## 6. Fresh Runner ref observation

Add a small read-only WSS broker operation, following the existing result-read
correlation/incarnation pattern, rather than replaying `PublicationPush` or running
Git in the backend:

```text
PublicationRefReadRequest {
  schema_version: 1,
  request_id,
  push: PublicationPushRequest,
  push_request_digest
}
PublicationRefReadResponse {
  schema_version: 1,
  request: PublicationRefReadRequest,
  worker_absent: true,
  observation: PublicationRefObservation,
  observation_digest
}
```

The response observation binds the original push operation/item/resource/ref;
`request_id` distinguishes a fresh observation from the retained push result. The
frame binds current Runner incarnation and a broker correlation. Add Ready
capability `publication_ref_read_modes:['git_ref_v1']`. The broker returns
offline/unsupported/busy/timeout without inventing an observation. Limit the broker
to 8 reads globally and 2 per Runner, reuse the remote service lane, and use a
10-second round-trip budget. No Agent Attempt or Runtime slot is acquired.

Backend constructs the request from its exact persisted original push and verifies
that it belongs to the selected resource/candidate. Runner verifies original
durable push intent and publication-store lineage, obtains `purpose:'observe'`
access through the current operation-bound endpoint, and runs only
`git ls-remote --refs <exact URL> <exact delivery ref>`. Accept exactly one matching
OID/ref line, an empty absent response, or a bounded unavailable reason. No fetch,
push, PR call or workspace repair follows from this request.

After I/O, recheck connection identity, exact request echo, digests, Task/item/
operation attribution and current applicable authority in a short transaction.
Persist the correlated read fact in `remote_preparation_observations`. Read-only
requests need no new durable execution journal: a lost response may be re-read;
the accepted observation/finalization transaction is durable. A replayed old
correlation cannot create a fresh check. Use backend issue/receive times to bound
the observation freshness instead of trusting a Runner timestamp alone.

For push outcome recovery, a matching ref can extend publication proof only after
the original push has supplied its own trusted worker-absence settlement. Seeing
the desired ref does not prove that a local push worker stopped. Preserve the
original immutable result and append the observation/proof via `publishProof`.
Cancel/revocation still permits necessary observation and physical recovery but
cannot use this read lane to grant another push.

For an accepted mapped result, observe the retained original push whose candidate
is mapped to the accepted source tree; verify the accepted mapping and candidate
digest. Do not fabricate a new push merely to obtain an observation identity.

## 7. Plain and mixed accepted batches

Use `delivery_kind:'github_pr'|'git_branch'` on each modified
`DeliveryRepository`. Common fields remain source/effective basis/preparation/
candidate/scan/waivers/permission authorization/target branch/delivery ref and
preparation mode. `git_branch` forbids PR review/content/marker/merge-method fields;
`github_pr` retains their current requirements. No-change members remain explicit
and have no finalization work.

### Preparation

Discovery creates a remote item for either kind. Ordinary and accepted preparation
share candidate/push admission, exact waivers, item exclusion and uncertain-effect
recovery. Plain preparation stops after verified branch publication; it never
creates/updates/closes a PR or queries GitHub checks. The `after_acceptance` guard
still prevents early push. Local permission-configuration observation may precede
acceptance without authorizing publication, as current GitHub permission refresh does.

### All-item barrier

Generalize the current immutable readiness certificate fact by delivery kind:

- GitHub certificate: existing exact PR/head/content/checks/policy/method evidence.
- Plain certificate: exact accepted candidate, original verified published proof,
  fresh correlated ref read with that head, scan/waiver/configuration scope and
  accepted membership digests. It does not claim provider CI or mergeability.

Prepare every modified item before finalizing the first. In deferred mode this
allows preparation pushes before the barrier; the barrier protects final delivery,
not ordinary preparation. Keep the existing distinction between historical
all-member certificates and fresh per-item checks. Each subsequent finalization
rechecks its own current evidence and the complete frozen local authority.

The worker remains one batch scheduler: prioritize recovery of any uncertain
GitHub merge/remote push, then missing certificates, then the lowest resource ID
without finalization. Branch to the item's concrete GitHub or plain helper. SQL
must independently enforce all-member certificate coverage and lower-resource
finality for both a GitHub first merge mutation and a plain finalization insert.
Plain items must not be finalized in a separate unordered worker while a lower
GitHub item waits on checks.

### Plain finalization transaction

After a fresh read confirms the exact accepted head, lock configuration, Task,
batch and item in the established order. Verify:

1. Genuine proposal/confirmation/acceptance receipt chain, frozen manifest/digest,
   exact member/resource/candidate/source mapping and accepted input cutoff.
2. Batch still active and owned by the Task, no cancellation/revocation, no
   unresolved physical publication owner, current resource authorization scope,
   complete scan/waivers and exposure guards.
3. All modified members certified; every lower resource already finalized.
4. Correlated observation is recent, authentic for this Runner/original push/ref,
   `present`, and equal to the accepted candidate head. The publication proof binds
   the same candidate and original worker-absence result.

Append an immutable finalization with `kind:'git_branch'`, accepted batch/receipt
identity, source and candidate digests, original push ID/digest, verified
publication-proof digest, fresh observation ID/digest and `final_commit` equal to
the accepted candidate head. Update aggregate progress with `completeAcceptedBatch`
in the same transaction. No remote mutation occurs in this transaction. Completion
means accepted published branch, not target merge or external branch immutability.

### Partial success, correction and cancellation

Each final row commits independently. A later failure leaves REVIEW and retains
all successful rows; Retry visits only the accepted remainder. Later conversation
uses the existing cutoff/reply-only rules and never blocks retry or finalization.

Before acceptance, a plain preparation push does not impose partial-finality
restrictions. An entirely undelivered accepted batch may still be explicitly
revoked for correction under the existing guards after uncertain effects settle.
Once any plain or GitHub item finalizes, ordinary Request Changes is unavailable;
finish or cancel the remaining approved work.

If Cancel/revocation wins the Task lock before a plain finalization transaction,
retain its observed publication as remote history but create no accepted plain
final row. If plain finalization wins first, it is retained delivered history and
Cancel only stops the remainder. This differs from a GitHub merge response that
arrives after Cancel: that physical merge remains truthful final evidence. Generic
Cancel retains delivery branches and reconciles in-flight pushes; only GitHub
undelivered open PRs need close operations. Never delete a branch to simulate rollback.

## 8. Exact shared-contract and persistence work

The integration owner should freeze these discriminators and generate contracts
once before backend/Runner/UI implementations diverge.

| Contract | Required change |
| --- | --- |
| `GitRepositoryResource` | No credential material; domain validation requires plain HTTPS target branch and rejects plain merge method |
| `ConfigurationCommand`, `ConfigurationSnapshot`, `ConfigurationResult` | Add two typed credential commands, bounded safe status array and discriminated safe `credential_change` receipt; status type and secret input type are distinct |
| `RepositoryAuthentication` | Strict `https_basic` branch with username/token/local-use expiry; forbid all credential fields for anonymous |
| `GitHubRepositoryAccessResult` | Rename `RepositoryAccessResult`; HTTPS endpoint plus existing `RepositoryProviderMetadata`, whose generic value is `{}` |
| `InspectionRepositoryAccessResult` | Same generic endpoint/metadata/authentication variants; keep exact inspection digest |
| `PublicationPermissionProof` | Discriminate genuine GitHub remote grants from `git_https_configuration`; update all parent request/proof digests |
| `PublicationScanConfiguration` | Nullable provider hard-size limit; plain `workflow_write:not_applicable`; provider-specific fingerprints |
| `PublicationPushRequest`, `PublicationAccessResult`, `PublicationRefObservation`, `PublicationPublishedProof` | Replace mandatory top-level GitHub `repository_id` with required `provider_metadata`; generalize HTTPS URL and credential branch; retain exact identity/digests |
| `RemotePreparationProviderRequest`, `RemotePreparationReview` | Stay GitHub-specific; require concrete GitHub adapter narrowing before creation or API calls |
| New `PublicationRefReadRequest/Response`, `Frame`, Ready | Dedicated correlated read frames/capability; response echoes full request and worker-absence observation |
| `DeliveryRepository` | Modified-item `delivery_kind` discriminates common data plus PR-only fields; plain requires no fake PR or GitHub permissions |
| `DeliveryItemProgress` | Add `delivery_kind`, `checks:not_applicable`, and `finalization_kind:'github_merge'|'git_branch'` for finalized items; plain never reports `merging`/passing checks; no fake merge operation ID |
| Remote/preparation read projections | Generic metadata, published-ref status and kind-aware capabilities/errors; no fabricated PR URL |

Update shared TS fixtures, Go generated consumers and Web validators together.
Use a finite helper for exact HTTPS validation in TS/Go; do not rely only on a
broad URL regex. Review all `repository_id` equality checks by ownership: keep
GitHub checks strict while generic proof comparisons use exact provider metadata.

Persistence changes belong in one fresh-development migration after 32:

- Add the resource credential table and safe configuration receipt linkage.
- Generalize `publication_permission_observations` authority validation by proof
  kind. Its GitHub repository-ID column can become nullable with kind-specific
  constraints; it is never a fabricated generic identity.
- Add remote-item `delivery_kind`; require numeric repository ID/marker only for
  GitHub. Use `(repository_identity, delivery_ref)` for provider-neutral remote
  uniqueness, keep resource/item/Task linkage and immutable destination checks.
- Keep existing push and PR operation storage; read-only ref requests do not need
  another mutation-kind enum or active mutation owner. Persist their observations
  against the original push ID with exact typed request/response evidence.
- Generalize per-item readiness stage/certificate SQL checks. The current migration
  32 certificate validator dereferences PR content and must not be bypassed by
  labeling a plain item ready without its own proof.
- Extend `owner_delivery_finalizations` with `kind:'github_merge'|'git_branch'` and a nullable merge-operation
  reference plus a nullable plain observation reference, with exactly one required
  for the matching kind. Preserve the current merge FK/guard in the GitHub branch;
  add a strict same-batch/item observation FK and plain-finality trigger. Do not
  create a dummy `owner_delivery_merge_operations` row for plain delivery.
- Keep `(batch_id,item_id)` uniqueness, append-only facts, exact receipt authority,
  Task cutoff FK, partial completion behavior and source-member coverage. Strengthen
  final insertion ordering for plain items and retain merge mutation ordering.

SQL negatives must reject fake service-credential receipts, foreign resource
metadata, omitted mixed members, substituted source/mapping, old/cross-item ref
observations, missing certificate coverage, out-of-order plain finality and plain
finality after cancellation. Merely relaxing NOT NULL/URL constraints is incomplete.

## 9. Implementation ownership and order

| Owner | Exclusive write scope |
| --- | --- |
| Integration / shared contracts | Protocol schema, generator/fixtures/generated outputs, domain remote validation, shared migrations, app/service wiring, Web Projects/credential and mixed-delivery UI/API validators |
| Backend delivery implementer | Generic credential module and configuration integration after shared API freeze; remote-preparation access/state/coordinator/guards, ref-read broker, accepted preparation/finality/reads/control and focused PostgreSQL fixtures |
| Runner implementer | Control client, Ready/frame routing, generic cache/inspection access, publication pin/proof/credential/scan/push/ref-read code and focused Go tests |
| Read-only reviewer | Credential persistence/cross-resource grant, original push recovery, both finality branches, mixed ordering and accepted-cutoff audit |

Split configuration ownership from delivery if another slot is available, but
assign `configuration.ts`, `service.ts`, `app.ts`, schema generation and shared
fixtures explicitly to one writer at a time. An implementer may add a new module
while the integration owner wires it. No worker commits or changes task lifecycle.

Order the implementation as: shared schema/persistence contract → safe credential
configuration and generic read/cache/inspection → provider-aware local scan/proof →
existing push path generalized plus fresh ref read → plain finality and mixed
barrier → UI and integrated checks. Ship the first slice with both public read and
authenticated branch delivery; a Projects URL field alone is not complete support.

## 10. Smallest sufficient verification

Use focused local/synthetic evidence and preserve its limits. Do not run real
provider pushes merely for research or infer native Linux acceptance from mocks.

- Protocol generation/TS/Go consumers: strict generic/GitHub unions, secret-free
  snapshots, cross-kind rejection, exact read echo, no fake numeric IDs.
- Configuration PostgreSQL: ciphertext only, scoped AAD failures, same-request
  replay, CAS, material rotation retaining scope, clear/removed-resource denial,
  and no secret in receipt/snapshot/context/Runner journal.
- Runner actual local Git plus controlled HTTPS test endpoint: public and Basic
  read, explicit target/ref pin, exact endpoint/no redirect, rejected credential
  not anonymous fallback, generic parent validation, controlled ancestry/scan,
  expected-head fast-forward push, and no token in argv/config/retained files.
  A local HTTPS fixture may use its explicit test CA; production TLS verification
  stays enabled. Existing local transport seams remain fixture-only.
- Ref-read broker/Runner: current incarnation and correlation, offline/timeout,
  missing/mismatched branch, stale retained response, no mutation, worker absence
  and new observation after immutable push-result replay.
- PostgreSQL delivery: plain automatic stays REVIEW after preparation; deferred
  makes no early push; exact acceptance plus fresh matching ref finalizes; wrong
  ref remains retryable; Cancel/finality contention has one truthful result.
- Mixed batch: both resource orders, all certificates before first finality,
  successful first member retained across second failure, unknown push/merge
  restart uses original identity, later chat does not block accepted retry,
  correction only before any finality, Cancel closes only applicable GitHub PRs.
- UI: secret draft lifecycle, plain/mixed labels and visible finality distinction,
  preparation versus accepted delivery, remaining-only Retry and safe Cancel.

Reuse the current multi-repository GitHub and result-read evidence where inputs
remain unchanged; integration reruns only invalidated checks. Native permissions,
installed CLI behavior and real remote-provider behavior remain separate evidence
boundaries, not prerequisites for implementing this functional slice.
