# Multi-Node Replan

Implemented after fixed Planner repository inspection (`1e3e727`). Native A06/A30
acceptance remains deferred under the Owner's instruction to prioritize feature
development. The verification below uses local PostgreSQL, synthetic Runner events,
real local Git tests and browser execution; it does not claim native model execution.

## Behavior

Planner can replace a complete graph of 1..256 Nodes. The exact impact covers every
old member once: retain its immutable definition and refresh, carry valid evidence,
invalidate its activation, or remove it. New work uses fresh Node IDs. Dependency
changes require new definitions; carried downstream evidence requires carried
dependency evidence. All Roles must remain selected in the Project. Owner approves
the exact graph and, for a joint requirement change, the full requirements separately
before one atomic publication.

Guidance and immutable blocker/Owner Stop origins have explicit destination lists.
Their current Plan mappings alone determine applicability. Holds can split and merge
without losing provenance. An independent branch may run while another is held;
held sources wait for prerequisites and physical ownership, while Task state already
reflects pending holds.

Workspace impact binds the exact physical predecessor and approved destination
activations. A completed result may allow several possible adopters or none; the
first actual opener claims one immutable transfer under the workspace lock. Earlier
repository-free work needs no artificial checkout. Later current activations of the
same approved Node can adopt completed code within the published Plan, without
inheriting old completion evidence.

A private checkpoint has one exact destination activation and must be opened and
finalized before that target completes. Earlier ownership cannot bypass the new
assignment. When A's checkpoint is assigned to dependent B, A can finish without a
repository and B subsequently adopts it. Rework and shared reactivation reject any
affected closure containing an unadopted checkpoint target before stopping work or
changing activations. A completed carried target cannot receive a checkpoint.

Migration 29 independently checks graph definitions, membership, evidence,
guidance/hold mappings, complete deferred publication coverage and lazy workspace
transfer authority. Source snapshots and exact Owner command/confirmation chains
remain immutable. Old API/data compatibility is outside the current project stage.

The Task decision panel displays work goals, prerequisites, evidence dispositions,
hold/guidance destinations and workspace destinations. Existing separate approvals,
explicit exits and uncertain-response recovery remain available.

## Verification

- Full PostgreSQL regression: 517 tests across 56 files passed. Following the final
  checkpoint guard, nine affected files passed all 79 tests, including two added
  private-work regressions. Direct SQL graph/publication constraints are separately
  exercised with real transactions: seven cases passed, followed by a new
  checkpoint-to-carried-target regression that failed before the fix and passed
  after it. A final real Conversation-guidance regression passed through the
  shared reactivation guard, preserving pending guidance and both activations.
- Unit/schema aggregate: 702 passed; focused protocol validation: 421 passed.
  Protocol generation drift passed, with 19 additional shared validation fixtures.
- Go CLI, local socket, Adapter and wire tests passed; all packages compiled and
  passed vet. Focused Host transfer/Replan race tests passed. No Host implementation
  changed in the initial feature commit. A follow-up Host review corrected the
  repository-free completion guard: released foreign-Attempt checkpoints remain
  untouched, while live or current-Attempt allocations still reject completion.
  Focused trusted-record/scope tests and Host vet passed for that follow-up.
- TypeScript, scoped ESLint, native Node entry import and production build passed.
  The existing build chunk-size advisory remains.
- Three browser cases passed: joint publication/exits, exact dual-approval and
  publication recovery, and multi-Node publication recovery. Desktop/mobile full
  images were inspected for wrapping, overflow and reachable controls. Exact build
  assets and image hashes are recorded in the
  [evidence manifest](evidence/multi-node-replan-ui-v1/manifest.json).

## Remaining sequence

Parallel workspaces follow this milestone, then multiple repositories and delivery
modes. Execution here remains serial. Nonempty Artifact `consumes` and standalone
multi-Node sufficient-graph Specification changes remain outside this increment;
joint full-requirement Replan is supported.
