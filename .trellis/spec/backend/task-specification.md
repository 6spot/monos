# Exact Specification revisions

Implementation: `apps/server/src/task-specification*.ts`, migration20.
Architecture: docs02 requirement changes, docs05 Tool Protocol, docs06 publication.
Full source and native acceptance passed on2026-10-01; the task verification and
independent acceptance reports retain exact frozen source and host evidence.

## 1. Scope / Trigger

Complete requirements may change while retaining the current sufficient single-Node
Plan. Preserve Task, immutable Plan/Node definitions and historical completion
bases. Replacement graphs belong to Replan; they must share the Task publication
slot when implemented. No new Runner operation or permanent service is introduced.

## 2. Signatures

Canonical Task Conversation commands:

```text
prepare_specification_revision({proposal_id, specification, summary, basis,
  impact, source_input_ids, supersedes?})
commit_task_turn(... routing: {kind: "specification_proposal", ...})
apply_specification_revision({proposal_id, confirmation_id, basis})
```

Owner `POST /v1/owner/tasks/specification/commands` takes
`{schema_version:1, request_id, task_id, name, payload}`. Names are
`edit_specification`, `confirm_specification`, `apply_specification_revision`,
`withdraw_specification`, `retry_specification`, `defer_specification_inputs`.
Confirmation payload is `{proposal_id, content_digest}`; withdrawal is
`{proposal_id, expected_version}`; Retry is `{operation_id, expected_version}`;
deferral is `{proposal_id, inputs:[{input_id, version}]}`.

GET `/v1/owner/tasks/:task_id/specification` supplies current status; suffixes
`/proposals`, `/proposals/:proposal_id`, `/revisions`, `/revisions/:revision_id`
and `/commands/:request_id` expose scoped history and immutable recovery.
`/changes/:change_id?cursor=...` returns typed operation status/version/attention,
up to64 physical effects with operation/Attempt/kind/state/failure/release fields
and an effect cursor, plus up to64 attributed Attempts and `attempts_has_more`.
Proposal/revision history pages are32 entries; current status prefers active
proposals and returns64 summaries with explicit has-more flags.

Migration20 owns `requirement_proposals`, `requirement_sources`,
`requirement_attachments`, `requirement_obligations`, `requirement_changes`,
`requirement_change_attempts`, `requirement_change_effects`,
`requirement_input_deferrals`, `requirement_publications`,
`requirement_authorization_commands`, `task_publication_slots`,
`specification_node_applicability`. Authorization creation links its exact Owner
receipt; changes bind `admission_request_id` and nullable `admission_attempt_id`
to the actual Owner or canonical Agent receipt consuming that authorization.

## 3. Contracts

Preparation is nonterminal. Only the original canonical source's committed reply
attaches its draft. Unattached drafts neither authorize execution nor create an
orphaned acceptance guard. Replacement shares its predecessor's obligation.

The generic Owner proposal envelope binds full text, summary, exact impact,
Task/proposal/source IDs, normalized input IDs and cutoff, base Spec/Plan/control,
and content/impact digests. Specification is bounded to65536 characters, preparation
summary to4096; do not narrow unrelated completion summaries. Required content
cannot be truncated. Results contain `schema_version`, `request_id`, status
`committed|admitted|unknown` and applicable proposal/digest/confirmation/operation/
revision/version fields; bind Task scope from the request, not an absent result field.

Impact declares `graph_sufficient:true`, complete current Node membership and
unique guidance IDs with exact versions. Each Node binds activation, source,
completion operation and manifest digest (explicit null when absent). `refresh`
requires fresh source authority and preserves unfinished activation/private work;
if trusted settlement completed it, its preauthorized consequence is a fresh
activation. `invalidate` replaces completed activation. `carry` retains only the
exact completed evidence through immutable applicability, including prior links.
No historical source, completion or v1/v2 manifest hash is relabeled.

Owner apply admits without Runtime availability. Agent apply requires its exact
current source and Owner receipt; its own pending input must first be explicitly
Owner-deferred. Apply remains nonterminal and still requires the canonical reply.
Later input checks run at confirmation, admission and publication. Deferral excuses
only the exact input/version gate, never changed impact or independent guidance.

Lock Owner/configuration, discovered Runners, then Task and owned records; revalidate
Runner discovery before proceeding. Admission consumes authorization, persists one
operation-owned freeze and fences old authority with existing Stop/settlement in
one transaction. Both scheduling and result projection obey that freeze. Backend
`specification_change` settlement purpose must not trigger old-basis correction.
Truthful physical completion must remain settleable after semantic source revocation.

Publication waits for original processes/effects/leases, then atomically appends
revision/applicability, switches current pointer, updates activation and resolves
its own obligation/slot. Preserve Owner Stop and unrelated blockers. Never-started
Tasks stay PLANNING. Withdrawal first reconciles admitted effects and retains old
Spec; it cannot resurrect old Attempts or acceptance. Replacement cannot admit over
an unreconciled predecessor. Retry retains original effect/manifest identities.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Changed request body under same identity | `payload_conflict`, original receipt retained |
| Applied proposal with another confirmation | `payload_conflict` |
| Wrong Task/source or authorization | `denied_scope` |
| Changed base/control/activation/evidence | `version_conflict` |
| Draft, replaced, withdrawn or expired proposal | `unmet_precondition` |
| Later unresolved input without exact deferral | `unmet_precondition` |
| Duplicate guidance IDs with differing dispositions | `invalid_input` |
| Terminal Task or accepted delivery | `unmet_precondition` |
| Insufficient graph or malformed bounded payload | Reject; no partial publication |

Database constraints must independently reject substituted proposal/obligation,
source, receipt, completion/applicability and prematurely released freeze attribution.
A valid foreign key alone is insufficient proof of exact authorization.
Use `IS NOT TRUE` for compound positive JSON predicates: `NOT(predicate)` alone
does not reject SQL NULL from missing fields. Avoid `old`/`new` as query aliases
inside PL/pgSQL triggers because they collide with transition records.

The pending-operation pump orders by `last_checked_at` and advances it without
changing semantic operation version. A fixed oldest-created LIMIT can starve every
later Task behind physically unresolved operations; polling is not a new decision.

## 5. Good / Base / Bad Cases

Base: complete pre-Start Owner edit publishes requirements without creating work.
Good: attached Planner proposal receives exact confirmation, settles private work,
publishes fresh context while Owner Stop remains; explicit Continue resumes it.
Bad: confirm an unattached draft, silently omit a guidance ID, defer via an ordinary
message receipt, or delete a settling operation's freeze.

## 6. Tests Required

Real PG main/settlement/reviewer suites cover scope, replacements, withdrawal,
input orders, hard completion, Owner Stop and explicit applicability. Independent
process tests must observe different backend PIDs and actual lock contention;
SIGKILL before/after admission and publication COMMIT must retain atomic receipts
and recoverable ownership. Run prior planning/Node/Conversation regressions.

Native evidence must match independently preserved command bytes to proposal,
source, authorization, receipt and publication, and separately establish original
process absence, lease settlement and real Git continuity. Use one-statement DB
snapshots; fixture declarations are observations, never source authority. Preserve
failed runs. A finalized predecessor requires a completed-result observer; the
unfinished `held_for_stop` driver cannot establish that comparison.
An existing matching-hash driver must also be root-owned, immutable to the Agent
and readable by the Agent. A crash before chmod can leave0600 bytes; reject that
incomplete install rather than recording a successful usable-driver check.

## 7. Wrong vs Correct

Wrong: accept two guidance objects with the same ID because JSON objects differ.
Correct: require unique IDs and complete exact membership before authorization.

Wrong: treat any same-Task Owner receipt as an input deferral or clear freeze when
logical Stop is recorded. Correct: bind exact command/payload/response attribution,
and release only after the admitted operation's physical settlement and resolution.
