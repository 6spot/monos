# Canonical Planner Repository Inspection

Sources: [Planner](../../../docs/02-planner-and-planning.md),
[Workspace](../../../docs/04-workspace-and-git.md),
[Tool Protocol](../../../docs/05-tool-protocol.md).

## Scope and signatures

`inspect_repository(resource_id)` is an operation-scoped service effect for the
five canonical Planner sources: Todo Discussion, initial Task planning, Task
Conversation, Replan and review. Nodes cannot use it. The legacy fixture
`host.Inspect(attemptID)` remains separate from `host.InspectRepository`.

`Operation.inspection` plus `inspection_digest` freezes the Project resource,
Planner source and selected origin. `EffectResult.inspection` returns an
independent snapshot identity/path/commit/tree/instruction files or a typed
unavailable reason. It never carries a workspace ID, lease, reservation,
completion evidence or `writer_absent`.

## Storage and source proof

Private records and staging live at
`Root/service/inspection-operations/<operation_id>`. Published snapshots live at
`Root/inspection/<operation_id>`. Storage identity is checked against the existing
root and service copies; snapshot identity is the immutable operation ID.

- Default-ref inspection retains its selected ref before remote fetch. The first
  successful fetch atomically writes an operation ref in the private bare store.
  Replay uses that ref even if the remote has moved; a retained commit with a
  missing pin is unavailable, never a reason to fetch newer content.
- Completion inspection first verifies the full retained completion operation,
  Start source, descriptor/digests and successful result. It then checks the
  protected service export's `refs/monos/result` against the exact commit/tree.
- Initial-open inspection requires the original successful open with no basis or
  transfer and `finalized_commit == base_commit`. Its complete retained journal,
  service pin record and resource-cache `refs/monos/pins/<open_operation>/base`
  must agree. A later open's original base cannot prove current finalized state.

Mutable Node worktrees/common directories and Stop checkpoints are never source
authority. The daemon validates source journals; Host validates storage lineage
and actual Git objects. Neither check replaces the other.

## Materialization and native access

Clone without local hardlinks or alternates into private staging, explicitly
fetch the pinned commit (ordinary clone does not import private refs), check out
that commit, and verify HEAD/tree/index/clean status before publication. Only an
unexposed service-owned stage may be reconstructed. An exposed snapshot is never
reset or repaired in place.

The service owns all parents and snapshot entries. Execution receives read and
traversal permission; it cannot write, chmod or replace the root. This protects
the supplied snapshot while retaining native shell and writable Planner scratch.
It is not a host filesystem sandbox. Native Git commands use
`GIT_OPTIONAL_LOCKS=0 git -c safe.directory=<exact_snapshot_path> ...`;
never add wildcard trust or change global Git configuration.

Inspection access is a separate transient service-only credential response. Bind
its operation/digest and canonical repository identity, accept configured GitHub
URL aliases through the verified canonical HTTPS identity, and keep credentials
out of persisted records/configuration/argv, Agent environment and error text.

## Process ownership, Stop and reconnect

Each Git command runs in a bounded cancellable process group. Before spawn,
persist intent and the operation deadline; after spawn retain actual Linux
UID/boot/birth/group identity. Persist verified whole-group absence before another
command. Missing or changed identity stays unresolved; PID reuse never permits
killing a different process. Darwin unit tests cannot establish Linux identity
recovery or the two-account permission boundary.

The bounded daemon queue single-flights by inspection operation and runs network
work outside its lifecycle mutex. Stop tombstones new work, cancels/drains active
inspection and reconciles retained children before releasing the Planner. Reconnect
includes no-workspace inspection intents and failures, checks exact dispatch/source,
waits for Ready and replays terminal results without rerunning physical effects.

Known cancellation, missing resource/ref, stale source or inspection failure ends
as `OperationResult.success=true` with typed unavailable. Only unknown physical
ownership remains `success=false` recovery. An inspection never fabricates an
Agent writer-absence fact.

## Verification

Focused actual-Git tests cover remote movement after a successful fetch and
interrupted reply, resource/operation separation, custom-ref import, clean
checkout and readonly ownership/modes, all three origin proof failures, URL
aliases, and a slow upload-pack child cancelled with its process group. Daemon
tests cover all five sources, Node rejection, Stop while inspection runs,
unknown-child release refusal, no-result crash intents, source substitution and
terminal replay after Ready. Run scoped race checks for the cancellation boundary.
Native Linux two-account read/write/chmod/root-replacement and installed-runtime
validation remain separate host acceptance; local same-account tests do not
claim them.
