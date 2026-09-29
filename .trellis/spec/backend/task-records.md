# Task control and revision records

## 1. Scope / Trigger

Task initialization, immutable Specification/Plan publication, effective membership
and Node activation changes. `task-records.ts` owns transaction-local primitives;
the command module owns authentication, receipts, formal events and durable intents.

## 2. Signatures

- `initializeTask(tx, {task_id, specification_id, specification, project_id?, creation?})` creates PLANNING
  with no Plan, Node, Attempt or scheduling side effect.
- `publishInitialPlan(tx, {task_id, plan_id, expected, nodes, claim})` writes the
  graph, first activations and effective pointer atomically.
- `publishPlanningSpecification(tx, token, input)` consumes exact authorization,
  appends a parent-linked revision and switches the pre-start pointer.
- `assertCurrentNode(tx, {task_id, node_id, node_activation})` checks membership/basis.
- `reactivateSettledNodes(tx, {task_id, expected, node_ids})` expands descendants,
  checks physical settlement and appends activations, retaining historical results.

## 3. Contracts

`tasks` remains the physical canonical control row: state, control version and
effective revision pointers are not copied into another control table. A nullable
Plan is normal before initial publication; probe resource identity is nullable
for future Project-owned resource lookup and is not a formal Task resource binding.

The optional internal `creation` input is supplied only by the exact
[Task preview](task-preview.md) command transaction. It binds immutable title,
Todo, source proposal, confirmation and initial Specification metadata in the
initial insert; it does not retrofit old fixture history. Canonical public
creation requires an active Project and exact Markdown.

Migration 5 adds same-Task foreign keys, immutable revision metadata, `plan_nodes`,
`node_activations` and `node_completions`. New Attempts record Specification/Plan
bases. Existing historical metadata remains null where unavailable. Reconstructed
current activations are explicitly marked `legacy_current`, never claimed as
recorded launch evidence. Existing completed operations retain completion history.

Graphs must be complete in the revision-creation transaction: PostgreSQL checks
the Plan row's inserting transaction on member insertion and forbids later inserts,
updates and deletes. Revision/activation/completion rows cannot be updated/deleted.
Mutable Node state/result is only the current projection. No Role instruction
snapshots, Attempt-as-Node, or rewritten old revision content.

Initial Plan publication requires current live Planner claim/fencing and its recorded
launch Specification, RUNNING/no Plan, and exact expected control/Specification/Plan
basis. Task lock serializes publication. If Runner capacity is involved, lock Runner
first; Owner session precedes Task for confirmation consumption. Pre-start revision
publication is PLANNING-only. Started changes require later settlement operations.

Reactivation requires every affected Node's Attempts physically released and all
their operations settled. It increments activation, appends basis and clears current
result, without deleting old completions. Its caller must apply Owner-stop/input/
delivery/Rework policy guards and write the decision/receipt/outbox in this transaction.
It is not independently exposed as a public command or scheduler.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Duplicate/missing/cyclic graph reference or oversized graph | `invalid_input` |
| Wrong Task/target/claim ownership | `denied_scope` |
| Changed control/revision or obsolete Planner launch Specification | `version_conflict` |
| Revoked claim, wrong fencing or old activation | `stale_execution` |
| Wrong publication state or unresolved old writer/effect | `unmet_precondition` |
| Cross-Task database reference | PostgreSQL foreign-key rejection |
| Changed committed graph/revision/history | PostgreSQL check rejection |
| Transaction failure | No partial pointer, graph, activation or consumed authorization |

## 5. Good / Base / Bad Cases

Good: concurrent Plan publications commit exactly one complete graph. Base: an
authenticated old completion receipt remains readable after reactivation. Bad:
relabeling that old completion as evidence for the new activation.

## 6. Tests Required

`postgres-task-records.test.ts` covers initialization, graph validation/concurrency,
stale Planner claim/basis, observer-visible atomicity, authorized revision rollback,
cross-Task foreign keys, descendant reactivation and completion retention, stale
Plan completion settlement, and populated version-4 upgrade. Run the complete
database suite because fixtures and native crash workers share these records.

## 7. Wrong vs Correct

Wrong: update `plan_revisions.content` or append members to a published Plan.
Correct: insert a new immutable revision and complete graph, then switch the
effective pointer in the authorized publication transaction. Full Replan policy
and post-start settlement remain later work.
