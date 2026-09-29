# Backend implementation and verification

Implemented the assigned backend/protocol slice; no deployment, commit, archive or
journal mutation by this worker. Root owns the final native/installed acceptance.

## Final modules and authority

- `node-execution-state.ts`: canonical frozen source, full current referenced Role,
  effective Spec/Node, formal planning answers, Project map and exact frozen
  workspace reservations, historical Artifact metadata and recovery provenance.
  Context includes planned Attempt identity, excludes Planner Guidance and other
  Task/Todo/session/log data, and fails explicitly on complete encoded budgets.
- `node-execution.ts`: canonical publication discovery and existing shared scheduler
  pump; exact Owner Stop/Continue/Retry, original-operation repair, correction and
  local Cancel; bounded generated execution read. Runner lock set is rechecked
  after Task lock, and discovery retries if it changed. Canonical QUEUED is Node
  RUNNING. Offline/no-Runner waits; policy/installation facts create explicit
  blockers. Existing fixture PENDING membership is never discovered.
- `artifacts.ts`: immutable managed UTF-8 content, bounded title/MIME/external
  references, scoped Owner/Agent reads, digest/size, omitted versus exact versus
  empty completion selections. Encoded read-wrapper headroom is enforced at
  publication; malformed URLs and global IDs are correctable errors.
- `node-completion.ts`: typed atomic original/settlement pair, exact original
  identity digest and immutable lease pointer, recovery checkpoint validation,
  physical release followed by current completion and derived REVIEW. Only the
  pair can first commit cancellation; later exact original tombstone replay is
  idempotent. Already-finalized wins without a successor. Cancel preserves
  physical history without current completion or execution revival.
- Existing service/workspace/queue/control/read integration retains explicit
  legacy fixture semantics. Canonical Attempt-only controls are rejected: use
  exact source/blocker controls so ordinary recovery cannot strand a PENDING Node.
  Recoverable completion remains RUNNING under both result/event orders; hard
  failures retain BLOCKED ownership. Hard attribution survives later recoverable
  results. Cancelled Tasks permit only exact same-operation cleanup Retry.

Migration 18 adds Node sources/blockers, managed Artifacts, completion manifests,
explicit repository-free completion and completion-settlement identity/authority.
FKs and deferred triggers verify source/launch reservations, manifest operation /
Attempt / activation / selection, canonical manifests and workspace target identity.
Original lease `settle_operation_id` remains unchanged. Immutable history is not
reset. Migration rollback requires compatible settlement of new operation shapes.

The shared protocol is generated into TS, Go and OpenAPI. New commands are
`publish_artifact`, `read_artifact`, `block_node`, source-targeted Owner Node
controls and `recover_completion`. Artifact content is returned as JSON data with
no-store/nosniff, never served as executable HTML on the application origin.
Independent reviewer added six focused protocol tests and 26 shared transport
fixtures. `completion-identities.json` supplies a cross-language immutable digest.

## Verification

- Full PostgreSQL v2: **211 / 211 cases, 18 files**, using independent temporary
  schemas on the existing forwarded PostgreSQL. Command:
  `pnpm test:db --testTimeout 60000 --maxWorkers 4` with private URL supplied
  internally. Log: `/tmp/monos-node-full-db-v2.log`.
- After v2, **three added cases** passed: canonical Attempt-only controls cannot
  bypass sources; no-Runner Auto waiting creates no fake Attempt; arbitrary
  PENDING fixture membership is excluded. Expanded hard-attribution and exact
  cancellation-tombstone replay regressions also passed. Current Node suite has
  **31 cases** (28 in the full pass, 3 added afterward); total current DB case
  count is **214**. Targeted checks use the same temporary-schema fixture.
- Node cases include independent OS processes observed simultaneously waiting on
  PostgreSQL locks for source and terminal-command contention. Artifact/complete,
  Artifact/block, block/complete and Owner Stop/complete each cover both lock
  orders. Before/after admission COMMIT SIGKILL proves manifest/receipt/fence
  atomicity. Physical effect result fixtures establish backend guards only.
- TS tests: **249 passed**, including reviewer/shared protocol additions.
  Log: `/tmp/monos-node-unit.log`.
- `pnpm lint`, `pnpm typecheck`, `pnpm protocol:check`, production build and native
  source/compiled Node imports passed. Build log: `/tmp/monos-node-build.log`.
- Earlier full pass recorded four failures: two legacy tests asserted the old
  incorrect recoverable BLOCKED projection (updated to RUNNING), one exposed the
  summary validator's error/budget mismatch (fixed), and the 70-operation legacy
  pagination test exceeded a 20-second remote-network timeout (60-second run
  passed). Earlier workspace run also hit a 5-second network timeout; full v2
  passed the complete workspace suite. No test data/history reset was performed.

## Remaining owning gates

Root must freeze a complete source snapshot, run the final integrated gates,
perform verified Linux build/install and native canonical no-resource plus Git
correction acceptance, then synchronize executable specs and archive/journal.
Runner owns its physical/journal/Git implementation and Go gate evidence. Backend
fake physical results are not evidence of real cgroup release, cross-account Git
export or browser HTML behavior. The accepted carryover Node will be discovered
when the new pump is deployed; root has explicitly accounted for it.
