# Serial workspace implementation

## Authorization and boundary

The Owner authorized sequential implementation, routine decisions, test-host use,
and continuation without further approval. The reviewed design fills the gap
between canonical Project-backed Tasks and the fixture-only Git effect. Formal
workspace identity and leases belong to backend/Tool Protocol; physical storage,
Git and writer settlement belong to Runner. Keep Start/Plan scheduling, Node
artifacts, UI and delivery in the following leaves. No new permanent service.

## Ownership and order

1. **Backend/protocol implementer** owns `packages/protocol/**`,
   `packages/domain/**`, `packages/db/**`, `apps/server/**`, plus the root test
   script when registering DB tests. Read the curated context and design first.
   Stabilize and regenerate strict Dispatch/Operation/EffectResult/access contracts,
   cancellation semantics and cross-language identity fixtures; notify Runner when
   generated names and structures are ready. Preserve retained legacy bytes.
2. **Backend/protocol implementer** then adds workspace records/leases and migration
   constraints, admission/replay, queue reservations, resource-removal barriers,
   completion/Stop/cancellation settlement, and operation-bound GitHub read access.
   Tests exercise real PostgreSQL concurrency plus deterministic provider behavior.
   Network/provider calls stay outside database transactions and never persist
   credentials. Any affected unresolved-operation predicate must be audited.
3. **Runner implementer** owns `runner/**` and `infra/runner/**`. Inspect existing
   process/journal/helper boundaries while schema is stabilized. Implement stable
   reservations/storage identity, protected cache and metadata, operation workers,
   pinned Git stages/replay, lease checks and checkpoint/finalization integration.
   Coordinate shared schema changes with its owner. Test real Git behavior and
   durable-stage faults, credential non-persistence and old fixture regression.
4. **Root integrator** owns planning, `infra/probe/**`, task evidence and specs.
   Build a native canonical-Node trial using the existing authenticated launch
   seam; do not disguise canonical Tasks as fixture Tasks. Select only the
   already-authorized public GitHub repository and existing Linux deployment.
5. After both implementations stabilize, run protocol freshness, lint, typecheck,
   local TS/Python/Go tests and the relevant complete PostgreSQL suite. Investigate
   failures before deploying. Rebuild and deploy to the existing test services,
   record source/binary hashes, migration and service identity, then execute the
   native public/two-account trial. Reuse prior acceptance evidence rather than
   rerunning unrelated backend/Runner restart experiments.
6. **Independent check agent** reviews the final diff against design/specs and
   acceptance evidence, fixes assigned defects in coordination with implementers,
   and records findings. Re-run checks affected by fixes. Update executable specs,
   record verification and journal, commit/archive this leaf, then activate Task
   Start/planning. Never mark incomplete native evidence as passed.

All workers share this tree: do not revert another worker's changes or delegate
again. Shared schema belongs to the backend worker even when generated Go changes.
Escalate discovered design conflicts to the root integrator promptly.

## Required acceptance checkpoints

- Exact same-lease replay across different request IDs; descriptor and result
  digest/identity checks; resource removal/default/Project archive races.
- Stable `(task_id, resource_id)` path, fixed base/target, refresh without resetting
  HEAD/index/files, one materialized repository and explicit fixture provenance.
- Every durable Git stage survives retry; missing/corrupt storage fails explicitly;
  old process and system effect ownership physically settles before lease release.
- Stop cancels only a proven unexposed open; ready/uncertain exposure recovers and
  produces a system checkpoint. Fresh Attempt preserves dirty/private state.
- Public fetch requires positive provider identity evidence. Configured App errors
  do not fall back anonymously; scoped token expiry/error/non-persistence have
  deterministic integration tests. Live private access is a separate claim that
  requires configured credentials and actual evidence, not a public-leaf blocker.
- Native two-account trial verifies cache write/push denial, returned instructions,
  exact Git/result identity and absence of credentials in durable data/Agent
  environment. No remote publication and no new permanent service.
