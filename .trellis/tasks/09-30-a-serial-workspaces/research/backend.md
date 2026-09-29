# Serial workspace backend implementation

Canonical Project Tasks now reserve stable workspace IDs in Dispatch without
materializing repositories or assigning the fixture `tasks.resource_id`.
`workspaceId(task, resource)` uses SHA-256 over canonical JSON of the pair and has
shared TS/Go fixtures. First open captures active Project resource defaults;
materialized workspace base, target branch, resource/provider/storage identity and
Runner placement remain fixed. Project archival does not revoke existing Tasks.

## Contracts and durable ownership

- Shared schemas/generator define reservations, resource/basis/descriptor,
  metadata/checkpoints, scoped repository access and terminal cancellation. The
  descriptor digest accompanies every canonical workspace Operation. Generated
  Go keeps `instruction_files` absent when nil and preserves an explicit empty
  array when opening a repository with no instruction file.
- Migration 0016 adds `task_workspaces`, `workspace_leases`, explicit fixture
  provenance and immutable operation cancellation attribution. Foreign keys,
  deferred descriptor/Attempt/lease/workspace checks, one-live-lease indexes and
  lineage/terminal-state triggers defend durable identity. A materialized Task
  retains one repository in this Stage A leaf.
- `workspaces.ts` owns admission and settlement. Different request IDs in one
  Attempt/activation reuse one open Operation; receipt persistence and workspace
  admission roll back together. Continue/Retry and queue promotion require prior
  physical lease release. Resource removal cannot race past admission or discard
  materialized lineage; fully cancelled, never-exposed reservations may be removed.
- Stop/completion copy the admitted open descriptor. Stop requires an attributed
  private checkpoint and keeps the finalized revision; completion advances it
  atomically with formal Node completion. Missing checkpoint, stale lease,
  changed provider/base/target/storage or wrong result identity cannot settle.
- Only the matching admitted Stop of a fenced Attempt can cancel a never-exposed
  canonical open. Terminal cancellation is immutable, leaves the lease owned
  until Stop succeeds, and projects the specified error receipt instead of a
  successful workspace. Owner status includes the cancelling-operation link.
  All unresolved-operation predicates distinguish admitted/recovery from both
  succeeded and cancelled.

## Failed refresh and Stop recovery

A materialized workspace cannot become an unexposed reservation merely because
its next lease fails to refresh. `WorkspaceMetadata` therefore permits the paired
`recovered_by_stop_operation_id` and `target_observation_lease_id` fields only for
an already-fenced, same-lease Stop recovery. Backend checks the exact admitted
Stop and a released lease of the same workspace with the recorded target commit;
the source must be the actual fresh observation, not another recovery reference.
The fixed lineage remains unchanged. The current lease durably records this
provenance and its Stop checkpoint must retain it exactly. A later genuinely fresh
open omits both fields. Wrong Stop/source/target and provenance loss are tested.

## Provider boundary

`POST /v1/runner/operations/:operation_id/repository-access` authenticates the
Runner enrollment credential, checks current backend/incarnation and unresolved
open/lease/digest ownership, exchanges with GitHub outside a transaction, and
rechecks ownership and configuration afterward. It is usable before Runner ready
and after Agent fencing for system reconciliation, never after release. Every
HTTP result is no-store; all errors, including malformed/oversized bodies and
internal exceptions, return a bounded reason without raw provider details.

With no App, exact positive public repository metadata is required. With an App,
the backend requests one repository ID with contents/read and metadata/read,
verifies the returned permission/repository scope and bounded expiration, and
verifies repository metadata using that token. It does not anonymously retry an
App denial. A provider ID learned during an earlier public open can be reused from
the fixed basis when App credentials are configured later. Tokens exist only in
the transient response; neither operations nor receipts store them. Token expiry,
wrong/broad/write scope, missing identity, oversized responses and denial have
provider tests; concurrent cancellation/configuration rotation have DB tests.

## Compatibility

Fresh fixture effects require explicit internal `legacy_probe` provenance;
migration enrolls only historical probe Plans whose immutable Task/Attempt/resource
identities agree. Canonical Dispatch forbids the fixture field and Planner
reservations are empty. Existing retained fixture receipts/results preserve their
bytes. Unknown historical noncanonical Attempts retain receipt recovery but gain
no fresh fixture authority. New canonical Planner inspection and repository-free
Node completion remain outside this leaf.

## Verification

- Protocol generation/freshness, TypeScript, ESLint and diff whitespace checks pass.
- Complete local suite: 182 passed (database tests deliberately skipped).
- Focused protocol/provider/HTTP suite: 144 passed.
- Native Node imports of `app.ts` and `workspaces.ts` pass.
- Final real PostgreSQL workspace suite: 9/9 passed (29.91 s), including actual
  enrollment HTTP authentication and concurrent provider-configuration rotation.
- The main session subsequently passed all 148 PostgreSQL-entrypoint cases on
  build snapshot v1. Review then strengthened this file's contention evidence;
  the workspace suite now defines 12 cases (three added), without product changes.
- Review contention gate: 5/5 targeted cases passed (14.27 s; seven unrelated
  workspace cases skipped). The command was
  `MONOS_TEST_DATABASE=1 python3 /tmp/monos-todo-test-env.py pnpm exec vitest run apps/server/test/postgres-workspaces.test.ts --testNamePattern 'serializes different|observed lock queue' --testTimeout=30000`.
  Each race creates separate pools, records three distinct PostgreSQL connection
  PIDs, holds an explicit configuration row barrier, and observes both commands
  with `wait_event_type='Lock'` and matching `pg_blocking_pids` before release.
  Distinct opens have two receipts but one operation/lease. Conflicting commands
  must queue behind the first command, establishing both removal/open winners and
  both default-edit/open winners. Tests assert active-resource state, admission
  presence or denial, exact captured defaults, digest and immutable replay.
  TypeScript, focused ESLint and diff whitespace checks also pass after this change.
- Affected dispatch/Owner/boundary regression run previously passed 42/43; the sole
  failure was a 70-operation fixture exceeding the real 15-second Runner freshness
  window over the database tunnel. Its long loops now simulate Runner heartbeats;
  that case and the 16-recovery-operation outbox case passed together (30.68 s).
  Product heartbeat deadlines are unchanged. Main session owns the complete DB gate.

No deployment, host Git/cache check, live private-App proof, or commit is claimed
by this backend worker. Main session and Runner implementer own native Linux/public
acceptance and integration. No credentials or private wrapper contents were read
into reports.
