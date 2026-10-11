# Node execution, Artifacts and recovery

Sources: `apps/server/src/{node-execution,node-execution-state,node-completion,artifacts}.ts`,
`packages/db/migrations/{0018_node_execution,0031_multi_repository_completion}.sql`
and the shared protocol schema.
Task Conversation extends these contracts via [guidance handling](task-conversation.md).
Multi-Node replacement Plans follow [Replan](task-replan.md). Independent Nodes
use [isolated allocations](workspaces.md); upstream Agent-requested Rework retains
the conservative cross-Node settlement precondition described below.

## 1. Scope / Trigger

Dispatch after genuine source-bound `plan_published`, managed text output,
source-aware Owner control, completion recovery and local pre-delivery Cancel.
Natural-language output and process exit never complete a Node.

## 2. Signatures

- `Dispatch.node_execution_source` binds source, Node/activation, Spec/Plan,
  control version and frozen context digest. `node_execution_outbox` persists the
  source, planned Attempt and configuration version.
- `publish_artifact {artifact_id,title,content:{text,media_type},references?,supersedes?}`;
  `read_artifact {artifact_id}`; `block_node {reason}`.
- `complete_node {summary,artifact_ids?,handled_guidance_ids?}` freezes
  `completion_manifests`. Version2 includes bounded unique launch-assigned guidance
  IDs; omitted/[] means none. Required active assignments must be declared before
  fencing; successful trusted completion alone settles handling. Preserve historical
  version1 hashes and operation identities unchanged.
- Authenticated Owner GETs: `/v1/owner/tasks/:task_id/artifacts`,
  `/v1/owner/tasks/:task_id/artifacts/:artifact_id`, and
  `/v1/owner/tasks/:task_id/nodes/:node_id/execution`.
- Owner Stop/Continue/Retry bind Node/activation/source/applicable blocker and
  Task/control CAS. `recover_completion` also requires `operation_id`,
  `completion_identity_digest`, `mode:retry|correct`.
- System-only `settle_completion` binds only the original completion ID/digest;
  backend and Runner resolve the original immutable member set, lease/Attempt
  identities and aggregate result. Never copy member descriptors into a new
  settlement identity. No new environment keys or service.

## 3. Contracts

Discover only effective public Plan membership with original Planner source
provenance. Arbitrary PENDING fixture Nodes confer no production authority.
Under configuration SHARE and Task/Node locks, freeze effective Spec, exact Node,
full current referenced Role (including archived Role), Project map **and matching
workspace reservations**, resolved initial-planning answers and bounded historical
Artifact/recovery metadata, plus active applicable Task guidance and exact source
assignments. Exclude Todo/cache/sessions, Planner Guidance, other Roles/Tasks, raw
logs and Git bytes. Historical Artifact publication is not current
completion. Queue identity and prompt cannot refresh after configuration changes.

Automatic source preparation waits for current completed dependencies and prior
ownership of the same Node, subject to direct-workspace exclusivity. Prepare a
bounded batch of independent ready Nodes with frozen isolated placement; a
downstream source observes current Role configuration and completed integration
evidence. Explicit Owner/guidance/Runtime continuation intents may be retained before
settlement, but cannot queue or promote before their dependency and physical barriers.
An unresolved Task completion also blocks source preparation, queue admission/
promotion and new workspace opens until its aggregate settlement is durable,
including hard recovery.

`node-upstream-context.ts` includes current completed direct dependencies, exact
completion/manifest identity, summary/revision and only selected Artifact metadata.
Bodies remain behind `read_artifact`; unselected and obsolete activation outputs
do not become upstream evidence. Refuse an oversized context without clipping.

Canonical Node command versions bind the frozen Node source. A Task control change
for another Node cannot revoke that source: continue to validate the exact current
source pointer, activation, effective Spec/Plan, mutation authority and freeze guards.
Owner commands still compare the live Task control version. Source replacement,
Rework and requirement changes fence affected work explicitly.

Guidance for completed work waits for the full affected descendant closure to
settle before reactivation. `inspectNodeReactivation` and the reactivation primitive
share the same check for queued Attempts, unreleased processes/leases and pending
operations under the Task lock. Unrelated live branches do not block that closure.
Completed Nodes evaluate prospective placement; their old direct source cannot
block an unrelated isolated writer after Replan. Live Nodes retain frozen placement.

Queue admission makes Node RUNNING. Offline/no-Runner/stale observation waits
durably; unsupported or exhausted selection records a factual blocker. Retry reads
current configuration into a fresh source. Same activation survives ordinary
Retry/Continue. Saved intent may wait for cleanup; successors cannot promote before
previous writers, operations and leases settle. Canonical sources reject legacy
attempt-targeted controls; explicitly legacy probes retain them.

Artifacts retain immutable Task/Node/activation/Attempt/source/Spec/Plan attribution,
SHA256 and byte size. UTF-8 text is at most 256 KiB; nonblank title 256 code points,
MIME 128 characters; at most 32 external HTTP(S) references with 2048-character URL
and optional 256-character label. IDs and supersedes preserve scope. Content and
encoded response wrapper must both fit transport limits. Owner content is JSON
with `Cache-Control:no-store` and `X-Content-Type-Options:nosniff`. HTML is data;
never execute it on application origin or fetch external references.

Omitted `artifact_ids` selects this Attempt's outputs; explicit IDs may select
earlier Attempts of this Node/activation; `[]` selects none. Late publication cannot
alter the manifest. `operations.result` is physical evidence;
`node_completions.result` merges it with manifest `summary`, `artifact_ids` and
`completion_manifest_digest`. These are deliberately different JSON objects.

One manifest and one parent `complete_node` operation cover the entire Attempt
member set, in stable resource order. Physical success requires `writer_absent:true`,
`completion_outcome:finalized|conflict` and exact `workspace_results[]` corresponding
to immutable `workspaces[]`. Repository-free completion has both arrays empty and
outcome `finalized`; it still requires whole-tree absence and cannot fabricate Git
fields. A dirty same-activation workspace must be reopened/finalized even by a
fresh Attempt. Finalized success creates one Node evidence record and derives
REVIEW only after ownership settles. A conflicting parent preserves every member
capture, advances no canonical repository pointer and creates no Node evidence;
it consumes one automatic conflict retry, regardless of member count.
Recoverable completion remains RUNNING with attention; hard failure blocks and
retains ownership. `block_node` is a successful semantic handoff with an answerable
blocker, followed by fenced Stop.

Hard recovery retries the exact immutable operation or admits trusted settlement
then correction. Never replace original leases' `settle_operation_id`. Resolve
the full original parent membership and reconcile already-finalized success first;
otherwise capture/export every member's separate checkpoint after quiescing old
workers. Only recovery capture tolerates readable broken
ancestry; ordinary Stop/finalize stay strict. Persist both dispositions atomically
before backend release. Original cancellation cannot independently bypass export;
after the pair commits, exact original tombstone replay succeeds idempotently.

Cancel binds Spec/Plan/control, revokes current sources and settles physical work.
Late completion cannot restore current evidence or REVIEW. Failed cleanup remains
retryable after Cancel through exact operation recovery, without reviving Task or
source or launching a correcting Agent.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Source/head/activation/digest/control mismatch | Stale/version error; no new authority |
| Cross-Task Artifact or wrong Node/activation selection | Scope/precondition rejection |
| Changed same request/Artifact ID | Conflict; original bytes retained |
| Oversized text, wrapper or context | Bounded error/preparation failure; no clipping |
| No Runner or stale observation | Durable waiting; no fake failed Attempt |
| Exhausted policy | Factual Node blocker; Owner Retry; independent runnable work stays RUNNING |
| Hard Git failure / absent objects | Retain ownership; no fabricated success |
| Semantic retry without exact answer | Reject; blocker remains unresolved |
| Cancelled Task cleanup retry | Exact physical retry only; no revival |

## 5. Good / Base / Bad Cases

Good: Stop checkpoints private work; Continue creates a fresh source; hard completion
settles the old pair; a correcting Attempt repairs ancestry and completes.
Base: no-resource Node publishes HTML, reads exact bytes and formally completes.
Bad: infer completion from prose or clear a lease because its Attempt is terminal.

## 6. Tests Required

Use real PostgreSQL independent-process source/queue contention, observed terminal
race lock orders and SIGKILL before/after commit. Assert frozen reservations under
configuration edits, immutable receipts/manifests, source controls, Artifact byte/
scope limits, paired rollback, Cancel cleanup and original replay. Shared TS/Go
fixtures bind omitted/empty values and operation identity digest. Runner race/vet
and real Git tests assert original intent/index/HEAD preservation, finalized-result
reconciliation, export durability and old-worker exclusion.

Native Linux/two-account acceptance compares actual Git trees, service exports,
required command receipts and journal envelope digests; missing receipts must fail.
Restart compares every Attempt field except migration 11's late raw-log projections
(`activity_at`, `log_visible_sequence`, `exit_observed`); this alone makes no raw-log
retention claim. Browser tests inspect exported HTML functionality.

## 7. Wrong vs Correct

Wrong: replace the original lease settle pointer, then let each operation wait on
the other. Correct: retain original identity, authorize a separate exact settlement
relation, quiesce/export and commit a typed atomic pair before releasing ownership.

## 8. Upstream Rework

`request_rework {target_node_id?,reason}` is a terminal canonical Node outcome.
Omission requires one direct dependency; an explicit target must be an ancestor.
Admission records the exact target-plus-descendant activation/source/completion
snapshot, fences the requester, and retains its complete Stop set plus Agent receipt
atomically. The serial implementation requires other Node writers and effects to
be settled and rejects competing requirement/Replan/review ownership and affected
Owner holds before any writes. Activation publication waits for Stop, process,
operation and lease settlement; existing identities and integrated code survive.

Migrations 27/31 persist `node_rework_requests`, `node_rework_targets`,
`node_rework_decisions`, exact `node_rework_request_stops` membership and
`tasks.rework_epoch`. Each Stop binds its original operation/workspace/lease; later
Stop rows cannot be substituted. Three automatic requests per epoch
span fallback, Retry and activation changes. A fourth records `limit_blocked` and
blocks only its requester. Independent work may proceed. Owner `apply_rework` and
`continue_without_rework` bind the preserved request/version and live Task control.
Apply verifies all saved targets and physical settlement, atomically publishes
activations and resets the epoch; Continue replaces the requester source at the
same activation without resetting the budget. Its answer survives delayed source
preparation. Committed outcomes are respectively `applied` at request version +2
and `continued` at version +1. Replays retain the original result.

Generic Stop/Retry/Continue cannot resolve request ownership. Completed-ancestor
guidance and Owner continuation check their entire reactivation closure, preventing
indirect invalidation of a limit-blocked requester. Cancel retains cleanup and
prevents late reactivation. SQL rejects limit-to-settling without an exact Owner
decision; no generic budget reset exists.

`GET /v1/owner/tasks/:task_id/rework` exposes reason, saved identity/version,
`stop_operation_ids`, settlement attention and current Apply/Continue capabilities.
A stale target makes
Apply unavailable while requester-only Continue may remain valid. UI retains
these decisions in the existing Task command journal and validates the matching
outcome before clearing an uncertain request.

Fresh context distinguishes applied correction from continued proposals and
historical completion evidence. `historical_checkpoints[]` carries each applied
workspace checkpoint's exact Stop, resource, immutable commit/tree and
`refs/monos/history/<request>`; each becomes readable after `open_workspace` for
that resource. Historical objects never overwrite current code.
Host archives both raw Git common storage and worktree, preserving ignored files
and separate index content which checkpoint Git trees do not fully represent.

Required focused evidence: real PostgreSQL admission/replay/limit/Cancel/control
contention, A→B→A2→B2 workspace provenance, native CLI/local source allowlists, real
Git archival interruption and history inspection, and browser saved-decision
recovery. Local macOS/fake Runner tests do not establish native Linux acceptance.
