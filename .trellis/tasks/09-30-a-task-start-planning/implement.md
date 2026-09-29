# Initial Task planning implementation

The Owner authorized the roadmap, implementation, test-host use and routine
decisions without further permission. The previous workspace leaf is accepted
and archived (`97cf6a9`, Session 17). Implement the persisted design in this leaf;
no production Node scheduling or combined execution UI yet.

## Ownership and order

1. **Backend/protocol worker** owns `packages/protocol/**`, `packages/domain/**`,
   `packages/db/**`, `apps/server/**` and root test registration. Read the curated
   contexts and design, then stabilize strict command/source/result/read schemas
   and notify Runner of generated names. Implement migration 17, bounded frozen
   Task context, durable source selection and source-aware Owner/Agent commands,
   queue guards, scoped reads and existing pump wiring. Preserve old fixtures and
   immutable receipts; no implicit initial-planning grant.
2. **Runner worker** owns `runner/**`. After shared schema is stable, update bundled
   CLI help/allowlist, initial-planning fixed protocol and necessary dispatch/host
   validation. Add tests for proper terminal tools and Node/Todo/legacy separation.
   Preserve current workspace recovery and native permission boundaries; no new
   process supervisor or model selection policy.
3. **Root integrator** owns task/spec documents and `infra/probe/**`. Prepare native
   canonical Owner creation/Start/Plan/issue acceptance using current auth/preview
   APIs and actual OpenCode. Capture exact prompts/context/receipts and prove zero
   workspace/Node execution in this leaf. Reuse existing services and port override.
4. **Independent check worker** reviews full schema/backend/Runner/data-flow and
   native evidence. Coordinate fixes with file owners and record findings. Workers
   are not alone in this tree: preserve others' edits and do not delegate again.
5. Run all required checks, build from a verified fresh source snapshot, preserve
   current installation identities/backups and deploy only existing services.
   Retain failed/uncertain evidence and continue only after exact-state inspection.
6. Update executable specs and verification, commit this leaf, archive/journal,
   then continue automatically to `09-30-a-node-execution`.

## Required checks

- Creation/read/pump without Start: no intent/Attempt/Plan/Node/workspace.
- Invalid Start configuration; unavailable selection with durable RUNNING source;
  same/different-request Start races with observed independent PostgreSQL locks.
- Fresh bounded context, immutable queue input and exact digest; current Project/
  Role descriptors/Guidance and effective Spec; exclude Todo, other Task, full
  Role instructions and sessions. Retain multiple issue answers; no silent clipping.
- Exact source/head/claim/connection/Spec/control publication, full one-Node
  definition and output hints; explicit multi-Node/Artifact unsupported errors;
  same-Attempt correction after structural validation failure.
- Atomic outcome/receipt/event/Stop; publish vs issue and outcome vs Stop/Cancel
  in both lock orders; transaction/crash rollback and replay after termination.
- Unavailable, queued and running Stop; issue Stop while cleanup still held;
  source Retry saves answer/intent after fencing but cannot promote before old
  owner/effects release. Legacy attempt Retry keeps release prerequisite.
- Wrong/duplicate/stale issue answer; pre-Plan Cancel; late output cannot revive
  stopped/cancelled Task. Exit without a formal outcome stays retryable.
- Restart before selection, after selection and around Start/phase commit: one
  planning chain/Attempt/Start, immutable original result and no lost wakeup.
- Protocol freshness, full TS/DB tests, Go race/vet, Python probes, lint/typecheck,
  build, native Node imports, and explicit probe TypeScript checks when needed.
- Real Owner-created Tasks: no execution before Start; one native Plan or issue;
  exact Owner issue answer/Retry/withdrawal, settled process trees and no workspace.

## Operational baseline

Existing backend/Runner on `100.120.14.84`, source
`/root/monos-boundary-probe-src`, HTTPS 18444. For `compose up`, always combine
`infra/compose/compose.yaml` with `/root/monos-boundary-probe-ports.yaml` so the
independent installation on 18443 remains unchanged. Current migration 16; full
source v5 and Runner v4/build-v6 are the previous accepted baseline. Use existing
root-private credentials without printing them. No push or new permanent service.
