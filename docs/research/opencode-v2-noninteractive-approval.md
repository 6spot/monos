# OpenCode 2.0.20 noninteractive approval contract

The supported monos invocation is `run --standalone --auto --format json` with
the selected model and managed `monos-probe` agent. In this mode, an ordinary
permission request is answered automatically. It is not an Owner approval wait.
The installed CLI does not export a pending-permission event on its JSON stdout.
Treat this profile's ordinary approval-wait acceptance case as **not applicable**;
generic interactive attention remains unsupported until an adapter has a verified
signal for an actual wait.

## Inspected installation and source

Read-only inspection on 2026-10-09 resolved the installed executable to
`/home/linuxbrew/.linuxbrew/Cellar/opencode/2.0.20/bin/opencode`.
Its SHA-256 is
`90e905f6e9b6babd60e6bb1ad3b87e8405421cb84a64b088550620f8e9011051`.
The installed Homebrew formula names the upstream `v2.0.20` source archive and
its SHA-256 `e8bc8af7f8f2df976740fc0a3a0564d6d7b34b9389d921ae0007fa2f49c1c236`.

The executable includes minified JavaScript. The actual permission handler was
read at byte offset `125816112`; the `attached` default was read at byte offset
`125830909`. Both match these tagged upstream source contracts. Offsets identify
this exact executable, not a stable interface.

| Upstream file at `v2.0.20` | Inspected source SHA-256 |
| --- | --- |
| `packages/cli/src/run/noninteractive.ts` | `7d8997489112a8278787d916f3c7ce0b44f34faf43314bd7a4affa73cbeda752` |
| `packages/cli/src/run/run.ts` | `da2c319095d92215f7b79efd3b0654f9b6d8dd434bf7007e0d52d4fbf8c19846` |
| `packages/cli/src/commands/handlers/run.ts` | `1ae759254ffd7de58153fbe9336a2ff9fb46757cdbd86220b17524b78470112c` |
| `packages/schema/src/permission.ts` | `5248a0717ebf30196ba25ed0a8cd5fef8c0b5bd8a039239822ccb34940999be7` |

## Permission and form behavior

The [command handler, line 27](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/commands/handlers/run.ts#L27)
passes `auto: input.auto || input.yolo || input.dangerouslySkipPermissions`.
The [noninteractive permission handler, lines 155–183](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/noninteractive.ts#L155)
then implements:

```ts
if (!input.auto) {
  // Writes to stderr, including ANSI styling.
  UI.println(/* style */, `permission requested: ${request.action} (${request.resources.join(", ")}); auto-rejecting`)
}
await input.client.permission.reply({
  sessionID: request.sessionID,
  requestID: request.id,
  decision: input.auto ? "once" : "reject",
  // Non-V1 rejection also supplies model-visible feedback.
}).catch(() => {})
```

The internal event is `permission.asked`, with request fields `id`, `sessionID`,
`action`, and `resources`, plus optional `save`, `metadata`, `source`, and
`message`; `permission.replied` carries `sessionID`, `requestID`, and `reply`.
See the [permission schema, lines 25–53](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/schema/src/permission.ts#L25).
The [consumer, lines 210–223](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/noninteractive.ts#L210)
handles owned requests internally and immediately continues without rendering
these internal events. The pending-request sweep at lines 729–745 uses the same
handlers, so an event subscription race does not intentionally create an Owner wait.

The managed monos configuration denies `question`, `subagent`, and `skill`, and
denies `edit` for Planner. Explicit deny returns before ask creation in
[core permission evaluation, lines 173–188](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/core/src/permission.ts#L173).
If a session-owned form nevertheless arrives, `form.created` is handled by
`cancelForm`, which invokes `session.form.cancel` and sets exit code `1` outside
V1 compatibility ([lines 185–195](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/noninteractive.ts#L185)).

This is not proof that every provider-specific login or global form can never
wait. The standard run entry passes empty options, while
[`run.ts:149`](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/run.ts#L149)
uses `attached: options.attached ?? true`, even for this standalone invocation.
Global forms are cancelled only in the `!attached` branch. No verified stdout
waiting signal for such a case was found; this research does not claim support
for it or infer a wait from silence.

## Output and verification boundary

The [JSON emitter, lines 97–100](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/noninteractive.ts#L97)
emits newline-delimited objects shaped as
`{type, timestamp, sessionID, ...data}`. Its rendered kinds are `step_start`,
`text`, `reasoning` when enabled, `tool_use`, `step_finish`, and `error`.
Tool records carry `part`; error records carry `error`. Neither
`permission.asked` nor `form.created` is forwarded by this renderer. Startup
errors are also rendered as `type: "error"` with exit code `1`
([run.ts:247–261](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/src/run/run.ts#L247)).

Consequently, matching stderr text `permission requested:` cannot establish
pending interactive attention: the CLI's own matching message explicitly says
it auto-rejected the request, and the fixed `--auto` invocation does not print
that message. Ordinary tool output containing those words is not an objective
Runtime wait either.

This investigation read installed executable bytes, the installed formula, and
tagged upstream source only. It did not invoke a model, force a native permission
prompt, create a session, call permission APIs, or read provider configuration or
credentials. Upstream's existing
[noninteractive tests, lines 419–453](https://github.com/anomalyco/opencode/blob/v2.0.20/packages/cli/test/run/noninteractive.test.ts#L419)
use a mocked client to exercise session/global-form cancellation; these tests
were inspected, not run, and are not installed CLI acceptance evidence.

A no-model permission API call could exercise the server permission service,
but would not prove this `run` renderer or create a valid waiting event under
`--auto`. No synthetic native harness is required for the not-applicable approval
case. Reuse actual native execution evidence and the existing monos
invocation/configuration tests; reserve a future waiting-attention claim for an
adapter mode that exposes a verified pending interactive signal.
