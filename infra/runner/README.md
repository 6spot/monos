# Isolated Linux Runner installation

Use the [naming and upgrade contract](../../docs/12-product-naming-and-upgrades.md)
before migrating an existing installation. Renamed paths/units do not automatically
migrate recorded process identities, Git worktree paths or service-owned storage.

The bootstrap installs only task-prefixed resources. Review it before running as
root. It intentionally does not install/authenticate OpenCode, start the Runner,
replace Owner configuration, publish Git repositories, or reboot the host.

Prerequisites: Linux cgroup v2, systemd, `git`, Debian `sudo`, the existing `me`
account, OpenCode 1.18.30 at `/home/linuxbrew/.linuxbrew/bin/opencode`, and the
explicit zero-cost `opencode/longcat-2.5-preview-free` model. Build needs Go 1.26+
and a C compiler. A task-owned Docker Go build image can provide these without
changing the host toolchain. SQLite is statically compiled by its Go driver.

```sh
# In a native Linux checkout (or task-owned Linux build container):
sh infra/runner/build.sh /tmp/monos-probe-binaries
# After copying the root-owned binaries and reviewing path/account collisions:
sh infra/runner/bootstrap.sh /tmp/monos-probe-binaries --check
sh infra/runner/bootstrap.sh /tmp/monos-probe-binaries
```

Main-session host preparation must provision these files privately:

For a fresh production Runner, use the [one-use enrollment recipe](enrollment.md)
to generate and store its identity. The explicit ID/raw-token example below is
the current boundary-probe provisioning form.

- `/etc/monos-probe/runner-token`: Runner credential matching the backend;
  mode `0640`, owner `root`, group `monos-probe-read` is **not sufficient**,
  because `me` belongs to that read group. Use owner `monos-probe`, mode `0600`.
- `/etc/monos-probe/ca.pem`: optional public custom CA certificate for HTTPS,
  mode `0644`; omit this file and `ca_file` for HTTP or system-trusted HTTPS.
- `/etc/monos-probe/runner.json`: non-secret settings, mode `0640`, owner
  `monos-probe`; never put a bearer in JSON or an argv.

```json
{
  "endpoint": "http://127.0.0.1:18443",
  "token_file": "/etc/monos-probe/runner-token",
  "runner_id": "runner-a",
  "journal": "/var/lib/monos-probe/service/journal.sqlite",
  "socket": "/run/monos-probe/command.sock",
  "execution_uid": 1000
}
```

The endpoint selects HTTP/WS or HTTPS/WSS for Runner and bundled command traffic.
For HTTPS, set `endpoint` to the HTTPS origin; add `ca_file` only for a custom CA.
System trust and hostname verification remain enabled. `ca_file` with HTTP is a
configuration error. HTTP sends credentials without encryption; the default
Compose endpoint is loopback-only. Use HTTPS or trusted private transport for
other deployments. Local socket attribution and bearer scopes are unchanged.

Create a small initialized bare Git fixture as `monos-probe` at
`/var/lib/monos-probe/cache/fixture.git`. Use umask `0027`; the shared read
group makes it execution-readable, while service ownership excludes execution
writes. Do not put credentials in the fixture. Start the unit only after
backend/database, fixture and any required custom CA are ready:

```sh
systemctl start monos-probe-runner.service
```

The no-argument sudo policy grants only `monos-probe` the fixed root-owned
helper. The helper rejects unknown JSON fields/actions, limits stdin to 1 MiB,
derives units/paths and fixes the execution identity/properties. Unit control
requires its root-owned retained manifest. The root helper never executes Git or
OpenCode: systemd starts fixed workers as `me`. Ordinary shell commands and
Node filesystem writes remain unrestricted by a product sandbox. Planner
inspection is a service-owned snapshot protected with ordinary Unix ownership.
This is the accepted non-hostile-Agent model; it is not hostile-code containment.

The preflight rejects existing unrelated service/group names, task directories,
unit names, symlinks, writable artifacts and invalid installation markers.
An interrupted first installation is preserved and requires inspection before
retry; the bootstrap never takes ownership of those ambiguous resources.
Reinstallation requires stopped task services and reconciled/unloaded Attempt
and operation units. New execution directories inherit the shared read group
through setgid, while the group has no write access to snapshots or caches.

For a binaries-only update on an existing installation, stop the task Runner
after reconciling its Attempt/operation units and run the same `--check`
preflight. Then install all four rebuilt executables into their existing fixed
paths as root:root `0755`. The Runner and helper must be updated together.
Credentials, launch records, SQLite and workspaces remain in place. An unchanged
unit file does not need `daemon-reload`; start the Runner explicitly afterwards.

Attempt parent directories are explicitly `root:root 0755` after creation;
the service's `0027` umask must not remove execution-account traversal. Existing
parents must already have that exact ownership/mode and are never silently
repaired or reused after an ambiguous failure.

OpenCode runs with `--auto`, native bash/external-directory access and normal
writable HOME/XDG state. Planner's supplied snapshot is protected by service
ownership; its edit-tool denial is supplemental. Interactive questions,
unreviewed native subagents/skills and role switching are excluded from this
single-runtime probe. Main, small, title, summary and compaction models are
explicitly pinned to the selected free model; confirm resolved values on-host.
Execution stdout/stderr are retained without a fixed truncation limit. The
worker copies output through a checked, synced writer into the supervised spool;
write or sync failure cancels the child and leaves a reserved capture-failure
marker for Runner attention and physical reconciliation. The marker is writable
by the execution account, so it is an attention hint, not authoritative proof
of filesystem failure or a formal Task transition. The separate model
catalog preflight remains bounded and fails if its catalog exceeds that limit.

The first successful workspace opening records its original Git base in the
root-owned operation result before returning the workspace. Duplicate opens
reuse that base. Finalization receives the system-retained base and verifies
both current HEAD and any retained finalization parent descend from it. Orphan
history or a reset before the base produces `invalid_finalization`; missing
objects and unavailable ownership records require recovery. Lost materialization
records are never reconstructed from a convenient current HEAD.

Git commands use a private `0600` temporary protected config for exact directory
exceptions, including linked-worktree metadata. This preserves the scoped
configuration across older Git's upload-pack subprocess without changing the
Owner's global config. System Git requests `core.fsync=committed,reference` and
`core.fsyncMethod=fsync`; controlled restart tests do not establish power-loss
recovery guarantees.

Preserve `/var/lib/monos-probe` after any unresolved run. Cleanup first stops
only units named in retained launch manifests, verifies whole-tree absence,
then stops `monos-probe-runner.service`. Do not delete journals/workspaces,
remove CLI installations, change root's source config, or touch unrelated
units. Removing the sudoers file and disabling the Runner unit removes future
probe launch access; it does not establish that existing writers have stopped.

Root-owned launch records include acknowledgement state; sibling Git operation
cgroups have separate retained `*.operation.json` records. If the helper loses
its systemd acknowledgement, status holds ownership even when a unit is not
visible. A subsequent host boot proves the old process tree absent and permits
the same idempotent operation to reconcile retained Git state. Automatic
same-boot repair of an unacknowledged legacy fixture operation is deliberately not implemented:
inspect the unit/job, cgroup and retained records before any operator repair.
Do not delete that journal merely to make a retry proceed. Well-formed typed
effect failures cross worker/helper JSON boundaries; `capture_hard_limit` is
reserved for proven ENOSPC/EDQUOT during controlled finalization journal writes.

A retained failed Attempt unit, including `200/CHDIR`, is reconciled through
normal status/Stop using its manifest and systemd identity. An unacknowledged
Stop result is replayed from the journal. Disconnecting the control channel
cancels that connection's queued work; reconnect reconciles durable records
before allowing new dispatch.

A formally revoked dispatch that never launched may receive a durable root
tombstone only after confirming no unit, pending job, cgroup or operation record
exists. An existing launch record must use normal status/stop reconciliation.
Tombstones permanently reject delayed Start and never replace a launch journal
to manufacture writer absence.

Real-host cgroup/account, syscall, OpenCode and restart tests remain separate
acceptance evidence. Local Go tests do not establish those facts. A whole-host
reboot requires the Owner's separately agreed window.

## Canonical serial Task repositories

Canonical Task dispatches reserve `tasks/ws_<hash>/worktree` and its `common`
sibling before launch. The first authenticated `open_workspace` materializes the
repository; reservation alone creates no Git data. The hash binds Task/resource
IDs across Attempts. Root-owned `launch/workspaces/*.json` and operation records
retain immutable descriptor digests, storage identity, lease ownership, pinned
base/target, private checkpoints and exact open results. SQLite retains admitted
operations and terminal results; backend remains the formal lease authority.

Bootstrap establishes matching root/service `storage-id` files once. Preserve
both; an initialized workspace with missing/mismatched identity is unavailable,
never silently recloned. The service owns `cache/resources/<resource>.git` and
private fetch-pin records. Execution can read caches but cannot write/push them.
Scoped repository access arrives from the authenticated backend exchange and
travels through helper/worker stdin. Tokens are confined to the service fetch
process environment; no token is stored in argv, Git config or durable records.

Canonical operations use per-workspace coordination and writer locks, plus
per-resource cache locks. The helper-wide metadata lock is released before
network waits. Stop fences the lease and reconciles its exact transient worker,
then cancels a never-exposed initial open or checkpoints an initialized workspace
without changing its finalized revision. A failed refresh of an existing
workspace uses explicit Stop-only recovery provenance to retain the previously
verified target; ordinary opens still fetch a fresh observation. Same-activation
reopen preserves dirty work and the real index. No extra service is installed.
