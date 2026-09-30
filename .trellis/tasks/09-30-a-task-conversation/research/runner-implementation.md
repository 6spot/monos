# Runner implementation: Task Conversation and guidance declarations

Status: implementation complete; local Go race/vet/build and diff checks passed.
Backend semantics, independent review, Linux/native acceptance and deployment are
main-session owned. No services, remote host state, generated files or commits were
changed by this worker.

## Contracts implemented

- `task_conversation_source` is mutually exclusive with initial-planning and Node
  sources; Todo/Task ownership remains exclusive. Conversation is Task Planner,
  with no Node/resource/source-message identity, and empty canonical workspace
  reservations. Outer source watermark equals the exact source watermark; outer
  control version equals immutable `conversation_version`.
- Native `read_task_context {}` and `read_task_history {cursor?,query?}` require a
  canonical conversation source. `commit_task_turn` matches its exact source ID,
  input ID and source watermark. A conversation-only source permits `reply` routing
  alone. Node, Todo and initial-planning commands cannot use this phase.
- Legacy Task probe `commit_task_turn` remains `reply_only` without canonical source
  fields. Todo cannot acquire Task reply authority. The schema remains authoritative
  for command shape and routing union validation.
- Local journal envelopes retain conversation authority separately from the
  action's current execution basis. A read does not replace the immutable source
  version or rewrite an uncertain request. The actual action/obligation semantics
  remain backend-owned.
- Adapter fixed instructions identify exact source/input/watermark, teach bounded
  Task reads and formal turn commit, explain action re-evaluation after a fresh
  context read, and preserve explicit Owner controls and pending obligations.
  Conversation retains the existing one-shot scratch invocation and original
  frozen stdin prompt, with no live steering, session reuse or extra service.
- Root launch/scope checks recognize the source and allocate scratch only.
  Repository-free Stop is its sole physical effect; legacy repository paths,
  workspace completion/settlement and all repository-bearing Stop shapes reject.
- The existing finite reconnect batch recognizes conversation Stop with an exact
  retained source, reservations, original operation, revoked/unreleased authority
  and local failure/terminal evidence. Ready ordering and the normal `effect:`
  flight key remain unchanged. Missing/hard failure evidence cannot gain automatic
  recovery; terminal results replay without Host calls.
- Node fixed instructions and CLI help require explicit handled guidance IDs.
  Omission and `[]` declare none. The Runner does not infer handling from launch,
  transport receipt, prose or exit. Existing immutable completion operations,
  manifests, hard-recovery settlement and original envelope replay are unchanged.

## Files changed

- `runner/internal/wire/{scope,wire}.go`: source validation and Task read/commit
  payload allowlists.
- `runner/internal/local/socket.go`: phase/source and reply-only preparation guards.
- `runner/internal/host/{effect_scope,helper}.go`: scratch/Stop-only authority.
- `runner/internal/daemon/recovery.go`: finite conversation Stop reconciliation.
- `runner/internal/adapter/opencode.go`, `runner/cmd/monos/main.go`: fixed protocol,
  exact command syntax, read/commit discovery and guidance declaration behavior.
- Adjacent new conversation tests in local, host, daemon, adapter and journal;
  existing native CLI/Node envelope tests extended.
- `runner/internal/wire/fixtures_test.go`: shared completion-identity fixture parity,
  proving prior completion operation hashes remain compatible after schema growth.

## Checks executed

From `runner/`, using `mise exec go@1.27.1 --`:

- Focused wire/local/adapter/journal/CLI and host/daemon suites passed.
- Full `go test -race ./...` passed across all Runner packages.
- `go vet ./...` passed.
- `go build ./cmd/...` passed for all four command packages.
- `git diff --check -- runner` passed.

Meaningful regressions cover wrong source/input/watermark/version, cross-phase
commands, reply-only action rejection, unchanged execution action basis on immutable
request replay, exact guidance omitted/empty/list declarations, frozen native stdin
and scratch permissions, no provider-resume invocation, source-exclusive root
effects, source changes before recovery queue drain, physical cleanup before Ready,
normal occupied-flight tail retention, once-per-connection recovery, and zero-Host
terminal replay. Shared generated protocol fixtures pass in the full suite.

## Integration limits

Local fakes establish scope/recovery orchestration, not real systemd/cgroup or
provider consumption. The main session still must verify native canonical Task
replies and guidance follow-up, retained old process/workspace ownership, exact
handled-ID manifest/receipt provenance, and existing-service restart behavior on
the test host. Guidance routing/assignment/withdrawal/handling and delivery cutoff
are backend responsibilities; these Runner changes do not claim those semantic
effects merely because a process launched or stopped.
