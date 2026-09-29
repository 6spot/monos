# Runner Todo scope research

Source base: Todo capture commit `9c3ce55`; read-only investigation on 2026-09-30,
followed by root authorization to implement the agreed Runner changes.

## Findings

- `runner/internal/local/socket.go:98` builds every Agent envelope with
  `scope_id = Dispatch.TaskID`. Kernel peer/cgroup attribution itself is already
  Attempt-based. Keep attribution and immutable journal-before-send; derive scope
  from the validated exclusive Todo/Task branch, never a CLI argument.
- `Dispatch` currently requires Task, resource and Node activation. `Operation`
  also requires a resource for Stop. These requirements, not OS supervision,
  prevent unassigned Todo execution. Journal starts, events, request keys, cgroups,
  inventory reconciliation, credentials and Stop use Attempt/dispatch identity.
- `host.prepare` creates scratch plus workspace/common for every Attempt.
  A Todo needs only scratch, cache, state, config, data and tmp. No repository is
  needed to launch OpenCode, whose stdin receives the backend-built context.
- `daemon.effect` special-cases inspection into `host.Inspect`; that function
  always clones `/var/lib/monos-probe/cache/fixture.git`. It cannot inspect a
  configured Project resource. Reject Todo repository effects in daemon and host
  boundaries until real resource-addressed inspection exists; never expose the
  fixture or invent a resource. Preserve existing Task probe behavior.
- OpenCode `run --pure --auto --format json` is one-shot, with fresh per-Attempt
  XDG directories and no resume/session flag. `Config` uses fixed protocol;
  `Prompt` travels only over stdin. Fresh sessions safely honor reassignment and
  scope cutoffs. There is no verified live-input/reminder transport: include the
  correct Todo handoff in the initial managed instructions, never reinvoke on exit.
- CLI help and accepted-command switch plus `wire.Envelope`'s command-specific
  field validation must all include the three new Discussion tools. No Runner
  heuristic may promote raw OpenCode output into a formal reply.
- `EffectResult` has no history/state projection today. `read_discussion` needs a
  bounded generated result, not JSON hidden inside a message string. Backend owns
  the result contract and input-cutoff/cursor guards.

## Agreed minimal wire extension

Keep `Dispatch.kind = node|planner`, existing fields and legacy Task meanings.
Exactly one `task_id` or `todo_id` is present. Task keeps existing required
`task_id/resource_id`; Todo requires `kind=planner`, `todo_id`,
`source_message_id`, `project_context_version`, `project_context_digest`,
`node_activation=0`, and excludes Task/Node/resource IDs.
Todo `control_version` is its Discussion epoch; `source_watermark` is immutable
launch input. Zero activation is the retained Planner wire convention, not a Node.

`Operation.resource_id` is optional only for `kind=stop`; repository operations
still require it. Do not rewrite old Task dispatches, manifests, envelopes or
request digests. Generated Go optional IDs become pointers: compare values and
presence in host effect ownership, operation identity, journal replay and
never-launched Stop inventory; pointer equality is incorrect after JSON decode.

Add commands under the existing authenticated envelope/receipt path:

- `commit_discussion_turn`: `reply`, `working_requirement_state`,
  `source_message_id`, `source_watermark`, optional
  `task_preview: {title,specification,project_id?}`.
- `read_discussion`: optional bounded `cursor`.
- `update_working_requirement_state`: `working_requirement_state`,
  `resolved_watermark`, `project_context_version`, `project_context_digest`.

Only `commit_discussion_turn` achieves the Discussion phase outcome. Cache rebuild
must not resolve pending input or release ownership. Native retry/status still
reuse the retained exact envelope and expired Attempts gain no fresh authority.
The server must admit/retain resource-free Stop after commit/withdrawal and wait
for physical release before starting a successor. Canonical DB owner/capacity
changes belong to backend, never Runner.

## Required evidence

1. Shared JSON fixtures: historical Task dispatch/Stop still decode; Todo without
   resource is valid; mixed/missing scope, Todo Node/resource, missing source and
   resource-free workspace effects fail. Three command payloads reject irrelevant
   fields, malformed versions and oversized results.
2. Scope derivation rejects ambiguous owners and binds Todo command envelopes;
   exact retry digest survives reopen while changed scope/payload conflicts.
3. Equal resource strings in independently allocated pointers replay correctly;
   nil/equal/nil-versus-present combinations retain correct operation identity.
4. Scratch-only Todo launch retains native shell and protocol transport; no
   workspace/common/snapshot or fixture context is injected. OpenCode preflight
   and process run share exact environment/cwd, and there is one model invocation.
5. Todo non-Stop effects are rejected before inspection/host execution; actual Stop
   still processes omitted resources and cancelled-before-start tombstones.
6. Existing daemon restart, reboot absence, capture failure, ordered logs and
   escaped-descendant suites stay green. Add Todo-owned start/reconcile/Stop
   coverage without replacing the existing Task recovery matrix.
7. Root runs generated protocol checks and Linux `go test -race ./...` / `go vet
   ./...`; actual installed native Todo CLI acceptance remains a separate host
   trial, not something unit stubs establish.

Install the compatible Runner before enabling Todo dispatch. New strict schemas
reject old Runner decoding of new shapes; schema generation alone does not prove
mixed-version deployment compatibility.
