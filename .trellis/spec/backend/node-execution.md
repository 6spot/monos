# Single-Node execution, Artifacts and recovery

Sources: `apps/server/src/{node-execution,node-execution-state,node-completion,artifacts}.ts`,
`packages/db/migrations/0018_node_execution.sql` and the shared protocol schema.
Task Conversation extends these contracts via [guidance handling](task-conversation.md).
Spec/Plan changes and delivery remain separate roadmap tasks.

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
- System-only `settle_completion` binds original completion ID/digest and exact
  immutable workspace/lease/Attempt identity. No new environment keys or service.

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

Repository-free completion is explicit (`repository_free:true`, manifest digest),
requires whole-tree absence and forbids fabricated Git/workspace fields. A dirty
same-activation workspace must be reopened/finalized even by a fresh Attempt.
Success creates current evidence and derives REVIEW only after ownership settles.
Recoverable completion remains RUNNING with attention; hard failure blocks and
retains ownership. `block_node` is a successful semantic handoff with an answerable
blocker, followed by fenced Stop.

Hard recovery retries the exact immutable operation or admits trusted settlement
then correction. Never replace original lease `settle_operation_id`. Reconcile
already-finalized success first; otherwise capture/export a separate checkpoint
after quiescing old workers. Only recovery capture tolerates readable broken
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
| Unsupported multi-Node Plan / exhausted policy | Factual blocker; Owner Retry |
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
