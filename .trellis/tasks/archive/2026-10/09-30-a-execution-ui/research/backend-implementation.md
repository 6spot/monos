# Backend implementation progress

## Implemented read/session boundary

- `task-board-reads.ts` / `GET /v1/owner/tasks`: strict generated Project, column,
  attention and history filters; canonical filter-bound keyset cursor; 32-item and
  encoded 2 MiB bounds. Default active excludes terminal history. Per-column pages
  remain independently incomplete until `has_more=false`; no fabricated totals.
- One SQL snapshot projects canonical Task state, current Plan member counts,
  actual started/non-absent RUNNING Attempts, queue/held counts and open effects.
  Up to 16 independent canonical attention targets are returned with explicit
  overflow; full targets remain reachable through Task detail readers. Queueing
  alone is not attention. Legacy rows remain readable. `canonical_execution` only
  indicates recorded Markdown Specification/current typed Plan definitions, never
  eligibility or mutation authority; use exact command guards/planning hints.
- `task-result-reads.ts` / `GET /tasks/:task_id/results`: successful canonical
  completion history, strict immutable manifests, trusted EffectResult and original
  workspace attribution. `current` requires current completed membership/activation
  and an exact completion/digest carry path through Specification/Replan tuples.
  Refresh, replacement and cancellation do not grant old result applicability.
  Repository-free completions explicitly have `git:null`. No Runner path is read
  or exposed by this projection. `admitted_at` is operation admission, NOT completion
  time (no canonical completion timestamp currently exists).
- Login and session reads expose existing random `session_id`, never token/digest.
  Optional `X-Monos-Session` on all Owner routes authenticates the request's captured
  credential and rejects mismatched session identity before route/receipt/effect.
  This closes preflight-to-POST cookie replacement; old automation remains compatible.
- `task-workspace-reads.ts` / `GET /tasks/:task_id/attempts/:attempt_id/workspace`:
  exact authenticated Attempt scope, strict no-query route, 64-lease/2 MiB bounds.
  Reads each lease and its successful open/settle effect snapshot; prefers settled
  metadata and verifies workspace/lease/repository identity. Later mutable workspace
  heads cannot relabel this Attempt's evidence. No Runner paths, source prompts,
  credentials or configuration bodies are returned. The `execution` field contains
  Runtime/model from recorded launch and thinking level from recorded selection;
  null means not recorded, never inferred from today's policy. Repository-free and
  Planner Attempts return an empty workspace list without inventing a repository.
  Completion correction keeps the lease's original completion pointer/state while
  taking checkpoint metadata from its exact successful `settle_completion` child
  (same Attempt, lease and immutable descriptor), named by `metadata_operation_id`.
  An already-finalized recovery pair still attributes Git metadata to the original
  successful completion. The UI labels retained private checkpoint cleanup clearly.
- `NodeExecutionStatus.guidance_followup_pending` exposes existing waiting guidance
  facts so the UI can offer exact completed-work Stop/Continue controls.
- Schemas/types/embedded Go/OpenAPI generated together. No migration/new state or
  source/prompt change. Quicktype renamed existing Go `Ready` enum to `TypeReady`;
  the only two real consumer references were updated accordingly. The workspace
  schema also renamed generated `OperationState` to `OpenStateEnum`; one existing
  recovery-test cast now uses the generated name.

## Verification

- Focused real PostgreSQL `postgres-task-ui-reads.test.ts`: 8/8 PASS, isolated schemas
  via private `/tmp/monos-ui-test-env.py`; no deployed Task mutation.
- Covers per-column/filter/cursor identity, tied/legacy ordering/history, independent
  attention, queue distinction, attention overflow, UTF-8 encoded pagination,
  exact cookie replacement rejection/no receipt, revoked/sessionless reads,
  repository-free carry/replacement with original manifest retained and trusted
  workspace/Git result projection.
- Existing Owner-access suite found an AJV strictRequired omission in the additive
  session conditional; fixed source schema and regenerated. Focused rerun 5/5 PASS.
- Combined Owner-access and Node-execution PostgreSQL regression: 36/36 PASS.
- Workspace/runtime focused PostgreSQL case: 1 PASS, 7 intentionally skipped;
  covers pending/materialized/released leases, exact immutable completion snapshot,
  later-head isolation, sanitized execution choices, no prompt/path exposure,
  cross-Task denial and HTTP auth/query guards.
- Recovery projection regression in `postgres-node-execution.test.ts`: 3 PASS,
  28 intentionally skipped; tests trusted corrected/cancelled pairs, already-finalized
  pairs and Task cancellation checkpoint attribution. Typecheck and affected ESLint
  passed after this reviewer follow-up; no schema change was needed.
- Affected ESLint and root TypeScript passed. Full local Go module tests passed
  using installed Go 1.27.1 (plain shim has no selected version).
- Full integration/browser gates owned by root. Native execution/host restart not
  repeated; synthetic Runtime acknowledgements here prove backend read contracts.
- Final unfiltered `postgres-task-ui-reads.test.ts` rerun after all diagnostic
  follow-ups: 8/8 PASS, 102.64 seconds. No name-filtered omissions.
