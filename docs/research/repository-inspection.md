# Planner read-only repository inspection

Implemented after serial multi-Node execution and settled upstream Rework.
Native A06/A30 acceptance remains deferred; this milestone uses local automated
checks and does not access the installed Runner.

The same `inspect_repository {resource_id}` command now works in Todo Discussion,
initial planning, Task Conversation, Replan and Review. It also works in reply-only
accepted/terminal conversation. Results expose a service-owned read-only snapshot
with exact commit/tree and instruction-file paths, or a typed unavailable reason.
Native reads, searches and Git work against that snapshot while Planner scratch
remains writable.

Each operation freezes its canonical source and Project resource. A Task with
materialized code uses its latest finalized completion export or verified initial
open base. Other reads pin the default ref at the first successful fetch. Original
request replay retains that revision. Node worktrees, private checkpoints and
Task workspace leases do not become Planner inspection authority.

Git workers retain durable intent, bounded deadlines and process-group identity;
Stop cancels and reconciles them before releasing the Planner. Slow remote work
runs outside the daemon lifecycle mutex. Known unavailable reads settle normally;
unknown physical ownership stays in recovery. Credentials are transient, with
exact authorization checks before and after provider I/O.

## Validation

- 491 PostgreSQL tests across 53 files passed, including 9 inspection cases.
- 683 unit/schema tests passed; 29 new shared TS/Go validation cases exercise
  source/origin restrictions, paired identities and exclusive result variants.
- Adapter and wire race tests passed; control/local race checks and Host/daemon
  inspection race tests passed in their owned scopes.
- Full Host/daemon/journal tests passed before final scoped hardening; subsequent
  affected Git, source, URL and cancellation cases passed again.
- All Go packages compile; vet and command builds pass. Lint, TypeScript,
  generated-protocol drift and application build pass.

Local Git tests establish revision pinning, clean immutable snapshots, completion
and open-origin proofs, moving-ref replay and slow-child cancellation. They do not
establish Linux two-account enforcement or installed CLI/model compatibility.
Those checks remain part of the deferred native acceptance.

Contracts: [backend](../../.trellis/spec/backend/repository-inspection.md),
[Runner](../../.trellis/spec/runner/planner-inspection.md),
[protocol](../../.trellis/spec/protocol/commands.md).
