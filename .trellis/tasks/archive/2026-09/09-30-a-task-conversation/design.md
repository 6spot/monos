# Task Conversation design

## Boundary

The missing behavior is canonical ordered Task input plus durable guidance. The
owning implementation is a Task conversation/input module and Task guidance module
inside the existing backend. Runtime continues to own selection, dispatch and
physical effects; the Go Runner only enforces source scope and executes frozen
input. Todo history, immutable Spec/Plan records and existing Node physical recovery
remain separate authorities. No service, scheduler or lifecycle is added.

Requirements and source anchors: `prd.md`, `research/backend-seams.md`,
`research/runner-guidance.md`, `research/acceptance.md`. The following choices are
technical implementation decisions made under the Owner's standing authorization.

## Input and Planner authority

- Extend Task-owned control with independent conversation ordering/version/head
  facts. Store append-only messages and immutable per-source interpretation or
  withdrawal, with unique source resolution. Use one Owner message per turn for
  Stage A; this is a bounded immutable batch of one and preserves all source IDs.
- Store frozen context/prompt/digest and planned Attempt in a durable source outbox.
  Retry retains original input but creates a fresh source; it never rewrites a
  launched source. Withdrawal records an Owner disposition, revokes queued/live
  source authority, schedules cleanup and advances the watermark once.
- Reuse `planner:<task>` for initial planning and conversation. Preparation and
  selection remain separate transactions with configuration -> Runner -> Task ->
  source/Attempt lock order. Owner session/request serialization precedes these.
  A successor may be retained while cleanup waits; promotion cannot bypass a held
  physical owner or outstanding effect.
- Source authority has an immutable epoch/head and exact source watermark.
  Appending later messages cannot invalidate the earlier active turn. Ordinary
  submit/reply/Retry/Withdraw/failure touch conversation facts, not execution
  `control_version`. This includes missing-formal-outcome and cancellation paths.
- Initial planning already selected/running completes its phase before conversation
  acquires the shared claim. Pending conversation and initial-planning intents
  arbitrate durably, without holding a claim merely for an Owner decision. Before
  Start, conversation alone is eligible and never creates initial planning intent.

## Public commands and reads

Use the existing authenticated Owner session infrastructure with a Task-specific
command/receipt schema, keeping conversation versions separate from execution:

- `POST /v1/owner/tasks/conversation/commands`: `TaskConversationCommand` with
  immutable `request_id`, `task_id`, name and payload.
- `submit_task_message {message_id,content}` needs no execution CAS;
  `retry_task_input`, `withdraw_task_input`, `stop_task_turn` bind
  `{operation_id}` and exact `expected_version` of the input/obligation.
- `GET /v1/owner/tasks/:task_id/conversation`, `/conversation/messages?cursor=&query=`,
  `/conversation/commands/:request_id` expose bounded status, history and receipt
  recovery. Existing Task Attempt/operation reads retain physical facts.
- Agent `read_task_context` and `read_task_history` are source-scoped reads;
  canonical routing kinds are `reply`, `guidance`, `issue`, `answer` and
  `resolve_guidance`. Non-reply routing carries exact `TaskActionBasis`. Legacy probe
  `reply_only` is rejected by canonical conversation.

Persist `task_inputs`, `task_messages`, `task_conversation_outbox`, immutable
`task_input_resolutions`, `task_guidance`, `task_guidance_obligations`,
`task_guidance_assignments`, `task_guidance_followups`, `task_input_issues` and
`task_input_answers`. Current conversation sequence/watermark/version and
input/source pointers belong to `tasks`. The conversation outbox's `done` means
selection consumed, not semantic completion. These are domain-specific records,
not additional runtime queues.

`commit_task_turn` gains canonical source-bound handling. A legacy probe remains
explicitly legacy. Add Task-only bounded context/history read commands to the
installed CLI. A conversation Dispatch has an optional distinct
`task_conversation_source`, mutually exclusive with Todo/initial/Node sources,
empty workspace reservations and no Node/resource identity. Its envelope control
version represents conversation source authority. Routing separately carries
current execution basis when it requests effects.

Reply-only commit validates current source/claim/watermark, records observed
execution basis/time and resolves only its input. Node progress does not prevent
that reply. Guidance/action routing checks current Spec/Plan, execution control,
Node/source/activation and completion facts under the same Task lock. A stale
action can refresh bounded current context and prepare a new command; it cannot
rewrite an uncertain original request ID or use a newer version to revive stale
semantic assessment automatically.

Replies/route/disposition, source resolution, watermark, immutable receipt,
SUCCEEDED/fenced Planner, repository-free Stop and next intent commit atomically.
Only the source interpretation completes; an open guidance/change/issue obligation
remains independent, allowing later conversation. Deferred scope changes must be
described as pending with an explicit Owner exit. Exact Spec proposals/publication
are the next leaf and are never claimed effective here.

## Context and bounds

Freeze actual Owner Planner guidance, current Project/Role descriptors where
needed, effective Spec/Plan, relevant Node/Artifact metadata, scoped open operation
facts, active guidance, bounded recent Task history and exact input. Native provider
memory is not authority. Exclude Todo capture/cache/discussion, other Tasks, raw
logs, full unrelated Role instructions and repository bytes. Validate combined
UTF-8/code-point/encoded Dispatch and response-wrapper limits; preserve oversized
input with preparation attention instead of dropping required material.

History search is Task- and source-cutoff-bound. Earlier replies are eligible by
the Owner input they resolved even when their append sequence is later; later
Owner input and replies cannot leak into the current turn. Preserve withdrawal
labels. Owner pages show a bounded recent window with canonical scoped cursors.

## Guidance and follow-up

Persist immutable guidance content/source/applicability, per-Node/activation
obligations, and immutable assignments to Node source/Attempt/dispatch. Separate
supersession/withdrawal/handling history from launch transport facts. Frozen
source context deterministically includes active relevant instructions and exact
required IDs. A supervised `started` event establishes launch, not provider
consumption or implementation.

Pre-Plan guidance is Task-scoped. Existing initial-planning sources remain frozen;
fresh planning sources can include already-active guidance. Actual Plan publication
binds guidance to its Node, so the Node receives it without implicit Start or a
fake Plan revision. Guidance cannot change formal requirements or definitions.

For PENDING/QUEUED/running unfinished work, Planner routing authorizes an in-scope
successor with the same activation. Retire an incompatible queued source or fence
the running Attempt and admit/reuse trusted Stop. Preserve private checkpoint and
wait for all physical ownership/effects/leases before successor promotion. Do not
call Owner Stop/Continue internally or record invented Owner intent. Owner Stop
and independent semantic/factual blockers retain precedence; guidance stays pending
until the explicit permitted action resumes work.

Completion admission freezes its manifest. Later guidance cannot join it. Retain
a follow-up intent with recorded impact policy while that exact completion settles;
hard failure retains its explicit recovery owner. After successful completion and
physical release, use `reactivateSettledNodes` plus a fresh canonical source when
the guidance requires more work. Old activation/completion/Artifacts remain history.
An answer that establishes no further work is needed remains a Planner decision,
not an infrastructure inference from exit. Pending obligations guard acceptance
and affected downstream work until handled or explicitly resolved.

`complete_node.handled_guidance_ids` becomes a bounded unique ID list. Absent/[]
declares none. Every supplied ID must belong to its frozen exact assignment; every
still-required launch obligation must be declared or completion rejects before
fencing. `block_node` can leave it unresolved. Withdrawn/superseded assigned IDs
may retain historical declaration but cannot undo their disposition. Bind IDs and
assignment provenance into new immutable completion manifests; preserve all old
manifest digests/physical operation identities without reinterpretation.

Only successful trusted completion projection closes active declared obligations,
atomically with completion evidence. Same-operation Retry keeps the same manifest.
Cancelled hard-settlement pairs close none; fresh correcting sources receive active
guidance. Already-finalized reconciliation settles only the original manifest and
preserves later follow-up. Task Cancel keeps truthful history and cannot revive
execution through a late completion or chat.

## Execution isolation and delivery seam

Narrow the blanket held-workspace queue exclusion only for authenticated canonical
scratch-only Task conversation. It must run on the reserved Task host and share
ordinary capacity. No Planner writable workspace, legacy-probe exemption or
parallel Node writer is granted.

Terminal Tasks permit source-bound reply-only Attempts. Accepted delivery requires
actual batch/cutoff attribution under Task lock; proposal/confirmation records do
not imply acceptance. A small internal control seam can expose an actual future
accepted batch to input admission and action guards, but no public acceptance
shortcut is introduced. Direct database contract tests cover nonblocking later
input. Real delivery integration is a later roadmap gate.

## Migration, compatibility and operations

Use additive migration 19 with same-Task/Node/activation/source foreign keys,
unique source resolutions and immutable content/assignment protection. Existing
receipts, launch bytes, manifest digests and old explicit probe behavior retain
their meaning. Do not backfill invented historical guidance or source identity.
Generated TS/Go/OpenAPI/schema fixtures evolve together, preserving absent/empty.

Runner CLI allowlists, scope checks, helper effects and finite reconnect Stop
recovery recognize the new source. Conversation uses only the existing one-shot
native run and repository-free Stop. No live input transport is advertised.

Root freezes the verified source, builds/tests on Linux and installs into the
existing services using retained private backups and unchanged port18444. Rollback
is disabling new admission/reverting binaries only after compatibility review;
canonical data and unresolved journals are never dropped. Native trials use fresh
identities and preserve failed observations. See the acceptance research for exact
evidence obligations and scoped limits.
