# Runtime Stop and restart reconciliation

## Goal and Owner value

The Owner can stop selected execution and deliberately continue or retry blocked work. Backend, Runner and host restarts preserve the same Attempt and operation identities until old writers are verified absent, so a later Attempt cannot collide with them.

## Background and confirmed facts

- This leaf follows the completed [selected Runner and logs task](../archive/2026-09/09-29-a-runtime-runner-logs/verification.md). Real Node and Planner Attempts used the installed OpenCode and bundled `monos`; a selected Node with no `complete_node` became BLOCKED and its detached descendants were stopped and released.
- The backend already persists selected Start/effect outbox rows, Runner inventory, Attempt fencing, process reservations, operation results and missing-formal-outcome Stop. The Runner already retains local start/Stop identities and reconciles supervised process trees after reconnect. Owner HTTP commands currently confirm proposals only; there is no Owner Stop/Continue/Retry command surface for these Attempts.
- Architecture requires Node-scoped Stop after a Plan: the current Attempt is cancelled with an Owner-stopped reason and the same Node becomes BLOCKED. Continue returns that Node to PENDING for normal scheduling. Before Plan publication, Stop returns the Task to PLANNING. Objective Runtime failure and healthy capacity waiting must remain distinguishable from Owner Stop.
- A terminal database row or heartbeat loss does not establish physical writer absence. Admission of a completion operation wins a race with process exit; Stop/retry must reconcile admitted effects before a replacement writer is allowed. The old `monolab` service remains installed on the authorized Linux test host, so a whole-host reboot affects more than this task's isolated `monos-probe` installation.

## Requirements

1. Add authenticated, request-idempotent Owner Stop and Continue/Retry commands over the Tool Protocol. Replays return the original receipt before checking a now-stale control version. Changed payload under a request ID conflicts. Scope, Task/Node basis and terminal-state guards are enforced by the backend.
2. Stop revokes the current Attempt's mutation authority and queued Start in one durable transaction, admits a stable whole-tree Stop effect if physical ownership may exist, and records the objective Owner-stopped reason. A queued Attempt is cancelled without inventing a process. A running Node becomes BLOCKED; independent Nodes remain eligible. Pre-Plan Stop settles its Planner Attempt and returns the Task to PLANNING only under the documented pre-Plan guard.
3. Continue/Retry uses the same Node/Task lineage and current execution policy. It does not create or promote a replacement while a prior process reservation, uncertain Start/Stop, admitted completion or workspace effect remains unresolved. An admitted completion settles before exit/Stop is interpreted and is never overwritten with false failure. The command restores scheduler eligibility; a successor launch requires canonical current context from its owning Task module and must not blindly reuse an old prompt.
4. On backend/Runner restart, inventory and durable outbox reconstitute the original dispatch/effect identity. A changed host boot is evidence that prior processes died, not that semantic work succeeded. Reconcile outstanding receipts and Stop under system authority; keep interrupted work blocked until absence and safe release are verified.
5. Owner reads expose factual Stop/recovery attention and operation identity without deriving progress from log prose, heartbeat silence or a client connection. The later full Task-detail UI consumes these contracts; this leaf provides the control/read boundary and focused proof.

## Acceptance criteria

- [x] Owner Stop of queued and running selected Attempts is authenticated, idempotent and fenced; no stale command or delayed Start revives a cancelled execution.
- [x] Detached descendants are physically stopped; a second writer cannot start and capacity is not released until Stop, admitted effects and absence settle. Stop racing formal completion yields one consistent result in either order.
- [x] Duplicate Stop/Continue/Retry, lost acknowledgements and backend/Runner restarts recover the same command receipt, operation and Attempt lineage. Retry of a blocked Node restores eligibility exactly once; a selected successor can start only after the old owner settles.
- [x] Pre-Plan Planner Stop returns to PLANNING; missing/failed Planner output never becomes a Plan or reply. Node failure without formal completion remains BLOCKED with a factual reason; healthy queueing does not produce failure attention.
- [x] A controlled host restart verifies old PID/birth/boot/cgroup identity, absence and release without reviving an unsent Agent command, replacing an unresolved writer or disturbing retained evidence.

## Out of scope

Native Runtime session resume, permanent disk loss, cross-Runner failover, automatic silence-based hang detection, full Task-detail UI, generic Task cancellation/delivery settlement, live steering and unrelated roadmap packages.

## Planning decisions and technical boundary

The Owner authorized one controlled reboot of the Linux test host for this leaf on 2026-09-29. Before that action, check both task-owned and pre-existing service activity, settle unrelated live Attempts, capture a private checkpoint, and use the probe's bounded hold window. Preserve all journals and evidence across reboot.

The current backend has selected Attempt admission but no general Task Context Builder. This leaf restores a blocked owner to schedulable state and proves successor admission through the existing selected-dispatch contract with current canonical fixture inputs. Building a complete semantic prompt from new Task conversation or silently reusing a stale launch prompt belongs to the later Task-execution package.

## Source contracts

[Architecture](../../../ARCHITECTURE.md), [Runtime](../../../docs/03-runtime-and-execution.md), [Tool Protocol](../../../docs/05-tool-protocol.md), [State](../../../docs/06-state-and-formal-data.md), [Owner controls](../../../docs/07-owner-review-and-ui.md), [Stage A](../../../docs/09-first-executable-slice.md), [invariants](../../../docs/08-principles-and-non-goals.md), [Runner spec](../../spec/runner/execution-guidelines.md).
