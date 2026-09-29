# Task-scoped Owner commands

## 1. Scope / Trigger

Use for Owner session authentication, immutable proposal preparation, exact
authorization consumption and selected execution Stop/recovery. Implementation:
`apps/server/src/owner-commands.ts` and `apps/server/src/owner-execution.ts`;
storage: `0004_owner_commands.sql` and `0012_owner_recovery.sql`. Public password
login is implemented by [Owner access](owner-access.md).

## 2. Signatures

- Internal `issueOwnerSession(db, ttl?)` / `revokeOwnerSession(db, sessionId)`.
- `prepareTaskProposal(tx, {id, task_id, action, content, ttl?})` returns proposal
  identity, canonical SHA256 digest and control/Specification/Plan basis.
- `POST /v1/owner/commands`: strict generated `OwnerCommand`, including
  `confirm_proposal`, `stop_node`, `continue_node`, `retry_node`,
  `stop_initial_planning` and `retry_initial_planning`.
- `GET /v1/owner/scopes/:scope_id/commands/:request_id`: `OwnerCommandResult`.
- `GET /v1/owner/tasks/:task_id/operations/:operation_id`:
  `OwnerOperationStatus`, scoped to the authenticated Task.
- `consumeTaskConfirmation(tx, token, confirmationId, requestId, binding)` binds
  `scope_id`, action and content digest in the caller's transaction.

## 3. Contracts

One Owner, no organization model. Opaque random `owner.v1` credentials are stored
only as hashes and cannot satisfy Runner/Attempt authentication. Session lifetime
is bounded to 24 hours; authentication applies even to receipt reads and replay.

Lock order is session -> Task -> proposal -> authorization. Prepare is server-only
and snapshots the locked Task basis. Conflicting proposal identity reuse fails,
including across concurrent Tasks. Confirmation checks its immutable request
receipt before current-state guards and reuses one authorization per proposal.
Confirmation does not execute the proposed action or advance Task control version.

Legacy selected-execution actions bind the exact Task, Attempt and control version; Node actions
also bind Node ID and activation. After Owner authentication, check an existing
`(scope_id, request_id)` receipt and its digest before resolving the new payload's
Attempt ID. Then retain Runner -> Task -> Attempt lock order and recheck the receipt
inside those locks before a new mutation. This gives a changed Attempt ID the
required `payload_conflict` even if that new ID does not exist. A queued Stop
cancels selected work without a process operation. A running Stop revokes Agent
mutation, records `owner_stopped`,
marks only its Node BLOCKED, and admits a durable whole-tree Stop while retaining
the physical claim. Initial-planning Stop applies only before Plan publication
and returns the Task to PLANNING. An admitted terminal Agent handoff wins a later
Owner Stop and returns its existing operation identity.

Legacy Continue accepts an Owner-stopped Node; Retry accepts a failed Node or stopped/
failed initial Planner. Require the old Attempt to be absent and physically
released with all operations settled. A recovery decision consumes that Attempt
once and restores eligibility in the same Task/Node lineage. It does not launch
a successor or reuse the old prompt; the owning Task module supplies current
canonical context to selected dispatch. An admitted Stop receipt remains immutable;
the operation read reports later settlement or recovery attention.

Canonical [Node execution](node-execution.md) uses exact source/activation/blocker
controls; old Attempt-only forms are rejected for those sources. A saved successor
may wait for cleanup, but promotion still requires settled physical ownership.
`recover_completion` repairs an exact original operation or settles it before
fresh correction. Cancel permits exact cleanup retry without Task/source revival.

Consumption revalidates eligibility/current basis and exact action/content/scope.
The domain caller must check its prior command receipt first, then consume, mutate
and store its command result in the same transaction. `consumed_by` alone is not
a domain command result. Same-request re-entry requires the caller's receipt-first
contract; different consumers cannot reuse the receipt.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Wrong, expired or revoked credential | `unauthorized` |
| Unknown/wrong Task, proposal or action binding | `denied_scope` |
| Changed request/proposal/content or different consumer | `payload_conflict` |
| Existing execution request ID with a different or nonexistent `payload.attempt_id` | `payload_conflict` before target lookup |
| Changed control, Specification or Plan basis | `version_conflict` |
| Expired/revoked proposal | `unmet_precondition` for new confirmation/consumption |
| Known identical committed request | Original result, despite later stale proposal |
| Missing receipt | `unknown`, without success/failure inference |
| Old process or operation unresolved | Legacy Continue/Retry rejects; canonical successor waits without promotion |
| Stop settles with Runner failure | Original operation enters `recovery`; retain claim and show attention |

## 5. Good / Base / Bad Cases

Good: concurrent confirmations yield one authorization. Base: cross-device retry
uses the same request ID and replays the receipt. Bad: a new request refreshes the
expected version to approve changed proposal content.

## 6. Tests Required

`postgres-owner.test.ts` checks principal isolation at HTTP boundaries, hashed
credentials/revocation, replay/conflicts, cross-Task proposal races, exact basis,
expiry and transactional consumption rollback. Shared TS/Go fixtures check strict
Owner schemas, unsupported versions and committed/unknown result fields.
`postgres-owner-execution.test.ts` checks running/queued Node and pre-Plan Planner
Stop, replay/conflict, physical settlement guards, completion-first ordering and
one-time recovery. The browser API test checks admitted receipt recovery.

Migrations 4 and 12 are additive and retain existing Attempt receipts. Run migrations in
isolated real schemas; never drop canonical tables to validate it. Rollback means
stopping new Owner routes while retaining persisted authorization/history.

## 7. Wrong vs Correct

Wrong: commit authorization consumption, then perform the domain mutation later.
Correct: use one `transaction(db, async tx => ...)` for receipt-first lookup,
consumption, domain mutation and immutable command result.

Wrong: resolve a changed `payload.attempt_id` before comparing an existing
`scope_id/request_id` receipt, leaking `denied_scope` instead of detecting reuse.
Correct: authenticate, compare the existing digest, then resolve and lock the
target for a new request; assert this with a changed nonexistent Attempt ID.
