# Multica adapter reference for monos

Date: 2026-10-09. Source: the latest GitHub `main` observed during this review,
[`c76a012dc70da037372159bbd19a4f69f0120783`](https://github.com/multica-ai/multica/commit/c76a012dc70da037372159bbd19a4f69f0120783),
committed at 2026-10-09 03:29:44 UTC. The source was fetched directly from GitHub
into a fresh, detached research checkout. The existing local Multica checkout
was not read. This is source and test inspection, not execution of Multica's
test suite or native model sessions.

## Conclusion

Use Multica as a reference for small, proven adapter mechanisms: explicit launch
contracts, version-specific arguments, structured output parsing, bounded
diagnostics, process cleanup, and truthful resume results. Keep monos's existing
durable logs, Tool Protocol authority and physical ownership guarantees.

The current monos adapter already has explicit cwd/environment/stdin, bounded
discovery, a free-model price check, synced output spools, and separate main-exit
and process-absence observations. Replacing all of it would discard verified
behavior. This review reproduced and fixed the narrower successful version-probe
cleanup gap identified below.

## Useful boundaries

| Multica mechanism | Application to monos |
| --- | --- |
| [Session interface](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/agent.go#L180): message stream, observed terminal result, cleanup and final result are distinct. | Preserve raw output and objective process/protocol observations independently. A CLI terminal event or process exit never substitutes for `complete_node` or a Planner's formal command. |
| [Owned launch helper](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/launch.go#L151): cleanup runs even after a successful probe. | Verify that version discovery cannot leave an inherited child running after its parent succeeds. Use scoped probe cleanup; Attempt cgroups remain the authority for real execution. |
| [Stream scanner](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/stream_scanner.go#L9) and [collection limits](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/run_collect.go#L69) distinguish bounded diagnostics from truncated answers. | Keep exact spool bytes and durable offsets. Any future structured parser gets explicit bounds and cannot convert parse failure or overflow into completion. Existing catalog bounds already fail closed. |
| [Bounded stderr tail](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/stderr_tail.go#L12) retains useful startup diagnostics. | A future diagnostic projection may retain bounded, sanitized facts. Do not expose provider configuration or replace the current deliberate suppression of sensitive discovery stderr with raw text. |
| [Explicit resume rejection](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/agent.go#L260) distinguishes refusal from transient/unknown failure. | If native resume is added later, retain exact session scope and distinguish a rejected resume from an uncertain one. Fresh canonical context remains sufficient; no silent Task replay or opaque-session dependency. |

The organizing principle is a small adapter boundary per supported CLI, with
shared mechanics where behavior is genuinely the same. Runtime discovery,
launch arguments and CLI-specific output decoding belong there. Task/Node
transitions, scheduling, exact Owner authorization and workspace handoff retain
their existing monos owners. Add interfaces when a second implementation needs
them; this research does not introduce a general plugin framework.

## OpenCode: what matches and what needs current-version evidence

Multica's latest repository commit is not proof that every upstream CLI change
has already been incorporated. Our installed OpenCode is **2.0.20**; some
Multica v2 decisions explicitly describe **2.0.10**.

| Boundary | Latest Multica source | Decision for monos 2.0.20 |
| --- | --- | --- |
| Launch | [opencode.go](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode.go#L95) uses JSON output, explicit model, stdin prompt and v2 cwd/PWD parity. | Keep our already verified stdin and cwd/PWD behavior. Its `--dangerously-skip-permissions` and our `--auto` reach the same inspected v2 permission branch. |
| Configuration | [opencode_v2.go](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode_v2.go#L109) cites a 2.0.10 limitation and refuses managed MCP. | Preserve the Owner-config plus managed-override behavior actually verified with 2.0.20 `config.get`. monos uses the bundled CLI, so Multica's MCP restriction is not our configuration contract. |
| Model discovery | [models.go](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/models.go#L764) tries `models --verbose`, then `models`; execution passes the selected model directly. | Reuse the distinction between catalog discovery and explicit execution. Do not copy obsolete v1 discovery commands or claim this fixes the v2 cold `model.list` snapshot. The user-authorized free-only requirement still needs verified zero prices; no paid fallback. |
| Errors | [JSON event parsing](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode.go#L470) separates error events from exit status, but its [error shape](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode.go#L817) reads `name` and `data.message`. | Adopt version-tested event decoding if needed; 2.0.20's `type`/`message` shape needs its own fixture. Blind copying would lose useful error detail. Raw durable output remains available regardless of parsing. |
| Tool correlation | [Tool conversion](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode.go#L621) reads `part.callID`. | Test the 2.0.20 renderer's `part.id` before adding a normalized tool projection. Tool-call metadata is diagnostic, not formal monos state. |
| Thinking | [v2 model variant](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode_v2.go#L72) encodes `provider/model#variant`. | Useful reference for a later supported thinking option. Current monos rejects unsupported thinking rather than silently mapping it. |
| Stop | [Output lifecycle](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode.go#L282) stops the process tree before closing pipes. [Standalone](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/opencode_v2.go#L250) bypasses resident-server interruption. | Preserve standalone execution and exact whole-cgroup absence. A best-effort session interrupt cannot release a monos workspace lease. |

## Permission handling is intentionally unattended

Multica does not provide evidence for a general Owner approval dialog in this
adapter path. OpenCode uses the noninteractive permission flag. Claude uses
[`bypassPermissions` and disables `AskUserQuestion`](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/claude.go#L1078),
then [responds to control requests through stdin](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/claude.go#L556).
Codex [handles known approval requests at its app-server boundary](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/codex.go#L2921)
and explicitly errors on unsupported server requests.

Borrow the explicit, version-tested protocol handling. Keep semantic Owner
questions in monos's formal planning/conversation tools. Do not translate a
quoted log line into Owner intent, grant new workspace authority from an
approval payload, or claim that every possible login/global form is handled.

The [installed OpenCode source audit](opencode-v2-noninteractive-approval.md)
shows ordinary permissions automatically answered under `--auto`, while
`permission requested: ...; auto-rejecting` is a rejection warning in the other
branch. Commit `cd24e94` removes that false waiting classification and preserves
all raw bytes/offsets/order. Its full Go race suite and vet passed. Generic
login/global-form waiting still lacks a verified signal and Owner projection;
this reference review does not close that broader acceptance claim.

## Patterns that do not transfer

- [Silence/progress watchdogs](https://github.com/multica-ai/multica/blob/c76a012dc70da037372159bbd19a4f69f0120783/server/pkg/agent/codex.go#L46)
  cannot become monos failure or fallback rules. The architecture explicitly
  rejects inferring a hung Runtime from silence.
- Do not import Runtime Profiles, team/organization abstractions, general custom
  CLI-argument settings, or an MCP registration requirement. Existing
  [monos invariants](../08-principles-and-non-goals.md) remain authoritative.
- A Multica result status, tool result, `step_finish`, usage record or clean
  process exit does not authorize monos completion or acceptance.
- Do not replace supervised Attempt identity, durable original receipts,
  systemd/cgroup isolation or current-run recovery with local best-effort process
  cleanup. The latter is useful only at its explicitly bounded probe boundary.
- Neither a working old CLI version nor a fake executable test proves a new
  installed CLI version. Pin source, CLI version, configuration, arguments,
  event fixtures and the actual environment for every claimed adapter.

## Immediate work and verification

1. Correct the false permission-warning classification: completed in `cd24e94`.
   `go test -race ./...` and `go vet ./...` passed with Go 1.27.1 on macOS; this
   does not claim a new Linux deployment or forced native permission prompt.
2. Successful version-probe child leakage: reproduced and fixed in
   [discovery.go](../../runner/internal/host/discovery.go). The
   [regression fixture](../../runner/internal/host/discovery_process_test.go)
   launches a real child in the inherited process group, closes its output, and
   returns a valid version from the parent. Before the fix it failed with
   `successful version probe returned while child 95828 survived: <nil>`.
   After waiting for any started command, discovery now uses the existing
   bounded group settlement, including on successful exit. An unresolved group
   prevents a successful discovery result. The 10-second execution deadline
   and 1-second pipe wait remain; group settlement can add up to 3 seconds.
   `go test -race ./internal/host -run '^TestDiscovery' -count=1 -v` and
   `go vet ./internal/host` passed with Go 1.27.1 on macOS. Coverage includes the
   surviving-child regression, ordinary version output, exit code 7 and missing
   executables. This proves the local probe's inherited-group boundary, not
   descendants that escape that group or Linux Attempt/cgroup acceptance.
3. Use this reference when implementing the next supported CLI. Keep model
   discovery, version selection, normalized diagnostics and native resume
   scoped to proven needs; no whole-adapter rewrite is required by this review.

No model invocation, provider mutation, production deployment, Trellis task
lifecycle change or journal operation is part of this research. The installed
delivery evidence and PR 6/7 finality remain intact. Stage B and complete V1
acceptance remain separate work.
