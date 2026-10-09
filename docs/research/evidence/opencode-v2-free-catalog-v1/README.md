# OpenCode v2 free-catalog native observation

One real-host, no-inference trial passed on 2026-10-09. It reproduces an empty
initial catalog and demonstrates a matching-location `model.updated` event
followed by a qualifying selected-model snapshot, without polling.

## Evidence

- [probe.py](probe.py): exact executed root-supervisor source, with a 30-second
  discovery deadline, bounded streams and identity-checked process cleanup.
- [intent.json](intent.json): single-use local launch intent and source digest.
- [result.json](result.json): sanitized native observations and cleanup facts.

The host was `100.120.14.84`; OpenCode ran as `me`, UID/GID `1000:1000`, with no
supplementary groups. The root supervisor was a Linux child subreaper and gave
OpenCode its own process group. It did not install or restart any service.

The executable was
`/home/linuxbrew/.linuxbrew/Cellar/opencode/2.0.20/bin/opencode`, SHA-256
`90e905f6e9b6babd60e6bb1ad3b87e8405421cb84a64b088550620f8e9011051`.
The exact argv was `serve --stdio --hostname 127.0.0.1 --port 0`.

The trial used clean, isolated HOME/XDG/TMP directories, cwd equal to PWD,
`OPENCODE_CONFIG=/home/me/.config/opencode/opencode.json`, and disabled project
configuration. Managed configuration selected `opencode/longcat-2.5-preview-free`
for the main model and primary/title/summary/compaction agents. Other managed
settings match the adapter's v2 shape. The primary system text identifies this
no-model observation, and no `MONOS_SOCKET` is supplied. Those differences were
not exercised: no session or tool endpoint was called.

Only the fixed Owner configuration path was passed to the native CLI. The probe
did not inspect or copy provider configuration or credentials. It generated a
private server password in memory, discarded stderr, and retained only bounded
selected-model fields, counts, timings and event type/location observations.

## Observed sequence

Times are seconds since the remote supervisor started.

| Time | Observation |
| --- | --- |
| 0.1334 | Native process started, PID `87166`, process group `87166`. |
| 0.3980 | Private stdio handshake returned a loopback endpoint. |
| 0.4050 | SSE `server.connected` received; initial catalog GET issued. |
| 0.4562 | Initial catalog: `data: []`, 91 bytes, expected scratch location. |
| 0.7807 | Matching-location `model.updated` received; catalog refetched. |
| 0.7897 | Catalog: 24 entries, 22,413 bytes, exactly one selected model. |
| 0.8777 | Native process exited 0; descendants/process group absent; isolated directory removed. |

The selected entry was enabled, active and tool-capable. Its one explicit price
tier had input `0`, output `0`, cache read `0` and cache write `0`. Only one
`GET /api/event` and two `GET /api/model` requests were issued. No inference,
session, prompt, authentication, reload or installation endpoint was called.
Startup could hydrate isolated caches or activate configured plugins.

Cleanup closed the client connection and stdin lease. No TERM or KILL signal
was necessary. The root supervisor confirmed no remaining descendant or member
of the native process group and stopped its reader threads before returning.
This is direct native Linux lifecycle evidence, not full Runner/systemd/cgroup
acceptance.

## Smallest integration change

Replace only the free-model catalog preflight's one-shot `api --standalone
model.list` lifetime with one supervised `serve --stdio` lifetime. Reuse the
actual Attempt environment/configuration and existing selected-entry validator.
Subscribe before the first catalog read; after an empty or otherwise
nonqualifying snapshot, refetch only on matching-location `model.updated`.
Retain the deadline/output bounds, add bounded SSE parsing, reject redirects and
nonloopback endpoints, and fail closed on disconnect, overflow or failed cleanup.
Keep the private stdin lease and process inside existing Attempt ownership.
The separately authorized DeepSeek direct-run path needs no catalog change.

This observation does **not** establish an all-plugin readiness barrier or final
catalog stability. Plugins can apply an initial snapshot and then apply again
after pending package resolution. A separate native `run` can also have a fresh
catalog lifetime. The supported claim is selected-entry snapshot evidence at
the recorded time, with the existing pricing checks satisfied.

## Pinned source contracts

- [Standalone argv, authentication and ownership lease](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/services/standalone.ts#L18)
- [Loopback default, stdio handshake and EOF disposal](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/server-process.ts#L61)
- [Location query/header precedence](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/server/src/location.ts#L39)
- [Subscription registration before connected event](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/server/src/handlers/event.ts#L14)
- [SSE frame encoding](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/server/src/event-feed.ts#L29)
- [Matching-location model snapshot update](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/core/src/model.ts#L225)
- [Immediate and deferred plugin application](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/core/src/plugin/supervisor.ts#L153)
- [CLI API response buffering](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/commands/handlers/api.ts#L38)
