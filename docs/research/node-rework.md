# Serial upstream Rework

Implemented on top of serial multi-Node execution (`47a79e2`). This milestone adds
Agent-requested upstream correction, bounded automatic requests, explicit Owner
decisions and recoverable workspace preservation. Native A06/A30 acceptance remains
deferred; local evidence below does not claim installed Linux/model execution.

## Behavior

`request_rework` resolves the only direct dependency when no target is supplied;
an explicit target must be an ancestor. The saved request covers that Node and
every descendant under the unchanged Plan. Admission fences the requester and
records its exact Stop, receipt and target snapshots in one transaction. New
activations publish only after physical process/effect/lease settlement.

Three automatic requests are allowed per Task epoch. The fourth blocks its
requester with the original proposal preserved. Owner Apply validates the entire
saved result and resets the allowance; Continue keeps the requester activation
and existing allowance. Both retain exact Owner request/version/answer, including
when source preparation waits behind independent work. Ordinary Retry/Continue
and ancestor guidance cannot bypass the decision. Cancel keeps cleanup ownership
and prevents reactivation. Requirements, Replan and review mutations are mutually
exclusive with pending upstream Rework.

Existing integrated code remains the correction base. Host preserves the original
worktree and common Git storage under a private request archive, including ignored
files, raw index content and private objects. It rebuilds the stable workspace from
the verified finalized revision, then imports the stopped checkpoint at
`refs/monos/history/<request_id>` for inspection. Later serial handoff preserves new
upstream commits while restoring the same historical reference. Neither the
checkpoint nor earlier validation is automatically replayed or treated as current
completion. A2/B2 frozen context names the exact resource, Stop, checkpoint and ref.

The Task panel shows pending settlement or the preserved limit decision. Existing
session-scoped command recovery retains uncertain requests and rejects mismatched
Rework outcome identity, status, version and budget. Generic controls are hidden
for request-owned work; backend enforcement remains authoritative.

## Verification

- PostgreSQL aggregate: 480 tests passed; two old whole-row migration expectations
  needed the new default `rework_epoch`. After correcting those expectations, both
  affected suites passed (28 tests). Aggregate scope: 482 tests in 52 files.
- Final Rework core/guard suites: 11 passed, including direct SQL denial of a
  limit request entering settlement without an Owner receipt.
- Workspace suites: 8 passed, covering A→B→A2→B2 transfer, frozen checkpoint
  context, unchanged old source, and serial/Replan regressions.
- Unit suite: 653 passed; subsequent focused protocol/domain/browser-receipt run
  passed 481, including the additional Node-only Rework guard case.
- CLI, Adapter, wire, local socket and daemon race checks; Host Rework/serial/Replan
  race checks plus the full Host package race run (117.14 s); Go vet. Local
  transport tests caught and fixed both missing
  `request_rework` gates (canonical Node allowlist and wire envelope payload map).
- TypeScript, ESLint, protocol generation drift, production build and native Node
  module imports passed. Build retains the existing large-chunk advisory.
- Browser: two focused tests passed, covering both decisions, pending settlement,
  stale target capability, keyboard activation, draft retention and lost-result
  recovery without another POST. Backend reads/decisions are explicit UI fixtures;
  real persistence and Git behavior are covered separately above.

Inspected desktop/mobile images and source/build attribution are in
[node-rework-ui-v1](evidence/node-rework-ui-v1/manifest.json). They follow the
existing neutral application-shell reference described by the frontend spec.
The new panel is a bounded attention surface; it does not expose the DAG as a
normal product view. Both viewport sizes wrap text and preserve reachable actions
and visible focus without horizontal page overflow.

## Remaining sequence

Planner read-only repository inspection and multi-Node Replan, then parallel
workspaces and multiple repositories/delivery modes. Rework here deliberately uses
the already enforced serial writer boundary; it does not introduce concurrent
invalidation or cross-Runner workspace transport.
