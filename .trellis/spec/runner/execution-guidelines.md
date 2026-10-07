# Native Execution, Attribution and Recovery

Sources: [Runtime](../../../docs/03-runtime-and-execution.md), [Tool Protocol](../../../docs/05-tool-protocol.md), [host identities](../../../docs/11-technology-and-deployment.md).

## 1. Scope / Trigger

Go daemon, native Adapter, process launcher, bundled command CLI and local SQLite journal. Implementations live in `runner/cmd/monos-runner`, `runner/cmd/monos` and `runner/internal`.

## 2. Signatures

Dispatch carries stable Attempt/dispatch ID, owner/fencing, selected target, Runner connection incarnation and versioned context references. Normalized events carry Attempt/stream/sequence. CLI local-channel operations bind the kernel peer to supervised dispatch ownership.

Generate transport types from protocol schemas. Current entrypoints:

- `monos-runner --config /etc/monos-probe/runner.json`: endpoint, CA path, private token path, Runner ID, SQLite path, socket path and execution UID.
- `monos <command> --input <file|-> --request-id <id> --output json`; `retry` and `command-status` take the existing ID and no replacement input.
- The service account invokes only `/usr/local/libexec/monos-probe-launch` with no argv. Bounded JSON stdin selects a fixed action and validated dispatch/operation; it cannot choose executable, UID or arbitrary systemd properties. See [helper](../../../runner/internal/host/helper.go) and [bootstrap](../../../infra/runner/bootstrap.sh).
- [Socket attribution](../../../runner/internal/local/socket.go), [Linux process identity](../../../runner/internal/host/process_linux.go), [journal](../../../runner/internal/journal/journal.go) and [control reconciliation](../../../runner/internal/daemon/daemon.go) own the corresponding boundaries.

## 3. Contracts

- Use resolved executables and structured argument arrays with explicit environment/cwd. Prefer Go standard library; choose unavoidable WSS/SQLite/schema dependencies deliberately.
- Runner initiates authenticated WSS; it has no direct product DB access.
- Persist start intent before spawn, discover ownership across the spawn/ack crash window, and tombstone cancelled dispatches.
- Two identities: service account owns credentials/journal/cache; execution account owns Agent processes/workspaces and Owner-managed CLI logins.
- A narrow privileged launcher/systemd policy starts fixed execution-account processes in owned cgroups. No arbitrary root shell surface.
- CLI socket identity uses kernel peer credentials, process birth/boot identity and cgroup membership. UID or caller-supplied scope alone is insufficient.
- Persist immutable request envelopes outside the Agent tree before HTTPS send; no bearer credential in journal.
- Freeze/stop entire trees before workspace handoff; terminal DB state does not prove absence.
- Heartbeat loss is connectivity, not failure. Offline computation may continue; unaccepted formal mutations cannot be replayed automatically.
- Planner repository access remains read-only while CLI/socket/HTTPS and reserved scratch are usable.
- Native shell and Node workspace writes are allowed under the execution account. Do not add shell-command allowlists, global read-only mounts or PID namespaces to the baseline. Reserve paths for workspace placement, not hostile-code containment.
- Enforce Planner snapshot immutability through service-owned snapshot files/parents and execution-readable modes; an edit-tool denial alone is insufficient. Ordinary bash/external-directory access remains enabled.
- No runtime install/login automation. Verify the actual execution account and existing CLI configuration.
- Inventory reconciliation consumes all bounded snapshot pages before readiness. A changed snapshot restarts the read; incomplete, conflicting or over-limit inventory preserves ownership and cannot enable dispatch. See [inventory tests](../../../runner/internal/control/inventory_test.go).
- Missing launch evidence or mismatched process birth is uncertainty, not proof of absence. Persist the process-absence event before releasing local ownership so a daemon crash cannot strand the backend claim.
- For `ordered_v1`, sync each bounded stdout/stderr write into the supervised spool before the Runner journal allocates an Attempt-wide event order and advances the source offset. Retain source bytes in `data_base64`; display text may replace invalid UTF-8. Hold an incomplete UTF-8 suffix while the worker is running so a read boundary does not corrupt valid display text; after termination preserve even malformed trailing bytes in the raw field. No fixed output truncation is allowed. A write/sync failure cancels the child, leaves a preallocated marker when possible, and uses worker exit code `74` through the validated systemd Attempt unit as the authoritative capture-failure fact. The service account also needs its own fsynced failure marker: a worker-owned `capture.failure` file may be unreadable across the account boundary or after restart. Emit `capture_failed` before `exited`, request whole-tree Stop, and retain the reservation until absence is verified.
- systemd `MainPID=0` with `ExecMainCode=1` is a completed main process even when `ActiveState=active (exited)` and detached descendants keep the cgroup populated. Journal one `exited` observation and let the backend revoke a missing formal result; keep local phase `running` and the slot held until Stop plus whole-tree absence. `process_absent` is a separate later fact. Do not wait for `!Populated` before reporting a main exit, and do not release ownership on main exit alone.
- An acknowledged launched transient `active/exited` unit with `RemainAfterExit=yes`
  and `Restart=no` may outlive its removed kernel cgroup. `statusOfUnit` uses
  `verifyExitedUnit` for an empty ControlGroup or a missing nonempty cgroup path.
  Require exact Attempt/dispatch/User/Group/cgroup scope, valid InvocationID,
  completed main exit, absent old ExecMainPID and expected kernel cgroup, no unit
  job, and two identical systemd observations. Unknown or malformed facts remain
  errors. A successful status reports physical absence only; the admitted Tool
  Protocol operation still owns canonical settlement and release.
- `Population` maps ENOENT to false. Lstat before it and again after false to route
  disappearance through the full exited-unit proof. Persist `Acknowledged=true`
  only after all status validation succeeds; repeated failed observations must
  never manufacture acknowledgement for later exit recovery.
- After backend reconnect, a changed Runner connection instance may precede completion of inventory reconciliation and `Ready`. The attributed `monos retry --request-id <same-id>` may briefly return `control_unavailable`; retry the immutable request ID after readiness. Never synthesize a fresh command ID or reread a changed input file.
- OpenCode model preflight must use the exact Attempt environment and scratch cwd returned by the Adapter, including all XDG paths. For the pinned free-model probe, run `opencode models opencode --pure --refresh --verbose` before `run`, with a 30-second deadline and 4 MiB stdout limit. A fresh XDG cache can otherwise select OpenCode's stale bundled catalog while the Owner's default cache advertises a newer model.
- Validate the exact selected provider/model entry, active status, native tool-call support and explicit zero input/output/cache-read/cache-write prices, including any pricing tiers. Missing, malformed or nonzero pricing fails closed. OpenCode 1.18.30 can print refresh success after a fetch failure: neither exit zero nor that message substitutes for validating the resulting entry. Never select a fallback or copy Owner credentials to satisfy preflight.
- The accepted probe baseline is OpenCode 1.18.30 with Owner-selected `opencode/longcat-2.5-preview-free`. Historical `opencode/mimo-v2.6-flash-free` dispatches remain schema-decodable for recovery; their presence in the schema does not authorize a new launch. Keep launch validation pinned to the selected model.
- Host-reboot verification preserves the old dispatch/PID/birth/boot/cgroup record. A new boot establishes old-process absence, not successful semantic completion: reconcile Stop, revoke writes and release only after physical verification. Retained but unsent requests remain unadmitted; never replay them or start a successor as part of evidence verification.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Duplicate dispatch | Reconcile same process/result |
| Cancelled delayed Start | Reject using authorization/tombstone |
| Ambiguous process ownership | Hold reservation, show recovery |
| Old connection incarnation | Reject control channel, reconcile processes |
| UID matches but dispatch does not | Deny CLI attribution |
| Journal failure | No request send; preserve recovery attention |
| Host reboot | Preserve old identity; verify writer absence, reconcile Stop/release, keep interrupted work BLOCKED and unsent handoff unknown |
| Historical model in recovered dispatch | Decode retained record and serve scoped existing results; no fallback model launch |
| Capacity full | Queue, no fallback |
| Native CLI requests approval | Objective attention, not silence-based inference |
| Planner shell writes to returned snapshot | OS ownership denies the write; snapshot tree remains unchanged |
| Node shell writes/builds in workspace | Works under the normal execution identity without a command allowlist |
| Selected model missing from Attempt catalog, invalid pricing, refresh failure/timeout or oversized catalog | Sanitized preflight failure; no model invocation |
| Output write and marker write both fail | Worker exit code `74` survives as the validated systemd capture-failure fact; Stop and retain reservation |
| Retained exited unit, absent PID/cgroup, stable exact identity | Report physical absence; reconcile original operation normally |
| Unacknowledged exit, changed identity, live PID/group or pending/unknown jobs | Error; no acknowledgement write or release |
| Main process exits while descendants remain | Emit `exited` once; backend blocks missing result and admits Stop; keep physical slot until absence |

## 5. Good / Base / Bad Cases

Good: lost start acknowledgement reconnects to the same supervised process.
Base: one Attempt launches with scoped paths and current context.
Bad: kill one PID, release its slot and start a successor while descendants write.

Model preflight: a refreshed, active, tool-capable zero-price entry permits the selected model; an already populated valid cache follows the same validation; a successful catalog command with no selected entry must not launch it.

Reboot: valid live checkpoint plus changed boot permits old-process reconciliation;
an expired checkpoint cannot justify a new interruption; a preserved unsent completion
envelope cannot be treated as an admitted result.

## 6. Tests Required

Real Linux cgroups/systemd tests: escaped/background descendants, freeze/kill, daemon restart, host reboot, birth identity and two concurrent same-UID Attempts. Probe read-only Planner commands, input files, worktree common-directory grants and completion-triggered CLI termination. Test local journal/spool write failure and receipt recovery after expiry.

For ordered logs, assert byte-complete chunking, UTF-8 split and malformed-tail behavior, stable Attempt order after retransmission, service-owned marker plus worker-exit capture failure across a daemon restart, `active (exited)` with live descendants, one `exited` event before physical absence, and no premature slot release. The selected Node/Planner host probes must use the installed CLI and fresh zero-price catalog check; a missing-formal-result probe must show backend `BLOCKED` plus stopped descendants.

[Exited-unit tests](../../../runner/internal/host/exited_unit_test.go) must exercise
actual status routing: empty/nonempty removed cgroup, disappearance during
Population, two failed unacknowledged queries with no manifest write, and live
acknowledgement only after successful validation. Reject identity changes, live
PID/group, pending/malformed job inventory and read errors. An installed Linux
fixture must acknowledge a real live process, let it exit normally, and replay the
same Stop without external unit cleanup. Label Host-only proof separately from
Task/daemon canonical settlement.

Verify shell-based snapshot write/chmod/root-replacement attempts fail while Node workspace writes, Planner scratch writes and socket/HTTPS commands succeed. Do not require a whole-host read-only view or same-UID hostile-process containment to pass this baseline.

[Adapter catalog tests](../../../runner/internal/adapter/catalog_test.go) must verify exact env/cwd parity, bounded output, absent/duplicate model rejection, malformed/missing/nonzero pricing and no model execution after preflight failure. Real CLI trials must include fresh Attempt caches; a smoke run with the Owner's existing cache does not establish Adapter compatibility.

Keep shared fixtures for the selected LongCat dispatch, historical MiMo decoding
and an unapproved model rejection. Real reboot checks require changed boot,
unchanged request digests/receipts, no replacement Start, BLOCKED interrupted work,
successful physical Stop/release and scoped reads without fresh Agent authority.

## 7. Wrong vs Correct

Wrong: map socket callers to Attempt using an environment variable.
Correct: verify kernel peer/birth/cgroup against the daemon's durable dispatch record before each journal/credential operation.

Wrong: check model availability in the Owner's default XDG cache, then launch in a fresh Attempt cache.
Correct: refresh and validate the model in the same environment/cwd used by the actual invocation; retain Runtime errors separately from catalog diagnostics.

Wrong: reboot, replay the pending handoff and call that recovery of the old Attempt.
Correct: reconcile the original records; preserve the unsent request as unknown and
the interrupted Node as BLOCKED. Manual Runner startup proves recovery after startup,
not that the installation automatically enables Runner at boot.

## Initial Task planning

Dispatch `task_planning_source` grants only source-bound initial Task Planner
authority: no Todo/Node identity, no resource ID, and empty canonical workspace
reservations. Validate its Task/Specification/source/digest before CLI and Host
work. The fixed protocol requires `publish_execution_plan` or
`raise_planning_issue`; local preparation rejects wrong intent/phase and generic
`commit_task_turn`. Use actual bundled syntax `--input FILE` and
`command-status --request-id ID`. Planning remains scratch-only; repository-free
Stop is its sole Host effect.

The finite reconnect recovery batch also owns repository-free Stops for these
initial Planners. A complete validated inventory, exact retained source/Task/
Specification/context, original operation, revoked unreleased dispatch and a
matching recoverable (or legacy untyped) local failure are required. Use the
normal `effect:` queue key and lock; retain entries blocked by old workers until
the bounded single-flight queue can drain. Retry once after Ready per connection.
Exact terminal results replay with zero Host effects. Missing/hard failures,
altered intent or operation, Todo and legacy Planner Stops do not gain authority.
No timer loop, fabricated operation or backend state reset is permitted.

Tests must reproduce failed Stop -> reconnect physical absence -> original Stop
result -> claim release, plus stale source/authorization, duplicate inventory,
occupied keys, hard/missing evidence and TLS Ready ordering. A database terminal
Attempt or process-absence report alone cannot replace successful Stop settlement.

## Specification commands

Canonical non-reply-only Task Conversation also permits
`prepare_specification_revision` and `apply_specification_revision`. Persist exact
payload bytes in the attributed journal before transport. Initial Planner, Node,
Todo, legacy Planner and reply-only sources receive no such authority. Preparation
does not close the turn; attach only with `commit_task_turn` specification routing.
Apply references an existing Owner confirmation and still requires the final reply;
the Runner cannot infer permission, wait for settlement to manufacture a reply, or
invent graph changes. Backend settlement uses existing Stop/completion effects.

## Installation discovery

The constrained helper additionally accepts `{action:"discover",attempt_id:""}`
with no dispatch/operation. `discovery.go` executes fixed OpenCode `--version` as
`me` (non-root UID/GID), explicit home/PATH and no inherited service environment.
Output is limited to 4096 bytes and a parsed semver; deadline is 10 seconds with
process-group cancellation. Discovery on reconnect reports objective installation
facts in optional `ready.runtimes`. Missing older-client reports retain history;
they cannot mark it current for a new incarnation. A detected version establishes
neither coding-CLI login nor real tool/Stop acceptance. See the backend
[infrastructure contract](../backend/infrastructure-configuration.md).

Wrong: treat missing cgroup as sufficient absence or acknowledge a failed query.
Correct: validate the retained exit and kernel facts through the shared status
path; save acknowledgement only after success and retain formal operation ownership.

## Dedicated Task review

`Dispatch.task_review_source` follows [review correction](../backend/review-correction.md).
Validate exclusive Task/planner ownership, zero watermark/activation, matching
control, complete source identity and empty reservations before local/Host work.
CLI allows context/history, nonterminal requirement preparation, reason-only genuine
Replan, source-bound issue and exactly the source purpose's terminal outcome.
Input reconsideration cannot complete main feedback; main feedback cannot resolve
another input. Stage A repository inspection and all writable/Node/Conversation/
Replan-planning effects are denied. Persist the exact envelope before send; uncertain
Retry cannot replace IDs, source, capability, basis or semantic content.

Host grants only repository-free Stop. Reconnect may reconcile its exact retained
source/Task/reservations under a revoked, unreleased dispatch and original recoverable
result after Ready. A changed feedback/operation/capability/result digest or purpose
cannot authorize recovery. Use the existing finite effect queue, no timer or new
operation. A Stop result proves the corresponding physical boundary only; it does
not supply a review semantic outcome. All Go consumers must compile after generation;
new source checks live in `local/review_test.go`, `daemon/review_recovery_test.go` and
`wire/review_test.go`. Installed native compatibility is a distinct real-host gate.
