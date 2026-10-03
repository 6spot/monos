# Recommended leaf 1 design: Project repository and serial Task workspace

Research/design recommendation, 2026-09-30. Only this file is changed. No product,
credentials, host state or task status is changed. Names below are concrete
recommended contracts to settle before backend and Runner implementation, not
claims that these APIs or tables already exist.

## Decisions

- Keep the existing backend, Runner, privileged helper and two OS identities.
  Add one workspace module on each side, not another service or workflow engine.
- A Node gets an Attempt-local snapshot of **path reservations** for its Project
  resources. Actual Task workspace records and Git data appear only after its
  first authenticated `open_workspace`. No resource list is copied onto Task.
- Workspace identity is `(task_id, resource_id)` and survives Attempt replacement.
  The first successful materialization fixes remote identity, base and branch
  target. Later opens refresh target observations, never reset/rebase Task HEAD.
- Continue existing Task semantics: Project archive is not cancellation or
  resource removal. An existing Task may open an active resource in its Project
  even if that Project is archived. Resource removal denies a new open and is
  blocked while a nonterminal Task or unresolved lease/effect uses it. This leaf
  does not add Start policy; Task creation's active-Project guard is unchanged.
- Stage A remote support is GitHub HTTPS, including a configured GitHub SSH alias
  normalized to the same verified HTTPS repository identity. No SSH-agent use,
  arbitrary private Git credential discovery or delivery write credential.
  Unsupported remotes remain configurable but opening them explains unavailable.
- An unconfigured GitHub App does not prevent a **verified public** GitHub fetch.
  Anonymous public access and App-backed private access have separate acceptance
  evidence. Configured App denial never silently retries anonymously.
- Canonical Task/Todo Planner inspection remains explicitly unavailable in Stage
  A. Preserve historical fixture behavior only through explicit fixture provenance.
- Stage A opens at most one repository for a Task. Keep collection contracts,
  but reject an additional distinct Task workspace with an explicit unsupported
  reason; never silently choose the first Project resource. Multi-repository
  completion and repository-free completion belong to later leaves.

## Protocol to agree first

Use shared JSON Schema definitions and regenerate TS, Go, OpenAPI and fixtures.
All objects are strict (`additionalProperties: false`); IDs/digests/counters/OIDs
reuse existing validators. Array bounds below are intentional.

```ts
// Optional new Dispatch field; required for all newly admitted canonical Task
// dispatches. It is absent from retained legacy fixture dispatch bytes.
interface WorkspaceReservations {
  project_id: Id;
  configuration_version: Counter;
  resources: { resource_id: Id; workspace_id: Id }[]; // 0..128, sorted/unique
}
// Dispatch.workspace_reservations?: WorkspaceReservations
// Canonical Task: task_id + workspace_reservations; resource_id forbidden.
// Canonical Task Planner: resources must be []; no writable repository grant.
// Todo: existing repository-free form, workspace_reservations forbidden.

interface RepositoryProviderMetadata {
  github?: { repository_id: string }; // GitHub boundary validates the numeric ID
}
interface WorkspaceResource {
  resource_id: Id;
  repository_identity: string;      // existing normalized identity, max 2048
  remote_url: string;               // immutable configured remote, max 2048
  provider_metadata?: RepositoryProviderMetadata;
  default_ref?: string;             // validated Git ref or object ID, max 1024
  default_branch?: string;          // validated branch name, max 1024
}
interface WorkspaceBasis {
  storage_id: Id;
  repository_identity: string;      // normalized Git identity, matches resource
  provider_metadata?: RepositoryProviderMetadata;
  base_commit: GitOID;
  target_branch: string;
  finalized_commit: GitOID;
}
interface WorkspaceDescriptor {
  schema_version: 1;
  workspace_id: Id;
  task_id: Id;
  project_id: Id;
  resource_id: Id;
  runner_id: Id;
  generation: Counter;              // starts at 1; no automatic rebuild increment
  lease_id: Id;
  node_id: Id;
  node_activation: Counter;
  open_operation_id: Id;            // canonical first open for this lease
  resource: WorkspaceResource;       // frozen first-workspace resource settings
  basis?: WorkspaceBasis;           // absent only before initial materialization
}
// Operation.workspace?: WorkspaceDescriptor
// Operation.workspace_digest?: SHA256(canonicalJSON(workspace))
// Pair required together. Canonical open/complete carry them; canonical Stop
// carries them only if this Attempt owns a workspace lease. Legacy forms remain.

interface WorkspaceMetadata {
  generation: Counter;
  storage_id: Id;
  lease_id: Id;
  repository_identity: string;      // normalized Git identity, fixed thereafter
  provider_metadata?: RepositoryProviderMetadata;
  base_commit: GitOID;
  target_branch: string;
  target_commit: GitOID;             // this activation's pinned remote observation
  finalized_commit: GitOID;          // base initially, then formal completion result
  checkpoint?: {
    operation_id: Id;
    head_commit: GitOID;
    tree_id: GitOID;
    commit_id: GitOID;
  };
}
// EffectResult.workspace_id?: Id;   // existing public field, unchanged
// EffectResult.path?: string;       // existing Runner-local field, max 4096
// EffectResult.instruction_files?: string[]; // new top-level field, 0..2
// EffectResult.workspace_metadata?: WorkspaceMetadata;
// Successful canonical open requires all four fields above. No nested path/ID
// copy: Agent reads result.workspace_id, result.path and result.instruction_files.
// Canonical complete returns workspace_id and workspace_metadata. Stop returns
// those fields when its open succeeded; after a proven cancelled unexposed open,
// Stop has writer_absent=true without workspace data. Backend checks this against
// the terminal open record. Retained results replay without adding new fields.
// Existing git_commit/git_tree keep their completion meanings.
```

The resource settings in later descriptors come from the initialized workspace
record, not current default-ref settings. Core workspace identity is the normalized
Git `repository_identity`; base and target never require a GitHub identifier.
Optional provider metadata is namespaced: this leaf defines only the strict
`github.repository_id` field, without a plugin registry or arbitrary metadata bag.
Map the existing Project resource's `provider`/`provider_repo_id` into this snapshot
at the provider boundary; no Project resource API migration is needed. Validate a
GitHub numeric ID there, and retain verified metadata at first materialization.
Later basis/results must match the fixed repository identity and any pinned
provider metadata. `basis` is the current trusted finalized basis captured when
that lease opens. The descriptor for an already
admitted operation never changes when DB/host progress advances. Later Stop and
complete descriptors copy the **same lease's** open descriptor; they do not
silently refresh its basis. `Operation` itself still supplies Attempt, dispatch,
request and operation IDs; verify those against descriptor ownership.

Instruction files are relative root filenames only. Do not follow a symlink
outside the workspace or expose arbitrary discovered paths. Missing files yield
`[]`; the fixed Node protocol requires reading the returned files before coding.

Add `EffectResult.workspace_unavailable_reason` with exactly:
`unsupported_remote`, `unsupported_multiple_workspaces`, `credentials_missing`,
`repository_denied`, `ref_unavailable`, `storage_unavailable`,
`ownership_unresolved`. Retain the current `recoverable` failure kind and a bounded
human message. This is operation attention, not a Task state. Scope/version/input
violations continue using existing `denied_scope`/`version_conflict`/`invalid_input`.
Failure before admission can return existing `unmet_precondition` with the same
actionable wording; do not manufacture a successful empty workspace.

### Repository access exchange

```http
POST /v1/runner/operations/:operation_id/repository-access
Authorization: Bearer <Runner enrollment credential>
Content-Type: application/json
Cache-Control: no-store
```

```ts
interface RepositoryAccessRequest {
  schema_version: 1;
  incarnation: Counter;
  workspace_digest: SHA256;
}
// Stage A exchange response is explicitly GitHub-specific. Core workspace
// contracts do not require this provider metadata.
interface GitHubRepositoryAccessResult {
  schema_version: 1;
  operation_id: Id;
  workspace_digest: SHA256;
  remote_url: string;               // verified https://github.com/owner/repo.git
  provider_metadata: { github: { repository_id: string } }; // verified numeric ID
  default_branch: string;           // verified provider metadata
  authentication:
    | { kind: 'anonymous' }
    | { kind: 'github_installation'; token: string; expires_at: Timestamp };
}
```

Token max length 4096; fixed response byte bound 16 KiB. No secret in URL, request
ID, descriptor, dispatch, durable receipt or recovery inventory. This endpoint is
an ephemeral credential exchange, not a new Agent command. Retrying it may mint
another read-only token for the same admitted effect; no formal workspace action
is duplicated and there is no token-bearing command receipt to persist.

Authorization checks before and after the bounded provider HTTP calls: Runner
credential, matching connected incarnation/backend connection instance, owning
Attempt/dispatch, exact stored operation digest, kind `open_workspace`, unresolved
admitted/recovery operation and non-released matching lease. Recovery is allowed
before Runner `ready` and after Agent mutation authority is fenced; the operation
still must settle before Stop can release ownership. A different/newly superseded
Runner channel is denied. No expired Attempt credential is renewed.

Use current Owner-configured App credentials for the exact repository; rotating
credentials can restore the same admitted effect. Repository/default-ref identity
does not change with that rotation. If App configuration is present, mint with
`repository_ids: [verified numeric repository ID]` and only `contents: read`,
`metadata: read`; verify returned permissions/repository identity and expiration.
For App-backed private access, require the resource
`provider_repo_id` from the authorized picker, mapped to
`provider_metadata.github.repository_id`; use that safe numeric ID to narrow
the token request, then read repository metadata with the returned scoped token
and verify ID/remote/installation before releasing the token to Runner. Do not
first mint an unrestricted installation token merely to discover the repository.
Missing provider ID gives an actionable configuration error. GitHub controls installation-token lifetime (normally one hour); do not claim an
unsupported arbitrary five-minute provider expiry. Keep the token only for this
fetch process. App private key and JWT stay in backend memory/encrypted storage.

If no App is configured, request bounded unauthenticated GitHub repository
metadata and require `private=false`, matching normalized remote identity and any
configured `provider_metadata.github.repository_id`. Return anonymous access only
on that positive evidence. A private/404/403/rate-limited response is unavailable; never substitute
the Owner's CLI/SSH credentials. An App-backed request that fails remains denied.
Disable redirects and revalidate actual provider metadata rather than trusting a
picker field. A verified GitHub SSH alias is converted to the returned HTTPS URL;
non-GitHub URLs or unknown credential schemes return `unsupported_remote`.

## PostgreSQL migration and admission

Add one migration after the latest registered migration, with no rewrites of
retained command envelopes/results. Proposed tables/columns:

| Record | Fields and constraints |
| --- | --- |
| `task_workspaces` | `id PK`, `task_id FK`, `project_id FK`, `resource_id FK`, `runner_id FK`, `generation bigint NOT NULL DEFAULT 1`, `resource jsonb NOT NULL`, `repository_identity text NOT NULL`, `state reserved/ready/recovery`, `ever_materialized boolean NOT NULL DEFAULT false`, nullable `storage_id`, `provider_metadata jsonb`, `base_commit`, `target_branch`, `finalized_commit`, `created_by_operation_id`, `materialized_by_operation_id`, timestamps; `UNIQUE(task_id,resource_id)`. Generic repository identity matches the frozen resource; optional provider metadata uses the strict namespaced shape above. Base/target/storage and verified provider metadata are write-once after first materialization; resource identity is immutable and defaults freeze once initialized. The current finalized pointer advances only from a validated completion. |
| `workspace_leases` | `id PK`, `workspace_id FK`, `task_id`, `node_id`, `node_activation`, `attempt_id FK`, `dispatch_id`, `generation`, `open_operation_id UNIQUE`, `state held/settling/released`, `target_commit`, `settle_operation_id`, optional `checkpoint jsonb`; unique non-released lease per workspace, and Stage A one non-released lease per Task. Keep released rows for replay/attribution. |
| `operations` | nullable `workspace_descriptor jsonb`, `workspace_digest char(64)`, `workspace_lease_id FK`; all-or-none constraint for canonical workspace effects. Their immutable identity fields cannot change after admission. Existing `resource_id` remains effect attribution, not Task binding. |
| `legacy_probe_attempts` | `attempt_id PK/FK`; private fixture provenance, never writable via Owner/Agent routes. Existing attempts may be enrolled by migration only when their immutable legacy Plan content explicitly has `probe=true` and retained launch/resource identity matches. The internal fixture helper explicitly registers newly generated test fixtures. Unknown ambiguous historical rows remain readable/recoverable but are not granted fresh fixture effects. |

Use deferred references where the open operation and new workspace/lease mutually
reference each other within the same transaction. Add same-Task/resource ownership
checks, not just independent foreign keys. No broad nullable fallback grants.

`workspace_id = 'ws_' + SHA256(canonicalJSON([task_id, resource_id]))` provides the
same reserved name on backend/Runner without creating a materialization. Add a
shared cross-language fixture for the hash. The path is derived from that opaque
ID on Runner, never supplied by Agent or backend as an arbitrary host location.

**Dispatch:** extend canonical Task queue input with the current Project's sorted
resource reservation projection under `lockConfiguration(SHARE)`. Canonical Node
launches record IDs/names only, with no token or workspace DB row created; canonical
Planner launches record an empty reservation array. Preserve snapshots through
queue/reconnect; a resource added after launch requires a later Attempt. An edited
default does not require a new Attempt: first open reads the current settings under
the configuration lock. Removed resource membership is checked again on open.
Task queue no longer requires legacy `resource_id`. Both old fixture and new
canonical dispatch validation are explicit; absence of Project metadata is never
permission to use fixture Git for a newly created Task.

**New open transaction**, lock order: configuration SHARE → Runner → Task →
Attempt → workspace/lease → operation (ordered resource IDs if generalized).

1. Authenticate and validate scope/fence/expected control version; receipt lookup
   remains before fresh state checks. Verify current Node activation and RUNNING
   ownership. Do not call `assertActiveProject` for an already-created Task.
2. Resolve requested ID in both immutable launch reservations and current active
   resources of this Task's Project. Ignore old `tasks.resource_id` for canonical
   Tasks. Reject a second distinct workspace in Stage A explicitly.
3. If this Attempt/activation already has a lease/open operation for the resource,
   make the new request's receipt reference that existing operation/result. Do
   not replace `operation.request_id`; multiple receipt IDs may refer to the first
   operation. This prevents competing physical opens under different request IDs.
4. Otherwise insert/get `task_workspaces`, pin Runner locality, reject incompatible
   live/settling ownership, allocate a lease and open operation. For an existing
   ready workspace copy its trusted basis; for a first open capture current resource
   settings and leave base unset. Persist descriptor/digest, receipt and outbox.
5. Commit before any provider call, fetch or filesystem mutation. No repository
   descriptor is re-resolved when the admitted operation is retried.

`finishOperation` validates descriptor/lease/generation/result resource identity.
Initial success fixes storage/normalized repository identity/base/target and any
verified provider metadata, marks ever_materialized,
and sets finalized commit to the base;
later open success must match existing fixed facts and can update only that lease's
target observation. A conflicting second result fails rather than adopting it.
No lease is released by successful open. Resource removal uses the workspace
record and all unresolved lease/effect facts in addition to historical operation
references. Archive alone does not change any of these records.

## Runner storage, locks and trusted stages

Keep `Root=/var/lib/monos-probe` for installation compatibility; renaming deployment
paths is unrelated. Add owned directories through the existing bootstrap:

```text
Root/cache/resources/<resource_id>.git       service-owned, execution read/traverse
Root/tasks/<workspace_id>/                  root-owned parent, 0755
  worktree/                                execution-owned, 02750
  common/                                  execution-owned, 02750
Root/launch/workspaces/<workspace_id>.json  root-owned authoritative metadata
Root/service/workspace-locks/               service-private cache lock files
Root/service/storage-id                    service-private stable random UUID
Root/launch/storage-id                     root-owned copy of same initial UUID
```

Reserve empty allowed worktree/common directories before CLI launch; no Git data
or formal workspace record is created by reservation. Keep Attempt scratch/config
under `AttemptRoot`. Do not move a live process's repository or introduce symlink
redirection for a future Attempt. The execution account cannot replace the
root-owned workspace parent or authoritative metadata; it still owns normal
workspace/common contents under the current non-hostile-Agent host contract.

The two stable storage-ID copies are established/checked by the existing privileged
bootstrap/helper. Missing or mismatching identity on an initialized backend
workspace means `storage_unavailable`, not automatic regeneration/recloning.
Generation stays 1 in this leaf; an eventual deliberate rebuild needs a separate
authorized recovery design, not a timeout-driven increment.

Extend the existing SQLite journal, `synchronous=FULL`, with:

| Record | Minimal fields |
| --- | --- |
| existing `effects` | retain complete immutable Operation and result; compare workspace descriptor/digest as well as existing scope/kind/request fields |
| `workspace_op_stages` | `operation_id PK`, descriptor digest, stage, pinned base/target branch/target commit, owned clone staging path, result/checkpoint JSON; no tokens |
| `workspaces` | `workspace_id PK`, generation, storage ID, task/resource IDs, fixed base/target, current finalized commit, latest trusted root-record digest; reconstructable from backend plus root metadata |
| `workspace_leases` | lease/Attempt/activation identity, open operation, target observation, held/settling/released, optional checkpoint refs; backend remains formal lease authority |

The local stage enum is `intent`, `pinned`, `common_ready`, `ready`,
`checkpointed`, `cancelled`. Network access is not a stored token-bearing stage.
Root metadata retains workspace identity/generation, exact descriptor digest,
lease/owner, first-open pinned base/target, activation-start finalized revision,
stage and last completed local result. Durable write uses existing `saveRecord`
(temporary file, fsync, rename, parent fsync). Repeated helper calls compare the
entire immutable descriptor and ownership; mutable operation state/result are
not part of that identity comparison. Extend `sameOperation`, `BeginEffect` and
`ValidateEffectScope` together; checking only `resource_id` is insufficient.

Serialize cache writes with a per-resource OS lock and Task workspace changes with
a per-workspace OS lock plus root ownership record. Use the same lock order
(resource, workspace) for all new local paths. The existing daemon's per-operation
queue map is only duplicate-work suppression, not this ownership barrier.

**Process ownership:** reuse transient systemd operation cgroups. A cache-fetch
worker runs as the service identity; materialization/finalization workers run as
the execution identity. Add a narrow cache-fetch helper action to the existing
helper/worker, not a permanent fetch process. Its durable record contains only
descriptor/stage. Pass the ephemeral access response through stdin/inherited
descriptor into the service worker, never systemd Environment properties or argv.
The worker puts the Git Authorization header into its private process environment
or inherited descriptor and disables prompts, redirects, hooks and untrusted Git
configuration. Do not persist token-bearing URL/config; output only fixed bounded
failure reasons rather than raw credentialed Git stderr.

The existing helper-wide lock must cover ownership checks/record creation only,
not network fetch/wait. Persist the operation cgroup identity before launch, then
release the global metadata lock while awaiting it; use specific cache/workspace
locks during its mutation. This prevents a slow fetch from blocking unrelated
Owner Stop. A lost `systemd-run` response retains cgroup ownership; reconnect first
reconciles/terminates that exact worker before retry. Do not rely on killing only
the top-level Git PID or on an expired flock lease to prove writer absence.

## Pinned materialization and refresh algorithm

1. Journal the operation before effects. Check root/SQLite/backend identity and
   lease; retrieve ephemeral repository access. Credential exchange and network
   work occur outside PostgreSQL transactions.
2. Under the resource lock, service fetches the exact requested base ref and fixed
   target branch into operation-specific cache refs. If default ref is absent use
   the branch; branch target comes from captured `default_branch` or positively
   verified provider default. A tag/commit may be a base but is never a target.
   Resolve short refs unambiguously as branch/tag; ambiguous or unavailable refs
   fail explicitly. Fetch object IDs only when the server can provide them.
3. Pin resolved commit IDs under `refs/monos/pins/<operation_id>/base` and `/target`,
   verify commit objects, fsync and write trusted stage **before checkout**. Do not
   derive a recovery base from cache HEAD. Concurrent later fetches cannot replace
   these pins. A retry uses pinned IDs and its original ref/target intent.
4. For the first materialization, clone bare from cache into a helper-owned staging
   allocation using `--no-local` and no hardlinks/alternates. Validate pinned
   object presence and that `origin` is the service-owned cache. Promote completed
   common data into the reserved path under root control; then create the detached
   worktree at the pinned base. Keep interrupted staging data, and repair/retry
   only an unexposed allocation whose root intent proves ownership. Never adopt
   an arbitrary existing `.git` as a trusted workspace.
5. Before returning success, verify worktree HEAD/index/tree and instructions,
   persist root `ready` plus the local result, then send the existing `EffectResult`
   with top-level `workspace_id`, `path`, `instruction_files` and nested
   `workspace_metadata`. A crash after checkout/before acknowledgement returns
   the retained same result.
   If checkout was interrupted before root `ready`, complete only that provably
   unexposed initial checkout under the same pins after old workers are absent;
   unexpected user data or identity requires recovery instead of deletion/reset.
6. On a later lease/open, require the existing root marker and fixed base/target.
   Fetch the fixed target into the cache and refresh only remote-tracking refs in
   the existing common repository, using uncredentialed cache transport and exact
   safe-directory scopes. Pin the new target observation for this lease. Do not
   move HEAD, reset files/index, checkout the new remote tip, or change base/target
   because Project defaults changed. Duplicate opens within the lease return its
   original open result, with no second refresh.

The cache is infrastructure, not a Task branch/delivery lineage. Its filesystem
permissions deny Node pushes to `origin`; no mirror/all-ref push exists. Stage A
public and private fetches both use this same local cache→workspace path. Existing
`gitEnv` must accept exact cache/common scopes and separate credentialed service
environment from uncredentialed execution Git; remove its hard-coded fixture
safe-directory entry only on the canonical path.

## Lease settlement and finalization seam

Backend lease lifecycle is `held → settling → released`, with no TTL-based release.
Successful open leaves it held. Existing Stop/failure admission fences the Attempt
and records a settling operation; it does not free the physical lease. A same-Task
successor cannot be promoted until both old process ownership and workspace/system
effects have settled. A queued Attempt with no open has no workspace to settle.

For canonical Stop with an opened workspace, first finish/reconcile earlier open
effects, then stop the Agent cgroup, then capture a private checkpoint as a system
execution-account effect. Use a temporary index to snapshot tracked changes and
nonignored untracked files without modifying the Agent's actual index/HEAD. Pin
the tree, original HEAD, commit inputs and operation ref before acknowledging;
export the checkpoint object through the existing service-owned result-import
path. Keep ignored files/worktree contents in place. This checkpoint is **not** a
Node completion and must not advance `task_workspaces.finalized_commit`.

`EffectResult.workspace_metadata.checkpoint` plus `writer_absent=true` is required
to release a lease that exposed a workspace and did not complete. Retain root/backend
attribution of the interrupted Node activation. Continue/Retry of that same
activation receives a fresh lease, validates its retained private state and reuses
the same files without resetting them. A missing/changed checkpoint or missing
workspace blocks recovery rather than overwriting work. A different activation
cannot silently adopt interrupted files; its explicit disposition/restoration
belongs to the later invalidation/replacement settlement leaf. This is the
conservative Stage A boundary, not automatic workspace migration.

Adapt `finalize(workspace,common,operation,base)` and `Export` to explicit validated
Task workspace paths. The trusted finalization `base` is this lease's retained
activation-start finalized revision from root metadata, not a scan for an open
operation under the same Attempt. Keep deterministic commit-tree metadata,
operation refs and ancestry checks. On canonical complete, capture/export exact
commit/tree, then backend validates current activation and advances the Task
workspace finalized pointer in the same transaction as formal Node completion.
The next lease begins there. New repository-free completion is intentionally not
invented here; it is leaf 3 work. Legacy fixture finalization remains byte-compatible.

### Exact cancellation of an unexposed open

Add `Operation.state = cancelled`, with required
`Operation.cancelled_by_operation_id: Id` for that state, and optional
`OperationResult.cancelled_by_operation_id: Id` for the settlement result. When present, schema requires
`success=false`, `result.writer_absent=true`, no workspace success payload and no
failure_kind. Only a canonical open may use it, and backend verifies the referenced
Stop operation was admitted for the same fenced Attempt/lease. This is system
reconciliation evidence, never an Agent-authored cancellation capability. Store
`operations.cancelled_by_operation_id` and the cancellation result immutably.

An unavailable/failed open must remain recoverable but cannot trap Stop forever:
when an admitted Stop fences the Attempt, terminate/reconcile its Agent and all
associated cache/materialization workers, then settle an unexposed open with the
cancellation result above. A root ready marker is treated as potentially exposed
even if its acknowledgement was lost: recover open success and checkpoint it,
never cancel/discard that initialized workspace. Update all `state <> 'succeeded'` unresolved predicates to distinguish
terminal succeeded/cancelled from admitted/recovery. Update operation-state read
contracts and daemon cached-result handling at the same time: a recorded cancelled
result is terminal and must not restart its worker. The cancelling-operation link
is mutable settlement attribution, excluded from immutable descriptor equality.
For a cancelled open,
`receiptResponse` returns `{schema_version:1, request_id, status:'error',
operation_id, error:{code:'unmet_precondition', message:'Workspace open was
cancelled by Stop; no workspace was granted.'}}`; never synthesize committed
workspace data. Preserve the retained initial receipt/envelope and project its
terminal operation result, as the current admitted-to-committed lookup does. Exposed workspace opens are
already succeeded and use the checkpoint settlement above. When the open instead
settled cancelled, the matching Stop may release its lease with writer_absent=true
and no workspace fields/checkpoint, because no workspace was granted. Backend
requires that exact cancelled open and cancellation link; this is not a generic
missing-checkpoint bypass. This small cancellation
contract must be included in both sides' schema before implementation; otherwise
expired credentials/network failure would permanently block Owner Stop.

For a fully cancelled never-exposed reservation (`ever_materialized=false`, no
live lease/worker), resource removal is allowed and a different resource can be
opened; it does not consume the Stage A one-materialized-repository limit. A new
authenticated open of that same logical workspace may capture current defaults
with a new lease/operation, while root preserves the old unexposed staging data
under its old operation. It must not adopt it as a successful materialization.
Once ever_materialized is true, no such recapture is permitted. Missing initialized
storage remains a hard recovery boundary, never this provisional cancellation case.

## Build split and acceptance

**Shared first:** fix the definitions above, cancelled-effect result semantics,
cross-language descriptor/hash fixtures and the migration constraints. Backend
can then own authorization, descriptors/receipts, lease state/queue predicates and
provider exchange; Runner can independently own reservations, cache/worker paths,
trusted stages, exact replay and checkpoint/finalize adaptation. Integrate with
new canonical test-owned Node admissions, not by assigning fixture `resource_id`
to public Task records. Production Start/Plan/Node scheduling remains later leaves.

**Minimum real Linux/public trial, without App:** configure an active disposable
Project with an actual small public GitHub repository through Owner API; preserve
its real remote and positive public metadata. A test-owned authenticated canonical
Node calls open via bundled `monos`; assert exact base/branch/instructions, ordinary
workspace edits, denied cache push/write, absent secret exposure, duplicate open,
fresh Attempt reopen, target refresh without HEAD reset, and Stop/restart checkpoint
recovery under the existing two accounts. Change Project defaults and verify the
established workspace target stays fixed. No provider mutation or permanent new
service is required. Record versions and exact resource/operation/result IDs.

**Separately required private-token evidence:** actual authorized private repository
and configured App with read access; verify one-repository read-only token issuance,
private clone/fetch, token expiry/rotation recovery and denial for another private
repository. Inspect argv, durable records, Agent environment and Git config for
absence of token material using redacted/pass-fail evidence. A public fetch and
mocked App endpoint do not satisfy this claim. If private credentials are absent,
report that evidence gap while retaining the passing public/Linux evidence.

DB/Go tests additionally cover cross-scope/digest mismatch, two requests/one open,
resource removal versus admission, archived Project continuation, configured ref
changes during fetch, concurrent cache fetches, every pinned materialization crash
window, Stop during unavailable open, reconnect with old system worker still live,
missing storage marker, corrupted root versus Agent-writable metadata, unexpected
workspace HEAD, low-disk durable-write failure, and legacy fixture receipt replay.
No test may claim that public transport or prompt/path reservations establish an
adversarial per-Attempt host filesystem sandbox.
