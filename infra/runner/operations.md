# Runner and disk operations

Execution settings show Runner connection, configured limits, storage observations
and completed-Task cleanup. Refresh setup to update the observations. Missing or
stale storage measurements remain visible as unknown; CLI login, real model
access and host recovery need their separate native acceptance.

## Completed-Task retention

Automatic cleanup defaults to **seven days after formal Task completion**. In
Settings → Execution → Completed Task cleanup, choose 1–3650 days or turn future
cleanup off. The saved interval survives disabling/re-enabling. A policy change
does not revoke a cleanup request already admitted and persisted.

Only `COMPLETED` Tasks qualify. The backend checks released/absent Attempts,
settled operations and outbox, released leases, and completed delivery ownership.
It also requires an independent current final result for each materialized
workspace. The Runner checks those same exact identities against its retained
local and root-owned records before deletion. Low disk does not disable this
recovery path. Blocked cleanup retries the same request; it never broadens the
path list. A rotating scan prevents one unresolved Task from starving later Tasks.

| Storage | Retention behavior |
| --- | --- |
| Listed Task worktree/common directories and isolated allocations | Removed after eligibility and exact result/ownership verification |
| Listed Attempt scratch, data, cache, state, tmp and config directories | Removed with that completed Task |
| Acknowledged stdout/stderr spools | Default 168 hours, only after physical absence and complete backend acknowledgement |
| Completed Planner inspection snapshots | Default 24 hours, only after Planner/worker absence and settled acknowledged operations |
| Formal Artifacts, immutable Git result exports and database history | Retained and readable after workspace cleanup |
| Rework archives, shared repository caches and unresolved operation/launch records | Retained |
| Cancelled Task private work, unrelated files and unknown directories | Retained |

The service journal records exact cleanup requests and completion receipts in
`/var/lib/monos-probe/service/journal.sqlite`. Root retirement records live at
`/var/lib/monos-probe/launch/<task-id>.task-cleanup.json`. They retain inode/device
identity before deletion and reject replaced paths, linked roots and cross-device
trees. They also prevent delayed Start/open from reconstructing retired work.
Do not remove these records to force cleanup. Lost results or changed storage
identity require recovery; cleanup must leave the remaining data intact.

The Owner can still ask about a completed Task after cleanup. A new authenticated
reply-only Conversation uses its own Attempt directory and retained result
context. Its identity must be absent from the frozen cleanup request; it cannot
reopen Task workspaces. New conversation data is not added to an older request.

Settings show pending, completed and blocked cleanup counts, plus up to 16 recent
blocked Tasks and reasons. Workspace details show when disposable storage was
cleaned and retain the original Git metadata. A request exceeding the fixed
transport limit stays blocked for explicit maintenance; no partial untracked
deletion occurs. Existing completed database rows begin a new conservative
retention interval when this feature is first installed.

## Host resource defaults

Keep `/etc/monos-probe/runner.json` root-owned, group `monos-probe-read`, mode
`0640`, with trusted root-owned ancestors. It contains no credentials. The helper
reads this fixed file rather than accepting limits or arbitrary paths from an
Agent or control request. See the [Runner configuration example](README.md).

| Setting | Default | Accepted values |
| --- | --- | --- |
| `execution_limits.cpu_quota_percent` | 200 | 1–100000 |
| `execution_limits.memory_max_bytes` | 4294967296 (4 GiB) | 67108864–9007199254740991 |
| `execution_limits.tasks_max` | 512 | 16–1048576 |
| `storage_min_free_bytes` | 1073741824 (1 GiB) | 1–9007199254740991 |
| `log_retention_hours` | 168 | 1–87600 |
| `inspection_retention_hours` | 24 | 1–87600 |

Omitted/zero settings use the defaults; negative/excessive settings fail startup.
Change the trusted configuration while reconciling/stopping execution, then
restart the Runner to refresh its reporting and admission policy. CPU, memory and
process limits apply to execution cgroups. Storage is measured separately at the
journal, log, cache, workspace and inspection locations. Low/unknown storage stops
new selection, dispatch and materialization while Stop, receipt replay and cleanup
remain available. It does not revoke already dispatched authority.

Compose mounts the database volume read-only into the backend for local `statfs`
observation. `MONOS_DATABASE_STORAGE_PATH` names that mount and
`MONOS_STORAGE_MIN_FREE_BYTES` has the same 1 GiB default. Missing instrumentation
is explicitly unverified. These measurements do not replace backups or recover a
lost disk.

## Credential rotation, revocation and capacity

Use the local backend administrator with `DATABASE_URL` or
`MONOS_DATABASE_URL_FILE`. It reads bounded JSON from stdin; there is no public
grant-issuance endpoint. For Compose, replace `pnpm runner:manage` below with:

```sh
docker compose -f infra/compose/compose.yaml exec -T server node --experimental-strip-types apps/server/src/runner-management-admin.ts
```

Save a nonsecret command in `runner-options.json` using the actual Runner ID:

```json
{"schema_version":1,"action":"rotate","runner_id":"RUNNER_ID","ttl_seconds":900}
```

Issue a temporary grant to a private administrative file, then run rotation under
the Runner service account:

```sh
umask 077
pnpm runner:manage < runner-options.json > runner-rotation-grant.json
sudo -u monos-probe /usr/local/libexec/monos-runner rotate --config /etc/monos-probe/runner.json < runner-rotation-grant.json
```

Never put grant/credential values in arguments, logs or Agent-readable storage.
The grant lifetime is 60–3600 seconds. Rotation atomically replaces the credential
for the same Runner, invalidates the old connection and lets reconnect reload the
private identity. Current raw-token probe and enrolled JSON identities are both
supported. Execution ownership, journals, workspaces and capacity remain intact.

If the response or installation is interrupted, retry the exact retained rotation
with the original configuration and EOF:

```sh
sudo -u monos-probe /usr/local/libexec/monos-runner rotate --config /etc/monos-probe/runner.json < /dev/null
```

The service-private `.rotate.pending` record retains the request before exchange.
Do not issue a replacement grant to recover the same request. Exact receipt replay
does not restore a credential superseded by later rotation or revocation.

For immediate credential revocation or a future capacity change, use one of these
nonsecret inputs with the same administrative command:

```json
{"schema_version":1,"action":"revoke","runner_id":"RUNNER_ID"}
```

```json
{"schema_version":1,"action":"set_capacity","runner_id":"RUNNER_ID","capacity":2}
```

Revocation rejects old authentication without claiming existing processes are
absent. Issue and consume a fresh rotation grant to restore that same Runner.
Capacity is 1–32; lowering it affects future admissions and never evicts existing
writers. Reconcile retained ownership through the ordinary recovery protocol.
