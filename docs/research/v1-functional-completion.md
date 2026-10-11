# V1 functional completion

Scope: complete the roadmap's usable functionality before native acceptance.
The functionality below is implemented. This does not claim the single-host
release gate has passed. The Owner has separately authorized committing,
pushing and archiving completed functional packages. Baseline: `c876053`.

The capture, Discussion, Task preview/Start, execution, conversation, review and
delivery paths are implemented. Stage B includes fallback, serial/rework,
parallel workspaces, Replan, multiple repositories and plain/mixed Git delivery.
Old planning/backlog text is not evidence that those paths are missing.

| Completed behavior | Owning implementation |
| --- | --- |
| Explicit same-Task Artifact consumption, with historical provenance | Plan/Replan validation, SQL graph validation, Node context |
| Successor context contains every upstream repository result and integration revision | Node upstream context |
| Planner instructions describe dependency-driven concurrency | Initial/Replan runtime instructions |
| Requirement-only revisions work with an unchanged multi-Node graph | Specification impact validation and settlement |
| Setup diagnosis and actionable settings are available in the Web UI | Execution settings, policy editor, repository picker |
| Configured execution CPU/memory/process limits protect host services | Trusted Runner configuration and execution cgroups |
| Low storage blocks new consumption, while recovery remains available | Runner observations/guards, backend storage observation, dispatch admission |
| Disposable acknowledged logs and completed inspection snapshots expire safely | Runner durable retirement and retention |
| Runner credentials can rotate/revoke without replacing execution ownership | Administrative protocol, Runner identity maintenance and reconnect |
| A fresh host can bootstrap Owner, enroll/configure/start Runner and open settings | Single-host installation commands and recipe |
| Completed Tasks retire disposable disk data after a configurable interval | Owner retention settings, backend cleanup jobs, Runner/root retirement and result verification |

Changes stay in these owning modules. Domain lifecycle states remain the same.
CLI installation/login remains explicit host setup. Existing records, process
ownership and exact request replay remain
authoritative. PostgreSQL storage is observed through an explicit local read-only
volume mount; backend code never treats a Runner path as a backend path.

Completed-Task cleanup defaults to seven days, can be disabled or set to 1–3650
days, and never applies to cancelled Tasks. It requires settled physical owners
and independent final result exports, then freezes exact Task/Runner/workspace/
Attempt identities. Root checks path/device/inode identity and performs cancellable
deletion only for listed disposable materializations. Formal Artifacts, results,
history, rework archives, shared caches and ownership receipts remain. Later
reply-only Task Conversations use new private directories and remain available;
old dispatches and workspace reconstruction stay fenced. Settings show blocked
reasons and workspace cleanup time. The
[operations recipe](../../infra/runner/operations.md) records the recovery contract.

Necessary evidence for this completion pass:

- Artifact consumption, upstream context, Plan/Replan and multi-repository cases:
  22 PostgreSQL cases; unchanged-graph multi-Node Specification cases: 13; updated
  multi-Node planning checks: 6.
- Runner storage/credential authority: 4 PostgreSQL cases plus focused Go race
  checks for rotation and reconnect with both supported identity formats.
- Completed-Task cleanup: 3 PostgreSQL cases for age/owner gating, exact multi-repo
  result/ACK replay and fairness past 17 unresolved owners. Focused follow-ups
  verify terminal Conversation and the final exact workspace identity selection.
- Enrollment: 9 PostgreSQL cases, including the local administrative proof that
  recovers the successful-installation marker window without adopting a different
  grant/credential or reviving rotated/revoked credentials.
- Protocol, HTTP app and doctor regression: 732 passing checks. Integrated
  TypeScript/lint/build and generated-contract checks pass. Web settings use four
  focused existing interactions plus one retention-persistence interaction;
  installer uses eight no-privilege cases and the two preparation cases.
- Runner journal/resources/daemon packages and focused real-Git cleanup, result,
  cancellation, path identity and Conversation checks pass. Linux entry points
  cross-compile. This is local evidence, not installed account/cgroup/reboot proof.

Use focused checks for changed authority, persistence and process boundaries, then
one integrated build/type/lint/protocol gate. Retain earlier passing evidence for
unchanged behavior. Native CLI/provider, two-account permissions, host reboot and
full release-matrix acceptance are deferred at the Owner's request. The four
completed Stage B functional packages can be archived; Stage A integration,
actual two-CLI fallback acceptance, installation host acceptance and the V1 release
parents remain open with their native evidence requirements.
