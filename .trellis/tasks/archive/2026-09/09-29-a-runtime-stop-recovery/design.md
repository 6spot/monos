# Design: Owner Stop and restart reconciliation

## Boundary

The backend owns Owner intent, Task/Node transitions, Attempt fencing, durable command receipts and effect admission. The Runner owns supervised processes, the local journal and whole-tree Stop. The browser reads canonical facts and never changes lifecycle locally. All Owner controls use authenticated Tool Protocol requests; natural-language output and Runtime logs have no transition authority.

This leaf extends the selected Attempt path built by the previous two Runtime leaves. Full Task conversation/context construction and Task-detail UI remain later packages. Continue/Retry restores scheduling eligibility. It does not invent a prompt or immediately launch from a stale historical `Dispatch.launch` value. A later owning Task command passes current canonical context through `RuntimeScheduling.selectAndEnqueue`.

## Command and read contracts

- Extend the versioned Owner command schema with discriminated `stop_node`, `continue_node`, `retry_node`, `stop_initial_planning` and `retry_initial_planning` actions. Keep the existing `confirm_proposal` request and response decodable. Every execution action binds Task ID, request ID, expected control version and an exact target Node/Attempt or Planner Attempt; Node commands also bind activation. Generate TS/Go/OpenAPI from the schema.
- Owner command receipts are keyed by `(scope_id, request_id)`. Authenticate the session, then check the existing receipt and canonical request digest before validating the current version or target state. Store the state change, formal event, Stop effect/outbox where applicable, and immutable response in one transaction. Return an admitted operation reference when physical settlement remains pending; status reads replay the original command identity and can reflect its later operation state without converting the original admission into a second command.
- Add a scoped Owner operation read when the command result points to an outstanding Stop or recovery operation. Existing Task overview counts and Attempt status show queued/held/absent/released/end-reason facts. Expose the operation state and failure/attention separately from Task Event text; do not embed raw execution output in Timeline.
- Browser work in this leaf is limited to a small command/status contract test and any minimal API client helper needed for later Task detail. The full control surface remains in the Task UI package.

## Stop transaction and effect order

Use the established lock order: configuration/Owner session as required, then Runner capacity row, Task row, Attempt row, then operation/receipt rows. Obtain a candidate Runner ID without trusting that read after locking; recheck identity and current owner under locks. No transaction calls the Runner directly.

For a queued Node/Planner Attempt, cancel the queued selection and its Start intent atomically; it has no process reservation. For a RUNNING Attempt, revoke mutation authority, make the Attempt terminal with an objective Owner-stopped reason, mark any Start outbox row ineligible, and admit one stable Stop operation/outbox entry while retaining `process_released=false`. A delayed Start is still potentially in flight: the Runner's persisted cancellation tombstone and inventory reconcile it before absence/release. An identical Owner request replays the receipt and does not create a second Stop.

Node Stop sets only that Node BLOCKED; derive Task BLOCKED only if no independent running/runnable work remains. Initial-planning Stop applies only while no Plan is published, revokes the current Planner work and returns the Task to PLANNING. A published Plan never returns to PLANNING. Record exact end reason, operation identity, activation and formal event. Stop after terminal completion is a deterministic precondition result, not an undo.

An admitted `complete_node` or Planner formal reply owns the outcome. If it won the transaction before Owner Stop, return its operation/committed status and let it settle; do not admit a competing Stop that would deadlock the terminal-operation guard. If Owner Stop won first, the stale Agent handoff is rejected by fencing. Other admitted workspace effects must settle before a Stop result can release the physical claim. A failed Stop remains in recovery with explicit attention and its original operation ID.

## Continue, Retry and restart

`continue_node` is for a Node blocked by Owner Stop. `retry_node` is for a factual failed/missing-result blocker. Both require the old Attempt to be terminal, absent, released and free of unresolved effects, plus the current Node activation/basis; then they record the Owner decision and change the same Node to PENDING once. Re-derive Task state. They do not consume a Runner slot in that transaction. The existing selected-dispatch admission guard permits at most one later eligible Attempt and refuses changed locality or an unresolved old owner. Pre-Plan Retry returns the same Task to RUNNING only after its Planner owner has settled; it does not fabricate a Plan or reply.

Backend restart uses retained outbox/operation rows. Runner reconnect first consumes a complete inventory snapshot and reconciles its local start manifest, process birth, boot and cgroup before `Ready`. Replayed Start/Stop keep the same IDs. A changed host boot proves only absence of the old process tree; backend formal outcome, command receipts and any unsent Agent envelope remain unchanged until their owning reconciliation commits. Runner recovery lookups are read-only under the original scope and cannot renew old mutation authority.

## Compatibility and migration

Use additive wire/schema and database changes. Historical Owner confirmations, Attempt logs, Runner journal rows and old outbox operations remain decodable. If an older Runner reconnects without the required capability or complete inventory, selected work waits and physical ownership stays reserved. Do not add Task/Node states or a generic workflow engine.

## Validation and operations

- PostgreSQL tests cover both orders of Stop versus completion; queued cancel versus promotion; duplicate/conflicting Owner requests and stale basis; independent Node progress; Retry/Continue before and after Stop settlement; unknown outcome after a backend crash; Runner reconnect and outbox replay.
- Go tests cover duplicate Stop, delayed Start tombstone, retained operation result, old process identity and changed-boot reconciliation. Fault injection covers missing ACK, uncertain launch and journal failure.
- Real Linux trials use the selected installed CLI: Stop a live Node with detached descendants, verify no second writer/capacity release before absence, restart backend and Runner, and perform the authorized controlled host reboot from a private live checkpoint. Refresh the exact model catalog and verify zero prices before each new live call. Inspect both task-owned and old service activity before reboot; preserve evidence and journals.
- If a migration or new command fails, stop admitting the new Owner action while retaining all committed command receipts, outbox effects and process reservations for recovery. Do not roll back by deleting Attempt or journal rows.
