# Codex Runtime Adapter

Date: 2026-10-11. Stage B functional development under the Owner's instruction
to defer native acceptance. This record does not close A06/A30 or establish a
Linux model run.

## Implemented contract

The backend can select `codex` alongside `opencode`. Codex requires an explicit
model identifier (1–160 ASCII letters/digits plus `.`, `_`, `/`, `-`, starting
with a letter/digit). Optional reasoning is `none`, `minimal`, `low`, `medium`,
`high` or `xhigh`. This checks Adapter argument support, not a provider model
catalog. The selected model may reject a reasoning level or be unavailable to
the Owner's account; monos never silently substitutes another model.

Task and Todo Discussion dispatch preserve the selected runtime/model/reasoning
through queueing, immutable replay and Start. Current installation reports must
advertise the requested controls; losing a control before Start cancels that
selected Attempt with its factual reason. Initial policy selection may skip
unsupported controls in configured fallback order. Capacity and unknown/offline
installation facts retain their existing waiting semantics.

The Runner accepts only `/usr/local/bin/codex`, installed and authenticated by
the Owner. Independent non-root version discovery recognizes `codex-cli` stable
versions at least 0.162.1, with bounded output, timeout and process-group cleanup.
No executable path, provider credentials or installation command comes from a
dispatch. Discovery proves installation only.

Codex starts a fresh `exec` invocation with JSONL output, ephemeral session,
exact model/reasoning, fixed monos developer instructions and frozen context on
stdin. It shares OpenCode's fsync-backed stdout/stderr capture and supervised
Stop/process ownership. Its HOME/XDG/temp/state/log locations are Attempt-local;
`CODEX_HOME=/home/me/.codex` retains Owner authentication without copying secrets.
The profile ignores user configuration and rules, marks scratch untrusted, disables
project instruction discovery and disables extra tools, hooks, plugins, memories
and subagents. `skip_host_skill_discovery` is experimental in the verified CLI
version; unsupported flags/settings fail rather than being silently omitted.
Native execution uses `workspace-write` with explicit grants for prepared
Attempt directories and Node worktree/Git common directories. Planner receives no
repository write grant. Network access remains enabled for native commands and
the monos channel; path grants do not replace host account/cgroup ownership.

## Official interface references

These references and local `codex-cli 0.162.1` help/features output establish the
argument/config interface. They are not a native execution acceptance record.

- [Noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
- [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

The configuration-only synthetic check found that `-c mcp_servers={}` merges
with lower-layer tables rather than clearing them. An empty table cannot prove
that extra MCP tools are absent. Before model execution, a non-root config-only
`mcp list --json` probe rejects enabled, unknown or malformed server entries.
The probe has a 10-second timeout, bounded output and process-group cleanup;
stderr is discarded rather than copied into diagnostics. It deliberately uses
the original Owner home because the MCP subcommand lacks `--ignore-user-config`:
this can conservatively refuse a user MCP entry that `exec` would ignore. The
Owner can remove that entry; monos does not edit configuration or disable the
check. Administrator requirements can reject managed settings as well.

## Verification boundary

The focused isolated PostgreSQL scheduling/dispatch run passed 27 tests, including
exact Codex Task dispatch/replay/Start, Todo Discussion, unsupported reasoning
control and loss of that control before Start. Shared protocol tests passed 439
cases. The complete local Vitest run passed 616 tests with database suites skipped.
Existing Fastify deprecation warnings remain.

The complete `go test -race ./...` and `go vet ./...` passed on macOS with Go
1.27.1 after fixing three newly added test fixtures to include their required
Attempt/owner identity. Checks cover Adapter arguments, raw output durability,
MCP refusal/process cleanup and independent installation discovery. `pnpm lint`,
`pnpm typecheck`, `pnpm protocol:check`, `pnpm build`, scoped links/whitespace
and independent scheduling/protocol review passed. The existing Vite bundle-size
warning remains. A synthetic config-only Codex check accepted the managed config
keys without warnings; it did not invoke a model, MCP server or login flow.

Native Linux sandbox, socket/cgroup, installed authentication,
actual model output and formal monos lifecycle calls remain deferred. Subsequent
[post-launch fallback](runtime-post-launch-fallback.md) now has implementation and
local verification; ordinary exit or raw model prose never triggers that switch.
